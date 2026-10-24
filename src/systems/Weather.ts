import * as THREE from 'three';
import { RAPIER } from '../engine/Physics';
import { PX, WORLD } from '../engine/constants';
import { clamp } from '../engine/math';
import { UNIT_QUAD } from '../engine/Renderer';
import { PK } from './Particles';
import { POWER, Powers } from '../tools/Controls';
import { VOID_DROP } from '../world/Environment';
import type { Game } from '../world/Game';
import type { Part } from '../world/Part';
import type { MapSpec, ThemeId } from '../world/Maps';

/**
 * The weather and the world's light: what Settings > World sets (as People
 * Playground's environment settings), saved with a scene and sent to a
 * multiplayer game's guests.
 */
export interface WeatherState {
  /** How hard it rains, snows and how thick the fog is: 0 none .. 1 the most. */
  rain: number;
  snow: number;
  fog: number;
  /** The chance of lightning, 0..100: at 100 a strike every 2 to 4 s, at 10 every 20 to 40 s. */
  lightning: number;
  /** The world's light without lamps: 1 day, 0.55 dusk, 0.2 night (see Renderer.ambient). */
  light: number;
}

export const CLEAR: Readonly<WeatherState> = { rain: 0, snow: 0, fog: 0, lightning: 0, light: 1 };

/** Weather as read from a save or a host, made safe: each value a number in its range (else `base`'s). */
export function cleanWeather(raw: unknown, base: Readonly<WeatherState> = CLEAR): WeatherState {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const num = (k: keyof WeatherState, lo: number, hi: number) => {
    const v = r[k];
    return typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : base[k];
  };
  return { rain: num('rain', 0, 1), snow: num('snow', 0, 1), fog: num('fog', 0, 1), lightning: num('lightning', 0, 100), light: num('light', 0.05, 1) };
}

/** Columns of ground tops the drops and settled snow are measured against, round the view (see tops). */
const COLS = 2048;
/** Drops and flakes in a 64 x 32 m box at full strength and full effects (more when zoomed out, up to the most). */
const RAIN_DENSITY = 1400;
const RAIN_MOST = 4000;
const SNOW_DENSITY = 900;
const SNOW_MOST = 3000;
/** How fast rain falls and drifts (m/s), and snow. */
const RAIN_V = { x: 1.6, y: -15 };
const SNOW_V = { x: 0.35, y: -1.3 };
/** How far flakes sway either side (m), and how fast (rad/s). */
const SWAY = { far: 0.22, rate: 1.3 };
/** Snow settled on the ground at its deepest (m: six sprite pixels), and how fast it settles and melts (m/s). */
const COVER = { most: PX * 6, settle: 0.004, melt: 0.003 };
/** Rain on a burning thing out in it: how much fire it puts out a second, at full strength. */
const RAIN_DOUSE = 0.3;
/** How often (s) the fires are looked at under rain. */
const DOUSE_EVERY = 0.1;
/** Splashes a second across the view in the heaviest rain. */
const SPLASHES = 90;
/** Seconds between strikes at a lightning chance of 100 (longer the lower it is). */
const STRIKE_EVERY = [2, 4];

/** The colour of fog and of an overcast sky's veil, by the map's look. */
const FOG_COLOR: Record<ThemeId, number> = {
  concrete: 0x868a90, outdoors: 0xc9d1d8, desert: 0xd8cbb4, night: 0x6c7488, snow: 0xe2e8ee, void: 0x30333a,
};

const FIELD_VERT = /* glsl */ `
attribute vec3 seed;
uniform vec4 uBox;
uniform vec4 uShift;
uniform vec2 uDir;
uniform vec2 uSize;
uniform vec2 uSway;
uniform vec3 uRoom;
uniform sampler2D uTops;
uniform vec2 uCols;
uniform float uPx;
varying float vA;
void main() {
  // two layers: the far one slower, smaller and fainter
  float near = step(0.5, seed.z);
  vec2 p = vec2(seed.x * uBox.z, seed.y * uBox.w) + mix(uShift.xy, uShift.zw, near);
  p.x += uSway.x * (0.6 + 0.4 * near) * sin(uSway.y + seed.z * 40.0);
  // wrapped into the box round the view: the field repeats every box, so drops keep their place in the world as the view moves
  p = uBox.xy + mod(p - uBox.xy, uBox.zw);
  vec2 head = floor(p / uPx) * uPx;
  vec2 tail = head - uDir * uSize.x * (0.7 + 0.3 * near);
  float c = floor(head.x / uCols.x);
  float ground = texture2D(uTops, vec2((mod(c, uCols.y) + 0.5) / uCols.y, 0.5)).r;
  vA = 0.5 + 0.5 * near;
  // gone into the ground (or the sea), or outside the room: a quad of nothing, off the screen
  if (tail.y < ground || head.x < uRoom.x || head.x > uRoom.y || tail.y > uRoom.z) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  head.y = max(head.y, ground);
  vec2 across = vec2(-uDir.y, uDir.x) * uSize.y * (0.75 + 0.25 * near);
  vec2 w = mix(tail, head, position.y + 0.5) + across * position.x;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(w, 0.0, 1.0);
}`;

