// app/logout/logout.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const IDLE_MINUTES = 20; // ubah sesuai kebutuhan

export default function LogoutButton() {
  const [loading, setLoading] = useState(false);
  const timer = useRef<number | null>(null);

  const logout = async () => {
    setLoading(true);
    try {
      await supabase.auth.signOut();
      window.location.replace("/login");
    } catch (error) {
      console.error("Logout error:", error);
      setLoading(false);
    }
  };

  useEffect(() => {
    const reset = () => {
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(logout, IDLE_MINUTES * 60 * 1000);
    };
    const handler = () => reset();

    const events: Array<keyof WindowEventMap> = [
      "mousemove",
      "mousedown",
      "keydown",
      "touchstart",
      "scroll",
    ];
    events.forEach((e) => window.addEventListener(e, handler, { passive: true }));
    reset();
    return () => {
      events.forEach((e) => window.removeEventListener(e, handler));
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, []);

  return (
    <button
      onClick={logout}
      disabled={loading}
      className="px-4 py-2 rounded-full bg-red-500 hover:bg-red-600 disabled:bg-red-400 disabled:cursor-not-allowed text-white text-sm shadow transition-colors flex items-center gap-2"
    >
      {loading && (
        <svg
          className="animate-spin h-4 w-4"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-30"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-90"
            fill="currentColor"
            d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
          />
        </svg>
      )}
      {loading ? "Logging out..." : "Logout"}
    </button>
  );
}