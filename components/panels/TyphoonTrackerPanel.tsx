"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as MLMap } from "maplibre-gl";
import { CardHeader, Pill } from "../ui/Card";
import { FreshnessTag } from "../ui/FreshnessTag";
import {
  fetchActiveTyphoons,
  renderTyphoonOnMap,
  clearTyphoonFromMap,
  type OutsideParAdvisory,
  type Typhoon,
} from "@/services/typhoon-tracks";
import {
  TYPHOON_FOCUS_EVENT,
  PAR_STORMS_EVENT,
  type TyphoonFocusDetail,
  type ParStormsDetail,
} from "@/services/live-weather-overlay";

export function TyphoonTrackerPanel({ map }: { map: MLMap | null }) {
  const [storms, setStorms] = useState<Typhoon[]>([]);
  const [outsidePar, setOutsidePar] = useState<OutsideParAdvisory | null>(null);
  const [outsideParGdacs, setOutsideParGdacs] = useState<Typhoon[]>([]);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const isFirstRun = useRef(true);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const hasOutsidePar = Boolean(outsidePar) || outsideParGdacs.length > 0;
  const hasAnyTc = storms.length > 0 || hasOutsidePar;
  const monitorCount = (outsidePar ? 1 : 0) + outsideParGdacs.length;

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (isFirstRun.current) setLoading(true);
      try {
        const result = await fetchActiveTyphoons();
        if (!cancelled) {
          setStorms(result.storms);
          setOutsidePar(result.outsidePar);
          setOutsideParGdacs(result.outsideParGdacs);
          setWarning(result.warning);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) {
          setLoading(false);
          isFirstRun.current = false;
        }
      }
    };
    run();
    const id = window.setInterval(run, 15 * 60 * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

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

  useEffect(() => {
    if (!map) return;
    for (const s of storms) renderTyphoonOnMap(map, s);
    return () => {
      for (const s of storms) clearTyphoonFromMap(map, s.id);
    };
  }, [map, storms]);

  return (
    <div className="space-y-2">
      <CardHeader
        title="Active Storms"
        trailing={
          loading ? (
            <Pill>loading</Pill>
          ) : error ? (
            <Pill tone="danger">err</Pill>
          ) : storms.length > 0 && hasOutsidePar ? (
            <Pill tone="warn">
              {storms.length} in PAR · {monitorCount} monitor
            </Pill>
          ) : storms.length > 0 ? (
            <Pill tone="warn">{storms.length} in PAR</Pill>
          ) : hasOutsidePar ? (
            <Pill tone="warn">{monitorCount} monitor</Pill>
          ) : (
            <Pill tone="ok">clear</Pill>
          )
        }
      />

      {!hasAnyTc && !loading && !error && (
        <div className="py-2 space-y-1">
          <div className="text-xs font-medium tracking-wide text-aeris-ok">
            NO TYPHOON THREAT ACTIVE
          </div>
          <div className="text-[11px] text-aeris-muted">
            No tropical cyclone on the last advisory check.
          </div>
        </div>
      )}

      {storms.length > 0 && !loading && (
        <p className="text-[10px] text-aeris-muted leading-snug">
          Storms in PAR feed cyclonic flow on the map. Tap one to boost the{" "}
          <span className="font-medium text-aeris-text/80">live weather</span> loop.
        </p>
      )}

      {storms.map((s) => {
        const threat = threatFromWind(s.windKph);
        const isFocused = focusedId === s.id;
        return (
          <button
            key={s.id}
            type="button"
            onClick={() =>
              setFocusedId((cur) => (cur === s.id ? null : s.id))
            }
            className={`w-full text-left p-2.5 rounded-lg border space-y-2 transition-colors ${
              isFocused
                ? "border-aeris-accent/60 bg-aeris-accent/10 ring-1 ring-aeris-accent/30"
                : "border-aeris-border bg-aeris-bg/40 hover:border-aeris-border/80 hover:bg-aeris-bg/55"
            }`}
          >
            <StormHero
              name={s.localName ?? s.name}
              subName={s.localName && s.name !== s.localName ? s.name : undefined}
              category={s.category}
              windKph={s.windKph}
              threat={threat}
            />
            <div className="grid grid-cols-2 gap-1 text-[11px] text-aeris-muted">
              <Metric
                label="Pressure"
                value={s.pressureHpa > 0 ? `${s.pressureHpa} hPa` : "n/a"}
              />
              <Metric label="Heading" value={s.heading ?? "—"} />
              <Metric
                label="Position"
                value={`${s.position[1].toFixed(1)}°N, ${s.position[0].toFixed(1)}°E`}
              />
              <Metric
                label="Category"
                value={s.category || "n/a"}
              />
            </div>
            {s.landfallEta && (
              <div className="text-[11px] text-aeris-warn">
                Landfall ETA: {s.landfallEta}
              </div>
            )}
          </button>
        );
      })}

      {outsidePar && <OutsideParCard advisory={outsidePar} />}

      {!outsidePar &&
        outsideParGdacs.map((s) => (
          <MonitorCard
            key={s.id}
            name={s.name}
            windKph={s.windKph}
            position={`${s.position[1].toFixed(1)}°N, ${s.position[0].toFixed(1)}°E`}
            movement={s.heading ?? "—"}
            gusts="—"
          />
        ))}

      <FreshnessTag source="typhoons" />

      {warning && !error && (
        <div className="text-[11px] text-aeris-warn">
          Advisory source degraded: {warning}
        </div>
      )}

      {error && (
        <div className="text-[11px] text-aeris-danger">
          Source unreachable: {error}
        </div>
      )}
    </div>
  );
}

