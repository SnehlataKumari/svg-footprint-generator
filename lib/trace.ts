import { invertAffine } from "./affine";
import { simplifyClosed } from "./geometry";
import type { Affine, Point, TraceImage } from "./types";
import { drawTriangles, traceMapper } from "./warp";

/**
 * Turning image pixels into polygons. Two entry points:
 *
 * traceRegion   — "magic wand": the one area around the clicked pixel.
 * detectRegions — "auto-detect": click ONE sample plot and get EVERY plot like
 *                 it in the image (or inside a limit rectangle) in one go.
 *
 * Both work the same way:
 *   1. decide which pixels belong to an area (colour close to the sample's,
 *      or "not outline colour")
 *   2. group touching pixels into areas (flood fill / connected components)
 *   3. optionally grow each area by `grow` px so it covers the outline stroke
 *   4. walk its outer boundary (Moore-neighbour tracing)
 *   5. simplify the pixel staircase into a few straight edges (`smoothing`)
 *
 * They need areas that are visibly separated (an outline, or a different fill
 * colour). Photos / renders with gradients: raise the tolerance or draw by hand.
 */

export interface TraceOptions {
  /** 0–255: how different a pixel may be from the reference colour. */
  tolerance: number;
  /** Pixels to expand each area by after filling. */
  grow: number;
  /** Simplification tolerance in pixels (higher = fewer vertices). */
  smoothing: number;
}

export const DEFAULT_TRACE: TraceOptions = { tolerance: 40, grow: 1, smoothing: 1.5 };

export interface DetectOptions extends TraceOptions {
  /**
   * colour  — areas with the same fill colour as the sample (e.g. all the
   *           white plots, but not the green ones)
   * outline — every area enclosed by the sample's outline colour, whatever
   *           its fill (e.g. plots already coloured by status)
   * lines   — every area enclosed by thin DARK lines drawn over a photo /
   *           3D render (plot lines added on top of a masterplan render).
   *           Reads the image at full resolution so 1–2 px lines survive.
   * compare — the plotting image IS the development image with plot lines
   *           and labels drawn on top: compare the two (aligned) images so
   *           only what was drawn on top remains, and detect plots in that.
   *           Needs a plotting image that is aligned (see detectByComparison).
   */
  mode: "colour" | "outline" | "lines" | "compare";
  /** lines mode: pixels darker than this (0–255 brightness) are lines. */
  lineDarkness: number;
  /** lines mode: thicken lines by this many px first, to bridge small gaps
   *  in them (the areas are grown back by the same amount afterwards). */
  closeGaps: number;
  /** compare mode: how much darker (0–255) the plotting image must be for a
   *  pixel to count as a drawn line. Lower = catches fainter lines. */
  lineStrength: number;
  /** compare mode: drawn-line pieces shorter than this (px) are noise. */
  minLineLength: number;
  /** compare mode: development-image pixels darker than this are roads /
   *  deep shadow and also stop an area (0 = off). Stops plots leaking into
   *  the street through a gap in their outline. */
  roadDarkness: number;
  /** compare mode: keep only areas with a label (drawn text) inside —
   *  drops verges, pavements and blocks outside the plotted phase. */
  requireLabel: boolean;
  /** compare mode: how many px the two images may be out of line. A pixel
   *  only counts as a drawn line if the reference is darker than the darkest
   *  development pixel within this distance — so render edges a few px off
   *  don't turn into fake lines. */
  alignTolerance: number;
  /** compare mode: skip long thin areas (pavements, verges, road strips). */
  skipThin: boolean;
  /** Fit each found area with its smallest rectangle (4 clean corners) —
   *  for rectangular plots; leave off for irregular ones. */
  rectangles: boolean;
  /** Wand in compare mode: return only the clicked area, unfiltered. */
  onlySample?: boolean;
  /** compare mode: skip areas outside the drawn boundary (e.g. a white phase
   *  outline), when the reference has a closed one. */
  insideBoundary: boolean;
  /** Keep areas between minSize x and maxSize x the sample's area. */
  minSize: number;
  maxSize: number;
  /** Only areas whose centre is inside this box (percent of image). */
  limit?: { left: number; top: number; right: number; bottom: number };
}

export const DEFAULT_DETECT: DetectOptions = {
  ...DEFAULT_TRACE,
  mode: "outline",
  minSize: 0.4,
  maxSize: 2.5,
  lineDarkness: 60,
  lineStrength: 15,
  minLineLength: 60,
  roadDarkness: 90,
  requireLabel: true,
  alignTolerance: 2,
  skipThin: true,
  insideBoundary: true,
  rectangles: false,
  closeGaps: 1,
};

/** Longest side the image is sampled at. Bigger = more precise, slower. */
const MAX_SAMPLE = 2400;
/** Lines mode reads (nearly) full resolution: thin lines vanish when scaled down. */
const DETAIL_SAMPLE = 6000;
/** A fill covering more than this share of the image almost certainly leaked. */
const MAX_FILL_SHARE = 0.5;
/** Safety cap for auto-detect. */
const MAX_REGIONS = 3000;

interface Pixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

const pixelCache = new Map<string, Promise<Pixels>>();

/** Decodes an image into raw RGBA at ≤ maxSide px. Cached per URL + size. The
 *  image must be same-origin (or CORS-enabled), else the canvas is tainted. */
export function loadPixels(src: string, maxSide = MAX_SAMPLE): Promise<Pixels> {
  const key = `${maxSide}|${src}`;
  let cached = pixelCache.get(key);
  if (!cached) {
    cached = new Promise<Pixels>((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
        const width = Math.round(img.naturalWidth * scale);
        const height = Math.round(img.naturalHeight * scale);
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return reject(new Error("Canvas not supported"));
        ctx.drawImage(img, 0, 0, width, height);
        try {
          resolve({ data: ctx.getImageData(0, 0, width, height).data, width, height });
        } catch {
          reject(new Error("Image is cross-origin without CORS — upload it through the editor instead"));
        }
      };
      img.onerror = () => reject(new Error("Could not load image"));
      img.src = src;
    });
    cached.catch(() => pixelCache.delete(key));
    pixelCache.set(key, cached);
  }
  return cached;
}

