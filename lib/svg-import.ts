import type { Point, ShapeKind } from "./types";

/**
 * Reads an SVG exported from Figma / Illustrator / Inkscape (e.g. plots traced
 * by a designer) into raw shapes in the SVG's own coordinates. The editor then
 * lets you drag/resize the whole set over the scene image ("Align SVG") and
 * converts it into percent-of-image points.
 *
 * Every <path>/<polygon>/<rect> becomes a polygon, every <polyline>/<line> a
 * line. Curves are reduced to their end points (fine for straight-edged
 * plots). Element `transform`s are ignored — flatten them in the design tool
 * before exporting ("Outline stroke" / "Flatten" / "Object to path").
 */

export interface ImportedSvg {
  viewX: number;
  viewY: number;
  viewW: number;
  viewH: number;
  shapes: { kind: ShapeKind; points: Point[]; id?: string }[];
}

/** Where the SVG sits over the image, in percent-of-image. */
export interface PlacementBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Number of parameters per path command. */
const PATH_PARAMS: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7 };
const NUMBER = /[-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/gi;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** The vertices of a path's `d`. A path with several sub-paths (M…Z M…Z)
 *  returns one ring per sub-path. */
function pathRings(d: string): { points: Point[]; closed: boolean }[] {
  const tokens = d.match(/[a-df-z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/gi) ?? [];
  const rings: { points: Point[]; closed: boolean }[] = [];
  let current: Point[] = [];
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  let cmd = "";
  let i = 0;
  const flush = (closed: boolean) => {
    if (current.length > 1) rings.push({ points: current, closed });
    current = [];
  };
  while (i < tokens.length) {
    if (/[a-z]/i.test(tokens[i])) {
      cmd = tokens[i++];
      if (cmd.toLowerCase() === "z") {
        x = startX;
        y = startY;
        flush(true);
      }
      continue;
    }
    const lower = cmd.toLowerCase();
    const n = PATH_PARAMS[lower];
    if (!n) {
      i++;
      continue;
    }
    const args = tokens.slice(i, i + n).map(Number);
    if (args.length < n || args.some(Number.isNaN)) break;
    i += n;
    const rel = cmd === lower;
    if (lower === "m") flush(false);
    if (lower === "h") x = rel ? x + args[0] : args[0];
    else if (lower === "v") y = rel ? y + args[0] : args[0];
    else {
      x = rel ? x + args[n - 2] : args[n - 2];
      y = rel ? y + args[n - 1] : args[n - 1];
    }
    if (lower === "m") {
      startX = x;
      startY = y;
      cmd = rel ? "l" : "L"; // extra pairs after a moveto are linetos
    }
    current.push([round3(x), round3(y)]);
  }
  flush(false);
  // A closing vertex repeating the first adds nothing.
  for (const ring of rings) {
    const [f, l] = [ring.points[0], ring.points[ring.points.length - 1]];
    if (ring.points.length > 2 && f[0] === l[0] && f[1] === l[1]) {
      ring.points.pop();
      ring.closed = true;
    }
  }
  return rings;
}

function numberPairs(list: string): Point[] {
  const nums = (list.match(NUMBER) ?? []).map(Number);
  const out: Point[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) out.push([nums[i], nums[i + 1]]);
  return out;
}

const num = (el: Element, name: string) => parseFloat(el.getAttribute(name) ?? "0") || 0;

export function parseSvg(markup: string): ImportedSvg | null {
  const doc = new DOMParser().parseFromString(markup, "image/svg+xml");
  const svg = doc.querySelector("svg");
  if (!svg || doc.querySelector("parsererror")) return null;

  const viewBox = (svg.getAttribute("viewBox") ?? "").trim().split(/[\s,]+/).map(Number);
  const [viewX, viewY, viewW, viewH] =
    viewBox.length === 4 && viewBox.every(Number.isFinite)
      ? viewBox
      : [0, 0, num(svg, "width"), num(svg, "height")];
  if (!(viewW > 0 && viewH > 0)) return null;

  const shapes: ImportedSvg["shapes"] = [];
  for (const el of svg.querySelectorAll("path, polygon, polyline, rect, line")) {
    if (el.closest("defs, clipPath, mask, symbol, pattern")) continue;
    const id = el.getAttribute("id") ?? undefined;
    const tag = el.tagName.toLowerCase();
    if (tag === "path") {
      for (const ring of pathRings(el.getAttribute("d") ?? "")) {
        // An unclosed path with no fill is a line (e.g. a road centreline).
        const fill = el.getAttribute("fill");
        const isLine = !ring.closed && (fill === "none" || ring.points.length === 2);
        shapes.push({ kind: isLine ? "line" : "polygon", points: ring.points, id });
      }
    } else if (tag === "rect") {
      const [x, y, w, h] = [num(el, "x"), num(el, "y"), num(el, "width"), num(el, "height")];
      shapes.push({ kind: "polygon", points: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], id });
    } else if (tag === "line") {
      shapes.push({ kind: "line", points: [[num(el, "x1"), num(el, "y1")], [num(el, "x2"), num(el, "y2")]], id });
    } else {
      const points = numberPairs(el.getAttribute("points") ?? "");
      if (points.length > 1) shapes.push({ kind: tag === "polyline" ? "line" : "polygon", points, id });
    }
  }
  if (shapes.length === 0) return null;
  return { viewX, viewY, viewW, viewH, shapes };
}

/** SVG coordinates -> percent-of-image, given where the box was placed. */
export function applyBox(svg: ImportedSvg, box: PlacementBox, [x, y]: Point): Point {
  return [
    Math.round((box.left + ((x - svg.viewX) / svg.viewW) * box.width) * 1000) / 1000,
    Math.round((box.top + ((y - svg.viewY) / svg.viewH) * box.height) * 1000) / 1000,
  ];
}
