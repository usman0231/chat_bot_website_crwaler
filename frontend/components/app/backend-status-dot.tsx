"use client";

import { useBackendStatus, type BackendStatus } from "@/lib/backend-status";
import { cn } from "@/lib/utils";

const LABEL: Record<BackendStatus, string> = {
  connected: "API connected",
  checking: "Connecting…",
  offline: "API offline",
};

function formatLastPing(ts: number | null): string {
  if (!ts) return "—";
  const secs = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}

export function BackendStatusDot() {
  const { status, lastSuccess } = useBackendStatus();
  const tooltip =
    lastSuccess !== null
      ? `Last successful ping ${formatLastPing(lastSuccess)}`
      : status === "checking"
        ? "Pinging backend…"
        : "Backend has not responded yet";

  return (
    <div
      className="flex items-center gap-2 px-1.5 py-1 text-[11px] text-muted-foreground"
      title={tooltip}
      aria-label={`${LABEL[status]} (${tooltip})`}
    >
      <span className="relative inline-flex h-2 w-2 shrink-0">
        {status === "checking" && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-500/60" />
        )}
        <span
          className={cn(
            "relative inline-flex h-2 w-2 rounded-full",
            status === "connected" && "bg-emerald-500",
            status === "checking" && "bg-amber-500",
            status === "offline" && "bg-red-500",
          )}
        />
      </span>
      <span className="truncate">{LABEL[status]}</span>
    </div>
  );
}