type RGBA = [number, number, number, number];

const colourAt = (data: Uint8ClampedArray, i: number): RGBA => [data[i * 4], data[i * 4 + 1], data[i * 4 + 2], data[i * 4 + 3]];

/** Squared colour distance, scaled so `tolerance` reads as "per channel". */
function closeTo(data: Uint8ClampedArray, i: number, [r, g, b, a]: RGBA, tolerance: number) {
  const o = i * 4;
  const dr = data[o] - r;
  const dg = data[o + 1] - g;
  const db = data[o + 2] - b;
  const da = data[o + 3] - a;
  return dr * dr + dg * dg + db * db + da * da <= tolerance * tolerance * 3;
}

function seedIndex(px: Pixels, xPct: number, yPct: number) {
  const x = Math.min(px.width - 1, Math.max(0, Math.floor((xPct / 100) * px.width)));
  const y = Math.min(px.height - 1, Math.max(0, Math.floor((yPct / 100) * px.height)));
  return y * px.width + x;
}

export type TraceResult = { points: Point[] } | { error: string };

/** Magic wand: trace the area around (xPct, yPct). */
export async function traceRegion(src: string, xPct: number, yPct: number, options: TraceOptions): Promise<TraceResult> {
  const px = await loadPixels(src);
  const seed = seedIndex(px, xPct, yPct);
  const region = fillFrom(px, seed, options.tolerance);
  if (region.area > px.width * px.height * MAX_FILL_SHARE) {
    return { error: "The fill leaked into most of the image — lower the tolerance, or draw this one by hand." };
  }
  if (region.area < 9) return { error: "Region too small — click inside a larger area or raise the tolerance." };
  const points = regionToPolygon(px, region, options);
  return points ? { points } : { error: "Could not find an outline here." };
}

export type DetectResult = { regions: Point[][] } | { error: string };

/** Auto-detect: every area like the clicked sample. */
export async function detectRegions(src: string, xPct: number, yPct: number, options: DetectOptions): Promise<DetectResult> {
  if (options.mode === "lines") return detectInsideLines(src, xPct, yPct, options);
  const px = await loadPixels(src);
  const { width, height, data } = px;
  const total = width * height;
  const seed = seedIndex(px, xPct, yPct);

  // 1. The sample: what one plot looks like.
  const sample = fillFrom(px, seed, options.tolerance);
  if (sample.area > total * MAX_FILL_SHARE) {
    return { error: "The sample leaked into most of the image — lower the tolerance." };
  }
  if (sample.area < 9) return { error: "Sample too small — click inside a plot, away from its label." };

  // 2. Which pixels can be part of an area.
  const inArea = new Uint8Array(total);
  if (options.mode === "colour") {
    const fill = colourAt(data, seed);
    for (let i = 0; i < total; i++) inArea[i] = closeTo(data, i, fill, options.tolerance) ? 1 : 0;
  } else {
    const line = outlineColour(px, sample);
    if (!line) return { error: "Couldn't find an outline around the sample — try “Same fill colour”." };
    for (let i = 0; i < total; i++) inArea[i] = closeTo(data, i, line, options.tolerance) ? 0 : 1;
  }

  // 3. Connected components, filtered by size / position.
  return collectRegions(px, inArea, sample.area, options, options.grow);
}

/**
 * Compare mode. `devSrc` = the development image, `trace` = the reference
 * image and its fit onto the development image (affine, perspective or mesh).
 * The click (`xPct`, `yPct`) and the returned regions are in plotting-image
 * percent, like every other mode.
 *
 *   1. draw the development image onto the plotting image's pixel grid
 *   2. line = the plotting image is clearly darker there (something was drawn)
 *   3. drop short line pieces (render noise, letters); keep long networks
 *   4. also stop at dark road pixels of the development image
 *   5. close small gaps, then the areas between lines are the plots
 *   6. optionally keep only areas with a label inside
 */
export async function detectByComparison(
  devSrc: string,
  trace: Pick<TraceImage, "image" | "transform" | "warp" | "points">,
  xPct: number,
  yPct: number,
  options: DetectOptions,
): Promise<DetectResult> {
  const prep = await prepareComparison(devSrc, trace, options);
  const { plot, width, height, total, dev, labels, regions, votes, inside } = prep;

  const sampleLabel = dominantLabel(labels, width, height, seedIndex(plot, xPct, yPct), 25);
  if (!sampleLabel) return { error: "Clicked on a line, label or road — click in an open part of a plot." };
  const sample = regions[sampleLabel - 1];
  if (sample.touchesEdge || sample.area > total * MAX_FILL_SHARE) {
    return { error: "That area isn't closed by lines — try another plot, or raise “Close gaps”." };
  }
  const toPolygon = (region: Region) => regionToPolygon(plot, region, { ...options, grow: options.grow + options.closeGaps }, options.rectangles);

  // Wand: just the clicked plot, no filters. If it's several plots run
  // together (breaks in their lines), separate it around the click first.
  if (options.onlySample) {
    const typical = typicalPlotArea(prep, width);
    const { region, extra } = sample.area > typical * 1.6 ? separateAround(sample, width, seedIndex(plot, xPct, yPct), typical) : { region: sample, extra: 0 };
    const points = regionToPolygon(plot, region, { ...options, grow: options.grow + options.closeGaps + extra }, options.rectangles);
    return points ? { regions: [points] } : { error: "Could not outline that plot." };
  }

  const minArea = Math.max(9, sample.area * options.minSize);
  const maxArea = sample.area * options.maxSize;
  const l = options.limit;
  const out: Point[][] = [];
  regions.forEach((region, index) => {
    if (out.length >= MAX_REGIONS) return;
    if (region.touchesEdge || region.area < minArea || region.area > maxArea) return;
    if (options.requireLabel && votes[index + 1] < 50 && region !== sample) return;
    if (options.skipThin && region !== sample && isThin(region, width)) return;
    // Outside the drawn site / phase boundary.
    if (options.insideBoundary && inside && region !== sample && !inside[centreIndex(region, width)]) return;
    // Cut off by the edge of the development image: a partial area, not a plot.
    if (region !== sample && nearOutside(region, dev, width, options.closeGaps + 3)) return;
    if (l) {
      const cx = ((region.minX + region.maxX) / 2 / width) * 100;
      const cy = ((region.minY + region.maxY) / 2 / height) * 100;
      if (cx < l.left || cx > l.right || cy < l.top || cy > l.bottom) return;
    }
    const points = toPolygon(region);
    if (points) out.push(points);
  });
  if (!out.length) return { error: "Nothing found — check the images are aligned, or adjust the settings." };
  return { regions: options.rectangles ? tidyRectangles(out, width, height) : out };
}

