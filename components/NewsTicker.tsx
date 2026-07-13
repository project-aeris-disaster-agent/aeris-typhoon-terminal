"use client";

import { useMemo, useState } from "react";
import { clsx } from "clsx";
import { fetchNews, type NewsItem } from "@/services/news";
import { useVisiblePolling } from "@/hooks/useVisiblePolling";

const TICKER_HEADLINE_LIMIT = 20;
const POLL_MS = 10 * 60 * 1000;

function TickerSegment({
  item,
  hidden = false,
}: {
  item: NewsItem;
  hidden?: boolean;
}) {
  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex shrink-0 items-center gap-2 max-w-[min(42vw,28rem)] text-body-sm text-aeris-text transition-colors hover:text-aeris-accent"
      title={item.title}
      aria-hidden={hidden || undefined}
      tabIndex={hidden ? -1 : undefined}
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

function TickerTrack({
  items,
  durationSec,
}: {
  items: NewsItem[];
  durationSec: number;
}) {
  // Duplicate the list once so translateX(-50%) loops seamlessly. The clone
  // is aria-hidden so screen readers only announce each headline once.
  return (
    <div
      className="news-ticker-track"
      style={{ animationDuration: `${durationSec}s` }}
    >
      {items.map((item) => (
        <TickerSegment key={`a-${item.id}`} item={item} />
      ))}
      {items.map((item) => (
        <TickerSegment key={`b-${item.id}`} item={item} hidden />
      ))}
    </div>
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

  const durationSec = useMemo(
    () => Math.max(48, items.length * 7),
    [items.length],
  );

  if (!loading && items.length === 0) {
    return null;
  }

  return (
    <div
      className={clsx(
        // Responsive visibility is owned by the caller (Header hides it
        // below lg); no display breakpoints here so the caller's win.
        "news-ticker relative min-w-0 overflow-hidden",
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
        <TickerTrack items={items} durationSec={durationSec} />
      )}
    </div>
  );
}
