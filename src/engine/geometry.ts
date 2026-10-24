/** A 2D point as [x, y] (y up). */
export type Pt = [number, number];

const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

/** Signed area: positive when the points go round counter-clockwise. */
export function signedArea(pts: Pt[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

/** Do segments ab and cd cross (touching at a shared end doesn't count)? */
export function segmentsCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Does the closed outline cross itself? */
export function selfCrossing(pts: Pt[]): boolean {
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      // neighbouring edges share a corner
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      if (segmentsCross(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return true;
    }
  }
  return false;
}

/** The outline counter-clockwise, without repeated corners or ones on a straight line. */
export function cleanOutline(pts: Pt[], eps = 1e-6): Pt[] {
  let out = pts.filter((p, i) => {
    const q = pts[(i + 1) % pts.length];
    return Math.hypot(p[0] - q[0], p[1] - q[1]) > eps;
  });
  let changed = true;
  while (changed && out.length > 3) {
    changed = false;
    for (let i = 0; i < out.length; i++) {
      const a = out[(i + out.length - 1) % out.length];
      const b = out[(i + 1) % out.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      if (Math.abs(cross(a, out[i], b)) / len < eps * 10) {
        out.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  if (signedArea(out) < 0) out = out.reverse();
  return out;
}

const convexAt = (pts: Pt[], poly: number[], k: number) => {
  const n = poly.length;
  return cross(pts[poly[(k + n - 1) % n]], pts[poly[k]], pts[poly[(k + 1) % n]]) >= -1e-9;
};

/**
 * Splits a simple counter-clockwise outline into convex pieces (for colliders):
 * ear clipping into triangles, then neighbours merged back together wherever the
 * merged piece is still convex (Hertel-Mehlhorn). Returns corner lists.
 */
export function convexPieces(pts: Pt[]): Pt[][] {
  const n = pts.length;
  if (n < 3) return [];
  // ---- ear clipping
  const left = pts.map((_, i) => i);
  const tris: number[][] = [];
  const inside = (p: Pt, a: Pt, b: Pt, c: Pt) => cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0;
  let guard = n * n;
  while (left.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let k = 0; k < left.length; k++) {
      const ia = left[(k + left.length - 1) % left.length];
      const ib = left[k];
      const ic = left[(k + 1) % left.length];
      const [a, b, c] = [pts[ia], pts[ib], pts[ic]];
      if (cross(a, b, c) <= 1e-12) continue;
      let ear = true;
      for (const j of left) {
        if (j === ia || j === ib || j === ic) continue;
        if (inside(pts[j], a, b, c)) {
          ear = false;
          break;
        }
      }
      if (!ear) continue;
      tris.push([ia, ib, ic]);
      left.splice(k, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (left.length === 3) tris.push([...left]);
  // ---- merge neighbours while convex
  const polys = tris;
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < polys.length; i++) {
      for (let j = i + 1; j < polys.length; j++) {
        const P = polys[i];
        const Q = polys[j];
        // a shared edge: u -> v in P, v -> u in Q
        for (let a = 0; a < P.length; a++) {
          const u = P[a];
          const v = P[(a + 1) % P.length];
          const b = Q.indexOf(v);
          if (b < 0 || Q[(b + 1) % Q.length] !== u) continue;
          // P from v round to u, then Q's corners between u and v
          const out: number[] = [];
          for (let k = 0; k < P.length; k++) out.push(P[(a + 1 + k) % P.length]);
          for (let k = 2; k < Q.length; k++) out.push(Q[(b + k) % Q.length]);
          if (!out.every((_, k) => convexAt(pts, out, k))) continue;
          polys[i] = out;
          polys.splice(j, 1);
          merged = true;
          break outer;
        }
      }
    }
  }
  return polys.map((poly) => poly.map((i) => pts[i]));
}
