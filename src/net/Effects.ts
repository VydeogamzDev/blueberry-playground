import type { RAPIER } from '../engine/Physics';
import type { Game } from '../world/Game';
import { Part } from '../world/Part';
import type { Entity } from '../world/Entity';
import type { EmitOpts } from '../systems/Particles';
import type { BulletOpts } from '../systems/Projectiles';
import type { CaseLook } from '../systems/Casings';

/** A part as named in a multiplayer game: its entity's net id and its place in the entity's parts. */
export type PartRef = [number, number];

/** One effect as sent to guests: a code and its arguments (numbers, strings, plain objects, part refs). */
export type Fx = [string, ...unknown[]];

/** A looping sound held this tick: who holds it (a number), the sound, gain, x and rate. */
export type Hold = [number, string, number, number | null, number];

/** What the host records: method names on each system, by the code they're sent as. */
const SOUND = { sp: 'play' } as const;
const PARTICLES = { pe: 'emit', pb: 'blood', pl: 'liquid', ps: 'sparks', pd: 'debris', pk: 'smoke', pf: 'fire', px: 'flash' } as const;
const RENDERER = { la: 'addLight', sh: 'shake' } as const;
const PROJECTILES = { bf: 'fire', bm: 'drawBeam' } as const;
const CASINGS = { ce: 'eject' } as const;
const STAINS = { st: 'add', sc: 'clear' } as const;
/** (and mended: whole and clean again, a limb's chunks filled in by Regen, a thing repaired) */
const PAINT = { pp: 'paintPixel', pa: 'paintAtPixel', pc: 'carve', pr: 'repair' } as const;

type Wrapped = { target: object; name: string; own: boolean; orig: unknown };

/** The part (and so the entity) a rigid body belongs to. */
function partOfBody(game: Game, b: RAPIER.RigidBody | null | undefined): Part | null {
  if (!b || !b.isValid() || b.numColliders() === 0) return null;
  return game.physics.partOf(b.collider(0)) ?? null;
}

export function refOf(p: Part | null | undefined): PartRef | null {
  if (!p || p.destroyed || !p.entity.netId) return null;
  return [p.entity.netId, p.entity.parts.indexOf(p)];
}

/**
 * The host's side: everything its game does for show (sounds, particles, blood
 * and scorch painted on things, stains, lights, shaking, tracers) is recorded as
 * it's done, to be sent to the guests with the next tick and done again there.
 * What each screen makes for itself is left out: what's done while a frame is
 * drawn (lamps, the cursor's power ring), and what's muted (fire's flames: the
 * guests make those from how much things burn). Methods called from inside a
 * recorded one (blood's droplets are emits) aren't recorded again.
 */
export class FxRecorder {
  list: Fx[] = [];
  /** Looping sounds held since the last tick, the latest call for each. */
  readonly holds = new Map<string, Hold>();
  private depth = 0;
  private wrapped: Wrapped[] = [];
  private owners = new WeakMap<object, number>();
  private nextOwner = 1;

