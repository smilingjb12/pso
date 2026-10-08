import * as THREE from 'three';
import { mat, part } from './Rig';

// Alternative Mag looks, compared in the Mag Lab (/maglab.html). A design gives each arm
// (DEF, POW, DEX, MIND) its own shape; stage 1 uses the class's own arm in a lighter form,
// stage 0 stays the shared plain Mag and stage 4 is two stage-3 Mags. Every design keeps
// the glow stripes (lit while Mag points wait to be spent) and faces +Z like the classic Mag.
// Parts are built for the right-hand side; `mirrored` copies them to the left.

export type MagTheme = 'def' | 'pow' | 'dex' | 'mind';

export interface MagKit {
  body: THREE.Group;
  /** 1-3. */
  stage: number;
  theme: MagTheme;
  color: number;
  shell: THREE.MeshStandardMaterial;
  trim: THREE.MeshStandardMaterial;
  glow: THREE.MeshStandardMaterial;
  stripe: THREE.MeshStandardMaterial;
  /** Per-frame animation, given the Mag's clock in seconds. */
  anim: ((t: number) => void)[];
}

export interface MagDesign {
  name: string;
  desc: string;
  build: (k: MagKit) => void;
}

// ---------------------------------------------------------------- helpers

type V3 = [number, number, number];
type Outline = [number, number][];

/** Flat plate from an outline in the XZ plane ([x, z] points, +Z forward), `t` thick. */
function plateGeo(pts: Outline, t = 0.012): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z))), { depth: t, bevelEnabled: false });
  g.rotateX(-Math.PI / 2);
  g.translate(0, -t / 2, 0);
  return g;
}

/** Upright plate from an outline in the YZ plane ([y, z] points), `t` thick along X. */
function finGeo(pts: Outline, t = 0.01): THREE.BufferGeometry {
  return plateGeo(pts, t).rotateZ(Math.PI / 2);
}

/** Flat hexagon outline, `h` tall (first axis) and `w` long (second axis). */
function hex(h: number, w: number): Outline {
  return [[h / 2, w / 4], [0, w / 2], [-h / 2, w / 4], [-h / 2, -w / 4], [0, -w / 2], [h / 2, -w / 4]];
}

/** A cone with its base at `base`, pointing along `dir`. */
function spike(parent: THREE.Object3D, r: number, len: number, m: THREE.Material, base: V3, dir: V3, segs = 4): THREE.Mesh {
  const mesh = part(parent, new THREE.ConeGeometry(r, len, segs).translate(0, len / 2, 0), m, base);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...dir).normalize());
  return mesh;
}

/**
 * A right-hand pivot at `pos` and its mirror image on the left. Build and animate the
 * pivot as the right side; the left copy follows mirrored.
 */
function mirrored(parent: THREE.Object3D, pos: V3, build: (pivot: THREE.Group) => void): THREE.Group[] {
  return [1, -1].map((side) => {
    const outer = new THREE.Group();
    outer.position.set(side * pos[0], pos[1], pos[2]);
    outer.scale.x = side;
    parent.add(outer);
    const pivot = new THREE.Group();
    outer.add(pivot);
    build(pivot);
    return pivot;
  });
}

/** Flap pivots up and down around `base` (radians of lift). */
function flap(k: MagKit, pivots: THREE.Object3D[], base: number, amp: number, rate: number, phase = 0): void {
  k.anim.push((t) => pivots.forEach((p) => (p.rotation.z = base + Math.sin(t * rate + phase) * amp)));
}

/** A glow stripe ring around the body at height `y`, `rx` by `rz` across. */
function band(k: MagKit, y: number, rx: number, rz: number, segs = 16): void {
  part(k.body, new THREE.TorusGeometry(rx, 0.0065, 3, segs), k.stripe, [0, y, 0], [Math.PI / 2, 0, 0], [1, rz / rx, 1]);
}

/** Stripes hugging an ellipsoid with radii a, b, c centred at `y0`. */
function ellipsoidBands(k: MagKit, a: number, b: number, c: number, ys: number[], y0 = 0, segs = 16): void {
  for (const y of ys) {
    const f = Math.sqrt(Math.max(0, 1 - (y / b) ** 2));
    band(k, y0 + y, a * f + 0.004, c * f + 0.004, segs);
  }
}

