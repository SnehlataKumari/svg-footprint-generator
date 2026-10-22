"use client";

import { centroid, toSvgPoints } from "@/lib/geometry";
import { PinIcon } from "../pin-icon";
import type { ResolvedStyle } from "@/lib/style";
import type { Shape } from "@/lib/types";

interface Props {
  shapes: Shape[];
  /** Final look of each shape (lib/style.ts resolveStyle). */
  styleOf: (shape: Shape) => ResolvedStyle;
  /** Current zoom — pins and labels are counter-scaled so they stay the same size. */
  zoom: number;
  /** The svg's viewBox + style from usePanZoom (zoom cancelled, so outline widths are true screen px). */
  overlay: { viewBox: string; style: React.CSSProperties };
  selectedId?: string;
  onActivate: (shape: Shape) => void;
  onHover: (shape: Shape | null, clientX: number, clientY: number) => void;
}

/**
 * Draws a scene's shapes over the image. Polygons/lines live in one
 * <svg viewBox="0 0 100 100"> stretched over the image (so percent points
 * map 1:1); pins and labels are HTML so they stay a fixed size on screen.
 *
 * Every clickable shape is a focusable button: Tab to it, Enter/Space opens it.
 */
export function ShapeLayer({ shapes, styleOf, zoom, overlay, selectedId, onActivate, onHover }: Props) {
  const drawn = shapes.map((shape) => ({ shape, style: styleOf(shape) })).filter(({ style }) => style.visible);

  const interactive = (shape: Shape) => ({
    "data-shape": shape.id,
    role: "button",
    tabIndex: 0,
    "aria-label": shape.label || shape.id,
    onClick: () => onActivate(shape),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onActivate(shape);
      }
    },
    onPointerMove: (e: React.PointerEvent) => onHover(shape, e.clientX, e.clientY),
    onPointerLeave: (e: React.PointerEvent) => onHover(null, e.clientX, e.clientY),
  });

  return (
    <>
      <svg viewBox={overlay.viewBox} preserveAspectRatio="none" style={overlay.style}>
        {drawn.map(({ shape, style }) => {
          if (shape.kind === "pin") return null;
          const selected = shape.id === selectedId;
          // Opacities go through CSS variables so globals.css can switch to
          // the hover value on :hover / :focus-visible.
          // A width that grows with zoom: the style's width is the one at zoom 1.
          const grow = style.scaleWithZoom ? zoom : 1;
          const vars = {
            "--fill-opacity": selected ? Math.max(style.hoverFillOpacity, style.fillOpacity) : style.fillOpacity,
            "--hover-fill-opacity": style.hoverFillOpacity,
            "--hover-fill": style.hoverFill,
            "--hover-stroke": style.hoverStroke,
            "--hover-stroke-width": style.hoverStrokeWidth * grow,
          } as React.CSSProperties;
          const stroke = {
            stroke: selected ? "#ffffff" : style.stroke,
            strokeWidth: (selected ? Math.max(2.5, style.strokeWidth) : style.strokeWidth) * grow,
            strokeOpacity: style.strokeOpacity,
            strokeDasharray: style.dash || undefined,
            vectorEffect: "non-scaling-stroke" as const,
          };
          return shape.kind === "line" ? (
            <polyline
              key={shape.id}
              points={toSvgPoints(shape.points)}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              {...stroke}
              stroke={selected ? "#ffffff" : style.stroke}
              className="shape cursor-pointer"
              {...interactive(shape)}
            />
          ) : (
            <polygon
              key={shape.id}
              points={toSvgPoints(shape.points)}
              fill={style.fill}
              style={vars}
              {...stroke}
              className="shape cursor-pointer"
              {...interactive(shape)}
            />
          );
        })}
      </svg>

      {/* Always-on labels (style.label = "always") */}
      {drawn
        .filter(({ shape, style }) => style.label === "always" && shape.kind !== "pin")
        .map(({ shape, style }) => {
          const [x, y] = centroid(shape.points);
          return (
            <div key={shape.id} className="pointer-events-none absolute" style={{ left: `${x}%`, top: `${y}%` }}>
              <div
                className="font-medium whitespace-nowrap [text-shadow:0_0_3px_rgba(0,0,0,0.8)]"
                style={{ transform: `translate(-50%, -50%) scale(${1 / zoom})`, color: style.labelColor, fontSize: style.labelSize }}
              >
                {shape.label || shape.id}
              </div>
            </div>
          );
        })}

      {drawn
        .filter(({ shape }) => shape.kind === "pin")
        .map(({ shape, style }) => {
          const [x, y] = centroid(shape.points);
          return (
            <div
              key={shape.id}
              className="absolute"
              style={{ left: `${x}%`, top: `${y}%`, transform: `scale(${1 / zoom})`, transformOrigin: "0 0" }}
            >
              {style.icon ? (
                // An icon sits centred on its spot; the name shows on hover (or always, with label: "always").
                <div className="shape flex -translate-x-1/2 -translate-y-1/2 cursor-pointer flex-col items-center rounded-full" {...interactive(shape)}>
                  <PinIcon icon={style.icon} color={style.fill} size={style.iconSize} className="drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]" />
                  {style.label === "always" && (
                    <span
                      className="pointer-events-none absolute top-full mt-0.5 font-medium whitespace-nowrap [text-shadow:0_0_3px_rgba(0,0,0,0.8)]"
                      style={{ color: style.labelColor, fontSize: style.labelSize }}
                    >
                      {shape.label || shape.id}
                    </span>
                  )}
                </div>
              ) : (
                <div className="shape -translate-x-1/2 -translate-y-full cursor-pointer" {...interactive(shape)}>
                  <div
                    className="flex items-center gap-1 rounded-full border-2 border-white px-2 py-0.5 font-medium whitespace-nowrap shadow-md"
                    style={{ background: style.fill, color: style.labelColor, fontSize: style.labelSize }}
                  >
                    {style.label === "none" ? "" : shape.label || shape.id}
                  </div>
                  <div className="mx-auto h-2 w-0.5 bg-white" />
                </div>
              )}
            </div>
          );
        })}
    </>
  );
}
