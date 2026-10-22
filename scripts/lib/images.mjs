import path from "node:path";

/**
 * Where a scene's image is read from: public/ (`npm run dev`), or the folder
 * given with `--image-dir` — the hosted editor sends its images along and
 * app/api/generate saves them there.
 */
export function imageFile(root, imageDir, src) {
  if (imageDir) return path.join(imageDir, path.basename(src));
  if (/^https?:/.test(src)) throw new Error(`Only images under /public can be read (${src})`);
  return path.join(root, "public", src);
}
