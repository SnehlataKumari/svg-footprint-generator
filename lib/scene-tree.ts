import type { Project, Scene } from "./types";

/** A scene's parent is the first scene with a shape linking to it — there is
 *  no separate "parent" field to keep in sync. */
export function parentOf(project: Project, sceneId: string): Scene | undefined {
  return project.scenes.find(
    (s) => s.id !== sceneId && s.shapes.some((shape) => shape.link === sceneId),
  );
}

/** Start scene -> … -> this scene, for the breadcrumb. */
export function ancestry(project: Project, sceneId: string): Scene[] {
  const chain: Scene[] = [];
  const seen = new Set<string>();
  let scene = project.scenes.find((s) => s.id === sceneId);
  while (scene && !seen.has(scene.id)) {
    seen.add(scene.id);
    chain.unshift(scene);
    scene = parentOf(project, scene.id);
  }
  return chain;
}

export const sceneHref = (id: string) => `/scene/${encodeURIComponent(id)}`;

/** Fill colour for a shape: its own colour, else its category's, else neutral. */
export function shapeColor(project: Pick<Project, "categories">, shape: { color?: string; category?: string }) {
  return (
    shape.color ||
    project.categories.find((c) => c.id === shape.category)?.color ||
    "#64748b"
  );
}
