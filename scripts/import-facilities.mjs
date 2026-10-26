#!/usr/bin/env node
/**
 * Facilities from a spreadsheet + its GIS map → a new project: the masterplan
 * as the main scene, one scene per phase, and every facility outlined, named,
 * filled in with its spreadsheet row and shown with an icon on the masterplan
 * and on its phase.
 *
 *   node scripts/import-facilities.mjs \
 *     --xlsx "Al Metlaa -Community Facilities.xlsx" \
 *     --pdf  "Al Metlaa_Community Facilities_26Feb2026.pdf" \
 *     --masterplan "Al Metlaa Masterplan.webp" \
 *     --phases "Phase without Labels_webp" \
 *     --title "Al Metlaa" [--plots-from data/project.json:mt12] [--out data/projects/al-metlaa.json]
 *
 * What it needs (and why it can be exact):
 * - the spreadsheet: one row per facility — plot ID, type (EN / AR), cluster,
 *   area, parking (the columns are recognised by name);
 * - the map PDF exported from ArcGIS / QGIS as a GeoPDF: facilities filled in
 *   their type's colour, each labelled with its plot ID, phases outlined and
 *   labelled (MT01…); its geo-registration gives every point's real position;
 * - the phase images with their world files (.wpw / .jgw / .pgw …): where each
 *   image lies in the same coordinates;
 * - the masterplan render (no world file): it is located by finding the phase
 *   images in it.
 * Uses poppler's pdftotext / pdftoppm. Writes the project to data/projects/
 * (open it from the editor's Projects menu) and the images to public/scenes/<slug>/.
 *
 * The hosted editor (no poppler, read-only disk) reads the PDF in the browser
 * and passes `--page page.png --words words.json` (the page rendered, and its
 * words: { width, height, words: [{ text, x0, y0, x1, y1 }] } in page points,
 * y down) plus `--no-copy`: images stay where they are and each scene's image
 * is its file name, for the browser to swap for the copy it stores.
 *
 * One scene of an open project (editor: Add facilities from GIS files):
 *   --into <world file> --size <width>x<height> --out result.json
 * instead of --masterplan / --phases: the facilities lying on that image,
 * placed by its world file, as { shapes, categories } — no new project.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";
import sharp from "sharp";
import { refinePlacement } from "./lib/placement.mjs";

sharp.cache(false);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const need = (name) => opt(name) ?? (console.error(`Missing ${name}`), process.exit(1));
const INTO = opt("--into"), SIZE = opt("--size")?.split("x").map(Number);
const XLSX = need("--xlsx"), PDF = need("--pdf"), MASTER = INTO ? null : need("--masterplan"), PHASES = INTO ? null : need("--phases");
const TITLE = opt("--title") ?? "Facilities";
const SLUG = opt("--slug") ?? (TITLE.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "facilities"); // images go to public/scenes/<slug>/
const OUT = path.resolve(opt("--out") ?? path.join(ROOT, "data", "projects", `${SLUG}.json`));
const PLOTS_FROM = opt("--plots-from"); // "<project.json>[:<sceneId>]" — plots to carry into the phase that uses the same image
const PAGE = opt("--page"), WORDS = opt("--words"); // the PDF already read (hosted editor) — no poppler needed
const NO_COPY = args.includes("--no-copy");
const log = (...m) => console.log(...m);
const tmp = mkdtempSync(path.join(tmpdir(), "import-facilities-"));

// ---------------------------------------------------------------- 1. spreadsheet
/** The first sheet of an .xlsx as objects keyed by the header row. */
function readXlsx(file) {
  const zip = readFileSync(file);
  const entries = {};
  let eocd = zip.length - 22;
  while (eocd >= 0 && zip.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  let p = zip.readUInt32LE(eocd + 16);
  for (let n = zip.readUInt16LE(eocd + 10); n > 0; n--) {
    const method = zip.readUInt16LE(p + 10), size = zip.readUInt32LE(p + 20), nameLen = zip.readUInt16LE(p + 28), extra = zip.readUInt16LE(p + 30), comment = zip.readUInt16LE(p + 32), local = zip.readUInt32LE(p + 42);
    const name = zip.toString("utf8", p + 46, p + 46 + nameLen);
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28), raw = zip.subarray(start, start + size);
    entries[name] = method === 8 ? inflateRawSync(raw).toString("utf8") : raw.toString("utf8");
    p += 46 + nameLen + extra + comment;
  }
  const dec = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
  const shared = [...(entries["xl/sharedStrings.xml"] ?? "").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => dec([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")));
  const rows = [];
  for (const r of entries["xl/worksheets/sheet1.xml"].matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = {};
    for (const c of r[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const v = c[3]?.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? c[3]?.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1];
      if (v !== undefined) cells[c[1]] = /t="s"/.test(c[2]) ? shared[+v] : dec(v);
    }
    rows.push(cells);
  }
  const header = rows.shift();
  return rows.map((r) => Object.fromEntries(Object.entries(header).map(([col, name]) => [name.trim(), (r[col] ?? "").trim()])));
}
const rows = readXlsx(XLSX).filter((r) => Object.values(r).some(Boolean));
const pick = (row, ...names) => { for (const n of names) { const k = Object.keys(row).find((key) => key.toLowerCase().replace(/[^a-z]/g, "") === n); if (k && row[k] && row[k] !== "<Null>") return row[k]; } return ""; };
const facilities = rows.map((r) => ({
  id: pick(r, "mdplotid", "plotid", "id"),
  type: pick(r, "mdtypology", "typology", "type").replace(/_/g, " "),
  typeAr: pick(r, "mdtypologyar", "typologyar"),
  cluster: pick(r, "cluster", "phase"),
  area: pick(r, "mdplotarea", "plotarea", "area"),
  parking: pick(r, "parkingprovided", "parking"),
})).filter((f) => f.id);
log(`1/6 Spreadsheet: ${facilities.length} facilities, ${new Set(facilities.map((f) => f.type)).size} types`);

// ---------------------------------------------------------------- 2. the map PDF
// page → world: the GeoPDF viewport's corners (lat/lon) → UTM, fitted as an affine map
const pdfBytes = readFileSync(PDF).toString("latin1");
const vp = pdfBytes.match(/\/BBox\s*\[\s*([\d.\s-]+)\]\s*\/Name[\s\S]{0,200}?\/Measure[\s\S]*?\/GPTS\s*\[([\d.\s-]+)\]\s*\/LPTS\s*\[([\d.\s-]+)\]/);
if (!vp) throw new Error("The PDF has no geo-registration (export it as a GeoPDF)");
const [bx0, by0, bx1, by1] = vp[1].trim().split(/\s+/).map(Number);
const gpts = vp[2].trim().split(/\s+/).map(Number), lpts = vp[3].trim().split(/\s+/).map(Number);
const zone = Math.floor((gpts[1] + 180) / 6) + 1;
/** WGS 84 lat/lon → UTM (metres) in `zone`. */
function utm(lat, lon) {
  const a = 6378137, f = 1 / 298.257223563, k0 = 0.9996, e2 = f * (2 - f), ep2 = e2 / (1 - e2);
  const phi = (lat * Math.PI) / 180, lam = (lon * Math.PI) / 180, lam0 = (((zone - 1) * 6 - 180 + 3) * Math.PI) / 180;
  const N = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2), T = Math.tan(phi) ** 2, C = ep2 * Math.cos(phi) ** 2, A = Math.cos(phi) * (lam - lam0);
  const M = a * ((1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256) * phi - ((3 * e2) / 8 + (3 * e2 ** 2) / 32 + (45 * e2 ** 3) / 1024) * Math.sin(2 * phi) + ((15 * e2 ** 2) / 256 + (45 * e2 ** 3) / 1024) * Math.sin(4 * phi) - ((35 * e2 ** 3) / 3072) * Math.sin(6 * phi));
  const E = 500000 + k0 * N * (A + ((1 - T + C) * A ** 3) / 6 + ((5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5) / 120);
  const Nn = k0 * (M + N * Math.tan(phi) * (A ** 2 / 2 + ((5 - T + 9 * C + 4 * C * C) * A ** 4) / 24 + ((61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6) / 720));
  return [E, lat < 0 ? Nn + 10000000 : Nn];
}
/** Least-squares affine from pairs [from, to] (2D). */
function fitAffine(pairs) {
  const S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], bx = [0, 0, 0], by = [0, 0, 0];
  for (const [[x, y], [X, Y]] of pairs) { const r = [x, y, 1]; for (let i = 0; i < 3; i++) { for (let j = 0; j < 3; j++) S[i][j] += r[i] * r[j]; bx[i] += r[i] * X; by[i] += r[i] * Y; } }
  const solve = (b) => { // 3x3 Cramer
    const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    const D = det(S);
    return [0, 1, 2].map((k) => det(S.map((row, i) => row.map((v, j) => (j === k ? b[i] : v)))) / D);
  };
  const [a, b, c] = solve(bx), [d, e, f] = solve(by);
  return [a, b, c, d, e, f];
}
const apply = ([a, b, c, d, e, f], [x, y]) => [a * x + b * y + c, d * x + e * y + f];
const invert = ([a, b, c, d, e, f]) => { const det = a * e - b * d; return [e / det, -b / det, (b * f - c * e) / det, -d / det, a / det, (c * d - a * f) / det]; };
const read = WORDS && JSON.parse(readFileSync(WORDS, "utf8"));
const PAGE_H = read ? read.height : Number(execFileSync("pdfinfo", [PDF]).toString().match(/Page size:\s*[\d.]+ x ([\d.]+)/)[1]);
// page points with y down (as pdftotext gives them) → world
const pageToWorld = fitAffine([0, 1, 2, 3].map((i) => {
  const u = lpts[i * 2], v = lpts[i * 2 + 1];
  return [[bx0 + u * (bx1 - bx0), PAGE_H - (by0 + v * (by1 - by0))], utm(gpts[i * 2], gpts[i * 2 + 1])];
}));
log(`2/6 Map PDF: registered in UTM zone ${zone}N`);

// labels with their positions
const words = read
  ? read.words
  : [...execFileSync("pdftotext", ["-bbox", PDF, "-"]).toString().matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g)]
      .map((m) => ({ x0: +m[1], y0: +m[2], x1: +m[3], y1: +m[4], text: m[5] }));
// render the page
if (!PAGE) execFileSync("pdftoppm", ["-r", "600", "-png", "-singlefile", PDF, path.join(tmp, "page")]);
const page = await sharp(PAGE ?? path.join(tmp, "page.png"), { limitInputPixels: false }).flatten({ background: "#ffffff" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const PW = page.info.width, PH = page.info.height, PN = PW * PH, PX = page.data;
const K = read ? PW / read.width : 600 / 72; // page px per point
const rgbAt = (i) => [PX[i * 3], PX[i * 3 + 1], PX[i * 3 + 2]];
const pxToWorld = ([x, y]) => apply(pageToWorld, [(x + 0.5) / K, (y + 0.5) / K]);

// ---------------------------------------------------------------- raster helpers (page)
function traceLoop(m, w, h, x0, y0) {
  let first = -1;
  for (let i = 0; i < w * h; i++) if (m[i]) { first = i; break; }
  if (first < 0) return null;
  const DIRS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  const pts = [];
  let cur = first, d = 6, guard = 0;
  do {
    pts.push([(cur % w) + x0, ((cur / w) | 0) + y0]);
    let found = false;
    for (let t = 0; t < 8; t++) { const nd = (d + 6 + t) % 8, nx = (cur % w) + DIRS[nd][0], ny = ((cur / w) | 0) + DIRS[nd][1]; if (nx >= 0 && ny >= 0 && nx < w && ny < h && m[ny * w + nx]) { cur = ny * w + nx; d = nd; found = true; break; } }
    if (!found) break;
  } while (cur !== first && ++guard < 2e6);
  return pts.length >= 3 ? pts : null;
}
function simplify(pts, eps) {
  if (pts.length < 3) return pts;
  const [A, B] = [pts[0], pts[pts.length - 1]], L = Math.hypot(B[0] - A[0], B[1] - A[1]) || 1;
  let dmax = 0, idx = 0;
  for (let i = 1; i < pts.length - 1; i++) { const dd = Math.abs((B[0] - A[0]) * (A[1] - pts[i][1]) - (A[0] - pts[i][0]) * (B[1] - A[1])) / L; if (dd > dmax) { dmax = dd; idx = i; } }
  return dmax > eps ? [...simplify(pts.slice(0, idx + 1), eps).slice(0, -1), ...simplify(pts.slice(idx), eps)] : [A, B];
}
const simplifyLoop = (pts, eps) => { let far = 0; for (let i = 1; i < pts.length; i++) if (Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]) > Math.hypot(pts[far][0] - pts[0][0], pts[far][1] - pts[0][1])) far = i; return [...simplify(pts.slice(0, far + 1), eps).slice(0, -1), ...simplify([...pts.slice(far), pts[0]], eps).slice(0, -1)]; };
/** Region (as a bounded mask) of pixels passing `ok`, flooded from `seeds`. */
function flood(seeds, ok, limit = 4e6) {
  const seen = new Uint8Array(PN), st = [...seeds];
  for (const s of seeds) seen[s] = 1;
  const pix = [];
  while (st.length && pix.length < limit) {
    const i = st.pop(); pix.push(i);
    const x = i % PW;
    for (const j of [x > 0 ? i - 1 : -1, x < PW - 1 ? i + 1 : -1, i - PW, i + PW]) if (j >= 0 && j < PN && !seen[j] && ok(j)) { seen[j] = 1; st.push(j); }
  }
  return pix.length >= limit ? null : pix;
}
/** Pixels → closed, hole-free outline (page px), simplified. */
function outlineOf(pix, close = 3) {
  let x0 = PW, y0 = PH, x1 = 0, y1 = 0;
  for (const i of pix) { const x = i % PW, y = (i / PW) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  x0 -= close + 1; y0 -= close + 1; x1 += close + 1; y1 += close + 1;
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  let m = new Uint8Array(w * h);
  for (const i of pix) m[(((i / PW) | 0) - y0) * w + (i % PW) - x0] = 1;
  const box = (src, r, dilate) => { // square dilate / erode
    const t = new Uint8Array(w * h), o = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let v = dilate ? 0 : 1; for (let k = -r; k <= r; k++) { const xx = x + k; const s = xx < 0 || xx >= w ? 0 : src[y * w + xx]; if (dilate ? s : !s) { v = dilate ? 1 : 0; break; } } t[y * w + x] = v; }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let v = dilate ? 0 : 1; for (let k = -r; k <= r; k++) { const yy = y + k; const s = yy < 0 || yy >= h ? 0 : t[yy * w + x]; if (dilate ? s : !s) { v = dilate ? 1 : 0; break; } } o[y * w + x] = v; }
    return o;
  };
  m = box(box(m, close, true), close, false); // close over the label text and thin lines
  // fill holes: flood the outside from the border
  const out = new Uint8Array(w * h), st = [];
  for (let x = 0; x < w; x++) for (const y of [0, h - 1]) if (!m[y * w + x] && !out[y * w + x]) { out[y * w + x] = 1; st.push(y * w + x); }
  for (let y = 0; y < h; y++) for (const x of [0, w - 1]) if (!m[y * w + x] && !out[y * w + x]) { out[y * w + x] = 1; st.push(y * w + x); }
  while (st.length) { const i = st.pop(), x = i % w; for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) if (j >= 0 && j < w * h && !m[j] && !out[j]) { out[j] = 1; st.push(j); } }
  for (let i = 0; i < w * h; i++) if (!out[i]) m[i] = 1;
  const loop = traceLoop(m, w, h, x0, y0);
  return loop ? simplifyLoop(loop, 2.5) : null;
}

