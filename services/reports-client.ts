"use client";

import type { Map as MLMap } from "maplibre-gl";
import { layerBeforeDynamicOverlays, whenStyleReady } from "@/config/map-layers";
import type { LngLat } from "@/config/region";
import { recordFailure, recordSuccess } from "@/services/data-freshness";

export const REPORT_CATEGORIES = [
  "flood",
  "landslide",
  "stranded",
  "SOS",
  "infra_damage",
  "power_out",
  "road_closed",
] as const;

export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

export type IncidentReport = {
  id: string;
  messageId?: string;
  category: ReportCategory;
  description: string;
  position: LngLat;
  photoUrl?: string;
  createdAt: string;
  confirmations: number;
  sourceApp?: string;
  sourceChannel?: string;
  confidence?: number;
  verificationStatus?: string;
  phoneVerificationStatus?: string;
  aiPriority?: "pending" | "urgent" | "low_priority" | "rejected";
  aiTriageRationale?: string;
  aiTriageConfidence?: number;
  onchain?: {
    proxyWallet?: {
      id?: string;
      address?: string;
      network: string;
      chainId: number;
    };
    mint: {
      network: string;
      chainId: number;
      status: string;
      txHash?: string;
      tokenId?: string;
      mintedAt?: string;
    };
  };
};

export type ReportSubmission = {
  category: ReportCategory;
  description: string;
  position: LngLat;
  photoUrl?: string;
};

export type ReportReviewAction =
  | "verify"
  | "reject"
  | "duplicate"
  | "hide"
  | "unhide"
  | "needs_review"
  | "unverify"
  | "note"
  | "confidence_adjust";

const REPORTS_SOURCE_ID = "src-reports";
/** Solid ping center (top of stack for hit area). */
const REPORTS_LAYER_ID = "lyr-reports";
/** Expanding red halo under the core — animated for radar ping. */
const REPORTS_PULSE_LAYER_ID = "lyr-reports-pulse";

/** Report pin layers for `queryRenderedFeatures` / hit-testing. */
export const REPORTS_MAP_LAYER_IDS = [
  REPORTS_LAYER_ID,
  REPORTS_PULSE_LAYER_ID,
] as const;

type PingLoop = { cancelled: boolean };
const reportPingLoopByMap = new WeakMap<MLMap, PingLoop>();
export type ReportPingPerformanceProfile = "quality" | "balanced" | "performance";
const reportPingProfileByMap = new WeakMap<MLMap, ReportPingPerformanceProfile>();
/** Caller intent from `setReportPingLoopActive` (default true). */
const reportPingDesiredByMap = new WeakMap<MLMap, boolean>();
/**
 * Frozen in 3D mode (default false). The pulse rAF forces a continuous
 * full-pipeline repaint (MapLibre terrain + Three.js); freezing it keeps 3D
 * browsing buttery smooth. Pings stay rendered, they just stop pulsing.
 * Tracked separately from the visibility intent so the two compose cleanly.
 */
const reportPing3DFrozenByMap = new WeakMap<MLMap, boolean>();
/** Rendered report count — the pulse loop self-stops at zero pings. */
const reportCountByMap = new WeakMap<MLMap, number>();

const PING_TARGET_FPS: Record<ReportPingPerformanceProfile, number> = {
  quality: 30,
  balanced: 20,
  performance: 12,
};

const PING_RED = "#ef4444";
const PING_RED_CORE = "#dc2626";
const PING_STROKE = "#fecaca";

