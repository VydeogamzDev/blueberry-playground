import type { Game } from '../world/Game';
import type { Controls } from '../tools/Controls';
import { Human } from '../entities/Human';
import { Creature } from '../entities/Creature';
import { Explosive } from '../entities/Explosive';
import { clamp } from '../engine/math';
import { heartRate, isSynthetic, limbMap, type Living } from './VitalsPanel';

/**
 * The detail view (S, as in People Playground): a health bar on every limb of
 * the people and animals (a red cross once a limb is spent) with their heart
 * rate and blood over their heads, and how far each explosive's blast reaches.
 * Drawn on a canvas over the sandbox.
 */
export class DetailView {
  private game: Game;
  private controls: Controls;
  private cv: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private shown = false;

  constructor(game: Game, controls: Controls, root: HTMLElement) {
    this.game = game;
    this.controls = controls;
    this.cv = document.createElement('canvas');
    this.cv.className = 'detail-view';
    root.prepend(this.cv);
    this.g = this.cv.getContext('2d')!;
  }

  frame(): void {
    const g = this.g;
    if (!this.controls.detail) {
      if (this.shown) {
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
    for (const e of this.game.entities) {
      if (e instanceof Explosive) {
        const c = e.center();
        const s = r.worldToScreen(c.x, c.y);
        g.setLineDash([5, 4]);
        g.strokeStyle = 'rgba(255, 150, 60, 0.75)';
        g.lineWidth = 1.5;
        g.beginPath();
        g.arc(s.x, s.y, e.blast.radius * r.zoom, 0, Math.PI * 2);
        g.stroke();
        g.setLineDash([]);
        continue;
      }
      if (!(e instanceof Human) && !(e instanceof Creature)) continue;
      // front and back limbs overlap: the most hurt one's bar goes on top
      const parts = e.parts.filter((p) => !p.destroyed).sort((a, b) => b.hp / b.maxHp - a.hp / a.maxHp);
      for (const p of parts) {
        const s = r.worldToScreen(p.x, p.y);
        if (p.hp <= 0) {
          g.strokeStyle = '#e04a3a';
          g.lineWidth = 2;
          g.beginPath();
          g.moveTo(s.x - 4, s.y - 4);
          g.lineTo(s.x + 4, s.y + 4);
          g.moveTo(s.x + 4, s.y - 4);
          g.lineTo(s.x - 4, s.y + 4);
          g.stroke();
          continue;
        }
        const f = clamp(p.hp / p.maxHp, 0, 1);
        const bw = 14;
        g.fillStyle = 'rgba(10, 10, 12, 0.75)';
        g.fillRect(s.x - bw / 2 - 1, s.y - 2.5, bw + 2, 5);
        g.fillStyle = `hsl(${Math.round(f * 120)}, 75%, 50%)`;
        g.fillRect(s.x - bw / 2, s.y - 1.5, bw * f, 3);
      }
      this.tag(e);
    }
  }

  /** Heart rate and blood over the head (the vitals panel has the rest). */
  private tag(e: Living): void {
    const head = limbMap(e).get('head');
    const top = head && !head.gone ? head.part : e.parts.find((p) => !p.destroyed);
    if (!top) return;
    const synthetic = isSynthetic(e);
    const text = !e.alive ? (synthetic ? 'offline' : 'dead') : synthetic ? 'online' : `♥ ${Math.round(heartRate(e))}  ${Math.round(e.blood)}%`;
    const s = this.game.renderer.worldToScreen(top.x, top.y + 0.34);
    const g = this.g;
    g.font = '10px DotGothic16, system-ui, sans-serif';
    const w = g.measureText(text).width;
    g.fillStyle = 'rgba(15, 16, 18, 0.75)';
    g.fillRect(s.x - w / 2 - 3, s.y - 9, w + 6, 13);
    g.fillStyle = e.alive ? '#e8e2cf' : '#e48a7f';
    g.fillText(text, s.x - w / 2, s.y);
  }
}
