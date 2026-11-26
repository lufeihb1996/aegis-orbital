"use client";

import React from "react";
import {
  Activity,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Clock,
  Cloud,
  Compass,
  Crosshair,
  Droplets,
  ExternalLink,
  Gauge,
  Newspaper,
  Orbit,
  Plane,
  Radio,
  Sun,
  Thermometer,
  TrendingUp,
  Wind,
} from "lucide-react";
import {
  formatCoord,
  formatRelativeTime,
  haversineDistanceKm,
  weatherCodeLabel,
} from "@/lib/geo";
import { t } from "@/lib/i18n";
import { WORLD_HUBS } from "@/lib/world-data";
import type {
  CoordinateWeather,
  IntelFeedData,
  Locale,
  QuakeEvent,
  SatelliteLiveState,
  SatellitePassPrediction,
  SelectedTarget,
  SpaceWeatherData,
} from "@/types/telemetry";
import { KpBarChart, SeismicHistogram, Sparkline } from "./TelemetryCharts";

interface RightOpsPanelProps {
  locale: Locale;
  collapsed: boolean;
  selectedTarget: SelectedTarget | null;
  lockedSatId: string | null;
  satellites: SatelliteLiveState[];
  upcomingPasses: SatellitePassPrediction[];
  quakes: QuakeEvent[];
  targetWeather: CoordinateWeather | null;
  weatherLoading: boolean;
  spaceWeather: SpaceWeatherData;
  intel: IntelFeedData;
  homeBaseId: string;
  onChangeHomeBase: (hubId: string) => void;
  onToggleCollapse: () => void;
  onToggleLockSat: (satId: string | null) => void;
  onPreviewPass: (pass: SatellitePassPrediction) => void;
}

