"use client";

import { useEffect, useState } from "react";

/**
 * Tracks last-successful-fetch timestamps per data source for use in HUD
 * freshness badges. Pattern adapted from WorldMonitor's data-freshness
 * service.
 *
 * Event-driven design: subscribers are now notified per-source (not a
 * broadcast), and `useFreshness` only re-renders when its specific source
 * fires `recordSuccess` / `recordFailure` — no more 15s setInterval churn.
 * The age label itself remains correct because `formatAge(lastOk)` is a
 * pure function of Date.now() and is re-computed on the next legitimate
 * render cycle from any source update.
 */

type FreshnessEntry = {
  lastOk: number | null;
  lastError: string | null;
  lastAttempt: number | null;
};

const entries = new Map<string, FreshnessEntry>();
const perSourceListeners = new Map<string, Set<() => void>>();

function notify(source: string) {
  const set = perSourceListeners.get(source);
  if (!set) return;
  for (const l of set) l();
}

export function recordSuccess(source: string) {
  entries.set(source, {
    lastOk: Date.now(),
    lastError: null,
    lastAttempt: Date.now(),
  });
  notify(source);
}

export function recordFailure(source: string, err: string) {
  const cur = entries.get(source) ?? {
    lastOk: null,
    lastError: null,
    lastAttempt: null,
  };
  entries.set(source, {
    lastOk: cur.lastOk,
    lastError: err,
    lastAttempt: Date.now(),
  });
  notify(source);
}

export function getFreshness(source: string): FreshnessEntry | undefined {
  return entries.get(source);
}

export function useFreshness(source: string): FreshnessEntry | undefined {
  const [, setTick] = useState(0);
  useEffect(() => {
    const l = () => setTick((n) => n + 1);
    let set = perSourceListeners.get(source);
    if (!set) {
      set = new Set();
      perSourceListeners.set(source, set);
    }
    set.add(l);
    return () => {
      set!.delete(l);
      if (set!.size === 0) perSourceListeners.delete(source);
    };
  }, [source]);
  return entries.get(source);
}

export function formatAge(ts: number | null | undefined): string {
  if (!ts) return "never";
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export function freshnessTone(
  entry: FreshnessEntry | undefined,
  staleAfterMs = 10 * 60 * 1000,
): "ok" | "warn" | "danger" {
  if (!entry || !entry.lastOk) return "danger";
  const age = Date.now() - entry.lastOk;
  if (age < staleAfterMs) return "ok";
  if (age < staleAfterMs * 3) return "warn";
  return "danger";
}