/** Stripes hugging an octahedron with half-extents a, b, c (diamond cross-sections). */
function diamondBands(k: MagKit, a: number, b: number, c: number, ys: number[]): void {
  for (const y of ys) {
    const f = 1 - Math.abs(y) / b;
    band(k, y, a * f + 0.004, c * f + 0.004, 4);
  }
}

function eye(k: MagKit, r: number, pos: V3): void {
  part(k.body, new THREE.SphereGeometry(r, 8, 6), k.glow, pos);
}

/** Softly glowing crystal material in the form colour. */
function crystal(color: number): THREE.MeshStandardMaterial {
  const m = mat(color, { emissive: color, emissiveIntensity: 0.55, rough: 0.3 });
  m.userData.glow = true;
  return m;
}

/** 1 at stage 1, growing with the stage. */
const grow = (k: MagKit, per = 0.12) => 1 + (k.stage - 1) * per;

// --------------------------------------------------------- shared gear
// Arm-themed attachments, used on the arm's own body (Silhouettes) or the classic pod (Kits).
// `w` is the body's half-width where side parts attach.

const BLADE: Outline = [[0, -0.035], [0, 0.03], [0.17, 0.085], [0.11, 0.02], [0.15, -0.02]];
const BLADE_EDGE: Outline = [[0.01, 0.03], [0.17, 0.085], [0.15, 0.08], [0.01, 0.017]];
const LONG_WING: Outline = [[0, 0.035], [0, -0.01], [0.2, -0.1], [0.225, -0.083]];
const LONG_EDGE: Outline = [[0.01, 0.035], [0.225, -0.083], [0.212, -0.083], [0.01, 0.024]];

/** POW: forward-swept blades and horns; a spiked crescent from stage 2, a back-swept second pair at 3. */
function gearPow(k: MagKit, w: number, top: number): void {
  const s = grow(k, 0.15);
  const blades = mirrored(k.body, [w - 0.01, 0.005, 0], (p) => {
    part(p, plateGeo(BLADE, 0.014), k.trim, [0, 0, 0], [0, 0, 0], [s, 1, s]);
    part(p, plateGeo(BLADE_EDGE, 0.006), k.glow, [0, 0.009, 0], [0, 0, 0], [s, 1, s]);
  });
  flap(k, blades, 0.12, 0.1, 3.4);
  mirrored(k.body, [0.03, top - 0.01, 0.02], (p) => spike(p, 0.012, 0.05 + 0.015 * k.stage, k.trim, [0, 0, 0], [0.35, 1, 0.8]));
  if (k.stage >= 2) {
    const arc = new THREE.Group();
    arc.position.set(0, 0, -0.06);
    k.body.add(arc);
    part(arc, new THREE.TorusGeometry(0.15, 0.008, 3, 14, Math.PI), k.glow);
    const n = k.stage >= 3 ? 5 : 3;
    for (let i = 0; i < n; i++) {
      const a = ((i + 1) / (n + 1)) * Math.PI;
      spike(arc, 0.012, 0.045, k.glow, [Math.cos(a) * 0.15, Math.sin(a) * 0.15, 0], [Math.cos(a), Math.sin(a), 0]);
    }
    k.anim.push((t) => (arc.rotation.z = Math.sin(t * 0.9) * 0.12));
  }
  if (k.stage >= 3) {
    const low = mirrored(k.body, [w - 0.015, -0.03, -0.02], (p) => {
      part(p, plateGeo(BLADE.map(([x, z]): [number, number] => [x * 0.8, -z]), 0.012), k.trim, [0, 0, 0], [0, 0, -0.35]);
    });
    flap(k, low, -0.05, 0.08, 3.4, 0.8);
  }
}

/** Flat-shaded three-sided cone (a 3D triangle), a flat face toward +Z; `down` points the tip down. */
function triCone(r: number, h: number, down: boolean): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(r, h, 3);
  if (down) g.rotateX(Math.PI);
  else g.rotateY(Math.PI);
  const flat = g.toNonIndexed();
  flat.computeVertexNormals();
  return flat;
}

/** A floating crown of `n` spikes above the body at `y`, bobbing and turning. */
function magCrown(k: MagKit, y: number, R: number, n: number, tall: number): void {
  const crown = new THREE.Group();
  k.body.add(crown);
  part(crown, new THREE.TorusGeometry(R, 0.006, 3, 24), k.glow, [0, 0, 0], [Math.PI / 2, 0, 0]);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const len = i % 2 ? tall * 0.6 : tall;
    spike(crown, 0.011, len, i % 2 ? k.trim : k.glow, [Math.cos(a) * R, 0, Math.sin(a) * R], [Math.cos(a) * 0.3, 1, Math.sin(a) * 0.3]);
  }
  k.anim.push((t) => {
    crown.position.y = y + Math.sin(t * 2.2) * 0.008;
    crown.rotation.y = t * 0.8;
  });
}