/** Median area of the areas that look like plots (have a label, not thin,
 *  not cut off) — the yardstick for "several plots run together". */
function typicalPlotArea(c: Comparison, width: number): number {
  if (c.typical) return c.typical;
  const areas = c.regions
    .filter((r, i) => !r.touchesEdge && r.area > 500 && c.votes[i + 1] >= 50 && !isThin(r, width))
    .map((r) => r.area)
    .sort((a, b) => a - b);
  c.typical = areas[Math.floor(areas.length / 2)] || Infinity;
  return c.typical;
}

/**
 * Several plots joined through small breaks in their lines: thin the area a
 * little more (locally, on its bounding box) until the part under the click is
 * about one plot. Returns that part and how much it was thinned (grown back later).
 */
function separateAround(region: Region, width: number, click: number, typical: number): { region: Region; extra: number } {
  const ox = region.minX;
  const oy = region.minY;
  const w = region.maxX - region.minX + 1;
  const h = region.maxY - region.minY + 1;
  let mask: Uint8Array = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) mask[y * w + x] = region.test((y + oy) * width + x + ox) ? 1 : 0;
  const cx = (click % width) - ox;
  const cy = Math.floor(click / width) - oy;
  const pixels: Pixels = { data: new Uint8ClampedArray(0), width: w, height: h };
  for (let extra = 1; extra <= 12; extra++) {
    mask = erode(mask, w, h);
    const labels = new Int32Array(w * h);
    const local = Math.min(Math.max(0, cy), h - 1) * w + Math.min(Math.max(0, cx), w - 1);
    const label = dominantLabel(
      (() => {
        // Label only near the click (cheap): components touching the window.
        let next = 0;
        for (let y = Math.max(0, cy - 30); y <= Math.min(h - 1, cy + 30); y++) {
          for (let x = Math.max(0, cx - 30); x <= Math.min(w - 1, cx + 30); x++) {
            const i = y * w + x;
            if (mask[i] && !labels[i]) component(pixels, (j) => mask[j] === 1, labels, i, ++next);
          }
        }
        return labels;
      })(),
      w,
      h,
      local,
      30,
    );
    if (!label) break;
    let area = 0;
    let minX = w;
    let minY = h;
    let maxX = 0;
    let maxY = 0;
    for (let i = 0; i < labels.length; i++) {
      if (labels[i] !== label) continue;
      area++;
      const x = i % w;
      const y = (i - x) / w;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    // Area once grown back by `extra` px all round (approximately).
    const grown = area + 2 * extra * (maxX - minX + maxY - minY + 2);
    if (grown <= typical * 1.5) {
      const part = labels;
      return {
        extra,
        region: {
          area,
          minX: minX + ox,
          minY: minY + oy,
          maxX: maxX + ox,
          maxY: maxY + oy,
          touchesEdge: false,
          test: (i) => {
            const x = (i % width) - ox;
            const y = Math.floor(i / width) - oy;
            return x >= 0 && y >= 0 && x < w && y < h && part[y * w + x] === label;
          },
        },
      };
    }
  }
  return { region, extra: 0 };
}

interface Comparison {
  plot: Pixels;
  width: number;
  height: number;
  total: number;
  dev: Uint8ClampedArray;
  labels: Int32Array;
  regions: Region[];
  votes: Int32Array;
  /** Inside the drawn boundary (the longest drawn white line, when it's
   *  closed), else null. */
  inside: Uint8Array | null;
  /** Cached typicalPlotArea(). */
  typical?: number;
}

/** The last comparison — re-used while only the cheap settings (sample,
 *  size range, filters, rectangles) change, e.g. Wand clicks. */
let lastComparison: { key: string; value: Promise<Comparison> } | null = null;

/** Steps 1–5 of compare mode (+ label votes): the heavy, click-independent part. */
function prepareComparison(devSrc: string, trace: Pick<TraceImage, "image" | "transform" | "warp" | "points">, options: DetectOptions): Promise<Comparison> {
  const key = JSON.stringify([
    devSrc,
    trace.image,
    trace.transform,
    trace.warp,
    trace.points,
    options.lineStrength,
    options.minLineLength,
    options.roadDarkness,
    options.closeGaps,
    options.alignTolerance,
  ]);
  if (lastComparison?.key !== key) {
    const value = computeComparison(devSrc, trace, options);
    value.catch(() => {
      if (lastComparison?.value === value) lastComparison = null;
    });
    lastComparison = { key, value };
  }
  return lastComparison.value;
}

