import { RAPIER } from '../engine/Physics';
import type { Game, NetRole } from '../world/Game';
import type { Entity } from '../world/Entity';
import type { Part } from '../world/Part';
import type { Connection } from '../systems/Connections';
import { instantiateIndexed } from '../world/Snapshot';
import { loadFromString, saveToString } from '../world/SaveLoad';
import { fromBase64 } from '../engine/base64';
import { lerpAngle, type V2 } from '../engine/math';
import type { Controls } from '../tools/Controls';
import type { EntityState } from '../world/types';
import type { MapSpec } from '../world/Maps';
import type { MusicPlan } from '../engine/Music';
import { FxPlayer, type Fx, type PartRef } from './Effects';
import { Wire, type Link } from './Link';
import { PART_FLAGS, type GuestOp, type HostMsg, type NetConn, type NetPuddles, type NetTime, type PlayerInfo, type Tick, type Welcome } from './protocol';
import { VITALS } from './Host';

/** How far behind the host's clock things are shown (ms): two ticks, so there's always a next pose to move towards. */
const DELAY = 100;
/** The clock offset creeps up this much a tick (ms), so that it follows a link that got slower. */
const OFFSET_CREEP = 0.5;
/** Effects due longer ago than this (ms) are skipped. */
const STALE_FX = 500;

/** What happens at a moment of the host's: shown when the poses get there. */
interface Due {
  ht: number;
  fx?: Fx[];
  gone?: number[];
  cut?: PartRef[];
}

const floats = (s: string) => new Float32Array(fromBase64(s).buffer);

/**
 * Playing in someone else's game. The world here is a copy of the host's: what
 * it has is spawned here too, but nothing is simulated (every body is kinematic,
 * moved where the host has it, a moment behind so that the motion is smooth),
 * and what happens to it (blood, sounds, a limb coming off) is done as the host
 * says. What the player does goes to the host (see Controls.net), and comes back
 * in the ticks like everything else.
 */
export class NetClient {
  /** This player's number (0 until the host has said). */
  you = 0;
  players: PlayerInfo[] = [];
  /** Everyone else's cursor, by player. */
  readonly cursors = new Map<number, V2>();
  /** The host's physics solver iterations: its world is the one everyone sees, so its setting is the one that counts. */
  hostIterations = 0;
  /** The host's gravity (null until it says): the guest's effects fall as its world does. */
  hostGravity: number | null = null;
  /** The host's music plan, its start on the host's clock (see tick()). */
  private hostMusic: MusicPlan | null = null;
  onplayers: (() => void) | null = null;
  /** The link to the host is gone (not by leave()): the game carries on here alone. */
  onclose: (() => void) | null = null;
  private wire: Wire<HostMsg, GuestOp>;
  private fx: FxPlayer;
  private ents = new Map<number, Entity>();
  private conns = new Map<number, Connection>();
  /** Where each of the host's connections was tied when it was last made here (one re-made there is made again here). */
  private connEnds = new Map<number, string>();
  private connIds = new WeakMap<Connection, number>();
  /** Poses to move through, per part: [host time, x, y, angle, ...]. */
  private samples = new Map<Part, number[]>();
  private due: Due[] = [];
  /** Our clock less the host's (ms), the least seen: the link's quickest. */
  private offset = Infinity;
  private lastHt = 0;
  private role: NetRole;
  private frameHook: () => void;
  private done = false;

  constructor(private game: Game, private controls: Controls, link: Link, name: string) {
    this.wire = new Wire<HostMsg, GuestOp>(link);
    this.fx = new FxPlayer(game, (r) => this.part(r));
    this.role = { guest: true, pose: () => this.pose(false) };
    this.frameHook = () => this.frame();
    this.wire.onmessage = (m) => {
      try {
        this.take(m);
      } catch (e) {
        console.warn('a message from the host failed', m?.t, e);
      }
    };
    this.wire.onclose = () => {
      if (this.done) return;
      this.leave();
      this.onclose?.();
    };
    game.net = this.role;
    game.frameHandlers.push(this.frameHook);
    controls.history.clear();
    controls.net = {
      send: (op) => this.wire.send(op),
      ref: (p) => [p.entity.netId, p.entity.parts.indexOf(p)],
      ids: (list) => list.map((e) => e.netId).filter((id) => id > 0),
      conn: (c) => this.connIds.get(c) ?? -1,
    };
    this.wire.send({ op: 'hello', name });
  }

