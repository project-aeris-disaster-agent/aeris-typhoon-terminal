"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { clsx } from "clsx";
import { ChevronUp } from "lucide-react";
import type { Map as MLMap } from "maplibre-gl";
import type { SelectedLocation } from "@/components/MapSearchBar";
import { PanelSkeleton } from "@/components/ui/PanelSkeleton";
import type { AgentExplainRequest } from "@/lib/help/agent-explain";
import { shouldIgnoreHotkey } from "@/lib/hotkeys";

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
      if (shouldIgnoreHotkey(e)) return;
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
      data-tour="live-updates"
      className={clsx(
        "w-full bg-aeris-surface transition-[height] duration-300 shadow-[var(--aeris-shadow-up)]",
        collapsed ? "h-10" : "h-[38vh] min-h-[200px] max-h-[500px]",
      )}
    >
      {/* Header bar: the game's dark navy bar (music player / time controls). */}
      <div className="aeris-navy-bar flex items-center justify-between px-3 h-10 shrink-0 !shadow-none">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={toggleCollapsed}
            className="flex shrink-0 items-center gap-2 rounded-full py-1 pl-1 pr-3 text-white/90 transition-colors hover:bg-white/10 hover:text-white"
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Expand live updates" : "Collapse live updates"}
          >
            <span className="aeris-key !bg-white/15 !text-white/80">0</span>
            <span className="aeris-live-dot" aria-hidden />
            <span className="text-[0.6875rem] font-black uppercase tracking-[0.16em]">
              Live updates
            </span>
            <ChevronUp
              size={15}
              aria-hidden
              className={clsx("transition-transform", !collapsed && "rotate-180")}
            />
          </button>

          {!collapsed && (
            <div className="flex gap-1 overflow-x-auto scrollbar-none">
              {SUB_PANELS.map((sp) => (
                <button
                  key={sp.id}
                  type="button"
                  onClick={() => toggleSub(sp.id)}
                  aria-pressed={openPanels[sp.id]}
                  className={clsx(
                    "shrink-0 rounded-full px-3 py-1 text-[0.8125rem] font-extrabold transition-colors",
                    openPanels[sp.id]
                      ? "bg-white text-aeris-navy"
                      : "bg-white/10 text-white/85 hover:bg-white/20 hover:text-white",
                  )}
                >
                  {sp.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {!collapsed && (
            <span className="text-[0.6875rem] font-bold text-white/60">
              Press 0 to toggle
            </span>
          )}
        </div>
      </div>

      {/* Sub-panel grid — unmounted when collapsed to avoid idle iframes/polling */}
      {!collapsed && (
        <div className="h-[calc(100%-2.5rem)] overflow-hidden">
          {/* Desktop: horizontal columns; Mobile: vertical stack with overflow
              scroll. Tablets keep the columns but enforce a minimum width per
              open column and scroll horizontally instead of crushing them. */}
          <div className="flex flex-col md:flex-row h-full md:divide-x md:divide-aeris-border overflow-y-auto md:overflow-x-auto md:overflow-y-hidden">
            {SUB_PANELS.map((sp) => (
              <div
                key={sp.id}
                className={clsx(
                  "flex flex-col transition-[opacity,width] duration-200 overflow-hidden",
                  "md:flex-1",
                  !openPanels[sp.id] && "md:w-0 md:flex-none",
                  openPanels[sp.id]
                    ? "border-b border-aeris-border md:border-b-0 md:min-w-[320px]"
                    : "hidden md:block md:min-w-0",
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
