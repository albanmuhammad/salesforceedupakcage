// src/app/api/salesforce/upload/route.ts
import { NextResponse } from "next/server";
import type { Connection, QueryResult } from "jsforce";
import { getConn } from "@/lib/salesforce/client";

type Body = {
  accId: string;
  oppId: string;
  progressName: string;
  base64: string;
  filename: string;
  mime: string;
  documentType: string;
};

function extFromMime(m: string): string {
  return m === "image/png" ? "png" : "jpg";
}

async function safeCreateCDL(
  conn: Connection,
  contentDocumentId: string,
  linkedId: string
): Promise<void> {
  try {
    const exists: QueryResult<{ Id: string }> = await conn.query(`
      SELECT Id FROM ContentDocumentLink
      WHERE ContentDocumentId='${contentDocumentId}'
        AND LinkedEntityId='${linkedId}'
      LIMIT 1
    `);

    if (exists.totalSize > 0) return;

    await conn.sobject("ContentDocumentLink").create({
      ContentDocumentId: contentDocumentId,
      LinkedEntityId: linkedId,
      ShareType: "V",
      Visibility: "AllUsers",
    });
  } catch {
    // ignore
  }
}

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const json = (await req.json()) as Body;
    const { accId, oppId, progressName, base64, filename, mime, documentType } =
      json;

    if (!accId || !oppId || !base64 || !filename || !mime || !documentType) {
      return NextResponse.json(
        { success: false, message: "Missing required parameters" },
        { status: 400 }
      );
    }

    const conn = await getConn();
    const ext = (filename.split(".").pop() || extFromMime(mime)).toLowerCase();
    const titleBase = `${documentType}_${progressName || "Tanpa Nama"}`.trim();

    // === Ensure Account_Document__c (same as your code) ===
    const existing = await conn.query<{
      Id: string;
      Name: string;
      Application_Progress__c?: string | null;
    }>(`
      SELECT Id, Name, Application_Progress__c
      FROM Account_Document__c
      WHERE Account__c='${accId}'
        AND Document_Type__c='${documentType}'
        AND (Application_Progress__c='${oppId}' OR Application_Progress__c = NULL)
      ORDER BY Application_Progress__c NULLS LAST
      LIMIT 1
    `);

    let docRecId: string;
    if (existing.totalSize > 0) {
      docRecId = existing.records[0].Id;
    } else {
      const created = await conn.sobject("Account_Document__c").create({
        Account__c: accId,
        Application_Progress__c: oppId,
        Document_Type__c: documentType,
        Verified__c: false,
        Name: `${documentType} ${(progressName || "").trim()}`.trim(),
      });
      if (!created.success)
        throw new Error("Gagal membuat Account_Document__c");
      docRecId = created.id as string;
    }

    // === Try to REUSE existing ContentDocument (versioning) ===
    const cdl = await conn.query<{ ContentDocumentId: string }>(`
      SELECT ContentDocumentId
      FROM ContentDocumentLink
      WHERE LinkedEntityId='${docRecId}'
      LIMIT 1
    `);

    let contentDocumentId: string | null =
      cdl.records?.[0]?.ContentDocumentId || null;

    if (contentDocumentId) {
      // ---- Create a NEW VERSION on the SAME ContentDocument ----
      const cvCreate = await conn.sobject("ContentVersion").create({
        Title: titleBase,
        PathOnClient: `${titleBase}.${ext}`,
        VersionData: base64,
        ContentDocumentId: contentDocumentId, // <-- key to versioning
      });
      if (!cvCreate.success)
        throw new Error("Gagal membuat versi baru (ContentVersion)");
    } else {
      // ---- No existing doc linked: create a fresh ContentDocument ----
      const cvCreate = await conn.sobject("ContentVersion").create({
        Title: titleBase,
        PathOnClient: `${titleBase}.${ext}`,
        VersionData: base64,
        FirstPublishLocationId: oppId, // publish to Opportunity
      });
      if (!cvCreate.success) throw new Error("Gagal membuat ContentVersion");

      const cvRow = await conn.query<{ ContentDocumentId: string }>(`
        SELECT ContentDocumentId
        FROM ContentVersion
        WHERE Id = '${cvCreate.id}'
        LIMIT 1
      `);
      contentDocumentId = cvRow.records?.[0]?.ContentDocumentId || null;
      if (!contentDocumentId)
        throw new Error("Tidak menemukan ContentDocumentId");
    }

    // ---- Make sure it’s linked where we need it ----
    await safeCreateCDL(conn, contentDocumentId!, accId);
    await safeCreateCDL(conn, contentDocumentId!, oppId);
    await safeCreateCDL(conn, contentDocumentId!, docRecId);

    // ---- Normalize titles (optional but nice) ----
    await conn
      .sobject("ContentDocument")
      .update({ Id: contentDocumentId!, Title: titleBase });
    const latestCvQuery = await conn.query<{ Id: string }>(`
  SELECT Id
  FROM ContentVersion
  WHERE ContentDocumentId='${contentDocumentId}'
  ORDER BY VersionNumber DESC
  LIMIT 1
`);

    const latestVersionId = latestCvQuery.records?.[0]?.Id;
    const documentLink = `/lightning/r/ContentDocument/${contentDocumentId}/view`; // fallback

    await conn.sobject("Account_Document__c").update({
      Id: docRecId,
      Verified__c: false,
      Document_Link__c: documentLink, // ← Link ke versi terbaru
      Name: `${documentType} ${(progressName || "").trim()}`.trim(),
    });

    return NextResponse.json({
      success: true,
      contentDocumentId,
      contentVersionId: latestVersionId,
      accountDocumentId: docRecId,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("upload ERR:", err);
    return NextResponse.json({ success: false, message: msg }, { status: 500 });
  }
}
