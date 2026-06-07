"use client";

import * as React from "react";
import {
  ArrowLeft,
  Bot as BotIcon,
  MessageSquare,
  MessagesSquare,
  Phone,
  RefreshCw,
  Sparkles,
  User as UserIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ApiError,
  getConversation,
  listConversations,
  type ConversationDetail,
  type ConversationSummary,
} from "@/lib/api";
import { cn, timeAgo } from "@/lib/utils";

type ConversationsTabProps = {
  botId: string;
  websiteName: string;
};

function ChannelBadge({ channel }: { channel: "chat" | "voice" }) {
  const isVoice = channel === "voice";
  const Icon = isVoice ? Phone : MessageSquare;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1",
        isVoice
          ? "bg-sky-500/10 text-sky-700 ring-sky-500/30 dark:text-sky-300"
          : "bg-purple-500/10 text-purple-700 ring-purple-500/30 dark:text-purple-300",
      )}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      {isVoice ? "Voice" : "Chat"}
    </span>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-2">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="rounded-xl border border-border bg-card px-4 py-3"
        >
          <div className="flex items-center gap-2">
            <Skeleton className="h-4 w-14 rounded-full" />
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-3 w-20" />
          </div>
          <Skeleton className="mt-2 h-3 w-3/4" />
          <Skeleton className="mt-1.5 h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="mx-auto max-w-md rounded-xl border border-dashed border-border bg-card/40 px-6 py-14 text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 text-white shadow-lg">
        <MessagesSquare className="h-6 w-6" aria-hidden="true" />
      </div>
      <h3 className="text-base font-semibold">No conversations yet</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        When visitors chat with your bot, they&apos;ll appear here.
      </p>
    </div>
  );
}

function summaryHeadline(summary: string | null): string | null {
  if (!summary) return null;
  // Summaries come back as labelled lines (Summary:/Intent:/Resolution:).
  // Surface the first meaningful line as the row preview.
  const lines = summary
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return null;
  const summaryLine = lines.find((l) => /^summary[:\-]/i.test(l));
  const chosen = summaryLine ?? lines[0];
  return chosen.replace(/^summary[:\-]\s*/i, "");
}

function ConversationRow({
  conv,
  onOpen,
}: {
  conv: ConversationSummary;
  onOpen: (id: string) => void;
}) {
  const headline = summaryHeadline(conv.summary);
  return (
    <button
      type="button"
      onClick={() => onOpen(conv.id)}
      className="w-full rounded-xl border border-border bg-card px-4 py-3 text-left transition-colors hover:border-purple-500/40 hover:bg-accent/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500/40"
    >
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
        <ChannelBadge channel={conv.channel} />
        <span>{timeAgo(conv.last_at)}</span>
        <span aria-hidden="true">•</span>
        <span>
          {conv.message_count} message{conv.message_count === 1 ? "" : "s"}
        </span>
      </div>
      <p
        className={cn(
          "mt-1.5 line-clamp-2 text-sm",
          headline ? "text-foreground" : "italic text-muted-foreground",
        )}
      >
        {headline ?? "No summary yet"}
      </p>
    </button>
  );
}

