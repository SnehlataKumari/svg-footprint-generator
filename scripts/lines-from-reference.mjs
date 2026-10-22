#!/usr/bin/env node
/**
 * Coloured lines from the reference image — for a reference that is YOUR
 * picture with routes drawn on top in bright colours (metro / bus lines,
 * roads, cycle paths; solid or dashed), already placed on the scene
 * (Place reference… → Auto-align).
 *
 *   node scripts/lines-from-reference.mjs <sceneId> [--preview out.jpg]
 *   node scripts/lines-from-reference.mjs --scene-file scene.json --out result.json   (the editor's Generate button)
 *
 *   1. warps your picture into the reference's pixels; a pixel belongs to a
 *      drawn line when it is vivid in the reference and clearly different from
 *      your picture there (so the sea, parks and white labels drop out);
 *   2. groups those pixels by hue — one group per line colour;
 *   3. per colour: bridges the gaps of dashed lines, thins the result to a
 *      one-pixel centre line, and follows it end to end (longest path first,
 *      then long branches), dropping station dots and short spurs;
 *   4. measures how much of each path is actually painted: well under 100%
 *      means dashed.
 * Writes nothing to data/project.json: prints a summary, or writes
 * { shapes } (kind "line", with colour and dash style) to --out.
 */
import { readFile, writeFile } from "node:fs/promises";
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

// ---------------------------------------------------------------- 1. line pixels
const refMeta = await sharp(pub(scene.trace.image)).metadata();
const W = Math.min(1800, refMeta.width), H = Math.round((refMeta.height * W) / refMeta.width), N = W * H;
const rgb = (file, w, h) => sharp(file).resize(w, h, { fit: "fill" }).removeAlpha().raw().toBuffer();
const R = await rgb(pub(scene.trace.image), W, H);
const sMeta = await sharp(pub(scene.image)).metadata();
const SW = Math.min(2400, sMeta.width), SH = Math.round((sMeta.height * SW) / sMeta.width);
const S = await rgb(pub(scene.image), SW, SH);
// fine-tune the placement first: tracing compares the two pictures closely
const placed = await refinePlacement(pub(scene.image), pub(scene.trace.image), scene.trace.transform);
const T = placed.T;
log(placed.changed ? `Placement fine-tuned (match ${placed.before.toFixed(2)} → ${placed.after.toFixed(2)})` : `Placement kept (match ${placed.after.toFixed(2)})`);
log(`Reference ${W}×${H}, your image ${SW}×${SH}`);

const hsv = (r, g, b) => {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, mx ? d / mx : 0, mx / 255];
};
const HUE = new Float32Array(N);
const line = new Uint8Array(N);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = y * W + x;
  const [X, Y] = applyAffine(T, [((x + 0.5) / W) * 100, ((y + 0.5) / H) * 100]);
  const sx = Math.round((X / 100) * SW - 0.5), sy = Math.round((Y / 100) * SH - 0.5);
  if (sx < 0 || sy < 0 || sx >= SW || sy >= SH) continue;
  const r = R[i * 3], g = R[i * 3 + 1], b = R[i * 3 + 2];
  const [h, s, v] = hsv(r, g, b);
  // compare with the picture around that spot (a few px of misalignment)
  let near = Infinity;
  for (let dy = -2; dy <= 2; dy += 2) for (let dx = -2; dx <= 2; dx += 2) {
    const xx = Math.min(SW - 1, Math.max(0, sx + dx)), yy = Math.min(SH - 1, Math.max(0, sy + dy)), si = (yy * SW + xx) * 3;
    near = Math.min(near, Math.abs(r - S[si]) + Math.abs(g - S[si + 1]) + Math.abs(b - S[si + 2]));
  }
  if (s > 0.45 && v > 0.3 && near > 90) { line[i] = 1; HUE[i] = h; }
}

// ---------------------------------------------------------------- 2. colours
// hue histogram (saturation-weighted), smoothed; each clear peak is one line colour
const hist = new Float32Array(360);
let total = 0;
for (let i = 0; i < N; i++) if (line[i]) { hist[Math.floor(HUE[i]) % 360]++; total++; }
const smooth = hist.map((_, h) => { let s = 0; for (let d = -6; d <= 6; d++) s += hist[(h + d + 360) % 360] * (1 - Math.abs(d) / 7); return s; });
const peaks = [];
for (let h = 0; h < 360; h++) {
  const v = smooth[h];
  let isPeak = v > 0;
  for (let d = -15; d <= 15 && isPeak; d++) if (d && smooth[(h + d + 360) % 360] > v) isPeak = false;
  if (isPeak && v > total * 0.01 && !peaks.some((p) => Math.min(Math.abs(p - h), 360 - Math.abs(p - h)) < 15)) peaks.push(h);
}
const hueDist = (a, b) => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); };
log(`Line pixels: ${total} · colours at hue ${peaks.join("°, ")}°`);

