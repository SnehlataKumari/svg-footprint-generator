import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { del } from "@vercel/blob";
import { blobUrlsIn, runScript, uploadedBytes } from "@/lib/run-script";

/**
 * Editor "Projects ▾ → Import from GIS files…": receives the facilities
 * spreadsheet, the GIS map (GeoPDF), the masterplan image and the phase images
 * with their world files, and runs scripts/import-facilities.mjs on them.
 *
 * - `npm run dev`: the script reads the PDF with poppler and the result is
 *   saved as a new project in data/projects/ (open it from Projects ▾).
 * - Hosted editor (lib/gis-import.ts): the browser has already read the PDF
 *   (`page` = the page rendered, `words` = its labels) and big files come as
 *   Vercel Blob URLs. Nothing is saved: the project goes back to the browser,
 *   which stores it with the images it already has.
 * - One scene of the open project (`world` = its image's world file, `size` =
 *   the image's pixel size): only the facilities on that image come back, as
 *   { shapes, categories } for the editor to add (lib/gis-import.ts). Nothing
 *   is saved, in either mode.
 */
const PROJECTS = path.join(process.cwd(), "data", "projects");
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "imported";
/** A file's own name, without folders or odd characters. */
const safeName = (name: string) => path.basename(name).replace(/[^\w.\- ]+/g, "_");

// A big map takes 1–2 minutes (Vercel: the plan's limit applies).
export const maxDuration = 300;

export async function POST(request: Request) {
  const form = await request.formData();
  const hosted = form.has("page");
  // Without the PDF read in the browser the script needs poppler and writes data/projects/ — only on the dev machine.
  if (!hosted && process.env.NODE_ENV !== "development") {
    return Response.json({ error: "Read the map PDF in the browser first" }, { status: 400 });
  }
  const blobUrls = blobUrlsIn(form);
  const title = String(form.get("title") ?? "").trim() || "Imported project";
  const files = (key: string) => form.getAll(key);
  const names = form.getAll("phaseNames").map(String); // hosted: a Blob URL has no file name of its own
  const nameOf = (v: FormDataEntryValue, i: number) => (v instanceof File ? v.name : (names[i] ?? ""));
  const dir = await mkdtemp(path.join(tmpdir(), "import-"));
  const into = form.get("world");
  try {
    if (!form.get("xlsx") || !form.get("pdf") || (!into && (!form.get("masterplan") || !files("phases").length))) {
      const all = into ? "the spreadsheet and the map PDF" : "all four: the spreadsheet, the map PDF, the masterplan image and the phase images";
      return Response.json({ error: `Add ${all}` }, { status: 400 });
    }
    const save = async (value: FormDataEntryValue | null, name: string, what: string, folder = dir) => {
      const to = path.join(folder, safeName(name));
      await writeFile(to, await uploadedBytes(value, what));
      return to;
    };
    const args = [
      "--xlsx", await save(form.get("xlsx"), "facilities.xlsx", "The spreadsheet"),
      "--pdf", await save(form.get("pdf"), "map.pdf", "The map PDF"),
      "--title", title,
    ];
    if (into) {
      // the world file keeps its name: MT11.wpw → the facilities of cluster MT11
      args.push("--into", await save(into, into instanceof File ? into.name : "scene.wld", "The world file"), "--size", String(form.get("size")));
    } else {
      const phaseDir = path.join(dir, "phases");
      await mkdir(phaseDir);
      for (const [i, f] of files("phases").entries()) await save(f, nameOf(f, i), "A phase file", phaseDir);
      const masterplan = form.get("masterplan")!;
      args.push("--masterplan", await save(masterplan, `masterplan${path.extname(nameOf(masterplan, -1)) || ".webp"}`, "The masterplan"), "--phases", phaseDir);
    }
    let name = slug(title);
    const out = path.join(dir, "result.json");
    if (hosted) {
      args.push("--page", await save(form.get("page"), "page.png", "The rendered map"));
      await writeFile(path.join(dir, "words.json"), String(form.get("words") ?? ""));
      args.push("--words", path.join(dir, "words.json"));
    }
    if (into) args.push("--out", out);
    else if (hosted) args.push("--no-copy", "--out", out);
    else {
      // a unique project name (never overwrites a waiting project)
      await mkdir(PROJECTS, { recursive: true });
      const taken = new Set((await readdir(PROJECTS)).map((f) => f.replace(/\.json$/, "")));
      for (let n = 2; taken.has(name); n++) name = `${slug(title)}-${n}`;
      args.push("--slug", name, "--out", path.join(PROJECTS, `${name}.json`));
      if (form.get("carryPlots") === "1") args.push("--plots-from", path.join(process.cwd(), "data", "project.json"));
    }
    const { code, log } = await runScript("scripts/import-facilities.mjs", args);
    if (code !== 0) {
      const last = log.trim().split("\n").filter((l) => /error|missing|no geo/i.test(l)).pop() ?? log.trim().split("\n").pop();
      return Response.json({ error: last || "The import stopped", log }, { status: 500 });
    }
    if (into) return Response.json({ ok: true, log, ...JSON.parse(await readFile(out, "utf8")) });
    if (hosted) return Response.json({ ok: true, title, log, project: JSON.parse(await readFile(out, "utf8")) });
    return Response.json({ ok: true, name, title, log });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "The import failed" }, { status: 400 });
  } finally {
    await rm(dir, { recursive: true, force: true });
    if (blobUrls.length) await del(blobUrls).catch(() => {});
  }
}
