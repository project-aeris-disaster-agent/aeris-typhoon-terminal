"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Map as MLMap } from "maplibre-gl";
import { RefreshCw } from "lucide-react";
import { useVisiblePolling } from "@/hooks/useVisiblePolling";
import { CardHeader, Pill } from "../ui/Card";
import { usePanelHeaderBadge } from "@/components/panel-header-badge";
import { FreshnessTag } from "../ui/FreshnessTag";
import {
  fetchActiveTyphoons,
  fetchPagasaBulletins,
  renderTyphoonOnMap,
  clearTyphoonFromMap,
  renderOutsideParAdvisoryOnMap,
  clearOutsideParAdvisoryFromMap,
  type OutsideParAdvisory,
  type PagasaBulletinItem,
  type PagasaBulletinsFetchResult,
  type Typhoon,
} from "@/services/typhoon-tracks";
import {
  TYPHOON_FOCUS_EVENT,
  PAR_STORMS_EVENT,
  type TyphoonFocusDetail,
  type ParStormsDetail,
} from "@/services/live-weather-overlay";
import { PdfOverlay, type PdfOverlayConfig } from "@/components/PdfOverlay";

export function TyphoonTrackerPanel({ map }: { map: MLMap | null }) {
  const [storms, setStorms] = useState<Typhoon[]>([]);
  const [outsidePar, setOutsidePar] = useState<OutsideParAdvisory | null>(null);
  const [outsideParGdacs, setOutsideParGdacs] = useState<Typhoon[]>([]);
  const [bulletins, setBulletins] = useState<PagasaBulletinItem[]>([]);
  const [bulletinMeta, setBulletinMeta] = useState<PagasaBulletinsFetchResult>({
    bulletins: [],
    fetchedAt: null,
    indexAgeSeconds: null,
    hasActive: false,
    quiet: false,
    stale: false,
    warning: null,
    unavailable: false,
  });
  const [bulletinRefreshing, setBulletinRefreshing] = useState(false);
  const [pdfPreview, setPdfPreview] = useState<PdfOverlayConfig | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const isFirstRun = useRef(true);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const hasOutsidePar = Boolean(outsidePar) || outsideParGdacs.length > 0;
  const hasAnyTc = storms.length > 0 || hasOutsidePar;
  // The PAGASA advisory and a tracked storm can be the same system (linked by
  // coveredByStormId). Cards: one entry — the PAGASA card, carrying the
  // tracked storm's approach data. Map: the tracked storm renders (real track
  // and forecast); the advisory's single parsed point does not.
  const coveringStorm = outsidePar?.coveredByStormId
    ? (outsideParGdacs.find((s) => s.id === outsidePar.coveredByStormId) ?? null)
    : null;
  const uncoveredMonitors = outsideParGdacs.filter(
    (s) => s.id !== outsidePar?.coveredByStormId,
  );

  const outsideParThreats: OutsideParThreatItem[] = [
    ...(outsidePar
      ? [
          (() => {
            const names = resolveStormDisplayNames(
              formatPagasaStormName(outsidePar.name),
            );
            return {
              key: "pagasa",
              name: names.primary,
              subName: names.secondary,
              windKph: outsidePar.windKph,
              distanceToParKm: coveringStorm?.distanceToParKm,
              approachingPar: coveringStorm?.approachingPar,
              source: "pagasa" as const,
            };
          })(),
        ]
      : []),
    ...uncoveredMonitors.map((s) => {
      const names = resolveStormDisplayNames(s.name, s.localName);
      return {
        key: s.id,
        name: names.primary,
        subName: names.secondary,
        windKph: s.windKph,
        distanceToParKm: s.distanceToParKm,
        approachingPar: s.approachingPar,
        source: "gdacs" as const,
      };
    }),
  ];

  const monitorCount = outsideParThreats.length;

  const statusBadge = useMemo(() => {
    if (loading) return <Pill>loading</Pill>;
    if (error) return <Pill tone="danger">err</Pill>;
    if (storms.length > 0 && hasOutsidePar) {
      return (
        <Pill tone="warn">
          {storms.length} in PAR · {monitorCount} monitor
        </Pill>
      );
    }
    if (storms.length > 0) return <Pill tone="warn">{storms.length} in PAR</Pill>;
    if (hasOutsidePar) return <Pill tone="warn">{monitorCount} monitor</Pill>;
    return <Pill tone="ok">clear</Pill>;
  }, [loading, error, storms.length, hasOutsidePar, monitorCount]);

  usePanelHeaderBadge("typhoon", statusBadge);

  const visibleBulletins = useMemo(() => {
    if (storms.length === 0) return bulletins;
    const parNames = new Set<string>();
    for (const s of storms) {
      if (s.localName) parNames.add(s.localName.toLowerCase());
      parNames.add(s.name.toLowerCase());
    }
    const matched = bulletins.filter((b) =>
      parNames.has(b.name.toLowerCase()),
    );
    return matched.length > 0 ? matched : bulletins;
  }, [bulletins, storms]);

  useVisiblePolling(() => {
    void (async () => {
      if (isFirstRun.current) setLoading(true);
      try {
        const result = await fetchActiveTyphoons();
        setStorms(result.storms);
        setOutsidePar(result.outsidePar);
        setOutsideParGdacs(result.outsideParGdacs);
        setWarning(result.warning);
        setError(null);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
        isFirstRun.current = false;
      }
    })();
  }, 15 * 60 * 1000);

  const loadBulletins = useCallback(async (refresh?: boolean) => {
    const result = await fetchPagasaBulletins({ refresh });
    setBulletins(result.bulletins);
    setBulletinMeta(result);
  }, []);

  const handleRefreshBulletins = useCallback(async () => {
    setBulletinRefreshing(true);
    try {
      await loadBulletins(true);
    } finally {
      setBulletinRefreshing(false);
    }
  }, [loadBulletins]);

  // Official PAGASA bulletins are supplementary PDF links; fetch them on their
  // own cadence so a slow JTWC feed never holds back (or is held back by) them.
  const bulletinPollMs =
    bulletinMeta.hasActive || storms.length > 0
      ? 3 * 60 * 1000
      : 15 * 60 * 1000;

  useVisiblePolling(() => {
    void (async () => {
      const result = await fetchPagasaBulletins();
      setBulletins(result.bulletins);
      setBulletinMeta(result);
    })();
  }, bulletinPollMs);

  useEffect(() => {
    if (focusedId && !storms.some((s) => s.id === focusedId)) {
      setFocusedId(null);
    }
  }, [storms, focusedId]);

  useEffect(() => {
    const storm = focusedId
      ? (storms.find((s) => s.id === focusedId) ?? null)
      : null;
    window.dispatchEvent(
      new CustomEvent<TyphoonFocusDetail>(TYPHOON_FOCUS_EVENT, {
        detail: { storm },
      }),
    );
  }, [focusedId, storms]);

  useEffect(() => {
    return () => {
      window.dispatchEvent(
        new CustomEvent<TyphoonFocusDetail>(TYPHOON_FOCUS_EVENT, {
          detail: { storm: null },
        }),
      );
    };
  }, []);

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent<ParStormsDetail>(PAR_STORMS_EVENT, { detail: { storms } }),
    );
  }, [storms]);

  useEffect(() => {
    return () => {
      window.dispatchEvent(
        new CustomEvent<ParStormsDetail>(PAR_STORMS_EVENT, { detail: { storms: [] } }),
      );
    };
  }, []);

  // Everything the tracker knows about goes on the map, not just in-PAR
  // storms: red for systems inside PAR, amber for outside-PAR monitors, and
  // the PAGASA advisory storm when its location text parsed to coordinates.
  // Each carries a projected-motion ray (see lib/tc-projection.ts) — a
  // dead-reckoned direction indicator, deliberately styled apart from the
  // official track.
  useEffect(() => {
    if (!map) return;
    for (const s of storms) renderTyphoonOnMap(map, s, { variant: "par" });
    for (const s of outsideParGdacs)
      renderTyphoonOnMap(map, s, { variant: "monitor" });
    // The advisory's single parsed point only renders when no tracked storm
    // covers the same system — a real track and forecast beat dead reckoning.
    if (outsidePar && !outsidePar.coveredByStormId) {
      renderOutsideParAdvisoryOnMap(map, outsidePar);
    }
    return () => {
      for (const s of storms) clearTyphoonFromMap(map, s.id);
      for (const s of outsideParGdacs) clearTyphoonFromMap(map, s.id);
      clearOutsideParAdvisoryFromMap(map);
    };
  }, [map, storms, outsideParGdacs, outsidePar]);

  return (
    <div className="space-y-2">
      <CardHeader
        title="Active Storms"
        trailing={statusBadge}
      />

      {!hasAnyTc && !loading && !error && (
        <div className="aeris-incident space-y-0.5 px-3 py-2" data-tone="ok">
          <div className="flex items-center gap-2 text-[0.6875rem] font-black uppercase tracking-[0.12em] text-aeris-ok">
            <span className="aeris-live-dot" aria-hidden />
            No typhoon threat active
          </div>
          <div className="text-body-sm text-aeris-ink2">
            No tropical cyclone on the last advisory check.
          </div>
        </div>
      )}

      {storms.length > 0 && !loading && (
        <p className="text-body-sm text-aeris-muted leading-snug">
          Storms in PAR feed cyclonic flow on the map. Tap one to boost the{" "}
          <span className="font-medium text-aeris-text/80">live weather</span> loop.
        </p>
      )}

      {storms.map((s) => {
        const threat = threatFromWind(s.windKph);
        const isFocused = focusedId === s.id;
        const names = resolveStormDisplayNames(s.name, s.localName);
        return (
          <button
            key={s.id}
            type="button"
            onClick={() =>
              setFocusedId((cur) => (cur === s.id ? null : s.id))
            }
            // The game's warm "Storm of the Day" card; red stripe from Severe up.
            data-tone={threat.tone === "danger" ? "danger" : undefined}
            aria-pressed={isFocused}
            className={`aeris-warm-card w-full text-left p-3 space-y-2.5 transition-shadow hover:shadow-pill ${
              isFocused ? "ring-2 ring-aeris-accent/60" : ""
            }`}
          >
            <StormHero
              name={names.primary}
              subName={names.secondary}
              category={s.category}
              windKph={s.windKph}
              threat={threat}
            />
            <div className="grid grid-cols-2 gap-1.5 text-body-sm">
              <Metric
                label="Pressure"
                value={s.pressureHpa > 0 ? `${s.pressureHpa} hPa` : "n/a"}
              />
              <Metric label="Heading" value={s.heading ?? "—"} />
              <Metric label="Position" value={formatLngLat(s.position)} />
              <Metric
                label="Category"
                value={s.category || "n/a"}
              />
            </div>
            {s.landfallEta && (
              <div className="text-body-sm font-extrabold text-aeris-warn">
                Landfall ETA: {s.landfallEta}
              </div>
            )}
          </button>
        );
      })}

      {outsideParThreats.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between px-0.5">
            <span className="aeris-label">Outside PAR · monitoring</span>
            <span className="aeris-key">{outsideParThreats.length}</span>
          </div>
          {outsideParThreats.map(({ key, ...rest }) => (
            <OutsideParThreatRow key={key} {...rest} />
          ))}
        </div>
      )}

      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2 px-0.5">
          <span className="aeris-label">Official PAGASA bulletins</span>
          <div className="flex items-center gap-2">
            {visibleBulletins.length > 0 && (
              <span className="aeris-key">{visibleBulletins.length}</span>
            )}
            <button
              type="button"
              onClick={() => void handleRefreshBulletins()}
              disabled={bulletinRefreshing}
              className="aeris-btn-soft shrink-0 h-6 px-2 text-[0.6875rem] uppercase tracking-[0.1em] disabled:opacity-50"
              aria-label="Sync PAGASA bulletins"
            >
              <RefreshCw
                size={11}
                className={bulletinRefreshing ? "animate-spin" : ""}
              />
              Sync
            </button>
          </div>
        </div>
        {bulletinMeta.warning && (
          <div className="px-0.5 text-body-sm text-aeris-warn">
            {bulletinMeta.warning}
          </div>
        )}
        {bulletinMeta.indexAgeSeconds != null &&
          bulletinMeta.indexAgeSeconds > 900 &&
          bulletinMeta.hasActive && (
            <div className="px-0.5 text-body-sm text-aeris-warn">
              Parser index is {Math.round(bulletinMeta.indexAgeSeconds / 60)}m
              old — new bulletins may not appear yet.
            </div>
          )}
        {visibleBulletins.length > 0 ? (
          visibleBulletins.map((b) => (
            <BulletinRow
              key={`${b.archive ? "archive" : "active"}-${b.name}-${b.number}`}
              {...b}
              onOpen={() =>
                setPdfPreview({
                  url: b.pdfUrl,
                  title: b.archive
                    ? `${b.name} — Severe Weather Bulletin #${b.number}`
                    : `${b.name} — Bulletin #${b.number}`,
                  subtitle: b.archive
                    ? "PAGASA Severe Weather Bulletin · Latest"
                    : b.final
                      ? "PAGASA Tropical Cyclone Bulletin · Final"
                      : "PAGASA Tropical Cyclone Bulletin",
                })
              }
            />
          ))
        ) : (
          <p className="px-0.5 text-body-sm text-aeris-muted leading-snug">
            {bulletinMeta.unavailable
              ? "Bulletin index unavailable — try Sync shortly."
              : "No PAGASA severe weather bulletin available."}
          </p>
        )}
      </div>

      <PdfOverlay
        open={pdfPreview !== null}
        onClose={() => setPdfPreview(null)}
        config={pdfPreview}
      />

      <FreshnessTag source="typhoons" />

      {warning && !error && (
        <div className="text-body-sm text-aeris-warn">
          Advisory source degraded: {warning}
        </div>
      )}

      {error && (
        <div className="text-body-sm text-aeris-danger">
          Source unreachable: {error}
        </div>
      )}
    </div>
  );
}

