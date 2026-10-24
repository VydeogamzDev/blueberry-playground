import * as THREE from 'three';
import { RAPIER, type Physics } from '../engine/Physics';
import { GROUPS_STATIC, PX, WORLD } from '../engine/constants';
import { makePixelTexture, UNIT_QUAD, type Backdrop } from '../engine/Renderer';
import { PixelArt, type Color } from '../art/PixelArt';
import { BRICK, CONCRETE, ramp, type Ramp } from '../art/palette';
import { clamp, RNG } from '../engine/math';
import { contains, floorless, LAB, type MapSpec, type TerrainMat, type ThemeId } from './Maps';

/**
 * How wide (m) the floor and ceiling drawn on an endless map are: wider than
 * any view, they follow the camera along (see Environment.frame()).
 */
const FOLLOW_W = 1024;

/** A poured-concrete slab tile (64x32 art px) drawn from one ramp. */
function slabTile(seed: number, r: Ramp): PixelArt {
  const a = new PixelArt(64, 32);
  a.rect(0, 0, 64, 32, r[2]);
  const rng = new RNG(seed);
  // sparse aggregate speckles
  for (let i = 0; i < 14; i++) a.set(rng.int(1, 62), rng.int(2, 29), rng.next() < 0.6 ? r[1] : r[3]);
  // seams: a soft dark line with a lit edge after it
  a.hline(0, 63, 31, r[1]);
  a.hline(0, 63, 0, r[3]);
  a.vline(63, 1, 30, r[1]);
  return a;
}

/** Earth: darker clods in streaks along its layers, and pebbles lit from above (64x32). */
function earthTile(seed: number, r: Ramp): PixelArt {
  const a = new PixelArt(64, 32);
  a.rect(0, 0, 64, 32, r[2]);
  const rng = new RNG(seed);
  for (let i = 0; i < 30; i++) {
    const x = rng.int(0, 60);
    a.hline(x, x + rng.int(1, 3), rng.int(0, 31), r[1]);
  }
  for (let i = 0; i < 10; i++) {
    const x = rng.int(0, 63);
    const y = rng.int(0, 30);
    a.set(x, y, r[3]).set(x, y + 1, r[0]);
  }
  return a;
}

/** Sand: wind ripples (short lit crests over shadowed troughs) and loose grains (64x32). */
function sandTile(seed: number, r: Ramp): PixelArt {
  const a = new PixelArt(64, 32);
  a.rect(0, 0, 64, 32, r[2]);
  const rng = new RNG(seed);
  for (let i = 0; i < 14; i++) {
    const x = rng.int(0, 56);
    const y = rng.int(0, 30);
    const len = rng.int(3, 6);
    a.hline(x, x + len, y, r[3]);
    a.hline(x + 1, x + len + 1, y + 1, r[1]);
  }
  for (let i = 0; i < 16; i++) a.set(rng.int(0, 63), rng.int(0, 31), rng.next() < 0.5 ? r[1] : r[3]);
  return a;
}

/** Rock: two wavy bedding seams lit along their tops, cracks and flecks (64x32). */
function rockTile(seed: number, r: Ramp): PixelArt {
  const a = new PixelArt(64, 32);
  a.rect(0, 0, 64, 32, r[2]);
  for (const [y0, waves] of [[9, 2], [22, 3]]) {
    for (let x = 0; x < 64; x++) {
      // (whole waves across the tile, so it repeats without a step)
      const y = y0 + Math.round(Math.sin((x / 64) * Math.PI * 2 * waves + seed) * 1.4);
      a.set(x, y, r[1]).set(x, y - 1, r[3]);
    }
  }
  const rng = new RNG(seed);
  for (let i = 0; i < 5; i++) {
    let x = rng.int(3, 59);
    let y = rng.int(1, 24);
    for (let k = rng.int(3, 6); k > 0; k--, y++) {
      a.set(x, y, r[0]).set(x + 1, y, r[3]);
      x += rng.int(-1, 1);
    }
  }
  for (let i = 0; i < 14; i++) a.set(rng.int(0, 63), rng.int(0, 31), rng.next() < 0.5 ? r[1] : r[3]);
  return a;
}

