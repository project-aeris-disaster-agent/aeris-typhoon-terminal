import { PH_REGIONS } from "@/config/region";
import { haversineKm } from "@/lib/geo";
import {
  pointInForecastCone,
  pointInWindRadius,
} from "@/lib/tc-geometry";
import type { Alert, AlertSeverity } from "@/services/alerts";
import type { Typhoon } from "@/services/typhoon-tracks";

/** Max center distance (km) to include a TC alert when cone/radii are unavailable. */
export const TC_LOCATION_MAX_KM = 800;
/** Max distance (km) for hazard alerts with known coordinates. */
export const HAZARD_LOCATION_MAX_KM = 250;

const SEVERITY_RANK: Record<AlertSeverity, number> = {
  info: 0,
  watch: 1,
  warning: 2,
  emergency: 3,
};

export type LocationAlert = Alert & {
  relevanceReason: string;
  distanceKm?: number;
};

export type LocationAlertsResult = {
  alerts: LocationAlert[];
  reasons: Record<string, string>;
};

function pickNearestRegion(lat: number, lon: number) {
  let best: { name: string; km: number } | null = null;
  for (const region of PH_REGIONS) {
    const km = haversineKm(
      { lat, lon },
      { lat: region.center[1], lon: region.center[0] },
    );
    if (!best || km < best.km) {
      best = { name: region.name, km: Math.round(km) };
    }
  }
  return best;
}

function stormTokenFromTitle(title: string) {
  return title.split(/[—–(-]/)[0].trim().toLowerCase();
}

function findTyphoonForAlert(alert: Alert, typhoons: Typhoon[]): Typhoon | undefined {
  const token = stormTokenFromTitle(alert.title);
  if (!token) return undefined;
  return typhoons.find((storm) => {
    const name = storm.name.toLowerCase();
    const local = storm.localName?.toLowerCase();
    return (
      name.includes(token) ||
      token.includes(name) ||
      (local != null && (local.includes(token) || token.includes(local)))
    );
  });
}

function tcRelevance(
  lat: number,
  lon: number,
  alert: Alert,
  typhoons: Typhoon[],
): { include: boolean; reason?: string; distanceKm?: number } {
  const storm = findTyphoonForAlert(alert, typhoons);
  if (storm) {
    if (pointInForecastCone(lon, lat, storm.forecast)) {
      return { include: true, reason: "Inside forecast cone" };
    }

    const radii = storm.bestTrack[storm.bestTrack.length - 1]?.radiusKm ?? {};
    for (const [label, radiusKm] of [
      ["64 kt wind", radii.kt60],
      ["50 kt wind", radii.kt30],
      ["34 kt wind", radii.kt15],
    ] as const) {
      if (
        pointInWindRadius(lon, lat, storm.position, radiusKm ?? undefined)
      ) {
        return { include: true, reason: `Within ${label} radius` };
      }
    }

    const distanceKm = Math.round(
      haversineKm(
        { lat, lon },
        { lat: storm.position[1], lon: storm.position[0] },
      ),
    );
    if (distanceKm <= TC_LOCATION_MAX_KM) {
      return {
        include: true,
        reason: `~${distanceKm.toLocaleString("en-US")} km from center`,
        distanceKm,
      };
    }
    return { include: false, distanceKm };
  }

  if (typeof alert.lat === "number" && typeof alert.lon === "number") {
    const distanceKm = Math.round(
      haversineKm({ lat, lon }, { lat: alert.lat, lon: alert.lon }),
    );
    if (distanceKm <= TC_LOCATION_MAX_KM) {
      return {
        include: true,
        reason: `~${distanceKm.toLocaleString("en-US")} km from center`,
        distanceKm,
      };
    }
    return { include: false, distanceKm };
  }

  return { include: false };
}

function hazardRelevance(
  lat: number,
  lon: number,
  alert: Alert,
): { include: boolean; reason?: string; distanceKm?: number } {
  if (typeof alert.lat === "number" && typeof alert.lon === "number") {
    const distanceKm = Math.round(
      haversineKm({ lat, lon }, { lat: alert.lat, lon: alert.lon }),
    );
    if (distanceKm <= HAZARD_LOCATION_MAX_KM) {
      return {
        include: true,
        reason: `~${distanceKm.toLocaleString("en-US")} km away`,
        distanceKm,
      };
    }
    return { include: false, distanceKm };
  }

  const nearest = pickNearestRegion(lat, lon);
  if (!nearest) return { include: false };

  const haystack = `${alert.title} ${alert.summary}`.toLowerCase();
  if (haystack.includes(nearest.name.toLowerCase())) {
    return { include: true, reason: `Mentions ${nearest.name}` };
  }

  return { include: false };
}

function sortLocationAlerts(a: LocationAlert, b: LocationAlert) {
  const sev = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
  if (sev !== 0) return sev;
  const distA = a.distanceKm ?? Number.POSITIVE_INFINITY;
  const distB = b.distanceKm ?? Number.POSITIVE_INFINITY;
  return distA - distB;
}

/** Filters national GDACS alerts to those relevant to a map pin. */
export function filterAlertsForLocation(
  lat: number,
  lon: number,
  alerts: Alert[],
  typhoons: Typhoon[],
): LocationAlertsResult {
  const reasons: Record<string, string> = {};
  const matched: LocationAlert[] = [];

  for (const alert of alerts) {
    const result = alert.id.startsWith("tc-")
      ? tcRelevance(lat, lon, alert, typhoons)
      : hazardRelevance(lat, lon, alert);

    if (!result.include || !result.reason) continue;

    reasons[alert.id] = result.reason;
    matched.push({
      ...alert,
      relevanceReason: result.reason,
      distanceKm: result.distanceKm,
    });
  }

  matched.sort(sortLocationAlerts);
  return { alerts: matched, reasons };
}

export function worstLocationAlertSeverity(
  alerts: LocationAlert[],
): AlertSeverity | null {
  return alerts.reduce<AlertSeverity | null>(
    (acc, alert) =>
      !acc || SEVERITY_RANK[alert.severity] > SEVERITY_RANK[acc]
        ? alert.severity
        : acc,
    null,
  );
}
