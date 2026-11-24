import * as THREE from 'three';
import { RAPIER } from '../engine/Physics';
import { GROUP, groups } from '../engine/constants';
import { type V2 } from '../engine/math';
import { Entity } from '../world/Entity';
import { LineBatch } from '../systems/Connections';
import { isLiving } from '../systems/Fighting';
import { Prop, type PropConfig } from './Prop';
import { Car } from './Car';
import { GuidedLauncher, Missile, type MissileGuidance } from './Missiles';
import { RADAR } from '../art/missiles';
import type { PixelArt } from '../art/PixelArt';
import type { Game } from '../world/Game';
import type { ContextAction, ItemDef, SpawnOptions } from '../world/types';

// The radar and the radar-guided missile launcher (0.5.0). Hold F on the selected radar:
// green brackets flash round the cursor while it looks, the nearest vehicle or aircraft
// in them is picked out, and held there a second it locks on; let go and the lock stays,
// a green box on the target with its range, height and speed beside it. A radar-guided
// launcher linked to it (wired to it, or built into the same thing) fires missiles that
// fly to wherever the radar's lock is.

/** How far it sees (m), how long the gate must stay on something to lock on (s), and how long a lock lasts out of its sight (s). */
const RANGE = 6000;
const LOCK_TIME = 1;
const LOST_AFTER = 2.5;
/** How often (s) it looks again at what it has locked on. */
const LOOK_EVERY = 0.15;
/** The brackets' half-size and their arms' length (screen px), as the Spike's. */
const BRACKET = 56;
const ARM = 15;
/** How fast its antenna turns while it searches (frames a second), and the green it draws in. */
const SWEEP = 10;
const GREEN = 0x5dff6a;
const DIM = 0x2c9a3a;
const SHADOW = 0x081008;
/** What hides a target from it: the ground and anything else fixed. */
const GROUND = groups(GROUP.DEBRIS, GROUP.STATIC);

/** Seen by a radar: rank 0 a vehicle or an aircraft, 1 a person or an animal, 2 anything else; how far from the brackets' middle (m). */
interface Blip {
  entity: Entity;
  rank: number;
  d: number;
}

/**
 * A search and tracking radar on its shelter. Selected, holding F switches it to
 * acquire: green corner brackets flash round the cursor, and the vehicle (or aircraft,
 * or failing those anything else) nearest their middle is picked out, a smaller box
 * flashing round it; kept there LOCK_TIME, in range and in its sight (the ground hides
 * what's behind it), it locks on. Let go of F with a lock and the lock holds: it tracks
 * the target wherever it goes (a green box round it, and its range, height and speed
 * beside that), until the target is gone, out of range, or out of its sight longer than
 * LOST_AFTER. Let go before it locks and nothing changes. Radar-guided launchers linked
 * to it guide their missiles by its lock (see RadarLauncher).
 */
