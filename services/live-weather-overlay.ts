"use client";

import type { Map as MLMap } from "maplibre-gl";
import {
  fetchRadarFrames,
  ensureRadarLayer,
  ensureSatelliteLayer,
  fetchSatelliteFrames,
  setFrameTimestamp,
  gibsAnimationFrames,
  getGibsRequestDiagnostics,
  getLiveWeatherSourceContract,
  type SatelliteFrameProvider,
  type LiveImagerySource,
  type RadarFrame,
} from "@/services/satellite-frames";
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

const FRAME_MS_RADAR = 700;
const FRAME_MS_GIBS = 1500;
const SATELLITE_REFRESH_INTERVAL_MS = 180_000;
/** Imagery loop speed-up while a storm card is focused (typhoon broadcast feel). */
const TYPHOON_FRAME_FACTOR = 0.58;
const WIND_REFRESH_MS = 900_000;

type State = {
  source: LiveImagerySource;
  timeline: {
    frames: RadarFrame[];
    index: number;
  };
  /** `requestAnimationFrame` id, or null when stopped. */
  tickId: number | null;
  windTimer: ReturnType<typeof setInterval> | null;
  wind: WindParticleCanvas | null;
  mapMode: "2d" | "3d";
  typhoonFocus: Typhoon | null;
  performanceProfile: LiveWeatherPerformanceProfile;
  fallbackMessage: string | null;
  satelliteProvider: SatelliteFrameProvider;
  nextSatelliteRefreshAtMs: number;
};

const store = new WeakMap<MLMap, State>();

