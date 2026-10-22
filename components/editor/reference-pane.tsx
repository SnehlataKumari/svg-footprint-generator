"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Point, TraceImage } from "@/lib/types";
import { traceMapper } from "@/lib/warp";
import { usePanZoom } from "@/lib/use-pan-zoom";
import { ICON_BUTTON, SURFACE } from "../ui";
import type { AligningState } from "./canvas";

/**
 * Side-by-side view: the reference image exactly as it is (unwarped, nothing
 * drawn over it), next to the scene image. Only the linked cursor and, while
 * placing the reference, the matching points are shown on it.
 */

/** A tiny shared value that only its subscribers re-render for (the linked
 *  cursor and the followed view change on every pointer move). */
export interface Store<T> {
  get: () => T;
  set: (v: T) => void;
  subscribe: (fn: () => void) => () => void;
}

export function createStore<T>(initial: T): Store<T> {
  let value = initial;
  const subs = new Set<() => void>();
  return {
    get: () => value,
    set: (v) => {
      value = v;
      subs.forEach((fn) => fn());
    },
    subscribe: (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

export const useStore = <T,>(store: Store<T>) => useSyncExternalStore(store.subscribe, store.get, store.get);

/** Where the pointer is, in SCENE percent, and which pane it is over. */
export type LinkedCursor = { pane: "reference" | "scene"; point: Point } | null;

/** The scene pane's view: its centre (scene %) and screen px per scene %. */
export type SceneView = { cx: number; cy: number; pxPerPct: number } | null;

interface Props {
  trace: TraceImage;
  aligning: AligningState | null;
  cursor: Store<LinkedCursor>;
  sceneView: Store<SceneView>;
  /** A click on the reference while placing it: a matching point's reference side. */
  onPickReference: (p: Point) => void;
  /** Dragging a matching point's reference-side marker. */
  onMovePointFrom: (index: number, from: Point) => void;
  onCheckpoint: () => void;
}

export function ReferencePane(p: Props) {
  const { trace, aligning } = p;
  const mapper = useMemo(() => traceMapper(trace), [trace]);
  const { containerRef, handlers, fit, transform, view, zoomAt, reset, setView, wasDrag, toImage } = usePanZoom({
    aspect: trace.width / trace.height,
    maxZoom: 40,
    canPan: (e) => !(e.target as Element).closest("[data-nopan]"),
  });
  const [follow, setFollow] = useState(true);
  const propsRef = useRef(p);
  useEffect(() => {
    propsRef.current = p;
  });

  // Follow the scene pane: same spot in the middle, same on-screen scale.
  useEffect(() => {
    if (!follow) return;
    const apply = () => {
      const v = p.sceneView.get();
      if (!v || !fit.width) return;
      const r0 = mapper.toReference([v.cx, v.cy]);
      const r1 = mapper.toReference([v.cx + 1, v.cy]);
      const refPx = Math.hypot(((r1[0] - r0[0]) * fit.width) / 100, ((r1[1] - r0[1]) * fit.height) / 100);
      if (!(refPx > 0)) return;
      setView({ cx: r0[0], cy: r0[1], k: v.pxPerPct / refPx });
    };
    apply();
    return p.sceneView.subscribe(apply);
  }, [follow, p.sceneView, mapper, fit, setView]);

  const onPointerMove = (e: React.PointerEvent) => {
    handlers.onPointerMove(e);
    p.cursor.set({ pane: "reference", point: mapper.toScene(toImage(e.clientX, e.clientY)) });
  };

  const onClick = (e: React.MouseEvent) => {
    if (wasDrag() || (e.target as Element).closest("[data-nopan]")) return;
    const here = toImage(e.clientX, e.clientY);
    if (here[0] < 0 || here[1] < 0 || here[0] > 100 || here[1] > 100) return;
    if (aligning && !trace.locked) p.onPickReference(here);
  };

  const onFromMarkerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || trace.locked) return;
    e.stopPropagation();
    const index = Number((e.currentTarget as HTMLElement).dataset.index);
    propsRef.current.onCheckpoint();
    const onMove = (ev: PointerEvent) => propsRef.current.onMovePointFrom(index, toImage(ev.clientX, ev.clientY));
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  const k = view.k;
  const counter = { transform: `translate(-50%, -50%) scale(${1 / k})` };
  const points = trace.points ?? [];

  return (
    <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden border-r-2 border-neutral-950 bg-neutral-800">
      <div
        ref={containerRef}
        {...handlers}
        onPointerMove={onPointerMove}
        onPointerLeave={() => p.cursor.set(null)}
        onClick={onClick}
        className={`absolute inset-0 touch-none select-none ${aligning ? "cursor-crosshair" : "cursor-default"}`}
      >
        <div className="absolute top-0 left-0 origin-top-left" style={{ width: fit.width, height: fit.height, transform }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={trace.image} alt="" draggable={false} className="absolute inset-0 h-full w-full" />

          {/* Matching points: the reference side (drag to fine-tune) */}
          {aligning &&
            points.map((pt, i) => (
              <div key={i} className="absolute" style={{ left: `${pt.from[0]}%`, top: `${pt.from[1]}%` }}>
                <div
                  data-nopan=""
                  data-index={i}
                  onPointerDown={onFromMarkerDown}
                  title="Drag to adjust this matching point"
                  className="flex h-5 w-5 cursor-move items-center justify-center rounded-full border-2 border-white bg-fuchsia-600 text-[10px] font-bold text-white"
                  style={counter}
                >
                  {i + 1}
                </div>
              </div>
            ))}
          {aligning?.pending && (
            <div className="pointer-events-none absolute" style={{ left: `${aligning.pending[0]}%`, top: `${aligning.pending[1]}%` }}>
              <div className="h-5 w-5 animate-pulse rounded-full border-2 border-fuchsia-500 bg-fuchsia-500/40" style={counter} />
            </div>
          )}

          <CursorMarker store={p.cursor} showFor="scene" map={mapper.toReference} counter={counter} />
        </div>
      </div>

      <div className="pointer-events-none absolute top-3 left-3 rounded bg-black/60 px-2 py-1 text-xs font-medium text-white">Reference</div>

      <div className={`absolute top-3 right-3 flex flex-col overflow-hidden ${SURFACE}`}>
        <button type="button" className={ICON_BUTTON} onClick={() => (setFollow(false), zoomAt(1.5))} aria-label="Zoom in">+</button>
        <button type="button" className={ICON_BUTTON} onClick={() => (setFollow(false), zoomAt(1 / 1.5))} aria-label="Zoom out">−</button>
        <button type="button" className={`${ICON_BUTTON} text-sm`} onClick={() => (setFollow(false), reset())} aria-label="Fit">⤢</button>
      </div>

      <label className="absolute bottom-3 left-3 flex items-center gap-1 rounded bg-black/60 px-2 py-1 text-[11px] text-white" title="Pan / zoom this side together with your image">
        <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> Follow your image
      </label>
    </div>
  );
}

/** The other pane's pointer, drawn at the same spot on this pane. */
export function CursorMarker({
  store,
  showFor,
  map,
  counter,
}: {
  store: Store<LinkedCursor>;
  /** Draw only while the pointer is over this (the other) pane. */
  showFor: "reference" | "scene";
  /** Scene % -> this pane's percent. */
  map: (p: Point) => Point;
  counter: React.CSSProperties;
}) {
  const c = useStore(store);
  if (!c || c.pane !== showFor) return null;
  const [x, y] = map(c.point);
  return (
    <div className="pointer-events-none absolute" style={{ left: `${x}%`, top: `${y}%` }}>
      <div className="relative h-7 w-7" style={counter}>
        <div className="absolute inset-0 rounded-full border-2 border-lime-400 shadow-[0_0_0_1px_rgba(0,0,0,0.6)]" />
        <div className="absolute top-1/2 left-[-6px] h-0.5 w-[calc(100%+12px)] -translate-y-1/2 bg-lime-400" />
        <div className="absolute top-[-6px] left-1/2 h-[calc(100%+12px)] w-0.5 -translate-x-1/2 bg-lime-400" />
      </div>
    </div>
  );
}
