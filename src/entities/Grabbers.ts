import { RAPIER } from '../engine/Physics';
import { GROUP, groups } from '../engine/constants';
import { Prop, type PropConfig } from './Prop';
import type { PixelArt } from '../art/PixelArt';
import type { Part } from '../world/Part';
import type { Entity } from '../world/Entity';
import type { Game } from '../world/Game';
import type { ContextAction, ItemDef, SpawnOptions } from '../world/types';

// Things that take hold (0.4.0): a claw (F, a pulse or power shuts it on what's between
// its jaws) and a crane hook (anything that comes into its throat is caught). The
// electromagnet is in entities/Electric.

const THINGS = groups(GROUP.DEBRIS, GROUP.DYNAMIC);
/** How long (s) a hook that's let something go waits before it catches again. */
const HOOK_REST = 1.5;

/** A world point in a body's own frame. */
function toLocal(b: RAPIER.RigidBody, x: number, y: number): { x: number; y: number } {
  const t = b.translation();
  const r = b.rotation();
  const c = Math.cos(r);
  const s = Math.sin(r);
  const dx = x - t.x;
  const dy = y - t.y;
  return { x: dx * c + dy * s, y: -dx * s + dy * c };
}

/**
 * Holds what's at its grip point (see `grip`): a fixed joint to the nearest thing there
 * (not its own build), as it is, till let go of. A claw shuts when told; a hook
 * catches whatever comes into its throat by itself.
 */
export class Grabber extends Prop {
  held: { part: Part; joint: RAPIER.ImpulseJoint } | null = null;
  /** Shut, or armed (a hook): taking hold. */
  shut = false;
  private restT = 0;
  private lookT = 0;
  private ball: RAPIER.Ball;
  private art: ((shut: boolean) => PixelArt) | null;

  constructor(
    game: Game, def: ItemDef, cfg: PropConfig,
    /** Where it takes hold (art pixel), and how far round that it reaches (m). */
    private readonly grip: [number, number], reach: number,
    /** A hook: it catches by itself. */
    readonly hook: boolean,
    art: ((shut: boolean) => PixelArt) | null, x: number, y: number, opts: SpawnOptions,
  ) {
    super(game, def, cfg, x, y, opts);
    this.ball = new RAPIER.Ball(reach);
    this.art = art;
    this.activatable = true;
    this.usesPower = !hook;
  }

  /** What's at its grip point to take hold of: the nearest part not of its own build. */
  private find(): Part | null {
    const g = this.game;
    const at = this.main.pixelToWorld(this.grip[0], this.grip[1]);
    const own = new Set(g.connections.assemblyOf([this]));
    let best: Part | null = null;
    let bd = Infinity;
    g.physics.world.intersectionsWithShape(at, 0, this.ball, (c) => {
      const q = g.physics.partOf(c);
      if (!q || q.destroyed || q.entity.destroyed || own.has(q.entity) || q.entity === this) return true;
      const d = (q.x - at.x) ** 2 + (q.y - at.y) ** 2;
      if (d < bd) {
        bd = d;
        best = q;
      }
      return true;
    }, undefined, THINGS);
    return best;
  }

  /** Takes hold of `q` where it is now. */
  private hold(q: Part): void {
    const g = this.game;
    const a = this.main.body;
    const b = q.body;
    const at = this.main.pixelToWorld(this.grip[0], this.grip[1]);
    const data = RAPIER.JointData.fixed(toLocal(a, at.x, at.y), 0, toLocal(b, at.x, at.y), a.rotation() - b.rotation());
    const joint = g.physics.world.createImpulseJoint(data, a, b, true);
    joint.setContactsEnabled(false);
    this.held = { part: q, joint };
    g.sound.play('machine/switch', { gain: 0.5, x: at.x, rate: 0.55, vary: 0.05 });
  }

  /** Takes hold of what's at its grip point, if anything. */
  grab(): boolean {
    if (this.held || this.destroyed || !this.works) return !!this.held;
    const q = this.find();
    if (!q) return false;
    this.hold(q);
    return true;
  }

  /** Lets go. */
  release(): void {
    const h = this.held;
    if (!h) return;
    this.held = null;
    if (h.joint.isValid()) this.game.physics.world.removeImpulseJoint(h.joint, true);
    this.restT = HOOK_REST;
  }

  private setShut(on: boolean): void {
    if (on === this.shut) return;
    this.shut = on;
    if (on) this.grab();
    else this.release();
    if (this.art && !this.destroyed) this.main.setArt(this.art(on));
    if (!this.hook) this.game.sound.play('machine/air_release', { gain: 0.15, x: this.main.x, rate: on ? 1.5 : 1.1 });
  }

  setPowered(on: boolean): void {
    super.setPowered(on);
    if (!this.hook) this.setShut(on);
  }

  preStep(dt: number): void {
    const h = this.held;
    if (h && (h.part.destroyed || h.part.entity.destroyed || !h.joint.isValid())) this.release();
    if (this.restT > 0) this.restT -= dt;
    // a hook armed (and a claw shut on nothing yet) catches what comes in
    if (!this.held && this.restT <= 0 && (this.hook || this.shut) && (this.lookT -= dt) <= 0) {
      this.lookT = 0.1;
      if (this.hook ? true : this.shut) this.grab();
    }
  }

  /** F: a claw opens or shuts; a hook lets go of what it holds (and catches again after a moment). */
  activate(): void {
    if (this.hook) {
      if (this.held) this.release();
      else this.grab();
      return;
    }
    this.setShut(!this.shut);
  }

  protected onDestroy(): void {
    this.release();
    super.onDestroy();
  }

  contextActions(): ContextAction[] {
    const what = this.held ? `Holding ${this.held.part.entity.def.name}` : 'Holding nothing';
    return [
      { label: what, disabled: true, action: () => {} },
      this.hook
        ? { label: this.held ? 'Let go' : 'Catch', hint: 'F', action: () => this.activate() }
        : { label: this.shut ? 'Open' : 'Shut', hint: 'F', action: () => this.activate() },
    ];
  }

  protected serializeExtra(): Record<string, unknown> {
    return this.shut ? { shut: true } : {};
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    this.shut = x.shut === true;
    if (this.art && !this.destroyed) this.main.setArt(this.art(this.shut));
  }

  serializeLinks(ref: (e: Entity) => number): Record<string, unknown> | undefined {
    const h = this.held;
    if (!h || h.part.destroyed) return undefined;
    const i = ref(h.part.entity);
    return i >= 0 ? { held: i, part: h.part.entity.parts.indexOf(h.part) } : undefined;
  }

  restoreLinks(links: Record<string, unknown>, get: (i: number) => Entity | undefined): void {
    const e = get(links.held as number);
    const q = e?.parts[typeof links.part === 'number' ? links.part : 0];
    if (this.held || !q || q.destroyed) return;
    this.hold(q);
  }
}
