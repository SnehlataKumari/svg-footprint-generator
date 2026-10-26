"use client";

import gsap from "gsap";
import { useEffect, useMemo, useRef, useState } from "react";
import { imageUrl } from "@/lib/browser-store";
import { boundingBox, centroid } from "@/lib/geometry";
import { ancestry } from "@/lib/scene-tree";
import { categoryColor, resolveStyle } from "@/lib/style";
import type { Project, Shape } from "@/lib/types";
import { usePanZoom } from "@/lib/use-pan-zoom";
import { ICON_BUTTON, PILL, SURFACE } from "../ui";
import { DetailsCard } from "./details-card";
import { ShapeLayer } from "./shape-layer";

interface Props {
  project: Project;
  sceneId: string;
  /** Called after the zoom-in / zoom-out animation: show this scene. */
  onNavigate: (sceneId: string) => void;
  /** Called as soon as a navigation starts (route mode prefetches here). */
  onPrefetch?: (sceneId: string) => void;
  /** Handle + / − / 0 / arrows anywhere on the page (full-screen use).
   *  Otherwise only while focus is inside the map. */
  globalKeys?: boolean;
  /** Dev only: link back to the editor for this scene (shows a button, and a
   *  note when the scene has no plots yet). */
  editorHref?: string;
}

/** Resolves after `ms` — a fallback so navigation never waits on an animation
 *  that can't finish (GSAP runs on requestAnimationFrame, which browsers pause
 *  in background tabs). */
const after = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * One scene: the image, its shapes, and all the chrome around it. Fills its
 * parent (give the parent a size). Knows nothing about routing — use
 * <InteractiveMap>, which decides whether a scene change is a URL change or
 * just a state change.
 */
