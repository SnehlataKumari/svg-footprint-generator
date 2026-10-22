"use client";

import { useState } from "react";
import { IDENTITY } from "@/lib/affine";
import type { Category, Project, Scene } from "@/lib/types";
import { BUTTON, INPUT, LABEL } from "../ui";
import { Field, slugify, uploadImage } from "./fields";
import { IconPicker } from "./icon-picker";
import { PlotDetails } from "./plot-details";
import { PlotLook } from "./plot-look";
import { ProjectSwitcher } from "./project-switcher";

interface Props {
  project: Project;
  sceneId?: string;
  onSelectScene: (id: string) => void;
  onChange: (project: Project) => void;
  onStatus: (message: string, error?: boolean) => void;
  dirty: boolean;
  onSave: () => Promise<boolean>;
  onLeave: () => void;
}

/** Left panel: project settings, scenes, categories. */
export function ProjectPanel({ project, sceneId, onSelectScene, onChange, onStatus, dirty, onSave, onLeave }: Props) {
  const scene = project.scenes.find((s) => s.id === sceneId);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const setScene = (patch: Partial<Scene>) =>
    onChange({ ...project, scenes: project.scenes.map((s) => (s.id === sceneId ? { ...s, ...patch } : s)) });

  const addScene = async (file: File) => {
    setUploading(true);
    try {
      const { src, width, height } = await uploadImage(file);
      let id = slugify(file.name);
      while (project.scenes.some((s) => s.id === id)) id += "-2";
      const title = file.name.replace(/\.[^.]+$/, "");
      onChange({
        ...project,
        startScene: project.scenes.some((s) => s.id === project.startScene) ? project.startScene : id,
        scenes: [...project.scenes, { id, title, image: src, width, height, shapes: [] }],
      });
      onSelectScene(id);
      onStatus(`Scene "${title}" added — link to it from a shape's "Opens scene"`);
    } catch (e) {
      onStatus((e as Error).message, true);
    } finally {
      setUploading(false);
    }
  };

  const replaceImage = async (file: File) => {
    try {
      const { src, width, height } = await uploadImage(file);
      if (scene && Math.abs(width / height - scene.width / scene.height) > 0.01) {
        onStatus("Different aspect ratio than the old image — shapes may need re-aligning", true);
      }
      setScene({ image: src, width, height });
    } catch (e) {
      onStatus((e as Error).message, true);
    }
  };

  /** The reference image: same area with the plots marked, used only for tracing. */
  const setPlottingImage = async (file: File) => {
    if (!scene) return;
    try {
      const { src, width, height } = await uploadImage(file);
      // Replacing keeps the alignment; a first upload assumes the same framing.
      setScene({ trace: { image: src, width, height, transform: scene.trace?.transform ?? IDENTITY } });
      const sameShape = Math.abs(width / height - scene.width / scene.height) < 0.01;
      onStatus(
        sameShape
          ? "Reference image added — check the Overlay view; use Place reference… to line it up"
          : "Reference image added. It has a different shape from your image — use Place reference… to line it up",
        !sameShape,
      );
    } catch (e) {
      onStatus((e as Error).message, true);
    }
  };

  /** Rename a scene and every link / startScene pointing at it. */
  const renameScene = (newId: string) => {
    const id = slugify(newId);
    if (!scene || id === scene.id) return;
    if (project.scenes.some((s) => s.id === id)) return onStatus(`Scene "${id}" already exists`, true);
    onChange({
      ...project,
      startScene: project.startScene === scene.id ? id : project.startScene,
      scenes: project.scenes.map((s) => ({
        ...s,
        id: s.id === scene.id ? id : s.id,
        shapes: s.shapes.map((sh) => (sh.link === scene.id ? { ...sh, link: id } : sh)),
      })),
    });
    onSelectScene(id);
  };

  const deleteScene = () => {
    if (!scene) return;
    const scenes = project.scenes.filter((s) => s.id !== scene.id);
    onChange({
      ...project,
      startScene: project.startScene === scene.id ? (scenes[0]?.id ?? "") : project.startScene,
      scenes: scenes.map((s) => ({
        ...s,
        shapes: s.shapes.map((sh) => (sh.link === scene.id ? { ...sh, link: undefined } : sh)),
      })),
    });
    setConfirmDelete(false);
    if (scenes[0]) onSelectScene(scenes[0].id);
  };

  const setCategory = (id: string, patch: Partial<Category>) =>
    onChange({ ...project, categories: project.categories.map((c) => (c.id === id ? { ...c, ...patch } : c)) });

  const addCategory = () => {
    let n = project.categories.length + 1;
    while (project.categories.some((c) => c.id === `category-${n}`)) n++;
    const palette = ["#22c55e", "#ef4444", "#f59e0b", "#3b82f6", "#a855f7", "#14b8a6", "#ec4899"];
    onChange({
      ...project,
      categories: [...project.categories, { id: `category-${n}`, label: `Category ${n}`, color: palette[(n - 1) % palette.length] }],
    });
  };

  const removeCategory = (id: string) =>
    onChange({
      ...project,
      categories: project.categories.filter((c) => c.id !== id),
      scenes: project.scenes.map((s) => ({
        ...s,
        shapes: s.shapes.map((sh) => (sh.category === id ? { ...sh, category: undefined } : sh)),
      })),
    });

  return (
    <aside className="flex w-64 shrink-0 flex-col gap-5 overflow-y-auto border-r border-black/10 bg-white p-3">
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Project</h2>
        <ProjectSwitcher title={project.title} dirty={dirty} onSave={onSave} onLeave={onLeave} onStatus={onStatus} />
        <Field label="Title" value={project.title} onCommit={(title) => onChange({ ...project, title })} />
        <label className="block space-y-1">
          <span className={LABEL}>Start scene</span>
          <select className={INPUT} value={project.startScene} onChange={(e) => onChange({ ...project, startScene: e.target.value })}>
            {project.scenes.map((s) => (
              <option key={s.id} value={s.id}>{s.title}</option>
            ))}
          </select>
        </label>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Scenes</h2>
        <ul className="space-y-1">
          {project.scenes.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onSelectScene(s.id)}
                className={`flex w-full cursor-pointer items-center justify-between rounded-md px-2 py-1.5 text-left text-sm ${s.id === sceneId ? "bg-neutral-900 text-white" : "hover:bg-neutral-100"}`}
              >
                <span className="truncate">{s.title}</span>
                <span className="text-xs opacity-60">{s.shapes.length}</span>
              </button>
            </li>
          ))}
        </ul>
        <label className={`${BUTTON} w-full ${uploading ? "opacity-50" : ""}`}>
          {uploading ? "Uploading…" : "+ Add scene (image)"}
          <input type="file" accept="image/*" hidden disabled={uploading} onChange={(e) => e.target.files?.[0] && addScene(e.target.files[0]).finally(() => (e.target.value = ""))} />
        </label>
      </section>

      {scene && (
        <section key={scene.id} className="space-y-2 rounded-md bg-neutral-50 p-2">
          <h2 className="text-sm font-semibold">Scene settings</h2>
          <Field label="Title" value={scene.title} onCommit={(title) => setScene({ title })} />
          <Field label="ID (URL)" value={scene.id} onCommit={renameScene} hint={`/scene/${scene.id}`} />
          <p className="text-[11px] text-neutral-500">
            {scene.image} · {scene.width}×{scene.height}px
          </p>
          <div className="space-y-1 rounded-md border border-dashed border-black/15 p-2">
            <span className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">Reference image (for tracing)</span>
            {scene.trace ? (
              <>
                <p className="text-[11px] break-all text-neutral-500">
                  {scene.trace.image} · {scene.trace.width}×{scene.trace.height}px
                </p>
                <div className="flex gap-2">
                  <label className={`${BUTTON} flex-1`}>
                    Replace
                    <input type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && setPlottingImage(e.target.files[0]).finally(() => (e.target.value = ""))} />
                  </label>
                  <button type="button" className={BUTTON} onClick={() => setScene({ trace: undefined })}>
                    Remove
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-[11px] text-neutral-500">
                  The same area with the plots marked — CAD, PDF export, a render with lines… It doesn&apos;t have to be the same picture: you place it on top of the image above. Visitors never see it.
                </p>
                <label className={`${BUTTON} w-full`}>
                  + Add reference image
                  <input type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && setPlottingImage(e.target.files[0]).finally(() => (e.target.value = ""))} />
                </label>
              </>
            )}
          </div>
          <button type="button" className={`${BUTTON} w-full`} onClick={() => setDetailsOpen(true)} title="Excel of plot details by hotspot ID → this project + Contentful">
            Plot details (Excel → Contentful)…
          </button>
          {detailsOpen && <PlotDetails project={project} scene={scene} onChange={onChange} onStatus={onStatus} onClose={() => setDetailsOpen(false)} />}
          <div className="flex gap-2">
            <label className={`${BUTTON} flex-1`}>
              Replace image
              <input type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && replaceImage(e.target.files[0]).finally(() => (e.target.value = ""))} />
            </label>
            <button
              type="button"
              className={`${BUTTON} ${confirmDelete ? "border-red-500 text-red-600" : ""}`}
              onClick={() => (confirmDelete ? deleteScene() : setConfirmDelete(true))}
              onBlur={() => setConfirmDelete(false)}
            >
              {confirmDelete ? "Sure?" : "Delete"}
            </button>
          </div>
        </section>
      )}

      <PlotLook project={project} sceneId={sceneId} onChange={onChange} />

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Categories</h2>
        <p className="text-[11px] text-neutral-500">Colour + legend entry, e.g. Available / Sold. Viewers can filter by them. The round button sets the icon its pins show (a built-in symbol or your own image), e.g. one per amenity type.</p>
        {project.categories.map((c) => (
          <div key={c.id} className="flex items-center gap-1.5">
            <input type="color" value={c.color} onChange={(e) => setCategory(c.id, { color: e.target.value })} className="h-8 w-8 shrink-0 cursor-pointer rounded border border-black/10" />
            <CategoryLabel category={c} onCommit={(label) => setCategory(c.id, { label })} />
            <IconPicker value={c.icon} color={c.color} size={32} align="right" onChange={(icon) => setCategory(c.id, { icon })} onStatus={onStatus} />
            <button type="button" className="cursor-pointer px-1 text-neutral-400 hover:text-red-600" onClick={() => removeCategory(c.id)} aria-label={`Remove ${c.label}`}>
              ✕
            </button>
          </div>
        ))}
        <button type="button" className={`${BUTTON} w-full`} onClick={addCategory}>+ Add category</button>
      </section>
    </aside>
  );
}

function CategoryLabel({ category, onCommit }: { category: Category; onCommit: (label: string) => void }) {
  const [draft, setDraft] = useState(category.label);
  return (
    <input
      className={INPUT}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== category.label && onCommit(draft)}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
    />
  );
}
