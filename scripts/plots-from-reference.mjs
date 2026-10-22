#!/usr/bin/env node
/**
 * Plots from the reference image — every plot outlined from the reference's
 * drawn boundary lines and named from the label printed inside it.
 *
 *   npm run plots:from-reference -- <sceneId> [--dry] [--preview out.jpg]
 *
 * For a reference that is YOUR render with plot lines + labels drawn on top
 * (labels in white "pills", e.g. "MT12-V5-170"), already placed on the scene
 * (Place reference… → Auto-align). It:
 *   1. refines the placement by matching small patches of the two renders;
 *   2. finds every label pill and reads it (tesseract, several scales, voted;
 *      ids are unique, so a duplicate takes its other reading if that's free);
 *   3. finds the drawn lines (darker than the render under them, thin dark
 *      valleys, long dark strokes, the white site boundary);
 *   4. grows each plot outward from its label until it meets a line or a
 *      neighbouring plot, limited by the plot's best-supported straight
 *      sides so it can't run out into a road through a gap in the lines;
 *   5. squares each plot up: a rectangle on the axes it shares with its
 *      neighbours, sized without bulges; a side that leaked past a missed
 *      line (much bigger than the neighbours) is pulled in to the drawn line
 *      at a normal size; each side then snaps onto the drawn lot line next to
 *      it (so a lot can taper, e.g. along a curved road); any overlap left is
 *      cut along a shared edge — then maps it onto the scene.
 * Then it REPLACES the scene's shapes (and saves the refined placement) in
 * data/project.json. --dry only reports (and writes --preview).
 *
 *   node scripts/plots-from-reference.mjs --scene-file scene.json --out result.json
 * (the editor's Generate button) reads the scene from a file and writes
 * { shapes, transform } to --out instead of touching data/project.json.
 *
 * Label format: LABEL_RE below. Change it (and CHARS) for another naming scheme.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { createWorker } from "tesseract.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROJECT_FILE = path.join(ROOT, "data/project.json");

/** A clean read of one label, and the characters OCR may use. */
const LABEL_RE = /^MT12-V([4-6])-(\d{3})$/;
const CHARS = "MT0123456789-V";
/** OCR often drops or doubles a hyphen: rebuild "MT12-V<type>-<nnn>" from the digits. */
function repairLabel(text) {
  const t = text.replace(/[^0-9V]+$/, "");
  const num = t.match(/(\d{3})$/)?.[1];
  const v = t.lastIndexOf("V");
  const type = v >= 0 ? t[v + 1]?.match(/[4-6]/)?.[0] : undefined;
  return num && type ? `MT12-V${type}-${num}` : null;
}

const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const sceneId = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
const dry = args.includes("--dry");
const preview = opt("--preview");
const sceneFile = opt("--scene-file");
const out = opt("--out");
const log = (...m) => (out ? console.error(...m) : console.log(...m));

// ---------------------------------------------------------------- images
async function loadGray(file, width) {
  let img = sharp(file);
  if (width) img = img.resize({ width });
  const { data, info } = await img.removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const g = new Float32Array(info.width * info.height);
  for (let i = 0; i < g.length; i++) g[i] = 0.299 * data[i * 3] + 0.587 * data[i * 3 + 1] + 0.114 * data[i * 3 + 2];
  return { data: g, width: info.width, height: info.height };
}
function bilinear(g, x, y) {
  if (!(x >= 0 && y >= 0 && x <= g.width - 1 && y <= g.height - 1)) return NaN;
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const x1 = Math.min(x0 + 1, g.width - 1), y1 = Math.min(y0 + 1, g.height - 1), d = g.data, w = g.width;
  return (d[y0 * w + x0] * (1 - fx) + d[y0 * w + x1] * fx) * (1 - fy) + (d[y1 * w + x0] * (1 - fx) + d[y1 * w + x1] * fx) * fy;
}
const applyAffine = ([a, b, c, d, e, f], [x, y]) => [a * x + b * y + c, d * x + e * y + f];
const composeAffine = ([a1, b1, c1, d1, e1, f1], [a2, b2, c2, d2, e2, f2]) => [
  a1 * a2 + b1 * d2, a1 * b2 + b1 * e2, a1 * c2 + b1 * f2 + c1, d1 * a2 + e1 * d2, d1 * b2 + e1 * e2, d1 * c2 + e1 * f2 + f1,
];
/** Least-squares affine from point pairs (same maths as lib/affine.ts fitAffine). */
function fitAffine(pairs) {
  const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], bx = [0, 0, 0], by = [0, 0, 0];
  for (const { from, to } of pairs) {
    const r = [from[0], from[1], 1];
    for (let i = 0; i < 3; i++) { for (let j = 0; j < 3; j++) A[i][j] += r[i] * r[j]; bx[i] += r[i] * to[0]; by[i] += r[i] * to[1]; }
  }
  const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const d = det(A);
  if (Math.abs(d) < 1e-9) return null;
  const solve = (v) => [0, 1, 2].map((c) => det(A.map((row, i) => row.map((val, j) => (j === c ? v[i] : val)))) / d);
  const a = solve(bx), b = solve(by);
  return [a[0], a[1], a[2], b[0], b[1], b[2]];
}

