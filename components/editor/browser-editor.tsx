"use client";

import { useEffect, useState } from "react";
import { openedProject, setEditorStorage } from "@/lib/browser-store";
import type { Project } from "@/lib/types";
import { Editor } from "./editor";

/**
 * The hosted editor (e.g. on Vercel, where the server can't write files):
 * the same editor, keeping projects and images in this browser
 * (lib/browser-store.ts) instead of data/ and public/.
 */
export function BrowserEditor({ initialSceneId }: { initialSceneId?: string }) {
  setEditorStorage("browser");
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    openedProject().then(setProject, (e: Error) => setError(e.message));
  }, []);

  if (error) return <p className="fixed inset-0 flex items-center justify-center bg-neutral-100 p-6 text-sm text-red-700">Can&apos;t open the editor: {error}</p>;
  if (!project) return <p className="fixed inset-0 flex items-center justify-center bg-neutral-100 text-sm text-neutral-500">Loading…</p>;
  return <Editor initialProject={project} initialSceneId={initialSceneId} />;
}
