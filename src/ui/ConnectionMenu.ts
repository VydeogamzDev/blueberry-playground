import type { ContextAction } from '../world/types';
import { HINGE_LIMITS, PHYSICAL_KINDS, RIGID_KINDS, type Connection } from '../systems/Connections';
import { CONN_LABEL } from '../tools/ConnectTool';
import type { Controls, EditField } from '../tools/Controls';

/** A connection's menu title: what it is and what it joins. */
export function connectionTitle(k: Connection): string {
  const len = k.kind === 'rope' || k.kind === 'spring' || k.kind === 'fuse' ? ` ${k.rest.toFixed(2)} m` : '';
  return `${CONN_LABEL[k.kind]}${len}: ${k.a.entity.label} ↔ ${k.b ? k.b.entity.label : 'background'}`;
}

/**
 * The menu of a connection (right-clicked, or long-pressed, on its line or
 * knot): delete it, select what it joins, hide it, how strong it is, and its
 * own settings (a rope's length, a spring's stiffness, a hinge's swing, lighting
 * a fuse cord). People Playground's wires have a menu like this; here every
 * kind does.
 */
export function connectionActions(c: Controls, k: Connection): ContextAction[] {
  const tool = c.connect;
  const name = CONN_LABEL[k.kind].toLowerCase();
  const del = c.bindings.label('delete') || undefined;
  const acts: ContextAction[] = [];
  acts.push({ label: 'Delete', hint: del, danger: true, action: () => tool.unconnect([k], true) });
  acts.push({
    label: k.b ? 'Select both ends' : 'Select what it holds',
    action: () => {
      c.selection = new Set([k.a.entity, ...(k.b ? [k.b.entity] : [])]);
      c.refreshOutlines();
    },
  });
  const hidden = !!k.opts?.hidden;
  acts.push({ label: hidden ? 'Show' : 'Hide (shown while building)', action: () => tool.editConn(k, { hidden: hidden ? undefined : true }, hidden ? `Show ${name}` : `Hide ${name}`) });
  if (PHYSICAL_KINDS.has(k.kind)) {
    const now = k.opts?.strength ?? 'normal';
    for (const s of ['weak', 'normal', 'unbreakable'] as const) {
      acts.push({
        label: `Strength: ${s}`,
        checked: now === s,
        action: () => tool.editConn(k, { strength: s === 'normal' ? undefined : s }, 'Strength'),
      });
    }
  }
  // a weld's or hinge's parts: through each other (the usual), or knocking together
  if (RIGID_KINDS.has(k.kind) && k.b) {
    const on = !!k.opts?.collide;
    acts.push({ label: 'Its parts collide', checked: on, action: () => tool.editConn(k, { collide: on ? undefined : true }, on ? 'Parts pass through' : 'Parts collide') });
  }
  if (k.kind === 'rope' || k.kind === 'spring' || k.kind === 'fuse') {
    acts.push({ label: k.kind === 'spring' ? 'Length and damping…' : 'Length…', action: () => openLengthPanel(c, k) });
    acts.push({ label: 'Fit to the distance now', action: () => tool.setRest(k, distance(c, k)) });
  }
  if (k.kind === 'spring') acts.push(...tool.springActions(k));
  if (k.kind === 'hinge' || k.kind === 'pin') {
    const what = k.kind === 'pin' ? 'Pin' : 'Hinge';
    for (const deg of HINGE_LIMITS) {
      const rad = (deg * Math.PI) / 180;
      acts.push({
        label: deg ? `${what} swings ±${deg}°` : `${what} swings freely`,
        checked: deg ? k.limit !== undefined && Math.abs(k.limit - rad) < 1e-6 : k.limit === undefined,
        action: () => tool.setLimit(k, deg ? rad : null),
      });
    }
    acts.push({ label: 'Swing limit…', action: () => openSwingPanel(c, k) });
  }
  if (k.kind === 'fuse' && !k.burn) {
    acts.push({ label: `Light at the ${k.a.entity.label}’s end`, action: () => tool.lightFuse(k, 0) });
    acts.push({ label: `Light at the ${k.b ? `${k.b.entity.label}’s` : 'background'} end`, action: () => tool.lightFuse(k, 1) });
  }
  return acts;
}

/** How far apart its ends are now (m). */
function distance(c: Controls, k: Connection): number {
  const a = c.game.connections.endPoint(k, 'a');
  const b = c.game.connections.endPoint(k, 'b');
  return Math.max(0.02, Math.hypot(b.x - a.x, b.y - a.y));
}

/** A rope's, spring's or fuse cord's length (and a spring's damping) on sliders. */
function openLengthPanel(c: Controls, k: Connection): void {
  const C = c.game.connections;
  const rest0 = k.rest;
  const fields: EditField[] = [
    { key: 'length', label: 'Length', unit: 'm', min: 0.02, max: 40, step: 0.01, log: true, get: () => k.rest, set: (v) => c.connect.setRest(k, v) },
  ];
  if (k.kind === 'spring') {
    fields.push({
      key: 'damping', label: 'Damping', unit: '×', min: 0.1, max: 10, step: 0.1, log: true,
      get: () => k.opts?.damping ?? 1,
      set: (v) => c.connect.editConn(k, { damping: Math.abs(v - 1) < 1e-6 ? undefined : v }, 'Spring damping'),
    });
  }
  c.ui.editValues({
    label: 'Length…',
    title: `${CONN_LABEL[k.kind]}: ${k.a.entity.label} ↔ ${k.b ? k.b.entity.label : 'background'}`,
    fields,
    reset: () => {
      c.connect.setRest(k, rest0);
      if (k.kind === 'spring' && k.opts?.damping !== undefined) c.connect.editConn(k, { damping: undefined }, 'Spring damping');
    },
    alive: () => C.list.includes(k),
    buttons: [['Fit to the distance now', () => c.connect.setRest(k, distance(c, k))]],
  });
}

/** How far a hinge or pin may swing either way, on a slider (180°: freely). */
function openSwingPanel(c: Controls, k: Connection): void {
  const C = c.game.connections;
  c.ui.editValues({
    label: 'Swing limit…',
    title: `${CONN_LABEL[k.kind]}: ${k.a.entity.label} ↔ ${k.b ? k.b.entity.label : 'background'}`,
    fields: [{
      key: 'limit', label: 'Swings either way (180: freely)', unit: '°', min: 0, max: 180, step: 1,
      get: () => (k.limit === undefined ? 180 : Math.round((k.limit * 180) / Math.PI)),
      set: (v) => c.connect.setLimit(k, v >= 180 ? null : (v * Math.PI) / 180),
    }],
    reset: () => c.connect.setLimit(k, null),
    alive: () => C.list.includes(k),
    buttons: [['Lock straight', () => c.connect.setLimit(k, 0)], ['Free', () => c.connect.setLimit(k, null)]],
  });
}