/**
 * POW (Kits): an inverted three-sided pyramid, point down, with forward-swept blades and horns.
 * Stage 2 adds a floating spiked crown and a glowing stinger under the point; stage 3 a taller
 * crown, a back-swept second blade pair and a spiked crescent behind.
 */
function vanguardMag(k: MagKit): void {
  const [yTop, yTip, R0] = [0.06, -0.17, 0.12];
  /** Circumradius of the body at height y. */
  const rad = (y: number) => (R0 * (y - yTip)) / (yTop - yTip);
  part(k.body, triCone(R0, yTop - yTip, true), k.shell, [0, (yTop + yTip) / 2, 0]);
  part(k.body, triCone(R0 * 0.98, 0.035, false), k.trim, [0, yTop + 0.0175, 0]);
  eye(k, 0.026, [0, 0.015, rad(0.015) * 0.5]);
  for (const y of [0.035, -0.02, -0.075]) {
    // Triangular stripes; a band's corners sit on the body's edges.
    part(k.body, new THREE.TorusGeometry(rad(y) + 0.008, 0.0065, 3, 3).rotateX(Math.PI / 2).rotateY(-Math.PI / 6), k.stripe, [0, y, 0]);
  }
  const s = [1.25, 1.45, 1.6][k.stage - 1];
  const blades = mirrored(k.body, [0.07, 0.0, 0.03], (p) => {
    part(p, plateGeo(BLADE, 0.014), k.trim, [0, 0, 0], [0, 0, 0], [s, 1, s]);
    part(p, plateGeo(BLADE_EDGE, 0.006), k.glow, [0, 0.009, 0], [0, 0, 0], [s, 1, s]);
  });
  flap(k, blades, 0.12, 0.1, 3.4);
  mirrored(k.body, [0.055, yTop + 0.02, 0.025], (p) => spike(p, 0.013, 0.05 + 0.02 * k.stage, k.trim, [0, 0, 0], [0.45, 1, 0.7]));
  if (k.stage >= 2) {
    spike(k.body, 0.016, 0.07 + 0.02 * k.stage, k.glow, [0, yTip + 0.02, 0], [0, -1, 0], 3);
    magCrown(k, yTop + 0.07, k.stage >= 3 ? 0.065 : 0.055, k.stage >= 3 ? 8 : 6, k.stage >= 3 ? 0.075 : 0.055);
  }
  if (k.stage >= 3) {
    const low = mirrored(k.body, [0.055, -0.05, 0.0], (p) => {
      part(p, plateGeo(BLADE.map(([x, z]): [number, number] => [x * 0.85, -z]), 0.012), k.trim, [0, 0, 0], [0, 0, -0.4]);
    });
    flap(k, low, -0.05, 0.08, 3.4, 0.8);
    const arc = new THREE.Group();
    arc.position.set(0, 0, -0.08);
    k.body.add(arc);
    part(arc, new THREE.TorusGeometry(0.17, 0.008, 3, 14, Math.PI), k.glow);
    for (let i = 0; i < 5; i++) {
      const a = ((i + 1) / 6) * Math.PI;
      spike(arc, 0.013, 0.055, k.glow, [Math.cos(a) * 0.17, Math.sin(a) * 0.17, 0], [Math.cos(a), Math.sin(a), 0]);
    }
    k.anim.push((t) => (arc.rotation.z = Math.sin(t * 0.9) * 0.12));
  }
}

