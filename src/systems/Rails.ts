import type { Game } from '../world/Game';
import type { Entity } from '../world/Entity';
import type { Part } from '../world/Part';
import type { RailContact, RailRider, Track } from '../entities/Rails';

/** How far (m) past touching a wheel may be from a rail to take hold of it, and how far off it has to be knocked to come off. */
const TAKE = 0.14;
const DERAIL = 0.6;
/** How hard a contact is pulled back onto its line (share of the error a step), and the passes over a unit's contacts. */
const BETA = 0.25;
const PASSES = 4;
/** How hard a drive track pushes what rides it (m/s²). */
const DRIVE_ACCEL = 7;
/** A launch (a drive this fast, m/s, or more) pushes far harder: about 2 g, as a real launched coaster does. */
const LAUNCH_FROM = 10;
const LAUNCH_ACCEL = 20;

/** A contact on a track: which, which side of it, and the segment it was last on. */
interface On {
  track: Track;
  side: number;
  seg: number;
}

/** Where on a track's line a point is nearest: the segment, the point there, the line's way and left normal, how far along (0..1). */
interface Near {
  seg: number;
  x: number;
  y: number;
  tx: number;
  ty: number;
  t: number;
  d2: number;
}

/**
 * Rails (0.4.0): what has rail contacts (entities/Rails: a rail wheel, a coaster car)
 * holds to the track it's brought to. After each physics step (and the welded units
 * made one: see WeldUnits), each unit with contacts on track is given, as one rigid
 * body, the impulses that keep each contact its wheel's radius off the rail's line, on
 * the side it took hold from: it rolls along freely and can't leave, over a crest or
 * upside down round a loop. Off the end of a track it rolls off (onto the next, if
 * one's there).
 */
export class Rails {
  private tracks = new Set<Track>();
  private riders = new Set<Entity & RailRider>();
  private on = new Map<RailContact, On>();

  constructor(private game: Game) {}

  /**
   * Riders never touch track (they're held to it: see step()), so where a loop's way out
   * crosses its way in (in a flat picture, the rails cross), a car goes through.
   */
  private apart(r: Entity & RailRider, t: Track): void {
    for (const c of r.railContacts()) {
      if (c.part.destroyed || t.main.destroyed) continue;
      c.part.noCollideWith(t.main);
      t.main.noCollideWith(c.part);
    }
  }

  addTrack(t: Track): void {
    this.tracks.add(t);
    for (const r of this.riders) if (!r.destroyed) this.apart(r, t);
    for (const p of this.aboard) if (!p.destroyed && !t.main.destroyed) {
      p.noCollideWith(t.main);
      t.main.noCollideWith(p);
    }
  }

  /** Who rides in what rides the rails (a coaster car's rider): their parts don't touch track either, while they're in it. */
  private aboard = new Set<Part>();
  private aboardT = 0;

  private lookAboard(): void {
    const now = new Set<Part>();
    for (const r of this.riders) {
      if (r.destroyed) continue;
      for (const a of r.attachedEntities()) for (const p of a.parts) if (!p.destroyed) now.add(p);
    }
    for (const p of now) {
      if (this.aboard.has(p)) continue;
      for (const t of this.tracks) if (!t.main.destroyed) {
        p.noCollideWith(t.main);
        t.main.noCollideWith(p);
      }
    }
    for (const p of this.aboard) {
      if (now.has(p) || p.destroyed) continue;
      for (const t of this.tracks) if (!t.main.destroyed) {
        p.collideWith(t.main);
        t.main.collideWith(p);
      }
    }
    this.aboard = now;
  }

  removeTrack(t: Track): void {
    this.tracks.delete(t);
    for (const [c, o] of this.on) if (o.track === t) this.on.delete(c);
  }

  addRider(r: Entity & RailRider): void {
    this.riders.add(r);
    for (const t of this.tracks) if (!t.destroyed) this.apart(r, t);
  }

  removeRider(r: Entity & RailRider): void {
    this.riders.delete(r);
    for (const c of r.railContacts()) this.on.delete(c);
  }

