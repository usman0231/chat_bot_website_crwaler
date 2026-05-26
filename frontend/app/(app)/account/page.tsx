"use client";

import * as React from "react";
import Link from "next/link";
import { CreditCard, ExternalLink } from "lucide-react";
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
import { ApiError, createBillingPortal } from "@/lib/api";
import { useAuth, type Tier } from "@/lib/auth-store";
import { cn } from "@/lib/utils";

function tierBadge(tier: Tier) {
  if (tier === "free") {
    return (
      <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
        Free
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-white shadow-sm">
      {tier === "pro" ? "Pro" : "Enterprise"}
    </span>
  );
}

function UsageBar({
  label,
  used,
  limit,
}: {
  label: string;
  used: number;
  limit: number;
}) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const over80 = pct >= 80;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums text-muted-foreground">
          {used.toLocaleString()} / {limit.toLocaleString()}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            over80
              ? "bg-gradient-to-r from-orange-500 to-red-500"
              : "bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export default function AccountPage() {
  const { me, refreshMe } = useAuth();
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    void refreshMe();
  }, [refreshMe]);

  async function openPortal() {
    setBusy(true);
    try {
      const res = await createBillingPortal();
      window.location.href = res.url;
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.message : "Could not open billing portal";
      toast.error(msg);
      setBusy(false);
    }
  }

  const tier: Tier = me?.tier ?? "free";
  const status = me?.subscription_status ?? "active";
  const usage = me?.usage;
  const isPaid = tier !== "free";

  return (
    <>
      <PageHeader
        title="Account"
        subtitle="Plan, billing, and current usage"
      />

      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-3">
              Current plan {tierBadge(tier)}
            </CardTitle>
            <CardDescription>
              {isPaid ? (
                <>
                  Status:{" "}
                  <span className="font-medium text-foreground">{status}</span>
                </>
              ) : (
                <>You&apos;re on the free plan. Upgrade for more bots and crawls.</>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-3">
            {isPaid ? (
              <Button
                variant="outline"
                onClick={openPortal}
                disabled={busy}
              >
                <CreditCard className="h-3.5 w-3.5" aria-hidden="true" />
                {busy ? "Opening…" : "Manage billing"}
              </Button>
            ) : null}
            <Link
              href="/pricing"
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted"
            >
              {isPaid ? "Change plan" : "View plans"}
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Usage</CardTitle>
            <CardDescription>Resets at the start of each month</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {usage ? (
              <>
                <UsageBar
                  label="Bots"
                  used={usage.bots}
                  limit={usage.max_bots}
                />
                <UsageBar
                  label="Messages this month"
                  used={usage.messages_this_month}
                  limit={usage.monthly_messages}
                />
                <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                  Max pages per crawl on this plan:{" "}
                  <span className="font-medium text-foreground">
                    {usage.max_pages_per_bot.toLocaleString()}
                  </span>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Loading usage…</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
            <CardDescription>Your account details</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Name
              </div>
              <div className="mt-0.5 font-medium">{me?.name ?? "—"}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Email
              </div>
              <div className="mt-0.5 font-medium">{me?.email ?? "—"}</div>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