/** Brickwork as a brick wall's: 12x6 px bricks in courses with mortar between, a few a shade off (48x24). */
function brickTile(seed: number, r: Ramp, mortar: Color): PixelArt {
  const a = new PixelArt(48, 24);
  for (let y = 0; y < 24; y++) {
    const shift = Math.floor(y / 6) % 2 ? 6 : 0;
    for (let x = 0; x < 48; x++) a.set(x, y, y % 6 === 5 || (x + shift) % 12 === 11 ? mortar : r[2]);
  }
  const rng = new RNG(seed);
  for (let i = 0; i < 4; i++) {
    const course = rng.int(0, 3);
    const x0 = rng.int(0, 3) * 12 - (course % 2 ? 6 : 0);
    const tone = rng.next() < 0.5 ? r[1] : r[3];
    for (let y = course * 6; y < course * 6 + 5; y++) for (let x = x0; x < x0 + 11; x++) a.set((x + 48) % 48, y, tone);
  }
  for (let i = 0; i < 30; i++) {
    const x = rng.int(0, 47);
    const y = rng.int(0, 23);
    if (a.get(x, y) === r[2]) a.set(x, y, rng.next() < 0.5 ? r[1] : r[3]);
  }
  return a;
}

/** Dressed stone blocks in courses, 32x16 px, each lit along its top (64x32). */
function blockTile(seed: number, r: Ramp): PixelArt {
  const a = new PixelArt(64, 32);
  a.rect(0, 0, 64, 32, r[2]);
  for (let course = 0; course < 2; course++) {
    const y = course * 16;
    a.hline(0, 63, y, r[3]);
    a.hline(0, 63, y + 15, r[1]);
    for (let x = course ? 15 : 31; x < 64; x += 32) a.vline(x, y + 1, y + 14, r[1]);
  }
  const rng = new RNG(seed);
  for (let i = 0; i < 24; i++) {
    const x = rng.int(0, 63);
    const y = rng.int(0, 31);
    if (a.get(x, y) === r[2]) a.set(x, y, rng.next() < 0.5 ? r[1] : r[3]);
  }
  return a;
}

/** Snow: drifts in soft blue-shadowed streaks, and a glint here and there (64x32). */
function snowTile(seed: number, r: Ramp): PixelArt {
  const a = new PixelArt(64, 32);
  a.rect(0, 0, 64, 32, r[3]);
  const rng = new RNG(seed);
  for (let i = 0; i < 16; i++) {
    const x = rng.int(0, 56);
    const y = rng.int(1, 30);
    a.hline(x, x + rng.int(3, 7), y, rng.next() < 0.5 ? r[1] : r[2]);
  }
  for (let i = 0; i < 10; i++) a.set(rng.int(0, 63), rng.int(0, 31), r[4]);
  return a;
}

/** Asphalt: fine grit, light and dark (64x32). */
function gritTile(seed: number, r: Ramp): PixelArt {
  const a = new PixelArt(64, 32);
  a.rect(0, 0, 64, 32, r[2]);
  const rng = new RNG(seed);
  for (let i = 0; i < 70; i++) a.set(rng.int(0, 63), rng.int(0, 31), rng.next() < 0.5 ? r[1] : r[3]);
  for (let i = 0; i < 6; i++) a.set(rng.int(0, 63), rng.int(0, 31), rng.next() < 0.5 ? r[0] : r[4]);
  return a;
}

/** Corrugated steel: ribs lit on their left, a seam along the bottom with rivets (32x32). */
function metalTile(r: Ramp): PixelArt {
  const a = new PixelArt(32, 32);
  const ribs = [r[3], r[2], r[2], r[1]];
  for (let x = 0; x < 32; x++) a.vline(x, 0, 31, ribs[x % 4]);
  a.hline(0, 31, 31, r[0]);
  for (let x = 2; x < 32; x += 8) a.set(x, 29, r[4]).set(x, 30, r[1]);
  return a;
}

