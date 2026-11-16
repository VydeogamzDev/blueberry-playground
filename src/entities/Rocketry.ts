import { RAPIER } from '../engine/Physics';
import { PX } from '../engine/constants';
import { clamp, type V2 } from '../engine/math';
import { Prop, type PropConfig } from './Prop';
import { Machine } from './Machine';
import { Thruster, toggleRun, type HandSwitched } from './Machines';
import { Human } from './Human';
import { PK } from '../systems/Particles';
import { Liquid } from '../systems/Liquids';
import type { FuelStore } from '../systems/Fuel';
import { engineLevel, isEngine, type Commanded, type PilotCommand, type Swiveller } from '../systems/Piloting';
import { getItem } from '../catalog/items';
import { MAT } from '../world/Materials';
import * as R from '../art/rocketry';
import type { Entity } from '../world/Entity';
import type { Part } from '../world/Part';
import type { Game } from '../world/Game';
import type { Connection } from '../systems/Connections';
import type { BulletHit, ContextAction, ItemDef, SpawnOptions } from '../world/types';

// The rocketry parts (0.4.0): fuel tanks, the decoupler, parachutes, landing legs and
// gear, solid boosters, small turning thrusters, swivelling thrusters, the heat shield,
// control flaps, the launch clamp and the docking port. They work with what's flown
// (see systems/Piloting: staging, the gear and chute keys, swivelling to turn) and
// with fuel (see systems/Fuel).

const num = (v: unknown, lo: number, hi: number, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : d);

// ------------------------------------------------------------------ fuel tank

/** How fast (kg/s) fuel runs out of each hole in a tank, and the most holes counted. */
const LEAK = 0.6;
const MOST_HOLES = 8;
/** A tank burning this long (s) with fuel in it goes up; and as hot as this (°C) it cooks off at once. */
const COOK_T = 2.5;
const COOK_TEMP = 380;

/**
 * A fuel tank: the engines built into the same build draw on it (see systems/Fuel),
 * and it gets lighter as it empties. Shot, it leaks through each hole, and may catch;
 * burning a while, or broken open with fuel in it, it goes up, the harder the fuller.
 */
export class FuelTank extends Prop implements FuelStore {
  fuel: number;
  readonly capacity: number;
  /** Where it's been holed (art pixels): fuel runs out of each. */
  holes: [number, number][] = [];
  private load = -1;
  private burnT = 0;
  private dripT = 0;
  private blown = false;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, capacity: number, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, x, y, opts);
    this.capacity = capacity;
    this.fuel = capacity;
    this.activatable = false;
    this.weigh(true);
  }

  take(kg: number): number {
    const t = Math.min(this.fuel, Math.max(0, kg));
    if (t <= 0) return 0;
    this.fuel -= t;
    this.weigh();
    return t;
  }

  fill(kg: number): number {
    const t = Math.min(this.capacity - this.fuel, Math.max(0, kg));
    if (t <= 0) return 0;
    this.fuel += t;
    this.weigh();
    return t;
  }

  /** Weighs it down with the fuel in it (low in it: it settles), when that's changed by a fair bit. */
  private weigh(force = false): void {
    const m = this.fuel;
    if (!force && Math.abs(m - this.load) < this.capacity * 0.01 && (m > 0 || this.load === 0)) return;
    this.load = m;
    const p = this.main;
    if (p.destroyed) return;
    const w = p.w * PX;
    const h = p.h * PX;
    const f = m / this.capacity;
    p.body.setAdditionalMassProperties(m, { x: 0, y: -h * 0.5 * (1 - f) }, (m * (w * w + h * h * f * f)) / 12, true);
    p.aeroFresh = false;
  }

  onBullet(hit: BulletHit): void {
    if (this.fuel > 0 && this.holes.length < MOST_HOLES) {
      const q = this.main.worldToPixel(hit.point.x, hit.point.y);
      this.holes.push([clamp(q.ix, 0, this.main.w - 1), clamp(q.iy, 0, this.main.h - 1)]);
      // (a round through fuel vapour: now and then it catches)
      if (Math.random() < 0.18) this.game.fire.ignite(this.main, 0.5);
    }
    super.onBullet(hit);
  }

  preStep(dt: number): void {
    super.preStep(dt);
    const p = this.main;
    if (this.destroyed || p.destroyed) return;
    // leaking out of its holes, onto the floor (it burns: see Fire)
    if (this.holes.length && this.fuel > 0) {
      this.take(LEAK * this.holes.length * dt);
      this.dripT -= dt;
      if (this.dripT <= 0) {
        this.dripT = 0.06;
        const [ix, iy] = this.holes[Math.floor(Math.random() * this.holes.length)];
        const w = p.pixelToWorld(ix, iy);
        const out = { x: w.x - p.x, y: w.y - p.y };
        const d = Math.hypot(out.x, out.y) || 1;
        this.game.particles.liquid(Liquid.Oil, w.x, w.y, out.x / d, out.y / d, 1, 1.2, 0.4, p.body);
      }
    }
    // burning with fuel in it: it goes up in a moment; hot enough, at once
    const full = this.fuel > this.capacity * 0.03;
    if (full && p.burning > 0.2) this.burnT += dt;
    else this.burnT = Math.max(0, this.burnT - dt);
    if (full && (this.burnT > COOK_T || p.temp > COOK_TEMP)) this.shatter();
  }

  /** Broken open with fuel in it, it goes up: the fuller, the bigger. */
  shatter(point?: V2): void {
    if (this.shattered) return;
    const c = { x: this.main.x, y: this.main.y };
    const f = this.fuel;
    super.shatter(point);
    if (f > this.capacity * 0.02 && !this.blown) {
      this.blown = true;
      const k = Math.sqrt(f / 100);
      this.game.explosions.explode(c.x, c.y, { power: 60 + 110 * k, radius: 3 + 3 * k, damage: 120 + 160 * k, incendiary: true, source: this });
    }
  }

  contextActions(): ContextAction[] {
    const pct = Math.round((this.fuel / this.capacity) * 100);
    return [
      { label: `Fuel: ${pct}% (${Math.round(this.fuel)} of ${this.capacity} kg)`, disabled: true, action: () => {} },
      { label: 'Fill up', action: () => this.fill(this.capacity) },
      { label: 'Empty', action: () => this.take(this.fuel) },
      ...(this.holes.length ? [{ label: `Patch ${this.holes.length === 1 ? 'the hole' : `${this.holes.length} holes`}`, action: () => (this.holes = []) }] : []),
    ];
  }

  protected serializeExtra(): Record<string, unknown> {
    return { fuel: this.fuel, holes: this.holes };
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    this.fuel = num(x.fuel, 0, this.capacity, this.capacity);
    this.holes = Array.isArray(x.holes)
      ? x.holes.slice(0, MOST_HOLES).filter((h): h is [number, number] => Array.isArray(h) && h.length === 2 && h.every((v) => typeof v === 'number' && Number.isFinite(v)))
      : [];
    this.weigh(true);
  }
}

