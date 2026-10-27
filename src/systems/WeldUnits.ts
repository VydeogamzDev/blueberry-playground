import type { Game } from '../world/Game';
import type { Part } from '../world/Part';

/**
 * Keeps things welded together moving as one piece.
 *
 * Rapier holds a weld with a joint between two bodies, and a contraption is many of
 * them. Where a light part has several heavy ones welded round it (a short beam with
 * long wings either side and a frame on top), the solver doesn't quite settle the
 * welds in a step, and what it leaves over grows with every step: a player's rocket
 * of six beams, floating still in empty space, shook itself apart within two seconds
 * and flew off spinning at 100 rad/s. So after each step every welded unit's parts are
 * given the one motion the unit as a whole has, with the same momentum and angular
 * momentum. A unit already moving as one keeps exactly the motion it had (turning
 * about a hinge to the background, say): only the shaking between its parts goes.
 *
 * Units with a frozen part are left to the joints (that part can't take a share of the
 * motion, and a weld to something that can't move holds anyway).
 */
export class WeldUnits {
  /** Off: the welds alone hold things together (for comparisons). */
  enabled = true;
  /** The units of two or more parts, as the connections were at `at` (their version). */
  private units: Part[][] = [];
  private at = -1;
  /** Each part's mass, inertia, center of mass, velocity and spin, while one unit is worked out. */
  private s = new Float64Array(0);

  constructor(private game: Game) {}

  private refresh(): void {
    const C = this.game.connections;
    this.at = C.version;
    const parent = new Map<Part, Part>();
    const find = (p: Part): Part => {
      let r = p;
      while (parent.get(r) !== r) r = parent.get(r)!;
      parent.set(p, r);
      return r;
    };
    for (const k of C.list) {
      if (k.kind !== 'weld' || !k.b || !k.joint) continue;
      for (const p of [k.a, k.b]) if (!parent.has(p)) parent.set(p, p);
      parent.set(find(k.a), find(k.b));
    }
    const units = new Map<Part, Part[]>();
    for (const p of parent.keys()) {
      const r = find(p);
      let u = units.get(r);
      if (!u) units.set(r, (u = []));
      u.push(p);
    }
    this.units = [...units.values()];
    const most = this.units.reduce((n, u) => Math.max(n, u.length), 0);
    if (this.s.length < most * 7) this.s = new Float64Array(most * 7);
  }

  /** Runs just after each physics step, before the parts' poses are read from it. */
  step(): void {
    if (!this.enabled) return;
    if (this.at !== this.game.connections.version) this.refresh();
    for (const u of this.units) this.hold(u);
  }

  private hold(u: Part[]): void {
    for (const p of u) if (p.destroyed || p.frozen) return;
    // (a unit sleeps as one: its welds join it into one island)
    if (u[0].body.isSleeping()) return;
    const s = this.s;
    let m = 0;
    let cx = 0;
    let cy = 0;
    let px = 0;
    let py = 0;
    for (let i = 0; i < u.length; i++) {
      const b = u[i].body;
      const mi = b.mass();
      const c = b.worldCom();
      const v = b.linvel();
      s[i * 7] = mi;
      s[i * 7 + 1] = b.principalInertia();
      s[i * 7 + 2] = c.x;
      s[i * 7 + 3] = c.y;
      s[i * 7 + 4] = v.x;
      s[i * 7 + 5] = v.y;
      s[i * 7 + 6] = b.angvel();
      m += mi;
      cx += mi * c.x;
      cy += mi * c.y;
      px += mi * v.x;
      py += mi * v.y;
    }
    if (!(m > 0)) return;
    cx /= m;
    cy /= m;
    // the angular momentum and moment of inertia about the unit's center of mass
    let L = 0;
    let I = 0;
    for (let i = 0; i < u.length; i++) {
      const mi = s[i * 7];
      const rx = s[i * 7 + 2] - cx;
      const ry = s[i * 7 + 3] - cy;
      L += s[i * 7 + 1] * s[i * 7 + 6] + mi * (rx * s[i * 7 + 5] - ry * s[i * 7 + 4]);
      I += s[i * 7 + 1] + mi * (rx * rx + ry * ry);
    }
    if (!(I > 0)) return;
    const vx = px / m;
    const vy = py / m;
    const w = L / I;
    for (let i = 0; i < u.length; i++) {
      const b = u[i].body;
      const rx = s[i * 7 + 2] - cx;
      const ry = s[i * 7 + 3] - cy;
      b.setLinvel({ x: vx - w * ry, y: vy + w * rx }, false);
      b.setAngvel(w, false);
    }
  }
}
