"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, FileText, FileX, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ApiError,
  getBotSources,
  recrawlBot,
  type SourcePage,
} from "@/lib/api";
import { gradientBtn } from "@/lib/landing";
import { cn } from "@/lib/utils";

type SourcesTabProps = {
  botId: string;
  websiteName: string;
};

export function SourcesTab({ botId, websiteName }: SourcesTabProps) {
  const router = useRouter();
  const [state, setState] = React.useState<{
    botId: string | null;
    sources: SourcePage[] | null;
    error: string | null;
  }>({ botId: null, sources: null, error: null });
  const [query, setQuery] = React.useState("");
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [recrawling, setRecrawling] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    getBotSources(botId)
      .then((res) => {
        if (!cancelled) setState({ botId, sources: res.sources, error: null });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg =
          err instanceof ApiError ? err.message : "Failed to load sources";
        setState({ botId, sources: [], error: msg });
      });
    return () => {
      cancelled = true;
    };
  }, [botId]);

  const loaded = state.botId === botId;
  const sources = loaded ? state.sources : null;
  const error = loaded ? state.error : null;
  const loading = sources === null;

  const filtered = React.useMemo(() => {
    if (!sources) return [];
    const q = query.trim().toLowerCase();
    if (!q) return sources;
    return sources.filter(
      (s) =>
        (s.title || "").toLowerCase().includes(q) ||
        (s.url || "").toLowerCase().includes(q),
    );
  }, [sources, query]);

  const totalChunks =
    sources?.reduce((sum, s) => sum + (s.chunk_count ?? 0), 0) ?? 0;

  const onConfirmRecrawl = async () => {
    setRecrawling(true);
    try {
      await recrawlBot(botId);
      toast("Re-crawl started, this may take a minute");
      setConfirmOpen(false);
      router.push("/dashboard");
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Failed to start re-crawl";
      toast.error(msg);
    } finally {
      setRecrawling(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Sources</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          These are the pages we crawled and indexed for{" "}
          <span className="text-foreground">{websiteName || "this site"}</span>.
        </p>
      </div>

      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          type="search"
          placeholder="Filter by URL or title…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-10 pl-9"
          aria-label="Filter sources"
        />
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-3 rounded-lg border border-border bg-card p-3"
            >
              <Skeleton className="h-4 w-4 rounded" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3 w-1/2" />
                <Skeleton className="h-3 w-3/4" />
              </div>
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/40 px-6 py-12 text-center">
          {sources && sources.length === 0 ? (
            <FileX
              className="mb-3 h-6 w-6 text-muted-foreground"
              aria-hidden="true"
            />
          ) : (
            <Search
              className="mb-3 h-6 w-6 text-muted-foreground"
              aria-hidden="true"
            />
          )}
          <p className="text-sm text-muted-foreground">
            {sources && sources.length === 0
              ? "No pages indexed yet."
              : `No sources match "${query}"`}
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {filtered.map((src) => (
            <li
              key={src.url}
              className="flex items-start gap-3 p-3 transition-colors hover:bg-muted/50 sm:items-center sm:gap-4"
            >
              <FileText
                className="mt-1 h-4 w-4 shrink-0 text-muted-foreground sm:mt-0"
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <p
                  className="truncate text-sm font-medium text-foreground"
                  title={src.title || src.url}
                >
                  {src.title || src.url}
                </p>
                <a
                  href={src.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="mt-0.5 inline-flex max-w-full items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                  title={src.url}
                >
                  <span className="truncate">{src.url}</span>
                  <ExternalLink
                    className="h-3 w-3 shrink-0"
                    aria-hidden="true"
                  />
                </a>
              </div>
              <Badge
                variant="secondary"
                className="shrink-0 bg-muted text-muted-foreground"
              >
                {src.chunk_count} {src.chunk_count === 1 ? "chunk" : "chunks"}
              </Badge>
            </li>
          ))}
        </ul>
      )}

      {!loading && sources && sources.length > 0 && (
        <div className="flex flex-col items-start justify-between gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3 sm:flex-row sm:items-center">
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{sources.length}</span>{" "}
            pages,{" "}
            <span className="font-medium text-foreground">{totalChunks}</span>{" "}
            total chunks indexed.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setConfirmOpen(true)}
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            Re-crawl website
          </Button>
        </div>
      )}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Re-crawl this website?</DialogTitle>
            <DialogDescription>
              This will re-index all pages with the latest content. Takes about
              as long as initial training.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={recrawling}
            >
              Cancel
            </Button>
            <button
              type="button"
              className={cn(gradientBtn("md"))}
              onClick={onConfirmRecrawl}
              disabled={recrawling}
            >
              {recrawling ? "Starting…" : "Start re-crawl"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
