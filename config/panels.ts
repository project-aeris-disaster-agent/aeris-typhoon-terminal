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

/** Ops sidebar panels (live weather is anchored on the map HUD). */
export const SIDEBAR_PANELS: PanelDef[] = [
  {
    id: "typhoon",
    label: "Typhoon Tracker",
    hotkey: "1",
    description: "Active storm track, forecast cone, PAR, landfall ETA.",
    defaultOpen: true,
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
    description: "GDACS active cyclones and current Philippines-relevant hazards.",
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

export const LIVE_WEATHER_PANEL: PanelDef = {
  id: "satellite",
  label: "Live weather",
  hotkey: "2",
  description: "Always-on radar and Himawari loops plus wind-field motion.",
  defaultOpen: false,
};

/** All panel definitions (sidebar + map HUD), in display order. */
export const PANELS: PanelDef[] = [
  SIDEBAR_PANELS[0],
  LIVE_WEATHER_PANEL,
  ...SIDEBAR_PANELS.slice(1),
];
