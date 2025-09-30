"use client";

import { useEffect, useRef } from "react";

type Opts = {
  /** Interval ping (ms). Default 5 menit. */
  intervalMs?: number;
  /** URL endpoint ping. */
  pingUrl?: string;
  /** Hanya ping jika user aktif dalam N menit terakhir. Default 20 menit. */
  activeWithinMs?: number;
};

export function useSessionKeepAlive(
  { intervalMs = 5 * 60_000, pingUrl = "/api/auth/ping", activeWithinMs = 20 * 60_000 }: Opts = {}
) {
  const timerRef = useRef<number | null>(null);
  const lastActiveRef = useRef<number>(Date.now());

  useEffect(() => {
    const markActive = () => { lastActiveRef.current = Date.now(); };

    const events: (keyof DocumentEventMap)[] = [
      "click", "keydown", "mousemove", "scroll", "touchstart", "visibilitychange",
    ];
    events.forEach((ev) => document.addEventListener(ev, markActive, { passive: true }));

    const ping = async () => {
      const idleMs = Date.now() - lastActiveRef.current;

      // Hanya ping kalau tab terlihat & belum idle terlalu lama
      if (document.visibilityState === "visible" && idleMs < activeWithinMs) {
        try {
          await fetch(pingUrl, { cache: "no-store", credentials: "include" });
        } catch {
          // abaikan; akan dicoba di tick berikutnya
        }
      }
    };

    ping(); // ping awal saat mount
    timerRef.current = window.setInterval(ping, intervalMs);

    return () => {
      events.forEach((ev) => document.removeEventListener(ev, markActive));
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [intervalMs, pingUrl, activeWithinMs]);
}
