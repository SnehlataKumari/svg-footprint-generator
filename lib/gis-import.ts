import { addProject, imageUrl, openedProject, storeImage } from "./browser-store";
import type { Project } from "./types";
import { blobUpload, DIRECT_BYTES } from "./upload";

/**
 * Hosted editor, "Import from GIS files": the server can't run poppler or
 * keep files, so the browser reads the map PDF itself (pdf.js: the page
 * rendered + its labels, as poppler would give them), app/api/import-facilities
 * runs scripts/import-facilities.mjs on everything and returns the project,
 * and the browser stores it with its images. `npm run dev` sends the files
 * as they are instead (components/editor/import-facilities.tsx).
 */
export interface GisFiles {
  title: string;
  xlsx: File;
  pdf: File;
  masterplan: File;
  /** Phase images and their world files. */
  phases: File[];
  /** Carry over plots from the open project where a phase uses the same image. */
  carryPlots: boolean;
}

export type GisImportResult = { name: string; title: string; log: string } | { error: string };

/** The page is rendered at poppler's 600 dpi (the script's pixel sizes assume it), less for very big pages. */
const DPI = 600, MAX_PIXELS = 120e6, MAX_SIDE = 16000;
/** The masterplan is stored at most this wide (like `npm run dev`). */
const MASTER_MAX = 6000;

let worker: Worker | null = null;

/** The map PDF's first page as a PNG, and its words in page points (y down), as the script reads them. */
async function readPdf(file: File): Promise<{ page: Blob; words: string }> {
  const pdfjs = await import("pdfjs-dist");
  worker ??= new Worker(new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url), { type: "module" });
  pdfjs.GlobalWorkerOptions.workerPort = worker;
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  try {
    const doc = await task.promise;
    const pdfPage = await doc.getPage(1);
    const pts = pdfPage.getViewport({ scale: 1 });
    const scale = Math.min(DPI / 72, Math.sqrt(MAX_PIXELS / (pts.width * pts.height)), MAX_SIDE / Math.max(pts.width, pts.height));
    const viewport = pdfPage.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    await pdfPage.render({ canvas, viewport, background: "#ffffff" }).promise;
    const page = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    canvas.width = canvas.height = 0; // free its memory now
    if (!page) throw new Error("The map PDF is too big to read in this browser");

    // each text run split into words; the box from the run's direction, with
    // poppler's room for descenders (rotated labels get their bounding box)
    const words = [];
    for (const item of (await pdfPage.getTextContent()).items) {
      if (!("str" in item) || !item.str.trim()) continue;
      const t = pdfjs.Util.transform(pts.transform, item.transform);
      const h = Math.hypot(t[2], t[3]), len = Math.hypot(t[0], t[1]);
      const u = [t[0] / len, t[1] / len], v = [t[2] / h, t[3] / h];
      for (const m of item.str.matchAll(/\S+/g)) {
        const a = (m.index / item.str.length) * item.width, b = ((m.index + m[0].length) / item.str.length) * item.width;
        const c = [[a, -0.2 * h], [b, -0.2 * h], [a, h], [b, h]].map(([s, r]) => [t[4] + u[0] * s + v[0] * r, t[5] + u[1] * s + v[1] * r]);
        const xs = c.map((p) => p[0]), ys = c.map((p) => p[1]);
        words.push({ text: m[0], x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) });
      }
    }
    return { page, words: JSON.stringify({ width: pts.width, height: pts.height, words }) };
  } finally {
    await task.destroy();
  }
}

/** The masterplan at most MASTER_MAX wide (WebP), or as it is if this browser can't shrink it. */
async function shrink(file: File): Promise<{ image: Blob; width?: number; height?: number }> {
  try {
    const full = await createImageBitmap(file);
    const { width } = full;
    full.close();
    if (width <= MASTER_MAX) return { image: file };
    const bmp = await createImageBitmap(file, { resizeWidth: MASTER_MAX, resizeQuality: "high" });
    const canvas = document.createElement("canvas");
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    canvas.getContext("2d")!.drawImage(bmp, 0, 0);
    bmp.close();
    const image = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.86));
    const out = { width: canvas.width, height: canvas.height };
    canvas.width = canvas.height = 0;
    return image ? { image, ...out } : { image: file };
  } catch {
    return { image: file };
  }
}

