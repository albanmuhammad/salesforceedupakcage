// src/app/api/salesforce/files/version/[versionId]/data/route.ts
import { NextResponse } from "next/server";
import { getConn } from "@/lib/salesforce/client";

export const dynamic = "force-dynamic";

function sanitizeFilename(name: string) {
  // Hilangkan karakter yang tidak aman untuk nama file
  return name.replace(/[\\/:*?"<>|]+/g, "_").trim() || "file";
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ versionId: string }> }
) {
  try {
    const { versionId } = await params;
    if (!versionId) {
      return new NextResponse("Missing versionId", { status: 400 });
    }

    const conn = await getConn();

    // 1) Ambil metadata ContentVersion agar bisa set filename & content-type
    const metaUrl = `${
      conn.instanceUrl
    }/services/data/v58.0/sobjects/ContentVersion/${encodeURIComponent(
      versionId
    )}?fields=Title,FileExtension,FileType,PathOnClient`;
    const metaResp = await fetch(metaUrl, {
      headers: { Authorization: `Bearer ${conn.accessToken}` },
    });

    if (!metaResp.ok) {
      const t = await metaResp.text();
      return new NextResponse(
        `Salesforce metadata error ${metaResp.status}: ${t}`,
        { status: 502 }
      );
    }

    const meta = (await metaResp.json()) as {
      Title?: string;
      FileExtension?: string;
      FileType?: string; // e.g. 'PDF'
      PathOnClient?: string; // original filename when uploaded (optional)
    };

    // Tentukan nama & ekstensi
    // === Nama file yang rapi ===
    const rawBaseFromPath = meta.PathOnClient?.split(/[\\/]/).pop() ?? ""; // terakhir setelah slash/backslash
    const baseFromPath = rawBaseFromPath.includes(".")
      ? rawBaseFromPath.split(".").slice(0, -1).join(".")
      : rawBaseFromPath;

    const baseName =
      (meta.Title && meta.Title.trim()) || baseFromPath || "file";

    const extFromPath = rawBaseFromPath.includes(".")
      ? rawBaseFromPath.split(".").pop()
      : undefined;

    const ext = (meta.FileExtension || extFromPath || "").replace(
      /[^a-zA-Z0-9]/g,
      ""
    ); // jaga-jaga
    const filenameRaw = ext ? `${baseName}.${ext}` : baseName;

    // ASCII-safe untuk filename (tanpa URL-encode)
    const asciiSafe = sanitizeFilename(filenameRaw);

    // RFC 5987 encode untuk filename*
    function encodeRFC5987(str: string) {
      return encodeURIComponent(str)
        .replace(/['()]/g, escape)
        .replace(/\*/g, "%2A");
    }
    const filenameStar = `UTF-8''${encodeRFC5987(filenameRaw)}`;

    // (opsional) map FileType → content-type
    const typeMap: Record<string, string> = {
      PDF: "application/pdf",
      PNG: "image/png",
      JPG: "image/jpeg",
      JPEG: "image/jpeg",
      GIF: "image/gif",
      CSV: "text/csv",
      TXT: "text/plain",
      DOC: "application/msword",
      DOCX: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      XLS: "application/vnd.ms-excel",
      XLSX: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      PPT: "application/vnd.ms-powerpoint",
      PPTX: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      MP4: "video/mp4",
      MP3: "audio/mpeg",
      ZIP: "application/zip",
    };
    const fallbackType = "application/octet-stream";
    const contentType =
      (meta.FileType && typeMap[meta.FileType.toUpperCase()]) || fallbackType;

    // 2) Ambil binary VersionData
    const binUrl = `${
      conn.instanceUrl
    }/services/data/v58.0/sobjects/ContentVersion/${encodeURIComponent(
      versionId
    )}/VersionData`;

    const resp = await fetch(binUrl, {
      headers: { Authorization: `Bearer ${conn.accessToken}` },
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return new NextResponse(`Salesforce error ${resp.status}: ${errText}`, {
        status: 502,
      });
    }

    // Forward stream/binary
    const ab = await resp.arrayBuffer();

    // ==== ⬇️ BAGIAN YANG DIUBAH: izinkan preview PDF + override via query param
    const url = new URL(_req.url);
    const forcedDisposition = url.searchParams.get("disposition"); // "inline" | "attachment" | null

    // Tipe yang aman untuk inline preview di browser/tab/iframe
    const inlineTypes = [
      /^image\//,
      /^video\//,
      /^text\//,
      /^application\/pdf$/,
    ];

    const isInlinePreviewable = inlineTypes.some((re) => re.test(contentType));

    const disposition =
      forcedDisposition === "inline"
        ? "inline"
        : forcedDisposition === "attachment"
        ? "attachment"
        : isInlinePreviewable
        ? "inline"
        : "attachment";
    // ==== ⬆️ END

    return new NextResponse(Buffer.from(ab), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(ab.byteLength),
        "Cache-Control": "private, max-age=60",
        // Jangan URL-encode di filename="..." ; sertakan filename* utk UTF-8
        "Content-Disposition": `${disposition}; filename="${asciiSafe}"; filename*=${filenameStar}`,
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return new NextResponse(`Internal error: ${msg}`, { status: 500 });
  }
}
