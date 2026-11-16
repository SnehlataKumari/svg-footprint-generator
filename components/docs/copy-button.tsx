"use client";

import { useState } from "react";

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() =>
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        })
      }
      className="cursor-pointer rounded border border-white/15 px-2 py-0.5 text-[11px] text-neutral-300 hover:bg-white/10"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