// ------------------------------------------------------------------ decoupler

/** How hard (m/s apart) a decoupler throws its halves. */
const DECOUPLE_KICK = 2.5;

/** Every part of these, pushed `dv` m/s along `d` (each by its own mass: no spin). */
function kickAll(ents: readonly Entity[], d: V2, dv: number): void {
  for (const e of ents) {
    if (e.destroyed) continue;
    for (const p of e.parts) {
      if (p.destroyed || p.frozen) continue;
      p.body.applyImpulse({ x: d.x * dv * p.mass, y: d.y * dv * p.mass }, true);
    }
  }
}

function massOf(ents: readonly Entity[]): number {
  let m = 0;
  for (const e of ents) if (!e.destroyed) for (const p of e.parts) if (!p.destroyed) m += p.mass;
  return m;
}

/**
 * A decoupler: built between a rocket's stages, fuel doesn't pass it (each stage burns
 * its own: see systems/Fuel), and fired (its stage, F, a pulse) it lets go of what's
 * fixed to its top side and throws the halves apart. It stays on the stage below.
 */
export class Decoupler extends Prop {
  readonly fuelWall = true;
  /** It's a decoupler (see Piloting.autoStage()). */
  readonly decoupler = true;
  fired = false;
  /** Power came on to it (a switch, a lever wired to it): it fires at the next step, not inside the wiring's working out. */
  private toFire = false;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, x, y, opts);
    this.activatable = true;
  }

  get stageable(): boolean {
    return true;
  }

  activate(): void {
    if (!this.fired) this.release();
  }

  setPowered(on: boolean): void {
    const was = this.poweredIn;
    super.setPowered(on);
    if (on && !was && !this.fired) this.toFire = true;
  }

  preStep(dt = 0): void {
    super.preStep(dt);
    if (this.toFire) {
      this.toFire = false;
      this.release();
    }
  }

  /** Lets go of everything fixed to its top side (and the wires across it), and throws the halves apart. */
  release(): void {
    if (this.fired || this.destroyed) return;
    this.fired = true;
    const g = this.game;
    const me = this.main;
    const up = me.localDir(0, 1);
    const tops = new Set<Entity>();
    for (const c of [...g.connections.connectionsOf(this)]) {
      const other = c.a.entity === this ? c.b : c.a;
      if (!other) continue;
      const q = me.worldToLocal(other.x, other.y);
      if (q.y <= 0) continue;
      g.connections.remove(c);
      tops.add(other.entity);
    }
    g.fuel.clear();
    const top = g.connections.assemblyOf([...tops]).filter((e) => e !== this);
    const bottom = g.connections.assemblyOf([this]);
    if (top.length && !top.some((e) => bottom.includes(e))) {
      const mt = massOf(top);
      const mb = massOf(bottom);
      const j = DECOUPLE_KICK * Math.min(mt, mb);
      kickAll(top, up, j / Math.max(1, mt));
      kickAll(bottom, up, -j / Math.max(1, mb));
    }
    const w = me.pixelToWorld(me.w / 2, 0);
    for (let i = 0; i < 10; i++) {
      const s = (i / 9 - 0.5) * 2;
      const d = me.localDir(s, 0.2);
      g.particles.emit(PK.Smoke, w.x, w.y, { vx: d.x * 3, vy: d.y * 3, life: 0.8, size: 0.25, size1: 0.6, color: 0xd8d8d8, color1: 0xa0a0a0, alpha: 0.7, alpha1: 0, gravity: 0, drag: 3 });
    }
    g.sound.play('explosion/small', { gain: 0.35, x: me.x, vary: 0.1 });
    g.sound.play('machine/air_release', { gain: 0.6, x: me.x });
  }

  contextActions(): ContextAction[] {
    return this.fired
      ? [{ label: 'Re-arm (weld it on again first)', action: () => (this.fired = false) }]
      : [{ label: 'Let go', hint: 'F', action: () => this.activate() }];
  }

  protected serializeExtra(): Record<string, unknown> {
    return { fired: this.fired };
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    this.fired = !!x.fired;
  }
}

// ------------------------------------------------------------------ parachutes

/** A canopy's drag area (m², for its drag coefficient), how long (s) it takes to open, and the pull (N) that tears it. */
export const CHUTE = {
  small: { area: 16, open: 0.9, tear: 16000, rope: 3.2 },
  big: { area: 48, open: 1.4, tear: 90000, rope: 5 },
};
/** A worn pack opens itself falling faster than this (m/s), this high (m) over the ground. */
const AUTO_SPEED = 12;
const AUTO_HEIGHT = 25;
/** A canopy cut away (or with nothing on it) is gone after this long (s). */
const CUT_LAST = 25;

/**
 * An open parachute's canopy (made by its pack: see Parachute): it pulls against the air
 * as ½ρv²·area, opening over a second (less of a jolt), and if the pull ever passes what
 * it bears (opened too fast), it tears and hardly holds any more.
 */
