import type { Sound } from './Sound';
import { audioPath } from './assets';
import { store } from './Store';

/** What music is on: the main menu's theme, or the sandbox's tracks. */
export type MusicMood = 'menu' | 'sandbox';

export interface Track {
  /** The file, under public/. */
  file: string;
  /** Its length (s): the sandbox's playlist is laid out in time from these (see MusicPlan). */
  secs: number;
  /** Loops seamlessly, with no ending of its own (in the sandbox it goes round ROUNDS times, then fades out). */
  loops?: boolean;
}

/**
 * The sandbox's playlist, laid out in time: the order of the tracks comes from
 * `seed` (shuffled, never the same one twice running) and the first starts at
 * `start` (performance.now(), ms). Anyone with the same plan, its start put on
 * their own clock, hears the same track at the same place in it: a multiplayer
 * game's guests are given the host's (see Host's NetTime).
 */
export interface MusicPlan {
  seed: number;
  start: number;
}

/**
 * The music: CC0 recordings (credited in public/sfx/CREDITS.md), levelled to
 * about -20 LUFS so it sits under the sound effects.
 */
export const MUSIC: Record<MusicMood, Track[]> = {
  menu: [{ file: 'music/funked_up.ogg', secs: 66.27, loops: true }],
  sandbox: [
    { file: 'music/bossa_nova.ogg', secs: 59.61, loops: true },
    { file: 'music/chill_lofi.ogg', secs: 97.22, loops: true },
    { file: 'music/raspberry_jam.ogg', secs: 173.93 },
    { file: 'music/apple_cider.ogg', secs: 152 },
  ],
};

/** Seconds the music takes to fade from one mood's into the other's (or out, stopped). */
export const CROSSFADE = 1.5;
/** Where the music volume is kept in the browser. */
const STORE = 'blueberry-music';
/** Seconds of quiet between one sandbox track and the next. */
const GAP = 3;
/** Times a looping track goes round in the sandbox before the next one. */
const ROUNDS = 2;
/** Seconds a looping track takes to fade out at the end of its last time round. */
const TAIL = 4;
/** Seconds a track may stray from where the plan has it before it's put back there (a hidden page's pause, a host's clock). */
const DRIFT = 0.4;
/** How often (ms) the music looks at where the plan is: the next track, the quiet between, the place in this one. */
const KEEP_MS = 250;

/** Seconds a sandbox track is on for: a looping one goes round ROUNDS times. */
const span = (t: Track) => (t.loops ? t.secs * ROUNDS : t.secs);

/** A plan's tracks in order: shuffled again each time through, never the same one twice running. */
export function* playlist(seed: number): Generator<Track, never> {
  // (mulberry32: the same seed gives the same order on every machine)
  let s = seed >>> 0;
  const rand = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let last: Track | null = null;
  for (;;) {
    const q = [...MUSIC.sandbox];
    for (let i = q.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [q[i], q[j]] = [q[j], q[i]];
    }
    if (q.length > 1 && q[0] === last) q.push(q.shift()!);
    yield* q;
    last = q[q.length - 1];
  }
}

const urls = new Map<string, string>();

/**
 * A URL an audio element can stream a file of public/ from. The standalone page
 * carries its files inside itself (see assets.ts): there it's a blob URL of the
 * file's bytes.
 */
export function musicUrl(path: string): string {
  let url = urls.get(path);
  if (url === undefined) {
    const packed = (globalThis as { BP_ASSETS?: Record<string, Uint8Array<ArrayBuffer>> }).BP_ASSETS?.[path];
    url = packed ? URL.createObjectURL(new Blob([packed], { type: 'audio/ogg' })) : import.meta.env.BASE_URL + audioPath(path);
    urls.set(path, url);
  }
  return url;
}

/** One of the two players the music crossfades between. */
interface Deck {
  el: HTMLAudioElement;
  gain: GainNode;
  track: Track | null;
  /** Where its gain is heading: 1 on, 0 fading out (or off). */
  target: number;
  /** Should be playing whenever the audio may: false once it has faded out or ended. */
  live: boolean;
  /** Goes up whenever the deck is given something else to do: what was planned for it before is off. */
  turn: number;
}

