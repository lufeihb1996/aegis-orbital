import { NextResponse } from "next/server";
import type { FlightTrack } from "@/types/telemetry";

// Curated global major international aviation corridors for deterministic fallback
const CORRIDORS: Array<{
  prefix: string;
  country: string;
  from: [number, number];
  to: [number, number];
  altM: number;
  speedMs: number;
}> = [
  { prefix: "CCA", country: "China", from: [40.08, 116.58], to: [35.55, 139.78], altM: 10970, speedMs: 242 },
  { prefix: "CES", country: "China", from: [31.14, 121.81], to: [1.36, 103.99], altM: 11280, speedMs: 248 },
  { prefix: "CSN", country: "China", from: [23.39, 113.30], to: [-33.94, 151.18], altM: 11580, speedMs: 251 },
  { prefix: "CPA", country: "Hong Kong", from: [22.31, 113.91], to: [51.47, -0.45], altM: 10670, speedMs: 246 },
  { prefix: "ANA", country: "Japan", from: [35.76, 140.39], to: [37.62, -122.38], altM: 11280, speedMs: 258 },
  { prefix: "JAL", country: "Japan", from: [35.55, 139.78], to: [49.01, 2.55], altM: 11580, speedMs: 244 },
  { prefix: "KAL", country: "South Korea", from: [37.46, 126.44], to: [33.94, -118.41], altM: 10970, speedMs: 252 },
  { prefix: "SIA", country: "Singapore", from: [1.36, 103.99], to: [50.03, 8.57], altM: 11580, speedMs: 249 },
  { prefix: "UAE", country: "United Arab Emirates", from: [25.25, 55.36], to: [40.64, -73.78], altM: 11890, speedMs: 254 },
  { prefix: "UAE", country: "United Arab Emirates", from: [25.25, 55.36], to: [35.55, 139.78], altM: 11280, speedMs: 250 },
  { prefix: "QTR", country: "Qatar", from: [25.27, 51.61], to: [51.47, -0.45], altM: 11580, speedMs: 245 },
  { prefix: "BAW", country: "United Kingdom", from: [51.47, -0.45], to: [40.64, -73.78], altM: 10970, speedMs: 248 },
  { prefix: "DLH", country: "Germany", from: [50.03, 8.57], to: [31.14, 121.81], altM: 11280, speedMs: 247 },
  { prefix: "AFR", country: "France", from: [49.01, 2.55], to: [-23.43, -46.47], altM: 11580, speedMs: 251 },
  { prefix: "KLM", country: "Netherlands", from: [52.31, 4.76], to: [37.62, -122.38], altM: 10970, speedMs: 243 },
  { prefix: "UAL", country: "United States", from: [37.62, -122.38], to: [40.64, -73.78], altM: 11280, speedMs: 256 },
  { prefix: "DAL", country: "United States", from: [33.64, -84.43], to: [51.47, -0.45], altM: 11580, speedMs: 252 },
  { prefix: "AAL", country: "United States", from: [32.90, -97.04], to: [35.76, 140.39], altM: 10970, speedMs: 249 },
  { prefix: "QFA", country: "Australia", from: [-33.94, 151.18], to: [33.94, -118.41], altM: 11890, speedMs: 255 },
  { prefix: "THY", country: "Turkey", from: [41.27, 28.75], to: [1.36, 103.99], altM: 11280, speedMs: 246 },
  { prefix: "AIC", country: "India", from: [28.56, 77.10], to: [50.03, 8.57], altM: 10970, speedMs: 241 },
  { prefix: "LAN", country: "Chile", from: [-33.39, -70.79], to: [25.79, -80.29], altM: 11280, speedMs: 244 },
  { prefix: "ACA", country: "Canada", from: [43.68, -79.63], to: [49.01, 2.55], altM: 10970, speedMs: 247 },
  { prefix: "SWR", country: "Switzerland", from: [47.46, 8.55], to: [22.31, 113.91], altM: 11580, speedMs: 248 },
];