export class Canopy extends Prop {
  readonly big: boolean;
  /** How far open (0 to 1). */
  inflate = 0;
  torn = false;
  /** Cut away (or let go of): it drifts off and is gone in a while. */
  cut = false;
  private cutT = 0;
  private carriedAt = -Infinity;
  private carriedKg = 0;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, big: boolean, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, x, y, opts);
    this.big = big;
    // (it makes its own drag: see preStep())
    this.dragShare = 0.05;
  }

  get spec() {
    return this.big ? CHUTE.big : CHUTE.small;
  }

  /** What it holds up (kg): itself and what it's tied to. */
  private carried(): number {
    const g = this.game;
    if (g.time - this.carriedAt > 0.5 || g.time < this.carriedAt) {
      this.carriedAt = g.time;
      this.carriedKg = massOf(g.connections.assemblyOf([this]));
    }
    return this.carriedKg;
  }

  preStep(dt: number): void {
    super.preStep(dt);
    const p = this.main;
    if (this.destroyed || p.destroyed) return;
    const g = this.game;
    if (this.cut) {
      this.cutT += dt;
      if (this.cutT > CUT_LAST) g.remove(this);
    }
    const s = this.spec;
    const vx = p.vx;
    const vy = p.vy;
    const v = Math.hypot(vx, vy);
    // (it fills the faster the faster the air: opened falling fast, it snaps open, and may tear)
    this.inflate = Math.min(1, this.inflate + dt / (s.open * clamp(18 / Math.max(v, 1e-3), 0.12, 1)));
    if (v < 0.3) return;
    const rho = g.air.densityAt(p.y);
    if (rho <= 1e-6) return;
    const area = s.area * this.inflate * this.inflate * (this.torn ? 0.12 : this.cut ? 0.25 : 1);
    let f = 0.5 * rho * v * v * area;
    if (!this.torn && !this.cut && f > s.tear) this.tear();
    // (never more in a step than stops it and what it holds)
    f = Math.min(f, (0.9 * this.carried() * v) / dt);
    p.body.applyImpulse({ x: (-vx / v) * f * dt, y: (-vy / v) * f * dt }, true);
    // (it hangs dome up: a little turn toward its pull)
    const up = p.localDir(0, 1);
    const want = { x: -vx / v, y: -vy / v };
    const cross = up.x * want.y - up.y * want.x;
    p.body.applyTorqueImpulse((cross * 6 - p.av * 1.5) * p.mass * dt, true);
  }

  /** Opened too fast: it tears (and hardly holds). */
  tear(): void {
    if (this.torn) return;
    this.torn = true;
    const p = this.main;
    const g = this.game;
    g.sound.play('machine/rope_snap', { gain: 0.8, x: p.x });
    for (let i = 0; i < 14; i++) {
      const w = p.pixelToWorld(Math.random() * p.w, Math.random() * p.h * 0.6);
      g.particles.emit(PK.Debris, w.x, w.y, { vx: (Math.random() - 0.5) * 4, vy: Math.random() * 3, life: 1.2, size: 0.06, color: 0xff8a2a, gravity: 0.6, drag: 2 });
    }
    // (holes through it)
    for (let i = 0; i < 9; i++) {
      const cx = Math.floor(Math.random() * p.w);
      const cy = Math.floor(Math.random() * p.h * 0.7);
      for (let j = -2; j <= 2; j++) for (let k = -1; k <= 1; k++) if (p.solidAt(cx + j, cy + k)) p.paintPixel(cx + j, cy + k, 0x000000, 0.75);
    }
  }

  protected serializeExtra(): Record<string, unknown> {
    return { inflate: this.inflate, torn: this.torn, cut: this.cut };
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    this.inflate = num(x.inflate, 0, 1, 1);
    this.cut = !!x.cut;
    if (x.torn) this.tear();
  }
}

/**
 * A parachute pack: opened (F, a pulse, its stage, the pilot's chute key), its canopy
 * comes out on its lines and pulls against the air (see Canopy); opened again, it's cut
 * away. The worn one (dropped onto someone, it straps onto their back) opens itself if
 * they're falling fast and high (see AUTO_SPEED).
 */
export class Parachute extends Prop implements Commanded {
  readonly big: boolean;
  readonly worn: boolean;
  state: 'packed' | 'open' | 'spent' = 'packed';
  canopy: Canopy | null = null;
  /** Opens itself, falling fast and high (the worn one's always on; a rocket's, if set). */
  auto: boolean;
  private lines: Connection | null = null;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, big: boolean, worn: boolean, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, x, y, opts);
    this.big = big;
    this.worn = worn;
    this.auto = worn;
    this.activatable = true;
  }

  get stageable(): boolean {
    return true;
  }

  activate(): void {
    if (this.state === 'packed') this.open();
    else if (this.state === 'open') this.cutAway();
  }

  pilotCommand(cmd: PilotCommand): boolean {
    if (cmd !== 'chutes') return false;
    if (this.state === 'packed') this.open();
    else if (this.state === 'open') this.cutAway();
    else return false;
    return true;
  }

  /** Who wears it, if anyone (strapped to their chest by a weld). */
  get wearer(): Human | null {
    if (!this.worn) return null;
    for (const c of this.game.connections.connectionsOf(this)) {
      const o = c.a.entity === this ? c.b?.entity : c.a.entity;
      if (o instanceof Human && !o.destroyed) return o;
    }
    return null;
  }

  /** Let go of over someone: it straps onto their back (see wearOn()). */
  onGrab(part: Part, held: boolean, at?: V2): void {
    super.onGrab(part, held, at);
    if (held || !this.worn || this.wearer) return;
    const p = this.main;
    for (const e of this.game.entities) {
      if (!(e instanceof Human) || e.destroyed) continue;
      const chest = e.limbs.get('upperTorso')?.part;
      if (!chest || chest.destroyed || Math.hypot(chest.x - p.x, chest.y - p.y) > 0.45) continue;
      wearOn(this, e);
      return;
    }
  }

  open(): void {
    if (this.state !== 'packed' || this.destroyed) return;
    const g = this.game;
    const def = getItem(this.big ? 'parachute-canopy-big' : 'parachute-canopy');
    if (!def) return;
    const p = this.main;
    // out above it (or behind it, against the way it's falling)
    const v = Math.hypot(p.vx, p.vy);
    const away = v > 3 ? { x: -p.vx / v, y: -p.vy / v } : p.localDir(0, 1);
    const s = this.big ? CHUTE.big : CHUTE.small;
    const top = p.pixelToWorld(p.w / 2, 0);
    const at = { x: top.x + away.x * 1.2, y: top.y + away.y * 1.2 };
    const c = g.spawn(def, at.x, at.y, { angle: Math.atan2(away.y, away.x) - Math.PI / 2 }) as Canopy | null;
    if (!c) return;
    for (const q of c.parts) {
      q.body.setLinvel({ x: p.vx, y: p.vy }, true);
    }
    const bottom = c.main.pixelToWorld(c.main.w / 2, c.main.h - 1);
    const lines = g.connections.create('rope', p, top, c.main, bottom, s.rope);
    if (lines) lines.breakAt = Infinity;
    this.lines = lines;
    this.canopy = c;
    this.state = 'open';
    this.staged = true;
    g.sound.play('machine/air_release', { gain: 0.7, x: p.x, vary: 0.1 });
  }

  /** Cuts the canopy away (it drifts off). */
  cutAway(): void {
    if (this.state !== 'open') return;
    const c = this.canopy;
    if (this.lines && this.game.connections.list.includes(this.lines)) this.game.connections.remove(this.lines);
    this.lines = null;
    if (c && !c.destroyed) c.cut = true;
    this.canopy = null;
    this.state = 'spent';
    this.game.sound.click(this.main.x, 1.3);
  }

  /** Packed again (its canopy taken back in). */
  repack(): void {
    const c = this.canopy;
    if (this.lines && this.game.connections.list.includes(this.lines)) this.game.connections.remove(this.lines);
    if (c && !c.destroyed) this.game.remove(c);
    this.lines = null;
    this.canopy = null;
    this.state = 'packed';
    this.staged = false;
  }

  preStep(dt: number): void {
    super.preStep(dt);
    const p = this.main;
    if (this.destroyed || p.destroyed) return;
    // (its canopy shot away or burnt: spent)
    if (this.state === 'open' && (!this.canopy || this.canopy.destroyed)) {
      this.canopy = null;
      this.state = 'spent';
    }
    if (this.state === 'packed' && this.auto && p.vy < -AUTO_SPEED && !p.frozen) {
      const h = p.y - this.game.env.groundAt(p.x, p.y);
      if (h > AUTO_HEIGHT) this.open();
    }
  }

  protected onDestroy(): void {
    const c = this.canopy;
    if (c && !c.destroyed) c.cut = true;
    super.onDestroy();
  }

  contextActions(): ContextAction[] {
    const acts: ContextAction[] = [];
    if (this.state === 'packed') acts.push({ label: 'Open', hint: 'F', action: () => this.open() });
    if (this.state === 'open') acts.push({ label: 'Cut away', hint: 'F', action: () => this.cutAway() });
    if (this.state !== 'packed') acts.push({ label: 'Repack', action: () => this.repack() });
    if (!this.worn) acts.push({ label: 'Opens itself falling fast', checked: this.auto, action: () => (this.auto = !this.auto) });
    if (this.worn && this.wearer) acts.push({ label: 'Take it off', action: () => takeOff(this) });
    return acts;
  }

  protected serializeExtra(): Record<string, unknown> {
    return { state: this.state, auto: this.auto };
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    if (x.state === 'packed' || x.state === 'open' || x.state === 'spent') this.state = x.state;
    if (typeof x.auto === 'boolean') this.auto = x.auto;
  }

  serializeLinks(ref: (e: Entity) => number): Record<string, unknown> | undefined {
    const c = this.canopy;
    return c && !c.destroyed ? { canopy: ref(c) } : undefined;
  }

  restoreLinks(links: Record<string, unknown>, get: (i: number) => Entity | undefined): void {
    const c = get(links.canopy as number);
    if (c instanceof Canopy && !c.destroyed) {
      this.canopy = c;
      this.lines = this.game.connections.connectionsOf(this).find((k) => k.kind === 'rope' && (k.a.entity === c || k.b?.entity === c)) ?? null;
      if (this.lines) this.lines.breakAt = Infinity;
    } else if (this.state === 'open') this.state = 'spent';
  }
}

