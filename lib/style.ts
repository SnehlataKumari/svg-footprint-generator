import type { PlotStyle, Project, Scene, Shape } from "./types";

/** Every style field filled in, plus the pin icon (shape's, else its category's; "" = none). */
export type ResolvedStyle = Required<PlotStyle> & { icon: string };

const NEUTRAL = "#64748b";

/** Built-in look when nothing else is set. Lines and pins differ a little. */
const BASE: Omit<ResolvedStyle, "fill" | "stroke" | "hoverFill" | "hoverStroke" | "hoverStrokeWidth" | "icon"> = {
  fillOpacity: 0.35,
  hoverFillOpacity: 0.6,
  strokeWidth: 1.25,
  strokeOpacity: 1,
  scaleWithZoom: false,
  dash: "",
  label: "hover",
  labelColor: "#ffffff",
  labelSize: 12,
  iconSize: 28,
  visible: true,
};
const LINE_BASE: Partial<PlotStyle> = { strokeWidth: 4 };

/** Drops undefined values so they don't overwrite earlier layers. */
const defined = (style?: PlotStyle): PlotStyle =>
  Object.fromEntries(Object.entries(style ?? {}).filter(([, v]) => v !== undefined && v !== null));

/**
 * The final style of one shape:
 *   built-in default < project.style < scene.style < category.style < shape.style
 * `fill` falls back to shape.color, then the category colour; `stroke` to the fill.
 */
export function resolveStyle(project: Pick<Project, "style" | "categories">, scene: Pick<Scene, "style"> | undefined, shape: Shape): ResolvedStyle {
  const category = project.categories.find((c) => c.id === shape.category);
  const merged: PlotStyle = {
    ...BASE,
    ...(shape.kind === "line" ? LINE_BASE : {}),
    ...defined(project.style),
    ...defined(scene?.style),
    ...defined(category?.style),
    ...defined(shape.style),
  };
  const fill = shape.style?.fill ?? category?.style?.fill ?? shape.color ?? category?.color ?? merged.fill ?? NEUTRAL;
  const stroke = merged.stroke ?? fill;
  const strokeWidth = merged.strokeWidth ?? 1.25;
  return {
    ...(merged as Required<PlotStyle>),
    icon: shape.icon ?? category?.icon ?? "",
    fill,
    stroke,
    hoverFill: merged.hoverFill ?? fill,
    hoverStroke: merged.hoverStroke ?? stroke,
    // Plots hidden until hover still get an outline on hover.
    hoverStrokeWidth: merged.hoverStrokeWidth ?? (strokeWidth > 0 ? strokeWidth : 2),
  };
}

/** Legend swatch colour of a category (its style's fill wins over `color`). */
export const categoryColor = (project: Pick<Project, "style">, category: { color: string; style?: PlotStyle }) =>
  category.style?.fill ?? category.color ?? project.style?.fill ?? NEUTRAL;
