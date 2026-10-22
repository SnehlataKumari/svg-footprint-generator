"use client";

import { useMemo, useState } from "react";
import { shapeColor } from "@/lib/scene-tree";
import type { PlotStyle, Project, Scene, Shape } from "@/lib/types";
import { BUTTON, INPUT, LABEL } from "../ui";
import { Field } from "./fields";
import { IconPicker } from "./icon-picker";

interface Props {
  project: Project;
  scene: Scene;
  /** The selected shapes (one = full form, several = bulk edit). */
  selected: Shape[];
  onSelect: (id: string, additive: boolean) => void;
  /** Applies to every selected shape. */
  onChange: (patch: Partial<Shape>) => void;
  /** Merged into every selected shape's own `style`. */
  onStyle: (patch: Partial<PlotStyle>) => void;
  onRename: (id: string) => void;
  onDelete: () => void;
  onClearSelection: () => void;
}

/** "Area: 450 m²" lines <-> { Area: "450 m²" } */
const infoToText = (info?: Record<string, string>) =>
  Object.entries(info ?? {})
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
const textToInfo = (text: string) => {
  const info: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) info[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return Object.keys(info).length ? info : undefined;
};

/** The value if every shape has the same one, else "" (mixed). */
const common = <K extends keyof Shape>(shapes: Shape[], key: K) =>
  shapes.every((s) => s[key] === shapes[0][key]) ? (shapes[0][key] ?? "") : "";

/** A style value if every shape has the same one, else undefined (mixed / default). */
const sameStyle = <K extends keyof PlotStyle>(shapes: Shape[], key: K) =>
  shapes.every((s) => s.style?.[key] === shapes[0].style?.[key]) ? shapes[0].style?.[key] : undefined;

