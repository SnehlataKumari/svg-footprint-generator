import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir, totalmem } from "node:os";
import path from "node:path";
import { del, get } from "@vercel/blob";
import type { GenerateMode, GenerateResult } from "@/lib/generate";
import type { Affine, Category, Scene, Shape } from "@/lib/types";

/**
 * Editor "Generate from reference": runs one of the tracing scripts on the
 * scene the editor sends (saved or not) and returns the shapes for preview.
 * Nothing is written to data/project.json.
 *
 * `npm run dev` sends the scene as JSON and the scripts read its images from
 * public/. The hosted editor (images in the browser) sends a form instead:
 * the scene plus both images — as files, or, when too big for one request,
 * as Vercel Blob URLs (uploaded through ./upload, deleted here once read).
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

// Plots can take a few minutes on a big map (Vercel: the plan's limit applies).
export const maxDuration = 300;

// Most of the function's memory (on Vercel it is the function size, not the machine's).
const HEAP_MB = Math.min(8192, Math.floor((Number(process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE) || totalmem() / 2 ** 20) * 0.75));

function run(script: string, args: string[]): Promise<{ code: number | null; log: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [`--max-old-space-size=${HEAP_MB}`, script, ...args], { cwd: process.cwd() });
    let log = "";
    const add = (d: Buffer) => (log = (log + d.toString()).slice(-20000));
    child.stdout.on("data", add);
    child.stderr.on("data", add);
    child.on("close", (code) => resolve({ code, log }));
    child.on("error", (e) => resolve({ code: 1, log: log + e.message }));
  });
}

/** An uploaded image: a file in the form, or the URL of one in Vercel Blob. */
async function imageBytes(value: FormDataEntryValue | null): Promise<Buffer> {
  if (value instanceof File) return Buffer.from(await value.arrayBuffer());
  if (!value || !new URL(value).hostname.endsWith(".blob.vercel-storage.com")) throw new Error("An image is missing");
  const blob = await get(value, { access: "private" });
  if (blob?.statusCode !== 200) throw new Error("The uploaded image is gone — try again");
  return Buffer.from(await new Response(blob.stream).arrayBuffer());
}

export async function POST(request: Request) {
  const uploaded = request.headers.get("content-type")?.startsWith("multipart/form-data");
  // Without uploaded images the scripts read public/ — only on the dev machine.
  if (!uploaded && process.env.NODE_ENV !== "development") {
    return Response.json({ error: "Send the scene's images with the request" }, { status: 400 });
  }
  const form = uploaded ? await request.formData() : null;
  const { mode, scene } = form
    ? { mode: String(form.get("mode")) as GenerateMode, scene: JSON.parse(String(form.get("scene"))) as Scene }
    : ((await request.json()) as { mode: GenerateMode; scene: Scene });
  const blobUrls = form ? [form.get("image"), form.get("reference")].filter((v): v is string => typeof v === "string") : [];
  if (!(mode in SCRIPTS)) return Response.json({ error: `Unknown mode "${mode}"` }, { status: 400 });
  if (!scene?.trace) return Response.json({ error: "This scene has no reference image" }, { status: 400 });

  const dir = await mkdtemp(path.join(tmpdir(), "generate-"));
  try {
    const sceneFile = path.join(dir, "scene.json");
    const out = path.join(dir, "result.json");
    const args = ["--scene-file", sceneFile, "--out", out];
    if (form) {
      await writeFile(path.join(dir, "image"), await imageBytes(form.get("image")));
      await writeFile(path.join(dir, "reference"), await imageBytes(form.get("reference")));
      scene.image = "image";
      scene.trace.image = "reference";
      args.push("--image-dir", dir);
    }
    await writeFile(sceneFile, JSON.stringify(scene));
    const { code, log } = await run(SCRIPTS[mode], args);
    if (code !== 0) {
      const last = log.trim().split("\n").filter((l) => /error/i.test(l)).pop() ?? log.trim().split("\n").pop();
      return Response.json({ error: last || "The generator stopped", log } satisfies GenerateResult, { status: 500 });
    }
    const result = JSON.parse(await readFile(out, "utf8")) as { shapes: Shape[]; categories?: Category[]; transform?: Affine };
    return Response.json({ ...result, log } satisfies GenerateResult);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Generate failed" } satisfies GenerateResult, { status: 400 });
  } finally {
    await rm(dir, { recursive: true, force: true });
    if (blobUrls.length) await del(blobUrls).catch(() => {});
  }
}
