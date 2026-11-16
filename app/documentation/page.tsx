import type { Metadata } from "next";
import Link from "next/link";
import pkg from "@/package.json";
import { DocsShell, type DocsNavGroup } from "@/components/docs/docs-shell";
import { Bullets, C, Callout, Code, H3, Kbd, Section, Steps, Table } from "@/components/docs/doc-ui";

export const metadata: Metadata = {
  title: "Documentation · Interactive Map",
  description: "Trace clickable areas on masterplans, phase plans and villa images, and show them to visitors.",
};

const NAV: DocsNavGroup[] = [
  { title: "Getting started", links: [
    { id: "overview", label: "Overview" },
    { id: "install", label: "Installation" },
    { id: "quick-start", label: "Quick start" },
  ] },
  { title: "Editor", links: [
    { id: "draw", label: "Draw areas" },
    { id: "auto-detect", label: "Auto-detect" },
    { id: "numbering", label: "Plot IDs" },
    { id: "reference", label: "Reference image" },
    { id: "generate", label: "Generate from reference" },
    { id: "saving", label: "Save & export" },
    { id: "hosted", label: "Hosted editor" },
  ] },
  { title: "Data", links: [
    { id: "data-model", label: "project.json" },
    { id: "style", label: "Styling plots" },
    { id: "plot-details", label: "Plot details & Contentful" },
    { id: "gis", label: "Facilities from GIS" },
  ] },
  { title: "Developers", links: [
    { id: "embed", label: "Embed the map" },
    { id: "props", label: "Props" },
    { id: "api", label: "API routes" },
    { id: "cli", label: "CLI scripts" },
    { id: "structure", label: "Project structure" },
  ] },
  { title: "Reference", links: [
    { id: "shortcuts", label: "Keyboard shortcuts" },
    { id: "images", label: "Preparing images" },
    { id: "faq", label: "FAQ" },
  ] },
];

const DEV_ONLY = <b>Dev only.</b>;

