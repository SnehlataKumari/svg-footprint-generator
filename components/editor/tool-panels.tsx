"use client";

import { editorStorage } from "@/lib/browser-store";
import type { GenerateMode } from "@/lib/generate";
import { formatId, parseIdList, READING_ORDERS, type ReadingOrder } from "@/lib/ids";
import type { DetectOptions } from "@/lib/trace";
import { BUTTON, INPUT, LABEL, PRIMARY_BUTTON, SURFACE } from "../ui";
import type { Detection, Rect } from "./canvas";

// Floating panels shown over the canvas while the Detect / Number / Wand tool
// is active, and the Generate panel.

// Scrolls inside the canvas when taller than it (small screens, long panels).
const PANEL = `absolute top-3 left-3 z-10 max-h-[calc(100%-1.5rem)] w-72 space-y-2.5 overflow-y-auto overscroll-contain p-3 text-xs ${SURFACE}`;

/** How ids are handed out — shared by Number, Detect, Wand, Align SVG and drawing. */
export interface Numbering {
  /** pattern = "A-{n:3}" style; list = ids pasted one per line */
  source: "pattern" | "list";
  pattern: string;
  start: number;
  step: number;
  list: string;
  /** 0-based index of the next id the Number tool hands out. */
  next: number;
  order: ReadingOrder;
  /** Also set each shape's label to its new id. */
  setLabel: boolean;
}

export const DEFAULT_NUMBERING: Numbering = {
  source: "pattern",
  pattern: "A-{n:3}",
  start: 1,
  step: 1,
  list: "",
  next: 0,
  order: "rows",
  setLabel: true,
};

/** The index-th id (0-based), or undefined when a pasted list has run out. */
export function idAt(n: Numbering, index: number): string | undefined {
  if (n.source === "list") return parseIdList(n.list)[index];
  return formatId(n.pattern, n.start + index * n.step);
}

