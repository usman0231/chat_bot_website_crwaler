"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";

import { BRAND } from "@/lib/brand";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? "http://localhost:8000";
const API_KEY = process.env.NEXT_PUBLIC_API_KEY ?? "";

function DemoSite({ botId }: { botId: string }) {
  React.useEffect(() => {
    if (!botId) return;
    const script = document.createElement("script");
    script.src = `${API_URL}/widget.js`;
    script.async = true;
    script.setAttribute("data-bot-id", botId);
    if (API_KEY) script.setAttribute("data-api-key", API_KEY);
    script.setAttribute("data-sitebot", "demo-loader");
    document.body.appendChild(script);

    return () => {
      script.parentElement?.removeChild(script);
      document
        .querySelectorAll('[data-sitebot="launcher"], [data-sitebot="panel"]')
        .forEach((el) => el.parentElement?.removeChild(el));
      delete (window as unknown as { __sitebotWidgetLoaded?: boolean })
        .__sitebotWidgetLoaded;
    };
  }, [botId]);

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-emerald-400 to-cyan-500" />
            <span className="text-lg font-semibold tracking-tight">
              Acme Outdoor Co.
            </span>
          </div>
          <nav className="hidden gap-6 text-sm text-slate-600 sm:flex">
            <a className="hover:text-slate-900" href="#">Shop</a>
            <a className="hover:text-slate-900" href="#">Guides</a>
            <a className="hover:text-slate-900" href="#">About</a>
            <a className="hover:text-slate-900" href="#">Contact</a>
          </nav>
        </div>
      </header>

      <section className="mx-auto max-w-5xl px-6 py-20">
        <p className="text-xs font-medium uppercase tracking-widest text-emerald-600">
          Demo site
        </p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight sm:text-5xl">
          Gear that goes wherever you do.
        </h1>
        <p className="mt-5 max-w-2xl text-lg text-slate-600">
          This is a sample customer website. The chat bubble in the
          bottom-right corner is the {BRAND.name} widget — trained on your own
          content. Click it to ask a question.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <button
            type="button"
            className="rounded-full bg-slate-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-slate-800"
          >
            Shop the collection
          </button>
          <button
            type="button"
            className="rounded-full border border-slate-300 px-5 py-2.5 text-sm font-medium hover:bg-slate-50"
          >
            Read our story
          </button>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-6 pb-20">
        <div className="grid gap-6 sm:grid-cols-3">
          {[
            {
              title: "Lifetime repair",
              body: "Tear it, snag it, send it back. We'll fix or replace anything we make.",
            },
            {
              title: "Shipped in 48h",
              body: "Orders before 2pm leave the same day. Free over $75.",
            },
            {
              title: "Field-tested",
              body: "Every product is run through a season of real use before launch.",
            },
          ].map((card) => (
            <div
              key={card.title}
              className="rounded-2xl border border-slate-200 p-5"
            >
              <p className="text-sm font-semibold">{card.title}</p>
              <p className="mt-1 text-sm text-slate-600">{card.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-slate-200 bg-slate-50">
        <div className="mx-auto max-w-3xl px-6 py-16 text-slate-700">
          <h2 className="text-2xl font-semibold tracking-tight">About us</h2>
          <p className="mt-4">
            Acme Outdoor Co. was started in 2014 by two trail runners who
            couldn&apos;t find a vest that fit. We&apos;ve grown a lot since
            then but the rule hasn&apos;t changed: if we wouldn&apos;t take it
            out for a hundred miles, we don&apos;t sell it.
          </p>
          <p className="mt-4">
            Got a question this page didn&apos;t answer? Click the chat bubble
            in the bottom-right. It only answers from this site, so you
            won&apos;t get generic suggestions — just what we actually know.
          </p>
        </div>
      </section>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-6 text-sm text-slate-500">
          <span>© 2026 Acme Outdoor Co.</span>
          <span>This page is a {BRAND.name} widget demo.</span>
        </div>
      </footer>
    </div>
  );
}

function DemoBody() {
  const params = useSearchParams();
  const botId = params.get("bot_id") || "";

  if (!botId) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-white px-6 text-center text-slate-700">
        <h1 className="text-2xl font-semibold">Missing bot_id</h1>
        <p className="mt-2 max-w-md text-sm text-slate-500">
          Open this page from the bot&apos;s API tab &ldquo;Try it&rdquo;
          button — the link should include
          {" "}<code className="rounded bg-slate-100 px-1">?bot_id=…</code>.
        </p>
      </div>
    );
  }

  return <DemoSite botId={botId} />;
}

export default function WidgetDemoPage() {
  return (
    <React.Suspense fallback={null}>
      <DemoBody />
    </React.Suspense>
  );
}
