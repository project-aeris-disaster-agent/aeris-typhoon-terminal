"use client";

import { dedupeNewsItems } from "@/lib/news-relevance";
import { recordFailure, recordSuccess } from "@/services/data-freshness";

export type NewsItem = {
  id: string;
  source: string;
  title: string;
  url: string;
  publishedAt: string;
  imageUrl?: string;
};

export type NewsFetchResult = {
  items: NewsItem[];
  warnings: string[];
};

/** Coalesce NewsTicker + NewsPanel mounts / double polls within a short window. */
const NEWS_FRESH_CACHE_MS = 60 * 1000;
const NEWS_STALE_CACHE_MS = 20 * 60 * 1000;

let lastHealthyItems: NewsItem[] = [];
let lastHealthyAt = 0;
let lastResult: NewsFetchResult | null = null;
let lastFetchAt = 0;
let inFlight: Promise<NewsFetchResult> | null = null;

export async function fetchNews(): Promise<NewsFetchResult> {
  if (
    lastResult &&
    Date.now() - lastFetchAt < NEWS_FRESH_CACHE_MS &&
    lastResult.items.length > 0
  ) {
    return lastResult;
  }
  if (inFlight) return inFlight;

  inFlight = loadNews().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function loadNews(): Promise<NewsFetchResult> {
  try {
    const res = await fetch("/api/rss", { cache: "no-store" });
    const data = (await res.json().catch(() => ({}))) as {
      items?: NewsItem[];
      error?: string;
      errors?: string[];
    };

    if (!res.ok) {
      // Failure telemetry is recorded in the catch block below — don't
      // double-count by calling recordFailure here before throwing.
      throw new Error(data.error ?? `RSS ${res.status}`);
    }

    const normalized = dedupeNewsItems(
      Array.isArray(data.items) ? data.items : [],
    ).sort(
      (a, b) =>
        new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
    );

    if (normalized.length > 0) {
      lastHealthyItems = normalized;
      lastHealthyAt = Date.now();
    }

    const result: NewsFetchResult = {
      items: normalized,
      warnings: Array.isArray(data.errors) ? data.errors : [],
    };
    lastResult = result;
    lastFetchAt = Date.now();
    recordSuccess("news");
    return result;
  } catch (error) {
    const message = (error as Error).message;
    const canUseStaleCache =
      lastHealthyItems.length > 0 &&
      Date.now() - lastHealthyAt < NEWS_STALE_CACHE_MS;
    if (canUseStaleCache) {
      recordSuccess("news");
      const stale: NewsFetchResult = {
        items: lastHealthyItems,
        warnings: [
          "Live RSS unavailable, showing most recent successful snapshot.",
        ],
      };
      lastResult = stale;
      lastFetchAt = Date.now();
      return stale;
    }
    recordFailure("news", message);
    throw error;
  }
}