const sameBytes = async (a: Blob, b: Blob) => {
  if (a.size !== b.size) return false;
  const [x, y] = await Promise.all([a.arrayBuffer(), b.arrayBuffer()]).then((r) => r.map((buf) => new Uint8Array(buf)));
  return x.every((v, i) => v === y[i]);
};

/** The route's name for a phase file (app/api/import-facilities `safeName`). */
const safeName = (name: string) => name.replace(/[^\w.\- ]+/g, "_");

export async function importInBrowser(files: GisFiles, onStep: (step: string) => void): Promise<GisImportResult> {
  onStep("Reading the map PDF…");
  const { page, words } = await readPdf(files.pdf);

  const big = [files.xlsx, files.pdf, files.masterplan, page, ...files.phases].reduce((n, f) => n + f.size, 0) + words.length > DIRECT_BYTES;
  if (big) onStep("Uploading the files…");
  // images and the PDF go through Vercel Blob when it's all too big; world files and the spreadsheet are small
  const send = async (name: string, f: Blob) => (big && /^image\/|^application\/pdf$/.test(f.type) ? blobUpload(`import/${name}`, f) : f);
  const body = new FormData();
  body.append("title", files.title);
  body.append("words", words);
  const [xlsx, pdf, masterplan, pageSent, ...phases] = await Promise.all([
    send("facilities.xlsx", files.xlsx),
    send("map.pdf", files.pdf),
    send(files.masterplan.name, files.masterplan),
    send("page.png", page),
    ...files.phases.map((f) => send(f.name, f)),
  ]);
  body.append("xlsx", xlsx);
  body.append("pdf", pdf);
  body.append("masterplan", masterplan);
  body.append("page", pageSent);
  phases.forEach((f, i) => {
    if (typeof f === "string") body.append("phases", f);
    else body.append("phases", f, files.phases[i].name);
    body.append("phaseNames", files.phases[i].name);
  });

  onStep("Importing…");
  const res = await fetch("/api/import-facilities", { method: "POST", body });
  if (res.status === 504) return { error: "The site's time limit ran out — try smaller images, or the desktop version (npm run dev)" };
  const data = (await res.json().catch(() => ({}))) as { project?: Project; title?: string; log?: string; error?: string };
  if (!res.ok || !data.project) return { error: data.error ?? `Import failed (${res.status})` };

  onStep("Saving in this browser…");
  const project = data.project;
  let log = data.log ?? "";
  const open = files.carryPlots ? await openedProject() : null;
  for (const scene of project.scenes) {
    if (scene.id === "masterplan") {
      const { image, width, height } = await shrink(files.masterplan);
      scene.image = await storeImage(image, files.masterplan.name.replace(/\.[^.]+$/, ".webp"));
      if (width && height) Object.assign(scene, { width, height });
      continue;
    }
    const file = files.phases.find((f) => safeName(f.name) === scene.image);
    if (!file) return { error: `The phase image ${scene.image} went missing` };
    // carried-over plots: a scene of the open project showing the same picture
    for (const src of open?.scenes ?? []) {
      if (!src.shapes.length) continue;
      const stored = await fetch(imageUrl(src.image))
        .then((r) => (r.ok ? r.blob() : null))
        .catch(() => null);
      if (!stored || !(await sameBytes(stored, file))) continue;
      const own = new Set(scene.shapes.map((s) => s.id));
      const extra = src.shapes.filter((s) => !own.has(s.id)); // not the facilities again
      scene.shapes = [...extra, ...scene.shapes];
      if (src.trace) scene.trace = src.trace;
      scene.image = src.image; // the same picture: share the stored copy
      if (extra.length) log += `\n    ${scene.title}: ${extra.length} shapes carried over from the scene "${src.title}"`;
      break;
    }
    if (!scene.image.startsWith("local:")) scene.image = await storeImage(file, file.name);
  }
  const name = await addProject(project);
  return { name, title: project.title, log };
}
