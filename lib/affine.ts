import type { Affine, Point } from "./types";

/**
 * 2-D affine maps between the plotting image and the development image (both
 * in percent-of-image). An affine handles move, scale (separately in x and
 * y), rotation and skew — everything except perspective, which is all two
 * flat exports of the same plan ever differ by.
 */

export const IDENTITY: Affine = [1, 0, 0, 0, 1, 0];

export const applyAffine = ([a, b, c, d, e, f]: Affine, [x, y]: Point): Point => [a * x + b * y + c, d * x + e * y + f];

export function invertAffine([a, b, c, d, e, f]: Affine): Affine {
  const det = a * e - b * d;
  if (Math.abs(det) < 1e-12) return IDENTITY;
  return [e / det, -b / det, (b * f - c * e) / det, -d / det, a / det, (c * d - a * f) / det];
}

/** The same map in SVG's `matrix(…)` argument order. */
export const svgMatrix = ([a, b, c, d, e, f]: Affine) => `matrix(${a} ${d} ${b} ${e} ${c} ${f})`;

/** Move by (dx, dy) in development-image percent. */
export const translateAffine = ([a, b, c, d, e, f]: Affine, dx: number, dy: number): Affine => [a, b, c + dx, d, e, f + dy];

/** Scale by (sx, sy) about the development-image point (px, py). */
export const scaleAffine = ([a, b, c, d, e, f]: Affine, sx: number, sy: number, px: number, py: number): Affine => [
  a * sx,
  b * sx,
  px + (c - px) * sx,
  d * sy,
  e * sy,
  py + (f - py) * sy,
];

/** Where the plotting image's corners land on the development image. */
export function affineBounds(m: Affine) {
  const corners = ([[0, 0], [100, 0], [100, 100], [0, 100]] as Point[]).map((p) => applyAffine(m, p));
  const xs = corners.map((p) => p[0]);
  const ys = corners.map((p) => p[1]);
  return { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
}

/**
 * Least-squares affine from matching point pairs (plotting point -> the same
 * spot on the development image). Needs at least 3 pairs, not all on one line;
 * more pairs, spread far apart, average out click error. Returns null if the
 * pairs can't determine a map.
 */
export function fitAffine(pairs: { from: Point; to: Point }[]): Affine | null {
  if (pairs.length < 3) return null;
  // Normal equations: (AᵀA) p = Aᵀb with rows A = [x y 1].
  const ata = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const atX = [0, 0, 0];
  const atY = [0, 0, 0];
  for (const { from, to } of pairs) {
    const row = [from[0], from[1], 1];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) ata[i][j] += row[i] * row[j];
      atX[i] += row[i] * to[0];
      atY[i] += row[i] * to[1];
    }
  }
  const abc = solve3(ata, atX);
  const def = solve3(ata, atY);
  return abc && def ? [abc[0], abc[1], abc[2], def[0], def[1], def[2]] : null;
}

/** Cramer's rule for a 3x3 system. */
function solve3(m: number[][], v: number[]): number[] | null {
  const det = (x: number[][]) =>
    x[0][0] * (x[1][1] * x[2][2] - x[1][2] * x[2][1]) -
    x[0][1] * (x[1][0] * x[2][2] - x[1][2] * x[2][0]) +
    x[0][2] * (x[1][0] * x[2][1] - x[1][1] * x[2][0]);
  const d = det(m);
  if (Math.abs(d) < 1e-9) return null;
  return [0, 1, 2].map((col) => det(m.map((row, i) => row.map((val, j) => (j === col ? v[i] : val)))) / d);
}

/** Average distance (percent) between where the fit puts each pair and where
 *  it was clicked — shown so the user knows how good the alignment is. */
export function fitError(m: Affine, pairs: { from: Point; to: Point }[]) {
  if (!pairs.length) return 0;
  return (
    pairs.reduce((sum, { from, to }) => {
      const [x, y] = applyAffine(m, from);
      return sum + Math.hypot(x - to[0], y - to[1]);
    }, 0) / pairs.length
  );
}

