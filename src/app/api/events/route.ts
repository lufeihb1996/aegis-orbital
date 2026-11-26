import { NextResponse } from "next/server";
import { FALLBACK_EVENTS } from "@/lib/fallback-data";
import type { NaturalEvent } from "@/types/telemetry";

interface EonetEvent {
  id: string;
  title: string;
  link?: string;
  categories?: Array<{ id: string; title: string }>;
  sources?: Array<{ url: string }>;
  geometry?: Array<{
    date: string;
    type: string;
    coordinates: number[] | number[][][];
    magnitudeValue?: number | null;
    magnitudeUnit?: string | null;
  }>;
}

function normalizeCategory(id?: string): NaturalEvent["category"] {
  if (id === "wildfires") return "wildfires";
  if (id === "volcanoes") return "volcanoes";
  if (id === "severeStorms") return "severeStorms";
  if (id === "seaLakeIce") return "seaLakeIce";
  return "other";
}

export async function GET() {
  try {
    const res = await fetch(
      "https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=36&days=21",
      {
        signal: AbortSignal.timeout(6500),
        next: { revalidate: 300 },
        headers: { "User-Agent": "AegisOrbital/1.0" },
      }
    );

    if (!res.ok) throw new Error(`EONET HTTP ${res.status}`);
    const data = (await res.json()) as { events?: EonetEvent[] };

    const events: NaturalEvent[] = [];
    for (const item of data.events ?? []) {
      const geom = item.geometry?.[item.geometry.length - 1];
      if (!geom) continue;
      let lon: number | undefined;
      let lat: number | undefined;

      if (geom.type === "Point" && Array.isArray(geom.coordinates)) {
        lon = Number(geom.coordinates[0]);
        lat = Number(geom.coordinates[1]);
      } else if (
        geom.type === "Polygon" &&
        Array.isArray(geom.coordinates) &&
        Array.isArray(geom.coordinates[0]) &&
        Array.isArray(geom.coordinates[0][0])
      ) {
        lon = Number(geom.coordinates[0][0][0]);
        lat = Number(geom.coordinates[0][0][1]);
      }

      if (
        lon === undefined ||
        lat === undefined ||
        !Number.isFinite(lat) ||
        !Number.isFinite(lon)
      ) {
        continue;
      }

      const cat = item.categories?.[0];
      events.push({
        id: item.id,
        title: item.title,
        category: normalizeCategory(cat?.id),
        categoryLabel: cat?.title ?? "Natural Event",
        lat,
        lon,
        date: geom.date,
        magnitudeValue: geom.magnitudeValue ?? null,
        magnitudeUnit: geom.magnitudeUnit ?? null,
        url: item.sources?.[0]?.url ?? "https://eonet.gsfc.nasa.gov/",
      });
    }

    if (events.length === 0) throw new Error("No valid EONET events");

    return NextResponse.json(
      {
        events: events.slice(0, 30),
        updatedAt: new Date().toISOString(),
        source: "live" as const,
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
        },
      }
    );
  } catch {
    return NextResponse.json(
      {
        events: FALLBACK_EVENTS,
        updatedAt: new Date().toISOString(),
        source: "fallback" as const,
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
        },
      }
    );
  }
}
