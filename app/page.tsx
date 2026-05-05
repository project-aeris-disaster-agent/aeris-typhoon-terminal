"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { clsx } from "clsx";
import type { Map as MLMap } from "maplibre-gl";
import { Header } from "@/components/Header";
import { MapContainer } from "@/components/MapContainer";
import { LiveReportsMapOverlay } from "@/components/LiveReportsMapOverlay";
import { Sidebar } from "@/components/Sidebar";
import { BottomPanel } from "@/components/BottomPanel";
import { ReportPingsSync } from "@/components/ReportPingsSync";
import { initMapLayers } from "@/services/hazard-layers";
import { focusAddress3DContext, initMapScene } from "@/services/map-scene";
import { registerHazardPopup } from "@/services/hazard-popup";
import { attachMapUrlSync } from "@/services/url-state";
import { initLiveWeatherOverlay } from "@/services/live-weather-overlay";

export default function HomePage() {
  const [map, setMap] = useState<MLMap | null>(null);
  const [opsSidebarCollapsed, setOpsSidebarCollapsed] = useState(false);
  const [liveReportsOpen, setLiveReportsOpen] = useState(false);
  const liveReportsTriggerRef = useRef<HTMLDivElement>(null!);
  const liveReportsPopoverRef = useRef<HTMLDivElement>(null!);

  const toggleLiveReports = useCallback(() => {
    setLiveReportsOpen((v) => !v);
  }, []);

  const closeLiveReports = useCallback(() => {
    setLiveReportsOpen(false);
  }, []);

  useEffect(() => {
    if (!liveReportsOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const trigger = liveReportsTriggerRef.current;
      const pop = liveReportsPopoverRef.current;
      const node = e.target as Node;
      if ((trigger && trigger.contains(node)) || (pop && pop.contains(node))) return;
      setLiveReportsOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [liveReportsOpen]);

  const handleMapReady = useCallback((m: MLMap) => {
    initMapScene(m);
    initMapLayers(m);
    registerHazardPopup(m);
    attachMapUrlSync(m);
    initLiveWeatherOverlay(m);
    setMap(m);
  }, []);

  const handleAddressSelect = useCallback(
    (target: { lat: number; lon: number }) => {
      if (!map) return;
      void focusAddress3DContext(map, target);
    },
    [map],
  );

  return (
    <div className="h-screen w-screen flex flex-col">
      <Header
        liveReportsOpen={liveReportsOpen}
        toggleLiveReports={toggleLiveReports}
        closeLiveReports={closeLiveReports}
        liveReportsTriggerRef={liveReportsTriggerRef}
      />
      <div className="flex-1 flex min-h-0 flex-col md:flex-row">
        <main className="flex-1 relative min-w-0 min-h-[50vh] md:min-h-0">
          <MapContainer
            onMapReady={handleMapReady}
            mapOverlay={
              <LiveReportsMapOverlay
                open={liveReportsOpen}
                onClose={closeLiveReports}
                map={map}
                popoverRef={liveReportsPopoverRef}
              />
            }
          />
          <ReportPingsSync map={map} />
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
      <BottomPanel map={map} onAddressSelect={handleAddressSelect} />
    </div>
  );
}
