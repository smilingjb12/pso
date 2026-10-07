import * as THREE from 'three';
import { limbGeo, mat, part, Rig, type JointName, type Pose } from './Rig';

// Cave enemies: the rooted Poison / Nar Lily, and Pan Arms with the two halves
// it splits into (red Hidoom with its claws, blue Migium the caster). Pan Arms
// is literally both halves fused: a blue left side and a red right side.

// ------------------------------------------------------------------ Lily

/** The six petal pivots reuse the arm joints of the shared rig. */
const PETALS: JointName[] = ['shoulderL', 'elbowL', 'handL', 'shoulderR', 'elbowR', 'handR'];

export class LilyModel {
  readonly rig = new Rig();
  /** Glowing throat, visible when the petals open. */
  readonly throat: THREE.MeshStandardMaterial;

  constructor(petal = 0x9a6ad0, stem = 0x4a8a34, throatColor = 0xd060ff) {
    const j = this.rig.joints;
    const stemM = mat(stem);
    const leafM = mat(new THREE.Color(stem).multiplyScalar(0.8).getHex());
    const petalM = mat(petal);
    const petalDark = mat(new THREE.Color(petal).multiplyScalar(0.65).getHex());
    this.throat = mat(throatColor, { emissive: throatColor, emissiveIntensity: 1.1 });
    this.throat.userData.glow = true;
    this.rig.tintable.push(petalM, stemM);

    // Root clump and leaves splayed on the ground.
    j.hips.position.y = 0;
    this.rig.root.add(j.hips);
    part(j.hips, new THREE.SphereGeometry(0.45, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2), leafM, [0, 0, 0], [0, 0, 0], [1, 0.5, 1]);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.3;
      const leaf = part(j.hips, new THREE.SphereGeometry(0.42, 6, 3), leafM, [Math.sin(a) * 0.55, 0.08, Math.cos(a) * 0.55], [0, a, 0], [0.45, 0.12, 1.3]);
      leaf.rotation.order = 'YXZ';
      leaf.rotation.x = -0.25;
    }

    // Two-piece stem so it can coil back before spitting.
    j.spine.position.y = 0.2;
    j.hips.add(j.spine);
    part(j.spine, limbGeo(0.11, 0.14, 0.85).rotateX(Math.PI), stemM, [0, 0, 0]);
    for (const [y, side] of [[0.45, 1], [0.7, -1]] as const) {
      const leaf = part(j.spine, new THREE.SphereGeometry(0.28, 5, 3), leafM, [side * 0.22, y, 0], [0, 0, side * 0.9], [0.35, 1.1, 0.12]);
      leaf.castShadow = true;
    }
    j.chest.position.y = 0.85;
    j.spine.add(j.chest);
    part(j.chest, limbGeo(0.09, 0.11, 0.75).rotateX(Math.PI), stemM, [0, 0, 0]);

    // Bulb: a cup of petals around a glowing throat.
    j.head.position.y = 0.75;
    j.chest.add(j.head);
    part(j.head, new THREE.SphereGeometry(0.26, 7, 5), petalDark, [0, 0.05, 0], [0, 0, 0], [1, 0.7, 1]);
    part(j.head, new THREE.SphereGeometry(0.17, 6, 4), this.throat, [0, 0.18, 0]);
    for (let i = 0; i < 3; i++) part(j.head, new THREE.ConeGeometry(0.03, 0.22, 4), this.throat, [Math.sin(i * 2.1) * 0.08, 0.3, Math.cos(i * 2.1) * 0.08]);
    PETALS.forEach((name, i) => {
      const p = j[name];
      const a = (i / PETALS.length) * Math.PI * 2;
      p.rotation.order = 'YXZ';
      p.position.set(Math.sin(a) * 0.16, 0.1, Math.cos(a) * 0.16);
      p.rotation.set(0.35, a, 0);
      j.head.add(p);
      // Petal grows along +Y from its base; rotating +X leans it outward.
      part(p, new THREE.SphereGeometry(0.22, 6, 4), i % 2 ? petalM : petalDark, [0, 0.36, 0], [0, 0, 0], [0.75, 1.65, 0.28]);
      part(p, new THREE.ConeGeometry(0.07, 0.22, 4), petalM, [0, 0.72, 0.02], [0.2, 0, 0]);
    });

