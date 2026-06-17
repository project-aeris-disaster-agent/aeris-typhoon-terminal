import type { ExternalMapFrameConfig } from "@/components/ExternalMapFrame";

export type ExternalMapFrameId = "panahon";

export const EXTERNAL_MAP_FRAMES: Record<
  ExternalMapFrameId,
  ExternalMapFrameConfig
> = {
  panahon: {
    url: "https://www.panahon.gov.ph/",
    title: "PAGASA · PANaHON",
    subtitle: "Nationwide Hydromet Observation Network",
    loadingLabel: "Loading PANaHON…",
    ariaLabel: "PAGASA PANaHON weather map",
    iframeTitle: "PAGASA PANaHON Weather Map",
  },
};