// ---------------------------------------------------------------- 3. facilities from the map
const near = (a, b, tol) => Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol && Math.abs(a[2] - b[2]) <= tol;
const isNeutral = ([r, g, b]) => Math.max(r, g, b) - Math.min(r, g, b) < 10 && (r > 225 || r < 150);
const found = [];
for (const f of facilities) {
  const w = words.find((wd) => wd.text === f.id);
  if (!w) { log(`    ${f.id}: no label on the map — skipped`); continue; }
  // the fill colour: the most common non-neutral colour in and around the label
  const cx = ((w.x0 + w.x1) / 2) * K, cy = ((w.y0 + w.y1) / 2) * K, rx = ((w.x1 - w.x0) / 2) * K + 8, ry = ((w.y1 - w.y0) / 2) * K + 8;
  const counts = new Map();
  for (let y = Math.round(cy - ry); y <= cy + ry; y++) for (let x = Math.round(cx - rx); x <= cx + rx; x++) {
    if (x < 0 || y < 0 || x >= PW || y >= PH) continue;
    const c = rgbAt(y * PW + x);
    if (isNeutral(c)) continue;
    const key = c.map((v) => v >> 2).join(",");
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const top = [...counts].sort((p, q) => q[1] - p[1])[0];
  if (!top) { log(`    ${f.id}: no fill colour at its label — skipped`); continue; }
  const color = top[0].split(",").map((v) => (+v << 2) + 2);
  const seeds = [];
  for (let y = Math.round(cy - ry); y <= cy + ry; y++) for (let x = Math.round(cx - rx); x <= cx + rx; x++) { if (x < 0 || y < 0 || x >= PW || y >= PH) continue; const i = y * PW + x; if (near(rgbAt(i), color, 14)) seeds.push(i); }
  found.push({ ...f, color, seeds, label: [cx, cy] });
}
// flood each colour region once; a region holding several labels (touching parks)
// is shared out to the nearest label
const owner = new Int32Array(PN).fill(-1);
for (const [k, f] of found.entries()) {
  if (owner[f.seeds[0]] >= 0) continue;
  const pix = flood(f.seeds.filter((s) => owner[s] < 0), (j) => owner[j] < 0 && near(rgbAt(j), f.color, 14));
  if (!pix) { log(`    ${f.id}: its colour runs off the map — skipped`); continue; }
  const inPix = new Set(pix);
  const sharers = found.map((g, j) => ({ g, j })).filter(({ g }) => near(g.color, f.color, 14) && g.seeds.some((s) => inPix.has(s)));
  if (sharers.length <= 1) { for (const i of pix) owner[i] = k; continue; }
  const set = inPix;
  for (const { g } of sharers) for (const s of g.seeds) set.add(s);
  for (const i of set) {
    const x = i % PW, y = (i / PW) | 0;
    let best = -1, bd = Infinity;
    for (const { g, j } of sharers) { const dd = (g.label[0] - x) ** 2 + (g.label[1] - y) ** 2; if (dd < bd) { bd = dd; best = j; } }
    owner[i] = best;
  }
}
const regions = found.map(() => []);
for (let i = 0; i < PN; i++) if (owner[i] >= 0) regions[owner[i]].push(i);
for (const [k, f] of found.entries()) {
  const loop = regions[k].length ? outlineOf(regions[k]) : null;
  f.world = loop ? loop.map(pxToWorld) : null;
  if (!f.world) log(`    ${f.id}: no outline`);
}
const placed = found.filter((f) => f.world);
log(`3/6 Facilities: ${placed.length} of ${facilities.length} outlined on the map`);

const pct = (x, w) => Math.round((x / w) * 10000) / 100;
const centroid = (P) => P.reduce((s, q) => [s[0] + q[0] / P.length, s[1] + q[1] / P.length], [0, 0]);
const inside = ([x, y], P) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) if ((P[i][1] > y) !== (P[j][1] > y) && x < ((P[j][0] - P[i][0]) * (y - P[i][1])) / (P[j][1] - P[i][1]) + P[i][0]) c = !c; return c; };
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
// one category per type: the map's colour, a built-in icon by name
const ICONS = [[/retail|shop|mall|commercial/i, "shopping"], [/nursery|kindergarten|elc/i, "playground"], [/school|education|academy/i, "school"], [/mosque|masjid/i, "mosque"], [/medical|clinic|health|hospital/i, "health"], [/sport|gym|fitness/i, "gym"], [/majlis|community/i, "community"], [/park|garden|green/i, "park"], [/petrol|fuel|gas station/i, "landmark"], [/service/i, "info"], [/housing|residential/i, "community"]];
const hex = (c) => `#${c.map((v) => Math.min(255, v).toString(16).padStart(2, "0")).join("")}`;
const categories = [];
for (const f of placed) {
  const id = slug(f.type);
  if (!categories.some((c) => c.id === id)) categories.push({ id, label: f.type, color: hex(f.color), icon: `builtin:${ICONS.find(([re]) => re.test(f.type))?.[1] ?? "info"}` });
  f.category = id;
}
const infoOf = (f) => Object.fromEntries([["Type", f.type], ["النوع", f.typeAr], ["Plot ID", f.id], ["Cluster", f.cluster], ["Plot area", f.area ? `${Math.round(Number(f.area)).toLocaleString("en")} m²` : ""], ["Parking", f.parking]].filter(([, v]) => v));
const facilityShapes = (f, toPct) => {
  const points = f.world.map(toPct);
  return [
    { id: f.id, label: `${f.type} · ${f.id}`, kind: "polygon", category: f.category, points, info: infoOf(f) },
    { id: `${f.id}-icon`, label: `${f.type} · ${f.id}`, kind: "pin", category: f.category, points: [centroid(points).map((v) => Math.round(v * 100) / 100)], info: infoOf(f) },
  ];
};
/** A world file (.wpw / .jgw …): image pixel corner → world. */
const readWorld = (wf) => {
  const [A, D, B, E, C, F] = readFileSync(wf, "utf8").trim().split(/\s+/).map(Number);
  return [A, B, C - A / 2 - B / 2, D, E, F - D / 2 - E / 2];
};

