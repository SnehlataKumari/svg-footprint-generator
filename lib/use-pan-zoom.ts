"use client";

import gsap from "gsap";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Point } from "./types";

/**
 * Pan / zoom for one image, shared by the viewer and the editor.
 *
 * The view is stored as "which image point is at the centre of the screen"
 * (`cx`, `cy` in percent-of-image) plus a zoom factor `k` (1 = whole image
 * fits the container). That makes it independent of the container size, so a
 * window resize never needs special handling.
 *
 * Render: an element of size `fit.width` x `fit.height` with
 * `style={{ transform }}` (origin top-left) holding the <img>, and the shapes'
 * <svg {...overlay} preserveAspectRatio="none"> inside it.
 *
 * Why `overlay`: the zoom is a CSS scale, and outline widths
 * (vector-effect: non-scaling-stroke) ignore CSS scales in Chrome, so an svg
 * zoomed with the image draws a 1px outline k px wide. The overlay svg covers
 * just the visible part of the image, is exactly screen-sized and cancels the
 * zoom (scale 1/k), so outline widths are true screen pixels in every browser,
 * and it never grows huge at high zoom. Its viewBox is still percent-of-image.
 */

export interface View {
  cx: number;
  cy: number;
  k: number;
}

interface Options {
  /** Image width / height. */
  aspect: number;
  maxZoom?: number;
  /** Return false to let a pointer-down through without panning (e.g. the
   *  editor dragging a vertex). Default: always pan. */
  canPan?: (e: PointerEvent | React.PointerEvent) => boolean;
}

const HOME: View = { cx: 50, cy: 50, k: 1 };
/** Movement (px) after which a press counts as a drag, not a click. */
const DRAG_THRESHOLD = 4;

