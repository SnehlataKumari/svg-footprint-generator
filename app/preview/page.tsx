"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { InteractiveMap } from "@/components/viewer/interactive-map";
import { openedProject, setEditorStorage } from "@/lib/browser-store";
import { applyDetails } from "@/lib/plot-details";
import type { Project } from "@/lib/types";

/** The hosted editor's Preview: the project saved in this browser, shown as visitors would see it. */
function Preview() {
  setEditorStorage("browser");
  const sceneId = useSearchParams().get("scene") ?? undefined;
  const [project, setProject] = useState<Project | null>(null);
  useEffect(() => {
    openedProject().then((p) => setProject(applyDetails(p, p.details ?? {})));
  }, []);
  if (!project) return <p className="fixed inset-0 flex items-center justify-center bg-neutral-900 text-sm text-neutral-400">Loading…</p>;
  if (!project.scenes.length) return <p className="fixed inset-0 flex items-center justify-center bg-neutral-100 text-sm text-neutral-600">Nothing saved in this browser yet — open the editor, add a scene and Save.</p>;
  return (
    <main className="fixed inset-0">
      <InteractiveMap project={project} sceneId={sceneId} navigation="inline" editorLink />
    </main>
  );
}

export default function PreviewPage() {
  return (
    <Suspense>
      <Preview />
    </Suspense>
  );
}
