import { applyAffine, invertAffine } from "./affine";
import type { Affine, MatchPoint, Point, TraceImage, WarpKind } from "./types";

/**
 * Mapping between the reference image and the scene image, whatever the fit:
 *
 *   affine      one straight transform (move / scale / rotate / stretch)
 *   perspective a homography from 4+ matching points — a different camera angle
 *   mesh        the matching points are triangulated; each triangle has its
 *               own straight transform, so every point lands exactly and the
 *               image bends smoothly in between. For references that are not
 *               the same picture (a plan vs a render, a different render…).
 *
 * Everything that needs to go between the two images — drawing the reference
 * on top, auto-detect results, clicks while aligning, the compare mode — goes
 * through a Mapper, so all three fits behave the same everywhere.
 */

export type Tri = { from: [Point, Point, Point]; to: [Point, Point, Point] };

export interface Mapper {
  /** The fit actually in use (falls back to affine without enough points). */
  kind: WarpKind;
  /** Reference % -> scene %. */
  toScene: (p: Point) => Point;
  /** Scene % -> reference %. */
  toReference: (p: Point) => Point;
  /** For drawing a non-affine fit: small triangles (reference % -> scene %). */
  triangles: Tri[] | null;
}

/** Matching points each fit needs. */
export const MIN_POINTS: Record<WarpKind, number> = { affine: 3, perspective: 4, mesh: 3 };

export function traceMapper(trace: Pick<TraceImage, "transform" | "warp" | "points">): Mapper {
  const kind = trace.warp ?? "affine";
  const points = trace.points ?? [];
  if (kind === "perspective" && points.length >= MIN_POINTS.perspective) {
    const h = fitHomography(points);
    if (h) return homographyMapper(h);
  }
  if (kind === "mesh" && points.length >= MIN_POINTS.mesh) return meshMapper(points, trace.transform);
  return affineMapper(trace.transform);
}

/** Average distance (scene %) between where the fit puts each point and where
 *  it was clicked. 0 for the mesh, which passes through every point. */
export function mapperError(mapper: Mapper, points: MatchPoint[]) {
  if (!points.length) return 0;
  return (
    points.reduce((sum, { from, to }) => {
      const [x, y] = mapper.toScene(from);
      return sum + Math.hypot(x - to[0], y - to[1]);
    }, 0) / points.length
  );
}

// ---- affine ---------------------------------------------------------------

function affineMapper(m: Affine): Mapper {
  const inverse = invertAffine(m);
  return { kind: "affine", toScene: (p) => applyAffine(m, p), toReference: (p) => applyAffine(inverse, p), triangles: null };
}

// ---- perspective (homography) ----------------------------------------------

type H = number[]; // 3x3, row-major

const applyH = (h: H, [x, y]: Point): Point => {
  const w = h[6] * x + h[7] * y + h[8];
  return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w];
};

function invertH(h: H): H {
  const [a, b, c, d, e, f, g, i, k] = h;
  const A = e * k - f * i;
  const B = -(d * k - f * g);
  const C = d * i - e * g;
  const det = a * A + b * B + c * C;
  return [A, -(b * k - c * i), b * f - c * e, B, a * k - c * g, -(a * f - c * d), C, -(a * i - b * g), a * e - b * d].map((v) => v / det);
}

/** Least-squares homography (normalised DLT, h33 = 1) from 4+ points. */
export function fitHomography(points: MatchPoint[]): H | null {
  if (points.length < 4) return null;
  // Normalise both point sets (centre 0, mean distance √2) for stability.
  const norm = (pts: Point[]) => {
    const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    const d = pts.reduce((s, p) => s + Math.hypot(p[0] - cx, p[1] - cy), 0) / pts.length || 1;
    const k = Math.SQRT2 / d;
    return { k, cx, cy, apply: ([x, y]: Point): Point => [(x - cx) * k, (y - cy) * k] };
  };
  const nf = norm(points.map((p) => p.from));
  const nt = norm(points.map((p) => p.to));
  const ata = Array.from({ length: 8 }, () => new Array(8).fill(0));
  const atb = new Array(8).fill(0);
  const add = (row: number[], b: number) => {
    for (let i = 0; i < 8; i++) {
      atb[i] += row[i] * b;
      for (let j = 0; j < 8; j++) ata[i][j] += row[i] * row[j];
    }
  };
  for (const { from, to } of points) {
    const [x, y] = nf.apply(from);
    const [X, Y] = nt.apply(to);
    add([x, y, 1, 0, 0, 0, -X * x, -X * y], X);
    add([0, 0, 0, x, y, 1, -Y * x, -Y * y], Y);
  }
  const sol = solve(ata, atb);
  if (!sol) return null;
  const hn = [...sol, 1];
  // H = Tto⁻¹ · Hn · Tfrom
  const tFrom = [nf.k, 0, -nf.k * nf.cx, 0, nf.k, -nf.k * nf.cy, 0, 0, 1];
  const tToInv = [1 / nt.k, 0, nt.cx, 0, 1 / nt.k, nt.cy, 0, 0, 1];
  const h = mul3(tToInv, mul3(hn, tFrom));
  return h.map((v) => v / h[8]);
}

