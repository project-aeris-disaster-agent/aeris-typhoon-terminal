export type PanelId =
  | "typhoon"
  | "satellite"
  | "forecast"
  | "alerts"
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
    id: "satellite",
    label: "Live weather",
    hotkey: "2",
    description: "Always-on radar and Himawari loops plus wind-field motion.",
    defaultOpen: false,
  },
  {
    id: "forecast",
    label: "Forecast",
    hotkey: "3",
    description: "7-day wind, rain, and pressure per province.",
    defaultOpen: false,
  },
  {
    id: "alerts",
    label: "Alerts Feed",
    hotkey: "4",
    description: "GDACS and PAGASA advisories in reverse-chronological order.",
    defaultOpen: true,
  },
  {
    id: "news",
    label: "News",
    hotkey: "5",
    description: "Philippine news RSS aggregation.",
    defaultOpen: false,
  },
];