// ---------------------------------------------------------------- raster helpers (W x H)
function raster(W, H) {
  const N = W * H;
  /** Separable square min / max filter on floats. */
  const filt = (src, r, op) => {
    const tmp = new Float32Array(N), out = new Float32Array(N);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let m = src[y * W + x]; for (let k = Math.max(0, x - r); k <= Math.min(W - 1, x + r); k++) m = op(m, src[y * W + k]); tmp[y * W + x] = m; }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let m = tmp[y * W + x]; for (let k = Math.max(0, y - r); k <= Math.min(H - 1, y + r); k++) m = op(m, tmp[k * W + x]); out[y * W + x] = m; }
    return out;
  };
  /** Binary dilate (any) / erode (all) with a square, via running counts. */
  const morph = (src, r, dilate) => {
    const tmp = new Uint8Array(N), out = new Uint8Array(N);
    for (let y = 0; y < H; y++) { let c = 0; const row = y * W;
      for (let x = -r; x < W; x++) { if (x + r < W) c += src[row + x + r]; if (x - r - 1 >= 0) c -= src[row + x - r - 1]; if (x >= 0) { const span = Math.min(W - 1, x + r) - Math.max(0, x - r) + 1; tmp[row + x] = dilate ? +(c > 0) : +(c === span); } } }
    for (let x = 0; x < W; x++) { let c = 0;
      for (let y = -r; y < H; y++) { if (y + r < H) c += tmp[(y + r) * W + x]; if (y - r - 1 >= 0) c -= tmp[(y - r - 1) * W + x]; if (y >= 0) { const span = Math.min(H - 1, y + r) - Math.max(0, y - r) + 1; out[y * W + x] = dilate ? +(c > 0) : +(c === span); } } }
    return out;
  };
  /** Connected components of pixels where m[i] === val. */
  const components = (m, val, conn8) => {
    const lab = new Int32Array(N).fill(-1), comps = [], st = new Int32Array(N);
    for (let i = 0; i < N; i++) {
      if (m[i] !== val || lab[i] >= 0) continue;
      let sp = 0, x0 = W, y0 = H, x1 = 0, y1 = 0, n = 0;
      st[sp++] = i; lab[i] = comps.length;
      while (sp) {
        const j = st[--sp], x = j % W, y = (j / W) | 0; n++;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if ((!dx && !dy) || (!conn8 && dx && dy)) continue;
          const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          const k = yy * W + xx; if (m[k] === val && lab[k] < 0) { lab[k] = comps.length; st[sp++] = k; }
        }
      }
      comps.push({ x0, y0, x1, y1, n, id: comps.length, w: x1 - x0 + 1, h: y1 - y0 + 1, diag: Math.hypot(x1 - x0, y1 - y0) });
    }
    return { lab, comps };
  };
  return { N, filt, morph, components };
}

// ---------------------------------------------------------------- 1. refine the placement
/** Patch matching on a grid: where does each patch of the scene sit in the
 *  reference (warped by the current fit)? Returns the corrected fit. */
function refinePlacement(scene, ref, T) {
  const SW = scene.width, SH = scene.height;
  const [a, b, c, d, e, f] = T, det = a * e - b * d;
  const warped = { data: new Float32Array(SW * SH), width: SW, height: SH };
  for (let v = 0; v < SH; v++) for (let u = 0; u < SW; u++) {
    const X = ((u + 0.5) / SW) * 100 - c, Y = ((v + 0.5) / SH) * 100 - f;
    const x = (e * X - b * Y) / det, y = (-d * X + a * Y) / det;
    warped.data[v * SW + u] = bilinear(ref, (x / 100) * ref.width - 0.5, (y / 100) * ref.height - 0.5);
  }
  const HALF = 30, R = 30, pairs = [];
  for (let gy = 1; gy < 10; gy++) for (let gx = 1; gx < 14; gx++) {
    const cx = Math.round((gx / 14) * SW), cy = Math.round((gy / 10) * SH);
    const n = (2 * HALF + 1) ** 2, pa = new Float32Array(n);
    let sa = 0, saa = 0, k = 0;
    for (let y = -HALF; y <= HALF; y++) for (let x = -HALF; x <= HALF; x++) { const v = scene.data[(cy + y) * SW + cx + x]; pa[k++] = v; sa += v; saa += v * v; }
    const va = saa - (sa * sa) / n;
    if (va < n * 50) continue; // featureless
    let best = { s: -2, dx: 0, dy: 0 };
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      let sb = 0, sbb = 0, sab = 0, bad = false; k = 0;
      for (let y = -HALF; y <= HALF && !bad; y++) for (let x = -HALF; x <= HALF; x++) {
        const v = warped.data[(cy + y + dy) * SW + cx + x + dx];
        if (!(v === v)) { bad = true; break; }
        sb += v; sbb += v * v; sab += v * pa[k++];
      }
      if (bad) continue;
      const vb = sbb - (sb * sb) / n; if (vb <= 0) continue;
      const s = (sab - (sa * sb) / n) / Math.sqrt(va * vb);
      if (s > best.s) best = { s, dx, dy };
    }
    if (best.s > 0.8) pairs.push({ from: [((cx + best.dx) / SW) * 100, ((cy + best.dy) / SH) * 100], to: [(cx / SW) * 100, (cy / SH) * 100] });
  }
  const err = (M) => pairs.reduce((s, q) => s + Math.hypot(...applyAffine(M, q.from).map((v, i) => v - q.to[i])), 0) / Math.max(1, pairs.length);
  const C = pairs.length >= 6 ? fitAffine(pairs) : null;
  if (!C || err(C) > err([1, 0, 0, 0, 1, 0])) return { T, before: err([1, 0, 0, 0, 1, 0]), after: null, pairs: pairs.length };
  return { T: composeAffine(C, T), before: err([1, 0, 0, 0, 1, 0]), after: err(C), pairs: pairs.length };
}

// ---------------------------------------------------------------- main
const project = sceneFile ? null : JSON.parse(await readFile(PROJECT_FILE, "utf8"));
const scene = sceneFile ? JSON.parse(await readFile(sceneFile, "utf8")) : project.scenes.find((s) => s.id === (sceneId ?? project.startScene));
if (!scene) throw new Error(`No scene "${sceneId}". Scenes: ${project.scenes.map((s) => s.id).join(", ")}`);
if (/^https?:/.test(scene.image) || /^https?:/.test(scene.trace?.image ?? "")) throw new Error("Only images under /public can be read");
if (!scene.trace) throw new Error(`Scene "${scene.id}" has no reference image (Scene settings → Reference image)`);
const pub = (src) => path.join(ROOT, "public", src);
log(`Scene ${scene.id}: ${scene.image}  ·  reference ${scene.trace.image}`);

const G = await loadGray(pub(scene.trace.image));
const W = G.width, H = G.height;
const { N, filt, morph, components } = raster(W, H);

log("1/5 Refining the placement…");
const refined = refinePlacement(await loadGray(pub(scene.image), Math.min(1600, scene.width)), await loadGray(pub(scene.trace.image), Math.min(2400, W)), scene.trace.transform);
log(`    ${refined.pairs} patches · average misfit ${refined.before.toFixed(3)}% → ${refined.after === null ? "kept as is" : refined.after.toFixed(3) + "%"}`);
const T = refined.T;

// your render, warped into the reference's pixels
const S = await loadGray(pub(scene.image));
const Sw = new Float32Array(N);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const [X, Y] = applyAffine(T, [((x + 0.5) / W) * 100, ((y + 0.5) / H) * 100]);
  Sw[y * W + x] = bilinear(S, (X / 100) * S.width - 0.5, (Y / 100) * S.height - 0.5);
}