    this.rig.finalize();
  }
}

const petals = (x: number): Partial<Record<JointName, [number, number, number]>> =>
  Object.fromEntries(PETALS.map((p) => [p, [x, 0, 0]]));

export const lilyPoses = {
  idle(t: number): Pose {
    return {
      joints: {
        spine: [Math.sin(t * 0.9) * 0.08, 0, Math.sin(t * 1.3) * 0.1],
        chest: [Math.sin(t * 1.1 + 1) * 0.1, 0, -Math.sin(t * 1.3) * 0.08],
        head: [0.15 + Math.sin(t * 1.7) * 0.06, 0, 0],
        ...petals(Math.sin(t * 1.2) * 0.12),
      },
    };
  },
  /** Coiling back with the petals shut (k 0..1). */
  aim(k: number): Pose {
    return { joints: { spine: [-0.35 * k, 0, 0], chest: [-0.45 * k, 0, 0], head: [-0.2 * k, 0, 0], ...petals(-0.55 * k) } };
  },
  /** Lunging forward, petals flung open. */
  spit(): Pose {
    return { joints: { spine: [0.35, 0, 0], chest: [0.4, 0, 0], head: [0.55, 0, 0], ...petals(0.9) } };
  },
  /** Petal burst wind-up: hunker down and clamp shut (k 0..1). */
  burstWindup(k: number): Pose {
    return { joints: { spine: [0.15 * k, 0, 0], chest: [0.5 * k, 0, 0], head: [0.4 * k, 0, 0], ...petals(-0.7 * k) }, lift: -0.15 * k };
  },
  burst(): Pose {
    return { joints: { spine: [-0.1, 0, 0], chest: [-0.15, 0, 0], head: [-0.4, 0, 0], ...petals(1.25) } };
  },
  hurt(): Pose {
    return { joints: { spine: [-0.4, 0, 0.2], chest: [-0.3, 0, -0.2], head: [-0.3, 0, 0], ...petals(-0.3) } };
  },
  dead(): Pose {
    return { joints: { spine: [1.0, 0, 0.3], chest: [0.9, 0, 0], head: [0.6, 0, 0], ...petals(1.0) }, lift: -0.1 };
  },
};

// --------------------------------------------------------- Pan Arms family

type Side = 1 | -1;

interface ArmParts {
  shoulder: THREE.Group;
  elbow: THREE.Group;
  hand: THREE.Group;
}

const HIDOOM = { body: 0xb03a3a, dark: 0x6a1c1c, plate: 0xe0b080 };
const MIGIUM = { body: 0x3a5ab0, dark: 0x1c2a6a, plate: 0xb0d0f0 };

/** Long red arm ending in three big blades. */
function clawArm(a: ArmParts, side: Side, body: THREE.Material, dark: THREE.Material, blade: THREE.Material, size = 1): void {
  part(a.shoulder, new THREE.SphereGeometry(0.24 * size, 6, 5), dark);
  part(a.shoulder, limbGeo(0.17 * size, 0.14 * size, 0.55 * size), body);
  // Armoured pauldron.
  part(a.shoulder, new THREE.ConeGeometry(0.2 * size, 0.35 * size, 4), dark, [side * 0.12 * size, 0.12 * size, 0], [0, 0, -side * 0.9]);
  a.elbow.position.y = -0.53 * size;
  a.shoulder.add(a.elbow);
  part(a.elbow, limbGeo(0.14 * size, 0.2 * size, 0.5 * size), dark);
  a.hand.position.y = -0.5 * size;
  a.elbow.add(a.hand);
  part(a.hand, new THREE.BoxGeometry(0.28 * size, 0.16 * size, 0.26 * size), dark, [0, -0.06 * size, 0.03]);
  for (const cx of [-0.1, 0, 0.1]) {
    part(a.hand, new THREE.ConeGeometry(0.045 * size, 0.5 * size, 4), blade, [cx * size, -0.32 * size, 0.16 * size], [2.5, 0, cx * 1.5]);
  }
}

