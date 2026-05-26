"use client";

import * as React from "react";
import Link from "next/link";
import {
  BarChart3,
  Bot as BotIcon,
  FileText,
  MessageSquare,
  Plus,
  Search,
  Sparkles,
  Zap,
} from "lucide-react";

import { BotCard } from "@/components/app/bot-card";
import { PageHeader } from "@/components/app/page-header";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { listBots, type BotSummary } from "@/lib/api";
import { gradientBtn } from "@/lib/landing";
import { cn } from "@/lib/utils";

type MetricCardProps = {
  label: string;
  value: React.ReactNode;
  icon: typeof BotIcon;
  subtext?: string;
};

function MetricCard({ label, value, icon: Icon, subtext }: MetricCardProps) {
  return (
    <div className="relative rounded-xl border border-border bg-card p-5 ring-1 ring-foreground/5">
      <Icon
        className="absolute right-4 top-4 h-4 w-4 text-muted-foreground/70"
        aria-hidden="true"
      />
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-3 text-3xl font-semibold tracking-tight">{value}</p>
      {subtext ? (
        <p className="mt-1 text-xs text-muted-foreground">{subtext}</p>
      ) : null}
    </div>
  );
}

function BotCardSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-card p-5 ring-1 ring-foreground/5">
      <div className="flex items-start justify-between gap-2">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
      <Skeleton className="mt-3 h-3 w-44" />
      <div className="mt-4 flex gap-4">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-3 w-16" />
      </div>
      <Skeleton className="mt-3 h-3 w-24" />
    </div>
  );
}

function MetricCardSkeleton() {
  return (
    <div className="relative rounded-xl border border-border bg-card p-5 ring-1 ring-foreground/5">
      <Skeleton className="absolute right-4 top-4 h-4 w-4 rounded" />
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-3 h-8 w-16" />
      <Skeleton className="mt-2 h-3 w-32" />
    </div>
  );
}

function EmptyState({ demoBotId }: { demoBotId?: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/40 px-6 py-16 text-center">
      <div className="relative mb-4">
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 rounded-full bg-gradient-to-br from-indigo-500/20 via-purple-500/20 to-pink-500/20 blur-xl"
        />
        <div className="flex h-16 w-16 items-center justify-center rounded-full border border-border bg-background text-muted-foreground">
          <BotIcon className="h-8 w-8" aria-hidden="true" />
        </div>
      </div>
      <h3 className="text-lg font-semibold">No bots yet</h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        Create your first chatbot from any website URL.
      </p>
      <Link
        href="/dashboard/new"
        className={cn(gradientBtn("md"), "mt-6")}
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        Create your first bot
      </Link>
      {demoBotId && (
        <Link
          href={`/bot/${demoBotId}`}
          className="mt-3 text-xs text-muted-foreground hover:text-foreground"
        >
          Or try the live demo →
        </Link>
      )}
    </div>
  );
}

export default function DashboardPage() {
  const [bots, setBots] = React.useState<BotSummary[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");

  React.useEffect(() => {
    let cancelled = false;
    listBots()
      .then((list) => {
        if (!cancelled) setBots(list);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : "Failed to load bots";
        setError(msg);
        setBots([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loading = bots === null;

  const totalBots = bots?.length ?? 0;
  const totalPages = bots?.reduce((sum, b) => sum + (b.pages ?? 0), 0) ?? 0;

  const filtered = React.useMemo(() => {
    if (!bots) return [];
    const q = query.trim().toLowerCase();
    if (!q) return bots;
    return bots.filter((b) =>
      (b.website_name || "").toLowerCase().includes(q) ||
      (b.website_url || "").toLowerCase().includes(q),
    );
  }, [bots, query]);

  return (
    <>
      <PageHeader
        title="Your bots"
        subtitle="Manage your trained chatbots and their content"
        actions={
          <Link href="/dashboard/new" className={gradientBtn("md")}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            New bot
          </Link>
        }
      />

      <section
        aria-label="Overview"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <MetricCardSkeleton key={i} />
          ))
        ) : (
          <>
            <MetricCard
              label="Total bots"
              value={totalBots}
              icon={BotIcon}
              subtext={totalBots > 0 ? "Across all websites" : "No bots yet"}
            />
            <MetricCard
              label="Total chats"
              value="0"
              icon={MessageSquare}
              subtext="Tracking coming soon"
            />
            <MetricCard
              label="Pages indexed"
              value={totalPages}
              icon={FileText}
              subtext={totalPages > 0 ? "Embedded and searchable" : "—"}
            />
            <MetricCard
              label="Avg response time"
              value={
                <span className="inline-flex items-center gap-1">
                  <Zap className="h-5 w-5 text-purple-500" aria-hidden="true" />
                  &lt;2s
                </span>
              }
              icon={BarChart3}
              subtext="On Qwen 7B"
            />
          </>
        )}
      </section>

      <section aria-label="Bots" className="mt-10">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg font-semibold">All bots</h2>
          <div className="relative w-full sm:max-w-xs">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              type="search"
              placeholder="Search bots…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-10 pl-9"
              aria-label="Search bots"
            />
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        {loading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <BotCardSkeleton key={i} />
            ))}
          </div>
        ) : filtered.length === 0 && (bots?.length ?? 0) === 0 ? (
          <EmptyState demoBotId={process.env.NEXT_PUBLIC_DEMO_BOT_ID} />
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/40 px-6 py-12 text-center">
            <Sparkles
              className="mb-3 h-6 w-6 text-muted-foreground"
              aria-hidden="true"
            />
            <p className="text-sm text-muted-foreground">
              No bots match &ldquo;{query}&rdquo;
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((bot) => (
              <BotCard key={bot.bot_id} bot={bot} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}
