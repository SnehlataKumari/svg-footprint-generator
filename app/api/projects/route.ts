import { readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { getProject, PROJECT_FILE } from "@/lib/project";
import type { Project } from "@/lib/types";

/**
 * Several projects, one open at a time: the open one is data/project.json
 * (what the viewer and editor use); the others wait in data/projects/<name>.json.
 *
 * GET                               → the waiting projects
 * POST { action: "new", title }     → file the open project away, start an empty one
 * POST { action: "open", name }     → file the open project away, open data/projects/<name>.json
 * Dev only for the POSTs, like Save.
 */
const DIR = path.join(process.cwd(), "data", "projects");

export interface ProjectEntry {
  name: string;
  title: string;
  scenes: number;
  updated: string;
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "project";

async function list(): Promise<ProjectEntry[]> {
  const files = (await readdir(DIR).catch(() => [])).filter((f) => f.endsWith(".json"));
  const entries = await Promise.all(
    files.map(async (f) => {
      const file = path.join(DIR, f);
      try {
        const p = JSON.parse(await readFile(file, "utf8")) as Project;
        return { name: f.slice(0, -5), title: p.title || f, scenes: p.scenes?.length ?? 0, updated: (await stat(file)).mtime.toISOString() };
      } catch {
        return null;
      }
    }),
  );
  return entries.filter((e): e is ProjectEntry => !!e).sort((a, b) => b.updated.localeCompare(a.updated));
}

/** Moves the open project into data/projects (an empty, untouched one is just dropped). */
async function fileAwayCurrent() {
  const current = await getProject();
  if (!current.scenes.length) return null;
  const base = slug(current.title);
  const taken = new Set((await readdir(DIR).catch(() => [])).map((f) => f.replace(/\.json$/, "")));
  let name = base;
  for (let n = 2; taken.has(name); n++) name = `${base}-${n}`;
  await writeFile(path.join(DIR, `${name}.json`), JSON.stringify(current, null, 2) + "\n", "utf8");
  return name;
}

export async function GET() {
  return Response.json({ projects: await list() });
}

export async function POST(request: Request) {
  if (process.env.NODE_ENV !== "development") {
    return Response.json({ error: "Switching projects is only available in `npm run dev`" }, { status: 403 });
  }
  const body = (await request.json()) as { action: "new"; title?: string } | { action: "open"; name: string };

  if (body.action === "open") {
    const file = path.join(DIR, `${slug(body.name)}.json`);
    let next: Project;
    try {
      next = JSON.parse(await readFile(file, "utf8")) as Project;
    } catch {
      return Response.json({ error: `No project "${body.name}"` }, { status: 404 });
    }
    // Nothing is lost if this stops half way: the opened project is removed
    // from the waiting list only after it has become data/project.json.
    const filed = await fileAwayCurrent();
    await writeFile(PROJECT_FILE, JSON.stringify(next, null, 2) + "\n", "utf8");
    await rm(file);
    return Response.json({ ok: true, filed });
  }

  if (body.action === "new") {
    const current = await getProject();
    const filed = await fileAwayCurrent();
    const fresh: Project = { title: body.title?.trim() || "New project", startScene: "", categories: [], scenes: [], style: current.style };
    await writeFile(PROJECT_FILE, JSON.stringify(fresh, null, 2) + "\n", "utf8");
    return Response.json({ ok: true, filed });
  }

  return Response.json({ error: "Unknown action" }, { status: 400 });
}
