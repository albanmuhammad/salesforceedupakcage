import { NextResponse } from "next/server";
import { getConn } from "@/lib/salesforce/client"; // pastikan function ini ada

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: { versionId: string } }
) {
  try {
    const { versionId } = params;
    if (!versionId) {
      return new NextResponse("Missing versionId", { status: 400 });
    }

    const conn = await getConn();
    const url = `${conn.instanceUrl}/services/data/v59.0/sobjects/ContentVersion/${encodeURIComponent(
      versionId
    )}/VersionData`;

    const sfRes = await fetch(url, {
      headers: { Authorization: `Bearer ${conn.accessToken}` },
    });

    if (!sfRes.ok || !sfRes.body) {
      const txt = await sfRes.text().catch(() => "");
      return new NextResponse(txt || "Failed to fetch VersionData", {
        status: sfRes.status || 502,
      });
    }

    // Teruskan stream & header yang penting
    const contentType = sfRes.headers.get("content-type") ?? "application/octet-stream";
    const contentLength = sfRes.headers.get("content-length") ?? undefined;
    const headers: Record<string, string> = {
      "content-type": contentType,
      "cache-control": "private, max-age=60",
    };
    if (contentLength) headers["content-length"] = contentLength;

    return new NextResponse(sfRes.body, { headers });
  } catch (e: any) {
    return new NextResponse(e?.message || "Proxy error", { status: 500 });
  }
}