/** DEX: long swept-back wings and a tail fin; a sighting ring from stage 2; canards, twin fins and streamers at 3. */
function gearDex(k: MagKit, w: number, top: number, tail: number): void {
  const s = grow(k, 0.12);
  const wings = mirrored(k.body, [w - 0.01, 0.01, 0], (p) => {
    part(p, plateGeo(LONG_WING, 0.012), k.trim, [0, 0, 0], [0, 0, 0], [s, 1, 1]);
    if (k.stage >= 2) part(p, plateGeo(LONG_EDGE, 0.005), k.glow, [0, 0.008, 0], [0, 0, 0], [s, 1, 1]);
    part(p, new THREE.BoxGeometry(0.03, 0.012, 0.022), k.glow, [0.212 * s, 0.004, -0.092]);
  });
  flap(k, wings, 0.06, 0.1, 4.2);
  const fin: Outline = [[0, tail + 0.06], [0, tail], [0.1, tail - 0.05], [0.085, tail - 0.01]];
  if (k.stage >= 3) mirrored(k.body, [0.02, top - 0.02, 0], (p) => part(p, finGeo(fin), k.trim, [0, 0, 0], [0, 0, -0.4]));
  else part(k.body, finGeo(fin), k.trim, [0, top - 0.02, 0]);
  if (k.stage >= 2) {
    const ring = new THREE.Group();
    k.body.add(ring);
    part(ring, new THREE.TorusGeometry(0.17, 0.005, 3, 32), k.glow, [0, 0, 0], [Math.PI / 2, 0, 0]);
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2 + Math.PI / 4;
      part(ring, new THREE.BoxGeometry(0.012, 0.012, 0.04), k.glow, [Math.cos(a) * 0.17, 0, Math.sin(a) * 0.17], [0, Math.PI / 2 - a, 0]);
    }
    k.anim.push((t) => (ring.rotation.y = t * 0.7));
  }
  if (k.stage >= 3) {
    mirrored(k.body, [w - 0.02, 0, 0.09], (p) => part(p, plateGeo([[0, 0.02], [0, -0.015], [0.07, -0.03], [0.075, -0.015]], 0.01), k.trim));
    const streamers = mirrored(k.body, [0.025, 0, tail], (p) => spike(p, 0.008, 0.2, k.glow, [0, 0, 0], [0.15, 0, -1]));
    k.anim.push((t) => streamers.forEach((p) => (p.rotation.y = Math.sin(t * 2.6) * 0.15)));
  }
}

/** DEF: hexagonal side shields; a hex ward ring and turret from stage 2; pauldron shields at 3. */
function gearDef(k: MagKit, w: number, top: number): void {
  const [h, len] = [[0.1, 0.12], [0.13, 0.15], [0.15, 0.17]][k.stage - 1];
  const shields = mirrored(k.body, [w + 0.025, 0, 0.01], (p) => {
    part(p, finGeo(hex(h, len), 0.014), k.trim);
    part(p, finGeo(hex(h * 0.5, len * 0.5), 0.006), k.glow, [0.009, 0, 0]);
  });
  k.anim.push((t) => shields.forEach((p) => (p.rotation.y = -0.25 + Math.sin(t * 1.5) * 0.05)));
  if (k.stage >= 2) {
    const ring = part(k.body, new THREE.TorusGeometry(0.2, 0.008, 3, 6), k.glow, [0, -0.01, 0], [Math.PI / 2, 0, 0]);
    k.anim.push((t) => (ring.rotation.z = t * 0.5));
    part(k.body, new THREE.CylinderGeometry(0.026, 0.036, 0.035, 6), k.trim, [0, top + 0.01, 0]);
    part(k.body, new THREE.CylinderGeometry(0.018, 0.018, 0.01, 6), k.glow, [0, top + 0.03, 0]);
  }
  if (k.stage >= 3) {
    mirrored(k.body, [w - 0.01, 0.065, -0.01], (p) => {
      part(p, plateGeo(hex(0.07, 0.1), 0.012), k.trim, [0.035, 0, 0], [0, 0, -0.5]);
      part(p, plateGeo(hex(0.035, 0.05), 0.005), k.glow, [0.035, 0.008, 0], [0, 0, -0.5]);
    });
  }
}

