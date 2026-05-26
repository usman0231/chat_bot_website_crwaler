"use client";

import * as React from "react";
import { motion, useInView, useReducedMotion } from "framer-motion";
import { Brain, Globe, Zap } from "lucide-react";

const STEPS = [
  {
    icon: Globe,
    title: "Paste your URL",
    body:
      "We crawl every page using a real browser. JavaScript, sitemaps, and dynamic content all handled.",
    color: "from-indigo-500 to-indigo-600",
    ring: "ring-indigo-500/20",
    demo: <BrowserBarDemo />,
  },
  {
    icon: Brain,
    title: "We train your bot",
    body:
      "Pages are chunked, embedded, and indexed. Each bot gets its own private vector database.",
    color: "from-purple-500 to-purple-600",
    ring: "ring-purple-500/20",
    demo: <ProgressDemo />,
  },
  {
    icon: Zap,
    title: "Embed anywhere",
    body:
      "Chat widget, REST API, or voice call. Sources cited with every answer.",
    color: "from-pink-500 to-pink-600",
    ring: "ring-pink-500/20",
    demo: <CodeDemo />,
  },
];

function BrowserBarDemo() {
  const [text, setText] = React.useState("");
  const target = "https://visionara.ca";
  const ref = React.useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true });

  React.useEffect(() => {
    if (!inView) return;
    let i = 0;
    const id = setInterval(() => {
      setText(target.slice(0, i));
      i += 1;
      if (i > target.length) clearInterval(id);
    }, 60);
    return () => clearInterval(id);
  }, [inView]);

  return (
    <div ref={ref} className="rounded-lg border border-black/10 bg-white px-3 py-2 shadow-sm">
      <div className="flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full bg-red-400" />
        <span className="h-2 w-2 rounded-full bg-amber-400" />
        <span className="h-2 w-2 rounded-full bg-emerald-400" />
      </div>
      <div className="mt-2 rounded-md bg-black/5 px-3 py-1.5 text-xs font-mono text-black/70">
        {text}
        <span className="ml-0.5 inline-block h-3 w-px animate-pulse bg-black/60 align-middle" />
      </div>
    </div>
  );
}

function ProgressDemo() {
  const ref = React.useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true });
  return (
    <div ref={ref} className="space-y-2">
      <div className="flex items-center justify-between text-xs text-black/60">
        <span>Indexing pages…</span>
        <span className="font-mono">100%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-black/5">
        <motion.div
          initial={{ width: 0 }}
          animate={inView ? { width: "100%" } : { width: 0 }}
          transition={{ duration: 1.6, ease: "easeOut" }}
          className="h-full rounded-full bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500"
        />
      </div>
    </div>
  );
}

function CodeDemo() {
  return (
    <pre className="overflow-x-auto rounded-lg border border-black/10 bg-black px-3 py-2 text-[11px] leading-relaxed text-emerald-300">
      <code>
        {`<sg-widget bot-id="bot_4e84"></sg-widget>`}
      </code>
    </pre>
  );
}

export function HowItWorksSection() {
  const reduce = useReducedMotion();
  const lineRef = React.useRef<SVGSVGElement>(null);
  const inView = useInView(lineRef, { once: true, margin: "-100px" });

  return (
    <section
      id="how"
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
            How it works
          </p>
          <h2 className="mt-3 text-balance text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl">
            From URL to live chatbot in 3 steps
          </h2>
        </motion.div>

        <div className="relative mt-16">
          {/* Animated connecting line (desktop) */}
          <svg
            ref={lineRef}
            aria-hidden="true"
            viewBox="0 0 1000 8"
            preserveAspectRatio="none"
            className="pointer-events-none absolute left-[8%] right-[8%] top-7 hidden h-2 w-[84%] md:block"
          >
            <motion.path
              d="M 4 4 L 996 4"
              stroke="url(#step-grad)"
              strokeWidth="2"
              strokeDasharray="6 8"
              strokeLinecap="round"
              fill="none"
              initial={{ pathLength: 0 }}
              animate={inView ? { pathLength: 1 } : { pathLength: 0 }}
              transition={{ duration: 1.4, ease: "easeInOut" }}
            />
            <defs>
              <linearGradient id="step-grad" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#6366f1" />
                <stop offset="50%" stopColor="#a855f7" />
                <stop offset="100%" stopColor="#ec4899" />
              </linearGradient>
            </defs>
          </svg>

          <ol className="relative grid grid-cols-1 gap-10 md:grid-cols-3 md:gap-8">
            {STEPS.map((step, i) => {
              const Icon = step.icon;
              return (
                <motion.li
                  key={step.title}
                  initial={reduce ? false : { y: 30, opacity: 0 }}
                  whileInView={reduce ? undefined : { y: 0, opacity: 1 }}
                  viewport={{ once: true, margin: "-80px" }}
                  transition={{
                    duration: 0.6,
                    delay: i * 0.18,
                    ease: "easeOut",
                  }}
                  className="flex flex-col items-center text-center"
                >
                  <div
                    className={`relative flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br ${step.color} text-white shadow-lg ring-8 ${step.ring}`}
                  >
                    <Icon className="h-6 w-6" />
                    <span className="absolute -bottom-2 -right-2 grid h-6 w-6 place-items-center rounded-full border border-black/10 bg-white text-[11px] font-bold text-black/80 shadow-sm">
                      {i + 1}
                    </span>
                  </div>
                  <h3 className="mt-6 text-xl font-semibold">{step.title}</h3>
                  <p className="mt-2 max-w-xs text-sm text-black/55">
                    {step.body}
                  </p>
                  <div className="mt-5 w-full max-w-xs">{step.demo}</div>
                </motion.li>
              );
            })}
          </ol>
        </div>
      </div>
    </section>
  );
}
