import type { Game } from '../world/Game';
import type { Controls } from '../tools/Controls';
import type { Entity } from '../world/Entity';
import type { Part, ShapeSpec } from '../world/Part';
import type { PixelArt } from '../art/PixelArt';
import { Human } from '../entities/Human';
import { Creature } from '../entities/Creature';
import { clamp, type V2 } from '../engine/math';

/** People and animals: the things with a pulse (and bones). */
export type Living = Human | Creature;

export const isLiving = (e: Entity | null | undefined): e is Living => e instanceof Human || e instanceof Creature;

/** What the vitals and the x-ray need of a limb (a person's and an animal's both fit). */
export interface LimbLike {
  spec: { key: string; name: string; cx: number; cy: number; layer: number; shape: ShapeSpec };
  part: Part;
  parent: LimbLike | null;
  children: LimbLike[];
  /** The joint to the parent (local meters): on the parent, and on this limb. */
  a1: V2;
  a2: V2;
  severed: boolean;
  gone: boolean;
  broken: boolean;
  /** Joined to the body through intact joints. */
  attached: boolean;
  wounds: { rate: number }[];
}

export const limbMap = (e: Living): Map<string, LimbLike> => e.limbs as unknown as Map<string, LimbLike>;
export const limbsOf = (e: Living): Iterable<LimbLike> => limbMap(e).values();

/** The android: no blood, no breath, no heart (a core that keeps time instead). */
export const isSynthetic = (e: Living): boolean => e instanceof Human && !e.variant.bleeds;

const kindOf = (e: Living): string => (e instanceof Human ? e.variant.kind : e.species.kind);

/** Resting heart rate (bpm), breaths a minute and body temperature (°C) of each kind. */
const BASE: Record<string, { bpm: number; breaths: number; temp: number }> = {
  human: { bpm: 72, breaths: 14, temp: 37 },
  android: { bpm: 60, breaths: 0, temp: 41 },
  dog: { bpm: 90, breaths: 22, temp: 38.6 },
  cat: { bpm: 150, breaths: 26, temp: 38.6 },
  pig: { bpm: 80, breaths: 18, temp: 39 },
  fox: { bpm: 110, breaths: 24, temp: 38.7 },
  cow: { bpm: 60, breaths: 20, temp: 38.6 },
  // (a cold-blooded thing with a fast, fluttering heart)
  gorse: { bpm: 140, breaths: 30, temp: 27 },
};

const DRUG_NAMES: Record<string, string> = {
  adrenaline: 'Adrenaline', knockout: 'Sedated', poison: 'Poisoned', painkiller: 'Painkiller', strength: 'Ultra Strength',
  freeze: 'Frozen stiff', bone: 'Bone eating', acid: 'Acid', coagulation: 'Coagulant',
};

/** Seconds of each drug left in the blood (read loosely: the syringes may gain more). */
function drugsOf(e: Living): Record<string, number> {
  return ((e as { drugs?: Record<string, number> }).drugs ?? {}) as Record<string, number>;
}

const dose = (d: Record<string, number>, k: string): number => (typeof d[k] === 'number' ? d[k] : 0);

/**
 * Heart rate (beats a minute) worked out from the body's state: blood loss
 * drives it up most (the heart races to keep pressure as the blood runs out),
 * then pain, shock, adrenaline, running about and burning; sedation and
 * unconsciousness slow it, freezing most. 0 once dead, and in a zombie (it walks
 * about on a heart that has stopped); the android's core keeps a steady beat.
 */
