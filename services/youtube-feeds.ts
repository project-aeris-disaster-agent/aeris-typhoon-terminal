"use client";

import type { CctvLocation } from "@/services/cctv-locations";

export type YtVideo = {
  id: string;
  title: string;
  publishedAt: string;
  thumbnailUrl: string;
  channelName: string;
  channelHandle: string;
  isLikeLive: boolean;
  embeddable?: boolean;
  liveBroadcastContent?: "live" | "upcoming" | "none";
  /** Heuristic geocode of the camera derived from title; null if unknown. */
  location?: CctvLocation | null;
};

export type YtFeedResult = {
  videos: YtVideo[];
  errors: string[];
};

const inMemCache = new Map<string, { data: YtFeedResult; expiresAt: number }>();
const CACHE_TTL_MS = 2 * 60 * 1000;

export type FetchYouTubeFeedsOptions = {
  /** Skip client in-memory cache (use for panels that need fresh RSS-derived data). */
  bypassClientCache?: boolean;
};

export async function fetchYouTubeFeeds(
  channels: string[],
  options?: FetchYouTubeFeedsOptions,
): Promise<YtFeedResult> {
  const key = channels.slice().sort().join(",");
  if (!options?.bypassClientCache) {
    const cached = inMemCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.data;
  }

  const res = await fetch(
    `/api/youtube-feed?channels=${encodeURIComponent(channels.join(","))}`,
    { cache: "no-store" },
  );
  const data = (await res.json().catch(() => ({
    videos: [],
    errors: ["Parse error"],
  }))) as YtFeedResult;

  if (!options?.bypassClientCache) {
    inMemCache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
  }
  return data;
}

/** Philippine location keywords to extract from video titles */
const PH_LOCATIONS: string[] = [
  "Manila", "Quezon City", "Makati", "Pasig", "Taguig", "Mandaluyong",
  "Marikina", "Pasay", "Caloocan", "Parañaque", "Las Piñas", "Muntinlupa",
  "Valenzuela", "Navotas", "Malabon", "Pateros", "San Juan", "NCR",
  "Cebu", "Davao", "Iloilo", "Bacolod", "Zamboanga", "Cagayan de Oro",
  "General Santos", "Lapu-Lapu", "Mandaue", "Tacloban", "Baguio",
  "Antipolo", "Batangas", "Lucena", "Cabanatuan", "Angeles", "Olongapo",
  "Legazpi", "Naga", "Lipa", "San Pablo", "Cotabato", "Iligan",
  "Pagadian", "Puerto Princesa", "Roxas", "Tuguegarao", "Vigan",
  "Palawan", "Boracay", "Siargao", "Batanes", "Mindanao", "Visayas",
  "Luzon", "Bicol", "Palawan", "Samar", "Leyte", "Negros", "Panay",
  "Mindoro", "Marinduque", "Romblon", "Isabela", "Cagayan", "Aurora",
];

export function extractLocation(title: string): string | null {
  const titleNorm = title.toLowerCase();
  for (const loc of PH_LOCATIONS) {
    if (titleNorm.includes(loc.toLowerCase())) return loc;
  }
  const colonParts = title.match(/[Ll]ive[:\s]+(.{3,40})(?:\s[-|]|$)/);
  if (colonParts) {
    const candidate = colonParts[1].trim();
    if (candidate.length < 50) return candidate;
  }
  return null;
}

export function getEmbedUrl(
  videoId: string,
  autoplay = true,
  muted = true,
  /** Bust iframe cache when feed refreshes (same video id, new player state) */
  cacheBust?: number,
): string {
  const base = `https://www.youtube.com/embed/${videoId}?autoplay=${autoplay ? 1 : 0}&mute=${muted ? 1 : 0}`;
  if (cacheBust != null && cacheBust > 0) {
    return `${base}&_=${cacheBust}`;
  }
  return base;
}
