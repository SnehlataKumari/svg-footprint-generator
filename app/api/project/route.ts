import { writeFile } from "node:fs/promises";
import { getProject, PROJECT_FILE } from "@/lib/project";
import type { Project } from "@/lib/types";

/** The project as JSON, for client components (useProject / InteractiveMapClient)
 *  and anything outside this app. Read per request, so editor saves show up. */
export async function GET() {
  return Response.json(await getProject());
}

/** Editor "Save": overwrites data/project.json. Dev only. */
export async function PUT(request: Request) {
  if (process.env.NODE_ENV !== "development") {
    return Response.json({ error: "Saving is only available in `npm run dev`" }, { status: 403 });
  }
  const project = (await request.json()) as Project;
  if (!Array.isArray(project?.scenes) || typeof project.title !== "string") {
    return Response.json({ error: "Not a project file" }, { status: 400 });
  }
  await writeFile(PROJECT_FILE, JSON.stringify(project, null, 2) + "\n", "utf8");
  return Response.json({ ok: true });
}
