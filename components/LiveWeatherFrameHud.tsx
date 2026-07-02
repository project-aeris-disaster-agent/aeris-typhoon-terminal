"use client";

import { useEffect, useState } from "react";
import { clsx } from "clsx";
import type {
  LiveWeatherFrameDetail,
  LiveWeatherStatusDetail,
} from "@/services/live-weather-overlay";
import { LIVE_WEATHER_STATUS_EVENT } from "@/services/live-weather-overlay";

/**
 * Translates a UTC ISO frame time into a compact, ops-readable label like
 * `04:50 UTC · 31 min ago` (with a `(forecast)` suffix when applicable).
 *
 * The "ago" component is computed against `Date.now()` and ticks every 30s so
 * it stays accurate even while the animation pauses.
 */
function formatFrameLabel(detail: LiveWeatherFrameDetail, now: number): string {
  const ts = new Date(detail.time).getTime();
  if (!Number.isFinite(ts)) return detail.time;

  const yyyy = new Date(ts).getUTCFullYear();
  const mm = String(new Date(ts).getUTCMonth() + 1).padStart(2, "0");
  const dd = String(new Date(ts).getUTCDate()).padStart(2, "0");
  const hh = String(new Date(ts).getUTCHours()).padStart(2, "0");
  const min = String(new Date(ts).getUTCMinutes()).padStart(2, "0");

  const diffMs = ts - now;
  const absMin = Math.max(0, Math.round(Math.abs(diffMs) / 60_000));
  const relative =
    diffMs > 0
      ? `in ${absMin} min`
      : absMin === 0
        ? "just now"
        : `${absMin} min ago`;

  return `${yyyy}-${mm}-${dd} ${hh}:${min} UTC · ${relative}`;
}

const LABEL_TICK_MS = 30_000;

function useLiveWeatherFrameHud() {
  const [frame, setFrame] = useState<LiveWeatherFrameDetail | null>(null);
  const [status, setStatus] = useState<LiveWeatherStatusDetail | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    const onFrame = (ev: Event) => {
      const e = ev as CustomEvent<LiveWeatherFrameDetail>;
      if (!e.detail) return;
      setFrame(e.detail);
      setNow(Date.now());
    };
    const onStatus = (ev: Event) => {
      const e = ev as CustomEvent<LiveWeatherStatusDetail>;
      if (!e.detail) return;
      setStatus(e.detail);
    };
    window.addEventListener("aeris:live-weather-frame", onFrame as EventListener);
    window.addEventListener(
      LIVE_WEATHER_STATUS_EVENT,
      onStatus as EventListener,
    );
    return () => {
      window.removeEventListener(
        "aeris:live-weather-frame",
        onFrame as EventListener,
      );
      window.removeEventListener(
        LIVE_WEATHER_STATUS_EVENT,
        onStatus as EventListener,
      );
    };
  }, []);

  useEffect(() => {
    if (!frame) return;
    const id = setInterval(() => setNow(Date.now()), LABEL_TICK_MS);
    return () => clearInterval(id);
  }, [frame]);

  return { frame, status, now };
}

function frameDotTone(
  frame: LiveWeatherFrameDetail,
  status: LiveWeatherStatusDetail | null,
): string {
  const isForecast = frame.kind === "nowcast";
  if (isForecast) {
    return "bg-orange-400 shadow-[0_0_8px_rgba(251,146,60,0.7)]";
  }
  if (status?.health === "fallback") {
    return "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.7)]";
  }
  if (status?.health === "delayed") {
    return "bg-yellow-400 shadow-[0_0_8px_rgba(250,204,21,0.7)]";
  }
  return "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)]";
}

/**
 * Active live-weather frame metadata (provider, scan time, health dot).
 * Renders inline for sidebar panel headers or as a map-anchored pill.
 */
export function LiveWeatherFrameIndicator({
  variant = "map",
}: {
  variant?: "map" | "panel";
}) {
  const { frame, status, now } = useLiveWeatherFrameHud();
  if (!frame) return null;

  const isForecast = frame.kind === "nowcast";
  const dotTone = frameDotTone(frame, status);

  const content = (
    <>
      <span
        className={clsx("inline-block h-1.5 w-1.5 shrink-0 rounded-full", dotTone)}
        aria-hidden
      />
      <span className="truncate text-aeris-muted">{frame.attribution}</span>
      <span className="truncate text-aeris-text/90">
        {formatFrameLabel(frame, now)}
      </span>
      {isForecast && (
        <span
          className="shrink-0 rounded border border-orange-500/50 bg-orange-500/15 px-1.5 py-0.5 text-chrome font-semibold uppercase tracking-wider text-orange-700 dark:text-orange-300"
          title="Model nowcast — forecast precipitation, not an observed scan"
        >
          Forecast
        </span>
      )}
    </>
  );

  if (variant === "panel") {
    return (
      <span
        className="flex min-w-0 flex-1 items-center justify-end gap-1.5 overflow-hidden px-1 font-mono text-body-sm"
        role="status"
        aria-live="polite"
        aria-label="Active live weather frame"
      >
        {content}
      </span>
    );
  }

  return (
    <div
      className="pointer-events-none absolute bottom-3 right-3 z-10 flex items-center gap-2 rounded-md border border-aeris-border/70 bg-aeris-bg/85 px-2.5 py-1.5 text-body-sm font-mono text-aeris-text shadow-lg backdrop-blur-md"
      role="status"
      aria-live="polite"
      aria-label="Active live weather frame"
    >
      {content}
    </div>
  );
}