/** Something worn (a parachute pack, a helmet, an oxygen tank): where on them it goes. */
type WornAt = 'back' | 'head';

/** Straps something onto a person: onto their back (or head), held by a weld. */
export function wearOn(thing: Prop, h: Human, at: WornAt = 'back'): boolean {
  const limb = h.limbs.get(at === 'head' ? 'head' : 'upperTorso');
  const q = limb?.part;
  if (!q || q.destroyed || limb.gone) return false;
  const p = thing.main;
  // (on their back: behind them, the way they face; a helmet over their head)
  const face = q.flip;
  const pos = at === 'head' ? q.localToWorld(0, 0.02) : q.localToWorld(-face * (q.w * PX * 0.5 + p.w * PX * 0.3), 0);
  p.teleport(pos.x, pos.y, q.bodyAngle);
  p.body.setLinvel(q.body.linvel(), true);
  const c = thing.game.connections.create('weld', p, pos, q, pos);
  if (!c) return false;
  p.noCollideWith(q);
  q.noCollideWith(p);
  for (const o of h.parts) if (!o.destroyed) {
    p.noCollideWith(o);
    o.noCollideWith(p);
  }
  thing.game.sound.play('machine/car_door', { gain: 0.15, x: p.x, vary: 0.1 });
  // (who has air of their own is looked at afresh)
  thing.game.oxygen.clear();
  return true;
}

/** Takes off something worn. */
export function takeOff(thing: Prop): void {
  for (const c of [...thing.game.connections.connectionsOf(thing)]) {
    const o = c.a.entity === thing ? c.b?.entity : c.a.entity;
    if (o instanceof Human) thing.game.connections.remove(c);
  }
  thing.game.oxygen.clear();
}

// ------------------------------------------------------------------ landing legs and gear

/** The angles (degrees, up positive) a leg folds up to and swings down to; a gear's. */
const LEG_ANGLES = { leg: { up: 82, down: -58 }, gear: { up: 0, down: -90 } };

/**
 * A landing leg (or, `wheel`, landing gear): a mount to weld on and a strut that swings
 * down (deployed) or folds up along the build. Its swing is sprung and damped: a shock
 * absorber, so a landing doesn't bounce the build off it. The pilot's gear key, F, its
 * stage or a pulse folds or deploys it; it starts out down.
 */
export class LandingLeg extends Machine implements HandSwitched, Commanded {
  readonly mount: Part;
  readonly strut: Part;
  readonly wheel: Part | null;
  on = true;
  heldOff = false;
  private joint: RAPIER.RevoluteImpulseJoint;
  private applied = '';
  private readonly torque: number;
  private readonly angles: { up: number; down: number };
  private apartFrom = new Set<Part>();
  private apartAt = -Infinity;

  constructor(game: Game, def: ItemDef, wheel: boolean, torque: number, x: number, y: number, opts: SpawnOptions) {
    super(game, def, opts.flip ?? false);
    this.activatable = true;
    this.usesPower = true;
    this.attachIgnoresBody = true;
    this.torque = torque;
    this.angles = wheel ? LEG_ANGLES.gear : LEG_ANGLES.leg;
    const ang = opts.angle ?? 0;
    this.mount = this.addPart({ name: 'Mount', art: R.legMountArt(), material: MAT.metal, x, y, angle: ang, density: 160, textureKey: 'leg-mount', layer: 1 });
    const art = R.legStrutArt(wheel);
    const f = this.mount.flip;
    const pivot = this.mount.pixelToWorld(4, 4);
    // the strut, swung down: its root at the mount's middle
    const down = ((this.angles.down * Math.PI) / 180) * f + ang;
    const half = ((art.w / 2 - 2) * PX);
    const sx = pivot.x + Math.cos(down) * half * f;
    const sy = pivot.y + Math.sin(down) * half * f;
    this.strut = this.addPart({ name: 'Strut', art, material: MAT.metal, x: sx, y: sy, angle: down, density: 70, textureKey: `leg-strut:${wheel}`, layer: 0, friction: 1.1 });
    const data = RAPIER.JointData.revolute(this.mount.pixelToLocal(4, 4), this.strut.pixelToLocal(2, 2));
    this.joint = this.addJoint(data, this.mount, this.strut) as RAPIER.RevoluteImpulseJoint;
    this.joint.configureMotorModel(RAPIER.MotorModel.ForceBased);
    this.joint.setMotorMaxForce(torque * 3);
    if (wheel) {
      const foot = this.strut.pixelToWorld(art.w - 2, 2);
      this.wheel = this.addPart({ name: 'Wheel', art: R.gearWheelArt(), material: MAT.rubber, x: foot.x, y: foot.y, shapes: [{ kind: 'ball', r: 6 }], density: 60, textureKey: 'gear-wheel', layer: 2, friction: 1.2 });
      const wj = RAPIER.JointData.revolute(this.strut.pixelToLocal(art.w - 2, 2), { x: 0, y: 0 });
      this.addJoint(wj, this.strut, this.wheel);
    } else this.wheel = null;
    this.apply();
    this.sturdy();
  }

