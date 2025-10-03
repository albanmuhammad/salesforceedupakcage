"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { useRouter } from "next/navigation";

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  // Kalau ingin sesi tidak persist sama sekali (hilang saat tab ditutup), aktifkan opsi berikut:
  // , { auth: { persistSession: false, autoRefreshToken: false } }
);

export default function LoginPage() {
  const r = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  // session lama (jika ada)
  const [existingEmail, setExistingEmail] = useState<string | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      const userEmail = data.session?.user?.email ?? null;
      if (!mounted) return;
      setExistingEmail(userEmail);
      setCheckingSession(false);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setErr(error.message);
        return;
      }
      r.replace("/dashboard");
    } finally {
      setLoading(false);
    }
  }

  async function onContinue() {
    // Pakai sesi lama → langsung ke dashboard
    r.replace("/dashboard");
  }

  async function onSignOut() {
    setLoading(true);
    try {
      await supabase.auth.signOut();
      // bersihkan state existing email
      setExistingEmail(null);
      setEmail("");
      setPassword("");
      setErr("");
    } finally {
      setLoading(false);
    }
  }

  // Opsional: jika mau bisa signout otomatis bila ada query ?forceLogout=1
  // gunakan useSearchParams() dan panggil onSignOut() saat mount.

  return (
    <div className="min-h-screen relative flex items-center justify-center bg-gradient-to-r from-blue-400 via-blue-500 to-blue-600">
      {/* Logo di pojok kiri atas */}
      <img
        src="/Logo-MetroSeven-removebg-preview.png"
        alt="logo metroseven"
        className="absolute top-6 left-6 h-36 w-auto"
      />

      <div className="flex flex-col md:flex-row items-center justify-center gap-16 w-full px-4">
        {/* Left side */}
        <div className="text-center text-white space-y-4 max-w-md">
          <div className="flex justify-center mb-5">
            <img src="/graduate.png" alt="Graduation" className="h-50 w-auto" />
          </div>
          <h1 className="text-5xl font-bold">
            Welcome to <br /> Metro Seven
          </h1>
          <p className="text-sm">ready to apply for your future in Metro Seven?</p>
        </div>

        {/* Right side - Login Box */}
        <div className="bg-white shadow-xl rounded-xl p-8 w-full max-w-sm space-y-5">
          {/* Banner jika ada sesi lama */}
          {!checkingSession && existingEmail && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 text-amber-800 p-3 text-sm mb-3">
              You are currently signed in as <b>{existingEmail}</b>.
              <div className="mt-2 flex gap-2">
                <button
                  onClick={onContinue}
                  className="px-3 py-1.5 rounded-md bg-blue-600 text-white font-medium hover:bg-blue-700"
                  disabled={loading}
                >
                  Continue
                </button>
                <button
                  onClick={onSignOut}
                  className="px-3 py-1.5 rounded-md bg-gray-100 text-gray-800 font-medium hover:bg-gray-200"
                  disabled={loading}
                >
                  Sign out
                </button>
              </div>
            </div>
          )}

          {/* Form login biasa */}
          <form onSubmit={onSubmit} className="space-y-5">
            <h2 className="text-2xl font-semibold text-gray-800">Sign In</h2>

            <input
              className="border-2 w-full p-3 rounded-lg text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-gray-500 placeholder:font-medium"
              placeholder="Email Address"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
            />

            <input
              className="border-2 w-full p-3 rounded-lg text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-gray-500 placeholder:font-medium"
              placeholder="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />

            {err && <p className="text-red-600 text-sm">{err}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg p-3 font-semibold transition disabled:opacity-60"
            >
              {loading && (
                <svg
                  className="animate-spin h-5 w-5 text-white"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
              )}
              {loading ? "Signing In..." : "Sign In"}
            </button>

            <p className="text-sm text-center text-gray-600">
              Don’t have an account yet?{" "}
              <a className="text-blue-600 font-medium hover:underline" href={process.env.REGISTRATION_WEB_URL}>
                Register
              </a>
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
