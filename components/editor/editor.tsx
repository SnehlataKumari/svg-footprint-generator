"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { applyAffine, composeAffine, fitAffine, fromPlacement, IDENTITY, invertAffine, type Placement, toPlacement } from "@/lib/affine";
import { autoAlign } from "@/lib/auto-align";
import { generateFromReference, type GenerateMode } from "@/lib/generate";
import { centroid, pointInPolygon, round2 } from "@/lib/geometry";
import { formatId, parseId, parseIdList, readingOrder } from "@/lib/ids";
import { sceneHref, shapeColor } from "@/lib/scene-tree";
import { sceneSvg, scenePaths } from "@/lib/svg-export";
import { applyBox, parseSvg } from "@/lib/svg-import";
import { DEFAULT_DETECT, detectByComparison, detectRegions, type DetectOptions } from "@/lib/trace";
import type { Affine, Category, Point, Project, Scene, Shape, ShapeKind, TraceImage, WarpKind } from "@/lib/types";
import { mapperError, MIN_POINTS, traceMapper } from "@/lib/warp";
import { BUTTON, PRIMARY_BUTTON } from "../ui";
import { type AligningState, type AlignState, type Detection, EditorCanvas, type ImageView, plottingSource, type Rect, sceneSource, type Tool } from "./canvas";
import { JsonEditor, type JsonScope } from "./json-editor";
import { ReferencePanel } from "./reference-panel";
import { createStore, type LinkedCursor, ReferencePane, type SceneView } from "./reference-pane";
import { ProjectPanel } from "./project-panel";
import { ShapePanel } from "./shape-panel";
import { DEFAULT_NUMBERING, DetectPanel, GeneratePanel, idAt, JsonMenu, type Numbering, NumberPanel, WandPanel } from "./tool-panels";
import { useHistory } from "./use-history";

/** What each Generate kind is called in messages. */
const GENERATE_NOUN: Record<GenerateMode, string> = { areas: "areas", plots: "plots", lines: "lines", amenities: "amenities" };

const TOOLS: { id: Tool; label: string; key: string; title: string }[] = [
  { id: "select", label: "Select", key: "V", title: "Select / move / edit shapes" },
  { id: "detect", label: "Auto-detect", key: "D", title: "Click one plot → find every similar plot" },
  { id: "number", label: "Number", key: "N", title: "Give shapes ids by clicking them in order, or automatically" },
  { id: "wand", label: "Wand", key: "W", title: "Click inside one area to trace it" },
  { id: "polygon", label: "Polygon", key: "P", title: "Draw a polygon point by point" },
  { id: "line", label: "Line", key: "L", title: "Draw a road / path" },
  { id: "pin", label: "Pin", key: "I", title: "Drop a labelled marker" },
];

/**
 * Hands out ids for new shapes: the pasted list's unused ids first (list
 * mode), then the pattern, continuing after the highest number already used.
 * Never returns an id already in the scene.
 */
function idSupply(scene: Scene, numbering: Numbering) {
  const used = new Set(scene.shapes.map((s) => s.id));
  const list = numbering.source === "list" ? parseIdList(numbering.list).filter((id) => !used.has(id)) : [];
  const step = numbering.step || 1;
  let n = numbering.start - step;
  for (const id of used) {
    const num = parseId(numbering.pattern, id);
    if (num !== null && num > n) n = num;
  }
  return (preferred?: string) => {
    let id = preferred && !used.has(preferred) ? preferred : list.shift();
    while (!id || used.has(id)) id = formatId(numbering.pattern, (n += step));
    used.add(id);
    return id;
  };
}

/** Rename one shape; if another shape already has that id, they swap. */
function renameWithSwap(shapes: Shape[], fromId: string, toId: string, setLabel: boolean): Shape[] {
  return shapes.map((s) => {
    if (s.id === fromId) return { ...s, id: toId, label: setLabel || s.label === fromId ? toId : s.label };
    if (s.id === toId) return { ...s, id: fromId, label: s.label === toId ? fromId : s.label };
    return s;
  });
}

function download(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  Object.assign(document.createElement("a"), { href: url, download: name }).click();
  URL.revokeObjectURL(url);
}

