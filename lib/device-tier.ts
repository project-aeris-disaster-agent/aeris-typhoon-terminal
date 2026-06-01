/**
 * Coarse device capability tier for map / wind / overlay quality knobs.
 * Client-only; defaults to mid when `window` is unavailable.
 */

import type { Map as MLMap } from "maplibre-gl";

export type PerformanceProfile = "quality" | "balanced" | "performance";
export type DeviceTier = "low" | "mid" | "high";

const TIER = {
  low: {
    particles: 1470,
    windDpr: 1.25,
    mapDpr: 1.5,
    profile: "performance" as const,
  },
  mid: {
    particles: 2200,
    windDpr: 1.5,
    mapDpr: 1.75,
    profile: "performance" as const,
  },
  high: {
    particles: 2940,
    windDpr: 2,
    mapDpr: 2,
    profile: "balanced" as const,
  },
} satisfies Record<
  DeviceTier,
  {
    particles: number;
    windDpr: number;
    mapDpr: number;
    profile: PerformanceProfile;
  }
>;

export function isCoarsePointerDevice(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(pointer: coarse)").matches;
}

export function detectDeviceTier(): DeviceTier {
  if (typeof window === "undefined") return "mid";

  if (!isCoarsePointerDevice()) {
    const cores = navigator.hardwareConcurrency ?? 4;
    const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    if (cores >= 8 && (mem === undefined || mem >= 8)) return "high";
    return "mid";
  }

  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  const cores = navigator.hardwareConcurrency ?? 4;
  const smallViewport = window.innerWidth < 768 || window.innerHeight < 640;
  if ((mem !== undefined && mem <= 4) || cores <= 4 || smallViewport) {
    return "low";
  }
  return "mid";
}

export function overlayProfileForTier(tier: DeviceTier): PerformanceProfile {
  return TIER[tier].profile;
}

export function windParticleCountForTier(tier: DeviceTier): number {
  return TIER[tier].particles;
}

export function windDprCapForTier(tier: DeviceTier): number {
  return TIER[tier].windDpr;
}

export function mapDprCapForTier(tier: DeviceTier): number {
  return TIER[tier].mapDpr;
}

export function applyDeviceTierToMap(map: MLMap, tier: DeviceTier): void {
  const raw = window.devicePixelRatio || 1;
  map.setPixelRatio(Math.min(mapDprCapForTier(tier), raw));
}

/** Apply a URL hash map mode unless touch devices must stay on 2D until opted in. */
export function mapModeFromUrl(
  urlMode: "2d" | "3d" | null | undefined,
): "2d" | "3d" | undefined {
  if (!urlMode) return undefined;
  if (urlMode === "3d" && isCoarsePointerDevice()) return undefined;
  return urlMode;
}
