import { NextResponse } from "next/server";
import { getConn } from "@/lib/salesforce/client";

const API_VER = "v59.0";

export async function GET(
  req: Request,
  { params }: { params: { versionId: string } }
) {
  const { versionId } = params;
  const u = new URL(req.url);
  const width = u.searchParams.get("width") || "256";
  const scale = u.searchParams.get("scale") || "1";

  try {
    const conn = await getConn();
    const url = `${conn.instanceUrl}/services/data/${API_VER}/sobjects/ContentVersion/${versionId}/thumbnail?scale=${encodeURIComponent(
      scale
    )}&width=${encodeURIComponent(width)}`;

    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${conn.accessToken}` },
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      return new NextResponse(`SF thumb error ${resp.status}: ${text}`, { status: resp.status });
    }

    const arrayBuf = await resp.arrayBuffer();
    const contentType = resp.headers.get("content-type") || "image/jpeg";

    const headers = new Headers();
    headers.set("Content-Type", contentType);
    headers.set("Cache-Control", "public, max-age=1800, s-maxage=1800");

    return new NextResponse(Buffer.from(arrayBuf), { status: 200, headers });
  } catch (e: any) {
    return new NextResponse(`Thumb proxy failed: ${e?.message || "unknown error"}`, { status: 500 });
  }
}
