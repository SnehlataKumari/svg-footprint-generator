#!/usr/bin/env node
/**
 * Imports a project made in the SVG footprint editor (svg-footprint-generator,
 * /editor) into this site: writes data/project.json and the images into
 * public/projects/<name>/. The previous data/project.json is kept as
 * data/project.previous.json.
 *
 *   npm run import-editor -- ~/Downloads/my-project.json
 *   npm run import-editor -- project.json --public ../interactive-map-poc/public --details plot-details.json
 *
 * The input is the editor's "JSON ▾ → Download backup (project + images)"
 * file (images embedded), or its plain project.json — then `--public` is the
 * editor's public/ folder, where its "/scenes/…" images are copied from, and
 * `--details` its plot details file (data/plot-details/<name>.json; in the
 * backup they are already included).
 *
 * Mapping (editor → this site):
 * - scene → scene; its parent is the scene whose area links to it.
 * - polygon → hotspot (description / info / image / url → details card).
 * - pin → marker. Lines (roads) are skipped: this site has no line shapes.
 * - categories → the "category" filter + colours; plot details (status,
 *   typology, area…) → "status" / "typology" filters and "area" / "gfa" ranges.
 */



// use it in the other project to import facilities from the reference project
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const DATA = path.join(ROOT, "data", "project.json");

const STATUS_COLORS = {
  available: "#70C50F",
  booked: "#F59E0B",
  reserved: "#5486E7",
  blocked: "#94A3B8",
  sold: "#E75454",
  unassigned: "#A3A3A3",
};
const PALETTE = [
  "#AA6CA4",
  "#6896CC",
  "#E0A84F",
  "#4FB3A9",
  "#D46A6A",
  "#8C9A5B",
  "#7E7EC8",
  "#C9839B",
];
const MIME_EXT = {
  "image/webp": "webp",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/svg+xml": "svg",
  "image/gif": "gif",
  "image/avif": "avif",
};

const slug = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "item";
const round = (p) => p.map((n) => Math.round(n * 1000) / 1000);
const fail = (msg) => {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
};

// ---- arguments ----
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args.splice(i, 2)[1];
};
const publicDir = flag("--public");
const detailsFile = flag("--details");
const input = args[0];
if (!input)
  fail(
    "Which file? Usage: npm run import-editor -- <downloaded-project.json> [--public <editor public folder>] [--details <plot details file>]",
  );
if (!fs.existsSync(input)) fail(`File not found: ${input}`);

let src;
try {
  src = JSON.parse(fs.readFileSync(input, "utf8"));
} catch {
  fail(
    `${input} isn't valid JSON — download it again from the editor (JSON ▾ → Download backup).`,
  );
}
if (!Array.isArray(src.scenes) || !src.scenes.length)
  fail(`${input} has no scenes — is it the editor's project file?`);

const notes = [];
const projectSlug = slug(src.title || "project");
const imageDir = path.join(ROOT, "public", "projects", projectSlug);
fs.mkdirSync(imageDir, { recursive: true });

