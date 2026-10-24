import { RAPIER } from '../engine/Physics';
import { GROUP, groups } from '../engine/constants';
import { clamp, type V2 } from '../engine/math';
import { Firearm, type GunSpec } from './Firearm';
import { PK } from '../systems/Particles';
import { stunGunArt, STUN_MUZZLE } from '../art/arsenal';
import type { HoldSpec } from './Item';
import type { PropConfig } from './Prop';
import type { Part } from '../world/Part';
import type { Game } from '../world/Game';
import type { Entity } from '../world/Entity';
import type { ValueEditor } from '../tools/Controls';
import type { ContextAction, ItemDef, SpawnOptions } from '../world/types';

/** How far (m) its arc reaches. */
export const STUN_RANGE = 6.5;
/** Seconds a jolt knocks the living out for (androids too): they come round after, as from a knockout. */
const STUN_TIME = 5;
/** Seconds whoever's hit twitches and jerks for. */
const JOLT = 0.7;
/** What the arc jumps to: the floor and walls and anything solid. */
const AHEAD = groups(GROUP.DEBRIS, GROUP.STATIC | GROUP.DYNAMIC);
const ARC = 0xbfe8ff;
const GLOW = 0x5aa8ff;

/** What can be knocked out (people and animals: see Human.stun() and Creature.stun()). */
interface Sedatable {
  stun(secs: number): void;
  alive: boolean;
}

let ray: RAPIER.Ray | null = null;

/**
 * A stun gun. Use throws an arc of electricity a few metres at whatever it's
 * pointed at: a person or an animal it hits jerks about and drops, knocked out
 * for a few seconds, hardly hurt; anything else gets the jolt (detonators go
 * off). Then it takes a moment to charge again. People use it like a gun, from
 * close in.
 */
