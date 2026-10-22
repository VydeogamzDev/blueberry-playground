import * as THREE from 'three';
import { RAPIER } from '../engine/Physics';
import { PX } from '../engine/constants';
import { lerp, type V2 } from '../engine/math';
import type { Game } from '../world/Game';
import type { Part } from '../world/Part';
import type { Entity } from '../world/Entity';
import { KHAKI, RED, ORANGE, STEEL, STEEL_LT, BRASS, GUNMETAL, type Ramp } from '../art/palette';

export type ConnKind = 'rope' | 'weld' | 'spring' | 'hinge' | 'pin' | 'wire';

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
  joint: RAPIER.ImpulseJoint | null;
  rest: number;
  /** Separation (m) at which the connection snaps. */
  breakAt: number;
  /** Extra part pairs whose contacts this connection disabled. */
  ignored?: [Part, Part][];
}

/** Batches thick pixel-art line segments into one mesh. */
export class LineBatch {
  private max: number;
  private n = 0;
  private pos: Float32Array;
  private col: Float32Array;
  private geo = new THREE.BufferGeometry();
  readonly mesh: THREE.Mesh;

  constructor(max: number, z: number) {
    this.max = max;
    this.pos = new Float32Array(max * 4 * 3);
    this.col = new Float32Array(max * 4 * 3);
    const idx = new Uint32Array(max * 6);
    for (let i = 0; i < max; i++) {
      idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
    }
    this.geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.mesh = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    this.mesh.frustumCulled = false;
    this.mesh.position.z = z;
  }

  begin(): void {
    this.n = 0;
  }

