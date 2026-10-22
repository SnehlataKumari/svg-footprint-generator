#!/usr/bin/env node
/**
 * Coloured areas from the reference image — for a reference that is YOUR
 * picture with areas tinted on top (a sales map with neighbourhoods / phases
 * coloured in, names written over them), already placed on the scene
 * (Place reference… → Auto-align).
 *
 *   node scripts/areas-from-reference.mjs <sceneId> [--preview out.jpg]
 *   node scripts/areas-from-reference.mjs --scene-file scene.json --out result.json   (the editor's Generate button)
 *
 *   1. warps your picture into the reference's pixels; where they differ
 *      clearly, the reference is tinted;
 *   2. treats the tint as a see-through wash (reference = (1 − α)·picture +
 *      α·wash): finds α, then the wash colour pixel by pixel — flat across an
 *      area, whatever the roofs and roads under it look like;
 *   3. groups the washed ground by colour (k-means seeds, grown out to the
 *      colour edges, touching groups of the same wash joined; hue counts more
 *      than brightness);
 *   4. drops what isn't a wash over your picture (a logo, buttons, the legend,
 *      open water), outlines each area and reads its name from the light text
 *      inside it (tesseract).
 * Writes nothing to data/project.json: prints a summary, or writes
 * { shapes } to --out for the editor to preview.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { refinePlacement } from "./lib/placement.mjs";
import { createWorker } from "tesseract.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const sceneId = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
const out = opt("--out");
const preview = opt("--preview");
const log = (...m) => console.error(...m);

const scene = opt("--scene-file")
  ? JSON.parse(await readFile(opt("--scene-file"), "utf8"))
  : await (async () => {
      const project = JSON.parse(await readFile(path.join(ROOT, "data/project.json"), "utf8"));
      const s = project.scenes.find((sc) => sc.id === (sceneId ?? project.startScene));
      if (!s) throw new Error(`No scene "${sceneId}". Scenes: ${project.scenes.map((sc) => sc.id).join(", ")}`);
      return s;
    })();
if (!scene.trace) throw new Error("This scene has no reference image");
const pub = (src) => {
  if (/^https?:/.test(src)) throw new Error(`Only images under /public can be read (${src})`);
  return path.join(ROOT, "public", src);
};
const applyAffine = ([a, b, c, d, e, f], [x, y]) => [a * x + b * y + c, d * x + e * y + f];

// ---------------------------------------------------------------- 1. the tint
const MAX_W = 1800;
const refMeta = await sharp(pub(scene.trace.image)).metadata();
const W = Math.min(MAX_W, refMeta.width), H = Math.round((refMeta.height * W) / refMeta.width), N = W * H;
const rgb = async (file, w, h) => (await sharp(file).resize(w, h, { fit: "fill" }).removeAlpha().raw().toBuffer());
const R = await rgb(pub(scene.trace.image), W, H);
const sMeta = await sharp(pub(scene.image)).metadata();
const SW = Math.min(2400, sMeta.width), SH = Math.round((sMeta.height * SW) / sMeta.width);
const S = await rgb(pub(scene.image), SW, SH);
log(`Reference ${W}×${H}, your image ${SW}×${SH}`);

// your picture in the reference's pixels; gray copies for the texture check
const valid = new Uint8Array(N), Sg = new Float32Array(N), Rg = new Float32Array(N);
const diff = Buffer.alloc(N * 3, 128);
const Sw = new Uint8Array(N * 3);
// fine-tune the placement first: tracing compares the two pictures closely
const placed = await refinePlacement(pub(scene.image), pub(scene.trace.image), scene.trace.transform);
const T = placed.T;
log(placed.changed ? `Placement fine-tuned (match ${placed.before.toFixed(2)} → ${placed.after.toFixed(2)})` : `Placement kept (match ${placed.after.toFixed(2)})`);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = y * W + x;
  const [X, Y] = applyAffine(T, [((x + 0.5) / W) * 100, ((y + 0.5) / H) * 100]);
  const sx = Math.round((X / 100) * SW - 0.5), sy = Math.round((Y / 100) * SH - 0.5);
  Rg[i] = 0.299 * R[i * 3] + 0.587 * R[i * 3 + 1] + 0.114 * R[i * 3 + 2];
  if (sx < 0 || sy < 0 || sx >= SW || sy >= SH) continue;
  valid[i] = 1;
  const si = (sy * SW + sx) * 3;
  Sg[i] = 0.299 * S[si] + 0.587 * S[si + 1] + 0.114 * S[si + 2];
  for (let c = 0; c < 3; c++) { Sw[i * 3 + c] = S[si + c]; diff[i * 3 + c] = Math.max(0, Math.min(255, 128 + R[i * 3 + c] - S[si + c])); }
}
const BLUR = Math.max(3, W / 170);
const F = await sharp(diff, { raw: { width: W, height: H, channels: 3 } }).blur(BLUR).raw().toBuffer();
// Overall colour grading differs a little between the two pictures: measure
// "no tint" as the most common difference.
const base = [0, 1, 2].map((c) => {
  const hist = new Uint32Array(256);
  for (let i = 0; i < N; i++) if (valid[i]) hist[F[i * 3 + c]]++;
  return hist.indexOf(Math.max(...hist));
});
const tint = new Float32Array(N * 3);
for (let i = 0; i < N; i++) for (let c = 0; c < 3; c++) tint[i * 3 + c] = F[i * 3 + c] - base[c];
const mag = (i) => Math.hypot(tint[i * 3], tint[i * 3 + 1], tint[i * 3 + 2]);

// ---------------------------------------------------------------- raster helpers
/** Binary dilate (any) / erode (all) with a square, via running counts. */
function morph(src, r, dilate) {
  const tmp = new Uint8Array(N), o = new Uint8Array(N);
  for (let y = 0; y < H; y++) { let c = 0; const row = y * W;
    for (let x = -r; x < W; x++) { if (x + r < W) c += src[row + x + r]; if (x - r - 1 >= 0) c -= src[row + x - r - 1]; if (x >= 0) { const span = Math.min(W - 1, x + r) - Math.max(0, x - r) + 1; tmp[row + x] = dilate ? +(c > 0) : +(c === span); } } }
  for (let x = 0; x < W; x++) { let c = 0;
    for (let y = -r; y < H; y++) { if (y + r < H) c += tmp[(y + r) * W + x]; if (y - r - 1 >= 0) c -= tmp[(y - r - 1) * W + x]; if (y >= 0) { const span = Math.min(H - 1, y + r) - Math.max(0, y - r) + 1; o[y * W + x] = dilate ? +(c > 0) : +(c === span); } } }
  return o;
}
const open = (m, r) => morph(morph(m, r, false), r, true);
const close = (m, r) => morph(morph(m, r, true), r, false);
/** 4-connected components of m (non-zero). */
function components(m) {
  const lab = new Int32Array(N).fill(-1), sizes = [], st = new Int32Array(N);
  for (let i = 0; i < N; i++) {
    if (!m[i] || lab[i] >= 0) continue;
    let sp = 0, n = 0; st[sp++] = i; lab[i] = sizes.length;
    while (sp) {
      const j = st[--sp], x = j % W; n++;
      for (const k of [x > 0 ? j - 1 : -1, x < W - 1 ? j + 1 : -1, j - W, j + W]) if (k >= 0 && k < N && m[k] && lab[k] < 0) { lab[k] = sizes.length; st[sp++] = k; }
    }
    sizes.push(n);
  }
  return { lab, sizes };
}
function fillHoles(m) {
  const { lab } = components(m.map((v) => 1 - v));
  const border = new Set();
  for (let x = 0; x < W; x++) { border.add(lab[x]); border.add(lab[N - W + x]); }
  for (let y = 0; y < H; y++) { border.add(lab[y * W]); border.add(lab[y * W + W - 1]); }
  const o = m.slice();
  for (let i = 0; i < N; i++) if (!m[i] && !border.has(lab[i])) o[i] = 1;
  return o;
}

