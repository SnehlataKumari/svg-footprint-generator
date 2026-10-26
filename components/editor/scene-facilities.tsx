"use client";

import { useEffect, useState } from "react";
import { facilitiesForScene } from "@/lib/gis-import";
import type { Category, Scene, Shape } from "@/lib/types";
import { BUTTON, LABEL, PRIMARY_BUTTON, SURFACE } from "../ui";

/** World file extensions. Checked here, not with `accept`: file dialogs (macOS) grey out extensions they don't know. */
const WORLD_FILE = /\.(wpw|pgw|jgw|jpw|tfw|tifw|wld|[a-z]{2}w)$/i;

interface Props {
  scene: Scene;
  onClose: () => void;
  /** Adds them to the scene (one undo step); `summary` is what the script reported. */
  onAdd: (shapes: Shape[], categories: Category[], summary: string) => void;
}

/**
 * "Facilities from GIS files" for the scene being edited: the facilities
 * spreadsheet + its GeoPDF map + the world file of this scene's image → every
 * facility on the image outlined, named, filled in and shown with an icon
 * (lib/gis-import.ts `facilitiesForScene`). Projects ▾ → Import from GIS files
 * builds a whole new project from the same files instead.
 */
export function SceneFacilities({ scene, onClose, onAdd }: Props) {
  const [xlsx, setXlsx] = useState<File | null>(null);
  const [pdf, setPdf] = useState<File | null>(null);
  const [world, setWorld] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [busy]);

  const run = async () => {
    setSeconds(0);
    setBusy(true);
    setError(null);
    try {
      const result = await facilitiesForScene({ xlsx: xlsx!, pdf: pdf!, world: world!, size: { width: scene.width, height: scene.height } }, setStep);
      if ("error" in result) return setError(result.error);
      if (!result.shapes.length) return setError("None of the facilities lie on this image — is it the world file of this scene's image?");
      onAdd(result.shapes, result.categories, result.log.trim().split("\n").pop() ?? "");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const notWorld = !!world && !WORLD_FILE.test(world.name);
  const missing = [!xlsx && "the spreadsheet", !pdf && "the map PDF", (!world || notWorld) && "the world file"].filter(Boolean);

  const fileRow = (label: string, hint: string, accept: string | undefined, file: File | null, set: (f: File | null) => void, problem?: string) => (
    <label className="block space-y-1">
      <span className={LABEL}>{label}</span>
      <input type="file" accept={accept} disabled={busy} className="block w-full text-sm file:mr-2 file:cursor-pointer file:rounded-md file:border file:border-black/10 file:bg-white file:px-2 file:py-1" onChange={(e) => set(e.target.files?.[0] ?? null)} />
      <span className={`block text-xs ${problem ? "text-red-700" : "text-neutral-500"}`}>{problem ?? (file ? `${file.name} · ${(file.size / 1e6).toFixed(1)} MB` : hint)}</span>
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="scene-facilities-title">
      <div className={`max-h-full w-full max-w-lg space-y-4 overflow-y-auto p-5 ${SURFACE}`}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="scene-facilities-title" className="text-base font-semibold">Facilities from GIS files</h2>
            <p className="text-sm text-neutral-600">
              Adds every facility on “{scene.title}” — outlined, named, filled in from the spreadsheet and shown with an icon. Facilities already here
              (same plot ID) are updated; nothing else changes.
            </p>
          </div>
          <button type="button" className="cursor-pointer px-1 text-neutral-400 hover:text-neutral-900" onClick={onClose} disabled={busy} aria-label="Close">
            ✕
          </button>
        </div>

        {fileRow("Facilities spreadsheet", "Excel (.xlsx): one row per facility — plot ID, type, cluster, area…", ".xlsx", xlsx, setXlsx)}
        {fileRow("Facilities map", "PDF exported from ArcGIS / QGIS as a GeoPDF, each facility labelled with its plot ID", ".pdf,application/pdf", pdf, setPdf)}
        {fileRow(
          "World file of this scene's image",
          "The small file that came with the image (e.g. MT11.wpw next to MT11.webp) — it says where the image lies on the map",
          undefined,
          world,
          setWorld,
          notWorld ? `${world!.name} isn't a world file — pick the small .wpw / .pgw / .jgw… file with the same name as the image` : undefined,
        )}

        {error && <p className="rounded-md bg-red-50 p-2 text-sm text-red-700">{error}</p>}

        <div className="flex items-center justify-end gap-2">
          {busy ? (
            <span className="mr-auto text-sm text-neutral-600">
              {step} {seconds}s
            </span>
          ) : (
            missing.length > 0 && <span className="mr-auto text-xs text-neutral-500">Still needed: {missing.join(", ")}</span>
          )}
          <button type="button" className={BUTTON} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className={PRIMARY_BUTTON} onClick={run} disabled={missing.length > 0 || busy}>
            {busy ? "Adding…" : "Add to this scene"}
          </button>
        </div>
      </div>
    </div>
  );
}
