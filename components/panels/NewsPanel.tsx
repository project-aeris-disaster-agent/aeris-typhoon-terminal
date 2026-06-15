"use client";

import { useEffect, useMemo, useState } from "react";
import { CardHeader, Pill } from "../ui/Card";
import { usePanelHeaderBadge } from "@/components/panel-header-badge";
import { VirtualList } from "../ui/VirtualList";
import { FreshnessTag } from "../ui/FreshnessTag";
import { fetchNews, type NewsFetchResult, type NewsItem } from "@/services/news";

export function NewsPanel() {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const result: NewsFetchResult = await fetchNews();
        if (!cancelled) {
          setItems(result.items);
          setWarnings(result.warnings);
          setError(null);
        }
      } catch (newsError) {
        if (!cancelled) {
          setError((newsError as Error).message);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    const id = window.setInterval(run, 10 * 60 * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const headerBadge = useMemo(() => {
    if (loading) return <Pill>loading</Pill>;
    return <Pill tone="accent">{items.length}</Pill>;
  }, [loading, items.length]);

  usePanelHeaderBadge("news", headerBadge);

  return (
    <div className="space-y-2">
      <CardHeader
        title="News Watch"
        trailing={headerBadge}
      />
      <p className="text-body-sm text-aeris-muted leading-snug">
        Regional headlines and situational updates related to active weather.
      </p>
      {error && <div className="text-xs text-aeris-danger">Error: {error}</div>}
      {!error && warnings.length > 0 && (
        <div className="text-xs text-aeris-warn">
          Source note: {warnings.join(" | ")}
        </div>
      )}
      <FreshnessTag source="news" />
      <VirtualList
        items={items}
        rowHeight={72}
        className="max-h-[280px]"
        emptyText={loading ? "Fetching news…" : error ? "News feed unavailable" : "No recent headlines"}
        render={renderNewsRow}
      />
    </div>
  );
}

function renderNewsRow(n: NewsItem) {
  return (
    <a
      href={n.url}
      target="_blank"
      rel="noopener noreferrer"
      className="block p-2 border-b border-aeris-border/40 hover:bg-aeris-elev transition-colors"
    >
      <div className="flex items-center gap-1.5 mb-0.5">
        <span className="text-body-sm font-mono uppercase text-aeris-muted">
          {n.source}
        </span>
        <span className="text-body-sm font-mono text-aeris-muted/70">
          {new Date(n.publishedAt).toLocaleString("en-PH", {
            month: "short",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      </div>
      <div className="text-xs text-aeris-text line-clamp-2">{n.title}</div>
    </a>
  );
}
