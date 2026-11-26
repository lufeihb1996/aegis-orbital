"use client";

import React, { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  buildCoastlineSegments,
  createMoonTexture,
  createProceduralEarthTextures,
  createSunCoronaTexture,
} from "@/lib/earth-textures";
import {
  EARTH_RADIUS_KM,
  getSublunarPoint,
  getSubsolarPoint,
  latLonToVector3Tuple,
  vector3ToLatLon,
} from "@/lib/geo";
import { SUBMARINE_CABLES, WORLD_HUBS } from "@/lib/world-data";
import type {
  CameraTarget,
  FlightTrack,
  LayerVisibility,
  Locale,
  MeasurePoint,
  NaturalEvent,
  QuakeEvent,
  SatelliteLiveState,
  SelectedTarget,
  ThemeId,
} from "@/types/telemetry";

interface GlobeCanvasProps {
  theme: ThemeId;
  locale: Locale;
  layers: LayerVisibility;
  quakes: QuakeEvent[];
  satellites: SatelliteLiveState[];
  flights: FlightTrack[];
  events: NaturalEvent[];
  kpIndex: number;
  timeOffsetMs: number;
  measureMode: boolean;
  measurePoints: MeasurePoint[];
  selectedTarget: SelectedTarget | null;
  lockedSatId: string | null;
  autoRotate: boolean;
  cameraTarget: CameraTarget | null;
  onSelectTarget: (target: SelectedTarget) => void;
  onAddMeasurePoint: (pt: MeasurePoint) => void;
  onUserInteract?: () => void;
}

const EARTH_R = 1.0;
const UP_VEC = new THREE.Vector3(0, 0, 1);
const DEG2RAD = Math.PI / 180;

const THEME_PALETTE: Record<
  ThemeId,
  {
    accent: number;
    atmo: number;
    border: number;
    cable: number;
    packet: number;
    hub: number;
    ring: number;
    flight: number;
    wind: number;
  }
> = {
  cyan: {
    accent: 0x38e8ff,
    atmo: 0x4db8ff,
    border: 0x7ce8ff,
    cable: 0x26c6ff,
    packet: 0xc2f8ff,
    hub: 0x5ce8ff,
    ring: 0x38e8ff,
    flight: 0xffe066,
    wind: 0x7ae8ff,
  },
  phosphor: {
    accent: 0x34f599,
    atmo: 0x38d9a9,
    border: 0x5ef9ae,
    cable: 0x22c97a,
    packet: 0xb8ffdd,
    hub: 0x4ef7a4,
    ring: 0x34f599,
    flight: 0xc5ff66,
    wind: 0x6dffbe,
  },
  amber: {
    accent: 0xffb443,
    atmo: 0x62b4ff,
    border: 0xffcf7d,
    cable: 0xf59f33,
    packet: 0xffe8b8,
    hub: 0xffc66b,
    ring: 0xffb443,
    flight: 0xfff08a,
    wind: 0xffd480,
  },
};

function satAltitudeToRadius(altitudeKm: number): number {
  const ratio = altitudeKm / EARTH_RADIUS_KM;
  if (ratio <= 0.12) {
    return EARTH_R + 0.048 + ratio * 0.72;
  }
  return EARTH_R + 0.135 + Math.min(0.24, Math.log1p(ratio) * 0.15);
}

function quakeColor(mag: number): number {
  if (mag >= 6.0) return 0xff3b5c;
  if (mag >= 5.0) return 0xff7b29;
  if (mag >= 4.0) return 0xffc53d;
  return 0x38e8ff;
}

function eventColor(cat: NaturalEvent["category"]): number {
  switch (cat) {
    case "wildfires":
      return 0xff5a2c;
    case "volcanoes":
      return 0xff2e88;
    case "severeStorms":
      return 0x7c8cff;
    case "seaLakeIce":
      return 0xc7f2ff;
    default:
      return 0xffb443;
  }
}

function latLonToVec3(lat: number, lon: number, radius: number): THREE.Vector3 {
  const [x, y, z] = latLonToVector3Tuple(lat, lon, radius);
  return new THREE.Vector3(x, y, z);
}

function createTangentQuaternion(pos: THREE.Vector3): THREE.Quaternion {
  const normal = pos.clone().normalize();
  return new THREE.Quaternion().setFromUnitVectors(UP_VEC, normal);
}

function computeAircraftMatrix(
  lat: number,
  lon: number,
  headingDeg: number,
  radius: number,
  scale: number,
  outMatrix: THREE.Matrix4
) {
  const pos = latLonToVec3(lat, lon, radius);
  const up = pos.clone().normalize();
  const northApprox = new THREE.Vector3(0, 1, 0);
  const east = new THREE.Vector3().crossVectors(northApprox, up);
  if (east.lengthSq() < 1e-6) east.set(1, 0, 0);
  east.normalize();
  const north = new THREE.Vector3().crossVectors(up, east).normalize();

  const hRad = headingDeg * DEG2RAD;
  const forward = north
    .clone()
    .multiplyScalar(Math.cos(hRad))
    .add(east.clone().multiplyScalar(Math.sin(hRad)))
    .normalize();
  const right = new THREE.Vector3().crossVectors(up, forward).normalize();

  // Cone / chevron geometry points along +Y, lying flat in tangent plane along `forward`
  const basis = new THREE.Matrix4().makeBasis(right, forward, up);
  const scaleMat = new THREE.Matrix4().makeScale(scale, scale, scale);
  outMatrix.identity().makeTranslation(pos.x, pos.y, pos.z).multiply(basis).multiply(scaleMat);
}

