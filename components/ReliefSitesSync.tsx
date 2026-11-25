"use client";

import { memo, useEffect, useMemo, useRef } from "react";
import type { Map as MLMap } from "maplibre-gl";
import { useReliefOps } from "@/components/relief/relief-store";
import {
  clearReliefSitesFromMap,
  RELIEF_MAP_LAYER_IDS,
  renderReliefSitesOnMap,
  type ReliefMapSite,
} from "@/services/relief-sites-map";

/**
 * Keeps relief pickup sites on the map whatever the panel state, from the
 * same poll the Relief Ops panel reads.
 */
export const ReliefSitesSync = memo(function ReliefSitesSync({ map }: { map: MLMap | null }) {
  const { data } = useReliefOps();
  const sites = useMemo<ReliefMapSite[]>(
    () =>
      (data?.operations ?? []).flatMap((op) =>
        op.sites.map((s) => ({ ...s, operationName: op.name })),
      ),
    [data],
  );
  const latestRef = useRef<ReliefMapSite[]>([]);

  useEffect(() => {
    if (!map) return;
    latestRef.current = sites;
    renderReliefSitesOnMap(map, sites);

    // A basemap style swap drops custom layers; put them back.
    const rehydrate = () => {
      if (latestRef.current.length === 0) return;
      if (RELIEF_MAP_LAYER_IDS.every((id) => map.getLayer(id))) return;
      renderReliefSitesOnMap(map, latestRef.current);
    };
    map.on("styledata", rehydrate);
    return () => {
      map.off("styledata", rehydrate);
    };
  }, [map, sites]);

  useEffect(() => {
    if (!map) return;
    return () => clearReliefSitesFromMap(map);
  }, [map]);

  return null;
});
