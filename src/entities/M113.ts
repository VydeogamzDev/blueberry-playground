import { PX } from '../engine/constants';
import { Tank, type CannonSpec, type Passing } from './Tank';
import { Missile, angleFor, type Guide } from './Missiles';
import { MISSILE, M113_LAUNCHER } from '../art/missiles';
import type { CarConfig } from './Car';
import type { Game } from '../world/Game';
import type { ContextAction, ItemDef, SpawnOptions } from '../world/types';

/** How fast a missile leaves its tube (m/s): it lights once clear (see Missile). */
const LAUNCH = 11;

/**
 * The M113A1 missile carrier: the M113 armoured personnel carrier with a
 * missile launcher raised on its roof. It drives as a tank does, its launcher
 * laid with the aim keys (or picked in its menu), and goes on a side as a tank
 * does too (see Tank). Off a side, Use fires a missile the player steers with
 * the cursor (see Missile's Guide); on one, its crew drive at the enemy they
 * pick, lay the launcher on them and fire missiles that guide themselves onto
 * that enemy. Its two tubes fire in turn, a reload (the gun's) apart.
 */
export class MissileCarrier extends Tank {
  /** What it fires (makes a Missile). */
  private readonly round: ItemDef;
  /** Seconds until the next missile is in, and the tube it goes from. */
  reloadT = 0;
  private tube = 0;
  /** Aimed with the cursor: F works it (when it's selected) whatever the cursor is over (see Controls). */
  readonly cursorAimed = true;

  constructor(game: Game, def: ItemDef, cfg: CarConfig, gun: CannonSpec, round: ItemDef, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, gun, x, y, opts);
    this.round = round;
  }

  preStep(dt: number): void {
    super.preStep(dt);
    if (this.reloadT > 0) this.reloadT -= dt;
  }

  /**
   * Fires a missile from the next tube, once it has reloaded: on a side, at
   * the enemy the crew have picked (it guides itself there, past its own side
   * in the way: see Tank.clear()); else where the cursor is.
   */
  fire(past?: Passing): void {
    const b = this.barrel;
    const game = this.game;
    if (this.reloadT > 0 || this.destroyed || this.wrecked || b.destroyed) return;
    const [tx, ty] = M113_LAUNCHER.tubes[this.tube];
    const fwd = b.localDir(b.flip, 0);
    const heading = Math.atan2(fwd.y, fwd.x);
    const m = b.pixelToWorld(tx - 0.5, ty - 0.5);
    // (its tail just inside the tube)
    const back = (MISSILE.w / 2 - 6) * PX;
    const c = { x: m.x + fwd.x * back, y: m.y + fwd.y * back };
    const shot = game.spawn(this.round, c.x, c.y, { flip: this.flipped, angle: angleFor(heading, this.flipped) });
    if (!(shot instanceof Missile)) return;
    shot.zBase = this.zBase - 0.01;
    for (const q of shot.parts) q.updateZ();
    const foe = this.team && this.foe && !this.foe.destroyed ? this.foe : null;
    const guide: Guide = foe ? { kind: 'target', entity: foe, part: null, local: { x: 0, y: 0 }, at: foe.center() } : { kind: 'cursor' };
    const own = [...this.parts, ...this.attachedEntities().flatMap((e) => e.parts)];
    shot.launch(own, heading, LAUNCH, false, guide, b.velocityAt(m.x, m.y), past);
    this.reloadT = this.gun.reload;
    this.tube = 1 - this.tube;
    this.shots++;
    // a puff out of the tube's mouth, and the launch's thump
    game.particles.smoke(m.x + fwd.x * 0.2, m.y + fwd.y * 0.2, 4, 0.25);
    game.sound.play('gun/launcher', { gain: 0.8, x: m.x, rate: 0.85, vary: 0.04 });
    game.renderer.shake(0.08);
    game.alarm(m.x, m.y, 30);
  }

  /** (The tank's menu, its barrel's elevations the launcher's.) */
  contextActions(): ContextAction[] {
    return super.contextActions().map((a) => (a.label.startsWith('Barrel ') ? { ...a, label: `Launcher ${a.label.slice(7)}` } : a));
  }

  protected serializeExtra(): Record<string, unknown> {
    const x = super.serializeExtra();
    if (this.reloadT > 0) x.reload = this.reloadT;
    if (this.tube) x.tube = 1;
    return x;
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    super.restoreExtra(x);
    this.reloadT = typeof x.reload === 'number' ? Math.max(0, Math.min(this.gun.reload, x.reload)) : 0;
    this.tube = x.tube === 1 ? 1 : 0;
  }
}
