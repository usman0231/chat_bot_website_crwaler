"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { gradientBtn } from "@/lib/landing";

type ErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function GlobalError({ error, reset }: ErrorProps) {
  React.useEffect(() => {
    // Surface the error for debugging in dev.
    if (process.env.NODE_ENV === "development") {
      console.error(error);
    }
  }, [error]);

  const isDev = process.env.NODE_ENV === "development";

  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center px-6 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-red-500/10 text-red-600 dark:text-red-400">
        <AlertTriangle className="h-8 w-8" aria-hidden="true" />
      </div>
      <h2 className="mt-5 text-2xl font-semibold tracking-tight sm:text-3xl">
        Something went wrong
      </h2>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        An unexpected error occurred. We&apos;ve been notified.
      </p>

      {isDev && error?.message && (
        <pre className="mt-5 max-w-2xl overflow-auto rounded-lg border border-border bg-muted/40 p-3 text-left font-mono text-[11px] leading-relaxed text-foreground">
          {error.message}
          {error.digest ? `\n\ndigest: ${error.digest}` : ""}
        </pre>
      )}

      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <Button type="button" onClick={() => reset()} className={gradientBtn("md")}>
          Try again
        </Button>
        <Link
          href="/dashboard"
          className="inline-flex h-10 items-center justify-center rounded-lg border border-border bg-background px-4 text-sm font-medium transition-colors hover:bg-muted"
        >
          Go to dashboard
        </Link>
      </div>
    </div>
  );
}
