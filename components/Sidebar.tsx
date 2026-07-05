"use client";

import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import type { Map as MLMap } from "maplibre-gl";
import { clsx } from "clsx";
import { PANELS, SIDEBAR_PANELS, type PanelId } from "@/config/panels";
import { LiveWeatherFrameIndicator } from "@/components/LiveWeatherFrameHud";
import { PanelSkeleton } from "@/components/ui/PanelSkeleton";
import { HelpHint } from "@/components/ui/HelpTooltip";
import type { HelpId } from "@/config/help-content";
import {
  usePanelBadge,
} from "@/components/panel-header-badge";
import { PanelIcon } from "@/components/PanelIcon";
import { BAGYO_LOGO, SIDEBAR_AD_GIF } from "@/lib/aeris-brand-assets";

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
const TyphoonTrackerPanel = dynamic(
  () =>
    import("./panels/TyphoonTrackerPanel").then((m) => ({
      default: m.TyphoonTrackerPanel,
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
        SIDEBAR_PANELS.map((p) => [p.id, p.defaultOpen]),
      ) as Record<PanelId, boolean>,
  );
  const [collapsed, setCollapsed] = useState(false);

  const togglePanel = useCallback((id: PanelId) => {
    setOpen((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const panel = SIDEBAR_PANELS.find((p) => p.hotkey === e.key);
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
      <aside className="md:hidden flex flex-col w-full h-full bg-aeris-surface/98">
        <div className="flex items-center justify-between px-3 py-2 border-b border-aeris-border bg-aeris-elev/35 shrink-0">
          <span className="hud-text text-aeris-muted">
            Ground reports
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
              <PanelSection
                key={def.id}
                id={def.id}
                label={def.label}
                hotkey={def.hotkey}
                open={open[def.id]}
                onToggle={() => togglePanel(def.id)}
                map={map}
              />
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
        // Tablets get a narrower ops column so the map keeps usable width
        // (iPad portrait is only 768px total); full width from xl up.
        collapsed ? "md:w-10" : "md:w-[320px] xl:w-[380px]",
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
          <span className="hud-text text-aeris-muted">Weather & Alerts</span>
        )}
      </div>

      {/*
        Hotkey strip shown when collapsed. It overlays the panel list
        rather than replacing it so the panels below stay mounted and
        preserve their internal state + in-flight data across collapse
        cycles.
      */}
      {collapsed && (
        <div className="flex flex-col items-center py-2 gap-1.5">
          {SIDEBAR_PANELS.map((p) => (
            <CollapsedPanelRailButton
              key={p.id}
              id={p.id}
              hotkey={p.hotkey}
              label={p.label}
              active={open[p.id]}
              onClick={() => {
                setCollapsed(false);
                if (!open[p.id]) togglePanel(p.id);
              }}
            />
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
        <div className="flex justify-center px-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={BAGYO_LOGO}
            alt="bagyo.app — powered by A.E.R.I.S."
            className="w-[40%] h-auto object-contain"
          />
        </div>
        <div className="px-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={SIDEBAR_AD_GIF}
            alt="Report. Respond. Rebuild. Together."
            className="w-full h-auto object-contain rounded-lg"
            draggable={false}
          />
        </div>
        {SIDEBAR_PANELS.map((p) => (
          <PanelSection
            key={p.id}
            id={p.id}
            label={p.label}
            hotkey={p.hotkey}
            open={open[p.id]}
            onToggle={() => togglePanel(p.id)}
            map={map}
          />
        ))}
      </div>
    </aside>
  );
}

function PanelSection({
  id,
  label,
  hotkey,
  open,
  onToggle,
  map,
}: {
  id: PanelId;
  label: string;
  hotkey: string;
  open: boolean;
  onToggle: () => void;
  map: MLMap | null;
}) {
  return (
    <PanelWrapper
      id={id}
      label={label}
      hotkey={hotkey}
      open={open}
      onToggle={onToggle}
    >
      <PanelBody id={id} map={map} />
    </PanelWrapper>
  );
}

function CollapsedPanelRailButton({
  id,
  hotkey,
  label,
  active,
  onClick,
}: {
  id: PanelId;
  hotkey: string;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  const badge = usePanelBadge(id);
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "w-8 rounded flex flex-col items-center justify-center gap-0.5 py-1 text-chrome border",
        active
          ? "bg-aeris-accent/10 text-aeris-accent border-aeris-accent/30"
          : "border-aeris-border text-aeris-muted hover:text-aeris-text",
      )}
      title={`${label} (${hotkey})`}
      aria-label={`${label} (${hotkey})`}
    >
      <PanelIcon id={id} size={14} />
      {badge ? (
        <span className="max-w-full scale-[0.9] origin-center [&_span]:!px-1 [&_span]:!py-0 [&_span]:!text-chrome [&_span]:truncate [&_span]:max-w-[30px] [&_span]:block">
          {badge}
        </span>
      ) : null}
    </button>
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
  const badge = usePanelBadge(id);

  return (
    <section className="border border-aeris-border rounded-lg bg-aeris-bg/35 shadow-sm">
      <div className="flex items-center hud-text text-aeris-muted">
        <button
          type="button"
          onClick={onToggle}
          className="flex flex-1 items-center gap-2 min-w-0 px-2 py-1.5 hover:bg-aeris-elev/40 hover:text-aeris-text transition-colors rounded-l-lg"
          aria-expanded={open}
          aria-controls={`panel-${id}`}
          title={`${label} (${hotkey})`}
        >
          <span className="flex shrink-0 items-center gap-2 min-w-0">
            <PanelIcon id={id} />
            <span className="truncate">{label}</span>
          </span>
          {!open && badge ? (
            <span className="ml-auto shrink-0">{badge}</span>
          ) : null}
          <span className={clsx("shrink-0 text-body-sm", !open && badge && "ml-1")}>
            {open ? "−" : "+"}
          </span>
        </button>
        <span className="px-2">
          <HelpHint helpId={`panel.${id}` as HelpId} side="left" />
        </span>
      </div>
      {/*
        Keep panel bodies mounted while collapsed so data polling continues
        and header badges stay current (same pattern as sidebar collapse).
      */}
      <div
        id={`panel-${id}`}
        className={clsx("px-2 pb-2", !open && "hidden")}
        aria-hidden={!open}
      >
        {children}
      </div>
    </section>
  );
}

function PanelBody({ id, map }: { id: PanelId; map: MLMap | null }) {
  switch (id) {
    case "typhoon":
      return <TyphoonTrackerPanel map={map} />;
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
