// app/api/salesforce/progress/route.ts
import { NextResponse } from "next/server";
import { createClientFromRequest } from "@/lib/supabase/server";
import { sfQuery } from "@/lib/salesforce/client";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

type AccountRow = {
  Id: string;
  Name: string;
  IsPersonAccount?: boolean;
  PersonEmail?: string | null;
};

type OpportunityRow = {
  Id: string;
  Name: string;
  StageName: string;
  CreatedDate: string;
  AccountId: string;
  CloseDate?: string | null;
  Amount?: number | null;
  Is_Active__c: boolean;
  Campus__c?: string | null;
  Campus__r?: { Name?: string | null } | null;
  RecordType?: { Name?: string | null } | null;
  Study_Program__c?: string | null;
  Study_Program__r?: { Name?: string | null } | null;
  Test_Schedule__c?: string | null;
  Master_Metro_School__c?: string | null;
  Master_Metro_School__r?: { Name?: string | null } | null;
  Major__c?: string | null;
  Major__r?: { Name?: string | null } | null;
};

export async function GET(req: Request) {
  const traceId = Date.now().toString(36);
  console.log(`[progress][${traceId}] HIT /api/salesforce/progress`);

  const emailFromHeader = req.headers.get("x-user-email");

  const fetchByEmail = async (email: string) => {
    // escape single quotes untuk SOQL
    const emailEsc = (email || "").replace(/'/g, "\\'");

    // 1) Cari Person Account langsung by PersonEmail
    const qAcc1 = `
      SELECT Id, Name, IsPersonAccount, PersonEmail
      FROM Account
      WHERE IsPersonAccount = true
        AND PersonEmail = '${emailEsc}'
      LIMIT 1
    `;
    const accs = await sfQuery<AccountRow>(qAcc1);

    if (!accs.length) {
      return { applicantName: "", items: [] as OpportunityRow[] };
    }

    const accountId = accs[0].Id;
    const applicantName = accs[0].Name;

    // === Ambil Opportunity + lookup names ===
    const qOpp = `
      SELECT
        Id, Name, StageName, CreatedDate, AccountId, CloseDate, Amount, Is_Active__c,
        Campus__c,            Campus__r.Name,
        Study_Program__c,     Study_Program__r.Name, 
        Test_Schedule__c,     RecordType.Name, Master_Metro_School__c, Master_Metro_School__r.Name, Major__c, Major__r.Name
      FROM Opportunity
      WHERE AccountId = '${accountId}'
      ORDER BY CreatedDate DESC
    `;
    const rows = await sfQuery<OpportunityRow>(qOpp);

    // Flatten RecordType.Name -> RecordType_Name langsung di sini
    const items = rows.map((r) => ({
      ...r,
      RecordType_Name: r.RecordType?.Name ?? null,
    }));

    return { applicantName, items };
  };

  try {
    if (emailFromHeader) {
      const { applicantName, items } = await fetchByEmail(emailFromHeader);
      return NextResponse.json({ ok: true, applicantName, items, traceId });
    }

    // Fallback: baca session Supabase dari request
    const supabase = createClientFromRequest(req);
    const {
      data: { session },
      error: sErr,
    } = await supabase.auth.getSession();
    if (sErr) console.log(`[progress][${traceId}] session error:`, sErr);
    const email = session?.user?.email;

    if (!email) {
      return NextResponse.json(
        { ok: false, error: "unauthorized", traceId },
        { status: 401 }
      );
    }

    const { applicantName, items } = await fetchByEmail(email);
    return NextResponse.json({ ok: true, applicantName, items, traceId });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[progress][${traceId}] ERROR:`, msg);
    return NextResponse.json(
      { ok: false, error: "internal_error", traceId },
      { status: 500 }
    );
  }
}
