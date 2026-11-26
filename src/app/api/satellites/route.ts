import { NextResponse } from "next/server";
import { FALLBACK_SATELLITES } from "@/lib/fallback-data";
import type { SatelliteTLE } from "@/types/telemetry";

async function fetchCelestrakTle(noradId: number): Promise<[string, string] | null> {
  try {
    const res = await fetch(
      `https://celestrak.org/NORAD/elements/gp.php?CATNR=${noradId}&FORMAT=TLE`,
      {
        signal: AbortSignal.timeout(4500),
        next: { revalidate: 3600 },
        headers: { "User-Agent": "AegisOrbital/1.0" },
      }
    );
    if (!res.ok) return null;
    const text = (await res.text()).trim();
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const l1 = lines.find((l) => l.startsWith("1 "));
    const l2 = lines.find((l) => l.startsWith("2 "));
    if (l1 && l2 && l1.length >= 60 && l2.length >= 60) {
      return [l1, l2];
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchIssBackupTle(): Promise<[string, string] | null> {
  try {
    const res = await fetch("https://api.wheretheiss.at/v1/satellites/25544/tles", {
      signal: AbortSignal.timeout(4500),
      next: { revalidate: 1800 },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { line1?: string; line2?: string };
    if (json.line1 && json.line2) return [json.line1, json.line2];
    return null;
  } catch {
    return null;
  }
}

export async function GET() {
  let liveCount = 0;

  const updated: SatelliteTLE[] = await Promise.all(
    FALLBACK_SATELLITES.map(async (sat) => {
      let tle = await fetchCelestrakTle(sat.noradId);
      if (!tle && sat.noradId === 25544) {
        tle = await fetchIssBackupTle();
      }
      if (tle) {
        liveCount += 1;
        return { ...sat, tle1: tle[0], tle2: tle[1] };
      }
      return sat;
    })
  );

  return NextResponse.json(
    {
      satellites: updated,
      liveCount,
      updatedAt: new Date().toISOString(),
      source: liveCount > 0 ? ("live" as const) : ("fallback" as const),
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=3600",
      },
    }
  );
}