// ---------------------------------------------------------------- 2. labels
log("2/5 Finding and reading the labels…");
const white = new Uint8Array(N);
for (let i = 0; i < N; i++) if (G.data[i] >= 248) white[i] = 1;
// pills: white shapes, closed over their text, opened so thin white lines drop out
const pills = morph(morph(morph(morph(white, 4, true), 4, false), 9, false), 9, true);
const pillCC = components(pills, 1, false);
const isText = (x, y, id) => pillCC.lab[y * W + x] === id && G.data[y * W + x] < 140;
/** Two touching labels share a pill: split at the widest blank column / row near the middle. */
function splitPill(p) {
  const out = [];
  const go = (bx) => {
    if (bx.w < 210 && bx.h < 52) return out.push(bx);
    const horiz = bx.w >= 210, len = horiz ? bx.w : bx.h, across = horiz ? bx.h : bx.w, prof = [];
    for (let k = 0; k < len; k++) { let c = 0; for (let m = 0; m < across; m++) if (horiz ? isText(bx.x0 + k, bx.y0 + m, p.id) : isText(bx.x0 + m, bx.y0 + k, p.id)) c++; prof.push(c); }
    let best = -1, bestLen = 0, s = -1;
    for (let k = Math.floor(len * 0.25); k < Math.ceil(len * 0.75); k++) {
      if (!prof[k]) { if (s < 0) s = k; if (k - s + 1 > bestLen) { bestLen = k - s + 1; best = s + (k - s) / 2; } } else s = -1;
    }
    if (best < 0) return out.push(bx);
    const cut = Math.round(best);
    go(horiz ? { ...bx, x1: bx.x0 + cut - 1, w: cut } : { ...bx, y1: bx.y0 + cut - 1, h: cut });
    go(horiz ? { ...bx, x0: bx.x0 + cut, w: bx.w - cut } : { ...bx, y0: bx.y0 + cut, h: bx.h - cut });
  };
  go(p);
  return out;
}
const labelBoxes = [];
for (const p of pillCC.comps) {
  if (p.h < 18 || p.w < 60 || p.w > 600 || p.h > 140) continue;
  for (const b of splitPill(p)) if (b.w > 60 && b.w < 210 && b.h > 18 && b.h < 52) labelBoxes.push({ ...b, pill: p.id });
}
/** The label's text only: black on white, upscaled. */
function cleanLabel(l, scale) {
  const w = l.x1 - l.x0 + 1, h = l.y1 - l.y0 + 1, buf = Buffer.alloc(w * h, 255);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const X = l.x0 + x, Y = l.y0 + y;
    if (pillCC.lab[Y * W + X] === l.pill) buf[y * w + x] = G.data[Y * W + X] < 140 ? 0 : 255;
  }
  return sharp(buf, { raw: { width: w, height: h, channels: 1 } })
    .resize({ width: w * scale, kernel: "lanczos3" })
    .extend({ top: 30, bottom: 30, left: 30, right: 30, background: "#ffffff" })
    .withMetadata({ density: 300 })
    .png()
    .toBuffer();
}
const worker = await createWorker("eng", 1, { langPath: ROOT, cacheMethod: "none", gzip: false, logger: () => {}, errorHandler: () => {} });
await worker.setParameters({ tessedit_char_whitelist: CHARS, tessedit_pageseg_mode: "7", user_defined_dpi: "300" });
const labels = [];
for (const [n, b] of labelBoxes.entries()) {
  const votes = new Map(), texts = [];
  for (const scale of [3, 4, 5]) {
    const { data } = await worker.recognize(await cleanLabel(b, scale));
    const text = data.text.trim().replace(/\s+/g, "");
    texts.push(text);
    const id = LABEL_RE.test(text) ? text : repairLabel(text);
    if (id) votes.set(id, (votes.get(id) ?? 0) + (LABEL_RE.test(text) ? 2 : 1));
  }
  const id = [...votes].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null;
  labels.push({ ...b, cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2, id, texts });
  if (n % 40 === 39) log(`    read ${n + 1} / ${labelBoxes.length}`);
}
await worker.terminate();
// ids are unique: a duplicate that also read as a free id takes that one
for (const l of labels) {
  if (!l.id || labels.filter((o) => o.id === l.id).length < 2) continue;
  for (const t of l.texts) { const alt = LABEL_RE.test(t) ? t : repairLabel(t); if (alt && alt !== l.id && !labels.some((o) => o.id === alt)) { l.id = alt; break; } }
}
const unread = labels.filter((l) => !l.id);
const dupes = [...new Set(labels.filter((l) => l.id && labels.filter((o) => o.id === l.id).length > 1).map((l) => l.id))];
unread.forEach((l, i) => (l.id = `UNREAD-${i + 1}`));
log(`    ${labels.length} labels · ${unread.length} unreadable · duplicates: ${dupes.length ? dupes.join(", ") : "none"}`);

// ---------------------------------------------------------------- 3. drawn lines
log("3/5 Finding the drawn lines…");
const closed = filt(filt(G.data, 3, Math.max), 3, Math.min);
const SwMin = filt(Sw.map((v) => (v === v ? v : 1e9)), 3, Math.min);
const halo = new Uint8Array(N);
for (let i = 0; i < N; i++) if (G.data[i] >= 251 && !(Sw[i] >= 245)) halo[i] = 1;
const nearLabel = morph(halo, 4, true);
const valley = (i) => {
  const x = i % W, y = (i / W) | 0;
  if (x < 2 || y < 2 || x >= W - 2 || y >= H - 2) return 0;
  const D = G.data, g = D[i]; let best = 0;
  for (const o of [2, 2 * W, 2 * W + 2, 2 * W - 2]) { const v = Math.min(D[i - o], D[i + o]) - g; if (v > best) best = v; }
  return best;
};
const mask = new Uint8Array(N);
for (let i = 0; i < N; i++) {
  if (nearLabel[i]) continue;
  const g = G.data[i], df = Sw[i] - g, bh = closed[i] - g, known = Sw[i] === Sw[i];
  if (known ? g < SwMin[i] - 30 && g < 140 : bh > 35 && g < 120) mask[i] = 1; // darker than anything in your render nearby
  else if (valley(i) > 22 && (!known || df > 15)) mask[i] = 1; // thin line, darker than both sides
  else if (bh > 35 && g < 120 && (!known || df > 20)) mask[i] = 2; // dark stroke: kept only if long (below)
}
const cc1 = components(mask, 1, true), cc2 = components(mask, 2, true);
const wall = new Uint8Array(N);
for (let i = 0; i < N; i++) {
  const a = cc1.lab[i], b = cc2.lab[i];
  if (a >= 0 && cc1.comps[a].n >= 6 && cc1.comps[a].diag >= 30) wall[i] = 1;
  if (b >= 0 && cc2.comps[b].diag >= 60) wall[i] = 1;
}
// the white site boundary: long, thin white strokes that aren't label pills
{
  const pillsWide = morph(pills, 3, true), wl = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (white[i] && !pillsWide[i]) wl[i] = 1;
  const cc = components(wl, 1, false);
  const keep = new Set(cc.comps.filter((c) => c.diag > 300 && c.n < 0.05 * c.w * c.h).map((c) => c.id));
  for (let i = 0; i < N; i++) if (cc.lab[i] >= 0 && keep.has(cc.lab[i])) wall[i] = 1;
}

