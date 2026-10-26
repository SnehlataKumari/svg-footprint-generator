"use client";

import { useEffect, useState } from "react";
import { editorStorage } from "@/lib/browser-store";
import { importInBrowser } from "@/lib/gis-import";
import { BUTTON, INPUT, LABEL, PRIMARY_BUTTON, SURFACE } from "../ui";

/** Image and world-file names a phase folder may hold (the rest — pyramids, stats — is skipped). */
const PHASE_FILE = /\.(webp|png|jpe?g|tiff?|wpw|pgw|jgw|jpw|tfw|tifw|wld)$/i;
const WORLD_FILE = /\.(wpw|pgw|jgw|jpw|tfw|tifw|wld)$/i;

interface Props {
  onClose: () => void;
  /** Open the new project (saves the current one first if needed). */
  onOpen: (name: string) => void;
}

/**
 * "Import from GIS files": a facilities spreadsheet + its GeoPDF map + the
 * masterplan + the phase images with world files → a new project with the
 * masterplan, a scene per phase, and every facility outlined, filled in and
 * shown with an icon (app/api/import-facilities, scripts/import-facilities.mjs).
 * The hosted editor reads the PDF and keeps the result in the browser (lib/gis-import.ts).
 */
export function ImportFacilities({ onClose, onOpen }: Props) {
  const [title, setTitle] = useState("");
  const [xlsx, setXlsx] = useState<File | null>(null);
  const [pdf, setPdf] = useState<File | null>(null);
  const [masterplan, setMasterplan] = useState<File | null>(null);
  const [phases, setPhases] = useState<File[]>([]);
  const [carryPlots, setCarryPlots] = useState(true);
  const [busy, setBusy] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [step, setStep] = useState("Importing…");
  const [result, setResult] = useState<{ name: string; title: string; summary: string[] } | { error: string } | null>(null);

  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [busy]);

  const images = phases.filter((f) => !WORLD_FILE.test(f.name));
  const worldFiles = phases.filter((f) => WORLD_FILE.test(f.name));
  const ready = !!(xlsx && pdf && masterplan && images.length && worldFiles.length);

  const run = async () => {
    setSeconds(0);
    setStep("Importing…");
    setBusy(true);
    setResult(null);
    try {
      const name = title.trim() || masterplan?.name.replace(/\.[^.]+$/, "") || "Imported project";
      let data: { name?: string; title?: string; log?: string; error?: string };
      if (editorStorage() === "browser") {
        data = await importInBrowser({ title: name, xlsx: xlsx!, pdf: pdf!, masterplan: masterplan!, phases, carryPlots }, setStep);
      } else {
        const body = new FormData();
        body.append("title", name);
        body.append("xlsx", xlsx!);
        body.append("pdf", pdf!);
        body.append("masterplan", masterplan!);
        for (const f of phases) body.append("phases", f, f.name);
        body.append("carryPlots", carryPlots ? "1" : "0");
        const res = await fetch("/api/import-facilities", { method: "POST", body });
        data = await res.json().catch(() => ({ error: `Import failed (${res.status})` }));
        if (!res.ok) data.error ??= `Import failed (${res.status})`;
      }
      if (data.error || !data.name) return setResult({ error: data.error ?? "Import failed" });
      // the script's step lines make a readable summary
      const summary = (data.log ?? "")
        .split("\n")
        .filter((l) => /^\d\/6|misfit|carried over|skipped/.test(l.trim()))
        .map((l) => l.trim().replace(/^\d\/6\s*/, ""));
      setResult({ name: data.name, title: data.title ?? data.name, summary });
    } catch (e) {
      setResult({ error: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const fileRow = (label: string, hint: string, accept: string, file: File | null, set: (f: File | null) => void) => (
    <label className="block space-y-1">
      <span className={LABEL}>{label}</span>
      <input type="file" accept={accept} disabled={busy} className="block w-full text-sm file:mr-2 file:cursor-pointer file:rounded-md file:border file:border-black/10 file:bg-white file:px-2 file:py-1" onChange={(e) => set(e.target.files?.[0] ?? null)} />
      <span className="block text-xs text-neutral-500">{file ? `${file.name} · ${(file.size / 1e6).toFixed(1)} MB` : hint}</span>
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="import-title">
      <div className={`max-h-full w-full max-w-lg space-y-4 overflow-y-auto p-5 ${SURFACE}`}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="import-title" className="text-base font-semibold">Import from GIS files</h2>
            <p className="text-sm text-neutral-600">
              Builds a new project: the masterplan as the main scene, a scene per phase, and every facility outlined, named, filled in from the
              spreadsheet and shown with an icon — on the masterplan and on its phase.
            </p>
          </div>
          <button type="button" className="cursor-pointer px-1 text-neutral-400 hover:text-neutral-900" onClick={onClose} disabled={busy} aria-label="Close">
            ✕
          </button>
        </div>

        <label className="block space-y-1">
          <span className={LABEL}>Project name</span>
          <input className={INPUT} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Al Metlaa" disabled={busy} />
        </label>
        {fileRow("Facilities spreadsheet", "Excel (.xlsx): one row per facility — plot ID, type, cluster, area…", ".xlsx", xlsx, setXlsx)}
        {fileRow("Facilities map", "PDF exported from ArcGIS / QGIS as a GeoPDF, each facility labelled with its plot ID", ".pdf,application/pdf", pdf, setPdf)}
        {fileRow("Masterplan image", "The whole development — becomes the main scene", "image/*", masterplan, setMasterplan)}
        <label className="block space-y-1">
          <span className={LABEL}>Phase images folder</span>
          <input
            type="file"
            multiple
            disabled={busy}
            className="block w-full text-sm file:mr-2 file:cursor-pointer file:rounded-md file:border file:border-black/10 file:bg-white file:px-2 file:py-1"
            {...{ webkitdirectory: "", directory: "" }}
            onChange={(e) => setPhases([...(e.target.files ?? [])].filter((f) => PHASE_FILE.test(f.name)))}
          />
          <span className="block text-xs text-neutral-500">
            {phases.length
              ? `${images.length} images, ${worldFiles.length} world files${images.length !== worldFiles.length ? " — each image needs its world file (.wpw / .pgw / .jgw…)" : ""}`
              : "The folder with one image per phase (MT01.webp…) and its world file (MT01.wpw…)"}
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={carryPlots} onChange={(e) => setCarryPlots(e.target.checked)} disabled={busy} />
          <span>Carry over plots from the open project where a phase uses the same image</span>
        </label>

        {result && "error" in result && <p className="rounded-md bg-red-50 p-2 text-sm text-red-700">{result.error}</p>}
        {result && "name" in result && (
          <div className="space-y-2 rounded-md bg-emerald-50 p-3 text-sm">
            <p className="font-medium">“{result.title}” is ready.</p>
            <ul className="list-disc space-y-0.5 pl-5 text-neutral-700">
              {result.summary.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          {busy && <span className="mr-auto text-sm text-neutral-600">{step} {seconds}s (usually 1–2 minutes)</span>}
          <button type="button" className={BUTTON} onClick={onClose} disabled={busy}>
            {result && "name" in result ? "Close" : "Cancel"}
          </button>
          {result && "name" in result ? (
            <button type="button" className={PRIMARY_BUTTON} onClick={() => onOpen(result.name)}>
              Open “{result.title}”
            </button>
          ) : (
            <button type="button" className={PRIMARY_BUTTON} onClick={run} disabled={!ready || busy}>
              {busy ? "Importing…" : "Import"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
