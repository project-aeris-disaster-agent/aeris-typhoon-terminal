"use client";

export type { YtFeedResult, YtVideo } from "@/lib/youtube-feed/types";

import type { YtFeedResult } from "@/lib/youtube-feed/types";

const inMemCache = new Map<string, { data: YtFeedResult; expiresAt: number }>();
const CACHE_TTL_MS = 2 * 60 * 1000;

export async function fetchYouTubeFeeds(
  channels: string[],
): Promise<YtFeedResult> {
  const key = channels.slice().sort().join(",");
  const cached = inMemCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const res = await fetch(
    `/api/youtube-feed?channels=${encodeURIComponent(channels.join(","))}`,
    { cache: "no-store" },
  );
  const data = (await res.json().catch(() => ({
    videos: [],
    errors: ["Parse error"],
  }))) as YtFeedResult;

  inMemCache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
  return data;
}

/** Philippine location keywords to extract from video titles (UI fallback). */
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
  "Luzon", "Bicol", "Samar", "Leyte", "Negros", "Panay",
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

export type EmbedUrlOptions = {
  cacheBust?: number;
  /** Hide controls and reduce in-player chrome (webcam grid / map popups). */
  minimalChrome?: boolean;
};

export function getEmbedUrl(
  videoId: string,
  autoplay = true,
  muted = true,
  cacheBustOrOptions?: number | EmbedUrlOptions,
): string {
  let cacheBust: number | undefined;
  let minimalChrome = false;
  if (typeof cacheBustOrOptions === "number") {
    cacheBust = cacheBustOrOptions;
  } else if (cacheBustOrOptions) {
    cacheBust = cacheBustOrOptions.cacheBust;
    minimalChrome = cacheBustOrOptions.minimalChrome ?? false;
  }

  const params = new URLSearchParams({
    autoplay: autoplay ? "1" : "0",
    mute: muted ? "1" : "0",
  });
  if (minimalChrome) {
    params.set("controls", "0");
    params.set("modestbranding", "1");
    params.set("disablekb", "1");
    params.set("rel", "0");
    params.set("iv_load_policy", "3");
  }
  if (cacheBust != null && cacheBust > 0) {
    params.set("_", String(cacheBust));
  }
  return `https://www.youtube.com/embed/${videoId}?${params.toString()}`;
}
