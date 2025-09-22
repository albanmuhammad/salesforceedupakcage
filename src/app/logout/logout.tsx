// src/app/components/LogoutButton.tsx
"use client";

import { useCallback, useEffect, useRef } from "react";
import { createBrowserClient } from "@supabase/ssr";

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// idle timeout (menit)
const TIMEOUT_MINUTES = 15;
const TIMEOUT_MS = TIMEOUT_MINUTES * 60 * 1000;

export default function LogoutButton() {
  const idleTimerRef = useRef<NodeJS.Timeout | null>(null);

  const goLogin = () => {
    // redirect ke halaman login
    window.location.href = "/login";
  };

  const doLogout = useCallback(async () => {
    try {
      await supabase.auth.signOut(); // hapus session
    } catch {}
    goLogin();
  }, []);

  const resetTimer = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(doLogout, TIMEOUT_MS);
  }, [doLogout]);

  useEffect(() => {
    resetTimer();

    const events: (keyof WindowEventMap)[] = [
      "mousemove",
      "mousedown",
      "keydown",
      "touchstart",
      "scroll",
      "visibilitychange",
    ];
    const handler = () => resetTimer();

    events.forEach((ev) => window.addEventListener(ev, handler, { passive: true }));
    return () => {
      events.forEach((ev) => window.removeEventListener(ev, handler));
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, [resetTimer]);

  return (
    <button
      onClick={doLogout}
      className="inline-flex items-center gap-2 rounded-full bg-white/90 text-blue-700 hover:bg-white px-4 py-2 text-sm font-semibold shadow ring-1 ring-white/60 backdrop-blur-sm transition"
      title={`Logout (auto logout ${TIMEOUT_MINUTES}m idle)`}
    >
      Logout
    </button>
  );
}
