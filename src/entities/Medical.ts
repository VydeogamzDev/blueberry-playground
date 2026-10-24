import { Item, type HoldSpec } from './Item';
import type { PropConfig } from './Prop';
import type { Drug } from './Syringe';
import { PK } from '../systems/Particles';
import { fromBase64 } from '../engine/base64';
import { PX } from '../engine/constants';
import { CLEAR, type PixelArt } from '../art/PixelArt';
import { DRUG_RAMPS } from '../art/items';
import { GAUZE, GAUZE_COLORS, type DefibLight } from '../art/medical';
import type { V2 } from '../engine/math';
import type { Part } from '../world/Part';
import type { Game } from '../world/Game';
import type { Entity } from '../world/Entity';
import type { ContextAction, ItemDef, SpawnOptions } from '../world/types';

// ------------------------------------------------------------------ patients

/** What medicine needs of a limb (a person's and an animal's both fit). */
export interface PatientLimb {
  part: Part;
  wounds: { ix: number; iy: number; rate: number }[];
  gone: boolean;
  broken: boolean;
}

/** People and animals: what medicine works on (see Human and Creature). */
export interface Patient extends Entity {
  alive: boolean;
  blood: number;
  consciousness: number;
  readonly limbs: { values(): Iterable<PatientLimb> };
  inject(drug: Drug, dose: number): void;
  /** A defibrillator's shock to a heart that stopped not long ago: whether it started again. */
  restart(): boolean;
}

export function asPatient(e: Entity | null | undefined): Patient | null {
  const p = e as (Entity & Partial<Patient>) | null | undefined;
  if (!p || p.destroyed || typeof p.inject !== 'function' || typeof p.restart !== 'function' || !(p.limbs instanceof Map)) return null;
  return p as Patient;
}

/** The limb a part of someone is. */
export function limbOf(who: Patient, part: Part): PatientLimb | null {
  for (const l of who.limbs.values()) if (l.part === part && !l.gone) return l;
  return null;
}

/** How fast a limb bleeds (the sum of its wounds). */
const bleeding = (l: PatientLimb): number => l.wounds.reduce((s, w) => s + w.rate, 0);

/** A machine (an android): no blood, nothing a first aid kit can mend. */
export function bloodless(who: Patient): boolean {
  return (who as { variant?: { bleeds?: boolean } }).variant?.bleeds === false;
}

/** Alive and hurt somehow: losing blood, out of it, broken, bleeding, wounded or poisoned. */
export function needsCare(who: Patient): boolean {
  if (!who.alive || bloodless(who)) return false;
  if (who.blood < 97 || who.consciousness < 0.9) return true;
  if (((who as { drugs?: { poison?: number } }).drugs?.poison ?? 0) > 0) return true;
  for (const l of who.limbs.values()) {
    if (l.gone) continue;
    if (l.broken || bleeding(l) > 0.005 || l.part.hp < l.part.maxHp * 0.9 || l.part.burning > 0) return true;
  }
  return false;
}

/** Someone touching a thing: who, the limb it touches, and about where. */
export interface Touch {
  who: Patient;
  part: Part;
  at: V2;
}

/**
 * Every limb of anyone (person or animal) a thing is touching right now, apart
 * from whoever holds it. Limbs cut off count for nothing: the medicine has to
 * get into the body.
 */
export function touches(item: Item): Touch[] {
  const phys = item.game.physics;
  const world = phys.world;
  const out: Touch[] = [];
  for (const p of item.parts) {
    if (p.destroyed) continue;
    const c0 = p.body.translation();
    for (const c of p.colliders) {
      world.contactPairsWith(c, (other) => {
        const op = phys.partOf(other);
        if (!op || op.destroyed || op.detached || op.entity === item || op.entity === item.holder || out.some((t) => t.part === op)) return;
        const who = asPatient(op.entity);
        if (!who) return;
        let near = false;
        world.contactPair(c, other, (m) => {
          for (let i = 0; i < m.numContacts(); i++) if (m.contactDist(i) < 0.03) near = true;
        });
        if (!near) return;
        // (about where: the point of the limb nearest the thing)
        const pr = other.projectPoint(c0, true);
        out.push({ who, part: op, at: pr ? { x: pr.point.x, y: pr.point.y } : { x: op.x, y: op.y } });
      });
    }
  }
  return out;
}

