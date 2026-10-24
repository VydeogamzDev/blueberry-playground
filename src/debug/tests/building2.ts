import type { Test, TestCtx } from './types';
import type { Entity } from '../../world/Entity';
import type { Motor } from '../../entities/Machines';
import type { Connection } from '../../systems/Connections';
import { getItem } from '../../catalog/items';
import { saveToString, loadFromString } from '../../world/SaveLoad';
import { boxOf } from '../../tools/Guides';

/** The building revamp: connecting, editing connections, arranging things, undo and Play checkpoints. */
export default function tests({ game, controls, kit }: TestCtx): Test[] {
  const C = game.connections;
  const c = controls;
  const toast = () => document.querySelector('.toast')?.textContent ?? '';
  const at = (e: Entity) => ({ x: e.parts[0].x, y: e.parts[0].y });
  const frames = (n = 1) => {
    for (let i = 0; i < n; i++) game.renderFrame(1 / 60, 1);
  };
  /** Drags with time paused: press at `from`, move to `to` over a few frames, let go (extra: the press's modifier keys). */
  const pausedDrag = (from: { x: number; y: number }, to: { x: number; y: number }, extra: PointerEventInit = {}) => {
    kit.down(from.x, from.y, 0, extra);
    for (let i = 1; i <= 8; i++) {
      kit.move(from.x + ((to.x - from.x) * i) / 8, from.y + ((to.y - from.y) * i) / 8);
      frames();
    }
    kit.up(to.x, to.y, 0, extra);
    frames();
  };
  /** A connection tool's drag from one point to another. */
  const join = (from: { x: number; y: number }, to: { x: number; y: number }, upExtra: PointerEventInit = {}) => {
    kit.down(from.x, from.y);
    kit.move((from.x + to.x) / 2, (from.y + to.y) / 2);
    kit.move(to.x, to.y);
    kit.up(to.x, to.y, 0, upExtra);
  };
  const click = (p: { x: number; y: number }, extra: PointerEventInit = {}) => {
    kit.down(p.x, p.y, 0, extra);
    kit.up(p.x, p.y, 0, extra);
  };
  /** Picks an entry of the open context menu by the start of its label. */
  const menuPick = (label: string): boolean => {
    const item = [...document.querySelectorAll<HTMLElement>('.ctx-item')].find((d) => (d.textContent ?? '').replace(/^[☑☐] /, '').startsWith(label));
    if (!item) return false;
    item.dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true }));
    return true;
  };
  const ofKind = (k: string) => C.list.filter((x) => x.kind === k);

  return [
    ['extra: building2: a paused drag moves the welded assembly as one; Ctrl moves just the one, its weld made again where it’s put', () => {
      kit.reset();
      const a = kit.spawn('crate', -1, 0.45);
      const b = kit.spawn('crate', 0.2, 0.45);
      kit.advance(0.5);
      const pa = a.parts[0];
      const pb = b.parts[0];
      const mid = { x: (pa.x + pb.x) / 2, y: pa.y };
      C.create('weld', pa, mid, pb, mid);
      game.paused = true;
      const dx0 = pb.x - pa.x;
      const bx0 = pb.x;
      pausedDrag(at(a), { x: pa.x + 2, y: pa.y + 1 });
      if (Math.abs(pb.x - bx0 - 2) > 0.02 || Math.abs(pb.x - pa.x - dx0) > 0.01) return `the welded crate did not come along (moved ${(pb.x - bx0).toFixed(2)} m of 2)`;
      if (c.history.undoLabel !== 'Move') return `undo would undo "${c.history.undoLabel}", not the move`;
      // Ctrl as it's taken: just that one, 1 m up
      const ax = pa.x;
      const ay = pa.y;
      pausedDrag(at(b), { x: pb.x, y: pb.y + 1 }, { ctrlKey: true });
      if (Math.abs(pa.x - ax) > 1e-3 || Math.abs(pa.y - ay) > 1e-3) return 'Ctrl-dragging one crate moved the other too';
      const w = ofKind('weld')[0];
      if (!w) return 'the weld went';
      // (it holds where its first end is, on both: a rod is drawn on out to where it held before)
      const ja = w.a.localToWorld(w.la.x, w.la.y);
      const jb = w.b!.localToWorld(w.lb.x, w.lb.y);
      if (Math.hypot(ja.x - jb.x, ja.y - jb.y) > 0.01) return `the weld was not made again where it was put (its anchors ${Math.hypot(ja.x - jb.x, ja.y - jb.y).toFixed(3)} m apart)`;
      // time runs: it stays where it was put on the other, held by the weld
      const rel = pa.worldToLocal(pb.x, pb.y);
      game.paused = false;
      kit.advance(1);
      if (!ofKind('weld').length) return 'the weld tore as time ran';
      const now = pa.worldToLocal(pb.x, pb.y);
      if (Math.hypot(now.x - rel.x, now.y - rel.y) > 0.1) return `the crate moved ${Math.hypot(now.x - rel.x, now.y - rel.y).toFixed(2)} m from where it was put on the other`;
      return true;
    }],
    ['extra: building2: a weld let go over nothing makes nothing (Ctrl: fixed to the background); a click with the Weld fixes it there', () => {
      kit.reset();
      const a = kit.spawn('crate', 0, 0.45);
      kit.advance(0.3);
      const p = at(a);
      c.setTool('weld');
      join(p, { x: p.x, y: p.y + 3 });
      if (C.list.length) return 'a weld dragged off into nothing was made';
      if (!toast().includes('Released over nothing')) return `the status says "${toast()}"`;
      join(p, { x: p.x, y: p.y + 3 }, { ctrlKey: true });
      const w = ofKind('weld')[0];
      if (!w || w.b) return 'with Ctrl, no weld to the background';
      c.setTool('drag');
      c.undo();
      if (C.list.length) return 'undo left the weld';
      c.setTool('weld');
      click(p);
      c.setTool('drag');
      const k = ofKind('weld')[0];
      if (!k || k.b) return 'a click with the Weld did not fix the crate to the background';
      return true;
    }],
    ['extra: building2: the Remove tool takes what’s clicked: a click on a body nothing, Shift+click all of its, a box what it crosses', () => {
      kit.reset();
      const a = kit.spawn('crate', -1.5, 0.45);
      const b = kit.spawn('crate', 1.5, 0.45);
      kit.advance(0.3);
      const pa = a.parts[0];
      const pb = b.parts[0];
      C.create('rope', pa, at(a), pb, at(b));
      C.create('spring', pa, { x: pa.x, y: pa.y + 0.2 }, pb, { x: pb.x, y: pb.y + 0.2 });
      c.setTool('remove');
      click({ x: pa.x - 0.25, y: pa.y - 0.25 });
      if (C.list.length !== 2) {
        c.setTool('drag');
        return `a click on the crate’s body took ${2 - C.list.length} connections`;
      }
      if (!toast().includes('Shift')) {
        c.setTool('drag');
        return `a click on the body said "${toast()}"`;
      }
      click({ x: pa.x - 0.25, y: pa.y - 0.25 }, { shiftKey: true });
      if (C.list.length) {
        c.setTool('drag');
        return `Shift+click left ${C.list.length}`;
      }
      c.undo();
      if (C.list.length !== 2) return `undo brought back ${C.list.length} of 2`;
      // a box across both lines, from above them to below
      kit.down(0, 2);
      kit.move(0.2, 1);
      kit.move(0.2, 0.1);
      kit.up(0.2, 0.1);
      c.setTool('drag');
      if (C.list.length) return `the box left ${C.list.length} of the 2 it crossed`;
      return true;
    }],
    ['extra: building2: the Pin pins with a click and hinges when dragged; the Hinge kind clicks to the background', () => {
      kit.reset();
      const plank = kit.spawn('plank', 0, 3).parts[0];
      plank.setFrozen(true);
      const a = kit.spawn('crate', -1.5, 0.45);
      const b = kit.spawn('crate', 1.5, 0.45);
      kit.advance(0.3);
      c.setTool('pin');
      const end = plank.localToWorld(-0.5, 0);
      click(end);
      const pin = C.list[0];
      if (!pin || pin.kind !== 'pin' || pin.b) {
        c.setTool('drag');
        return `a click with the Pin made ${pin ? `a ${pin.kind}${pin.b ? ' to something' : ''}` : 'nothing'}`;
      }
      join(at(a), at(b));
      const h = ofKind('hinge')[0];
      if (!h || !h.b || h.a.entity !== a || h.b.entity !== b) {
        c.setTool('drag');
        return 'dragged from crate to crate, the Pin made no hinge between them';
      }
      c.setTool('hinge');
      click(plank.localToWorld(0.5, 0));
      c.setTool('drag');
      if (ofKind('hinge').filter((k) => !k.b).length !== 1) return 'a click with the Hinge kind did not hinge to the background';
      return true;
    }],
    ['extra: building2: a slot’s key again steps to its other kind (the Rope’s fuse cord); the tool bar lights the slot', () => {
      kit.reset();
      const steps: [string, string][] = [['Digit2', 'rope'], ['Digit2', 'fuse'], ['Digit2', 'rope'], ['Digit5', 'pin'], ['Digit5', 'pin'], ['Digit6', 'wire'], ['Digit7', 'remove'], ['Digit8', 'shape'], ['Digit3', 'weld'], ['Digit1', 'drag']];
      for (const [key, want] of steps) {
        kit.press(key);
        if (c.tool !== want) {
          c.setTool('drag');
          return `${key} picked ${c.tool}, not ${want}`;
        }
        if (want === 'fuse') {
          const rope = document.querySelector<HTMLElement>('.tool-list .tool-btn[data-tool="rope"]');
          const fuse = document.querySelector<HTMLElement>('.tool-vars .tool-btn[data-tool="fuse"]');
          if (!rope?.classList.contains('active')) return 'the Rope slot is not lit with the fuse cord in hand';
          if (!fuse || fuse.closest('.hidden') || !fuse.classList.contains('active')) return 'the Fuse kind is not shown lit under the Rope';
        }
      }
      return true;
    }],
    ['extra: building2: Weld together fixes a motor wheel by its hub, not its tyre', () => {
      kit.reset();
      const w = kit.spawn('motor-wheel', 0, 0.4) as Motor;
      const plank = kit.spawn('plank', 0, 0.62);
      const n = c.weldTogether([plank, w]);
      if (!n) return `nothing welded (${toast()})`;
      const welds = ofKind('weld');
      if (welds.some((k) => k.a === w.rotor || k.b === w.rotor)) return 'the tyre was welded: it would not turn';
      if (!welds.some((k) => k.a === w.housing || k.b === w.housing)) return 'not welded by the hub';
      return true;
    }],
    ['extra: building2: a rope has a menu: hide it, how strong, fit its length; Delete over it takes it', () => {
      kit.reset();
      const a = kit.spawn('crate', -1.5, 0.45);
      const b = kit.spawn('crate', 1.5, 0.45);
      kit.advance(0.3);
      const pa = a.parts[0];
      const pb = b.parts[0];
      let r: Connection = C.create('rope', pa, { x: pa.x, y: pa.y + 0.3 }, pb, { x: pb.x, y: pb.y + 0.3 }, 2)!;
      game.paused = true;
      const mid = { x: 0, y: pa.y + 0.3 };
      const menu = () => {
        // (a frame first: hidden connections show, and can be clicked, while time is paused)
        frames();
        kit.down(mid.x, mid.y, 2);
        kit.up(mid.x, mid.y, 2);
        return document.querySelector('.ctx-title')?.textContent ?? '';
      };
      if (!menu().startsWith('Rope')) return `right-clicking the rope opened "${document.querySelector('.ctx-title')?.textContent}"`;
      if (!menuPick('Hide')) return 'no Hide in its menu';
      if (!r.opts?.hidden) return 'Hide did not hide it';
      menu();
      if (!menuPick('Strength: unbreakable')) return 'no Strength: unbreakable';
      if (r.opts?.strength !== 'unbreakable' || r.breakAt !== Infinity) return 'it is not unbreakable';
      menu();
      if (!menuPick('Fit to the distance now')) return 'no Fit to the distance now';
      r = C.list.find((k) => k.kind === 'rope') ?? r;
      if (Math.abs(r.rest - 3) > 0.02) return `fitted, it is ${r.rest.toFixed(2)} m long, not 3`;
      c.undo();
      c.undo();
      c.undo();
      r = C.list.find((k) => k.kind === 'rope')!;
      if (r.opts || Math.abs(r.rest - 2) > 1e-6) return `three undos left ${JSON.stringify(r.opts)} and ${r.rest.toFixed(2)} m`;
      c.ui.closeContextMenu();
      // the cursor on it, nothing selected: Delete takes it
      c.clearSelection();
      kit.move(mid.x, mid.y);
      frames(2);
      c.command('delete');
      game.paused = false;
      if (C.list.length) return 'Delete over the rope did not take it';
      if (a.destroyed || b.destroyed) return 'Delete over the rope took a crate';
      return true;
    }],
    ['extra: building2: a right-click on a knot opens its menu, which offers the thing’s; on a selected thing, the thing’s', () => {
      kit.reset();
      const a = kit.spawn('crate', -0.45, 0.45);
      const b = kit.spawn('crate', 0.45, 0.45);
      kit.advance(0.5);
      const pb = b.parts[0];
      C.create('weld', a.parts[0], { x: pb.x, y: pb.y }, pb, { x: pb.x, y: pb.y });
      game.paused = true;
      const at = { x: pb.x, y: pb.y };
      const menu = () => {
        frames();
        kit.down(at.x, at.y, 2);
        kit.up(at.x, at.y, 2);
        return document.querySelector('.ctx-title')?.textContent ?? '';
      };
      c.clearSelection();
      if (!menu().startsWith('Weld')) return `on the knot, nothing selected: "${document.querySelector('.ctx-title')?.textContent}"`;
      if (!menuPick(`The ${b.def.name}`)) return 'the weld’s menu does not offer the crate’s';
      if (!menuPick('Copy')) return 'the crate’s menu (from the weld’s) has no Copy';
      c.selection = new Set([a, b]);
      const title = menu();
      game.paused = false;
      if (title.startsWith('Weld') || !menuPick('Copy')) return `on the knot, both selected: "${title}"`;
      c.ui.closeContextMenu();
      return true;
    }],
    ['extra: building2: the grid snaps the moved thing’s middle, not the point it was taken by', () => {
      kit.reset();
      const a = kit.spawn('crate', 0.37, 0.45);
      kit.advance(0.3);
      const p = a.parts[0];
      game.paused = true;
      c.snapping = true;
      const grid = c.arrange.settings.grid;
      c.arrange.settings.grid = 0.1;
      kit.key('AltLeft', true);
      pausedDrag({ x: p.x + 0.17, y: p.y + 0.11 }, { x: 1.53, y: 1.27 });
      kit.key('AltLeft', false);
      c.arrange.settings.grid = grid;
      c.snapping = false;
      game.paused = false;
      const off = (v: number) => Math.abs(v / 0.1 - Math.round(v / 0.1));
      if (off(p.x) > 0.01 || off(p.y) > 0.01) return `its middle is at ${p.x.toFixed(3)}, ${p.y.toFixed(3)}: off the grid`;
      return true;
    }],
    ['extra: building2: of things stacked under the cursor the smallest is picked; Alt+click goes to the next', () => {
      kit.reset();
      const crate = kit.spawn('crate', 0, 1);
      const g = kit.spawn('grenade', 0.1, 1);
      game.paused = true;
      c.arrange.layer([crate], 'front');
      const gp = g.parts[0];
      const picked = game.pick(gp.x, gp.y);
      if (picked?.entity !== g) return `picked the ${picked?.entity.label ?? 'nothing'} over the grenade in front of it`;
      const all = game.pickAll(gp.x, gp.y);
      if (all.length !== 2 || all[0].entity !== g || all[1].entity !== crate) return `pickAll gave ${all.map((q) => q.entity.label).join(', ')}`;
      c.setTool('drag');
      kit.down(gp.x, gp.y, 0, { altKey: true });
      kit.up(gp.x, gp.y, 0, { altKey: true });
      game.paused = false;
      if (!c.selection.has(crate) || c.selection.size !== 1) return 'Alt+click did not take the crate under the grenade';
      return true;
    }],
    ['extra: building2: Play keeps the scene as built; Back to build puts it back, paused, and Play keeps it again', () => {
      kit.reset();
      game.paused = true;
      c.history.paused();
      c.history.record('Spawn Wooden Crate');
      const a = kit.spawn('crate', 0, 3);
      const y0 = a.parts[0].y;
      c.togglePause();
      if (game.paused) return 'Play left time paused';
      if (!c.history.atCheckpoint) return 'no checkpoint kept as time started';
      kit.advance(1);
      // (moved as it runs: part of the test run, undone with it)
      c.history.record('Move');
      a.parts[0].teleport(2, 1, 0);
      kit.advance(0.2);
      c.rewind();
      const b = game.entities[0];
      if (!game.paused) return 'Back to build left time running';
      if (!b || Math.abs(b.parts[0].y - y0) > 1e-3 || Math.abs(b.parts[0].x) > 1e-3) return `the crate came back to ${b?.parts[0].x.toFixed(2)}, ${b?.parts[0].y.toFixed(2)}, not 0, ${y0.toFixed(2)}`;
      if (c.history.atCheckpoint) return 'back to build, there is still something to go back to';
      c.togglePause();
      if (!c.history.atCheckpoint) return 'Play after going back kept no checkpoint';
      // building again after a run: no going back past it
      c.togglePause();
      c.history.record('Freeze');
      if (c.history.atCheckpoint) return 'built on after the run, Back to build would undo the building';
      game.paused = false;
      return true;
    }],
    ['extra: building2: turns in quick succession are one step to undo', () => {
      kit.reset();
      const a = kit.spawn('crate', 0, 0.45);
      kit.advance(0.2);
      c.history.clear();
      c.rotateSelection([a], 0.2);
      c.rotateSelection([a], 0.2);
      c.rotateSelection([a], 0.2);
      if (c.history.undoLabel !== 'Rotate') return `undo would undo "${c.history.undoLabel}"`;
      c.undo();
      if (c.history.canUndo) return 'three quick turns took more than one undo';
      if (Math.abs(game.entities[0].parts[0].a) > 1e-3) return 'undo did not turn it back';
      return true;
    }],
    ['extra: building2: a rope let go on one of several selected goes to each, as one edit', () => {
      kit.reset();
      const beam = kit.spawn('beam', 0, 3.2);
      beam.setFrozen(true);
      const crates = [-1.5, 0, 1.5].map((x) => kit.spawn('crate', x, 0.45));
      kit.advance(0.3);
      c.selection = new Set(crates);
      c.setTool('rope');
      join({ x: 0, y: beam.parts[0].y }, at(crates[1]));
      c.setTool('drag');
      const ropes = ofKind('rope');
      if (ropes.length !== 3) return `${ropes.length} ropes, not 3`;
      if (crates.some((e) => !ropes.some((k) => k.a.entity === e || k.b?.entity === e))) return 'a selected crate got no rope';
      if (c.history.undoLabel !== 'Rope ×3') return `the edit is "${c.history.undoLabel}"`;
      c.undo();
      if (ofKind('rope').length) return 'one undo left ropes';
      return true;
    }],
    ['extra: building2: click, then click makes a rope; Shift as it’s let go carries on (A → B → C)', () => {
      kit.reset();
      const [a, b, d] = [-2, 0, 2].map((x) => kit.spawn('crate', x, 0.45));
      kit.advance(0.3);
      c.setTool('rope');
      click(at(a));
      if (C.list.length || !c.connect.pending?.waiting) {
        c.setTool('drag');
        return 'a click with the rope did not wait for the second end';
      }
      click(at(b), { shiftKey: true });
      if (ofKind('rope').length !== 1 || !c.connect.pending) {
        c.setTool('drag');
        return 'Shift as the second click came up did not carry on';
      }
      click(at(d));
      c.setTool('drag');
      const ropes = ofKind('rope');
      if (ropes.length !== 2) return `${ropes.length} ropes made`;
      if (!ropes.some((k) => (k.a.entity === b && k.b?.entity === d) || (k.a.entity === d && k.b?.entity === b))) return 'the chain did not go on from the second crate';
      return true;
    }],
    ['extra: building2: with time paused a rope’s knot is moved by dragging it, and the wheel over it sets its length', () => {
      kit.reset();
      const [a, b, d] = [-2, 0, 2].map((x) => kit.spawn('crate', x, 0.45));
      kit.advance(0.3);
      const pa = a.parts[0];
      const pb = b.parts[0];
      C.create('rope', pa, { x: pa.x + 0.2, y: pa.y + 0.2 }, pb, { x: pb.x - 0.2, y: pb.y + 0.2 });
      game.paused = true;
      c.setTool('drag');
      pausedDrag({ x: pa.x + 0.2, y: pa.y + 0.2 }, at(d));
      const r = ofKind('rope')[0];
      if (!r || (r.a.entity !== d && r.b?.entity !== d)) {
        game.paused = false;
        return `the knot did not move to the third crate (rope between ${r?.a.entity.label} and ${r?.b?.entity.label})`;
      }
      if (Math.abs(pa.x + 2) > 1e-3) {
        game.paused = false;
        return 'dragging the knot moved the crate instead';
      }
      const rest = r.rest;
      const ea = C.endPoint(r, 'a');
      const eb = C.endPoint(r, 'b');
      kit.move((ea.x + eb.x) / 2, (ea.y + eb.y) / 2);
      frames(2);
      const s = game.renderer.worldToScreen((ea.x + eb.x) / 2, (ea.y + eb.y) / 2);
      game.renderer.canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, clientX: s.x, clientY: s.y, bubbles: true, cancelable: true }));
      game.paused = false;
      const now = ofKind('rope')[0];
      if (!now || !(now.rest > rest)) return `the wheel left it ${now?.rest.toFixed(3)} m (was ${rest.toFixed(3)})`;
      return true;
    }],
    ['extra: building2: depth, connection settings and the angle set survive a save', () => {
      kit.reset();
      const a = kit.spawn('crate', 0, 0.45);
      const b = kit.spawn('crate', 0.5, 0.45);
      kit.advance(0.2);
      c.arrange.layer([a], 'front');
      if (!(a.zBase > b.zBase)) return 'Bring to front left it behind';
      C.create('rope', a.parts[0], at(a), b.parts[0], at(b), undefined, undefined, undefined, { hidden: true, strength: 'weak' });
      const json = saveToString(game);
      loadFromString(game, json);
      const [la, lb] = game.entities;
      if (!la || !lb || !(la.zBase > lb.zBase)) return 'loaded, the crate brought to front is behind again';
      const r = ofKind('rope')[0];
      if (!r?.opts?.hidden || r.opts.strength !== 'weak') return `loaded, the rope’s settings are ${JSON.stringify(r?.opts)}`;
      return true;
    }],
    ['extra: building2: Set angle, Arrange and Duplicate mirrored', () => {
      kit.reset();
      const a = kit.spawn('plank', 0, 2);
      const b = kit.spawn('plank', 2.5, 3);
      game.paused = true;
      c.arrange.setAngle([a], 90);
      if (Math.abs(c.arrange.angleOf(a) - 90) > 0.5) return `set to 90°, it is at ${c.arrange.angleOf(a).toFixed(1)}°`;
      c.arrange.arrange([a, b], 'bottom');
      const lo = (e: Entity) => boxOf([e])!.y0;
      if (Math.abs(lo(a) - lo(b)) > 0.03) return `aligned to the bottom, their bottoms are ${lo(a).toFixed(2)} and ${lo(b).toFixed(2)}`;
      const n = game.entities.length;
      c.arrange.duplicateMirrored([b]);
      game.paused = false;
      if (game.entities.length !== n + 1) return `Duplicate mirrored made ${game.entities.length - n}`;
      const m = game.entities[game.entities.length - 1];
      if (!(m.parts[0].x > b.parts[0].x)) return 'the mirrored copy is not beside it on the right';
      return true;
    }],
    ['extra: building2: things welded together into one keep apart as one (a rigid unit: no fighting inside it)', () => {
      kit.reset();
      const a = kit.spawn('crate', -0.4, 2);
      const b = kit.spawn('crate', 0.45, 2);
      const d = kit.spawn('crate', -0.2, 2.6);
      const [pa, pb, pd] = [a, b, d].map((e) => e.parts[0]);
      C.create('weld', pa, { x: 0.02, y: 2 }, pb, { x: 0.02, y: 2 });
      C.create('weld', pd, { x: 0.3, y: 2.4 }, pb, { x: 0.3, y: 2.4 });
      const rel = { x: pd.x - pa.x, y: pd.y - pa.y };
      kit.advance(1.5);
      const cg = game.contactGroups;
      if (!cg.unitOf(pa) || cg.unitOf(pa) !== cg.unitOf(pd)) return 'the three welded crates are not one unit';
      const moved = Math.hypot(pd.x - pa.x - rel.x, pd.y - pa.y - rel.y);
      if (moved > 0.05) return `the crate pushed into another of its unit moved ${moved.toFixed(3)} m against it`;
      if (kit.maxSpeed() > 0.05) return `the unit did not settle (${kit.maxSpeed().toFixed(3)} m/s)`;
      return true;
    }],
    ['extra: building2: a crate pushed into another with time paused is flagged, and Separate pushes it out', () => {
      kit.reset();
      const a = kit.spawn('crate', -2, 0.45);
      const b = kit.spawn('crate', 2, 0.45);
      kit.advance(0.3);
      game.paused = true;
      pausedDrag(at(b), { x: a.parts[0].x + 0.4, y: a.parts[0].y });
      const o = c.arrange.overlaps[0];
      if (!o) {
        game.paused = false;
        return 'pushed into the other crate, nothing was flagged';
      }
      c.arrange.separate(o);
      game.paused = false;
      if (c.arrange.liveOverlaps().length) return 'Separate left them pushed into each other';
      return true;
    }],
    ['extra: building2: held Q / E show where it goes (A turns it) and it’s placed as the key comes up', () => {
      kit.reset();
      c.arm(getItem('crate')!);
      kit.move(1, 2);
      kit.key('KeyE', true);
      frames();
      const g = c.placer.ghost;
      if (!g?.solid || game.entities.length) {
        kit.key('KeyE', false);
        c.arm(null);
        return 'holding E spawned at once, or showed no ghost';
      }
      kit.key('KeyA', true);
      kit.key('KeyA', false);
      kit.key('KeyE', false);
      c.arm(null);
      const e = game.entities[0];
      if (!e) return 'letting E go placed nothing';
      if (Math.abs(e.parts[0].x - 1) > 0.05) return `placed at x ${e.parts[0].x.toFixed(2)}, not the cursor’s 1`;
      const want = c.arrange.angleStep;
      if (Math.abs(e.parts[0].a - want) > 0.02) return `turned ${e.parts[0].a.toFixed(3)} rad by A, not ${want.toFixed(3)}`;
      return true;
    }],
    ['extra: building2: several selected things resize together by the corner of their box', () => {
      kit.reset();
      const a = kit.spawn('crate', -1, 2);
      const b = kit.spawn('crate', 1, 2);
      game.paused = true;
      const w0 = a.parts[0].w;
      c.selection = new Set([a, b]);
      c.arrange.startGroupResize();
      const g = c.arrange.group;
      if (!g) {
        game.paused = false;
        return 'no group resize';
      }
      const mx = (g.box.x0 + g.box.x1) / 2;
      const my = (g.box.y0 + g.box.y1) / 2;
      kit.move(mx + (g.box.x1 - mx) * 2, my + (g.box.y1 - my) * 2);
      c.arrange.updateGroupResize();
      c.arrange.applyGroupResize();
      game.paused = false;
      const now = game.entities.filter((e) => e.def.id === 'crate');
      if (now.length !== 2 || now.some((e) => Math.abs(e.parts[0].w - w0 * 2) > 2)) return `widths now ${now.map((e) => e.parts[0].w).join(', ')} (were ${w0})`;
      return true;
    }],
    ['extra: building2: a connection tool says where its end goes: snapped to a corner, with a label', () => {
      kit.reset();
      const a = kit.spawn('crate', 0, 0.45);
      kit.advance(0.3);
      const p = a.parts[0];
      c.snapping = true;
      c.setTool('weld');
      const corner = p.localToWorld((-p.w / 2) * (1 / 32), (p.h / 2) * (1 / 32));
      kit.move(corner.x + 0.01, corner.y - 0.01);
      frames(2);
      const h = c.connect.hover;
      const label = c.connect.label;
      c.setTool('drag');
      c.snapping = false;
      if (!h?.part || (h.kind !== 'corner' && h.kind !== 'attach')) return `near its corner the end would go to ${h?.kind ?? 'nothing'}`;
      if (Math.hypot(h.world.x - corner.x, h.world.y - corner.y) > 0.05) return 'the snapped end is not at the corner';
      if (!label.startsWith('Weld from')) return `the label says "${label}"`;
      return true;
    }],
    ['extra: building2: the Controls panel lists the building keys', () => {
      c.ui.toggleHelp();
      const text = document.querySelector('.help-panel')?.textContent ?? '';
      c.ui.toggleHelp();
      for (const want of ['Building', 'Bring to front', 'Back to build', 'Select the whole assembly']) if (!text.includes(want)) return `no "${want}" in the Controls panel`;
      return true;
    }],
  ];
}
