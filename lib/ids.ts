import { boundingBox, centroid } from "./geometry";
import type { Point } from "./types";

/**
 * ID patterns. Any text, with ONE number placeholder:
 *   {n}     -> 1, 2, 3 …
 *   {n:3}   -> 001, 002, 003 … (zero-padded to 3 digits)
 * e.g. "MT01-V6-{n:3}" -> MT01-V6-001,  "Plot {n} (A)" -> Plot 1 (A).
 * A pattern without a placeholder gets the number appended.
 */
const TOKEN = /\{n(?::(\d+))?\}/;

export function formatId(pattern: string, n: number): string {
  const match = pattern.match(TOKEN);
  if (!match) return `${pattern}${n}`;
  const pad = match[1] ? Number(match[1]) : 0;
  return pattern.replace(TOKEN, String(n).padStart(pad, "0"));
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The number inside an id made from `pattern`, or null if it doesn't fit. */
export function parseId(pattern: string, id: string): number | null {
  const parts = pattern.split(TOKEN);
  const [before, , after] = parts.length === 3 ? parts : [pattern, undefined, ""];
  const m = id.match(new RegExp(`^${escape(before)}(\\d+)${escape(after ?? "")}$`));
  return m ? Number(m[1]) : null;
}

/** Ids for a pasted list: one per line, or comma/tab separated. */
export const parseIdList = (text: string) =>
  text
    .split(/[\n,\t]+/)
    .map((s) => s.trim())
    .filter(Boolean);

export type ReadingOrder = "rows" | "rows-rtl" | "columns" | "columns-btt" | "created";

export const READING_ORDERS: { id: ReadingOrder; label: string }[] = [
  { id: "rows", label: "Rows: top→bottom, left→right" },
  { id: "rows-rtl", label: "Rows: top→bottom, right→left" },
  { id: "columns", label: "Columns: left→right, top→bottom" },
  { id: "columns-btt", label: "Columns: left→right, bottom→top" },
  { id: "created", label: "Order they were created" },
];

/**
 * Sorts shapes the way a person reads the plan: grouped into rows (or
 * columns), then along each row. Shapes count as the same row when their
 * centres are within half a typical shape height of each other.
 * For rotated / irregular layouts use the Number tool's click-to-number.
 */
export function readingOrder<T extends { points: Point[] }>(shapes: T[], order: ReadingOrder): T[] {
  if (order === "created" || shapes.length < 2) return shapes.slice();
  const byColumns = order === "columns" || order === "columns-btt";
  const items = shapes.map((shape) => {
    const [x, y] = centroid(shape.points);
    const box = boundingBox(shape.points);
    // Swap axes for columns so one algorithm does both.
    return byColumns
      ? { shape, major: x, minor: y, size: box.width }
      : { shape, major: y, minor: x, size: box.height };
  });
  const sizes = items.map((i) => i.size).sort((a, b) => a - b);
  const tolerance = Math.max(0.01, sizes[Math.floor(sizes.length / 2)] * 0.5);
  const reverse = order === "rows-rtl" || order === "columns-btt";

  items.sort((a, b) => a.major - b.major);
  const lines: (typeof items)[] = [];
  for (const item of items) {
    const line = lines[lines.length - 1];
    const lineMean = line ? line.reduce((s, i) => s + i.major, 0) / line.length : 0;
    if (line && item.major - lineMean <= tolerance) line.push(item);
    else lines.push([item]);
  }
  return lines.flatMap((line) =>
    line.sort((a, b) => (reverse ? b.minor - a.minor : a.minor - b.minor)).map((i) => i.shape),
  );
}
