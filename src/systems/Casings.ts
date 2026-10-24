import * as THREE from 'three';
import { RAPIER } from '../engine/Physics';
import { GROUP, PX, WORLD, groups } from '../engine/constants';
import type { Game } from '../world/Game';
import type { Part } from '../world/Part';

/** A spent case's look: brass (pistols, rifles) or a shotgun shell's red hull on a brass head. */
export type CaseLook = 'brass' | 'shell';

/**
 * Spent cases: how many lie about at most (the oldest go first), how long one
 * stays (s), how bouncy they are and how much a bounce keeps along the surface,
 * how hard a hit must be to clink (m/s), and how slow is lying still (m/s).
 */
const CASES = { most: 400, life: 40, fade: 1.5, bounce: 0.38, slide: 0.65, clink: 0.7, rest: 0.25 };

/** Cases hit the ground and whatever's on it, not each other (nor the debris layer they're in). */
const FILTER = groups(GROUP.DEBRIS, GROUP.STATIC | GROUP.DYNAMIC);

/** Each look's pixels along the case, base first. */
const LOOKS: Record<CaseLook, number[]> = {
  brass: [0x7c5e1c, 0xc29a36, 0xd6b048, 0xe8cc6a],
  shell: [0xc29a36, 0x9a2c24, 0xb23a2c, 0xc4503c],
};

/**
 * Spent cartridge cases thrown from guns: little brass cases (or red shotgun
 * shells) that tumble out of the ejection port, bounce and clink off the floor
 * and whatever they land on, and lie about for a while. Drawn as one batch per
 * look and stepped by hand (a ray along each one's path), not as physics
 * bodies: a minigun throws thirty a second.
 */
export class Casings {
  /** How many lie about at most (Settings > Graphics), up to CASES.most. */
  cap = 240;
  private n = 0;
  /** (64 bits: far out on an endless map, 32 can't hold the little a rolling case moves in a step) */
  private readonly x = new Float64Array(CASES.most);
  private readonly y = new Float32Array(CASES.most);
  private readonly vx = new Float32Array(CASES.most);
  private readonly vy = new Float32Array(CASES.most);
  private readonly a = new Float32Array(CASES.most);
  private readonly w = new Float32Array(CASES.most);
  /** Length and width (m). */
  private readonly len = new Float32Array(CASES.most);
  private readonly wid = new Float32Array(CASES.most);
  private readonly age = new Float32Array(CASES.most);
  private readonly look = new Uint8Array(CASES.most);
  /** Lying still, on `on` (null: the floor or the map's ground) where `on` was then. */
  private readonly still = new Uint8Array(CASES.most);
  private readonly on: (Part | null)[] = new Array(CASES.most).fill(null);
  private readonly onX = new Float64Array(CASES.most);
  private readonly onY = new Float32Array(CASES.most);
  /** The gun it came out of, passed through for its first moments (it starts inside the gun). */
  private readonly from: (RAPIER.RigidBody | null)[] = new Array(CASES.most).fill(null);
  private readonly meshes: THREE.InstancedMesh[];
  private readonly ray = new RAPIER.Ray({ x: 0, y: 0 }, { x: 1, y: 0 });
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly pos = new THREE.Vector3();
  private readonly scl = new THREE.Vector3();
  private readonly axis = new THREE.Vector3(0, 0, 1);
  private dirty = true;

