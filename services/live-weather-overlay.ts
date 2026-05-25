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
  easeInOutCubic,
  weatherFrameHoldMs,
} from "@/config/weather-animation";
import { WindParticleCanvas } from "@/services/wind-particles";
import type { WindPerformanceProfile } from "@/services/wind-particles";
import type { WindFieldPayload } from "@/services/wind-field-types";
import type { Typhoon } from "@/services/typhoon-tracks";

export type LiveWeatherPerformanceProfile = WindPerformanceProfile;

/** Dispatched when the user focuses a storm card (or clears focus). */
export const TYPHOON_FOCUS_EVENT = "aeris:typhoon-focus" as const;
export type TyphoonFocusDetail = { storm: Typhoon | null };

/** Active PAR storms from the typhoon panel — drives vortex wind overlay. */
export const PAR_STORMS_EVENT = "aeris:par-storms" as const;
export type ParStormsDetail = { storms: Typhoon[] };

/**
 * RainViewer publishes a new satellite frame every ~10 minutes. We refresh the
 * catalog on a fixed cadence (60s) instead of waiting for the animation loop
 * to wrap so users staring at the map see new scans promptly. The 60s value
 * keeps us comfortably below RainViewer's edge cache TTL.
 */
const SATELLITE_REFRESH_INTERVAL_MS = 60_000;
/** Same idea for radar — pull a fresh catalog every minute. */
const RADAR_REFRESH_INTERVAL_MS = 60_000;
/** Imagery loop speed-up while a storm card is focused (typhoon broadcast feel). */
const TYPHOON_FRAME_FACTOR = 0.58;
const WIND_REFRESH_MS = 900_000;

type CrossfadePhase = {
  fromSlot: ImageryBufferSlot;
  toSlot: ImageryBufferSlot;
  startedAtMs: number;
  durationMs: number;
};

type State = {
  source: LiveImagerySource;
  timeline: {
    frames: RadarFrame[];
    index: number;
  };
  activeSlot: ImageryBufferSlot;
  crossfade: CrossfadePhase | null;
  nextAdvanceAtMs: number;
  /** `requestAnimationFrame` id, or null when stopped. */
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
};

const store = new WeakMap<MLMap, State>();