export function heartRate(e: Living): number {
  if (!e.alive || e.zombie) return 0;
  const base = BASE[kindOf(e)] ?? BASE.human;
  if (isSynthetic(e)) return base.bpm;
  const d = drugsOf(e);
  const adren = dose(d, 'adrenaline');
  const loss = clamp((100 - e.blood) / 65, 0, 1);
  let heat = 0;
  for (const l of limbsOf(e)) if (!l.gone) heat = Math.max(heat, l.part.burning);
  // (an infection races it as the fever takes hold)
  let k = 1 + loss * 1.15 + Math.min(e.pain, 1.5) * 0.25 + e.shock * 0.35 + (e.moving ? 0.25 : 0) + Math.min(1, heat) * 0.2 + e.infection * 0.4;
  if (adren > 0) k += 0.6 * Math.min(1, adren / 10);
  if (dose(d, 'strength') > 0) k += 0.3;
  if (dose(d, 'freeze') > 0) k -= 0.45;
  if (dose(d, 'knockout') > 0) k -= 0.2;
  if (e.consciousness <= 0.3) k -= 0.12;
  return clamp(base.bpm * k, 30, 230);
}

export interface LimbReport {
  key: string;
  name: string;
  /** "fine", or what's wrong: "broken, bleeding". */
  status: string;
  /** How bad: 0 fine, 1 bruised or burnt, 2 bleeding or burning, 3 broken, 4 severed, 5 gone. */
  level: number;
}

export interface Vitals {
  alive: boolean;
  conscious: boolean;
  /** "Alert · standing", "Unconscious · lying down", "Dead". */
  state: string;
  consciousness: number;
  /** Blood volume (%); null for the android, which has none. */
  blood: number | null;
  /** Heart rate (the android's core pulse); 0 once dead. */
  bpm: number;
  /** Breaths a minute (0: not breathing) and how. */
  breaths: number;
  breathing: string;
  pain: number;
  shock: number;
  /** Body temperature (°C), and how many limbs are alight. */
  temp: number;
  burning: number;
  /** Drugs, fire, limp, frozen. */
  effects: string[];
  /** Every limb, in the body's own order. */
  limbs: LimbReport[];
  synthetic: boolean;
}

/** Simulated time each body was first seen dead (it cools from then). */
const diedAt = new WeakMap<Living, number>();

/** A person's or animal's vital signs, read off its body. */
export function readVitals(e: Living, game: Game): Vitals {
  const base = BASE[kindOf(e)] ?? BASE.human;
  const synthetic = isSynthetic(e);
  const d = drugsOf(e);
  const alive = e.alive;
  const conscious = alive && e.consciousness > 0.3;
  const loss = synthetic ? 0 : clamp((100 - e.blood) / 65, 0, 1);
  const limbs: LimbReport[] = [];
  let burning = 0;
  let heat = 0;
  for (const l of limbsOf(e)) {
    if (!l.gone && l.part.burning > 0.05) {
      burning++;
      heat = Math.max(heat, l.part.burning);
    }
    limbs.push(limbReport(l, e.facing, synthetic));
  }

  // breathing, if there's still a head on the body to breathe through
  let breaths = 0;
  let breathing = synthetic ? 'none (synthetic)' : e.zombie ? 'none (undead)' : 'none';
  const head = limbMap(e).get('head');
  if (alive && !synthetic && !e.zombie && head && !head.gone && head.attached) {
    const ko = dose(d, 'knockout') > 0;
    const k = 1 + loss * 1.3 + Math.min(e.pain, 1.5) * 0.2 + e.shock * 0.3 + (e.moving ? 0.3 : 0) + (dose(d, 'adrenaline') > 0 ? 0.35 : 0) - (ko ? 0.3 : 0);
    breaths = clamp(base.breaths * k, 4, 60);
    breathing = loss > 0.6 ? 'gasping' : ko || !conscious ? 'shallow' : k > 1.7 ? 'rapid' : k > 1.25 ? 'fast' : 'normal';
    // (under water: none, holding their breath while it lasts; up again, panting for it)
    const br = e.breath;
    if (br.under) {
      breaths = 0;
      breathing = br.air <= 0 ? 'drowning' : conscious ? 'holding breath' : 'breathing water';
    } else if (br.air < 0.9) {
      breaths = Math.max(breaths, 40);
      breathing = 'gasping';
    }
  }

  // warm while alive (a little cold from losing blood, hot on fire); a body cools
  // (a fever as an infection takes hold; a zombie is as cold as the dead; frozen, colder still)
  let temp = base.temp - loss * 1.6 + Math.min(1, heat) * 3.5 * Math.min(1, burning / 3) + e.infection * 2.2;
  if (e.zombie) temp = Math.min(temp, 24);
  if (dose(d, 'freeze') > 0) temp -= 9;
  if (!alive) {
    const t0 = diedAt.get(e) ?? game.time;
    diedAt.set(e, t0);
    if (!burning) temp = Math.max(20, temp - (game.time - t0) * 0.03);
  } else diedAt.delete(e);

  const effects: string[] = [];
  for (const k of Object.keys(d)) {
    const left = dose(d, k);
    if (left > 0) effects.push(`${DRUG_NAMES[k] ?? k[0].toUpperCase() + k.slice(1)} ${Math.ceil(left)} s`);
  }
  if (e.zombie) effects.push('Zombie');
  else if (e.infection > 0) effects.push(`Infected ${Math.round(e.infection * 100)}%`);
  if (burning) effects.push('On fire');
  if (e.limp) effects.push('Limp');
  if (e.frozen) effects.push('Frozen');

  let state: string;
  if (!alive) state = synthetic ? 'Shut down' : 'Dead';
  else {
    const mind = e.zombie ? 'Undead' : synthetic ? (conscious ? 'Online' : 'Dormant') : !conscious ? 'Unconscious' : e.consciousness > 0.7 ? 'Alert' : 'Drowsy';
    const doing = e.state === 'getup' ? 'getting up'
      : e.state !== 'stand' ? 'lying down'
      : e instanceof Human && e.climbKind ? 'climbing'
      : e.moving ? 'walking' : 'standing';
    state = `${mind} · ${doing}`;
  }

  return {
    alive, conscious, state,
    consciousness: alive ? e.consciousness : 0,
    blood: synthetic ? null : clamp(e.blood, 0, 100),
    bpm: heartRate(e),
    breaths, breathing,
    pain: e.pain, shock: e.shock,
    temp, burning, effects, limbs, synthetic,
  };
}

