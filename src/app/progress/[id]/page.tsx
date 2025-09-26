import { cookies } from "next/headers";

type ApiDoc = {
  Id: string;
  Name: string;
  Type__c?: string | null;
  Url__c?: string | null;
};

type ApiPayment = {
  Id: string;
  Name: string;
  Amount__c?: number | null;
  Payment_Status__c?: string | null;
  Virtual_Account_No__c?: string | null;
  Payment_Channel__r?: { Payment_Channel_Bank__c?: string | null } | null;
  Payment_For__c?: string | null;
};

type ApiData = {
  progress: { Id: string; Name: string; Status__c?: string | null };
  siswa: Record<string, unknown>;
  orangTua?: Record<string, unknown> | null;
  dokumen?: ApiDoc[] | null;
  photoVersionId?: string | null;
  payments?: ApiPayment[] | null;
};

type ClientDoc = {
  Id?: string;
  Name?: string;
  Type__c?: string | null;
  Url__c?: string | null;
  Document_Type__c?: string | null;
  Document_Link__c?: string | null;
};

type ClientProps = {
  id: string;
  siswa: Record<string, unknown>;
  orangTua: Record<string, unknown>;
  dokumen: ClientDoc[];
  apiBase: string;
  cookieHeader: string;
  photoVersionId: string | null;
  payments: ApiPayment[]; // NEW
};

export default async function ProgressDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const cookieHeader = (await cookies())
    .getAll()
    .map((c) => `${c.name}=${encodeURIComponent(c.value)}`)
    .join("; ");

  const base = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
  const res = await fetch(`${base}/api/salesforce/progress/${id}`, {
    cache: "no-store",
    headers: { cookie: cookieHeader },
  });

  if (!res.ok) {
    return (
      <div className="p-6">Error: gagal memuat data (HTTP {res.status})</div>
    );
  }

  const json = (await res.json()) as {
    ok: boolean;
    error?: string;
    data?: ApiData;
  };

  if (!json.ok || !json.data) {
    return <div className="p-6">Error: {json.error || "Unknown error"}</div>;
  }

  const { progress, siswa, orangTua, dokumen, photoVersionId, payments } = json.data;

  return (
    <main className="min-h-screen flex justify-center bg-gradient-to-r from-blue-400 via-blue-500 to-blue-600 p-6">
      <div className="w-full max-w-7xl">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold text-white drop-shadow-sm">
            {progress.Name}
          </h1>
        </header>

        <ProgressClient
          id={progress.Id}
          siswa={siswa}
          orangTua={orangTua ?? {}}
          dokumen={(dokumen ?? []) as ClientDoc[]}
          apiBase={base}
          cookieHeader={cookieHeader}
          photoVersionId={photoVersionId ?? null}
          payments={(payments ?? []) as ApiPayment[]}
        />
      </div>
    </main>
  );
}

// Dynamic import dengan props bertipe ketat (tanpa any)
async function ProgressClient(props: ClientProps) {
  const Mod = await import("@/app/progress/[id]/_client/ProgressDetailClient");
  const C = Mod.default;
  return <C {...props} />;
}
