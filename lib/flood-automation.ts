import {
  DEFAULT_FLOOD_VISUALIZATION_SETTINGS,
  type FloodVisualizationSettings,
} from "@/config/flood-visualization";
import type { ForecastSummary } from "@/lib/forecast-alert";
import type { Alert, AlertSeverity } from "@/services/alerts";
import type { Typhoon } from "@/services/typhoon-tracks";

/** MGB return periods ordered from frequent to rare rainfall. */
export const FLOOD_RETURN_PERIOD_ORDER = ["5yr", "25yr", "100yr"] as const;

export type FloodReturnPeriod = (typeof FLOOD_RETURN_PERIOD_ORDER)[number];

export type FloodThreatTier = 0 | 1 | 2 | 3;

export type FloodLevelVisibility = Record<"low" | "medium" | "high", boolean>;

export type FloodAutomationPlan = {
  enabled: boolean;
  returnPeriod: FloodReturnPeriod | null;
  threatTier: FloodThreatTier;
  rainfallLevelIndex: 0 | 1 | 2;
  visibleLevels: FloodLevelVisibility;
  visualization: Pick<
    FloodVisualizationSettings,
    "waterColor" | "waterOpacity" | "wireframeBrightness" | "wireframeColors"
  >;
  reason: string;
  /** Human label for the active return-period scenario. */
  scenarioLabel: string;
};

const PERIOD_BY_TIER: Record<FloodThreatTier, FloodReturnPeriod> = {
  0: "5yr",
  1: "5yr",
  2: "25yr",
  3: "100yr",
};

const SCENARIO_LABEL: Record<FloodReturnPeriod, string> = {
  "5yr": "5-year rainfall",
  "25yr": "25-year rainfall",
  "100yr": "100-year rainfall",
};

const VIZ_BY_TIER: Record<
  FloodThreatTier,
  FloodAutomationPlan["visualization"]
> = {
  0: {
    waterColor: "#38bdf8",
    waterOpacity: 0.24,
    wireframeBrightness: 1,
    wireframeColors: {
      low: "#fde047",
      medium: "#fb923c",
      high: "#dc2626",
    },
  },
  1: {
    waterColor: "#22d3ee",
    waterOpacity: 0.3,
    wireframeBrightness: 1.1,
    wireframeColors: {
      low: "#fde047",
      medium: "#fb923c",
      high: "#dc2626",
    },
  },
  2: {
    waterColor: "#6366f1",
    waterOpacity: 0.38,
    wireframeBrightness: 1.25,
    wireframeColors: {
      low: "#facc15",
      medium: "#f97316",
      high: "#b91c1c",
    },
  },
  3: {
    waterColor: "#a855f7",
    waterOpacity: 0.48,
    wireframeBrightness: 1.45,
    wireframeColors: {
      low: "#eab308",
      medium: "#ea580c",
      high: "#991b1b",
    },
  },
};

const SEVERITY_RANK: Record<AlertSeverity, number> = {
  info: 0,
  watch: 1,
  warning: 2,
  emergency: 3,
};

const TYPHOON_ALERT_RE =
  /typhoon|tropical cyclone|tropical storm|tc advisory|bagyo|signal no\.?\s*[1-5]/i;

export function isTyphoonRelatedAlert(alert: Alert): boolean {
  return TYPHOON_ALERT_RE.test(`${alert.title} ${alert.summary}`);
}

/** True when meaningful rainfall is expected in the next 7 days. */
export function anticipatesFloodRainfall(
  forecast: ForecastSummary | null,
): boolean {
  if (!forecast) return false;
  const peakDailyRain = Math.max(...forecast.daily.map((d) => d.rainMm), 0);
  const totalRain = forecast.totalRainMm;
  const maxWind = forecast.maxWindKph;

  if (peakDailyRain >= 10) return true;
  if (totalRain >= 20) return true;
  if (peakDailyRain >= 5 && maxWind >= 30) return true;
  return false;
}

export function maxTyphoonWindKph(typhoons: Typhoon[]): number {
  return typhoons.reduce((max, t) => Math.max(max, t.windKph ?? 0), 0);
}

