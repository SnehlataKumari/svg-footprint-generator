import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Project } from "./types";

/** The single data file behind the whole site. Edited with /editor (which
 *  writes it through app/api/project/route.ts in dev) or by hand. */
export const PROJECT_FILE = path.join(process.cwd(), "data", "project.json");

/** Read fresh on every call, so in `next dev` a save in the editor shows up
 *  on the next page load without a restart. */
export async function getProject(): Promise<Project> {
  return JSON.parse(await readFile(PROJECT_FILE, "utf8")) as Project;
}
