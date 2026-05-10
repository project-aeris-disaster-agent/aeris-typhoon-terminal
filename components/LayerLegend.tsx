"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import type { Map as MLMap } from "maplibre-gl";
import { clsx } from "clsx";
import type { MapMode } from "./MapContainer";
import {
  DEFAULT_FLOOD_VISUALIZATION_SETTINGS,
  type FloodVisualizationSettings,
} from "@/config/flood-visualization";
import {
  FLOOD_LEVEL_STYLE,
  OVERLAY_LAYERS,
  ensureFloodHazardLayers,
  getFloodReturnPeriods,
  setActiveFloodPeriod,
  setFloodLevelFilter,
  setOverlayVisibility,
  type FloodHazardPack,
} from "@/services/hazard-layers";
import {
  SCENE_PRESETS,
  flyToScenePreset,
  setActiveScenePreset,
  setFloodImpactHighlight,
  setFloodVisualizationSettings,
  setSceneAnimationsEnabled,
  setSceneLayerVisibility,
  setTerrainExaggeration,
  type ScenePresetId,
  type SceneStatus,
  type SceneSummary,
} from "@/services/map-scene";
import {
  fetchWaterLevels,
  renderWaterLevelsOnMap,
  setWaterLevelsVisibility,
} from "@/services/water-levels";

import { setLiveWeatherPerformanceProfile } from "@/services/live-weather-overlay";
import { setReportPingPerformanceMode } from "@/services/reports-client";

