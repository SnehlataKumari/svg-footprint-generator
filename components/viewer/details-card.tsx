"use client";

import gsap from "gsap";
import { useEffect, useRef, useState } from "react";
import { imageUrl } from "@/lib/browser-store";
import type { Category, Shape } from "@/lib/types";
import { SURFACE } from "../ui";

interface Props {
  shape: Shape;
  category?: Category;
  /** Title of the linked scene, if the shape links somewhere. */
  linkTitle?: string;
  onClose: () => void;
  onEnter: () => void;
}

/** Non-modal details panel for a clicked shape. Focus moves into it on open
 *  and back to the clicked shape on close; Escape closes (SceneViewer). */
export function DetailsCard({ shape, category, linkTitle, onClose, onEnter }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  // the card's pictures: the shape's own image, then the plot details' (facade, renders…)
  const images = [shape.image, ...(shape.images ?? [])].filter((src): src is string => !!src);
  const [shown, setShown] = useState({ id: shape.id, i: 0 }); // back to the first picture for another plot
  const picture = images[Math.min(shown.id === shape.id ? shown.i : 0, images.length - 1)];

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    // explicit end values, and stopped on cleanup: a second run (React dev) must not freeze it half-faded
    const tween =
      ref.current && !window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? gsap.fromTo(ref.current, { y: 16, opacity: 0 }, { y: 0, opacity: 1, duration: 0.25, ease: "power2.out", clearProps: "transform,opacity" })
        : null;
    return () => {
      tween?.kill();
      opener?.focus?.();
    };
  }, [shape.id]);

  const info = Object.entries(shape.info ?? {});

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={shape.label || shape.id}
      tabIndex={-1}
      className={`absolute top-16 right-4 z-30 w-[min(22rem,calc(100%-2rem))] max-h-[calc(100%-5rem)] overflow-y-auto outline-none ${SURFACE}`}
    >
      {picture && (
        <a href={imageUrl(picture)} target="_blank" rel="noreferrer" title="Open full size">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl(picture)} alt="" className="h-44 w-full object-cover" />
        </a>
      )}
      {images.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto px-4 pt-2">
          {images.map((src, i) => (
            <button
              key={src}
              type="button"
              onClick={() => setShown({ id: shape.id, i })}
              aria-label={`Picture ${i + 1} of ${images.length}`}
              aria-pressed={src === picture}
              className={`h-12 w-16 shrink-0 cursor-pointer overflow-hidden rounded ${src === picture ? "ring-2 ring-neutral-900" : "opacity-70 hover:opacity-100"}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imageUrl(src)} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
      <div className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">{shape.label || shape.id}</h2>
            {category && (
              <span className="mt-1 inline-flex items-center gap-1.5 text-xs text-neutral-600">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: category.color }} />
                {category.label}
              </span>
            )}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="cursor-pointer rounded p-1 text-neutral-500 hover:bg-neutral-100">
            ✕
          </button>
        </div>

        {shape.description && <p className="text-sm whitespace-pre-line text-neutral-700">{shape.description}</p>}

        {info.length > 0 && (
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
            {info.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-neutral-500">{k}</dt>
                <dd className="text-right font-medium">{v}</dd>
              </div>
            ))}
          </dl>
        )}

        {(shape.documents?.length ?? 0) > 0 && (
          <ul className="space-y-1.5">
            {shape.documents!.map((d) => (
              <li key={d.url}>
                <a href={imageUrl(d.url)} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-2 rounded-md border border-black/10 px-3 py-2 text-sm hover:bg-neutral-100">
                  <span className="truncate">📄 {d.title}</span>
                  <span className="text-neutral-400">↗</span>
                </a>
              </li>
            ))}
          </ul>
        )}

        <div className="flex gap-2 pt-1">
          {shape.url && (
            <a href={shape.url} target="_blank" rel="noreferrer" className="flex-1 rounded-md border border-black/10 px-3 py-2 text-center text-sm hover:bg-neutral-100">
              Open link ↗
            </a>
          )}
          {shape.link && (
            <button type="button" onClick={onEnter} className="flex-1 cursor-pointer rounded-md bg-neutral-900 px-3 py-2 text-sm text-white hover:bg-neutral-700">
              {linkTitle ? `View ${linkTitle} →` : "View →"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
