"use client";

import type { Map as MLMap } from "maplibre-gl";
import {
  fetchRadarFrames,
  ensureRadarLayer,
  ensureSatelliteLayer,
  fetchSatelliteFrames,
  setRadarFrameOnSlot,
  setSatelliteFrameOnSlot,
  setImageryBufferOpacity,
  setImageryBufferNowcastTint,
  resetImageryBufferOpacities,
  raiseImageryBufferSlot,
  imageryBufferSourceId,
  getGibsRequestDiagnostics,
  getLiveWeatherSourceContract,
  normalizeLiveImagerySource,
  type FrameKind,
  type ImageryBufferSlot,
  type SatelliteFrameProvider,
  type LiveImagerySource,
  type RadarFrame,
} from "@/services/satellite-frames";
import {
  WEATHER_IMAGERY_CROSSFADE_MS,
  WEATHER_TILE_READY_MAX_WAIT_MS,
  WEATHER_LOOP_WRAP_CROSSFADE_FACTOR,
  WEATHER_FRAME_PRELOAD_LEAD_MS,
  WEATHER_ADVANCE_MAX_STALL_MS,
  easeInOutCubic,
  weatherFrameHoldMs,
  weatherLoopEndHoldMs,
} from "@/config/weather-animation";
import type { Typhoon } from "@/services/typhoon-tracks";
import { DEVICE_TIER, detectDeviceTier, type DeviceTier } from "@/lib/device-tier";
import { markOverlayReady } from "@/lib/overlay-ready";

export type LiveWeatherPerformanceProfile = "quality" | "balanced" | "performance";

export const TYPHOON_FOCUS_EVENT = "aeris:typhoon-focus" as const;
export type TyphoonFocusDetail = { storm: Typhoon | null };

export const PAR_STORMS_EVENT = "aeris:par-storms" as const;
export type ParStormsDetail = { storms: Typhoon[] };

const SATELLITE_REFRESH_INTERVAL_MS = 60_000;
const RADAR_REFRESH_INTERVAL_MS = 60_000;
const TYPHOON_FRAME_FACTOR = 0.58;

type CrossfadePhase = {
  fromSlot: ImageryBufferSlot;
  toSlot: ImageryBufferSlot;
  startedAtMs: number;
  durationMs: number;
  isWrap: boolean;
};

type PreloadState = {
  index: number;
  slot: ImageryBufferSlot;
  startedAtMs: number;
};

type State = {
  source: LiveImagerySource;
  timeline: {
    frames: RadarFrame[];
    index: number;
  };
  activeSlot: ImageryBufferSlot;
  crossfade: CrossfadePhase | null;
  preload: PreloadState | null;
  activeNowcastTint: boolean;
  nextAdvanceAtMs: number;
  /** Deadline for waiting on unready incoming tiles before advancing anyway. */
  advanceStallDeadlineMs: number | null;
  tickId: number | null;
  mapMode: "2d" | "3d";
  typhoonFocus: Typhoon | null;
  performanceProfile: LiveWeatherPerformanceProfile;
  fallbackMessage: string | null;
  satelliteProvider: SatelliteFrameProvider;
  satelliteRefreshTimer: ReturnType<typeof setInterval> | null;
  radarRefreshTimer: ReturnType<typeof setInterval> | null;
  overlayActive: boolean;
};

const store = new WeakMap<MLMap, State>();

export type LiveWeatherFrameDetail = {
  index: number;
  count: number;
  time: string;
  source: LiveImagerySource;
  kind: FrameKind;
  attribution: string;
};

export type LiveWeatherHealth = "live" | "delayed" | "fallback";
export const LIVE_WEATHER_STATUS_EVENT = "aeris:live-weather-status" as const;
export type LiveWeatherStatusDetail = {
  source: LiveImagerySource;
  health: LiveWeatherHealth;
  frameAgeMinutes: number | null;
  message: string | null;
  clampedToPublishedFrame: boolean;
};

function currentFrame(st: State): RadarFrame | null {
  return st.timeline.frames[st.timeline.index] ?? null;
}

