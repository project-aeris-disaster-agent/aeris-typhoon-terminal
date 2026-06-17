import type { ForecastDay, ForecastSummary } from "@/lib/forecast-alert";

export type WeatherEmojiItem = {
  emoji: string;
  /** 1 = light, 2 = moderate, 3 = severe */
  intensity: 1 | 2 | 3;
  label: string;
};

function rainItem(peakMm: number): WeatherEmojiItem | null {
  if (peakMm < 0.1) return null;
  if (peakMm >= 40) {
    return { emoji: "⛈️", intensity: 3, label: `Heavy storms · ${peakMm.toFixed(1)} mm peak` };
  }
  if (peakMm >= 20) {
    return { emoji: "🌧️", intensity: 3, label: `Heavy rain · ${peakMm.toFixed(1)} mm peak` };
  }
  if (peakMm >= 10) {
    return { emoji: "🌧️", intensity: 2, label: `Moderate rain · ${peakMm.toFixed(1)} mm peak` };
  }
  if (peakMm >= 5) {
    return { emoji: "🌦️", intensity: 2, label: `Rain showers · ${peakMm.toFixed(1)} mm peak` };
  }
  return { emoji: "🌦️", intensity: 1, label: `Light rain · ${peakMm.toFixed(1)} mm peak` };
}

function heatItem(maxTemp: number): WeatherEmojiItem | null {
  if (maxTemp < 30) return null;
  if (maxTemp >= 37) {
    return { emoji: "🔥", intensity: 3, label: `Extreme heat · ${maxTemp}°C max` };
  }
  if (maxTemp >= 35) {
    return { emoji: "🌡️", intensity: 3, label: `Very hot · ${maxTemp}°C max` };
  }
  if (maxTemp >= 33) {
    return { emoji: "☀️", intensity: 2, label: `Hot · ${maxTemp}°C max` };
  }
  return { emoji: "🌤️", intensity: 1, label: `Warm · ${maxTemp}°C max` };
}

function windItem(maxKph: number): WeatherEmojiItem | null {
  if (maxKph < 22) return null;
  if (maxKph >= 60) {
    return { emoji: "🌀", intensity: 3, label: `Gale-force wind · ${maxKph} km/h max` };
  }
  if (maxKph >= 45) {
    return { emoji: "💨", intensity: 3, label: `Strong wind · ${maxKph} km/h max` };
  }
  if (maxKph >= 30) {
    return { emoji: "🌬️", intensity: 2, label: `Windy · ${maxKph} km/h max` };
  }
  return { emoji: "💨", intensity: 1, label: `Breezy · ${maxKph} km/h max` };
}

/** Up to three dominant hazard emojis for a 7-day regional outlook. */
export function forecastWeatherEmojis(summary: ForecastSummary): WeatherEmojiItem[] {
  const peakRain = Math.max(...summary.daily.map((d) => d.rainMm), 0);
  const maxTemp = Math.max(...summary.daily.map((d) => d.tempMax), 0);

  const items = [
    rainItem(peakRain),
    heatItem(maxTemp),
    windItem(summary.maxWindKph),
  ].filter((x): x is WeatherEmojiItem => x !== null);

  return items
    .sort((a, b) => b.intensity - a.intensity)
    .slice(0, 3);
}

/** Single emoji for one forecast day (most notable hazard). */
export function dayWeatherEmoji(d: ForecastDay): WeatherEmojiItem {
  const rain = rainItem(d.rainMm);
  const heat = heatItem(d.tempMax);
  const wind = windItem(d.windKph);

  const candidates = [rain, heat, wind].filter(
    (x): x is WeatherEmojiItem => x !== null,
  );

  if (candidates.length === 0) {
    return { emoji: "🌤️", intensity: 1, label: "Fair weather" };
  }

  return candidates.sort((a, b) => b.intensity - a.intensity)[0];
}
