"use client";

import { clsx } from "clsx";

type DataLoadingPopupProps = {
  active: boolean;
  message?: string;
  className?: string;
};

export function DataLoadingPopup({
  active,
  message = "Loading data, please wait...",
  className,
}: DataLoadingPopupProps) {
  if (!active) return null;

  return (
    <div
      className={clsx(
        "pointer-events-none absolute inset-0 z-20 flex items-start justify-center p-3",
        className,
      )}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <div className="mt-1 inline-flex items-center gap-2 rounded-md border border-aeris-border bg-aeris-surface/95 px-3 py-1.5 text-[11px] font-medium text-aeris-text shadow-lg backdrop-blur-sm">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-aeris-accent animate-pulse" />
        <span>{message}</span>
      </div>
    </div>
  );
}
