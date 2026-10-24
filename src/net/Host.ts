import type { Game } from '../world/Game';
import type { Entity } from '../world/Entity';
import type { Part } from '../world/Part';
import { RIGID_KINDS, type ConnOpts, type Connection } from '../systems/Connections';
import { PX } from '../engine/constants';
import { ARRANGE, type ArrangeHow, type LayerDir } from '../tools/Arrange';
import { CONN_LABEL } from '../tools/ConnectTool';
import { capture, instantiate } from '../world/Snapshot';
import { saveToString } from '../world/SaveLoad';
import { sameMap, validateMap, type MapSpec } from '../world/Maps';
import { getItem } from '../catalog/items';
import { arrayToBase64 } from '../engine/base64';
import { clamp, type V2 } from '../engine/math';
import { isFighter, isLiving, setFighting } from '../systems/Fighting';
import { Car } from '../entities/Car';
import { beginGrab, dragPaused, grabAlong, inWorld, Powers, releaseGrab, stepGrab, type Controls, type Grab, type PowerId, type ValueEditor } from '../tools/Controls';
import { FxRecorder, refOf, type PartRef } from './Effects';
import { Wire, type Lobby, type Link } from './Link';
import { PART_FLAGS, type GuestOp, type HostMsg, type NetConn, type NetTime, type PlayerInfo, type Tick, type Welcome } from './protocol';

/** Ticks a second's worth: how often guests hear what changed (ms between). */
const TICK_MS = 50;
/** Part states and how people are go every this many ticks (they change slowly, or don't show much). */
const STATE_EVERY = 4;
const PUDDLES_EVERY = 5;
/** The game's statistics, looked at every this many ticks (sent when they've changed). */
const STATS_EVERY = 20;
/** Players' colours, the host's first. */
export const PLAYER_COLORS = ['#e2bd57', '#6fc3e8', '#e8746f', '#8fdb7a', '#c49af0', '#f0a35e', '#5ee0c0', '#f07ac8'];
/** How people and animals are, as the guests need it (for their faces and the vitals panel). */
export const VITALS = ['alive', 'consciousness', 'blood', 'pain', 'shock', 'state', 'zombie', 'infection'] as const;

/** Someone who joined: their link, and what they're doing in the host's game. */
interface Guest extends PlayerInfo {
  wire: Wire<GuestOp, HostMsg>;
  cursor: V2 | null;
  grab: Grab | null;
  /** What moves with the held thing while time is paused (their selection). */
  grabList: Entity[];
  target: V2;
  rot: number;
  snap: boolean;
  /** Their snapping's grid (m) and angle step (rad), and dragging just what they took hold of (Ctrl). */
  snapGrid: number;
  snapStep: number;
  alone: boolean;
  /** What their drag moves while time is paused (see Arrange.moving()), worked out as it first moves. */
  moveList: Entity[] | null;
  powers: Powers;
  power: { kind: PowerId | null; x: number; y: number; flick: V2 };
  /** What they're holding switched on (F held). */
  activated: Set<Entity>;
  /** What they spawned, newest last (Z takes it back). */
  creations: Entity[][];
}

/** What the guests were last sent about an entity. */
interface Known {
  /** Which parts were destroyed. */
  gone: boolean[];
  extra: string;
  vitals: string;
  /** Poses (x, y, angle per part) and states (hp, burning, charred, flags). */
  pose: Float32Array;
  state: Float32Array;
}

const extraOf = (e: Entity): Record<string, unknown> | undefined => (e as unknown as { serializeExtra(): Record<string, unknown> | undefined }).serializeExtra();

/** A living thing's vitals, rounded so that small drifts don't count as changes. */
export function vitalsOf(e: Entity): Record<string, unknown> {
  const src = e as unknown as Record<string, unknown>;
  const v: Record<string, unknown> = {};
  for (const k of VITALS) {
    const x = src[k];
    v[k] = typeof x === 'number' ? Math.round(x * 100) / 100 : x;
  }
  const drugs = src.drugs as Record<string, number> | undefined;
  if (drugs) v.drugs = Object.fromEntries(Object.entries(drugs).map(([k, x]) => [k, Math.round(x * 100) / 100]));
  return v;
}

/** A player's name as shown: short, plain. */
export function cleanName(s: unknown, fallback: string): string {
  const n = String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 20);
  return n || fallback;
}

