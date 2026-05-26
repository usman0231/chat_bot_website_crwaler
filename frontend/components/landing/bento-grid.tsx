"use client";

import * as React from "react";
import { motion, useInView, useMotionValue, useTransform, animate, useReducedMotion } from "framer-motion";
import {
  Code,
  Globe,
  Lock,
  Phone,
  Shield,
  ShieldOff,
  Zap,
} from "lucide-react";

import { cn } from "@/lib/utils";

function BentoCard({
  children,
  className,
  index,
  title,
  icon,
  iconColor,
}: {
  children?: React.ReactNode;
  className?: string;
  index: number;
  title: string;
  icon: React.ReactNode;
  iconColor: string;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? false : { y: 30, opacity: 0 }}
      whileInView={reduce ? undefined : { y: 0, opacity: 1 }}
      whileHover={
        reduce
          ? undefined
          : { scale: 1.02, borderColor: "rgba(255,255,255,0.22)" }
      }
      viewport={{ once: true, margin: "-80px" }}
      transition={{
        duration: 0.55,
        delay: index * 0.08,
        ease: [0.22, 1, 0.36, 1],
      }}
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.03] p-6",
        "before:pointer-events-none before:absolute before:inset-0 before:rounded-2xl before:bg-gradient-to-br before:from-white/[0.05] before:to-transparent before:opacity-0 before:transition-opacity hover:before:opacity-100",
        className,
      )}
    >
      <div
        className={cn(
          "relative mb-4 inline-flex h-10 w-10 items-center justify-center rounded-xl",
          iconColor,
        )}
      >
        {icon}
      </div>
      <h3 className="relative text-lg font-semibold text-white">{title}</h3>
      <div className="relative mt-3 flex-1">{children}</div>
    </motion.div>
  );
}

/* ─────────── Card 1: Strict Guardrails (animated chat) ─────────── */
function GuardrailsDemo() {
  const messages = [
    { side: "user", text: "Pricing for the Pro plan?", scope: "in" },
    { side: "bot", text: "$29/mo. Includes 10 bots and email support.", scope: "in" },
    { side: "user", text: "Who won the 2026 Champions League?", scope: "out" },
    { side: "bot", text: "Out of scope — I only answer site questions.", scope: "out" },
  ];

  return (
    <div className="mt-4 space-y-2 text-[12px] leading-snug">
      {messages.map((m, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, x: m.side === "user" ? 12 : -12 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: false, margin: "-40px" }}
          transition={{
            duration: 0.45,
            delay: i * 0.45,
            ease: "easeOut",
          }}
          className={cn(
            "flex",
            m.side === "user" ? "justify-end" : "justify-start",
          )}
        >
          <div
            className={cn(
              "max-w-[85%] rounded-xl px-3 py-2",
              m.side === "user"
                ? "bg-gradient-to-br from-indigo-500 to-purple-600 text-white"
                : m.scope === "out"
                  ? "border border-red-500/30 bg-red-500/10 text-red-200"
                  : "border border-white/10 bg-white/[0.04] text-white/85",
            )}
          >
            {m.text}
            {m.scope === "out" && m.side === "bot" && (
              <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-red-500/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-red-300">
                <ShieldOff className="h-2.5 w-2.5" /> blocked
              </span>
            )}
          </div>
        </motion.div>
      ))}
    </div>
  );
}

/* ─────────── Card 2: 60-second training (radial progress) ─────────── */
function ProgressDemo() {
  const ref = React.useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  const value = useMotionValue(0);
  const display = useTransform(value, (v) => `${Math.round(v)}%`);
  const background = useTransform(
    value,
    (v) =>
      `conic-gradient(#a855f7 ${(v / 100) * 360}deg, rgba(255,255,255,0.08) 0)`,
  );
  const [text, setText] = React.useState("0%");

  React.useEffect(() => {
    if (!inView) return;
    const controls = animate(value, 100, { duration: 1.6, ease: "easeOut" });
    const unsub = display.on("change", (latest) => setText(latest));
    return () => {
      controls.stop();
      unsub();
    };
  }, [inView, value, display]);

  return (
    <div ref={ref} className="mt-4 flex items-center gap-4">
      <motion.div
        className="relative grid h-20 w-20 place-items-center rounded-full"
        style={{ background }}
      >
        <div className="grid h-[60px] w-[60px] place-items-center rounded-full bg-[#0a0a0a] text-sm font-semibold text-white">
          {text}
        </div>
      </motion.div>
      <p className="text-xs text-white/55">
        URL → live bot in under 60 seconds.
      </p>
    </div>
  );
}

/* ─────────── Card 3: Privacy lock ─────────── */
function PrivacyDemo() {
  return (
    <div className="mt-4 flex items-center gap-3">
      <motion.div
        animate={{ rotate: [0, -8, 8, -4, 0] }}
        transition={{ duration: 2.2, repeat: Infinity, repeatDelay: 1.6 }}
        className="grid h-12 w-12 place-items-center rounded-xl border border-emerald-400/30 bg-emerald-500/10"
      >
        <Lock className="h-5 w-5 text-emerald-300" />
      </motion.div>
      <p className="text-xs text-white/55">
        Your data stays local. Zero cloud calls to OpenAI or Anthropic.
      </p>
    </div>
  );
}