/** A building's wall at night: dark brick with two floors of three windows, some of them lit (192x192: 6 m square). */
function windowsTile(seed: number): PixelArt {
  const a = new PixelArt(192, 192);
  const bricks = brickTile(seed, DARK_BRICK, DARK_BRICK[0]);
  for (let y = 0; y < 192; y += 24) for (let x = 0; x < 192; x += 48) a.blit(bricks, x, y);
  const rng = new RNG(seed);
  for (let f = 0; f < 2; f++) {
    for (let k = 0; k < 3; k++) {
      const x = 22 + k * 64;
      const y = 30 + f * 96;
      const g = rng.next() < 0.4 ? LIT : PANE;
      // a lintel over it, a sill under it and the sill's shadow
      a.rect(x - 2, y - 3, 24, 3, SLAB[3]);
      a.rect(x - 2, y + 30, 24, 2, SLAB[2]);
      a.hline(x - 2, x + 21, y + 32, SLAB[0]);
      // the pane, lighter at the top (a lamp's glow, or the sky in it), parted by the frame
      a.rect(x, y, 20, 30, g[2]);
      a.rect(x, y, 20, 9, g[3]);
      a.vline(x + 9, y, y + 29, SLAB[1]);
      a.hline(x, x + 19, y + 12, SLAB[1]);
    }
  }
  return a;
}

function tiledMesh(art: PixelArt, w: number, h: number, z: number): THREE.Mesh {
  const canvas = art.toCanvas(0);
  const tex = makePixelTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(w / (art.w * PX), h / (art.h * PX));
  const mat = new THREE.MeshBasicMaterial({ map: tex });
  const mesh = new THREE.Mesh(UNIT_QUAD, mat);
  mesh.scale.set(w, h, 1);
  mesh.position.z = z;
  return mesh;
}

const FLOOR = ramp('#3e4044', 0.6);
const WALL = ramp('#323438', 0.6);
/** Concrete ground: a little lighter than the floor, so it stands out against it. */
const SLAB = ramp('#525458', 0.6);
const EARTH = ramp('#6b4c34', 0.7);
const GRASS = ramp('#5f8c3a', 0.9);
const CLIFF = ramp('#5c5650', 0.7);
const STONE = ramp('#7a736b', 0.7);
const SAND = ramp('#c8a46b', 0.55);
const SANDSTONE = ramp('#a57c51', 0.6);
const ASPHALT = ramp('#36383d', 0.7);
const DARK_BRICK = ramp('#5b3831', 0.8);
const SHEET = ramp('#66707a', 0.8);
const LIT = ramp('#d8b25c', 0.8);
const PANE = ramp('#212c3d', 0.8);
const SNOW = ramp('#dfe8ef', 0.3);
const DARK = ramp('#2a2c31', 0.6);

/** How a stretch of ground looks: its tile, the lit edge along its top, the dark lip under that, and grass on it. */
interface Surface {
  tile: PixelArt;
  edge: Color;
  lip: Color;
  tufts?: Ramp;
}

/** A theme's look (see Maps.ThemeId). */
interface Look {
  /** The floor slab, and the walls (and ceiling) with the lit trims along their inner faces. */
  floor: Surface;
  wall: PixelArt;
  trim: Color;
  /** A hall: the ceiling is drawn (out of doors the sky goes on up). */
  roofed: boolean;
  /** Its own ground ('ground' pieces), and its rock. */
  ground: Surface;
  rock: Surface;
  backdrop: Backdrop;
}

const rgb = (c: Color): [number, number, number] => [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];

/** An open sky over a map `height` m high (see Renderer's backdrop). */
function skyDrop(sky: number, base: Color, top: Color, far: Color, height: number): Backdrop {
  return { sky, base: rgb(base), top: rgb(top), far: rgb(far), panels: 0, gradH: Math.min(height, 100) * 0.9, clear: top, roofed: false };
}

