"use client";

import * as React from "react";

import { BRAND } from "@/lib/brand";
import { cn } from "@/lib/utils";

type LogoSize = "sm" | "md" | "lg";
type LogoVariant = "icon" | "horizontal" | "stacked";

export type LogoProps = {
  size?: LogoSize;
  variant?: LogoVariant;
  animated?: boolean;
  className?: string;
  tagline?: string;
};

const ICON_PX: Record<LogoSize, number> = {
  sm: 28,
  md: 48,
  lg: 80,
};

const NAME_CLASS: Record<LogoSize, string> = {
  sm: "text-base font-semibold tracking-tight",
  md: "text-2xl font-semibold tracking-tight",
  lg: "text-4xl font-bold tracking-tight sm:text-5xl",
};

const TAGLINE_CLASS: Record<LogoSize, string> = {
  sm: "text-[10px] text-muted-foreground",
  md: "text-xs text-muted-foreground",
  lg: "text-sm text-muted-foreground",
};

function LampIcon({
  size,
  animated,
  uid,
}: {
  size: number;
  animated: boolean;
  uid: string;
}) {
  const bodyGradId = `sg-logo-body-${uid}`;
  const smokeGradId = `sg-logo-smoke-${uid}`;
  const showSparkles = size >= 32;
  const showSideSmoke = size >= 32;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 80 80"
      role="img"
      aria-label={`${BRAND.name} lamp icon`}
    >
      <defs>
        <linearGradient id={bodyGradId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#6366f1" />
          <stop offset="50%" stopColor="#a855f7" />
          <stop offset="100%" stopColor="#ec4899" />
        </linearGradient>
        <linearGradient id={smokeGradId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#818cf8" />
          <stop offset="100%" stopColor="#c084fc" />
        </linearGradient>
      </defs>

      <g className={animated ? "sg-logo-body" : undefined}>
        <ellipse cx="40" cy="68" rx="28" ry="7" fill="#6366f1" opacity="0.2" />
        <path
          d="M18 61 Q16 46 25 37 Q32 29 40 32 Q48 29 55 37 Q64 46 62 61 Q55 66 40 68 Q25 66 18 61Z"
          fill={`url(#${bodyGradId})`}
        />
        <path
          d="M60 54 Q73 50 75 56 Q73 62 60 60Z"
          fill={`url(#${bodyGradId})`}
        />
        <path
          d="M18 54 Q10 54 10 60 Q10 65 18 63"
          fill="none"
          stroke={`url(#${bodyGradId})`}
          strokeWidth="3.5"
          strokeLinecap="round"
        />
      </g>

      <g className={animated ? "sg-logo-smoke-main" : undefined}>
        <path
          d="M40 32 Q37 22 41 14 Q44 7 39 2"
          fill="none"
          stroke={`url(#${smokeGradId})`}
          strokeWidth="3"
          strokeLinecap="round"
        />
      </g>
      {showSideSmoke && (
        <>
          <g className={animated ? "sg-logo-smoke-left" : undefined}>
            <path
              d="M40 32 Q33 20 36 11 Q38 5 34 0"
              fill="none"
              stroke={`url(#${smokeGradId})`}
              strokeWidth="2"
              strokeLinecap="round"
            />
          </g>
          <g className={animated ? "sg-logo-smoke-right" : undefined}>
            <path
              d="M40 32 Q47 20 44 11 Q42 5 46 0"
              fill="none"
              stroke={`url(#${smokeGradId})`}
              strokeWidth="2"
              strokeLinecap="round"
            />
          </g>
        </>
      )}

      {showSparkles && (
        <>
          <circle
            className={animated ? "sg-logo-sp-1" : undefined}
            cx="28"
            cy="14"
            r="3"
            fill={`url(#${bodyGradId})`}
          />
          <circle
            className={animated ? "sg-logo-sp-2" : undefined}
            cx="52"
            cy="9"
            r="2.5"
            fill="#a855f7"
          />
          <circle
            className={animated ? "sg-logo-sp-3" : undefined}
            cx="39"
            cy="0"
            r="3.5"
            fill={`url(#${bodyGradId})`}
          />
          <circle
            className={animated ? "sg-logo-sp-4" : undefined}
            cx="22"
            cy="5"
            r="2"
            fill="#ec4899"
          />
          <circle
            className={animated ? "sg-logo-sp-5" : undefined}
            cx="56"
            cy="2"
            r="2"
            fill="#6366f1"
          />
        </>
      )}
    </svg>
  );
}

export function Logo({
  size = "md",
  variant = "horizontal",
  animated = true,
  className,
  tagline,
}: LogoProps) {
  const uid = React.useId().replace(/[:]/g, "");
  const px = ICON_PX[size];

  const icon = (
    <span
      className={cn("inline-flex shrink-0", animated && "sg-logo-float")}
      aria-hidden={variant !== "icon" || undefined}
    >
      <LampIcon size={px} animated={animated} uid={uid} />
    </span>
  );

  if (variant === "icon") {
    return <span className={cn("inline-flex", className)}>{icon}</span>;
  }

  const nameEl = (
    <span
      className={cn(
        NAME_CLASS[size],
        animated ? "sg-logo-text" : "brand-gradient",
      )}
    >
      {BRAND.name}
    </span>
  );

  const taglineEl = tagline ? (
    <span className={TAGLINE_CLASS[size]}>{tagline}</span>
  ) : null;

  if (variant === "stacked") {
    return (
      <span
        className={cn(
          "inline-flex flex-col items-center gap-2 text-center",
          className,
        )}
      >
        {icon}
        <span className="flex flex-col items-center gap-1">
          {nameEl}
          {taglineEl}
        </span>
      </span>
    );
  }

  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      {icon}
      <span className="flex flex-col leading-tight">
        {nameEl}
        {taglineEl}
      </span>
    </span>
  );
}

export default Logo;
