import { RAPIER } from '../engine/Physics';
import { Part, type PartSpec } from './Part';
import type { Game } from './Game';
import type { BulletHit, ContextAction, DamageKind, EntityConfig, EntityState, ImpactInfo, ItemDef, PartState } from './types';
import type { V2 } from '../engine/math';

/** Base class for everything that can be spawned into the sandbox. */
export abstract class Entity {
  private static nextId = 1;
  readonly id: number;
  /** Its number in a multiplayer game, the same for everyone in it (0: none yet; see net/Host). */
  netId = 0;
  readonly game: Game;
  readonly def: ItemDef;
  readonly parts: Part[] = [];
  readonly joints: RAPIER.ImpulseJoint[] = [];
  zBase: number;
  /** Its depth was set by hand (see setDepth()): kept in saves. */
  layered = false;
  /** Whether this entity's own parts collide with each other. */
  selfCollide = false;
  destroyed = false;
  /** Faces left. Set at creation; only animals turn round in place (Creature.turn()). */
  flipped: boolean;
  /**
   * What it was made with beyond its kind (a resized plank's size, a drawn
   * shape's outline): spawning its kind with this config makes it again.
   */
  config: EntityConfig | undefined;
  /** Activation input currently held (auto-fire etc). */
  activeHeld = false;
  /** Receiving electrical power. */
  powered = false;
  /**
   * Its power comes turned round, through a reversing switch set to reverse:
   * motors and thrusters run backwards, pistons pull in (see Connections.recomputePower()).
   */
  reversed = false;
  /**
   * Reacts to being powered (lights, motors...). Pulses sent by powered logic
   * (gates, sensors, timers) skip these, since the power already drives them.
   */
  usesPower = false;
  /** Can receive activation from the player / wires. */
  activatable = false;
  /** Has had no net movement for a while (see restCheck()/settle()). */
  atRest = false;
  /** Part poses at the last rest check, and how many checks in a row found them still. */
  restRef: number[] = [];
  restChecks = 0;
  /** Checks in a row that found it at most slowly creeping. */
  slowChecks = 0;

  constructor(game: Game, def: ItemDef, flipped = false) {
    this.id = Entity.nextId++;
    this.game = game;
    this.def = def;
    this.flipped = flipped;
    this.zBase = game.allocZ();
  }

  get label(): string {
    return this.def.name;
  }

  addPart(spec: PartSpec): Part {
    const p = new Part(this, { ...spec, flip: spec.flip ?? this.flipped });
    p.group = this.selfCollide ? 0 : this.id;
    this.parts.push(p);
    return p;
  }

  /** Creates an internal joint between two parts. */
  addJoint(data: RAPIER.JointData, a: Part, b: Part, contacts = false): RAPIER.ImpulseJoint {
    const j = this.game.physics.world.createImpulseJoint(data, a.body, b.body, true);
    j.setContactsEnabled(contacts);
    this.joints.push(j);
    return j;
  }

  removeJoint(j: RAPIER.ImpulseJoint): void {
    const i = this.joints.indexOf(j);
    if (i >= 0) this.joints.splice(i, 1);
    if (j.isValid()) this.game.physics.world.removeImpulseJoint(j, true);
  }

  // ---- lifecycle hooks (override as needed) --------------------------------
  preStep(_dt: number): void {}
  /** A blast or a gunshot at (x, y), heard out to `radius` m (see Game.alarm()). */
  onAlarm(_x: number, _y: number, _radius: number): void {}
  /** Gets about on its own legs (people and animals). */
  get canWalk(): boolean {
    return false;
  }
  /** On its feet (a walker standing or getting up), as opposed to lying about like a thing. */
  get upright(): boolean {
    return false;
  }
  /** Jumps, if it's something that can (a person or an animal on its feet). Returns whether it did. */
  jump(): boolean {
    return false;
  }
  postStep(_dt: number): void {}
  frame(_dt: number): void {}
  activate(): void {}
  setActiveHeld(on: boolean): void {
    this.activeHeld = on;
  }
  setPowered(on: boolean): void {
    this.powered = on;
  }

  onImpact(_info: ImpactInfo): void {}

  /** Called when a bullet hits one of this entity's parts. */
  onBullet(hit: BulletHit): void {
    hit.part.hp -= hit.damage * 0.2;
  }

  /** Generic damage entry point (explosions, fire, cuts). */
  damage(part: Part, amount: number, _kind: DamageKind, _point?: V2, _dir?: V2): void {
    part.hp -= amount;
  }

  /** Its own context-menu entries; `part` is the one right-clicked (a person's limb, say). */
  contextActions(_part?: Part): ContextAction[] {
    return [];
  }

  /** May it be put to sleep once it stops moving? (Running machines may not.) */
  canRest(): boolean {
    return true;
  }