// ---------------------------------------------------------------- one scene only
if (INTO) {
  const [w, h] = SIZE ?? [];
  if (!(w > 0 && h > 0)) throw new Error("Missing --size <width>x<height>");
  const toPx = invert(readWorld(INTO));
  const toPct = (wp) => { const [x, y] = apply(toPx, wp); return [pct(x, w), pct(y, h)]; };
  // the facilities on this image (a few % over the edge is fine) — only the
  // phase's own when the world file is named like a cluster (MT11.wpw → MT11)
  const phase = path.basename(INTO).replace(/\.[^.]+$/, "");
  const own = placed.some((f) => f.cluster === phase);
  const onImage = (sh) => sh.points.every(([x, y]) => x > -5 && y > -5 && x < 105 && y < 105);
  const shapes = placed.filter((f) => !own || f.cluster === phase).map((f) => facilityShapes(f, toPct)).filter(([outline]) => onImage(outline)).flat();
  const used = new Set(shapes.map((sh) => sh.category));
  writeFileSync(OUT, JSON.stringify({ shapes, categories: categories.filter((c) => used.has(c.id)) }));
  rmSync(tmp, { recursive: true, force: true });
  log(`${shapes.length / 2} of ${placed.length} facilities lie on this image${own ? ` (cluster ${phase})` : ""}`);
  process.exit(0);
}

