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
import { HotkeyCap } from "@/components/ui/Kit";
import { ChevronDown, ChevronsLeft, ChevronsRight } from "lucide-react";
import { SIDEBAR_AD_GIF } from "@/lib/aeris-brand-assets";
import { shouldIgnoreHotkey } from "@/lib/hotkeys";

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
const ReliefOpsPanel = dynamic(
  () =>
    import("./panels/ReliefOpsPanel").then((m) => ({
      default: m.ReliefOpsPanel,
    })),
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
      if (shouldIgnoreHotkey(e)) return;
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
      <aside className="aeris-sky md:hidden flex flex-col w-full h-full">
        <div className="flex items-center justify-between px-3 py-2.5 shrink-0">
          <span className="aeris-title">Ground reports</span>
          <LiveWeatherFrameIndicator variant="panel" />
        </div>
        <div className="flex-1 overflow-y-auto px-2.5 pb-3 space-y-2.5 min-h-0">
          {/* Primary: live ground reports list — embedded so users don't
              need to open the header popover on small screens. */}
          <section className="panel-glass rounded-xl p-2.5">
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
      data-tour="alerts"
      className={clsx(
        // FLOOD CONTROL drawer: no docked edge, just floating glass cards on the sky.
        "aeris-sky hidden md:flex flex-col transition-[width]",
        // Mutually exclusive widths: both md:w-[360px] and md:w-10 would compile
        // with equal specificity — the wider rule can win and block minimize.
        "w-full",
        // Tablets get a narrower ops column so the map keeps usable width
        // (iPad portrait is only 768px total); full width from xl up.
        collapsed ? "md:w-[4.5rem]" : "md:w-[320px] xl:w-[380px]",
        collapsed ? "h-auto md:h-full" : "h-full",
      )}
    >
      <div
        className={clsx(
          "flex items-center gap-2 px-2.5 pt-2.5 pb-1.5",
          collapsed ? "justify-center" : "justify-between",
        )}
      >
        {!collapsed && <span className="aeris-title pl-1">Weather &amp; Alerts</span>}
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="aeris-round !h-8 !min-w-8 !px-0"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand (\\)" : "Collapse (\\)"}
        >
          {collapsed ? (
            <ChevronsLeft size={15} aria-hidden />
          ) : (
            <ChevronsRight size={15} aria-hidden />
          )}
        </button>
      </div>

      {/*
        Hotkey strip shown when collapsed. It overlays the panel list
        rather than replacing it so the panels below stay mounted and
        preserve their internal state + in-flight data across collapse
        cycles.
      */}
      {collapsed && (
        <div className="panel-glass mx-2 mt-1 flex flex-col items-stretch gap-1 rounded-xl p-1.5">
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
          "flex-1 overflow-y-auto px-2.5 pb-3 pt-1 space-y-2.5",
          collapsed && "hidden",
        )}
        aria-hidden={collapsed}
      >
        <div className="panel-glass flex flex-col items-center gap-2 rounded-xl px-3 pb-3 pt-3.5">
          <span
            role="img"
            aria-label="bagyo.app — powered by A.E.R.I.S."
            className="aeris-brand-mark w-[46%]"
          />
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
  // The game's left rail (`.sh-rail-btn`): icon over a short label, hotkey cap
  // in the corner, active state in the chip blue.
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "relative flex w-full flex-col items-center justify-center gap-0.5 rounded-lg px-1 pb-1.5 pt-2 text-[0.625rem] font-extrabold transition-colors",
        active
          ? "bg-aeris-chip-on text-aeris-kicker-ink"
          : "text-aeris-ink2 hover:bg-aeris-elev hover:text-aeris-accent",
      )}
      title={`${label} (${hotkey})`}
      aria-label={`${label} (${hotkey})`}
    >
      <HotkeyCap className="absolute left-0.5 top-0.5 !h-3.5 !min-w-3.5 !text-[0.5625rem]">
        {hotkey}
      </HotkeyCap>
      <PanelIcon id={id} size={17} className="!text-current" />
      <span className="max-w-full truncate leading-tight">
        {label.split(" ")[0]}
      </span>
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
    // Game panel card (`.hud-panel` + `.hud-h`): glass, 18px radius, spaced-caps
    // title with an icon tile, hotkey cap and a chevron instead of "+/−".
    <section className="panel-glass rounded-xl">
      <div className="flex items-center">
        <button
          type="button"
          onClick={onToggle}
          className="group flex flex-1 items-center gap-2.5 min-w-0 rounded-l-xl py-2 pl-2.5 pr-1.5 text-left"
          aria-expanded={open}
          aria-controls={`panel-${id}`}
          title={`${label} (${hotkey})`}
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-aeris-kicker text-aeris-kicker-ink">
            <PanelIcon id={id} size={15} className="!text-current" />
          </span>
          <span className="aeris-title truncate group-hover:text-aeris-accent">
            {label}
          </span>
          <HotkeyCap className="shrink-0">{hotkey}</HotkeyCap>
          {!open && badge ? (
            <span className="ml-auto shrink-0">{badge}</span>
          ) : null}
          <ChevronDown
            size={16}
            aria-hidden
            className={clsx(
              "shrink-0 text-aeris-muted transition-transform group-hover:text-aeris-accent",
              !(!open && badge) && "ml-auto",
              open && "rotate-180",
            )}
          />
        </button>
        <span className="pr-2.5">
          <HelpHint helpId={`panel.${id}` as HelpId} side="left" />
        </span>
      </div>
      {/*
        Keep panel bodies mounted while collapsed so data polling continues
        and header badges stay current (same pattern as sidebar collapse).
      */}
      <div
        id={`panel-${id}`}
        className={clsx(
          "mx-2.5 border-t border-aeris-border/70 pb-2.5 pt-2",
          !open && "hidden",
        )}
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
    case "relief":
      return <ReliefOpsPanel map={map} />;
    default:
      return null;
  }
}
