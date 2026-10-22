import { canPublish, canRead, fetchUnits, publishUnits } from "@/lib/contentful";
import { parseRow, type UnitDetails } from "@/lib/plot-details";
import { getProject } from "@/lib/project";
import { readSheet } from "@/lib/sheet";

/**
 * Plot details (lib/plot-details.ts).
 * GET                       → details by hotspot ID: Contentful's when set up, else the project's copy
 * POST multipart {file}     → the spreadsheet parsed and checked (rows + errors), nothing saved
 * PUT  { units, publish }   → publish the units to Contentful (dev only); the editor keeps its own copy
 */
export async function GET() {
  const fromContentful = await fetchUnits();
  const local = (await getProject()).details ?? {};
  return Response.json({ source: Object.keys(fromContentful).length ? "contentful" : "project", details: { ...local, ...fromContentful } });
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
  if (process.env.NODE_ENV !== "development") return Response.json({ error: "Publishing is only available in `npm run dev`" }, { status: 403 });
  if (!canPublish()) return Response.json({ error: "Contentful isn't set up: add CONTENTFUL_SPACE_ID and CONTENTFUL_MANAGEMENT_TOKEN to .env.local (see .example.env), then restart `npm run dev`" }, { status: 400 });
  const { units, publish = true } = (await request.json()) as { units: UnitDetails[]; publish?: boolean };
  const results = await publishUnits(units, publish);
  return Response.json({ results, ok: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length });
}
