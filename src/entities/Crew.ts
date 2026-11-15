import { clamp, type V2 } from '../engine/math';
import { Prop, type PropConfig } from './Prop';
import { Cockpit } from './Flight';
import { Human } from './Human';
import { Parachute, wearOn, takeOff } from './Rocketry';
import { PK } from '../systems/Particles';
import { getItem } from '../catalog/items';
import type { Commanded, PilotCommand } from '../systems/Piloting';
import type { Entity } from '../world/Entity';
import type { Part } from '../world/Part';
import type { Game } from '../world/Game';
import type { ContextAction, ItemDef, SpawnOptions } from '../world/types';

// The crew's gear (0.4.0): the ejection seat, the capsule seat, the spacesuit helmet and
// the oxygen tank (see systems/Oxygen).

const num = (v: unknown, lo: number, hi: number, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : d);

/** How hard (m/s) an ejection seat throws itself and its pilot out, and how long (s) till they part and the chute opens. */
const EJECT_V = 28;
const EJECT_PART = 0.75;
/** How long (s) its rocket burns. */
const EJECT_BURN = 0.35;

/**
 * An ejection seat: a cockpit seat (see Cockpit) that, on the pilot's eject key (or F,
 * or a pulse, with someone in it), tears itself free of the craft and rockets them clear
 * of it; a moment on, seat and pilot part and their parachute opens (one is strapped on
 * them if they've none).
 */
export class EjectionSeat extends Cockpit implements Commanded {
  /** Fired: its rocket burning (s left), and how long till the pilot's let go. */
  private burnT = 0;
  private partT = -1;
  /** Let go: the pack to open on them near the top of their climb, and how long (s) it's waited. */
  private chute: { pack: Parachute; who: Human; t: number } | null = null;
  fired = false;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, x, y, opts);
    this.activatable = true;
  }

  pilotCommand(cmd: PilotCommand): boolean {
    if (cmd !== 'eject' || !this.rider) return false;
    this.eject();
    return true;
  }

  activate(): void {
    if (this.rider) this.eject();
  }

  /** Out: free of the craft, rocketed clear. */
  eject(): void {
    const r = this.rider;
    if (!r || this.fired) return;
    this.fired = true;
    const g = this.game;
    // (torn free of whatever it was built into)
    for (const c of [...g.connections.connectionsOf(this)]) if (c.kind !== 'wire') g.connections.remove(c);
    const p = this.main;
    // (its rocket pushes over EJECT_BURN, not all at once: a body bears ~10 g a moment, not a kick to 28 m/s)
    this.burnT = EJECT_BURN;
    this.partT = EJECT_PART;
    g.sound.play('explosion/firework_launch', { gain: 0.9, x: p.x });
  }

  preStep(dt: number): void {
    super.preStep(dt);
    const p = this.main;
    if (this.burnT > 0) {
      this.burnT -= dt;
      const up = p.localDir(0, 1);
      const dv = (EJECT_V / EJECT_BURN) * dt;
      for (const q of [...this.parts, ...(this.rider?.who.parts ?? [])]) {
        if (q.destroyed) continue;
        q.body.applyImpulse({ x: up.x * dv * q.mass, y: up.y * dv * q.mass }, true);
      }
      const n = p.pixelToWorld(9, 21);
      const d = p.localDir(0, -1);
      for (let i = 0; i < 3; i++) {
        this.game.particles.emit(PK.Fire, n.x, n.y, { vx: d.x * 7 + (Math.random() - 0.5) * 2, vy: d.y * 7 + (Math.random() - 0.5) * 2, life: 0.2, size: 0.15, size1: 0.04, color: 0xfff0b0, color1: 0xff6a20, alpha: 1, alpha1: 0.2, gravity: 0, drag: 2 });
      }
      this.game.particles.smoke(n.x, n.y, 1, 0.3);
    }
    if (this.partT >= 0) {
      this.partT -= dt;
      if (this.partT < 0) this.letPilotGo();
    }
    // (their chute opens near the top of their climb: opened going up, it would come out under them)
    const w = this.chute;
    if (w) {
      w.t += dt;
      const chest = w.who.limbs.get('upperTorso')?.part;
      if (w.pack.destroyed || w.pack.state !== 'packed' || w.who.destroyed || !chest) this.chute = null;
      else if (chest.vy < 2 || w.t > 3) {
        w.pack.open();
        this.chute = null;
      }
    }
  }

  /** Seat and pilot part: their chute opens (strapped on if they've none). */
  private letPilotGo(): void {
    const h = this.rider?.who;
    if (!h) return;
    this.release(false);
    if (h.destroyed) return;
    const g = this.game;
    let pack = g.entities.find((e): e is Parachute => e instanceof Parachute && e.worn && e.wearer === h && e.state === 'packed') ?? null;
    if (!pack) {
      const def = getItem('backpack-parachute');
      const chest = h.limbs.get('upperTorso')?.part;
      if (def && chest && !chest.destroyed) {
        const e = g.spawn(def, chest.x, chest.y);
        if (e instanceof Parachute && wearOn(e, h)) pack = e;
      }
    }
    if (pack) this.chute = { pack, who: h, t: 0 };
    // (the seat falls away)
    const p = this.main;
    const away = p.localDir(0, -1);
    for (const q of this.parts) if (!q.destroyed) q.body.applyImpulse({ x: away.x * 3 * q.mass, y: away.y * 3 * q.mass }, true);
  }

  contextActions(): ContextAction[] {
    const acts = super.contextActions();
    if (this.rider) acts.unshift({ label: 'Eject', hint: 'F', danger: true, action: () => this.eject() });
    if (this.fired) acts.push({ label: 'Re-arm', action: () => (this.fired = false) });
    return acts;
  }

  protected serializeExtra(): Record<string, unknown> {
    return { ...super.serializeExtra(), fired: this.fired };
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    super.restoreExtra(x);
    this.fired = !!x.fired;
  }
}