const FIELD_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
varying float vA;
void main() {
  gl_FragColor = vec4(uColor, uAlpha * vA);
}`;

const WORLD_VERT = /* glsl */ `
varying vec2 vW;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xy;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

/** Snow settled on the ground: on each column's top, deeper here and there, in whole sprite pixels. */
const COVER_FRAG = /* glsl */ `
uniform sampler2D uTops;
uniform vec2 uCols;
uniform float uDepth;
uniform float uPx;
uniform vec3 uLit;
uniform vec3 uMid;
uniform vec3 uShade;
varying vec2 vW;
float hash(float n) {
  return fract(sin(n * 12.9898) * 43758.5453);
}
void main() {
  float c = floor(vW.x / uCols.x);
  vec2 t = texture2D(uTops, vec2((mod(c, uCols.y) + 0.5) / uCols.y, 0.5)).rg;
  // (none on the sea, or over the void)
  if (t.g < 0.5) discard;
  float px = floor(vW.x / uPx);
  float d = floor(uDepth * (0.6 + 0.4 * hash(floor(px / 3.0))) / uPx + 0.5) * uPx;
  float y = vW.y - t.r;
  if (y < 0.0 || y >= d) discard;
  gl_FragColor = vec4(y >= d - uPx ? uLit : y < uPx ? uShade : uMid, 1.0);
}`;

/** Fog thickest near the floor, drifting in wisps, and an even veil over everything under a rainy sky; in flat steps. */
const FOG_FRAG = /* glsl */ `
uniform float uFog;
uniform float uVeil;
uniform vec2 uPhase;
uniform float uFloor;
uniform float uPx;
uniform vec3 uColor;
varying vec2 vW;
void main() {
  vec2 sp = floor(vW / (uPx * 2.0)) * uPx * 2.0;
  float low = clamp(1.0 - (sp.y - uFloor) / 14.0, 0.0, 1.0);
  float wisp = 0.5 + 0.5 * sin(sp.x * 0.11 + uPhase.x + 1.5 * sin(sp.y * 0.37 + uPhase.y));
  float a = uVeil + uFog * (0.14 + 0.44 * low * (0.7 + 0.3 * wisp));
  a = floor(a * 12.0 + 0.5) / 12.0;
  if (a <= 0.0) discard;
  gl_FragColor = vec4(uColor, a);
}`;

