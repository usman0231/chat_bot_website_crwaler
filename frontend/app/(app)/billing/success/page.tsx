"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";

import { useAuth } from "@/lib/auth-store";

export default function BillingSuccessPage() {
  const router = useRouter();
  const { refreshMe, me } = useAuth();
  const [tier, setTier] = React.useState<string>(me?.tier ?? "Pro");

  React.useEffect(() => {
    let cancelled = false;
    // Re-fetch /auth/me a couple of times because the webhook may arrive
    // a heartbeat after the user is redirected back from Stripe.
    async function poll() {
      for (let i = 0; i < 4 && !cancelled; i++) {
        await refreshMe();
        const t = (window as Window & { __sb_last_tier?: string }).__sb_last_tier;
        if (t && t !== "free") {
          setTier(t);
          break;
        }
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    void poll();

    const timer = window.setTimeout(() => {
      router.replace("/dashboard");
    }, 2500);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [refreshMe, router]);

  React.useEffect(() => {
    if (me?.tier && me.tier !== "free") {
      (window as Window & { __sb_last_tier?: string }).__sb_last_tier = me.tier;
      setTier(me.tier);
    }
  }, [me?.tier]);

  const tierLabel = tier.charAt(0).toUpperCase() + tier.slice(1);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <div className="relative mb-6">
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 rounded-full bg-gradient-to-br from-indigo-500/40 via-purple-500/40 to-pink-500/40 blur-2xl"
        />
        <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 text-white shadow-xl">
          <Sparkles className="h-10 w-10" aria-hidden="true" />
        </div>
      </div>
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
        Welcome to {tierLabel}!
      </h1>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        Your subscription is active. Redirecting you to your dashboard…
      </p>
    </div>
  );
}