/* ─────────── Card 4: Voice waveform ─────────── */
const WAVE_HEIGHTS = [
  28, 52, 74, 86, 80, 60, 36, 24, 32, 56, 78, 88, 82, 64,
  40, 26, 34, 60, 80, 90, 84, 68, 44, 28, 36, 62, 82, 90,
];

function VoiceDemo() {
  return (
    <div className="mt-4 flex flex-col gap-3">
      <div className="flex h-16 items-center justify-center gap-[3px] rounded-xl border border-white/10 bg-black/40 px-3 py-3">
        {WAVE_HEIGHTS.map((h, i) => (
          <span
            key={i}
            className="wave-bar w-[3px] rounded-full bg-gradient-to-t from-indigo-500 via-purple-400 to-pink-400"
            style={{
              height: `${h}%`,
              animationDelay: `${(i % 7) * 90}ms`,
            }}
          />
        ))}
      </div>
      <p className="text-xs text-white/55">
        Call your bot like a real customer service agent. ElevenLabs voices,
        Twilio-powered.
      </p>
    </div>
  );
}

/* ─────────── Card 5: Counter + animated globe ─────────── */
function CounterDemo() {
  const ref = React.useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  const [count, setCount] = React.useState(0);
  React.useEffect(() => {
    if (!inView) return;
    const controls = animate(0, 10000, {
      duration: 1.8,
      ease: "easeOut",
      onUpdate: (latest) => setCount(Math.round(latest)),
    });
    return () => controls.stop();
  }, [inView]);

  return (
    <div ref={ref} className="mt-4 flex items-center gap-4">
      <span
        aria-hidden="true"
        className="globe-rotate inline-block h-14 w-14 shrink-0 rounded-full border-2 border-indigo-400/40"
      />
      <div>
        <p className="brand-text-gradient text-3xl font-bold tabular-nums">
          {count.toLocaleString()}+
        </p>
        <p className="mt-1 text-xs text-white/55">pages supported per crawl</p>
      </div>
    </div>
  );
}

/* ─────────── Card 6: Code snippet ─────────── */
function CodeDemo() {
  return (
    <pre
      className="mt-4 overflow-hidden rounded-lg border border-white/10 p-3 font-mono text-[11px] leading-[1.6] text-slate-200"
      style={{ background: "rgba(0,0,0,0.6)" }}
    >
      <code>
        <span style={{ color: "#818cf8" }}>curl</span>{" "}
        <span style={{ color: "#34d399" }}>-X POST</span>{" "}
        <span style={{ color: "#fbbf24" }}>/bot/chat</span>
        {"\n  "}
        <span style={{ color: "#818cf8" }}>-H</span>{" "}
        <span style={{ color: "#f472b6" }}>{`"X-API-Key: sk_***"`}</span>
        {"\n  "}
        <span style={{ color: "#818cf8" }}>-d</span>{" "}
        <span style={{ color: "#f472b6" }}>
          {`'{"message":"hi"}'`}
        </span>
      </code>
    </pre>
  );
}

export function BentoGrid() {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-4 md:grid-rows-3 md:gap-5">
      <BentoCard
        index={0}
        title="Strict guardrails"
        icon={<Shield className="h-5 w-5 text-indigo-300" />}
        iconColor="bg-indigo-500/15"
        className="md:col-span-2 md:row-span-2"
      >
        <GuardrailsDemo />
      </BentoCard>

      <BentoCard
        index={1}
        title="60-second training"
        icon={<Zap className="h-5 w-5 text-purple-300" />}
        iconColor="bg-purple-500/15"
        className="md:col-span-1 md:row-span-1"
      >
        <ProgressDemo />
      </BentoCard>

      <BentoCard
        index={2}
        title="Privacy-first"
        icon={<Lock className="h-5 w-5 text-emerald-300" />}
        iconColor="bg-emerald-500/15"
        className="md:col-span-1 md:row-span-1"
      >
        <PrivacyDemo />
      </BentoCard>

      <BentoCard
        index={3}
        title="Voice calling"
        icon={<Phone className="h-5 w-5 text-pink-300" />}
        iconColor="bg-pink-500/15"
        className="md:col-span-2 md:row-span-1"
      >
        <VoiceDemo />
      </BentoCard>

      <BentoCard
        index={4}
        title="Any website"
        icon={<Globe className="h-5 w-5 text-cyan-300" />}
        iconColor="bg-cyan-500/15"
        className="md:col-span-1 md:row-span-1"
      >
        <CounterDemo />
      </BentoCard>

      <BentoCard
        index={5}
        title="API-ready"
        icon={<Code className="h-5 w-5 text-amber-300" />}
        iconColor="bg-amber-500/15"
        className="md:col-span-1 md:row-span-1"
      >
        <CodeDemo />
      </BentoCard>
    </div>
  );
}