async function computeComparison(
  devSrc: string,
  trace: Pick<TraceImage, "image" | "transform" | "warp" | "points">,
  options: DetectOptions,
): Promise<Comparison> {
  const plot = await loadPixels(trace.image, DETAIL_SAMPLE);
  const { width, height } = plot;
  const total = width * height;
  const dev = await drawAligned(devSrc, trace, width, height);

  const plotGray = new Uint8Array(total);
  const devGray = new Uint8Array(total);
  const line = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    const o = i * 4;
    plotGray[i] = 0.299 * plot.data[o] + 0.587 * plot.data[o + 1] + 0.114 * plot.data[o + 2];
    devGray[i] = 0.299 * dev[o] + 0.587 * dev[o + 1] + 0.114 * dev[o + 2];
    // Outside the development image = a wall too.
    line[i] = dev[o + 3] < 128 || devGray[i] - plotGray[i] > options.lineStrength ? 1 : 0;
  }
  // Re-test with the darkest development pixel nearby (alignment tolerance).
  if (options.alignTolerance > 0) {
    const darkest = minFilter(devGray, width, height, options.alignTolerance);
    for (let i = 0; i < total; i++) {
      if (dev[i * 4 + 3] >= 128) line[i] = darkest[i] - plotGray[i] > options.lineStrength ? 1 : 0;
    }
  }
  // Drawn WHITE lines are edges too (e.g. a white phase boundary): the
  // reference clearly brighter than the brightest development pixel nearby.
  // Only long thin white shapes count — label halos are white too, but short blobs.
  const brightest = maxFilter(devGray, width, height, Math.max(1, options.alignTolerance));
  const white = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    if (dev[i * 4 + 3] >= 128 && plotGray[i] > 200 && plotGray[i] - brightest[i] > WHITE_LINE) white[i] = 1;
  }
  keepLongThin(white, width, height);
  for (let i = 0; i < total; i++) if (white[i]) line[i] = 1;
  const inside = insideBoundary(white, width, height);
  removeShortPieces(line, width, height, options.minLineLength);

  let inArea: Uint8Array = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    inArea[i] = line[i] || (options.roadDarkness > 0 && devGray[i] < options.roadDarkness) ? 0 : 1;
  }
  for (let i = 0; i < options.closeGaps; i++) inArea = erode(inArea, width, height);

  const labels = new Int32Array(total);
  const regions: Region[] = [];
  for (let start = 0; start < total; start++) {
    if (!inArea[start] || labels[start]) continue;
    regions.push(component(plot, (i) => inArea[i] === 1, labels, start, regions.length + 1));
  }

  // Labels: drawn text = much darker than the development image and dark itself.
  const votes = new Int32Array(regions.length + 1);
  const d = 4;
  for (let y = d; y < height - d; y++) {
    for (let x = d; x < width - d; x++) {
      const i = y * width + x;
      if (!(plotGray[i] < 90 && devGray[i] - plotGray[i] > 40)) continue;
      for (const j of [i - d, i + d, i - d * width, i + d * width]) if (labels[j]) votes[labels[j]]++;
    }
  }
  return { plot, width, height, total, dev, labels, regions, votes, inside };
}

/** Does the region come within `r` px of where the development image ends? */
function nearOutside(region: Region, dev: Uint8ClampedArray, width: number, r: number): boolean {
  const height = dev.length / 4 / width;
  const outside = (x: number, y: number) => x < 0 || y < 0 || x >= width || y >= height || dev[(y * width + x) * 4 + 3] < 128;
  for (let y = region.minY; y <= region.maxY; y++) {
    for (let x = region.minX; x <= region.maxX; x++) {
      if (!region.test(y * width + x)) continue;
      if (outside(x - r, y) || outside(x + r, y) || outside(x, y - r) || outside(x, y + r)) return true;
    }
  }
  return false;
}

/**
 * Clean-up of rectangle plots (percent points in, percent points out):
 * 1. a rectangle ~2x / 3x the typical plot is two / three plots whose dividing
 *    line was missed — split it into equal parts along its length;
 * 2. corners of neighbouring plots that nearly meet are snapped together, so
 *    rows tile without gaps or overlaps.
 */
function tidyRectangles(rects: Point[][], width: number, height: number): Point[][] {
  const toPx = (p: Point): Point => [(p[0] / 100) * width, (p[1] / 100) * height];
  const toPct = (p: Point): Point => [Math.round(((p[0] / width) * 100) * 1000) / 1000, Math.round(((p[1] / height) * 100) * 1000) / 1000];
  const px = rects.map((r) => r.map(toPx));
  const areas = px.map(polygonArea).sort((a, b) => a - b);
  const typical = areas[Math.floor(areas.length / 2)] || 1;

  // 1. Split merged plots.
  const split: Point[][] = [];
  for (const r of px) {
    const k = r.length === 4 ? Math.round(polygonArea(r) / typical) : 1;
    if (k < 2 || k > 4) {
      split.push(r);
      continue;
    }
    // Long sides: 0→1 and 3→2, or 1→2 and 0→3.
    const long01 = Math.hypot(r[1][0] - r[0][0], r[1][1] - r[0][1]) >= Math.hypot(r[3][0] - r[0][0], r[3][1] - r[0][1]);
    const [a, b, c, d] = long01 ? [r[0], r[1], r[2], r[3]] : [r[1], r[2], r[3], r[0]];
    const lerp = (p: Point, q: Point, t: number): Point => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
    for (let i = 0; i < k; i++) {
      split.push([lerp(a, b, i / k), lerp(a, b, (i + 1) / k), lerp(d, c, (i + 1) / k), lerp(d, c, i / k)]);
    }
  }

  // 2. Snap nearby corners (within ~1.2% of a typical plot's side) to their average.
  const eps = Math.sqrt(typical) * 0.12;
  const corners = split.flatMap((r, ri) => r.map((p, pi) => ({ ri, pi, p })));
  const group = corners.map((_, i) => i);
  const find = (i: number): number => (group[i] === i ? i : (group[i] = find(group[i])));
  for (let i = 0; i < corners.length; i++) {
    for (let j = i + 1; j < corners.length; j++) {
      if (corners[i].ri === corners[j].ri) continue;
      const [x1, y1] = corners[i].p;
      const [x2, y2] = corners[j].p;
      if (Math.abs(x1 - x2) < eps && Math.abs(y1 - y2) < eps) group[find(i)] = find(j);
    }
  }
  const sums = new Map<number, [number, number, number]>();
  corners.forEach((c, i) => {
    const g = find(i);
    const s = sums.get(g) ?? [0, 0, 0];
    sums.set(g, [s[0] + c.p[0], s[1] + c.p[1], s[2] + 1]);
  });
  const out = split.map((r) => r.map((p) => p.slice() as Point));
  corners.forEach((c, i) => {
    const [sx, sy, n] = sums.get(find(i))!;
    out[c.ri][c.pi] = [sx / n, sy / n];
  });
  return out.map((r) => r.map(toPct));
}

