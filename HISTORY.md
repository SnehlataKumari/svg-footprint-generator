# History

What changed in this project and why — newest first. Add an entry with every
change (see `CLAUDE.md` → Commits & history).

## 2026-11-19 — Publish the "New project" map; hosted editor opens with it

- **Data:** `data/project.json` is now the "New project" map (12 scenes,
  categories incl. status categories, 2 297 plot details), imported from a
  hosted-editor backup and edited in the editor.
- **Images:** the backup's browser-stored images (`local:…` links, which only
  work in the browser that made them) were saved to `public/scenes/`
  (`city*.jpg/webp`, `building1.jpg`, `floorplan1–3.jpg`, `villa1.jpg`,
  `ncr.webp`, `andrew-stutesman-…-1-.jpg`, `india.jpg`) and the project now
  points at `/scenes/<file>`.
- **Hosted editor:** on a browser with nothing saved yet, `/editor` now opens
  the deployed `data/project.json` instead of an empty project
  (`app/editor/page.tsx`, `components/editor/browser-editor.tsx`,
  `lib/browser-store.ts` `openedProject(starter)`). Browsers that already
  have a saved project keep opening theirs.
- **Known issue:** the plot details are keyed `C3-001`-style, but the shapes
  are named `c1-A-001`-style, so no details show on the map yet.
- **Docs:** `CLAUDE.md` — no Claude co-author lines in commits; keep this file.
