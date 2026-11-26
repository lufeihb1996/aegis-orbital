"use client";

import React, { useEffect, useState } from "react";
import {
  Eye,
  EyeOff,
  Globe2,
  Languages,
  Palette,
  Radio,
  RefreshCw,
  ScanLine,
  Search,
  Sun,
  Volume2,
  VolumeX,
} from "lucide-react";
import { t } from "@/lib/i18n";
import type { Locale, SpaceWeatherData, ThemeId } from "@/types/telemetry";

interface TopTelemetryBarProps {
  theme: ThemeId;
  locale: Locale;
  zenMode: boolean;
  soundEnabled: boolean;
  crtEnabled: boolean;
  isLive: boolean;
  isSyncing: boolean;
  spaceWeather: SpaceWeatherData;
  quakeCount: number;
  satCount: number;
  eventCount: number;
  onCycleTheme: () => void;
  onToggleLocale: () => void;
  onToggleZen: () => void;
  onToggleSound: () => void;
  onToggleCrt: () => void;
  onOpenSearch: () => void;
  onRefresh: () => void;
}

const WORLD_CLOCKS = [
  { id: "UTC", labelZh: "UTC", labelEn: "UTC", tz: "UTC" },
  { id: "BJS", labelZh: "北京", labelEn: "BJS", tz: "Asia/Shanghai" },
  { id: "TYO", labelZh: "东京", labelEn: "TYO", tz: "Asia/Tokyo" },
  { id: "LDN", labelZh: "伦敦", labelEn: "LDN", tz: "Europe/London" },
  { id: "NYC", labelZh: "纽约", labelEn: "NYC", tz: "America/New_York" },
];

function formatClock(date: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(date);
  } catch {
    return "--:--:--";
  }
}