/** MIND: crystals orbiting the body (or floating petals); a halo from stage 2; a crown and gyroscope ring at 3. */
function gearMind(k: MagKit, w: number, top: number, petals: boolean): void {
  const gem = crystal(k.color);
  const n = petals ? k.stage - 1 : k.stage + 1;
  const shards: THREE.Mesh[] = [];
  for (let i = 0; i < n; i++) shards.push(part(k.body, new THREE.OctahedronGeometry(0.022, 0), gem, [0, 0, 0], [0, 0, 0], [0.7, 1.9, 0.7]));
  const r = 0.17 + k.stage * 0.01;
  k.anim.push((t) =>
    shards.forEach((m, i) => {
      const a = t * 0.9 + (i * Math.PI * 2) / n;
      m.position.set(Math.cos(a) * r, 0.01 + Math.sin(t * 1.7 + i) * 0.02, Math.sin(a) * r);
      m.rotation.y = t * 2;
    }),
  );
  if (petals) {
    const leaf: Outline = [[0, 0], [0.06, 0.04], [0.16, 0.025], [0.2, -0.02], [0.12, -0.05], [0.04, -0.03]];
    const vein: Outline = [[0.02, -0.002], [0.17, 0.0], [0.17, -0.01], [0.02, -0.012]];
    const s = grow(k, 0.12);
    const pairs = k.stage >= 3 ? [[0.02, 0.02], [-0.04, -0.06]] : [[0.01, 0.0]];
    pairs.forEach(([y, z], j) => {
      const ps = mirrored(k.body, [w + 0.035, y, z], (p) => {
        part(p, plateGeo(leaf, 0.01), k.trim, [0, 0, 0], [0, j ? 0.5 : 0, j ? -0.3 : 0.15], [s, 1, s]);
        part(p, plateGeo(vein, 0.004), k.glow, [0, 0.007, 0], [0, j ? 0.5 : 0, j ? -0.3 : 0.15], [s, 1, s]);
      });
      k.anim.push((t) => ps.forEach((p) => {
        p.position.y = Math.sin(t * 1.8 + j) * 0.015;
        p.rotation.z = Math.sin(t * 1.8 + j + 0.6) * 0.12;
      }));
    });
  }
  if (k.stage >= 2) {
    const halo = part(k.body, new THREE.TorusGeometry(0.11, 0.007, 4, 24), k.glow, [0, 0.04, -0.1]);
    k.anim.push((t) => (halo.rotation.z = t * 0.4));
  }
  if (k.stage >= 3) {
    const crown: THREE.Mesh[] = [];
    for (let i = -1; i <= 1; i++) {
      crown.push(part(k.body, new THREE.OctahedronGeometry(0.018, 0), gem, [i * 0.045, top + 0.06 - Math.abs(i) * 0.015, 0], [0, 0, -i * 0.3], [0.7, 2, 0.7]));
    }
    k.anim.push((t) => crown.forEach((m, i) => (m.position.y = top + 0.06 - Math.abs(i - 1) * 0.015 + Math.sin(t * 2.2 + i) * 0.01)));
    const gyro = new THREE.Group();
    gyro.rotation.x = 0.7;
    k.body.add(gyro);
    const g = part(gyro, new THREE.TorusGeometry(0.14, 0.005, 3, 28), k.glow);
    k.anim.push((t) => (g.rotation.x = t * 1.1));
  }
}

// ----------------------------------------------------------- body plans

/** The classic pod: octahedron, rounded from stage 2, with three stripes. Returns its half-width. */
function classicPod(k: MagKit): number {
  const round = k.stage >= 2;
  part(k.body, new THREE.OctahedronGeometry(0.1, round ? 1 : 0), k.shell, [0, 0, 0], [0, 0, 0], [1, 0.85, 1.25]);
  eye(k, 0.035, [0, 0.01, 0.11]);
  if (round) ellipsoidBands(k, 0.1, 0.085, 0.125, [0, 0.036, -0.036]);
  else diamondBands(k, 0.1, 0.085, 0.125, [0, 0.036, -0.036]);
  return 0.085;
}

/** POW body: a long arrowhead pointing forward. */
function bladePod(k: MagKit): number {
  part(k.body, new THREE.OctahedronGeometry(0.1, 0), k.shell, [0, 0, 0], [0, 0, 0], [0.85, 0.7, 1.55]);
  eye(k, 0.026, [0, 0.02, 0.095]);
  diamondBands(k, 0.085, 0.07, 0.155, [0, 0.026, -0.026]);
  return 0.08;
}

/** DEX body: a slim dart. */
function dartPod(k: MagKit): number {
  part(k.body, new THREE.OctahedronGeometry(0.1, 1), k.shell, [0, 0, 0], [0, 0, 0], [0.7, 0.62, 1.7]);
  eye(k, 0.022, [0, 0.014, 0.15]);
  ellipsoidBands(k, 0.07, 0.062, 0.17, [0, 0.024, -0.024], 0, 12);
  return 0.065;
}

/** DEF body: a squat dome. */
function domePod(k: MagKit): number {
  part(k.body, new THREE.SphereGeometry(0.1, 12, 8), k.shell, [0, 0, 0], [0, 0, 0], [1.15, 0.72, 1.05]);
  eye(k, 0.03, [0, 0.012, 0.1]);
  ellipsoidBands(k, 0.115, 0.072, 0.105, [0, 0.03, -0.03]);
  return 0.115;
}

