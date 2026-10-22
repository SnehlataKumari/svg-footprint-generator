/** Shared class recipes, so every floating control looks the same. Change the
 *  look of the whole app here. */

export const SURFACE =
  "rounded-xl border border-black/10 bg-white/95 text-neutral-900 shadow-lg backdrop-blur";
export const PILL = `${SURFACE} flex h-9 items-center gap-2 px-3 text-sm`;
export const ICON_BUTTON =
  "flex h-9 w-9 cursor-pointer items-center justify-center text-lg hover:bg-neutral-100 disabled:opacity-40";
export const BUTTON =
  "inline-flex h-8 cursor-pointer items-center justify-center gap-1 rounded-md border border-black/10 bg-white px-2.5 text-sm hover:bg-neutral-100 disabled:cursor-default disabled:opacity-40";
export const PRIMARY_BUTTON =
  "inline-flex h-8 cursor-pointer items-center justify-center gap-1 rounded-md bg-neutral-900 px-3 text-sm text-white hover:bg-neutral-700 disabled:cursor-default disabled:opacity-40";
export const INPUT =
  "h-8 w-full rounded-md border border-black/15 bg-white px-2 text-sm outline-none focus:border-sky-500";
export const LABEL = "text-[11px] font-medium uppercase tracking-wide text-neutral-500";
