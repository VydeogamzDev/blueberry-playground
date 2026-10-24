import { Item, type HoldSpec } from './Item';
import type { PropConfig } from './Prop';
import { PK } from '../systems/Particles';
import type { Part } from '../world/Part';
import type { Game } from '../world/Game';
import type { PixelArt } from '../art/PixelArt';
import type { V2 } from '../engine/math';
import type { BulletHit, ContextAction, DamageKind, ImpactInfo, ItemDef, SpawnOptions } from '../world/types';

export interface BlastSpec {
  power: number;
  radius: number;
  damage: number;
  shrapnel?: number;
  incendiary?: boolean;
  /** Fuse time after activation (s); 0 = instant. */
  fuse: number;
  /** Fuse sparks emitted at this art pixel while burning. */
  fusePoint?: [number, number];
  /**
   * A fuse drawn on the sprite instead: its art pixels from the free end in. It
   * burns down pixel by pixel over the fuse time, the sparks at its burning end;
   * `fuseArt(left)` is the sprite with `left` of them still unburnt.
   */
  fusePath?: [number, number][];
  fuseArt?: (left: number) => PixelArt;
  /** Damage needed to set it off (bullets, blasts, impacts). */
  sensitivity?: number;
  /** Fire makes it go off after burning this long (s). */
  burnTime?: number;
  /** Pressure plate: things landing on it set it off. */
  pressure?: boolean;
  /** Visual pin popped on activation (grenades). */
  pin?: [number, number];
  /** Its sprite once the pin is out (a live grenade shouldn't look like a safe one). */
  pulled?: () => PixelArt;
}

/** How readily something that fire sets off burns when what it's made of doesn't (a steel drum's fuel, a bomb's fuse). */
const KINDLING = 0.3;

/** Fire must be able to catch what it sets off (see BlastSpec.burnTime), whatever it's made of. */
function kindling(cfg: PropConfig, blast: BlastSpec): PropConfig {
  if (blast.burnTime === undefined || cfg.material.flammability > 0) return cfg;
  return { ...cfg, material: { ...cfg.material, flammability: KINDLING } };
}

