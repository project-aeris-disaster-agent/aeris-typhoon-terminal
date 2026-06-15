"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { clsx } from "clsx";
import type { Map as MLMap } from "maplibre-gl";
import {
  AlertTriangle,
  Ambulance,
  Building2,
  CheckCircle2,
  ChevronDown,
  CloudRain,
  Copy,
  Flame,
  Hospital,
  Info,
  Radio,
  School,
  Share2,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Tent,
  Waves,
  Wind,
  X,
  type LucideIcon,
} from "lucide-react";
import { Pill } from "../ui/Card";
import { AlertCard } from "../ui/AlertCard";
import { VirtualList } from "../ui/VirtualList";
import type { SelectedLocation } from "../MapSearchBar";
import {
  computeForecastAlert,
  fetchForecast,
  type ForecastAlert,
  type ForecastSummary,
} from "@/services/forecast";
import {
  alertSeverityTone,
  fetchAlerts,
  type Alert,
  type AlertSeverity,
} from "@/services/alerts";
import { FLOOD_LEVEL_STYLE, type FloodLevel } from "@/config/flood-colors";
import { focusAddress3DContext } from "@/services/map-scene";

// ─── Types ───────────────────────────────────────────────────────────────────

type SafetyTone = "ok" | "default" | "warn" | "danger";
type FloodHit = { returnPeriod: string; worst: FloodLevel };

type FacilityProps = {
  category: string;
  categoryLabel: string;
  name: string | null;
  priority: number;
  source: string;
};
type FacilityFeature = GeoJSON.Feature<GeoJSON.Point, FacilityProps>;
type OsmContextPayload = {
  facilities: GeoJSON.FeatureCollection<GeoJSON.Point>;
  /** Set when served from last-known-good cache (Overpass mirrors were down). */
  degraded?: boolean;
};
type NearbyFacility = {
  feature: FacilityFeature;
  distanceMeters: number;
  bearing: Compass;
};

type Compass = "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW";

// ─── Constants ───────────────────────────────────────────────────────────────

const EARTH_RADIUS_M = 6_371_000;
const COMPASS: Compass[] = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const FLOOD_PERIOD_ORDER = ["5yr", "25yr", "100yr"] as const;
const FLOOD_RANK: Record<FloodLevel, number> = { low: 1, medium: 2, high: 3 };
const SEVERITY_RANK: Record<AlertSeverity, number> = {
  info: 0,
  watch: 1,
  warning: 2,
  emergency: 3,
};
const TONE_RANK: Record<SafetyTone, number> = {
  ok: 0,
  default: 1,
  warn: 2,
  danger: 3,
};

const TONE_BG: Record<SafetyTone, string> = {
  ok: "bg-aeris-ok/15 border-aeris-ok/40 text-aeris-ok",
  default: "bg-aeris-accent/10 border-aeris-accent/40 text-aeris-accent",
  warn: "bg-aeris-warn/15 border-aeris-warn/50 text-aeris-warn",
  danger: "bg-aeris-danger/15 border-aeris-danger/50 text-aeris-danger",
};

const FACILITY_META: Record<string, { Icon: LucideIcon; tone: string }> = {
  hospital: { Icon: Hospital, tone: "text-aeris-danger" },
  evacuation: { Icon: Tent, tone: "text-aeris-ok" },
  fire_station: { Icon: Flame, tone: "text-aeris-warn" },
  police: { Icon: Shield, tone: "text-aeris-accent" },
  government: { Icon: Building2, tone: "text-aeris-muted" },
  school: { Icon: School, tone: "text-aeris-muted" },
};
const FACILITY_FALLBACK = { Icon: Building2, tone: "text-aeris-muted" };

// ─── Geo helpers ─────────────────────────────────────────────────────────────

const toRad = (deg: number) => (deg * Math.PI) / 180;

function haversineMeters(
  [lon1, lat1]: [number, number],
  [lon2, lat2]: [number, number],
) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

function bearing(
  [lon1, lat1]: [number, number],
  [lon2, lat2]: [number, number],
): Compass {
  const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
  const deg = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  return COMPASS[Math.round(deg / 45) % 8];
}

