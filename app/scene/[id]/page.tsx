import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { InteractiveMap } from "@/components/viewer/interactive-map";
import { getProject, getViewerProject } from "@/lib/project";

/** Every scene is pre-rendered at build time; plot details refresh every minute. */
export const revalidate = 60;

export async function generateStaticParams() {
  const project = await getProject();
  return project.scenes.map((s) => ({ id: s.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const project = await getProject();
  const scene = project.scenes.find((s) => s.id === decodeURIComponent(id));
  return { title: scene ? `${scene.title} · ${project.title}` : project.title };
}

/** The full-screen site: a server component that loads the data and hands it
 *  to the (client) map, one URL per scene. */
export default async function ScenePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sceneId = decodeURIComponent(id);
  const project = await getViewerProject();
  const scene = project.scenes.find((s) => s.id === sceneId);
  if (!scene) notFound();
  return (
    <main className="fixed inset-0">
      <h1 className="sr-only">{scene.title}</h1>
      <InteractiveMap project={project} sceneId={sceneId} navigation="route" editorLink={process.env.NODE_ENV === "development"} />
    </main>
  );
}