// ---------------------------------------------------------------- 4. plot outlines
log("4/5 Outlining the plots…");
/** Straight sides: rays from the label to the first line, RANSAC lines through
 *  the hits, then the nearest line on each of the plot's four sides. */
const RAYS = 240, MAX = 300;
let seed = 1;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
function sidesOf(cx, cy) {
  const hits = [];
  for (let r = 0; r < RAYS; r++) {
    const a = (r / RAYS) * 2 * Math.PI, dx = Math.cos(a), dy = Math.sin(a);
    for (let t = 1; t < MAX; t += 0.5) {
      const x = Math.round(cx + dx * t), y = Math.round(cy + dy * t);
      if (x < 0 || y < 0 || x >= W || y >= H) break;
      if (wall[y * W + x]) { hits.push({ x: cx + dx * t, y: cy + dy * t }); break; }
    }
  }
  const lines = [];
  let rest = hits;
  for (let k = 0; k < 8 && rest.length >= 8; k++) {
    let best = null;
    for (let it = 0; it < 300; it++) {
      const p = rest[Math.floor(rnd() * rest.length)], q = rest[Math.floor(rnd() * rest.length)];
      const L = Math.hypot(q.x - p.x, q.y - p.y); if (L < 10) continue;
      const nx = -(q.y - p.y) / L, ny = (q.x - p.x) / L, c = nx * p.x + ny * p.y;
      const inl = rest.filter((r) => Math.abs(nx * r.x + ny * r.y - c) < 3);
      if (!best || inl.length > best.length) best = inl;
    }
    if (!best || best.length < 8) break;
    let mx = 0, my = 0; for (const p of best) { mx += p.x; my += p.y; } mx /= best.length; my /= best.length;
    let sxx = 0, syy = 0, sxy = 0; for (const p of best) { const ddx = p.x - mx, ddy = p.y - my; sxx += ddx * ddx; syy += ddy * ddy; sxy += ddx * ddy; }
    const th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    const ln = { nx: -Math.sin(th), ny: Math.cos(th) }; ln.c = ln.nx * mx + ln.ny * my;
    if (ln.nx * cx + ln.ny * cy - ln.c > 0) { ln.nx = -ln.nx; ln.ny = -ln.ny; ln.c = -ln.c; } // label on the inside
    ln.dist = ln.c - (ln.nx * cx + ln.ny * cy);
    const inl = rest.filter((r) => Math.abs(ln.nx * r.x + ln.ny * r.y - ln.c) < 3.5);
    ln.n = inl.length;
    if (ln.dist > 5) lines.push(ln);
    rest = rest.filter((r) => !inl.includes(r));
  }
  const main = lines.slice().sort((a, b) => b.n - a.n)[0];
  const theta = main ? Math.atan2(main.ny, main.nx) : 0;
  const angDiff = (a, b) => { const d = Math.abs(a - b) % (2 * Math.PI); return d > Math.PI ? 2 * Math.PI - d : d; };
  const sides = [0, 1, 2, 3].map((k) => {
    const phi = theta + (k * Math.PI) / 2;
    return lines.filter((ln) => angDiff(Math.atan2(ln.ny, ln.nx), phi) < (25 * Math.PI) / 180).sort((a, b) => a.dist - b.dist)[0] ?? null;
  });
  // how much of each side, between its neighbours, runs along drawn lines
  let poly = [[cx - MAX, cy - MAX, -1], [cx + MAX, cy - MAX, -1], [cx + MAX, cy + MAX, -1], [cx - MAX, cy + MAX, -1]];
  sides.forEach((sd, si) => {
    if (!sd) return;
    const out = [], side = (p) => sd.nx * p[0] + sd.ny * p[1] - sd.c;
    for (let i = 0; i < poly.length; i++) {
      const A = poly[i], B = poly[(i + 1) % poly.length], sa = side(A), sb = side(B);
      if (sa <= 0) out.push(A);
      if (sa < 0 !== sb < 0 && sa !== sb) { const t = sa / (sa - sb); out.push([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, sa <= 0 ? si : A[2]]); }
    }
    poly = out;
  });
  for (let i = 0; i < poly.length; i++) {
    const si = poly[i][2]; if (si < 0) continue;
    const A = poly[i], B = poly[(i + 1) % poly.length], L = Math.hypot(B[0] - A[0], B[1] - A[1]);
    let on = 0, n = 0;
    for (let t = 2; t < L - 2; t++) {
      const x = Math.round(A[0] + ((B[0] - A[0]) * t) / L), y = Math.round(A[1] + ((B[1] - A[1]) * t) / L); n++;
      search: for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < W && Y < H && wall[Y * W + X]) { on++; break search; } }
    }
    sides[si].support = n ? on / n : 0;
  }
  // strong sides hold the plot tightly, medium ones loosely; weak ones may be roof edges
  return sides.filter((s) => s && s.support >= 0.25).map((s) => ({ nx: s.nx, ny: s.ny, c: s.c, margin: s.support >= 0.6 ? 6 : 30 }));
}
const CAP = 160;
const plots = labels.map((l) => ({ ...l, limits: sidesOf(l.cx, l.cy) }));
const allowed = (k, x, y) => {
  const p = plots[k];
  return Math.hypot(x - p.cx, y - p.cy) <= CAP && p.limits.every((s) => s.nx * x + s.ny * y - s.c <= s.margin);
};
// every plot grows from its label at the same speed: lines and neighbours stop it
const grown = morph(wall, 1, true);
const owner = new Int16Array(N).fill(-1);
const queue = new Int32Array(N);
let qh = 0, qt = 0;
plots.forEach((p, k) => {
  for (let y = p.y0 + 3; y <= p.y1 - 3; y++) for (let x = p.x0 + 3; x <= p.x1 - 3; x++) { const i = y * W + x; if (owner[i] === -1) { owner[i] = k; queue[qt++] = i; } }
});
while (qh < qt) {
  const i = queue[qh++], k = owner[i], x = i % W, y = (i / W) | 0;
  for (const [j, xx, yy] of [[i - 1, x - 1, y], [i + 1, x + 1, y], [i - W, x, y - 1], [i + W, x, y + 1]]) {
    if (xx < 0 || yy < 0 || xx >= W || yy >= H || grown[j] || owner[j] !== -1 || !allowed(k, xx, yy)) continue;
    owner[j] = k; queue[qt++] = j;
  }
}
// grow 2 px into the lines, so outlines sit on them rather than beside them
for (let pass = 0; pass < 2; pass++) {
  const add = [];
  for (let i = W; i < N - W; i++) {
    if (owner[i] !== -1) continue;
    for (const j of [i - 1, i + 1, i - W, i + W]) if (owner[j] >= 0 && allowed(owner[j], i % W, (i / W) | 0)) { add.push(i, owner[j]); break; }
  }
  for (let a = 0; a < add.length; a += 2) owner[add[a]] = add[a + 1];
}
/** Douglas–Peucker on an open polyline. */
function simplify(pts, eps) {
  if (pts.length < 3) return pts;
  const [A, B] = [pts[0], pts[pts.length - 1]], L = Math.hypot(B[0] - A[0], B[1] - A[1]) || 1;
  let dmax = 0, idx = 0;
  for (let i = 1; i < pts.length - 1; i++) { const d = Math.abs((B[0] - A[0]) * (A[1] - pts[i][1]) - (A[0] - pts[i][0]) * (B[1] - A[1])) / L; if (d > dmax) { dmax = d; idx = i; } }
  return dmax > eps ? [...simplify(pts.slice(0, idx + 1), eps).slice(0, -1), ...simplify(pts.slice(idx), eps)] : [A, B];
}
const DIRS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const regions = [];
plots.forEach((p, k) => {
  const x0 = Math.max(0, Math.floor(p.cx - CAP) - 4), y0 = Math.max(0, Math.floor(p.cy - CAP) - 4);
  const x1 = Math.min(W - 1, Math.ceil(p.cx + CAP) + 4), y1 = Math.min(H - 1, Math.ceil(p.cy + CAP) + 4);
  const w = x1 - x0 + 3, h = y1 - y0 + 3; // 1 px empty border
  const own = new Uint8Array(w * h);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (owner[y * W + x] === k) own[(y - y0 + 1) * w + (x - x0 + 1)] = 1;
  const flood = (from, ok) => {
    const seen = new Uint8Array(w * h), st = [from]; seen[from] = 1;
    while (st.length) { const i = st.pop(); for (const j of [i - 1, i + 1, i - w, i + w]) if (j >= 0 && j < w * h && !seen[j] && ok(j) && Math.abs((j % w) - (i % w)) <= 1) { seen[j] = 1; st.push(j); } }
    return seen;
  };
  const start = (Math.round(p.cy) - y0 + 1) * w + (Math.round(p.cx) - x0 + 1);
  if (!own[start]) return;
  const m = flood(start, (j) => own[j]); // the part holding the label
  const outside = flood(0, (j) => !m[j]);
  for (let i = 0; i < w * h; i++) if (!outside[i]) m[i] = 1; // fill holes
  const loop0 = traceLoop(m, w, h, 2.2);
  if (!loop0) return;
  regions.push({ p, x0, y0, w, h, m, theta: orientation(loop0) });
});
// A plot's axes match its neighbours' (same block): an odd outline that gives a
// different angle takes the neighbourhood's instead.
const ang90 = (a, b) => { const d = Math.abs(a - b) % (Math.PI / 2); return Math.min(d, Math.PI / 2 - d); };
for (const r of regions) {
  const near = regions.filter((o) => Math.hypot(o.p.cx - r.p.cx, o.p.cy - r.p.cy) < 230).map((o) => o.theta);
  const median = near.reduce((best, a) => (near.reduce((s, b) => s + ang90(a, b), 0) < near.reduce((s, b) => s + ang90(best, b), 0) ? a : best), r.theta);
  r.axis = ang90(r.theta, median) > (6 * Math.PI) / 180 ? median : r.theta;
}
const outlines = [];
for (const { p, x0, y0, w, h, m, axis: theta } of regions) {
  const cos = Math.cos(theta), sin = Math.sin(theta);
  const uv = (x, y) => [x * cos + y * sin, -x * sin + y * cos];
  const ext = trimExtents(m, w, h, uv);
  // Every plot is a rectangle on its axes, sized to the plot without its bulges.
  const toXY = ([u, v]) => [u * cos - v * sin, u * sin + v * cos];
  const rect = [[ext.u0, ext.v0], [ext.u1, ext.v0], [ext.u1, ext.v1], [ext.u0, ext.v1]].map(toXY);
  outlines.push({ id: p.id, theta, cx: p.cx, cy: p.cy, ref: rect.map(([x, y]) => [x - 1 + x0 + 0.5, y - 1 + y0 + 0.5]) });
}