export function usePanZoom({ aspect, maxZoom = 10, canPan }: Options) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [view, setViewState] = useState<View>(HOME);
  const viewRef = useRef(view);
  const tween = useRef<gsap.core.Tween | null>(null);

  // Track the container size.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The image's size at k = 1: "contain" inside the container.
  const fit = useMemo(() => {
    if (!size.width || !size.height) return { width: 0, height: 0 };
    return size.width / size.height > aspect
      ? { width: size.height * aspect, height: size.height }
      : { width: size.width, height: size.width / aspect };
  }, [size, aspect]);

  /** Keep the image covering the screen when zoomed, centred when it's smaller. */
  const clamp = useCallback(
    (v: View): View => {
      const k = Math.min(maxZoom, Math.max(1, v.k));
      const axis = (c: number, screen: number, image: number) => {
        const scaled = image * k;
        if (scaled <= screen || !scaled) return 50;
        const half = ((screen / 2) / scaled) * 100;
        return Math.min(100 - half, Math.max(half, c));
      };
      return { k, cx: axis(v.cx, size.width, fit.width), cy: axis(v.cy, size.height, fit.height) };
    },
    [fit, size, maxZoom],
  );

  const setView = useCallback(
    (next: View | ((v: View) => View)) => {
      tween.current?.kill();
      const resolved = clamp(typeof next === "function" ? next(viewRef.current) : next);
      viewRef.current = resolved;
      setViewState(resolved);
    },
    [clamp],
  );

  /** Tween to a view (GSAP). Resolves when done. No clamping on the way, so
   *  a "zoom into this hotspot" can briefly go past the limits. */
  const animateTo = useCallback((target: Partial<View>, duration = 0.6): Promise<void> => {
    tween.current?.kill();
    const state = { ...viewRef.current };
    return new Promise((resolve) => {
      tween.current = gsap.to(state, {
        ...target,
        duration,
        ease: "power2.inOut",
        onUpdate: () => {
          viewRef.current = { ...state };
          setViewState({ ...state });
        },
        onComplete: resolve,
        onInterrupt: resolve,
      });
    });
  }, []);

  const transform = useMemo(() => {
    const tx = size.width / 2 - (view.cx / 100) * fit.width * view.k;
    const ty = size.height / 2 - (view.cy / 100) * fit.height * view.k;
    return `translate(${tx}px, ${ty}px) scale(${view.k})`;
  }, [view, size, fit]);

  /** Props for the shapes' <svg> inside the zoomed element (see top). */
  const overlay = useMemo(() => {
    const w = (size.width / (fit.width * view.k || 1)) * 100, h = (size.height / (fit.height * view.k || 1)) * 100;
    const x0 = view.cx - w / 2, y0 = view.cy - h / 2;
    return {
      viewBox: `${x0} ${y0} ${w || 100} ${h || 100}`,
      style: {
        position: "absolute" as const,
        left: (x0 / 100) * fit.width,
        top: (y0 / 100) * fit.height,
        width: size.width,
        height: size.height,
        transform: `scale(${1 / view.k})`,
        transformOrigin: "0 0",
        overflow: "visible" as const,
      },
    };
  }, [view, size, fit]);

  /** Screen position -> percent-of-image. */
  const toImage = useCallback(
    (clientX: number, clientY: number): Point => {
      const rect = containerRef.current!.getBoundingClientRect();
      const v = viewRef.current;
      return [
        v.cx + ((clientX - rect.left - size.width / 2) / (fit.width * v.k)) * 100,
        v.cy + ((clientY - rect.top - size.height / 2) / (fit.height * v.k)) * 100,
      ];
    },
    [size, fit],
  );

  /** Pixels on screen per 1% of image width / height at the current zoom. */
  const pxPerPct = useMemo(
    () => ({ x: (fit.width * view.k) / 100, y: (fit.height * view.k) / 100 }),
    [fit, view.k],
  );

  /** Zoom by `factor`, keeping the point under (clientX, clientY) still. */
  const zoomAt = useCallback(
    (factor: number, clientX?: number, clientY?: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = clientX ?? rect.left + rect.width / 2;
      const y = clientY ?? rect.top + rect.height / 2;
      const [px, py] = toImage(x, y);
      setView((v) => {
        const k = Math.min(maxZoom, Math.max(1, v.k * factor));
        return {
          k,
          cx: px - ((x - rect.left - size.width / 2) / (fit.width * k)) * 100,
          cy: py - ((y - rect.top - size.height / 2) / (fit.height * k)) * 100,
        };
      });
    },
    [toImage, setView, maxZoom, size, fit],
  );

  const panBy = useCallback(
    (dxPx: number, dyPx: number) =>
      setView((v) => ({
        ...v,
        cx: v.cx - (dxPx / (fit.width * v.k)) * 100,
        cy: v.cy - (dyPx / (fit.height * v.k)) * 100,
      })),
    [setView, fit],
  );

  const reset = useCallback(() => setView(HOME), [setView]);

  // Re-clamp when the container changes size.
  useEffect(() => {
    setView((v) => v);
  }, [setView]);

  // ---- Pointer gestures: drag to pan, two fingers to pinch ----
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ panning: boolean; moved: boolean; pinchDist: number }>({
    panning: false,
    moved: false,
    pinchDist: 0,
  });
  const dragged = useRef(false);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button === 2) return;
      if (pointers.current.size === 0) dragged.current = false;
      const panning = e.button === 1 || !canPan || canPan(e);
      if (!panning) return;
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      gesture.current = { panning: true, moved: false, pinchDist: 0 };
      // Pointer capture waits until the press turns into a drag: capturing
      // now would retarget the click away from the hotspot under the finger.
    },
    [canPan],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const prev = pointers.current.get(e.pointerId);
      if (!prev || !gesture.current.panning) return;
      const g = gesture.current;
      if (pointers.current.size === 2) {
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const [a, b] = [...pointers.current.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (g.pinchDist) zoomAt(dist / g.pinchDist, (a.x + b.x) / 2, (a.y + b.y) / 2);
        g.pinchDist = dist;
        g.moved = dragged.current = true;
        return;
      }
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      if (!g.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      if (!g.moved) (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      g.moved = dragged.current = true;
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      panBy(dx, dy);
    },
    [panBy, zoomAt],
  );

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    gesture.current.pinchDist = 0;
    if (pointers.current.size === 0) gesture.current.panning = false;
  }, []);

  /** True if the press that produced this click was actually a drag/pinch —
   *  check it in click handlers so panning never "clicks" a hotspot. */
  const wasDrag = useCallback(() => dragged.current, []);

  // Wheel: mouse wheel / trackpad pinch (ctrlKey) zoom, two-finger scroll pans.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const isMouseWheel = e.deltaMode !== 0 || (e.deltaX === 0 && Math.abs(e.deltaY) >= 50);
      if (e.ctrlKey || e.metaKey || isMouseWheel) {
        zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002)), e.clientX, e.clientY);
      } else {
        panBy(-e.deltaX, -e.deltaY);
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt, panBy]);

  return {
    containerRef,
    view,
    fit,
    size,
    transform,
    overlay,
    pxPerPct,
    setView,
    animateTo,
    zoomAt,
    panBy,
    reset,
    toImage,
    wasDrag,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp },
  };
}
