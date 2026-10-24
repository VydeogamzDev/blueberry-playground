import { clamp } from '../engine/math';
import { Firearm, type GunSpec } from './Firearm';
import { PK } from '../systems/Particles';
import { machineGunArt, doubleBarrelArt, DOUBLE_MUZZLES, DOUBLE_BREECH, FLINT_PAN, type BarrelHeat } from '../art/arsenal';
import type { HoldSpec } from './Item';
import type { PropConfig } from './Prop';
import type { Game } from '../world/Game';
import type { ContextAction, ItemDef, SpawnOptions } from '../world/types';
import type { ValueEditor } from '../tools/Controls';

// Guns that work a little differently from the stock ones (see Firearm): a
// burst-fire rifle, a clip-fed battle rifle, a machine gun that overheats, a
// double-barrelled shotgun and a flintlock pistol. People use them like any gun.

/** Clicks: a gun that can't fire just now. */
function dry(g: Firearm): void {
  g.game.sound.play('gun/dryfire', { gain: 0.35, x: g.main.x, vary: 0.05 });
}

// ------------------------------------------------------------------ burst rifle

/** Rounds a pull of the trigger fires, and the pause (s) after a burst before the next. */
const BURST = 3;
const BURST_PAUSE = 0.3;

/** A burst-fire rifle: each pull of the trigger fires three rounds in quick succession. */
export class BurstRifle extends Firearm {
  /** Rounds of the burst still to come, and the pause after it. */
  private left = 0;
  private pause = 0;

  activate(): void {
    this.fire();
  }

  /** Starts a burst (a person's shot, Use, a pulse down a wire), unless one is going or just ended. */
  fire(): void {
    if (this.left > 0 || this.pause > 0 || this.destroyed) return;
    this.left = BURST;
    this.round();
  }

  private round(): void {
    const before = this.shots;
    super.fire();
    if (this.shots === before) return;
    if (--this.left === 0) this.pause = BURST_PAUSE;
  }

  preStep(dt: number): void {
    super.preStep(dt);
    if (this.pause > 0) this.pause -= dt;
    if (this.left > 0) this.round();
  }

  contextActions(): ContextAction[] {
    const acts: ContextAction[] = [{ label: 'Fire a burst', hint: 'F', action: () => this.activate() }];
    if (this.holder) acts.push({ label: 'Drop', action: () => this.holder?.dropItem(this) });
    return acts;
  }
}

// ------------------------------------------------------------------ battle rifle

/** Rounds in a clip, and the seconds a new clip takes to go in. */
const CLIP = 8;
const CLIP_RELOAD = 1.9;

/**
 * A semi-automatic battle rifle fed by an eight-round clip: the last shot
 * throws the empty clip out with a ping, and a new one goes in.
 */
export class BattleRifle extends Firearm {
  rounds = CLIP;
  /** Seconds until the next clip is in. */
  reload = 0;
  private clipSound = false;

  activate(): void {
    if (this.reload > 0) dry(this);
    else this.fire();
  }

  fire(): void {
    if (this.reload > 0 || this.rounds <= 0 || this.destroyed) return;
    const before = this.shots;
    super.fire();
    if (this.shots === before) return;
    if (--this.rounds > 0) return;
    // the empty clip flies out with its ping
    const p = this.main;
    const e = p.pixelToWorld(13, 0);
    const v = p.body.linvel();
    this.game.casings.eject(e.x, e.y, v.x - this.forward().x * 0.5, v.y + 3.5, 'brass', 4, 1, p.body);
    this.game.sound.play('gun/clip_ping', { gain: 0.7, x: e.x, vary: 0.04 });
    this.reload = CLIP_RELOAD;
    this.clipSound = false;
  }

  preStep(dt: number): void {
    super.preStep(dt);
    if (this.reload <= 0) return;
    this.reload -= dt;
    if (!this.clipSound && this.reload < CLIP_RELOAD * 0.45) {
      this.clipSound = true;
      this.game.sound.play('gun/reload', { gain: 0.6, x: this.main.x, rate: 1.1 });
    }
    if (this.reload <= 0) {
      this.reload = 0;
      this.rounds = CLIP;
    }
  }

  contextActions(): ContextAction[] {
    const acts: ContextAction[] = [
      { label: this.reload > 0 ? 'Reloading…' : 'Fire', hint: 'F', disabled: this.reload > 0, action: () => this.fire() },
      { label: `Rounds: ${this.rounds} of ${CLIP}`, disabled: true, action: () => {} },
    ];
    if (this.holder) acts.push({ label: 'Drop', action: () => this.holder?.dropItem(this) });
    return acts;
  }

