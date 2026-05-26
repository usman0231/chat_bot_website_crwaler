import Link from "next/link";

import { Logo } from "@/components/logo";
import { BRAND } from "@/lib/brand";

const API_DOCS_URL = `${
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"
}/docs`;

const DEMO_HREF = `/widget-demo?bot_id=bot_4e84b82977`;

const COLS = [
  {
    heading: "Product",
    links: [
      { label: "Features", href: "#features" },
      { label: "Pricing", href: "#pricing" },
      { label: "API docs", href: API_DOCS_URL, external: true },
      { label: "Live demo", href: DEMO_HREF },
    ],
  },
  {
    heading: "Resources",
    links: [
      { label: "Documentation", href: "#" },
      { label: "GitHub", href: "#" },
      { label: "Status", href: "#" },
      { label: "Changelog", href: "#" },
    ],
  },
  {
    heading: "Company",
    links: [
      { label: "About", href: "#" },
      { label: "Blog", href: "#" },
      { label: "Contact", href: "#" },
      { label: "Privacy", href: "#" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="relative border-t border-white/10 bg-black text-white/80">
      <div className="mx-auto max-w-6xl px-4 py-16">
        <div className="grid grid-cols-1 gap-10 md:grid-cols-4">
          <div className="md:col-span-1">
            <Logo size="md" variant="horizontal" />
            <p className="mt-3 text-sm text-white/55">{BRAND.tagline}.</p>
            <p className="mt-3 text-xs text-white/40">
              Built for university competition 2026
            </p>
          </div>

          {COLS.map((col) => (
            <div key={col.heading}>
              <h3 className="text-sm font-semibold text-white">{col.heading}</h3>
              <ul className="mt-4 space-y-2.5 text-sm">
                {col.links.map((link) => {
                  const isExternal = "external" in link && link.external;
                  const isHash = link.href.startsWith("#");
                  if (isExternal) {
                    return (
                      <li key={link.label}>
                        <a
                          href={link.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-white/55 transition-colors hover:text-white"
                        >
                          {link.label}
                        </a>
                      </li>
                    );
                  }
                  if (isHash) {
                    return (
                      <li key={link.label}>
                        <a
                          href={link.href}
                          className="text-white/55 transition-colors hover:text-white"
                        >
                          {link.label}
                        </a>
                      </li>
                    );
                  }
                  return (
                    <li key={link.label}>
                      <Link
                        href={link.href}
                        className="text-white/55 transition-colors hover:text-white"
                      >
                        {link.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col-reverse items-start justify-between gap-4 border-t border-white/10 pt-8 sm:flex-row sm:items-center">
          <p className="text-xs text-white/45">
            &copy; 2026 {BRAND.name}. Built for the future.
          </p>
          <p className="text-xs text-white/45">
            Powered by Qwen 2.5 · ChromaDB · FastAPI
          </p>
        </div>
      </div>
    </footer>
  );
}