  get main(): Part {
    return this.mount;
  }

  /** Swung down. */
  get deployed(): boolean {
    return (this.on || this.powered) && !this.heldOff;
  }

  private target(): number {
    return ((this.deployed ? this.angles.down : this.angles.up) * Math.PI * this.mount.flip) / 180;
  }

  private apply(): void {
    const sig = `${this.deployed}`;
    if (sig === this.applied || !this.joint.isValid()) return;
    this.applied = sig;
    // (sprung and damped: a shock absorber)
    this.joint.configureMotorPosition(this.target(), this.torque * 6, this.torque * 0.9);
    this.mount.body.wakeUp();
    this.strut.body.wakeUp();
  }

  get stageable(): boolean {
    return true;
  }

  fireStage(): void {
    this.staged = true;
    this.activate();
  }

  activate(): void {
    toggleRun(this, this.deployed, this.powered);
    this.game.sound.play('machine/turret_loop', { gain: 0.15, x: this.mount.x, vary: 0.1 });
    this.apply();
  }

  pilotCommand(cmd: PilotCommand): boolean {
    if (cmd !== 'gear') return false;
    this.activate();
    return true;
  }

  setPowered(on: boolean): void {
    super.setPowered(on);
    if (!on) this.heldOff = false;
    this.apply();
  }

  canRest(): boolean {
    return true;
  }

  preStep(dt: number): void {
    super.preStep(dt);
    if (this.heldOff && !this.powered) this.heldOff = false;
    this.apply();
    // (folded up along the build it's on, the strut doesn't knock against it)
    const g = this.game;
    if (g.time - this.apartAt > 1 || g.time < this.apartAt) {
      this.apartAt = g.time;
      for (const e of g.connections.builtWith(this)) {
        if (e === this) continue;
        for (const q of e.parts) {
          if (q.destroyed || this.apartFrom.has(q)) continue;
          this.apartFrom.add(q);
          for (const own of [this.strut, this.wheel]) if (own && !own.destroyed) {
            own.noCollideWith(q);
            q.noCollideWith(own);
          }
        }
      }
    }
  }

  contextActions(): ContextAction[] {
    return [{ label: this.deployed ? 'Fold up' : 'Deploy', hint: 'F', action: () => this.activate() }];
  }

  protected serializeExtra(): Record<string, unknown> {
    return { on: this.on, off: this.heldOff };
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    this.on = x.on !== false;
    this.heldOff = !!x.off;
    this.apply();
  }
}

// ------------------------------------------------------------------ thrusters

/**
 * A solid rocket booster: lit (F, a pulse, its stage, or the throttle when flown) it
 * burns at full till its propellant's gone, and nothing puts it out. It carries its own
 * (no tank), getting lighter as it burns.
 */
export class SolidBooster extends Thruster {
  /** Its propellant (kg), and what it held. */
  grain: number;
  readonly full: number;
  ignited = false;
  private load = -1;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, force: number, grain: number, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, force, x, y, opts);
    this.grain = this.full = grain;
    this.nozzlePx = [0, 5];
    this.weigh(true);
  }

  private weigh(force = false): void {
    const m = this.grain;
    if (!force && Math.abs(m - this.load) < this.full * 0.02 && (m > 0 || this.load === 0)) return;
    this.load = m;
    const p = this.main;
    if (p.destroyed) return;
    const w = p.w * PX;
    const h = p.h * PX;
    p.body.setAdditionalMassProperties(m, { x: 0, y: 0 }, (m * (w * w + h * h)) / 12, true);
  }

  get running(): boolean {
    return this.ignited && this.grain > 0 && this.works;
  }

  /** Lit: it burns out (switching it off does nothing). */
  activate(): void {
    if (this.ignited || this.grain <= 0) return;
    this.ignited = true;
    this.on = true;
    this.game.sound.play('explosion/firework_launch', { gain: 0.6, x: this.main.x });
  }

  fireStage(): void {
    this.staged = true;
    this.activate();
  }

  setPowered(on: boolean): void {
    super.setPowered(on);
    if (on) this.activate();
  }

  protected level(): number {
    if (!this.ignited && this.pilotOut !== null && this.pilotOut > 0.05 && (this.stage === 0 || this.staged)) this.activate();
    return this.running ? 1 : 0;
  }

  /** (it carries its own: none from the tanks) */
  burnRate(): number {
    return 0;
  }

  protected fuelFor(kg: number): number {
    if (this.grain <= 0) return 0;
    const got = Math.min(this.grain, kg);
    this.grain -= got;
    this.weigh();
    return kg > 0 ? got / kg : 1;
  }

  protected exhaust(f: V2, s: number): void {
    super.exhaust(f, s);
    // (a solid motor's thick white smoke)
    const p = this.main;
    const n = p.pixelToWorld(this.nozzlePx[0], this.nozzlePx[1]);
    if (Math.random() < 0.7) {
      this.game.particles.emit(PK.Smoke, n.x - f.x * 0.4, n.y - f.y * 0.4, {
        vx: -f.x * 3 + (Math.random() - 0.5), vy: -f.y * 3 + (Math.random() - 0.5), life: 2.5, size: 0.3, size1: 1.2, color: 0xeeeeee, color1: 0xbdbdbd, alpha: 0.8, alpha1: 0, gravity: -0.05, drag: 1.5,
      });
    }
  }

  contextActions(): ContextAction[] {
    const pct = Math.round((this.grain / this.full) * 100);
    return [
      { label: this.ignited ? (this.grain > 0 ? 'Burning (can’t be put out)' : 'Burnt out') : 'Light', hint: 'F', disabled: this.ignited, action: () => this.activate() },
      { label: `Propellant: ${pct}%`, disabled: true, action: () => {} },
      { label: 'Refill (a new booster)', action: () => this.refill() },
    ];
  }

  refill(): void {
    this.grain = this.full;
    this.ignited = false;
    this.on = false;
    this.weigh(true);
  }

  protected serializeExtra(): Record<string, unknown> {
    return { ...super.serializeExtra(), grain: this.grain, lit: this.ignited };
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    super.restoreExtra(x);
    this.grain = num(x.grain, 0, this.full, this.full);
    this.ignited = !!x.lit;
    this.weigh(true);
  }
}

/** A small turning thruster's own gas (kg), and how fast it puffs it (kg/s a newton). */
const RCS_GAS = 4;
const RCS_BURN = 1 / 600;