export type LiveWeatherFrameDetail = {
  index: number;
  count: number;
  time: string;
  source: LiveImagerySource;
  /** `"observed"` for past scans, `"nowcast"` for model forecast frames. */
  kind: FrameKind;
  /** Provider attribution for the active frame (e.g. `"RainViewer Infrared"`). */
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

function setTimelineFrames(st: State, frames: RadarFrame[]) {
  st.timeline.frames = frames;
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

function crossfadeDurationMs(st: State): number {
  const profileFactor =
    st.performanceProfile === "performance" ? 0.72 : 1;
  const typhoonFactor = st.typhoonFocus ? TYPHOON_FRAME_FACTOR : 1;
  return Math.round(WEATHER_IMAGERY_CROSSFADE_MS * profileFactor * typhoonFactor);
}

type SatelliteRefreshOptions = {
  restartTicker?: boolean;
  /**
   * When `true`, only refresh the in-memory frame catalog; do not rebuild the
   * MapLibre source/layer. Used for the periodic background refresh so we
   * don't restart the animation every minute.
   */
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
    if (options?.restartTicker && cur.mapMode === "2d") {
      startTicker(map);
    }
    return;
  }
  const providerChanged = previousProvider !== result.provider;
  cur.satelliteProvider = result.provider;

  if (options?.preserveAnimation && hadFrames && !providerChanged) {
    /**
     * Background refresh path: extend the existing timeline with any new
     * frames RainViewer published, but keep the user's current playback
     * position so the animation does not visibly stutter.
     */
    const existingTimes = new Set(cur.timeline.frames.map((f) => f.time));
    const additions = result.frames.filter((f) => !existingTimes.has(f.time));
    if (additions.length > 0) {
      cur.timeline.frames = [...cur.timeline.frames, ...additions];
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
  cur.nextAdvanceAtMs = performance.now() + frameHoldMs(cur);
  cur.fallbackMessage =
    result.provider === "gibs-fallback"
      ? hadFrames
        ? "Primary satellite feed unavailable; using GIBS fallback."
        : "Primary satellite feed unavailable; started with GIBS fallback."
      : null;
  emitStatus(cur, cur.fallbackMessage);
  if (options?.restartTicker && cur.mapMode === "2d") {
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
    const existingTimes = new Set(cur.timeline.frames.map((f) => f.time));
    const additions = result.frames.filter((f) => !existingTimes.has(f.time));
    if (additions.length > 0) {
      cur.timeline.frames = [...cur.timeline.frames, ...additions];
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
  cur.nextAdvanceAtMs = performance.now() + frameHoldMs(cur);
  emitStatus(cur, null);
  if (cur.mapMode === "2d") startTicker(map);
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
    return true;
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

async function beginCrossfade(map: MLMap, st: State, nextFrame: RadarFrame) {
  const inactiveSlot = (1 - st.activeSlot) as ImageryBufferSlot;
  applyFrameToSlot(map, st, inactiveSlot, nextFrame);
  await waitForImagerySlot(map, st.source, inactiveSlot);
  const cur = store.get(map);
  if (!cur || cur.mapMode !== "2d") return;
  raiseImageryBufferSlot(map, cur.source, inactiveSlot);
  const durationMs = crossfadeDurationMs(cur);
  cur.crossfade = {
    fromSlot: cur.activeSlot,
    toSlot: inactiveSlot,
    startedAtMs: performance.now(),
    durationMs,
  };
}

function advanceTimelineIndex(st: State): number {
  const len = st.timeline.frames.length;
  if (len === 0) return 0;
  return (st.timeline.index + 1) % len;
}

function startTicker(map: MLMap) {
  const s = store.get(map);
  if (!s || s.mapMode !== "2d" || s.timeline.frames.length === 0) return;
  stopTicker(map);

  emitFrame(map, s);
  s.crossfade = null;
  s.nextAdvanceAtMs = performance.now() + frameHoldMs(s);
  resetImageryBufferOpacities(map, s.source, s.activeSlot);

  const loop = () => {
    const st = store.get(map);
    if (!st || st.mapMode !== "2d" || st.timeline.frames.length === 0) {
      if (st) st.tickId = null;
      return;
    }

    const now = performance.now();

    if (st.crossfade) {
      const elapsed = now - st.crossfade.startedAtMs;
      const t = Math.min(1, elapsed / st.crossfade.durationMs);
      updateCrossfadeOpacities(map, st, t);
      if (t >= 1) {
        st.activeSlot = st.crossfade.toSlot;
        st.crossfade = null;
        resetImageryBufferOpacities(map, st.source, st.activeSlot);
        st.nextAdvanceAtMs = now + frameHoldMs(st);
        const fr = currentFrame(st);
        if (fr) {
          try {
            emitFrame(map, st);
          } catch (err) {
            console.error("[live-weather] crossfade complete", err);
          }
        }
      }
    } else if (now >= st.nextAdvanceAtMs) {
      st.nextAdvanceAtMs = Number.POSITIVE_INFINITY;
      const nextIdx = advanceTimelineIndex(st);
      if (nextIdx === 0 && st.source !== "radar" && st.satelliteProvider === "gibs-fallback") {
        /**
         * Regenerate the synthetic GIBS timeline on each loop wrap so the
         * animation stays anchored to the rolling publish-lag window even if
         * the user keeps the panel open for hours. Catalog refresh for
         * RainViewer-backed satellite is now handled by an independent timer
         * (see `startSatelliteRefreshTimer`) so we no longer need a
         * wrap-gated refresh path here.
         */
        st.timeline.frames = gibsAnimationFrames();
      }
      st.timeline.index = nextIdx;
      const fr = currentFrame(st);
      if (fr) {
        void beginCrossfade(map, st, fr).catch((err) => {
          console.error("[live-weather] crossfade start", err);
        });
      }
    }

    const tail = store.get(map);
    if (!tail || tail.mapMode !== "2d" || tail.timeline.frames.length === 0) {
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
    if (!res.ok) return;
    const data = (await res.json()) as WindFieldPayload & { error?: string };
    if (
      data &&
      !data.error &&
      Array.isArray(data.u) &&
      Array.isArray(data.v) &&
      Array.isArray(data.p) &&
      data.p.length === data.u.length
    ) {
      wind.setField(data);
    }
  } catch {
    /* non-fatal */
  }
}

/**
 * Starts always-on radar/GIBS loop + wind particles. Safe to call once per map.
 */
export function initLiveWeatherOverlay(map: MLMap) {
  if (store.has(map)) return;

  const wind = new WindParticleCanvas(map, { particleCount: 2940 });
  wind.setPerformanceProfile("balanced");
  wind.setStormSystems([]);
  const state: State = {
    source: "radar",
    timeline: {
      frames: [],
      index: 0,
    },
    activeSlot: 0,
    crossfade: null,
    nextAdvanceAtMs: 0,
    tickId: null,
    windTimer: null,
    wind,
    mapMode: "2d",
    typhoonFocus: null,
    performanceProfile: "balanced",
    fallbackMessage: null,
    satelliteProvider: "gibs-fallback",
    satelliteRefreshTimer: null,
    radarRefreshTimer: null,
  };
  store.set(map, state);

  const onMoveStart = () => {
    wind.pause();
  };
  const onMoveEnd = () => {
    const st = store.get(map);
    if (st?.mapMode === "2d") wind.resume();
  };
  map.on("movestart", onMoveStart);
  map.on("moveend", onMoveEnd);

  const onTyphoonFocus = (ev: Event) => {
    const ce = ev as CustomEvent<TyphoonFocusDetail>;
    const st = store.get(map);
    if (!st) return;
    st.typhoonFocus = ce.detail?.storm ?? null;
    st.wind?.setTyphoonFocus(st.typhoonFocus);
    if (st.mapMode === "2d" && st.timeline.frames.length > 0) startTicker(map);
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
        st.nextAdvanceAtMs = performance.now() + frameHoldMs(st);
        emitStatus(st, null);
        if (st.mapMode === "2d") startTicker(map);
      }
    })
    .catch((error) => {
      const st = store.get(map);
      if (!st || st.source !== "radar") return;
      st.fallbackMessage =
        st.timeline.frames.length > 0
          ? `Radar feed unavailable; using last-known-good frame (${(error as Error).message}).`
          : `Radar feed unavailable (${(error as Error).message}).`;
      emitStatus(st, st.fallbackMessage);
    });
  startRadarRefreshTimer(map);

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
  } else {
    s.wind?.setVisible(true);
    if (s.timeline.frames.length > 0) startTicker(map);
  }
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
  if (s.mapMode === "2d" && s.timeline.frames.length > 0) {
    startTicker(map);
  }
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
  stopTicker(map);

  if (source === "radar") {
    stopSatelliteRefreshTimer(map);
    void refreshRadarFrames(map);
    startRadarRefreshTimer(map);
  } else {
    stopRadarRefreshTimer(map);
    s.timeline.frames = [];
    s.timeline.index = 0;
    void refreshSatelliteFrames(map, source, { restartTicker: true });
    startSatelliteRefreshTimer(map, source);
  }
}
