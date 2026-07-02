"use client";

import { useMemo, useState } from "react";
import { CardHeader, Pill } from "../ui/Card";
import { useVisiblePolling } from "@/hooks/useVisiblePolling";
import { usePanelHeaderBadge } from "@/components/panel-header-badge";
import { FreshnessTag } from "../ui/FreshnessTag";
import { fetchNews, type NewsFetchResult, type NewsItem } from "@/services/news";
import { getNewsSourceLogo } from "@/lib/news-sources";

export function NewsPanel() {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useVisiblePolling(() => {
    void (async () => {
      try {
        const result: NewsFetchResult = await fetchNews();
        setItems(result.items);
        setError(null);
      } catch (newsError) {
        setError((newsError as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, 10 * 60 * 1000);

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
      <FreshnessTag source="news" />
      <div className="max-h-[280px] overflow-y-auto border border-aeris-border/30 rounded">
        {items.length === 0 ? (
          <div className="flex items-center justify-center py-6 text-xs text-aeris-muted">
            {loading
              ? "Fetching news…"
              : error
                ? "News feed unavailable"
                : "No recent headlines"}
          </div>
        ) : (
          items.map((item) => <NewsRow key={item.id} item={item} />)
        )}
      </div>
    </div>
  );
}

function NewsRow({ item }: { item: NewsItem }) {
  const [thumbFailed, setThumbFailed] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);

  const showThumb = Boolean(item.imageUrl) && !thumbFailed;
  const logoUrl = getNewsSourceLogo(item);
  const showLogo = Boolean(logoUrl) && !logoFailed;

  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex gap-2 p-2 h-[72px] border-b border-aeris-border/40 hover:bg-aeris-elev transition-colors last:border-b-0"
    >
      <div className="w-12 h-12 shrink-0 rounded overflow-hidden border border-aeris-border/40 bg-aeris-elev/60 flex items-center justify-center">
        {showThumb ? (
          <img
            src={item.imageUrl}
            alt=""
            loading="lazy"
            className="w-full h-full object-cover"
            onError={() => setThumbFailed(true)}
          />
        ) : showLogo ? (
          <img
            src={logoUrl as string}
            alt=""
            loading="lazy"
            className="w-7 h-7 object-contain"
            onError={() => setLogoFailed(true)}
          />
        ) : (
          <span className="text-base font-mono font-semibold uppercase text-aeris-accent">
            {item.source.charAt(0)}
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 mb-0.5">
          <span className="text-body-sm font-mono uppercase text-aeris-muted truncate">
            {item.source}
          </span>
          <span className="text-body-sm font-mono text-aeris-muted/70 shrink-0">
            {new Date(item.publishedAt).toLocaleString("en-PH", {
              month: "short",
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        </div>
        <div className="text-xs text-aeris-text line-clamp-2">{item.title}</div>
      </div>
    </a>
  );
}