const EARTH_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalWorld;
  varying vec3 vPositionWorld;

  void main() {
    vUv = uv;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vPositionWorld = worldPos.xyz;
    vNormalWorld = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

// Apple Maps-inspired high-contrast realistic Day / Golden Terminator / Black Marble Night shader
const EARTH_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uDayTex;
  uniform sampler2D uNightTex;
  uniform sampler2D uSpecTex;
  uniform sampler2D uBumpTex;
  uniform float uHasRealTex;
  uniform vec3 uSunDir;
  uniform vec3 uAccentColor;
  uniform float uUseTerminator;

  varying vec2 vUv;
  varying vec3 vNormalWorld;
  varying vec3 vPositionWorld;

  void main() {
    vec3 N = normalize(vNormalWorld);
    vec3 V = normalize(cameraPosition - vPositionWorld);
    vec3 L = normalize(uSunDir);

    vec3 rawDay = texture2D(uDayTex, vUv).rgb;
    vec3 rawNight = texture2D(uNightTex, vUv).rgb;
    float oceanMask = texture2D(uSpecTex, vUv).r;

    float hC = texture2D(uBumpTex, vUv).r;
    float hR = texture2D(uBumpTex, vUv + vec2(0.0012, 0.0)).r;
    float hU = texture2D(uBumpTex, vUv + vec2(0.0, 0.0018)).r;
    float relief = ((hC - hR) + (hC - hU)) * (1.0 - oceanMask) * 1.9;

    float ndotl = dot(N, L);
    float dayMask = uUseTerminator > 0.5 ? smoothstep(-0.075, 0.135, ndotl) : 1.0;
    float nightMask = uUseTerminator > 0.5 ? smoothstep(0.085, -0.115, ndotl) : 0.0;

    float sunDiffuse = clamp(ndotl + relief * 0.22, 0.0, 1.0);
    float dayLightCurve = 0.58 + 0.72 * pow(sunDiffuse, 0.62);

    vec3 daySurface = rawDay;
    vec3 azureLift = vec3(0.045, 0.155, 0.31) * oceanMask * (0.45 + 0.55 * sunDiffuse);
    daySurface = daySurface * (1.28 * dayLightCurve) + azureLift;
    float luma = dot(daySurface, vec3(0.299, 0.587, 0.114));
    daySurface = mix(vec3(luma), daySurface, 1.14);

    vec3 H = normalize(L + V);
    float specPow = mix(36.0, 56.0, uHasRealTex);
    float oceanSpec = pow(max(dot(N, H), 0.0), specPow) * oceanMask * dayMask * 0.52;
    daySurface += vec3(0.95, 0.98, 1.0) * oceanSpec;

    vec3 nightBase = mix(
      vec3(0.022, 0.036, 0.068),
      vec3(0.008, 0.016, 0.038),
      oceanMask
    );
    nightBase += rawDay * 0.045 * (1.0 - oceanMask);

    float citySignal = uHasRealTex > 0.5
      ? smoothstep(0.09, 0.34, rawNight.r * 1.25 + rawNight.g * 0.42 - rawNight.b * 0.55)
      : smoothstep(0.18, 0.65, rawNight.r * 0.8 + rawNight.g * 0.6);

    vec3 goldenCities =
      vec3(1.0, 0.77, 0.34) * citySignal * 2.25 +
      vec3(1.0, 0.93, 0.72) * pow(citySignal, 2.4) * 1.45;
    vec3 nightSurface = nightBase + goldenCities * (0.7 + 0.3 * nightMask);

    vec3 color = mix(nightSurface, daySurface, dayMask);

    if (uUseTerminator > 0.5) {
      float duskBand = exp(-pow((ndotl - 0.015) * 11.5, 2.0));
      vec3 twilightWarm = mix(vec3(1.0, 0.44, 0.14), vec3(0.96, 0.62, 0.32), oceanMask);
      color += twilightWarm * duskBand * 0.32;
    }

    float fresnel = pow(1.0 - max(dot(N, V), 0.0), 3.6);
    vec3 dayAtmo = mix(vec3(0.32, 0.68, 1.0), uAccentColor, 0.22);
    vec3 nightAtmo = vec3(0.05, 0.12, 0.28);
    color += mix(nightAtmo, dayAtmo, dayMask) * fresnel * (0.16 + 0.62 * dayMask);

    gl_FragColor = vec4(color, 1.0);
  }
`;

// Volumetric 3D Polar Aurora Oval Curtain Shader (synced live to NOAA Geomagnetic Kp index!)
const AURORA_VERTEX_SHADER = /* glsl */ `
  varying vec3 vNormalWorld;
  varying vec3 vLocalPos;

  void main() {
    vLocalPos = normalize(position);
    vNormalWorld = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const AURORA_FRAGMENT_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uKp;
  uniform vec3 uSunDir;

  varying vec3 vNormalWorld;
  varying vec3 vLocalPos;

  void main() {
    // True geomagnetic pole axis (tilted ~9.5 deg toward northern Canada / Antarctica)
    vec3 magNorth = normalize(vec3(-0.048, 0.986, 0.155));
    float magSinLat = abs(dot(vLocalPos, magNorth));
    float magLatDeg = degrees(asin(clamp(magSinLat, 0.0, 1.0)));

    // Kp expands aurora oval southward dynamically (Kp 2 -> 69 deg, Kp 7 -> 58 deg)
    float ovalCenter = clamp(72.5 - uKp * 2.05, 55.0, 72.5);
    float ovalWidth = 4.2 + uKp * 0.55;

    float angle = atan(vLocalPos.z, vLocalPos.x);
    float waveWarp = sin(angle * 4.0 + uTime * 0.42) * 1.7 + cos(angle * 7.0 - uTime * 0.31) * 0.9;
    float dist = (magLatDeg + waveWarp) - ovalCenter;
    float band = exp(-pow(dist / ovalWidth, 2.0));

    if (band < 0.03) discard;

    // Animated shimmering curtain rays
    float curtain1 = 0.5 + 0.5 * sin(angle * 16.0 + uTime * 1.15 + sin(angle * 5.0 - uTime * 0.55) * 2.2);
    float curtain2 = 0.5 + 0.5 * sin(angle * 29.0 - uTime * 0.85 + magLatDeg * 0.45);
    float shimmer = pow(curtain1 * 0.65 + curtain2 * 0.35, 1.65);

    // Brightest on night hemisphere, subtle near twilight
    float ndotl = dot(normalize(vNormalWorld), normalize(uSunDir));
    float nightVisibility = mix(0.22, 1.0, smoothstep(0.25, -0.22, ndotl));

    // Emerald green lower/equatorward glow -> ethereal violet-magenta poleward crown
    float colorMix = smoothstep(-ovalWidth * 0.55, ovalWidth * 0.75, dist);
    vec3 emerald = vec3(0.12, 1.0, 0.62);
    vec3 violet = vec3(0.68, 0.28, 1.0);
    vec3 col = mix(emerald, violet, colorMix);

    float intensity = band * (0.42 + 0.95 * shimmer) * nightVisibility * (0.58 + uKp * 0.08);
    gl_FragColor = vec4(col * 1.25, clamp(intensity * 0.78, 0.0, 0.85));
  }
`;

const CLOUDS_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalWorld;

  void main() {
    vUv = uv;
    vNormalWorld = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const CLOUDS_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uCloudTex;
  uniform vec3 uSunDir;
  uniform float uUseTerminator;

  varying vec2 vUv;
  varying vec3 vNormalWorld;

  void main() {
    float cloud = texture2D(uCloudTex, vUv).r;
    if (cloud < 0.06) discard;

    vec3 N = normalize(vNormalWorld);
    vec3 L = normalize(uSunDir);
    float ndotl = dot(N, L);

    float dayLit = uUseTerminator > 0.5 ? smoothstep(-0.10, 0.18, ndotl) : 0.92;
    float twilight = uUseTerminator > 0.5 ? exp(-pow((ndotl - 0.01) * 9.5, 2.0)) : 0.0;

    vec3 dayCloudColor = vec3(0.97, 0.99, 1.0);
    vec3 duskCloudColor = vec3(1.0, 0.62, 0.36);
    vec3 nightCloudColor = vec3(0.05, 0.09, 0.18);

    vec3 col = mix(nightCloudColor, dayCloudColor, dayLit);
    col = mix(col, duskCloudColor, twilight * 0.55);

    float alpha = cloud * mix(0.06, 0.50, dayLit);
    gl_FragColor = vec4(col, alpha);
  }
`;

const ATMO_VERTEX_SHADER = /* glsl */ `
  varying vec3 vNormalWorld;
  varying vec3 vPositionWorld;

  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vPositionWorld = worldPos.xyz;
    vNormalWorld = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const ATMO_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uAtmoColor;
  uniform vec3 uSunDir;
  uniform float uUseTerminator;

  varying vec3 vNormalWorld;
  varying vec3 vPositionWorld;

  void main() {
    vec3 N = normalize(vNormalWorld);
    vec3 V = normalize(cameraPosition - vPositionWorld);
    float rim = pow(clamp(0.66 - dot(N, V), 0.0, 1.0), 3.4);
    float ndotl = dot(N, normalize(uSunDir));
    float sunBoost = uUseTerminator > 0.5
      ? mix(0.14, 1.0, smoothstep(-0.22, 0.42, ndotl))
      : 0.85;
    float twilightTint = uUseTerminator > 0.5
      ? exp(-pow((ndotl - 0.02) * 5.5, 2.0)) * 0.25
      : 0.0;
    vec3 haloCol = mix(uAtmoColor, vec3(1.0, 0.56, 0.24), twilightTint);
    gl_FragColor = vec4(haloCol, rim * sunBoost * 0.88);
  }
`;

// Real-time lunar phase shader lit by exact Sun vector
const MOON_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalWorld;

  void main() {
    vUv = uv;
    vNormalWorld = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const MOON_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uMoonTex;
  uniform vec3 uSunDir;

  varying vec2 vUv;
  varying vec3 vNormalWorld;

  void main() {
    vec3 texCol = texture2D(uMoonTex, vUv).rgb;
    float ndotl = dot(normalize(vNormalWorld), normalize(uSunDir));
    // Crisp lunar terminator + very faint Earthshine on dark limb
    float lit = smoothstep(-0.04, 0.14, ndotl) * max(0.2, ndotl * 1.15);
    vec3 col = texCol * (0.045 + 1.12 * lit);
    gl_FragColor = vec4(col, 1.0);
  }
`;

interface LabelAnchor {
  id: string;
  label: string;
  sub?: string;
  position: THREE.Vector3;
  kind: "sat" | "hub" | "selected";
}

interface PulseRingRecord {
  mesh: THREE.Mesh;
  phase: number;
  baseScale: number;
  maxScale: number;
  speed: number;
}

interface CablePacketRecord {
  mesh: THREE.Mesh;
  curve: THREE.CatmullRomCurve3;
  offset: number;
  speed: number;
}

interface WindParticle {
  lat: number;
  lon: number;
  age: number;
  maxAge: number;
  trail: Array<[number, number]>;
}

interface PickablePayload {
  target: SelectedTarget;
}

const WIND_COUNT = 220;
const WIND_SEGMENTS = 6;

function computeWindVelocityDegPerSec(
  lat: number,
  lon: number,
  storms: Array<{ lat: number; lon: number }>
): [number, number] {
  const absLat = Math.abs(lat);
  let dLon: number;
  let dLat: number;

  if (absLat < 26) {
    // Tropical Easterly Trade Winds
    dLon = -2.8 - Math.cos(lat * DEG2RAD * 3) * 0.9;
    dLat = -Math.sign(lat) * 0.55;
  } else if (absLat < 60) {
    // Mid-Latitude Westerly Jet Streams with planetary Rossby waves
    const jetPeak = Math.exp(-Math.pow((absLat - 43) / 13, 2));
    dLon = 3.2 + jetPeak * 4.4;
    dLat = Math.sin(lon * DEG2RAD * 3.0 + (lat > 0 ? 0.5 : -0.5)) * 1.5;
  } else {
    // Polar Easterlies
    dLon = -2.2;
    dLat = Math.sin(lon * DEG2RAD * 2.0) * 0.4;
  }

  // Add swirling cyclone vortices around active NASA EONET Severe Storms
  for (const s of storms) {
    const dy = lat - s.lat;
    let dx = lon - s.lon;
    if (dx > 180) dx -= 360;
    if (dx < -180) dx += 360;
    const dist2 = dx * dx + dy * dy;
    if (dist2 < 140 && dist2 > 0.2) {
      const pull = (1 - dist2 / 140) * 5.2;
      const spinDir = s.lat >= 0 ? 1 : -1; // CCW Northern, CW Southern
      const invD = 1 / Math.sqrt(dist2);
      dLon += (-dy * invD * spinDir - dx * invD * 0.25) * pull;
      dLat += (dx * invD * spinDir - dy * invD * 0.25) * pull;
    }
  }

  return [dLat, dLon];
}

export function GlobeCanvas({
  theme,
  locale,
  layers,
  quakes,
  satellites,
  flights,
  events,
  kpIndex,
  timeOffsetMs,
  measureMode,
  measurePoints,
  selectedTarget,
  lockedSatId,
  autoRotate,
  cameraTarget,
  onSelectTarget,
  onAddMeasurePoint,
  onUserInteract,
}: GlobeCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const labelLayerRef = useRef<HTMLDivElement | null>(null);

  const propsRef = useRef({
    theme,
    locale,
    layers,
    quakes,
    satellites,
    flights,
    events,
    kpIndex,
    timeOffsetMs,
    measureMode,
    measurePoints,
    selectedTarget,
    lockedSatId,
    autoRotate,
    onSelectTarget,
    onAddMeasurePoint,
    onUserInteract,
  });
  propsRef.current = {
    theme,
    locale,
    layers,
    quakes,
    satellites,
    flights,
    events,
    kpIndex,
    timeOffsetMs,
    measureMode,
    measurePoints,
    selectedTarget,
    lockedSatId,
    autoRotate,
    onSelectTarget,
    onAddMeasurePoint,
    onUserInteract,
  };

  // Live animated flight state for smooth dead-reckoning between API refreshes
  const liveFlightsRef = useRef<FlightTrack[]>([]);

  const sceneRefs = useRef<{
    earthMat?: THREE.ShaderMaterial;
    auroraMat?: THREE.ShaderMaterial;
    auroraMesh?: THREE.Mesh;
    cloudsMat?: THREE.ShaderMaterial;
    cloudsMesh?: THREE.Mesh;
    atmoMat?: THREE.ShaderMaterial;
    moonMesh?: THREE.Mesh;
    moonMat?: THREE.ShaderMaterial;
    sunSprite?: THREE.Sprite;
    borderLines?: THREE.LineSegments;
    borderMat?: THREE.LineBasicMaterial;
    orbitalRingsGroup?: THREE.Group;
    quakesGroup?: THREE.Group;
    satsGroup?: THREE.Group;
    eventsGroup?: THREE.Group;
    cablesGroup?: THREE.Group;
    hubsGroup?: THREE.Group;
    measureGroup?: THREE.Group;
    measurePulse?: { mesh: THREE.Mesh; curve: THREE.CatmullRomCurve3 } | null;
    flightsMesh?: THREE.InstancedMesh;
    flightsMat?: THREE.MeshBasicMaterial;
    windLines?: THREE.LineSegments;
    windMat?: THREE.LineBasicMaterial;
    reticleGroup?: THREE.Group;
    pulseRings: PulseRingRecord[];
    cablePackets: CablePacketRecord[];
    pickables: THREE.Object3D[];
    camera?: THREE.PerspectiveCamera;
    controls?: OrbitControls;
    flyAnim: {
      active: boolean;
      startPos: THREE.Vector3;
      endPos: THREE.Vector3;
      startTime: number;
      duration: number;
    };
    labelAnchors: LabelAnchor[];
  }>({
    pulseRings: [],
    cablePackets: [],
    pickables: [],
    measurePulse: null,
    flyAnim: {
      active: false,
      startPos: new THREE.Vector3(),
      endPos: new THREE.Vector3(),
      startTime: 0,
      duration: 1100,
    },
    labelAnchors: [],
  });

  // 1. Initialize core WebGL scene once
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    const scene = new THREE.Scene();

    const camera = new THREE.PerspectiveCamera(42, width / height, 0.05, 100);
    const initDate = new Date(Date.now() + propsRef.current.timeOffsetMs);
    const subsolar = getSubsolarPoint(initDate);
    let heroLon = subsolar.lon - 56;
    if (heroLon < -180) heroLon += 360;
    const initPos = latLonToVec3(26, heroLon, 2.95);
    camera.position.copy(initPos);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.06;
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.065;
    controls.enablePan = false;
    controls.minDistance = 1.38;
    controls.maxDistance = 5.4;
    controls.rotateSpeed = 0.55;
    controls.zoomSpeed = 0.85;

    controls.addEventListener("start", () => {
      sceneRefs.current.flyAnim.active = false;
      propsRef.current.onUserInteract?.();
    });

    // Deep multi-depth starfield
    const starCount = 2600;
    const starPos = new Float32Array(starCount * 3);
    const starCol = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const r = 15 + Math.random() * 28;
      const u = Math.random();
      const v = Math.random();
      const theta = 2 * Math.PI * u;
      const phi = Math.acos(2 * v - 1);
      starPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      starPos[i * 3 + 1] = r * Math.cos(phi);
      starPos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);

      const brightness = 0.45 + Math.random() * 0.55;
      const tint = Math.random();
      starCol[i * 3] = brightness * (tint > 0.85 ? 0.85 : 1.0);
      starCol[i * 3 + 1] = brightness * 0.95;
      starCol[i * 3 + 2] = brightness * (tint < 0.25 ? 0.82 : 1.0);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
    starGeo.setAttribute("color", new THREE.BufferAttribute(starCol, 3));
    const starMat = new THREE.PointsMaterial({
      size: 0.052,
      vertexColors: true,
      transparent: true,
      opacity: 0.8,
      sizeAttenuation: true,
      depthWrite: false,
    });
    const stars = new THREE.Points(starGeo, starMat);
    scene.add(stars);

    // Procedural fallback Earth textures + NASA self-hosted 2K upgrades
    const procTextures = createProceduralEarthTextures();
    const moonTexture = createMoonTexture();
    const sunCoronaTex = createSunCoronaTexture();
    const loadedTextures: THREE.Texture[] = [];
    const palette = THEME_PALETTE[propsRef.current.theme];

    const sunDir = latLonToVec3(subsolar.lat, subsolar.lon, 1).normalize();

    const emptyPixel = new Uint8Array([0, 0, 0, 255]);
    const fallbackBump = new THREE.DataTexture(emptyPixel, 1, 1, THREE.RGBAFormat);
    fallbackBump.needsUpdate = true;
    const fallbackCloud = new THREE.DataTexture(emptyPixel, 1, 1, THREE.RGBAFormat);
    fallbackCloud.needsUpdate = true;

    const earthGeo = new THREE.SphereGeometry(EARTH_R, 112, 72);
    const earthMat = new THREE.ShaderMaterial({
      vertexShader: EARTH_VERTEX_SHADER,
      fragmentShader: EARTH_FRAGMENT_SHADER,
      uniforms: {
        uDayTex: { value: procTextures.dayTexture },
        uNightTex: { value: procTextures.nightTexture },
        uSpecTex: { value: procTextures.specTexture },
        uBumpTex: { value: fallbackBump },
        uHasRealTex: { value: 0.0 },
        uSunDir: { value: sunDir.clone() },
        uAccentColor: { value: new THREE.Color(palette.accent) },
        uUseTerminator: { value: propsRef.current.layers.terminator ? 1.0 : 0.0 },
      },
    });
    const earthMesh = new THREE.Mesh(earthGeo, earthMat);
    earthMesh.name = "EARTH_SURFACE";
    scene.add(earthMesh);

    // 3D Floating Cloud Layer
    const cloudsGeo = new THREE.SphereGeometry(EARTH_R * 1.0075, 96, 64);
    const cloudsMat = new THREE.ShaderMaterial({
      vertexShader: CLOUDS_VERTEX_SHADER,
      fragmentShader: CLOUDS_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uCloudTex: { value: fallbackCloud },
        uSunDir: { value: sunDir.clone() },
        uUseTerminator: { value: propsRef.current.layers.terminator ? 1.0 : 0.0 },
      },
    });
    const cloudsMesh = new THREE.Mesh(cloudsGeo, cloudsMat);
    cloudsMesh.visible = propsRef.current.layers.clouds;
    scene.add(cloudsMesh);

    // 3D Live Polar Aurora Oval Curtain Shell
    const auroraGeo = new THREE.SphereGeometry(EARTH_R * 1.022, 96, 64);
    const auroraMat = new THREE.ShaderMaterial({
      vertexShader: AURORA_VERTEX_SHADER,
      fragmentShader: AURORA_FRAGMENT_SHADER,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uKp: { value: propsRef.current.kpIndex },
        uSunDir: { value: sunDir.clone() },
      },
    });
    const auroraMesh = new THREE.Mesh(auroraGeo, auroraMat);
    auroraMesh.visible = propsRef.current.layers.aurora;
    scene.add(auroraMesh);

    // 3D Real Astronomical Moon with Live Lunar Phase
    const moonGeo = new THREE.SphereGeometry(0.19, 48, 32);
    const moonMat = new THREE.ShaderMaterial({
      vertexShader: MOON_VERTEX_SHADER,
      fragmentShader: MOON_FRAGMENT_SHADER,
      uniforms: {
        uMoonTex: { value: moonTexture },
        uSunDir: { value: sunDir.clone() },
      },
    });
    const moonMesh = new THREE.Mesh(moonGeo, moonMat);
    const sublunarInit = getSublunarPoint(initDate);
    moonMesh.position.copy(latLonToVec3(sublunarInit.lat, sublunarInit.lon, 4.9));
    scene.add(moonMesh);

    // Luminous Sun Corona & Subtle Anamorphic Lens Flare
    const sunSpriteMat = new THREE.SpriteMaterial({
      map: sunCoronaTex,
      color: 0xffffff,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0.92,
    });
    const sunSprite = new THREE.Sprite(sunSpriteMat);
    sunSprite.scale.set(5.4, 5.4, 1);
    sunSprite.position.copy(sunDir.clone().multiplyScalar(17.5));
    scene.add(sunSprite);

    // Load local 2K NASA textures
    const loader = new THREE.TextureLoader();
    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    let disposed = false;

    const loadTex = (
      url: string,
      isColor: boolean,
      onReady: (tex: THREE.Texture) => void
    ) => {
      loader.load(url, (tex) => {
        if (disposed) {
          tex.dispose();
          return;
        }
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.anisotropy = Math.min(12, maxAniso);
        tex.colorSpace = isColor ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        tex.needsUpdate = true;
        loadedTextures.push(tex);
        onReady(tex);
      });
    };

    let dayLoaded = false;
    let nightLoaded = false;
    loadTex("/textures/earth-day.jpg", true, (tex) => {
      earthMat.uniforms.uDayTex.value = tex;
      dayLoaded = true;
      if (dayLoaded && nightLoaded) earthMat.uniforms.uHasRealTex.value = 1.0;
    });
    loadTex("/textures/earth-night.jpg", true, (tex) => {
      earthMat.uniforms.uNightTex.value = tex;
      nightLoaded = true;
      if (dayLoaded && nightLoaded) earthMat.uniforms.uHasRealTex.value = 1.0;
    });
    loadTex("/textures/earth-water.png", false, (tex) => {
      earthMat.uniforms.uSpecTex.value = tex;
    });
    loadTex("/textures/earth-topology.png", false, (tex) => {
      earthMat.uniforms.uBumpTex.value = tex;
    });
    loadTex("/textures/earth-clouds.png", false, (tex) => {
      cloudsMat.uniforms.uCloudTex.value = tex;
    });

    // Apple-style Atmospheric Rayleigh Halo
    const atmoGeo = new THREE.SphereGeometry(EARTH_R * 1.105, 64, 48);
    const atmoMat = new THREE.ShaderMaterial({
      vertexShader: ATMO_VERTEX_SHADER,
      fragmentShader: ATMO_FRAGMENT_SHADER,
      side: THREE.BackSide,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      uniforms: {
        uAtmoColor: { value: new THREE.Color(palette.atmo) },
        uSunDir: { value: sunDir.clone() },
        uUseTerminator: { value: propsRef.current.layers.terminator ? 1.0 : 0.0 },
      },
    });
    const atmoMesh = new THREE.Mesh(atmoGeo, atmoMat);
    scene.add(atmoMesh);

    // 3D Vector Coastlines
    const coastVerts = buildCoastlineSegments(EARTH_R * 1.0025);
    const coastGeo = new THREE.BufferGeometry();
    coastGeo.setAttribute("position", new THREE.BufferAttribute(coastVerts, 3));
    const borderMat = new THREE.LineBasicMaterial({
      color: palette.border,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
    });
    const borderLines = new THREE.LineSegments(coastGeo, borderMat);
    scene.add(borderLines);

    // Subtle Holographic Orbital Telemetry Rings
    const orbitalRingsGroup = new THREE.Group();
    const buildHoloRing = (radius: number, tiltX: number, tiltZ: number, opacity: number) => {
      const pts: THREE.Vector3[] = [];
      const segs = 128;
      for (let i = 0; i <= segs; i++) {
        const a = (i / segs) * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius));
      }
      const g = new THREE.BufferGeometry().setFromPoints(pts);
      const m = new THREE.LineBasicMaterial({
        color: palette.ring,
        transparent: true,
        opacity,
        depthWrite: false,
      });
      const line = new THREE.Line(g, m);
      line.rotation.set(tiltX, 0, tiltZ);
      return line;
    };
    orbitalRingsGroup.add(buildHoloRing(1.42, 0.22, -0.14, 0.11));
    orbitalRingsGroup.add(buildHoloRing(1.56, -0.35, 0.18, 0.07));
    scene.add(orbitalRingsGroup);

    // 3D Global Atmospheric Wind Streamlines (Single dynamic GPU LineSegments!)
    const windParticles: WindParticle[] = [];
    const spawnWind = (p: WindParticle) => {
      p.lat = (Math.random() - 0.5) * 144;
      p.lon = (Math.random() - 0.5) * 360;
      p.age = 0;
      p.maxAge = 3.5 + Math.random() * 4.5;
      p.trail = Array.from({ length: WIND_SEGMENTS + 1 }, () => [p.lat, p.lon]);
    };
    for (let i = 0; i < WIND_COUNT; i++) {
      const p: WindParticle = { lat: 0, lon: 0, age: 0, maxAge: 5, trail: [] };
      spawnWind(p);
      p.age = Math.random() * p.maxAge;
      windParticles.push(p);
    }

    const totalWindVerts = WIND_COUNT * WIND_SEGMENTS * 2;
    const windPosArr = new Float32Array(totalWindVerts * 3);
    const windColArr = new Float32Array(totalWindVerts * 3);
    const windGeo = new THREE.BufferGeometry();
    windGeo.setAttribute("position", new THREE.BufferAttribute(windPosArr, 3));
    windGeo.setAttribute("color", new THREE.BufferAttribute(windColArr, 3));
    const windMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.42,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const windLines = new THREE.LineSegments(windGeo, windMat);
    windLines.visible = propsRef.current.layers.wind;
    scene.add(windLines);

    // 3D Instanced Live Aircraft Fleet (Single draw call for 240+ jets!)
    const MAX_FLIGHTS = 260;
    const jetGeo = new THREE.ConeGeometry(0.0085, 0.024, 3);
    const flightsMat = new THREE.MeshBasicMaterial({
      color: palette.flight,
      transparent: true,
      opacity: 0.94,
    });
    const flightsMesh = new THREE.InstancedMesh(jetGeo, flightsMat, MAX_FLIGHTS);
    flightsMesh.count = 0;
    flightsMesh.visible = propsRef.current.layers.flights;
    flightsMesh.frustumCulled = false;
    scene.add(flightsMesh);

    // Dynamic Layer Groups
    const quakesGroup = new THREE.Group();
    const satsGroup = new THREE.Group();
    const eventsGroup = new THREE.Group();
    const cablesGroup = new THREE.Group();
    const hubsGroup = new THREE.Group();
    const measureGroup = new THREE.Group();
    const reticleGroup = new THREE.Group();
    reticleGroup.visible = false;

    const retOuter = new THREE.Mesh(
      new THREE.RingGeometry(0.036, 0.043, 32),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.92,
        depthWrite: false,
      })
    );
    const retInner = new THREE.Mesh(
      new THREE.RingGeometry(0.022, 0.026, 4),
      new THREE.MeshBasicMaterial({
        color: palette.accent,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
      })
    );
    reticleGroup.add(retOuter, retInner);

    scene.add(
      cablesGroup,
      hubsGroup,
      quakesGroup,
      eventsGroup,
      satsGroup,
      measureGroup,
      reticleGroup
    );

    // Submarine Cables & Flowing Data Packets
    const cablePackets: CablePacketRecord[] = [];
    const buildCables = () => {
      const cableMat = new THREE.LineBasicMaterial({
        color: palette.cable,
        transparent: true,
        opacity: 0.44,
        depthWrite: false,
      });
      const packetGeo = new THREE.SphereGeometry(0.0085, 8, 8);
      const packetMat = new THREE.MeshBasicMaterial({
        color: palette.packet,
        transparent: true,
        opacity: 0.95,
      });

      for (let i = 0; i < SUBMARINE_CABLES.length; i++) {
        const cable = SUBMARINE_CABLES[i];
        const vStart = latLonToVec3(cable.from[0], cable.from[1], EARTH_R * 1.008);
        const vEnd = latLonToVec3(cable.to[0], cable.to[1], EARTH_R * 1.008);
        const dist = vStart.distanceTo(vEnd);
        const altitudeBoost = Math.min(0.24, 0.055 + dist * 0.11);

        const curvePts: THREE.Vector3[] = [];
        const steps = 40;
        for (let s = 0; s <= steps; s++) {
          const tNorm = s / steps;
          const p = vStart.clone().lerp(vEnd, tNorm).normalize();
          const lift = Math.sin(tNorm * Math.PI) * altitudeBoost;
          p.multiplyScalar(EARTH_R * 1.008 + lift);
          curvePts.push(p);
        }

        const curve = new THREE.CatmullRomCurve3(curvePts);
        const lineGeo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(48));
        const line = new THREE.Line(lineGeo, cableMat);
        cablesGroup.add(line);

        for (let pIdx = 0; pIdx < 2; pIdx++) {
          const packet = new THREE.Mesh(packetGeo, packetMat);
          cablesGroup.add(packet);
          cablePackets.push({
            mesh: packet,
            curve,
            offset: (i * 0.19 + pIdx * 0.5) % 1,
            speed: 0.09 + (i % 5) * 0.018,
          });
        }
      }
    };
    buildCables();

    sceneRefs.current = {
      ...sceneRefs.current,
      earthMat,
      auroraMat,
      auroraMesh,
      cloudsMat,
      cloudsMesh,
      atmoMat,
      moonMesh,
      moonMat,
      sunSprite,
      borderLines,
      borderMat,
      orbitalRingsGroup,
      quakesGroup,
      satsGroup,
      eventsGroup,
      cablesGroup,
      hubsGroup,
      measureGroup,
      flightsMesh,
      flightsMat,
      windLines,
      windMat,
      reticleGroup,
      cablePackets,
      camera,
      controls,
    };

    // Raycasting: supports Shift+Click / Measure Mode, Flights, Satellites, Quakes, Events, Hubs & Surface Probes
    const raycaster = new THREE.Raycaster();
    const pointerNdc = new THREE.Vector2();
    let downX = 0;
    let downY = 0;

    const handlePointerDown = (ev: PointerEvent) => {
      downX = ev.clientX;
      downY = ev.clientY;
    };

    const handlePointerUp = (ev: PointerEvent) => {
      const moved = Math.hypot(ev.clientX - downX, ev.clientY - downY);
      if (moved > 5) return;

      const rect = renderer.domElement.getBoundingClientRect();
      pointerNdc.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      pointerNdc.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointerNdc, camera);

      // 0. Measure Mode or Shift+Click drops a great-circle measurement pin directly on Earth
      if (propsRef.current.measureMode || ev.shiftKey) {
        const earthHits = raycaster.intersectObject(earthMesh, false);
        if (earthHits.length > 0) {
          const pt = earthHits[0].point;
          const { lat, lon } = vector3ToLatLon(pt.x, pt.y, pt.z);
          propsRef.current.onAddMeasurePoint({
            lat: Number(lat.toFixed(3)),
            lon: Number(lon.toFixed(3)),
          });
          return;
        }
      }

      // 1. Pickable tactical markers (Satellites, Quakes, Events, Hubs)
      const visiblePickables = sceneRefs.current.pickables.filter((obj) => {
        let cur: THREE.Object3D | null = obj;
        while (cur) {
          if (!cur.visible) return false;
          cur = cur.parent;
        }
        return true;
      });
      const markerHits = raycaster.intersectObjects(visiblePickables, false);
      if (markerHits.length > 0) {
        const payload = markerHits[0].object.userData as PickablePayload | undefined;
        if (payload?.target) {
          propsRef.current.onSelectTarget(payload.target);
          return;
        }
      }

      // 2. Pickable Live Aircraft (InstancedMesh)
      if (flightsMesh.visible && flightsMesh.count > 0) {
        const flightHits = raycaster.intersectObject(flightsMesh, false);
        if (
          flightHits.length > 0 &&
          flightHits[0].instanceId !== undefined &&
          liveFlightsRef.current[flightHits[0].instanceId]
        ) {
          propsRef.current.onSelectTarget({
            kind: "flight",
            data: liveFlightsRef.current[flightHits[0].instanceId],
          });
          return;
        }
      }

      // 3. Surface Coordinate Probe
      const earthHits = raycaster.intersectObject(earthMesh, false);
      if (earthHits.length > 0) {
        const pt = earthHits[0].point;
        const { lat, lon } = vector3ToLatLon(pt.x, pt.y, pt.z);
        propsRef.current.onSelectTarget({
          kind: "probe",
          lat: Number(lat.toFixed(3)),
          lon: Number(lon.toFixed(3)),
        });
      }
    };

    renderer.domElement.addEventListener("pointerdown", handlePointerDown);
    renderer.domElement.addEventListener("pointerup", handlePointerUp);

    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", handleResize);

    const projVec = new THREE.Vector3();
    const camDir = new THREE.Vector3();
    const tempMat = new THREE.Matrix4();
    const windColor = new THREE.Color();
    const clock = new THREE.Clock();
    let astroTimer = 0;
    let lastOffsetApplied = propsRef.current.timeOffsetMs;
    let rafId = 0;

    const labelPool = new Map<string, HTMLDivElement>();

    const animate = () => {
      rafId = requestAnimationFrame(animate);
      const dt = Math.min(clock.getDelta(), 0.05);
      const elapsed = clock.getElapsedTime();
      const refs = sceneRefs.current;
      const curProps = propsRef.current;

      // Update Sun, Terminator, Moon & Corona immediately on Time Machine offset change or every 2s
      astroTimer += dt;
      if (
        astroTimer > 2 ||
        Math.abs(curProps.timeOffsetMs - lastOffsetApplied) > 100
      ) {
        astroTimer = 0;
        lastOffsetApplied = curProps.timeOffsetMs;
        const simDate = new Date(Date.now() + curProps.timeOffsetMs);
        const sp = getSubsolarPoint(simDate);
        const sd = latLonToVec3(sp.lat, sp.lon, 1).normalize();
        earthMat.uniforms.uSunDir.value.copy(sd);
        cloudsMat.uniforms.uSunDir.value.copy(sd);
        auroraMat.uniforms.uSunDir.value.copy(sd);
        atmoMat.uniforms.uSunDir.value.copy(sd);
        moonMat.uniforms.uSunDir.value.copy(sd);
        sunSprite.position.copy(sd.clone().multiplyScalar(17.5));

        const sl = getSublunarPoint(simDate);
        moonMesh.position.copy(latLonToVec3(sl.lat, sl.lon, 4.9));
      }

      // Animate Aurora Curtains & Clouds
      auroraMat.uniforms.uTime.value = elapsed;
      if (cloudsMesh.visible) {
        cloudsMesh.rotation.y = elapsed * 0.0045;
      }

      // Smooth Dead-Reckoning of Live Aircraft across globe
      if (flightsMesh.visible && liveFlightsRef.current.length > 0) {
        const list = liveFlightsRef.current;
        const count = Math.min(list.length, MAX_FLIGHTS);
        // Slightly exaggerated visual flight glide (25x real speed so movement feels visibly alive without teleporting)
        const speedBoost = 25;
        for (let i = 0; i < count; i++) {
          const f = list[i];
          const kmStep = ((f.velocityMs / 1000) * dt * speedBoost);
          const degStep = (kmStep / EARTH_RADIUS_KM) * (180 / Math.PI);
          const hRad = f.headingDeg * DEG2RAD;
          f.lat = Math.max(-82, Math.min(82, f.lat + Math.cos(hRad) * degStep));
          const cosLat = Math.max(0.2, Math.cos(f.lat * DEG2RAD));
          f.lon += (Math.sin(hRad) * degStep) / cosLat;
          if (f.lon > 180) f.lon -= 360;
          if (f.lon < -180) f.lon += 360;

          computeAircraftMatrix(f.lat, f.lon, f.headingDeg, EARTH_R * 1.0165, 1.0, tempMat);
          flightsMesh.setMatrixAt(i, tempMat);
        }
        flightsMesh.count = count;
        flightsMesh.instanceMatrix.needsUpdate = true;
      }

      // Animate 3D Global Atmospheric Wind Streamlines
      if (windLines.visible) {
        const storms = curProps.events
          .filter((e) => e.category === "severeStorms")
          .map((e) => ({ lat: e.lat, lon: e.lon }));
        const pCol = THEME_PALETTE[curProps.theme].wind;
        windColor.setHex(pCol);
        const posAttr = windGeo.getAttribute("position") as THREE.BufferAttribute;
        const colAttr = windGeo.getAttribute("color") as THREE.BufferAttribute;
        const posBuf = posAttr.array as Float32Array;
        const colBuf = colAttr.array as Float32Array;

        let ptr = 0;
        for (let i = 0; i < WIND_COUNT; i++) {
          const wp = windParticles[i];
          wp.age += dt;
          if (wp.age >= wp.maxAge || Math.abs(wp.lat) > 84) {
            spawnWind(wp);
          } else {
            const [dLat, dLon] = computeWindVelocityDegPerSec(wp.lat, wp.lon, storms);
            wp.lat = Math.max(-84, Math.min(84, wp.lat + dLat * dt));
            wp.lon += dLon * dt;
            if (wp.lon > 180) wp.lon -= 360;
            if (wp.lon < -180) wp.lon += 360;

            for (let t = WIND_SEGMENTS; t > 0; t--) {
              wp.trail[t][0] = wp.trail[t - 1][0];
              wp.trail[t][1] = wp.trail[t - 1][1];
            }
            wp.trail[0][0] = wp.lat;
            wp.trail[0][1] = wp.lon;
          }

          const lifeFade = Math.sin((wp.age / wp.maxAge) * Math.PI);
          for (let s = 0; s < WIND_SEGMENTS; s++) {
            const [la1, lo1] = wp.trail[s];
            const [la2, lo2] = wp.trail[s + 1];
            const jump = Math.abs(lo1 - lo2) > 90;
            const v1 = latLonToVector3Tuple(la1, lo1, EARTH_R * 1.013);
            const v2 = jump ? v1 : latLonToVector3Tuple(la2, lo2, EARTH_R * 1.013);

            posBuf[ptr] = v1[0];
            posBuf[ptr + 1] = v1[1];
            posBuf[ptr + 2] = v1[2];
            posBuf[ptr + 3] = v2[0];
            posBuf[ptr + 4] = v2[1];
            posBuf[ptr + 5] = v2[2];

            const headFade = (1 - s / WIND_SEGMENTS) * lifeFade;
            const tailFade = (1 - (s + 1) / WIND_SEGMENTS) * lifeFade;
            colBuf[ptr] = windColor.r * headFade;
            colBuf[ptr + 1] = windColor.g * headFade;
            colBuf[ptr + 2] = windColor.b * headFade;
            colBuf[ptr + 3] = windColor.r * tailFade;
            colBuf[ptr + 4] = windColor.g * tailFade;
            colBuf[ptr + 5] = windColor.b * tailFade;
            ptr += 6;
          }
        }
        posAttr.needsUpdate = true;
        colAttr.needsUpdate = true;
      }

      // Smooth spherical camera fly-to
      if (refs.flyAnim.active) {
        const progress = Math.min(
          1,
          (performance.now() - refs.flyAnim.startTime) / refs.flyAnim.duration
        );
        const eased = 1 - Math.pow(1 - progress, 3);
        const startDir = refs.flyAnim.startPos.clone().normalize();
        const endDir = refs.flyAnim.endPos.clone().normalize();
        const startLen = refs.flyAnim.startPos.length();
        const endLen = refs.flyAnim.endPos.length();

        const angle = startDir.angleTo(endDir);
        let dir: THREE.Vector3;
        if (angle < 0.0001) {
          dir = endDir;
        } else {
          const sinA = Math.sin(angle);
          const w1 = Math.sin((1 - eased) * angle) / sinA;
          const w2 = Math.sin(eased * angle) / sinA;
          dir = startDir.multiplyScalar(w1).add(endDir.multiplyScalar(w2)).normalize();
        }
        const dist = startLen + (endLen - startLen) * eased;
        camera.position.copy(dir.multiplyScalar(dist));
        if (progress >= 1) {
          refs.flyAnim.active = false;
        }
      } else if (curProps.lockedSatId) {
        const lockedSat = curProps.satellites.find(
          (s) => s.id === curProps.lockedSatId
        );
        if (lockedSat) {
          const desiredDist = Math.max(1.72, Math.min(2.35, camera.position.length()));
          const desiredPos = latLonToVec3(lockedSat.lat, lockedSat.lon, desiredDist);
          camera.position.lerp(desiredPos, 0.05);
        }
      } else if (curProps.autoRotate) {
        const rotAngle = dt * 0.068;
        camera.position.applyAxisAngle(new THREE.Vector3(0, 1, 0), rotAngle);
      }

      controls.update();

      orbitalRingsGroup.rotation.y = elapsed * 0.025;

      for (const ring of refs.pulseRings) {
        const cycle = (elapsed * ring.speed + ring.phase) % 1;
        const scale = ring.baseScale + cycle * (ring.maxScale - ring.baseScale);
        ring.mesh.scale.setScalar(scale);
        const mat = ring.mesh.material as THREE.MeshBasicMaterial;
        mat.opacity = Math.pow(1 - cycle, 1.4) * 0.88;
      }

      if (cablesGroup.visible) {
        for (const pkt of refs.cablePackets) {
          const u = (elapsed * pkt.speed + pkt.offset) % 1;
          pkt.curve.getPointAt(u, pkt.mesh.position);
        }
      }

      // Measure arc animated traveling beacon
      if (refs.measurePulse) {
        const u = (elapsed * 0.35) % 1;
        refs.measurePulse.curve.getPointAt(u, refs.measurePulse.mesh.position);
      }

      // Active target reticle
      if (curProps.selectedTarget) {
        let rPos: THREE.Vector3 | null = null;
        if (curProps.selectedTarget.kind === "quake") {
          rPos = latLonToVec3(
            curProps.selectedTarget.data.lat,
            curProps.selectedTarget.data.lon,
            EARTH_R * 1.012
          );
        } else if (curProps.selectedTarget.kind === "event") {
          rPos = latLonToVec3(
            curProps.selectedTarget.data.lat,
            curProps.selectedTarget.data.lon,
            EARTH_R * 1.012
          );
        } else if (curProps.selectedTarget.kind === "hub") {
          rPos = latLonToVec3(
            curProps.selectedTarget.data.lat,
            curProps.selectedTarget.data.lon,
            EARTH_R * 1.012
          );
        } else if (curProps.selectedTarget.kind === "probe") {
          rPos = latLonToVec3(
            curProps.selectedTarget.lat,
            curProps.selectedTarget.lon,
            EARTH_R * 1.012
          );
        } else if (curProps.selectedTarget.kind === "flight") {
          const liveF = liveFlightsRef.current.find(
            (f) => f.id === (curProps.selectedTarget as { kind: "flight"; data: FlightTrack }).data.id
          );
          const fData = liveF ?? curProps.selectedTarget.data;
          rPos = latLonToVec3(fData.lat, fData.lon, EARTH_R * 1.018);
        } else if (curProps.selectedTarget.kind === "satellite") {
          const sat = curProps.satellites.find(
            (s) => s.id === (curProps.selectedTarget as { kind: "satellite"; id: string }).id
          );
          if (sat) {
            rPos = latLonToVec3(sat.lat, sat.lon, satAltitudeToRadius(sat.altitudeKm));
          }
        }
        if (rPos) {
          reticleGroup.visible = true;
          reticleGroup.position.copy(rPos);
          reticleGroup.quaternion.copy(createTangentQuaternion(rPos));
          retOuter.rotation.z = elapsed * 0.9;
          retInner.rotation.z = -elapsed * 1.4;
          const pulse = 1 + Math.sin(elapsed * 4.2) * 0.1;
          reticleGroup.scale.setScalar(pulse);
        } else {
          reticleGroup.visible = false;
        }
      } else {
        reticleGroup.visible = false;
      }

      renderer.render(scene, camera);

      // Floating crisp HTML callout tags
      const labelRoot = labelLayerRef.current;
      if (labelRoot) {
        const w = container.clientWidth;
        const h = container.clientHeight;
        camDir.copy(camera.position).normalize();
        const activeIds = new Set<string>();

        for (const anchor of refs.labelAnchors) {
          const dot = anchor.position.clone().normalize().dot(camDir);
          const visible = dot > (anchor.kind === "sat" ? 0.08 : 0.25);
          if (!visible) continue;

          projVec.copy(anchor.position).project(camera);
          if (projVec.z > 1) continue;

          const sx = (projVec.x * 0.5 + 0.5) * w;
          const sy = (-projVec.y * 0.5 + 0.5) * h;
          if (sx < 40 || sx > w - 40 || sy < 48 || sy > h - 48) continue;

          activeIds.add(anchor.id);
          let el = labelPool.get(anchor.id);
          if (!el) {
            el = document.createElement("div");
            el.className = "globe-float-label";
            labelRoot.appendChild(el);
            labelPool.set(anchor.id, el);
          }
          el.dataset.kind = anchor.kind;
          const text = anchor.sub
            ? `<span class="globe-label-title">${anchor.label}</span><span class="globe-label-sub">${anchor.sub}</span>`
            : `<span class="globe-label-title">${anchor.label}</span>`;
          if (el.innerHTML !== text) {
            el.innerHTML = text;
          }
          el.style.transform = `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(
            1
          )}px, 0)`;
          el.style.opacity = "1";
        }

        for (const [id, el] of labelPool.entries()) {
          if (!activeIds.has(id)) {
            el.style.opacity = "0";
          }
        }
      }
    };

    animate();

    return () => {
      disposed = true;
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", handleResize);
      renderer.domElement.removeEventListener("pointerdown", handlePointerDown);
      renderer.domElement.removeEventListener("pointerup", handlePointerUp);
      controls.dispose();
      procTextures.dispose();
      moonTexture.dispose();
      sunCoronaTex.dispose();
      loadedTextures.forEach((t) => t.dispose());
      fallbackBump.dispose();
      fallbackCloud.dispose();
      earthGeo.dispose();
      earthMat.dispose();
      cloudsGeo.dispose();
      cloudsMat.dispose();
      auroraGeo.dispose();
      auroraMat.dispose();
      moonGeo.dispose();
      moonMat.dispose();
      sunSpriteMat.dispose();
      atmoGeo.dispose();
      atmoMat.dispose();
      coastGeo.dispose();
      borderMat.dispose();
      windGeo.dispose();
      windMat.dispose();
      jetGeo.dispose();
      flightsMat.dispose();
      starGeo.dispose();
      starMat.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
      if (labelLayerRef.current) {
        labelLayerRef.current.innerHTML = "";
      }
    };
  }, []);

  // 2. Sync flights array into live dead-reckoning buffer
  useEffect(() => {
    liveFlightsRef.current = flights.map((f) => ({ ...f }));
    const mesh = sceneRefs.current.flightsMesh;
    if (mesh) {
      const tempMat = new THREE.Matrix4();
      const count = Math.min(flights.length, 260);
      for (let i = 0; i < count; i++) {
        const f = flights[i];
        computeAircraftMatrix(f.lat, f.lon, f.headingDeg, EARTH_R * 1.0165, 1.0, tempMat);
        mesh.setMatrixAt(i, tempMat);
      }
      mesh.count = count;
      mesh.instanceMatrix.needsUpdate = true;
    }
  }, [flights]);

  // 3. Sync Theme, Kp index & Layer visibility
  useEffect(() => {
    const refs = sceneRefs.current;
    const palette = THEME_PALETTE[theme];
    const termVal = layers.terminator ? 1.0 : 0.0;

    if (refs.earthMat) {
      refs.earthMat.uniforms.uAccentColor.value.setHex(palette.accent);
      refs.earthMat.uniforms.uUseTerminator.value = termVal;
    }
    if (refs.auroraMat) {
      refs.auroraMat.uniforms.uKp.value = kpIndex;
    }
    if (refs.auroraMesh) refs.auroraMesh.visible = layers.aurora;
    if (refs.cloudsMat) refs.cloudsMat.uniforms.uUseTerminator.value = termVal;
    if (refs.cloudsMesh) refs.cloudsMesh.visible = layers.clouds;
    if (refs.atmoMat) {
      refs.atmoMat.uniforms.uAtmoColor.value.setHex(palette.atmo);
      refs.atmoMat.uniforms.uUseTerminator.value = termVal;
    }
    if (refs.borderMat) refs.borderMat.color.setHex(palette.border);
    if (refs.borderLines) refs.borderLines.visible = layers.borders;
    if (refs.quakesGroup) refs.quakesGroup.visible = layers.quakes;
    if (refs.satsGroup) refs.satsGroup.visible = layers.satellites;
    if (refs.eventsGroup) refs.eventsGroup.visible = layers.events;
    if (refs.cablesGroup) refs.cablesGroup.visible = layers.cables;
    if (refs.hubsGroup) refs.hubsGroup.visible = layers.hubs;
    if (refs.flightsMesh) refs.flightsMesh.visible = layers.flights;
    if (refs.flightsMat) refs.flightsMat.color.setHex(palette.flight);
    if (refs.windLines) refs.windLines.visible = layers.wind;

    if (refs.orbitalRingsGroup) {
      refs.orbitalRingsGroup.children.forEach((child) => {
        const line = child as THREE.Line;
        (line.material as THREE.LineBasicMaterial).color.setHex(palette.ring);
      });
    }
    if (refs.cablesGroup) {
      refs.cablesGroup.children.forEach((child) => {
        if (child instanceof THREE.Line) {
          (child.material as THREE.LineBasicMaterial).color.setHex(palette.cable);
        } else if (child instanceof THREE.Mesh) {
          (child.material as THREE.MeshBasicMaterial).color.setHex(palette.packet);
        }
      });
    }
  }, [theme, layers, kpIndex]);

  // 4. Render Great-Circle Measurement Arc & Pins
  useEffect(() => {
    const refs = sceneRefs.current;
    const g = refs.measureGroup;
    if (!g) return;

    while (g.children.length > 0) {
      const obj = g.children[0];
      g.remove(obj);
      if (obj instanceof THREE.Mesh || obj instanceof THREE.Line) {
        obj.geometry.dispose();
        if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
        else obj.material.dispose();
      }
    }
    refs.measurePulse = null;

    if (measurePoints.length === 0) return;

    for (const pt of measurePoints) {
      const pos = latLonToVec3(pt.lat, pt.lon, EARTH_R * 1.015);
      const pin = new THREE.Mesh(
        new THREE.SphereGeometry(0.015, 12, 12),
        new THREE.MeshBasicMaterial({ color: 0x4ef7a4 })
      );
      pin.position.copy(pos);
      g.add(pin);

      const halo = new THREE.Mesh(
        new THREE.RingGeometry(0.02, 0.027, 24),
        new THREE.MeshBasicMaterial({
          color: 0xffffff,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.9,
          depthWrite: false,
        })
      );
      halo.position.copy(pos);
      halo.quaternion.copy(createTangentQuaternion(pos));
      g.add(halo);
    }

    if (measurePoints.length === 2) {
      const v1 = latLonToVec3(measurePoints[0].lat, measurePoints[0].lon, EARTH_R * 1.015);
      const v2 = latLonToVec3(measurePoints[1].lat, measurePoints[1].lon, EARTH_R * 1.015);
      const dist = v1.distanceTo(v2);
      const liftMax = Math.min(0.32, 0.07 + dist * 0.14);

      const pts: THREE.Vector3[] = [];
      const steps = 64;
      for (let i = 0; i <= steps; i++) {
        const u = i / steps;
        const dir = v1.clone().lerp(v2, u).normalize();
        const lift = Math.sin(u * Math.PI) * liftMax;
        pts.push(dir.multiplyScalar(EARTH_R * 1.015 + lift));
      }

      const curve = new THREE.CatmullRomCurve3(pts);
      const lineGeo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(72));
      const line = new THREE.Line(
        lineGeo,
        new THREE.LineBasicMaterial({
          color: 0x4ef7a4,
          transparent: true,
          opacity: 0.95,
          depthWrite: false,
        })
      );
      g.add(line);

      const pulseMesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.014, 10, 10),
        new THREE.MeshBasicMaterial({ color: 0xffffff })
      );
      g.add(pulseMesh);
      refs.measurePulse = { mesh: pulseMesh, curve };
    }
  }, [measurePoints]);

  // 5. Rebuild Dynamic Markers (Quakes, Satellites, Events, Hubs)
  useEffect(() => {
    const refs = sceneRefs.current;
    const { quakesGroup, satsGroup, eventsGroup, hubsGroup } = refs;
    if (!quakesGroup || !satsGroup || !eventsGroup || !hubsGroup) return;

    const palette = THEME_PALETTE[theme];
    const clearGroup = (g: THREE.Group) => {
      while (g.children.length > 0) {
        const obj = g.children[0];
        g.remove(obj);
        if (obj instanceof THREE.Mesh || obj instanceof THREE.Line) {
          obj.geometry.dispose();
          if (Array.isArray(obj.material)) {
            obj.material.forEach((m) => m.dispose());
          } else {
            obj.material.dispose();
          }
        }
      }
    };

    clearGroup(quakesGroup);
    clearGroup(satsGroup);
    clearGroup(eventsGroup);
    clearGroup(hubsGroup);

    const pulseRings: PulseRingRecord[] = [];
    const pickables: THREE.Object3D[] = [];
    const labelAnchors: LabelAnchor[] = [];

    // A. Global Command Hubs
    for (const hub of WORLD_HUBS) {
      const pos = latLonToVec3(hub.lat, hub.lon, EARTH_R * 1.01);
      const pinSize = hub.tier === 1 ? 0.011 : 0.008;
      const pin = new THREE.Mesh(
        new THREE.SphereGeometry(pinSize, 10, 10),
        new THREE.MeshBasicMaterial({ color: palette.hub })
      );
      pin.position.copy(pos);
      pin.userData = { target: { kind: "hub", data: hub } } satisfies PickablePayload;
      hubsGroup.add(pin);
      pickables.push(pin);

      if (hub.tier === 1) {
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(0.014, 0.018, 20),
          new THREE.MeshBasicMaterial({
            color: palette.hub,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.5,
            depthWrite: false,
          })
        );
        ring.position.copy(pos);
        ring.quaternion.copy(createTangentQuaternion(pos));
        hubsGroup.add(ring);

        if (layers.hubs) {
          labelAnchors.push({
            id: `hub-${hub.id}`,
            label: locale === "zh" ? hub.nameZh : hub.name,
            position: pos.clone().multiplyScalar(1.015),
            kind: "hub",
          });
        }
      }
    }

    // B. USGS Earthquakes + Animated Pulsing Seismic Waves
    for (let i = 0; i < quakes.length; i++) {
      const q = quakes[i];
      const col = quakeColor(q.magnitude);
      const pos = latLonToVec3(q.lat, q.lon, EARTH_R * 1.01);
      const quat = createTangentQuaternion(pos);
      const magFactor = Math.max(0.6, (q.magnitude - 2.0) / 3.5);

      const core = new THREE.Mesh(
        new THREE.SphereGeometry(0.0085 + magFactor * 0.007, 10, 10),
        new THREE.MeshBasicMaterial({ color: col })
      );
      core.position.copy(pos);
      core.userData = { target: { kind: "quake", data: q } } satisfies PickablePayload;
      quakesGroup.add(core);
      pickables.push(core);

      const waves = q.magnitude >= 4.5 ? 2 : 1;
      for (let w = 0; w < waves; w++) {
        const wave = new THREE.Mesh(
          new THREE.RingGeometry(0.012, 0.017, 24),
          new THREE.MeshBasicMaterial({
            color: col,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.85,
            depthWrite: false,
          })
        );
        wave.position.copy(pos);
        wave.quaternion.copy(quat);
        quakesGroup.add(wave);
        pulseRings.push({
          mesh: wave,
          phase: (i * 0.23 + w * 0.5) % 1,
          baseScale: 0.9,
          maxScale: 2.0 + magFactor * 3.4,
          speed: 0.42 + magFactor * 0.25,
        });
      }
    }

    // C. NASA EONET Natural Events
    for (const ev of events) {
      const col = eventColor(ev.category);
      const pos = latLonToVec3(ev.lat, ev.lon, EARTH_R * 1.012);
      const beacon = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.014, 0),
        new THREE.MeshBasicMaterial({ color: col })
      );
      beacon.position.copy(pos);
      beacon.userData = { target: { kind: "event", data: ev } } satisfies PickablePayload;
      eventsGroup.add(beacon);
      pickables.push(beacon);

      const halo = new THREE.Mesh(
        new THREE.RingGeometry(0.018, 0.023, 6),
        new THREE.MeshBasicMaterial({
          color: col,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.58,
          depthWrite: false,
        })
      );
      halo.position.copy(pos);
      halo.quaternion.copy(createTangentQuaternion(pos));
      eventsGroup.add(halo);
    }

    // D. Live SGP4 Propagated Orbital Satellites + 3D Tracks
    for (const sat of satellites) {
      const isSelected =
        (selectedTarget?.kind === "satellite" && selectedTarget.id === sat.id) ||
        lockedSatId === sat.id;
      const isStation = sat.category === "station";
      const satR = satAltitudeToRadius(sat.altitudeKm);
      const satPos = latLonToVec3(sat.lat, sat.lon, satR);
      const satColor =
        sat.id === "iss"
          ? 0xffffff
          : sat.id === "css"
            ? 0xffcf4d
            : isSelected
              ? 0xffffff
              : palette.accent;

      const body = new THREE.Mesh(
        new THREE.OctahedronGeometry(isStation ? 0.018 : 0.013, 0),
        new THREE.MeshBasicMaterial({ color: satColor })
      );
      body.position.copy(satPos);
      body.userData = {
        target: { kind: "satellite", id: sat.id },
      } satisfies PickablePayload;
      satsGroup.add(body);
      pickables.push(body);

      const nadirPos = latLonToVec3(sat.lat, sat.lon, EARTH_R * 1.01);
      const nadirGeo = new THREE.BufferGeometry().setFromPoints([satPos, nadirPos]);
      const nadirLine = new THREE.Line(
        nadirGeo,
        new THREE.LineBasicMaterial({
          color: satColor,
          transparent: true,
          opacity: isSelected || isStation ? 0.58 : 0.24,
          depthWrite: false,
        })
      );
      satsGroup.add(nadirLine);

      if (isSelected || isStation) {
        const footRad = Math.min(0.28, Math.max(0.06, sat.footprintKm / 14000));
        const footRing = new THREE.Mesh(
          new THREE.RingGeometry(footRad - 0.004, footRad, 40),
          new THREE.MeshBasicMaterial({
            color: satColor,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: isSelected ? 0.45 : 0.22,
            depthWrite: false,
          })
        );
        footRing.position.copy(nadirPos);
        footRing.quaternion.copy(createTangentQuaternion(nadirPos));
        satsGroup.add(footRing);
      }

      if (sat.orbitPath.length >= 2) {
        const orbitPts = sat.orbitPath.map((p) =>
          latLonToVec3(p.lat, p.lon, satAltitudeToRadius(p.altitudeKm))
        );
        const orbitGeo = new THREE.BufferGeometry().setFromPoints(orbitPts);
        const orbitLine = new THREE.Line(
          orbitGeo,
          new THREE.LineBasicMaterial({
            color: satColor,
            transparent: true,
            opacity: isSelected ? 0.88 : isStation ? 0.45 : 0.18,
            depthWrite: false,
          })
        );
        satsGroup.add(orbitLine);
      }

      if (layers.satellites && (isStation || isSelected)) {
        labelAnchors.push({
          id: `sat-${sat.id}`,
          label: locale === "zh" ? sat.nameZh : sat.name,
          sub: `${Math.round(sat.altitudeKm)} km`,
          position: satPos.clone().multiplyScalar(1.03),
          kind: "sat",
        });
      }
    }

    if (selectedTarget && selectedTarget.kind !== "satellite") {
      if (selectedTarget.kind === "quake") {
        labelAnchors.push({
          id: "sel-target",
          label: `M${selectedTarget.data.magnitude.toFixed(1)}`,
          sub: selectedTarget.data.place.slice(0, 26),
          position: latLonToVec3(
            selectedTarget.data.lat,
            selectedTarget.data.lon,
            EARTH_R * 1.03
          ),
          kind: "selected",
        });
      } else if (selectedTarget.kind === "flight") {
        labelAnchors.push({
          id: "sel-target",
          label: `✈ ${selectedTarget.data.callsign}`,
          sub: `${Math.round(selectedTarget.data.altitudeM)}m`,
          position: latLonToVec3(
            selectedTarget.data.lat,
            selectedTarget.data.lon,
            EARTH_R * 1.032
          ),
          kind: "selected",
        });
      } else if (selectedTarget.kind === "event") {
        labelAnchors.push({
          id: "sel-target",
          label: selectedTarget.data.title.slice(0, 24),
          position: latLonToVec3(
            selectedTarget.data.lat,
            selectedTarget.data.lon,
            EARTH_R * 1.03
          ),
          kind: "selected",
        });
      } else if (selectedTarget.kind === "probe") {
        labelAnchors.push({
          id: "sel-target",
          label: locale === "zh" ? "坐标探测点" : "SURFACE PROBE",
          sub: `${selectedTarget.lat.toFixed(2)}°, ${selectedTarget.lon.toFixed(2)}°`,
          position: latLonToVec3(
            selectedTarget.lat,
            selectedTarget.lon,
            EARTH_R * 1.03
          ),
          kind: "selected",
        });
      }
    }

    refs.pulseRings = pulseRings;
    refs.pickables = pickables;
    refs.labelAnchors = labelAnchors;
  }, [quakes, satellites, events, selectedTarget, lockedSatId, theme, locale, layers.hubs, layers.satellites]);

  // 6. Trigger smooth camera SLERP fly-to
  useEffect(() => {
    const refs = sceneRefs.current;
    if (!cameraTarget || !refs.camera) return;

    const targetDistance = cameraTarget.distance ?? 2.25;
    const endPos = latLonToVec3(cameraTarget.lat, cameraTarget.lon, targetDistance);

    if (cameraTarget.instant) {
      refs.camera.position.copy(endPos);
      refs.flyAnim.active = false;
      return;
    }

    refs.flyAnim = {
      active: true,
      startPos: refs.camera.position.clone(),
      endPos,
      startTime: performance.now(),
      duration: 1050,
    };
  }, [cameraTarget]);

  return (
    <div className="relative h-full w-full overflow-hidden select-none">
      <div
        ref={containerRef}
        className={`h-full w-full ${
          measureMode
            ? "cursor-crosshair"
            : "cursor-grab active:cursor-grabbing"
        }`}
        aria-label="Interactive 3D Global Telemetry Earth"
      />
      <div
        ref={labelLayerRef}
        className="pointer-events-none absolute inset-0 overflow-hidden"
        aria-hidden="true"
      />
    </div>
  );
}