const setRgb = (v: THREE.Vector3, c: number) => v.set(((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255);
const rgb = (c: number) => setRgb(new THREE.Vector3(), c);
const pow2 = (v: number) => 2 ** Math.ceil(Math.log2(Math.max(1, v)));
const wrap = (v: number, m: number) => ((v % m) + m) % m;

/** A field of drops or flakes drawn round the view, all on the GPU: nothing is moved here but two offsets. */
class Field {
  readonly mesh: THREE.Mesh;
  readonly mat: THREE.ShaderMaterial;
  private readonly geo = new THREE.InstancedBufferGeometry();
  /** How far the far and near layers have fallen (m, wrapped round the box). */
  private shift = [0, 0, 0, 0];

  constructor(most: number, tops: THREE.Texture, color: number, alpha: number) {
    this.geo.index = UNIT_QUAD.index;
    this.geo.setAttribute('position', UNIT_QUAD.getAttribute('position'));
    const seeds = new Float32Array(most * 3);
    for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
    this.geo.setAttribute('seed', new THREE.InstancedBufferAttribute(seeds, 3));
    this.geo.instanceCount = 0;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: FIELD_VERT,
      fragmentShader: FIELD_FRAG,
      uniforms: {
        uBox: { value: new THREE.Vector4() },
        uShift: { value: new THREE.Vector4() },
        uDir: { value: new THREE.Vector2(0, -1) },
        uSize: { value: new THREE.Vector2(PX, PX) },
        uSway: { value: new THREE.Vector2() },
        uRoom: { value: new THREE.Vector3() },
        uTops: { value: tops },
        uCols: { value: new THREE.Vector2(PX, COLS) },
        uPx: { value: PX },
        uColor: { value: rgb(color) },
        uAlpha: { value: alpha },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    // over what's in the world, under the light pass (night darkens it) and the flames
    this.mesh.position.z = 43;
    this.mesh.renderOrder = 10.2;
  }

  get count(): number {
    return this.mesh.visible ? this.geo.instanceCount : 0;
  }

  /**
   * Moves it on `dt` s at velocity `v` (the far layer at 70%), and sets what it
   * draws this frame: `n` of them in `box`, `len` by `wid` m, swaying; none
   * above `top` (a hall's ceiling).
   */
  update(n: number, box: number[], v: { x: number; y: number }, dt: number, len: number, wid: number, sway: number, phase: number, top: number): void {
    this.mesh.visible = n > 0;
    this.geo.instanceCount = n;
    if (!n) return;
    const s = this.shift;
    for (let k = 0; k < 2; k++) {
      const f = k ? 1 : 0.7;
      s[k * 2] = wrap(s[k * 2] + v.x * f * dt, box[2]);
      s[k * 2 + 1] = wrap(s[k * 2 + 1] + v.y * f * dt, box[3]);
    }
    const u = this.mat.uniforms;
    u.uBox.value.set(box[0], box[1], box[2], box[3]);
    u.uShift.value.set(s[0], s[1], s[2], s[3]);
    const l = Math.hypot(v.x, v.y);
    u.uDir.value.set(v.x / l, v.y / l);
    u.uSize.value.set(len, wid);
    u.uSway.value.set(sway, phase);
    u.uRoom.value.set(WORLD.left, WORLD.right, top);
  }
}

/**
 * Rain, snow, fog and lightning, following the camera (the endless plate is
 * kilometres long: the weather is drawn round the view, wherever that is).
 * Drops and flakes are drawn on the GPU in a field that wraps round the view,
 * so they cost nothing here and add no bodies to the physics; they stop at the
 * ground and the sea, measured once per column (see fillTops()). Rain splashes
 * where it lands, wets what's out in it and puts out small fires; snow settles
 * on the ground; lightning strikes the ground or something tall, as the
 * Lightning power's bolt (see Powers). Its loops play while it lasts. With no
 * weather, nothing is drawn or done.
 */
export class Weather {
  state: WeatherState = { ...CLEAR };
  /** Lightning strikes so far (the tests count them). */
  strikes = 0;
  private game: Game;
  /** The Lightning power's bolt, thrown from the sky (see strike()). */
  private powers: Powers;
  /** The weather before a map with weather of its own was switched to (the Snow map's snow): back after it. */
  private before: WeatherState | null = null;
  /** Game time to the next strike (s). */
  private wait = 0;
  private douseT = 0;
  /** Snow settled on the ground (m). */
  private depth = 0;
  private t = 0;
  private ray = new RAPIER.Ray({ x: 0, y: 0 }, { x: 0, y: -1 });
  private rain: Field;
  private snow: Field;
  private cover: THREE.Mesh;
  private coverMat: THREE.ShaderMaterial;
  private fog: THREE.Mesh;
  private fogMat: THREE.ShaderMaterial;
  /** Each column's top (and whether snow lies on it), by column number mod COLS, for the GPU (see fillTops()). */
  private tops = new Float32Array(COLS * 2);
  private topsTex: THREE.DataTexture;
  /** The columns held: their width (m), the first and last, and the map they were measured on. */
  private colW = 0;
  private colLo = 0;
  private colHi = -1;
  private topsMap: MapSpec | null = null;
  /** The lowest and highest tops held (where settled snow can be). */
  private topLo = 0;
  private topHi = 0;
  private shown = false;

  constructor(game: Game) {
    this.game = game;
    this.powers = new Powers(game);
    this.topsTex = new THREE.DataTexture(this.tops, COLS, 1, THREE.RGFormat, THREE.FloatType);
    this.topsTex.magFilter = this.topsTex.minFilter = THREE.NearestFilter;
    this.topsTex.generateMipmaps = false;
    this.rain = new Field(RAIN_MOST, this.topsTex, 0xa9c3dc, 0.55);
    this.snow = new Field(SNOW_MOST, this.topsTex, 0xf4f8ff, 0.95);
    this.coverMat = new THREE.ShaderMaterial({
      vertexShader: WORLD_VERT,
      fragmentShader: COVER_FRAG,
      uniforms: {
        uTops: { value: this.topsTex },
        uCols: { value: new THREE.Vector2(PX, COLS) },
        uDepth: { value: 0 },
        uPx: { value: PX },
        uLit: { value: rgb(0xfbfdff) },
        uMid: { value: rgb(0xe6edf4) },
        uShade: { value: rgb(0xc3d0de) },
      },
    });
    this.cover = new THREE.Mesh(UNIT_QUAD, this.coverMat);
    this.cover.frustumCulled = false;
    this.cover.visible = false;
    // on the ground, behind everything standing on it
    this.cover.position.z = -18.5;
    this.fogMat = new THREE.ShaderMaterial({
      vertexShader: WORLD_VERT,
      fragmentShader: FOG_FRAG,
      uniforms: {
        uFog: { value: 0 },
        uVeil: { value: 0 },
        uPhase: { value: new THREE.Vector2() },
        uFloor: { value: WORLD.floor },
        uPx: { value: PX },
        uColor: { value: rgb(FOG_COLOR.concrete) },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.fog = new THREE.Mesh(UNIT_QUAD, this.fogMat);
    this.fog.frustumCulled = false;
    this.fog.visible = false;
    this.fog.position.z = 43.5;
    this.fog.renderOrder = 10.4;
    game.renderer.scene.add(this.rain.mesh, this.snow.mesh, this.cover, this.fog);
    game.frameHandlers.push((dt) => this.frame(dt));
  }

  /** Drops and flakes drawn the last frame (none while there's no weather). */
  get drawn(): number {
    return this.rain.count + this.snow.count;
  }

  /** Changes the weather (Settings > World; in someone else's game, the host's is everyone's). */
  set(patch: Partial<WeatherState>): void {
    if (this.game.net?.guest) return;
    this.assign(cleanWeather({ ...this.state, ...patch }));
  }

  /** The weather as saved with a scene, or as the host has it. */
  apply(s: unknown): void {
    this.assign(cleanWeather(s, this.state));
  }

  /** Clear weather and daylight, the snow gone (the tests start from it). */
  reset(): void {
    this.before = null;
    this.depth = 0;
    this.assign({ ...CLEAR });
  }

  private assign(s: WeatherState): void {
    const was = this.state.lightning;
    this.state = s;
    // (the first strike a while after lightning is turned up, sooner if it's turned up more)
    if (s.lightning > 0 && (was <= 0 || this.wait > this.interval())) this.wait = this.interval();
    this.game.renderer.ambient = s.light;
  }

  /** A map with weather of its own brings it (and leaving it for one without brings back the weather from before). */
  onMap(from: MapSpec, to: MapSpec): void {
    // (in someone else's game the weather is the host's, sent with its time)
    if (this.game.net?.guest) return;
    if (to.weather) {
      if (!from.weather || !this.before) this.before = { ...this.state };
      this.assign(cleanWeather({ ...this.before, ...to.weather }));
    } else if (from.weather && this.before) {
      this.assign({ ...this.before, light: this.state.light });
      this.before = null;
    }
  }

  /** Seconds to the next strike at this lightning chance. */
  private interval(): number {
    const [a, b] = STRIKE_EVERY;
    return ((a + (b - a) * Math.random()) * 100) / Math.max(1, this.state.lightning);
  }

  // ---- the host's (or a lone player's) step: lightning, and rain on fires --------------------------

  step(dt: number): void {
    // (the bolt's own wait between throws runs on, as it would held by a player)
    this.powers.step(null, 0, 0, NO_FLICK, dt);
    const s = this.state;
    if (s.lightning > 0) {
      this.wait -= dt;
      if (this.wait <= 0) {
        this.wait = this.interval();
        this.strike(dt);
      }
    }
    if (s.rain > 0) {
      this.douseT += dt;
      if (this.douseT >= DOUSE_EVERY) {
        const t = this.douseT;
        this.douseT = 0;
        const fire = this.game.fire;
        // (oil burns on under rain longer)
        for (const p of fire.burningParts) if (!p.destroyed && this.outside(p)) fire.douse(p, (s.rain * RAIN_DOUSE * t) / (1 + p.oil * 3));
      }
    }
  }

  /** Is a part out in the rain: is it what a drop falling straight down on it would hit first (it, or its own body above it)? */
  private outside(p: Part): boolean {
    const g = this.game;
    const top = WORLD.ceiling - 0.05;
    this.ray.origin = { x: p.x, y: top };
    this.ray.dir = { x: 0, y: -1 };
    const hit = g.physics.world.castRay(this.ray, top - p.y + 0.5, true);
    if (!hit) return true;
    const q = g.physics.partOf(hit.collider);
    return !!q && q.entity === p.entity;
  }

  /**
   * Lightning: of a few spots across the view, the tallest thing or ground is
   * struck as often as not, else one of the others; the bolt comes down from
   * the sky as the Lightning power's (shocking, knocking and maybe setting
   * alight what it hits), with a flash over everything and thunder.
   */
  private strike(dt: number): void {
    const g = this.game;
    const r = g.renderer;
    const viewW = r.viewWidth / r.zoom;
    const viewTop = r.camY + r.height / r.zoom / 2;
    const y0 = WORLD.ceiling - 0.05;
    const spots: { x: number; y: number }[] = [];
    for (let i = 0; i < 6; i++) {
      const x = clamp(r.camX + (Math.random() - 0.5) * viewW * 0.9, WORLD.left + 0.5, WORLD.right - 0.5);
      this.ray.origin = { x, y: y0 };
      this.ray.dir = { x: 0, y: -1 };
      const hit = g.physics.world.castRay(this.ray, y0 - (WORLD.floor - VOID_DROP), true);
      // (nothing below: the void)
      if (hit) spots.push({ x, y: y0 - hit.timeOfImpact });
    }
    this.strikes++;
    const sky = Math.min(WORLD.ceiling, viewTop + 1);
    const thunder = (x: number) => g.sound.play('weather/thunder', { gain: 0.85, x, delay: 0.1 + Math.random() * 0.5, vary: 0.08 });
    if (!spots.length) {
      // sheet lightning: a flash and thunder, nothing struck
      r.addLight(r.camX, viewTop, 90, 0.5, 0xc8d6ff, 0.25);
      thunder(r.camX);
      return;
    }
    spots.sort((a, b) => b.y - a.y);
    const at = Math.random() < 0.6 ? spots[0] : spots[Math.floor(Math.random() * spots.length)];
    // the power's bolt starts within its reach of what it strikes; the sky above that is drawn here
    const start = Math.min(y0, at.y + POWER.boltReach - 2);
    if (sky > start + 0.5) this.skyBolt(at.x, sky, start);
    this.powers.step('lightning', at.x, start, { x: 0, y: POWER.flick * 4 }, dt);
    r.addLight(at.x, (start + sky) / 2, 90, 0.7, 0xc8d6ff, 0.3);
    r.shake(0.15);
    thunder(at.x);
  }

  /** The bolt from the sky down to (x, y1): kinked, with a glow and a fork or two. */
  private skyBolt(x: number, y0: number, y1: number): void {
    const pj = this.game.projectiles;
    const n = Math.max(3, Math.round((y0 - y1) / 1.2));
    let px = x + (Math.random() - 0.5) * 2;
    let py = y0;
    for (let i = 1; i <= n; i++) {
      const qx = i === n ? x : x + (Math.random() - 0.5) * 1.2 + (1 - i / n) * (px - x) * 0.5;
      const qy = y0 + ((y1 - y0) * i) / n;
      pj.drawBeam(px, py, qx, qy, PX * 4, 0x4a62a8, 0.16);
      pj.drawBeam(px, py, qx, qy, PX * 1.5, 0xe4f0ff, 0.16);
      if (i < n - 1 && Math.random() < 0.25) {
        const s = Math.random() < 0.5 ? -1 : 1;
        const fx = qx + s * (1 + Math.random() * 2);
        const fy = qy - (1 + Math.random() * 2);
        pj.drawBeam(qx, qy, fx, fy, PX, 0xc8dcff, 0.12);
      }
      px = qx;
      py = qy;
    }
  }

  // ---- every screen's frame: drawing, splashes, the loops -------------------------------------------

  private frame(dt: number): void {
    const s = this.state;
    const g = this.game;
    // snow settles while it falls and melts away after
    if (s.snow > 0) this.depth = Math.min(COVER.most * Math.min(1, s.snow * 1.5), this.depth + COVER.settle * s.snow * dt);
    else if (this.depth > 0) this.depth = Math.max(0, this.depth - COVER.melt * dt);
    if (!(s.rain > 0 || s.snow > 0 || s.fog > 0 || this.depth > 0)) {
      if (this.shown) {
        this.shown = false;
        this.rain.mesh.visible = this.snow.mesh.visible = this.cover.visible = this.fog.visible = false;
      }
      return;
    }
    this.shown = true;
    // (the frame's own time: still while paused, slowed in slow motion)
    const fdt = g.paused ? 0 : dt * g.timeScale;
    this.t += fdt;
    const r = g.renderer;
    const viewW = r.width / r.zoom;
    const viewH = r.height / r.zoom;
    const midX = r.camX + (r.width / 2 - r.centerX) / r.zoom;
    // the box the fields wrap round: the view and some, in powers of two (a change of size reshuffles them)
    const bw = pow2(viewW + 8);
    const bh = pow2(viewH + 8);
    const box = [midX - bw / 2, r.camY - bh / 2, bw, bh];
    const colW = Math.max(PX, bw / COLS);
    this.fillTops(box[0], box[0] + bw, colW);
    const detail = clamp(g.particles.detail, 0.3, 1);
    // more when zoomed out, but not as many more as the area grows
    const spread = Math.sqrt((bw * bh) / (64 * 32));
    const devPx = 1 / (r.zoom * r.dpr);
    // (in a hall it comes down from the ceiling; out of doors the sky goes on up)
    const top = g.env.backdrop.roofed ? WORLD.ceiling : 1e9;
    const rainN = Math.round(Math.min(RAIN_MOST, RAIN_DENSITY * s.rain * detail * spread));
    this.rain.update(rainN, box, RAIN_V, fdt, 0.28 + 0.2 * s.rain, Math.max(PX, devPx), 0, 0, top);
    const snowN = Math.round(Math.min(SNOW_MOST, SNOW_DENSITY * s.snow * detail * spread));
    const flake = Math.max(PX * 2, devPx * 1.5);
    this.snow.update(snowN, box, SNOW_V, fdt, flake, flake, SWAY.far, wrap(this.t * SWAY.rate, Math.PI * 2), top);
    for (const f of [this.rain, this.snow]) f.mat.uniforms.uCols.value.set(colW, COLS);

    // settled snow: a band from the lowest top to the highest, across the box
    this.cover.visible = this.depth >= PX * 0.5 && this.topHi > -1e3;
    if (this.cover.visible) {
      const u = this.coverMat.uniforms;
      u.uDepth.value = this.depth;
      u.uCols.value.set(colW, COLS);
      const lo = Math.max(this.topLo, r.camY - viewH);
      const hi = Math.min(this.topHi + this.depth + PX, r.camY + viewH);
      this.cover.visible = hi > lo;
      this.cover.scale.set(bw, Math.max(PX, hi - lo), 1);
      this.cover.position.set(midX, (lo + hi) / 2, -18.5);
    }

    // fog, and the grey of a rainy sky over everything
    const veil = s.rain * 0.1 + s.snow * 0.04;
    this.fog.visible = s.fog > 0 || veil > 0.01;
    if (this.fog.visible) {
      const u = this.fogMat.uniforms;
      u.uFog.value = s.fog;
      u.uVeil.value = veil;
      u.uPhase.value.set(wrap(this.t * 0.35, Math.PI * 2), wrap(this.t * 0.2, Math.PI * 2));
      setRgb(u.uColor.value, FOG_COLOR[g.map.theme] ?? FOG_COLOR.concrete);
      this.fog.scale.set(viewW + 4, viewH + 4, 1);
      this.fog.position.set(midX, r.camY, 43.5);
    }

    if (s.rain > 0 && fdt > 0) this.splashes(s.rain * SPLASHES * fdt * detail, midX, r.viewWidth / r.zoom, r.camY + viewH / 2);
    // the loops: rain, and wind with snow or fog (and a little with rain)
    const snd = g.sound;
    if (s.rain > 0) snd.hold(this, 'weather/rain_loop', 0.12 + 0.38 * s.rain);
    const wind = Math.max(s.snow * 0.45, s.fog * 0.25, s.rain * 0.15);
    if (wind > 0.01) snd.hold(this, 'weather/wind_loop', wind * 0.8);
  }

  /**
   * About `n` drops landing in view this frame: each falls straight down from
   * the top of the view onto whatever is first under it (a ray), and splashes
   * there; what it lands on gets wet (in the host's game: see Fire.douse()).
   */
  private splashes(n: number, midX: number, viewW: number, top: number): void {
    const g = this.game;
    const world = g.physics.world;
    const y0 = Math.min(top, WORLD.ceiling - 0.05);
    const host = !g.net?.guest;
    for (; n > 0; n--) {
      if (n < 1 && Math.random() >= n) break;
      const x = midX + (Math.random() - 0.5) * viewW;
      if (x < WORLD.left || x > WORLD.right) continue;
      const sea = g.water.levelAt(x);
      this.ray.origin = { x, y: y0 };
      this.ray.dir = { x: 0, y: -1 };
      const hit = world.castRay(this.ray, y0 - g.env.base, true);
      // (the top of the view inside the ground: no sky there to fall from)
      if (hit && hit.timeOfImpact <= 0) continue;
      let y = hit ? y0 - hit.timeOfImpact : -Infinity;
      if (sea !== null && sea > y) y = sea;
      else if (hit && host) {
        const p = g.physics.partOf(hit.collider);
        if (p && !p.destroyed) g.fire.douse(p, 0.02 * this.state.rain);
      }
      if (!Number.isFinite(y)) continue;
      for (let k = 0; k < 2; k++) {
        g.particles.emit(PK.Debris, x, y + PX, {
          vx: (Math.random() - 0.5) * 1.2, vy: 0.6 + Math.random() * 0.9, life: 0.18 + Math.random() * 0.12,
          size: PX, color: 0xb4cde6, alpha: 0.8, alpha1: 0.4, gravity: 1, drag: 0,
        });
      }
    }
  }

  /**
   * Makes sure the tops texture holds every column from x0 to x1, `w` m wide:
   * the ground's top (a sea's surface over it; far below where there's nothing,
   * in the void), and whether snow can lie there. Columns are kept by their
   * number in the world, so as the view moves only those coming into it are
   * measured; another width or map measures them all again.
   */
  private fillTops(x0: number, x1: number, w: number): void {
    const g = this.game;
    if (w !== this.colW || g.map !== this.topsMap) {
      this.colW = w;
      this.topsMap = g.map;
      this.colLo = 0;
      this.colHi = -1;
    }
    const c0 = Math.floor(x0 / w);
    const c1 = Math.min(Math.floor(x1 / w), c0 + COLS - 1);
    if (c0 >= this.colLo && c1 <= this.colHi) return;
    const env = g.env;
    const t = this.tops;
    for (let c = c0; c <= c1; c++) {
      if (c >= this.colLo && c <= this.colHi) continue;
      const x = (c + 0.5) * w;
      const i = (((c % COLS) + COLS) % COLS) * 2;
      let top = env.groundAt(x, WORLD.ceiling);
      let lies = 1;
      if (x < WORLD.left || x > WORLD.right || (env.floorless && top <= env.base + 1e-6)) {
        top = -1e4;
        lies = 0;
      } else top = Math.round(top / PX) * PX;
      const sea = g.water.levelAt(x);
      if (sea !== null && sea > top) {
        top = sea;
        lies = 0;
      }
      t[i] = top;
      t[i + 1] = lies;
    }
    this.colLo = c0;
    this.colHi = c1;
    // the band settled snow is drawn in
    let lo = Infinity;
    let hi = -Infinity;
    for (let c = c0; c <= c1; c++) {
      const i = (((c % COLS) + COLS) % COLS) * 2;
      if (!t[i + 1]) continue;
      if (t[i] < lo) lo = t[i];
      if (t[i] > hi) hi = t[i];
    }
    this.topLo = Number.isFinite(lo) ? lo : -1e4;
    this.topHi = Number.isFinite(hi) ? hi : -1e4;
    this.topsTex.needsUpdate = true;
  }
}

const NO_FLICK = { x: 0, y: 0 };
