"use client";

import { useState } from "react";
import { type Placement, type Sizes, toPlacement } from "@/lib/affine";
import type { TraceImage, WarpKind } from "@/lib/types";
import { MIN_POINTS } from "@/lib/warp";
import { BUTTON, LABEL, PRIMARY_BUTTON, SURFACE } from "../ui";

interface Props {
  trace: TraceImage;
  sizes: Sizes;
  /** Which click of a new matching point is expected, if any. */
  awaiting: "from" | "to" | null;
  /** "Straight fit from 4 points — average error 0.12%" etc. */
  fitText: string;
  onPlacement: (field: keyof Placement, value: number) => void;
  onWarp: (warp: WarpKind) => void;
  onLock: () => void;
  onAddPoint: () => void;
  onCancelPoint: () => void;
  onRemovePoint: (index: number) => void;
  onClearPoints: () => void;
  onReset: () => void;
  onAutoAlign: () => void;
  /** Progress text while auto-align runs, else null. */
  autoAligning: string | null;
  onDone: () => void;
}

const FITS: { id: WarpKind; label: string; hint: string }[] = [
  { id: "affine", label: "Straight", hint: "move / scale / rotate / stretch — same drawing at another size or angle" },
  { id: "perspective", label: "Perspective", hint: "a different camera angle (4+ points)" },
  { id: "mesh", label: "Flexible", hint: "bends so every point lands exactly — a plan vs a render, a different render (3+ points, more = better)" },
];

/**
 * Placing the reference image on top of the scene image. Three ways, which
 * combine: Auto-align, then drag / type the placement, then matching points
 * for an exact fit — even when the two images aren't the same picture.
 */
