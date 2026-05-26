"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertCircle,
  ArrowRight,
  Brain,
  CheckCircle2,
  ChevronRight,
  Code,
  FileSearch,
  Globe,
  MessageSquare,
  Sparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createBot,
  getBotStatus,
  type BotStage,
  type StatusResponse,
} from "@/lib/api";
import { useAuth } from "@/lib/auth-store";
import { gradientBtn } from "@/lib/landing";
import { cn } from "@/lib/utils";

type WizardStep = 1 | 2 | 3;
type PresetId = "fast" | "balanced" | "thorough" | "custom";

const PRESETS: {
  id: Exclude<PresetId, "custom">;
  label: string;
  blurb: string;
  pages: number;
  recommended?: boolean;
}[] = [
  { id: "fast", label: "Fast", blurb: "Quick demo (~30s)", pages: 10 },
  {
    id: "balanced",
    label: "Balanced",
    blurb: "Best for most sites (~2min)",
    pages: 25,
    recommended: true,
  },
  { id: "thorough", label: "Thorough", blurb: "Deep crawl (~5min)", pages: 100 },
];

const TIER_SLIDER_MAX: Record<string, number> = {
  free: 25,
  pro: 100,
  enterprise: 500,
};

const STAGE_ORDER: BotStage[] = ["queued", "crawling", "embedding", "indexing", "done"];

const STAGE_LABEL: Record<BotStage, string> = {
  queued: "Queued",
  crawling: "Crawling",
  embedding: "Embedding",
  indexing: "Indexing",
  done: "Done",
};

const EMAIL_OR_URL_OK = /^https?:\/\/.+\..+/i;

