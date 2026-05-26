"use client";

import * as React from "react";
import Link from "next/link";
import {
  notFound,
  usePathname,
  useRouter,
  useSearchParams,
} from "next/navigation";
import {
  ChevronRight,
  Code2,
  ExternalLink,
  FileText,
  MessageSquare,
  MessagesSquare,
  Phone,
  Settings as SettingsIcon,
} from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiError, getBotStatus, listBots, type StatusResponse } from "@/lib/api";
import { cn, timeAgo } from "@/lib/utils";

import { ApiTab } from "./_components/api-tab";
import { CallTab } from "./_components/call-tab";
import { ChatTab } from "./_components/chat-tab";
import { QuestionsTab } from "./_components/questions-tab";
import { SettingsTab } from "./_components/settings-tab";
import { SourcesTab } from "./_components/sources-tab";

type TabKey = "chat" | "call" | "api" | "sources" | "questions" | "settings";

const VALID_TABS = new Set<TabKey>([
  "chat",
  "call",
  "api",
  "sources",
  "questions",
  "settings",
]);

function isTabKey(value: string | null): value is TabKey {
  return !!value && VALID_TABS.has(value as TabKey);
}

const STATUS_PILL: Record<
  StatusResponse["status"],
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

function StatusPill({ status }: { status: StatusResponse["status"] }) {
  const pill = STATUS_PILL[status] ?? STATUS_PILL.training;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
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
  );
}

function HeaderSkeleton() {
  return (
    <div className="mb-6 space-y-3">
      <Skeleton className="h-3 w-40" />
      <div className="flex items-center gap-3">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-5 w-20 rounded-full" />
      </div>
      <Skeleton className="h-3 w-72" />
    </div>
  );
}

function hostFromUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

type PageProps = {
  params: Promise<{ id: string }>;
};

export default function BotDetailPage({ params }: PageProps) {
  const { id: botId } = React.use(params);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const initialTab = React.useMemo<TabKey>(() => {
    const t = searchParams?.get("tab");
    return isTabKey(t) ? t : "chat";
  }, [searchParams]);

  const [tab, setTab] = React.useState<TabKey>(initialTab);
  const [state, setState] = React.useState<{
    botId: string | null;
    bot: StatusResponse | null;
    error: string | null;
  }>({ botId: null, bot: null, error: null });

  React.useEffect(() => {
    let cancelled = false;
    getBotStatus(botId)
      .then((res) => {
        if (!cancelled) setState({ botId, bot: res, error: null });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          notFound();
          return;
        }
        const msg = err instanceof ApiError ? err.message : "Failed to load bot";
        setState({ botId, bot: null, error: msg });
      });
    return () => {
      cancelled = true;
    };
  }, [botId]);

  const loaded = state.botId === botId;
  const bot = loaded ? state.bot : null;
  const error = loaded ? state.error : null;

  const onTabChange = (value: unknown) => {
    if (typeof value !== "string" || !isTabKey(value)) return;
    setTab(value);
    const next = new URLSearchParams(searchParams?.toString() ?? "");
    if (value === "chat") {
      next.delete("tab");
    } else {
      next.set("tab", value);
    }
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  if (error) {
    return (
      <div className="mx-auto max-w-3xl">
        <div className="mb-4 text-sm text-muted-foreground">
          <Link href="/dashboard" className="hover:text-foreground">
            Dashboard
          </Link>
          <ChevronRight className="mx-1 inline-block h-3.5 w-3.5" aria-hidden="true" />
          <span>{botId}</span>
        </div>
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      </div>
    );
  }

  if (!bot) {
    return (
      <>
        <HeaderSkeleton />
        <Skeleton className="h-9 w-72" />
        <div className="mt-6">
          <Skeleton className="h-80 w-full rounded-xl" />
        </div>
      </>
    );
  }

  return <BotDetailReady bot={bot} tab={tab} onTabChange={onTabChange} />;
}

