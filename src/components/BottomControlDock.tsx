"use client";

import React from "react";
import {
  Compass,
  FastForward,
  Globe2,
  Orbit,
  Pause,
  Play,
  Radar,
  RotateCcw,
  Ruler,
  Satellite,
  SunMoon,
  X,
} from "lucide-react";
import { haversineDistanceKm, initialBearingDeg } from "@/lib/geo";
import { t } from "@/lib/i18n";
import type { Locale, MeasurePoint } from "@/types/telemetry";

interface BottomControlDockProps {
  locale: Locale;
  autoRotate: boolean;
  autoPatrol: boolean;
  lockedSatId: string | null;
  timeOffsetMs: number;
  timeLapsePlaying: boolean;
  measureMode: boolean;
  measurePoints: MeasurePoint[];
  onJumpPreset: (
    presetId: "global" | "terminator" | "apac" | "europe" | "americas"
  ) => void;
  onLockStation: (satId: "iss" | "css") => void;
  onToggleRotate: () => void;
  onTogglePatrol: () => void;
  onChangeTimeOffset: (offsetMs: number) => void;
  onToggleTimeLapse: () => void;
  onResetLiveTime: () => void;
  onToggleMeasureMode: () => void;
  onClearMeasure: () => void;
}

const TWELVE_HOURS_MS = 12 * 3600 * 1000;

function formatOffsetLabel(offsetMs: number, liveLabel: string): string {
  if (Math.abs(offsetMs) < 60_000) return liveLabel;
  const sign = offsetMs >= 0 ? "+" : "−";
  const absMin = Math.round(Math.abs(offsetMs) / 60_000);
  const h = Math.floor(absMin / 60);
  const m = absMin % 60;
  return `${sign}${h.toString().padStart(2, "0")}h${m.toString().padStart(2, "0")}m`;
}