/**
 * Hosting a multiplayer game. The host's game is the real one: guests are sent
 * all of it when they join, then twenty times a second what changed (poses,
 * what was spawned and removed, objects' state, effects; see protocol.Tick).
 * What guests do comes back as ops (see protocol.GuestOp), done here as if the
 * host had done it: their drags and powers run in this game's steps.
 */
export class NetHost {
  readonly me: PlayerInfo;
  readonly guests = new Map<number, Guest>();
  /** Called when someone joins or leaves, or is renamed. */
  onplayers: (() => void) | null = null;
  /** Something for the host's status bar ("Ann joined"). */
  ontoast: ((msg: string) => void) | null = null;
  private fx: FxRecorder;
  private known = new Map<Entity, Known>();
  private byId = new Map<number, Entity>();
  private nextId = 1;
  private nextPlayer = 2;
  private lastTick = 0;
  private n = 0;
  private conns = '';
  private puddles = '';
  private time = '';
  private stats = '';
  private scene: number;
  /** The map as the guests have it. */
  private map: MapSpec;
  private hooks: { pre: (dt: number) => void; post: () => void; frame: (dt: number) => void };

  constructor(private game: Game, private controls: Controls, private lobby: Lobby, name: string) {
    this.me = { id: 1, name: cleanName(name, 'Host'), color: PLAYER_COLORS[0] };
    this.fx = new FxRecorder(game);
    this.scene = game.sceneVersion;
    this.map = game.map;
    lobby.onjoin = (link) => this.join(link);
    this.hooks = {
      pre: (dt) => this.stepGuests(dt),
      post: () => this.offerHeld(),
      frame: (dt) => {
        if (game.paused) this.dragPaused(dt);
        this.tick();
      },
    };
    game.preStepHandlers.push(this.hooks.pre);
    game.postStepHandlers.push(this.hooks.post);
    game.frameHandlers.push(this.hooks.frame);
    // everything gets its number now (afresh: numbers from an earlier game hosted would clash with the new ones)
    for (const e of game.entities) e.netId = 0;
    this.tick(true);
  }

  get code(): string {
    return this.lobby.code;
  }

  get players(): PlayerInfo[] {
    return [this.me, ...[...this.guests.values()].map(({ id, name, color }) => ({ id, name, color }))];
  }

  /** Characters sent to guests so far (for the network readout). */
  get sent(): number {
    let n = 0;
    for (const g of this.guests.values()) n += g.wire.sent;
    return n;
  }

  // ---- players -------------------------------------------------------------------------

  private join(link: Link): void {
    const id = this.nextPlayer++;
    const wire = new Wire<GuestOp, HostMsg>(link);
    const g: Guest = {
      id, name: `Player ${id}`, color: PLAYER_COLORS[(id - 1) % PLAYER_COLORS.length], wire, cursor: null,
      grab: null, grabList: [], target: { x: 0, y: 0 }, rot: 0, snap: false, snapGrid: 0.1, snapStep: Math.PI / 12, alone: false, moveList: null,
      powers: new Powers(this.game), power: { kind: null, x: 0, y: 0, flick: { x: 0, y: 0 } },
      activated: new Set(), creations: [],
    };
    wire.onmessage = (m) => this.op(g, m);
    wire.onclose = () => this.leave(g);
    // (what's new goes to everyone else first, so the guest's start and the next tick fit together)
    this.tick(true);
    this.guests.set(id, g);
    wire.send(this.welcome(g));
    this.sendPlayers();
  }

  private leave(g: Guest): void {
    if (!this.guests.delete(g.id)) return;
    this.drop(g);
    for (const e of g.activated) if (!e.destroyed) e.setActiveHeld(false);
    g.activated.clear();
    this.sendPlayers();
    this.tell(`${g.name} left`);
  }

  private sendPlayers(): void {
    const m: HostMsg = { t: 'players', list: this.players };
    for (const g of this.guests.values()) g.wire.send(m);
    this.onplayers?.();
  }

  private welcome(g: Guest): Welcome {
    const ents = this.game.entities.filter((e) => !e.destroyed);
    // (someone new: the statistics go again with the next look at them)
    this.stats = '';
    return {
      t: 'welcome', you: g.id, players: this.players, save: saveToString(this.game), ids: ents.map((e) => e.netId),
      conns: this.connList(), time: this.netTime(),
    };
  }

  private netTime(): NetTime {
    return {
      paused: this.game.paused, scale: this.game.timeScale, iterations: this.game.physics.world.integrationParameters.numSolverIterations, gravity: this.game.gravity,
      music: this.game.music.shared, weather: { ...this.game.weather.state },
    };
  }