export default function DocumentationPage() {
  return (
    <DocsShell title="Interactive Map" version={pkg.version} nav={NAV}>
      {/* ───────────── Getting started ───────────── */}
      <Section
        id="overview"
        title="Interactive Map"
        lead="Turn any image — a masterplan, a phase plan, a villa floor plan — into a map visitors can click to explore. Trace the areas once in the editor; no code changes needed."
      >
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            ["Viewer", "Pan, zoom and pinch, coloured clickable plots, tooltips, a details card, a filtering legend and zoom-in transitions between images."],
            ["Editor", "Upload images, trace plots by hand or in one click, number them, link scenes together and save."],
            ["One data file", "Everything the site shows lives in data/project.json. Commit it and deploy."],
          ].map(([title, text]) => (
            <div key={title} className="rounded-xl border border-neutral-200 bg-neutral-50 p-4">
              <p className="mb-1 font-semibold text-neutral-900">{title}</p>
              <p className="text-sm text-neutral-600">{text}</p>
            </div>
          ))}
        </div>
        <H3>Key terms</H3>
        <Table
          head={["Term", "Meaning"]}
          rows={[
            [<b key="t">Project</b>, "The whole map: its scenes, categories and style."],
            [<b key="t">Scene</b>, "One image, e.g. the masterplan, a phase or a unit type."],
            [<b key="t">Shape</b>, <>A clickable area (<C>polygon</C>), a route (<C>line</C>) or a marker (<C>pin</C>) on a scene.</>],
            [<b key="t">Category</b>, <>A group with a colour, e.g. <i>Available / Reserved / Sold</i>. Drives the legend.</>],
            [<b key="t">Hotspot ID</b>, <>A shape&apos;s <C>id</C>. CRM and Contentful data join on it.</>],
          ]}
        />
      </Section>

      <Section id="install" title="Installation" lead={<>Requires <b>Node.js 20+</b>. PDF features also need <b>poppler</b> (<C>pdftotext</C>, <C>pdftoppm</C>) when running locally.</>}>
        <Code lang="bash">{`
git clone <repo-url> interactive-map
cd interactive-map
npm install
npm run dev
`}</Code>
        <Table
          head={["URL", "What it is"]}
          rows={[
            [<Link key="u" href="/" className="text-sky-700 underline">/</Link>, "The viewer — what visitors see"],
            [<Link key="u" href="/editor" className="text-sky-700 underline">/editor</Link>, "The editor (saves to files in dev, to the browser when deployed)"],
            [<C key="u">/documentation</C>, "This page"],
          ]}
        />
      </Section>

      <Section id="quick-start" title="Quick start" lead="From an empty project to a clickable map in eight steps.">
        <Steps>
          <li>Open <C>/editor</C>. To start fresh: <b>Projects ▾ → New project</b>.</li>
          <li><b>Scenes → + Add scene (image)</b> for each image (overview, masterplan, phases…).</li>
          <li><b>Categories</b> → add e.g. <i>Available</i>, <i>Reserved</i>, <i>Sold</i> with colours.</li>
          <li>On each scene, <b>Auto-detect</b> <Kbd>D</Kbd> the plots and click <b>Add N shapes</b>.</li>
          <li><b>Number</b> <Kbd>N</Kbd> them, e.g. pattern <C>{"MT01-V6-{n:3}"}</C>.</li>
          <li>Select shapes and set <b>Category</b>, <b>Opens scene</b> and <b>Details</b>.</li>
          <li><b>Save</b> <Kbd>Ctrl</Kbd>+<Kbd>S</Kbd>, then <b>Preview ↗</b> to see the viewer.</li>
          <li>Commit <C>data/project.json</C> and <C>public/scenes/</C>, then deploy.</li>
        </Steps>
        <Callout title="Tip:">
          Clicking a shape that has <b>Opens scene</b> set zooms into that scene. A scene&apos;s parent is whichever scene links to it — there is no separate parent setting.
        </Callout>
      </Section>

      {/* ───────────── Editor ───────────── */}
      <Section id="draw" title="Draw areas" lead="Any image works on its own. Use the bar under the toolbar:">
        <Table
          head={["Tool", "Key", "How"]}
          rows={[
            ["✎ Draw area", <Kbd key="k">P</Kbd>, <>Click the corners; click the first point or press <Kbd>Enter</Kbd> to close.</>],
            ["Wand", <Kbd key="k">W</Kbd>, "One click inside an area with clear edges."],
            ["Auto-detect", <Kbd key="k">D</Kbd>, <>One click finds every similar area. <a href="#auto-detect" className="text-sky-700 underline">More ↓</a></>],
            ["Line", <Kbd key="k">L</Kbd>, "Routes, roads, metro lines."],
            ["Pin", <Kbd key="k">I</Kbd>, "A single marker, e.g. an amenity."],
            ["Align SVG…", "", "Load an SVG a designer traced, drag the yellow box onto the image, Apply."],
          ]}
        />
      </Section>

      <Section id="auto-detect" title="Auto-detect">
        <Steps>
          <li>Pick <b>Auto-detect</b> and click inside <b>one</b> plot (away from its number).</li>
          <li>Every similar area turns orange. Already-traced areas are skipped (grey). Click a wrong one to skip it.</li>
          <li>Click <b>Add N shapes</b>. They are named from the ID pattern, in reading order.</li>
        </Steps>
        <Table
          head={["Setting", "Use"]}
          rows={[
            ["Inside the same outline colour", <>Plots drawn with an outline, whatever their fill. <b>Default.</b></>],
            ["Same fill colour as sample", "Plots separated by colour, not by lines."],
            ["Tolerance", "Raise if plots come out partial; lower if neighbours merge."],
            ["Min / Max size", "Relative to the sample — keeps parks, roads and specks out."],
            ["Grow / Smoothing", "Grow covers the outline stroke; Smoothing gives fewer corners."],
            [<><Kbd>Shift</Kbd>+drag</>, "Search only inside a box (one block at a time)."],
          ]}
        />
      </Section>

      <Section id="numbering" title="Plot IDs" lead={<>The <b>Number</b> tool <Kbd>N</Kbd> gives shapes their IDs. IDs can be anything.</>}>
        <Table
          head={["Method", "Example"]}
          rows={[
            ["Pattern", <><C>{"MT01-V6-{n:3}"}</C> → MT01-V6-001, 002… (<C>{"{n:3}"}</C> pads to 3 digits; set Start and Step)</>],
            ["Paste list", "One ID per line, e.g. a column copied from the sales sheet."],
            ["Replace ID prefix…", <><C>MT12-</C> → <C>MT11-</C> on the selected shapes, in one undo step.</>],
          ]}
        />
        <p>Then either <b>click</b> (or sweep across a row) in the order you want, or choose an order (rows / columns) and click <b>All</b> or <b>Selected</b>.</p>
      </Section>

      <Section
        id="reference"
        title="Reference image"
        lead="Another picture of the same area with the plots marked — a CAD export, a PDF page, a render with lines drawn on it. It doesn't need the same size, crop or angle. Visitors never see it."
      >
        <Steps>
          <li><b>Scene settings → Reference image → + Add reference image</b>.</li>
          <li>Pick a view in the <b>Images</b> bar: <i>Side by side</i>, <i>Your image</i>, <i>Reference</i> or <i>Overlay</i>.</li>
          <li>
            <b>Place reference…</b> using any mix of:
            <Bullets>
              <li><b>Automatic</b> — <i>Auto-align</i> finds position and size.</li>
              <li><b>By hand</b> — drag to move, rotate, scale; or type X / Y / Width / Height / Rotation.</li>
              <li><b>Matching points</b> — click a sharp spot on each image. Fit: <i>Straight</i> (3+), <i>Perspective</i> (4+) or <i>Flexible</i> (3+).</li>
            </Bullets>
          </li>
          <li>Run <b>Auto-detect</b> or <b>Wand</b> — they read the reference and place results on your image.</li>
        </Steps>
        <p>The placement is saved with the scene, so it only has to be done once.</p>
      </Section>

      <Section id="generate" title="Generate from reference" lead={<>Once the reference is placed, click <b>Generate from reference…</b> and tick what the reference shows. Several kinds can run together into one preview and one <b>Add</b>.</>}>
        <Table
          head={["Kind", "Reference shows", "You get", "Time"]}
          rows={[
            ["Coloured areas", "Tinted neighbourhoods with names", "Coloured, named areas", "~20 s"],
            ["Numbered plots", "Plot lines and a label on each plot", "Plots named from their labels", "1–3 min"],
            ["Amenity icons", "Round amenity badges", "Pins, one category per type, with icons", "seconds"],
            ["Coloured lines", "Bright, solid or dashed routes", "Line shapes in the same colours", "seconds"],
          ]}
        />
        <p>Results show in orange: click wrong ones to skip, then <b>Add</b>, then <b>Save</b>.</p>
        <Callout tone="warn" title="Note:">
          Generators fine-tune the placement, but a reference that is many percent off will still fail. Run <i>Auto-align</i> first.
        </Callout>
      </Section>

      <Section id="saving" title="Save & export" lead={<>Everything is in <C>data/project.json</C>. The <b>JSON ▾</b> menu:</>}>
        <Table
          head={["Action", "Result"]}
          rows={[
            [<>Save <Kbd>Ctrl</Kbd>+<Kbd>S</Kbd></>, <>Writes <C>data/project.json</C> — what the site reads.</>],
            ["Download project.json", "A backup to keep or send."],
            ["Download this scene", "Just the current image's data."],
            ["Copy plot paths", <><C>{"[{ id, label, kind, d }]"}</C> — <C>d</C> in image pixels.</>],
            ["Download plots as SVG", <>One <C>{"<path id>"}</C> per plot, sized like the image (for Figma / Illustrator).</>],
            ["Edit JSON…", "Edit project, scene or selected shapes; validated, undoable."],
            ["Import project.json…", "Load a downloaded file (Save afterwards to keep it)."],
          ]}
        />
        <Callout tone="warn" title="Warning:">
          The editor saves its whole in-memory project. If <C>data/project.json</C> was changed by a script while a tab was open, reload that tab before saving — otherwise it writes the old data back.
        </Callout>
      </Section>

      <Section id="hosted" title="Hosted editor" lead={<>A deployed site can&apos;t write files, so there <C>/editor</C> keeps everything <b>in the browser</b> (IndexedDB).</>}>
        <Bullets>
          <li><b>Save</b> stores the project and images in this browser only. Use <b>JSON ▾ → Download backup</b> to move or restore it.</li>
          <li><b>Preview ↗</b> opens <C>/preview</C>, the browser-saved project as visitors would see it.</li>
          <li><b>Generate</b> and <b>Import from GIS</b> need a <b>private Vercel Blob</b> store for images over 4.5 MB (sets <C>BLOB_READ_WRITE_TOKEN</C>).</li>
          <li>To publish: download the project, put it in <C>data/project.json</C> (images in <C>public/scenes/</C>), commit, deploy.</li>
        </Bullets>
        <p>Try hosted mode locally with <C>/editor?browser</C>.</p>
      </Section>

      {/* ───────────── Data ───────────── */}
      <Section id="data-model" title="project.json" lead={<>The full type is in <C>lib/types.ts</C>. A minimal project:</>}>
        <Code lang="json">{`
{
  "title": "Al Metlaa",
  "startScene": "masterplan",
  "categories": [
    { "id": "available", "label": "Available", "color": "#22c55e" },
    { "id": "sold",      "label": "Sold",      "color": "#ef4444" }
  ],
  "scenes": [
    {
      "id": "masterplan",
      "title": "Masterplan",
      "image": "/scenes/masterplan.webp",
      "width": 6000, "height": 4000,
      "shapes": [
        {
          "id": "MT01-V6-001",
          "label": "Villa 001",
          "kind": "polygon",
          "points": [[10.2, 20.5], [14.8, 20.5], [14.8, 26.1], [10.2, 26.1]],
          "category": "available",
          "link": "mt01"
        }
      ]
    }
  ]
}
`}</Code>
        <Callout title="Points are percent of the image (0–100), never pixels.">
          The overlay is an SVG with <C>viewBox=&quot;0 0 100 100&quot;</C> stretched over the image, so shapes stay put at every size and zoom.
        </Callout>
        <H3>Shape fields</H3>
        <Table
          head={["Field", "Type", "Description"]}
          rows={[
            [<C key="f">id</C>, "string", "Hotspot ID — unique in the scene."],
            [<C key="f">label</C>, "string", "Name shown in the tooltip / card."],
            [<C key="f">kind</C>, <C key="t">polygon | line | pin</C>, "Shape type."],
            [<C key="f">points</C>, <C key="t">[x, y][]</C>, "Percent of the image."],
            [<C key="f">category</C>, "string?", <>Category <C>id</C> (colour + legend).</>],
            [<C key="f">link</C>, "string?", <>Scene <C>id</C> to open on click.</>],
            [<C key="f">description</C>, "string?", "Text in the details card."],
            [<C key="f">info</C>, "object?", "Key / value rows in the details card."],
            [<C key="f">icon</C>, "string?", <>Pin icon: <C>&quot;builtin:park&quot;</C> or an image path.</>],
            [<C key="f">style</C>, "object?", <>Overrides for this shape. <a href="#style" className="text-sky-700 underline">See Styling ↓</a></>],
          ]}
        />
      </Section>

      <Section id="style" title="Styling plots" lead={<>Add a <C>&quot;style&quot;</C> object at any level; the most specific wins: <b>default → project → scene → category → shape</b>. The common choices need no JSON: editor left panel → <b>Plot look (viewer)</b>.</>}>
        <Table
          head={["Field", "Meaning", "Default"]}
          rows={[
            [<C key="f">fill</C>, "Fill colour", "category colour"],
            [<C key="f">fillOpacity</C>, <>0–1; <C>0</C> = outline only</>, "0.35"],
            [<><C>hoverFill</C> / <C>hoverFillOpacity</C></>, "Fill on hover / focus", "fill / 0.6"],
            [<><C>stroke</C> / <C>strokeWidth</C></>, "Outline colour / width (screen px)", "fill / 1.25"],
            [<><C>hoverStroke</C> / <C>hoverStrokeWidth</C></>, "Outline on hover", "stroke / strokeWidth"],
            [<C key="f">dash</C>, <>Dashed outline, e.g. <C>&quot;6 4&quot;</C></>, "solid"],
            [<C key="f">scaleWithZoom</C>, "Line width grows with zoom", "false"],
            [<C key="f">label</C>, <><C>&quot;hover&quot;</C> · <C>&quot;always&quot;</C> · <C>&quot;none&quot;</C></>, "\"hover\""],
            [<><C>labelColor</C> / <C>labelSize</C></>, "Label text colour / px", "white / 12"],
            [<C key="f">iconSize</C>, "Pin icon size (px)", "28"],
            [<C key="f">visible</C>, <><C>false</C> hides and disables the plot</>, "true"],
          ]}
        />
        <Code lang="jsonc">{`
// Project: outlines only, plot numbers always visible
"style": { "fillOpacity": 0, "stroke": "#ffffff", "strokeWidth": 2, "label": "always" }

// Category: sold plots greyed out
{ "id": "sold", "label": "Sold", "color": "#ef4444",
  "style": { "fill": "#404040", "fillOpacity": 0.65, "label": "none" } }

// Scene: invisible until hovered
"style": { "fillOpacity": 0, "strokeWidth": 0, "hoverFillOpacity": 0.5, "hoverStrokeWidth": 2 }
`}</Code>
      </Section>

      <Section id="plot-details" title="Plot details & Contentful" lead={<>Plot <b>outlines</b> live in <C>project.json</C>. Plot <b>details</b> (typology, status, area…) live separately and are joined by <b>hotspot ID</b>.</>}>
        <Steps>
          <li>Scene settings → <b>Plot details (Excel → Contentful)…</b> → <b>⬇ Template</b> (a CSV with every hotspot ID).</li>
          <li>Fill it in and upload it (.xlsx or .csv). Rows are validated and matched to plots.</li>
          <li><b>Save to local JSON</b> → <C>{"data/plot-details/<project>.json"}</C>. With Contentful set up, <b>Save &amp; publish to Contentful</b> also creates one <C>unit</C> entry per row.</li>
        </Steps>
        <p>Template columns: <C>hotspotId, zone, plotLabel, mdTypology, facadeOption, status, mdPlotArea, gfa, parking, confirmed</C>.</p>
        <H3>Contentful setup (optional)</H3>
        <p>Copy <C>.example.env</C> to <C>.env.local</C> (never committed) and restart <C>npm run dev</C>:</p>
        <Code lang="env">{`
CONTENTFUL_SPACE_ID=
CONTENTFUL_ENVIRONMENT=master
CONTENTFUL_MANAGEMENT_TOKEN=   # publishing, dev machine only
CONTENTFUL_DELIVERY_TOKEN=     # viewer reads details
CONTENTFUL_LOCALE=en-US
`}</Code>
        <p>The viewer merges local JSON and Contentful (Contentful wins, refreshed every minute).</p>
      </Section>

      <Section id="gis" title="Facilities from GIS" lead="Build a whole project from a facilities spreadsheet, a GeoPDF map and phase images with world files.">
        <Bullets>
          <li><b>New project:</b> <b>Projects ▾ → Import from GIS files…</b> (1–2 min), then <b>Open</b> it.</li>
          <li><b>Existing scene:</b> open the phase scene → <b>Facilities from GIS files…</b> (10–20 s, one undo step).</li>
        </Bullets>
        <Code lang="bash">{`
npm run import:facilities -- --xlsx facilities.xlsx --pdf facilities.pdf \\
  --masterplan masterplan.webp --phases "Phase images folder" \\
  --title "Al Metlaa"
`}</Code>
        <p>Writes <C>{"data/projects/<title>.json"}</C> and images to <C>{"public/scenes/<title>/"}</C>.</p>
      </Section>

      {/* ───────────── Developers ───────────── */}
      <Section id="embed" title="Embed the map" lead={<><C>{"<InteractiveMap>"}</C> fills its parent — give the parent a size. Pick the import that matches where you render it:</>}>
        <Table
          head={["You are in…", "Import", "Data from"]}
          rows={[
            ["Server component", <C key="i">InteractiveMapServer</C>, <><C>data/project.json</C>, read on the server</>],
            ["Client component", <C key="i">InteractiveMapClient</C>, <>Fetched from <C>/api/project</C> (or <C>src</C>)</>],
            ["Either, with data", <C key="i">InteractiveMap</C>, <>The <C>project</C> prop</>],
          ]}
        />
        <Code lang="tsx">{`
// Server component
import { InteractiveMapServer } from "@/components/viewer/interactive-map.server";

export default function Page() {
  return <InteractiveMapServer className="h-[600px] rounded-xl overflow-hidden" />;
}
`}</Code>
        <Code lang="tsx">{`
// Client component
"use client";
import { useState } from "react";
import { InteractiveMapClient } from "@/components/viewer/interactive-map.client";

export function Explorer() {
  const [scene, setScene] = useState<string>();
  return <InteractiveMapClient sceneId={scene} onSceneChange={setScene} className="h-[600px]" />;
}
`}</Code>
        <p>
          Live examples: <Link href="/examples/server" className="text-sky-700 underline">/examples/server</Link> and{" "}
          <Link href="/examples/client" className="text-sky-700 underline">/examples/client</Link>.
        </p>
      </Section>

      <Section id="props" title="Props">
        <Table
          head={["Prop", "Type", "Default", "Description"]}
          rows={[
            [<C key="p">project</C>, <C key="t">Project</C>, "—", <>Required on bare <C>InteractiveMap</C> only.</>],
            [<C key="p">navigation</C>, <C key="t">{"\"inline\" | \"route\""}</C>, <C key="d">&quot;inline&quot;</C>, <><C>inline</C>: scenes change inside the component. <C>route</C>: each scene is its own URL (<C>{"/scene/<id>"}</C>).</>],
            [<C key="p">sceneId</C>, <C key="t">string</C>, "start scene", "Scene to show. Changing it moves the map."],
            [<C key="p">onSceneChange</C>, <C key="t">{"(id) => void"}</C>, "—", "Inline mode: called when the user zooms in or out."],
            [<C key="p">className</C>, <C key="t">string</C>, <C key="d">h-full w-full</C>, "Size and styling of the box."],
            [<C key="p">src</C>, <C key="t">string</C>, <C key="d">/api/project</C>, <><C>InteractiveMapClient</C> only: where to fetch the JSON.</>],
          ]}
        />
        <H3>Data helpers</H3>
        <Table
          head={["Helper", "Where", "Returns"]}
          rows={[
            [<C key="h">getProject()</C>, <><C>lib/project.ts</C> — server only</>, <><C>Project</C> from the file</>],
            [<C key="h">getViewerProject()</C>, <><C>lib/project.ts</C> — server only</>, <><C>Project</C> with plot details merged</>],
            [<C key="h">useProject(src?)</C>, <><C>lib/use-project.ts</C> — client</>, <><C>Project</C> via <C>GET /api/project</C></>],
          ]}
        />
      </Section>

      <Section id="api" title="API routes">
        <Table
          head={["Route", "Method", "Description"]}
          rows={[
            [<C key="r">/api/project</C>, "GET", "The project JSON (for client components)."],
            [<C key="r">/api/project</C>, "PUT", <>Editor save. {DEV_ONLY}</>],
            [<C key="r">/api/plot-details</C>, "GET", "Plot details by hotspot ID, for other front ends."],
            [<C key="r">/api/plot-details</C>, "POST / PUT", <>Save details from the editor (local JSON / Contentful). {DEV_ONLY}</>],
            [<C key="r">/api/upload</C>, "POST", <>Editor image upload. {DEV_ONLY}</>],
            [<C key="r">/api/projects</C>, "GET / POST", <>List, create or open projects. {DEV_ONLY}</>],
            [<C key="r">/api/generate</C>, "POST", <>Runs a <i>Generate from reference</i> script.</>],
            [<C key="r">/api/import-facilities</C>, "POST", "GIS facilities import."],
          ]}
        />
      </Section>

      <Section id="cli" title="CLI scripts">
        <Code lang="bash">{`
npm run dev           # viewer + editor at http://localhost:3001
npm run build         # production build (editor and write APIs disabled)
npm run start         # serve the build
npm run lint
npm run type-check
`}</Code>
        <p>Generators — add <C>--preview out.jpg</C> to look without changing anything:</p>
        <Code lang="bash">{`
npm run plots:from-reference     -- <sceneId> --dry --preview /tmp/check.jpg
npm run areas:from-reference     -- <sceneId> --preview /tmp/check.jpg
npm run amenities:from-reference -- <sceneId> --preview /tmp/check.jpg
npm run lines:from-reference     -- <sceneId> --preview /tmp/check.jpg
`}</Code>
      </Section>

      <Section id="structure" title="Project structure">
        <Code>{`
data/project.json        the data: scenes → shapes
data/plot-details/       plot details per project (by hotspot ID)
data/projects/           other saved projects
public/scenes/           the images
app/scene/[id]/          full-screen viewer, one page per scene
app/editor/              editor
app/documentation/       this page
app/api/                 project, upload, generate, plot-details…
components/viewer/       interactive-map, scene-viewer, shape-layer, details-card
components/editor/       editor, canvas, panels, dialogs
components/ui.ts         shared Tailwind classes — restyle here
lib/types.ts             the data model — start reading here
lib/style.ts             style cascade (resolveStyle)
lib/trace.ts             wand + auto-detect
scripts/                 image-processing generators (Node + sharp)
`}</Code>
      </Section>

      {/* ───────────── Reference ───────────── */}
      <Section id="shortcuts" title="Keyboard shortcuts">
        <Table
          head={["Keys", "Action"]}
          rows={[
            [<><Kbd>Space</Kbd>+drag · wheel / pinch</>, "Pan · zoom"],
            [<><Kbd>Shift</Kbd>+click · <Kbd>Shift</Kbd>+drag</>, "Add to selection · box-select"],
            [<><Kbd>Ctrl</Kbd>+<Kbd>A</Kbd></>, "Select all"],
            [<>Arrows (<Kbd>Shift</Kbd> = bigger)</>, "Nudge selection"],
            [<><Kbd>Alt</Kbd>+click a vertex</>, "Delete the vertex"],
            [<><Kbd>Backspace</Kbd> · <Kbd>Enter</Kbd> · <Kbd>Esc</Kbd></>, "While drawing: remove last point · finish · cancel"],
            [<Kbd key="k">Del</Kbd>, "Delete selection"],
            [<><Kbd>Ctrl</Kbd>+<Kbd>Z</Kbd> / <Kbd>Ctrl</Kbd>+<Kbd>Shift</Kbd>+<Kbd>Z</Kbd></>, "Undo / redo"],
            [<><Kbd>Ctrl</Kbd>+<Kbd>S</Kbd></>, "Save"],
            [<><Kbd>P</Kbd> <Kbd>W</Kbd> <Kbd>D</Kbd> <Kbd>L</Kbd> <Kbd>I</Kbd> <Kbd>N</Kbd></>, "Draw area · Wand · Auto-detect · Line · Pin · Number"],
          ]}
        />
      </Section>

      <Section id="images" title="Preparing images">
        <Bullets>
          <li>Export <b>WebP or PNG, ≤ 6000 px</b> on the long side. The viewer zooms up to 10×.</li>
          <li>Same-scale crops for every level (e.g. each phase cut from the masterplan) make linking easier.</li>
          <li>To swap in a new render: <b>Scene settings → Replace image</b>. Keep the same aspect ratio or shapes will be off.</li>
        </Bullets>
      </Section>

      <Section id="faq" title="FAQ">
        {[
          ["Why does the deployed editor not change the live site?", <>Production builds can&apos;t write files. The deployed <C>/editor</C> saves to your browser instead — see <a href="#hosted" className="text-sky-700 underline">Hosted editor</a>.</>],
          ["My shapes moved after replacing the image.", "Points are percent of the image, so a different aspect ratio stretches them. Use an image with the same proportions."],
          ["Auto-detect merges neighbouring plots.", <>Lower <i>Tolerance</i>, or <Kbd>Shift</Kbd>+drag a box to work one block at a time.</>],
          ["Where do plot status and area come from?", <>Not from <C>project.json</C> — from <C>data/plot-details/</C> and/or Contentful, joined by hotspot ID. See <a href="#plot-details" className="text-sky-700 underline">Plot details</a>.</>],
          ["How do I show live availability from a CRM?", <>Keep shape IDs equal to the CRM&apos;s unit numbers, fetch in the viewer and set each shape&apos;s <C>category</C> by <C>id</C> before rendering.</>],
        ].map(([q, a], i) => (
          <div key={i}>
            <p className="font-semibold text-neutral-900">{q}</p>
            <p>{a}</p>
          </div>
        ))}
        <p className="pt-8 text-sm text-neutral-500 italic">Interactive Map documentation · v{pkg.version} · Full details in README.md.</p>
      </Section>
    </DocsShell>
  );
}