// ---------------------------------------------------------------- 2. tinted ground → regions
const R1 = Math.max(2, Math.round(W / 420));
const THRESHOLD = 10;
const FLAT = Number(process.env.FLAT ?? 7);
let fg = new Uint8Array(N);
for (let i = 0; i < N; i++) fg[i] = valid[i] && mag(i) > THRESHOLD ? 1 : 0;
// flat ground (open water, plain sand, a solid panel) isn't a built area,
// even when its colour differs: it would join neighbouring areas
{
  const r = Math.max(4, Math.round(W / 200)), box = new Float32Array(N), box2 = new Float32Array(N);
  const tmp = new Float32Array(N), tmp2 = new Float32Array(N);
  for (let y = 0; y < H; y++) { let a = 0, b = 0; for (let x = -r; x < W; x++) { if (x + r < W) { const v = Sg[y * W + x + r]; a += v; b += v * v; } if (x - r - 1 >= 0) { const v = Sg[y * W + x - r - 1]; a -= v; b -= v * v; } if (x >= 0) { tmp[y * W + x] = a; tmp2[y * W + x] = b; } } }
  for (let x = 0; x < W; x++) { let a = 0, b = 0; for (let y = -r; y < H; y++) { if (y + r < H) { a += tmp[(y + r) * W + x]; b += tmp2[(y + r) * W + x]; } if (y - r - 1 >= 0) { a -= tmp[(y - r - 1) * W + x]; b -= tmp2[(y - r - 1) * W + x]; } if (y >= 0) { box[y * W + x] = a; box2[y * W + x] = b; } } }
  const n = (2 * r + 1) ** 2;
  for (let i = 0; i < N; i++) if (fg[i] && Math.sqrt(Math.max(0, box2[i] / n - (box[i] / n) ** 2)) < FLAT) fg[i] = 0;
}
fg = close(open(fg, R1), R1);

