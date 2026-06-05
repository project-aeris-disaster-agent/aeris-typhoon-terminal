"use client";

import { useEffect, useState } from "react";
import { clsx } from "clsx";
import dynamic from "next/dynamic";
import type { SelectedLocation } from "@/components/MapSearchBar";
import { HelpHint } from "@/components/ui/HelpTooltip";
import type { AgentExplainRequest } from "@/lib/help/agent-explain";

const AgentAerisPanel = dynamic(
  () =>
    import("./AgentAerisPanel").then((m) => ({
      default: m.AgentAerisPanel,
    })),
  { ssr: false },
);

function toAgentLocation(location: SelectedLocation | null) {
  if (!location) return null;
  return {
    name: location.shortName,
    breadcrumb: location.breadcrumb,
    lat: location.lat,
    lon: location.lon,
    type: location.typeLabel,
  };
}

export function CommunityChatPanel({
  selectedLocation,
  explainRequest,
}: {
  selectedLocation: SelectedLocation | null;
  explainRequest?: AgentExplainRequest | null;
}) {
  const [activeTab, setActiveTab] = useState<"chat" | "agent">("agent");

  // An incoming explain request always targets the live Agent AERIS tab.
  useEffect(() => {
    if (explainRequest) setActiveTab("agent");
  }, [explainRequest]);

  return (
    <div className="relative flex flex-col h-full min-h-0">
      {/* Tab switcher */}
      <div className="relative z-20 mb-2 flex items-center gap-1">
        <div className="flex flex-1 rounded-lg border border-aeris-border/60 bg-aeris-bg/40 p-1">
        <button
          type="button"
          onClick={() => setActiveTab("chat")}
          className={clsx(
            "hud-text flex-1 rounded-md px-2 py-1.5 text-[10px] font-semibold uppercase tracking-widest transition-colors",
            activeTab === "chat"
              ? "bg-aeris-accent/10 text-aeris-accent border border-aeris-accent/30"
              : "text-aeris-muted hover:text-aeris-text",
          )}
          aria-pressed={activeTab === "chat"}
        >
          Community Chat
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("agent")}
          className={clsx(
            "hud-text flex-1 rounded-md px-2 py-1.5 text-[10px] font-semibold uppercase tracking-widest transition-colors",
            activeTab === "agent"
              ? "bg-aeris-accent/10 text-aeris-accent border border-aeris-accent/30"
              : "text-aeris-muted hover:text-aeris-text",
          )}
          aria-pressed={activeTab === "agent"}
        >
          Agent AERIS
        </button>
        </div>
        <HelpHint
          helpId={activeTab === "agent" ? "panel.agent" : "feeds.community"}
          side="bottom"
        />
      </div>

      {/* Community Chat tab */}
      {activeTab === "chat" && (
        <div className="flex-1 flex flex-col min-h-0">
          {/* Header */}
          <div className="px-1 mb-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <svg
                    className="shrink-0 text-aeris-accent"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                  >
                    <path
                      d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <div className="hud-text text-aeris-text text-sm tracking-tight">
                    Community Chat
                  </div>
                </div>
                <div className="text-[10px] text-aeris-muted ml-0.5">
                  Real-time field reports &amp; coordination
                </div>
              </div>
              <span className="shrink-0 inline-flex text-[9px] font-mono uppercase tracking-widest text-aeris-warn border border-aeris-warn/40 rounded-full px-2 py-1 bg-aeris-warn/5 font-semibold">
                Soon
              </span>
            </div>
          </div>

          {/* Empty / coming-soon state */}
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-4">
            <div className="w-12 h-12 rounded-lg bg-aeris-accent/5 border border-aeris-accent/20 flex items-center justify-center">
              <svg
                className="text-aeris-accent/40"
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
              >
                <path
                  d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
                <path
                  d="M8 10h8M8 14h5"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </div>
            <div className="space-y-1">
              <p className="text-[12px] font-semibold text-aeris-text">
                Community Chat coming soon
              </p>
              <p className="text-[10px] text-aeris-muted/60 leading-relaxed max-w-[200px]">
                Real-time coordination and field reports from responders and community members
              </p>
            </div>
            <div className="mt-1 flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-aeris-border/50 bg-aeris-bg/40">
              <span className="w-1.5 h-1.5 rounded-full bg-aeris-accent/40 animate-pulse" />
              <span className="text-[9px] font-mono text-aeris-muted/50 uppercase tracking-widest">
                Under Development
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Agent AERIS tab */}
      {activeTab === "agent" && (
        <AgentAerisPanel
          selectedLocation={toAgentLocation(selectedLocation)}
          isActive={activeTab === "agent"}
          explainRequest={explainRequest}
        />
      )}
    </div>
  );
}