  protected serializeExtra(): Record<string, unknown> {
    const x: Record<string, unknown> = { ...super.serializeExtra() };
    if (this.rounds < CLIP) x.rounds = this.rounds;
    if (this.reload > 0) x.reload = Math.round(this.reload * 10) / 10;
    return x;
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    super.restoreExtra(x);
    this.rounds = typeof x.rounds === 'number' ? clamp(Math.round(x.rounds), 0, CLIP) : CLIP;
    this.reload = typeof x.reload === 'number' ? clamp(x.reload, 0, CLIP_RELOAD) : 0;
    if (this.rounds === 0 && this.reload === 0) this.rounds = CLIP;
  }
}

// ------------------------------------------------------------------ machine gun

/** Heat a shot puts in the barrel, and what it loses a second: about eight seconds of fire and it's too hot. */
const HEAT_SHOT = 0.02;
const HEAT_COOL = 0.12;
/** Overheated, it won't fire until it's cooled to this. */
const COOLED = 0.5;

/**
 * A belt-fed machine gun. It fires as long as the trigger's held, but the
 * barrel heats as it goes (glowing, smoking, its shots spreading wider) and,
 * too hot, it stops firing until it's cooled down some.
 */
export class MachineGun extends Firearm {
  /** Barrel heat: 0 cold, 1 too hot to fire. */
  heat = 0;
  overheated = false;
  private readonly spread: number;
  private shown: BarrelHeat = 0;
  private smokeT = 0;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, hold: HoldSpec, gun: GunSpec, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, hold, gun, x, y, opts);
    this.spread = gun.spread;
  }

  fire(): void {
    if (this.destroyed) return;
    if (this.overheated) return;
    // (a hot barrel throws its shots wider)
    this.gun.spread = this.spread * (1 + this.heat * 1.5);
    const before = this.shots;
    super.fire();
    if (this.shots === before) return;
    this.heat = Math.min(1, this.heat + HEAT_SHOT);
    if (this.heat >= 1) {
      this.overheated = true;
      this.game.sound.play('liquid/sizzle', { gain: 0.5, x: this.main.x });
      dry(this);
    }
  }

  activate(): void {
    if (this.overheated) dry(this);
    else super.activate();
  }

  preStep(dt: number): void {
    super.preStep(dt);
    this.heat = Math.max(0, this.heat - HEAT_COOL * dt);
    if (this.overheated && this.heat < COOLED) this.overheated = false;
    // a hot barrel smokes
    if (this.heat > 0.55) {
      this.smokeT -= dt;
      if (this.smokeT <= 0) {
        this.smokeT = 0.25 - this.heat * 0.15;
        const b = this.main.pixelToWorld(33 + Math.random() * 5, 2);
        this.game.particles.emit(PK.Smoke, b.x, b.y, {
          vx: (Math.random() - 0.5) * 0.3, vy: 0.4 + Math.random() * 0.3, life: 1 + Math.random(),
          size: 0.05, size1: 0.3, color: 0xb0aca6, color1: 0x8a8682, alpha: 0.3, alpha1: 0, gravity: -0.05, drag: 1.2,
        });
      }
    }
    this.show();
  }

  private show(): void {
    const h: BarrelHeat = this.heat > 0.75 ? 2 : this.heat > 0.4 ? 1 : 0;
    if (h === this.shown || this.destroyed) return;
    this.shown = h;
    this.main.setArt(machineGunArt(h));
  }

  /** (the glowing barrel lights what's near it, on every screen) */
  frame(): void {
    if (this.shown < 2 || this.destroyed) return;
    const b = this.main.pixelToWorld(35, 3.5);
    this.game.renderer.addLight(b.x, b.y, 0.9, 0.35, 0xff7a2a);
  }

  contextActions(): ContextAction[] {
    const acts = super.contextActions();
    if (this.overheated) acts.splice(1, 0, { label: 'Overheated: cooling…', disabled: true, action: () => {} });
    return acts;
  }

  protected serializeExtra(): Record<string, unknown> | undefined {
    const x: Record<string, unknown> = { ...super.serializeExtra() };
    // (in steps: a guest's copy sees the barrel glow without being sent every shot)
    if (this.heat > 0) x.heat = Math.round(this.heat * 20) / 20;
    if (this.overheated) x.hot = true;
    return x;
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    super.restoreExtra(x);
    this.heat = typeof x.heat === 'number' ? clamp(x.heat, 0, 1) : 0;
    this.overheated = x.hot === true;
    this.show();
  }
}

// ------------------------------------------------------------------ double-barrelled shotgun

/** Seconds a reload takes, and when in it (shares) it's broken open, each shell goes in, and it's shut. */
const DOUBLE_RELOAD = 2.2;
const BREAK_AT = 0.12;
const SHELL_AT = [0.42, 0.62];
const CLOSE_AT = 0.85;