type OutsideParThreatItem = {
  key: string;
  /** Filipino / PAGASA name when known; otherwise international. */
  name: string;
  /** International name shown under the primary title. */
  subName?: string;
  windKph?: number | null;
  distanceToParKm?: number;
  approachingPar?: boolean;
  source: "pagasa" | "gdacs";
};

/**
 * Minimalist one-line indicator for a weather threat detected outside PAR.
 * Replaces the heavier monitor card: a status dot, name, approach/distance,
 * and a compact wind figure — enough to glance at without opening a subpanel.
 */
function OutsideParThreatRow({
  name,
  subName,
  windKph,
  distanceToParKm,
  approachingPar,
  source,
}: Omit<OutsideParThreatItem, "key">) {
  const dotTone = approachingPar
    ? "bg-aeris-warn shadow-[0_0_6px_rgba(245,158,11,0.7)]"
    : "bg-aeris-muted";
  const statusClass = approachingPar ? "text-aeris-warn" : "text-aeris-muted";
  const status = approachingPar ? "Approaching PAR" : "Outside PAR";

  const meta =
    typeof distanceToParKm === "number"
      ? `~${distanceToParKm.toLocaleString("en-US")} km`
      : source === "pagasa"
        ? "PAGASA advisory"
        : null;

  return (
    <div
      className="aeris-incident aeris-monitor-wipe flex items-center gap-2.5 px-2.5 py-2"
      data-tone={approachingPar ? "danger" : undefined}
    >
      <span
        className={`inline-block h-2 w-2 shrink-0 rounded-full ${dotTone}`}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-body-sm font-black text-aeris-text">
          {name}
        </div>
        {subName ? (
          <div className="truncate font-mono text-chrome uppercase tracking-wider text-aeris-muted">
            {subName}
          </div>
        ) : null}
        <div
          className={`truncate text-chrome uppercase tracking-wider ${statusClass}`}
        >
          {status}
          {meta ? ` · ${meta}` : ""}
        </div>
      </div>
      {typeof windKph === "number" && windKph > 0 && (
        <span className="shrink-0 text-right leading-none">
          <span className="block text-base font-black tabular-nums text-aeris-text">
            {windKph}
          </span>
          <span className="text-[0.6875rem] font-bold text-aeris-muted">km/h</span>
        </span>
      )}
    </div>
  );
}

