"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { sceneHref } from "@/lib/scene-tree";
import type { Project } from "@/lib/types";
import { SceneViewer } from "./scene-viewer";

export interface InteractiveMapProps {
  /** The data (from getProject() on the server, or useProject() in the browser). */
  project: Project;
  /** Scene to show. Default: the project's start scene. In inline mode,
   *  changing it moves the map to that scene. */
  sceneId?: string;
  /**
   * route  — every scene has its own URL (/scene/<id>); clicking a plot
   *          navigates. Back/forward and shared links work.
   * inline — scenes switch inside this component; the page URL never changes.
   *          Use it to embed the map in any page (a section, a modal, a tab).
   */
  navigation?: "route" | "inline";
  /** Inline mode: told about every scene change (e.g. to sync your own UI). */
  onSceneChange?: (sceneId: string) => void;
  /** Size it with this (e.g. "h-[600px] rounded-xl"). Default fills the parent. */
  className?: string;
  /** Dev only: show "Back to editor" (the full-screen preview sets it). */
  editorLink?: boolean;
}

/**
 * The map, ready to drop into any page. It's a client component with plain
 * serializable props, so it can be rendered:
 *  - from a SERVER component:  <InteractiveMap project={await getProject()} />
 *    (or use <InteractiveMapServer>, which does that for you)
 *  - from a CLIENT component:  const { project } = useProject(); …
 *    (or use <InteractiveMapClient>, which does that for you)
 */
export function InteractiveMap({ project, sceneId, navigation = "inline", onSceneChange, className = "h-full w-full", editorLink = false }: InteractiveMapProps) {
  const router = useRouter();
  const startId = project.scenes.some((s) => s.id === project.startScene) ? project.startScene : project.scenes[0]?.id;
  const [inlineScene, setInlineScene] = useState(sceneId ?? startId);
  // Inline mode: a new `sceneId` from the parent (e.g. its own menu) wins.
  const [lastProp, setLastProp] = useState(sceneId);
  if (lastProp !== sceneId) {
    setLastProp(sceneId);
    if (sceneId) setInlineScene(sceneId);
  }
  const current = navigation === "inline" ? inlineScene : (sceneId ?? startId);

  if (!current || !project.scenes.some((s) => s.id === current)) {
    return (
      <div className={`${className} flex items-center justify-center bg-neutral-900 p-6 text-sm text-white/70`}>
        {project.scenes.length ? `Scene "${current}" not found.` : "No scenes yet — add one in /editor."}
      </div>
    );
  }

  return (
    <div className={className}>
      <SceneViewer
        // A new key per scene: fresh zoom, card and arrival animation.
        key={current}
        project={project}
        sceneId={current}
        globalKeys={navigation === "route"}
        editorHref={editorLink ? `/editor?scene=${encodeURIComponent(current)}` : undefined}
        onPrefetch={navigation === "route" ? (id) => router.prefetch(sceneHref(id)) : undefined}
        onNavigate={(id) => {
          if (navigation === "route") return router.push(sceneHref(id));
          setInlineScene(id);
          onSceneChange?.(id);
        }}
      />
    </div>
  );
}
