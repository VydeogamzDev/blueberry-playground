import * as THREE from 'three';
import { RAPIER } from '../engine/Physics';
import { PX } from '../engine/constants';
import { lerp, type V2 } from '../engine/math';
import type { Game } from '../world/Game';
import type { Part } from '../world/Part';
import type { Entity } from '../world/Entity';
import { PK } from './Particles';
import { stir } from './Settle';
import { KHAKI, RED, ORANGE, STEEL, STEEL_LT, BRASS, GUNMETAL, ramp, type Ramp } from '../art/palette';
import { FUSE } from '../art/bombs';

export type ConnKind = 'rope' | 'weld' | 'spring' | 'hinge' | 'pin' | 'wire' | 'fuse';

/** How fast a lit fuse cord burns along (m/s). */
export const FUSE_SPEED = 2;

/**
 * How a device uses a wire: 'in' only listens (gate inputs), 'out' only drives
 * (gate outputs, sensors), 'both' conducts like a plain wire.
 */
export type WireRole = 'in' | 'out' | 'both';

interface WiredDevice {
  wireRole?(c: Connection): WireRole;
  onPulse?(c: Connection): void;
  isPowerSource?(): boolean;
  conducts?(): boolean;
  /**
   * Powers its wires itself, but only in a circuit with no power source in it (a
   * lever switch wired straight to thrusters, no battery): see recomputePower().
   */
  powersAlone?(): boolean;
  /**
   * Turns round the power it lets through (or powers alone): what that power
   * reaches runs backwards (a reversing switch set to reverse; see recomputePower()).
   */
  flips?(): boolean;
}

export interface Connection {
  id: number;
  kind: ConnKind;
  a: Part;
  /** Anchor in A's local space (meters). */
  la: V2;
  /** Second part, or null for the static background. */
  b: Part | null;
  /** Anchor in B's local space, or a world point if b is null. */
  lb: V2;
  /**
   * A weld's far end, where it was dragged to (in B's local space, or the world's
   * if b is null): the joint holds at `la`/`lb`, a rod is drawn out to here.
   */
  end?: V2;
  joint: RAPIER.ImpulseJoint | null;
  rest: number;
  /** Separation (m) at which the connection snaps. */
  breakAt: number;
  /** Extra part pairs whose contacts this connection disabled. */
  ignored?: [Part, Part][];
  /** A hinge's (or pin's) swing limit, radians either side of `ref`; none: it swings freely. */
  limit?: number;
  /** The angle of a, less b's (or the background's), that the limit is measured from. */
  ref?: number;
  /** A spring's stiffness, times the usual (none: the usual). */
  stiffness?: number;
  /**
   * A lit fuse cord's burnt stretch, as fractions of its length from a: it burns
   * on both ways (lo toward a, hi toward b) until it reaches the ends.
   */
  burn?: { lo: number; hi: number };
  /** Its settings from its menu (hidden, colliding, how strong...); none: the usual. */
  opts?: ConnOpts;
}

/**
 * A connection's settings beyond its kind, set from its menu (see ui/ConnectionMenu).
 * Every field is optional: one left out is the usual, so saves without them load as before.
 */
export interface ConnOpts {
  /** Not drawn, except while building (time paused, or a connection tool in hand). */
  hidden?: true;
  /** A weld's or hinge's two parts still collide with each other (by default they don't). */
  collide?: true;
  /** How hard it is to tear: 'weak' snaps a quarter as far, 'unbreakable' never does. */
  strength?: 'weak' | 'unbreakable';
  /** A spring's damping, times the usual. */
  damping?: number;
}

/** The kinds that hold things together (an assembly moves as one: see assemblyOf()); wires only carry power. */
export const PHYSICAL_KINDS = new Set<ConnKind>(['rope', 'weld', 'spring', 'hinge', 'pin', 'fuse']);
/** The kinds that pin a point of one part to the other (re-made where things are moved to: see rebaseFor()). */
export const RIGID_KINDS = new Set<ConnKind>(['weld', 'hinge', 'pin']);

/** How far (m) a connection's ends may be pulled apart before it snaps, as made (see create()). */
function baseBreak(kind: ConnKind, rest: number, stiffness = 1): number {
  if (kind === 'rope' || kind === 'fuse') return Math.max(0.6, rest * 0.6);
  if (kind === 'spring') return rest + springReach(stiffness);
  return RIGID_KINDS.has(kind) ? 0.6 : Infinity;
}

/**
 * How far a connection may be pulled apart with its strength setting: a weak one
 * a quarter as far (a weak spring snaps once stretched to twice its length and
 * more), an unbreakable one never.
 */
function strengthOf(kind: ConnKind, rest: number, usual: number, opts?: ConnOpts): number {
  if (opts?.strength === 'unbreakable') return Infinity;
  if (opts?.strength !== 'weak') return usual;
  if (kind === 'spring') return rest * 2 + 0.3;
  return Number.isFinite(usual) ? usual / 4 : usual;
}

/**
 * Whether a hinge or pin between these is held fast: one on a motor's or a servo's
 * housing. The motor (or servo) does the turning: a motor wheel pinned on by its hub
 * drives, where its housing turning free on the pin would only spin round itself.
 */
function holdsFast(a: Part, b: Part | null): boolean {
  const housing = (p: Part | null) => !!p && (p.entity as { housing?: Part }).housing === p;
  return housing(a) || housing(b);
}

/** Whatever a fuse cord burns down to may react (bombs go off; anything else just catches fire). */
interface FuseTarget {
  onFuse?(): void;
}

/** How far a hinge may swing either side, as offered in the context menu (degrees; 0: freely). */
export const HINGE_LIMITS = [0, 15, 45, 90, 135];

/**
 * The stiffnesses a spring can have (times the usual), stepped through with the
 * Spring tool's key as People Playground steps between its spring and strong spring.
 */
export const SPRING_STIFFNESS = [
  { name: 'Soft', k: 0.3 },
  { name: 'Normal', k: 1 },
  { name: 'Strong', k: 3 },
  { name: 'Very strong', k: 8 },
];

/** Which of SPRING_STIFFNESS a stiffness is (the nearest). */
export function stiffnessStep(k: number): number {
  let best = 0;
  for (let i = 1; i < SPRING_STIFFNESS.length; i++) {
    if (Math.abs(Math.log(SPRING_STIFFNESS[i].k / k)) < Math.abs(Math.log(SPRING_STIFFNESS[best].k / k))) best = i;
  }
  return best;
}

/**
 * How far (m) past its rest length a spring `s` times as stiff as usual stretches
 * before it snaps: as far as holds the same energy at any stiffness (2 m at the
 * usual, an arm's length at the stiffest), so whatever it lets go of flies off
 * at most ~8 m/s rather than hundreds. It pulls no harder than it does there.
 */
export function springReach(s: number): number {
  return 2 / Math.sqrt(s);
}

/** Batches thick pixel-art line segments into one mesh. */
export class LineBatch {
  private max: number;
  private n = 0;
  private pos: Float32Array;
  private col: Float32Array;
  private geo = new THREE.BufferGeometry();
  readonly mesh: THREE.Mesh;

