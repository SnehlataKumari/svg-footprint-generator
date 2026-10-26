# Interactive Map — starter

A reusable starter for "click on the image to explore" projects: masterplans,
site plans, buildings, floor plans, campus maps. Any image works.

- **Viewer** — pan / zoom / pinch, coloured clickable areas, tooltips, a
  details card, a legend that filters, a breadcrumb, and a zoom-in transition
  from one image ("scene") to the next.
- **Editor** (`/editor`, dev only) — upload images, trace areas (by hand or
  with a one-click magic wand), align an SVG from a designer, fill in the
  details, link scenes together, Save. **No code changes needed.**

Everything the site shows lives in one file: `data/project.json`.

---

## Start a new project (checklist)

1. Copy this folder, rename it, run `npm install`, then `npm run dev` — or,
   in the editor, **Projects ▾ → New project** (left panel, top): the open
   project is saved and kept in `data/projects/`, and you start empty. Open it
   again from the same list. Only one project is open at a time — it is
   `data/project.json`, the one the viewer shows.
2. Open **http://localhost:3000/editor**.
3. **Scenes** (left panel) → **+ Add scene (image)** for every image — e.g.
   overview, masterplan, each phase, each unit type. Delete scenes you don't need.
4. **Categories** → e.g. *Available / Reserved / Sold* with colours.
5. On each scene: **Auto-detect** the plots, then **Number** them (below).
6. Select shapes (one, or many with Shift+drag) and set **Category**, **Opens
   scene** (the image clicking it zooms into), **Details**, etc.
7. Save — see *JSON* below. **Preview ↗** opens the viewer.
8. Commit `data/project.json` and `public/scenes/`. Deploy with
   `npm run build && npm run start` (or any Next.js host).

## Drawing on a map image (no reference)