const formatDistance = (m: number) =>
  m < 1000
    ? `${Math.round(m)} m`
    : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;

function bboxAround(
  lat: number,
  lon: number,
  meters: number,
): [number, number, number, number] {
  const dLat = (meters / EARTH_RADIUS_M) * (180 / Math.PI);
  const dLon =
    (meters / (EARTH_RADIUS_M * Math.cos(toRad(lat)))) * (180 / Math.PI);
  return [lon - dLon, lat - dLat, lon + dLon, lat + dLat];
}

// ─── Severity / tone helpers ────────────────────────────────────────────────

const floodLevelTone = (l: FloodLevel): SafetyTone =>
  l === "high" ? "danger" : l === "medium" ? "warn" : "default";

function pickHighestTone(tones: SafetyTone[]): SafetyTone {
  if (tones.length === 0) return "ok";
  return tones.reduce((a, b) => (TONE_RANK[a] >= TONE_RANK[b] ? a : b));
}

// `alertSeverityTone` returns "accent" for `watch`; the panel uses `default`
// for that visual slot, so we normalize here in one place.
function alertTone(s: AlertSeverity): SafetyTone {
  const t = alertSeverityTone(s);
  return t === "accent" ? "default" : t;
}

// ─── Flood probe ────────────────────────────────────────────────────────────

const FLOOD_FILL_PREFIX = "lyr-flood-fill-";
const FLOOD_FILL_LAYER_RE = /^lyr-flood-fill-.+-(\d+yr)$/;

function probeFlood(map: MLMap, lat: number, lon: number): FloodHit[] {
  const layers = map.getStyle()?.layers;
  if (!layers) return [];
  const fillIds = layers
    .map((l) => l.id)
    .filter((id) => id.startsWith(FLOOD_FILL_PREFIX));
  if (fillIds.length === 0) return [];

  let feats: ReturnType<MLMap["queryRenderedFeatures"]>;
  try {
    feats = map.queryRenderedFeatures(map.project([lon, lat]), {
      layers: fillIds,
    });
  } catch {
    return [];
  }

  const byPeriod = new Map<string, FloodLevel>();
  for (const f of feats) {
    const m = FLOOD_FILL_LAYER_RE.exec(f.layer?.id ?? "");
    if (!m) continue;
    const level = f.properties?.level as FloodLevel | undefined;
    if (!level || !(level in FLOOD_RANK)) continue;
    const prev = byPeriod.get(m[1]);
    if (!prev || FLOOD_RANK[level] > FLOOD_RANK[prev]) {
      byPeriod.set(m[1], level);
    }
  }

  return Array.from(byPeriod, ([returnPeriod, worst]) => ({
    returnPeriod,
    worst,
  })).sort(
    (a, b) =>
      FLOOD_PERIOD_ORDER.indexOf(a.returnPeriod as (typeof FLOOD_PERIOD_ORDER)[number]) -
      FLOOD_PERIOD_ORDER.indexOf(b.returnPeriod as (typeof FLOOD_PERIOD_ORDER)[number]),
  );
}

// ─── Safety verdict ─────────────────────────────────────────────────────────

const VERDICT_PRESET: Record<
  SafetyTone,
  { label: string; Icon: LucideIcon; fallback: string }
> = {
  danger: {
    label: "High risk",
    Icon: ShieldAlert,
    fallback: "Multiple hazard indicators are elevated for this area.",
  },
  warn: {
    label: "Caution",
    Icon: AlertTriangle,
    fallback: "Elevated weather or hazard exposure detected.",
  },
  default: {
    label: "Monitor",
    Icon: Info,
    fallback: "No major bulletins right now — keep an eye on updates.",
  },
  ok: {
    label: "Safe",
    Icon: ShieldCheck,
    fallback:
      "No active national bulletins, no high weather risk in the next 7 days, and no mapped flood exposure visible at this point.",
  },
};

const VERDICT_LEAD: Record<SafetyTone, string> = {
  danger: "Driven by ",
  warn: "Heads-up: ",
  default: "",
  ok: "",
};

type SafetyVerdict = {
  tone: SafetyTone;
  label: string;
  detail: string;
  Icon: LucideIcon;
};

