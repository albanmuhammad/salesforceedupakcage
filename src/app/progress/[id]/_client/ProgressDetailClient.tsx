"use client";

import { useMemo, useState } from "react";
import ModalPortal from "@/components/ModalPortal";
import Swal from "sweetalert2";

type Doc = {
    Id?: string;
    Name?: string;
    Type__c?: string | null;
    Url__c?: string | null;
    Document_Type__c?: string | null;
    Document_Link__c?: string | null;
};

function deepClone<T>(v: T): T {
    return JSON.parse(JSON.stringify(v));
}
function isPrimitive(v: unknown): v is string | number | boolean | null {
    return (
        typeof v === "string" ||
        typeof v === "number" ||
        typeof v === "boolean" ||
        v === null
    );
}
function diff(a: unknown, b: unknown): boolean {
    return JSON.stringify(a) !== JSON.stringify(b);
}

const LABELS: Record<string, string> = {
    Name: "Name",
    PersonEmail: "Person Email",
    PersonBirthdate: "Person Birthdate",
    Phone: "Phone",
};

const REQUIRED_TYPES = [
    "Pas Foto 3x4",
    "Scan KTP Orang Tua",
    "Rapor 1",
    "Rapor 2",
    "Rapor 3",
    "Scan KTP",
    "Scan Ijazah",
    "Scan Akte Kelahiran",
    "Scan Form Tata Tertib",
    "Scan Kartu Keluarga",
    "Scan Surat Sehat",
    "Lainnya",
] as const;
type RequiredType = (typeof REQUIRED_TYPES)[number];

type ProgressDetailClientProps = {
    id: string;
    siswa: Record<string, unknown>;
    orangTua: Record<string, unknown>;
    dokumen: Doc[];
    apiBase: string;
    // cookieHeader: string; // (tidak dipakai di client)
    photoVersionId: string | null;
};

async function fileToBase64(file: File): Promise<string> {
    const buf = await file.arrayBuffer();
    let binary = "";
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
}

function setLinkMutable(d: Doc, v: string) {
    if ("Document_Link__c" in d) d.Document_Link__c = v;
    else d.Url__c = v;
}

// Helper kecil untuk spinner SVG
function Spinner({ className = "h-5 w-5" }: { className?: string }) {
    return (
        <svg
            className={`animate-spin ${className}`}
            xmlns="http://www.w3.org/2000/svg"
            fill="none" viewBox="0 0 24 24"
        >
            <circle className="opacity-30" cx="12" cy="12" r="10"
                stroke="currentColor" strokeWidth="4" />
            <path className="opacity-90" fill="currentColor"
                d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
        </svg>
    );
}