  constructor(private game: Game) {
    const g = game;
    const enc = (p: Part | null | undefined) => refOf(p);
    const body = (b: RAPIER.RigidBody | null | undefined) => refOf(partOfBody(g, b));
    this.wrap(g.sound, SOUND, (code, a) => [code, a[0], a[1] ?? {}]);
    this.wrap(g.particles, PARTICLES, (code, a) => {
      if (code === 'pe') {
        const o = { ...((a[3] as EmitOpts | undefined) ?? {}) } as Record<string, unknown>;
        const ign = body(o.ignore as RAPIER.RigidBody | null | undefined);
        delete o.ignore;
        if (ign) o.ignore = ign;
        return [code, a[0], a[1], a[2], o];
      }
      // blood's and a liquid's last argument is the body the drops pass through
      if (code === 'pb') return [code, a[0], a[1], a[2], a[3], a[4], a[5] ?? 2.5, body(a[6] as RAPIER.RigidBody | null)];
      if (code === 'pl') return [code, a[0], a[1], a[2], a[3], a[4], a[5], a[6] ?? 2.5, a[7] ?? 0.55, body(a[8] as RAPIER.RigidBody | null)];
      return [code, ...a];
    });
    this.wrap(g.renderer, RENDERER, (code, a) => {
      // a light for this frame only lasts till the next tick's
      if (code === 'la' && !((a[5] as number) > 0)) return [code, a[0], a[1], a[2], a[3], a[4] ?? 0xffe8b0, 0.06];
      return [code, ...a];
    });
    this.wrap(g.projectiles, PROJECTILES, (code, a) => {
      if (code === 'bf') {
        const o = a[5] as BulletOpts;
        return [code, a[0], a[1], a[2], a[3], a[4], { energy: o.energy, damage: 0, life: o.life, tracer: o.tracer, ignore: body(o.ignore) }];
      }
      return [code, ...a];
    });
    this.wrap(g.stains, STAINS, (code, a) => [code, ...a]);
    // (not the gun it came out of: a guest's case is only for show)
    this.wrap(g.casings, CASINGS, (code, a) => [code, ...a.slice(0, 7)]);
    // painting is the same for every part: on the class, with the part as the first argument
    this.wrap(Part.prototype, PAINT, (code, a, self) => {
      const r = enc(self as Part);
      return r ? [code, r, ...a] : null;
    });
    // a looping sound is kept for the guests while it's held
    const sound = g.sound;
    const hold = sound.hold;
    const rec = this;
    sound.hold = function (owner: object, key: string, gain: number, x?: number, rate = 1) {
      if (rec.recording()) {
        const id = rec.ownerId(owner);
        rec.holds.set(`${id}:${key}`, [id, key, gain, x ?? null, rate]);
      }
      return hold.call(this, owner, key, gain, x, rate);
    };
    this.wrapped.push({ target: sound, name: 'hold', own: false, orig: hold });
  }

  /** Effects are recorded outside frames and mutes, and not from inside another recorded one. */
  private recording(): boolean {
    return this.depth === 0 && !this.game.inFrame && this.game.fxMute === 0;
  }

  private ownerId(o: object): number {
    let id = this.owners.get(o);
    if (!id) this.owners.set(o, (id = this.nextOwner++));
    return id;
  }

  private wrap(target: object, names: Record<string, string>, encode: (code: string, args: unknown[], self: unknown) => Fx | null): void {
    const t = target as Record<string, (...a: unknown[]) => unknown>;
    for (const [code, name] of Object.entries(names)) {
      const orig = t[name];
      const own = Object.prototype.hasOwnProperty.call(t, name);
      const rec = this;
      t[name] = function (this: unknown, ...args: unknown[]) {
        if (rec.recording()) {
          const fx = encode(code, args, this);
          if (fx) rec.list.push(fx);
        }
        rec.depth++;
        try {
          return orig.apply(this, args);
        } finally {
          rec.depth--;
        }
      };
      this.wrapped.push({ target, name, own, orig });
    }
  }

  /** The effects since the last call, and the loops held meanwhile. */
  take(): { fx: Fx[]; holds: Hold[] } {
    const fx = this.list;
    this.list = [];
    const holds = [...this.holds.values()];
    this.holds.clear();
    return { fx, holds };
  }

  /** Puts the systems' own methods back. */
  dispose(): void {
    for (const w of this.wrapped.reverse()) {
      const t = w.target as Record<string, unknown>;
      if (w.own) t[w.name] = w.orig;
      else delete t[w.name];
    }
    this.wrapped = [];
  }
}

/** Seconds a guest keeps a looping sound going after the last tick that held it. */
const HOLD_FOR = 0.15;

/** The guest's side: does the host's effects again (see FxRecorder). */
export class FxPlayer {
  private holds = new Map<string, { h: Hold; t: number }>();
  private owners = new Map<number, object>();

  constructor(private game: Game, private part: (r: PartRef | null | undefined) => Part | null) {}

  private body(r: unknown): RAPIER.RigidBody | null {
    const p = this.part(r as PartRef | null);
    return p ? p.body : null;
  }

  play(list: Fx[]): void {
    for (const fx of list) {
      try {
        this.one(fx);
      } catch (e) {
        // (one odd effect mustn't stop the rest)
        console.warn('effect failed', fx[0], e);
      }
    }
  }

