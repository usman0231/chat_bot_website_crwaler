"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { Check, Sparkles } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { gradientBtn } from "@/lib/landing";
import { cn } from "@/lib/utils";

const PLANS = [
  {
    name: "Starter",
    price: "Free",
    blurb: "Perfect for testing",
    features: [
      "1 bot",
      "50 pages crawled",
      "1,000 messages/month",
      "Community support",
    ],
    cta: { label: "Get started", href: "/signup", variant: "ghost" as const },
    recommended: false,
  },
  {
    name: "Pro",
    price: "$29",
    priceSuffix: "/mo",
    blurb: "For teams shipping production bots",
    features: [
      "10 bots",
      "500 pages per bot",
      "50,000 messages/month",
      "Email support",
      "Custom branding",
      "Priority training queue",
    ],
    cta: { label: "Start free trial", href: "/signup", variant: "gradient" as const },
    recommended: true,
  },
  {
    name: "Enterprise",
    price: "$99",
    priceSuffix: "/mo",
    blurb: "For large teams",
    features: [
      "Unlimited bots",
      "Unlimited pages",
      "Unlimited messages",
      "SLA + dedicated support",
      "Self-hosted option",
      "SSO + audit logs",
    ],
    cta: { label: "Contact sales", href: "#contact", variant: "outline" as const },
    recommended: false,
  },
];

export function PricingSection() {
  const reduce = useReducedMotion();
  return (
    <section
      id="pricing"
      className="relative scroll-mt-20 bg-[#fafafa] py-24 text-[#0a0a0a] md:py-32"
    >
      <div className="mx-auto max-w-6xl px-4">
        <motion.div
          initial={reduce ? false : { y: 24, opacity: 0 }}
          whileInView={reduce ? undefined : { y: 0, opacity: 1 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className="mx-auto max-w-2xl text-center"
        >
          <p className="text-xs font-medium uppercase tracking-[0.22em] text-indigo-500">
            Pricing
          </p>
          <h2 className="mt-3 text-balance text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl">
            Simple, transparent pricing
          </h2>
          <p className="mt-4 text-base text-black/55">
            All plans include local LLM, strict guardrails, and unlimited chats.
          </p>
        </motion.div>

        <div className="mt-16 grid grid-cols-1 gap-6 md:grid-cols-3 md:items-stretch">
          {PLANS.map((plan, i) => (
            <motion.div
              key={plan.name}
              initial={reduce ? false : { y: 30, opacity: 0 }}
              whileInView={reduce ? undefined : { y: 0, opacity: 1 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{
                duration: 0.6,
                delay: i * 0.12,
                ease: "easeOut",
              }}
              className="relative flex"
            >
              {plan.recommended && (
                <span className="pointer-events-none absolute -top-3 left-1/2 z-10 inline-flex -translate-x-1/2 items-center gap-1 rounded-full bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-white shadow-md">
                  <Sparkles className="h-3 w-3" />
                  <span className="shimmer-text">Most popular</span>
                </span>
              )}

              <div
                className={cn(
                  "group relative flex w-full flex-col rounded-2xl border bg-white p-8 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-xl",
                  plan.recommended
                    ? "border-purple-500/40 shadow-purple-500/10 hover:shadow-purple-500/30"
                    : "border-black/10",
                )}
              >
                {plan.recommended && (
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute -inset-px -z-10 rounded-2xl bg-gradient-to-br from-indigo-500/0 via-purple-500/30 to-pink-500/0 opacity-0 blur-md transition-opacity duration-500 group-hover:opacity-100"
                  />
                )}

                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-black/55">
                  {plan.name}
                </p>
                <div className="mt-4 flex items-baseline gap-1">
                  <span className="text-4xl font-bold">{plan.price}</span>
                  {plan.priceSuffix && (
                    <span className="text-base font-normal text-black/55">
                      {plan.priceSuffix}
                    </span>
                  )}
                </div>
                <p className="mt-2 text-sm text-black/55">{plan.blurb}</p>

                <ul className="mt-6 space-y-2.5 text-sm">
                  {plan.features.map((feat) => (
                    <li key={feat} className="flex items-start gap-2">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                      <span>{feat}</span>
                    </li>
                  ))}
                </ul>

                <div className="mt-auto pt-8">
                  {plan.cta.variant === "gradient" ? (
                    <Link href={plan.cta.href} className={gradientBtn("md", "w-full")}>
                      {plan.cta.label}
                    </Link>
                  ) : (
                    <Link
                      href={plan.cta.href}
                      className={cn(
                        buttonVariants({ variant: plan.cta.variant }),
                        "w-full",
                      )}
                    >
                      {plan.cta.label}
                    </Link>
                  )}
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
