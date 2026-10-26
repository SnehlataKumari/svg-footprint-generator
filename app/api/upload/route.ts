import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const UPLOAD_DIR = path.join(process.cwd(), "public", "scenes");
const PLOT_FILES = path.join(process.cwd(), "public", "plot-files");
const ALLOWED = /\.(png|jpe?g|webp|avif|gif|svg)$/i;
/** A plot's files: images and PDFs. */
const PLOT_ALLOWED = /\.(png|jpe?g|webp|avif|gif|svg|pdf)$/i;
const safe = (s: string) => s.toLowerCase().replace(/[^a-z0-9._-]+/g, "-");

/** Editor upload: saves the file and returns its public URL. Dev only. An
 *  existing file with the same name is replaced.
 *  - an image (scene / reference / icon) → public/scenes/
 *  - with `plot` (a hotspot ID): an image or PDF for that plot's card →
 *    public/plot-files/<plot>/ (referenced from its plot details) */
export async function POST(request: Request) {
  if (process.env.NODE_ENV !== "development") {
    return Response.json({ error: "Uploading is only available in `npm run dev`" }, { status: 403 });
  }
  const form = await request.formData();
  const file = form.get("file"), plot = form.get("plot");
  if (!(file instanceof File)) return Response.json({ error: "No file" }, { status: 400 });

  // Keep the name readable but safe: no directories, no odd characters.
  const name = safe(path.basename(file.name));
  if (typeof plot === "string" && plot) {
    if (!PLOT_ALLOWED.test(name)) return Response.json({ error: "Only images and PDFs can be attached" }, { status: 400 });
    const folder = safe(plot).replace(/^\.+/, "") || "plot"; // never "..": stays inside plot-files/
    await mkdir(path.join(PLOT_FILES, folder), { recursive: true });
    await writeFile(path.join(PLOT_FILES, folder, name), Buffer.from(await file.arrayBuffer()));
    return Response.json({ src: `/plot-files/${folder}/${name}` });
  }
  if (!ALLOWED.test(name)) return Response.json({ error: "Unsupported image type" }, { status: 400 });

  await mkdir(UPLOAD_DIR, { recursive: true });
  await writeFile(path.join(UPLOAD_DIR, name), Buffer.from(await file.arrayBuffer()));
  return Response.json({ src: `/scenes/${name}` });
}
