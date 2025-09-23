"use client";

import { useMemo, useState } from "react";

type Doc = {
  Id?: string;
  Name?: string;
  Type__c?: string | null;
  Url__c?: string | null;
  // kompatibel dengan varian field lain:
  Document_Type__c?: string | null;
  Document_Link__c?: string | null;
};

function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}
function isPrimitive(v: unknown) {
  return (
    typeof v === "string" ||
    typeof v === "number" ||
    typeof v === "boolean" ||
    v === null
  );
}
function diff(a: any, b: any) {
  return JSON.stringify(a) !== JSON.stringify(b);
}

export default function ProgressDetailClient({
  id,
  siswa,
  orangTua,
  dokumen,
  apiBase,
  cookieHeader,
  photoVersionId,
}: {
  id: string;
  siswa: Record<string, unknown>;
  orangTua: Record<string, unknown>;
  dokumen: Doc[];
  apiBase: string;
  cookieHeader: string;
  photoVersionId: string | null;
}) {
  // ===== FOTO (SF ContentVersion proxy) =====
  const photoUrl = photoVersionId
  ? `${apiBase}/api/salesforce/files/version/${photoVersionId}/data`
  : "/default-avatar.png"; // pastikan file ini ada di /public

  // ===== STATE =====
  const originalSiswa = useMemo(() => deepClone(siswa), [siswa]);
  const originalOrtu = useMemo(() => deepClone(orangTua), [orangTua]);
  const originalDocs = useMemo(() => deepClone(dokumen), [dokumen]);

  const [siswaEdit, setSiswaEdit] = useState<Record<string, any>>(
    deepClone(siswa)
  );
  const [ortuEdit, setOrtuEdit] = useState<Record<string, any>>(
    deepClone(orangTua)
  );
  const [docsEdit, setDocsEdit] = useState<Doc[]>(deepClone(dokumen));

  const siswaDirty = diff(originalSiswa, siswaEdit);
  const ortuDirty = diff(originalOrtu, ortuEdit);

  // ===== SAVE =====
  async function saveSegment(segment: "siswa" | "orangTua" | "dokumen") {
    const body: any = { segment, id };
    if (segment === "siswa") body.siswa = siswaEdit;
    if (segment === "orangTua") body.orangTua = ortuEdit;
    if (segment === "dokumen") body.dokumen = docsEdit;

    const res = await fetch(`${apiBase}/api/salesforce/progress/${id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        cookie: cookieHeader,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const t = await res.text().catch(() => res.statusText);
      alert(`Gagal menyimpan (${segment}): ${t}`);
      return;
    }

    // reset originals
    if (segment === "siswa") Object.assign(originalSiswa, deepClone(siswaEdit));
    if (segment === "orangTua") Object.assign(originalOrtu, deepClone(ortuEdit));
    if (segment === "dokumen") {
      originalDocs.length = 0;
      originalDocs.push(...deepClone(docsEdit));
    }
    alert("Berhasil disimpan.");
  }

  // ===== UI helpers =====
  function renderObjectEditor(
    obj: Record<string, any>,
    setObj: (v: Record<string, any>) => void,
    omitKeys: string[] = []
  ) {
    const entries = Object.entries(obj).filter(
      ([k, v]) => !omitKeys.includes(k) && isPrimitive(v)
    );

    if (entries.length === 0) {
      return (
        <div className="text-sm text-gray-500">
          Tidak ada field yang dapat diedit.
        </div>
      );
    }

    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {entries.map(([key, val]) => (
          <label key={key} className="flex flex-col text-sm">
            <span className="mb-1 text-gray-600">{key}</span>
            {typeof val === "boolean" ? (
              <select
                className="border rounded px-3 py-2"
                value={String(val)}
                onChange={(e) =>
                  setObj({ ...obj, [key]: e.target.value === "true" })
                }
              >
                <option value="true">true</option>
                <option value="false">false</option>
              </select>
            ) : (
              <input
                className="border rounded px-3 py-2"
                value={val ?? ""}
                onChange={(e) => setObj({ ...obj, [key]: e.target.value })}
              />
            )}
          </label>
        ))}
      </div>
    );
  }

  // ===== Dokumen (grid kanan) =====
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

  function getType(d: any) {
    return d.Document_Type__c ?? d.Type__c ?? "";
  }
  function setType(d: any, v: string) {
    if ("Document_Type__c" in d) d.Document_Type__c = v;
    else d.Type__c = v;
  }
  function getLink(d: any) {
    return d.Document_Link__c ?? d.Url__c ?? "";
  }
  function setLink(d: any, v: string) {
    if ("Document_Link__c" in d) d.Document_Link__c = v;
    else d.Url__c = v;
  }

  const docsByType = useMemo(() => {
    const m = new Map<string, any>();
    for (const d of docsEdit) {
      const t = getType(d);
      if (t && !m.has(t)) m.set(t, d);
    }
    return m;
  }, [docsEdit]);

  const [pendingUploads, setPendingUploads] = useState<
    Record<string, File | null>
  >({});

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

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-6">
      {/* KIRI: data account */}
      <div className="relative rounded-[28px] bg-white/90 backdrop-blur-sm shadow-2xl ring-1 ring-white/40 p-6">
        <div className="text-lg font-semibold text-slate-700 mb-4">
          data account
        </div>

        {/* data siswa */}
        <div className="rounded-3xl border border-gray-200 bg-white shadow-sm hover:shadow-md transition-all p-6 md:p-7 mb-4">
          <div className="text-base font-medium mb-3 text-slate-700">
            data siswa
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
            {/* FOTO KIRI (3×4, tajam) */}
            <div className="flex flex-col items-center">
              <div
                className="
                  relative overflow-hidden rounded-2xl ring-1 ring-black/5 shadow
                  w-32 md:w-36
                  aspect-[3/4]      /* kunci rasio 3:4 */
                  bg-white
                "
                // Jika arbitrary values tailwind tidak aktif, bisa pakai:
                // style={{ aspectRatio: "3 / 4" }}
              >
                {photoUrl ? (
                  <img
                    src={photoUrl}
                    alt="Foto Siswa"
                    className="absolute inset-0 h-full w-full object-cover object-center"
                    loading="eager"
                    fetchPriority="high"
                    decoding="async"
                  />
                ) : (
                  <img
                    src="/avatar-placeholder.png"
                    alt="Foto Siswa"
                    className="absolute inset-0 h-full w-full object-cover object-center"
                  />
                )}
              </div>
            </div>

            {/* DATA KANAN */}
            <div className="md:col-span-2">
              {renderObjectEditor(siswaEdit, setSiswaEdit, ["Id", "PhotoUrl"])}
            </div>
          </div>

          {siswaDirty && (
            <div className="flex justify-end mt-4">
              <button
                className="px-4 py-2 rounded-lg bg-black text-white shadow"
                onClick={() => saveSegment("siswa")}
              >
                Save
              </button>
            </div>
          )}
        </div>

        {/* data orang tua (gabungan/placeholder) */}
        <div className="rounded-3xl border border-gray-200 bg-white shadow-sm hover:shadow-md transition-all p-6 md:p-7 mb-4">
          <div className="text-base font-medium mb-3 text-slate-700">
            data orang tua
          </div>
          {renderObjectEditor(ortuEdit, setOrtuEdit)}
          {ortuDirty && (
            <div className="flex justify-end mt-4">
              <button
                className="px-4 py-2 rounded-lg bg-black text-white shadow"
                onClick={() => saveSegment("orangTua")}
              >
                Save
              </button>
            </div>
          )}
        </div>
      </div>

      {/* KANAN: data application progress (dokumen) */}
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
                {/* header + status */}
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="text-sm font-medium text-slate-700">
                      {type}
                    </div>
                    <div
                      className={`text-xs mt-1 ${
                        uploaded ? "text-emerald-600" : "text-rose-600"
                      }`}
                    >
                      {uploaded ? "Uploaded" : "Not Uploaded"}
                    </div>
                  </div>

                  {uploaded && (
                    <a
                      href={getLink(existing)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs underline text-blue-600"
                    >
                      Open
                    </a>
                  )}
                </div>

                {/* pilih tipe */}
                <div className="mb-3">
                  <label className="block text-xs text-gray-600 mb-1">
                    Document Type
                  </label>
                  <select
                    className="w-full border rounded px-3 py-2 text-sm bg-gray-50"
                    value={existing ? getType(existing) : type}
                    onChange={(e) => {
                      const next = e.target.value;
                      ensureDocEntryFor(type);
                      const draft = [...docsEdit];
                      const idx = draft.findIndex(
                        (x) => getType(x) === getType(existing ?? { Document_Type__c: type })
                      );
                      if (idx >= 0) setType(draft[idx], next);
                      setDocsEdit(draft);
                    }}
                  >
                    {REQUIRED_TYPES.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </div>

                {/* input link */}
                <div className="mb-3">
                  <label className="block text-xs text-gray-600 mb-1">
                    Document Link
                  </label>
                  <input
                    className="w-full border rounded px-3 py-2 text-sm"
                    value={existing ? getLink(existing) : ""}
                    onChange={(e) => {
                      ensureDocEntryFor(type);
                      const draft = [...docsEdit];
                      const idx = draft.findIndex((x) => getType(x) === type);
                      if (idx >= 0) setLink(draft[idx], e.target.value);
                      setDocsEdit(draft);
                    }}
                    placeholder="https://..."
                  />
                </div>

                {/* upload/replace (placeholder, integrasi upload SF bisa ditambahkan nanti) */}
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
              </div>
            );
          })}
        </div>

        {docsDirty && (
          <div className="flex justify-end mt-4">
            <button
              className="px-4 py-2 rounded-lg bg-black text-white shadow"
              onClick={() => saveSegment("dokumen")}
            >
              Save
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
