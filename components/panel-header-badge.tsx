"use client";

import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import type { PanelId } from "@/config/panels";

type BadgeStore = Map<PanelId, ReactNode>;

let badges: BadgeStore = new Map();
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return badges;
}

/** Registers a badge for collapsed panel headers and the minimized sidebar rail. */
export function usePanelHeaderBadge(panelId: PanelId, badge: ReactNode) {
  useEffect(() => {
    const next = new Map(badges);
    if (badge != null) next.set(panelId, badge);
    else next.delete(panelId);
    badges = next;
    emit();
    return () => {
      const cleared = new Map(badges);
      cleared.delete(panelId);
      badges = cleared;
      emit();
    };
  }, [panelId, badge]);
}

export function usePanelBadge(panelId: PanelId) {
  const store = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return store.get(panelId) ?? null;
}