/**
 * One-line row that opens an official PAGASA bulletin PDF in an in-app popup.
 * Archive (quiet-PAR) and final bulletins are dimmed; active ones get an accent dot.
 */
function BulletinRow({
  name,
  number,
  final,
  archive,
  onOpen,
}: PagasaBulletinItem & { onOpen: () => void }) {
  const muted = Boolean(archive || final);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="aeris-row flex w-full items-center gap-2.5 px-2.5 py-2 text-left"
    >
      <span
        className={`inline-block h-2 w-2 shrink-0 rounded-full ${
          muted
            ? "bg-aeris-muted"
            : "bg-aeris-warn shadow-[0_0_6px_rgba(245,158,11,0.7)]"
        }`}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-body-sm font-black text-aeris-text">
          {name}
        </div>
        <div className="truncate text-chrome uppercase tracking-wider text-aeris-muted">
          {archive
            ? `Severe Weather Bulletin #${number} · Latest`
            : `Bulletin #${number}${final ? " · Final" : ""}`}
        </div>
      </div>
      <span className="aeris-kicker shrink-0 !px-2 !py-0.5 !text-[0.625rem]">View PDF</span>
    </button>
  );
}

/** Format a [lng, lat] pair with proper N/S and E/W hemispheres. */
function formatLngLat(position: [number, number]): string {
  const [lng, lat] = position;
  const ns = `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? "N" : "S"}`;
  const ew = `${Math.abs(lng).toFixed(1)}°${lng >= 0 ? "E" : "W"}`;
  return `${ns}, ${ew}`;
}

