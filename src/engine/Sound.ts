import type { ImpactSound } from '../world/Materials';

export type GunSound = 'pistol' | 'revolver' | 'smg' | 'rifle' | 'shotgun' | 'sniper' | 'minigun' | 'laser';

interface PlayOpts {
  /** Linear gain (before the master volume). */
  gain?: number;
  /** Playback-rate multiplier (pitch). */
  rate?: number;
  /** Random pitch spread (+-fraction). */
  vary?: number;
  /** World x for stereo panning / off-screen attenuation. */
  x?: number;
  /** Start delay in seconds. */
  delay?: number;
}

interface LoopVoice {
  src: AudioBufferSourceNode;
  gain: GainNode;
  pan: StereoPannerNode;
  /** Seconds since the owner last asked for it. */
  idle: number;
}

const MAX_VOICES = 40;

/**
 * Sample-based sound effects. Recordings (CC0, see public/sfx/CREDITS.md) are
 * listed in public/sfx/manifest.json as `category/name -> [variants]`; each play
 * picks a variant (never the same one twice in a row) with a little pitch and
 * level variation, pans it by screen position and pitches it down in slow motion.
 */
export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private manifest: Record<string, string[]> = {};
  private buffers = new Map<string, AudioBuffer>();
  private lastVariant = new Map<string, number>();
  private last = new Map<string, number[]>();
  private loops = new Map<object, Map<string, LoopVoice>>();
  private voices = 0;
  volume = 0.7;
  muted = false;
  /** Screen-space pan source: returns -1..1 for a world x (beyond = off-screen). */
  panFor: (x: number) => number = () => 0;
  /** Simulation speed (sounds pitch down in slow motion). */
  rate = 1;

  constructor() {
    const base = import.meta.env.BASE_URL;
    fetch(`${base}sfx/manifest.json`)
      .then((r) => r.json())
      .then((m: Record<string, unknown>) => {
        for (const [k, v] of Object.entries(m)) if (Array.isArray(v) && k !== 'loops') this.manifest[k] = v as string[];
        if (this.ctx) void this.loadAll();
      })
      .catch(() => {
        /* no sound library: stay silent */
      });
  }

  /** Must be called from a user gesture. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      this.ctx = new AudioContext();
    } catch {
      return;
    }
    const ctx = this.ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.knee.value = 6;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.25;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    this.master.connect(comp);
    comp.connect(ctx.destination);
    if (Object.keys(this.manifest).length) void this.loadAll();
  }

  private async loadAll(): Promise<void> {
    const ctx = this.ctx!;
    const base = import.meta.env.BASE_URL;
    const files = [...new Set(Object.values(this.manifest).flat())].filter((f) => !this.buffers.has(f));
    // a few at a time; the short UI and impact sounds are tiny, so this is quick
    let next = 0;
    const worker = async () => {
      while (next < files.length) {
        const f = files[next++];
        try {
          const data = await (await fetch(base + f)).arrayBuffer();
          this.buffers.set(f, await ctx.decodeAudioData(data));
        } catch {
          /* skip broken files */
        }
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master) this.master.gain.value = this.muted ? 0 : v;
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : this.volume;
  }

  /** Limits how many instances of a sound kind can start within a window. */
  private allow(kind: string, max: number, windowMs = 60): boolean {
    const now = performance.now();
    let arr = this.last.get(kind);
    if (!arr) this.last.set(kind, (arr = []));
    while (arr.length && now - arr[0] > windowMs) arr.shift();
    if (arr.length >= max) return false;
    arr.push(now);
    return true;
  }

  private pick(key: string): AudioBuffer | null {
    const list = this.manifest[key];
    if (!list?.length) return null;
    let i = Math.floor(Math.random() * list.length);
    if (list.length > 1 && i === this.lastVariant.get(key)) i = (i + 1) % list.length;
    this.lastVariant.set(key, i);
    return this.buffers.get(list[i]) ?? this.buffers.get(list.find((f) => this.buffers.has(f)) ?? '') ?? null;
  }

  /** Slow motion pitches everything down a little. */
  private timeRate(): number {
    return this.rate >= 1 ? 1 : 0.55 + 0.45 * Math.max(0, this.rate);
  }

  /** Pan and level for a world x (sounds far off-screen fade out). */
  private spatial(x: number | undefined): { pan: number; att: number } {
    if (x === undefined) return { pan: 0, att: 1 };
    const p = this.panFor(x);
    const over = Math.max(0, Math.abs(p) - 1);
    return { pan: Math.max(-1, Math.min(1, p * 0.75)), att: 1 / (1 + over * 1.6) };
  }

  /** Plays one variant of a sound key. */
  play(key: string, o: PlayOpts = {}): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.muted || ctx.state !== 'running') return;
    // when busy, only loud (important) sounds get a voice
    if (this.voices >= MAX_VOICES && (o.gain ?? 1) < 0.8) return;
    if (this.voices >= MAX_VOICES * 1.5) return;
    const buf = this.pick(key);
    if (!buf) return;
    const { pan, att } = this.spatial(o.x);
    const gain = (o.gain ?? 1) * att * (0.9 + Math.random() * 0.2);
    if (gain < 0.01) return;
    const t = ctx.currentTime + (o.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const vary = o.vary ?? 0.06;
    src.playbackRate.value = (o.rate ?? 1) * (1 + (Math.random() * 2 - 1) * vary) * this.timeRate();
    const g = ctx.createGain();
    g.gain.value = gain;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    src.connect(g).connect(p).connect(this.master);
    this.voices++;
    src.onended = () => {
      this.voices--;
      src.disconnect();
      p.disconnect();
    };
    src.start(t);
  }

  /**
   * Keeps a looping sound running for `owner` while called every step/frame;
   * it fades out shortly after the calls stop.
   */
  hold(owner: object, key: string, gain: number, x?: number, rate = 1): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    let m = this.loops.get(owner);
    if (!m) this.loops.set(owner, (m = new Map()));
    let v = m.get(key);
    const { pan, att } = this.spatial(x);
    if (!v) {
      const buf = this.pick(key);
      if (!buf) return;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const g = ctx.createGain();
      g.gain.value = 0;
      const p = ctx.createStereoPanner();
      src.connect(g).connect(p).connect(this.master);
      src.start(ctx.currentTime, Math.random() * buf.duration);
      v = { src, gain: g, pan: p, idle: 0 };
      m.set(key, v);
    }
    v.idle = 0;
    const t = ctx.currentTime;
    v.gain.gain.setTargetAtTime(this.muted ? 0 : gain * att, t, 0.05);
    v.pan.pan.setTargetAtTime(pan, t, 0.05);
    v.src.playbackRate.setTargetAtTime(rate * this.timeRate(), t, 0.08);
  }

  /** Fades out loops nobody is holding any more. Call once per frame. */
  update(dt: number): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const [owner, m] of this.loops) {
      for (const [key, v] of m) {
        v.idle += dt;
        if (v.idle > 0.12) v.gain.gain.setTargetAtTime(0, t, 0.06);
        if (v.idle > 0.6) {
          v.src.stop();
          v.src.disconnect();
          v.pan.disconnect();
          m.delete(key);
        }
      }
      if (!m.size) this.loops.delete(owner);
    }
  }

  stopAll(): void {
    for (const m of this.loops.values()) for (const v of m.values()) v.idle = 1;
  }

  // ---- game sounds -----------------------------------------------------------

  impact(mat: ImpactSound, strength: number, x?: number): void {
    if (mat === 'none' || strength < 0.04) return;
    if (!this.allow('impact', 8, 70) || !this.allow('impact-' + mat, 3, 50)) return;
    const s = Math.min(1, strength);
    const tier = s < 0.3 ? 0 : s < 0.65 ? 1 : 2;
    const gain = 0.12 + s * 0.88;
    switch (mat) {
      case 'wood':
        this.play(['impact/wood_light', 'impact/wood_medium', 'impact/wood_heavy'][tier], { gain, x });
        break;
      case 'metal':
        this.play(['impact/metal_light', 'impact/metal_medium', 'impact/metal_heavy'][tier], { gain: gain * 0.85, x });
        if (tier === 2) this.play('impact/plate_heavy', { gain: gain * 0.4, x });
        break;
      case 'flesh':
        this.play(['impact/soft', 'impact/punch', 'impact/body_fall'][tier], { gain: gain * 1.1, x, rate: 0.95 });
        if (tier === 2) this.play('impact/punch_heavy', { gain: gain * 0.5, x });
        break;
      case 'stone':
        this.play('impact/stone', { gain, x, rate: tier === 2 ? 0.85 : 1 });
        break;
      case 'plastic':
        this.play('impact/plastic', { gain: gain * 0.8, x });
        break;
      case 'glass':
        this.play(tier === 2 ? 'impact/glass_heavy' : 'impact/glass_light', { gain: gain * 0.8, x });
        break;
      case 'rubber':
        this.play('impact/soft', { gain: gain * 0.9, x, rate: 1.35 });
        break;
    }
  }

  gunshot(kind: GunSound, x?: number): void {
    if (!this.allow('gun', 6, 40)) return;
    switch (kind) {
      case 'pistol': this.play('gun/pistol', { gain: 0.8, x }); break;
      case 'revolver': this.play('gun/magnum', { gain: 0.95, x }); break;
      case 'smg': this.play('gun/smg', { gain: 0.7, x, vary: 0.04 }); break;
      case 'minigun': this.play('gun/rifle', { gain: 0.6, x, rate: 1.15, vary: 0.05 }); break;
      case 'rifle': this.play('gun/rifle', { gain: 0.85, x }); break;
      case 'shotgun':
        this.play('gun/shotgun', { gain: 1, x });
        this.play('gun/pump', { gain: 0.35, x, delay: 0.35 });
        break;
      case 'sniper': this.play('gun/sniper', { gain: 1, x, vary: 0.03 }); break;
      case 'laser':
        this.play('machine/zap', { gain: 0.75, x, rate: 1.7, vary: 0.05 });
        this.play('machine/spark', { gain: 0.3, x, rate: 1.4 });
        break;
    }
  }

  casing(x?: number, big = false): void {
    if (!this.allow('casing', 3, 60)) return;
    this.play('gun/casing', { gain: big ? 0.3 : 0.22, x, rate: big ? 0.8 : 1, vary: 0.12 });
  }

  explosion(size: number, x?: number): void {
    if (!this.allow('boom', 4, 120)) return;
    const big = size > 1.6;
    this.play(big ? 'explosion/large' : 'explosion/small', { gain: 1, x, vary: 0.05, rate: big ? 1 : 1.05 - Math.min(0.15, size * 0.05) });
    this.play('explosion/debris', { gain: big ? 0.55 : 0.35, x, delay: 0.18 });
  }

  bulletHit(mat: ImpactSound, x?: number): void {
    if (!this.allow('bhit', 6, 50)) return;
    switch (mat) {
      case 'flesh': this.play('hit/flesh', { gain: 0.75, x }); break;
      case 'metal': this.play('hit/metal', { gain: 0.5, x }); break;
      case 'wood': this.play('hit/wood', { gain: 0.6, x }); break;
      case 'glass': this.play('hit/glass', { gain: 0.6, x }); break;
      case 'stone': this.play('hit/concrete', { gain: 0.55, x }); break;
      default: this.play('hit/concrete', { gain: 0.35, x, rate: 1.2 });
    }
  }

  ricochet(x?: number): void {
    if (!this.allow('rico', 2, 100)) return;
    this.play('hit/ricochet', { gain: 0.45, x, vary: 0.1 });
  }

  /** Generic small mechanical click (switches, pins, triggers); pitch tints it. */
  click(x?: number, pitch = 1): void {
    if (!this.allow('click', 4, 40)) return;
    this.play('machine/switch', { gain: 0.35, x, rate: 0.75 + pitch * 0.25 });
  }

  button(x?: number): void {
    this.play('machine/button', { gain: 0.5, x });
  }

  /** Something placed/spawned or a tool connection made. */
  place(x?: number, mat: ImpactSound = 'wood'): void {
    if (!this.allow('place', 3, 60)) return;
    this.play(mat === 'metal' ? 'impact/metal_light' : 'impact/generic_light', { gain: 0.3, x, rate: 1.1 });
  }

  squish(strength: number, x?: number): void {
    if (!this.allow('squish', 3, 80)) return;
    const s = Math.min(1, strength);
    this.play(s > 0.75 ? 'gore/splat' : 'gore/squish', { gain: 0.35 + s * 0.6, x });
  }

  gib(x?: number): void {
    if (!this.allow('gib', 2, 80)) return;
    this.play('gore/gib', { gain: 1, x });
    this.play('gore/splat', { gain: 0.6, x, delay: 0.04 });
  }

  /** Bone fracture. */
  bone(x?: number): void {
    if (!this.allow('bone', 2, 80)) return;
    this.play(Math.random() < 0.5 ? 'gore/bone_break' : 'gore/bone_crack', { gain: 0.8, x });
  }

  /** A limb torn off. */
  tear(x?: number): void {
    if (!this.allow('tear', 2, 80)) return;
    this.play('gore/tear', { gain: 0.8, x });
  }

  /** A rope or connection snapping. */
  snap(x?: number): void {
    if (!this.allow('snap', 2, 80)) return;
    this.play('machine/rope_snap', { gain: 0.6, x });
  }

  slash(x?: number): void {
    if (!this.allow('slash', 3, 60)) return;
    this.play('gore/slice', { gain: 0.7, x });
  }

  stab(x?: number): void {
    if (!this.allow('stab', 3, 60)) return;
    this.play('gore/stab', { gain: 0.8, x });
  }

  /** A fast swing through the air. */
  swish(speed: number, x?: number): void {
    if (!this.allow('swish', 2, 150)) return;
    this.play('gore/swish', { gain: Math.min(0.6, 0.15 + speed * 0.04), x, rate: 0.9 + Math.min(0.3, speed * 0.02) });
  }

  zap(x?: number): void {
    if (!this.allow('zap', 2, 80)) return;
    this.play('machine/zap', { gain: 0.6, x });
  }

  spark(x?: number): void {
    if (!this.allow('spark', 2, 80)) return;
    this.play('machine/spark', { gain: 0.5, x });
  }

  /** Pin pulled / pressure plate armed. */
  arm(x?: number): void {
    this.play('gun/dryfire', { gain: 0.5, x, rate: 1.2 });
  }

  ui(kind: 'click' | 'hover' | 'select' | 'toggle' | 'error' | 'confirm' | 'drop' = 'click'): void {
    if (!this.allow('ui', 3, 40)) return;
    this.play('ui/' + kind, { gain: 0.6, vary: 0.02 });
  }
}