  constructor(private game: Game) {
    this.meshes = (Object.keys(LOOKS) as CaseLook[]).map((k) => {
      const px = LOOKS[k];
      const data = new Uint8Array(px.length * 4);
      px.forEach((c, i) => data.set([(c >> 16) & 255, (c >> 8) & 255, c & 255, 255], i * 4));
      const tex = new THREE.DataTexture(data, px.length, 1, THREE.RGBAFormat);
      tex.magFilter = tex.minFilter = THREE.NearestFilter;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.needsUpdate = true;
      const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex, depthWrite: false }), CASES.most);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.frustumCulled = false;
      // in front of things, under the lighting pass (so it darkens at night) and the particles
      mesh.position.z = 29.5;
      mesh.renderOrder = 5;
      game.renderer.scene.add(mesh);
      return mesh;
    });
  }

  get count(): number {
    return this.n;
  }

  /**
   * Throws a case from (x, y) at (vx, vy), spinning, `len` × `wid` sprite pixels
   * (a pistol's 2 × 1, a rifle's 3 × 1, a shotgun shell's 3 × 2).
   */
  eject(x: number, y: number, vx: number, vy: number, look: CaseLook = 'brass', len = 2, wid = 1, from: RAPIER.RigidBody | null = null): void {
    if (this.cap <= 0) return;
    while (this.n >= Math.min(this.cap, CASES.most)) this.drop(0);
    const i = this.n++;
    this.x[i] = x;
    this.y[i] = y;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.a[i] = Math.random() * Math.PI * 2;
    this.w[i] = (Math.random() < 0.5 ? -1 : 1) * (12 + Math.random() * 18);
    this.len[i] = len * PX;
    this.wid[i] = wid * PX;
    this.age[i] = 0;
    this.look[i] = look === 'shell' ? 1 : 0;
    this.still[i] = 0;
    this.on[i] = null;
    this.from[i] = from;
    this.dirty = true;
  }

  /** Removes case i, moving the last one into its place (the oldest are near the front). */
  private drop(i: number): void {
    // (shifting keeps the order, so the oldest is always first to go)
    const last = --this.n;
    for (const arr of [this.x, this.y, this.vx, this.vy, this.a, this.w, this.len, this.wid, this.age, this.onX, this.onY]) arr.copyWithin(i, i + 1, last + 1);
    this.look.copyWithin(i, i + 1, last + 1);
    this.still.copyWithin(i, i + 1, last + 1);
    this.on.splice(i, 1);
    this.on.push(null);
    this.from.splice(i, 1);
    this.from.push(null);
    this.dirty = true;
  }

  step(dt: number): void {
    const world = this.game.physics.world;
    const env = this.game.env;
    const terrain = env.ground.length > 0;
    const g = this.game.gravity;
    // (fewer allowed now than lie about: the oldest go)
    while (this.n > Math.max(0, this.cap)) this.drop(0);
    for (let i = 0; i < this.n; i++) {
      this.age[i] += dt;
      if (this.age[i] > CASES.life) {
        this.drop(i--);
        continue;
      }
      if (this.still[i]) {
        // lying on something that's moved or gone: it falls again
        const p = this.on[i];
        if (p && (p.destroyed || Math.abs(p.x - this.onX[i]) + Math.abs(p.y - this.onY[i]) > PX * 0.5)) {
          this.still[i] = 0;
          this.on[i] = null;
        } else continue;
      }
      this.dirty = true;
      this.vy[i] += g * dt;
      const dx = this.vx[i] * dt;
      const dy = this.vy[i] * dt;
      const d = Math.hypot(dx, dy);
      const r = this.wid[i] * 0.5;
      let hit = false;
      let nx = 0;
      let ny = 1;
      let hx = this.x[i] + dx;
      let hy = this.y[i] + dy;
      let part: Part | null = null;
      if (d > 1e-6) {
        this.ray.origin = { x: this.x[i], y: this.y[i] };
        this.ray.dir = { x: dx / d, y: dy / d };
        const from = this.age[i] < 0.25 ? this.from[i] : null;
        const h = world.castRayAndGetNormal(this.ray, d + r, true, undefined, FILTER, undefined, from && from.isValid() ? from : undefined);
        // (one that starts inside something, a hand say, passes out of it)
        if (h && h.timeOfImpact > 0) {
          hit = true;
          const t = Math.max(0, h.timeOfImpact - r);
          hx = this.x[i] + (dx / d) * t;
          hy = this.y[i] + (dy / d) * t;
          nx = h.normal.x;
          ny = h.normal.y;
          part = this.game.physics.partOf(h.collider) ?? null;
        }
      }
      // the floor, and the map's ground
      const ground = terrain ? env.groundAt(hx, this.y[i] + PX * 2) : WORLD.floor;
      if (!hit && hy < ground + r) {
        hit = true;
        hy = ground + r;
        nx = 0;
        ny = 1;
      }
      if (hx < WORLD.left || hx > WORLD.right) {
        this.vx[i] = -this.vx[i] * CASES.bounce;
        hx = Math.max(WORLD.left, Math.min(WORLD.right, hx));
      }
      this.x[i] = hx;
      this.y[i] = hy;
      this.a[i] += this.w[i] * dt;
      if (!hit) continue;
      // bounce: the speed into the surface turned round and mostly lost, some of the rest kept
      const vn = this.vx[i] * nx + this.vy[i] * ny;
      if (vn >= 0) continue;
      const tx = this.vx[i] - vn * nx;
      const ty = this.vy[i] - vn * ny;
      this.vx[i] = tx * CASES.slide - vn * nx * CASES.bounce;
      this.vy[i] = ty * CASES.slide - vn * ny * CASES.bounce;
      this.w[i] = this.w[i] * 0.5 + (Math.random() - 0.5) * -vn * 14;
      if (-vn > CASES.clink && !this.game.net?.guest) this.game.sound.casing(hx, this.look[i] === 1 || this.len[i] > PX * 2.5);
      if (Math.hypot(this.vx[i], this.vy[i]) < CASES.rest && ny > 0.5) {
        // comes to rest lying along the surface
        const along = Math.atan2(-nx, ny);
        this.a[i] = along + Math.round((this.a[i] - along) / Math.PI) * Math.PI;
        this.vx[i] = this.vy[i] = this.w[i] = 0;
        this.still[i] = 1;
        this.on[i] = part && !part.frozen ? part : null;
        if (part) {
          this.onX[i] = part.x;
          this.onY[i] = part.y;
        }
      }
    }
  }

  frame(): void {
    if (!this.dirty) return;
    this.dirty = false;
    const counts = [0, 0];
    for (let i = 0; i < this.n; i++) {
      const k = this.look[i];
      const mesh = this.meshes[k];
      // (fades by shrinking away at the end of its time)
      const s = Math.min(1, (CASES.life - this.age[i]) / CASES.fade);
      if (s < 1) this.dirty = true;
      this.pos.set(this.x[i], this.y[i], 0);
      this.q.setFromAxisAngle(this.axis, this.a[i]);
      this.scl.set(this.len[i] * s, this.wid[i] * s, 1);
      this.m.compose(this.pos, this.q, this.scl);
      mesh.setMatrixAt(counts[k]++, this.m);
    }
    this.meshes.forEach((mesh, k) => {
      mesh.count = counts[k];
      mesh.instanceMatrix.needsUpdate = true;
    });
  }

  clear(): void {
    this.n = 0;
    this.on.fill(null);
    this.from.fill(null);
    this.dirty = true;
  }
}
