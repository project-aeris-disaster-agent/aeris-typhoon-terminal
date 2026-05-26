"use client";

import { useEffect, useRef } from "react";
import type { Map as MLMap } from "maplibre-gl";
import {
  fetchYouTubeFeeds,
  type YtVideo,
} from "@/services/youtube-feeds";
import {
  clearWebcamsFromMap,
  renderWebcamsOnMap,
} from "@/services/webcam-pings";

const REFRESH_MS = 90 * 1000;
/** Same channel set as LiveWebcamsPanel; broaden later if more channels are added. */
const CHANNELS = ["@JazBazPhilippines"];

/**
 * Keeps CCTV pings rendered on the map regardless of panel state. Mirrors
 * `ReportPingsSync` so panel open/close never tears down the map source/layers.
 */
export function WebcamPingsSync({ map }: { map: MLMap | null }) {
  const latestRef = useRef<YtVideo[]>([]);

  useEffect(() => {
    if (!map) return;
    let disposed = false;

    const rehydrate = () => {
      if (disposed) return;
      renderWebcamsOnMap(map, latestRef.current);
    };

    const refresh = async () => {
      try {
        const result = await fetchYouTubeFeeds(CHANNELS, {
          bypassClientCache: true,
        });
        if (disposed) return;
        // Only paint pings for currently-live cameras with a resolved
        // location. We don't want a Greek vacation VOD (titled "Live …") to
        // render as a Davao ping, and a [0,0] location would break viewport
        // bounds calculations.
        latestRef.current = result.videos.filter(
          (v) =>
            v.isLikeLive &&
            v.location &&
            Number.isFinite(v.location.lat),
        );
        renderWebcamsOnMap(map, latestRef.current);
      } catch {
        // Keep last known pings rendered when the feed is degraded.
      }
    };

    map.on("styledata", rehydrate);
    void refresh();
    const id = window.setInterval(refresh, REFRESH_MS);

    return () => {
      disposed = true;
      map.off("styledata", rehydrate);
      window.clearInterval(id);
      clearWebcamsFromMap(map);
    };
  }, [map]);

  return null;
}
