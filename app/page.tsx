"use client";

import { useCallback, useState } from "react";
import { clsx } from "clsx";
import type { Map as MLMap } from "maplibre-gl";
import { Header } from "@/components/Header";
import { MapContainer } from "@/components/MapContainer";
import { Sidebar } from "@/components/Sidebar";
import { BottomPanel } from "@/components/BottomPanel";
import { initMapLayers } from "@/services/hazard-layers";
import { initMapScene } from "@/services/map-scene";
import { registerHazardPopup } from "@/services/hazard-popup";
import { attachMapUrlSync } from "@/services/url-state";
import { initLiveWeatherOverlay } from "@/services/live-weather-overlay";

export default function HomePage() {
  const [map, setMap] = useState<MLMap | null>(null);
  const [opsSidebarCollapsed, setOpsSidebarCollapsed] = useState(false);

  const handleMapReady = useCallback((m: MLMap) => {
    initMapScene(m);
    initMapLayers(m);
    registerHazardPopup(m);
    attachMapUrlSync(m);
    initLiveWeatherOverlay(m);
    setMap(m);
  }, []);

  return (
    <div className="h-screen w-screen flex flex-col">
      <Header />
      <div className="flex-1 flex min-h-0 flex-col md:flex-row">
        <main className="flex-1 relative min-w-0 min-h-[50vh] md:min-h-0">
          <MapContainer onMapReady={handleMapReady} />
        </main>
        <div
          className={clsx(
            "flex-none md:flex-initial min-w-0 border-t md:border-t-0 border-aeris-border overflow-hidden",
            opsSidebarCollapsed ? "h-auto" : "h-[50vh]",
            "md:h-auto",
          )}
        >
          <Sidebar map={map} onCollapsedChange={setOpsSidebarCollapsed} />
        </div>
      </div>
      <BottomPanel map={map} />
    </div>
  );
}
