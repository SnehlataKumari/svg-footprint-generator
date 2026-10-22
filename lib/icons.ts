/**
 * Built-in pin icons, for when you don't have your own: a white symbol drawn
 * on a circle in the pin's colour (its category / own colour). A pin or
 * category stores one as `icon: "builtin:<name>"`; any other `icon` value is
 * an image path or URL.
 *
 * Each symbol is SVG markup in a 24×24 box, drawn with a white 2px stroke and
 * no fill (fill="#fff" where a shape needs it).
 */
export const BUILTIN_ICONS: Record<string, { label: string; svg: string }> = {
  park: { label: "Park", svg: '<circle cx="12" cy="9" r="5"/><path d="M12 14v7M9 21h6"/>' },
  dining: { label: "Dining", svg: '<path d="M7 3v18M5 3v5a2 2 0 0 0 4 0V3M17 3c-2.5 2-2.5 7 0 9v9"/>' },
  cafe: { label: "Café", svg: '<path d="M5 9h11v4a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5V9zM16 10h1.5a2.5 2.5 0 0 1 0 5H16M8 3.5v2.5M12 3.5v2.5"/>' },
  cycling: { label: "Cycling", svg: '<circle cx="6" cy="16" r="4"/><circle cx="18" cy="16" r="4"/><path d="M6 16l4-7h5l3 7M10 9l2.5 7M13.5 6H17"/>' },
  jogging: { label: "Jogging", svg: '<circle cx="14.5" cy="4.5" r="2"/><path d="M7 21l3.5-6 3 2.5V21M5 11.5l3.5-3 4.5 1 2 3.5 3.5 1M10.5 15l2.5-5.5"/>' },
  school: { label: "School", svg: '<path d="M2 9l10-5 10 5-10 5L2 9zM6 11v5c3.5 2.5 8.5 2.5 12 0v-5M22 9v6"/>' },
  shopping: { label: "Shopping", svg: '<path d="M5 8h14l-1.2 13H6.2L5 8zM9 8V6.5a3 3 0 0 1 6 0V8"/>' },
  water: { label: "Water / pool", svg: '<path d="M3 8c3-2 6 2 9 0s6-2 9 0M3 13c3-2 6 2 9 0s6-2 9 0M3 18c3-2 6 2 9 0s6-2 9 0"/>' },
  mosque: { label: "Mosque", svg: '<path d="M15 3.5a8.5 8.5 0 1 0 5.5 14 7 7 0 1 1-5.5-14z"/>' },
  gym: { label: "Gym", svg: '<path d="M6.5 7v10M3.5 9.5v5M17.5 7v10M20.5 9.5v5M6.5 12h11"/>' },
  playground: { label: "Playground", svg: '<path d="M4 21V9l4-4 4 4v12M4 14h8M12 10l8 11"/>' },
  parking: { label: "Parking", svg: '<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M10 17V7h3a3 3 0 0 1 0 6h-3"/>' },
  health: { label: "Health", svg: '<path d="M10 4h4v6h6v4h-6v6h-4v-6H4v-4h6z"/>' },
  bus: { label: "Bus", svg: '<rect x="5" y="3" width="14" height="15" rx="2"/><path d="M5 11h14M8 18v3M16 18v3"/><circle cx="8.5" cy="14.5" r="0.8" fill="#fff"/><circle cx="15.5" cy="14.5" r="0.8" fill="#fff"/>' },
  metro: { label: "Metro", svg: '<rect x="6" y="3" width="12" height="14" rx="3"/><path d="M6 10h12M8.5 21l2-4M15.5 21l-2-4"/>' },
  community: { label: "Community", svg: '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.3"/><path d="M3 20c.5-4 3-6 6-6s5.5 2 6 6M15 14.5c3 0 5 1.8 5.5 5.5"/>' },
  info: { label: "Info", svg: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>' },
  landmark: { label: "Landmark", svg: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>' },
};

export const BUILTIN_PREFIX = "builtin:";

/** The built-in icon's name, or null when `icon` is an image path / URL. */
export const builtinName = (icon?: string) => (icon?.startsWith(BUILTIN_PREFIX) ? icon.slice(BUILTIN_PREFIX.length) : null);