type ThreatTone = "ok" | "accent" | "warn" | "danger";
type ThreatLevel = {
  label: string;
  tone: ThreatTone;
  barPct: number;
  description: string;
};

function threatFromWind(windKph: number): ThreatLevel {
  if (!windKph || windKph <= 0) {
    return { label: "Unknown", tone: "ok", barPct: 8, description: "No wind data yet" };
  }
  if (windKph < 62) {
    return { label: "Low", tone: "accent", barPct: 20, description: "Tropical depression" };
  }
  if (windKph < 89) {
    return { label: "Moderate", tone: "warn", barPct: 40, description: "Tropical storm" };
  }
  if (windKph < 118) {
    return { label: "High", tone: "warn", barPct: 60, description: "Severe tropical storm" };
  }
  if (windKph < 185) {
    return { label: "Severe", tone: "danger", barPct: 80, description: "Typhoon" };
  }
  return { label: "Extreme", tone: "danger", barPct: 100, description: "Super typhoon" };
}

function StormHero({
  name,
  subName,
  category,
  windKph,
  threat,
  statusLabel,
  statusTone,
}: {
  name: string;
  subName?: string;
  category?: string;
  windKph: number;
  threat: ThreatLevel;
  statusLabel?: string;
  statusTone?: "warn" | "danger" | "accent" | "ok" | "default";
}) {
  const status = statusLabel ?? (category ? category : null);
  const tone = statusTone ?? (category ? categoryTone(category) : "warn");
  const barColor =
    threat.tone === "danger"
      ? "bg-aeris-danger"
      : threat.tone === "warn"
        ? "bg-aeris-warn"
        : threat.tone === "accent"
          ? "bg-aeris-accent"
          : "bg-aeris-ok";

  return (
    <div className="space-y-1.5">
      <div className="min-w-0">
        <div className="text-lg font-black leading-tight text-aeris-text truncate">
          {name}
        </div>
        {subName && (
          <div className="font-mono text-body-sm uppercase tracking-wider text-aeris-muted truncate">
            {subName}
          </div>
        )}
      </div>

      <div className="flex items-start justify-between gap-2">
        <div className="aeris-label">Sustained wind</div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <Pill tone={threat.tone}>{threat.label} threat</Pill>
          {status && <Pill tone={tone}>{status}</Pill>}
        </div>
      </div>

      <div className="min-w-0">
        <div className="leading-none">
          <span className="text-[1.75rem] font-black tabular-nums text-aeris-text">
            {windKph > 0 ? windKph : "—"}
          </span>
          <span className="text-body-sm font-bold text-aeris-muted ml-1">km/h</span>
        </div>
      </div>

      <div
        className="aeris-bar w-full"
        role="meter"
        aria-label={`Threat level: ${threat.label}`}
        aria-valuenow={threat.barPct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={`h-full rounded-full ${barColor} transition-all`}
          style={{ width: `${threat.barPct}%` }}
        />
      </div>
      <div className="text-body-sm text-aeris-muted leading-snug">
        {threat.description}
      </div>
    </div>
  );
}

function formatPagasaStormName(raw: string): string {
  return decodePagasaText(raw)
    .replace(/^TROPICAL\s+(?:STORM|DEPRESSION|CYCLONE|TYPHOON)\s+/i, "")
    .replace(/^SEVERE\s+TROPICAL\s+STORM\s+/i, "")
    .replace(/^SUPER\s+TYPHOON\s+/i, "")
    .trim();
}

/**
 * Filipino / PAGASA name first; international name as secondary when known.
 * Handles GDACS `localName` + `name`, and PAGASA "Local (International)" strings.
 * Numeric parentheses like "(2611)" are JTWC designations, not names.
 */
function resolveStormDisplayNames(
  internationalOrRaw: string,
  localName?: string | null,
): { primary: string; secondary?: string } {
  const intlRaw = decodePagasaText(internationalOrRaw).trim();
  const local = localName?.trim() || null;

  if (local) {
    const intl = stripStormDesignation(intlRaw) || intlRaw;
    if (intl && local.toLowerCase() !== intl.toLowerCase()) {
      return { primary: local, secondary: intl };
    }
    return { primary: local };
  }

  const cleaned = formatPagasaStormName(intlRaw);
  const paired = cleaned.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  if (!paired) return { primary: cleaned || intlRaw };

  const outer = paired[1].trim();
  const inner = paired[2].trim();
  if (/^\d{2,4}[A-Z]?$/i.test(inner)) {
    // "HAISHEN (2611)" — international only until PAGASA assigns a local name.
    return { primary: outer };
  }
  // PAGASA convention: Local (International)
  return { primary: outer, secondary: inner };
}

function stripStormDesignation(raw: string): string {
  return raw.replace(/\s*\(\d{2,4}[A-Z]?\)\s*$/i, "").trim();
}

function decodePagasaText(raw: string): string {
  return raw.replace(/&deg;/gi, "°").replace(/&amp;/g, "&").trim();
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-aeris-surface/70 px-2 py-1">
      <div className="aeris-label !text-[0.625rem]">{label}</div>
      <div className="truncate font-extrabold tabular-nums text-aeris-text">{value}</div>
    </div>
  );
}

function categoryTone(c: string) {
  if (/Super|5|4/.test(c)) return "danger" as const;
  if (/Typhoon|3/.test(c)) return "warn" as const;
  return "accent" as const;
}
