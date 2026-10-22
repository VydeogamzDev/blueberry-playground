import * as THREE from 'three';
import { DEFAULT_ZOOM, MAX_ZOOM, MIN_ZOOM, WORLD } from './constants';
import { clamp, type V2 } from './math';

THREE.ColorManagement.enabled = false;

/** Shared unit quad for every sprite. */
export const UNIT_QUAD = new THREE.PlaneGeometry(1, 1);

export function makePixelTexture(canvas: HTMLCanvasElement | OffscreenCanvas): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas as HTMLCanvasElement);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

const SPRITE_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SPRITE_FRAG = /* glsl */ `
uniform sampler2D map;
uniform vec2 texel;
uniform vec3 tint;
uniform float outline;
uniform vec3 outlineColor;
uniform float flash;
uniform float charred;
uniform float opacity;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(map, vUv);
  if (c.a < 0.5) {
    if (outline > 0.5) {
      float a = texture2D(map, vUv + vec2(texel.x, 0.0)).a + texture2D(map, vUv - vec2(texel.x, 0.0)).a
              + texture2D(map, vUv + vec2(0.0, texel.y)).a + texture2D(map, vUv - vec2(0.0, texel.y)).a;
      if (a > 0.5) { gl_FragColor = vec4(outlineColor, 1.0); return; }
    }
    discard;
  }
  vec3 col = c.rgb * tint;
  col = mix(col, col * vec3(0.16, 0.13, 0.11), charred);
  col = mix(col, vec3(1.0, 0.97, 0.9), flash);
  gl_FragColor = vec4(col, opacity);
}`;

export type PixelMaterial = THREE.ShaderMaterial & {
  uniforms: {
    map: { value: THREE.Texture };
    texel: { value: THREE.Vector2 };
    tint: { value: THREE.Color };
    outline: { value: number };
    outlineColor: { value: THREE.Color };
    flash: { value: number };
    charred: { value: number };
    opacity: { value: number };
  };
};

export function makePixelMaterial(tex: THREE.Texture, w: number, h: number, ghost = false): PixelMaterial {
  const m = new THREE.ShaderMaterial({
    vertexShader: SPRITE_VERT,
    fragmentShader: SPRITE_FRAG,
    uniforms: {
      map: { value: tex },
      texel: { value: new THREE.Vector2(1 / w, 1 / h) },
      tint: { value: new THREE.Color(1, 1, 1) },
      outline: { value: 0 },
      outlineColor: { value: new THREE.Color(0xf2d16b) },
      flash: { value: 0 },
      charred: { value: 0 },
      opacity: { value: ghost ? 0.55 : 1 },
    },
    transparent: ghost,
    depthWrite: !ghost,
  });
  return m as PixelMaterial;
}

const BG_FRAG = /* glsl */ `
uniform vec2 uCam;
uniform vec2 uRes;
uniform float uScale;
uniform float uGrid;
uniform float uPx;
uniform vec4 uBounds;
varying vec2 vUv;

float lineMask(float w, float period, float thick) {
  float m = mod(w, period);
  return step(m, thick);
}

void main() {
  vec2 world = uCam + (gl_FragCoord.xy - uRes * 0.5) / uScale;
  // snap to sprite pixel grid so the backdrop reads as pixel art
  vec2 sp = floor(world / uPx) * uPx;
  vec3 base = vec3(0.157, 0.165, 0.176);
  // large wall panels with subtle alternating tone
  vec2 panel = floor(sp / 4.0);
  float checker = mod(panel.x + panel.y, 2.0);
  base *= 1.0 + checker * 0.018;
  // subtle vertical gradient: darker high up
  base *= mix(1.04, 0.86, clamp(sp.y / 45.0, 0.0, 1.0));
  if (uGrid > 0.5) {
    float minor = max(lineMask(sp.x, 1.0, uPx * 0.5), lineMask(sp.y, 1.0, uPx * 0.5));
    float major = max(lineMask(sp.x, 4.0, uPx * 0.5), lineMask(sp.y, 4.0, uPx * 0.5));
    // fade the minor grid out when zoomed far away
    float minorFade = clamp((uScale - 6.0) / 30.0, 0.0, 1.0);
    base += vec3(0.026, 0.028, 0.03) * minor * minorFade;
    base += vec3(0.03, 0.032, 0.036) * major;
    // panel rivets at major intersections
    vec2 rv = mod(sp + uPx * 4.0, 4.0);
    if (rv.x < uPx * 2.0 && rv.y < uPx * 2.0) base += vec3(0.04);
  }
  // outside the sandbox: dark void
  if (world.x < uBounds.x || world.x > uBounds.y || world.y > uBounds.w) base *= 0.45;
  // vignette
  vec2 q = gl_FragCoord.xy / uRes - 0.5;
  base *= 1.0 - dot(q, q) * 0.55;
  gl_FragColor = vec4(base, 1.0);
}`;

