"use client";

import type { Map as MLMap } from "maplibre-gl";
import { layerBeforeDynamicOverlays } from "@/config/map-layers";
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
  if (active) {
    if (map.getLayer(REPORTS_PULSE_LAYER_ID)) startReportPingLoop(map);
  } else {
    stopReportPingLoop(map);
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
  const data = toFeatureCollection(reports);
  const src = map.getSource(REPORTS_SOURCE_ID);
  if (src && "setData" in src) {
    (src as maplibregl.GeoJSONSource).setData(data);
  } else {
    map.addSource(REPORTS_SOURCE_ID, { type: "geojson", data });
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