/** The limb of someone's own body nearest a point (a person seeing to themselves). */
function ownLimbNear(who: Patient, x: number, y: number): Part | null {
  let best: Part | null = null;
  let bd = Infinity;
  for (const l of who.limbs.values()) {
    const p = l.part;
    if (l.gone || p.destroyed || p.detached || !p.mat.bleeds) continue;
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  return best;
}

// ------------------------------------------------------------------ looks

/** Each drug's glow where it goes in (its liquid's highlight). */
export const DRUG_GLOW = Object.fromEntries(Object.entries(DRUG_RAMPS).map(([k, r]) => [k, r[4]])) as Record<Drug, number>;

/** A puff of sparkles of a colour (a drug going in, a body mending), drifting up and fading. */
export function sparkle(game: Game, x: number, y: number, color: number, n: number, spread = PX * 2): void {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = 0.2 + Math.random() * 0.7;
    game.particles.emit(PK.Ember, x + (Math.random() - 0.5) * spread, y + (Math.random() - 0.5) * spread, {
      vx: Math.cos(a) * s, vy: Math.sin(a) * s + 0.5, life: 0.35 + Math.random() * 0.45,
      color, color1: color, alpha: 1, alpha1: 0, gravity: -0.05, drag: 3, size: PX,
    });
  }
}

/** Sparkles on `n` random spots of someone's body (healing showing all over). */
export function glowOver(game: Game, who: Entity, color: number, n: number): void {
  const parts = who.parts;
  for (let k = 0; k < n; k++) {
    const p = parts[Math.floor(Math.random() * parts.length)];
    if (!p || p.destroyed || p.detached) continue;
    const ix = Math.floor(Math.random() * p.w);
    const iy = Math.floor(Math.random() * p.h);
    if (!p.solidAt(ix, iy)) continue;
    const w = p.pixelToWorld(ix, iy);
    sparkle(game, w.x, w.y, color, 1, 0);
  }
}

/**
 * Washes what's been painted on a part (blood, wounds, bruises, scorching)
 * back to its own colours, a pixel at a time: each one with the chance
 * `share`. A bandage wrapped round it stays. Whether anything was washed.
 */
export function washBlood(p: Part, share: number): boolean {
  if (share <= 0 || p.destroyed) return false;
  const data = p.paintData();
  if (!data) return false;
  const b = fromBase64(data);
  const w = p.w + 2;
  let any = false;
  for (let j = 0; j + 7 <= b.length; j += 7) {
    if (Math.random() >= share) continue;
    if (GAUZE_COLORS.has((b[j + 3] << 16) | (b[j + 4] << 8) | b[j + 5])) continue;
    const i = b[j] | (b[j + 1] << 8) | (b[j + 2] << 16);
    const ix = (i % w) - 1;
    const iy = Math.floor(i / w) - 1;
    const c = p.art.get(ix, iy);
    if (c !== CLEAR) any = p.paintPixel(ix, iy, c) || any;
  }
  return any;
}

/** A strip of gauze painted round a limb through art pixel (ix, iy): across a limb standing tall, round a long body. */
function wrapBand(p: Part, ix: number, iy: number): void {
  const across = p.h >= p.w;
  const len = across ? p.w : p.h;
  const mid = across ? Math.max(1, Math.min(p.h - 2, iy)) : Math.max(1, Math.min(p.w - 2, ix));
  for (let k = -1; k <= 1; k++) {
    for (let j = 0; j < len; j++) {
      const x = across ? j : mid + k;
      const y = across ? mid + k : j;
      // (its edge keeps the outline; the middle turn of it catches the light)
      const c = p.art.isRim(x, y) ? GAUZE[0] : k === 0 ? GAUZE[(j & 1) === 0 ? 3 : 2] : GAUZE[1];
      p.paintPixel(x, y, c);
    }
  }
}

// ------------------------------------------------------------------ first aid kit

/** A first aid kit's uses, how long each takes (s), and how much each heals (in full healing syringes). */
const KIT = { uses: 3, time: 3, dose: 0.8 };

