"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { clsx } from "clsx";
import type { Map as MLMap } from "maplibre-gl";
import { Header } from "@/components/Header";
import { MapContainer } from "@/components/MapContainer";
import { LiveReportsMapOverlay } from "@/components/LiveReportsMapOverlay";
import { MapSearchBar, type SelectedLocation } from "@/components/MapSearchBar";
import { LocationInfoPanel } from "@/components/panels/LocationInfoPanel";
import { Sidebar } from "@/components/Sidebar";
import { BottomPanel } from "@/components/BottomPanel";
import { ReportPingsSync } from "@/components/ReportPingsSync";
import { WebcamPingsSync } from "@/components/WebcamPingsSync";
import { YouTubeFeedsProvider } from "@/components/YouTubeFeedsProvider";
import { initMapLayers } from "@/services/hazard-layers";
import { focusAddress3DContext, initMapScene } from "@/services/map-scene";
import { registerHazardPopup } from "@/services/hazard-popup";
import { attachMapUrlSync } from "@/services/url-state";
import { initLiveWeatherOverlay } from "@/services/live-weather-overlay";

export default function HomePage() {
  const [map, setMap] = useState<MLMap | null>(null);
  const [opsSidebarCollapsed, setOpsSidebarCollapsed] = useState(false);
  const [liveReportsOpen, setLiveReportsOpen] = useState(false);
  const [selectedLocation, setSelectedLocation] =
    useState<SelectedLocation | null>(null);
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
    (target: SelectedLocation) => {
      setSelectedLocation(target);
      if (!map) return;
      void focusAddress3DContext(map, { lat: target.lat, lon: target.lon });
    },
    [map],
  );

  const closeLocationInfo = useCallback(() => setSelectedLocation(null), []);

  return (
    <YouTubeFeedsProvider>
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
              <>
                <LiveReportsMapOverlay
                  open={liveReportsOpen}
                  onClose={closeLiveReports}
                  map={map}
                  popoverRef={liveReportsPopoverRef}
                />
                {/* Banner ad — sits above the search bar */}
                <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-2 w-[min(480px,80%)]">
                  <a
                    href="https://www.google.com/adsense"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block w-full rounded-lg overflow-hidden shadow-lg opacity-90 hover:opacity-100 transition-opacity duration-200"
                    aria-label="Advertisement"
                  >
                    <img
                      src="/ads/ads_v1_2026.gif"
                      alt="Advertisement"
                      className="w-full h-auto object-cover block"
                      draggable={false}
                    />
                  </a>
                  <MapSearchBar map={map} onAddressSelect={handleAddressSelect} />
                </div>
                {selectedLocation && (
                  <div className="absolute bottom-10 right-3 z-20 w-[min(360px,calc(100vw-1.5rem))] max-h-[calc(100vh-7rem)] overflow-y-auto">
                    <LocationInfoPanel
                      map={map}
                      location={selectedLocation}
                      onClose={closeLocationInfo}
                    />
                  </div>
                )}
              </>
            }
          />
          <ReportPingsSync map={map} />
          <WebcamPingsSync map={map} />
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
      <BottomPanel map={map} selectedLocation={selectedLocation} />
    </div>
    </YouTubeFeedsProvider>
  );
}
