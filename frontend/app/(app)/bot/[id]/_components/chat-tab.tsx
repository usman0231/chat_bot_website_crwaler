"use client";

import * as React from "react";
import {
  Bot as BotIcon,
  Bug,
  Eraser,
  Globe,
  Send,
  Sparkles,
  User as UserIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useKeyboard } from "@/hooks/use-keyboard";
import {
  ApiError,
  chatBotStream,
  type ChatHistoryMessage,
  type MatchQuality,
} from "@/lib/api";
import { BRAND } from "@/lib/brand";
import { cn } from "@/lib/utils";

type Role = "user" | "bot" | "error";

type ChatMessage = {
  id: string;
  role: Role;
  content: string;
  sources?: string[];
  in_scope?: boolean;
  match_quality?: MatchQuality;
  best_distance?: number | null;
  retrieved_count?: number | null;
  response_ms?: number;
  timestamp: number;
};

const FALLBACK_QUESTIONS = [
  "What services do you offer?",
  "How can I contact you?",
  "What are your hours?",
  "Tell me about your products",
];

function storageKey(botId: string) {
  return `chat-history-${botId}`;
}

function loadHistory(botId: string): ChatMessage[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(botId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as ChatMessage[];
  } catch {
    return [];
  }
}

function saveHistory(botId: string, messages: ChatMessage[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(botId), JSON.stringify(messages));
  } catch {
    // quota / privacy mode — silent ignore
  }
}

function urlChipLabel(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.length > 1 ? u.pathname : "";
    const label = `${u.hostname}${path}`;
    return label.length > 48 ? label.slice(0, 47) + "…" : label;
  } catch {
    return url.length > 48 ? url.slice(0, 47) + "…" : url;
  }
}

function SourceChips({ sources }: { sources: string[] }) {
  if (!sources.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {sources.map((src) => (
        <a
          key={src}
          href={src}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-purple-500/40 hover:text-foreground"
          title={src}
        >
          <Globe className="h-3 w-3" aria-hidden="true" />
          <span className="max-w-[200px] truncate">{urlChipLabel(src)}</span>
        </a>
      ))}
    </div>
  );
}

function StreamingCursor() {
  return (
    <span
      aria-hidden="true"
      className="ml-0.5 inline-block h-3.5 w-[2px] -translate-y-[1px] animate-pulse bg-muted-foreground/70 align-middle"
    />
  );
}

