import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const UPLOAD_DIR = path.join(process.cwd(), "public", "scenes");
const ALLOWED = /\.(png|jpe?g|webp|avif|gif|svg)$/i;

/** Editor image upload: saves the file into public/scenes/ and returns its
 *  public URL. Dev only. An existing file with the same name is replaced. */
export async function POST(request: Request) {
  if (process.env.NODE_ENV !== "development") {
    return Response.json({ error: "Uploading is only available in `npm run dev`" }, { status: 403 });
  }
  const file = (await request.formData()).get("file");
  if (!(file instanceof File)) return Response.json({ error: "No file" }, { status: 400 });

  // Keep the name readable but safe: no directories, no odd characters.
  const name = path.basename(file.name).toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
  if (!ALLOWED.test(name)) return Response.json({ error: "Unsupported image type" }, { status: 400 });

  await mkdir(UPLOAD_DIR, { recursive: true });
  await writeFile(path.join(UPLOAD_DIR, name), Buffer.from(await file.arrayBuffer()));
  return Response.json({ src: `/scenes/${name}` });
}
