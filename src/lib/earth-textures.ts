import * as THREE from "three";
import { feature, mesh } from "topojson-client";
import countriesAtlas from "world-atlas/countries-110m.json";
import { latLonToVector3Tuple } from "./geo";
import { NIGHT_CITY_LIGHTS } from "./world-data";

type Position = [number, number] | number[];
type GeoPolygon = { type: "Polygon"; coordinates: Position[][] };
type GeoMultiPolygon = { type: "MultiPolygon"; coordinates: Position[][][] };
type SimpleGeometry = GeoPolygon | GeoMultiPolygon | { type: string };
interface SimpleFeatureCollection {
  type: "FeatureCollection";
  features: Array<{ geometry?: SimpleGeometry | null }>;
}
interface SimpleMultiLine {
  type: string;
  coordinates: Position[][];
}

type WorldTopologyArg = Parameters<typeof feature>[0];
type WorldObjectArg = Parameters<typeof feature>[1];

const worldTopo = countriesAtlas as unknown as WorldTopologyArg & {
  objects: {
    countries: WorldObjectArg;
    land: WorldObjectArg;
  };
};

function projectEquirect(
  lon: number,
  lat: number,
  width: number,
  height: number
): [number, number] {
  const x = ((lon + 180) / 360) * width;
  const y = ((90 - lat) / 180) * height;
  return [x, y];
}

function traceRing(
  ctx: CanvasRenderingContext2D,
  ring: Position[],
  width: number,
  height: number
) {
  if (ring.length < 2) return;
  let prevLon = ring[0][0];
  const [sx, sy] = projectEquirect(ring[0][0], ring[0][1], width, height);
  ctx.moveTo(sx, sy);
  for (let i = 1; i < ring.length; i++) {
    const lon = ring[i][0];
    const lat = ring[i][1];
    const [x, y] = projectEquirect(lon, lat, width, height);
    // Avoid antimeridian horizontal wrap streaks
    if (Math.abs(lon - prevLon) > 180) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
    prevLon = lon;
  }
}

function traceGeometry(
  ctx: CanvasRenderingContext2D,
  geom: SimpleGeometry,
  width: number,
  height: number
) {
  if (geom.type === "Polygon" && "coordinates" in geom) {
    for (const ring of (geom as GeoPolygon).coordinates) {
      traceRing(ctx, ring, width, height);
    }
  } else if (geom.type === "MultiPolygon" && "coordinates" in geom) {
    for (const poly of (geom as GeoMultiPolygon).coordinates) {
      for (const ring of poly) {
        traceRing(ctx, ring, width, height);
      }
    }
  }
}

export interface EarthTextureBundle {
  dayTexture: THREE.CanvasTexture;
  nightTexture: THREE.CanvasTexture;
  specTexture: THREE.CanvasTexture;
  dispose: () => void;
}

/**
 * Generates deterministic high-resolution tactical Day, Night (City Lights),
 * and Ocean Specular maps straight from Natural Earth vector topology.
 * Zero external image fetches -> 100% reliable on Vercel & offline.
 */
