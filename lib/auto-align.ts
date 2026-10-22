import type { Affine } from "./types";

/**
 * Automatic alignment of the plotting image onto the development image, for
 * the common case where both come from the SAME picture (e.g. the plotting
 * image is the render with plot lines / labels / a page frame added, at a
 * different size or crop).
 *
 * It searches for the scale + offset where the two images look most alike
 * (normalised cross-correlation of their brightness), coarse to fine:
 *   1. tiny thumbnails, every scale 0.3x–3.5x and every offset
 *   2. bigger copies, small steps around the best few matches
 *   3. bigger still, separate x / y scale, sub-pixel offsets
 * No rotation. Images that don't share content (a CAD drawing vs a render)
 * can't be matched this way — use point pairs for those.
 */

export interface Gray {
  data: Float32Array;
  width: number;
  height: number;
}

/** Brightness of the image at `width` px wide (browser-quality downscale). */
function loadGray(src: string, width: number): Promise<Gray> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const w = Math.max(8, Math.round(width));
      const h = Math.max(8, Math.round((w * img.naturalHeight) / img.naturalWidth));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return reject(new Error("Canvas not supported"));
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, w, h);
      const rgba = ctx.getImageData(0, 0, w, h).data;
      const data = new Float32Array(w * h);
      for (let i = 0; i < data.length; i++) data[i] = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
      resolve({ data, width: w, height: h });
    };
    img.onerror = () => reject(new Error(`Could not load ${src}`));
    img.src = src;
  });
}

/** Map plotting% -> development%:  X = a·x + c,  Y = e·y + f. */
interface Params {
  a: number;
  c: number;
  e: number;
  f: number;
}

/** Share of the smaller image (in practice: of the reference's footprint, or
 *  of the development image when the reference is the bigger one) that must
 *  overlap. Relative to the smaller one, so a close-up reference covering a
 *  small part of a large picture can still be placed. */
const MIN_OVERLAP = 0.35;

/**
 * Similarity (−1…1) of the development image `dev` and the plotting image
 * `plot` under `p`. Samples every `step`-th development pixel.
 */
function score(dev: Gray, plot: Gray, p: Params, step = 1): number {
  let n = 0;
  let sd = 0;
  let sp = 0;
  let sdd = 0;
  let spp = 0;
  let sdp = 0;
  const total = Math.ceil(dev.width / step) * Math.ceil(dev.height / step);
  for (let v = 0; v < dev.height; v += step) {
    // Development pixel centre -> percent -> plotting percent -> plotting pixel.
    const Y = ((v + 0.5) / dev.height) * 100;
    const py = (((Y - p.f) / p.e) * plot.height) / 100 - 0.5;
    if (py < 0 || py > plot.height - 1) continue;
    const y0 = Math.floor(py);
    const fy = py - y0;
    const row0 = y0 * plot.width;
    const row1 = Math.min(y0 + 1, plot.height - 1) * plot.width;
    for (let u = 0; u < dev.width; u += step) {
      const X = ((u + 0.5) / dev.width) * 100;
      const px = (((X - p.c) / p.a) * plot.width) / 100 - 0.5;
      if (px < 0 || px > plot.width - 1) continue;
      const x0 = Math.floor(px);
      const fx = px - x0;
      const x1 = Math.min(x0 + 1, plot.width - 1);
      const P =
        (plot.data[row0 + x0] * (1 - fx) + plot.data[row0 + x1] * fx) * (1 - fy) +
        (plot.data[row1 + x0] * (1 - fx) + plot.data[row1 + x1] * fx) * fy;
      const D = dev.data[v * dev.width + u];
      n++;
      sd += D;
      sp += P;
      sdd += D * D;
      spp += P * P;
      sdp += D * P;
    }
  }
  // The reference's footprint, in sampled development pixels (capped at all of them).
  const footprint = Math.min(1, p.a) * Math.min(1, p.e);
  if (n < total * footprint * MIN_OVERLAP) return -1;
  const cov = sdp - (sd * sp) / n;
  const varD = sdd - (sd * sd) / n;
  const varP = spp - (sp * sp) / n;
  return varD > 0 && varP > 0 ? cov / Math.sqrt(varD * varP) : -1;
}

/** Let the browser paint between heavy steps. */
const yieldToBrowser = () => new Promise((r) => setTimeout(r, 0));

export type AutoAlignResult = { transform: Affine; score: number; method: "brightness" | "edges" } | { error: string };

/** Brightness -> edge strength (Sobel). Two images that don't look alike
 *  (a plan vs a render, a different render) still share where the edges are:
 *  roads, block outlines, the site boundary. */
function edges(g: Gray): Gray {
  const { data, width: w, height: h } = g;
  const out = new Float32Array(data.length);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = data[i - w + 1] + 2 * data[i + 1] + data[i + w + 1] - data[i - w - 1] - 2 * data[i - 1] - data[i + w - 1];
      const gy = data[i + w - 1] + 2 * data[i + w] + data[i + w + 1] - data[i - w - 1] - 2 * data[i - w] - data[i - w + 1];
      out[i] = Math.hypot(gx, gy);
    }
  }
  return { data: out, width: w, height: h };
}

/** Below this similarity, brightness matching is retried on edges. */
const CONFIDENT = 0.6;

/**
 * Finds the move + scale (no rotation — rotate by hand first if needed)
 * that best lays the reference image over the scene image. Tries plain
 * brightness first (same picture with things drawn on top), then edges
 * (different pictures of the same place).
 */
