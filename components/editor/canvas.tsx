"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { applyAffine, composeAffine, rotationDelta, scaleDelta, svgMatrix } from "@/lib/affine";
import { imageUrl } from "@/lib/browser-store";
import { boundingBox, centroid, pointInPolygon, round2, toSvgPoints } from "@/lib/geometry";
import { applyBox, type ImportedSvg, type PlacementBox } from "@/lib/svg-import";
import { type DetectOptions, detectByComparison, traceRegion } from "@/lib/trace";
import type { Affine, PlotStyle, Point, Scene, Shape, ShapeKind, TraceImage } from "@/lib/types";
import { drawTriangles, type Mapper, traceMapper } from "@/lib/warp";
import { usePanZoom } from "@/lib/use-pan-zoom";
import { ICON_BUTTON, SURFACE } from "../ui";
import { PinIcon } from "../pin-icon";
import { CursorMarker, type LinkedCursor, type SceneView, type Store } from "./reference-pane";

export type Tool = "select" | "detect" | "number" | "wand" | "polygon" | "line" | "pin";

export interface AlignState {
  svg: ImportedSvg;
  box: PlacementBox;
}

/** A rectangle in percent-of-image. */
export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Which image the Wand / Auto-detect read pixels from, and how its percent
 *  coordinates map to the scene (development) image's. */
export interface TraceSource {
  image: string;
  fromDisplay: (p: Point) => Point;
  toDisplay: (p: Point) => Point;
}

/** side = the reference next to your image (default) · overlay = on top of it. */
export type ImageView = "side" | "development" | "plotting" | "overlay";

/** Aligning the reference: waiting for the reference-side or scene-side
 *  click of a new matching point (`pending` = its reference spot). */
export interface AligningState {
  awaiting: "from" | "to" | null;
  pending?: Point;
}

/** What placement drags change: the transform and the matching points move together. */
export type Placing = Pick<TraceImage, "transform" | "points">;

export interface Detection {
  regions: Point[][];
  /** Indexes the user clicked off (or that were already traced). */
  excluded: Set<number>;
  /** Of those, the ones skipped only because a plot is already there. */
  overlap?: Set<number>;
  /** Names / colours that come with the regions (Generate from reference). */
  meta?: { id: string; label: string; color?: string; kind?: ShapeKind; style?: PlotStyle; category?: string; icon?: string }[];
}

interface Props {
  scene: Scene;
  colorOf: (shape: Shape) => string;
  /** A pin's icon (its own, else its category's), if any. */
  iconOf: (shape: Shape) => string | undefined;
  selectedIds: string[];
  tool: Tool;
  traceOptions: DetectOptions;
  /** The scene's reference image (drawn under the shapes depending on `view`). */
  plotting?: TraceImage;
  view: ImageView;
  source: TraceSource;
  /** Aligning the reference: handles + matching-point clicks. */
  aligning: AligningState | null;
  onAlignClick: (p: Point) => void;
  /** Continuous change while dragging the placement handles (no undo step). */
  onPlacing: (next: Placing) => void;
  /** Continuous change while dragging a matching point's scene-side marker. */
  onMovePoint: (index: number, to: Point) => void;
  showLabels: boolean;
  align: AlignState | null;
  detection: Detection | null;
  detectLimit: Rect | null;
  /** Bump `n` to pan/zoom the canvas onto shape `id`. */
  focusRequest: { id: string; n: number } | null;
  /** replace = select only these · toggle = shift+click · add = shift+drag box */
  onSelect: (ids: string[], mode: "replace" | "toggle" | "add") => void;
  onCreate: (kind: ShapeKind, points: Point[]) => void;
  /** Change shapes' points without an undo step (called on every drag move). */
  onEditShapes: (points: Record<string, Point[]>) => void;
  /** Record an undo step — called once at the start of each drag. */
  onCheckpoint: () => void;
  onAlignBox: (box: PlacementBox) => void;
  onStatus: (message: string, isError?: boolean) => void;
  /** Detect tool: the user clicked a sample at this point. */
  onDetect: (point: Point) => void;
  onToggleCandidate: (index: number) => void;
  onDetectLimit: (rect: Rect | null) => void;
  /** Number tool: the user clicked / swept over this shape. Passed as the
   *  object (not its id), since ids change while numbering. */
  onNumber: (shape: Shape) => void;
  /** Side-by-side view: the pointer, shared with the reference pane. */
  cursor?: Store<LinkedCursor>;
  /** Side-by-side view: this pane's view, so the reference pane can follow it. */
  sceneView?: Store<SceneView>;
  /** Small caption in the corner ("Your image") when shown next to the reference. */
  caption?: string;
}

/** Snap to an existing vertex within this many screen pixels (hold Alt to disable). */
const SNAP_PX = 10;
/** Close a polygon by clicking within this many pixels of its first point. */
const CLOSE_PX = 10;
const MIN_BOX = 1;

type Drag =
  | { type: "vertex"; shapeId: string; index: number; started: boolean }
  | { type: "move"; start: Point; originals: Record<string, Point[]>; started: boolean }
  | { type: "box"; mode: string; startX: number; startY: number; startBox: PlacementBox }
  | { type: "marquee"; start: Point }
  | { type: "placing"; mode: string; start: Point; startState: Placing; anchor: Point; axis: number }
  | { type: "point"; index: number };

const HINTS: Record<Tool, string> = {
  select: "Click = select · Shift+click = add/remove · Shift+drag = box-select · drag = move · Ctrl+A = all · arrows nudge",
  detect: "Click ONE plot as a sample → every similar plot is found · click a result to skip it · Shift+drag = limit the search area",
  number: "Click shapes — or hold the mouse and sweep across them — in the order you want them numbered",
  wand: "Click inside a plot to outline just that one (with Auto-detect's Compare mode: between the drawn lines)",
  polygon: "Click to add points · click the first point / Enter / double-click to close · Backspace undoes a point · Esc cancels · Alt = no snapping",
  line: "Click to add points · Enter / double-click to finish · Backspace undoes a point · Esc cancels",
  pin: "Click to drop a pin",
};

