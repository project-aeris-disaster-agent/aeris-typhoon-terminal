/**
 * Weather imagery loop timing — tuned for smooth crossfades similar to
 * Zoom Earth "Smooth" satellite animation (medium speed, ~0.5s blends).
 * @see https://zoom.earth/
 */
export const WEATHER_IMAGERY_CROSSFADE_MS = 480;

/** Milliseconds each frame stays fully visible before the next crossfade. */
export const WEATHER_FRAME_HOLD_MS = {
  radar: 1100,
  satellite: 1900,
} as const;

/** Max wait for the incoming buffer's tiles before starting the blend anyway. */
export const WEATHER_TILE_READY_MAX_WAIT_MS = 750;

/**
 * Broadcast-style "end of loop" hold multiplier — the newest frame lingers
 * this many times longer than a normal hold before the loop wraps back to the
 * oldest scan. Matches the cadence used by Zoom Earth / Windy where the final
 * scan stays on-screen long enough to read before the loop restarts.
 */
export const WEATHER_LOOP_END_HOLD_FACTOR = 2.2;

/**
 * Wrap-only crossfade stretch — the visual jump from the newest frame back to
 * the oldest covers ~2.5 hours of weather, so we deliberately slow that blend
 * down compared to between-frame crossfades.
 */
export const WEATHER_LOOP_WRAP_CROSSFADE_FACTOR = 1.5;

/**
 * Lead time before the scheduled advance at which we eagerly load the next
 * frame's tiles into the inactive buffer. Keeps the crossfade tile-ready so
 * MapLibre never has to fade in a blank source mid-blend.
 */
export const WEATHER_FRAME_PRELOAD_LEAD_MS = 600;

/**
 * If the incoming buffer's tiles still aren't loaded at advance time, hold the
 * current frame (rather than blending into a blank buffer, which makes the
 * overlay flash/disappear) for at most this long before advancing anyway.
 */
export const WEATHER_ADVANCE_MAX_STALL_MS = 4000;

export function weatherFrameHoldMs(source: "radar" | "satellite"): number {
  return source === "radar"
    ? WEATHER_FRAME_HOLD_MS.radar
    : WEATHER_FRAME_HOLD_MS.satellite;
}

/** End-of-loop hold (used for the wrap from newest -> oldest). */
export function weatherLoopEndHoldMs(source: "radar" | "satellite"): number {
  return Math.round(weatherFrameHoldMs(source) * WEATHER_LOOP_END_HOLD_FACTOR);
}

/** Ease-in-out cubic — matches gentle broadcast-style frame transitions. */
export function easeInOutCubic(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}