// ---------------------------------------------------------------- raster helpers
function dilate(src, r) {
  const tmp = new Uint8Array(N), o = new Uint8Array(N);
  for (let y = 0; y < H; y++) { let c = 0; const row = y * W;
    for (let x = -r; x < W; x++) { if (x + r < W) c += src[row + x + r]; if (x - r - 1 >= 0) c -= src[row + x - r - 1]; if (x >= 0) tmp[row + x] = +(c > 0); } }
  for (let x = 0; x < W; x++) { let c = 0;
    for (let y = -r; y < H; y++) { if (y + r < H) c += tmp[(y + r) * W + x]; if (y - r - 1 >= 0) c -= tmp[(y - r - 1) * W + x]; if (y >= 0) o[y * W + x] = +(c > 0); } }
  return o;
}
/** 8-connected components; returns labels and sizes. */
function components(m) {
  const lab = new Int32Array(N).fill(-1), sizes = [], st = [];
  for (let i = 0; i < N; i++) {
    if (!m[i] || lab[i] >= 0) continue;
    let n = 0; st.push(i); lab[i] = sizes.length;
    while (st.length) {
      const j = st.pop(), x = j % W, y = (j / W) | 0; n++;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if ((dx || dy) && xx >= 0 && yy >= 0 && xx < W && yy < H) { const k = yy * W + xx; if (m[k] && lab[k] < 0) { lab[k] = sizes.length; st.push(k); } }
      }
    }
    sizes.push(n);
  }
  return { lab, sizes };
}
/** Zhang–Suen thinning. */
function thin(m) {
  const s = m.slice();
  const nb = (i) => { const x = i % W; return [i - W, i - W + 1, i + 1, i + W + 1, i + W, i + W - 1, i - 1, i - W - 1].map((j, k) => {
    const jx = x + [0, 1, 1, 1, 0, -1, -1, -1][k];
    return j >= 0 && j < N && jx >= 0 && jx < W ? s[j] : 0;
  }); };
  let pixels = [];
  for (let i = 0; i < N; i++) if (s[i]) pixels.push(i);
  for (let changed = true; changed;) {
    changed = false;
    for (const pass of [0, 1]) {
      const del = [];
      for (const i of pixels) {
        if (!s[i]) continue;
        const p = nb(i), b = p.reduce((a, v) => a + v, 0);
        if (b < 2 || b > 6) continue;
        let a = 0;
        for (let k = 0; k < 8; k++) if (!p[k] && p[(k + 1) % 8]) a++;
        if (a !== 1) continue;
        if (pass === 0 ? p[0] * p[2] * p[4] || p[2] * p[4] * p[6] : p[0] * p[2] * p[6] || p[0] * p[4] * p[6]) continue;
        del.push(i);
      }
      for (const i of del) s[i] = 0;
      if (del.length) changed = true;
    }
    pixels = pixels.filter((i) => s[i]);
  }
  return s;
}
const N8 = (i) => { const x = i % W, y = (i / W) | 0, r = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if ((dx || dy) && xx >= 0 && yy >= 0 && xx < W && yy < H) r.push(yy * W + xx); }
  return r; };
/** Farthest skeleton pixel from `from` (BFS on the skeleton), with parents. */
function bfs(sk, from) {
  const dist = new Map([[from, 0]]), parent = new Map(), q = [from];
  let far = from;
  for (let h = 0; h < q.length; h++) {
    const i = q[h];
    for (const j of N8(i)) if (sk[j] && !dist.has(j)) { dist.set(j, dist.get(i) + 1); parent.set(j, i); q.push(j); if (dist.get(j) > dist.get(far)) far = j; }
  }
  return { far, parent, dist };
}
function simplify(pts, eps) {
  if (pts.length < 3) return pts;
  const [A, B] = [pts[0], pts[pts.length - 1]], L = Math.hypot(B[0] - A[0], B[1] - A[1]) || 1;
  let dmax = 0, idx = 0;
  for (let i = 1; i < pts.length - 1; i++) { const d = Math.abs((B[0] - A[0]) * (A[1] - pts[i][1]) - (A[0] - pts[i][0]) * (B[1] - A[1])) / L; if (d > dmax) { dmax = d; idx = i; } }
  return dmax > eps ? [...simplify(pts.slice(0, idx + 1), eps).slice(0, -1), ...simplify(pts.slice(idx), eps)] : [A, B];
}

