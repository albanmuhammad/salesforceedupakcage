import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getConn, sfQuery } from "@/lib/salesforce/client";
import type { QueryResult } from "jsforce";
import type {
  AccountDocumentInsert,
  AccountDocumentUpdate,
} from "@/types/salesforce";

type Progress = {
  Id: string;
  Name: string;
  StageName: string;
  AccountId: string | null;
};

type DocBody = {
  Id?: string;
  Name: string;
  Type__c?: string | null;
  Url__c?: string | null;
};

type PatchBody =
  | { segment: "dokumen"; id: string; dokumen: DocBody[] }
  | { segment: "siswa"; id: string; siswa: Record<string, unknown> }
  | { segment: "orangTua"; id: string; orangTua: Record<string, unknown> };

export async function GET(
  _: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();

  // ✅ Use getUser() (secure) instead of relying on getSession().user
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user?.email) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 }
    );
  }
  const userEmail = userData.user.email.toLowerCase();

  // ✅ Await params in Next 15 route handlers
  const { id: rawId } = await ctx.params;
  const id = String(rawId).replace(/'/g, "\\'"); // basic escape

  // 1) Fetch Opportunity
  const [progress] = await sfQuery<Progress>(
    `SELECT Id, Name, StageName, AccountId
     FROM Opportunity
     WHERE Id='${id}'
     LIMIT 1`
  );
  if (!progress) {
    return NextResponse.json(
      { ok: false, error: "not_found" },
      { status: 404 }
    );
  }

  // 2) Access validation and "siswa" account payload
  let allowed = false;
  let siswaAccount: {
    Id: string;
    Name: string;
    PersonEmail?: string | null;
    PersonBirthdate?: string | null;
    IsPersonAccount?: boolean;
    PersonContactId?: string | null;
  } | null = null;

  // Try Account path first if present
  if (progress.AccountId) {
    const [account] = await sfQuery<{
      Id: string;
      Name: string;
      PersonEmail?: string | null;
      PersonBirthdate?: string | null;
      IsPersonAccount?: boolean;
      PersonContactId?: string | null;
    }>(
      `SELECT Id, Name, PersonEmail, PersonBirthdate, IsPersonAccount, PersonContactId
       FROM Account
       WHERE Id='${progress.AccountId}'
       LIMIT 1`
    );

    if (account) {
      siswaAccount = account;

      if (account.IsPersonAccount) {
        // Person Account path
        const personEmail = (account.PersonEmail || "").toLowerCase();
        if (personEmail && personEmail === userEmail) {
          allowed = true;
        } else if (account.PersonContactId) {
          const [personContact] = await sfQuery<{
            Id: string;
            Email?: string | null;
          }>(
            `SELECT Id, Email
             FROM Contact
             WHERE Id='${account.PersonContactId}'
             LIMIT 1`
          );
          if ((personContact?.Email || "").toLowerCase() === userEmail) {
            allowed = true;
          }
        }
      }
    }
  }

  // Fallback / also try OCR path (handles B2B or missing AccountId)
  if (!allowed) {
    const ocr = await sfQuery<{
      Id: string;
      IsPrimary: boolean;
      ContactId: string;
    }>(
      `SELECT Id, IsPrimary, ContactId
       FROM OpportunityContactRole
       WHERE OpportunityId='${progress.Id}'
       ORDER BY IsPrimary DESC, CreatedDate ASC`
    );

    const primaryOrFirst = ocr.find((r) => r.IsPrimary) || ocr[0];
    if (primaryOrFirst?.ContactId) {
      const [contact] = await sfQuery<{ Id: string; Email?: string | null }>(
        `SELECT Id, Email
         FROM Contact
         WHERE Id='${primaryOrFirst.ContactId}'
         LIMIT 1`
      );
      if ((contact?.Email || "").toLowerCase() === userEmail) {
        allowed = true;
      }
    }
  }

  if (!allowed) {
    return NextResponse.json(
      { ok: false, error: "forbidden" },
      { status: 403 }
    );
  }

  // 3) Documents — map fields to the names your page expects
  const rawDocs = await sfQuery<{
    Id: string;
    Name: string;
    Document_Type__c: string | null;
    Document_Link__c: string | null;
  }>(
    `SELECT Id, Name, Document_Type__c, Document_Link__c
     FROM Account_Document__c
     WHERE Application_Progress__c='${progress.Id}'
     ORDER BY CreatedDate DESC`
  );

  const docs = rawDocs.map((d) => ({
    Id: d.Id,
    Name: d.Name,
    Type__c: d.Document_Type__c ?? null,
    Url__c: d.Document_Link__c ?? null,
  }));

  return NextResponse.json({
    ok: true,
    data: {
      progress,
      siswa: siswaAccount,
      orangTua: null,
      dokumen: docs,
    },
  });
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const body = (await req.json()) as PatchBody;

  if (body.segment !== "dokumen" || !("dokumen" in body)) {
    return NextResponse.json(
      { ok: false, error: "unsupported segment" },
      { status: 400 }
    );
  }

  const conn = await getConn();

  // 1) Kumpulkan tipe yang dikirim
  const types = Array.from(
    new Set(
      body.dokumen
        .map((d) => (d.Type__c ?? "").trim())
        .filter((t): t is string => t.length > 0)
    )
  );

  // 2) Query existing untuk progress + tipe-2 tsb
  const existingByType = new Map<string, { Id: string }>();
  if (types.length) {
    const inList = types.map((t) => `'${t.replace(/'/g, "\\'")}'`).join(",");
    const qRes: QueryResult<{ Id: string; Document_Type__c: string }> =
      await conn.query(
        `SELECT Id, Document_Type__c
       FROM Account_Document__c
       WHERE Application_Progress__c='${id}' AND Document_Type__c IN (${inList})`
      );
    for (const r of qRes.records) {
      if (r.Document_Type__c)
        existingByType.set(r.Document_Type__c, { Id: r.Id });
    }
  }

  // 3) Build batch insert/update
  const toInsert: Array<{
    Name: string;
    Application_Progress__c: string;
    Document_Type__c: string;
    Document_Link__c: string;
  }> = [];

  const toUpdate: Array<{
    Id: string;
    Name: string;
    Application_Progress__c: string;
    Document_Type__c: string;
    Document_Link__c: string;
  }> = [];

  for (const d of body.dokumen) {
    const type = (d.Type__c ?? "").trim();
    if (!type) continue;

    const link = (d.Url__c ?? "").trim();
    const name = d.Name?.trim() || type || "Document";

    const base = {
      Name: name,
      Application_Progress__c: id,
      Document_Type__c: type,
      Document_Link__c: link,
    };

    const existing = d.Id ? { Id: d.Id } : existingByType.get(type);
    if (existing?.Id) {
      toUpdate.push({ Id: existing.Id, ...base });
    } else {
      toInsert.push(base);
    }
  }

  if (toUpdate.length)
    await conn.sobject("Account_Document__c").update(toUpdate);
  if (toInsert.length)
    await conn.sobject("Account_Document__c").insert(toInsert);

  return NextResponse.json({ ok: true });
}
