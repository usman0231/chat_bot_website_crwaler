"use client";

import * as React from "react";
import {
  AlertTriangle,
  Check,
  Copy,
  Eye,
  EyeOff,
  ExternalLink,
  Lock,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ApiError, getMyApiKey, rotateMyApiKey } from "@/lib/api";

const LAST_VIEWED_KEY = "sitebot-api-key-last-viewed";
const API_DOCS_URL = `${
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"
}/docs`;

function formatLastViewed(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "never";
  return d.toLocaleString();
}

export default function ApiKeysPage() {
  const [apiKey, setApiKey] = React.useState<string | null>(null);
  const [masked, setMasked] = React.useState<string>("sb_••••••••••••");
  const [revealed, setRevealed] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [lastViewed, setLastViewed] = React.useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [rotating, setRotating] = React.useState(false);

  React.useEffect(() => {
    if (typeof window !== "undefined") {
      setLastViewed(window.localStorage.getItem(LAST_VIEWED_KEY));
    }
    let cancelled = false;
    setLoading(true);
    getMyApiKey()
      .then((res) => {
        if (cancelled) return;
        setApiKey(res.api_key);
        setMasked(res.masked);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError) {
          setError(err.message);
        } else {
          setError("Failed to load API key");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function toggleReveal() {
    if (!apiKey) return;
    const next = !revealed;
    setRevealed(next);
    if (next) {
      const now = new Date().toISOString();
      try {
        window.localStorage.setItem(LAST_VIEWED_KEY, now);
      } catch {
        /* ignore */
      }
      setLastViewed(now);
    }
  }

  async function copyKey() {
    if (!apiKey) return;
    try {
      await navigator.clipboard.writeText(apiKey);
      setCopied(true);
      toast.success("API key copied");
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Couldn't copy to clipboard");
    }
  }

  async function confirmRotate() {
    setRotating(true);
    try {
      const res = await rotateMyApiKey();
      setApiKey(res.api_key);
      setMasked(res.masked);
      setRevealed(true);
      toast.success("New API key generated — update your widget installations");
      setConfirmOpen(false);
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.message : "Could not rotate API key";
      toast.error(msg);
    } finally {
      setRotating(false);
    }
  }

  const displayValue = revealed ? apiKey ?? "" : masked;

  return (
    <>
      <PageHeader
        title="API Keys"
        subtitle="Use this key to authenticate API requests to your bots"
      />

      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <Card className="border border-indigo-500/30 bg-indigo-500/10">
          <CardContent className="flex items-start gap-3 py-1">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-500/20 text-indigo-600 dark:text-indigo-300">
              <Lock className="h-4 w-4" aria-hidden="true" />
            </div>
            <p className="text-sm text-indigo-900 dark:text-indigo-100">
              Each user has their own API key. Embed it in your widget snippet
              to talk to <em>your</em> bots — anyone with this key can chat
              and create bots on your behalf, so treat it like a password.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Your API key</CardTitle>
            <CardDescription>
              This is your personal key. Rotate it if you suspect it has been
              leaked.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-sm">
              <span
                className="flex-1 select-all truncate"
                data-testid="api-key-value"
              >
                {loading ? "Loading…" : error ? "—" : displayValue}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={toggleReveal}
                disabled={loading || !apiKey}
                aria-label={revealed ? "Hide API key" : "Show API key"}
              >
                {revealed ? (
                  <EyeOff className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Eye className="h-4 w-4" aria-hidden="true" />
                )}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={copyKey}
                disabled={loading || !apiKey}
                aria-label="Copy API key"
              >
                {copied ? (
                  <Check
                    className="h-4 w-4 text-emerald-500"
                    aria-hidden="true"
                  />
                ) : (
                  <Copy className="h-4 w-4" aria-hidden="true" />
                )}
              </Button>
            </div>

            {error ? (
              <p className="text-xs text-destructive">{error}</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Last viewed: {formatLastViewed(lastViewed)}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>How to use it</CardTitle>
            <CardDescription>
              Add this header to your API requests
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <pre className="overflow-x-auto rounded-md border border-border bg-muted/40 p-3 font-mono text-xs">
              <code>{`X-API-Key: ${displayValue || "sb_••••••••••••"}`}</code>
            </pre>
            <a
              href={API_DOCS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
            >
              See full API documentation
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          </CardContent>
        </Card>

        <Card className="border border-destructive/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              Danger zone
            </CardTitle>
            <CardDescription>
              Rotating your key immediately invalidates the previous one.
              Anywhere it&apos;s installed (widget snippets, server-to-server
              integrations) will need to be updated.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setConfirmOpen(true)}
              disabled={loading || !apiKey}
              className="border-destructive/40 text-destructive hover:bg-destructive/10"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              Rotate API key
            </Button>
          </CardContent>
        </Card>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rotate your API key?</DialogTitle>
            <DialogDescription>
              The old key will stop working immediately. Anywhere it is
              installed — widget snippets on customer sites, scripts, CI —
              will need to be updated with the new key. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setConfirmOpen(false)}
              disabled={rotating}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmRotate}
              disabled={rotating}
            >
              {rotating ? "Rotating…" : "Rotate key"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