  /** Stops hosting: the guests are let go (they carry on alone with what they had). */
  stop(): void {
    for (const g of [...this.guests.values()]) {
      g.wire.close();
      this.leave(g);
    }
    this.lobby.close();
    this.fx.dispose();
    const g = this.game;
    g.preStepHandlers = g.preStepHandlers.filter((h) => h !== this.hooks.pre);
    g.postStepHandlers = g.postStepHandlers.filter((h) => h !== this.hooks.post);
    g.frameHandlers = g.frameHandlers.filter((h) => h !== this.hooks.frame);
  }

  // ---- ticks ----------------------------------------------------------------------------

  /** Sends the guests what changed (at most every TICK_MS, unless forced). */
  tick(force = false): void {
    const now = performance.now();
    if (!force && now - this.lastTick < TICK_MS) return;
    this.lastTick = now;
    this.n++;
    // a scene replaced wholesale (a load, Clear): everyone starts again from all of it
    if (this.game.sceneVersion !== this.scene) {
      this.scene = this.game.sceneVersion;
      this.known.clear();
      this.byId.clear();
      this.fx.take();
      this.diff({ t: 'tick', ht: now });
      for (const g of this.guests.values()) g.wire.send(this.welcome(g));
      this.conns = this.connSig();
      this.map = this.game.map;
      return;
    }
    const m: Tick = { t: 'tick', ht: now };
    const full = force || this.n % STATE_EVERY === 0;
    this.diff(m, full);
    const { fx, holds } = this.fx.take();
    if (!this.guests.size) return;
    this.poses(m);
    if (full) this.partStates(m);
    const sig = this.connSig();
    if (sig !== this.conns) {
      this.conns = sig;
      m.conns = this.connList();
    }
    if (force || this.n % PUDDLES_EVERY === 0) this.puddleState(m);
    if (fx.length) m.fx = fx;
    if (holds.length) m.holds = holds;
    if (this.game.map !== this.map) {
      this.map = this.game.map;
      m.map = this.map;
    }
    const t = this.netTime();
    const time = `${t.paused}:${t.scale}:${t.iterations}:${t.gravity}:${t.music?.seed}:${t.music?.start}:${JSON.stringify(t.weather)}`;
    if (time !== this.time) {
      this.time = time;
      m.time = t;
    }
    if (force || this.n % STATS_EVERY === 0) {
      // (the time played moves on by itself: sent with what else changed, or every ten seconds of it)
      const st = { ...this.game.stats.game, time: Math.floor(this.game.stats.game.time / 10) * 10 };
      const sig = JSON.stringify(st);
      if (sig !== this.stats) {
        this.stats = sig;
        m.stats = st;
      }
    }
    m.cursors = [[1, this.controls.wx, this.controls.wy]];
    for (const g of this.guests.values()) if (g.cursor) m.cursors.push([g.id, g.cursor.x, g.cursor.y]);
    const s = JSON.stringify(m);
    for (const g of this.guests.values()) g.wire.sendRaw(s);
  }

  /** What was spawned, removed or broken, and objects' own state, since the last tick. */
  private diff(m: Tick, full = true): void {
    const live = new Set<Entity>();
    const fresh: Entity[] = [];
    const cut: PartRef[] = [];
    const extra: [number, Record<string, unknown>][] = [];
    const vitals: [number, Record<string, unknown>][] = [];
    for (const e of this.game.entities) {
      if (e.destroyed) continue;
      live.add(e);
      const k = this.known.get(e);
      if (!k) {
        fresh.push(e);
        continue;
      }
      e.parts.forEach((p, i) => {
        if (p.destroyed && !k.gone[i]) {
          k.gone[i] = true;
          cut.push([e.netId, i]);
        }
      });
      if (isLiving(e)) {
        if (!full) continue;
        const v = vitalsOf(e);
        const s = JSON.stringify(v);
        if (s !== k.vitals) {
          k.vitals = s;
          vitals.push([e.netId, v]);
        }
        continue;
      }
      const x = extraOf(e);
      const s = x ? JSON.stringify(x) : '';
      if (s !== k.extra) {
        k.extra = s;
        if (x) extra.push([e.netId, x]);
      }
    }
    const gone: number[] = [];
    for (const e of this.known.keys()) {
      if (live.has(e)) continue;
      gone.push(e.netId);
      this.known.delete(e);
      this.byId.delete(e.netId);
    }
    if (fresh.length) {
      for (const e of fresh) {
        if (!e.netId) e.netId = this.nextId++;
        this.byId.set(e.netId, e);
        this.known.set(e, this.know(e));
      }
      m.spawn = { ids: fresh.map((e) => e.netId), ents: capture(this.game, fresh).entities };
    }
    if (gone.length) m.gone = gone;
    if (cut.length) m.cut = cut;
    if (extra.length) m.extra = extra;
    if (vitals.length) m.vitals = vitals;
  }