/**
 * A small turning thruster (cold gas): a little push for turning a craft in space,
 * from a bottle of its own (no tank): no flame, a white puff.
 */
export class RcsThruster extends Thruster {
  gas = RCS_GAS;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, force: number, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, force, x, y, opts);
    this.nozzlePx = [7, 3];
    this.burn = RCS_BURN;
  }

  /** It pushes away from its nozzle (on the right of its art): left. */
  protected thrustDir(s: number): V2 {
    return this.main.localDir(-this.main.flip * s, 0);
  }

  pushDir(): V2 {
    return this.main.localDir(-this.main.flip, 0);
  }

  burnRate(): number {
    return 0;
  }

  protected fuelFor(kg: number): number {
    if (this.gas <= 0) return 0;
    const got = Math.min(this.gas, kg);
    this.gas -= got;
    return kg > 0 ? got / kg : 1;
  }

  protected exhaust(f: V2): void {
    const p = this.main;
    const n = p.pixelToWorld(this.nozzlePx[0], this.nozzlePx[1]);
    const g = this.game;
    g.particles.emit(PK.Smoke, n.x, n.y, {
      vx: -f.x * 6 + (Math.random() - 0.5) * 1.5, vy: -f.y * 6 + (Math.random() - 0.5) * 1.5, life: 0.3, size: 0.06, size1: 0.3, color: 0xffffff, color1: 0xdfe8f0, alpha: 0.8, alpha1: 0, gravity: 0, drag: 4,
    });
    g.sound.hold(this, 'machine/extinguisher_loop', 0.18, p.x, 1.6);
  }

  frame(): void {
    // (cold gas: no flame, no light)
  }

  contextActions(): ContextAction[] {
    return [
      ...super.contextActions(),
      { label: `Gas: ${Math.round((this.gas / RCS_GAS) * 100)}%`, disabled: true, action: () => {} },
      { label: 'Refill gas', action: () => (this.gas = RCS_GAS) },
    ];
  }

  protected serializeExtra(): Record<string, unknown> {
    return { ...super.serializeExtra(), gas: this.gas };
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    super.restoreExtra(x);
    this.gas = num(x.gas, 0, RCS_GAS, RCS_GAS);
  }
}

/** How far (rad) a swivelling thruster turns its push either way, and how fast (rad/s). */
const GIMBAL_MAX = 0.26;
const GIMBAL_RATE = 1.6;

/**
 * A swivelling (gimballed) thruster: flown, it turns its push a little either way to
 * turn the craft about its middle, as a real rocket steers, with no other thrusters
 * needed. Not flown, it pushes straight.
 */
export class GimbalThruster extends Thruster implements Swiveller {
  /** Its push turned now (rad, + anticlockwise), and to. */
  swivel = 0;
  private want = 0;
  private toldAt = -Infinity;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, force: number, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, force, x, y, opts);
    this.nozzlePx = [0, 6];
  }

  pilotSwivel(u: number, com: V2): void {
    const p = this.main;
    const d = p.localDir(p.flip, 0);
    // turning its push by +δ turns the craft by (r · push): the side of the middle it's on
    const r = { x: p.x - com.x, y: p.y - com.y };
    const side = r.x * d.x + r.y * d.y;
    this.want = Math.abs(side) < 0.15 ? 0 : clamp(u, -1, 1) * GIMBAL_MAX * Math.sign(side);
    this.toldAt = this.game.time;
  }

  protected thrustDir(s: number): V2 {
    const p = this.main;
    const a = p.bodyAngle + (p.flip < 0 ? Math.PI : 0) + this.swivel;
    return { x: Math.cos(a) * s, y: Math.sin(a) * s };
  }

  preStep(dt: number): void {
    if (this.game.time - this.toldAt > 0.25) this.want = 0;
    const d = this.want - this.swivel;
    this.swivel += clamp(d, -GIMBAL_RATE * dt, GIMBAL_RATE * dt);
    super.preStep(dt);
  }
}

// ------------------------------------------------------------------ heat shield

/** Where a heat shield starts burning away (°C), and how long (s) it lasts at its hottest. */
const ABLATE_FROM = 650;
const ABLATE_LAST = 60;

/**
 * A heat shield: on the front of something coming down from space fast, it takes the
 * heat of the air (see systems/Aero reentry heating), burning away slowly to carry it
 * off (it stays near ABLATE_FROM while it lasts); burnt through, it's no more help.
 */
export class HeatShield extends Prop {
  /** What's left of it (1: new). */
  left = 1;
  private emberT = 0;

  preStep(dt: number): void {
    super.preStep(dt);
    const p = this.main;
    if (this.destroyed || p.destroyed || this.left <= 0) return;
    const over = p.temp - ABLATE_FROM;
    if (over <= 0) return;
    // burning away carries the heat off
    const k = Math.min(1, over / 800);
    this.left = Math.max(0, this.left - (k * dt) / ABLATE_LAST);
    this.game.heat.add(p, -Math.min(over, over * 4 * dt + 40 * dt));
    this.emberT -= dt;
    if (this.emberT <= 0) {
      this.emberT = 0.03;
      const w = p.pixelToWorld(Math.random() * p.w, p.h - 1);
      this.game.particles.emit(PK.Ember, w.x, w.y, { vx: -p.vx * 0.1 + (Math.random() - 0.5), vy: -p.vy * 0.1 + (Math.random() - 0.5), life: 0.6, size: 0.06, color: 0xffd27a, color1: 0xff5a1a, alpha: 1, alpha1: 0, gravity: 0, drag: 1 });
    }
    if (this.left <= 0) for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) if (p.solidAt(x, y)) p.paintPixel(x, y, 0x000000, 0.5);
  }

  contextActions(): ContextAction[] {
    return [{ label: `Shield left: ${Math.round(this.left * 100)}%`, disabled: true, action: () => {} }];
  }

  protected serializeExtra(): Record<string, unknown> {
    return { left: this.left };
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    this.left = num(x.left, 0, 1, 1);
  }
}

// ------------------------------------------------------------------ control flaps

/** How far (degrees) a flap turns to steer, and lowered (a wing's landing flap). */
const FLAP_STEER = 22;
const FLAP_DOWN = 28;
/** The trims a flap can be set to (degrees). */
export const TRIMS = [-8, -4, 0, 4, 8];

/**
 * A control flap (an elevator, a rudder, a fin's steering tab): a hinge block to weld on
 * and a flap that swings on it. Flown, it swings to turn the craft as the air pushes on
 * it (see systems/Aero), whichever way that takes; set as a landing flap, F (or power)
 * lowers it, for more lift slow. Its trim sets where it rests.
 */
