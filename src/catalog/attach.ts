import type { AttachPoint } from '../world/Part';
import type { Part } from '../world/Part';
import { MACHINES2_ATTACH } from '../art/machines2';
import { BALLOON_KNOT } from '../art/gear';
import { BIG_BALLOON_KNOT } from '../art/floats';

/**
 * The points connections snap to on machines and devices (see tools/AnchorSnap),
 * by kind and part name, in sprite pixels from the art's top-left corner: where
 * to fix a machine by (its mount), where to fix things to it (a rotor's axle, a
 * piston's plate), and a gate's or timer's ways in and out (its wire ports, on
 * the halves that are its inputs and its output).
 *
 * (A motor wheel's tyre has none: welded near its middle, the hub is what's
 * meant, and a pin finds the wheel's centre of mass by itself.)
 */
const ATTACH: Record<string, Record<string, AttachPoint[]>> = {
  motor: {
    Housing: [{ name: 'mount', x: 8, y: 8, role: 'mount' }],
    Rotor: [{ name: 'axle', x: 7, y: 7, role: 'axle' }],
  },
  'motor-wheel': {
    Housing: [{ name: 'hub', x: 7, y: 7, role: 'mount' }],
  },
  piston: {
    Cylinder: [{ name: 'base', x: 2, y: 6, role: 'mount' }],
    Rod: [{ name: 'plate', x: 40.5, y: 7, role: 'plate' }],
  },
  thruster: { Thruster: [{ name: 'mount', x: 13.5, y: 5, role: 'mount' }] },
  'jet-engine': { 'Jet Engine': [{ name: 'pylon', x: 23, y: 1, role: 'mount' }] },
  tap: { 'Water Tap': [{ name: 'flange', x: 0.5, y: 4.5, role: 'mount' }] },
  balloon: { Balloon: [{ name: 'knot', x: BALLOON_KNOT[0], y: BALLOON_KNOT[1], role: 'mount' }] },
  'big-balloon': { 'Big Balloon': [{ name: 'knot', x: BIG_BALLOON_KNOT[0], y: BIG_BALLOON_KNOT[1], role: 'mount' }] },
  battery: { Battery: [{ name: 'base', x: 5, y: 15.5, role: 'mount' }] },
  button: { Button: [{ name: 'base', x: 7, y: 5.5, role: 'mount' }] },
  switch: { Switch: [{ name: 'base', x: 7, y: 11.5, role: 'mount' }] },
  'reversing-switch': { 'Reversing Switch': [{ name: 'base', x: 8, y: 11.5, role: 'mount' }] },
  light: { 'Light Bulb': [{ name: 'base', x: 4, y: 11.5, role: 'mount' }] },
  sensor: {
    'Motion Sensor': [
      { name: 'base', x: 4.5, y: 8.5, role: 'mount' },
      { name: 'output', x: 0.5, y: 5, role: 'out' },
    ],
  },
  timer: {
    Timer: [
      { name: 'input', x: 0.5, y: 6, role: 'in' },
      { name: 'output', x: 13.5, y: 6, role: 'out' },
    ],
  },
};

const GATE_TWO: AttachPoint[] = [
  { name: 'input 1', x: 1, y: 3, role: 'in' },
  { name: 'input 2', x: 1, y: 9, role: 'in' },
  { name: 'output', x: 15, y: 6, role: 'out' },
];
for (const k of ['and', 'or', 'xor']) ATTACH[`gate-${k}`] = { [`${k.toUpperCase()} Gate`]: GATE_TWO };
ATTACH['gate-not'] = { 'NOT Gate': [{ name: 'input', x: 1, y: 3, role: 'in' }, { name: 'output', x: 15, y: 6, role: 'out' }] };
// the turrets, fans, magnet, coil and the logic and timing parts (their table sits with their art)
Object.assign(ATTACH, MACHINES2_ATTACH);

/** A part's attach points: its own (PartSpec.attach), else its kind's (by part name; a one-part thing's by its kind alone). */
export function attachPointsOf(p: Part): AttachPoint[] {
  if (p.attach) return p.attach;
  const byPart = ATTACH[p.entity.def.id];
  if (!byPart) return [];
  if (byPart[p.name]) return byPart[p.name];
  // (a prop's part is named after its kind, which a contraption's label can change: one list of points, one part)
  const lists = Object.values(byPart);
  return p.entity.parts.length === 1 && lists.length === 1 ? lists[0] : [];
}
