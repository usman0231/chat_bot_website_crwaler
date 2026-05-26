import { cn } from "@/lib/utils";

const base =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 font-medium text-white shadow-sm transition-all hover:shadow-md motion-safe:hover:brightness-110 active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50";

const sizes = {
  sm: "h-8 px-3 text-xs",
  md: "h-10 px-4 text-sm",
  lg: "h-11 px-6 text-base",
} as const;

export function gradientBtn(
  size: keyof typeof sizes = "md",
  extra?: string,
): string {
  return cn(base, sizes[size], extra);
}
