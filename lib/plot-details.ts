import type { Category, Project, Shape } from "./types";

/**
 * Plot details — the information about each plot (typology, status, area…),
 * kept apart from its outline. The outline (the polygon) stays in the project;
 * the details live in Contentful as `unit` entries (or, until Contentful is
 * set up, in the project's `details`). The only link is the hotspot ID:
 *
 *   Contentful unit.hotspotId  ==  shape.id in the scene
 *
 * Fields follow the Al Metlaa Contentful schema (content type `unit`).
 */
export interface UnitDetails {
  hotspotId: string;
  zone?: string;
  plotLabel?: string;
  mdTypology?: string;
  facadeOption?: string;
  status?: string;
  mdPlotArea?: number;
  gfa?: number;
  parking?: number;
  confirmed?: boolean;
  /** Columns the Contentful model doesn't have: kept locally and shown on the
   *  details card, not sent to Contentful. */
  extra?: Record<string, string>;
}

export type FieldKind = "text" | "number" | "integer" | "boolean";

export interface FieldDef {
  key: keyof Omit<UnitDetails, "extra">;
  label: string;
  kind: FieldKind;
  required: boolean;
  /** Allowed values (case-insensitive match; the canonical spelling is stored). */
  values?: string[];
  /** Spreadsheet column names that mean this field (compared lower-case, letters/digits only). */
  aliases: string[];
}

export const UNIT_FIELDS: FieldDef[] = [
  { key: "hotspotId", label: "Hotspot ID", kind: "text", required: true, aliases: ["hotspotid", "hotspot", "polygonid", "shapeid"] },
  { key: "zone", label: "Zone", kind: "text", required: true, aliases: ["zone", "phase", "cluster"] },
  { key: "plotLabel", label: "Plot", kind: "text", required: true, aliases: ["plotlabel", "plot", "plotid", "mdplotid", "label", "unit", "unitid"] },
  { key: "mdTypology", label: "Typology", kind: "text", required: true, values: ["Villa 6BR", "Villa 5BR", "Villa 4BR", "Villa 3BR"], aliases: ["mdtypology", "typology", "type", "villatype"] },
  { key: "facadeOption", label: "Facade", kind: "text", required: true, values: ["Type1", "Type2", "Type3", "Type4"], aliases: ["facadeoption", "facade"] },
  { key: "status", label: "Status", kind: "text", required: true, values: ["Available", "Blocked", "Booked", "Sold", "Unassigned"], aliases: ["status", "availability"] },
  { key: "mdPlotArea", label: "Plot area", kind: "number", required: true, aliases: ["mdplotarea", "plotarea", "area", "plotsize"] },
  { key: "gfa", label: "GFA", kind: "number", required: false, aliases: ["gfa", "totalgfa", "grossfloorarea"] },
  { key: "parking", label: "Parking", kind: "integer", required: false, aliases: ["parking", "parkingprovided", "parkingspaces"] },
  { key: "confirmed", label: "Confirmed", kind: "boolean", required: false, aliases: ["confirmed", "verified"] },
];

