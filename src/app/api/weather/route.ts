import { NextRequest, NextResponse } from "next/server";
import type { CoordinateWeather } from "@/types/telemetry";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const lat = Number(searchParams.get("lat"));
  const lon = Number(searchParams.get("lon"));

  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    lat < -90 ||
    lat > 90 ||
    lon < -180 ||
    lon > 180
  ) {
    return NextResponse.json({ error: "Invalid coordinates" }, { status: 400 });
  }

  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(
      3
    )}&longitude=${lon.toFixed(
      3
    )}&current=temperature_2m,apparent_temperature,relative_humidity_2m,is_day,weather_code,cloud_cover,surface_pressure,wind_speed_10m,wind_direction_10m&timezone=auto`;

    const res = await fetch(url, {
      signal: AbortSignal.timeout(5500),
      next: { revalidate: 300 },
    });

    if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
    const data = (await res.json()) as {
      elevation?: number;
      timezone?: string;
      current?: {
        temperature_2m?: number;
        apparent_temperature?: number;
        relative_humidity_2m?: number;
        is_day?: number;
        weather_code?: number;
        cloud_cover?: number;
        surface_pressure?: number;
        wind_speed_10m?: number;
        wind_direction_10m?: number;
      };
    };

    const c = data.current;
    if (!c) throw new Error("Missing current weather");

    const payload: CoordinateWeather = {
      lat,
      lon,
      temperatureC: Number((c.temperature_2m ?? 0).toFixed(1)),
      apparentTempC: Number((c.apparent_temperature ?? 0).toFixed(1)),
      windSpeedKmh: Number((c.wind_speed_10m ?? 0).toFixed(1)),
      windDirectionDeg: Math.round(c.wind_direction_10m ?? 0),
      humidityPct: Math.round(c.relative_humidity_2m ?? 0),
      pressureHpa: Math.round(c.surface_pressure ?? 1013),
      cloudCoverPct: Math.round(c.cloud_cover ?? 0),
      weatherCode: c.weather_code ?? 0,
      isDay: c.is_day === 1,
      timezone: data.timezone ?? "UTC",
      elevationM: Math.round(data.elevation ?? 0),
      updatedAt: new Date().toISOString(),
    };

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Weather station unavailable" },
      { status: 503 }
    );
  }
}
