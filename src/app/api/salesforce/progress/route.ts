// app/api/salesforce/progress/route.ts
import { NextResponse } from "next/server";
import { createClientFromRequest } from "@/lib/supabase/server";
import { sfQuery } from "@/lib/salesforce/client";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export async function GET(req: Request) {
  const traceId = Date.now().toString(36);
  console.log(`[progress][${traceId}] HIT /api/salesforce/progress`);

  const emailFromHeader = req.headers.get("x-user-email");

  const fetchByEmail = async (email: string) => {
    const emailEsc = (email || "").replace(/'/g, "\\'");

    // 1) Cari Person Account langsung by PersonEmail
    const qAcc1 = `
      SELECT Id, Name, IsPersonAccount, PersonEmail
      FROM Account
      WHERE IsPersonAccount = true
        AND PersonEmail = '${emailEsc}'
      LIMIT 1
    `;
    let accs = await sfQuery<{ Id: string; Name: string }>(qAcc1);

    // 2) Fallback: via Contact.Email
    if (!accs.length) {
      const qAcc2 = `
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
      accs = await sfQuery(qAcc2);
    }

    if (!accs.length) return { applicantName: "", items: [] as any[] };

    const accountId = accs[0].Id;
    const applicantName = accs[0].Name;

    // === Ambil Opportunity + lookup names ===
    const qOpp = `
      SELECT
        Id, Name, StageName, CreatedDate, AccountId, CloseDate, Amount,
        Campus__c,            Campus__r.Name,
        Study_Program__c,     Study_Program__r.Name,
        Test_Schedule__c
      FROM Opportunity
      WHERE AccountId = '${accountId}'
      ORDER BY CreatedDate DESC
    `;
    const items = await sfQuery(qOpp);
    return { applicantName, items };
  };

  try {
    if (emailFromHeader) {
      const { applicantName, items } = await fetchByEmail(emailFromHeader);
      return NextResponse.json({ ok: true, applicantName, items, traceId });
    }

    // Fallback: baca session Supabase dari request
    const supabase = createClientFromRequest(req);
    const { data: { session }, error: sErr } = await supabase.auth.getSession();
    if (sErr) console.log(`[progress][${traceId}] session error:`, sErr);
    const email = session?.user?.email;

    if (!email) {
      return NextResponse.json({ ok: false, error: "unauthorized", traceId }, { status: 401 });
    }

    const { applicantName, items } = await fetchByEmail(email);
    return NextResponse.json({ ok: true, applicantName, items, traceId });
  } catch (err: any) {
    console.error(`[progress][${traceId}] ERROR:`, err?.message || err);
    return NextResponse.json({ ok: false, error: "internal_error", traceId }, { status: 500 });
  }
}
