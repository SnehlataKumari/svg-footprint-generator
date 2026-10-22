#!/usr/bin/env node
/**
 * Amenity icons from the reference image — for a reference with small round
 * badges marking amenities (a dark disc with a coloured symbol: park, cycling,
 * dining, school…), already placed on the scene (Place reference… → Auto-align).
 *
 *   node scripts/amenities-from-reference.mjs <sceneId> [--preview out.jpg]
 *   node scripts/amenities-from-reference.mjs --scene-file scene.json --out result.json   (the editor's Generate button)
 *
 *   1. finds the badges: discs of dark, neutral grey with lighter ground
 *      around them (overlapping badges are separated, big dark panels and
 *      buttons are not discs, so they drop out);
 *   2. groups them by their symbol: same shape (overlap of the symbol masks)
 *      and same colour = one amenity type;
 *   3. saves each type's badge as a round PNG in public/scenes/icons/ — the
 *      type's icon until you replace it with your own;
 *   4. returns one pin per badge, in a category per type (the category holds
 *      the icon, so changing it once changes every pin of that type).
 * Writes nothing to data/project.json.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { refinePlacement } from "./lib/placement.mjs";

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
// fine-tune the placement first: tracing compares the two pictures closely
const placed = await refinePlacement(pub(scene.image), pub(scene.trace.image), scene.trace.transform);
const T = placed.T;
log(placed.changed ? `Placement fine-tuned (match ${placed.before.toFixed(2)} → ${placed.after.toFixed(2)})` : `Placement kept (match ${placed.after.toFixed(2)})`);

// ---------------------------------------------------------------- 1. badges
const refMeta = await sharp(pub(scene.trace.image)).metadata();
const W = Math.min(2400, refMeta.width), H = Math.round((refMeta.height * W) / refMeta.width), N = W * H;
const R = await sharp(pub(scene.trace.image)).resize(W, H, { fit: "fill" }).removeAlpha().raw().toBuffer();
log(`Reference ${W}×${H}`);

// dark, neutral grey: the badge's disc
const D = new Uint8Array(N);
for (let i = 0; i < N; i++) {
  const r = R[i * 3], g = R[i * 3 + 1], b = R[i * 3 + 2], mx = Math.max(r, g, b);
  D[i] = mx < 80 && mx - Math.min(r, g, b) < 22 ? 1 : 0;
}
// integral image of D, for quick box densities
const I = new Float64Array((W + 1) * (H + 1));
for (let y = 0; y < H; y++) { let row = 0; for (let x = 0; x < W; x++) { row += D[y * W + x]; I[(y + 1) * (W + 1) + x + 1] = I[y * (W + 1) + x + 1] + row; } }
const boxSum = (x0, y0, x1, y1) => {
  x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(W - 1, x1); y1 = Math.min(H - 1, y1);
  if (x1 < x0 || y1 < y0) return 0;
  return I[(y1 + 1) * (W + 1) + x1 + 1] - I[y0 * (W + 1) + x1 + 1] - I[(y1 + 1) * (W + 1) + x0] + I[y0 * (W + 1) + x0];
};
// ring samples, precomputed per radius
const RADII = [];
for (let r = 6; r <= Math.max(16, Math.round(W / 60)); r++) RADII.push(r);
const ring = (r0, r1) => { const pts = []; for (let dy = -Math.ceil(r1); dy <= Math.ceil(r1); dy++) for (let dx = -Math.ceil(r1); dx <= Math.ceil(r1); dx++) { const d = Math.hypot(dx, dy); if (d >= r0 && d <= r1) pts.push([dx, dy]); } return pts; };
const RINGS = RADII.map((r) => ({ r, inner: ring(0.72 * r, r), outer: ring(1.25 * r, 1.5 * r) }));
const frac = (x, y, pts) => { let n = 0, d = 0; for (const [dx, dy] of pts) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue; n++; d += D[yy * W + xx]; } return n ? d / n : 0; };

const cands = [];
for (let y = 6; y < H - 6; y++) for (let x = 6; x < W - 6; x++) {
  if (boxSum(x - 8, y - 8, x + 8, y + 8) < 289 * 0.3) continue; // enough dark around here (a big symbol fills the middle)
  let best = null;
  for (const g of RINGS) {
    const inF = frac(x, y, g.inner);
    if (inF < 0.8) continue;
    const outF = frac(x, y, g.outer);
    if (outF > 0.45) continue;
    const score = inF - outF + g.r * 0.004; // the largest ring that still fits wins ties
    if (!best || score > best.score) best = { x, y, r: g.r, score };
  }
  if (best) cands.push(best);
}
cands.sort((a, b) => b.score - a.score);
let badges = [];
for (const c of cands) if (badges.every((b) => Math.hypot(b.x - c.x, b.y - c.y) > 1.2 * Math.max(b.r, c.r))) badges.push(c);
// the real radius: grow while the next ring out is still mostly disc
badges = badges.map((b) => {
  let r = b.r;
  while (r < b.r * 1.6 && frac(b.x, b.y, ring(r, r + 1)) > 0.55) r++;
  return { ...b, r };
});
// one badge size per map: drop odd sizes (a round dark roof, a dot of text)
const radii = badges.map((b) => b.r).sort((a, b) => a - b);
const typical = radii[Math.floor(radii.length / 2)] ?? 0;
badges = badges.filter((b) => Math.abs(b.r - typical) <= Math.max(2, typical * 0.3));

// ---------------------------------------------------------------- 2. symbols → types
const G = 24;
const lum = (i) => 0.299 * R[i * 3] + 0.587 * R[i * 3 + 1] + 0.114 * R[i * 3 + 2];
function symbolOf(b) {
  // the symbol = clearly lighter or more colourful than the disc, inside the badge
  const disc = [];
  for (const [dx, dy] of ring(0.75 * b.r, 0.95 * b.r)) { const i = (b.y + dy) * W + b.x + dx; if (D[i]) disc.push(lum(i)); }
  disc.sort((p, q) => p - q);
  const discLum = disc[Math.floor(disc.length / 2)] ?? 45;
  const mask = new Float32Array(G * G), col = [0, 0, 0];
  let n = 0;
  for (let gy = 0; gy < G; gy++) for (let gx = 0; gx < G; gx++) {
    const ox = ((gx + 0.5) / G * 2 - 1) * b.r, oy = ((gy + 0.5) / G * 2 - 1) * b.r;
    if (Math.hypot(ox, oy) > 0.8 * b.r) continue;
    const x = Math.round(b.x + ox), y = Math.round(b.y + oy), i = y * W + x;
    const r = R[i * 3], g = R[i * 3 + 1], bl = R[i * 3 + 2], mx = Math.max(r, g, bl);
    const colourful = mx > 60 && (mx - Math.min(r, g, bl)) / mx > 0.35;
    if (!(lum(i) - discLum > 30 || colourful)) continue;
    mask[gy * G + gx] = 1;
    for (let c = 0; c < 3; c++) col[c] += R[i * 3 + c];
    n++;
  }
  return { mask, n, color: col.map((v) => v / Math.max(1, n)) };
}
const iou = (a, b) => {
  let best = 0;
  for (let sy = -1; sy <= 1; sy++) for (let sx = -1; sx <= 1; sx++) {
    let inter = 0, uni = 0;
    for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) {
      const p = a[y * G + x], yy = y + sy, xx = x + sx;
      const q = yy >= 0 && xx >= 0 && yy < G && xx < G ? b[yy * G + xx] : 0;
      inter += Math.min(p, q); uni += Math.max(p, q);
    }
    best = Math.max(best, uni ? inter / uni : 0);
  }
  return best;
};
badges = badges.map((b) => ({ ...b, sym: symbolOf(b) })).filter((b) => b.sym.n >= G * G * 0.04); // a plain dark dot is no amenity
// symbol colours compared by hue + saturation (brightness weighted down)
const chroma = ([r, g, b]) => { const s = r + g + b + 1; return [(r / s) * 600, (g / s) * 600, (b / s) * 600, s / 12]; };
const tintDist = (p, q) => Math.hypot(...chroma(p).map((v, c) => v - chroma(q)[c]));
const types = [];
for (const b of badges) {
  const t = types.find((t) => iou(t.rep.sym.mask, b.sym.mask) > 0.55 && tintDist(t.rep.sym.color, b.sym.color) < 40);
  if (t) t.badges.push(b);
  else types.push({ rep: b, badges: [b] });
}
types.sort((a, b) => b.badges.length - a.badges.length);
log(`${badges.length} badges (about ${typical * 2}px across) · ${types.length} types`);

// ---------------------------------------------------------------- 3. names, icons
const hsv = ([r, g, b]) => {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, mx ? d / mx : 0, mx / 255];
};
const colourName = (rgb) => {
  const [h, s, v] = hsv(rgb);
  if (s < 0.2) return v > 0.7 ? "White" : "Grey";
  return [[15, "Red"], [35, "Orange"], [50, "Beige"], [70, "Yellow"], [160, "Green"], [200, "Teal"], [255, "Blue"], [290, "Purple"], [335, "Pink"], [361, "Red"]].find(([lim]) => h < lim)[1];
};
const hex = (rgb) => `#${rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;
const counts = {};
for (const t of types) counts[colourName(t.rep.sym.color)] = (counts[colourName(t.rep.sym.color)] ?? 0) + 1;
const seen = {};
const iconDir = path.join(ROOT, "public", "scenes", "icons");
await mkdir(iconDir, { recursive: true });
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const categories = [];
const shapes = [];
for (const t of types) {
  const name = colourName(t.rep.sym.color);
  seen[name] = (seen[name] ?? 0) + 1;
  const label = `${name} amenity${counts[name] > 1 ? ` ${seen[name]}` : ""}`;
  const id = `amenity-${slug(label.replace(/ amenity/, ""))}`;
  // the clearest badge of the type (highest score) as its icon: round, 4× up
  const b = t.badges.reduce((p, q) => (q.score > p.score ? q : p));
  const r = b.r + 1, size = 2 * r + 1, scale = 4;
  const crop = await sharp(R, { raw: { width: W, height: H, channels: 3 } })
    .extract({ left: Math.max(0, b.x - r), top: Math.max(0, b.y - r), width: Math.min(size, W - Math.max(0, b.x - r)), height: Math.min(size, H - Math.max(0, b.y - r)) })
    .resize(size * scale, size * scale, { kernel: "lanczos3" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const px = crop.info.width, py = crop.info.height, rgba = Buffer.alloc(px * py * 4);
  for (let y = 0; y < py; y++) for (let x = 0; x < px; x++) {
    const i = y * px + x, d = Math.hypot(x + 0.5 - px / 2, y + 0.5 - py / 2) / ((b.r + 0.3) * scale); // 1 = the badge's edge
    for (let c = 0; c < 3; c++) rgba[i * 4 + c] = crop.data[i * 3 + c];
    rgba[i * 4 + 3] = Math.round(255 * Math.max(0, Math.min(1, (1 - d) * b.r * scale * 0.5))); // soft round edge
  }
  const file = `${slug(scene.id)}-${id}.png`;
  await sharp(rgba, { raw: { width: px, height: py, channels: 4 } }).png().toFile(path.join(iconDir, file));
  categories.push({ id, label, color: hex(t.rep.sym.color), icon: `/scenes/icons/${file}` });
  t.badges
    .sort((p, q) => p.y - q.y || p.x - q.x)
    .forEach((bd, n) => {
      const [X, Y] = applyAffine(T, [((bd.x + 0.5) / W) * 100, ((bd.y + 0.5) / H) * 100]);
      shapes.push({ id: `${id}-${n + 1}`, label, kind: "pin", category: id, points: [[Math.round(X * 100) / 100, Math.round(Y * 100) / 100]] });
    });
  log(`  ${label}: ${t.badges.length} × (${hex(t.rep.sym.color)}) → ${file}`);
}

if (preview) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${types
    .map((t, k) => t.badges.map((b) => `<circle cx="${b.x}" cy="${b.y}" r="${b.r + 3}" fill="none" stroke="${categories[k].color}" stroke-width="2"/><text x="${b.x + b.r + 4}" y="${b.y + 4}" font-size="11" font-family="sans-serif" fill="#fff" stroke="#000" stroke-width="2.5" paint-order="stroke">${k + 1}</text>`).join(""))
    .join("")}</svg>`;
  await sharp(R, { raw: { width: W, height: H, channels: 3 } }).composite([{ input: Buffer.from(svg) }]).jpeg({ quality: 90 }).toFile(path.resolve(preview));
  log(`preview: ${path.resolve(preview)}`);
}
if (out) await writeFile(out, JSON.stringify({ ...(placed.changed ? { transform: T } : {}), shapes, categories }));
else console.log(JSON.stringify(categories.map((c) => `${c.label} (${shapes.filter((s) => s.category === c.id).length})`)));