/** MIND body: a faceted orb. */
function orbPod(k: MagKit): number {
  part(k.body, new THREE.IcosahedronGeometry(0.088, 1), k.shell);
  eye(k, 0.03, [0, 0.01, 0.082]);
  ellipsoidBands(k, 0.088, 0.088, 0.088, [0, 0.036, -0.036]);
  return 0.088;
}

// ------------------------------------------------------------ creatures

function tortoise(k: MagKit): void {
  const s = grow(k, 0.08);
  k.body.scale.multiplyScalar(s);
  part(k.body, new THREE.SphereGeometry(0.1, 10, 6), k.shell, [0, -0.012, 0], [0, 0, 0], [1.1, 0.45, 1.15]);
  part(k.body, new THREE.SphereGeometry(0.105, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2), k.trim, [0, -0.005, 0], [0, 0, 0], [1.12, 0.75, 1.18]);
  ellipsoidBands(k, 0.118, 0.079, 0.124, [0.004, 0.04], -0.005, 14);
  part(k.body, new THREE.SphereGeometry(0.038, 8, 6), k.shell, [0, 0.0, 0.14]);
  eye(k, 0.016, [0, 0.016, 0.172]);
  const flipper: Outline = [[0, 0.02], [0.06, 0.035], [0.09, 0.005], [0.06, -0.02], [0, -0.015]];
  const front = mirrored(k.body, [0.09, -0.015, 0.06], (p) => part(p, plateGeo(flipper, 0.01), k.shell));
  const back = mirrored(k.body, [0.085, -0.015, -0.07], (p) => part(p, plateGeo(flipper, 0.01), k.shell, [0, 0, 0], [0, 0.5, 0], [0.7, 1, 0.7]));
  k.anim.push((t) => {
    front.forEach((p) => (p.rotation.y = Math.sin(t * 2.4) * 0.35));
    back.forEach((p) => (p.rotation.y = Math.sin(t * 2.4 + 1.6) * 0.3));
  });
  if (k.stage >= 2) {
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      spike(k.body, 0.012, 0.035, k.glow, [Math.cos(a) * 0.055, 0.055, Math.sin(a) * 0.06], [Math.cos(a) * 0.5, 1, Math.sin(a) * 0.5]);
    }
    const ring = part(k.body, new THREE.TorusGeometry(0.17, 0.007, 3, 6), k.glow, [0, -0.01, 0], [Math.PI / 2, 0, 0]);
    k.anim.push((t) => (ring.rotation.z = t * 0.5));
  }
  if (k.stage >= 3) {
    for (let i = 0; i < 8; i++) {
      const a = ((i + 0.5) / 8) * Math.PI * 2;
      spike(k.body, 0.01, 0.04, k.trim, [Math.cos(a) * 0.115, -0.005, Math.sin(a) * 0.12], [Math.cos(a), 0.15, Math.sin(a)]);
    }
    part(k.body, new THREE.CylinderGeometry(0.02, 0.03, 0.03, 6), k.trim, [0, 0.085, 0]);
    part(k.body, new THREE.OctahedronGeometry(0.018, 0), k.glow, [0, 0.11, 0], [0, 0, 0], [1, 1.6, 1]);
  }
}

