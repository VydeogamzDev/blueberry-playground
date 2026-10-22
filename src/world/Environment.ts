import * as THREE from 'three';
import { RAPIER, type Physics } from '../engine/Physics';
import { GROUPS_STATIC, PX, WORLD } from '../engine/constants';
import { makePixelTexture, UNIT_QUAD } from '../engine/Renderer';
import { PixelArt, hex, shade } from '../art/PixelArt';
import { RNG } from '../engine/math';

function concreteTile(seed: number, base: number): PixelArt {
  const a = new PixelArt(32, 32);
  a.rect(0, 0, 32, 32, base);
  a.noise(0.05, seed);
  const rng = new RNG(seed + 7);
  // speckles
  for (let i = 0; i < 26; i++) a.set(rng.int(0, 31), rng.int(0, 31), shade(base, rng.range(0.78, 0.9)));
  // panel seams
  a.hline(0, 31, 31, shade(base, 0.7));
  a.vline(31, 0, 31, shade(base, 0.74));
  a.hline(0, 31, 0, shade(base, 1.08));
  // a few cracks
  const cx = rng.int(4, 26);
  a.line(cx, 4, cx + rng.int(-3, 3), 10, shade(base, 0.8));
  return a;
}

function tiledMesh(art: PixelArt, w: number, h: number, z: number): THREE.Mesh {
  const canvas = art.toCanvas(0);
  const tex = makePixelTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(w / (art.w * PX), h / (art.h * PX));
  const mat = new THREE.MeshBasicMaterial({ map: tex });
  const mesh = new THREE.Mesh(UNIT_QUAD, mat);
  mesh.scale.set(w, h, 1);
  mesh.position.z = z;
  return mesh;
}

/** The static sandbox: floor, walls and ceiling. */
export class Environment {
  readonly colliders: RAPIER.Collider[] = [];
  readonly body: RAPIER.RigidBody;
  private group = new THREE.Group();

  constructor(physics: Physics, scene: THREE.Scene) {
    const world = physics.world;
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const W = WORLD;
    const width = W.right - W.left;
    const height = W.ceiling - W.floor;
    const add = (cx: number, cy: number, hw: number, hh: number) => {
      const c = world.createCollider(
        RAPIER.ColliderDesc.cuboid(hw, hh)
          .setTranslation(cx, cy)
          .setFriction(0.85)
          .setRestitution(0.05)
          .setCollisionGroups(GROUPS_STATIC),
        this.body,
      );
      this.colliders.push(c);
    };
    const t = W.wallThickness;
    const ft = W.floorThickness;
    add((W.left + W.right) / 2, W.floor - ft / 2, width / 2 + t, ft / 2);
    add(W.left - t / 2, W.floor + height / 2, t / 2, height / 2 + ft);
    add(W.right + t / 2, W.floor + height / 2, t / 2, height / 2 + ft);
    add((W.left + W.right) / 2, W.ceiling + t / 2, width / 2 + t, t / 2);

    // visuals
    const floorArt = concreteTile(11, hex('#4a4c50'));
    const wallArt = concreteTile(23, hex('#3a3c40'));
    const floor = tiledMesh(floorArt, width + t * 2, ft, -20);
    floor.position.set((W.left + W.right) / 2, W.floor - ft / 2, -20);
    this.group.add(floor);

    // bright top edge of the floor (2 sprite px) + dark lip below it
    const edge = new THREE.Mesh(UNIT_QUAD, new THREE.MeshBasicMaterial({ color: 0x6d7075 }));
    edge.scale.set(width, PX * 2, 1);
    edge.position.set((W.left + W.right) / 2, W.floor - PX, -19);
    this.group.add(edge);
    const lip = new THREE.Mesh(UNIT_QUAD, new THREE.MeshBasicMaterial({ color: 0x2c2e31 }));
    lip.scale.set(width, PX * 3, 1);
    lip.position.set((W.left + W.right) / 2, W.floor - PX * 3.5, -19);
    this.group.add(lip);

    const wallL = tiledMesh(wallArt, t, height + ft + t, -20);
    wallL.position.set(W.left - t / 2, W.floor + (height - ft + t) / 2, -20);
    const wallR = wallL.clone();
    wallR.position.x = W.right + t / 2;
    const ceil = tiledMesh(wallArt, width + 2 * t, t, -20);
    ceil.position.set((W.left + W.right) / 2, W.ceiling + t / 2, -20);
    this.group.add(wallL, wallR, ceil);

    // wall trims
    for (const x of [W.left - PX, W.right + PX]) {
      const trim = new THREE.Mesh(UNIT_QUAD, new THREE.MeshBasicMaterial({ color: 0x55585d }));
      trim.scale.set(PX * 2, height, 1);
      trim.position.set(x, W.floor + height / 2, -19);
      this.group.add(trim);
    }
    scene.add(this.group);
  }

  isEnvironment(c: RAPIER.Collider): boolean {
    return this.colliders.includes(c);
  }
}
