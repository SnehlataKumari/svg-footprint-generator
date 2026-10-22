"use client";

import { useState } from "react";
import { INPUT, LABEL } from "../ui";

/**
 * Text input that commits on blur / Enter instead of on every keystroke, so
 * typing a label is one undo step (and an id isn't renamed letter by letter).
 * Remount it (`key`) when the thing it edits changes.
 */
export function Field(props: {
  label: string;
  value: string;
  onCommit: (value: string) => void;
  multiline?: boolean;
  placeholder?: string;
  hint?: string;
}) {
  const [draft, setDraft] = useState(props.value);
  const [prev, setPrev] = useState(props.value);
  if (prev !== props.value) {
    // Changed from outside (undo, rename…): show the new value.
    setPrev(props.value);
    setDraft(props.value);
  }
  const commit = () => draft !== props.value && props.onCommit(draft);
  const common = {
    value: draft,
    placeholder: props.placeholder,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(e.target.value),
    onBlur: commit,
  };
  return (
    <label className="block space-y-1">
      <span className={LABEL}>{props.label}</span>
      {props.multiline ? (
        <textarea {...common} rows={3} className={`${INPUT} h-auto py-1.5`} />
      ) : (
        <input {...common} onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()} className={INPUT} />
      )}
      {props.hint && <span className="block text-[11px] text-neutral-500">{props.hint}</span>}
    </label>
  );
}

/** Uploads an image into public/scenes/ (dev API) and measures it. */
export async function uploadImage(file: File): Promise<{ src: string; width: number; height: number }> {
  const body = new FormData();
  body.append("file", file);
  const res = await fetch("/api/upload", { method: "POST", body });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Upload failed");
  const { width, height } = await new Promise<{ width: number; height: number }>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error("Uploaded file isn't a readable image"));
    img.src = `${data.src}?v=${Date.now()}`;
  });
  return { src: data.src, width, height };
}

export const slugify = (s: string) =>
  s.toLowerCase().replace(/\.[a-z0-9]+$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "scene";
