import { RAPIER } from '../engine/Physics';
import { PX, GROUPS_DYNAMIC, GROUPS_NOCOLLIDE } from '../engine/constants';
import { Sprite, type Region, type Sprites } from '../engine/Sprites';
import { lerpAngle, rotate, type V2 } from '../engine/math';
import { PixelArt, type Color } from '../art/PixelArt';
import type { PhysMaterial } from './Materials';
import type { Entity } from './Entity';

/** Collider shapes in sprite-pixel units, relative to the body origin (y up). */
export type ShapeSpec =
  | { kind: 'box'; w: number; h: number; x?: number; y?: number; r?: number; angle?: number }
  | { kind: 'ball'; r: number; x?: number; y?: number }
  | { kind: 'capsule'; halfH: number; r: number; x?: number; y?: number; angle?: number }
  | { kind: 'poly'; pts: [number, number][]; r?: number };

export interface PartSpec {
  name: string;
  art: PixelArt;
  material: PhysMaterial;
  x: number;
  y: number;
  angle?: number;
  shapes?: ShapeSpec[];
  /** Sprite center offset from the body origin in pixels (y up). */
  spriteOffset?: V2;
  layer?: number;
  density?: number;
  friction?: number;
  restitution?: number;
  flip?: boolean;
  ccd?: boolean;
  linearDamping?: number;
  angularDamping?: number;
  maxHp?: number;
  /** Contact-force threshold (N) above which impact events are reported. */
  forceThreshold?: number;
  gravityScale?: number;
  /** Share the base image between identical parts until painted. */
  textureKey?: string;
}

const sharedImages = new Map<string, { image: Uint8Array; region: Region }>();

export class Part {
  readonly entity: Entity;
  readonly name: string;
  readonly mat: PhysMaterial;
  readonly body: RAPIER.RigidBody;
  readonly colliders: RAPIER.Collider[] = [];
  readonly sprite: Sprite;
  art: PixelArt;
  readonly w: number;
  readonly h: number;
  /** -1 when drawn and shaped facing left (see mirror()). */
  flip: 1 | -1;
  readonly layer: number;
  spriteOffset: V2;

  /** The sprite's RGBA bytes, (w + 2) x (h + 2) with a clear border, painted on by wounds. */
  private image: Uint8Array;
  private region: Region;
  private ownsImage = false;
  private texDirty = false;
  private readonly sprites: Sprites;

  // gameplay state
  hp: number;
  maxHp: number;
  /** 0..1 fire intensity. */
  burning = 0;
  /** 0..1 visual char amount. */
  charred = 0;
  /** Oil soaked in (0..1): makes anything burn. */
  oil = 0;
  frozen = false;
  /** Self-collision group: parts with the same non-zero group never collide. */
  group = 0;
  /** Parts that should never generate contacts with this part. */
  noCollide: Set<Part> | null = null;
  /** Detached from its parent (e.g. severed limb). */
  detached = false;
  destroyed = false;
  flash = 0;
  /** Contacts disabled against everything except the static world. */
  noCollideAll = false;
  /** Touches only the floor and walls, never other things (an animal's tail: it would snag on everything). */
  onlyStatic = false;

  // interpolation state (meters / radians)
  x = 0;
  y = 0;
  a = 0;
  px = 0;
  py = 0;
  pa = 0;
  // velocities recorded at the end of the previous step (pre-step for the next)
  vx = 0;
  vy = 0;
  av = 0;

  constructor(entity: Entity, spec: PartSpec) {
    this.entity = entity;
    this.name = spec.name;
    this.mat = spec.material;
    this.art = spec.art;
    this.w = spec.art.w;
    this.h = spec.art.h;
    this.flip = spec.flip ? -1 : 1;
    this.layer = spec.layer ?? 0;
    this.maxHp = spec.maxHp ?? 100;
    this.hp = this.maxHp;
    this.spriteOffset = spec.spriteOffset ?? { x: 0, y: 0 };

    const world = entity.game.physics.world;
    const bd = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(spec.x, spec.y)
      .setRotation(spec.angle ?? 0)
      .setLinearDamping(spec.linearDamping ?? 0.05)
      .setAngularDamping(spec.angularDamping ?? 0.15)
      .setCcdEnabled(spec.ccd ?? false)
      .setGravityScale(spec.gravityScale ?? 1);
    this.body = world.createRigidBody(bd);

    const shapes = spec.shapes ?? [{ kind: 'box', w: this.w, h: this.h, r: 0.6 }];
    for (const s of shapes) this.addShape(s, spec);

    this.x = this.px = spec.x;
    this.y = this.py = spec.y;
    this.a = this.pa = spec.angle ?? 0;

    // sprite
    this.sprites = entity.game.renderer.sprites;
    const shared = spec.textureKey ? sharedImages.get(spec.textureKey) : undefined;
    if (shared) {
      this.image = shared.image;
      this.region = shared.region;
    } else {
      this.image = spec.art.toRGBA(1);
      this.region = this.sprites.alloc(this.w + 2, this.h + 2);
      this.sprites.upload(this.region, this.image);
      if (spec.textureKey) sharedImages.set(spec.textureKey, { image: this.image, region: this.region });
      else this.ownsImage = true;
    }
    this.sprite = new Sprite(this.region);
    this.sprite.w = (this.w + 2) * PX * this.flip;
    this.sprite.h = (this.h + 2) * PX;
    this.updateZ();
    this.render(1);
  }