function ensureHttps(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function estimateSeconds(maxPages: number): number {
  // Rough: ~1.5s per page + 8s overhead for embedding+indexing.
  return Math.round(maxPages * 1.5 + 8);
}

function formatElapsed(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

/* ------------------------------------------------------------------ */
/* Step indicator                                                      */
/* ------------------------------------------------------------------ */

function StepIndicator({ current }: { current: WizardStep }) {
  const labels = ["Configure", "Train", "Done"];
  return (
    <ol
      className="mx-auto mb-8 flex max-w-md items-center justify-center gap-2"
      aria-label="Wizard progress"
    >
      {labels.map((label, idx) => {
        const stepNum = (idx + 1) as WizardStep;
        const isActive = current === stepNum;
        const isDone = current > stepNum;
        return (
          <React.Fragment key={label}>
            <li
              className="flex items-center gap-2"
              aria-current={isActive ? "step" : undefined}
            >
              <span
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold transition-all",
                  isActive &&
                    "bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 text-white shadow-md",
                  isDone && "bg-emerald-500 text-white",
                  !isActive &&
                    !isDone &&
                    "border border-border bg-card text-muted-foreground",
                )}
              >
                {isDone ? <CheckCircle2 className="h-4 w-4" /> : stepNum}
              </span>
              <span
                className={cn(
                  "text-xs font-medium",
                  isActive ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {label}
              </span>
            </li>
            {idx < labels.length - 1 && (
              <span
                aria-hidden="true"
                className={cn(
                  "h-px w-8 transition-colors",
                  current > stepNum ? "bg-emerald-500/60" : "bg-border",
                )}
              />
            )}
          </React.Fragment>
        );
      })}
    </ol>
  );
}

/* ------------------------------------------------------------------ */
/* Step 1 — Configure                                                  */
/* ------------------------------------------------------------------ */

type ConfigValues = {
  url: string;
  name: string;
  preset: PresetId;
  maxPages: number;
};

type ConfigErrors = { url?: string; name?: string };

function StepConfigure({
  initial,
  onCancel,
  onSubmit,
}: {
  initial: ConfigValues;
  onCancel: () => void;
  onSubmit: (values: ConfigValues) => void;
}) {
  const { me } = useAuth();
  const tier = me?.tier ?? "free";
  // Use the smaller of the backend's hard tier cap and the UX-friendly
  // slider max — Enterprise's 9999-page cap is technically allowed by the
  // API but isn't a sensible single-bot crawl from the wizard.
  const tierCap = me?.usage.max_pages_per_bot ?? 25;
  const uxCap = TIER_SLIDER_MAX[tier] ?? 25;
  const sliderMax = Math.max(5, Math.min(tierCap, uxCap));

  const [url, setUrl] = React.useState(initial.url);
  const [name, setName] = React.useState(initial.name);
  const [preset, setPreset] = React.useState<PresetId>(initial.preset);
  const [maxPages, setMaxPages] = React.useState(initial.maxPages);
  const [errors, setErrors] = React.useState<ConfigErrors>({});
  const [submitting, setSubmitting] = React.useState(false);

  // If the user's tier is loaded and their current selection exceeds the
  // cap, gently clamp it so they don't submit something we'll silently lower.
  React.useEffect(() => {
    if (maxPages > sliderMax) setMaxPages(sliderMax);
  }, [maxPages, sliderMax]);

  function validate(values: { url: string; name: string }): ConfigErrors {
    const next: ConfigErrors = {};
    const u = ensureHttps(values.url);
    if (!values.url.trim()) next.url = "Website URL is required";
    else if (!EMAIL_OR_URL_OK.test(u)) next.url = "Enter a valid URL";
    if (!values.name.trim()) next.name = "Bot name is required";
    else if (values.name.trim().length > 50) next.name = "Keep it under 50 characters";
    return next;
  }

  function onPick(id: Exclude<PresetId, "custom">) {
    setPreset(id);
    const p = PRESETS.find((x) => x.id === id);
    if (!p) return;
    // If the preset is above the user's cap, snap to the cap and leave
    // the upgrade notice visible.
    setMaxPages(Math.min(p.pages, sliderMax));
  }

  function onSlider(e: React.ChangeEvent<HTMLInputElement>) {
    setMaxPages(Number(e.target.value));
    setPreset("custom");
  }

  const presetOverLimit = PRESETS.find(
    (p) => p.id === preset && p.pages > sliderMax,
  );

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const next = validate({ url, name });
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    setSubmitting(true);
    onSubmit({
      url: ensureHttps(url),
      name: name.trim(),
      preset,
      maxPages,
    });
  }

  const valid = !!url.trim() && !!name.trim() && Object.keys(errors).length === 0;
  const estSec = estimateSeconds(maxPages);

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-6">
      <div className="rounded-2xl border border-border bg-card p-6 ring-1 ring-foreground/5">
        <div className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="website-url">Website URL</Label>
            <div className="relative">
              <Globe
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                id="website-url"
                type="text"
                inputMode="url"
                autoComplete="url"
                placeholder="https://yourwebsite.com"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onBlur={() => {
                  if (url.trim()) setUrl((v) => ensureHttps(v));
                }}
                aria-invalid={!!errors.url}
                className="h-11 pl-9"
              />
            </div>
            {errors.url && (
              <p className="text-xs text-destructive">{errors.url}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="bot-name">Bot name</Label>
            <Input
              id="bot-name"
              type="text"
              placeholder="My Website Bot"
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={!!errors.name}
              maxLength={60}
              className="h-11"
            />
            <p className="text-xs text-muted-foreground">
              Shown in your dashboard, not to end users
            </p>
            {errors.name && (
              <p className="text-xs text-destructive">{errors.name}</p>
            )}
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Quality preset</legend>
            <div
              role="radiogroup"
              aria-label="Quality preset"
              className="grid grid-cols-1 gap-3 sm:grid-cols-3"
            >
              {PRESETS.map((p) => {
                const selected = preset === p.id;
                const overLimit = p.pages > sliderMax;
                return (
                  <button
                    key={p.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => onPick(p.id)}
                    className={cn(
                      "relative rounded-xl border bg-card p-4 text-left transition-all hover:border-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      selected
                        ? "border-indigo-500 ring-2 ring-indigo-500/40"
                        : "border-border",
                      p.recommended && !selected && "border-indigo-500/40",
                    )}
                  >
                    {p.recommended && (
                      <span className="absolute -top-2 right-3 rounded-full bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white shadow">
                        Recommended
                      </span>
                    )}
                    <div className="text-sm font-semibold">{p.label}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {p.blurb}
                    </div>
                    <div className="mt-2 text-xs text-foreground/80">
                      {p.pages} pages
                    </div>
                    {overLimit && (
                      <div className="mt-2 text-[10px] font-medium uppercase tracking-wide text-amber-600 dark:text-amber-400">
                        Above your plan
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
            {presetOverLimit && (
              <p className="text-xs text-amber-700 dark:text-amber-300">
                Your {tier} plan crawls up to {sliderMax} pages — we&apos;ll
                use {sliderMax}.{" "}
                <Link href="/pricing" className="font-medium underline">
                  Upgrade to {tier === "free" ? "Pro" : "Enterprise"} for{" "}
                  {presetOverLimit.pages}-page crawls
                </Link>
                .
              </p>
            )}
          </fieldset>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="max-pages">Max pages</Label>
              <div className="flex items-center gap-2 text-xs">
                <span className="rounded-full bg-muted px-2 py-0.5 font-medium">
                  {maxPages} pages
                </span>
                <span className="text-muted-foreground">~{estSec}s</span>
              </div>
            </div>
            <input
              id="max-pages"
              type="range"
              min={5}
              max={sliderMax}
              step={1}
              value={maxPages}
              onChange={onSlider}
              className="h-2 w-full cursor-pointer appearance-none rounded-full bg-muted accent-indigo-500"
            />
            {tier === "free" && (
              <p className="text-[11px] text-muted-foreground">
                Free plan caps crawls at 25 pages.{" "}
                <Link href="/pricing" className="font-medium underline">
                  Upgrade for more
                </Link>
                .
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onCancel}
          className={cn(buttonVariants({ variant: "ghost" }), "h-10")}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!valid || submitting}
          className={gradientBtn("md")}
        >
          {submitting ? "Starting…" : "Start training"}
          {!submitting && <ArrowRight className="h-4 w-4" aria-hidden="true" />}
        </button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Step 2 — Training pipeline                                          */
/* ------------------------------------------------------------------ */

type UiStageState = "pending" | "active" | "done" | "failed";

const UI_STAGES = [
  { key: "connecting", label: "Connecting", icon: Globe },
  { key: "crawling", label: "Crawling pages", icon: FileSearch },
  { key: "embedding", label: "Building knowledge base", icon: Brain },
  { key: "ready", label: "Ready to chat", icon: CheckCircle2 },
] as const;

function deriveUiStages(
  status: StatusResponse | null,
): { state: UiStageState; detail?: string }[] {
  if (!status) {
    return UI_STAGES.map((_, i) => ({ state: i === 0 ? "active" : "pending" }));
  }
  if (status.status === "failed") {
    return UI_STAGES.map(() => ({ state: "failed" }));
  }
  if (status.status === "ready") {
    return UI_STAGES.map(() => ({ state: "done" }));
  }
  const idx = status.stage ? STAGE_ORDER.indexOf(status.stage) : -1;

  // Map backend stage → which UI step is active.
  // queued (0)    → connecting active
  // crawling (1)  → crawling active
  // embedding (2) → embedding active
  // indexing (3)  → ready active ("Almost done...")
  let activeIdx = 0;
  if (idx <= 0) activeIdx = 0;
  else if (idx === 1) activeIdx = 1;
  else if (idx === 2) activeIdx = 2;
  else if (idx >= 3) activeIdx = 3;

  return UI_STAGES.map((stage, i) => {
    let state: UiStageState = "pending";
    if (i < activeIdx) state = "done";
    else if (i === activeIdx) state = "active";

    let detail: string | undefined;
    if (stage.key === "crawling") {
      if (status.pages_crawled != null && status.pages_total != null) {
        detail = `${status.pages_crawled} of ${status.pages_total} pages`;
      } else if (status.pages_crawled != null) {
        detail = `${status.pages_crawled} pages`;
      }
    } else if (stage.key === "embedding" && state === "active") {
      detail = "Building embeddings…";
    } else if (stage.key === "ready" && state === "active") {
      detail = "Almost done…";
    }
    return { state, detail };
  });
}

function StageCircle({ state }: { state: UiStageState }) {
  if (state === "done") {
    return (
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500 text-white shadow">
        <CheckCircle2 className="h-4 w-4" />
      </span>
    );
  }
  if (state === "failed") {
    return (
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-red-500 text-white shadow">
        <X className="h-4 w-4" />
      </span>
    );
  }
  if (state === "active") {
    return (
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 shadow">
        <span className="stage-dot h-2 w-2 rounded-full bg-white" />
      </span>
    );
  }
  return (
    <span className="flex h-7 w-7 items-center justify-center rounded-full border border-border bg-card" />
  );
}

function GlobeHero() {
  return (
    <div className="relative mx-auto h-[200px] w-[200px]">
      <svg
        viewBox="0 0 200 200"
        className="absolute inset-0"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="ring-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#6366f1" />
            <stop offset="100%" stopColor="#a855f7" />
          </linearGradient>
        </defs>
        <g style={{ transformOrigin: "100px 100px" }} className="pulse-ring">
          <circle
            cx="100"
            cy="100"
            r="55"
            stroke="url(#ring-grad)"
            strokeWidth="2"
            fill="none"
          />
        </g>
        <g
          style={{ transformOrigin: "100px 100px" }}
          className="pulse-ring pulse-ring-2"
        >
          <circle
            cx="100"
            cy="100"
            r="55"
            stroke="url(#ring-grad)"
            strokeWidth="2"
            fill="none"
          />
        </g>
        <g
          style={{ transformOrigin: "100px 100px" }}
          className="pulse-ring pulse-ring-3"
        >
          <circle
            cx="100"
            cy="100"
            r="55"
            stroke="url(#ring-grad)"
            strokeWidth="2"
            fill="none"
          />
        </g>
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 shadow-xl">
          <Globe className="h-9 w-9 text-white" aria-hidden="true" />
        </span>
      </div>
    </div>
  );
}

function StepTraining({
  botId,
  websiteName,
  startedAt,
  onReady,
  onRetry,
  onCancel,
}: {
  botId: string;
  websiteName: string;
  startedAt: number;
  onReady: (status: StatusResponse) => void;
  onRetry: () => void;
  onCancel: () => void;
}) {
  const [status, setStatus] = React.useState<StatusResponse | null>(null);
  const [pollError, setPollError] = React.useState<string | null>(null);
  const [elapsed, setElapsed] = React.useState<number>(() =>
    Math.max(0, (Date.now() - startedAt) / 1000),
  );
  const advancedRef = React.useRef(false);

  // Live elapsed counter (1s) — independent of the polling interval.
  React.useEffect(() => {
    const t = window.setInterval(() => {
      setElapsed((Date.now() - startedAt) / 1000);
    }, 1000);
    return () => window.clearInterval(t);
  }, [startedAt]);

  // Status polling (1.5s).
  React.useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    async function tick() {
      try {
        const next = await getBotStatus(botId);
        if (cancelled) return;
        setStatus(next);
        setPollError(null);
        if (next.status === "ready" && !advancedRef.current) {
          advancedRef.current = true;
          window.setTimeout(() => {
            if (!cancelled) onReady(next);
          }, 500);
          return; // stop polling
        }
        if (next.status === "failed") {
          return; // stop polling
        }
      } catch (err) {
        if (cancelled) return;
        const msg =
          err instanceof Error ? err.message : "Lost connection to the server";
        setPollError(msg);
      }
      timer = window.setTimeout(tick, 1500);
    }

    tick();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [botId, onReady]);

  // Warn on unload if the user navigates away mid-training.
  React.useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (status?.status === "training" || status?.status == null) {
        e.preventDefault();
        e.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      if (status && status.status === "training") {
        toast.info("Training continues in the background");
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.status]);

  const failed = status?.status === "failed";
  const uiStages = deriveUiStages(status);
  const displayElapsed = Math.max(elapsed, status?.elapsed_seconds ?? 0);
  const stageLabel = status?.stage ? STAGE_LABEL[status.stage] : "Queued";

  // Live page count fallback to backend value
  const pagesCrawled = status?.pages_crawled ?? 0;
  const pagesTotal = status?.pages_total ?? 0;

  if (failed) {
    return (
      <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-8 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-red-500/15 text-red-500">
          <AlertCircle className="h-6 w-6" aria-hidden="true" />
        </div>
        <h3 className="text-lg font-semibold">Training failed</h3>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          {(status?.error || "Something went wrong while training.").slice(
            0,
            300,
          )}
        </p>
        <div className="mt-5 flex justify-center gap-3">
          <button
            type="button"
            onClick={onRetry}
            className={cn(buttonVariants({ variant: "outline" }), "h-10")}
          >
            Try again
          </button>
          <Link
            href="/dashboard"
            className={cn(buttonVariants({ variant: "ghost" }), "h-10")}
          >
            Back to dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <GlobeHero />

      <div
        className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm"
        aria-live="polite"
      >
        <span className="inline-flex items-center gap-1.5">
          <span className="text-muted-foreground">Elapsed</span>
          <span className="font-mono font-semibold tabular-nums">
            {formatElapsed(displayElapsed)}
          </span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="text-muted-foreground">Pages</span>
          <span className="font-semibold tabular-nums">
            {pagesCrawled}
            {pagesTotal ? ` / ${pagesTotal}` : ""}
          </span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="text-muted-foreground">Stage</span>
          <span className="inline-flex items-center gap-1.5 font-semibold">
            {status?.status !== "ready" && status?.status !== "failed" && (
              <span className="stage-dot h-1.5 w-1.5 rounded-full bg-indigo-500" />
            )}
            {stageLabel}
          </span>
        </span>
      </div>

      <ol
        className="mx-auto max-w-md space-y-0"
        aria-label="Training pipeline"
      >
        {UI_STAGES.map((stage, i) => {
          const ui = uiStages[i] ?? { state: "pending" as UiStageState };
          const Icon = stage.icon;
          const isLast = i === UI_STAGES.length - 1;
          const lineDone =
            ui.state === "done" ||
            (ui.state === "active" && uiStages[i + 1]?.state !== "pending");
          return (
            <li key={stage.key} className="relative flex items-stretch gap-3">
              <div className="flex flex-col items-center">
                <StageCircle state={ui.state} />
                {!isLast && (
                  <span
                    aria-hidden="true"
                    className={cn(
                      "my-1 w-px flex-1",
                      lineDone
                        ? "bg-emerald-500/60"
                        : "border-l border-dashed border-border",
                    )}
                    style={{ minHeight: 24 }}
                  />
                )}
              </div>
              <div
                className={cn(
                  "flex-1 pb-6 transition-opacity",
                  ui.state === "pending" && "opacity-60",
                )}
              >
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  {stage.label}
                </div>
                {ui.detail && (
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {ui.detail}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {pollError && (
        <div className="mx-auto max-w-md rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          {pollError} — retrying…
        </div>
      )}

      {displayElapsed > 300 ? (
        <div className="mx-auto max-w-md rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-center text-sm">
          <p className="font-medium">
            Training is taking longer than usual.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            You can keep waiting or cancel. The bot will keep training in the
            background either way — check back from the dashboard.
          </p>
          <div className="mt-3 flex justify-center">
            <button
              type="button"
              onClick={onCancel}
              className={cn(buttonVariants({ variant: "outline" }), "h-9")}
            >
              Cancel and go to dashboard
            </button>
          </div>
        </div>
      ) : displayElapsed > 120 ? (
        <div className="mx-auto max-w-md rounded-lg border border-border bg-card/50 p-3 text-center text-xs text-muted-foreground">
          Larger sites can take a few minutes. Hang tight — {websiteName} is
          almost ready.
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Step 3 — Success                                                    */
/* ------------------------------------------------------------------ */

const CONFETTI_COLORS = ["#6366f1", "#a855f7", "#ec4899", "#10b981"];

function Confetti() {
  const [pieces, setPieces] = React.useState<
    { id: number; left: number; dx: number; color: string; delay: number }[]
  >(() => {
    if (typeof window === "undefined") return [];
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduce) return [];
    return Array.from({ length: 12 }, (_, i) => ({
      id: i,
      left: 5 + ((i * 8.5) % 90) + Math.random() * 4,
      dx: (Math.random() - 0.5) * 120,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      delay: i * 100,
    }));
  });

  React.useEffect(() => {
    if (pieces.length === 0) return;
    const t = window.setTimeout(() => setPieces([]), 3500);
    return () => window.clearTimeout(t);
    // Pieces are computed once on mount; clearing once is correct.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (pieces.length === 0) return null;
  return (
    <div aria-hidden="true">
      {pieces.map((p) => (
        <span
          key={p.id}
          className="confetti-piece"
          style={
            {
              left: `${p.left}%`,
              backgroundColor: p.color,
              animationDelay: `${p.delay}ms`,
              "--confetti-x": `${p.dx}px`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}

function StepSuccess({
  botId,
  status,
}: {
  botId: string;
  status: StatusResponse;
}) {
  const elapsed = Math.max(0, Math.round(status.elapsed_seconds ?? 0));
  return (
    <div className="space-y-8 text-center">
      <Confetti />

      <div className="flex flex-col items-center">
        <span className="success-glow flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500 text-white">
          <CheckCircle2 className="h-10 w-10" aria-hidden="true" />
        </span>
        <h2 className="mt-4 text-2xl font-semibold tracking-tight sm:text-3xl">
          {status.website_name} is ready to chat!
        </h2>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span>
            <span className="font-semibold text-foreground">
              {status.pages ?? 0}
            </span>{" "}
            pages crawled
          </span>
          <span aria-hidden="true">•</span>
          <span>
            <span className="font-semibold text-foreground">
              {status.chunks ?? 0}
            </span>{" "}
            chunks indexed
          </span>
          <span aria-hidden="true">•</span>
          <span>
            <span className="font-semibold text-foreground">{elapsed}</span>{" "}
            seconds
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 text-left sm:grid-cols-2">
        <div className="rounded-2xl border border-border bg-card p-6 ring-1 ring-foreground/5">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-500/15 text-indigo-500">
            <MessageSquare className="h-5 w-5" aria-hidden="true" />
          </span>
          <h3 className="mt-3 text-base font-semibold">Test your bot</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Ask questions and see how your bot answers using your website&apos;s
            content.
          </p>
          <Link
            href={`/bot/${botId}`}
            className={cn(gradientBtn("md"), "mt-4 w-full sm:w-auto")}
          >
            Open chat
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>

        <div className="rounded-2xl border border-border bg-card p-6 ring-1 ring-foreground/5">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-purple-500/15 text-purple-500">
            <Code className="h-5 w-5" aria-hidden="true" />
          </span>
          <h3 className="mt-3 text-base font-semibold">Integrate it anywhere</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Drop it into your website with a few lines of code.
          </p>
          <Link
            href={`/bot/${botId}?tab=api`}
            className={cn(
              buttonVariants({ variant: "outline" }),
              "mt-4 h-10 w-full sm:w-auto",
            )}
          >
            View integration
          </Link>
        </div>
      </div>

      <div>
        <Link
          href="/dashboard"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          <span aria-hidden="true">← </span>Back to dashboard
        </Link>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Wizard shell                                                        */
/* ------------------------------------------------------------------ */

function WizardInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const prefilledUrl = searchParams.get("url") ?? "";

  const [step, setStep] = React.useState<WizardStep>(1);
  const [config, setConfig] = React.useState<ConfigValues>({
    url: prefilledUrl,
    name: "",
    preset: "balanced",
    maxPages: 25,
  });
  const [botId, setBotId] = React.useState<string | null>(null);
  const [startedAt, setStartedAt] = React.useState<number | null>(null);
  const [finalStatus, setFinalStatus] = React.useState<StatusResponse | null>(
    null,
  );
  const [showStep, setShowStep] = React.useState(true);

  const titles: Record<WizardStep, { title: string; subtitle: string }> = {
    1: {
      title: "Set up your bot",
      subtitle: "Paste your website URL and we'll do the rest",
    },
    2: {
      title: `Training ${config.name || "your bot"}`,
      subtitle: "We're crawling and indexing your website. Hang tight.",
    },
    3: {
      title: "All set",
      subtitle: "Your bot is trained and ready to answer questions",
    },
  };

  function transitionTo(next: WizardStep) {
    setShowStep(false);
    window.setTimeout(() => {
      setStep(next);
      setShowStep(true);
    }, 200);
  }

  async function submitConfig(values: ConfigValues) {
    setConfig(values);
    try {
      const res = await createBot({
        website_url: values.url,
        website_name: values.name,
        max_pages: values.maxPages,
      });
      setBotId(res.bot_id);
      setStartedAt(Date.now());
      setFinalStatus(null);
      transitionTo(2);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to start training";
      toast.error(msg);
    }
  }

  function onReady(status: StatusResponse) {
    setFinalStatus(status);
    transitionTo(3);
  }

  function onRetry() {
    setBotId(null);
    setFinalStatus(null);
    setStartedAt(null);
    transitionTo(1);
  }

  function onCancel() {
    router.push("/dashboard");
  }

  return (
    <div className="mx-auto max-w-2xl py-2">
      <PageHeader
        title={titles[step].title}
        subtitle={titles[step].subtitle}
      />

      <StepIndicator current={step} />

      <div
        className={cn(
          "transition-all duration-300 ease-out",
          showStep
            ? "translate-y-0 opacity-100"
            : "translate-y-2 opacity-0",
        )}
      >
        {step === 1 && (
          <StepConfigure
            initial={config}
            onCancel={onCancel}
            onSubmit={submitConfig}
          />
        )}
        {step === 2 && botId && startedAt && (
          <StepTraining
            botId={botId}
            websiteName={config.name}
            startedAt={startedAt}
            onReady={onReady}
            onRetry={onRetry}
            onCancel={onCancel}
          />
        )}
        {step === 3 && botId && finalStatus && (
          <StepSuccess botId={botId} status={finalStatus} />
        )}
      </div>
    </div>
  );
}

export default function NewBotPage() {
  return (
    <>
      <nav
        aria-label="Breadcrumb"
        className="mb-2 flex items-center gap-1 text-xs text-muted-foreground"
      >
        <Link href="/dashboard" className="hover:text-foreground">
          Dashboard
        </Link>
        <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="text-foreground">New bot</span>
      </nav>
      <React.Suspense
        fallback={
          <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
            <Sparkles className="mr-2 h-4 w-4 animate-pulse" aria-hidden="true" />
            Loading…
          </div>
        }
      >
        <WizardInner />
      </React.Suspense>
    </>
  );
}
