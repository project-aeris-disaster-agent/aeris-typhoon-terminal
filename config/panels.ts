export type PanelId =
  | "typhoon"
  | "hazard"
  | "satellite"
  | "forecast"
  | "alerts"
  | "reports"
  | "news";

export type PanelDef = {
  id: PanelId;
  label: string;
  hotkey: string;
  description: string;
  defaultOpen: boolean;
};

export const PANELS: PanelDef[] = [
  {
    id: "typhoon",
    label: "Typhoon Tracker",
    hotkey: "1",
    description: "Active storm track, forecast cone, PAR, landfall ETA.",
    defaultOpen: true,
  },
  {
    id: "hazard",
    label: "Hazard Map",
    hotkey: "2",
    description: "Flood depth and landslide susceptibility by barangay.",
    defaultOpen: true,
  },
  {
    id: "satellite",
    label: "Live weather",
    hotkey: "3",
    description: "Always-on radar and Himawari loops plus wind-field motion.",
    defaultOpen: false,
  },
  {
    id: "forecast",
    label: "Forecast",
    hotkey: "4",
    description: "7-day wind, rain, and pressure per province.",
    defaultOpen: false,
  },
  {
    id: "alerts",
    label: "Alerts Feed",
    hotkey: "5",
    description: "GDACS and PAGASA advisories in reverse-chronological order.",
    defaultOpen: true,
  },
  {
    id: "reports",
    label: "Live Reports",
    hotkey: "6",
    description: "Crowdsourced incident reports. Submit and view on map.",
    defaultOpen: true,
  },
  {
    id: "news",
    label: "News",
    hotkey: "7",
    description: "Philippine news RSS aggregation.",
    defaultOpen: false,
  },
];