export function TopTelemetryBar({
  theme,
  locale,
  zenMode,
  soundEnabled,
  crtEnabled,
  isLive,
  isSyncing,
  spaceWeather,
  quakeCount,
  satCount,
  eventCount,
  onCycleTheme,
  onToggleLocale,
  onToggleZen,
  onToggleSound,
  onToggleCrt,
  onOpenSearch,
  onRefresh,
}: TopTelemetryBarProps) {
  const copy = t(locale);
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const kpColor =
    spaceWeather.kpIndex >= 5
      ? "text-[var(--status-critical)]"
      : spaceWeather.kpIndex >= 3.5
        ? "text-[var(--status-warn)]"
        : "text-[var(--status-nominal)]";

  return (
    <header className="pointer-events-auto relative z-30 flex items-center justify-between gap-2 px-3 py-2.5 sm:px-4">
      {/* Left: Brand Identity + Live Feed Status */}
      <div className="hud-panel flex items-center gap-3 rounded-[12px] px-3 py-1.5">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-[7px] bg-[var(--accent-soft)] border border-[var(--accent-border)] text-[var(--accent)]">
            <Globe2 className="h-4 w-4" strokeWidth={1.75} />
          </div>
          <div className="leading-tight">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[13px] font-semibold tracking-[0.12em] text-[var(--text-primary)]">
                AEGIS // ORBITAL
              </span>
              <span
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.06em]"
                style={{
                  backgroundColor: isLive
                    ? "oklch(0.78 0.16 155 / 0.14)"
                    : "oklch(0.82 0.16 78 / 0.15)",
                  color: isLive
                    ? "var(--status-nominal)"
                    : "var(--status-warn)",
                }}
              >
                <span
                  className="h-1.5 w-1.5 rounded-full animate-beacon"
                  style={{
                    backgroundColor: isLive
                      ? "var(--status-nominal)"
                      : "var(--status-warn)",
                  }}
                />
                {isLive ? copy.liveTelemetry : copy.degradedMode}
              </span>
            </div>
            <p className="hidden text-[10.5px] tracking-[0.04em] text-[var(--text-muted)] xl:block">
              {copy.brandSub}
            </p>
          </div>
        </div>

        {/* Live telemetry counter strip */}
        <div className="hidden items-center gap-3 border-l border-[var(--border-subtle)] pl-3 font-mono text-[11px] lg:flex tabular">
          <div className="flex items-center gap-1.5 text-[var(--text-secondary)]">
            <Radio className="h-3.5 w-3.5 text-[var(--accent)]" />
            <span>{satCount}</span>
            <span className="text-[var(--text-muted)]">SAT</span>
          </div>
          <div className="flex items-center gap-1.5 text-[var(--text-secondary)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--status-alert)]" />
            <span>{quakeCount}</span>
            <span className="text-[var(--text-muted)]">EQ</span>
          </div>
          <div className="flex items-center gap-1.5 text-[var(--text-secondary)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--status-critical)]" />
            <span>{eventCount}</span>
            <span className="text-[var(--text-muted)]">EVT</span>
          </div>
          <div className="flex items-center gap-1 border-l border-[var(--border-subtle)] pl-3">
            <Sun className={`h-3.5 w-3.5 ${kpColor}`} />
            <span className={`font-semibold ${kpColor}`}>
              Kp {spaceWeather.kpIndex.toFixed(1)}
            </span>
          </div>
        </div>
      </div>

      {/* Center: Practical Multi-Timezone Command Clocks */}
      <div className="hud-panel hidden items-center gap-3.5 rounded-[12px] px-3.5 py-2 2xl:flex">
        {WORLD_CLOCKS.map((clk, idx) => (
          <div
            key={clk.id}
            className={`flex items-baseline gap-1.5 font-mono tabular ${
              idx > 0 ? "border-l border-[var(--border-subtle)] pl-3.5" : ""
            }`}
          >
            <span className="text-[10px] font-medium uppercase tracking-[0.06em] text-[var(--text-muted)]">
              {locale === "zh" ? clk.labelZh : clk.labelEn}
            </span>
            <span
              className={`text-[12.5px] font-semibold ${
                clk.id === "BJS" || clk.id === "UTC"
                  ? "text-[var(--text-primary)]"
                  : "text-[var(--text-secondary)]"
              }`}
            >
              {now ? formatClock(now, clk.tz) : "--:--:--"}
            </span>
          </div>
        ))}
      </div>

      {/* Right: Action Controls */}
      <div className="hud-panel flex items-center gap-1 rounded-[12px] p-1">
        <button
          type="button"
          onClick={onOpenSearch}
          className="hud-btn flex items-center gap-2 rounded-[8px] border border-[var(--border-subtle)] bg-[var(--bg-card)] px-2.5 py-1.5 text-[12px] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
          title={`${copy.searchTrigger} (⌘K)`}
        >
          <Search className="h-3.5 w-3.5 text-[var(--accent)]" />
          <span className="hidden sm:inline">{copy.searchTrigger}</span>
          <kbd className="hidden rounded border border-[var(--border-subtle)] px-1 py-0.5 font-mono text-[10px] text-[var(--text-muted)] md:inline">
            ⌘K
          </kbd>
        </button>

        <button
          type="button"
          onClick={onCycleTheme}
          className="hud-btn flex items-center gap-1.5 rounded-[8px] px-2 py-1.5 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)]"
          title={copy.themeNames[theme]}
        >
          <Palette className="h-3.5 w-3.5 text-[var(--accent)]" />
          <span className="hidden xl:inline">{copy.themeNames[theme]}</span>
        </button>

        <button
          type="button"
          onClick={onToggleLocale}
          className="hud-btn flex items-center gap-1 rounded-[8px] px-2 py-1.5 font-mono text-[11.5px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)]"
          title="Switch Language / 切换语言"
        >
          <Languages className="h-3.5 w-3.5 text-[var(--accent)]" />
          <span>{locale === "zh" ? "EN" : "中文"}</span>
        </button>

        <button
          type="button"
          onClick={onToggleSound}
          className={`hud-btn rounded-[8px] p-1.5 ${
            soundEnabled
              ? "bg-[var(--accent-soft)] text-[var(--accent)]"
              : "text-[var(--text-muted)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)]"
          }`}
          title={soundEnabled ? copy.soundOn : copy.soundOff}
          aria-label={soundEnabled ? copy.soundOn : copy.soundOff}
        >
          {soundEnabled ? (
            <Volume2 className="h-3.5 w-3.5" />
          ) : (
            <VolumeX className="h-3.5 w-3.5" />
          )}
        </button>

        <button
          type="button"
          onClick={onToggleCrt}
          className={`hud-btn hidden rounded-[8px] p-1.5 sm:inline-flex ${
            crtEnabled
              ? "bg-[var(--accent-soft)] text-[var(--accent)]"
              : "text-[var(--text-muted)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)]"
          }`}
          title={copy.crtOn}
          aria-label={copy.crtOn}
        >
          <ScanLine className="h-3.5 w-3.5" />
        </button>

        <button
          type="button"
          onClick={onRefresh}
          disabled={isSyncing}
          className="hud-btn rounded-[8px] p-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)] disabled:opacity-50"
          title={copy.refresh}
          aria-label={copy.refresh}
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${isSyncing ? "animate-spin text-[var(--accent)]" : ""}`}
          />
        </button>

        <button
          type="button"
          onClick={onToggleZen}
          className={`hud-btn flex items-center gap-1.5 rounded-[8px] px-2.5 py-1.5 text-[12px] font-medium ${
            zenMode
              ? "bg-[var(--accent)] text-[var(--accent-fg)]"
              : "text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)]"
          }`}
          title={`${zenMode ? copy.exitZen : copy.zenMode} (H)`}
        >
          {zenMode ? (
            <Eye className="h-3.5 w-3.5" />
          ) : (
            <EyeOff className="h-3.5 w-3.5" />
          )}
          <span className="hidden md:inline">
            {zenMode ? copy.exitZen : copy.zenMode}
          </span>
        </button>
      </div>
    </header>
  );
}
