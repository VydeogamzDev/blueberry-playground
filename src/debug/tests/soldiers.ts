import type { Test, TestCtx } from './types';
import type { Entity } from '../../world/Entity';
import type { Human } from '../../entities/Human';
import type { Firearm } from '../../entities/Firearm';
import type { Tank } from '../../entities/Tank';
import type { Item } from '../../entities/Item';
import { spawnBattle, type Lineup, type Side } from '../../ui/ArmyPanel';

/**
 * Soldiers in a battle: a line fires past their own side in front (as if from
 * beside them, as a side-on view can't show), holding an explosive round while
 * one of their own is within its blast of where it would go off; keeps room
 * between them on the march; against tanks, picks up a launcher lying near,
 * leaves the infantry to the rifles and the tanks to the launchers; tanks go for
 * the enemy's tanks over the heads of the infantry; and a soldier knocked down
 * takes their gun up again.
 */
export default function tests({ game, kit, human, arm }: TestCtx): Test[] {
  const gunOf = (h: Entity): Firearm | undefined => (h as Human).heldItems()[0] as Firearm | undefined;
  const torso = (h: Human) => h.limbs.get('upperTorso')!.part;
  /** Held where they stand and past hurting: targets to shoot at for as long as it takes. */
  const target = (h: Entity) => {
    h.setFrozen(true);
    h.damage = () => {};
    h.onBullet = () => {};
  };
  /** Counts the bullets (and bolts) that hit them. */
  const shotAt = (h: Entity & { alive: boolean }): (() => number) => {
    let n = 0;
    const ob = h.onBullet.bind(h);
    h.onBullet = (hit) => {
      if (h.alive) n++;
      return ob(hit);
    };
    return () => n;
  };
  const handsOff = (t: Tank) => ((t as unknown as { handsOff: number }).handsOff = 1e9);
  /**
   * A battle of `sides` at x = `x`, for `secs`: who of each side died of a blast of
   * a round fired for their own side (one gone off by them just before, and not
   * set off by the enemy's).
   */
  const ownBlasts = (sides: Side[], x: number, secs: number): { made: Lineup; own: string[] } => {
    kit.reset();
    const made = spawnBattle(game, sides, { x, y: 0 });
    const blasts: { t: number; x: number; y: number; r: number; side: string }[] = [];
    const E = game.explosions;
    const explode = E.explode;
    E.explode = (bx, by, o) => {
      const side = (o?.source as { firedFor?: string | null } | undefined)?.firedFor;
      if (side) blasts.push({ t: game.time, x: bx, y: by, r: o?.radius ?? 3, side });
      return explode.call(E, bx, by, o);
    };
    const own: string[] = [];
    const seen = new Set<Entity>();
    try {
      for (let t = 0; t < secs; t += 0.05) {
        kit.advance(0.05);
        for (const h of made.flat()) {
          if (seen.has(h) || (h.alive && !h.destroyed)) continue;
          seen.add(h);
          const c = h.center();
          // (not one the enemy set off: met head on by theirs, or in the blast of it)
          const metEnemy = (b: (typeof blasts)[number]) => blasts.some((e) => e.side !== b.side && Math.abs(e.t - b.t) < 0.15 && Math.hypot(e.x - b.x, e.y - b.y) < e.r + 0.5);
          const b = blasts.find((e) => e.side === h.team && game.time - e.t < 0.5 && Math.hypot(e.x - c.x, e.y - c.y) < e.r + 1.5 && !metEnemy(e));
          if (b) own.push(`${h.team} at ${c.x.toFixed(1)} (the blast at ${b.x.toFixed(1)}, ${t.toFixed(2)} s in)`);
        }
      }
    } finally {
      E.explode = explode;
    }
    return { made, own };
  };

  return [
    ['extra: soldiers: a line of riflemen all fire, past the ones of their own in front, and hit none of them', () => {
      kit.reset();
      const made = spawnBattle(game, [{ team: 'red', count: 6, loadout: 'rifles' }, { team: 'blue', count: 6, loadout: 'fists' }], { x: 0, y: 0 });
      for (const h of made[1]) target(h);
      const hits = made[0].map(shotAt);
      kit.advance(6);
      const shots = made[0].map((h) => gunOf(h)?.shots ?? 0);
      const idle = shots.filter((n) => n === 0).length;
      if (idle) return `${idle} of 6 riflemen never fired in 6 s (shots: ${shots.join(', ')})`;
      const own = hits.reduce((n, f) => n + f(), 0);
      if (own) return `${own} of their ${shots.reduce((a, b) => a + b, 0)} bullets hit their own side`;
      return true;
    }],
    ['extra: soldiers: a gun not fired by a soldier at the foe (the player’s, on a side or none) still hits whoever is in the way', () => {
      for (const team of [null, 'red'] as const) {
        kit.reset();
        const g = human(-4);
        const between = human(-1);
        kit.advance(0.5);
        const gun = arm(g, 'pistol');
        if (!gun) return 'could not hand them a pistol';
        torso(between).setFrozen(true);
        if (team) {
          g.setTeam(team);
          between.setTeam(team);
        }
        const hit = shotAt(between);
        kit.advance(0.5);
        for (let i = 0; i < 4; i++) {
          gun.fire();
          kit.advance(0.4);
        }
        if (!gun.shots) return 'the pistol never fired';
        if (!hit()) return `${gun.shots} shots by hand went through ${team ? 'one of their own side' : 'the one'} in the way (${team ?? 'on no side'})`;
      }
      return true;
    }],
    ['extra: soldiers: RPG soldiers all fire on a tank, past their own in front, and none of them is hurt by their own rockets', () => {
      kit.reset();
      const made = spawnBattle(game, [{ team: 'red', count: 4, loadout: 'gun', gun: 'rpg' }, { team: 'blue', count: 0, loadout: 'fists', tanks: 1, tank: 'tank' }], { x: 0, y: 0 });
      const tank = made.tanks[1][0] as Tank;
      if (!tank) return 'no tank';
      // (it doesn't shoot back: all the harm done is their own)
      handsOff(tank);
      kit.advance(14);
      const shots = made[0].map((h) => (h.alive ? (gunOf(h)?.shots ?? 0) : -1));
      const dead = made[0].filter((h) => !h.alive || h.destroyed).length;
      if (dead) return `${dead} of 4 RPG soldiers killed by their own rockets (shots: ${shots.join(', ')})`;
      const idle = shots.filter((n) => n === 0).length;
      if (idle > 1) return `${idle} of 4 RPG soldiers never fired on the tank in 14 s (shots: ${shots.join(', ')})`;
      return true;
    }],
    ['extra: soldiers: 4 hand to hand and 2 RPGs (squads) against 4 hand to hand: no one on the RPG side is killed by their own rockets', () => {
      const own: string[] = [];
      let fired = 0;
      for (const x of [0, 2]) {
        const r = ownBlasts([{ team: 'red', count: 4, loadout: 'melee', squads: [{ count: 2, loadout: 'gun', gun: 'rpg' }] }, { team: 'blue', count: 4, loadout: 'melee' }], x, 20);
        own.push(...r.own);
        fired += r.made[0].reduce((n, h) => n + (gunOf(h)?.def.id === 'rpg' ? gunOf(h)!.shots : 0), 0);
      }
      if (own.length) return `killed by their own side's rockets: ${own.join('; ')}`;
      if (!fired) return 'the RPGs never fired';
      return true;
    }],
    ['extra: soldiers: mixed sides with RPGs behind: none killed by a rocket of their own side', () => {
      const r = ownBlasts([
        { team: 'red', count: 6, loadout: 'mixed', squads: [{ count: 2, loadout: 'gun', gun: 'rpg' }] },
        { team: 'blue', count: 6, loadout: 'mixed', squads: [{ count: 2, loadout: 'gun', gun: 'rpg' }] },
      ], 0, 12);
      const fired = r.made.flat().reduce((n, h) => n + (gunOf(h)?.def.id === 'rpg' ? gunOf(h)!.shots : 0), 0);
      if (r.own.length) return `killed by their own side's rockets: ${r.own.join('; ')}`;
      if (!fired) return 'no RPG fired';
      return true;
    }],
    ['extra: soldiers: on the march, a line of soldiers keeps room between them: no one walks into the back of the one ahead', () => {
      kit.reset();
      const made = spawnBattle(game, [{ team: 'red', count: 8, loadout: 'pistols' }, { team: 'blue', count: 8, loadout: 'fists' }], { x: 0, y: 0 });
      for (const h of made[1]) target(h);
      const gaps: number[] = [];
      for (let t = 0; t < 8; t += 0.25) {
        kit.advance(0.25);
        const up = made[0].filter((h) => h.alive && (h as Human).state === 'stand').map((h) => torso(h as Human).x).sort((a, b) => a - b);
        for (let i = 1; i < up.length; i++) gaps.push(up[i] - up[i - 1]);
      }
      if (gaps.length < 100) return `only ${gaps.length} gaps between soldiers on their feet`;
      const close = gaps.filter((g) => g < 0.5).length / gaps.length;
      if (close > 0.05) return `${(close * 100).toFixed(0)}% of the time one was under half a metre behind the one ahead`;
      return true;
    }],
    ['extra: soldiers: against a tank, a rifleman picks up an RPG lying near and fires it on the tank', () => {
      kit.reset();
      const r = human(-8);
      const rpg = kit.spawn('rpg', -3, 0.5) as Item;
      const tank = kit.spawn('tank', 9, 0.8, { flip: true }) as Tank;
      kit.advance(0.5);
      const rifle = arm(r, 'rifle');
      if (!rifle) return 'could not hand them a rifle';
      r.setTeam('red');
      tank.setTeam('blue');
      handsOff(tank);
      kit.advance(12);
      const held = gunOf(r);
      if (held?.def.id !== 'rpg') return `with a tank coming, they hold ${held?.def.id ?? 'nothing'} (the RPG lying ${rpg.destroyed ? 'gone' : `at ${rpg.main.x.toFixed(1)}`})`;
      if (!held.shots) return 'they took up the RPG, and never fired it';
      return true;
    }],
    ['extra: soldiers: with enemy people about and a tank, riflemen go for the people and RPGs for the tank', () => {
      kit.reset();
      const made = spawnBattle(game, [
        { team: 'red', count: 3, loadout: 'rifles', squads: [{ count: 2, loadout: 'gun', gun: 'rpg' }] },
        { team: 'blue', count: 3, loadout: 'fists', tanks: 1, tank: 'tank' },
      ], { x: 0, y: 0 });
      for (const h of made[1]) target(h);
      handsOff(made.tanks[1][0] as Tank);
      kit.advance(3);
      const tank = made.tanks[1][0];
      for (const h of made[0]) {
        const id = gunOf(h)?.def.id;
        const foe = (h as Human).foe;
        if (!foe) return `a soldier with ${id} went for nobody`;
        if (id === 'rpg' && foe !== tank) return 'a soldier with an RPG went for a person, with a tank in the fight';
        if (id === 'rifle' && foe === tank) return 'a rifleman went for the tank, with enemy people about';
      }
      return true;
    }],
    ['extra: soldiers: a tank on a side goes for the enemy’s tank over the nearer infantry, and shells it over their heads', () => {
      kit.reset();
      const mine = kit.spawn('tank', -18, 0.8) as Tank;
      const theirs = kit.spawn('tank', 12, 0.8, { flip: true }) as Tank;
      const men = [human(-2, { flip: true }), human(0, { flip: true }), human(2, { flip: true })];
      kit.advance(1);
      for (const h of men) {
        target(h);
        h.setTeam('blue');
      }
      handsOff(theirs);
      theirs.setTeam('blue');
      mine.setTeam('red');
      kit.advance(5);
      if (mine.foe !== theirs) return `with the enemy's tank 30 m off and its infantry 16 m off, it went for ${mine.foe ? 'the infantry' : 'nothing'}`;
      if (!mine.shots) return 'it never fired on the enemy tank';
      return true;
    }],
    ['extra: soldiers: knocked out, a soldier comes round and takes up the gun they let go of', () => {
      kit.reset();
      const s = human(-6);
      const foe = human(8, { flip: true });
      kit.advance(0.5);
      const gun = arm(s, 'rifle');
      if (!gun) return 'could not hand them a rifle';
      target(foe);
      s.setTeam('red');
      foe.setTeam('blue');
      kit.advance(1);
      s.stun(1.5);
      kit.advance(1);
      if (gunOf(s)) return 'knocked out, they still hold the rifle';
      kit.advance(8);
      if (gunOf(s)?.def.id !== 'rifle') return `come round, they hold ${gunOf(s)?.def.id ?? 'nothing'}`;
      return true;
    }],
  ];
}
