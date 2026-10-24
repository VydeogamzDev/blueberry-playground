import type { Game } from '../world/Game';
import type { Controls } from '../tools/Controls';
import { PX } from '../engine/constants';
import type { V2 } from '../engine/math';
import { candidates, type Anchor } from '../tools/AnchorSnap';
import { RETICLE } from '../tools/ConnectTool';
import { boxOf, partBox, type Guide } from '../tools/Guides';
import type { Ghost } from '../tools/Placer';

/** Colors of the Shape tool's materials, for its outline as it's drawn. */
const MAT_COLORS: Record<string, string> = {
  wood: '#b98d5c', metal: '#a3adb5', concrete: '#9a9c9f', brick: '#b0604e', rubber: '#55575c', glass: '#93c3cf',
};

const GOLD = '#f2d16b';
const BAD = '#d8463a';

/**
 * Building aids drawn over the sandbox: the size handles of the selected
 * resizable thing (and its new outline while one is dragged), the outline the
 * Shape tool is drawing, how far the selection's limited hinges may swing; and
 * for the connection tools, the points an end can snap to, a ring where it
 * would go and a label saying what it would make; the guides things line up
 * with as they're moved, the ghost of what's about to be placed, parts pushed
 * into each other, and the handle that turns the selection.
 */
export class EditOverlay {
  private game: Game;
  private controls: Controls;
  private cv: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private shown = false;

  constructor(game: Game, controls: Controls, root: HTMLElement) {
    this.game = game;
    this.controls = controls;
    this.cv = document.createElement('canvas');
    this.cv.className = 'detail-view edit-view';
    root.prepend(this.cv);
    this.g = this.cv.getContext('2d')!;
  }

