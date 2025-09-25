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
    const [loading, setLoading] = useState(false);

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
            window.location.href = "/dashboard";
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="min-h-screen relative flex items-center justify-center bg-gradient-to-r from-blue-400 via-blue-500 to-blue-600">
            {/* Logo di pojok kiri atas */}
            <img
                src="/Logo-MetroSeven-removebg-preview.png"
                alt="logo metroseven"
                className="absolute top-6 left-6 h-36 w-auto"
            />

            <div className="flex flex-col md:flex-row items-center justify-center gap-16">
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
                <form
                    onSubmit={onSubmit}
                    className="bg-white shadow-xl rounded-xl p-8 w-full max-w-sm space-y-5"
                >
                    <h2 className="text-2xl font-semibold text-gray-800">Sign In</h2>

                    <input
                        className="border-2 w-full p-3 rounded-lg text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-gray-500 placeholder:font-medium"
                        placeholder="Email Address"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                    />

                    <input
                        className="border-2 w-full p-3 rounded-lg text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-gray-500 placeholder:font-medium"
                        placeholder="Password"
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
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
                                <circle
                                    className="opacity-25"
                                    cx="12"
                                    cy="12"
                                    r="10"
                                    stroke="currentColor"
                                    strokeWidth="4"
                                ></circle>
                                <path
                                    className="opacity-75"
                                    fill="currentColor"
                                    d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                                ></path>
                            </svg>
                        )}
                        {loading ? "Signing In..." : "Sign In"}
                    </button>

                    <p className="text-sm text-center text-gray-600">
                        Don’t have an account yet?{" "}
                        <a
                            className="text-blue-600 font-medium hover:underline"
                            href="https://edudevsite.vercel.app/register.html"
                        >
                            Register
                        </a>
                    </p>
                </form>
            </div>
        </div>
    );
}