/**
 * Dragged onto someone hurt, or used (F) while it touches them, it patches them
 * up over a few seconds: wounds, blood, bones, burns. A few uses in each.
 * In someone's hands, Use has them see to themselves.
 */
export class FirstAidKit extends Item {
  uses = KIT.uses;
  private art: (empty: boolean) => PixelArt;
  private grabbed = false;
  /** Whom it's being used on, and the seconds of it left. */
  private treating: { who: Patient; part: Part; t: number } | null = null;
  /** Who it last saw to while dragged against them (dragged onto someone, it sees to them once). */
  private seen: Patient | null = null;
  private fxT = 0;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, hold: HoldSpec, art: (empty: boolean) => PixelArt, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, hold, x, y, opts);
    this.art = art;
    this.activatable = true;
  }

  /** Seeing to someone right now. */
  get busy(): boolean {
    return !!this.treating;
  }

  onGrab(part: Part, held: boolean, at?: V2): void {
    this.grabbed = held;
    if (!held) this.seen = null;
    super.onGrab(part, held, at);
  }

  /**
   * Seeing to someone, it isn't handed to them; nor dragged against someone hurt (it
   * sees to them: their hand lying in the way mustn't take it off the cursor). Let go
   * in their hand, they take it, to see to themselves.
   */
  offer(at?: V2): boolean {
    if (this.treating || (this.grabbed && touches(this).some((t) => needsCare(t.who)))) return false;
    return super.offer(at);
  }

  activate(): void {
    if (this.treating) return;
    if (this.uses <= 0) {
      this.game.sound.click(this.main.x, 1.8);
      return;
    }
    // in someone's hands: they see to themselves
    const self = asPatient(this.holder);
    if (self) {
      const g = this.gripWorld() ?? this.main;
      const part = self.alive && !bloodless(self) ? ownLimbNear(self, g.x, g.y) : null;
      if (part) this.start(self, part);
      return;
    }
    // (an android is past bandages: the kit isn't used up on one)
    const all = touches(this).filter((t) => t.who.alive && !bloodless(t.who));
    const t = all.find((x) => needsCare(x.who)) ?? all[0];
    if (t) this.start(t.who, t.part);
    else this.game.sound.click(this.main.x, 1.8);
  }

  private start(who: Patient, part: Part): void {
    this.uses--;
    this.treating = { who, part, t: KIT.time };
    this.seen = who;
    this.fxT = 0;
    this.game.sound.play('medical/bandage', { gain: 0.8, x: part.x });
    this.game.sound.click(part.x, 1.2);
    sparkle(this.game, part.x, part.y, DRUG_GLOW.healing, 10, PX * 6);
    if (this.uses <= 0) this.main.setArt(this.art(true));
  }

  postStep(dt: number): void {
    super.postStep(dt);
    // dragged onto someone hurt: it sees to them
    if (this.grabbed && !this.treating && !this.holder && this.uses > 0) {
      const t = touches(this).find((x) => needsCare(x.who));
      if (t && t.who !== this.seen) this.start(t.who, t.part);
      else if (!t) this.seen = null;
    }
    const tr = this.treating;
    if (!tr) return;
    // (pulled away from them, or they died meanwhile: the rest of it is lost)
    const away = Math.hypot(tr.part.x - this.main.x, tr.part.y - this.main.y) > 1.2;
    if (tr.who.destroyed || !tr.who.alive || tr.part.destroyed || away) {
      this.treating = null;
      return;
    }
    const step = Math.min(tr.t, dt);
    tr.t -= dt;
    tr.who.inject('healing', (step / KIT.time) * KIT.dose);
    this.fxT -= dt;
    if (this.fxT <= 0) {
      this.fxT = 0.1;
      glowOver(this.game, tr.who, DRUG_GLOW.healing, 3);
    }
    if (tr.t <= KIT.time / 2 && tr.t + dt > KIT.time / 2) this.game.sound.play('medical/bandage', { gain: 0.6, x: tr.part.x });
    if (tr.t <= 0) this.treating = null;
  }

  contextActions(): ContextAction[] {
    const acts: ContextAction[] = [];
    acts.push({ label: this.holder ? 'Use on themselves' : 'Use', hint: 'F', disabled: this.uses <= 0 || !!this.treating, action: () => this.activate() });
    acts.push({ label: this.uses > 0 ? `${this.uses} use${this.uses > 1 ? 's' : ''} left` : 'Used up', action: () => {} });
    if (this.holder) acts.push({ label: 'Drop', action: () => this.holder?.dropItem(this) });
    return acts;
  }

  protected serializeExtra(): Record<string, unknown> {
    return { uses: this.uses };
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    if (typeof x.uses === 'number') this.uses = x.uses;
    if (this.uses <= 0) this.main.setArt(this.art(true));
  }
}

