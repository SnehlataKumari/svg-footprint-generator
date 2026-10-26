"use client";

import { useEffect, useState } from "react";
import { deleteProject, editorStorage, listProjects, newProject, openProject } from "@/lib/browser-store";
import { BUTTON, INPUT, LABEL, PRIMARY_BUTTON } from "../ui";
import { ImportFacilities } from "./import-facilities";

interface Entry {
  name: string;
  title: string;
  scenes: number;
  updated: string;
}

interface Props {
  title: string;
  /** Unsaved changes: they're saved before switching. */
  dirty: boolean;
  onSave: () => Promise<boolean>;
  /** Called right before the page reloads into the other project. */
  onLeave: () => void;
  onStatus: (message: string, error?: boolean) => void;
}

/**
 * New project / open another one. The open project is filed away in
 * data/projects/ (nothing is deleted), then the editor reloads.
 */
export function ProjectSwitcher({ title, dirty, onSave, onLeave, onStatus }: Props) {
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<Entry[] | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const inBrowser = editorStorage() === "browser";

  useEffect(() => {
    if (!open) return;
    let live = true;
    (inBrowser ? listProjects() : fetch("/api/projects").then((r) => r.json()).then((d: { projects: Entry[] }) => d.projects))
      .then((list) => live && setProjects(list))
      .catch(() => live && setProjects([]));
    return () => {
      live = false;
    };
  }, [open, inBrowser, refresh]);

  const switchTo = async (body: { action: "new"; title: string } | { action: "open"; name: string }) => {
    setBusy(true);
    try {
      if (dirty && !(await onSave())) return;
      if (inBrowser) {
        if (body.action === "new") await newProject(body.title);
        else await openProject(body.name);
        onLeave();
        return window.location.reload();
      }
      const res = await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) return onStatus(data.error ?? `Failed (${res.status})`, true);
      onLeave();
      window.location.reload(); // a fresh editor for the other project
    } catch (e) {
      onStatus((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (p: Entry) => {
    if (!window.confirm(`Delete “${p.title}” from this browser? Download a backup first if you may need it.`)) return;
    await deleteProject(p.name);
    setRefresh((n) => n + 1);
  };

  return (
    <div className="space-y-2">
      {importing && <ImportFacilities onClose={() => setImporting(false)} onOpen={(name) => switchTo({ action: "open", name })} />}
      <button type="button" className={`${BUTTON} w-full justify-between`} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span>Projects</span>
        <span className="text-xs opacity-60">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div className="space-y-3 rounded-md border border-black/10 bg-neutral-50 p-2 text-sm">
          <form
            className="space-y-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              switchTo({ action: "new", title: newTitle });
            }}
          >
            <span className={LABEL}>New project</span>
            <input className={INPUT} value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Project name" />
            <button type="submit" className={`${PRIMARY_BUTTON} w-full`} disabled={busy}>
              + Create and open
            </button>
            <p className="text-xs text-neutral-500">
              “{title}” is {dirty ? "saved, then " : ""}kept {inBrowser ? "in this browser" : <>under <code>data/projects/</code></>} — open it again from the list below.
            </p>
          </form>

          <div className="space-y-1">
            <span className={LABEL}>From GIS files</span>
            <button type="button" className={`${BUTTON} w-full`} disabled={busy} onClick={() => setImporting(true)}>
              Import from GIS files…
            </button>
            <p className="text-xs text-neutral-500">Facilities spreadsheet + map PDF + masterplan + phase images → a ready project.</p>
          </div>

          <div className="space-y-1">
            <span className={LABEL}>Other projects</span>
            {projects === null ? (
              <p className="text-xs text-neutral-500">Loading…</p>
            ) : projects.length === 0 ? (
              <p className="text-xs text-neutral-500">None yet.</p>
            ) : (
              <ul className="space-y-1">
                {projects.map((p) => (
                  <li key={p.name} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate" title={p.title}>
                      {p.title} <span className="text-xs text-neutral-400">· {p.scenes} scene{p.scenes === 1 ? "" : "s"}</span>
                    </span>
                    <button type="button" className={`${BUTTON} h-7 text-xs`} disabled={busy} onClick={() => switchTo({ action: "open", name: p.name })}>
                      Open
                    </button>
                    {inBrowser && (
                      <button type="button" className={`${BUTTON} h-7 text-xs`} disabled={busy} onClick={() => remove(p)} aria-label={`Delete ${p.title}`}>
                        ✕
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
