"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Globe } from "lucide-react";

import { Input } from "@/components/ui/input";
import { gradientBtn } from "@/lib/landing";

const EXAMPLES = ["visionara.ca", "broadwaypizza.com.pk", "stripe.com"];

function ensureHttps(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export function HeroUrlInput() {
  const router = useRouter();
  const [value, setValue] = React.useState("");

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const url = ensureHttps(value);
    if (!url) return;
    router.push(`/signup?url=${encodeURIComponent(url)}`);
  }

  return (
    <div className="w-full max-w-xl">
      <form
        onSubmit={onSubmit}
        className="flex flex-col gap-2 rounded-2xl border border-border bg-card/80 p-2 shadow-lg backdrop-blur-sm sm:flex-row sm:items-center sm:gap-2"
      >
        <label htmlFor="hero-url" className="sr-only">
          Website URL
        </label>
        <div className="flex flex-1 items-center gap-2 rounded-lg px-3">
          <Globe
            className="h-4 w-4 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            id="hero-url"
            name="url"
            type="text"
            inputMode="url"
            autoComplete="url"
            placeholder="https://yourwebsite.com"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="h-11 border-0 bg-transparent px-0 text-base shadow-none focus-visible:ring-0 dark:bg-transparent"
            required
          />
        </div>
        <button type="submit" className={gradientBtn("lg", "shrink-0")}>
          Train bot
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </form>
      <p className="mt-3 text-center text-xs text-muted-foreground sm:text-left">
        Try:{" "}
        {EXAMPLES.map((example, idx) => (
          <React.Fragment key={example}>
            <button
              type="button"
              onClick={() => setValue(`https://${example}`)}
              className="rounded font-medium text-foreground/80 underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {example}
            </button>
            {idx < EXAMPLES.length - 1 ? ", " : ""}
          </React.Fragment>
        ))}
      </p>
    </div>
  );
}
