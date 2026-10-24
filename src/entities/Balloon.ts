import { Prop, type PropConfig } from './Prop';
import { Blade } from './Melee';
import { balloonArt, BALLOON_RAMPS, type BalloonColor } from '../art/gear';
import type { Part } from '../world/Part';
import type { Game } from '../world/Game';
import type { V2 } from '../engine/math';
import type { BulletHit, ContextAction, DamageKind, ImpactInfo, ItemDef, SpawnOptions } from '../world/types';

export const BALLOON_COLORS: { color: BalloonColor; label: string }[] = [
  { color: 'red', label: 'Red' },
  { color: 'blue', label: 'Blue' },
  { color: 'green', label: 'Green' },
  { color: 'yellow', label: 'Yellow' },
  { color: 'pink', label: 'Pink' },
];

/** What it holds up (kg, its own weight included), and the air's drag on it (N per m/s): it rises at a few m/s at most. */
export const LIFT_KG = 20;
const DRAG = 40;
/** Knocked this hard (m/s) it bursts; this much heat (from a fire under it) bursts it too. */
const BURST_SPEED = 16;
const BURST_HEAT = 0.3;
/** How often (s) it feels round for sharp edges it's resting on. */
const POKE_T = 0.1;

/**
 * A party balloon full of gas: it floats up, and lifts what it's tied to (tie
 * a rope to its knot). A few of them lift a person. It bursts at a bullet,
 * a blade, a flame, heat from below or a hard knock.
 */
export class Balloon extends Prop {
  color: BalloonColor = 'red';
  private heat = 0;
  private pokeT = Math.random() * POKE_T;
  private popped = false;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, x, y, opts);
  }

  setColor(c: BalloonColor): void {
    if (c === this.color) return;
    this.color = c;
    this.main.setArt(balloonArt(c));
  }

  /** It never settles: the gas in it keeps pulling it up. */
  canRest(): boolean {
    return false;
  }

  preStep(dt: number): void {
    const p = this.main;
    if (this.popped || p.frozen) return;
    if (p.burning > 0) {
      this.pop();
      return;
    }
    this.heat = Math.max(0, this.heat - dt * 0.5);
    // the air holding it back (on how fast it was going: the lift must be felt whole, or
    // it can't carry what it's tied to), then the gas's lift, at its top so the knot hangs under it
    const v = p.body.linvel();
    const k = Math.max(0, 1 - (DRAG * dt) / p.mass);
    p.body.setLinvel({ x: v.x * k, y: v.y * k }, true);
    if (!p.weightless) {
      const j = -this.game.gravity * LIFT_KG * dt;
      p.body.applyImpulseAtPoint({ x: 0, y: j }, p.pixelToWorld(7, 2), true);
    }
    this.pokeT -= dt;
    if (this.pokeT <= 0) {
      this.pokeT = POKE_T;
      if (this.onSharp()) this.pop();
    }
  }

  /** Something's sharp edge or point is touching it (a knife's blade, a spear's head). */
  private onSharp(): boolean {
    const world = this.game.physics.world;
    const phys = this.game.physics;
    let sharp = false;
    for (const c of this.main.colliders) {
      world.contactPairsWith(c, (o) => {
        if (sharp) return;
        const q = phys.partOf(o);
        if (!q || q.destroyed || !(q.entity instanceof Blade) || q !== q.entity.main) return;
        const [x0, x1] = q.entity.blade.blade;
        world.contactPair(c, o, (m) => {
          if (sharp || m.numSolverContacts() === 0) return;
          const at = m.solverContactPoint(0);
          if (!at) return;
          const { ix } = q.worldToPixel(at.x, at.y);
          if (ix >= x0 - 1 && ix <= x1 + 1) sharp = true;
        });
      });
    }
    return sharp;
  }

  onImpact(info: ImpactInfo): void {
    if (info.speed > BURST_SPEED) this.pop();
  }

  onBullet(_hit: BulletHit): void {
    this.pop();
  }

  damage(_part: Part, amount: number, kind: DamageKind, _point?: V2, _dir?: V2): void {
    if (kind === 'blunt' || kind === 'crush' ? amount > 20 : amount > 0.3) this.pop();
  }

  /** Heat from a fire nearby (see Fire.warm()). */
  onHeat(_p: Part, heat: number): void {
    this.heat += heat;
    if (this.heat > BURST_HEAT) this.pop();
  }

  /** Bang: shreds of rubber, and it's gone (and what it held up falls). */
  pop(): void {
    if (this.popped || this.destroyed) return;
    this.popped = true;
    const p = this.main;
    const game = this.game;
    const c = p.pixelToWorld(7, 8);
    const col = BALLOON_RAMPS[this.color][2];
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2;
      game.particles.debris(c.x, c.y, Math.cos(a) * 2, Math.sin(a) * 2 + 0.5, 1, col, 3);
    }
    game.particles.smoke(c.x, c.y, 1, 0.15);
    game.sound.play('impact/balloon_pop', { gain: 0.9, x: c.x, vary: 0.06 });
    game.alarm(c.x, c.y, 6);
    game.remove(this);
  }

  contextActions(): ContextAction[] {
    const acts: ContextAction[] = BALLOON_COLORS.map((c) => ({ label: `Colour: ${c.label}`, checked: this.color === c.color, action: () => this.setColor(c.color) }));
    acts.push({ label: 'Pop', danger: true, action: () => this.pop() });
    return acts;
  }

  protected serializeExtra(): Record<string, unknown> {
    return this.color === 'red' ? {} : { color: this.color };
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    this.setColor(BALLOON_COLORS.find((c) => c.color === x.color)?.color ?? 'red');
  }
}
