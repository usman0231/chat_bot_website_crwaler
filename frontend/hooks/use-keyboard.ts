"use client";

import * as React from "react";

export type ShortcutOptions = {
  meta?: boolean; // cmd on macOS, ctrl on others
  shift?: boolean;
  alt?: boolean;
  /**
   * If true, fires even when focus is inside an input / textarea / contentEditable.
   * Defaults to false so "/" and similar bare keys don't hijack typing.
   */
  allowInInput?: boolean;
  enabled?: boolean;
};

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return false;
}

/**
 * Subscribe to a single keyboard shortcut. `key` is matched case-insensitively
 * against `event.key`. Pass options for modifiers and behavior in inputs.
 */
export function useKeyboard(
  key: string,
  callback: (e: KeyboardEvent) => void,
  options: ShortcutOptions = {},
): void {
  const cbRef = React.useRef(callback);
  React.useEffect(() => {
    cbRef.current = callback;
  });

  const {
    meta = false,
    shift = false,
    alt = false,
    allowInInput = false,
    enabled = true,
  } = options;

  React.useEffect(() => {
    if (!enabled) return;

    const handler = (e: KeyboardEvent) => {
      // Autofill and IME composition dispatch synthetic keydown events with
      // no `key` — guard before calling string methods on it.
      if (!e.key) return;
      if (e.key.toLowerCase() !== key.toLowerCase()) return;

      const wantMeta = meta;
      const hasMeta = e.metaKey || e.ctrlKey;
      if (wantMeta !== hasMeta) return;
      if (shift !== e.shiftKey) return;
      if (alt !== e.altKey) return;

      if (!allowInInput && isTypingTarget(e.target)) return;

      cbRef.current(e);
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [key, meta, shift, alt, allowInInput, enabled]);
}

/**
 * Two-key sequence shortcut, e.g. "g d" (press g, then d within `windowMs`).
 * The sequence is cancelled if focus is in a typing element.
 */
export function useKeySequence(
  first: string,
  second: string,
  callback: (e: KeyboardEvent) => void,
  windowMs = 700,
  enabled = true,
): void {
  const cbRef = React.useRef(callback);
  React.useEffect(() => {
    cbRef.current = callback;
  });

  React.useEffect(() => {
    if (!enabled) return;
    let armedAt: number | null = null;

    const handler = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) {
        armedAt = null;
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) {
        armedAt = null;
        return;
      }
      if (!e.key) {
        armedAt = null;
        return;
      }
      const k = e.key.toLowerCase();
      if (armedAt !== null && k === second.toLowerCase()) {
        if (Date.now() - armedAt <= windowMs) {
          armedAt = null;
          cbRef.current(e);
          return;
        }
      }
      if (k === first.toLowerCase()) {
        armedAt = Date.now();
      } else {
        armedAt = null;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [first, second, windowMs, enabled]);
}
