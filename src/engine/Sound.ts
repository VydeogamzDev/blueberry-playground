import type { ImpactSound } from '../world/Materials';

type Kind = string;

/**
 * Procedural sound effects (WebAudio). Nothing is loaded from disk: every
 * effect is synthesized from filtered noise and oscillators.
 */
export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private comp: DynamicsCompressorNode | null = null;
  private noise: AudioBuffer | null = null;
  private last = new Map<Kind, number[]>();
  volume = 0.7;
  muted = false;
  /** Screen-space pan source: returns -1..1 for a world x. */
  panFor: (x: number) => number = () => 0;
  /** Simulation speed (pitch shifts in slow motion). */
  rate = 1;

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
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.ratio.value = 6;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.comp);
    this.comp.connect(ctx.destination);
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
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
  private allow(kind: Kind, max: number, windowMs = 60): boolean {
    const now = performance.now();
    let arr = this.last.get(kind);
    if (!arr) this.last.set(kind, (arr = []));
    while (arr.length && now - arr[0] > windowMs) arr.shift();
    if (arr.length >= max) return false;
    arr.push(now);
    return true;
  }

  private out(x?: number): AudioNode | null {
    if (!this.ctx || !this.master || this.muted) return null;
    if (x === undefined) return this.master;
    const p = this.ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, this.panFor(x) * 0.8));
    p.connect(this.master);
    return p;
  }

  private noiseBurst(dest: AudioNode, o: {
    dur: number; gain: number; type?: BiquadFilterType; freq: number; q?: number; freqEnd?: number; attack?: number; delay?: number;
  }): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + (o.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = this.rate < 1 ? Math.max(0.35, this.rate) : 1;
    const f = ctx.createBiquadFilter();
    f.type = o.type ?? 'bandpass';
    f.frequency.setValueAtTime(o.freq, t);
    if (o.freqEnd) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.freqEnd), t + o.dur);
    f.Q.value = o.q ?? 1;
    const g = ctx.createGain();
    const atk = o.attack ?? 0.002;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.gain), t + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur / Math.min(1, Math.max(0.35, this.rate)));
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 1.5);
    src.stop(t + o.dur / Math.max(0.35, Math.min(1, this.rate)) + 0.05);
  }

  private tone(dest: AudioNode, o: {
    freq: number; freqEnd?: number; dur: number; gain: number; type?: OscillatorType; delay?: number; attack?: number;
  }): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + (o.delay ?? 0);
    const r = Math.max(0.35, Math.min(1, this.rate));
    const osc = ctx.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(o.freq * r, t);
    if (o.freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(10, o.freqEnd * r), t + o.dur / r);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.gain), t + (o.attack ?? 0.003));
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur / r);
    osc.connect(g).connect(dest);
    osc.start(t);
    osc.stop(t + o.dur / r + 0.05);
  }

  // ---- effects -------------------------------------------------------------

  impact(mat: ImpactSound, strength: number, x?: number): void {
    if (mat === 'none' || strength < 0.04) return;
    if (!this.allow('impact', 7, 70) || !this.allow('impact-' + mat, 3, 50)) return;
    const d = this.out(x);
    if (!d) return;
    const s = Math.min(1, strength);
    const v = 0.08 + s * 0.55;
    const jit = 0.85 + Math.random() * 0.3;
    switch (mat) {
      case 'wood':
        this.noiseBurst(d, { dur: 0.09 + s * 0.06, gain: v, freq: 520 * jit, q: 2.2 });
        this.tone(d, { freq: 210 * jit, freqEnd: 150, dur: 0.07, gain: v * 0.6, type: 'triangle' });
        break;
      case 'metal':
        this.noiseBurst(d, { dur: 0.04, gain: v * 0.6, type: 'highpass', freq: 2500 });
        for (const [f, g] of [[430, 0.5], [1090, 0.35], [1830, 0.22], [2710, 0.12]] as const) {
          this.tone(d, { freq: f * jit, dur: 0.18 + s * 0.45, gain: v * g * 0.55, type: 'sine' });
        }
        break;
      case 'flesh':
        this.noiseBurst(d, { dur: 0.1 + s * 0.06, gain: v * 0.9, type: 'lowpass', freq: 420 * jit, q: 1.2 });
        this.tone(d, { freq: 95 * jit, freqEnd: 55, dur: 0.09, gain: v * 0.55 });
        break;
      case 'stone':
        this.noiseBurst(d, { dur: 0.08 + s * 0.05, gain: v, type: 'lowpass', freq: 1300 * jit, q: 0.8 });
        this.tone(d, { freq: 140 * jit, freqEnd: 90, dur: 0.06, gain: v * 0.5 });
        break;
      case 'plastic':
        this.noiseBurst(d, { dur: 0.05, gain: v * 0.7, freq: 1500 * jit, q: 3 });
        break;
      case 'rubber':
        this.tone(d, { freq: 160 * jit, freqEnd: 110, dur: 0.08, gain: v * 0.6, type: 'triangle' });
        break;
      case 'glass':
        for (const f of [2300, 3700, 5200]) this.tone(d, { freq: f * jit, dur: 0.25, gain: v * 0.12 });
        this.noiseBurst(d, { dur: 0.08, gain: v * 0.5, type: 'highpass', freq: 3000 });
        break;
    }
  }

  gunshot(kind: 'pistol' | 'rifle' | 'shotgun' | 'smg' | 'sniper', x?: number): void {
    if (!this.allow('gun', 6, 40)) return;
    const d = this.out(x);
    if (!d) return;
    const big = kind === 'shotgun' || kind === 'sniper';
    const crack = kind === 'pistol' ? 0.55 : kind === 'smg' ? 0.45 : 0.75;
    this.noiseBurst(d, { dur: 0.035, gain: crack, type: 'highpass', freq: 2200 });
    this.noiseBurst(d, { dur: big ? 0.55 : kind === 'rifle' ? 0.38 : 0.26, gain: big ? 0.9 : 0.7, freq: big ? 700 : kind === 'pistol' ? 1400 : 1100, q: 0.6, freqEnd: 300 });
    this.noiseBurst(d, { dur: big ? 0.3 : 0.16, gain: big ? 0.8 : 0.55, type: 'lowpass', freq: 380 });
    this.tone(d, { freq: big ? 110 : 150, freqEnd: 40, dur: big ? 0.25 : 0.12, gain: big ? 0.7 : 0.45 });
    // tail echo
    this.noiseBurst(d, { dur: big ? 0.9 : 0.5, gain: 0.08, type: 'lowpass', freq: 900, freqEnd: 200, delay: 0.05, attack: 0.04 });
  }

  explosion(size: number, x?: number): void {
    if (!this.allow('boom', 4, 120)) return;
    const d = this.out(x);
    if (!d) return;
    const s = Math.min(2, size);
    this.noiseBurst(d, { dur: 0.05, gain: 0.9, type: 'highpass', freq: 1500 });
    this.noiseBurst(d, { dur: 1.2 + s * 0.6, gain: 1.0, type: 'lowpass', freq: 1400, freqEnd: 120, q: 0.7 });
    this.tone(d, { freq: 75, freqEnd: 24, dur: 0.9 + s * 0.3, gain: 1.0 });
    this.noiseBurst(d, { dur: 2.2, gain: 0.18, type: 'bandpass', freq: 600, freqEnd: 150, delay: 0.15, attack: 0.1 });
  }

  bulletHit(mat: ImpactSound, x?: number): void {
    if (!this.allow('bhit', 6, 50)) return;
    const d = this.out(x);
    if (!d) return;
    if (mat === 'flesh') {
      this.noiseBurst(d, { dur: 0.08, gain: 0.45, freq: 900, q: 1.5 });
      this.noiseBurst(d, { dur: 0.12, gain: 0.35, type: 'lowpass', freq: 300 });
    } else if (mat === 'metal') {
      this.noiseBurst(d, { dur: 0.03, gain: 0.4, type: 'highpass', freq: 3000 });
      this.tone(d, { freq: 1900 + Math.random() * 600, freqEnd: 900, dur: 0.22, gain: 0.12 });
    } else {
      this.noiseBurst(d, { dur: 0.06, gain: 0.4, freq: 1100, q: 1.2 });
    }
  }

  ricochet(x?: number): void {
    if (!this.allow('rico', 2, 100)) return;
    const d = this.out(x);
    if (!d) return;
    this.tone(d, { freq: 3200 + Math.random() * 800, freqEnd: 1400, dur: 0.3, gain: 0.08, type: 'sine' });
  }

  click(x?: number, pitch = 1): void {
    if (!this.allow('click', 4, 40)) return;
    const d = this.out(x);
    if (!d) return;
    this.tone(d, { freq: 1800 * pitch, dur: 0.025, gain: 0.18, type: 'square' });
    this.noiseBurst(d, { dur: 0.02, gain: 0.15, type: 'highpass', freq: 4000 });
  }

  fuse(x?: number): void {
    if (!this.allow('fuse', 1, 90)) return;
    const d = this.out(x);
    if (!d) return;
    this.noiseBurst(d, { dur: 0.12, gain: 0.05, type: 'highpass', freq: 5000 });
  }

  squish(strength: number, x?: number): void {
    if (!this.allow('squish', 3, 80)) return;
    const d = this.out(x);
    if (!d) return;
    const s = Math.min(1, strength);
    this.noiseBurst(d, { dur: 0.18, gain: 0.3 + s * 0.4, type: 'lowpass', freq: 650, q: 3 });
    this.noiseBurst(d, { dur: 0.1, gain: 0.25 + s * 0.3, freq: 1300, q: 2, delay: 0.02 });
  }

  snap(x?: number): void {
    if (!this.allow('snap', 2, 80)) return;
    const d = this.out(x);
    if (!d) return;
    this.noiseBurst(d, { dur: 0.05, gain: 0.5, freq: 2400, q: 1.5 });
    this.tone(d, { freq: 300, freqEnd: 120, dur: 0.05, gain: 0.3, type: 'triangle' });
  }

  slash(x?: number): void {
    if (!this.allow('slash', 3, 60)) return;
    const d = this.out(x);
    if (!d) return;
    this.noiseBurst(d, { dur: 0.12, gain: 0.35, freq: 2600, freqEnd: 900, q: 1.2 });
  }

  motor(x?: number): void {
    if (!this.allow('motor', 1, 120)) return;
    const d = this.out(x);
    if (!d) return;
    this.tone(d, { freq: 70, dur: 0.14, gain: 0.04, type: 'sawtooth' });
  }

  zap(x?: number): void {
    if (!this.allow('zap', 2, 80)) return;
    const d = this.out(x);
    if (!d) return;
    this.noiseBurst(d, { dur: 0.15, gain: 0.25, freq: 3500, q: 4 });
    this.tone(d, { freq: 120, dur: 0.15, gain: 0.1, type: 'square' });
  }

  ui(): void {
    const d = this.out();
    if (!d) return;
    this.tone(d, { freq: 900, dur: 0.03, gain: 0.05, type: 'triangle' });
  }
}
