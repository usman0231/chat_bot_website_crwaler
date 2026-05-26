"use client";

import { motion, useReducedMotion } from "framer-motion";

import { BentoGrid } from "@/components/landing/bento-grid";
import { NoiseOverlay } from "@/components/landing/noise-overlay";

export function FeaturesSection() {
  const reduce = useReducedMotion();
  return (
    <section
      id="features"
      className="relative scroll-mt-20 overflow-hidden bg-[#0a0a0a] py-24 text-white md:py-32"
    >
      <NoiseOverlay />
      <div className="relative z-[2] mx-auto max-w-6xl px-4">
        <motion.div
          initial={reduce ? false : { y: 24, opacity: 0 }}
          whileInView={reduce ? undefined : { y: 0, opacity: 1 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className="mx-auto max-w-2xl text-center"
        >
          <p className="text-xs font-medium uppercase tracking-[0.22em] text-indigo-400">
            Everything you need
          </p>
          <h2 className="mt-3 text-balance text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl">
            Features built for the real world
          </h2>
          <p className="mt-4 text-balance text-base text-white/55">
            Not just chat. A complete answer engine with guardrails, voice,
            privacy and developer ergonomics.
          </p>
        </motion.div>

        <div className="mt-14">
          <BentoGrid />
        </div>
      </div>

      {/* fade to next light section */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 z-[1] h-24 bg-gradient-to-b from-transparent to-[#fafafa]"
      />
    </section>
  );
}
