import { NextResponse } from "next/server";
import { FALLBACK_QUAKES } from "@/lib/fallback-data";
import type { QuakeEvent } from "@/types/telemetry";

interface UsgsFeature {
  id: string;
  properties: {
    mag: number | null;
    place: string | null;
    time: number | null;
    tsunami: number | null;
    alert: string | null;
    url: string | null;
  };
  geometry: {
    coordinates: [number, number, number];
  };
}

export async function GET() {
  try {
    const res = await fetch(
      "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson",
      {
        signal: AbortSignal.timeout(6500),
        next: { revalidate: 60 },
        headers: { "User-Agent": "AegisOrbital/1.0" },
      }
    );

    if (!res.ok) throw new Error(`USGS HTTP ${res.status}`);
    const data = (await res.json()) as { features?: UsgsFeature[] };
    const features = data.features ?? [];

    const quakes: QuakeEvent[] = features
      .filter(
        (f) =>
          f.geometry?.coordinates?.length >= 2 &&
          typeof f.properties?.mag === "number"
      )
      .slice(0, 65)
      .map((f) => ({
        id: f.id,
        magnitude: Number((f.properties.mag ?? 0).toFixed(1)),
        place: f.properties.place ?? "Unknown Seismic Region",
        time: f.properties.time ?? Date.now(),
        lon: f.geometry.coordinates[0],
        lat: f.geometry.coordinates[1],
        depthKm: Number((f.geometry.coordinates[2] ?? 10).toFixed(1)),
        tsunami: Boolean(f.properties.tsunami),
        alert: f.properties.alert ?? null,
        url: f.properties.url ?? "https://earthquake.usgs.gov/earthquakes/map/",
      }));

    if (quakes.length === 0) throw new Error("Empty USGS feed");

    return NextResponse.json(
      {
        quakes,
        updatedAt: new Date().toISOString(),
        source: "live" as const,
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
        },
      }
    );
  } catch {
    return NextResponse.json(
      {
        quakes: FALLBACK_QUAKES,
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
