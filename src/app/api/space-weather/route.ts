import { NextResponse } from "next/server";
import { FALLBACK_SPACE_WEATHER } from "@/lib/fallback-data";
import type { SpaceWeatherData } from "@/types/telemetry";

function classifyKp(kp: number): SpaceWeatherData["kpStatus"] {
  if (kp >= 7) return "severe";
  if (kp >= 5) return "storm";
  if (kp >= 3.5) return "unsettled";
  return "quiet";
}

export async function GET() {
  try {
    const [kpRes, plasmaRes, magRes] = await Promise.all([
      fetch("https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json", {
        signal: AbortSignal.timeout(5500),
        next: { revalidate: 300 },
      }),
      fetch(
        "https://services.swpc.noaa.gov/products/solar-wind/plasma-2-hour.json",
        {
          signal: AbortSignal.timeout(5500),
          next: { revalidate: 180 },
        }
      ),
      fetch("https://services.swpc.noaa.gov/products/solar-wind/mag-2-hour.json", {
        signal: AbortSignal.timeout(5500),
        next: { revalidate: 180 },
      }),
    ]);

    if (!kpRes.ok) throw new Error("NOAA Kp failed");

    const kpRows = (await kpRes.json()) as string[][];
    const validKp = kpRows
      .slice(1)
      .filter((r) => r.length >= 2 && Number.isFinite(parseFloat(r[1])));

    if (validKp.length === 0) throw new Error("Empty Kp");

    const recentKp = validKp.slice(-8).map((r) => {
      const hour = r[0].split(" ")[1]?.slice(0, 2) ?? "00";
      return { time: `${hour}Z`, kp: Number(parseFloat(r[1]).toFixed(2)) };
    });
    const latestKp = recentKp[recentKp.length - 1].kp;

    let solarWindSpeedKmS = FALLBACK_SPACE_WEATHER.solarWindSpeedKmS;
    let solarWindDensity = FALLBACK_SPACE_WEATHER.solarWindDensity;
    if (plasmaRes.ok) {
      const plasmaRows = (await plasmaRes.json()) as string[][];
      for (let i = plasmaRows.length - 1; i >= 1; i--) {
        const density = parseFloat(plasmaRows[i][1]);
        const speed = parseFloat(plasmaRows[i][2]);
        if (Number.isFinite(speed) && speed > 150) {
          solarWindSpeedKmS = Math.round(speed);
          if (Number.isFinite(density)) {
            solarWindDensity = Number(density.toFixed(1));
          }
          break;
        }
      }
    }

    let btNt = FALLBACK_SPACE_WEATHER.btNt;
    let bzNt = FALLBACK_SPACE_WEATHER.bzNt;
    if (magRes.ok) {
      const magRows = (await magRes.json()) as string[][];
      for (let i = magRows.length - 1; i >= 1; i--) {
        const bz = parseFloat(magRows[i][3]);
        const bt = parseFloat(magRows[i][6]);
        if (Number.isFinite(bt) && Number.isFinite(bz)) {
          btNt = Number(bt.toFixed(1));
          bzNt = Number(bz.toFixed(1));
          break;
        }
      }
    }

    const payload: SpaceWeatherData = {
      kpIndex: latestKp,
      kpStatus: classifyKp(latestKp),
      solarWindSpeedKmS,
      solarWindDensity,
      btNt,
      bzNt,
      kpHistory: recentKp,
      updatedAt: new Date().toISOString(),
      source: "live",
    };

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "public, s-maxage=180, stale-while-revalidate=360",
      },
    });
  } catch {
    return NextResponse.json(FALLBACK_SPACE_WEATHER, {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
      },
    });
  }
}