export class Renderer {
  readonly gl: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.OrthographicCamera;
  readonly canvas: HTMLCanvasElement;

  camX = 0;
  camY = 4;
  zoom = DEFAULT_ZOOM;
  targetZoom = DEFAULT_ZOOM;
  width = 1;
  height = 1;
  dpr = 1;
  showGrid = true;

  private bgMat: THREE.ShaderMaterial;
  private shakeAmt = 0;
  private shakeX = 0;
  private shakeY = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
    this.gl.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.gl.setClearColor(0x16171a, 1);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
    this.camera.position.z = 200;

    this.bgMat = new THREE.ShaderMaterial({
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy * 2.0, 0.999, 1.0); }`,
      fragmentShader: BG_FRAG,
      uniforms: {
        uCam: { value: new THREE.Vector2() },
        uRes: { value: new THREE.Vector2() },
        uScale: { value: 1 },
        uGrid: { value: 1 },
        uPx: { value: 1 / 32 },
        uBounds: { value: new THREE.Vector4(WORLD.left, WORLD.right, WORLD.floor, WORLD.ceiling) },
      },
      depthWrite: false,
      depthTest: false,
    });
    const bg = new THREE.Mesh(UNIT_QUAD, this.bgMat);
    bg.frustumCulled = false;
    bg.renderOrder = -1000;
    this.scene.add(bg);

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.gl.setPixelRatio(this.dpr);
    this.gl.setSize(this.width, this.height, false);
    this.canvas.style.width = this.width + 'px';
    this.canvas.style.height = this.height + 'px';
  }

  shake(amount: number): void {
    this.shakeAmt = Math.min(1.5, this.shakeAmt + amount);
  }

  /** Zoom keeping the world point under (sx, sy) fixed. */
  zoomAt(sx: number, sy: number, factor: number): void {
    const before = this.screenToWorld(sx, sy);
    this.zoom = clamp(this.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    this.targetZoom = this.zoom;
    const after = this.screenToWorld(sx, sy);
    this.camX += before.x - after.x;
    this.camY += before.y - after.y;
    this.clampCamera();
  }

  clampCamera(): void {
    this.camX = clamp(this.camX, WORLD.left - 10, WORLD.right + 10);
    this.camY = clamp(this.camY, WORLD.floor - 10, WORLD.ceiling + 10);
  }

  screenToWorld(sx: number, sy: number): V2 {
    return {
      x: this.camX + (sx - this.width / 2) / this.zoom,
      y: this.camY - (sy - this.height / 2) / this.zoom,
    };
  }

  worldToScreen(x: number, y: number): V2 {
    return {
      x: (x - this.camX) * this.zoom + this.width / 2,
      y: -(y - this.camY) * this.zoom + this.height / 2,
    };
  }

  render(dt: number): void {
    // camera shake decays quickly
    if (this.shakeAmt > 0.001) {
      this.shakeX = (Math.random() * 2 - 1) * this.shakeAmt * 0.35;
      this.shakeY = (Math.random() * 2 - 1) * this.shakeAmt * 0.35;
      this.shakeAmt *= Math.exp(-dt * 9);
    } else {
      this.shakeX = this.shakeY = 0;
    }
    const scale = this.zoom * this.dpr;
    // snap camera to the device pixel grid to reduce sprite shimmer
    const cx = Math.round((this.camX + this.shakeX) * scale) / scale;
    const cy = Math.round((this.camY + this.shakeY) * scale) / scale;
    const hw = this.width / 2 / this.zoom;
    const hh = this.height / 2 / this.zoom;
    const cam = this.camera;
    cam.left = cx - hw;
    cam.right = cx + hw;
    cam.top = cy + hh;
    cam.bottom = cy - hh;
    cam.updateProjectionMatrix();

    const u = this.bgMat.uniforms;
    u.uCam.value.set(cx, cy);
    u.uRes.value.set(this.width * this.dpr, this.height * this.dpr);
    u.uScale.value = scale;
    u.uGrid.value = this.showGrid ? 1 : 0;

    this.gl.render(this.scene, cam);
  }
}
