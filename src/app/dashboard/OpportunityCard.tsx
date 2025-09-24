"use client";

import { useState, MouseEvent } from "react";
import { useRouter } from "next/navigation";

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
}

function normalizeStage(stage?: string | null) {
    return (stage || "").trim().toLowerCase();
}

function isReRegistration(stage?: string | null, webStage?: string | null) {
    const s = normalizeStage(stage);
    const w = normalizeStage(webStage);
    // longgar: “re-registration”, “re registration”, “reregistration”
    const hasRe = (v: string) =>
        v.includes("re-registration") || v.includes("closed") || v.includes("reregistr");
    return hasRe(w) || hasRe(s);
}

export default function OpportunityCard({
    item,
    children,
    className,
}: {
    item: OpportunityItem;
    children: React.ReactNode;     // isi kartu yang sudah kamu render di server
    className?: string;
}) {
    const router = useRouter();
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState<false | "activating" | "routing">(false);
    const [error, setError] = useState<string | null>(null);

    async function activate(id: string) {
        setError(null);
        setLoading("activating");
        try {
            const res = await fetch(`/api/salesforce/progress/${item.Id}`, {
                method: "PATCH",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ segment: "activate" }),
            });
            if (!res.ok) {
                const j = await res.json().catch(() => ({}));
                throw new Error(j?.error || `activate_failed_${res.status}`);
            }
            const updated = (await res.json()) as {
                ok: boolean;
                opp: { Id: string; StageName?: string | null; Web_Stage__c?: string | null };
            };
            return updated.opp;
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : "Failed to activate");
            throw e;
        } finally {
            setLoading(false);
        }
    }

    async function routeAfter(oppId: string, stage?: string | null, webStage?: string | null) {
        setLoading("routing");
        const reReg = isReRegistration(stage, webStage);
        if (reReg) {
            router.push(`/progress/${oppId}`);
        } else {
            // external
            window.location.href = `https://edudevsite.vercel.app/register.html?opp=${oppId}`;
        }
    }

    async function onCardClick(e: MouseEvent<HTMLButtonElement>) {
        e.preventDefault();
        e.stopPropagation();

        if (!item.Is_Active__c) {
            setOpen(true);
            return;
        }

        await routeAfter(item.Id, item.StageName, item.Web_Stage__c);
    }

    async function onConfirm() {
        try {
            const opp = await activate(item.Id);
            setOpen(false);
            await routeAfter(item.Id, opp.StageName, opp.Web_Stage__c);
        } catch {
            // error message sudah di-set
        }
    }

    return (
        <>
            {/* Jadikan kartu sebagai button supaya bisa intercept klik */}
            <button
                onClick={onCardClick}
                className={className}
                disabled={loading !== false}
                aria-disabled={loading !== false}
            >
                {children}
            </button>

            {/* Modal konfirmasi aktivasi */}
            {open && (
                <div
                    className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
                    role="dialog"
                    aria-modal="true"
                >
                    <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl p-6">
                        <h3 className="text-lg font-semibold text-gray-900">
                            Aktifkan Opportunity?
                        </h3>
                        <p className="mt-2 text-sm text-gray-600">
                            Opportunity <span className="font-medium">{item.Name}</span> saat ini non-aktif.
                            Ingin mengaktifkan sekarang?
                        </p>

                        {error && (
                            <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                                {error}
                            </div>
                        )}

                        <div className="mt-6 flex items-center justify-end gap-3">
                            <button
                                className="px-4 py-2 rounded-xl border border-gray-300 text-gray-700 hover:bg-gray-50"
                                onClick={() => setOpen(false)}
                                disabled={loading !== false}
                            >
                                Batal
                            </button>
                            <button
                                className="px-4 py-2 rounded-xl bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
                                onClick={onConfirm}
                                disabled={loading !== false}
                            >
                                {loading === "activating" ? "Mengaktifkan..." : "Ya, Aktifkan"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