/** a ∘ b: first b, then a. */
export function composeAffine([a1, b1, c1, d1, e1, f1]: Affine, [a2, b2, c2, d2, e2, f2]: Affine): Affine {
  return [a1 * a2 + b1 * d2, a1 * b2 + b1 * e2, a1 * c2 + b1 * f2 + c1, d1 * a2 + e1 * d2, d1 * b2 + e1 * e2, d1 * c2 + e1 * f2 + f1];
}

/** Image sizes in pixels, so placement edits happen in real pixels (a 30°
 *  rotation stays 30° even though percent-x and percent-y differ in size). */
export interface Sizes {
  refW: number;
  refH: number;
  sceneW: number;
  sceneH: number;
}

/** A change made in scene PIXELS -> the same change in scene PERCENT. */
export function pxDeltaToPercent([a, b, c, d, e, f]: Affine, s: Pick<Sizes, "sceneW" | "sceneH">): Affine {
  const kx = s.sceneW / 100;
  const ky = s.sceneH / 100;
  return [a, (b * ky) / kx, c / kx, (d * kx) / ky, e, f / ky];
}

/** Scene-pixel delta: rotate by `deg` about the scene-percent point `about`. */
export function rotationDelta(deg: number, about: Point, s: Pick<Sizes, "sceneW" | "sceneH">): Affine {
  const r = (deg * Math.PI) / 180;
  const [px, py] = [(about[0] * s.sceneW) / 100, (about[1] * s.sceneH) / 100];
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return pxDeltaToPercent([cos, -sin, px - cos * px + sin * py, sin, cos, py - sin * px - cos * py], s);
}

/** Scene-pixel delta: scale by (sx, sy) along the axes rotated by `deg`,
 *  about the scene-percent point `about`. */
export function scaleDelta(sx: number, sy: number, deg: number, about: Point, s: Pick<Sizes, "sceneW" | "sceneH">): Affine {
  const r = (deg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  // R · diag(sx, sy) · R⁻¹, about `about` (in px).
  const a = cos * cos * sx + sin * sin * sy;
  const b = cos * sin * (sx - sy);
  const e = sin * sin * sx + cos * cos * sy;
  const [px, py] = [(about[0] * s.sceneW) / 100, (about[1] * s.sceneH) / 100];
  return pxDeltaToPercent([a, b, px - a * px - b * py, b, e, py - b * px - e * py], s);
}

/** Human placement values of a transform: where the reference's centre sits
 *  (scene %), its size (scene %), rotation (°) and skew. */
export interface Placement {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  skew: number;
}

/** Transform -> placement values (QR decomposition in pixel space). */
export function toPlacement(m: Affine, s: Sizes): Placement {
  const [a, b, , d, e] = m;
  // Linear part in pixels: reference px -> scene px.
  const p = (a * s.sceneW) / s.refW;
  const q = (b * s.sceneW) / s.refH;
  const r = (d * s.sceneH) / s.refW;
  const t = (e * s.sceneH) / s.refH;
  const sx = Math.hypot(p, r);
  const rotation = (Math.atan2(r, p) * 180) / Math.PI;
  const skew = (p * q + r * t) / (sx * sx);
  const sy = (p * t - q * r) / sx;
  const [x, y] = applyAffine(m, [50, 50]);
  return { x, y, width: (sx * s.refW * 100) / s.sceneW, height: (sy * s.refH * 100) / s.sceneH, rotation, skew };
}

/** Placement values -> transform (inverse of toPlacement). */
export function fromPlacement(v: Placement, s: Sizes): Affine {
  const sx = (v.width * s.sceneW) / (100 * s.refW);
  const sy = (v.height * s.sceneH) / (100 * s.refH);
  const rad = (v.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  // R · [[sx, skew·sx], [0, sy]]
  const p = cos * sx;
  const q = cos * v.skew * sx - sin * sy;
  const r = sin * sx;
  const t = sin * v.skew * sx + cos * sy;
  const a = (p * s.refW) / s.sceneW;
  const b = (q * s.refH) / s.sceneW;
  const d = (r * s.refW) / s.sceneH;
  const e = (t * s.refH) / s.sceneH;
  // Translation: the reference centre (50, 50) lands on (x, y).
  return [a, b, v.x - a * 50 - b * 50, d, e, v.y - d * 50 - e * 50];
}
