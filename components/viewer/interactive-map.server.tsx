import { getViewerProject } from "@/lib/project";
import { InteractiveMap, type InteractiveMapProps } from "./interactive-map";

/**
 * SERVER component: reads data/project.json on the server and renders the
 * map — the data arrives with the HTML, no loading spinner, no extra request.
 * Use it from any server component (pages and layouts are server components
 * unless they say "use client"):
 *
 *   import { InteractiveMapServer } from "@/components/viewer/interactive-map.server";
 *   <InteractiveMapServer className="h-[600px]" />
 *
 * Can't be imported into a "use client" file — use InteractiveMapClient there.
 */
export async function InteractiveMapServer(props: Omit<InteractiveMapProps, "project">) {
  return <InteractiveMap project={await getViewerProject()} {...props} />;
}
