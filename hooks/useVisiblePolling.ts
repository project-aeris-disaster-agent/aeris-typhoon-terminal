"use client";

import { useEffect, useRef } from "react";

export type UseVisiblePollingOptions = {
  /** When false, the poll is fully disabled (no immediate call, no interval). */
  enabled?: boolean;
  /**
   * Run the callback once immediately when polling (re)starts — on mount and
   * each time the tab returns to the foreground. Defaults to true.
   */
  immediate?: boolean;
};

/**
 * Polls `callback` every `intervalMs`, but pauses entirely while the tab is
 * hidden (`document.visibilityState === "hidden"`) and resumes — firing once
 * immediately — when it becomes visible again.
 *
 * Background tabs are the single biggest source of wasted serverless
 * invocations on free tiers: a pinned-but-unwatched dashboard would otherwise
 * keep hitting polled API routes all day. Gating on visibility cuts those
 * invocations roughly in proportion to background time.
 *
 * The callback is held in a ref so changing it between renders does not reset
 * the interval; only `intervalMs`/`enabled` restart the loop.
 */
export function useVisiblePolling(
  callback: () => void,
  intervalMs: number,
  options: UseVisiblePollingOptions = {},
): void {
  const { enabled = true, immediate = true } = options;
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (!enabled || intervalMs <= 0) return;

    let intervalId: number | null = null;

    const stop = () => {
      if (intervalId !== null) {
        window.clearInterval(intervalId);
        intervalId = null;
      }
    };

    const start = (runNow: boolean) => {
      if (intervalId !== null) return;
      if (runNow) callbackRef.current();
      intervalId = window.setInterval(() => callbackRef.current(), intervalMs);
    };

    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        stop();
      } else {
        // Returning to the foreground: refresh immediately, then resume.
        start(true);
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);

    if (document.visibilityState !== "hidden") {
      start(immediate);
    }

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      stop();
    };
  }, [enabled, intervalMs, immediate]);
}
