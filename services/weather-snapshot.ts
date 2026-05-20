import { PH_CENTER, PH_REGIONS } from "@/config/region";
import { buildAlertsFromGdacsRss, type GdacsAlert } from "@/lib/gdacs-alerts";
import {
  computeForecastAlert,
  type ForecastAlert,
  type ForecastSummary,
} from "@/lib/forecast-alert";
import { fetchOpenMeteoForecast } from "@/lib/open-meteo-server";
import {
  elevatedWaterStations,
  fetchPagasaWaterLevels,
  type WaterLevelStation,
} from "@/lib/pagasa-water-levels";
import {
  alertSignature,
  computeNationalSeverityScore,
  computeNationalVerdict,
  summarizeForecastForBrief,
  worstAlertSeverity,
  type NationalVerdict,
} from "@/lib/weather-risk";

export type RegionalForecastSlice = {
  code: string;
  name: string;
  forecast: ForecastSummary;
  alert: ForecastAlert;
};

export type NationalWeatherSnapshot = {
  generatedAt: string;
  scope: { type: "national"; key: "PH" };
  alerts: GdacsAlert[];
  alertSignature: string;
  typhoonAlerts: GdacsAlert[];
  nationalForecast: ForecastSummary;
  nationalForecastAlert: ForecastAlert;
  regionalForecasts: RegionalForecastSlice[];
  worstRegionalAlert: ForecastAlert;
  waterLevels: {
    updatedAt: string | null;
    elevated: WaterLevelStation[];
    stationCount: number;
  };
  verdict: NationalVerdict;
  severityScore: number;
  sourcesFreshness: {
    gdacs: string | null;
    openMeteo: string;
    waterLevels: string | null;
  };
  briefFacts: string[];
};

export async function buildNationalWeatherSnapshot(): Promise<NationalWeatherSnapshot> {
  const generatedAt = new Date().toISOString();

  const [alerts, nationalForecast, waterPayload, regionalSettled] =
    await Promise.all([
      buildAlertsFromGdacsRss(),
      fetchOpenMeteoForecast(PH_CENTER),
      fetchPagasaWaterLevels().catch(() => ({
        updatedAt: null,
        stations: [] as WaterLevelStation[],
      })),
      Promise.all(
        PH_REGIONS.map(async (region) => {
          const forecast = await fetchOpenMeteoForecast(region.center).catch(
            () => null,
          );
          if (!forecast) return null;
          return {
            code: region.code,
            name: region.name,
            forecast,
            alert: computeForecastAlert(forecast),
          } satisfies RegionalForecastSlice;
        }),
      ),
    ]);

  const regionalResults = regionalSettled.filter(
    (slice): slice is RegionalForecastSlice => slice !== null,
  );

  const typhoonAlerts = alerts.filter((a) => a.id.startsWith("tc-"));
  const nationalForecastAlert = computeForecastAlert(nationalForecast);
  const elevated = elevatedWaterStations(waterPayload.stations);

  const worstRegionalAlert = regionalResults.reduce(
    (best, slice) => (slice.alert.score > best.score ? slice.alert : best),
    regionalResults[0]?.alert ?? nationalForecastAlert,
  );

  const verdict = computeNationalVerdict({
    forecastAlert:
      worstRegionalAlert.score >= nationalForecastAlert.score
        ? worstRegionalAlert
        : nationalForecastAlert,
    worstAlertSeverity: worstAlertSeverity(alerts),
    elevatedWaterCount: elevated.length,
    typhoonCount: typhoonAlerts.length,
  });

  const severityScore = computeNationalSeverityScore({
    forecastAlert:
      worstRegionalAlert.score > nationalForecastAlert.score
        ? worstRegionalAlert
        : nationalForecastAlert,
    alerts,
    elevatedWaterCount: elevated.length,
    typhoonCount: typhoonAlerts.length,
  });

  const signature = alertSignature(alerts);
  const latestAlertIssued = alerts.find((a) => a.issuedAt)?.issuedAt ?? null;

  const briefFacts: string[] = [
    summarizeForecastForBrief(nationalForecast, nationalForecastAlert),
    `Highest regional risk: ${worstRegionalAlert.label} (${worstRegionalAlert.score} score)`,
  ];

  if (typhoonAlerts.length > 0) {
    briefFacts.push(
      typhoonAlerts
        .slice(0, 3)
        .map((t) => `${t.title}: ${t.summary}`)
        .join(" · "),
    );
  } else {
    briefFacts.push("No active tropical cyclones in PAR.");
  }

  if (elevated.length > 0) {
    briefFacts.push(
      elevated
        .slice(0, 4)
        .map(
          (s) =>
            `${s.name} at ${s.level}${s.current !== null ? ` (${s.current.toFixed(2)} m)` : ""}`,
        )
        .join("; "),
    );
  }

  const hazardCount = alerts.filter((a) => !a.id.startsWith("tc-")).length;
  if (hazardCount > 0) {
    briefFacts.push(`${hazardCount} active PH-relevant hazard bulletin(s) from GDACS.`);
  }

  return {
    generatedAt,
    scope: { type: "national", key: "PH" },
    alerts,
    alertSignature: signature,
    typhoonAlerts,
    nationalForecast,
    nationalForecastAlert,
    regionalForecasts: regionalResults,
    worstRegionalAlert,
    waterLevels: {
      updatedAt: waterPayload.updatedAt,
      elevated,
      stationCount: waterPayload.stations.length,
    },
    verdict,
    severityScore,
    sourcesFreshness: {
      gdacs: latestAlertIssued,
      openMeteo: generatedAt,
      waterLevels: waterPayload.updatedAt,
    },
    briefFacts,
  };
}
