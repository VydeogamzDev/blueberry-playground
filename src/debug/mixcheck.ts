import type { Game } from '../world/Game';
import type { Controls } from '../tools/Controls';
import type { Firearm } from '../entities/Firearm';
import type { Explosive } from '../entities/Explosive';
import type { ImpactSound } from '../world/Materials';
import { Voices, bufferPeak, type GunSound, type TappedSound } from '../engine/Sound';
import { FIXED_DT } from '../engine/constants';
import { makeTestKit } from './testkit';

const SR = 48000;
const dB = (v: number) => (v > 0 ? 20 * Math.log10(v) : -Infinity);
const round1 = (v: number) => Math.round(v * 10) / 10;

interface Started extends TappedSound {
  /** Seconds into the recording. */
  t: number;
}
interface Loop {
  buf: AudioBuffer | null;
  holds: { t: number; gain: number; pan: number; rate: number }[];
}
interface Recording {
  seconds: number;
  started: Started[];
  loops: Loop[];
}

/** A rendered buffer as a 16-bit PCM WAV file, base64. */
function wavBase64(buf: AudioBuffer): string {
  const ch = buf.numberOfChannels;
  const n = buf.length;
  const bytes = new ArrayBuffer(44 + n * ch * 2);
  const v = new DataView(bytes);
  const text = (at: number, s: string) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  v.setUint32(4, 36 + n * ch * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, ch, true);
  v.setUint32(24, buf.sampleRate, true);
  v.setUint32(28, buf.sampleRate * ch * 2, true);
  v.setUint16(32, ch * 2, true);
  v.setUint16(34, 16, true);
  text(36, 'data');
  v.setUint32(40, n * ch * 2, true);
  const data = [...Array(ch)].map((_, c) => buf.getChannelData(c));
  let at = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      v.setInt16(at, Math.round(Math.max(-1, Math.min(1, data[c][i])) * 32767), true);
      at += 2;
    }
  }
  let s = '';
  const u8 = new Uint8Array(bytes);
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}

export interface MixReport {
  scene: string;
  seconds: number;
  /** The mix as it comes out of the master bus at the game's volume: a 16-bit WAV file, base64 (when asked for). */
  wav?: string;
  /** Sounds the game started, how many of those the voice limit turned away, and how many it cut short. */
  sounds: number;
  dropped: number;
  cut: number;
  /** Most sounds playing at once. */
  voices: number;
  /** Peak of the mix going into the master bus and coming out of it (dBFS). */
  peakIn: number;
  peakOut: number;
  /** Output samples beyond full scale, which the sound card would clip (% of the scene). */
  over: number;
  /** The same with the volume turned all the way up: peak out (dBFS) and samples over (%). */
  peakFull: number;
  overFull: number;
  /** Loudest 400 ms out of the bus and the average over the scene (RMS, dBFS). */
  loudest: number;
  mean: number;
  /** The kinds of sound that peaked highest as played (dBFS before the bus) and how many there were. */
  top: [string, number, number][];
}

/** How loud one game sound comes out on its own: its peak and loudest 50 ms (dBFS, before the bus). */
export interface Level {
  sound: string;
  peak: number;
  loud: number;
}

/**
 * Checks the sound mix by measurement rather than by ear, exposed as
 * `bp.mixcheck()` and run by `npm run mixcheck`. It records what the game plays
 * through a few busy scenes (on simulated time, the same rate limits and voice
 * limit applying), renders that offline through the real master bus, and reports
 * peaks, clipping and loudness; and it measures every game sound on its own, so
 * levels can be compared across kinds.
 */
