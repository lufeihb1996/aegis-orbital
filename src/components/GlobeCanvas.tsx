"use client";

import React, { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  buildCoastlineSegments,
  createProceduralEarthTextures,
} from "@/lib/earth-textures";
import {
  EARTH_RADIUS_KM,
  getSubsolarPoint,
  latLonToVector3Tuple,
  vector3ToLatLon,
} from "@/lib/geo";
import { SUBMARINE_CABLES, WORLD_HUBS } from "@/lib/world-data";
import type {
  CameraTarget,
  LayerVisibility,
  Locale,
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
  events: NaturalEvent[];
  selectedTarget: SelectedTarget | null;
  lockedSatId: string | null;
  autoRotate: boolean;
  cameraTarget: CameraTarget | null;
  onSelectTarget: (target: SelectedTarget) => void;
  onUserInteract?: () => void;
}

const EARTH_R = 1.0;
const UP_VEC = new THREE.Vector3(0, 0, 1);

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
  },
  phosphor: {
    accent: 0x34f599,
    atmo: 0x38d9a9,
    border: 0x5ef9ae,
    cable: 0x22c97a,
    packet: 0xb8ffdd,
    hub: 0x4ef7a4,
    ring: 0x34f599,
  },
  amber: {
    accent: 0xffb443,
    atmo: 0x62b4ff,
    border: 0xffcf7d,
    cable: 0xf59f33,
    packet: 0xffe8b8,
    hub: 0xffc66b,
    ring: 0xffb443,
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

    // Subtle topographic mountain relief shading from elevation map
    float hC = texture2D(uBumpTex, vUv).r;
    float hR = texture2D(uBumpTex, vUv + vec2(0.0012, 0.0)).r;
    float hU = texture2D(uBumpTex, vUv + vec2(0.0, 0.0018)).r;
    float relief = ((hC - hR) + (hC - hU)) * (1.0 - oceanMask) * 1.9;

    float ndotl = dot(N, L);
    // Crisp, unmistakable Apple Maps Day / Night split
    float dayMask = uUseTerminator > 0.5 ? smoothstep(-0.075, 0.135, ndotl) : 1.0;
    float nightMask = uUseTerminator > 0.5 ? smoothstep(0.085, -0.115, ndotl) : 0.0;

    // 1. VIVID SUNLIT DAY HEMISPHERE (Apple Maps bright sapphire ocean + lush continents)
    float sunDiffuse = clamp(ndotl + relief * 0.22, 0.0, 1.0);
    float dayLightCurve = 0.58 + 0.72 * pow(sunDiffuse, 0.62);

    vec3 daySurface = rawDay;
    // Lift sunlit deep ocean into crisp Apple Maps daylight azure while preserving shallow reefs
    vec3 azureLift = vec3(0.045, 0.155, 0.31) * oceanMask * (0.45 + 0.55 * sunDiffuse);
    daySurface = daySurface * (1.28 * dayLightCurve) + azureLift;
    // Gently enrich land saturation on sunlit half
    float luma = dot(daySurface, vec3(0.299, 0.587, 0.114));
    daySurface = mix(vec3(luma), daySurface, 1.14);

    // Sunlit specular ocean glint
    vec3 H = normalize(L + V);
    float specPow = mix(36.0, 56.0, uHasRealTex);
    float oceanSpec = pow(max(dot(N, H), 0.0), specPow) * oceanMask * dayMask * 0.52;
    daySurface += vec3(0.95, 0.98, 1.0) * oceanSpec;

    // 2. DRAMATIC DEEP NIGHT HEMISPHERE + GOLDEN BLACK MARBLE CITY LIGHTS
    // Deep midnight obsidian ocean & faint slate-blue unlit continents
    vec3 nightBase = mix(
      vec3(0.022, 0.036, 0.068),
      vec3(0.008, 0.016, 0.038),
      oceanMask
    );
    // Subtle moonlight landmass silhouette hint
    nightBase += rawDay * 0.045 * (1.0 - oceanMask);

    // Isolate crisp golden human city lights from Black Marble texture (strips dark blue desert haze)
    float citySignal = uHasRealTex > 0.5
      ? smoothstep(0.09, 0.34, rawNight.r * 1.25 + rawNight.g * 0.42 - rawNight.b * 0.55)
      : smoothstep(0.18, 0.65, rawNight.r * 0.8 + rawNight.g * 0.6);

    vec3 goldenCities =
      vec3(1.0, 0.77, 0.34) * citySignal * 2.25 +
      vec3(1.0, 0.93, 0.72) * pow(citySignal, 2.4) * 1.45;
    vec3 nightSurface = nightBase + goldenCities * (0.7 + 0.3 * nightMask);

    // Blend vivid Day and dramatic Night sharply across real-time terminator
    vec3 color = mix(nightSurface, daySurface, dayMask);

    // 3. GOLDEN-HOUR TWILIGHT SCATTERING RIGHT ALONG THE TERMINATOR
    if (uUseTerminator > 0.5) {
      float duskBand = exp(-pow((ndotl - 0.015) * 11.5, 2.0));
      vec3 twilightWarm = mix(vec3(1.0, 0.44, 0.14), vec3(0.96, 0.62, 0.32), oceanMask);
      color += twilightWarm * duskBand * 0.32;
    }

    // 4. REALISTIC RAYLEIGH ATMOSPHERE RIM ON PLANET EDGE (bright blue on day limb, faint on night)
    float fresnel = pow(1.0 - max(dot(N, V), 0.0), 3.6);
    vec3 dayAtmo = mix(vec3(0.32, 0.68, 1.0), uAccentColor, 0.22);
    vec3 nightAtmo = vec3(0.05, 0.12, 0.28);
    color += mix(nightAtmo, dayAtmo, dayMask) * fresnel * (0.16 + 0.62 * dayMask);

    gl_FragColor = vec4(color, 1.0);
  }