export function Editor({ initialProject, initialSceneId }: { initialProject: Project; initialSceneId?: string }) {
  const history = useHistory<Project>(initialProject);
  const project = history.value;
  const [savedJson, setSavedJson] = useState(() => JSON.stringify(initialProject));
  const json = useMemo(() => JSON.stringify(project), [project]);
  const dirty = json !== savedJson;

  const [sceneId, setSceneId] = useState(
    (initialSceneId && initialProject.scenes.some((s) => s.id === initialSceneId) ? initialSceneId : initialProject.startScene) ||
      initialProject.scenes[0]?.id ||
      "",
  );
  const scene = project.scenes.find((s) => s.id === sceneId) ?? project.scenes[0];
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [tool, setTool] = useState<Tool>("select");
  // With a plotting image, "compare" is the mode that works on render + lines.
  const [traceOptions, setTraceOptions] = useState<DetectOptions>(() =>
    initialProject.scenes.some((s) => s.trace) ? { ...DEFAULT_DETECT, mode: "compare", closeGaps: 3, rectangles: true } : DEFAULT_DETECT,
  );
  const [numbering, setNumberingState] = useState<Numbering>(DEFAULT_NUMBERING);
  const nextNumber = useRef(0); // synchronous copy of numbering.next, for fast sweeps
  const [showLabels, setShowLabels] = useState(true);
  const [align, setAlign] = useState<AlignState | null>(null);
  const [detection, setDetection] = useState<Detection | null>(null);
  const [detectLimit, setDetectLimit] = useState<Rect | null>(null);
  const [detectBusy, setDetectBusy] = useState(false);
  // Two-image workflow: which image is shown, and which one tracing reads.
  // Side by side by default: on top of each other, it's hard to tell which
  // image a misplaced plot comes from.
  const [imageView, setImageView] = useState<ImageView>("side");
  const sideBySide = imageView === "side";
  /** After picking a matching point, go back to comparing (side by side stays put). */
  const showCompare = () => setImageView((v) => (v === "side" ? v : "overlay"));
  const linkedCursor = useMemo(() => createStore<LinkedCursor>(null), []);
  const sceneView = useMemo(() => createStore<SceneView>(null), []);
  const [traceFrom, setTraceFrom] = useState<"plotting" | "development">("plotting");
  const [aligning, setAligning] = useState<AligningState | null>(null);
  const [jsonScope, setJsonScope] = useState<JsonScope | null>(null);
  const [autoAligning, setAutoAligning] = useState<string | null>(null);
  const [replaceExisting, setReplaceExisting] = useState(true);
  const [generateOpen, setGenerateOpen] = useState(false);
  /** The kinds to generate — several at once is fine (areas + amenity icons…). */
  const [generateModes, setGenerateModes] = useState<GenerateMode[]>(["areas"]);
  /** What the orange results came from, for the wording ("11 areas", "42 shapes"). */
  const [generatedNoun, setGeneratedNoun] = useState<string>("plots");
  const [generating, setGenerating] = useState<GenerateMode | null>(null);
  /** Categories that come with generated shapes (amenity types), added with them. */
  const [generatedCategories, setGeneratedCategories] = useState<Category[]>([]);
  const lastSample = useRef<Point | null>(null);
  const detectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ id: string; n: number } | null>(null);
  const [status, setStatus] = useState<{ message: string; error: boolean } | null>(null);
  const svgInput = useRef<HTMLInputElement>(null);

  const say = useCallback((message: string, error = false) => setStatus({ message, error }), []);
  useEffect(() => {
    if (!status) return;
    const t = setTimeout(() => setStatus(null), status.error ? 6000 : 3000);
    return () => clearTimeout(t);
  }, [status]);

  const setNumbering = useCallback((n: Numbering) => {
    nextNumber.current = n.next;
    setNumberingState(n);
  }, []);

  // ---- Project mutations (all go through history) ----
  const currentSceneId = scene?.id;
  const { set: setProject, replace: replaceProject } = history;
  const updateScene = useCallback(
    (fn: (s: Scene) => Scene, record = true) => {
      const apply = (p: Project) => ({ ...p, scenes: p.scenes.map((s) => (s.id === currentSceneId ? fn(s) : s)) });
      if (record) setProject(apply);
      else replaceProject(apply);
    },
    [setProject, replaceProject, currentSceneId],
  );

  /** Patch several shapes at once (bulk edit / nudge). */
  const updateShapes = useCallback(
    (ids: string[], patch: Partial<Shape> | ((s: Shape) => Partial<Shape>), record = true) =>
      updateScene(
        (s) => ({
          ...s,
          shapes: s.shapes.map((sh) => (ids.includes(sh.id) ? { ...sh, ...(typeof patch === "function" ? patch(sh) : patch) } : sh)),
        }),
        record,
      ),
    [updateScene],
  );

  const addShapes = useCallback(
    (fresh: Shape[]) => {
      updateScene((s) => ({ ...s, shapes: [...s.shapes, ...fresh] }));
      setSelectedIds(fresh.map((s) => s.id));
    },
    [updateScene],
  );

  const createShape = useCallback(
    (kind: ShapeKind, points: Point[]) => {
      if (!scene) return;
      const id = idSupply(scene, numbering)();
      addShapes([{ id, label: id, kind, points }]);
      say(`Added ${id}`);
    },
    [scene, numbering, addShapes, say],
  );

  const deleteSelected = useCallback(() => {
    if (!selectedIds.length) return;
    updateScene((s) => ({ ...s, shapes: s.shapes.filter((sh) => !selectedIds.includes(sh.id)) }));
    say(`Deleted ${selectedIds.length} shape${selectedIds.length > 1 ? "s" : ""}`);
    setSelectedIds([]);
  }, [selectedIds, updateScene, say]);

  const renameShape = (oldId: string, newId: string) => {
    if (!newId || newId === oldId) return;
    if (scene.shapes.some((s) => s.id === newId)) return say(`"${newId}" is already used in this scene`, true);
    updateShapes([oldId], { id: newId });
    setSelectedIds([newId]);
  };

  const select = useCallback((ids: string[], mode: "replace" | "toggle" | "add") => {
    setSelectedIds((prev) => {
      if (mode === "replace") return ids;
      if (mode === "add") return [...new Set([...prev, ...ids])];
      return prev.includes(ids[0]) ? prev.filter((id) => id !== ids[0]) : [...prev, ids[0]];
    });
  }, []);

  // ---- Which image tracing reads ----
  const plotting = scene?.trace;
  const source = useMemo(
    () => (plotting && traceFrom === "plotting" ? plottingSource(plotting) : scene ? sceneSource(scene) : null),
    [plotting, traceFrom, scene],
  );

  // ---- Auto-detect ----
  const runDetect = useCallback(
    async (point: Point, options: DetectOptions, limit: Rect | null) => {
      if (!scene || !source) return;
      lastSample.current = point;
      setDetectBusy(true);
      try {
        // Work in the source image's coordinates, then map results back.
        const [sx, sy] = source.fromDisplay(point);
        let sourceLimit: Rect | undefined;
        if (limit) {
          const corners = ([[limit.left, limit.top], [limit.right, limit.top], [limit.right, limit.bottom], [limit.left, limit.bottom]] as Point[]).map(source.fromDisplay);
          const xs = corners.map((c) => c[0]);
          const ys = corners.map((c) => c[1]);
          sourceLimit = { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
        }
        if (options.mode === "compare" && (!plotting || traceFrom !== "plotting")) {
          setDetection(null);
          return say("“Compare” needs a reference image, with Detect / wand reading the reference image", true);
        }
        const raw =
          options.mode === "compare" && plotting
            ? await detectByComparison(scene.image, plotting, sx, sy, { ...options, limit: sourceLimit })
            : await detectRegions(source.image, sx, sy, { ...options, limit: sourceLimit });
        if ("error" in raw) {
          setDetection(null);
          return say(raw.error, true);
        }
        const result = { regions: raw.regions.map((region) => region.map((pt) => source.toDisplay(pt)).map(([x, y]): Point => [round2(x), round2(y)])) };
        // Pre-skip areas that are already traced.
        const excluded = new Set<number>();
        result.regions.forEach((region, i) => {
          const c = centroid(region);
          if (scene.shapes.some((s) => s.kind === "polygon" && pointInPolygon(c, s.points))) excluded.add(i);
        });
        setDetection({ regions: result.regions, excluded, overlap: new Set(excluded) });
        const fresh = result.regions.length - excluded.size;
        say(`Found ${fresh} plots — click “Add ${fresh} plots” at the top of the image to keep them`);
      } catch (e) {
        say((e as Error).message, true);
      } finally {
        setDetectBusy(false);
      }
    },
    [scene, source, say, plotting, traceFrom],
  );

  /** Re-run the last detection shortly after a setting changes. */
  const redetect = (options: DetectOptions, limit: Rect | null) => {
    if (detectTimer.current) clearTimeout(detectTimer.current);
    const sample = lastSample.current;
    if (sample && detection) detectTimer.current = setTimeout(() => runDetect(sample, options, limit), 250);
  };

  const clearDetection = () => {
    setDetection(null);
    lastSample.current = null;
  };

  const addDetected = () => {
    if (!shownDetection) return;
    const kept = shownDetection.regions
      .map((points, i) => ({ points, meta: shownDetection.meta?.[i] }))
      .filter((_, i) => !shownDetection.excluded.has(i));
    // Replace: the earlier results of the same kinds go (see replaceable).
    const keep = (sh: Shape) => !replacing || !replaceable(sh);
    const base = replacing ? { ...scene, shapes: scene.shapes.filter(keep) } : scene;
    const makeId = idSupply(base, numbering);
    // Generated shapes come with their own names (and order); detected ones get ids from the pattern.
    const ordered = shownDetection.meta ? kept : readingOrder(kept, numbering.order);
    const fresh: Shape[] = ordered.map(({ points, meta }) => {
      const id = makeId(meta?.id);
      return {
        id,
        label: meta?.label ?? id,
        kind: meta?.kind ?? "polygon",
        points,
        ...(meta?.color ? { color: meta.color } : {}),
        ...(meta?.style ? { style: meta.style } : {}),
        ...(meta?.category ? { category: meta.category } : {}),
      };
    });
    // Amenity types: their categories (with icons) come in the same undo step as the pins.
    const usedCategories = new Set(fresh.map((f) => f.category));
    const newCategories = generatedCategories.filter((c) => usedCategories.has(c.id) && !project.categories.some((pc) => pc.id === c.id));
    if (newCategories.length) {
      setProject((p) => ({
        ...p,
        categories: [...p.categories, ...newCategories],
        // (with "replace", the old results go in the same step)
        scenes: p.scenes.map((sc) => (sc.id === scene.id ? { ...sc, shapes: [...sc.shapes.filter(keep), ...fresh] } : sc)),
      }));
      setSelectedIds(fresh.map((f) => f.id));
    } else if (replacing) {
      // One undo step: old results out, new ones in.
      updateScene((sc) => ({ ...sc, shapes: [...sc.shapes.filter(keep), ...fresh] }));
      setSelectedIds(fresh.map((f) => f.id));
    } else addShapes(fresh);
    clearDetection();
    say(
      `${replacing ? `Replaced ${replaceWhat} with` : "Added"} ${fresh.length} ${pendingNoun} (${fresh[0].id} … ${fresh[fresh.length - 1].id}) — Save to keep them. Ctrl+Z undoes.`,
    );
  };

  // ---- Generate from reference ----
  const runGenerate = async () => {
    if (!scene?.trace || !generateModes.length) return;
    setDetection(null);
    // Each kind in turn; together they become one preview and one "Add".
    const shapes: Shape[] = [];
    const categories: Category[] = [];
    const found: string[] = [];
    const failed: string[] = [];
    // The generators fine-tune the reference's placement before tracing; the
    // next kind starts from it, and it is kept on the scene afterwards.
    let current = scene;
    let refined: Affine | null = null;
    try {
      for (const mode of generateModes) {
        setGenerating(mode);
        const part = await generateFromReference(mode, current);
        if ("error" in part) {
          failed.push(`${GENERATE_NOUN[mode]}: ${part.error}`);
          continue;
        }
        if (part.transform && current.trace) {
          refined = part.transform;
          current = { ...current, trace: { ...current.trace, transform: part.transform } };
        }
        const taken = new Set(shapes.map((s) => s.id));
        shapes.push(...part.shapes.map((s) => (taken.has(s.id) ? { ...s, id: `${mode}-${s.id}` } : s)));
        categories.push(...(part.categories ?? []).filter((c) => !categories.some((k) => k.id === c.id)));
        const named = mode === "areas" ? ` (${part.shapes.filter((s) => !/^(Area|area) \d+$/.test(s.label)).length} named)` : "";
        found.push(`${part.shapes.length} ${GENERATE_NOUN[mode]}${named}`);
      }
      // Matching points (3+) define the placement themselves: leave those alone.
      if (refined && (plotting?.points?.length ?? 0) < 3) {
        const transform = refined;
        updateTrace((t) => ({ ...t, transform }));
      }
      const result = { shapes, categories };
      setGeneratedCategories(result.categories);
      setGeneratedNoun(generateModes.length === 1 ? GENERATE_NOUN[generateModes[0]] : "shapes");
      const iconOfCategory = new Map(result.categories.map((c) => [c.id, c.icon]));
      if (!result.shapes.length) {
        return say(failed.length ? failed.join(" · ") : "Nothing found on the reference — is it placed on your image (Place reference…)?", true);
      }
      const regions = result.shapes.map((s) => s.points);
      // Pre-skip what is already there, as Auto-detect does: areas already
      // traced, and pins already at the same spot (a second run of amenities).
      // Lines are never skipped.
      const excluded = new Set<number>();
      const near = (p: Point, q: Point) => Math.hypot(p[0] - q[0], ((p[1] - q[1]) * scene.height) / scene.width) < 0.6;
      result.shapes.forEach((shape, i) => {
        if (shape.kind === "pin") {
          if (scene.shapes.some((s) => s.kind === "pin" && near(s.points[0], shape.points[0]))) excluded.add(i);
          return;
        }
        if (shape.kind !== "polygon") return;
        const c = centroid(shape.points);
        if (scene.shapes.some((s) => s.kind === "polygon" && pointInPolygon(c, s.points))) excluded.add(i);
      });
      setDetection({
        regions,
        excluded,
        overlap: new Set(excluded),
        meta: result.shapes.map((s) => ({ id: s.id, label: s.label, color: s.color, kind: s.kind, style: s.style, category: s.category, icon: s.category ? iconOfCategory.get(s.category) : undefined })),
      });
      setGenerateOpen(false);
      say(
        `Found ${found.join(", ")} — click “Add” at the top of the image to keep them${refined ? " · the reference's placement was fine-tuned" : ""}${failed.length ? ` · not done: ${failed.join(" · ")}` : ""}`,
        failed.length > 0,
      );
    } catch (e) {
      say((e as Error).message, true);
    } finally {
      setGenerating(null);
    }
  };

  // ---- Numbering ----
  const numberShape = (target: Shape) => {
    const index = nextNumber.current;
    const id = idAt(numbering, index);
    if (!id) return say("The pasted list has run out of ids", true);
    nextNumber.current = index + 1;
    setNumberingState((n) => ({ ...n, next: index + 1 }));
    // Find the shape by its points array, not its id: during a fast sweep the
    // id may already have changed (a swap) in an update not yet rendered.
    updateScene((s) => {
      const current = s.shapes.find((sh) => sh.points === target.points);
      return current ? { ...s, shapes: renameWithSwap(s.shapes, current.id, id, numbering.setLabel) } : s;
    });
    setSelectedIds([]);
  };

  const autoNumber = (scope: "selected" | "all") => {
    const targets = scene.shapes.filter((s) => (scope === "selected" ? selectedIds.includes(s.id) : s.kind !== "line"));
    const ordered = readingOrder(targets, numbering.order);
    const ids = ordered.map((_, i) => idAt(numbering, i));
    if (ids.some((id) => !id)) return say(`The list has ${parseIdList(numbering.list).length} ids for ${ordered.length} shapes`, true);
    if (new Set(ids).size !== ids.length) return say("The ids would repeat — check the pattern / list", true);
    const targetIds = new Set(targets.map((t) => t.id));
    const clash = scene.shapes.find((s) => !targetIds.has(s.id) && ids.includes(s.id));
    if (clash) return say(`"${clash.id}" is already used by a shape outside this selection`, true);
    const rename = new Map(ordered.map((s, i) => [s.id, ids[i]!]));
    updateScene((s) => ({
      ...s,
      shapes: s.shapes.map((sh) => {
        const id = rename.get(sh.id);
        return id ? { ...sh, id, label: numbering.setLabel || sh.label === sh.id ? id : sh.label } : sh;
      }),
    }));
    setSelectedIds((sel) => sel.map((x) => rename.get(x) ?? x));
    setNumbering({ ...numbering, next: ordered.length });
    say(`Numbered ${ordered.length} shapes: ${ids[0]} … ${ids[ids.length - 1]}`);
  };

  // ---- JSON: save / download / copy / import ----
  /** Writes data/project.json. Resolves true when saved. */
  const save = useCallback(async () => {
    const res = await fetch("/api/project", { method: "PUT", headers: { "Content-Type": "application/json" }, body: json });
    if (res.ok) {
      setSavedJson(json);
      say("Saved to data/project.json");
      return true;
    }
    say(`Save failed: ${(await res.json().catch(() => ({}))).error ?? res.status}`, true);
    return false;
  }, [json, say]);

  /** What "replace" would remove: the scene's earlier results of the same kinds —
   *  its areas (when adding areas / plots), its pins in the amenity types being
   *  added or with the same ids, its lines with the same ids. Hand-placed pins
   *  and other lines stay. */
  const replaceable = (sh: Shape) => {
    if (!detection) return false;
    const meta = detection.meta;
    if (sh.kind === "polygon") return !meta || meta.some((m) => (m.kind ?? "polygon") === "polygon");
    // pins: in an amenity type being added, or with a new pin's id (an earlier run whose category was cleared)
    if (sh.kind === "pin") return !!meta?.some((m) => m.kind === "pin" && ((!!sh.category && m.category === sh.category) || m.id === sh.id));
    return !!meta?.some((m) => m.kind === "line" && m.id === sh.id);
  };
  const toReplace = scene?.shapes.filter(replaceable) ?? [];
  const replacing = replaceExisting && toReplace.length > 0;
  const replaceWhat = (["polygon", "pin", "line"] as const)
    .map((kind) => [toReplace.filter((s) => s.kind === kind).length, { polygon: "areas", pin: "pins", line: "lines" }[kind]] as const)
    .filter(([n]) => n)
    .map(([n, word]) => `${n} ${word}`)
    .join(" and ");
  // Replacing: results where something already is aren't skipped (it goes).
  const shownDetection: Detection | null =
    detection && replacing ? { ...detection, excluded: new Set([...detection.excluded].filter((i) => !detection.overlap?.has(i))) } : detection;
  const pendingCount = shownDetection ? shownDetection.regions.length - shownDetection.excluded.size : 0;
  const pendingNoun = shownDetection?.meta ? generatedNoun : "plots";
  const pendingWarning = () => {
    if (!pendingCount) return false;
    say(`${pendingCount} detected plots aren't added yet — click “Add ${pendingCount} plots” at the top of the image first`, true);
    return true;
  };

  /** The viewer reads the saved file — so save first, then open it. */
  const preview = async () => {
    // Orange auto-detect results aren't shapes yet — previewing would show none of them.
    if (pendingWarning()) return;
    // Open the tab now (inside the click) so popup blockers allow it.
    const tab = window.open("about:blank", "_blank");
    if (dirty && !(await save())) return tab?.close();
    if (!scene.shapes.length) say("This scene has no shapes yet — detect or draw some, then Save", true);
    if (tab) tab.location.href = sceneHref(scene.id);
  };

  const copy = async (data: unknown, what: string) => {
    await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    say(`Copied ${what} to the clipboard`);
  };

  // ---- Exports: every area as an SVG path (in the image's pixels) ----
  const copyPaths = () => {
    if (pendingWarning() || !scene) return;
    if (!scene.shapes.length) return say("No areas yet — draw one first (Polygon, P)", true);
    copy(scenePaths(scene), `${scene.shapes.length} SVG paths`);
  };
  const downloadSvg = () => {
    if (pendingWarning() || !scene) return;
    if (!scene.shapes.length) return say("No areas yet — draw one first (Polygon, P)", true);
    const url = URL.createObjectURL(new Blob([sceneSvg(scene)], { type: "image/svg+xml" }));
    Object.assign(document.createElement("a"), { href: url, download: `${scene.id}-areas.svg` }).click();
    URL.revokeObjectURL(url);
  };
  const downloadPathsJson = () => {
    if (pendingWarning() || !scene) return;
    if (!scene.shapes.length) return say("No areas yet — draw one first (Polygon, P)", true);
    download(`${scene.id}-paths.json`, scenePaths(scene));
  };

  const importJson = async (file: File) => {
    try {
      const data = JSON.parse(await file.text()) as Project;
      if (!Array.isArray(data.scenes)) throw new Error("no scenes");
      history.set({ ...data, categories: data.categories ?? [] });
      setSceneId(data.startScene || data.scenes[0]?.id);
      say("Imported — Save to keep it");
    } catch {
      say("That file isn't a project.json", true);
    }
  };

  // ---- Align SVG ----
  const loadSvg = async (file: File) => {
    const svg = parseSvg(await file.text());
    if (!svg) return say("No usable shapes in that SVG", true);
    // Start centred, at 80% of the image, keeping the SVG's aspect ratio.
    const svgAspect = svg.viewW / svg.viewH;
    const imageAspect = scene.width / scene.height;
    const width = svgAspect > imageAspect ? 80 : (80 * svgAspect) / imageAspect;
    const height = (width * imageAspect) / svgAspect;
    setAlign({ svg, box: { left: (100 - width) / 2, top: (100 - height) / 2, width, height } });
    setTool("select");
    say(`${svg.shapes.length} shapes loaded — drag/resize the yellow box onto the image, then Apply`);
  };

  const applyAlign = () => {
    if (!align) return;
    const makeId = idSupply(scene, numbering);
    addShapes(
      align.svg.shapes.map((s) => {
        const id = makeId(s.id);
        return { id, label: id, kind: s.kind, points: s.points.map((p) => applyBox(align.svg, align.box, p)) };
      }),
    );
    setAlign(null);
    say(`Added ${align.svg.shapes.length} shapes`);
  };

  // ---- The reference image: placement + matching points ----
  const updateTrace = (fn: (t: TraceImage) => TraceImage, record = true) =>
    updateScene((s) => (s.trace ? { ...s, trace: fn(s.trace) } : s), record);

  /** With 3+ matching points the overall placement follows a straight fit of
   *  them (that's the whole fit for "affine"; the base for the others). */
  const withFit = (t: TraceImage): TraceImage => {
    const pts = t.points ?? [];
    const m = pts.length >= 3 ? fitAffine(pts) : null;
    return m ? { ...t, transform: m } : t;
  };

  const FIT_NAMES: Record<WarpKind, string> = { affine: "Straight", perspective: "Perspective", mesh: "Flexible" };
  const describeFit = (t: TraceImage) => {
    const pts = t.points ?? [];
    const kind = t.warp ?? "affine";
    if (pts.length < MIN_POINTS[kind]) return `${pts.length} of ${MIN_POINTS[kind]} matching points for the ${FIT_NAMES[kind]} fit`;
    return `${FIT_NAMES[kind]} fit from ${pts.length} points — average error ${mapperError(traceMapper(t), pts).toFixed(2)}%`;
  };

  const onAlignClick = (p: Point) => {
    if (!plotting || plotting.locked) return;
    if (sideBySide && aligning?.awaiting !== "to") {
      say("① Click the spot on the REFERENCE (left) first, then the same spot here", !!aligning?.awaiting);
      return;
    }
    if (!aligning?.awaiting) return;
    if (aligning.awaiting === "from") {
      // The click is on the scene; store where that is on the reference image.
      setAligning({ awaiting: "to", pending: traceMapper(plotting).toReference(p) });
      setImageView("development");
      say("② Now click the SAME spot on your image");
      return;
    }
    const next = withFit({ ...plotting, points: [...(plotting.points ?? []), { from: aligning.pending!, to: p }] });
    updateTrace(() => next);
    setAligning({ awaiting: null });
    showCompare();
    say(describeFit(next));
  };

  /** Side by side: a click on the reference pane starts a matching point. */
  const onPickReference = (p: Point) => {
    setAligning({ awaiting: "to", pending: p });
    say("② Now click the SAME spot on your image (right)");
  };

  /** Placement fields: the reference and its matching points move together. */
  const setPlacement = (field: keyof Placement, value: number) => {
    if (!plotting || !Number.isFinite(value)) return;
    const sizes = { refW: plotting.width, refH: plotting.height, sceneW: scene.width, sceneH: scene.height };
    const next = fromPlacement({ ...toPlacement(plotting.transform, sizes), [field]: value }, sizes);
    const d = composeAffine(next, invertAffine(plotting.transform));
    updateTrace((t) => ({ ...t, transform: next, points: t.points?.map((q) => ({ ...q, to: applyAffine(d, q.to) })) }));
  };

  // ---- Keyboard shortcuts ----
  const keyState = useRef({ save, selectedIds, scene, updateShapes, deleteSelected, history });
  useEffect(() => {
    keyState.current = { save, selectedIds, scene, updateShapes, deleteSelected, history };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || (e.target as HTMLElement).closest?.("input, textarea, select, [contenteditable]")) return;
      const s = keyState.current;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === "s") s.save();
      else if (mod && key === "z" && !e.shiftKey) s.history.undo();
      else if (mod && (key === "y" || (key === "z" && e.shiftKey))) s.history.redo();
      else if (mod && key === "a") setSelectedIds(s.scene?.shapes.map((sh) => sh.id) ?? []);
      else if (mod) return;
      else if ((key === "delete" || key === "backspace") && s.selectedIds.length) s.deleteSelected();
      else if (key === "escape") {
        setSelectedIds([]);
        setDetection(null);
      } else if (key.startsWith("arrow") && s.selectedIds.length) {
        const step = e.shiftKey ? 1 : 0.1;
        const dx = key === "arrowleft" ? -step : key === "arrowright" ? step : 0;
        const dy = key === "arrowup" ? -step : key === "arrowdown" ? step : 0;
        s.updateShapes(s.selectedIds, (sh) => ({
          points: sh.points.map(([x, y]) => [Math.round((x + dx) * 100) / 100, Math.round((y + dy) * 100) / 100]),
        }));
      } else {
        const t = TOOLS.find((t) => t.key.toLowerCase() === key);
        if (!t) return;
        setTool(t.id);
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Warn before leaving with unsaved changes (not when switching projects: that saves first).
  const leaving = useRef(false);
  useEffect(() => {
    if (!dirty) return;
    const onLeave = (e: BeforeUnloadEvent) => {
      if (!leaving.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [dirty]);

  const colorOf = useCallback((s: Shape) => shapeColor(project, s), [project]);
  const iconOf = useCallback((s: Shape) => s.icon ?? project.categories.find((c) => c.id === s.category)?.icon, [project]);
  const selectedShapes = scene?.shapes.filter((s) => selectedIds.includes(s.id)) ?? [];

  /** The floating panel for the current tool / placement. */
  const toolPanel = !scene ? null : generateOpen && plotting && !aligning ? (
      <GeneratePanel
        modes={generateModes}
        onModes={setGenerateModes}
        busy={generating}
        unplaced={plotting.transform.every((v, i) => v === IDENTITY[i]) && !(plotting.points ?? []).length}
        onGenerate={runGenerate}
        onPlace={() => {
          setGenerateOpen(false);
          setAligning({ awaiting: null });
          showCompare();
          setTool("select");
        }}
        onClose={() => setGenerateOpen(false)}
      />
    ) : aligning && plotting ? (
      <ReferencePanel
        trace={plotting}
        sizes={{ refW: plotting.width, refH: plotting.height, sceneW: scene.width, sceneH: scene.height }}
        awaiting={aligning.awaiting}
        fitText={describeFit(plotting)}
        onPlacement={setPlacement}
        onWarp={(warp) => {
          const next = { ...plotting, warp };
          updateTrace(() => next);
          say(describeFit(next));
        }}
        onLock={() => updateTrace((t) => ({ ...t, locked: !t.locked }))}
        onAddPoint={() => {
          setAligning({ awaiting: "from" });
          if (!sideBySide) setImageView("plotting");
          say(`① Click a sharp, recognisable spot on the REFERENCE${sideBySide ? " (left)" : ""} (a plot corner, road junction…)`);
        }}
        onCancelPoint={() => {
          setAligning({ awaiting: null });
          showCompare();
        }}
        onRemovePoint={(i) => updateTrace((t) => withFit({ ...t, points: (t.points ?? []).filter((_, j) => j !== i) }))}
        onClearPoints={() => updateTrace((t) => ({ ...t, points: [] }))}
        onReset={() => updateTrace((t) => ({ ...t, transform: IDENTITY, points: [], warp: "affine" }))}
        autoAligning={autoAligning}
        onAutoAlign={async () => {
          setAutoAligning("Starting…");
          try {
            const result = await autoAlign(scene.image, plotting.image, setAutoAligning);
            if ("error" in result) say(result.error, true);
            else {
              updateTrace((t) => ({ ...t, transform: result.transform, points: [], warp: "affine" }));
              showCompare();
              say(
                `Placed automatically by ${result.method === "edges" ? "matching edges" : "matching the pictures"} (similarity ${(result.score * 100).toFixed(0)}%) — check the Overlay view, add matching points to refine`,
              );
            }
          } catch (e) {
            say((e as Error).message, true);
          } finally {
            setAutoAligning(null);
          }
        }}
        onDone={() => {
          setAligning(null);
          showCompare();
        }}
      />
    ) : tool === "wand" ? (
      <WandPanel options={traceOptions} onChange={setTraceOptions} />
    ) : tool === "detect" ? (
      <DetectPanel
        options={traceOptions}
        hasPlotting={!!plotting}
        onChange={(o) => {
          setTraceOptions(o);
          redetect(o, detectLimit);
        }}
        numbering={numbering}
        onNumbering={setNumbering}
        detection={shownDetection}
        limit={detectLimit}
        busy={detectBusy}
        onClearLimit={() => {
          setDetectLimit(null);
          redetect(traceOptions, null);
        }}
        onAdd={addDetected}
        onClear={clearDetection}
      />
    ) : tool === "number" ? (
      <NumberPanel
        numbering={numbering}
        onChange={setNumbering}
        selectedCount={selectedIds.length}
        shapeCount={scene.shapes.filter((s) => s.kind !== "line").length}
        onAutoNumber={autoNumber}
      />
    ) : null;

  return (
    <div className="fixed inset-0 flex bg-neutral-100 text-neutral-900">
      <ProjectPanel
        project={project}
        sceneId={scene?.id}
        onSelectScene={(id) => {
          setSceneId(id);
          setSelectedIds([]);
          setAlign(null);
          clearDetection();
          setDetectLimit(null);
        }}
        onChange={history.set}
        onStatus={say}
        dirty={dirty}
        onSave={save}
        onLeave={() => (leaving.current = true)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Toolbar */}
        <div className="flex items-center gap-2 border-b border-black/10 bg-white px-3 py-2">
          <div className="flex shrink-0 overflow-hidden rounded-md border border-black/10">
            {TOOLS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTool(t.id)}
                title={`${t.title} (${t.key})`}
                className={`h-8 cursor-pointer px-2.5 text-sm whitespace-nowrap ${tool === t.id ? "bg-neutral-900 text-white" : "hover:bg-neutral-100"}`}
              >
                {t.label} <span className="text-xs opacity-50">{t.key}</span>
              </button>
            ))}
          </div>

          <label className="flex shrink-0 items-center gap-1 text-sm whitespace-nowrap">
            <input type="checkbox" checked={showLabels} onChange={(e) => setShowLabels(e.target.checked)} /> Labels
          </label>

          <button type="button" className={`${BUTTON} shrink-0 whitespace-nowrap`} onClick={() => svgInput.current?.click()} disabled={!scene}>
            Align SVG…
          </button>
          <input ref={svgInput} type="file" accept=".svg,image/svg+xml" hidden onChange={(e) => e.target.files?.[0] && loadSvg(e.target.files[0]).finally(() => (e.target.value = ""))} />

          <div className="ml-auto flex shrink-0 items-center gap-2">
            <button type="button" className={BUTTON} onClick={history.undo} disabled={!history.canUndo} title="Undo (Ctrl+Z)">↶</button>
            <button type="button" className={BUTTON} onClick={history.redo} disabled={!history.canRedo} title="Redo (Ctrl+Shift+Z)">↷</button>
            <JsonMenu
              sceneTitle={scene?.title}
              selectedCount={selectedIds.length}
              onSave={save}
              onDownloadProject={() => download("project.json", project)}
              onDownloadScene={() => download(`${scene.id}.json`, scene)}
              onCopyScene={() => {
                if (pendingWarning()) return;
                copy(scene, `scene "${scene.title}" (${scene.shapes.length} shapes)`);
              }}
              shapeCount={scene?.shapes.length ?? 0}
              onCopyPaths={copyPaths}
              onDownloadSvg={downloadSvg}
              onCopySelected={() => copy(selectedShapes, `${selectedShapes.length} shapes`)}
              onImport={importJson}
              onEditJson={() => setJsonScope(selectedIds.length ? "selection" : "scene")}
            />
            {scene && (
              <button type="button" onClick={preview} className={BUTTON} title={dirty ? "Saves, then opens the viewer" : "Open the viewer"}>
                {dirty ? "Save & preview ↗" : "Preview ↗"}
              </button>
            )}
            <button type="button" className={PRIMARY_BUTTON} onClick={save} disabled={!dirty} title="Save to data/project.json (Ctrl+S)">
              {dirty ? "Save" : "Saved ✓"}
            </button>
          </div>
        </div>

        {scene && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-black/10 bg-neutral-50 px-3 py-1.5 text-xs">
            {plotting ? (
              <>
                <span className="font-semibold">Images</span>
                <div className="flex overflow-hidden rounded border border-black/10">
                  {(
                    [
                      ["side", "Side by side"],
                      ["development", "Your image"],
                      ["plotting", "Reference"],
                      ["overlay", "Overlay"],
                    ] as const
                  ).map(([v, label]) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setImageView(v)}
                      className={`cursor-pointer px-2 py-1 ${imageView === v ? "bg-neutral-900 text-white" : "bg-white hover:bg-neutral-100"}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {imageView === "overlay" && (
                  <label className="flex items-center gap-1">
                    Reference opacity
                    <input
                      type="range"
                      min={0.1}
                      max={1}
                      step={0.05}
                      value={plotting.opacity ?? 0.5}
                      onChange={(e) => updateTrace((t) => ({ ...t, opacity: Number(e.target.value) }), false)}
                      className="w-24"
                    />
                  </label>
                )}
                <label className="flex items-center gap-1">
                  Detect / wand read
                  <select className="rounded border border-black/15 bg-white px-1 py-0.5" value={traceFrom} onChange={(e) => setTraceFrom(e.target.value as "plotting" | "development")}>
                    <option value="plotting">the reference image</option>
                    <option value="development">your image</option>
                  </select>
                </label>
                <button
                  type="button"
                  className={`${BUTTON} h-7 text-xs`}
                  onClick={() => {
                    setAligning({ awaiting: null });
                    showCompare();
                    setTool("select");
                    setDetection(null);
                  }}
                >
                  Place reference…
                </button>
                <button
                  type="button"
                  className={`${PRIMARY_BUTTON} h-7 text-xs`}
                  title="Trace every area / plot on the reference in one go"
                  onClick={() => {
                    setAligning(null);
                    setGenerateOpen(true);
                  }}
                >
                  {generating ? "Generating…" : "Generate from reference…"}
                </button>
              </>
            ) : (
              <>
                <span className="font-semibold">Draw on this map</span>
                <div className="flex overflow-hidden rounded border border-black/10">
                  {(
                    [
                      ["polygon", "✎ Draw area", "Click each corner, then click the first point (or Enter) to close"],
                      ["wand", "Wand", "Click inside an area with clear edges to outline it"],
                      ["detect", "Auto-detect", "Click one area to find every similar one"],
                      ["line", "Line", "Draw a road / path"],
                    ] as const
                  ).map(([t, label, title]) => (
                    <button key={t} type="button" title={title} onClick={() => setTool(t)} className={`cursor-pointer px-2 py-1 ${tool === t ? "bg-neutral-900 text-white" : "bg-white hover:bg-neutral-100"}`}>
                      {label}
                    </button>
                  ))}
                </div>
                <span className="font-semibold">Export</span>
                <div className="flex overflow-hidden rounded border border-black/10">
                  <button type="button" className="cursor-pointer bg-white px-2 py-1 hover:bg-neutral-100" onClick={downloadSvg} title="One <path id=…> per area, sized like the image">
                    ⬇ SVG file
                  </button>
                  <button type="button" className="cursor-pointer border-l border-black/10 bg-white px-2 py-1 hover:bg-neutral-100" onClick={downloadPathsJson} title="[{ id, label, kind, d }] — d in the image's pixels">
                    ⬇ Paths (JSON)
                  </button>
                  <button type="button" className="cursor-pointer border-l border-black/10 bg-white px-2 py-1 hover:bg-neutral-100" onClick={copyPaths}>
                    ⧉ Copy paths
                  </button>
                </div>
                <span className="text-neutral-500">
                  {scene.shapes.length} {scene.shapes.length === 1 ? "area" : "areas"} · have a plan with the areas marked? Add it as a <b>reference image</b> (Scene settings) to trace or generate from it.
                </span>
              </>
            )}
          </div>
        )}

        {align && (
          <div className="flex items-center gap-2 border-b border-amber-300 bg-amber-50 px-3 py-2 text-sm">
            Aligning {align.svg.shapes.length} SVG shapes — drag the box, drag corners to resize (Alt = from centre).
            <span className="font-mono text-xs text-neutral-500">
              {align.box.left.toFixed(2)}, {align.box.top.toFixed(2)}, {align.box.width.toFixed(2)} × {align.box.height.toFixed(2)}
            </span>
            <button type="button" className={`${PRIMARY_BUTTON} ml-auto`} onClick={applyAlign}>Apply</button>
            <button type="button" className={BUTTON} onClick={() => setAlign(null)}>Cancel</button>
          </div>
        )}

        {scene ? (
          <div className="flex min-h-0 flex-1">
            {/* Side by side: the panel gets its own column, so it covers neither image. */}
            {plotting && sideBySide && toolPanel && <div className="relative w-[21.5rem] shrink-0 bg-neutral-900">{toolPanel}</div>}
            {plotting && sideBySide && (
              <ReferencePane
                trace={plotting}
                aligning={aligning}
                cursor={linkedCursor}
                sceneView={sceneView}
                onPickReference={onPickReference}
                onMovePointFrom={(i, from) => updateTrace((t) => withFit({ ...t, points: (t.points ?? []).map((q, j) => (j === i ? { ...q, from } : q)) }), false)}
                onCheckpoint={history.checkpoint}
              />
            )}
            <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
              {!plotting && scene.shapes.length === 0 && !detection && !align && (
                <div className="pointer-events-none absolute top-3 left-1/2 z-20 max-w-md -translate-x-1/2 rounded-lg bg-neutral-900/90 px-4 py-3 text-sm text-white shadow-lg">
                  <b>Draw your first area:</b> pick <b>✎ Draw area</b> (or press <kbd className="rounded bg-white/20 px-1">P</kbd>) and click its corners —
                  click the first point to close. Areas with clear edges: <b>Wand</b> (<kbd className="rounded bg-white/20 px-1">W</kbd>), one click inside.
                  Each area&apos;s SVG path is in the right panel; <b>⬇ SVG file</b> exports them all.
                </div>
              )}
              {pendingCount > 0 && !detectBusy && (
                <div className="absolute top-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-3 rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white shadow-lg">
                  {pendingCount} {pendingNoun} found — not in your project until you add them
                  {toReplace.length > 0 && (
                    <label className="flex items-center gap-1 font-normal" title="Removes the earlier results of the same kinds and adds these instead (Ctrl+Z undoes)">
                      <input type="checkbox" checked={replaceExisting} onChange={(e) => setReplaceExisting(e.target.checked)} />
                      replace the {replaceWhat} already here
                    </label>
                  )}
                  <button type="button" onClick={addDetected} className="cursor-pointer rounded-md bg-white px-3 py-1 text-amber-700 hover:bg-amber-50">
                    {replacing ? `Replace with ${pendingCount} ${pendingNoun}` : `Add ${pendingCount} ${pendingNoun}`}
                  </button>
                  <button type="button" onClick={clearDetection} className="cursor-pointer underline">
                    Discard
                  </button>
                </div>
              )}
              {!(plotting && sideBySide) && toolPanel}
              <EditorCanvas
                scene={scene}
                colorOf={colorOf}
                iconOf={iconOf}
                selectedIds={selectedIds}
                tool={tool}
                traceOptions={traceOptions}
                plotting={plotting}
                view={plotting && !sideBySide ? imageView : "development"}
                source={source!}
                aligning={aligning}
                onAlignClick={onAlignClick}
                onPlacing={(next) => updateTrace((t) => ({ ...t, ...next }), false)}
                onMovePoint={(i, to) => updateTrace((t) => withFit({ ...t, points: (t.points ?? []).map((q, j) => (j === i ? { ...q, to } : q)) }), false)}
                showLabels={showLabels}
                align={align}
                detection={shownDetection}
                detectLimit={detectLimit}
                focusRequest={focusRequest}
                onSelect={select}
                onCreate={createShape}
                onEditShapes={(edits) =>
                  updateScene((s) => ({ ...s, shapes: s.shapes.map((sh) => (edits[sh.id] ? { ...sh, points: edits[sh.id] } : sh)) }), false)
                }
                onCheckpoint={history.checkpoint}
                onAlignBox={(box) => setAlign((a) => (a ? { ...a, box } : a))}
                onStatus={say}
                onDetect={(point) => runDetect(point, traceOptions, detectLimit)}
                onToggleCandidate={(i) =>
                  setDetection((d) => {
                    if (!d) return d;
                    // Toggle what the user sees (with "replace", overlap skips don't count).
                    const overlap = new Set(d.overlap);
                    const shownExcluded = d.excluded.has(i) && !(replacing && overlap.has(i));
                    overlap.delete(i); // the user decided this one
                    const excluded = new Set(d.excluded);
                    if (shownExcluded) excluded.delete(i);
                    else excluded.add(i);
                    return { ...d, excluded, overlap };
                  })
                }
                onDetectLimit={(rect) => {
                  setDetectLimit(rect);
                  redetect(traceOptions, rect);
                }}
                onNumber={numberShape}
                cursor={plotting && sideBySide ? linkedCursor : undefined}
                sceneView={plotting && sideBySide ? sceneView : undefined}
                caption={plotting && sideBySide ? "Your image" : undefined}
              />
            </div>
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center text-neutral-500">Add a scene (left panel) to start.</div>
        )}
      </div>

      {scene && (
        <ShapePanel
          project={project}
          scene={scene}
          selected={selectedShapes}
          onSelect={(id, additive) => {
            select([id], additive ? "toggle" : "replace");
            if (!additive) setFocusRequest((r) => ({ id, n: (r?.n ?? 0) + 1 }));
          }}
          onChange={(patch) => updateShapes(selectedIds, patch)}
          onStyle={(patch) => updateShapes(selectedIds, (sh) => ({ style: { ...sh.style, ...patch } }))}
          onRename={(id) => selectedShapes.length === 1 && renameShape(selectedShapes[0].id, id)}
          onDelete={deleteSelected}
          onClearSelection={() => setSelectedIds([])}
        />
      )}

      {jsonScope && scene && (
        <JsonEditor
          project={project}
          scene={scene}
          selectedIds={selectedIds}
          scope={jsonScope}
          onScope={setJsonScope}
          onApply={(next, nextSceneId, nextSelection) => {
            history.set(next);
            if (nextSceneId) setSceneId(nextSceneId);
            if (nextSelection) setSelectedIds(nextSelection);
            setJsonScope(null);
            say("JSON applied — Save to keep it");
          }}
          onClose={() => setJsonScope(null)}
        />
      )}

      {status && (
        <div
          role="status"
          className={`fixed bottom-14 left-1/2 z-50 max-w-xl -translate-x-1/2 rounded-md px-3 py-2 text-sm text-white shadow-lg ${status.error ? "bg-red-600" : "bg-neutral-900"}`}
        >
          {status.message}
        </div>
      )}
    </div>
  );
}
