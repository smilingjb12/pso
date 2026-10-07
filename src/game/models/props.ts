import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Static scenery as single merged, vertex-coloured geometries so a level can
// draw hundreds of them with one InstancedMesh each.

export type PropKind =
  | 'pine' | 'broadleaf' | 'tallpine' | 'tallbroad' | 'bush' | 'rock' | 'grass' | 'stump'
  // Dragon's lair
  | 'crag' | 'boulder' | 'deadtree' | 'ribcage' | 'skull' | 'bones'
  // Caves
  | 'stalag' | 'mosscrag' | 'mushroom' | 'crystal'
  // Mines
  | 'crate' | 'drum' | 'tank' | 'pipes' | 'console' | 'girder' | 'stack'
  // Glowing (drawn unlit and tinted per instance): bioluminescent caves
  | 'glowcrystal' | 'glowshroom';

const BONE = 0xd6ccb2;
const BONE_DARK = 0xb8ab8c;

function colored(geo: THREE.BufferGeometry, hex: number, matrix?: THREE.Matrix4): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (matrix) g.applyMatrix4(matrix);
  g.deleteAttribute('uv');
  const c = new THREE.Color(hex);
  const n = g.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

const M = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, s: [number, number, number] = [1, 1, 1]) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(...s));

const cache = new Map<PropKind, THREE.BufferGeometry>();

