"use client";

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

const NEWS_STALE_CACHE_MS = 20 * 60 * 1000;
let lastHealthyItems: NewsItem[] = [];
let lastHealthyAt = 0;

export async function fetchNews(): Promise<NewsFetchResult> {
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

    recordSuccess("news");
    return {
      items: normalized,
      warnings: Array.isArray(data.errors) ? data.errors : [],
    };
  } catch (error) {
    const message = (error as Error).message;
    const canUseStaleCache =
      lastHealthyItems.length > 0 &&
      Date.now() - lastHealthyAt < NEWS_STALE_CACHE_MS;
    if (canUseStaleCache) {
      recordSuccess("news");
      return {
        items: lastHealthyItems,
        warnings: ["Live RSS unavailable, showing most recent successful snapshot."],
      };
    }
    recordFailure("news", message);
    throw error;
  }
}

function dedupeNewsItems(items: NewsItem[]) {
  const seen = new Set<string>();
  const out: NewsItem[] = [];
  for (const item of items) {
    const key = `${normalize(item.title)}|${item.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function normalize(text: string) {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}
