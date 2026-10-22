import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Editor "Projects ▾ → Import from GIS files…": receives the facilities
 * spreadsheet, the GIS map (GeoPDF), the masterplan image and the phase images
 * with their world files, runs scripts/import-facilities.mjs on them and saves
 * the result as a new project in data/projects/ (open it from Projects ▾).
 * Dev only, like Save.
 */
const PROJECTS = path.join(process.cwd(), "data", "projects");
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "imported";
/** A file's own name, without folders or odd characters. */
const safeName = (name: string) => path.basename(name).replace(/[^\w.\- ]+/g, "_");

function run(args: string[]): Promise<{ code: number | null; log: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--max-old-space-size=12000", "scripts/import-facilities.mjs", ...args], { cwd: process.cwd() });
    let log = "";
    const add = (d: Buffer) => (log = (log + d.toString()).slice(-20000));
    child.stdout.on("data", add);
    child.stderr.on("data", add);
    child.on("close", (code) => resolve({ code, log }));
    child.on("error", (e) => resolve({ code: 1, log: log + e.message }));
  });
}

export async function POST(request: Request) {
  if (process.env.NODE_ENV !== "development") {
    return Response.json({ error: "Importing is only available in `npm run dev`" }, { status: 403 });
  }
  const form = await request.formData();
  const title = String(form.get("title") ?? "").trim() || "Imported project";
  const xlsx = form.get("xlsx"), pdf = form.get("pdf"), masterplan = form.get("masterplan");
  const phases = form.getAll("phases").filter((f): f is File => f instanceof File);
  if (!(xlsx instanceof File) || !(pdf instanceof File) || !(masterplan instanceof File) || !phases.length) {
    return Response.json({ error: "Add all four: the spreadsheet, the map PDF, the masterplan image and the phase images" }, { status: 400 });
  }

  const dir = await mkdtemp(path.join(tmpdir(), "import-"));
  try {
    const save = async (f: File, to: string) => {
      await writeFile(to, Buffer.from(await f.arrayBuffer()));
      return to;
    };
    const phaseDir = path.join(dir, "phases");
    await mkdir(phaseDir);
    for (const f of phases) await save(f, path.join(phaseDir, safeName(f.name)));
    // a unique project name (never overwrites a waiting project)
    await mkdir(PROJECTS, { recursive: true });
    const taken = new Set((await readdir(PROJECTS)).map((f) => f.replace(/\.json$/, "")));
    let name = slug(title);
    for (let n = 2; taken.has(name); n++) name = `${slug(title)}-${n}`;
    const args = [
      "--xlsx", await save(xlsx, path.join(dir, safeName(xlsx.name))),
      "--pdf", await save(pdf, path.join(dir, safeName(pdf.name))),
      "--masterplan", await save(masterplan, path.join(dir, safeName(masterplan.name))),
      "--phases", phaseDir,
      "--title", title,
      "--slug", name,
      "--out", path.join(PROJECTS, `${name}.json`),
    ];
    if (form.get("carryPlots") === "1") args.push("--plots-from", path.join(process.cwd(), "data", "project.json"));
    const { code, log } = await run(args);
    if (code !== 0) {
      const last = log.trim().split("\n").filter((l) => /error|missing|no geo/i.test(l)).pop() ?? log.trim().split("\n").pop();
      return Response.json({ error: last || "The import stopped", log }, { status: 500 });
    }
    return Response.json({ ok: true, name, title, log });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
