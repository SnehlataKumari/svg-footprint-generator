import { canPublish, canRead, publishUnits } from "@/lib/contentful";
import { parseRow, type UnitDetails } from "@/lib/plot-details";
import { getDetails, getProject, saveLocalDetails } from "@/lib/project";
import { readSheet } from "@/lib/sheet";

/**
 * Plot details (lib/plot-details.ts).
 * GET                        → details by hotspot ID: the local file (data/plot-details/<project>.json),
 *                              Contentful's on top when set up
 * POST multipart {file}      → the spreadsheet parsed and checked (rows + errors), nothing saved
 * PUT { units, publish? }    → saved to the local file; with publish, also to Contentful (dev only)
 */
export async function GET() {
  const { details, source } = await getDetails(await getProject());
  return Response.json({ source, details });
}

export async function POST(request: Request) {
  const file = (await request.formData()).get("file");
  if (!(file instanceof File)) return Response.json({ error: "No spreadsheet" }, { status: 400 });
  try {
    const sheet = readSheet(file.name, Buffer.from(await file.arrayBuffer()));
    const rows = sheet.rows.map((cells) => parseRow(sheet.headers, cells));
    return Response.json({ headers: sheet.headers, rows, contentful: { publish: canPublish(), read: canRead() } });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function PUT(request: Request) {
  if (process.env.NODE_ENV !== "development") return Response.json({ error: "Saving is only available in `npm run dev`" }, { status: 403 });
  const { units, publish = false } = (await request.json()) as { units: UnitDetails[]; publish?: boolean };
  if (!Array.isArray(units)) return Response.json({ error: "No units" }, { status: 400 });
  const local = await saveLocalDetails(await getProject(), units);
  if (!publish) return Response.json({ local });
  if (!canPublish()) return Response.json({ local, error: "Saved locally. Contentful isn't set up: add CONTENTFUL_SPACE_ID and CONTENTFUL_MANAGEMENT_TOKEN to .env.local (see .example.env), then restart `npm run dev`" }, { status: 400 });
  const results = await publishUnits(units, true);
  return Response.json({ local, results, ok: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length });
}
