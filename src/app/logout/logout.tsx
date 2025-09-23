"use client";

import { useEffect, useRef } from "react";
import { createBrowserClient } from "@supabase/ssr";

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const IDLE_MINUTES = 20; // ubah sesuai kebutuhan

export default function LogoutButton() {
  const timer = useRef<number | null>(null);

  const logout = async () => {
    await supabase.auth.signOut();
    window.location.replace("/login");
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
      className="px-4 py-2 rounded-full bg-red-500 hover:bg-red-600 text-white text-sm shadow"
    >
      Logout
    </button>
  );
}
