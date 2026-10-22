import type { Metadata } from "next";
import Link from "next/link";
import { InteractiveMapServer } from "@/components/viewer/interactive-map.server";
import { getProject } from "@/lib/project";

export const metadata: Metadata = { title: "Example · server component" };

/**
 * A SERVER component page (no "use client"). The map's data is read on the
 * server and sent with the HTML. The page around it can use server-only
 * things too — here, getProject() for the scene list.
 */
export default async function ServerExample() {
  const project = await getProject();
  return (
    <main className="min-h-screen bg-white p-6 text-neutral-900 md:p-10">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="space-y-2">
          <p className="text-sm text-neutral-500">
            <Link href="/examples/client" className="underline">Client version →</Link>
          </p>
          <h1 className="text-2xl font-semibold">{project.title}</h1>
          <p className="text-neutral-600">
            Rendered by a <b>server component</b> with <code>&lt;InteractiveMapServer&gt;</code>. Clicking a plot changes
            scene inside the box (<code>navigation=&quot;inline&quot;</code>) — the page URL stays the same.
          </p>
        </header>

        <InteractiveMapServer navigation="inline" className="h-[70vh] min-h-[420px] overflow-hidden rounded-xl" />

        <section>
          <h2 className="mb-2 font-semibold">Scenes (listed on the server)</h2>
          <ul className="list-inside list-disc text-neutral-700">
            {project.scenes.map((s) => (
              <li key={s.id}>
                {s.title} — {s.shapes.length} shapes · <Link href={`/scene/${s.id}`} className="underline">full screen</Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