function MessageBubble({
  role,
  content,
  createdAt,
}: {
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}) {
  const time = new Date(createdAt);
  const stamp = Number.isNaN(time.getTime())
    ? ""
    : time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  if (role === "user") {
    return (
      <div className="flex items-start justify-end gap-2.5">
        <div className="max-w-[80%]">
          <div className="rounded-2xl rounded-tr-md bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 px-3.5 py-2 text-sm text-white shadow-sm">
            <p className="whitespace-pre-wrap leading-relaxed">{content}</p>
          </div>
          {stamp && (
            <p className="mt-1 text-right text-[11px] text-muted-foreground">
              {stamp}
            </p>
          )}
        </div>
        <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-card">
          <UserIcon
            className="h-3.5 w-3.5 text-muted-foreground"
            aria-hidden="true"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2.5">
      <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 text-white">
        <BotIcon className="h-3.5 w-3.5" aria-hidden="true" />
      </div>
      <div className="max-w-[80%]">
        <div className="rounded-2xl rounded-tl-md border border-border bg-card px-3.5 py-2 text-sm text-foreground shadow-sm">
          <p className="whitespace-pre-wrap leading-relaxed">{content}</p>
        </div>
        {stamp && (
          <p className="mt-1 text-[11px] text-muted-foreground">{stamp}</p>
        )}
      </div>
    </div>
  );
}

function SummaryCard({ summary }: { summary: string | null }) {
  return (
    <div className="rounded-xl border border-purple-500/30 bg-purple-500/5 px-4 py-3">
      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-purple-700 dark:text-purple-300">
        <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
        AI Summary
      </div>
      {summary ? (
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
          {summary}
        </p>
      ) : (
        <p className="text-sm italic text-muted-foreground">
          Generating summary…
        </p>
      )}
    </div>
  );
}

function ConversationDetailView({
  detail,
  loading,
  onBack,
}: {
  detail: ConversationDetail | null;
  loading: boolean;
  onBack: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Back to conversations
        </Button>
        {detail && <ChannelBadge channel={detail.channel} />}
      </div>

      {loading || !detail ? (
        <div className="space-y-4">
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-16 w-2/3 rounded-2xl" />
          <Skeleton className="ml-auto h-16 w-2/3 rounded-2xl" />
          <Skeleton className="h-16 w-2/3 rounded-2xl" />
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span>Started {timeAgo(detail.started_at)}</span>
            <span aria-hidden="true">•</span>
            <span>
              {detail.message_count} message
              {detail.message_count === 1 ? "" : "s"}
            </span>
            {detail.visitor_id && (
              <>
                <span aria-hidden="true">•</span>
                <span className="font-mono">{detail.visitor_id}</span>
              </>
            )}
          </div>

          <SummaryCard summary={detail.summary} />

          <div className="flex flex-col gap-4 rounded-xl border border-border bg-background/40 p-4">
            {detail.messages.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                This conversation has no messages.
              </p>
            ) : (
              detail.messages.map((m) => (
                <MessageBubble
                  key={m.id}
                  role={m.role}
                  content={m.content}
                  createdAt={m.created_at}
                />
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}

export function ConversationsTab({ botId, websiteName }: ConversationsTabProps) {
  const [list, setList] = React.useState<{
    botId: string | null;
    items: ConversationSummary[];
    error: string | null;
  }>({ botId: null, items: [], error: null });
  const [refreshing, setRefreshing] = React.useState(false);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [detail, setDetail] = React.useState<ConversationDetail | null>(null);
  const [detailLoading, setDetailLoading] = React.useState(false);

  const loadList = React.useCallback(() => {
    setRefreshing(true);
    listConversations(botId)
      .then((items) => {
        setList({ botId, items, error: null });
      })
      .catch((err: unknown) => {
        const msg =
          err instanceof ApiError ? err.message : "Failed to load conversations";
        setList({ botId, items: [], error: msg });
      })
      .finally(() => setRefreshing(false));
  }, [botId]);

  React.useEffect(() => {
    loadList();
  }, [loadList]);

  const openConversation = React.useCallback(
    (id: string) => {
      setSelectedId(id);
      setDetail(null);
      setDetailLoading(true);
      getConversation(botId, id)
        .then((d) => setDetail(d))
        .catch((err: unknown) => {
          const msg =
            err instanceof ApiError ? err.message : "Failed to load conversation";
          toast.error(msg);
          setSelectedId(null);
        })
        .finally(() => setDetailLoading(false));
    },
    [botId],
  );

  const isLoaded = list.botId === botId;

  if (selectedId) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <ConversationDetailView
          detail={detail}
          loading={detailLoading}
          onBack={() => {
            setSelectedId(null);
            setDetail(null);
            // Pick up any summary generated while the detail was open.
            loadList();
          }}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Visitor conversations with{" "}
          <span className="text-foreground">{websiteName || "this bot"}</span>.
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={loadList}
          disabled={refreshing}
        >
          <RefreshCw
            className={cn("h-3.5 w-3.5", refreshing && "animate-spin")}
            aria-hidden="true"
          />
          Refresh
        </Button>
      </div>

      {!isLoaded ? (
        <ListSkeleton />
      ) : list.error ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {list.error}
        </div>
      ) : list.items.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-2">
          {list.items.map((conv) => (
            <ConversationRow
              key={conv.id}
              conv={conv}
              onOpen={openConversation}
            />
          ))}
        </div>
      )}
    </div>
  );
}
