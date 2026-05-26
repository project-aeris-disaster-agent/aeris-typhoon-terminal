"use client";

import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import type { Map as MLMap } from "maplibre-gl";
import { clsx } from "clsx";
import { PANELS, type PanelId } from "@/config/panels";
import { LiveWeatherFrameIndicator } from "@/components/LiveWeatherFrameHud";

// On mobile, the sidebar becomes the "Reports" tab. We curate it down to the
// panels that actually help an operator monitor incoming ground reports:
// the live reports list, advisories that explain incoming reports, and the
// active storm context. Everything else (forecast, news, satellite radar)
// is hidden to keep the small screen focused.
const MOBILE_PANEL_IDS: PanelId[] = ["alerts", "typhoon"];

// Dynamic imports: each panel lands in its own async chunk so the initial
// JS bundle only ships the shell + currently-needed panels. Panels are
// client-only, so `ssr: false` skips the SSR render and lets us show a
// lightweight skeleton while the chunk streams in on first open.
const PanelSkeleton = () => (
  <div className="h-16 rounded-md border border-aeris-border bg-aeris-bg/60 px-3 text-[11px] text-aeris-muted inline-flex items-center gap-2">
    <span className="inline-block h-1.5 w-1.5 rounded-full bg-aeris-accent animate-pulse" />
    <span>Loading data, please wait...</span>
  </div>
);

const TyphoonTrackerPanel = dynamic(
  () =>
    import("./panels/TyphoonTrackerPanel").then((m) => ({
      default: m.TyphoonTrackerPanel,
    })),
  { ssr: false, loading: PanelSkeleton },
);
const SatelliteRadarPanel = dynamic(
  () =>
    import("./panels/SatelliteRadarPanel").then((m) => ({
      default: m.SatelliteRadarPanel,
    })),
  { ssr: false, loading: PanelSkeleton },
);
const ForecastPanel = dynamic(
  () =>
    import("./panels/ForecastPanel").then((m) => ({
      default: m.ForecastPanel,
    })),
  { ssr: false, loading: PanelSkeleton },
);
const AlertsFeedPanel = dynamic(
  () =>
    import("./panels/AlertsFeedPanel").then((m) => ({
      default: m.AlertsFeedPanel,
    })),
  { ssr: false, loading: PanelSkeleton },
);
const NewsPanel = dynamic(
  () => import("./panels/NewsPanel").then((m) => ({ default: m.NewsPanel })),
  { ssr: false, loading: PanelSkeleton },
);
const LiveReportsPanel = dynamic(
  () =>
    import("./panels/LiveReportsPanel").then((m) => ({
      default: m.LiveReportsPanel,
    })),
  { ssr: false, loading: PanelSkeleton },
);

export type SidebarProps = {
  map: MLMap | null;
  /** Lets the layout shrink the ops column on mobile when collapsed (avoids a tall empty strip). */
  onCollapsedChange?: (collapsed: boolean) => void;
  /**
   * When true, the sidebar adapts to small screens: it renders a curated,
   * reports-focused stack (Live Reports + Alerts + Typhoon Tracker) and
   * drops desktop chrome (collapse rail, hotkey legend). The desktop
   * (md+) markup is preserved via responsive classes — this prop only
   * changes the mobile behaviour.
   */
  mobileMode?: boolean;
};