// A plot much bigger than its neighbours along one axis may have leaked past a
// missed line (onto a road, a parking lot). A leak's outer end isn't on a drawn
// line: that end is pulled in to the drawn line at a normal size, else to the
// usual size. A lot that ends on its lines at both ends is really bigger (a
// corner or end lot) and is left alone.
{
  const onWall = morph(wall, 2, true);
  // "does this end sit on a drawn line": also near-black strokes the line finder skipped
  const inked = new Uint8Array(N);
  for (let i = 0; i < N; i++) inked[i] = wall[i] || (G.data[i] < 60 && !(Sw[i] < 90)) ? 1 : 0;
  const onInk = morph(inked, 2, true);
  const share = (mask) => (A, B) => { // share of the segment A→B on the mask
    const L = Math.hypot(B[0] - A[0], B[1] - A[1]); let on = 0, n = 0;
    for (let t = 0; t <= L; t += 1) { const x = Math.round(A[0] + ((B[0] - A[0]) * t) / L), y = Math.round(A[1] + ((B[1] - A[1]) * t) / L); if (x < 0 || y < 0 || x >= W || y >= H) continue; n++; on += mask[y * W + x]; }
    return n ? on / n : 0;
  };
  const lineShare = share(onWall), inkShare = share(onInk);
  const frame = (o) => {
    const cos = Math.cos(o.theta), sin = Math.sin(o.theta);
    const U = ([x, y]) => x * cos + y * sin, V = ([x, y]) => -x * sin + y * cos;
    const us = o.ref.map(U), vs = o.ref.map(V);
    return { cos, sin, u0: Math.min(...us), u1: Math.max(...us), v0: Math.min(...vs), v1: Math.max(...vs), lu: U([o.cx, o.cy]), lv: V([o.cx, o.cy]) };
  };
  const dims = outlines.map(frame);
  let fixed = 0;
  outlines.forEach((o, k) => {
    const F = dims[k];
    // neighbours in the same block: close by, same axes; sizes measured on this plot's axes
    const close = outlines.map((q, j) => ({ q, j })).filter(({ q, j }) => j !== k && Math.hypot(q.cx - o.cx, q.cy - o.cy) < 230);
    let near = close.filter(({ q }) => ang90(q.theta, o.theta) < (8 * Math.PI) / 180);
    // a curved block: no neighbour on the same axes, so compare with all of them (short side with short side)
    const anyAngle = near.length < 3;
    if (anyAngle) near = close;
    if (near.length < 3) return;
    const sizes = near.map(({ j }) => {
      const D = dims[j], du = D.u1 - D.u0, dv = D.v1 - D.v0;
      if (anyAngle) return F.u1 - F.u0 <= F.v1 - F.v0 ? [Math.min(du, dv), Math.max(du, dv)] : [Math.max(du, dv), Math.min(du, dv)];
      return Math.abs(Math.cos(outlines[j].theta - o.theta)) < 0.7 ? [dv, du] : [du, dv];
    });
    const med = (a) => a.sort((x, y) => x - y)[Math.floor(a.length / 2)];
    const want = [med(sizes.map((d) => d[0])), med(sizes.map((d) => d[1]))];
    // a plot's two sizes may be the other way round from most neighbours' (a corner plot): compare with whichever fits
    const cur = [F.u1 - F.u0, F.v1 - F.v0];
    const target = Math.abs(cur[0] - want[0]) + Math.abs(cur[1] - want[1]) <= Math.abs(cur[0] - want[1]) + Math.abs(cur[1] - want[0]) ? want : [want[1], want[0]];
    const toXY = (u, v) => [u * F.cos - v * F.sin, u * F.sin + v * F.cos];
    for (const axis of [0, 1]) {
      const size = axis ? F.v1 - F.v0 : F.u1 - F.u0;
      if (size < 1.25 * target[axis]) continue;
      const [lo, hi] = axis ? [F.v0, F.v1] : [F.u0, F.u1];
      const [olo, ohi] = axis ? [F.u0, F.u1] : [F.v0, F.v1];
      const label = axis ? F.lv : F.lu;
      const seg = (t) => (axis ? [toXY(olo, t), toXY(ohi, t)] : [toXY(t, olo), toXY(t, ohi)]);
      // candidate cuts: from either end, leaving 0.8–1.15× the usual size
      let best = null;
      for (let t = lo + 0.8 * target[axis]; t <= lo + 1.15 * target[axis]; t += 1) { // keep [lo, t]
        if (t - label < 8) continue;
        const sc = lineShare(...seg(t));
        if (!best || sc > best.sc) best = { sc, lo, hi: t };
      }
      for (let t = hi - 0.8 * target[axis]; t >= hi - 1.15 * target[axis]; t -= 1) { // keep [t, hi]
        if (label - t < 8) continue;
        const sc = lineShare(...seg(t));
        if (!best || sc > best.sc) best = { sc, lo: t, hi };
      }
      // Is it a leak? A leak's outer edge crosses a road / parking with no drawn
      // line under it; a corner or end lot that is really bigger ends on its line.
      const edgeLo = inkShare(...seg(lo)), edgeHi = inkShare(...seg(hi));
      if (Math.min(edgeLo, edgeHi) >= 0.45) continue; // both ends on drawn lines: a big lot, keep it
      if (!best || best.sc < 0.3) {
        // no drawn line inside: cut the unsupported end back to the usual size
        const keepLow = edgeLo >= edgeHi;
        best = keepLow ? { lo, hi: Math.max(label + 8, lo + 1.1 * target[axis]) } : { lo: Math.min(label - 8, hi - 1.1 * target[axis]), hi };
      } else if ((best.lo === lo ? edgeHi : edgeLo) >= 0.45) continue; // the end it would cut is on a line: keep it
      if (axis) { F.v0 = best.lo; F.v1 = best.hi; } else { F.u0 = best.lo; F.u1 = best.hi; }
      o.ref = [toXY(F.u0, F.v0), toXY(F.u1, F.v0), toXY(F.u1, F.v1), toXY(F.u0, F.v1)];
      fixed++;
    }
  });
  log(`    ${fixed} oversized sides pulled in`);
}

