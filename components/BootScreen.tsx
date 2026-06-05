"use client";

import { useEffect, useState } from "react";
import { AerisLoadingLogo } from "@/components/ui/AerisLoadingLogo";

/**
 * Cold-start boot screen.
 *
 * Rendered in the root layout so it appears in the server HTML — visible on the
 * very first paint, before hydration and before the (heavy) MapLibre bundle and
 * basemap tiles finish loading. Previously this window showed only a blank map
 * rectangle, which read as "the app is hanging".
 *
 * It dismisses itself when the map paints its first frame (the page dispatches
 * `aeris:boot-ready`), with a hard failsafe timeout so it can never get stuck.
 */
const BOOT_PHASES = [
  "Initializing terminal…",
  "Loading basemap…",
  "Syncing weather layers…",
  "Calibrating hazard overlays…",
  "Establishing live feeds…",
] as const;

/** Never block the UI longer than this, even if the ready signal never fires. */
const FAILSAFE_MS = 12_000;
const PHASE_INTERVAL_MS = 1_400;
const FADE_MS = 450;

export function BootScreen() {
  const [leaving, setLeaving] = useState(false);
  const [mounted, setMounted] = useState(true);
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    let disposed = false;

    const dismiss = () => {
      if (disposed) return;
      setLeaving(true);
      window.setTimeout(() => {
        if (!disposed) setMounted(false);
      }, FADE_MS);
    };

    window.addEventListener("aeris:boot-ready", dismiss, { once: true });
    const failsafe = window.setTimeout(dismiss, FAILSAFE_MS);
    const phaseTimer = window.setInterval(() => {
      setPhase((p) => Math.min(p + 1, BOOT_PHASES.length - 1));
    }, PHASE_INTERVAL_MS);

    return () => {
      disposed = true;
      window.removeEventListener("aeris:boot-ready", dismiss);
      window.clearTimeout(failsafe);
      window.clearInterval(phaseTimer);
    };
  }, []);

  if (!mounted) return null;

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
      }}
    >
      <style>{`
        @keyframes aeris-boot-bar {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(250%); }
        }
        @media (prefers-reduced-motion: reduce) {
          .aeris-boot-bar { animation: none !important; }
        }
      `}</style>

      <AerisLoadingLogo size="lg" variant="splash" pulse />

      <div
        style={{
          textAlign: "center",
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: "0.28em",
          color: "rgb(var(--aeris-muted))",
        }}
      >
        Typhoon Resilience Terminal
      </div>

      {/* Indeterminate progress bar */}
      <div
        style={{
          position: "relative",
          width: 200,
          height: 3,
          overflow: "hidden",
          borderRadius: 999,
          background: "rgb(var(--aeris-elev))",
        }}
      >
        <div
          className="aeris-boot-bar"
          style={{
            position: "absolute",
            inset: 0,
            width: "40%",
            borderRadius: 999,
            background: "rgb(var(--aeris-accent))",
            animation: "aeris-boot-bar 1.1s ease-in-out infinite",
          }}
        />
      </div>

      <div
        style={{
          fontSize: 12,
          fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
          color: "rgb(var(--aeris-muted))",
          minHeight: "1.2em",
        }}
      >
        {BOOT_PHASES[phase]}
      </div>
    </div>
  );
}