/**
 * Background music: the main menu's theme on a loop, or the sandbox's tracks
 * shuffled, one after another, laid out in time by a MusicPlan (so a
 * multiplayer game's players all hear the host's, in step); switching between
 * the two crossfades. The tracks
 * stream through audio elements (a few minutes decoded whole would take tens of
 * MB each) into Sound's master bus, so the master volume, mute and limiter apply
 * to them. Nothing plays before the first click or key (browsers forbid it), nor
 * while the page is hidden or the audio suspended.
 */
export class Music {
  /** The music's volume (0..1, under the master): the player's setting, kept in the browser. */
  volume = 0.5;
  private wanted: MusicMood | null = null;
  private ctx: AudioContext | null = null;
  /** The music's volume, into the master bus. */
  private bus: GainNode | null = null;
  private decks: Deck[] = [];
  /** The deck with the mood's music on (or fading in). */
  private current: Deck | null = null;
  /** The sandbox's playlist (null until the sandbox's music is first asked for). */
  private plan: MusicPlan | null = null;
  /** Playing a multiplayer host's plan (see follow()): coming back to the sandbox doesn't start one of our own. */
  private following = false;
  /** Where in its plan the music last looked: the track then, its start (s into the plan), and the tracks after it. */
  private walk: { plan: MusicPlan; track: Track; from: number; rest: Generator<Track, never> } | null = null;
  /** The last sandbox track begun: a new plan doesn't start with it again. */
  private last: Track | null = null;
  private hooked = false;

  constructor(private sound: Sound) {
    try {
      const s = JSON.parse(store.getItem(STORE) ?? '{}') as { volume?: unknown };
      if (typeof s.volume === 'number' && s.volume >= 0 && s.volume <= 1) this.volume = s.volume;
    } catch {
      /* no storage (or a broken entry): the default */
    }
  }

  /** The mood asked for (null: stopped). */
  get mood(): MusicMood | null {
    return this.wanted;
  }

  /** The track on (or fading in), as its file under public/. */
  get track(): string | null {
    return this.current?.track?.file ?? null;
  }

  /** Debug: the music's output (after its volume), into the master bus; null until the audio has started. */
  get output(): GainNode | null {
    return this.bus;
  }

  /** Debug: each deck's track, where its gain is heading and is now, and whether it's playing. */
  get decksNow(): { track: string | null; target: number; gain: number; playing: boolean }[] {
    return this.decks.map((d) => ({ track: d.track?.file ?? null, target: d.target, gain: d.gain.gain.value, playing: !d.el.paused }));
  }

  /** Plays the menu's theme or the sandbox's tracks, fading over from what's on (once sound is unlocked). */
  play(mood: MusicMood): void {
    // (the sandbox's music may be between two tracks: still on)
    if (mood === this.wanted && (this.current || (mood === 'sandbox' && this.plan))) return;
    this.wanted = mood;
    // the sandbox's tracks from the top of a new plan, or the host's where they are
    if (mood === 'sandbox' && !this.following) this.plan = this.newPlan();
    this.hook();
    this.start();
  }

  /** The sandbox track the plan has on now and how far into it (s): null between two, or with no plan yet. */
  get planned(): { file: string; pos: number } | null {
    const at = this.plan && this.placeIn(this.plan, performance.now());
    return at ? { file: at.track.file, pos: at.pos } : null;
  }

  /** The sandbox's plan to give a multiplayer game's guests (one made now if there's none yet). */
  get shared(): MusicPlan {
    return (this.plan ??= this.newPlan());
  }

