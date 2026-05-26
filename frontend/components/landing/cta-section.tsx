"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Sparkles } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { NoiseOverlay } from "@/components/landing/noise-overlay";
import { gradientBtn } from "@/lib/landing";
import { cn } from "@/lib/utils";

export function CtaSection() {
  const reduce = useReducedMotion();
  return (
    <section className="relative isolate overflow-hidden bg-black py-28 text-white md:py-36">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-20"
        style={{
          backgroundImage:
            "radial-gradient(ellipse 80% 60% at 50% 50%, rgba(99,102,241,0.25), transparent 60%), radial-gradient(ellipse 60% 50% at 80% 20%, rgba(168,85,247,0.20), transparent 60%), radial-gradient(ellipse 50% 50% at 20% 80%, rgba(236,72,153,0.18), transparent 60%)",
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[600px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-30 blur-[120px] aurora-spin"
        style={{
          background:
            "conic-gradient(from 0deg, #6366f1, #a855f7, #ec4899, #6366f1)",
        }}
      />
      <NoiseOverlay />

      <div className="relative mx-auto max-w-3xl px-4 text-center">
        <motion.h2
          initial={reduce ? false : { y: 30, opacity: 0 }}
          whileInView={reduce ? undefined : { y: 0, opacity: 1 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.7, ease: "easeOut" }}
          className="text-balance text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl"
        >
          Ready to give your <br />
          <span className="brand-text-gradient">website a brain?</span>
        </motion.h2>
        <motion.p
          initial={reduce ? false : { y: 20, opacity: 0 }}
          whileInView={reduce ? undefined : { y: 0, opacity: 1 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.6, delay: 0.15, ease: "easeOut" }}
          className="mx-auto mt-6 max-w-xl text-base text-white/65 sm:text-lg"
        >
          Free for the first bot. No credit card required. Setup takes 60
          seconds — your customers get answers forever.
        </motion.p>
        <motion.div
          initial={reduce ? false : { y: 20, opacity: 0 }}
          whileInView={reduce ? undefined : { y: 0, opacity: 1 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.6, delay: 0.3, ease: "easeOut" }}
          className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4"
        >
          <Link href="/signup" className={gradientBtn("lg")}>
            <Sparkles className="h-4 w-4" />
            Start building free
            <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            href="/widget-demo?bot_id=bot_4e84b82977"
            className={cn(
              buttonVariants({ variant: "outline", size: "lg" }),
              "border-white/20 bg-white/5 text-white hover:bg-white/10 hover:text-white",
            )}
          >
            View live demo
          </Link>
        </motion.div>
      </div>
    </section>
  );
}
