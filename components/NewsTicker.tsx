"use client";

import { useMemo, useState } from "react";
import { clsx } from "clsx";
import { fetchNews, type NewsItem } from "@/services/news";
import { useVisiblePolling } from "@/hooks/useVisiblePolling";

const TICKER_HEADLINE_LIMIT = 24;
const POLL_MS = 10 * 60 * 1000;

function TickerSegment({ item }: { item: NewsItem }) {
  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex shrink-0 items-center gap-2 max-w-[min(42vw,28rem)] text-body-sm text-aeris-text transition-colors hover:text-aeris-accent"
      title={item.title}
    >
      <span className="text-body-sm font-semibold text-aeris-accent shrink-0">
        {item.source}
      </span>
      <span className="truncate">{item.title}</span>
      <span className="text-aeris-muted/60 shrink-0" aria-hidden>
        ◆
      </span>
    </a>
  );
}

export function NewsTicker({ className }: { className?: string }) {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);

  useVisiblePolling(() => {
    void (async () => {
      try {
        const result = await fetchNews();
        setItems(result.items.slice(0, TICKER_HEADLINE_LIMIT));
      } catch {
        /* keep last successful headlines */
      } finally {
        setLoading(false);
      }
    })();
  }, POLL_MS);

  const loopItems = useMemo(() => {
    if (items.length === 0) return [];
    return [...items, ...items];
  }, [items]);

  if (!loading && items.length === 0) {
    return null;
  }

  return (
    <div
      className={clsx(
        "news-ticker relative hidden min-w-0 overflow-hidden sm:flex",
        className,
      )}
      aria-label="Latest weather and disaster headlines"
      aria-live="polite"
    >
      {loading && items.length === 0 ? (
        <span className="hud-text truncate text-body-sm text-aeris-muted">
          Loading headlines…
        </span>
      ) : (
        <div
          className="news-ticker-track"
          style={{
            animationDuration: `${Math.max(48, items.length * 7)}s`,
          }}
        >
          {loopItems.map((item, index) => (
            <TickerSegment key={`${item.id}-${index}`} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
