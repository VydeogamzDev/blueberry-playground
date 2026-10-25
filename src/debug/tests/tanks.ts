import type { Test, TestCtx } from './types';
import type { Car } from '../../entities/Car';
import type { Tank } from '../../entities/Tank';
import type { Entity } from '../../world/Entity';
import type { ActionId } from '../../tools/Bindings';
import { saveToString, loadFromString } from '../../world/SaveLoad';
import { PX } from '../../engine/constants';
import { wrapAngle } from '../../engine/math';
import { stillUp } from '../../systems/Fighting';

/** Driving selected vehicles with the arrow keys, laying a tank's gun with them, and the three real tanks. */
export default function tests({ game, controls, kit, human }: TestCtx): Test[] {
  const r = game.renderer;
  /** Opens `e`'s context menu and picks the item `label` (ticked or not); false if there's none. */
  const menu = (e: Entity, label: string): boolean => {
    const p = e.parts.find((q) => !q.destroyed)!;
    kit.down(p.x, p.y, 2);
    kit.up(p.x, p.y, 2);
    const item = [...document.querySelectorAll<HTMLElement>('.ctx-item')].find((d) => (d.textContent ?? '').replace(/^[☑☐] /, '').startsWith(label));
    if (!item) {
      controls.ui.closeContextMenu();
      return false;
    }
    item.dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true }));
    return true;
  };
  const key = (id: ActionId) => controls.bindings.keys(id)[0];
  const deg = (rad: number) => (rad * 180) / Math.PI;
  /** Frames as the game runs them: a step or two and a frame each (the camera moves in the frames). */
  const frames = (n: number) => {
    for (let i = 0; i < n; i++) kit.advance(1 / 60);
  };
  /** Runs `fn`, then lets go of the vehicle keys and puts the camera back as it was. */
  const tidy = (fn: () => string | true): string | true => {
    const cam = { x: r.camX, y: r.camY, zoom: r.zoom };
    try {
      return fn();
    } finally {
      for (const id of ['driveLeft', 'driveRight', 'aimUp', 'aimDown'] as ActionId[]) kit.key(key(id), false);
      game.paused = false;
      game.sound.tap = null;
      r.camX = cam.x;
      r.camY = cam.y;
      r.zoom = r.targetZoom = cam.zoom;
    }
  };
  /** The barrel's angle to the hull (degrees, up positive for a tank facing right). */
  const laidAt = (t: Tank) => deg(wrapAngle(t.barrel.a - t.body.a));
  /** The newest shell in flight. */
  const newestShell = (): Entity | undefined => [...game.entities].reverse().find((e) => e.def.id === 'tank-shell' && !e.destroyed);

  return [
    ['extra: tanks: a selected car drives right with the drive key held (the camera doesn\'t pan), slows when it\'s let go, and backs up with the other', () => tidy(() => {
      kit.reset();
      const right = key('driveRight');
      const left = key('driveLeft');
      if (!right || !left) return 'the drive keys are unbound';
      const c = kit.spawn('car', -20, 0.6) as Car;
      kit.advance(1);
      controls.selection = new Set([c]);
      kit.view(c.body.x, c.body.y + 1);
      const cam0 = r.camX;
      const x0 = c.body.x;
      kit.key(right, true);
      frames(45);
      const went = c.body.x - x0;
      const v = c.body.vx;
      const panned = r.camX - cam0;
      if (went < 0.5 || v < 2) return `0.75 s of ${right} with the car selected: it went ${went.toFixed(2)} m and is at ${v.toFixed(2)} m/s`;
      // (the camera may ease after it, never ahead of it as the pan would: 10 m in 0.75 s)
      if (panned > went + 0.05 || panned < -0.05) return `the camera moved ${panned.toFixed(2)} m while the car went ${went.toFixed(2)} m: the drive key panned it`;
      kit.key(right, false);
      kit.advance(0.5);
      if (c.driving) return 'still driving half a second after the key was let go';
      if (c.body.vx > v - 0.6) return `let go at ${v.toFixed(2)} m/s, still at ${c.body.vx.toFixed(2)} m/s half a second later`;
      kit.advance(2.5);
      const xb = c.body.x;
      kit.key(left, true);
      kit.advance(1);
      kit.key(left, false);
      if (c.body.x > xb - 0.5) return `1 s of ${left}: it went ${(c.body.x - xb).toFixed(2)} m (not backwards)`;
      if (c.flipped || Math.abs(c.body.a) > 0.2) return `backing up, it turned round (facing ${c.flipped ? 'left' : 'right'}, tilted ${c.body.a.toFixed(2)} rad)`;
      return true;
    })],
    ['extra: tanks: with nothing selected the arrows pan the camera and drive nothing; a selected car leaves the aim keys to the camera', () => tidy(() => {
      kit.reset();
      const c = kit.spawn('car', -20, 0.6) as Car;
      kit.advance(1);
      kit.view(0, 4);
      const x0 = c.body.x;
      const cam0 = { x: r.camX, y: r.camY };
      kit.key(key('driveRight'), true);
      frames(20);
      kit.key(key('driveRight'), false);
      if (r.camX - cam0.x < 2) return `20 frames of ${key('driveRight')} with nothing selected panned the camera ${(r.camX - cam0.x).toFixed(2)} m (the pan: 4.7 m)`;
      if (Math.abs(c.body.x - x0) > 0.05 || c.driving) return `the car, not selected, moved ${(c.body.x - x0).toFixed(2)} m`;
      // (no tank among the selection: the aim keys are the camera's)
      controls.selection = new Set([c]);
      kit.key(key('aimUp'), true);
      frames(10);
      kit.key(key('aimUp'), false);
      if (r.camY - cam0.y < 1) return `10 frames of ${key('aimUp')} with a car selected panned the camera up ${(r.camY - cam0.y).toFixed(2)} m`;
      return true;
    })],
    ['extra: tanks: with time paused the drive key does nothing (not even pan) until time runs again', () => tidy(() => {
      kit.reset();
      const c = kit.spawn('car', -20, 0.6) as Car;
      kit.advance(1);
      controls.selection = new Set([c]);
      kit.view(c.body.x, c.body.y + 1);
      const cam0 = r.camX;
      const x0 = c.body.x;
      game.paused = true;
      kit.key(key('driveRight'), true);
      // (paused, the game draws frames and takes no steps)
      for (let i = 0; i < 30; i++) game.renderFrame(1 / 60, 1);
      if (c.driving || Math.abs(c.body.x - x0) > 0.01) return `paused, the car moved ${(c.body.x - x0).toFixed(3)} m (driving: ${c.driving})`;
      if (Math.abs(r.camX - cam0) > 0.01) return `paused, the drive key panned the camera ${(r.camX - cam0).toFixed(2)} m`;
      game.paused = false;
      kit.advance(0.6);
      if (c.body.x - x0 < 0.2) return `time running again with the key held, the car went only ${(c.body.x - x0).toFixed(2)} m in 0.6 s`;
      return true;
    })],
    ['extra: tanks: steered once and never again (a guest gone quiet), a vehicle soon lets go', () => {
      kit.reset();
      const c = kit.spawn('car', -20, 0.6) as Car;
      kit.advance(1);
      c.steer(1);
      kit.advance(0.2);
      if (!c.driving || c.body.vx < 0.3) return `steered right, after 0.2 s it isn't driving (${c.body.vx.toFixed(2)} m/s)`;
      kit.advance(0.6);
      if (c.driving) return 'steered once, still driving 0.8 s later';
      return true;
    }],
    ['extra: tanks: the aim keys lay a selected tank\'s barrel smoothly within its limits, whirring as it moves, and the shell leaves along it', () => tidy(() => {
      kit.reset();
      const up = key('aimUp');
      const down = key('aimDown');
      const t = kit.spawn('tank-abrams', -30, 0.8) as Tank;
      kit.advance(1.5);
      controls.selection = new Set([t]);
      kit.view(t.body.x, t.body.y + 1);
      const [lo, hi] = t.gun.limits;
      const whirs: string[] = [];
      game.sound.tap = { play: () => {}, hold: (_o, k) => whirs.push(k) };
      const servo = () => whirs.includes('machine/turret_loop');
      const e0 = t.elevation;
      const camY0 = r.camY;
      kit.key(up, true);
      kit.advance(0.4);
      const e1 = t.elevation;
      if (e1 - e0 < 3 || e1 - e0 > 9) return `0.4 s of ${up}: the barrel went from ${e0}° to ${e1.toFixed(1)}° (not smoothly up)`;
      if (Math.abs(r.camY - camY0) > 0.05) return `${up} with a tank selected panned the camera ${(r.camY - camY0).toFixed(2)} m`;
      if (!servo()) return 'the barrel moved without a sound';
      kit.advance(2);
      if (Math.abs(t.elevation - hi) > 0.01) return `${up} held 2.4 s: the barrel stopped at ${t.elevation.toFixed(1)}° (the gun's limit: ${hi}°)`;
      kit.key(up, false);
      kit.advance(0.2);
      whirs.length = 0;
      kit.advance(0.3);
      if (servo()) return 'the elevation drive kept whirring with the barrel still';
      kit.key(down, true);
      kit.advance(0.6);
      kit.key(down, false);
      const laid = t.elevation;
      if (laid > hi - 6 || laid < hi - 12) return `0.6 s of ${down} from ${hi}°: laid at ${laid.toFixed(1)}°`;
      kit.advance(0.5);
      if (Math.abs(laidAt(t) - laid) > 1.5) return `laid at ${laid.toFixed(1)}°, the barrel stands at ${laidAt(t).toFixed(1)}° to the hull`;
      const shots = t.shots;
      t.fire();
      const s = newestShell();
      if (t.shots !== shots + 1 || !s) return 'Fire made no shell';
      const v = s.parts[0].body.linvel();
      const along = deg(Math.atan2(v.y, v.x));
      const barrel = deg(t.barrel.a);
      if (Math.abs(along - barrel) > 1) return `the shell left at ${along.toFixed(1)}° with the barrel at ${barrel.toFixed(1)}°`;
      if (Math.abs(along - (laid + deg(t.body.a))) > 2) return `the shell left at ${along.toFixed(1)}°, laid at ${laid.toFixed(1)}° on a hull at ${deg(t.body.a).toFixed(1)}°`;
      kit.key(down, true);
      kit.advance(2.5);
      kit.key(down, false);
      if (Math.abs(t.elevation - lo) > 0.01) return `${down} held 2.5 s: the barrel stopped at ${t.elevation.toFixed(1)}° (the gun's limit: ${lo}°)`;
      return true;
    })],
    ['extra: tanks: the Abrams, the ZTZ-99A and the Leopard 2A7 sit on their tracks, drive and fire; the Abrams pulls away fastest, the ZTZ-99A reloads fastest, the Leopard\'s shell is fastest', () => tidy(() => {
      const right = key('driveRight');
      const got: Record<string, { pull: number; shots: number; muzzle: number }> = {};
      const ex = game.explosions;
      const explode = ex.explode;
      try {
        for (const id of ['tank-abrams', 'tank-ztz99a', 'tank-leopard']) {
          kit.reset();
          const t = kit.spawn(id, -45, 0.8) as Tank;
          kit.advance(1);
          const b = t.body;
          const R = t.cfg.wheelR * PX;
          const down = t.wheels.filter((w) => w.y - R < 0.03).length;
          if (down < 5) return `${id}: only ${down} of its ${t.wheels.length} wheels on the floor (lowest ${Math.min(...t.wheels.map((w) => w.y - R)).toFixed(2)} m up)`;
          if (Math.abs(b.a) > 0.04) return `${id}: sits tilted ${b.a.toFixed(3)} rad`;
          if (Math.hypot(b.vx, b.vy) > 0.05) return `${id}: still moving at ${Math.hypot(b.vx, b.vy).toFixed(2)} m/s after landing`;
          // parked, fired as fast as it reloads for 2.4 s, the barrel low (the shells land 40 to 60 m off)
          t.elevation = 3;
          kit.advance(0.3);
          const xf = b.x;
          const booms: number[] = [];
          ex.explode = (x, y, o, delay) => {
            booms.push(x);
            explode.call(ex, x, y, o, delay);
          };
          let muzzle = 0;
          const shots0 = t.shots;
          game.advance(2.4, () => {
            const n = t.shots;
            t.fire();
            if (t.shots === n || muzzle) return;
            const v = newestShell()?.parts[0].body.linvel();
            if (v) muzzle = Math.hypot(v.x - b.vx, v.y - b.vy);
          });
          ex.explode = explode;
          if (!muzzle) return `${id}: fired no shell`;
          const ahead = booms.length ? Math.min(...booms) - xf : 0;
          if (ahead < 8) return `${id}: ${booms.length ? `its first shell went off ${ahead.toFixed(1)} m ahead` : 'no shell went off'}`;
          if (Math.abs(b.x - xf) > 1) return `${id}: its shots shoved it ${(b.x - xf).toFixed(2)} m`;
          if (t.wrecked || b.hp < 90) return `${id}: hurt by its own shots (the hull at ${b.hp.toFixed(0)} hp)`;
          // then driven off with the key: how fast it's going 1.2 s later
          controls.selection = new Set([t]);
          const x0 = b.x;
          let tilt = 0;
          kit.key(right, true);
          game.advance(1.2, () => (tilt = Math.max(tilt, Math.abs(b.a))));
          kit.key(right, false);
          const pull = b.vx;
          if (b.x - x0 < 1.5) return `${id}: drove only ${(b.x - x0).toFixed(2)} m in 1.2 s (top speed ${t.topSpeed} m/s)`;
          if (tilt > 0.15) return `${id}: rocked ${tilt.toFixed(2)} rad pulling away`;
          got[id] = { pull, shots: t.shots - shots0, muzzle };
        }
      } finally {
        ex.explode = explode;
      }
      const [a, z, l] = [got['tank-abrams'], got['tank-ztz99a'], got['tank-leopard']];
      const show = (k: 'pull' | 'shots' | 'muzzle') => `Abrams ${a[k].toFixed(1)}, ZTZ-99A ${z[k].toFixed(1)}, Leopard ${l[k].toFixed(1)}`;
      if (a.pull < z.pull * 1.1 || a.pull < l.pull * 1.1) return `speed 1.2 s after pulling away (m/s): ${show('pull')}; the Abrams isn't clearly the quickest`;
      if (z.shots <= a.shots || z.shots <= l.shots) return `shots in 2.4 s: ${show('shots')}; the ZTZ-99A doesn't reload fastest`;
      if (l.muzzle < a.muzzle * 1.1 || l.muzzle < z.muzzle * 1.1) return `muzzle speeds (m/s): ${show('muzzle')}; the Leopard's isn't clearly the fastest`;
      return true;
    })],
    ['extra: tanks: a barrel laid with the aim keys keeps its elevation through save and load; the menu offers only what the gun reaches', () => tidy(() => {
      kit.reset();
      const t = kit.spawn('tank-leopard', 0, 0.8) as Tank;
      kit.advance(1);
      controls.selection = new Set([t]);
      kit.key(key('aimDown'), true);
      kit.advance(0.6);
      kit.key(key('aimDown'), false);
      const laid = t.elevation;
      if (laid > 0) return `0.6 s of ${key('aimDown')} from 5°: laid at ${laid.toFixed(1)}° (not below level)`;
      kit.advance(0.3);
      loadFromString(game, saveToString(game));
      const t2 = game.entities.find((e) => e.def.id === 'tank-leopard') as Tank | undefined;
      if (!t2) return 'no Leopard after loading';
      if (Math.abs(t2.elevation - laid) > 0.01) return `laid at ${laid.toFixed(2)}°, it came back laid at ${t2.elevation.toFixed(2)}°`;
      kit.advance(0.5);
      if (Math.abs(laidAt(t2) - laid) > 1.5) return `after loading, the barrel stands at ${laidAt(t2).toFixed(1)}° to the hull (laid at ${laid.toFixed(1)}°)`;
      const labels = t2.contextActions().map((a) => a.label).filter((s) => s.startsWith('Barrel'));
      if (labels.includes('Barrel 35°') || !labels.includes('Barrel 20°') || !labels.includes('Barrel −5°')) return `the Leopard's menu offers ${labels.join(', ')} (its gun: −9° to 20°)`;
      return true;
    })],
    ['extra: tanks: on a side, a tank drives in on an enemy it sees far off, lays its gun on them and shells them', () => tidy(() => {
      kit.reset();
      const t = kit.spawn('tank-abrams', -40, 0.8) as Tank;
      const foe = human(25, { flip: true });
      kit.advance(1);
      foe.setTeam('blue');
      t.setTeam('red');
      const x0 = t.body.x;
      let down = -1;
      for (let s = 0; s < 14 && down < 0; s++) {
        kit.advance(1);
        if (foe.destroyed || !stillUp(foe)) down = s + 1;
      }
      if (t.body.x - x0 < 5) return `65 m from its enemy, it drove ${(t.body.x - x0).toFixed(1)} m in`;
      if (!t.shots) return `it never fired (its foe: ${t.foe ? 'the enemy' : 'nobody'}, laid at ${t.elevation.toFixed(1)}°)`;
      if (down < 0) return `${t.shots} shells, and the enemy is still up`;
      // (and it stopped short, at its range)
      const gap = Math.abs((foe.destroyed ? 25 : foe.center().x) - t.body.x);
      if (gap < 10) return `it drove right up to the enemy (${gap.toFixed(1)} m off)`;
      return true;
    })],
    ['extra: tanks: a tank on a side holds its fire while one of its own side is in the line of fire, and fires once they\'re out of it', () => tidy(() => {
      kit.reset();
      const t = kit.spawn('tank-leopard', -20, 0.8) as Tank;
      const foe = human(12, { flip: true });
      const friend = human(-4);
      kit.advance(1);
      // (held where they stand: they'd only go for each other)
      foe.setFrozen(true);
      friend.setFrozen(true);
      foe.setTeam('blue');
      friend.setTeam('red');
      t.setTeam('red');
      kit.advance(4);
      if (t.foe !== foe) return `it went for ${t.foe ? 'someone else' : 'nobody'}`;
      if (t.shots) return `it fired ${t.shots} shells through its own side`;
      game.remove(friend);
      kit.advance(4);
      if (!t.shots) return 'the line of fire clear, it never fired';
      return true;
    })],
    ['extra: tanks: a tank on a side driving in on an enemy stops short of one of its own side in its way, rather than run them over', () => tidy(() => {
      kit.reset();
      const t = kit.spawn('tank-abrams', -34, 0.8) as Tank;
      const foe = human(30, { flip: true });
      const friend = human(-22);
      kit.advance(1);
      foe.setFrozen(true);
      friend.setFrozen(true);
      foe.setTeam('blue');
      friend.setTeam('red');
      t.setTeam('red');
      let hurt = 0;
      const d = friend.damage.bind(friend);
      friend.damage = (...x) => {
        hurt += x[1];
        return d(...x);
      };
      kit.advance(5);
      const front = t.body.x + (t.body.w * PX) / 2;
      if (t.body.x < -33) return 'it never drove in on the enemy';
      if (hurt > 1 || front > friend.center().x - 0.5) return `it drove up to x ${front.toFixed(1)} (its friend at ${friend.center().x.toFixed(1)}), hurting them ${hurt.toFixed(0)}`;
      return true;
    })],
    ['extra: tanks: a tank on a side turns round for an enemy behind it, and fires on them', () => tidy(() => {
      kit.reset();
      const t = kit.spawn('tank-ztz99a', 0, 0.8) as Tank;
      const foe = human(-28);
      kit.advance(1);
      foe.setFrozen(true);
      foe.setTeam('yellow');
      t.setTeam('green');
      const tank = () => game.entities.find((e): e is Tank => e.def.id === 'tank-ztz99a' && !e.destroyed);
      let turned = -1;
      for (let s = 0; s < 6 && turned < 0; s++) {
        kit.advance(0.5);
        if (tank()?.flipped) turned = (s + 1) * 0.5;
      }
      const u = tank();
      if (!u || turned < 0) return 'it never turned round';
      if (u.team !== 'green') return `turned round, it's on ${u.team ?? 'no side'}`;
      if (Math.abs(u.body.x - t.body.x) > 1.5) return `turning round moved it ${(u.body.x - t.body.x).toFixed(2)} m`;
      kit.advance(5);
      if (!u.shots) return `turned round after ${turned} s, it never fired`;
      return true;
    })],
    ['extra: tanks: Team in a tank\'s menu puts it on a side with a stripe of their colour; it stays on it through save and load', () => tidy(() => {
      kit.reset();
      const t = kit.spawn('tank-abrams', 0, 0.8) as Tank;
      kit.advance(1);
      controls.selection.clear();
      controls.selection.add(t);
      const plain = t.body.art;
      if (!menu(t, 'Team: Green')) return 'no Team: Green in a tank\'s menu';
      controls.selection.clear();
      if (t.team !== 'green') return `Team: Green put it on ${t.team ?? 'no side'}`;
      if (t.body.art === plain) return 'on a side, it wears no stripe';
      loadFromString(game, saveToString(game));
      const t2 = game.entities.find((e): e is Tank => e.def.id === 'tank-abrams');
      if (!t2 || t2.team !== 'green') return `after loading it's on ${t2?.team ?? 'no side'}`;
      if (t2.body.art === t2.cfg.body()) return 'after loading, its stripe is gone';
      t2.setTeam(null);
      if (t2.body.art !== t2.cfg.body()) return 'on no side, it still wears a stripe';
      return true;
    })],
  ];
}