  /** Called when one of its parts starts or stops being dragged (`at` is the cursor on release). */
  onGrab(_part: Part, _held: boolean, _at?: V2): void {}

  /** Held out to people (dragged up to them, or let go of near them): did someone take it? */
  offer(_at?: V2): boolean {
    return false;
  }

  get frozen(): boolean {
    return this.parts.length > 0 && this.parts.every((p) => p.frozen || p.destroyed);
  }

  setFrozen(on: boolean): void {
    for (const p of this.parts) p.setFrozen(on);
  }

  get weightless(): boolean {
    return this.parts.some((p) => !p.destroyed) && this.parts.every((p) => p.weightless || p.destroyed);
  }

  /**
   * Gravity's pull (m/s², downward positive) for what's reckoned with it (a
   * leap's flight, a jump's spring, how a stumble tips): never quite none, so
   * those still come out sensible with gravity off (Settings > Physics).
   */
  protected get pull(): number {
    return Math.max(0.5, -this.game.gravity);
  }

  setWeightless(on: boolean): void {
    for (const p of this.parts) p.setWeightless(on);
  }

  get noCollide(): boolean {
    return this.parts.length > 0 && this.parts.every((p) => p.noCollideAll);
  }

  setNoCollide(on: boolean): void {
    for (const p of this.parts) {
      p.setNoCollideAll(on);
      p.refreshTint();
    }
  }

  setOutline(on: boolean, color?: number): void {
    for (const p of this.parts) if (!p.destroyed) p.setOutline(on, color);
  }

  /** Mass-weighted center of the entity. */
  center(): V2 {
    let mx = 0;
    let my = 0;
    let m = 0;
    for (const p of this.parts) {
      if (p.destroyed) continue;
      const pm = Math.max(0.01, p.frozen ? 1 : p.mass);
      const t = p.body.translation();
      mx += t.x * pm;
      my += t.y * pm;
      m += pm;
    }
    return m > 0 ? { x: mx / m, y: my / m } : { x: 0, y: 0 };
  }

  /** Mass used to scale the drag spring (things this entity is stuck to count too). */
  dragMass(): number {
    return this.totalMass();
  }

  private massAt = -1;
  private massNow = 0;

  /** What its parts that move weigh together: added up once a step (or again, see massChanged()). */
  totalMass(): number {
    const step = this.game.physics.stepCount;
    if (this.massAt !== step) {
      let m = 0;
      for (const p of this.parts) if (!p.destroyed && !p.frozen) m += p.mass;
      this.massNow = m;
      this.massAt = step;
    }
    return this.massNow;
  }

  /** A part of it has gone, been frozen or let go, or has a new collider: totalMass() adds them up again. */
  massChanged(): void {
    this.massAt = -1;
  }

  private bodySpeedAt = -1;
  private bodySpeedNow = 0;

  /**
   * How fast its middle (its centre of mass, the parts still joined on) is going
   * this step, m/s: what a fall or a throw carries, not a limb flailing about.
   */
  bodySpeed(): number {
    if (this.bodySpeedAt !== this.game.time) {
      let mx = 0;
      let my = 0;
      let m = 0;
      for (const p of this.parts) {
        if (p.destroyed || p.detached || p.frozen) continue;
        const pm = p.mass;
        mx += p.vx * pm;
        my += p.vy * pm;
        m += pm;
      }
      this.bodySpeedNow = m ? Math.hypot(mx, my) / m : 0;
      this.bodySpeedAt = this.game.time;
    }
    return this.bodySpeedNow;
  }

  /** The parts still joined to `p` through this entity's own joints, `p` first (a severed head: just itself). */
  connectedParts(p: Part): Part[] {
    const out = [p];
    const seen = new Set([p.body.handle]);
    for (let i = 0; i < out.length; i++) {
      const h = out[i].body.handle;
      for (const j of this.joints) {
        if (!j.isValid()) continue;
        const a = j.body1().handle;
        const b = j.body2().handle;
        const other = a === h ? b : b === h ? a : -1;
        if (other < 0 || seen.has(other)) continue;
        seen.add(other);
        const q = this.parts.find((x) => !x.destroyed && x.body.handle === other);
        if (q) out.push(q);
      }
    }
    return out;
  }

  /**
   * What a hand dragging `p` of a limp body pulls with (see Controls'
   * beginGrab()): the mass of what's joined to it, frozen parts aside.
   */
  limpMass(p: Part): number {
    return this.connectedParts(p).reduce((s, q) => s + (q.frozen ? 0 : q.mass), 0);
  }

  /** Moves the whole entity rigidly by (dx, dy). */
  translate(dx: number, dy: number): void {
    for (const p of this.parts) {
      if (p.destroyed) continue;
      const t = p.body.translation();
      p.teleport(t.x + dx, t.y + dy, p.body.rotation());
    }
  }

