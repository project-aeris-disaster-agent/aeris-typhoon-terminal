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

export function weatherFrameHoldMs(source: "radar" | "satellite"): number {
  return source === "radar"
    ? WEATHER_FRAME_HOLD_MS.radar
    : WEATHER_FRAME_HOLD_MS.satellite;
}

/** Ease-in-out cubic — matches gentle broadcast-style frame transitions. */
export function easeInOutCubic(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}
