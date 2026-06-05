"use client";

import { useEffect, useMemo, useState } from "react";
import { MapAdBanner } from "@/components/MapAdBanner";
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
            ? "Some systems degraded — entering terminal"
            : "All systems nominal";
    return { done, total, statusLabel };
  }, [results, mapReady]);

  if (!mounted) return null;

  const progressPct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading AERIS terminal"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "1.5rem",
        background: "rgb(var(--aeris-bg))",
        opacity: leaving ? 0 : 1,
        transition: `opacity ${FADE_MS}ms ease`,
        pointerEvents: leaving ? "none" : "auto",
        padding: "1.5rem",
      }}
    >
      <AerisLoadingLogo size="lg" variant="splash" />

      <div
        aria-hidden
        style={{
          position: "fixed",
          right: "1.5rem",
          bottom: "1.5rem",
          zIndex: 1,
          pointerEvents: "none",
        }}
      >
        <AerisCharIllustration size="lg" scale={4} />
      </div>

      <div
        style={{
          position: "fixed",
          top: "1.5rem",
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 1,
          width: "min(640px, calc(100vw - 3rem))",
        }}
      >
        <MapAdBanner />
      </div>

      {/* Determinate progress bar reflecting verified systems. */}
      <div
        style={{
          position: "relative",
          width: 220,
          height: 3,
          overflow: "hidden",
          borderRadius: 999,
          background: "rgb(var(--aeris-elev))",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            width: `${Math.max(progressPct, 6)}%`,
            borderRadius: 999,
            background: "rgb(var(--aeris-accent))",
            transition: "width 320ms ease",
          }}
        />
      </div>

      {/* Single-line status that changes to reflect boot progress. */}
      <div
        aria-live="polite"
        style={{
          fontSize: 12,
          fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
          color: "rgb(var(--aeris-muted))",
          minHeight: "1.2em",
          textAlign: "center",
        }}
      >
        {statusLabel}
      </div>
    </div>
  );
}