function homographyMapper(h: H): Mapper {
  const inverse = invertH(h);
  // Drawn as a fine grid of triangles (canvas can't draw perspective directly).
  const n = 24;
  const triangles: Tri[] = [];
  const at = (i: number, j: number): Point => [(i / n) * 100, (j / n) * 100];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const [p00, p10, p01, p11] = [at(i, j), at(i + 1, j), at(i, j + 1), at(i + 1, j + 1)];
      triangles.push(tri(p00, p10, p11, (p) => applyH(h, p)), tri(p00, p11, p01, (p) => applyH(h, p)));
    }
  }
  return { kind: "perspective", toScene: (p) => applyH(h, p), toReference: (p) => applyH(inverse, p), triangles };
}

// ---- mesh (piecewise affine over a triangulation) ---------------------------

function meshMapper(points: MatchPoint[], overall: Affine): Mapper {
  // The image corners (a bit beyond, so edges bend smoothly too) follow the
  // overall placement; the user's points are exact.
  const pairs: MatchPoint[] = [...points];
  for (const corner of [[-25, -25], [125, -25], [125, 125], [-25, 125]] as Point[]) {
    if (pairs.every((p) => Math.hypot(p.from[0] - corner[0], p.from[1] - corner[1]) > 1)) {
      pairs.push({ from: corner, to: applyAffine(overall, corner) });
    }
  }
  const triangles: Tri[] = delaunay(pairs.map((p) => p.from)).map(([a, b, c]) => ({
    from: [pairs[a].from, pairs[b].from, pairs[c].from],
    to: [pairs[a].to, pairs[b].to, pairs[c].to],
  }));
  const forward = triangles.map((t) => ({ t, m: affineFrom3(t.from, t.to) }));
  const backward = triangles.map((t) => ({ t, m: affineFrom3(t.to, t.from) }));
  const fallback = affineMapper(overall);
  return {
    kind: "mesh",
    toScene: (p) => {
      const hit = forward.find(({ t }) => inTriangle(p, t.from));
      return hit ? applyAffine(hit.m, p) : fallback.toScene(p);
    },
    toReference: (p) => {
      const hit = backward.find(({ t }) => inTriangle(p, t.to));
      return hit ? applyAffine(hit.m, p) : fallback.toReference(p);
    },
    triangles,
  };
}

/** Bowyer–Watson Delaunay triangulation; returns index triples. */
function delaunay(pts: Point[]): [number, number, number][] {
  const n = pts.length;
  const all: Point[] = [...pts, [-1e5, -1e5], [1e5, -1e5], [0, 1e5]];
  type T = { v: [number, number, number]; cx: number; cy: number; r2: number };
  const circum = (v: [number, number, number]): T => {
    const [[ax, ay], [bx, by], [cx, cy]] = v.map((i) => all[i]);
    const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by)) || 1e-12;
    const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
    const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
    return { v, cx: ux, cy: uy, r2: (ax - ux) ** 2 + (ay - uy) ** 2 };
  };
  let tris: T[] = [circum([n, n + 1, n + 2])];
  for (let i = 0; i < n; i++) {
    const [px, py] = all[i];
    const bad = tris.filter((t) => (px - t.cx) ** 2 + (py - t.cy) ** 2 < t.r2);
    const edges: [number, number][] = [];
    for (const t of bad) {
      for (const [a, b] of [[t.v[0], t.v[1]], [t.v[1], t.v[2]], [t.v[2], t.v[0]]] as [number, number][]) {
        const shared = bad.some((o) => o !== t && o.v.includes(a) && o.v.includes(b));
        if (!shared) edges.push([a, b]);
      }
    }
    tris = tris.filter((t) => !bad.includes(t));
    for (const [a, b] of edges) tris.push(circum([a, b, i]));
  }
  return tris.filter((t) => t.v.every((i) => i < n)).map((t) => t.v);
}

