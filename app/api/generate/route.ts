import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { GenerateMode, GenerateResult } from "@/lib/generate";
import type { Affine, Category, Scene, Shape } from "@/lib/types";

/**
 * Editor "Generate from reference": runs one of the tracing scripts on the
 * scene the editor sends (saved or not) and returns the shapes for preview.
 * Nothing is written to data/project.json. Dev only.
 *
 * - areas: coloured areas tinted over your picture (scripts/areas-from-reference.mjs)
 * - plots: plots outlined by drawn lines, named from their labels (scripts/plots-from-reference.mjs)
 * - lines: coloured routes drawn over your picture (scripts/lines-from-reference.mjs)
 * - amenities: round amenity badges → pins + a category (with icon) per type (scripts/amenities-from-reference.mjs)
 */
const SCRIPTS: Record<GenerateMode, string> = {
  areas: "scripts/areas-from-reference.mjs",
  plots: "scripts/plots-from-reference.mjs",
  lines: "scripts/lines-from-reference.mjs",
  amenities: "scripts/amenities-from-reference.mjs",
};

function run(script: string, args: string[]): Promise<{ code: number | null; log: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--max-old-space-size=8192", script, ...args], { cwd: process.cwd() });
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
    return Response.json({ error: "Generating is only available in `npm run dev`" }, { status: 403 });
  }
  const { mode, scene } = (await request.json()) as { mode: GenerateMode; scene: Scene };
  if (!(mode in SCRIPTS)) return Response.json({ error: `Unknown mode "${mode}"` }, { status: 400 });
  if (!scene?.trace) return Response.json({ error: "This scene has no reference image" }, { status: 400 });

  const dir = await mkdtemp(path.join(tmpdir(), "generate-"));
  try {
    const sceneFile = path.join(dir, "scene.json");
    const out = path.join(dir, "result.json");
    await writeFile(sceneFile, JSON.stringify(scene));
    const { code, log } = await run(SCRIPTS[mode], ["--scene-file", sceneFile, "--out", out]);
    if (code !== 0) {
      const last = log.trim().split("\n").filter((l) => /error/i.test(l)).pop() ?? log.trim().split("\n").pop();
      return Response.json({ error: last || "The generator stopped", log } satisfies GenerateResult, { status: 500 });
    }
    const result = JSON.parse(await readFile(out, "utf8")) as { shapes: Shape[]; categories?: Category[]; transform?: Affine };
    return Response.json({ ...result, log } satisfies GenerateResult);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