// The tint is a see-through wash: reference = (1 − α)·picture + α·wash.
// Edges in the picture show through it, so (1 − α) is the least-squares
// ratio of the reference's local changes to the picture's, inside the tint.
const smooth = async (buf, sigma) => new Float32Array(await sharp(Buffer.from(buf), { raw: { width: W, height: H, channels: 3 } }).blur(sigma).raw().toBuffer());
const Rb = await smooth(R, 1.5), Sb = await smooth(Sw, 1.5);
let alpha;
{
  let sRS = 0, sSS = 0;
  for (let i = 0; i < N - 3 * W - 3; i += 3) {
    if (!fg[i] || !fg[i + 3] || !fg[i + 3 * W]) continue;
    for (const j of [i + 3, i + 3 * W]) for (let c = 0; c < 3; c++) {
      const dR = Rb[j * 3 + c] - Rb[i * 3 + c], dS = Sb[j * 3 + c] - Sb[i * 3 + c];
      sRS += dR * dS; sSS += dS * dS;
    }
  }
  alpha = Math.min(0.9, Math.max(0.15, 1 - sRS / Math.max(1, sSS)));
}
const washRaw = new Uint8Array(N * 3);
for (let i = 0; i < N * 3; i++) washRaw[i] = Math.max(0, Math.min(255, Math.round((Rb[i] - (1 - alpha) * Sb[i]) / alpha)));
const wash = await smooth(washRaw, Math.max(2, BLUR / 2));
log(`Wash opacity ≈ ${Math.round(alpha * 100)}%`);
// Compare washes by hue + saturation, brightness weighted down: roofs and
// roads under one wash differ mostly in brightness, two areas in hue.
const D4 = 4;
const feat = new Float32Array(N * D4);
for (let i = 0; i < N; i++) {
  const r = wash[i * 3], g = wash[i * 3 + 1], b = wash[i * 3 + 2], sum = r + g + b + 1;
  feat[i * 4] = (r / sum) * 600; feat[i * 4 + 1] = (g / sum) * 600; feat[i * 4 + 2] = (b / sum) * 600; feat[i * 4 + 3] = sum / 12;
}
const dist2 = (i, c) => (feat[i * 4] - c[0]) ** 2 + (feat[i * 4 + 1] - c[1]) ** 2 + (feat[i * 4 + 2] - c[2]) ** 2 + (feat[i * 4 + 3] - c[3]) ** 2;
const colorAt = (i) => [feat[i * 4], feat[i * 4 + 1], feat[i * 4 + 2], feat[i * 4 + 3]];