/** RGBA of the development image `src` drawn onto a width x height canvas in
 *  the reference image's pixel grid (through the inverse of the fit). Alpha 0
 *  where the development image doesn't reach. */
function drawAligned(
  src: string,
  trace: Pick<TraceImage, "transform" | "warp" | "points">,
  width: number,
  height: number,
): Promise<Uint8ClampedArray> {
  const triangles = traceMapper(trace).triangles;
  if (triangles) {
    // Perspective / mesh: draw triangle by triangle (scene% -> reference px).
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return reject(new Error("Canvas not supported"));
        ctx.imageSmoothingQuality = "high";
        drawTriangles(
          ctx,
          img,
          img.naturalWidth,
          img.naturalHeight,
          triangles.map((t) => ({ src: t.to, dst: t.from.map(([x, y]) => [(x / 100) * width, (y / 100) * height]) as [Point, Point, Point] })),
        );
        resolve(ctx.getImageData(0, 0, width, height).data);
      };
      img.onerror = () => reject(new Error(`Could not load ${src}`));
      img.src = src;
    });
  }
  return drawAlignedAffine(src, trace.transform, width, height);
}

function drawAlignedAffine(src: string, transform: Affine, width: number, height: number): Promise<Uint8ClampedArray> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return reject(new Error("Canvas not supported"));
      // development px -> development % -> plotting % -> plotting px
      const [na, nb, nc, nd, ne, nf] = invertAffine(transform);
      const wd = img.naturalWidth;
      const hd = img.naturalHeight;
      ctx.setTransform((na * width) / wd, (nd * height) / wd, (nb * width) / hd, (ne * height) / hd, (nc * width) / 100, (nf * height) / 100);
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0);
      resolve(ctx.getImageData(0, 0, width, height).data);
    };
    img.onerror = () => reject(new Error(`Could not load ${src}`));
    img.src = src;
  });
}

/** Clear 8-connected pieces of `mask` smaller than `minSize` pixels. */
function removeShortPieces(mask: Uint8Array, width: number, height: number, minSize: number) {
  const labels = new Int32Array(mask.length);
  const sizes = [0];
  const stack: number[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || labels[start]) continue;
    const label = sizes.length;
    let size = 0;
    labels[start] = label;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop()!;
      size++;
      const x = i % width;
      const y = (i - x) / width;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if ((dx || dy) && nx >= 0 && ny >= 0 && nx < width && ny < height) {
            const j = ny * width + nx;
            if (mask[j] && !labels[j]) {
              labels[j] = label;
              stack.push(j);
            }
          }
        }
      }
    }
    sizes.push(size);
  }
  for (let i = 0; i < mask.length; i++) if (mask[i] && sizes[labels[i]] < minSize) mask[i] = 0;
}

/** Lines mode: areas = everything brighter than `lineDarkness`, split by the
 *  dark lines. The sample is simply the area that was clicked. */
async function detectInsideLines(src: string, xPct: number, yPct: number, options: DetectOptions): Promise<DetectResult> {
  const px = await loadPixels(src, DETAIL_SAMPLE);
  const { width, height, data } = px;
  const total = width * height;

  let inArea: Uint8Array = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    const o = i * 4;
    const brightness = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
    inArea[i] = brightness > options.lineDarkness ? 1 : 0;
  }
  for (let i = 0; i < options.closeGaps; i++) inArea = erode(inArea, width, height);

  // The click may land on a label or a line: use the nearest area pixel.
  const seed = nearestMember(inArea, width, height, seedIndex(px, xPct, yPct), 25);
  if (seed < 0) return { error: "Clicked on a line or label — click in an open part of a plot." };
  const sample = component(px, (i) => inArea[i] === 1, new Int32Array(total), seed, 1);
  if (sample.area > total * MAX_FILL_SHARE || sample.touchesEdge) {
    return { error: "The sample isn't closed by lines (it leaks out) — raise “Close gaps” or “Line darkness”." };
  }
  return collectRegions(px, inArea, sample.area, options, options.grow + options.closeGaps);
}

/** Connected areas of `inArea` sized like the sample -> polygons. */
function collectRegions(px: Pixels, inArea: Uint8Array, sampleArea: number, options: DetectOptions, grow: number): DetectResult {
  const { width, height } = px;
  const minArea = Math.max(9, sampleArea * options.minSize);
  const maxArea = sampleArea * options.maxSize;
  const labels = new Int32Array(width * height);
  const regions: Point[][] = [];
  // With a limit box, only start areas inside it (much faster on big images).
  const l = options.limit;
  const x0 = l ? Math.max(0, Math.floor((l.left / 100) * width)) : 0;
  const x1 = l ? Math.min(width - 1, Math.ceil((l.right / 100) * width)) : width - 1;
  const y0 = l ? Math.max(0, Math.floor((l.top / 100) * height)) : 0;
  const y1 = l ? Math.min(height - 1, Math.ceil((l.bottom / 100) * height)) : height - 1;
  let next = 0;
  for (let y = y0; y <= y1 && regions.length < MAX_REGIONS; y++) {
    for (let x = x0; x <= x1; x++) {
      const start = y * width + x;
      if (!inArea[start] || labels[start]) continue;
      const region = component(px, (i) => inArea[i] === 1, labels, start, ++next);
      if (region.area < minArea || region.area > maxArea || region.touchesEdge) continue;
      if (l) {
        const cx = ((region.minX + region.maxX) / 2 / width) * 100;
        const cy = ((region.minY + region.maxY) / 2 / height) * 100;
        if (cx < l.left || cx > l.right || cy < l.top || cy > l.bottom) continue;
      }
      const points = regionToPolygon(px, region, { ...options, grow }, options.rectangles);
      if (points) regions.push(points);
      if (regions.length >= MAX_REGIONS) break;
    }
  }
  if (!regions.length) return { error: "Nothing found — widen the size range or adjust the settings." };
  return { regions };
}

