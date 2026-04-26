"use client";

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
  label = "Last successful refresh",
  hideWhenEmpty = true,
}: {
  source: string;
  label?: string;
  hideWhenEmpty?: boolean;
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
    <div className="text-[10px] text-aeris-muted/80">
      <span className={`inline-block mr-1 ${toneClass}`}>{tone}</span>
      {label} {formatAge(freshness?.lastOk)}
    </div>
  );
}
