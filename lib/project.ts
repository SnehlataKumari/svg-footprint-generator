import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fetchUnits } from "./contentful";
import { applyDetails } from "./plot-details";
import type { Project } from "./types";

/** The single data file behind the whole site. Edited with /editor (which
 *  writes it through app/api/project/route.ts in dev) or by hand. */
export const PROJECT_FILE = path.join(process.cwd(), "data", "project.json");

/** Read fresh on every call, so in `next dev` a save in the editor shows up
 *  on the next page load without a restart. */
export async function getProject(): Promise<Project> {
  return JSON.parse(await readFile(PROJECT_FILE, "utf8")) as Project;
}

/** The project as visitors see it: plot details (Contentful's when set up,
 *  else the project's own copy) merged onto the shapes by hotspot ID. */
export async function getViewerProject(): Promise<Project> {
  const project = await getProject();
  return applyDetails(project, { ...(project.details ?? {}), ...(await fetchUnits()) });
}
