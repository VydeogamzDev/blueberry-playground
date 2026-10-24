import * as THREE from 'three';
import { DEFAULT_ZOOM, MAX_ZOOM, MIN_ZOOM, PX, WORLD } from './constants';
import { clamp, type V2 } from './math';
import { Sprites } from './Sprites';

THREE.ColorManagement.enabled = false;

/** The least of the world a view starts with, across the screen and up it (m): a small screen's (a phone's) zooms out to fit it. */
const FIT = { w: 7, h: 7.5 };
/** The least a view keeps below the floor (m), so what stands on it shows whole, above the screen's bottom edge. */
const FLOOR_MARGIN = 1.6;
/** Where the screen's turned or resized, the floor stays as far down it as it was (or, out of sight, the world this share of the way down). */
const KEEP_AT = 0.75;

/** Shared unit quad for the full-screen passes and simple meshes (walls' trims, lamps' glow). */
export const UNIT_QUAD = new THREE.PlaneGeometry(1, 1);

export function makePixelTexture(canvas: HTMLCanvasElement | OffscreenCanvas): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas as HTMLCanvasElement);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

const BG_FRAG = /* glsl */ `
uniform vec2 uCam;
uniform vec2 uRes;
uniform vec2 uCenter;
uniform float uScale;
uniform float uGrid;
uniform float uPx;
uniform vec4 uBounds;
uniform vec3 uBase;
uniform vec3 uTop;
uniform vec3 uFar;
uniform float uPanels;
uniform float uGradH;
varying vec2 vUv;

float lineMask(float w, float period, float thick) {
  float m = mod(w, period);
  return step(m, thick);
}

// (SKY, the backdrop's kind, is compiled in: a hall's wall never pays for a sky)
#if SKY > 0
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

// smooth noise on a unit grid
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

// An open sky (SKY 1: day over hills, 2: desert over mesas, 3: night over a
// city) in flat bands, as if dithered by hand. fx: x on the far horizon, which
// drifts by slower than the world as the camera moves.
vec3 sky(vec2 sp, float fx) {
  float t = clamp(sp.y / uGradH, 0.0, 1.0);
  vec3 c = mix(uBase, uTop, floor(t * 9.0 + 0.5) / 9.0);
  float h = 0.0;
#if SKY < 3
  // clouds: lumps of noise in two tones, high up
  vec2 q = vec2(fx / 14.0, sp.y / 4.0);
  float n = noise(q) * 0.65 + noise(q * 2.3 + 7.0) * 0.35;
  n *= smoothstep(10.0, 16.0, sp.y) * (1.0 - smoothstep(uGradH * 0.7, uGradH, sp.y));
#if SKY == 1
  float lim = 0.58;
#else
  float lim = 0.66;
#endif
  if (n > lim + 0.07) c = mix(c, vec3(0.97, 0.97, 0.95), 0.85);
  else if (n > lim) c = mix(c, vec3(0.97, 0.97, 0.95), 0.4);
  // rolling hills, or mesas over low dunes
#if SKY == 1
  h = 2.4 + 1.5 * sin(fx * 0.045) + 0.8 * sin(fx * 0.12 + 1.3);
#else
  h = 1.2 + 0.8 * sin(fx * 0.07) + 4.0 * step(0.62, noise(vec2(fx / 30.0, 3.0)));
#endif
  h = floor(h / uPx) * uPx;
  // (a lighter rim along the top)
  if (sp.y < h) c = sp.y >= h - uPx * 2.0 ? uFar * 1.12 : uFar;
  return c;
#else
  // stars: single pixels
  float s = hash(floor(vec2(fx, sp.y) / uPx));
  if (s > 0.9975 && sp.y > 8.0) c = mix(c, vec3(0.86, 0.88, 0.96), 0.35 + 0.65 * fract(s * 131.0));
  // a skyline of blocks 5 m apart, a few of their windows lit
  float b = floor(fx / 5.0);
  h = mod(fx, 5.0) > 4.2 ? 0.0 : 3.0 + floor(hash(vec2(b, 5.0)) * 12.0);
  if (sp.y < h) {
    vec2 w = mod(vec2(fx, sp.y), vec2(1.0, 1.25));
    float lit = step(0.78, hash(floor(vec2(fx, sp.y) / vec2(1.0, 1.25))));
    return w.x > 0.4 && w.x < 0.75 && w.y > 0.4 && w.y < 0.9 && lit > 0.5 ? mix(uFar, vec3(0.85, 0.7, 0.36), 0.55) : uFar;
  }
  return c;
#endif
}
#endif

void main() {
  vec2 world = uCam + (gl_FragCoord.xy - uCenter) / uScale;
  // snap to sprite pixel grid so the backdrop reads as pixel art
  vec2 sp = floor(world / uPx) * uPx;
  vec3 base = uBase;
#if SKY == 0
  // a hall: large wall panels with subtle alternating tone
  vec2 panel = floor(sp / 4.0);
  float checker = mod(panel.x + panel.y, 2.0);
  base *= 1.0 + checker * uPanels;
  // subtle vertical gradient: darker high up
  base *= mix(1.04, 0.86, clamp(sp.y / uGradH, 0.0, 1.0));
#else
  base = sky(sp, floor((world.x - uCam.x * 0.6) / uPx) * uPx);
#endif
  if (uGrid > 0.5) {
    float minor = max(lineMask(sp.x, 1.0, uPx * 0.5), lineMask(sp.y, 1.0, uPx * 0.5));
    float major = max(lineMask(sp.x, 4.0, uPx * 0.5), lineMask(sp.y, 4.0, uPx * 0.5));
    // fade the minor grid out when zoomed far away
    float minorFade = clamp((uScale - 6.0) / 30.0, 0.0, 1.0);
    base += vec3(0.026, 0.028, 0.03) * minor * minorFade;
    base += vec3(0.03, 0.032, 0.036) * major;
    // panel rivets at major intersections
    vec2 rv = mod(sp + uPx * 4.0, 4.0);
    if (rv.x < uPx * 2.0 && rv.y < uPx * 2.0) base += vec3(0.04);
  }
  // outside the sandbox: dark void
  if (world.x < uBounds.x || world.x > uBounds.y || world.y > uBounds.w) base *= 0.45;
  // vignette
  vec2 q = gl_FragCoord.xy / uRes - 0.5;
  base *= 1.0 - dot(q, q) * 0.55;
  gl_FragColor = vec4(base, 1.0);
}`;