/** Right panel: the scene's shape list and the selection's properties. */
export function ShapePanel({ project, scene, selected, onSelect, onChange, onStyle, onRename, onDelete, onClearSelection }: Props) {
  const [query, setQuery] = useState("");
  const selectedIds = new Set(selected.map((s) => s.id));
  const shapes = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? scene.shapes.filter((s) => `${s.id} ${s.label}`.toLowerCase().includes(q)) : scene.shapes;
  }, [scene.shapes, query]);
  const single = selected.length === 1 ? selected[0] : null;

  return (
    <aside className="flex w-72 shrink-0 flex-col border-l border-black/10 bg-white">
      <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Shapes</h2>
          <span className="text-xs text-neutral-500">{scene.shapes.length}</span>
        </div>
        <input className={INPUT} placeholder="Search id / label…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {shapes.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={(e) => onSelect(s.id, e.shiftKey || e.ctrlKey || e.metaKey)}
                className={`flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1 text-left text-sm ${selectedIds.has(s.id) ? "bg-sky-100" : "hover:bg-neutral-100"}`}
              >
                <span className={`h-2.5 w-2.5 shrink-0 ${s.kind === "pin" ? "rounded-full" : s.kind === "line" ? "h-0.5" : "rounded-sm"}`} style={{ background: shapeColor(project, s) }} />
                <span className="truncate font-mono text-xs">{s.id}</span>
                {s.label !== s.id && <span className="truncate text-neutral-500">{s.label}</span>}
                {s.link && <span className="ml-auto text-xs text-sky-600" title={`Opens ${s.link}`}>→</span>}
              </button>
            </li>
          ))}
          {scene.shapes.length === 0 && <li className="p-2 text-sm text-neutral-500">No shapes yet — try Auto-detect (D) in the toolbar.</li>}
        </ul>
        <p className="text-[11px] text-neutral-500">Shift/Ctrl+click to select several.</p>
      </div>

      {selected.length > 0 && (
        <div key={single?.id ?? "multi"} className="max-h-[60%] space-y-2.5 overflow-y-auto border-t border-black/10 bg-neutral-50 p-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">
              {single ? `${single.kind} · ${single.points.length} pt` : `${selected.length} shapes selected`}
            </h2>
            <button type="button" className="cursor-pointer text-xs text-sky-700 underline" onClick={onClearSelection}>
              deselect
            </button>
          </div>

          {single && (
            <>
              <Field label="ID" value={single.id} onCommit={(id) => onRename(id.trim())} hint="Unique in the scene. Or use the Number tool (N)." />
              <Field label="Label" value={single.label} onCommit={(label) => onChange({ label })} />
            </>
          )}

          <label className="block space-y-1">
            <span className={LABEL}>Category</span>
            <select className={INPUT} value={common(selected, "category") as string} onChange={(e) => onChange({ category: e.target.value || undefined })}>
              <option value="">{single || common(selected, "category") ? "— none —" : "— mixed —"}</option>
              {project.categories.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          </label>

          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" checked={selected.every((s) => !!s.color)} onChange={(e) => onChange({ color: e.target.checked ? shapeColor(project, selected[0]) : undefined })} />
              Own colour
            </label>
            {selected[0].color && (
              <input type="color" value={selected[0].color} onChange={(e) => onChange({ color: e.target.value })} className="h-7 w-10 cursor-pointer rounded border border-black/10" />
            )}
          </div>

          {selected.every((s) => s.kind === "pin") && (
            <PinIconField project={project} selected={selected} onChange={onChange} />
          )}

          {selected.some((s) => s.kind !== "pin") && (
            <div className="space-y-1.5">
              <label className="flex items-center gap-2 text-sm">
                <span className="w-24 shrink-0">{selected.every((s) => s.kind === "line") ? "Line width" : "Outline width"}</span>
                <input
                  type="number"
                  min={0}
                  max={60}
                  step={0.5}
                  className={INPUT}
                  value={sameStyle(selected, "strokeWidth") ?? ""}
                  placeholder={selected.every((s) => s.kind === "line") ? "4 (default)" : "1.25 (default)"}
                  onChange={(e) => onStyle({ strokeWidth: e.target.value === "" ? undefined : Math.max(0, Number(e.target.value)) })}
                />
                <span className="text-xs text-neutral-500">px</span>
              </label>
              <label className="flex items-start gap-1.5 text-sm" title="Off: the same width at every zoom. On: the width above is the one at the starting view; zooming in makes it thicker, zooming out thinner.">
                <input type="checkbox" className="mt-1" checked={selected.every((s) => s.style?.scaleWithZoom)} onChange={(e) => onStyle({ scaleWithZoom: e.target.checked || undefined })} />
                <span>
                  Grows with zoom <span className="text-xs text-neutral-500">— thicker when zoomed in, like a real road</span>
                </span>
              </label>
            </div>
          )}

          <label className="block space-y-1">
            <span className={LABEL}>Opens scene</span>
            <select className={INPUT} value={common(selected, "link") as string} onChange={(e) => onChange({ link: e.target.value || undefined })}>
              <option value="">{single || common(selected, "link") ? "— none —" : "— mixed —"}</option>
              {project.scenes
                .filter((s) => s.id !== scene.id)
                .map((s) => (
                  <option key={s.id} value={s.id}>{s.title}</option>
                ))}
            </select>
          </label>

          {single && (
            <>
              <Field label="Description" multiline value={single.description ?? ""} onCommit={(v) => onChange({ description: v || undefined })} />
              <Field
                label="Details"
                multiline
                value={infoToText(single.info)}
                onCommit={(v) => onChange({ info: textToInfo(v) })}
                placeholder={"Area: 450 m²\nBedrooms: 4"}
                hint="One “Key: Value” per line — shown as a table on the card."
              />
              <Field label="Image" value={single.image ?? ""} onCommit={(v) => onChange({ image: v || undefined })} placeholder="/scenes/photo.webp or https://…" />
              <Field label="External link" value={single.url ?? ""} onCommit={(v) => onChange({ url: v || undefined })} placeholder="https://… (brochure, booking)" />
            </>
          )}

          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" checked={selected.every((s) => s.hidden)} onChange={(e) => onChange({ hidden: e.target.checked || undefined })} />
            Hidden in viewer
          </label>

          <button type="button" className={`${BUTTON} w-full text-red-600`} onClick={onDelete}>
            Delete {single ? "shape" : `${selected.length} shapes`} (Del)
          </button>
        </div>
      )}
    </aside>
  );
}

/** Pins: their icon — a built-in symbol, your own image, or the category's (the default). */
function PinIconField({ project, selected, onChange }: { project: Project; selected: Shape[]; onChange: (patch: Partial<Shape>) => void }) {
  const [error, setError] = useState<string | null>(null);
  const own = selected.every((s) => s.icon === selected[0].icon) ? selected[0].icon : undefined;
  const fromCategory = project.categories.find((c) => c.id === selected[0].category)?.icon;
  return (
    <div className="space-y-1">
      <span className={LABEL}>Icon</span>
      <div className="flex items-center gap-2">
        <IconPicker
          value={own ?? fromCategory}
          color={shapeColor(project, selected[0])}
          onChange={(icon) => onChange({ icon })}
          onStatus={(message, isError) => setError(isError ? message : null)}
        />
        <p className="text-xs text-neutral-500">
          {own ? "This pin's own icon." : fromCategory ? "From its category — change it there for every pin of this type." : "No icon: the pin shows its name. Pick a built-in symbol or upload one."}
        </p>
      </div>
      {own && fromCategory && (
        <button type="button" className="cursor-pointer text-xs text-sky-700 underline" onClick={() => onChange({ icon: undefined })}>
          use the category&apos;s icon
        </button>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