  /** Characters received so far (for the network readout). */
  get received(): number {
    return this.wire.received;
  }

  /**
   * Leaves the host's game: what's here becomes this player's own game, as it
   * was (everything starts moving by itself again).
   */
  leave(): void {
    if (this.done) return;
    this.done = true;
    const game = this.game;
    const save = saveToString(game);
    game.net = null;
    this.controls.net = null;
    // (this game's statistics are this player's own again)
    game.stats.fromHost(null);
    // (the music carries on from where the host's had got to, as this player's own)
    game.music.follow(null);
    game.frameHandlers = game.frameHandlers.filter((h) => h !== this.frameHook);
    this.fx.clear();
    this.wire.close();
    loadFromString(game, save, { camera: false });
    this.controls.ui.refreshToolbar();
  }

  // ---- what the host sends ----------------------------------------------------------

  private take(m: HostMsg): void {
    switch (m.t) {
      case 'welcome': this.welcome(m); break;
      case 'tick': this.tick(m); break;
      case 'players':
        this.players = m.list;
        this.onplayers?.();
        break;
      case 'toast': this.controls.ui.toast(m.msg); break;
    }
  }

  private welcome(m: Welcome): void {
    const game = this.game;
    const first = !this.you;
    this.you = m.you;
    this.players = m.players;
    this.due.length = 0;
    this.samples.clear();
    this.fx.clear();
    this.ents.clear();
    this.conns.clear();
    this.offset = Infinity;
    // (joining shows what the host is looking at; a scene loaded later leaves the view alone)
    const made = loadFromString(game, m.save, { camera: first });
    game.connections.clearAll();
    made.forEach((e, i) => {
      if (e) this.adopt(e, m.ids[i]);
    });
    this.setConns(m.conns);
    this.setTime(m.time);
    this.onplayers?.();
  }

  private tick(m: Tick): void {
    const now = performance.now();
    this.offset = Math.min(this.offset + OFFSET_CREEP, now - m.ht);
    if (m.spawn) this.spawn(m.spawn.ids, m.spawn.ents);
    if (m.extra) {
      for (const [id, x] of m.extra) {
        const e = this.ents.get(id);
        if (e && !e.destroyed) (e as unknown as { restoreExtra(x: Record<string, unknown>): void }).restoreExtra(x);
      }
    }
    if (m.vitals) for (const [id, v] of m.vitals) this.setVitals(id, v);
    if (m.conns) this.setConns(m.conns);
    if (m.ps) this.partStates(floats(m.ps));
    if (m.tf) this.poses(floats(m.tf), m.ht);
    if (m.fx || m.gone || m.cut) this.due.push({ ht: m.ht, fx: m.fx, gone: m.gone, cut: m.cut });
    if (m.holds) this.fx.hold(m.holds);
    if (m.puddles) this.setPuddles(m.puddles);
    if (m.time) this.setTime(m.time);
    // the host's music, its start put on our clock (which the ticks keep comparing with the host's)
    if (this.hostMusic) this.game.music.follow({ seed: this.hostMusic.seed, start: this.hostMusic.start + this.offset });
    if (m.map) this.setMap(m.map);
    if (m.stats) this.game.stats.fromHost(m.stats);
    if (m.cursors) {
      this.cursors.clear();
      for (const [id, x, y] of m.cursors) if (id !== this.you) this.cursors.set(id, { x, y });
    }
    this.lastHt = m.ht;
  }

  /** An entity as the host has it: numbered as there, moved only by the host. */
  private adopt(e: Entity, id: number): void {
    e.netId = id;
    this.ents.set(id, e);
    for (const p of e.parts) {
      if (p.destroyed) continue;
      p.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    }
  }

