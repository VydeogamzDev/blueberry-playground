import type { Game } from '../world/Game';
import type { Entity } from '../world/Entity';

/** How often (s) the power drawn and made is reckoned up. */
const EVERY = 0.25;

/** What a battery holds (J): about 100 Wh, so a lamp lasts hours and a motor at full most of an hour. */
export const BATTERY_J = 360_000;

/** What things draw (W) running, by item; anything else that runs on power draws DRAW_DEFAULT. Engines burn fuel and draw nothing. */
const DRAW: Record<string, number> = {
  light: 12, motor: 120, 'motor-wheel': 120, electromagnet: 400, 'tesla-coil': 2500, fan: 150, propeller: 150,
  'conveyor-belt': 250, winch: 400, siren: 30, servo: 60, piston: 120, 'sentry-turret': 100, 'laser-sentry': 300,
  'ceiling-turret': 100, chainsaw: 900, 'screen-part': 15, 'camera-part': 5,
  thruster: 0, 'mini-thruster': 0, 'hover-thruster': 0, 'jet-engine': 0, cockpit: 0,
};
const DRAW_DEFAULT = 20;

/** Something that stores power: a battery. */
export interface PowerStore {
  charge: number;
  capacity: number;
}

/** Something that makes power while it runs (W): a solar panel, a generator. */
interface PowerMaker {
  output: number;
}

const isStore = (e: Entity): e is Entity & PowerStore => typeof (e as Partial<PowerStore>).charge === 'number' && typeof (e as Partial<PowerStore>).capacity === 'number';
const isMaker = (e: Entity): e is Entity & PowerMaker => typeof (e as Partial<PowerMaker>).output === 'number';

/**
 * Power as a resource (0.4.0): what's running on each circuit draws from the batteries on
 * it, and what makes power there (solar panels, generators) runs it first and charges the
 * batteries with what's left. A battery run flat gives no power till it's charged (or
 * recharged from its menu). Settings' infinite fuel keeps batteries full too.
 */
export class Power {
  private t = 0;
  /** Each circuit's draw and supply at the last look (W), by any member (for the tests and readouts). */
  readonly last = new Map<Entity, { draw: number; made: number }>();

  constructor(private game: Game) {}

  /** What `e` draws (W) as it is now. */
  drawOf(e: Entity): number {
    if (e.destroyed || !e.usesPower || !e.powered) return 0;
    const run = (e as { running?: boolean }).running;
    if (run === false) return 0;
    const own = (e as { powerDraw?: () => number }).powerDraw;
    if (own) return own.call(e);
    const w = DRAW[e.def.id] ?? DRAW_DEFAULT;
    // (a motor turned up draws more)
    const k = (e as { speed?: number }).speed;
    return w * (typeof k === 'number' && (e.def.id === 'motor' || e.def.id === 'motor-wheel') ? Math.max(0.25, k) : 1) * Math.max(0.1, e.powerLevel);
  }

  step(dt: number): void {
    this.t += dt;
    if (this.t < EVERY) return;
    const span = this.t;
    this.t = 0;
    const g = this.game;
    const C = g.connections;
    this.last.clear();
    // circuits: everything joined by wires (through gates and all: one battery runs the lot)
    const seen = new Set<Entity>();
    let changed = false;
    for (const s of g.entities) {
      if (seen.has(s) || s.destroyed || !(isStore(s) || isMaker(s))) continue;
      const circuit: Entity[] = [s];
      seen.add(s);
      for (let i = 0; i < circuit.length; i++) {
        for (const { n } of C.wiresOf(circuit[i])) {
          if (seen.has(n) || n.destroyed) continue;
          seen.add(n);
          circuit.push(n);
        }
      }
      let draw = 0;
      let made = 0;
      const stores: (Entity & PowerStore)[] = [];
      for (const e of circuit) {
        draw += this.drawOf(e);
        if (isMaker(e)) made += e.output;
        if (isStore(e) && (e as { on?: boolean }).on !== false && e.works) stores.push(e);
      }
      this.last.set(s, { draw, made });
      if (g.fuel.mode === 'infinite') continue;
      let net = (made - draw) * span;
      if (!stores.length || Math.abs(net) < 1e-9) continue;
      // evenly from (or into) the batteries that can give (or take) it
      for (let pass = 0; pass < 3 && Math.abs(net) > 1e-6; pass++) {
        const can = stores.filter((b) => (net < 0 ? b.charge > 0 : b.charge < b.capacity));
        if (!can.length) break;
        const each = net / can.length;
        for (const b of can) {
          const was = b.charge;
          b.charge = Math.max(0, Math.min(b.capacity, b.charge + each));
          net -= b.charge - was;
          // (run flat, or back from flat: the power goes, or comes back)
          if ((was > 0) !== (b.charge > 0)) changed = true;
        }
      }
    }
    if (changed) C.recomputePower();
  }

  /** What the circuit `e` is on draws and makes (W), as at the last look. */
  circuitOf(e: Entity): { draw: number; made: number } | null {
    const C = this.game.connections;
    const seen = new Set<Entity>([e]);
    const list = [e];
    for (let i = 0; i < list.length; i++) {
      const r = this.last.get(list[i]);
      if (r) return r;
      for (const { n } of C.wiresOf(list[i])) if (!seen.has(n)) {
        seen.add(n);
        list.push(n);
      }
    }
    return null;
  }
}