`;

// Dedicated 3D Floating Cloud Layer Shader (bright sunlit white by day, peach at dusk, transparent at night)
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

    // Keep clouds crisp on sunlit side & ultra-faint on night side so city lights stay razor clear
    float alpha = cloud * mix(0.06, 0.52, dayLit);
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

interface PickablePayload {
  target: SelectedTarget;
}

export function GlobeCanvas({
  theme,
  locale,
  layers,
  quakes,
  satellites,
  events,
  selectedTarget,
  lockedSatId,
  autoRotate,
  cameraTarget,
  onSelectTarget,
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
    events,
    selectedTarget,
    lockedSatId,
    autoRotate,
    onSelectTarget,
    onUserInteract,
  });
  propsRef.current = {
    theme,
    locale,
    layers,
    quakes,
    satellites,
    events,
    selectedTarget,
    lockedSatId,
    autoRotate,
    onSelectTarget,
    onUserInteract,
  };

  const sceneRefs = useRef<{
    earthMat?: THREE.ShaderMaterial;
    cloudsMat?: THREE.ShaderMaterial;
    cloudsMesh?: THREE.Mesh;
    atmoMat?: THREE.ShaderMaterial;
    borderLines?: THREE.LineSegments;
    borderMat?: THREE.LineBasicMaterial;
    orbitalRingsGroup?: THREE.Group;
    quakesGroup?: THREE.Group;
    satsGroup?: THREE.Group;
    eventsGroup?: THREE.Group;
    cablesGroup?: THREE.Group;
    hubsGroup?: THREE.Group;
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
    // Start framed dramatically across the LIVE real-time Day/Night Terminator (Apple Maps hero framing)
    const subsolar = getSubsolarPoint();
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
    controls.maxDistance = 5.2;
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
      const r = 14 + Math.random() * 28;
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

    // Instant zero-flash procedural fallback textures, seamlessly upgraded by self-hosted NASA Blue/Black Marble maps
    const procTextures = createProceduralEarthTextures();
    const loadedTextures: THREE.Texture[] = [];
    const palette = THEME_PALETTE[propsRef.current.theme];

    const sunDir = latLonToVec3(subsolar.lat, subsolar.lon, 1).normalize();

    // Neutral flat fallback bump/cloud textures before NASA maps resolve (~20ms)
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

    // Dedicated 3D Atmospheric Cloud Layer Sphere
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

    // Load self-hosted NASA Blue Marble, Black Marble, Water Mask, Topology Bump & Clouds from /textures/
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

    // Volumetric Apple-Style Atmospheric Rayleigh Halo
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

    // Subtle Crisp 3D Vector Borders & Coastlines (delicate so Blue/Black Marble shines through)
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

    // Dynamic Layer Groups
    const quakesGroup = new THREE.Group();
    const satsGroup = new THREE.Group();
    const eventsGroup = new THREE.Group();
    const cablesGroup = new THREE.Group();
    const hubsGroup = new THREE.Group();
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
      reticleGroup
    );

    // Submarine Cables & Data Packets
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
        const lineGeo = new THREE.BufferGeometry().setFromPoints(
          curve.getPoints(48)
        );
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
      cloudsMat,
      cloudsMesh,
      atmoMat,
      borderLines,
      borderMat,
      orbitalRingsGroup,
      quakesGroup,
      satsGroup,
      eventsGroup,
      cablesGroup,
      hubsGroup,
      reticleGroup,
      cablePackets,
      camera,
      controls,
    };

    // Raycasting for crisp click-to-inspect & click-anywhere surface probe
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
    const clock = new THREE.Clock();
    let sunTimer = 0;
    let rafId = 0;

    const labelPool = new Map<string, HTMLDivElement>();

    const animate = () => {
      rafId = requestAnimationFrame(animate);
      const dt = Math.min(clock.getDelta(), 0.05);
      const elapsed = clock.getElapsedTime();
      const refs = sceneRefs.current;
      const curProps = propsRef.current;

      // Refresh exact real-time solar vector every 15 seconds
      sunTimer += dt;
      if (sunTimer > 15) {
        sunTimer = 0;
        const sp = getSubsolarPoint();
        const sd = latLonToVec3(sp.lat, sp.lon, 1).normalize();
        earthMat.uniforms.uSunDir.value.copy(sd);
        cloudsMat.uniforms.uSunDir.value.copy(sd);
        atmoMat.uniforms.uSunDir.value.copy(sd);
      }

      // Gentle realistic eastward atmospheric cloud drift
      if (cloudsMesh.visible) {
        cloudsMesh.rotation.y = elapsed * 0.0045;
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
      loadedTextures.forEach((t) => t.dispose());
      fallbackBump.dispose();
      fallbackCloud.dispose();
      earthGeo.dispose();
      earthMat.dispose();
      cloudsGeo.dispose();
      cloudsMat.dispose();
      atmoGeo.dispose();
      atmoMat.dispose();
      coastGeo.dispose();
      borderMat.dispose();
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

  // 2. Sync Theme & Layer visibility smoothly without rebuilding WebGL
  useEffect(() => {
    const refs = sceneRefs.current;
    const palette = THEME_PALETTE[theme];
    const termVal = layers.terminator ? 1.0 : 0.0;

    if (refs.earthMat) {
      refs.earthMat.uniforms.uAccentColor.value.setHex(palette.accent);
      refs.earthMat.uniforms.uUseTerminator.value = termVal;
    }
    if (refs.cloudsMat) {
      refs.cloudsMat.uniforms.uUseTerminator.value = termVal;
    }
    if (refs.cloudsMesh) refs.cloudsMesh.visible = layers.clouds;
    if (refs.atmoMat) {
      refs.atmoMat.uniforms.uAtmoColor.value.setHex(palette.atmo);
      refs.atmoMat.uniforms.uUseTerminator.value = termVal;
    }
    if (refs.borderMat) {
      refs.borderMat.color.setHex(palette.border);
    }
    if (refs.borderLines) refs.borderLines.visible = layers.borders;
    if (refs.quakesGroup) refs.quakesGroup.visible = layers.quakes;
    if (refs.satsGroup) refs.satsGroup.visible = layers.satellites;
    if (refs.eventsGroup) refs.eventsGroup.visible = layers.events;
    if (refs.cablesGroup) refs.cablesGroup.visible = layers.cables;
    if (refs.hubsGroup) refs.hubsGroup.visible = layers.hubs;

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
  }, [theme, layers]);

  // 3. Rebuild Dynamic Markers (Quakes, Satellites, Events, Hubs) cleanly on data update
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
          phase: ((i * 0.23 + w * 0.5) % 1),
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

  // 4. Trigger smooth camera SLERP fly-to on cameraTarget change
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
        className="h-full w-full cursor-grab active:cursor-grabbing"
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