  private spawn(ids: number[], ents: EntityState[]): void {
    const made = instantiateIndexed(this.game, { entities: ents, connections: [] });
    made.forEach((e, i) => {
      if (e) this.adopt(e, ids[i]);
    });
  }

  private setVitals(id: number, v: Record<string, unknown>): void {
    const e = this.ents.get(id);
    if (!e || e.destroyed) return;
    const t = e as unknown as Record<string, unknown>;
    for (const k of VITALS) if (k in v) t[k] = v[k];
    const drugs = t.drugs as Record<string, number> | undefined;
    if (drugs && v.drugs) Object.assign(drugs, v.drugs);
  }

  private setConns(list: NetConn[]): void {
    const cs = this.game.connections;
    const keep = new Set<number>();
    for (const n of list) {
      keep.add(n.id);
      let c = this.conns.get(n.id);
      if (c && !cs.list.includes(c)) c = undefined;
      // (an end moved, or re-made where things were moved to while paused: made again)
      const ends = `${n.kind}:${n.a}:${n.b}:${n.la.x.toFixed(4)},${n.la.y.toFixed(4)}:${n.lb.x.toFixed(4)},${n.lb.y.toFixed(4)}:${n.rest.toFixed(4)}:${n.opts?.damping ?? ''}`;
      if (c && this.connEnds.get(n.id) !== ends) {
        cs.remove(c);
        c = undefined;
      }
      if (!c) {
        const a = this.part(n.a);
        const b = n.b ? this.part(n.b) : null;
        if (!a || (n.b && !b)) continue;
        const wa = a.localToWorld(n.la.x, n.la.y);
        const wb = b ? b.localToWorld(n.lb.x, n.lb.y) : n.lb;
        c = cs.create(n.kind, a, wa, b, wb, n.rest, n.limit !== undefined ? { limit: n.limit, ref: n.ref } : undefined, n.stiffness, n.opts) ?? undefined;
        if (!c) continue;
        // (exactly the host's, whatever the parts' poses here)
        c.la = { ...n.la };
        c.lb = { ...n.lb };
        this.conns.set(n.id, c);
        this.connIds.set(c, n.id);
        this.connEnds.set(n.id, ends);
      }
      // (hidden, colliding, how strong: shown as the host has them)
      c.opts = n.opts ? { ...n.opts } : undefined;
      c.limit = n.limit;
      c.ref = n.ref;
      c.stiffness = n.stiffness;
      c.burn = n.burn ? { lo: n.burn[0], hi: n.burn[1] } : undefined;
      c.end = n.end ? { ...n.end } : undefined;
    }
    for (const [id, c] of this.conns) {
      if (keep.has(id)) continue;
      cs.remove(c);
      this.conns.delete(id);
      this.connEnds.delete(id);
    }
  }

  /** Parts' health, fire, char and flags: [id, part, hp, burning, charred, flags, ...]. */
  private partStates(a: Float32Array): void {
    for (let i = 0; i + 5 < a.length; i += 6) {
      const p = this.part([a[i], a[i + 1]]);
      if (!p) continue;
      if (a[i + 2] < 1e9) p.hp = a[i + 2];
      this.game.fire.show(p, a[i + 3]);
      p.charred = a[i + 4];
      const f = a[i + 5];
      const left = (f & PART_FLAGS.left) !== 0;
      if (left !== (p.flip === -1)) p.mirror(p.x);
      p.frozen = (f & PART_FLAGS.frozen) !== 0;
      const nc = (f & PART_FLAGS.noCollide) !== 0;
      if (nc !== p.noCollideAll) p.setNoCollideAll(nc);
      p.refreshTint();
    }
  }

  /** Where parts were at host time `ht`: [id, part, x, y, angle, ...], added to what each part moves through. */
  private poses(a: Float32Array, ht: number): void {
    for (let i = 0; i + 4 < a.length; i += 5) {
      const p = this.part([a[i], a[i + 1]]);
      if (!p) continue;
      let s = this.samples.get(p);
      if (!s) {
        // it was standing still where it is until the last tick
        s = [Math.min(this.lastHt, ht - 1), p.x, p.y, p.a];
        this.samples.set(p, s);
      } else if (s[s.length - 4] < this.lastHt) {
        s.push(this.lastHt, s[s.length - 3], s[s.length - 2], s[s.length - 1]);
      }
      s.push(ht, a[i + 2], a[i + 3], a[i + 4]);
    }
  }