function lookOf(theme: ThemeId, height: number): Look {
  const stone: Surface = { tile: rockTile(43, STONE), edge: STONE[4], lip: STONE[0] };
  switch (theme) {
    case 'outdoors': {
      const earth: Surface = { tile: earthTile(5, EARTH), edge: GRASS[3], lip: GRASS[1], tufts: GRASS };
      return { floor: earth, wall: rockTile(41, CLIFF), trim: CLIFF[3], roofed: false, ground: earth, rock: stone, backdrop: skyDrop(1, 0xa9cfe2, 0x4f89bf, 0x7f9f88, height) };
    }
    case 'desert': {
      const sand: Surface = { tile: sandTile(13, SAND), edge: SAND[4], lip: SAND[1] };
      const rock: Surface = { tile: blockTile(19, SANDSTONE), edge: SANDSTONE[4], lip: SANDSTONE[0] };
      return { floor: sand, wall: blockTile(17, SANDSTONE), trim: SANDSTONE[3], roofed: false, ground: sand, rock, backdrop: skyDrop(2, 0xecd2a4, 0x6f9fc9, 0xbf9467, height) };
    }
    case 'night': {
      const road: Surface = { tile: gritTile(29, ASPHALT), edge: ASPHALT[3], lip: ASPHALT[0] };
      return { floor: road, wall: brickTile(31, DARK_BRICK, DARK_BRICK[0]), trim: DARK_BRICK[3], roofed: false, ground: road, rock: stone, backdrop: skyDrop(3, 0x1d2744, 0x06080f, 0x121624, height) };
    }
    case 'snow': {
      const snow: Surface = { tile: snowTile(47, SNOW), edge: SNOW[4], lip: SNOW[1] };
      // (a pale winter sky over snowy hills)
      return { floor: snow, wall: rockTile(41, CLIFF), trim: CLIFF[3], roofed: false, ground: snow, rock: stone, backdrop: skyDrop(1, 0xdfe7ee, 0x8ea8c3, 0xe4ebf1, height) };
    }
    case 'void': {
      const slab: Surface = { tile: slabTile(37, SLAB), edge: SLAB[4], lip: SLAB[0] };
      return {
        floor: slab, wall: slabTile(53, DARK), trim: DARK[3], roofed: true, ground: slab, rock: stone,
        // (a dark that deepens upwards, and on down below where a floor would be)
        backdrop: {
          sky: 0, base: [0.06, 0.065, 0.075], top: [0.06, 0.065, 0.075], far: [0.06, 0.065, 0.075],
          panels: 0, gradH: height, clear: 0x08090b, roofed: true,
        },
      };
    }
    default:
      return {
        floor: { tile: slabTile(11, FLOOR), edge: FLOOR[4], lip: FLOOR[0] },
        wall: slabTile(23, WALL),
        trim: WALL[3],
        roofed: true,
        ground: { tile: slabTile(37, SLAB), edge: SLAB[4], lip: SLAB[0] },
        rock: stone,
        // (the lab's: the wall darkens over 45 m of its 48)
        backdrop: {
          sky: 0, base: [0.157, 0.165, 0.176], top: [0.157, 0.165, 0.176], far: [0.157, 0.165, 0.176],
          panels: 0.018, gradH: (height * 45) / 48, clear: 0x16171a, roofed: true,
        },
      };
  }
}

/** What ground of a material looks like on a map of this look. */
function surfaceOf(mat: TerrainMat, look: Look): Surface {
  switch (mat) {
    case 'rock':
      return look.rock;
    case 'concrete':
      return { tile: slabTile(37, SLAB), edge: SLAB[4], lip: SLAB[0] };
    case 'brick':
      return { tile: brickTile(3, BRICK, CONCRETE[3]), edge: SLAB[4], lip: SLAB[0] };
    case 'windows':
      return { tile: windowsTile(7), edge: SLAB[4], lip: SLAB[0] };
    case 'metal':
      return { tile: metalTile(SHEET), edge: SHEET[4], lip: SHEET[0] };
    default:
      return look.ground;
  }
}

/** A piece of the map's ground as built: its corners, what it's made of, and its bounds. */
export interface Ground {
  pts: [number, number][];
  mat: TerrainMat;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** How wide (m) the stretches of floor are that ground is filed under, for groundAt(). */
const BUCKET = 4;

/**
 * On a map without a floor (the void): how far (m) below where the floor would
 * be groundAt() puts the bottom where there's no ground: a drop nobody walks
 * off. What falls is taken away before it gets there (see systems/Water's fallAway()).
 */
export const VOID_DROP = 60;

/** Where a vertical line at x crosses a convex outline: [bottom, top], or null where it misses. */
function spanAt(pts: [number, number][], x: number): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0, n = pts.length; i < n; i++) {
    const a = pts[i];
    const b = pts[i + 1 < n ? i + 1 : 0];
    if ((x < a[0] && x < b[0]) || (x > a[0] && x > b[0])) continue;
    if (a[0] === b[0]) {
      lo = Math.min(lo, a[1], b[1]);
      hi = Math.max(hi, a[1], b[1]);
      continue;
    }
    const y = a[1] + ((x - a[0]) / (b[0] - a[0])) * (b[1] - a[1]);
    if (y < lo) lo = y;
    if (y > hi) hi = y;
  }
  return hi > lo ? [lo, hi] : null;
}