/** Slimmer blue arm with a glowing palm. */
function casterArm(a: ArmParts, body: THREE.Material, dark: THREE.Material, orb: THREE.Material, size = 1): void {
  part(a.shoulder, new THREE.SphereGeometry(0.21 * size, 6, 5), dark);
  part(a.shoulder, limbGeo(0.14 * size, 0.12 * size, 0.5 * size), body);
  a.elbow.position.y = -0.48 * size;
  a.shoulder.add(a.elbow);
  part(a.elbow, limbGeo(0.12 * size, 0.13 * size, 0.45 * size), dark);
  for (let i = 0; i < 3; i++) part(a.elbow, new THREE.TorusGeometry(0.135 * size, 0.025, 4, 8).rotateX(Math.PI / 2), orb, [0, -0.12 - i * 0.12, 0]);
  a.hand.position.y = -0.45 * size;
  a.elbow.add(a.hand);
  part(a.hand, new THREE.SphereGeometry(0.15 * size, 6, 4), body, [0, -0.08, 0]);
  part(a.hand, new THREE.OctahedronGeometry(0.11 * size), orb, [0, -0.16 * size, 0.08]);
}

function hidoomHead(head: THREE.Group, body: THREE.Material, dark: THREE.Material, horn: THREE.Material, eye: THREE.Material): void {
  part(head, new THREE.IcosahedronGeometry(0.24, 0), body, [0, 0.05, 0.05], [0, 0, 0], [1.05, 0.85, 1.15]);
  part(head, new THREE.BoxGeometry(0.26, 0.1, 0.22), dark, [0, -0.08, 0.2]); // jaw
  for (const sx of [-0.1, 0.1]) {
    part(head, new THREE.OctahedronGeometry(0.045), eye, [sx, 0.07, 0.24]);
    part(head, new THREE.ConeGeometry(0.06, 0.4, 4), horn, [sx * 1.4, 0.25, -0.05], [-0.7, 0, -sx * 4]);
  }
  for (let i = 0; i < 3; i++) part(head, new THREE.ConeGeometry(0.05, 0.22, 4), horn, [0, 0.22, 0.05 - i * 0.12], [-0.5, 0, 0]);
}

function migiumHead(head: THREE.Group, body: THREE.Material, dark: THREE.Material, orb: THREE.Material, eye: THREE.Material): void {
  part(head, new THREE.SphereGeometry(0.25, 7, 5), body, [0, 0.08, 0.02], [0, 0, 0], [1, 1.1, 1]);
  part(head, new THREE.BoxGeometry(0.36, 0.08, 0.1), dark, [0, 0.06, 0.22]); // visor band
  for (const sx of [-0.08, 0.08]) part(head, new THREE.OctahedronGeometry(0.04), eye, [sx, 0.06, 0.28]);
  // Fins and a crown crystal: the caster's focus.
  for (const sx of [-1, 1]) part(head, new THREE.ConeGeometry(0.08, 0.35, 3), dark, [sx * 0.24, 0.18, -0.05], [0, 0, -sx * 0.6]);
  part(head, new THREE.OctahedronGeometry(0.11), orb, [0, 0.42, 0], [0, 0, 0], [0.8, 1.6, 0.8]);
}

/** Thick digitigrade legs shared by the family. */
function legs(rig: Rig, hipY: number, width: number, body: THREE.Material, dark: THREE.Material, claw: THREE.Material): void {
  const j = rig.joints;
  for (const [hip, knee, side] of [
    [j.hipL, j.kneeL, 1],
    [j.hipR, j.kneeR, -1],
  ] as const) {
    hip.position.set(side * width, -0.05, 0);
    j.hips.add(hip);
    part(hip, limbGeo(0.19, 0.15, hipY * 0.5), body);
    knee.position.y = -hipY * 0.48;
    hip.add(knee);
    part(knee, limbGeo(0.15, 0.12, hipY * 0.48), dark);
    part(knee, new THREE.BoxGeometry(0.26, 0.1, 0.34), dark, [0, -hipY * 0.48, 0.07]);
    for (const cx of [-0.07, 0, 0.07]) part(knee, new THREE.ConeGeometry(0.035, 0.12, 4), claw, [cx, -hipY * 0.49, 0.27], [Math.PI / 2, 0, 0]);
  }
}

