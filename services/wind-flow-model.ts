/**
 * Synoptic wind from Open-Meteo plus cyclonic circulation from tracked storms
 * and pressure minima (LPA proxies) inside PAR — used for particle advection.
 */

import { PAR_POLYGON, type LngLat } from "@/config/region";
import type { WindFieldPayload } from "@/services/wind-field-types";
import type { Typhoon } from "@/services/typhoon-tracks";

const M_PER_DEG_LAT = 111_320;

function mPerDegLng(lat: number): number {
  return M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
}

/** Ray-cast point-in-polygon for PAR (PAGASA). */
export function pointInPar(lng: number, lat: number): boolean {
  const poly = PAR_POLYGON as LngLat[];
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0];
    const yi = poly[i][1];
    const xj = poly[j][0];
    const yj = poly[j][1];
    const intersect =
      yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-20) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function clamp(x: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, x));
}

function bilinear(
  grid: Pick<WindFieldPayload, "width" | "height" | "west" | "south" | "east" | "north">,
  arr: readonly number[],
  lng: number,
  lat: number,
): number {
  const { width: w, height: h, west, south, east, north } = grid;
  const fx = ((lng - west) / (east - west)) * (w - 1);
  const fy = ((lat - south) / (north - south)) * (h - 1);
  const x0 = clamp(Math.floor(fx), 0, w - 2);
  const y0 = clamp(Math.floor(fy), 0, h - 2);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const tx = fx - x0;
  const ty = fy - y0;
  const i00 = y0 * w + x0;
  const i10 = y0 * w + x1;
  const i01 = y1 * w + x0;
  const i11 = y1 * w + x1;
  const v00 = arr[i00] ?? 0;
  const v10 = arr[i10] ?? 0;
  const v01 = arr[i01] ?? 0;
  const v11 = arr[i11] ?? 0;
  const a = v00 * (1 - tx) + v10 * tx;
  const b = v01 * (1 - tx) + v11 * tx;
  return a * (1 - ty) + b * ty;
}

/**
 * Rankine-combined vortex in m/s (NH cyclonic): tangential flow, calm eye.
 * `VmaxMs` ~ max gradient wind scale; `RcoreM` radius of max wind (meters).
 */
export function rankineWindMs(
  lng: number,
  lat: number,
  centerLng: number,
  centerLat: number,
  VmaxMs: number,
  RcoreM: number,
): { u: number; v: number } {
  const eastM = (lng - centerLng) * mPerDegLng(lat);
  const northM = (lat - centerLat) * M_PER_DEG_LAT;
  const r = Math.hypot(eastM, northM);
  if (r < 8e3) return { u: 0, v: 0 };
  const R = clamp(RcoreM, 7e4, 5e5);
  let V: number;
  if (r < R) V = VmaxMs * (r / R);
  else V = VmaxMs * (R / r);
  const er = eastM / r;
  const nr = northM / r;
  const te = -nr;
  const tn = er;
  return { u: te * V, v: tn * V };
}

function stormCoreRadiusM(windKph: number): number {
  return clamp(90_000 + windKph * 900, 95_000, 420_000);
}

function stormVmaxMs(windKph: number): number {
  return clamp((windKph / 3.6) * 0.52, 6, 55);
}

function stormInfluenceAlpha(rM: number, outerM: number): number {
  if (rM > outerM) return 0;
  const t = 1 - rM / outerM;
  return t * t * t;
}

type LpaSeed = { lng: number; lat: number; strengthHpa: number };

/**
 * Grid local pressure minima as weak LPA proxies (monsoon trough / shear LPA).
 */