/** Shrink the mask by 1 px (a pixel stays only if all 8 neighbours are set). */
function erode(mask: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      out[i] =
        mask[i] &
        mask[i - 1] &
        mask[i + 1] &
        mask[i - width] &
        mask[i + width] &
        mask[i - width - 1] &
        mask[i - width + 1] &
        mask[i + width - 1] &
        mask[i + width + 1];
    }
  }
  return out;
}

/** The area covering most of the (2r+1)² window around `start` (0 = none).
 *  More robust than the exact clicked pixel, which may sit on a speck. */
function dominantLabel(labels: Int32Array, width: number, height: number, start: number, radius: number): number {
  const sx = start % width;
  const sy = (start - sx) / width;
  const counts = new Map<number, number>();
  for (let y = Math.max(0, sy - radius); y <= Math.min(height - 1, sy + radius); y++) {
    for (let x = Math.max(0, sx - radius); x <= Math.min(width - 1, sx + radius); x++) {
      const l = labels[y * width + x];
      if (l) counts.set(l, (counts.get(l) ?? 0) + 1);
    }
  }
  let best = 0;
  let bestCount = 0;
  for (const [l, c] of counts) if (c > bestCount) [best, bestCount] = [l, c];
  return best;
}

/** The member pixel closest to `start` within `radius`, or -1. */
function nearestMember(mask: Uint8Array, width: number, height: number, start: number, radius: number): number {
  if (mask[start]) return start;
  const sx = start % width;
  const sy = (start - sx) / width;
  for (let r = 1; r <= radius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = sx + dx;
        const y = sy + dy;
        if (x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x]) return y * width + x;
      }
    }
  }
  return -1;
}

// ---------------------------------------------------------------------------

/** A set of pixels: membership is `test(index)`, plus its bounds. */
interface Region {
  area: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  touchesEdge: boolean;
  test: (i: number) => boolean;
}

/** Flood fill from `seed`, 4-connected (a 1px diagonal gap in an outline
 *  doesn't let the fill out). */
function fillFrom(px: Pixels, seed: number, tolerance: number): Region {
  const ref = colourAt(px.data, seed);
  const labels = new Int32Array(px.width * px.height);
  return component(px, (i) => closeTo(px.data, i, ref, tolerance), labels, seed, 1);
}

/** Collect the 4-connected group of member pixels containing `start`, writing
 *  `label` into `labels`. */
function component(
  px: Pixels,
  isMember: (i: number) => boolean,
  labels: Int32Array,
  start: number,
  label: number,
): Region {
  const { width, height } = px;
  const region: Region = {
    area: 0,
    minX: width,
    minY: height,
    maxX: 0,
    maxY: 0,
    touchesEdge: false,
    test: (i) => labels[i] === label,
  };
  const stack = [start];
  labels[start] = label;
  const visit = (i: number) => {
    if (!labels[i] && isMember(i)) {
      labels[i] = label;
      stack.push(i);
    }
  };
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % width;
    const y = (i - x) / width;
    region.area++;
    if (x < region.minX) region.minX = x;
    if (x > region.maxX) region.maxX = x;
    if (y < region.minY) region.minY = y;
    if (y > region.maxY) region.maxY = y;
    if (x === 0 || y === 0 || x === width - 1 || y === height - 1) region.touchesEdge = true;
    if (x > 0) visit(i - 1);
    if (x < width - 1) visit(i + 1);
    if (y > 0) visit(i - width);
    if (y < height - 1) visit(i + width);
  }
  return region;
}

/** The most common colour in a 3px ring just outside the sample — its outline. */
function outlineColour(px: Pixels, sample: Region): RGBA | null {
  const { width, height, data } = px;
  const counts = new Map<number, { n: number; colour: RGBA }>();
  const RING = 3;
  for (let y = Math.max(0, sample.minY - RING); y <= Math.min(height - 1, sample.maxY + RING); y++) {
    for (let x = Math.max(0, sample.minX - RING); x <= Math.min(width - 1, sample.maxX + RING); x++) {
      const i = y * width + x;
      if (sample.test(i)) continue;
      // Is it within RING px of the sample?
      let near = false;
      for (let dy = -RING; dy <= RING && !near; dy++) {
        for (let dx = -RING; dx <= RING && !near; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < width && ny < height && sample.test(ny * width + nx)) near = true;
        }
      }
      if (!near) continue;
      // Bucket colours (32 levels per channel) so anti-aliasing doesn't split votes.
      const c = colourAt(data, i);
      const key = ((c[0] >> 3) << 10) | ((c[1] >> 3) << 5) | (c[2] >> 3);
      const entry = counts.get(key);
      if (entry) entry.n++;
      else counts.set(key, { n: 1, colour: c });
    }
  }
  let best: { n: number; colour: RGBA } | null = null;
  for (const entry of counts.values()) if (!best || entry.n > best.n) best = entry;
  return best?.colour ?? null;
}

/** Region -> simplified polygon in percent-of-image. Works on a local copy of
 *  the region's bounding box, so it stays fast with thousands of regions. */