export function propGeometry(kind: PropKind): THREE.BufferGeometry {
  const hit = cache.get(kind);
  if (hit) return hit;
  const parts: THREE.BufferGeometry[] = [];
  switch (kind) {
    case 'pine':
      parts.push(colored(new THREE.CylinderGeometry(0.32, 0.5, 3.2, 6), 0x5a3a22, M(0, 1.6, 0)));
      [
        [2.6, 2.6, 2.6, 0x2e6a32],
        [2.1, 2.4, 4.3, 0x347a38],
        [1.5, 2.2, 5.9, 0x3c8a3e],
        [0.8, 1.6, 7.2, 0x48964a],
      ].forEach(([r, h, y, c], i) => parts.push(colored(new THREE.ConeGeometry(r, h, 7), c, M(0, y, 0, 0, i * 0.4, 0))));
      break;
    case 'broadleaf':
      parts.push(colored(new THREE.CylinderGeometry(0.35, 0.55, 4, 6), 0x6a4426, M(0, 2, 0)));
      parts.push(colored(new THREE.CylinderGeometry(0.12, 0.2, 1.6, 5), 0x6a4426, M(0.6, 3.6, 0, 0, 0, -0.7)));
      [
        [1.9, 0, 5.2, 0, 0x3e8a3a],
        [1.4, 1.3, 4.5, 0.4, 0x4a9a44],
        [1.3, -1.1, 4.7, -0.5, 0x357a34],
        [1.2, 0.2, 6.3, 0.6, 0x55a64c],
      ].forEach(([r, x, y, z, c]) => parts.push(colored(new THREE.IcosahedronGeometry(r, 0), c, M(x, y, z))));
      break;
    // Tall variants stand inside rooms: foliage starts above camera height.
    case 'tallpine':
      parts.push(colored(new THREE.CylinderGeometry(0.3, 0.5, 6.5, 6), 0x5a3a22, M(0, 3.25, 0)));
      [
        [2.4, 2.4, 6.2, 0x2e6a32],
        [1.9, 2.2, 7.7, 0x347a38],
        [1.3, 2.0, 9.1, 0x3c8a3e],
        [0.7, 1.4, 10.3, 0x48964a],
      ].forEach(([r, h, y, c], i) => parts.push(colored(new THREE.ConeGeometry(r, h, 7), c, M(0, y, 0, 0, i * 0.4, 0))));
      break;
    case 'tallbroad':
      parts.push(colored(new THREE.CylinderGeometry(0.32, 0.55, 6.5, 6), 0x6a4426, M(0, 3.25, 0)));
      parts.push(colored(new THREE.CylinderGeometry(0.12, 0.2, 1.8, 5), 0x6a4426, M(0.6, 6.2, 0, 0, 0, -0.7)));
      [
        [2.0, 0, 7.6, 0, 0x3e8a3a],
        [1.4, 1.4, 7.0, 0.4, 0x4a9a44],
        [1.3, -1.2, 7.2, -0.5, 0x357a34],
        [1.2, 0.2, 8.8, 0.6, 0x55a64c],
      ].forEach(([r, x, y, z, c]) => parts.push(colored(new THREE.IcosahedronGeometry(r, 0), c, M(x, y, z))));
      break;
    case 'bush':
      parts.push(colored(new THREE.IcosahedronGeometry(0.7, 0), 0x3a8238, M(0, 0.45, 0, 0, 0, 0, [1.2, 0.8, 1])));
      parts.push(colored(new THREE.IcosahedronGeometry(0.5, 0), 0x4a9644, M(0.5, 0.4, 0.2)));
      parts.push(colored(new THREE.IcosahedronGeometry(0.45, 0), 0x317034, M(-0.45, 0.35, -0.2)));
      break;
    case 'rock':
      parts.push(colored(new THREE.DodecahedronGeometry(0.7, 0), 0x7c7c76, M(0, 0.35, 0, 0.3, 0, 0.2, [1.3, 0.75, 1])));
      parts.push(colored(new THREE.DodecahedronGeometry(0.4, 0), 0x8e8e86, M(0.7, 0.2, 0.3, 0.5, 0.2, 0)));
      break;
    case 'grass':
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        parts.push(colored(new THREE.ConeGeometry(0.06, 0.55, 3), i % 2 ? 0x5aa648 : 0x4a9a3c, M(Math.sin(a) * 0.12, 0.27, Math.cos(a) * 0.12, Math.cos(a) * 0.3, 0, -Math.sin(a) * 0.3)));
      }
      break;
    case 'stump':
      parts.push(colored(new THREE.CylinderGeometry(0.5, 0.65, 0.6, 7), 0x6a4426, M(0, 0.3, 0)));
      parts.push(colored(new THREE.CylinderGeometry(0.46, 0.46, 0.02, 7), 0xc8a070, M(0, 0.61, 0)));
      break;
    case 'crag': {
      // Jagged basalt spire, ~8m tall at scale 1.
      parts.push(colored(new THREE.CylinderGeometry(0.9, 1.7, 4.2, 6), 0x3b342d, M(0, 2.1, 0, 0.05, 0.3, -0.06)));
      parts.push(colored(new THREE.CylinderGeometry(0.35, 1.0, 3.6, 5), 0x463e35, M(0.15, 5.6, -0.1, -0.08, 1.1, 0.1)));
      parts.push(colored(new THREE.ConeGeometry(0.45, 1.6, 5), 0x524840, M(0.3, 8.1, -0.15, 0.12, 0.4, -0.1)));
      parts.push(colored(new THREE.CylinderGeometry(0.4, 0.9, 2.6, 5), 0x342e28, M(1.3, 1.3, 0.4, 0, 0.6, -0.25)));
      parts.push(colored(new THREE.DodecahedronGeometry(0.8, 0), 0x2f2a25, M(-1.1, 0.4, 0.5, 0.4, 0, 0.2, [1.2, 0.7, 1])));
      break;
    }
    case 'boulder':
      parts.push(colored(new THREE.DodecahedronGeometry(1.0, 0), 0x463e36, M(0, 0.55, 0, 0.3, 0, 0.2, [1.3, 0.8, 1.1])));
      parts.push(colored(new THREE.DodecahedronGeometry(0.55, 0), 0x3a332d, M(0.95, 0.3, 0.4, 0.5, 0.2, 0)));
      parts.push(colored(new THREE.DodecahedronGeometry(0.4, 0), 0x51473e, M(-0.8, 0.22, -0.5, 0.2, 0.6, 0.3)));
      break;
    case 'deadtree': {
      // Charred trunk with bare, crooked branches. Tall enough to clear the lair walls.
      const bark = 0x2a211b;
      parts.push(colored(new THREE.CylinderGeometry(0.22, 0.5, 8, 6), bark, M(0, 4, 0, 0.04, 0, -0.05)));
      [
        [5.2, 0.9, 0.6, 2.4],
        [6.3, -0.8, 2.5, 2.0],
        [7.2, 0.7, 4.2, 1.6],
        [4.2, -0.9, 5.3, 1.8],
      ].forEach(([y, tilt, yaw, len]) => {
        const m = new THREE.Matrix4()
          .makeRotationY(yaw)
          .multiply(new THREE.Matrix4().makeRotationZ(tilt))
          .multiply(new THREE.Matrix4().makeTranslation(0, len / 2, 0));
        m.premultiply(new THREE.Matrix4().makeTranslation(0, y, 0));
        parts.push(colored(new THREE.CylinderGeometry(0.05, 0.14, len, 4), bark, m));
      });
      parts.push(colored(new THREE.CylinderGeometry(0.55, 0.7, 0.35, 6), 0x1f1915, M(0, 0.15, 0)));
      break;
    }
    case 'skull': {
      // Big horned skull (~1.3m long), resting on the ground.
      parts.push(colored(new THREE.DodecahedronGeometry(0.6, 0), BONE, M(0, 0.5, 0, 0, 0, 0, [1, 0.85, 1.2])));
      parts.push(colored(new THREE.BoxGeometry(0.55, 0.35, 0.9), BONE_DARK, M(0, 0.3, 0.7, 0.15, 0, 0)));
      parts.push(colored(new THREE.BoxGeometry(0.5, 0.12, 0.8), BONE_DARK, M(0, 0.08, 0.6, -0.05, 0, 0)));
      for (const sx of [-1, 1]) {
        parts.push(colored(new THREE.ConeGeometry(0.12, 1.1, 5), BONE, M(sx * 0.45, 0.85, -0.35, -0.9, 0, -sx * 0.5)));
        parts.push(colored(new THREE.SphereGeometry(0.13, 5, 4), 0x1a1410, M(sx * 0.22, 0.6, 0.45)));
      }
      break;
    }
    case 'ribcage': {
      // Carcass of something huge: a spine along X with ribs arching over, ends broken off.
      const n = 7;
      for (let i = 0; i < n; i++) {
        const x = -3.6 + i * 1.2;
        const r = 2.6 - Math.abs(i - 2) * 0.32;
        const arc = Math.PI * (0.62 + ((i * 37) % 10) / 40);
        // Torus is in XY starting at +X; rotateY puts it in the YZ plane, starting at -Z (spine side).
        const rib = new THREE.TorusGeometry(r, 0.13, 4, 12, arc).rotateY(Math.PI / 2);
        parts.push(colored(rib, i % 2 ? BONE : BONE_DARK, M(x, 0, 0, 0.18 * ((i % 3) - 1), 0, 0)));
        parts.push(colored(new THREE.BoxGeometry(0.7, 0.45, 0.55), BONE_DARK, M(x, 0.18, -r, 0, 0.2, 0)));
      }
      parts.push(colored(new THREE.CylinderGeometry(0.16, 0.08, 3.2, 5), BONE, M(4.9, 0.12, -2.0, 0, 0.3, Math.PI / 2)));
      break;
    }
    case 'stalag':
      // Cluster of stalagmites, the tallest ~3.4m.
      parts.push(colored(new THREE.ConeGeometry(0.55, 3.4, 6), 0x3a302a, M(0, 1.7, 0, 0.04, 0, -0.05)));
      parts.push(colored(new THREE.ConeGeometry(0.38, 2.1, 5), 0x463a32, M(0.62, 1.05, 0.2, -0.08, 0.5, 0.1)));
      parts.push(colored(new THREE.ConeGeometry(0.3, 1.4, 5), 0x2f2722, M(-0.5, 0.7, 0.35, 0.1, 1.1, -0.12)));
      parts.push(colored(new THREE.DodecahedronGeometry(0.5, 0), 0x2c2520, M(0.1, 0.18, -0.4, 0.4, 0, 0.2, [1.3, 0.5, 1])));
      break;
    case 'mosscrag':
      // Wet, moss-streaked rock spire for the flooded caves (~7m).
      parts.push(colored(new THREE.CylinderGeometry(0.9, 1.7, 4.2, 6), 0x2c3a36, M(0, 2.1, 0, 0.05, 0.3, -0.06)));
      parts.push(colored(new THREE.CylinderGeometry(0.4, 1.0, 3.2, 5), 0x34463e, M(0.15, 5.3, -0.1, -0.08, 1.1, 0.1)));
      parts.push(colored(new THREE.SphereGeometry(1.0, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2), 0x3e6a3a, M(0.2, 4.1, 0.1, 0, 0, 0, [1.1, 0.35, 1.1])));
      parts.push(colored(new THREE.DodecahedronGeometry(0.8, 0), 0x26332f, M(-1.1, 0.4, 0.5, 0.4, 0, 0.2, [1.2, 0.7, 1])));
      break;
    case 'mushroom': {
      // A clump of pale cave mushrooms.
      [
        [0, 0, 1.1, 0.55],
        [0.5, 0.3, 0.7, 0.38],
        [-0.4, 0.35, 0.5, 0.28],
      ].forEach(([x, z, h, r]) => {
        parts.push(colored(new THREE.CylinderGeometry(r * 0.25, r * 0.32, h, 6), 0xd8d0b8, M(x, h / 2, z)));
        parts.push(colored(new THREE.SphereGeometry(r, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2), 0x6aa8a0, M(x, h, z, 0, 0, 0, [1, 0.55, 1])));
      });
      break;
    }
    case 'crystal':
      // Glowing crystal cluster (drawn unlit so it reads as a light source).
      parts.push(colored(new THREE.OctahedronGeometry(0.35, 0), 0x70f0ff, M(0, 0.55, 0, 0, 0, 0, [0.6, 1.8, 0.6])));
      parts.push(colored(new THREE.OctahedronGeometry(0.25, 0), 0x40c8e8, M(0.3, 0.35, 0.1, 0, 0.4, -0.5, [0.6, 1.6, 0.6])));
      parts.push(colored(new THREE.OctahedronGeometry(0.22, 0), 0x9af8ff, M(-0.25, 0.3, -0.12, 0.3, 0.9, 0.5, [0.6, 1.5, 0.6])));
      break;
    case 'crate': {
      // Steel cargo crate with darker edge bands (~1.2 m).
      parts.push(colored(new THREE.BoxGeometry(1.2, 1.1, 1.2), 0x5c6570, M(0, 0.55, 0)));
      for (const y of [0.08, 1.02]) parts.push(colored(new THREE.BoxGeometry(1.26, 0.12, 1.26), 0x353a42, M(0, y, 0)));
      parts.push(colored(new THREE.BoxGeometry(0.5, 0.25, 0.04), 0xd0a020, M(0, 0.6, 0.62)));
      break;
    }
    case 'drum':
      // Oil drum with rims.
      parts.push(colored(new THREE.CylinderGeometry(0.42, 0.42, 1.05, 10), 0x9a4a2a, M(0, 0.53, 0)));
      for (const y of [0.25, 0.8]) parts.push(colored(new THREE.CylinderGeometry(0.44, 0.44, 0.06, 10), 0x5a2a18, M(0, y, 0)));
      parts.push(colored(new THREE.CylinderGeometry(0.4, 0.4, 0.04, 10), 0x2a2a2a, M(0, 1.06, 0)));
      break;
    case 'tank':
      // Upright storage tank on legs, with a ladder (~4 m).
      parts.push(colored(new THREE.CylinderGeometry(1.2, 1.2, 3, 12), 0x6a7078, M(0, 2.2, 0)));
      parts.push(colored(new THREE.SphereGeometry(1.2, 12, 5, 0, Math.PI * 2, 0, Math.PI / 2), 0x737a82, M(0, 3.7, 0, 0, 0, 0, [1, 0.45, 1])));
      parts.push(colored(new THREE.CylinderGeometry(1.24, 1.24, 0.15, 12), 0xd0a020, M(0, 2.9, 0)));
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + 0.4;
        parts.push(colored(new THREE.BoxGeometry(0.16, 0.8, 0.16), 0x3a3e44, M(Math.sin(a) * 0.95, 0.4, Math.cos(a) * 0.95)));
      }
      for (const s of [-1, 1]) parts.push(colored(new THREE.BoxGeometry(0.05, 3.2, 0.05), 0x3a3e44, M(s * 0.22, 2.2, 1.28)));
      for (let y = 0.9; y < 3.6; y += 0.4) parts.push(colored(new THREE.BoxGeometry(0.44, 0.04, 0.04), 0x3a3e44, M(0, y, 1.28)));
      break;
    case 'pipes':
      // A run of three pipes on brackets (2 m long, along X), for wall tops and skylines.
      for (const [y, z, r, c] of [[0.35, -0.35, 0.22, 0x7a6a5a], [0.4, 0.15, 0.3, 0x5a646e], [0.95, -0.1, 0.18, 0x8a5a3a]] as const) {
        parts.push(colored(new THREE.CylinderGeometry(r, r, 2.05, 8), c, M(0, y, z, 0, 0, Math.PI / 2)));
      }
      for (const x of [-0.7, 0.7]) parts.push(colored(new THREE.BoxGeometry(0.12, 1.2, 1.0), 0x34383e, M(x, 0.6, -0.05)));
      break;
    case 'console':
      // Control console with a glowing screen.
      parts.push(colored(new THREE.BoxGeometry(1.4, 0.9, 0.7), 0x4a515a, M(0, 0.45, 0)));
      parts.push(colored(new THREE.BoxGeometry(1.45, 0.12, 0.8), 0x2c3036, M(0, 0.95, 0.05, -0.45, 0, 0)));
      parts.push(colored(new THREE.BoxGeometry(1.1, 0.7, 0.08), 0x2c3036, M(0, 1.45, -0.3, -0.2, 0, 0)));
      parts.push(colored(new THREE.BoxGeometry(0.95, 0.55, 0.02), 0x60e0ff, M(0, 1.46, -0.25, -0.2, 0, 0)));
      for (let i = 0; i < 4; i++) parts.push(colored(new THREE.BoxGeometry(0.12, 0.04, 0.08), i % 2 ? 0xff5030 : 0x50ff70, M(-0.45 + i * 0.3, 1.01, 0.18, -0.45, 0, 0)));
      break;
    case 'girder':
      // Tall steel I-beam column with cross braces (~8 m), for the skyline behind the walls.
      for (const s of [-1, 1]) parts.push(colored(new THREE.BoxGeometry(0.15, 8, 0.7), 0x5a5048, M(s * 0.45, 4, 0)));
      parts.push(colored(new THREE.BoxGeometry(0.8, 8, 0.1), 0x4e463e, M(0, 4, 0)));
      for (let y = 1.5; y < 8; y += 2) parts.push(colored(new THREE.BoxGeometry(0.1, 2.3, 0.12), 0x6a5e52, M(0, y, 0.38, 0, 0, 0.9)));
      parts.push(colored(new THREE.BoxGeometry(1.6, 0.3, 1.2), 0x3e3832, M(0, 8.1, 0)));
      break;
    case 'stack':
      // Foundry chimney stack (~10 m) with a warning band.
      parts.push(colored(new THREE.CylinderGeometry(0.8, 1.1, 10, 10), 0x4a4440, M(0, 5, 0)));
      parts.push(colored(new THREE.CylinderGeometry(0.85, 0.85, 0.5, 10), 0xd0a020, M(0, 8.5, 0)));
      parts.push(colored(new THREE.CylinderGeometry(0.95, 0.85, 0.4, 10), 0x2a2624, M(0, 10.1, 0)));
      break;
    case 'glowcrystal':
      // A crystal cluster in white and pale greys, so an instance colour tints it fully.
      parts.push(colored(new THREE.OctahedronGeometry(0.35, 0), 0xffffff, M(0, 0.6, 0, 0, 0, 0, [0.6, 2.0, 0.6])));
      parts.push(colored(new THREE.OctahedronGeometry(0.26, 0), 0xc8c8c8, M(0.32, 0.4, 0.12, 0, 0.4, -0.5, [0.6, 1.7, 0.6])));
      parts.push(colored(new THREE.OctahedronGeometry(0.24, 0), 0xe8e8e8, M(-0.28, 0.34, -0.14, 0.3, 0.9, 0.5, [0.6, 1.6, 0.6])));
      parts.push(colored(new THREE.OctahedronGeometry(0.18, 0), 0xa0a0a0, M(0.05, 0.22, 0.32, -0.4, 0.2, 0.2, [0.6, 1.4, 0.6])));
      break;
    case 'glowshroom': {
      // Luminous mushrooms: bright caps, dim stems.
      [
        [0, 0, 1.2, 0.6],
        [0.55, 0.3, 0.75, 0.4],
        [-0.45, 0.35, 0.55, 0.3],
        [0.15, -0.5, 0.45, 0.24],
      ].forEach(([x, z, h, r]) => {
        parts.push(colored(new THREE.CylinderGeometry(r * 0.22, r * 0.3, h, 6), 0x606060, M(x, h / 2, z)));
        parts.push(colored(new THREE.SphereGeometry(r, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), 0xffffff, M(x, h, z, 0, 0, 0, [1, 0.5, 1])));
      });
      break;
    }
    case 'bones':
      // A small scatter of loose bones lying flat.
      parts.push(colored(new THREE.CylinderGeometry(0.07, 0.07, 1.3, 5), BONE, M(0, 0.07, 0, 0, 0.4, Math.PI / 2)));
      parts.push(colored(new THREE.CylinderGeometry(0.06, 0.06, 0.9, 5), BONE_DARK, M(0.3, 0.07, 0.35, 0, -0.7, Math.PI / 2)));
      parts.push(colored(new THREE.SphereGeometry(0.12, 5, 4), BONE, M(-0.6, 0.1, -0.25)));
      parts.push(colored(new THREE.SphereGeometry(0.12, 5, 4), BONE, M(0.62, 0.1, 0.25)));
      parts.push(colored(new THREE.BoxGeometry(0.3, 0.18, 0.22), BONE_DARK, M(-0.3, 0.09, 0.45, 0, 0.5, 0)));
      break;
  }
  const g = mergeGeometries(parts)!;
  g.computeVertexNormals();
  cache.set(kind, g);
  return g;
}

const neutralCache = new Map<PropKind, THREE.BufferGeometry>();

/** The prop with its colours turned to brightened greys, so an instance colour can repaint it (area looks). */
export function neutralPropGeometry(kind: PropKind): THREE.BufferGeometry {
  const hit = neutralCache.get(kind);
  if (hit) return hit;
  const g = propGeometry(kind).clone();
  const col = g.getAttribute('color') as THREE.BufferAttribute;
  for (let i = 0; i < col.count; i++) {
    const l = Math.min(1, (col.getX(i) * 0.3 + col.getY(i) * 0.59 + col.getZ(i) * 0.11) * 2.4 + 0.15);
    col.setXYZ(i, l, l, l);
  }
  neutralCache.set(kind, g);
  return g;
}

export function propMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 });
}

/** Convenience for the viewer: a single non-instanced prop. */
export function buildProp(kind: PropKind): THREE.Mesh {
  const m = new THREE.Mesh(propGeometry(kind), propMaterial());
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