function computeVerdict(args: {
  forecastAlert: ForecastAlert | null;
  worstAlertSeverity: AlertSeverity | null;
  worstFlood: FloodLevel | null;
}): SafetyVerdict {
  const { forecastAlert, worstAlertSeverity, worstFlood } = args;

  const tone = pickHighestTone(
    [
      forecastAlert?.tone,
      worstAlertSeverity ? alertTone(worstAlertSeverity) : null,
      worstFlood ? floodLevelTone(worstFlood) : null,
    ].filter(Boolean) as SafetyTone[],
  );

  const reasons: string[] = [];
  if (forecastAlert && forecastAlert.level >= 2) {
    reasons.push(`${forecastAlert.label.toLowerCase()} weather risk in 7 days`);
  }
  if (worstAlertSeverity) {
    reasons.push(`${worstAlertSeverity} bulletin in effect`);
  }
  if (worstFlood) {
    reasons.push(
      `${FLOOD_LEVEL_STYLE[worstFlood].label.toLowerCase()} flood susceptibility`,
    );
  }

  const preset = VERDICT_PRESET[tone];
  let detail = preset.fallback;
  if (reasons.length > 0) {
    const joined = reasons.join(", ");
    detail = `${VERDICT_LEAD[tone]}${joined}.`;
    // Capitalize when there's no lead-in word to start the sentence.
    if (!VERDICT_LEAD[tone]) detail = detail.charAt(0).toUpperCase() + detail.slice(1);
  }

  return { tone, label: preset.label, detail, Icon: preset.Icon };
}

// ─── Async hook: cancellable fetch ──────────────────────────────────────────

/**
 * Runs `fetcher` whenever `key` (a coordinate string) changes; ignores stale
 * resolutions. Errors are swallowed — sections degrade to their empty state.
 */
function useAsyncResource<T>(
  key: string | null,
  fetcher: () => Promise<T>,
): { data: T | null; loading: boolean } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    setData(null);
    setLoading(true);
    fetcher()
      .then((res) => !cancelled && setData(res))
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // `fetcher` is intentionally re-created per render but we key off `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { data, loading };
}

type SectionId = "storm" | "flood" | "alerts" | "help";

const SECTION_IDS: SectionId[] = ["storm", "flood", "alerts", "help"];

