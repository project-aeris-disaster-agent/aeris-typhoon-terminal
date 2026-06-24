"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { SelectedLocation } from "@/components/MapSearchBar";
import {
  computeFloodAutomation,
  type FloodAutomationPlan,
} from "@/lib/flood-automation";
import { fetchForecast } from "@/services/forecast";
import { fetchAlerts } from "@/services/alerts";
import { fetchActiveTyphoons, type Typhoon } from "@/services/typhoon-tracks";

export type FloodManualOverride = "on" | "off" | null;

type FloodAutomationContextValue = {
  plan: FloodAutomationPlan;
  loading: boolean;
  manualOverride: FloodManualOverride;
  setManualOverride: (value: FloodManualOverride) => void;
  isAutoControlled: boolean;
  setAvailablePeriods: (periods: string[]) => void;
};

const DEFAULT_PLAN = computeFloodAutomation({
  forecast: null,
  alerts: [],
  typhoons: [],
  availablePeriods: [],
});

const FloodAutomationContext = createContext<FloodAutomationContextValue>({
  plan: DEFAULT_PLAN,
  loading: false,
  manualOverride: null,
  setManualOverride: () => {},
  isAutoControlled: false,
  setAvailablePeriods: () => {},
});

const REFRESH_MS = 5 * 60_000;

export function FloodAutomationProvider({
  selectedLocation,
  children,
}: {
  selectedLocation: SelectedLocation | null;
  children: ReactNode;
}) {
  const [plan, setPlan] = useState<FloodAutomationPlan>(DEFAULT_PLAN);
  const [loading, setLoading] = useState(false);
  const [manualOverride, setManualOverride] = useState<FloodManualOverride>(
    null,
  );
  const [availablePeriods, setAvailablePeriods] = useState<string[]>([]);
  const locationKey = selectedLocation
    ? `${selectedLocation.lat},${selectedLocation.lon}`
    : null;
  const prevLocationKeyRef = useRef(locationKey);

  useEffect(() => {
    if (prevLocationKeyRef.current !== locationKey) {
      prevLocationKeyRef.current = locationKey;
      setManualOverride(null);
    }
  }, [locationKey]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const alertsPromise = fetchAlerts().catch(() => ({
        alerts: [],
        warnings: [],
        fetchFailed: true,
      }));
      const typhoonPromise = fetchActiveTyphoons().catch(() => ({
        storms: [] as Typhoon[],
        outsidePar: null,
        outsideParGdacs: [] as Typhoon[],
        warning: null,
      }));
      const forecastPromise = selectedLocation
        ? fetchForecast([selectedLocation.lon, selectedLocation.lat]).catch(
            () => null,
          )
        : Promise.resolve(null);

      const [alertsResult, typhoonResult, forecast] = await Promise.all([
        alertsPromise,
        typhoonPromise,
        forecastPromise,
      ]);

      const typhoons = [
        ...typhoonResult.storms,
        ...typhoonResult.outsideParGdacs,
      ];

      setPlan(
        computeFloodAutomation({
          forecast,
          alerts: alertsResult.alerts,
          typhoons,
          availablePeriods,
        }),
      );
    } finally {
      setLoading(false);
    }
  }, [selectedLocation, availablePeriods]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const isAutoControlled = manualOverride === null;

  const value = useMemo(
    () => ({
      plan,
      loading,
      manualOverride,
      setManualOverride,
      isAutoControlled,
      setAvailablePeriods,
    }),
    [plan, loading, manualOverride, isAutoControlled],
  );

  return (
    <FloodAutomationContext.Provider value={value}>
      {children}
    </FloodAutomationContext.Provider>
  );
}

export function useFloodAutomation() {
  return useContext(FloodAutomationContext);
}