// ---- small helpers ----------------------------------------------------------

function tri(a: Point, b: Point, c: Point, f: (p: Point) => Point): Tri {
  return { from: [a, b, c], to: [f(a), f(b), f(c)] };
}

/** The affine taking triangle `src` exactly onto triangle `dst`. */
export function affineFrom3(src: [Point, Point, Point], dst: [Point, Point, Point]): Affine {
  const [[x1, y1], [x2, y2], [x3, y3]] = src;
  const [[u1, v1], [u2, v2], [u3, v3]] = dst;
  const det = x1 * (y2 - y3) + x2 * (y3 - y1) + x3 * (y1 - y2) || 1e-12;
  const a = (u1 * (y2 - y3) + u2 * (y3 - y1) + u3 * (y1 - y2)) / det;
  const b = (u1 * (x3 - x2) + u2 * (x1 - x3) + u3 * (x2 - x1)) / det;
  const c = (u1 * (x2 * y3 - x3 * y2) + u2 * (x3 * y1 - x1 * y3) + u3 * (x1 * y2 - x2 * y1)) / det;
  const d = (v1 * (y2 - y3) + v2 * (y3 - y1) + v3 * (y1 - y2)) / det;
  const e = (v1 * (x3 - x2) + v2 * (x1 - x3) + v3 * (x2 - x1)) / det;
  const f = (v1 * (x2 * y3 - x3 * y2) + v2 * (x3 * y1 - x1 * y3) + v3 * (x1 * y2 - x2 * y1)) / det;
  return [a, b, c, d, e, f];
}

function inTriangle([px, py]: Point, [[ax, ay], [bx, by], [cx, cy]]: [Point, Point, Point]) {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

function mul3(a: number[], b: number[]) {
  const out = new Array(9).fill(0);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) out[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c];
  return out;
}

/** Gaussian elimination with partial pivoting. */
function solve(m: number[][], v: number[]): number[] | null {
  const n = v.length;
  const a = m.map((row, i) => [...row, v[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
    if (Math.abs(a[pivot][col]) < 1e-12) return null;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = a[r][col] / a[col][col];
      for (let c = col; c <= n; c++) a[r][c] -= f * a[col][c];
    }
  }
  return a.map((row, i) => row[n] / row[i]);
}

/**
 * Draws `img` warped by `tris` onto a canvas: each triangle's `src` corners
 * are percent of the image, `dst` corners are canvas pixels. Triangles are
 * grown by half a pixel so no hairline seams show between them.
 */
export function drawTriangles(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  imgW: number,
  imgH: number,
  tris: { src: [Point, Point, Point]; dst: [Point, Point, Point] }[],
) {
  for (const { src, dst } of tris) {
    const srcPx = src.map(([x, y]) => [(x / 100) * imgW, (y / 100) * imgH] as Point) as [Point, Point, Point];
    const [a, b, c, d, e, f] = affineFrom3(srcPx, dst);
    const cx = (dst[0][0] + dst[1][0] + dst[2][0]) / 3;
    const cy = (dst[0][1] + dst[1][1] + dst[2][1]) / 3;
    ctx.save();
    ctx.beginPath();
    dst.forEach(([x, y], i) => {
      const len = Math.hypot(x - cx, y - cy) || 1;
      const gx = x + ((x - cx) / len) * 0.6;
      const gy = y + ((y - cy) / len) * 0.6;
      if (i === 0) ctx.moveTo(gx, gy);
      else ctx.lineTo(gx, gy);
    });
    ctx.closePath();
    ctx.clip();
    ctx.setTransform(a, d, b, e, c, f);
    ctx.drawImage(img, 0, 0);
    ctx.restore();
  }
}
