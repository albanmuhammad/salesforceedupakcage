import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sfQuery } from "@/lib/salesforce/client";

type Progress = {
  Id: string;
  Name: string;
  StageName: string;
  AccountId: string | null;
};

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
