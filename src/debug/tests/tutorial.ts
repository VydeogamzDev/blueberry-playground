import type { Test, TestCtx } from './types';
import type { UI } from '../../ui/UI';
import type { Firearm } from '../../entities/Firearm';
import type { Entity } from '../../world/Entity';
import type { Part } from '../../world/Part';
import type { Car } from '../../entities/Car';
import type { Tank } from '../../entities/Tank';
import type { Crossbow } from '../../entities/Crossbow';
import type { Flask } from '../../entities/Flask';
import type { Molotov } from '../../entities/Molotov';
import type { Nuke } from '../../entities/Nuke';
import type { ActionId } from '../../tools/Bindings';
import type { PowerId } from '../../tools/Controls';
import { Human } from '../../entities/Human';
import { Creature } from '../../entities/Creature';
import { Item } from '../../entities/Item';
import { TOURS, SOON, handTo, storeKey, type TourId } from '../../ui/Tutorial';
import { LOCKED_NOTE } from '../../ui/TutorialLock';
import { getItem } from '../../catalog/items';
import { ENDLESS, LAB } from '../../world/Maps';
import { NUKE_MIN_KT } from '../../systems/Explosions';
import { WORLD } from '../../engine/constants';

export default function tests({ game, controls, kit }: TestCtx): Test[] {
  const ui = () => controls.ui as unknown as UI;
  const tut = () => ui().tutorial;
  /** Runs the game for `s` seconds a frame at a time, as the real loop does (the tutorial looks every frame). */
  const live = (s: number) => {
    for (let i = 0; i < Math.round(s * 60); i++) game.advance(1 / 60);
  };
  const card = () => document.querySelector<HTMLElement>('.tut-card');
  const click = (sel: string) => {
    const b = document.querySelector<HTMLElement>(sel);
    if (!b) throw new Error(`nothing matches ${sel}`);
    b.click();
  };
  const glowing = () => document.querySelector('.tut-glow');
  /** The step on, by id (or "off"). */
  const on = () => (tut().active ? tut().step.id : 'off');
  /** Plays on for up to `s` seconds until the step moves past `id`. */
  const until = (id: string, s = 2) => {
    for (let i = 0; i < s * 60 && on() === id; i++) game.advance(1 / 60);
    return on() !== id;
  };
  /** Starts it as a player does: the main menu's Tutorials, the basics. */
  const startFromMenu = (): string | true => {
    const music = game.music as unknown as { play(mood: string): void };
    const play = music.play;
    music.play = () => {};
    try {
      ui().mainMenu.show();
      const b = document.querySelector<HTMLButtonElement>('.main-menu .mm-btn[data-tour="basics"]');
      if (!b) return 'no basics among the main menu\'s Tutorials';
      b.click();
      if (ui().mainMenu.open) return 'the basics left the main menu up';
      return true;
    } finally {
      music.play = play;
    }
  };

  // ---- for the other tours ------------------------------------------------------------

  /** A prop the tour put out under a name (it must be there). */
  const ref = <T extends Entity = Entity>(name: string): T => {
    const e = tut().ref(name);
    if (!e) throw new Error(`the tour put out no ${name} (at ${on()})`);
    return e as T;
  };
  /** What the tour has seen the player do, in a line (for what went wrong). */
  const seenNow = () =>
    Object.entries(tut().seen).map(([k, v]) => `${k} ${v instanceof Set ? [...v].join('+') || '-' : v}`).join(', ');
  /** Where the tour's props are, and what the living ones are up to, in a line (for what went wrong). */
  const whereNow = () =>
    [...tut().refs].filter(([, e]) => e && !e.destroyed).map(([k, e]) => {
      const st = e instanceof Human || e instanceof Creature ? ` ${e.state}` : '';
      return `${k} at ${e.center().x.toFixed(1)}${st}`;
    }).join(', ') + `, view at ${game.renderer.camX.toFixed(1)}`;
  /** A button of the tool bar, by its tooltip's start. */
  const tb = (title: string) => {
    const b = [...document.querySelectorAll<HTMLElement>('.toolbar .tb-btn')].find((e) => (e.dataset.tutTitle ?? e.title).startsWith(title));
    if (!b) throw new Error(`no ${title} button in the tool bar`);
    return b;
  };
  const keyOf = (id: ActionId) => controls.bindings.keys(id)[0] ?? '';
  /** A command's key held down until the step moves past `step` (up to `s` seconds), then let go. */
  const holdKey = (id: ActionId, step: string, s: number) => {
    const code = keyOf(id);
    if (!code) throw new Error(`nothing is bound to ${id}`);
    kit.key(code, true);
    until(step, s);
    kit.key(code, false);
  };
  /** A person's or an animal's middle. */
  const mid = (e: Entity): Part =>
    e instanceof Human ? e.limbs.get('upperTorso')!.part : e instanceof Creature ? e.limbs.get('chest')!.part : e.parts[0];
  /** Someone's most bleeding limb. */
  const bleedingMost = (h: Human): Part => {
    let best = h.limbs.get('midTorso')!;
    let most = -1;
    for (const l of h.limbs.values()) {
      const r = l.gone ? -1 : l.wounds.reduce((s, w) => s + w.rate, 0);
      if (r > most) {
        most = r;
        best = l;
      }
    }
    return best.part;
  };
  /**
   * A thing picked up, brought over a part and pressed down onto it by hand,
   * worked (F) as it touches, and held there up to `secs` s, worked again every
   * half second (as a player presses F again when nothing happened: a needle that
   * met a sleeve, a defibrillator charged while it slid off) until the step moves on.
   */
  const pressOn = (e: Entity, target: Part, secs: number) => {
    const step = on();
    const c = e.center();
    e.translate(target.x - c.x, target.y + 0.9 - c.y);
    e.setVelocity(0, 0);
    game.advance(1 / 60);
    const p = e.parts[0];
    kit.down(p.x, p.y);
    for (let i = 1; i <= 30; i++) {
      kit.move(target.x, target.y + 0.9 - 0.75 * (i / 30));
      game.advance(1 / 60);
    }
    e.activate();
    // (until the step's done: its tick showing)
    const going = () => on() === step && !card()?.classList.contains('cheer');
    for (let i = 1; i <= secs * 60 && going(); i++) {
      kit.move(target.x, target.y + 0.15);
      game.advance(1 / 60);
      if (i % 30 === 0 && going()) e.activate();
    }
    kit.up(target.x, target.y + 0.15);
  };
  /** A medicine (or the defibrillator) used on someone: in their own hand if they can hold it, else held against them. */
  const treat = (item: Entity, who: Entity, secs = 2, at?: Part) => {
    // (whatever they still hold, the last syringe, taken off them first: a hand free for this)
    if (who instanceof Human) for (const i of who.heldItems()) if (i !== item) who.dropItem(i);
    if (who instanceof Human && handTo(who, item)) {
      // (turned to face their way in hand, it's made again: that one)
      (game.successorOf(item) ?? item).activate();
      return;
    }
    pressOn(item, at ?? mid(who), secs);
  };
  /** A flask held upside down over a point and uncorked: it pours. */
  const pourAt = (f: Entity, x: number, y: number) => {
    const c = f.center();
    f.translate(x - c.x, y - c.y);
    f.rotateAbout(x, y, Math.PI - f.parts[0].a);
    f.setVelocity(0, 0);
    f.setFrozen(true);
    if ((f as Flask).corked) f.activate();
  };
  /** A flask smashed over a point. */
  const smashAt = (f: Flask, x: number, y: number) => {
    const c = f.center();
    f.translate(x - c.x, y - c.y);
    f.shatter();
  };
  /** A power held down at a point for a moment. */
  const usePower = (p: PowerId, x: number, y: number, s = 0.4) => {
    if (controls.tab !== 'powers') controls.toggleTab();
    controls.setPower(p);
    kit.down(x, y);
    for (let i = 0; i < s * 60; i++) {
      kit.move(x, y);
      game.advance(1 / 60);
    }
    kit.up(x, y);
  };
  /** One of a thing's menu entries taken, by its label. */
  const choose = (e: Entity, ...labels: string[]) => {
    const a = e.contextActions().find((x) => labels.includes(x.label));
    if (!a) throw new Error(`no ${labels.join(' / ')} in the ${e.def.id}'s menu (${e.contextActions().map((x) => x.label).join(', ')})`);
    a.action();
  };
  /** Someone let go of over a vehicle's seat (in they get). */
  const seat = (c: Car, h: Entity) => {
    const [sx, sy] = c.cfg.seats[0].at;
    if (!(h instanceof Human) || !c.takeIn(h, c.body.pixelToWorld(sx, sy))) throw new Error(`the ${h.def.id} would not get into the ${c.def.id}`);
  };
  /** The tour's prop of a kind nearest a point. */
  const nearest = (id: string, x: number) =>
    [...tut().props].filter((e) => !e.destroyed && e.def.id === id).sort((a, b) => Math.abs(a.center().x - x) - Math.abs(b.center().x - x))[0] ?? null;
  /** Runs `fn`, then puts back the browser's record of tours taken (a test's isn't the player's). */
  const keepingProgress = <T,>(fn: () => T): T => {
    const was = TOURS.map((t) => [storeKey(t.id), localStorage.getItem(storeKey(t.id))] as const);
    try {
      return fn();
    } finally {
      for (const [k, v] of was) {
        if (v === null) localStorage.removeItem(k);
        else localStorage.setItem(k, v);
      }
      tut().progress.reload();
    }
  };
  /** Puts back what a tour leaves on: views, time, tools, keys, panels. */
  const tidy = () => {
    tut().stop(false);
    controls.ui.closeContextMenu();
    ui().closeOverlays();
    if (controls.grab) kit.up(controls.wx, controls.wy);
    for (const id of ['driveLeft', 'driveRight', 'aimUp', 'aimDown', 'snap', 'fast'] as ActionId[]) if (keyOf(id)) kit.key(keyOf(id), false);
    controls.releaseActivation();
    controls.xray = false;
    controls.detail = false;
    controls.vitalsPinned = null;
    controls.terrain?.stop();
    controls.setTool('drag');
    if (game.paused) controls.togglePause();
    game.timeScale = 1;
  };
  type Act = () => void;
  /**
   * Plays a tour through: on each step what a player would do (by the calls
   * their clicks and keys make), then on until the step ends (within the
   * seconds given, else 3); the welcome and the end by their buttons (or `end`,
   * on the end). True, or what went wrong.
   */
  const play = (tour: TourId, acts: Record<string, Act | [Act, number]>, end?: Act): string | true => {
    if (!tut().start(tour)) return `${tour} would not start`;
    const been: string[] = [];
    for (let n = 0; n < 60 && tut().active; n++) {
      const s = tut().step;
      been.push(s.id);
      live(0.3);
      if (!tut().active || tut().step !== s) continue;
      if (s.info) {
        if (end && tut().index === tut().steps.length - 1) end();
        else click('.tut-next');
        continue;
      }
      const a = acts[s.id];
      if (!a) return `${tour}: nothing to do for "${s.title}" (${s.id})`;
      const [fn, secs] = Array.isArray(a) ? a : [a, 3];
      fn();
      if (!until(s.id, secs)) return `${tour}: did "${s.title}" (${s.id}), the step did not end in ${secs} s (seen: ${seenNow()}; ${whereNow()})`;
    }
    if (tut().active) return `${tour} never ended (at ${on()}; through ${been.join(', ')})`;
    const missed = Object.keys(acts).filter((k) => !been.includes(k));
    if (missed.length) return `${tour} never came to ${missed.join(', ')}`;
    const left = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
    if (left(controls, 'paste') || left(controls.ui, 'save') || left(controls.powers, 'step')) return `${tour} left its watchers on the game`;
    tut().progress.reload();
    if (!tut().progress.done(tour)) return `${tour} played to the end, yet not ticked as done`;
    return true;
  };
  const crates = () => game.entities.filter((e) => e.def.id === 'crate' && !e.destroyed);
  const panelOpen = (title: string) => [...document.querySelectorAll('.overlay:not(.hidden) .panel-title')].some((e) => e.textContent === title);
  /** A map picked in the open Maps panel, by its name (and the switch confirmed, if it asks). */
  const pickMap = (which: (name: string) => boolean) => {
    const c = [...document.querySelectorAll<HTMLElement>('.overlay:not(.hidden) .map-card')].find((b) => which(b.querySelector('.map-name')?.textContent ?? ''));
    if (!c) throw new Error('no such map in the Maps panel');
    c.click();
    [...document.querySelectorAll<HTMLElement>('.dialog-panel .panel-btn')].find((b) => b.textContent === 'Switch')?.click();
  };

  return [
    ['extra: tutorial: played through as a player would, from the main menu to the end', () => {
      kit.reset();
      kit.spawn('crate', 3, 0.45);
      try {
        const started = startFromMenu();
        if (started !== true) return started;
        if (!tut().active || on() !== 'hello') return `the tutorial is at ${on()}, not its welcome`;
        if (game.entities.length) return `it started on a scene of ${game.entities.length} things, not a clean one`;
        if (card()?.classList.contains('hidden')) return 'its card is hidden';
        click('.tut-next');

        // spawn: the toybox's Characters glows, then Human; E at the floor spawns one
        if (on() !== 'spawn') return `"Let’s go" went to ${on()}`;
        live(0.05);
        if (!glowing()) return 'nothing glows to show where Characters is';
        click('.cat-btn[data-cat="Characters"]');
        const tile = [...document.querySelectorAll<HTMLElement>('.item')].find((e) => e.querySelector('.item-name')?.textContent === 'Human');
        if (!tile) return 'no Human in the toybox';
        tile.click();
        if (controls.armed?.id !== 'human') return `clicking Human armed ${controls.armed?.id ?? 'nothing'}`;
        live(0.05);
        if (!document.querySelector('.tut-arrow:not(.hidden)')) return 'Human picked: no arrow to the floor';
        kit.move(game.renderer.camX, 1);
        kit.press('KeyE');
        if (!until('spawn')) return 'spawned a person: the step did not end';
        if (controls.armed) return 'the step ended with Human still armed (every key or tap would spawn another)';

        // fling them
        if (on() !== 'fling') return `after spawning came ${on()}`;
        const h = game.entities.find((e) => e.def.id === 'human') as Human;
        const torso = h.limbs.get('upperTorso')!.part;
        kit.drag(torso.x, torso.y, torso.x + 4, torso.y + 2, 0.12, 0, true);
        // (it waits for them to come down, the view going with them: the next step is about them)
        if (!until('fling', 6)) return 'flung them: the step did not end';
        const seen = game.renderer.worldToScreen(h.center().x, h.center().y);
        if (seen.x < 0 || seen.x > innerWidth || seen.y < 0 || seen.y > innerHeight) return `flung, they came down out of view (on screen at ${seen.x.toFixed(0)}, ${seen.y.toFixed(0)})`;

        // their menu
        live(1);
        kit.down(torso.x, torso.y, 2);
        kit.up(torso.x, torso.y, 2);
        if (!document.querySelector('.ctx')) return 'a right click on them opened no menu';
        controls.ui.closeContextMenu();
        if (!until('menu')) return 'opened their menu: the step did not end';

        // hand the new person the rifle (dropped onto their hand)
        if (on() !== 'arm') return `after the menu came ${on()}`;
        const gunner = [...tut().props].find((e) => e.def.id === 'human' && !e.destroyed) as Human | undefined;
        const rifle = tut().mine('rifle') as Firearm | null;
        if (!gunner || !rifle) return 'no person and rifle put out to arm';
        live(0.8);
        const hand = gunner.limbs.get('handF')!.part;
        const gp = rifle.gripWorld()!;
        kit.drag(gp.x, gp.y, hand.x, hand.y, 0.6, 0.3, true);
        if (!until('arm', 3)) return `dropped the rifle on their hand: still at ${on()} (holding ${gunner.heldItems().map((i) => i.def.id).join(', ') || 'nothing'})`;

        // open fire: selected, F held
        controls.selection = new Set<Entity>([gunner]);
        kit.key('KeyF', true);
        live(0.6);
        kit.key('KeyF', false);
        if (!until('shoot')) return `held F on the gunner: ${tut().seen.shots} shots, the step did not end`;

        // the Molotov: F lights it, flung at the pile it smashes
        if (on() !== 'molotov') return `after shooting came ${on()}`;
        const bottle = tut().mine('molotov');
        if (!bottle) return 'no Molotov put out';
        live(0.5);
        const m = bottle.parts[0];
        kit.move(m.x, m.y);
        live(0.05);
        kit.press('KeyF');
        if (!(bottle as unknown as { lit?: boolean }).lit) {
          const sc = game.renderer.worldToScreen(m.x, m.y);
          return `F on the Molotov did not light its rag (the cursor on ${controls.hover?.entity.def.id ?? 'nothing'}; the bottle at ${m.x.toFixed(2)},${m.y.toFixed(2)}, on screen at ${sc.x.toFixed(0)},${sc.y.toFixed(0)}; camera ${game.renderer.camX.toFixed(1)},${game.renderer.camY.toFixed(1)}; ${[...controls.selection].map((e) => e.def.id)} selected)`;
        }
        // lobbed at the pile 6 m off (flicked hard, it sails over it and on out of the world); landed
        // whole on something soft, it's picked up and thrown again, as a player would
        for (let go = 0; go < 3 && !bottle.destroyed; go++) {
          kit.drag(m.x, m.y, m.x + 1.2, m.y + 1, 0.18, 0, true);
          until('molotov', 2.5);
        }
        if (!until('molotov', 2)) {
          const holder = (bottle as unknown as { holder?: Entity | null }).holder;
          return `lit and threw the Molotov: the step did not end (it never smashed; ${bottle.destroyed ? 'gone' : `at ${bottle.parts[0].x.toFixed(1)},${bottle.parts[0].y.toFixed(1)}${holder ? `, held by a ${holder.def.id}` : ''}`}; people at ${game.entities.filter((e) => e.def.id === 'human').map((e) => e.center().x.toFixed(1))}; the tour's Molotovs: ${[...tut().props].filter((e) => e.def.id === 'molotov').map((e) => `#${e.id} ${e.destroyed ? 'destroyed' : 'whole'} ${game.entities.includes(e) ? 'in the scene' : 'not in the scene'}`)}; on ${on()})`;
        }

        // the RPG on the floor: F
        if (on() !== 'rpg') return `after the Molotov came ${on()}`;
        const tube = tut().mine('rpg');
        if (!tube) return 'no RPG put out';
        live(0.5);
        kit.move(tube.parts[0].x, tube.parts[0].y);
        live(0.05);
        kit.press('KeyF');
        if (!until('rpg', 4)) return `F on the RPG: ${tut().seen.blasts} blasts, the step did not end`;

        // the healing syringe: held against the patient, F
        if (on() !== 'heal') return `after the RPG came ${on()}`;
        const syringe = tut().ref('syringe');
        const patient = tut().ref('patient') as Human | null;
        if (!syringe || !patient) return 'no syringe and patient put out';
        live(1);
        const belly = patient.limbs.get('midTorso')!.part;
        const sp = syringe.parts[0];
        // the needle's point brought to their middle (steered as it swings, as a player's hand would)
        const tipOf = () => (syringe as unknown as { tip(): { x: number; y: number } }).tip();
        let goal = { x: sp.x, y: sp.y };
        kit.down(sp.x, sp.y);
        const start = { x: sp.x, y: sp.y };
        let was = '';
        // (let go by their hand, they take it: made again in their grip, facing their way)
        let taken: Entity | null = null;
        // (carried at about 3 m/s, up over what lies about, the RPG's leavings say, then down onto them:
        // a patient the RPG step left a few metres off takes longer to reach)
        const ramp = Math.max(30, Math.round(Math.hypot(belly.x - start.x, belly.y + 0.3 - start.y) / 0.05));
        const high = Math.max(start.y, belly.y + 0.6);
        for (let i = 1; i <= ramp + 30; i++) {
          // (gone, burnt up say: its body freed, asking where its needle is would bring Rapier down)
          if (syringe.destroyed) {
            const now = game.successorOf(syringe);
            if (now && (now as unknown as { holder?: Entity | null }).holder === patient) {
              taken = now;
              break;
            }
            return `the syringe was destroyed as it was carried to them (at ${goal.x.toFixed(1)}, step ${i}; just before: ${was})`;
          }
          was = `hp ${sp.hp.toFixed(0)}, burning ${sp.burning.toFixed(2)}, at ${sp.x.toFixed(2)},${sp.y.toFixed(2)} v${Math.hypot(sp.vx, sp.vy).toFixed(1)}, floor alight ${game.puddles.burningAt(sp.x)}, patient alight ${patient.parts.some((q) => !q.destroyed && q.burning > 0)}`;
          // (in them: no pushing on, which would only work it out again)
          if ((syringe as unknown as { lodge: { target: Part } | null }).lodge?.target.entity === patient) break;
          const tp = tipOf();
          const want = { x: start.x + (belly.x - start.x) * Math.min(1, i / ramp), y: i < ramp - 10 ? high : belly.y + 0.3 };
          const aim = i <= ramp ? want : { x: belly.x, y: belly.y };
          goal = { x: goal.x + (aim.x - tp.x) * 0.5, y: goal.y + (aim.y - tp.y) * 0.5 };
          // (the hand kept near where the needle's wanted: held back by something, it doesn't wind off across the room)
          const off = Math.hypot(goal.x - aim.x, goal.y - aim.y);
          if (off > 0.4) goal = { x: aim.x + ((goal.x - aim.x) * 0.4) / off, y: aim.y + ((goal.y - aim.y) * 0.4) / off };
          kit.move(goal.x, goal.y);
          game.advance(1 / 60);
        }
        if (taken) {
          // in their hand: pointed at, F, and they inject themselves
          kit.up(goal.x, goal.y);
          const c = taken.center();
          kit.move(c.x, c.y);
          live(0.05);
          kit.press('KeyF');
          if (!until('heal', 3)) return `they took the syringe, and F on it in their hand: still ${Math.round(((taken as unknown as { fill: number }).fill ?? 1) * 100)}% full (pointing at ${game.pick(c.x, c.y, 0.05)?.entity.def.id ?? 'nothing'}; patient ${patient.status()})`;
        } else {
          const grabbed = controls.grab?.part.entity.def.id ?? 'nothing';
          if (syringe.destroyed) return 'the syringe was destroyed as it was held to them';
          const tipNow = (syringe as unknown as { tip(): { x: number; y: number } }).tip();
          const near = game.pick(tipNow.x, tipNow.y, 0.05)?.entity.def.id ?? 'nothing';
          kit.press('KeyF');
          live(1.5);
          kit.up(goal.x, goal.y);
          if (!until('heal', 3)) return `held the syringe to them and pressed F: still ${Math.round(((syringe as unknown as { fill: number }).fill ?? 1) * 100)}% full (holding ${grabbed}; the needle at ${tipNow.x.toFixed(2)},${tipNow.y.toFixed(2)} on ${near}, their middle at ${belly.x.toFixed(2)},${belly.y.toFixed(2)} from ${start.x.toFixed(2)},${start.y.toFixed(2)}; patient ${patient.status()}, off ${[...patient.limbs.values()].filter((l) => l.severed || l.gone).map((l) => l.spec.key).join(' ') || 'nothing'}, ${game.entities.filter((e) => e.def.id === 'gore').length} pieces about; camera ${game.renderer.camX.toFixed(1)},${game.renderer.camY.toFixed(1)})`;
        }

        // into the car: the patient lifted up, over it and let go
        if (on() !== 'car') return `after healing came ${on()}`;
        const ride = tut().ref('car') as Car | null;
        const pat = tut().ref('patient') as Human | null;
        if (!ride || !pat) return 'no car, or no patient, for the road trip';
        const patAtStart = pat.status();
        live(0.5);
        const mt = pat.limbs.get('midTorso')!.part;
        // (aimed at the car where it is: if a dangling leg knocks it along, the player follows it)
        const seatAt = () => ride.body.pixelToWorld(ride.cfg.seats[0].at[0], 10);
        let seat = seatAt();
        const legs: (() => { x: number; y: number })[] = [() => ({ x: mt.x, y: seat.y + 3 }), () => ({ x: seat.x, y: seat.y + 3 }), () => seat];
        let from = { x: mt.x, y: mt.y };
        kit.down(mt.x, mt.y);
        const took = controls.grab?.part.entity.def.id ?? 'nothing';
        const carX0 = ride.body.x;
        for (const leg of legs) {
          const n = Math.max(10, Math.round((Math.hypot(leg().x - from.x, leg().y - from.y) / 3) * 60));
          for (let i = 1; i <= n; i++) {
            seat = seatAt();
            const to = leg();
            kit.move(from.x + ((to.x - from.x) * i) / n, from.y + ((to.y - from.y) * i) / n);
            game.advance(1 / 60);
          }
          from = leg();
        }
        game.advance(0.1);
        seat = seatAt();
        kit.up(seat.x, seat.y);
        if (!until('car', 2)) return `let go of the patient over the car: ${pat.seat ? 'seated, yet the step did not end' : 'they did not get in'} (took hold of ${took}; the car from ${carX0.toFixed(2)} to ${ride.body.x.toFixed(2)}, let go at ${seat.x.toFixed(2)}; patient ${pat.destroyed ? 'gone' : pat.status()}, at the start ${patAtStart}; limbs lost: ${[...pat.limbs.values()].filter((l) => l.gone || !l.attached).map((l) => l.spec.key)})`;

        // floor it: F on the bonnet, Turbo into the barrels
        if (on() !== 'crash') return `after getting in came ${on()}`;
        if (ride.gear !== 'turbo') return `the car is set to ${ride.gear}, not Turbo`;
        const cratesAt = () => game.entities.filter((e) => e.def.id === 'crate').map((e) => `#${e.id}@${e.center().x.toFixed(1)},${e.center().y.toFixed(1)}${e.frozen ? 'F' : ''}`).join(' ');
        const crates0 = cratesAt();
        const lane0 = game.entities.filter((e) => e !== ride && e.center().x > ride.body.x - 2.5 && e.center().x < ride.body.x + 42)
          .map((e) => `${e.def.id}@${e.center().x.toFixed(1)},${e.center().y.toFixed(1)}${(e as Human).seat ? ' seated' : ''}${tut().props.has(e) ? ' (tour)' : ''}`).join(' ');
        live(0.3);
        const [hx, hy] = ride.cfg.headlight!;
        const bn = ride.body.pixelToWorld(hx - 14, hy - 4);
        const cam0 = { x: game.renderer.camX, y: game.renderer.camY };
        kit.move(bn.x, bn.y);
        live(0.05);
        kit.press('KeyF');
        if (!ride.driving) {
          const picked = game.pick(bn.x, bn.y, 0.05);
          return `F on the front of the car did not drive it (the cursor was on ${controls.hover?.entity.def.id ?? 'nothing'} at ${controls.wx.toFixed(2)},${controls.wy.toFixed(2)} for ${bn.x.toFixed(2)},${bn.y.toFixed(2)}; picked there: ${picked?.entity.def.id ?? 'nothing'}; camera ${cam0.x.toFixed(2)},${cam0.y.toFixed(2)} -> ${game.renderer.camX.toFixed(2)},${game.renderer.camY.toFixed(2)}; ${[...controls.selection].map((e) => e.def.id)} selected)`;
        }
        let top = 0;
        const log: string[] = [];
        for (let i = 0; i < 480 && on() === 'crash'; i++) {
          game.advance(1 / 60);
          top = Math.max(top, ride.body.vx);
          if (i % 30 === 0) log.push(`${ride.body.x.toFixed(1)}/${ride.body.vx.toFixed(1)}${ride.driving ? '' : ' off'}${ride.gear === 'turbo' ? '' : ' ' + ride.gear}`);
        }
        if (on() === 'crash') {
          return `drove at Turbo, top ${top.toFixed(1)} m/s, ${tut().seen.blasts} blasts (x/vx every 0.25 s: ${log.join(' ')}; in the lane at the start: ${lane0}; car at ${ride.body.x.toFixed(1)} tilted ${ride.body.a.toFixed(2)}; wheels ${ride.wheels.map((w) => `${w.x.toFixed(2)},${w.y.toFixed(2)} spin ${w.body.angvel().toFixed(1)}`)}; parts by the wheels: ${game.entities.flatMap((e) => e === ride ? [] : e.parts.filter((p) => !p.destroyed && ride.wheels.some((w) => Math.hypot(p.x - w.x, p.y - w.y) < 0.8)).map((p) => `${e.def.id}:${p.name}@${p.x.toFixed(2)},${p.y.toFixed(2)}${p.frozen ? 'F' : ''}`))}; rider lowest ${Math.min(...(ride.occupant(0)?.parts ?? []).filter((p) => !p.destroyed).map((p) => p.y)).toFixed(2)})`;
        }
        if (on() === 'never') {
          const where = (id: string) => game.entities.filter((e) => e.def.id === id).map((e) => e.parts[0].x.toFixed(1)).join(' ');
          return `drove it at Turbo: ${tut().seen.blasts} blasts, the car ${ride.wrecked ? 'wrecked' : 'whole'} at ${ride.body.x.toFixed(1)} (barrels at ${where('explosive-barrel')}; crates at the start ${crates0}, now ${cratesAt()}); the step did not end`;
        }

        // lightning: Ctrl to the powers, Lightning, a flick
        kit.press('ControlLeft');
        if (controls.tab !== 'powers') return 'Ctrl did not switch to the powers';
        const bolt = [...document.querySelectorAll<HTMLElement>('.tool-btn')].find((b) => b.dataset.name === 'Lightning');
        if (!bolt) return 'no Lightning button';
        bolt.click();
        const x0 = game.renderer.camX - 3;
        kit.down(x0, 2);
        for (let i = 1; i <= 8; i++) {
          kit.move(x0 + i, 2);
          game.advance(1 / 60);
        }
        kit.up(x0 + 8, 2);
        if (!until('lightning')) return `flicked with Lightning: ${tut().seen.bolts} bolts, the step did not end`;
        if ((controls.tab as string) !== 'tools' || controls.tool !== 'drag') return 'after the lightning, the drag tool is not back';

        // slow motion, then stop time and start it again
        kit.press('KeyG');
        live(0.1);
        kit.press('Space');
        live(0.1);
        if (!game.paused) return 'Space did not stop time';
        kit.press('Space');
        if (!until('time')) return `slow motion, stopped and started: the step did not end (slow ${tut().seen.slow}, stopped ${tut().seen.paused})`;
        kit.press('KeyG');

        // undo
        kit.press('KeyZ', { ctrlKey: true });
        if (!until('undo')) return 'Ctrl+Z: the step did not end';
        if (on() !== 'end') return `after undo came ${on()}`;
        click('.tut-next');
        if (tut().active) return 'Play! did not end it';
        if (card() && !card()!.classList.contains('hidden')) return 'its card stayed up';
        if (!tut().had) return 'not remembered as taken';
        const left = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
        if (left(game.explosions, 'explode') || left(game.projectiles, 'fire') || left(controls, 'undo')) return 'it left its watchers on the game';
        return true;
      } finally {
        tut().stop(false);
        controls.ui.closeContextMenu();
        if (game.paused) controls.togglePause();
        game.timeScale = 1;
      }
    }],
    ['extra: tutorial: the building tour played through with the tools, to a rocket saved and flown', () => {
      kit.reset();
      const saved0 = ui().contraptions.items().map((c) => c.id);
      try {
        const music = game.music as unknown as { play(mood: string): void };
        const play = music.play;
        music.play = () => {};
        ui().mainMenu.show();
        const b = document.querySelector<HTMLButtonElement>('.main-menu .mm-btn[data-tour="building"]');
        music.play = play;
        if (!b) return 'no building tour among the main menu\'s Tutorials';
        b.click();
        if (on() !== 'b-hello') return `the building tour started ${on()}`;
        click('.tut-next');
        const at = (name: string) => {
          const e = tut().ref(name);
          if (!e) throw new Error(`the tutorial put out no ${name}`);
          return e.parts[0];
        };
        /** A connection tool's drag, from one point to another. */
        const join = (from: { x: number; y: number }, to: { x: number; y: number }) => {
          kit.down(from.x, from.y);
          kit.move((from.x + to.x) / 2, (from.y + to.y) / 2);
          game.advance(1 / 60);
          kit.move(to.x, to.y);
          game.advance(1 / 60);
          kit.up(to.x, to.y);
          game.advance(1 / 60);
        };
        const tap = (p: { x: number; y: number }) => {
          kit.down(p.x, p.y);
          kit.up(p.x, p.y);
          game.advance(1 / 60);
        };
        const tool = (code: string) => {
          kit.press(code);
          game.advance(1 / 60);
        };
        live(1);

        tool('Digit2');
        join(at('crateA'), at('anchor'));
        if (!until('b-rope')) return 'a rope from the crate to the beam: the step did not end';
        tool('Digit4');
        join(at('crateB'), at('anchor'));
        if (!until('b-spring')) return 'a spring from the other crate to the beam: the step did not end';
        live(0.5);
        tool('Digit7');
        // (the Remove tool cuts what's clicked: the rope, at its knot on the crate)
        const rope = game.connections.list.find((c) => c.kind === 'rope' && c.a.entity === tut().ref('crateA'));
        if (!rope) return 'no rope on the hanging crate to cut';
        tap(game.connections.endPoint(rope, 'a'));
        if (!until('b-remove')) return 'Remove Connections on the hanging crate: the step did not end';
        live(0.5);
        tool('Digit3');
        join(at('plankA'), at('plankB'));
        if (!until('b-weld')) return 'a weld from plank to plank: the step did not end';
        live(0.5);
        tool('Digit5');
        const door = at('door');
        const top = door.localToWorld(0.9, 0);
        join({ x: top.x, y: Math.max(top.y, door.y + 0.6) }, at('post'));
        if (!until('b-hinge')) return `a hinge from the plank to the post: the step did not end (${tut().made('hinge').length} hinges)`;
        tool('Digit5');
        tap(at('plankA'));
        if (!until('b-pin')) return 'a pin on a plank: the step did not end';
        tool('Digit6');
        join(at('battery'), at('bulb'));
        if (!until('b-wire')) return 'a wire from the battery to the bulb: the step did not end';
        live(0.5);
        join(at('button'), at('c4'));
        tool('Digit1');
        const btn = at('button');
        kit.move(btn.x, btn.y);
        game.advance(1 / 60);
        kit.press('KeyF');
        if (!until('b-button', 2)) return `wired the button to the C4 and pressed it: ${tut().seen.blasts} blasts`;
        live(1);
        const fuse = [...document.querySelectorAll<HTMLElement>('.tool-btn')].find((e) => e.dataset.name === 'Fuse');
        if (!fuse) return 'no Fuse tool';
        fuse.click();
        const sticks = [...tut().props].filter((e) => e.def.id === 'dynamite' && !e.destroyed).map((e) => e.parts[0]);
        if (sticks.length !== 3) return `${sticks.length} sticks of dynamite put out`;
        join(sticks[0], sticks[1]);
        join(sticks[1], sticks[2]);
        live(0.3);
        const fuseCord = game.connections.list.find((c) => c.kind === 'fuse');
        if (!fuseCord) return 'no fuse cord laid';
        const mid = { x: (sticks[0].x + sticks[1].x) / 2, y: (sticks[0].y + sticks[1].y) / 2 };
        tap(mid);
        if (!until('b-fuse', 12)) return `laid the cords and clicked one: ${tut().seen.blasts} blasts (cord ${fuseCord.burn ? 'burning' : 'never lit'})`;
        tool('Digit8');
        const sx = game.renderer.camX + 3;
        kit.down(sx, 2);
        kit.move(sx + 0.6, 2.5);
        game.advance(1 / 60);
        kit.move(sx + 1.2, 3);
        game.advance(1 / 60);
        kit.up(sx + 1.2, 3);
        if (!until('b-shape')) return 'drew a box with the Shape tool: the step did not end';

        // the rocket
        if (on() !== 'rocket') return `after the shapes came ${on()}`;
        click('.tut-next');
        live(1);
        tool('Digit3');
        join(at('thrusterL'), at('beam'));
        join(at('thrusterR'), at('beam'));
        if (!until('r-weld')) return 'welded both thrusters to the beam: the step did not end';
        join(at('lever'), at('beam'));
        tool('Digit6');
        join(at('lever'), at('thrusterL'));
        join(at('lever'), at('thrusterR'));
        if (!until('r-wire')) return 'welded the switch on and wired it to both thrusters: the step did not end';
        live(0.5);
        tool('Digit2');
        const pilot = (tut().ref('pilot') as Human).limbs.get('upperTorso')!.part;
        join(pilot, at('beam'));
        if (!until('r-pilot')) return 'roped the pilot to the beam: the step did not end';
        tool('Digit1');
        controls.selection = new Set(game.entities);
        const beam = at('beam');
        kit.down(beam.x, beam.y, 2);
        kit.up(beam.x, beam.y, 2);
        const save = [...document.querySelectorAll<HTMLElement>('.ctx-item')].find((d) => d.textContent?.startsWith('Save as contraption'));
        if (!save) return 'no Save as contraption… in the menu';
        save.dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true }));
        const ok = [...document.querySelectorAll<HTMLButtonElement>('.dialog-panel .panel-btn')].find((e) => e.textContent === 'Save');
        if (!ok) return 'no Save button in the dialog';
        ok.click();
        if (!until('r-save')) return 'saved it as a contraption: the step did not end';
        const lever = at('lever');
        kit.move(lever.x, lever.y);
        game.advance(1 / 60);
        kit.press('KeyF');
        if (!until('r-launch', 4)) return `flipped the switch: the beam rose only ${(at('beam').y - tut().n).toFixed(2)} m`;
        if (on() !== 'b-end') return `after liftoff came ${on()}`;
        click('.tut-next');
        if (tut().active) return 'Play! did not end it';
        if (!tut().hadTour('building')) return 'not remembered as taken';
        return true;
      } finally {
        tut().stop(false);
        controls.ui.closeContextMenu();
        ui().closeOverlays();
        for (const c of ui().contraptions.items()) if (!saved0.includes(c.id)) ui().contraptions.remove(c.id);
        controls.setTool('drag');
      }
    }],
    ['extra: tutorial: steps can be skipped, each putting out what it needs, and × ends it at once', () => {
      kit.reset();
      try {
        const started = startFromMenu();
        if (started !== true) return started;
        const seen: string[] = [];
        // past the welcome, then skip the rest as they come
        click('.tut-next');
        for (let i = 0; i < 4; i++) {
          seen.push(on());
          click('.tut-skip');
        }
        if (seen.join() !== 'spawn,fling,menu,arm') return `skipped through ${seen.join(', ')}`;
        // at "open fire" with no armed gunner (the arm step was skipped): one is put out, armed
        if (on() !== 'shoot') return `then came ${on()}`;
        live(0.3);
        const armed = game.entities.some((e) => e.def.id === 'human' && (e as Human).heldItems().some((i) => i.def.id === 'rifle'));
        if (!armed) return 'skipping to Open fire put out no one holding the rifle';
        click('.tut-skip');
        if (!tut().mine('molotov')) return 'Light it up put out no Molotov';
        click('.tut-x');
        if (tut().active) return '× did not end it';
        if (document.querySelector('.tut-glow') || document.querySelector('.tut-arrow:not(.hidden)')) return 'its arrow or glow stayed after ×';
        // and it starts again from the top
        if (!tut().start() || on() !== 'hello') return 'it would not start again';
        return true;
      } finally {
        tut().stop(false);
      }
    }],
    ['extra: tutorial: skipping the rocket’s steps builds them for the player, and it still flies', () => {
      kit.reset();
      try {
        tut().start('building');
        tut().go(tut().steps.findIndex((s) => s.id === 'rocket'));
        live(0.5);
        click('.tut-next');
        for (const id of ['r-weld', 'r-wire', 'r-pilot', 'r-save']) {
          if (on() !== id) return `expected ${id}, at ${on()}`;
          click('.tut-skip');
          live(0.3);
        }
        if (on() !== 'r-launch') return `then came ${on()}`;
        const beam = tut().ref('beam')!;
        const lever = tut().ref('lever')!;
        const y0 = beam.center().y;
        lever.activate();
        live(2);
        const rose = beam.center().y - y0;
        if (rose < 3) return `skipped to liftoff and flipped the switch: the rocket rose only ${rose.toFixed(2)} m`;
        if (on() === 'r-launch') return 'it flew, yet Liftoff! did not finish';
        return true;
      } finally {
        tut().stop(false);
      }
    }],
    ['extra: tutorial: people & medicine played through: hurt, x-rayed, and every cure', () => {
      kit.reset();
      try {
        return keepingProgress(() => {
          const patient = () => ref<Human>('patient');
          return play('people', {
            'p-break': () => {
              const l = patient().limbs.get('lowerArmF')!;
              patient().damage(l.part, l.spec.hp * 0.6, 'blunt', { x: l.part.x, y: l.part.y }, { x: 0, y: -1 });
            },
            'p-xray': () => {
              controls.command('xray');
              live(0.2);
              controls.command('xray');
            },
            'p-detail': () => {
              controls.command('detail');
              live(0.2);
              controls.command('detail');
            },
            'p-vitals': () => {
              kit.move(game.renderer.camX, 9);
              controls.selection = new Set<Entity>([patient()]);
              controls.command('vitals');
            },
            // the knife thrown at their middle, point first
            'p-stab': [() => {
              const t = patient().limbs.get('midTorso')!.part;
              const k = ref('knife');
              const c = k.center();
              k.translate(t.x - 1.2 - c.x, t.y - c.y);
              k.setVelocity(9, 0, 0);
            }, 2],
            'p-bandage': () => treat(ref('bandage'), patient(), 2, bleedingMost(patient())),
            'p-sever': () => patient().sever(patient().limbs.get('lowerArmB')!, 'cut'),
            'p-heal': [() => treat(ref('syringe'), patient()), 4],
            'p-burn': () => controls.toggleFire([patient()]),
            // the flasks smashed over the biggest flames, a second apart; a flame that
            // hangs on put out from their menu, as the step says
            'p-douse': [() => {
              const h = patient();
              const alight = () => h.parts.filter((p) => !p.destroyed && p.burning > 0);
              const before = alight().length;
              for (let i = 0; i < 3 && alight().length; i++) {
                const top = alight().reduce((a, p) => (p.burning > a.burning ? p : a));
                smashAt(ref<Flask>(`water${i}`), top.x, top.y + 0.5);
                live(1);
              }
              if (alight().length > before / 2) throw new Error(`three flasks of water left ${alight().length} of ${before} parts alight`);
              if (alight().length) controls.toggleFire([h]);
            }, 4],
            'p-kit': [() => treat(ref('kit'), patient()), 5],
            'p-knockout': [() => treat(ref('ko'), patient()), 4],
            'p-adrenaline': [() => treat(ref('adrenaline'), patient(), 2.5), 5],
            'p-poison': [() => treat(ref('poison'), patient(), 2.5), 7],
            'p-defib': [() => treat(ref('defib'), ref('dead'), 5), 6],
            'p-life': [() => treat(ref('life'), ref('body'), 4), 5],
          });
        });
      } finally {
        tidy();
      }
    }],
    ['extra: tutorial: weapons & explosives played through, from a pistol on the floor to a nuke', () => {
      kit.reset();
      try {
        return keepingProgress(() =>
          play('weapons', {
            'w-lying': () => ref('pistol').activate(),
            'w-auto': () => {
              controls.activate([ref('smg')], true);
              live(1.2);
              controls.releaseActivation();
            },
            'w-hold': () => {
              if (!handTo(ref('gunner'), ref('shotgun'))) throw new Error('the gunner would not take the shotgun');
            },
            'w-edit': () => {
              ui().editValues(ref<Firearm>('shotgun').editor());
              live(0.2);
              if (!document.querySelector('.edit-panel')) throw new Error('Edit gun… opened no panel');
              ui().closeOverlays();
            },
            'w-fire': () => {
              const g = ref('shotgun');
              (g instanceof Item && g.holder ? g.holder : ref('gunner')).activate();
            },
            'w-swing': () => ref('batter').activate(),
            'w-knife': [() => {
              const b = ref('board').parts[0];
              const k = ref('knife');
              const c = k.center();
              k.translate(b.x - 1.2 - c.x, b.y - c.y);
              k.setVelocity(9, 0, 0);
            }, 2],
            'w-grenade': [() => ref('grenade').activate(), 5],
            'w-dynamite': () => ref('c4').activate(),
            // the cords laid (as the Fuse tool lays them), and the first lit
            'w-cord': [() => {
              const d = ref('stick');
              const c4 = nearest('c4', d.center().x);
              const barrel = c4 && nearest('explosive-barrel', c4.center().x);
              if (!c4 || !barrel) throw new Error('no C4 and barrel put out to lay the cord to');
              const link = (a: Entity, b: Entity) => game.connections.create('fuse', a.parts[0], { x: a.parts[0].x, y: a.parts[0].y }, b.parts[0], { x: b.parts[0].x, y: b.parts[0].y });
              const first = link(d, c4);
              link(c4, barrel);
              if (!first) throw new Error('no fuse cord laid');
              game.connections.light(first, 0.5);
            }, 12],
            'w-molotov': () => {
              const m = ref<Molotov>('molotov');
              m.activate();
              live(0.1);
              m.shatter();
            },
            'w-rpg': [() => ref('soldier').activate(), 6],
            'w-crossbow': () => ref('bow').activate(),
            'w-bolts': [() => {
              const b = ref<Crossbow>('bow');
              b.load('explosive');
              live(1.6);
              b.activate();
            }, 3],
            'w-nuke': [() => {
              const n = ref<Nuke>('nuke');
              if (n.kt !== NUKE_MIN_KT) throw new Error(`the nuke is set to ${n.kt} kt, not its least`);
              n.detonate();
            }, 4],
          }),
        );
      } finally {
        tidy();
      }
    }],
    ['extra: tutorial: vehicles played through: a car spawned, boarded, driven, geared, steered, crashed; a tank aimed, fired, driven, crewed', () => {
      kit.reset();
      try {
        return keepingProgress(() => {
          const ride = () => ref<Car>('ride');
          return play('vehicles', {
            'v-spawn': () => {
              controls.arm(getItem('car')!);
              kit.move(game.renderer.camX - 3, 1.2);
              live(0.05);
              controls.command('spawnRight');
            },
            'v-board': () => seat(ride(), ref('driver')),
            'v-drive': [() => ride().activate(), 8],
            'v-stop': [() => ride().activate(), 5],
            'v-gear': () => choose(ride(), 'Speed: Fast'),
            'v-keys': [() => {
              kit.move(ride().body.x, 9);
              controls.selection = new Set<Entity>([ride()]);
              holdKey('driveRight', 'v-keys', 6);
            }, 1],
            'v-out': () => choose(ride(), 'Get out', 'Everyone out'),
            'v-crash': [() => ref<Car>('car').activate(), 10],
            'v-aim': [() => {
              controls.selection = new Set<Entity>([ref('tank')]);
              holdKey('aimUp', 'v-aim', 5);
            }, 1],
            'v-shoot': [() => ref('tank').activate(), 3],
            'v-roll': [() => {
              controls.selection = new Set<Entity>([ref('tank')]);
              holdKey('driveRight', 'v-roll', 10);
            }, 1],
            'v-hatch': () => seat(ref<Tank>('tank'), ref('crew')),
          });
        });
      } finally {
        tidy();
      }
    }],
    ['extra: tutorial: the world played through: fire, water, oil, acid, buckets, time, the powers, another map and ground of your own', () => {
      kit.reset();
      let made = '';
      try {
        const r = keepingProgress(() =>
          play('world', {
            'o-fire': () => controls.toggleFire([ref('crate0')]),
            // (crate to crate, about a second each)
            'o-spread': [() => {}, 8],
            // one of the tour's flasks poured over each crate burning
            'o-water': [() => {
              const burning = crates().filter((e) => e.parts.some((p) => !p.destroyed && p.burning > 0));
              burning.forEach((c, i) => pourAt(ref(`water${i}`), c.center().x, c.center().y + 1.6));
            }, 8],
            'o-oil': [() => pourAt(ref('oil'), tut().n, WORLD.floor + 1.8), 5],
            // the burning crate pushed into the oil
            'o-light': [() => {
              const c = ref('torch');
              c.translate(tut().n - c.center().x, 0);
              c.setVelocity(0, 0);
            }, 5],
            'o-acid': () => {
              const d = mid(ref('dummy'));
              smashAt(ref<Flask>('acid'), d.x, d.y + 0.4);
            },
            'o-bucket': [() => {
              const b = ref('bucket');
              pourAt(ref('water'), b.center().x, b.center().y + 1.25);
            }, 6],
            'o-pause': () => controls.command('time'),
            'o-step': () => {
              for (let i = 0; i < 3; i++) controls.command('step');
            },
            'o-slow': () => {
              controls.command('time');
              live(0.1);
              controls.command('slowmo');
              live(0.3);
              controls.command('slowmo');
            },
            'o-push': () => {
              const x = game.renderer.camX;
              usePower('push', x, 0.5);
              usePower('pull', x + 2, 1);
            },
            'o-lift': () => usePower('lift', game.renderer.camX, 1.5),
            'o-lightning': () => {
              if (controls.tab !== 'powers') controls.toggleTab();
              controls.setPower('lightning');
              const x0 = game.renderer.camX - 3;
              kit.down(x0, 2);
              for (let i = 1; i <= 8; i++) {
                kit.move(x0 + i, 2);
                game.advance(1 / 60);
              }
              kit.up(x0 + 8, 2);
            },
            'o-pyro': () => usePower('pyro', game.renderer.camX + 2, 0.4),
            // the one map that can't be edited, for the next step to get them off it
            'o-maps': () => {
              tb('Maps').click();
              pickMap((name) => name === ENDLESS.name);
            },
            'o-terrain': () => {
              if (!/can’t be edited/.test(card()?.textContent ?? '')) throw new Error(`on the ${ENDLESS.name}, the step doesn't say to leave it first`);
              tb('Maps').click();
              const editBtn = () => [...document.querySelectorAll<HTMLButtonElement>('.overlay:not(.hidden) .maps-panel .panel-btn')].find((b) => b.textContent === 'Edit terrain');
              if (!editBtn()?.disabled) throw new Error(`Edit terrain is not greyed out on the ${ENDLESS.name}`);
              // (the step points at a map that can be: that one)
              live(0.1);
              const g = glowing();
              if (!g?.classList.contains('map-card') || g.querySelector('.map-name')?.textContent === ENDLESS.name) throw new Error('on the plate, the step points at no other map');
              pickMap((name) => name === g.querySelector('.map-name')?.textContent);
              live(0.2);
              if (game.map.endless) throw new Error('picking another map left the plate');
              if (/can’t be edited/.test(card()?.textContent ?? '')) throw new Error('off the plate, the step still says to leave it');
              if (!panelOpen('Maps')) tb('Maps').click();
              const edit = editBtn();
              if (!edit) throw new Error('no Edit terrain in the Maps panel');
              edit.click();
              if (!controls.terrain) throw new Error('Edit terrain did not start the Terrain tool');
              const x = game.renderer.camX;
              controls.terrain.make('box', [{ x: x - 1.5, y: WORLD.floor }, { x: x + 1.5, y: WORLD.floor + 0.6 }]);
              live(0.1);
              click('.map-banner .panel-btn');
              made = game.map.id;
            },
          }, () => {
            // the end: Back to the Lab
            const back = [...document.querySelectorAll<HTMLElement>('.tut-alt')].find((b) => b.textContent === 'Back to the Lab');
            if (!back) throw new Error('no Back to the Lab at the end');
            back.click();
          }),
        );
        if (r !== true) return r;
        if (game.map.id !== LAB.id) return `Back to the Lab left the map at ${game.map.name}`;
        return true;
      } finally {
        tidy();
        if (made && made !== LAB.id) ui().maps.custom.remove(made);
      }
    }],
    ['extra: tutorial: editing & saving played through: select, move, copy, delete, undo, freeze, ghost, flip, turn, snap, resize, draw, settings, keys, save', () => {
      kit.reset();
      let quick: string | null = null;
      try {
        quick = localStorage.getItem('blueberry-quicksave');
      } catch {
        quick = null;
      }
      try {
        return keepingProgress(() => {
          const loose = () => {
            const c = crates().find((e) => !e.frozen && !e.noCollide);
            if (!c) throw new Error('no crate left about');
            return c;
          };
          return play('editing', {
            'e-select': () => {
              const ps = [0, 1, 2].map((i) => ref(`crate${i}`).parts[0]);
              kit.down(ps[0].x, ps[0].y);
              kit.up(ps[0].x, ps[0].y);
              for (const p of ps.slice(1)) {
                kit.down(p.x, p.y, 0, { shiftKey: true });
                kit.up(p.x, p.y);
              }
            },
            'e-move': () => {
              const p = ref('crate1').parts[0];
              kit.drag(p.x, p.y, p.x + 2.2, p.y + 0.5, 0.6, 0.2, true);
            },
            'e-copy': () => {
              kit.move(game.renderer.camX, 9);
              live(0.05);
              controls.command('copy');
              kit.move(game.renderer.camX + 1, 3);
              live(0.05);
              controls.command('paste');
            },
            'e-delete': () => {
              kit.move(game.renderer.camX, 9);
              controls.selection = new Set<Entity>([loose()]);
              controls.command('delete');
            },
            'e-undo': () => {
              kit.press('KeyZ', { ctrlKey: true });
              live(0.2);
              kit.press('KeyY', { ctrlKey: true });
            },
            // lifted by hand, and frozen while held up
            'e-freeze': () => {
              const s = ref('shelf').parts[0];
              const x = s.x;
              const y = s.y;
              kit.down(x, y);
              for (let i = 1; i <= 40; i++) {
                kit.move(x, y + 1.6 * (i / 40));
                game.advance(1 / 60);
              }
              controls.command('freeze');
              kit.up(x, y + 1.6);
            },
            'e-nocollide': () => {
              const g = ref('ghost').parts[0];
              kit.down(g.x, g.y);
              kit.up(g.x, g.y);
              controls.command('noCollide');
            },
            'e-flip': () => controls.command('flip'),
            'e-rotate': () => {
              controls.selection = new Set<Entity>([loose()]);
              controls.command('rotateLeft', true);
            },
            // time stopped, a crate dragged with the snap key held, time started again
            'e-snap': () => {
              controls.command('time');
              const p = loose().parts[0];
              const x = p.x;
              const y = p.y;
              kit.down(x, y);
              kit.key(keyOf('snap'), true);
              for (let i = 1; i <= 20; i++) {
                kit.move(x + i * 0.05, y + 0.5);
                game.advance(1 / 60);
              }
              kit.up(x + 1, y + 0.5);
              kit.key(keyOf('snap'), false);
              controls.command('time');
            },
            'e-resize': () => {
              if (!controls.setSize(loose(), 40, 40)) throw new Error('a crate would not resize');
            },
            'e-shape': () => {
              controls.setTool('shape');
              const x = game.renderer.camX + 3;
              kit.down(x, 2);
              kit.move(x + 0.6, 2.5);
              game.advance(1 / 60);
              kit.move(x + 1.2, 3);
              game.advance(1 / 60);
              kit.up(x + 1.2, 3);
            },
            'e-settings': () => {
              tb('Settings').click();
              live(0.2);
              click('.overlay:not(.hidden) .panel-close');
            },
            'e-keys': () => {
              tb('Controls').click();
              live(0.2);
              if (!document.querySelector('.overlay:not(.hidden) .help-panel')) throw new Error('the Controls button opened no Controls panel');
              ui().closeOverlays();
            },
            'e-save': () => {
              kit.press('KeyS', { ctrlKey: true });
              live(0.2);
              kit.press('KeyO', { ctrlKey: true });
            },
          });
        });
      } finally {
        tidy();
        try {
          if (quick === null) localStorage.removeItem('blueberry-quicksave');
          else localStorage.setItem('blueberry-quicksave', quick);
        } catch {
          /* (nothing kept to put back) */
        }
      }
    }],
    ['extra: tutorial: animals played through: a dog, a cat, a fox, medicine for animals, a cow’s kick and bacon', () => {
      kit.reset();
      try {
        return keepingProgress(() => {
          const dog = () => ref<Creature>('dog');
          return play('animals', {
            'a-spawn': () => {
              controls.arm(getItem('dog')!);
              kit.move(game.renderer.camX, 1);
              live(0.05);
              controls.command('spawnRight');
            },
            // (sent after its person: following them is its own business, see the creature tests)
            'a-walk': [() => dog().goTo(mid(dog()).x + 4), 10],
            'a-cat': [() => ref('cat').setVelocity(3, 6), 6],
            // the dog's person carried over by the hand and set down a couple of meters
            // from it: up on their feet, off it runs
            'a-fox': [() => {
              const bring = () => {
                const f = mid(ref('fox'));
                const o = mid(ref('owner'));
                // (from the person's side, near: lying a moment, they can slide a metre off before they're up)
                const tx = f.x + (Math.sign(o.x - f.x) || 1) * 1.6;
                const [x0, y0] = [o.x, o.y];
                kit.down(x0, y0);
                for (let i = 1; i <= 120; i++) {
                  kit.move(x0 + (tx - x0) * (i / 120), y0 + Math.sin((i / 120) * Math.PI) * 0.5);
                  game.advance(1 / 60);
                }
                for (let i = 0; i < 30; i++) {
                  kit.move(tx, y0);
                  game.advance(1 / 60);
                }
                kit.up(tx, y0);
              };
              // (set down, they lie a moment and take a few seconds getting up; wandered off
              // before the fox took fright, they're brought over again, as a player would)
              bring();
              if (!until('a-fox', 8)) bring();
            }, 12],
            'a-adrenaline': [() => {
              dog().stay(30);
              live(0.5);
              treat(ref('adrenaline'), dog(), 2.5);
            }, 5],
            'a-heal': [() => {
              dog().stay(30);
              // (on its hips: the adrenaline's syringe may still stand in its chest, and the kit would sit on that)
              treat(ref('kit'), dog(), 2, dog().limbs.get('hips')?.part);
            }, 4],
            'a-menu': () => {
              const c = mid(dog());
              kit.down(c.x, c.y, 2);
              kit.up(c.x, c.y, 2);
              controls.ui.closeContextMenu();
            },
            'a-cow': [() => ref('pistol').activate(), 8],
            'a-bacon': [() => ref('c4').activate(), 3],
          });
        });
      } finally {
        tidy();
      }
    }],
    ['extra: tutorial: every new tour skipped through (with a mouse, and on a touch screen), each step putting out what the next ones need', () => {
      const touch0 = controls.touchMode;
      const living = (e: Entity | null | undefined): e is Human => e instanceof Human && !e.destroyed && e.alive;
      const has = (name: string) => !!tut().ref(name);
      /** What a step needs as it comes up (after the ones before it were skipped): null, or what's missing. */
      const needs: Record<string, () => string | null> = {
        'p-bandage': () => {
          const h = tut().ref('patient');
          const r = living(h) ? [...h.limbs.values()].reduce((s, l) => s + l.wounds.reduce((a, w) => a + w.rate, 0), 0) : 0;
          return r > 0.1 && has('bandage') ? null : `patient bleeding ${r.toFixed(2)}, a bandage ${has('bandage')}`;
        },
        'p-heal': () => (has('syringe') ? null : 'no healing syringe'),
        'p-douse': () =>
          game.entities.some((e) => living(e) && e.parts.some((p) => !p.destroyed && p.burning > 0)) && has('water0') ? null : 'no one on fire, or no water',
        'p-defib': () => {
          const d = tut().refs.get('dead');
          return d instanceof Human && !d.destroyed && !d.alive && has('defib') ? null : 'no one dead to shock, or no defibrillator';
        },
        'p-life': () => {
          const b = tut().refs.get('body');
          return b instanceof Human && !b.destroyed && !b.alive && has('life') ? null : 'no body, or no life syringe';
        },
        'w-edit': () => {
          const g = tut().ref('shotgun');
          return g instanceof Item && g.holder ? null : 'no one holds the shotgun';
        },
        'w-fire': () => {
          const g = tut().ref('shotgun');
          return g instanceof Item && g.holder ? null : 'no one holds the shotgun';
        },
        'w-swing': () => (living(tut().ref('batter')) && (tut().ref('batter') as Human).heldItems().some((i) => i.def.id === 'bat') ? null : 'no batter with a bat'),
        'w-rpg': () => (living(tut().ref('soldier')) && (tut().ref('soldier') as Human).heldItems().some((i) => i.def.id === 'rpg') ? null : 'no soldier with an RPG'),
        'w-bolts': () => (has('bow') ? null : 'no crossbow'),
        'w-nuke': () => {
          const n = tut().ref('nuke') as Nuke | null;
          return n && n.kt === NUKE_MIN_KT ? null : `the nuke is ${n ? `set to ${n.kt} kt` : 'missing'}`;
        },
        'v-drive': () => ((tut().ref('ride') as Car | null)?.occupant(0) ? null : 'no one at the wheel'),
        'v-crash': () => {
          const c = tut().ref('car') as Car | null;
          return c?.occupant(0) && c.gear === 'turbo' ? null : `the car ${c ? `in ${c.gear}, ${c.occupant(0) ? 'driven' : 'empty'}` : 'missing'}`;
        },
        'v-shoot': () => (has('tank') ? null : 'no tank'),
        'o-light': () => {
          const torch = tut().ref('torch');
          return game.puddles.total > 0 && torch?.parts.some((p) => p.burning > 0) ? null : `oil ${game.puddles.total.toFixed(1)}, the crate ${torch ? 'not burning' : 'missing'}`;
        },
        'o-step': () => (game.paused ? null : 'time is running'),
        'e-nocollide': () => {
          const s = tut().ref('shelf');
          return s?.frozen && s.center().y > WORLD.floor + 0.8 && has('ghost') ? null : 'no shelf frozen up in the air, or no crate on it';
        },
        'a-walk': () => (has('dog') && has('owner') ? null : 'no dog, or no one for it to follow'),
        'a-cow': () => (has('cow') && has('pistol') ? null : 'no cow, or no pistol'),
        'a-bacon': () => (has('pig') && has('c4') ? null : 'no pig, or no C4'),
      };
      try {
        return keepingProgress(() => {
          for (const touch of [false, true]) {
            controls.touchMode = touch;
            const how = touch ? ' (touch)' : '';
            for (const tour of TOURS) {
              if (tour.id === 'basics' || tour.id === 'building') continue;
              kit.reset();
              if (!tut().start(tour.id)) return `${tour.id} would not start`;
              const been: string[] = [];
              for (let n = 0; n < 60 && tut().active; n++) {
                const s = tut().step;
                been.push(s.id);
                live(0.15);
                const need = tut().step === s ? needs[s.id]?.() : null;
                if (need) return `${tour.id}${how}: skipped to "${s.title}": ${need}`;
                if (tut().active && tut().step === s) tut().skip();
              }
              if (tut().active) return `${tour.id}${how}: never ended (at ${on()})`;
              const want = tour.steps.filter((s) => !(touch && s.keyboard)).map((s) => s.id);
              const missed = want.filter((id) => !been.includes(id));
              if (missed.length) return `${tour.id}${how}: never came to ${missed.join(', ')}`;
              const keys = been.filter((id) => touch && tour.steps.find((s) => s.id === id)?.keyboard);
              if (keys.length) return `${tour.id} on a touch screen came to ${keys.join(', ')}, which need a keyboard`;
              tidy();
            }
          }
          return true;
        });
      } finally {
        controls.touchMode = touch0;
        tidy();
      }
    }],
    ['extra: tutorial: the Tutorials panel lists every tour, starts one, ticks it once finished; the pause menu and the main menu offer them', () => {
      kit.reset();
      const music = game.music as unknown as { play(mood: string): void };
      const play0 = music.play;
      try {
        return keepingProgress(() => {
          for (const t of TOURS) localStorage.removeItem(storeKey(t.id));
          tut().progress.reload();
          ui().showTutorials();
          const panel = document.querySelector('.tutorials-panel');
          if (!panel || panel.closest('.overlay')?.classList.contains('hidden')) return 'the Tutorials panel did not open';
          const rows = [...panel.querySelectorAll<HTMLElement>('.tour-row')];
          if (rows.length !== TOURS.length + SOON.length) return `${rows.length} rows for ${TOURS.length} tours and ${SOON.length} to come`;
          for (const t of TOURS) {
            const row = panel.querySelector<HTMLElement>(`.tour-row[data-tour="${t.id}"]`);
            if (!row) return `no row for ${t.title}`;
            if (!row.textContent?.includes(t.title) || !row.textContent.includes(`about ${t.minutes} min`)) return `the row for ${t.id} reads "${row.textContent}"`;
            if (row.classList.contains('done')) return `${t.id} ticked as done before it was taken`;
            if (!row.querySelector('.tour-start')) return `no Start for ${t.id}`;
          }
          if (panel.querySelectorAll('.tour-row.soon .tour-start').length) return 'a tour to come can be started';
          // Start: the panel goes, the tour begins
          panel.querySelector<HTMLElement>('.tour-row[data-tour="animals"] .tour-start')!.click();
          if (!tut().active || tut().tour !== 'animals' || on() !== 'a-hello') return `Start on Animals: the tutorial is at ${tut().active ? `${tut().tour}/${on()}` : 'nothing'}`;
          if (!panel.closest('.overlay')!.classList.contains('hidden')) return 'the panel stayed up over the tour';
          // to its end: ticked as done (kept in the browser)
          tut().go(tut().steps.length - 1);
          click('.tut-next');
          if (tut().active) return 'the last step’s button did not end it';
          tut().progress.reload();
          if (!tut().tours().find((t) => t.id === 'animals')?.done) return 'Animals, finished, is not ticked as done after reading the browser’s record again';
          // left with ×: taken (not offered as new) but not ticked
          tut().start('vehicles');
          click('.tut-x');
          tut().progress.reload();
          if (!tut().hadTour('vehicles') || tut().tours().find((t) => t.id === 'vehicles')?.done) return 'Vehicles, left with ×, is not kept as begun but not done';
          ui().showTutorials();
          const animals = document.querySelector('.tutorials-panel .tour-row[data-tour="animals"]');
          if (!animals?.classList.contains('done') || animals.querySelector('.tour-tick')?.textContent !== '✓') return 'the panel shows no tick on Animals';
          if (document.querySelector('.tutorials-panel .tour-row[data-tour="vehicles"]')?.classList.contains('done')) return 'the panel ticks Vehicles, only begun';
          ui().closeOverlays();
          // the pause menu's Tutorials…: the panel, time still stopped until it's closed
          ui().togglePauseMenu();
          if (!game.paused) return 'the pause menu did not stop time';
          const item = [...document.querySelectorAll<HTMLElement>('.pause-panel .panel-btn')].find((b) => b.textContent === 'Tutorials…');
          if (!item) return 'no Tutorials… in the pause menu';
          if ([...document.querySelectorAll('.pause-panel .panel-btn')].some((b) => /^(Tutorial|Building tutorial)$/.test(b.textContent ?? ''))) return 'the pause menu still has the old tutorial buttons';
          item.click();
          if (document.querySelector('.tutorials-panel')!.closest('.overlay')!.classList.contains('hidden')) return 'Tutorials… opened no panel';
          if (!game.paused) return 'time ran again with the Tutorials panel up from the pause menu';
          click('.tutorials-panel .panel-close');
          if (game.paused) return 'closing the Tutorials panel left time stopped';
          // the tool bar's button
          tb('Tutorials').click();
          if (document.querySelector('.tutorials-panel')!.closest('.overlay')!.classList.contains('hidden')) return 'the tool bar’s Tutorials opened no panel';
          ui().closeOverlays();
          // the main menu's Tutorials: every tour, the basics first
          music.play = () => {};
          ui().mainMenu.show();
          const offered = [...document.querySelectorAll<HTMLElement>('.main-menu .mm-btn[data-tour]')].map((b) => b.dataset.tour);
          ui().mainMenu.close();
          if (offered.join() !== TOURS.map((t) => t.id).join()) return `the main menu offers ${offered.join(', ')}`;
          return true;
        });
      } finally {
        music.play = play0;
        tidy();
      }
    }],
    ['extra: tutorial: a step greys out what it isn’t about (a toy it doesn’t ask for won’t spawn, a key it doesn’t give does nothing); quitting puts it all back', () => {
      kit.reset();
      const x0 = game.renderer.camX;
      try {
        return keepingProgress(() => {
          if (!tut().start('animals')) return 'the animals tour would not start';
          click('.tut-next');
          live(0.1);
          if (on() !== 'a-spawn') return `after the welcome came ${on()}`;
          const locked = (sel: string) => {
            // (what a click just put up is greyed out before it's painted: here, before it's looked at)
            tut().lock.flush();
            const e = document.querySelector(sel);
            if (!e) throw new Error(`nothing matches ${sel}`);
            return e.classList.contains('tut-locked');
          };
          const shelf = (c: string) => `.cat-strip .cat-btn[data-cat="${c}"]`;
          const tile = (id: string) => `.items .item[data-id="${id}"]`;
          const cats = () => game.entities.filter((e) => e.def.id === 'cat' && !e.destroyed).length;
          // (a call: what's armed changes under the clicks)
          const armed = (): string | undefined => controls.armed?.id;
          // the toybox: only the dog, on its shelf
          if (locked(shelf('Characters'))) return 'the shelf the step asks for is greyed out';
          // (open already, a click would fold it)
          if (!document.querySelector(tile('dog'))) click(shelf('Characters'));
          if (!locked(shelf('Objects'))) return 'a shelf the step has nothing to do with is not greyed out';
          if (document.querySelector<HTMLElement>(shelf('Objects'))!.title !== LOCKED_NOTE) return `a greyed-out shelf’s tooltip says “${document.querySelector<HTMLElement>(shelf('Objects'))!.title}”`;
          click(shelf('Objects'));
          if (document.querySelector('.items .item[data-cat="Objects"]')) return 'a greyed-out shelf opened';
          if (locked(tile('dog'))) return 'the toy the step asks for is greyed out';
          if (!locked(tile('cat'))) return 'a toy the step doesn’t ask for is not greyed out';
          click(tile('cat'));
          if (armed() === 'cat') return 'a greyed-out toy was picked';
          kit.move(x0 + 2, 1);
          live(0.05);
          kit.press(keyOf('spawnRight'));
          live(0.1);
          if (cats()) return 'a greyed-out toy was spawned';
          // keys and buttons it doesn't give
          kit.press(keyOf('xray'));
          if (controls.xray) return `${keyOf('xray')} (x-ray) worked, though the step doesn’t give it`;
          kit.press(keyOf('tool2'));
          if ((controls.tool as string) !== 'drag') return `${keyOf('tool2')} picked the ${controls.tool} tool, though the step doesn’t give it`;
          const undos = tut().seen.undos;
          kit.press('KeyZ', { ctrlKey: true });
          if (tut().seen.undos !== undos) return 'Ctrl+Z worked, though the step doesn’t give it';
          if (!tb('Maps').classList.contains('tut-locked')) return 'the Maps button is not greyed out';
          tb('Maps').click();
          if (panelOpen('Maps')) return 'a greyed-out tool bar button opened its panel';
          // (time's pause is always to hand)
          if (tb('Toggle time').classList.contains('tut-locked')) return 'the pause button is greyed out';
          kit.press(keyOf('time'));
          if (!game.paused) return `${keyOf('time')} did not stop time mid-tour`;
          kit.press(keyOf('time'));
          // a menu's entries: none of them asked for
          const box = kit.spawn('crate', x0 + 3, 0.5);
          live(0.1);
          kit.down(box.center().x, box.center().y, 2);
          kit.up(box.center().x, box.center().y, 2);
          const entries = [...document.querySelectorAll<HTMLElement>('.ctx .ctx-item')];
          if (!entries.length) return 'right-click opened no menu';
          const open = entries.filter((e) => !e.classList.contains('disabled')).map((e) => e.textContent);
          controls.ui.closeContextMenu();
          if (open.length) return `menu entries the step isn't about are not greyed out: ${open.join(', ')}`;
          // what it asks for works: the dog, spawned with E
          click(tile('dog'));
          if (armed() !== 'dog') return 'the dog would not be picked';
          kit.press(keyOf('spawnRight'));
          if (!until('a-spawn', 1)) return 'the dog picked and E pressed, the step did not end';
          // × : everything back
          click('.tut-x');
          if (tut().active) return '× left the tour on';
          if (document.querySelector('.tut-locked')) return `still greyed out after the tour: ${[...document.querySelectorAll<HTMLElement>('.tut-locked')].map((e) => e.dataset.tutTitle ?? e.className).join(', ')}`;
          if (controls.tutorialBlocks) return 'the keys are still kept to the tour after it';
          if (tb('Maps').title.startsWith(LOCKED_NOTE)) return 'the Maps button kept its “not in this step” tooltip';
          click(shelf('Objects'));
          if (!document.querySelector('.items .item[data-cat="Objects"]')) return 'the Objects shelf would not open after the tour';
          click(shelf('Characters'));
          click(tile('cat'));
          if (armed() !== 'cat') return 'the cat would not be picked after the tour';
          kit.press(keyOf('spawnRight'));
          live(0.1);
          if (!cats()) return 'the cat would not spawn after the tour';
          controls.arm(null);
          kit.press(keyOf('xray'));
          if (!controls.xray) return 'x-ray’s key still did nothing after the tour';
          kit.press(keyOf('xray'));
          tb('Maps').click();
          if (!panelOpen('Maps')) return 'the Maps button still did nothing after the tour';
          ui().closeOverlays();
          kit.down(box.center().x, box.center().y, 2);
          kit.up(box.center().x, box.center().y, 2);
          const greyed = [...document.querySelectorAll<HTMLElement>('.ctx .ctx-hint')].filter((e) => e.textContent === LOCKED_NOTE).length;
          controls.ui.closeContextMenu();
          if (greyed) return 'menu entries still greyed out after the tour';
          return true;
        });
      } finally {
        controls.arm(null);
        controls.xray = false;
        tidy();
      }
    }],
  ];
}
