// app/progress/[id]/page.tsx
type Progress = {
    Id: string;
    Name: string;
    Status__c?: string | null;
};

type Siswa = Record<string, unknown>;     // bisa diganti ke field spesifik kalau sudah pasti
type OrangTua = Record<string, unknown>;  // sama seperti di atas

type Dokumen = {
    Id: string;
    Name: string;
    Type__c?: string | null;
    Url__c?: string | null;
};

type ApiResponse = {
    ok: boolean;
    error?: string;
    data?: {
        progress: Progress;
        siswa: Siswa;
        orangTua?: OrangTua | null;
        dokumen?: Dokumen[] | null;
    };
};

export default async function ProgressDetail({
    params,
}: { params: { id: string } }) {
    const base = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
    const res = await fetch(`${base}/api/salesforce/progress/${params.id}`, {
        cache: "no-store",
    });

    if (!res.ok) {
        return <div className="p-6">Error: gagal memuat data (HTTP {res.status})</div>;
    }

    const json: ApiResponse = await res.json();

    if (!json.ok || !json.data) {
        return <div className="p-6">Error: {json.error || "Unknown error"}</div>;
    }

    const { progress, siswa, orangTua, dokumen } = json.data;

    return (
        <main className="p-6 space-y-6">
            <section>
                <h1 className="text-2xl font-semibold">{progress.Name}</h1>
                <div className="text-sm text-gray-600">Status: {progress.Status__c || "—"}</div>
            </section>

            <section>
                <h2 className="text-xl font-semibold">Data Siswa (Person Account)</h2>
                <pre className="bg-gray-50 p-3 rounded border">
                    {JSON.stringify(siswa, null, 2)}
                </pre>
            </section>

            <section>
                <h2 className="text-xl font-semibold">Data Orang Tua</h2>
                <pre className="bg-gray-50 p-3 rounded border">
                    {JSON.stringify(orangTua ?? {}, null, 2)}
                </pre>
            </section>

            <section>
                <h2 className="text-xl font-semibold">Dokumen</h2>
                {!dokumen || dokumen.length === 0 ? (
                    <p>Belum ada dokumen.</p>
                ) : (
                    <ul className="space-y-2">
                        {dokumen.map((d) => (
                            <li key={d.Id} className="border rounded p-3">
                                <div className="font-medium">{d.Name}</div>
                                <div className="text-sm text-gray-600">Type: {d.Type__c || "—"}</div>
                                {d.Url__c && (
                                    <a
                                        className="underline text-sm"
                                        href={d.Url__c}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                    >
                                        Buka
                                    </a>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </section>
        </main>
    );
}
