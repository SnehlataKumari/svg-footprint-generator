"use client";

import Link from "next/link";
import { useState } from "react";
import { InteractiveMapClient } from "@/components/viewer/interactive-map.client";
import { useProject } from "@/lib/use-project";

/**
 * A CLIENT component page ("use client"). The data is fetched in the browser
 * from /api/project, and the page drives the map with its own state: the
 * dropdown picks the scene, and onSceneChange keeps the dropdown in sync when
 * the user clicks into a plot.
 */
export default function ClientExample() {
  const { project } = useProject(); // same request as the map's — fetched once
  const [sceneId, setSceneId] = useState<string>();
  const [visited, setVisited] = useState<string[]>([]);

  return (
    <main className="min-h-screen bg-white p-6 text-neutral-900 md:p-10">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="space-y-2">
          <p className="text-sm text-neutral-500">
            <Link href="/examples/server" className="underline">← Server version</Link>
          </p>
          <h1 className="text-2xl font-semibold">{project?.title ?? "Loading…"}</h1>
          <p className="text-neutral-600">
            Rendered by a <b>client component</b> with <code>&lt;InteractiveMapClient&gt;</code> — the data loads in the
            browser. The dropdown below is ordinary React state controlling the map.
          </p>
        </header>

        <label className="flex items-center gap-2 text-sm">
          Scene
          <select
            className="rounded-md border border-black/15 px-2 py-1"
            value={sceneId ?? project?.startScene ?? ""}
            onChange={(e) => setSceneId(e.target.value)}
          >
            {project?.scenes.map((s) => (
              <option key={s.id} value={s.id}>{s.title}</option>
            ))}
          </select>
        </label>

        <InteractiveMapClient
          sceneId={sceneId}
          navigation="inline"
          onSceneChange={(id) => {
            setSceneId(id);
            setVisited((v) => [...v, id]);
          }}
          className="h-[70vh] min-h-[420px] overflow-hidden rounded-xl"
        />

        <p className="text-sm text-neutral-600">Visited: {visited.length ? visited.join(" → ") : "—"}</p>
      </div>
    </main>
  );
}
