"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Minimal windowed list for long feeds. Pattern adapted from WorldMonitor.
 * Renders only items currently visible within the scroll container plus a
 * small overscan buffer.
 */
export function VirtualList<T>({
  items,
  rowHeight,
  overscan = 4,
  render,
  className,
  emptyText,
}: {
  items: T[];
  rowHeight: number;
  overscan?: number;
  render: (item: T, index: number) => React.ReactNode;
  className?: string;
  emptyText?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [clientHeight, setClientHeight] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => setScrollTop(el.scrollTop);
    const ro = new ResizeObserver(() => setClientHeight(el.clientHeight));
    el.addEventListener("scroll", onScroll, { passive: true });
    ro.observe(el);
    setClientHeight(el.clientHeight);
    return () => {
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
    };
  }, []);

  if (items.length === 0) {
    return (
      <div
        className={`flex items-center justify-center py-6 text-xs text-aeris-muted ${className ?? ""}`}
      >
        {emptyText ?? "No items"}
      </div>
    );
  }

  const total = items.length * rowHeight;
  const startIdx = Math.max(
    0,
    Math.floor(scrollTop / rowHeight) - overscan,
  );
  const endIdx = Math.min(
    items.length,
    Math.ceil((scrollTop + clientHeight) / rowHeight) + overscan,
  );
  const slice = items.slice(startIdx, endIdx);
  const offsetY = startIdx * rowHeight;

  return (
    <div ref={ref} className={`overflow-auto ${className ?? ""}`}>
      <div style={{ height: total, position: "relative" }}>
        <div style={{ transform: `translateY(${offsetY}px)` }}>
          {slice.map((item, i) => (
            <div key={startIdx + i} style={{ height: rowHeight }}>
              {render(item, startIdx + i)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