// ------------------------------------------------------------------ bandage

/**
 * A roll of gauze. Dragged onto a bleeding limb (or used while it touches one)
 * it's wrapped round it: that limb stops bleeding, and the bandage stays on it.
 * In someone's hands, Use has them bandage their own worst wound.
 */
export class Bandage extends Item {
  private grabbed = false;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, hold: HoldSpec, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, hold, x, y, opts);
    this.activatable = true;
  }

  onGrab(part: Part, held: boolean, at?: V2): void {
    this.grabbed = held;
    super.onGrab(part, held, at);
  }

  /** The most bleeding limb among those touched (any wound at all). */
  private worstTouched(): Touch | null {
    let best: Touch | null = null;
    let most = -1;
    for (const t of touches(this)) {
      const l = limbOf(t.who, t.part);
      if (!l || !l.wounds.length) continue;
      const r = bleeding(l);
      if (r > most) {
        most = r;
        best = t;
      }
    }
    return best;
  }

  activate(): void {
    // in someone's hands: they bandage their own worst wound
    const self = asPatient(this.holder);
    if (self) {
      let worst: PatientLimb | null = null;
      for (const l of self.limbs.values()) {
        if (l.gone || l.part.detached || !l.wounds.length) continue;
        if (!worst || bleeding(l) > bleeding(worst)) worst = l;
      }
      if (worst) this.wrap(self, worst.part, worst.part.pixelToWorld(worst.wounds[0].ix, worst.wounds[0].iy));
      else this.game.sound.click(this.main.x, 1.8);
      return;
    }
    const t = this.worstTouched();
    if (t) this.wrap(t.who, t.part, t.at);
    else this.game.sound.click(this.main.x, 1.8);
  }

  postStep(dt: number): void {
    super.postStep(dt);
    // dragged onto a bleeding limb: wrapped round it
    if (!this.grabbed || this.holder || this.destroyed) return;
    const t = this.worstTouched();
    if (t && bleeding(limbOf(t.who, t.part)!) > 0.005) this.wrap(t.who, t.part, t.at);
  }

  /** Wraps round a limb: a strip of gauze over each wound (or where it was put), and the bleeding stops. */
  private wrap(who: Patient, part: Part, at: V2): void {
    const l = limbOf(who, part);
    if (!l || this.destroyed) return;
    const spots = l.wounds.length ? l.wounds.slice(0, 3).map((w) => ({ ix: w.ix, iy: w.iy })) : [part.worldToPixel(at.x, at.y)].map((q) => ({ ix: q.ix, iy: q.iy }));
    for (const s of spots) wrapBand(part, s.ix, s.iy);
    l.wounds.length = 0;
    this.game.sound.play('medical/bandage', { gain: 0.9, x: at.x });
    sparkle(this.game, at.x, at.y, GAUZE[4], 6, PX * 4);
    this.game.remove(this);
  }

  contextActions(): ContextAction[] {
    const acts: ContextAction[] = [{ label: this.holder ? 'Bandage themselves' : 'Bandage', hint: 'F', action: () => this.activate() }];
    if (this.holder) acts.push({ label: 'Drop', action: () => this.holder?.dropItem(this) });
    return acts;
  }
}

// ------------------------------------------------------------------ defibrillator

/** Seconds a defibrillator takes to charge; how long its light blinks on and off charging. */
const DEFIB = { charge: 2.4, blink: 0.25 };
/** Where its paddle is (art px), the end that has to be against someone. */
const PADDLE: [number, number] = [15, 6];