export default function ProgressDetailClient({
    id,
    siswa,
    orangTua,
    dokumen,
    apiBase,
    photoVersionId,
}: ProgressDetailClientProps) {

    // ===== FOTO =====
    const photoUrl = photoVersionId
        ? `${apiBase}/api/salesforce/files/version/${photoVersionId}/data`
        : "/default-avatar.png";

    // ===== STATE =====
    const originalSiswa = useMemo(() => deepClone(siswa), [siswa]);
    const originalOrtu = useMemo(() => deepClone(orangTua), [orangTua]);
    const originalDocs = useMemo(() => deepClone(dokumen), [dokumen]);

    const [siswaEdit, setSiswaEdit] = useState<Record<string, unknown>>(deepClone(siswa));
    const [ortuEdit, setOrtuEdit] = useState<Record<string, unknown>>(deepClone(orangTua));
    const [docsEdit, setDocsEdit] = useState<Doc[]>(deepClone(dokumen));

    const siswaDirty = diff(originalSiswa, siswaEdit);
    const ortuDirty = diff(originalOrtu, ortuEdit);

    // NEW: global saving state (untuk overlay & disable UI)
    const [saving, setSaving] = useState(false);

    // ===== Keys/helper dokumen =====
    const getType = (d: Doc): string => d.Document_Type__c ?? d.Type__c ?? "";
    const setType = (d: Doc, v: string): void => { d.Document_Type__c = v; d.Type__c = v; };
    const getLink = (d: Doc): string => d.Document_Link__c ?? d.Url__c ?? "";
    const setLink = (d: Doc, v: string): void => { d.Document_Link__c = v; d.Url__c = v; };

    const docsByType = useMemo(() => {
        const m = new Map<string, Doc>();
        for (const d of docsEdit) {
            const t = getType(d);
            if (t && !m.has(t)) m.set(t, d);
        }
        return m;
    }, [docsEdit]);

    const [pendingUploads, setPendingUploads] = useState<Record<string, File | null>>({});

    const docsDirty =
        diff(originalDocs, docsEdit) ||
        Object.values(pendingUploads).some(Boolean);

    function onPickFile(type: RequiredType, file: File | null) {
        setPendingUploads((prev) => ({ ...prev, [type]: file }));
    }

    function ensureDocEntryFor(type: RequiredType) {
        const existing = docsByType.get(type);
        if (existing) return;
        const draft = [...docsEdit];
        draft.push({
            Id: undefined,
            Name: type,
            Document_Type__c: type,
            Document_Link__c: "",
        });
        setDocsEdit(draft);
    }

    // ----- SAVE handlers (panggil API sesuai segment) -----
    async function saveSegment(segment: "siswa" | "orangTua" | "dokumen") {
        const body: {
            segment: "siswa" | "orangTua" | "dokumen";
            id: string;
            siswa?: Record<string, unknown>;
            orangTua?: Record<string, unknown>;
            dokumen?: Doc[];
        } = { segment, id };

        setSaving(true);
        try {
            if (segment === "dokumen") {
                // 1) Upload SEMUA file pending (0..N) → dapat downloadUrl
                const entries = Object.entries(pendingUploads) as [RequiredType, File | null][];

                // OPTIONAL: jika kamu ingin pastikan kirim state terbaru,
                // kamu bisa pegang salinan lokal lalu setDocsEdit di akhir.
                const nextDocs = deepClone(docsEdit);

                for (const [type, file] of entries) {
                    if (!file) continue;

                    const base64 = await fileToBase64(file);
                    const res = await fetch("/api/salesforce/upload", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            filename: file.name,
                            base64,
                            relateToId: id,       // Opportunity Id
                            accountId: siswa.Id, // jika tersedia
                            documentType: type,
                        }),
                    });

                    if (!res.ok) throw new Error(await res.text());
                    const json: { ok: boolean; downloadUrl?: string } = await res.json();
                    if (!json.ok || !json.downloadUrl) throw new Error("Upload response invalid");

                    // suntik link ke nextDocs (bukan langsung state) untuk konsistensi
                    const idx = nextDocs.findIndex((d) => getType(d) === type);
                    if (idx >= 0) {
                        const copy = { ...nextDocs[idx] };
                        setLinkMutable(copy, json.downloadUrl || "");
                        nextDocs[idx] = copy;
                    } else {
                        nextDocs.push({
                            Name: type,
                            Document_Type__c: type,
                            Document_Link__c: json.downloadUrl,
                        });
                    }
                }

                // 2) Setelah semua upload, komit ke state & siapkan body
                setDocsEdit(nextDocs);
                body.dokumen = nextDocs;

            } else if (segment === "siswa") {
                body.siswa = siswaEdit;
            } else if (segment === "orangTua") {
                body.orangTua = ortuEdit;
            }

            const res = await fetch(`${apiBase}/api/salesforce/progress/${id}`, {
                method: "PATCH",
                cache: "no-store",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            if (!res.ok) throw new Error(await res.text());

            // reset originals & pending
            if (segment === "dokumen") {
                (originalDocs as Doc[]).length = 0;
                (originalDocs as Doc[]).push(...JSON.parse(JSON.stringify(docsEdit)));
                setPendingUploads({});
            } else if (segment === "siswa") {
                Object.assign(originalSiswa as object, JSON.parse(JSON.stringify(siswaEdit)));
            } else if (segment === "orangTua") {
                Object.assign(originalOrtu as object, JSON.parse(JSON.stringify(ortuEdit)));
            }

            await Swal.fire({
                icon: "success",
                title: "Berhasil disimpan",
                text:
                    segment === "dokumen"
                        ? "Dokumen telah diperbarui."
                        : segment === "siswa"
                            ? "Data siswa telah diperbarui."
                            : "Data orang tua telah diperbarui.",
                confirmButtonText: "OK",
            });
        } catch (err) {
            // ❌ ERROR: SweetAlert
            const msg = err instanceof Error ? err.message : "Gagal menyimpan.";
            await Swal.fire({
                icon: "error",
                title: "Gagal menyimpan",
                text: msg,
                confirmButtonText: "OK",
            });
        } finally {
            setSaving(false);
        }
    }

    // ===== Readonly rules =====
    function isReadOnly(key: string, val: unknown) {
        if (key === "Name" || key === "PersonEmail") return true;
        if (key === "Phone") return String(val ?? "").trim() !== "";
        return false;
    }

    const HIDDEN_KEYS = [
        "Id",
        "PhotoUrl",
        "IsPersonAccount",
        "PersonContactId",
        "Master_School__c",
        "Master_School__r",
    ];

    const schoolName =
        (siswaEdit?.["Master_School__r"] as { Name?: string } | undefined)?.Name ??
        String(siswaEdit?.["Master_School__c"] ?? "");

    // ===== UI =====
    return (
        <>
            {/* GLOBAL SAVING OVERLAY */}
            {saving && (
                <ModalPortal>
                    <div className="fixed inset-0 z-[200] bg-black/40 backdrop-blur-[1px] flex items-center justify-center">
                        <div className="flex items-center gap-3 text-white text-lg">
                            <Spinner className="h-6 w-6" />
                            Saving...
                        </div>
                    </div>
                </ModalPortal>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-6">
                {/* KIRI: data account */}
                <div className="relative rounded-[28px] bg-white/90 backdrop-blur-sm shadow-2xl ring-1 ring-white/40 p-6">
                    <div className="text-lg font-semibold text-slate-700 mb-4">data account</div>

                    {/* data siswa */}
                    <div className="rounded-3xl border border-gray-200 bg-white shadow-sm hover:shadow-md transition-all p-6 md:p-7 mb-4">
                        <div className="text-base font-medium mb-3 text-slate-700">data siswa</div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
                            {/* FOTO 3×4 */}
                            <div className="flex flex-col items-center">
                                <div className="relative overflow-hidden rounded-2xl ring-1 ring-black/5 shadow w-32 md:w-36 aspect-[3/4] bg-white">
                                    <img
                                        src={photoUrl}
                                        alt="Foto Siswa"
                                        className="absolute inset-0 h-full w-full object-cover object-center"
                                        loading="eager"
                                        fetchPriority="high"
                                        decoding="async"
                                    />
                                </div>
                            </div>

                            {/* DATA KANAN */}
                            <div className="md:col-span-2">
                                {renderObjectEditor(siswaEdit, setSiswaEdit, HIDDEN_KEYS)}

                                {/* School (lookup): readonly */}
                                <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                                    <label className="flex flex-col text-sm">
                                        <span className="mb-1 text-gray-600">School</span>
                                        <input
                                            className="border rounded px-3 py-2 bg-gray-100 text-gray-600 cursor-not-allowed"
                                            value={schoolName}
                                            readOnly
                                            disabled
                                        />
                                    </label>
                                </div>
                            </div>
                        </div>

                        {siswaDirty && (
                            <div className="flex justify-end mt-4">
                                <button
                                    className="px-4 py-2 rounded-lg bg-black text-white shadow disabled:opacity-60"
                                    onClick={() => saveSegment("siswa")}
                                    disabled={saving}
                                >
                                    {saving ? (
                                        <span className="inline-flex items-center gap-2">
                                            <Spinner className="h-4 w-4" /> Saving...
                                        </span>
                                    ) : (
                                        "Save"
                                    )}
                                </button>
                            </div>
                        )}
                    </div>

                    {/* data orang tua */}
                    <div className="rounded-3xl border border-gray-200 bg-white shadow-sm hover:shadow-md transition-all p-6 md:p-7 mb-4">
                        <div className="text-base font-medium mb-3 text-slate-700">data orang tua</div>

                        {renderObjectEditor(ortuEdit, setOrtuEdit, [])}

                        {ortuDirty && (
                            <div className="flex justify-end mt-4">
                                <button
                                    className="px-4 py-2 rounded-lg bg-black text-white shadow disabled:opacity-60"
                                    onClick={() => saveSegment("orangTua")}
                                    disabled={saving}
                                >
                                    {saving ? (
                                        <span className="inline-flex items-center gap-2">
                                            <Spinner className="h-4 w-4" /> Saving...
                                        </span>
                                    ) : (
                                        "Save"
                                    )}
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                {/* KANAN: dokumen */}
                <div className="relative rounded-[28px] bg-white/90 backdrop-blur-sm shadow-2xl ring-1 ring-white/40 p-6">
                    <div className="text-lg font-semibold text-slate-700 mb-4">
                        data application progres
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {REQUIRED_TYPES.map((type) => {
                            const existing = docsByType.get(type);
                            const uploaded = !!existing && !!getLink(existing);

                            return (
                                <div
                                    key={type}
                                    className="rounded-3xl border border-gray-200 bg-white shadow-sm hover:shadow-md transition-all p-6 md:p-7"
                                >
                                    <div className="flex items-start justify-between mb-3">
                                        <div>
                                            <div className="text-sm font-medium text-slate-700">{type}</div>
                                            <div className={`text-xs mt-1 ${uploaded ? "text-emerald-600" : "text-rose-600"}`}>
                                                {uploaded ? "Uploaded" : "Not Uploaded"}
                                            </div>
                                        </div>

                                        {uploaded && (
                                            <a
                                                href={getLink(existing!)}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-xs underline text-blue-600"
                                            >
                                                Open
                                            </a>
                                        )}
                                    </div>

                                    <div className="mb-3">
                                        <label className="block text-xs text-gray-600 mb-1">Document Type</label>
                                        <select
                                            className="w-full border rounded px-3 py-2 text-sm bg-gray-50"
                                            value={existing ? getType(existing) : type}
                                            disabled
                                        >
                                            {REQUIRED_TYPES.map((opt) => (
                                                <option key={opt} value={opt}>
                                                    {opt}
                                                </option>
                                            ))}
                                        </select>
                                    </div>

                                    <div className="flex items-center justify-between gap-3">
                                        <label className="text-xs text-gray-600">Upload File</label>
                                        <input
                                            type="file"
                                            className="block w-full text-xs disabled:opacity-60"
                                            onChange={(e) => {
                                                const f = e.target.files?.[0] || null;
                                                onPickFile(type as RequiredType, f);
                                                ensureDocEntryFor(type as RequiredType);
                                            }}
                                            disabled={saving}
                                        />
                                    </div>
                                    {pendingUploads[type] && (
                                        <div className="text-xs text-gray-600 mt-2 break-words">
                                            Selected: {pendingUploads[type]?.name}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    {docsDirty && (
                        <div className="flex justify-end mt-4">
                            <button
                                className="px-4 py-2 rounded-lg bg-black text-white shadow disabled:opacity-60"
                                onClick={() => saveSegment("dokumen")}
                                disabled={saving}
                            >
                                save
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </>
    );

    // ===== Editor generik (dipindah ke bawah file biar rapi) =====
    function renderObjectEditor(
        obj: Record<string, unknown>,
        setObj: (v: Record<string, unknown>) => void,
        omitKeys: string[] = []
    ) {
        const entries = Object.entries(obj).filter(
            ([k, v]) => !omitKeys.includes(k) && isPrimitive(v)
        );

        if (entries.length === 0) {
            return <div className="text-sm text-gray-500">Tidak ada field yang dapat diedit.</div>;
        }

        return (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {entries.map(([key, val]) => {
                    const readOnly = isReadOnly(key, val);
                    const roCls = readOnly ? "bg-gray-100 text-gray-500 cursor-not-allowed" : "";

                    if (typeof val === "boolean") {
                        return (
                            <label key={key} className="flex flex-col text-sm">
                                <span className="mb-1 text-gray-600">{LABELS[key] ?? key}</span>
                                <select
                                    className={`border rounded px-3 py-2 ${roCls}`}
                                    value={String(val)}
                                    onChange={(e) =>
                                        setObj({
                                            ...(obj as Record<string, unknown>),
                                            [key]: e.target.value === "true",
                                        })
                                    }
                                    disabled={readOnly || saving}
                                >
                                    <option value="true">true</option>
                                    <option value="false">false</option>
                                </select>
                            </label>
                        );
                    }

                    const isBirthdate = key === "PersonBirthdate";
                    const inputType = isBirthdate ? "date" : "text";

                    return (
                        <label key={key} className="flex flex-col text-sm">
                            <span className="mb-1 text-gray-600">{LABELS[key] ?? key}</span>
                            <input
                                type={inputType}
                                className={`border rounded px-3 py-2 ${readOnly ? roCls : ""}`}
                                value={String(val ?? "")}
                                onChange={(e) =>
                                    setObj({
                                        ...(obj as Record<string, unknown>),
                                        [key]: e.target.value,
                                    })
                                }
                                readOnly={(readOnly && !isBirthdate) || saving}
                                disabled={(readOnly && !isBirthdate) || saving}
                                placeholder={isBirthdate ? "yyyy-mm-dd" : undefined}
                            />
                        </label>
                    );
                })}
            </div>
        );
    }
}