export function assessTyphoonThreat(args: {
  alerts: Alert[];
  typhoons: Typhoon[];
}): FloodThreatTier {
  const { alerts, typhoons } = args;
  let tier: FloodThreatTier = 0;

  const maxWind = maxTyphoonWindKph(typhoons);
  if (maxWind >= 185) tier = 3;
  else if (maxWind >= 118) tier = 2;
  else if (maxWind >= 89) tier = Math.max(tier, 2) as FloodThreatTier;
  else if (maxWind >= 62) tier = Math.max(tier, 1) as FloodThreatTier;

  for (const alert of alerts) {
    if (!isTyphoonRelatedAlert(alert)) continue;
    if (alert.severity === "emergency") tier = 3;
    else if (alert.severity === "warning")
      tier = Math.max(tier, 2) as FloodThreatTier;
    else if (alert.severity === "watch")
      tier = Math.max(tier, 1) as FloodThreatTier;
    else if (SEVERITY_RANK[alert.severity] >= SEVERITY_RANK.watch)
      tier = Math.max(tier, 1) as FloodThreatTier;
  }

  return tier;
}

/** Pick the best available return period for a threat tier. */
export function pickReturnPeriod(
  tier: FloodThreatTier,
  availablePeriods: string[],
): FloodReturnPeriod | null {
  if (availablePeriods.length === 0) return null;
  const preferred = PERIOD_BY_TIER[tier];
  const available = FLOOD_RETURN_PERIOD_ORDER.filter((p) =>
    availablePeriods.includes(p),
  );
  if (available.length === 0) {
    return availablePeriods[0] as FloodReturnPeriod;
  }
  const preferredIdx = FLOOD_RETURN_PERIOD_ORDER.indexOf(preferred);
  for (let i = preferredIdx; i >= 0; i--) {
    const candidate = FLOOD_RETURN_PERIOD_ORDER[i];
    if (available.includes(candidate)) return candidate;
  }
  return available[available.length - 1];
}

export function rainfallLevelIndexForPlan(
  tier: FloodThreatTier,
  forecast: ForecastSummary | null,
): 0 | 1 | 2 {
  if (tier >= 3) return 2;
  if (tier >= 2) return 2;
  if (tier >= 1) return 1;
  if (forecast) {
    const peak = Math.max(...forecast.daily.map((d) => d.rainMm), 0);
    if (peak >= 40) return 2;
    if (peak >= 20) return 1;
  }
  return 0;
}

export function visibleLevelsFromIndex(
  rainfallLevelIndex: 0 | 1 | 2,
): FloodLevelVisibility {
  return {
    low: rainfallLevelIndex >= 0,
    medium: rainfallLevelIndex >= 1,
    high: rainfallLevelIndex >= 2,
  };
}

export function mergeFloodVisualization(
  base: FloodVisualizationSettings,
  patch: FloodAutomationPlan["visualization"],
): FloodVisualizationSettings {
  return {
    ...base,
    ...patch,
    wireframeColors: {
      ...base.wireframeColors,
      ...patch.wireframeColors,
    },
  };
}

export function computeFloodAutomation(args: {
  forecast: ForecastSummary | null;
  alerts: Alert[];
  typhoons: Typhoon[];
  availablePeriods: string[];
}): FloodAutomationPlan {
  const { forecast, alerts, typhoons, availablePeriods } = args;
  const rainExpected = anticipatesFloodRainfall(forecast);
  const threatTier = assessTyphoonThreat({ alerts, typhoons });
  const enabled = rainExpected || threatTier >= 1;
  const returnPeriod = enabled
    ? pickReturnPeriod(threatTier, availablePeriods)
    : null;
  const rainfallLevelIndex = rainfallLevelIndexForPlan(threatTier, forecast);
  const visibleLevels = visibleLevelsFromIndex(rainfallLevelIndex);
  const visualization = VIZ_BY_TIER[threatTier];

  const reasons: string[] = [];
  if (rainExpected && forecast) {
    const peak = Math.max(...forecast.daily.map((d) => d.rainMm), 0);
    reasons.push(
      `${peak.toFixed(0)} mm peak rain expected in the next 7 days`,
    );
  }
  if (threatTier >= 1) {
    const maxWind = maxTyphoonWindKph(typhoons);
    if (maxWind >= 62) {
      reasons.push(`tropical cyclone threat (${Math.round(maxWind)} kph)`);
    } else {
      reasons.push("active typhoon advisories");
    }
  }

  let reason: string;
  if (!enabled) {
    reason = "Off until rain or typhoon risk rises.";
  } else if (reasons.length === 0) {
    reason = "Monitoring current conditions.";
  } else {
    reason = `Auto on: ${reasons.join(" · ")}.`;
  }

  const scenarioLabel = returnPeriod
    ? SCENARIO_LABEL[returnPeriod]
    : SCENARIO_LABEL["5yr"];

  return {
    enabled,
    returnPeriod,
    threatTier,
    rainfallLevelIndex,
    visibleLevels,
    visualization,
    reason,
    scenarioLabel,
  };
}

export function defaultFloodVisualization(): FloodVisualizationSettings {
  return { ...DEFAULT_FLOOD_VISUALIZATION_SETTINGS };
}