/** A capsule seat: a cockpit seat sealed in, its pilot breathing its build's oxygen (see systems/Oxygen). */
export class CapsuleSeat extends Cockpit {
  readonly sealed = true;
}

/** How long (s) an oxygen tank's air lasts one person breathing it. */
export const O2_LAST = 600;

/** How near (m) to where it goes something worn must be let go to strap on (a helmet dragged onto a head is pushed a little off it). */
const WEAR_REACH = 0.6;

/**
 * Something worn (a helmet, an oxygen tank): dropped onto someone it straps on (see
 * Rocketry wearOn()); its menu takes it off.
 */
abstract class Worn extends Prop {
  /** Where on them it goes. */
  protected abstract at: 'head' | 'back';

  /** Who wears it, if anyone. */
  get wearer(): Human | null {
    for (const c of this.game.connections.connectionsOf(this)) {
      const o = c.a.entity === this ? c.b?.entity : c.a.entity;
      if (o instanceof Human && !o.destroyed) return o;
    }
    return null;
  }

  onGrab(part: Part, held: boolean, at?: V2): void {
    super.onGrab(part, held, at);
    if (held || this.wearer) return;
    const p = this.main;
    for (const e of this.game.entities) {
      if (!(e instanceof Human) || e.destroyed) continue;
      const limb = e.limbs.get(this.at === 'head' ? 'head' : 'upperTorso')?.part;
      if (!limb || limb.destroyed || Math.hypot(limb.x - p.x, limb.y - p.y) > WEAR_REACH) continue;
      // (one of a kind each: a second helmet doesn't go over the first)
      if (this.game.entities.some((o) => o !== this && o.def.id === this.def.id && (o as Worn).wearer === e)) continue;
      wearOn(this, e, this.at);
      return;
    }
  }

  contextActions(): ContextAction[] {
    return this.wearer ? [{ label: 'Take it off', action: () => takeOff(this) }] : [];
  }
}

/** A spacesuit helmet: worn, with an oxygen tank on their back (or sat in a capsule with one), they breathe in space and under water. */
export class Helmet extends Worn {
  protected at = 'head' as const;
  /** It's a helmet (see systems/Oxygen). */
  readonly helmet = true;
}

/** An oxygen tank: worn on someone's back with a helmet, or built into a capsule, it gives them air (see O2_LAST). */
export class OxygenTank extends Worn {
  protected at = 'back' as const;
  /** Air left (s of one person's breathing). */
  air = O2_LAST;

  /** Breathed from for `dt` s. */
  breathe(dt: number): void {
    this.air = Math.max(0, this.air - dt);
  }

  contextActions(): ContextAction[] {
    return [
      { label: `Oxygen: ${Math.round((this.air / O2_LAST) * 100)}%`, disabled: true, action: () => {} },
      { label: 'Refill', action: () => (this.air = O2_LAST) },
      ...super.contextActions(),
    ];
  }

  protected serializeExtra(): Record<string, unknown> {
    return { air: this.air };
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    this.air = num(x.air, 0, O2_LAST, O2_LAST);
  }
}

/** Is it an oxygen tank with air in it? */
export function hasAir(e: Entity): e is OxygenTank {
  return e instanceof OxygenTank && !e.destroyed && e.air > 0;
}
