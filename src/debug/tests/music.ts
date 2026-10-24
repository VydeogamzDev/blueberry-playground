import type { Test, TestCtx } from './types';
import { CROSSFADE, MUSIC, Music, musicUrl, playlist, type MusicMood } from '../../engine/Music';

/** Background music: the files, switching between the menu's and the sandbox's, stopping, its volume, and mute. */
export default function tests({ game, kit }: TestCtx): Test[] {
  const m = game.music;
  const s = game.sound;
  const menu = MUSIC.menu[0].file;
  const sandbox = MUSIC.sandbox.map((t) => t.file);
  const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));
  /** Waits `secs` by the audio clock the fades run on (a busy headless page's lags the wall clock), or 4x that in real time at most. */
  const audioWait = async (secs: number) => {
    const ctx = s.output?.ctx;
    const t0 = ctx?.currentTime ?? 0;
    const end = performance.now() + secs * 4000;
    while (ctx && ctx.currentTime < t0 + secs && performance.now() < end) await sleep(50);
  };
  /** The decks as they are now, for a failure message. */
  const decks = () => JSON.stringify(m.decksNow.map((d) => ({ ...d, gain: Math.round(d.gain * 100) / 100 })));
  /** Back to the music that was on before the test. */
  const restore = (mood: MusicMood | null) => (mood ? m.play(mood) : m.stop());

  return [
    ['extra: music: every track loads, as Ogg Vorbis an audio element can play', async () => {
      kit.reset();
      if (!new Audio().canPlayType('audio/ogg; codecs="vorbis"')) return 'this browser cannot play Ogg Vorbis in an audio element';
      for (const file of [menu, ...sandbox]) {
        let bytes: Uint8Array;
        try {
          const r = await fetch(musicUrl(file));
          if (!r.ok) return `${file}: HTTP ${r.status}`;
          bytes = new Uint8Array(await r.arrayBuffer());
        } catch (e) {
          return `${file}: ${String(e)}`;
        }
        if (bytes.length < 100_000) return `${file} is only ${bytes.length} bytes`;
        if (String.fromCharCode(...bytes.subarray(0, 4)) !== 'OggS') return `${file} is not an Ogg file`;
        // as the music will play it: its length, read by an audio element
        const secs = await new Promise<number>((res) => {
          const a = new Audio();
          a.preload = 'metadata';
          a.onloadedmetadata = () => res(a.duration);
          a.onerror = () => res(NaN);
          setTimeout(() => res(NaN), 3000);
          a.src = musicUrl(file);
        });
        if (!(secs > 30 && secs < 240)) return `${file}: an audio element reads it as ${secs} s long`;
      }
      return true;
    }],
    ['extra: music: a plan gives anyone who has it the same track at the same place, and never one track twice running', () => {
      kit.reset();
      const a = new Music(s);
      const b = new Music(s);
      // an hour into it, as for a guest joining a long game
      const plan = { seed: 12345, start: performance.now() - 3_600_000 };
      a.follow(plan);
      b.follow({ ...plan });
      const pa = a.planned;
      const pb = b.planned;
      // (between two tracks both say so)
      if (JSON.stringify(pa?.file) !== JSON.stringify(pb?.file) || Math.abs((pa?.pos ?? 0) - (pb?.pos ?? 0)) > 0.05) return `one has ${JSON.stringify(pa)}, the other ${JSON.stringify(pb)}`;
      for (const seed of [1, 2, 3, 99, 4242]) {
        const list = playlist(seed);
        const seen: string[] = [];
        for (let i = 0; i < 40; i++) seen.push(list.next().value.file);
        const twice = seen.findIndex((f, i) => i > 0 && f === seen[i - 1]);
        if (twice > 0) return `seed ${seed}: ${seen[twice]} twice running (at ${twice})`;
        if (new Set(seen.slice(0, MUSIC.sandbox.length)).size !== MUSIC.sandbox.length) return `seed ${seed}: the first ${MUSIC.sandbox.length} aren't every track once: ${seen.slice(0, 4).join(', ')}`;
        if (JSON.stringify(seen) !== JSON.stringify([...Array(40)].map(((l) => () => l.next().value.file)(playlist(seed))))) return `seed ${seed} gave two orders`;
      }
      return true;
    }],
    ['extra: music: the menu theme plays, and the sandbox music crossfades over from it', async () => {
      kit.reset();
      const was = m.mood;
      s.unlock();
      const ctx = s.output?.ctx;
      if (!ctx) return 'no audio after unlock()';
      try {
        m.play('menu');
        if (m.track !== menu) return `play('menu') put on ${m.track}`;
        await sleep(700);
        const on = m.decksNow.find((d) => d.track === menu && d.target === 1);
        if (!on) return `no deck bringing up the menu theme: ${decks()}`;
        if (!on.playing) return `the menu theme isn't playing (audio ${ctx.state}, page ${document.visibilityState}): ${decks()}`;
        m.play('sandbox');
        const track = m.track;
        if (!track || !sandbox.includes(track)) return `play('sandbox') put on ${track}`;
        if (!m.decksNow.some((d) => d.track === menu && d.target === 0)) return `the menu theme isn't fading out: ${decks()}`;
        if (!m.decksNow.some((d) => d.track === track && d.target === 1)) return `${track} isn't fading in: ${decks()}`;
        await audioWait(CROSSFADE + 0.5);
        const old = m.decksNow.find((d) => d.track === menu);
        const now = m.decksNow.find((d) => d.track === track);
        if (old?.playing) return `the menu theme still plays ${CROSSFADE + 0.5} s after the switch: ${decks()}`;
        if (!now?.playing) return `${track} isn't playing ${CROSSFADE + 0.5} s after the switch: ${decks()}`;
        if (ctx.state === 'running' && (now.gain < 0.95 || (old && old.gain > 0.05))) return `the gains after the crossfade: ${decks()}`;
        return true;
      } finally {
        restore(was);
      }
    }],
    ['extra: music: stop() fades the music out to silence', async () => {
      kit.reset();
      const was = m.mood;
      s.unlock();
      try {
        m.play('menu');
        await sleep(300);
        m.stop();
        if (m.mood !== null || m.track !== null) return `after stop() the mood is ${m.mood} and the track ${m.track}`;
        if (m.decksNow.some((d) => d.target !== 0)) return `not every deck is fading out: ${decks()}`;
        await audioWait(CROSSFADE + 0.5);
        if (m.decksNow.some((d) => d.playing || d.gain > 0.01)) return `${CROSSFADE + 0.5} s after stop(): ${decks()}`;
        return true;
      } finally {
        restore(was);
      }
    }],
    ['extra: music: the music volume slider sets its gain, and is kept for the next visit', () => {
      kit.reset();
      const slider = document.querySelector<HTMLInputElement>('input.set-music');
      if (!slider) return 'no music volume slider in the settings';
      const was = m.volume;
      try {
        slider.value = '0.3';
        slider.dispatchEvent(new Event('input'));
        if (Math.abs(m.volume - 0.3) > 1e-6) return `the slider at 0.3 set the music volume to ${m.volume}`;
        const out = m.output;
        if (out && Math.abs(out.gain.value - 0.3) > 1e-6) return `the music's gain is ${out.gain.value} at volume 0.3`;
        const kept = JSON.parse(localStorage.getItem('blueberry-music') ?? '{}') as { volume?: number };
        if (kept.volume !== 0.3) return `not kept in the browser (${JSON.stringify(kept)})`;
        const next = new Music(s).volume;
        if (Math.abs(next - 0.3) > 1e-6) return `the next visit's music volume would be ${next}`;
        return true;
      } finally {
        m.setVolume(was);
        slider.value = String(was);
      }
    }],
    ['extra: music: it plays into the master bus, so mute silences it', async () => {
      kit.reset();
      s.unlock();
      const out = s.output;
      if (!out) return 'no audio after unlock()';
      if (out.ctx.state !== 'running') return `the audio is ${out.ctx.state}`;
      const was = { volume: s.volume, muted: s.muted, music: m.volume, mood: m.mood };
      // listens to the music's output and the master's, into a silent sink (so they're surely run)
      const atMusic = out.ctx.createAnalyser();
      const atMaster = out.ctx.createAnalyser();
      atMusic.fftSize = atMaster.fftSize = 32768;
      const sink = out.ctx.createGain();
      sink.gain.value = 0;
      sink.connect(out.ctx.destination);
      atMusic.connect(sink);
      atMaster.connect(sink);
      out.master.connect(atMaster);
      let tapped: GainNode | null = null;
      const rms = (a: AnalyserNode) => {
        const buf = new Float32Array(a.fftSize);
        a.getFloatTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += v * v;
        return Math.sqrt(sum / buf.length);
      };
      try {
        // the master turned right down, so the run stays all but silent
        s.setVolume(0.001);
        s.setMuted(false);
        m.setVolume(1);
        m.play('menu');
        tapped = m.output;
        if (!tapped) return 'the music has no output after play() with the audio started';
        tapped.connect(atMusic);
        await sleep(1200);
        const music = rms(atMusic);
        const master = rms(atMaster);
        if (music < 0.003) return `the menu theme came out of the music at only ${music.toExponential(1)} RMS: ${decks()}`;
        if (master < music * 0.0003) return `the master bus carried ${master.toExponential(1)} RMS of it (the music ${music.toExponential(1)}, the master volume 0.001)`;
        s.setMuted(true);
        // (a short window: only what came after the mute)
        atMaster.fftSize = 2048;
        await sleep(250);
        const muted = rms(atMaster);
        if (muted > 1e-6) return `muted, the master bus still carries ${muted.toExponential(1)} RMS`;
        return true;
      } finally {
        out.master.disconnect(atMaster);
        tapped?.disconnect(atMusic);
        sink.disconnect();
        s.setVolume(was.volume);
        s.setMuted(was.muted);
        m.setVolume(was.music);
        restore(was.mood);
      }
    }],
  ];
}
