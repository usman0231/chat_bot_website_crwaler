"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app/page-header";
import { PaymentForm } from "@/components/billing/payment-form";
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
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ApiError, createBillingPortal } from "@/lib/api";
import { useAuth, type Tier } from "@/lib/auth-store";
import { cn } from "@/lib/utils";
import { gradientBtn } from "@/lib/landing";

type Plan = {
  id: Tier;
  name: string;
  price: string;
  pricePeriod: string;
  description: string;
  features: string[];
  highlight?: boolean;
};

const PLANS: Plan[] = [
  {
    id: "free",
    name: "Free",
    price: "$0",
    pricePeriod: "forever",
    description: "Kick the tires with a single bot and a small crawl.",
    features: [
      "1 bot",
      "Up to 25 pages per crawl",
      "100 chat messages / month",
      "Community support",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    price: "$29",
    pricePeriod: "/month",
    description: "Everything most teams need — bigger crawls, more bots.",
    features: [
      "10 bots",
      "Up to 100 pages per crawl",
      "5,000 chat messages / month",
      "Email support",
    ],
    highlight: true,
  },
  {
    id: "enterprise",
    name: "Enterprise",
    price: "$99",
    pricePeriod: "/month",
    description: "For larger sites and high-traffic widgets.",
    features: [
      "Unlimited bots",
      "Up to 9,999 pages per crawl",
      "1M chat messages / month",
      "Priority support",
    ],
  },
];

export default function PricingPage() {
  const { me, refreshMe } = useAuth();
  const router = useRouter();
  const [portalBusy, setPortalBusy] = React.useState(false);
  const [modalTier, setModalTier] = React.useState<"pro" | "enterprise" | null>(
    null,
  );
  const tier = me?.tier ?? "free";

  React.useEffect(() => {
    void refreshMe();
  }, [refreshMe]);

  async function openPortal() {
    setPortalBusy(true);
    try {
      const res = await createBillingPortal();
      window.location.href = res.url;
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.message : "Could not open billing portal";
      toast.error(msg);
      setPortalBusy(false);
    }
  }

  function onPaymentSuccess() {
    setModalTier(null);
    router.push("/billing/success");
  }

  return (
    <>
      <PageHeader
        title="Pricing"
        subtitle="Pick a plan that fits — change or cancel any time"
      />

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        {PLANS.map((plan) => {
          const isCurrent = plan.id === tier;
          return (
            <Card
              key={plan.id}
              className={cn(
                "flex flex-col",
                plan.highlight && "border-indigo-500/40 ring-1 ring-indigo-500/30",
              )}
            >
              <CardHeader>
                {plan.highlight && (
                  <span className="mb-1 inline-flex w-fit items-center gap-1 rounded-full bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white shadow">
                    <Sparkles className="h-3 w-3" aria-hidden="true" />
                    Most popular
                  </span>
                )}
                <CardTitle className="text-xl">{plan.name}</CardTitle>
                <CardDescription>{plan.description}</CardDescription>
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="text-3xl font-bold tracking-tight">
                    {plan.price}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {plan.pricePeriod}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col justify-between gap-6">
                <ul className="space-y-2 text-sm">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2">
                      <Check
                        className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500"
                        aria-hidden="true"
                      />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>

                <div className="space-y-2">
                  {isCurrent ? (
                    <Button variant="outline" size="default" disabled className="w-full">
                      Current plan
                    </Button>
                  ) : plan.id === "free" ? (
                    me?.subscription_status === "active" && me.tier !== "free" ? (
                      <Button
                        variant="outline"
                        size="default"
                        onClick={openPortal}
                        disabled={portalBusy}
                        className="w-full"
                      >
                        {portalBusy ? "Opening…" : "Downgrade in portal"}
                      </Button>
                    ) : (
                      <Button variant="outline" size="default" disabled className="w-full">
                        —
                      </Button>
                    )
                  ) : (
                    <button
                      type="button"
                      onClick={() => setModalTier(plan.id as "pro" | "enterprise")}
                      className={gradientBtn("md", "w-full")}
                    >
                      Upgrade to {plan.name}
                    </button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {me?.subscription_status === "active" && me.tier !== "free" && (
        <div className="mt-8 flex justify-center">
          <Button
            variant="outline"
            size="default"
            onClick={openPortal}
            disabled={portalBusy}
          >
            {portalBusy ? "Opening…" : "Manage billing"}
          </Button>
        </div>
      )}

      <Dialog
        open={modalTier !== null}
        onOpenChange={(open) => {
          if (!open) setModalTier(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Subscribe to {modalTier === "pro" ? "Pro" : "Enterprise"}
            </DialogTitle>
            <DialogDescription>
              Card details stay on this page — Stripe processes the payment
              securely in your browser.
            </DialogDescription>
          </DialogHeader>
          {modalTier && (
            <PaymentForm tier={modalTier} onSuccess={onPaymentSuccess} />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
