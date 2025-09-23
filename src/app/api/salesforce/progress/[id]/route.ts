import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sfQuery } from "@/lib/salesforce/client";

// ==== Types ====
type Progress = {
  Id: string;
  Name: string;
  StageName: string;
  AccountId: string | null;
};

type AccountInfo = {
  Id: string;
  Name: string;
  PersonEmail?: string | null;
  PersonBirthdate?: string | null;
  IsPersonAccount?: boolean;
  PersonContactId?: string | null;
};

type DocRow = {
  Id: string;
  Name: string;
  Document_Type__c: string | null;
  Document_Link__c: string | null;
};

type CDLRow = {
  ContentDocumentId: string; // 069...
  LinkedEntityId: string;
  ContentDocument: {
    Title: string;
    LatestPublishedVersionId: string; // 068...
  };
};

type VersionRow = {
  Id: string;                // 068...
  ContentDocumentId: string; // 069...
  IsLatest: boolean;
};

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const traceId = `p-${Date.now().toString(36)}`;
  const url = new URL(req.url);
  const debug = url.searchParams.get("debug") === "1";

  const supabase = await createClient();
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user?.email) {
    console.log(`[${traceId}] unauthorized or no email`, { userErr });
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const userEmail = userData.user.email.toLowerCase();

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
    console.log(`[${traceId}] not_found: Opportunity ${id}`);
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }
  console.log(`[${traceId}] progress found`, {
    oppId: progress.Id,
    oppName: progress.Name,
    accountId: progress.AccountId,
  });

  // 2) Validasi akses + ambil Account minimal
  let allowed = false;
  let siswaAccount: AccountInfo | null = null;

  if (progress.AccountId) {
    const accRows = await sfQuery<AccountInfo>(`
      SELECT Id, Name, PersonEmail, PersonBirthdate, IsPersonAccount, PersonContactId
      FROM Account
      WHERE Id='${progress.AccountId}'
      LIMIT 1
    `);
    const account: AccountInfo | null = accRows[0] ?? null;

    console.log(`[${traceId}] account lookup`, {
      found: !!account,
      accountId: account?.Id,
      personEmail: account?.PersonEmail,
      isPerson: account?.IsPersonAccount,
      personContactId: account?.PersonContactId,
    });

    if (account) {
      siswaAccount = account;

      if (account.IsPersonAccount) {
        const personEmail = (account.PersonEmail || "").toLowerCase();
        if (personEmail && personEmail === userEmail) {
          allowed = true;
          console.log(`[${traceId}] access ok via Account.PersonEmail`);
        } else if (account.PersonContactId) {
          const cRows = await sfQuery<{ Id: string; Email?: string | null }>(`
            SELECT Id, Email
            FROM Contact
            WHERE Id='${account.PersonContactId}'
            LIMIT 1
          `);
          const personContact = cRows[0] ?? null;
          console.log(`[${traceId}] personContact lookup`, {
            found: !!personContact,
            contactId: personContact?.Id,
            contactEmail: personContact?.Email,
          });
          if ((personContact?.Email || "").toLowerCase() === userEmail) {
            allowed = true;
            console.log(`[${traceId}] access ok via PersonContact.Email`);
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
    console.log(`[${traceId}] OCR count: ${roles.length}`);

    ocrContacts = roles.map(r => r.ContactId).filter(Boolean);

    const primaryOrFirst = roles.find(r => r.IsPrimary) || roles[0];
    if (primaryOrFirst?.ContactId) {
      console.log(`[${traceId}] OCR chosen`, {
        roleId: primaryOrFirst.Id,
        contactId: primaryOrFirst.ContactId,
        isPrimary: primaryOrFirst.IsPrimary,
      });

      const cRows = await sfQuery<{ Id: string; Email?: string | null }>(`
        SELECT Id, Email
        FROM Contact
        WHERE Id='${primaryOrFirst.ContactId}'
        LIMIT 1
      `);
      const c = cRows[0] ?? null;
      console.log(`[${traceId}] OCR contact`, { contactEmail: c?.Email });

      if ((c?.Email || "").toLowerCase() === userEmail) {
        allowed = true;
        console.log(`[${traceId}] access ok via OCR.Contact.Email`);
      }
    }
  }

  if (!allowed) {
    console.log(`[${traceId}] FORBIDDEN for ${userEmail}`);
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  // 3) Dokumen (custom object)
  const rawDocs = await sfQuery<DocRow>(`
    SELECT Id, Name, Document_Type__c, Document_Link__c
    FROM Account_Document__c
    WHERE Application_Progress__c='${progress.Id}'
    ORDER BY CreatedDate DESC
  `);

  console.log(`[${traceId}] account documents count: ${rawDocs.length}`);

  const docs = rawDocs.map(d => ({
    Id: d.Id,
    Name: d.Name,
    Type__c: d.Document_Type__c ?? null,
    Url__c: d.Document_Link__c ?? null,
  }));

  // 4) LUASKAN: cari file di Opportunity, Account, dan semua Contact
  const candidateIds = new Set<string>();
  candidateIds.add(progress.Id);
  if (progress.AccountId) candidateIds.add(progress.AccountId);
  ocrContacts.forEach(cid => cid && candidateIds.add(cid));

  const idList = Array.from(candidateIds);
  console.log(`[${traceId}] file candidate LinkedEntityIds:`, idList);

  let cdl: CDLRow[] = [];
  if (idList.length) {
    const inList = idList.map(s => `'${s}'`).join(",");
    cdl = await sfQuery<CDLRow>(`
      SELECT
        ContentDocumentId,
        LinkedEntityId,
        ContentDocument.Title,
        ContentDocument.LatestPublishedVersionId
      FROM ContentDocumentLink
      WHERE LinkedEntityId IN (${inList})
      ORDER BY SystemModstamp DESC
      LIMIT 50
    `);
  }

  console.log(`[${traceId}] CDL count (expanded) = ${cdl.length}`);
  if (cdl.length) {
    console.log(`[${traceId}] some CDL`, cdl.slice(0, 5).map(r => ({
      led: r.LinkedEntityId,
      title: r.ContentDocument.Title,
      ver: r.ContentDocument.LatestPublishedVersionId,
    })));
  }

  // Pilih judul mengandung "pas foto", kalau tidak ada ambil entry terbaru
  const photo =
    cdl.find(x => (x.ContentDocument.Title || "").toLowerCase().includes("pas foto")) ||
    cdl[0];

  let photoVersionId: string | null = photo?.ContentDocument.LatestPublishedVersionId || null;

  // (opsional) fallback pastikan latest via ContentVersion
  if (!photoVersionId && cdl.length) {
    const docIds = cdl.map(r => `'${r.ContentDocumentId}'`).join(",");
    const versions = await sfQuery<VersionRow>(`
      SELECT Id, ContentDocumentId, IsLatest
      FROM ContentVersion
      WHERE ContentDocumentId IN (${docIds})
      AND IsLatest = true
      ORDER BY Id DESC
      LIMIT 1
    `);
    console.log(`[${traceId}] fallback versions count: ${versions.length}`);
    photoVersionId = versions[0]?.Id ?? null;
  }

  console.log(`[${traceId}] chosen photoVersionId:`, photoVersionId);

  const debugPayload = debug
    ? {
        debug: {
          linkedEntityIds: idList,
          cdl: cdl.map(r => ({
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
      orangTua: null,
      dokumen: docs,
      photoVersionId, // dipakai UI <img src="/api/salesforce/files/version/{id}/data">
      ...debugPayload,
    },
  });
}