export class StunGun extends Firearm {
  /** Seconds until it's charged again. */
  charge = 0;
  /** Who's twitching from a jolt, and for how much longer. */
  private jolted = new Map<Entity, number>();
  private shown = true;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, hold: HoldSpec, gun: GunSpec, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, hold, gun, x, y, opts);
  }

  /** Zaps, or clicks while it's still charging. */
  activate(): void {
    if (this.charge <= 0) this.fire();
    else this.game.sound.play('gun/dryfire', { gain: 0.25, x: this.main.x, rate: 1.6 });
  }

  /** How far off (m) whoever uses it should keep: in close, within its reach. */
  standOff(): number {
    return 0.8;
  }

  /** Seconds it takes to charge (Edit gun…'s recharge time). */
  private get chargeTime(): number {
    return 1 / this.gun.rate;
  }

  preStep(dt: number): void {
    if (this.charge > 0) {
      this.charge = Math.max(0, this.charge - dt);
      // (a faint whine as it's charged again)
      if (this.charge === 0) this.game.sound.play('medical/defib_charge', { gain: 0.12, x: this.main.x, rate: 2.2 });
    }
    this.show();
    if (!this.jolted.size) return;
    for (const [e, t] of this.jolted) {
      if (e.destroyed || t <= dt) {
        this.jolted.delete(e);
        continue;
      }
      this.jolted.set(e, t - dt);
      // each limb jerked about, now and then a crackle of sparks off one
      for (const q of e.parts) {
        if (q.destroyed || q.frozen) continue;
        const j = Math.min(3, q.mass) * 0.35;
        q.body.applyImpulse({ x: (Math.random() - 0.5) * j, y: (Math.random() - 0.5) * j }, true);
      }
      if (Math.random() < dt * 14) {
        const q = e.parts[Math.floor(Math.random() * e.parts.length)];
        if (q && !q.destroyed) {
          this.game.particles.emit(PK.Spark, q.x, q.y, { vx: (Math.random() - 0.5) * 3, vy: Math.random() * 3, life: 0.12, color: ARC, color1: GLOW, alpha1: 0.3, gravity: 0, drag: 4 });
          q.flash = 0.6;
        }
      }
    }
  }

  private show(): void {
    const ready = this.charge <= 0;
    if (ready === this.shown || this.destroyed) return;
    this.shown = ready;
    this.main.setArt(stunGunArt(ready));
  }

  /** Throws the arc, if it's charged: it jumps to the first thing in front of it, within reach. */
  fire(): void {
    if (this.charge > 0 || this.destroyed) return;
    const p = this.main;
    const game = this.game;
    const phys = game.physics;
    this.charge = this.chargeTime;
    this.shots++;
    this.show();
    const m = p.pixelToWorld(STUN_MUZZLE[0], STUN_MUZZLE[1]);
    const fwd = this.forward();
    const holder = this.holder;
    const r = (ray ??= new RAPIER.Ray({ x: 0, y: 0 }, { x: 1, y: 0 }));
    r.origin = m;
    r.dir = fwd;
    const h = phys.world.castRayAndGetNormal(r, STUN_RANGE, true, undefined, AHEAD, undefined, p.body, (c) => {
      const q = phys.partOf(c);
      return !q || (!q.destroyed && q.entity !== this && q.entity !== holder);
    });
    const q = h ? phys.partOf(h.collider) ?? null : null;
    // missing, it fizzles out short of its reach
    const len = h ? h.timeOfImpact : STUN_RANGE * (0.35 + Math.random() * 0.2);
    const end = { x: m.x + fwd.x * len, y: m.y + fwd.y * len };
    this.arc(m, end, !!h);
    game.sound.play('machine/taser', { gain: 0.8, x: m.x, vary: 0.05 });
    if (!p.frozen) p.body.applyImpulseAtPoint({ x: -fwd.x * this.gun.recoil, y: -fwd.y * this.gun.recoil }, m, true);
    game.alarm(m.x, m.y, 5);
    if (!h) return;
    game.particles.sparks(end.x, end.y, -fwd.x, -fwd.y, 6, 3);
    game.renderer.addLight(end.x, end.y, 1.6, 0.7, GLOW, 0.1);
    if (q) this.jolt(q, end, fwd);
  }

  /** The jolt into `q`: the living are knocked out and twitch; anything gets the shock (detonators fire). */
  private jolt(q: Part, at: V2, dir: V2): void {
    const who = q.entity as Entity & Partial<Sedatable>;
    who.damage(q, this.gun.damage, 'shock', at, dir);
    if (who.destroyed || q.destroyed) return;
    if (who.stun && who.alive) {
      who.stun(STUN_TIME);
      this.jolted.set(who, JOLT);
      this.game.sound.zap(at.x);
    }
    q.flash = 1;
  }

  /** A jagged arc from `a` to `b`, flickering once more a moment later; `hit`: it struck something (brighter). */
  private arc(a: V2, b: V2, hit: boolean): void {
    const pr = this.game.projectiles;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    for (let k = 0; k < 2; k++) {
      const n = Math.max(3, Math.round(len / 0.35));
      let px = a.x;
      let py = a.y;
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        const off = i === n ? 0 : (Math.random() - 0.5) * Math.min(0.3, len * 0.12);
        const x = a.x + dx * t + nx * off;
        const y = a.y + dy * t + ny * off;
        pr.drawBeam(px, py, x, y, hit ? 0.035 : 0.025, ARC, 0.08 + k * 0.06);
        pr.drawBeam(px, py, x, y, 0.1, GLOW, 0.06 + k * 0.05);
        px = x;
        py = y;
      }
    }
    this.game.renderer.addLight(a.x, a.y, 1.4, 0.6, GLOW, 0.08);
  }

  contextActions(): ContextAction[] {
    const ready = this.charge <= 0;
    const acts: ContextAction[] = [{ label: ready ? 'Zap' : 'Charging…', hint: 'F', disabled: !ready, action: () => this.fire() }];
    if (this.holder) acts.push({ label: 'Drop', action: () => this.holder?.dropItem(this) });
    return acts;
  }

  /** The recharge time from a quarter second to five. */
  protected tuning(k: Parameters<Firearm['tuning']>[0]): ReturnType<Firearm['tuning']> {
    const t = super.tuning(k);
    if (k === 'rate') return { ...t, min: 0.25, max: 5 };
    if (k === 'damage') return { ...t, min: 0, max: 60 };
    return t;
  }

  /** Edit gun…: the jolt's harm and the time it takes to charge. */
  editor(): ValueEditor {
    const ed = super.editor();
    const labels: Record<string, string> = { damage: 'Shock (harm per zap)', rate: 'Recharge time' };
    ed.fields = ed.fields.filter((f) => f.key in labels).map((f) => ({ ...f, label: labels[f.key] }));
    return ed;
  }

  protected serializeExtra(): Record<string, unknown> {
    // (always something: a guest's copy learns from the change that it's charged)
    const x: Record<string, unknown> = { ...super.serializeExtra() };
    if (this.charge > 0) x.charging = true;
    return x;
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    super.restoreExtra(x);
    this.charge = x.charging === true ? clamp(this.chargeTime, 0, 5) : 0;
    this.show();
  }
}
