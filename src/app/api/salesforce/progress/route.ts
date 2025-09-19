import { NextResponse } from "next/server";
import { createClientFromRequest } from "@/lib/supabase/server";
import { sfQuery } from "@/lib/salesforce/client";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export async function GET(req: Request) {
  const traceId = Date.now().toString(36);
  console.log(`[progress][${traceId}] HIT /api/salesforce/progress`);

  // First try to get email from headers (set by middleware)
  const emailFromHeader = req.headers.get("x-user-email");
  const userIdFromHeader = req.headers.get("x-user-id");

  console.log(`[progress][${traceId}] Email from header:`, emailFromHeader);
  console.log(`[progress][${traceId}] User ID from header:`, userIdFromHeader);

  if (emailFromHeader) {
    // If we have email from middleware, use it directly
    const email = emailFromHeader;
    console.log(`[progress][${traceId}] Using email from middleware:`, email);

    try {
      // Continue with Salesforce logic using the email from middleware
      const emailEsc = (email || "").replace(/'/g, "\\'");

      // 1) Langsung via PersonEmail
      const soqlAccByPersonEmail = `
      SELECT Id, Name, IsPersonAccount, PersonEmail
      FROM Account
      WHERE IsPersonAccount = true
        AND PersonEmail = '${emailEsc}'
      LIMIT 1
    `;

      let accounts = await sfQuery<{
        Id: string;
        Name: string;
        IsPersonAccount: boolean;
        PersonEmail: string | null;
      }>(soqlAccByPersonEmail);

      if (!accounts.length) {
        // 2) Fallback: semi-join via Contact (TOP-LEVEL, tanpa OR)
        const soqlAccByContact = `
        SELECT Id, Name, IsPersonAccount, PersonEmail
        FROM Account
        WHERE IsPersonAccount = true
          AND Id IN (
            SELECT AccountId
            FROM Contact
            WHERE Email = '${emailEsc}'
          )
        LIMIT 1
      `;
        accounts = await sfQuery(soqlAccByContact);
      }

      if (!accounts.length) {
        return NextResponse.json({ ok: true, items: [], traceId });
      }

      const accountId = accounts[0].Id;

      // Lanjut ambil Opportunity
      const soqlOpp = `
      SELECT Id, Name, StageName, CreatedDate, AccountId, CloseDate, Amount
      FROM Opportunity
      WHERE AccountId = '${accountId}'
      ORDER BY CreatedDate DESC
    `;
      const opps = await sfQuery(soqlOpp);

      return NextResponse.json({ ok: true, items: opps, traceId });
    } catch (err: any) {
      console.error(`[progress][${traceId}] ERROR:`, err?.message || err);
      return NextResponse.json(
        { ok: false, error: "internal_error", traceId },
        { status: 500 }
      );
    }
  }

  // Fallback: try to get session from Supabase client
  console.log(
    `[progress][${traceId}] No email from header, trying Supabase client`
  );

  // Debug request headers
  console.log(
    `[progress][${traceId}] Cookie header:`,
    req.headers.get("cookie")
  );

  try {
    // Use the special API client that reads from request headers
    const supabase = createClientFromRequest(req);

    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();

    console.log(
      `[progress][${traceId}] session:`,
      !!session,
      "email:",
      session?.user?.email
    );
    if (sessionError) {
      console.log(`[progress][${traceId}] session error:`, sessionError);
    }

    const email = session?.user?.email;

    if (!email) {
      console.warn(`[progress][${traceId}] unauthorized: no email`);
      return NextResponse.json(
        { ok: false, error: "unauthorized", traceId },
        { status: 401 }
      );
    }

    // Rest of your Salesforce logic...
    const emailEsc = (email || "").replace(/'/g, "\\'");

    // 1) Langsung via PersonEmail
    const soqlAccByPersonEmail = `
      SELECT Id, Name, IsPersonAccount, PersonEmail
      FROM Account
      WHERE IsPersonAccount = true
        AND PersonEmail = '${emailEsc}'
      LIMIT 1
    `;

    let accounts = await sfQuery<{
      Id: string;
      Name: string;
      IsPersonAccount: boolean;
      PersonEmail: string | null;
    }>(soqlAccByPersonEmail);

    if (!accounts.length) {
      // 2) Fallback: semi-join via Contact (TOP-LEVEL, tanpa OR)
      const soqlAccByContact = `
        SELECT Id, Name, IsPersonAccount, PersonEmail
        FROM Account
        WHERE IsPersonAccount = true
          AND Id IN (
            SELECT AccountId
            FROM Contact
            WHERE Email = '${emailEsc}'
          )
        LIMIT 1
      `;
      accounts = await sfQuery(soqlAccByContact);
    }

    if (!accounts.length) {
      return NextResponse.json({ ok: true, items: [], traceId });
    }

    const accountId = accounts[0].Id;

    // Lanjut ambil Opportunity
    const soqlOpp = `
      SELECT Id, Name, StageName, CreatedDate, AccountId, CloseDate, Amount
      FROM Opportunity
      WHERE AccountId = '${accountId}'
      ORDER BY CreatedDate DESC
    `;
    const opps = await sfQuery(soqlOpp);

    return NextResponse.json({ ok: true, items: opps, traceId });
  } catch (err: any) {
    console.error(`[progress][${traceId}] ERROR:`, err?.message || err);
    return NextResponse.json(
      { ok: false, error: "internal_error", traceId },
      { status: 500 }
    );
  }
}
