import { Item, type HoldSpec } from './Item';
import { Blade, type BladeSpec } from './Melee';
import { powerHammerArt, PHAMMER_FACE } from '../art/gear';
import type { PropConfig } from './Prop';
import type { Part } from '../world/Part';
import type { Game } from '../world/Game';
import type { V2 } from '../engine/math';
import type { ContextAction, ImpactInfo, ItemDef, SpawnOptions } from '../world/types';

// ------------------------------------------------------------------ spear

/** Faster than this (m/s) through the air, a loose spear swings round to fly point first; how hard it's turned. */
const FLIGHT_SPEED = 6;
const VANE = 14;

/**
 * A spear: stab with it (the point sinks in and lodges, as a knife's does) or
 * throw it. Flung, it flies point first, as its weight's forward and its long
 * shaft trails, so it lands point first and sticks in what it hits.
 */
export class Spear extends Blade {
  private grabbed = false;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, hold: HoldSpec, blade: BladeSpec, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, hold, blade, x, y, opts);
    this.swings = true;
  }

  onGrab(part: Part, held: boolean, at?: V2): void {
    this.grabbed = held;
    super.onGrab(part, held, at);
  }

  preStep(_dt: number): void {
    if (this.holder || this.grabbed || this.lodge) return;
    const p = this.main;
    if (p.frozen) return;
    const v = p.body.linvel();
    const speed = Math.hypot(v.x, v.y);
    if (speed < FLIGHT_SPEED) return;
    // the shaft trails behind the head like a dart's flights: it turns into its flight
    const want = Math.atan2(v.y * p.flip, v.x * p.flip);
    let d = want - p.body.rotation();
    d = Math.atan2(Math.sin(d), Math.cos(d));
    const k = Math.min(1, (speed - FLIGHT_SPEED) / 4);
    p.body.setAngvel(p.body.angvel() * (1 - k) + d * VANE * k, true);
  }
}

// ------------------------------------------------------------------ power hammer

/** How fast (m/s) the head must meet something for the piston to fire, and the blow it gives (N·s at most, and per kg of what it hits). */
const STRIKE_SPEED = 3;
const PISTON = 260;
const PISTON_PER_KG = 25;
/** Harm the piston's blow does on top of the knock, and seconds to charge its air again. */
const PISTON_HARM = 45;
const RECHARGE = 1.2;

/**
 * A power hammer: a heavy hammer with an air-driven piston in its head. When
 * the head meets something hard enough (a swing, Use while it touches
 * something) the piston fires, hitting with a huge blow that throws even heavy
 * things across the room; then it hisses as it charges its air again.
 */