/** Newest frame in the loop — feed freshness is judged against this, not the playhead. */
function newestFrame(st: State): RadarFrame | null {
  return st.timeline.frames[st.timeline.frames.length - 1] ?? null;
}

function satelliteFallbackMessage(
  source: Exclude<LiveImagerySource, "radar">,
  provider: SatelliteFrameProvider,
): string | null {
  // GIBS is the *primary* feed for Air Mass — only IR treats it as a fallback.
  if (source !== "himawari-ir" || provider !== "gibs-fallback") return null;
  return "RainViewer IR offline — showing NASA GIBS Himawari-9.";
}

function devLog(tag: string, payload: Record<string, unknown>) {
  if (process.env.NODE_ENV === "production") return;
  // eslint-disable-next-line no-console
  console.debug(`[live-weather] ${tag}`, payload);
}

/**
 * Adopt the provider's authoritative frame window while keeping the playhead
 * on the same timestamp when it still exists. Adds new frames and prunes
 * expired ones — appending alone is what previously caused the loop to animate
 * dead tiles (blank imagery) the longer the tab stayed open.
 */
function reconcileTimelineFrames(st: State, freshFrames: RadarFrame[]) {
  const existingTimes = new Set(st.timeline.frames.map((f) => f.time));
  const freshTimes = new Set(freshFrames.map((f) => f.time));
  const changed =
    freshFrames.some((f) => !existingTimes.has(f.time)) ||
    st.timeline.frames.some((f) => !freshTimes.has(f.time));
  if (changed) {
    setTimelineFrames(st, freshFrames, {
      preservePlayheadTime: currentFrame(st)?.time ?? null,
    });
  }
}

function setTimelineFrames(
  st: State,
  frames: RadarFrame[],
  options?: { preservePlayheadTime?: string | null },
) {
  st.timeline.frames = frames;
  if (frames.length === 0) {
    st.timeline.index = 0;
    return;
  }
  const desired = options?.preservePlayheadTime ?? null;
  if (desired) {
    const matchIdx = frames.findIndex((f) => f.time === desired);
    if (matchIdx >= 0) {
      st.timeline.index = matchIdx;
      return;
    }
  }
  st.timeline.index = Math.max(0, frames.length - 1);
}

function frameHoldMs(st: State): number {
  const base = weatherFrameHoldMs(st.source === "radar" ? "radar" : "satellite");
  const profileFactor =
    st.performanceProfile === "quality"
      ? 1
      : st.performanceProfile === "performance"
        ? 1.55
        : 1.2;
  const hiddenFactor =
    typeof document !== "undefined" && document.hidden ? 2.4 : 1;
  const typhoonFactor = st.typhoonFocus ? TYPHOON_FRAME_FACTOR : 1;
  return Math.round(base * profileFactor * hiddenFactor * typhoonFactor);
}

function crossfadeDurationMs(st: State, isWrap = false): number {
  const profileFactor =
    st.performanceProfile === "performance" ? 0.72 : 1;
  const typhoonFactor = st.typhoonFocus ? TYPHOON_FRAME_FACTOR : 1;
  const wrapFactor = isWrap ? WEATHER_LOOP_WRAP_CROSSFADE_FACTOR : 1;
  return Math.round(
    WEATHER_IMAGERY_CROSSFADE_MS * profileFactor * typhoonFactor * wrapFactor,
  );
}

function holdAfterIndexMs(st: State, index: number): number {
  const len = st.timeline.frames.length;
  const isLastBeforeWrap = len > 1 && index === len - 1;
  const profileFactor =
    st.performanceProfile === "quality"
      ? 1
      : st.performanceProfile === "performance"
        ? 1.55
        : 1.2;
  const hiddenFactor =
    typeof document !== "undefined" && document.hidden ? 2.4 : 1;
  const typhoonFactor = st.typhoonFocus ? TYPHOON_FRAME_FACTOR : 1;
  const base = isLastBeforeWrap
    ? weatherLoopEndHoldMs(st.source === "radar" ? "radar" : "satellite")
    : weatherFrameHoldMs(st.source === "radar" ? "radar" : "satellite");
  return Math.round(base * profileFactor * hiddenFactor * typhoonFactor);
}

