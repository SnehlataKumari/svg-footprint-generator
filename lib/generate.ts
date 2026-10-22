import type { Affine, Category, Scene, Shape } from "./types";

/**
 * "Generate from reference" (editor): app/api/generate runs a tracing script
 * on the scene and returns shapes to preview.
 * - areas: coloured areas tinted over your picture (a sales map with
 *   neighbourhoods / phases coloured in), named from the text inside them
 * - plots: plots outlined by lines drawn over your picture, named from their
 *   labels (white label boxes, e.g. "MT12-V5-001")
 * - lines: routes drawn over your picture in bright colours (metro / bus
 *   lines, roads), solid or dashed — line shapes in the same colour and dash
 * - amenities: small round amenity badges (park, cycling, dining…) — a pin at
 *   each, in one category per badge type; the category carries the icon
 */
export type GenerateMode = "areas" | "plots" | "lines" | "amenities";

export type GenerateResult =
  | { shapes: Shape[]; categories?: Category[]; transform?: Affine; log: string }
  | { error: string; log?: string };

export async function generateFromReference(mode: GenerateMode, scene: Scene): Promise<GenerateResult> {
  const res = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode, scene: { ...scene, shapes: [] } }),
  });
  return (await res.json().catch(() => ({ error: `Generate failed (${res.status})` }))) as GenerateResult;
}
