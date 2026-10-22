import type { Point, Scene, Shape } from "./types";

/**
 * Plots as SVG, in the scene image's own PIXELS (so the paths line up with
 * the original image file in any design tool). The project data itself keeps
 * percent points — these are exports.
 */

const px = (scene: Pick<Scene, "width" | "height">, [x, y]: Point) =>
  `${Math.round((x / 100) * scene.width * 10) / 10} ${Math.round((y / 100) * scene.height * 10) / 10}`;

/** SVG path data of one shape (pins: an empty string — they have no outline). */
export function shapePath(scene: Pick<Scene, "width" | "height">, shape: Shape): string {
  if (shape.kind === "pin" || !shape.points.length) return "";
  const [first, ...rest] = shape.points;
  return `M${px(scene, first)}${rest.map((p) => `L${px(scene, p)}`).join("")}${shape.kind === "polygon" ? "Z" : ""}`;
}

/** [{ id, label, kind, d }] for every shape of the scene. */
export const scenePaths = (scene: Scene) =>
  scene.shapes.map((s) => ({ id: s.id, label: s.label, kind: s.kind, d: shapePath(scene, s), ...(s.kind === "pin" ? { at: px(scene, s.points[0]) } : {}) }));

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

/** A standalone SVG file: one <path id="…"> per plot, sized like the image. */
export function sceneSvg(scene: Scene): string {
  const body = scene.shapes
    .map((s) => {
      const id = escape(s.id);
      const label = escape(s.label || s.id);
      if (s.kind === "pin") {
        const [x, y] = px(scene, s.points[0]).split(" ");
        return `  <circle id="${id}" data-label="${label}" cx="${x}" cy="${y}" r="8" />`;
      }
      const fill = s.kind === "line" ? ' fill="none"' : "";
      return `  <path id="${id}" data-label="${label}"${fill} d="${shapePath(scene, s)}" />`;
    })
    .join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${scene.width} ${scene.height}" width="${scene.width}" height="${scene.height}">
  <!-- ${escape(scene.title)}: ${scene.shapes.length} shapes, in the pixels of ${escape(scene.image)} -->
  <g fill="#f59e0b" fill-opacity="0.35" stroke="#b45309" stroke-width="2">
${body}
  </g>
</svg>
`;
}