type SatelliteRefreshOptions = {
  restartTicker?: boolean;
  preserveAnimation?: boolean;
};

async function refreshSatelliteFrames(
  map: MLMap,
  source: Exclude<LiveImagerySource, "radar">,
  options?: SatelliteRefreshOptions,
) {
  const st = store.get(map);
  if (!st || st.source !== source) return;
  const hadFrames = st.timeline.frames.length > 0;
  const result = await fetchSatelliteFrames(source);
  const cur = store.get(map);
  if (!cur || cur.source !== source) return;
  const previousProvider = cur.satelliteProvider;
  // Keep showing cached RainViewer frames through a transient outage, but only
  // while they're within the staleness contract — RainViewer drops expired
  // frame paths, so animating them past that point renders blank tiles.
  const newestCachedMs = hadFrames
    ? new Date(cur.timeline.frames[cur.timeline.frames.length - 1].time).getTime()
    : Number.NaN;
  const cacheStillFresh =
    Number.isFinite(newestCachedMs) &&
    Date.now() - newestCachedMs <
      getLiveWeatherSourceContract(source).staleAfterMinutes * 60_000;
  const canUseCacheFirst =
    result.provider === "gibs-fallback" &&
    hadFrames &&
    previousProvider === "rainviewer-satellite" &&
    cacheStillFresh;
  if (canUseCacheFirst) {
    cur.fallbackMessage = "Live IR feed stalled — holding the last good frames.";
    emitStatus(cur, cur.fallbackMessage);
    if (options?.restartTicker) {
      startTicker(map);
    }
    return;
  }
  const providerChanged = previousProvider !== result.provider;
  cur.satelliteProvider = result.provider;

  if (options?.preserveAnimation && hadFrames && !providerChanged) {
    reconcileTimelineFrames(cur, result.frames);
    cur.fallbackMessage = satelliteFallbackMessage(source, result.provider);
    emitStatus(cur, cur.fallbackMessage);
    return;
  }

  setTimelineFrames(cur, result.frames);
  const frame = currentFrame(cur);
  if (!frame) return;
  ensureSatelliteLayer(map, source, frame, cur.satelliteProvider);
  cur.activeSlot = 0;
  cur.crossfade = null;
  cur.preload = null;
  cur.activeNowcastTint = false;
  cur.nextAdvanceAtMs = performance.now() + frameHoldMs(cur);
  cur.fallbackMessage = satelliteFallbackMessage(source, result.provider);
  emitStatus(cur, cur.fallbackMessage);
  if (options?.restartTicker) {
    startTicker(map);
  }
}

async function refreshRadarFrames(
  map: MLMap,
  options?: { preserveAnimation?: boolean },
) {
  const st = store.get(map);
  if (!st || st.source !== "radar") return;
  let result;
  try {
    result = await fetchRadarFrames();
  } catch (error) {
    const cur = store.get(map);
    if (!cur || cur.source !== "radar") return;
    cur.fallbackMessage =
      cur.timeline.frames.length > 0
        ? `Radar refresh failed; showing last-known-good frame (${(error as Error).message}).`
        : `Radar refresh failed (${(error as Error).message}).`;
    emitStatus(cur, cur.fallbackMessage);
    return;
  }
  const cur = store.get(map);
  if (!cur || cur.source !== "radar") return;
  if (options?.preserveAnimation && cur.timeline.frames.length > 0) {
    reconcileTimelineFrames(cur, result.frames);
    cur.fallbackMessage = null;
    emitStatus(cur, null);
    return;
  }
  setTimelineFrames(cur, result.frames);
  cur.fallbackMessage = null;
  const frame = currentFrame(cur);
  if (!frame) return;
  ensureRadarLayer(map, frame);
  cur.activeSlot = 0;
  cur.crossfade = null;
  cur.preload = null;
  cur.activeNowcastTint = false;
  cur.nextAdvanceAtMs = performance.now() + frameHoldMs(cur);
  emitStatus(cur, null);
  startTicker(map);
}

