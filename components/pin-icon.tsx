import { BUILTIN_ICONS, builtinName } from "@/lib/icons";

/**
 * A pin's icon, wherever one is shown (viewer, editor, pickers): a built-in
 * symbol on a circle in `color`, or the image at `icon`.
 */
export function PinIcon({ icon, color, size, className = "", title }: { icon: string; color: string; size: number; className?: string; title?: string }) {
  const name = builtinName(icon);
  if (name) {
    const glyph = BUILTIN_ICONS[name] ?? BUILTIN_ICONS.info;
    return (
      <span
        className={`inline-flex shrink-0 items-center justify-center rounded-full border-2 border-white shadow-[0_1px_3px_rgba(0,0,0,0.45)] ${className}`}
        style={{ width: size, height: size, background: color }}
        title={title}
      >
        <svg
          viewBox="0 0 24 24"
          width={size * 0.62}
          height={size * 0.62}
          fill="none"
          stroke="#fff"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          // Static markup from lib/icons.ts, never user input.
          dangerouslySetInnerHTML={{ __html: glyph.svg }}
        />
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={icon} alt="" title={title} draggable={false} className={`shrink-0 rounded-full object-contain ${className}`} style={{ width: size, height: size }} />
  );
}
