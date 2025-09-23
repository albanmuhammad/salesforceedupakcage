import { NextResponse } from "next/server";
import { getConn } from "@/lib/salesforce/client";
import type { QueryResult } from "jsforce";

// request body yang diterima
type UploadBody = {
  filename: string;
  base64: string; // base64 raw tanpa prefix "data:...;base64,"
  relateToId: string; // wajib → biasanya Opportunity Id (Application Progress)
  accountId?: string; // opsional → kalau object Account_Document__c punya lookup ke Account
  documentType: string; // wajib → contoh: "Pas Foto 3x4"
};

function soqlEscape(str = "") {
  return String(str).replace(/'/g, "\\'");
}

export async function POST(req: Request) {
  try {
    const { filename, base64, relateToId, accountId, documentType } =
      (await req.json()) as UploadBody;

    if (!filename || !base64 || !relateToId || !documentType) {
      return NextResponse.json(
        {
          ok: false,
          error: "filename, base64, relateToId & documentType required",
        },
        { status: 400 }
      );
    }

    const conn = await getConn();

    // 1) Buat ContentVersion
    const cvRes = await conn.sobject("ContentVersion").create({
      Title: filename.replace(/\.[^.]+$/, ""),
      PathOnClient: filename,
      VersionData: base64,
      FirstPublishLocationId: relateToId, // publish langsung ke Opportunity
    });

    if (!cvRes.success) {
      const msg =
        Array.isArray(cvRes.errors) && cvRes.errors[0]?.message
          ? cvRes.errors[0].message
          : "ContentVersion create failed";
      return NextResponse.json({ ok: false, error: msg }, { status: 500 });
    }

    // 2) Ambil ContentDocumentId dari versi
    const qRes: QueryResult<{ Id: string; ContentDocumentId: string }> =
      await conn.query(
        `SELECT Id, ContentDocumentId 
         FROM ContentVersion 
         WHERE Id='${soqlEscape(cvRes.id as string)}' 
         LIMIT 1`
      );
    const cv = qRes.records[0];
    const contentDocumentId = cv?.ContentDocumentId;
    if (!contentDocumentId) {
      return NextResponse.json(
        { ok: false, error: "ContentDocumentId not found" },
        { status: 500 }
      );
    }

    // 3) Shepherd URL untuk di-save di custom object
    const shepherdUrl = `${conn.instanceUrl}/sfc/servlet.shepherd/document/download/${contentDocumentId}`;

    // 4) Upsert Account_Document__c
    const qDoc = await conn.query<{ Id: string }>(
      `SELECT Id 
       FROM Account_Document__c 
       WHERE Application_Progress__c='${soqlEscape(relateToId)}'
         AND Document_Type__c='${soqlEscape(documentType)}'
       LIMIT 1`
    );

    let accountDocumentId: string;
    if (qDoc.totalSize > 0) {
      // update record existing
      accountDocumentId = qDoc.records[0].Id;
      await conn.sobject("Account_Document__c").update({
        Id: accountDocumentId,
        Document_Link__c: shepherdUrl,
        Verified__c: false,
      });
    } else {
      // insert baru
      const created = await conn.sobject("Account_Document__c").create({
        Application_Progress__c: relateToId,
        Account__c: accountId, // opsional
        Document_Type__c: documentType,
        Document_Link__c: shepherdUrl,
        Verified__c: false,
        Name: `${documentType} ${filename}`,
      });
      if (!created.success) {
        const errMsg =
          Array.isArray(created.errors) && created.errors[0]?.message
            ? created.errors[0].message
            : "Failed to create Account_Document__c";
        return NextResponse.json({ ok: false, error: errMsg }, { status: 500 });
      }
      accountDocumentId = created.id as string;
    }

    // 5) Link file juga ke record Account_Document__c (agar related list Files muncul)
    await conn
      .sobject("ContentDocumentLink")
      .create({
        ContentDocumentId: contentDocumentId,
        LinkedEntityId: accountDocumentId,
        ShareType: "V",
        Visibility: "AllUsers",
      })
      .catch(() => {
        /* abaikan duplicate CDL */
      });

    return NextResponse.json({
      ok: true,
      contentDocumentId,
      accountDocumentId,
      downloadUrl: shepherdUrl,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "upload failed";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
