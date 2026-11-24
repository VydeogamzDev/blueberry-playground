/**
 * The keyboard commands and their keys. The defaults are People Playground's
 * (its Controls settings); the player can change them in the Controls panel
 * (F1), and their changes are kept (and synced: see Store).
 */
import { store } from '../engine/Store';

export type ActionId =
  | 'activate' | 'delete' | 'slowmo' | 'detail' | 'xray' | 'vitals' | 'time' | 'step'
  | 'spawnLeft' | 'spawnRight' | 'rotateLeft' | 'rotateRight' | 'fast' | 'undo' | 'snap' | 'copy' | 'paste'
  | 'freeze' | 'ignite' | 'noCollide' | 'flip' | 'jump' | 'eyedrop' | 'hoverHighlights' | 'disarm'
  | 'tool1' | 'tool2' | 'tool3' | 'tool4' | 'tool5' | 'tool6' | 'tool7' | 'tool8' | 'tool9' | 'toolPower'
  | 'menu' | 'toybox' | 'toggleUi' | 'help' | 'layout'
  | 'panLeft' | 'panRight' | 'panUp' | 'panDown' | 'zoomIn' | 'zoomOut' | 'recenter'
  | 'driveLeft' | 'driveRight' | 'aimUp' | 'aimDown' | 'turnLeft' | 'turnRight'
  | 'stage' | 'assist' | 'gear' | 'flaps' | 'chutes' | 'eject' | 'reload' | 'pilotFire' | 'boost' | 'chaseCam' | 'lights' | 'horn' | 'autopilot' | 'bombs' | 'flares' | 'rockets' | 'missiles'
  | 'com' | 'rewind' | 'layerFront' | 'layerBack' | 'gridSize' | 'angleStep';

export interface ActionSpec {
  id: ActionId;
  label: string;
  group: 'General' | 'Tools' | 'Building' | 'Interface' | 'Camera' | 'Vehicles';
  /** Default keys (KeyboardEvent.code); none means unbound until the player binds one. */
  keys: string[];
  /** Repeats while the key is held down (the keyboard's auto-repeat). */
  repeat?: boolean;
  /**
   * Shares its keys with this command on purpose (the arrows drive a selected
   * vehicle, and pan the camera otherwise: see Controls.frame()), so the pair
   * isn't shown as a clash.
   */
  shares?: ActionId;
}

/** What each tool key picks (see Controls.TOOL_SLOTS): the slot's key again steps through its kinds. */
const TOOL_NAMES = ['Drag', 'Rope; again: Fuse cord', 'Weld', 'Spring; again: stiffness', 'Pin; drag: hinge', 'Wire', 'Remove connections', 'Shape'];

