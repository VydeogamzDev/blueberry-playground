import type { Test, TestCtx } from './types';
import type { Game } from '../../world/Game';
import type { Controls } from '../../tools/Controls';
import type { Session } from '../../net/Session';
import type { Entity } from '../../world/Entity';
import type { Human } from '../../entities/Human';
import type { Firearm } from '../../entities/Firearm';
import type { Flask } from '../../entities/Flask';
import { PX, WORLD } from '../../engine/constants';
import { Liquid } from '../../systems/Liquids';
import { saveToString, loadFromString } from '../../world/SaveLoad';
import { ENDLESS, ENDLESS_REACH, LAB, mapFromJson, mapToJson, validateMap } from '../../world/Maps';

/** A second game's `window.bp` in an iframe, joining this one (see multiplayer.ts). */
interface Bp {
  game: Game;
  controls: Controls;
  ui: { session: Session };
  selftest?: unknown;
}

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

/** Waits up to `ms` for `fn` to come true (polling); returns whether it did. */
async function until(fn: () => boolean, ms: number): Promise<boolean> {
  const t0 = performance.now();
  while (performance.now() - t0 < ms) {
    if (fn()) return true;
    await sleep(20);
  }
  return fn();
}

export default function tests({ game, controls, kit, human }: TestCtx): Test[] {
  const r = game.renderer;
  const half = (e: Entity) => (e.parts[0].h * PX) / 2;
  const speed = (e: Entity) => Math.hypot(e.parts[0].vx, e.parts[0].vy);
  const torso = (h: Human) => h.limbs.get('upperTorso')!.part;
  /** The endless plate, from the lab, the camera at x. */
  const endless = (x = 0) => {
    kit.reset();
    game.setMap(ENDLESS);
    r.camX = x;
    r.camY = 2;
    r.zoom = r.targetZoom = 64;
    // (a frame: what follows the camera catches up with it)
    kit.advance(0);
  };
  /** An uncorked flask held still upside down at (x, y), pouring. */
  const pour = (id: string, x: number, y: number): Flask => {
    const f = kit.spawn(id, x, y, { angle: Math.PI }) as Flask;
    f.setFrozen(true);
    f.activate();
    return f;
  };
  /** The pixels drawn down a line into the floor slab at x (the camera there), as text to compare. */
  const floorColumn = (x: number): string => {
    r.camX = x;
    r.camY = 1;
    r.zoom = r.targetZoom = 64;
    // (a blast in an earlier test can leave the camera shaking, and its flash lit, until enough frames are drawn)
    const rr = r as unknown as { shakeAmt: number; lights: unknown[] };
    rr.shakeAmt = 0;
    rr.lights.length = 0;
    game.renderFrame(1 / 60, 1);
    const s = r.worldToScreen(x + 0.5, WORLD.floor);
    const d = r.dpr;
    const c = document.createElement('canvas');
    c.width = 1;
    c.height = 40;
    const g = c.getContext('2d')!;
    g.drawImage(r.canvas, Math.round(s.x * d), Math.round(s.y * d) + 1, 1, 40, 0, 0, 1, 40);
    return Array.from(g.getImageData(0, 0, 1, 40).data).join(',');
  };
  /** Stains within `d` m of x (their pixels' centres). */
  const stainsNear = (x: number, d: number, below = Infinity): number => {
    const st = game.stains.capture();
    let n = 0;
    for (let i = 0; i < st.n; i++) if (Math.abs((st.xy[i * 2] + 0.5) * PX - x) < d && (st.xy[i * 2 + 1] + 0.5) * PX < below) n++;
    return n;
  };
  /** The floor cells the puddles keep (the window on an endless map). */
  const cells = () => (game.puddles as unknown as { n: number }).n;

  return [
    ['extra: infinite: the endless plate: no walls near the middle, crates dropped far out land on its floor', () => {
      endless();
      if (game.map !== ENDLESS || !game.map.endless) return `playing on ${game.map.id}`;
      if (WORLD.left > -ENDLESS_REACH || WORLD.right < ENDLESS_REACH || WORLD.ceiling !== ENDLESS.height) return `the world spans ${WORLD.left}..${WORLD.right}, ceiling ${WORLD.ceiling}`;
      if (game.env.ground.length) return `${game.env.ground.length} pieces of ground on a bare plate`;
      const xs = [2000, -2000, 9000, ENDLESS_REACH - 50, -(ENDLESS_REACH - 50)];
      const crates = xs.map((x) => kit.spawn('crate', x, 3));
      // one thrown past where the lab's wall stands
      const thrown = kit.spawn('crate', 66, 2);
      thrown.parts[0].body.setLinvel({ x: 12, y: 2 }, true);
      kit.advance(2.5);
      for (let i = 0; i < xs.length; i++) {
        const c = crates[i];
        const p = c.parts[0];
        if (c.destroyed || Math.abs(p.x - xs[i]) > 0.05 || Math.abs(p.y - half(c)) > 0.05 || speed(c) > 0.05) {
          return `a crate dropped at x ${xs[i]} lies at (${p.x.toFixed(3)}, ${p.y.toFixed(3)}), moving ${speed(c).toFixed(3)} m/s (floor top + half: ${half(c).toFixed(3)})`;
        }
      }
      if (thrown.parts[0].x < 74) return `a crate thrown along from x 66 stopped at ${thrown.parts[0].x.toFixed(2)}: a wall in the way`;
      // and at the very end of it, walls
      const end = kit.spawn('crate', ENDLESS_REACH - 1.5, 0.45);
      end.parts[0].body.setLinvel({ x: 8, y: 0 }, true);
      kit.advance(2);
      if (end.parts[0].x > ENDLESS_REACH - half(end) + 0.05) return `a crate thrown at the far end went through it, to x ${end.parts[0].x.toFixed(2)}`;
      return true;
    }],
    ['extra: infinite: the camera goes anywhere along the plate, and its floor is drawn under it as at the middle', () => {
      kit.reset();
      const lab = floorColumn(0);
      r.camX = 900;
      r.clampCamera();
      if (r.camX > 81) return `in the lab the camera went out to x ${r.camX}`;
      endless();
      const middle = floorColumn(0);
      if (middle !== lab) return 'the plate’s floor is drawn differently from the lab’s';
      for (const x of [9000, -12000, ENDLESS_REACH - 20]) {
        r.camX = x;
        r.clampCamera();
        if (r.camX !== x) return `the camera sent to x ${x} was held at ${r.camX}`;
        if (floorColumn(x) !== middle) return `no floor drawn (or a different one) under the camera at x ${x}`;
      }
      // zoomed right out, the floor still reaches both sides of the view
      r.camX = 7000;
      r.zoom = r.targetZoom = 8;
      game.renderFrame(1 / 60, 1);
      const meshes = (game.env as unknown as { follow: { position: { x: number }; scale: { x: number } }[] }).follow;
      // (the whole canvas's width either side: more than the view)
      const reach = r.width / r.zoom;
      if (meshes.length < 3) return `${meshes.length} floor meshes follow the camera`;
      for (const m of meshes) {
        const [a, b] = [m.position.x - m.scale.x / 2, m.position.x + m.scale.x / 2];
        if (a > 7000 - reach || b < 7000 + reach) return `the floor drawn spans ${a.toFixed(0)}..${b.toFixed(0)}, the view at zoom 8 up to ${(7000 - reach).toFixed(0)}..${(7000 + reach).toFixed(0)}`;
      }
      return true;
    }],
    ['extra: infinite: a person stands and walks 15 km out as in the middle', () => {
      endless(15000);
      const people = [0, 15000].map((x) => kit.spawn('human', x, 0.95) as Human);
      kit.advance(3);
      for (const h of people) {
        if (h.state !== 'stand') return `at x ${torso(h).x.toFixed(0)} they did not stand (${h.status()})`;
      }
      const from = people.map((h) => torso(h).x);
      people.forEach((h, i) => h.goTo(from[i] + 6));
      kit.advance(7);
      for (let i = 0; i < people.length; i++) {
        const h = people[i];
        const went = torso(h).x - from[i];
        if (h.state !== 'stand' || went < 5 || went > 7) return `sent 6 m along from x ${from[i].toFixed(0)}, they went ${went.toFixed(2)} m (${h.status()})`;
      }
      return true;
    }],
    ['extra: infinite: 4 km out a gun fires, blood stains the floor, liquid pools, oil and crates burn', () => {
      const X = 4000;
      endless(X);
      const h = kit.spawn('human', X + 2, 0.95) as Human;
      const oil = pour('flask-oil', X - 6, 1.8);
      kit.advance(1.5);
      const g = kit.spawn('pistol', X - 0.5, torso(h).y) as Firearm;
      g.setFrozen(true);
      kit.advance(0.05);
      const blood = h.blood;
      g.fire();
      kit.advance(3);
      if (!(h.blood < blood)) return 'the shot drew no blood';
      const floorStains = stainsNear(X + 2, 10, 0.2);
      if (floorStains < 3) return `only ${floorStains} stains on the floor round the person shot`;
      if (game.puddles.kindAt(X - 6) !== Liquid.Oil || game.puddles.amountAt(X - 6) < 0.1) return `no oil pooled under the flask (${game.puddles.amountAt(X - 6).toFixed(2)} px)`;
      game.remove(oil);
      const crate = kit.spawn('crate', X - 6, 0.45);
      kit.advance(0.5);
      game.fire.ignite(crate.parts[0], 1);
      kit.advance(2);
      if (!game.puddles.burningAt(X - 6) || !game.puddles.burningCells) return 'the oil under a burning crate did not catch';
      if (!(crate.parts[0].burning > 0) || !game.fire.count) return 'the crate is not burning';
      return true;
    }],
    ['extra: infinite: puddles keep to a stretch round the camera, the same size however far it goes', () => {
      endless(0);
      const n0 = cells();
      if (n0 * PX > 2048) return `the puddles keep ${n0} cells (${(n0 * PX).toFixed(0)} m of floor)`;
      pour('flask-water', 1, 1.8);
      kit.advance(3);
      const before = game.puddles.total;
      if (game.puddles.amountAt(1) <= 0.1) return 'no puddle under the flask at the middle';
      // the camera moves on 6 km: what was left behind is gone, and the cells came along
      r.camX = 6000;
      kit.advance(0);
      if (cells() !== n0) return `the puddles keep ${cells()} cells out at 6 km (${n0} at the middle)`;
      if (game.puddles.total > 0 || game.puddles.amountAt(1) > 0) return `${game.puddles.total.toFixed(1)} px² of liquid kept 6 km behind the camera (${before.toFixed(1)} before)`;
      pour('flask-water', 6001, 1.8);
      // (and one poured beyond the stretch kept: it stains, it doesn't pool)
      pour('flask-water', 9001, 1.8);
      kit.advance(3);
      if (game.puddles.amountAt(6001) <= 0.1) return 'no puddle under a flask poured 6 km out';
      if (game.puddles.amountAt(9001) > 0) return 'liquid pooled 3 km from the camera, outside the cells kept';
      // captured and put back (undo, a save) where it was
      const s = game.puddles.capture();
      game.puddles.clear();
      game.puddles.restore(s);
      if (game.puddles.amountAt(6001) <= 0.1) return 'a puddle 6 km out did not come back from a capture';
      return true;
    }],
    ['extra: infinite: save and load bring the plate back with what was far out on it', () => {
      const X = 7000;
      endless(X);
      const c = kit.spawn('crate', X, 0.45);
      pour('flask-water', X + 1.5, 1.8);
      kit.advance(3);
      // a stain 7 km out: further than 16 bits of pixels reach
      game.stains.add(X - 1, 0.02, 0.6, 0, 0);
      const text = saveToString(game);
      game.setMap(LAB);
      r.camX = 0;
      loadFromString(game, text);
      if (game.map !== ENDLESS) return `loaded onto ${game.map.name}`;
      if (WORLD.right !== ENDLESS_REACH) return `the world came back as ${WORLD.left}..${WORLD.right}`;
      if (Math.abs(r.camX - X) > 0.01) return `the camera came back at x ${r.camX.toFixed(2)}, saved at ${X}`;
      const back = game.entities.find((e) => e.def.id === 'crate');
      if (!back || Math.abs(back.parts[0].x - c.parts[0].x) > 0.02) return `the crate came back at x ${back?.parts[0].x.toFixed(3)}`;
      if (game.puddles.amountAt(X + 1.5) <= 0.1) return 'the puddle 7 km out did not come back';
      if (!stainsNear(X - 1, 0.1)) return 'the stain 7 km out did not come back';
      // the map's own file reads back as the built-in plate (it can't be made into anything else)
      if (mapFromJson(mapToJson(ENDLESS)) !== ENDLESS) return 'the exported plate did not read back as the built-in one';
      if (validateMap({ ...ENDLESS, width: 140, terrain: [{ pts: [[0, 0], [2, 0], [1, 1]] }] }) !== ENDLESS) return 'a changed copy of the plate was taken for a map of its own';
      return true;
    }],
    ['extra: infinite: switching back to the lab brings back its walls, floor and puddles', () => {
      endless(3000);
      pour('flask-water', 3001, 1.8);
      kit.advance(2);
      game.setMap(LAB);
      if (WORLD.left !== -70 || WORLD.right !== 70 || WORLD.ceiling !== 48) return `the world spans ${WORLD.left}..${WORLD.right}, ceiling ${WORLD.ceiling}`;
      if (game.env.colliders.length !== 4) return `${game.env.colliders.length} colliders in the lab`;
      if ((game.env as unknown as { follow: unknown[] }).follow.length) return 'the lab’s floor still follows the camera';
      if (cells() !== Math.round(140 / PX)) return `the lab's puddles keep ${cells()} cells`;
      if (game.puddles.total > 0) return 'liquid came along to the lab';
      r.camX = 500;
      r.clampCamera();
      if (r.camX > 81) return `the camera went out to x ${r.camX} in the lab`;
      const c = kit.spawn('crate', 68.5, 2);
      c.parts[0].body.setLinvel({ x: 8, y: 0 }, true);
      kit.advance(2);
      if (c.parts[0].x > 70 - half(c) + 0.05) return `a crate thrown at the lab's right wall ended up at x ${c.parts[0].x.toFixed(2)}`;
      if (floorColumn(0) !== floorColumn(60)) return 'the lab’s floor is not drawn the same along it';
      return true;
    }],
    ['extra: infinite: a step costs about the same 12 km out as in the middle', () => {
      /** Milliseconds for 2 s of people walking among falling crates at x0. */
      const run = (x0: number): number => {
        endless(x0);
        const people = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => human(x0 - 6 + i * 1.6));
        for (let i = 0; i < 16; i++) kit.spawn('crate', x0 - 6 + (i % 8) * 1.6, 4 + Math.floor(i / 8) * 1.2);
        kit.advance(1);
        people.forEach((h, i) => h.goTo(x0 + (i % 2 ? 9 : -9)));
        game.resetStep();
        const t0 = performance.now();
        kit.advance(2);
        return performance.now() - t0;
      };
      const near: number[] = [];
      const far: number[] = [];
      for (let k = 0; k < 2; k++) {
        near.push(run(0));
        far.push(run(12000));
      }
      const a = Math.min(...near);
      const b = Math.min(...far);
      if (b > a * 1.5 + 30) return `2 s of the scene took ${b.toFixed(0)} ms 12 km out, ${a.toFixed(0)} ms in the middle`;
      return true;
    }],
    ['extra: infinite: a guest joining a host on the endless plate gets it, and what is far out on it', () => kit.still(async () => {
      // (a file:// page's iframe guest can't be reached: see multiplayer.ts)
      if (location.protocol === 'file:') return true;
      const X = 5000;
      endless(X);
      kit.spawn('crate', X, 0.45);
      pour('flask-water', X + 1.5, 1.8);
      kit.advance(3);
      const frame = document.createElement('iframe');
      frame.src = location.href;
      frame.style.cssText = 'position:fixed;left:0;top:0;width:480px;height:320px;border:0;opacity:0.02;pointer-events:none;z-index:1';
      document.body.appendChild(frame);
      const session = (window as unknown as { bp: Bp }).bp.ui.session;
      try {
        const bp = () => (frame.contentWindow as unknown as { bp?: Bp } | null)?.bp;
        if (!(await until(() => !!bp()?.selftest, 90000))) return 'the second game did not start';
        const g = bp()!;
        const code = await session.hostGame('local', 'Host');
        await g.ui.session.join('local', code, 'Guest');
        if (!(await until(() => (g.ui.session.guest?.you ?? 0) > 0 && session.players.length === 2, 5000))) return 'the guest never got the scene';
        const gg = g.game;
        if (gg.map.id !== 'endless' || !gg.map.endless) return `the guest is on ${gg.map.id}`;
        const crate = gg.entities.find((e) => e.def.id === 'crate' && !e.destroyed);
        if (!crate || Math.abs(crate.parts[0].x - X) > 0.05) return `the guest's crate is at x ${crate?.parts[0].x.toFixed(2)}, the host's at ${X}`;
        if (Math.abs(gg.renderer.camX - X) > 0.5) return `the guest's camera came in at x ${gg.renderer.camX.toFixed(1)}`;
        if (gg.puddles.amountAt(X + 1.5) <= 0.1) return 'the guest has no puddle 5 km out';
        gg.renderer.camX = 12000;
        gg.renderer.clampCamera();
        if (gg.renderer.camX !== 12000) return `the guest's camera is held at x ${gg.renderer.camX} on the plate`;
        // a guest's switch of maps, to the lab and back, is the host's (and so everyone's)
        g.controls.switchMap(LAB);
        if (!(await until(() => game.map === LAB, 2000))) return 'the guest’s switch to the lab didn’t happen for the host';
        session.host!.tick(true);
        if (!(await until(() => gg.map.id === 'lab', 2000))) return 'the guest isn’t shown the lab after switching';
        g.controls.switchMap(ENDLESS);
        if (!(await until(() => game.map === ENDLESS, 2000))) return `the guest’s switch back to the plate didn’t happen for the host (on ${game.map.id})`;
        session.host!.tick(true);
        if (!(await until(() => gg.map.id === 'endless', 2000))) return 'the guest isn’t shown the plate after switching back';
        return true;
      } finally {
        session.leave();
        frame.remove();
      }
    })],
  ];
}
