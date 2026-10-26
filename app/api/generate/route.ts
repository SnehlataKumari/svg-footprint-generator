import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { del } from "@vercel/blob";
import type { GenerateMode, GenerateResult } from "@/lib/generate";
import { blobUrlsIn, runScript, uploadedBytes } from "@/lib/run-script";
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

export async function POST(request: Request) {
  const uploaded = request.headers.get("content-type")?.startsWith("multipart/form-data");
  // Without uploaded images the scripts read public/ — only on the dev machine.
  if (!uploaded && process.env.NODE_ENV !== "development") {
    return Response.json({ error: "Send the scene's images with the request" }, { status: 400 });
  }
  const form = uploaded ? await request.formData() : null;
  const { mode, scene, prefix } = form
    ? { mode: String(form.get("mode")) as GenerateMode, scene: JSON.parse(String(form.get("scene"))) as Scene, prefix: String(form.get("prefix") ?? "") }
    : ((await request.json()) as { mode: GenerateMode; scene: Scene; prefix?: string });
  const blobUrls = form ? blobUrlsIn(form) : [];
  if (!(mode in SCRIPTS)) return Response.json({ error: `Unknown mode "${mode}"` }, { status: 400 });
  if (!scene?.trace) return Response.json({ error: "This scene has no reference image" }, { status: 400 });

  const dir = await mkdtemp(path.join(tmpdir(), "generate-"));
  try {
    const sceneFile = path.join(dir, "scene.json");
    const out = path.join(dir, "result.json");
    const args = ["--scene-file", sceneFile, "--out", out];
    if (mode === "plots" && prefix?.trim()) args.push("--prefix", prefix.trim()); // plot names: your prefix instead of the labels'
    if (form) {
      await writeFile(path.join(dir, "image"), await uploadedBytes(form.get("image")));
      await writeFile(path.join(dir, "reference"), await uploadedBytes(form.get("reference")));
      scene.image = "image";
      scene.trace.image = "reference";
      args.push("--image-dir", dir);
    }
    await writeFile(sceneFile, JSON.stringify(scene));
    const { code, log } = await runScript(SCRIPTS[mode], args);
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