export class Radar extends Prop implements MissileGuidance {
  readonly cursorAimed = true;
  readonly radar = true;
  /** Who holds F on it (their player number: see Game.actor), and who locked what it's locked on (their screen shows it). */
  holder = 0;
  owner = 0;
  /** What its gate is on as it acquires, and for how long (s). */
  candidate: Entity | null = null;
  locking = 0;
  /** What it's locked on, where that was when last seen, and for how long it's been out of sight (s). */
  lock: Entity | null = null;
  private lastAt: V2 | null = null;
  lostT = 0;
  private lookT = 0;
  private sweep = 0;
  private shown = -1;
  private beepT = 0;
  private box: RAPIER.Cuboid | null = null;
  private readonly ray = new RAPIER.Ray({ x: 0, y: 0 }, { x: 1, y: 0 });
  private readonly art: (frame: number) => PixelArt;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, art: (frame: number) => PixelArt, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, x, y, opts);
    this.art = art;
    this.activatable = true;
  }

  /** The floating origin moved (see world/Origin). */
  shifted(dx: number, dy: number): void {
    super.shifted(dx, dy);
    if (this.lastAt) this.lastAt = { x: this.lastAt.x + dx, y: this.lastAt.y + dy };
  }

  /** (F only works it held down: see setActiveHeld().) */
  activate(): void {}

  setActiveHeld(on: boolean): void {
    const was = this.activeHeld;
    super.setActiveHeld(on);
    if (on === was) return;
    if (on) {
      // (a new search: the old lock goes)
      this.holder = this.game.actor;
      this.lock = this.candidate = null;
      this.locking = 0;
      overlay(this.game).on.add(this);
      this.game.sound.play('machine/switch', { gain: 0.3, rate: 1.4, x: this.main.x });
      return;
    }
    this.holder = 0;
    if (!this.lock) {
      this.candidate = null;
      this.locking = 0;
    }
  }

  // ---- what it guides by (see MissileGuidance)

  lockPoint(): V2 | null {
    if (!this.lock || this.destroyed) return null;
    return this.lastAt;
  }

  lockEntity(): Entity | null {
    return this.lock && !this.lock.destroyed && !this.destroyed ? this.lock : null;
  }

  /** Where its antenna is (world). */
  antenna(): V2 {
    return this.main.pixelToWorld(RADAR.mast[0], 10);
  }

  preStep(dt: number): void {
    super.preStep(dt);
    this.beepT -= dt;
    if (!this.works && (this.lock || this.candidate)) this.drop(false);
    if (this.works && this.activeHeld && !this.lock) this.acquire(dt);
    if (this.lock) this.track(dt);
    // the antenna turns while it searches, and faces what it's locked on
    if (this.lock) this.sweep = 0;
    else if (this.works) this.sweep = (this.sweep + SWEEP * dt) % RADAR.frames;
    const f = Math.floor(this.sweep);
    if (f !== this.shown && !this.destroyed) {
      this.shown = f;
      this.main.setArt(this.art(f));
    }
  }

  /** Lets go of its lock (and what it was locking on), with the lost-lock tone. */
  drop(tone = true): void {
    if (tone && this.lock) this.game.sound.play('medical/ecg_beep', { gain: 0.25, x: this.main.x, rate: 0.7 });
    this.lock = this.candidate = null;
    this.locking = 0;
    this.lostT = 0;
    this.lastAt = null;
  }

  /** Acquiring: the gate goes on the best blip in the brackets round the holder's cursor, and locks on once held there LOCK_TIME, seen. */
  private acquire(dt: number): void {
    const c = this.game.cursorOf(this.holder);
    if (!c) {
      this.candidate = null;
      this.locking = 0;
      return;
    }
    const zoom = c.zoom || this.game.renderer.zoom;
    const best = this.scan(c, BRACKET / zoom)[0]?.entity ?? null;
    if (best !== this.candidate) {
      this.candidate = best;
      this.locking = 0;
      return;
    }
    if (!best || !this.sees(best)) {
      this.locking = Math.max(0, this.locking - dt);
      return;
    }
    this.locking += dt;
    if (this.beepT <= 0) {
      this.beepT = 0.18;
      this.game.sound.play('medical/ecg_beep', { gain: 0.15, x: this.main.x, rate: 1.5, vary: 0 });
    }
    if (this.locking >= LOCK_TIME) {
      this.lock = best;
      this.owner = this.holder;
      this.lastAt = best.center();
      this.lostT = 0;
      this.lookT = LOOK_EVERY;
      overlay(this.game).on.add(this);
      this.game.sound.play('medical/ecg_beep', { gain: 0.3, x: this.main.x, rate: 2.4 });
    }
  }

  /** Tracking what it's locked on: seen, it knows where that is; out of sight too long (or gone, or out of range), the lock drops. */
  private track(dt: number): void {
    const e = this.lock!;
    if (e.destroyed) {
      const next = this.game.successorOf(e);
      if (!next || next === e || next.destroyed) {
        this.drop();
        return;
      }
      this.lock = next;
    }
    if ((this.lookT -= dt) > 0) {
      if (!this.lostT) this.lastAt = this.lock!.center();
      return;
    }
    this.lookT = LOOK_EVERY;
    if (this.sees(this.lock!)) {
      this.lostT = 0;
      this.lastAt = this.lock!.center();
    } else if ((this.lostT += LOOK_EVERY) > LOST_AFTER) this.drop();
  }

  /** In range and in its sight (nothing fixed between its antenna and the middle of `e`)? */
  sees(e: Entity): boolean {
    const a = this.antenna();
    const c = e.center();
    const dx = c.x - a.x;
    const dy = c.y - a.y;
    const d = Math.hypot(dx, dy);
    if (d > RANGE) return false;
    if (d < 0.5) return true;
    const r = this.ray;
    r.origin = a;
    r.dir = { x: dx / d, y: dy / d };
    // (the ground under the target's own middle doesn't count)
    return !this.game.physics.world.castRay(r, d - 0.3, true, undefined, GROUND);
  }

  /** What's in its brackets round `c` (`half` m each way), best first: vehicles and aircraft, then the living, then the rest, each nearest the middle first. */
  private scan(c: V2, half: number): Blip[] {
    const phys = this.game.physics;
    if (this.box?.halfExtents.x !== half) this.box = new RAPIER.Cuboid(half, half);
    const own = new Set(this.game.connections.assemblyOf([this]));
    const near = new Map<Entity, Blip>();
    phys.world.intersectionsWithShape(c, 0, this.box, (col) => {
      const q = phys.partOf(col);
      const e = q?.entity;
      if (!q || !e || q.destroyed || e.destroyed || own.has(e) || col.isSensor() || (e instanceof Missile && e.age < 0.5)) return true;
      const proj = col.projectPoint(c, true);
      if (!proj) return true;
      const d = proj.isInside ? 0 : Math.hypot(proj.point.x - c.x, proj.point.y - c.y);
      const had = near.get(e);
      if (had && had.d <= d) return true;
      const rank = e instanceof Car || e instanceof Missile ? 0 : isLiving(e) ? 1 : 2;
      near.set(e, { entity: e, rank, d });
      return true;
    });
    return [...near.values()].sort((a, b) => a.rank - b.rank || a.d - b.d);
  }

  /** Its lock's readout: what it is, how far (m), how high over the ground (m), how fast (m/s) and its heading (rad). */
  telemetry(): { name: string; range: number; height: number; speed: number; climb: number; heading: number } | null {
    const e = this.lockEntity();
    if (!e || !this.lastAt) return null;
    const a = this.antenna();
    const at = this.lastAt;
    let vx = 0;
    let vy = 0;
    let m = 0;
    for (const p of e.parts) {
      if (p.destroyed) continue;
      const k = p.mass;
      vx += p.vx * k;
      vy += p.vy * k;
      m += k;
    }
    if (m > 0) {
      vx /= m;
      vy /= m;
    }
    const g = this.game.env;
    return {
      name: e.def.name, range: Math.hypot(at.x - a.x, at.y - a.y), height: at.y - g.groundAt(at.x, at.y),
      speed: Math.hypot(vx, vy), climb: vy, heading: Math.atan2(vy, vx),
    };
  }

  /** The box round what it's locked on, or acquiring on (world m: x0, y0, x1, y1). */
  bounds(e: Entity): [number, number, number, number] {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const p of e.parts) {
      if (p.destroyed) continue;
      // (its art's corners, turned as it is: the drawn sprite's own box)
      for (const [cx, cy] of [[0, 0], [p.w, 0], [0, p.h], [p.w, p.h]]) {
        const q = p.pixelToWorld(cx, cy);
        x0 = Math.min(x0, q.x);
        y0 = Math.min(y0, q.y);
        x1 = Math.max(x1, q.x);
        y1 = Math.max(y1, q.y);
      }
    }
    if (!Number.isFinite(x0)) {
      const c = e.center();
      return [c.x - 1, c.y - 1, c.x + 1, c.y + 1];
    }
    return [x0, y0, x1, y1];
  }

  /** The green overlay on its holder's or owner's screen (see Overlay): brackets flashing as it looks, the box on its lock. */
  drawOverlay(lines: LineBatch, me: number): void {
    const g = this.game;
    // (a guest's copy: the lock kept on what it's on as that's shown moving here)
    if (g.net?.guest && this.lock && !this.lock.destroyed && !this.lostT) this.lastAt = this.lock.center();
    const px = 1 / g.renderer.zoom;
    const t = g.time;
    const corners = (x0: number, y0: number, x1: number, y1: number, arm: number, col: number) => {
      for (const [w, c] of [[3.5, SHADOW], [1.6, col]] as const) {
        const wid = w * px;
        for (const [x, sx] of [[x0, 1], [x1, -1]] as const) {
          for (const [y, sy] of [[y0, 1], [y1, -1]] as const) {
            lines.seg(x, y, x + sx * arm, y, wid, c);
            lines.seg(x, y, x, y + sy * arm, wid, c);
          }
        }
      }
    };
    if (this.lock && this.owner === me) {
      const [x0, y0, x1, y1] = this.bounds(this.lock);
      const pad = 6 * px;
      const arm = Math.min(14 * px, (x1 - x0) * 0.4 + pad, (y1 - y0) * 0.4 + pad);
      const col = this.lostT > 0 && Math.floor(t * 4) % 2 ? DIM : GREEN;
      corners(x0 - pad, y0 - pad, x1 + pad, y1 + pad, arm, col);
      const c = this.lastAt ?? this.lock.center();
      lines.seg(c.x - 4 * px, c.y, c.x + 4 * px, c.y, 1.4 * px, col);
      lines.seg(c.x, c.y - 4 * px, c.x, c.y + 4 * px, 1.4 * px, col);
    }
    // (held by them: on a guest's copy, which isn't held, as the host says)
    if (this.holder === me && !this.lock) {
      const c = g.cursor;
      if (!c) return;
      // (the brackets flash while it looks; the box round what it's locking on flashes faster as the lock nears)
      if (Math.floor(t * 5) % 2 === 0) corners(c.x - BRACKET * px, c.y - BRACKET * px, c.x + BRACKET * px, c.y + BRACKET * px, ARM * px, GREEN);
      const e = this.candidate;
      if (e && !e.destroyed) {
        const k = this.locking / LOCK_TIME;
        if (Math.floor(t * (6 + k * 14)) % 2 === 0) {
          const [x0, y0, x1, y1] = this.bounds(e);
          const pad = (6 + 14 * (1 - k)) * px;
          corners(x0 - pad, y0 - pad, x1 + pad, y1 + pad, 8 * px, GREEN);
        }
      }
    }
  }

  contextActions(): ContextAction[] {
    const t = this.telemetry();
    return [
      { label: t ? `Locked: ${t.name}, ${(t.range / 1000).toFixed(2)} km` : 'Lock: hold F on a target, let go once locked', disabled: true, action: () => {} },
      { label: 'Drop the lock', disabled: !this.lock, action: () => this.drop() },
    ];
  }

  /**
   * (0.5.1) Who locked it and how long it's been out of sight; for a host's guests (who
   * see the host's radar, not run their own: see restoreExtra()) also who holds F on it,
   * what's under its gate and how far it's got locking on, and what it's locked on (by
   * their net ids). Never nothing: a host tells its guests only of an extra that's there.
   */
  protected serializeExtra(): Record<string, unknown> {
    const x: Record<string, unknown> = {};
    const net = this.game.net && !this.game.net.guest;
    if (this.lock) {
      x.owner = this.owner;
      if (this.lostT > 0) {
        x.lost = Math.round(this.lostT * 100) / 100;
        if (this.lastAt) x.at = [this.lastAt.x, this.lastAt.y];
      }
      if (net && this.lock.netId) x.lockNet = this.lock.netId;
    }
    if (net && this.holder) {
      x.holder = this.holder;
      if (!this.lock && this.candidate?.netId) {
        x.cand = this.candidate.netId;
        x.locking = Math.round(this.locking * 20) / 20;
      }
    }
    return x;
  }

  /**
   * A save's or an undo's lock is put back by restoreLinks(). A guest's copy is shown
   * as the host has it: who holds F on it (its brackets are drawn round their own
   * cursor), what's under its gate, and the lock (its box and readout on the screen of
   * whoever locked it). Before, a guest who locked a radar saw nothing of it at all.
   */
  protected restoreExtra(x: Record<string, unknown>): void {
    const guest = !!this.game.net?.guest;
    this.lostT = typeof x.lost === 'number' && x.lost > 0 ? x.lost : 0;
    // (a lock kept from a game with others in it, loaded alone: it's this player's now)
    if (typeof x.owner === 'number') this.owner = this.game.net ? x.owner : 1;
    if (!guest) return;
    const byNet = (id: unknown): Entity | null => (typeof id === 'number' && id > 0 ? this.game.entities.find((e) => e.netId === id && !e.destroyed) ?? null : null);
    this.holder = typeof x.holder === 'number' ? x.holder : 0;
    this.lock = byNet(x.lockNet);
    this.candidate = this.lock ? null : byNet(x.cand);
    this.locking = typeof x.locking === 'number' ? x.locking : 0;
    const at = x.at as number[] | undefined;
    this.lastAt = this.lock && Array.isArray(at) && at.length === 2 && at.every(Number.isFinite) ? { x: at[0], y: at[1] } : this.lock?.center() ?? null;
    if (this.holder || this.lock) overlay(this.game).on.add(this);
  }

  /** What it's locked on (by snapshot index): saves, undo and copies keep the lock. */
  serializeLinks(ref: (e: Entity) => number): Record<string, unknown> | undefined {
    const i = this.lock && !this.lock.destroyed ? ref(this.lock) : -1;
    return i >= 0 ? { lock: i } : undefined;
  }

  restoreLinks(links: Record<string, unknown>, get: (i: number) => Entity | undefined): void {
    const e = typeof links.lock === 'number' ? get(links.lock) : undefined;
    if (!e || e.destroyed || e === this) return;
    this.lock = e;
    this.candidate = null;
    this.locking = 0;
    if (!this.lostT || !this.lastAt) this.lastAt = e.center();
    this.lookT = LOOK_EVERY;
    if (!this.owner) this.owner = 1;
    overlay(this.game).on.add(this);
  }

  protected onDestroy(): void {
    super.onDestroy();
    overlays.get(this.game)?.on.delete(this);
  }
}