// Neighbours that overlap (a plot whose lines were partly missed comes out a
// little too big) are both cut back to the middle of the overlap.
for (let pass = 0; pass < 2; pass++) {
  for (let a = 0; a < outlines.length; a++) for (let b = a + 1; b < outlines.length; b++) {
    const A = outlines[a], B = outlines[b];
    if (ang90(A.theta, B.theta) > (8 * Math.PI) / 180) continue;
    const cos = Math.cos(A.theta), sin = Math.sin(A.theta);
    const U = ([x, y]) => x * cos + y * sin, V = ([x, y]) => -x * sin + y * cos;
    const span = (pts, f) => [Math.min(...pts.map(f)), Math.max(...pts.map(f))];
    const [au0, au1] = span(A.ref, U), [bu0, bu1] = span(B.ref, U), [av0, av1] = span(A.ref, V), [bv0, bv1] = span(B.ref, V);
    const ou = Math.min(au1, bu1) - Math.max(au0, bu0), ov = Math.min(av1, bv1) - Math.max(av0, bv0);
    if (ou <= 1 || ov <= 1) continue;
    // separate along the axis where they overlap least
    const f = ou < ov ? U : V, [a0, a1, b0, b1] = ou < ov ? [au0, au1, bu0, bu1] : [av0, av1, bv0, bv1];
    const mid = (Math.max(a0, b0) + Math.min(a1, b1)) / 2;
    const aFirst = a0 + a1 < b0 + b1;
    const clamp = (pts, keepBelow) => pts.map((q) => {
      const d = f(q) - mid;
      if (keepBelow ? d <= 0 : d >= 0) return q;
      const [dx, dy] = f === U ? [cos, sin] : [-sin, cos];
      return [q[0] - d * dx, q[1] - d * dy];
    });
    A.ref = clamp(A.ref, aFirst);
    B.ref = clamp(B.ref, !aFirst);
  }
}

