import * as THREE from 'three';
import { RAPIER, type Physics } from '../engine/Physics';
import { GROUPS_STATIC, PX } from '../engine/constants';
import { makePixelTexture } from '../engine/Renderer';
import type { Color } from '../art/PixelArt';
import { ROCK_HEIGHT, ROCK_SLOPE, SAMPLE, TerrainGen } from './Terrain';
import type { Surface } from './Environment';

/** How wide (m) a stretch of the World map's ground is, built and dropped as one (see WorldGround). */
export const CHUNK = 128;
/** Samples of height across a chunk (one more than its segments). */
const N = CHUNK / SAMPLE + 1;
/** How far (m) either side of where things are looked at the ground is there to stand on (see update()). */
export const GROUND_REACH = 2560;
/** ...and how far past that a stretch built is kept, so it isn't built again and again at the edge. */
const KEEP = 512;
/** How deep (m) under a chunk's lowest point its ground is drawn (a view never sees further down). */
const DEPTH = 160;
/** Above this (m, true height), the tops are snow. */
export const SNOW_LINE = 260;
/** Samples whose slope changes by less than this (m over a sample) either side are on one straight stretch (see build()). */
const STRAIGHT = 1e-4;

/** A stretch of ground: its heights, its collider, and while it's in view, its mesh. */
interface Chunk {
  /** Which stretch: true x from i·CHUNK to (i+1)·CHUNK. */
  i: number;
  /** True heights (m) at each sample. */
  h: Float64Array;
  /** Each segment's look: 0 earth under grass, 1 rock, 2 rock under snow, 3 earth under snow. */
  mat: Uint8Array;
  lo: number;
  hi: number;
  collider: RAPIER.Collider | null;
  mesh: THREE.Mesh | null;
}

const VERT = /* glsl */ `
uniform vec2 uSize;
varying vec2 vLocal;
void main() {
  vLocal = position.xy * uSize;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(vLocal, position.z, 1.0);
}`;

// A chunk's ground, drawn as the map's ground pieces are (see Environment's
// drawGround()): columns of whole sprite pixels, each up to the height there, a lit
// edge along the top and a dark lip under it, grass tufts here and there, the tile
// below. vLocal is the point in the chunk's own frame (x from its left end, y from
// its bottom); uPhase* carry where that is in the world, so the tiles and tufts line
// up from chunk to chunk however far out it is.
const FRAG = /* glsl */ `
precision highp float;
precision highp int;
uniform sampler2D uH;
uniform sampler2D uMat;
uniform sampler2D uTile[3];
uniform vec2 uTileSize[3];
uniform vec2 uPhase[3];
uniform vec3 uEdge[4];
uniform vec3 uLip[4];
uniform vec3 uTuft[2];
uniform float uColPhase;
uniform float uPx;
uniform float uSample;
varying vec2 vLocal;

float hash(float n) {
  uint h = uint(n) * 747796405u + 2891336453u;
  h = ((h >> ((h >> 28u) + 4u)) ^ h) * 277803737u;
  h = (h >> 22u) ^ h;
  return float(h) / 4294967295.0;
}

vec3 tileAt(int k, vec2 p) {
  vec2 uv = fract(p / uTileSize[k] + uPhase[k]);
  if (k == 0) return texture2D(uTile[0], uv).rgb;
  if (k == 1) return texture2D(uTile[1], uv).rgb;
  return texture2D(uTile[2], uv).rgb;
}

void main() {
  float col = floor(vLocal.x / uPx);
  float s = (col + 0.5) * uPx / uSample;
  float i = floor(s);
  float h0 = texelFetch(uH, ivec2(int(i), 0), 0).r;
  float h1 = texelFetch(uH, ivec2(int(i) + 1, 0), 0).r;
  float top = floor(mix(h0, h1, s - i) / uPx + 0.5);
  float row = floor(vLocal.y / uPx);
  int mat = int(texelFetch(uMat, ivec2(int(i), 0), 0).r * 255.0 + 0.5);
  float d = top - 1.0 - row;
  if (d < 0.0) {
    // grass on earth: a pixel or two over the top here and there
    if (mat != 0) discard;
    float t = hash(col + uColPhase);
    if (t > 0.35 || d < (t < 0.1 ? -2.0 : -1.0)) discard;
    gl_FragColor = vec4(t < 0.18 ? uTuft[1] : uTuft[0], 1.0);
    return;
  }
  // snow lies deeper on the top than grass does
  bool snow = mat >= 2;
  float edge = snow ? 4.0 : 2.0;
  if (d < edge) gl_FragColor = vec4(uEdge[mat], 1.0);
  else if (d < edge + 3.0) gl_FragColor = vec4(uLip[mat], 1.0);
  else gl_FragColor = vec4(tileAt(mat == 1 || mat == 2 ? 1 : 0, vLocal), 1.0);
}`;

