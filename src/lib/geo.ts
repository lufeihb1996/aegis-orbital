const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
export const EARTH_RADIUS_KM = 6371;

export function latLonToVector3Tuple(
  lat: number,
  lon: number,
  radius: number
): [number, number, number] {
  const phi = (90 - lat) * DEG2RAD;
  const theta = (lon + 180) * DEG2RAD;
  const x = -radius * Math.sin(phi) * Math.cos(theta);
  const y = radius * Math.cos(phi);
  const z = radius * Math.sin(phi) * Math.sin(theta);
  return [x, y, z];
}

export function vector3ToLatLon(
  x: number,
  y: number,
  z: number
): { lat: number; lon: number } {
  const r = Math.hypot(x, y, z);
  if (r === 0) return { lat: 0, lon: 0 };
  const lat = Math.asin(Math.max(-1, Math.min(1, y / r))) * RAD2DEG;
  const theta = Math.atan2(z, -x);
  let lon = theta * RAD2DEG - 180;
  if (lon < -180) lon += 360;
  if (lon > 180) lon -= 360;
  return { lat, lon };
}

/**
 * Computes exact real-time subsolar point (lat/lon where Sun is directly overhead)
 * using Julian date solar declination + equation of time.
 */
export function getSubsolarPoint(date: Date = new Date()): {
  lat: number;
  lon: number;
} {
  const julianDay = date.getTime() / 86400000 + 2440587.5;
  const n = julianDay - 2451545.0; // days since J2000.0
  const L = (280.46 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * DEG2RAD;
  const lambda =
    (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * DEG2RAD;
  const epsilon = (23.439 - 0.0000004 * n) * DEG2RAD;

  // Solar declination
  const decl = Math.asin(Math.sin(epsilon) * Math.sin(lambda)) * RAD2DEG;

  // Equation of time approximation (minutes)
  const B = ((2 * Math.PI) / 365) * (getDayOfYear(date) - 81);
  const eqTimeMin =
    9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);

  const utcMinutes =
    date.getUTCHours() * 60 +
    date.getUTCMinutes() +
    date.getUTCSeconds() / 60;
  let subsolarLon = ((720 - utcMinutes - eqTimeMin) / 4) % 360;
  if (subsolarLon > 180) subsolarLon -= 360;
  if (subsolarLon < -180) subsolarLon += 360;

  return { lat: decl, lon: subsolarLon };
}

function getDayOfYear(date: Date): number {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const diff = date.getTime() - start;
  return Math.floor(diff / 86400000);
}

export function haversineDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const dLat = (lat2 - lat1) * DEG2RAD;
  const dLon = (lon2 - lon1) * DEG2RAD;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * DEG2RAD) *
      Math.cos(lat2 * DEG2RAD) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

export function initialBearingDeg(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const p1 = lat1 * DEG2RAD;
  const p2 = lat2 * DEG2RAD;
  const dl = (lon2 - lon1) * DEG2RAD;
  const y = Math.sin(dl) * Math.cos(p2);
  const x =
    Math.cos(p1) * Math.sin(p2) -
    Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return ((Math.atan2(y, x) * RAD2DEG) + 360) % 360;
}

/**
 * Computes approximate astronomical sublunar point (lat/lon) for real-time 3D Moon placement & lunar phase.
 */
