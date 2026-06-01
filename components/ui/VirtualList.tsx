"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/**
 * Minimal windowed list for long feeds. Pattern adapted from WorldMonitor.
 * Renders only items currently visible within the scroll container plus a
 * small overscan buffer.
 *
 * Row heights are *measured* after render — `rowHeight` is only used as the
 * initial estimate for unmeasured rows. This keeps the total scroll height in
 * sync with the real content so variable-height rows (e.g. 1- vs 2-line news
 * headlines) don't leave dead space below the last item.
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
  const [heights, setHeights] = useState<number[]>([]);

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

  // Drop stale measurements when the item set changes.
  useEffect(() => {
    setHeights([]);
  }, [items]);

  // Cumulative offset of each row (offsets[i] = top of row i).
  const offsets = useMemo(() => {
    const arr = new Array<number>(items.length + 1);
    arr[0] = 0;
    for (let i = 0; i < items.length; i++) {
      arr[i + 1] = arr[i] + (heights[i] ?? rowHeight);
    }
    return arr;
  }, [items.length, heights, rowHeight]);

  const total = offsets[items.length] ?? 0;

  // Visible window (linear scan — these feeds are short).
  let startIdx = 0;
  while (startIdx < items.length && offsets[startIdx + 1] <= scrollTop) {
    startIdx++;
  }
  let endIdx = startIdx;
  const viewportBottom = scrollTop + clientHeight;
  while (endIdx < items.length && offsets[endIdx] < viewportBottom) {
    endIdx++;
  }
  startIdx = Math.max(0, startIdx - overscan);
  endIdx = Math.min(items.length, endIdx + overscan);

  const slice = items.slice(startIdx, endIdx);
  const offsetY = offsets[startIdx] ?? 0;

  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  rowRefs.current = [];

  // Measure rendered rows; commit only when something actually changed.
  useLayoutEffect(() => {
    if (slice.length === 0) return;
    setHeights((prev) => {
      let changed = false;
      const next = prev.slice();
      next.length = items.length;
      slice.forEach((_, i) => {
        const el = rowRefs.current[i];
        if (!el) return;
        const measured = el.offsetHeight;
        const idx = startIdx + i;
        if (measured > 0 && next[idx] !== measured) {
          next[idx] = measured;
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  });

  if (items.length === 0) {
    return (
      <div
        className={`flex items-center justify-center py-6 text-xs text-aeris-muted ${className ?? ""}`}
      >
        {emptyText ?? "No items"}
      </div>
    );
  }

  return (
    <div ref={ref} className={`overflow-auto ${className ?? ""}`}>
      <div style={{ height: total, position: "relative" }}>
        <div style={{ transform: `translateY(${offsetY}px)` }}>
          {slice.map((item, i) => (
            <div
              key={startIdx + i}
              ref={(el) => {
                rowRefs.current[i] = el;
              }}
            >
              {render(item, startIdx + i)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
