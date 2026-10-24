import type { Test, TestCtx } from './types';
import type { Human } from '../../entities/Human';
import type { Firearm } from '../../entities/Firearm';
import type { Flask } from '../../entities/Flask';
import type { Entity } from '../../world/Entity';
import { PX, WORLD } from '../../engine/constants';
import { PK } from '../../systems/Particles';
import { saveToString, loadFromString } from '../../world/SaveLoad';
import { BUILTIN_MAPS, LAB, builtinMap, mapFromJson, mapToJson, sameMap, validateMap, type MapSpec, type TerrainMat, type TerrainPiece } from '../../world/Maps';
import { TerrainTool } from '../../tools/TerrainTool';

export default function tests({ game, controls, kit }: TestCtx): Test[] {
  /** The top of the ground at x (the floor where there's none). */
  const top = (x: number) => game.env.groundAt(x, WORLD.ceiling);
  const speed = (e: Entity) => Math.hypot(e.parts[0].vx, e.parts[0].vy);
  const half = (e: Entity) => (e.parts[0].h * PX) / 2;
  const box = (x0: number, y0: number, x1: number, y1: number, mat?: TerrainMat): TerrainPiece => ({ pts: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], mat });
  /** A map of the player's own, made safe as one read from a file is. */
  const custom = (terrain: TerrainPiece[], o: Partial<MapSpec> = {}): MapSpec =>
    validateMap({ id: 'custom:test', name: 'Test map', width: 140, height: 48, theme: 'concrete', terrain, ...o })!;
  /** The first spot from the left (well clear of crates thrown at the walls) where the ground stands flat for ±0.6 m above the floor; null if there's none. */
  const flatSpot = (): number | null => {
    for (let x = WORLD.left + 12; x < WORLD.right - 12; x += 0.5) {
      const g = top(x);
      // (not under the sea: a crate floats up out of it)
      if (game.water.levelAt(x) !== null) continue;
      if (g > 0.3 && Math.abs(top(x - 0.6) - g) < 0.02 && Math.abs(top(x + 0.6) - g) < 0.02) return x;
    }
    return null;
  };

  return [
    ['extra: maps: each built-in map switches: its bounds, crates stop at its end walls, things rest on its ground', () => {
      for (const m of BUILTIN_MAPS) {
        // (the Void has no floor to throw crates along: see the world tests)
        if (m.theme === 'void') continue;
        kit.reset();
        game.setMap(m);
        if (game.map !== m) return `${m.id}: playing on ${game.map.id}`;
        if (WORLD.left !== -m.width / 2 || WORLD.right !== m.width / 2 || WORLD.ceiling !== m.height) {
          return `${m.id}: the world spans ${WORLD.left}..${WORLD.right}, ceiling ${WORLD.ceiling}`;
        }
        if (game.env.ground.length !== m.terrain.length) return `${m.id}: ${game.env.ground.length} of ${m.terrain.length} pieces of ground built`;
        // a crate thrown at each end wall stops against it
        const thrown = [-1, 1].map((side) => {
          const x = side * (m.width / 2 - 1.5);
          const c = kit.spawn('crate', x, top(x) + 2);
          c.parts[0].body.setLinvel({ x: side * 8, y: 0 }, true);
          return { side, c };
        });
        const at = flatSpot();
        const on = at === null ? null : kit.spawn('crate', at, top(at) + 1.5);
        kit.advance(2.5);
        for (const { side, c } of thrown) {
          const p = c.parts[0];
          const wall = side < 0 ? 'left' : 'right';
          if (c.destroyed || Math.abs(p.x) > m.width / 2 - half(c) + 0.05) return `${m.id}: a crate thrown at the ${wall} wall ended up at x ${p.x.toFixed(2)}`;
          if (p.y < top(p.x) + half(c) - 0.1) return `${m.id}: a crate by the ${wall} wall sank to y ${p.y.toFixed(2)} (ground at ${top(p.x).toFixed(2)})`;
        }
        if (on && at !== null) {
          const want = top(at) + half(on);
          const p = on.parts[0];
          if (Math.abs(p.y - want) > 0.08 || speed(on) > 0.1) {
            return `${m.id}: a crate dropped on its ground at x ${at} rests at y ${p.y.toFixed(3)} (on top: ${want.toFixed(3)}), moving ${speed(on).toFixed(2)} m/s`;
          }
        }
      }
      return true;
    }],
    ['extra: maps: a person stands on the hills and walks up them', () => {
      kit.reset();
      game.setMap(builtinMap('hills')!);
      // a hillside: rising, no steeper than 1 in 5, for the next 7 m
      let x0 = NaN;
      for (let x = WORLD.left + 4; x < 0 && Number.isNaN(x0); x += 0.5) {
        if (top(x) < 0.6 || top(x + 0.5) - top(x) < 0.015) continue;
        let ok = true;
        for (let s = 0; s < 7 && ok; s += 0.5) {
          const d = top(x + s + 0.5) - top(x + s);
          ok = d > -0.01 && d < 0.1;
        }
        if (ok) x0 = x;
      }
      if (Number.isNaN(x0)) return 'found no hillside to walk up';
      const h = kit.spawn('human', x0, top(x0) + 0.95) as Human;
      kit.advance(2.5);
      const head = h.limbs.get('head')!.part;
      const torso = h.limbs.get('upperTorso')!.part;
      if (h.state !== 'stand' || head.y - top(head.x) < 1.35) return `did not stand on the hillside at x ${x0} (${h.status()}, head ${(head.y - top(head.x)).toFixed(2)} m up)`;
      const from = torso.x;
      h.goTo(x0 + 6);
      kit.advance(8);
      if (h.state !== 'stand') return `fell walking up the hill (${h.status()})`;
      if (torso.x < from + 4.5) return `walked only ${(torso.x - from).toFixed(2)} m of 6 up the hill`;
      if (head.y - top(head.x) < 1.3) return `walking stooped: head ${(head.y - top(head.x)).toFixed(2)} m up`;
      return true;
    }],
    ['extra: maps: on the rooftops, someone sent past the edge of a roof stops at it', () => {
      kit.reset();
      game.setMap(builtinMap('rooftops')!);
      const roof = top(8);
      const p = kit.spawn('human', 8, roof + 0.95) as Human;
      kit.advance(1.5);
      p.goTo(30);
      kit.advance(7);
      const t = p.limbs.get('upperTorso')!.part;
      if (p.state !== 'stand' || t.y < roof + 0.5) return `walked off the roof (${p.status()}, torso at ${t.x.toFixed(2)}, ${t.y.toFixed(2)})`;
      if (t.x < 12) return `stopped ${(15.25 - t.x).toFixed(2)} m short of the edge`;
      return true;
    }],
    ['extra: maps: a crate dropped on a block of ground stops on its top; so do bits of debris', () => {
      kit.reset();
      game.setMap(custom([box(-3, 0, 3, 2.5)]));
      const c = kit.spawn('crate', 0, 6);
      game.particles.debris(0, 4.5, 0, -1, 30, 0x777777, 1);
      kit.advance(2);
      const p = c.parts[0];
      if (Math.abs(p.y - (2.5 + half(c))) > 0.05 || speed(c) > 0.05) return `the crate rests at y ${p.y.toFixed(3)} (the block's top is 2.5), moving ${speed(c).toFixed(2)} m/s`;
      const L = (game.particles as unknown as { normal: { count: number; x: Float32Array; y: Float32Array; kind: Uint8Array } }).normal;
      let n = 0;
      for (let i = 0; i < L.count; i++) {
        if (L.kind[i] !== PK.Debris || Math.abs(L.x[i]) > 2.9) continue;
        n++;
        if (L.y[i] < 2.5 - PX) return `a bit of debris over the block sank to y ${L.y[i].toFixed(3)} (its top is 2.5)`;
      }
      if (!n) return 'no debris landed on the block';
      return true;
    }],
    ['extra: maps: blood from a shot person lands on the ground they stand on, not inside it', () => {
      kit.reset();
      game.setMap(custom([box(-8, 0, 8, 2)]));
      const h = kit.spawn('human', 0, 2.95) as Human;
      kit.advance(1.5);
      const g = kit.spawn('pistol', -2.5, h.limbs.get('upperTorso')!.part.y) as Firearm;
      g.setFrozen(true);
      kit.advance(0.05);
      const before = h.blood;
      g.fire();
      kit.advance(3);
      if (!(h.blood < before)) return 'the shot drew no blood';
      const st = game.stains.capture();
      let on = 0;
      for (let i = 0; i < st.n; i++) {
        const x = (st.xy[i * 2] + 0.5) * PX;
        const y = (st.xy[i * 2 + 1] + 0.5) * PX;
        // (more than two pixels into the ground: inside it)
        if (game.env.groundPieceAt(x, y, -2 * PX)) return `a stain inside the ground at (${x.toFixed(2)}, ${y.toFixed(2)})`;
        if (Math.abs(x) < 8 && y > 2 - 2 * PX && y < 2 + PX) on++;
      }
      if (on < 3) return `only ${on} of ${st.n} stains on top of the ground`;
      return true;
    }],
    ['extra: maps: a puddle forms on the big map, far out at x = 200', () => {
      kit.reset();
      game.setMap(builtinMap('hangar')!);
      const f = kit.spawn('flask-water', 200, 2.2, { angle: Math.PI }) as Flask;
      f.setFrozen(true);
      f.activate();
      kit.advance(4);
      const here = game.puddles.amountAt(200);
      if (game.puddles.total < 20 || here <= 0.1) return `the puddle holds only ${game.puddles.total.toFixed(1)} px² (${here.toFixed(2)} at x = 200)`;
      if (game.puddles.amountAt(-200) > 0 || game.puddles.amountAt(0) > 0) return 'liquid turned up far from where it was poured';
      return true;
    }],
    ['extra: maps: save and load bring a custom map back with its ground; old saves load into the lab', () => {
      kit.reset();
      // (the second outline is concave: it's split into convex pieces)
      const spec = custom(
        [box(-10, 0, -4, 3, 'brick'), { pts: [[2, 0], [12, 0], [12, 4], [10, 4], [10, 1.5], [4, 1.5], [4, 4], [2, 4]] }],
        { name: 'Saved map', width: 180, height: 60, theme: 'outdoors' },
      );
      game.setMap(spec);
      const c = kit.spawn('crate', -7, 5);
      kit.advance(1.5);
      const y0 = c.parts[0].y;
      const text = saveToString(game);
      game.setMap(LAB);
      loadFromString(game, text);
      if (!sameMap(game.map, spec)) return `loaded onto ${game.map.name} (${game.map.width} × ${game.map.height} m, ${game.map.terrain.length} pieces)`;
      if (WORLD.right !== 90 || WORLD.ceiling !== 60) return `the world came back as ${WORLD.left}..${WORLD.right}, ceiling ${WORLD.ceiling}`;
      if (game.env.ground.length !== spec.terrain.length) return `${game.env.ground.length} of ${spec.terrain.length} pieces of ground built`;
      const back = game.entities.find((e) => e.def.id === 'crate');
      if (!back || Math.abs(back.parts[0].y - y0) > 0.02) return `the crate on the ground came back at y ${back?.parts[0].y.toFixed(3)} (saved at ${y0.toFixed(3)})`;
      kit.advance(1);
      if (Math.abs(back.parts[0].y - y0) > 0.03) return `the crate sank into the ground after loading (y ${back.parts[0].y.toFixed(3)}, was ${y0.toFixed(3)})`;
      // a save from before maps were saved
      const old = JSON.parse(text) as { map?: unknown };
      delete old.map;
      loadFromString(game, JSON.stringify(old));
      // (TypeScript still holds WORLD.right at 90 from the check above)
      if (game.map !== LAB || (WORLD.right as number) !== 70) return `a save without a map loaded onto ${game.map.name}`;
      return true;
    }],
    ['extra: maps: the Terrain tool draws a block of ground; a right click, or the Remove tool, takes it away', () => {
      kit.reset();
      const tool = new TerrainTool(game, controls);
      tool.start();
      if (controls.terrain !== tool || controls.tool !== 'shape') return 'the Terrain tool did not take the Shape tool over';
      kit.down(-2, 0.5);
      kit.move(0, 1.5);
      kit.move(2, 2.5);
      kit.up(2, 2.5);
      if (game.map.terrain.length !== 1) return `dragging out a box made ${game.map.terrain.length} pieces of ground`;
      if (!game.map.id.startsWith('custom:') || LAB.terrain.length) return `editing the lab changed it in place (now ${game.map.id})`;
      if (game.entities.length) return 'the Shape tool made a thing as well';
      const t = top(0);
      if (Math.abs(t - 2.5) > 0.05) return `the block's top is at ${t.toFixed(3)}, drawn to 2.5`;
      const c = kit.spawn('crate', 0.5, 4.5);
      kit.advance(1.5);
      if (Math.abs(c.parts[0].y - (t + half(c))) > 0.05) return `a crate dropped on the drawn block rests at y ${c.parts[0].y.toFixed(3)} (its top: ${t.toFixed(2)})`;
      // a right click on the block, beside the crate, takes it away: the crate falls to the floor
      kit.down(-1.5, 1, 2);
      kit.up(-1.5, 1, 2);
      if (game.map.terrain.length || game.env.solidAt(0, 1)) return 'a right click did not take the block away';
      kit.advance(1.5);
      if (c.parts[0].y > half(c) + 0.05) return `the crate stayed up at y ${c.parts[0].y.toFixed(2)} with the block gone`;
      // and the Remove tool
      kit.down(4, 0.5);
      kit.up(6, 2);
      if (game.map.terrain.length !== 1) return 'a second block was not drawn';
      controls.setTool('remove');
      kit.down(5, 1);
      kit.up(5, 1);
      if (game.map.terrain.length) return 'the Remove tool did not take the block away';
      tool.stop();
      if (controls.terrain) return 'editing did not end';
      return true;
    }],
    ['extra: maps: export and import carry a map through its JSON; bad maps are made safe', () => {
      const spec = custom(
        [box(-100, -1, 20, 3, 'rock'), { pts: [[30, 0], [50, 0], [40, 9]], mat: 'metal' }, { pts: [[0, 0], [1, NaN], [2, 2]] }, { pts: [[-300, 0], [-160, 0], [-160, 5]] }],
        { id: 'custom:roundtrip', name: 'Round trip', width: 333, height: 77, theme: 'desert' },
      );
      if (spec.terrain.length !== 3) return `cleaning kept ${spec.terrain.length} pieces (wanted 3: the one with a bad corner dropped)`;
      if (spec.terrain.some((p) => p.pts.some(([x]) => Math.abs(x) > 166.5))) return 'a piece past the wall was not clamped inside the map';
      const back = mapFromJson(mapToJson(spec));
      if (!back || !sameMap(back, spec)) return `the map came back different: ${JSON.stringify(back).slice(0, 200)}`;
      const bare = mapFromJson(JSON.stringify(spec));
      if (!bare || !sameMap(bare, spec)) return 'a bare map (not in an export) did not read back the same';
      const hills = builtinMap('hills')!;
      if (mapFromJson(mapToJson(hills)) !== hills) return 'an exported built-in map did not read back as the built-in one';
      const changed = mapFromJson(mapToJson({ ...LAB, terrain: [box(0, 0, 1, 1)] }));
      if (!changed?.id.startsWith('custom:')) return `a changed lab kept the id ${changed?.id}`;
      const odd = mapFromJson(JSON.stringify({ name: 'Huge', width: 5000, height: 2, theme: 'moon', terrain: 'none' }));
      if (!odd || odd.width !== 1000 || odd.height !== 12 || odd.theme !== 'concrete' || odd.terrain.length) return `sizes and look were not made safe: ${JSON.stringify(odd)}`;
      if (mapFromJson('not json') || mapFromJson('{"entities": []}')) return 'something that is not a map was read as one';
      return true;
    }],
    ['extra: maps: kit.reset() brings the lab back (and costs nothing in the lab)', () => {
      kit.reset();
      const floor = game.env.colliders[0];
      kit.reset();
      if (game.env.colliders[0] !== floor) return 'resetting in the lab rebuilt it';
      game.setMap(builtinMap('rooftops')!);
      new TerrainTool(game, controls).start();
      kit.reset();
      if (game.map !== LAB) return `still on ${game.map.name} after a reset`;
      if (controls.terrain) return 'still editing the map after a reset';
      if (WORLD.left !== -70 || WORLD.right !== 70 || WORLD.ceiling !== 48) return `the world spans ${WORLD.left}..${WORLD.right}, ceiling ${WORLD.ceiling}`;
      if (game.env.ground.length || game.env.colliders.length !== 4) return `${game.env.ground.length} pieces of ground and ${game.env.colliders.length} colliders left`;
      if (!game.puddles.open(10)) return 'the floor is still closed to liquid where a building stood';
      const c = kit.spawn('crate', 68.5, 2);
      c.parts[0].body.setLinvel({ x: 8, y: 0 }, true);
      kit.advance(2);
      if (c.parts[0].x > 70 - half(c) + 0.05) return `a crate thrown at the lab's right wall ended up at x ${c.parts[0].x.toFixed(2)}`;
      return true;
    }],
  ];
}
