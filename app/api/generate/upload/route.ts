import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";

/**
 * Hosted editor, Generate and Import from GIS files: files too big to send
 * with the request (Vercel takes 4.5 MB per request) go to Vercel Blob first —
 * this hands the browser a short-lived upload token (lib/upload.ts).
 * app/api/generate and app/api/import-facilities delete them once read.
 * Needs a Blob store connected to the Vercel project (BLOB_READ_WRITE_TOKEN).
 */
export async function POST(request: Request) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return Response.json({ error: "Large images need a Vercel Blob store connected to this site" }, { status: 501 });
  }
  try {
    const result = await handleUpload({
      body: (await request.json()) as HandleUploadBody,
      request,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: ["image/*", "application/pdf"],
        maximumSizeInBytes: 200 * 1024 * 1024,
        addRandomSuffix: true,
      }),
    });
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Upload failed" }, { status: 400 });
  }
}
