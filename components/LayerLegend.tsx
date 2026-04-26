"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import type { Map as MLMap } from "maplibre-gl";
import { clsx } from "clsx";
import { Pill } from "./ui/Card";
import type { MapMode } from "./MapContainer";
import {
  DEFAULT_FLOOD_VISUALIZATION_SETTINGS,
  type FloodVisualizationSettings,
} from "@/config/flood-visualization";
import {
  FLOOD_LEVEL_STYLE,
  OVERLAY_LAYERS,
  ensureFloodHazardLayers,
  formatReturnPeriodLabel,
  getFloodReturnPeriods,
  setActiveFloodPeriod,
  setFloodLevelFilter,
  setOverlayVisibility,
  type FloodHazardPack,
  type OverlayLayerId,
} from "@/services/hazard-layers";
import {
  DEFAULT_SCENE_VISIBILITY,
  DEFAULT_TERRAIN_EXAGGERATION,
  SCENE_PRESETS,
  SCENE_LAYERS,
  flyToScenePreset,
  setFloodImpactHighlight,
  setFacilityPriorityFilter,
  setFloodVisualizationSettings,
  setSceneAnimationsEnabled,
  setSceneLayerVisibility,
  setTerrainExaggeration,
  type ScenePresetId,
  type SceneStatus,
  type SceneSummary,
  type SceneLayerId,
} from "@/services/map-scene";

