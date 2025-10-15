// src/app/dashboard/DashboardClient.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import LogoutButton from "@/app/logout/logout";
import OpportunityCard from "./OpportunityCard";

// --- types: add related-name lookups if available
export type LookupName = { Name?: string } | null;

export interface OpportunityItem {
  Id: string;
  Name: string;
  StageName?: string | null;
  Web_Stage__c?: string | null;
  Is_Active__c: boolean;
  Campus__c?: string | null;
  Campus__r?: LookupName;
  Study_Program__c?: string | null;
  Study_Program__r?: LookupName;
  Test_Schedule__c?: string | null;
  RecordType_Name?: string | null;

  // ▼ add these for school flows (if you have lookups, they'll show .Name)
  Master_School__c?: string | null;
  Master_School__r?: LookupName;
  Major__c?: string | null;
  Major__r?: LookupName;
}


export interface ProgressResponse {
  ok: boolean;
  applicantName: string;
  items: OpportunityItem[];
  traceId?: string;
  error?: string;
}

function activeColor(status?: boolean | null) {
  return status ? "bg-green-500" : "bg-red-500";
}
function formatSFDateTime(value?: string | null, tz = "Asia/Jakarta") {
  if (!value) return "—";
  let s = String(value);
  const m = s.match(/([+-]\d{2})(\d{2})$/);
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

/* ------------------------------
   Idle → Auto Logout hook
--------------------------------*/
const IDLE_LIMIT_MS = 30 * 60_000; // 30 menit

function useIdleLogout(limitMs = IDLE_LIMIT_MS) {
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    const resetTimer = () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        window.location.href = "/logout";
      }, limitMs);
    };

    const events: (keyof WindowEventMap)[] = [
      "mousemove",
      "mousedown",
      "keydown",
      "wheel",
      "touchstart",
      "scroll",
    ];

    resetTimer();
    events.forEach((e) => window.addEventListener(e, resetTimer, { passive: true }));

    const onVis = () => {
      if (document.visibilityState === "visible") resetTimer();
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      events.forEach((e) => window.removeEventListener(e, resetTimer));
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [limitMs]);
}

/* -----------------------------------------
   Anti Back di Dashboard (trap history)
------------------------------------------*/
function useTrapBackOnThisPage() {
  useEffect(() => {
    // Dorong 1 state dummy ke history saat masuk dashboard
    history.pushState(null, "", location.href);

    const onPop = (e: PopStateEvent) => {
      // Setiap back, dorong lagi state ke URL yang sama → efeknya: tetap di dashboard
      history.pushState(null, "", location.href);
    };

    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
}

export default function DashboardClient({
  applicantName,
  items,
}: {
  applicantName: string;
  items: OpportunityItem[];
}) {
  const [loading, setLoading] = useState(false);

  // Auto-logout saat idle
  useIdleLogout();

  // Blokir tombol Back agar tetap di dashboard
  useTrapBackOnThisPage();

  return (
    <main className="min-h-screen relative flex items-center justify-center bg-gradient-to-r from-blue-400 via-blue-500 to-blue-600">
      {/* GLOBAL OVERLAY LOADER */}
      {loading && (
        <div className="fixed inset-0 z-[200] bg-black/40 backdrop-blur-[1px] flex items-center justify-center">
          <div className="flex items-center gap-3 text-white text-lg">
            <svg
              className="animate-spin h-6 w-6"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle className="opacity-30" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
            Loading...
          </div>
        </div>
      )}

      <div className="w-full max-w-6xl mx-auto px-4 py-10">
        <div className="relative rounded-[28px] bg-white/90 backdrop-blur-sm shadow-2xl ring-1 ring-white/40">
          <div className="absolute right-4 top-4">
            <LogoutButton />
          </div>

          <div className="p-6 md:p-10">
            <div className="mb-10 text-center">
              <h2 className="text-base md:text-lg text-gray-500">Welcome</h2>
              <h1 className="text-2xl md:text-3xl font-semibold text-gray-900">{applicantName}</h1>
            </div>

            {!items.length && (
              <div className="rounded-3xl border border-dashed p-10 text-center text-gray-500 bg-white">
                No application progress yet.
              </div>
            )}

            <ul className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {items.map((p) => (
                <li key={p.Id}>
                  <OpportunityCard
                    item={p}
                    setGlobalLoading={setLoading}
                    className="block relative text-left w-full rounded-3xl border border-gray-200 bg-white shadow-sm hover:shadow-md transition-all p-6 md:p-7"
                  >
                    {/* Status dot */}
                    <span
                      aria-hidden
                      className={`absolute top-4 right-4 h-3 w-3 rounded-full ${activeColor(p.Is_Active__c)}`}
                    />
                    {/* Title */}
                    <div className="text-xl md:text-2xl font-semibold leading-snug text-gray-900">
                      {p.Name}
                    </div>
                    {/* Detail */}
                    <dl className="mt-3 md:mt-4 text-sm md:text-[15px] text-gray-700 space-y-1.5">
                      <div className="flex gap-2">
                        <dt className="w-32 text-gray-500">status:</dt>
                        <dd className="flex-1">{p.StageName || "—"}</dd>
                      </div>

                      {(() => {
                        const rt = (p.RecordType_Name || "").toLowerCase();
                        const isUniversity = rt.includes("university");
                        const isSchool = rt.includes("school");

                        if (isUniversity) {
                          return (
                            <>
                              <div className="flex gap-2">
                                <dt className="w-32 text-gray-500">campus:</dt>
                                <dd className="flex-1">{p.Campus__r?.Name ?? p.Campus__c ?? "—"}</dd>
                              </div>
                              <div className="flex gap-2">
                                <dt className="w-32 text-gray-500">study program:</dt>
                                <dd className="flex-1">{p.Study_Program__r?.Name ?? p.Study_Program__c ?? "—"}</dd>
                              </div>
                            </>
                          );
                        }

                        if (isSchool) {
                          return (
                            <>
                              <div className="flex gap-2">
                                <dt className="w-32 text-gray-500">master school:</dt>
                                <dd className="flex-1">{p.Master_School__r?.Name ?? p.Master_School__c ?? "—"}</dd>
                              </div>
                              <div className="flex gap-2">
                                <dt className="w-32 text-gray-500">major:</dt>
                                <dd className="flex-1">{p.Major__r?.Name ?? p.Major__c ?? "—"}</dd>
                              </div>
                            </>
                          );
                        }

                        // Fallback (unknown record type): show nothing extra
                        return null;
                      })()}

                      <div className="flex gap-2">
                        <dt className="w-32 text-gray-500">test schedule:</dt>
                        <dd className="flex-1">{formatSFDateTime(p.Test_Schedule__c)}</dd>
                      </div>
                    </dl>
                  </OpportunityCard>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </main>
  );
}
