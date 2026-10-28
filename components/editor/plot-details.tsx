"use client";

import { useEffect, useMemo, useState } from "react";
import { editorStorage } from "@/lib/browser-store";
import { STATUS_COLORS, templateCsv, type UnitDetails, withFiles } from "@/lib/plot-details";
import type { Project, Scene } from "@/lib/types";
import { BUTTON, LABEL, PRIMARY_BUTTON, SURFACE } from "../ui";

interface Props {
  project: Project;
  scene: Scene;
  onChange: (project: Project) => void;
  onStatus: (message: string, error?: boolean) => void;
  onClose: () => void;
}

type Row = { details: UnitDetails; errors: string[]; warnings?: string[] };
type Match = { row: Row; shapeId?: string; by?: "hotspotId" | "plotLabel" };

const lower = (s: string) => s.toLowerCase();
/** "MT03-V6-158(1)" / "… (2)": a second download of the same file. */
const COPY = /\s*\(\d+\)$/;

/** Each file's path inside the picked folder, without the folders all of them share (…/Cutsheets/MT09/MT09-V5-062.pdf → MT09/MT09-V5-062.pdf). */
function relativePaths(files: File[]): string[] {
  const parts = files.map((f) => (f.webkitRelativePath || f.name).split("/"));
  let common = 0;
  while (parts.length && parts.every((p) => p.length - 1 > common && p[common] === parts[0][common])) common++;
  return parts.map((p) => p.slice(common).join("/"));
}

/** Cutsheets by plot: file name = plot ID / label (lower case) → its path; the plain file over a "(1)" copy. */
function cutsheetIndex(files: File[]): Map<string, string> {
  const paths = relativePaths(files), out = new Map<string, string>();
  const entries = files.map((f, i) => ({ base: f.name.replace(/\.pdf$/i, ""), path: paths[i] })).filter((e, i) => /\.pdf$/i.test(files[i].name));
  for (const copy of [false, true])
    for (const e of entries) {
      const key = lower(e.base.replace(COPY, ""));
      if (COPY.test(e.base) === copy && !out.has(key)) out.set(key, e.path);
    }
  return out;
}

/** Facade files by facade option: "Type1.pdf", "Facade type 2.jpg" → Type1, Type2. */
function facadeIndex(files: File[]): Map<string, string> {
  const paths = relativePaths(files), out = new Map<string, string>();
  files.forEach((f, i) => {
    const n = f.name.match(/type\s*[-_]?\s*(\d)/i)?.[1];
    if (n && !out.has(`Type${n}`)) out.set(`Type${n}`, paths[i]);
  });
  return out;
}

const FOLDER_INPUT = "block w-full text-sm file:mr-2 file:cursor-pointer file:rounded-md file:border file:border-black/10 file:bg-white file:px-2 file:py-1";

/**
 * Plot details from a spreadsheet: one row per plot, keyed by hotspot ID (=
 * the plot's id here). Checked against the scene's plots, kept in the project
 * (the local copy) and published to Contentful as `unit` entries — the plot
 * outlines stay here, Contentful gets only the details.
 */