  /** Rotates the whole entity rigidly about a pivot. */
  rotateAbout(cx: number, cy: number, angle: number): void {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    for (const p of this.parts) {
      if (p.destroyed) continue;
      const t = p.body.translation();
      const dx = t.x - cx;
      const dy = t.y - cy;
      p.teleport(cx + dx * c - dy * s, cy + dx * s + dy * c, p.body.rotation() + angle);
      const v = p.body.linvel();
      p.body.setLinvel({ x: v.x * c - v.y * s, y: v.x * s + v.y * c }, true);
    }
  }

  setVelocity(vx: number, vy: number, av = 0): void {
    for (const p of this.parts) {
      if (p.destroyed || p.frozen) continue;
      p.body.setLinvel({ x: vx, y: vy }, true);
      p.body.setAngvel(av, true);
    }
  }

  serialize(): EntityState {
    return {
      def: this.def.id,
      flip: this.flipped,
      parts: this.parts.map((p) => {
        if (p.destroyed) return { x: 0, y: 0, a: 0, vx: 0, vy: 0, av: 0, frozen: false, hp: -1 };
        const t = p.body.translation();
        const v = p.body.linvel();
        const s: PartState = { x: t.x, y: t.y, a: p.body.rotation(), vx: v.x, vy: v.y, av: p.body.angvel(), frozen: p.frozen, hp: p.hp };
        if (p.burning > 0) s.burn = p.burning;
        if (p.charred > 0) s.char = p.charred;
        if (p.oil > 0) s.oil = p.oil;
        if (p.weightless) s.weightless = true;
        const paint = p.paintData();
        if (paint) s.paint = paint;
        return s;
      }),
      ...(this.config ? { config: this.config } : {}),
      ...(this.layered ? { z: this.zBase } : {}),
      extra: this.serializeExtra(),
    };
  }

  /**
   * Puts it in front of or behind other things (its drawing depth: Bring to
   * front, Send to back in its menu). Kept in saves and copies.
   */
  setDepth(z: number): void {
    this.zBase = z;
    this.layered = true;
    for (const p of this.parts) if (!p.destroyed) p.updateZ();
  }

  protected serializeExtra(): Record<string, unknown> | undefined {
    return undefined;
  }

  restore(s: EntityState): void {
    if (typeof s.z === 'number' && Number.isFinite(s.z)) this.setDepth(s.z);
    s.parts.forEach((ps, i) => {
      const p = this.parts[i];
      if (!p) return;
      if (ps.hp === -1) {
        this.removePart(p);
        return;
      }
      p.teleport(ps.x, ps.y, ps.a);
      p.body.setLinvel({ x: ps.vx, y: ps.vy }, true);
      p.body.setAngvel(ps.av, true);
      p.hp = ps.hp;
      p.charred = ps.char ?? 0;
      p.oil = ps.oil ?? 0;
      if (ps.burn) this.game.fire.ignite(p, ps.burn);
      if (ps.frozen) p.setFrozen(true);
      if (ps.weightless) p.setWeightless(true);
    });
    if (s.extra) this.restoreExtra(s.extra);
    // after the extra state, which may change a part's art (a lamp turned on)
    s.parts.forEach((ps, i) => {
      const p = this.parts[i];
      if (p && !p.destroyed && ps.paint) p.restorePaint(ps.paint);
    });
  }

  protected restoreExtra(_extra: Record<string, unknown>): void {}

  /** References to other entities (by snapshot index via `ref`, -1 if absent). */
  serializeLinks(_ref: (e: Entity) => number): Record<string, unknown> | undefined {
    return undefined;
  }

  restoreLinks(_links: Record<string, unknown>, _get: (i: number) => Entity | undefined): void {}

  /** Parts welded/hinged to this entity don't collide with any of its parts (motors). */
  attachIgnoresBody = false;

  /** Entities that should move with this one when it is flipped (held items). */
  attachedEntities(): Entity[] {
    return [];
  }

  /** Removes a single part (e.g. a gibbed limb). */
  removePart(p: Part): void {
    if (p.destroyed) return;
    this.game.onPartRemoved(p);
    for (let i = this.joints.length - 1; i >= 0; i--) {
      const j = this.joints[i];
      if (!j.isValid() || j.body1() === p.body || j.body2() === p.body) this.joints.splice(i, 1);
    }
    p.destroy();
    if (this.parts.every((q) => q.destroyed)) this.game.remove(this);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const p of this.parts) this.game.onPartRemoved(p);
    // joints attached to removed bodies are removed by Rapier automatically
    this.joints.length = 0;
    for (const p of this.parts) p.destroy();
    this.onDestroy();
  }

  protected onDestroy(): void {}
}
