import type { Point } from "./types";

export const round2 = (n: number) => Math.round(n * 100) / 100;

/** Area-weighted centroid of a polygon (falls back to the vertex average for
 *  lines, pins and degenerate shapes). Used to place labels and zoom targets. */
export function centroid(points: Point[]): Point {
  if (points.length === 0) return [50, 50];
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    const cross = x1 * y2 - x2 * y1;
    a += cross;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }
  if (Math.abs(a) < 1e-9) {
    const sx = points.reduce((s, p) => s + p[0], 0);
    const sy = points.reduce((s, p) => s + p[1], 0);
    return [sx / points.length, sy / points.length];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

export function boundingBox(points: Point[]) {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

export const toSvgPoints = (points: Point[]) =>
  points.map(([x, y]) => `${x},${y}`).join(" ");

/** Distance from p to the segment a–b, plus the closest point on it. */
export function segmentDistance(p: Point, a: Point, b: Point) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t =
    len2 === 0
      ? 0
      : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  const q: Point = [a[0] + t * dx, a[1] + t * dy];
  return { dist: Math.hypot(p[0] - q[0], p[1] - q[1]), point: q };
}

/** Ramer–Douglas–Peucker: drops vertices that deviate less than `epsilon`
 *  from a straight line. Turns a pixel-staircase contour into a clean polygon. */
export function simplify(points: Point[], epsilon: number): Point[] {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop()!;
    let maxDist = 0;
    let index = -1;
    for (let i = start + 1; i < end; i++) {
      const { dist } = segmentDistance(points[i], points[start], points[end]);
      if (dist > maxDist) {
        maxDist = dist;
        index = i;
      }
    }
    if (index !== -1 && maxDist > epsilon) {
      keep[index] = 1;
      stack.push([start, index], [index, end]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** Simplify a CLOSED ring: split it at its two farthest-apart vertices so RDP
 *  doesn't anchor on an arbitrary start point. */
export function simplifyClosed(points: Point[], epsilon: number): Point[] {
  if (points.length < 4) return points;
  let far = 0;
  let farDist = 0;
  for (let i = 1; i < points.length; i++) {
    const d = Math.hypot(points[i][0] - points[0][0], points[i][1] - points[0][1]);
    if (d > farDist) {
      farDist = d;
      far = i;
    }
  }
  const a = simplify(points.slice(0, far + 1), epsilon);
  const b = simplify([...points.slice(far), points[0]], epsilon);
  return [...a, ...b.slice(1, -1)];
}

/** Ray casting: is p inside the polygon? */
export function pointInPolygon([x, y]: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
