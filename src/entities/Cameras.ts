import * as THREE from 'three';
import { PX } from '../engine/constants';
import { Prop, type PropConfig } from './Prop';
import { SCREEN } from '../art/rocketry';
import type { Game } from '../world/Game';
import type { ContextAction, ItemDef, SpawnOptions } from '../world/types';

// Camera and screen parts (0.4.0): a camera sees what's round it, as close as it's set;
// a screen wired to one shows that, live; and a camera in what's flown shows in a box in
// the corner of the screen (picture-in-picture: see UI).

/** How close a camera can be set (px a metre: what a screen shows of it). */
export const CAMERA_ZOOMS = [16, 32, 64];
/** How many texels across a screen's picture is (pixel art: it's drawn small and blown up). */
const PIC_W = 112;

/**
 * A camera part: looks along its lens (what it sees is centred a little ahead of it).
 * A screen wired to it shows that; built into a craft that's flown, it shows in the
 * picture-in-picture box (see its menu).
 */
export class CameraPart extends Prop {
  zoom = 32;
  /** Shown in the corner while what it's built into is flown. */
  pip = true;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, x, y, opts);
  }

  /** Where its view is centred (world): ahead of its lens, the closer the further it sees. */
  viewAt(): { x: number; y: number } {
    const p = this.main;
    const d = p.localDir(p.flip, 0);
    const ahead = 160 / this.zoom;
    return { x: p.x + d.x * ahead, y: p.y + d.y * ahead };
  }

  contextActions(): ContextAction[] {
    return [
      ...CAMERA_ZOOMS.map((z, i) => ({ label: ['Wide', 'Normal', 'Close'][i], checked: this.zoom === z, action: () => (this.zoom = z) })),
      { label: 'Picture-in-picture when flown', checked: this.pip, action: () => (this.pip = !this.pip) },
    ];
  }

  protected serializeExtra(): Record<string, unknown> {
    return { zoom: this.zoom, pip: this.pip };
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    if (CAMERA_ZOOMS.includes(x.zoom as number)) this.zoom = x.zoom as number;
    if (typeof x.pip === 'boolean') this.pip = x.pip;
  }
}

/**
 * A screen part: wired to a camera part, it shows what the camera sees, live (a few
 * times a second less than the game, to spare the graphics card); with none, static.
 */
export class ScreenPart extends Prop {
  private target: THREE.WebGLRenderTarget | null = null;
  private mesh: THREE.Mesh | null = null;
  private tick = 0;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, x, y, opts);
  }

  conducts(): boolean {
    return true;
  }

  /** The camera wired to it, if any. */
  camera(): CameraPart | null {
    for (const { n } of this.game.connections.wiresOf(this)) if (n instanceof CameraPart && !n.destroyed) return n;
    return null;
  }

  frame(): void {
    const cam = this.camera();
    const p = this.main;
    if (!cam || p.destroyed) {
      if (this.mesh) this.mesh.visible = false;
      return;
    }
    const r = this.game.renderer;
    if (!this.target) {
      const h = Math.round((PIC_W * SCREEN.ih) / SCREEN.iw);
      this.target = new THREE.WebGLRenderTarget(PIC_W, h, { magFilter: THREE.NearestFilter, minFilter: THREE.NearestFilter });
      const mat = new THREE.MeshBasicMaterial({ map: this.target.texture, depthTest: false, depthWrite: false });
      this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(SCREEN.iw * PX, SCREEN.ih * PX), mat);
      this.mesh.frustumCulled = false;
      this.mesh.renderOrder = 10;
      r.scene.add(this.mesh);
    }
    const m = this.mesh!;
    m.visible = true;
    // over its window, turned as it is
    const c = p.pixelToWorld(SCREEN.x + SCREEN.iw / 2, SCREEN.y + SCREEN.ih / 2);
    m.position.set(c.x, c.y, p.z + 0.0005);
    m.rotation.z = p.bodyAngle;
    m.scale.x = p.flip;
    // (its picture drawn every other frame)
    if (this.tick++ % 2 === 0) {
      const v = cam.viewAt();
      r.views.push({ x: v.x, y: v.y, zoom: cam.zoom / 2, target: this.target });
    }
  }

  protected onDestroy(): void {
    if (this.mesh) {
      this.game.renderer.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      (this.mesh.material as THREE.Material).dispose();
    }
    this.target?.dispose();
    this.mesh = null;
    this.target = null;
    super.onDestroy();
  }

  contextActions(): ContextAction[] {
    return this.camera() ? [] : [{ label: 'Wire it to a camera to show its view', disabled: true, action: () => {} }];
  }
}
