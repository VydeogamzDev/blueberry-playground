import * as THREE from 'three';
import { RAPIER } from '../engine/Physics';
import { MAX_ZOOM, MIN_ZOOM, PX, WORLD } from '../engine/constants';
import { makePixelMaterial, makePixelTexture, UNIT_QUAD, type PixelMaterial } from '../engine/Renderer';
import { clamp, type V2 } from '../engine/math';
import type { Game } from '../world/Game';
import type { Entity } from '../world/Entity';
import type { Part } from '../world/Part';
import type { ContextAction, ItemDef } from '../world/types';
import { capture, instantiate, type Snapshot } from '../world/Snapshot';
import type { ConnKind } from '../systems/Connections';

export interface UIBridge {
  openContextMenu(sx: number, sy: number, title: string, actions: ContextAction[]): void;
  closeContextMenu(): void;
  isMenuOpen(): boolean;
  toast(msg: string): void;
  onArmedChanged(def: ItemDef | null): void;
  toggleCatalog(): void;
  toggleHelp(): void;
  /** Switches the touch layout on (a finger touched the sandbox) or off (a mouse was used). */
  setTouchMode(on: boolean): void;
  refreshToolbar(): void;
  save(): void;
  load(): void;
}

interface Grab {
  part: Part;
  local: V2;
  anchor: RAPIER.RigidBody | null;
  joint: RAPIER.ImpulseJoint | null;
  frozenMove: boolean;
  offset: V2;
  savedDamping: number;
  /** Where the hand holding it is (it follows the cursor, see preStep()). */
  at: V2;
}

/**
 * Drag spring tuning (stiffness per kg, damping as a fraction of stiffness), and
 * how fast the hand can follow the cursor (m/s: about a hard throw).
 */
export const DRAG = { stiffness: 170, damping: 0.01, maxSpeed: 25 };

const SELECT_COLOR = 0xf2d16b;
const HOVER_COLOR = 0x9aa3ad;
/** A finger held this long without moving opens the context menu. */
const LONG_PRESS_MS = 500;
/** Screen pixels a finger may wander and still be a long press. */
const PRESS_SLOP = 10;

/** Mouse + keyboard interaction with the sandbox (PP-style). */
export class Controls {
  private game: Game;
  ui!: UIBridge;
  sx = 0;
  sy = 0;
  wx = 0;
  wy = 0;
  private keys = new Set<string>();
  armed: ItemDef | null = null;
  selection = new Set<Entity>();
  hover: Part | null = null;
  grab: Grab | null = null;
  private box: { x0: number; y0: number; additive: boolean } | null = null;
  private pan: { sx: number; sy: number; camX: number; camY: number } | null = null;
  private connect: { part: Part; wx: number; wy: number } | null = null;
  private clipboard: Snapshot | null = null;
  private spawnAngle = 0;
  private spawnFlip = false;
  private ghost: THREE.Mesh | null = null;
  private ghostMat: PixelMaterial | null = null;
  private boxEl: HTMLDivElement;
  private outlined = new Set<Part>();
  private activated = new Set<Entity>();

  // touch: fingers that went down on the sandbox, by pointer id
  private touches = new Map<number, { x: number; y: number }>();
  /** The finger that acts like the mouse; a second one pinches. */
  private primary = -1;
  private pinch: { d0: number; zoom0: number; wx: number; wy: number } | null = null;
  /** After a pinch or a long press, the finger left down does nothing until lifted. */
  private touchIdle = false;
  private press: { sx: number; sy: number; timer: number } | null = null;
  /** Where a finger went down on empty space, until it moves or turns into a long press. */
  private tapAt: { sx: number; sy: number } | null = null;
  /** The last pointer used was a finger (touch layout, no hover). */
  touchMode = false;

