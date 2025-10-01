import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getConn, sfQuery } from "@/lib/salesforce/client";
import type { SaveResult } from "jsforce";

/* ===================== Types ===================== */

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
  Payment_For__c?: string | null;
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
  Verified__c?: boolean | null; // ⬅️ ditambahkan
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

/* =============== Utils =============== */

function esc(s: string) {
  return s.replace(/'/g, "\\'");
}

function normalizeBirthdate(input: unknown): string | undefined {
  const s = String(input ?? "").trim();
  if (!s) return;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return s;
}

/* ===================== GET ===================== */

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
    const roles = await sfQuery<{ Id: string; IsPrimary: boolean; ContactId: string }>(`
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
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  // 3) Dokumen (custom object) — include Verified__c
  const rawDocs = await sfQuery<DocRow>(`
    SELECT Id, Name, Document_Type__c, Document_Link__c, Verified__c
    FROM Account_Document__c
    WHERE Application_Progress__c='${id}'
    ORDER BY CreatedDate DESC
  `);
  console.log(`[${traceId}] account documents count: ${rawDocs.length}`);

  // 4) File via ContentDocumentLink
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

  // Helper: ekstrak 068/069 dari URL
  function extractIdsFromUrl(url?: string | null): { verId?: string; docId?: string } {
    if (!url) return {};
    const m068 = url.match(/(?:^|[^\w])(068[0-9A-Za-z]{15,18})/);
    if (m068?.[1]) return { verId: m068[1] };
    const m069 = url.match(/(?:^|[^\w])(069[0-9A-Za-z]{15,18})/);
    if (m069?.[1]) return { docId: m069[1] };
    return {};
  }

  // Index CDL: 069 -> 068 + normalized title
  const docIdToLatestVer = new Map<string, string>(); // 069 -> 068
  const normalizedTitleToVer = new Map<string, string>();
  const normTitle = (s?: string | null) =>
    (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

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

  // Pre-scan rawDocs: cari 068/069 di URL
  const missing069 = new Set<string>();
  const docIdFromLink: Array<{ idx: number; docId: string }> = [];
  const verIdFromLink: Array<{ idx: number; verId: string }> = [];

  rawDocs.forEach((d, idx) => {
    const { verId, docId } = extractIdsFromUrl(d.Document_Link__c);
    if (verId) verIdFromLink.push({ idx, verId });
    else if (docId) {
      docIdFromLink.push({ idx, docId });
      if (!docIdToLatestVer.has(docId)) missing069.add(docId);
    }
  });

  // Lengkapi 069 yang belum punya 068 via ContentDocument
  if (missing069.size) {
    const inList = Array.from(missing069).map((s) => `'${esc(s)}'`).join(",");
    const rows = await sfQuery<{ Id: string; LatestPublishedVersionId: string }>(`
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

  // Bangun dokumen final (pilih ContentVersionId terbaik)
  const docs = rawDocs.map((d, i) => {
    const verDirect = verIdFromLink.find((x) => x.idx === i)?.verId;
    if (verDirect) {
      return {
        Id: d.Id,
        Name: d.Name,
        Type__c: d.Document_Type__c ?? null,
        Url__c: d.Document_Link__c ?? null,
        ContentVersionId: verDirect,
        Verified__c: d.Verified__c ?? null, // ⬅️ ikut dikirim
      };
    }

    const docFromUrl = docIdFromLink.find((x) => x.idx === i)?.docId;
    const verFrom069 = docFromUrl ? docIdToLatestVer.get(docFromUrl) ?? null : null;
    if (verFrom069) {
      return {
        Id: d.Id,
        Name: d.Name,
        Type__c: d.Document_Type__c ?? null,
        Url__c: d.Document_Link__c ?? null,
        ContentVersionId: verFrom069,
        Verified__c: d.Verified__c ?? null,
      };
    }

    const key = normTitle(d.Name);
    const verFromTitle = key ? normalizedTitleToVer.get(key) ?? null : null;

    return {
      Id: d.Id,
      Name: d.Name,
      Type__c: d.Document_Type__c ?? null,
      Url__c: d.Document_Link__c ?? null,
      ContentVersionId: verFromTitle,
      Verified__c: d.Verified__c ?? null,
    };
  });

  // cari Pas Foto
  const pasFoto = cdl.find((x) => (x.ContentDocument.Title || "").toLowerCase().includes("pas foto")) || null;
  // cari Test Card
  const testCard = cdl.find((x) => (x.ContentDocument.Title || "").toLowerCase().includes("testcard")) || null;

  let pasFotoVersionId: string | null = pasFoto?.ContentDocument.LatestPublishedVersionId || null;
  let testCardVersionId: string | null = testCard?.ContentDocument.LatestPublishedVersionId || null;

  // fallback kalau LatestPublishedVersionId kosong
  if ((!pasFotoVersionId || !testCardVersionId) && cdl.length) {
    const docIds = cdl.map((r) => `'${esc(r.ContentDocumentId)}'`).join(",");
    const versions = await sfQuery<VersionRow>(`
      SELECT Id, ContentDocumentId, IsLatest
      FROM ContentVersion
      WHERE ContentDocumentId IN (${docIds})
        AND IsLatest = true
      ORDER BY Id DESC
    `);

    if (!pasFotoVersionId && pasFoto) {
      pasFotoVersionId = versions.find((v) => v.ContentDocumentId === pasFoto.ContentDocumentId)?.Id ?? null;
    }
    if (!testCardVersionId && testCard) {
      testCardVersionId = versions.find((v) => v.ContentDocumentId === testCard.ContentDocumentId)?.Id ?? null;
    }
  }

  // Payments
  const qPayments = `
    SELECT
      Id, Name,
      Amount__c,
      Payment_Status__c,
      Virtual_Account_No__c,
      Payment_Channel__c,
      Payment_Channel__r.Payment_Channel_Bank__c,
      Payment_For__c
    FROM Payment_Information__c
    WHERE Application_Progress__c = '${id}'
    ORDER BY CreatedDate ASC
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

  // 6) Picklist Type__c (ACTIVE) — TANPA any
  type PicklistValue = { active?: boolean; value?: string | null };
  type SObjectField = { name?: string | null; picklistValues?: PicklistValue[] | null };
  type SObjectDescribe = { fields?: SObjectField[] | null };

  const isPicklistValue = (v: unknown): v is PicklistValue =>
    typeof v === "object" && v !== null && ("active" in (v as object) || "value" in (v as object));
  const isField = (f: unknown): f is SObjectField => {
    if (typeof f !== "object" || f === null) return false;
    const nameOk = !("name" in f) || typeof (f as { name?: unknown }).name === "string" || (f as { name?: unknown }).name == null;
    const pv = (f as { picklistValues?: unknown }).picklistValues;
    const pvOk = pv == null || (Array.isArray(pv) && pv.every(isPicklistValue));
    return nameOk && pvOk;
  };
  const isDescribe = (d: unknown): d is SObjectDescribe =>
    typeof d === "object" && d !== null && (!("fields" in d) || Array.isArray((d as { fields?: unknown }).fields));

  let relTypeOptions: string[] = [];
  try {
    const conn = await getConn();
    const rawDesc: unknown = await conn.sobject("Relationship__c").describe();
    const desc: SObjectDescribe = isDescribe(rawDesc) ? rawDesc : { fields: [] };
    const fields = Array.isArray(desc.fields) ? desc.fields.filter(isField) : [];
    const typeField = fields.find((f) => (f.name ?? "") === "Type__c");

    relTypeOptions = Array.isArray(typeField?.picklistValues)
      ? typeField!.picklistValues
          .filter((p): p is PicklistValue => isPicklistValue(p) && (p.active ?? false))
          .map((p) => (typeof p.value === "string" ? p.value.trim() : ""))
          .filter((v): v is string => v.length > 0)
      : [];
    console.log(`[${traceId}] relTypeOptions from SF:`, relTypeOptions);
  } catch (e) {
    console.log(`[${traceId}] describe Relationship__c failed`, e);
  }
  if (relTypeOptions.length === 0) {
    // fallback agar UI tetap hidup
    relTypeOptions = ["Father", "Mother"];
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
            verified: d.Verified__c ?? null,
          })),
        },
      }
    : undefined;

  return NextResponse.json({
    ok: true,
    data: {
      progress,
      siswa: siswaAccount,
      orangTua,
      dokumen: docs,        // berisi Verified__c
      pasFotoVersionId,
      testCardVersionId,
      payments,
      relTypeOptions,
      ...debugPayload,
    },
  });
}

/* ===================== PATCH ===================== */

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

  // Auth
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user?.id) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as PatchBody;
  const conn = await getConn();

  switch (body.segment) {
    case "activate": {
      try {
        const cur = (await conn.sobject("Opportunity").retrieve(id)) as OpportunityRecord;
        if (!cur?.Id) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

        if (!cur.Is_Active__c && cur.StageName !== "Closed Lost") {
          const upd = await conn.sobject("Opportunity").update({ Id: id, Is_Active__c: true });
          if (!upd.success) {
            return NextResponse.json({ ok: false, error: "sf_update_failed" }, { status: 500 });
          }
        }
        const q = (await conn.sobject("Opportunity").retrieve(id)) as OpportunityRecord;
        const opp = {
          Id: String(q.Id),
          StageName: q.StageName ?? null,
          Web_Stage__c: q.Web_Stage__c ?? null,
          Is_Active__c: !!q.Is_Active__c,
        };
        return NextResponse.json({ ok: true, opp });
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : "internal_error";
        return NextResponse.json({ ok: false, error: errorMessage }, { status: 500 });
      }
    }

    case "dokumen": {
      type DocInput = {
        Id?: string;
        Name?: string | null;
        Type__c?: string | null;
        Url__c?: string | null;
        Document_Type__c?: string | null;
        Document_Link__c?: string | null;
      };

      type PatchDokumen = Extract<PatchBody, { segment: "dokumen" }>;
      const docs = Array.isArray((body as PatchDokumen).dokumen)
        ? ((body as PatchDokumen).dokumen as DocInput[])
        : null;

      if (!docs) {
        return NextResponse.json({ ok: false, error: "invalid_payload_dokumen" }, { status: 400 });
      }

      // Ambil AccountId + Progress Name sekali
      const oppRes = await conn.query<{ AccountId: string; Name: string }>(`
        SELECT AccountId, Name
        FROM Opportunity
        WHERE Id = '${esc(id)}'
        LIMIT 1
      `);
      const accId = oppRes.records?.[0]?.AccountId;
      const progressName = oppRes.records?.[0]?.Name || "";
      if (!accId) {
        return NextResponse.json({ ok: false, error: "missing_account" }, { status: 400 });
      }

      const toUpdate: Array<{ Id: string; Name?: string | null; Document_Link__c?: string | null }> = [];

      for (const d of docs) {
        const type = (d.Type__c ?? d.Document_Type__c ?? "").trim();
        const link = (d.Url__c ?? d.Document_Link__c ?? "").trim();

        // Nama canonical: "Type ProgressName"
        const desiredName = type ? `${type} ${progressName}`.trim() : "";

        // Cari target row
        let docId = d.Id?.trim() || "";

        if (!docId && type) {
          const q = await conn.query<{ Id: string; Application_Progress__c?: string | null }>(`
            SELECT Id, Application_Progress__c
            FROM Account_Document__c
            WHERE Account__c='${esc(accId)}'
              AND Document_Type__c='${esc(type)}'
              AND (Application_Progress__c='${esc(id)}' OR Application_Progress__c=null)
            ORDER BY Application_Progress__c NULLS LAST
            LIMIT 1
          `);
          if (q.totalSize > 0) {
            docId = q.records[0].Id;
          }
        }

        if (!docId) continue;

        const upd: { Id: string; Name?: string | null; Document_Link__c?: string | null } = { Id: docId };
        if (desiredName) upd.Name = desiredName;
        if (link) upd.Document_Link__c = link;

        if (upd.Name || upd.Document_Link__c) toUpdate.push(upd);
      }

      if (toUpdate.length) {
        const res = await conn.sobject("Account_Document__c").update(toUpdate);
        const failed = (res as Array<{ success: boolean; errors?: unknown[] }>).find((r) => !r.success);
        if (failed) {
          return NextResponse.json({ ok: false, error: "sf_update_failed" }, { status: 500 });
        }
      }

      return NextResponse.json({ ok: true });
    }

    case "siswa": {
      try {
        const opp = (await conn.sobject("Opportunity").retrieve(id)) as { Id?: string; AccountId?: string | null };
        const accountId = opp?.AccountId || null;
        if (!accountId) {
          return NextResponse.json({ ok: false, error: "no_account_on_opportunity" }, { status: 400 });
        }

        const src = (body as Extract<PatchBody, { segment: "siswa" }>).siswa || {};
        const updateBody: AccountUpdatePayload = { Id: accountId };

        const birth = normalizeBirthdate((src as Record<string, unknown>)["PersonBirthdate"]);
        if (birth) updateBody.PersonBirthdate = birth;

        if (typeof (src as Record<string, unknown>)["Phone"] === "string") {
          updateBody.Phone = String((src as Record<string, unknown>)["Phone"]).trim();
        }

        const updRes: SaveResult = await conn.sobject("Account").update(updateBody);
        if (!updRes.success) {
          return NextResponse.json({ ok: false, error: "sf_update_failed" }, { status: 500 });
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
        const opp = (await conn.sobject("Opportunity").retrieve(id)) as { Id?: string; AccountId?: string | null };
        const accountId = opp?.AccountId || null;
        if (!accountId) {
          return NextResponse.json({ ok: false, error: "no_account_on_opportunity" }, { status: 400 });
        }

        const acc = (await conn.sobject("Account").retrieve(accountId)) as { Id?: string; PersonContactId?: string | null };
        const studentContactId = acc?.PersonContactId || null;

        const items = (body as Extract<PatchBody, { segment: "orangTua" }>).orangTua;
        if (!Array.isArray(items)) {
          return NextResponse.json({ ok: false, error: "invalid_payload_orangTua" }, { status: 400 });
        }

        const normalizePhone = (raw?: string | null) =>
          (raw || "").replace(/[^\d+]/g, "").replace(/^0/, "+62");

        async function findExistingContact(email?: string | null, phone?: string | null) {
          const e = (email || "").trim();
          const p = normalizePhone(phone);
          if (!e && !p) return null;

          const where: string[] = [];
          if (e) where.push(`Email = '${esc(e)}'`);
          if (p) where.push(`Phone = '${esc(p)}'`);

          const q = `
            SELECT Id, LastName, Email, Phone
            FROM Contact
            WHERE (${where.join(" OR ")})
            ORDER BY LastModifiedDate DESC
            LIMIT 1
          `;
          const rows = await sfQuery<{ Id: string }>(q);
          return rows[0] ?? null;
        }

        for (const p of items) {
          const type = (p.type || "").trim();
          const name = (p.name || "").trim();
          if (!type || !name) continue;

          // Upsert Contact (orang tua)
          let contactId = p.contactId || null;

          if (!contactId) {
            const hit = await findExistingContact(p.email, p.phone);
            if (hit?.Id) contactId = hit.Id;
          }

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
            Phone: normalizePhone(p.phone),
            Email: (p.email || "").trim() || null,
            Address__c: (p.address || "").trim() || null,
          };

          if (contactId) {
            await conn.sobject("Contact").update({ Id: contactId, ...contactPayload });
          } else {
            const ins = await conn.sobject("Contact").insert(contactPayload);
            if (!ins.success) {
              return NextResponse.json({ ok: false, error: "contact_insert_failed" }, { status: 500 });
            }
            contactId = ins.id as string;
          }

          // Upsert Relationship__c
          const relBase: { Id?: string; Type__c: string; Contact__c: string; Related_Contact__c?: string } = {
            Type__c: type,
            Contact__c: contactId,
            ...(studentContactId ? { Related_Contact__c: studentContactId } : {}),
          };

          if (p.relationshipId) {
            await conn.sobject("Relationship__c").update({ Id: p.relationshipId, ...relBase });
          } else {
            const r = await conn.sobject("Relationship__c").insert(relBase);
            if (!r.success) {
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
