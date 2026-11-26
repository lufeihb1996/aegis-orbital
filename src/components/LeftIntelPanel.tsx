"use client";

import React, { useMemo, useState } from "react";
import {
  Activity,
  ChevronLeft,
  ChevronRight,
  Cloud,
  Flame,
  Globe,
  Layers,
  MapPin,
  Network,
  Orbit,
  SunMedium,
  Zap,
} from "lucide-react";
import { formatRelativeTime } from "@/lib/geo";
import { t } from "@/lib/i18n";
import { WORLD_HUBS } from "@/lib/world-data";
import type {
  LayerKey,
  LayerVisibility,
  Locale,
  NaturalEvent,
  QuakeEvent,
  SatelliteLiveState,
  SelectedTarget,
} from "@/types/telemetry";

interface LeftIntelPanelProps {
  locale: Locale;
  collapsed: boolean;
  layers: LayerVisibility;
  quakes: QuakeEvent[];
  satellites: SatelliteLiveState[];
  events: NaturalEvent[];
  selectedTarget: SelectedTarget | null;
  onToggleCollapse: () => void;
  onToggleLayer: (key: LayerKey) => void;
  onSelectTarget: (target: SelectedTarget, flyTo?: boolean) => void;
}

type FeedTab = "all" | "quakes" | "satellites" | "events" | "hubs";

