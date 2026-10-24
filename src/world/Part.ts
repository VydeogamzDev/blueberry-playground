import { RAPIER } from '../engine/Physics';
import { PX, GROUPS_DYNAMIC, GROUPS_NOCOLLIDE } from '../engine/constants';
import { Sprite, type Region, type Sprites } from '../engine/Sprites';
import { lerpAngle, rotate, type V2 } from '../engine/math';
import { fromBase64, toBase64 } from '../engine/base64';
import { PixelArt, type Color } from '../art/PixelArt';
import type { PhysMaterial } from './Materials';
import type { Entity } from './Entity';

/** How many solid pixels each picture has (see Part.lost()). */
const filledCount = new WeakMap<PixelArt, number>();

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
  /** Points connections snap to (a motor's axle, a gate's ports: see tools/AnchorSnap). */
  attach?: AttachPoint[];
}

/** What an attach point is for: the place to fix a machine by, to fix things to it, or a wire's way in or out. */
export type AttachRole = 'mount' | 'axle' | 'plate' | 'in' | 'out';

/**
 * A point on a part that connections snap to (see tools/AnchorSnap), in sprite
 * pixels from the art's top-left corner (fractions allowed: 0.5 is a pixel's middle).
 */
export interface AttachPoint {
  name: string;
  x: number;
  y: number;
  role?: AttachRole;
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
  /** Points connections snap to, if its spec named any (see PartSpec.attach). */
  readonly attach: AttachPoint[] | undefined;