export function createProceduralEarthTextures(): EarthTextureBundle {
  const width = 2048;
  const height = 1024;

  const countries = feature(
    worldTopo,
    worldTopo.objects.countries
  ) as unknown as SimpleFeatureCollection;

  // 1. DAY TEXTURE (Tactical satellite dark bathymetry + topographic land)
  const dayCanvas = document.createElement("canvas");
  dayCanvas.width = width;
  dayCanvas.height = height;
  const dCtx = dayCanvas.getContext("2d")!;

  // Deep marine ocean gradient (slightly lighter near equator, abyssal near poles)
  const oceanGrad = dCtx.createLinearGradient(0, 0, 0, height);
  oceanGrad.addColorStop(0.0, "#0b1a2e");
  oceanGrad.addColorStop(0.22, "#0a2138");
  oceanGrad.addColorStop(0.5, "#0d2945");
  oceanGrad.addColorStop(0.78, "#0a2138");
  oceanGrad.addColorStop(1.0, "#0b1a2e");
  dCtx.fillStyle = oceanGrad;
  dCtx.fillRect(0, 0, width, height);

  // Subtle bathymetric noise patches in ocean
  dCtx.fillStyle = "rgba(56, 189, 248, 0.025)";
  for (let i = 0; i < 180; i++) {
    const rx = ((Math.sin(i * 12.9898) * 43758.5453) % 1 + 1) % 1;
    const ry = ((Math.sin(i * 78.233) * 19341.123) % 1 + 1) % 1;
    const rad = 18 + (i % 55);
    dCtx.beginPath();
    dCtx.arc(rx * width, ry * height, rad, 0, Math.PI * 2);
    dCtx.fill();
  }

  // Subtle tactical lat/lon graticule every 15 degrees
  dCtx.strokeStyle = "rgba(125, 211, 252, 0.08)";
  dCtx.lineWidth = 1;
  for (let lon = -180; lon <= 180; lon += 15) {
    const x = ((lon + 180) / 360) * width;
    dCtx.beginPath();
    dCtx.moveTo(x, 0);
    dCtx.lineTo(x, height);
    dCtx.stroke();
  }
  for (let lat = -75; lat <= 75; lat += 15) {
    const y = ((90 - lat) / 180) * height;
    dCtx.beginPath();
    dCtx.moveTo(0, y);
    dCtx.lineTo(width, y);
    dCtx.stroke();
  }
  // Highlight equator slightly
  dCtx.strokeStyle = "rgba(125, 211, 252, 0.16)";
  dCtx.beginPath();
  dCtx.moveTo(0, height / 2);
  dCtx.lineTo(width, height / 2);
  dCtx.stroke();

  // Draw landmasses with rich sculpted tactical elevation fill
  const landGrad = dCtx.createLinearGradient(0, 0, 0, height);
  landGrad.addColorStop(0.0, "#3b5266"); // Arctic tundra
  landGrad.addColorStop(0.18, "#253e4d");
  landGrad.addColorStop(0.42, "#1f3c42"); // Temperate / lush dark teal-slate
  landGrad.addColorStop(0.55, "#284044");
  landGrad.addColorStop(0.82, "#243b4a");
  landGrad.addColorStop(1.0, "#465e73"); // Antarctic ice shelf

  dCtx.save();
  dCtx.beginPath();
  for (const f of countries.features) {
    if (f.geometry) traceGeometry(dCtx, f.geometry, width, height);
  }
  dCtx.fillStyle = landGrad;
  dCtx.fill();

  // Clip to landmass and add subtle terrain contour texture & dots
  dCtx.clip();
  for (let i = 0; i < 900; i++) {
    const h1 = ((Math.sin(i * 91.7 + 1.3) * 43758.5453) % 1 + 1) % 1;
    const h2 = ((Math.sin(i * 47.3 + 5.1) * 28461.127) % 1 + 1) % 1;
    const r = 6 + (i % 28);
    dCtx.fillStyle =
      i % 2 === 0 ? "rgba(148, 210, 224, 0.045)" : "rgba(7, 16, 26, 0.12)";
    dCtx.beginPath();
    dCtx.arc(h1 * width, h2 * height, r, 0, Math.PI * 2);
    dCtx.fill();
  }

  // Country interior subtle hairline borders
  dCtx.strokeStyle = "rgba(125, 211, 252, 0.2)";
  dCtx.lineWidth = 0.8;
  dCtx.stroke();
  dCtx.restore();

  // Crisp glowing coastal rim on day map
  dCtx.beginPath();
  for (const f of countries.features) {
    if (f.geometry) traceGeometry(dCtx, f.geometry, width, height);
  }
  dCtx.strokeStyle = "rgba(125, 228, 255, 0.45)";
  dCtx.lineWidth = 1.1;
  dCtx.stroke();

  // 2. NIGHT TEXTURE (Black Marble obsidian earth + glowing city constellations)
  const nightCanvas = document.createElement("canvas");
  nightCanvas.width = width;
  nightCanvas.height = height;
  const nCtx = nightCanvas.getContext("2d")!;

  nCtx.fillStyle = "#030712";
  nCtx.fillRect(0, 0, width, height);

  // Subtle dark-navy landmass silhouettes on night side
  nCtx.beginPath();
  for (const f of countries.features) {
    if (f.geometry) traceGeometry(nCtx, f.geometry, width, height);
  }
  nCtx.fillStyle = "#091322";
  nCtx.fill();
  nCtx.strokeStyle = "rgba(56, 189, 248, 0.22)";
  nCtx.lineWidth = 0.9;
  nCtx.stroke();

  // Render luminous multi-layer metropolitan city lights (NASA Black Marble vibe)
  for (let idx = 0; idx < NIGHT_CITY_LIGHTS.length; idx++) {
    const [lat, lon, intensity] = NIGHT_CITY_LIGHTS[idx];
    const [cx, cy] = projectEquirect(lon, lat, width, height);

    // Outer metropolitan atmospheric bloom
    const outerR = 10 + intensity * 16;
    const grad = nCtx.createRadialGradient(cx, cy, 0, cx, cy, outerR);
    grad.addColorStop(0, `rgba(255, 232, 168, ${0.95 * intensity})`);
    grad.addColorStop(0.28, `rgba(255, 186, 92, ${0.58 * intensity})`);
    grad.addColorStop(0.62, `rgba(245, 140, 56, ${0.18 * intensity})`);
    grad.addColorStop(1, "rgba(0, 0, 0, 0)");
    nCtx.fillStyle = grad;
    nCtx.beginPath();
    nCtx.arc(cx, cy, outerR, 0, Math.PI * 2);
    nCtx.fill();

    // Satellite urban sprawl micro-dots around each metro
    const sprawlCount = Math.round(5 + intensity * 9);
    for (let s = 0; s < sprawlCount; s++) {
      const ang = (idx * 2.399 + s * 1.618) * Math.PI * 2;
      const dist = 3 + ((s * 7 + idx * 3) % 13) * intensity;
      const sx = cx + Math.cos(ang) * dist * 1.25;
      const sy = cy + Math.sin(ang) * dist * 0.85;
      const dotR = 0.8 + ((s + idx) % 3) * 0.45;
      nCtx.fillStyle =
        s % 3 === 0
          ? `rgba(255, 245, 214, ${0.75 * intensity})`
          : `rgba(255, 198, 112, ${0.5 * intensity})`;
      nCtx.beginPath();
      nCtx.arc(sx, sy, dotR, 0, Math.PI * 2);
      nCtx.fill();
    }
  }

  // 3. SPECULAR MASK (Ocean = bright, Land = dark matte)
  const specCanvas = document.createElement("canvas");
  specCanvas.width = 1024;
  specCanvas.height = 512;
  const sCtx = specCanvas.getContext("2d")!;
  sCtx.fillStyle = "#ffffff";
  sCtx.fillRect(0, 0, 1024, 512);
  sCtx.beginPath();
  for (const f of countries.features) {
    if (f.geometry) traceGeometry(sCtx, f.geometry, 1024, 512);
  }
  sCtx.fillStyle = "#101010";
  sCtx.fill();

  const configureTex = (canvas: HTMLCanvasElement, isColor = true) => {
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.anisotropy = 8;
    tex.colorSpace = isColor ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    tex.needsUpdate = true;
    return tex;
  };

  const dayTexture = configureTex(dayCanvas, true);
  const nightTexture = configureTex(nightCanvas, true);
  const specTexture = configureTex(specCanvas, false);

  return {
    dayTexture,
    nightTexture,
    specTexture,
    dispose: () => {
      dayTexture.dispose();
      nightTexture.dispose();
      specTexture.dispose();
    },
  };
}