/** The top of a convex outline at x (-Infinity where there's none). */
function topAt(pts: [number, number][], x: number): number {
  let top = -Infinity;
  for (let i = 0, n = pts.length; i < n; i++) {
    const a = pts[i];
    const b = pts[i + 1 < n ? i + 1 : 0];
    if ((x < a[0] && x < b[0]) || (x > a[0] && x > b[0])) continue;
    const y = a[0] === b[0] ? Math.max(a[1], b[1]) : a[1] + ((x - a[0]) / (b[0] - a[0])) * (b[1] - a[1]);
    if (y > top) top = y;
  }
  return top;
}

/**
 * The columns of whole sprite pixels a piece of ground fills above the floor,
 * merged into runs where they match: [first column, past the last, bottom row,
 * top row]. Its slopes come out in steps, as drawn pixel art's do.
 */
function columns(g: Ground, floorless = false): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  // (what's under the floor is hidden by it: drawn only where there's no floor)
  const floor = floorless ? -Infinity : Math.round(WORLD.floor / PX);
  let run: [number, number, number, number] | null = null;
  for (let c = Math.floor(g.x0 / PX), end = Math.ceil(g.x1 / PX); c < end; c++) {
    const s = spanAt(g.pts, (c + 0.5) * PX);
    const b = s ? Math.max(floor, Math.round(s[0] / PX)) : 0;
    const t = s ? Math.round(s[1] / PX) : 0;
    if (!s || t <= b) {
      run = null;
      continue;
    }
    if (run && run[2] === b && run[3] === t) run[1] = c + 1;
    else out.push((run = [c, c + 1, b, t]));
  }
  return out;
}

/** A number in 0..1 for a whole number, the same every time (where grass grows). */
function hash(n: number): number {
  let h = Math.imul(n ^ 0x2c1b3c6d, 0x297a2d39);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/** Rectangles gathered into one mesh: tiled in world space (so the tiles line up from piece to piece), or in flat colours. */
class Quads {
  private pos: number[] = [];
  private uv: number[] = [];
  private col: number[] = [];

  get empty(): boolean {
    return !this.pos.length;
  }

  /** A rectangle in world meters, tiled with a tile `tw` x `th` m, or filled with `color`. */
  rect(x0: number, y0: number, x1: number, y1: number, color: Color | null, tw = 1, th = 1): void {
    const xs = [x0, x1, x1, x0, x1, x0];
    const ys = [y0, y0, y1, y0, y1, y1];
    for (let i = 0; i < 6; i++) {
      this.pos.push(xs[i], ys[i], 0);
      if (color === null) this.uv.push(xs[i] / tw, ys[i] / th);
      else this.col.push(((color >> 16) & 255) / 255, ((color >> 8) & 255) / 255, (color & 255) / 255);
    }
  }

  mesh(mat: THREE.Material, z: number): THREE.Mesh {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    if (this.uv.length) geo.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.col.length) geo.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    const m = new THREE.Mesh(geo, mat);
    m.position.z = z;
    return m;
  }
}

/** Grass tufts a pixel or two tall here and there along a top at row t (the same on every build). */
function tufts(q: Quads, g: Ramp, c0: number, c1: number, t: number): void {
  for (let c = c0; c < c1; c++) {
    const h = hash(c);
    if (h > 0.35) continue;
    q.rect(c * PX, t * PX, (c + 1) * PX, (t + (h < 0.1 ? 2 : 1)) * PX, h < 0.18 ? g[3] : g[2]);
  }
}

/** Takes a group's meshes out and frees what they hold on the GPU (but the shared quad). */
function dispose(group: THREE.Group): void {
  for (const o of [...group.children]) {
    group.remove(o);
    const m = o as THREE.Mesh;
    if (m.geometry && m.geometry !== UNIT_QUAD) m.geometry.dispose();
    const mat = m.material as THREE.MeshBasicMaterial | undefined;
    mat?.map?.dispose();
    mat?.dispose();
  }
}

/**
 * The static sandbox: floor, walls and ceiling, and the map's ground (convex
 * pieces, see world/Maps), all colliders of one fixed body. Rebuilt in place
 * for another map (see Game.setMap()).
 */