function startReportPingLoop(map: MLMap) {
  if (reportPingLoopByMap.has(map)) return;
  // Frozen for 3D — pings render but don't pulse so the 3D pipeline can idle.
  if (reportPing3DFrozenByMap.get(map) === true) return;
  // Nothing to animate without pings — `renderReportsOnMap` restarts the
  // loop when reports arrive.
  if ((reportCountByMap.get(map) ?? 0) === 0) return;
  const loop = { cancelled: false };
  reportPingLoopByMap.set(map, loop);
  let lastPaintAt = 0;
  const tick = (now: number) => {
    if (loop.cancelled) return;
    if (!map.getStyle() || !map.getLayer(REPORTS_PULSE_LAYER_ID)) {
      loop.cancelled = true;
      reportPingLoopByMap.delete(map);
      return;
    }
    // Feed drained to zero pings — stop burning rAF frames on invisible
    // circles. The next non-empty render restarts the loop.
    if ((reportCountByMap.get(map) ?? 0) === 0) {
      loop.cancelled = true;
      reportPingLoopByMap.delete(map);
      return;
    }
    const profile = reportPingProfileByMap.get(map) ?? "balanced";
    const minFrameMs = 1000 / PING_TARGET_FPS[profile];
    if (document.hidden && now - lastPaintAt < 1000 / 6) {
      requestAnimationFrame(tick);
      return;
    }
    if (now - lastPaintAt < minFrameMs) {
      requestAnimationFrame(tick);
      return;
    }
    lastPaintAt = now;

    const t = now * 0.001;
    const period = 1.75;
    const phase = (t % period) / period;
    const radius = 4 + phase * 26;
    const opacity = 0.55 * (1 - phase) ** 1.4;
    try {
      map.setPaintProperty(REPORTS_PULSE_LAYER_ID, "circle-radius", radius);
      map.setPaintProperty(
        REPORTS_PULSE_LAYER_ID,
        "circle-opacity",
        Math.max(0.04, opacity),
      );
      if (map.getLayer(REPORTS_LAYER_ID)) {
        const blink = 0.78 + 0.22 * (0.5 + 0.5 * Math.sin(t * 4.2));
        map.setPaintProperty(REPORTS_LAYER_ID, "circle-opacity", blink);
      }
    } catch {
      loop.cancelled = true;
      reportPingLoopByMap.delete(map);
      return;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function stopReportPingLoop(map: MLMap) {
  const loop = reportPingLoopByMap.get(map);
  if (loop) loop.cancelled = true;
  reportPingLoopByMap.delete(map);
}

export function setReportPingLoopActive(map: MLMap | null, active: boolean) {
  if (!map) return;
  reportPingDesiredByMap.set(map, active);
  if (active) {
    if (map.getLayer(REPORTS_PULSE_LAYER_ID)) startReportPingLoop(map);
  } else {
    stopReportPingLoop(map);
  }
}

/**
 * Freeze/unfreeze the report-ping pulse for the current map view mode. Called
 * on 2D/3D toggle: in 3D we freeze (pings stay visible but stop the rAF pulse
 * that forces continuous repaints); back in 2D we resume if the caller intent
 * still wants pinging and there are pings to animate.
 */
export function setReportPingMapMode(map: MLMap | null, mode: "2d" | "3d") {
  if (!map) return;
  const frozen = mode === "3d";
  reportPing3DFrozenByMap.set(map, frozen);
  if (frozen) {
    stopReportPingLoop(map);
    return;
  }
  if (
    reportPingDesiredByMap.get(map) !== false &&
    map.getLayer(REPORTS_PULSE_LAYER_ID)
  ) {
    startReportPingLoop(map);
  }
}

export function setReportPingPerformanceMode(
  map: MLMap | null,
  profile: ReportPingPerformanceProfile,
) {
  if (!map) return;
  reportPingProfileByMap.set(map, profile);
}

export async function fetchReports(): Promise<IncidentReport[]> {
  try {
    const res = await fetch("/api/reports", { cache: "no-store" });
    const data = (await res.json().catch(() => ({}))) as {
      reports?: IncidentReport[];
      error?: string;
      offline?: boolean;
    };

    if (!res.ok) {
      // Failure telemetry is recorded in the catch block below — don't
      // double-count by calling recordFailure here before throwing.
      throw new Error(data.error ?? `Reports ${res.status}`);
    }

    // The service worker returns a synthetic `200 { offline: true, data: null }`
    // when the network is unreachable. A genuinely empty feed always carries a
    // `reports: []` array, so a missing/non-array `reports` field means the
    // response is degraded — treat it as a failure so callers preserve the last
    // known pings instead of clearing the map.
    if (data.offline === true || !Array.isArray(data.reports)) {
      throw new Error("Reports feed unavailable (offline or malformed response)");
    }

    recordSuccess("reports");
    return data.reports;
  } catch (error) {
    recordFailure("reports", (error as Error).message);
    throw error;
  }
}

export async function submitReport(
  r: ReportSubmission,
): Promise<IncidentReport> {
  const res = await fetch("/api/reports", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(r),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || `Submission failed (${res.status})`);
  }
  const data = (await res.json()) as { report: IncidentReport };
  return data.report;
}

export type MintVerifiedReportsSummary = {
  pendingBefore: number;
  newlyQueued: number;
  attempted: number;
  minted: number;
  failed: number;
  pendingAfter: number;
  reachedDeadline: boolean;
};

export async function mintVerifiedReports(opts?: {
  limit?: number;
}): Promise<MintVerifiedReportsSummary> {
  const res = await fetch("/api/reports/mint", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(opts ?? {}),
  });
  const data = (await res.json().catch(() => ({}))) as MintVerifiedReportsSummary & {
    error?: string;
  };
  if (!res.ok) {
    throw new Error(data.error ?? `Mint failed (${res.status})`);
  }
  return data;
}

export async function reviewReport(opts: {
  reportId: string;
  action: ReportReviewAction;
  note?: string;
  confidence?: number;
  actorId?: string;
}): Promise<IncidentReport> {
  const res = await fetch(`/api/reports/${encodeURIComponent(opts.reportId)}/review`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: opts.action,
      actorType: "human_operator",
      actorId: opts.actorId ?? "dashboard-operator",
      note: opts.note,
      confidence: opts.confidence,
      metadata: {
        surface: "live_reports_panel",
      },
    }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    report?: IncidentReport;
    error?: string;
  };
  if (!res.ok || !data.report) {
    throw new Error(data.error ?? `Review failed (${res.status})`);
  }
  return data.report;
}