const LIGHT_MAX = 16;

/**
 * Light map: a full-screen pass that scales everything drawn before it (backdrop,
 * floor, sprites, stains, connections) by ambient + nearby lights. The blend is
 * dst * 2 * src, so 0.5 leaves the scene unchanged and lights can brighten up to 2x.
 * Falloff is stepped in three bands on the art-pixel grid to match the sprites.
 */
const LIGHT_FRAG = /* glsl */ `
uniform vec2 uCam;
uniform vec2 uCenter;
uniform float uScale;
uniform float uPx;
uniform float uAmbient;
uniform int uLightN;
uniform vec4 uLights[${LIGHT_MAX}];
uniform vec3 uLightCol[${LIGHT_MAX}];
void main() {
  vec2 world = uCam + (gl_FragCoord.xy - uCenter) / uScale;
  vec2 sp = (floor(world / uPx) + 0.5) * uPx;
  vec3 L = vec3(uAmbient);
  for (int i = 0; i < ${LIGHT_MAX}; i++) {
    if (i >= uLightN) break;
    vec4 l = uLights[i];
    float d = distance(sp, l.xy) / l.z;
    float b = d < 0.3 ? 1.0 : d < 0.6 ? 0.55 : d < 1.0 ? 0.22 : 0.0;
    L += uLightCol[i] * (b * l.w);
  }
  gl_FragColor = vec4(clamp(L * 0.5, 0.0, 1.0), 1.0);
}`;

/** How the backdrop behind the world looks: a map's theme (see world/Environment). */
export interface Backdrop {
  /** 0: a hall's back wall of panels; 1: a day sky over hills; 2: a desert sky over mesas; 3: a night sky over a city. */
  sky: number;
  /** The wall's colour, or the sky's at the horizon; the sky's high up; the far horizon's (rgb 0..1). */
  base: [number, number, number];
  top: [number, number, number];
  far: [number, number, number];
  /** How much the wall's panels alternate in tone. */
  panels: number;
  /** The height (m) the wall darkens or the sky deepens over. */
  gradH: number;
  /** The colour the canvas is cleared to. */
  clear: number;
  /** A ceiling closes the world in: above it is the dark void (an open sky goes on up). */
  roofed: boolean;
}