export class PowerHammer extends Item {
  charged = true;
  private recharge = 0;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, hold: HoldSpec, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, hold, x, y, opts);
    this.activatable = true;
    this.swings = true;
    this.blunt = 2.5;
  }

  /** Fires the piston into whatever the face is touching (only a thump if nothing). */
  activate(): void {
    if (!this.charged) {
      this.game.sound.play('gun/dryfire', { gain: 0.3, x: this.main.x, rate: 0.7 });
      return;
    }
    const hit = this.atFace();
    if (hit) this.strike(hit.part, hit.at, hit.dir);
    else this.strike(null, this.main.pixelToWorld(this.main.w - 1, this.main.h / 2), this.forward());
  }

  preStep(dt: number): void {
    if (this.charged) return;
    this.recharge -= dt;
    if (this.recharge > 0) return;
    this.charged = true;
    this.main.setArt(powerHammerArt(true));
    this.game.sound.play('machine/air_release', { gain: 0.5, x: this.main.x, vary: 0.05 });
  }

  /** The head meeting something fast enough: the piston fires into it. */
  onImpact(info: ImpactInfo): void {
    if (!this.charged || this.destroyed || info.part !== this.main || info.speed < STRIKE_SPEED) return;
    const o = info.other;
    if (o && (o.destroyed || o.entity === this.holder)) return;
    const { ix } = this.main.worldToPixel(info.point.x, info.point.y);
    if (ix < PHAMMER_FACE - 2) return;
    this.strike(o, info.point, { x: -info.normal.x, y: -info.normal.y });
  }

  /** What the face touches: the part (null: the floor or a wall), where, and the way into it. */
  private atFace(): { part: Part | null; at: V2; dir: V2 } | null {
    const world = this.game.physics.world;
    const phys = this.game.physics;
    const p = this.main;
    let found: { part: Part | null; at: V2; dir: V2 } | null = null;
    for (const c of p.colliders) {
      world.contactPairsWith(c, (o) => {
        if (found) return;
        const q = phys.partOf(o) ?? null;
        if (q && (q.destroyed || q.entity === this || q.entity === this.holder)) return;
        world.contactPair(c, o, (m, flipped) => {
          if (found || m.numSolverContacts() === 0) return;
          const at = m.solverContactPoint(0);
          if (!at || p.worldToPixel(at.x, at.y).ix < PHAMMER_FACE - 2) return;
          const n = m.normal();
          const s = flipped ? -1 : 1;
          found = { part: q, at: { x: at.x, y: at.y }, dir: { x: n.x * s, y: n.y * s } };
        });
      });
    }
    return found;
  }

  /** The piston's blow into `q` (null: the floor or a wall) at `at`, along `dir`: and the hammer kicks back. */
  private strike(q: Part | null, at: V2, dir: V2): void {
    const game = this.game;
    const p = this.main;
    this.charged = false;
    this.recharge = RECHARGE;
    p.setArt(powerHammerArt(false));
    game.sound.play('machine/power_hammer', { gain: 0.9, x: at.x, vary: 0.05 });
    if (!q) {
      // into the floor, or nothing: the hammer jumps back off it
      if (!p.frozen) p.body.applyImpulseAtPoint({ x: -dir.x * PISTON * 0.08, y: -dir.y * PISTON * 0.08 }, at, true);
      game.particles.sparks(at.x, at.y, -dir.x, -dir.y, 6, 4);
      return;
    }
    const mass = q.frozen ? Infinity : q.entity.totalMass();
    const j = Math.min(PISTON, mass * PISTON_PER_KG);
    if (!q.frozen) q.body.applyImpulseAtPoint({ x: dir.x * j, y: dir.y * j + j * 0.15 }, at, true);
    // (a body is thrown as one: the rest of it goes along with the part hit)
    for (const r of q.entity.parts) {
      if (r === q || r.destroyed || r.frozen) continue;
      const k = (j * 0.5 * r.mass) / Math.max(1, mass);
      r.body.applyImpulse({ x: dir.x * k, y: dir.y * k + k * 0.15 }, true);
    }
    q.entity.damage(q, PISTON_HARM, 'blunt', at, dir);
    if (!p.frozen) p.body.applyImpulseAtPoint({ x: -dir.x * j * 0.12, y: -dir.y * j * 0.12 }, at, true);
    if (q.mat.sparks) game.particles.sparks(at.x, at.y, -dir.x, -dir.y, 8, 5);
    else game.particles.debris(at.x, at.y, -dir.x, -dir.y, 4, q.mat.debrisColor, 3);
    game.particles.flash(at.x, at.y, 0.25, 0xfff0c0, 0.05);
    game.renderer.shake(0.1);
    game.alarm(at.x, at.y, 10);
  }

  contextActions(): ContextAction[] {
    const acts: ContextAction[] = [{ label: this.charged ? 'Fire the piston' : 'Recharging…', hint: 'F', disabled: !this.charged, action: () => this.activate() }];
    if (this.holder) acts.push({ label: 'Drop', action: () => this.holder?.dropItem(this) });
    return acts;
  }

  protected serializeExtra(): Record<string, unknown> {
    return this.charged ? {} : { recharge: Math.round(this.recharge * 10) / 10 };
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    this.charged = typeof x.recharge !== 'number';
    this.recharge = this.charged ? 0 : Math.max(0, Math.min(RECHARGE, x.recharge as number));
    this.main.setArt(powerHammerArt(this.charged));
  }
}