/** The radar a launcher is linked to (wired to, directly or through switches, or built into the same thing): one with a lock first. */
export function radarFor(game: Game, e: Entity): Radar | null {
  const linked = game.connections.assemblyOf([e], false).filter((x): x is Radar => x instanceof Radar && !x.destroyed);
  return linked.find((r) => r.lockEntity()) ?? linked[0] ?? null;
}

/**
 * The radar-guided missile launcher: Use fires, and its missile flies to wherever the
 * radar linked to it (see radarFor()) has its lock, following it as the radar tracks
 * it; with no lock (or the radar gone) it flies straight on. Its missile is fast, and
 * goes off near what it's after (a proximity fuse), so it brings down aircraft.
 */
export class RadarLauncher extends GuidedLauncher {
  activate(): void {
    const r = radarFor(this.game, this);
    this.fire(r && r.lockEntity() ? { kind: 'radar', radar: r } : { kind: 'none' });
  }

  contextActions(): ContextAction[] {
    const r = radarFor(this.game, this);
    const t = r?.telemetry();
    const link = !r ? 'No radar: wire one to it (Wire tool)' : t ? `Radar locked on ${t.name}` : 'Radar linked, no lock';
    return [
      { label: link, disabled: true, action: () => {} },
      { label: this.loaded ? 'Fire' : 'Reloading…', hint: 'F', disabled: !this.loaded, action: () => this.activate() },
      ...this.launchActions(),
    ];
  }
}