  private setPuddles(n: NetPuddles): void {
    this.game.puddles.restore({ lo: n.lo, hi: n.hi, h: floats(n.h), kind: fromBase64(n.kind), burn: floats(n.burn), oil: n.oil ? floats(n.oil) : undefined });
  }

  /** The host's map with other ground (or renamed): a switch of maps comes as a welcome instead. */
  private setMap(spec: MapSpec): void {
    const cur = this.game.map;
    if (spec.width === cur.width && spec.height === cur.height && spec.theme === cur.theme) this.game.reshapeMap(spec);
    else this.game.setMap(spec, false);
  }

  private setTime(t: NetTime): void {
    const g = this.game;
    if (t.iterations) this.hostIterations = t.iterations;
    if (t.music) this.hostMusic = t.music;
    if (t.gravity !== undefined) {
      this.hostGravity = t.gravity;
      g.setGravity(t.gravity);
    }
    if (t.weather) g.weather.apply(t.weather);
    if (g.paused === t.paused && g.timeScale === t.scale) return;
    g.paused = t.paused;
    g.timeScale = t.scale;
    this.controls.ui.refreshToolbar();
  }

  // ---- showing it ---------------------------------------------------------------------

  private part(r: PartRef | null | undefined): Part | null {
    if (!Array.isArray(r)) return null;
    const p = this.ents.get(r[0])?.parts[r[1]];
    return p && !p.destroyed ? p : null;
  }

  /** The host's time being shown now. */
  private get showing(): number {
    return performance.now() - this.offset - DELAY;
  }

  /**
   * Puts everything where the host had it a moment ago: as the next pose of a
   * kinematic body in a step (`now` false), or at once while time is paused.
   */
  private pose(now: boolean): void {
    const t = this.showing;
    for (const [p, s] of this.samples) {
      if (p.destroyed) {
        this.samples.delete(p);
        continue;
      }
      // drop what's past, keeping the pose at or before now
      let k = 0;
      while (k + 4 < s.length && s[k + 4] <= t) k += 4;
      if (k) s.splice(0, k);
      let x: number;
      let y: number;
      let a: number;
      if (s.length > 4 && t > s[0]) {
        const f = (t - s[0]) / (s[4] - s[0]);
        x = s[1] + (s[5] - s[1]) * f;
        y = s[2] + (s[6] - s[2]) * f;
        a = lerpAngle(s[3], s[7], f);
      } else {
        x = s[1];
        y = s[2];
        a = s[3];
        // (got there: nothing more to move through)
        if (s.length === 4 && t >= s[0]) this.samples.delete(p);
      }
      if (now) {
        p.teleport(x, y, a);
      } else {
        p.body.setNextKinematicTranslation({ x, y });
        p.body.setNextKinematicRotation(a);
      }
    }
    if (now) this.game.physics.world.propagateModifiedBodyPositionsToColliders();
  }

  /** Each frame: what's due happens, and while time is paused things are put straight where they are. */
  private frame(): void {
    const t = this.showing;
    while (this.due.length && this.due[0].ht <= t) {
      const d = this.due.shift()!;
      if (d.cut) {
        for (const r of d.cut) {
          const p = this.part(r);
          if (p) p.entity.removePart(p);
        }
      }
      if (d.gone) {
        for (const id of d.gone) {
          const e = this.ents.get(id);
          this.ents.delete(id);
          if (e && !e.destroyed) this.game.remove(e);
        }
      }
      // (effects long past aren't worth making now: a burst of old bangs after a stall)
      if (d.fx && t - d.ht < STALE_FX) this.fx.play(d.fx);
    }
    this.fx.frame();
    if (this.game.paused) this.pose(true);
  }
}