function beetle(k: MagKit): void {
  const s = grow(k, 0.08);
  k.body.scale.multiplyScalar(s);
  part(k.body, new THREE.SphereGeometry(0.09, 8, 6), k.shell, [0, 0, 0], [0, 0, 0], [0.9, 0.7, 1.3]);
  ellipsoidBands(k, 0.081, 0.063, 0.117, [-0.012, -0.034], 0, 14);
  eye(k, 0.02, [0, 0.01, 0.115]);
  const open = k.stage >= 2 ? 0.55 : 0.08;
  const elytra = mirrored(k.body, [0.005, 0.0, 0], (p) => {
    part(p, new THREE.SphereGeometry(0.095, 6, 4, Math.PI / 2, Math.PI, 0, Math.PI / 2), k.trim, [0, 0, -0.005], [0, 0, 0], [0.95, 0.8, 1.3]);
  });
  elytra.forEach((p) => (p.rotation.z = open));
  if (k.stage >= 2) {
    const membrane = mat(k.color, { emissive: k.color, emissiveIntensity: 0.5 });
    membrane.transparent = true;
    membrane.opacity = 0.55;
    membrane.side = THREE.DoubleSide;
    membrane.userData.glow = true;
    const wings = mirrored(k.body, [0.03, 0.03, -0.02], (p) => part(p, plateGeo([[0, 0.015], [0.1, 0.0], [0.17, -0.05], [0.16, -0.09], [0.08, -0.08], [0, -0.04]], 0.004), membrane, [0, 0, 0], [0, 0.35, 0], [grow(k, 0.15), 1, 1]));
    flap(k, wings, 0.25, 0.3, 11);
  }
  // Horn sweeping up from the snout, longer each stage; mandibles from stage 2.
  const horn = 0.05 + k.stage * 0.03;
  spike(k.body, 0.014 + k.stage * 0.002, horn, k.trim, [0, 0.02, 0.1], [0, 1, 0.9], 5);
  spike(k.body, 0.008, 0.03, k.glow, [0, 0.02 + horn * 0.67, 0.1 + horn * 0.6], [0, 1, 0.4]);
  if (k.stage >= 2) mirrored(k.body, [0.035, -0.015, 0.1], (p) => spike(p, 0.01, 0.06, k.trim, [0, 0, 0], [-0.5, 0, 1]));
  if (k.stage >= 3) spike(k.body, 0.012, 0.06, k.trim, [0, 0.06, 0.0], [0, 1, 0.8], 5);
}

function swallow(k: MagKit): void {
  const s = grow(k, 0.08);
  k.body.scale.multiplyScalar(s);
  part(k.body, new THREE.SphereGeometry(0.075, 8, 6), k.shell, [0, 0, 0], [0, 0, 0], [0.85, 0.8, 1.5]);
  part(k.body, new THREE.SphereGeometry(0.077, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2.4), k.trim, [0, 0.003, 0], [0, 0, 0], [0.86, 0.82, 1.51]);
  ellipsoidBands(k, 0.064, 0.06, 0.113, [-0.012, -0.03], 0, 12);
  spike(k.body, 0.014, 0.045, k.trim, [0, 0.0, 0.105], [0, -0.1, 1]);
  mirrored(k.body, [0.03, 0.022, 0.08], (p) => part(p, new THREE.SphereGeometry(0.012, 6, 4), k.glow));
  const wing: Outline = [[0, 0.03], [0.07, 0.033], [0.16, 0.0], [0.24, -0.07], [0.15, -0.035], [0.07, -0.03], [0, -0.03]];
  const tip: Outline = [[0.16, 0.0], [0.24, -0.07], [0.19, -0.042]];
  const ws = grow(k, 0.12);
  const wings = mirrored(k.body, [0.05, 0.02, 0], (p) => {
    part(p, plateGeo(wing, 0.01), k.trim, [0, 0, 0], [0, 0, 0], [ws, 1, ws]);
    if (k.stage >= 2) part(p, plateGeo(tip, 0.004), k.glow, [0, 0.007, 0], [0, 0, 0], [ws, 1, ws]);
    if (k.stage >= 3) part(p, plateGeo(wing, 0.008), k.shell, [0, -0.01, -0.01], [0, 0, 0], [ws * 0.75, 1, ws * 0.8]);
  });
  flap(k, wings, 0.1, 0.25, 3.6);
  const tl = [1, 1.2, 1.6][k.stage - 1];
  const tail = mirrored(k.body, [0.008, 0.005, -0.09], (p) => {
    part(p, plateGeo([[0, 0], [0.025, 0], [0.06, -0.16 * tl], [0.045, -0.16 * tl]], 0.008), k.trim);
    if (k.stage >= 3) part(p, plateGeo([[0.05, -0.16 * tl + 0.03], [0.062, -0.16 * tl], [0.045, -0.16 * tl]], 0.004), k.glow, [0, 0.006, 0]);
  });
  k.anim.push((t) => tail.forEach((p) => (p.rotation.y = Math.sin(t * 1.9) * 0.08)));
  if (k.stage >= 2) {
    const n = k.stage >= 3 ? 3 : 2;
    for (let i = 0; i < n; i++) spike(k.body, 0.008, 0.05 + i * 0.01, k.glow, [0, 0.05, 0.05 - i * 0.02], [0, 1, -0.7 - i * 0.2]);
  }
}