interface Light {
  x: number;
  y: number;
  r: number;
  i: number;
  /** 0xRRGGBB. */
  c: number;
  life: number;
  max: number;
}

export class Renderer {
  readonly gl: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.OrthographicCamera;
  readonly canvas: HTMLCanvasElement;
  /** Every physics part's sprite, batched (see Sprites). */
  readonly sprites: Sprites;

  camX = 0;
  camY = 4;
  zoom = DEFAULT_ZOOM;
  targetZoom = DEFAULT_ZOOM;
  width = 1;
  height = 1;
  dpr = 1;
  /** Share of the screen's resolution drawn (Settings > Graphics): the picture is scaled up, pixel-sharp. */
  private resolution = 1;
  /** The most dynamic lights shown at once (Settings > Graphics; the shader takes LIGHT_MAX). */
  maxLights = LIGHT_MAX;
  showGrid = true;

  private bgMat: THREE.ShaderMaterial;
  private lightMat: THREE.ShaderMaterial;
  private lightMesh: THREE.Mesh;
  private lights: Light[] = [];
  private warmed = false;
  /** World brightness without lights (1 = day, lower = night). */
  ambient = 1;
  /** Screen pixels covered by UI on the left (and the right); the camera centers on the rest. */
  private inset = 0;
  private insetR = 0;
  private shakeAmt = 0;
  private shakeX = 0;
  private shakeY = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
    this.gl.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.gl.setClearColor(0x16171a, 1);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
    this.camera.position.z = 200;
    this.sprites = new Sprites(this.gl, this.scene);

