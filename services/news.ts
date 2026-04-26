"use client";

import { recordFailure, recordSuccess } from "@/services/data-freshness";

export type NewsItem = {
  id: string;
  source: string;
  title: string;
  url: string;
  publishedAt: string;
};

export type NewsFetchResult = {
  items: NewsItem[];
  warnings: string[];
};

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

    recordSuccess("news");
    return {
      items: Array.isArray(data.items) ? data.items : [],
      warnings: Array.isArray(data.errors) ? data.errors : [],
    };
  } catch (error) {
    recordFailure("news", (error as Error).message);
    throw error;
  }
}