export function BottomControlDock({
  locale,
  autoRotate,
  autoPatrol,
  lockedSatId,
  timeOffsetMs,
  timeLapsePlaying,
  measureMode,
  measurePoints,
  onJumpPreset,
  onLockStation,
  onToggleRotate,
  onTogglePatrol,
  onChangeTimeOffset,
  onToggleTimeLapse,
  onResetLiveTime,
  onToggleMeasureMode,
  onClearMeasure,
}: BottomControlDockProps) {
  const copy = t(locale);
  const isLiveTime = Math.abs(timeOffsetMs) < 60_000 && !timeLapsePlaying;

  // Measure metrics when 2 points are pinned
  let distKm = 0;
  let flightHours = 0;
  let fiberRttMs = 0;
  let bearingDeg = 0;
  if (measurePoints.length === 2) {
    distKm = haversineDistanceKm(
      measurePoints[0].lat,
      measurePoints[0].lon,
      measurePoints[1].lat,
      measurePoints[1].lon
    );
    flightHours = distKm / 880;
    // Fiber optical refractive index ~1.47 -> ~204 km/ms one-way -> ~102 km/ms round-trip
    fiberRttMs = Math.max(1, Math.round((distKm / 204) * 2 * 1.15));
    bearingDeg = Math.round(
      initialBearingDeg(
        measurePoints[0].lat,
        measurePoints[0].lon,
        measurePoints[1].lat,
        measurePoints[1].lon
      )
    );
  }

  return (
    <footer className="pointer-events-none relative z-30 flex flex-col items-center gap-1.5 px-3 pb-3">
      {/* Great-Circle Tactical Measurement HUD Banner */}
      {(measureMode || measurePoints.length > 0) && (
        <div className="hud-panel pointer-events-auto flex flex-wrap items-center justify-center gap-3 rounded-[11px] border border-[var(--accent-border)] px-3 py-1.5 text-[11.5px]">
          <span className="flex items-center gap-1.5 font-semibold text-[#4ef7a4]">
            <Ruler className="h-3.5 w-3.5" />
            <span>{copy.measureMode}</span>
          </span>

          {measurePoints.length < 2 ? (
            <span className="text-[var(--text-secondary)]">
              {measurePoints.length === 0
                ? copy.measureHint
                : `${measurePoints[0].lat.toFixed(2)}°, ${measurePoints[0].lon.toFixed(2)}° → …`}
            </span>
          ) : (
            <div className="flex flex-wrap items-center gap-3 font-mono tabular">
              <span>
                <span className="text-[var(--text-muted)]">{copy.measureDistance} </span>
                <strong className="text-[var(--text-primary)]">
                  {Math.round(distKm).toLocaleString()} km
                </strong>
              </span>
              <span>
                <span className="text-[var(--text-muted)]">{copy.measureFlight} </span>
                <strong className="text-[var(--accent)]">
                  {flightHours.toFixed(1)} h
                </strong>
              </span>
              <span>
                <span className="text-[var(--text-muted)]">{copy.measureFiber} </span>
                <strong className="text-[#4ef7a4]">~{fiberRttMs} ms</strong>
              </span>
              <span className="hidden sm:inline">
                <span className="text-[var(--text-muted)]">{copy.measureBearing} </span>
                <strong className="text-[var(--text-primary)]">{bearingDeg}°</strong>
              </span>
            </div>
          )}

          <button
            type="button"
            onClick={onClearMeasure}
            className="hud-btn inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-[var(--text-muted)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)]"
          >
            <X className="h-3 w-3" />
            <span>{copy.measureClear}</span>
          </button>
        </div>
      )}

      {/* Time Machine Scrubber (-12h .. +12h + 600x Timelapse) */}
      <div className="hud-panel pointer-events-auto flex w-full max-w-[660px] items-center gap-2.5 rounded-[11px] px-3 py-1.5">
        <button
          type="button"
          onClick={onToggleTimeLapse}
          className={`hud-btn flex shrink-0 items-center gap-1 rounded-[6px] px-2 py-1 font-mono text-[11px] font-medium ${
            timeLapsePlaying
              ? "bg-[var(--accent)] text-[var(--accent-fg)]"
              : "bg-[var(--bg-card)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          }`}
          title={copy.timeLapse}
        >
          {timeLapsePlaying ? (
            <Pause className="h-3 w-3" />
          ) : (
            <FastForward className="h-3 w-3" />
          )}
          <span>{copy.timeLapse}</span>
        </button>

        <span className="hidden font-mono text-[10px] text-[var(--text-muted)] sm:inline tabular">
          -12h
        </span>

        <input
          type="range"
          min={-TWELVE_HOURS_MS}
          max={TWELVE_HOURS_MS}
          step={5 * 60 * 1000}
          value={Math.max(-TWELVE_HOURS_MS, Math.min(TWELVE_HOURS_MS, timeOffsetMs))}
          onChange={(e) => onChangeTimeOffset(Number(e.target.value))}
          className="h-1 flex-1 cursor-pointer accent-[var(--accent)]"
          aria-label="Orbital Time Machine Scrubber"
        />

        <span className="hidden font-mono text-[10px] text-[var(--text-muted)] sm:inline tabular">
          +12h
        </span>

        <button
          type="button"
          onClick={onResetLiveTime}
          className={`hud-btn flex shrink-0 items-center gap-1 rounded-[6px] px-2 py-1 font-mono text-[11px] font-semibold tabular ${
            isLiveTime
              ? "bg-[oklch(0.78_0.16_155/0.16)] text-[var(--status-nominal)]"
              : "bg-[var(--accent-soft)] text-[var(--accent)] hover:bg-[var(--accent)] hover:text-[var(--accent-fg)]"
          }`}
          title={copy.timeLive}
        >
          {!isLiveTime && <RotateCcw className="h-3 w-3" />}
          <span>{formatOffsetLabel(timeOffsetMs, copy.timeLive)}</span>
        </button>
      </div>

      {/* Main Sector & Orbital Control Dock */}
      <div className="hud-panel pointer-events-auto flex flex-wrap items-center justify-center gap-1 rounded-[13px] p-1">
        <button
          type="button"
          onClick={() => onJumpPreset("global")}
          className="hud-btn flex items-center gap-1.5 rounded-[8px] px-2.5 py-1.5 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)]"
        >
          <Globe2 className="h-3.5 w-3.5 text-[var(--accent)]" />
          <span>{copy.presetGlobal}</span>
        </button>

        <button
          type="button"
          onClick={() => onJumpPreset("terminator")}
          className="hud-btn flex items-center gap-1.5 rounded-[8px] px-2.5 py-1.5 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)]"
        >
          <SunMoon className="h-3.5 w-3.5 text-[var(--status-warn)]" />
          <span>{copy.presetTerminator}</span>
        </button>

        <button
          type="button"
          onClick={() => onJumpPreset("apac")}
          className="hud-btn rounded-[8px] px-2.5 py-1.5 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)]"
        >
          {copy.presetApac}
        </button>

        <button
          type="button"
          onClick={() => onJumpPreset("europe")}
          className="hud-btn rounded-[8px] px-2.5 py-1.5 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)]"
        >
          {copy.presetEurope}
        </button>

        <button
          type="button"
          onClick={() => onJumpPreset("americas")}
          className="hud-btn rounded-[8px] px-2.5 py-1.5 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)]"
        >
          {copy.presetAmericas}
        </button>

        <div className="mx-1 hidden h-4 w-px bg-[var(--border-subtle)] sm:block" />

        <button
          type="button"
          onClick={() => onLockStation("iss")}
          className={`hud-btn flex items-center gap-1.5 rounded-[8px] px-2.5 py-1.5 text-[12px] font-medium ${
            lockedSatId === "iss"
              ? "bg-[var(--accent)] text-[var(--accent-fg)]"
              : "text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)]"
          }`}
        >
          <Satellite className="h-3.5 w-3.5" />
          <span>{copy.presetIss}</span>
        </button>

        <button
          type="button"
          onClick={() => onLockStation("css")}
          className={`hud-btn flex items-center gap-1.5 rounded-[8px] px-2.5 py-1.5 text-[12px] font-medium ${
            lockedSatId === "css"
              ? "bg-[var(--accent)] text-[var(--accent-fg)]"
              : "text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)]"
          }`}
        >
          <Orbit className="h-3.5 w-3.5" />
          <span>{copy.presetCss}</span>
        </button>

        <div className="mx-1 hidden h-4 w-px bg-[var(--border-subtle)] sm:block" />

        <button
          type="button"
          onClick={onToggleMeasureMode}
          className={`hud-btn flex items-center gap-1.5 rounded-[8px] px-2.5 py-1.5 text-[12px] font-medium ${
            measureMode
              ? "border border-[#4ef7a4]/50 bg-[#4ef7a4]/20 text-[#4ef7a4]"
              : "text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)]"
          }`}
          title="Shift + Click"
        >
          <Ruler className="h-3.5 w-3.5" />
          <span>{copy.measureMode}</span>
        </button>

        <button
          type="button"
          onClick={onToggleRotate}
          className={`hud-btn flex items-center gap-1.5 rounded-[8px] px-2.5 py-1.5 text-[12px] ${
            autoRotate
              ? "bg-[var(--accent-soft)] text-[var(--accent)]"
              : "text-[var(--text-muted)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)]"
          }`}
          title="Space"
        >
          {autoRotate ? (
            <Pause className="h-3.5 w-3.5" />
          ) : (
            <Play className="h-3.5 w-3.5" />
          )}
          <span className="hidden sm:inline">{copy.rotate}</span>
        </button>

        <button
          type="button"
          onClick={onTogglePatrol}
          className={`hud-btn flex items-center gap-1.5 rounded-[8px] px-2.5 py-1.5 text-[12px] font-medium ${
            autoPatrol
              ? "border border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent)]"
              : "text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)]"
          }`}
        >
          {autoPatrol ? (
            <Radar className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Compass className="h-3.5 w-3.5" />
          )}
          <span>{autoPatrol ? copy.patrolActive : copy.autoPatrol}</span>
        </button>
      </div>

      <p className="hidden font-mono text-[10.5px] tracking-[0.03em] text-[var(--text-muted)] md:block">
        {copy.shortcuts}
      </p>
    </footer>
  );
}