/** Hidoom: the red half. A hunched brawler with oversized claw arms. */
export class HidoomModel {
  readonly rig = new Rig();
  constructor(scheme = HIDOOM) {
    const j = this.rig.joints;
    const body = mat(scheme.body);
    const dark = mat(scheme.dark);
    const plate = mat(scheme.plate, { rough: 0.45 });
    const eye = mat(0xffe040, { emissive: 0xffc020, emissiveIntensity: 1.3 });
    eye.userData.glow = true;
    this.rig.tintable.push(body, dark);

    j.hips.position.y = 0.8;
    this.rig.root.add(j.hips);
    part(j.hips, new THREE.SphereGeometry(0.34, 7, 5), dark, [0, 0, -0.05], [0, 0, 0], [1.1, 0.8, 0.9]);
    legs(this.rig, 0.8, 0.24, body, dark, plate);

    j.spine.position.y = 0.1;
    j.spine.rotation.x = 0.45;
    j.hips.add(j.spine);
    part(j.spine, new THREE.SphereGeometry(0.46, 7, 6), body, [0, 0.36, 0], [0, 0, 0], [1.05, 1, 0.85]);
    j.chest.position.y = 0.6;
    j.spine.add(j.chest);
    part(j.chest, new THREE.SphereGeometry(0.42, 7, 5), dark, [0, 0.02, -0.06], [0, 0, 0], [1.35, 0.8, 0.95]);
    // Bone plates and a spine of blades.
    part(j.chest, new THREE.BoxGeometry(0.5, 0.08, 0.35), plate, [0, 0.12, 0.28], [0.5, 0, 0]);
    for (let i = 0; i < 4; i++) part(j.chest, new THREE.ConeGeometry(0.08, 0.32, 4), plate, [0, 0.3 - i * 0.16, -0.36 + i * 0.03], [-1, 0, 0]);

    j.head.position.set(0, 0.12, 0.38);
    j.head.rotation.x = -0.45;
    j.chest.add(j.head);
    hidoomHead(j.head, body, dark, plate, eye);

    for (const [sh, el, hand, side] of [
      [j.shoulderL, j.elbowL, j.handL, 1],
      [j.shoulderR, j.elbowR, j.handR, -1],
    ] as const) {
      sh.position.set(side * 0.58, 0.12, 0.06);
      sh.rotation.x = -0.4;
      j.chest.add(sh);
      clawArm({ shoulder: sh, elbow: el, hand }, side, body, dark, plate, 1.05);
    }
    this.rig.finalize();
  }
}

/** Migium: the blue half. Upright caster with glowing palms and crown. */
export class MigiumModel {
  readonly rig = new Rig();
  /** Glowing focus parts (brightened while casting). */
  readonly orb: THREE.MeshStandardMaterial;
  constructor(scheme = MIGIUM) {
    const j = this.rig.joints;
    const body = mat(scheme.body);
    const dark = mat(scheme.dark);
    const plate = mat(scheme.plate, { rough: 0.45 });
    this.orb = mat(0x80e0ff, { emissive: 0x40c8ff, emissiveIntensity: 1 });
    this.orb.userData.glow = true;
    const eye = mat(0xa0ffff, { emissive: 0x60ffff, emissiveIntensity: 1.3 });
    eye.userData.glow = true;
    this.rig.tintable.push(body, dark);

    j.hips.position.y = 0.85;
    this.rig.root.add(j.hips);
    part(j.hips, new THREE.SphereGeometry(0.32, 7, 5), dark, [0, 0, 0], [0, 0, 0], [1.1, 0.8, 0.9]);
    // A robe-like skirt of plates over the legs.
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      part(j.hips, new THREE.BoxGeometry(0.22, 0.45, 0.06), plate, [Math.sin(a) * 0.3, -0.22, Math.cos(a) * 0.3], [0.25, a, 0]).rotation.order = 'YXZ';
    }
    legs(this.rig, 0.85, 0.2, body, dark, plate);

