import { PAR_BBOX } from "@/config/region";

export type GdacsSeverityData = {
  severity?: number;
  severitytext?: string;
  severityunit?: string;
};

/** Active TC position inside the PAGASA PAR bounding box (same rule as alerts). */
export function isInParBbox(lng: number, lat: number): boolean {
  const [minLng, minLat, maxLng, maxLat] = PAR_BBOX;
  return lng >= minLng && lng <= maxLng && lat >= minLat && lat <= maxLat;
}

/** Prefer human-readable wind from GDACS text, e.g. "(maximum wind speed of 167 km/h)". */
export function parseWindKphFromSeverityText(text: string): number | null {
  const m = text.match(/(\d+(?:\.\d+)?)\s*km\/h/i);
  if (!m) return null;
  const n = Math.round(Number(m[1]));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function readGdacsSeverityData(
  props: Record<string, unknown>,
): GdacsSeverityData | null {
  const raw = props["severitydata"];
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as GdacsSeverityData;
  }
  return null;
}

export function windKphFromGdacsProps(props: Record<string, unknown>): number {
  const sd = readGdacsSeverityData(props);

  const fromText = sd?.severitytext
    ? parseWindKphFromSeverityText(sd.severitytext)
    : null;
  if (fromText) return fromText;

  if (typeof sd?.severity === "number" && Number.isFinite(sd.severity)) {
    const n = Math.round(sd.severity);
    if (n > 0) return n;
  }

  const legacy = Number(props["wind_speed"]);
  if (Number.isFinite(legacy) && legacy > 0) return Math.round(legacy);

  return 0;
}

export function categoryLabelFromSeverityText(severityText: string): string | null {
  const label = severityText
    .replace(/\s*\(maximum wind speed of.*$/i, "")
    .trim();
  return label.length > 0 ? label : null;
}

export function deriveTcCategory(
  alertLevel: string | undefined,
  severityText: string,
  windKph: number,
): string {
  const fromText = severityText
    ? categoryLabelFromSeverityText(severityText)
    : null;
  if (fromText) return fromText;

  if (/super|Cat[\s-]?5/i.test(severityText) || windKph >= 252) return "Super Typhoon";
  if (windKph >= 185) return "Typhoon";
  if (windKph >= 118) return "Severe Tropical Storm";
  if (windKph >= 89) return "Tropical Storm";
  if (windKph >= 62) return "Tropical Depression";
  return alertLevel ? `${alertLevel} alert` : "Tropical cyclone";
}

export function categoryFromGdacsProps(
  props: Record<string, unknown>,
  windKph: number,
): string {
  const sd = readGdacsSeverityData(props);
  const severityText = sd?.severitytext ?? "";
  const alertLevel =
    typeof props["alertlevel"] === "string" ? props["alertlevel"] : undefined;

  if (typeof props["severity"] === "string" && props["severity"].length > 0) {
    const legacy = String(props["severity"]);
    if (!severityText) return legacy;
  }

  return deriveTcCategory(alertLevel, severityText, windKph);
}

export function pressureHpaFromGdacsProps(props: Record<string, unknown>): number {
  const p = Number(props["pressure"]);
  if (Number.isFinite(p) && p > 0) return Math.round(p);
  return 0;
}

export function windKphFromRssSeverity(
  valueAttr: string | undefined,
  severityText: string,
): number {
  const fromText = parseWindKphFromSeverityText(severityText);
  if (fromText) return fromText;
  if (valueAttr) {
    const n = Math.round(Number(valueAttr));
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}