/**
 * Use (F) charges it for a couple of seconds; charged, it shocks whoever its
 * paddle is against (at once if it's against someone as it finishes, else at
 * the next Use). A heart that stopped under a minute ago starts again; the
 * living get a jolt that wakes them up.
 */
export class Defibrillator extends Item {
  state: 'flat' | 'charging' | 'ready' = 'flat';
  private chargeT = 0;
  private art: (light: DefibLight) => PixelArt;
  private shown: DefibLight = 'off';

  constructor(game: Game, def: ItemDef, cfg: PropConfig, hold: HoldSpec, art: (light: DefibLight) => PixelArt, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, hold, x, y, opts);
    this.art = art;
    this.activatable = true;
  }

  activate(): void {
    if (this.state === 'charging') return;
    if (this.state === 'ready') {
      if (!this.shock()) this.game.sound.click(this.main.x, 1.8);
      return;
    }
    this.state = 'charging';
    this.chargeT = DEFIB.charge;
    this.game.sound.play('medical/defib_charge', { gain: 0.55, x: this.main.x, vary: 0 });
  }

  postStep(dt: number): void {
    super.postStep(dt);
    if (this.state !== 'charging') return;
    this.chargeT -= dt;
    if (this.chargeT > 0) return;
    // charged: against someone, it goes off; otherwise it waits for the next Use
    this.state = 'ready';
    if (!this.shock()) this.game.sound.click(this.main.x, 2.2);
  }

  frame(): void {
    const light: DefibLight = this.state === 'ready' ? 'ready'
      : this.state === 'charging' ? (Math.floor(this.chargeT / DEFIB.blink) % 2 ? 'amber' : 'dark') : 'off';
    if (light === this.shown || this.destroyed) return;
    this.shown = light;
    this.main.setArt(this.art(light));
  }

  /** Shocks whoever the paddle is against. Whether there was anyone. */
  private shock(): boolean {
    const pad = this.main.pixelToWorld(PADDLE[0], PADDLE[1]);
    let t: Touch | null = null;
    for (const x of touches(this)) if (!t || Math.hypot(x.at.x - pad.x, x.at.y - pad.y) < Math.hypot(t.at.x - pad.x, t.at.y - pad.y)) t = x;
    if (!t) return false;
    this.state = 'flat';
    const g = this.game;
    const { who, at } = t;
    g.sound.zap(at.x);
    g.sound.play('medical/defib_shock', { gain: 0.45, x: at.x });
    g.particles.sparks(at.x, at.y, 0, 1, 12, 3);
    g.renderer.addLight(at.x, at.y, 3, 1.4, 0xb8d8ff, 0.12);
    // the jolt: the body jumps where the paddle is, and flashes
    for (const p of who.parts) {
      if (p.destroyed || p.detached) continue;
      p.flash = 0.7;
      if (!p.frozen && Math.hypot(p.x - at.x, p.y - at.y) < 0.45) p.body.applyImpulse({ x: 0, y: p.mass * 1.6 }, true);
    }
    if (!who.alive) {
      if (who.restart()) sparkle(g, at.x, at.y, DRUG_GLOW.healing, 14, PX * 8);
    } else {
      // alive: a jolt that wakes them up (and hurts a bit)
      who.inject('adrenaline', 0.15);
      who.damage(t.part, 3, 'shock', at, { x: 0, y: -1 });
    }
    return true;
  }

  contextActions(): ContextAction[] {
    const acts: ContextAction[] = [{
      label: this.state === 'flat' ? 'Charge' : this.state === 'charging' ? 'Charging…' : 'Shock',
      hint: 'F', disabled: this.state === 'charging', action: () => this.activate(),
    }];
    if (this.holder) acts.push({ label: 'Drop', action: () => this.holder?.dropItem(this) });
    return acts;
  }

  protected serializeExtra(): Record<string, unknown> | undefined {
    return this.state === 'flat' ? undefined : { state: this.state, charge: this.chargeT };
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    if (x.state === 'charging' || x.state === 'ready') this.state = x.state;
    this.chargeT = typeof x.charge === 'number' ? x.charge : 0;
  }
}