export class Environment {
  /** Every static collider: the room's, then the ground's. */
  readonly colliders: RAPIER.Collider[] = [];
  readonly body: RAPIER.RigidBody;
  /** The map's ground as built. */
  ground: Ground[] = [];
  /** The backdrop of the map built (see Renderer.setBackdrop()). */
  backdrop!: Backdrop;
  /** The map built has no floor (the void): only its ground holds things up. */
  floorless = false;
  /** Where things land where there's no ground: the floor, or far down in the void (see VOID_DROP). */
  base: number = WORLD.floor;
  private physics: Physics;
  private look!: Look;
  private room: RAPIER.Collider[] = [];
  private groundColliders: RAPIER.Collider[] = [];
  private handles = new Set<number>();
  /** The ground filed by stretch of floor, BUCKET m wide from the left wall (see groundAt()). */
  private buckets: Ground[][] = [];
  /** Ground's looks made for this build, by material. */
  private surfaces = new Map<TerrainMat, Surface>();
  /** On an endless map: the floor and ceiling drawn, which follow the camera (see frame()). */
  private follow: THREE.Mesh[] = [];
  /** How far (m) they move at a time: a whole number of their tiles, so the tiles stay put in the world. */
  private followStep = 1;
  private group = new THREE.Group();
  private groundGroup = new THREE.Group();

  constructor(physics: Physics, scene: THREE.Scene, map: MapSpec = LAB) {
    this.physics = physics;
    this.body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    this.build(map);
    scene.add(this.group, this.groundGroup);
  }

  /** Builds a map's room (WORLD already set to its bounds) and its ground, in place of what was there. */
  build(map: MapSpec): void {
    const world = this.physics.world;
    for (const c of this.room) if (c.isValid()) world.removeCollider(c, true);
    this.room = [];
    dispose(this.group);
    const W = WORLD;
    const width = W.right - W.left;
    const height = W.ceiling - W.floor;
    const look = (this.look = lookOf(map.theme, height));
    this.backdrop = look.backdrop;
    this.surfaces.clear();
    const add = (cx: number, cy: number, hw: number, hh: number) => {
      const c = world.createCollider(
        RAPIER.ColliderDesc.cuboid(hw, hh)
          .setTranslation(cx, cy)
          .setFriction(0.85)
          .setRestitution(0.05)
          .setCollisionGroups(GROUPS_STATIC),
        this.body,
      );
      this.room.push(c);
    };
    const t = W.wallThickness;
    const ft = W.floorThickness;
    // (the void has none: what falls off its ground falls on down)
    this.floorless = floorless(map);
    this.base = this.floorless ? W.floor - VOID_DROP : W.floor;
    if (!this.floorless) add((W.left + W.right) / 2, W.floor - ft / 2, width / 2 + t, ft / 2);
    add(W.left - t / 2, W.floor + height / 2, t / 2, height / 2 + ft);
    add(W.right + t / 2, W.floor + height / 2, t / 2, height / 2 + ft);
    add((W.left + W.right) / 2, W.ceiling + t / 2, width / 2 + t, t / 2);

    // visuals (the floor's lit top edge is the ground's: see drawGround()). On an
    // endless map the floor and ceiling drawn are a stretch of them that follows
    // the camera, not meshes kilometres long.
    this.follow = [];
    const long = map.endless ? FOLLOW_W : width + t * 2;
    const floor = tiledMesh(look.floor.tile, long, ft, -20);
    floor.position.set((W.left + W.right) / 2, W.floor - ft / 2, -20);
    if (!this.floorless) this.group.add(floor);

    const wallL = tiledMesh(look.wall, t, height + ft + t, -20);
    wallL.position.set(W.left - t / 2, W.floor + (height - ft + t) / 2, -20);
    const wallR = wallL.clone();
    wallR.position.x = W.right + t / 2;
    this.group.add(wallL, wallR);
    // (out of doors the sky goes on up: the ceiling is there, but not drawn)
    let ceil: THREE.Mesh | null = null;
    if (look.roofed) {
      ceil = tiledMesh(look.wall, long, t, -20);
      ceil.position.set((W.left + W.right) / 2, W.ceiling + t / 2, -20);
      this.group.add(ceil);
    }
    if (map.endless) {
      // the floor's lit top edge and dark lip too (with no ground on it, it is bare all along)
      const edge = new THREE.Mesh(UNIT_QUAD, new THREE.MeshBasicMaterial({ color: look.floor.edge }));
      edge.scale.set(FOLLOW_W, PX * 2, 1);
      edge.position.set(0, W.floor - PX, -19);
      const lip = new THREE.Mesh(UNIT_QUAD, new THREE.MeshBasicMaterial({ color: look.floor.lip }));
      lip.scale.set(FOLLOW_W, PX * 3, 1);
      lip.position.set(0, W.floor - PX * 3.5, -19);
      this.group.add(edge, lip);
      this.follow = ceil ? [floor, ceil, edge, lip] : [floor, edge, lip];
      // (both tiles' widths in sprite pixels: they repeat together every so many)
      const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
      const a = look.floor.tile.w;
      const b = look.wall.w;
      this.followStep = ((a * b) / gcd(a, b)) * PX;
    }

    // wall trims
    for (const x of [W.left - PX, W.right + PX]) {
      const trim = new THREE.Mesh(UNIT_QUAD, new THREE.MeshBasicMaterial({ color: look.trim }));
      trim.scale.set(PX * 2, height, 1);
      trim.position.set(x, W.floor + height / 2, -19);
      this.group.add(trim);
    }
    this.buildGround(map);
  }