export const ACTIONS: ActionSpec[] = [
  { id: 'activate', label: 'Activate object under cursor / held (hold for automatic fire)', group: 'General', keys: ['KeyF'] },
  { id: 'delete', label: 'Delete', group: 'General', keys: ['Backspace', 'Delete'] },
  { id: 'slowmo', label: 'Toggle slow motion (while placing, with Shift held: the grid’s size, then hidden)', group: 'General', keys: ['KeyG'] },
  { id: 'detail', label: 'Toggle detail view (limb status, blast radius)', group: 'General', keys: ['KeyS'] },
  // (not one of People Playground's: X was free)
  { id: 'xray', label: 'Toggle x-ray (the bones of people and animals)', group: 'General', keys: ['KeyX'] },
  { id: 'vitals', label: 'Keep the vitals of the person or animal under cursor / selected on screen', group: 'General', keys: [] },
  { id: 'time', label: 'Toggle time (pause)', group: 'General', keys: ['Space'] },
  { id: 'step', label: 'Step one tick', group: 'General', keys: ['Period'], repeat: true },
  { id: 'spawnLeft', label: 'Spawn facing left (placing with clicks: turn it left)', group: 'General', keys: ['KeyQ'] },
  { id: 'spawnRight', label: 'Spawn facing right (placing with clicks: turn it right)', group: 'General', keys: ['KeyE'] },
  { id: 'rotateLeft', label: 'Rotate left', group: 'General', keys: ['KeyA'] },
  { id: 'rotateRight', label: 'Rotate right', group: 'General', keys: ['KeyD'] },
  { id: 'fast', label: 'Speed up rotation / multiselect / while placing: snap to the grid', group: 'General', keys: ['ShiftLeft', 'ShiftRight'] },
  // (People Playground's Z takes back the last creation; here Z freezes, as players expect, and Ctrl+Z undoes)
  { id: 'undo', label: 'Remove the last creation', group: 'General', keys: [] },
  { id: 'snap', label: 'Snap to the grid and angle steps while moving (paused); connection ends: exactly at the cursor', group: 'General', keys: ['AltLeft'] },
  { id: 'copy', label: 'Copy', group: 'General', keys: ['KeyC'] },
  { id: 'paste', label: 'Paste', group: 'General', keys: ['KeyV'] },
  { id: 'freeze', label: 'Freeze / unfreeze (held while spawning: spawn frozen)', group: 'General', keys: ['KeyZ'] },
  { id: 'ignite', label: 'Ignite / extinguish', group: 'General', keys: [] },
  { id: 'noCollide', label: 'Disable / enable collision', group: 'General', keys: ['KeyN'] },
  { id: 'flip', label: 'Flip', group: 'General', keys: ['KeyR'] },
  { id: 'jump', label: 'Jump (people and animals)', group: 'General', keys: ['KeyJ'] },
  { id: 'eyedrop', label: 'Pick the object under the cursor to spawn', group: 'General', keys: [] },
  // (not People Playground's: there, a click on the picked item again puts it back, as here too; Esc does it as well)
  { id: 'disarm', label: 'Deselect the item picked in the toybox (stop spawning it)', group: 'General', keys: ['KeyB'] },
  { id: 'hoverHighlights', label: 'Toggle hovering highlights', group: 'General', keys: [] },
  ...Array.from({ length: 9 }, (_, i): ActionSpec => ({ id: `tool${i + 1}` as ActionId, label: `Switch to tool ${i + 1}${TOOL_NAMES[i] ? ` (${TOOL_NAMES[i]})` : ''} / power ${i + 1}`, group: 'Tools', keys: [`Digit${i + 1}`] })),
  { id: 'toolPower', label: 'Switch between tools and powers', group: 'Tools', keys: ['ControlLeft'] },
  { id: 'menu', label: 'Pause menu', group: 'Interface', keys: ['Escape'] },
  { id: 'toybox', label: 'Toggle toybox and tool bar', group: 'Interface', keys: ['Tab'] },
  { id: 'toggleUi', label: 'Toggle interface', group: 'Interface', keys: [] },
  { id: 'help', label: 'Controls (this list)', group: 'Interface', keys: ['F1', 'KeyH'] },
  // (not People Playground's: its interface stays put; unbound, as Settings and the pause menu have it)
  { id: 'layout', label: 'Edit layout (move, size and hide the pieces of the interface)', group: 'Interface', keys: [] },
  { id: 'panLeft', label: 'Move camera left', group: 'Camera', keys: ['ArrowLeft'] },
  { id: 'panRight', label: 'Move camera right', group: 'Camera', keys: ['ArrowRight'] },
  { id: 'panUp', label: 'Move camera up', group: 'Camera', keys: ['ArrowUp'] },
  { id: 'panDown', label: 'Move camera down', group: 'Camera', keys: ['ArrowDown'] },
  { id: 'zoomIn', label: 'Zoom in', group: 'Camera', keys: ['NumpadAdd', 'Equal'] },
  { id: 'zoomOut', label: 'Zoom out', group: 'Camera', keys: ['NumpadSubtract', 'Minus'] },
  { id: 'recenter', label: 'Recenter camera', group: 'Camera', keys: ['Home'] },
  // (not People Playground's: its vehicles drive themselves; here W A S D drive what's selected, the arrows
  // being the camera's. While a vehicle is selected, and nothing's dragged, A and D drive it rather than turn
  // it, and S lowers a tank's gun rather than showing the detail view: see Controls.drives())
  // (a build with engines in it, selected, is flown by the same keys: W and S its throttle, A and D move it,
  // Q and E turn it, rather than spawning facing left or right: see systems/Piloting)
  { id: 'driveLeft', label: 'Drive the selected vehicles left (forward or in reverse); move what you fly left', group: 'Vehicles', keys: ['KeyA'], shares: 'rotateLeft' },
  { id: 'driveRight', label: 'Drive the selected vehicles right (forward or in reverse); move what you fly right', group: 'Vehicles', keys: ['KeyD'], shares: 'rotateRight' },
  { id: 'aimUp', label: 'Aim the selected tanks up (raise their barrels); throttle up what you fly', group: 'Vehicles', keys: ['KeyW'] },
  { id: 'aimDown', label: 'Aim the selected tanks down (lower their barrels); throttle down what you fly', group: 'Vehicles', keys: ['KeyS'], shares: 'detail' },
  { id: 'turnLeft', label: 'Turn what you fly anticlockwise; tilt a vehicle in the air back', group: 'Vehicles', keys: ['KeyQ'], shares: 'spawnLeft' },
  { id: 'turnRight', label: 'Turn what you fly clockwise; tilt a vehicle in the air forward', group: 'Vehicles', keys: ['KeyE'], shares: 'spawnRight' },
  // (0.4.0: every letter's taken, so the flying orders are on the keys round Enter)
  { id: 'stage', label: 'Fire the next stage of what you fly (decouplers, boosters, chutes: see each part’s Stage)', group: 'Vehicles', keys: ['Enter'] },
  { id: 'assist', label: 'Stability assist on or off for what you fly (holds its angle, stops it spinning)', group: 'Vehicles', keys: ['Backquote'] },
  { id: 'gear', label: 'Landing gear and legs up or down (an aircraft’s only off the ground)', group: 'Vehicles', keys: ['BracketLeft'] },
  // (0.5.1: the flaps had [ and the gear none; with an aircraft selected, . sets its flaps rather than stepping time)
  { id: 'flaps', label: 'Flaps of the selected aircraft: up, half, down', group: 'Vehicles', keys: ['Period'], shares: 'step' },
  { id: 'chutes', label: 'Open the parachutes (again: cut them away)', group: 'Vehicles', keys: ['BracketRight'] },
  // (0.5.1: ' reloads; eject moved to /, the horn to no key)
  { id: 'eject', label: 'Eject (the pilot of an ejection seat)', group: 'Vehicles', keys: ['Slash'] },
  { id: 'reload', label: 'Reload every weapon in what’s selected or flown, and in what it’s built with (guns, rockets, bombs, missiles, flares)', group: 'Vehicles', keys: ['Quote'] },
  { id: 'pilotFire', label: 'Hold: fire the guns built into what you fly', group: 'Vehicles', keys: ['Backslash'] },
  { id: 'boost', label: 'Hold: boost (nitro, afterburners)', group: 'Vehicles', keys: ['Semicolon'] },
  { id: 'lights', label: 'Headlights on or off in what you fly', group: 'Vehicles', keys: ['Comma'] },
  { id: 'horn', label: 'Sound the horn of what you fly', group: 'Vehicles', keys: [] },
  { id: 'autopilot', label: 'Autopilot on or off for what you fly (holds its height and heading)', group: 'Vehicles', keys: ['Insert'] },
  { id: 'bombs', label: 'Drop a bomb from the bomb bays of what you fly', group: 'Vehicles', keys: ['Digit0'] },
  { id: 'flares', label: 'Fire flares from what you fly (heat-seeking missiles chase them instead)', group: 'Vehicles', keys: ['CapsLock'] },
  { id: 'rockets', label: 'Fire a rocket from the rocket pods of what you fly', group: 'Vehicles', keys: ['Digit9'] },
  // (0.5.1: with an aircraft selected, 8 fires a heat seeker rather than picking tool 8)
  { id: 'missiles', label: 'Fire a heat-seeking missile from the selected aircraft', group: 'Vehicles', keys: ['Digit8'], shares: 'tool8' },
  { id: 'chaseCam', label: 'Chase camera on or off (follows what you fly, zooming out with speed)', group: 'Camera', keys: ['End'] },
  // building (not People Playground's keys: it has no layers, grids or checkpoints to reach)
  { id: 'com', label: 'Hold: connection ends go at the centre of mass', group: 'Building', keys: ['KeyM'] },
  { id: 'rewind', label: 'Back to build (the scene as it was before Play; also Shift + Toggle time)', group: 'Building', keys: [] },
  { id: 'layerFront', label: 'Bring to front', group: 'Building', keys: ['PageUp'] },
  { id: 'layerBack', label: 'Send to back', group: 'Building', keys: ['PageDown'] },
  { id: 'gridSize', label: 'Next grid size (snapping)', group: 'Building', keys: [] },
  { id: 'angleStep', label: 'Next angle step (snapping)', group: 'Building', keys: [] },
];