// Snap each side onto the drawn lot line next to it: a rectangle is only an
// approximation (a lot can taper along a curved road), so each side moves and
// turns a little (±15 px, ±6°) onto the strongest nearby line, and the corners
// become where neighbouring sides meet. A side with no clear line stays put.
{
  const onWall = morph(wall, 2, true);
  const along = (A, B) => { // share of the segment A→B on drawn lines
    const L = Math.hypot(B[0] - A[0], B[1] - A[1]); let on = 0, n = 0;
    for (let t = 0; t <= L; t += 1.5) { const x = Math.round(A[0] + ((B[0] - A[0]) * t) / L), y = Math.round(A[1] + ((B[1] - A[1]) * t) / L); if (x < 0 || y < 0 || x >= W || y >= H) continue; n++; on += onWall[y * W + x]; }
    return n ? on / n : 0;
  };
  const meet = (p1, d1, p2, d2) => { // where line p1 + s·d1 meets p2 + t·d2
    const den = d1[0] * d2[1] - d1[1] * d2[0];
    if (Math.abs(den) < 1e-6) return null;
    const s = ((p2[0] - p1[0]) * d2[1] - (p2[1] - p1[1]) * d2[0]) / den;
    return [p1[0] + s * d1[0], p1[1] + s * d1[1]];
  };
  const polyArea = (P) => { let a = 0; for (let i = 0; i < P.length; i++) { const [x1, y1] = P[i], [x2, y2] = P[(i + 1) % P.length]; a += x1 * y2 - x2 * y1; } return Math.abs(a) / 2; };
  let snapped = 0;
  for (const o of outlines) {
    if (o.ref.length !== 4) continue;
    const cx = o.ref.reduce((s, q) => s + q[0], 0) / 4, cy = o.ref.reduce((s, q) => s + q[1], 0) / 4;
    const lines = o.ref.map((A, i) => {
      const B = o.ref[(i + 1) % 4], L = Math.hypot(B[0] - A[0], B[1] - A[1]);
      const dir = [(B[0] - A[0]) / L, (B[1] - A[1]) / L], mid = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
      let nrm = [-dir[1], dir[0]];
      if (nrm[0] * (mid[0] - cx) + nrm[1] * (mid[1] - cy) < 0) nrm = [-nrm[0], -nrm[1]]; // outward
      const here = along(A, B);
      let best = { score: here, p: mid, d: dir };
      for (let tilt = -6; tilt <= 6; tilt += 1.5) {
        const a = (tilt * Math.PI) / 180, d = [dir[0] * Math.cos(a) - dir[1] * Math.sin(a), dir[0] * Math.sin(a) + dir[1] * Math.cos(a)];
        for (let off = -15; off <= 15; off += 1) {
          const p = [mid[0] + nrm[0] * off, mid[1] + nrm[1] * off];
          const score = along([p[0] - (d[0] * L) / 2, p[1] - (d[1] * L) / 2], [p[0] + (d[0] * L) / 2, p[1] + (d[1] * L) / 2]) - Math.abs(off) * 0.004 - Math.abs(tilt) * 0.01;
          if (score > best.score) best = { score, p, d };
        }
      }
      return best.score >= 0.5 && best.score > here + 0.15 ? { p: best.p, d: best.d, moved: true } : { p: mid, d: dir, moved: false };
    });
    if (!lines.some((l) => l.moved)) continue;
    const next = lines.map((l, i) => meet(lines[(i + 3) % 4].p, lines[(i + 3) % 4].d, l.p, l.d));
    if (next.some((q) => !q)) continue;
    const a0 = polyArea(o.ref), a1 = polyArea(next);
    if (a1 < 0.7 * a0 || a1 > 1.35 * a0) continue; // a wild snap: keep the rectangle
    if (next.some((q, i) => Math.hypot(q[0] - o.ref[i][0], q[1] - o.ref[i][1]) > 25)) continue; // a corner flew off (two tilted sides)
    o.ref = next;
    snapped++;
  }
  log(`    ${snapped} plots snapped onto their drawn lines`);
}

// Any overlap left (neighbours at different angles: a curved block, a corner)
// is cut along a line through the middle of the overlap, square to the line
// between the two plots' labels; each keeps its own side.
{
  const area = (P) => { let a = 0; for (let i = 0; i < P.length; i++) { const [x1, y1] = P[i], [x2, y2] = P[(i + 1) % P.length]; a += x1 * y2 - x2 * y1; } return Math.abs(a) / 2; };
  const halfPlane = (P, nx, ny, c) => { // keep nx·x + ny·y <= c
    const out = [], side = (q) => nx * q[0] + ny * q[1] - c;
    for (let i = 0; i < P.length; i++) {
      const A = P[i], B = P[(i + 1) % P.length], sa = side(A), sb = side(B);
      if (sa <= 0) out.push(A);
      if (sa < 0 !== sb < 0 && sa !== sb) { const t = sa / (sa - sb); out.push([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t]); }
    }
    return out;
  };
  const intersect = (P, Q) => { // P ∩ Q, Q convex (Sutherland–Hodgman)
    let sa = 0;
    for (let i = 0; i < Q.length; i++) { const [x1, y1] = Q[i], [x2, y2] = Q[(i + 1) % Q.length]; sa += x1 * y2 - x2 * y1; }
    let out = P;
    for (let i = 0; i < Q.length && out.length; i++) {
      const A = Q[i], B = Q[(i + 1) % Q.length], inp = out;
      out = [];
      const inside = (q) => { const c = (B[0] - A[0]) * (q[1] - A[1]) - (B[1] - A[1]) * (q[0] - A[0]); return sa > 0 ? c >= 0 : c <= 0; };
      const cross = (q, r) => {
        const a1 = B[1] - A[1], b1 = A[0] - B[0], c1 = a1 * A[0] + b1 * A[1], a2 = r[1] - q[1], b2 = q[0] - r[0], c2 = a2 * q[0] + b2 * q[1], d = a1 * b2 - a2 * b1;
        return [(b2 * c1 - b1 * c2) / d, (a1 * c2 - a2 * c1) / d];
      };
      for (let j = 0; j < inp.length; j++) {
        const q = inp[j], r = inp[(j + 1) % inp.length];
        if (inside(r)) { if (!inside(q)) out.push(cross(q, r)); out.push(r); } else if (inside(q)) out.push(cross(q, r));
      }
    }
    return out;
  };
  let cut = 0;
  for (let a = 0; a < outlines.length; a++) for (let b = a + 1; b < outlines.length; b++) {
    const A = outlines[a], B = outlines[b];
    if (Math.hypot(A.cx - B.cx, A.cy - B.cy) > 260) continue;
    const I = intersect(A.ref, B.ref);
    if (I.length < 3 || area(I) < 4) continue;
    const mx = I.reduce((s, q) => s + q[0], 0) / I.length, my = I.reduce((s, q) => s + q[1], 0) / I.length;
    const L = Math.hypot(B.cx - A.cx, B.cy - A.cy) || 1, nx = (B.cx - A.cx) / L, ny = (B.cy - A.cy) / L, c = nx * mx + ny * my;
    A.ref = halfPlane(A.ref, nx, ny, c);
    B.ref = halfPlane(B.ref, -nx, -ny, -c);
    cut++;
  }
  log(`    ${cut} overlaps between differently angled neighbours cut`);
}

