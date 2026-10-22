"use client";

import { useEffect, useState } from "react";
import type { Project } from "./types";

/** Default source: app/api/project/route.ts (GET), which serves data/project.json. */
export const PROJECT_URL = "/api/project";

/** One request per URL per page load, shared by every map on the page. */
const requests = new Map<string, Promise<Project>>();

/** Load a project in the browser. Rejects on HTTP errors or non-project JSON. */
export function fetchProject(src: string = PROJECT_URL): Promise<Project> {
  let request = requests.get(src);
  if (!request) {
    request = fetch(src).then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as Project;
      if (!Array.isArray(data?.scenes)) throw new Error("not a project file");
      return { ...data, categories: data.categories ?? [] };
    });
    request.catch(() => requests.delete(src)); // let a retry try again
    requests.set(src, request);
  }
  return request;
}

/** The browser-side twin of getProject() (lib/project.ts, server only). */
export function useProject(src: string = PROJECT_URL) {
  const [state, setState] = useState<{ src: string; project?: Project; error?: string }>({ src });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchProject(src).then(
      (project) => !cancelled && setState({ src, project }),
      (e: Error) => !cancelled && setState({ src, error: e.message }),
    );
    return () => {
      cancelled = true;
    };
  }, [src, attempt]);

  const current = state.src === src ? state : { src };
  return {
    project: current.project,
    error: current.error,
    loading: !current.project && !current.error,
    retry: () => {
      setState({ src });
      setAttempt((n) => n + 1);
    },
  };
}
