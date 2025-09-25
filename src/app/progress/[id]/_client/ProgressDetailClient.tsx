"use client";

import { useMemo, useState } from "react";

/* ===================== Types ===================== */

type Doc = {
  Id?: string;
  Name?: string;
  Type__c?: string | null;
  Url__c?: string | null;
  Document_Type__c?: string | null;
  Document_Link__c?: string | null;
};

const REL_TYPE_OPTIONS = [
  "Father",
  "Mother",
  "Daughter",
  "Son",
  "Sister",
  "Brother",
] as const;
type RelType = (typeof REL_TYPE_OPTIONS)[number];

/** hanya tipe yang harus unik */
const SINGLETON_TYPES = new Set<RelType>(["Father", "Mother"]);

type ParentRel = {
  relationshipId?: string;
  type: RelType | "";
  contactId?: string;
  name: string;
  job: string;
  phone: string;
  email: string;
  address: string;
  /** UI flag: true = read-only */
  locked?: boolean;
};

type ProgressDetailClientProps = {
  id: string;
  siswa: Record<string, unknown>;
  orangTua: ParentRel[] | Record<string, any>;
  dokumen: Doc[];
  apiBase: string;
  cookieHeader: string;
  photoVersionId: string | null;
};

/* ===================== Utils ===================== */

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
async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
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

function blankParent(): ParentRel {
  return {
    type: "",
    name: "",
    job: "",
    phone: "",
    email: "",
    address: "",
    locked: false,
  };
}

/** true jika type T sudah dipakai entri lain (idx ≠ i) dan type itu singleton */
function typeDisabledInRow(type: RelType, i: number, list: ParentRel[]) {
  if (!SINGLETON_TYPES.has(type)) return false;
  return list.some((p, j) => j !== i && p.type === type);
}

/* ===================== Component ===================== */

