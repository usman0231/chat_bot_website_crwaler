"use client";

import * as React from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";

import { useBackendStatus } from "@/lib/backend-status";
import { cn } from "@/lib/utils";

export function BackendStatusBanner() {
  const { status } = useBackendStatus();
  const [showReconnected, setShowReconnected] = React.useState(false);
  const wasOffline = React.useRef(false);

  React.useEffect(() => {
    if (status === "offline") {
      wasOffline.current = true;
    } else if (status === "connected" && wasOffline.current) {
      wasOffline.current = false;
      setShowReconnected(true);
      const t = window.setTimeout(() => setShowReconnected(false), 3000);
      return () => window.clearTimeout(t);
    }
  }, [status]);

  if (status !== "offline" && !showReconnected) return null;

  const offline = status === "offline";

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "fixed left-1/2 top-3 z-[60] -translate-x-1/2 rounded-full border px-3.5 py-1.5 text-xs font-medium shadow-lg backdrop-blur transition-opacity",
        offline
          ? "border-amber-500/40 bg-amber-500/15 text-amber-800 dark:text-amber-200"
          : "border-emerald-500/40 bg-emerald-500/15 text-emerald-800 dark:text-emerald-200",
      )}
    >
      <span className="inline-flex items-center gap-1.5">
        {offline ? (
          <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
        ) : (
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
        )}
        {offline ? "Backend connection lost. Reconnecting…" : "Connected"}
      </span>
    </div>
  );
}
