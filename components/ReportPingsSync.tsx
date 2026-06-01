"use client";

import { memo, useEffect, useRef } from "react";
import type { Map as MLMap } from "maplibre-gl";
import {
  clearReportsFromMap,
  fetchReports,
  renderReportsOnMap,
  type IncidentReport,
} from "@/services/reports-client";

const REFRESH_MS = 30 * 1000;

/**
 * Keeps incident report pings rendered on the map regardless of panel state.
 * This must stay mounted at the page level so closing popovers never clears
 * the report source/layers.
 */
export const ReportPingsSync = memo(function ReportPingsSync({
  map,
}: {
  map: MLMap | null;
}) {
  const latestReportsRef = useRef<IncidentReport[]>([]);

  useEffect(() => {
    if (!map) return;
    let disposed = false;

    const rehydrateLayers = () => {
      if (disposed) return;
      // Re-attach report source/layers after style reloads without waiting
      // for the next network poll tick.
      renderReportsOnMap(map, latestReportsRef.current);
    };

    const refresh = async () => {
      try {
        const reports = await fetchReports();
        if (disposed) return;
        latestReportsRef.current = reports;
        renderReportsOnMap(map, reports);
      } catch {
        // Keep the last known report pings rendered when the feed is degraded.
      }
    };

    map.on("styledata", rehydrateLayers);
    window.addEventListener("aeris:reports-refresh", refresh);
    void refresh();
    const id = window.setInterval(refresh, REFRESH_MS);

    return () => {
      disposed = true;
      map.off("styledata", rehydrateLayers);
      window.removeEventListener("aeris:reports-refresh", refresh);
      window.clearInterval(id);
      clearReportsFromMap(map);
    };
  }, [map]);

  return null;
});
