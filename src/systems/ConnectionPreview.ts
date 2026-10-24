import * as THREE from 'three';
import { PX } from '../engine/constants';
import type { V2 } from '../engine/math';
import type { Game } from '../world/Game';
import { LineBatch, RAMPS, type ConnKind } from './Connections';
import { GUNMETAL, STEEL } from '../art/palette';

/** A connection about to be made, drawn see-through where it will go. */
export interface ConnGhost {
  kind: ConnKind;
  a: V2;
  b: V2;
  /** A rope's or spring's length (a rope slacker than the distance sags); none: the distance. */
  rest?: number;
  /** Can't be made as it is (drawn red). */
  bad?: boolean;
  /** Its far end is on the background (a wall plug is drawn there). */
  wall?: boolean;
  /** Its first end is on the background (a rope or spring from the wall). */
  wallA?: boolean;
}

/** Red, for a connection that can't be made. */
const BAD = 0xd8463a;
/** How long (s) the anchors of a connection just made flash. */
const FLASH = 0.3;

/**
 * The connection tools' preview: ghosts of the connections about to be made, in
 * their kinds' real look (a weld's rod, a rope sagging from its length, a
 * spring's coils, a wire), see-through, over everything; and a flash at the ends
 * of ones just made.
 */
export class ConnectionPreview {
  private lines: LineBatch;
  /** What to draw this frame (the connection tools set it each frame). */
  ghosts: ConnGhost[] = [];
  private flashes: { at: V2; t: number }[] = [];

  constructor(game: Game) {
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: 0.6, depthWrite: false });
    this.lines = new LineBatch(512, 44.5, mat);
    game.renderer.scene.add(this.lines.mesh);
    game.frameHandlers.push((dt) => this.frame(dt));
  }

  /** The ends of a connection just made flash for a moment. */
  flash(points: V2[]): void {
    for (const at of points) this.flashes.push({ at: { ...at }, t: FLASH });
  }

  private frame(dt: number): void {
    const L = this.lines;
    L.begin();
    for (const g of this.ghosts) this.ghost(g);
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.t -= dt;
      if (f.t <= 0) {
        this.flashes.splice(i, 1);
        continue;
      }
      const s = PX * (4 + (1 - f.t / FLASH) * 8);
      L.quad(f.at.x, f.at.y, s, 0xfff4c4);
    }
    L.end();
  }

  private ghost(g: ConnGhost): void {
    const L = this.lines;
    const R = RAMPS[g.kind];
    const col = (i: number) => (g.bad ? BAD : R[i]);
    const { a, b } = g;
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    switch (g.kind) {
      case 'weld':
        if (d > PX * 3) {
          L.seg(a.x, a.y, b.x, b.y, PX * 2.5, g.bad ? BAD : STEEL[0]);
          L.seg(a.x, a.y, b.x, b.y, PX * 1.5, g.bad ? BAD : STEEL[3]);
        }
        L.quad(a.x, a.y, PX * 4, g.bad ? BAD : STEEL[0]);
        L.quad(a.x, a.y, PX * 3, g.bad ? BAD : STEEL[3]);
        L.quad(b.x, b.y, PX * 3, col(3));
        break;
      case 'hinge':
      case 'pin':
        // the knot where it turns, and a thin line out to what it holds
        if (d > PX * 3) this.dashed(a, b, col(3));
        L.quad(a.x, a.y, PX * 5, col(0));
        L.quad(a.x, a.y, PX * 4, col(3));
        L.quad(a.x, a.y, PX * 1.5, col(0));
        break;
      case 'rope':
      case 'fuse': {
        const rest = g.rest ?? d;
        const sag = d < rest ? Math.sqrt(Math.max(0, rest * rest - d * d)) * 0.5 : 0;
        this.curve(a, b, sag, PX * 2.5, col(0));
        this.curve(a, b, sag, PX * 1.5, col(3));
        // stretched past its length: it will pull (a tick across it where its length runs out)
        if (rest < d - PX) {
          const t = rest / d;
          const x = a.x + (b.x - a.x) * t;
          const y = a.y + (b.y - a.y) * t;
          L.quad(x, y, PX * 3, col(4));
        }
        L.quad(a.x, a.y, PX * 3, col(1));
        L.quad(b.x, b.y, PX * 3, col(1));
        break;
      }
      case 'spring': {
        const coils = 12;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const n = d || 1;
        const nx = -dy / n;
        const ny = dx / n;
        // (squeezed or stretched from the length it was given: the coils closer together or further apart)
        const k = g.rest !== undefined && d > 1e-3 ? Math.max(0.4, Math.min(2.5, g.rest / d)) : 1;
        for (const [w, c] of [[PX * 2, col(0)], [PX, col(3)]] as const) {
          let px = a.x;
          let py = a.y;
          for (let i = 1; i <= coils; i++) {
            const t = i / coils;
            const off = i === coils ? 0 : (i % 2 ? 1 : -1) * PX * 3 * k;
            const x = a.x + dx * t + nx * off;
            const y = a.y + dy * t + ny * off;
            L.seg(px, py, x, y, w, c);
            px = x;
            py = y;
          }
        }
        L.quad(a.x, a.y, PX * 3, g.bad ? BAD : STEEL[1]);
        L.quad(b.x, b.y, PX * 3, g.bad ? BAD : STEEL[1]);
        break;
      }
      case 'wire':
        this.curve(a, b, d * 0.08, PX * 2, col(0));
        this.curve(a, b, d * 0.08, PX, col(3));
        L.quad(a.x, a.y, PX * 2.5, g.bad ? BAD : GUNMETAL[2]);
        L.quad(b.x, b.y, PX * 2.5, g.bad ? BAD : GUNMETAL[2]);
        break;
    }
    if (g.wall) this.plug(b, g.bad);
    if (g.wallA) this.plug(a, g.bad);
  }

  /** A wall plug: where a connection will be tied to the background. */
  private plug(p: V2, bad?: boolean): void {
    const L = this.lines;
    const c = bad ? BAD : 0xe8e2cf;
    L.quad(p.x, p.y, PX * 6, 0x2a2622);
    L.quad(p.x, p.y, PX * 4, c);
    L.quad(p.x - PX * 1.2, p.y, PX * 1.2, 0x2a2622);
    L.quad(p.x + PX * 1.2, p.y, PX * 1.2, 0x2a2622);
  }

  /** A thin dashed line. */
  private dashed(a: V2, b: V2, col: number): void {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const n = Math.max(1, Math.floor(Math.hypot(dx, dy) / (PX * 4)));
    for (let k = 0; k < n; k += 2) {
      const t0 = k / n;
      const t1 = Math.min(1, (k + 1) / n);
      this.lines.seg(a.x + dx * t0, a.y + dy * t0, a.x + dx * t1, a.y + dy * t1, PX, col);
    }
  }

  /** A line from a to b sagging `sag` in its middle. */
  private curve(a: V2, b: V2, sag: number, w: number, col: number): void {
    const segs = sag > 0.01 ? 14 : 1;
    let px = a.x;
    let py = a.y;
    for (let k = 1; k <= segs; k++) {
      const t = k / segs;
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t - sag * 4 * t * (1 - t);
      this.lines.seg(px, py, x, y, w, col);
      px = x;
      py = y;
    }
  }
}