/** Grenades, dynamite, explosive barrels, C4, mines. */
export class Explosive extends Item {
  readonly blast: BlastSpec;
  armed = false;
  timer = 0;
  private dmg = 0;
  private burnT = 0;
  private plateT = 0;
  private exploded = false;
  private beepT = 0;
  /** Pixels of a drawn fuse the sprite shows (see BlastSpec.fusePath). */
  private shown: number;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, hold: HoldSpec | null, blast: BlastSpec, x: number, y: number, opts: SpawnOptions) {
    super(game, def, kindling(cfg, blast), hold, x, y, opts);
    this.blast = blast;
    this.activatable = true;
    this.shown = blast.fusePath?.length ?? 0;
  }

  /** Has a fuse to light (rather than a pin, a plate or a detonator). */
  get hasFuse(): boolean {
    return !!(this.blast.fusePoint || this.blast.fusePath);
  }

  /** Pixels of its drawn fuse not burnt yet. */
  get fuseLeft(): number {
    const path = this.blast.fusePath;
    if (!path) return 0;
    if (!this.armed) return path.length;
    return Math.max(0, Math.min(path.length, Math.ceil((path.length * this.timer) / Math.max(1e-3, this.blast.fuse))));
  }

  /** A fuse cord burning down to it sets it off, quickly: the cord was its fuse (see Connections). */
  onFuse(): void {
    this.arm(Math.min(this.blast.fuse, 0.1));
  }

  activate(): void {
    if (this.blast.pressure) {
      this.arm(0.05);
      return;
    }
    if (this.armed) return;
    this.arm(this.blast.fuse);
    const p = this.main;
    if (this.blast.pin) {
      const w = p.pixelToWorld(this.blast.pin[0], this.blast.pin[1]);
      this.game.particles.debris(w.x, w.y, -p.flip * 0.5, 1, 1, 0xc9a43c, 2.5);
      this.game.sound.click(w.x, 1.6);
      if (this.blast.pulled) p.setArt(this.blast.pulled());
    }
  }

  private arm(fuse: number): void {
    if (this.armed && this.timer <= fuse) return;
    this.armed = true;
    this.timer = fuse;
  }

  preStep(dt: number): void {
    const p = this.main;
    if (this.blast.burnTime !== undefined && p.burning > 0.15) {
      this.burnT += dt;
      if (this.burnT > this.blast.burnTime) this.arm(this.hasFuse ? 1.2 : 0.3);
    }
    if (this.blast.pressure && !this.armed) {
      this.plateT -= dt;
      if (this.plateT <= 0) {
        this.plateT = 0.05;
        if (this.loaded()) {
          this.game.sound.arm(p.x);
          this.arm(0.25);
        }
      }
    }
    if (!this.armed) return;
    this.timer -= dt;
    const path = this.blast.fusePath;
    if (path && this.blast.fuseArt) {
      // the drawn fuse burns down a pixel at a time
      const left = this.fuseLeft;
      if (left !== this.shown) {
        this.shown = left;
        p.setArt(this.blast.fuseArt(left));
      }
    }
    const spark = path ? path[Math.min(path.length - 1, path.length - this.fuseLeft)] : this.blast.fusePoint;
    if (spark) {
      const w = p.pixelToWorld(spark[0], spark[1]);
      if (Math.random() < 0.6) {
        this.game.particles.emit(PK.Spark, w.x, w.y, {
          vx: (Math.random() - 0.5) * 2.5, vy: Math.random() * 2.5, life: 0.1 + Math.random() * 0.2,
          color: 0xfff1b0, color1: 0xff7a1a, alpha1: 0.3, gravity: 0.6, drag: 2,
        });
      }
      if (Math.random() < 0.08) this.game.particles.smoke(w.x, w.y, 1, 0.06);
      this.game.sound.hold(this, 'explosion/fuse_loop', 0.35, w.x);
    } else if (this.blast.fuse > 0.5) {
      // grenade-style ticking: small flash every half second
      this.beepT -= dt;
      if (this.beepT <= 0) {
        this.beepT = Math.max(0.12, this.timer * 0.25);
        p.flash = 0.35;
      }
    }
    if (this.timer <= 0) this.detonate();
  }

  /** Is something resting on (or pressing) the plate? */
  private loaded(): boolean {
    const world = this.game.physics.world;
    const p = this.main;
    const up = p.localDir(0, 1);
    let pressed = false;
    for (const c of p.colliders) {
      world.contactPairsWith(c, (other) => {
        if (pressed) return;
        const op = this.game.physics.partOf(other);
        // (a foot or a paw is light, but it carries the whole of whoever stands on it)
        if (!op || op.entity === this || op.frozen || op.entity.totalMass() < 1.5) return;
        world.contactPair(c, other, (m) => {
          if (m.numContacts() === 0) return;
          // the other body must be above the plate
          const dx = op.x - p.x;
          const dy = op.y - p.y;
          if (dx * up.x + dy * up.y > 0.02) pressed = true;
        });
      });
    }
    return pressed;
  }

  detonate(): void {
    if (this.exploded || this.destroyed) return;
    this.exploded = true;
    const b = this.blast;
    const c = this.main.body.translation();
    this.game.explosions.explode(c.x, c.y, {
      power: b.power, radius: b.radius, damage: b.damage, incendiary: b.incendiary, shrapnel: b.shrapnel, source: this,
    });
    this.game.remove(this);
  }

  onImpact(info: ImpactInfo): void {
    const s = this.blast.sensitivity;
    if (s === undefined) return;
    const m = Math.min(info.otherMass, 200);
    const e = 0.5 * Math.min(m, this.main.mass * 4) * Math.max(0, info.speed - 6) ** 2;
    if (e > 0) this.hurt(e / 25);
  }

  onBullet(hit: BulletHit): void {
    this.main.flash = 0.5;
    if (this.blast.sensitivity === undefined) return;
    // a bullet into what's touchy (a drum of fuel) sets it off, whatever gun it came from;
    // stray fragments and spent pellets only add up
    if (hit.damage > 15) this.arm(0.02);
    else this.hurt(hit.damage);
  }

  damage(_part: Part, amount: number, kind: DamageKind, _point?: V2, _dir?: V2): void {
    if (kind === 'fire') return;
    if (kind === 'shock') {
      // a jolt of electricity (lightning) fires it, like the current down a wire to a detonator
      this.arm(0.05);
      return;
    }
    if (kind === 'explosion') {
      // sympathetic detonation, slightly delayed for a satisfying chain
      if (amount > 8) this.arm(Math.min(this.armed ? this.timer : 99, 0.06 + Math.random() * 0.08));
      return;
    }
    if (this.blast.sensitivity !== undefined) this.hurt(amount);
  }

  private hurt(amount: number): void {
    this.dmg += amount;
    if (this.dmg >= (this.blast.sensitivity ?? Infinity)) this.arm(0.02);
  }

  contextActions(): ContextAction[] {
    const acts: ContextAction[] = [];
    if (!this.armed) acts.push({ label: this.hasFuse ? 'Light fuse' : this.blast.pin ? 'Pull pin' : this.blast.pressure ? 'Trigger' : 'Detonate', hint: 'F', action: () => this.activate() });
    else acts.push({ label: 'Detonate now', danger: true, action: () => this.detonate() });
    if (this.holder) acts.push({ label: 'Drop', action: () => this.holder?.dropItem(this) });
    return acts;
  }

  protected serializeExtra(): Record<string, unknown> | undefined {
    return this.armed ? { armed: true, timer: this.timer } : undefined;
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    if (x.armed) {
      this.armed = true;
      this.timer = Number(x.timer) || this.blast.fuse;
      if (this.blast.pulled) this.main.setArt(this.blast.pulled());
    }
  }
}