export function findLpaSeeds(field: WindFieldPayload): LpaSeed[] {
  const p = field.p;
  if (!p || p.length !== field.width * field.height) return [];
  const { width: w, height: h, west, south, east, north } = field;
  const candidates: LpaSeed[] = [];

  for (let row = 1; row < h - 1; row++) {
    for (let col = 1; col < w - 1; col++) {
      const idx = row * w + col;
      const pc = p[idx] ?? 1013;
      let sum = 0;
      let count = 0;
      let isMin = true;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const j = (row + dr) * w + (col + dc);
          const pv = p[j] ?? 1013;
          sum += pv;
          count += 1;
          if (pv <= pc) isMin = false;
        }
      }
      if (!isMin) continue;
      const meanN = sum / count;
      const strength = meanN - pc;
      if (strength < 0.55) continue;
      if (pc > 1009.5) continue;
      const lng = west + ((col + 0.5) / w) * (east - west);
      const lat = south + ((row + 0.5) / h) * (north - south);
      if (!pointInPar(lng, lat)) continue;
      candidates.push({ lng, lat, strengthHpa: strength });
    }
  }

  candidates.sort((a, b) => b.strengthHpa - a.strengthHpa);
  const picked: LpaSeed[] = [];
  const minSepDeg = 2.1;
  for (const c of candidates) {
    if (picked.length >= 4) break;
    if (
      picked.some(
        (p0) =>
          Math.hypot(p0.lng - c.lng, p0.lat - c.lat) * 111 < minSepDeg * 111,
      )
    ) {
      continue;
    }
    picked.push(c);
  }
  return picked;
}

function lpaVmaxMs(seed: LpaSeed): number {
  return clamp(3.5 + seed.strengthHpa * 1.1, 3.5, 14);
}

function lpaRcoreM(seed: LpaSeed): number {
  return clamp(140_000 + seed.strengthHpa * 40_000, 120_000, 320_000);
}

function nearAnyStorm(lng: number, lat: number, storms: readonly Typhoon[]): boolean {
  for (const s of storms) {
    const [cx, cy] = s.position;
    if (Math.hypot(lng - cx, lat - cy) * 111_000 < 280_000) return true;
  }
  return false;
}

/**
 * Large-scale wind (m/s) from the forecast grid, plus storm + LPA vortices.
 * Storms use JTWC position + reported wind; LPAs from MSL pressure minima.
 */
export function combinedWindMs(
  lng: number,
  lat: number,
  field: WindFieldPayload | null,
  storms: readonly Typhoon[],
): { u: number; v: number } {
  let ub = 0;
  let vb = 0;
  if (field) {
    ub = bilinear(field, field.u, lng, lat);
    vb = bilinear(field, field.v, lng, lat);
  }

  let bu = 0;
  let bv = 0;
  let bsum = 0;
  const outerScale = 6.5;

  for (const s of storms) {
    const [cx, cy] = s.position;
    const eastM = (lng - cx) * mPerDegLng(lat);
    const northM = (lat - cy) * M_PER_DEG_LAT;
    const r = Math.hypot(eastM, northM);
    const R = stormCoreRadiusM(s.windKph);
    const outer = R * outerScale;
    const a = stormInfluenceAlpha(r, outer);
    if (a <= 1e-4) continue;
    const { u: tu, v: tv } = rankineWindMs(lng, lat, cx, cy, stormVmaxMs(s.windKph), R);
    bu += tu * a;
    bv += tv * a;
    bsum += a;
  }

  if (field?.p) {
    const lpas = findLpaSeeds(field);
    for (const seed of lpas) {
      if (nearAnyStorm(seed.lng, seed.lat, storms)) continue;
      const eastM = (lng - seed.lng) * mPerDegLng(lat);
      const northM = (lat - seed.lat) * M_PER_DEG_LAT;
      const r = Math.hypot(eastM, northM);
      const R = lpaRcoreM(seed);
      const outer = R * outerScale;
      const a = stormInfluenceAlpha(r, outer) * 0.72;
      if (a <= 1e-4) continue;
      const { u: tu, v: tv } = rankineWindMs(
        lng,
        lat,
        seed.lng,
        seed.lat,
        lpaVmaxMs(seed),
        R,
      );
      bu += tu * a;
      bv += tv * a;
      bsum += a;
    }
  }

  const cap = 0.9;
  const blend = Math.min(cap, bsum);
  if (blend <= 1e-6) return { u: ub, v: vb };
  const su = bu / bsum;
  const sv = bv / bsum;
  return {
    u: ub * (1 - blend) + su * blend,
    v: vb * (1 - blend) + sv * blend,
  };
}
