import { RAPIER } from '../engine/Physics';
import { Prop, type PropConfig } from './Prop';
import { Blade } from './Melee';
import { balloonArt, BALLOON_KNOT, BALLOON_RAMPS, type BalloonColor } from '../art/gear';
import type { PixelArt } from '../art/PixelArt';
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

/** A size of balloon: what it holds up and how the air holds it back, and where on its art things are (px). */
export interface BalloonKind {
  /** What it holds up (kg, its own weight included). */
  lift: number;
  /** The air's drag on it (N per m/s; no more than its own mass a step, or it would stop dead). */
  drag: number;
  /** Where the gas pulls it up (its top), where it bursts from (its middle), and its knot. */
  top: [number, number];
  middle: [number, number];
  knot: [number, number];
  art: (c: BalloonColor) => PixelArt;
  /** How loud and how deep its bang, and how many shreds it bursts into. */
  bang: number;
  shreds: number;
}

export const PARTY_BALLOON: BalloonKind = { lift: LIFT_KG, drag: DRAG, top: [7, 2], middle: [7, 8], knot: BALLOON_KNOT, art: balloonArt, bang: 1, shreds: 10 };
/** How far below its knot (m) it looks for something to be tied to. */
const TIE_REACH = 3;
/** Knocked this hard (m/s) it bursts; this much heat (from a fire under it) bursts it too. */
const BURST_SPEED = 16;
const BURST_HEAT = 0.3;
/** How often (s) it feels round for sharp edges it's resting on. */
const POKE_T = 0.1;

/**
 * A balloon full of gas: it floats up, and lifts what it's tied to (tie a rope
 * to its knot, weld its knot to something, or tie it to what's below it from
 * its menu). A few party balloons lift a person; a big one lifts one alone.
 * It bursts at a bullet, a blade, a flame, heat from below or a hard knock.
 */
export class Balloon extends Prop {
  color: BalloonColor = 'red';
  readonly kind: BalloonKind;
  private heat = 0;
  private pokeT = Math.random() * POKE_T;
  private popped = false;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, x: number, y: number, opts: SpawnOptions, kind = PARTY_BALLOON) {
    super(game, def, cfg, x, y, opts);
    this.kind = kind;
  }

  setColor(c: BalloonColor): void {
    if (c === this.color) return;
    this.color = c;
    this.main.setArt(this.kind.art(c));
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
    const k = Math.max(0, 1 - (this.kind.drag * dt) / p.mass);
    p.body.setLinvel({ x: v.x * k, y: v.y * k }, true);
    if (!p.weightless) {
      const j = -this.game.gravity * this.kind.lift * dt;
      p.body.applyImpulseAtPoint({ x: 0, y: j }, p.pixelToWorld(this.kind.top[0], this.kind.top[1]), true);
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
    const kind = this.kind;
    const c = p.pixelToWorld(kind.middle[0], kind.middle[1]);
    const col = BALLOON_RAMPS[this.color][2];
    for (let i = 0; i < kind.shreds; i++) {
      const a = Math.random() * Math.PI * 2;
      game.particles.debris(c.x, c.y, Math.cos(a) * 2, Math.sin(a) * 2 + 0.5, 1, col, 3);
    }
    game.particles.smoke(c.x, c.y, 1, 0.15 * kind.bang);
    game.sound.play('impact/balloon_pop', { gain: 0.9 * Math.min(1.2, kind.bang), x: c.x, vary: 0.06, rate: 1 / Math.sqrt(kind.bang) });
    game.alarm(c.x, c.y, 6 * kind.bang);
    game.remove(this);
  }

  /** Its knot (world). */
  knot(): V2 {
    return this.main.pixelToWorld(this.kind.knot[0], this.kind.knot[1]);
  }

  /**
   * Ties a string from its knot to the first thing below it (or to the floor, to
   * hold it there), within TIE_REACH: whether there was anything to tie it to.
   */
  tieBelow(): boolean {
    const game = this.game;
    const k = this.knot();
    const mine = new Set(this.parts);
    const ray = new RAPIER.Ray({ x: k.x, y: k.y - 0.02 }, { x: 0, y: -1 });
    const hit = game.physics.world.castRay(ray, TIE_REACH, true, undefined, undefined, undefined, undefined, (o) => {
      const q = game.physics.partOf(o);
      return !q || (!mine.has(q) && !q.destroyed);
    });
    if (!hit) return false;
    const at = { x: k.x, y: k.y - 0.02 - hit.timeOfImpact };
    const q = game.physics.partOf(hit.collider);
    const c = game.connections.create('rope', this.main, k, q && !q.destroyed ? q : null, at);
    if (c) game.sound.click(k.x, 1.3);
    return !!c;
  }

  contextActions(): ContextAction[] {
    const acts: ContextAction[] = BALLOON_COLORS.map((c) => ({ label: `Colour: ${c.label}`, checked: this.color === c.color, action: () => this.setColor(c.color) }));
    acts.push({ label: 'Tie to what’s below', action: () => this.tieBelow() });
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