export function getSublunarPoint(date: Date = new Date()): {
  lat: number;
  lon: number;
  phaseFraction: number;
} {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const d = jd - 2451545.0;

  // Mean lunar ecliptic longitude & anomaly
  const L = (218.316 + 13.176396 * d) % 360;
  const M = ((134.963 + 13.064993 * d) % 360) * DEG2RAD;
  const F = ((93.272 + 13.22935 * d) % 360) * DEG2RAD;

  const eclLon = (L + 6.289 * Math.sin(M)) * DEG2RAD;
  const eclLat = 5.128 * Math.sin(F) * DEG2RAD;
  const eps = 23.439 * DEG2RAD;

  // Convert ecliptic -> equatorial RA / Dec
  const sinDec =
    Math.sin(eclLat) * Math.cos(eps) +
    Math.cos(eclLat) * Math.sin(eps) * Math.sin(eclLon);
  const dec = Math.asin(Math.max(-1, Math.min(1, sinDec))) * RAD2DEG;

  const ra =
    Math.atan2(
      Math.sin(eclLon) * Math.cos(eps) - Math.tan(eclLat) * Math.sin(eps),
      Math.cos(eclLon)
    ) * RAD2DEG;

  // Greenwich Mean Sidereal Time (deg)
  const gmst = (280.46061837 + 360.98564736629 * d) % 360;
  let sublunarLon = (ra - gmst) % 360;
  if (sublunarLon > 180) sublunarLon -= 360;
  if (sublunarLon < -180) sublunarLon += 360;

  // Synodic lunar phase (0 = New, 0.5 = Full)
  const synodicPeriod = 29.53058867;
  const knownNewMoonJd = 2451550.1;
  const phaseFraction =
    (((jd - knownNewMoonJd) % synodicPeriod) + synodicPeriod) % synodicPeriod /
    synodicPeriod;

  return { lat: dec, lon: sublunarLon, phaseFraction };
}

export function formatCoord(lat: number, lon: number): string {
  const latStr = `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? "N" : "S"}`;
  const lonStr = `${Math.abs(lon).toFixed(2)}°${lon >= 0 ? "E" : "W"}`;
  return `${latStr} · ${lonStr}`;
}

export function formatRelativeTime(timestampMs: number, locale: "zh" | "en"): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - timestampMs) / 1000));
  if (diffSec < 60) {
    return locale === "zh" ? `${diffSec} 秒前` : `${diffSec}s ago`;
  }
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) {
    return locale === "zh" ? `${diffMin} 分钟前` : `${diffMin}m ago`;
  }
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) {
    return locale === "zh" ? `${diffHr} 小时前` : `${diffHr}h ago`;
  }
  const diffDays = Math.floor(diffHr / 24);
  return locale === "zh" ? `${diffDays} 天前` : `${diffDays}d ago`;
}

export function weatherCodeLabel(code: number, locale: "zh" | "en"): string {
  const zh: Record<number, string> = {
    0: "晴朗",
    1: "大部晴朗",
    2: "局部多云",
    3: "阴天",
    45: "雾",
    48: "冻雾",
    51: "毛毛雨",
    53: "中度毛毛雨",
    55: "强毛毛雨",
    61: "小雨",
    63: "中雨",
    65: "大雨",
    71: "小雪",
    73: "中雪",
    75: "大雪",
    80: "阵雨",
    81: "中阵雨",
    82: "强阵雨",
    95: "雷暴",
    96: "雷暴伴冰雹",
    99: "强雷暴伴冰雹",
  };
  const en: Record<number, string> = {
    0: "Clear Sky",
    1: "Mostly Clear",
    2: "Partly Cloudy",
    3: "Overcast",
    45: "Fog",
    48: "Rime Fog",
    51: "Light Drizzle",
    53: "Drizzle",
    55: "Dense Drizzle",
    61: "Light Rain",
    63: "Moderate Rain",
    65: "Heavy Rain",
    71: "Light Snow",
    73: "Snow",
    75: "Heavy Snow",
    80: "Rain Showers",
    81: "Heavy Showers",
    82: "Violent Showers",
    95: "Thunderstorm",
    96: "Storm + Hail",
    99: "Severe Storm",
  };
  const dict = locale === "zh" ? zh : en;
  if (dict[code]) return dict[code];
  if (code >= 50 && code < 70) return locale === "zh" ? "降水" : "Precipitation";
  if (code >= 70 && code < 80) return locale === "zh" ? "降雪" : "Snow";
  if (code >= 95) return locale === "zh" ? "雷暴" : "Thunderstorm";
  return locale === "zh" ? "多云" : "Cloudy";
}