// phases: the areas inside the thick outlines, labelled MT01…
const thick = new Uint8Array(PN);
{
  const grey = new Uint8Array(PN);
  for (let i = 0; i < PN; i++) { const [r, g, b] = rgbAt(i); grey[i] = Math.abs(r - g) < 8 && Math.abs(g - b) < 8 && r > 100 && r < 160 ? 1 : 0; }
  // thick = still grey after shrinking by 3 px (thin plot lines vanish)
  const R = 3;
  for (let y = R; y < PH - R; y++) for (let x = R; x < PW - R; x++) {
    const i = y * PW + x; if (!grey[i]) continue;
    let all = 1;
    for (let k = -R; k <= R && all; k++) if (!grey[i + k] || !grey[i + k * PW]) all = 0;
    if (all) for (let dy = -R - 1; dy <= R + 1; dy++) for (let dx = -R - 1; dx <= R + 1; dx++) thick[i + dy * PW + dx] = 1;
  }
}
const phases = [];
for (const w of words.filter((wd) => /^[A-Z]{1,4}\d{2}$/.test(wd.text))) {
  if (phases.some((p) => p.name === w.text)) continue;
  const cx = Math.round(((w.x0 + w.x1) / 2) * K), cy = Math.round(((w.y0 + w.y1) / 2) * K);
  let seed = cy * PW + cx;
  for (let r = 0; r < 40 && thick[seed]; r++) seed += 1;
  const pix = flood([seed], (j) => !thick[j], PN / 4);
  if (!pix) { log(`    phase ${w.text}: its outline isn't closed — skipped`); continue; }
  const loop = outlineOf(pix, 6);
  if (loop) phases.push({ name: w.text, world: loop.map(pxToWorld), label: [cx, cy] });
}
log(`    ${phases.length} phase outlines: ${phases.map((p) => p.name).join(", ")}`);

