"use client";

import { useState } from "react";
import { BUILTIN_ICONS, BUILTIN_PREFIX } from "@/lib/icons";
import { PinIcon } from "../pin-icon";
import { SURFACE } from "../ui";
import { uploadImage } from "./fields";

interface Props {
  /** Current icon ("builtin:<name>", an image path / URL) or none. */
  value?: string;
  /** Colour the built-in symbols are drawn on (the category's / pin's colour). */
  color: string;
  onChange: (icon: string | undefined) => void;
  onStatus: (message: string, error?: boolean) => void;
  /** Size of the button showing the current icon. */
  size?: number;
  /** Which side the menu opens towards. */
  align?: "left" | "right";
}

/**
 * Pick a pin icon: one of the built-in symbols (no files needed), your own
 * image, or none (the pin shows its label instead).
 */
export function IconPicker({ value, color, onChange, onStatus, size = 32, align = "left" }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const pick = (icon: string | undefined) => {
    onChange(icon);
    setOpen(false);
  };
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        className="flex cursor-pointer items-center justify-center rounded-full hover:ring-2 hover:ring-sky-400"
        style={{ width: size, height: size }}
        onClick={() => setOpen((o) => !o)}
        aria-label="Choose an icon"
        aria-expanded={open}
        title="Choose an icon"
      >
        {value ? (
          <PinIcon icon={value} color={color} size={size} />
        ) : (
          <span className="flex h-full w-full items-center justify-center rounded-full border border-dashed border-black/25 text-[10px] text-neutral-400">icon</span>
        )}
      </button>
      {open && (
        <div className={`absolute top-full z-40 mt-1 w-60 space-y-2 p-2 ${align === "right" ? "right-0" : "left-0"} ${SURFACE}`}>
          <div className="text-[11px] font-medium tracking-wide text-neutral-500 uppercase">Built-in</div>
          <div className="grid grid-cols-6 gap-1.5">
            {Object.entries(BUILTIN_ICONS).map(([name, { label }]) => {
              const icon = BUILTIN_PREFIX + name;
              return (
                <button
                  key={name}
                  type="button"
                  title={label}
                  aria-label={label}
                  className={`flex cursor-pointer items-center justify-center rounded-full p-0.5 hover:bg-neutral-100 ${value === icon ? "ring-2 ring-sky-500" : ""}`}
                  onClick={() => pick(icon)}
                >
                  <PinIcon icon={icon} color={color} size={28} />
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-2 border-t border-black/10 pt-2 text-sm">
            <label className={`flex-1 cursor-pointer rounded-md border border-black/10 px-2 py-1 text-center hover:bg-neutral-100 ${busy ? "opacity-50" : ""}`}>
              {busy ? "Uploading…" : "Upload your own…"}
              <input
                type="file"
                accept="image/*"
                hidden
                disabled={busy}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  setBusy(true);
                  try {
                    pick((await uploadImage(file)).src);
                  } catch (err) {
                    onStatus((err as Error).message, true);
                  } finally {
                    setBusy(false);
                  }
                }}
              />
            </label>
            <button type="button" className="cursor-pointer px-1 text-xs text-sky-700 underline" onClick={() => pick(undefined)}>
              No icon
            </button>
          </div>
          <p className="text-[11px] text-neutral-500">Built-in symbols use this colour. No icon: the pin shows its name.</p>
        </div>
      )}
    </div>
  );
}
