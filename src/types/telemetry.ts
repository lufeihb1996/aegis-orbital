export type ThemeId = "cyan" | "phosphor" | "amber";
export type Locale = "zh" | "en";

export type LayerKey =
  | "quakes"
  | "satellites"
  | "events"
  | "cables"
  | "hubs"
  | "terminator"
  | "clouds"
  | "borders";

export type LayerVisibility = Record<LayerKey, boolean>;

export interface QuakeEvent {
  id: string;
  magnitude: number;
  place: string;
  time: number; // unix ms
  lat: number;
  lon: number;
  depthKm: number;
  tsunami: boolean;
  alert: string | null;
  url: string;
}

export interface SatelliteTLE {
  id: string;
  noradId: number;
  name: string;
  nameZh: string;
  category: "station" | "science" | "weather" | "comms" | "navigation";
  country: string;
  tle1: string;
  tle2: string;
  description: string;
  descriptionZh: string;
}

export interface SatelliteLiveState extends SatelliteTLE {
  lat: number;
  lon: number;
  altitudeKm: number;
  velocityKmS: number;
  footprintKm: number;
  orbitPath: Array<{ lat: number; lon: number; altitudeKm: number }>;
}

export interface NaturalEvent {
  id: string;
  title: string;
  category: "wildfires" | "volcanoes" | "severeStorms" | "seaLakeIce" | "other";
  categoryLabel: string;
  lat: number;
  lon: number;
  date: string;
  magnitudeValue?: number | null;
  magnitudeUnit?: string | null;
  url: string;
}

export interface SpaceWeatherData {
  kpIndex: number;
  kpStatus: "quiet" | "unsettled" | "storm" | "severe";
  solarWindSpeedKmS: number;
  solarWindDensity: number;
  btNt: number;
  bzNt: number;
  kpHistory: Array<{ time: string; kp: number }>;
  updatedAt: string;
  source: "live" | "fallback";
}

export interface MarketTicker {
  symbol: string;
  name: string;
  price: number;
  change24h: number;
  high24h?: number;
  low24h?: number;
  sparkline: number[];
}

export interface TechIntelItem {
  id: number;
  title: string;
  url: string;
  score: number;
  comments: number;
  by: string;
  time: number;
  domain: string;
}

export interface IntelFeedData {
  markets: MarketTicker[];
  news: TechIntelItem[];
  updatedAt: string;
  source: "live" | "partial" | "fallback";
}

export interface CoordinateWeather {
  lat: number;
  lon: number;
  temperatureC: number;
  apparentTempC: number;
  windSpeedKmh: number;
  windDirectionDeg: number;
  humidityPct: number;
  pressureHpa: number;
  cloudCoverPct: number;
  weatherCode: number;
  isDay: boolean;
  timezone: string;
  elevationM: number;
  updatedAt: string;
}

export interface WorldHub {
  id: string;
  name: string;
  nameZh: string;
  country: string;
  countryZh: string;
  lat: number;
  lon: number;
  timezone: string;
  role: string;
  roleZh: string;
  tier: 1 | 2;
}

export interface SubmarineCable {
  id: string;
  name: string;
  nameZh: string;
  fromHub: string;
  toHub: string;
  from: [number, number]; // [lat, lon]
  to: [number, number];
  capacityTbps: number;
  lengthKm: number;
}

export type SelectedTarget =
  | { kind: "quake"; data: QuakeEvent }
  | { kind: "satellite"; id: string }
  | { kind: "event"; data: NaturalEvent }
  | { kind: "hub"; data: WorldHub }
  | { kind: "probe"; lat: number; lon: number; label?: string };

export interface CameraTarget {
  lat: number;
  lon: number;
  distance?: number;
  instant?: boolean;
  nonce: number;
}