const rgb = (c: Color) => new THREE.Color(((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255);

/**
 * The World map's ground (see world/Terrain): stretches of CHUNK m, each a
 * heightfield collider on the environment's body while it's within GROUND_REACH
 * of the camera, and a mesh while it's in view. Positions here are the floating
 * origin's (see world/Origin): heights and xs in and out are local, and shift()
 * moves what's built when the origin moves.
 */
export class WorldGround {
  readonly gen: TerrainGen;
  private physics: Physics;
  private body: RAPIER.RigidBody;
  private group = new THREE.Group();
  private chunks = new Map<number, Chunk>();
  /** The collider handles of the chunks built (see Environment.isEnvironment()). */
  readonly handles = new Set<number>();
  /** Where the floating origin is: true x and y of local (0, 0). */
  private ox = 0;
  private oy = 0;
  private tiles: THREE.Texture[];
  private tileSize: THREE.Vector2[];
  private uniforms: Record<string, THREE.IUniform>;
  /** The stretch the camera was over when the chunks were last looked over (see update()). */
  private at = '';
  /**
   * Meshes of chunks gone out of view, kept to draw the next ones with (see draw()):
   * a new material for each was worked over by three.js on its first frame, 8 ms of
   * it, a hitch every chunk flying low and fast.
   */
  private spare: THREE.Mesh[] = [];
  /** The one plane every chunk's drawn on: a unit square from its bottom-left corner, sized by uSize. */
  private plane = new THREE.PlaneGeometry(1, 1).translate(0.5, 0.5, 0);

  constructor(physics: Physics, body: RAPIER.RigidBody, scene: THREE.Object3D, seed: number, origin: { x: number; y: number }, looks: { earth: Surface; rock: Surface; snow: Surface }) {
    this.physics = physics;
    this.body = body;
    this.gen = new TerrainGen(seed);
    this.ox = origin.x;
    this.oy = origin.y;
    scene.add(this.group);
    const surf = [looks.earth, looks.rock, looks.snow];
    this.tiles = surf.map((s) => {
      const t = makePixelTexture(s.tile.toCanvas(0));
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      return t;
    });
    this.tileSize = surf.map((s) => new THREE.Vector2(s.tile.w * PX, s.tile.h * PX));
    // (rock and earth tops under snow: the snow's lit edge and lip)
    const edge = [looks.earth.edge, looks.rock.edge, looks.snow.edge, looks.snow.edge].map(rgb);
    const lip = [looks.earth.lip, looks.rock.lip, looks.snow.lip, looks.snow.lip].map(rgb);
    const tuft = looks.earth.tufts ?? [looks.earth.edge, looks.earth.edge, looks.earth.edge, looks.earth.edge];
    this.uniforms = {
      uTile: { value: this.tiles },
      uTileSize: { value: this.tileSize },
      uEdge: { value: edge },
      uLip: { value: lip },
      uTuft: { value: [rgb(tuft[2]), rgb(tuft[3])] },
      uPx: { value: PX },
      uSample: { value: SAMPLE },
    };
  }

  // ---- heights --------------------------------------------------------------

  /** The ground's height (local m) at local x: straight lines between samples, as the colliders have it. */
  heightAt(x: number): number {
    const X = x + this.ox;
    const i = Math.floor(X / CHUNK);
    const c = this.chunks.get(i);
    const s = (X - i * CHUNK) / SAMPLE;
    const k = Math.min(N - 2, Math.floor(s));
    const f = s - k;
    if (c) return c.h[k] + (c.h[k + 1] - c.h[k]) * f - this.oy;
    const x0 = (i * CHUNK + k * SAMPLE);
    const a = this.gen.heightAt(x0);
    return a + (this.gen.heightAt(x0 + SAMPLE) - a) * f - this.oy;
  }

  /** The ground's slope (rise over run) at local x. */
  slopeAt(x: number): number {
    const X = x + this.ox;
    const k = Math.floor(X / SAMPLE);
    return (this.trueHeight((k + 1) * SAMPLE) - this.trueHeight(k * SAMPLE)) / SAMPLE;
  }

  /** Is the ground at local x bare rock (steep, or high up)? */
  rockAt(x: number): boolean {
    const X = x + this.ox;
    const i = Math.floor(X / CHUNK);
    const c = this.chunks.get(i);
    if (c) return (c.mat[Math.min(N - 2, Math.floor((X - i * CHUNK) / SAMPLE))] & 1) === 1;
    const h = this.heightAt(x) + this.oy;
    return h > ROCK_HEIGHT || Math.abs(this.slopeAt(x)) > ROCK_SLOPE;
  }

  /**
   * The nearest point on the ground's surface to a local point inside it (or near
   * it), and the surface's normal there: what's in the ground is put back out on it.
   */
  outOf(x: number, y: number): { x: number; y: number; nx: number; ny: number } {
    const k = this.slopeAt(x);
    const l = Math.hypot(1, k);
    const nx = -k / l;
    const ny = 1 / l;
    const h = this.heightAt(x);
    // (on the slope's line through the surface above it, to the nearest point)
    const d = (h - y) * ny;
    return { x: x + nx * d, y: y + ny * d, nx, ny };
  }

  /** A true height, from a chunk built or worked out. */
  private trueHeight(X: number): number {
    const i = Math.floor(X / CHUNK);
    const c = this.chunks.get(i);
    if (!c) return this.gen.heightAt(X);
    const k = Math.round((X - i * CHUNK) / SAMPLE);
    return c.h[Math.min(N - 1, k)];
  }

  // ---- building -------------------------------------------------------------

  /**
   * Keeps the ground built where it's needed: within GROUND_REACH of each local x
   * given (the cameras), and its meshes over [viewL, viewR]. Cheap when nothing's
   * changed: only a move to another stretch looks the chunks over.
   */
  update(xs: readonly number[], viewL: number, viewR: number): void {
    const key = xs.map((x) => Math.floor((x + this.ox) / CHUNK)).join(',') + `|${Math.floor((viewL + this.ox) / CHUNK)},${Math.floor((viewR + this.ox) / CHUNK)}`;
    if (key === this.at) return;
    this.at = key;
    const want = new Set<number>();
    const keep = new Set<number>();
    for (const x of xs) {
      const X = x + this.ox;
      for (let i = Math.floor((X - GROUND_REACH) / CHUNK); i <= Math.floor((X + GROUND_REACH) / CHUNK); i++) want.add(i);
      for (let i = Math.floor((X - GROUND_REACH - KEEP) / CHUNK); i <= Math.floor((X + GROUND_REACH + KEEP) / CHUNK); i++) keep.add(i);
    }
    for (const [i, c] of this.chunks) if (!keep.has(i)) this.drop(c);
    for (const i of want) if (!this.chunks.has(i)) this.build(i);
    // meshes for the stretches in view (and a little either side)
    const v0 = Math.floor((viewL + this.ox) / CHUNK) - 1;
    const v1 = Math.floor((viewR + this.ox) / CHUNK) + 1;
    for (const c of this.chunks.values()) {
      const seen = c.i >= v0 && c.i <= v1;
      if (seen && !c.mesh) this.draw(c);
      else if (!seen && c.mesh && (c.i < v0 - 2 || c.i > v1 + 2)) this.undraw(c);
    }
  }

  private build(i: number): void {
    const h = new Float64Array(N);
    let lo = Infinity;
    let hi = -Infinity;
    for (let k = 0; k < N; k++) {
      const v = (h[k] = this.gen.heightAt(i * CHUNK + k * SAMPLE));
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    const mat = new Uint8Array(N - 1);
    for (let k = 0; k < N - 1; k++) {
      const top = Math.max(h[k], h[k + 1]);
      // (steep where either neighbour's slope is, so a cliff's rock runs over its lip)
      const slope = Math.max(Math.abs(h[k + 1] - h[k]), k > 0 ? Math.abs(h[k] - h[k - 1]) : 0, k < N - 2 ? Math.abs(h[k + 2] - h[k + 1]) : 0) / SAMPLE;
      const rock = slope > ROCK_SLOPE || top > ROCK_HEIGHT;
      mat[k] = top > SNOW_LINE ? (rock ? 2 : 3) : rock ? 1 : 0;
    }
    const c: Chunk = { i, h, mat, lo, hi, collider: null, mesh: null };
    // the collider: a line along the top, from the chunk's middle and its lowest point. One-sided
    // (the ground's under it: run right to left, its outside is up), so what slides or rolls
    // over a joint between two stretches isn't caught on it as on a two-sided heightfield's,
    // and each run of samples on one straight slope is one stretch (flat ground, a single one)
    const vs: number[] = [];
    for (let k = N - 1; k >= 0; k--) {
      if (k > 0 && k < N - 1 && Math.abs(h[k + 1] - 2 * h[k] + h[k - 1]) < STRAIGHT) continue;
      vs.push(k * SAMPLE - CHUNK / 2, h[k] - lo);
    }
    const desc = RAPIER.ColliderDesc.polyline(new Float32Array(vs), null, RAPIER.PolylineFlags.ORIENTED)
      .setTranslation(i * CHUNK + CHUNK / 2 - this.ox, lo - this.oy)
      .setFriction(0.85)
      .setRestitution(0.05)
      .setCollisionGroups(GROUPS_STATIC);
    const col = this.physics.world.createCollider(desc, this.body);
    // (to Rapier's own contact filter, the ground is in no group: see Physics)
    col.setContactFilter(0, false);
    c.collider = col;
    this.handles.add(col.handle);
    this.chunks.set(i, c);
  }

  private drop(c: Chunk): void {
    this.undraw(c);
    if (c.collider) {
      this.handles.delete(c.collider.handle);
      if (c.collider.isValid()) this.physics.world.removeCollider(c.collider, true);
      c.collider = null;
    }
    this.chunks.delete(c.i);
  }

  /** A mesh to draw a chunk on: its own heights, materials and place on the tiles, as uniforms (see draw()). */
  private mesh(): THREE.Mesh {
    const tex = new THREE.DataTexture(new Float32Array(N), N, 1, THREE.RedFormat, THREE.FloatType);
    const mt = new THREE.DataTexture(new Uint8Array(N), N, 1, THREE.RedFormat, THREE.UnsignedByteType);
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        ...this.uniforms,
        uH: { value: tex },
        uMat: { value: mt },
        uPhase: { value: this.tileSize.map(() => new THREE.Vector2()) },
        uColPhase: { value: 0 },
        uSize: { value: new THREE.Vector2(CHUNK, 1) },
      },
    });
    const m = new THREE.Mesh(this.plane, mat);
    m.frustumCulled = false;
    this.group.add(m);
    return m;
  }

  private draw(c: Chunk): void {
    const m = this.spare.pop() ?? this.mesh();
    m.visible = true;
    const u = (m.material as THREE.ShaderMaterial).uniforms;
    const base = c.lo - DEPTH;
    const tex = u.uH.value as THREE.DataTexture;
    const hs = tex.image.data as Float32Array;
    for (let k = 0; k < N; k++) hs[k] = c.h[k] - base;
    tex.needsUpdate = true;
    const mt = u.uMat.value as THREE.DataTexture;
    (mt.image.data as Uint8Array).set(c.mat);
    mt.needsUpdate = true;
    const x0 = c.i * CHUNK;
    // (where the chunk's frame sits on each tile: worked out in doubles, handed over small)
    const phase = u.uPhase.value as THREE.Vector2[];
    this.tileSize.forEach((t, j) => phase[j].set(fract(x0 / t.x), fract(base / t.y)));
    u.uColPhase.value = (((c.i * CHUNK) / PX) % 65536 + 65536) % 65536;
    // (its frame from its bottom-left corner)
    (u.uSize.value as THREE.Vector2).set(CHUNK, c.hi - base + 1);
    m.position.set(x0 - this.ox, base - this.oy, -20);
    c.mesh = m;
  }

  private undraw(c: Chunk): void {
    const m = c.mesh;
    if (!m) return;
    m.visible = false;
    this.spare.push(m);
    c.mesh = null;
  }

  /** The floating origin moved: local positions change by (dx, dy) (see world/Origin). */
  shift(dx: number, dy: number): void {
    this.ox -= dx;
    this.oy -= dy;
    for (const c of this.chunks.values()) {
      if (c.collider?.isValid()) c.collider.setTranslationWrtParent({ x: c.i * CHUNK + CHUNK / 2 - this.ox, y: c.lo - this.oy });
      if (c.mesh) c.mesh.position.set(c.i * CHUNK - this.ox, c.lo - DEPTH - this.oy, -20);
    }
    this.at = '';
  }

  /** Takes it all away (another map). */
  dispose(): void {
    for (const c of [...this.chunks.values()]) this.drop(c);
    for (const m of this.spare) {
      const mat = m.material as THREE.ShaderMaterial;
      (mat.uniforms.uH.value as THREE.Texture).dispose();
      (mat.uniforms.uMat.value as THREE.Texture).dispose();
      mat.dispose();
    }
    this.spare.length = 0;
    this.plane.dispose();
    this.group.removeFromParent();
    for (const t of this.tiles) t.dispose();
  }
}

function fract(v: number): number {
  return v - Math.floor(v);
}
