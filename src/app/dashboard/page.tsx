// src/app/dashboard/page.tsx
import { cookies } from "next/headers";
import Link from "next/link";
import LogoutButton from "@/app/logout/logout"; // pastikan file ini ada (client component)

// Warna titik status berdasarkan StageName
function stageToColor(stage?: string) {
  const s = (stage || "").toLowerCase();
  if (["approved", "closed won", "completed", "accepted", "success"].some(k => s.includes(k))) return "bg-green-500";
  if (["review", "submitted", "processing", "in progress"].some(k => s.includes(k))) return "bg-yellow-500";
  if (["rejected", "registration", "draft", "error"].some(k => s.includes(k))) return "bg-red-500";
  return "bg-gray-300";
}

// Format string Date/Time Salesforce -> "24 Jan 2026, 01.00" (zona default Asia/Jakarta)
function formatSFDateTime(value?: string | null, tz = "Asia/Jakarta") {
  if (!value) return "—";
  let s = String(value);
  // SFDC sering kirim "+0000" tanpa ":"; jadikan ISO valid
  const m = s.match(/([+-]\d{2})(\d{2})$/); // ex: +0700
  if (m) s = s.replace(m[0], `${m[1]}:${m[2]}`);
  else if (s.endsWith("+0000")) s = s.replace("+0000", "Z");

  const d = new Date(s);
  if (isNaN(d.getTime())) return "—";

  return new Intl.DateTimeFormat("id-ID", {
    timeZone: tz,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

export default async function Dashboard() {
  // Forward cookies ke API supaya session Supabase terbaca (SSR)
  const cookieHeader = (await cookies())
    .getAll()
    .map(c => `${c.name}=${encodeURIComponent(c.value)}`)
    .join("; ");

  const base = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
  const res = await fetch(`${base}/api/salesforce/progress`, {
    cache: "no-store",
    headers: { cookie: cookieHeader },
  });

  const data = await res.json();
  const items: any[] = data?.items ?? [];
  const applicantName: string = data?.applicantName ?? "Applicant";

  return (
    <main className="min-h-screen relative flex items-center justify-center bg-gradient-to-r from-blue-400 via-blue-500 to-blue-600">
      <div className="w-full max-w-6xl mx-auto px-4 py-10">
        <div className="relative rounded-[28px] bg-white/90 backdrop-blur-sm shadow-2xl ring-1 ring-white/40">
          {/* Logout button kanan-atas */}
          <div className="absolute right-4 top-4">
            <LogoutButton />
          </div>

          <div className="p-6 md:p-10">
            {/* Header */}
            <div className="mb-10 text-center">
              <h2 className="text-base md:text-lg text-gray-500">Welcome</h2>
              <h1 className="text-2xl md:text-3xl font-semibold tracking-tight text-gray-900">
                {applicantName}
              </h1>
            </div>

            {/* Empty state */}
            {!items.length && (
              <div className="rounded-3xl border border-dashed p-10 text-center text-gray-500 bg-white">
                No application progress yet.
              </div>
            )}

            {/* Grid 2 kolom (1 kolom di mobile) */}
            <ul className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {items.map((p) => (
                <li key={p.Id}>
                  <Link
                    href={`/progress/${p.Id}`}
                    className="block relative rounded-3xl border border-gray-200 bg-white shadow-sm hover:shadow-md transition-all p-6 md:p-7"
                  >
                    {/* Status dot */}
                    <span
                      aria-hidden
                      className={`absolute top-4 right-4 h-3 w-3 rounded-full ${stageToColor(
                        p.StageName
                      )}`}
                    />

                    {/* Title besar & bold */}
                    <div className="text-xl md:text-2xl font-semibold leading-snug text-gray-900">
                      {p.Name}
                    </div>

                    {/* Detail */}
                    <dl className="mt-3 md:mt-4 text-sm md:text-[15px] text-gray-700 space-y-1.5">
                      <div className="flex gap-2">
                        <dt className="w-32 text-gray-500">status:</dt>
                        <dd className="flex-1">{p.StageName || "—"}</dd>
                      </div>

                      <div className="flex gap-2">
                        <dt className="w-32 text-gray-500">campus:</dt>
                        <dd className="flex-1">{p.Campus__r?.Name ?? p.Campus__c ?? "—"}</dd>
                      </div>

                      <div className="flex gap-2">
                        <dt className="w-32 text-gray-500">study program:</dt>
                        <dd className="flex-1">{p.Study_Program__r?.Name ?? p.Study_Program__c ?? "—"}</dd>
                      </div>

                      <div className="flex gap-2">
                        <dt className="w-32 text-gray-500">test schedule:</dt>
                        <dd className="flex-1">
                          {formatSFDateTime(p.Test_Schedule__c)}
                        </dd>
                      </div>
                    </dl>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </main>
  );
}
