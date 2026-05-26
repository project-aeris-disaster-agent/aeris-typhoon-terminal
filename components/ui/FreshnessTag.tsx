"use client";

import { clsx } from "clsx";
import {
  formatAge,
  freshnessTone,
  useFreshness,
} from "@/services/data-freshness";

/**
 * Shared "last successful refresh" tag used by the Alerts, News, Live Reports,
 * Satellite, and Typhoon panels. Previously the same markup and tone-switch
 * block was duplicated in every panel; consolidating it here means one fix
 * touches every freshness indicator.
 */
export function FreshnessTag({
  source,
  label = "Updated",
  hideWhenEmpty = true,
  className,
}: {
  source: string;
  label?: string;
  hideWhenEmpty?: boolean;
  className?: string;
}) {
  const freshness = useFreshness(source);
  if (!freshness && hideWhenEmpty) return null;

  const tone = freshnessTone(freshness);
  const toneClass =
    tone === "danger"
      ? "text-aeris-danger"
      : tone === "warn"
        ? "text-aeris-warn"
        : "text-aeris-ok";

  return (
    <div
      className={clsx(
        "flex items-center gap-1 text-[10px] text-aeris-muted/80",
        className,
      )}
    >
      <span
        className={`inline-block h-1.5 w-1.5 rounded-full ${toneClass}`}
        aria-hidden
      />
      <span>
        {label} {formatAge(freshness?.lastOk)}
      </span>
    </div>
  );
}