/**
 * A double-barrelled shotgun: two shots (one barrel each Use, or both at once
 * from its menu), then it's broken open, the spent shells thrown out and two
 * more put in.
 */
export class DoubleBarrel extends Firearm {
  /** Barrels loaded (0..2). */
  loaded = 2;
  /** Seconds of the reload left. */
  reload = 0;
  private spent = 0;
  private open = false;

  activate(): void {
    if (this.loaded > 0) this.fire();
    else dry(this);
  }

  /** One barrel: the upper first, then the lower. */
  fire(): void {
    if (this.loaded <= 0 || this.reload > 0 || this.destroyed) return;
    this.gun.muzzle = DOUBLE_MUZZLES[2 - this.loaded];
    const before = this.shots;
    super.fire();
    if (this.shots === before) return;
    this.loaded--;
    this.spent++;
    if (this.loaded === 0) this.reload = DOUBLE_RELOAD;
  }

  /** Both barrels at once: twice the shot and a fearsome kick. */
  fireBoth(): void {
    if (this.loaded < 2 || this.reload > 0 || this.destroyed) {
      this.fire();
      return;
    }
    const g = this.gun;
    const { pellets, recoil, spread } = g;
    g.pellets = (pellets ?? 1) * 2;
    g.recoil = recoil * 1.8;
    g.spread = spread * 1.15;
    g.muzzle = [DOUBLE_MUZZLES[0][0], (DOUBLE_MUZZLES[0][1] + DOUBLE_MUZZLES[1][1]) / 2];
    const before = this.shots;
    super.fire();
    Object.assign(g, { pellets, recoil, spread });
    if (this.shots === before) return;
    this.game.sound.gunshot('double', this.main.x);
    this.loaded = 0;
    this.spent = 2;
    this.reload = DOUBLE_RELOAD;
  }

  preStep(dt: number): void {
    super.preStep(dt);
    if (this.reload <= 0) return;
    const was = 1 - this.reload / DOUBLE_RELOAD;
    this.reload = Math.max(0, this.reload - dt);
    const k = 1 - this.reload / DOUBLE_RELOAD;
    const p = this.main;
    const at = (t: number) => was < t && k >= t;
    if (at(BREAK_AT)) {
      this.setOpen(true);
      this.game.sound.play('gun/break_open', { gain: 0.8, x: p.x, vary: 0.04 });
      const e = p.pixelToWorld(DOUBLE_BREECH[0], DOUBLE_BREECH[1]);
      const v = p.body.linvel();
      const fwd = this.forward();
      for (let i = 0; i < this.spent; i++) {
        this.game.casings.eject(e.x, e.y, v.x - fwd.x * (1.5 + i), v.y + 1.5 + i * 0.6, 'shell', 3, 2, p.body);
      }
      this.spent = 0;
    }
    for (const t of SHELL_AT) if (at(t)) this.game.sound.play('gun/shell_in', { gain: 0.7, x: p.x, vary: 0.05 });
    if (at(CLOSE_AT)) {
      this.setOpen(false);
      this.game.sound.play('gun/break_close', { gain: 0.8, x: p.x, vary: 0.04 });
    }
    if (this.reload === 0) this.loaded = 2;
  }

  private setOpen(open: boolean): void {
    if (open === this.open || this.destroyed) return;
    this.open = open;
    this.main.setArt(doubleBarrelArt(open));
  }

  contextActions(): ContextAction[] {
    const busy = this.reload > 0;
    const acts: ContextAction[] = [
      { label: busy ? 'Reloading…' : 'Fire', hint: 'F', disabled: busy, action: () => this.fire() },
      { label: 'Fire both barrels', disabled: busy || this.loaded < 2, danger: true, action: () => this.fireBoth() },
    ];
    if (this.holder) acts.push({ label: 'Drop', action: () => this.holder?.dropItem(this) });
    return acts;
  }

  protected serializeExtra(): Record<string, unknown> {
    const x: Record<string, unknown> = { ...super.serializeExtra() };
    if (this.loaded < 2) x.loaded = this.loaded;
    if (this.reload > 0) x.reload = Math.round(this.reload * 10) / 10;
    if (this.spent) x.spent = this.spent;
    return x;
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    super.restoreExtra(x);
    this.loaded = typeof x.loaded === 'number' ? clamp(Math.round(x.loaded), 0, 2) : 2;
    this.reload = typeof x.reload === 'number' ? clamp(x.reload, 0, DOUBLE_RELOAD) : 0;
    this.spent = typeof x.spent === 'number' ? clamp(Math.round(x.spent), 0, 2) : 0;
    if (this.loaded === 0 && this.reload === 0) this.loaded = 2;
    const k = 1 - this.reload / DOUBLE_RELOAD;
    this.setOpen(this.reload > 0 && k >= BREAK_AT && k < CLOSE_AT);
  }
}

