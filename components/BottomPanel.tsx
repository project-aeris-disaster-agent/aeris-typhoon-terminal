"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { clsx } from "clsx";
import type { Map as MLMap } from "maplibre-gl";
import type { SelectedLocation } from "@/components/MapSearchBar";
import { PanelSkeleton } from "@/components/ui/PanelSkeleton";
import type { AgentExplainRequest } from "@/lib/help/agent-explain";

const LiveWebcamsPanel = dynamic(
  () =>
    import("./panels/LiveWebcamsPanel").then((m) => ({
      default: m.LiveWebcamsPanel,
    })),
  { ssr: false, loading: PanelSkeleton },
);

const NewsLivestreamsPanel = dynamic(
  () =>
    import("./panels/NewsLivestreamsPanel").then((m) => ({
      default: m.NewsLivestreamsPanel,
    })),
  { ssr: false, loading: PanelSkeleton },
);

const CommunityChatPanel = dynamic(
  () =>
    import("./panels/CommunityChatPanel").then((m) => ({
      default: m.CommunityChatPanel,
    })),
  { ssr: false, loading: PanelSkeleton },
);

type SubPanel = "webcams" | "news" | "location";

const SUB_PANELS: {
  id: SubPanel;
  label: string;
  hotkey: string;
}[] = [
  { id: "webcams", label: "Live Webcams", hotkey: "A" },
  { id: "news", label: "News Livestreams", hotkey: "B" },
  { id: "location", label: "Agent AERIS", hotkey: "C" },
];

export function BottomPanel({
  map,
  selectedLocation,
  collapsed: collapsedProp,
  onCollapsedChange,
  explainRequest,
}: {
  map?: MLMap | null;
  selectedLocation: SelectedLocation | null;
  /** Controlled Intel Feeds collapse (lifted to page for layout sync). */
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  /** When set, opens the Agent AERIS subpanel and asks AERIS to explain. */
  explainRequest?: AgentExplainRequest | null;
}) {
  const [collapsedInternal, setCollapsedInternal] = useState(true);
  const collapsed = collapsedProp ?? collapsedInternal;
  const setCollapsed = onCollapsedChange ?? setCollapsedInternal;

  const [openPanels, setOpenPanels] = useState<Record<SubPanel, boolean>>({
    webcams: true,
    news: true,
    location: true,
  });

  // An incoming explain request must reveal the Agent AERIS subpanel so the
  // Agent AERIS reply is visible (page un-collapses the bar separately).
  useEffect(() => {
    if (explainRequest) {
      setOpenPanels((prev) => ({ ...prev, location: true }));
    }
  }, [explainRequest]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "0") {
        e.preventDefault();
        setCollapsed(!collapsed);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [collapsed, setCollapsed]);

  const toggleSub = (id: SubPanel) =>
    setOpenPanels((prev) => ({ ...prev, [id]: !prev[id] }));

  const toggleCollapsed = () => setCollapsed(!collapsed);

  return (
    <div
      className={clsx(
        "w-full border-t border-aeris-border bg-aeris-surface/95 backdrop-blur-md transition-[height] duration-300 shadow-[var(--aeris-shadow-up)]",
        collapsed ? "h-8" : "h-[38vh] min-h-[200px] max-h-[500px]",
      )}
    >
      {/* Header bar */}
      <div className="flex items-center justify-between px-3 h-8 border-b border-aeris-border shrink-0 bg-aeris-elev/35">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={toggleCollapsed}
            className="hud-text text-aeris-muted hover:text-aeris-text flex items-center gap-1.5"
            aria-label={collapsed ? "Expand live updates" : "Collapse live updates"}
          >
            <span className="text-chrome text-aeris-accent/70">0</span>
            <span className="text-body-sm font-semibold">
              Live Updates
            </span>
            <span className="text-body-sm ml-1">{collapsed ? "▲" : "▼"}</span>
          </button>

          {!collapsed && (
            <div className="flex gap-1 overflow-x-auto scrollbar-none">
              {SUB_PANELS.map((sp) => (
                <button
                  key={sp.id}
                  type="button"
                  onClick={() => toggleSub(sp.id)}
                  className={clsx(
                    "px-2 py-1 rounded text-body-sm border transition-colors",
                    openPanels[sp.id]
                      ? "bg-aeris-accent/10 border-aeris-accent/30 text-aeris-accent"
                      : "border-aeris-border text-aeris-muted hover:text-aeris-text",
                  )}
                >
                  {sp.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {!collapsed && (
            <span className="text-chrome text-aeris-muted">
              Press 0 to toggle
            </span>
          )}
        </div>
      </div>

      {/* Sub-panel grid — unmounted when collapsed to avoid idle iframes/polling */}
      {!collapsed && (
        <div className="h-[calc(100%-2rem)] overflow-hidden">
          {/* Desktop: horizontal columns; Mobile: vertical stack with overflow scroll */}
          <div className="flex flex-col md:flex-row h-full md:divide-x md:divide-aeris-border overflow-y-auto md:overflow-hidden">
            {SUB_PANELS.map((sp) => (
              <div
                key={sp.id}
                className={clsx(
                  "flex flex-col transition-[opacity,width] duration-200 overflow-hidden",
                  "md:flex-1 md:min-w-0",
                  !openPanels[sp.id] && "md:w-0 md:flex-none",
                  openPanels[sp.id]
                    ? "border-b border-aeris-border md:border-b-0"
                    : "hidden md:block",
                )}
              >
                {openPanels[sp.id] && (
                  <div className="flex-1 overflow-y-auto p-2 min-h-0 md:h-full">
                    {sp.id === "webcams" && (
                      <LiveWebcamsPanel map={map ?? null} />
                    )}
                    {sp.id === "news" && <NewsLivestreamsPanel />}
                    {sp.id === "location" && (
                      <CommunityChatPanel
                        selectedLocation={selectedLocation}
                        explainRequest={explainRequest}
                        isActive={openPanels.location}
                      />
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