  seg(x0: number, y0: number, x1: number, y1: number, w: number, color: number): void {
    if (this.n >= this.max) return;
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

/** Connections use the same material ramps as the sprites (0 = outline ... 4 = highlight). */
const RAMPS: Record<ConnKind, Ramp> = {
  rope: KHAKI,
  weld: STEEL_LT,
  spring: STEEL_LT,
  hinge: BRASS,
  pin: BRASS,
  wire: RED,
};

export class Connections {
  private game: Game;
  readonly list: Connection[] = [];
  private nextId = 1;
  private lines = new LineBatch(6000, 44);
  /** Preview line drawn by the connection tool. */
  preview: { x0: number; y0: number; x1: number; y1: number; kind: ConnKind } | null = null;
  showWires = true;
  private powered = new Set<Entity>();
  /** Wires that bring power into a device's input side. */
  private liveInputs = new Set<Connection>();

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
   * (or on the background if b is null).
   */
  create(kind: ConnKind, a: Part, wa: V2, b: Part | null, wb: V2, restOverride?: number): Connection | null {
    if (b === a) return null;
    const world = this.game.physics.world;
    const la = a.worldToLocal(wa.x, wa.y);
    const lb = b ? b.worldToLocal(wb.x, wb.y) : { x: wb.x, y: wb.y };
    const bodyB = b ? b.body : this.game.env.body;
    const rest = restOverride ?? Math.hypot(wb.x - wa.x, wb.y - wa.y);
    let joint: RAPIER.ImpulseJoint | null = null;
    let breakAt = Infinity;
    const mA = a.frozen ? 50 : a.mass;
    const mB = b && !b.frozen ? b.mass : Infinity;
    const mEff = mB === Infinity ? mA : (mA * mB) / (mA + mB);
    switch (kind) {
      case 'rope':
        joint = world.createImpulseJoint(RAPIER.JointData.rope(Math.max(0.05, rest), la, lb), a.body, bodyB, true);
        breakAt = Math.max(0.6, rest * 0.6);
        break;
      case 'spring': {
        const k = Math.max(40, mEff * 70);
        const damp = 2 * Math.sqrt(k * mEff) * 0.12;
        joint = world.createImpulseJoint(RAPIER.JointData.spring(Math.max(0.02, rest), k, damp, la, lb), a.body, bodyB, true);
        joint.setContactsEnabled(true);
        breakAt = Infinity;
        break;
      }
      case 'weld': {
        // keep the current relative orientation
        const lbw = b ? b.worldToLocal(wa.x, wa.y) : { x: wa.x, y: wa.y };
        const rel = a.body.rotation() - (b ? b.body.rotation() : 0);
        joint = world.createImpulseJoint(RAPIER.JointData.fixed(la, 0, lbw, rel), a.body, bodyB, true);
        joint.setContactsEnabled(false);
        lb.x = lbw.x;
        lb.y = lbw.y;
        breakAt = 0.6;
        break;
      }
      case 'hinge':
      case 'pin': {
        const lbw = b ? b.worldToLocal(wa.x, wa.y) : { x: wa.x, y: wa.y };
        joint = world.createImpulseJoint(RAPIER.JointData.revolute(la, lbw), a.body, bodyB, true);
        joint.setContactsEnabled(false);
        lb.x = lbw.x;
        lb.y = lbw.y;
        breakAt = 0.6;
        break;
      }
      case 'wire':
        break;
    }
    let ignored: [Part, Part][] | undefined;
    if (joint && b && kind !== 'spring' && kind !== 'rope') {
      // stop the two parts from fighting each other through contacts
      (a.noCollide ??= new Set()).add(b);
      (b.noCollide ??= new Set()).add(a);
      // things fixed to a rotor must swing past the rest of their machine (motor housings)
      ignored = [];
      for (const [p, q] of [[a, b], [b, a]] as [Part, Part][]) {
        if (!q.entity.attachIgnoresBody) continue;
        for (const r of q.entity.parts) {
          if (r === q || r === p || r.destroyed || p.noCollide?.has(r)) continue;
          (p.noCollide ??= new Set()).add(r);
          (r.noCollide ??= new Set()).add(p);
          ignored.push([p, r]);
        }
      }
    }
    const c: Connection = { id: this.nextId++, kind, a, la, b, lb, joint, rest, breakAt, ignored };
    this.list.push(c);
    if (kind === 'wire') this.recomputePower();
    return c;
  }

  remove(c: Connection): void {
    const i = this.list.indexOf(c);
    if (i < 0) return;
    this.list.splice(i, 1);
    if (c.joint && c.joint.isValid()) this.game.physics.world.removeImpulseJoint(c.joint, true);
    if (c.b && c.kind !== 'spring' && c.kind !== 'rope' && c.kind !== 'wire') {
      // only re-enable contacts if no other rigid link still joins them
      const still = this.list.some((o) => (o.a === c.a && o.b === c.b) || (o.a === c.b && o.b === c.a));
      if (!still) {
        c.a.noCollide?.delete(c.b);
        c.b.noCollide?.delete(c.a);
      }
    }
    for (const [p, q] of c.ignored ?? []) {
      p.noCollide?.delete(q);
      q.noCollide?.delete(p);
    }
    if (c.kind === 'wire') this.recomputePower();
  }

  connectionsOf(e: Entity): Connection[] {
    return this.list.filter((c) => c.a.entity === e || (c.b && c.b.entity === e));
  }

  removeFor(e: Entity): void {
    for (const c of this.connectionsOf(e)) this.remove(c);
  }

  removeForPart(p: Part): void {
    for (const c of this.list.filter((c) => c.a === p || c.b === p)) this.remove(c);
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

  /** Whether this input wire currently carries power into its device. */
  inputLive(c: Connection): boolean {
    return this.liveInputs.has(c);
  }

  wiredNeighbours(e: Entity): Entity[] {
    const out: Entity[] = [];
    for (const c of this.list) {
      if (c.kind !== 'wire' || !c.b) continue;
      if (c.a.entity === e && c.b.entity !== e) out.push(c.b.entity);
      else if (c.b.entity === e && c.a.entity !== e) out.push(c.a.entity);
    }
    return out;
  }

  /**
   * Sends a one-shot activation pulse to everything wired to `from` (respecting
   * input/output sides: a gate only sends from its output and only hears on its inputs).
   */
  pulse(from: Entity, fromPower = false): void {
    for (const { c, n } of this.wiresOf(from)) {
      if (this.roleOf(from, c) === 'in' || this.roleOf(n, c) === 'out') continue;
      if (fromPower && n.usesPower) continue;
      const d = n as Entity & WiredDevice;
      if (d.onPulse) d.onPulse(c);
      else n.activate();
    }
  }

  /** Flood-fills power from active sources through wires. */
  recomputePower(): void {
    const next = new Set<Entity>();
    const queue: Entity[] = [];
    for (const e of this.game.entities) {
      const src = e as Entity & { isPowerSource?: () => boolean };
      if (src.isPowerSource?.()) {
        next.add(e);
        queue.push(e);
      }
    }
    const inputs = new Set<Connection>();
    while (queue.length) {
      const e = queue.pop()!;
      const d = e as Entity & WiredDevice;
      if (d.conducts && !d.conducts() && !d.isPowerSource?.()) continue;
      for (const { c, n } of this.wiresOf(e)) {
        if (this.roleOf(e, c) === 'in') continue;
        const rn = this.roleOf(n, c);
        if (rn === 'in') inputs.add(c);
        if (rn !== 'both') continue;
        if (!next.has(n)) {
          next.add(n);
          queue.push(n);
        }
      }
    }
    this.liveInputs = inputs;
    for (const e of this.powered) if (!next.has(e) && !e.destroyed) e.setPowered(false);
    for (const e of next) if (!this.powered.has(e)) e.setPowered(true);
    this.powered = next;
  }

  // ---- simulation -----------------------------------------------------------

  preStep(_dt: number): void {}

  postStep(_dt: number): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const c = this.list[i];
      if (c.a.destroyed || (c.b && c.b.destroyed)) {
        this.remove(c);
        continue;
      }
      if (c.breakAt === Infinity || !c.joint) continue;
      const pa = this.anchorWorld(c, 'a');
      const pb = this.anchorWorld(c, 'b');
      const d = Math.hypot(pa.x - pb.x, pa.y - pb.y);
      const over = c.kind === 'rope' ? d - c.rest : d;
      if (over > c.breakAt) {
        this.game.sound.snap(pa.x);
        this.remove(c);
      }
    }
  }

  frame(alpha: number): void {
    const L = this.lines;
    L.begin();
    for (const c of this.list) {
      if (c.kind === 'wire' && !this.showWires) continue;
      const pa = this.anchorRender(c.a, c.la, alpha);
      const pb = this.anchorRender(c.b, c.lb, alpha);
      const R = RAMPS[c.kind];
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
          const d = Math.hypot(pb.x - pa.x, pb.y - pa.y);
          const W = this.powered.has(c.a.entity) ? ORANGE : R;
          this.curve(pa, pb, d * 0.08, PX * 2, W[0]);
          this.curve(pa, pb, d * 0.08, PX, W[this.powered.has(c.a.entity) ? 3 : 2]);
          this.knot(pa, PX * 2.5, GUNMETAL);
          this.knot(pb, PX * 2.5, GUNMETAL);
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
        case 'weld':
          L.quad(pa.x, pa.y, PX * 4, STEEL[0]);
          L.quad(pa.x, pa.y, PX * 3, STEEL[2]);
          L.quad(pa.x, pa.y, PX * 1.5, R[4]);
          break;
        case 'hinge':
        case 'pin':
          L.quad(pa.x, pa.y, PX * 5, R[0]);
          L.quad(pa.x, pa.y, PX * 4, R[2]);
          L.quad(pa.x - PX * 0.5, pa.y + PX * 0.5, PX * 2, R[3]);
          L.quad(pa.x, pa.y, PX * 1.5, R[0]);
          break;
      }
    }
    if (this.preview) {
      const p = this.preview;
      const col = RAMPS[p.kind][3];
      const dx = p.x1 - p.x0;
      const dy = p.y1 - p.y0;
      const d = Math.hypot(dx, dy);
      const n = Math.max(1, Math.floor(d / (PX * 6)));
      for (let k = 0; k < n; k += 2) {
        const t0 = k / n;
        const t1 = Math.min(1, (k + 1) / n);
        L.seg(p.x0 + dx * t0, p.y0 + dy * t0, p.x0 + dx * t1, p.y0 + dy * t1, PX, col);
      }
      L.quad(p.x0, p.y0, PX * 3, col);
    }
    L.end();
  }

  /** A small outlined square where a rope/wire/spring meets an object. */
  private knot(p: V2, size: number, r: Ramp): void {
    this.lines.quad(p.x, p.y, size + PX, r[0]);
    this.lines.quad(p.x, p.y, size, r[1]);
    this.lines.quad(p.x - PX * 0.5, p.y + PX * 0.5, size * 0.4, r[3]);
  }

  private curve(a: V2, b: V2, sag: number, w: number, col: number): void {
    const segs = sag > 0.01 ? 14 : 1;
    let px = a.x;
    let py = a.y;
    for (let k = 1; k <= segs; k++) {
      const t = k / segs;
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t - sag * 4 * t * (1 - t);
      this.lines.seg(px, py, x, y, w, col);
      px = x;
      py = y;
    }
  }
}
