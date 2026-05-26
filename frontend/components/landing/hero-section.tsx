"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, ChevronDown, Globe, Sparkles } from "lucide-react";

import { FloatingLamp } from "@/components/landing/floating-lamp";
import { NoiseOverlay } from "@/components/landing/noise-overlay";
import { gradientBtn } from "@/lib/landing";

const PLACEHOLDERS = [
  "https://yourwebsite.com",
  "https://visionara.ca",
  "https://broadwaypizza.com.pk",
  "https://stripe.com",
];

const TECH_BADGES = [
  "Qwen 2.5",
  "ChromaDB",
  "Playwright",
  "FastAPI",
  "Ollama",
  "Next.js",
  "Three.js",
  "Stripe",
];

const HEADLINE_L1 = ["Give", "your", "website"];
const HEADLINE_L2 = ["a", "brain."];

function ensureHttps(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function useTypedPlaceholder(): string {
  const [text, setText] = React.useState(PLACEHOLDERS[0]);
  const reduce = useReducedMotion();

  React.useEffect(() => {
    if (reduce) return;
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let currentIndex = 0;
    let currentText = PLACEHOLDERS[0];

    const schedule = (fn: () => void, ms: number) => {
      timeoutId = setTimeout(() => {
        if (cancelled) return;
        fn();
      }, ms);
    };

    const eraseAndType = () => {
      const nextIndex = (currentIndex + 1) % PLACEHOLDERS.length;
      const next = PLACEHOLDERS[nextIndex];
      let cursor = currentText.length;

      const eraseStep = () => {
        if (cancelled) return;
        if (cursor > 0) {
          cursor -= 1;
          setText(currentText.slice(0, cursor));
          schedule(eraseStep, 22);
        } else {
          let j = 0;
          const typeStep = () => {
            if (cancelled) return;
            if (j <= next.length) {
              setText(next.slice(0, j));
              j += 1;
              schedule(typeStep, 38);
            } else {
              currentIndex = nextIndex;
              currentText = next;
              schedule(eraseAndType, 2400);
            }
          };
          typeStep();
        }
      };
      eraseStep();
    };

    schedule(eraseAndType, 2400);
    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [reduce]);

  return text;
}

export function HeroSection() {
  const router = useRouter();
  const reduce = useReducedMotion();
  const [value, setValue] = React.useState("");
  const placeholder = useTypedPlaceholder();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const url = ensureHttps(value);
    if (!url) return;
    router.push(`/signup?url=${encodeURIComponent(url)}`);
  }

  const headlineWord = (word: string, index: number, totalSoFar: number) => (
    <motion.span
      key={`${word}-${totalSoFar + index}`}
      initial={reduce ? false : { y: 40, opacity: 0 }}
      animate={reduce ? undefined : { y: 0, opacity: 1 }}
      transition={{
        duration: 0.6,
        delay: 0.15 + (totalSoFar + index) * 0.08,
        ease: [0.22, 1, 0.36, 1],
      }}
      className="inline-block"
    >
      {word}
      {index <
      (totalSoFar === 0
        ? HEADLINE_L1.length - 1
        : HEADLINE_L2.length - 1)
        ? " "
        : ""}
    </motion.span>
  );

  return (
    <section
      id="hero"
      className="relative isolate overflow-hidden bg-black text-white"
    >
      {/* Radial gradient bg */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-20"
        style={{
          backgroundImage:
            "radial-gradient(ellipse 80% 60% at 50% 0%, rgba(99,102,241,0.32), transparent 60%), radial-gradient(ellipse 60% 50% at 80% 30%, rgba(168,85,247,0.22), transparent 60%), radial-gradient(ellipse 50% 50% at 20% 60%, rgba(236,72,153,0.16), transparent 60%)",
        }}
      />
      {/* Dot grid */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 opacity-60"
        style={{
          backgroundImage:
            "radial-gradient(circle, rgba(99,102,241,0.15) 1px, transparent 1px)",
          backgroundSize: "32px 32px",
          maskImage:
            "radial-gradient(ellipse 70% 70% at 50% 40%, black 40%, transparent 100%)",
          WebkitMaskImage:
            "radial-gradient(ellipse 70% 70% at 50% 40%, black 40%, transparent 100%)",
        }}
      />
      {/* Aurora */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-[10%] -z-10 h-[700px] w-[700px] -translate-x-1/2 rounded-full opacity-[0.18] blur-[120px] aurora-spin"
        style={{
          background:
            "conic-gradient(from 0deg, #6366f1, #a855f7, #ec4899, #6366f1)",
        }}
      />
      <NoiseOverlay />

      <div className="relative mx-auto grid min-h-[calc(100svh-4rem)] max-w-7xl grid-cols-1 items-center gap-10 px-6 py-16 md:grid-cols-2 md:gap-12 md:py-24">
        {/* Orb — first on mobile, left on desktop */}
        <div className="flex justify-center md:order-1 md:justify-start">
          <FloatingLamp />
        </div>

        {/* Text */}
        <div className="flex flex-col items-center text-center md:order-2 md:items-start md:text-left">
          <motion.div
            initial={reduce ? false : { y: 16, opacity: 0 }}
            animate={reduce ? undefined : { y: 0, opacity: 1 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
            className="relative mb-6 inline-flex items-center gap-2 overflow-hidden rounded-full border border-white/15 bg-white/5 px-3.5 py-1.5 text-xs font-medium tracking-wide text-white/90 backdrop-blur-md"
          >
            <span className="pill-shimmer absolute inset-0 rounded-full" aria-hidden="true" />
            <Sparkles className="h-3.5 w-3.5 text-fuchsia-300" aria-hidden="true" />
            <span className="relative">AI-powered · Privacy-first · Local LLM</span>
          </motion.div>

          <h1 className="max-w-2xl text-balance text-5xl font-bold leading-[1.02] tracking-tight md:text-6xl lg:text-7xl">
            <span className="block text-white">
              {HEADLINE_L1.map((w, i) => headlineWord(w, i, 0))}
            </span>
            <span className="brand-text-gradient mt-2 block">
              {HEADLINE_L2.map((w, i) => headlineWord(w, i, HEADLINE_L1.length))}
            </span>
          </h1>

          <motion.p
            initial={reduce ? false : { y: 20, opacity: 0 }}
            animate={reduce ? undefined : { y: 0, opacity: 1 }}
            transition={{ duration: 0.7, delay: 0.7, ease: "easeOut" }}
            className="mt-7 max-w-xl text-balance text-base text-white/65 sm:text-lg"
          >
            Train a chatbot on any website in 60 seconds. Strictly scoped
            answers, voice calling support, and zero cloud dependencies.
          </motion.p>

          <motion.div
            initial={reduce ? false : { y: 24, opacity: 0 }}
            animate={reduce ? undefined : { y: 0, opacity: 1 }}
            transition={{ duration: 0.7, delay: 0.9, ease: "easeOut" }}
            className="mt-9 w-full max-w-xl"
          >
            <form
              onSubmit={onSubmit}
              className="glass-dark flex flex-col gap-2 rounded-2xl p-2 shadow-2xl shadow-purple-500/10 sm:flex-row sm:items-center"
            >
              <label htmlFor="hero-url-3d" className="sr-only">
                Website URL
              </label>
              <div className="flex flex-1 items-center gap-2 rounded-xl px-3">
                <Globe className="h-4 w-4 shrink-0 text-white/40" aria-hidden="true" />
                <input
                  id="hero-url-3d"
                  name="url"
                  type="text"
                  inputMode="url"
                  autoComplete="url"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder={placeholder}
                  className="h-11 w-full bg-transparent text-base text-white placeholder:text-white/30 focus:outline-none"
                  required
                />
              </div>
              <button type="submit" className={gradientBtn("lg", "shrink-0")}>
                Train your bot
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </form>

            <div className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-white/55 md:justify-start">
              {[
                "Free forever",
                "No credit card",
                "Setup in 60 seconds",
              ].map((s) => (
                <span key={s} className="inline-flex items-center gap-1.5">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  {s}
                </span>
              ))}
            </div>
          </motion.div>

          {/* Tech marquee */}
          <motion.div
            initial={reduce ? false : { opacity: 0 }}
            animate={reduce ? undefined : { opacity: 1 }}
            transition={{ duration: 0.8, delay: 1.2 }}
            className="relative mt-12 w-full max-w-2xl overflow-hidden"
          >
            <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.22em] text-indigo-400 md:text-left">
              Built with
            </p>
            <div className="relative">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 left-0 z-10 w-16 bg-gradient-to-r from-black to-transparent"
              />
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 right-0 z-10 w-16 bg-gradient-to-l from-black to-transparent"
              />
              <div className="flex w-max gap-3 marquee-track">
                {[...TECH_BADGES, ...TECH_BADGES].map((badge, i) => (
                  <span
                    key={`${badge}-${i}`}
                    className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3.5 py-1.5 text-xs font-medium text-white/75"
                  >
                    {badge}
                  </span>
                ))}
              </div>
            </div>
          </motion.div>
        </div>
      </div>

      {/* Scroll indicator — chevron only */}
      <motion.a
        href="#features"
        initial={reduce ? false : { opacity: 0 }}
        animate={reduce ? undefined : { opacity: 1 }}
        transition={{ duration: 0.8, delay: 1.5 }}
        aria-label="Scroll to features"
        className="absolute bottom-6 left-1/2 -translate-x-1/2 text-white/45 transition-colors hover:text-white/90"
      >
        <ChevronDown className="h-5 w-5 scroll-bounce" aria-hidden="true" />
      </motion.a>

      {/* Dark fade to next dark section */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-32 bg-gradient-to-b from-transparent to-[#0a0a0a]"
      />
    </section>
  );
}
