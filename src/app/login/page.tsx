"use client";

import { useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { useRouter } from "next/navigation";

const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function LoginPage() {
    const r = useRouter();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [err, setErr] = useState("");

    async function onSubmit(e: React.FormEvent) {
        e.preventDefault();
        setErr("");
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
            setErr(error.message);
            return;
        }
        window.location.href = '/dashboard';
    }

    return (
        <div className="min-h-screen grid place-items-center">
            <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4">
                <h1 className="text-2xl font-semibold">Login</h1>
                <input
                    className="border w-full p-2 rounded"
                    placeholder="email"
                    type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                />
                <input
                    className="border w-full p-2 rounded"
                    placeholder="password"
                    type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                />
                {err && <p className="text-red-600 text-sm">{err}</p>}
                <button className="w-full bg-black text-white rounded p-2">Sign in</button>

                <p className="text-sm text-center">
                    don’t have account?{" "}
                    {/* arahkan ke /register aplikasi lain */}
                    <a className="underline" href="https://metro-seven-web-to-lead.vercel.app/register.html" target="_blank">
                        register
                    </a>
                </p>
            </form>
        </div>
    );
}
