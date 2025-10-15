// src/app/login/choose/page.tsx
"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Role = "school" | "university";

export default function ChooseLoginPage() {
  const r = useRouter();
  const [role, setRole] = useState<Role>("school");

  const ui = useMemo(() => {
    if (role === "school") {
      return {
        title: "Login",
        brand: "Metro Mini",
        desc: (
          <>
            Metro Mini adalah jalur pendaftaran untuk <b>pelajar sekolah</b>.
            Program dirancang untuk penguatan dasar, karakter, dan kesiapan
            menuju pendidikan tinggi. Pilih opsi ini bila Anda saat ini
            berstatus siswa SD/SMP/SMA/SMK.
          </>
        ),
        bgTab: "bg-emerald-50 border-emerald-300 text-emerald-700",
        tabHover: "hover:border-emerald-400",
        hero: "/student4.png",
      };
    }
    return {
      title: "Login",
      brand: "Metro Seven",
      desc: (
        <>
          Metro Seven adalah jalur pendaftaran untuk <b>mahasiswa</b> /
          calon mahasiswa. Fokus pada kurikulum modern, kolaborasi proyek,
          dan kesiapan karier. Pilih opsi ini bila Anda mendaftar sebagai
          mahasiswa perguruan tinggi.
        </>
      ),
      bgTab: "bg-indigo-50 border-indigo-300 text-indigo-700",
      tabHover: "hover:border-indigo-400",
      hero: "/graduate.png",
    };
  }, [role]);

  const goLogin = () => r.push(`/login?role=${role}`);

  return (
    <main className="min-h-[calc(100vh-1px)] w-full bg-gray-50 flex items-start md:items-center justify-center px-4 py-10">
      <section className="w-full max-w-4xl">
        <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-6 md:p-10">
          <h1 className="text-3xl md:text-4xl font-bold text-slate-800 text-center">
            Pilih tipe login
          </h1>

          <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Kiri: deskripsi */}
            <div className="rounded-xl border border-gray-200 p-5 md:p-6">
              <div className="flex items-center gap-3">
                <img src={ui.hero} alt="hero" className="h-12 w-12 md:h-14 md:w-14" />
                <div>
                  <p className="text-sm text-slate-500">Tentang</p>
                  <h2 className="text-lg md:text-xl font-semibold text-slate-800">
                    {ui.brand}
                  </h2>
                </div>
              </div>
              <p className="mt-4 text-slate-600 leading-relaxed">{ui.desc}</p>
            </div>

            {/* Kanan: switch + CTA */}
            <div className="rounded-xl border border-gray-200 p-5 md:p-6">
              <h3 className="text-xl font-semibold text-slate-800">{ui.title}</h3>

              {/* Switch */}
              <div className="mt-4 flex gap-3">
                <button
                  type="button"
                  onClick={() => setRole("school")}
                  className={`flex-1 rounded-xl border px-4 py-3 text-center font-medium transition
                    ${
                      role === "school"
                        ? ui.bgTab
                        : "border-gray-300 text-slate-600 hover:border-gray-400"
                    } ${ui.tabHover}`}
                >
                  School
                </button>
                <button
                  type="button"
                  onClick={() => setRole("university")}
                  className={`flex-1 rounded-xl border px-4 py-3 text-center font-medium transition
                    ${
                      role === "university"
                        ? ui.bgTab
                        : "border-gray-300 text-slate-600 hover:border-gray-400"
                    } ${ui.tabHover}`}
                >
                  University
                </button>
              </div>

              {/* CTA Login */}
              <button
                type="button"
                onClick={goLogin}
                className="mt-6 w-full rounded-xl bg-slate-900 text-white text-center font-semibold py-3.5 shadow hover:bg-slate-800 transition"
              >
                Login Now
              </button>
            </div>
          </div>

          <p className="mt-6 text-center text-slate-500 text-sm">
            Anda bisa mengganti tipe pada switch di atas kapan saja.
          </p>
        </div>
      </section>
    </main>
  );
}
