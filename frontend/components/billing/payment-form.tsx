"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
  CardElement,
  Elements,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { AlertCircle, Check, CreditCard, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ApiError,
  confirmPayment,
  createPaymentIntent,
  type PaymentIntentResponse,
} from "@/lib/api";
import { useAuth } from "@/lib/auth-store";
import { cn } from "@/lib/utils";
import { gradientBtn } from "@/lib/landing";

type Tier = "pro" | "enterprise";

const PLAN_DETAILS: Record<
  Tier,
  { name: string; price: string; period: string; features: string[] }
> = {
  pro: {
    name: "Pro",
    price: "$29",
    period: "/month",
    features: [
      "10 bots",
      "Up to 100 pages per crawl",
      "5,000 chat messages / month",
      "Email support",
    ],
  },
  enterprise: {
    name: "Enterprise",
    price: "$99",
    period: "/month",
    features: [
      "Unlimited bots",
      "Up to 9,999 pages per crawl",
      "1M chat messages / month",
      "Priority support",
    ],
  },
};

// Caches the Stripe.js bootstrap promise per publishable key — calling
// loadStripe twice with the same key is fine, but reusing the promise lets
// React's StrictMode double-mount not download stripe.js twice.
const stripePromiseCache: Record<string, Promise<Stripe | null>> = {};

function getStripe(publishableKey: string): Promise<Stripe | null> {
  if (!publishableKey) return Promise.resolve(null);
  if (!stripePromiseCache[publishableKey]) {
    stripePromiseCache[publishableKey] = loadStripe(publishableKey);
  }
  return stripePromiseCache[publishableKey];
}

export type PaymentFormProps = {
  tier: Tier;
  onSuccess?: () => void;
};

export function PaymentForm({ tier, onSuccess }: PaymentFormProps) {
  const [intent, setIntent] = React.useState<PaymentIntentResponse | null>(
    null,
  );
  const [intentError, setIntentError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setIntent(null);
    setIntentError(null);
    createPaymentIntent(tier)
      .then((res) => {
        if (!cancelled) setIntent(res);
      })
      .catch((err) => {
        if (cancelled) return;
        const msg =
          err instanceof ApiError
            ? err.message
            : "Could not initialise payment";
        setIntentError(msg);
      });
    return () => {
      cancelled = true;
    };
  }, [tier]);

  if (intentError) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>{intentError}</span>
      </div>
    );
  }

  if (!intent) {
    return (
      <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
        Setting up secure payment…
      </div>
    );
  }

  const publishableKey =
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || intent.publishable_key;

  if (!publishableKey) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>
          Stripe publishable key is missing. Set
          NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY in frontend/.env.local.
        </span>
      </div>
    );
  }

  return (
    <Elements
      stripe={getStripe(publishableKey)}
      options={{ clientSecret: intent.client_secret }}
    >
      <CheckoutForm intent={intent} tier={tier} onSuccess={onSuccess} />
    </Elements>
  );
}