  private addShape(s: ShapeSpec, spec: PartSpec): void {
    const f = this.flip;
    let desc: RAPIER.ColliderDesc | null = null;
    // Rapier derives the mass of rounded shapes from the inner (un-rounded) shape,
    // so scale density to make mass match the full visible area.
    let densityScale = 1;
    switch (s.kind) {
      case 'box': {
        const r = Math.min(s.r ?? 0, Math.min(s.w, s.h) / 2 - 0.05) * PX;
        const hx = (s.w * PX) / 2 - r;
        const hy = (s.h * PX) / 2 - r;
        if (r > 0) densityScale = (s.w * PX * s.h * PX) / Math.max(1e-6, 4 * hx * hy);
        desc = r > 0 ? RAPIER.ColliderDesc.roundCuboid(hx, hy, r) : RAPIER.ColliderDesc.cuboid(hx, hy);
        desc.setTranslation((s.x ?? 0) * PX * f, (s.y ?? 0) * PX).setRotation((s.angle ?? 0) * f);
        break;
      }
      case 'ball':
        desc = RAPIER.ColliderDesc.ball(s.r * PX).setTranslation((s.x ?? 0) * PX * f, (s.y ?? 0) * PX);
        break;
      case 'capsule':
        desc = RAPIER.ColliderDesc.capsule(s.halfH * PX, s.r * PX)
          .setTranslation((s.x ?? 0) * PX * f, (s.y ?? 0) * PX)
          .setRotation((s.angle ?? 0) * f);
        break;
      case 'poly': {
        const pts = new Float32Array(s.pts.length * 2);
        s.pts.forEach((p, i) => {
          pts[i * 2] = p[0] * PX * f;
          pts[i * 2 + 1] = p[1] * PX;
        });
        desc = s.r ? RAPIER.ColliderDesc.roundConvexHull(pts, s.r * PX) : RAPIER.ColliderDesc.convexHull(pts);
        if (s.r) {
          let area = 0;
          let perim = 0;
          for (let i = 0; i < s.pts.length; i++) {
            const a = s.pts[i];
            const b = s.pts[(i + 1) % s.pts.length];
            area += a[0] * b[1] - b[0] * a[1];
            perim += Math.hypot(b[0] - a[0], b[1] - a[1]);
          }
          area = Math.abs(area) / 2;
          densityScale = (area + perim * s.r + Math.PI * s.r * s.r) / Math.max(1e-6, area);
        }
        break;
      }
    }
    if (!desc) return;
    desc
      .setDensity((spec.density ?? this.mat.density) * densityScale)
      .setFriction(spec.friction ?? this.mat.friction)
      .setRestitution(spec.restitution ?? this.mat.restitution)
      .setCollisionGroups(GROUPS_DYNAMIC)
      .setActiveHooks(RAPIER.ActiveHooks.FILTER_CONTACT_PAIRS)
      .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold((spec.forceThreshold ?? 40) * this.entity.game.physics.forceScale);
    const col = this.entity.game.physics.world.createCollider(desc, this.body);
    this.colliders.push(col);
    this.entity.game.physics.partByCollider.set(col.handle, this);
    this.entity.game.physics.fresh.push(col);
  }

  updateZ(): void {
    this.sprite.z = this.entity.zBase + this.layer * 0.001;
  }

  /** Drawing depth: higher is in front. */
  get z(): number {
    return this.sprite.z;
  }

  get mass(): number {
    return this.body.mass();
  }