  private one(fx: Fx): void {
    const g = this.game;
    const a = fx as unknown[];
    const n = (i: number) => a[i] as number;
    switch (fx[0]) {
      case 'sp': g.sound.play(a[1] as string, a[2] as object); break;
      case 'pe': {
        const o = { ...(a[4] as Record<string, unknown>) };
        o.ignore = this.body(o.ignore);
        g.particles.emit(n(1), n(2), n(3), o as EmitOpts);
        break;
      }
      case 'pb': g.particles.blood(n(1), n(2), n(3), n(4), n(5), n(6), this.body(a[7])); break;
      case 'pl': g.particles.liquid(n(1), n(2), n(3), n(4), n(5), n(6), n(7), n(8), this.body(a[9])); break;
      case 'ps': g.particles.sparks(n(1), n(2), n(3), n(4), n(5), a[6] as number | undefined); break;
      case 'pd': g.particles.debris(n(1), n(2), n(3), n(4), n(5), n(6), a[7] as number | undefined); break;
      case 'pk': g.particles.smoke(n(1), n(2), n(3), a[4] as number | undefined, a[5] as boolean | undefined); break;
      case 'pf': g.particles.fire(n(1), n(2), n(3)); break;
      case 'px': g.particles.flash(n(1), n(2), n(3), a[4] as number | undefined, a[5] as number | undefined); break;
      case 'la': g.renderer.addLight(n(1), n(2), n(3), n(4), a[5] as number | undefined, a[6] as number | undefined); break;
      case 'sh': g.renderer.shake(n(1)); break;
      case 'bf': {
        const o = a[6] as { energy: number; life?: number; tracer?: boolean; ignore: PartRef | null };
        g.projectiles.fire(n(1), n(2), n(3), n(4), n(5), { energy: o.energy, damage: 0, life: o.life, tracer: o.tracer, ignore: this.body(o.ignore) });
        break;
      }
      case 'bm': g.projectiles.drawBeam(n(1), n(2), n(3), n(4), n(5), n(6), a[7] as number | undefined, a[8] as number | undefined); break;
      case 'st': g.stains.add(n(1), n(2), n(3), n(4), n(5), a[6] as number | undefined); break;
      case 'sc': g.stains.clear(); break;
      case 'ce': g.casings.eject(n(1), n(2), n(3), n(4), a[5] as CaseLook | undefined, a[6] as number | undefined, a[7] as number | undefined); break;
      case 'pp': this.part(a[1] as PartRef)?.paintPixel(n(2), n(3), n(4), a[5] as number | undefined); break;
      case 'pa': this.part(a[1] as PartRef)?.paintAtPixel(n(2), n(3), n(4), a[5] as number | undefined, a[6] as number | undefined); break;
      case 'pc': if (Array.isArray(a[2])) this.part(a[1] as PartRef)?.carve(a[2] as number[], Array.isArray(a[3]) ? (a[3] as number[]) : []); break;
      case 'pr': this.part(a[1] as PartRef)?.repair(); break;
    }
  }

  /** The loops the host held this tick: kept going until a tick comes without them. */
  hold(list: Hold[]): void {
    const t = performance.now() / 1000;
    for (const h of list) this.holds.set(`${h[0]}:${h[1]}`, { h, t });
  }

  /** Each frame: holds the loops that are still going. */
  frame(): void {
    const t = performance.now() / 1000;
    for (const [k, { h, t: at }] of this.holds) {
      if (t - at > HOLD_FOR) {
        this.holds.delete(k);
        continue;
      }
      let owner = this.owners.get(h[0]);
      if (!owner) this.owners.set(h[0], (owner = {}));
      this.game.sound.hold(owner, h[1], h[2], h[3] ?? undefined, h[4]);
    }
  }

  clear(): void {
    this.holds.clear();
  }
}

/** Entities as listed for the guests: by net id. */
export function byNetId(list: Entity[]): Map<number, Entity> {
  const m = new Map<number, Entity>();
  for (const e of list) if (e.netId && !e.destroyed) m.set(e.netId, e);
  return m;
}