/** A limb's name for people: "Right lower leg" (the near side, drawn in front, is the right of someone facing right). */
function limbName(l: LimbLike, facing: number): string {
  const k = l.spec.key;
  if (!/[a-z][FB]$/.test(k)) return l.spec.name;
  return `${k.endsWith('F') === (facing === 1) ? 'Right' : 'Left'} ${l.spec.name.toLowerCase()}`;
}

function limbReport(l: LimbLike, facing: number, synthetic: boolean): LimbReport {
  const words: string[] = [];
  let level = 0;
  const p = l.part;
  if (l.gone) {
    words.push(synthetic ? 'destroyed' : 'gone');
    level = 5;
  } else {
    if (!l.attached) {
      words.push('severed');
      level = 4;
    }
    if (l.broken) {
      words.push('broken');
      level = Math.max(level, 3);
    }
    let bleed = 0;
    for (const w of l.wounds) bleed += w.rate;
    if (bleed > 0.05) {
      words.push(bleed > 1 ? 'bleeding heavily' : 'bleeding');
      level = Math.max(level, 2);
    }
    if (p.burning > 0.05) {
      words.push('burning');
      level = Math.max(level, 2);
    } else if (p.charred > 0.35) {
      words.push('burnt');
      level = Math.max(level, 1);
    }
    const hpF = p.hp / p.maxHp;
    if (hpF < 0.85 && !l.broken && l.attached) {
      words.push(hpF < 0.3 ? (synthetic ? 'badly dented' : 'badly bruised') : synthetic ? 'dented' : 'bruised');
      level = Math.max(level, 1);
    }
  }
  return { key: l.spec.key, name: limbName(l, facing), status: words.length ? words.join(', ') : 'fine', level };
}

const PAIN_WORDS: [number, string][] = [[0.05, 'none'], [0.3, 'mild'], [0.7, 'moderate'], [1.1, 'severe'], [Infinity, 'extreme']];