function startSatelliteRefreshTimer(
  map: MLMap,
  source: Exclude<LiveImagerySource, "radar">,
) {
  const st = store.get(map);
  if (!st) return;
  if (st.satelliteRefreshTimer) clearInterval(st.satelliteRefreshTimer);
  st.satelliteRefreshTimer = setInterval(() => {
    void refreshSatelliteFrames(map, source, { preserveAnimation: true });
  }, SATELLITE_REFRESH_INTERVAL_MS);
}

function startRadarRefreshTimer(map: MLMap) {
  const st = store.get(map);
  if (!st) return;
  if (st.radarRefreshTimer) clearInterval(st.radarRefreshTimer);
  st.radarRefreshTimer = setInterval(() => {
    void refreshRadarFrames(map, { preserveAnimation: true });
  }, RADAR_REFRESH_INTERVAL_MS);
}

function stopSatelliteRefreshTimer(map: MLMap) {
  const st = store.get(map);
  if (!st || !st.satelliteRefreshTimer) return;
  clearInterval(st.satelliteRefreshTimer);
  st.satelliteRefreshTimer = null;
}

function stopRadarRefreshTimer(map: MLMap) {
  const st = store.get(map);
  if (!st || !st.radarRefreshTimer) return;
  clearInterval(st.radarRefreshTimer);
  st.radarRefreshTimer = null;
}

function syncImageryRefreshTimers(map: MLMap) {
  const st = store.get(map);
  if (!st || !st.overlayActive) {
    stopSatelliteRefreshTimer(map);
    stopRadarRefreshTimer(map);
    return;
  }
  if (st.source === "radar") {
    stopSatelliteRefreshTimer(map);
    startRadarRefreshTimer(map);
    return;
  }
  stopRadarRefreshTimer(map);
  startSatelliteRefreshTimer(map, st.source);
}

function frameAttribution(st: State): string {
  if (st.source === "radar") return "RainViewer Radar";
  return st.satelliteProvider === "rainviewer-satellite"
    ? "RainViewer Infrared"
    : st.source === "himawari-airmass"
      ? "NASA GIBS / Himawari-9 Air Mass"
      : "NASA GIBS / Himawari-9 Clean IR (Band 13)";
}

function getFrameAgeMinutes(frame: RadarFrame | null): number | null {
  if (!frame) return null;
  const ts = new Date(frame.time).getTime();
  if (!Number.isFinite(ts)) return null;
  return Math.max(0, Math.round((Date.now() - ts) / 60_000));
}

function resolveLiveWeatherHealth(
  source: LiveImagerySource,
  frame: RadarFrame | null,
  fallbackMessage: string | null,
): LiveWeatherHealth {
  if (fallbackMessage) return "fallback";
  const age = getFrameAgeMinutes(frame);
  if (age == null) return "delayed";
  const contract = getLiveWeatherSourceContract(source);
  const delayedThreshold = contract.expectedLatencyMinutes + contract.timeStepMinutes * 2;
  return age > delayedThreshold ? "delayed" : "live";
}

function emitStatus(st: State, message: string | null = st.fallbackMessage) {
  const frame = newestFrame(st);
  const diagnostics =
    st.source === "radar" || st.satelliteProvider !== "gibs-fallback" || !frame
      ? { clamped: false }
      : getGibsRequestDiagnostics(frame.time);
  const detail: LiveWeatherStatusDetail = {
    source: st.source,
    health: resolveLiveWeatherHealth(st.source, frame, message),
    frameAgeMinutes: getFrameAgeMinutes(frame),
    message,
    clampedToPublishedFrame: diagnostics.clamped,
  };
  window.dispatchEvent(new CustomEvent<LiveWeatherStatusDetail>(LIVE_WEATHER_STATUS_EVENT, { detail }));
}

function emitFrame(st: State) {
  const fr = currentFrame(st);
  if (!fr) return;
  window.dispatchEvent(
    new CustomEvent<LiveWeatherFrameDetail>("aeris:live-weather-frame", {
      detail: {
        index: st.timeline.index,
        count: st.timeline.frames.length,
        time: fr.time,
        source: st.source,
        kind: fr.kind ?? "observed",
        attribution: frameAttribution(st),
      },
    }),
  );
  emitStatus(st);
}

