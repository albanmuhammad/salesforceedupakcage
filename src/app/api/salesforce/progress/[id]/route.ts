import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getConn, sfQuery } from "@/lib/salesforce/client";
import type { QueryResult, SaveResult } from "jsforce";

/* ===================== Types ===================== */

// ==== TYPES ====
type Progress = {
  Id: string;
  Name: string;
  StageName: string;
  AccountId: string | null;
};

type PaymentInfoRow = {
  Id: string;
  Name: string;
  Amount__c?: number | null;
  Payment_Status__c?: string | null;
  Virtual_Account_No__c?: string | null;
  Payment_Channel__c?: string | null;
  Payment_Channel__r?: {
    Payment_Channel_Bank__c?: string | null;
  } | null;
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
  Id: string; // Relationship__c.Id
  Type__c?: string | null;
  Contact__c?: string | null;
  Contact__r?: {
    Name?: string | null;
    Job__c?: string | null;
    Phone?: string | null;
    Email?: string | null;
    Address__c?: string | null;
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

// ==== UTILS ====
function esc(s: string) {
  // Minimal escape untuk query literal single-quoted
  return s.replace(/'/g, "\\'");
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const traceId = `p-${Date.now().toString(36)}`;
  const url = new URL(req.url);
  const debug = url.searchParams.get("debug") === "1";

  // Auth
  const supabase = await createClient();
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user?.email) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 }
    );
  }
  const userEmail = userData.user.email.toLowerCase();

  // Params
  const { id: rawId } = await ctx.params;
  const id = esc(String(rawId));
  console.log(
    `[${traceId}] HIT /api/salesforce/progress/${id} as ${userEmail}`
  );

  // 1) Opportunity
  const opps = await sfQuery<Progress>(`
    SELECT Id, Name, StageName, AccountId
    FROM Opportunity
    WHERE Id='${id}'
    LIMIT 1
  `);
  const progress: Progress | null = opps[0] ?? null;
  if (!progress) {
    return NextResponse.json(
      { ok: false, error: "not_found" },
      { status: 404 }
    );
  }

  // 2) Validasi akses + ambil Account minimal (plus Phone & School__c)
  let allowed = false;
  let siswaAccount: AccountInfo | null = null;

  if (progress.AccountId) {
    const accRows = await sfQuery<AccountInfo>(`
      SELECT Id, Name, PersonEmail, PersonBirthdate, IsPersonAccount, PersonContactId,
             Phone, Master_School__c, Master_School__r.Name
      FROM Account
      WHERE Id='${esc(progress.AccountId)}'
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
            WHERE Id='${esc(account.PersonContactId)}'
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
    const roles = await sfQuery<{
      Id: string;
      IsPrimary: boolean;
      ContactId: string;
    }>(`
      SELECT Id, IsPrimary, ContactId
      FROM OpportunityContactRole
      WHERE OpportunityId='${esc(progress.Id)}'
      ORDER BY IsPrimary DESC, CreatedDate ASC
    `);
    ocrContacts = roles.map((r) => r.ContactId).filter(Boolean);

    const primaryOrFirst = roles.find((r) => r.IsPrimary) || roles[0];
    if (primaryOrFirst?.ContactId) {
      const cRows = await sfQuery<{ Id: string; Email?: string | null }>(`
        SELECT Id, Email
        FROM Contact
        WHERE Id='${esc(primaryOrFirst.ContactId)}'
        LIMIT 1
      `);
      const c = cRows[0] ?? null;
      if ((c?.Email || "").toLowerCase() === userEmail) {
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

  // 3) Dokumen (custom object) — ambil baris Account_Document__c
  const rawDocs = await sfQuery<DocRow>(`
    SELECT Id, Name, Document_Type__c, Document_Link__c
    FROM Account_Document__c
    WHERE Application_Progress__c='${id}'
    ORDER BY CreatedDate DESC
  `);
  console.log(`[${traceId}] account documents count: ${rawDocs.length}`);

  // 4) Perluas pencarian file via ContentDocumentLink pada Opportunity, Account, dan semua Contact di OCR
  const candidateIds = new Set<string>();
  candidateIds.add(progress.Id);
  if (progress.AccountId) candidateIds.add(progress.AccountId);
  ocrContacts.forEach((cid) => cid && candidateIds.add(cid));

  const idList = Array.from(candidateIds);
  let cdl: CDLRow[] = [];
  if (idList.length) {
    const inList = idList.map((s) => `'${esc(s)}'`).join(",");
    cdl = await sfQuery<CDLRow>(`
      SELECT ContentDocumentId, LinkedEntityId,
             ContentDocument.Title, ContentDocument.LatestPublishedVersionId
      FROM ContentDocumentLink
      WHERE LinkedEntityId IN (${inList})
      ORDER BY SystemModstamp DESC
      LIMIT 50
    `);
  }

  console.log(`[${traceId}] CDL count (expanded) = ${cdl.length}`);
  if (cdl.length) {
    console.log(
      `[${traceId}] some CDL`,
      cdl.slice(0, 5).map((r) => ({
        led: r.LinkedEntityId,
        title: r.ContentDocument.Title,
        ver: r.ContentDocument.LatestPublishedVersionId,
      }))
    );
  }

  // ==== Helper: ekstrak ID dari URL (068/069) ====
  function extractIdsFromUrl(url?: string | null): {
    verId?: string;
    docId?: string;
  } {
    if (!url) return {};
    // Cari 068… (ContentVersionId) atau 069… (ContentDocumentId)
    const m068 = url.match(/(?:^|[^\w])(068[0-9A-Za-z]{15,18})/);
    if (m068?.[1]) return { verId: m068[1] };
    const m069 = url.match(/(?:^|[^\w])(069[0-9A-Za-z]{15,18})/);
    if (m069?.[1]) return { docId: m069[1] };
    return {};
  }

  // ==== 1) Buat index dari CDL: 069 -> 068 (Latest) + judul ternormalisasi ====
  const docIdToLatestVer = new Map<string, string>(); // 069 -> 068
  const normalizedTitleToVer = new Map<string, string>();

  function normTitle(s?: string | null) {
    return (s || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  for (const r of cdl) {
    const latest = r.ContentDocument.LatestPublishedVersionId;
    const docId = r.ContentDocumentId;
    if (docId && latest && !docIdToLatestVer.has(docId)) {
      docIdToLatestVer.set(docId, latest);
    }
    const t = normTitle(r.ContentDocument.Title);
    if (t && latest && !normalizedTitleToVer.has(t)) {
      normalizedTitleToVer.set(t, latest);
    }
  }

  // ==== 2) Siapkan batch lookup untuk 069 yang belum ada di map (opsional & hemat kueri) ====
  const missing069 = new Set<string>();

  // Koleksi kandidat ContentVersionId untuk tiap dok supaya tidak query berulang
  const docIdFromLink: Array<{ idx: number; docId: string }> = [];
  const verIdFromLink: Array<{ idx: number; verId: string }> = [];

  // Pre-scan rawDocs untuk ambil ID dari link
  rawDocs.forEach((d, idx) => {
    const { verId, docId } = extractIdsFromUrl(d.Document_Link__c);
    if (verId) verIdFromLink.push({ idx, verId });
    else if (docId) {
      docIdFromLink.push({ idx, docId });
      if (!docIdToLatestVer.has(docId)) missing069.add(docId);
    }
  });

  // Jika ada 069 yang belum punya latest version di map, batch query ContentDocument
  if (missing069.size) {
    const inList = Array.from(missing069)
      .map((s) => `'${esc(s)}'`)
      .join(",");
    const rows = await sfQuery<{
      Id: string;
      LatestPublishedVersionId: string;
    }>(`
    SELECT Id, LatestPublishedVersionId
    FROM ContentDocument
    WHERE Id IN (${inList})
  `);
    for (const r of rows) {
      if (r.Id && r.LatestPublishedVersionId) {
        docIdToLatestVer.set(r.Id, r.LatestPublishedVersionId);
      }
    }
  }

  // ==== 3) Bangun hasil 'docs' dengan prioritas:
  // (a) URL punya 068 -> pakai itu
  // (b) URL punya 069 -> map ke 068 via docIdToLatestVer
  // (c) Cocokkan judul ternormalisasi (Name vs Title)
  // (d) Gagal -> null
  const docs = rawDocs.map((d, i) => {
    // (a) langsung 068 dari URL
    const verDirect = verIdFromLink.find((x) => x.idx === i)?.verId;
    if (verDirect) {
      return {
        Id: d.Id,
        Name: d.Name,
        Type__c: d.Document_Type__c ?? null,
        Url__c: d.Document_Link__c ?? null,
        ContentVersionId: verDirect,
      };
    }

    // (b) 069 dari URL → 068 via map
    const docFromUrl = docIdFromLink.find((x) => x.idx === i)?.docId;
    const verFrom069 = docFromUrl
      ? docIdToLatestVer.get(docFromUrl) ?? null
      : null;
    if (verFrom069) {
      return {
        Id: d.Id,
        Name: d.Name,
        Type__c: d.Document_Type__c ?? null,
        Url__c: d.Document_Link__c ?? null,
        ContentVersionId: verFrom069,
      };
    }

    // (c) fallback judul
    const key = normTitle(d.Name);
    const verFromTitle = key ? normalizedTitleToVer.get(key) ?? null : null;

    return {
      Id: d.Id,
      Name: d.Name,
      Type__c: d.Document_Type__c ?? null,
      Url__c: d.Document_Link__c ?? null,
      ContentVersionId: verFromTitle, // bisa null kalau tidak ketemu
    };
  });

  // Pilih foto: judul mengandung "pas foto", jika tidak ada ambil entri pertama
  const photo =
    cdl.find((x) =>
      (x.ContentDocument.Title || "").toLowerCase().includes("pas foto")
    ) || cdl[0];

  let photoVersionId: string | null =
    photo?.ContentDocument.LatestPublishedVersionId || null;

  // (opsional) fallback verifikasi via ContentVersion jika title kosong atau tidak ada LatestPublishedVersionId
  if (!photoVersionId && cdl.length) {
    const docIds = cdl.map((r) => `'${esc(r.ContentDocumentId)}'`).join(",");
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

  const qPayments = `
    SELECT
      Id, Name,
      Amount__c,
      Payment_Status__c,
      Virtual_Account_No__c,
      Payment_Channel__c,
      Payment_Channel__r.Payment_Channel_Bank__c
    FROM Payment_Information__c
    WHERE Application_Progress__c = '${id}'
    ORDER BY CreatedDate DESC
  `;
  const payments = await sfQuery<PaymentInfoRow>(qPayments);

  // 5) Orang Tua (Relationships untuk applicant ini)
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
          documents: docs.map((d) => ({
            id: d.Id,
            name: d.Name,
            originalUrl: d.Url__c,
            contentVersionId: d.ContentVersionId,
          })),
        },
      }
    : undefined;

  return NextResponse.json({
    ok: true,
    data: {
      progress,
      siswa: siswaAccount,
      orangTua: orangTua,
      dokumen: docs, // sudah include ContentVersionId hasil match Title
      photoVersionId, // untuk <img src="/api/salesforce/files/version/{id}/data">
      payments,
      ...debugPayload,
    },
  });
}

/* ===================== Helpers ===================== */

function normalizeBirthdate(input: unknown): string | undefined {
  const s = String(input ?? "").trim();
  if (!s) return;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return s;
}

/* ===================== PATCH ===================== */

/** Payload aman untuk update Account (Id wajib, field lain opsional) */
type AccountUpdatePayload = {
  Id: string;
  PersonBirthdate?: string;
  Phone?: string;
};

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id: rawId } = await ctx.params;
  const id = String(rawId);

  // ✅ Auth sama seperti GET
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user?.id) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 }
    );
  }

  const body = (await req.json()) as PatchBody;
  const conn = await getConn();

  switch (body.segment) {
    case "activate": {
      try {
        const cur = (await conn
          .sobject("Opportunity")
          .retrieve(id)) as OpportunityRecord;
        if (!cur?.Id)
          return NextResponse.json(
            { ok: false, error: "not_found" },
            { status: 404 }
          );

        if (!cur.Is_Active__c && cur.StageName !== "Closed Lost") {
          const upd = await conn.sobject("Opportunity").update({
            Id: id,
            Is_Active__c: true,
          });
          if (!upd.success) {
            return NextResponse.json(
              { ok: false, error: "sf_update_failed" },
              { status: 500 }
            );
          }
        }
        const q = (await conn
          .sobject("Opportunity")
          .retrieve(id)) as OpportunityRecord;
        const opp = {
          Id: String(q.Id),
          StageName: q.StageName ?? null,
          Web_Stage__c: q.Web_Stage__c ?? null,
          Is_Active__c: !!q.Is_Active__c,
        };
        return NextResponse.json({ ok: true, opp });
      } catch (err: unknown) {
        const errorMessage =
          err instanceof Error ? err.message : "internal_error";
        return NextResponse.json(
          { ok: false, error: errorMessage },
          { status: 500 }
        );
      }
    }

    case "dokumen": {
      const docs = Array.isArray(
        (body as Extract<PatchBody, { segment: "dokumen" }>).dokumen
      )
        ? (body as Extract<PatchBody, { segment: "dokumen" }>).dokumen
        : null;
      if (!docs) {
        return NextResponse.json(
          { ok: false, error: "invalid_payload_dokumen" },
          { status: 400 }
        );
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
        const inList = types.map((t) => `'${esc(t)}'`).join(",");
        const qRes: QueryResult<{ Id: string; Document_Type__c: string }> =
          await conn.query(
            `SELECT Id, Document_Type__c
             FROM Account_Document__c
             WHERE Application_Progress__c='${esc(
               id
             )}' AND Document_Type__c IN (${inList})`
          );
        for (const r of qRes.records) {
          if (r.Document_Type__c) {
            existingByType.set(r.Document_Type__c, { Id: r.Id });
          }
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

      if (toUpdate.length)
        await conn.sobject("Account_Document__c").update(toUpdate);
      if (toInsert.length)
        await conn.sobject("Account_Document__c").insert(toInsert);

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
          return NextResponse.json(
            { ok: false, error: "no_account_on_opportunity" },
            { status: 400 }
          );
        }

        const src =
          (body as Extract<PatchBody, { segment: "siswa" }>).siswa || {};
        const updateBody: AccountUpdatePayload = { Id: accountId };

        const birth = normalizeBirthdate(
          (src as Record<string, unknown>)["PersonBirthdate"]
        );
        if (birth) updateBody.PersonBirthdate = birth;

        if (typeof (src as Record<string, unknown>)["Phone"] === "string") {
          updateBody.Phone = String(
            (src as Record<string, unknown>)["Phone"]
          ).trim();
        }

        const updRes: SaveResult = await conn
          .sobject("Account")
          .update(updateBody);
        if (!updRes.success) {
          return NextResponse.json(
            { ok: false, error: "sf_update_failed" },
            { status: 500 }
          );
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
          Id?: string;
          AccountId?: string | null;
        };
        const accountId = opp?.AccountId || null;
        if (!accountId) {
          return NextResponse.json(
            { ok: false, error: "no_account_on_opportunity" },
            { status: 400 }
          );
        }

        const acc = (await conn.sobject("Account").retrieve(accountId)) as {
          Id?: string;
          PersonContactId?: string | null;
        };
        const studentContactId = acc?.PersonContactId || null; // Related_Contact__c

        const items = (body as Extract<PatchBody, { segment: "orangTua" }>)
          .orangTua;
        if (!Array.isArray(items)) {
          return NextResponse.json(
            { ok: false, error: "invalid_payload_orangTua" },
            { status: 400 }
          );
        }

        for (const p of items) {
          const type = (p.type || "").trim();
          const name = (p.name || "").trim();
          if (!type || !name) continue;

          // Upsert Contact (orang tua)
          let contactId = p.contactId || null;
          const contactPayload: {
            Id?: string;
            LastName: string;
            Job__c?: string | null;
            Phone?: string | null;
            Email?: string | null;
            Address__c?: string | null;
          } = {
            LastName: name,
            Job__c: (p.job || "").trim() || null,
            Phone: (p.phone || "").trim() || null,
            Email: (p.email || "").trim() || null,
            Address__c: (p.address || "").trim() || null,
          };

          if (contactId) {
            await conn
              .sobject("Contact")
              .update({ Id: contactId, ...contactPayload });
          } else {
            const ins = await conn.sobject("Contact").insert(contactPayload);
            if (!ins.success) {
              return NextResponse.json(
                { ok: false, error: "contact_insert_failed" },
                { status: 500 }
              );
            }
            contactId = ins.id as string;
          }

          // Upsert Relationship__c
          const relBase: {
            Id?: string;
            Type__c: string;
            Contact__c: string;
            Related_Contact__c?: string;
          } = {
            Type__c: type,
            Contact__c: contactId,
            ...(studentContactId
              ? { Related_Contact__c: studentContactId }
              : {}),
          };

          if (p.relationshipId) {
            await conn
              .sobject("Relationship__c")
              .update({ Id: p.relationshipId, ...relBase });
          } else {
            const r = await conn.sobject("Relationship__c").insert(relBase);
            if (!r.success) {
              return NextResponse.json(
                { ok: false, error: "relationship_insert_failed" },
                { status: 500 }
              );
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
      return NextResponse.json(
        { ok: false, error: "unsupported segment" },
        { status: 400 }
      );
  }
}
