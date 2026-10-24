import { Prop, WOOD_HP, type PropConfig } from './Prop';
import { PixelArt } from '../art/PixelArt';
import { materialArt, type ShapeMaterialId } from '../art/props';
import { MAT, GLASS, type PhysMaterial } from '../world/Materials';
import { cleanOutline, convexPieces, signedArea, type Pt } from '../engine/geometry';
import { clamp } from '../engine/math';
import { SIZE_LIMITS, type EntityConfig, type ItemDef, type SpawnOptions } from '../world/types';
import type { ShapeSpec } from '../world/Part';
import type { Game } from '../world/Game';

export type ShapeForm = 'box' | 'round' | 'poly';

/** A drawn shape (the Shape tool): its material, outline and size in sprite pixels. */
export interface ShapeConfig extends EntityConfig {
  mat: ShapeMaterialId;
  form: ShapeForm;
  w: number;
  h: number;
  /** A polygon's corners, counter-clockwise, as fractions of its size from its middle (-0.5..0.5, y up). */
  pts?: Pt[];
}

/** What shapes can be made of, in the order the tool bar offers them. */
export const SHAPE_MATERIALS: { id: ShapeMaterialId; name: string; mat: PhysMaterial; density?: number }[] = [
  { id: 'wood', name: 'Wood', mat: MAT.wood },
  { id: 'metal', name: 'Metal', mat: MAT.metal, density: 170 },
  { id: 'concrete', name: 'Concrete', mat: MAT.concrete },
  { id: 'brick', name: 'Brick', mat: MAT.stone },
  { id: 'rubber', name: 'Rubber', mat: MAT.rubber },
  { id: 'glass', name: 'Glass', mat: GLASS },
];

const FORMS: ShapeForm[] = ['box', 'round', 'poly'];

/** A config from a save or a paste, made safe: a known material and form, a size within limits, a usable outline. */
export function readShapeConfig(c: EntityConfig | undefined): ShapeConfig {
  const mat = SHAPE_MATERIALS.some((m) => m.id === c?.mat) ? (c!.mat as ShapeMaterialId) : 'wood';
  let form = FORMS.includes(c?.form as ShapeForm) ? (c!.form as ShapeForm) : 'box';
  const size = (v: unknown, d: number) => clamp(Math.round(Number(v) || d), SIZE_LIMITS.min, SIZE_LIMITS.max);
  const w = size(c?.w, 32);
  const h = size(c?.h, 32);
  let pts: Pt[] | undefined;
  if (form === 'poly') {
    const raw = Array.isArray(c?.pts) ? (c!.pts as unknown[]) : [];
    pts = raw
      .filter((p): p is [number, number] => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))
      .map(([x, y]) => [clamp(x, -0.5, 0.5), clamp(y, -0.5, 0.5)]);
    if (pts.length < 3) {
      form = 'box';
      pts = undefined;
    }
  }
  return pts ? { mat, form, w, h, pts } : { mat, form, w, h };
}

/** The outline in sprite pixels from the middle (y up). */
function outline(cfg: ShapeConfig): Pt[] {
  return (cfg.pts ?? []).map(([x, y]) => [x * cfg.w, y * cfg.h]);
}

/** The pixels it covers. */
function mask(cfg: ShapeConfig): PixelArt {
  const a = new PixelArt(cfg.w, cfg.h);
  if (cfg.form === 'round') a.ellipse(0, 0, cfg.w, cfg.h, 0);
  else if (cfg.form === 'poly') a.poly(outline(cfg).map(([x, y]) => [x + cfg.w / 2, cfg.h / 2 - y]), 0);
  // (an outline too thin to cover a pixel still has a body)
  if (cfg.form === 'box' || !a.px.some((c) => c !== -1)) a.rect(0, 0, cfg.w, cfg.h, 0);
  return a;
}

/** Its colliders: a box, a ball or an ellipse, or a polygon cut into convex pieces. */
function colliders(cfg: ShapeConfig): ShapeSpec[] {
  const { w, h } = cfg;
  if (cfg.form === 'round') {
    if (Math.abs(w - h) <= 1) return [{ kind: 'ball', r: (w + h) / 4 }];
    const pts: [number, number][] = [];
    for (let i = 0; i < 24; i++) {
      const t = (i / 24) * Math.PI * 2;
      pts.push([(Math.cos(t) * w) / 2, (Math.sin(t) * h) / 2]);
    }
    return [{ kind: 'poly', pts }];
  }
  if (cfg.form === 'poly') {
    const pieces = convexPieces(cleanOutline(outline(cfg), 1e-3)).filter((p) => p.length >= 3 && signedArea(p) > 0.5);
    if (pieces.length) return pieces.map((pts) => ({ kind: 'poly', pts }));
  }
  return [{ kind: 'box', w, h, r: 0.6 }];
}

function propConfig(cfg: ShapeConfig): PropConfig {
  const m = SHAPE_MATERIALS.find((s) => s.id === cfg.mat)!;
  const shape = mask(cfg);
  const area = shape.px.reduce((n, c) => n + (c !== -1 ? 1 : 0), 0);
  const art = materialArt(shape, cfg.mat);
  return {
    art: () => art,
    material: m.mat,
    density: m.density,
    shapes: colliders(cfg),
    ownTexture: true,
    // wood breaks as wooden things do; glass is as strong as a pane of its size
    hpPerKg: cfg.mat === 'wood' ? WOOD_HP : undefined,
    hp: cfg.mat === 'glass' ? 6 * clamp(area / 160, 0.5, 8) : undefined,
    angularDamping: cfg.form === 'round' ? 0.05 : undefined,
  };
}

/** A solid object drawn with the Shape tool. */
export class Shape extends Prop {
  constructor(game: Game, def: ItemDef, cfg: ShapeConfig, x: number, y: number, opts: SpawnOptions) {
    super(game, def, propConfig(cfg), x, y, opts);
    this.config = cfg;
  }

  get label(): string {
    const m = SHAPE_MATERIALS.find((s) => s.id === (this.config as ShapeConfig).mat);
    return `${m?.name ?? 'Custom'} shape`;
  }
}