function CheckoutForm({
  intent,
  tier,
  onSuccess,
}: {
  intent: PaymentIntentResponse;
  tier: Tier;
  onSuccess?: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const router = useRouter();
  const { refreshMe } = useAuth();
  const { resolvedTheme } = useTheme();

  const [name, setName] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [cardReady, setCardReady] = React.useState(false);
  const [cardError, setCardError] = React.useState<string | null>(null);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState(false);

  const plan = PLAN_DETAILS[tier];

  const dark = resolvedTheme === "dark";

  const cardOptions = React.useMemo(
    () => ({
      hidePostalCode: false,
      style: {
        base: {
          fontSize: "16px",
          color: dark ? "#f5f5f5" : "#1a1a1a",
          fontFamily:
            "Inter, -apple-system, BlinkMacSystemFont, system-ui, sans-serif",
          "::placeholder": { color: dark ? "#6b7280" : "#9ca3af" },
          iconColor: dark ? "#a78bfa" : "#6366f1",
        },
        invalid: {
          color: dark ? "#fca5a5" : "#ef4444",
          iconColor: dark ? "#fca5a5" : "#ef4444",
        },
      },
    }),
    [dark],
  );

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!stripe || !elements || submitting) return;
    const card = elements.getElement(CardElement);
    if (!card) return;
    if (!name.trim()) {
      setFormError("Cardholder name is required");
      return;
    }

    setSubmitting(true);
    setFormError(null);
    setCardError(null);

    const { error, paymentIntent } = await stripe.confirmCardPayment(
      intent.client_secret,
      {
        payment_method: {
          card,
          billing_details: { name: name.trim() },
        },
      },
    );

    if (error) {
      const msg = error.message || "Your card could not be processed.";
      // Stripe categorises card_error / validation_error inline; everything
      // else (network, rate-limit, etc.) is surfaced as a toast.
      if (error.type === "card_error" || error.type === "validation_error") {
        setCardError(msg);
      } else {
        toast.error(msg);
        setFormError(msg);
      }
      setSubmitting(false);
      return;
    }

    // PaymentIntent succeeded — flip tier server-side, refresh /auth/me,
    // and hand off to /billing/success.
    try {
      await confirmPayment(intent.subscription_id);
    } catch {
      // Webhook will still flip the tier; don't block the user.
    }
    await refreshMe();
    setSuccess(true);
    if (onSuccess) {
      onSuccess();
    } else {
      window.setTimeout(() => router.push("/billing/success"), 400);
    }
    void paymentIntent;
  }

  if (success) {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg">
          <Check className="h-7 w-7" aria-hidden="true" />
        </div>
        <p className="text-sm text-muted-foreground">
          Payment confirmed — redirecting you now…
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div className="rounded-lg border border-border bg-card/50 p-3">
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-semibold">{plan.name} plan</span>
          <span>
            <span className="text-lg font-bold">{plan.price}</span>
            <span className="text-xs text-muted-foreground">{plan.period}</span>
          </span>
        </div>
        <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
          {plan.features.map((f) => (
            <li key={f} className="flex items-start gap-1.5">
              <Check
                className="mt-0.5 h-3 w-3 shrink-0 text-emerald-500"
                aria-hidden="true"
              />
              <span>{f}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="cardholder-name">Cardholder name</Label>
        <Input
          id="cardholder-name"
          type="text"
          autoComplete="cc-name"
          placeholder="Ada Lovelace"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={submitting}
          className="h-10"
          aria-invalid={!!formError && !name.trim()}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="card-element">Card details</Label>
        <div
          id="card-element"
          className={cn(
            "flex h-10 w-full items-center rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background",
            cardError && "border-destructive ring-1 ring-destructive/40",
            submitting && "opacity-60",
          )}
        >
          <div className="w-full">
            <CardElement
              options={cardOptions}
              onChange={(e) => {
                setCardReady(e.complete);
                setCardError(e.error?.message ?? null);
              }}
            />
          </div>
        </div>
        {cardError && (
          <p className="flex items-start gap-1 text-xs text-destructive">
            <AlertCircle className="mt-0.5 h-3 w-3" aria-hidden="true" />
            {cardError}
          </p>
        )}
        {formError && !cardError && (
          <p className="text-xs text-destructive">{formError}</p>
        )}
      </div>

      <button
        type="submit"
        className={gradientBtn("md", "w-full")}
        disabled={!stripe || !elements || submitting || !cardReady}
      >
        {submitting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Processing…
          </>
        ) : (
          <>
            <CreditCard className="h-4 w-4" aria-hidden="true" />
            Subscribe to {plan.name}
          </>
        )}
      </button>

      <p className="text-center text-[11px] text-muted-foreground">
        Payments are processed securely by Stripe. You can cancel anytime from
        the billing portal.
      </p>
    </form>
  );
}
