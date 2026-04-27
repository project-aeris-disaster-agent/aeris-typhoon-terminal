"use client";

import type { Map as MLMap } from "maplibre-gl";
import {
  fetchRadarFrames,
  ensureRadarLayer,
  ensureGibsLayer,
  setFrameTimestamp,
  gibsAnimationFrames,
  type RadarFrame,
} from "@/services/satellite-frames";
import { WindParticleCanvas } from "@/services/wind-particles";
import type { WindFieldPayload } from "@/services/wind-field-types";
import type { Typhoon } from "@/services/typhoon-tracks";

export type LiveImagerySource = "radar" | "himawari-true" | "himawari-ir";

/** Dispatched when the user focuses a storm card (or clears focus). */
export const TYPHOON_FOCUS_EVENT = "aeris:typhoon-focus" as const;
export type TyphoonFocusDetail = { storm: Typhoon | null };

/** Active PAR storms from the typhoon panel — drives vortex wind overlay. */
export const PAR_STORMS_EVENT = "aeris:par-storms" as const;
export type ParStormsDetail = { storms: Typhoon[] };

const FRAME_MS_RADAR = 420;
const FRAME_MS_GIBS = 900;
/** Imagery loop speed-up while a storm card is focused (typhoon broadcast feel). */
const TYPHOON_FRAME_FACTOR = 0.58;
const WIND_REFRESH_MS = 900_000;

type State = {
  source: LiveImagerySource;
  frames: RadarFrame[];
  frameIdx: number;
  /** `requestAnimationFrame` id, or null when stopped. */
  tickId: number | null;
  windTimer: ReturnType<typeof setInterval> | null;
  wind: WindParticleCanvas | null;
  mapMode: "2d" | "3d";
  typhoonFocus: Typhoon | null;
};

const store = new WeakMap<MLMap, State>();

export type LiveWeatherFrameDetail = {
  index: number;
  count: number;
  time: string;
  source: LiveImagerySource;
};

function emitFrame(map: MLMap, st: State) {
  const fr = st.frames[st.frameIdx];
  if (!fr) return;
  window.dispatchEvent(
    new CustomEvent<LiveWeatherFrameDetail>("aeris:live-weather-frame", {
      detail: {
        index: st.frameIdx,
        count: st.frames.length,
        time: fr.time,
        source: st.source,
      },
    }),
  );
}

function stopTicker(map: MLMap) {
  const s = store.get(map);
  if (!s || s.tickId == null) return;
  cancelAnimationFrame(s.tickId);
  s.tickId = null;
}

function startTicker(map: MLMap) {
  const s = store.get(map);
  if (!s || s.mapMode !== "2d" || s.frames.length === 0) return;
  stopTicker(map);

  emitFrame(map, s);
  let acc = 0;
  let last = performance.now();

  const loop = (t: number) => {
    const st = store.get(map);
    if (!st || st.mapMode !== "2d" || st.frames.length === 0) {
      if (st) st.tickId = null;
      return;
    }
    acc += t - last;
    last = t;
    const msCurrent = Math.round(
      (st.source === "radar" ? FRAME_MS_RADAR : FRAME_MS_GIBS) *
        (st.typhoonFocus ? TYPHOON_FRAME_FACTOR : 1),
    );
    while (acc >= msCurrent) {
      acc -= msCurrent;
      const cur = store.get(map);
      if (!cur || cur.mapMode !== "2d" || cur.frames.length === 0) break;
      const len = cur.frames.length;
      const nextIdx = (cur.frameIdx + 1) % len;
      if (nextIdx === 0 && cur.source !== "radar") {
        cur.frames = gibsAnimationFrames();
      }
      cur.frameIdx = nextIdx;
      const fr = cur.frames[cur.frameIdx];
      try {
        setFrameTimestamp(map, cur.source, fr);
        emitFrame(map, cur);
      } catch (err) {
        console.error("[live-weather] frame tick", err);
      }
    }
    const tail = store.get(map);
    if (!tail || tail.mapMode !== "2d" || tail.frames.length === 0) {
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
  wind.setStormSystems([]);
  const state: State = {
    source: "radar",
    frames: [],
    frameIdx: 0,
    tickId: null,
    windTimer: null,
    wind,
    mapMode: "2d",
    typhoonFocus: null,
  };
  store.set(map, state);

  const onTyphoonFocus = (ev: Event) => {
    const ce = ev as CustomEvent<TyphoonFocusDetail>;
    const st = store.get(map);
    if (!st) return;
    st.typhoonFocus = ce.detail?.storm ?? null;
    st.wind?.setTyphoonFocus(st.typhoonFocus);
    if (st.mapMode === "2d" && st.frames.length > 0) startTicker(map);
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
      st.frames = result.frames;
      st.frameIdx = Math.max(0, result.frames.length - 1);
      if (result.frames.length) {
        ensureRadarLayer(map, result.frames[st.frameIdx]);
        if (st.mapMode === "2d") startTicker(map);
      }
    })
    .catch(() => {
      /* Radar optional; wind still runs */
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
    if (s.frames.length > 0) startTicker(map);
  }
}

export function setLiveWeatherImagerySource(map: MLMap | null, source: LiveImagerySource) {
  if (!map) return;
  const s = store.get(map);
  if (!s) return;
  if (s.source === source) return;
  s.source = source;
  stopTicker(map);

  if (source === "radar") {
    void fetchRadarFrames().then((result) => {
      const st = store.get(map);
      if (!st || st.source !== "radar") return;
      st.frames = result.frames;
      st.frameIdx = Math.max(0, result.frames.length - 1);
      if (result.frames.length) {
        ensureRadarLayer(map, result.frames[st.frameIdx]);
        if (st.mapMode === "2d") startTicker(map);
      }
    });
  } else {
    ensureGibsLayer(map, source);
    s.frames = gibsAnimationFrames();
    s.frameIdx = s.frames.length - 1;
    setFrameTimestamp(map, source, s.frames[s.frameIdx]);
    if (s.mapMode === "2d") startTicker(map);
  }
}
