// app/dashboard/OpportunityCard.tsx
"use client";

import { useState, MouseEvent } from "react";
import { useRouter } from "next/navigation";
import ModalPortal from "@/components/ModalPortal";

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
    const hasRe = (v: string) =>
        v.includes("re-registration") || v.includes("test card sent") || v.includes("test passed");
    return hasRe(w) || hasRe(s);
}

export default function OpportunityCard({
    item,
    children,
    className,
    setGlobalLoading,
}: {
    item: OpportunityItem;
    children: React.ReactNode;
    className?: string;
    // 👉 callback dari DashboardClient
    setGlobalLoading?: (v: boolean) => void;
}) {
    const router = useRouter();
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState<false | "activating" | "routing">(false);
    const [error, setError] = useState<string | null>(null);

    async function activate(id: string) {
        setError(null);
        setBusy("activating");
        setGlobalLoading?.(true);
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
            setGlobalLoading?.(false);
            return updated.opp;
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : "Failed to activate");
            // matikan loader global karena kita tetap di halaman ini
            setGlobalLoading?.(false);
            throw e;
        } finally {
            setBusy(false);
        }
    }

    async function routeAfter(oppId: string, stage?: string | null, webStage?: string | null) {
        setBusy("routing");
        setGlobalLoading?.(true);
        const reReg = isReRegistration(stage, webStage);
        if (reReg) {
            router.push(`/progress/${oppId}`); // next/router akan ganti halaman
        } else {
            setGlobalLoading?.(false);
            window.location.href = `https://edudevsite.vercel.app/register.html?opp=${oppId}`;
        }
        // JANGAN setGlobalLoading(false) — biarkan overlay sampai navigasi selesai.
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
            // error sudah ditangani di activate()
        }
    }

    return (
        <>
            {/* Card as button */}
            <button
                onClick={onCardClick}
                className={className}
                disabled={!!busy}
                aria-disabled={!!busy}
                aria-busy={!!busy}
            >
                {children}
            </button>

            {/* Modal */}
            {open && (
                <ModalPortal>
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
                                    disabled={!!busy}
                                >
                                    Batal
                                </button>
                                <button
                                    className="px-4 py-2 rounded-xl bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
                                    onClick={onConfirm}
                                    disabled={!!busy}
                                >
                                    {busy === "activating" ? "Mengaktifkan..." : "Ya, Aktifkan"}
                                </button>
                            </div>
                        </div>
                    </div>
                </ModalPortal>
            )}
        </>
    );
}