export type ReportVoteValue = "up" | "down";

export type ReportVoteResult = {
  vote: ReportVoteValue;
  /** True when this vote granted new XP (first vote on this report). */
  awarded: boolean;
  xp: number | null;
  level: number | null;
  leveledUp: boolean;
};

/** Cast (or change) the signed-in user's thumbs-up/down vote on a report. */
export async function voteOnReport(
  reportId: string,
  vote: ReportVoteValue,
): Promise<ReportVoteResult> {
  const res = await fetch(`/api/reports/${encodeURIComponent(reportId)}/vote`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ vote }),
  });
  const data = (await res.json().catch(() => ({}))) as Partial<ReportVoteResult> & {
    error?: string;
  };
  if (!res.ok) {
    throw new Error(data.error ?? `Vote failed (${res.status})`);
  }
  return {
    vote: data.vote ?? vote,
    awarded: data.awarded ?? false,
    xp: data.xp ?? null,
    level: data.level ?? null,
    leveledUp: data.leveledUp ?? false,
  };
}

/** The signed-in user's votes, as a reportId -> "up" | "down" map. */
export async function fetchMyReportVotes(): Promise<
  Record<string, ReportVoteValue>
> {
  const res = await fetch("/api/reports/votes", { cache: "no-store" });
  if (!res.ok) return {};
  const data = (await res.json().catch(() => ({}))) as {
    votes?: Record<string, ReportVoteValue>;
  };
  return data.votes ?? {};
}