  frame(): void {
    const c = this.controls;
    const handles = c.resizeHandles();
    const hinges = this.limitedHinges();
    const ct = c.connect;
    const ghost = c.placer.ghost;
    const guides = [...c.arrange.guides, ...c.placer.guides];
    const overlaps = this.game.paused ? c.arrange.overlaps : [];
    const spin = c.spinHandle();
    const group = c.arrange.groupHandle();
    const reticle = c.touchMode && c.fingerDown && !!c.toolKind;
    const busy = handles.length || c.draft || (c.shaping && c.draft === null) || hinges.length || ct.label || ct.ends.length || ct.hover?.part ||
      ghost || guides.length || overlaps.length || spin || group || reticle || c.resizePreview();
    const g = this.g;
    if (!busy) {
      if (this.shown) {
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.clearRect(0, 0, this.cv.width, this.cv.height);
        this.shown = false;
      }
      return;
    }
    this.shown = true;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(window.innerWidth * dpr);
    const h = Math.round(window.innerHeight * dpr);
    if (this.cv.width !== w || this.cv.height !== h) {
      this.cv.width = w;
      this.cv.height = h;
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, w, h);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const r = this.game.renderer;
    const scr = (p: { x: number; y: number }) => r.worldToScreen(p.x, p.y);

    // the grid it's put on with Shift, round it; then what's about to be placed: see-through where it will go
    if (ghost && c.placer.gridPatch) this.drawGridPatch(c.placer.gridPatch);
    if (ghost) this.drawGhost(ghost, c.placer.clickHint);

    // parts pushed into each other: they'll fly apart as time runs
    for (const o of overlaps) {
      if (o.a.destroyed || o.b.destroyed) continue;
      g.strokeStyle = 'rgba(216, 70, 58, 0.9)';
      g.fillStyle = 'rgba(216, 70, 58, 0.18)';
      g.lineWidth = 1.5;
      for (const p of [o.a, o.b]) {
        const b = partBox(p);
        const a = scr({ x: b.x0, y: b.y1 });
        const z = scr({ x: b.x1, y: b.y0 });
        g.fillRect(a.x, a.y, z.x - a.x, z.y - a.y);
        g.strokeRect(a.x, a.y, z.x - a.x, z.y - a.y);
      }
    }

    // the guides what's moved lines up with, and the gaps beside them
    for (const gd of guides) this.drawGuide(gd);

    // the selection while building: its box, its middle of mass, the handle that turns it
    if (spin) {
      const list = [...c.selection].filter((e) => !e.destroyed);
      const b = boxOf(list);
      if (b) {
        const a = scr({ x: b.x0, y: b.y1 });
        const z = scr({ x: b.x1, y: b.y0 });
        g.setLineDash([3, 4]);
        g.strokeStyle = 'rgba(242, 209, 107, 0.55)';
        g.lineWidth = 1;
        g.strokeRect(a.x - 3, a.y - 3, z.x - a.x + 6, z.y - a.y + 6);
        g.setLineDash([]);
        // (from the box's top to the handle)
        g.beginPath();
        g.moveTo((a.x + z.x) / 2, a.y - 3);
        g.lineTo(spin.x, spin.y);
        g.stroke();
        const com = centreOfMass(list);
        if (com) this.comMark(scr(com), 5);
      }
      const rad = c.touchMode ? 10 : 6;
      g.fillStyle = c.spinAngle !== null ? '#fff1b0' : GOLD;
      g.strokeStyle = 'rgba(20, 20, 24, 0.9)';
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(spin.x, spin.y, rad, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      if (c.spinAngle !== null) this.label(`${Math.round(c.spinAngle)}°`, spin.x + rad + 6, spin.y + 4);
    }

    // hinge limits: an arc over the swing allowed, a tick where it is now
    for (const k of hinges) {
      const s = scr(k.at);
      const rad = 22;
      g.strokeStyle = 'rgba(226, 189, 87, 0.85)';
      g.lineWidth = 2;
      g.beginPath();
      // (the screen's y runs down: angles turn the other way)
      g.arc(s.x, s.y, rad, -(k.rest + k.limit), -(k.rest - k.limit));
      g.stroke();
      g.strokeStyle = 'rgba(255, 240, 200, 0.9)';
      g.beginPath();
      g.moveTo(s.x, s.y);
      g.lineTo(s.x + Math.cos(k.now) * rad, s.y - Math.sin(k.now) * rad);
      g.stroke();
    }

    // resizing: the new outline, and the handles (several things at once: the corner of their box)
    const prev = c.resizePreview();
    if (prev) {
      g.setLineDash([5, 4]);
      g.strokeStyle = 'rgba(242, 209, 107, 0.95)';
      g.lineWidth = 1.5;
      g.beginPath();
      prev.map(scr).forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
      g.closePath();
      g.stroke();
      g.setLineDash([]);
    }
    const size = c.touchMode ? 10 : 7;
    for (const hd of group ? [...handles, group] : handles) {
      g.fillStyle = GOLD;
      g.strokeStyle = 'rgba(20, 20, 24, 0.9)';
      g.lineWidth = 1.5;
      g.fillRect(hd.x - size / 2, hd.y - size / 2, size, size);
      g.strokeRect(hd.x - size / 2, hd.y - size / 2, size, size);
    }
    if (group) {
      // (its corner says it scales them all)
      g.strokeStyle = GOLD;
      g.beginPath();
      g.moveTo(group.x + size, group.y + size / 2);
      g.lineTo(group.x + size, group.y + size);
      g.lineTo(group.x + size / 2, group.y + size);
      g.stroke();
    }

    // the connection tools: the points an end can go to, a ring where it will, and what it would make
    this.drawConnecting(reticle);

    // the Shape tool's outline
    const d = c.draft;
    if (c.shaping) {
      // (editing the map, it draws ground)
      const color = c.terrain ? '#9bb86a' : MAT_COLORS[c.shapeMat] ?? '#cccccc';
      const cur = { x: c.wx, y: c.wy };
      g.lineWidth = 2;
      g.strokeStyle = color;
      g.fillStyle = color + '55';
      if (d && d.press && !d.pts.length) {
        // a box (or an ellipse) being dragged out
        const a = scr(d.press);
        const b = scr(cur);
        g.beginPath();
        if (d.round || c.isHeld('fast')) g.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2);
        else g.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
        g.fill();
        g.stroke();
        this.label(`${(Math.abs(cur.x - d.press.x)).toFixed(2)} × ${(Math.abs(cur.y - d.press.y)).toFixed(2)} m`, b.x + 10, b.y + 14);
      } else if (d && d.pts.length) {
        const pts = d.pts.map(scr);
        const end = scr(cur);
        g.beginPath();
        pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
        g.lineTo(end.x, end.y);
        g.closePath();
        g.fill();
        g.setLineDash([]);
        g.beginPath();
        pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
        g.lineTo(end.x, end.y);
        g.stroke();
        for (const [i, p] of pts.entries()) {
          g.fillStyle = i === 0 ? GOLD : '#ffffff';
          g.fillRect(p.x - 3, p.y - 3, 6, 6);
        }
        // closing the outline: the first corner rings
        if (pts.length >= 3 && Math.hypot(end.x - pts[0].x, end.y - pts[0].y) < 12) {
          g.strokeStyle = GOLD;
          g.beginPath();
          g.arc(pts[0].x, pts[0].y, 9, 0, Math.PI * 2);
          g.stroke();
        }
      } else if (!c.touchMode) {
        // where a corner would go
        const p = scr(cur);
        g.fillStyle = color;
        g.fillRect(p.x - 2, p.y - 2, 4, 4);
      }
    }
  }