export function Slider(props: { label: string; min: number; max: number; step?: number; value: number; format?: (v: number) => string; onChange: (v: number) => void }) {
  return (
    <label className="flex items-center justify-between gap-2">
      <span className="w-20">{props.label}</span>
      <input type="range" min={props.min} max={props.max} step={props.step ?? 1} value={props.value} onChange={(e) => props.onChange(Number(e.target.value))} className="min-w-0 flex-1" />
      <span className="w-10 text-right tabular-nums">{props.format ? props.format(props.value) : props.value}</span>
    </label>
  );
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

export function WandPanel({ options, onChange }: { options: DetectOptions; onChange: (o: DetectOptions) => void }) {
  if (options.mode === "compare") {
    return (
      <div className={PANEL}>
        <div className="font-semibold">Wand — one plot per click</div>
        <p className="text-neutral-600">
          Uses Auto-detect&apos;s <b>Compare</b> settings: click inside a plot that was missed and it&apos;s outlined between its drawn lines
          {options.rectangles ? " as a rectangle" : ""}. The first click takes a few seconds, the next ones are quick.
        </p>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={options.rectangles} onChange={(e) => onChange({ ...options, rectangles: e.target.checked })} />
          Straighten into rectangles
        </label>
      </div>
    );
  }
  return (
    <div className={PANEL}>
      <div className="font-semibold">Magic wand — one area per click</div>
      <Slider label="Tolerance" min={0} max={160} value={options.tolerance} onChange={(tolerance) => onChange({ ...options, tolerance })} />
      <Slider label="Grow" min={0} max={6} value={options.grow} onChange={(grow) => onChange({ ...options, grow })} />
      <Slider label="Smoothing" min={0.5} max={6} step={0.5} value={options.smoothing} onChange={(smoothing) => onChange({ ...options, smoothing })} />
    </div>
  );
}

interface DetectProps {
  options: DetectOptions;
  /** The scene has a plotting image (enables "compare"). */
  hasPlotting: boolean;
  onChange: (o: DetectOptions) => void;
  numbering: Numbering;
  onNumbering: (n: Numbering) => void;
  detection: Detection | null;
  limit: Rect | null;
  busy: boolean;
  onClearLimit: () => void;
  onAdd: () => void;
  onClear: () => void;
}

export function DetectPanel(p: DetectProps) {
  const total = p.detection?.regions.length ?? 0;
  const keep = total - (p.detection?.excluded.size ?? 0);
  return (
    <div className={PANEL}>
      <div className="font-semibold">Auto-detect — find every plot at once</div>
      <ol className="list-decimal space-y-0.5 pl-4 text-neutral-600">
        <li>Click inside <b>one</b> plot (away from its label).</li>
        <li>Check the orange results; click any wrong one to skip it.</li>
        <li><b>Add</b> — they get ids from the pattern below.</li>
      </ol>

      <div className="space-y-1">
        <span className={LABEL}>Find areas</span>
        {p.hasPlotting && (
          <label className="flex items-start gap-1.5 rounded bg-emerald-50 p-1">
            <input type="radio" className="mt-0.5" checked={p.options.mode === "compare"} onChange={() => p.onChange({ ...p.options, mode: "compare", closeGaps: 3, rectangles: true })} />
            <span>
              <b>Compare with your image</b> — when the reference is your same render with plot lines / labels drawn on top.
              Place the reference first. (Different pictures: use the other modes.)
            </span>
          </label>
        )}
        {(
          [
            ["outline", "Inside the same outline colour (any fill)"],
            ["lines", "Inside thin dark lines drawn on a render / photo"],
            ["colour", "With the same fill colour as the sample"],
          ] as const
        ).map(([mode, label]) => (
          <label key={mode} className="flex items-center gap-1.5">
            <input type="radio" checked={p.options.mode === mode} onChange={() => p.onChange({ ...p.options, mode })} />
            {label}
          </label>
        ))}
      </div>
      {p.options.mode === "compare" ? (
        <>
          <Slider label="Line strength" min={5} max={80} value={p.options.lineStrength} onChange={(lineStrength) => p.onChange({ ...p.options, lineStrength })} />
          <Slider label="Min line length" min={10} max={300} step={10} value={p.options.minLineLength} onChange={(minLineLength) => p.onChange({ ...p.options, minLineLength })} />
          <Slider label="Close gaps" min={0} max={6} value={p.options.closeGaps} onChange={(closeGaps) => p.onChange({ ...p.options, closeGaps })} />
          <Slider label="Road darkness" min={0} max={160} value={p.options.roadDarkness} onChange={(roadDarkness) => p.onChange({ ...p.options, roadDarkness })} />
          <Slider
            label="Alignment tolerance"
            min={0}
            max={6}
            value={p.options.alignTolerance}
            format={(v) => `${v}px`}
            onChange={(alignTolerance) => p.onChange({ ...p.options, alignTolerance })}
          />
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={p.options.skipThin} onChange={(e) => p.onChange({ ...p.options, skipThin: e.target.checked })} />
            Skip long thin areas (pavements, verges)
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={p.options.insideBoundary} onChange={(e) => p.onChange({ ...p.options, insideBoundary: e.target.checked })} />
            Only inside the drawn boundary (e.g. a white phase outline)
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={p.options.requireLabel} onChange={(e) => p.onChange({ ...p.options, requireLabel: e.target.checked })} />
            Only areas with a label inside
          </label>
          <p className="text-neutral-500">
            Lower <i>line strength</i> catches fainter lines; raise <i>min line length</i> to ignore more noise. Plots leaking into the street:
            raise <i>close gaps</i> or <i>road darkness</i>. Pick a sample plot whose label doesn&apos;t cut it in two.
          </p>
        </>
      ) : p.options.mode === "lines" ? (
        <>
          <Slider label="Line darkness" min={10} max={160} value={p.options.lineDarkness} onChange={(lineDarkness) => p.onChange({ ...p.options, lineDarkness })} />
          <Slider label="Close gaps" min={0} max={6} value={p.options.closeGaps} onChange={(closeGaps) => p.onChange({ ...p.options, closeGaps })} />
          <p className="text-neutral-500">
            Darker than “line darkness” = a line. Raise it if plots merge with neighbours; lower it if dark shadows / roads cut
            plots up. “Close gaps” bridges breaks in the lines.
          </p>
        </>
      ) : (
        <Slider label="Tolerance" min={0} max={160} value={p.options.tolerance} onChange={(tolerance) => p.onChange({ ...p.options, tolerance })} />
      )}
      <Slider label="Min size" min={0.05} max={1} step={0.05} value={p.options.minSize} format={pct} onChange={(minSize) => p.onChange({ ...p.options, minSize })} />
      <Slider label="Max size" min={1} max={10} step={0.25} value={p.options.maxSize} format={pct} onChange={(maxSize) => p.onChange({ ...p.options, maxSize })} />
      <Slider label="Grow" min={0} max={6} value={p.options.grow} onChange={(grow) => p.onChange({ ...p.options, grow })} />
      <label className="flex items-center gap-1.5">
        <input type="checkbox" checked={p.options.rectangles} onChange={(e) => p.onChange({ ...p.options, rectangles: e.target.checked })} />
        Straighten into rectangles (4 clean corners)
      </label>
      {!p.options.rectangles && (
        <Slider label="Smoothing" min={0.5} max={8} step={0.5} value={p.options.smoothing} onChange={(smoothing) => p.onChange({ ...p.options, smoothing })} />
      )}
      <p className="text-neutral-500">Size is relative to the sample plot. Rectangles suit rectangular plots; turn it off for irregular ones (then raise Smoothing for straighter edges).</p>

      <div className="flex items-center justify-between gap-2 rounded bg-neutral-100 px-2 py-1">
        {p.limit ? "Searching inside the dashed box" : "Shift+drag to search only part of the image"}
        {p.limit && (
          <button type="button" className="cursor-pointer text-sky-700 underline" onClick={p.onClearLimit}>
            clear
          </button>
        )}
      </div>

      <IdSource numbering={p.numbering} onChange={p.onNumbering} compact />

      {p.busy && <div className="font-medium">Detecting…</div>}
      {p.detection && !p.busy && (
        <div className="space-y-2 border-t border-black/10 pt-2">
          <div>
            Found <b>{total}</b> areas{total !== keep && <> · {total - keep} skipped (grey)</>}
          </div>
          <div className="flex gap-2">
            <button type="button" className={`${PRIMARY_BUTTON} flex-1`} onClick={p.onAdd} disabled={!keep}>
              Add {keep} plots
            </button>
            <button type="button" className={BUTTON} onClick={p.onClear}>
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

interface NumberProps {
  numbering: Numbering;
  onChange: (n: Numbering) => void;
  selectedCount: number;
  shapeCount: number;
  onAutoNumber: (scope: "selected" | "all") => void;
}

export function NumberPanel({ numbering, onChange, selectedCount, shapeCount, onAutoNumber }: NumberProps) {
  const nextId = idAt(numbering, numbering.next);
  return (
    <div className={PANEL}>
      <div className="font-semibold">Number shapes</div>
      <IdSource numbering={numbering} onChange={onChange} />

      <div className="space-y-1.5 rounded-md bg-violet-50 p-2">
        <div className="font-medium">A — By clicking</div>
        <p className="text-neutral-600">Click shapes, or hold the mouse down and sweep across a row, in the order you want.</p>
        <div className="flex items-center gap-2">
          Next id:
          <b className="font-mono">{nextId ?? "— list finished —"}</b>
          <button type="button" className="ml-auto cursor-pointer text-sky-700 underline" onClick={() => onChange({ ...numbering, next: 0 })}>
            restart
          </button>
        </div>
      </div>

      <div className="space-y-1.5 rounded-md bg-neutral-100 p-2">
        <div className="font-medium">B — Automatically</div>
        <select className={INPUT} value={numbering.order} onChange={(e) => onChange({ ...numbering, order: e.target.value as ReadingOrder })}>
          {READING_ORDERS.map((o) => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </select>
        <div className="flex gap-2">
          <button type="button" className={`${BUTTON} flex-1`} disabled={!selectedCount} onClick={() => onAutoNumber("selected")}>
            Selected ({selectedCount})
          </button>
          <button type="button" className={`${BUTTON} flex-1`} disabled={!shapeCount} onClick={() => onAutoNumber("all")}>
            All ({shapeCount})
          </button>
        </div>
        <p className="text-neutral-500">Select a block first (Select tool, Shift+drag) to number it separately.</p>
      </div>
    </div>
  );
}

/** Pattern-or-list editor shared by the Number and Detect panels. */
function IdSource({ numbering, onChange, compact }: { numbering: Numbering; onChange: (n: Numbering) => void; compact?: boolean }) {
  const listCount = parseIdList(numbering.list).length;
  const set = (patch: Partial<Numbering>) => onChange({ ...numbering, next: 0, ...patch });
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className={LABEL}>New ids</span>
        <div className="flex overflow-hidden rounded border border-black/10">
          {(["pattern", "list"] as const).map((source) => (
            <button
              key={source}
              type="button"
              onClick={() => set({ source })}
              className={`cursor-pointer px-2 py-0.5 ${numbering.source === source ? "bg-neutral-900 text-white" : "hover:bg-neutral-100"}`}
            >
              {source === "pattern" ? "Pattern" : "Paste list"}
            </button>
          ))}
        </div>
      </div>
      {numbering.source === "pattern" ? (
        <>
          <input className={`${INPUT} font-mono`} value={numbering.pattern} onChange={(e) => set({ pattern: e.target.value })} placeholder="MT01-V6-{n:3}" />
          {!compact && (
            <div className="flex gap-2">
              <label className="flex flex-1 items-center gap-1">
                Start
                <input type="number" className={INPUT} value={numbering.start} onChange={(e) => set({ start: Number(e.target.value) || 0 })} />
              </label>
              <label className="flex flex-1 items-center gap-1">
                Step
                <input type="number" className={INPUT} value={numbering.step} onChange={(e) => set({ step: Number(e.target.value) || 1 })} />
              </label>
            </div>
          )}
          <p className="text-neutral-500">
            Any text + <code>{"{n}"}</code> for the number, <code>{"{n:3}"}</code> = 001. e.g. <span className="font-mono">{formatId(numbering.pattern, numbering.start)}</span>,{" "}
            <span className="font-mono">{formatId(numbering.pattern, numbering.start + numbering.step)}</span>…
          </p>
        </>
      ) : (
        <>
          <textarea
            className={`${INPUT} h-24 py-1 font-mono`}
            value={numbering.list}
            onChange={(e) => set({ list: e.target.value })}
            placeholder={"V6-050\nV6-051\nV4-012\n… (one per line, or comma-separated — e.g. pasted from Excel)"}
          />
          <p className="text-neutral-500">{listCount} ids — used in order.</p>
        </>
      )}
      <label className="flex items-center gap-1.5">
        <input type="checkbox" checked={numbering.setLabel} onChange={(e) => onChange({ ...numbering, setLabel: e.target.checked })} />
        Label = id
      </label>
    </div>
  );
}

interface JsonMenuProps {
  sceneTitle?: string;
  selectedCount: number;
  onSave: () => void;
  onDownloadProject: () => void;
  onDownloadScene: () => void;
  onCopyScene: () => void;
  onCopySelected: () => void;
  onCopyPaths: () => void;
  onDownloadSvg: () => void;
  shapeCount: number;
  onImport: (file: File) => void;
  onEditJson: () => void;
}

/** Everything that reads / writes JSON, in one menu. */
export function JsonMenu(p: JsonMenuProps) {
  const inBrowser = editorStorage() === "browser";
  const item = "flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-neutral-100 disabled:cursor-default disabled:opacity-40";
  const close = (e: React.MouseEvent) => (e.currentTarget.closest("details") as HTMLDetailsElement | null)?.removeAttribute("open");
  return (
    <details className="relative">
      <summary className={`${BUTTON} list-none`}>JSON ▾</summary>
      <div className={`absolute right-0 z-30 mt-1 w-72 p-1 ${SURFACE}`} onClick={close}>
        <button type="button" className={item} onClick={p.onSave}>💾 {inBrowser ? "Save in this browser" : <>Save to <code className="text-xs">data/project.json</code></>} <span className="ml-auto text-xs text-neutral-400">Ctrl+S</span></button>
        <button type="button" className={item} onClick={p.onDownloadProject}>{inBrowser ? "⬇ Download backup (project + images)" : "⬇ Download project.json"}</button>
        <button type="button" className={item} onClick={p.onDownloadScene} disabled={!p.sceneTitle}>⬇ Download this scene ({p.sceneTitle ?? "—"})</button>
        <button type="button" className={item} onClick={p.onCopyScene} disabled={!p.sceneTitle}>⧉ Copy this scene&apos;s JSON</button>
        <button type="button" className={item} onClick={p.onCopySelected} disabled={!p.selectedCount}>⧉ Copy selected shapes ({p.selectedCount})</button>
        <div className="my-1 border-t border-black/10" />
        <button type="button" className={item} onClick={p.onCopyPaths} disabled={!p.shapeCount}>⧉ Copy plot paths — SVG “d”, image pixels ({p.shapeCount})</button>
        <button type="button" className={item} onClick={p.onDownloadSvg} disabled={!p.shapeCount}>⬇ Download plots as an SVG file</button>
        <div className="my-1 border-t border-black/10" />
        <button type="button" className={item} onClick={p.onEditJson}>✎ Edit JSON… <span className="ml-auto text-xs text-neutral-400">styles, data</span></button>
        <label className={item}>
          {inBrowser ? "⬆ Open a backup / project.json…" : "⬆ Import project.json…"}
          <input type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && (p.onImport(e.target.files[0]), (e.target.value = ""))} />
        </label>
      </div>
    </details>
  );
}

interface GenerateProps {
  /** The kinds to generate; several run one after the other into one preview. */
  modes: GenerateMode[];
  onModes: (modes: GenerateMode[]) => void;
  /** What's running ("areas" / "plots"), or null. */
  busy: GenerateMode | null;
  /** The reference hasn't been placed yet (still stretched over the image). */
  unplaced: boolean;
  onGenerate: () => void;
  onPlace: () => void;
  onClose: () => void;
}

/** "Generate from reference": trace every area / plot in one go. */
export function GeneratePanel(p: GenerateProps) {
  const ORDER: GenerateMode[] = ["areas", "plots", "amenities", "lines"];
  const on = (mode: GenerateMode) => p.modes.includes(mode);
  const toggle = (mode: GenerateMode) => p.onModes(ORDER.filter((m) => (m === mode ? !on(m) : on(m))));
  const option = (mode: GenerateMode, title: string, text: string) => (
    <label className={`flex cursor-pointer items-start gap-1.5 rounded p-1.5 ${on(mode) ? "bg-emerald-50 ring-1 ring-emerald-300" : "hover:bg-neutral-50"}`}>
      <input type="checkbox" className="mt-0.5" checked={on(mode)} onChange={() => toggle(mode)} disabled={!!p.busy} />
      <span>
        <b>{title}</b> — {text}
      </span>
    </label>
  );
  return (
    <div className={PANEL}>
      <div className="flex items-center justify-between">
        <span className="font-semibold">Generate from the reference</span>
        <button type="button" className="cursor-pointer px-1 text-neutral-400 hover:text-neutral-900" onClick={p.onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <p className="text-neutral-600">
        Traces everything of the kinds you tick at once and shows it in orange on your image. Tick several to get them together — e.g. the coloured areas
        <i> and</i> an icon at every amenity. Click any wrong one to skip it, then add them.
      </p>
      {p.unplaced && (
        <div className="space-y-1 rounded bg-amber-50 p-2 text-amber-900">
          <p>
            <b>Place the reference first</b> — it is still stretched over your image. <i>Place reference… → Auto-align</i> lines it up.
          </p>
          <button type="button" className={`${BUTTON} h-7 text-xs`} onClick={p.onPlace}>
            Place reference…
          </button>
        </div>
      )}
      <div className="space-y-1">
        <span className={LABEL}>The reference shows (tick all that apply)</span>
        {option("areas", "Coloured areas", "your picture with neighbourhoods / phases tinted in colour and their names written on them (a sales map).")}
        {option("plots", "Numbered plots", "your picture with plot lines drawn on it and a label in a white box on each plot (e.g. MT12-V5-001).")}
        {option("amenities", "Amenity icons", "small round badges marking amenities (park, cycling, dining…). Each becomes a pin at the same spot, grouped by type; give each type your own icon under Categories.")}
        {option("lines", "Coloured lines", "your picture with routes drawn on it in bright colours, solid or dashed (metro / bus lines, roads). Each becomes a line in the same colour and dash.")}
      </div>
      {editorStorage() === "browser" && (
        <p className="rounded-md bg-amber-50 p-2 text-amber-800">
          Generate needs the desktop version of this tool (it reads the images with heavy image processing). Here, use <b>Auto-detect</b> or{" "}
          <b>Wand</b> on the reference instead, or draw with <b>Polygon</b>.
        </p>
      )}
      <button type="button" className={`${PRIMARY_BUTTON} w-full`} onClick={p.onGenerate} disabled={!!p.busy || !p.modes.length || editorStorage() === "browser"}>
        {p.busy ? "Generating…" : p.modes.length > 1 ? `Generate ${p.modes.length} kinds` : "Generate"}
      </button>
      {p.busy && (
        <p className="text-neutral-500">
          {p.modes.length > 1 && `${p.modes.indexOf(p.busy) + 1} of ${p.modes.length}: `}
          {p.busy === "areas" ? "areas, about 20 seconds…" : p.busy === "lines" ? "lines, a few seconds…" : p.busy === "amenities" ? "amenity icons, a few seconds…" : "plots — reading every label takes 1–3 minutes…"}
        </p>
      )}
    </div>
  );
}