export function Sidebar({ map, onCollapsedChange, mobileMode }: SidebarProps) {
  const [open, setOpen] = useState<Record<PanelId, boolean>>(
    () =>
      Object.fromEntries(
        PANELS.map((p) => [p.id, p.defaultOpen]),
      ) as Record<PanelId, boolean>,
  );
  const [collapsed, setCollapsed] = useState(false);

  const togglePanel = useCallback((id: PanelId) => {
    setOpen((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const panel = PANELS.find((p) => p.hotkey === e.key);
      if (panel) {
        e.preventDefault();
        togglePanel(panel.id);
      }
      if (e.key === "\\") {
        setCollapsed((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePanel]);

  useEffect(() => {
    onCollapsedChange?.(collapsed);
  }, [collapsed, onCollapsedChange]);

  // Mobile-focused stack: Live Reports first, then a couple of context
  // panels. This is rendered as its own subtree so the desktop tree is
  // untouched and panel state stays isolated to the active layout.
  if (mobileMode) {
    return (
      <aside className="md:hidden flex flex-col w-full h-full bg-aeris-surface/95 backdrop-blur-md">
        <div className="flex items-center justify-between px-3 py-2 border-b border-aeris-border bg-aeris-elev/35 shrink-0">
          <span className="hud-text text-aeris-muted text-[11px] font-mono uppercase tracking-wider">
            Ground Reports
          </span>
          <LiveWeatherFrameIndicator variant="panel" />
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-0">
          {/* Primary: live ground reports list — embedded so users don't
              need to open the header popover on small screens. */}
          <section className="border border-aeris-border rounded-lg bg-aeris-bg/35 shadow-sm p-2">
            <LiveReportsPanel map={map} embedded />
          </section>
          {MOBILE_PANEL_IDS.map((id) => {
            const def = PANELS.find((p) => p.id === id);
            if (!def) return null;
            return (
              <PanelWrapper
                key={def.id}
                id={def.id}
                label={def.label}
                hotkey={def.hotkey}
                open={open[def.id]}
                onToggle={() => togglePanel(def.id)}
              >
                <PanelBody id={def.id} map={map} />
              </PanelWrapper>
            );
          })}
        </div>
      </aside>
    );
  }

  return (
    <aside
      className={clsx(
        "hidden md:flex flex-col md:border-l border-aeris-border bg-aeris-surface/95 backdrop-blur-md transition-[width] shadow-sm",
        // Mutually exclusive widths: both md:w-[360px] and md:w-10 would compile
        // with equal specificity — the wider rule can win and block minimize.
        "w-full",
        collapsed ? "md:w-10" : "md:w-[360px]",
        collapsed ? "h-auto md:h-full" : "h-full",
      )}
    >
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-aeris-border bg-aeris-elev/35">
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="hud-text text-aeris-muted hover:text-aeris-text px-2 py-0.5"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? "»" : "«"}
        </button>
        {!collapsed && (
          <span className="hud-text text-aeris-muted">Ops Panels</span>
        )}
      </div>

      {/*
        Hotkey strip shown when collapsed. It overlays the panel list
        rather than replacing it so the panels below stay mounted and
        preserve their internal state + in-flight data across collapse
        cycles.
      */}
      {collapsed && (
        <div className="flex flex-col items-center py-2 gap-1">
          {PANELS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                setCollapsed(false);
                if (!open[p.id]) togglePanel(p.id);
              }}
              className={clsx(
                "w-7 h-7 rounded flex items-center justify-center font-mono text-[10px] border",
                open[p.id]
                  ? "bg-aeris-accent/10 text-aeris-accent border-aeris-accent/30"
                  : "border-aeris-border text-aeris-muted hover:text-aeris-text",
              )}
              title={p.label}
            >
              {p.hotkey}
            </button>
          ))}
        </div>
      )}

      {/*
        Panel list is ALWAYS mounted; we toggle visibility via CSS so
        each panel keeps its state, intervals, and last-fetched data
        across collapse/expand. Previously we used a conditional render
        here which unmounted every panel on collapse and caused a
        re-fetch storm on every expand.
      */}
      <div
        className={clsx(
          "flex-1 overflow-y-auto p-2 space-y-2",
          collapsed && "hidden",
        )}
        aria-hidden={collapsed}
      >
        {PANELS.map((p) => (
          <PanelWrapper
            key={p.id}
            id={p.id}
            label={p.label}
            hotkey={p.hotkey}
            open={open[p.id]}
            onToggle={() => togglePanel(p.id)}
          >
            <PanelBody id={p.id} map={map} />
          </PanelWrapper>
        ))}
      </div>
    </aside>
  );
}

function PanelWrapper({
  id,
  label,
  hotkey,
  open,
  onToggle,
  children,
}: {
  id: PanelId;
  label: string;
  hotkey: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="border border-aeris-border rounded-lg bg-aeris-bg/35 shadow-sm">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-2 py-1.5 hud-text text-aeris-muted hover:bg-aeris-elev/40 hover:text-aeris-text transition-colors"
        aria-expanded={open}
        aria-controls={`panel-${id}`}
      >
        <span className="flex shrink-0 items-center gap-2">
          <span className="text-[10px] font-mono text-aeris-accent/70 w-3">
            {hotkey}
          </span>
          <span>{label}</span>
        </span>
        {id === "satellite" && (
          <LiveWeatherFrameIndicator variant="panel" />
        )}
        <span className="ml-auto shrink-0 text-[10px]">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div id={`panel-${id}`} className="px-2 pb-2">
          {children}
        </div>
      )}
    </section>
  );
}

function PanelBody({ id, map }: { id: PanelId; map: MLMap | null }) {
  switch (id) {
    case "typhoon":
      return <TyphoonTrackerPanel map={map} />;
    case "satellite":
      return <SatelliteRadarPanel map={map} />;
    case "forecast":
      return <ForecastPanel />;
    case "alerts":
      return <AlertsFeedPanel />;
    case "news":
      return <NewsPanel />;
    default:
      return null;
  }
}