// k-means on the wash colours of a sample of tinted pixels
let seed = 7;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const sample = [];
for (let i = 0; i < N; i += 7) if (fg[i]) sample.push(i);
const K = 16;
const centers = [];
if (sample.length) {
  centers.push(colorAt(sample[Math.floor(rnd() * sample.length)]));
  const d = sample.map((i) => dist2(i, centers[0]));
  while (centers.length < K) { // k-means++
    let r = rnd() * d.reduce((x, y) => x + y, 0), j = 0;
    for (; j < d.length - 1 && (r -= d[j]) > 0; j++);
    centers.push(colorAt(sample[j]));
    for (let q = 0; q < sample.length; q++) d[q] = Math.min(d[q], dist2(sample[q], centers[centers.length - 1]));
  }
  for (let it = 0; it < 15; it++) {
    const acc = centers.map(() => [0, 0, 0, 0, 0]);
    for (const i of sample) { let b = 0, bd = Infinity; centers.forEach((c, k) => { const v = dist2(i, c); if (v < bd) { bd = v; b = k; } }); const t = acc[b]; for (let c = 0; c < D4; c++) t[c] += feat[i * 4 + c]; t[D4]++; }
    acc.forEach((t, k) => { if (t[D4]) centers[k] = t.slice(0, D4).map((v) => v / t[D4]); });
  }
}
const cls = new Int16Array(N).fill(-1);
for (let i = 0; i < N; i++) if (fg[i]) { let b = 0, bd = Infinity; centers.forEach((c, k) => { const v = dist2(i, c); if (v < bd) { bd = v; b = k; } }); cls[i] = b; }

// seeds: solid parts of one colour group, each with its own colour
const R2 = Math.max(4, Math.round(W / 90));
const owner = new Int32Array(N).fill(-1);
const seeds = [];
for (let k = 0; k < K; k++) {
  const m = morph(open(cls.map((c) => +(c === k)), R1), R1, false);
  const { lab, sizes } = components(m);
  const idOf = sizes.map((n) => (n >= N * 0.0004 ? seeds.push({ sum: [0, 0, 0, 0], n: 0 }) - 1 : -1));
  for (let i = 0; i < N; i++) if (lab[i] >= 0 && idOf[lab[i]] >= 0) owner[i] = idOf[lab[i]];
}
for (let i = 0; i < N; i++) if (owner[i] >= 0) { const sd = seeds[owner[i]]; for (let c = 0; c < D4; c++) sd.sum[c] += feat[i * 4 + c]; sd.n++; }
const protos = seeds.map((sd) => sd.sum.map((v) => v / sd.n));
log(`Tinted: ${((fg.reduce((x, y) => x + y, 0) / N) * 100).toFixed(1)}% of the reference · ${seeds.length} seeds`);
// Most of the reference differing from your picture = it isn't lined up (a
// tinted map leaves plenty of untouched ground): say so instead of guessing.
{
  const tinted = fg.reduce((x, y) => x + y, 0) / Math.max(1, valid.reduce((x, y) => x + y, 0));
  if (tinted > 0.55) {
    console.error(`Error: the reference doesn't line up with your image (${Math.round(tinted * 100)}% of it differs) — run Place reference… → Auto-align again, then Generate`);
    process.exit(2);
  }
}

// grow every seed over the tinted ground; at each step the pixel closest in
// colour to its seed goes first, so neighbours stop at their colour edge.
// Nothing grows into a clearly different colour: ground no seed could claim
// seeds a region of its own (an area whose colour k-means folded into
// another group), then everything grows again.
const GROW_MAX = Number(process.env.GROW_MAX ?? 32);
function grow() {
  const buckets = Array.from({ length: 256 }, () => []);
  for (let i = 0; i < N; i++) if (owner[i] >= 0) buckets[0].push(i);
  const done = new Uint8Array(N);
  for (let b = 0; b < 256; b++) {
    const L = buckets[b];
    while (L.length) {
      const i = L.pop();
      if (done[i]) continue;
      done[i] = 1;
      const k = owner[i], x = i % W;
      for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) {
        if (j < 0 || j >= N || !fg[j] || done[j] || (owner[j] >= 0 && owner[j] !== k)) continue;
        const d = Math.sqrt(dist2(j, protos[k]));
        if (d > GROW_MAX) continue;
        owner[j] = k;
        buckets[Math.max(b, Math.min(255, Math.round(d * 2)))].push(j);
      }
    }
  }
}
grow();
{
  const left = new Uint8Array(N);
  for (let i = 0; i < N; i++) left[i] = fg[i] && owner[i] < 0 ? 1 : 0;
  const { lab, sizes } = components(morph(open(left, R1), R1, false));
  const before = seeds.length;
  const idOf = sizes.map((n) => (n >= N * 0.0015 ? seeds.push({ sum: [0, 0, 0, 0], n: 0 }) - 1 : -1));
  for (let i = 0; i < N; i++) if (lab[i] >= 0 && idOf[lab[i]] >= 0) { const k = idOf[lab[i]]; owner[i] = k; for (let c = 0; c < D4; c++) seeds[k].sum[c] += feat[i * 4 + c]; seeds[k].n++; }
  for (let k = before; k < seeds.length; k++) protos[k] = seeds[k].sum.map((v) => v / seeds[k].n);
  if (seeds.length > before) { log(`  ${seeds.length - before} more seeds from unclaimed ground`); grow(); }
}

