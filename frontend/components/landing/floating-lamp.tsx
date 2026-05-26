"use client";

import * as React from "react";
import dynamic from "next/dynamic";

const LampScene = dynamic(() => import("./lamp-scene"), {
  ssr: false,
  loading: () => <LampFallback />,
});

function LampFallback() {
  return (
    <div className="grid h-full w-full place-items-center">
      <div className="relative h-48 w-48">
        <div
          aria-hidden="true"
          className="absolute left-1/2 top-6 h-20 w-24 -translate-x-1/2 rounded-t-full bg-gradient-to-b from-indigo-500 to-indigo-700 opacity-80"
        />
        <div
          aria-hidden="true"
          className="absolute left-1/2 top-20 h-16 w-1 -translate-x-1/2 bg-white/40"
        />
        <div
          aria-hidden="true"
          className="absolute left-1/2 bottom-4 h-2 w-20 -translate-x-1/2 rounded-full bg-white/30"
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 animate-pulse rounded-full bg-amber-300/30 blur-3xl"
        />
      </div>
    </div>
  );
}

export function FloatingLamp() {
  const [reduced, setReduced] = React.useState(false);

  React.useEffect(() => {
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mql.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return (
    <div className="h-[320px] w-[320px] md:h-[420px] md:w-[420px]">
      {reduced ? <LampFallback /> : <LampScene />}
    </div>
  );
}