function OutsideParCard({ advisory }: { advisory: OutsideParAdvisory }) {
  const name = formatPagasaStormName(advisory.name);
  const position = advisory.position
    ? `${advisory.position[1].toFixed(1)}°N, ${advisory.position[0].toFixed(1)}°E`
    : "n/a";

  return (
    <MonitorCard
      name={name}
      windKph={advisory.windKph ?? 0}
      gusts={formatPagasaQuantity(advisory.gustinessKmh)}
      movement={formatPagasaMovement(advisory.movement)}
      position={position}
      subtitle={formatPagasaLocationLine(advisory.location)}
      issuedAt={advisory.issuedAt}
    />
  );
}

function MonitorCard({
  name,
  windKph,
  gusts,
  movement,
  position,
  subtitle,
  issuedAt,
}: {
  name: string;
  windKph: number;
  gusts: string;
  movement: string;
  position: string;
  subtitle?: string;
  issuedAt?: string | null;
}) {
  const threat = threatFromWind(windKph);
  return (
    <div className="w-full text-left p-2.5 rounded-lg border border-aeris-border bg-aeris-bg/40 space-y-2">
      <StormHero
        name={name}
        windKph={windKph}
        threat={threat}
        statusLabel="Outside PAR"
        statusTone="warn"
      />
      <div className="grid grid-cols-2 gap-1 text-[11px] text-aeris-muted">
        <Metric label="Gusts" value={gusts} />
        <Metric label="Movement" value={movement} />
        <Metric label="Position" value={position} />
        <Metric label="Category" value={threat.label} />
      </div>
      {subtitle && (
        <div className="text-[11px] text-aeris-muted leading-snug">{subtitle}</div>
      )}
      {issuedAt && (
        <div className="text-[10px] text-aeris-muted/80">PAGASA · {issuedAt}</div>
      )}
    </div>
  );
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
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-mono text-base font-semibold text-aeris-warn truncate">
            {name}
          </div>
          {subName && (
            <div className="font-mono text-[10px] uppercase tracking-wider text-aeris-muted truncate">
              {subName}
            </div>
          )}
        </div>
        {status && <Pill tone={tone}>{status}</Pill>}
      </div>

      <div className="flex items-end justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[9px] uppercase tracking-wider text-aeris-muted">
            Sustained wind
          </div>
          <div className="font-mono leading-none">
            <span className="text-xl font-semibold text-aeris-text">
              {windKph > 0 ? windKph : "—"}
            </span>
            <span className="text-[11px] text-aeris-muted ml-1">km/h</span>
          </div>
        </div>
        <Pill tone={threat.tone} className="shrink-0">
          {threat.label} threat
        </Pill>
      </div>

      <div
        className="h-1 w-full rounded-full bg-aeris-border/60 overflow-hidden"
        role="meter"
        aria-label={`Threat level: ${threat.label}`}
        aria-valuenow={threat.barPct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={`h-full ${barColor} transition-all`}
          style={{ width: `${threat.barPct}%` }}
        />
      </div>
      <div className="text-[10px] text-aeris-muted leading-snug">
        {threat.description}
      </div>
    </div>
  );
}

function formatPagasaStormName(raw: string): string {
  return decodePagasaText(raw)
    .replace(/^TROPICAL\s+(?:STORM|DEPRESSION|CYCLONE|TYPHOON)\s+/i, "")
    .trim();
}

/** Drop trailing coordinate parenthetical; coords live in the Position field. */
function formatPagasaLocationLine(raw: string): string {
  return decodePagasaText(raw)
    .replace(/^LOCATION:\s*/i, "")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim();
}

function formatPagasaQuantity(raw: string | undefined): string {
  if (!raw) return "n/a";
  const n = raw.match(/(\d+)\s*km\/h/i);
  if (!n) return decodePagasaText(raw).toLowerCase();
  return /up\s+to/i.test(raw) ? `up to ${n[1]} km/h` : `${n[1]} km/h`;
}

function formatPagasaMovement(raw: string | undefined): string {
  if (!raw) return "n/a";
  const t = decodePagasaText(raw).replace(/^MOVEMENT:\s*/i, "");
  const at = t.match(/([A-Z]+(?:WARD)?)\s+AT\s+(\d+)\s*KM\/H/i);
  if (at) return `${at[1].toLowerCase()} at ${at[2]} km/h`;
  return t.toLowerCase();
}

function decodePagasaText(raw: string): string {
  return raw.replace(/&deg;/gi, "°").replace(/&amp;/g, "&").trim();
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wider">{label}</div>
      <div className="text-aeris-text font-mono">{value}</div>
    </div>
  );
}

function categoryTone(c: string) {
  if (/Super|5|4/.test(c)) return "danger" as const;
  if (/Typhoon|3/.test(c)) return "warn" as const;
  return "accent" as const;
}
