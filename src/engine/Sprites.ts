import * as THREE from 'three';

/** Side of an atlas page in texels. */
const PAGE = 2048;

/** A rectangle of an atlas page holding one sprite image. */
export interface Region {
  page: Page;
  x: number;
  y: number;
  w: number;
  h: number;
}

const VERT = /* glsl */ `
attribute vec4 iXform;   // x, y, z, angle
attribute vec2 iSize;    // world width (negative when mirrored), height
attribute vec4 iRect;    // atlas rectangle in texels: x, y, w, h
attribute vec4 iTint;    // r, g, b, flash
attribute vec4 iFx;      // charred, outline, outline color packed as 0xRRGGBB, unused
varying vec2 vUv;
varying vec4 vRect;
varying vec4 vTint;
varying vec2 vFx;
varying vec3 vOutline;
void main() {
  vec2 p = position.xy * iSize;
  float c = cos(iXform.w);
  float s = sin(iXform.w);
  vec2 w = vec2(c * p.x - s * p.y, s * p.x + c * p.y) + iXform.xy;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, iXform.z, 1.0);
  vUv = uv;
  vRect = iRect;
  vTint = iTint;
  vFx = iFx.xy;
  float o = iFx.z;
  vOutline = vec3(floor(o / 65536.0), mod(floor(o / 256.0), 256.0), mod(o, 256.0)) / 255.0;
}`;

const FRAG = /* glsl */ `
precision highp float;
uniform sampler2D map;
uniform float page;
varying vec2 vUv;
varying vec4 vRect;
varying vec4 vTint;
varying vec2 vFx;
varying vec3 vOutline;
// one texel of the sprite, clamped to its own rectangle (row 0 is the image's top)
vec4 at(vec2 t) {
  t = clamp(t, vec2(0.5), vRect.zw - 0.5);
  return texture2D(map, (vRect.xy + t) / page);
}
void main() {
  vec2 t = floor(vec2(vUv.x, 1.0 - vUv.y) * vRect.zw) + 0.5;
  vec4 c = at(t);
  if (c.a < 0.5) {
    if (vFx.y > 0.5) {
      float a = at(t + vec2(1.0, 0.0)).a + at(t - vec2(1.0, 0.0)).a + at(t + vec2(0.0, 1.0)).a + at(t - vec2(0.0, 1.0)).a;
      if (a > 0.5) { gl_FragColor = vec4(vOutline, 1.0); return; }
    }
    discard;
  }
  vec3 col = c.rgb * vTint.rgb;
  col = mix(col, col * vec3(0.16, 0.13, 0.11), vFx.x);
  col = mix(col, vec3(1.0, 0.97, 0.9), vTint.a);
  gl_FragColor = vec4(col, 1.0);
}`;

const ATTRS = [['iXform', 4], ['iSize', 2], ['iRect', 4], ['iTint', 4], ['iFx', 4]] as const;
type AttrName = (typeof ATTRS)[number][0];

/** All the sprites on one atlas page, drawn with one instanced draw call. */
class Batch {
  readonly mesh: THREE.Mesh;
  private readonly geo = new THREE.InstancedBufferGeometry();
  private cap = 0;
  count = 0;
  readonly owners: Sprite[] = [];
  data = {} as Record<AttrName, Float32Array>;
  private attrs = {} as Record<AttrName, THREE.InstancedBufferAttribute>;

  constructor(tex: THREE.Texture, scene: THREE.Scene) {
    const quad = new THREE.PlaneGeometry(1, 1);
    this.geo.index = quad.index;
    this.geo.setAttribute('position', quad.getAttribute('position'));
    this.geo.setAttribute('uv', quad.getAttribute('uv'));
    this.grow(256);
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { map: { value: tex }, page: { value: PAGE } },
      // mirrored sprites have their triangles wound the other way
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  private grow(cap: number): void {
    this.geo.dispose();
    for (const [name, size] of ATTRS) {
      const a = new Float32Array(cap * size);
      if (this.data[name]) a.set(this.data[name]);
      this.data[name] = a;
      const attr = new THREE.InstancedBufferAttribute(a, size);
      attr.setUsage(THREE.DynamicDrawUsage);
      this.attrs[name] = attr;
      this.geo.setAttribute(name, attr);
    }
    this.cap = cap;
  }

  add(s: Sprite): number {
    if (this.count === this.cap) this.grow(this.cap * 2);
    this.owners[this.count] = s;
    return this.count++;
  }

  /** Removes slot i, moving the last sprite into it. */
  remove(i: number): void {
    const last = --this.count;
    if (i !== last) {
      const moved = this.owners[last];
      for (const [name, size] of ATTRS) this.data[name].copyWithin(i * size, last * size, last * size + size);
      this.owners[i] = moved;
      moved.index = i;
    }
    this.owners.length = this.count;
  }

  flush(): void {
    this.geo.instanceCount = this.count;
    for (const [name, size] of ATTRS) {
      const a = this.attrs[name];
      a.clearUpdateRanges();
      a.addUpdateRange(0, this.count * size);
      a.needsUpdate = true;
    }
  }
}

/** One page of the sprite atlas: a texture packed in shelves, plus its batch. */
class Page {
  readonly tex: THREE.DataTexture;
  readonly batch: Batch;
  private shelfY = 0;
  private shelfH = 0;
  private x = 0;
  /** Released rectangles, by size, for the next sprite of the same size. */
  private spare = new Map<number, Region[]>();
  live = 0;