/** The paper doll's colors by how bad a limb is (see LimbReport.level), and for the dead. */
const LEVEL_RGB: [number, number, number][] = [[118, 170, 120], [214, 178, 80], [214, 92, 74], [236, 128, 58], [150, 60, 60], [70, 74, 80]];
const DEAD_RGB: [number, number, number] = [120, 126, 132];

/** Seconds between readings (the trace runs every frame). */
const REFRESH = 0.2;
/** The trace: samples across, and how fast it sweeps (samples per second). */
const TRACE_N = 232;
const SWEEP = 75;

const bump = (t: number, c: number, w: number) => Math.exp(-((t - c) * (t - c)) / (2 * w * w));
/** One heartbeat on an ECG, `t` seconds in: P wave, the QRS spike, T wave (also the Heart Monitor's). */
export const ecg = (t: number) => 0.13 * bump(t, 0.08, 0.022) - 0.14 * bump(t, 0.165, 0.008) + bump(t, 0.185, 0.009) - 0.26 * bump(t, 0.205, 0.009) + 0.26 * bump(t, 0.37, 0.04);
/** The android core's tick. */
export const tick =(t: number) => (t < 0.12 ? 0.75 : t < 0.16 ? -0.2 : 0);

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Each limb picture as a flat color (the paper doll's pieces), by art and color. */
const tints = new WeakMap<PixelArt, Map<string, HTMLCanvasElement>>();

function tinted(art: PixelArt, rgb: [number, number, number]): HTMLCanvasElement {
  let m = tints.get(art);
  if (!m) tints.set(art, (m = new Map()));
  const key = rgb.join();
  let c = m.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = art.w;
  c.height = art.h;
  const g = c.getContext('2d')!;
  const img = g.createImageData(art.w, art.h);
  for (let y = 0; y < art.h; y++) {
    for (let x = 0; x < art.w; x++) {
      if (!art.filled(x, y)) continue;
      // a darker rim keeps overlapping limbs apart
      const rim = !art.filled(x - 1, y) || !art.filled(x + 1, y) || !art.filled(x, y - 1) || !art.filled(x, y + 1);
      const o = (y * art.w + x) * 4;
      const f = rim ? 0.62 : 1;
      img.data[o] = rgb[0] * f;
      img.data[o + 1] = rgb[1] * f;
      img.data[o + 2] = rgb[2] * f;
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  m.set(key, c);
  return c;
}

/**
 * A small monitor of one person's or animal's vital signs: state, an ECG
 * trace, heart rate, blood, consciousness, breathing, pain, shock, temperature,
 * what's in their blood, and a paper doll with every limb's state. It shows
 * the one picked with Vitals in the context menu (pinned until closed), else
 * the one selected, else, in the detail view, the one under the cursor.
 */
export class VitalsPanel {
  private game: Game;
  private controls: Controls;
  private el: HTMLDivElement;
  private nameEl: HTMLSpanElement;
  private stateEl: HTMLSpanElement;
  private pinEl: HTMLSpanElement;
  private trace: HTMLCanvasElement;
  private tg: CanvasRenderingContext2D;
  private doll: HTMLCanvasElement;
  private dg: CanvasRenderingContext2D;
  private vals = new Map<string, HTMLElement>();
  private bars = new Map<string, HTMLElement>();
  private fxEl: HTMLDivElement;
  private limbsEl: HTMLDivElement;
  /** Show the selected person's or animal's vitals (a setting). */
  forSelection = true;
  /** Whose vitals are shown, and the last reading. */
  target: Living | null = null;
  readings: Vitals | null = null;
  /** Closed with ×: stays hidden until something else is picked. */
  private dismissed: Living | null = null;
  private since = 0;
  /** The heart rate shown: it eases toward the reading rather than jumping. */
  private bpm = 0;
  private samples = new Float32Array(TRACE_N);
  private cursor = 0;
  /** Seconds into the current beat, and samples owed to the sweep. */
  private beatT = 0;
  private carry = 0;
  private drawn = false;
  /** What the paper doll and the limb list were last drawn for (null: nothing yet, so the next reading draws them). */
  private dollSig: string | null = null;
  private limbSig: string | null = null;
  private left = -1;

  constructor(game: Game, controls: Controls, root: HTMLElement) {
    this.game = game;
    this.controls = controls;
    this.el = el('div', 'vitals hidden');
    const head = el('div', 'vitals-head');
    this.nameEl = el('span', 'vitals-name');
    this.stateEl = el('span', 'vitals-state');
    this.pinEl = el('span', 'vitals-pin', 'pinned');
    const close = el('button', 'vitals-x', '×');
    close.title = 'Close';
    close.onclick = () => {
      if (this.controls.vitalsPinned === this.target) this.controls.vitalsPinned = null;
      this.dismissed = this.target;
    };
    head.append(this.nameEl, this.stateEl, this.pinEl, close);
    this.trace = el('canvas', 'vitals-ecg');
    this.trace.width = TRACE_N * 2;
    this.trace.height = 68;
    this.tg = this.trace.getContext('2d')!;
    const body = el('div', 'vitals-body');
    this.doll = el('canvas', 'vitals-doll');
    this.dg = this.doll.getContext('2d')!;
    const rows = el('div', 'vitals-rows');
    const row = (label: string, key: string, bar = false) => {
      rows.appendChild(el('span', 'vk', label));
      const v = el('span', 'vv');
      const b = el('b');
      b.dataset.v = key;
      v.appendChild(b);
      const unit = el('span', 'vu');
      v.appendChild(unit);
      if (bar) {
        const track = el('span', 'vbar');
        const fill = el('i');
        track.appendChild(fill);
        v.appendChild(track);
        this.bars.set(key, fill);
      }
      rows.appendChild(v);
      this.vals.set(key, b);
      this.vals.set(key + ':u', unit);
    };
    row('Heart', 'bpm');
    row('Blood', 'blood', true);
    row('Conscious', 'consciousness', true);
    row('Breathing', 'breaths');
    row('Pain', 'pain', true);
    row('Shock', 'shock', true);
    row('Temp', 'temp');
    body.append(this.doll, rows);
    this.fxEl = el('div', 'vitals-fx');
    this.limbsEl = el('div', 'vitals-limbs');
    this.el.append(head, this.trace, body, this.fxEl, this.limbsEl);
    root.appendChild(this.el);
  }

  /** Whose vitals to show: the pinned one, else the one selected, else (in the detail view) the one under the cursor. */
  private pick(): Living | null {
    const c = this.controls;
    const pinned = c.vitalsPinned;
    if (pinned && (pinned.destroyed || !isLiving(pinned))) c.vitalsPinned = null;
    else if (pinned) return pinned as Living;
    if (this.forSelection && c.selection.size === 1) {
      const e = c.selection.values().next().value;
      if (isLiving(e) && !e.destroyed) return e;
    }
    const h = c.hover?.entity;
    if (c.detail && isLiving(h) && !h.destroyed) return h;
    return null;
  }

  frame(dt: number): void {
    const picked = this.pick();
    if (picked !== this.dismissed) this.dismissed = null;
    const who = picked && picked === this.dismissed ? null : picked;
    if (who !== this.target) {
      this.target = who;
      this.readings = null;
      this.el.classList.toggle('hidden', !who);
      if (!who) return;
      this.samples.fill(0);
      this.cursor = 0;
      this.beatT = 0;
      this.drawn = false;
      // (not '': that's someone unhurt, and the last one's injuries would stay listed)
      this.dollSig = this.limbSig = null;
      this.refresh();
    }
    if (!who) return;
    // clear of the toybox (on the left; a layout that moves the vitals puts them itself: see Layout)
    const r = this.game.renderer;
    const left = Math.round(r.insetLeft) + 8;
    if (left !== this.left) {
      this.left = left;
      this.el.style.left = left + 'px';
    }
    this.since += dt;
    if (this.since >= REFRESH) this.refresh();
    this.sweep(this.game.paused ? 0 : dt * this.game.timeScale);
  }

  /** Reads the vitals now and shows them (also used by the tests); null if nobody is shown. */
  refresh(): Vitals | null {
    this.since = 0;
    const e = this.target;
    if (!e) return null;
    const v = readVitals(e, this.game);
    // the rate eases toward the reading (a new body, or death, shows at once)
    if (!v.alive || !this.readings) this.bpm = v.bpm;
    else this.bpm += (v.bpm - this.bpm) * 0.35;
    v.bpm = Math.round(this.bpm);
    this.readings = v;

    const set = (k: string, text: string) => {
      const n = this.vals.get(k)!;
      if (n.textContent !== text) n.textContent = text;
    };
    const bar = (k: string, f: number, color: string) => {
      const b = this.bars.get(k)!;
      const w = `${Math.round(clamp(f, 0, 1) * 100)}%`;
      if (b.style.width !== w) b.style.width = w;
      if (b.dataset.c !== color) {
        b.dataset.c = color;
        b.style.background = color;
      }
    };
    if (this.nameEl.textContent !== e.def.name) this.nameEl.textContent = e.def.name;
    if (this.stateEl.textContent !== v.state) this.stateEl.textContent = v.state;
    this.stateEl.classList.toggle('dead', !v.alive);
    this.pinEl.classList.toggle('hidden', this.controls.vitalsPinned !== e);
    set('bpm', String(v.bpm));
    set('bpm:u', v.synthetic ? 'core' : 'bpm');
    set('blood', v.blood === null ? '—' : String(Math.round(v.blood)));
    set('blood:u', v.blood === null ? 'none' : '%');
    bar('blood', v.blood === null ? 0 : (v.blood - 35) / 65, v.blood !== null && v.blood < 65 ? '#d0584a' : '#c23b3b');
    set('consciousness', String(Math.round(v.consciousness * 100)));
    set('consciousness:u', '%');
    bar('consciousness', v.consciousness, '#6f9fd0');
    set('breaths', v.breaths ? String(Math.round(v.breaths)) : '—');
    set('breaths:u', v.breaths ? `/min · ${v.breathing}` : v.breathing);
    set('pain', PAIN_WORDS.find(([lim]) => v.pain < lim)![1]);
    set('pain:u', '');
    bar('pain', v.pain / 1.5, '#e2bd57');
    set('shock', String(Math.round(v.shock * 100)));
    set('shock:u', '%');
    bar('shock', v.shock, '#b07ad0');
    set('temp', v.temp.toFixed(1));
    set('temp:u', v.burning ? '°C · burning' : '°C');

    const fx = v.effects.join(' · ');
    if (this.fxEl.textContent !== fx) this.fxEl.textContent = fx;
    this.fxEl.classList.toggle('hidden', !fx);

    // the hurt limbs, worst first
    const hurt = v.limbs.filter((l) => l.level > 0).sort((a, b) => b.level - a.level);
    const sig = hurt.map((l) => l.name + l.status).join('|');
    if (sig !== this.limbSig) {
      this.limbSig = sig;
      this.limbsEl.innerHTML = '';
      if (!hurt.length) this.limbsEl.appendChild(el('div', 'vlimb ok', 'Every limb fine'));
      for (const l of hurt) {
        const row = el('div', 'vlimb');
        row.dataset.limb = l.key;
        row.append(el('span', '', l.name), el('span', `lv${l.level}`, l.status));
        this.limbsEl.appendChild(row);
      }
    }
    this.drawDoll(e, v);
    return v;
  }

  /** The standing figure, every limb colored by how it is (from the limbs' own pictures and layout). */
  private drawDoll(e: Living, v: Vitals): void {
    const sig = `${e.def.id}:${v.alive}:${v.limbs.map((l) => l.level).join('')}`;
    if (sig === this.dollSig) return;
    this.dollSig = sig;
    const limbs = [...limbsOf(e)];
    let minX = Infinity;
    let maxX = -Infinity;
    let maxY = 0;
    for (const l of limbs) {
      minX = Math.min(minX, l.spec.cx - l.part.w / 2);
      maxX = Math.max(maxX, l.spec.cx + l.part.w / 2);
      maxY = Math.max(maxY, l.spec.cy + l.part.h / 2);
    }
    const W = Math.ceil(maxX - minX) + 2;
    const H = Math.ceil(maxY) + 2;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const k = Math.max(1, Math.floor(Math.min((64 * dpr) / W, (96 * dpr) / H)));
    const cv = this.doll;
    if (cv.width !== W * k || cv.height !== H * k) {
      cv.width = W * k;
      cv.height = H * k;
      cv.style.width = `${(W * k) / dpr}px`;
      cv.style.height = `${(H * k) / dpr}px`;
    }
    const g = this.dg;
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, cv.width, cv.height);
    const order = limbs.map((l, i) => ({ l, r: v.limbs[i] })).sort((a, b) => a.l.spec.layer - b.l.spec.layer);
    for (const { l, r } of order) {
      let rgb = r.level === 0 && !v.alive ? DEAD_RGB : LEVEL_RGB[r.level];
      // the far side is in shadow
      if (/[a-z]B$/.test(l.spec.key)) rgb = [rgb[0] * 0.72, rgb[1] * 0.72, rgb[2] * 0.72];
      g.globalAlpha = r.level === 5 ? 0.45 : 1;
      const x = Math.round(l.spec.cx - l.part.w / 2 - minX + 1);
      const y = Math.round(H - 1 - l.spec.cy - l.part.h / 2);
      g.drawImage(tinted(l.part.art, rgb), x * k, y * k, l.part.w * k, l.part.h * k);
    }
    g.globalAlpha = 1;
  }

  /** Moves the trace on by `dt` seconds of game time (it stops when time does). */
  private sweep(dt: number): void {
    this.carry += dt * SWEEP;
    const n = Math.min(TRACE_N, Math.floor(this.carry));
    this.carry -= Math.floor(this.carry);
    for (let i = 0; i < n; i++) {
      this.samples[this.cursor] = this.sample();
      this.cursor = (this.cursor + 1) % TRACE_N;
    }
    if (n > 0 || !this.drawn) this.drawTrace();
  }

  /** The next sample of the trace (the strongest of three across its width, so a spike is never stepped over). */
  private sample(): number {
    const noise = (Math.random() - 0.5) * 0.03;
    if (this.bpm <= 0) {
      this.beatT = 0;
      return noise * 0.6;
    }
    const period = 60 / this.bpm;
    const step = 1 / SWEEP;
    const wave = this.readings?.synthetic ? tick : ecg;
    let best = 0;
    for (let j = 0; j < 3; j++) {
      let t = this.beatT + (step * j) / 3;
      if (t >= period) t -= period;
      const y = wave(t);
      if (Math.abs(y) > Math.abs(best)) best = y;
    }
    this.beatT += step;
    if (this.beatT >= period) this.beatT -= period;
    return best + noise;
  }

  private drawTrace(): void {
    this.drawn = true;
    const g = this.tg;
    const w = this.trace.width;
    const h = this.trace.height;
    g.clearRect(0, 0, w, h);
    g.strokeStyle = '#17261c';
    g.lineWidth = 1;
    g.beginPath();
    for (let x = 0; x < w; x += 25) {
      g.moveTo(x + 0.5, 0);
      g.lineTo(x + 0.5, h);
    }
    g.moveTo(0, h / 2 + 0.5);
    g.lineTo(w, h / 2 + 0.5);
    g.stroke();
    const v = this.readings;
    g.strokeStyle = !v || !v.alive ? '#d0584a' : v.synthetic ? '#6fd3ff' : '#5be37f';
    g.lineWidth = 2;
    g.lineJoin = 'round';
    g.beginPath();
    // a gap runs ahead of the sweep, as on a monitor
    let pen = false;
    for (let i = 0; i < TRACE_N; i++) {
      const ahead = (i - this.cursor + TRACE_N) % TRACE_N;
      if (ahead < 10) {
        pen = false;
        continue;
      }
      const x = i * 2;
      const y = h / 2 - this.samples[i] * h * 0.36;
      if (pen) g.lineTo(x, y);
      else g.moveTo(x, y);
      pen = true;
    }
    g.stroke();
  }
}