  /** An entity as the guests have it once it's spawned there. */
  private know(e: Entity): Known {
    const x = extraOf(e);
    const k: Known = {
      gone: e.parts.map((p) => p.destroyed), extra: x ? JSON.stringify(x) : '', vitals: isLiving(e) ? JSON.stringify(vitalsOf(e)) : '',
      pose: new Float32Array(e.parts.length * 3), state: new Float32Array(e.parts.length * 4),
    };
    e.parts.forEach((p, i) => {
      k.pose.set([p.x, p.y, p.a], i * 3);
      k.state.set(this.stateOf(p), i * 4);
    });
    return k;
  }

  /** Where things are that have moved since they were last sent. */
  private poses(m: Tick): void {
    const out: number[] = [];
    for (const [e, k] of this.known) {
      const parts = e.parts;
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        if (p.destroyed) continue;
        const o = i * 3;
        const q = k.pose;
        if (Math.abs(p.x - q[o]) < 1e-4 && Math.abs(p.y - q[o + 1]) < 1e-4 && Math.abs(p.a - q[o + 2]) < 1e-4) continue;
        q[o] = p.x;
        q[o + 1] = p.y;
        q[o + 2] = p.a;
        out.push(e.netId, i, p.x, p.y, p.a);
      }
    }
    if (out.length) m.tf = arrayToBase64(new Float32Array(out));
  }

  private stateOf(p: Part): [number, number, number, number] {
    const flags = (p.frozen ? PART_FLAGS.frozen : 0) | (p.flip === -1 ? PART_FLAGS.left : 0) | (p.noCollideAll ? PART_FLAGS.noCollide : 0);
    const hp = Number.isFinite(p.hp) ? Math.round(p.hp * 2) / 2 : 1e9;
    return [hp, Math.round(p.burning * 100) / 100, Math.round(p.charred * 100) / 100, flags];
  }

  /** Health, fire, char and frozen-ness of the parts whose have changed. */
  private partStates(m: Tick): void {
    const out: number[] = [];
    for (const [e, k] of this.known) {
      e.parts.forEach((p, i) => {
        if (p.destroyed) return;
        const s = this.stateOf(p);
        const o = i * 4;
        const q = k.state;
        if (s[0] === q[o] && s[1] === q[o + 1] && s[2] === q[o + 2] && s[3] === q[o + 3]) return;
        q.set(s, o);
        out.push(e.netId, i, ...s);
      });
    }
    if (out.length) m.ps = arrayToBase64(new Float32Array(out));
  }

  private connSig(): string {
    // (every field that can change: a connection re-made (an end moved, a weld
    // re-posed) keeps its number but changes version)
    const C = this.game.connections;
    let s = `${C.version}|`;
    for (const c of C.list) {
      s += `${c.id}:${c.limit ?? ''}:${c.ref ?? ''}:${c.stiffness ?? ''}:${c.rest.toFixed(3)}:${c.burn ? `${c.burn.lo.toFixed(3)},${c.burn.hi.toFixed(3)}` : ''}:${c.opts ? JSON.stringify(c.opts) : ''};`;
    }
    return s;
  }

  private connList(): NetConn[] {
    const out: NetConn[] = [];
    for (const c of this.game.connections.list) {
      const a = refOf(c.a);
      const b = c.b ? refOf(c.b) : null;
      if (!a || (c.b && !b)) continue;
      out.push({
        id: c.id, kind: c.kind, a, la: { ...c.la }, b, lb: { ...c.lb }, rest: c.rest,
        ...(c.limit !== undefined ? { limit: c.limit, ref: c.ref } : {}),
        ...(c.stiffness !== undefined ? { stiffness: c.stiffness } : {}),
        ...(c.burn ? { burn: [c.burn.lo, c.burn.hi] as [number, number] } : {}),
        ...(c.end ? { end: { ...c.end } } : {}),
        ...(c.opts ? { opts: { ...c.opts } } : {}),
      });
    }
    return out;
  }

  private puddleState(m: Tick): void {
    const s = this.game.puddles.capture();
    let sum = s.lo * 7 + s.hi;
    for (let i = 0; i < s.h.length; i++) sum += s.h[i] * (i + 1) + s.burn[i] * 13 + s.kind[i];
    const sig = sum.toFixed(3);
    if (sig === this.puddles) return;
    this.puddles = sig;
    m.puddles = { lo: s.lo, hi: s.hi, h: arrayToBase64(s.h), kind: arrayToBase64(s.kind), burn: arrayToBase64(s.burn), ...(s.oil ? { oil: arrayToBase64(s.oil) } : {}) };
  }

  // ---- what guests do -------------------------------------------------------------------

  private entity(id: number): Entity | null {
    const e = this.byId.get(id);
    return e && !e.destroyed ? e : null;
  }

  private entities(ids: unknown): Entity[] {
    return Array.isArray(ids) ? ids.map((id) => this.entity(Number(id))).filter((e): e is Entity => !!e) : [];
  }

  private part(r: PartRef | null | undefined): Part | null {
    if (!Array.isArray(r)) return null;
    const p = this.entity(r[0])?.parts[r[1]];
    return p && !p.destroyed ? p : null;
  }

  private conn(id: number): Connection | null {
    return this.game.connections.list.find((c) => c.id === id) ?? null;
  }

  /** A message for the host's own status bar (after any op being done, whose messages go to the guest). */
  private tell(msg: string): void {
    queueMicrotask(() => this.ontoast?.(msg));
  }

  /** Runs `fn` with the host's status-bar messages going to the guest instead. */
  private as(g: Guest, fn: () => void): void {
    const ui = this.controls.ui;
    const own = Object.prototype.hasOwnProperty.call(ui, 'toast');
    const toast = ui.toast;
    ui.toast = (msg: string) => g.wire.send({ t: 'toast', msg });
    try {
      fn();
    } finally {
      if (own) ui.toast = toast;
      else delete (ui as unknown as Record<string, unknown>).toast;
    }
  }

  private op(g: Guest, m: GuestOp): void {
    try {
      this.as(g, () => this.run(g, m));
    } catch (e) {
      console.warn('a guest’s', m?.op, 'failed', e);
    }
  }

  private run(g: Guest, m: GuestOp): void {
    const game = this.game;
    const c = this.controls;
    const history = c.history;
    switch (m.op) {
      case 'hello':
        g.name = cleanName(m.name, g.name);
        this.sendPlayers();
        this.tell(`${g.name} joined`);
        break;
      case 'cursor':
        g.cursor = { x: Number(m.x) || 0, y: Number(m.y) || 0 };
        break;
      case 'spawn': {
        const def = getItem(m.def);
        if (!def?.create) return;
        history.record(`Spawn ${def.name}`);
        const angle = Number(m.angle);
        const e = game.spawn(def, m.x, m.y, { flip: !!m.left, config: m.config, ...(Number.isFinite(angle) && angle ? { angle } : {}) });
        if (!e) return;
        this.spawned(g, [e], !!m.frozen, !!m.active);
        game.sound.place(m.x, e.parts[0]?.mat.sound ?? 'wood');
        break;
      }
      case 'place': {
        history.record(m.label || 'Paste');
        const made = instantiate(game, m.snap, { dx: m.dx, dy: m.dy });
        this.spawned(g, made, !!m.frozen, !!m.active);
        if (made.length) game.sound.place(made[0].parts[0]?.x ?? 0, made[0].parts[0]?.mat.sound ?? 'wood');
        break;
      }
      case 'unspawn': {
        while (g.creations.length) {
          const list = g.creations.pop()!.filter((e) => !e.destroyed);
          if (list.length) {
            c.deleteEntities(list);
            return;
          }
        }
        c.ui.toast('Nothing left to remove');
        break;
      }
      case 'delete': c.deleteEntities(this.entities(m.ids)); break;
      case 'freeze': c.toggleFreeze(this.entities(m.ids)); break;
      case 'ignite': c.toggleFire(this.entities(m.ids)); break;
      case 'duplicate': {
        const list = this.entities(m.ids);
        if (!list.length) return;
        history.record('Duplicate');
        g.creations.push(instantiate(game, capture(game, list), { dx: 0.6, dy: 0.3 }));
        break;
      }
      case 'flip': {
        const list = this.entities(m.ids);
        if (!list.length) return;
        history.record('Flip');
        game.flipEntities(list);
        break;
      }
      case 'jump': for (const e of this.entities(m.ids)) e.jump(); break;
      case 'weld': c.weldTogether(this.entities(m.ids)); break;
      case 'activate':
        for (const e of this.entities(m.ids)) {
          if (g.activated.has(e)) continue;
          e.activate();
          e.setActiveHeld(true);
          g.activated.add(e);
        }
        break;
      case 'release':
        for (const e of this.entities(m.ids)) if (g.activated.delete(e)) e.setActiveHeld(false);
        break;
      case 'fightEach': setFighting(this.entities(m.ids).filter(isFighter).filter((e) => e.alive)); break;
      case 'weightless': c.setWeightless(this.entities(m.ids), !!m.on); break;
      case 'noCollide': c.setNoCollide(this.entities(m.ids), !!m.on); break;
      case 'rotate': c.rotateSelection(this.entities(m.ids), Number(m.angle) || 0); break;
      case 'drive':
        for (const e of this.entities(m.ids)) if (e instanceof Car) e.steer(clamp(Number(m.x) || 0, -1, 1), clamp(Number(m.aim) || 0, -1, 1));
        break;
      case 'freezePart': {
        const p = this.part(m.p);
        if (!p) return;
        history.record(p.frozen ? 'Unfreeze' : 'Freeze');
        p.setFrozen(!p.frozen);
        break;
      }
      case 'rebuild': {
        const e = this.entity(m.id);
        if (!e) return;
        history.record('Resize');
        game.rebuildEntity(e, m.config, m.at);
        break;
      }
      case 'grab': {
        this.drop(g);
        const p = this.part(m.p);
        if (!p) return;
        g.target = inWorld(m.x, m.y);
        g.grab = beginGrab(game, p, g.target.x, g.target.y);
        g.grabList = this.entities(m.ids);
        grabAlong(game, g.grab, g.grabList);
        g.rot = 0;
        g.alone = !!m.alone;
        g.moveList = null;
        break;
      }
      case 'drag':
        g.target = inWorld(Number(m.x) || 0, Number(m.y) || 0);
        g.rot = clamp(Number(m.rot) || 0, -2.5, 2.5);
        g.snap = !!m.snap;
        g.snapGrid = clamp(Number(m.grid) || 0.1, PX, 1);
        g.snapStep = clamp(Number(m.step) || Math.PI / 12, Math.PI / 180, Math.PI / 2);
        break;
      case 'drop':
        g.target = inWorld(Number(m.x) || 0, Number(m.y) || 0);
        this.drop(g);
        break;
      case 'power':
        g.power = { kind: m.kind, x: Number(m.x) || 0, y: Number(m.y) || 0, flick: { x: Number(m.fx) || 0, y: Number(m.fy) || 0 } };
        break;
      case 'connect': {
        const a = this.part(m.a);
        if (!a || !(m.kind in CONN_LABEL) || !finite(m.wa)) return;
        // (from one first end to each of several things, as one edit)
        const ends = [{ b: m.b, wb: m.wb }, ...(Array.isArray(m.more) ? m.more.slice(0, 64) : [])].flatMap((t) => {
          const b = t?.b ? this.part(t.b) : null;
          if ((t?.b && !b) || !finite(t?.wb) || (!b && m.kind === 'wire')) return [];
          return [{ b, wb: { x: t.wb.x, y: t.wb.y } }];
        });
        if (!ends.length) return;
        const rest = Number(m.rest);
        const stiffness = Number(m.stiffness);
        history.record(ends.length > 1 ? `${CONN_LABEL[m.kind]} ×${ends.length}` : CONN_LABEL[m.kind]);
        for (const t of ends) {
          game.connections.create(m.kind, a, m.wa, t.b, t.wb, m.rest !== undefined && Number.isFinite(rest) ? clamp(rest, 0.02, 40) : undefined, undefined,
            Number.isFinite(stiffness) && stiffness > 0 ? clamp(stiffness, 0.05, 20) : undefined, connOpts(m.opts));
        }
        game.sound.place(ends[0].wb.x, m.kind === 'rope' || m.kind === 'wire' || m.kind === 'fuse' ? 'wood' : 'metal');
        break;
      }
      case 'editConn': {
        const k = this.conn(m.conn);
        const patch = connPatch(m.patch);
        if (!k || !patch) return;
        history.record('Connection settings', { coalesce: `conn:${k.id}:${Object.keys(patch).join()}` });
        game.connections.setOpts(k, patch);
        break;
      }
      case 'moveEnd': {
        const k = this.conn(m.conn);
        const to = m.p ? this.part(m.p) : null;
        if (!k || (m.end !== 'a' && m.end !== 'b') || (m.p && !to) || !finite(m.w)) return;
        // (a wire's ends are on things; an end can't go on the part at the other end)
        const other = m.end === 'a' ? k.b : k.a;
        if ((!to && k.kind === 'wire') || (to && to === other)) return;
        history.record(`Move ${CONN_LABEL[k.kind].toLowerCase()} end`);
        if (game.connections.moveEnd(k, m.end, to, { x: m.w.x, y: m.w.y })) game.sound.place(m.w.x, RIGID_KINDS.has(k.kind) ? 'metal' : 'wood');
        break;
      }
      case 'setRest': {
        const k = this.conn(m.conn);
        const len = Number(m.len);
        if (!k || !Number.isFinite(len) || (k.kind !== 'rope' && k.kind !== 'spring' && k.kind !== 'fuse')) return;
        history.record('Length', { coalesce: `rest:${k.id}` });
        game.connections.setRest(k, clamp(len, 0.02, 40));
        break;
      }
      case 'layer':
        if (['front', 'back', 'up', 'down'].includes(m.dir)) c.arrange.layer(this.entities(m.ids), m.dir as LayerDir);
        break;
      case 'setAngle': {
        const deg = Number(m.angle);
        if (Number.isFinite(deg)) c.arrange.setAngle(this.entities(m.ids), ((deg % 360) + 360) % 360);
        break;
      }
      case 'arrange':
        if (ARRANGE.some(([how]) => how === m.how)) c.arrange.arrange(this.entities(m.ids), m.how as ArrangeHow);
        break;
      case 'nudge': {
        const dx = clamp(Number(m.dx) || 0, -1, 1);
        const dy = clamp(Number(m.dy) || 0, -1, 1);
        if (game.paused && (dx || dy)) c.arrange.nudge(this.entities(m.ids), dx, dy);
        break;
      }
      case 'rewind':
        c.rewind();
        break;
      case 'unconnect': {
        const list = (m.conns ?? []).map((id) => this.conn(id)).filter((k): k is Connection => !!k);
        if (!list.length) return;
        history.record('Remove connections');
        for (const k of list) game.connections.remove(k);
        game.sound.snap(list[0].a.x);
        break;
      }
      case 'lightAt': game.connections.lightAt(m.x, m.y, clamp(Number(m.r) || 0, 0, 2)); break;
      case 'light': {
        const k = this.conn(m.conn);
        if (k) game.connections.light(k, m.end ? 1 : 0);
        break;
      }
      case 'limit': {
        const k = this.conn(m.conn);
        if (!k) return;
        history.record(m.rad === null ? 'Free hinge' : 'Limit hinge');
        game.connections.setLimit(k, m.rad);
        break;
      }
      case 'stiffness': {
        const k = this.conn(m.conn);
        if (!k) return;
        history.record('Spring stiffness');
        game.connections.setStiffness(k, Number(m.k) || 1);
        break;
      }
      case 'fight': {
        const a = this.entity(m.a);
        const b = this.entity(m.b);
        if (a && b && isFighter(a)) a.fight(b);
        break;
      }
      case 'edit': case 'editReset': {
        const e = this.entity(m.id);
        const ed = e ? (e as Entity & { editor?(): ValueEditor | null }).editor?.() ?? null : null;
        if (!ed) return;
        if (m.op === 'editReset') ed.reset();
        else ed.fields.find((f) => f.key === m.key)?.set(clamp(Number(m.v) || 0, -1e9, 1e9));
        break;
      }
      case 'act': {
        const e = this.entity(m.id);
        // (the part the guest clicked, if any: some entries act on it)
        const p = e && typeof m.part === 'number' ? e.parts[m.part] : undefined;
        const act = e?.contextActions(p && !p.destroyed ? p : undefined).find((a) => a.label === m.path?.[0]);
        if (act && !act.disabled) act.action();
        break;
      }
      case 'time':
        if (m.step) c.step();
        if (typeof m.paused === 'boolean' && m.paused !== game.paused) c.togglePause();
        if (typeof m.scale === 'number' && m.scale > 0) c.setTimeScale(clamp(m.scale, 0.05, 4));
        break;
      case 'clear':
        c.clearScene('Clear all');
        this.tell(`${g.name} cleared everything`);
        break;
      case 'load':
        c.loadScene(String(m.save), 'Load');
        this.tell(`${g.name} loaded a scene`);
        break;
      case 'map': {
        const spec = validateMap(m.map);
        if (!spec) return;
        c.switchMap(spec);
        this.tell(`${g.name} switched to ${spec.name}`);
        break;
      }
      case 'terrain': {
        const spec = validateMap(m.map);
        const cur = game.map;
        // (only the ground: the same size and look, or it would be a switch of maps)
        if (!spec || spec.width !== cur.width || spec.height !== cur.height || spec.theme !== cur.theme || sameMap(spec, cur)) return;
        c.reshapeMap(spec);
        break;
      }
    }
  }

  /** Remembers what a guest spawned (for Z), frozen or switched on if Z or F was held. */
  private spawned(g: Guest, list: Entity[], frozen: boolean, active: boolean): void {
    if (!list.length) return;
    g.creations.push(list);
    if (g.creations.length > 200) g.creations.shift();
    for (const e of list) {
      if (frozen) e.setFrozen(true);
      if (active && e.activatable && !e.destroyed) e.activate();
    }
  }

  private drop(g: Guest): void {
    const h = g.grab;
    g.grab = null;
    if (!h) return;
    releaseGrab(this.game, h, g.target);
    // moved with time paused: its joints to what stayed are made again where it is now
    if (this.game.paused && h.moved && g.moveList) this.controls.arrange.settle(g.moveList.filter((e) => !e.destroyed));
    g.moveList = null;
  }

  /** Each physics step: the guests' drags and powers. */
  private stepGuests(dt: number): void {
    for (const g of this.guests.values()) {
      g.powers.step(g.power.kind, g.power.x, g.power.y, g.power.flick, dt);
      const h = g.grab;
      if (!h) continue;
      if (h.part.destroyed) {
        this.drop(g);
        continue;
      }
      if (!stepGrab(h, g.target, g.rot, dt, () => this.controls.history.record('Move'))) {
        releaseGrab(this.game, h, g.target);
        g.grab = beginGrab(this.game, h.part, g.target.x, g.target.y);
        grabAlong(this.game, g.grab, g.grabList);
      }
    }
  }

  /** With time paused, what guests hold goes straight where they put it. */
  private dragPaused(dt: number): void {
    for (const g of this.guests.values()) {
      const h = g.grab;
      if (!h || h.part.destroyed) continue;
      // (what's held, the rest of their selection, and with them everything joined to them, unless taken with Ctrl)
      if (!g.moveList) {
        const base = g.grabList.filter((e) => !e.destroyed);
        if (!base.includes(h.part.entity)) base.push(h.part.entity);
        g.moveList = this.controls.arrange.moving(base, g.alone);
      }
      const list = g.moveList.filter((e) => !e.destroyed);
      const snap = { grid: g.snap, gridSize: g.snapGrid, angleStep: g.snapStep, guides: false, zoom: 0 };
      dragPaused(h, list, g.target, g.rot, snap, dt, () => this.controls.history.record('Move'));
    }
  }

  /** Something a guest drags into a person's free hand is taken out of theirs. */
  private offerHeld(): void {
    for (const g of this.guests.values()) {
      const h = g.grab;
      if (!h || h.frozenMove || h.part.destroyed) continue;
      if (h.part.entity.offer(g.target)) this.drop(g);
    }
  }
}

