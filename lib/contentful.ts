import "server-only";
import { UNIT_FIELDS, type UnitDetails } from "./plot-details";

/**
 * Contentful, over its REST APIs (no SDK): plot details as `unit` entries,
 * one per hotspot ID. Settings come from the environment (.env.local — see
 * .example.env); nothing here ever reaches the browser.
 *
 * - publishUnits(): editor upload → create or update + publish each unit
 *   (Content Management API, CONTENTFUL_MANAGEMENT_TOKEN, dev machine only)
 * - fetchUnits(): the viewer reads published units by hotspot ID
 *   (Content Delivery API, CONTENTFUL_DELIVERY_TOKEN), cached for a minute
 */
const env = () => ({
  space: process.env.CONTENTFUL_SPACE_ID ?? "",
  environment: process.env.CONTENTFUL_ENVIRONMENT || "master",
  cma: process.env.CONTENTFUL_MANAGEMENT_TOKEN ?? "",
  cda: process.env.CONTENTFUL_DELIVERY_TOKEN ?? "",
  locale: process.env.CONTENTFUL_LOCALE || "en-US",
});

export const canPublish = () => !!(env().space && env().cma);
export const canRead = () => !!(env().space && (env().cda || env().cma));

/** The entry id for a hotspot: stable, so re-uploading updates instead of duplicating. */
export const unitEntryId = (hotspotId: string) => `unit-${hotspotId.toLowerCase().replace(/[^a-z0-9._-]+/g, "-")}`.slice(0, 64);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function cma(path: string, init: RequestInit & { headers?: Record<string, string> } = {}) {
  const { space, environment, cma: token } = env();
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`https://api.contentful.com/spaces/${space}/environments/${environment}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/vnd.contentful.management.v1+json", ...(init.headers ?? {}) },
      cache: "no-store",
    });
    if (res.status === 429 && attempt < 5) { await sleep(Number(res.headers.get("x-contentful-ratelimit-reset") ?? 1) * 1000 + 200); continue; }
    return res;
  }
}

const contentfulError = async (res: Response) => {
  const body = (await res.json().catch(() => ({}))) as { message?: string; details?: { errors?: { details?: string; path?: string[] }[] } };
  const detail = body.details?.errors?.map((e) => `${e.path?.at(-2) ?? ""} ${e.details ?? ""}`.trim()).join("; ");
  return `${res.status} ${body.message ?? res.statusText}${detail ? ` — ${detail}` : ""}`;
};

/** Fields in Contentful's shape: { field: { locale: value } } (only the model's fields, never `extra`). */
const toFields = (d: UnitDetails, locale: string) =>
  Object.fromEntries(UNIT_FIELDS.filter((f) => d[f.key] !== undefined).map((f) => [f.key, { [locale]: d[f.key] }]));

export interface PublishResult {
  hotspotId: string;
  ok: boolean;
  created?: boolean;
  error?: string;
}

/** Create or update, then publish, one `unit` per row. Sequential (Contentful's rate limit). */
export async function publishUnits(units: UnitDetails[], publish = true): Promise<PublishResult[]> {
  const { locale } = env();
  const results: PublishResult[] = [];
  for (const u of units) {
    try {
      const id = unitEntryId(u.hotspotId);
      const existing = await cma(`/entries/${id}`);
      const version = existing.ok ? ((await existing.json()) as { sys: { version: number } }).sys.version : undefined;
      if (!existing.ok && existing.status !== 404) throw new Error(await contentfulError(existing));
      const saved = await cma(`/entries/${id}`, {
        method: "PUT",
        headers: { "X-Contentful-Content-Type": "unit", ...(version ? { "X-Contentful-Version": String(version) } : {}) },
        body: JSON.stringify({ fields: toFields(u, locale) }),
      });
      if (!saved.ok) throw new Error(await contentfulError(saved));
      if (publish) {
        const v = ((await saved.json()) as { sys: { version: number } }).sys.version;
        const pub = await cma(`/entries/${id}/published`, { method: "PUT", headers: { "X-Contentful-Version": String(v) } });
        if (!pub.ok) throw new Error(await contentfulError(pub));
      }
      results.push({ hotspotId: u.hotspotId, ok: true, created: !version });
    } catch (e) {
      results.push({ hotspotId: u.hotspotId, ok: false, error: (e as Error).message });
    }
  }
  return results;
}

/** Every published `unit`, by hotspot ID. Empty when Contentful isn't set up or can't be reached. */
export async function fetchUnits(): Promise<Record<string, UnitDetails>> {
  if (!canRead()) return {};
  const { space, environment, cda, cma: mgmt, locale } = env();
  const out: Record<string, UnitDetails> = {};
  try {
    for (let skip = 0; ; skip += 1000) {
      const url = cda
        ? `https://cdn.contentful.com/spaces/${space}/environments/${environment}/entries?content_type=unit&limit=1000&skip=${skip}&locale=${locale}`
        : `https://api.contentful.com/spaces/${space}/environments/${environment}/public/entries?content_type=unit&limit=1000&skip=${skip}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${cda || mgmt}` }, next: { revalidate: 60 } });
      if (!res.ok) break;
      const data = (await res.json()) as { items: { fields: Record<string, unknown> }[]; total: number };
      for (const item of data.items) {
        const f = Object.fromEntries(Object.entries(item.fields).map(([k, v]) => [k, v && typeof v === "object" && locale in (v as object) ? (v as Record<string, unknown>)[locale] : v]));
        if (typeof f.hotspotId === "string") out[f.hotspotId] = f as unknown as UnitDetails;
      }
      if (skip + 1000 >= data.total) break;
    }
  } catch {
    // offline / misconfigured: the viewer falls back to the project's own copy
  }
  return out;
}
