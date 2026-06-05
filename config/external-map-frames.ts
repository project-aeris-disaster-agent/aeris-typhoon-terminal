import type { ExternalMapFrameConfig } from "@/components/ExternalMapFrame";

export type ExternalMapFrameId = "panahon" | "noah";

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
  noah: {
    url: "https://noah.up.edu.ph/weather-updates/rainfall-contour",
    title: "UP NOAH",
    subtitle: "Rainfall Contour",
    loadingLabel: "Loading NOAH…",
    ariaLabel: "UP NOAH rainfall contour map",
    iframeTitle: "UP NOAH Rainfall Contour",
    // noah.up.edu.ph responds with X-Frame-Options: SAMEORIGIN — browsers show a blank iframe.
    embeddable: false,
  },
};