export type LiveWeatherFrameDetail = {
  index: number;
  count: number;
  time: string;
  source: LiveImagerySource;
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

async function refreshSatelliteFrames(
  map: MLMap,
  source: Exclude<LiveImagerySource, "radar">,
  options?: { restartTicker?: boolean },
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
    cur.nextSatelliteRefreshAtMs = Date.now() + SATELLITE_REFRESH_INTERVAL_MS;
    cur.fallbackMessage =
      "Primary satellite feed unavailable; showing last-known-good satellite frame cache.";
    emitStatus(cur, cur.fallbackMessage);
    if (options?.restartTicker && cur.mapMode === "2d") {
      startTicker(map);
    }
    return;
  }
  cur.satelliteProvider = result.provider;
  cur.nextSatelliteRefreshAtMs = Date.now() + SATELLITE_REFRESH_INTERVAL_MS;
  setTimelineFrames(cur, result.frames);
  const frame = currentFrame(cur);
  if (!frame) return;
  ensureSatelliteLayer(map, source, frame, cur.satelliteProvider);
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

function isImagerySourceReady(map: MLMap, source: LiveImagerySource): boolean {
  const sourceId = source === "radar" ? "src-radar" : "src-gibs";
  const typed = map as MLMap & { isSourceLoaded?: (id: string) => boolean };
  if (typeof typed.isSourceLoaded !== "function") return true;
  if (!map.getSource(sourceId)) return true;
  try {
    return typed.isSourceLoaded(sourceId);
  } catch {
    return true;
  }
}

function startTicker(map: MLMap) {
  const s = store.get(map);
  if (!s || s.mapMode !== "2d" || s.timeline.frames.length === 0) return;
  stopTicker(map);

  emitFrame(map, s);
  let acc = 0;
  let last = performance.now();

  const loop = (t: number) => {
    const st = store.get(map);
    if (!st || st.mapMode !== "2d" || st.timeline.frames.length === 0) {
      if (st) st.tickId = null;
      return;
    }
    acc += t - last;
    last = t;
    const profileFactor =
      st.performanceProfile === "quality"
        ? 1
        : st.performanceProfile === "performance"
          ? 1.55
          : 1.2;
    const hiddenFactor =
      typeof document !== "undefined" && document.hidden ? 2.4 : 1;
    const msCurrent = Math.round(
      (st.source === "radar" ? FRAME_MS_RADAR : FRAME_MS_GIBS) *
        (st.typhoonFocus ? TYPHOON_FRAME_FACTOR : 1) *
        profileFactor *
        hiddenFactor,
    );
    if (acc >= msCurrent) {
      acc -= msCurrent;
      if (acc > msCurrent) acc = msCurrent;
      const cur = store.get(map);
      if (!cur || cur.mapMode !== "2d" || cur.timeline.frames.length === 0) {
        // no-op; frame advancement resumes once state is valid again
      } else if (!isImagerySourceReady(map, cur.source)) {
        // Hold the current frame until tiles finish loading to avoid blur/popping.
      } else {
        const len = cur.timeline.frames.length;
        let nextIdx = (cur.timeline.index + 1) % len;
        if (nextIdx === 0 && cur.source !== "radar") {
          if (
            cur.satelliteProvider === "rainviewer-satellite" &&
            Date.now() >= cur.nextSatelliteRefreshAtMs
          ) {
            void refreshSatelliteFrames(map, cur.source, { restartTicker: false });
          } else {
            if (cur.satelliteProvider === "gibs-fallback") {
              const refreshed = gibsAnimationFrames();
              cur.timeline.frames = refreshed;
            }
            nextIdx = 0;
          }
        }
        cur.timeline.index = nextIdx;
        const fr = currentFrame(cur);
        if (fr) {
          try {
            setFrameTimestamp(map, cur.source, fr, cur.satelliteProvider);
            emitFrame(map, cur);
          } catch (err) {
            console.error("[live-weather] frame tick", err);
          }
        }
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
    tickId: null,
    windTimer: null,
    wind,
    mapMode: "2d",
    typhoonFocus: null,
    performanceProfile: "balanced",
    fallbackMessage: null,
    satelliteProvider: "gibs-fallback",
    nextSatelliteRefreshAtMs: 0,
  };
  store.set(map, state);

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

  void attachWind(wind);
  state.windTimer = setInterval(() => {
    void attachWind(wind);
  }, WIND_REFRESH_MS);

  wind.setVisible(true);

  map.once("remove", () => {
    window.removeEventListener(TYPHOON_FOCUS_EVENT, onTyphoonFocus);
    window.removeEventListener(PAR_STORMS_EVENT, onParStorms);
    destroyLiveWeatherOverlay(map);
  });
}

export function destroyLiveWeatherOverlay(map: MLMap) {
  const s = store.get(map);
  if (!s) return;
  stopTicker(map);
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
    s.wind?.start();
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

export function setLiveWeatherImagerySource(map: MLMap | null, source: LiveImagerySource) {
  if (!map) return;
  const s = store.get(map);
  if (!s) return;
  if (s.source === source) return;
  s.source = source;
  s.fallbackMessage = null;
  stopTicker(map);

  if (source === "radar") {
    void fetchRadarFrames()
      .then((result) => {
        const st = store.get(map);
        if (!st || st.source !== "radar") return;
        setTimelineFrames(st, result.frames);
        st.satelliteProvider = "gibs-fallback";
        st.fallbackMessage = null;
        const frame = currentFrame(st);
        if (frame) {
          ensureRadarLayer(map, frame);
          emitStatus(st, null);
          if (st.mapMode === "2d") startTicker(map);
        }
      })
      .catch((error) => {
        const st = store.get(map);
        if (!st || st.source !== "radar") return;
        st.fallbackMessage =
          st.timeline.frames.length > 0
            ? `Radar refresh failed; showing last-known-good frame (${(error as Error).message}).`
            : `Radar refresh failed (${(error as Error).message}).`;
        emitStatus(st, st.fallbackMessage);
      });
  } else {
    s.timeline.frames = [];
    s.timeline.index = 0;
    void refreshSatelliteFrames(map, source, { restartTicker: true });
  }
}