  /** Is this contact on a track? */
  isOn(c: RailContact): boolean {
    return this.on.has(c);
  }

  /** The track a contact is on, if any. */
  trackOf(c: RailContact): Track | null {
    return this.on.get(c)?.track ?? null;
  }

  clear(): void {
    this.tracks.clear();
    this.riders.clear();
    this.on.clear();
  }

  /** The contact's point in the world now. */
  private pointOf(c: RailContact): { x: number; y: number } {
    const b = c.part.body;
    const t = b.translation();
    const r = b.rotation();
    const co = Math.cos(r);
    const s = Math.sin(r);
    return { x: t.x + c.lx * co - c.ly * s, y: t.y + c.lx * s + c.ly * co };
  }

  /** The nearest point to (x, y) on segments `from`..`to` of a track's line. */
  private nearest(t: Track, x: number, y: number, from = 0, to = Infinity): Near | null {
    const l = t.world();
    const n = l.length - 1;
    if (n < 1) return null;
    let best: Near | null = null;
    const lo = Math.max(0, from);
    const hi = Math.min(n - 1, to);
    for (let i = lo; i <= hi; i++) {
      const a = l[i];
      const b = l[i + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const L2 = dx * dx + dy * dy;
      if (L2 <= 1e-9) continue;
      const k = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / L2));
      const px = a.x + dx * k;
      const py = a.y + dy * k;
      const d2 = (x - px) ** 2 + (y - py) ** 2;
      if (!best || d2 < best.d2) {
        const L = Math.sqrt(L2);
        best = { seg: i, x: px, y: py, tx: dx / L, ty: dy / L, t: k, d2 };
      }
    }
    return best;
  }

  /** A track to take hold of near a free contact, and where on it. */
  private find(c: RailContact, P: { x: number; y: number }): { track: Track; near: Near } | null {
    const reach = c.r + TAKE;
    let best: { track: Track; near: Near } | null = null;
    for (const t of this.tracks) {
      if (t.destroyed) continue;
      t.world();
      const b = t.bounds;
      if (P.x < b.x0 - reach || P.x > b.x1 + reach || P.y < b.y0 - reach || P.y > b.y1 + reach) continue;
      const n = this.nearest(t, P.x, P.y);
      if (!n || n.d2 > reach * reach) continue;
      // (not off its very end)
      const last = t.world().length - 2;
      if ((n.seg === 0 && n.t <= 0) || (n.seg === last && n.t >= 1)) continue;
      if (!best || n.d2 < best.near.d2) best = { track: t, near: n };
    }
    return best;
  }

  /** Runs just after the physics step and WeldUnits, before poses are read. */
  step(dt: number): void {
    const g = this.game;
    if (!this.riders.size || !this.tracks.size || g.net?.guest || !(dt > 0)) return;
    if ((this.aboardT -= dt) <= 0) {
      this.aboardT = 0.1;
      this.lookAboard();
    }
    // each contact: on, taking hold, or come off
    const work = new Map<Part[], { c: RailContact; o: On; near: Near }[]>();
    for (const r of this.riders) {
      if (r.destroyed) continue;
      for (const c of r.railContacts()) {
        if (c.part.destroyed || c.part.frozen) {
          this.on.delete(c);
          continue;
        }
        const P = this.pointOf(c);
        let o = this.on.get(c);
        let near: Near | null = null;
        if (o && !o.track.destroyed) {
          const l = o.track.world();
          near = this.nearest(o.track, P.x, P.y, o.seg - 6, o.seg + 6);
          // (a closed loop goes round: near either end, look at the other too)
          if (near && o.track.closed && (near.seg <= 1 || near.seg >= l.length - 3)) near = this.nearest(o.track, P.x, P.y);
          const last = l.length - 2;
          const offEnd = !!near && !o.track.closed && ((near.seg === 0 && near.t <= 0) || (near.seg === last && near.t >= 1));
          if (!near || offEnd || near.d2 > (c.r + DERAIL) ** 2) {
            this.on.delete(c);
            o = undefined;
            near = null;
          }
        } else if (o) {
          this.on.delete(c);
          o = undefined;
        }
        if (!o) {
          const f = this.find(c, P);
          if (!f) continue;
          near = f.near;
          const nx = -near.ty;
          const ny = near.tx;
          o = { track: f.track, side: (P.x - near.x) * nx + (P.y - near.y) * ny >= 0 ? 1 : -1, seg: near.seg };
          this.on.set(c, o);
        }
        o.seg = near!.seg;
        const unit = g.weldUnits.unitOf(c.part) ?? [c.part];
        let list = work.get(unit);
        if (!list) work.set(unit, (list = []));
        list.push({ c, o, near: near! });
      }
    }
    for (const [unit, list] of work) this.hold(unit, list, dt);
  }

  /** Keeps a unit's contacts on their lines (see the class), as one rigid body. */
  private hold(unit: Part[], list: { c: RailContact; o: On; near: Near }[], dt: number): void {
    for (const p of unit) if (p.destroyed || p.frozen) return;
    if (unit[0].body.isSleeping()) return;
    let m = 0;
    let cx = 0;
    let cy = 0;
    let px = 0;
    let py = 0;
    for (const p of unit) {
      const b = p.body;
      const mi = b.mass();
      const c = b.worldCom();
      const v = b.linvel();
      m += mi;
      cx += mi * c.x;
      cy += mi * c.y;
      px += mi * v.x;
      py += mi * v.y;
    }
    if (!(m > 0)) return;
    cx /= m;
    cy /= m;
    let L = 0;
    let I = 0;
    for (const p of unit) {
      const b = p.body;
      const mi = b.mass();
      const c = b.worldCom();
      const v = b.linvel();
      const rx = c.x - cx;
      const ry = c.y - cy;
      L += b.principalInertia() * b.angvel() + mi * (rx * v.y - ry * v.x);
      I += b.principalInertia() + mi * (rx * rx + ry * ry);
    }
    if (!(I > 0)) return;
    let vx = px / m;
    let vy = py / m;
    let w = L / I;
    // the contacts' points, normals and errors (fixed for this step's passes)
    const rows = list.map(({ c, o, near }) => {
      const P = this.pointOf(c);
      const nx = -near.ty * o.side;
      const ny = near.tx * o.side;
      const err = (P.x - near.x) * nx + (P.y - near.y) * ny - (c.r + 1.5 / 32);
      return { rx: P.x - cx, ry: P.y - cy, nx, ny, tx: near.tx, ty: near.ty, err, drive: o.track.drive };
    });
    for (let pass = 0; pass < PASSES; pass++) {
      for (const q of rows) {
        const vn = (vx - w * q.ry) * q.nx + (vy + w * q.rx) * q.ny;
        const rn = q.rx * q.ny - q.ry * q.nx;
        const k = 1 / m + (rn * rn) / I;
        const lam = -(vn + (BETA * q.err) / dt) / k;
        vx += (lam * q.nx) / m;
        vy += (lam * q.ny) / m;
        w += (lam * rn) / I;
      }
    }
    // drive tracks: pushed along (the way the track was laid) up to its speed
    for (const q of rows) {
      if (!q.drive) continue;
      const vt = (vx - w * q.ry) * q.tx + (vy + w * q.rx) * q.ty;
      if (vt >= q.drive) continue;
      const rt = q.rx * q.ty - q.ry * q.tx;
      const k = 1 / m + (rt * rt) / I;
      const dv = Math.min(q.drive - vt, ((q.drive >= LAUNCH_FROM ? LAUNCH_ACCEL : DRIVE_ACCEL) * dt) / rows.length);
      const lam = dv / k;
      vx += (lam * q.tx) / m;
      vy += (lam * q.ty) / m;
      w += (lam * rt) / I;
    }
    for (const p of unit) {
      const b = p.body;
      const c = b.worldCom();
      b.setLinvel({ x: vx - w * (c.y - cy), y: vy + w * (c.x - cx) }, false);
      b.setAngvel(w, false);
    }
  }
}