// one area seeded twice: join touching regions only when ALL their seeds'
// colours agree (so a chain of small steps can't join two areas)
const MERGE = Number(process.env.MERGE ?? 25);
{
  const group = seeds.map((_, i) => [i]);
  const parent = seeds.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const border = new Map();
  for (let i = 0; i < N; i++) {
    if (owner[i] < 0) continue;
    for (const j of [i % W < W - 1 ? i + 1 : -1, i + W < N ? i + W : -1]) {
      if (j < 0 || owner[j] < 0 || owner[j] === owner[i]) continue;
      const [a, b] = owner[i] < owner[j] ? [owner[i], owner[j]] : [owner[j], owner[i]];
      border.set(`${a},${b}`, (border.get(`${a},${b}`) ?? 0) + 1);
    }
  }
  const tintDist = (a, b) => Math.hypot(...protos[a].map((v, c) => v - protos[b][c]));
  const far = (ga, gb) => Math.max(...ga.flatMap((a) => gb.map((b) => tintDist(a, b))));
  const pairs = [...border].filter(([, len]) => len > 2 * R1).map(([key]) => key.split(",").map(Number));
  pairs.sort((p, q) => far([p[0]], [p[1]]) - far([q[0]], [q[1]]));
  for (const [a0, b0] of pairs) {
    const a = find(a0), b = find(b0);
    if (a === b || far(group[a], group[b]) >= MERGE) continue;
    parent[b] = a;
    group[a].push(...group[b]);
  }
  for (let i = 0; i < N; i++) if (owner[i] >= 0) owner[i] = find(owner[i]);
}


