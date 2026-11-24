"use client";

/**
 * One shared poll of /api/relief/operations for the Relief Ops panel and the
 * map pins. Polls only while something is subscribed, and skips ticks while
 * the tab is hidden (ReQuest counts are cached server-side for 60 s anyway).
 */

import { useSyncExternalStore } from "react";
import type { ReliefOperationView, ReliefSiteView } from "@/lib/relief-ops";

export type { ReliefOperationView, ReliefSiteView };

export type ReliefOpsPayload = {
  configured: { store: boolean; request: boolean };
  operations: ReliefOperationView[];
  fetchedAt: string;
};

export type ReliefOpsState = {
  status: "idle" | "loading" | "ready" | "error";
  data: ReliefOpsPayload | null;
  error: string | null;
};

const POLL_MS = 60_000;

let state: ReliefOpsState = { status: "idle", data: null, error: null };
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let inFlight: Promise<void> | null = null;

function setState(next: Partial<ReliefOpsState>) {
  state = { ...state, ...next };
  for (const l of listeners) l();
}

export function refreshReliefOps(): Promise<void> {
  if (inFlight) return inFlight;
  if (state.status === "idle") setState({ status: "loading" });
  inFlight = (async () => {
    try {
      const res = await fetch("/api/relief/operations", { cache: "no-store" });
      const body = (await res.json().catch(() => null)) as
        | (ReliefOpsPayload & { error?: string })
        | null;
      if (!res.ok || !body || !Array.isArray(body.operations)) {
        throw new Error(body?.error ?? `Relief data failed to load (${res.status}).`);
      }
      setState({ status: "ready", data: body, error: null });
    } catch (err) {
      // Keep the last good board on screen; just flag the failure.
      setState({
        status: state.data ? "ready" : "error",
        error: err instanceof Error ? err.message : "Relief data failed to load.",
      });
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    void refreshReliefOps();
    timer = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      void refreshReliefOps();
    }, POLL_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

const getSnapshot = () => state;
const SERVER_STATE: ReliefOpsState = { status: "idle", data: null, error: null };

export function useReliefOps(): ReliefOpsState {
  return useSyncExternalStore(subscribe, getSnapshot, () => SERVER_STATE);
}

/** Share of issued passes already claimed, 0–1; null when nothing is issued. */
export function servedRatio(counts: { issued: number; claimed: number } | null): number | null {
  if (!counts || counts.issued <= 0) return null;
  return Math.min(1, Math.max(0, counts.claimed / counts.issued));
}
