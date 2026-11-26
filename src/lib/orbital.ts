import * as satellite from "satellite.js";
import type {
  SatelliteLiveState,
  SatellitePassPrediction,
  SatelliteTLE,
} from "@/types/telemetry";
import { EARTH_RADIUS_KM } from "./geo";

const RAD2DEG = 180 / Math.PI;
const DEG2RAD = Math.PI / 180;

export function propagateSatellite(
  tle: SatelliteTLE,
  date: Date = new Date(),
  includeOrbitPath = true
): SatelliteLiveState | null {
  try {
    const satrec = satellite.twoline2satrec(tle.tle1, tle.tle2);
    const posVel = satellite.propagate(satrec, date);
    if (
      !posVel ||
      !posVel.position ||
      typeof posVel.position === "boolean" ||
      !posVel.velocity ||
      typeof posVel.velocity === "boolean"
    ) {
      return null;
    }

    const gmst = satellite.gstime(date);
    const geo = satellite.eciToGeodetic(posVel.position, gmst);
    const lat = geo.latitude * RAD2DEG;
    const lon = geo.longitude * RAD2DEG;
    const altitudeKm = Math.max(120, geo.height);

    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(altitudeKm)) {
      return null;
    }

    const vx = posVel.velocity.x;
    const vy = posVel.velocity.y;
    const vz = posVel.velocity.z;
    const velocityKmS = Math.hypot(vx, vy, vz);

    // Horizon ground footprint radius in km
    const horizonAngle = Math.acos(EARTH_RADIUS_KM / (EARTH_RADIUS_KM + altitudeKm));
    const footprintKm = EARTH_RADIUS_KM * horizonAngle;

    const orbitPath: Array<{ lat: number; lon: number; altitudeKm: number }> = [];
    if (includeOrbitPath) {
      // Estimate orbital period from mean motion (revs/day in TLE line 2 cols 52-63)
      const meanMotion = parseFloat(tle.tle2.slice(52, 63)) || 15;
      const periodMin = Math.min(240, Math.max(85, 1440 / meanMotion));
      const steps = 72;
      for (let i = -8; i <= steps; i++) {
        const sampleDate = new Date(date.getTime() + (i / steps) * periodMin * 60 * 1000);
        const pv = satellite.propagate(satrec, sampleDate);
        if (!pv || !pv.position || typeof pv.position === "boolean") continue;
        const g = satellite.eciToGeodetic(pv.position, satellite.gstime(sampleDate));
        const pLat = g.latitude * RAD2DEG;
        const pLon = g.longitude * RAD2DEG;
        if (Number.isFinite(pLat) && Number.isFinite(pLon)) {
          orbitPath.push({
            lat: pLat,
            lon: pLon,
            altitudeKm: Math.max(120, g.height),
          });
        }
      }
    }

    return {
      ...tle,
      lat,
      lon,
      altitudeKm,
      velocityKmS,
      footprintKm,
      orbitPath,
    };
  } catch {
    return null;
  }
}

/**
 * Predicts the next overhead pass within 24 hours for selected spacecraft
 * (e.g. ISS, CSS Tiangong) above a chosen ground observer coordinate.
 */
export function predictNextPasses(
  tles: SatelliteTLE[],
  observerLat: number,
  observerLon: number,
  fromDate: Date = new Date()
): SatellitePassPrediction[] {
  const observerGd = {
    longitude: observerLon * DEG2RAD,
    latitude: observerLat * DEG2RAD,
    height: 0.05,
  };

  const results: SatellitePassPrediction[] = [];
  const targetSats = tles.filter(
    (s) => s.id === "css" || s.id === "iss" || s.id === "hst"
  );

  for (const tle of targetSats) {
    try {
      const satrec = satellite.twoline2satrec(tle.tle1, tle.tle2);
      const startMs = fromDate.getTime();
      const horizonHours = 24;
      const stepSec = 45;
      const totalSteps = Math.floor((horizonHours * 3600) / stepSec);

      let inPass = false;
      let riseMs = 0;
      let peakMs = 0;
      let maxElev = 0;

      for (let i = 0; i <= totalSteps; i++) {
        const tMs = startMs + i * stepSec * 1000;
        const d = new Date(tMs);
        const pv = satellite.propagate(satrec, d);
        if (!pv || !pv.position || typeof pv.position === "boolean") continue;
        const gmst = satellite.gstime(d);
        const ecf = satellite.eciToEcf(pv.position, gmst);
        const look = satellite.ecfToLookAngles(observerGd, ecf);
        const elevDeg = look.elevation * RAD2DEG;

        if (elevDeg >= 10) {
          if (!inPass) {
            inPass = true;
            riseMs = tMs;
            maxElev = elevDeg;
            peakMs = tMs;
          } else if (elevDeg > maxElev) {
            maxElev = elevDeg;
            peakMs = tMs;
          }
        } else if (inPass) {
          if (maxElev >= 14) {
            results.push({
              satId: tle.id,
              satName: tle.name,
              satNameZh: tle.nameZh,
              riseTimeMs: riseMs,
              peakTimeMs: peakMs,
              durationSec: Math.max(60, Math.round((tMs - riseMs) / 1000)),
              maxElevationDeg: Math.round(maxElev),
            });
            break;
          }
          inPass = false;
          maxElev = 0;
        }
      }
    } catch {
      // ignore invalid TLE
    }
  }

  return results.sort((a, b) => a.riseTimeMs - b.riseTimeMs);
}