export function RightOpsPanel({
  locale,
  collapsed,
  selectedTarget,
  lockedSatId,
  satellites,
  upcomingPasses,
  quakes,
  targetWeather,
  weatherLoading,
  spaceWeather,
  intel,
  homeBaseId,
  onChangeHomeBase,
  onToggleCollapse,
  onToggleLockSat,
  onPreviewPass,
}: RightOpsPanelProps) {
  const copy = t(locale);
  const homeHub =
    WORLD_HUBS.find((h) => h.id === homeBaseId) ?? WORLD_HUBS[0];

  if (collapsed) {
    return (
      <div className="pointer-events-auto flex flex-col items-end">
        <button
          type="button"
          onClick={onToggleCollapse}
          className="hud-panel hud-btn flex items-center gap-1.5 rounded-[10px] px-2.5 py-2 text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          title={copy.inspector}
        >
          <Crosshair className="h-3.5 w-3.5" />
          <ChevronLeft className="h-4 w-4 text-[var(--accent)]" />
        </button>
      </div>
    );
  }

  // Resolve target metadata & coordinates
  let targetTitle = "";
  let targetSubtitle = "";
  let targetCoords: { lat: number; lon: number } | null = null;
  let targetUrl: string | null = null;
  let activeSat: SatelliteLiveState | null = null;

  if (selectedTarget?.kind === "quake") {
    targetTitle = `M${selectedTarget.data.magnitude.toFixed(1)} · ${selectedTarget.data.place}`;
    targetSubtitle = formatRelativeTime(selectedTarget.data.time, locale);
    targetCoords = {
      lat: selectedTarget.data.lat,
      lon: selectedTarget.data.lon,
    };
    targetUrl = selectedTarget.data.url;
  } else if (selectedTarget?.kind === "satellite") {
    activeSat = satellites.find((s) => s.id === selectedTarget.id) ?? null;
    if (activeSat) {
      targetTitle = locale === "zh" ? activeSat.nameZh : activeSat.name;
      targetSubtitle = `NORAD #${activeSat.noradId} · ${activeSat.country}`;
      targetCoords = { lat: activeSat.lat, lon: activeSat.lon };
    }
  } else if (selectedTarget?.kind === "event") {
    targetTitle = selectedTarget.data.title;
    targetSubtitle = `${selectedTarget.data.categoryLabel} · NASA EONET`;
    targetCoords = {
      lat: selectedTarget.data.lat,
      lon: selectedTarget.data.lon,
    };
    targetUrl = selectedTarget.data.url;
  } else if (selectedTarget?.kind === "hub") {
    targetTitle =
      locale === "zh"
        ? `${selectedTarget.data.nameZh} · ${selectedTarget.data.countryZh}`
        : `${selectedTarget.data.name}, ${selectedTarget.data.country}`;
    targetSubtitle =
      locale === "zh" ? selectedTarget.data.roleZh : selectedTarget.data.role;
    targetCoords = {
      lat: selectedTarget.data.lat,
      lon: selectedTarget.data.lon,
    };
  } else if (selectedTarget?.kind === "flight") {
    targetTitle = `✈ ${selectedTarget.data.callsign}`;
    targetSubtitle = `${selectedTarget.data.originCountry} · ADS-B LIVE`;
    targetCoords = {
      lat: selectedTarget.data.lat,
      lon: selectedTarget.data.lon,
    };
  } else if (selectedTarget?.kind === "probe") {
    targetTitle = selectedTarget.label ?? copy.probeTitle;
    targetSubtitle = "OPEN-METEO SURFACE TELEMETRY";
    targetCoords = { lat: selectedTarget.lat, lon: selectedTarget.lon };
  }

  const distKm = targetCoords
    ? Math.round(
        haversineDistanceKm(
          homeHub.lat,
          homeHub.lon,
          targetCoords.lat,
          targetCoords.lon
        )
      )
    : null;

  const kpStatusLabel =
    spaceWeather.kpStatus === "severe"
      ? copy.kpSevere
      : spaceWeather.kpStatus === "storm"
        ? copy.kpStorm
        : spaceWeather.kpStatus === "unsettled"
          ? copy.kpUnsettled
          : copy.kpQuiet;

  return (
    <aside className="pointer-events-auto flex h-full w-[332px] max-w-[calc(100vw-24px)] flex-col gap-2.5 overflow-hidden">
      <div className="hud-scroll flex flex-1 flex-col gap-2.5 overflow-y-auto pr-0.5">
        {/* 1. Target Telemetry Inspector + Live Open-Meteo Weather */}
        <section className="hud-panel rounded-[14px] p-3">
          <div className="flex items-center justify-between pb-2">
            <div className="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-[var(--text-secondary)]">
              <Crosshair className="h-3.5 w-3.5 text-[var(--accent)]" />
              <span>{copy.inspector}</span>
            </div>
            <button
              type="button"
              onClick={onToggleCollapse}
              className="hud-btn rounded p-1 text-[var(--text-muted)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)]"
              aria-label="Collapse Right Panel"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>

          {!selectedTarget ? (
            <div className="rounded-[8px] border border-dashed border-[var(--border-subtle)] bg-[oklch(0_0_0/0.2)] px-3 py-4 text-center text-[12px] leading-[1.5] text-[var(--text-muted)]">
              {copy.clickGlobeHint}
            </div>
          ) : (
            <div className="space-y-2.5">
              {/* Target Title */}
              <div>
                <h2 className="text-[14px] font-semibold leading-[1.3] text-[var(--text-primary)]">
                  {targetTitle}
                </h2>
                <div className="mt-1 flex items-center justify-between gap-2 font-mono text-[11px] text-[var(--text-muted)] tabular">
                  <span className="truncate">{targetSubtitle}</span>
                  {targetCoords && (
                    <span className="shrink-0 text-[var(--accent)]">
                      {formatCoord(targetCoords.lat, targetCoords.lon)}
                    </span>
                  )}
                </div>
              </div>

              {/* Satellite Specialized Orbital Metrics */}
              {activeSat && (
                <>
                  <div className="grid grid-cols-3 gap-1.5">
                    <div className="hud-card rounded-[6px] p-2">
                      <div className="text-[10px] text-[var(--text-muted)]">
                        {copy.altitude}
                      </div>
                      <div className="mt-0.5 font-mono text-[13px] font-semibold text-[var(--text-primary)] tabular">
                        {Math.round(activeSat.altitudeKm)}{" "}
                        <span className="text-[10px] font-normal text-[var(--text-muted)]">
                          km
                        </span>
                      </div>
                    </div>
                    <div className="hud-card rounded-[6px] p-2">
                      <div className="text-[10px] text-[var(--text-muted)]">
                        {copy.velocity}
                      </div>
                      <div className="mt-0.5 font-mono text-[13px] font-semibold text-[var(--text-primary)] tabular">
                        {activeSat.velocityKmS.toFixed(2)}{" "}
                        <span className="text-[10px] font-normal text-[var(--text-muted)]">
                          km/s
                        </span>
                      </div>
                    </div>
                    <div className="hud-card rounded-[6px] p-2">
                      <div className="text-[10px] text-[var(--text-muted)]">
                        {copy.footprint}
                      </div>
                      <div className="mt-0.5 font-mono text-[13px] font-semibold text-[var(--text-primary)] tabular">
                        {Math.round(activeSat.footprintKm)}{" "}
                        <span className="text-[10px] font-normal text-[var(--text-muted)]">
                          km
                        </span>
                      </div>
                    </div>
                  </div>
                  <p className="text-[11.5px] leading-[1.45] text-[var(--text-secondary)]">
                    {locale === "zh"
                      ? activeSat.descriptionZh
                      : activeSat.description}
                  </p>
                  <button
                    type="button"
                    onClick={() =>
                      onToggleLockSat(
                        lockedSatId === activeSat!.id ? null : activeSat!.id
                      )
                    }
                    className={`hud-btn flex w-full items-center justify-center gap-1.5 rounded-[7px] border py-1.5 text-[12px] font-medium ${
                      lockedSatId === activeSat.id
                        ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-fg)]"
                        : "border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent)] hover:bg-[var(--accent)] hover:text-[var(--accent-fg)]"
                    }`}
                  >
                    <Radio className="h-3.5 w-3.5" />
                    <span>
                      {lockedSatId === activeSat.id
                        ? copy.trackingActive
                        : copy.trackLive}
                    </span>
                  </button>
                </>
              )}

              {/* Quake Specialized Metrics */}
              {selectedTarget.kind === "quake" && (
                <div className="grid grid-cols-3 gap-1.5">
                  <div className="hud-card rounded-[6px] p-2">
                    <div className="text-[10px] text-[var(--text-muted)]">
                      {copy.magnitude}
                    </div>
                    <div
                      className="mt-0.5 font-mono text-[14px] font-bold tabular"
                      style={{
                        color:
                          selectedTarget.data.magnitude >= 5.5
                            ? "var(--status-critical)"
                            : selectedTarget.data.magnitude >= 4.5
                              ? "var(--status-alert)"
                              : "var(--status-warn)",
                      }}
                    >
                      M{selectedTarget.data.magnitude.toFixed(1)}
                    </div>
                  </div>
                  <div className="hud-card rounded-[6px] p-2">
                    <div className="text-[10px] text-[var(--text-muted)]">
                      {copy.depth}
                    </div>
                    <div className="mt-0.5 font-mono text-[13px] font-semibold text-[var(--text-primary)] tabular">
                      {selectedTarget.data.depthKm.toFixed(1)} km
                    </div>
                  </div>
                  <div className="hud-card rounded-[6px] p-2">
                    <div className="text-[10px] text-[var(--text-muted)]">
                      {copy.tsunamiRisk}
                    </div>
                    <div
                      className="mt-0.5 text-[11.5px] font-semibold"
                      style={{
                        color: selectedTarget.data.tsunami
                          ? "var(--status-critical)"
                          : "var(--status-nominal)",
                      }}
                    >
                      {selectedTarget.data.tsunami
                        ? copy.tsunamiYes
                        : copy.tsunamiNo}
                    </div>
                  </div>
                </div>
              )}

              {/* Flight Specialized Telemetry */}
              {selectedTarget.kind === "flight" && (
                <div className="grid grid-cols-3 gap-1.5">
                  <div className="hud-card rounded-[6px] p-2">
                    <div className="text-[10px] text-[var(--text-muted)]">
                      {copy.flightAlt}
                    </div>
                    <div className="mt-0.5 font-mono text-[13px] font-semibold text-[var(--text-primary)] tabular">
                      {Math.round(selectedTarget.data.altitudeM).toLocaleString()}{" "}
                      <span className="text-[9.5px] font-normal text-[var(--text-muted)]">
                        m
                      </span>
                    </div>
                  </div>
                  <div className="hud-card rounded-[6px] p-2">
                    <div className="text-[10px] text-[var(--text-muted)]">
                      {copy.flightSpeed}
                    </div>
                    <div className="mt-0.5 font-mono text-[13px] font-semibold text-[var(--text-primary)] tabular">
                      {Math.round(selectedTarget.data.velocityMs * 3.6)}{" "}
                      <span className="text-[9.5px] font-normal text-[var(--text-muted)]">
                        km/h
                      </span>
                    </div>
                  </div>
                  <div className="hud-card rounded-[6px] p-2">
                    <div className="text-[10px] text-[var(--text-muted)]">
                      {copy.flightHeading}
                    </div>
                    <div className="mt-0.5 flex items-center gap-1 font-mono text-[13px] font-semibold text-[var(--accent)] tabular">
                      <Plane className="h-3 w-3" />
                      <span>{selectedTarget.data.headingDeg}°</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Distance from User's Selected Base City */}
              {distKm !== null && (
                <div className="flex items-center justify-between rounded-[6px] border border-[var(--border-subtle)] bg-[oklch(0_0_0/0.22)] px-2.5 py-1.5 text-[11.5px]">
                  <div className="flex items-center gap-1.5 text-[var(--text-muted)]">
                    <Compass className="h-3.5 w-3.5 text-[var(--accent)]" />
                    <span>{copy.distanceFromBase}</span>
                    <select
                      value={homeBaseId}
                      onChange={(e) => onChangeHomeBase(e.target.value)}
                      className="rounded bg-[var(--bg-card)] px-1 py-0.5 text-[11px] text-[var(--text-primary)] outline-none"
                      aria-label={copy.homeBase}
                    >
                      {WORLD_HUBS.slice(0, 10).map((h) => (
                        <option
                          key={h.id}
                          value={h.id}
                          className="bg-[#0b1220] text-white"
                        >
                          {locale === "zh" ? h.nameZh : h.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <span className="font-mono font-semibold text-[var(--text-primary)] tabular">
                    {distKm.toLocaleString()} km
                  </span>
                </div>
              )}

              {/* Live Surface Weather via Open-Meteo */}
              <div className="hud-card rounded-[8px] p-2.5">
                <div className="flex items-center justify-between text-[10.5px] uppercase tracking-[0.06em] text-[var(--text-muted)]">
                  <span className="flex items-center gap-1">
                    <Cloud className="h-3 w-3 text-[var(--accent)]" />
                    {copy.localWeather}
                  </span>
                  {targetWeather && (
                    <span className="font-mono text-[10px]">
                      {weatherCodeLabel(targetWeather.weatherCode, locale)}
                    </span>
                  )}
                </div>

                {weatherLoading ? (
                  <div className="py-2.5 font-mono text-[11px] text-[var(--text-muted)]">
                    {copy.loadingWeather}
                  </div>
                ) : targetWeather ? (
                  <div className="mt-2 grid grid-cols-3 gap-2 font-mono text-[11.5px] tabular">
                    <div className="flex items-center gap-1.5">
                      <Thermometer className="h-3.5 w-3.5 text-[var(--status-warn)]" />
                      <div>
                        <div className="font-semibold text-[var(--text-primary)]">
                          {targetWeather.temperatureC}°C
                        </div>
                        <div className="text-[9.5px] text-[var(--text-muted)]">
                          {copy.feelsLike} {targetWeather.apparentTempC}°
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Wind className="h-3.5 w-3.5 text-[var(--accent)]" />
                      <div>
                        <div className="font-semibold text-[var(--text-primary)]">
                          {targetWeather.windSpeedKmh}
                        </div>
                        <div className="text-[9.5px] text-[var(--text-muted)]">
                          km/h · {targetWeather.windDirectionDeg}°
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Droplets className="h-3.5 w-3.5 text-[var(--status-nominal)]" />
                      <div>
                        <div className="font-semibold text-[var(--text-primary)]">
                          {targetWeather.humidityPct}%
                        </div>
                        <div className="text-[9.5px] text-[var(--text-muted)]">
                          {targetWeather.pressureHpa} hPa
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>

              {targetUrl && (
                <a
                  href={targetUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hud-btn flex items-center justify-center gap-1.5 rounded-[7px] border border-[var(--border-subtle)] bg-[var(--bg-card)] py-1.5 text-[11.5px] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
                >
                  <span>{copy.openSource}</span>
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          )}
        </section>

        {/* 1.5 Overhead Space Station Pass Predictor (SGP4 24H) */}
        <section className="hud-panel rounded-[14px] p-3">
          <div className="flex items-center justify-between pb-2">
            <div className="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-[var(--text-secondary)]">
              <Orbit className="h-3.5 w-3.5 text-[#ffcf4d]" />
              <span>{copy.nextPasses}</span>
            </div>
            <span className="font-mono text-[10px] text-[var(--accent)]">
              {locale === "zh" ? homeHub.nameZh : homeHub.name}
            </span>
          </div>

          {upcomingPasses.length === 0 ? (
            <div className="rounded-[6px] bg-[oklch(0_0_0/0.2)] px-2.5 py-2 text-[11.5px] text-[var(--text-muted)]">
              {copy.noPassSoon}
            </div>
          ) : (
            <div className="space-y-1.5">
              {upcomingPasses.slice(0, 3).map((pass) => {
                const diffMin = Math.max(
                  0,
                  Math.round((pass.riseTimeMs - Date.now()) / 60000)
                );
                const hrs = Math.floor(diffMin / 60);
                const mins = diffMin % 60;
                const countdown =
                  hrs > 0
                    ? `${hrs}h ${mins.toString().padStart(2, "0")}m`
                    : `${mins}m`;
                const localTime = new Intl.DateTimeFormat("en-GB", {
                  timeZone: homeHub.timezone,
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: false,
                }).format(new Date(pass.riseTimeMs));

                return (
                  <div
                    key={`${pass.satId}-${pass.riseTimeMs}`}
                    className="hud-card flex items-center justify-between gap-2 rounded-[6px] px-2.5 py-1.5"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-[12px] font-medium text-[var(--text-primary)]">
                        {locale === "zh" ? pass.satNameZh : pass.satName}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 font-mono text-[10.5px] text-[var(--text-muted)] tabular">
                        <span className="inline-flex items-center gap-1 text-[var(--accent)]">
                          <Clock className="h-2.5 w-2.5" />
                          {localTime} (+{countdown})
                        </span>
                        <span>
                          {copy.nextPassPeak} {pass.maxElevationDeg}°
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onPreviewPass(pass)}
                      className="hud-btn shrink-0 rounded-[5px] border border-[var(--accent-border)] bg-[var(--accent-soft)] px-2 py-1 text-[11px] font-medium text-[var(--accent)] hover:bg-[var(--accent)] hover:text-[var(--accent-fg)]"
                    >
                      {copy.jumpToPass}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* 2. Space Weather & Geomagnetic Monitor (NOAA SWPC) */}
        <section className="hud-panel rounded-[14px] p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-[var(--text-secondary)]">
              <Sun className="h-3.5 w-3.5 text-[var(--status-warn)]" />
              <span>{copy.spaceWeather}</span>
            </div>
            <span
              className="rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase"
              style={{
                backgroundColor:
                  spaceWeather.kpIndex >= 5
                    ? "oklch(0.66 0.22 20 / 0.2)"
                    : "var(--accent-soft)",
                color:
                  spaceWeather.kpIndex >= 5
                    ? "var(--status-critical)"
                    : "var(--accent)",
              }}
            >
              {kpStatusLabel}
            </span>
          </div>

          <div className="mt-2.5 grid grid-cols-3 gap-1.5">
            <div className="hud-card rounded-[6px] p-2">
              <div className="text-[10px] text-[var(--text-muted)]">
                {copy.kpIndex}
              </div>
              <div className="mt-0.5 font-mono text-[14px] font-bold text-[var(--text-primary)] tabular">
                {spaceWeather.kpIndex.toFixed(1)}
              </div>
            </div>
            <div className="hud-card rounded-[6px] p-2">
              <div className="text-[10px] text-[var(--text-muted)]">
                {copy.solarWind}
              </div>
              <div className="mt-0.5 font-mono text-[13px] font-semibold text-[var(--text-primary)] tabular">
                {spaceWeather.solarWindSpeedKmS}{" "}
                <span className="text-[9.5px] font-normal text-[var(--text-muted)]">
                  km/s
                </span>
              </div>
            </div>
            <div className="hud-card rounded-[6px] p-2">
              <div className="text-[10px] text-[var(--text-muted)]">
                {copy.imfBz}
              </div>
              <div
                className="mt-0.5 font-mono text-[13px] font-semibold tabular"
                style={{
                  color:
                    spaceWeather.bzNt < -4
                      ? "var(--status-alert)"
                      : "var(--text-primary)",
                }}
              >
                {spaceWeather.bzNt > 0 ? `+${spaceWeather.bzNt}` : spaceWeather.bzNt}{" "}
                <span className="text-[9.5px] font-normal text-[var(--text-muted)]">
                  nT
                </span>
              </div>
            </div>
          </div>

          <KpBarChart history={spaceWeather.kpHistory} />
        </section>

        {/* 3. Global Market Pulse (Practical Desk Monitor) */}
        <section className="hud-panel rounded-[14px] p-3">
          <div className="flex items-center justify-between pb-2">
            <div className="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-[var(--text-secondary)]">
              <TrendingUp className="h-3.5 w-3.5 text-[var(--status-nominal)]" />
              <span>{copy.marketPulse}</span>
            </div>
            <span className="font-mono text-[10px] text-[var(--text-muted)]">
              USD · 24H
            </span>
          </div>

          <div className="grid grid-cols-1 gap-1.5">
            {intel.markets.map((m) => {
              const up = m.change24h >= 0;
              return (
                <div
                  key={m.symbol}
                  className="hud-card flex items-center justify-between gap-2 rounded-[6px] px-2.5 py-1.5"
                >
                  <div className="min-w-0">
                    <div className="flex items-baseline gap-1.5">
                      <span className="font-mono text-[12px] font-semibold text-[var(--text-primary)]">
                        {m.symbol}
                      </span>
                      <span className="truncate text-[10.5px] text-[var(--text-muted)]">
                        {m.name}
                      </span>
                    </div>
                  </div>

                  <Sparkline data={m.sparkline} positive={up} />

                  <div className="text-right font-mono tabular">
                    <div className="text-[12px] font-semibold text-[var(--text-primary)]">
                      $
                      {m.price >= 1000
                        ? m.price.toLocaleString("en-US", {
                            maximumFractionDigits: 0,
                          })
                        : m.price.toFixed(2)}
                    </div>
                    <div
                      className="text-[10.5px] font-medium"
                      style={{
                        color: up
                          ? "var(--status-nominal)"
                          : "var(--status-critical)",
                      }}
                    >
                      {up ? "+" : ""}
                      {m.change24h.toFixed(2)}%
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* 4. Seismic Distribution */}
        <section className="hud-panel rounded-[14px] p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-[var(--text-secondary)]">
              <Activity className="h-3.5 w-3.5 text-[var(--status-alert)]" />
              <span>{copy.seismicDist}</span>
            </div>
            <span className="flex items-center gap-1 font-mono text-[10.5px] text-[var(--text-muted)] tabular">
              <Gauge className="h-3 w-3" />
              {quakes.length}
            </span>
          </div>
          <SeismicHistogram quakes={quakes} />
        </section>

        {/* 5. Tech Signal Radar (Live Hacker News) */}
        <section className="hud-panel rounded-[14px] p-3">
          <div className="flex items-center justify-between pb-2">
            <div className="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-[var(--text-secondary)]">
              <Newspaper className="h-3.5 w-3.5 text-[var(--accent)]" />
              <span>{copy.techRadar}</span>
            </div>
            <span className="font-mono text-[10px] text-[var(--text-muted)]">
              HN LIVE
            </span>
          </div>

          <div className="space-y-1.5">
            {intel.news.slice(0, 6).map((item) => (
              <a
                key={item.id}
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="hud-card hud-card-interactive group block rounded-[6px] px-2.5 py-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="line-clamp-2 text-[12px] leading-[1.4] text-[var(--text-primary)] group-hover:text-[var(--accent)]">
                    {item.title}
                  </span>
                  <ArrowUpRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--text-muted)] group-hover:text-[var(--accent)]" />
                </div>
                <div className="mt-1 flex items-center justify-between font-mono text-[10px] text-[var(--text-muted)] tabular">
                  <span className="truncate">{item.domain}</span>
                  <span className="shrink-0">
                    ▲ {item.score} · {item.comments}c
                  </span>
                </div>
              </a>
            ))}
          </div>
        </section>
      </div>
    </aside>
  );
}