Any image works on its own. With no reference image, the bar under the toolbar
reads **Draw on this map**: **✎ Draw area** (P — click the corners, click the
first point or press Enter to close), **Wand** (W — one click inside an area
with clear edges), **Auto-detect** (D), **Line**. Select an area: the right
panel shows its **SVG path** (in the image's pixels) with *Copy path* /
*Copy points (%)*. **Export**: *⬇ SVG file* (one `<path id>` per area, sized
like the image), *⬇ Paths (JSON)* (`[{ id, label, kind, d }]`), *⧉ Copy paths*.

## The hosted editor (Vercel / any deployment)

A deployed site can't write files, so there `/editor` keeps everything **in the
visitor's own browser** (IndexedDB) instead of `data/` and `public/`:

- **Save** (Ctrl+S) stores the project and its uploaded images in this browser —
  per device and browser, and lost if site data is cleared. Use **JSON ▾ →
  Download backup** (images included) and **Open a backup…** to move or restore it.
- **Projects ▾** lists the projects saved in this browser (new / open / delete).
- **Preview ↗** opens `/preview`, the saved project as visitors would see it.
- Drawing, Wand, Auto-detect, reference images, numbering, plot details (stored
  in the project) and all exports (SVG, paths, JSON) work.
- **Generate from reference** works too: the browser sends the scene's two
  images with each run. Vercel takes at most 4.5 MB per request, so when the
  two images are bigger together they are uploaded to **Vercel Blob** first
  (and deleted once read) — connect a **private** Blob store to the Vercel
  project (Storage → Blob; it sets `BLOB_READ_WRITE_TOKEN`). Plots on a big
  map take 1–3 minutes: Vercel's function time limit (`maxDuration` 300 s)
  and memory (2 GB default) apply; if a run is cut off, use `npm run dev`.
- **Import from GIS files** works too: the browser reads the map PDF itself
  (pdf.js — no poppler on Vercel), the site runs the import and sends the
  project back, and it is saved in your browser like any other. The masterplan,
  phase images and PDF are well over 4.5 MB together, so this needs the same
  **Vercel Blob** store. *Carry over plots* uses the open project as last saved.

The public viewer (`/`, `/scene/<id>`) still shows the deployed `data/project.json`.
To publish a map there, download it from the hosted editor, put it in
`data/project.json` (and its images in `public/scenes/`), commit and deploy.
In `npm run dev`, open `/editor?browser` to try the hosted mode locally.

## 0 · Reference image (optional)

A **reference image** is any picture of the same area with the plots marked —
a CAD export, a masterplan PDF page, a render with plot lines drawn on it. It
does **not** have to be the same picture, size, crop or angle as your image:
you place it on top, then trace or auto-detect on it, and the shapes land on
your image. Visitors never see it.

1. Add the scene with **your image** (the one visitors see).
2. *Scene settings → Reference image → + Add reference image*.
3. The **Images** bar: *Side by side* (default), *Your image*, *Reference* or
   *Overlay* (with a reference-opacity slider).
   - **Side by side** shows the reference exactly as it is on the left (no
     plots drawn over it) and your image with its plots on the right.
   - A green crosshair follows your pointer on the other side (same spot);
     *Follow your image* keeps the reference panned / zoomed with your image.
   - Matching points: click a spot on the left, then the same spot on the
     right. Drag a pink (left) or blue (right) point to fine-tune it.
4. **Place reference…** — three ways, which combine:
   - **1 · Automatic** — *Auto-align* finds position + size by matching the
     pictures, or their edges when they look different. No rotation (rotate
     by hand first). It tells you when it isn't confident.
   - **2 · By hand** — drag **✥** to move, **⟳** to rotate (Shift = 15°
     steps), corners to scale, edge handles to stretch (Alt = from the
     centre); or type **X / Y / Width / Height / Rotation / Skew**. *Lock*
     hides the handles so it can't be moved by accident.
   - **3 · Matching points (exact)** — *+ Add matching point* → click a sharp
     spot on the reference (a site corner, a road junction) → click the same
     spot on your image. Pick the **fit**:
     - *Straight* — same drawing at another size / angle (3+ points);
     - *Perspective* — a different camera angle (4+ points);
     - *Flexible* — bends so every point lands exactly: a plan vs a render,
       a different render (3+ points; add more where it's off).
     The panel shows the average error. Drag a blue point to fine-tune it.
5. Everything is saved with the scene (`trace` in the JSON: `transform`,
   `warp`, `points`, `opacity`, `locked`), so it only has to be done once.
6. Detect: **Auto-detect** / **Wand** read the reference (*Detect / wand read:
   the reference image*) and place results on your image through the fit.
   - Reference is a **clean drawing** (CAD / PDF): *Inside the same outline
     colour* — tested on a reference rotated 8° in a different style: all 36
     plots, each within ~0.1% of its true position.
   - Reference is **your same render with lines drawn on it**: *Compare with
     your image* (see its settings below).
   - Or just trace by hand on top of it (*Polygon*, Overlay view).
7. **Preview only shows saved work** — the button saves first ("Save & preview").

### Generate from reference (one button)

Tick **several kinds at once** to get them together — e.g. *Coloured areas*
and *Amenity icons*: they run one after the other into one orange preview and
one **Add** (one Ctrl+Z). Areas, lines and pins always live side by side.
*Replace … already here* (on the orange bar) swaps the earlier results of the
same kinds for the new ones: the scene's areas, its pins in the amenity types
being added, its lines with the same ids — never hand-placed pins.

Each generator first **fine-tunes the reference's placement** against your
image (`scripts/lib/placement.mjs`: size and position, coarse to fine), and
the editor keeps the fine-tuned placement on the scene (unless 3+ matching
points define it). A placement a few percent off no longer spoils the result.

Once the reference is placed (**Place reference… → Auto-align**), click
**Generate from reference…** in the Images bar and pick what the reference shows:

- **Coloured areas** — your picture with neighbourhoods / phases tinted in
  colour and their names written on them (a sales map). Each area is outlined,
  coloured like the reference and named from the text inside it (areas whose
  name can't be read are called *Area N* — rename them). ~20 s.
- **Numbered plots** — your picture with plot lines drawn on it and a label in
  a white box on each plot; see the script below. 1–3 min. The phase prefix
  (`MT11`, `MT12`…) is read from the labels; type a **Plot ID prefix** to name
  them `<prefix>-V<type>-<nnn>` instead (e.g. `ALM-MT11`).
- **Amenity icons** — small round badges marking amenities (park, cycling,
  dining…). A *pin* at each badge, grouped by type (same symbol + colour): one
  category per type, holding the type's icon — cut from the reference to start
  with. Give a type your own icon with the round icon button next to it under
  **Categories** (every pin of that type changes), or one pin its own icon in
  the shape panel (**Icon → Upload…**). Pins with an icon show it at the spot
  (size: `style.iconSize`, default 28 px). A few seconds.
  **No icons of your own?** Not needed: generated types start with the icon
  cut from the reference; the icon menu also has 18 **built-in symbols**
  (park, dining, café, cycling, jogging, school, shopping, water, mosque, gym,
  playground, parking, health, bus, metro, community, info, landmark) drawn in
  white on the category's colour — stored as `"icon": "builtin:park"` etc.
  (`lib/icons.ts`). *No icon* = the pin shows its name as a coloured label.
  CLI: `npm run amenities:from-reference -- <sceneId> --preview /tmp/check.jpg`.
- **Coloured lines** — your picture with routes drawn on it in bright colours,
  solid or dashed (metro / bus lines, roads). Each route becomes a *line* shape
  in the same colour, dashed where the reference is dashed. A few seconds.
  Pieces of one route split by a station marker are joined; a branch is its
  own line. CLI: `npm run lines:from-reference -- <sceneId> --preview /tmp/check.jpg`.

The results show in orange; click a wrong one to skip it, then **Add**, then
**Save**. The server runs `scripts/areas-from-reference.mjs` /
`scripts/plots-from-reference.mjs` on the scene (`app/api/generate`; the
hosted editor sends the images along, see above).
From a terminal: `npm run areas:from-reference -- <sceneId> --preview /tmp/check.jpg`
(prints what it finds, changes nothing).

How the areas are found: the reference is treated as your picture with a
see-through colour wash on top. It works out the wash's opacity and, pixel by
pixel, the wash colour; groups the washed ground by colour (hue counts more
than brightness, so roofs and roads under one wash stay together); drops what
isn't a wash over the picture (logos, buttons, the legend); outlines each area
and reads the light text inside it (OCR).

### Plot details from Excel → Contentful

Plot **outlines** stay in this project; plot **details** (typology, facade,
status, area…) live in Contentful as `unit` entries. The only link is the
**hotspot ID** = the plot's ID here (`unit.hotspotId`).

1. Scene settings → **Plot details (Excel → Contentful)…** → **⬇ Template**: a
   CSV (opens in Excel) with every plot's hotspot ID filled in. Columns:
   `hotspotId, zone, plotLabel, mdTypology, facadeOption, status, mdPlotArea,
   gfa, parking, confirmed` (other columns are kept as extra details, not sent).
2. Fill it in, upload it (.xlsx or .csv). Each row is checked (allowed values,
   numbers) and matched to a plot by hotspot ID — or by plot label, with the
   option to rename those plots to their hotspot ID. *Colour plots by status*
   adds Available / Booked / Blocked / Sold / Unassigned categories.
3. **Save to local JSON**: the details go to `data/plot-details/<project>.json`
   (keyed by hotspot ID, Contentful's field names; **Download JSON** gives you
   the file) and the map uses them. Renamed plots / status categories change the
   project — Save it too. With Contentful set up, **Save & publish to
   Contentful** also creates/updates + publishes one `unit` per row (the local
   JSON stays as a backup).

Contentful is optional. To add it, put in `.env.local` (see `.example.env`;
never committed): `CONTENTFUL_SPACE_ID`, `CONTENTFUL_ENVIRONMENT`,
`CONTENTFUL_MANAGEMENT_TOKEN` (publishing, dev machine only),
`CONTENTFUL_DELIVERY_TOKEN` (the viewer reading details), `CONTENTFUL_LOCALE`,
and restart `npm run dev`. The viewer merges the details onto the plots by
hotspot ID (details card, status colour): the local JSON, with Contentful's
on top when set up (refreshed every minute). `GET /api/plot-details` returns
them as JSON for other front ends.

### Facilities from a spreadsheet + GIS map

**In the editor:** **Projects ▾ → Import from GIS files…** — give the project a
name, pick the facilities spreadsheet (.xlsx), the map PDF, the masterplan image
and the phase images folder (only images + world files are uploaded), tick
*Carry over plots* if the open project already has plots on a phase image, and
click **Import** (1–2 minutes). Then **Open** the new project.

**Into a scene you already have:** open the phase scene and click
**Facilities from GIS files…** (end of the bar above the image). Pick the same
spreadsheet and map PDF plus the **world file of that scene's image** (e.g.
`MT11.wpw` for `MT11.webp`): the facilities on the image are added — outlines,
icons, details and their categories — in one undo step, in about 15 seconds.
A world file named after a cluster (`MT11`) brings only that cluster's
facilities. Running it again updates them (same plot IDs). The scene's image
must be the picture the world file belongs to, at its original size. Same result as
the command below — in the hosted editor too (see *The hosted editor* above).

When the facilities are listed in a spreadsheet (plot ID, type EN/AR, cluster,
area…) and drawn on a GIS map exported as a **GeoPDF** (ArcGIS / QGIS: each
facility filled in its type's colour and labelled with its plot ID, phases
outlined and labelled), and the phase images come with **world files**
(`.wpw`, `.jgw`, `.pgw`…), one command builds a whole project:

```bash
npm run import:facilities -- --xlsx facilities.xlsx --pdf facilities.pdf \
  --masterplan masterplan.webp --phases "Phase images folder" \
  --title "Al Metlaa" [--plots-from data/project.json:mt12]
```

- every facility outlined from the map, named by its plot ID, with its
  spreadsheet row as details (type EN/AR, cluster, area, parking) and an icon
  pin; one category per type (the map's colour + a built-in icon);
- the **masterplan** as the start scene (located by finding the georeferenced
  phase images in it), with each **phase** outlined and opening its own scene;
- a **scene per phase image**, its facilities placed exactly from the world files;
- `--plots-from` carries existing plots into the phase that uses the same image.

It writes `data/projects/<title>.json` (open it from **Projects ▾**) and the
images to `public/scenes/<title>/`. Needs poppler (`pdftotext`, `pdftoppm`).

### Plots + numbers straight from the reference (script)

When the reference is your render with plot lines and **labels** drawn on it
(e.g. `MT12-V5-170` in white pills), one command outlines every plot from the
drawn lines and names it from its label:

```bash
npm run plots:from-reference -- mt12 --dry --preview /tmp/check.jpg   # look first
npm run plots:from-reference -- mt12                                  # replaces the scene's shapes
```

It refines the placement (patch matching), reads every label (OCR with the
bundled `eng.traineddata`), grows each plot from its label until it meets a
drawn line or its neighbour, and saves the plots (ids = labels) plus the
refined placement to `data/project.json`. Reload the editor afterwards — and
don't Save from an editor tab opened before the run, or it overwrites them.
Tested on MT12: all 221 labels read (1–221, no duplicates); a handful of
plots at block ends bulge into the road and need a vertex dragged. Another
label format: edit `LABEL_RE` / `CHARS` / `repairLabel` at the top of
`scripts/plots-from-reference.mjs`.

### Compare mode (reference = your render + drawn lines)

**Auto-detect → "Compare with your image"** (pre-selected when the scene has a
   reference image). For the common case where the plotting
   image is the render with plot lines + labels drawn on top: the two aligned
   images are compared, so only what was drawn on top is left (the render's
   roofs, shadows and trees cancel out), and the plots between those lines are
   found. Click one ordinary plot (not one whose label cuts it in half) →
   check the orange results → click wrong ones to skip → **Add**.
   - Tested on MT12: 211 areas in ~2 s, ~85–90% of the plots exact; the rest
     are missed or merged — add those with Polygon / Wand.
   - Settings: *Line strength* (lower = fainter lines), *Min line length*
     (higher = ignore more render noise), *Close gaps* (bridges breaks in the
     lines; 3 is a good start), *Road darkness* (stops plots leaking into the
     street), *Only areas with a label inside* (drops pavements / blocks
     outside the phase).
   - It needs a good alignment first (step 4) — Auto-align does that.
   - If the plotting image is a clean drawing (no render underneath), the other
     modes are better (*Inside the same outline colour*).

## 1 · Get the shapes — Auto-detect (D)

One click finds **every** plot, not one at a time:

1. Pick **Auto-detect**, click inside **one** plot (away from its number).
2. Every similar area turns orange. Areas you already traced are skipped (grey).
   Click any wrong orange area to skip it too.
3. **Add N shapes**. They are named from the id pattern, in reading order.

Settings (re-run live as you change them):

| Setting | Use |
| --- | --- |
| *Inside the same outline colour* | Plots drawn with an outline — finds them whatever their fill (already colour-coded plans). **Default.** |
| *Same fill colour as sample* | Plots separated by colour, not by lines (e.g. all white plots). |
| Tolerance | Raise if plots come out partial / noisy; lower if neighbours merge. |
| Min / Max size | Relative to the sample — keeps parks, roads and tiny bits out. |
| Shift+drag | Search only inside a box (one block / phase at a time). |
| Grow / Smoothing | Grow = cover the outline stroke (1–2 px). Smoothing = fewer corners. |

Other ways to get shapes: **Wand (W)** one area per click · **Polygon (P)** /
**Line (L)** / **Pin (I)** by hand · **Align SVG…** if a designer already
traced the plots (load the SVG, drag/resize the yellow box onto the image, Apply).

## 2 · Give them ids — Number (N)

Ids can be **anything**: any prefix, any suffix, or a list.

- **Pattern** — any text with `{n}` where the number goes; `{n:3}` pads to 3
  digits. `MT01-V6-{n:3}` → MT01-V6-001, 002… · `Plot {n}-B` → Plot 1-B…
  Set *Start* and *Step* (e.g. step 2 for odd numbers only).
- **Paste list** — ids one per line (or comma-separated), e.g. a column copied
  from the sales Excel. Used in order.
- **Replace id prefix…** (right panel, with shapes selected) — swaps the start
  of every selected id and keeps the rest: `MT12-` → `MT11-` turns
  MT12-V5-001 into MT11-V5-001. Labels containing the id follow; an id already
  used in the scene stops it. One undo step.

Then either:

- **A — by clicking:** click the shapes in the order you want, or hold the
  mouse and **sweep across a row**. Each gets the next id. If an id is already
  taken, the two shapes swap. *restart* goes back to the first id.
- **B — automatically:** choose an order (rows / columns, left→right or
  right→left) and click **All** or **Selected**. For several blocks with
  different prefixes: Select tool → Shift+drag a block → Number → change
  pattern → *Selected*. Repeat per block.

*Label = id* also sets the visible label. Auto-detect, Wand, drawing and Align
SVG all use the same pattern / list for new shapes.

## 3 · JSON

Everything is in `data/project.json`. The **JSON ▾** menu:

| | |
| --- | --- |
| **Save to data/project.json** (Ctrl+S, also the **Save** button) | What the site reads. Commit this file. |
| **Download project.json** | Backup / send to someone. |
| **Download this scene** | Just the current image's data (`<scene>.json`). |
| **Copy this scene's JSON** / **Copy selected shapes** | Paste into another tool / file. |
| **Copy plot paths** | Every plot as `{ id, label, kind, d }` — `d` is the SVG path in the image's **pixels**. |
| **Download plots as an SVG file** | `<scene>-plots.svg`: one `<path id="…">` per plot, sized like the image — open it in Figma / Illustrator over the image. |

The JSON itself stores each plot as `points` (percent of the image, see
*How it works*). A scene with `"shapes": []` has no plots yet — after
Auto-detect, click **Add N plots** (the orange bar on the image).
| **Import project.json…** | Load a downloaded file (Save afterwards to keep it). |

## 4 · How plots look — `style` in the JSON

Everything about how plots are drawn is data, not code. Add a `"style"` object
at any level — the most specific one wins:

**shape** › **category** › **scene** › **project** › built-in default

The common choices need no JSON: the editor's left panel → **Plot look
(viewer)** — *Show plots* (always visible / outline only / **shown only on
hover**), **Colour on hover**, *Plot names* (tooltip / always / never), for
all scenes or one scene. It writes the `style` described here.

Edit it in `data/project.json`, or in the editor: **JSON ▾ → Edit JSON…**
(pick *Project settings & styles*, *This scene* or *Selected shapes*; it's
validated before it's applied, and Ctrl+Z undoes it).

| Field | Meaning | Default |
| --- | --- | --- |
| `fill` | fill colour | category colour (or shape `color`) |
| `fillOpacity` | 0–1; `0` = outline only | 0.35 |
| `hoverFillOpacity` | fill opacity on hover / keyboard focus | 0.6 |
| `hoverFill` | fill colour on hover | same as `fill` |
| `hoverStroke` | outline colour on hover | same as `stroke` |
| `hoverStrokeWidth` | outline width on hover | `strokeWidth` (2 if that's 0) |
| `stroke` | outline colour | same as fill |
| `strokeWidth` | outline width in screen px; `0` = none | 1.25 (lines: 4) |
| `strokeOpacity` | 0–1 | 1 |
| `scaleWithZoom` | `true`: `strokeWidth` is the width at the starting view and grows / shrinks with zoom, like a real road. Also in the shape panel: *Line width* + *Grows with zoom* | false |
| `dash` | dashed outline, e.g. `"6 4"`; `""` = solid | solid |
| `label` | `"hover"` tooltip only · `"always"` also written on the map · `"none"` | `"hover"` |
| `labelColor`, `labelSize` | label text colour / size (px) | white / 12 |
| `visible` | `false` hides the plot (and makes it unclickable) | true |

Examples:

```jsonc
// Project: outlines only, plot numbers always visible
"style": { "fillOpacity": 0, "stroke": "#ffffff", "strokeWidth": 2, "label": "always" }

// Category: sold plots greyed out, no label
{ "id": "sold", "label": "Sold", "color": "#ef4444",
  "style": { "fill": "#404040", "fillOpacity": 0.65, "label": "none" } }

// Category: reserved = dashed amber outline
{ "id": "reserved", "label": "Reserved", "color": "#f59e0b", "style": { "dash": "6 4" } }

// Scene: invisible until hovered (clean render, plots appear on hover)
"style": { "fillOpacity": 0, "strokeWidth": 0, "hoverFillOpacity": 0.5, "hoverStrokeWidth": 2 }

// Project: show the plots, but light them up orange on hover
"style": { "hoverFill": "#f59e0b", "hoverStroke": "#f59e0b", "hoverFillOpacity": 0.6 }

// One shape: highlight a showcase villa
{ "id": "V-001", …, "style": { "fill": "#3b82f6", "fillOpacity": 0.7, "strokeWidth": 3 } }
```

## Handy keys

- Space + drag / middle-drag / drag on empty area → pan · wheel or pinch → zoom
- Select: click · Shift+click add/remove · Shift+drag box-select · Ctrl+A all ·
  drag to move (moves the whole selection) · arrows nudge (Shift = bigger)
- One shape selected: drag a square = move vertex · drag a ○ = add vertex ·
  Alt+click a vertex = delete it
- Drawing: new points snap to existing corners (Alt = no snapping) ·
  Backspace = remove last point · Enter = finish · Esc = cancel
- Del = delete selection · Ctrl+Z / Ctrl+Shift+Z = undo / redo · Ctrl+S = save

## Preparing images

- Export **WebP or PNG, ≤ 6000 px** on the long side. Large is fine — the viewer
  zooms up to 10×, so it loads the full file.
- Same-size crops for every level make life easier (e.g. each phase image cut
  from the masterplan at the same scale).
- To replace an image later (new render) use *Scene settings → Replace image*;
  shapes are kept. Keep the same aspect ratio or shapes will be off.

---

## Using the map in your own pages (server or client components)

The map is one component, `<InteractiveMap>`. It fills its parent (give the
parent a size) and takes plain JSON props, so it works under both kinds of
component. Pick the import that matches where you're rendering it:

| You are in… | Import | Data comes from |
| --- | --- | --- |
| a **server component** (a page/layout without `"use client"`) | `InteractiveMapServer` from `@/components/viewer/interactive-map.server` | `data/project.json`, read on the server — arrives with the HTML |
| a **client component** (`"use client"`) | `InteractiveMapClient` from `@/components/viewer/interactive-map.client` | fetched in the browser from `/api/project` (or any `src` URL returning the same JSON) |
| either, with data you already have | `InteractiveMap` from `@/components/viewer/interactive-map` | the `project` prop — from `getProject()` (server) or `useProject()` (client) |

```tsx
// Server component
import { InteractiveMapServer } from "@/components/viewer/interactive-map.server";
export default function Page() {
  return <InteractiveMapServer className="h-[600px] rounded-xl overflow-hidden" />;
}
```

```tsx
// Client component
"use client";
import { InteractiveMapClient } from "@/components/viewer/interactive-map.client";
export function Explorer() {
  const [scene, setScene] = useState<string>();
  return <InteractiveMapClient sceneId={scene} onSceneChange={setScene} className="h-[600px]" />;
}
```

Props (all optional except `project` on the bare `InteractiveMap`):

- `navigation` — `"inline"` (default): scenes change inside the component and
  the page URL stays put, for embedding in a section / tab / modal.
  `"route"`: each scene is its own URL (`/scene/<id>`), as the full-screen site does.
- `sceneId` — scene to show (default: the start scene). In inline mode, changing
  it moves the map, so your own menu can drive it.
- `onSceneChange(id)` — inline mode: called when the user zooms into / out of a scene.
- `className` — size and styling of the box.
- `src` (`InteractiveMapClient` only) — where to fetch the project JSON.

Data helpers: `getProject()` (`lib/project.ts`, **server only**: reads the
file) and `useProject(src?)` / `fetchProject(src?)` (`lib/use-project.ts`,
**client**: fetches `GET /api/project`). Both return the same `Project` type.

Live examples: **/examples/server** and **/examples/client** (delete
`app/examples/` when you don't need them). Keyboard shortcuts (+ − 0 arrows)
apply page-wide only in route mode; an embedded map uses them once it's been
clicked / focused, so it doesn't steal the page's arrow keys.

## How it works (for developers)

```
data/project.json          the data: scenes -> shapes (see lib/types.ts)
public/scenes/             the images
app/scene/[id]/page.tsx    full-screen viewer — one static page per scene (route mode)
app/examples/              the map inside a server page and a client page
app/editor/page.tsx        editor route (404 in production builds)
app/api/project            GET = the project JSON (client components);
                           PUT = editor save (dev only)
app/api/upload             editor image upload (dev only)
app/api/generate           Generate from reference (dev: images from public/;
                           hosted: images sent along, big ones via ./upload → Vercel Blob)

lib/types.ts               the data model — start reading here
lib/use-pan-zoom.ts        pan / zoom / pinch engine (viewer + editor share it)
lib/trace.ts               wand + auto-detect: fill / components -> contour -> simplify
lib/ids.ts                 id patterns ({n:3}), pasted lists, reading order
lib/affine.ts              reference placement (move / scale / rotate, typed values)
lib/warp.ts                straight / perspective / flexible (mesh) fits from matching points
lib/auto-align.ts          automatic placement (brightness, then edges)
lib/style.ts               resolveStyle(): project > scene > category > shape styles
lib/svg-import.ts          SVG -> shapes, and the align-box maths
lib/geometry.ts            centroid, bbox, polygon simplification
lib/scene-tree.ts          breadcrumb / parent lookup, shape colour

components/viewer/         interactive-map (+ .server / .client wrappers),
                           scene-viewer (one scene + chrome), shape-layer,
                           details-card
lib/project.ts             getProject() — server only
lib/use-project.ts         useProject() / fetchProject() — browser
components/editor/         editor (state, toolbar, shortcuts), canvas
                           (drawing / handles / wand / detect / numbering /
                           align), tool-panels (Detect, Number, JSON menu),
                           side panels
components/ui.ts           shared Tailwind class recipes — restyle here
```

**Coordinates:** every point is `[x, y]` in **percent of the image** (0–100),
never pixels. The overlay is `<svg viewBox="0 0 100 100"
preserveAspectRatio="none">` stretched over the image, so shapes stay glued to
the image at every screen size and zoom.

**Navigation:** a scene's parent is whichever scene has a shape linking to it
(no separate field). Clicking a shape with details opens the card (with a
"View →" button if it links somewhere); a shape with only a link zooms
straight in.

### Common extensions

- **Live availability from a CRM / sales API:** fetch in the viewer and
  overwrite `category` (or `info`) per shape by `id` before rendering —
  `SceneViewer`'s `visibleShapes` is the place. Keep IDs in the editor equal
  to the CRM's unit numbers.
- **CMS instead of the JSON file:** replace `getProject()` in
  `lib/project.ts`; keep the shape of `Project`.
- **Translations:** add `label_ar` etc. to `Shape`, pick by locale in the viewer.
- **Different card / branding:** `components/viewer/details-card.tsx`,
  `components/ui.ts`.

### Commands

```bash
npm run dev         # viewer + editor at http://localhost:3000
npm run build       # production build (editor and save API disabled)
npm run start       # serve the build
npm run lint
npm run type-check
```