export function LayerLegend({
  map,
  mode,
}: {
  map: MLMap | null;
  mode: MapMode;
}) {
  const [activePeriod, setActivePeriod] = useState<string | null>(null);
  const [overlays, setOverlays] = useState<Record<OverlayLayerId, boolean>>({
    "par-boundary": true,
  });
  const [sceneLayers, setSceneLayers] = useState<Record<SceneLayerId, boolean>>(
    () => ({ ...DEFAULT_SCENE_VISIBILITY }),
  );
  const [terrainExaggeration, setTerrainExaggerationValue] = useState(
    DEFAULT_TERRAIN_EXAGGERATION,
  );
  const [selectedPreset, setSelectedPreset] = useState<ScenePresetId>("ncr");
  const [sceneSummary, setSceneSummary] = useState<SceneSummary | null>(null);
  const [sceneStatus, setSceneStatus] = useState<SceneStatus>(null);
  const [expanded, setExpanded] = useState(true);
  const [floodPacks, setFloodPacks] = useState<FloodHazardPack[]>([]);
  const [criticalFacilitiesOnly, setCriticalFacilitiesOnly] = useState(false);
  const [animationsEnabled, setAnimationsEnabled] = useState(true);
  const [floodVizSettings, setFloodVizSettings] =
    useState<FloodVisualizationSettings>(() => ({
      ...DEFAULT_FLOOD_VISUALIZATION_SETTINGS,
      wireframeColors: {
        ...DEFAULT_FLOOD_VISUALIZATION_SETTINGS.wireframeColors,
      },
    }));

  const returnPeriods = useMemo(
    () => getFloodReturnPeriods(floodPacks),
    [floodPacks],
  );

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
    setActiveFloodPeriod(map, activePeriod);
  }, [map, activePeriod, floodPacks]);

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
      setOverlayVisibility(map, o.id, overlays[o.id]);
    }
  }, [map, overlays]);

  useEffect(() => {
    if (!map) return;
    for (const layer of SCENE_LAYERS) {
      setSceneLayerVisibility(map, layer.id, mode === "3d" && sceneLayers[layer.id]);
    }
  }, [map, mode, sceneLayers]);

  useEffect(() => {
    if (!map) return;
    setTerrainExaggeration(map, terrainExaggeration);
  }, [map, terrainExaggeration]);

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
    setFacilityPriorityFilter(map, criticalFacilitiesOnly ? 3 : 0);
  }, [map, criticalFacilitiesOnly]);

  useEffect(() => {
    if (!map) return;
    setSceneAnimationsEnabled(map, animationsEnabled);
  }, [map, animationsEnabled]);

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
                label="None"
                checked={activePeriod === null}
                onClick={() => setActivePeriod(null)}
              />
              {returnPeriods.length === 0 ? (
                <div className="px-1.5 py-1 text-[11px] text-aeris-muted italic">
                  Loading flood hazard packs…
                </div>
              ) : (
                returnPeriods.map((period) => (
                  <LayerRadio
                    key={period}
                    label={formatReturnPeriodLabel(period)}
                    swatch={FLOOD_LEVEL_STYLE.medium.color}
                    checked={activePeriod === period}
                    onClick={() => setActivePeriod(period)}
                  />
                ))
              )}
            </div>
            {activePeriod && (
              <FloodHazardDetails
                map={map}
                period={activePeriod}
                packs={floodPacks}
                impact={sceneSummary?.floodImpact}
              />
            )}
          </div>

          {activePeriod && (
            <FloodHazardSettings
              settings={floodVizSettings}
              onSettingsChange={setFloodVizSettings}
            />
          )}

          <div>
            <div className="text-[10px] text-aeris-muted uppercase tracking-wider mb-1">
              Overlays
            </div>
            <div className="space-y-0.5">
              {OVERLAY_LAYERS.map((o) => (
                <LayerCheckbox
                  key={o.id}
                  label={o.label}
                  swatch={o.swatch}
                  checked={overlays[o.id]}
                  onChange={(value) =>
                    setOverlays((prev) => ({ ...prev, [o.id]: value }))
                  }
                />
              ))}
            </div>
          </div>

          {mode === "3d" && (
            <div>
              <div className="text-[10px] text-aeris-muted uppercase tracking-wider mb-1">
                3D Scene
              </div>
              <div className="mb-1.5 rounded border border-aeris-border/50 bg-aeris-bg/35 px-2 py-1 text-[10px] leading-snug text-aeris-muted">
                Building shells use 30% fill with 100% wireframe outlines for
                clearer flood patch and facility context.
              </div>
              <div className="space-y-0.5">
                {SCENE_LAYERS.map((layer) => (
                  <LayerCheckbox
                    key={layer.id}
                    label={layer.label}
                    swatch={layer.swatch}
                    checked={sceneLayers[layer.id]}
                    onChange={(value) =>
                      setSceneLayers((prev) => ({ ...prev, [layer.id]: value }))
                    }
                  />
                ))}
              </div>

              {sceneLayers["critical-facilities"] && (
                <div className="mt-2 pt-2 border-t border-aeris-border/60">
                  <label className="w-full flex items-center gap-2 px-1.5 py-1 rounded text-xs cursor-pointer hover:bg-aeris-elev">
                    <input
                      type="checkbox"
                      checked={criticalFacilitiesOnly}
                      onChange={(e) => setCriticalFacilitiesOnly(e.target.checked)}
                      className="accent-aeris-accent"
                    />
                    <span className="flex-1 truncate text-aeris-text/90">
                      Critical Only
                    </span>
                  </label>
                  <div className="px-1.5 py-1 text-[10px] text-aeris-muted">
                    {criticalFacilitiesOnly
                      ? "Hospitals, Fire Stations, Evacuation Sites"
                      : "All facility types"}
                  </div>
                </div>
              )}

              <div className="mt-2 pt-2 border-t border-aeris-border/60">
                <label className="w-full flex items-center gap-2 px-1.5 py-1 rounded text-xs cursor-pointer hover:bg-aeris-elev">
                  <input
                    type="checkbox"
                    checked={animationsEnabled}
                    onChange={(e) => setAnimationsEnabled(e.target.checked)}
                    className="accent-aeris-accent"
                  />
                  <span className="flex-1 truncate text-aeris-text/90">
                    Animations
                  </span>
                </label>
                <div className="px-1.5 py-1 text-[10px] text-aeris-muted">
                  {animationsEnabled
                    ? "Pin bobbing + flood pulse active"
                    : "Disabled — lower GPU load"}
                </div>
              </div>

              <div className="mt-2 space-y-1">
                <div className="text-[10px] text-aeris-muted uppercase tracking-wider">
                  Quick Views
                </div>
                <div className="grid grid-cols-2 gap-1">
                  {SCENE_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => {
                        if (!map) return;
                        setSelectedPreset(preset.id);
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

              <div className="mt-2 space-y-1">
                <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-aeris-muted">
                  <span>Terrain exaggeration</span>
                  <span>{terrainExaggeration.toFixed(2)}x</span>
                </div>
                <input
                  type="range"
                  min={0.8}
                  max={2.4}
                  step={0.05}
                  value={terrainExaggeration}
                  onChange={(event) =>
                    setTerrainExaggerationValue(Number(event.target.value))
                  }
                  className="w-full accent-aeris-accent"
                />
              </div>

              {sceneSummary && (
                <div className="mt-2 rounded border border-aeris-border/70 bg-aeris-bg/50 px-2 py-1.5 text-[11px]">
                  <div className="flex items-center justify-between text-aeris-muted">
                    <span>Viewport context</span>
                    <span>
                      {new Date(sceneSummary.generatedAt).toLocaleTimeString("en-PH", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                  <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-1 text-aeris-text/90">
                    <span>Buildings: {sceneSummary.buildingCount}</span>
                    <span>Roads: {sceneSummary.roadCount}</span>
                    <span>Facilities: {sceneSummary.facilityCount}</span>
                  </div>
                  <div className="mt-1 text-aeris-muted/80">
                    Source: {sceneSummary.attribution}
                  </div>
                </div>
              )}
              {sceneStatus && (
                <div className="mt-2 text-[11px] text-aeris-warn">
                  {sceneStatus}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LayerRadio({
  label,
  swatch,
  checked,
  onClick,
}: {
  label: string;
  swatch?: string;
  checked: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "w-full flex items-center gap-2 px-1.5 py-1 rounded text-xs text-left",
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
  period,
  packs,
  impact,
}: {
  map: MLMap | null;
  period: string;
  packs: FloodHazardPack[];
  impact?: SceneSummary["floodImpact"];
}) {
  const [visibleLevels, setVisibleLevels] = useState<
    Record<"low" | "medium" | "high", boolean>
  >({
    low: true,
    medium: true,
    high: true,
  });

  useEffect(() => {
    if (!map) return;
    setFloodLevelFilter(map, visibleLevels);
  }, [map, visibleLevels]);

  const matchingPacks = packs.filter((p) => p.returnPeriod === period);
  const totalBuildings = impact
    ? (visibleLevels.low ? impact.buildings.low : 0) +
      (visibleLevels.medium ? impact.buildings.medium : 0) +
      (visibleLevels.high ? impact.buildings.high : 0)
    : 0;
  const totalRoads = impact
    ? (visibleLevels.low ? impact.roads.low : 0) +
      (visibleLevels.medium ? impact.roads.medium : 0) +
      (visibleLevels.high ? impact.roads.high : 0)
    : 0;
  const hasImpact = totalBuildings > 0 || totalRoads > 0;
  return (
    <div className="mt-2 pt-2 space-y-2 border-t border-aeris-border/60">
      <div className="space-y-0.5">
        <div className="text-[10px] text-aeris-muted uppercase tracking-wider">
          Susceptibility
        </div>
        {(["high", "medium", "low"] as const).map((level) => (
          <button
            key={level}
            type="button"
            onClick={() =>
              setVisibleLevels((prev) => ({ ...prev, [level]: !prev[level] }))
            }
            className={clsx(
              "w-full flex items-center gap-2 px-1.5 py-1 rounded text-[11px] text-left",
              visibleLevels[level]
                ? "text-aeris-text/90 hover:bg-aeris-elev"
                : "text-aeris-text/40 hover:bg-aeris-elev",
            )}
          >
            <span
              className={clsx(
                "inline-block w-3 h-3 rounded-sm",
                !visibleLevels[level] && "opacity-40",
              )}
              style={{ background: FLOOD_LEVEL_STYLE[level].color }}
            />
            <span className="flex-1">{FLOOD_LEVEL_STYLE[level].label}</span>
          </button>
        ))}
      </div>
      {hasImpact && impact && (
        <div className="space-y-0.5 rounded border border-aeris-border/60 bg-aeris-bg/40 px-2 py-1.5">
          <div className="text-[10px] text-aeris-muted uppercase tracking-wider">
            Affected in view
          </div>
          <ImpactRow
            label="Buildings"
            total={totalBuildings}
            counts={impact.buildings}
            visibleLevels={visibleLevels}
          />
          <ImpactRow
            label="Roads"
            total={totalRoads}
            counts={impact.roads}
            visibleLevels={visibleLevels}
          />
        </div>
      )}
      {matchingPacks.length > 0 ? (
        <Pill tone="ok">
          MGB Flo-2D: {matchingPacks.map((p) => p.province).join(", ")}
        </Pill>
      ) : (
        <Pill tone="warn">No packs loaded for this period</Pill>
      )}
    </div>
  );
}

function ImpactRow({
  label,
  total,
  counts,
  visibleLevels,
}: {
  label: string;
  total: number;
  counts: { low: number; medium: number; high: number };
  visibleLevels: Record<"low" | "medium" | "high", boolean>;
}) {
  return (
    <div className="flex items-center justify-between text-[11px] text-aeris-text/90">
      <span className="text-aeris-muted">{label}</span>
      <span className="tabular-nums">
        <span
          style={{
            color: FLOOD_LEVEL_STYLE.high.color,
            opacity: visibleLevels.high ? 1 : 0.4,
          }}
        >
          {counts.high}
        </span>
        <span className="text-aeris-muted">/</span>
        <span
          style={{
            color: FLOOD_LEVEL_STYLE.medium.color,
            opacity: visibleLevels.medium ? 1 : 0.4,
          }}
        >
          {counts.medium}
        </span>
        <span className="text-aeris-muted">/</span>
        <span
          style={{
            color: FLOOD_LEVEL_STYLE.low.color,
            opacity: visibleLevels.low ? 1 : 0.4,
          }}
        >
          {counts.low}
        </span>
        <span className="ml-1 text-aeris-muted">({total})</span>
      </span>
    </div>
  );
}

function FloodHazardSettings({
  settings,
  onSettingsChange,
}: {
  settings: FloodVisualizationSettings;
  onSettingsChange: (settings: FloodVisualizationSettings) => void;
}) {
  const update = (patch: Partial<FloodVisualizationSettings>) => {
    onSettingsChange({ ...settings, ...patch });
  };
  const updateWireColor = (level: keyof typeof FLOOD_LEVEL_STYLE, color: string) => {
    onSettingsChange({
      ...settings,
      wireframeColors: { ...settings.wireframeColors, [level]: color },
    });
  };

  return (
    <div className="pt-2 border-t border-aeris-border/60">
      <div className="flex items-center justify-between mb-1">
        <div className="text-[10px] text-aeris-muted uppercase tracking-wider">
          Flood Hazard
        </div>
        <span className="text-[10px] text-aeris-muted">visuals</span>
      </div>
      <div className="rounded border border-aeris-border/60 bg-aeris-bg/35 p-2 space-y-2">
        <div className="text-[10px] leading-snug text-aeris-muted">
          Customize water tiles, edge softness, and severity rims.
        </div>

        <label className="flex items-center justify-between gap-2 px-1.5 py-1 rounded text-[11px] text-aeris-text/90 hover:bg-aeris-elev">
          <span>Water Color</span>
          <input
            type="color"
            value={settings.waterColor}
            onChange={(event) => update({ waterColor: event.target.value })}
            className="h-5 w-8 rounded border border-aeris-border bg-transparent"
            aria-label="Water color"
          />
        </label>

        <RangeControl
          label="Water Opacity"
          value={settings.waterOpacity}
          min={0}
          max={1}
          step={0.02}
          format={(value) => `${Math.round(value * 100)}%`}
          onChange={(waterOpacity) => update({ waterOpacity })}
        />
        <RangeControl
          label="Edge Fade Distance"
          value={settings.edgeFadeDistance}
          min={10}
          max={150}
          step={5}
          format={(value) => `${Math.round(value)}m`}
          onChange={(edgeFadeDistance) => update({ edgeFadeDistance })}
        />
        <RangeControl
          label="Edge Fade Opacity"
          value={settings.edgeFadeOpacity}
          min={0}
          max={1}
          step={0.05}
          format={(value) => `${Math.round(value * 100)}%`}
          onChange={(edgeFadeOpacity) => update({ edgeFadeOpacity })}
        />

        <LayerCheckbox
          label="Wireframe Indicator"
          checked={settings.wireframeEnabled}
          onChange={(wireframeEnabled) => update({ wireframeEnabled })}
        />

        <RangeControl
          label="Wire Thickness"
          value={settings.wireframeThickness}
          min={0.1}
          max={1.4}
          step={0.05}
          format={(value) => `${value.toFixed(2)}x`}
          onChange={(wireframeThickness) => update({ wireframeThickness })}
          disabled={!settings.wireframeEnabled}
        />
        <RangeControl
          label="Wire Polygon Count"
          value={settings.wireframePolygonCount}
          min={10}
          max={100}
          step={5}
          format={(value) => `${Math.round(value)}%`}
          onChange={(wireframePolygonCount) => update({ wireframePolygonCount })}
          disabled={!settings.wireframeEnabled}
        />
        <RangeControl
          label="Wire Brightness"
          value={settings.wireframeBrightness}
          min={0.2}
          max={1.8}
          step={0.05}
          format={(value) => `${Math.round(value * 100)}%`}
          onChange={(wireframeBrightness) => update({ wireframeBrightness })}
          disabled={!settings.wireframeEnabled}
        />

        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-aeris-muted">
            Wire Colors
          </div>
          {(["high", "medium", "low"] as const).map((level) => (
            <label
              key={level}
              className="flex items-center justify-between gap-2 px-1.5 py-1 rounded text-[11px] text-aeris-text/90 hover:bg-aeris-elev"
            >
              <span>{level === "medium" ? "Med" : level[0].toUpperCase() + level.slice(1)}</span>
              <input
                type="color"
                value={settings.wireframeColors[level]}
                onChange={(event) => updateWireColor(level, event.target.value)}
                disabled={!settings.wireframeEnabled}
                className="h-5 w-8 rounded border border-aeris-border bg-transparent disabled:opacity-40"
                aria-label={`${level} wireframe color`}
              />
            </label>
          ))}
        </div>
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

function LayerCheckbox({
  label,
  swatch,
  checked,
  onChange,
}: {
  label: string;
  swatch?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="w-full flex items-center gap-2 px-1.5 py-1 rounded text-xs cursor-pointer hover:bg-aeris-elev">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-aeris-accent"
      />
      {swatch && (
        <span
          className="inline-block w-3 h-3 rounded-sm"
          style={{ background: swatch }}
        />
      )}
      <span className="flex-1 truncate">{label}</span>
    </label>
  );
}