export function SceneViewer({ project, sceneId, onNavigate, onPrefetch, globalKeys = false, editorHref }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const scene = project.scenes.find((s) => s.id === sceneId)!;
  const trail = useMemo(() => ancestry(project, sceneId), [project, sceneId]);
  const { containerRef, handlers, fit, transform, overlay, view, zoomAt, panBy, reset, animateTo, wasDrag } = usePanZoom({ aspect: scene.width / scene.height });
  const frameRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState<Shape | null>(null);
  const [hovered, setHovered] = useState<{ shape: Shape; x: number; y: number } | null>(null);
  const [hiddenCategories, setHiddenCategories] = useState<Set<string>>(new Set());

  const sceneCategories = useMemo(
    () => project.categories.filter((c) => scene.shapes.some((s) => s.category === c.id && !s.hidden)),
    [project.categories, scene.shapes],
  );
  const visibleShapes = useMemo(
    () => scene.shapes.filter((s) => !s.hidden && !(s.category && hiddenCategories.has(s.category))),
    [scene.shapes, hiddenCategories],
  );
  const styleOf = (shape: Shape) => resolveStyle(project, scene, shape);

  // A cached image can finish loading before React hydrates and attaches
  // onLoad — catch that case too.
  useEffect(() => {
    if (imgRef.current?.complete) setLoaded(true);
  }, []);

  // Arrival: settle in from slightly zoomed + faded once the image is ready.
  useEffect(() => {
    if (!loaded || !frameRef.current || reducedMotion()) return;
    gsap.fromTo(
      frameRef.current,
      { scale: 1.06, opacity: 0, filter: "blur(6px)" },
      { scale: 1, opacity: 1, filter: "blur(0px)", duration: 0.55, ease: "power2.out", clearProps: "all" },
    );
  }, [loaded]);

  /** Zoom into the shape, fade, then load its linked scene. */
  const enter = async (shape: Shape) => {
    const target = shape.link;
    if (!target) return;
    onPrefetch?.(target);
    if (!reducedMotion()) {
      const [cx, cy] = centroid(shape.points);
      const box = boundingBox(shape.points);
      const k = Math.min(8, Math.max(2, 60 / Math.max(box.width, box.height, 1)));
      gsap.to(frameRef.current, { opacity: 0, filter: "blur(4px)", duration: 0.45, delay: 0.2 });
      await Promise.race([animateTo({ cx, cy, k }, 0.65), after(900)]);
    }
    onNavigate(target);
  };

  /** Back out to a parent scene. */
  const leave = (target: string) => {
    if (reducedMotion()) return onNavigate(target);
    const done = new Promise<void>((resolve) =>
      gsap.to(frameRef.current, { scale: 0.94, opacity: 0, duration: 0.35, ease: "power2.in", onComplete: resolve }),
    );
    Promise.race([done, after(600)]).then(() => onNavigate(target));
  };

  const activate = (shape: Shape) => {
    const hasDetails = !!(shape.description || shape.image || shape.url || Object.keys(shape.info ?? {}).length);
    if (hasDetails) setSelected(shape);
    else if (shape.link) enter(shape);
  };

  // Keyboard: + / - / 0 zoom, arrows pan, Escape closes the card.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || (e.target as HTMLElement).closest("input, textarea, select")) return;
      if (!globalKeys && !rootRef.current?.contains(document.activeElement)) return;
      if (e.key === "Escape") setSelected(null);
      else if (e.key === "+" || e.key === "=") zoomAt(1.4);
      else if (e.key === "-") zoomAt(1 / 1.4);
      else if (e.key === "0") reset();
      else if (e.key.startsWith("Arrow") && !(e.target as HTMLElement).closest("[data-shape]")) {
        const step = 80;
        panBy(
          e.key === "ArrowLeft" ? step : e.key === "ArrowRight" ? -step : 0,
          e.key === "ArrowUp" ? step : e.key === "ArrowDown" ? -step : 0,
        );
      } else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomAt, panBy, reset, globalKeys]);

  const parent = trail.length > 1 ? trail[trail.length - 2] : undefined;

  return (
    // tabIndex -1: clicking the map focuses it, so its keyboard shortcuts
    // apply to this map only when it's embedded in a bigger page.
    <div ref={rootRef} tabIndex={-1} className="relative h-full w-full overflow-hidden bg-neutral-900 outline-none select-none">
      <h2 className="sr-only">{scene.title}</h2>

      <div ref={frameRef} className="absolute inset-0">
        <div
          ref={containerRef}
          {...handlers}
          className="absolute inset-0 touch-none cursor-grab active:cursor-grabbing"
        >
          <div
            className="absolute top-0 left-0 origin-top-left"
            style={{ width: fit.width, height: fit.height, transform: transform }}
          >
            {/* Plain <img>: the stage zooms up to 10x, so it needs the full-size
                file, not a viewport-sized next/image variant. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              ref={imgRef}
              src={imageUrl(scene.image)}
              alt=""
              draggable={false}
              onLoad={() => setLoaded(true)}
              onError={() => setLoaded(true)}
              className="absolute inset-0 h-full w-full"
            />
            <ShapeLayer
              shapes={visibleShapes}
              styleOf={styleOf}
              zoom={view.k}
              overlay={overlay}
              selectedId={selected?.id}
              onActivate={(s) => !wasDrag() && activate(s)}
              onHover={(shape, x, y) => setHovered(shape ? { shape, x, y } : null)}
            />
          </div>
        </div>
      </div>

      {!loaded && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-white/20 border-t-white" />
        </div>
      )}

      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" className={`absolute top-4 left-4 ${PILL} max-w-[calc(100%-2rem)]`}>
        {parent && (
          <button type="button" onClick={() => leave(parent.id)} className="cursor-pointer pr-1" aria-label={`Back to ${parent.title}`}>
            ←
          </button>
        )}
        <ol className="flex min-w-0 items-center gap-1.5 truncate">
          {trail.map((s, i) => (
            <li key={s.id} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-neutral-400">/</span>}
              {i === trail.length - 1 ? (
                <span aria-current="page" className="font-medium">{s.title}</span>
              ) : (
                <button type="button" className="cursor-pointer text-neutral-600 hover:underline" onClick={() => leave(s.id)}>
                  {s.title}
                </button>
              )}
            </li>
          ))}
        </ol>
      </nav>

      {editorHref && (
        <button
          type="button"
          onClick={() => {
            // Opened by the editor's Preview: close this tab and go back to it.
            if (window.opener && !window.opener.closed) {
              window.opener.focus();
              window.close();
            } else window.location.href = editorHref;
          }}
          className={`absolute top-4 right-4 cursor-pointer ${PILL} hover:bg-neutral-100`}
        >
          ← Back to editor
        </button>
      )}
      {editorHref && loaded && !scene.shapes.some((s) => !s.hidden) && (
        <div className={`absolute bottom-20 left-1/2 max-w-md -translate-x-1/2 px-4 py-3 text-center text-sm ${SURFACE}`}>
          <b>No plots on this scene yet.</b> In the editor: Auto-detect → <b>Add … shapes</b> (or draw them), then <b>Save</b>.
        </div>
      )}

      {/* Legend + filter */}
      {sceneCategories.length > 0 && (
        <div className={`absolute bottom-4 left-4 ${SURFACE} p-2 text-sm`}>
          {sceneCategories.map((c) => {
            const off = hiddenCategories.has(c.id);
            return (
              <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 hover:bg-neutral-100">
                <input
                  type="checkbox"
                  checked={!off}
                  onChange={() =>
                    setHiddenCategories((prev) => {
                      const next = new Set(prev);
                      if (off) next.delete(c.id);
                      else next.add(c.id);
                      return next;
                    })
                  }
                  className="sr-only"
                />
                <span className="h-3 w-3 rounded-sm" style={{ background: off ? "transparent" : categoryColor(project, c), outline: `2px solid ${categoryColor(project, c)}` }} />
                <span className={off ? "text-neutral-400 line-through" : ""}>{c.label}</span>
              </label>
            );
          })}
        </div>
      )}

      {/* Zoom controls */}
      <div className={`absolute right-4 bottom-4 flex flex-col overflow-hidden ${SURFACE}`}>
        <button type="button" className={ICON_BUTTON} onClick={() => zoomAt(1.4)} aria-label="Zoom in">+</button>
        <button type="button" className={ICON_BUTTON} onClick={() => zoomAt(1 / 1.4)} aria-label="Zoom out">−</button>
        <button type="button" className={`${ICON_BUTTON} text-sm`} onClick={reset} aria-label="Reset zoom">⤢</button>
      </div>

      {/* Tooltip */}
      {hovered && !selected && styleOf(hovered.shape).label !== "none" && (
        <div
          className="pointer-events-none fixed z-20 rounded-md bg-neutral-900/90 px-2 py-1 text-xs text-white"
          style={{ left: hovered.x + 14, top: hovered.y + 14 }}
        >
          <div className="font-medium">{hovered.shape.label || hovered.shape.id}</div>
          {hovered.shape.category && (
            <div className="text-white/70">{project.categories.find((c) => c.id === hovered.shape.category)?.label}</div>
          )}
        </div>
      )}

      {selected && (
        <DetailsCard
          shape={selected}
          category={project.categories.find((c) => c.id === selected.category)}
          linkTitle={project.scenes.find((s) => s.id === selected.link)?.title}
          onClose={() => setSelected(null)}
          onEnter={() => {
            setSelected(null);
            enter(selected);
          }}
        />
      )}
    </div>
  );
}
