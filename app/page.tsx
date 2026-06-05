"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { clsx } from "clsx";
import type { Map as MLMap } from "maplibre-gl";
import { Header } from "@/components/Header";
import { MapContainer } from "@/components/MapContainer";
import { LiveReportsMapOverlay } from "@/components/LiveReportsMapOverlay";
import { type SelectedLocation } from "@/components/MapSearchBar";
import { MapTopChrome } from "@/components/MapTopChrome";
import { LocationInfoShell } from "@/components/LocationInfoShell";
import { LocationInfoPanel } from "@/components/panels/LocationInfoPanel";
import { Sidebar } from "@/components/Sidebar";
import { BottomPanel } from "@/components/BottomPanel";
import { MobileTabBar, type MobileTab } from "@/components/MobileTabBar";
import { ReportPingsSync } from "@/components/ReportPingsSync";
import { WebcamPingsSync } from "@/components/WebcamPingsSync";
import { BootScreen } from "@/components/BootScreen";
import { YouTubeFeedsProvider } from "@/components/YouTubeFeedsProvider";
import { initMapLayers } from "@/services/hazard-layers";
import { focusAddress3DContext, initMapScene } from "@/services/map-scene";
import { registerHazardPopup } from "@/services/hazard-popup";
import { attachMapUrlSync } from "@/services/url-state";
import { initLiveWeatherOverlay } from "@/services/live-weather-overlay";
import { resolveUserLocationOnLoad } from "@/lib/resolve-user-location";
import {
  AGENT_EXPLAIN_EVENT,
  type AgentExplainDetail,
  type AgentExplainRequest,
} from "@/lib/help/agent-explain";

export default function HomePage() {
  const [map, setMap] = useState<MLMap | null>(null);
  const [opsSidebarCollapsed, setOpsSidebarCollapsed] = useState(false);
  const [liveReportsOpen, setLiveReportsOpen] = useState(false);
  const [mobileTab, setMobileTab] = useState<MobileTab>("map");
  const [selectedLocation, setSelectedLocation] =
    useState<SelectedLocation | null>(null);
  const selectedLocationRef = useRef<SelectedLocation | null>(null);
  const [intelFeedsCollapsed, setIntelFeedsCollapsed] = useState(true);
  const [explainRequest, setExplainRequest] =
    useState<AgentExplainRequest | null>(null);
  const initialLocationResolvedRef = useRef(false);
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

    // Dismiss the cold-start boot screen once the map has actually painted its
    // first frame (`idle`), with a short fallback in case `idle` is delayed
    // (e.g. tab backgrounded during load).
    const signalBootReady = () =>
      window.dispatchEvent(new Event("aeris:boot-ready"));
    m.once("idle", signalBootReady);
    window.setTimeout(signalBootReady, 1500);

    if (!initialLocationResolvedRef.current) {
      initialLocationResolvedRef.current = true;
      void resolveUserLocationOnLoad(
        () => selectedLocationRef.current,
        setSelectedLocation,
      );
    }
  }, []);

  const handleAddressSelect = useCallback(
    (target: SelectedLocation) => {
      setSelectedLocation(target);
      if (!map) return;
      void focusAddress3DContext(map, {
        lat: target.lat,
        lon: target.lon,
        zoom: target.zoom,
      });
    },
    [map],
  );

  const closeLocationInfo = useCallback(() => setSelectedLocation(null), []);

  useEffect(() => {
    selectedLocationRef.current = selectedLocation;
  }, [selectedLocation]);

  // Long-press / right-click on a help affordance asks Agent AERIS to explain
  // a dashboard feature. Reveal the Intel Feeds bar (which hosts the agent)
  // and forward the prompt; the reply appears in chat and is spoken aloud.
  useEffect(() => {
    const onExplain = (event: Event) => {
      const detail = (event as CustomEvent<AgentExplainDetail>).detail;
      if (!detail?.prompt) return;
      setIntelFeedsCollapsed(false);
      setExplainRequest({ id: Date.now(), prompt: detail.prompt });
    };
    window.addEventListener(AGENT_EXPLAIN_EVENT, onExplain);
    return () => window.removeEventListener(AGENT_EXPLAIN_EVENT, onExplain);
  }, []);

  return (
    <YouTubeFeedsProvider>
    <BootScreen />
    <div className="h-screen [@supports(height:100dvh)]:h-[100dvh] w-screen flex flex-col">
      <Header
        liveReportsOpen={liveReportsOpen}
        toggleLiveReports={toggleLiveReports}
        closeLiveReports={closeLiveReports}
        liveReportsTriggerRef={liveReportsTriggerRef}
      />
      <div className="flex-1 flex min-h-0 flex-col md:flex-row relative">
        {/* Mobile: map + reports share one slot; map stays sized when Reports tab is open. */}
        <div className="flex-1 relative min-h-0 min-w-0 flex flex-col md:flex-row">
          <div
            className={clsx(
              "absolute inset-0 flex flex-col min-h-0 min-w-0 md:relative md:flex-1",
              mobileTab !== "map" &&
                "max-md:invisible max-md:pointer-events-none",
            )}
          >
            <MapTopChrome
              map={map}
              onAddressSelect={handleAddressSelect}
              className="md:hidden shrink-0 px-2 pt-2 pb-2 border-b border-aeris-border bg-aeris-surface/98"
            />
            <main className="flex-1 relative min-h-0 min-w-0">
              <MapContainer
                layoutActive={mobileTab === "map"}
                onMapReady={handleMapReady}
                mapOverlay={
                  <>
                    <LiveReportsMapOverlay
                      open={liveReportsOpen}
                      onClose={closeLiveReports}
                      map={map}
                      popoverRef={liveReportsPopoverRef}
                    />
                    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-40 hidden md:block w-[min(480px,80%)] pointer-events-none [&>*]:pointer-events-auto">
                      <MapTopChrome
                        map={map}
                        onAddressSelect={handleAddressSelect}
                      />
                    </div>
                    {selectedLocation && (
                      <LocationInfoShell
                        intelFeedsCollapsed={intelFeedsCollapsed}
                        locationKey={`${selectedLocation.lat},${selectedLocation.lon}`}
                        onClose={closeLocationInfo}
                      >
                        <LocationInfoPanel
                          map={map}
                          location={selectedLocation}
                          onClose={closeLocationInfo}
                        />
                      </LocationInfoShell>
                    )}
                  </>
                }
              />
              <ReportPingsSync map={map} />
              <WebcamPingsSync map={map} />
            </main>
          </div>

          <div
            className={clsx(
              "absolute inset-0 flex flex-col min-h-0 min-w-0 md:hidden",
              mobileTab !== "reports" &&
                "invisible pointer-events-none",
            )}
          >
            <Sidebar map={map} mobileMode />
          </div>
        </div>

        <div className="hidden md:flex min-w-0 overflow-hidden md:flex-initial">
          <Sidebar map={map} onCollapsedChange={setOpsSidebarCollapsed} />
        </div>
      </div>
      {/* Intel Feeds (webcams / livestreams / community chat) — desktop only.
          Mobile is focused on monitoring ground reports. */}
      <div className="hidden md:block">
        <BottomPanel
          map={map}
          selectedLocation={selectedLocation}
          collapsed={intelFeedsCollapsed}
          onCollapsedChange={setIntelFeedsCollapsed}
          explainRequest={explainRequest}
        />
      </div>
      <MobileTabBar active={mobileTab} onChange={setMobileTab} />
    </div>
    </YouTubeFeedsProvider>
  );
}