    j.spine.position.y = 0.1;
    j.spine.rotation.x = 0.1;
    j.hips.add(j.spine);
    part(j.spine, new THREE.SphereGeometry(0.4, 7, 6), body, [0, 0.32, 0], [0, 0, 0], [1, 1.05, 0.85]);
    part(j.spine, new THREE.SphereGeometry(0.13, 6, 5), this.orb, [0, 0.38, 0.32]); // chest focus
    j.chest.position.y = 0.58;
    j.spine.add(j.chest);
    part(j.chest, new THREE.SphereGeometry(0.36, 7, 5), dark, [0, 0, -0.04], [0, 0, 0], [1.3, 0.7, 0.9]);
    for (const sx of [-1, 1]) part(j.chest, new THREE.ConeGeometry(0.16, 0.3, 4), plate, [sx * 0.42, 0.14, 0], [0, 0, -sx * 1.1]);

    j.head.position.set(0, 0.24, 0.12);
    j.head.rotation.x = -0.1;
    j.chest.add(j.head);
    migiumHead(j.head, body, dark, this.orb, eye);

    for (const [sh, el, hand, side] of [
      [j.shoulderL, j.elbowL, j.handL, 1],
      [j.shoulderR, j.elbowR, j.handR, -1],
    ] as const) {
      sh.position.set(side * 0.5, 0.08, 0.04);
      sh.rotation.z = side * 0.15;
      j.chest.add(sh);
      casterArm({ shoulder: sh, elbow: el, hand }, body, dark, this.orb, 1);
    }
    this.rig.finalize();
  }
}

/** Pan Arms: both halves fused down the middle. Blue Migium on its left, red Hidoom on its right. */
export class PanArmsModel {
  readonly rig = new Rig();
  readonly seam: THREE.MeshStandardMaterial;
  constructor() {
    const j = this.rig.joints;
    const hb = mat(HIDOOM.body);
    const hd = mat(HIDOOM.dark);
    const hp = mat(HIDOOM.plate, { rough: 0.45 });
    const mb = mat(MIGIUM.body);
    const md = mat(MIGIUM.dark);
    const mp = mat(MIGIUM.plate, { rough: 0.45 });
    const orb = mat(0x80e0ff, { emissive: 0x40c8ff, emissiveIntensity: 1 });
    orb.userData.glow = true;
    this.seam = mat(0xffe8a0, { emissive: 0xffc860, emissiveIntensity: 0.8 });
    this.seam.userData.glow = true;
    const yEye = mat(0xffe040, { emissive: 0xffc020, emissiveIntensity: 1.3 });
    yEye.userData.glow = true;
    const cEye = mat(0xa0ffff, { emissive: 0x60ffff, emissiveIntensity: 1.3 });
    cEye.userData.glow = true;
    this.rig.tintable.push(hb, mb);

    j.hips.position.y = 0.95;
    this.rig.root.add(j.hips);
    part(j.hips, new THREE.SphereGeometry(0.42, 8, 5), hd, [0, 0, -0.05], [0, 0, 0], [1.5, 0.8, 1]);
    legs(this.rig, 0.95, 0.42, hb, hd, hp);
    // Recolour the left leg blue.
    j.hipL.traverse((o) => {
      if (o instanceof THREE.Mesh) o.material = o.material === hb ? mb : o.material === hd ? md : mp;
    });

    j.spine.position.y = 0.1;
    j.spine.rotation.x = 0.25;
    j.hips.add(j.spine);
    // Torso: two half-spheres meeting at a glowing seam.
    part(j.spine, new THREE.SphereGeometry(0.62, 8, 6, 0, Math.PI), mb, [0.02, 0.48, 0], [0, 0, 0], [1.1, 1, 0.85]);
    part(j.spine, new THREE.SphereGeometry(0.62, 8, 6, Math.PI, Math.PI), hb, [-0.02, 0.48, 0], [0, 0, 0], [1.1, 1, 0.85]);
    part(j.spine, new THREE.BoxGeometry(0.06, 1.1, 1.05), this.seam, [0, 0.48, 0]);
    part(j.spine, new THREE.SphereGeometry(0.13, 6, 5), orb, [0.3, 0.55, 0.48]);
    j.chest.position.y = 0.85;
    j.spine.add(j.chest);
    part(j.chest, new THREE.SphereGeometry(0.42, 7, 5, 0, Math.PI), md, [0.02, 0, -0.06], [0, 0, 0], [1.55, 0.75, 1]);
    part(j.chest, new THREE.SphereGeometry(0.42, 7, 5, Math.PI, Math.PI), hd, [-0.02, 0, -0.06], [0, 0, 0], [1.55, 0.75, 1]);
    for (let i = 0; i < 4; i++) part(j.chest, new THREE.ConeGeometry(0.08, 0.32, 4), hp, [-0.25, 0.25 - i * 0.14, -0.36], [-1, 0, 0]);

    // Two heads side by side.
    j.head.position.set(0, 0.2, 0.3);
    j.head.rotation.x = -0.25;
    j.chest.add(j.head);
    const left = new THREE.Group();
    left.position.x = 0.28;
    const right = new THREE.Group();
    right.position.x = -0.28;
    j.head.add(left, right);
    migiumHead(left, mb, md, orb, cEye);
    hidoomHead(right, hb, hd, hp, yEye);

    // Left arm: Migium's caster arm. Right arm: Hidoom's claw, bigger.
    j.shoulderL.position.set(0.82, 0.08, 0.04);
    j.shoulderL.rotation.x = -0.3;
    j.chest.add(j.shoulderL);
    casterArm({ shoulder: j.shoulderL, elbow: j.elbowL, hand: j.handL }, mb, md, orb, 1.25);
    j.shoulderR.position.set(-0.82, 0.08, 0.04);
    j.shoulderR.rotation.x = -0.3;
    j.chest.add(j.shoulderR);
    clawArm({ shoulder: j.shoulderR, elbow: j.elbowR, hand: j.handR }, -1, hb, hd, hp, 1.3);

    this.rig.finalize();
  }
}