/**
 * The radars' overlay (one batch of lines for the game, in front of everything, and a
 * readout beside each lock): drawn for each radar this screen's player holds F on or has
 * locked with (see Radar.holder, owner).
 */
class Overlay {
  readonly on = new Set<Radar>();
  private readonly lines: LineBatch;
  private readonly tags = new Map<Radar, HTMLDivElement>();

  constructor(private game: Game) {
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, depthTest: false, depthWrite: false });
    this.lines = new LineBatch(64, 48, mat);
    this.lines.mesh.renderOrder = 31;
    game.renderer.scene.add(this.lines.mesh);
    game.frameHandlers.push(() => this.frame());
  }

  private frame(): void {
    const L = this.lines;
    const me = this.game.net?.me ?? 1;
    L.begin();
    for (const r of this.on) {
      const live = !r.destroyed && (r.lock || r.holder);
      if (!live) {
        this.on.delete(r);
        this.tag(r, null);
        continue;
      }
      r.drawOverlay(L, me);
      this.tag(r, r.lock && r.owner === me ? r.telemetry() : null);
    }
    for (const r of [...this.tags.keys()]) if (!this.on.has(r)) this.tag(r, null);
    L.end();
  }

  /** The readout beside a radar's lock (null: none). */
  private tag(r: Radar, t: ReturnType<Radar['telemetry']>): void {
    let el = this.tags.get(r);
    if (!t || !r.lock) {
      if (el) {
        el.remove();
        this.tags.delete(r);
      }
      return;
    }
    const host = this.game.renderer.canvas.parentElement;
    if (!host) return;
    if (!el) {
      el = document.createElement('div');
      el.className = 'radar-tag';
      host.appendChild(el);
      this.tags.set(r, el);
    }
    // (over the box's top left corner)
    const [x0, , , y1] = r.bounds(r.lock);
    const s = this.game.renderer.worldToScreen(x0, y1);
    const dir = Math.abs(t.heading) < Math.PI / 2 ? '→' : '←';
    const text = `${r.lostT > 0 ? 'MEMORY' : 'LOCK'} ${t.name}\nRNG ${t.range >= 1000 ? `${(t.range / 1000).toFixed(2)} km` : `${Math.round(t.range)} m`}\nALT ${Math.round(t.height)} m  VS ${t.climb >= 0 ? '+' : ''}${t.climb.toFixed(0)}\nSPD ${Math.round(t.speed)} m/s ${dir}`;
    if (el.textContent !== text) el.textContent = text;
    el.style.transform = `translate(${Math.round(s.x - 6)}px, ${Math.round(s.y - 12)}px) translateY(-100%)`;
  }
}

const overlays = new WeakMap<Game, Overlay>();

function overlay(game: Game): Overlay {
  let o = overlays.get(game);
  if (!o) overlays.set(game, (o = new Overlay(game)));
  return o;
}
