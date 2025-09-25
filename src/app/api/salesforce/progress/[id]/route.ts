import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getConn, sfQuery } from "@/lib/salesforce/client";
import type { QueryResult } from "jsforce";

/* ===================== Types ===================== */

type Progress = {
  Id: string;
  Name: string;
  StageName: string;
  AccountId: string | null;
};

type OpportunityRecord = {
  Id: string;
  Is_Active__c?: boolean;
  StageName?: string | null;
  Web_Stage__c?: string | null;
};

type AccountInfo = {
  Id: string;
  Name: string;
  PersonEmail?: string | null;
  PersonBirthdate?: string | null;
  IsPersonAccount?: boolean;
  PersonContactId?: string | null;
  Phone?: string | null;
  Master_School__c?: string | null;
  Master_School__r?: { Name?: string | null } | null;
};

type DocRow = {
  Id: string;
  Name: string;
  Document_Type__c: string | null;
  Document_Link__c: string | null;
};

type CDLRow = {
  ContentDocumentId: string;
  LinkedEntityId: string;
  ContentDocument: {
    Title: string;
    LatestPublishedVersionId: string;
  };
};

type VersionRow = {
  Id: string;
  ContentDocumentId: string;
  IsLatest: boolean;
};

type DocBody = {
  Id?: string;
  Name: string;
  Type__c?: string | null;
  Url__c?: string | null;
};

/* ===== Orang Tua (Relationship + Contact joins) ===== */
type ParentRelRow = {
  Id: string;                  // Relationship__c.Id
  Type__c?: string | null;     // Relationship__c.Type__c
  Contact__c?: string | null;  // Relationship__c.Contact__c
  Contact__r?: {
    Name?: string | null;
    Job__c?: string | null;        // Contact custom field
    Phone?: string | null;
    Email?: string | null;
    Address__c?: string | null;    // Contact custom field
  } | null;
};

type ParentRel = {
  relationshipId?: string;
  type: string;
  contactId?: string;
  name: string;
  job: string;
  phone: string;
  email: string;
  address: string;
};

type PatchBody =
  | { segment: "dokumen"; id: string; dokumen: DocBody[] }
  | { segment: "siswa"; id: string; siswa: Record<string, unknown> }
  | { segment: "orangTua"; id: string; orangTua: ParentRel[] }
  | { segment: "activate" };

