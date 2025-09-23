// app/progress/[id]/page.tsx
import { cookies } from "next/headers";

type Dokumen = {
    Id: string;
    Name: string;
    Type__c?: string | null;
    Url__c?: string | null;
};

type ProgressClientProps = {
    id: string;
    siswa: Record<string, unknown>;
    orangTua: Record<string, unknown>;
    dokumen: Dokumen[];
    apiBase: string;
    cookieHeader: string;
};

export default async function ProgressDetail({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id } = await params;

    const cookieStore = await cookies();
    const cookieHeader = cookieStore
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
        data?: {
            progress: { Id: string; Name: string; Status__c?: string | null };
            siswa: Record<string, unknown>;
            orangTua?: Record<string, unknown> | null;
            dokumen?: Dokumen[] | null;
        };
    };

    if (!json.ok || !json.data) {
        return <div className="p-6">Error: {json.error || "Unknown error"}</div>;
    }

    const { progress, siswa, orangTua, dokumen } = json.data;

    return (
        <main className="min-h-screen flex justify-center bg-gradient-to-r from-blue-400 via-blue-500 to-blue-600 p-6">
            <div className="w-full max-w-7xl">
                <header className="mb-6">
                    <h1 className="text-2xl font-semibold text-white drop-shadow-sm">
                        {progress.Name}
                    </h1>
                    <div className="text-sm text-blue-50">
                        Status: {progress.Status__c || "—"}
                    </div>
                </header>

                <ProgressClient
                    id={progress.Id}
                    siswa={siswa}
                    orangTua={orangTua ?? {}}
                    dokumen={dokumen ?? []}
                    apiBase={base}
                    cookieHeader={cookieHeader}
                />
            </div>
        </main>
    );
}

// dynamic import of client component
async function ProgressClient(props: ProgressClientProps) {
    const Mod = await import("@/app/progress/[id]/_client/ProgressDetailClient");
    const C = Mod.default;
    return <C {...props} />;
}
