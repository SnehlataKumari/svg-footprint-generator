"use client";

import { useState } from "react";
import type { PlotStyle, Project } from "@/lib/types";
import { INPUT, LABEL } from "../ui";

/**
 * How plots look in the viewer, without editing JSON: picks write the same
 * `style` object you'd write by hand (project-wide, or for one scene), so
 * the JSON stays the single source and can still be fine-tuned there.
 */

type Preset = "always" | "outline" | "hover";

const PRESETS: { id: Preset; label: string; style: PlotStyle }[] = [
  { id: "always", label: "Always visible (filled)", style: { fillOpacity: 0.35, hoverFillOpacity: 0.6, strokeWidth: 1.25, hoverStrokeWidth: undefined } },
  { id: "outline", label: "Outline only, filled on hover", style: { fillOpacity: 0, hoverFillOpacity: 0.4, strokeWidth: 1.5, hoverStrokeWidth: undefined } },
  { id: "hover", label: "Hidden — shown only on hover", style: { fillOpacity: 0, hoverFillOpacity: 0.5, strokeWidth: 0, hoverStrokeWidth: 2 } },
];

const matches = (style: PlotStyle, preset: PlotStyle) =>
  (Object.keys(preset) as (keyof PlotStyle)[]).every((k) => (style[k] ?? undefined) === (preset[k] ?? undefined));

/** Removes undefined keys; returns undefined for an empty style. */
function clean(style: PlotStyle): PlotStyle | undefined {
  const out = Object.fromEntries(Object.entries(style).filter(([, v]) => v !== undefined && v !== ""));
  return Object.keys(out).length ? (out as PlotStyle) : undefined;
}

export function PlotLook({ project, sceneId, onChange }: { project: Project; sceneId?: string; onChange: (p: Project) => void }) {
  const [scope, setScope] = useState<"project" | "scene">("project");
  const scene = project.scenes.find((s) => s.id === sceneId);
  const style: PlotStyle = (scope === "project" ? project.style : scene?.style) ?? {};
  // No style yet = the built-in default, which is "always".
  const preset = Object.keys(style).length === 0 ? "always" : PRESETS.find((p) => matches(style, p.style))?.id;
  const hoverColour = style.hoverFill;

  const write = (patch: PlotStyle) => {
    const next = clean({ ...style, ...patch });
    if (scope === "project") onChange({ ...project, style: next });
    else onChange({ ...project, scenes: project.scenes.map((s) => (s.id === sceneId ? { ...s, style: next } : s)) });
  };

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold">Plot look (viewer)</h2>
      <div className="flex overflow-hidden rounded-md border border-black/10 text-xs">
        {(
          [
            ["project", "All scenes"],
            ["scene", "This scene"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            disabled={id === "scene" && !scene}
            onClick={() => setScope(id)}
            className={`flex-1 cursor-pointer py-1 ${scope === id ? "bg-neutral-900 text-white" : "hover:bg-neutral-100"}`}
          >
            {label}
          </button>
        ))}
      </div>

      <label className="block space-y-1">
        <span className={LABEL}>Show plots</span>
        <select className={INPUT} value={preset ?? "custom"} onChange={(e) => write(PRESETS.find((p) => p.id === e.target.value)!.style)}>
          {PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
          {!preset && <option value="custom">Custom (set in JSON)</option>}
        </select>
      </label>

      <div className="space-y-1">
        <label className="flex items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            checked={!!hoverColour}
            onChange={(e) => write(e.target.checked ? { hoverFill: "#f59e0b", hoverStroke: "#f59e0b" } : { hoverFill: undefined, hoverStroke: undefined })}
          />
          Colour on hover
          {hoverColour && (
            <input
              type="color"
              value={hoverColour}
              onChange={(e) => write({ hoverFill: e.target.value, hoverStroke: e.target.value })}
              className="ml-auto h-7 w-10 cursor-pointer rounded border border-black/10"
              aria-label="Hover colour"
            />
          )}
        </label>
        <p className="text-[11px] text-neutral-500">Off = the plot&apos;s own (category) colour, just stronger.</p>
      </div>

      <label className="block space-y-1">
        <span className={LABEL}>Plot names</span>
        <select className={INPUT} value={style.label ?? "hover"} onChange={(e) => write({ label: e.target.value as PlotStyle["label"] })}>
          <option value="hover">In a tooltip on hover</option>
          <option value="always">Always written on the map</option>
          <option value="none">Never</option>
        </select>
      </label>

      <p className="text-[11px] text-neutral-500">
        Saved as <code>style</code> on the {scope === "project" ? "project" : "scene"} — fine-tune any value (colours, widths, dashes) in JSON ▾ → Edit JSON.
        A category&apos;s or a plot&apos;s own style still wins.
      </p>
      {Object.keys(style).length > 0 && (
        <button
          type="button"
          className="cursor-pointer text-xs text-neutral-500 underline"
          onClick={() => {
            if (scope === "project") onChange({ ...project, style: undefined });
            else onChange({ ...project, scenes: project.scenes.map((s) => (s.id === sceneId ? { ...s, style: undefined } : s)) });
          }}
        >
          reset to default
        </button>
      )}
    </section>
  );
}