export function makeMixCheck(game: Game, controls: Controls) {
  const kit = makeTestKit(game, controls);
  const snd = game.sound;
  const peaks = new WeakMap<AudioBuffer, { peak: number; loud: number }>();

  /** A buffer's peak and loudest 50 ms RMS (linear). */
  function bufLevel(buf: AudioBuffer): { peak: number; loud: number } {
    let r = peaks.get(buf);
    if (r) return r;
    const chans = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c));
    const n = buf.length;
    const win = Math.max(1, Math.round(0.05 * buf.sampleRate));
    let peak = 0;
    let loud = 0;
    let acc = 0;
    const sq = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (const ch of chans) {
        const v = ch[i];
        if (Math.abs(v) > peak) peak = Math.abs(v);
        s += v * v;
      }
      sq[i] = s / chans.length;
      acc += sq[i];
      if (i >= win) acc -= sq[i - win];
      if (i >= win - 1) loud = Math.max(loud, acc / win);
    }
    if (n < win) loud = acc / Math.max(1, n);
    r = { peak, loud: Math.sqrt(loud) };
    peaks.set(buf, r);
    return r;
  }

  /** Frames x in [-half, half] so panning and off-screen fading act as they would on screen. */
  function frame(half: number): void {
    const r = game.renderer;
    r.camX = 0;
    r.camY = 4;
    r.zoom = r.viewWidth / 2 / half;
    r.targetZoom = r.zoom;
  }

  /**
   * Builds the scene, lets it settle for a second unrecorded, then runs it (its
   * tick each step) for `seconds` with the sound tapped.
   */
  function record(seconds: number, setup: () => (() => void) | void): Recording {
    let simT = 0;
    let t0 = 0;
    const started: Started[] = [];
    const loops = new Map<object, Map<string, Loop>>();
    let on = false;
    snd.tap = {
      play: (s) => {
        if (on) started.push({ ...s, t: simT - t0 + s.delay });
      },
      hold: (owner, key, buf, gain, pan, rate) => {
        if (!on) return;
        let m = loops.get(owner);
        if (!m) loops.set(owner, (m = new Map()));
        let l = m.get(key);
        if (!l) m.set(key, (l = { buf: buf(), holds: [] }));
        l.holds.push({ t: simT - t0, gain, pan, rate });
      },
    };
    snd.clock = () => simT * 1000;
    snd.resetLimits();
    try {
      kit.reset();
      frame(15);
      const tick = setup();
      game.advance(1, () => {
        simT += FIXED_DT;
      });
      on = true;
      t0 = simT;
      game.advance(seconds, () => {
        tick?.();
        simT += FIXED_DT;
      });
    } finally {
      snd.tap = null;
      snd.clock = () => performance.now();
      snd.resetLimits();
    }
    return { seconds, started, loops: [...loops.values()].flatMap((m) => [...m.values()]) };
  }

  /** Renders a recording offline into the master bus (or with only the volume applied: `bus` false). */
  async function render(rec: Recording, bus: boolean, volume = snd.volume): Promise<{ out: AudioBuffer; dropped: number; cut: number; voices: number; played: Started[] }> {
    const ctx = new OfflineAudioContext(2, Math.ceil((rec.seconds + 1.5) * SR), SR);
    let input: GainNode;
    if (bus) input = snd.bus(ctx, volume);
    else {
      input = ctx.createGain();
      input.gain.value = volume;
      input.connect(ctx.destination);
    }
    // who gets a voice, as play() decides it
    const table = new Voices();
    const nodes = new Map<number, { src: AudioBufferSourceNode; g: GainNode }>();
    let dropped = 0;
    let cut = 0;
    let voices = 0;
    const played: Started[] = [];
    for (const s of [...rec.started].sort((a, b) => a.t - b.t)) {
      const v = table.admit(s.key, s.t, s.buf.duration / s.rate, s.gain * bufferPeak(s.buf));
      if (!v) {
        dropped++;
        continue;
      }
      for (const id of v.cut) {
        const n = nodes.get(id);
        if (!n) continue;
        nodes.delete(id);
        n.g.gain.setTargetAtTime(0, s.t, 0.015);
        n.src.stop(s.t + 0.08);
        cut++;
      }
      voices = Math.max(voices, table.count);
      played.push(s);
      const src = ctx.createBufferSource();
      src.buffer = s.buf;
      src.playbackRate.value = s.rate;
      const g = ctx.createGain();
      g.gain.value = s.gain;
      const p = ctx.createStereoPanner();
      p.pan.value = s.pan;
      src.connect(g).connect(p).connect(input);
      src.start(s.t);
      nodes.set(v.id, { src, g });
    }
    // held loops, fading in and out as hold() and update() do
    for (const l of rec.loops) {
      if (!l.buf || !l.holds.length) continue;
      const src = ctx.createBufferSource();
      src.buffer = l.buf;
      src.loop = true;
      const g = ctx.createGain();
      g.gain.value = 0;
      const p = ctx.createStereoPanner();
      src.connect(g).connect(p).connect(input);
      l.holds.forEach((h, i) => {
        g.gain.setTargetAtTime(h.gain, h.t, 0.05);
        p.pan.setTargetAtTime(h.pan, h.t, 0.05);
        src.playbackRate.setTargetAtTime(h.rate, h.t, 0.08);
        const next = l.holds[i + 1];
        if (!next || next.t - h.t > 0.12) g.gain.setTargetAtTime(0, h.t + 0.12, 0.06);
      });
      src.start(l.holds[0].t, Math.random() * l.buf.duration);
      src.stop(l.holds[l.holds.length - 1].t + 0.6);
    }
    return { out: await ctx.startRendering(), dropped, cut, voices, played };
  }

  function analyse(buf: AudioBuffer): { peak: number; over: number; loudest: number; mean: number } {
    const L = buf.getChannelData(0);
    const R = buf.getChannelData(1);
    const win = Math.round(0.4 * SR);
    let peak = 0;
    let over = 0;
    let acc = 0;
    let total = 0;
    let loudest = 0;
    const sq = new Float32Array(L.length);
    for (let i = 0; i < L.length; i++) {
      const a = Math.abs(L[i]);
      const b = Math.abs(R[i]);
      peak = Math.max(peak, a, b);
      if (a > 1 || b > 1) over++;
      sq[i] = (L[i] * L[i] + R[i] * R[i]) / 2;
      acc += sq[i];
      total += sq[i];
      if (i >= win) acc -= sq[i - win];
      if (i >= win - 1) loudest = Math.max(loudest, acc / win);
    }
    return { peak, over: over / L.length, loudest: Math.sqrt(loudest), mean: Math.sqrt(total / L.length) };
  }

  const scenes: Record<string, { seconds: number; setup: () => (() => void) | void }> = {
    /** Rifles spraying into a crowd, grenades going off among them. */
    battle: {
      seconds: 8,
      setup() {
        for (let i = 0; i < 20; i++) kit.spawn('human', -10 + i * 1.05, 0.9);
        const guns: Firearm[] = [];
        for (let i = 0; i < 4; i++) {
          const left = i % 2 === 0;
          const g = kit.spawn('rifle', left ? -13 : 13, 1 + i * 0.3, { flip: !left }) as Firearm;
          g.setFrozen(true);
          guns.push(g);
        }
        let n = 0;
        return () => {
          n++;
          if (n % 12 === 0) for (const g of guns) if (!g.destroyed) g.fire();
          if (n % 180 === 0) (kit.spawn('grenade', (Math.random() - 0.5) * 16, 3) as Explosive).activate();
        };
      },
    },
    /** Thirty people dropped onto each other in three heaps. */
    pile: {
      seconds: 6,
      setup() {
        let n = 0;
        return () => {
          if (n < 30 && ++n) kit.spawn('human', [-6, 0, 6][n % 3] + ((n * 0.37) % 0.6) - 0.3, 3 + Math.floor(n / 3) * 0.6, { angle: Math.PI / 2 });
        };
      },
    },
    /** Six grenades going off at once among people and crates. */
    blasts: {
      seconds: 5,
      setup() {
        for (let i = 0; i < 10; i++) kit.spawn('human', -9 + i * 2, 0.9);
        for (let i = 0; i < 6; i++) kit.spawn('crate', -7.5 + i * 3, 0.45);
        let n = 0;
        return () => {
          if (++n !== 150) return;
          for (let i = 0; i < 6; i++) {
            const g = kit.spawn('grenade', -8 + i * 3.2, 1.5) as Explosive;
            g.activate();
          }
        };
      },
    },
  };

  /** Every game sound on its own, at the middle of the screen (median of a few plays). */
  function levels(): Level[] {
    const out: Level[] = [];
    let simT = 0;
    let got: TappedSound[] = [];
    snd.tap = { play: (s) => got.push(s), hold: () => {} };
    snd.clock = () => simT;
    snd.resetLimits();
    const measure = (name: string, fn: () => void) => {
      const peak: number[] = [];
      const loud: number[] = [];
      for (let i = 0; i < 7; i++) {
        simT += 1000;
        got = [];
        fn();
        if (!got.length) continue;
        // sounds started together (a shot and its echo) count as one
        let p = 0;
        let l = 0;
        for (const s of got) {
          const lv = bufLevel(s.buf);
          p += lv.peak * s.gain;
          l = Math.max(l, lv.loud * s.gain);
        }
        peak.push(p);
        loud.push(l);
      }
      const med = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] ?? 0;
      if (peak.length) out.push({ sound: name, peak: round1(dB(med(peak))), loud: round1(dB(med(loud))) });
    };
    const x = game.renderer.camX;
    try {
      const mats: ImpactSound[] = ['wood', 'metal', 'flesh', 'stone', 'plastic', 'glass', 'rubber'];
      for (const m of mats) for (const s of [0.2, 0.5, 1]) measure(`impact ${m} ${s}`, () => snd.impact(m, s, x));
      const guns: GunSound[] = ['pistol', 'revolver', 'smg', 'rifle', 'shotgun', 'sniper', 'minigun', 'laser'];
      for (const g of guns) measure(`gunshot ${g}`, () => snd.gunshot(g, x));
      measure('explosion small', () => snd.explosion(1, x));
      measure('explosion large', () => snd.explosion(2.5, x));
      for (const m of mats) measure(`bullet hit ${m}`, () => snd.bulletHit(m, x));
      measure('ricochet', () => snd.ricochet(x));
      measure('casing', () => snd.casing(x));
      measure('casing big', () => snd.casing(x, true));
      measure('click', () => snd.click(x));
      measure('button', () => snd.button(x));
      measure('place', () => snd.place(x));
      measure('squish 0.3', () => snd.squish(0.3, x));
      measure('squish 1', () => snd.squish(1, x));
      measure('gib', () => snd.gib(x));
      measure('bone', () => snd.bone(x));
      measure('tear', () => snd.tear(x));
      measure('snap', () => snd.snap(x));
      measure('slash', () => snd.slash(x));
      measure('stab', () => snd.stab(x));
      measure('swish', () => snd.swish(10, x));
      measure('zap', () => snd.zap(x));
      measure('spark', () => snd.spark(x));
      measure('arm', () => snd.arm(x));
      for (const k of ['click', 'hover', 'select', 'toggle', 'error', 'confirm', 'drop'] as const) measure(`ui ${k}`, () => snd.ui(k));
      // the animals' voices (at the level Creature gives a yelp of pain), splashes, breaking glass
      for (const k of snd.keys().filter((k) => k.startsWith('creature/'))) measure(k, () => snd.play(k, { gain: 0.6, x }));
      measure('liquid splash', () => snd.play('liquid/splash', { gain: 0.9, x }));
      measure('glass break', () => snd.play('impact/glass_break', { gain: 0.9, x }));
    } finally {
      snd.tap = null;
      snd.clock = () => performance.now();
      snd.resetLimits();
    }
    return out;
  }

  return {
    /** Records, renders and measures the busy scenes (all, or those whose name contains `filter`). */
    async scenes(filter = '', wav = false): Promise<MixReport[]> {
      await snd.whenLoaded();
      const reports: MixReport[] = [];
      for (const [name, sc] of Object.entries(scenes)) {
        if (filter && !name.includes(filter)) continue;
        const rec = record(sc.seconds, sc.setup);
        const dry = await render(rec, false);
        const wet = await render(rec, true);
        const full = analyse((await render(rec, true, 1)).out);
        const a = analyse(dry.out);
        const b = analyse(wet.out);
        const keys = new Map<string, { n: number; peak: number }>();
        for (const s of wet.played) {
          const k = keys.get(s.key) ?? { n: 0, peak: 0 };
          k.n++;
          k.peak = Math.max(k.peak, bufLevel(s.buf).peak * s.gain * snd.volume);
          keys.set(s.key, k);
        }
        reports.push({
          scene: name,
          seconds: sc.seconds,
          sounds: rec.started.length,
          dropped: wet.dropped,
          cut: wet.cut,
          voices: wet.voices,
          peakIn: round1(dB(a.peak)),
          peakOut: round1(dB(b.peak)),
          over: Math.round(b.over * 1e5) / 1e3,
          peakFull: round1(dB(full.peak)),
          overFull: Math.round(full.over * 1e5) / 1e3,
          loudest: round1(dB(b.loudest)),
          mean: round1(dB(b.mean)),
          top: [...keys.entries()].sort((p, q) => q[1].peak - p[1].peak).slice(0, 8).map(([k, v]) => [k, round1(dB(v.peak)), v.n]),
          wav: wav ? wavBase64(wet.out) : undefined,
        });
      }
      kit.reset();
      return reports;
    },
    /** Every game sound measured on its own (before the master volume and bus). */
    async levels(): Promise<Level[]> {
      await snd.whenLoaded();
      return levels();
    },
  };
}
