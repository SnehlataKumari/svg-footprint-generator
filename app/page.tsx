import { redirect } from "next/navigation";
import { getProject } from "@/lib/project";
import { sceneHref } from "@/lib/scene-tree";

/** "/" opens the project's start scene (or the first scene, if the start
 *  scene was deleted). */
export default async function Home() {
  const project = await getProject();
  const start = project.scenes.find((s) => s.id === project.startScene) ?? project.scenes[0];
  if (!start) return <p className="p-8 text-white">No scenes yet — open /editor to add one.</p>;
  redirect(sceneHref(start.id));
}
