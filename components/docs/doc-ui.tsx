import type { ReactNode } from "react";
import { CopyButton } from "./copy-button";

/** Building blocks for the /documentation page — plain server components. */

export function Section({ id, title, lead, children }: { id: string; title: string; lead?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 border-t border-neutral-200 pt-8 first:border-0 first:pt-0">
      <h2 className="mb-2 text-2xl font-semibold text-neutral-900">{title}</h2>
      {lead && <p className="mb-4 text-neutral-600">{lead}</p>}
      <div className="space-y-4">{children}</div>
    </section>
  );
}

export function H3({ children }: { children: ReactNode }) {
  return <h3 className="pt-2 text-lg font-semibold text-neutral-900">{children}</h3>;
}

export function C({ children }: { children: ReactNode }) {
  return <code className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[13px] text-neutral-800">{children}</code>;
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-b-2 border-neutral-300 bg-neutral-50 px-1.5 py-px font-mono text-xs text-neutral-700">
      {children}
    </kbd>
  );
}

export function Code({ lang, children }: { lang?: string; children: string }) {
  const code = children.replace(/^\n/, "").trimEnd();
  return (
    <div className="relative">
      <div className="absolute top-2 right-2 flex items-center gap-2">
        {lang && <span className="text-[11px] tracking-wide text-neutral-400 uppercase">{lang}</span>}
        <CopyButton text={code} />
      </div>
      <pre className="overflow-x-auto rounded-lg bg-neutral-900 p-4 pr-24 font-mono text-[13px] leading-relaxed text-neutral-100">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-neutral-200">
      <table className="w-full text-left text-sm">
        <thead className="bg-neutral-50 text-neutral-900">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-3 py-2 font-semibold whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t border-neutral-200 align-top">
              {row.map((cell, j) => (
                <td key={j} className={`px-3 py-2 ${j === 0 ? "whitespace-nowrap" : ""}`}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Callout({ tone = "note", title, children }: { tone?: "note" | "warn"; title: string; children: ReactNode }) {
  const color = tone === "warn" ? "border-amber-400 bg-amber-50" : "border-sky-400 bg-sky-50";
  return (
    <div className={`rounded-r-lg border-l-4 px-4 py-3 text-sm ${color}`}>
      <b>{title}</b> {children}
    </div>
  );
}

export function Steps({ children }: { children: ReactNode }) {
  return <ol className="list-decimal space-y-1.5 pl-6">{children}</ol>;
}

export function Bullets({ children }: { children: ReactNode }) {
  return <ul className="list-disc space-y-1.5 pl-6">{children}</ul>;
}