export function ReferencePanel(p: Props) {
  const place = toPlacement(p.trace.transform, p.sizes);
  const points = p.trace.points ?? [];
  const warp = p.trace.warp ?? "affine";

  return (
    <div className={`absolute top-3 left-3 z-10 max-h-[calc(100%-1.5rem)] w-80 space-y-3 overflow-y-auto p-3 text-xs ${SURFACE}`}>
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">Place the reference image</div>
        <label className="flex items-center gap-1" title="Hide the handles so it can't be moved by accident">
          <input type="checkbox" checked={!!p.trace.locked} onChange={p.onLock} /> Lock
        </label>
      </div>
      <p className="text-neutral-600">
        The reference doesn&apos;t have to be the same picture — a CAD plan, a PDF export or another render all work. Line it up on
        your image, then trace or auto-detect on it.
      </p>

      <section className="space-y-1.5 rounded-md bg-emerald-50 p-2">
        <div className="font-medium">1 · Automatic</div>
        <p className="text-neutral-600">Finds the position and size by matching the pictures (or their edges if they look different). No rotation — rotate first if needed.</p>
        <button type="button" className={`${PRIMARY_BUTTON} w-full`} onClick={p.onAutoAlign} disabled={!!p.autoAligning || !!p.trace.locked}>
          {p.autoAligning ?? "Auto-align"}
        </button>
      </section>

      <section className="space-y-1.5 rounded-md bg-fuchsia-50 p-2">
        <div className="font-medium">2 · By hand</div>
        <p className="text-neutral-600">
          Drag <b>✥</b> to move, <b>⟳</b> to rotate (Shift = 15° steps), corners to scale, edge handles to stretch (Alt = from the centre) — or type:
        </p>
        <div className="grid grid-cols-2 gap-1.5">
          <Num label="X (%)" value={place.x} onCommit={(v) => p.onPlacement("x", v)} disabled={p.trace.locked} />
          <Num label="Y (%)" value={place.y} onCommit={(v) => p.onPlacement("y", v)} disabled={p.trace.locked} />
          <Num label="Width (%)" value={place.width} onCommit={(v) => p.onPlacement("width", v)} disabled={p.trace.locked} />
          <Num label="Height (%)" value={place.height} onCommit={(v) => p.onPlacement("height", v)} disabled={p.trace.locked} />
          <Num label="Rotation (°)" value={place.rotation} onCommit={(v) => p.onPlacement("rotation", v)} disabled={p.trace.locked} />
          <Num label="Skew" value={place.skew} step={0.01} onCommit={(v) => p.onPlacement("skew", v)} disabled={p.trace.locked} />
        </div>
        <p className="text-neutral-500">X / Y = where the reference&apos;s centre sits on your image. Width / height = its size, in % of your image.</p>
      </section>

      <section className="space-y-1.5 rounded-md bg-sky-50 p-2">
        <div className="font-medium">3 · Matching points (exact)</div>
        <p className="text-neutral-600">
          Click a spot on the reference, then the same spot on your image. Use sharp, spread-out spots (site corners, road junctions). Drag a
          blue point later to adjust it.
        </p>
        <div className="space-y-1">
          <span className={LABEL}>Fit</span>
          {FITS.map((f) => (
            <label key={f.id} className="flex items-start gap-1.5">
              <input type="radio" className="mt-0.5" checked={warp === f.id} onChange={() => p.onWarp(f.id)} disabled={p.trace.locked} />
              <span>
                <b>{f.label}</b> — {f.hint}
              </span>
            </label>
          ))}
        </div>
        {points.length > 0 && (
          <ol className="space-y-0.5">
            {points.map((pt, i) => (
              <li key={i} className="flex items-center gap-2 font-mono">
                <span className="w-4 text-right">{i + 1}.</span>
                <span>
                  {pt.from.map((v) => v.toFixed(1)).join(", ")} → {pt.to.map((v) => v.toFixed(1)).join(", ")}
                </span>
                <button type="button" className="ml-auto cursor-pointer text-neutral-400 hover:text-red-600" onClick={() => p.onRemovePoint(i)} aria-label={`Remove point ${i + 1}`}>
                  ✕
                </button>
              </li>
            ))}
          </ol>
        )}
        {p.awaiting ? (
          <div className="flex items-center gap-2 rounded bg-white px-2 py-1 font-medium">
            {p.awaiting === "from" ? "① Click the spot on the REFERENCE" : "② Click the same spot on YOUR IMAGE"}
            <button type="button" className="ml-auto cursor-pointer text-sky-700 underline" onClick={p.onCancelPoint}>
              cancel
            </button>
          </div>
        ) : (
          <button type="button" className={`${BUTTON} w-full`} onClick={p.onAddPoint} disabled={p.trace.locked}>
            + Add matching point {points.length < MIN_POINTS[warp] && `(${points.length}/${MIN_POINTS[warp]})`}
          </button>
        )}
        <div className="text-neutral-700">{p.fitText}</div>
        {points.length > 0 && (
          <button type="button" className="cursor-pointer text-neutral-500 underline" onClick={p.onClearPoints} disabled={p.trace.locked}>
            clear all points
          </button>
        )}
      </section>

      <div className="flex gap-2">
        <button type="button" className={BUTTON} onClick={p.onReset} disabled={p.trace.locked} title="Stretch the reference over your image again and clear the points">
          Reset
        </button>
        <button type="button" className={`${PRIMARY_BUTTON} flex-1`} onClick={p.onDone}>
          Done
        </button>
      </div>
    </div>
  );
}

/** Number input that applies on Enter / leaving the field (not every keystroke). */
function Num({ label, value, onCommit, step = 0.1, disabled }: { label: string; value: number; onCommit: (v: number) => void; step?: number; disabled?: boolean }) {
  const shown = Number(value.toFixed(step < 0.1 ? 3 : 2));
  const [draft, setDraft] = useState(String(shown));
  const [prev, setPrev] = useState(shown);
  if (prev !== shown) {
    // Changed from outside (dragging a handle): show the new value.
    setPrev(shown);
    setDraft(String(shown));
  }
  const commit = () => {
    const v = parseFloat(draft);
    if (Number.isFinite(v) && v !== shown) onCommit(v);
    else setDraft(String(shown));
  };
  return (
    <label className="block">
      <span className="text-[10px] text-neutral-500">{label}</span>
      <input
        type="number"
        step={step}
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
        className="h-7 w-full rounded border border-black/15 bg-white px-1.5 text-xs disabled:opacity-50"
      />
    </label>
  );
}
