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
  ContentVersionId?: string | null;
};

type ParentRel = {
  relationshipId?: string;
  type: string; // dinamis (ikut picklist dari server)
  contactId?: string;
  name: string;
  job: string;
  phone: string;
  email: string;
  address: string;
  locked?: boolean;
};

type PaymentInfo = {
  Id: string;
  Name: string;
  Amount__c?: number | null;
  Payment_Status__c?: string | null;
  Virtual_Account_No__c?: string | null;
  Payment_Channel__r?: { Payment_Channel_Bank__c?: string | null } | null;
  Payment_For__c?: string | null;
};

// Hanya Father & Mother yang tidak boleh dobel (bisa diubah nanti)
const SINGLETON_TYPES = new Set<string>(["Father", "Mother"]);

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
  orangTua: Record<string, unknown> | ParentRel[];
  dokumen: Doc[];
  apiBase: string;
  photoVersionId: string | null;
  payments: PaymentInfo[];
  relTypeOptions: string[]; // dari server (describe picklist)
};

function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}
function isPrimitive(v: unknown): v is string | number | boolean | null {
  return typeof v === "string" || typeof v === "number" || typeof v === "boolean" || v === null;
}
function diff(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) !== JSON.stringify(b);
}
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
function Spinner({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-30" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}
function typeDisabledInRow(type: string, i: number, list: ParentRel[]) {
  if (!SINGLETON_TYPES.has(type)) return false;
  return list.some((p, j) => j !== i && p.type === type);
}
function blankParent(): ParentRel {
  return { type: "", name: "", job: "", phone: "", email: "", address: "", locked: false };
}

const fmtIDR = (v?: number | null) =>
  typeof v === "number" ? new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(v) : "—";

export default function ProgressDetailClient({
  id,
  siswa,
  orangTua,
  dokumen,
  apiBase,
  photoVersionId,
  payments,
  relTypeOptions,
}: ProgressDetailClientProps) {
  const photoUrl = photoVersionId ? `${apiBase}/api/salesforce/files/version/${photoVersionId}/data` : "/default-avatar.png";

  // Sumber dropdown Type__c (fallback ke Father/Mother kalau server kosong)
  const REL_TYPE_OPTIONS: string[] = relTypeOptions && relTypeOptions.length > 0 ? relTypeOptions : ["Father", "Mother", "Son"];

  const isOrtuArray = Array.isArray(orangTua);

  // Originals
  const originalSiswa = useMemo(() => deepClone(siswa), [siswa]);
  const originalOrtuObj = useMemo<Record<string, unknown>>(
    () => (isOrtuArray ? {} : deepClone((orangTua && typeof orangTua === "object") ? (orangTua as Record<string, unknown>) : {})),
    [orangTua, isOrtuArray]
  );
  const originalOrtuArr = useMemo<ParentRel[]>(
    () => (!isOrtuArray ? [] : deepClone(orangTua as ParentRel[]).map((p) => ({ ...p, locked: true }))),
    [orangTua, isOrtuArray]
  );
  const originalDocs = useMemo(() => deepClone(dokumen), [dokumen]);

  // Editable
  const [siswaEdit, setSiswaEdit] = useState<Record<string, unknown>>(deepClone(siswa));
  const [ortuObjEdit, setOrtuObjEdit] = useState<Record<string, unknown>>(originalOrtuObj);
  const [ortuArrEdit, setOrtuArrEdit] = useState<ParentRel[]>(originalOrtuArr);
  const [docsEdit, setDocsEdit] = useState<Doc[]>(deepClone(dokumen));

  const siswaDirty = diff(originalSiswa, siswaEdit);
  const ortuDirty = isOrtuArray ? diff(originalOrtuArr, ortuArrEdit) : diff(originalOrtuObj, ortuObjEdit);

  const [savingSegment, setSavingSegment] = useState<"siswa" | "orangTua" | "dokumen" | null>(null);
  const saving = savingSegment !== null;

  // Docs helpers
  const getType = (d: Doc): string => d.Document_Type__c ?? d.Type__c ?? "";
  const getDocOpenUrl = (d: Doc): string =>
    d.ContentVersionId ? `/api/salesforce/files/version/${d.ContentVersionId}/data` : d.Document_Link__c ?? d.Url__c ?? "";

  const docsByType = useMemo(() => {
    const m = new Map<string, Doc>();
    for (const d of docsEdit) {
      const t = getType(d);
      if (t && !m.has(t)) m.set(t, d);
    }
    return m;
  }, [docsEdit]);

  const [pendingUploads, setPendingUploads] = useState<Record<string, File | null>>({});
  const docsDirty = diff(originalDocs, docsEdit) || Object.values(pendingUploads).some(Boolean);

  function onPickFile(type: RequiredType, file: File | null) {
    setPendingUploads((prev) => ({ ...prev, [type]: file }));
  }
  function ensureDocEntryFor(type: RequiredType) {
    if (docsByType.get(type)) return;
    setDocsEdit((prev) => [...prev, { Id: undefined, Name: type, Document_Type__c: type, Document_Link__c: "" }]);
  }

  async function saveSegment(segment: "siswa" | "orangTua" | "dokumen") {
    const body: {
      segment: "siswa" | "orangTua" | "dokumen";
      id: string;
      siswa?: Record<string, unknown>;
      orangTua?: Record<string, unknown> | ParentRel[];
      dokumen?: Doc[];
    } = { segment, id };

    try {
      setSavingSegment(segment);

      if (segment === "dokumen") {
        const entries = Object.entries(pendingUploads) as [RequiredType, File | null][];
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
              relateToId: id,
              accountId: (siswa as { Id?: string }).Id,
              documentType: type,
            }),
          });
          if (!res.ok) throw new Error(await res.text());
          const json: { ok: boolean; downloadUrl?: string } = await res.json();
          if (!json.ok || !json.downloadUrl) throw new Error("Upload response invalid");

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

        setDocsEdit(nextDocs);
        body.dokumen = nextDocs;
      } else if (segment === "siswa") {
        body.siswa = siswaEdit;
      } else if (segment === "orangTua") {
        if (isOrtuArray) {
          // validasi Father/Mother tidak dobel
          const seen = new Set<string>();
          for (const p of ortuArrEdit) {
            if (SINGLETON_TYPES.has(p.type)) {
              if (seen.has(p.type)) {
                await Swal.fire({
                  icon: "warning",
                  title: "Tipe dobel",
                  text: `Tipe "${p.type}" sudah dipakai. Father/Mother hanya boleh satu.`,
                  confirmButtonText: "OK",
                });
                setSavingSegment(null);
                return;
              }
              seen.add(p.type);
            }
          }
          body.orangTua = ortuArrEdit.map(({ locked, ...rest }) => rest);
        } else {
          body.orangTua = ortuObjEdit;
        }
      }

      const res = await fetch(`${apiBase}/api/salesforce/progress/${id}`, {
        method: "PATCH",
        cache: "no-store",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());

      // Sync originals
      if (segment === "dokumen") {
        (originalDocs as Doc[]).length = 0;
        (originalDocs as Doc[]).push(...JSON.parse(JSON.stringify(docsEdit)));
        setPendingUploads({});
      } else if (segment === "siswa") {
        Object.assign(originalSiswa as object, JSON.parse(JSON.stringify(siswaEdit)));
      } else if (segment === "orangTua") {
        if (isOrtuArray) {
          const locked = ortuArrEdit.map((p) => ({ ...p, locked: true }));
          setOrtuArrEdit(locked);
          (originalOrtuArr as ParentRel[]).length = 0;
          (originalOrtuArr as ParentRel[]).push(...deepClone(locked));
        } else {
          Object.assign(originalOrtuObj as object, deepClone(ortuObjEdit));
        }
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
      const msg = err instanceof Error ? err.message : "Gagal menyimpan.";
      await Swal.fire({ icon: "error", title: "Gagal menyimpan", text: msg, confirmButtonText: "OK" });
    } finally {
      setSavingSegment(null);
    }
  }

  // Readonly rules
  function isReadOnly(key: string, val: unknown) {
    if (key === "Name" || key === "PersonEmail") return true;
    if (key === "Phone") return String(val ?? "").trim() !== "";
    return false;
  }
  const HIDDEN_KEYS = ["Id", "PhotoUrl", "IsPersonAccount", "PersonContactId", "Master_School__c", "Master_School__r"];
  const schoolName =
    (siswaEdit?.["Master_School__r"] as { Name?: string } | undefined)?.Name ??
    String(siswaEdit?.["Master_School__c"] ?? "");

  return (
    <>
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
        {/* LEFT: Account */}
        <div className="relative rounded-[28px] bg-white/90 backdrop-blur-sm shadow-2xl ring-1 ring-white/40 p-6">
          <div className="text-lg font-semibold text-slate-700 mb-4">data account</div>

          {/* Siswa */}
          <div className="rounded-3xl border border-gray-200 bg-white shadow-sm hover:shadow-md transition-all p-6 md:p-7 mb-4">
            <div className="text-base font-medium mb-3 text-slate-700">data siswa</div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
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

              <div className="md:col-span-2">
                {renderObjectEditor(siswaEdit, setSiswaEdit, HIDDEN_KEYS, isReadOnly, saving)}

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
                  {savingSegment === "siswa" ? (
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

          {/* Orang Tua */}
          <div className="rounded-3xl border border-gray-200 bg-white shadow-sm hover:shadow-md transition-all p-6 md:p-7 mb-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-base font-medium text-slate-700">data orang tua</div>

              {/* Add button only for array mode */}
              {isOrtuArray && (
                <button
                  className="text-sm px-3 py-1 rounded-lg bg-gray-900 text-white disabled:opacity-60"
                  disabled={saving}
                  onClick={() => {
                    const used = new Set(ortuArrEdit.map((p) => p.type).filter(Boolean));
                    const order = [...REL_TYPE_OPTIONS];
                    const firstFree = order.find((t) => !used.has(t)) ?? "";
                    setOrtuArrEdit((prev) => [...prev, { ...blankParent(), type: firstFree }]);
                  }}
                >
                  + Add
                </button>
              )}
            </div>

            {/* Object mode (original) */}
            {!isOrtuArray && renderObjectEditor(ortuObjEdit, setOrtuObjEdit, [], isReadOnly, saving)}

            {/* Array mode */}
            {isOrtuArray && (
              <>
                {ortuArrEdit.length === 0 ? (
                  <div className="text-sm text-gray-500">Belum ada data orang tua.</div>
                ) : (
                  <div className="space-y-4">
                    {ortuArrEdit.map((p, idx) => {
                      const isLocked = !!p.locked || !!p.relationshipId;
                      const roCls = isLocked ? "bg-gray-100 text-gray-500 cursor-not-allowed" : "";
                      return (
                        <div key={idx} className="rounded-2xl border border-gray-200 p-4 bg-white">
                          <div className="flex items-center justify-between mb-3">
                            <div className="text-sm font-medium text-slate-700">Orang Tua #{idx + 1}</div>
                            {!isLocked && (
                              <button
                                className="text-xs text-rose-600 underline disabled:opacity-60"
                                disabled={saving}
                                onClick={() => setOrtuArrEdit((prev) => prev.filter((_, i) => i !== idx))}
                              >
                                Remove
                              </button>
                            )}
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {/* Type */}
                            <label className="flex flex-col text-sm">
                              <span className="mb-1 text-gray-600">Type</span>
                              <select
                                className={`border rounded px-3 py-2 ${roCls}`}
                                value={p.type}
                                onChange={(e) =>
                                  setOrtuArrEdit((prev) => {
                                    const next = [...prev];
                                    next[idx] = { ...next[idx], type: e.target.value };
                                    return next;
                                  })
                                }
                                disabled={isLocked || saving}
                              >
                                <option value="">-- pilih --</option>
                                {REL_TYPE_OPTIONS.map((t) => {
                                  const disabled = typeDisabledInRow(t, idx, ortuArrEdit);
                                  return (
                                    <option key={t} value={t} disabled={disabled}>
                                      {t}
                                      {disabled ? " (sudah dipakai)" : ""}
                                    </option>
                                  );
                                })}
                              </select>
                            </label>

                            {/* Name */}
                            <label className="flex flex-col text-sm">
                              <span className="mb-1 text-gray-600">Name</span>
                              <input
                                className={`border rounded px-3 py-2 ${roCls}`}
                                value={p.name}
                                onChange={(e) =>
                                  setOrtuArrEdit((prev) => {
                                    const next = [...prev];
                                    next[idx] = { ...next[idx], name: e.target.value };
                                    return next;
                                  })
                                }
                                disabled={isLocked || saving}
                                placeholder="Nama lengkap"
                              />
                            </label>

                            {/* Job */}
                            <label className="flex flex-col text-sm">
                              <span className="mb-1 text-gray-600">Job</span>
                              <input
                                className={`border rounded px-3 py-2 ${roCls}`}
                                value={p.job}
                                onChange={(e) =>
                                  setOrtuArrEdit((prev) => {
                                    const next = [...prev];
                                    next[idx] = { ...next[idx], job: e.target.value };
                                    return next;
                                  })
                                }
                                disabled={isLocked || saving}
                                placeholder="Pekerjaan (Title)"
                              />
                            </label>

                            {/* Phone */}
                            <label className="flex flex-col text-sm">
                              <span className="mb-1 text-gray-600">Phone</span>
                              <input
                                className={`border rounded px-3 py-2 ${roCls}`}
                                value={p.phone}
                                onChange={(e) =>
                                  setOrtuArrEdit((prev) => {
                                    const next = [...prev];
                                    next[idx] = { ...next[idx], phone: e.target.value };
                                    return next;
                                  })
                                }
                                disabled={isLocked || saving}
                                placeholder="08xxxxxxxxxx"
                              />
                            </label>

                            {/* Email */}
                            <label className="flex flex-col text-sm md:col-span-2">
                              <span className="mb-1 text-gray-600">Email</span>
                              <input
                                className={`border rounded px-3 py-2 ${roCls}`}
                                value={p.email}
                                onChange={(e) =>
                                  setOrtuArrEdit((prev) => {
                                    const next = [...prev];
                                    next[idx] = { ...next[idx], email: e.target.value };
                                    return next;
                                  })
                                }
                                disabled={isLocked || saving}
                                placeholder="email@domain.com"
                                type="email"
                              />
                            </label>

                            {/* Address */}
                            <label className="flex flex-col text-sm md:col-span-2">
                              <span className="mb-1 text-gray-600">Address</span>
                              <textarea
                                className={`border rounded px-3 py-2 ${roCls}`}
                                rows={2}
                                value={p.address}
                                onChange={(e) =>
                                  setOrtuArrEdit((prev) => {
                                    const next = [...prev];
                                    next[idx] = { ...next[idx], address: e.target.value };
                                    return next;
                                  })
                                }
                                disabled={isLocked || saving}
                                placeholder="Alamat lengkap"
                              />
                            </label>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}

            {ortuDirty && (
              <div className="flex justify-end mt-4">
                <button
                  className="px-4 py-2 rounded-lg bg-black text-white shadow disabled:opacity-60"
                  onClick={() => saveSegment("orangTua")}
                  disabled={saving}
                >
                  {savingSegment === "orangTua" ? (
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

          {/* Payments */}
          <div className="rounded-3xl border border-gray-200 bg-white shadow-sm hover:shadow-md transition-all p-6 md:p-7">
            <div className="text-base font-medium text-slate-700 mb-3">Payment Information</div>

            {!payments || payments.length === 0 ? (
              <div className="text-sm text-gray-500">Belum ada Payment Information.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-slate-600">
                      <th className="py-2 pr-4">Amount</th>
                      <th className="py-2 pr-4">Payment Status</th>
                      <th className="py-2 pr-4">Payment For</th>
                      <th className="py-2 pr-4">Payment Channel Bank</th>
                      <th className="py-2 pr-4">Virtual Account No</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map((p) => (
                      <tr key={p.Id} className="border-t border-gray-100">
                        <td className="py-2 pr-4 whitespace-nowrap">{fmtIDR(p.Amount__c)}</td>
                        <td className="py-2 pr-4">{p.Payment_Status__c ?? "—"}</td>
                        <td className="py-2 pr-4">{p.Payment_For__c ?? "—"}</td>
                        <td className="py-2 pr-4">{p.Payment_Channel__r?.Payment_Channel_Bank__c ?? "—"}</td>
                        <td className="py-2 pr-4">{p.Virtual_Account_No__c ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: Dokumen */}
        <div className="relative rounded-[28px] bg-white/90 backdrop-blur-sm shadow-2xl ring-1 ring-white/40 p-6">
          <div className="text-lg font-semibold text-slate-700 mb-4">data application progres</div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {REQUIRED_TYPES.map((type) => {
              const existing = docsByType.get(type);
              const uploaded = !!existing && !!getDocOpenUrl(existing!);

              return (
                <div key={type} className="rounded-3xl border border-gray-200 bg-white shadow-sm hover:shadow-md transition-all p-6 md:p-7">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="text-sm font-medium text-slate-700">{type}</div>
                      <div className={`text-xs mt-1 ${uploaded ? "text-emerald-600" : "text-rose-600"}`}>{uploaded ? "Uploaded" : "Not Uploaded"}</div>
                    </div>

                    {uploaded && existing && (
                      <a href={getDocOpenUrl(existing)} target="_blank" rel="noopener noreferrer" className="text-xs underline text-blue-600">
                        Open
                      </a>
                    )}
                  </div>

                  <div className="mb-3">
                    <label className="block text-xs text-gray-600 mb-1">Document Type</label>
                    <select className="w-full border rounded px-3 py-2 text-sm bg-gray-50" value={existing ? getType(existing) : type} disabled>
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
                  {pendingUploads[type] && <div className="text-xs text-gray-600 mt-2 break-words">Selected: {pendingUploads[type]?.name}</div>}
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
                {savingSegment === "dokumen" ? (
                  <span className="inline-flex items-center gap-2">
                    <Spinner className="h-4 w-4" /> Saving...
                  </span>
                ) : (
                  "save"
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function renderObjectEditor(
  obj: Record<string, unknown>,
  setObj: (v: Record<string, unknown>) => void,
  omitKeys: string[],
  isReadOnly: (key: string, val: unknown) => boolean,
  saving: boolean
) {
  const entries = Object.entries(obj).filter(([k, v]) => !omitKeys.includes(k) && isPrimitive(v));

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
                onChange={(e) => setObj({ ...(obj as Record<string, unknown>), [key]: e.target.value === "true" })}
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
              onChange={(e) => setObj({ ...(obj as Record<string, unknown>), [key]: e.target.value })}
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
