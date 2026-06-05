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
  gibsAnimationFrames,
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
  easeInOutCubic,
  weatherFrameHoldMs,
  weatherLoopEndHoldMs,
} from "@/config/weather-animation";
import { WindParticleCanvas } from "@/services/wind-particles";
import type { WindPerformanceProfile } from "@/services/wind-particles";
import type { WindFieldPayload } from "@/services/wind-field-types";
import type { Typhoon } from "@/services/typhoon-tracks";
import { DEVICE_TIER, detectDeviceTier, type DeviceTier } from "@/lib/device-tier";
import { markOverlayReady } from "@/lib/overlay-ready";

export type LiveWeatherPerformanceProfile = WindPerformanceProfile;

export const TYPHOON_FOCUS_EVENT = "aeris:typhoon-focus" as const;
export type TyphoonFocusDetail = { storm: Typhoon | null };

export const PAR_STORMS_EVENT = "aeris:par-storms" as const;
export type ParStormsDetail = { storms: Typhoon[] };

const SATELLITE_REFRESH_INTERVAL_MS = 60_000;
const RADAR_REFRESH_INTERVAL_MS = 60_000;
const TYPHOON_FRAME_FACTOR = 0.58;
const WIND_REFRESH_MS = 900_000;

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
  tickId: number | null;
  windTimer: ReturnType<typeof setInterval> | null;
  wind: WindParticleCanvas | null;
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