function stopTicker(map: MLMap) {
  const s = store.get(map);
  if (!s || s.tickId == null) return;
  cancelAnimationFrame(s.tickId);
  s.tickId = null;
}

function shouldRunWeatherTicker(s: State): boolean {
  return (
    s.mapMode === "2d" &&
    s.overlayActive &&
    s.timeline.frames.length > 0
  );
}

function isImagerySourceReady(
  map: MLMap,
  source: LiveImagerySource,
  slot: ImageryBufferSlot,
): boolean {
  const sourceId = imageryBufferSourceId(source, slot);
  const typed = map as MLMap & { isSourceLoaded?: (id: string) => boolean };
  if (typeof typed.isSourceLoaded !== "function") return true;
  if (!map.getSource(sourceId)) return true;
  try {
    return typed.isSourceLoaded(sourceId);
  } catch {
    return false;
  }
}

function waitForImagerySlot(
  map: MLMap,
  source: LiveImagerySource,
  slot: ImageryBufferSlot,
): Promise<void> {
  if (isImagerySourceReady(map, source, slot)) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    // Resolves when the slot's tiles load, or after the max wait — the blend
    // starts regardless so a slow tile server can't stall the animation.
    let timer = 0;
    const finish = () => {
      map.off("sourcedata", onData);
      window.clearTimeout(timer);
      resolve();
    };
    const onData = () => {
      if (isImagerySourceReady(map, source, slot)) finish();
    };
    map.on("sourcedata", onData);
    timer = window.setTimeout(finish, WEATHER_TILE_READY_MAX_WAIT_MS);
  });
}

function applyFrameToSlot(
  map: MLMap,
  st: State,
  slot: ImageryBufferSlot,
  frame: RadarFrame,
) {
  if (st.source === "radar") {
    setRadarFrameOnSlot(map, slot, frame);
  } else {
    setSatelliteFrameOnSlot(
      map,
      slot,
      st.source,
      frame,
      st.satelliteProvider,
    );
  }
}

function updateCrossfadeOpacities(map: MLMap, st: State, t: number) {
  const eased = easeInOutCubic(t);
  if (!st.crossfade) return;
  setImageryBufferOpacity(map, st.source, st.crossfade.fromSlot, 1 - eased);
  setImageryBufferOpacity(map, st.source, st.crossfade.toSlot, eased);
}

function preloadNextFrame(map: MLMap, st: State) {
  if (st.timeline.frames.length === 0) return;
  const nextIdx = advanceTimelineIndex(st);
  if (st.preload?.index === nextIdx) return;
  const inactiveSlot = (1 - st.activeSlot) as ImageryBufferSlot;
  const nextFrame = st.timeline.frames[nextIdx];
  if (!nextFrame) return;
  applyFrameToSlot(map, st, inactiveSlot, nextFrame);
  setImageryBufferOpacity(map, st.source, inactiveSlot, 0);
  st.preload = {
    index: nextIdx,
    slot: inactiveSlot,
    startedAtMs: performance.now(),
  };
  devLog("preload", {
    index: nextIdx,
    slot: inactiveSlot,
    source: st.source,
  });
}

async function beginCrossfade(
  map: MLMap,
  st: State,
  nextFrame: RadarFrame,
  isWrap: boolean,
) {
  const inactiveSlot = (1 - st.activeSlot) as ImageryBufferSlot;
  const preloadHitsNext =
    st.preload?.index === st.timeline.index && st.preload.slot === inactiveSlot;
  if (!preloadHitsNext) {
    applyFrameToSlot(map, st, inactiveSlot, nextFrame);
  }
  const waitStartMs = performance.now();
  await waitForImagerySlot(map, st.source, inactiveSlot);
  const waitMs = Math.round(performance.now() - waitStartMs);
  const cur = store.get(map);
  if (!cur || cur.mapMode !== "2d") return;
  raiseImageryBufferSlot(map, cur.source, inactiveSlot);
  const nextIsNowcast = nextFrame.kind === "nowcast";
  setImageryBufferNowcastTint(map, cur.source, inactiveSlot, nextIsNowcast);
  const durationMs = crossfadeDurationMs(cur, isWrap);
  cur.crossfade = {
    fromSlot: cur.activeSlot,
    toSlot: inactiveSlot,
    startedAtMs: performance.now(),
    durationMs,
    isWrap,
  };
  cur.preload = null;
  if (isWrap || waitMs > WEATHER_TILE_READY_MAX_WAIT_MS - 100) {
    devLog(isWrap ? "wrap" : "crossfade-rushed", {
      waitMs,
      preloaded: preloadHitsNext,
      tilesReady: waitMs < WEATHER_TILE_READY_MAX_WAIT_MS,
      isWrap,
    });
  }
}