  constructor(game: Game, canvas: HTMLCanvasElement) {
    this.game = game;
    this.boxEl = document.createElement('div');
    this.boxEl.className = 'select-box';
    document.body.appendChild(this.boxEl);

    canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    window.addEventListener('pointermove', (e) => this.onMove(e));
    window.addEventListener('pointerup', (e) => this.onUp(e));
    window.addEventListener('pointercancel', (e) => this.onUp(e));
    canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.releaseActivation();
    });

    game.preStepHandlers.push((dt) => this.preStep(dt));
    game.frameHandlers.push((dt) => this.frame(dt));
    game.hooks.onEntityRemoved = (e) => {
      this.selection.delete(e);
      this.activated.delete(e);
      if (this.grab && this.grab.part.entity === e) this.endGrab();
      if (this.hover && this.hover.entity === e) this.hover = null;
      for (const p of e.parts) this.outlined.delete(p);
    };
    game.hooks.onPartRemoved = (p) => {
      if (this.grab && this.grab.part === p) this.endGrab();
      if (this.hover === p) this.hover = null;
      if (this.connect && this.connect.part === p) this.connect = null;
      this.outlined.delete(p);
    };
  }

  private pickRadius(): number {
    return 7 / this.game.renderer.zoom;
  }

  private updateMouse(e: { clientX: number; clientY: number }): void {
    this.sx = e.clientX;
    this.sy = e.clientY;
    const w = this.game.renderer.screenToWorld(this.sx, this.sy);
    this.wx = w.x;
    this.wy = w.y;
  }

  // ---- arming / tools -----------------------------------------------------

  arm(def: ItemDef | null): void {
    if (this.armed === def) def = null;
    this.armed = def;
    this.spawnAngle = 0;
    this.connect = null;
    this.game.connections.preview = null;
    if (this.ghost) {
      this.game.renderer.scene.remove(this.ghost);
      this.ghostMat?.dispose();
      this.ghost = null;
    }
    if (def && !def.tool) {
      const canvas = def.preview();
      const tex = makePixelTexture(canvas);
      this.ghostMat = makePixelMaterial(tex, canvas.width, canvas.height, true);
      this.ghost = new THREE.Mesh(UNIT_QUAD, this.ghostMat);
      this.ghost.scale.set(canvas.width * PX, canvas.height * PX, 1);
      this.ghost.position.z = 40;
      this.ghost.renderOrder = 15;
      this.game.renderer.scene.add(this.ghost);
    }
    this.ui?.onArmedChanged(this.armed);
  }

  get toolKind(): ConnKind | 'remove' | null {
    return (this.armed?.tool as ConnKind | 'remove' | undefined) ?? null;
  }

  // ---- pointer --------------------------------------------------------------

  private onDown(e: PointerEvent): void {
    this.game.sound.unlock();
    const touch = e.pointerType === 'touch';
    if (touch !== this.touchMode) {
      this.touchMode = touch;
      this.ui.setTouchMode(touch);
    }
    if (touch && this.touchDown(e)) return;
    this.updateMouse(e);
    if (this.ui.isMenuOpen()) {
      this.ui.closeContextMenu();
      if (touch) {
        // the tap that closes a menu does nothing else, however long it's held
        this.cancelPress();
        this.touchIdle = true;
      }
      if (e.button !== 2) return;
    }
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);

    if (e.button === 1) {
      e.preventDefault();
      this.pan = { sx: this.sx, sy: this.sy, camX: this.game.renderer.camX, camY: this.game.renderer.camY };
      return;
    }
    if (e.button === 2) {
      this.openMenuAtCursor();
      return;
    }
    if (e.button !== 0) return;

    const tool = this.toolKind;
    if (tool) {
      this.toolDown(tool);
      return;
    }
    const part = this.game.pick(this.wx, this.wy, this.pickRadius());
    if (part) {
      const ent = part.entity;
      if (e.shiftKey) {
        if (this.selection.has(ent)) this.selection.delete(ent);
        else this.selection.add(ent);
      } else if (!this.selection.has(ent)) {
        this.selection.clear();
        this.selection.add(ent);
      }
      this.refreshOutlines();
      this.startGrab(part, this.wx, this.wy);
      return;
    }
    if (this.armed && !touch) {
      this.spawnArmed();
      return;
    }
    if (touch) {
      // a finger on empty space moves the view; a tap (lifted before it moves or
      // becomes a long press) spawns the armed item or deselects
      this.pan = { sx: this.sx, sy: this.sy, camX: this.game.renderer.camX, camY: this.game.renderer.camY };
      this.tapAt = { sx: this.sx, sy: this.sy };
      return;
    }
    if (!e.shiftKey) this.selection.clear();
    this.refreshOutlines();
    this.box = { x0: this.wx, y0: this.wy, additive: e.shiftKey };
  }

  /**
   * Touch bookkeeping. The first finger acts like the mouse (and a long press is
   * a right click); a second one stops that and the two pinch-zoom and pan.
   * Returns true when this finger is handled here rather than as a click.
   */
  private touchDown(e: PointerEvent): boolean {
    this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.touches.size === 1) {
      this.primary = e.pointerId;
      this.touchIdle = false;
      this.startPress(e.clientX, e.clientY);
      return false;
    }
    this.cancelPress();
    this.cancelGesture();
    this.touchIdle = true;
    const [a, b] = [...this.touches.values()];
    const r = this.game.renderer;
    const w = r.screenToWorld((a.x + b.x) / 2, (a.y + b.y) / 2);
    this.pinch = { d0: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), zoom0: r.zoom, wx: w.x, wy: w.y };
    return true;
  }

  /** Two fingers: the spread sets the zoom and the world point first between them stays between them. */
  private updatePinch(): void {
    const p = this.pinch!;
    const [a, b] = [...this.touches.values()];
    const r = this.game.renderer;
    r.zoom = clamp((p.zoom0 * Math.hypot(a.x - b.x, a.y - b.y)) / p.d0, MIN_ZOOM, MAX_ZOOM);
    r.targetZoom = r.zoom;
    const w = r.screenToWorld((a.x + b.x) / 2, (a.y + b.y) / 2);
    r.camX += p.wx - w.x;
    r.camY += p.wy - w.y;
    r.clampCamera();
  }

  private startPress(sx: number, sy: number): void {
    this.cancelPress();
    const timer = window.setTimeout(() => {
      this.press = null;
      this.cancelGesture();
      this.touchIdle = true;
      this.openMenuAtCursor();
    }, LONG_PRESS_MS);
    this.press = { sx, sy, timer };
  }

  private cancelPress(): void {
    if (!this.press) return;
    clearTimeout(this.press.timer);
    this.press = null;
  }

  /** Drops whatever a press started: a drag, a pan, a box, a connection. */
  private cancelGesture(): void {
    this.endGrab();
    this.pan = null;
    this.tapAt = null;
    this.box = null;
    this.boxEl.style.display = 'none';
    this.connect = null;
    this.game.connections.preview = null;
  }

  private onMove(e: PointerEvent): void {
    if (e.pointerType === 'touch') {
      // fingers on the UI (holding a touch-bar button) don't move the cursor
      const t = this.touches.get(e.pointerId);
      if (!t) return;
      t.x = e.clientX;
      t.y = e.clientY;
      if (this.pinch) {
        this.updatePinch();
        return;
      }
      if (e.pointerId !== this.primary || this.touchIdle) return;
      if (this.press && Math.hypot(e.clientX - this.press.sx, e.clientY - this.press.sy) > PRESS_SLOP) this.cancelPress();
      if (this.tapAt && Math.hypot(e.clientX - this.tapAt.sx, e.clientY - this.tapAt.sy) > PRESS_SLOP) this.tapAt = null;
    }
    this.updateMouse(e);
    if (this.pan) {
      const r = this.game.renderer;
      r.camX = this.pan.camX - (this.sx - this.pan.sx) / r.zoom;
      r.camY = this.pan.camY + (this.sy - this.pan.sy) / r.zoom;
      r.clampCamera();
    }
    if (this.box) {
      const a = this.game.renderer.worldToScreen(this.box.x0, this.box.y0);
      const x = Math.min(a.x, this.sx);
      const y = Math.min(a.y, this.sy);
      Object.assign(this.boxEl.style, {
        display: 'block', left: x + 'px', top: y + 'px', width: Math.abs(this.sx - a.x) + 'px', height: Math.abs(this.sy - a.y) + 'px',
      });
    }
    if (this.connect) {
      const p = this.connect;
      this.game.connections.preview = { x0: p.wx, y0: p.wy, x1: this.wx, y1: this.wy, kind: this.toolKind as ConnKind };
    }
  }

  private onUp(e: PointerEvent): void {
    const touch = e.pointerType === 'touch';
    if (touch) {
      if (!this.touches.delete(e.pointerId)) return;
      this.cancelPress();
      if (this.touches.size < 2) this.pinch = null;
      const wasPrimary = e.pointerId === this.primary;
      if (!this.touches.size) this.primary = -1;
      if (!wasPrimary || this.touchIdle) {
        if (!this.touches.size) this.touchIdle = false;
        this.tapAt = null;
        return;
      }
      this.pan = null;
      if (this.tapAt && e.type === 'pointerup') {
        this.tapAt = null;
        this.updateMouse(e);
        if (this.armed) this.spawnArmed();
        else this.clearSelection();
        return;
      }
      this.tapAt = null;
    }
    // a cancelled pointer (the browser took the gesture over) ends everything like a release
    if (e.type === 'pointercancel') {
      this.cancelGesture();
      return;
    }
    this.updateMouse(e);
    if (e.button === 1) this.pan = null;
    if (e.button !== 0) return;
    if (this.grab) this.endGrab();
    if (this.box) {
      const ents = this.game.entitiesInRect(this.box.x0, this.box.y0, this.wx, this.wy);
      for (const en of ents) this.selection.add(en);
      this.box = null;
      this.boxEl.style.display = 'none';
      this.refreshOutlines();
    }
    if (this.connect) this.toolUp();
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    if (this.armed && !this.armed.tool && (e.shiftKey || e.altKey)) {
      this.spawnAngle += Math.sign(e.deltaY) * (Math.PI / 12);
      return;
    }
    const f = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0016));
    this.game.renderer.zoomAt(this.sx, this.sy, f);
  }

  // ---- grabbing -------------------------------------------------------------

  private startGrab(part: Part, wx: number, wy: number): void {
    this.endGrab();
    const local = part.worldToLocal(wx, wy);
    const g: Grab = {
      part, local, anchor: null, joint: null, frozenMove: part.frozen,
      offset: { x: part.x - wx, y: part.y - wy }, savedDamping: part.body.angularDamping(), at: { x: wx, y: wy },
    };
    if (!part.frozen) {
      const world = this.game.physics.world;
      g.anchor = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(wx, wy));
      // Stiffness scales with the dragged entity's mass so everything follows the
      // cursor with the same feel. The spring is solved implicitly by Rapier, which
      // keeps articulated chains (ragdoll limbs) stable under strong pulls.
      const M = Math.max(part.mass, part.entity.dragMass());
      const k = M * DRAG.stiffness;
      // keep damping low: Rapier's soft springs lose stiffness as damping grows
      const c = k * DRAG.damping;
      g.joint = world.createImpulseJoint(RAPIER.JointData.spring(0, k, c, { x: 0, y: 0 }, local), g.anchor, part.body, true);
      g.joint.setContactsEnabled(false);
      part.body.setAngularDamping(Math.max(g.savedDamping, 1.5));
      part.body.wakeUp();
    }
    this.grab = g;
    part.entity.onGrab(part, true);
  }

  endGrab(): void {
    const g = this.grab;
    if (!g) return;
    this.grab = null;
    const world = this.game.physics.world;
    if (g.joint && g.joint.isValid()) world.removeImpulseJoint(g.joint, true);
    if (g.anchor && g.anchor.isValid()) world.removeRigidBody(g.anchor);
    if (!g.part.destroyed) {
      g.part.body.setAngularDamping(g.savedDamping);
      g.part.entity.onGrab(g.part, false, { x: this.wx, y: this.wy });
    }
  }

  private preStep(dt: number): void {
    const g = this.grab;
    if (!g) return;
    if (g.part.destroyed) {
      this.endGrab();
      return;
    }
    const tx = clamp(this.wx, WORLD.left + 0.05, WORLD.right - 0.05);
    const ty = clamp(this.wy, WORLD.floor + 0.02, WORLD.ceiling - 0.05);
    if (g.frozenMove) {
      if (!g.part.frozen) {
        // was unfrozen while held: switch to physical dragging
        this.startGrab(g.part, tx, ty);
        return;
      }
      const ent = g.part.entity;
      const nx = tx + g.offset.x;
      const ny = ty + g.offset.y;
      const dx = nx - g.part.x;
      const dy = ny - g.part.y;
      if (Math.abs(dx) + Math.abs(dy) > 1e-5) {
        if (ent.frozen) ent.translate(dx, dy);
        else g.part.teleport(nx, ny, g.part.body.rotation());
      }
      const rot = this.rotateInput();
      if (rot !== 0) {
        const c = g.part.body.translation();
        if (ent.frozen) ent.rotateAbout(c.x, c.y, rot * 0.025);
        else g.part.teleport(c.x, c.y, g.part.body.rotation() + rot * 0.025);
      }
      return;
    }
    // the hand chases the cursor no faster than a hard throw: a cursor that jumps
    // (a dropped frame, a tap on a touch screen) would fling it at hundreds of m/s
    const dx = tx - g.at.x;
    const dy = ty - g.at.y;
    const d = Math.hypot(dx, dy);
    const most = DRAG.maxSpeed * dt;
    g.at = d > most ? { x: g.at.x + (dx / d) * most, y: g.at.y + (dy / d) * most } : { x: tx, y: ty };
    g.anchor?.setNextKinematicTranslation(g.at);
    const rot = this.rotateInput();
    if (rot !== 0) {
      const b = g.part.body;
      const target = rot * 5;
      b.setAngvel(b.angvel() + (target - b.angvel()) * 0.2, true);
    }
  }

  private rotateInput(): number {
    let r = 0;
    if (this.keys.has('KeyQ')) r += 1;
    if (this.keys.has('KeyE')) r -= 1;
    return r;
  }

  // ---- connection tools -------------------------------------------------------

  private toolDown(tool: ConnKind | 'remove'): void {
    const part = this.game.pick(this.wx, this.wy, this.pickRadius());
    if (tool === 'remove') {
      if (part) {
        const conns = this.game.connections.connectionsOf(part.entity);
        // remove connections whose anchor is near the cursor, else all on the entity
        const near = conns.filter((c) => {
          const pa = c.a.localToWorld(c.la.x, c.la.y);
          return Math.hypot(pa.x - this.wx, pa.y - this.wy) < 0.3;
        });
        const list = near.length ? near : conns;
        for (const c of list) this.game.connections.remove(c);
        if (list.length) this.game.sound.snap(this.wx);
      }
      return;
    }
    if (!part) {
      this.ui.toast('Click on an object to start the connection');
      return;
    }
    if (tool === 'pin') {
      this.game.connections.create('pin', part, { x: this.wx, y: this.wy }, null, { x: this.wx, y: this.wy });
      this.game.sound.place(this.wx, 'metal');
      return;
    }
    this.connect = { part, wx: this.wx, wy: this.wy };
  }

  private toolUp(): void {
    const c = this.connect!;
    this.connect = null;
    this.game.connections.preview = null;
    const tool = this.toolKind as ConnKind;
    if (c.part.destroyed) return;
    const target = this.game.pick(this.wx, this.wy, this.pickRadius(), (p) => p !== c.part);
    const moved = Math.hypot(this.wx - c.wx, this.wy - c.wy);
    if (!target) {
      if (tool === 'wire') {
        this.ui.toast('Wires must connect two objects');
        return;
      }
      if (tool === 'weld' || tool === 'hinge') {
        // joins whatever overlaps the start point, else fixes it to the background there
        const under = this.game.pick(c.wx, c.wy, 0, (p) => p !== c.part && !p.entity.parts.includes(c.part));
        this.game.connections.create(tool, c.part, { x: c.wx, y: c.wy }, under ?? null, { x: c.wx, y: c.wy });
        this.game.sound.place(c.wx, 'metal');
        return;
      }
      if (moved < 0.05) return;
      this.game.connections.create(tool, c.part, { x: c.wx, y: c.wy }, null, { x: this.wx, y: this.wy });
    } else {
      this.game.connections.create(tool, c.part, { x: c.wx, y: c.wy }, target, { x: this.wx, y: this.wy });
    }
    this.game.sound.place(this.wx, tool === 'rope' || tool === 'wire' ? 'wood' : 'metal');
  }

  // ---- spawning -------------------------------------------------------------

  private spawnArmed(): void {
    const def = this.armed;
    if (!def || !def.create) return;
    const hh = def.halfHeight ?? 0.3;
    const y = Math.max(this.wy, WORLD.floor + hh * Math.abs(Math.cos(this.spawnAngle)) + 0.01);
    const e = this.game.spawn(def, this.wx, y, { angle: this.spawnAngle, flip: this.spawnFlip });
    if (e) this.game.sound.place(this.wx, e.parts[0]?.mat.sound ?? 'wood');
  }

  // ---- selection helpers --------------------------------------------------------

  /** Entities affected by a keyboard command: selection, else the hovered entity. */
  targets(): Entity[] {
    if (this.selection.size) return [...this.selection].filter((e) => !e.destroyed);
    if (this.hover && !this.hover.entity.destroyed) return [this.hover.entity];
    return [];
  }

  refreshOutlines(): void {
    const want = new Map<Part, number>();
    for (const e of this.selection) for (const p of e.parts) if (!p.destroyed) want.set(p, SELECT_COLOR);
    if (this.hover && !this.hover.destroyed && !want.has(this.hover)) want.set(this.hover, HOVER_COLOR);
    for (const p of this.outlined) if (!want.has(p) && !p.destroyed) p.setOutline(false);
    for (const [p, c] of want) p.setOutline(true, c);
    this.outlined = new Set(want.keys());
  }

  selectAll(): void {
    this.selection = new Set(this.game.entities);
    this.refreshOutlines();
  }

  clearSelection(): void {
    this.selection.clear();
    this.refreshOutlines();
  }

  deleteEntities(list: Entity[]): void {
    for (const e of list) this.game.remove(e);
    this.refreshOutlines();
  }

  toggleFreeze(list: Entity[]): void {
    if (!list.length) return;
    const freeze = !list.every((e) => e.frozen);
    for (const e of list) e.setFrozen(freeze);
    this.game.sound.click(this.wx, freeze ? 0.5 : 0.65);
  }

  activate(list: Entity[], held: boolean): void {
    for (const e of list) {
      if (held) {
        if (!this.activated.has(e)) {
          e.activate();
          e.setActiveHeld(true);
          this.activated.add(e);
        }
      }
    }
  }

  releaseActivation(): void {
    for (const e of this.activated) e.setActiveHeld(false);
    this.activated.clear();
  }

  // ---- the touch bar: the keyboard commands for fingers ---------------------------

  /** What the touch bar acts on: the object being dragged, else the selection. */
  touchTargets(): Entity[] {
    if (this.grab && !this.grab.part.entity.destroyed) return [this.grab.part.entity];
    return [...this.selection].filter((e) => !e.destroyed);
  }

  /**
   * Holding a rotate button (dir 1 is Q, -1 is E): turns the dragged object while
   * held, or turns the selection 15 degrees per press.
   */
  holdRotate(dir: 1 | -1, on: boolean): void {
    const key = dir === 1 ? 'KeyQ' : 'KeyE';
    if (!on) {
      this.keys.delete(key);
      return;
    }
    this.keys.add(key);
    if (!this.grab) this.rotateSelection(this.touchTargets(), (dir * Math.PI) / 12);
  }

  /** The context menu for the selection, at a screen point (the touch bar's More). */
  openMenuForSelection(sx: number, sy: number): void {
    const e = this.touchTargets()[0];
    const part = e?.parts.find((p) => !p.destroyed);
    if (!part) return;
    this.sx = sx;
    this.sy = sy;
    this.openMenuFor(part);
  }

  /** Serialized clone of entities offset by (dx, dy). */
  /** Duplicates keep held items, lodged blades and connections inside the selection. */
  duplicate(list: Entity[]): void {
    if (!list.length) return;
    const made = instantiate(this.game, capture(this.game, this.withAttached(list)), { dx: 0.6, dy: 0.3 });
    this.selection = new Set(made);
    this.refreshOutlines();
  }

  copy(list: Entity[]): void {
    if (!list.length) return;
    this.clipboard = capture(this.game, this.withAttached(list));
    this.ui.toast(`Copied ${list.length} object${list.length > 1 ? 's' : ''}`);
  }

  /** The list plus anything those entities hold. */
  private withAttached(list: Entity[]): Entity[] {
    const out = new Set(list);
    for (const e of list) for (const a of e.attachedEntities()) out.add(a);
    return [...out];
  }

  paste(): void {
    const clip = this.clipboard;
    if (!clip) return;
    // paste centered on the mouse
    let cx = 0;
    let cy = 0;
    let n = 0;
    let minY = Infinity;
    for (const s of clip.entities) for (const p of s.parts) {
      if (p.hp === -1) continue;
      cx += p.x;
      cy += p.y;
      minY = Math.min(minY, p.y);
      n++;
    }
    cx /= n;
    cy /= n;
    const dy = Math.max(this.wy - cy, WORLD.floor + 0.05 - minY + 0.1);
    const made = instantiate(this.game, clip, { dx: this.wx - cx, dy });
    this.selection = new Set(made);
    this.refreshOutlines();
  }

  /** Mirrors the entities as one group (a single entity flips around its center). */
  flip(list: Entity[]): void {
    const made = this.game.flipEntities(list);
    this.selection = new Set(made);
    this.refreshOutlines();
  }

  rotateSelection(list: Entity[], angle: number): void {
    if (!list.length) return;
    let cx = 0;
    let cy = 0;
    for (const e of list) {
      const c = e.center();
      cx += c.x;
      cy += c.y;
    }
    cx /= list.length;
    cy /= list.length;
    for (const e of list) e.rotateAbout(cx, cy, angle);
  }

  // ---- context menu ------------------------------------------------------------

  private openMenuAtCursor(): void {
    if (this.armed) {
      this.arm(null);
      return;
    }
    const part = this.game.pick(this.wx, this.wy, this.pickRadius());
    if (!part) {
      const acts: ContextAction[] = [];
      if (this.clipboard) acts.push({ label: 'Paste', hint: 'Ctrl+V', action: () => this.paste() });
      acts.push({ label: 'Select all', hint: 'Ctrl+A', action: () => this.selectAll() });
      if (this.selection.size) acts.push({ label: 'Deselect', hint: 'Esc', action: () => this.clearSelection() });
      acts.push({ label: this.game.paused ? 'Resume' : 'Pause', hint: 'Space', action: () => this.togglePause() });
      this.ui.openContextMenu(this.sx, this.sy, 'Sandbox', acts);
      return;
    }
    this.openMenuFor(part);
  }

  /** The context menu for an object (and the rest of the selection, if it's in it). */
  private openMenuFor(part: Part): void {
    const e = part.entity;
    if (!this.selection.has(e)) {
      this.selection.clear();
      this.selection.add(e);
      this.refreshOutlines();
    }
    const list = this.targets();
    const multi = list.length > 1;
    const acts: ContextAction[] = [];
    if (!multi) acts.push(...e.contextActions());
    if (list.some((x) => x.activatable)) acts.push({ label: 'Activate', hint: 'F', action: () => list.forEach((x) => x.activate()) });
    const allFrozen = list.every((x) => x.frozen);
    acts.push({ label: allFrozen ? 'Unfreeze' : 'Freeze', hint: 'Z', action: () => this.toggleFreeze(list) });
    if (!multi && e.parts.length > 1) {
      acts.push({ label: part.frozen ? `Unfreeze ${part.name.toLowerCase()}` : `Freeze ${part.name.toLowerCase()}`, action: () => part.setFrozen(!part.frozen) });
    }
    const nc = list.every((x) => x.noCollide);
    acts.push({ label: 'No collide', checked: nc, hint: 'N', action: () => list.forEach((x) => x.setNoCollide(!nc)) });
    acts.push({ label: 'Flip', hint: 'R', action: () => this.flip(list) });
    acts.push({ label: 'Duplicate', hint: 'Ctrl+D', action: () => this.duplicate(list) });
    acts.push({ label: 'Copy', hint: 'Ctrl+C', action: () => this.copy(list) });
    const conns = list.flatMap((x) => this.game.connections.connectionsOf(x));
    if (conns.length) acts.push({ label: `Remove connections (${conns.length})`, action: () => conns.forEach((c) => this.game.connections.remove(c)) });
    acts.push({ label: multi ? `Delete ${list.length} objects` : 'Delete', hint: 'Del', danger: true, action: () => this.deleteEntities(list) });
    this.ui.openContextMenu(this.sx, this.sy, multi ? `${list.length} objects` : e.label, acts);
  }

  // ---- keyboard -------------------------------------------------------------

  togglePause(): void {
    this.game.paused = !this.game.paused;
    this.ui.refreshToolbar();
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const code = e.code;
    if (!down) {
      this.keys.delete(code);
      if (code === 'KeyF') this.releaseActivation();
      return;
    }
    const first = !this.keys.has(code);
    this.keys.add(code);
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl) {
      if (code === 'KeyD') this.duplicate(this.targets());
      else if (code === 'KeyC') this.copy(this.targets());
      else if (code === 'KeyV') this.paste();
      else if (code === 'KeyA') this.selectAll();
      else if (code === 'KeyS') this.ui.save();
      else if (code === 'KeyO') this.ui.load();
      else return;
      e.preventDefault();
      return;
    }
    if (!first && code !== 'Period') return;
    switch (code) {
      case 'Space':
        this.togglePause();
        break;
      case 'Period':
        if (!this.game.paused) {
          this.game.paused = true;
          this.ui.refreshToolbar();
        }
        this.game.stepRequests++;
        break;
      case 'KeyF': {
        const list = this.grab ? [this.grab.part.entity] : this.targets();
        this.activate(list, true);
        break;
      }
      case 'KeyZ':
        this.toggleFreeze(this.grab ? [this.grab.part.entity] : this.targets());
        break;
      case 'KeyN': {
        const list = this.targets();
        const nc = list.every((x) => x.noCollide);
        list.forEach((x) => x.setNoCollide(!nc));
        break;
      }
      case 'KeyR':
        if (this.armed && !this.armed.tool) this.spawnFlip = !this.spawnFlip;
        else this.flip(this.targets());
        break;
      case 'Delete':
      case 'Backspace':
      case 'KeyX':
        this.deleteEntities(this.targets());
        break;
      case 'KeyQ':
      case 'KeyE':
        if (!this.grab) {
          const dir = code === 'KeyQ' ? 1 : -1;
          if (this.armed && !this.armed.tool) this.spawnAngle += (dir * Math.PI) / 12;
          else this.rotateSelection([...this.selection], (dir * Math.PI) / (e.shiftKey ? 2 : 12));
        }
        break;
      case 'KeyT':
        this.game.timeScale = this.game.timeScale < 1 ? 1 : 0.25;
        this.ui.refreshToolbar();
        break;
      case 'KeyG':
        this.game.renderer.showGrid = !this.game.renderer.showGrid;
        break;
      case 'Tab':
        this.ui.toggleCatalog();
        break;
      case 'F1':
      case 'KeyH':
        this.ui.toggleHelp();
        break;
      case 'Escape':
        if (this.ui.isMenuOpen()) this.ui.closeContextMenu();
        else if (this.armed) this.arm(null);
        else this.clearSelection();
        break;
      case 'Home':
        this.game.renderer.camX = 0;
        this.game.renderer.camY = 4;
        break;
      default:
        return;
    }
    e.preventDefault();
  }

  // ---- per-frame ----------------------------------------------------------------

  private frame(dt: number): void {
    // keyboard panning
    const r = this.game.renderer;
    const speed = (900 / r.zoom) * dt * (this.keys.has('ShiftLeft') ? 2.5 : 1);
    let mx = 0;
    let my = 0;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) mx -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) mx += 1;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) my += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) my -= 1;
    if (mx || my) {
      r.camX += mx * speed;
      r.camY += my * speed;
      r.clampCamera();
    }
    // world position under a stationary mouse changes as the camera moves
    const w = r.screenToWorld(this.sx, this.sy);
    this.wx = w.x;
    this.wy = w.y;

    // hover (a finger only hovers what it's on)
    const busy = this.pan || this.box;
    const lifted = this.touchMode && !this.touches.size;
    const h = busy ? this.hover : this.grab ? this.grab.part : lifted ? null : this.game.pick(this.wx, this.wy, this.pickRadius());
    if (h !== this.hover) {
      this.hover = h;
      this.refreshOutlines();
    }

    if (this.ghost && this.armed) {
      const hh = this.armed.halfHeight ?? 0.3;
      this.ghost.position.set(this.wx, Math.max(this.wy, WORLD.floor + hh * Math.abs(Math.cos(this.spawnAngle)) + 0.01), 40);
      this.ghost.rotation.z = this.spawnAngle;
      this.ghost.scale.x = Math.abs(this.ghost.scale.x) * (this.spawnFlip ? -1 : 1);
      this.ghost.visible = !this.hover && !lifted;
    }
  }

  /** Cursor hint for the status bar. */
  get hint(): string {
    const click = this.touchMode ? 'Tap' : 'Click';
    if (this.connect) return 'Release over the target object (or empty space to anchor to the background)';
    const t = this.toolKind;
    if (t === 'remove') return `${click} an object to remove its connections`;
    if (t === 'pin') return `${click} an object to pin it to the background`;
    if (t) return `Drag from one object to another to create a ${this.armed!.name.toLowerCase()}`;
    if (this.armed) {
      return this.touchMode
        ? `Tap empty space to spawn ${this.armed.name} · long press to stop`
        : `Click empty space to spawn ${this.armed.name} · Q/E rotate · R flip · Esc cancel`;
    }
    return '';
  }
}
