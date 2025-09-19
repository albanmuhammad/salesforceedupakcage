import { cookies } from "next/headers";

export default async function Dashboard() {
    // Ambil semua cookie user dari request SSR
    const cookieHeader = await cookies()
        .getAll()
        .map((c) => `${c.name}=${encodeURIComponent(c.value)}`)
        .join("; ");

    // Base URL (penting: absolute)
    const base = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";

    const res = await fetch(`${base}/api/salesforce/progress`, {
        cache: "no-store",
        headers: {
            cookie: cookieHeader, // <-- forward cookie ke API
        },
    });

    const { items } = await res.json();

    return (
        <main className="p-6">
            <h1 className="text-2xl font-semibold mb-4">Application Progress</h1>
            {(!items || items.length === 0) ? (
                <p>Tidak ada progress.</p>
            ) : (
                <ul className="space-y-2">
                    {items.map((p: any) => (
                        <li key={p.Id} className="border rounded p-3">
                            <a className="underline" href={`/progress/${p.Id}`}>
                                {p.Name}
                            </a>
                            <div className="text-sm text-gray-600">
                                Status: {p.StageName}
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </main>
    );
}