function advanceTimelineIndex(st: State): number {
  const len = st.timeline.frames.length;
  if (len === 0) return 0;
  return (st.timeline.index + 1) % len;
}

function startTicker(map: MLMap) {
  const s = store.get(map);
  if (!s || !shouldRunWeatherTicker(s)) return;
  stopTicker(map);

  emitFrame(s);
  s.crossfade = null;
  s.preload = null;
  s.advanceStallDeadlineMs = null;
  s.nextAdvanceAtMs = performance.now() + holdAfterIndexMs(s, s.timeline.index);
  resetImageryBufferOpacities(map, s.source, s.activeSlot);
  const initialFrame = currentFrame(s);
  const initialIsNowcast = initialFrame?.kind === "nowcast";
  setImageryBufferNowcastTint(map, s.source, s.activeSlot, initialIsNowcast);
  s.activeNowcastTint = initialIsNowcast;

  const loop = () => {
    const st = store.get(map);
    if (!st || !shouldRunWeatherTicker(st)) {
      if (st) st.tickId = null;
      return;
    }

    if (typeof document !== "undefined" && document.hidden) {
      st.tickId = requestAnimationFrame(loop);
      return;
    }

    const now = performance.now();

    if (st.crossfade) {
      const elapsed = now - st.crossfade.startedAtMs;
      const t = Math.min(1, elapsed / st.crossfade.durationMs);
      updateCrossfadeOpacities(map, st, t);
      if (t >= 1) {
        setImageryBufferNowcastTint(
          map,
          st.source,
          st.crossfade.fromSlot,
          false,
        );
        st.activeSlot = st.crossfade.toSlot;
        st.crossfade = null;
        resetImageryBufferOpacities(map, st.source, st.activeSlot);
        const fr = currentFrame(st);
        const isNowcast = fr?.kind === "nowcast";
        setImageryBufferNowcastTint(
          map,
          st.source,
          st.activeSlot,
          isNowcast,
        );
        st.activeNowcastTint = isNowcast;
        st.nextAdvanceAtMs = now + holdAfterIndexMs(st, st.timeline.index);
        if (fr) {
          try {
            emitFrame(st);
          } catch (err) {
            console.error("[live-weather] crossfade complete", err);
          }
        }
      }
    } else {
      if (!st.preload && now >= st.nextAdvanceAtMs - WEATHER_FRAME_PRELOAD_LEAD_MS) {
        try {
          preloadNextFrame(map, st);
        } catch (err) {
          console.error("[live-weather] preload", err);
        }
      }
      if (now >= st.nextAdvanceAtMs) {
        const prevIdx = st.timeline.index;
        const nextIdx = advanceTimelineIndex(st);
        if (st.preload?.index !== nextIdx) {
          try {
            preloadNextFrame(map, st);
          } catch (err) {
            console.error("[live-weather] preload", err);
          }
        }
        // Hold the current frame while the incoming buffer's tiles load —
        // blending into an empty buffer makes the overlay flash/disappear.
        // Advance anyway after a bounded stall so a dead tile server can't
        // freeze the loop.
        const inactiveSlot = (1 - st.activeSlot) as ImageryBufferSlot;
        const incomingReady = isImagerySourceReady(map, st.source, inactiveSlot);
        if (!incomingReady && st.advanceStallDeadlineMs == null) {
          st.advanceStallDeadlineMs = now + WEATHER_ADVANCE_MAX_STALL_MS;
        }
        if (incomingReady || now >= (st.advanceStallDeadlineMs ?? 0)) {
          st.advanceStallDeadlineMs = null;
          st.nextAdvanceAtMs = Number.POSITIVE_INFINITY;
          const isWrap = nextIdx === 0 && prevIdx !== 0;
          st.timeline.index = nextIdx;
          const fr = currentFrame(st);
          if (fr) {
            void beginCrossfade(map, st, fr, isWrap).catch((err) => {
              console.error("[live-weather] crossfade start", err);
            });
          }
        }
      }
    }

    const tail = store.get(map);
    if (!tail || !shouldRunWeatherTicker(tail)) {
      if (tail) tail.tickId = null;
      return;
    }
    tail.tickId = requestAnimationFrame(loop);
  };

  const st0 = store.get(map);
  if (!st0) return;
  st0.tickId = requestAnimationFrame(loop);
}