  constructor(max: number, z: number, material?: THREE.Material) {
    this.max = max;
    this.pos = new Float32Array(max * 4 * 3);
    this.col = new Float32Array(max * 4 * 3);
    this.buffers();
    this.mesh = new THREE.Mesh(this.geo, material ?? new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    this.mesh.frustumCulled = false;
    this.mesh.position.z = z;
  }

  /** (Re)makes the geometry's buffers for `max` segments. */
  private buffers(): void {
    const max = this.max;
    const idx = new Uint32Array(max * 6);
    for (let i = 0; i < max; i++) {
      idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
    }
    this.geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
  }

  /** Room for twice as many segments (a scene with hundreds of ropes would otherwise stop drawing some). */
  private grow(): void {
    this.max *= 2;
    const pos = new Float32Array(this.max * 4 * 3);
    const col = new Float32Array(this.max * 4 * 3);
    pos.set(this.pos);
    col.set(this.col);
    this.pos = pos;
    this.col = col;
    // (the old buffers are let go of on the graphics card; the new ones go up on the next draw)
    this.geo.dispose();
    this.buffers();
  }

  begin(): void {
    this.n = 0;
  }

  seg(x0: number, y0: number, x1: number, y1: number, w: number, color: number): void {
    if (this.n >= this.max) {
      if (this.max >= 1 << 20) return;
      this.grow();
    }
    const dx = x1 - x0;
    const dy = y1 - y0;
    const l = Math.hypot(dx, dy) || 1;
    const nx = (-dy / l) * w * 0.5;
    const ny = (dx / l) * w * 0.5;
    // extend ends by half width so joined segments have no gaps
    const ex = (dx / l) * w * 0.5;
    const ey = (dy / l) * w * 0.5;
    const o = this.n * 12;
    this.pos.set([x0 + nx - ex, y0 + ny - ey, 0, x1 + nx + ex, y1 + ny + ey, 0, x1 - nx + ex, y1 - ny + ey, 0, x0 - nx - ex, y0 - ny - ey, 0], o);
    const r = ((color >> 16) & 255) / 255;
    const g = ((color >> 8) & 255) / 255;
    const b = (color & 255) / 255;
    for (let k = 0; k < 4; k++) this.col.set([r, g, b], o + k * 3);
    this.n++;
  }

  /** Axis-aligned filled square centered on (x, y). */
  quad(x: number, y: number, size: number, color: number): void {
    // a zero-length segment extended by half its width on each end is a square
    this.seg(x - 1e-5, y, x + 1e-5, y, size, color);
  }

  end(): void {
    this.geo.setDrawRange(0, this.n * 6);
    (this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }
}

/** A live wire whose power runs turned round, past a reversing switch set to reverse. */
const REVERSED = ramp('#3f8fc8');

/** Connections use the same material ramps as the sprites (0 = outline ... 4 = highlight). */
export const RAMPS: Record<ConnKind, Ramp> = {
  rope: KHAKI,
  weld: STEEL_LT,
  spring: STEEL_LT,
  hinge: BRASS,
  pin: BRASS,
  wire: RED,
  fuse: FUSE,
};

export class Connections {
  private game: Game;
  readonly list: Connection[] = [];
  private nextId = 1;
  private lines = new LineBatch(6000, 44);
  showWires = true;
  private powered = new Set<Entity>();
  /** Wires carrying power (on to whatever is at their other end, or into a device's input side). */
  private liveWires = new Set<Connection>();
  /** The live wires whose power only comes turned round (by a reversing switch): drawn in another colour. */
  private backWires = new Set<Connection>();
  /**
   * The newest thing in the scene at the end of the last step or frame. Anything
   * newer was only just made (pasted, loaded, undone, flipped) and comes in powered
   * as it was saved, without going off as the power reaches it (see recomputePower()).
   */
  private settled = 0;
  /** Power changes now set nothing off (see removeFor()). */
  private quiet = false;
  /** Seconds to the next look for fires touching unlit fuse cords. */
  private fireT = 0;
  /** `t` along the cord of the point nearestOn() last found. */
  private nearT = 0;
  /** Connections taken away so far (see postStep()). */
  private removals = 0;
  /** Goes up whenever a connection is made, taken away or re-made (what's joined to what may have changed). */
  version = 0;
  /** Contraptions (see builtWith()), each shared by its things, as the connections were at `builtAt` (their version). */
  private built = new Map<Entity, Set<Entity>>();
  private builtAt = -1;
  /** Things an EMP has knocked out (see entities/Emp.ts): while in here they neither give nor take power, nor hear pulses. */
  readonly jammed = new Set<Entity>();
  /** Draw hidden connections too (while building: time paused, or a connection tool in hand). */
  showHidden = false;
  /** Connections the cursor is on, drawn with a glow of this colour (red: about to be removed). */
  readonly highlights = new Map<Connection, number>();
  /** The pulse going round now: who has sent it on, and who has heard it (see pulse()). */
  private wave: { sent: Set<Entity>; heard: Set<Entity> } | null = null;

  constructor(game: Game) {
    this.game = game;
    game.renderer.scene.add(this.lines.mesh);
  }

  private anchorWorld(c: Connection, which: 'a' | 'b'): V2 {
    if (which === 'a') return c.a.localToWorld(c.la.x, c.la.y);
    return c.b ? c.b.localToWorld(c.lb.x, c.lb.y) : c.lb;
  }

  /** Interpolated anchor for rendering. */
  private anchorRender(p: Part | null, l: V2, alpha: number): V2 {
    if (!p) return l;
    const x = lerp(p.px, p.x, alpha);
    const y = lerp(p.py, p.y, alpha);
    const a = p.pa + (p.a - p.pa) * alpha;
    const c = Math.cos(a);
    const s = Math.sin(a);
    return { x: x + l.x * c - l.y * s, y: y + l.x * s + l.y * c };
  }

  /**
   * Creates a connection. Anchors are world points: `wa` on part `a`, `wb` on part `b`
   * (or on the background if b is null). A hinge or pin can be given a swing
   * limit (see setLimit()), measured from `ref` (default: how it sits now); a
   * spring a stiffness (see setStiffness()); any of them settings (see ConnOpts).
   */
  create(kind: ConnKind, a: Part, wa: V2, b: Part | null, wb: V2, restOverride?: number, swing?: { limit?: number; ref?: number }, stiffness?: number, opts?: ConnOpts): Connection | null {
    if (b === a) return null;
    const world = this.game.physics.world;
    const la = a.worldToLocal(wa.x, wa.y);
    const lb = b ? b.worldToLocal(wb.x, wb.y) : { x: wb.x, y: wb.y };
    const bodyB = b ? b.body : this.game.env.body;
    const rest = restOverride ?? Math.hypot(wb.x - wa.x, wb.y - wa.y);
    let joint: RAPIER.ImpulseJoint | null = null;
    let breakAt = Infinity;
    let end: V2 | undefined;
    switch (kind) {
      case 'rope':
      case 'fuse':
        joint = world.createImpulseJoint(RAPIER.JointData.rope(Math.max(0.05, rest), la, lb), a.body, bodyB, true);
        breakAt = Math.max(0.6, rest * 0.6);
        break;
      case 'spring': {
        joint = this.springJoint(a, la, b, lb, rest, stiffness ?? 1, opts?.damping);
        breakAt = baseBreak('spring', rest, stiffness ?? 1);
        break;
      }
      case 'weld': {
        // keep the current relative orientation
        const lbw = b ? b.worldToLocal(wa.x, wa.y) : { x: wa.x, y: wa.y };
        const rel = a.body.rotation() - (b ? b.body.rotation() : 0);
        joint = world.createImpulseJoint(RAPIER.JointData.fixed(la, 0, lbw, rel), a.body, bodyB, true);
        joint.setContactsEnabled(false);
        // (the rod drawn to where it was dragged; welded where things touch, there's none)
        if (Math.hypot(wb.x - wa.x, wb.y - wa.y) > PX * 3) end = { x: lb.x, y: lb.y };
        lb.x = lbw.x;
        lb.y = lbw.y;
        breakAt = 0.6;
        break;
      }
      case 'hinge':
      case 'pin': {
        const lbw = b ? b.worldToLocal(wa.x, wa.y) : { x: wa.x, y: wa.y };
        joint = this.turnJoint(a, la, b, lbw);
        lb.x = lbw.x;
        lb.y = lbw.y;
        breakAt = 0.6;
        break;
      }
      case 'wire':
        break;
    }
    breakAt = strengthOf(kind, rest, breakAt, opts);
    let ignored: [Part, Part][] | undefined;
    if (joint && b && kind !== 'spring' && kind !== 'rope' && kind !== 'fuse' && !opts?.collide) {
      // stop the two parts from fighting each other through contacts
      a.noCollideWith(b);
      b.noCollideWith(a);
      // things fixed to a rotor must swing past the rest of their machine (motor housings)
      ignored = [];
      for (const [p, q] of [[a, b], [b, a]] as [Part, Part][]) {
        if (!q.entity.attachIgnoresBody) continue;
        for (const r of q.entity.parts) {
          if (r === q || r === p || r.destroyed || p.noCollide?.has(r)) continue;
          p.noCollideWith(r);
          r.noCollideWith(p);
          ignored.push([p, r]);
        }
      }
    }
    const c: Connection = { id: this.nextId++, kind, a, la, b, lb, joint, rest, breakAt, ignored };
    if (end) c.end = end;
    if (opts && Object.keys(opts).length) c.opts = { ...opts };
    this.version++;
    if (kind === 'spring' && stiffness !== undefined && stiffness !== 1) c.stiffness = stiffness;
    if (joint && (kind === 'hinge' || kind === 'pin') && swing?.limit !== undefined && !holdsFast(a, b)) {
      c.limit = swing.limit;
      c.ref = swing.ref ?? this.relAngle(c);
      this.applyLimit(joint, c.ref, c.limit);
    }
    this.list.push(c);
    if (kind === 'wire') {
      this.recomputePower();
      if (!this.game.net?.guest) this.game.stats.add('wires');
    } else {
      // (a balloon tied to someone settled asleep must lift them, not snap its rope on them)
      this.stirEnds(c);
    }
    return c;
  }

  /** The angle of a connection's first part less its second's (or the background's). */
  relAngle(c: Connection): number {
    return c.a.body.rotation() - (c.b ? c.b.body.rotation() : 0);
  }

  /**
   * Limits how far a hinge (or pin) swings either side of how it sits now, or
   * frees it again (null). Rapier can't take a joint's limits off again, so the
   * joint is made afresh either way.
   */
  setLimit(c: Connection, limit: number | null): void {
    if ((c.kind !== 'hinge' && c.kind !== 'pin') || !this.list.includes(c)) return;
    this.stirEnds(c);
    const world = this.game.physics.world;
    if (c.joint?.isValid()) world.removeImpulseJoint(c.joint, true);
    const j = this.turnJoint(c.a, c.la, c.b, c.lb);
    c.joint = j;
    if (limit === null || holdsFast(c.a, c.b)) {
      c.limit = c.ref = undefined;
      return;
    }
    c.limit = limit;
    c.ref = this.relAngle(c);
    this.applyLimit(j, c.ref, limit);
  }

  /**
   * A hinge's or pin's joint, from `la` on `a` to `lb` on `b` (null: the background).
   * One on a motor's or a servo's housing holds it fast, as a weld would (see holdsFast()).
   */
  private turnJoint(a: Part, la: V2, b: Part | null, lb: V2): RAPIER.ImpulseJoint {
    const data = holdsFast(a, b)
      ? RAPIER.JointData.fixed(la, 0, lb, a.body.rotation() - (b ? b.body.rotation() : 0))
      : RAPIER.JointData.revolute(la, lb);
    const j = this.game.physics.world.createImpulseJoint(data, a.body, b ? b.body : this.game.env.body, true);
    j.setContactsEnabled(false);
    return j;
  }

  private applyLimit(j: RAPIER.ImpulseJoint, ref: number, limit: number): void {
    // the joint measures the angle between its two frames; turning the second
    // frame by `ref` makes the pose the limit was set in read as 0, so the limits
    // never straddle the half turn where that angle wraps round
    const raw = (j as unknown as { rawSet: { jointSetFrameX2(handle: number, rot: unknown): void } }).rawSet;
    const rot = RAPIER.RotationOps.intoRaw(ref);
    raw.jointSetFrameX2(j.handle, rot);
    rot.free();
    (j as RAPIER.RevoluteImpulseJoint).setLimits(-limit, limit);
  }

  /**
   * A spring joint, `s` times as stiff as usual. The usual suits the masses it
   * holds (it bounces about as fast whatever hangs on it), damped a little.
   */
  private springJoint(a: Part, la: V2, b: Part | null, lb: V2, rest: number, s: number, damping = 1): RAPIER.ImpulseJoint {
    // what hangs on it is the whole thing tied, not just the part: a person hung
    // by a hand weighs 60 kg, not the hand's 0.3
    const mass = (p: Part | null) => (p && !p.frozen ? p.entity.totalMass() : Infinity);
    const mA = mass(a);
    const mB = mass(b);
    const mEff = mA === Infinity ? (mB === Infinity ? 50 : mB) : mB === Infinity ? mA : (mA * mB) / (mA + mB);
    const k = Math.max(40, mEff * 70) * s;
    const damp = 2 * Math.sqrt(k * mEff) * 0.12 * damping;
    const joint = this.game.physics.world.createImpulseJoint(RAPIER.JointData.spring(Math.max(0.02, rest), k, damp, la, lb), a.body, b ? b.body : this.game.env.body, true);
    joint.setContactsEnabled(true);
    // (no harder than stretched as far as it goes before it snaps: one stretched
    // much further, as made or loaded, mustn't fling things off in the step before)
    const raw = (joint as unknown as { rawSet: { jointSetMotorMaxForce(handle: number, axis: number, f: number): void } }).rawSet;
    raw.jointSetMotorMaxForce(joint.handle, RAPIER.JointAxis.LinX, k * springReach(s));
    return joint;
  }

  /** Makes a spring `s` times as stiff as usual. (The joint is made afresh, as with setLimit().) */
  setStiffness(c: Connection, s: number): void {
    if (c.kind !== 'spring' || !this.list.includes(c)) return;
    this.stirEnds(c);
    if (c.joint?.isValid()) this.game.physics.world.removeImpulseJoint(c.joint, true);
    c.joint = this.springJoint(c.a, c.la, c.b, c.lb, c.rest, s, c.opts?.damping);
    // (snapping as much sooner or later as it's stiffer or softer now)
    c.breakAt = strengthOf(c.kind, c.rest, baseBreak(c.kind, c.rest, s), c.opts);
    c.stiffness = s === 1 ? undefined : s;
  }

  // ---- editing (the connection menu, dragging an end, moving things while time is paused) ----

  /**
   * Makes a connection's joint afresh from what the connection says now (its
   * anchors, length, stiffness, swing limit, settings). A weld holds its parts
   * at the angle they are at now.
   */
  private remake(c: Connection): void {
    const world = this.game.physics.world;
    // (a fuse cord let go of at one end lies loose: no joint)
    if (!c.joint && c.kind !== 'wire') return;
    if (c.kind !== 'wire') this.stirEnds(c);
    if (c.joint?.isValid()) world.removeImpulseJoint(c.joint, true);
    c.joint = null;
    const bodyB = c.b ? c.b.body : this.game.env.body;
    switch (c.kind) {
      case 'rope':
      case 'fuse':
        c.joint = world.createImpulseJoint(RAPIER.JointData.rope(Math.max(0.05, c.rest), c.la, c.lb), c.a.body, bodyB, true);
        break;
      case 'spring':
        c.joint = this.springJoint(c.a, c.la, c.b, c.lb, c.rest, c.stiffness ?? 1, c.opts?.damping);
        break;
      case 'weld':
        c.joint = world.createImpulseJoint(RAPIER.JointData.fixed(c.la, 0, c.lb, this.relAngle(c)), c.a.body, bodyB, true);
        c.joint.setContactsEnabled(false);
        break;
      case 'hinge':
      case 'pin':
        c.joint = this.turnJoint(c.a, c.la, c.b, c.lb);
        if (c.limit !== undefined && c.ref !== undefined && !holdsFast(c.a, c.b)) this.applyLimit(c.joint, c.ref, c.limit);
        break;
      case 'wire':
        break;
    }
    c.breakAt = strengthOf(c.kind, c.rest, baseBreak(c.kind, c.rest, c.stiffness), c.opts);
    this.version++;
  }

  /** A rope's, spring's or fuse cord's length (m), kept within 2 cm and 40 m. */
  setRest(c: Connection, len: number): void {
    if ((c.kind !== 'rope' && c.kind !== 'spring' && c.kind !== 'fuse') || !this.list.includes(c) || !Number.isFinite(len)) return;
    c.rest = Math.min(40, Math.max(0.02, len));
    this.remake(c);
  }

  /** Changes a connection's settings (a field set to undefined goes back to the usual). */
  setOpts(c: Connection, patch: Partial<Record<keyof ConnOpts, unknown>>): void {
    if (!this.list.includes(c)) return;
    const before = c.opts ?? {};
    const next: Record<string, unknown> = { ...before, ...patch };
    for (const k of Object.keys(next)) if (next[k] === undefined || next[k] === false) delete next[k];
    const opts = Object.keys(next).length ? (next as ConnOpts) : undefined;
    c.opts = opts;
    // colliding or not: a rigid link's pair of parts
    if (!!before.collide !== !!opts?.collide && c.b && RIGID_KINDS.has(c.kind)) {
      if (opts?.collide) {
        const still = this.list.some((o) => o !== c && RIGID_KINDS.has(o.kind) && !o.opts?.collide && ((o.a === c.a && o.b === c.b) || (o.a === c.b && o.b === c.a)));
        if (!still) {
          c.a.collideWith(c.b);
          c.b.collideWith(c.a);
        }
      } else {
        c.a.noCollideWith(c.b);
        c.b.noCollideWith(c.a);
      }
    }
    if (c.kind === 'spring' && (before.damping ?? 1) !== (opts?.damping ?? 1)) this.remake(c);
    c.breakAt = c.joint ? strengthOf(c.kind, c.rest, baseBreak(c.kind, c.rest, c.stiffness), opts) : c.breakAt;
    this.version++;
  }

  /**
   * Moves one end of a connection to another part (or the background: null), at
   * a world point. The connection is made again there, keeping its length,
   * stiffness, swing limit and settings; a weld or hinge holds its parts as they
   * are now. Returns the connection as it is now (null: it can't go there).
   */
  moveEnd(c: Connection, end: 'a' | 'b', part: Part | null, w: V2): Connection | null {
    if (!this.list.includes(c) || (part && part.destroyed)) return null;
    const pa = this.anchorWorld(c, 'a');
    // a weld's far end is where its rod is drawn to, not the joint (see create())
    const pb = c.kind === 'weld' && c.end ? (c.b ? c.b.localToWorld(c.end.x, c.end.y) : { ...c.end }) : this.anchorWorld(c, 'b');
    let a: Part | null = c.a;
    let b: Part | null = c.b;
    let wa = pa;
    let wb = pb;
    if (end === 'a') {
      a = part;
      wa = w;
    } else {
      b = part;
      wb = w;
    }
    // (a connection's first end is always on something: one moved off it turns round)
    if (!a) {
      if (!b || RIGID_KINDS.has(c.kind)) return null;
      [a, b, wa, wb] = [b, null, wb, wa];
    }
    if (a === b || (c.kind === 'wire' && (!b || a.entity === b.entity))) return null;
    const swing = c.limit !== undefined ? { limit: c.limit } : undefined;
    const made = this.create(c.kind, a, wa, b, wb, c.kind === 'wire' ? undefined : c.rest, swing, c.stiffness, c.opts);
    if (!made) return null;
    made.burn = c.burn;
    this.remove(c);
    // (the same number: the host's guests know it by that)
    made.id = c.id;
    return made;
  }

  /**
   * Things were moved by hand while time is paused, each by however much: the
   * welds, hinges and pins between them and things that stayed (or the
   * background) are made again as things are now, so time running again doesn't
   * tear them apart or yank things back. A weld's or hinge's anchor stays where it
   * is on its first part, and the second part is held there now; one tied to the
   * background is tied where its part is now. Ropes and springs keep their length.
   */
  rebaseFor(ents: Iterable<Entity>): void {
    const set = ents instanceof Set ? (ents as Set<Entity>) : new Set(ents);
    if (!set.size) return;
    for (const c of this.list) {
      if (!RIGID_KINDS.has(c.kind) || !c.joint) continue;
      const inA = set.has(c.a.entity);
      const inB = !!c.b && set.has(c.b.entity);
      if (c.b ? inA === inB : !inA) continue;
      const wa = c.a.localToWorld(c.la.x, c.la.y);
      const old = c.b ? c.b.localToWorld(c.lb.x, c.lb.y) : { ...c.lb };
      if (c.b) {
        const lb = c.b.worldToLocal(wa.x, wa.y);
        // a weld whose parts moved apart keeps a rod out to where it held the second part
        if (c.kind === 'weld' && !c.end && Math.hypot(old.x - wa.x, old.y - wa.y) > PX * 3) c.end = { ...c.lb };
        c.lb = lb;
      } else {
        // (tied to the background: the rod's far end goes along with its part)
        if (c.end) c.end = { x: c.end.x + wa.x - old.x, y: c.end.y + wa.y - old.y };
        c.lb = wa;
      }
      if (c.limit !== undefined && c.ref !== undefined) {
        // a hinge turned past its limit is limited from where it is now (else it would snap back)
        let off = this.relAngle(c) - c.ref;
        off = Math.atan2(Math.sin(off), Math.cos(off));
        if (Math.abs(off) > c.limit) c.ref = this.relAngle(c);
      }
      this.remake(c);
    }
  }

  /**
   * The things joined to these through connections that hold them together
   * (not wires, nor the background), and what they hold; with `physicalOnly`
   * false, through wires too.
   */
  assemblyOf(ents: Iterable<Entity>, physicalOnly = true): Entity[] {
    const out: Entity[] = [];
    const seen = new Set<Entity>();
    const add = (e: Entity) => {
      if (e.destroyed || seen.has(e)) return;
      seen.add(e);
      out.push(e);
    };
    for (const e of ents) add(e);
    // each entity's links, found once
    const links = new Map<Entity, Entity[]>();
    const link = (x: Entity, y: Entity) => {
      let l = links.get(x);
      if (!l) links.set(x, (l = []));
      l.push(y);
    };
    for (const c of this.list) {
      if (!c.b || (physicalOnly && !PHYSICAL_KINDS.has(c.kind))) continue;
      if (c.a.entity === c.b.entity) continue;
      link(c.a.entity, c.b.entity);
      link(c.b.entity, c.a.entity);
    }
    for (let i = 0; i < out.length; i++) {
      const e = out[i];
      for (const n of links.get(e) ?? []) add(n);
      for (const n of e.attachedEntities()) add(n);
    }
    return out;
  }

  /** Every connection between two of these things (or from one of them to the background). */
  connectionsWithin(ents: Set<Entity>): Connection[] {
    return this.list.filter((c) => ents.has(c.a.entity) && (!c.b || ents.has(c.b.entity)));
  }

  /** The spring passing within `r` m of (x, y), nearest it (only those on `of`, if given). */
  springAt(x: number, y: number, r: number, of?: Entity): Connection | null {
    let best: Connection | null = null;
    let bd = r;
    for (const c of this.list) {
      if (c.kind !== 'spring' || (of && c.a.entity !== of && c.b?.entity !== of)) continue;
      const a = this.anchorWorld(c, 'a');
      const b = this.anchorWorld(c, 'b');
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1)));
      const d = Math.hypot(a.x + dx * t - x, a.y + dy * t - y);
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    return best;
  }

