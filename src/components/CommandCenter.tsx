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
import { predictNextPasses, propagateSatellite } from "@/lib/orbital";
import { playRadarPing, playTacticalClick, playTargetLock } from "@/lib/sound";
import { CAMERA_PRESETS, WORLD_HUBS } from "@/lib/world-data";
import type {
  CameraTarget,
  CoordinateWeather,
  FlightTrack,
  IntelFeedData,
  LayerKey,
  LayerVisibility,
  Locale,
  MeasurePoint,
  NaturalEvent,
  QuakeEvent,
  SatelliteLiveState,
  SatellitePassPrediction,
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
const TWELVE_HOURS_MS = 12 * 3600 * 1000;

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

  // Time Machine & Tactical Measure State
  const [timeOffsetMs, setTimeOffsetMs] = useState(0);
  const [timeLapsePlaying, setTimeLapsePlaying] = useState(false);
  const [measureMode, setMeasureMode] = useState(false);
  const [measurePoints, setMeasurePoints] = useState<MeasurePoint[]>([]);

  const [layers, setLayers] = useState<LayerVisibility>({
    quakes: true,
    satellites: true,
    events: true,
    flights: true,
    aurora: true,
    wind: true,
    cables: true,
    hubs: true,
    terminator: true,
    clouds: true,
    borders: true,
  });

  // Live Telemetry Feeds
  const [quakes, setQuakes] = useState<QuakeEvent[]>(FALLBACK_QUAKES);
  const [satTles, setSatTles] = useState<SatelliteTLE[]>(FALLBACK_SATELLITES);
  const [satellites, setSatellites] = useState<SatelliteLiveState[]>([]);
  const [flights, setFlights] = useState<FlightTrack[]>([]);
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
  const timeOffsetRef = useRef(0);
  timeOffsetRef.current = timeOffsetMs;

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
      const [qRes, sRes, fRes, eRes, swRes, iRes] = await Promise.allSettled([
        fetch("/api/quakes").then((r) => r.json()),
        fetch("/api/satellites").then((r) => r.json()),
        fetch("/api/flights").then((r) => r.json()),
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
      if (fRes.status === "fulfilled" && Array.isArray(fRes.value?.flights)) {
        setFlights(fRes.value.flights);
        if (fRes.value.source === "live") anyLive = true;
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

  // 600x Timelapse Clock Engine (advances 10 simulated minutes every second)
  useEffect(() => {
    if (!timeLapsePlaying) return;
    const stepMs = 150;
    const simAdvancePerTick = 600 * stepMs; // 600x speed = 90s simulated per 150ms
    const timer = setInterval(() => {
      setTimeOffsetMs((prev) => {
        const next = prev + simAdvancePerTick;
        return next > TWELVE_HOURS_MS ? -TWELVE_HOURS_MS : next;
      });
    }, stepMs);
    return () => clearInterval(timer);
  }, [timeLapsePlaying]);

  // Real-time SGP4 satellite propagation (synced to Time Machine offset!)
  useEffect(() => {
    const computePositions = () => {
      const simDate = new Date(Date.now() + timeOffsetRef.current);
      const live: SatelliteLiveState[] = [];
      for (const tle of satTles) {
        const state = propagateSatellite(tle, simDate, true);
        if (state) live.push(state);
      }
      setSatellites(live);
    };
    computePositions();
    const timer = setInterval(computePositions, timeLapsePlaying ? 260 : 1400);
    return () => clearInterval(timer);
  }, [satTles, timeOffsetMs, timeLapsePlaying]);

  // Predict next 24h overhead passes for CSS & ISS over selected Home Base City
  const upcomingPasses = useMemo(() => {
    const base = WORLD_HUBS.find((h) => h.id === homeBaseId) ?? WORLD_HUBS[0];
    return predictNextPasses(satTles, base.lat, base.lon, new Date());
  }, [satTles, homeBaseId]);

  // Extract coordinates of currently selected target for live Open-Meteo surface weather
  const selectedCoordsKey = useMemo(() => {
    if (!selectedTarget) return null;
    if (selectedTarget.kind === "quake") {
      return `${selectedTarget.data.lat.toFixed(2)},${selectedTarget.data.lon.toFixed(2)}`;
    }
    if (selectedTarget.kind === "event") {
      return `${selectedTarget.data.lat.toFixed(2)},${selectedTarget.data.lon.toFixed(2)}`;
    }
    if (selectedTarget.kind === "flight") {
      return `${selectedTarget.data.lat.toFixed(1)},${selectedTarget.data.lon.toFixed(1)}`;
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
          } else if (target.kind === "flight") {
            lat = target.data.lat;
            lon = target.data.lon;
            distance = 1.9;
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

  // Jump Time Machine directly to an upcoming space station pass over the Home Base City!
  const handlePreviewPass = useCallback(
    (pass: SatellitePassPrediction) => {
      const base = WORLD_HUBS.find((h) => h.id === homeBaseId) ?? WORLD_HUBS[0];
      setTimeLapsePlaying(false);
      setAutoPatrol(false);
      setAutoRotate(false);
      setTimeOffsetMs(pass.peakTimeMs - Date.now());
      setSelectedTarget({ kind: "satellite", id: pass.satId });
      setLockedSatId(null);
      setCameraTarget({
        lat: base.lat,
        lon: base.lon,
        distance: 1.95,
        nonce: ++flyNonce.current,
      });
      playTargetLock(soundEnabled);
    },
    [homeBaseId, soundEnabled]
  );

  // Add a tactical measurement point (resets to new pair when 2 already pinned)
  const handleAddMeasurePoint = useCallback(
    (pt: MeasurePoint) => {
      setMeasurePoints((prev) => (prev.length >= 2 ? [pt] : [...prev, pt]));
      playRadarPing(soundEnabled);
    },
    [soundEnabled]
  );

  // Camera presets
  const handleJumpPreset = useCallback(
    (presetId: "global" | "terminator" | "apac" | "europe" | "americas") => {
      setLockedSatId(null);
      setAutoPatrol(false);

      if (presetId === "terminator") {
        const sp = getSubsolarPoint(new Date(Date.now() + timeOffsetRef.current));
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

  // Auto-Patrol Cinematic Tour
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
      stops.push({ kind: "hub", data: WORLD_HUBS[2] });
      stops.push({ kind: "hub", data: WORLD_HUBS[6] });

      const pick = stops[step % stops.length];
      step += 1;
      if (pick) handleSelectTarget(pick, true);
    };

    runStop();
    const timer = setInterval(runStop, 8500);
    return () => clearInterval(timer);
  }, [autoPatrol, quakes, events, satellites, handleSelectTarget]);

  // Global Keyboard Shortcuts
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
      } else if (e.key === "Escape" && (measureMode || measurePoints.length > 0)) {
        setMeasureMode(false);
        setMeasurePoints([]);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cycleTheme, measureMode, measurePoints.length]);

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
          flights={flights}
          events={events}
          kpIndex={spaceWeather.kpIndex}
          timeOffsetMs={timeOffsetMs}
          measureMode={measureMode}
          measurePoints={measurePoints}
          selectedTarget={selectedTarget}
          lockedSatId={lockedSatId}
          autoRotate={autoRotate}
          cameraTarget={cameraTarget}
          onSelectTarget={(target) =>
            handleSelectTarget(target, target.kind !== "probe")
          }
          onAddMeasurePoint={handleAddMeasurePoint}
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
        flightCount={flights.length}
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

      {/* Side Tactical HUD Panels */}
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
              upcomingPasses={upcomingPasses}
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
              onPreviewPass={handlePreviewPass}
            />
          </>
        ) : (
          <div className="flex-1" />
        )}
      </div>

      {/* Bottom Time Machine, Measure HUD & Sector Dock */}
      <BottomControlDock
        locale={locale}
        autoRotate={autoRotate}
        autoPatrol={autoPatrol}
        lockedSatId={lockedSatId}
        timeOffsetMs={timeOffsetMs}
        timeLapsePlaying={timeLapsePlaying}
        measureMode={measureMode}
        measurePoints={measurePoints}
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
        onChangeTimeOffset={(ms) => {
          setTimeLapsePlaying(false);
          setTimeOffsetMs(ms);
        }}
        onToggleTimeLapse={() => {
          setTimeLapsePlaying((v) => !v);
          playTacticalClick(soundEnabled);
        }}
        onResetLiveTime={() => {
          setTimeLapsePlaying(false);
          setTimeOffsetMs(0);
          playTacticalClick(soundEnabled);
        }}
        onToggleMeasureMode={() => {
          setMeasureMode((v) => !v);
          playTacticalClick(soundEnabled);
        }}
        onClearMeasure={() => {
          setMeasurePoints([]);
          setMeasureMode(false);
          playTacticalClick(soundEnabled);
        }}
      />

      {/* ⌘K Global Quick-Jump Command Palette */}
      <CommandPalette
        open={searchOpen}
        locale={locale}
        quakes={quakes}
        satellites={satellites}
        flights={flights}
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
