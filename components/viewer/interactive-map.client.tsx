"use client";

import { useProject } from "@/lib/use-project";
import { InteractiveMap, type InteractiveMapProps } from "./interactive-map";

interface Props extends Omit<InteractiveMapProps, "project"> {
  /** Where to load the project from. Default: this app's /api/project. Any
   *  URL returning the same JSON works (CDN file, CMS endpoint…). */
  src?: string;
}

/**
 * CLIENT component: fetches the project in the browser, then renders the map.
 * Use it inside "use client" components (or wherever the data must load in
 * the browser — e.g. a static page, or JSON hosted elsewhere):
 *
 *   import { InteractiveMapClient } from "@/components/viewer/interactive-map.client";
 *   <InteractiveMapClient className="h-[600px]" />
 */
export function InteractiveMapClient({ src, className = "h-full w-full", ...props }: Props) {
  const { project, error, retry } = useProject(src);
  if (error) {
    return (
      <div className={`${className} flex flex-col items-center justify-center gap-3 bg-neutral-900 text-sm text-white/80`}>
        Couldn&apos;t load the map ({error}).
        <button type="button" onClick={retry} className="cursor-pointer rounded-md bg-white px-3 py-1.5 text-neutral-900">
          Retry
        </button>
      </div>
    );
  }
  if (!project) {
    return (
      <div className={`${className} flex items-center justify-center bg-neutral-900`}>
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-white/20 border-t-white" />
      </div>
    );
  }
  return <InteractiveMap project={project} className={className} {...props} />;
}
