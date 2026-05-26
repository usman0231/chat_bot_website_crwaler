"use client";

import * as React from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Sparkles } from "lucide-react";

import { NoiseOverlay } from "@/components/landing/noise-overlay";
import { gradientBtn } from "@/lib/landing";

type Msg =
  | { role: "user"; text: string }
  | {
      role: "bot";
      text: string;
      sources?: string[];
      blocked?: boolean;
    };

const SCRIPT: Msg[] = [
  { role: "user", text: "What services do you offer?" },
  {
    role: "bot",
    text: "We build web apps, mobile apps, and graphic design for growing brands.",
    sources: ["visionara.ca/services", "visionara.ca/about"],
  },
  { role: "user", text: "Who won the World Cup?" },
  {
    role: "bot",
    text: "I can only help with questions about Visionara. Is there something specific I can assist you with?",
    blocked: true,
  },
];

function MessageRow({ msg, i }: { msg: Msg; i: number }) {
  if (msg.role === "user") {
    return (
      <motion.div
        layout
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -10 }}
        transition={{ duration: 0.45, ease: "easeOut" }}
        className="flex justify-end"
      >
        <div className="max-w-[82%] rounded-2xl rounded-tr-sm bg-gradient-to-br from-indigo-500 to-purple-600 px-4 py-2.5 text-[15px] leading-relaxed text-white shadow-lg shadow-purple-500/25">
          {msg.text}
        </div>
      </motion.div>
    );
  }
  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 10 }}
      transition={{ duration: 0.45, ease: "easeOut" }}
      className="flex justify-start"
    >
      <div className="max-w-[88%] space-y-2">
        <div className="rounded-2xl rounded-tl-sm border border-white/15 bg-white/[0.06] px-4 py-2.5 text-[15px] leading-relaxed text-white/90 backdrop-blur-sm">
          {msg.text}
        </div>
        {msg.sources && (
          <div className="flex flex-wrap gap-1.5">
            {msg.sources.map((s) => (
              <span
                key={s}
                className="inline-flex items-center gap-1 rounded-full border border-indigo-400/30 bg-indigo-500/10 px-2 py-0.5 text-[11px] font-medium text-indigo-200"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className="h-2.5 w-2.5"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="10" />
                  <path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20" />
                </svg>
                {s}
              </span>
            ))}
          </div>
        )}
        {msg.blocked && (
          <span className="inline-flex items-center gap-1 rounded-full border border-red-500/40 bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-red-300">
            Out of scope
          </span>
        )}
      </div>
    </motion.div>
  );
}

export function DemoSection() {
  const reduce = useReducedMotion();
  const [visible, setVisible] = React.useState<number>(0);

  React.useEffect(() => {
    if (reduce) {
      setVisible(SCRIPT.length);
      return;
    }
    let i = 0;
    const tick = () => {
      i += 1;
      if (i > SCRIPT.length) {
        // Pause then reset
        setTimeout(() => {
          setVisible(0);
          i = 0;
          setTimeout(tick, 800);
        }, 2400);
        return;
      }
      setVisible(i);
      setTimeout(tick, 1500);
    };
    const id = setTimeout(tick, 700);
    return () => clearTimeout(id);
  }, [reduce]);

  return (
    <section className="relative overflow-hidden bg-black py-24 text-white md:py-32">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          backgroundImage:
            "radial-gradient(ellipse 60% 50% at 30% 50%, rgba(99,102,241,0.10), transparent 70%)",
        }}
      />
      <NoiseOverlay />
      <div className="relative z-[2] mx-auto grid max-w-6xl grid-cols-1 items-center gap-12 px-4 md:grid-cols-2 md:gap-16">
        <motion.div
          initial={reduce ? false : { y: 24, opacity: 0 }}
          whileInView={reduce ? undefined : { y: 0, opacity: 1 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        >
          <p className="text-xs font-medium uppercase tracking-[0.22em] text-indigo-400">
            See it in action
          </p>
          <h2 className="mt-3 text-balance text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl">
            Watch it{" "}
            <span className="brand-text-gradient">refuse</span>{" "}
            the wrong questions
          </h2>
          <p className="mt-5 max-w-md text-base text-white/60">
            Unlike generic chatbots, SiteGenie only answers from your website&apos;s
            actual content. Everything else gets a polite refusal — with sources
            cited for every accepted answer.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/widget-demo?bot_id=bot_4e84b82977" className={gradientBtn("lg")}>
              <Sparkles className="h-4 w-4" />
              Try the live demo
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </motion.div>

        <motion.div
          initial={reduce ? false : { y: 30, opacity: 0 }}
          whileInView={reduce ? undefined : { y: 0, opacity: 1 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.6, delay: 0.15, ease: "easeOut" }}
          className="relative"
        >
          <div
            aria-hidden="true"
            className="absolute -inset-6 -z-10 rounded-[28px] bg-gradient-to-br from-indigo-500/30 via-purple-500/20 to-pink-500/30 opacity-50 blur-2xl"
          />
          <div
            className="relative overflow-hidden rounded-2xl border border-white/15 p-5 backdrop-blur-xl"
            style={{
              background: "rgba(255,255,255,0.08)",
              boxShadow:
                "0 -20px 60px rgba(99,102,241,0.2), 0 25px 80px rgba(0,0,0,0.4)",
            }}
          >
            {/* Header */}
            <div className="mb-4 flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-xs font-bold text-white">
                  V
                </div>
                <div>
                  <p className="text-sm font-bold text-white">
                    Visionara Assistant
                  </p>
                  <p className="flex items-center gap-1.5 text-[11px] text-white/65">
                    <motion.span
                      animate={{ opacity: [0.3, 1, 0.3] }}
                      transition={{
                        duration: 1.6,
                        repeat: Infinity,
                        ease: "easeInOut",
                      }}
                      className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400"
                    />
                    Online · usually replies in 1s
                  </p>
                </div>
              </div>
              <span className="rounded-full border border-white/15 bg-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-white/70">
                Live
              </span>
            </div>

            <div className="flex h-[380px] flex-col gap-3 overflow-hidden">
              <AnimatePresence initial={false}>
                {SCRIPT.slice(0, visible).map((m, i) => (
                  <MessageRow key={`${i}-${m.text}`} msg={m} i={i} />
                ))}
              </AnimatePresence>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