// ---------------------------------------------------------------- 3. areas
const MIN_AREA = N * 0.003;
const SAT_MIN = Number(process.env.SAT_MIN ?? 0.05);
let areas = [];
for (const k of new Set(owner)) {
  if (k < 0) continue;
  let m = owner.map((o) => +(o === k));
  m = open(close(m, R2), Math.round(R2 * 0.6)); // join its bits, drop thin strips (an outline, a road edge)
  const { lab, sizes } = components(m);
  sizes.forEach((size, part) => {
    if (size < MIN_AREA) return;
    areas.push({ m: fillHoles(close(lab.map((l) => +(l === part)), R2)), k });
  });
}
// the bigger closing may reach over a neighbour: a pixel claimed twice stays
// with the area that owned it before the closing
for (let i = 0; i < N; i++) {
  let claims = 0;
  for (const a of areas) claims += a.m[i];
  if (claims < 2) continue;
  const keeper = areas.find((a) => a.m[i] && a.k === owner[i]) ?? areas.find((a) => a.m[i]);
  for (const a of areas) if (a !== keeper) a.m[i] = 0;
}
// stats + texture check: a tint keeps the picture under it, a logo or button doesn't
areas = areas.flatMap((a) => {
  let n = 0, sx = 0, sy = 0, s1 = 0, s2 = 0, s11 = 0, s22 = 0, s12 = 0, x0 = W, y0 = H, x1 = 0, y1 = 0;
  const wsum = [0, 0, 0];
  for (let i = 0; i < N; i++) {
    if (!a.m[i]) continue;
    const x = i % W, y = (i / W) | 0;
    n++; sx += x; sy += y;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    for (let c = 0; c < 3; c++) wsum[c] += wash[i * 3 + c];
    if (!valid[i]) continue;
    s1 += Rg[i]; s2 += Sg[i]; s11 += Rg[i] ** 2; s22 += Sg[i] ** 2; s12 += Rg[i] * Sg[i];
  }
  if (n < MIN_AREA) return [];
  const ncc = (s12 - (s1 * s2) / n) / Math.sqrt((s11 - (s1 * s1) / n) * (s22 - (s2 * s2) / n));
  // see-through: the picture's edges show in the reference at about (1 − α) of their strength
  let eRS = 0, eSS = 0;
  for (let i = 0; i < N - 3 * W - 3; i += 2) {
    if (!a.m[i] || !a.m[i + 3] || !a.m[i + 3 * W]) continue;
    for (const j of [i + 3, i + 3 * W]) for (let c = 0; c < 3; c++) { const dR = Rb[j * 3 + c] - Rb[i * 3 + c], dS = Sb[j * 3 + c] - Sb[i * 3 + c]; eRS += dR * dS; eSS += dS * dS; }
  }
  const through = eRS / Math.max(1, eSS) / (1 - alpha);
  const wm = wsum.map((v) => v / n), sat = (Math.max(...wm) - Math.min(...wm)) / Math.max(1, Math.max(...wm));
  if (sat < SAT_MIN) { log(`  skipped a ${n}px patch at ${Math.round(sx / n)},${Math.round(sy / n)} (grey / white, not a coloured area)`); return []; }
  if (!(ncc > 0.25) || !(through > 0.5 && through < 1.4)) { log(`  skipped a ${n}px patch at ${Math.round(sx / n)},${Math.round(sy / n)} (not a see-through tint over the picture)`); return []; }
  return [{ ...a, n, cx: sx / n, cy: sy / n, box: [x0, y0, x1, y1], wash: wsum.map((v) => v / n) }];
});
log(`${areas.length} areas`);

// ---------------------------------------------------------------- 4. outlines + names
const DIRS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
function simplify(pts, eps) {
  if (pts.length < 3) return pts;
  const [A, B] = [pts[0], pts[pts.length - 1]], L = Math.hypot(B[0] - A[0], B[1] - A[1]) || 1;
  let dmax = 0, idx = 0;
  for (let i = 1; i < pts.length - 1; i++) { const d = Math.abs((B[0] - A[0]) * (A[1] - pts[i][1]) - (A[0] - pts[i][0]) * (B[1] - A[1])) / L; if (d > dmax) { dmax = d; idx = i; } }
  return dmax > eps ? [...simplify(pts.slice(0, idx + 1), eps).slice(0, -1), ...simplify(pts.slice(idx), eps)] : [A, B];
}
function traceLoop(m, eps) {
  let first = -1;
  for (let i = 0; i < N; i++) if (m[i]) { first = i; break; }
  if (first < 0) return null;
  const pts = [];
  let cur = first, d = 6, guard = 0;
  do {
    pts.push([cur % W, (cur / W) | 0]);
    let found = false;
    for (let t = 0; t < 8; t++) {
      const nd = (d + 6 + t) % 8, nx = (cur % W) + DIRS[nd][0], ny = ((cur / W) | 0) + DIRS[nd][1];
      if (nx >= 0 && ny >= 0 && nx < W && ny < H && m[ny * W + nx]) { cur = ny * W + nx; d = nd; found = true; break; }
    }
    if (!found) break;
  } while (cur !== first && ++guard < 1e6);
  if (pts.length < 3) return null;
  let far = 0;
  for (let i = 1; i < pts.length; i++) if (Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]) > Math.hypot(pts[far][0] - pts[0][0], pts[far][1] - pts[0][1])) far = i;
  return [...simplify(pts.slice(0, far + 1), eps).slice(0, -1), ...simplify([...pts.slice(far), pts[0]], eps).slice(0, -1)];
}

