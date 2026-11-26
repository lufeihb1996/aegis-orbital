"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FALLBACK_EVENTS,
  FALLBACK_INTEL,
  FALLBACK_QUAKES,
  FALLBACK_SATELLITES,
  FALLBACK_SPACE_WEATHER,
} from "@/lib/fallback-data";
import { getSubsolarPoint } from "@/lib/geo";
import { propagateSatellite } from "@/lib/orbital";
import { playRadarPing, playTacticalClick, playTargetLock } from "@/lib/sound";
import { CAMERA_PRESETS, WORLD_HUBS } from "@/lib/world-data";
import type {
  CameraTarget,
  CoordinateWeather,
  IntelFeedData,
  LayerKey,
  LayerVisibility,
  Locale,
  NaturalEvent,
  QuakeEvent,
  SatelliteLiveState,
  SatelliteTLE,
  SelectedTarget,
  SpaceWeatherData,
  ThemeId,
} from "@/types/telemetry";
import { BottomControlDock } from "./BottomControlDock";
import { CommandPalette } from "./CommandPalette";
import { GlobeCanvas } from "./GlobeCanvas";
import { LeftIntelPanel } from "./LeftIntelPanel";
import { RightOpsPanel } from "./RightOpsPanel";
import { TopTelemetryBar } from "./TopTelemetryBar";

const THEME_ORDER: ThemeId[] = ["cyan", "phosphor", "amber"];