export function PlotDetails({ project, scene, onChange, onStatus, onClose }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [contentful, setContentful] = useState<{ publish: boolean; read: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rename, setRename] = useState(true);
  const [statusCategories, setStatusCategories] = useState(true);
  const [published, setPublished] = useState<{ ok: number; failed: { hotspotId: string; error?: string }[] } | null>(null);
  const [saved, setSaved] = useState<{ file: string; count: number } | null>(null);
  const [sheetFiles, setSheetFiles] = useState<File[]>([]);
  const [facadeFiles, setFacadeFiles] = useState<File[]>([]);

  const plots = useMemo(() => scene.shapes.filter((s) => s.kind === "polygon"), [scene.shapes]);
  const [fetchedExisting, setExisting] = useState<number | null>(null);
  const inBrowser = editorStorage() === "browser";
  useEffect(() => {
    let live = true;
    if (inBrowser) return;
    fetch("/api/plot-details").then((r) => r.json()).then((d: { details?: Record<string, unknown> }) => live && setExisting(Object.keys(d.details ?? {}).filter((id) => plots.some((p) => p.id === id)).length)).catch(() => {});
    return () => {
      live = false;
    };
  }, [plots, inBrowser]);
  const existing = inBrowser ? Object.keys(project.details ?? {}).filter((id) => plots.some((p) => p.id === id)).length : fetchedExisting;

  // each row → the plot it belongs to: same id as its hotspot ID, else same id / label as its plot label
  const matches: Match[] = useMemo(
    () =>
      (rows ?? []).map((row) => {
        const d = row.details;
        const byId = plots.find((p) => p.id === d.hotspotId);
        if (byId) return { row, shapeId: byId.id, by: "hotspotId" as const };
        const byLabel = d.plotLabel ? plots.find((p) => p.id === d.plotLabel || p.label === d.plotLabel) : undefined;
        return byLabel ? { row, shapeId: byLabel.id, by: "plotLabel" as const } : { row };
      }),
    [rows, plots],
  );
  const good = matches.filter((m) => !m.row.errors.length);
  const withErrors = matches.filter((m) => m.row.errors.length);
  // warnings grouped: "Status not given — set to Unassigned" × 2247
  const warningCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of good) for (const w of m.row.warnings ?? []) counts.set(w, (counts.get(w) ?? 0) + 1);
    return [...counts];
  }, [good]);
  const byLabel = good.filter((m) => m.by === "plotLabel");
  const notFound = good.filter((m) => !m.shapeId);
  const plotsWithout = plots.filter((p) => !matches.some((m) => m.shapeId === p.id)).length;
  // cutsheets (by the plot ID / label in the file name) and facade files (by facade option) → each row's details
  const sheets = useMemo(() => cutsheetIndex(sheetFiles), [sheetFiles]);
  const facades = useMemo(() => facadeIndex(facadeFiles), [facadeFiles]);
  const sheetOf = (d: UnitDetails) => sheets.get(lower(d.hotspotId)) ?? (d.plotLabel ? sheets.get(lower(d.plotLabel)) : undefined);
  const facadeOf = (d: UnitDetails) => (d.facadeOption ? facades.get(d.facadeOption) : undefined);
  const units = good.map((m) => {
    const d = m.row.details, sheet = sheetOf(d), facade = facadeOf(d);
    return { ...d, ...(sheet ? { plotSheet: { file: sheet } } : {}), ...(facade ? { facadeImage: { file: facade } } : {}) };
  });
  const withSheet = units.filter((u) => u.plotSheet && sheetOf(u)).length;
  const usedSheets = new Set(good.map((m) => sheetOf(m.row.details)).filter(Boolean));
  const withFacade = units.filter((u) => facadeOf(u)).length;
  const noFacadeOption = good.filter((m) => !m.row.details.facadeOption).length;

  const missingStatus = Object.keys(STATUS_COLORS).filter((st) => !project.categories.some((c) => c.id.toLowerCase() === st.toLowerCase() || c.label.toLowerCase() === st.toLowerCase()));

  const read = async (f: File) => {
    setFile(f);
    setRows(null);
    setPublished(null);
    setError(null);
    setBusy("Reading the spreadsheet…");
    try {
      const body = new FormData();
      body.append("file", f);
      const res = await fetch("/api/plot-details", { method: "POST", body });
      const data = (await res.json()) as { rows?: Row[]; contentful?: { publish: boolean; read: boolean }; error?: string };
      if (!res.ok || !data.rows) throw new Error(data.error ?? `Couldn't read it (${res.status})`);
      setRows(data.rows);
      setContentful(data.contentful ?? null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  /** Into the project (editor; Save keeps it): renamed plots and status categories. The details
   *  themselves go to the local JSON file / Contentful, not into the project. */
  const projectChanges = (rename && byLabel.length > 0) || (statusCategories && missingStatus.length > 0);
  const withChanges = (): Project => {
    if (!projectChanges) return project;
    const renames = new Map(rename ? byLabel.map((m) => [m.shapeId!, m.row.details.hotspotId]) : []);
    return {
      ...project,
      categories: statusCategories ? [...project.categories, ...missingStatus.map((st) => ({ id: st.toLowerCase(), label: st, color: STATUS_COLORS[st] }))] : project.categories,
      scenes: project.scenes.map((sc) =>
        sc.id !== scene.id ? sc : { ...sc, shapes: sc.shapes.map((s) => (renames.has(s.id) ? { ...s, id: renames.get(s.id)! } : s)) },
      ),
    };
  };
  const apply = () => projectChanges && onChange(withChanges());

  /** Saves the rows to the local JSON file; with `publish`, to Contentful too. */
  const store = async (publish: boolean) => {
    if (inBrowser) {
      // Hosted editor: the details go into the project (one undo step), kept by Save.
      const details = { ...(project.details ?? {}) };
      for (const u of units) details[u.hotspotId] = withFiles(details[u.hotspotId], u);
      onChange({ ...withChanges(), details });
      setSaved({ file: "this project", count: Object.keys(details).length });
      onStatus(`Added details for ${good.length} plots — Save to keep them`);
      return;
    }
    apply();
    setBusy(publish ? `Saving and publishing ${good.length} units to Contentful…` : `Saving ${good.length} plots…`);
    setError(null);
    try {
      const res = await fetch("/api/plot-details", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ units, publish }) });
      const data = (await res.json()) as { local?: { file: string; count: number }; results?: { hotspotId: string; ok: boolean; error?: string }[]; ok?: number; error?: string };
      if (data.local) setSaved(data.local);
      if (!res.ok) throw new Error(data.error ?? `Saving failed (${res.status})`);
      if (data.results) setPublished({ ok: data.ok ?? 0, failed: data.results.filter((r) => !r.ok) });
      onStatus(
        `${publish ? `Published ${data.ok} units to Contentful and saved` : `Saved details for ${good.length} plots`} to ${data.local?.file}` +
          (projectChanges ? " — also Save the project (renamed plots / status categories)" : ""),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  /** The saved details as one JSON file (keyed by hotspot ID), for use elsewhere. */
  const downloadJson = async () => {
    const data = inBrowser ? { details: project.details ?? {} } : ((await (await fetch("/api/plot-details")).json()) as { details: Record<string, unknown> });
    const url = URL.createObjectURL(new Blob([JSON.stringify(data.details, null, 2)], { type: "application/json" }));
    Object.assign(document.createElement("a"), { href: url, download: "plot-details.json" }).click();
    URL.revokeObjectURL(url);
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob(["﻿" + templateCsv(scene.shapes, scene.id)], { type: "text/csv" }));
    Object.assign(document.createElement("a"), { href: url, download: `${scene.id}-plot-details.csv` }).click();
    URL.revokeObjectURL(url);
  };

  const stat = (n: number, text: string, tone = "") => (
    <li className={tone}>
      <b className="tabular-nums">{n}</b> {text}
    </li>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="details-title">
      <div className={`max-h-full w-full max-w-xl space-y-4 overflow-y-auto p-5 ${SURFACE}`}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="details-title" className="text-base font-semibold">Plot details · {scene.title}</h2>
            <p className="text-sm text-neutral-600">
              One row per plot, keyed by <b>hotspot ID</b> (the plot&apos;s ID here). The outlines stay in this project; Contentful gets only the
              details, and the map joins them by hotspot ID.
            </p>
          </div>
          <button type="button" className="cursor-pointer px-1 text-neutral-400 hover:text-neutral-900" onClick={onClose} disabled={!!busy} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="space-y-1">
          <span className={LABEL}>1 · Start from the template</span>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={BUTTON} onClick={download}>
              ⬇ Template for {plots.length} plots (.csv)
            </button>
            <span className="text-xs text-neutral-500">Hotspot IDs filled in; opens in Excel. Columns: hotspotId, zone, plotLabel, mdTypology, facadeOption, status, mdPlotArea, gfa, parking, confirmed.</span>
          </div>
          {!!existing && (
            <p className="flex items-center gap-2 text-xs text-neutral-500">
              {existing} plots in this scene already have details.
              <button type="button" className="cursor-pointer text-sky-700 underline" onClick={downloadJson}>
                Download JSON
              </button>
            </p>
          )}
        </div>

        <label className="block space-y-1">
          <span className={LABEL}>2 · Upload the filled spreadsheet</span>
          <input type="file" accept=".xlsx,.csv" disabled={!!busy} className="block w-full text-sm file:mr-2 file:cursor-pointer file:rounded-md file:border file:border-black/10 file:bg-white file:px-2 file:py-1" onChange={(e) => e.target.files?.[0] && read(e.target.files[0])} />
          {file && <span className="block text-xs text-neutral-500">{file.name}</span>}
        </label>

        <div className="space-y-1.5">
          <span className={LABEL}>3 · Cutsheets and facades (optional)</span>
          <p className="text-xs text-neutral-500">
            Pick the folders as they came: only the file names are read, nothing is uploaded. Each row gets <code>plotSheet</code> (the cutsheet named like the
            plot, e.g. <code>MT09-V5-062.pdf</code>) and <code>facadeImage</code> (the file of its facade option, e.g. <code>Type1.pdf</code>) as paths inside
            the folder — for uploading the files to Contentful with the JSON.
          </p>
          <label className="block space-y-1">
            <span className="text-xs font-medium">Cutsheets folder</span>
            <input type="file" multiple disabled={!!busy} className={FOLDER_INPUT} {...{ webkitdirectory: "", directory: "" }} onChange={(e) => setSheetFiles([...(e.target.files ?? [])])} />
            {sheetFiles.length > 0 && (
              <span className="block text-xs text-neutral-600">
                {sheets.size} cutsheets{rows ? <> · <b>{withSheet}</b> of {good.length} rows have one{usedSheets.size < sheets.size ? ` · ${sheets.size - usedSheets.size} for plots not in the spreadsheet` : ""}</> : " — upload the spreadsheet to map them"}
              </span>
            )}
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium">Facade types folder</span>
            <input type="file" multiple disabled={!!busy} className={FOLDER_INPUT} {...{ webkitdirectory: "", directory: "" }} onChange={(e) => setFacadeFiles([...(e.target.files ?? [])])} />
            {facadeFiles.length > 0 && (
              <span className="block text-xs text-neutral-600">
                {facades.size ? [...facades.keys()].sort().join(", ") : "No Type1…Type4 file names found"}
                {rows ? <> · <b>{withFacade}</b> of {good.length} rows get one{noFacadeOption ? ` · ${noFacadeOption} ${noFacadeOption === 1 ? "row has" : "rows have"} no facade option` : ""}</> : " — upload the spreadsheet to map them"}
              </span>
            )}
          </label>
        </div>

        {rows && (
          <div className="space-y-2 rounded-md bg-neutral-50 p-3 text-sm">
            <ul className="space-y-0.5">
              {stat(good.length - notFound.length - byLabel.length, "rows match a plot by hotspot ID", "text-emerald-700")}
              {byLabel.length > 0 && stat(byLabel.length, "match a plot by its plot label (its ID differs from the hotspot ID)", "text-amber-700")}
              {notFound.length > 0 && stat(notFound.length, "are for plots not in this scene (other phases) — kept, and shown once a plot with that ID exists")}
              {withErrors.length > 0 && stat(withErrors.length, "have errors and are skipped", "text-red-700")}
              {plotsWithout > 0 && stat(plotsWithout, "plots in this scene have no row")}
            </ul>
            {withErrors.length > 0 && (
              <details className="text-xs">
                <summary className="cursor-pointer text-red-700">Show the errors</summary>
                <ul className="mt-1 max-h-32 space-y-0.5 overflow-y-auto">
                  {withErrors.map((m, i) => (
                    <li key={i}>
                      <b>{m.row.details.hotspotId || m.row.details.plotLabel || `row ${i + 2}`}</b>: {m.row.errors.join("; ")}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {warningCounts.length > 0 && (
              <ul className="space-y-0.5 text-xs text-neutral-600">
                {warningCounts.map(([w, n]) => (
                  <li key={w}>
                    Note: {w} ({n} rows){contentful?.publish && /missing/.test(w) ? " — Contentful requires it, so those rows won't publish" : ""}
                  </li>
                ))}
              </ul>
            )}
            {byLabel.length > 0 && (
              <label className="flex items-start gap-2">
                <input type="checkbox" className="mt-1" checked={rename} onChange={(e) => setRename(e.target.checked)} />
                <span>Rename those {byLabel.length} plots to their hotspot ID (e.g. {byLabel[0].shapeId} → {byLabel[0].row.details.hotspotId}), so the map and Contentful share the ID</span>
              </label>
            )}
            {missingStatus.length > 0 && (
              <label className="flex items-start gap-2">
                <input type="checkbox" className="mt-1" checked={statusCategories} onChange={(e) => setStatusCategories(e.target.checked)} />
                <span>Colour plots by status: add the categories {missingStatus.join(", ")} (legend + filter on the map)</span>
              </label>
            )}
          </div>
        )}

        {contentful && !contentful.publish && rows && !inBrowser && (
          <p className="rounded-md bg-neutral-100 p-2 text-xs text-neutral-600">
            Details are saved to a local JSON file (<code>data/plot-details/</code>) and the map uses it. Contentful can be added any time: put{" "}
            <code>CONTENTFUL_SPACE_ID</code>, <code>CONTENTFUL_MANAGEMENT_TOKEN</code> and <code>CONTENTFUL_DELIVERY_TOKEN</code> in <code>.env.local</code> (see{" "}
            <code>.example.env</code>), restart <code>npm run dev</code>, and publish.
          </p>
        )}
        {error && <p className="rounded-md bg-red-50 p-2 text-sm text-red-700">{error}</p>}
        {saved && (
          <div className="flex flex-wrap items-center gap-2 rounded-md bg-emerald-50 p-2 text-sm">
            <span>
              Saved — <code>{saved.file}</code> now holds details for <b>{saved.count}</b> plots.
            </span>
            <button type="button" className="cursor-pointer text-sky-700 underline" onClick={downloadJson}>
              Download JSON
            </button>
          </div>
        )}
        {published && (
          <div className="rounded-md bg-emerald-50 p-2 text-sm">
            Published <b>{published.ok}</b> units to Contentful.
            {published.failed.length > 0 && (
              <ul className="mt-1 max-h-28 overflow-y-auto text-xs text-red-700">
                {published.failed.map((f) => (
                  <li key={f.hotspotId}>
                    <b>{f.hotspotId}</b>: {f.error}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2">
          {busy && <span className="mr-auto text-sm text-neutral-600">{busy}</span>}
          <button type="button" className={BUTTON} onClick={onClose} disabled={!!busy}>
            {saved || published ? "Done" : "Cancel"}
          </button>
          {!saved && !published && (
            <>
              <button type="button" className={contentful?.publish ? BUTTON : PRIMARY_BUTTON} onClick={() => store(false)} disabled={!good.length || !!busy}>
                {inBrowser ? "Add to project" : "Save to local JSON"}
              </button>
              {contentful?.publish && !inBrowser && (
                <button type="button" className={PRIMARY_BUTTON} onClick={() => store(true)} disabled={!good.length || !!busy}>
                  Save & publish to Contentful
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
