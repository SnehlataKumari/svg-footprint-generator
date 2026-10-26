/**
 * Hosted editor: the files a script needs (Generate, Import from GIS files)
 * go with the request — but Vercel takes 4.5 MB per request, so bigger ones go
 * to Vercel Blob first (app/api/generate/upload) and the request carries
 * their URLs. `npm run dev` has no such limit, so it sends everything directly.
 */
export const DIRECT_BYTES = process.env.NODE_ENV === "development" ? Infinity : 4 * 1024 * 1024;

/** Uploads the file to Vercel Blob; returns its URL, to send in the form instead of the file. */
export async function blobUpload(name: string, file: Blob): Promise<string> {
  const { upload } = await import("@vercel/blob/client");
  const blob = await upload(name, file, { access: "private", handleUploadUrl: "/api/generate/upload", contentType: file.type || undefined }).catch((e: Error) => {
    throw new Error(`The files are too big to send directly and the upload failed: ${e.message}`);
  });
  return blob.url;
}
