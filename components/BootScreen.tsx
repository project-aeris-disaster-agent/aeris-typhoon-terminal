"use client";

import { useEffect, useMemo, useState } from "react";
import { clsx } from "clsx";
import { MapAdBanner } from "@/components/MapAdBanner";
import { Kicker } from "@/components/ui/Kit";
import {
  AerisCharIllustration,
  AerisLoadingLogo,
} from "@/components/ui/AerisLoadingLogo";
import {
  initialPreflightResults,
  runPreflightChecks,
  type CheckStatus,
  type PreflightResult,
} from "@/lib/preflight-checks";

/**
 * Cold-start boot screen.
 *
 * Rendered in the root layout so it appears in the server HTML — visible on the
 * very first paint, before hydration and before the (heavy) MapLibre bundle and
 * basemap tiles finish loading. Previously this window showed only a blank map
 * rectangle, which read as "the app is hanging".
 *
 * While it is up, it runs a live preflight sweep of every overlay/feature data
 * source (report pings, radar, satellite, flood, buildings, wind, typhoon,
 * water levels, live feeds, core system) so the user can see the stack is
 * verified before the terminal is revealed.
 *
 * It only dismisses once BOTH the map has painted its first frame (the page
 * dispatches `aeris:boot-ready`) AND every preflight check has settled — with a
 * hard failsafe timeout so it can never get stuck.
 */

/**
 * Never block the UI longer than this, even if a signal never fires. Must
 * exceed the render-gated overlay timeout (`GATE_TIMEOUT_MS`) so report pings,
 * radar and satellite get their full window to load before we give up.
 */
const FAILSAFE_MS = 18_000;
const FADE_MS = 450;

/** Overlays the boot screen hard-waits on before revealing the terminal. */
const GATE_OVERLAY_IDS = ["reports", "radar", "satellite"] as const;

export function BootScreen() {
  const [leaving, setLeaving] = useState(false);
  const [mounted, setMounted] = useState(true);
  const [mapReady, setMapReady] = useState(false);
  const [checksSettled, setChecksSettled] = useState(false);
  const [results, setResults] = useState<PreflightResult[]>(
    initialPreflightResults,
  );

  // Listen for the map's first-paint signal.
  useEffect(() => {
    const onReady = () => setMapReady(true);
    window.addEventListener("aeris:boot-ready", onReady, { once: true });
    return () => window.removeEventListener("aeris:boot-ready", onReady);
  }, []);

  // Run the overlay/feature preflight sweep.
  useEffect(() => {
    let disposed = false;
    void runPreflightChecks((next) => {
      if (!disposed) setResults(next);
    }).finally(() => {
      if (!disposed) setChecksSettled(true);
    });
    return () => {
      disposed = true;
    };
  }, []);

  // Dismiss once the map has painted AND every check has settled, or after the
  // failsafe — whichever comes first.
  useEffect(() => {
    let disposed = false;
    const dismiss = () => {
      if (disposed) return;
      setLeaving(true);
      window.setTimeout(() => {
        if (!disposed) setMounted(false);
      }, FADE_MS);
    };

    const failsafe = window.setTimeout(dismiss, FAILSAFE_MS);
    if (mapReady && checksSettled) dismiss();

    return () => {
      disposed = true;
      window.clearTimeout(failsafe);
    };
  }, [mapReady, checksSettled]);

  const { done, total, statusLabel } = useMemo(() => {
    const total = results.length;
    const isSettled = (s: CheckStatus) =>
      s === "ok" || s === "warn" || s === "fail";
    const done = results.filter((r) => isSettled(r.status)).length;
    const hasFail = results.some((r) => r.status === "fail");

    // Report pings + radar + satellite must load before we proceed.
    const gatePending = results.some(
      (r) =>
        (GATE_OVERLAY_IDS as readonly string[]).includes(r.id) &&
        !isSettled(r.status),
    );

    const statusLabel = !mapReady
      ? "Loading basemap…"
      : gatePending
        ? "Loading map overlays…"
        : done < total
          ? `Verifying data feeds… ${done}/${total}`
          : hasFail
            ? "Some systems degraded — opening dashboard…"
            : "All systems nominal";
    return { done, total, statusLabel };
  }, [results, mapReady]);

  if (!mounted) return null;

  const progressPct = total > 0 ? Math.round((done / total) * 100) : 0;

  // FLOOD CONTROL loading screen: sky gradient, one frosted card, a chunky
  // track-and-fill bar, and a chip per data feed so the wait reads as progress.
  return (
    <div
      role="status"
      aria-label="Loading AERIS dashboard"
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-boot-sky p-6"
      style={{
        opacity: leaving ? 0 : 1,
        transition: `opacity ${FADE_MS}ms ease`,
        pointerEvents: leaving ? "none" : "auto",
      }}
    >
      <div
        aria-hidden
        className="pointer-events-none fixed bottom-0 right-6 z-[1] max-md:hidden"
      >
        <AerisCharIllustration size="lg" scale={4} />
      </div>

      <div className="fixed left-1/2 top-6 z-[1] w-[min(640px,calc(100vw-3rem))] -translate-x-1/2 overflow-hidden rounded-xl shadow-pill">
        <MapAdBanner />
      </div>

      <div className="panel-glass aeris-rise relative z-[2] flex w-[min(25rem,100%)] flex-col gap-4 rounded-3xl !shadow-hero px-7 pb-6 pt-7">
        <Kicker className="self-start">Philippines · Disaster dashboard</Kicker>

        <div className="flex items-center gap-3">
          <AerisLoadingLogo size="md" variant="glyph" className="shrink-0" />
          <div className="min-w-0">
            <h1 className="aeris-title-fill aeris-wave pb-2 text-[2.5rem] font-black leading-[0.95] tracking-[0.015em]">
              A.E.R.I.S.
            </h1>
            <p className="mt-1 text-body-sm font-bold text-aeris-ink2">
              Disaster reporting terminal
            </p>
          </div>
        </div>

        {/* Determinate progress: verified systems. */}
        <div>
          <div
            className="h-2 w-full overflow-hidden rounded-full bg-aeris-text/10"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={done}
            aria-label="Data feeds verified"
          >
            <div
              className="h-full rounded-full bg-gradient-to-r from-aeris-accent2 to-aeris-accent"
              style={{
                width: `${Math.max(progressPct, 6)}%`,
                transition: "width 320ms ease",
              }}
            />
          </div>
          <div
            aria-live="polite"
            className="mt-2 flex min-h-[1.2em] items-center justify-between gap-3 text-body-sm font-bold text-aeris-ink2"
          >
            <span className="truncate">{statusLabel}</span>
            <span className="shrink-0 tabular-nums text-aeris-muted">
              {done}/{total}
            </span>
          </div>
        </div>

        <ul className="flex flex-wrap gap-1.5" aria-label="Data feed checks">
          {results.map((r) => (
            <li
              key={r.id}
              className="inline-flex items-center gap-1.5 rounded-full border border-aeris-border bg-aeris-surface px-2.5 py-1 text-[0.6875rem] font-extrabold text-aeris-ink2"
            >
              <span
                aria-hidden
                className={clsx(
                  "h-1.5 w-1.5 rounded-full",
                  r.status === "ok" && "bg-aeris-live",
                  r.status === "warn" && "bg-aeris-warm",
                  r.status === "fail" && "bg-aeris-danger",
                  (r.status === "pending" || r.status === "running") &&
                    "animate-pulse bg-aeris-muted/50",
                )}
              />
              {r.label}
              <span className="sr-only">: {r.status}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