  constructor(scene: THREE.Scene) {
    this.tex = new THREE.DataTexture(new Uint8Array(PAGE * PAGE * 4), PAGE, PAGE);
    this.tex.magFilter = THREE.NearestFilter;
    this.tex.minFilter = THREE.NearestFilter;
    this.tex.generateMipmaps = false;
    this.tex.colorSpace = THREE.NoColorSpace;
    this.tex.needsUpdate = true;
    this.batch = new Batch(this.tex, scene);
  }

  alloc(w: number, h: number): Region | null {
    const reuse = this.spare.get(w * 4096 + h)?.pop();
    if (reuse) {
      this.live++;
      return reuse;
    }
    if (w > PAGE || h > PAGE) return null;
    if (this.x + w > PAGE) {
      this.shelfY += this.shelfH;
      this.shelfH = 0;
      this.x = 0;
    }
    if (this.shelfY + h > PAGE) return null;
    const r: Region = { page: this, x: this.x, y: this.shelfY, w, h };
    this.x += w;
    this.shelfH = Math.max(this.shelfH, h);
    this.live++;
    return r;
  }

  release(r: Region): void {
    this.live--;
    if (this.live === 0) {
      // nothing left on the page: start packing it afresh
      this.spare.clear();
      this.shelfY = this.shelfH = this.x = 0;
      return;
    }
    const k = r.w * 4096 + r.h;
    let list = this.spare.get(k);
    if (!list) this.spare.set(k, (list = []));
    list.push(r);
  }
}

/**
 * Draws every physics part's sprite from a few shared atlas textures with one
 * instanced draw call per page, instead of a mesh, material and texture each:
 * a hundred people are 1,600 parts.
 */
export class Sprites {
  private pages: Page[] = [];
  private uploads = new Map<Region, Uint8Array>();
  /** A never-drawn texture wrapping the bytes to send: three copies its data straight in. */
  private scratch = new THREE.DataTexture(null, 1, 1);
  private at = new THREE.Vector2();

  constructor(private readonly gl: THREE.WebGLRenderer, private readonly scene: THREE.Scene) {}

  /** A free rectangle of w x h texels. */
  alloc(w: number, h: number): Region {
    for (const p of this.pages) {
      const r = p.alloc(w, h);
      if (r) return r;
    }
    const page = new Page(this.scene);
    this.pages.push(page);
    const r = page.alloc(w, h);
    if (!r) throw new Error(`sprite too big for the atlas: ${w}x${h}`);
    return r;
  }

  release(r: Region): void {
    this.uploads.delete(r);
    r.page.release(r);
  }

  /** Copies an image (RGBA bytes, r.w x r.h, top row first) into its rectangle before the next draw. */
  upload(r: Region, rgba: Uint8Array): void {
    this.uploads.set(r, rgba);
  }

  /** Sends pending images and this frame's sprite data to the GPU. */
  flush(): void {
    const img = this.scratch.image as { data: Uint8Array; width: number; height: number };
    for (const [r, rgba] of this.uploads) {
      img.data = rgba;
      img.width = r.w;
      img.height = r.h;
      this.gl.copyTextureToTexture(this.scratch, r.page.tex, null, this.at.set(r.x, r.y));
    }
    this.uploads.clear();
    for (const p of this.pages) p.batch.flush();
  }

  /** Draw calls the sprites take (one per atlas page). */
  get pageCount(): number {
    return this.pages.length;
  }
}

/** One part's sprite: where it is, how it's tinted, and which atlas rectangle it shows. */
export class Sprite {
  index = -1;
  private batch: Batch | null = null;
  private region: Region;
  x = 0;
  y = 0;
  z = 0;
  a = 0;
  /** World size; w is negative when mirrored. */
  w = 1;
  h = 1;
  r = 1;
  g = 1;
  b = 1;
  flash = 0;
  charred = 0;
  outline = false;
  outlineColor = 0xf2d16b;

  constructor(region: Region) {
    this.region = region;
    this.attach();
  }

  private attach(): void {
    this.batch = this.region.page.batch;
    this.index = this.batch.add(this);
  }

  /** Shows another atlas rectangle (the sprite got its own copy to paint on). */
  setRegion(region: Region): void {
    if (region.page !== this.region.page) {
      this.batch?.remove(this.index);
      this.region = region;
      this.attach();
    } else this.region = region;
  }

  /** Writes the sprite's current state into its batch. */
  write(): void {
    const b = this.batch;
    if (!b) return;
    const i = this.index;
    const d = b.data;
    const r = this.region;
    let o = i * 4;
    d.iXform[o] = this.x;
    d.iXform[o + 1] = this.y;
    d.iXform[o + 2] = this.z;
    d.iXform[o + 3] = this.a;
    d.iRect[o] = r.x;
    d.iRect[o + 1] = r.y;
    d.iRect[o + 2] = r.w;
    d.iRect[o + 3] = r.h;
    d.iTint[o] = this.r;
    d.iTint[o + 1] = this.g;
    d.iTint[o + 2] = this.b;
    d.iTint[o + 3] = this.flash;
    d.iFx[o] = this.charred;
    d.iFx[o + 1] = this.outline ? 1 : 0;
    d.iFx[o + 2] = this.outlineColor;
    d.iFx[o + 3] = 0;
    o = i * 2;
    d.iSize[o] = this.w;
    d.iSize[o + 1] = this.h;
  }

  dispose(): void {
    this.batch?.remove(this.index);
    this.batch = null;
    this.index = -1;
  }
}
