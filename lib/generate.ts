import { editorStorage, imageUrl } from "./browser-store";
import type { Affine, Category, Scene, Shape } from "./types";

/**
 * "Generate from reference" (editor): app/api/generate runs a tracing script
 * on the scene and returns shapes to preview. The hosted editor sends the
 * scene's images along (they are only in this browser).
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
  const res =
    editorStorage() === "browser"
      ? await sendWithImages(mode, scene).catch((e: Error) => ({ error: e.message }))
      : await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode, scene: { ...scene, shapes: [] } }),
        });
  if (!(res instanceof Response)) return res;
  if (res.status === 504) return { error: "The site's time limit ran out — try a smaller reference image, or the desktop version (npm run dev)" };
  return (await res.json().catch(() => ({ error: `Generate failed (${res.status})` }))) as GenerateResult;
}

// Vercel takes 4.5 MB per request; bigger images go through Vercel Blob first.
const DIRECT_BYTES = 4 * 1024 * 1024;

/** Hosted editor: the images live in this browser, so they go with the request. */
async function sendWithImages(mode: GenerateMode, scene: Scene): Promise<Response> {
  const read = async (src: string) => {
    const res = await fetch(imageUrl(src)).catch(() => null);
    if (!res?.ok) throw new Error(`Couldn't read the image ${src}`);
    return res.blob();
  };
  const [image, reference] = await Promise.all([read(scene.image), read(scene.trace?.image ?? "")]);
  const viaBlob = image.size + reference.size > DIRECT_BYTES;
  const send = async (name: string, file: Blob) => {
    if (!viaBlob) return file;
    const { upload } = await import("@vercel/blob/client");
    const blob = await upload(`generate/${name}`, file, { access: "private", handleUploadUrl: "/api/generate/upload", contentType: file.type || undefined }).catch((e: Error) => {
      throw new Error(`The images are too big to send directly and the upload failed: ${e.message}`);
    });
    return blob.url;
  };
  const body = new FormData();
  body.append("mode", mode);
  body.append("scene", JSON.stringify({ ...scene, shapes: [] }));
  body.append("image", await send("image", image));
  body.append("reference", await send("reference", reference));
  return fetch("/api/generate", { method: "POST", body });
}
