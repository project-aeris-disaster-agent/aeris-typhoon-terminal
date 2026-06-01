"use client";

import type { Map as MLMap } from "maplibre-gl";
import type { WindFieldPayload } from "@/services/wind-field-types";
import type { Typhoon } from "@/services/typhoon-tracks";
import {
  combinedWindMs,
  lpaSeedsForField,
  pointInPar,
} from "@/services/wind-flow-model";
import { windDprCapForTier, type DeviceTier } from "@/lib/device-tier";
import { DEFAULT_ZOOM, MAP_2D_MIN_ZOOM, MAX_ZOOM } from "@/config/region";

const M_PER_DEG_LAT = 111_320;

/** Shorter geographic streaks than earlier builds (meters along-wind). */
const STREAK_MIN_M = 4_200;
const STREAK_MAX_M = 26_000;
const STREAK_WIND_COEFF = 520;

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Zoom-aware drawing: high zoom → shorter geo streaks, thinner dashes, fewer
 * particles drawn, lighter smear so the basemap stays readable.
 */
function windDrawParams(zoomRaw: number) {
  const zoom = clamp(zoomRaw, MAP_2D_MIN_ZOOM, MAX_ZOOM);
  const z0 = DEFAULT_ZOOM;
  const geoShrink = clamp(Math.pow(2, z0 - zoom), 0.035, 1.06);
  const lineW = clamp(0.94 - (zoom - z0) * 0.1, 0.16, 0.98);
  const dashSeg = clamp(3.1 - (zoom - z0) * 0.32, 1.15, 4.2);
  const dashGap = dashSeg * 0.78;
  /** Slightly stronger frame clear so particle jumps read as motion, not smear. */
  const trailFade = clamp(0.33 - (zoom - z0) * 0.022, 0.09, 0.34);
  const drawStride = zoom >= 13.2 ? 3 : zoom >= 10 ? 2 : 1;
  const alphaScale = clamp(0.55 + (12.5 - zoom) * 0.045, 0.42, 1);
  return { geoShrink, lineW, dashSeg, dashGap, trailFade, drawStride, alphaScale };
}

type Bounds = { west: number; south: number; east: number; north: number };
export type WindPerformanceProfile = "quality" | "balanced" | "performance";

const FRAME_MS: Record<WindPerformanceProfile, number> = {
  quality: 1000 / 60,
  balanced: 1000 / 36,
  performance: 1000 / 24,
};

const DRAW_STRIDE: Record<WindPerformanceProfile, number> = {
  quality: 1,
  balanced: 2,
  performance: 3,
};

function viewBounds(map: MLMap): Bounds {
  const b = map.getBounds();
  return {
    west: b.getWest(),
    south: b.getSouth(),
    east: b.getEast(),
    north: b.getNorth(),
  };
}

function mPerDegLng(lat: number): number {
  return M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
}

/**
 * Realistic m/s → geo step is sub-pixel at dashboard zooms; scale advection so
 * particles visibly drift with the same (u, v) direction as the wind grid.
 */
function advectionScreenBoost(b: Bounds, wPx: number, hPx: number): number {
  const w = Math.max(1, wPx);
  const h = Math.max(1, hPx);
  const latMid = (b.north + b.south) / 2;
  const mLngMid = mPerDegLng(latMid);
  const degW = Math.max(1e-6, b.east - b.west);
  const degH = Math.max(1e-6, b.north - b.south);
  const dt = 0.13;
  const scaleRef = 1.12;
  const uRef = 4.5;
  /** Target horizontal drift (px/frame) when |wind| ≈ uRef. */
  const targetPx = 2.85;
  const boostLng = (targetPx * mLngMid * degW) / (uRef * dt * scaleRef * w);
  const boostLat = (targetPx * M_PER_DEG_LAT * degH) / (uRef * dt * scaleRef * h);
  return clamp((boostLng + boostLat) / 2, 35, 14_000);
}

/**
 * Wind / rain streak canvas: velocity from Open-Meteo synoptic flow plus
 * Rankine vortices for all PAR storms and pressure-minima LPAs. Streaks align
 * with the combined wind vector; PAR outside is subdued.
 */
export class WindParticleCanvas {
  private readonly map: MLMap;
  private readonly canvas: HTMLCanvasElement;
  private field: WindFieldPayload | null = null;
  private storms: Typhoon[] = [];
  private typhoonFocus: Typhoon | null = null;
  private particles: Float64Array;
  private ages: Float32Array;
  /** Last velocity sample (m/s east, north) per particle — for streak direction. */
  private vel: Float32Array;
  private raf = 0;
  private running = false;
  private visible = true;
  private motionPaused = false;
  private readonly n: number;
  private readonly maxAge: number;
  private readonly container: HTMLElement;
  private ctx: CanvasRenderingContext2D | null = null;
  private frameIntervalMs = 1000 / 60;
  private lastFrameAt = 0;
  private performanceProfile: WindPerformanceProfile = "balanced";
  private deviceTier: DeviceTier = "mid";