  /** The sprite's RGBA bytes, (w + 2) x (h + 2) with a clear border, painted on by wounds. */
  private image: Uint8Array;
  private region: Region;
  private ownsImage = false;
  private texDirty = false;
  /** paintData() as it is now, kept until the sprite is painted again (undefined: not worked out). */
  private paintStr: string | null | undefined = undefined;
  /** Art pixels carved away (see carve()), one byte each, w x h; null: none. */
  private holes: Uint8Array | null = null;
  /** How many art pixels have been carved away. */
  holeCount = 0;
  private readonly sprites: Sprites;
  /** Its gravity scale when it isn't weightless. */
  private readonly gravity: number;

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
  /** Ignores gravity ("Make weightless" in the context menu). */
  weightless = false;
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
  /** How far (m) its colliders reach from the body's origin. */
  reach = 0;
  /** The collision groups and hooks last set on its colliders, and on how many (see ContactGroups). */
  contactGroups = GROUPS_DYNAMIC;
  contactHook = RAPIER.ActiveHooks.FILTER_CONTACT_PAIRS;
  contactN = 0;

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
    this.attach = spec.attach;
    this.gravity = spec.gravityScale ?? 1;

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
    const off = Math.hypot(s.kind === 'poly' ? 0 : s.x ?? 0, s.kind === 'poly' ? 0 : s.y ?? 0) * PX;
    switch (s.kind) {
      case 'box': {
        const r = Math.min(s.r ?? 0, Math.min(s.w, s.h) / 2 - 0.05) * PX;
        const hx = (s.w * PX) / 2 - r;
        const hy = (s.h * PX) / 2 - r;
        if (r > 0) densityScale = (s.w * PX * s.h * PX) / Math.max(1e-6, 4 * hx * hy);
        desc = r > 0 ? RAPIER.ColliderDesc.roundCuboid(hx, hy, r) : RAPIER.ColliderDesc.cuboid(hx, hy);
        this.reach = Math.max(this.reach, off + (Math.hypot(s.w, s.h) * PX) / 2);
        desc.setTranslation((s.x ?? 0) * PX * f, (s.y ?? 0) * PX).setRotation((s.angle ?? 0) * f);
        break;
      }
      case 'ball':
        desc = RAPIER.ColliderDesc.ball(s.r * PX).setTranslation((s.x ?? 0) * PX * f, (s.y ?? 0) * PX);
        this.reach = Math.max(this.reach, off + s.r * PX);
        break;
      case 'capsule':
        desc = RAPIER.ColliderDesc.capsule(s.halfH * PX, s.r * PX)
          .setTranslation((s.x ?? 0) * PX * f, (s.y ?? 0) * PX)
          .setRotation((s.angle ?? 0) * f);
        this.reach = Math.max(this.reach, off + (s.halfH + s.r) * PX);
        break;
      case 'poly': {
        const pts = new Float32Array(s.pts.length * 2);
        s.pts.forEach((p, i) => {
          pts[i * 2] = p[0] * PX * f;
          pts[i * 2 + 1] = p[1] * PX;
        });
        desc = s.r ? RAPIER.ColliderDesc.roundConvexHull(pts, s.r * PX) : RAPIER.ColliderDesc.convexHull(pts);
        for (const p of s.pts) this.reach = Math.max(this.reach, (Math.hypot(p[0], p[1]) + (s.r ?? 0)) * PX);
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
    const p = this.worldToPixelF(wx, wy);
    return { ix: Math.floor(p.x), iy: Math.floor(p.y) };
  }

  /** World point -> sprite pixel coordinates, unrounded (pixel (ix, iy) covers ix..ix+1, iy..iy+1). */
  worldToPixelF(wx: number, wy: number): V2 {
    const l = this.worldToLocal(wx, wy);
    const lx = (l.x / PX - this.spriteOffset.x * this.flip) * this.flip;
    const ly = l.y / PX - this.spriteOffset.y;
    return { x: lx + this.w / 2, y: this.h / 2 - ly };
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
    this.paintStr = undefined;
    return this.image;
  }

  /**
   * What wounds, blood and scorching have painted on the sprite: the pixels that
   * differ from its art (3 bytes of index, then RGBA), base64; null for none.
   */
  paintData(): string | null {
    if (!this.ownsImage) return null;
    if (this.paintStr === undefined) {
      const base = this.art.toRGBA(1);
      const img = this.image;
      const out: number[] = [];
      for (let k = 0; k < img.length; k += 4) {
        if (img[k] === base[k] && img[k + 1] === base[k + 1] && img[k + 2] === base[k + 2] && img[k + 3] === base[k + 3]) continue;
        const i = k >> 2;
        out.push(i & 255, (i >> 8) & 255, i >> 16, img[k], img[k + 1], img[k + 2], img[k + 3]);
      }
      this.paintStr = out.length ? toBase64(Uint8Array.from(out)) : null;
    }
    return this.paintStr;
  }

  /** Paints back what paintData() gave, on a part with the same art (pixels carved away come back carved). */
  restorePaint(data: string): void {
    const b = fromBase64(data);
    const img = this.ownImage();
    const W = this.w + 2;
    let carved = false;
    for (let j = 0; j + 7 <= b.length; j += 7) {
      const i = b[j] | (b[j + 1] << 8) | (b[j + 2] << 16);
      const k = i * 4;
      if (k + 4 > img.length) continue;
      img[k] = b[j + 3];
      img[k + 1] = b[j + 4];
      img[k + 2] = b[j + 5];
      img[k + 3] = b[j + 6];
      if (b[j + 6] === 0) carved = this.markHole((i % W) - 1, Math.floor(i / W) - 1) || carved;
    }
    this.paintStr = data;
    if (carved) this.refit();
  }

  /** An art pixel's colour as it shows now (wounds, blood and all). */
  colorAt(ix: number, iy: number): Color {
    const o = ((iy + 1) * (this.w + 2) + ix + 1) * 4;
    return (this.image[o] << 16) | (this.image[o + 1] << 8) | this.image[o + 2];
  }

  /** Paints one art pixel (only where the sprite is solid), blended by alpha. */
  paintPixel(ix: number, iy: number, color: Color, alpha = 1): boolean {
    if (!this.solidAt(ix, iy)) return false;
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
    return this.paintAtPixel(ix, iy, color, radius, alpha);
  }

  /** paintAt() around an art pixel (in pixels: where it lands doesn't hang on the pose, see net/Effects). */
  paintAtPixel(ix: number, iy: number, color: Color, radius = 0, alpha = 1): boolean {
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
        if (this.solidAt(ix + i, iy + j) && i * i + j * j < bd) {
          bd = i * i + j * j;
          best = (iy + j) * 10000 + (ix + i);
        }
      }
      if (best >= 0) any = this.paintPixel(best % 10000, Math.floor(best / 10000), color, alpha);
    }
    return any;
  }

  /** Replaces the sprite with another of the same size (e.g. a lamp turning on). What was carved away stays gone. */
  setArt(art: PixelArt): void {
    const img = this.ownImage();
    img.set(art.toRGBA(1));
    this.art = art;
    const holes = this.holes;
    if (holes) for (let i = 0; i < holes.length; i++) if (holes[i]) img[((Math.floor(i / this.w) + 1) * (this.w + 2) + (i % this.w) + 1) * 4 + 3] = 0;
  }

  /** Is the given art pixel solid (and not carved away)? */
  solidAt(ix: number, iy: number): boolean {
    return this.art.filled(ix, iy) && !(this.holes && this.holes[iy * this.w + ix]);
  }

  /** The share of its picture carved away (0..1). */
  lost(): number {
    if (!this.holeCount) return 0;
    let n = filledCount.get(this.art);
    if (n === undefined) {
      n = 0;
      for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) if (this.art.filled(x, y)) n++;
      filledCount.set(this.art, n);
    }
    return n ? this.holeCount / n : 0;
  }

  /**
   * Takes pixels off the part (`px`: x, y pairs), shot or torn away: gone from its
   * sprite and from what counts as solid (blood, wounds and flames don't land there),
   * with `rim` (x, y, colour triples) painted where they were torn from, and its
   * colliders shrunk to what's left (see refit()). Saved with the paint (a carved
   * pixel is a clear one).
   */
  carve(px: number[], rim: number[] = []): void {
    if (this.destroyed) return;
    const img = this.ownImage();
    for (let k = 0; k + 1 < px.length; k += 2) {
      const ix = px[k];
      const iy = px[k + 1];
      if (!this.markHole(ix, iy)) continue;
      img[((iy + 1) * (this.w + 2) + ix + 1) * 4 + 3] = 0;
    }
    for (let k = 0; k + 2 < rim.length; k += 3) this.paintPixel(rim[k], rim[k + 1], rim[k + 2]);
    this.refit();
  }

  private markHole(ix: number, iy: number): boolean {
    if (!this.solidAt(ix, iy)) return false;
    (this.holes ??= new Uint8Array(this.w * this.h))[iy * this.w + ix] = 1;
    this.holeCount++;
    return true;
  }

  /**
   * Its box colliders shrunk to the pixels it has left, once a whole end of it is
   * gone (a hand shot off a forearm doesn't leave the forearm its full length),
   * keeping their density; shapes of other kinds stay as they are.
   */
  private refit(): void {
    if (!this.holeCount || this.destroyed) return;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (!this.solidAt(x, y)) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    if (x1 < x0) return;
    // (the edges of what's left, in the body's frame)
    const a = this.pixelToLocal(x0, y0);
    const b = this.pixelToLocal(x1, y1);
    const lx0 = Math.min(a.x, b.x) - PX / 2;
    const lx1 = Math.max(a.x, b.x) + PX / 2;
    const ly0 = Math.min(a.y, b.y) - PX / 2;
    const ly1 = Math.max(a.y, b.y) + PX / 2;
    for (const c of this.colliders) {
      const t = c.shape.type;
      if ((t !== RAPIER.ShapeType.Cuboid && t !== RAPIER.ShapeType.RoundCuboid) || Math.abs(c.rotationWrtParent() ?? 0) > 1e-3) continue;
      const he = c.halfExtents();
      const at = c.translationWrtParent();
      if (!he || !at) continue;
      const r0 = t === RAPIER.ShapeType.RoundCuboid ? c.roundRadius() : 0;
      const hx = he.x + r0;
      const hy = he.y + r0;
      const bx0 = Math.max(at.x - hx, lx0);
      const bx1 = Math.min(at.x + hx, lx1);
      const by0 = Math.max(at.y - hy, ly0);
      const by1 = Math.min(at.y + hy, ly1);
      // (nothing much left of it, or less than a pixel off each side: as it is)
      if (bx1 - bx0 < PX || by1 - by0 < PX) continue;
      const slack = PX * 0.75;
      if (bx0 - (at.x - hx) < slack && at.x + hx - bx1 < slack && by0 - (at.y - hy) < slack && at.y + hy - by1 < slack) continue;
      const W = bx1 - bx0;
      const H = by1 - by0;
      const r = Math.max(0, Math.min(r0, Math.min(W, H) / 2 - 0.05 * PX));
      // (density was scaled up for the rounding: see addShape())
      const base = c.density() * (4 * Math.max(1e-9, he.x * he.y)) / (4 * hx * hy);
      c.setHalfExtents({ x: W / 2 - r, y: H / 2 - r });
      if (t === RAPIER.ShapeType.RoundCuboid) c.setRoundRadius(r);
      c.setTranslationWrtParent({ x: (bx0 + bx1) / 2, y: (by0 + by1) / 2 });
      c.setDensity((base * (W * H)) / Math.max(1e-9, (W - 2 * r) * (H - 2 * r)));
    }
  }

  // ---- state ---------------------------------------------------------------

  setFrozen(on: boolean): void {
    if (this.frozen === on || this.destroyed) return;
    this.frozen = on;
    this.body.setBodyType(on ? RAPIER.RigidBodyType.Fixed : RAPIER.RigidBodyType.Dynamic, true);
    if (!on) this.body.wakeUp();
    this.refreshTint();
  }

  setWeightless(on: boolean): void {
    if (this.weightless === on || this.destroyed) return;
    this.weightless = on;
    this.body.setGravityScale(on ? 0 : this.gravity, true);
  }

  setNoCollideAll(on: boolean): void {
    this.noCollideAll = on;
    this.contactGroups = on || this.onlyStatic ? GROUPS_NOCOLLIDE : GROUPS_DYNAMIC;
    // (a limb blown off keeps the setting, so its body reads right, but its
    // colliders went with it: Rapier panics at the touch of one)
    if (this.destroyed) return;
    for (const c of this.colliders) c.setCollisionGroups(this.contactGroups);
  }

  setOnlyStatic(): void {
    this.onlyStatic = true;
    this.contactGroups = GROUPS_NOCOLLIDE;
    if (this.destroyed) return;
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