// ------------------------------------------------------------------ flintlock pistol

/** Seconds from the flint's strike to the shot (the pan's powder catching), and to load it again. */
const HANGFIRE = 0.13;
const FLINT_RELOAD = 3.5;

/**
 * A flintlock pistol: the flint strikes, the priming flashes in the pan and a
 * moment later it fires, in a great cloud of smoke. One shot, then a few
 * seconds to load again.
 */
export class Flintlock extends Firearm {
  loaded = true;
  reload = 0;
  /** Seconds until the shot, the flint having struck. */
  private hang = 0;
  private rammed = false;

  activate(): void {
    if (this.loaded && this.hang <= 0) this.fire();
    else if (!this.loaded) dry(this);
  }

  /** The flint strikes: the shot follows a moment later. */
  fire(): void {
    if (!this.loaded || this.hang > 0 || this.destroyed) return;
    this.hang = HANGFIRE * (0.9 + Math.random() * 0.4);
    const pan = this.main.pixelToWorld(FLINT_PAN[0], FLINT_PAN[1]);
    this.game.sound.play('gun/flint', { gain: 0.7, x: pan.x, vary: 0.05 });
    this.game.particles.sparks(pan.x, pan.y, 0, 1, 4, 2);
  }

  preStep(dt: number): void {
    super.preStep(dt);
    if (this.hang > 0) {
      this.hang -= dt;
      if (this.hang <= 0) this.discharge();
    }
    if (this.loaded) return;
    const was = this.reload;
    this.reload = Math.max(0, this.reload - dt);
    // (the ball rammed home, then the lock cocked)
    if (!this.rammed && this.reload < FLINT_RELOAD * 0.5) {
      this.rammed = true;
      this.game.sound.play('gun/shell_in', { gain: 0.5, x: this.main.x, rate: 0.8 });
    }
    if (was > 0.15 && this.reload <= 0.15) this.game.sound.play('gun/flint', { gain: 0.4, x: this.main.x, rate: 0.9 });
    if (this.reload === 0) this.loaded = true;
  }

  /** The priming flashes in the pan and the charge goes off, in a cloud of smoke. */
  private discharge(): void {
    this.hang = 0;
    if (this.destroyed) return;
    const p = this.main;
    const ps = this.game.particles;
    const pan = p.pixelToWorld(FLINT_PAN[0], FLINT_PAN[1]);
    ps.flash(pan.x, pan.y + 0.03, 0.18, 0xffe6a0, 0.08);
    ps.smoke(pan.x, pan.y + 0.05, 2, 0.15);
    const before = this.shots;
    super.fire();
    if (this.shots === before) return;
    this.loaded = false;
    this.reload = FLINT_RELOAD;
    this.rammed = false;
    const m = p.pixelToWorld(this.gun.muzzle[0], this.gun.muzzle[1]);
    const fwd = this.forward();
    // black powder: a great cloud of smoke rolling out of the muzzle
    for (let i = 0; i < 10; i++) {
      const s = 0.5 + Math.random() * 2.5;
      ps.emit(PK.Smoke, m.x + fwd.x * 0.1, m.y + fwd.y * 0.1, {
        vx: fwd.x * s + (Math.random() - 0.5) * 0.6, vy: fwd.y * s + (Math.random() - 0.5) * 0.6 + 0.2, life: 2 + Math.random() * 2,
        size: 0.12, size1: 0.6 + Math.random() * 0.5, color: 0xd8d6d2, color1: 0x9a9894, alpha: 0.55, alpha1: 0, gravity: -0.03, drag: 1.6,
      });
    }
  }

  contextActions(): ContextAction[] {
    const acts: ContextAction[] = [{ label: this.loaded ? 'Fire' : 'Loading…', hint: 'F', disabled: !this.loaded, action: () => this.fire() }];
    if (this.holder) acts.push({ label: 'Drop', action: () => this.holder?.dropItem(this) });
    return acts;
  }

  /** Edit gun…: its kick, the ball's power and penetration (it's loaded by hand: no fire rate to set). */
  editor(): ValueEditor {
    const ed = super.editor();
    ed.fields = ed.fields.filter((f) => f.key !== 'rate');
    return ed;
  }

  protected serializeExtra(): Record<string, unknown> {
    const x: Record<string, unknown> = { ...super.serializeExtra() };
    if (!this.loaded) x.reload = Math.round(this.reload * 10) / 10;
    return x;
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    super.restoreExtra(x);
    this.loaded = typeof x.reload !== 'number';
    this.reload = this.loaded ? 0 : clamp(x.reload as number, 0, FLINT_RELOAD);
  }
}