function toFeatureCollection(
  reports: IncidentReport[],
): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: reports.map((r) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: r.position },
      properties: {
        id: r.id,
        messageId: r.messageId ?? r.id,
        category: r.category,
        description: r.description,
        createdAt: r.createdAt,
        confirmations: r.confirmations,
        sourceApp: r.sourceApp ?? "aeris-dashboard",
        sourceChannel: r.sourceChannel ?? "dashboard_panel",
        confidence: r.confidence ?? 0.35,
        verificationStatus: r.verificationStatus ?? "unverified",
        phoneVerificationStatus: r.phoneVerificationStatus ?? "unverified",
        onchainMintStatus: r.onchain?.mint.status ?? "not_started",
        onchainNetwork: r.onchain?.mint.network ?? "",
        onchainTxHash: r.onchain?.mint.txHash ?? "",
        photoUrl: r.photoUrl ?? "",
      },
    })),
  };
}

export function renderReportsOnMap(map: MLMap, reports: IncidentReport[]) {
  // Defer when a style swap is in flight — adding sources/layers against a
  // half-loaded style throws or gets wiped, leaving pings missing on first load.
  whenStyleReady(map, () => renderReportsOnMapNow(map, reports));
}

function renderReportsOnMapNow(map: MLMap, reports: IncidentReport[]) {
  const data = toFeatureCollection(reports);
  reportCountByMap.set(map, reports.length);
  const src = map.getSource(REPORTS_SOURCE_ID);
  if (src && "setData" in src) {
    (src as maplibregl.GeoJSONSource).setData(data);
  } else {
    map.addSource(REPORTS_SOURCE_ID, { type: "geojson", data });
  }

  // The pulse loop self-stops while the feed is empty; restart it when pings
  // (re)appear, unless the caller paused it via `setReportPingLoopActive`.
  if (
    reports.length > 0 &&
    reportPingDesiredByMap.get(map) !== false &&
    map.getLayer(REPORTS_PULSE_LAYER_ID)
  ) {
    startReportPingLoop(map);
  }

  if (!map.getLayer(REPORTS_PULSE_LAYER_ID)) {
    const beforeId = layerBeforeDynamicOverlays(map);
    map.addLayer(
      {
        id: REPORTS_PULSE_LAYER_ID,
        type: "circle",
        source: REPORTS_SOURCE_ID,
        paint: {
          "circle-radius": 6,
          "circle-color": PING_RED,
          "circle-opacity": 0.35,
          "circle-blur": 0.9,
        },
      },
      beforeId,
    );

    map.addLayer(
      {
        id: REPORTS_LAYER_ID,
        type: "circle",
        source: REPORTS_SOURCE_ID,
        paint: {
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["coalesce", ["get", "confirmations"], 0],
            0,
            4.5,
            10,
            6.5,
          ],
          "circle-color": PING_RED_CORE,
          "circle-stroke-color": PING_STROKE,
          "circle-stroke-width": 1.5,
          "circle-opacity": 1,
        },
      },
      beforeId,
    );

    const setPointer = () => {
      map.getCanvas().style.cursor = "pointer";
    };
    const clearPointer = () => {
      map.getCanvas().style.cursor = "";
    };
    map.on("mouseenter", REPORTS_LAYER_ID, setPointer);
    map.on("mouseleave", REPORTS_LAYER_ID, clearPointer);
    map.on("mouseenter", REPORTS_PULSE_LAYER_ID, setPointer);
    map.on("mouseleave", REPORTS_PULSE_LAYER_ID, clearPointer);

    map.once("remove", () => stopReportPingLoop(map));
    startReportPingLoop(map);
  }
}

export function clearReportsFromMap(map: MLMap) {
  stopReportPingLoop(map);
  if (map.getLayer(REPORTS_LAYER_ID)) map.removeLayer(REPORTS_LAYER_ID);
  if (map.getLayer(REPORTS_PULSE_LAYER_ID))
    map.removeLayer(REPORTS_PULSE_LAYER_ID);
  if (map.getSource(REPORTS_SOURCE_ID)) map.removeSource(REPORTS_SOURCE_ID);
}
