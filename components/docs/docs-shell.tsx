"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { BUTTON } from "@/components/ui";

export type DocsNavGroup = { title: string; links: { id: string; label: string }[] };

/** Header + sidebar of the /documentation page: highlights the section in
 *  view, and folds the sidebar into a menu on small screens. */
export function DocsShell({ title, version, nav, children }: { title: string; version: string; nav: DocsNavGroup[]; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(nav[0]?.links[0]?.id);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(e.target.id);
      },
      { rootMargin: "-80px 0px -70% 0px" },
    );
    document.querySelectorAll("main section[id]").forEach((s) => observer.observe(s));
    return () => observer.disconnect();
  }, []);

  return (
    <div className="min-h-screen bg-white text-[15px] leading-relaxed text-neutral-700">
      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-neutral-200 bg-white/95 px-4 backdrop-blur">
        <button type="button" className={`${BUTTON} md:hidden`} onClick={() => setOpen((o) => !o)} aria-label="Menu">
          ☰
        </button>
        <span className="font-semibold text-neutral-900">{title}</span>
        <span className="hidden text-neutral-500 sm:inline">Documentation</span>
        <span className="rounded-full bg-sky-50 px-2 py-0.5 text-xs text-sky-700">v{version}</span>
        <span className="flex-1" />
        <Link href="/" className={BUTTON}>Open map</Link>
      </header>

      <div className="flex">
        <nav
          className={`fixed top-14 z-10 h-[calc(100vh-3.5rem)] w-64 shrink-0 overflow-y-auto border-r border-neutral-200 bg-neutral-50 px-3 py-5 transition-transform md:sticky md:translate-x-0 ${
            open ? "translate-x-0 shadow-xl" : "-translate-x-full"
          }`}
        >
          {nav.map((group) => (
            <div key={group.title} className="mb-5">
              <p className="mb-1 px-2.5 text-[11px] font-medium tracking-wide text-neutral-500 uppercase">{group.title}</p>
              {group.links.map((l) => (
                <a
                  key={l.id}
                  href={`#${l.id}`}
                  onClick={() => setOpen(false)}
                  className={`block rounded-md px-2.5 py-1 text-sm ${
                    active === l.id ? "bg-sky-100 font-semibold text-sky-800" : "text-neutral-700 hover:bg-neutral-200/60"
                  }`}
                >
                  {l.label}
                </a>
              ))}
            </div>
          ))}
        </nav>

        <main className="min-w-0 flex-1 px-4 py-8 md:px-12">
          <div className="mx-auto max-w-3xl space-y-12">{children}</div>
        </main>
      </div>
    </div>
  );
}