/** Light, unsaturated pixels inside the area = its written name; OCR them. */
const worker = await createWorker("eng", 1, { langPath: ROOT, cacheMethod: "none", gzip: false, logger: () => {}, errorHandler: () => {} });
await worker.setParameters({ tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz ", tessedit_pageseg_mode: "7", user_defined_dpi: "300" });
async function nameOf(a) {
  const [x0, y0, x1, y1] = a.box, w = x1 - x0 + 1, h = y1 - y0 + 1;
  // text = clearly lighter than the wash over the picture there, and nearly grey
  const t = new Uint8Array(w * h);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = y * W + x;
    if (!a.m[i] || !valid[i]) continue;
    const r = R[i * 3], g = R[i * 3 + 1], b = R[i * 3 + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    let lift = 0;
    for (let c = 0; c < 3; c++) lift += R[i * 3 + c] - ((1 - alpha) * Sb[i * 3 + c] + alpha * a.wash[c]);
    if (mn > 165 && mx - mn < 50 && lift / 3 > 35) t[(y - y0) * w + (x - x0)] = 1;
  }
  // letters: small marks of a similar height sitting in a row with others
  const marks = [], lab = new Int32Array(w * h).fill(-1);
  {
    const st = [];
    for (let s0 = 0; s0 < w * h; s0++) {
      if (!t[s0] || lab[s0] >= 0) continue;
      let bx0 = w, by0 = h, bx1 = 0, by1 = 0, n = 0;
      lab[s0] = marks.length; st.push(s0);
      while (st.length) {
        const j = st.pop(), x = j % w, y = (j / w) | 0; n++;
        if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const k = yy * w + xx;
          if (t[k] && lab[k] < 0) { lab[k] = marks.length; st.push(k); }
        }
      }
      marks.push({ id: marks.length, x0: bx0, y0: by0, x1: bx1, y1: by1, n, h: by1 - by0 + 1, cy: (by0 + by1) / 2, cx: (bx0 + bx1) / 2 });
    }
  }
  const letters = marks.filter((m) => m.h >= 5 && m.h <= 30 && m.x1 - m.x0 < 30 && m.n >= 4);
  const near = (p, q) => Math.abs(p.cy - q.cy) < Math.max(p.h, q.h) * 0.5 && Math.abs(p.cx - q.cx) < Math.max(p.h, q.h) * 2.2 && p.h / q.h > 0.6 && p.h / q.h < 1.6;
  // rows of letters (chained neighbours), 3+ letters each
  const rowOf = letters.map((_, i) => i);
  const root = (i) => (rowOf[i] === i ? i : (rowOf[i] = root(rowOf[i])));
  for (let i = 0; i < letters.length; i++) for (let j = i + 1; j < letters.length; j++) if (near(letters[i], letters[j])) rowOf[root(j)] = root(i);
  const rows = new Map();
  letters.forEach((m, i) => rows.set(root(i), [...(rows.get(root(i)) ?? []), m]));
  let best = null;
  for (const row of rows.values()) {
    if (row.length < 3) continue;
    const pad = 6;
    const rx0 = Math.max(0, Math.min(...row.map((m) => m.x0)) - pad), ry0 = Math.max(0, Math.min(...row.map((m) => m.y0)) - pad);
    const rx1 = Math.min(w - 1, Math.max(...row.map((m) => m.x1)) + pad), ry1 = Math.min(h - 1, Math.max(...row.map((m) => m.y1)) + pad);
    const rw = rx1 - rx0 + 1, rh = ry1 - ry0 + 1;
    const ids = new Set(row.map((m) => m.id)); // only the letters, not lines crossing them
    // Two readings: the clean letter mask, and the original grey levels around
    // the letters (keeps the detail of small lettering); the better one wins.
    const sharpMask = Buffer.alloc(rw * rh, 255);
    const near = new Uint8Array(rw * rh);
    for (let y = ry0; y <= ry1; y++) for (let x = rx0; x <= rx1; x++) {
      if (!ids.has(lab[y * w + x])) continue;
      sharpMask[(y - ry0) * rw + (x - rx0)] = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const yy = y - ry0 + dy, xx = x - rx0 + dx;
        if (yy >= 0 && xx >= 0 && yy < rh && xx < rw) near[yy * rw + xx] = 1;
      }
    }
    const lums = [], inside = [];
    for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
      const v = Rg[(y0 + ry0 + y) * W + x0 + rx0 + x];
      (sharpMask[y * rw + x] === 0 ? inside : lums).push(v);
    }
    lums.sort((p, q) => p - q);
    inside.sort((p, q) => p - q);
    const lo = lums[Math.floor(lums.length / 2)] ?? 0, hi = inside[Math.floor(inside.length * 0.9)] ?? 255;
    const grey = Buffer.alloc(rw * rh, 255);
    for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
      if (!near[y * rw + x]) continue;
      const v = Rg[(y0 + ry0 + y) * W + x0 + rx0 + x];
      grey[y * rw + x] = Math.max(0, Math.min(255, Math.round(255 - ((v - lo) / Math.max(1, hi - lo)) * 255)));
    }
    const readings = [
      await sharp(sharpMask, { raw: { width: rw, height: rh, channels: 1 } }).resize(rw * 4, rh * 4, { kernel: "cubic" }).blur(1.6).threshold(200),
      await sharp(grey, { raw: { width: rw, height: rh, channels: 1 } }).resize(rw * 6, rh * 6, { kernel: "lanczos3" }).blur(1),
    ];
    for (const pipeline of readings) {
      const png = await pipeline.extend({ top: 20, bottom: 20, left: 20, right: 20, background: "#ffffff" }).png().toBuffer();
      const { data } = await worker.recognize(png);
      const text = data.text.replace(/[^A-Za-z]/g, "");
      const words = data.words ?? data.blocks?.flatMap((bl) => bl.paragraphs.flatMap((p) => p.lines.flatMap((l) => l.words))) ?? [];
      const conf = words.length ? Math.min(...words.map((wd) => wd.confidence)) : data.confidence;
      const clean = /^([A-Z]{4,}|[A-Z][a-z]{3,})$/.test(text);
      if (text.length >= 3 && (conf > 60 || clean) && (!best || text.length * conf > best.score)) best = { text, score: text.length * conf };
    }
  }
  return best ? best.text[0].toUpperCase() + best.text.slice(1).toLowerCase() : null;
}