/** Status colours for the categories the upload can create. */
export const STATUS_COLORS: Record<string, string> = {
  Available: "#22c55e",
  Booked: "#f59e0b",
  Blocked: "#94a3b8",
  Sold: "#ef4444",
  Unassigned: "#64748b",
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
/** GIS / spreadsheet bookkeeping columns: not plot details, never shown. */
const IGNORED = new Set(["sno", "no", "objectid", "fid", "oid", "shape", "shapelength", "shapearea", "shapeleng", "globalid"]);
const EMPTY = /^(|<null>|null|n\/a|na|-|—)$/i;

/** Which field each spreadsheet column is (null = an extra column). */
export function mapHeaders(headers: string[]): (FieldDef | null)[] {
  return headers.map((h) => UNIT_FIELDS.find((f) => f.aliases.includes(norm(h))) ?? null);
}

/** One spreadsheet row → details + what's wrong with it. */
/**
 * One spreadsheet row → details. `errors` make the row unusable (no ID, a
 * value that isn't allowed); `warnings` are filled-in defaults or fields
 * Contentful will want — the row is still saved.
 * Forgiving with GIS exports: no hotspotId column → the plot ID is the hotspot
 * ID; no zone → the cluster / the plot ID's prefix; no status → Unassigned.
 */
export function parseRow(headers: string[], cells: string[]): { details: UnitDetails; errors: string[]; warnings: string[] } {
  const fields = mapHeaders(headers);
  const details = {} as UnitDetails;
  const warnings: string[] = [];
  const errors: string[] = [];
  const extra: Record<string, string> = {};
  fields.forEach((f, i) => {
    const raw = (cells[i] ?? "").trim();
    if (!f) {
      if (raw && !EMPTY.test(raw) && headers[i]?.trim() && !IGNORED.has(norm(headers[i]))) extra[headers[i].trim()] = raw.replace(/^(-?\d+)\.0+$/, "$1");
      return;
    }
    if (EMPTY.test(raw)) return;
    if (f.kind === "number" || f.kind === "integer") {
      const n = Number(raw.replace(/[, ]|m²|sqm|m2/gi, ""));
      if (!Number.isFinite(n)) errors.push(`${f.label}: “${raw}” isn't a number`);
      else (details as unknown as Record<string, number>)[f.key] = f.kind === "integer" ? Math.round(n) : Math.round(n * 100) / 100;
    } else if (f.kind === "boolean") {
      details.confirmed = /^(1|true|yes|y|confirmed|verified)$/i.test(raw);
    } else if (f.values) {
      // forgiving: "6BR" / "villa 6 br" → "Villa 6BR", "type 1" → "Type1", "available" → "Available"
      const match = f.values.find((v) => norm(v) === norm(raw) || norm(v).endsWith(norm(raw)));
      if (match) (details as unknown as Record<string, string>)[f.key] = match;
      else errors.push(`${f.label}: “${raw}” isn't one of ${f.values.join(", ")}`);
    } else {
      (details as unknown as Record<string, string>)[f.key] = raw;
    }
  });
  if (Object.keys(extra).length) details.extra = extra;
  // defaults for what a GIS export doesn't carry
  if (!details.hotspotId && details.plotLabel) details.hotspotId = details.plotLabel;
  if (!details.plotLabel && details.hotspotId) details.plotLabel = details.hotspotId;
  if (!details.zone && details.plotLabel) {
    const prefix = details.plotLabel.match(/^[A-Za-z]+\d+/)?.[0];
    if (prefix) details.zone = prefix;
  }
  if (!details.status && !errors.some((e) => e.startsWith("Status:"))) {
    details.status = "Unassigned";
    warnings.push("Status not given — set to Unassigned");
  }
  if (!details.hotspotId) errors.push("No hotspot ID or plot ID");
  for (const f of UNIT_FIELDS) if (f.required && details[f.key] === undefined && !errors.some((e) => e.startsWith(`${f.label}:`))) warnings.push(`${f.label} is missing`);
  return { details, errors, warnings };
}

/** The details card rows for a plot. */
export function detailsInfo(d: UnitDetails): Record<string, string> {
  const rows: [string, string | undefined][] = [
    ["Plot", d.plotLabel],
    ["Zone", d.zone?.toUpperCase()],
    ["Typology", d.mdTypology],
    ["Facade", d.facadeOption],
    ["Status", d.status],
    ["Plot area", d.mdPlotArea !== undefined ? `${d.mdPlotArea.toLocaleString("en")} m²` : undefined],
    ["GFA", d.gfa !== undefined ? `${d.gfa.toLocaleString("en")} m²` : undefined],
    ["Parking", d.parking !== undefined ? String(d.parking) : undefined],
  ];
  return { ...Object.fromEntries(rows.filter((r): r is [string, string] => !!r[1])), ...(d.extra ?? {}) };
}

/** The category a status maps to: one whose id or label is the status. */
const statusCategory = (categories: Category[], status?: string) =>
  status ? categories.find((c) => norm(c.id) === norm(status) || norm(c.label) === norm(status)) : undefined;

/**
 * The project as the viewer shows it: every shape with details gets them on
 * its card (and its status as its category, when the project has one), its
 * label from plotLabel when it has none of its own. Geometry is untouched.
 */
export function applyDetails(project: Project, details: Record<string, UnitDetails>): Project {
  if (!Object.keys(details).length) return project;
  const withDetails = (s: Shape): Shape => {
    const d = details[s.id];
    if (!d) return s;
    const cat = statusCategory(project.categories, d.status);
    return {
      ...s,
      label: s.label && s.label !== s.id ? s.label : (d.plotLabel ?? s.label),
      info: { ...(s.info ?? {}), ...detailsInfo(d) },
      ...(cat ? { category: cat.id } : {}),
    };
  };
  return { ...project, scenes: project.scenes.map((sc) => ({ ...sc, shapes: sc.shapes.map(withDetails) })) };
}

/** A starting spreadsheet (CSV, opens in Excel) for a scene: one row per plot, hotspot IDs filled in. */
export function templateCsv(shapes: Shape[], zone: string): string {
  const head = UNIT_FIELDS.map((f) => f.key);
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = shapes.filter((s) => s.kind === "polygon").map((s) => head.map((k) => esc(k === "hotspotId" ? s.id : k === "zone" ? zone : k === "plotLabel" ? (s.label || s.id) : "")).join(","));
  return [head.join(","), ...lines].join("\n") + "\n";
}