function BotDetailReady({
  bot,
  tab,
  onTabChange,
}: {
  bot: StatusResponse;
  tab: TabKey;
  onTabChange: (value: unknown) => void;
}) {
  const [websiteUrl, setWebsiteUrl] = React.useState<string>("");
  const [suggestedQuestions, setSuggestedQuestions] = React.useState<string[]>(
    () => bot.suggested_questions ?? [],
  );
  const [questionsDirty, setQuestionsDirty] = React.useState(false);

  React.useEffect(() => {
    setSuggestedQuestions(bot.suggested_questions ?? []);
  }, [bot.suggested_questions]);

  React.useEffect(() => {
    let cancelled = false;
    listBots()
      .then((list) => {
        if (cancelled) return;
        const match = list.find((b) => b.bot_id === bot.bot_id);
        if (match?.website_url) setWebsiteUrl(match.website_url);
      })
      .catch(() => {
        /* tolerated — website_url is decorative */
      });
    return () => {
      cancelled = true;
    };
  }, [bot.bot_id]);

  const host = websiteUrl ? hostFromUrl(websiteUrl) : "";
  const createdSubtitle = [
    bot.created_at ? `Created ${timeAgo(bot.created_at)}` : null,
    bot.pages != null ? `${bot.pages} page${bot.pages === 1 ? "" : "s"}` : null,
    bot.chunks != null ? `${bot.chunks} chunk${bot.chunks === 1 ? "" : "s"}` : null,
  ]
    .filter(Boolean)
    .join(" • ");

  return (
    <>
      <header className="mb-6">
        <nav
          aria-label="Breadcrumb"
          className="mb-3 flex items-center gap-1 text-xs text-muted-foreground"
        >
          <Link href="/dashboard" className="hover:text-foreground">
            Dashboard
          </Link>
          <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="truncate text-foreground">
            {bot.website_name || bot.bot_id}
          </span>
        </nav>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <h1 className="truncate text-2xl font-semibold tracking-tight sm:text-3xl">
                {bot.website_name || bot.bot_id}
              </h1>
              <StatusPill status={bot.status} />
            </div>
            {createdSubtitle && (
              <p className="mt-1 text-xs text-muted-foreground">
                {createdSubtitle}
              </p>
            )}
          </div>

          {websiteUrl && (
            <a
              href={websiteUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1.5 self-start rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-purple-500/40 hover:text-foreground"
            >
              <span>Source: {host}</span>
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
          )}
        </div>
      </header>

      {bot.status === "failed" && bot.error && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
          Training failed: {bot.error}
        </div>
      )}

      <Tabs value={tab} onValueChange={onTabChange}>
        <div className="overflow-x-auto pb-1">
          <TabsList>
            <TabsTrigger value="chat">
              <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
              Chat
            </TabsTrigger>
            <TabsTrigger value="call">
              <Phone className="h-3.5 w-3.5" aria-hidden="true" />
              Call
            </TabsTrigger>
            <TabsTrigger value="api">
              <Code2 className="h-3.5 w-3.5" aria-hidden="true" />
              API
            </TabsTrigger>
            <TabsTrigger value="sources">
              <FileText className="h-3.5 w-3.5" aria-hidden="true" />
              Sources
            </TabsTrigger>
            <TabsTrigger value="questions">
              <MessagesSquare className="h-3.5 w-3.5" aria-hidden="true" />
              Questions
              {questionsDirty && (
                <span
                  aria-label="Unsaved changes"
                  className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-amber-500"
                />
              )}
            </TabsTrigger>
            <TabsTrigger value="settings">
              <SettingsIcon className="h-3.5 w-3.5" aria-hidden="true" />
              Settings
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="chat" className="mt-6">
          {bot.status === "ready" ? (
            <ChatTab
              botId={bot.bot_id}
              websiteName={bot.website_name}
              suggestedQuestions={suggestedQuestions}
            />
          ) : (
            <div className="mx-auto max-w-3xl rounded-xl border border-dashed border-border bg-card/40 px-6 py-12 text-center">
              <p className="text-sm text-muted-foreground">
                {bot.status === "training"
                  ? "This bot is still training. Chat will be available once it's ready."
                  : "This bot is unavailable for chat."}
              </p>
            </div>
          )}
        </TabsContent>
        <TabsContent value="call" className="mt-6">
          <CallTab
            botId={bot.bot_id}
            websiteName={bot.website_name}
            ready={bot.status === "ready"}
          />
        </TabsContent>
        <TabsContent value="api" className="mt-6">
          <ApiTab botId={bot.bot_id} websiteName={bot.website_name} />
        </TabsContent>
        <TabsContent value="sources" className="mt-6">
          <SourcesTab botId={bot.bot_id} websiteName={bot.website_name} />
        </TabsContent>
        <TabsContent value="questions" className="mt-6">
          <QuestionsTab
            botId={bot.bot_id}
            websiteName={bot.website_name}
            initialQuestions={suggestedQuestions}
            onSaved={(qs) => setSuggestedQuestions(qs)}
            onDirtyChange={setQuestionsDirty}
          />
        </TabsContent>
        <TabsContent value="settings" className="mt-6">
          <SettingsTab bot={bot} websiteUrl={websiteUrl} />
        </TabsContent>
      </Tabs>
    </>
  );
}