// ---------------------------------------------------------------- 4. phase images (world files)
const worldFileOf = (img) => {
  const base = img.replace(/\.[^.]+$/, ""), ext = path.extname(img).slice(1);
  for (const c of [`${img}w`, `${base}.${ext[0]}${ext.at(-1)}w`, `${base}.wld`]) if (existsSync(c)) return c;
  return null;
};
const phaseImages = readdirSync(PHASES).filter((f) => /\.(webp|png|jpe?g|tiff?)$/i.test(f)).sort().map((f) => {
  const file = path.join(PHASES, f), wf = worldFileOf(file);
  if (!wf) return null;
  return { name: f.replace(/\.[^.]+$/, ""), file, world: readWorld(wf) };
}).filter(Boolean);
for (const im of phaseImages) { const m = await sharp(im.file, { limitInputPixels: false }).metadata(); im.w = m.width; im.h = m.height; im.toPx = invert(im.world); }
log(`4/6 Phase images with world files: ${phaseImages.map((p) => p.name).join(", ")}`);

// ---------------------------------------------------------------- 5. the masterplan in world coordinates
// Find the phase images in the masterplan: a coarse search for the first, then
// the others predicted from it and fine-tuned; world ↔ masterplan from all corners.
const mMeta = await sharp(MASTER, { limitInputPixels: false }).metadata();
const MW = mMeta.width, MH = mMeta.height;
async function edgesOf(file, width) {
  const { data, info } = await sharp(file, { limitInputPixels: false }).resize({ width: Math.max(8, Math.round(width)) }).removeAlpha().greyscale().blur(0.8).raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height, g = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x; g[i] = Math.hypot(data[i + 1] - data[i - 1], data[i + w] - data[i - w]); }
  return { g, w, h };
}
function ncc(M, P, ox, oy, step = 1) {
  let n = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
  for (let y = 1; y < P.h - 1; y += step) for (let x = 1; x < P.w - 1; x += step) {
    const X = ox + x, Y = oy + y; if (X < 0 || Y < 0 || X >= M.w || Y >= M.h) continue;
    const a = M.g[Y * M.w + X], b = P.g[y * P.w + x]; n++; sa += a; sb += b; saa += a * a; sbb += b * b; sab += a * b;
  }
  if (n < (P.w * P.h * 0.6) / (step * step)) return -1;
  const va = saa - (sa * sa) / n, vb = sbb - (sb * sb) / n;
  return va > 0 && vb > 0 ? (sab - (sa * sb) / n) / Math.sqrt(va * vb) : -1;
}
const MT = 400, mThumb = await edgesOf(MASTER, MT), tScale = MT / MW; // masterplan thumbnail
const anchor = phaseImages.reduce((p, q) => (q.w * q.h > p.w * p.h ? q : p)); // the biggest phase is easiest to find
// the anchor's width as a share of the masterplan's: at most its share of the
// whole site (the masterplan shows at least the site), at least a third of that
const siteW = (() => { const xs = phaseImages.flatMap((im) => [apply(im.world, [0, 0])[0], apply(im.world, [im.w, im.h])[0]]); return Math.max(...xs) - Math.min(...xs); })();
const kMax = Math.min(0.95, (apply(anchor.world, [anchor.w, 0])[0] - apply(anchor.world, [0, 0])[0]) / siteW);
let bestA = null;
for (let k = kMax / 3; k <= kMax * 1.02; k *= 1.03) {
  const P = await edgesOf(anchor.file, k * MT);
  for (let oy = -2; oy < mThumb.h - P.h + 2; oy += 2) for (let ox = -2; ox < mThumb.w - P.w + 2; ox += 2) {
    const s = ncc(mThumb, P, ox, oy, 2);
    if (!bestA || s > bestA.s) bestA = { s, k, ox, oy, pw: P.w, ph: P.h };
  }
}
// polish the best position at full sampling
{
  const P = await edgesOf(anchor.file, bestA.k * MT);
  for (let oy = bestA.oy - 3; oy <= bestA.oy + 3; oy++) for (let ox = bestA.ox - 3; ox <= bestA.ox + 3; ox++) { const s = ncc(mThumb, P, ox, oy); if (s > bestA.s) bestA = { ...bestA, s, ox, oy }; }
}
log(`5/6 Masterplan: ${anchor.name} found (match ${bestA.s.toFixed(2)}), fine-tuning every phase…`);
// world → masterplan px from the anchor: scale (masterplan px per world m) and offset
const anchorWorld = [apply(anchor.world, [0, 0]), apply(anchor.world, [anchor.w, anchor.h])];
const sx = (bestA.pw / tScale) / (anchorWorld[1][0] - anchorWorld[0][0]), sy = (bestA.ph / tScale) / (anchorWorld[1][1] - anchorWorld[0][1]);
const guess = [sx, 0, bestA.ox / tScale - sx * anchorWorld[0][0], 0, sy, bestA.oy / tScale - sy * anchorWorld[0][1]];
const pairs = [];
for (const im of phaseImages) {
  // phase% → masterplan% predicted, then fine-tuned on the pictures
  const c0 = apply(guess, apply(im.world, [0, 0])), c1 = apply(guess, apply(im.world, [im.w, im.h]));
  // placement format: masterplan% = a·phase% + c (a is a ratio, c a percent)
  const T0 = [(c1[0] - c0[0]) / MW, 0, (c0[0] / MW) * 100, 0, (c1[1] - c0[1]) / MH, (c0[1] / MH) * 100];
  const r = await refinePlacement(MASTER, im.file, T0);
  im.inMaster = r.T;
  for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 1], [0.5, 0.5]]) {
    const world = apply(im.world, [u * im.w, v * im.h]), mp = apply(r.T, [u * 100, v * 100]);
    pairs.push([world, [(mp[0] / 100) * MW, (mp[1] / 100) * MH], im.name]);
  }
  log(`    ${im.name}: match ${r.after.toFixed(2)}`);
}
const worldToMaster = fitAffine(pairs.map(([w, m]) => [w, m]));
const residual = pairs.map(([w, m]) => Math.hypot(...apply(worldToMaster, w).map((v, i) => v - m[i])));
log(`    masterplan ↔ world fitted from ${phaseImages.length} phases: average misfit ${(residual.reduce((a, b) => a + b, 0) / residual.length).toFixed(1)} px of ${MW}`);

