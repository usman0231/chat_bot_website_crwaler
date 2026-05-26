"use client";

import * as React from "react";

import { api } from "@/lib/api";

export type BackendStatus = "connected" | "checking" | "offline";

type Listener = (snapshot: Snapshot) => void;

type Snapshot = {
  status: BackendStatus;
  lastSuccess: number | null;
  failures: number;
};

let snapshot: Snapshot = {
  status: "checking",
  lastSuccess: null,
  failures: 0,
};

const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l(snapshot);
}

function setSnapshot(next: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...next };
  emit();
}

let timer: ReturnType<typeof setInterval> | null = null;
let active = false;
let inflight: AbortController | null = null;

async function pingOnce(): Promise<boolean> {
  inflight?.abort();
  const ctl = new AbortController();
  inflight = ctl;
  try {
    const res = await fetch(`${api.baseUrl}/health`, {
      signal: ctl.signal,
      cache: "no-store",
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    if (inflight === ctl) inflight = null;
  }
}

async function tick() {
  // Optimistic — show "checking" only on the first tick.
  if (snapshot.lastSuccess === null && snapshot.status !== "offline") {
    setSnapshot({ status: "checking" });
  }
  const ok = await pingOnce();
  if (ok) {
    setSnapshot({
      status: "connected",
      lastSuccess: Date.now(),
      failures: 0,
    });
  } else {
    const failures = snapshot.failures + 1;
    // Flip to "offline" only after 3 consecutive failures so a single blip
    // doesn't spook the user.
    setSnapshot({
      failures,
      status: failures >= 3 ? "offline" : snapshot.status,
    });
  }
}

function start() {
  if (active) return;
  active = true;
  void tick();
  timer = setInterval(() => {
    void tick();
  }, 30_000);
}

function stop() {
  if (!active) return;
  active = false;
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  inflight?.abort();
  inflight = null;
}

export function subscribeBackendStatus(listener: Listener): () => void {
  listeners.add(listener);
  if (listeners.size === 1) start();
  listener(snapshot);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stop();
  };
}

export function useBackendStatus(): Snapshot {
  const [current, setCurrent] = React.useState<Snapshot>(snapshot);
  React.useEffect(() => subscribeBackendStatus(setCurrent), []);
  return current;
}

export function forceBackendPing(): void {
  void tick();
}
