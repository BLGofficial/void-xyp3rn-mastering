// Procedural mastering orb (three.js points + bloom). Public API as delivered:
// setProgress(0..1), setTransient(level), triggerLockPulse(), start/stop/destroy;
// plus the engine's live telemetry: setReduction, setPeak and setPhase, so every
// motion maps to something the render is actually doing.
// Fixes over the original: the lock pulse now decays (it read getDelta() right
// after getElapsedTime(), which always returned ~0), destroy() releases the GPU
// context, size follows the container, and the palette keeps to studio colours
// (Amber is reserved for XYP3RN Records; scan highlight is Cloud, not white).

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

const clamp01 = (v: number) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));

/**
 * Point size scale for a canvas height. The shader's sizes were tuned on a ~860 px tall
 * full-screen canvas; additive points keep the same coverage (and brightness) only if
 * their size follows the canvas, otherwise a small orb saturates to a white blob.
 */
const pointScale = (height: number) => Math.max(0.3, Math.min(1.2, height / 860));
/** Bloom glows a fixed pixel radius, so a small orb needs less of it to keep its particle detail. */
const bloomStrength = (height: number) => 0.45 + 0.25 * Math.max(0, Math.min(1, (height - 260) / 500));

const VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uRadius;
  uniform float uProgress;
  uniform float uTransient;
  uniform float uLockPulse;
  uniform float uPixelRatio;
  uniform float uScale;     // canvas height / reference height: keeps point coverage constant at any size
  uniform float uReduction; // 0..1: compressor + limiter gain reduction
  uniform float uPeak;      // 0..1: block peak approaching full scale
  uniform float uMeasure;   // 0..1: loudness measurement stage
  uniform float uGuard;     // 0..1: true-peak check stage

  varying float vAlpha;
  varying float vRidge;
  varying vec3 vUnitPos;
  varying float vAiScan;

  vec4 permute(vec4 x){return mod(((x*34.0)+1.0)*x, 289.0);}
  vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314 * r;}

  float snoise(vec3 v){
    const vec2 C = vec2(1.0/6.0, 1.0/3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i  = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + 1.0 * C.xxx;
    vec3 x2 = x0 - i2 + 2.0 * C.xxx;
    vec3 x3 = x0 - 1.0 + 3.0 * C.xxx;
    i = mod(i, 289.0);
    vec4 p = permute(permute(permute(
              i.z + vec4(0.0, i1.z, i2.z, 1.0))
            + i.y + vec4(0.0, i1.y, i2.y, 1.0))
            + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 1.0/7.0;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z *ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ *ns.x + ns.yyyy;
    vec4 y = y_ *ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0)*2.0 + 1.0;
    vec4 s1 = floor(b1)*2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
    vec3 p0 = vec3(a0.xy,h.x);
    vec3 p1 = vec3(a0.zw,h.y);
    vec3 p2 = vec3(a1.xy,h.z);
    vec3 p3 = vec3(a1.zw,h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
  }

  void main() {
    vec3 norm = normalize(normal);
    float t = uTime * (0.24 + uProgress * 0.16);

    float n1 = snoise(norm * 0.90 + vec3(t, -t * 0.7, t * 0.5));
    float n2 = snoise(norm * 1.80 - vec3(t * 0.6, t * 0.9, -t * 0.4));

    vec3 tangent = normalize(cross(norm, vec3(0.0, 1.0, 0.2)));
    vec3 bitangent = cross(norm, tangent);
    vec3 sphereDir = normalize(norm + tangent * (n2 * 0.18) + bitangent * (n1 * 0.15));

    float rawChaos = (1.0 - uProgress);
    float aiJitter = snoise(sphereDir * 5.5 + uTime * 3.5) * rawChaos * 0.20;
    float inwardFold = smoothstep(-0.15, 0.85, n1 * 0.6 + n2 * 0.4) * mix(0.14, 0.22, uProgress);

    float scanWave = sin(sphereDir.y * 14.0 - uTime * 9.0) * (1.0 - uProgress);
    float lockShockwave = sin(sphereDir.y * 8.0 - uLockPulse * 12.0) * exp(-uLockPulse * 3.2) * step(0.01, uLockPulse) * 0.12;

    // Measuring: a bright latitude ring sweeps the shell, like a meter reading the whole file.
    float sweepY = sin(uTime * 1.6);
    float sweepBand = exp(-pow((sphereDir.y - sweepY) * 6.0, 2.0)) * uMeasure;

    // Gain reduction squeezes the shell inward; the peak check tightens it to the ceiling.
    float finalRadius = uRadius - inwardFold + aiJitter + scanWave * 0.07 + uTransient * 0.12 + lockShockwave
      - uReduction * 0.16 - uGuard * 0.05 + sweepBand * 0.06;
    vec3 pos = sphereDir * finalRadius;

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    vec3 viewDir = normalize(-mvPosition.xyz);
    vec3 viewNormal = normalize(normalMatrix * sphereDir);
    float fresnel = 1.0 - abs(dot(viewNormal, viewDir));
    float rimGlow = pow(fresnel, 1.7);

    float shellMask = snoise(sphereDir * 1.1 + vec3(t * 0.4, t * 0.3, -t * 0.5));
    float innerWindow = smoothstep(-0.28, 0.22, shellMask + abs(sphereDir.x) * 0.35);
    float visibility = max(innerWindow, rimGlow * (0.82 + uProgress * 0.18));

    vRidge = clamp(rimGlow * 1.1 + abs(n2) * 0.65 + abs(scanWave) * 0.6 + uReduction * 0.2 + uPeak * 0.45 + uGuard * rimGlow * 0.3, 0.0, 1.7);
    vAlpha = visibility * (0.22 + vRidge * 0.78);
    vUnitPos = sphereDir;
    vAiScan = rawChaos * 0.85 + abs(scanWave) * 0.6 + sweepBand * 0.8 + uPeak * 0.4;

    gl_PointSize = (2.4 + vRidge * 1.8 + rawChaos * 1.6) * uPixelRatio * uScale * (1.0 / -mvPosition.z);
  }
`;

const FRAGMENT = /* glsl */ `
  uniform float uProgress;
  varying float vAlpha;
  varying float vRidge;
  varying vec3 vUnitPos;
  varying float vAiScan;

  void main() {
    if (vAlpha < 0.025) discard;
    float d = length(gl_PointCoord - vec2(0.5));
    if (d > 0.5) discard;
    float soft = smoothstep(0.5, 0.08, d);

    // Studio palette: Gold #FACD68, Gold Dim #C9A03E, Cloud #E8E8E8 for the scan highlight.
    vec3 xypGold = vec3(0.98, 0.80, 0.41);
    vec3 goldDim = vec3(0.79, 0.63, 0.24);
    vec3 cloud   = vec3(0.91, 0.91, 0.91);

    float sideMix = smoothstep(-0.9, 0.9, vUnitPos.x);
    vec3 col = mix(xypGold, goldDim, sideMix);

    // Was an Amber (#F0B942) zone; Amber is reserved for XYP3RN Records, so this warms toward Gold instead.
    float warmZone = smoothstep(0.35, -0.75, vUnitPos.x) * smoothstep(0.55, -0.55, vUnitPos.y);
    col = mix(col, xypGold, warmZone * 0.65);

    col = mix(col, cloud, vAiScan * 0.45);
    col += vec3(0.16, 0.12, 0.02) * pow(vRidge, 2.0);

    gl_FragColor = vec4(col, soft * vAlpha * (0.78 + uProgress * 0.18));
  }
`;

/** Seconds the completion shockwave runs before resetting. */
const LOCK_PULSE_SECONDS = 2.5;

/** What the engine is doing; selects the orb's stage motion. */
export type OrbPhase = 'analyse' | 'render' | 'measure' | 'peak' | 'locked';

/** Ease `current` toward `target`: `attack` per second rising, `release` falling. */
const follow = (current: number, target: number, delta: number, attack: number, release: number) =>
  current + (target - current) * Math.min(1, delta * (target > current ? attack : release));

export class XYP3RNMasteringOrb {
  private readonly container: HTMLElement;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly controls: OrbitControls;
  private readonly geometry: THREE.SphereGeometry;
  private readonly material: THREE.ShaderMaterial;
  private readonly orb: THREE.Points;
  private readonly resize: ResizeObserver;
  private readonly clock = new THREE.Clock();
  /** True on software WebGL (SwiftShader, llvmpipe, …): there the orb runs at a few fps and stalls the page. */
  readonly software: boolean;
  private frame = 0;
  private animating = false;
  private lastElapsed = 0;
  /** Smoothed transient: instant attack, eased release, so block-rate levels don't strobe. */
  private transientTarget = 0;
  private reductionTarget = 0;
  private peakTarget = 0;
  private measureTarget = 0;
  private guardTarget = 0;

  /** Throws if WebGL is unavailable; callers fall back to a non-WebGL visual. */
  constructor(container: HTMLElement) {
    this.container = container;
    const { width, height } = this.size();
    // FOV 46 keeps the orb inside portrait (phone) viewports.
    this.camera = new THREE.PerspectiveCamera(46, width / height, 0.1, 100);
    this.camera.position.set(0, 0, 6.2);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    const gl = this.renderer.getContext();
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const name = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
    this.software = /swiftshader|llvmpipe|softpipe|software|basic render/i.test(name);
    this.renderer.domElement.setAttribute('aria-hidden', 'true');
    this.renderer.domElement.style.display = 'block';
    container.appendChild(this.renderer.domElement);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(width, height), bloomStrength(height), 0.45, 0.16);
    this.composer.addPass(this.bloom);

    // 180x135 (~24k points, a third fewer than before) keeps mobile GPUs at 60 fps.
    const radius = 1.1;
    this.geometry = new THREE.SphereGeometry(radius, 180, 135);
    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uRadius: { value: radius },
        uProgress: { value: 0 },
        uTransient: { value: 0 },
        uLockPulse: { value: 0 },
        uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
        uScale: { value: pointScale(height) },
        uReduction: { value: 0 },
        uPeak: { value: 0 },
        uMeasure: { value: 0 },
        uGuard: { value: 0 },
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
    });
    this.orb = new THREE.Points(this.geometry, this.material);
    this.scene.add(this.orb);

    // Drag to orbit. No zoom or pan: they collide with page pinch/scroll gestures.
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.enablePan = false;
    this.controls.enableZoom = false;
    this.controls.rotateSpeed = 0.8;
    this.renderer.domElement.style.touchAction = 'none';

    this.resize = new ResizeObserver(() => this.onResize());
    this.resize.observe(container);
    this.start();
  }

  /** 0 = analysing (chaotic, scanning) .. 1 = master locked (settled). */
  setProgress(value: number): void {
    this.material.uniforms.uProgress!.value = Math.max(0, Math.min(1, value));
  }

  /** Audio energy, 0..1. */
  setTransient(value: number): void {
    this.transientTarget = clamp01(value);
  }

  /** Gain reduction the chain applies right now, 0..1 (callers map dB). */
  setReduction(value: number): void {
    this.reductionTarget = clamp01(value);
  }

  /** Block peak against full scale, 0..1: flashes the ridges as the master nears the ceiling. */
  setPeak(value: number): void {
    this.peakTarget = clamp01(value);
  }

  /** Engine stage: measuring sweeps a ring over the shell; the peak check tightens it. */
  setPhase(phase: OrbPhase): void {
    this.measureTarget = phase === 'measure' ? 1 : 0;
    this.guardTarget = phase === 'peak' ? 1 : 0;
    if (phase !== 'render') { this.reductionTarget = 0; this.peakTarget = 0; }
  }

  /** Completion shockwave. */
  triggerLockPulse(): void {
    this.material.uniforms.uLockPulse!.value = 0.01;
  }

  start(): void {
    if (this.animating) return;
    this.animating = true;
    this.lastElapsed = this.clock.getElapsedTime();
    this.frame = requestAnimationFrame(this.animate);
  }

  stop(): void {
    this.animating = false;
    cancelAnimationFrame(this.frame);
  }

  /** Stops the loop and releases every GPU resource, including the WebGL context. */
  destroy(): void {
    this.stop();
    this.resize.disconnect();
    this.controls.dispose();
    this.geometry.dispose();
    this.material.dispose();
    this.bloom.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }

  private readonly animate = (): void => {
    if (!this.animating) return;
    this.frame = requestAnimationFrame(this.animate);
    const elapsed = this.clock.getElapsedTime();
    const delta = elapsed - this.lastElapsed;
    this.lastElapsed = elapsed;
    const u = this.material.uniforms;
    u.uTime!.value = elapsed;

    const current = u.uTransient!.value as number;
    u.uTransient!.value = this.transientTarget > current ? this.transientTarget : current + (this.transientTarget - current) * Math.min(1, delta * 6);

    u.uReduction!.value = follow(u.uReduction!.value as number, this.reductionTarget, delta, 12, 3);
    // Peaks: near-instant flash, quick decay, so each hit reads as a hit.
    u.uPeak!.value = follow(u.uPeak!.value as number, this.peakTarget, delta, 30, 8);
    this.peakTarget *= Math.max(0, 1 - delta * 8);
    u.uMeasure!.value = follow(u.uMeasure!.value as number, this.measureTarget, delta, 3, 3);
    u.uGuard!.value = follow(u.uGuard!.value as number, this.guardTarget, delta, 3, 3);

    const lock = u.uLockPulse!.value as number;
    if (lock > 0) u.uLockPulse!.value = lock + delta > LOCK_PULSE_SECONDS ? 0 : lock + delta;

    const progress = u.uProgress!.value as number;
    this.orb.rotation.y = elapsed * (0.12 + (1 - progress) * 0.18);
    this.orb.rotation.z = Math.sin(elapsed * 0.22) * 0.12;
    this.controls.update();
    this.composer.render();
  };

  private size() {
    return { width: Math.max(1, this.container.clientWidth), height: Math.max(1, this.container.clientHeight) };
  }

  private onResize(): void {
    const { width, height } = this.size();
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.composer.setSize(width, height);
    this.material.uniforms.uPixelRatio!.value = Math.min(window.devicePixelRatio, 2);
    this.material.uniforms.uScale!.value = pointScale(height);
    this.bloom.strength = bloomStrength(height);
  }
}
