"use client";

import type { RefObject } from "react";
import dynamic from "next/dynamic";
import { clsx } from "clsx";
import type { Map as MLMap } from "maplibre-gl";
import { PanelSkeleton } from "@/components/ui/PanelSkeleton";

const LiveReportsPanel = dynamic(
  () =>
    import("./panels/LiveReportsPanel").then((m) => ({
      default: m.LiveReportsPanel,
    })),
  { ssr: false, loading: PanelSkeleton },
);

export type LiveReportsMapOverlayProps = {
  open: boolean;
  onClose: () => void;
  map: MLMap | null;
  popoverRef: RefObject<HTMLDivElement>;
};

export function LiveReportsMapOverlay({
  open,
  onClose,
  map,
  popoverRef,
}: LiveReportsMapOverlayProps) {
  if (!open) return null;

  return (
    <div
      ref={popoverRef}
      id="live-reports-popover"
      role="dialog"
      aria-label="Live reports"
      className={clsx(
        "absolute right-3 top-1.5 z-50 w-[min(calc(100vw-1rem),380px)]",
        "max-h-[min(85vh,calc(100vh-3rem))] overflow-hidden rounded-md border border-aeris-border",
        "bg-aeris-surface/98 shadow-xl backdrop-blur-md",
        "flex flex-col pointer-events-auto",
      )}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-aeris-border px-2 py-1.5">
        <span className="hud-text text-[11px] text-aeris-muted font-mono">
          Live Reports
        </span>
        <button
          type="button"
          onClick={onClose}
          className="hud-text rounded px-2 py-0.5 text-aeris-muted hover:bg-aeris-bg hover:text-aeris-text"
          aria-label="Close live reports"
        >
          ✕
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto bg-aeris-bg/80 p-2">
        <LiveReportsPanel map={map} embedded />
      </div>
    </div>
  );
}