function MessageBubble({
  message,
  debug,
  streaming,
}: {
  message: ChatMessage;
  debug: boolean;
  streaming?: boolean;
}) {
  if (message.role === "user") {
    return (
      <div className="flex items-start justify-end gap-2.5">
        <div className="max-w-[80%] rounded-2xl rounded-tr-md bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 px-3.5 py-2 text-sm text-white shadow-sm">
          <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>
        </div>
        <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-card">
          <UserIcon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        </div>
      </div>
    );
  }

  const isError = message.role === "error";
  const showSources =
    !isError &&
    message.in_scope === true &&
    !!message.sources?.length &&
    (message.match_quality === "strong" || message.match_quality === "weak");

  let badge: React.ReactNode = null;
  if (!isError && message.in_scope === false) {
    badge = (
      <Badge
        variant="secondary"
        className="bg-muted text-muted-foreground"
        aria-label="Out of scope"
      >
        Out of scope
      </Badge>
    );
  } else if (!isError && message.match_quality === "weak") {
    badge = (
      <Badge
        variant="secondary"
        className="bg-muted text-muted-foreground"
        aria-label="Helpful redirect"
      >
        Helpful redirect
      </Badge>
    );
  }

  return (
    <div className="flex items-start gap-2.5">
      <div
        className={cn(
          "mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white",
          isError
            ? "bg-red-500"
            : "bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500",
        )}
      >
        <BotIcon className="h-3.5 w-3.5" aria-hidden="true" />
      </div>
      <div className="max-w-[80%]">
        <div
          className={cn(
            "rounded-2xl rounded-tl-md border px-3.5 py-2 text-sm shadow-sm",
            isError
              ? "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300"
              : "border-border bg-card text-foreground",
          )}
        >
          <p className="whitespace-pre-wrap leading-relaxed">
            {message.content}
            {streaming && <StreamingCursor />}
          </p>
          {badge && <div className="mt-2">{badge}</div>}
        </div>
        {showSources && <SourceChips sources={message.sources ?? []} />}
        {!isError && typeof message.response_ms === "number" && (
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            Answered in {(message.response_ms / 1000).toFixed(1)}s
          </p>
        )}
        {debug && !isError && (
          <div className="mt-2 inline-flex flex-wrap gap-x-3 gap-y-1 rounded-md border border-dashed border-border bg-muted/40 px-2 py-1 text-[11px] text-muted-foreground">
            <span>
              quality:{" "}
              <span className="font-mono text-foreground">
                {message.match_quality ?? "—"}
              </span>
            </span>
            <span>
              distance:{" "}
              <span className="font-mono text-foreground">
                {typeof message.best_distance === "number"
                  ? message.best_distance.toFixed(3)
                  : "—"}
              </span>
            </span>
            <span>
              retrieved:{" "}
              <span className="font-mono text-foreground">
                {message.retrieved_count ?? "—"}
              </span>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

type ChatTabProps = {
  botId: string;
  websiteName: string;
  suggestedQuestions?: string[];
};

export function ChatTab({
  botId,
  websiteName,
  suggestedQuestions,
}: ChatTabProps) {
  const questions = React.useMemo(() => {
    const cleaned = (suggestedQuestions ?? [])
      .map((q) => q.trim())
      .filter(Boolean);
    return cleaned.length ? cleaned.slice(0, 4) : FALLBACK_QUESTIONS;
  }, [suggestedQuestions]);
  const [hydrated, setHydrated] = React.useState<{
    botId: string | null;
    messages: ChatMessage[];
  }>({ botId: null, messages: [] });
  const [input, setInput] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [streamingId, setStreamingId] = React.useState<string | null>(null);
  const [debug, setDebug] = React.useState(false);
  const bottomRef = React.useRef<HTMLDivElement | null>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
  const messagesRef = React.useRef<ChatMessage[]>([]);

  React.useEffect(() => {
    // Hydrate from localStorage on mount / botId change.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHydrated({ botId, messages: loadHistory(botId) });
  }, [botId]);

  const isHydrated = hydrated.botId === botId;
  const messages = React.useMemo<ChatMessage[]>(
    () => (isHydrated ? hydrated.messages : []),
    [isHydrated, hydrated.messages],
  );

  const setMessages = React.useCallback(
    (updater: (prev: ChatMessage[]) => ChatMessage[]) => {
      setHydrated((prev) => {
        if (prev.botId !== botId) return prev;
        return { botId, messages: updater(prev.messages) };
      });
    },
    [botId],
  );

  React.useEffect(() => {
    if (!isHydrated) return;
    saveHistory(botId, messages);
  }, [botId, messages, isHydrated]);

  React.useEffect(() => {
    messagesRef.current = messages;
  });

  React.useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [messages.length, loading]);

  // "/" focuses the chat input (skipping when already typing in an input).
  useKeyboard("/", (e) => {
    e.preventDefault();
    textareaRef.current?.focus();
  });

  const send = React.useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || loading) return;

      const historyToSend: ChatHistoryMessage[] = messagesRef.current
        .filter((m): m is ChatMessage & { role: "user" | "bot" } =>
          m.role === "user" || m.role === "bot",
        )
        .slice(-6)
        .map((m) => ({ role: m.role, content: m.content }));

      const userMsg: ChatMessage = {
        id: `u-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        role: "user",
        content: trimmed,
        timestamp: Date.now(),
      };
      const botMsgId = `b-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const botMsg: ChatMessage = {
        id: botMsgId,
        role: "bot",
        content: "",
        sources: [],
        in_scope: true,
        match_quality: "strong",
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, userMsg, botMsg]);
      setInput("");
      const started = Date.now();
      setStreamingId(botMsgId);
      setLoading(true);

      const updateBot = (patch: Partial<ChatMessage>) =>
        setMessages((prev) =>
          prev.map((m) => (m.id === botMsgId ? { ...m, ...patch } : m)),
        );

      const appendToBot = (token: string) =>
        setMessages((prev) =>
          prev.map((m) =>
            m.id === botMsgId ? { ...m, content: m.content + token } : m,
          ),
        );

      const failWith = (content: string) =>
        setMessages((prev) =>
          prev.map((m) =>
            m.id === botMsgId
              ? { ...m, role: "error" as const, content }
              : m,
          ),
        );

      try {
        const res = await chatBotStream(botId, trimmed, historyToSend);
        const reader = res.body?.getReader();
        if (!reader) throw new ApiError(0, "Stream not supported by response");
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let nl: number;
          while ((nl = buffer.indexOf("\n\n")) !== -1) {
            const frame = buffer.slice(0, nl);
            buffer = buffer.slice(nl + 2);
            const line = frame.split("\n").find((l) => l.startsWith("data: "));
            if (!line) continue;
            let event: {
              type: "token" | "meta" | "done" | "error";
              content?: string;
              sources?: string[];
              in_scope?: boolean;
              match_quality?: MatchQuality;
              message?: string;
            };
            try {
              event = JSON.parse(line.slice(6));
            } catch {
              continue;
            }
            if (event.type === "token" && typeof event.content === "string") {
              appendToBot(event.content);
            } else if (event.type === "meta") {
              updateBot({
                sources: event.sources ?? [],
                in_scope: event.in_scope ?? true,
                match_quality: event.match_quality ?? "strong",
              });
            } else if (event.type === "error") {
              failWith(event.message || "Something went wrong.");
            }
          }
        }

        updateBot({ response_ms: Date.now() - started });
      } catch (err) {
        let content = "Something went wrong. Please try again.";
        if (err instanceof ApiError) {
          if (err.status === 503) {
            content =
              "LLM backend is offline. Please check Ollama is running and try again.";
          } else if (err.status === 0) {
            content = "Network error — could not reach the API.";
            toast.error("Connection error. Check your internet.");
          } else {
            content = err.message || content;
          }
        }
        failWith(content);
      } finally {
        setLoading(false);
        setStreamingId(null);
      }
    },
    [botId, loading, setMessages],
  );

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    send(input);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  };

  const clearConversation = () => {
    setMessages(() => []);
    toast.success("Conversation cleared");
  };

  const hasMessages = messages.length > 0;

  return (
    <div className="mx-auto flex h-[calc(100dvh-18rem)] min-h-[480px] w-full max-w-3xl flex-col">
      <div className="mb-3 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setDebug((d) => !d)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
            debug
              ? "border-purple-500/40 bg-purple-500/10 text-purple-700 dark:text-purple-300"
              : "border-border bg-card text-muted-foreground hover:text-foreground",
          )}
          aria-pressed={debug}
        >
          <Bug className="h-3 w-3" aria-hidden="true" />
          Debug
        </button>
        {hasMessages && (
          <Button variant="ghost" size="sm" onClick={clearConversation}>
            <Eraser className="h-3.5 w-3.5" aria-hidden="true" />
            Clear conversation
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto rounded-xl border border-border bg-background/40 p-4">
        {!hasMessages && !loading ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="relative mb-4">
              <div
                aria-hidden="true"
                className="absolute inset-0 -z-10 rounded-full bg-gradient-to-br from-indigo-500/30 via-purple-500/30 to-pink-500/30 blur-2xl"
              />
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 text-white shadow-lg">
                <Sparkles className="h-7 w-7" aria-hidden="true" />
              </div>
            </div>
            <h3 className="text-lg font-semibold">Try your bot</h3>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              Ask anything about{" "}
              <span className="text-foreground">{websiteName || "this site"}</span>.
              The bot will only answer from your website&apos;s content.
            </p>
            <div className="mt-6 flex max-w-xl flex-wrap items-center justify-center gap-2">
              {questions.map((q) => (
                <Button
                  key={q}
                  variant="outline"
                  size="sm"
                  className="rounded-full"
                  onClick={() => send(q)}
                  disabled={loading}
                >
                  {q}
                </Button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {messages.map((m) => (
              <MessageBubble
                key={m.id}
                message={m}
                debug={debug}
                streaming={m.id === streamingId}
              />
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      <form
        onSubmit={onSubmit}
        className="sticky bottom-0 mt-3 rounded-xl border border-border bg-card p-2 ring-1 ring-foreground/5"
      >
        <div className="flex items-end gap-2">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={`Ask a question about ${websiteName || "this site"}…  (press / to focus)`}
            rows={1}
            className="max-h-32 min-h-9 resize-none border-0 bg-transparent focus-visible:ring-0"
            disabled={loading}
            aria-label="Message"
          />
          <Button
            type="submit"
            size="icon"
            className="bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 text-white shadow-sm hover:brightness-110"
            disabled={!input.trim() || loading}
            aria-label="Send message"
          >
            <Send className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
        <p className="mt-1 px-2 text-[11px] text-muted-foreground">
          Conversation memory: ON • {messages.length}{" "}
          {messages.length === 1 ? "message" : "messages"}
        </p>
        <p className="px-2 text-[11px] text-muted-foreground">
          Powered by {BRAND.name} • Enter to send, Shift+Enter for newline
        </p>
      </form>
    </div>
  );
}
