import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fetchUnits } from "./contentful";
import { applyDetails, type UnitDetails } from "./plot-details";
import type { Project } from "./types";

/** The single data file behind the whole site. Edited with /editor (which
 *  writes it through app/api/project/route.ts in dev) or by hand. */
export const PROJECT_FILE = path.join(process.cwd(), "data", "project.json");

/** Read fresh on every call, so in `next dev` a save in the editor shows up
 *  on the next page load without a restart. */
export async function getProject(): Promise<Project> {
  return JSON.parse(await readFile(PROJECT_FILE, "utf8")) as Project;
}

/**
 * Plot details stored locally: data/plot-details/<project>.json — one object
 * per plot keyed by hotspot ID, with the same field names as the Contentful
 * `unit` entries. Used when Contentful isn't set up (and as its backup).
 */
export const DETAILS_DIR = path.join(process.cwd(), "data", "plot-details");
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "project";
export const detailsFile = (project: Pick<Project, "title">) => path.join(DETAILS_DIR, `${slug(project.title)}.json`);

export async function readLocalDetails(project: Pick<Project, "title">): Promise<Record<string, UnitDetails>> {
  try {
    return JSON.parse(await readFile(detailsFile(project), "utf8")) as Record<string, UnitDetails>;
  } catch {
    return {};
  }
}

/** Adds / replaces plots in the local file (by hotspot ID). Returns the file's path and size. */
export async function saveLocalDetails(project: Pick<Project, "title">, units: UnitDetails[]) {
  const current = await readLocalDetails(project);
  for (const u of units) current[u.hotspotId] = u;
  await mkdir(DETAILS_DIR, { recursive: true });
  const file = detailsFile(project);
  await writeFile(file, JSON.stringify(current, null, 2) + "\n", "utf8");
  return { file: path.relative(process.cwd(), file), count: Object.keys(current).length };
}

/** All plot details: the local file, then Contentful's (when set up) on top. */
export async function getDetails(project: Project): Promise<{ details: Record<string, UnitDetails>; source: "contentful" | "local" }> {
  const contentful = await fetchUnits();
  const local = { ...(project.details ?? {}), ...(await readLocalDetails(project)) };
  return { details: { ...local, ...contentful }, source: Object.keys(contentful).length ? "contentful" : "local" };
}

/** The project as visitors see it: plot details merged onto the shapes by hotspot ID. */
export async function getViewerProject(): Promise<Project> {
  const project = await getProject();
  return applyDetails(project, (await getDetails(project)).details);
}