export async function autoAlign(
  devSrc: string,
  plotSrc: string,
  onProgress?: (message: string) => void,
  load: (src: string, width: number) => Promise<Gray> = loadGray,
): Promise<AutoAlignResult> {
  const first = await search(devSrc, plotSrc, onProgress, load);
  if (!("error" in first) && first.score >= CONFIDENT) return { ...first, method: "brightness" };
  onProgress?.("Images differ — matching edges…");
  const second = await search(devSrc, plotSrc, onProgress, async (src, width) => edges(await load(src, width)));
  const best = [first, second].filter((r): r is { transform: Affine; score: number } => !("error" in r)).sort((a, b) => b.score - a.score)[0];
  if (!best) return { error: "No match found — place it by hand (handles / matching points)" };
  // Edge similarity runs lower than brightness similarity for a good match.
  if (best === second && best.score < 0.3) return { error: `No confident match (edge similarity ${best.score.toFixed(2)}) — place it by hand` };
  if (best === first && best.score < 0.5) return { error: `No confident match (similarity ${best.score.toFixed(2)}) — place it by hand` };
  return { ...best, method: best === second ? "edges" : "brightness" };
}

async function search(
  devSrc: string,
  plotSrc: string,
  onProgress: ((message: string) => void) | undefined,
  load: (src: string, width: number) => Promise<Gray>,
): Promise<{ transform: Affine; score: number } | { error: string }> {
  // 1. Global search on thumbnails: uniform scale k (plotting width / development
  //    width, in development percent), every offset on a 1-thumbnail-pixel grid.
  onProgress?.("Comparing thumbnails…");
  const [dev0, plot0] = await Promise.all([load(devSrc, 40), load(plotSrc, 160)]);
  // Keeps the plotting image's own aspect ratio: e = a × (its height/width ratio vs the development's).
  const aspect = plot0.height / plot0.width / (dev0.height / dev0.width);
  const candidates: (Params & { s: number })[] = [];
  for (let i = 0; i <= 30; i++) {
    const a = 0.3 * Math.pow(3.5 / 0.3, i / 30);
    const e = a * aspect;
    const stepC = 100 / dev0.width;
    const stepF = 100 / dev0.height;
    // Only offsets where the images overlap by at least MIN_OVERLAP of the
    // smaller one on each axis.
    const loX = MIN_OVERLAP * 100 * Math.min(1, a);
    const loY = MIN_OVERLAP * 100 * Math.min(1, e);
    for (let c = loX - 100 * a; c <= 100 - loX; c += stepC) {
      for (let f = loY - 100 * e; f <= 100 - loY; f += stepF) {
        const s = score(dev0, plot0, { a, c, e, f }, 1);
        if (s > -1) {
          candidates.push({ a, c, e, f, s });
        }
      }
    }
    if (i % 10 === 0) await yieldToBrowser();
  }
  if (!candidates.length) return { error: "The images don't overlap at any scale" };
  candidates.sort((x, y) => y.s - x.s);
  // Best few, but not near-duplicates of each other.
  const seeds: Params[] = [];
  for (const cand of candidates) {
    if (seeds.every((s) => Math.abs(s.a - cand.a) / s.a > 0.04 || Math.abs(s.c - cand.c) > 3 || Math.abs(s.f - cand.f) > 3)) seeds.push(cand);
    if (seeds.length >= 6) break;
  }

  // 2 + 3. Local refinement on bigger copies.
  const levels = [
    { dev: 160, plot: 600, scaleSpan: 0.06, scaleSteps: 7, offsetSpan: 2, offsetStep: 0.5, separate: false, sample: 1 },
    { dev: 480, plot: 1800, scaleSpan: 0.012, scaleSteps: 5, offsetSpan: 1, offsetStep: 0.5, separate: true, sample: 2 },
    { dev: 960, plot: 3000, scaleSpan: 0.003, scaleSteps: 3, offsetSpan: 0.5, offsetStep: 0.25, separate: true, sample: 2 },
  ];
  let best = seeds.map((p) => ({ ...p, s: -1 }));
  for (const [li, level] of levels.entries()) {
    onProgress?.(`Refining (${li + 1}/${levels.length})…`);
    const [dev, plot] = await Promise.all([load(devSrc, level.dev), load(plotSrc, level.plot)]);
    const px = 100 / dev.width; // one development pixel, in percent
    const refined = [];
    for (const start of best) {
      let cur = { ...start, s: score(dev, plot, start, level.sample) };
      // Scale first (offsets follow the scale's centre), then offsets.
      for (let si = 0; si < level.scaleSteps; si++) {
        const t = level.scaleSteps === 1 ? 0 : (si / (level.scaleSteps - 1)) * 2 - 1;
        for (let sj = 0; sj < (level.separate ? level.scaleSteps : 1); sj++) {
          const t2 = level.separate ? (sj / (level.scaleSteps - 1)) * 2 - 1 : t;
          const a = start.a * (1 + t * level.scaleSpan);
          const e = start.e * (1 + t2 * level.scaleSpan);
          // Keep the development image's centre fixed while scaling.
          const c0 = 50 - ((50 - start.c) / start.a) * a;
          const f0 = 50 - ((50 - start.f) / start.e) * e;
          for (let dc = -level.offsetSpan; dc <= level.offsetSpan; dc += level.offsetStep) {
            for (let df = -level.offsetSpan; df <= level.offsetSpan; df += level.offsetStep) {
              const p = { a, e, c: c0 + dc * px, f: f0 + df * px };
              const s = score(dev, plot, p, level.sample);
              if (s > cur.s) cur = { ...p, s };
            }
          }
        }
      }
      refined.push(cur);
      await yieldToBrowser();
    }
    refined.sort((x, y) => y.s - x.s);
    best = refined.slice(0, li === 0 ? 2 : 1);
  }

  const winner = best[0];
  if (!winner) return { error: "No match found" };
  return { transform: [winner.a, 0, winner.c, 0, winner.e, winner.f], score: winner.s };
}