/** The area's colour: its wash, as hex. */
const hex = (rgb) => `#${rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;

// reading order: top to bottom in bands, left to right
const band = H / 6;
areas.sort((p, q) => Math.floor(p.cy / band) - Math.floor(q.cy / band) || p.cx - q.cx);
const used = new Set();
const shapes = [];
for (const [n, a] of areas.entries()) {
  const loop = traceLoop(a.m, Math.max(1.2, W / 1000));
  if (!loop || loop.length < 3) continue;
  let name = await nameOf(a).catch(() => null);
  let id = name ? name.toLowerCase().replace(/[^a-z0-9]+/g, "-") : `area-${n + 1}`;
  if (used.has(id)) { name = null; id = `area-${n + 1}`; }
  used.add(id);
  shapes.push({
    id,
    label: name ?? `Area ${n + 1}`,
    kind: "polygon",
    color: hex(a.wash),
    points: loop.map(([x, y]) => applyAffine(T, [((x + 0.5) / W) * 100, ((y + 0.5) / H) * 100]).map((v) => Math.round(v * 100) / 100)),
  });
  log(`  ${shapes.at(-1).label}: ${loop.length} corners, ${((a.n / N) * 100).toFixed(1)}% of the reference`);
}
await worker.terminate();

if (preview) {
  const img = sharp(pub(scene.image));
  const { width: w, height: h } = await img.metadata();
  const px = ([x, y]) => `${(x / 100) * w},${(y / 100) * h}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${shapes
    .map((s) => {
      const c = s.points.reduce((acc, q) => [acc[0] + q[0] / s.points.length, acc[1] + q[1] / s.points.length], [0, 0]);
      return `<polygon points="${s.points.map(px).join(" ")}" fill="${s.color}" fill-opacity="0.45" stroke="${s.color}" stroke-width="2"/><text x="${(c[0] / 100) * w}" y="${(c[1] / 100) * h}" font-size="18" font-family="sans-serif" text-anchor="middle" fill="#fff" stroke="#000" stroke-width="3" paint-order="stroke">${s.label}</text>`;
    })
    .join("")}</svg>`;
  await img.composite([{ input: Buffer.from(svg) }]).jpeg({ quality: 85 }).toFile(path.resolve(preview));
  log(`preview: ${path.resolve(preview)}`);
}
if (out) await writeFile(out, JSON.stringify({ ...(placed.changed ? { transform: T } : {}), shapes }));
else console.log(JSON.stringify(shapes.map((s) => s.label)));