// ---------------------------------------------------------------- 6. the project
const sceneDir = path.join(ROOT, "public", "scenes", SLUG);
const MAX = 6000, mScale = NO_COPY ? 1 : Math.min(1, MAX / MW);
if (!NO_COPY) {
  mkdirSync(sceneDir, { recursive: true });
  await sharp(MASTER, { limitInputPixels: false }).resize(Math.round(MW * mScale)).webp({ quality: 86 }).toFile(path.join(sceneDir, "masterplan.webp"));
}
const toMasterPct = (wp) => { const [x, y] = apply(worldToMaster, wp); return [pct(x, MW), pct(y, MH)]; };
const sceneIdOf = (name) => slug(name);
const masterShapes = [
  ...phases.filter((p) => phaseImages.some((im) => im.name === p.name)).map((p) => ({
    id: p.name, label: p.name, kind: "polygon", link: sceneIdOf(p.name), points: p.world.map(toMasterPct),
    style: { fillOpacity: 0.08, hoverFillOpacity: 0.25, strokeWidth: 2, stroke: "#ffffff", label: "always", labelSize: 14 },
  })),
  ...placed.flatMap((f) => facilityShapes(f, toMasterPct)),
];
const scenes = [{ id: "masterplan", title: TITLE, image: NO_COPY ? path.basename(MASTER) : `/scenes/${SLUG}/masterplan.webp`, width: Math.round(MW * mScale), height: Math.round(MH * mScale), shapes: masterShapes, style: { fillOpacity: 0.45 } }];
// carried-over plots: a scene of that project whose image is the same picture as a phase's
const carried = [];
if (PLOTS_FROM) {
  const [file, sceneId] = PLOTS_FROM.split(":");
  for (const src of JSON.parse(readFileSync(path.resolve(file), "utf8")).scenes) {
    if (sceneId && src.id !== sceneId) continue;
    const img = path.join(ROOT, "public", src.image);
    if (!/^https?:/.test(src.image) && existsSync(img) && src.shapes.length) carried.push({ src, bytes: readFileSync(img) });
  }
}
for (const im of phaseImages) {
  const id = sceneIdOf(im.name), out = path.join(sceneDir, `${im.name}${path.extname(im.file)}`);
  if (!NO_COPY) copyFileSync(im.file, out);
  const toPct = (wp) => { const [x, y] = apply(im.toPx, wp); return [pct(x, im.w), pct(y, im.h)]; };
  const phase = phases.find((p) => p.name === im.name);
  // its facilities: by the spreadsheet's cluster, or lying inside the phase outline
  const mine = placed.filter((f) => f.cluster === im.name || (phase && inside(centroid(f.world), phase.world)));
  const shapes = mine.flatMap((f) => facilityShapes(f, toPct)).filter((s) => s.points.every(([x, y]) => x > -5 && y > -5 && x < 105 && y < 105));
  const scene = { id, title: im.name, image: NO_COPY ? path.basename(im.file) : `/scenes/${SLUG}/${path.basename(out)}`, width: im.w, height: im.h, shapes };
  const bytes = readFileSync(im.file), same = carried.find((c) => c.bytes.equals(bytes));
  if (same) {
    const own = new Set(shapes.map((s) => s.id));
    const extra = same.src.shapes.filter((s) => !own.has(s.id)); // not the facilities again
    scene.shapes = [...extra, ...shapes];
    if (same.src.trace) scene.trace = same.src.trace;
    if (extra.length) log(`    ${im.name}: ${extra.length} shapes carried over from the scene "${same.src.title}"`);
  }
  scenes.push(scene);
}
const project = {
  title: TITLE,
  startScene: "masterplan",
  categories,
  scenes,
  style: { fillOpacity: 0.35, hoverFillOpacity: 0.6, strokeWidth: 1.25, hoverFill: "#f59e0b", hoverStroke: "#f59e0b" },
};
mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(project, null, 2) + "\n");
rmSync(tmp, { recursive: true, force: true });
log(`6/6 Saved "${TITLE}": ${scenes.length} scenes, ${placed.length} facilities in ${categories.length} types${NO_COPY ? "" : ` → ${path.relative(ROOT, OUT)}`}`);
