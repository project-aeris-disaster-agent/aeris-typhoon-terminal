"use client";

import type { Map as MLMap } from "maplibre-gl";
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

const PING_RED = "#ef4444";
const PING_RED_CORE = "#dc2626";
const PING_STROKE = "#fecaca";

function startReportPingLoop(map: MLMap) {
  if (reportPingLoopByMap.has(map)) return;
  const loop = { cancelled: false };
  reportPingLoopByMap.set(map, loop);
  const tick = (now: number) => {
    if (loop.cancelled) return;
    if (!map.getStyle() || !map.getLayer(REPORTS_PULSE_LAYER_ID)) {
      loop.cancelled = true;
      reportPingLoopByMap.delete(map);
      return;
    }
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

export async function fetchReports(): Promise<IncidentReport[]> {
  try {
    const res = await fetch("/api/reports", { cache: "no-store" });
    const data = (await res.json().catch(() => ({}))) as {
      reports?: IncidentReport[];
      error?: string;
    };

    if (!res.ok) {
      // Failure telemetry is recorded in the catch block below — don't
      // double-count by calling recordFailure here before throwing.
      throw new Error(data.error ?? `Reports ${res.status}`);
    }

    recordSuccess("reports");
    return Array.isArray(data.reports) ? data.reports : [];
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

export async function reviewReport(opts: {
  reportId: string;
  action: ReportReviewAction;
  note?: string;
  confidence?: number;
}): Promise<IncidentReport> {
  const res = await fetch(`/api/reports/${encodeURIComponent(opts.reportId)}/review`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: opts.action,
      actorType: "human_operator",
      actorId: "dashboard-operator",
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
    // Anchor below facility labels so text stays readable over report
    // markers and so repeated add/remove cycles yield a stable z-order
    // (without `beforeId`, re-adding after removeLayer reinserts the
    // circles on top of every other layer).
    const beforeId = map.getLayer("lyr-osm-facility-labels")
      ? "lyr-osm-facility-labels"
      : undefined;

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
