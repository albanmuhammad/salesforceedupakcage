import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sfQuery, sfGet } from "@/lib/salesforce/client";

type Progress = {
  Id: string;
  Name: string;
  Status__c: string;
  Contact__c: string;
};

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.email) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 }
    );
  }

  const id = params.id;

  // Ambil progress + Contact (pemilik)
  const [progress] = await sfQuery<Progress>(
    `SELECT Id, Name, Status__c, Contact__c
     FROM Application_Progress__c
     WHERE Id='${id}' LIMIT 1`
  );
  if (!progress) {
    return NextResponse.json(
      { ok: false, error: "not_found" },
      { status: 404 }
    );
  }

  // (Opsional) Validasi: pastikan email session cocok dengan Contact pemilik progress
  const [contact] = await sfQuery<{
    Id: string;
    Email: string;
    AccountId: string;
  }>(
    `SELECT Id, Email, AccountId FROM Contact WHERE Id='${progress.Contact__c}' LIMIT 1`
  );
  if (
    !contact ||
    contact.Email?.toLowerCase() !== session.user.email.toLowerCase()
  ) {
    return NextResponse.json(
      { ok: false, error: "forbidden" },
      { status: 403 }
    );
  }

  // Person Account = Account yang IsPersonAccount = true dan dihubungkan ke Contact
  const [account] = await sfQuery<{
    Id: string;
    Name: string;
    PersonEmail: string;
    PersonBirthdate: string;
  }>(
    `SELECT Id, Name, PersonEmail, PersonBirthdate
     FROM Account
     WHERE Id='${contact.AccountId}' LIMIT 1`
  );

  // Dokumen-dokumen (sesuaikan relasi di org kamu)
  const docs = await sfQuery<{
    Id: string;
    Name: string;
    Type__c: string;
    Url__c: string;
  }>(
    `SELECT Id, Name, Type__c, Url__c
     FROM Application_Document__c
     WHERE Application_Progress__c='${progress.Id}'
     ORDER BY CreatedDate DESC`
  );

  return NextResponse.json({
    ok: true,
    data: {
      progress,
      siswa: account, // data siswa dari Person Account
      orangTua: null, // kalau ada objek Parent__c, query di sini
      dokumen: docs,
    },
  });
}