export function CommandCenter() {
  const [theme, setTheme] = useState<ThemeId>("cyan");
  const [locale, setLocale] = useState<Locale>("zh");
  const [zenMode, setZenMode] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [crtEnabled, setCrtEnabled] = useState(false);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const [autoRotate, setAutoRotate] = useState(true);
  const [autoPatrol, setAutoPatrol] = useState(false);
  const [lockedSatId, setLockedSatId] = useState<string | null>(null);
  const [homeBaseId, setHomeBaseId] = useState("beijing");

  const [layers, setLayers] = useState<LayerVisibility>({
    quakes: true,
    satellites: true,
    events: true,
    cables: true,
    hubs: true,
    terminator: true,
    clouds: true,
    borders: true,
  });

  // Live Telemetry Feeds (seeded with curated fallback for instant 0ms render)
  const [quakes, setQuakes] = useState<QuakeEvent[]>(FALLBACK_QUAKES);
  const [satTles, setSatTles] = useState<SatelliteTLE[]>(FALLBACK_SATELLITES);
  const [satellites, setSatellites] = useState<SatelliteLiveState[]>([]);
  const [events, setEvents] = useState<NaturalEvent[]>(FALLBACK_EVENTS);
  const [spaceWeather, setSpaceWeather] = useState<SpaceWeatherData>(
    FALLBACK_SPACE_WEATHER
  );
  const [intel, setIntel] = useState<IntelFeedData>(FALLBACK_INTEL);
  const [isLive, setIsLive] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);

  const [selectedTarget, setSelectedTarget] = useState<SelectedTarget | null>({
    kind: "hub",
    data: WORLD_HUBS[0],
  });
  const [cameraTarget, setCameraTarget] = useState<CameraTarget | null>(null);
  const [targetWeather, setTargetWeather] = useState<CoordinateWeather | null>(
    null
  );
  const [weatherLoading, setWeatherLoading] = useState(false);

  const flyNonce = useRef(1);

  // Instant smear-free tactical theme switcher
  const applyTheme = useCallback((next: ThemeId) => {
    const root = document.documentElement;
    root.classList.add("theme-switching");
    root.setAttribute("data-theme", next);
    void root.offsetHeight;
    setTheme(next);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        root.classList.remove("theme-switching");
      });
    });
  }, []);

  const cycleTheme = useCallback(() => {
    const idx = THEME_ORDER.indexOf(theme);
    const next = THEME_ORDER[(idx + 1) % THEME_ORDER.length];
    applyTheme(next);
    playTacticalClick(soundEnabled);
  }, [theme, applyTheme, soundEnabled]);

  // Fetch all real-time feeds concurrently
  const syncAllTelemetry = useCallback(async () => {
    setIsSyncing(true);
    try {
      const [qRes, sRes, eRes, swRes, iRes] = await Promise.allSettled([
        fetch("/api/quakes").then((r) => r.json()),
        fetch("/api/satellites").then((r) => r.json()),
        fetch("/api/events").then((r) => r.json()),
        fetch("/api/space-weather").then((r) => r.json()),
        fetch("/api/intel").then((r) => r.json()),
      ]);

      let anyLive = false;

      if (qRes.status === "fulfilled" && Array.isArray(qRes.value?.quakes)) {
        setQuakes(qRes.value.quakes);
        if (qRes.value.source === "live") anyLive = true;
      }
      if (
        sRes.status === "fulfilled" &&
        Array.isArray(sRes.value?.satellites)
      ) {
        setSatTles(sRes.value.satellites);
        if (sRes.value.source === "live") anyLive = true;
      }
      if (eRes.status === "fulfilled" && Array.isArray(eRes.value?.events)) {
        setEvents(eRes.value.events);
        if (eRes.value.source === "live") anyLive = true;
      }
      if (swRes.status === "fulfilled" && swRes.value?.kpIndex !== undefined) {
        setSpaceWeather(swRes.value);
        if (swRes.value.source === "live") anyLive = true;
      }
      if (iRes.status === "fulfilled" && Array.isArray(iRes.value?.markets)) {
        setIntel(iRes.value);
        if (iRes.value.source === "live" || iRes.value.source === "partial") {
          anyLive = true;
        }
      }

      setIsLive(anyLive);
    } finally {
      setIsSyncing(false);
    }
  }, []);

  useEffect(() => {
    void syncAllTelemetry();
    const interval = setInterval(() => void syncAllTelemetry(), 90_000);
    return () => clearInterval(interval);
  }, [syncAllTelemetry]);

  // Real-time SGP4 satellite propagation (every 1.5s)
  useEffect(() => {
    const computePositions = () => {
      const now = new Date();
      const live: SatelliteLiveState[] = [];
      for (const tle of satTles) {
        const state = propagateSatellite(tle, now, true);
        if (state) live.push(state);
      }
      setSatellites(live);
    };
    computePositions();
    const timer = setInterval(computePositions, 1500);
    return () => clearInterval(timer);
  }, [satTles]);

  // Extract coordinates of currently selected target for live Open-Meteo surface weather
  const selectedCoordsKey = useMemo(() => {
    if (!selectedTarget) return null;
    if (selectedTarget.kind === "quake") {
      return `${selectedTarget.data.lat.toFixed(2)},${selectedTarget.data.lon.toFixed(2)}`;
    }
    if (selectedTarget.kind === "event") {
      return `${selectedTarget.data.lat.toFixed(2)},${selectedTarget.data.lon.toFixed(2)}`;
    }
    if (selectedTarget.kind === "hub") {
      return `${selectedTarget.data.lat.toFixed(2)},${selectedTarget.data.lon.toFixed(2)}`;
    }
    if (selectedTarget.kind === "probe") {
      return `${selectedTarget.lat.toFixed(2)},${selectedTarget.lon.toFixed(2)}`;
    }
    if (selectedTarget.kind === "satellite") {
      const sat = satellites.find((s) => s.id === selectedTarget.id);
      if (sat) {
        // Bucket sub-satellite weather lookup to ~1 deg grid so it doesn't spam Open-Meteo every 1.5s
        return `${Math.round(sat.lat)},${Math.round(sat.lon)}`;
      }
    }
    return null;
  }, [selectedTarget, satellites]);

  useEffect(() => {
    if (!selectedCoordsKey) {
      setTargetWeather(null);
      return;
    }
    const [latStr, lonStr] = selectedCoordsKey.split(",");
    let cancelled = false;
    setWeatherLoading(true);

    fetch(`/api/weather?lat=${latStr}&lon=${lonStr}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: CoordinateWeather | null) => {
        if (!cancelled) {
          setTargetWeather(data);
        }
      })
      .catch(() => {
        if (!cancelled) setTargetWeather(null);
      })
      .finally(() => {
        if (!cancelled) setWeatherLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedCoordsKey]);

  // Select target + fly camera
  const handleSelectTarget = useCallback(
    (target: SelectedTarget, shouldFly = true) => {
      setSelectedTarget(target);
      setRightCollapsed(false);

      if (target.kind === "satellite") {
        playTargetLock(soundEnabled);
        const sat = satellites.find((s) => s.id === target.id);
        if (sat && shouldFly) {
          setAutoRotate(false);
          setCameraTarget({
            lat: sat.lat,
            lon: sat.lon,
            distance: 2.15,
            nonce: ++flyNonce.current,
          });
        }
      } else {
        setLockedSatId(null);
        if (target.kind === "probe") {
          playRadarPing(soundEnabled);
        } else {
          playTargetLock(soundEnabled);
        }

        if (shouldFly) {
          let lat = 0;
          let lon = 0;
          let distance = 2.0;
          if (target.kind === "quake") {
            lat = target.data.lat;
            lon = target.data.lon;
            distance = 1.92;
          } else if (target.kind === "event") {
            lat = target.data.lat;
            lon = target.data.lon;
            distance = 1.95;
          } else if (target.kind === "hub") {
            lat = target.data.lat;
            lon = target.data.lon;
            distance = 2.05;
          } else if (target.kind === "probe") {
            lat = target.lat;
            lon = target.lon;
            distance = 2.15;
          }
          setAutoRotate(false);
          setCameraTarget({ lat, lon, distance, nonce: ++flyNonce.current });
        }
      }
    },
    [satellites, soundEnabled]
  );

  // Camera presets
  const handleJumpPreset = useCallback(
    (presetId: "global" | "terminator" | "apac" | "europe" | "americas") => {
      setLockedSatId(null);
      setAutoPatrol(false);

      if (presetId === "terminator") {
        const sp = getSubsolarPoint();
        let lon = sp.lon - 56;
        if (lon < -180) lon += 360;
        setAutoRotate(false);
        setLayers((prev) => ({ ...prev, terminator: true }));
        setCameraTarget({
          lat: 26,
          lon,
          distance: 2.85,
          nonce: ++flyNonce.current,
        });
        playTacticalClick(soundEnabled);
        return;
      }

      const p = CAMERA_PRESETS.find((c) => c.id === presetId);
      if (!p) return;
      if (presetId === "global") setAutoRotate(true);
      else setAutoRotate(false);
      setCameraTarget({
        lat: p.lat,
        lon: p.lon,
        distance: p.distance,
        nonce: ++flyNonce.current,
      });
      playTacticalClick(soundEnabled);
    },
    [soundEnabled]
  );

  // Lock camera onto ISS or Tiangong CSS
  const handleLockStation = useCallback(
    (satId: "iss" | "css") => {
      setAutoPatrol(false);
      if (lockedSatId === satId) {
        setLockedSatId(null);
        playTacticalClick(soundEnabled);
        return;
      }
      setLockedSatId(satId);
      setAutoRotate(false);
      setSelectedTarget({ kind: "satellite", id: satId });
      setRightCollapsed(false);
      const sat = satellites.find((s) => s.id === satId);
      if (sat) {
        setCameraTarget({
          lat: sat.lat,
          lon: sat.lon,
          distance: 1.95,
          nonce: ++flyNonce.current,
        });
      }
      playTargetLock(soundEnabled);
    },
    [lockedSatId, satellites, soundEnabled]
  );

  // Auto-Patrol Cinematic Tour (cycles major live quakes, ISS, Tiangong, events & hubs every 8s)
  useEffect(() => {
    if (!autoPatrol) return;
    let step = 0;

    const runStop = () => {
      const stops: SelectedTarget[] = [];
      if (satellites.some((s) => s.id === "css")) {
        stops.push({ kind: "satellite", id: "css" });
      }
      if (quakes[0]) stops.push({ kind: "quake", data: quakes[0] });
      if (satellites.some((s) => s.id === "iss")) {
        stops.push({ kind: "satellite", id: "iss" });
      }
      if (events[0]) stops.push({ kind: "event", data: events[0] });
      if (quakes[1]) stops.push({ kind: "quake", data: quakes[1] });
      stops.push({ kind: "hub", data: WORLD_HUBS[2] }); // Tokyo
      stops.push({ kind: "hub", data: WORLD_HUBS[6] }); // London

      const pick = stops[step % stops.length];
      step += 1;
      if (pick) handleSelectTarget(pick, true);
    };

    runStop();
    const timer = setInterval(runStop, 8500);
    return () => clearInterval(timer);
  }, [autoPatrol, quakes, events, satellites, handleSelectTarget]);

  // Global Keyboard Shortcuts (⌘K / Ctrl+K, Space, H, T, L)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInput =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT");

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((v) => !v);
        return;
      }
      if (isInput) return;

      if (e.key === "/") {
        e.preventDefault();
        setSearchOpen(true);
      } else if (e.code === "Space") {
        e.preventDefault();
        setLockedSatId(null);
        setAutoRotate((v) => !v);
      } else if (e.key.toLowerCase() === "h") {
        setZenMode((v) => !v);
      } else if (e.key.toLowerCase() === "t") {
        cycleTheme();
      } else if (e.key.toLowerCase() === "l") {
        setLocale((v) => (v === "zh" ? "en" : "zh"));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cycleTheme]);

  const toggleLayer = useCallback(
    (key: LayerKey) => {
      setLayers((prev) => ({ ...prev, [key]: !prev[key] }));
      playTacticalClick(soundEnabled);
    },
    [soundEnabled]
  );

  return (
    <main className="orbital-backdrop relative flex h-screen w-screen flex-col overflow-hidden">
      {/* Full-Bleed Interactive 3D WebGL Earth */}
      <div className="absolute inset-0 z-0">
        <GlobeCanvas
          theme={theme}
          locale={locale}
          layers={layers}
          quakes={quakes}
          satellites={satellites}
          events={events}
          selectedTarget={selectedTarget}
          lockedSatId={lockedSatId}
          autoRotate={autoRotate}
          cameraTarget={cameraTarget}
          onSelectTarget={(target) => handleSelectTarget(target, target.kind !== "probe")}
          onUserInteract={() => {
            setAutoPatrol(false);
            setLockedSatId(null);
          }}
        />
      </div>

      {/* Subtle Optional CRT Scanline Texture */}
      {crtEnabled && (
        <div
          className="crt-overlay pointer-events-none absolute inset-0 z-10 opacity-45"
          aria-hidden="true"
        />
      )}

      {/* Subtle Cinematic Edge Vignette */}
      <div
        className="pointer-events-none absolute inset-0 z-10"
        style={{
          background:
            "radial-gradient(circle at 50% 50%, transparent 56%, oklch(0.06 0.015 248 / 0.58) 100%)",
        }}
        aria-hidden="true"
      />

      {/* Top HUD Bar */}
      <TopTelemetryBar
        theme={theme}
        locale={locale}
        zenMode={zenMode}
        soundEnabled={soundEnabled}
        crtEnabled={crtEnabled}
        isLive={isLive}
        isSyncing={isSyncing}
        spaceWeather={spaceWeather}
        quakeCount={quakes.length}
        satCount={satellites.length}
        eventCount={events.length}
        onCycleTheme={cycleTheme}
        onToggleLocale={() => {
          setLocale((v) => (v === "zh" ? "en" : "zh"));
          playTacticalClick(soundEnabled);
        }}
        onToggleZen={() => {
          setZenMode((v) => !v);
          playTacticalClick(soundEnabled);
        }}
        onToggleSound={() => setSoundEnabled((v) => !v)}
        onToggleCrt={() => {
          setCrtEnabled((v) => !v);
          playTacticalClick(soundEnabled);
        }}
        onOpenSearch={() => setSearchOpen(true)}
        onRefresh={() => {
          void syncAllTelemetry();
          playRadarPing(soundEnabled);
        }}
      />

      {/* Side Tactical HUD Panels (Hidden cleanly in Zen Desk Mode) */}
      <div className="pointer-events-none relative z-20 flex min-h-0 flex-1 items-stretch justify-between gap-3 px-3 pb-2 sm:px-4">
        {!zenMode ? (
          <>
            <LeftIntelPanel
              locale={locale}
              collapsed={leftCollapsed}
              layers={layers}
              quakes={quakes}
              satellites={satellites}
              events={events}
              selectedTarget={selectedTarget}
              onToggleCollapse={() => setLeftCollapsed((v) => !v)}
              onToggleLayer={toggleLayer}
              onSelectTarget={(target, fly) => {
                setAutoPatrol(false);
                handleSelectTarget(target, fly ?? true);
              }}
            />

            <RightOpsPanel
              locale={locale}
              collapsed={rightCollapsed}
              selectedTarget={selectedTarget}
              lockedSatId={lockedSatId}
              satellites={satellites}
              quakes={quakes}
              targetWeather={targetWeather}
              weatherLoading={weatherLoading}
              spaceWeather={spaceWeather}
              intel={intel}
              homeBaseId={homeBaseId}
              onChangeHomeBase={setHomeBaseId}
              onToggleCollapse={() => setRightCollapsed((v) => !v)}
              onToggleLockSat={(id) => {
                setLockedSatId(id);
                if (id) setAutoRotate(false);
                playTargetLock(soundEnabled);
              }}
            />
          </>
        ) : (
          <div className="flex-1" />
        )}
      </div>

      {/* Bottom Sector & Patrol Control Dock */}
      <BottomControlDock
        locale={locale}
        autoRotate={autoRotate}
        autoPatrol={autoPatrol}
        lockedSatId={lockedSatId}
        onJumpPreset={handleJumpPreset}
        onLockStation={handleLockStation}
        onToggleRotate={() => {
          setLockedSatId(null);
          setAutoRotate((v) => !v);
          playTacticalClick(soundEnabled);
        }}
        onTogglePatrol={() => {
          setAutoPatrol((v) => !v);
          playTacticalClick(soundEnabled);
        }}
      />

      {/* ⌘K Global Quick-Jump Command Palette */}
      <CommandPalette
        open={searchOpen}
        locale={locale}
        quakes={quakes}
        satellites={satellites}
        events={events}
        onClose={() => setSearchOpen(false)}
        onSelect={(target) => {
          setAutoPatrol(false);
          handleSelectTarget(target, true);
        }}
      />
    </main>
  );
}
