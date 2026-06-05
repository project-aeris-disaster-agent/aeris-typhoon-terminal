/**
 * Central help-content registry.
 *
 * Each entry powers (a) the hover/focus tooltip copy shown by `HelpHint`, and
 * (b) the prompt sent to Agent AERIS when a help affordance is long-pressed.
 *
 * Copy is plain-language and focused on two things:
 *   1. What the panel / subpanel / control is.
 *   2. How to interpret the data it shows.
 *
 * The registry is intentionally extensible — add new ids as more surfaces get
 * wired up. Keep `tip` short (one or two sentences) and `detail` a little
 * richer (used to seed the agent prompt).
 */

export type HelpId =
  // Sidebar + map panels
  | "panel.typhoon"
  | "panel.satellite"
  | "panel.forecast"
  | "panel.alerts"
  | "panel.news"
  | "panel.reports"
  | "panel.agent"
  // Intel Feeds subpanels
  | "feeds.webcams"
  | "feeds.livestreams"
  | "feeds.community"
  // Key controls
  | "control.viewMode"
  | "control.externalMaps"
  | "control.layers"
  | "control.quickViews"
  | "control.satelliteSource";

export type HelpEntry = {
  /** Short, human label used in tooltip heading + agent prompt. */
  title: string;
  /** Short hover/focus tooltip text (one to two sentences). */
  tip: string;
  /** Optional richer explanation used to seed the agent prompt. */
  detail?: string;
};

export const HELP: Record<HelpId, HelpEntry> = {
  "panel.typhoon": {
    title: "Typhoon Tracker",
    tip: "Active storm track, forecast cone, PAR boundary, and landfall ETA. The cone shows where the center could go — wider cone means more uncertainty, not a bigger storm.",
    detail:
      "The Typhoon Tracker shows active tropical cyclones with their observed track, the forecast cone of probable center positions, the Philippine Area of Responsibility (PAR) boundary, and estimated landfall time. Read the cone as uncertainty in the center's path, not the size of the storm's hazards.",
  },
  "panel.satellite": {
    title: "Live Weather",
    tip: "Always-on radar and Himawari satellite loops plus wind-field motion. Brighter radar returns mean heavier rain; the loop plays recent frames so you can see movement.",
    detail:
      "The Live Weather panel layers near-real-time weather radar, Himawari satellite imagery loops, and animated wind-field motion over the map. Stronger/brighter radar colors indicate heavier rainfall, and the animated frames reveal how systems are moving and intensifying.",
  },
  "panel.forecast": {
    title: "Forecast",
    tip: "7-day wind, rain, and pressure outlook per province. Use it to anticipate conditions days ahead, not just the current situation.",
    detail:
      "The Forecast panel gives a 7-day outlook of wind, rainfall, and pressure for each province. Use it to plan ahead: rising wind and rain with falling pressure usually signal a worsening system approaching.",
  },
  "panel.alerts": {
    title: "Alerts Feed",
    tip: "GDACS active cyclones and current Philippines-relevant hazards. Color/severity indicates how urgent the hazard is.",
    detail:
      "The Alerts Feed aggregates GDACS active cyclone alerts and other current hazards relevant to the Philippines. Severity coloring indicates urgency — treat red/danger items as requiring immediate attention.",
  },
  "panel.news": {
    title: "News",
    tip: "Aggregated Philippine news headlines (RSS). Cross-reference reports against official advisories and ground coverage.",
    detail:
      "The News panel aggregates Philippine news headlines via RSS. Use it to cross-reference dashboard data against on-the-ground reporting and official advisories.",
  },
  "panel.reports": {
    title: "Live Reports",
    tip: "Field reports from responders and the community. Filter by Urgent or Needs Review, and tap a report to locate it on the map.",
    detail:
      "The Live Reports panel streams field reports from responders and community members. You can filter by Urgent or Needs Review, tap a report to locate it on the map, and (as an operator) verify, review, or reject incoming reports.",
  },
  "panel.agent": {
    title: "Agent AERIS",
    tip: "Your AI assistant. Ask for a situation brief, preparedness checklist, or advisory. AERIS uses the live dashboard context and can answer by voice.",
    detail:
      "Agent AERIS is the AI assistant for this dashboard. It reads the live dashboard context (selected location, conditions) and can produce situation briefs, preparedness checklists, and public advisories. Replies are also spoken aloud unless muted.",
  },
  "feeds.webcams": {
    title: "Live Webcams",
    tip: "Live camera feeds you can place on the map. Use them for visual confirmation of conditions at specific locations.",
    detail:
      "Live Webcams shows real-time camera feeds. Pin a camera to its location on the map for visual ground-truth of weather and flooding at that spot.",
  },
  "feeds.livestreams": {
    title: "News Livestreams",
    tip: "Live news channel streams. Switch channels and browse recent videos for live broadcast coverage.",
    detail:
      "News Livestreams embeds live news channel streams. Switch between channels and recent videos to follow live broadcast coverage of unfolding events.",
  },
  "feeds.community": {
    title: "Community Chat",
    tip: "Real-time coordination and field reports from responders and the community (in development). The Agent AERIS tab is live now.",
    detail:
      "Community Chat will host real-time coordination and field reports between responders and community members. The Agent AERIS tab beside it is already live for AI assistance.",
  },
  "control.viewMode": {
    title: "Map View Mode",
    tip: "Switch between 2D (flat map) and 3D (tilted terrain) views. 3D helps visualize elevation and how terrain channels water and wind.",
    detail:
      "The view-mode toggle switches the map between a flat 2D view and a tilted 3D terrain view. Use 3D to understand elevation, which shows how terrain channels floodwater and affects wind exposure.",
  },
  "control.externalMaps": {
    title: "External Maps",
    tip: "Open official external map tools (PAGASA PANaHON, UP NOAH) for authoritative hazard and flood data.",
    detail:
      "These buttons open official external mapping tools such as PAGASA PANaHON and UP NOAH for authoritative, agency-sourced hazard and flood hazard maps.",
  },
  "control.layers": {
    title: "Map Layers",
    tip: "Toggle map overlays like flood projections, water levels, and buildings. Combine layers to see exposure — e.g. buildings within flood projections.",
    detail:
      "The Layers control toggles map overlays including flood projections, water levels, and 3D buildings. Combine layers to assess exposure — for example, view buildings together with flood projections to see what's at risk.",
  },
  "control.quickViews": {
    title: "Quick Views",
    tip: "One-tap scene presets that jump the map to a useful camera angle and layer combination.",
    detail:
      "Quick Views are preset scenes that instantly set the map camera and a useful combination of layers, so you can switch between common operational views without manual setup.",
  },
  "control.satelliteSource": {
    title: "Imagery Source",
    tip: "Choose the weather imagery source: Radar (rainfall), Air mass (RGB satellite), or IR (cloud-top temperature, good at night).",
    detail:
      "These buttons select the weather imagery source. Radar shows rainfall intensity, Air mass is an RGB satellite composite for air-mass analysis, and IR (infrared) shows cloud-top temperature — colder/higher tops often mean stronger storms, and IR works at night.",
  },
};

/** Builds the prompt sent to Agent AERIS for a given help id. */
export function buildExplainPrompt(helpId: HelpId): string {
  const entry = HELP[helpId];
  if (!entry) {
    return "Explain this part of the dashboard: what it shows and how to interpret it.";
  }
  const basis = entry.detail ?? entry.tip;
  return `Explain the "${entry.title}" feature of the AERIS dashboard in 2-3 short sentences: what it shows and how to interpret its data. Context: ${basis}`;
}
