"use client";

import React from "react";
import {
  Compass,
  Globe2,
  Orbit,
  Pause,
  Play,
  Radar,
  Satellite,
  SunMoon,
} from "lucide-react";
import { t } from "@/lib/i18n";
import type { Locale } from "@/types/telemetry";

interface BottomControlDockProps {
  locale: Locale;
  autoRotate: boolean;
  autoPatrol: boolean;
  lockedSatId: string | null;
  onJumpPreset: (
    presetId: "global" | "terminator" | "apac" | "europe" | "americas"
  ) => void;
  onLockStation: (satId: "iss" | "css") => void;
  onToggleRotate: () => void;
  onTogglePatrol: () => void;
}

export function BottomControlDock({
  locale,
  autoRotate,
  autoPatrol,
  lockedSatId,
  onJumpPreset,
  onLockStation,
  onToggleRotate,
  onTogglePatrol,
}: BottomControlDockProps) {
  const copy = t(locale);

  return (
    <footer className="pointer-events-none relative z-30 flex flex-col items-center gap-1.5 px-3 pb-3">
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
              ? "bg-[var(--accent-soft)] border border-[var(--accent-border)] text-[var(--accent)]"
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