export function LayerLegend({
  map,
  mode,
}: {
  map: MLMap | null;
  mode: MapMode;
}) {
  const [activePeriod, setActivePeriod] = useState<string | null>(null);
  const [sceneSummary, setSceneSummary] = useState<SceneSummary | null>(null);
  const [sceneStatus, setSceneStatus] = useState<SceneStatus>(null);
  const [expanded, setExpanded] = useState(true);
  const [floodPacks, setFloodPacks] = useState<FloodHazardPack[]>([]);
  const [waterLevelsActive, setWaterLevelsActive] = useState(false);
  const [waterLevelsLoading, setWaterLevelsLoading] = useState(false);
  const [waterLevelsError, setWaterLevelsError] = useState<string | null>(null);
  const [floodVizSettings, setFloodVizSettings] =
    useState<FloodVisualizationSettings>(() => ({
      ...DEFAULT_FLOOD_VISUALIZATION_SETTINGS,
      wireframeColors: {
        low: DEFAULT_FLOOD_VISUALIZATION_SETTINGS.waterColor,
        medium: DEFAULT_FLOOD_VISUALIZATION_SETTINGS.waterColor,
        high: DEFAULT_FLOOD_VISUALIZATION_SETTINGS.waterColor,
      },
    }));

  const returnPeriods = useMemo(
    () => getFloodReturnPeriods(floodPacks),
    [floodPacks],
  );
  const hazardReadyPeriod = returnPeriods[0] ?? null;

  useEffect(() => {
    if (!map) return;
    let cancelled = false;
    ensureFloodHazardLayers(map).then((packs) => {
      if (!cancelled) setFloodPacks(packs);
    });
    return () => {
      cancelled = true;
    };
  }, [map]);

  useEffect(() => {
    if (!map) return;
    void setActiveFloodPeriod(map, activePeriod, mode);
  }, [map, activePeriod, floodPacks, mode]);

  useEffect(() => {
    if (!map) return;
    const impact = sceneSummary?.floodImpact;
    const hasTags = Boolean(
      impact &&
        impact.buildings.low +
          impact.buildings.medium +
          impact.buildings.high +
          impact.roads.low +
          impact.roads.medium +
          impact.roads.high >
          0,
    );
    setFloodImpactHighlight(map, activePeriod !== null && hasTags);
  }, [map, activePeriod, sceneSummary]);

  useEffect(() => {
    if (!map) return;
    for (const o of OVERLAY_LAYERS) {
      setOverlayVisibility(map, o.id, o.id === "par-boundary");
    }
  }, [map]);

  useEffect(() => {
    if (!map) return;
    if (!waterLevelsActive) {
      setWaterLevelsVisibility(map, false);
      return;
    }

    let cancelled = false;
    setWaterLevelsLoading(true);
    setWaterLevelsError(null);
    fetchWaterLevels()
      .then((payload) => {
        if (cancelled) return;
        renderWaterLevelsOnMap(map, payload.stations);
        setWaterLevelsVisibility(map, true);
      })
      .catch((error) => {
        if (cancelled) return;
        setWaterLevelsError((error as Error).message);
      })
      .finally(() => {
        if (!cancelled) setWaterLevelsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [map, waterLevelsActive]);

  useEffect(() => {
    if (!map) return;
    const sceneVisible = mode === "3d";
    if (!sceneVisible) setActiveScenePreset(map, null);
    setSceneLayerVisibility(map, "hillshade", sceneVisible);
    setSceneLayerVisibility(map, "roads", sceneVisible);
    setSceneLayerVisibility(map, "critical-facilities", sceneVisible);
    setSceneLayerVisibility(map, "buildings", sceneVisible);
  }, [map, mode]);

  useEffect(() => {
    if (!map) return;
    setTerrainExaggeration(map, 0.9);
  }, [map]);

  // Propagate flood viz settings to the Three.js layer.
  // Changes that trigger a full geometry rebuild (wireframePolygonCount,
  // edgeFadeDistance) are debounced so dragging the sliders does not kick off
  // a rebuild on every tick. Style-only changes (colors, opacity, thickness)
  // are forwarded immediately since they never rebuild geometry.
  const floodVizDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevFloodVizRef = useRef(floodVizSettings);
  useEffect(() => {
    if (!map) return;
    const prev = prevFloodVizRef.current;
    const next = floodVizSettings;
    prevFloodVizRef.current = next;

    const geometryChanged =
      prev.wireframePolygonCount !== next.wireframePolygonCount ||
      prev.edgeFadeDistance !== next.edgeFadeDistance;

    if (geometryChanged) {
      // Debounce heavy rebuilds by 300 ms so rapid slider drags collapse.
      if (floodVizDebounceRef.current !== null) {
        clearTimeout(floodVizDebounceRef.current);
      }
      floodVizDebounceRef.current = setTimeout(() => {
        floodVizDebounceRef.current = null;
        setFloodVisualizationSettings(map, next);
      }, 300);
    } else {
      // Style-only: forward immediately (material update only, no geometry rebuild).
      if (floodVizDebounceRef.current !== null) {
        // Cancel any pending geometry rebuild with old slider values — the
        // settings reference has changed, so re-arm with the latest value.
        clearTimeout(floodVizDebounceRef.current);
        floodVizDebounceRef.current = setTimeout(() => {
          floodVizDebounceRef.current = null;
          setFloodVisualizationSettings(map, next);
        }, 300);
      } else {
        setFloodVisualizationSettings(map, next);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, floodVizSettings]);

  useEffect(() => {
    if (!map) return;
    setSceneAnimationsEnabled(map, false);
  }, [map]);

  useEffect(() => {
    if (!map) return;
    setLiveWeatherPerformanceProfile(map, "performance");
    setReportPingPerformanceMode(map, "performance");
  }, [map]);

  useEffect(() => {
    const onSummary = (event: Event) => {
      const custom = event as CustomEvent<SceneSummary>;
      setSceneSummary(custom.detail);
    };
    window.addEventListener("aeris:scene-summary", onSummary as EventListener);
    const onStatus = (event: Event) => {
      const custom = event as CustomEvent<SceneStatus>;
      setSceneStatus(custom.detail);
    };
    window.addEventListener("aeris:scene-status", onStatus as EventListener);
    return () => {
      window.removeEventListener("aeris:scene-summary", onSummary as EventListener);
      window.removeEventListener("aeris:scene-status", onStatus as EventListener);
    };
  }, []);

  return (
    <div className="panel-glass rounded-md overflow-hidden w-64">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-2.5 py-1.5 hud-text text-aeris-muted hover:text-aeris-text"
      >
        <span>Layers</span>
        <span className="text-[10px]">{expanded ? "▾" : "▸"}</span>
      </button>

      {expanded && (
        <div className="px-2.5 pb-2 space-y-2 border-t border-aeris-border">
          <div className="pt-2">
            <div className="text-[10px] text-aeris-muted uppercase tracking-wider mb-1">
              Hazard
            </div>
            <div className="space-y-0.5">
              <LayerRadio
                label="Flood Projections"
                checked={activePeriod !== null}
                onClick={() =>
                  setActivePeriod((current) =>
                    current === null ? hazardReadyPeriod : null,
                  )
                }
                disabled={!hazardReadyPeriod}
                swatch={FLOOD_LEVEL_STYLE.medium.color}
              />
              <LayerRadio
                label="Water Levels"
                checked={waterLevelsActive}
                onClick={() => setWaterLevelsActive((current) => !current)}
                swatch="#38bdf8"
              />
              {!hazardReadyPeriod ? (
                <div className="px-1.5 py-1 text-[11px] text-aeris-muted italic">
                  Loading flood hazard packs…
                </div>
              ) : null}
              {waterLevelsLoading ? (
                <div className="px-1.5 py-1 text-[11px] text-aeris-muted italic">
                  Loading water level stations…
                </div>
              ) : null}
              {waterLevelsError ? (
                <div className="px-1.5 py-1 text-[11px] text-aeris-warn">
                  Water levels unavailable right now.
                </div>
              ) : null}
            </div>
            {activePeriod && (
              <FloodHazardDetails
                map={map}
              />
            )}
          </div>

          {activePeriod && (
            <FloodHazardSettings
              settings={floodVizSettings}
              onSettingsChange={setFloodVizSettings}
            />
          )}

          {mode === "3d" && sceneStatus && (
            <div className="text-[11px] text-aeris-warn">{sceneStatus}</div>
          )}
        </div>
      )}
    </div>
  );
}

export function QuickViewsPanel({
  map,
}: {
  map: MLMap | null;
}) {
  const [selectedPreset, setSelectedPreset] = useState<ScenePresetId>("ncr");

  return (
    <div className="panel-glass rounded-md overflow-hidden w-64">
      <div className="px-2.5 py-1.5 border-b border-aeris-border">
        <div className="text-[10px] text-aeris-muted uppercase tracking-wider">
          Quick Views
        </div>
      </div>
      <div className="px-2.5 py-2">
        <div className="grid grid-cols-2 gap-1">
          {SCENE_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => {
                if (!map) return;
                setSelectedPreset(preset.id);
                setActiveScenePreset(map, preset.id);
                flyToScenePreset(map, preset.id);
              }}
              className={clsx(
                "rounded border px-2 py-1 text-[11px] text-left",
                selectedPreset === preset.id
                  ? "border-aeris-accent/40 bg-aeris-accent/10 text-aeris-accent"
                  : "border-aeris-border text-aeris-muted hover:text-aeris-text",
              )}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function LayerRadio({
  label,
  swatch,
  checked,
  disabled = false,
  onClick,
}: {
  label: string;
  swatch?: string;
  checked: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        "w-full flex items-center gap-2 px-1.5 py-1 rounded text-xs text-left",
        disabled && "opacity-50 cursor-not-allowed hover:bg-transparent",
        checked
          ? "bg-aeris-accent/10 text-aeris-accent"
          : "text-aeris-text/90 hover:bg-aeris-elev",
      )}
    >
      <span
        className={clsx(
          "inline-block w-2.5 h-2.5 rounded-full border",
          checked ? "border-aeris-accent bg-aeris-accent" : "border-aeris-border",
        )}
      />
      {swatch && (
        <span
          className="inline-block w-3 h-3 rounded-sm"
          style={{ background: swatch }}
        />
      )}
      <span className="flex-1 truncate">{label}</span>
    </button>
  );
}

function FloodHazardDetails({
  map,
}: {
  map: MLMap | null;
}) {
  const rainfallSteps = ["low", "medium", "high"] as const;
  const [rainfallLevelIndex, setRainfallLevelIndex] = useState(1);
  const selectedRainfallLevel = rainfallSteps[rainfallLevelIndex];

  const visibleLevels = useMemo(
    () => ({
      low: rainfallLevelIndex >= 0,
      medium: rainfallLevelIndex >= 1,
      high: rainfallLevelIndex >= 2,
    }),
    [rainfallLevelIndex],
  );

  useEffect(() => {
    if (!map) return;
    setFloodLevelFilter(map, visibleLevels);
  }, [map, visibleLevels]);

  return (
    <div className="mt-2 pt-2 space-y-2 border-t border-aeris-border/60">
      <div className="space-y-0.5">
        <div className="text-[10px] text-aeris-muted uppercase tracking-wider">
          Rainfall
        </div>
        <div className="rounded border border-aeris-border/60 bg-aeris-bg/35 p-2 space-y-1.5">
          <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-aeris-muted">
            <span>Level</span>
            <span>{FLOOD_LEVEL_STYLE[selectedRainfallLevel].label}</span>
          </div>
          <input
            type="range"
            min={0}
            max={2}
            step={1}
            value={rainfallLevelIndex}
            onChange={(event) => setRainfallLevelIndex(Number(event.target.value))}
            className="w-full accent-aeris-accent"
            aria-label="Rainfall level"
          />
        </div>
      </div>
    </div>
  );
}

/** Fixed H/S/L for the water-color hue slider (stable, readable blues–cyans). */
const WATER_COLOR_SLIDER_S = 0.72;
const WATER_COLOR_SLIDER_L = 0.52;

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  const l = (max + min) / 2;
  let s = 0;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      default:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }
  return { h: h * 360, s, l };
}

function hslToHex(h: number, s: number, l: number): string {
  const hh = ((h % 360) + 360) % 360;
  const ss = Math.max(0, Math.min(1, s));
  const ll = Math.max(0, Math.min(1, l));
  const c = (1 - Math.abs(2 * ll - 1)) * ss;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = ll - c / 2;
  let rp = 0;
  let gp = 0;
  let bp = 0;
  if (hh < 60) [rp, gp, bp] = [c, x, 0];
  else if (hh < 120) [rp, gp, bp] = [x, c, 0];
  else if (hh < 180) [rp, gp, bp] = [0, c, x];
  else if (hh < 240) [rp, gp, bp] = [0, x, c];
  else if (hh < 300) [rp, gp, bp] = [x, 0, c];
  else [rp, gp, bp] = [c, 0, x];
  const r = Math.round((rp + m) * 255);
  const g = Math.round((gp + m) * 255);
  const b = Math.round((bp + m) * 255);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function waterHueFromHex(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 199;
  return Math.round(rgbToHsl(rgb.r, rgb.g, rgb.b).h);
}

function FloodHazardSettings({
  settings,
  onSettingsChange,
}: {
  settings: FloodVisualizationSettings;
  onSettingsChange: (settings: FloodVisualizationSettings) => void;
}) {
  const waterHue = useMemo(
    () => waterHueFromHex(settings.waterColor),
    [settings.waterColor],
  );

  const keepDefaultFloodVisuals = (
    next: FloodVisualizationSettings,
  ): void => {
    onSettingsChange({
      ...next,
      edgeFadeDistance: DEFAULT_FLOOD_VISUALIZATION_SETTINGS.edgeFadeDistance,
      edgeFadeOpacity: DEFAULT_FLOOD_VISUALIZATION_SETTINGS.edgeFadeOpacity,
      wireframeEnabled: DEFAULT_FLOOD_VISUALIZATION_SETTINGS.wireframeEnabled,
      wireframeThickness: DEFAULT_FLOOD_VISUALIZATION_SETTINGS.wireframeThickness,
      wireframePolygonCount:
        DEFAULT_FLOOD_VISUALIZATION_SETTINGS.wireframePolygonCount,
      wireframeBrightness:
        DEFAULT_FLOOD_VISUALIZATION_SETTINGS.wireframeBrightness,
      wireframeColors: {
        low: next.waterColor,
        medium: next.waterColor,
        high: next.waterColor,
      },
    });
  };

  return (
    <div className="pt-2 border-t border-aeris-border/60">
      <div className="rounded border border-aeris-border/60 bg-aeris-bg/35 p-2 space-y-2">
        <RangeControl
          label="Water Opacity"
          value={settings.waterOpacity}
          min={0}
          max={1}
          step={0.02}
          format={(value) => `${Math.round(value * 100)}%`}
          onChange={(waterOpacity) =>
            keepDefaultFloodVisuals({ ...settings, waterOpacity })
          }
        />
        <RangeControl
          label="Water Color"
          value={waterHue}
          min={0}
          max={360}
          step={1}
          format={(hue) => hslToHex(hue, WATER_COLOR_SLIDER_S, WATER_COLOR_SLIDER_L)}
          onChange={(hue) =>
            keepDefaultFloodVisuals({
              ...settings,
              waterColor: hslToHex(hue, WATER_COLOR_SLIDER_S, WATER_COLOR_SLIDER_L),
            })
          }
        />
      </div>
    </div>
  );
}

function RangeControl({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
  disabled = false,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className={clsx("space-y-1", disabled && "opacity-45")}>
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-aeris-muted">
        <span>{label}</span>
        <span>{format(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full accent-aeris-accent disabled:opacity-50"
        aria-label={label}
      />
    </div>
  );
}