function buildFallbackFlights(): FlightTrack[] {
  const flights: FlightTrack[] = [];
  const nowPhase = (Date.now() / 1000 / 36000) % 1;

  for (let c = 0; c < CORRIDORS.length; c++) {
    const cor = CORRIDORS[c];
    // 6 staggered flights along each major corridor (both directions)
    for (let k = 0; k < 6; k++) {
      const rev = k % 2 === 1;
      const [lat1, lon1] = rev ? cor.to : cor.from;
      const [lat2, lon2] = rev ? cor.from : cor.to;
      const t = (nowPhase + k * 0.165 + c * 0.043) % 1;

      // Handle Pacific dateline shortest path
      let dLon = lon2 - lon1;
      if (dLon > 180) dLon -= 360;
      if (dLon < -180) dLon += 360;

      let lon = lon1 + dLon * t;
      if (lon > 180) lon -= 360;
      if (lon < -180) lon += 360;
      const lat = lat1 + (lat2 - lat1) * t + Math.sin(t * Math.PI) * (lat1 > 0 && lat2 > 0 ? 4.5 : -2.5);

      const heading = ((Math.atan2(dLon * Math.cos((lat * Math.PI) / 180), lat2 - lat1) * 180) / Math.PI + 360) % 360;
      const num = 100 + ((c * 37 + k * 113) % 880);

      flights.push({
        id: `sim-${c}-${k}`,
        callsign: `${cor.prefix}${num}`,
        originCountry: cor.country,
        lat: Math.max(-80, Math.min(80, Number(lat.toFixed(3)))),
        lon: Number(lon.toFixed(3)),
        altitudeM: cor.altM + ((k % 3) - 1) * 610,
        velocityMs: cor.speedMs + ((k * 7) % 18) - 9,
        headingDeg: Math.round(heading),
        verticalRateMs: 0,
      });
    }
  }
  return flights;
}

export async function GET() {
  try {
    const res = await fetch("https://opensky-network.org/api/states/all", {
      signal: AbortSignal.timeout(6000),
      next: { revalidate: 45 },
      headers: { "User-Agent": "AegisOrbital/2.0" },
    });

    if (!res.ok) throw new Error(`OpenSky HTTP ${res.status}`);
    const data = (await res.json()) as {
      states?: Array<
        [
          string,
          string | null,
          string,
          number | null,
          number,
          number | null,
          number | null,
          number | null,
          boolean,
          number | null,
          number | null,
          number | null,
        ]
      >;
    };

    const states = data.states ?? [];
    // Spatially sample ~220 globally distributed airborne commercial flights
    const buckets = new Map<string, FlightTrack[]>();

    for (const s of states) {
      const icao = s[0];
      const callsign = (s[1] ?? "").trim();
      const country = s[2] ?? "International";
      const lon = s[5];
      const lat = s[6];
      const alt = s[7];
      const onGround = s[8];
      const vel = s[9];
      const track = s[10];
      const vrate = s[11];

      if (
        onGround ||
        !callsign ||
        lat === null ||
        lon === null ||
        alt === null ||
        alt < 2500 ||
        vel === null ||
        vel < 60
      ) {
        continue;
      }

      // Spatial 15x15 deg grid cell cap so flights span the whole globe instead of clustering only in EU/US
      const cellKey = `${Math.floor(lat / 15)},${Math.floor(lon / 15)}`;
      const cell = buckets.get(cellKey) ?? [];
      if (cell.length >= 4) continue;

      cell.push({
        id: icao,
        callsign,
        originCountry: country,
        lat: Number(lat.toFixed(3)),
        lon: Number(lon.toFixed(3)),
        altitudeM: Math.round(alt),
        velocityMs: Math.round(vel),
        headingDeg: Math.round(track ?? 0),
        verticalRateMs: Number((vrate ?? 0).toFixed(1)),
      });
      buckets.set(cellKey, cell);
    }

    const sampled: FlightTrack[] = [];
    for (const list of buckets.values()) {
      for (const f of list) {
        sampled.push(f);
        if (sampled.length >= 220) break;
      }
      if (sampled.length >= 220) break;
    }

    if (sampled.length < 25) throw new Error("Too few live flights");

    return NextResponse.json(
      {
        flights: sampled,
        updatedAt: new Date().toISOString(),
        source: "live" as const,
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=45, stale-while-revalidate=90",
        },
      }
    );
  } catch {
    return NextResponse.json(
      {
        flights: buildFallbackFlights(),
        updatedAt: new Date().toISOString(),
        source: "fallback" as const,
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
        },
      }
    );
  }
}