export class ControlFlap extends Machine implements HandSwitched, Swiveller {
  readonly mount: Part;
  readonly flap: Part;
  on = false;
  heldOff = false;
  /** Steers when flown (an elevator), or lowers on F or power (a landing flap). */
  mode: 'steer' | 'flap' = 'steer';
  trim = 0;
  private joint: RAPIER.RevoluteImpulseJoint;
  private swing = 0;
  private toldAt = -Infinity;
  private applied = NaN;

  constructor(game: Game, def: ItemDef, plane: boolean, x: number, y: number, opts: SpawnOptions) {
    super(game, def, opts.flip ?? false);
    this.activatable = true;
    this.usesPower = true;
    this.attachIgnoresBody = true;
    const ang = opts.angle ?? 0;
    this.mount = this.addPart({ name: 'Hinge', art: R.flapMountArt(), material: MAT.metal, x, y, angle: ang, density: 150, textureKey: 'flap-mount', layer: 1 });
    const art = R.flapArt(plane);
    const f = this.mount.flip;
    const pv = this.mount.pixelToWorld(3, 3);
    const half = (art.w / 2) * PX;
    this.flap = this.addPart({
      name: 'Flap', art, material: MAT.sheetMetal, x: pv.x + Math.cos(ang) * half * f, y: pv.y + Math.sin(ang) * half * f, angle: ang, density: 40,
      textureKey: `flap:${plane}`, layer: 0, depth: plane ? 1.6 : 1,
    });
    const data = RAPIER.JointData.revolute(this.mount.pixelToLocal(3, 3), this.flap.pixelToLocal(0, 2));
    this.joint = this.addJoint(data, this.mount, this.flap) as RAPIER.RevoluteImpulseJoint;
    this.joint.configureMotorModel(RAPIER.MotorModel.ForceBased);
    this.joint.setMotorMaxForce(plane ? 900 : 500);
    this.apply();
    this.sturdy();
  }

  get main(): Part {
    return this.mount;
  }

  get lowered(): boolean {
    return this.mode === 'flap' && (this.on || this.powered) && !this.heldOff;
  }

  pilotSwivel(u: number, com: V2): void {
    if (this.mode !== 'steer') return;
    const fl = this.flap;
    const v = Math.hypot(fl.vx, fl.vy);
    if (v < 2) {
      this.swing = 0;
      this.toldAt = this.game.time;
      return;
    }
    // turning it a little anticlockwise pushes it along its normal by about the flow along
    // it: the turn that gives the craft is r × n̂ times that (see systems/Aero)
    const c = Math.cos(fl.bodyAngle);
    const s = Math.sin(fl.bodyAngle);
    const vu = fl.vx * c + fl.vy * s;
    const n = { x: -s, y: c };
    const r = { x: fl.x - com.x, y: fl.y - com.y };
    const k = (r.x * n.y - r.y * n.x) * vu;
    this.swing = Math.abs(k) < 1e-3 ? 0 : clamp(u, -1, 1) * Math.sign(k);
    this.toldAt = this.game.time;
  }

  private target(): number {
    const deg = this.trim + (this.lowered ? -FLAP_DOWN : 0) + this.swing * FLAP_STEER * this.mount.flip;
    return (deg * Math.PI * this.mount.flip) / 180;
  }

  private apply(): void {
    const t = this.target();
    if (Math.abs(t - this.applied) < 0.004 || !this.joint.isValid()) return;
    this.applied = t;
    this.joint.configureMotorPosition(t, 2500, 120);
    this.flap.body.wakeUp();
  }

  canRest(): boolean {
    return true;
  }

  preStep(dt: number): void {
    super.preStep(dt);
    if (this.heldOff && !this.powered) this.heldOff = false;
    if (this.game.time - this.toldAt > 0.25) this.swing = 0;
    this.apply();
  }

  activate(): void {
    if (this.mode !== 'flap') {
      this.mode = 'flap';
      this.on = true;
    } else toggleRun(this, this.lowered, this.powered);
    this.game.sound.click(this.mount.x, 1);
    this.apply();
  }

  setPowered(on: boolean): void {
    super.setPowered(on);
    if (!on) this.heldOff = false;
    this.apply();
  }

  contextActions(): ContextAction[] {
    const acts: ContextAction[] = [
      { label: 'Steers when flown', checked: this.mode === 'steer', action: () => (this.mode = 'steer') },
      { label: 'Landing flap (F lowers it)', checked: this.mode === 'flap', action: () => (this.mode = 'flap') },
    ];
    if (this.mode === 'flap') acts.unshift({ label: this.lowered ? 'Raise' : 'Lower', hint: 'F', action: () => this.activate() });
    for (const t of TRIMS) acts.push({ label: `Trim ${t > 0 ? '+' : ''}${t}°`, checked: this.trim === t, action: () => (this.trim = t) });
    return acts;
  }

  protected serializeExtra(): Record<string, unknown> {
    return { on: this.on, off: this.heldOff, mode: this.mode, trim: this.trim };
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    this.on = !!x.on;
    this.heldOff = !!x.off;
    if (x.mode === 'steer' || x.mode === 'flap') this.mode = x.mode;
    if (TRIMS.includes(x.trim as number)) this.trim = x.trim as number;
    this.apply();
  }
}

// ------------------------------------------------------------------ launch clamp

/** How long (s) the engines must out-push the build's weight before the clamp lets go. */
const CLAMP_HOLD = 1;

/**
 * A launch clamp: fixed where it's put, weld it to a rocket on its pad. It holds it
 * steady till its engines push harder than it weighs for a second (or it's fired: F,
 * its stage, a pulse), then opens and lets it go.
 */
export class LaunchClamp extends Prop {
  open = false;
  private heldT = 0;
  private lookAt = -Infinity;
  private build: Entity[] = [];

