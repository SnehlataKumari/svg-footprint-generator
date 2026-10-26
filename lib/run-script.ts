import "server-only";
import { spawn } from "node:child_process";
import { totalmem } from "node:os";
import { get } from "@vercel/blob";

/**
 * Shared by the routes that run a script from scripts/ (app/api/generate,
 * app/api/import-facilities): the script as its own Node process, and the
 * files the hosted editor sends — in the form, or (too big for one request)
 * as Vercel Blob URLs uploaded through app/api/generate/upload.
 */

// Most of the function's memory (on Vercel it is the function size, not the machine's).
const HEAP_MB = Math.min(12000, Math.floor((Number(process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE) || totalmem() / 2 ** 20) * 0.75));

export function runScript(script: string, args: string[]): Promise<{ code: number | null; log: string }> {
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

/** The URLs of the form's files that came through Vercel Blob (to delete once read). */
export const blobUrlsIn = (form: FormData) =>
  [...form.values()].filter((v): v is string => typeof v === "string" && /^https:\/\/[^/]+\.blob\.vercel-storage\.com\//.test(v));

/** An uploaded file: a file in the form, or the URL of one in Vercel Blob. */
export async function uploadedBytes(value: FormDataEntryValue | null, what = "An image"): Promise<Buffer> {
  if (value instanceof File) return Buffer.from(await value.arrayBuffer());
  if (!value || !URL.canParse(value) || !new URL(value).hostname.endsWith(".blob.vercel-storage.com")) throw new Error(`${what} is missing`);
  const blob = await get(value, { access: "private" });
  if (blob?.statusCode !== 200) throw new Error("An uploaded file is gone — try again");
  return Buffer.from(await new Response(blob.stream).arrayBuffer());
}
