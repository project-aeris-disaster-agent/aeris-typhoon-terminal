"use client";

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

/**
 * Intel Feeds sub-panel hosting Agent AERIS. Community Chat (human-to-human)
 * moved to the map overlay (`CommunityChatOverlay`); this panel is now the
 * dedicated home for the AI agent.
 */
export function CommunityChatPanel({
  selectedLocation,
  explainRequest,
}: {
  selectedLocation: SelectedLocation | null;
  explainRequest?: AgentExplainRequest | null;
}) {
  return (
    <div className="relative flex flex-col h-full min-h-0">
      <div className="relative z-20 mb-2 flex items-center justify-between gap-1 px-1">
        <div className="hud-text text-aeris-text text-sm tracking-tight font-semibold">
          Agent AERIS
        </div>
        <HelpHint helpId="panel.agent" side="bottom" />
      </div>
      <AgentAerisPanel
        selectedLocation={toAgentLocation(selectedLocation)}
        isActive
        explainRequest={explainRequest}
      />
    </div>
  );
}