// ---- images: embedded (local:<id>) → files; editor /public paths → copied ----
const embedded = src.images ?? {};
const copied = new Map();
function image(ref, name) {
  if (!ref || ref.startsWith("builtin:")) return undefined;
  if (/^https?:\/\//.test(ref)) return ref;
  if (copied.has(ref)) return copied.get(ref);
  let file;
  const dataUrl = embedded[ref];
  if (dataUrl) {
    const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(dataUrl);
    if (!m) return void notes.push(`Image ${ref} couldn't be read — skipped.`);
    file = `${name}.${MIME_EXT[m[1]] ?? "bin"}`;
    fs.writeFileSync(
      path.join(imageDir, file),
      m[2] ? Buffer.from(m[3], "base64") : decodeURIComponent(m[3]),
    );
  } else {
    const from =
      publicDir &&
      path.join(publicDir, decodeURIComponent(ref.replace(/^\//, "")));
    if (!from || !fs.existsSync(from)) {
      notes.push(
        `Image ${ref} isn't in the file${publicDir ? ` nor in ${publicDir}` : ' — use the editor\'s "Download backup (project + images)", or pass --public'}.`,
      );
      copied.set(ref, ref);
      return ref;
    }
    file = `${name}${path.extname(from).toLowerCase()}`;
    fs.copyFileSync(from, path.join(imageDir, file));
  }
  const url = `/projects/${projectSlug}/${file}`;
  copied.set(ref, url);
  return url;
}

// ---- scene ids + tree (parent = the first scene linking to it, from the start scene) ----
const ids = new Map();
for (const s of src.scenes) {
  let id = slug(s.id);
  while ([...ids.values()].includes(id)) id += "-2";
  ids.set(s.id, id);
}
const byId = new Map(src.scenes.map((s) => [s.id, s]));
// The editor's start scene is simply the first one created; when another
// scene links to it (masterplan → cluster), start from the top of that chain.
let start = byId.has(src.startScene) ? src.startScene : src.scenes[0].id;
for (const visited = new Set([start]); ;) {
  const up = src.scenes.find(
    (s) => s.id !== start && (s.shapes ?? []).some((x) => x.link === start),
  );
  if (!up || visited.has(up.id)) break;
  notes.push(
    `"${up.title}" opens "${byId.get(start).title}", so the site starts at "${up.title}".`,
  );
  visited.add((start = up.id));
}
const parent = new Map();
const queue = [start];
const seen = new Set(queue);
while (queue.length) {
  const s = byId.get(queue.shift());
  for (const shape of s.shapes ?? []) {
    if (shape.link && byId.has(shape.link) && !seen.has(shape.link)) {
      seen.add(shape.link);
      parent.set(shape.link, s.id);
      queue.push(shape.link);
    }
  }
}
for (const s of src.scenes) {
  if (!seen.has(s.id)) {
    parent.set(s.id, start);
    notes.push(
      `Scene "${s.title}" isn't opened by any area — it's placed under "${byId.get(start).title}" (reachable by its URL only).`,
    );
  }
}

// ---- categories ----
const categories = {};
const values = {};
const editorCats = src.categories ?? [];
if (editorCats.length) {
  categories.category = {
    label: { en: "Type", ar: "النوع" },
    options: editorCats.map((c) => ({
      value: c.id,
      label: c.label,
      color: c.color,
    })),
  };
}
const details = {
  ...(src.details ?? {}),
  ...(detailsFile ? JSON.parse(fs.readFileSync(detailsFile, "utf8")) : {}),
};
const detailOptions = (field) => [
  ...new Set(
    Object.values(details)
      .map((d) => d[field])
      .filter(Boolean),
  ),
];
const statuses = detailOptions("status");
if (statuses.length) {
  categories.status = {
    label: { en: "Status", ar: "الحالة" },
    options: statuses.map((v) => ({
      value: slug(v),
      label: v,
      color: STATUS_COLORS[slug(v)] ?? "#A3A3A3",
    })),
  };
}
const typologies = detailOptions("mdTypology");
if (typologies.length) {
  categories.typology = {
    label: { en: "Typology", ar: "النموذج" },
    options: typologies.map((v, i) => ({
      value: slug(v),
      label: v,
      color: PALETTE[i % PALETTE.length],
    })),
  };
}
if (Object.values(details).some((d) => d.mdPlotArea != null))
  values.area = {
    label: { en: "Plot area", ar: "مساحة القطعة" },
    unit: { en: "m²", ar: "م²" },
  };
if (Object.values(details).some((d) => d.gfa != null))
  values.gfa = {
    label: { en: "GFA", ar: "المساحة الطابقية" },
    unit: { en: "m²", ar: "م²" },
  };

// ---- shapes ----
const visible = (shape, s) =>
  !shape.hidden && shape.style?.visible !== false && s.style?.visible !== false;
function hotspot(shape, s) {
  const h = { id: shape.id, points: shape.points.map(round) };
  if (shape.label && shape.label !== shape.id) h.label = shape.label;
  if (shape.link && byId.has(shape.link)) h.link = ids.get(shape.link);
  if (shape.color) h.color = shape.color;
  const cats = {};
  const vals = {};
  const fields = Object.entries(shape.info ?? {}).map(([label, value]) => ({
    label,
    value: String(value),
  }));
  if (shape.category && categories.category) cats.category = shape.category;
  const d = details[shape.id];
  if (d) {
    if (d.status) cats.status = slug(d.status);
    if (d.mdTypology) cats.typology = slug(d.mdTypology);
    if (d.mdPlotArea != null) vals.area = d.mdPlotArea;
    if (d.gfa != null) vals.gfa = d.gfa;
    if (d.zone)
      fields.push({ label: { en: "Zone", ar: "المنطقة" }, value: d.zone });
    if (d.facadeOption)
      fields.push({
        label: { en: "Facade", ar: "الواجهة" },
        value: d.facadeOption,
      });
    if (d.parking != null)
      fields.push({
        label: { en: "Parking", ar: "مواقف" },
        value: String(d.parking),
      });
    for (const [label, value] of Object.entries(d.extra ?? {}))
      fields.push({ label, value: String(value) });
  }
  if (Object.keys(cats).length) h.categories = cats;
  if (Object.keys(vals).length) h.values = vals;
  const card = {};
  if (shape.description) card.description = shape.description;
  if (shape.image)
    card.image = image(shape.image, `${ids.get(s.id)}-${slug(shape.id)}`);
  if (fields.length) card.fields = fields;
  if (shape.url && (Object.keys(card).length || h.link))
    card.external = {
      label: { en: "More information", ar: "مزيد من المعلومات" },
      href: shape.url,
    };
  else if (shape.url) h.href = shape.url;
  if (Object.keys(card).length) h.details = card;
  return h;
}
function marker(shape, s) {
  const m = {
    id: shape.id,
    point: round(shape.points[0]),
    title: shape.label || shape.id,
  };
  const icon = image(
    shape.icon ?? editorCats.find((c) => c.id === shape.category)?.icon,
    `${ids.get(s.id)}-${slug(shape.id)}-icon`,
  );
  if (icon) m.icon = icon;
  if (shape.link && byId.has(shape.link)) m.link = ids.get(shape.link);
  else if (shape.description || shape.url) {
    m.card = { description: shape.description ?? "" };
    const cat = editorCats.find((c) => c.id === shape.category);
    if (cat) m.card.category = cat.label;
    if (shape.image)
      m.card.image = image(shape.image, `${ids.get(s.id)}-${slug(shape.id)}`);
    if (shape.url) m.card.website = shape.url;
  }
  return m;
}

const scenes = src.scenes.map((s) => {
  const shapes = (s.shapes ?? []).filter((shape) => visible(shape, s));
  const lines = shapes.filter((x) => x.kind === "line").length;
  if (lines)
    notes.push(
      `Scene "${s.title}": ${lines} line(s) (roads, paths) skipped — this site draws areas and pins only.`,
    );
  const hotspots = shapes
    .filter((x) => x.kind === "polygon" && x.points.length >= 3)
    .map((x) => hotspot(x, s));
  const markers = shapes
    .filter((x) => x.kind === "pin" && x.points.length)
    .map((x) => marker(x, s));
  const used = (cat) => hotspots.some((h) => h.categories?.[cat]);
  const colorBy = ["status", "typology", "category"].filter(used);
  const ranges = Object.keys(values).filter((v) =>
    hotspots.some((h) => h.values?.[v] != null),
  );

  const scene = { id: ids.get(s.id) };
  if (s.id !== start) scene.parent = ids.get(parent.get(s.id));
  scene.title = s.title;
  scene.image = image(s.image, ids.get(s.id));
  scene.hotspotStyle =
    colorBy.length || hotspots.some((h) => h.color) ? "fill" : "boundary";
  if ((s.style?.label ?? src.style?.label) === "always") scene.labels = true;
  if (colorBy.length) {
    scene.colorBy = colorBy;
    scene.legend = colorBy[0];
    scene.filters = {
      categories: colorBy,
      ...(ranges.length && { ranges }),
      search: true,
    };
  }
  if (hotspots.length) scene.hotspots = hotspots;
  if (markers.length) scene.markers = markers;
  return scene;
});

// ---- write ----
let previous = {};
if (fs.existsSync(DATA)) {
  previous = JSON.parse(fs.readFileSync(DATA, "utf8"));
  fs.copyFileSync(DATA, path.join(ROOT, "data", "project.previous.json"));
}
const project = {
  $schema: "./project.schema.json",
  name: src.title || "Project",
  locales: previous.locales ?? [{ code: "en", label: "EN" }],
  rootScene: ids.get(start),
  ...(Object.keys(categories).length && { categories }),
  ...(Object.keys(values).length && { values }),
  strings: {},
  scenes,
};
fs.writeFileSync(DATA, JSON.stringify(project, null, 2) + "\n");

const count = (k) => scenes.reduce((n, s) => n + (s[k]?.length ?? 0), 0);
console.log(
  `\n✔ Imported "${project.name}": ${scenes.length} scenes, ${count("hotspots")} areas, ${count("markers")} pins.`,
);
console.log(
  `  data/project.json written (the old one is in data/project.previous.json)`,
);
console.log(`  images in public/projects/${projectSlug}/`);
const printTree = (s) => {
  console.log(
    `    ${s.parent ? "  ".repeat(depth(s)) + "└ " : ""}${typeof s.title === "string" ? s.title : s.id}  →  /${pathOf(s)}`,
  );
  scenes.filter((x) => x.parent === s.id).forEach(printTree);
};
printTree(scenes.find((s) => !s.parent));
if (notes.length)
  console.log(`\n  Notes:\n${notes.map((n) => `  • ${n}`).join("\n")}`);
console.log(`\n  Next: npm run dev  → http://localhost:3000\n`);

function depth(s) {
  return s.parent ? 1 + depth(scenes.find((x) => x.id === s.parent)) : 0;
}
function pathOf(s) {
  return s.parent
    ? [pathOf(scenes.find((x) => x.id === s.parent)), s.id]
        .filter(Boolean)
        .join("/")
    : "";
}