/** A point sent by a guest is two finite numbers. */
function finite(v: unknown): v is V2 {
  const p = v as V2 | null;
  return !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
}

/** A guest's connection settings, only as far as they make sense (see ConnOpts). */
function connPatch(v: unknown): Partial<Record<keyof ConnOpts, unknown>> | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const out: Partial<Record<keyof ConnOpts, unknown>> = {};
  if ('hidden' in o) out.hidden = o.hidden === true ? true : undefined;
  if ('collide' in o) out.collide = o.collide === true ? true : undefined;
  if ('strength' in o) out.strength = o.strength === 'weak' || o.strength === 'unbreakable' ? o.strength : undefined;
  if ('damping' in o) {
    const d = Number(o.damping);
    out.damping = o.damping !== undefined && o.damping !== null && Number.isFinite(d) ? clamp(d, 0.1, 10) : undefined;
  }
  return Object.keys(out).length ? out : null;
}

/** A new connection's settings from a guest (see connPatch()). */
function connOpts(v: unknown): ConnOpts | undefined {
  const p = connPatch(v);
  if (!p) return undefined;
  for (const k of Object.keys(p) as (keyof ConnOpts)[]) if (p[k] === undefined) delete p[k];
  return Object.keys(p).length ? (p as ConnOpts) : undefined;
}

/** The host's game as a multiplayer role (see Game.net): it simulates as usual. */
export const HOST_ROLE = { guest: false, pose: () => {} } as const;