/**
 * Extracts crisp 3D line-segment vertices for world coastlines and borders
 * from Natural Earth 110m TopoJSON.
 */
export function buildCoastlineSegments(radius: number): Float32Array {
  const borderMesh = mesh(
    worldTopo,
    worldTopo.objects.countries as unknown as Parameters<typeof mesh>[1]
  ) as unknown as SimpleMultiLine;
  const coords: number[] = [];

  const appendLine = (line: Position[]) => {
    for (let i = 0; i < line.length - 1; i++) {
      const [lon1, lat1] = line[i];
      const [lon2, lat2] = line[i + 1];
      if (Math.abs(lon2 - lon1) > 170) continue;
      const p1 = latLonToVector3Tuple(lat1, lon1, radius);
      const p2 = latLonToVector3Tuple(lat2, lon2, radius);
      coords.push(p1[0], p1[1], p1[2], p2[0], p2[1], p2[2]);
    }
  };

  if (borderMesh.type === "MultiLineString") {
    for (const line of borderMesh.coordinates) {
      appendLine(line);
    }
  }

  return new Float32Array(coords);
}

/**
 * Generates a realistic procedural lunar surface texture (Maria basalt basins + highlands + Tycho crater rays).
 */
export function createMoonTexture(): THREE.CanvasTexture {
  const w = 512;
  const h = 256;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "#b8bcc4";
  ctx.fillRect(0, 0, w, h);

  // Dark basaltic Lunar Maria (Seas)
  const maria: Array<[number, number, number, number, number]> = [
    [0.36, 0.42, 64, 52, 0.34],
    [0.48, 0.38, 48, 42, 0.36],
    [0.57, 0.44, 44, 38, 0.32],
    [0.64, 0.52, 34, 32, 0.3],
    [0.27, 0.5, 58, 46, 0.33],
    [0.43, 0.56, 36, 30, 0.28],
    [0.72, 0.4, 28, 24, 0.25],
    [0.18, 0.36, 36, 28, 0.24],
  ];
  for (const [ux, uy, rx, ry, alpha] of maria) {
    const cx = ux * w;
    const cy = uy * h;
    const grad = ctx.createRadialGradient(cx, cy, 4, cx, cy, Math.max(rx, ry));
    grad.addColorStop(0, `rgba(58, 62, 72, ${alpha})`);
    grad.addColorStop(0.65, `rgba(74, 78, 88, ${alpha * 0.7})`);
    grad.addColorStop(1, "rgba(184, 188, 196, 0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0.2, 0, Math.PI * 2);
    ctx.fill();
  }

  // Highland craters & bright ejecta rims
  for (let i = 0; i < 420; i++) {
    const h1 = ((Math.sin(i * 127.1 + 3.1) * 43758.5453) % 1 + 1) % 1;
    const h2 = ((Math.sin(i * 269.5 + 1.7) * 29183.7131) % 1 + 1) % 1;
    const r = 1.5 + Math.pow(((i * 17) % 100) / 100, 2.4) * 16;
    const x = h1 * w;
    const y = h2 * h;
    ctx.fillStyle = i % 3 === 0 ? "rgba(70, 74, 82, 0.22)" : "rgba(235, 238, 245, 0.16)";
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();

    if (r > 5) {
      ctx.strokeStyle = "rgba(240, 244, 250, 0.24)";
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Generates a luminous radial solar corona + optical flare sprite texture.
 */
export function createSunCoronaTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const half = size / 2;

  const grad = ctx.createRadialGradient(half, half, 0, half, half, half);
  grad.addColorStop(0.0, "rgba(255, 254, 245, 1.0)");
  grad.addColorStop(0.12, "rgba(255, 242, 200, 0.92)");
  grad.addColorStop(0.28, "rgba(255, 198, 120, 0.45)");
  grad.addColorStop(0.55, "rgba(130, 196, 255, 0.14)");
  grad.addColorStop(1.0, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  // Subtle horizontal anamorphic optical streak
  const streak = ctx.createLinearGradient(0, half, size, half);
  streak.addColorStop(0, "rgba(120, 200, 255, 0)");
  streak.addColorStop(0.35, "rgba(180, 228, 255, 0.28)");
  streak.addColorStop(0.5, "rgba(255, 250, 235, 0.65)");
  streak.addColorStop(0.65, "rgba(180, 228, 255, 0.28)");
  streak.addColorStop(1, "rgba(120, 200, 255, 0)");
  ctx.fillStyle = streak;
  ctx.fillRect(0, half - 3, size, 6);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}