/** Outline of a mask (Moore trace), simplified. */
function traceLoop(m, w, h, eps) {
  let first = -1;
  for (let i = 0; i < w * h; i++) if (m[i]) { first = i; break; }
  if (first < 0) return null;
  const pts = [];
  let cur = first, d = 6, guard = 0;
  do {
    pts.push([cur % w, (cur / w) | 0]);
    let found = false;
    for (let t = 0; t < 8; t++) {
      const nd = (d + 6 + t) % 8, nx = (cur % w) + DIRS[nd][0], ny = ((cur / w) | 0) + DIRS[nd][1];
      if (nx >= 0 && ny >= 0 && nx < w && ny < h && m[ny * w + nx]) { cur = ny * w + nx; d = nd; found = true; break; }
    }
    if (!found) break;
  } while (cur !== first && ++guard < 200000);
  if (pts.length < 3) return null;
  let far = 0;
  for (let i = 1; i < pts.length; i++) if (Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]) > Math.hypot(pts[far][0] - pts[0][0], pts[far][1] - pts[0][1])) far = i;
  return [...simplify(pts.slice(0, far + 1), eps).slice(0, -1), ...simplify([...pts.slice(far), pts[0]], eps).slice(0, -1)];
}

/** The plot's main axis: length-weighted average edge direction, modulo 90°. */
function orientation(loop) {
  let c = 0, s = 0;
  for (let i = 0; i < loop.length; i++) {
    const A = loop[i], B = loop[(i + 1) % loop.length], L = Math.hypot(B[0] - A[0], B[1] - A[1]), a = Math.atan2(B[1] - A[1], B[0] - A[0]);
    c += L * Math.cos(4 * a); s += L * Math.sin(4 * a);
  }
  return Math.atan2(s, c) / 4;
}

/** Extent of the plot along its axes, ignoring bulges narrower than half its
 *  usual width (a leak through a gap in the lines, a curl round a tree). */
function trimExtents(m, w, h, uv) {
  const us = [], vs = [];
  for (let i = 0; i < w * h; i++) if (m[i]) { const [u, v] = uv(i % w, (i / w) | 0); us.push(Math.round(u)); vs.push(Math.round(v)); }
  const range = (vals) => {
    const lo = Math.min(...vals), counts = new Array(Math.max(...vals) - lo + 1).fill(0);
    for (const v of vals) counts[v - lo]++;
    const sorted = counts.filter(Boolean).sort((a, b) => a - b), median = sorted[Math.floor(sorted.length / 2)];
    let a = 0, b = counts.length - 1;
    while (a < b && counts[a] < 0.5 * median) a++;
    while (b > a && counts[b] < 0.5 * median) b--;
    return [lo + a - 0.5, lo + b + 0.5];
  };
  const [u0, u1] = range(us), [v0, v1] = range(vs);
  return { u0, u1, v0, v1 };
}

log(`    ${outlines.length} plots outlined`);

// ---------------------------------------------------------------- 5. onto the scene
log("5/5 Placing them on your image…");
const r2 = (v) => Math.round(v * 100) / 100;
const shapes = outlines
  .map((o) => ({
    id: o.id,
    label: o.id,
    kind: "polygon",
    points: o.ref.map(([x, y]) => applyAffine(T, [(x / W) * 100, (y / H) * 100]).map(r2)),
  }))
  .sort((a, b) => Number(a.id.match(/(\d+)$/)?.[1] ?? 0) - Number(b.id.match(/(\d+)$/)?.[1] ?? 0) || a.id.localeCompare(b.id));

if (preview) {
  const img = sharp(pub(scene.image));
  const { width: w, height: h } = await img.metadata();
  const px = ([x, y]) => `${(x / 100) * w},${(y / 100) * h}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${shapes
    .map((s) => {
      const c = s.points.reduce((a, q) => [a[0] + q[0] / s.points.length, a[1] + q[1] / s.points.length], [0, 0]);
      return `<polygon points="${s.points.map(px).join(" ")}" fill="rgba(255,140,0,0.25)" stroke="#ff7a00" stroke-width="2"/><text x="${(c[0] / 100) * w}" y="${(c[1] / 100) * h}" font-size="12" font-family="sans-serif" text-anchor="middle" fill="#fff" stroke="#000" stroke-width="3" paint-order="stroke">${s.id}</text>`;
    })
    .join("")}</svg>`;
  await img.composite([{ input: Buffer.from(svg) }]).jpeg({ quality: 85 }).toFile(path.resolve(preview));
  log(`    preview: ${path.resolve(preview)}`);
}

if (out) {
  await writeFile(out, JSON.stringify({ shapes, transform: T }));
  log(`${shapes.length} plots`);
} else if (dry) {
  log(`Dry run — data/project.json not changed (${shapes.length} plots would replace ${scene.shapes.length}).`);
} else {
  scene.shapes = shapes;
  scene.trace.transform = T;
  scene.trace.warp = "affine";
  scene.trace.points = [];
  await writeFile(PROJECT_FILE, JSON.stringify(project, null, 2) + "\n", "utf8");
  log(`Saved ${shapes.length} plots to data/project.json (scene "${scene.id}"). Reload the editor to see them.`);
}
