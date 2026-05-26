"use client";

import { useRouter } from "next/navigation";

import { useKeySequence } from "@/hooks/use-keyboard";

export function GlobalShortcuts() {
  const router = useRouter();
  useKeySequence("g", "d", () => router.push("/dashboard"));
  useKeySequence("g", "h", () => router.push("/"));
  return null;
}
