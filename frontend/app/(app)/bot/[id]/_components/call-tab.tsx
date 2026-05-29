"use client";

import * as React from "react";
import { Globe2, Mic, MicOff, Phone, Sparkles } from "lucide-react";

import { CallInterface } from "@/components/call/call-interface";
import { useMicPermission } from "@/hooks/use-mic-permission";
import { gradientBtn } from "@/lib/landing";
import { cn } from "@/lib/utils";

type CallTabProps = {
  botId: string;
  websiteName: string;
  ready: boolean;
};

export function CallTab({ botId, websiteName, ready }: CallTabProps) {
  const [open, setOpen] = React.useState(false);
  const { permission, requestPermission } = useMicPermission();

  if (!ready) {
    return (
      <div className="mx-auto max-w-3xl rounded-xl border border-dashed border-border bg-card/40 px-6 py-12 text-center">
        <p className="text-sm text-muted-foreground">
          This bot is still training. Voice calls will be available once it&apos;s
          ready.
        </p>
      </div>
    );
  }

  if (permission === "denied") {
    return (
      <div className="mx-auto max-w-2xl">
        <div className="rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
            <MicOff className="h-8 w-8" aria-hidden="true" />
          </div>
          <h3 className="mt-4 text-2xl font-semibold tracking-tight">
            Microphone access denied
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Please allow microphone access in your browser settings to use voice
            calls.
          </p>
          <p className="mt-3 text-[11px] text-muted-foreground">
            On mobile: Settings → Browser → Microphone → Allow
          </p>
        </div>
      </div>
    );
  }

  if (permission === "prompt" || permission === "unknown") {
    return (
      <div className="mx-auto max-w-2xl">
        <div className="rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 text-white shadow-lg">
            <Mic className="h-8 w-8" aria-hidden="true" />
          </div>
          <h3 className="mt-4 text-2xl font-semibold tracking-tight">
            Microphone access needed
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Voice calls require microphone access. We&apos;ll only listen while
            you&apos;re on a call.
          </p>
          <button
            type="button"
            onClick={() => void requestPermission()}
            className={cn(gradientBtn("lg"), "mt-8")}
          >
            <Mic className="h-4 w-4" aria-hidden="true" />
            Allow microphone
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 text-white shadow-lg">
          <Phone className="h-8 w-8" aria-hidden="true" />
        </div>
        <h3 className="mt-4 text-2xl font-semibold tracking-tight">
          Talk to {websiteName || "your bot"}
        </h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Have a real voice conversation with your bot. Supports English and
          Urdu.
        </p>

        <ul className="mx-auto mt-6 max-w-sm space-y-2 text-left">
          <FeatureRow
            icon={<Mic className="h-4 w-4" aria-hidden="true" />}
            label="Real-time speech recognition"
          />
          <FeatureRow
            icon={<Sparkles className="h-4 w-4" aria-hidden="true" />}
            label="AI-powered responses in your language"
          />
          <FeatureRow
            icon={<Globe2 className="h-4 w-4" aria-hidden="true" />}
            label="Interrupt anytime — it’s a real conversation"
          />
        </ul>

        <button
          type="button"
          onClick={() => setOpen(true)}
          className={cn(gradientBtn("lg"), "mt-8")}
        >
          <Phone className="h-4 w-4" aria-hidden="true" />
          Start call
        </button>
        <p className="mt-3 text-[11px] text-muted-foreground">
          Microphone access granted — you&apos;re ready to call.
        </p>
      </div>

      {open && (
        <CallInterface
          botId={botId}
          botName={websiteName}
          onEnd={() => setOpen(false)}
        />
      )}
    </div>
  );
}

function FeatureRow({
  icon,
  label,
}: {
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <li className="flex items-center gap-2 text-sm text-muted-foreground">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-purple-500/10 text-purple-600 dark:text-purple-300">
        {icon}
      </span>
      <span>{label}</span>
    </li>
  );
}