  /**
   * The connection drawn nearest (x, y), within `r` m: a rope's, spring's, wire's
   * or fuse cord's line, a weld's rod, a hinge's or pin's knot (the Remove tool
   * clicked on one rather than on an object).
   */
  connectionAt(x: number, y: number, r: number): Connection | null {
    let best: Connection | null = null;
    let bd = r;
    for (const c of this.list) {
      if (c.kind === 'wire' && !this.showWires) continue;
      const pa = this.anchorRender(c.a, c.la, 1);
      let d: number;
      if (c.kind === 'hinge' || c.kind === 'pin' || (c.kind === 'weld' && !c.end)) d = Math.hypot(pa.x - x, pa.y - y);
      else if (c.kind === 'weld') d = this.nearCurve(pa, this.anchorRender(c.b, c.end!, 1), 0, x, y);
      else {
        const pb = this.anchorRender(c.b, c.lb, 1);
        // (sagging as drawn: see frame())
        const sag = c.kind === 'wire' ? Math.hypot(pb.x - pa.x, pb.y - pa.y) * 0.08 : c.kind === 'spring' ? 0 : this.sagOf(c, pa, pb);
        d = this.nearCurve(pa, pb, sag, x, y);
      }
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    return best;
  }

  /**
   * The connection drawn nearest (x, y) within `r` m (hidden ones only while
   * they're shown), and which of it: one of its knots (its ends, as drawn: a
   * weld's rod end is its 'b') or its line.
   */
  hitAt(x: number, y: number, r: number): { c: Connection; end: 'a' | 'b' | 'line'; d: number } | null {
    let best: { c: Connection; end: 'a' | 'b' | 'line'; d: number } | null = null;
    for (const c of this.list) {
      if (c.kind === 'wire' && !this.showWires) continue;
      if (c.opts?.hidden && !this.showHidden) continue;
      const pa = this.anchorRender(c.a, c.la, 1);
      const pb = c.kind === 'weld' ? (c.end ? this.anchorRender(c.b, c.end, 1) : null) : c.kind === 'hinge' || c.kind === 'pin' ? null : this.anchorRender(c.b, c.lb, 1);
      // (a knot wins over the line a little way off it)
      const da = Math.hypot(pa.x - x, pa.y - y) - r * 0.25;
      const db = pb ? Math.hypot(pb.x - x, pb.y - y) - r * 0.25 : Infinity;
      let d = Math.min(da, db);
      let end: 'a' | 'b' | 'line' = da <= db ? 'a' : 'b';
      if (pb) {
        const sag = c.kind === 'wire' ? Math.hypot(pb.x - pa.x, pb.y - pa.y) * 0.08 : c.kind === 'rope' || c.kind === 'fuse' ? this.sagOf(c, pa, pb) : 0;
        const dl = this.nearCurve(pa, pb, sag, x, y);
        if (dl < d) {
          d = dl;
          end = 'line';
        }
      }
      if (d <= r && (!best || d < best.d)) best = { c, end, d };
    }
    return best;
  }

  /** Where a connection's end is drawn (a weld's 'b': where its rod ends). */
  endPoint(c: Connection, end: 'a' | 'b'): V2 {
    if (end === 'a') return this.anchorRender(c.a, c.la, 1);
    if (c.kind === 'weld' && c.end) return this.anchorRender(c.b, c.end, 1);
    return this.anchorRender(c.b, c.lb, 1);
  }

  /** A glow round a connection the cursor is on, drawn under it (see `highlight`). */
  private halo(c: Connection, pa: V2, pb: V2, alpha: number, col: number): void {
    const L = this.lines;
    const w = PX * 5;
    if (c.kind === 'hinge' || c.kind === 'pin' || c.kind === 'weld') {
      L.quad(pa.x, pa.y, PX * 8, col);
      if (c.kind === 'weld' && c.end) {
        const pe = this.anchorRender(c.b, c.end, alpha);
        L.seg(pa.x, pa.y, pe.x, pe.y, w, col);
        L.quad(pe.x, pe.y, PX * 6, col);
      }
      return;
    }
    const d = Math.hypot(pb.x - pa.x, pb.y - pa.y);
    const sag = c.kind === 'wire' ? d * 0.08 : c.kind === 'spring' ? 0 : this.sagOf(c, pa, pb);
    this.curve(pa, pb, sag, c.kind === 'spring' ? PX * 9 : w, col);
    L.quad(pa.x, pa.y, PX * 6, col);
    L.quad(pb.x, pb.y, PX * 6, col);
  }

  /** How near a line from a to b, sagging `sag` in its middle, comes to (x, y) (as short straight pieces). */
  private nearCurve(a: V2, b: V2, sag: number, x: number, y: number): number {
    const n = sag > 0.01 ? 12 : 1;
    let bd = Infinity;
    let x0 = a.x;
    let y0 = a.y;
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      const x1 = a.x + (b.x - a.x) * t;
      const y1 = a.y + (b.y - a.y) * t - sag * 4 * t * (1 - t);
      const dx = x1 - x0;
      const dy = y1 - y0;
      const u = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / (dx * dx + dy * dy || 1)));
      bd = Math.min(bd, Math.hypot(x0 + dx * u - x, y0 + dy * u - y));
      x0 = x1;
      y0 = y1;
    }
    return bd;
  }

  remove(c: Connection): void {
    const i = this.list.indexOf(c);
    if (i < 0) return;
    this.list.splice(i, 1);
    this.removals++;
    this.version++;
    this.highlights.delete(c);
    if (c.joint && c.joint.isValid()) {
      this.game.physics.world.removeImpulseJoint(c.joint, true);
      this.stirEnds(c);
    }
    if (c.b && c.kind !== 'spring' && c.kind !== 'rope' && c.kind !== 'wire' && c.kind !== 'fuse') {
      // only re-enable contacts if no other rigid link still joins them (a rope,
      // spring or wire on the same pair never kept them apart)
      const rigid = (o: Connection) => RIGID_KINDS.has(o.kind) && !o.opts?.collide;
      const still = this.list.some((o) => rigid(o) &&((o.a === c.a && o.b === c.b) || (o.a === c.b && o.b === c.a)));
      if (!still) {
        c.a.collideWith(c.b);
        c.b.collideWith(c.a);
      }
    }
    for (const [p, q] of c.ignored ?? []) {
      p.collideWith(q);
      q.collideWith(p);
    }
    if (c.kind === 'wire') this.recomputePower();
  }

  /** What a connection holds wakes when the connection changes (see Settle's stir()). */
  private stirEnds(c: Connection): void {
    if (!c.a.entity.destroyed) stir(this.game, c.a.entity);
    if (c.b && !c.b.entity.destroyed && c.b.entity !== c.a.entity) stir(this.game, c.b.entity);
  }

  /**
   * `e` and the things fixed to it by welds, hinges or pins, directly or through each
   * other: the contraption it's built into (just `e`, if nothing is).
   */
  builtWith(e: Entity): Set<Entity> {
    if (this.builtAt !== this.version) {
      this.built.clear();
      this.builtAt = this.version;
    }
    let set = this.built.get(e);
    if (set) return set;
    const next = new Map<Entity, Entity[]>();
    const link = (a: Entity, b: Entity) => {
      let l = next.get(a);
      if (!l) next.set(a, (l = []));
      l.push(b);
    };
    for (const k of this.list) {
      if (!RIGID_KINDS.has(k.kind) || !k.b || !k.joint || k.a.entity === k.b.entity) continue;
      link(k.a.entity, k.b.entity);
      link(k.b.entity, k.a.entity);
    }
    set = new Set<Entity>([e]);
    const queue: Entity[] = [e];
    while (queue.length) {
      for (const x of next.get(queue.pop()!) ?? []) {
        if (set.has(x)) continue;
        set.add(x);
        queue.push(x);
      }
    }
    for (const x of set) this.built.set(x, set);
    return set;
  }

  connectionsOf(e: Entity): Connection[] {
    return this.list.filter((c) => c.a.entity === e || (c.b && c.b.entity === e));
  }

  removeFor(e: Entity): void {
    // (quietly: deleting a thing, or clearing the scene for an undo or a load, sets nothing off)
    this.quiet = true;
    for (const c of this.connectionsOf(e)) this.remove(c);
    this.quiet = false;
  }

  removeForPart(p: Part): void {
    for (const c of this.list.filter((c) => c.a === p || c.b === p)) {
      // a burning fuse cord outlasts a limb blown off it (if it's still tied to
      // something at its other end), and burns on from where it was tied
      if (c.kind === 'fuse' && c.burn && (c.a !== p || c.b)) this.loosen(c, c.a === p);
      else this.remove(c);
    }
  }

  clearAll(): void {
    for (const c of [...this.list]) this.remove(c);
  }

  // ---- electrical ---------------------------------------------------------

  roleOf(e: Entity, c: Connection): WireRole {
    return (e as Entity & WiredDevice).wireRole?.(c) ?? 'both';
  }

  /** Wires touching `e` with the entity at their other end. */
  wiresOf(e: Entity): { c: Connection; n: Entity }[] {
    const out: { c: Connection; n: Entity }[] = [];
    for (const c of this.list) {
      if (c.kind !== 'wire' || !c.b) continue;
      if (c.a.entity === e && c.b.entity !== e) out.push({ c, n: c.b.entity });
      else if (c.b.entity === e && c.a.entity !== e) out.push({ c, n: c.a.entity });
    }
    return out;
  }

  /** Whether this wire carries power (an input wire: into its device). */
  live(c: Connection): boolean {
    return this.liveWires.has(c);
  }

  /**
   * Sends a one-shot activation pulse to everything wired to `from` (respecting
   * input/output sides: a gate only sends from its output and only hears on its inputs).
   */
  pulse(from: Entity, fromPower = false): void {
    // a pulse passed on (through gates) goes round a loop of them once: each
    // device sends it on, and hears it, once a wave
    const first = !this.wave;
    const wave = (this.wave ??= { sent: new Set(), heard: new Set() });
    if (wave.sent.has(from)) return;
    wave.sent.add(from);
    try {
      for (const { c, n } of this.wiresOf(from)) {
        if (this.roleOf(from, c) === 'in' || this.roleOf(n, c) === 'out') continue;
        // (the power that came with it already drives it, or set it off)
        if (fromPower && (n.usesPower || this.firedByPower(n))) continue;
        if (wave.heard.has(n) || this.jammed.has(n)) continue;
        wave.heard.add(n);
        const d = n as Entity & WiredDevice;
        if (d.onPulse) d.onPulse(c);
        else n.activate();
      }
    } finally {
      if (first) this.wave = null;
    }
  }

  /**
   * Whether power reaching `e` sets it off once, as a pulse would: something that
   * can be activated (a bomb, a gun, a flask) but doesn't run on power, and isn't
   * part of the wiring itself (batteries, buttons, switches, sensors, timers, gates).
   */
  private firedByPower(e: Entity): boolean {
    const d = e as Entity & WiredDevice;
    return e.activatable && !e.usesPower && !d.onPulse && !d.isPowerSource && !d.conducts && !d.powersAlone && !d.wireRole;
  }

  /** Notes the newest thing in the scene now (see `settled`). */
  private settle(): void {
    const list = this.game.entities;
    if (list.length) this.settled = list[list.length - 1].id;
  }

  /**
   * Flood-fills power from active sources through wires. A circuit with no power
   * source at all is powered by its switches that are on, so a lever wired
   * straight to thrusters (or to a gate's or a timer's input) works them. Power
   * reaching something that doesn't run on it but can be activated sets it off
   * once (C4 wired to a battery, or to a lever flipped on), as a pulse would.
   *
   * Power through a reversing switch set to reverse comes out turned round
   * (see flips()), and what it reaches is `reversed`. It spreads a wire at a time
   * from every source at once, so each thing gets it the way it comes from the
   * nearest (forward, if as near both ways): the far side of a reversing switch
   * is reversed, its battery's side isn't.
   */
  recomputePower(): void {
    const next = new Set<Entity>();
    const queue: Entity[] = [];
    const alone: Entity[] = [];
    for (const e of this.game.entities) {
      const src = e as Entity & WiredDevice;
      if (this.jammed.has(e)) continue;
      if (src.isPowerSource?.()) {
        next.add(e);
        queue.push(e);
      } else if (src.powersAlone?.()) alone.push(e);
    }
    if (alone.length) {
      // each one's circuit: everything wired to it through plain wiring and the
      // things on it, not through a gate or a timer (its input and its output
      // are on two circuits)
      const seen = new Set<Entity>();
      for (const s of alone) {
        if (seen.has(s)) continue;
        const circuit: Entity[] = [s];
        seen.add(s);
        let sourced = false;
        for (let i = 0; i < circuit.length; i++) {
          for (const { c, n } of this.wiresOf(circuit[i])) {
            const r = this.roleOf(n, c);
            // a battery on it (even switched off: it's the battery's circuit), or an
            // output feeding it (a gate's, a timer's, a sensor's), is its power; an
            // input only listens
            if (r === 'out' || (r === 'both' && (n as Entity & WiredDevice).isPowerSource)) sourced = true;
            if (r !== 'both' || seen.has(n)) continue;
            seen.add(n);
            circuit.push(n);
          }
        }
        if (sourced) continue;
        for (const e of circuit) {
          if (!(e as Entity & WiredDevice).powersAlone?.() || next.has(e)) continue;
          next.add(e);
          queue.push(e);
        }
      }
    }
    const live = new Set<Connection>();
    // what power reaches turned round, and the wires it runs along either way
    const back = new Set<Entity>();
    const backWires = new Set<Connection>();
    const fwdWires = new Set<Connection>();
    let wave = queue;
    while (wave.length) {
      const following: Entity[] = [];
      const fresh = new Set<Entity>();
      for (const e of wave) {
        const d = e as Entity & WiredDevice;
        if (d.conducts && !d.conducts() && !d.isPowerSource?.()) continue;
        const rev = back.has(e) !== !!d.flips?.();
        for (const { c, n } of this.wiresOf(e)) {
          if (this.roleOf(e, c) === 'in') continue;
          const rn = this.roleOf(n, c);
          if (rn === 'out' || this.jammed.has(n)) continue;
          live.add(c);
          (rev ? backWires : fwdWires).add(c);
          if (rn === 'in') continue;
          if (next.has(n)) {
            // (reached forward in the same wave as backward: forward it is)
            if (!rev && fresh.has(n)) back.delete(n);
            continue;
          }
          next.add(n);
          fresh.add(n);
          if (rev) back.add(n);
          following.push(n);
        }
      }
      wave = following;
    }
    this.liveWires = live;
    for (const c of fwdWires) backWires.delete(c);
    this.backWires = backWires;
    // (a guest's game only shows the host's: what goes off, goes off there)
    const setOff = !this.quiet && !this.game.net?.guest;
    const reached: Entity[] = [];
    for (const e of this.powered) {
      if (next.has(e) || e.destroyed) continue;
      e.reversed = false;
      e.setPowered(false);
    }
    for (const e of next) {
      // (before it hears of the power, so it starts the right way)
      e.reversed = back.has(e);
      if (this.powered.has(e)) continue;
      e.setPowered(true);
      if (setOff && e.id <= this.settled && this.firedByPower(e)) reached.push(e);
    }
    this.powered = next;
    // (once the power is all set: going off may change it again)
    for (const e of reached) if (!e.destroyed) e.activate();
  }

  // ---- fuse cords -------------------------------------------------------------

  /**
   * Lights a fuse cord `t` of the way along it (0: at a ... 1: at b): it burns
   * both ways from there. Lit right by an end, it burns away from that end only
   * (and doesn't set off what is there).
   */
  light(c: Connection, t: number): void {
    if (c.kind !== 'fuse' || c.burn || !this.list.includes(c)) return;
    const end = 0.1 / Math.max(0.1, c.rest);
    const at = t < end ? 0 : t > 1 - end ? 1 : t;
    c.burn = { lo: at, hi: at };
  }

  /** Lights the unlit fuse cord passing nearest (x, y), within `r` m (a click with the Fuse tool). Was there one? */
  lightAt(x: number, y: number, r: number): boolean {
    let best: Connection | null = null;
    let bt = 0;
    let bd = r;
    for (const c of this.list) {
      if (c.kind !== 'fuse' || c.burn) continue;
      const d = this.nearestOn(c, x, y);
      if (d < bd) {
        bd = d;
        bt = this.nearT;
        best = c;
      }
    }
    if (best) this.light(best, bt);
    return !!best;
  }

  /** Lights the fuse cords passing within `r` m of (x, y) (a blast, a flame), where they come nearest it. */
  igniteNear(x: number, y: number, r: number): void {
    for (const c of this.list) {
      if (c.kind === 'fuse' && !c.burn && this.nearestOn(c, x, y) <= r) this.light(c, this.nearT);
    }
  }

  /**
   * Something is blowing up: the fuse cords tied to it are lit at its end, which
   * is left lying where it was, so they outlast it and burn on to whatever is at
   * their other end (a chain of bombs goes off one after another).
   */
  lightFrom(e: Entity): void {
    for (const c of this.connectionsOf(e)) {
      if (c.kind !== 'fuse') continue;
      const onA = c.a.entity === e;
      // (with nothing else tied to it, there's nothing for it to burn down to)
      if (onA && (!c.b || c.b.entity === e)) {
        this.remove(c);
        continue;
      }
      if (!c.burn) this.light(c, onA ? 0 : 1);
      this.loosen(c, onA);
    }
  }

  /** Unties one end of a fuse cord (a's, or b's), leaving it lying where it is. */
  private loosen(c: Connection, endA: boolean): void {
    if (c.joint?.isValid()) this.game.physics.world.removeImpulseJoint(c.joint, true);
    this.stirEnds(c);
    c.joint = null;
    c.breakAt = Infinity;
    const free = endA ? this.anchorRender(c.a, c.la, 1) : this.anchorRender(c.b, c.lb, 1);
    if (endA) {
      // a connection's first end is always on something: the cord turns round
      c.a = c.b!;
      c.la = c.lb;
      if (c.burn) c.burn = { lo: 1 - c.burn.hi, hi: 1 - c.burn.lo };
    }
    c.b = null;
    c.lb = free;
  }

  /**
   * A fuse cord made again as loosen() left it (a copy, an undo, a save): lying
   * loose at its free end, not tied to the background there as a cord laid
   * from something to the background is.
   */
  untie(c: Connection): void {
    if (c.joint?.isValid()) this.game.physics.world.removeImpulseJoint(c.joint, true);
    c.joint = null;
    c.breakAt = Infinity;
  }

  /** An unlit fuse cord catches from something burning that it's tied to or (when `look`ing) that touches it. */
  private catchFire(c: Connection, look: boolean): void {
    if (c.a.burning > 0.2) this.light(c, 0);
    else if (c.b && c.b.burning > 0.2) this.light(c, 1);
    else if (look) {
      const n = Math.min(16, Math.ceil(c.rest / 0.4));
      for (let k = 1; k < n; k++) {
        const w = this.cordPoint(c, k / n);
        if (this.game.fire.near(w.x, w.y, 0.4)) {
          this.light(c, k / n);
          return;
        }
      }
    }
  }

  /**
   * A lit fuse cord burns on, sparking and smoking where it burns; what it burns
   * down to goes off (or catches fire). Returns whether it has burnt away.
   */
  private burnFuse(c: Connection, dt: number): boolean {
    const b = c.burn!;
    const k = (FUSE_SPEED * dt) / Math.max(0.05, c.rest);
    if (b.lo > 0) {
      b.lo = Math.max(0, b.lo - k);
      if (b.lo === 0) this.reached(c.a, c.la);
    }
    if (b.hi < 1) {
      b.hi = Math.min(1, b.hi + k);
      if (b.hi === 1 && c.b) this.reached(c.b, c.lb);
    }
    if (b.lo === 0 && b.hi === 1) {
      this.remove(c);
      return true;
    }
    let x = 0;
    for (const t of [b.lo, b.hi]) {
      if (t <= 0 || t >= 1) continue;
      const w = this.cordPoint(c, t);
      x = w.x;
      this.sparkle(w.x, w.y);
    }
    this.game.sound.hold(c, 'explosion/fuse_loop', 0.3, x);
    return false;
  }

  /** A fuse cord has burnt down to a part: a bomb goes off, anything else catches fire. */
  private reached(p: Part, l: V2): void {
    if (p.destroyed || p.entity.destroyed) return;
    const w = this.anchorRender(p, l, 1);
    this.game.particles.sparks(w.x, w.y, 0, 1, 8, 2.5);
    const e = p.entity as Entity & FuseTarget;
    if (e.onFuse) e.onFuse();
    else this.game.fire.ignite(p, 0.5);
  }

  /** Where a fuse cord is burning: sparks, a wisp of smoke, a fleck of ash. */
  private sparkle(x: number, y: number): void {
    const P = this.game.particles;
    if (Math.random() < 0.6) {
      P.emit(PK.Spark, x, y, {
        vx: (Math.random() - 0.5) * 2.5, vy: Math.random() * 2.5, life: 0.1 + Math.random() * 0.2,
        color: 0xfff1b0, color1: 0xff7a1a, alpha1: 0.3, gravity: 0.6, drag: 2,
      });
    }
    if (Math.random() < 0.08) P.smoke(x, y, 1, 0.06);
    if (Math.random() < 0.04) P.debris(x, y, 0, -1, 1, 0x2a2622, 0.4);
  }

  /** How far a slack rope or fuse cord sags in its middle. */
  private sagOf(c: Connection, pa: V2, pb: V2): number {
    const d = Math.hypot(pb.x - pa.x, pb.y - pa.y);
    return d < c.rest ? Math.sqrt(Math.max(0, c.rest * c.rest - d * d)) * 0.5 : 0;
  }

  /** The point `t` of the way along a cord as it's drawn (sagging when slack). */
  private cordPoint(c: Connection, t: number): V2 {
    const pa = this.anchorRender(c.a, c.la, 1);
    const pb = this.anchorRender(c.b, c.lb, 1);
    const sag = this.sagOf(c, pa, pb);
    return { x: pa.x + (pb.x - pa.x) * t, y: pa.y + (pb.y - pa.y) * t - sag * 4 * t * (1 - t) };
  }

  /** How near a cord as drawn comes to (x, y) (sampled along it); where, is left in nearT. */
  private nearestOn(c: Connection, x: number, y: number): number {
    const pa = this.anchorRender(c.a, c.la, 1);
    const pb = this.anchorRender(c.b, c.lb, 1);
    const sag = this.sagOf(c, pa, pb);
    const n = Math.max(4, Math.min(24, Math.ceil(c.rest / 0.25)));
    let bd = Infinity;
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const d = Math.hypot(pa.x + (pb.x - pa.x) * t - x, pa.y + (pb.y - pa.y) * t - sag * 4 * t * (1 - t) - y);
      if (d < bd) {
        bd = d;
        this.nearT = t;
      }
    }
    return bd;
  }

  // ---- simulation -----------------------------------------------------------

  postStep(dt: number): void {
    this.settle();
    // now and then, fires touching unlit fuse cords light them
    this.fireT -= dt;
    const fireCheck = this.fireT <= 0 && this.game.fire.count > 0;
    if (this.fireT <= 0) this.fireT = 0.25;
    // (over a copy: a fuse reaching its bomb can take other cords away mid-loop, which shifts the list)
    const list = this.list.slice();
    const removals = this.removals;
    for (let i = list.length - 1; i >= 0; i--) {
      const c = list[i];
      // (looked for only once something has been taken away: a big contraption has hundreds)
      if (this.removals !== removals && !this.list.includes(c)) continue;
      if (c.a.destroyed || (c.b && c.b.destroyed)) {
        this.remove(c);
        continue;
      }
      if (c.kind === 'fuse') {
        if (!c.burn) this.catchFire(c, fireCheck);
        if (c.burn && this.burnFuse(c, dt)) continue;
      }
      if (c.breakAt === Infinity || !c.joint) continue;
      const pa = this.anchorWorld(c, 'a');
      const pb = this.anchorWorld(c, 'b');
      const d = Math.hypot(pa.x - pb.x, pa.y - pb.y);
      const over = c.kind === 'rope' || c.kind === 'fuse' ? d - c.rest : d;
      if (over > c.breakAt) {
        this.game.sound.snap(pa.x);
        this.remove(c);
      }
    }
  }

  frame(alpha: number): void {
    // (also while time is paused, when things are still placed and wired)
    this.settle();
    const L = this.lines;
    L.begin();
    for (const c of this.list) {
      if (c.kind === 'wire' && !this.showWires) continue;
      const glow = this.highlights.get(c);
      if (c.opts?.hidden && !this.showHidden && glow === undefined) continue;
      const pa = this.anchorRender(c.a, c.la, alpha);
      const pb = this.anchorRender(c.b, c.lb, alpha);
      const R = RAMPS[c.kind];
      if (glow !== undefined) this.halo(c, pa, pb, alpha, glow);
      switch (c.kind) {
        case 'rope': {
          const d = Math.hypot(pb.x - pa.x, pb.y - pa.y);
          const sag = d < c.rest ? Math.sqrt(Math.max(0, c.rest * c.rest - d * d)) * 0.5 : 0;
          this.curve(pa, pb, sag, PX * 2.5, R[0]);
          this.curve(pa, pb, sag, PX * 1.5, R[2]);
          this.knot(pa, PX * 3, R);
          this.knot(pb, PX * 3, R);
          break;
        }
        case 'wire': {
          // orange where power actually runs (not from a switch that's off, or into an output),
          // blue where it runs turned round (past a reversing switch set to reverse)
          const d = Math.hypot(pb.x - pa.x, pb.y - pa.y);
          const lit = this.liveWires.has(c);
          const W = lit ? (this.backWires.has(c) ? REVERSED : ORANGE) : R;
          this.curve(pa, pb, d * 0.08, PX * 2, W[0]);
          this.curve(pa, pb, d * 0.08, PX, W[lit ? 3 : 2]);
          this.knot(pa, PX * 2.5, GUNMETAL);
          this.knot(pb, PX * 2.5, GUNMETAL);
          break;
        }
        case 'fuse': {
          // the burnt stretch is gone, with a flame at each end of it
          const sag = this.sagOf(c, pa, pb);
          const lo = c.burn ? c.burn.lo : 1;
          const hi = c.burn ? c.burn.hi : 1;
          for (const [w, col] of [[PX * 2, R[0]], [PX, R[2]]] as const) {
            this.curve(pa, pb, sag, w, col, 0, lo);
            this.curve(pa, pb, sag, w, col, hi, 1);
          }
          if (lo > 0) this.knot(pa, PX * 2, R);
          if (!c.burn || hi < 1) this.knot(pb, PX * 2, R);
          if (!c.burn) break;
          for (const t of [lo, hi]) {
            if (t <= 0 || t >= 1) continue;
            const x = pa.x + (pb.x - pa.x) * t;
            const y = pa.y + (pb.y - pa.y) * t - sag * 4 * t * (1 - t);
            L.quad(x, y, PX * (2.5 + Math.random()), 0xff8a2a);
            L.quad(x, y, PX * 1.5, 0xfff4c4);
          }
          break;
        }
        case 'spring': {
          const coils = 12;
          const dx = pb.x - pa.x;
          const dy = pb.y - pa.y;
          const d = Math.hypot(dx, dy) || 1;
          const nx = -dy / d;
          const ny = dx / d;
          for (const [w, col] of [[PX * 2, R[0]], [PX, R[2]]] as const) {
            let px = pa.x;
            let py = pa.y;
            for (let k = 1; k <= coils; k++) {
              const t = k / coils;
              const off = k === coils ? 0 : (k % 2 ? 1 : -1) * PX * 3;
              const x = pa.x + dx * t + nx * off;
              const y = pa.y + dy * t + ny * off;
              L.seg(px, py, x, y, w, col);
              px = x;
              py = y;
            }
          }
          this.knot(pa, PX * 3, STEEL);
          this.knot(pb, PX * 3, STEEL);
          break;
        }
        case 'weld': {
          // a rod out to where it was dragged, as People Playground draws its fixed connectors
          const pe = c.end ? this.anchorRender(c.b, c.end, alpha) : null;
          if (pe) {
            L.seg(pa.x, pa.y, pe.x, pe.y, PX * 2.5, STEEL[0]);
            L.seg(pa.x, pa.y, pe.x, pe.y, PX * 1.5, STEEL[2]);
            L.quad(pe.x, pe.y, PX * 3, STEEL[0]);
            L.quad(pe.x, pe.y, PX * 2, STEEL[2]);
          }
          L.quad(pa.x, pa.y, PX * 4, STEEL[0]);
          L.quad(pa.x, pa.y, PX * 3, STEEL[2]);
          L.quad(pa.x, pa.y, PX * 1.5, R[4]);
          break;
        }
        case 'hinge':
        case 'pin':
          L.quad(pa.x, pa.y, PX * 5, R[0]);
          L.quad(pa.x, pa.y, PX * 4, R[2]);
          L.quad(pa.x - PX * 0.5, pa.y + PX * 0.5, PX * 2, R[3]);
          L.quad(pa.x, pa.y, PX * 1.5, R[0]);
          break;
      }
    }
    L.end();
  }

  /** A small outlined square where a rope/wire/spring meets an object. */
  private knot(p: V2, size: number, r: Ramp): void {
    this.lines.quad(p.x, p.y, size + PX, r[0]);
    this.lines.quad(p.x, p.y, size, r[1]);
    this.lines.quad(p.x - PX * 0.5, p.y + PX * 0.5, size * 0.4, r[3]);
  }

  /** A sagging line from a to b (or the stretch of it from t0 to t1 of the way along). */
  private curve(a: V2, b: V2, sag: number, w: number, col: number, t0 = 0, t1 = 1): void {
    if (t1 <= t0) return;
    const segs = sag > 0.01 ? Math.max(1, Math.ceil(14 * (t1 - t0))) : 1;
    let px = a.x + (b.x - a.x) * t0;
    let py = a.y + (b.y - a.y) * t0 - sag * 4 * t0 * (1 - t0);
    for (let k = 1; k <= segs; k++) {
      const t = t0 + ((t1 - t0) * k) / segs;
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t - sag * 4 * t * (1 - t);
      this.lines.seg(px, py, x, y, w, col);
      px = x;
      py = y;
    }
  }
}