    this.bgMat = new THREE.ShaderMaterial({
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy * 2.0, 0.999, 1.0); }`,
      fragmentShader: BG_FRAG,
      // (the lab's hall until a map sets its own: see setBackdrop())
      defines: { SKY: 0 },
      uniforms: {
        uCam: { value: new THREE.Vector2() },
        uRes: { value: new THREE.Vector2() },
        uCenter: { value: new THREE.Vector2() },
        uScale: { value: 1 },
        uGrid: { value: 1 },
        uPx: { value: 1 / 32 },
        uBounds: { value: new THREE.Vector4(WORLD.left, WORLD.right, WORLD.floor, WORLD.ceiling) },
        uBase: { value: new THREE.Vector3(0.157, 0.165, 0.176) },
        uTop: { value: new THREE.Vector3(0.157, 0.165, 0.176) },
        uFar: { value: new THREE.Vector3(0.157, 0.165, 0.176) },
        uPanels: { value: 0.018 },
        uGradH: { value: 45 },
      },
      depthWrite: false,
      depthTest: false,
    });
    const bg = new THREE.Mesh(UNIT_QUAD, this.bgMat);
    bg.frustumCulled = false;
    bg.renderOrder = -1000;
    this.scene.add(bg);

    this.lightMat = new THREE.ShaderMaterial({
      vertexShader: `void main(){ gl_Position = vec4(position.xy * 2.0, 0.0, 1.0); }`,
      fragmentShader: LIGHT_FRAG,
      uniforms: {
        uCam: { value: new THREE.Vector2() },
        uCenter: { value: new THREE.Vector2() },
        uScale: { value: 1 },
        uPx: { value: PX },
        uAmbient: { value: 1 },
        uLightN: { value: 0 },
        uLights: { value: Array.from({ length: LIGHT_MAX }, () => new THREE.Vector4()) },
        uLightCol: { value: Array.from({ length: LIGHT_MAX }, () => new THREE.Vector3()) },
      },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.DstColorFactor,
      blendDst: THREE.SrcColorFactor,
    });
    this.lightMesh = new THREE.Mesh(UNIT_QUAD, this.lightMat);
    this.lightMesh.frustumCulled = false;
    // after the world and smoke/blood particles, before fire, flashes and tracers
    this.lightMesh.renderOrder = 10.5;
    this.scene.add(this.lightMesh);

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  /** Draws this share of the screen's resolution from now on. */
  setResolution(r: number): void {
    if (r === this.resolution) return;
    this.resolution = r;
    this.resize();
  }

  resize(): void {
    // (sized before: the view's zoom goes with the fit and the floor keeps its place, as a phone is turned)
    let was: { fit: number; at: number; y: number; h: number } | null = null;
    if (this.width > 1) {
      const floor = this.worldToScreen(0, WORLD.floor).y / this.height;
      const at = floor > 0.05 && floor < 0.98 ? floor : KEEP_AT;
      was = { fit: this.fitZoom, at, y: this.camY - (this.height * (at - 0.5)) / this.zoom, h: this.height };
    }
    this.dpr = Math.min(window.devicePixelRatio || 1, 2) * this.resolution;
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.gl.setPixelRatio(this.dpr);
    this.gl.setSize(this.width, this.height, false);
    this.canvas.style.width = this.width + 'px';
    this.canvas.style.height = this.height + 'px';
    if (!was) {
      this.zoom = this.targetZoom = this.fitZoom;
      this.camY = WORLD.floor + this.floorLift;
    } else if (was.fit !== this.fitZoom || was.h !== this.height) {
      const k = this.fitZoom / was.fit;
      this.zoom = clamp(this.zoom * k, MIN_ZOOM, MAX_ZOOM);
      this.targetZoom = clamp(this.targetZoom * k, MIN_ZOOM, MAX_ZOOM);
      this.camY = was.y + (this.height * (was.at - 0.5)) / this.zoom;
      this.clampCamera();
    }
  }

  /** The zoom a view starts at: the usual one, or less on a small screen (a phone's), to fit a room's worth in. */
  get fitZoom(): number {
    // (the whole screen's width: the toybox coming and going doesn't change it)
    return clamp(Math.min(this.height / FIT.h, this.width / FIT.w), MIN_ZOOM, DEFAULT_ZOOM);
  }

  /** How high above the floor the view's middle goes to frame it (m): 4, less on a short screen, so the floor isn't down at its edge. */
  get floorLift(): number {
    return clamp(this.height / 2 / this.zoom - FLOOR_MARGIN, 1, 4);
  }

  /**
   * Adds a light for this frame, or for `life` seconds fading out (flashes).
   * `intensity` around 0.5 is a lamp; radius is where the light ends.
   */
  addLight(x: number, y: number, radius: number, intensity: number, color = 0xffe8b0, life = 0): void {
    this.lights.push({ x, y, r: radius, i: intensity, c: color, life, max: life });
  }

  /** A frame that isn't drawn (a hidden tab kept running): its lights come and go all the same. */
  skipFrame(dt: number): void {
    this.ageLights(dt);
  }

  /** Screen x (CSS px) of the camera center: the middle of the visible area. */
  get centerX(): number {
    return this.inset + (this.width - this.inset - this.insetR) / 2;
  }

  /** Width of the visible area (CSS px). */
  get viewWidth(): number {
    return this.width - this.inset - this.insetR;
  }

  /** Screen pixels covered on the left (the visible area starts there). */
  get insetLeft(): number {
    return this.inset;
  }

  /**
   * Sets how much of the left and the right of the screen is covered (the
   * toybox, on its side: see Layout). With keepView the camera shifts so
   * nothing on screen moves.
   */
  setInsets(left: number, right: number, keepView = true): void {
    const before = this.centerX;
    this.inset = Math.max(0, Math.min(left, this.width * 0.6));
    this.insetR = Math.max(0, Math.min(right, this.width * 0.6));
    if (keepView) this.camX += (this.centerX - before) / this.zoom;
  }

  /** Sets the backdrop to a map's, and the world's bounds (WORLD) that it darkens outside of. */
  setBackdrop(b: Backdrop): void {
    const u = this.bgMat.uniforms;
    if (this.bgMat.defines.SKY !== b.sky) {
      // (each kind of backdrop is its own shader)
      this.bgMat.defines.SKY = b.sky;
      this.bgMat.needsUpdate = true;
    }
    u.uBase.value.set(...b.base);
    u.uTop.value.set(...b.top);
    u.uFar.value.set(...b.far);
    u.uPanels.value = b.panels;
    u.uGradH.value = b.gradH;
    u.uBounds.value.set(WORLD.left, WORLD.right, WORLD.floor, b.roofed ? WORLD.ceiling : 1e9);
    this.gl.setClearColor(b.clear, 1);
  }

  shake(amount: number): void {
    this.shakeAmt = Math.min(1.5, this.shakeAmt + amount);
  }

  /** Zoom keeping the world point under (sx, sy) fixed. */
  zoomAt(sx: number, sy: number, factor: number): void {
    const before = this.screenToWorld(sx, sy);
    this.zoom = clamp(this.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    this.targetZoom = this.zoom;
    const after = this.screenToWorld(sx, sy);
    this.camX += before.x - after.x;
    this.camY += before.y - after.y;
    this.clampCamera();
  }

  clampCamera(): void {
    this.camX = clamp(this.camX, WORLD.left - 10, WORLD.right + 10);
    this.camY = clamp(this.camY, WORLD.floor - 10, WORLD.ceiling + 10);
  }

  screenToWorld(sx: number, sy: number): V2 {
    return {
      x: this.camX + (sx - this.centerX) / this.zoom,
      y: this.camY - (sy - this.height / 2) / this.zoom,
    };
  }

  worldToScreen(x: number, y: number): V2 {
    return {
      x: (x - this.camX) * this.zoom + this.centerX,
      y: -(y - this.camY) * this.zoom + this.height / 2,
    };
  }

  render(dt: number): void {
    // camera shake decays quickly
    if (this.shakeAmt > 0.001) {
      this.shakeX = (Math.random() * 2 - 1) * this.shakeAmt * 0.35;
      this.shakeY = (Math.random() * 2 - 1) * this.shakeAmt * 0.35;
      this.shakeAmt *= Math.exp(-dt * 9);
    } else {
      this.shakeX = this.shakeY = 0;
    }
    const scale = this.zoom * this.dpr;
    // snap camera to the device pixel grid to reduce sprite shimmer
    const cx = Math.round((this.camX + this.shakeX) * scale) / scale;
    const cy = Math.round((this.camY + this.shakeY) * scale) / scale;
    const hw = this.width / 2 / this.zoom;
    const hh = this.height / 2 / this.zoom;
    const cam = this.camera;
    cam.left = cx - this.centerX / this.zoom;
    cam.right = cx + (this.width - this.centerX) / this.zoom;
    cam.top = cy + hh;
    cam.bottom = cy - hh;
    cam.updateProjectionMatrix();

    const u = this.bgMat.uniforms;
    u.uCam.value.set(cx, cy);
    u.uRes.value.set(this.width * this.dpr, this.height * this.dpr);
    u.uCenter.value.set(this.centerX * this.dpr, (this.height * this.dpr) / 2);
    u.uScale.value = scale;
    u.uGrid.value = this.showGrid ? 1 : 0;
    // lights are culled against the whole canvas (its middle is left of the camera center)
    this.updateLights(cx, cy, cx + (this.width / 2 - this.centerX) / this.zoom, hw, hh, scale, dt);

    if (!this.warmed) {
      // The light pass is hidden until the first lamp or blast, and some drivers
      // only finish building a shader when it is first drawn: draw it once now
      // (with no lights at full ambient it leaves the picture as it is), not in
      // the middle of the first explosion.
      this.warmed = true;
      this.lightMesh.visible = true;
    }
    this.sprites.flush();
    this.gl.render(this.scene, cam);
  }

  /** Draw calls in the last rendered frame. */
  drawCalls(): number {
    return this.gl.info.render.calls;
  }

  private updateLights(cx: number, cy: number, midX: number, hw: number, hh: number, scale: number, dt: number): void {
    const u = this.lightMat.uniforms;
    // keep the lights that reach the screen, strongest first
    const vis = this.lights.filter((l) => Math.abs(l.x - midX) < hw + l.r && Math.abs(l.y - cy) < hh + l.r);
    const strength = (l: Light) => l.i * (l.max > 0 ? l.life / l.max : 1);
    vis.sort((a, b) => strength(b) * b.r - strength(a) * a.r);
    const n = Math.min(LIGHT_MAX, this.maxLights, vis.length);
    for (let k = 0; k < n; k++) {
      const l = vis[k];
      u.uLights.value[k].set(l.x, l.y, l.r, strength(l));
      u.uLightCol.value[k].set(((l.c >> 16) & 255) / 255, ((l.c >> 8) & 255) / 255, (l.c & 255) / 255);
    }
    u.uLightN.value = n;
    u.uAmbient.value = this.ambient;
    u.uCam.value.set(cx, cy);
    u.uCenter.value.set(this.centerX * this.dpr, (this.height * this.dpr) / 2);
    u.uScale.value = scale;
    this.lightMesh.visible = n > 0 || this.ambient < 0.999;
    this.ageLights(dt);
  }

  /** One-frame lights go now; flashes fade out over their life. */
  private ageLights(dt: number): void {
    const ls = this.lights;
    let n = 0;
    for (const l of ls) if ((l.life -= dt) > 0) ls[n++] = l;
    ls.length = n;
  }
}