  constructor(map: MLMap, options?: { particleCount?: number }) {
    this.map = map;
    this.n = options?.particleCount ?? 2940;
    this.maxAge = 155;
    this.particles = new Float64Array(this.n * 2);
    this.ages = new Float32Array(this.n);
    this.vel = new Float32Array(this.n * 2);
    this.container = map.getContainer();
    this.canvas = document.createElement("canvas");
    this.canvas.setAttribute("aria-hidden", "true");
    Object.assign(this.canvas.style, {
      position: "absolute",
      inset: "0",
      width: "100%",
      height: "100%",
      pointerEvents: "none",
      zIndex: "2",
      mixBlendMode: "screen",
    });
    this.container.appendChild(this.canvas);
    this.resize();
    this.setPerformanceProfile("balanced");
    this.seedAll();
    map.on("resize", this.resize);
  }

  setField(field: WindFieldPayload | null) {
    this.field = field;
    /* Do not reseed: keeps trajectories continuous when the grid refreshes. */
  }

  /** All active PAR storms (JTWC); each contributes cyclonic flow by position + wind. */
  setStormSystems(storms: Typhoon[]) {
    this.storms = storms;
  }

  /** Visual emphasis when a storm card is focused (does not remove other vortices). */
  setTyphoonFocus(storm: Typhoon | null) {
    this.typhoonFocus = storm;
  }

  setVisible(visible: boolean) {
    this.visible = visible;
    this.canvas.style.opacity = visible ? "1" : "0";
    if (!visible) {
      this.stop();
      return;
    }
    this.motionPaused = false;
    this.start();
  }

  /** Pause animation during map camera motion without hiding the overlay. */
  pause() {
    this.motionPaused = true;
    this.stop();
  }

  /** Resume animation after camera motion if the overlay should be visible. */
  resume() {
    this.motionPaused = false;
    if (this.visible) this.start();
  }

  setPerformanceProfile(profile: WindPerformanceProfile) {
    this.performanceProfile = profile;
    this.frameIntervalMs = FRAME_MS[profile];
  }

  setDeviceTier(tier: DeviceTier) {
    this.deviceTier = tier;
    this.resize();
  }