  constructor(game: Game, def: ItemDef, cfg: PropConfig, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, x, y, opts);
    this.activatable = true;
    this.setFrozen(true);
  }

  get stageable(): boolean {
    return true;
  }

  activate(): void {
    if (!this.open) this.letGo();
  }

  letGo(): void {
    if (this.open) return;
    this.open = true;
    const g = this.game;
    for (const c of [...g.connections.connectionsOf(this)]) if (c.kind !== 'wire') g.connections.remove(c);
    this.main.setArt(R.clampArt(true));
    g.sound.play('machine/power_hammer', { gain: 0.5, x: this.main.x });
    g.sound.play('machine/air_release', { gain: 0.5, x: this.main.x });
  }

  preStep(dt: number): void {
    super.preStep(dt);
    if (this.open || this.destroyed) return;
    const g = this.game;
    if (g.time - this.lookAt > 0.5 || g.time < this.lookAt) {
      this.lookAt = g.time;
      this.build = g.connections.assemblyOf([this]).filter((e) => e !== this);
    }
    if (!this.build.length) return;
    // the engines' push up against the weight of what it holds
    let up = 0;
    let m = 0;
    for (const e of this.build) {
      if (e.destroyed) continue;
      for (const p of e.parts) if (!p.destroyed) m += p.mass;
      if (!isEngine(e)) continue;
      const lvl = engineLevel(e, (e as { on?: boolean }).on ?? false);
      if (lvl <= 0 || (e as { dry?: boolean }).dry || !(e as { running?: boolean }).running) continue;
      up += e.pushForce() * lvl * Math.max(0, e.pushDir()?.y ?? 0);
    }
    const weight = m * -g.gravity * (g.map.world ? g.air.gravityAt(this.main.y) : 1);
    if (up > weight * 1.05) this.heldT += dt;
    else this.heldT = 0;
    if (this.heldT >= CLAMP_HOLD) this.letGo();
  }

  contextActions(): ContextAction[] {
    return this.open
      ? [{ label: 'Close (weld it on again)', action: () => this.reset() }]
      : [{ label: 'Let go', hint: 'F', action: () => this.activate() }];
  }

  reset(): void {
    this.open = false;
    this.heldT = 0;
    this.main.setArt(R.clampArt(false));
  }

  protected serializeExtra(): Record<string, unknown> {
    return { open: this.open };
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    if (x.open) {
      this.open = true;
      this.main.setArt(R.clampArt(true));
    }
  }
}

// ------------------------------------------------------------------ docking port

/** How near (m) two ports' faces pull together, and close enough (m) to lock. */
const DOCK_REACH = 0.9;
const DOCK_LOCK = 0.12;
const ports = new Set<DockingPort>();

/**
 * A docking port: two of them face to face, near, pull together (magnets) and lock
 * (a weld) once they meet square on; F undocks them, pushing apart.
 */
export class DockingPort extends Prop {
  docked: DockingPort | null = null;
  private lock: Connection | null = null;
  /** Undocked a moment ago: it doesn't pull again till they're apart. */
  private coolT = 0;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, x, y, opts);
    this.activatable = true;
    ports.add(this);
  }

  /** Its face (the middle of its ridged side) and the way it faces. */
  face(): { at: V2; dir: V2 } {
    const p = this.main;
    return { at: p.pixelToWorld(p.w - 0.5, p.h / 2), dir: p.localDir(p.flip, 0) };
  }

  activate(): void {
    if (this.docked) this.undock();
  }

  undock(): void {
    const o = this.docked;
    if (!o) return;
    const g = this.game;
    if (this.lock && g.connections.list.includes(this.lock)) g.connections.remove(this.lock);
    this.lock = o.lock = null;
    this.docked = o.docked = null;
    this.coolT = o.coolT = 2;
    const f = this.face();
    const a = g.connections.assemblyOf([this]);
    const b = g.connections.assemblyOf([o]);
    if (!a.some((e) => b.includes(e))) {
      kickAll(a, f.dir, -0.6);
      kickAll(b, f.dir, 0.6);
    }
    this.main.setArt(R.dockingPortArt(false));
    o.main.setArt(R.dockingPortArt(false));
    g.sound.play('machine/air_release', { gain: 0.5, x: this.main.x });
  }

  preStep(dt: number): void {
    super.preStep(dt);
    if (this.destroyed || this.main.destroyed) return;
    this.coolT = Math.max(0, this.coolT - dt);
    if (this.docked) {
      if (this.docked.destroyed || !this.lock || !this.game.connections.list.includes(this.lock)) {
        const o = this.docked;
        this.docked = null;
        this.lock = null;
        this.main.setArt(R.dockingPortArt(false));
        if (o && !o.destroyed && o.docked === this) {
          o.docked = null;
          o.lock = null;
          o.main.setArt(R.dockingPortArt(false));
        }
      }
      return;
    }
    if (this.coolT > 0) return;
    const me = this.face();
    for (const o of ports) {
      // (each pair once: the one made first does the pulling)
      if (o === this || o.id < this.id || o.destroyed || o.docked || o.coolT > 0) continue;
      const it = o.face();
      const dx = it.at.x - me.at.x;
      const dy = it.at.y - me.at.y;
      const d = Math.hypot(dx, dy);
      if (d > DOCK_REACH) continue;
      // face to face, more or less
      const facing = me.dir.x * it.dir.x + me.dir.y * it.dir.y;
      if (facing > -0.5) continue;
      const a = this.main;
      const b = o.main;
      if (a.frozen && b.frozen) continue;
      // pulled together at their faces, and turned square
      const pull = Math.min(400, 250 / Math.max(0.15, d)) * dt;
      a.body.applyImpulseAtPoint({ x: (dx / Math.max(d, 1e-3)) * pull, y: (dy / Math.max(d, 1e-3)) * pull }, me.at, true);
      b.body.applyImpulseAtPoint({ x: (-dx / Math.max(d, 1e-3)) * pull, y: (-dy / Math.max(d, 1e-3)) * pull }, it.at, true);
      const cross = me.dir.x * -it.dir.y - me.dir.y * -it.dir.x;
      const twist = cross * 60 * dt;
      a.body.applyTorqueImpulse(-twist, true);
      b.body.applyTorqueImpulse(twist, true);
      if (d < DOCK_LOCK && facing < -0.97) this.dock(o, me.at);
      break;
    }
  }

  private dock(o: DockingPort, at: V2): void {
    const g = this.game;
    const c = g.connections.create('weld', this.main, at, o.main, at);
    if (!c) return;
    this.lock = o.lock = c;
    this.docked = o;
    o.docked = this;
    this.main.setArt(R.dockingPortArt(true));
    o.main.setArt(R.dockingPortArt(true));
    g.sound.play('machine/power_hammer', { gain: 0.4, x: at.x });
  }

  protected onDestroy(): void {
    ports.delete(this);
    super.onDestroy();
  }

  contextActions(): ContextAction[] {
    return this.docked ? [{ label: 'Undock', hint: 'F', action: () => this.undock() }] : [{ label: 'Not docked (face another port, near)', disabled: true, action: () => {} }];
  }

  serializeLinks(ref: (e: Entity) => number): Record<string, unknown> | undefined {
    const o = this.docked;
    return o && !o.destroyed ? { docked: ref(o) } : undefined;
  }

  restoreLinks(links: Record<string, unknown>, get: (i: number) => Entity | undefined): void {
    const o = get(links.docked as number);
    if (!(o instanceof DockingPort) || o.destroyed) return;
    const lock = this.game.connections.connectionsOf(this).find((k) => k.kind === 'weld' && (k.a.entity === o || k.b?.entity === o));
    if (!lock) return;
    this.docked = o;
    o.docked = this;
    this.lock = o.lock = lock;
    this.main.setArt(R.dockingPortArt(true));
    o.main.setArt(R.dockingPortArt(true));
  }
}
