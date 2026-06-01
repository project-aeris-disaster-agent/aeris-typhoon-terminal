/**
 * Coarse device capability tier for map / wind / overlay quality knobs.
 * Used client-side only; defaults to mid on the server.
 */

export type PerformanceProfile = "quality" | "balanced" | "performance";

export type DeviceTier = "low" | "mid" | "high";

export function detectDeviceTier(): DeviceTier {
  if (typeof window === "undefined") return "mid";

  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  const cores = navigator.hardwareConcurrency ?? 4;
  const smallViewport =
    window.innerWidth < 768 || window.innerHeight < 640;

  if (coarse && ((mem !== undefined && mem <= 4) || cores <= 4 || smallViewport)) {
    return "low";
  }
  if (!coarse && cores >= 8 && (mem === undefined || mem >= 8)) {
    return "high";
  }
  return "mid";
}

export function isCoarsePointerDevice(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(pointer: coarse)").matches;
}

export function windParticleCountForTier(tier: DeviceTier): number {
  if (tier === "low") return 1470;
  if (tier === "high") return 2940;
  return 2200;
}

export function windDprCapForTier(tier: DeviceTier): number {
  if (tier === "low") return 1.25;
  if (tier === "high") return 2;
  return 1.5;
}

export function mapDprCapForTier(tier: DeviceTier): number {
  if (tier === "low") return 1.5;
  if (tier === "high") return 2;
  return 1.75;
}

export function liveWeatherProfileForTier(
  tier: DeviceTier,
): PerformanceProfile {
  if (tier === "high") return "balanced";
  if (tier === "low") return "performance";
  return "performance";
}

export function reportPingProfileForTier(
  tier: DeviceTier,
): PerformanceProfile {
  if (tier === "high") return "balanced";
  if (tier === "low") return "performance";
  return "performance";
}

export function windProfileForTier(tier: DeviceTier): PerformanceProfile {
  return liveWeatherProfileForTier(tier);
}

export function applyDeviceTierToMap(
  map: import("maplibre-gl").Map,
  tier: DeviceTier,
): void {
  const raw = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  map.setPixelRatio(Math.min(mapDprCapForTier(tier), raw));
}
