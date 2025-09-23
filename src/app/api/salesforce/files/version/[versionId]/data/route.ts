// src/app/api/salesforce/files/version/[versionId]/data/route.ts
import { NextResponse } from "next/server";
import { getConn } from "@/lib/salesforce/client";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ versionId: string }> }
) {
  try {
    // ✅ WAJIB: await params di Next 15
    const { versionId } = await params;
    if (!versionId) {
      return new NextResponse("Missing versionId", { status: 400 });
    }

    // Ambil koneksi jsforce yang sudah login
    const conn = await getConn();

    // Hit endpoint VersionData (binary) untuk ContentVersion tertentu
    const url = `${conn.instanceUrl}/services/data/v58.0/sobjects/ContentVersion/${encodeURIComponent(
      versionId
    )}/VersionData`;

    const resp = await fetch(url, {
      headers: {
        Authorization: `Bearer ${conn.accessToken}`,
      },
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return new NextResponse(
        `Salesforce error ${resp.status}: ${errText}`,
        { status: 502 }
      );
    }

    const contentType =
      resp.headers.get("content-type") || "application/octet-stream";
    const ab = await resp.arrayBuffer();

    // Return sebagai binary, inline supaya <img src=...> bisa render
    return new NextResponse(Buffer.from(ab), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=60",
        "Content-Disposition": "inline",
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return new NextResponse(`Internal error: ${msg}`, { status: 500 });
  }
}