// ---------------------------------------------------------------- 3. per colour: paths
const GAP = Math.max(4, Math.round(W / 140)); // bridges dash gaps
const MIN_LEN = Math.max(40, Math.round(W / 25)); // shorter = a station dot, an icon, a spur
const NAMES = [[15, "Red"], [40, "Orange"], [65, "Yellow"], [150, "Green"], [190, "Teal"], [235, "Blue"], [285, "Purple"], [335, "Pink"], [360, "Red"]];
const hueName = (h) => NAMES.find(([lim]) => h < lim)[1];
const hex = (rgb) => `#${rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;

const shapes = [];
for (const peak of peaks) {
  const m = new Uint8Array(N);
  let col = [0, 0, 0], n = 0;
  for (let i = 0; i < N; i++) if (line[i] && hueDist(HUE[i], peak) < 20) { m[i] = 1; for (let c = 0; c < 3; c++) col[c] += R[i * 3 + c]; n++; }
  col = col.map((v) => v / Math.max(1, n));
  // drop specks, join dashes, thin to centre lines
  const { lab, sizes } = components(m);
  for (let i = 0; i < N; i++) if (m[i] && sizes[lab[i]] < 6) m[i] = 0;
  const joined = dilate(m, GAP);
  let sk = thin(joined);
  const painted = dilate(m, 2);
  const name = hueName(peak);
  const paths = [];
  for (;;) {
    // longest remaining path on any skeleton piece
    const { lab: skl, sizes: sks } = components(sk);
    let best = null;
    for (let c = 0; c < sks.length; c++) {
      if (sks[c] < MIN_LEN) continue;
      const start = skl.indexOf(c);
      const a = bfs(sk, start).far;
      const { far: b, parent, dist } = bfs(sk, a);
      if (dist.get(b) >= MIN_LEN && (!best || dist.get(b) > best.len)) best = { a, b, parent, len: dist.get(b) };
    }
    if (!best) break;
    const pix = [];
    for (let i = best.b; i !== undefined; i = best.parent.get(i)) pix.push(i);
    // remove this path (and a band around it) so the next pass finds branches
    const band = new Uint8Array(N);
    for (const i of pix) band[i] = 1;
    const wide = dilate(band, GAP + 2);
    for (let i = 0; i < N; i++) if (wide[i]) sk[i] = 0;
    paths.push(pix);
  }
  // one route broken by a station marker or a label: join pieces whose ends meet
  const JOIN = GAP * 5;
  const xy = (i) => [i % W, (i / W) | 0];
  const gapOf = (p, q) => Math.hypot(xy(p)[0] - xy(q)[0], xy(p)[1] - xy(q)[1]);
  for (let joined = true; joined;) {
    joined = false;
    let best = null;
    for (let a = 0; a < paths.length; a++) for (let b = a + 1; b < paths.length; b++) {
      const A = paths[a], B = paths[b];
      for (const [ea, eb, d] of [[0, 0], [0, 1], [1, 0], [1, 1]].map(([u, v]) => [u, v, gapOf(u ? A.at(-1) : A[0], v ? B.at(-1) : B[0])])) {
        if (d < JOIN && (!best || d < best.d)) best = { a, b, ea, eb, d };
      }
    }
    if (best) {
      let A = paths[best.a], B = paths[best.b];
      if (!best.ea) A = A.slice().reverse(); // A now ends at the joining end
      if (best.eb) B = B.slice().reverse(); // B now starts at it
      paths[best.a] = [...A, ...B];
      paths.splice(best.b, 1);
      joined = true;
    }
  }
  paths.sort((p, q) => q.length - p.length);
  paths.forEach((pix, n) => {
    const k = n + 1;
    const coverage = pix.filter((i) => painted[i]).length / pix.length;
    const dashed = coverage < 0.85;
    const pts = simplify(pix.map(xy), 1.5);
    shapes.push({
      id: `${name.toLowerCase()}-line${k > 1 ? `-${k}` : ""}`,
      label: `${name} line${k > 1 ? ` ${k}` : ""}`,
      kind: "line",
      color: hex(col),
      ...(dashed ? { style: { dash: "8 6" } } : {}),
      points: pts.map(([x, y]) => applyAffine(T, [((x + 0.5) / W) * 100, ((y + 0.5) / H) * 100]).map((v) => Math.round(v * 100) / 100)),
    });
    log(`  ${shapes.at(-1).label}: ${pix.length}px long, ${pts.length} points, ${dashed ? "dashed" : "solid"} (${Math.round(coverage * 100)}% painted)`);
  });
}

if (preview) {
  const img = sharp(pub(scene.image));
  const { width: w, height: h } = await img.metadata();
  const px = ([x, y]) => `${(x / 100) * w},${(y / 100) * h}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${shapes
    .map((s) => `<polyline points="${s.points.map(px).join(" ")}" fill="none" stroke="${s.color}" stroke-width="5" ${s.style?.dash ? `stroke-dasharray="${s.style.dash.split(" ").map((v) => v * 2).join(" ")}"` : ""}/><text x="${px(s.points[0]).split(",")[0]}" y="${px(s.points[0]).split(",")[1]}" font-size="22" font-family="sans-serif" fill="#fff" stroke="#000" stroke-width="3" paint-order="stroke">${s.label}</text>`)
    .join("")}</svg>`;
  await img.composite([{ input: Buffer.from(svg) }]).jpeg({ quality: 85 }).toFile(path.resolve(preview));
  log(`preview: ${path.resolve(preview)}`);
}
if (out) await writeFile(out, JSON.stringify({ ...(placed.changed ? { transform: T } : {}), shapes }));
else console.log(JSON.stringify(shapes.map((s) => s.label)));