function shouldOpenAlerts(
  alertCount: number,
  worstAlertSeverity: AlertSeverity | null,
  urgentVerdict: boolean,
): boolean {
  if (urgentVerdict) return true;
  if (alertCount > 0) return true;
  if (
    worstAlertSeverity &&
    SEVERITY_RANK[worstAlertSeverity] >= SEVERITY_RANK.watch
  ) {
    return true;
  }
  return false;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function LocationInfoPanel({
  map,
  location,
  onClose,
}: {
  map: MLMap | null;
  location: SelectedLocation | null;
  onClose: () => void;
}) {
  const key = location ? `${location.lat},${location.lon}` : null;
  const lat = location?.lat;
  const lon = location?.lon;

  const { data: forecast, loading: forecastLoading } =
    useAsyncResource<ForecastSummary>(key, () =>
      fetchForecast([lon as number, lat as number]),
    );
  const { data: alertsResult, loading: alertsLoading } = useAsyncResource(
    key,
    fetchAlerts,
  );
  const alerts: Alert[] = useMemo(
    () => alertsResult?.alerts ?? [],
    [alertsResult],
  );

  const { data: osm, loading: osmLoading } = useAsyncResource<OsmContextPayload>(
    key,
    async () => {
      const [west, south, east, north] = bboxAround(
        lat as number,
        lon as number,
        1500,
      );
      const url = `/api/osm-context?bbox=${west.toFixed(4)},${south.toFixed(
        4,
      )},${east.toFixed(4)},${north.toFixed(4)}&zoom=14`;
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) throw new Error(`osm-context ${r.status}`);
      return r.json() as Promise<OsmContextPayload>;
    },
  );

  // Flood probe is map-driven, not URL-fetched, so it stays inline.
  const [floodHits, setFloodHits] = useState<FloodHit[]>([]);
  useEffect(() => {
    if (!map || !location) {
      setFloodHits([]);
      return;
    }
    let cancelled = false;
    const probe = () => {
      if (!cancelled) setFloodHits(probeFlood(map, location.lat, location.lon));
    };
    probe();
    map.on("idle", probe);
    return () => {
      cancelled = true;
      map.off("idle", probe);
    };
  }, [map, location]);

  const [copied, setCopied] = useState<"coords" | "share" | null>(null);
  useEffect(() => setCopied(null), [key]);

  // ─── Derived state ────────────────────────────────────────────────────────

  const forecastAlert = useMemo(
    () => (forecast ? computeForecastAlert(forecast) : null),
    [forecast],
  );

  // Endpoints flag `degraded` when they fall back to last-known-good cache
  // (upstream provider was unreachable). Surface it instead of hiding it.
  const forecastDegraded = Boolean(
    (forecast as (ForecastSummary & { degraded?: boolean }) | null)?.degraded,
  );
  const osmDegraded = Boolean(osm?.degraded);

  const peakWeather = useMemo(
    () =>
      forecast
        ? {
            peakRain: Math.max(...forecast.daily.map((d) => d.rainMm)),
            maxWind: forecast.maxWindKph,
          }
        : null,
    [forecast],
  );

  const worstFlood = useMemo<FloodLevel | null>(
    () =>
      floodHits.length === 0
        ? null
        : floodHits.reduce<FloodLevel>(
            (acc, h) => (FLOOD_RANK[h.worst] > FLOOD_RANK[acc] ? h.worst : acc),
            "low",
          ),
    [floodHits],
  );

  const worstAlertSeverity = useMemo<AlertSeverity | null>(
    () =>
      alerts.reduce<AlertSeverity | null>(
        (acc, a) =>
          !acc || SEVERITY_RANK[a.severity] > SEVERITY_RANK[acc]
            ? a.severity
            : acc,
        null,
      ),
    [alerts],
  );

  const verdict = useMemo(
    () => computeVerdict({ forecastAlert, worstAlertSeverity, worstFlood }),
    [forecastAlert, worstAlertSeverity, worstFlood],
  );

  const nearbyFacilities = useMemo<NearbyFacility[]>(() => {
    if (!osm || !location) return [];
    const origin: [number, number] = [location.lon, location.lat];
    return (osm.facilities.features as FacilityFeature[])
      .map((f) => ({
        feature: f,
        distanceMeters: haversineMeters(
          origin,
          f.geometry.coordinates as [number, number],
        ),
        bearing: bearing(origin, f.geometry.coordinates as [number, number]),
      }))
      .sort((a, b) => {
        const dp = (b.feature.properties.priority ?? 0) - (a.feature.properties.priority ?? 0);
        return dp !== 0 ? dp : a.distanceMeters - b.distanceMeters;
      })
      .slice(0, 5);
  }, [osm, location]);

  // First-paint "assessing" state: nothing has resolved yet.
  const isAssessing =
    forecast === null && alerts.length === 0 && floodHits.length === 0 &&
    (forecastLoading || alertsLoading || !map);

  // ─── Actions ──────────────────────────────────────────────────────────────

  const flashCopy = useCallback((key: "coords" | "share") => {
    setCopied(key);
    window.setTimeout(() => setCopied(null), 1400);
  }, []);

  const writeClipboard = useCallback(
    (text: string, key: "coords" | "share") => {
      void navigator.clipboard?.writeText(text).then(() => flashCopy(key));
    },
    [flashCopy],
  );

  const onCopyCoords = useCallback(() => {
    if (!location) return;
    writeClipboard(
      `${location.lat.toFixed(5)}, ${location.lon.toFixed(5)}`,
      "coords",
    );
  }, [location, writeClipboard]);

  const onShare = useCallback(() => {
    if (!location) return;
    const url = new URL(window.location.href);
    url.searchParams.set(
      "loc",
      `${location.lat.toFixed(5)},${location.lon.toFixed(5)}`,
    );
    writeClipboard(url.toString(), "share");
  }, [location, writeClipboard]);

  const onRecenter = useCallback(() => {
    if (!map || !location) return;
    map.flyTo({
      center: [location.lon, location.lat],
      zoom: 15,
      duration: 1400,
      essential: true,
    });
  }, [map, location]);

  const onOpen3D = useCallback(() => {
    if (!map || !location) return;
    void focusAddress3DContext(map, {
      lat: location.lat,
      lon: location.lon,
      zoom: location.zoom,
    });
  }, [map, location]);

  const urgentVerdict =
    verdict.tone === "warn" || verdict.tone === "danger";

  const userToggledRef = useRef<Set<SectionId>>(new Set());
  const [openSections, setOpenSections] = useState<Record<SectionId, boolean>>({
    storm: true,
    flood: false,
    alerts: false,
    help: false,
  });

  useEffect(() => {
    userToggledRef.current = new Set();
    setOpenSections({
      storm: true,
      flood: false,
      alerts: false,
      help: false,
    });
  }, [key]);

  useEffect(() => {
    if (!key) return;
    setOpenSections((prev) => {
      const next = { ...prev };
      if (!userToggledRef.current.has("flood") && floodHits.length > 0) {
        next.flood = true;
      }
      if (
        !userToggledRef.current.has("alerts") &&
        shouldOpenAlerts(alerts.length, worstAlertSeverity, urgentVerdict)
      ) {
        next.alerts = true;
      }
      if (urgentVerdict && !userToggledRef.current.has("storm")) {
        next.storm = true;
      }
      return next;
    });
  }, [key, floodHits.length, alerts.length, worstAlertSeverity, urgentVerdict]);

  const toggleSection = useCallback((id: SectionId) => {
    userToggledRef.current.add(id);
    setOpenSections((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const expandAllSections = useCallback(() => {
    userToggledRef.current = new Set(SECTION_IDS);
    setOpenSections({
      storm: true,
      flood: true,
      alerts: true,
      help: true,
    });
  }, []);

  const collapseAllSections = useCallback(() => {
    userToggledRef.current = new Set(SECTION_IDS);
    setOpenSections({
      storm: false,
      flood: false,
      alerts: false,
      help: false,
    });
  }, []);

  const stormSummary = useMemo(() => {
    if (forecastLoading || !peakWeather || !forecastAlert) return "Loading…";
    return `${peakWeather.maxWind} kph · ${peakWeather.peakRain} mm · ${forecastAlert.label}`;
  }, [forecastLoading, peakWeather, forecastAlert]);

  const floodSummary = useMemo(() => {
    if (floodHits.length === 0) return "No mapped hazard";
    const worst = floodHits.reduce<FloodHit>(
      (acc, h) => (FLOOD_RANK[h.worst] > FLOOD_RANK[acc.worst] ? h : acc),
      floodHits[0],
    );
    return `${worst.returnPeriod}: ${FLOOD_LEVEL_STYLE[worst.worst].label}`;
  }, [floodHits]);

  const alertsSummary = useMemo(() => {
    if (alertsLoading) return "Loading…";
    if (alerts.length === 0) return "None";
    const sev = worstAlertSeverity ?? "info";
    return `${alerts.length} active · ${sev}`;
  }, [alertsLoading, alerts.length, worstAlertSeverity]);

  const helpSummary = useMemo(() => {
    if (osmLoading) return "Loading…";
    if (nearbyFacilities.length === 0) return "None nearby";
    return `${nearbyFacilities.length} within 1.5 km`;
  }, [osmLoading, nearbyFacilities.length]);

  if (!location) return null;

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col min-h-0 max-h-full overflow-hidden text-aeris-text md:backdrop-blur-md md:bg-aeris-surface/50 md:rounded-xl md:shadow-2xl md:border md:border-aeris-border/70">
      <div className="shrink-0">
        <Header
          location={location}
          onClose={onClose}
          onCopyCoords={onCopyCoords}
          copied={copied === "coords"}
        />
        <VerdictBand verdict={verdict} assessing={isAssessing} />
        <div className="mx-3 mb-2 flex items-center justify-end gap-2 text-chrome font-mono uppercase tracking-wider">
          <button
            type="button"
            onClick={expandAllSections}
            className="text-aeris-muted hover:text-aeris-accent transition-colors"
          >
            Expand all
          </button>
          <span className="text-aeris-border">·</span>
          <button
            type="button"
            onClick={collapseAllSections}
            className="text-aeris-muted hover:text-aeris-accent transition-colors"
          >
            Collapse all
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3">
        <CollapsibleSection
          id="storm"
          title="Storm impact (next 7 days)"
          Icon={Wind}
          summary={stormSummary}
          open={openSections.storm}
          onToggle={() => toggleSection("storm")}
          trailing={
            forecastDegraded ? (
              <span title="Showing last-known-good forecast; live source is unavailable.">
                <Pill tone="warn">cached</Pill>
              </span>
            ) : undefined
          }
        >
          {forecastLoading || !peakWeather || !forecastAlert ? (
            <SkeletonRow />
          ) : (
            <div className="grid grid-cols-3 gap-1.5">
              <Stat
                Icon={Wind}
                label="Peak wind"
                value={`${peakWeather.maxWind}`}
                suffix="kph"
                tone={thresholdTone(peakWeather.maxWind, 45, 60)}
              />
              <Stat
                Icon={CloudRain}
                label="Peak rain"
                value={`${peakWeather.peakRain}`}
                suffix="mm"
                tone={thresholdTone(peakWeather.peakRain, 20, 40)}
              />
              <Stat
                Icon={Shield}
                label="Risk band"
                value={forecastAlert.label}
                tone={
                  forecastAlert.tone === "warn" || forecastAlert.tone === "danger"
                    ? forecastAlert.tone
                    : undefined
                }
              />
            </div>
          )}
        </CollapsibleSection>

        <CollapsibleSection
          id="flood"
          title="Flood-hazard exposure"
          Icon={Waves}
          summary={floodSummary}
          open={openSections.flood}
          onToggle={() => toggleSection("flood")}
        >
          {floodHits.length === 0 ? (
            <Hint>
              No mapped flood pack covers this point, or the flood layer is
              hidden. Toggle a return period in the legend to probe.
            </Hint>
          ) : (
            <ul className="space-y-1">
              {floodHits.map((h) => (
                <FloodRow key={h.returnPeriod} hit={h} />
              ))}
            </ul>
          )}
        </CollapsibleSection>

        <CollapsibleSection
          id="alerts"
          title="Active national alerts"
          Icon={Radio}
          summary={alertsSummary}
          open={openSections.alerts}
          onToggle={() => toggleSection("alerts")}
          trailing={
            alertsLoading ? (
              <Pill>loading</Pill>
            ) : (
              <Pill tone={alerts.length > 0 ? "warn" : "ok"}>
                {alerts.length}
              </Pill>
            )
          }
        >
          {!alertsLoading && alerts.length === 0 ? (
            <div className="flex items-center gap-1.5 text-body-sm text-aeris-ok">
              <CheckCircle2 size={14} />
              <span>No GDACS or PAGASA bulletins in effect.</span>
            </div>
          ) : (
            <ul className="space-y-2">
              {alerts.slice(0, 3).map((a) => (
                <li key={a.id}>
                  <AlertCard alert={a} />
                </li>
              ))}
            </ul>
          )}
        </CollapsibleSection>

        <CollapsibleSection
          id="help"
          title="Nearest help"
          Icon={Ambulance}
          summary={helpSummary}
          open={openSections.help}
          onToggle={() => toggleSection("help")}
          trailing={
            osmLoading ? (
              <Pill>loading</Pill>
            ) : osmDegraded ? (
              <span title="Showing last-known-good map data; OpenStreetMap was unavailable.">
                <Pill tone="warn">cached</Pill>
              </span>
            ) : (
              <Pill>{nearbyFacilities.length}</Pill>
            )
          }
        >
          {!osmLoading && nearbyFacilities.length === 0 ? (
            <Hint>No facilities tagged in OpenStreetMap within ~1.5 km.</Hint>
          ) : (
            <VirtualList
              items={nearbyFacilities}
              rowHeight={44}
              className="max-h-52 -mx-1 px-1"
              render={(nf) => <FacilityRow item={nf} />}
            />
          )}
        </CollapsibleSection>
      </div>

      <div className="shrink-0 px-3 py-2 border-t border-aeris-border/40 bg-aeris-surface/95 max-md:backdrop-blur-none md:bg-aeris-surface/80 md:backdrop-blur-sm flex flex-wrap gap-1.5">
        <ActionButton onClick={onRecenter}>Recenter</ActionButton>
        <ActionButton onClick={onOpen3D}>Open in 3D</ActionButton>
        <ActionButton onClick={onShare} Icon={Share2}>
          {copied === "share" ? "Link copied" : "Share"}
        </ActionButton>
      </div>
    </div>
  );
}

// ─── Subcomponents ──────────────────────────────────────────────────────────

function Header({
  location,
  onClose,
  onCopyCoords,
  copied,
}: {
  location: SelectedLocation;
  onClose: () => void;
  onCopyCoords: () => void;
  copied: boolean;
}) {
  return (
    <div className="px-3 pt-3 pb-2 flex items-start justify-between gap-2 border-b border-aeris-border/40">
      <div className="min-w-0 flex-1">
        <div className="hud-text text-chrome text-aeris-accent tracking-widest mb-0.5">
          LOCATION INFO · {location.typeLabel}
        </div>
        <div className="text-body-sm font-semibold truncate leading-tight">
          {location.shortName}
        </div>
        {location.breadcrumb && (
          <div className="text-body-sm text-aeris-muted truncate mt-0.5">
            {location.breadcrumb}
          </div>
        )}
        <button
          type="button"
          onClick={onCopyCoords}
          className="mt-1 text-body-sm font-mono text-aeris-muted hover:text-aeris-accent transition-colors inline-flex items-center gap-1"
          title="Copy coordinates"
        >
          <Copy size={10} />
          <span>
            {location.lat.toFixed(4)}, {location.lon.toFixed(4)}
          </span>
          {copied && (
            <span className="text-aeris-ok text-chrome uppercase tracking-wider">
              copied
            </span>
          )}
        </button>
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close location info"
        className="shrink-0 text-aeris-muted/70 hover:text-aeris-text transition-colors p-1 -m-1 rounded-md hover:bg-aeris-elev/50"
      >
        <X size={16} />
      </button>
    </div>
  );
}

function VerdictBand({
  verdict,
  assessing,
}: {
  verdict: SafetyVerdict;
  assessing: boolean;
}) {
  const Icon = verdict.Icon;
  return (
    <div
      className={clsx(
        "mx-3 mt-3 rounded-lg border px-3 py-2.5 flex items-start gap-2.5",
        TONE_BG[verdict.tone],
      )}
    >
      <Icon size={22} className="shrink-0 mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="text-body font-bold uppercase tracking-wide">
          {assessing ? "Assessing…" : verdict.label}
        </div>
        <p className="text-[10.5px] opacity-85 leading-snug mt-1">
          {assessing
            ? "Checking forecasts, advisories, and flood maps for this point."
            : verdict.detail}
        </p>
      </div>
    </div>
  );
}

function FloodRow({ hit }: { hit: FloodHit }) {
  return (
    <li className="flex items-center justify-between gap-2 text-body-sm">
      <span className="font-mono text-aeris-muted uppercase tracking-wider text-body-sm">
        {hit.returnPeriod} return
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span
          className="w-2.5 h-2.5 rounded-sm border border-black/30"
          style={{ backgroundColor: FLOOD_LEVEL_STYLE[hit.worst].color }}
        />
        <Pill tone={floodLevelTone(hit.worst)}>
          {FLOOD_LEVEL_STYLE[hit.worst].label}
        </Pill>
      </span>
    </li>
  );
}

function FacilityRow({ item }: { item: NearbyFacility }) {
  const p = item.feature.properties;
  const meta = FACILITY_META[p.category] ?? FACILITY_FALLBACK;
  const Icon = meta.Icon;
  return (
    <div className="flex items-center justify-between gap-2 text-body-sm py-0.5">
      <div className="min-w-0 flex items-center gap-1.5">
        <Icon size={14} className={clsx("shrink-0", meta.tone)} />
        <div className="min-w-0">
          <div className="truncate font-medium leading-tight">
            {p.name ?? p.categoryLabel}
          </div>
          <div className="text-chrome text-aeris-muted uppercase tracking-wider">
            {p.categoryLabel}
          </div>
        </div>
      </div>
      <span className="shrink-0 font-mono text-body-sm text-aeris-muted">
        {formatDistance(item.distanceMeters)} {item.bearing}
      </span>
    </div>
  );
}

function CollapsibleSection({
  id,
  title,
  Icon,
  summary,
  open,
  onToggle,
  trailing,
  children,
}: {
  id: SectionId;
  title: string;
  Icon: LucideIcon;
  summary: string;
  open: boolean;
  onToggle: () => void;
  trailing?: ReactNode;
  children: ReactNode;
}) {
  const panelId = `location-section-${id}`;
  return (
    <div className="mt-2 border-b border-aeris-border/30 pb-2 last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        className={clsx(
          "flex w-full items-center gap-1.5 rounded-md px-1 py-1.5 text-left transition-colors",
          open
            ? "bg-aeris-accent/5"
            : "hover:bg-aeris-elev/40",
        )}
      >
        <Icon size={12} className="text-aeris-muted shrink-0" />
        <span className="hud-text text-chrome text-aeris-muted tracking-widest shrink-0">
          {title}
        </span>
        {!open && (
          <span className="min-w-0 flex-1 truncate text-body-sm text-aeris-text/80 font-mono normal-case tracking-normal ml-1">
            {summary}
          </span>
        )}
        {trailing && (
          <span className="shrink-0" onClick={(e) => e.stopPropagation()}>
            {trailing}
          </span>
        )}
        <ChevronDown
          size={14}
          aria-hidden
          className={clsx(
            "shrink-0 text-aeris-muted transition-transform ml-auto",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <div id={panelId} className="mt-1.5 px-1">
          {children}
        </div>
      )}
    </div>
  );
}

const STAT_TONE_CLASS: Record<"warn" | "danger", { box: string; text: string }> = {
  warn: { box: "border-aeris-warn/40 bg-aeris-warn/10", text: "text-aeris-warn" },
  danger: { box: "border-aeris-danger/40 bg-aeris-danger/10", text: "text-aeris-danger" },
};

function Stat({
  label,
  value,
  suffix,
  tone,
  Icon,
}: {
  label: string;
  value: string;
  suffix?: string;
  tone?: "warn" | "danger";
  Icon?: LucideIcon;
}) {
  const t = tone ? STAT_TONE_CLASS[tone] : null;
  return (
    <div
      className={clsx(
        "rounded-md border px-2 py-1.5",
        t ? t.box : "border-aeris-border/50 bg-aeris-elev/30",
      )}
    >
      <div className="flex items-center gap-1 text-label text-aeris-muted">
        {Icon && <Icon size={12} />}
        <span>{label}</span>
      </div>
      <div
        className={clsx("font-semibold text-body leading-tight mt-0.5", t?.text)}
      >
        {value}
        {suffix && (
          <span className="ml-0.5 text-chrome font-normal text-aeris-muted">
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}

const SkeletonRow = () => (
  <div className="h-12 rounded-md bg-aeris-elev/30 border border-aeris-border/30 animate-pulse" />
);

const Hint = ({ children }: { children: ReactNode }) => (
  <p className="text-body-sm text-aeris-muted leading-snug">{children}</p>
);

function ActionButton({
  children,
  onClick,
  Icon,
}: {
  children: ReactNode;
  onClick: () => void;
  Icon?: LucideIcon;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-body-sm px-2 py-1.5 rounded-md border border-aeris-border/60 text-aeris-muted hover:text-aeris-accent hover:border-aeris-accent/60 transition-colors inline-flex items-center gap-1 min-h-[44px]"
    >
      {Icon && <Icon size={11} />}
      {children}
    </button>
  );
}

const thresholdTone = (
  v: number,
  warnAt: number,
  dangerAt: number,
): "warn" | "danger" | undefined =>
  v >= dangerAt ? "danger" : v >= warnAt ? "warn" : undefined;
