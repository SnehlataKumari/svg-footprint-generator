"use client";

import { useState } from "react";
import type { Project, Scene, Shape } from "@/lib/types";
import { BUTTON, PRIMARY_BUTTON, SURFACE } from "../ui";

export type JsonScope = "settings" | "scene" | "selection";

interface Props {
  project: Project;
  scene: Scene;
  selectedIds: string[];
  scope: JsonScope;
  onScope: (scope: JsonScope) => void;
  /** The whole updated project, plus the scene to show / shapes to select afterwards. */
  onApply: (project: Project, sceneId?: string, selection?: string[]) => void;
  onClose: () => void;
}

const SCOPES: { id: JsonScope; label: string }[] = [
  { id: "settings", label: "Project settings & styles" },
  { id: "scene", label: "This scene" },
  { id: "selection", label: "Selected shapes" },
];

/** The part of the project each scope edits. */
function extract(project: Project, scene: Scene, selectedIds: string[], scope: JsonScope): unknown {
  if (scope === "settings") {
    const { title, startScene, style, categories } = project;
    return { title, startScene, style: style ?? {}, categories };
  }
  if (scope === "scene") return scene;
  return scene.shapes.filter((s) => selectedIds.includes(s.id));
}

const isShape = (s: unknown): s is Shape => {
  const x = s as Shape;
  return !!x && typeof x.id === "string" && ["polygon", "line", "pin"].includes(x.kind) && Array.isArray(x.points);
};

/** Validates and merges edited JSON back into the project. Throws a readable message. */
function merge(project: Project, scene: Scene, selectedIds: string[], scope: JsonScope, data: unknown): { project: Project; sceneId?: string; selection?: string[] } {
  if (scope === "settings") {
    const d = data as Partial<Project>;
    if (typeof d !== "object" || d === null || Array.isArray(d)) throw new Error("Expected an object { title, startScene, style, categories }");
    if (d.categories && !Array.isArray(d.categories)) throw new Error("categories must be a list");
    for (const c of d.categories ?? []) if (!c.id || !c.color) throw new Error("Every category needs an id and a color");
    return { project: { ...project, ...d, scenes: project.scenes } };
  }
  if (scope === "scene") {
    const d = data as Scene;
    if (!d || typeof d.id !== "string" || typeof d.image !== "string" || !Array.isArray(d.shapes)) {
      throw new Error("A scene needs at least id, image, width, height and shapes [ ]");
    }
    if (!d.shapes.every(isShape)) throw new Error("Every shape needs id, kind (polygon | line | pin) and points");
    if (d.id !== scene.id && project.scenes.some((s) => s.id === d.id)) throw new Error(`Scene id "${d.id}" is already used`);
    if (new Set(d.shapes.map((s) => s.id)).size !== d.shapes.length) throw new Error("Shape ids must be unique");
    return { project: { ...project, scenes: project.scenes.map((s) => (s.id === scene.id ? d : s)) }, sceneId: d.id };
  }
  const list = data as Shape[];
  if (!Array.isArray(list) || !list.every(isShape)) throw new Error("Expected a list of shapes, each with id, kind and points");
  const others = scene.shapes.filter((s) => !selectedIds.includes(s.id));
  const clash = list.find((s) => others.some((o) => o.id === s.id));
  if (clash) throw new Error(`"${clash.id}" is already used by another shape in this scene`);
  // Keep the edited shapes where the first selected one was.
  const at = Math.max(0, scene.shapes.findIndex((s) => selectedIds.includes(s.id)));
  const before = scene.shapes.slice(0, at).filter((s) => !selectedIds.includes(s.id));
  const after = scene.shapes.slice(at).filter((s) => !selectedIds.includes(s.id));
  const shapes = [...before, ...list, ...after];
  return {
    project: { ...project, scenes: project.scenes.map((s) => (s.id === scene.id ? { ...s, shapes } : s)) },
    selection: list.map((s) => s.id),
  };
}

const STYLE_HELP = `"style": {
  "fill": "#22c55e",          // colour (default: category colour)
  "fillOpacity": 0.35,        // 0 = outline only
  "hoverFillOpacity": 0.6,
  "hoverFill": "#f59e0b",     // colour on hover (default: same as fill)
  "hoverStroke": "#f59e0b",   // outline colour on hover
  "hoverStrokeWidth": 2,      // outline width on hover
  "stroke": "#ffffff",        // default: same as fill
  "strokeWidth": 1.5,         // screen px, 0 = no outline
  "scaleWithZoom": true,      // width grows / shrinks with zoom (like a real road)
  "strokeOpacity": 1,
  "dash": "6 4",              // dashed outline ("" = solid)
  "label": "always",          // "hover" | "always" | "none"
  "labelColor": "#ffffff",
  "labelSize": 12,
  "visible": true
}`;

/**
 * Edit part of the project as raw JSON: project-wide settings/styles, the
 * current scene, or the selected shapes. Validated before it's applied, and
 * undoable like any other change.
 */
export function JsonEditor({ project, scene, selectedIds, scope, onScope, onApply, onClose }: Props) {
  const initial = JSON.stringify(extract(project, scene, selectedIds, scope), null, 2);
  const [text, setText] = useState(initial);
  const [shown, setShown] = useState(scope);
  const [error, setError] = useState<string | null>(null);
  const [help, setHelp] = useState(false);
  if (shown !== scope) {
    setShown(scope);
    setText(initial);
    setError(null);
  }

  const apply = () => {
    try {
      const result = merge(project, scene, selectedIds, scope, JSON.parse(text));
      onApply(result.project, result.sceneId, result.selection);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div role="dialog" aria-label="Edit JSON" className={`flex max-h-full w-full max-w-3xl flex-col gap-3 p-4 ${SURFACE}`}>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="mr-auto text-base font-semibold">Edit JSON</h2>
          <div className="flex overflow-hidden rounded-md border border-black/10 text-sm">
            {SCOPES.map((s) => (
              <button
                key={s.id}
                type="button"
                disabled={s.id === "selection" && !selectedIds.length}
                onClick={() => onScope(s.id)}
                className={`cursor-pointer px-2.5 py-1 disabled:cursor-default disabled:opacity-40 ${scope === s.id ? "bg-neutral-900 text-white" : "hover:bg-neutral-100"}`}
              >
                {s.label}
                {s.id === "selection" && ` (${selectedIds.length})`}
              </button>
            ))}
          </div>
        </div>

        <p className="text-xs text-neutral-600">
          Add a <code>&quot;style&quot;</code> to the project (all plots), a scene, a category, or one shape to change how plots look — the
          most specific one wins.{" "}
          <button type="button" className="cursor-pointer text-sky-700 underline" onClick={() => setHelp((h) => !h)}>
            {help ? "Hide" : "Show"} style options
          </button>
        </p>
        {help && <pre className="overflow-auto rounded-md bg-neutral-100 p-2 text-xs">{STYLE_HELP}</pre>}

        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
          spellCheck={false}
          className="min-h-[50vh] flex-1 resize-none rounded-md border border-black/15 bg-neutral-50 p-2 font-mono text-xs outline-none focus:border-sky-500"
        />
        {error && <div className="rounded-md bg-red-50 px-2 py-1 text-sm text-red-700">{error}</div>}

        <div className="flex justify-end gap-2">
          <button type="button" className={BUTTON} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={PRIMARY_BUTTON} onClick={apply}>
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