  /**
   * A connection tool in hand: the points the end can snap to on the part
   * under it (small dots), a ring at each end that would be made (red where it
   * can't), and the label by the cursor; on a touch screen, the line from the
   * finger up to the ring it works at.
   */
  private drawConnecting(reticle: boolean): void {
    const c = this.controls;
    const ct = c.connect;
    const g = this.g;
    const r = this.game.renderer;
    const scr = (p: V2) => r.worldToScreen(p.x, p.y);
    const kind = ct.pending?.kind ?? (c.toolKind && c.toolKind !== 'remove' ? (c.toolKind === 'pin' ? 'hinge' : c.toolKind) : null);
    const at = ct.point();
    const pt = scr(at);
    if (reticle) {
      g.strokeStyle = 'rgba(255, 241, 176, 0.5)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(c.sx, c.sy);
      g.lineTo(pt.x, pt.y);
      g.stroke();
      g.beginPath();
      g.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
      g.stroke();
    }
    // the points worth joining at on what's under it (not while snapping is off, or Alt: free)
    const on = ct.hover?.part ?? (ct.pending ? ct.ends[ct.ends.length - 1]?.part ?? null : null);
    if (kind && on && !on.destroyed && c.snapping && c.arrange.settings.anchors && !c.isHeld('snap') && !c.freeAnchor) {
      for (const k of candidates(on, kind, c.touchMode)) {
        if (k.kind === 'edge' || k.kind === 'pixel') continue;
        const s = scr(k.world);
        g.fillStyle = k.kind === 'attach' ? 'rgba(242, 209, 107, 0.9)' : k.kind === 'com' ? 'rgba(160, 210, 255, 0.85)' : 'rgba(255, 255, 255, 0.55)';
        g.fillRect(s.x - 1.5, s.y - 1.5, 3, 3);
      }
    }
    // a ring at each end that would be made
    const ends: Anchor[] = ct.ends.length ? ct.ends : ct.hover?.part ? [ct.hover] : [];
    for (const a of ends) {
      const s = scr(a.world);
      g.strokeStyle = ct.labelBad ? BAD : a.kind === 'free' || a.kind === 'pixel' ? 'rgba(255, 255, 255, 0.85)' : GOLD;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(s.x, s.y, a.kind === 'attach' ? 6 : 5, 0, Math.PI * 2);
      g.stroke();
      if (a.kind === 'com') this.comMark(s, 3);
    }
    if (ct.label && (kind || ct.hoverConn || ct.busy)) {
      const x = (reticle ? pt.x : c.sx) + 14;
      const y = (reticle ? pt.y - RETICLE * 0.3 : c.sy) + 22;
      this.label(ct.label, x, y, ct.labelBad ? BAD : undefined);
    }
  }

  /** What's about to be placed, see-through (faint: the hint of what Q / E would spawn there). */
  /** Grid lines round where the ghost goes, fading out a few cells away (too fine to see at this zoom: none). */
  private drawGridPatch(p: { at: { x: number; y: number }; size: number }): void {
    const g = this.g;
    const r = this.game.renderer;
    const cell = p.size * r.zoom;
    if (cell < 6) return;
    // (about 1.5 m round it, or 4 cells of a big grid)
    const n = Math.max(4, Math.ceil(1.5 / p.size));
    const c = r.worldToScreen(p.at.x, p.at.y);
    const reach = n * cell;
    g.save();
    g.lineWidth = 1;
    for (let i = -n; i <= n; i++) {
      const fade = 1 - Math.abs(i) / (n + 1);
      g.strokeStyle = `rgba(242, 209, 107, ${(0.32 * fade).toFixed(3)})`;
      const d = i * cell;
      g.beginPath();
      g.moveTo(Math.round(c.x + d) + 0.5, c.y - reach);
      g.lineTo(Math.round(c.x + d) + 0.5, c.y + reach);
      g.moveTo(c.x - reach, Math.round(c.y + d) + 0.5);
      g.lineTo(c.x + reach, Math.round(c.y + d) + 0.5);
      g.stroke();
    }
    g.restore();
  }

