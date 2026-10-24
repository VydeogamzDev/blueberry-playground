import type { Test, TestCtx } from './types';
import type { UI } from '../../ui/UI';
import type { Entity } from '../../world/Entity';
import { builtinMap } from '../../world/Maps';
import { GRAVITY, PX, WORLD } from '../../engine/constants';
import { getItem } from '../../catalog/items';
import { saveToString, loadFromString } from '../../world/SaveLoad';
import type { Human } from '../../entities/Human';

export default function tests({ game, controls, kit, human, arm }: TestCtx): Test[] {
  /** Runs `fn` with time stopped, starting it again afterwards. */
  const paused = (fn: () => string | true): string | true => {
    if (!game.paused) controls.togglePause();
    try {
      return fn();
    } finally {
      if (game.paused) controls.togglePause();
    }
  };
  /** Drags a part by `dx`, `dy` in ten moves, drawing a frame after each (as a player's drag would). */
  const drag = (p: { x: number; y: number }, dx: number, dy: number) => {
    const x0 = p.x;
    const y0 = p.y;
    kit.down(x0, y0);
    for (let i = 1; i <= 10; i++) {
      kit.move(x0 + (dx * i) / 10, y0 + (dy * i) / 10);
      game.renderFrame(1 / 60, 1);
    }
    kit.up(x0 + dx, y0 + dy);
    game.renderFrame(1 / 60, 1);
  };

  const ui = () => controls.ui as unknown as UI;
  /** Clicks the pause menu's entry so named. */
  const pauseItem = (label: string) => {
    const b = [...document.querySelectorAll<HTMLButtonElement>('.pause-panel .panel-btn')].find((e) => e.textContent === label);
    if (!b) throw new Error(`no ${label} in the pause menu`);
    b.click();
  };
  // (by the start of its title: Controls' is “Controls and key bindings”)
  const shown = (title: string) => [...document.querySelectorAll('.overlay:not(.hidden) .panel-title')].some((e) => e.textContent?.startsWith(title));

  return [
    // (moved while time is stopped, a thing wasn't where Rapier's scene queries thought until the next step)
    ['extra: paused: a thing dragged while time is stopped can be grabbed again where it now is, not where it was', () => {
      kit.reset();
      const crate = kit.spawn('crate', 0, 0.45);
      kit.advance(1);
      const p = crate.parts[0];
      return paused(() => {
        drag(p, 3, 1);
        if (Math.abs(p.x - 3) > 0.2) return `dragged 3 m right, it is at x ${p.x.toFixed(2)}`;
        if (game.pick(p.x, p.y)?.entity !== crate) return 'a click where it now is finds nothing';
        if (game.pick(0, 0.45)) return `a click where it was still finds ${game.pick(0, 0.45)!.entity.def.id}`;
        kit.down(p.x, p.y);
        const grabbed = controls.grab;
        kit.up(p.x, p.y);
        if (!grabbed) return 'pressing on it where it now is grabs nothing';
        drag(p, -1, 0);
        if (Math.abs(p.x - 2) > 0.2) return `dragged back 1 m, it is at x ${p.x.toFixed(2)}`;
        return true;
      });
    }],
    ['extra: paused: a box drawn while time is stopped selects things where they now are', () => {
      kit.reset();
      const crate = kit.spawn('crate', 0, 0.45);
      const human = kit.spawn('human', -3, 1);
      kit.advance(1);
      return paused(() => {
        drag(crate.parts[0], 4, 0);
        const old = game.entitiesInRect(-0.6, 0, 0.6, 1);
        if (old.includes(crate)) return 'a box round where the crate was still has it';
        const now = game.entitiesInRect(3.4, 0, 4.6, 1);
        if (!now.includes(crate)) return 'a box round where it now is misses it';
        if (!game.entitiesInRect(-3.6, 0, -2.4, 2).includes(human)) return 'a box round the person (never moved) misses them';
        return true;
      });
    }],
    ['extra: paused: Controls or Settings opened from the pause menu keep time stopped until they close', () => {
      kit.reset();
      try {
        ui().togglePauseMenu();
        if (!game.paused) return 'the pause menu did not stop time';
        for (const label of ['Settings', 'Controls']) {
          pauseItem(label);
          if (!shown(label)) return `${label} did not open`;
          if (!game.paused) return `opening ${label} from the pause menu let time run`;
          kit.press('Escape');
          if (shown(label)) return `Esc left ${label} open`;
          if (game.paused) return `closing ${label} left time stopped`;
          ui().togglePauseMenu();
        }
        ui().togglePauseMenu();
        if (game.paused) return 'closing the pause menu left time stopped';
        // stopped before the menu, it stays stopped
        controls.togglePause();
        ui().togglePauseMenu();
        pauseItem('Settings');
        kit.press('Escape');
        if (!game.paused) return 'time stopped before the menu ran again once Settings (opened from it) closed';
        return true;
      } finally {
        ui().closeOverlays();
        if (game.paused) controls.togglePause();
      }
    }],
    ['extra: fixes: F works what is under the cursor, even with someone else selected; on one of the selection, all of it', () => {
      kit.reset();
      const a = kit.spawn('grenade', -2, 0.2);
      kit.spawn('grenade', 0, 0.2);
      const c = kit.spawn('grenade', 2, 0.2);
      kit.advance(0.3);
      const armed = (e: Entity) => (e as unknown as { armed?: boolean; fuse?: number }).armed ?? false;
      controls.selection = new Set([a]);
      kit.move(c.parts[0].x, c.parts[0].y);
      game.renderFrame(1 / 60, 1);
      kit.press('KeyF');
      const [fa, fc] = [armed(a), armed(c)];
      if (fa || !fc) return `F pointing at a grenade with another selected: the selected one ${fa ? 'armed' : 'not armed'}, the one pointed at ${fc ? 'armed' : 'not armed'}`;
      kit.reset();
      const d = kit.spawn('grenade', -2, 0.2);
      const e = kit.spawn('grenade', 0, 0.2);
      kit.advance(0.3);
      controls.selection = new Set([d, e]);
      kit.move(e.parts[0].x, e.parts[0].y);
      game.renderFrame(1 / 60, 1);
      kit.press('KeyF');
      if (!armed(d) || !armed(e)) return `F on one of two selected grenades armed ${[d, e].filter(armed).length} of 2`;
      kit.reset();
      return true;
    }],
    ['extra: paused: the Edit gun… panel closes when its gun is undone away (its sliders would edit a gun no longer there)', () => {
      kit.reset();
      const g = kit.spawn('pistol', 0, 1.5);
      g.setFrozen(true);
      kit.advance(0.05);
      try {
        kit.down(g.parts[0].x, g.parts[0].y, 2);
        kit.up(g.parts[0].x, g.parts[0].y, 2);
        const item = [...document.querySelectorAll<HTMLElement>('.ctx-item')].find((d) => d.textContent?.startsWith('Edit gun'));
        if (!item) return 'no Edit gun… in the pistol’s context menu';
        item.dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true }));
        const box = document.querySelector<HTMLInputElement>('.edit-panel .edit-row[data-key="damage"] .edit-num');
        if (!box) return 'no damage box in the Edit gun… panel';
        box.value = '50';
        box.dispatchEvent(new Event('change'));
        controls.undo();
        game.renderFrame(1 / 60, 1);
        if (!g.destroyed) return 'undo kept the same pistol (the test assumes the scene is put back as a copy)';
        if (document.querySelector('.edit-panel')) return 'the panel stayed open, editing the pistol undo took away';
        return true;
      } finally {
        controls.ui.closeContextMenu();
        controls.ui.closeOverlays();
      }
    }],
    ['extra: paused: pasted into a hill, things come out on top of it rather than inside the ground', () => {
      kit.reset();
      game.setMap(builtinMap('hills')!);
      const top = (x: number) => game.env.groundAt(x, WORLD.ceiling);
      let x = NaN;
      for (let at = WORLD.left + 4; at < WORLD.right - 4 && Number.isNaN(x); at += 0.5) if (top(at) > 2) x = at;
      if (Number.isNaN(x)) return 'found no hill 2 m high';
      const crate = kit.spawn('crate', 0, top(0) + 0.5);
      kit.advance(0.2);
      controls.copy([crate]);
      kit.move(x, top(x) - 1.2);
      kit.advance(0.02);
      controls.paste();
      const pasted = game.entities.find((e) => e.def.id === 'crate' && e !== crate);
      if (!pasted) return 'nothing pasted';
      const p = pasted.parts[0];
      if (p.y < top(p.x)) return `pasted with its middle ${(top(p.x) - p.y).toFixed(2)} m inside the hill`;
      kit.advance(1);
      if (p.y < top(p.x) - 0.05) return `it sank ${(top(p.x) - p.y).toFixed(2)} m into the hill`;
      return true;
    }],
    ['extra: fixes: someone fighting with an RPG backs off from a foe 3 m away before firing, clear of the blast', () => {
      kit.reset();
      const a = human(-1.5);
      const b = human(1.5, { flip: true });
      kit.advance(1);
      if (!arm(a, 'rpg')) return 'could not hand them the RPG';
      kit.advance(0.5);
      const ex = game.explosions;
      const explode = ex.explode;
      const blasts: { at: number; from: number; r: number }[] = [];
      ex.explode = (x, y, o) => {
        const t = a.limbs.get('upperTorso')!.part;
        blasts.push({ at: x, from: Math.hypot(t.x - x, t.y - y), r: o?.radius ?? 0 });
        return explode.call(ex, x, y, o);
      };
      try {
        a.fight(b, false);
        for (let i = 0; i < 120 && !blasts.length; i++) kit.advance(0.1);
        if (!blasts.length) return 'in 12 s they never fired';
        // (backing off and facing the foe again, they turned round twice: holding on to it)
        if (a.heldItems()[0]?.def.id !== 'rpg') return 'turning round they let go of the RPG';
        const [first] = blasts;
        if (first.from < first.r) return `they fired with the blast ${first.from.toFixed(2)} m from them (it reaches ${first.r.toFixed(1)} m)`;
        if (!a.alive) return 'they killed themselves';
        return true;
      } finally {
        // (the class's own again: a copy left on the instance looks like someone's hook)
        delete (ex as { explode?: unknown }).explode;
      }
    }],
    ['extra: fixes: Use on someone holding a bat or a sword swings it at whoever is in front of them', () => {
      for (const id of ['bat', 'sword']) {
        kit.reset();
        const h = human(-0.4);
        kit.advance(1);
        const w = arm(h, id);
        if (w?.def.id !== id) return `could not hand them the ${id}`;
        const v = human(h.limbs.get('upperTorso')!.part.x + 0.95, { flip: true });
        kit.advance(1);
        // (a swing is thrown standing: knocked over taking the weapon, they get back up first)
        for (let i = 0; i < 12 && h.state !== 'stand'; i++) kit.advance(0.25);
        if (h.state !== 'stand') return `holding the ${id}, they never got back on their feet (${h.status()})`;
        const hp = () => v.parts.reduce((s, p) => s + (p.destroyed ? 0 : p.hp), 0);
        const hp0 = hp();
        let lo = Infinity;
        let hi = -Infinity;
        h.activate();
        for (let i = 0; i < 50; i++) {
          game.advance(1 / 60);
          const a = w.main.body.rotation();
          lo = Math.min(lo, a);
          hi = Math.max(hi, a);
        }
        if (hi - lo < 0.3) return `Use on someone holding the ${id}: it moved only ${(hi - lo).toFixed(2)} rad`;
        if (hp() > hp0 - 5) return `the ${id} swung, but the person in front lost only ${(hp0 - hp()).toFixed(0)} hp`;
        if (h.heldItems()[0] !== w) return `swinging it they let go of the ${id}`;
      }
      return true;
    }],
    ['extra: fixes: dragging one of a selection with time running drags all of it (a frozen one too), each keeping its place', () => {
      kit.reset();
      const a = kit.spawn('crate', -2, 0.45);
      const b = kit.spawn('crate', 0, 0.45);
      const c = kit.spawn('barrel', 2, 0.6);
      const h = human(4);
      kit.advance(0.8);
      c.setFrozen(true);
      controls.selection = new Set([a, b, c, h]);
      const at = (e: Entity) => ({ x: e.parts[0].x, y: e.parts[0].y });
      const start = [a, b, c, h].map((e) => {
        const t = h.limbs.get('midTorso')!.part;
        return e === h ? { x: t.x, y: t.y } : at(e);
      });
      const p = a.parts[0];
      kit.drag(p.x, p.y, p.x - 3, p.y + 2, 0.8, 0.6, false);
      const now = [a, b, c, h].map((e) => {
        const t = h.limbs.get('midTorso')!.part;
        return e === h ? { x: t.x, y: t.y } : at(e);
      });
      kit.up(p.x, p.y);
      const names = ['the grabbed crate', 'the other crate', 'the frozen barrel', 'the person'];
      for (let i = 0; i < 4; i++) {
        const dx = now[i].x - start[i].x;
        const dy = now[i].y - start[i].y;
        if (Math.abs(dx + 3) > 0.5 || Math.abs(dy - 2) > 0.6) return `${names[i]} moved (${dx.toFixed(2)}, ${dy.toFixed(2)}), not (-3, 2) with the cursor`;
      }
      if (!c.frozen) return 'the frozen barrel was unfrozen by the drag';
      controls.clearSelection();
      return true;
    }],
    ['extra: fixes: a gun throws out a spent case that bounces, then lies still on the floor', () => {
      kit.reset();
      const gun = kit.spawn('pistol', 0, 1.5);
      kit.advance(0.2);
      gun.setFrozen(true);
      const c = game.casings as unknown as { count: number; x: Float32Array; y: Float32Array; vx: Float32Array; vy: Float32Array; still: Uint8Array };
      const before = c.count;
      gun.activate();
      if (c.count !== before + 1) return `firing threw ${c.count - before} cases`;
      const i = c.count - 1;
      let top = c.y[i];
      for (let k = 0; k < 180; k++) {
        kit.advance(1 / 60);
        top = Math.max(top, c.y[i]);
      }
      if (top < 1.5) return `the case never flew up out of the port (highest ${top.toFixed(2)} m)`;
      if (!c.still[i] || c.y[i] > 0.1 || c.y[i] < 0) return `3 s on the case is at ${c.y[i].toFixed(3)} m, ${c.still[i] ? 'still' : `moving at ${Math.hypot(c.vx[i], c.vy[i]).toFixed(2)} m/s`}`;
      return true;
    }],
    ['extra: fixes: an RPG reloads with the next warhead sliding into the muzzle to its sound; Edit gun… takes a 5 s reload', () => {
      kit.reset();
      const g = kit.spawn('rpg', WORLD.right - 20, 0.3) as Entity & { loaded: boolean; fire(): void; main: { art: { filled(x: number, y: number): boolean } }; editor(): { fields: { key?: string; get(): number; set(v: number): void }[] } };
      kit.advance(0.5);
      // the warhead's columns showing out of the muzzle
      const shows = () => {
        let n = 0;
        for (let x = 32; x < 39; x++) if ([1, 2, 3, 4, 5, 6, 7].some((y) => g.main.art.filled(x, y))) n++;
        return n;
      };
      const full = shows();
      if (full < 5) return `the loaded launcher shows only ${full} columns of warhead`;
      const heard: string[] = [];
      const play = game.sound.play;
      game.sound.play = function (this: typeof game.sound, key: string, ...rest: unknown[]) {
        heard.push(key);
        return (play as (...a: unknown[]) => unknown).call(this, key, ...rest);
      } as typeof play;
      const seen = new Set<number>();
      try {
        g.fire();
        if (shows() !== 0) return 'the warhead still shows after firing';
        for (let t = 0; t < 3 && !g.loaded; t += 1 / 60) {
          kit.advance(1 / 60);
          seen.add(shows());
        }
      } finally {
        game.sound.play = play;
      }
      if (!g.loaded) return 'not reloaded 3 s after firing';
      if (shows() !== full) return `reloaded, ${shows()} of ${full} warhead columns show`;
      const between = [...seen].filter((n) => n > 0 && n < full).length;
      if (between < 3) return `the warhead popped in rather than sliding (in-between steps seen: ${between})`;
      if (heard.filter((k) => k === 'gun/rpg_reload').length !== 1) return `the reload sound played ${heard.filter((k) => k === 'gun/rpg_reload').length} times`;
      const f = g.editor().fields.find((x) => x.key === 'rate');
      if (!f) return 'Edit gun… has no reload time';
      f.set(5);
      if (Math.abs(f.get() - 5) > 1e-6) return `a 5 s reload time reads back as ${f.get().toFixed(2)} s`;
      return true;
    }],
    ['extra: fixes: Settings’ graphics presets set resolution, lights, effects, cases, iterations and steps; changing one shows Custom', () => {
      const btn = (id: string) => document.querySelector<HTMLButtonElement>(`.set-preset[data-preset="${id}"]`);
      if (!btn('potato') || !btn('max')) return 'no preset buttons in Settings';
      const r = game.renderer;
      const iters = () => game.physics.world.integrationParameters.numSolverIterations;
      try {
        btn('potato')!.click();
        if (r.maxLights !== 0 || game.particles.detail !== 0.25 || game.casings.cap !== 20 || iters() !== 4 || !game.longSteps) {
          return `Potato: lights ${r.maxLights}, effects ${game.particles.detail}, cases ${game.casings.cap}, iterations ${iters()}, long steps ${game.longSteps}`;
        }
        const res = r.dpr;
        btn('max')!.click();
        if (!(r.dpr > res) || (r.maxLights as number) !== 16 || (game.casings.cap as number) !== 400 || iters() !== 12 || game.longSteps) {
          return `Max: resolution ${r.dpr} (Potato's ${res}), lights ${r.maxLights}, cases ${game.casings.cap}, iterations ${iters()}, long steps ${game.longSteps}`;
        }
        const custom = document.querySelector<HTMLElement>('.set-custom')!;
        if (!custom.hidden) return 'Max shows as Custom';
        const lights = document.querySelector<HTMLSelectElement>('select.set-lights')!;
        lights.value = '4';
        lights.dispatchEvent(new Event('change'));
        if ((r.maxLights as number) !== 4) return 'the Lights setting did not take effect';
        if (custom.hidden || document.querySelector('.set-preset.on')) return 'a changed setting does not show as Custom';
        if (!(localStorage.getItem('blueberry-graphics') ?? '').includes('"lights":4')) return 'the settings were not kept';
        return true;
      } finally {
        btn('high')?.click();
      }
    }],
    ['extra: fixes: the frame rate cap holds the frames to it, and Unlimited goes past the screen’s refresh', async () => {
      kit.reset();
      const sel = document.querySelector<HTMLSelectElement>('select.set-fps');
      if (!sel) return 'no frame rate cap in Settings';
      const was = sel.value;
      const pick = (v: string) => {
        sel.value = v;
        sel.dispatchEvent(new Event('change'));
      };
      /** The frames a second over `ms` of real time. */
      const rate = async (ms: number) => {
        let n = 0;
        const count = () => n++;
        game.frameHandlers.push(count);
        await new Promise((res) => setTimeout(res, ms));
        game.frameHandlers = game.frameHandlers.filter((h) => h !== count);
        return (n * 1000) / ms;
      };
      return kit.live(async () => {
        try {
          pick('display');
          await rate(300);
          const screen = await rate(1500);
          pick('30');
          if (game.fpsCap !== 30) return `the 30 cap set the game's to ${game.fpsCap}`;
          await rate(300);
          const thirty = await rate(1500);
          if (thirty > 34 || thirty < 22) return `capped at 30: ${thirty.toFixed(1)} frames a second (the screen's: ${screen.toFixed(1)})`;
          pick('unlimited');
          await rate(300);
          const free = await rate(1500);
          if (!(free > screen * 1.15)) return `Unlimited: ${free.toFixed(1)} frames a second, the screen's ${screen.toFixed(1)} (measured refresh ${game.displayHz.toFixed(1)} Hz)`;
          return true;
        } finally {
          pick(was);
        }
      });
    }],
    ['extra: fixes: Settings’ gravity: things fall slower on the Moon, float with none, and people still stand on the Moon', () => {
      kit.reset();
      const sel = document.querySelector<HTMLSelectElement>('select.set-gravity');
      if (!sel) return 'no gravity setting in Settings';
      const pick = (v: string) => {
        sel.value = v;
        sel.dispatchEvent(new Event('change'));
      };
      /** Seconds a crate takes to fall 2 m onto the floor. */
      const fall = () => {
        const c = kit.spawn('crate', 0, 2.5);
        const y0 = c.parts[0].y;
        for (let t = 0; t < 4; t += 1 / 120) {
          kit.advance(1 / 120);
          if (c.parts[0].y < y0 - 2) {
            game.remove(c);
            return t;
          }
        }
        game.remove(c);
        return Infinity;
      };
      try {
        const earth = fall();
        pick('-1.62');
        if (Math.abs(game.gravity + 1.62) > 1e-6) return `Moon set gravity to ${game.gravity}`;
        const moon = fall();
        const want = Math.sqrt((2 * 2) / 1.62);
        if (Math.abs(moon - want) > want * 0.15) return `2 m on the Moon took ${moon.toFixed(2)} s, not about ${want.toFixed(2)} (on Earth ${earth.toFixed(2)})`;
        const h = human(3);
        kit.advance(4);
        const head = h.limbs.get('head')!.part;
        if (!h.alive || head.y < 1.3) return `on the Moon, a person's head is at ${head.y.toFixed(2)} m after 4 s`;
        pick('0');
        const c = kit.spawn('crate', -3, 3);
        kit.advance(0.2);
        const y = c.parts[0].y;
        kit.advance(1);
        if (Math.abs(c.parts[0].y - y) > 0.02) return `with no gravity a crate moved ${(c.parts[0].y - y).toFixed(3)} m in a second`;
        return true;
      } finally {
        pick(String(GRAVITY));
      }
    }],
    ['extra: fixes: one flask of water poured over a person on fire puts almost all of them out, and they don’t flare up again', () => {
      kit.reset();
      const h = human(0);
      kit.advance(1);
      for (const p of h.parts) game.fire.ignite(p, 1);
      kit.advance(1.5);
      const burning = () => h.parts.filter((p) => !p.destroyed && p.burning > 0.02).length;
      const f = kit.spawn('flask-water', 0, 3) as Entity & { corked: boolean };
      // (over the middle of them: they thrash about, and can roll out from under it)
      const mid = h.limbs.get('lowerTorso')!.part;
      const c = f.center();
      f.translate(mid.x - c.x, mid.y + 1.2 - c.y);
      f.rotateAbout(mid.x, mid.y + 1.2, Math.PI - f.parts[0].a);
      f.setVelocity(0, 0);
      f.setFrozen(true);
      if (f.corked) f.activate();
      const trace: number[] = [];
      for (let i = 0; i < 12; i++) {
        kit.advance(1);
        trace.push(burning());
      }
      if (trace.slice(8).some((n) => n > 2)) return `parts still burning, a second at a time: ${trace.join(' ')}`;
      return true;
    }],
    ['extra: fixes: things settled asleep where a connection holds them wake when it is loosened or cut (a hinge’s limit off, a rope cut)', () => {
      kit.reset();
      const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
      // a plank hinged at one end, resting against its limit; a crate hanging on a rope
      const plank = kit.spawn('plank', -3, 3);
      plank.setFrozen(true);
      kit.advance(0.1);
      const p = plank.parts[0];
      const end = p.localToWorld((-p.w * PX) / 2, 0);
      const hinge = game.connections.create('hinge', p, end, null, end)!;
      game.connections.setLimit(hinge, Math.PI / 6);
      plank.setFrozen(false);
      const crate = kit.spawn('crate', 3, 2.5);
      const c = crate.parts[0];
      const rope = game.connections.create('rope', c, { x: c.x, y: c.y + 0.3 }, null, { x: c.x, y: c.y + 1 })!;
      // long enough to settle and be put to sleep
      kit.advance(6);
      const slept = `plank ${p.body.isSleeping() ? 'asleep' : 'awake'}, crate ${c.body.isSleeping() ? 'asleep' : 'awake'}`;
      const a0 = p.a;
      const y0 = c.y;
      game.connections.setLimit(hinge, null);
      game.connections.remove(rope);
      kit.advance(1);
      if (Math.abs(wrap(p.a - a0)) < 0.5) return `the limit taken off, the plank turned only ${((Math.abs(wrap(p.a - a0)) * 180) / Math.PI).toFixed(0)} degrees (${slept} before)`;
      if (c.y > y0 - 0.5) return `the rope cut, the crate fell only ${(y0 - c.y).toFixed(2)} m (${slept} before)`;
      return true;
    }],
    ['extra: fixes: a first aid kit isn’t used up on an android (there’s nothing a bandage can mend on one)', () => {
      kit.reset();
      const a = kit.spawn('android', 0, 0.4, { angle: Math.PI / 2 }) as Entity & { limbs: Map<string, { part: { x: number; y: number; hp: number; maxHp: number } }> };
      kit.advance(1);
      const arm = a.limbs.get('upperArmF')!.part;
      arm.hp = arm.maxHp * 0.5;
      const k = kit.spawn('first-aid-kit', arm.x, arm.y) as Entity & { uses: number; activate(): void };
      kit.advance(0.05);
      const before = k.uses;
      k.activate();
      kit.advance(0.5);
      if (k.uses !== before) return `used ${before - k.uses} times on an android`;
      return true;
    }],
    ['extra: people: dropped from 5 m, people crumple on landing rather than being thrown back up metres', () => {
      kit.reset();
      // (four at once, a little apart and at slightly different heights: it's chaotic)
      const hs = [-30, -15, 0, 15].map((x, i) => kit.spawn('human', x + i * 0.07, 4.9 + i * 0.05) as Human);
      const low = (h: Human) => Math.min(...h.parts.filter((p) => !p.destroyed).map((p) => p.y));
      const landed = hs.map(() => -1);
      const after = hs.map(() => 0);
      for (let k = 0; k < 300; k++) {
        kit.advance(1 / 60);
        hs.forEach((h, i) => {
          const y = low(h);
          if (landed[i] < 0 && y < 0.25) landed[i] = k;
          else if (landed[i] >= 0 && k > landed[i] + 6) after[i] = Math.max(after[i], y);
        });
      }
      const worst = Math.max(...after);
      if (landed.some((k) => k < 0)) return 'someone never reached the floor';
      if (worst > 1) return `after landing someone went back up ${worst.toFixed(2)} m (all: ${after.map((v) => v.toFixed(2)).join(', ')})`;
      return true;
    }],
    ['extra: people: frozen as they spring up for a jump and unfrozen, people aren’t launched into the air', () => {
      kit.reset();
      const hs = [-20, -8, 4, 16].map((x) => human(x));
      kit.advance(2);
      const low = (h: Human) => Math.min(...h.parts.filter((p) => !p.destroyed).map((p) => p.y));
      hs.forEach((h) => h.jump());
      // frozen at 0.2 to 0.3 s into the jump (the crouch is 0.22 s), for 0.8 s
      const top = hs.map(() => 0);
      for (let k = 0; k < 150; k++) {
        hs.forEach((h, i) => {
          const at = 12 + i * 2;
          if (k === at) h.setFrozen(true);
          if (k === at + 48) h.setFrozen(false);
        });
        kit.advance(1 / 60);
        hs.forEach((h, i) => {
          if (!h.parts[0].frozen) top[i] = Math.max(top[i], low(h));
        });
      }
      const worst = Math.max(...top);
      if (worst > 0.9) return `unfrozen, someone's feet went ${worst.toFixed(2)} m up (all: ${top.map((v) => v.toFixed(2)).join(', ')})`;
      return true;
    }],
    ['extra: people: saved and loaded, the dead stay dead as long (no defibrillating a long-dead body), and wounds, pain and shock come back', () => {
      kit.reset();
      const d = human(-3);
      const w = human(3);
      kit.advance(1);
      d.die();
      (d as unknown as { deathT: number }).deathT = 70;
      const arm = w.limbs.get('upperArmF')!;
      (w as unknown as { addWound(l: unknown, x: number, y: number, ox: number, oy: number, rate: number, hole: boolean): void }).addWound(arm, arm.part.x, arm.part.y, 0, 1, 0.6, false);
      const pain = 0.7;
      (w as unknown as { pain: number }).pain = pain;
      const n = arm.wounds.length;
      if (!n) return 'could not wound an arm';
      loadFromString(game, saveToString(game));
      const people = game.entities.filter((e): e is Human => e.def.id === 'human');
      const dead = people.find((h) => !h.alive);
      const hurt = people.find((h) => h.alive);
      if (!dead || !hurt) return 'the two people did not come back from the save';
      if (dead.restart()) return 'a body dead 70 s was defibrillated back after a load';
      const back = hurt.limbs.get('upperArmF')!.wounds;
      if (back.length !== n) return `the arm had ${n} wounds, ${back.length} after loading`;
      if (Math.abs(back[0].rate - arm.wounds[0].rate) > 1e-6) return 'a wound came back bleeding at another rate';
      if ((hurt as unknown as { pain: number }).pain < pain - 0.05) return `pain ${pain} came back as ${(hurt as unknown as { pain: number }).pain.toFixed(2)}`;
      return true;
    }],
    ['extra: people: drugs do nothing to a corpse, a defibrillator revive clears the poison, Healing wakes the sedated, and a headless body can’t be revived', () => {
      kit.reset();
      const a = human(-4);
      const b = human(0);
      const c = human(4);
      kit.advance(1);
      a.inject('poison', 1);
      a.die();
      a.inject('poison', 1);
      a.inject('knockout', 1);
      if (!a.restart()) return 'a body just dead was not defibrillated back';
      if (a.drugs.poison > 0 || a.drugs.knockout > 0) return `revived with poison ${a.drugs.poison.toFixed(0)} s and knockout ${a.drugs.knockout.toFixed(0)} s still in them`;
      b.inject('knockout', 1);
      kit.advance(2);
      if (b.consciousness > 0.2) return 'the knockout did not put them out';
      b.inject('healing', 1);
      kit.advance(3);
      if (b.consciousness < 0.5) return `a full Healing dose left the sedated at consciousness ${b.consciousness.toFixed(2)}`;
      c.sever(c.limbs.get('head')! as Parameters<typeof c.sever>[0], 'cut');
      kit.advance(0.5);
      if (c.alive) return 'decapitated, still alive';
      c.heal();
      if (c.alive) return 'Revive brought back a body without its head';
      c.inject('life', 0.4);
      kit.advance(20);
      c.inject('life', 0.2);
      if (c.alive) return 'Life brought back a headless body';
      return true;
    }],
    ['extra: fixes: the interface’s pixel fonts are bundled and load', () => {
      const fams = new Set([...document.fonts].map((f) => f.family.replace(/["']/g, '')));
      if (!fams.has('DotGothic16') || !fams.has('Tiny5')) return `fonts known to the page: ${[...fams].join(', ') || 'none'}`;
      if (!getComputedStyle(document.body).fontFamily.includes('DotGothic16')) return `the page's font is ${getComputedStyle(document.body).fontFamily}`;
      return true;
    }],
    ['extra: fixes: under an open panel keys do nothing to the sandbox (Delete, E, Space), and Esc closes it', () => {
      kit.reset();
      const c = kit.spawn('crate', 0, 0.5);
      kit.advance(0.3);
      controls.selection.add(c);
      const u = ui();
      const was = game.paused;
      u.togglePauseMenu();
      try {
        if (!u.isPanelOpen()) return 'the pause menu did not open';
        kit.press(controls.bindings.keys('delete')[0]);
        if (c.destroyed) return 'Delete removed the selected crate under the pause menu';
        const n = game.entities.length;
        controls.arm(getItem('crate')!);
        kit.move(2, 1);
        kit.press(controls.bindings.keys('spawnRight')[0]);
        if (game.entities.length !== n) return 'E spawned a crate under the pause menu';
        const p = game.paused;
        kit.press('Space');
        if (game.paused !== p) return 'Space toggled time under the pause menu';
        kit.press('Escape');
        if (u.isPanelOpen()) return 'Esc did not close the pause menu';
        if (game.paused !== was) return 'closing the pause menu left time stopped';
        return true;
      } finally {
        controls.arm(null);
        controls.clearSelection();
        u.closeOverlays();
        if (game.paused !== was) controls.togglePause();
      }
    }],
    ['extra: fixes: Esc closes a dialog even with the focus off its box, without opening the pause menu', () => {
      kit.reset();
      const c = kit.spawn('crate', 0, 0.5);
      kit.advance(0.2);
      const u = ui();
      const was = game.paused;
      u.saveContraption([c]);
      if (!document.querySelector('.dialog-panel')) return 'Save as contraption opened no dialog';
      (document.activeElement as HTMLElement | null)?.blur();
      kit.press('Escape');
      const open = !!document.querySelector('.dialog-panel');
      const panel = u.isPanelOpen();
      u.closeOverlays();
      if (game.paused !== was) controls.togglePause();
      if (open) return 'Esc left the dialog open';
      if (panel) return 'Esc opened a panel (the pause menu) instead';
      return true;
    }],
    ['extra: fixes: the toybox search finds things by the shelf names shown (Firearms), word by word', () => {
      const box = document.querySelector<HTMLInputElement>('.catalog input.search') ?? document.querySelector<HTMLInputElement>('input.search');
      if (!box) return 'no toybox search box';
      const find = (q: string) => {
        box.value = q;
        box.dispatchEvent(new Event('input'));
        return [...document.querySelectorAll('.items .item')].map((x) => x.textContent ?? '');
      };
      try {
        const guns = find('firearms');
        if (!guns.some((t) => /pistol/i.test(t))) return `“firearms” found ${guns.length} things, no pistol`;
        const two = find('firearms pistol');
        if (!two.length || two.length >= guns.length) return `“firearms pistol” found ${two.length} of the ${guns.length} firearms`;
        return true;
      } finally {
        find('');
      }
    }],
    ['extra: fixes: a crate frozen while dragged with time running goes on following the cursor', () => {
      kit.reset();
      const c = kit.spawn('crate', 0, 0.5);
      kit.advance(0.5);
      const p = c.parts[0];
      const x0 = p.x;
      const y0 = p.y;
      kit.down(x0, y0);
      for (let i = 1; i <= 15; i++) {
        kit.move(x0 + i * 0.1, y0 + i * 0.05);
        game.advance(1 / 60);
      }
      kit.press(controls.bindings.keys('freeze')[0]);
      if (!p.frozen) {
        kit.up(x0 + 1.5, y0 + 0.75);
        return 'the freeze key did not freeze the crate held';
      }
      for (let i = 16; i <= 30; i++) {
        kit.move(x0 + i * 0.1, y0 + i * 0.05);
        game.advance(1 / 60);
      }
      const off = Math.hypot(p.x - (x0 + 3), p.y - (y0 + 1.5));
      kit.up(x0 + 3, y0 + 1.5);
      game.advance(0.1);
      c.setFrozen(false);
      if (off > 0.4) return `frozen mid-drag, the crate stayed ${off.toFixed(2)} m from the cursor`;
      return true;
    }],
    ['extra: fixes: removing a crate while its size handle is held lets go of it, and the game carries on', () => {
      kit.reset();
      const e = kit.spawn('crate', 0, 1.2);
      controls.selection.clear();
      controls.selection.add(e);
      controls.refreshOutlines();
      const h = controls.resizeHandles().find((q) => q.hx === 1 && q.hy === 1);
      if (!h) return 'the crate shows no size handles';
      const w = game.renderer.screenToWorld(h.x, h.y);
      kit.down(w.x, w.y, 0);
      kit.move(w.x + 0.3, w.y + 0.3);
      game.advance(0.05);
      kit.press('Delete');
      if (!e.destroyed) return 'Delete left the crate';
      game.advance(0.1);
      kit.up(w.x + 0.3, w.y + 0.3, 0);
      game.advance(0.1);
      if (controls.resizeHandles().length) return 'size handles still show for the removed crate';
      return true;
    }],
    ['extra: fixes: dragging a severed head about leaves the body where it lies', () => {
      kit.reset();
      const h = human(0);
      kit.advance(1);
      const head = h.limbs.get('head')!;
      h.sever(head as Parameters<typeof h.sever>[0], 'cut');
      kit.advance(2);
      const torso = h.limbs.get('midTorso')!.part;
      const t0 = { x: torso.x, y: torso.y };
      const p = head.part;
      kit.drag(p.x, p.y, p.x + 4, p.y + 2, 1, 0.5, false);
      const moved = Math.hypot(torso.x - t0.x, torso.y - t0.y);
      const carried = Math.hypot(p.x - (t0.x + 4), p.y - 2);
      kit.up(p.x, p.y);
      if (moved > 0.3) return `the body moved ${moved.toFixed(2)} m while its severed head was dragged 4.5 m`;
      if (Math.abs(p.x - head.part.x) > 1e-6 || carried > 3) return 'the head was not carried to the cursor';
      return true;
    }],
    ['extra: fixes: the vitals of someone new and unhurt list no injuries, after someone badly hurt was shown', () => {
      kit.reset();
      const a = human(0);
      kit.advance(1);
      kit.spawn('grenade', 0.3, 0.2).activate();
      kit.advance(4);
      const list = () => document.querySelector('.vitals-limbs')?.textContent ?? '(no list)';
      controls.selection = new Set([a]);
      kit.advance(0.5);
      if (/Every limb fine/.test(list())) return 'the grenade hurt nobody, so there is nothing to compare';
      game.remove(a);
      controls.clearSelection();
      kit.advance(0.3);
      const b = human(3);
      kit.advance(1);
      controls.selection = new Set([b]);
      kit.advance(0.5);
      controls.clearSelection();
      if (!/Every limb fine/.test(list())) return `a new, unhurt person’s vitals list: ${list().slice(0, 160)}`;
      return true;
    }],
    ['extra: fixes: Settings’ Spawning: a click on empty space spawns (original) or box-selects (Q / E, People Playground’s)', () => {
      kit.reset();
      const was = controls.placement;
      try {
        controls.arm(getItem('crate')!);
        controls.setPlacement('click');
        kit.move(1, 1.5);
        kit.advance(0.05);
        kit.down(1, 1.5);
        kit.up(1, 1.5);
        if (game.entities.length !== 1) return `click placement: a click on empty space made ${game.entities.length} objects`;
        controls.setPlacement('keys');
        kit.move(-2, 1.5);
        kit.advance(0.05);
        kit.down(-2, 1.5);
        kit.up(-2, 1.5);
        if (game.entities.length !== 1) return `Q / E placement: a click on empty space made ${game.entities.length - 1} more`;
        kit.press(controls.bindings.keys('spawnRight')[0]);
        const n = game.entities.length as number;
        if (n !== 2) return `Q / E placement: E made ${n - 1} objects`;
        return true;
      } finally {
        controls.arm(null);
        controls.setPlacement(was);
      }
    }],
    ['extra: fixes: the Controls panel gives a command a second key with its +, and both work', () => {
      kit.reset();
      const b = controls.bindings;
      const keys = b.keys('jump');
      try {
        controls.command('help');
        const row = [...document.querySelectorAll('.help-panel .bind-cell')].find((c) => c.nextElementSibling?.textContent?.startsWith('Jump'));
        const plus = [...(row?.querySelectorAll<HTMLButtonElement>('.bind-x') ?? [])].find((x) => x.textContent === '+');
        if (!plus) return 'no + beside Jump’s key';
        plus.click();
        kit.press('KeyK');
        if (b.keys('jump').join() !== [...keys, 'KeyK'].join()) return `after + and K, Jump is on ${b.keys('jump').join(', ')}`;
        const h = human(0);
        kit.advance(1);
        const y0 = h.limbs.get('head')!.part.y;
        controls.selection = new Set([h]);
        ui().closeOverlays();
        kit.press('KeyK');
        let top = y0;
        for (let i = 0; i < 30; i++) {
          kit.advance(1 / 60);
          top = Math.max(top, h.limbs.get('head')!.part.y);
        }
        if (top - y0 < 0.1) return `K (Jump’s second key) did not make them jump (head rose ${(top - y0).toFixed(2)} m)`;
        return true;
      } finally {
        b.set('jump', keys);
        ui().closeOverlays();
        controls.clearSelection();
      }
    }],
    ['extra: fixes: placing with clicks, the ghost shows at the cursor first, Q and E turn it, a click puts it there as shown, and the next is turned the same', () => {
      kit.reset();
      const was = controls.placement;
      controls.setPlacement('click');
      try {
        controls.arm(null);
        controls.arm(getItem('plank')!);
        kit.move(1, 2);
        kit.advance(0.02);
        const g = controls.placer.ghost;
        if (!g || g.def?.id !== 'plank') return `no ghost of the plank at the cursor (${g?.def?.id ?? 'none'})`;
        if (Math.abs(g.at.x - 1) > 0.05) return `the ghost is at x ${g.at.x.toFixed(2)}, not the cursor's 1`;
        if (game.entities.length) return 'something was spawned before the click';
        kit.press('KeyQ');
        kit.press('KeyQ');
        kit.press('KeyE');
        kit.advance(0.02);
        const step = controls.arrange.angleStep;
        const turned = controls.placer.ghost?.angle ?? NaN;
        if (Math.abs(turned - step) > 1e-6) return `Q, Q, E turned the ghost ${((turned * 180) / Math.PI).toFixed(1)}°, not one step (${((step * 180) / Math.PI).toFixed(1)}°)`;
        if (game.entities.length) return 'Q or E spawned something (placing with clicks, they turn the ghost)';
        kit.down(1, 2);
        kit.up(1, 2);
        kit.advance(0.03);
        const p = game.entities.find((e) => e.def.id === 'plank');
        if (!p) return 'the click placed nothing';
        const a = Math.atan2(Math.sin(p.parts[0].a), Math.cos(p.parts[0].a));
        if (Math.abs(a - step) > 0.05) return `placed at ${((a * 180) / Math.PI).toFixed(1)}°, not as the ghost showed (${((step * 180) / Math.PI).toFixed(1)}°)`;
        if (Math.abs(p.center().x - 1) > 0.1) return `placed at x ${p.center().x.toFixed(2)}, not where the ghost was (1)`;
        kit.move(3, 2);
        kit.advance(0.02);
        const next = controls.placer.ghost?.angle ?? NaN;
        if (Math.abs(next - step) > 1e-6) return `the next plank's ghost is turned ${((next * 180) / Math.PI).toFixed(1)}°: the turn wasn't kept`;
        return true;
      } finally {
        controls.setPlacement(was);
        controls.arm(null);
      }
    }],
    ['extra: fixes: placing with Shift held puts it on the grid with time running, the grid drawn round it; Shift+G steps the grid, then hides it; G alone is still slow motion', () => {
      kit.reset();
      const was = controls.placement;
      const st = controls.arrange.settings;
      const before = { grid: st.grid, hidden: st.gridHidden };
      controls.setPlacement('keys');
      try {
        st.grid = 0.25;
        st.gridHidden = false;
        controls.arm(null);
        controls.arm(getItem('crate')!);
        kit.key('ShiftLeft', true);
        kit.move(1.37, 2.12);
        kit.key('KeyE', true);
        kit.advance(0.02);
        const g = controls.placer.ghost;
        if (!g?.solid) return 'holding E showed no ghost';
        if (Math.abs(g.at.x - 1.25) > 1e-6 || Math.abs(g.at.y - 2) > 1e-6) return `with Shift held the ghost went to ${g.at.x.toFixed(3)}, ${g.at.y.toFixed(3)}, not the 0.25 m grid's 1.25, 2`;
        if (!controls.placer.gridPatch) return 'no grid drawn round what was being placed';
        kit.press('KeyG');
        if (st.grid !== 0.5) return `Shift+G while placing made the grid ${st.grid} m, not the next size (0.5 m)`;
        if (game.timeScale < 1) return 'Shift+G while placing turned on slow motion';
        kit.advance(0.02);
        kit.key('KeyE', false);
        kit.advance(0.02);
        const c = game.entities.find((e) => e.def.id === 'crate');
        if (!c) return 'letting go of E placed nothing';
        if (Math.abs(c.center().x - 1.5) > 0.02) return `placed at x ${c.center().x.toFixed(3)}, not on the 0.5 m grid (1.5)`;
        // 0.5 m, 1 m, then hidden (it still snaps); over empty space, off the crate just placed
        kit.move(-2.1, 2.3);
        kit.advance(0.02);
        kit.press('KeyG');
        kit.press('KeyG');
        if (!st.gridHidden) return `Shift+G after the biggest grid didn't hide it (grid ${st.grid} m)`;
        kit.advance(0.02);
        if (controls.placer.gridPatch) return 'the grid hidden, it was still drawn';
        const h = controls.placer.ghost;
        if (!h || Math.abs(h.at.x - -2) > 1e-6) return `hidden, the grid stopped snapping (the ghost at x ${h?.at.x.toFixed(3)}, not -2)`;
        kit.key('ShiftLeft', false);
        controls.arm(null);
        kit.advance(0.02);
        kit.press('KeyG');
        const slow = game.timeScale < 1;
        if (slow) kit.press('KeyG');
        if (!slow) return 'G with nothing being placed did not turn on slow motion';
        return true;
      } finally {
        kit.key('ShiftLeft', false);
        kit.key('KeyE', false);
        st.grid = before.grid;
        st.gridHidden = before.hidden;
        controls.arrange.saveSettings();
        controls.setPlacement(was);
        controls.arm(null);
        game.timeScale = 1;
      }
    }],
  ];
}
