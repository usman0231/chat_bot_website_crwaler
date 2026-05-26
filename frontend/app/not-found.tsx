"use client";

import Link from "next/link";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { BRAND } from "@/lib/brand";
import { gradientBtn } from "@/lib/landing";

export default function NotFound() {
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center px-6 text-center">
      <p
        className="brand-gradient text-7xl font-extrabold tracking-tight sm:text-8xl"
        aria-hidden="true"
      >
        404
      </p>
      <h2 className="mt-4 text-2xl font-semibold tracking-tight sm:text-3xl">
        Page not found
      </h2>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        The page you&apos;re looking for doesn&apos;t exist or has moved.
      </p>

      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <Link href="/dashboard" className={gradientBtn("md")}>
          Go to dashboard
        </Link>
        <Link
          href="/"
          className="inline-flex h-10 items-center justify-center rounded-lg border border-border bg-background px-4 text-sm font-medium transition-colors hover:bg-muted"
        >
          Back to home
        </Link>
      </div>

      <Button
        variant="ghost"
        size="sm"
        className="mt-4"
        onClick={() => toast("Thanks — we'll look into it")}
      >
        Report this
      </Button>

      <p className="mt-10 text-[11px] text-muted-foreground">{BRAND.name}</p>
    </div>
  );
}