  /** Records the post-step transform for interpolation. */
  sync(): void {
    this.px = this.x;
    this.py = this.y;
    this.pa = this.a;
    const t = this.body.translation();
    this.x = t.x;
    this.y = t.y;
    this.a = this.body.rotation();
    const v = this.body.linvel();
    this.vx = v.x;
    this.vy = v.y;
    this.av = this.body.angvel();
  }

  /** Snap interpolation (after teleports). */
  resetInterpolation(): void {
    const t = this.body.translation();
    this.x = this.px = t.x;
    this.y = this.py = t.y;
    this.a = this.pa = this.body.rotation();
  }

  /**
   * Mirrors the part in place about the vertical line x = cx: pose, motion,
   * sprite and collider offsets (an animal turning round). Joints and anything
   * attached by local coordinates are up to the owner.
   */
  mirror(cx: number): void {
    this.flip = this.flip === 1 ? -1 : 1;
    this.sprite.w = -this.sprite.w;
    const b = this.body;
    const t = b.translation();
    const v = b.linvel();
    b.setTranslation({ x: 2 * cx - t.x, y: t.y }, false);
    b.setRotation(-b.rotation(), false);
    b.setLinvel({ x: -v.x, y: v.y }, false);
    b.setAngvel(-b.angvel(), false);
    for (const c of this.colliders) {
      const o = c.translationWrtParent();
      if (o && o.x !== 0) c.setTranslationWrtParent({ x: -o.x, y: o.y });
      const r = c.rotationWrtParent();
      if (r) c.setRotationWrtParent(-r);
    }
    // mid-step interpolation would sweep the sprite across
    this.resetInterpolation();
    this.vx = -this.vx;
    this.av = -this.av;
  }

  render(alpha: number): void {
    const x = this.px + (this.x - this.px) * alpha;
    const y = this.py + (this.y - this.py) * alpha;
    const a = lerpAngle(this.pa, this.a, alpha);
    const o = this.spriteOffset;
    const s = this.sprite;
    if (o.x !== 0 || o.y !== 0) {
      const r = rotate(o.x * PX * this.flip, o.y * PX, a);
      s.x = x + r.x;
      s.y = y + r.y;
    } else {
      s.x = x;
      s.y = y;
    }
    s.a = a;
    if (this.flash > 0) {
      s.flash = Math.min(1, this.flash);
      this.flash = Math.max(0, this.flash - 0.08);
    } else s.flash = 0;
    s.charred = this.charred * 0.85;
    s.write();
    if (this.texDirty) {
      this.sprites.upload(this.region, this.image);
      this.texDirty = false;
    }
  }

  // ---- coordinate helpers -------------------------------------------------

  /** World point -> body-local meters. */
  worldToLocal(wx: number, wy: number): V2 {
    const t = this.body.translation();
    return rotate(wx - t.x, wy - t.y, -this.body.rotation());
  }

  localToWorld(lx: number, ly: number): V2 {
    const t = this.body.translation();
    const r = rotate(lx, ly, this.body.rotation());
    return { x: t.x + r.x, y: t.y + r.y };
  }

  /** Local direction -> world direction. */
  localDir(dx: number, dy: number): V2 {
    return rotate(dx, dy, this.body.rotation());
  }

  /** World point -> sprite pixel (column, row) in art space. */
  worldToPixel(wx: number, wy: number): { ix: number; iy: number } {
    const l = this.worldToLocal(wx, wy);
    const lx = (l.x / PX - this.spriteOffset.x * this.flip) * this.flip;
    const ly = l.y / PX - this.spriteOffset.y;
    return { ix: Math.floor(lx + this.w / 2), iy: Math.floor(this.h / 2 - ly) };
  }

  /** Sprite pixel center -> world point. */
  pixelToWorld(ix: number, iy: number): V2 {
    const l = this.pixelToLocal(ix, iy);
    return this.localToWorld(l.x, l.y);
  }

  /** Sprite pixel center -> body-local meters (accounts for flipping). */
  pixelToLocal(ix: number, iy: number): V2 {
    const lx = (ix + 0.5 - this.w / 2 + this.spriteOffset.x) * this.flip;
    const ly = this.h / 2 - (iy + 0.5) + this.spriteOffset.y;
    return { x: lx * PX, y: ly * PX };
  }

  // ---- painting (wounds, blood, scorch) ----------------------------------

  /** The image to paint on: a shared one is copied first. */
  private ownImage(): Uint8Array {
    if (!this.ownsImage) {
      this.image = this.image.slice();
      this.region = this.sprites.alloc(this.w + 2, this.h + 2);
      this.sprite.setRegion(this.region);
      this.ownsImage = true;
    }
    this.texDirty = true;
    return this.image;
  }