/* ===================== GET ===================== */

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const traceId = `p-${Date.now().toString(36)}`;
  const url = new URL(req.url);
  const debug = url.searchParams.get("debug") === "1";

  // --- Auth (Supabase) ---
  const supabase = await createClient();
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user?.email) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const userEmail = userData.user.email.toLowerCase();

  // --- Params ---
  const { id: rawId } = await ctx.params;
  const id = String(rawId).replace(/'/g, "\\'");
  console.log(`[${traceId}] HIT /api/salesforce/progress/${id} as ${userEmail}`);

  // 1) Opportunity
  const opps = await sfQuery<Progress>(`
    SELECT Id, Name, StageName, AccountId
    FROM Opportunity
    WHERE Id='${id}'
    LIMIT 1
  `);
  const progress: Progress | null = opps[0] ?? null;
  if (!progress) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  // 2) Validasi akses + ambil Account minimal
  let allowed = false;
  let siswaAccount: AccountInfo | null = null;

  if (progress.AccountId) {
    const accRows = await sfQuery<AccountInfo>(`
      SELECT Id, Name, PersonEmail, PersonBirthdate, IsPersonAccount, PersonContactId,
             Phone, Master_School__c, Master_School__r.Name
      FROM Account
      WHERE Id='${progress.AccountId}'
      LIMIT 1
    `);
    const account: AccountInfo | null = accRows[0] ?? null;

    if (account) {
      siswaAccount = account;

      if (account.IsPersonAccount) {
        const personEmail = (account.PersonEmail || "").toLowerCase();
        if (personEmail && personEmail === userEmail) {
          allowed = true;
        } else if (account.PersonContactId) {
          const cRows = await sfQuery<{ Id: string; Email?: string | null }>(`
            SELECT Id, Email
            FROM Contact
            WHERE Id='${account.PersonContactId}'
            LIMIT 1
          `);
          const personContact = cRows[0] ?? null;
          if ((personContact?.Email || "").toLowerCase() === userEmail) {
            allowed = true;
          }
        }
      }
    }
  }

  // Fallback: OCR
  let ocrContacts: string[] = [];
  if (!allowed) {
    const roles = await sfQuery<{ Id: string; IsPrimary: boolean; ContactId: string }>(`
      SELECT Id, IsPrimary, ContactId
      FROM OpportunityContactRole
      WHERE OpportunityId='${progress.Id}'
      ORDER BY IsPrimary DESC, CreatedDate ASC
    `);
    ocrContacts = roles.map((r) => r.ContactId).filter(Boolean);

    const primaryOrFirst = roles.find((r) => r.IsPrimary) || roles[0];
    if (primaryOrFirst?.ContactId) {
      const cRows = await sfQuery<{ Id: string; Email?: string | null }>(`
        SELECT Id, Email
        FROM Contact
        WHERE Id='${primaryOrFirst.ContactId}'
        LIMIT 1
      `);
      const c = cRows[0] ?? null;
      if ((c?.Email || "").toLowerCase() === userEmail) {
        allowed = true;
      }
    }
  }

  if (!allowed) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  // 3) Dokumen (custom object)
  const rawDocs = await sfQuery<DocRow>(`
    SELECT Id, Name, Document_Type__c, Document_Link__c
    FROM Account_Document__c
    WHERE Application_Progress__c='${progress.Id}'
    ORDER BY CreatedDate DESC
  `);

  const docs = rawDocs.map((d) => ({
    Id: d.Id,
    Name: d.Name,
    Type__c: d.Document_Type__c ?? null,
    Url__c: d.Document_Link__c ?? null,
  }));

  // 4) Files (expanded) → pilih foto
  const candidateIds = new Set<string>();
  candidateIds.add(progress.Id);
  if (progress.AccountId) candidateIds.add(progress.AccountId);
  ocrContacts.forEach((cid) => cid && candidateIds.add(cid));

  const idList = Array.from(candidateIds);
  let cdl: CDLRow[] = [];
  if (idList.length) {
    const inList = idList.map((s) => `'${s}'`).join(",");
    cdl = await sfQuery<CDLRow>(`
      SELECT ContentDocumentId, LinkedEntityId,
             ContentDocument.Title, ContentDocument.LatestPublishedVersionId
      FROM ContentDocumentLink
      WHERE LinkedEntityId IN (${inList})
      ORDER BY SystemModstamp DESC
      LIMIT 50
    `);
  }

  const photo =
    cdl.find((x) => (x.ContentDocument.Title || "").toLowerCase().includes("pas foto")) || cdl[0];
  let photoVersionId: string | null = photo?.ContentDocument.LatestPublishedVersionId || null;
  if (!photoVersionId && cdl.length) {
    const docIds = cdl.map((r) => `'${r.ContentDocumentId}'`).join(",");
    const versions = await sfQuery<VersionRow>(`
      SELECT Id, ContentDocumentId, IsLatest
      FROM ContentVersion
      WHERE ContentDocumentId IN (${docIds})
        AND IsLatest = true
      ORDER BY Id DESC
      LIMIT 1
    `);
    photoVersionId = versions[0]?.Id ?? null;
  }

  /* 5) Orang Tua (Relationships untuk applicant ini) */
  let orangTua: ParentRel[] = [];
  if (progress.AccountId) {
    const accIdSafe = progress.AccountId.replace(/'/g, "\\'");
    const relRows = await sfQuery<ParentRelRow>(`
      SELECT Type__c, Id, Contact__c,
             Contact__r.Name, Contact__r.Job__c, Contact__r.Phone,
             Contact__r.Email, Contact__r.Address__c
      FROM Relationship__c                       
      WHERE Related_Contact__r.AccountId = '${accIdSafe}'
      ORDER BY CreatedDate ASC
    `);

    orangTua = (relRows || []).map((r) => ({
      relationshipId: r.Id,
      type: r.Type__c ?? "",
      contactId: r.Contact__c ?? undefined,
      name: r.Contact__r?.Name ?? "",
      job: r.Contact__r?.Job__c ?? "",
      phone: r.Contact__r?.Phone ?? "",
      email: r.Contact__r?.Email ?? "",
      address: r.Contact__r?.Address__c ?? "",
    }));
  }

  const debugPayload = debug
    ? {
        debug: {
          linkedEntityIds: idList,
          cdl: cdl.map((r) => ({
            linkedTo: r.LinkedEntityId,
            docId: r.ContentDocumentId,
            title: r.ContentDocument.Title,
            versionId: r.ContentDocument.LatestPublishedVersionId,
          })),
        },
      }
    : undefined;

  return NextResponse.json({
    ok: true,
    data: {
      progress,
      siswa: siswaAccount,
      orangTua,              // <== dikirim ke UI
      dokumen: docs,
      photoVersionId,
      ...debugPayload,
    },
  });
}

/* ===================== Helpers ===================== */

function normalizeBirthdate(input: unknown): string | undefined {
  const s = String(input ?? "").trim();
  if (!s) return;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;                   // yyyy-mm-dd
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);       // dd/mm/yyyy
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return s;
}

