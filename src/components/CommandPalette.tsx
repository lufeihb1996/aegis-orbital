"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Activity, Flame, MapPin, Orbit, Search, X } from "lucide-react";
import { t } from "@/lib/i18n";
import { WORLD_HUBS } from "@/lib/world-data";
import type {
  Locale,
  NaturalEvent,
  QuakeEvent,
  SatelliteLiveState,
  SelectedTarget,
} from "@/types/telemetry";

interface CommandPaletteProps {
  open: boolean;
  locale: Locale;
  quakes: QuakeEvent[];
  satellites: SatelliteLiveState[];
  events: NaturalEvent[];
  onClose: () => void;
  onSelect: (target: SelectedTarget) => void;
}

export function CommandPalette({
  open,
  locale,
  quakes,
  satellites,
  events,
  onClose,
  onSelect,
}: CommandPaletteProps) {
  const copy = t(locale);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open]);

  const entries = useMemo(() => {
    const q = query.trim().toLowerCase();
    const results: Array<{
      id: string;
      label: string;
      sub: string;
      icon: React.ReactNode;
      target: SelectedTarget;
    }> = [];

    for (const sat of satellites) {
      const text = `${sat.name} ${sat.nameZh} ${sat.noradId} ${sat.country}`.toLowerCase();
      if (!q || text.includes(q)) {
        results.push({
          id: `s-${sat.id}`,
          label: locale === "zh" ? `${sat.nameZh} (${sat.name})` : sat.name,
          sub: `SAT · ${Math.round(sat.altitudeKm)} km · NORAD ${sat.noradId}`,
          icon: <Orbit className="h-4 w-4 text-[#ffcf4d]" />,
          target: { kind: "satellite", id: sat.id },
        });
      }
    }

    for (const hub of WORLD_HUBS) {
      const text = `${hub.name} ${hub.nameZh} ${hub.country} ${hub.countryZh} ${hub.role} ${hub.roleZh}`.toLowerCase();
      if (!q || text.includes(q)) {
        results.push({
          id: `h-${hub.id}`,
          label:
            locale === "zh"
              ? `${hub.nameZh} (${hub.name})`
              : `${hub.name}, ${hub.country}`,
          sub: locale === "zh" ? hub.roleZh : hub.role,
          icon: <MapPin className="h-4 w-4 text-[var(--accent)]" />,
          target: { kind: "hub", data: hub },
        });
      }
    }

    for (const eq of quakes) {
      const text = `m${eq.magnitude} ${eq.place} earthquake 地震`.toLowerCase();
      if (!q || text.includes(q)) {
        results.push({
          id: `q-${eq.id}`,
          label: `M${eq.magnitude.toFixed(1)} — ${eq.place}`,
          sub: `${eq.depthKm.toFixed(1)} km · ${eq.lat.toFixed(2)}°, ${eq.lon.toFixed(2)}°`,
          icon: <Activity className="h-4 w-4 text-[var(--status-alert)]" />,
          target: { kind: "quake", data: eq },
        });
      }
    }

    for (const ev of events) {
      const text = `${ev.title} ${ev.categoryLabel}`.toLowerCase();
      if (!q || text.includes(q)) {
        results.push({
          id: `e-${ev.id}`,
          label: ev.title,
          sub: `${ev.categoryLabel} · NASA EONET`,
          icon: <Flame className="h-4 w-4 text-[var(--status-critical)]" />,
          target: { kind: "event", data: ev },
        });
      }
    }

    return results.slice(0, 18);
  }, [query, satellites, quakes, events, locale]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-[oklch(0_0_0/0.62)] px-4 pt-[12vh] backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={copy.searchTrigger}
    >
      <div
        className="hud-panel w-full max-w-lg overflow-hidden rounded-[14px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 border-b border-[var(--border-subtle)] px-3.5 py-3">
          <Search className="h-4 w-4 shrink-0 text-[var(--accent)]" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              if (e.key === "Enter" && entries[0]) {
                onSelect(entries[0].target);
                onClose();
              }
            }}
            placeholder={copy.searchPlaceholder}
            className="w-full bg-transparent text-[16px] sm:text-[14px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            className="hud-btn rounded p-1 text-[var(--text-muted)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)]"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="hud-scroll max-h-[52vh] overflow-y-auto p-2 space-y-1">
          {entries.length === 0 ? (
            <div className="py-8 text-center text-[13px] text-[var(--text-muted)]">
              {copy.noMatches}
            </div>
          ) : (
            entries.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => {
                  onSelect(entry.target);
                  onClose();
                }}
                className="hud-card hud-card-interactive hud-btn flex w-full items-center gap-3 rounded-[7px] px-3 py-2 text-left"
              >
                <span className="shrink-0">{entry.icon}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium text-[var(--text-primary)]">
                    {entry.label}
                  </div>
                  <div className="truncate font-mono text-[11px] text-[var(--text-muted)] tabular">
                    {entry.sub}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
