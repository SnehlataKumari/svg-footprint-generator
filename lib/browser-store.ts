import type { Project } from "./types";

/**
 * Where the editor keeps its work:
 * - "files"   — `npm run dev`: data/project.json and public/scenes/ through
 *               the dev API routes (app/api/*).
 * - "browser" — the hosted editor (Vercel, read-only disk): everything stays
 *               in the visitor's own browser, in IndexedDB. Uploaded images
 *               are stored there too and referenced as `local:<id>` — use
 *               imageUrl() wherever an image is loaded.
 *
 * Browser storage is per device and per browser and can be cleared by the
 * visitor, so the editor offers "Download backup" (images included).
 */
export type EditorStorage = "files" | "browser";

let mode: EditorStorage = "files";
export const setEditorStorage = (m: EditorStorage) => {
  mode = m;
};
export const editorStorage = () => mode;

export const EMPTY_PROJECT: Project = { title: "New project", startScene: "", categories: [], scenes: [] };

// ---- IndexedDB ----------------------------------------------------------------

const DB = "interactive-map-editor";
type Store = "projects" | "images" | "meta";

let dbPromise: Promise<IDBDatabase> | null = null;
function db() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      for (const s of ["projects", "images", "meta"]) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("This browser can't store data (private window?)"));
  });
  return dbPromise;
}

async function tx<T>(store: Store, write: boolean, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, write ? "readwrite" : "readonly");
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req.result);
    t.onerror = () => reject(t.error ?? new Error("Browser storage failed"));
    t.onabort = () => reject(t.error ?? new Error("Browser storage is full — download a backup and delete old projects"));
  });
}
const get = <T>(store: Store, key: string) => tx<T | undefined>(store, false, (s) => s.get(key) as IDBRequest<T | undefined>);
const put = (store: Store, key: string, value: unknown) => tx(store, true, (s) => s.put(value, key));
const del = (store: Store, key: string) => tx(store, true, (s) => s.delete(key));
const keys = (store: Store) => tx(store, false, (s) => s.getAllKeys()).then((k) => k.map(String));

// ---- Images -------------------------------------------------------------------

export const LOCAL_PREFIX = "local:";
const urls = new Map<string, string>();

/** A loadable URL for an image reference (`local:<id>` → its object URL). */
export function imageUrl(src: string): string {
  return src.startsWith(LOCAL_PREFIX) ? (urls.get(src) ?? "") : src;
}

/** Stores an uploaded image in the browser; returns its `local:` reference. */
export async function storeImage(file: Blob, name: string): Promise<string> {
  const safe = name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").slice(-60);
  const src = `${LOCAL_PREFIX}${crypto.randomUUID().slice(0, 8)}-${safe}`;
  await put("images", src, file);
  urls.set(src, URL.createObjectURL(file));
  return src;
}

/** Every browser-stored file the project uses: scene and reference images, and the plot details' attached images / documents. */
const imagesOf = (p: Project) =>
  [
    ...p.scenes.flatMap((s) => [s.image, s.trace?.image ?? ""]),
    ...Object.values(p.details ?? {}).flatMap((d) => [...(d.images ?? []), ...(d.documents ?? []).map((a) => a.url)]),
  ].filter((src) => src.startsWith(LOCAL_PREFIX));

/** Makes the project's stored images loadable (call before showing it). */
export async function loadImages(p: Project) {
  for (const src of imagesOf(p)) {
    if (urls.has(src)) continue;
    const blob = await get<Blob>("images", src);
    if (blob) urls.set(src, URL.createObjectURL(blob));
  }
}

// ---- Projects -----------------------------------------------------------------

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "project";

export interface StoredProjectEntry {
  name: string;
  title: string;
  scenes: number;
  updated: string;
}

/** The open project (the one /editor shows), or an empty one. */
export async function openedProject(): Promise<Project> {
  const name = await get<string>("meta", "current");
  const p = (name && (await get<{ project: Project }>("projects", name))?.project) || EMPTY_PROJECT;
  await loadImages(p);
  return p;
}

/** A name no stored project has yet, from the title. */
async function freeName(title: string) {
  const taken = new Set(await keys("projects"));
  let n = slug(title);
  for (let i = 2; taken.has(n); i++) n = `${slug(title)}-${i}`;
  return n;
}

async function currentName(p: Project) {
  const name = await get<string>("meta", "current");
  if (name) return name;
  const n = await freeName(p.title);
  await put("meta", "current", n);
  return n;
}

export async function saveProject(p: Project) {
  await put("projects", await currentName(p), { project: p, updated: new Date().toISOString() });
}

/** Stores another project (e.g. imported) without opening it; returns its name for openProject(). */
export async function addProject(p: Project): Promise<string> {
  const name = await freeName(p.title);
  await put("projects", name, { project: p, updated: new Date().toISOString() });
  return name;
}

/** Every project in this browser except the open one. */
export async function listProjects(): Promise<StoredProjectEntry[]> {
  const current = await get<string>("meta", "current");
  const out: StoredProjectEntry[] = [];
  for (const name of await keys("projects")) {
    if (name === current) continue;
    const rec = await get<{ project: Project; updated: string }>("projects", name);
    if (rec) out.push({ name, title: rec.project.title, scenes: rec.project.scenes.length, updated: rec.updated });
  }
  return out.sort((a, b) => b.updated.localeCompare(a.updated));
}

/** Starts an empty project (the open one stays in the list). */
export async function newProject(title: string) {
  const fresh: Project = { ...EMPTY_PROJECT, title: title.trim() || "New project" };
  await del("meta", "current");
  await saveProject(fresh);
}

export async function openProject(name: string) {
  if (!(await get("projects", name))) throw new Error(`No project "${name}" in this browser`);
  await put("meta", "current", name);
}

/** Deletes a project and the images only it used. */
export async function deleteProject(name: string) {
  const rec = await get<{ project: Project }>("projects", name);
  await del("projects", name);
  if (!rec) return;
  const stillUsed = new Set<string>();
  for (const k of await keys("projects")) {
    const other = await get<{ project: Project }>("projects", k);
    if (other) imagesOf(other.project).forEach((s) => stillUsed.add(s));
  }
  for (const src of imagesOf(rec.project)) if (!stillUsed.has(src)) await del("images", src);
}

// ---- Backup: the project with its images inside -------------------------------

const toDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

/** The project as one JSON file, its browser-stored images embedded as data URLs (`images`). */
export async function backupJson(p: Project): Promise<string> {
  const images: Record<string, string> = {};
  for (const src of imagesOf(p)) {
    const blob = await get<Blob>("images", src);
    if (blob) images[src] = await toDataUrl(blob);
  }
  return JSON.stringify({ ...p, images }, null, 2);
}

/** Reads a backup's embedded images back into browser storage; returns the project without them. */
export async function restoreImages(data: Project & { images?: Record<string, string> }): Promise<Project> {
  const { images, ...project } = data;
  for (const [src, dataUrl] of Object.entries(images ?? {})) {
    if (!src.startsWith(LOCAL_PREFIX)) continue;
    const blob = await (await fetch(dataUrl)).blob();
    await put("images", src, blob);
    urls.set(src, URL.createObjectURL(blob));
  }
  return project as Project;
}