const STORE = 'blueberry-bindings';

/** Modifier keys: a command bound to one fires when it's released untouched (Ctrl alone, not Ctrl+Z). */
export const isModifier = (code: string): boolean => /^(Shift|Control|Alt|Meta)(Left|Right)$/.test(code);

const NAMES: Record<string, string> = {
  Space: 'Space', Backspace: 'Backspace', Delete: 'Del', Escape: 'Esc', Tab: 'Tab', Enter: 'Enter', Period: '.', Comma: ',',
  Equal: '=', Minus: '−', Slash: '/', Backslash: '\\', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Backquote: '`',
  ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', NumpadAdd: 'Num +', NumpadSubtract: 'Num −',
  NumpadMultiply: 'Num *', NumpadDivide: 'Num /', NumpadEnter: 'Num Enter', NumpadDecimal: 'Num .',
  ShiftLeft: 'Left Shift', ShiftRight: 'Right Shift', ControlLeft: 'Left Ctrl', ControlRight: 'Right Ctrl',
  AltLeft: 'Left Alt', AltRight: 'Right Alt', MetaLeft: 'Left Meta', MetaRight: 'Right Meta', PageUp: 'Page Up', PageDown: 'Page Down',
};

/** A key's name for people: KeyF -> F, Digit1 -> 1, Numpad4 -> Num 4. */
export function keyName(code: string): string {
  if (NAMES[code]) return NAMES[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  return code;
}

/** The keys bound to each command: the defaults, with the player's changes over them. */
export class Bindings {
  private map = new Map<ActionId, string[]>();
  /** Called after any change (to redraw the key hints). */
  onChange: () => void = () => {};

  constructor() {
    this.reset(false);
    try {
      const saved = JSON.parse(store.getItem(STORE) ?? '{}') as Record<string, unknown>;
      for (const a of ACTIONS) {
        const v = saved[a.id];
        if (Array.isArray(v) && v.every((k) => typeof k === 'string')) this.map.set(a.id, v as string[]);
      }
    } catch {
      /* no storage (or a broken entry): the defaults */
    }
  }

  keys(id: ActionId): string[] {
    return this.map.get(id) ?? [];
  }

  /** The commands a key is bound to. */
  actionsFor(code: string): ActionId[] {
    const out: ActionId[] = [];
    for (const [id, keys] of this.map) if (keys.includes(code)) out.push(id);
    return out;
  }

  /** The keys of a command for people ("Backspace / Del"), or '' if unbound. */
  label(id: ActionId): string {
    return this.keys(id).map(keyName).join(' / ');
  }

  set(id: ActionId, keys: string[]): void {
    this.map.set(id, keys);
    this.save();
  }

  /** Back to People Playground's keys. */
  reset(save = true): void {
    for (const a of ACTIONS) this.map.set(a.id, [...a.keys]);
    if (save) this.save();
  }

  private save(): void {
    try {
      const changed: Record<string, string[]> = {};
      for (const a of ACTIONS) {
        const k = this.keys(a.id);
        if (k.join() !== a.keys.join()) changed[a.id] = k;
      }
      store.setItem(STORE, JSON.stringify(changed));
    } catch {
      /* not kept: fine for this visit */
    }
    this.onChange();
  }
}