/* ===================== PATCH ===================== */

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const body = (await req.json()) as PatchBody;

  // auth
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user?.id) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const conn = await getConn();

  switch (body.segment) {
    case "activate": {
      try {
        const cur = (await conn.sobject("Opportunity").retrieve(id)) as OpportunityRecord;
        if (!cur?.Id) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

        if (!cur.Is_Active__c) {
          const upd = await conn.sobject("Opportunity").update({ Id: id, Is_Active__c: true });
          if (!upd.success) {
            return NextResponse.json({ ok: false, error: "sf_update_failed" }, { status: 500 });
          }
        }
        const q = (await conn.sobject("Opportunity").retrieve(id)) as OpportunityRecord;
        const opp = {
          Id: q.Id as string,
          StageName: (q.StageName ?? null) as string | null,
          Web_Stage__c: (q.Web_Stage__c ?? null) as string | null,
          Is_Active__c: !!q.Is_Active__c,
        };
        return NextResponse.json({ ok: true, opp });
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : "internal_error";
        return NextResponse.json({ ok: false, error: errorMessage }, { status: 500 });
      }
    }

    case "dokumen": {
      const docs =
        body.segment === "dokumen" && Array.isArray(body.dokumen) ? body.dokumen : null;
      if (!docs) {
        return NextResponse.json({ ok: false, error: "invalid_payload_dokumen" }, { status: 400 });
      }

      const types = Array.from(
        new Set(
          docs
            .map((d) => (d.Type__c ?? "").trim())
            .filter((t): t is string => t.length > 0)
        )
      );

      const existingByType = new Map<string, { Id: string }>();
      if (types.length) {
        const inList = types.map((t) => `'${t.replace(/'/g, "\\'")}'`).join(",");
        const qRes: QueryResult<{ Id: string; Document_Type__c: string }> = await conn.query(
          `SELECT Id, Document_Type__c
           FROM Account_Document__c
           WHERE Application_Progress__c='${id}' AND Document_Type__c IN (${inList})`
        );
        for (const r of qRes.records) {
          if (r.Document_Type__c) existingByType.set(r.Document_Type__c, { Id: r.Id });
        }
      }

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

      for (const d of docs) {
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

      if (toUpdate.length) await conn.sobject("Account_Document__c").update(toUpdate);
      if (toInsert.length) await conn.sobject("Account_Document__c").insert(toInsert);

      return NextResponse.json({ ok: true });
    }

    case "siswa": {
      try {
        const opp = (await conn.sobject("Opportunity").retrieve(id)) as {
          Id?: string;
          AccountId?: string | null;
        };
        const accountId = opp?.AccountId || null;
        if (!accountId) {
          return NextResponse.json({ ok: false, error: "no_account_on_opportunity" }, { status: 400 });
        }

        const src = (body as Extract<PatchBody, { segment: "siswa" }>).siswa || {};
        const updateBody: any = { Id: accountId };

        const birth = normalizeBirthdate(src["PersonBirthdate"]);
        if (birth) updateBody.PersonBirthdate = birth;

        if (typeof src["Phone"] === "string") {
          updateBody.Phone = (src["Phone"] as string).trim();
        }

        const updRes = await conn.sobject("Account").update(updateBody as any);
        const ok = Array.isArray(updRes) ? updRes.every((r) => r.success) : (updRes as any);
        if (!ok) {
          const errs = Array.isArray(updRes) ? updRes.flatMap((r: any) => r.errors ?? []) : (updRes as any ?? []);
          return NextResponse.json({ ok: false, error: "sf_update_failed", details: errs }, { status: 500 });
        }

        return NextResponse.json({ ok: true });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "internal_error";
        return NextResponse.json({ ok: false, error: msg }, { status: 500 });
      }
    }

    case "orangTua": {
      try {
        // Ambil Account & PersonContactId (003…)
        const opp = (await conn.sobject("Opportunity").retrieve(id)) as {
          Id?: string; AccountId?: string | null;
        };
        const accountId = opp?.AccountId || null;
        if (!accountId) {
          return NextResponse.json({ ok: false, error: "no_account_on_opportunity" }, { status: 400 });
        }

        const acc = (await conn.sobject("Account").retrieve(accountId)) as {
          Id?: string; PersonContactId?: string | null;
        };
        const studentContactId = acc?.PersonContactId || null; // untuk Related_Contact__c

        const items = (body as Extract<PatchBody, { segment: "orangTua" }>).orangTua;
        if (!Array.isArray(items)) {
          return NextResponse.json({ ok: false, error: "invalid_payload_orangTua" }, { status: 400 });
        }

        for (const p of items) {
          const type = (p.type || "").trim();
          const name = (p.name || "").trim();
          if (!type || !name) continue; // skip baris kosong

          // === Upsert Contact (orang tua) ===
          let contactId = p.contactId || null;
          const contactPayload: any = {
            LastName: name,                                   // sederhana: taruh ke LastName
            Job__c: (p.job || "").trim() || null,            // custom
            Phone: (p.phone || "").trim() || null,
            Email: (p.email || "").trim() || null,
            Address__c: (p.address || "").trim() || null,    // custom
          };
          if (contactId) {
            await conn.sobject("Contact").update({ Id: contactId, ...contactPayload });
          } else {
            const ins = await conn.sobject("Contact").insert(contactPayload);
            if (!(ins as any)?.success) {
              return NextResponse.json({ ok: false, error: "contact_insert_failed" }, { status: 500 });
            }
            contactId = (ins as any).id as string;
          }

          // === Upsert Relationship__c ===
          const relBase: any = {
            Type__c: type,
            Contact__c: contactId,                 // orang tua
            ...(studentContactId ? { Related_Contact__c: studentContactId } : {}),
            // ...(accountId ? { Account__c: accountId } : {}), // <-- aktifkan jika object punya Account__c
          };

          if (p.relationshipId) {
            await conn.sobject("Relationship__c").update({ Id: p.relationshipId, ...relBase });
          } else {
            const r = await conn.sobject("Relationship__c").insert(relBase);
            if (!(r as any)?.success) {
              return NextResponse.json({ ok: false, error: "relationship_insert_failed" }, { status: 500 });
            }
          }
        }

        return NextResponse.json({ ok: true });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "internal_error";
        return NextResponse.json({ ok: false, error: msg }, { status: 500 });
      }
    }

    default:
      return NextResponse.json({ ok: false, error: "unsupported segment" }, { status: 400 });
  }
}