function devLog(tag: string, payload: Record<string, unknown>) {
  if (process.env.NODE_ENV === "production") return;
  // eslint-disable-next-line no-console
  console.debug(`[live-weather] ${tag}`, payload);
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
  const canUseCacheFirst =
    result.provider === "gibs-fallback" &&
    hadFrames &&
    previousProvider === "rainviewer-satellite";
  if (canUseCacheFirst) {
    cur.fallbackMessage =
      "Primary satellite feed unavailable; showing last-known-good satellite frame cache.";
    emitStatus(cur, cur.fallbackMessage);
    if (options?.restartTicker) {
      startTicker(map);
    }
    return;
  }
  const providerChanged = previousProvider !== result.provider;
  cur.satelliteProvider = result.provider;

  if (options?.preserveAnimation && hadFrames && !providerChanged) {
    const playheadTime = currentFrame(cur)?.time ?? null;
    const existingTimes = new Set(cur.timeline.frames.map((f) => f.time));
    const freshTimes = new Set(result.frames.map((f) => f.time));
    const hasNewFrames = result.frames.some((f) => !existingTimes.has(f.time));
    const hasExpiredFrames = cur.timeline.frames.some(
      (f) => !freshTimes.has(f.time),
    );
    // Reconcile to the provider's authoritative window so expired satellite
    // frames are pruned (not just appended), preventing stale/blank imagery.
    if (hasNewFrames || hasExpiredFrames) {
      setTimelineFrames(cur, result.frames, {
        preservePlayheadTime: playheadTime,
      });
    }
    cur.fallbackMessage =
      result.provider === "gibs-fallback"
        ? "Primary satellite feed unavailable; using GIBS fallback."
        : null;
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
  cur.fallbackMessage =
    result.provider === "gibs-fallback"
      ? hadFrames
        ? "Primary satellite feed unavailable; using GIBS fallback."
        : "Primary satellite feed unavailable; started with GIBS fallback."
      : null;
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
    const playheadTime = currentFrame(cur)?.time ?? null;
    const existingTimes = new Set(cur.timeline.frames.map((f) => f.time));
    const freshTimes = new Set(result.frames.map((f) => f.time));
    const hasNewFrames = result.frames.some((f) => !existingTimes.has(f.time));
    const hasExpiredFrames = cur.timeline.frames.some(
      (f) => !freshTimes.has(f.time),
    );
    // Reconcile to RainViewer's authoritative window instead of appending.
    // `result.frames` already covers the valid past + nowcast range, so
    // adopting it both adds new frames and drops expired ones — the latter is
    // what previously caused the loop to animate dead tiles (blank radar) the
    // longer the tab stayed open.
    if (hasNewFrames || hasExpiredFrames) {
      setTimelineFrames(cur, result.frames, {
        preservePlayheadTime: playheadTime,
      });
    }
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
  const frame = currentFrame(st);
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

function emitFrame(map: MLMap, st: State) {
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
    const deadline = performance.now() + WEATHER_TILE_READY_MAX_WAIT_MS;
    const onData = () => {
      if (isImagerySourceReady(map, source, slot) || performance.now() >= deadline) {
        map.off("sourcedata", onData);
        resolve();
      }
    };
    map.on("sourcedata", onData);
    window.setTimeout(() => {
      map.off("sourcedata", onData);
      resolve();
    }, WEATHER_TILE_READY_MAX_WAIT_MS);
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

  emitFrame(map, s);
  s.crossfade = null;
  s.preload = null;
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
            emitFrame(map, st);
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
        st.nextAdvanceAtMs = Number.POSITIVE_INFINITY;
        const prevIdx = st.timeline.index;
        const nextIdx = advanceTimelineIndex(st);
        const isWrap = nextIdx === 0 && prevIdx !== 0;
        if (isWrap && st.source !== "radar" && st.satelliteProvider === "gibs-fallback") {
          st.timeline.frames = gibsAnimationFrames();
          st.preload = null;
        }
        st.timeline.index = nextIdx;
        const fr = currentFrame(st);
        if (fr) {
          void beginCrossfade(map, st, fr, isWrap).catch((err) => {
            console.error("[live-weather] crossfade start", err);
          });
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

async function attachWind(wind: WindParticleCanvas) {
  try {
    const res = await fetch("/api/wind-field", { cache: "no-store" });
    if (!res.ok) {
      console.warn("[live-weather] wind-field HTTP", res.status);
      return;
    }
    const data = (await res.json()) as WindFieldPayload & { error?: string };
    const cells = data.width * data.height;
    const ok =
      !data.error &&
      data.width > 0 &&
      data.height > 0 &&
      Array.isArray(data.u) &&
      Array.isArray(data.v) &&
      data.u.length === cells &&
      data.v.length === cells &&
      Array.isArray(data.p) &&
      data.p.length === cells;
    if (ok) {
      wind.setField(data);
    } else {
      console.warn("[live-weather] wind-field payload rejected", data?.error ?? "shape");
    }
  } catch (err) {
    console.warn("[live-weather] wind-field fetch failed", err);
  }
}

export function initLiveWeatherOverlay(map: MLMap) {
  if (store.has(map)) return;

  const tier = detectDeviceTier();
  const caps = DEVICE_TIER[tier];
  const wind = new WindParticleCanvas(map, {
    particleCount: caps.particles,
  });
  wind.setDeviceTier(tier);
  wind.setPerformanceProfile(caps.profile);
  wind.setStormSystems([]);
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
    tickId: null,
    windTimer: null,
    wind,
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

  const onMoveStart = () => {
    wind.pause();
  };
  const onMoveEnd = () => {
    const st = store.get(map);
    if (st?.mapMode === "2d" && st.overlayActive) wind.resume();
  };
  map.on("movestart", onMoveStart);
  map.on("moveend", onMoveEnd);

  const onTyphoonFocus = (ev: Event) => {
    const ce = ev as CustomEvent<TyphoonFocusDetail>;
    const st = store.get(map);
    if (!st) return;
    st.typhoonFocus = ce.detail?.storm ?? null;
    st.wind?.setTyphoonFocus(st.typhoonFocus);
    startTicker(map);
  };
  window.addEventListener(TYPHOON_FOCUS_EVENT, onTyphoonFocus);

  const onParStorms = (ev: Event) => {
    const ce = ev as CustomEvent<ParStormsDetail>;
    const st = store.get(map);
    if (!st) return;
    st.wind?.setStormSystems(ce.detail?.storms ?? []);
  };
  window.addEventListener(PAR_STORMS_EVENT, onParStorms);

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

  void attachWind(wind);
  state.windTimer = setInterval(() => {
    void attachWind(wind);
  }, WIND_REFRESH_MS);

  wind.setVisible(true);

  map.once("remove", () => {
    map.off("movestart", onMoveStart);
    map.off("moveend", onMoveEnd);
    window.removeEventListener(TYPHOON_FOCUS_EVENT, onTyphoonFocus);
    window.removeEventListener(PAR_STORMS_EVENT, onParStorms);
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
  if (s.windTimer) clearInterval(s.windTimer);
  s.wind?.setTyphoonFocus(null);
  s.wind?.setStormSystems([]);
  s.wind?.destroy();
  store.delete(map);
}

export function notifyLiveWeatherMapMode(map: MLMap, mode: "2d" | "3d") {
  const s = store.get(map);
  if (!s) return;
  s.mapMode = mode;
  if (mode === "3d") {
    stopTicker(map);
    s.wind?.setVisible(false);
    return;
  }
  if (shouldRunWeatherTicker(s)) {
    s.wind?.setVisible(true);
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
    s.wind?.setVisible(false);
    return;
  }
  syncImageryRefreshTimers(map);
  if (shouldRunWeatherTicker(s)) {
    s.wind?.setVisible(true);
    startTicker(map);
  }
}

export function applyLiveWeatherDeviceTier(
  map: MLMap | null,
  tier: DeviceTier = detectDeviceTier(),
) {
  if (!map) return;
  const s = store.get(map);
  if (!s?.wind) return;
  s.wind.setDeviceTier(tier);
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
  s.wind?.setPerformanceProfile(profile);
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
