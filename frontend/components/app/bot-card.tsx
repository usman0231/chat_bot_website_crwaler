import Link from "next/link";
import { Globe } from "lucide-react";

import type { BotSummary } from "@/lib/api";
import { cn, timeAgo } from "@/lib/utils";

const STATUS_PILL: Record<
  BotSummary["status"],
  { label: string; className: string; pulse?: boolean }
> = {
  training: {
    label: "Training",
    className:
      "bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-1 ring-amber-500/30",
    pulse: true,
  },
  ready: {
    label: "Ready",
    className:
      "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-500/30",
  },
  failed: {
    label: "Failed",
    className:
      "bg-red-500/10 text-red-700 dark:text-red-300 ring-1 ring-red-500/30",
  },
};

export function BotCard({ bot }: { bot: BotSummary }) {
  const pill = STATUS_PILL[bot.status] ?? STATUS_PILL.training;

  return (
    <Link
      href={`/bot/${bot.bot_id}`}
      className="group block rounded-xl border border-border bg-card p-5 ring-1 ring-foreground/5 transition-all hover:-translate-y-0.5 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="truncate text-base font-semibold">
          {bot.website_name || bot.bot_id}
        </h3>
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium",
            pill.className,
          )}
        >
          {pill.pulse && (
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-500/60" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber-500" />
            </span>
          )}
          {pill.label}
        </span>
      </div>

      <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Globe className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">{bot.website_url || "—"}</span>
      </div>

      <div className="mt-4 flex items-center gap-4 text-xs text-muted-foreground">
        <span>
          <span className="font-medium text-foreground">{bot.pages ?? 0}</span>{" "}
          pages
        </span>
        <span>
          <span className="font-medium text-foreground">{bot.chunks ?? 0}</span>{" "}
          chunks
        </span>
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        {bot.created_at ? `Created ${timeAgo(bot.created_at)}` : "Created —"}
      </p>
    </Link>
  );
}
