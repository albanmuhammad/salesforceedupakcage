import { NextResponse } from "next/server";
import { getConn } from "@/lib/salesforce/client"; // pastikan diexport

const API_VER = "v59.0";

export async function GET(
  _req: Request,
  { params }: { params: { versionId: string } }
) {
  const { versionId } = params;

  try {
    const conn = await getConn();
    const url = `${conn.instanceUrl}/services/data/${API_VER}/sobjects/ContentVersion/${versionId}/VersionData`;

    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${conn.accessToken}` },
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      return new NextResponse(`SF error ${resp.status}: ${text}`, { status: resp.status });
    }

    const arrayBuf = await resp.arrayBuffer();
    const contentType = resp.headers.get("content-type") || "application/octet-stream";

    const headers = new Headers();
    headers.set("Content-Type", contentType);
    headers.set("Cache-Control", "public, max-age=3600, s-maxage=3600");

    return new NextResponse(Buffer.from(arrayBuf), { status: 200, headers });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return new NextResponse(`Thumb proxy failed: ${message}`, { status: 500 });
  }
}
