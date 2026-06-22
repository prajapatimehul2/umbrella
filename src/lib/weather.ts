// Thin wrapper around the free, key-less Open-Meteo API.
// Docs: https://open-meteo.com/en/docs

export type GeoResult = { name: string; latitude: number; longitude: number; country?: string };

export type Verdict = {
  umbrella: boolean;
  maxChance: number; // highest precipitation probability (%) over the window
  totalRain: number; // total precipitation (mm) over the window
  summary: string;
  hours: { time: string; chance: number; rain: number; temp: number }[];
};

const RAIN_CHANCE_THRESHOLD = 40; // % chance at which we say "bring it"
const RAIN_AMOUNT_THRESHOLD = 0.3; // mm of actual rain that also triggers it

export async function geocode(name: string): Promise<GeoResult | null> {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", name);
  url.searchParams.set("count", "1");
  url.searchParams.set("language", "en");
  url.searchParams.set("format", "json");

  const res = await fetch(url, { next: { revalidate: 0 } });
  if (!res.ok) throw new Error(`Geocoding failed (${res.status})`);
  const data = (await res.json()) as { results?: GeoResult[] };
  const hit = data.results?.[0];
  if (!hit) return null;
  return { name: hit.name, latitude: hit.latitude, longitude: hit.longitude, country: hit.country };
}

export async function getVerdict(latitude: number, longitude: number): Promise<Verdict> {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(latitude));
  url.searchParams.set("longitude", String(longitude));
  url.searchParams.set("hourly", "precipitation_probability,precipitation,temperature_2m");
  url.searchParams.set("forecast_days", "1");
  url.searchParams.set("timezone", "auto");

  const res = await fetch(url, { next: { revalidate: 600 } }); // cache 10 min
  if (!res.ok) throw new Error(`Forecast failed (${res.status})`);
  const data = (await res.json()) as {
    hourly?: {
      time: string[];
      precipitation_probability: number[];
      precipitation: number[];
      temperature_2m: number[];
    };
  };

  const h = data.hourly;
  if (!h) throw new Error("No forecast data returned");

  // Only look at the rest of today (from the current hour onward).
  const nowHour = new Date().getHours();
  const hours = h.time
    .map((time, i) => ({
      time,
      chance: h.precipitation_probability[i] ?? 0,
      rain: h.precipitation[i] ?? 0,
      temp: h.temperature_2m[i] ?? 0,
    }))
    .filter((row) => new Date(row.time).getHours() >= nowHour);

  const window = hours.length ? hours : h.time.map((time, i) => ({
    time,
    chance: h.precipitation_probability[i] ?? 0,
    rain: h.precipitation[i] ?? 0,
    temp: h.temperature_2m[i] ?? 0,
  }));

  const maxChance = Math.max(0, ...window.map((r) => r.chance));
  const totalRain = Number(window.reduce((s, r) => s + r.rain, 0).toFixed(2));
  const umbrella = maxChance >= RAIN_CHANCE_THRESHOLD || totalRain >= RAIN_AMOUNT_THRESHOLD;

  const summary = umbrella
    ? `Up to ${maxChance}% chance of rain today — take an umbrella.`
    : `Only ${maxChance}% chance of rain today — you're fine.`;

  return { umbrella, maxChance, totalRain, summary, hours: window };
}