export function initLiveWeatherOverlay(map: MLMap) {
  if (store.has(map)) return;

  const tier = detectDeviceTier();
  const caps = DEVICE_TIER[tier];
  const state: State = {
    source: "radar",
    timeline: {
      frames: [],
      index: 0,
    },
    activeSlot: 0,
    crossfade: null,
    preload: null,
    activeNowcastTint: false,
    nextAdvanceAtMs: 0,
    advanceStallDeadlineMs: null,
    tickId: null,
    mapMode: "2d",
    typhoonFocus: null,
    performanceProfile: caps.profile,
    fallbackMessage: null,
    satelliteProvider: "gibs-fallback",
    satelliteRefreshTimer: null,
    radarRefreshTimer: null,
    overlayActive: true,
  };
  store.set(map, state);

  // Typhoon focus tightens the satellite/radar frame cadence (see
  // `TYPHOON_FRAME_FACTOR`); keep listening even though wind was removed.
  const onTyphoonFocus = (ev: Event) => {
    const ce = ev as CustomEvent<TyphoonFocusDetail>;
    const st = store.get(map);
    if (!st) return;
    st.typhoonFocus = ce.detail?.storm ?? null;
    startTicker(map);
  };
  window.addEventListener(TYPHOON_FOCUS_EVENT, onTyphoonFocus);

  void fetchRadarFrames()
    .then((result) => {
      const st = store.get(map);
      if (!st || st.source !== "radar") return;
      setTimelineFrames(st, result.frames);
      st.satelliteProvider = "gibs-fallback";
      st.fallbackMessage = null;
      if (result.frames.length) {
        const frame = currentFrame(st);
        if (!frame) return;
        ensureRadarLayer(map, frame);
        st.activeSlot = 0;
        st.crossfade = null;
        st.preload = null;
        st.activeNowcastTint = false;
        st.nextAdvanceAtMs = performance.now() + frameHoldMs(st);
        emitStatus(st, null);
        startTicker(map);

        // Confirm to the boot screen that radar imagery has actually appeared
        // (layer added + first frame's tiles loaded) before revealing the
        // terminal — not just that the RainViewer index responded.
        void waitForImagerySlot(map, "radar", st.activeSlot).then(() => {
          markOverlayReady("radar", { status: "ok" });
        });
      } else {
        markOverlayReady("radar", { status: "warn", detail: "no frames" });
      }
    })
    .catch((error) => {
      const st = store.get(map);
      if (!st || st.source !== "radar") return;
      console.warn("[live-weather] radar init failed", error);
      st.fallbackMessage =
        st.timeline.frames.length > 0
          ? `Radar feed unavailable; using last-known-good frame (${(error as Error).message}).`
          : `Radar feed unavailable (${(error as Error).message}).`;
      emitStatus(st, st.fallbackMessage);
      markOverlayReady("radar", { status: "fail", detail: "feed down" });
    });
  syncImageryRefreshTimers(map);

  // Force-verify the satellite feed at boot so the loading screen can gate on
  // it. Radar stays the visible default (radar/satellite are mutually exclusive
  // imagery layers), so we confirm satellite frames are *available* rather than
  // painting a hidden layer.
  void fetchSatelliteFrames("himawari-ir")
    .then((result) => {
      markOverlayReady("satellite", {
        status: result.frames.length ? "ok" : "warn",
        detail: result.frames.length ? undefined : "no frames",
      });
    })
    .catch(() => {
      markOverlayReady("satellite", { status: "fail", detail: "feed down" });
    });

  map.once("remove", () => {
    window.removeEventListener(TYPHOON_FOCUS_EVENT, onTyphoonFocus);
    destroyLiveWeatherOverlay(map);
  });
}