  private resize = () => {
    const dpr = Math.min(
      windDprCapForTier(this.deviceTier),
      window.devicePixelRatio || 1,
    );
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.canvas.width = Math.max(1, Math.floor(w * dpr));
    this.canvas.height = Math.max(1, Math.floor(h * dpr));
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    if (!this.ctx) this.ctx = this.canvas.getContext("2d");
    if (this.ctx) this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  private seedAll() {
    const b = viewBounds(this.map);
    for (let i = 0; i < this.n; i++) {
      this.spawnAt(i, b);
      this.ages[i] = Math.random() * this.maxAge;
      this.vel[i * 2] = 0;
      this.vel[i * 2 + 1] = 0;
    }
  }

  private spawnAt(i: number, b: Bounds) {
    const lng = b.west + Math.random() * (b.east - b.west);
    const lat = b.south + Math.random() * (b.north - b.south);
    this.particles[i * 2] = lng;
    this.particles[i * 2 + 1] = lat;
    this.ages[i] = 0;
    this.vel[i * 2] = 0;
    this.vel[i * 2 + 1] = 0;
  }

  start() {
    if (this.running || !this.visible || this.motionPaused) return;
    this.running = true;
    const tick = (now: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(tick);
      if (document.hidden) return;
      if (this.lastFrameAt > 0 && now - this.lastFrameAt < this.frameIntervalMs) {
        return;
      }
      this.lastFrameAt = now;
      this.step();
      this.draw();
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop() {
    this.running = false;
    this.lastFrameAt = 0;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  destroy() {
    this.stop();
    this.map.off("resize", this.resize);
    this.canvas.remove();
  }

  private step() {
    const b = viewBounds(this.map);
    const wPx = this.container.clientWidth;
    const hPx = this.container.clientHeight;
    /** Physics timestep; screen boost makes motion visible at map zoom. */
    const dt = 0.13;
    const hasField = Boolean(this.field);
    const focusBoost = this.typhoonFocus ? 1.12 : 1;
    const useScreenBoost = hasField || this.storms.length > 0;
    const screenBoost = useScreenBoost ? advectionScreenBoost(b, wPx, hPx) : 1;
    const lpaSeeds = lpaSeedsForField(this.field);

    for (let i = 0; i < this.n; i++) {
      let lng = this.particles[i * 2];
      let lat = this.particles[i * 2 + 1];
      this.ages[i] += 1;

      let { u, v } = combinedWindMs(
        lng,
        lat,
        this.field,
        this.storms,
        lpaSeeds,
      );
      if (!hasField) {
        u += (Math.random() - 0.5) * 0.22;
        v += (Math.random() - 0.5) * 0.22;
      }
      const spd = Math.hypot(u, v);
      const scale =
        (hasField ? 1.18 : 0.42) * focusBoost * (spd > 10 ? 1.08 : spd > 4 ? 1.04 : 1);

      this.vel[i * 2] = u;
      this.vel[i * 2 + 1] = v;

      const mLng = mPerDegLng(lat);
      const step = screenBoost * scale;
      lng += ((u * dt) / mLng) * step;
      lat += ((v * dt) / M_PER_DEG_LAT) * step;

      const oob =
        lng < b.west - 0.02 ||
        lng > b.east + 0.02 ||
        lat < b.south - 0.02 ||
        lat > b.north + 0.02 ||
        this.ages[i] > this.maxAge;
      if (oob) {
        this.spawnAt(i, b);
      } else {
        this.particles[i * 2] = lng;
        this.particles[i * 2 + 1] = lat;
      }
    }
  }

  private draw() {
    const ctx = this.ctx;
    if (!ctx) return;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const zoom = this.map.getZoom();
    const zp = windDrawParams(zoom);
    const t = performance.now() * 0.001;

    ctx.save();
    ctx.fillStyle = `rgba(5, 10, 16, ${zp.trailFade})`;
    ctx.globalCompositeOperation = "source-over";
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    const focus = this.typhoonFocus;
    const dashPeriod = zp.dashSeg + zp.dashGap;
    ctx.setLineDash([zp.dashSeg, zp.dashGap]);

    const drawStep = Math.max(1, zp.drawStride * DRAW_STRIDE[this.performanceProfile]);
    for (let i = 0; i < this.n; i++) {
      if (i % drawStep !== 0) continue;

      const lng = this.particles[i * 2];
      const lat = this.particles[i * 2 + 1];
      const px = this.map.project([lng, lat]);
      const age = this.ages[i] / this.maxAge;
      const vu = this.vel[i * 2];
      const vv = this.vel[i * 2 + 1];
      const spd = Math.hypot(vu, vv);
      const mLng = mPerDegLng(lat);
      let plng: number;
      let plat: number;
      if (spd > 0.35) {
        const distM =
          Math.min(
            STREAK_MAX_M,
            Math.max(STREAK_MIN_M, 6_200 + spd * STREAK_WIND_COEFF),
          ) * zp.geoShrink;
        const eastM = (-vu / spd) * distM;
        const northM = (-vv / spd) * distM;
        plng = lng + eastM / mLng;
        plat = lat + northM / M_PER_DEG_LAT;
      } else {
        const tail = (0.5 + age * 0.45) * (0.55 + 0.45 * zp.geoShrink);
        plng = lng - tail * 0.0042 * Math.cos((lat * Math.PI) / 180);
        plat = lat - tail * 0.0042;
      }
      const p0 = this.map.project([plng, plat]);
      const dx = px.x - p0.x;
      const dy = px.y - p0.y;
      const screenLen = Math.hypot(dx, dy);
      const maxSegPx = 11 + 22 * zp.geoShrink;
      let p0x = p0.x;
      let p0y = p0.y;
      if (screenLen > maxSegPx && screenLen > 0.5) {
        const s = maxSegPx / screenLen;
        p0x = px.x - dx * s;
        p0y = px.y - dy * s;
      }

      const inPar = pointInPar(lng, lat);
      const parFade = inPar ? 1 : 0.2;

      const alpha =
        (0.075 + (1 - age) * 0.15) *
        (focus ? 1.12 : 1) *
        parFade *
        zp.alphaScale;
      const hi = spd > 12;
      const r = Math.round(hi ? 155 : 110);
      const gCol = Math.round(hi ? 215 : 198);
      const bCol = 255;
      ctx.strokeStyle = `rgba(${r}, ${gCol}, ${bCol}, ${Math.min(0.88, alpha)})`;
      ctx.lineWidth =
        zp.lineW * (focus && inPar ? 1.08 : 1) * (hi ? 1.05 : 1);
      /* Faster dash travel along segment reads clearly as “wind running”. */
      ctx.lineDashOffset = -((i * 23 + t * 86) % dashPeriod);

      ctx.beginPath();
      ctx.moveTo(p0x, p0y);
      ctx.lineTo(px.x, px.y);
      ctx.stroke();
    }

    ctx.setLineDash([]);
    ctx.restore();
  }
}