export default function ProgressDetailClient({
  id,
  siswa,
  orangTua,
  dokumen,
  apiBase,
  cookieHeader,
  photoVersionId,
}: ProgressDetailClientProps) {
  /* ===== FOTO ===== */
  const photoUrl = photoVersionId
    ? `${apiBase}/api/salesforce/files/version/${photoVersionId}/data`
    : "/default-avatar.png";

  /* ===== ORIGINALS ===== */
  const originalSiswa = useMemo(() => deepClone(siswa), [siswa]);

  // Semua entri orang tua dari server dianggap sudah tersimpan → locked
  const originalOrtu = useMemo<ParentRel[]>(() => {
    const raw = Array.isArray(orangTua) ? orangTua : [];
    return (deepClone(raw) as ParentRel[]).map((p) => ({
      ...p,
      locked: true, // existing entries are read-only
    }));
  }, [orangTua]);

  const originalDocs = useMemo(() => deepClone(dokumen), [dokumen]);

  /* ===== EDITABLE ===== */
  const [siswaEdit, setSiswaEdit] =
    useState<Record<string, unknown>>(deepClone(siswa));
  const [ortuEdit, setOrtuEdit] =
    useState<ParentRel[]>(deepClone(originalOrtu));
  const [docsEdit, setDocsEdit] = useState<Doc[]>(deepClone(dokumen));

  const siswaDirty = diff(originalSiswa, siswaEdit);
  const ortuDirty = diff(originalOrtu, ortuEdit);
  const [saving, setSaving] = useState<"siswa" | "orangTua" | "dokumen" | null>(null);

  /* ===================== SAVE ===================== */
  async function saveSegment(segment: "siswa" | "orangTua" | "dokumen") {
    const body: {
      segment: "siswa" | "orangTua" | "dokumen";
      id: string;
      siswa?: Record<string, unknown>;
      orangTua?: ParentRel[];
      dokumen?: Doc[];
    } = { segment, id };

    try {
      setSaving(segment);

      if (segment === "dokumen") {
        const entries = Object.entries(pendingUploads) as [RequiredType, File | null][];
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
              accountId: siswa.Id,
              documentType: type,
            }),
          });
          if (!res.ok) throw new Error(await res.text());
          const json: { ok: boolean; downloadUrl?: string } = await res.json();
          if (!json.ok || !json.downloadUrl) throw new Error("Upload response invalid");

          setDocsEdit((prev) => {
            const next = [...prev];
            const idx = next.findIndex((d) => getType(d) === type);
            if (idx >= 0) {
              const copy = { ...next[idx] };
              setLinkMutable(copy, json.downloadUrl || "");
              next[idx] = copy;
            } else {
              next.push({
                Name: type,
                Document_Type__c: type,
                Document_Link__c: json.downloadUrl,
              });
            }
            return next;
          });
        }
        body.dokumen = docsEdit;
      } else if (segment === "siswa") {
        body.siswa = siswaEdit;
      } else if (segment === "orangTua") {
        // validasi: Father/Mother tidak boleh dobel
        const seen = new Set<RelType>();
        for (const p of ortuEdit) {
          if (SINGLETON_TYPES.has(p.type as RelType)) {
            if (seen.has(p.type as RelType)) {
              alert(`Tipe "${p.type}" sudah dipakai. Father/Mother hanya boleh satu.`);
              setSaving(null);
              return;
            }
            seen.add(p.type as RelType);
          }
        }
        body.orangTua = ortuEdit.map((p) => {
          const { locked, ...rest } = p;
          return rest;
        });
      }

      const res = await fetch(`${apiBase}/api/salesforce/progress/${id}`, {
        method: "PATCH",
        cache: "no-store",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());

      // sync originals & lock parents after save
      if (segment === "dokumen") {
        (originalDocs as Doc[]).length = 0;
        (originalDocs as Doc[]).push(...JSON.parse(JSON.stringify(docsEdit)));
        setPendingUploads({});
      } else if (segment === "siswa") {
        Object.assign(originalSiswa as object, JSON.parse(JSON.stringify(siswaEdit)));
      } else if (segment === "orangTua") {
        // lock semua entri yang baru disimpan
        setOrtuEdit((prev) => prev.map((p) => ({ ...p, locked: true })));
        (originalOrtu as ParentRel[]).length = 0;
        (originalOrtu as ParentRel[]).push(
          ...JSON.parse(JSON.stringify(ortuEdit)).map((p: ParentRel) => ({
            ...p,
            locked: true,
          }))
        );
      }

      alert("Berhasil disimpan.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Gagal menyimpan.";
      alert(msg);
    } finally {
      setSaving(null);
    }
  }

  /* ===================== Readonly rules (Siswa) ===================== */
  function isReadOnly(
    key: string,
    _currentVal: unknown,
    originalObj?: Record<string, unknown>
  ) {
    if (key === "Name" || key === "PersonEmail") return true;
    if (key === "Phone" || key === "PersonBirthdate") {
      const originalVal = originalObj ? originalObj[key] : null;
      return String(originalVal ?? "").trim() !== "";
    }
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

  function renderObjectEditor(
    obj: Record<string, unknown>,
    setObj: (v: Record<string, unknown>) => void,
    omitKeys: string[] = [],
    originalObj?: Record<string, unknown>
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
          const readOnly = isReadOnly(key, val, originalObj);
          const roCls = readOnly ? "bg-gray-100 text-gray-500 cursor-not-allowed" : "";

          if (typeof val === "boolean") {
            return (
              <label key={key} className="flex flex-col text-sm">
                <span className="mb-1 text-gray-600">{LABELS[key] ?? key}</span>
                <select
                  className={`border rounded px-3 py-2 ${roCls}`}
                  value={String(val)}
                  onChange={(e) =>
                    setObj({ ...(obj as Record<string, unknown>), [key]: e.target.value === "true" })
                  }
                  disabled={readOnly}
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
                  setObj({ ...(obj as Record<string, unknown>), [key]: e.target.value })
                }
                readOnly={readOnly}
                disabled={readOnly}
                placeholder={isBirthdate ? "yyyy-mm-dd" : undefined}
              />
            </label>
          );
        })}
      </div>
    );
  }

  /* ===================== Dokumen (kanan) ===================== */
  const getType = (d: Doc): string => d.Document_Type__c ?? d.Type__c ?? "";
  const getLink = (d: Doc): string => d.Document_Link__c ?? d.Url__c ?? "";
  const setLinkMutable = (d: Doc, v: string) => {
    if ("Document_Link__c" in d) d.Document_Link__c = v;
    else d.Url__c = v;
  };

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

  /* ===================== UI ===================== */
  return (
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
              {renderObjectEditor(
                siswaEdit,
                setSiswaEdit,
                HIDDEN_KEYS,
                originalSiswa as Record<string, unknown>
              )}

              {/* School readonly */}
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
                disabled={saving === "siswa"}
                onClick={() => saveSegment("siswa")}
              >
                {saving === "siswa" ? "Saving..." : "Save"}
              </button>
            </div>
          )}
        </div>

        {/* data orang tua */}
        <div className="rounded-3xl border border-gray-200 bg-white shadow-sm hover:shadow-md transition-all p-6 md:p-7 mb-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-base font-medium text-slate-700">data orang tua</div>
            <button
              className="text-sm px-3 py-1 rounded-lg bg-gray-900 text-white"
              onClick={() => {
                // pilih type default yang belum dipakai (prioritaskan Father/Mother)
                const used = new Set(ortuEdit.map((p) => p.type).filter(Boolean) as RelType[]);
                const order: RelType[] = [
                  "Father",
                  "Mother",
                  "Daughter",
                  "Son",
                  "Sister",
                  "Brother",
                ];
                const firstFree = order.find((t) => !used.has(t)) ?? "";
                setOrtuEdit((prev) => [...prev, { ...blankParent(), type: firstFree as RelType }]);
              }}
            >
              + Add
            </button>
          </div>

          {ortuEdit.length === 0 ? (
            <div className="text-sm text-gray-500">Belum ada data orang tua.</div>
          ) : (
            <div className="space-y-4">
              {ortuEdit.map((p, idx) => {
                const isLocked = !!p.locked || !!p.relationshipId;
                const roCls = isLocked ? "bg-gray-100 text-gray-500 cursor-not-allowed" : "";
                return (
                  <div key={idx} className="rounded-2xl border border-gray-200 p-4 bg-white">
                    <div className="flex items-center justify-between mb-3">
                      <div className="text-sm font-medium text-slate-700">Orang Tua #{idx + 1}</div>
                      {!isLocked && (
                        <button
                          className="text-xs text-rose-600 underline"
                          onClick={() =>
                            setOrtuEdit((prev) => prev.filter((_, i) => i !== idx))
                          }
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
                            setOrtuEdit((prev) => {
                              const next = [...prev];
                              next[idx] = { ...next[idx], type: e.target.value as RelType };
                              return next;
                            })
                          }
                          disabled={isLocked}
                        >
                          <option value="">-- pilih --</option>
                          {REL_TYPE_OPTIONS.map((t) => {
                            const disabled = typeDisabledInRow(t as RelType, idx, ortuEdit);
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
                            setOrtuEdit((prev) => {
                              const next = [...prev];
                              next[idx] = { ...next[idx], name: e.target.value };
                              return next;
                            })
                          }
                          disabled={isLocked}
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
                            setOrtuEdit((prev) => {
                              const next = [...prev];
                              next[idx] = { ...next[idx], job: e.target.value };
                              return next;
                            })
                          }
                          disabled={isLocked}
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
                            setOrtuEdit((prev) => {
                              const next = [...prev];
                              next[idx] = { ...next[idx], phone: e.target.value };
                              return next;
                            })
                          }
                          disabled={isLocked}
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
                            setOrtuEdit((prev) => {
                              const next = [...prev];
                              next[idx] = { ...next[idx], email: e.target.value };
                              return next;
                            })
                          }
                          disabled={isLocked}
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
                            setOrtuEdit((prev) => {
                              const next = [...prev];
                              next[idx] = { ...next[idx], address: e.target.value };
                              return next;
                            })
                          }
                          disabled={isLocked}
                          placeholder="Alamat lengkap"
                        />
                      </label>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {ortuDirty && (
            <div className="flex justify-end mt-4">
              <button
                className="px-4 py-2 rounded-lg bg-black text-white shadow disabled:opacity-60"
                disabled={saving === "orangTua"}
                onClick={() => saveSegment("orangTua")}
              >
                {saving === "orangTua" ? "Saving..." : "Save"}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* KANAN: dokumen */}
      <div className="relative rounded-[28px] bg-white/90 backdrop-blur-sm shadow-2xl ring-1 ring-white/40 p-6">
        <div className="text-lg font-semibold text-slate-700 mb-4">data application progres</div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {REQUIRED_TYPES.map((type) => {
            const existing = docsByType.get(type);
            const uploaded = !!existing && !!getLink(existing!);

            return (
              <div
                key={type}
                className="rounded-3xl border border-gray-200 bg-white shadow-sm hover:shadow-md transition-all p-6 md:p-7"
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="text-sm font-medium text-slate-700">{type}</div>
                    <div
                      className={`text-xs mt-1 ${uploaded ? "text-emerald-600" : "text-rose-600"}`}
                    >
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
                    className="block w-full text-xs"
                    onChange={(e) => {
                      const f = e.target.files?.[0] || null;
                      onPickFile(type as RequiredType, f);
                      ensureDocEntryFor(type as RequiredType);
                    }}
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
              disabled={saving === "dokumen"}
              onClick={() => saveSegment("dokumen")}
            >
              {saving === "dokumen" ? "Saving..." : "Save"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