  private drawGhost(gh: Ghost, clickHint = false): void {
    const g = this.g;
    const r = this.game.renderer;
    const z = r.zoom;
    const cos = Math.cos(gh.angle);
    const sin = Math.sin(gh.angle);
    const dpr = window.devicePixelRatio || 1;
    g.save();
    // (placing with clicks, it's where a click puts it: plainer than Q/E's hint)
    g.globalAlpha = gh.solid ? 0.45 : clickHint ? 0.35 : 0.2;
    g.imageSmoothingEnabled = false;
    for (const im of gh.images) {
      // (mirrored: about the ghost's middle, and each picture itself)
      const ix = gh.flip ? -im.x : im.x;
      const a = (gh.flip ? -im.a : im.a) + gh.angle;
      const wx = gh.at.x + ix * cos - im.y * sin;
      const wy = gh.at.y + ix * sin + im.y * cos;
      const s = r.worldToScreen(wx, wy);
      const flip = (gh.flip ? -1 : 1) * im.flip;
      const iw = (im.img as HTMLCanvasElement).width * PX * z;
      const ih = (im.img as HTMLCanvasElement).height * PX * z;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.translate(s.x, s.y);
      g.rotate(-a);
      g.scale(flip, 1);
      g.drawImage(im.img, -iw / 2 + im.ox * z, -ih / 2 - im.oy * z, iw, ih);
    }
    g.restore();
    if (!gh.solid && !(clickHint && gh.angle)) return;
    // (what it is, and how far it's turned)
    const s = r.worldToScreen(gh.at.x, gh.at.y);
    const name = gh.label.replace(/^Spawn /, '');
    this.label(gh.angle ? `${name} · ${Math.round((gh.angle * 180) / Math.PI)}°` : name, s.x + 12, s.y - 12);
  }

  /** A guide line, and the gap it measures (or "flush"). */
  private drawGuide(gd: Guide): void {
    const g = this.g;
    const r = this.game.renderer;
    const a = r.worldToScreen(gd.x0, gd.y0);
    const b = r.worldToScreen(gd.x1, gd.y1);
    g.strokeStyle = 'rgba(120, 200, 255, 0.85)';
    g.lineWidth = 1;
    g.setLineDash([4, 3]);
    g.beginPath();
    g.moveTo(a.x, a.y);
    g.lineTo(b.x, b.y);
    g.stroke();
    g.setLineDash([]);
    if (gd.gap) {
      const s = r.worldToScreen(gd.gap.x, gd.gap.y);
      this.label(gd.gap.m < 0.005 ? 'flush' : `${gd.gap.m.toFixed(2)} m`, s.x + 6, s.y + 4, '#9fd4ff');
    }
  }

  /** The centre-of-mass mark: a circle in quarters. */
  private comMark(s: V2, rad: number): void {
    const g = this.g;
    g.fillStyle = 'rgba(20, 20, 24, 0.9)';
    g.beginPath();
    g.arc(s.x, s.y, rad, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(160, 210, 255, 0.95)';
    for (const q of [0, Math.PI]) {
      g.beginPath();
      g.moveTo(s.x, s.y);
      g.arc(s.x, s.y, rad, q, q + Math.PI / 2);
      g.closePath();
      g.fill();
    }
  }

  /** A small label with a dark backing. */
  private label(text: string, x: number, y: number, color = '#e8e2cf'): void {
    const g = this.g;
    g.font = '11px DotGothic16, system-ui, sans-serif';
    const w = g.measureText(text).width;
    // (kept on the screen)
    x = Math.min(x, window.innerWidth - w - 8);
    g.fillStyle = 'rgba(15, 16, 18, 0.8)';
    g.fillRect(x - 3, y - 11, w + 6, 15);
    g.fillStyle = color;
    g.fillText(text, x, y);
  }

  /**
   * The selection's hinges and pins that have a swing limit: where they are,
   * the way the first part pointed (world angle) when the limit was set, as it
   * would be now, and the way it points now.
   */
  private limitedHinges(): { at: { x: number; y: number }; rest: number; now: number; limit: number }[] {
    const out: { at: { x: number; y: number }; rest: number; now: number; limit: number }[] = [];
    const sel = this.controls.selection;
    if (!sel.size) return out;
    for (const k of this.game.connections.list) {
      if (k.limit === undefined || k.ref === undefined) continue;
      if (!sel.has(k.a.entity) && !(k.b && sel.has(k.b.entity))) continue;
      const at = k.a.localToWorld(k.la.x, k.la.y);
      // the way from the hinge to the first part's middle (its own x axis if the hinge is there)
      const dx = k.a.x - at.x;
      const dy = k.a.y - at.y;
      const now = Math.hypot(dx, dy) > PX * 2 ? Math.atan2(dy, dx) : k.a.body.rotation();
      // how far it has turned since the limit was set
      const turned = this.game.connections.relAngle(k) - k.ref;
      out.push({ at, rest: now - turned, now, limit: k.limit });
    }
    return out;
  }
}

/** Where the mass of these things is centred (world), if they have any. */
function centreOfMass(list: { parts: { destroyed: boolean; mass: number; x: number; y: number }[] }[]): V2 | null {
  let m = 0;
  let x = 0;
  let y = 0;
  for (const e of list) {
    for (const p of e.parts) {
      if (p.destroyed || !(p.mass > 0)) continue;
      m += p.mass;
      x += p.mass * p.x;
      y += p.mass * p.y;
    }
  }
  return m > 0 ? { x: x / m, y: y / m } : null;
}