function regionToPolygon(px: Pixels, region: Region, options: TraceOptions, rectangle = false): Point[] | null {
  const pad = options.grow + 1;
  const ox = region.minX - pad;
  const oy = region.minY - pad;
  const w = region.maxX - region.minX + 1 + pad * 2;
  const h = region.maxY - region.minY + 1 + pad * 2;
  let mask: Uint8Array = new Uint8Array(w * h);
  for (let y = region.minY; y <= region.maxY; y++) {
    for (let x = region.minX; x <= region.maxX; x++) {
      if (region.test(y * px.width + x)) mask[(y - oy) * w + (x - ox)] = 1;
    }
  }
  for (let i = 0; i < options.grow; i++) mask = dilate(mask, w, h);
  const contour = traceContour(mask, w, h);
  const simplified = rectangle ? minAreaRectangle(contour) : simplifyClosed(contour, options.smoothing);
  if (simplified.length < 3) return null;
  const clamp = (v: number) => Math.min(100, Math.max(0, v));
  return simplified.map(([x, y]): Point => [
    Math.round(clamp(((x + ox) / px.width) * 100) * 1000) / 1000,
    Math.round(clamp(((y + oy) / px.height) * 100) * 1000) / 1000,
  ]);
}

/** Grow the mask by 1 px in all 8 directions. */
function dilate(mask: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(mask);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < width && ny < height) out[ny * width + nx] = 1;
        }
      }
    }
  }
  return out;
}

// The 8 neighbours, clockwise starting West (y grows downwards).
const DX = [-1, -1, 0, 1, 1, 1, 0, -1];
const DY = [0, -1, -1, -1, 0, 1, 1, 1];
const dirIndex = (dx: number, dy: number) => DX.findIndex((v, i) => v === dx && DY[i] === dy);

/** Moore-neighbour tracing of the mask's outer boundary. Returns pixel
 *  centres in mask coordinates, in order around the shape. */
function traceContour(mask: Uint8Array, width: number, height: number): Point[] {
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x] === 1;

  // Start at the top-most, left-most pixel: its West neighbour is outside.
  const first = mask.indexOf(1);
  if (first < 0) return [];
  const sx = first % width;
  const sy = (first - sx) / width;

  const out: Point[] = [[sx + 0.5, sy + 0.5]];
  let px = sx;
  let py = sy;
  let bx = sx - 1; // "backtrack": the outside pixel we came from
  let by = sy;
  let second: [number, number] | null = null;
  let backAtStart = false;

  for (let guard = 0; guard < width * height * 4; guard++) {
    const d = dirIndex(bx - px, by - py);
    let moved = false;
    for (let k = 1; k <= 8; k++) {
      const i = (d + k) % 8;
      const nx = px + DX[i];
      const ny = py + DY[i];
      if (inside(nx, ny)) {
        const j = (d + k - 1) % 8;
        bx = px + DX[j];
        by = py + DY[j];
        px = nx;
        py = ny;
        moved = true;
        break;
      }
    }
    if (!moved) break; // a single isolated pixel

    // Stop once we're back at the start and about to repeat the first step.
    if (backAtStart && second && px === second[0] && py === second[1]) break;
    backAtStart = px === sx && py === sy;
    if (!second) second = [px, py];
    if (backAtStart) continue;
    out.push([px + 0.5, py + 0.5]);
  }
  return out;
}

/** Keep only 8-connected pieces that are long (bounding-box diagonal ≥ 250 px)
 *  and thin (almost nothing of them survives shrinking by 3 px): drawn lines,
 *  not blobs like label halos. */
function keepLongThin(mask: Uint8Array, width: number, height: number) {
  let core: Uint8Array = mask;
  for (let k = 0; k < 3; k++) core = erode(core, width, height);
  const labels = new Int32Array(mask.length);
  const keep = [false];
  const stack: number[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || labels[start]) continue;
    const label = keep.length;
    let size = 0;
    let thick = 0;
    let x0 = width;
    let x1 = 0;
    let y0 = height;
    let y1 = 0;
    labels[start] = label;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop()!;
      size++;
      thick += core[i];
      const x = i % width;
      const y = (i - x) / width;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if ((dx || dy) && nx >= 0 && ny >= 0 && nx < width && ny < height) {
            const j = ny * width + nx;
            if (mask[j] && !labels[j]) {
              labels[j] = label;
              stack.push(j);
            }
          }
        }
      }
    }
    const diagonal = Math.hypot(x1 - x0, y1 - y0);
    keep.push(diagonal >= 250 && thick <= size * 0.1);
  }
  for (let i = 0; i < mask.length; i++) if (mask[i] && !keep[labels[i]]) mask[i] = 0;
}

/** A pixel of the region near its middle (the bbox centre if it belongs to
 *  the region, else the member pixel nearest to it on the centre row/column). */
function centreIndex(region: Region, width: number): number {
  const cx = Math.round((region.minX + region.maxX) / 2);
  const cy = Math.round((region.minY + region.maxY) / 2);
  if (region.test(cy * width + cx)) return cy * width + cx;
  for (let r = 1; r < Math.max(region.maxX - region.minX, region.maxY - region.minY); r++) {
    for (const [x, y] of [[cx + r, cy], [cx - r, cy], [cx, cy + r], [cx, cy - r]]) {
      if (x >= region.minX && x <= region.maxX && y >= region.minY && y <= region.maxY && region.test(y * width + x)) return y * width + x;
    }
  }
  return cy * width + cx;
}

/**
 * The inside of the drawn boundary: the drawn white lines (one of them long
 * enough to be a site / phase outline), thickened until closed, then flood
 * from the image border — what the flood can't reach is inside. Null when
 * there's no such line or it never closes.
 */
