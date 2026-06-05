"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { clsx } from "clsx";
import { AerisLoadingLogo } from "@/components/ui/AerisLoadingLogo";

type DataLoadingPopupProps = {
  active: boolean;
  message?: string;
  className?: string;
  blocking?: boolean;
};

export function DataLoadingPopup({
  active,
  message = "Loading data, please wait...",
  className,
  blocking = false,
}: DataLoadingPopupProps) {
  const progressRef = useRef<number>(0);
  const [queueIndex, setQueueIndex] = useState(0);
  const [progress, setProgress] = useState(12);
  const queue = useMemo(
    () => [
      "Generating buildings...",
      "Analyzing terrain...",
      "Identifying critical locations...",
      "Optimizing mesh batches...",
      "Syncing map context...",
    ],
    [],
  );

  useEffect(() => {
    if (!active) {
      setQueueIndex(0);
      setProgress(12);
      progressRef.current = 0;
      return;
    }
    const queueTimer = setInterval(() => {
      setQueueIndex((i) => (i + 1) % queue.length);
    }, 1100);
    const progressTimer = setInterval(() => {
      progressRef.current = Math.min(90, progressRef.current + 8);
      setProgress(progressRef.current);
    }, 340);
    return () => {
      clearInterval(queueTimer);
      clearInterval(progressTimer);
    };
  }, [active, queue.length]);

  if (!active) return null;

  return (
    <div
      className={clsx(
        "absolute inset-0 z-30 flex items-center justify-center p-4",
        blocking ? "pointer-events-auto bg-aeris-bg/45 backdrop-blur-[2px]" : "pointer-events-none",
        className,
      )}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <div className="relative min-w-[280px] overflow-hidden rounded-2xl border border-aeris-border bg-aeris-surface px-4 py-3 text-aeris-text shadow-xl">
        <AerisLoadingLogo
          size="sm"
          variant="char"
          className="pointer-events-none absolute -bottom-1 -right-1 max-h-[88px] opacity-[0.14]"
        />
        <div className="relative flex items-center gap-3">
          <div className="flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-xl border border-aeris-border bg-aeris-elev/55 px-1">
            <AerisLoadingLogo size="sm" variant="glyph" className="max-h-14" />
          </div>
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-aeris-muted">
              {message}
            </div>
            <div className="mt-2 text-[13px] font-semibold text-aeris-text">
              {queue[queueIndex]}
            </div>
            <div className="mt-2 h-1.5 w-44 overflow-hidden rounded-full bg-aeris-elev">
              <div
                className="h-full rounded-full bg-aeris-accent transition-[width] duration-300 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