function medusa(k: MagKit): void {
  const s = grow(k, 0.08);
  k.body.scale.multiplyScalar(s);
  part(k.body, new THREE.SphereGeometry(0.1, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2), k.shell, [0, 0, 0], [0, 0, 0], [1, 0.85, 1]);
  part(k.body, new THREE.TorusGeometry(0.1, 0.012, 4, 20), k.trim, [0, 0, 0], [Math.PI / 2, 0, 0]);
  part(k.body, new THREE.SphereGeometry(0.06, 8, 4, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), k.glow, [0, 0, 0], [0, 0, 0], [1, 0.8, 1]);
  ellipsoidBands(k, 0.1, 0.085, 0.1, [0.03, 0.058]);
  eye(k, 0.02, [0, 0.045, 0.078]);
  const n = k.stage * 2 + 2;
  const segs = k.stage >= 3 ? 4 : 3;
  const joints: THREE.Group[][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    let parent: THREE.Object3D = k.body;
    const chain: THREE.Group[] = [];
    for (let j = 0; j < segs; j++) {
      const g = new THREE.Group();
      g.position.set(j ? 0 : Math.cos(a) * 0.065, j ? -0.045 : -0.005, j ? 0 : Math.sin(a) * 0.065);
      parent.add(g);
      part(g, new THREE.CylinderGeometry(0.006 - j * 0.001, 0.006 - j * 0.001, 0.045, 4).translate(0, -0.0225, 0), j === segs - 1 ? k.glow : k.trim);
      chain.push(g);
      parent = g;
    }
    joints.push(chain);
  }
  k.anim.push((t) =>
    joints.forEach((chain, i) =>
      chain.forEach((g, j) => {
        g.rotation.x = Math.sin(t * 2 + i * 0.9 + j * 0.7) * 0.25;
        g.rotation.z = Math.cos(t * 1.6 + i * 1.3 + j * 0.7) * 0.2;
      }),
    ),
  );
  if (k.stage >= 2) {
    const halo = part(k.body, new THREE.TorusGeometry(0.06, 0.006, 3, 20), k.glow, [0, 0.14, 0], [Math.PI / 2, 0, 0]);
    k.anim.push((t) => (halo.position.y = 0.14 + Math.sin(t * 1.5) * 0.01));
  }
  if (k.stage >= 3) {
    const gem = crystal(k.color);
    const orbs: THREE.Mesh[] = [];
    for (let i = 0; i < 3; i++) orbs.push(part(k.body, new THREE.IcosahedronGeometry(0.018, 0), gem));
    k.anim.push((t) =>
      orbs.forEach((m, i) => {
        const a = t * 1.2 + (i * Math.PI * 2) / 3;
        m.position.set(Math.cos(a) * 0.13, 0.08 + Math.sin(t * 2 + i) * 0.015, Math.sin(a) * 0.13);
      }),
    );
  }
}

// --------------------------------------------------------------- designs

export const MAG_DESIGNS: Record<string, MagDesign> = {
  silhouettes: {
    name: 'Silhouettes',
    desc: 'Each arm has its own body: POW an arrowhead with blades, DEX a slim dart, DEF a dome behind shields, MIND an orb circled by crystals.',
    build(k) {
      if (k.theme === 'pow') gearPow(k, bladePod(k), 0.06);
      else if (k.theme === 'dex') gearDex(k, dartPod(k), 0.05, -0.12);
      else if (k.theme === 'def') gearDef(k, domePod(k), 0.065);
      else gearMind(k, orbPod(k), 0.08, false);
    },
  },
  kits: {
    name: 'Kits',
    desc: 'The familiar pod at every stage (POW trades it for a point-down pyramid under a floating crown); the arm swaps its gear: blades, long wings and sighting ring, shields and hex ward, or floating petals and crystals.',
    build(k) {
      if (k.theme === 'pow') {
        vanguardMag(k);
        return;
      }
      const w = classicPod(k);
      if (k.theme === 'dex') gearDex(k, w, 0.07, -0.12);
      else if (k.theme === 'def') gearDef(k, w, 0.075);
      else gearMind(k, w, 0.085, true);
    },
  },
  creatures: {
    name: 'Creatures',
    desc: 'Each arm is an animal: DEF a tortoise, POW a horned beetle, DEX a swallow, MIND a jellyfish.',
    build(k) {
      ({ def: tortoise, pow: beetle, dex: swallow, mind: medusa })[k.theme](k);
    },
  },
};
