/**
 * The whole data model. A project is a tree of scenes; each scene is one image
 * with shapes drawn over it. Everything the viewer shows comes from
 * data/project.json, which the editor (/editor) reads and writes.
 */

/** [x, y] as a PERCENTAGE (0–100) of the scene image's width / height — never
 *  pixels. That's what keeps shapes glued to the image at any screen size or
 *  zoom: the overlay is an <svg viewBox="0 0 100 100"> stretched over the image. */
export type Point = [number, number];

/**
 * - polygon: a clickable area (plot, building, room…)
 * - line:    an open polyline (road, path, boundary that isn't clickable)
 * - pin:     a single point with an icon/label (landmark, amenity)
 */
export type ShapeKind = "polygon" | "line" | "pin";

/** A file on a plot's card: a PDF (plot sheet, brochure, floor plan…) or any other document. */
export interface Attachment {
  title: string;
  /** Path under /public, an absolute URL, or (hosted editor) a `local:` file. */
  url: string;
}

export interface Shape {
  /** Unique within the scene, e.g. "A-012". Also what live data is matched on. */
  id: string;
  /** Shown in tooltips and the details card; also the accessible name. */
  label: string;
  kind: ShapeKind;
  points: Point[];
  /** Category id (see Project.categories) — gives the colour + legend entry. */
  category?: string;
  /** Overrides the category colour. Any CSS colour. */
  color?: string;
  /** Scene id to zoom into when clicked. */
  link?: string;
  /** Free text for the details card. */
  description?: string;
  /** Key/value rows for the details card ("Area" -> "450 m²"). */
  info?: Record<string, string>;
  /** Image for the details card (path under /public or absolute URL). */
  image?: string;
  /** More images for the card's gallery, after `image` — from the plot details (lib/plot-details.ts). */
  images?: string[];
  /** Documents shown as buttons on the card — from the plot details. */
  documents?: Attachment[];
  /** Pins: an icon drawn at the spot instead of the label pill (path under
   *  /public or absolute URL). Default: the category's icon. */
  icon?: string;
  /** External link (brochure PDF, booking page…) shown on the details card. */
  url?: string;
  /** Hide from the viewer without deleting it (still shown in the editor). */
  hidden?: boolean;
  /** Look of this one shape — overrides scene / category / project styles. */
  style?: PlotStyle;
}

/**
 * How plots are drawn in the viewer. Every field is optional; set it on the
 * project (all plots), a scene, a category, or a single shape — the most
 * specific one wins: shape > category > scene > project > built-in default.
 * Edit it in data/project.json or with the editor's JSON ▾ → Edit JSON.
 */
export interface PlotStyle {
  /** Fill colour. Default: the category colour (or `color`). */
  fill?: string;
  /** 0–1. 0 = outline only. */
  fillOpacity?: number;
  /** Fill opacity while hovered / focused. */
  hoverFillOpacity?: number;
  /** Fill colour while hovered / focused. Default: same as `fill`. */
  hoverFill?: string;
  /** Outline colour while hovered / focused. Default: same as `stroke`. */
  hoverStroke?: string;
  /** Outline width while hovered / focused (screen px). Default: `strokeWidth`. */
  hoverStrokeWidth?: number;
  /** Outline colour. Default: same as fill. */
  stroke?: string;
  /** Outline / line width in screen pixels. 0 = none. */
  strokeWidth?: number;
  /** true = `strokeWidth` is the width at the starting (whole-image) view and
   *  grows / shrinks as visitors zoom in / out, like a real road. Default
   *  false: the same width at every zoom. */
  scaleWithZoom?: boolean;
  strokeOpacity?: number;
  /** Dashed outline, SVG syntax: "6 4" = 6px dash, 4px gap. "" = solid. */
  dash?: string;
  /** "hover" = tooltip only · "always" = label drawn on the map too · "none" = no label/tooltip */
  label?: "hover" | "always" | "none";
  labelColor?: string;
  /** Label font size in screen pixels. */
  labelSize?: number;
  /** Pin icon size in screen pixels. */
  iconSize?: number;
  /** false = not drawn and not clickable. */
  visible?: boolean;
}

/** Maps percent-of-image on the PLOTTING image to percent-of-image on the
 *  scene (development) image:  X = a·x + b·y + c,  Y = d·x + e·y + f.
 *  [1,0,0,0,1,0] = identical framing. */
export type Affine = [number, number, number, number, number, number];

/** A matching spot: where it is on the reference image (`from`, its percent)
 *  and where the same spot is on the scene image (`to`, its percent). */
export interface MatchPoint {
  from: Point;
  to: Point;
}

/**
 * How the reference image is fitted onto the scene image:
 * - affine      — move / scale / stretch / rotate (straight lines stay
 *                 straight, parallel stays parallel). Default.
 * - perspective — also corrects a different camera angle (needs 4+ points).
 * - mesh        — flexible: bends locally so every matching point lands
 *                 exactly (needs 3+ points; more points = better fit).
 */
export type WarpKind = "affine" | "perspective" | "mesh";

/**
 * The reference image: the same area with the plots marked (CAD export,
 * masterplan PDF render, a render with lines drawn on it…). It doesn't have to
 * be the same picture, size, crop or angle — it is placed on top of the scene
 * image (`transform`, optionally refined by `points`/`warp`). Editor only:
 * visitors never see it.
 */
export interface TraceImage {
  image: string;
  width: number;
  height: number;
  /** Overall placement: reference% -> scene%. Always set (move / scale / rotate). */
  transform: Affine;
  /** How `points` refine the placement. Default "affine". */
  warp?: WarpKind;
  /** Matching points (saved, so the alignment can be adjusted later). */
  points?: MatchPoint[];
  /** 0–1: how strongly the reference shows in the Overlay view. */
  opacity?: number;
  /** Placement locked — no handles, so it can't be moved by accident. */
  locked?: boolean;
}

export interface Scene {
  /** URL slug: the scene is served at /scene/<id>. */
  id: string;
  title: string;
  /** Path under /public (e.g. "/scenes/site-plan.webp") or an absolute URL. */
  image: string;
  /** Natural pixel size of the image — needed to keep its aspect ratio. */
  width: number;
  height: number;
  shapes: Shape[];
  /** Optional plotting image to detect / trace plots from (editor only). */
  trace?: TraceImage;
  /** Look of every plot in this scene. */
  style?: PlotStyle;
}

export interface Category {
  id: string;
  label: string;
  color: string;
  /** Icon for this category's pins (e.g. one per amenity type). A pin's own
   *  `icon` wins over it. */
  icon?: string;
  /** Look of every plot in this category (e.g. Sold = grey, dashed). */
  style?: PlotStyle;
}

export interface Project {
  title: string;
  /** Scene shown at "/". */
  startScene: string;
  categories: Category[];
  scenes: Scene[];
  /** Look of every plot in the project. */
  style?: PlotStyle;
  /** Plot details by hotspot ID (= shape id) — the local copy of what is
   *  published to Contentful (lib/plot-details.ts). The viewer shows
   *  Contentful's when it is set up, these otherwise. */
  details?: Record<string, import("./plot-details").UnitDetails>;
}