export function reattachLiveWeatherImageryAfterStyleChange(map: MLMap) {
  const s = store.get(map);
  if (!s) return;
  const frame = currentFrame(s);
  if (frame) {
    if (s.source === "radar") {
      ensureRadarLayer(map, frame);
    } else {
      ensureSatelliteLayer(map, s.source, frame, s.satelliteProvider);
    }
    s.activeSlot = 0;
    s.crossfade = null;
    s.preload = null;
    s.activeNowcastTint = false;
    resetImageryBufferOpacities(map, s.source, s.activeSlot);
  }
  notifyLiveWeatherMapMode(map, s.mapMode);
}

export function destroyLiveWeatherOverlay(map: MLMap) {
  const s = store.get(map);
  if (!s) return;
  stopTicker(map);
  stopSatelliteRefreshTimer(map);
  stopRadarRefreshTimer(map);
  store.delete(map);
}

export function notifyLiveWeatherMapMode(map: MLMap, mode: "2d" | "3d") {
  const s = store.get(map);
  if (!s) return;
  s.mapMode = mode;
  if (mode === "3d") {
    stopTicker(map);
    return;
  }
  if (shouldRunWeatherTicker(s)) {
    startTicker(map);
  }
}

export function isLiveWeatherTickerRunning(map: MLMap): boolean {
  const s = store.get(map);
  return s != null && s.tickId != null;
}

export function isImageryRefreshTimerRunning(map: MLMap): boolean {
  const s = store.get(map);
  return s != null && (s.radarRefreshTimer != null || s.satelliteRefreshTimer != null);
}

export function setLiveWeatherOverlayActive(map: MLMap | null, active: boolean) {
  if (!map) return;
  const s = store.get(map);
  if (!s || s.overlayActive === active) return;
  s.overlayActive = active;
  if (!active) {
    stopTicker(map);
    stopSatelliteRefreshTimer(map);
    stopRadarRefreshTimer(map);
    return;
  }
  syncImageryRefreshTimers(map);
  if (shouldRunWeatherTicker(s)) {
    startTicker(map);
  }
}

export function applyLiveWeatherDeviceTier(
  map: MLMap | null,
  tier: DeviceTier = detectDeviceTier(),
) {
  if (!map) return;
  const s = store.get(map);
  if (!s) return;
  setLiveWeatherPerformanceProfile(map, DEVICE_TIER[tier].profile);
}

export function setLiveWeatherPerformanceProfile(
  map: MLMap | null,
  profile: LiveWeatherPerformanceProfile,
) {
  if (!map) return;
  const s = store.get(map);
  if (!s) return;
  if (s.performanceProfile === profile) return;
  s.performanceProfile = profile;
  startTicker(map);
}

export function setLiveWeatherImagerySource(
  map: MLMap | null,
  rawSource: LiveImagerySource | string,
) {
  if (!map) return;
  const s = store.get(map);
  if (!s) return;
  const source = normalizeLiveImagerySource(String(rawSource));
  if (s.source === source) return;
  s.source = source;
  s.fallbackMessage = null;
  s.activeSlot = 0;
  s.crossfade = null;
  s.preload = null;
  s.activeNowcastTint = false;
  s.advanceStallDeadlineMs = null;
  stopTicker(map);

  if (source === "radar") {
    void refreshRadarFrames(map);
  } else {
    s.timeline.frames = [];
    s.timeline.index = 0;
    void refreshSatelliteFrames(map, source, { restartTicker: true });
  }
  syncImageryRefreshTimers(map);
}
