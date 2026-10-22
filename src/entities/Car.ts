import { RAPIER } from '../engine/Physics';
import { PX, WORLD } from '../engine/constants';
import { Entity } from '../world/Entity';
import { MAT } from '../world/Materials';
import { artRect } from './Item';
import type { PixelArt } from '../art/PixelArt';
import type { Part } from '../world/Part';
import type { Game } from '../world/Game';
import type { ContextAction, ItemDef, SpawnOptions } from '../world/types';

export interface CarConfig {
  body: () => PixelArt;
  wheel: () => PixelArt;
  /** Wheel centers in body art pixels. */
  axles: [number, number][];
  wheelR: number;
  /** Wheel speed when driving (rad/s). */
  speed: number;
  /** Drive torque per wheel (N*m). */
  torque: number;
}

/**
 * A small car: a body on two motor-driven wheels. Activate to drive the way it
 * faces; wire it to power to drive while powered. Hits people as hard as you'd expect.
 */
export class Car extends Entity {
  readonly body: Part;
  readonly wheels: Part[] = [];
  on = false;
  dir: 1 | -1 = 1;
  private axles: RAPIER.RevoluteImpulseJoint[] = [];
  private cfg: CarConfig;
  private applied = '';

  constructor(game: Game, def: ItemDef, cfg: CarConfig, x: number, y: number, opts: SpawnOptions) {
    super(game, def, opts.flip ?? false);
    this.cfg = cfg;
    this.activatable = true;
    this.usesPower = true;
    const art = cfg.body();
    // keep the wheels out of the floor
    const below = (Math.max(...cfg.axles.map(([, ay]) => ay)) + 0.5 - art.h / 2 + cfg.wheelR) * PX;
    y = Math.max(y, WORLD.floor + below + 0.02);
    this.body = this.addPart({
      name: 'Body', art, material: MAT.metal, x, y, angle: opts.angle ?? 0, density: 95, textureKey: def.id + ':body', layer: 1,
      shapes: [artRect(art.w, art.h, 0, 11, art.w, 10, 1), artRect(art.w, art.h, 21, 2, 31, 10, 1)],
    });
    for (const [ax, ay] of cfg.axles) {
      const l = this.body.pixelToLocal(ax, ay);
      const w = this.body.localToWorld(l.x, l.y);
      const wheel = this.addPart({
        name: 'Wheel', art: cfg.wheel(), material: MAT.rubber, x: w.x, y: w.y, density: 40, textureKey: def.id + ':wheel', layer: 2,
        shapes: [{ kind: 'ball', r: cfg.wheelR }], angularDamping: 0.05,
      });
      const j = this.addJoint(RAPIER.JointData.revolute(l, { x: 0, y: 0 }), this.body, wheel) as RAPIER.RevoluteImpulseJoint;
      j.configureMotorModel(RAPIER.MotorModel.ForceBased);
      this.wheels.push(wheel);
      this.axles.push(j);
    }
    this.apply();
  }

  get driving(): boolean {
    return this.on || this.powered;
  }

  private apply(): void {
    const sig = `${this.driving}:${this.dir}`;
    if (sig === this.applied) return;
    this.applied = sig;
    for (const j of this.axles) {
      if (!j.isValid()) continue;
      if (this.driving) {
        // wheels turn clockwise to drive right; the body faces its art direction
        j.configureMotorVelocity(-this.cfg.speed * this.dir * (this.flipped ? -1 : 1), this.cfg.torque * 0.5);
        j.setMotorMaxForce(this.cfg.torque);
      } else {
        // free-rolling with a little drag
        j.configureMotorVelocity(0, 0.4);
        j.setMotorMaxForce(4);
      }
    }
    for (const p of this.parts) if (!p.destroyed && !p.frozen) p.body.wakeUp();
  }

  preStep(): void {
    this.apply();
    if (!this.driving) return;
    const w = this.wheels[0];
    const spin = w && !w.destroyed ? Math.min(1, Math.abs(w.av - this.body.av) / this.cfg.speed) : 0;
    this.game.sound.hold(this, 'machine/motor_loop', 0.18 + spin * 0.25, this.body.x, 0.5 + spin * 0.7);
  }

  frame(): void {
    if (!this.driving || this.body.destroyed) return;
    // headlight
    const art = this.body;
    const h = art.pixelToWorld(art.w - 2, 14);
    const d = art.localDir(art.flip, 0);
    this.game.renderer.addLight(h.x + d.x * 1.4, h.y + d.y * 1.4, 2.4, 0.45, 0xfff2c0);
  }

  setPowered(on: boolean): void {
    super.setPowered(on);
    this.apply();
  }

  activate(): void {
    this.on = !this.on;
    this.game.sound.click(this.body.x, this.on ? 1 : 0.7);
    this.apply();
  }

  contextActions(): ContextAction[] {
    return [
      { label: this.on ? 'Stop' : 'Drive', hint: 'F', action: () => this.activate() },
      { label: 'Reverse', checked: this.dir === -1, action: () => { this.dir = this.dir === 1 ? -1 : 1; this.apply(); } },
    ];
  }

  protected serializeExtra(): Record<string, unknown> {
    return { on: this.on, dir: this.dir };
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    this.on = !!x.on;
    this.dir = x.dir === -1 ? -1 : 1;
    this.apply();
  }
}