  /**
   * Builds the map's ground in place of what was there: a collider per piece,
   * and its look. The rest of the room stays (a map edited with the Terrain tool).
   */
  buildGround(map: MapSpec): void {
    const world = this.physics.world;
    for (const c of this.groundColliders) if (c.isValid()) world.removeCollider(c, true);
    this.groundColliders = [];
    this.ground = [];
    this.buckets = [];
    dispose(this.groundGroup);
    for (const piece of map.terrain) {
      const desc = RAPIER.ColliderDesc.convexHull(new Float32Array(piece.pts.flat()));
      if (!desc) continue;
      this.groundColliders.push(world.createCollider(desc.setFriction(0.85).setRestitution(0.05).setCollisionGroups(GROUPS_STATIC), this.body));
      const xs = piece.pts.map((p) => p[0]);
      const ys = piece.pts.map((p) => p[1]);
      const g: Ground = { pts: piece.pts, mat: piece.mat ?? 'ground', x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
      this.ground.push(g);
      for (let b = this.bucketOf(g.x0); b <= this.bucketOf(g.x1); b++) (this.buckets[b] ??= []).push(g);
    }
    this.colliders.length = 0;
    this.colliders.push(...this.room, ...this.groundColliders);
    this.handles = new Set(this.colliders.map((c) => c.handle));
    this.drawGround();
  }

  /**
   * The ground's look: each material's pieces in one mesh, in steps of whole
   * sprite pixels, with a lit edge along their tops; and the floor's lit edge,
   * broken wherever ground stands on the floor.
   */
  private drawGround(): void {
    const W = WORLD;
    const look = this.look;
    const fills = new Map<TerrainMat, Quads>();
    const strips = new Quads();
    for (const g of this.ground) {
      const s = this.surface(g.mat);
      let q = fills.get(g.mat);
      if (!q) fills.set(g.mat, (q = new Quads()));
      for (const [c0, c1, b, t] of columns(g, this.floorless)) {
        q.rect(c0 * PX, b * PX, c1 * PX, t * PX, null, s.tile.w * PX, s.tile.h * PX);
        // the lit top (2 sprite px) and the dark lip under it, unless more ground lies on it
        if (this.solidAt(((c0 + c1) / 2) * PX, (t + 0.75) * PX)) continue;
        strips.rect(c0 * PX, Math.max(b, t - 2) * PX, c1 * PX, t * PX, s.edge);
        if (t - 2 > b) strips.rect(c0 * PX, Math.max(b, t - 5) * PX, c1 * PX, (t - 2) * PX, s.lip);
        if (s.tufts) tufts(strips, s.tufts, c0, c1, t);
      }
    }
    // the floor's bare stretches (an endless map's edge follows the camera instead: see build())
    const bare: [number, number][] = [];
    if (this.floorless) {
      // (no floor to edge)
    } else if (!this.ground.length) {
      if (!this.follow.length) bare.push([W.left, W.right]);
    } else {
      const n = Math.round((W.right - W.left) / PX);
      let from = -1;
      for (let i = 0; i <= n; i++) {
        const open = i < n && !this.solidAt(W.left + (i + 0.5) * PX, W.floor + PX * 0.5);
        if (open && from < 0) from = i;
        else if (!open && from >= 0) {
          bare.push([W.left + from * PX, W.left + i * PX]);
          from = -1;
        }
      }
    }
    for (const [x0, x1] of bare) {
      // bright top edge of the floor (2 sprite px) + dark lip below it
      const edge = new THREE.Mesh(UNIT_QUAD, new THREE.MeshBasicMaterial({ color: look.floor.edge }));
      edge.scale.set(x1 - x0, PX * 2, 1);
      edge.position.set((x0 + x1) / 2, W.floor - PX, -19);
      const lip = new THREE.Mesh(UNIT_QUAD, new THREE.MeshBasicMaterial({ color: look.floor.lip }));
      lip.scale.set(x1 - x0, PX * 3, 1);
      lip.position.set((x0 + x1) / 2, W.floor - PX * 3.5, -19);
      this.groundGroup.add(edge, lip);
      if (look.floor.tufts) tufts(strips, look.floor.tufts, Math.round(x0 / PX), Math.round(x1 / PX), Math.round(W.floor / PX));
    }
    for (const [mat, q] of fills) {
      const tex = makePixelTexture(this.surface(mat).tile.toCanvas(0));
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      this.groundGroup.add(q.mesh(new THREE.MeshBasicMaterial({ map: tex }), -20));
    }
    if (!strips.empty) this.groundGroup.add(strips.mesh(new THREE.MeshBasicMaterial({ vertexColors: true }), -19));
  }

  /**
   * Each frame, on an endless map: the floor and ceiling drawn move along under
   * the camera, a whole number of tiles at a time (and not on past the end walls).
   */
  frame(camX: number): void {
    if (!this.follow.length) return;
    const s = this.followStep;
    const half = FOLLOW_W / 2;
    const t = WORLD.wallThickness;
    const x = clamp(Math.round(camX / s) * s, Math.ceil((WORLD.left - t + half) / s) * s, Math.floor((WORLD.right + t - half) / s) * s);
    for (const m of this.follow) m.position.x = x;
  }

  /** What ground of a material looks like on this map (made once a build). */
  private surface(mat: TerrainMat): Surface {
    let s = this.surfaces.get(mat);
    if (!s) this.surfaces.set(mat, (s = surfaceOf(mat, this.look)));
    return s;
  }

  private bucketOf(x: number): number {
    return Math.floor((x - WORLD.left) / BUCKET);
  }

  /**
   * The highest top of ground at x that is at or below y, or the floor if
   * there's none (in the void, far below: see base): where something falling at
   * x lands. Looks only at the ground filed under x, so it costs the same on a
   * map of any size.
   */
  groundAt(x: number, y: number): number {
    let best = this.base;
    const list = this.buckets[this.bucketOf(x)];
    if (!list) return best;
    for (let k = 0; k < list.length; k++) {
      const g = list[k];
      if (g.y1 <= best || g.y0 > y || x < g.x0 || x > g.x1) continue;
      const t = topAt(g.pts, x);
      if (t <= y && t > best) best = t;
    }
    return best;
  }

  /** The piece of ground at a point (or within `margin` m of it), the last laid if several; null if there's none. */
  groundPieceAt(x: number, y: number, margin = 0): Ground | null {
    const list = this.buckets[this.bucketOf(x)];
    if (!list) return null;
    for (let k = list.length - 1; k >= 0; k--) {
      const g = list[k];
      if (x < g.x0 - margin || x > g.x1 + margin || y < g.y0 - margin || y > g.y1 + margin) continue;
      if (contains(g.pts, x, y, margin)) return g;
    }
    return null;
  }

  /** Is there ground at a point? */
  solidAt(x: number, y: number): boolean {
    return this.groundPieceAt(x, y) !== null;
  }

  /**
   * Where a thing at (x, y) has to stand: on top of the ground y is inside (and
   * of any piled on that), else on the highest ground below y.
   */
  standAt(x: number, y: number): number {
    let top = y;
    for (let k = 0; k < 8; k++) {
      const g = this.groundPieceAt(x, top);
      if (!g) break;
      top = topAt(g.pts, x) + 1e-4;
    }
    return top > y ? top : this.groundAt(x, y);
  }

  isEnvironment(c: RAPIER.Collider): boolean {
    return this.handles.has(c.handle);
  }
}
