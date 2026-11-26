import * as satellite from "satellite.js";
import type { SatelliteLiveState, SatelliteTLE } from "@/types/telemetry";
import { EARTH_RADIUS_KM } from "./geo";

const RAD2DEG = 180 / Math.PI;

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