export function LeftIntelPanel({
  locale,
  collapsed,
  layers,
  quakes,
  satellites,
  events,
  selectedTarget,
  onToggleCollapse,
  onToggleLayer,
  onSelectTarget,
}: LeftIntelPanelProps) {
  const copy = t(locale);
  const [activeTab, setActiveTab] = useState<FeedTab>("all");
  const [layersOpen, setLayersOpen] = useState(true);

  const layerItems: Array<{
    key: LayerKey;
    label: string;
    icon: React.ReactNode;
    dotColor: string;
  }> = [
    {
      key: "satellites",
      label: copy.layerSatellites,
      icon: <Orbit className="h-3.5 w-3.5" />,
      dotColor: "#ffcf4d",
    },
    {
      key: "quakes",
      label: copy.layerQuakes,
      icon: <Activity className="h-3.5 w-3.5" />,
      dotColor: "var(--status-alert)",
    },
    {
      key: "events",
      label: copy.layerEvents,
      icon: <Flame className="h-3.5 w-3.5" />,
      dotColor: "var(--status-critical)",
    },
    {
      key: "cables",
      label: copy.layerCables,
      icon: <Network className="h-3.5 w-3.5" />,
      dotColor: "var(--accent)",
    },
    {
      key: "hubs",
      label: copy.layerHubs,
      icon: <MapPin className="h-3.5 w-3.5" />,
      dotColor: "var(--accent)",
    },
    {
      key: "terminator",
      label: copy.layerTerminator,
      icon: <SunMedium className="h-3.5 w-3.5" />,
      dotColor: "var(--status-warn)",
    },
    {
      key: "clouds",
      label: copy.layerClouds,
      icon: <Cloud className="h-3.5 w-3.5" />,
      dotColor: "#e2f3ff",
    },
    {
      key: "borders",
      label: copy.layerBorders,
      icon: <Globe className="h-3.5 w-3.5" />,
      dotColor: "var(--text-secondary)",
    },
  ];

  const feedItems = useMemo(() => {
    const out: Array<{
      uid: string;
      badge: string;
      badgeColor: string;
      title: string;
      meta: string;
      target: SelectedTarget;
    }> = [];

    if (activeTab === "all" || activeTab === "satellites") {
      const satList = activeTab === "all" ? satellites.slice(0, 3) : satellites;
      for (const sat of satList) {
        out.push({
          uid: `sat-${sat.id}`,
          badge: "SAT",
          badgeColor: sat.category === "station" ? "#ffcf4d" : "var(--accent)",
          title: locale === "zh" ? sat.nameZh : sat.name,
          meta: `${Math.round(sat.altitudeKm)} km · ${sat.velocityKmS.toFixed(2)} km/s`,
          target: { kind: "satellite", id: sat.id },
        });
      }
    }

    if (activeTab === "all" || activeTab === "quakes") {
      const qList = activeTab === "all" ? quakes.slice(0, 8) : quakes;
      for (const q of qList) {
        const col =
          q.magnitude >= 5.5
            ? "var(--status-critical)"
            : q.magnitude >= 4.5
              ? "var(--status-alert)"
              : q.magnitude >= 3.5
                ? "var(--status-warn)"
                : "var(--accent)";
        out.push({
          uid: `q-${q.id}`,
          badge: `M${q.magnitude.toFixed(1)}`,
          badgeColor: col,
          title: q.place,
          meta: `${q.depthKm.toFixed(0)} km · ${formatRelativeTime(q.time, locale)}`,
          target: { kind: "quake", data: q },
        });
      }
    }

    if (activeTab === "all" || activeTab === "events") {
      const eList = activeTab === "all" ? events.slice(0, 5) : events;
      for (const ev of eList) {
        out.push({
          uid: `ev-${ev.id}`,
          badge: ev.category === "volcanoes" ? "VOLC" : ev.category === "wildfires" ? "FIRE" : ev.category === "severeStorms" ? "STRM" : "EONET",
          badgeColor:
            ev.category === "wildfires"
              ? "var(--status-alert)"
              : ev.category === "volcanoes"
                ? "var(--status-critical)"
                : "var(--accent)",
          title: ev.title,
          meta: `${ev.categoryLabel} · ${ev.lat.toFixed(1)}°, ${ev.lon.toFixed(1)}°`,
          target: { kind: "event", data: ev },
        });
      }
    }

    if (activeTab === "hubs") {
      for (const hub of WORLD_HUBS) {
        out.push({
          uid: `hub-${hub.id}`,
          badge: hub.tier === 1 ? "T1" : "T2",
          badgeColor: "var(--accent)",
          title: locale === "zh" ? `${hub.nameZh} · ${hub.countryZh}` : `${hub.name}, ${hub.country}`,
          meta: locale === "zh" ? hub.roleZh : hub.role,
          target: { kind: "hub", data: hub },
        });
      }
    }

    return out;
  }, [activeTab, quakes, satellites, events, locale]);

  const isTargetSelected = (target: SelectedTarget) => {
    if (!selectedTarget || selectedTarget.kind !== target.kind) return false;
    if (target.kind === "quake" && selectedTarget.kind === "quake") {
      return target.data.id === selectedTarget.data.id;
    }
    if (target.kind === "satellite" && selectedTarget.kind === "satellite") {
      return target.id === selectedTarget.id;
    }
    if (target.kind === "event" && selectedTarget.kind === "event") {
      return target.data.id === selectedTarget.data.id;
    }
    if (target.kind === "hub" && selectedTarget.kind === "hub") {
      return target.data.id === selectedTarget.data.id;
    }
    return false;
  };

  if (collapsed) {
    return (
      <div className="pointer-events-auto flex flex-col items-start">
        <button
          type="button"
          onClick={onToggleCollapse}
          className="hud-panel hud-btn flex items-center gap-1.5 rounded-[10px] px-2.5 py-2 text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          title={copy.liveFeed}
        >
          <ChevronRight className="h-4 w-4 text-[var(--accent)]" />
          <Layers className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <aside className="pointer-events-auto flex h-full w-[308px] max-w-[calc(100vw-24px)] flex-col gap-2.5 overflow-hidden">
      {/* Tactical Layer Toggles */}
      <section className="hud-panel rounded-[14px] p-2.5">
        <div className="flex items-center justify-between px-1 pb-2">
          <button
            type="button"
            onClick={() => setLayersOpen((v) => !v)}
            className="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            <Layers className="h-3.5 w-3.5 text-[var(--accent)]" />
            <span>{copy.layers}</span>
          </button>
          <button
            type="button"
            onClick={onToggleCollapse}
            className="hud-btn rounded p-1 text-[var(--text-muted)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)]"
            aria-label="Collapse Left Panel"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
        </div>

        {layersOpen && (
          <div className="grid grid-cols-1 gap-1">
            {layerItems.map((item) => {
              const on = layers[item.key];
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => onToggleLayer(item.key)}
                  className={`hud-btn flex items-center justify-between rounded-[6px] border px-2.5 py-1.5 text-left text-[12px] ${
                    on
                      ? "border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--text-primary)]"
                      : "border-transparent bg-transparent text-[var(--text-muted)] hover:bg-[var(--bg-card)] hover:text-[var(--text-secondary)]"
                  }`}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <span style={{ color: on ? item.dotColor : "currentColor" }}>
                      {item.icon}
                    </span>
                    <span className="truncate">{item.label}</span>
                  </span>
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{
                      backgroundColor: on ? item.dotColor : "oklch(1 0 0 / 0.16)",
                      boxShadow: on ? `0 0 8px ${item.dotColor}` : "none",
                    }}
                  />
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* Live Intelligence Feed */}
      <section className="hud-panel flex min-h-0 flex-1 flex-col rounded-[14px] p-2.5 overflow-hidden">
        <div className="flex items-center justify-between px-1 pb-2">
          <div className="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-[var(--text-secondary)]">
            <Zap className="h-3.5 w-3.5 text-[var(--accent)]" />
            <span>{copy.liveFeed}</span>
          </div>
          <span className="font-mono text-[10.5px] text-[var(--text-muted)] tabular">
            {feedItems.length}
          </span>
        </div>

        {/* Category Filter Tabs */}
        <div className="mb-2 grid grid-cols-5 gap-1 rounded-[8px] bg-[oklch(0_0_0/0.25)] p-0.5">
          {(
            [
              ["all", copy.tabAll],
              ["quakes", copy.tabQuakes],
              ["satellites", copy.tabSatellites],
              ["events", copy.tabEvents],
              ["hubs", copy.tabHubs],
            ] as Array<[FeedTab, string]>
          ).map(([tab, label]) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`hud-btn rounded-[6px] py-1 text-[11px] font-medium ${
                activeTab === tab
                  ? "bg-[var(--accent)] text-[var(--accent-fg)]"
                  : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Scrollable Event Rows */}
        <div className="hud-scroll flex-1 space-y-1.5 overflow-y-auto pr-0.5">
          {feedItems.map((item) => {
            const active = isTargetSelected(item.target);
            return (
              <button
                key={item.uid}
                type="button"
                onClick={() => onSelectTarget(item.target, true)}
                className={`hud-card hud-card-interactive hud-btn flex w-full items-start gap-2.5 rounded-[7px] px-2.5 py-2 text-left ${
                  active
                    ? "!border-[var(--accent-border)] !bg-[var(--accent-soft)]"
                    : ""
                }`}
              >
                <span
                  className="mt-0.5 inline-flex min-w-[40px] justify-center rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-[0.04em] tabular"
                  style={{
                    color: item.badgeColor,
                    backgroundColor: "oklch(0 0 0 / 0.34)",
                    border: `1px solid color-mix(in oklch, ${item.badgeColor} 40%, transparent)`,
                  }}
                >
                  {item.badge}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] font-medium leading-[1.35] text-[var(--text-primary)]">
                    {item.title}
                  </div>
                  <div className="mt-0.5 truncate font-mono text-[10.5px] text-[var(--text-muted)] tabular">
                    {item.meta}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </section>
    </aside>
  );
}
