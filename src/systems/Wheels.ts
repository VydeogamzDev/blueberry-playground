import { RAPIER } from '../engine/Physics';
import { PX, WORLD } from '../engine/constants';
import { MAT } from '../world/Materials';
import { PK } from './Particles';
import type { Game } from '../world/Game';
import type { Part } from '../world/Part';

/** How often (s) the wheels are looked for again. */
const RELOOK = 0.5;
/** Faster than this (m/s) a tyre slides on the ground, and it squeals, smokes and leaves a mark. */
const SKID = 3.5;
/** Hurt past this share of its health, a tyre's flat. */
const FLAT_AT = 0.7;
/** A flat tyre: how much smaller it sits, and how much of its grip it keeps. */
const FLAT = { r: 0.82, grip: 0.55 };

interface Wheel {
  part: Part;
  col: RAPIER.Collider;
  r0: number;
  /** Its own friction, dry and whole. */
  f0: number;
  flat: boolean;
  grip: number;
  thumpT: number;
  /** An aircraft's (see Aircraft.apply()): its grip its own, and rolling it slides by design. */
  own: boolean;
}

/**
 * Tyres (0.4.0): every rubber wheel (motor wheels, cars, landing gear). Their grip goes
 * with the ground (wet in rain, slippery in snow); spun or locked so they slide, they
 * squeal, smoke and leave skid marks; shot or torn up, they go flat: lower, with less grip,
 * thumping round.
 */
export class Wheels {
  private list: Wheel[] = [];
  private byPart = new Map<Part, Wheel>();
  private lookT = 0;
  private k = 0;

  constructor(private game: Game) {}

  /** The grip the ground gives now (a share of dry tarmac's). */
  groundGrip(): number {
    const w = this.game.weather.state;
    return Math.max(0.3, (1 - 0.3 * w.rain) * (1 - 0.55 * w.snow));
  }

  isFlat(p: Part): boolean {
    return !!this.byPart.get(p)?.flat;
  }

  private look(): void {
    const next: Wheel[] = [];
    const seen = new Map<Part, Wheel>();
    for (const e of this.game.entities) {
      if (e.destroyed) continue;
      for (const p of e.parts) {
        if (p.destroyed || p.mat !== MAT.rubber || p.colliders.length !== 1) continue;
        const col = p.colliders[0];
        if (!col.isValid() || col.shapeType() !== RAPIER.ShapeType.Ball) continue;
        const was = this.byPart.get(p);
        const w = was && was.col === col ? was : { part: p, col, r0: col.radius(), f0: col.friction(), flat: false, grip: -1, thumpT: 0, own: (e as { ownWheels?: boolean }).ownWheels === true };
        next.push(w);
        seen.set(p, w);
      }
    }
    this.list = next;
    this.byPart = seen;
  }

  step(dt: number): void {
    const g = this.game;
    if (g.net?.guest) return;
    this.lookT -= dt;
    if (this.lookT <= 0) {
      this.lookT = RELOOK;
      this.look();
    }
    if (!this.list.length) return;
    const ground = this.groundGrip();
    // (every other step: smoke and marks don't need more)
    const look = (++this.k & 1) === 0;
    for (const w of this.list) {
      const p = w.part;
      if (p.destroyed || !w.col.isValid()) continue;
      // flat: hurt enough (a bullet, shrapnel); whole again (repaired), up it comes
      const flat = p.maxHp > 0 && Number.isFinite(p.maxHp) && p.hp < p.maxHp * FLAT_AT;
      if (flat !== w.flat) {
        w.flat = flat;
        w.col.setRadius(w.r0 * (flat ? FLAT.r : 1));
        if (flat) {
          g.sound.play('machine/air_release', { gain: 0.6, x: p.x, rate: 1.5 });
          g.particles.debris(p.x, p.y, 0, 1, 4, 0x2f3034, 3);
        }
      }
      if (w.own) continue;
      const grip = ground * (w.flat ? FLAT.grip : 1);
      if (Math.abs(grip - w.grip) > 0.02) {
        w.grip = grip;
        w.col.setFriction(w.f0 * grip);
      }
      if (!look) continue;
      const r = w.col.radius();
      const floor = g.env.world ? g.env.groundAt(p.x, p.y) : WORLD.floor;
      const gap = p.y - r - floor;
      if (gap > 0.06) continue;
      // the tyre's bottom against the ground: its roll and its slide
      const av = p.body.angvel();
      const slip = p.vx + av * r;
      if (w.flat && Math.abs(av) > 2) {
        w.thumpT -= dt * 2;
        if (w.thumpT <= 0) {
          w.thumpT = Math.PI / Math.abs(av);
          g.sound.impact('rubber', 0.25, p.x);
        }
      }
      const s = Math.abs(slip);
      if (s < SKID) continue;
      const k = Math.min(1, (s - SKID) / 12);
      g.sound.hold(w, 'machine/tyre_screech_loop', 0.15 + 0.35 * k, p.x, 0.85 + 0.3 * k);
      if (Math.random() < 0.4 + 0.6 * k) {
        g.particles.emit(PK.Smoke, p.x - Math.sign(slip) * r * 0.3, floor + 0.05, {
          vx: -slip * 0.08 + (Math.random() - 0.5), vy: 0.6 + Math.random() * 0.6, life: 1.2 + k, size: 0.12, size1: 0.6 + k * 0.6,
          color: 0xe8e8e8, color1: 0xbfc3c8, alpha: 0.35 + 0.3 * k, alpha1: 0, gravity: 0, drag: 1.5,
        });
      }
      // (a dark mark on the road where it slid)
      g.stains.add(p.x, floor - PX * 0.5, 0.08, 0.08, 0.09, 0.25 + 0.3 * k);
    }
  }

  clear(): void {
    this.list = [];
    this.byPart.clear();
  }
}
