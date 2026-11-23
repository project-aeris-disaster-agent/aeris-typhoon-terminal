"use client";

import { memo, useEffect, useRef } from "react";
import type { Map as MLMap } from "maplibre-gl";
import { useYouTubeFeeds } from "@/components/YouTubeFeedsProvider";
import type { YtVideo } from "@/services/youtube-feeds";
import {
  clearWebcamsFromMap,
  renderWebcamsOnMap,
  WEBCAM_MAP_LAYER_IDS,
} from "@/services/webcam-pings";

/**
 * Keeps CCTV pings rendered on the map regardless of panel state. Shares the
 * same YouTube feed poll as LiveWebcamsPanel via YouTubeFeedsProvider.
 */
export const WebcamPingsSync = memo(function WebcamPingsSync({
  map,
}: {
  map: MLMap | null;
}) {
  const { videosForJazbaz } = useYouTubeFeeds();
  const latestRef = useRef<YtVideo[]>([]);

  useEffect(() => {
    if (!map) return;

    const rehydrate = () => {
      // Only after a style reload dropped the layers; `styledata` also fires
      // on every paint change (see ReportPingsSync).
      if (latestRef.current.length === 0) return;
      if (WEBCAM_MAP_LAYER_IDS.every((id) => map.getLayer(id))) return;
      renderWebcamsOnMap(map, latestRef.current);
    };

    latestRef.current = videosForJazbaz.filter(
      (v) =>
        v.isLikeLive &&
        v.location &&
        Number.isFinite(v.location.lat),
    );
    renderWebcamsOnMap(map, latestRef.current);

    map.on("styledata", rehydrate);
    return () => {
      map.off("styledata", rehydrate);
      clearWebcamsFromMap(map);
    };
  }, [map, videosForJazbaz]);

  return null;
});