  /**
   * Plays a multiplayer host's plan, its start put on our clock (null: our own
   * again, carrying on from where the host's had got to). Sent again and again
   * as the clocks are compared: a start that has moved only a little is kept.
   */
  follow(plan: MusicPlan | null): void {
    this.following = !!plan;
    if (!plan) return;
    const p = this.plan;
    if (p && p.seed === plan.seed && Math.abs(p.start - plan.start) < DRIFT * 500) return;
    this.plan = { seed: plan.seed, start: plan.start };
    this.keep();
  }

  /** A plan starting now, with a track other than the last one begun. */
  private newPlan(): MusicPlan {
    const r = new Uint32Array(1);
    // (not Math.random: a test run seeds that, and the music's turns come at no set moment of it)
    for (let i = 0; i < 8; i++) {
      crypto.getRandomValues(r);
      if (playlist(r[0]).next().value !== this.last) break;
    }
    return { seed: r[0], start: performance.now() };
  }

  /** Fades the music out. */
  stop(): void {
    this.wanted = null;
    if (this.current) this.fadeOut(this.current);
    this.current = null;
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.bus) this.bus.gain.value = v;
    try {
      store.setItem(STORE, JSON.stringify({ volume: v }));
    } catch {
      /* not kept: fine for this visit */
    }
  }

  /**
   * Starts the music when the audio starts. That's Sound.unlock(), which any
   * click or key now makes as well (a player's first press may be a key).
   */
  private hook(): void {
    if (this.hooked) return;
    this.hooked = true;
    this.sound.onUnlock.push(() => this.unlocked());
    // (only the player's own: the self-tests' made-up events don't start anything they didn't before)
    const gesture = (e: Event) => {
      if (e.isTrusted) this.sound.unlock();
    };
    addEventListener('pointerdown', gesture, true);
    addEventListener('keydown', gesture, true);
    // (an iPhone lets sound start only as a finger lifts, or on the click after it)
    addEventListener('touchend', gesture, true);
    addEventListener('click', gesture, true);
  }

  private unlocked(): void {
    if (this.wanted && !this.current) this.start();
    // (or another go at what the browser wouldn't play before: some only allow it during a click)
    else this.sync();
  }

  /** Puts on the wanted mood's music, fading over from what's on. */
  private start(): void {
    const mood = this.wanted;
    if (!mood || !this.build()) return;
    if (mood === 'sandbox') return this.keep();
    const old = this.current;
    const track = MUSIC.menu[0];
    // the other deck; one still fading out with this very track (a quick switch back) fades back in from where it is
    const d =
      this.decks.find((x) => x !== old && x.live && x.track === track) ??
      this.decks.find((x) => x !== old && !x.live) ??
      this.decks.find((x) => x !== old)!;
    if (old) this.fadeOut(old);
    this.current = d;
    if (d.live && d.track === track) {
      d.turn++;
      this.fade(d, 1, CROSSFADE);
      this.sync();
    } else this.load(d, track, CROSSFADE);
  }

  /** Makes the two players once Sound has started the audio (false before). */
  private build(): boolean {
    if (this.ctx) return true;
    const out = this.sound.output;
    if (!out) return false;
    const ctx = (this.ctx = out.ctx);
    const bus = (this.bus = ctx.createGain());
    bus.gain.value = this.volume;
    bus.connect(out.master);
    for (let i = 0; i < 2; i++) {
      const el = new Audio();
      const gain = ctx.createGain();
      gain.gain.value = 0;
      ctx.createMediaElementSource(el).connect(gain).connect(bus);
      const d: Deck = { el, gain, track: null, target: 0, live: false, turn: 0 };
      // (a track that won't load is passed over like one that has ended: the plan moves on without it)
      el.addEventListener('ended', () => (d.live = false));
      el.addEventListener('error', () => (d.live = false));
      this.decks.push(d);
    }
    ctx.addEventListener('statechange', () => this.sync());
    document.addEventListener('visibilitychange', () => {
      this.sync();
      this.keep();
    });
    setInterval(() => this.keep(), KEEP_MS);
    return true;
  }

  /** Puts a track on a deck from `from` s into it, fading it in over `fadeIn` s. */
  private load(d: Deck, track: Track, fadeIn: number, from = 0): void {
    d.turn++;
    d.track = track;
    d.live = true;
    // a looping track goes round for as long as it's on (in the sandbox, ROUNDS times: see keep)
    d.el.loop = !!track.loops;
    d.el.src = musicUrl(track.file);
    // (before it has loaded, this is where it will start)
    if (from > 0) d.el.currentTime = from;
    this.fade(d, 1, fadeIn, 0);
    this.sync();
  }

  /** Takes a deck's gain to `to` over `secs` (from `from`, or from where it is). */
  private fade(d: Deck, to: number, secs: number, from?: number): void {
    const g = d.gain.gain;
    const t = this.ctx!.currentTime;
    d.target = to;
    g.cancelScheduledValues(t);
    g.setValueAtTime(from ?? g.value, t);
    g.linearRampToValueAtTime(to, t + secs);
  }

  /** Fades a deck out, then stops it. */
  private fadeOut(d: Deck, secs = CROSSFADE): void {
    const turn = ++d.turn;
    this.fade(d, 0, secs);
    setTimeout(() => {
      if (d.turn !== turn) return;
      d.live = false;
      d.el.pause();
    }, secs * 1000 + 100);
  }

  /**
   * The sandbox's music, kept where its plan has it now (a few times a second):
   * the next track when one is due, quiet in the gap after one, a looping one
   * faded out at the end of its last time round, and a track that has strayed
   * from its place (the page hidden a while, a host's clock) put back.
   */
  private keep(): void {
    if (this.wanted !== 'sandbox' || !this.ctx || !this.plan) return;
    const at = this.placeIn(this.plan, performance.now());
    const d = this.current;
    if (!at) {
      // the quiet between two tracks
      if (d) this.fadeOut(d, 0.3);
      this.current = null;
      return;
    }
    const { track, pos } = at;
    const want = track.loops ? pos % track.secs : pos;
    if (!d || d.track !== track) {
      // the next track from its start (or, joining a game, from where everyone else is)
      const other = this.decks.find((x) => x !== d && !x.live) ?? this.decks.find((x) => x !== d)!;
      if (d) this.fadeOut(d);
      this.current = other;
      this.last = track;
      this.load(other, track, d || pos > 1 ? CROSSFADE : 0.05, want);
      return;
    }
    // (ended a moment before the plan's end of it: done)
    if (!d.live) return;
    const left = span(track) - pos;
    if (track.loops && left < TAIL && d.target > 0) this.fade(d, 0, left);
    const el = d.el;
    if (el.seeking || el.readyState < 1 || el.paused) return;
    let off = Math.abs(el.currentTime - want);
    if (track.loops) off = Math.min(off, track.secs - off);
    if (off > DRIFT) el.currentTime = want;
  }

  /** The track a plan has on at `now` (performance.now()), and how far into it (s): null in the quiet between two. */
  private placeIn(plan: MusicPlan, now: number): { track: Track; pos: number } | null {
    const t = Math.max(0, (now - plan.start) / 1000);
    let w = this.walk;
    if (!w || w.plan !== plan || t < w.from) {
      const rest = playlist(plan.seed);
      w = this.walk = { plan, track: rest.next().value, from: 0, rest };
    }
    while (t >= w.from + span(w.track) + GAP) {
      w.from += span(w.track) + GAP;
      w.track = w.rest.next().value;
    }
    const pos = t - w.from;
    return pos < span(w.track) ? { track: w.track, pos } : null;
  }

  /** Plays what should be heard, and pauses it all while the page is hidden or the audio suspended (nothing else sounds then either). */
  private sync(): void {
    const on = this.ctx?.state === 'running' && !document.hidden;
    for (const d of this.decks) {
      if (on && d.live) {
        if (d.el.paused)
          d.el.play().catch(() => {
            /* not allowed yet: another go at the next click or key (see hook) */
          });
      } else if (!d.el.paused) d.el.pause();
    }
  }
}