/** The reference image's corners: top-left, top-right, bottom-right, bottom-left. */
const REF_CORNERS: Point[] = [
  [0, 0],
  [100, 0],
  [100, 100],
  [0, 100],
];

/** Apply a scene-% change to the placement: the transform and every matching
 *  point's scene side move together, so the fit is kept. */
const applyDelta = (d: Affine, start: Placing): Placing => ({
  transform: composeAffine(d, start.transform),
  points: start.points?.map((p) => ({ ...p, to: applyAffine(d, p.to) })),
});

const rectFrom = (a: Point, b: Point): Rect => ({
  left: Math.min(a[0], b[0]),
  top: Math.min(a[1], b[1]),
  right: Math.max(a[0], b[0]),
  bottom: Math.max(a[1], b[1]),
});

export function EditorCanvas(props: Props) {
  const { scene, colorOf, iconOf, selectedIds, tool, traceOptions, showLabels, align, detection, detectLimit, plotting, view: imageView, aligning } = props;
  const propsRef = useRef(props);
  useEffect(() => {
    propsRef.current = props;
  });

  const boxSelects = tool === "select" || tool === "detect";
  // Rebuilt only when the reference's fit changes (a warped overlay redraws on change).
  const mapper = useMemo(() => (plotting ? traceMapper(plotting) : null), [plotting]);
  const spaceDown = useRef(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const { containerRef, handlers, fit, transform, overlay, view, zoomAt, reset, animateTo, wasDrag, toImage, pxPerPct } = usePanZoom({
    aspect: scene.width / scene.height,
    maxZoom: 40,
    canPan: (e) =>
      spaceDown.current || (!(e.target as Element).closest("[data-nopan]") && !(e.shiftKey && boxSelects)),
  });

  const [draft, setDraft] = useState<Point[]>([]);
  const [cursor, setCursor] = useState<{ point: Point; snapped: boolean } | null>(null);
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [busy, setBusy] = useState(false);
  const drag = useRef<Drag | null>(null);
  /** The click that ends a box-select must not also act as a click. */
  const swallowClick = useRef(false);
  /** Number tool: shapes already numbered in the current click/sweep (by
   *  their points array, which survives renames) and the last pointer spot. */
  const stroke = useRef<{ seen: WeakSet<Point[]>; last: Point } | null>(null);

  // A new scene starts with a fresh view and no half-drawn shape.
  const [shownScene, setShownScene] = useState(scene.id);
  if (shownScene !== scene.id) {
    setShownScene(scene.id);
    setDraft([]);
    setCursor(null);
  }
  const resetRef = useRef(reset);
  useEffect(() => {
    resetRef.current = reset;
  });
  useEffect(() => resetRef.current(), [scene.id]);

  // Changing tool abandons a half-drawn shape.
  const [shownTool, setShownTool] = useState(tool);
  if (shownTool !== tool) {
    setShownTool(tool);
    setDraft([]);
  }

  /** Screen distance (px) between two image points at the current zoom. */
  const screenDist = useCallback(
    (a: Point, b: Point) => Math.hypot((a[0] - b[0]) * pxPerPct.x, (a[1] - b[1]) * pxPerPct.y),
    [pxPerPct],
  );

  /** Snap to the nearest existing vertex (any shape, or the draft itself). */
  const snap = useCallback(
    (p: Point, altKey: boolean, exclude?: { shapeId: string; index: number }): { point: Point; snapped: boolean } => {
      if (altKey) return { point: p, snapped: false };
      let best: Point | null = null;
      let bestDist = SNAP_PX;
      const consider = (q: Point) => {
        const d = screenDist(p, q);
        if (d < bestDist) {
          bestDist = d;
          best = q;
        }
      };
      for (const shape of propsRef.current.scene.shapes) {
        shape.points.forEach((q, i) => {
          if (exclude && exclude.shapeId === shape.id && exclude.index === i) return;
          consider(q);
        });
      }
      draft.forEach(consider);
      return best ? { point: [best[0], best[1]], snapped: true } : { point: p, snapped: false };
    },
    [screenDist, draft],
  );

  const finishDraft = useCallback(() => {
    const kind: ShapeKind = tool === "line" ? "line" : "polygon";
    const min = kind === "line" ? 2 : 3;
    if (draft.length >= min) propsRef.current.onCreate(kind, draft.map(([x, y]) => [round2(x), round2(y)]));
    setDraft([]);
  }, [draft, tool]);
  const finishDraftRef = useRef(finishDraft);
  useEffect(() => {
    finishDraftRef.current = finishDraft;
  });

  // Drawing keys. Registered before the editor's own key handler (child
  // effects run first), and they preventDefault so it skips them.
  useEffect(() => {
    const typing = (e: KeyboardEvent) => (e.target as HTMLElement).closest?.("input, textarea, select, [contenteditable]");
    const onDown = (e: KeyboardEvent) => {
      if (typing(e)) return;
      if (e.code === "Space") {
        e.preventDefault();
        if (!spaceDown.current) {
          spaceDown.current = true;
          setSpaceHeld(true);
        }
        return;
      }
      if (!draft.length) return;
      if (e.key === "Enter") finishDraft();
      else if (e.key === "Escape") setDraft([]);
      else if (e.key === "Backspace" || e.key === "Delete") setDraft((d) => d.slice(0, -1));
      else return;
      e.preventDefault();
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        spaceDown.current = false;
        setSpaceHeld(false);
      }
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
  }, [draft, finishDraft]);

  // Pan/zoom onto a shape when the panel asks for it.
  useEffect(() => {
    const req = props.focusRequest;
    if (!req) return;
    const shape = propsRef.current.scene.shapes.find((s) => s.id === req.id);
    if (!shape) return;
    const [cx, cy] = centroid(shape.points);
    const box = boundingBox(shape.points);
    animateTo({ cx, cy, k: Math.min(20, Math.max(1.5, 40 / Math.max(box.width, box.height, 0.5))) }, 0.5);
  }, [props.focusRequest, animateTo]);

  // ---- Background click: the active tool's action ----
  const onClick = async (e: React.MouseEvent) => {
    if (swallowClick.current) {
      swallowClick.current = false;
      return;
    }
    if (aligning) {
      if (wasDrag() || spaceDown.current || (e.target as Element).closest("[data-nopan]")) return;
      return props.onAlignClick(toImage(e.clientX, e.clientY));
    }
    if (wasDrag() || spaceDown.current) return;
    if ((e.target as Element).closest("[data-nopan]")) return;
    const raw = toImage(e.clientX, e.clientY);
    if (raw[0] < 0 || raw[1] < 0 || raw[0] > 100 || raw[1] > 100) return;

    if (tool === "select") return e.shiftKey ? undefined : props.onSelect([], "replace");
    if (tool === "number") return;
    if (tool === "detect") return props.onDetect(raw);
    if (tool === "pin") return props.onCreate("pin", [[round2(raw[0]), round2(raw[1])]]);
    if (tool === "wand") {
      if (busy) return;
      setBusy(true);
      try {
        const { source } = props;
        const [sx, sy] = source.fromDisplay(raw);
        // Compare mode + reading the reference: outline the plot the same way
        // Auto-detect does (between the drawn lines), not by colour.
        const compare = traceOptions.mode === "compare" && plotting && source.image === plotting.image;
        const result = compare
          ? await detectByComparison(scene.image, plotting, sx, sy, { ...traceOptions, onlySample: true }).then((r) =>
              "error" in r ? r : { points: r.regions[0] },
            )
          : await traceRegion(source.image, sx, sy, traceOptions);
        if ("error" in result) props.onStatus(result.error, true);
        else props.onCreate("polygon", result.points.map((pt) => source.toDisplay(pt)).map(([x, y]) => [round2(x), round2(y)]));
      } catch (err) {
        props.onStatus((err as Error).message, true);
      } finally {
        setBusy(false);
      }
      return;
    }
    // polygon / line
    const { point } = snap(raw, e.altKey);
    if (tool === "polygon" && draft.length >= 3 && screenDist(point, draft[0]) < CLOSE_PX) return finishDraft();
    setDraft((d) => [...d, point]);
  };

  const onDoubleClick = () => {
    if (tool !== "polygon" && tool !== "line") return;
    // The two clicks of a double-click already added the same point twice.
    setDraft((d) => d.slice(0, -1));
    setTimeout(() => finishDraftRef.current(), 0);
  };

  // Side-by-side: let the reference pane follow this one.
  const sceneViewStore = props.sceneView;
  useEffect(() => {
    sceneViewStore?.set({ cx: view.cx, cy: view.cy, pxPerPct: pxPerPct.x });
  }, [sceneViewStore, view.cx, view.cy, pxPerPct.x]);

  const onPointerMove = (e: React.PointerEvent) => {
    handlers.onPointerMove(e);
    props.cursor?.set({ pane: "scene", point: toImage(e.clientX, e.clientY) });
    if (tool === "polygon" || tool === "line") setCursor(snap(toImage(e.clientX, e.clientY), e.altKey));
    else if (cursor) setCursor(null);
  };

  // ---- Drags: vertices, moving shapes, the align box, box-select ----
  const startDrag = (d: Drag) => {
    drag.current = d;
    const onMove = (e: PointerEvent) => {
      const cur = drag.current;
      if (!cur) return;
      const p = propsRef.current;
      const here = toImage(e.clientX, e.clientY);
      if (cur.type === "marquee") {
        setMarquee(rectFrom(cur.start, here));
        return;
      }
      if (cur.type === "point") return p.onMovePoint(cur.index, here);
      if (cur.type === "placing") {
        const sz = { sceneW: p.scene.width, sceneH: p.scene.height };
        const px = (q: Point): Point => [(q[0] * sz.sceneW) / 100, (q[1] * sz.sceneH) / 100];
        const [hx, hy] = px(here);
        const [sx0, sy0] = px(cur.start);
        const [ax, ay] = px(cur.anchor);
        let d: Affine;
        if (cur.mode === "move") d = [1, 0, here[0] - cur.start[0], 0, 1, here[1] - cur.start[1]];
        else if (cur.mode === "rotate") {
          let deg = ((Math.atan2(hy - ay, hx - ax) - Math.atan2(sy0 - ay, sx0 - ax)) * 180) / Math.PI;
          if (e.shiftKey) deg = Math.round(deg / 15) * 15;
          d = rotationDelta(deg, cur.anchor, sz);
        } else if (cur.mode.length === 2) {
          // Corner: uniform scale about the opposite corner (Alt: about the centre).
          const k = Math.hypot(hx - ax, hy - ay) / Math.max(1e-6, Math.hypot(sx0 - ax, sy0 - ay));
          d = scaleDelta(k, k, 0, cur.anchor, sz);
        } else {
          // Edge: stretch along the reference's own axis.
          const rad = (cur.axis * Math.PI) / 180;
          const [ux, uy] = [Math.cos(rad), Math.sin(rad)];
          const k = ((hx - ax) * ux + (hy - ay) * uy) / ((sx0 - ax) * ux + (sy0 - ay) * uy || 1e-6);
          d = scaleDelta(Math.max(0.05, k), 1, cur.axis, cur.anchor, sz);
        }
        return p.onPlacing(applyDelta(d, cur.startState));
      }
      if (cur.type === "box") {
        const dx = (e.clientX - cur.startX) / pxPerPct.x;
        const dy = (e.clientY - cur.startY) / pxPerPct.y;
        p.onAlignBox(resizeBox(cur.mode, cur.startBox, dx, dy, e.altKey));
        return;
      }
      if (!cur.started) {
        p.onCheckpoint();
        cur.started = true;
      }
      if (cur.type === "vertex") {
        const shape = p.scene.shapes.find((s) => s.id === cur.shapeId);
        if (!shape) return;
        const { point } = snap(here, e.altKey, { shapeId: cur.shapeId, index: cur.index });
        const points = shape.points.slice();
        points[cur.index] = [round2(point[0]), round2(point[1])];
        p.onEditShapes({ [cur.shapeId]: points });
      } else {
        const dx = here[0] - cur.start[0];
        const dy = here[1] - cur.start[1];
        const moved: Record<string, Point[]> = {};
        for (const [id, pts] of Object.entries(cur.originals)) {
          moved[id] = pts.map(([x, y]) => [round2(x + dx), round2(y + dy)]);
        }
        p.onEditShapes(moved);
      }
    };
    const onUp = (e: PointerEvent) => {
      const cur = drag.current;
      drag.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      if (cur?.type !== "marquee") return;
      setMarquee(null);
      const end = toImage(e.clientX, e.clientY);
      if (screenDist(cur.start, end) < 4) return; // a shift+click, not a box
      swallowClick.current = true;
      const rect = rectFrom(cur.start, end);
      const p = propsRef.current;
      if (p.tool === "detect") return p.onDetectLimit(rect);
      const inside = p.scene.shapes
        .filter((s) => {
          const [x, y] = centroid(s.points);
          return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
        })
        .map((s) => s.id);
      p.onSelect(inside, "add");
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  const onContainerPointerDown = (e: React.PointerEvent) => {
    if (boxSelects && e.shiftKey && e.button === 0 && !spaceDown.current && !(e.target as Element).closest("[data-nopan]")) {
      swallowClick.current = false;
      startDrag({ type: "marquee", start: toImage(e.clientX, e.clientY) });
    }
    handlers.onPointerDown(e);
  };

  const onShapePointerDown = (e: React.PointerEvent) => {
    if (spaceDown.current || e.button !== 0) return;
    const id = (e.currentTarget as Element).getAttribute("data-shape-id")!;
    if (tool === "number") return startNumbering(e);
    if (e.shiftKey) return props.onSelect([id], "toggle");
    // Dragging a selected shape moves the whole selection.
    const ids = selectedIds.includes(id) ? selectedIds : [id];
    if (!selectedIds.includes(id)) props.onSelect([id], "replace");
    const originals: Record<string, Point[]> = {};
    for (const s of scene.shapes) if (ids.includes(s.id)) originals[s.id] = s.points;
    startDrag({ type: "move", start: toImage(e.clientX, e.clientY), originals, started: false });
  };

  /** The topmost shape under an image point (pins: within 12 screen px). */
  const shapeAt = (p: Point): Shape | undefined => {
    const shapes = propsRef.current.scene.shapes;
    for (let i = shapes.length - 1; i >= 0; i--) {
      const s = shapes[i];
      if (s.kind === "polygon" && pointInPolygon(p, s.points)) return s;
      if (s.kind === "pin" && screenDist(p, s.points[0]) < 12) return s;
    }
  };

  /**
   * Number tool: click a shape, or hold and sweep across several. Every few
   * pixels along the pointer's path is hit-tested, so a fast sweep can't skip
   * a narrow plot between two mouse events.
   */
  const startNumbering = (e: React.PointerEvent) => {
    const start = toImage(e.clientX, e.clientY);
    stroke.current = { seen: new WeakSet(), last: start };
    const visit = (p: Point) => {
      const shape = shapeAt(p);
      if (!shape || stroke.current!.seen.has(shape.points)) return;
      stroke.current!.seen.add(shape.points);
      propsRef.current.onNumber(shape);
    };
    visit(start);
    const onMove = (ev: PointerEvent) => {
      if (!stroke.current) return;
      const here = toImage(ev.clientX, ev.clientY);
      const from = stroke.current.last;
      const steps = Math.max(1, Math.ceil(screenDist(from, here) / 4));
      for (let i = 1; i <= steps; i++) {
        visit([from[0] + ((here[0] - from[0]) * i) / steps, from[1] + ((here[1] - from[1]) * i) / steps]);
      }
      stroke.current.last = here;
    };
    const onUp = () => {
      stroke.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const onVertexPointerDown = (e: React.PointerEvent) => {
    if (spaceDown.current || e.button !== 0) return;
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    const shapeId = el.dataset.shapeId!;
    const index = Number(el.dataset.index);
    const shape = scene.shapes.find((s) => s.id === shapeId)!;
    if (el.dataset.mid) {
      // Midpoint handle: insert a vertex there, then drag it.
      props.onCheckpoint();
      const a = shape.points[index];
      const b = shape.points[(index + 1) % shape.points.length];
      const points = shape.points.slice();
      points.splice(index + 1, 0, [round2((a[0] + b[0]) / 2), round2((a[1] + b[1]) / 2)]);
      props.onEditShapes({ [shapeId]: points });
      startDrag({ type: "vertex", shapeId, index: index + 1, started: true });
      return;
    }
    if (e.altKey) {
      const min = shape.kind === "polygon" ? 3 : shape.kind === "line" ? 2 : 1;
      if (shape.points.length <= min) return props.onStatus(`A ${shape.kind} needs at least ${min} points`, true);
      props.onCheckpoint();
      props.onEditShapes({ [shapeId]: shape.points.filter((_, i) => i !== index) });
      return;
    }
    startDrag({ type: "vertex", shapeId, index, started: false });
  };

  /** Placement handles. Every drag starts from the state at pointer-down, so
   *  the change is always relative to where the drag began. */
  const onPlacingHandleDown = (e: React.PointerEvent) => {
    if (!plotting || !mapper || e.button !== 0) return;
    e.stopPropagation();
    const mode = (e.currentTarget as HTMLElement).dataset.mode!;
    const c = REF_CORNERS.map((q) => mapper.toScene(q));
    const centre = mapper.toScene([50, 50]);
    const toPx = (q: Point): Point => [(q[0] * scene.width) / 100, (q[1] * scene.height) / 100];
    const angle = (a: Point, b: Point) => {
      const [ax, ay] = toPx(a);
      const [bx, by] = toPx(b);
      return (Math.atan2(by - ay, bx - ax) * 180) / Math.PI;
    };
    const mid = (a: Point, b: Point): Point => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    // Opposite corner / edge stays put while scaling or stretching.
    const anchors: Record<string, [Point, number]> = {
      tl: [c[2], 0],
      tr: [c[3], 0],
      br: [c[0], 0],
      bl: [c[1], 0],
      l: [mid(c[1], c[2]), angle(c[0], c[1])],
      r: [mid(c[0], c[3]), angle(c[0], c[1])],
      t: [mid(c[3], c[2]), angle(c[0], c[3])],
      b: [mid(c[0], c[1]), angle(c[0], c[3])],
      move: [centre, 0],
      rotate: [centre, 0],
    };
    const [baseAnchor, axis] = anchors[mode];
    const anchor = e.altKey && mode !== "rotate" && mode !== "move" ? centre : baseAnchor;
    props.onCheckpoint();
    startDrag({
      type: "placing",
      mode,
      start: toImage(e.clientX, e.clientY),
      startState: { transform: plotting.transform, points: plotting.points },
      anchor,
      axis,
    });
  };

  const onPointMarkerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    props.onCheckpoint();
    startDrag({ type: "point", index: Number((e.currentTarget as HTMLElement).dataset.index) });
  };

  const onBoxPointerDown = (e: React.PointerEvent) => {
    if (!align || e.button !== 0) return;
    e.stopPropagation();
    startDrag({
      type: "box",
      mode: (e.currentTarget as HTMLElement).dataset.mode!,
      startX: e.clientX,
      startY: e.clientY,
      startBox: align.box,
    });
  };

  const onCandidateClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    props.onToggleCandidate(Number((e.currentTarget as Element).getAttribute("data-index")));
  };

  // ---- Render ----
  const k = view.k;
  const shapesClickable = tool === "select" || tool === "number";
  const single = selectedIds.length === 1 ? scene.shapes.find((s) => s.id === selectedIds[0]) : undefined;
  const cursorClass = spaceHeld
    ? "cursor-grab"
    : tool === "select"
      ? "cursor-default"
      : tool === "number"
        ? "cursor-cell"
        : "cursor-crosshair";
  const counter = { transform: `translate(-50%, -50%) scale(${1 / k})` };
  const labelsOn = showLabels || tool === "number";

  return (
    <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-neutral-800">
      <div
        ref={containerRef}
        {...handlers}
        onPointerDown={onContainerPointerDown}
        onPointerMove={onPointerMove}
        onPointerLeave={() => {
          setCursor(null);
          props.cursor?.set(null);
        }}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        className={`absolute inset-0 touch-none select-none ${cursorClass} ${busy ? "cursor-wait" : ""}`}
      >
        <div className="absolute top-0 left-0 origin-top-left" style={{ width: fit.width, height: fit.height, transform }}>
          {(imageView !== "plotting" || !plotting) && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imageUrl(scene.image)} alt="" draggable={false} className="absolute inset-0 h-full w-full" />
          )}

          {/* Reference image, placed on the scene image by its fit */}
          {plotting && mapper && imageView !== "development" && (
            <ReferenceOverlay trace={plotting} mapper={mapper} sceneW={scene.width} sceneH={scene.height} opacity={imageView === "overlay" ? (plotting.opacity ?? 0.5) : 1} />
          )}

          {/* screen-sized, zoom cancelled: outline widths are true screen px (lib/use-pan-zoom.ts) */}
          <svg viewBox={overlay.viewBox} preserveAspectRatio="none" style={overlay.style}>
            {scene.shapes.map((shape) => {
              if (shape.kind === "pin") return null;
              const isSel = selectedIds.includes(shape.id);
              const color = colorOf(shape);
              const common = {
                "data-shape-id": shape.id,
                "data-nopan": shapesClickable ? "" : undefined,
                onPointerDown: shapesClickable ? onShapePointerDown : undefined,
                vectorEffect: "non-scaling-stroke" as const,
                strokeDasharray: shape.hidden ? "4 3" : shape.kind === "line" ? shape.style?.dash || undefined : undefined,
                style: {
                  pointerEvents: shapesClickable ? ("auto" as const) : ("none" as const),
                  cursor: tool === "select" ? "move" : undefined,
                  opacity: tool === "detect" && detection ? 0.35 : 1,
                },
              };
              return shape.kind === "line" ? (
                <polyline key={shape.id} points={toSvgPoints(shape.points)} fill="none" stroke={isSel ? "#0ea5e9" : color} strokeWidth={(shape.style?.strokeWidth ?? 3) * (shape.style?.scaleWithZoom ? k : 1) + (isSel ? 1 : 0)} {...common} />
              ) : (
                <polygon
                  key={shape.id}
                  points={toSvgPoints(shape.points)}
                  fill={color}
                  fillOpacity={isSel ? 0.5 : 0.3}
                  stroke={isSel ? "#0ea5e9" : color}
                  strokeWidth={isSel ? 2.5 : 1.25}
                  {...common}
                />
              );
            })}

            {/* Auto-detect / generated results (not yet added) */}
            {(tool === "detect" || detection?.meta) &&
              detection?.regions.map((points, i) => {
                const off = detection.excluded.has(i);
                const meta = detection.meta?.[i];
                if (meta?.kind === "pin") {
                  // a generated pin: a ring at the spot (the icon itself shows once added)
                  const [cx, cy] = points[0];
                  return (
                    <g key={i} data-index={i} data-nopan="" onClick={onCandidateClick} className="cursor-pointer">
                      <ellipse cx={cx} cy={cy} rx={1.2 / k} ry={(1.2 / k) * (scene.width / scene.height)} fill={off ? "#a3a3a3" : "#f59e0b"} fillOpacity={off ? 0.2 : 0.35} stroke={off ? "#a3a3a3" : "#b45309"} strokeWidth={2} vectorEffect="non-scaling-stroke" />
                      <title>{meta.label}</title>
                    </g>
                  );
                }
                if (meta?.kind === "line") {
                  // a generated route: drawn in its own colour and dash; grey + faint when skipped
                  return (
                    <g key={i} data-index={i} data-nopan="" onClick={onCandidateClick} className="cursor-pointer">
                      <polyline points={toSvgPoints(points)} fill="none" stroke="transparent" strokeWidth={14} vectorEffect="non-scaling-stroke" />
                      <polyline
                        points={toSvgPoints(points)}
                        fill="none"
                        stroke={off ? "#a3a3a3" : (meta.color ?? "#f59e0b")}
                        strokeOpacity={off ? 0.5 : 1}
                        strokeWidth={4}
                        strokeDasharray={meta.style?.dash || undefined}
                        strokeLinecap="round"
                        vectorEffect="non-scaling-stroke"
                      />
                      <title>{meta.label}</title>
                    </g>
                  );
                }
                return (
                  <polygon
                    key={i}
                    data-index={i}
                    data-nopan=""
                    onClick={onCandidateClick}
                    points={toSvgPoints(points)}
                    fill={off ? "#737373" : "#f59e0b"}
                    fillOpacity={off ? 0.15 : 0.45}
                    stroke={off ? "#a3a3a3" : "#b45309"}
                    strokeWidth={1.5}
                    strokeDasharray={off ? "3 3" : undefined}
                    vectorEffect="non-scaling-stroke"
                    className="cursor-pointer"
                  >
                    {detection.meta?.[i] && <title>{detection.meta[i].label}</title>}
                  </polygon>
                );
              })}

            {/* Shape being drawn */}
            {draft.length > 0 && (
              <polyline
                points={toSvgPoints(cursor ? [...draft, cursor.point] : draft)}
                fill={tool === "polygon" ? "#0ea5e9" : "none"}
                fillOpacity={0.15}
                stroke="#0ea5e9"
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
                pointerEvents="none"
              />
            )}
          </svg>

          {/* Detect limit + box-select rectangles */}
          {[tool === "detect" ? detectLimit : null, marquee].map(
            (r, i) =>
              r && (
                <div
                  key={i}
                  className={`pointer-events-none absolute border-dashed ${i === 0 ? "border-amber-400 bg-amber-300/5" : "border-sky-400 bg-sky-400/10"}`}
                  style={{ left: `${r.left}%`, top: `${r.top}%`, width: `${r.right - r.left}%`, height: `${r.bottom - r.top}%`, borderWidth: 2 / k }}
                />
              ),
          )}

          {/* Labels */}
          {labelsOn &&
            scene.shapes
              .filter((s) => s.kind !== "pin")
              .map((s) => {
                const [x, y] = centroid(s.points);
                return (
                  <div key={s.id} className="pointer-events-none absolute" style={{ left: `${x}%`, top: `${y}%` }}>
                    <div
                      className={`rounded px-1 text-[10px] whitespace-nowrap text-white ${tool === "number" ? "bg-violet-700/90" : "bg-black/60"}`}
                      style={counter}
                    >
                      {s.id}
                    </div>
                  </div>
                );
              })}

          {/* Pins */}
          {scene.shapes
            .filter((s) => s.kind === "pin")
            .map((s) => {
              const icon = iconOf(s);
              const sel = selectedIds.includes(s.id);
              return (
                <div key={s.id} className="absolute" style={{ left: `${s.points[0][0]}%`, top: `${s.points[0][1]}%`, pointerEvents: shapesClickable ? "auto" : "none" }}>
                  {icon ? (
                    <div
                      data-shape-id={s.id}
                      data-nopan=""
                      onPointerDown={shapesClickable ? onShapePointerDown : undefined}
                      className={`flex rounded-full ${sel ? "ring-2 ring-sky-400 ring-offset-1" : ""} ${tool === "select" ? "cursor-move" : ""}`}
                      style={counter}
                    >
                      <PinIcon icon={icon} color={colorOf(s)} size={28} title={s.label || s.id} className="pointer-events-none max-w-none" />
                    </div>
                  ) : (
                    <div
                      data-shape-id={s.id}
                      data-nopan=""
                      onPointerDown={shapesClickable ? onShapePointerDown : undefined}
                      className={`rounded-full border-2 px-1.5 text-[11px] whitespace-nowrap text-white ${sel ? "border-sky-400" : "border-white"} ${tool === "select" ? "cursor-move" : ""}`}
                      style={{ ...counter, background: colorOf(s) }}
                    >
                      {tool === "number" ? s.id : s.label || s.id}
                    </div>
                  )}
                </div>
              );
            })}

          {/* Vertex + midpoint handles (one shape selected) */}
          {tool === "select" && single && single.kind !== "pin" && (
            <>
              {single.points.map(([x, y], i) => {
                const next = single.points[(i + 1) % single.points.length];
                const showMid = single.kind === "polygon" || i < single.points.length - 1;
                return (
                  <div key={i}>
                    <div className="absolute" style={{ left: `${x}%`, top: `${y}%` }}>
                      <div
                        data-nopan=""
                        data-shape-id={single.id}
                        data-index={i}
                        onPointerDown={onVertexPointerDown}
                        className="h-3 w-3 cursor-pointer rounded-sm border-2 border-sky-500 bg-white"
                        style={counter}
                        title="Drag to move · Alt+click to delete"
                      />
                    </div>
                    {showMid && (
                      <div className="absolute" style={{ left: `${(x + next[0]) / 2}%`, top: `${(y + next[1]) / 2}%` }}>
                        <div
                          data-nopan=""
                          data-shape-id={single.id}
                          data-index={i}
                          data-mid="1"
                          onPointerDown={onVertexPointerDown}
                          className="h-2.5 w-2.5 cursor-copy rounded-full border border-sky-500 bg-sky-100/80"
                          style={counter}
                          title="Drag to add a vertex"
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}

          {/* Draft vertices + snap indicator */}
          {draft.map(([x, y], i) => (
            <div key={i} className="pointer-events-none absolute" style={{ left: `${x}%`, top: `${y}%` }}>
              <div className={`rounded-full border-2 border-sky-500 ${i === 0 ? "h-3.5 w-3.5 bg-sky-500" : "h-2.5 w-2.5 bg-white"}`} style={counter} />
            </div>
          ))}
          {cursor?.snapped && (
            <div className="pointer-events-none absolute" style={{ left: `${cursor.point[0]}%`, top: `${cursor.point[1]}%` }}>
              <div className="h-4 w-4 rounded-full border-2 border-amber-400" style={counter} />
            </div>
          )}

          {props.cursor && <CursorMarker store={props.cursor} showFor="reference" map={(p) => p} counter={counter} />}

          {/* SVG being aligned */}
          {align && <AlignBox align={align} zoom={k} onPointerDown={onBoxPointerDown} />}

          {/* Aligning the reference: outline, handles, matching points */}
          {aligning && plotting && mapper && (
            <PlacementHandles
              mapper={mapper}
              locked={!!plotting.locked}
              zoom={k}
              points={plotting.points ?? []}
              pending={aligning.pending}
              view={imageView}
              onHandleDown={onPlacingHandleDown}
              onPointDown={onPointMarkerDown}
            />
          )}
        </div>
      </div>

      {props.caption && (
        <div className="pointer-events-none absolute top-3 right-16 rounded bg-black/60 px-2 py-1 text-xs font-medium text-white">{props.caption}</div>
      )}

      {/* Zoom controls */}
      <div className={`absolute top-3 right-3 flex flex-col overflow-hidden ${SURFACE}`}>
        <button type="button" className={ICON_BUTTON} onClick={() => zoomAt(1.5)} aria-label="Zoom in">+</button>
        <button type="button" className={ICON_BUTTON} onClick={() => zoomAt(1 / 1.5)} aria-label="Zoom out">−</button>
        <button type="button" className={`${ICON_BUTTON} text-sm`} onClick={reset} aria-label="Fit">⤢</button>
      </div>

      {/* Status bar */}
      <div className="pointer-events-none absolute right-3 bottom-3 left-3 flex justify-between gap-3 text-[11px] text-white/80">
        <span className="rounded bg-black/50 px-2 py-1">{busy ? "Tracing…" : HINTS[tool]} · Space+drag / wheel = pan &amp; zoom</span>
        <span className="rounded bg-black/50 px-2 py-1 tabular-nums">
          {cursor ? `${round2(cursor.point[0])}%, ${round2(cursor.point[1])}%` : ""} · {Math.round(k * 100)}%
        </span>
      </div>
    </div>
  );
}

/** Corner drag: the opposite corner stays put; with Alt, the centre does. */
function resizeBox(mode: string, box: PlacementBox, dx: number, dy: number, fromCenter: boolean): PlacementBox {
  if (mode === "move") return { ...box, left: box.left + dx, top: box.top + dy };
  const isLeft = mode.includes("l");
  const isTop = mode.includes("t");
  const next = { ...box };
  if (fromCenter) {
    next.width = Math.max(MIN_BOX, box.width + 2 * (isLeft ? -dx : dx));
    next.height = Math.max(MIN_BOX, box.height + 2 * (isTop ? -dy : dy));
    next.left = box.left + (box.width - next.width) / 2;
    next.top = box.top + (box.height - next.height) / 2;
    return next;
  }
  next.width = Math.max(MIN_BOX, box.width + (isLeft ? -dx : dx));
  next.height = Math.max(MIN_BOX, box.height + (isTop ? -dy : dy));
  if (isLeft) next.left = box.left + box.width - next.width;
  if (isTop) next.top = box.top + box.height - next.height;
  return next;
}

const CORNERS = [
  { mode: "tl", className: "-top-1.5 -left-1.5 cursor-nwse-resize" },
  { mode: "tr", className: "-top-1.5 -right-1.5 cursor-nesw-resize" },
  { mode: "bl", className: "-bottom-1.5 -left-1.5 cursor-nesw-resize" },
  { mode: "br", className: "-bottom-1.5 -right-1.5 cursor-nwse-resize" },
];

/** The imported SVG drawn inside a draggable / resizable box. */
function AlignBox({ align, zoom, onPointerDown }: { align: AlignState; zoom: number; onPointerDown: (e: React.PointerEvent) => void }) {
  const { svg, box } = align;
  return (
    <div
      data-nopan=""
      data-mode="move"
      onPointerDown={onPointerDown}
      className="absolute cursor-move border-2 border-amber-400"
      style={{ left: `${box.left}%`, top: `${box.top}%`, width: `${box.width}%`, height: `${box.height}%`, borderWidth: 2 / zoom }}
    >
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full overflow-visible">
        {svg.shapes.map((s, i) => {
          // Draw in box-local percent so the preview matches what Apply produces.
          const pts = toSvgPoints(s.points.map((p) => applyBox(svg, { left: 0, top: 0, width: 100, height: 100 }, p)));
          return s.kind === "line" ? (
            <polyline key={i} points={pts} fill="none" stroke="#fbbf24" strokeWidth={3} vectorEffect="non-scaling-stroke" />
          ) : (
            <polygon key={i} points={pts} fill="#fde047" fillOpacity={0.45} stroke="#a16207" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          );
        })}
      </svg>
      {CORNERS.map((c) => (
        <div
          key={c.mode}
          data-nopan=""
          data-mode={c.mode}
          onPointerDown={onPointerDown}
          className={`absolute h-3 w-3 rounded-sm border border-white bg-amber-400 ${c.className}`}
          style={{ transform: `scale(${1 / zoom})` }}
        />
      ))}
    </div>
  );
}

/** The reference image drawn onto the scene image: an SVG transform for a
 *  straight (affine) fit, otherwise warped triangles on a canvas. */
function ReferenceOverlay({ trace, mapper, sceneW, sceneH, opacity }: { trace: TraceImage; mapper: Mapper; sceneW: number; sceneH: number; opacity: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const triangles = mapper.triangles;

  useEffect(() => {
    if (!triangles) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    // Canvas resolution: enough for editing, capped for speed.
    const w = Math.min(2400, sceneW);
    const h = Math.round((w * sceneH) / sceneW);
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, w, h);
      ctx.imageSmoothingQuality = "high";
      drawTriangles(
        ctx,
        img,
        img.naturalWidth,
        img.naturalHeight,
        triangles.map((t) => ({ src: t.from, dst: t.to.map(([x, y]) => [(x / 100) * w, (y / 100) * h]) as [Point, Point, Point] })),
      );
    };
    img.src = imageUrl(trace.image);
    return () => {
      cancelled = true;
    };
  }, [triangles, trace.image, sceneW, sceneH]);

  if (!triangles) {
    return (
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
        <image href={imageUrl(trace.image)} x={0} y={0} width={100} height={100} preserveAspectRatio="none" transform={svgMatrix(trace.transform)} opacity={opacity} />
      </svg>
    );
  }
  return <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" style={{ opacity }} />;
}

/** Outline of the reference with move (✥), rotate (⟳), corner (scale) and
 *  edge (stretch) handles, plus the numbered matching points. */
function PlacementHandles({
  mapper,
  locked,
  zoom,
  points,
  pending,
  view,
  onHandleDown,
  onPointDown,
}: {
  mapper: Mapper;
  locked: boolean;
  zoom: number;
  points: { from: Point; to: Point }[];
  pending?: Point;
  view: ImageView;
  onHandleDown: (e: React.PointerEvent) => void;
  onPointDown: (e: React.PointerEvent) => void;
}) {
  const c = REF_CORNERS.map((q) => mapper.toScene(q));
  const centre = mapper.toScene([50, 50]);
  const mid = (a: Point, b: Point): Point => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  // Rotate handle: just outside the top edge's middle, pointing away from the centre.
  const topMid = mid(c[0], c[1]);
  const rotateAt: Point = [topMid[0] + (topMid[0] - centre[0]) * 0.12, topMid[1] + (topMid[1] - centre[1]) * 0.12];
  const counter = { transform: `translate(-50%, -50%) scale(${1 / zoom})` };
  const handle = (mode: string, at: Point, label: string, cursor: string, title: string, round = false) => (
    <div key={mode} className="absolute" style={{ left: `${at[0]}%`, top: `${at[1]}%` }}>
      <div
        data-nopan=""
        data-mode={mode}
        onPointerDown={onHandleDown}
        title={title}
        className={`flex h-5 w-5 items-center justify-center border-2 border-white bg-fuchsia-600 text-[11px] text-white shadow ${round ? "rounded-full" : "rounded"} ${cursor}`}
        style={counter}
      >
        {label}
      </div>
    </div>
  );
  return (
    <>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
        <polygon points={c.map(([x, y]) => `${x},${y}`).join(" ")} fill="none" stroke="#c026d3" strokeWidth={2} strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />
        {!locked && <line x1={topMid[0]} y1={topMid[1]} x2={rotateAt[0]} y2={rotateAt[1]} stroke="#c026d3" strokeWidth={2} vectorEffect="non-scaling-stroke" />}
      </svg>
      {!locked && (
        <>
          {handle("tl", c[0], "", "cursor-nwse-resize", "Scale (Alt = from the centre)")}
          {handle("tr", c[1], "", "cursor-nesw-resize", "Scale (Alt = from the centre)")}
          {handle("br", c[2], "", "cursor-nwse-resize", "Scale (Alt = from the centre)")}
          {handle("bl", c[3], "", "cursor-nesw-resize", "Scale (Alt = from the centre)")}
          {handle("t", mid(c[0], c[1]), "", "cursor-ns-resize", "Stretch")}
          {handle("r", mid(c[1], c[2]), "", "cursor-ew-resize", "Stretch")}
          {handle("b", mid(c[2], c[3]), "", "cursor-ns-resize", "Stretch")}
          {handle("l", mid(c[3], c[0]), "", "cursor-ew-resize", "Stretch")}
          {handle("move", centre, "✥", "cursor-move", "Move")}
          {handle("rotate", rotateAt, "⟳", "cursor-grab", "Rotate (Shift = 15° steps)", true)}
        </>
      )}

      {points.map((pt, i) => (
        <div key={i}>
          {view !== "development" && (
            <div className="pointer-events-none absolute" style={{ left: `${mapper.toScene(pt.from)[0]}%`, top: `${mapper.toScene(pt.from)[1]}%` }}>
              <div className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-white bg-fuchsia-600 text-[10px] font-bold text-white" style={counter}>
                {i + 1}
              </div>
            </div>
          )}
          {view !== "plotting" && (
            <div className="absolute" style={{ left: `${pt.to[0]}%`, top: `${pt.to[1]}%` }}>
              <div
                data-nopan=""
                data-index={i}
                onPointerDown={onPointDown}
                title="Drag to adjust this matching point"
                className="flex h-5 w-5 cursor-move items-center justify-center rounded-full border-2 border-white bg-sky-600 text-[10px] font-bold text-white"
                style={counter}
              >
                {i + 1}
              </div>
            </div>
          )}
        </div>
      ))}
      {pending && view !== "plotting" && (
        <div className="pointer-events-none absolute" style={{ left: `${mapper.toScene(pending)[0]}%`, top: `${mapper.toScene(pending)[1]}%` }}>
          <div className="h-5 w-5 animate-pulse rounded-full border-2 border-dashed border-fuchsia-500" style={counter} />
        </div>
      )}
    </>
  );
}

/** Identity source: trace straight from the scene's own image. */
export const sceneSource = (scene: Scene): TraceSource => ({ image: scene.image, fromDisplay: (p) => p, toDisplay: (p) => p });

/** Source that reads the reference image and maps results onto the scene
 *  through its fit (affine, perspective or mesh). */
export function plottingSource(trace: TraceImage): TraceSource {
  const mapper = traceMapper(trace);
  return { image: trace.image, fromDisplay: mapper.toReference, toDisplay: mapper.toScene };
}