  /** Paints one art pixel (only where the sprite is solid), blended by alpha. */
  paintPixel(ix: number, iy: number, color: Color, alpha = 1): boolean {
    if (!this.art.filled(ix, iy)) return false;
    const img = this.ownImage();
    const o = ((iy + 1) * (this.w + 2) + ix + 1) * 4;
    const k = 1 - alpha;
    img[o] = Math.round(((color >> 16) & 255) * alpha + img[o] * k);
    img[o + 1] = Math.round(((color >> 8) & 255) * alpha + img[o + 1] * k);
    img[o + 2] = Math.round((color & 255) * alpha + img[o + 2] * k);
    return true;
  }

  /** Paints a small blob around a world point. Returns whether anything was painted. */
  paintAt(wx: number, wy: number, color: Color, radius = 0, alpha = 1): boolean {
    const { ix, iy } = this.worldToPixel(wx, wy);
    let any = false;
    const r = Math.ceil(radius);
    for (let j = -r; j <= r; j++) {
      for (let i = -r; i <= r; i++) {
        if (i * i + j * j > radius * radius + 0.5) continue;
        any = this.paintPixel(ix + i, iy + j, color, alpha) || any;
      }
    }
    // if the exact pixel missed (edge hit), paint the nearest solid pixel
    if (!any) {
      let best = -1;
      let bd = 1e9;
      for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) {
        if (this.art.filled(ix + i, iy + j) && i * i + j * j < bd) {
          bd = i * i + j * j;
          best = (iy + j) * 10000 + (ix + i);
        }
      }
      if (best >= 0) any = this.paintPixel(best % 10000, Math.floor(best / 10000), color, alpha);
    }
    return any;
  }

  /** Replaces the sprite with another of the same size (e.g. a lamp turning on). */
  setArt(art: PixelArt): void {
    this.ownImage().set(art.toRGBA(1));
    this.art = art;
  }

  /** Is the given art pixel solid? */
  solidAt(ix: number, iy: number): boolean {
    return this.art.filled(ix, iy);
  }

  // ---- state ---------------------------------------------------------------

  setFrozen(on: boolean): void {
    if (this.frozen === on || this.destroyed) return;
    this.frozen = on;
    this.body.setBodyType(on ? RAPIER.RigidBodyType.Fixed : RAPIER.RigidBodyType.Dynamic, true);
    if (!on) this.body.wakeUp();
    this.refreshTint();
  }

  setNoCollideAll(on: boolean): void {
    this.noCollideAll = on;
    for (const c of this.colliders) c.setCollisionGroups(on || this.onlyStatic ? GROUPS_NOCOLLIDE : GROUPS_DYNAMIC);
  }

  setOnlyStatic(): void {
    this.onlyStatic = true;
    for (const c of this.colliders) c.setCollisionGroups(GROUPS_NOCOLLIDE);
  }

  refreshTint(): void {
    if (this.frozen) this.setTint(0.68, 0.84, 1.08);
    else if (this.noCollideAll) this.setTint(0.85, 0.85, 0.85);
    else this.setTint(1, 1, 1);
  }

  /** Multiplies the sprite's colors (frozen blue, a corpse's pallor). */
  setTint(r: number, g: number, b: number): void {
    const s = this.sprite;
    s.r = r;
    s.g = g;
    s.b = b;
  }

  setOutline(on: boolean, color = 0xf2d16b): void {
    this.sprite.outline = on;
    this.sprite.outlineColor = color;
  }

  /** Moves the body instantly (and its interpolation state). */
  teleport(x: number, y: number, angle: number): void {
    this.body.setTranslation({ x, y }, true);
    this.body.setRotation(angle, true);
    this.resetInterpolation();
  }

  applyImpulseAt(ix: number, iy: number, px: number, py: number): void {
    if (this.frozen) return;
    this.body.applyImpulseAtPoint({ x: ix, y: iy }, { x: px, y: py }, true);
  }

  velocityAt(wx: number, wy: number): V2 {
    const v = this.body.velocityAtPoint({ x: wx, y: wy });
    return { x: v.x, y: v.y };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    const phys = this.entity.game.physics;
    for (const c of this.colliders) phys.partByCollider.delete(c.handle);
    phys.world.removeRigidBody(this.body);
    this.sprite.dispose();
    if (this.ownsImage) this.sprites.release(this.region);
  }
}