function insideBoundary(white: Uint8Array, width: number, height: number): Uint8Array | null {
  // The single longest white piece.
  const labels = new Int32Array(white.length);
  let best = 0;
  let bestDiag = 0;
  let next = 0;
  const stack: number[] = [];
  for (let s = 0; s < white.length; s++) {
    if (!white[s] || labels[s]) continue;
    const label = ++next;
    let x0 = width;
    let x1 = 0;
    let y0 = height;
    let y1 = 0;
    labels[s] = label;
    stack.push(s);
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % width;
      const y = (i - x) / width;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if ((dx || dy) && nx >= 0 && ny >= 0 && nx < width && ny < height && white[ny * width + nx] && !labels[ny * width + nx]) {
            labels[ny * width + nx] = label;
            stack.push(ny * width + nx);
          }
        }
      }
    }
    const diag = Math.hypot(x1 - x0, y1 - y0);
    if (diag > bestDiag) [best, bestDiag] = [label, diag];
  }
  if (!best || bestDiag < 0.3 * Math.hypot(width, height)) return null;
  // Wall = the boundary, thickened step by step until it's closed (labels
  // sitting on it leave breaks of 20+ px). Only plot centres are tested
  // against the result, so a thick wall doesn't trim plots.
  // All long thin white lines form the wall (a label sitting on the boundary
  // can split it into several pieces).
  let wall: Uint8Array = new Uint8Array(white);
  for (let thickness = 4; thickness <= 24; thickness += 4) {
    for (let k = 0; k < 4; k++) wall = dilate(wall, width, height);
    const inside = fillInside(wall, width, height);
    if (inside) return inside;
  }
  return null;
}

/** Flood from the image border through non-wall pixels; the unreached
 *  non-wall pixels are inside. Null if that's under 5% of the image. */
function fillInside(wall: Uint8Array, width: number, height: number): Uint8Array | null {
  const reached = new Uint8Array(wall.length);
  const stack: number[] = [];
  const seed = (i: number) => {
    if (!wall[i] && !reached[i]) {
      reached[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < width; x++) {
    seed(x);
    seed((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    seed(y * width);
    seed(y * width + width - 1);
  }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % width;
    if (x > 0) seed(i - 1);
    if (x < width - 1) seed(i + 1);
    if (i >= width) seed(i - width);
    if (i + width < wall.length) seed(i + width);
  }
  const inside = new Uint8Array(wall.length);
  let count = 0;
  for (let i = 0; i < wall.length; i++) {
    if (!wall[i] && !reached[i]) {
      inside[i] = 1;
      count++;
    }
  }
  return count > wall.length * 0.05 ? inside : null;
}

/** How much brighter than the development image a drawn white line is. */
const WHITE_LINE = 40;

/** Brightest value within `r` px (square window). */
function maxFilter(src: Uint8Array, width: number, height: number, r: number): Uint8Array {
  const inverted = src.map((v) => 255 - v);
  return minFilter(inverted, width, height, r).map((v) => 255 - v);
}

/** Darkest value within `r` px (square window), separably: rows then columns. */
function minFilter(src: Uint8Array, width: number, height: number, r: number): Uint8Array {
  const tmp = new Uint8Array(src.length);
  const out = new Uint8Array(src.length);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      let m = 255;
      for (let k = Math.max(0, x - r); k <= Math.min(width - 1, x + r); k++) if (src[row + k] < m) m = src[row + k];
      tmp[row + x] = m;
    }
  }
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      let m = 255;
      for (let k = Math.max(0, y - r); k <= Math.min(height - 1, y + r); k++) if (tmp[k * width + x] < m) m = tmp[k * width + x];
      out[y * width + x] = m;
    }
  }
  return out;
}

/**
 * Long thin areas (a pavement along a block, a road verge) rather than plots:
 * stretched (elongation > 3 from the pixel spread) or mostly empty inside their
 * convex outline (solidity < 0.45 — a curved band).
 */
function isThin(region: Region, width: number): boolean {
  let n = 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  const edge: Point[] = [];
  for (let y = region.minY; y <= region.maxY; y++) {
    for (let x = region.minX; x <= region.maxX; x++) {
      const i = y * width + x;
      if (!region.test(i)) continue;
      n++;
      sx += x;
      sy += y;
      sxx += x * x;
      syy += y * y;
      sxy += x * y;
      if (!region.test(i - 1) || !region.test(i + 1) || !region.test(i - width) || !region.test(i + width)) edge.push([x, y]);
    }
  }
  if (n < 50) return true;
  const mx = sx / n;
  const my = sy / n;
  const vxx = sxx / n - mx * mx;
  const vyy = syy / n - my * my;
  const vxy = sxy / n - mx * my;
  const tr = vxx + vyy;
  const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - (vxx * vyy - vxy * vxy)));
  const elongation = Math.sqrt((tr / 2 + disc) / Math.max(1e-9, tr / 2 - disc));
  const solidity = n / Math.max(1, polygonArea(convexHull(edge)));
  return elongation > 3 || solidity < 0.45;
}

function convexHull(points: Point[]): Point[] {
  const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: Point, a: Point, b: Point) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Point[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: Point[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p[i]) <= 0) upper.pop();
    upper.push(p[i]);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

function polygonArea(poly: Point[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

/** The smallest rectangle (any angle) around the outline: rotating calipers
 *  over the convex hull's edges. Returns its 4 corners. */
function minAreaRectangle(contour: Point[]): Point[] {
  const hull = convexHull(contour);
  if (hull.length < 3) return hull;
  let best: Point[] = hull;
  let bestArea = Infinity;
  for (let i = 0; i < hull.length; i++) {
    const [x1, y1] = hull[i];
    const [x2, y2] = hull[(i + 1) % hull.length];
    const len = Math.hypot(x2 - x1, y2 - y1) || 1;
    const ux = (x2 - x1) / len;
    const uy = (y2 - y1) / len;
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (const [x, y] of hull) {
      const u = x * ux + y * uy;
      const v = -x * uy + y * ux;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
    const area = (maxU - minU) * (maxV - minV);
    if (area < bestArea) {
      bestArea = area;
      const corner = (u: number, v: number): Point => [u * ux - v * uy, u * uy + v * ux];
      best = [corner(minU, minV), corner(maxU, minV), corner(maxU, maxV), corner(minU, maxV)];
    }
  }
  return best;
}