export const migiumPoses = {
  idle(t: number): Pose {
    const b = Math.sin(t * 2);
    return {
      joints: {
        chest: [0.03 * b, Math.sin(t * 0.6) * 0.1, 0],
        shoulderL: [-0.2, 0, 0.25 + b * 0.05],
        shoulderR: [-0.2, 0, -0.25 - b * 0.05],
        elbowL: [-0.5, 0, 0],
        elbowR: [-0.5, 0, 0],
      },
      lift: b * 0.03,
    };
  },
  walk(phase: number): Pose {
    const s = Math.sin(phase);
    return {
      joints: {
        hipL: [-s * 0.4, 0, 0],
        hipR: [s * 0.4, 0, 0],
        kneeL: [0.1 + 0.4 * Math.max(0, Math.cos(phase)), 0, 0],
        kneeR: [0.1 + 0.4 * Math.max(0, -Math.cos(phase)), 0, 0],
        shoulderL: [s * 0.3 - 0.2, 0, 0.3],
        shoulderR: [-s * 0.3 - 0.2, 0, -0.3],
        elbowL: [-0.5, 0, 0],
        elbowR: [-0.5, 0, 0],
      },
      lift: Math.abs(Math.cos(phase)) * 0.04,
    };
  },
  /** Arms raised overhead, gathering the bolt (k 0..1). */
  cast(k: number): Pose {
    const e = k * k * (3 - 2 * k);
    return {
      joints: {
        spine: [-0.25 * e, 0, 0],
        head: [-0.3 * e, 0, 0],
        shoulderL: [-2.7 * e, 0, 0.5 * e],
        shoulderR: [-2.7 * e, 0, -0.5 * e],
        elbowL: [-0.3 * e, 0, 0],
        elbowR: [-0.3 * e, 0, 0],
      },
      lift: 0.05 * e,
    };
  },
  release(): Pose {
    return { joints: { spine: [0.35, 0, 0], head: [0.2, 0, 0], shoulderL: [-1.4, 0, 0.2], shoulderR: [-1.4, 0, -0.2] } };
  },
  hurt(): Pose {
    return { joints: { spine: [-0.45, 0, 0], head: [-0.4, 0, 0], shoulderL: [0.3, 0, 0.8], shoulderR: [0.3, 0, -0.8] } };
  },
  crouch(): Pose {
    return { joints: { spine: [0.5, 0, 0], kneeL: [0.8, 0, 0], kneeR: [0.8, 0, 0], hipL: [-0.8, 0, 0], hipR: [-0.8, 0, 0] }, lift: -0.25 };
  },
};
