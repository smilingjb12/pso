import * as THREE from 'three';
import { limbGeo, mat, part, Rig, type Pose } from './Rig';

// Mines machines: the Gillchic gunbot, the Garanz artillery tank, the Sinow
// Beat ninja robot, the control node pylon, and the Warden colossus with its
// Spark Mite and Repair Drone adds. Hard-edged boxes and cylinders with glowing sensor eyes.

/** A material that keeps its own glow (emissive flashes and tints skip it). */
function glow(color: number, intensity = 1.4): THREE.MeshStandardMaterial {
  const m = mat(color, { emissive: color, emissiveIntensity: intensity });
  m.userData.glow = true;
  return m;
}

const STRIPE = 0xe0b020;

// --------------------------------------------------------------- Gillchic

export class GunbotModel {
  readonly rig = new Rig();
  readonly eye: THREE.MeshStandardMaterial;
  readonly muzzle: THREE.MeshStandardMaterial;

  constructor(color = 0x8a96a8) {
    const j = this.rig.joints;
    const body = mat(color, { rough: 0.55 });
    const dark = mat(new THREE.Color(color).multiplyScalar(0.45).getHex(), { rough: 0.6 });
    const stripe = mat(STRIPE);
    this.eye = glow(0xff3020, 1.6);
    this.muzzle = glow(0xffa040, 0.6);
    this.rig.tintable.push(body);

    j.hips.position.y = 0.98;
    this.rig.root.add(j.hips);
    part(j.hips, new THREE.BoxGeometry(0.55, 0.22, 0.4), dark);

    // Reverse-jointed legs: thigh forward, shin back, a wide flat foot.
    for (const [hip, knee, s] of [[j.hipL, j.kneeL, -1], [j.hipR, j.kneeR, 1]] as const) {
      hip.position.set(s * 0.3, -0.05, 0);
      hip.rotation.x = -0.5;
      j.hips.add(hip);
      part(hip, new THREE.SphereGeometry(0.13, 6, 5), dark);
      part(hip, limbGeo(0.12, 0.09, 0.5), body);
      knee.position.y = -0.5;
      knee.rotation.x = 1.0;
      hip.add(knee);
      part(knee, new THREE.SphereGeometry(0.09, 6, 4), dark);
      part(knee, limbGeo(0.08, 0.07, 0.52), dark);
      part(knee, new THREE.BoxGeometry(0.22, 0.07, 0.4), dark, [0, -0.54, 0.08], [-0.5, 0, 0]);
    }

    // Boxy torso with a stripe, a sensor dome and an antenna.
    j.spine.position.y = 0.12;
    j.hips.add(j.spine);
    part(j.spine, new THREE.BoxGeometry(0.62, 0.42, 0.48), body, [0, 0.22, 0]);
    j.chest.position.y = 0.42;
    j.spine.add(j.chest);
    part(j.chest, new THREE.BoxGeometry(0.78, 0.36, 0.56), body, [0, 0.16, 0]);
    part(j.chest, new THREE.BoxGeometry(0.8, 0.07, 0.58), stripe, [0, 0.05, 0]);
    part(j.chest, new THREE.BoxGeometry(0.3, 0.3, 0.22), dark, [0, 0.2, -0.36]); // backpack
    part(j.chest, limbGeo(0.015, 0.015, 0.5).rotateX(Math.PI), dark, [-0.12, 0.35, -0.38]);
    j.head.position.set(0, 0.36, 0.04);
    j.chest.add(j.head);
    part(j.head, new THREE.SphereGeometry(0.24, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), body);
    part(j.head, new THREE.BoxGeometry(0.3, 0.08, 0.08), this.eye, [0, 0.09, 0.2]);

    // Right arm is the gun; the left a short pincer for close swipes.
    j.shoulderR.position.set(0.48, 0.18, 0);
    j.chest.add(j.shoulderR);
    part(j.shoulderR, new THREE.BoxGeometry(0.24, 0.24, 0.3), dark);
    part(j.shoulderR, limbGeo(0.08, 0.08, 0.35), body);
    j.elbowR.position.y = -0.35;
    j.shoulderR.add(j.elbowR);
    part(j.elbowR, limbGeo(0.11, 0.09, 0.6, 8), dark);
    part(j.elbowR, new THREE.CylinderGeometry(0.06, 0.06, 0.08, 8), this.muzzle, [0, -0.62, 0]);
    j.handR.position.y = -0.62;
    j.elbowR.add(j.handR);

    j.shoulderL.position.set(-0.46, 0.15, 0);
    j.chest.add(j.shoulderL);
    part(j.shoulderL, new THREE.BoxGeometry(0.2, 0.2, 0.26), dark);
    part(j.shoulderL, limbGeo(0.07, 0.06, 0.32), body);
    j.elbowL.position.y = -0.32;
    j.shoulderL.add(j.elbowL);
    part(j.elbowL, limbGeo(0.06, 0.05, 0.25), dark);
    for (const s of [-1, 1]) part(j.elbowL, new THREE.ConeGeometry(0.04, 0.22, 4), stripe, [s * 0.05, -0.32, 0.04], [Math.PI, 0, s * 0.3]);

    this.rig.finalize();
  }
}

export const gunbotPoses = {
  idle(t: number): Pose {
    return { joints: { spine: [Math.sin(t * 1.4) * 0.03, 0, 0], head: [0, Math.sin(t * 0.7) * 0.5, 0], shoulderR: [-0.3, 0, 0.1] } };
  },
  walk(phase: number, k = 1): Pose {
    const s = Math.sin(phase) * k;
    const c = Math.cos(phase) * k;
    return {
      joints: {
        hipL: [s * 0.45, 0, 0], kneeL: [Math.max(0, -c) * 0.35, 0, 0],
        hipR: [-s * 0.45, 0, 0], kneeR: [Math.max(0, c) * 0.35, 0, 0],
        spine: [0.08, s * 0.08, 0], shoulderR: [-0.4, 0, 0.1], shoulderL: [-s * 0.2, 0, 0],
      },
      lift: Math.abs(c) * 0.05 - 0.03,
    };
  },
  /** Raising the gun arm onto the target (k 0..1). */
  aim(k: number): Pose {
    return { joints: { shoulderR: [-1.55 * k, 0, 0.05], spine: [0.08 * k, 0, 0], head: [0.1 * k, 0, 0], hipL: [-0.15 * k, 0, 0], hipR: [0.15 * k, 0, 0] }, lift: -0.06 * k };
  },
  fire(): Pose {
    return { joints: { shoulderR: [-1.35, 0, 0.05], spine: [-0.15, 0, 0], head: [-0.1, 0, 0] }, lift: -0.06 };
  },
  windup(k: number): Pose {
    return { joints: { shoulderL: [-1.3 * k, 0, -0.5 * k], spine: [0, 0.5 * k, 0], shoulderR: [-0.2, 0, 0.2] } };
  },
  strike(): Pose {
    return { joints: { shoulderL: [-1.5, 0, 0.6], elbowL: [-0.3, 0, 0], spine: [0.1, -0.55, 0] } };
  },
  hurt(): Pose {
    return { joints: { spine: [-0.35, 0, 0.15], head: [-0.3, 0, 0], shoulderR: [0.2, 0, 0.3], shoulderL: [0.2, 0, -0.3] } };
  },
  /** Knocked offline: slumped over, arms hanging. */
  offline(): Pose {
    return {
      joints: {
        spine: [0.85, 0, 0.15], chest: [0.3, 0, 0], head: [0.55, 0, 0.2],
        shoulderR: [0.4, 0, 0.35], shoulderL: [0.4, 0, -0.35],
        hipL: [-0.55, 0, 0], kneeL: [0.7, 0, 0], hipR: [-0.55, 0, 0], kneeR: [0.7, 0, 0],
      },
      lift: -0.32,
    };
  },
  crouch(): Pose {
    return { joints: { spine: [0.5, 0, 0], hipL: [-0.6, 0, 0], kneeL: [0.8, 0, 0], hipR: [-0.6, 0, 0], kneeR: [0.8, 0, 0] }, lift: -0.3 };
  },
};

// ----------------------------------------------------------------- Garanz

export class GaranzModel {
  readonly rig = new Rig();
  readonly eye: THREE.MeshStandardMaterial;
  readonly pods: THREE.MeshStandardMaterial;

  constructor(color = 0x6a7a5a) {
    const j = this.rig.joints;
    const body = mat(color, { rough: 0.6 });
    const dark = mat(new THREE.Color(color).multiplyScalar(0.5).getHex(), { rough: 0.65 });
    const metal = mat(0x4a4e56, { rough: 0.5 });
    const stripe = mat(STRIPE);
    this.eye = glow(0xffc030, 1.5);
    this.pods = glow(0xff6a20, 0.4);
    this.rig.tintable.push(body);

    // Squat hull on four stubby legs.
    j.hips.position.y = 0.95;
    this.rig.root.add(j.hips);
    part(j.hips, new THREE.BoxGeometry(1.6, 0.66, 2.0), body, [0, 0.05, 0]);
    part(j.hips, new THREE.BoxGeometry(1.64, 0.1, 2.04), stripe, [0, -0.2, 0]);
    part(j.hips, new THREE.BoxGeometry(1.2, 0.3, 1.6), dark, [0, -0.38, 0]);
    const legs = [
      [j.shoulderL, j.elbowL, -1, 0.65],
      [j.shoulderR, j.elbowR, 1, 0.65],
      [j.hipL, j.kneeL, -1, -0.65],
      [j.hipR, j.kneeR, 1, -0.65],
    ] as const;
    for (const [upper, lower, s, z] of legs) {
      upper.position.set(s * 0.82, -0.25, z);
      upper.rotation.z = -s * 0.5;
      j.hips.add(upper);
      part(upper, new THREE.SphereGeometry(0.2, 6, 5), metal);
      part(upper, limbGeo(0.15, 0.12, 0.5), dark);
      lower.position.y = -0.5;
      lower.rotation.z = s * 0.5;
      upper.add(lower);
      part(lower, limbGeo(0.12, 0.16, 0.42), metal);
      part(lower, new THREE.CylinderGeometry(0.26, 0.3, 0.1, 8), dark, [0, -0.44, 0]);
    }

    // Missile pod on the back; it tilts up to fire.
    j.chest.position.set(0, 0.42, -0.25);
    j.hips.add(j.chest);
    part(j.chest, new THREE.BoxGeometry(0.4, 0.3, 0.4), metal, [0, 0.12, 0]);
    part(j.chest, new THREE.BoxGeometry(1.3, 0.62, 1.0), body, [0, 0.5, 0]);
    for (let i = 0; i < 6; i++) {
      const x = (i % 3 - 1) * 0.38;
      const y = 0.38 + Math.floor(i / 3) * 0.26;
      part(j.chest, new THREE.CylinderGeometry(0.1, 0.1, 0.12, 8).rotateX(Math.PI / 2), this.pods, [x, y, 0.5]);
    }
    part(j.chest, new THREE.BoxGeometry(1.32, 0.06, 1.02), stripe, [0, 0.82, 0]);

    // Sensor head at the front.
    j.head.position.set(0, 0.15, 1.0);
    j.hips.add(j.head);
    part(j.head, new THREE.BoxGeometry(0.7, 0.32, 0.36), dark, [0, 0, 0.12]);
    for (const s of [-1, 1]) part(j.head, new THREE.BoxGeometry(0.14, 0.08, 0.06), this.eye, [s * 0.18, 0.02, 0.31]);
    part(j.head, limbGeo(0.02, 0.02, 0.5).rotateX(Math.PI), metal, [0.25, 0.15, 0]);

    this.rig.finalize();
  }
}

export const garanzPoses = {
  idle(t: number): Pose {
    return { joints: { head: [0, Math.sin(t * 0.6) * 0.3, 0], chest: [Math.sin(t * 1.1) * 0.03, 0, 0] } };
  },
  walk(phase: number): Pose {
    const a = Math.sin(phase) * 0.35;
    return {
      joints: { shoulderL: [a, 0, 0], hipR: [a, 0, 0], shoulderR: [-a, 0, 0], hipL: [-a, 0, 0], head: [0, Math.sin(phase * 0.5) * 0.1, 0] },
      lift: Math.abs(Math.cos(phase)) * 0.06,
    };
  },
  /** Planting: legs splay, the hull drops and the pod tilts up (k 0..1). */
  plant(k: number): Pose {
    return {
      joints: {
        shoulderL: [0, 0, -0.35 * k], shoulderR: [0, 0, 0.35 * k], hipL: [0, 0, -0.35 * k], hipR: [0, 0, 0.35 * k],
        elbowL: [0, 0, 0.3 * k], elbowR: [0, 0, -0.3 * k], kneeL: [0, 0, 0.3 * k], kneeR: [0, 0, -0.3 * k],
        chest: [-0.75 * k, 0, 0], head: [-0.15 * k, 0, 0],
      },
      lift: -0.22 * k,
    };
  },
  /** One missile out: the pod kicks. */
  fire(): Pose {
    const p = garanzPoses.plant(1);
    p.joints.chest = [-0.6, 0, 0];
    return p;
  },
  /** Rearing up before a stomp (k 0..1). */
  stompWindup(k: number): Pose {
    return { joints: { shoulderL: [-0.7 * k, 0, 0], shoulderR: [-0.7 * k, 0, 0], hipL: [0.2 * k, 0, 0], hipR: [0.2 * k, 0, 0], head: [-0.3 * k, 0, 0] }, lift: 0.18 * k };
  },
  stomp(): Pose {
    return { joints: { shoulderL: [0.25, 0, -0.2], shoulderR: [0.25, 0, 0.2], head: [0.2, 0, 0] }, lift: -0.18 };
  },
  hurt(): Pose {
    return { joints: { chest: [0.25, 0, 0.1], head: [0.3, 0, 0] }, lift: -0.08 };
  },
  dead(): Pose {
    const p = garanzPoses.plant(1.3);
    p.joints.chest = [0.5, 0, 0.3];
    p.joints.head = [0.5, 0, 0];
    return p;
  },
};

// ------------------------------------------------------------------ Sinow

export class SinowModel {
  readonly rig = new Rig();
  readonly visor: THREE.MeshStandardMaterial;
  readonly blades: THREE.MeshStandardMaterial;

  constructor(color = 0x5a6aa0) {
    const j = this.rig.joints;
    const body = mat(color, { rough: 0.45 });
    const silver = mat(0xc4ccd8, { rough: 0.35 });
    const dark = mat(0x23283a, { rough: 0.6 });
    this.visor = glow(0xff3050, 1.6);
    this.blades = glow(0xff7040, 1.2);
    this.rig.tintable.push(body);

    j.hips.position.y = 1.0;
    this.rig.root.add(j.hips);
    part(j.hips, new THREE.BoxGeometry(0.36, 0.2, 0.24), dark);

    for (const [hip, knee, s] of [[j.hipL, j.kneeL, -1], [j.hipR, j.kneeR, 1]] as const) {
      hip.position.set(s * 0.13, -0.06, 0);
      j.hips.add(hip);
      part(hip, limbGeo(0.08, 0.06, 0.48), body);
      knee.position.y = -0.48;
      hip.add(knee);
      part(knee, new THREE.SphereGeometry(0.07, 6, 4), silver);
      part(knee, limbGeo(0.06, 0.045, 0.46), silver);
      part(knee, new THREE.BoxGeometry(0.1, 0.06, 0.24), dark, [0, -0.48, 0.05]);
    }

    j.spine.position.y = 0.1;
    j.hips.add(j.spine);
    part(j.spine, new THREE.CylinderGeometry(0.15, 0.12, 0.3, 6), dark, [0, 0.15, 0]);
    j.chest.position.y = 0.3;
    j.spine.add(j.chest);
    part(j.chest, new THREE.CylinderGeometry(0.24, 0.16, 0.36, 6), body, [0, 0.16, 0]);
    part(j.chest, new THREE.BoxGeometry(0.2, 0.18, 0.08), silver, [0, 0.2, 0.15]);
    // Scarf-like plates trailing from the neck.
    j.tail.position.set(0, 0.32, -0.12);
    j.chest.add(j.tail);
    part(j.tail, new THREE.BoxGeometry(0.16, 0.5, 0.03), this.visor, [0, -0.25, -0.02]);
    j.head.position.y = 0.42;
    j.chest.add(j.head);
    part(j.head, new THREE.SphereGeometry(0.15, 8, 6), silver, [0, 0.08, 0], [0, 0, 0], [1, 1.15, 1.05]);
    part(j.head, new THREE.BoxGeometry(0.2, 0.045, 0.06), this.visor, [0, 0.09, 0.13]);
    part(j.head, new THREE.ConeGeometry(0.04, 0.28, 4), body, [0, 0.24, -0.08], [-0.6, 0, 0]);

    for (const [sh, el, hand, s] of [[j.shoulderL, j.elbowL, j.handL, -1], [j.shoulderR, j.elbowR, j.handR, 1]] as const) {
      sh.position.set(s * 0.3, 0.28, 0);
      j.chest.add(sh);
      part(sh, new THREE.SphereGeometry(0.1, 6, 4), silver, [0, 0, 0], [0, 0, 0], [1.3, 1, 1.3]);
      part(sh, limbGeo(0.06, 0.05, 0.34), body);
      el.position.y = -0.34;
      sh.add(el);
      part(el, limbGeo(0.07, 0.06, 0.3), dark);
      hand.position.y = -0.3;
      el.add(hand);
      // Blade along the forearm, sticking out past the fist.
      part(hand, new THREE.BoxGeometry(0.03, 0.62, 0.09), this.blades, [s * 0.05, -0.12, 0.02]);
    }

    this.rig.finalize();
  }
}

export const sinowPoses = {
  idle(t: number): Pose {
    return {
      joints: {
        hipL: [-0.35, 0, 0], kneeL: [0.6, 0, 0], hipR: [-0.2, 0, 0], kneeR: [0.45, 0, 0],
        spine: [0.25, 0, 0], head: [-0.15, Math.sin(t * 0.9) * 0.2, 0],
        shoulderL: [-0.3, 0, 0.3], elbowL: [-1.1, 0, 0], shoulderR: [0.3, 0, -0.3], elbowR: [-0.9, 0, 0],
        tail: [0.3 + Math.sin(t * 2) * 0.1, 0, 0],
      },
      lift: -0.1,
    };
  },
  /** Ninja run: leaning hard, arms swept back. */
  run(phase: number): Pose {
    const s = Math.sin(phase);
    const c = Math.cos(phase);
    return {
      joints: {
        hipL: [s * 0.9 - 0.2, 0, 0], kneeL: [Math.max(0, -c) * 1.2 + 0.1, 0, 0],
        hipR: [-s * 0.9 - 0.2, 0, 0], kneeR: [Math.max(0, c) * 1.2 + 0.1, 0, 0],
        spine: [0.55, 0, 0], head: [-0.4, 0, 0],
        shoulderL: [1.2, 0, 0.25], shoulderR: [1.2, 0, -0.25], elbowL: [-0.3, 0, 0], elbowR: [-0.3, 0, 0],
        tail: [1.1, 0, 0],
      },
      lift: Math.abs(c) * 0.06 - 0.06,
    };
  },
  /** Deep crouch before the leap (k 0..1). */
  crouch(k: number): Pose {
    return {
      joints: {
        hipL: [-1.1 * k, 0, 0], kneeL: [1.8 * k, 0, 0], hipR: [-1.0 * k, 0, 0], kneeR: [1.7 * k, 0, 0],
        spine: [0.6 * k, 0, 0], head: [-0.5 * k, 0, 0],
        shoulderL: [0.9 * k, 0, 0.3], shoulderR: [0.9 * k, 0, -0.3], tail: [0.6, 0, 0],
      },
      lift: -0.42 * k,
    };
  },
  leap(): Pose {
    return {
      joints: {
        hipL: [-1.4, 0, 0], kneeL: [2.0, 0, 0], hipR: [-1.2, 0, 0], kneeR: [1.9, 0, 0],
        spine: [0.4, 0, 0], shoulderL: [-2.4, 0, 0.4], shoulderR: [-2.4, 0, -0.4], elbowL: [-0.4, 0, 0], elbowR: [-0.4, 0, 0],
        tail: [1.4, 0, 0],
      },
      lift: 0.2,
    };
  },
  /** Slash number i (0..2) of the combo; `k` is the swing (0 = cocked, 1 = followed through). */
  slash(i: number, k: number): Pose {
    const right = i % 2 === 0;
    const arm = right ? 'shoulderR' : 'shoulderL';
    const s = right ? 1 : -1;
    const fin = i === 2;
    const cock: [number, number, number] = [-1.6, 0, s * 1.0];
    const through: [number, number, number] = [-1.2, 0, -s * 0.6];
    const a: [number, number, number] = [cock[0] + (through[0] - cock[0]) * k, 0, cock[2] + (through[2] - cock[2]) * k];
    return {
      joints: {
        [arm]: fin ? [-2.6 + 2.0 * k, 0, 0] : a,
        ...(fin ? { shoulderL: [-2.6 + 2.0 * k, 0, 0.2] as [number, number, number] } : {}),
        spine: [0.3 + (fin ? 0.4 * k : 0), s * (0.5 - k) * 0.9, 0],
        hipL: [-0.5, 0, 0], kneeL: [0.7, 0, 0], hipR: [0.2, 0, 0], kneeR: [0.4, 0, 0],
        tail: [0.8, 0, 0],
      },
      lift: -0.12,
    };
  },
  /** Backflip tuck (the class spins the whole body). */
  flip(): Pose {
    return sinowPoses.leap();
  },
  hurt(): Pose {
    return { joints: { spine: [-0.4, 0, 0.2], head: [-0.4, 0, 0], shoulderL: [0.4, 0, 0.5], shoulderR: [0.4, 0, -0.5], kneeL: [0.4, 0, 0], kneeR: [0.4, 0, 0] } };
  },
};

// ------------------------------------------------------------ Control node

export class NodeModel {
  readonly rig = new Rig();
  readonly core: THREE.MeshStandardMaterial;
  readonly rings: THREE.Group;

  constructor() {
    const j = this.rig.joints;
    const metal = mat(0x5a6270, { rough: 0.45 });
    const dark = mat(0x2a2e38, { rough: 0.6 });
    const stripe = mat(STRIPE);
    this.core = glow(0x40c8ff, 1.6);
    this.rig.tintable.push(metal);

    j.hips.position.y = 0;
    this.rig.root.add(j.hips);
    part(j.hips, new THREE.CylinderGeometry(0.95, 1.1, 0.35, 8), dark, [0, 0.17, 0]);
    part(j.hips, new THREE.CylinderGeometry(0.98, 0.98, 0.07, 8), stripe, [0, 0.36, 0]);
    part(j.hips, new THREE.CylinderGeometry(0.3, 0.42, 2.0, 8), metal, [0, 1.3, 0]);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      part(j.hips, new THREE.BoxGeometry(0.16, 1.6, 0.2), dark, [Math.sin(a) * 0.45, 1.0, Math.cos(a) * 0.45], [0, a, 0]);
    }
    j.head.position.y = 2.55;
    j.hips.add(j.head);
    part(j.head, new THREE.OctahedronGeometry(0.4, 0), this.core);
    part(j.head, limbGeo(0.03, 0.03, 0.6).rotateX(Math.PI), dark, [0, 0.35, 0]);
    // Two spinning rings around the core.
    this.rings = new THREE.Group();
    this.rings.position.y = 2.55;
    j.hips.add(this.rings);
    const ringMat = glow(0x40c8ff, 0.8);
    const r1 = part(this.rings, new THREE.TorusGeometry(0.72, 0.045, 5, 24), ringMat);
    r1.rotation.x = Math.PI / 2;
    const r2 = part(this.rings, new THREE.TorusGeometry(0.58, 0.035, 5, 20), ringMat);
    r2.rotation.y = Math.PI / 2;
    this.rig.finalize();
  }

  /** Spin the rings and pulse the core. `power` 0 = dark (destroyed), 1 = live. */
  update(t: number, power: number): void {
    this.rings.rotation.y = t * 1.8 * power;
    this.rings.rotation.z = Math.sin(t * 0.7) * 0.4 * power;
    this.core.emissiveIntensity = power * (1.3 + Math.sin(t * 4) * 0.4);
    (this.rings.children[0] as THREE.Mesh).visible = power > 0;
    (this.rings.children[1] as THREE.Mesh).visible = power > 0;
  }
}

export const nodePoses = {
  idle(t: number): Pose {
    return { joints: { head: [0, t * 0.8, 0] } };
  },
  hurt(): Pose {
    return { joints: { head: [0.3, 0, 0.2] } };
  },
};

// ------------------------------------------------------------- Spark Mite

/** The Warden's crawling add: a squat four-legged bot with a spark core on its back. */
export class MiteModel {
  readonly rig = new Rig();
  readonly spark: THREE.MeshStandardMaterial;

  constructor(color = 0x8a7a68) {
    const j = this.rig.joints;
    const body = mat(color, { rough: 0.5 });
    const dark = mat(0x2c2a2a, { rough: 0.6 });
    const stripe = mat(STRIPE);
    this.spark = glow(0xff7a20, 1.4);
    this.rig.tintable.push(body);

    j.hips.position.y = 0.55;
    this.rig.root.add(j.hips);
    part(j.hips, new THREE.BoxGeometry(0.9, 0.38, 1.1), body);
    part(j.hips, new THREE.BoxGeometry(0.94, 0.08, 1.14), stripe, [0, -0.12, 0]);
    part(j.hips, new THREE.BoxGeometry(0.5, 0.22, 0.3), dark, [0, 0, 0.62]);
    part(j.hips, new THREE.SphereGeometry(0.26, 8, 6), this.spark, [0, 0.3, -0.05]);
    // Four legs: front pair on the hip joints, back pair on the shoulder joints.
    const legs: [THREE.Group, number, number][] = [[j.hipL, -1, 0.35], [j.hipR, 1, 0.35], [j.shoulderL, -1, -0.35], [j.shoulderR, 1, -0.35]];
    for (const [leg, s, z] of legs) {
      leg.position.set(s * 0.42, 0, z);
      leg.rotation.z = s * 0.9;
      j.hips.add(leg);
      part(leg, limbGeo(0.07, 0.05, 0.75), dark);
    }
    this.rig.finalize();
  }

  /** Spark pulse: steady while walking, frantic once armed. */
  update(t: number, armed: number, alive: boolean): void {
    this.spark.emissiveIntensity = alive ? 1.2 + armed * 2.5 + Math.sin(t * (6 + armed * 30)) * (0.3 + armed * 0.8) : 0.05;
  }
}

export const mitePoses = {
  idle(t: number): Pose {
    return { joints: { hips: [0, 0, Math.sin(t * 3) * 0.04] } };
  },
  walk(phase: number): Pose {
    const a = Math.sin(phase) * 0.55;
    return { joints: { hipL: [a, 0, 0], shoulderR: [a, 0, 0], hipR: [-a, 0, 0], shoulderL: [-a, 0, 0], hips: [0, 0, Math.sin(phase * 2) * 0.05] }, lift: Math.abs(Math.sin(phase)) * 0.05 };
  },
  /** Armed: squats low with its legs splayed. */
  armed(k: number): Pose {
    return { joints: { hipL: [0, 0, -0.35 * k], hipR: [0, 0, 0.35 * k], shoulderL: [0, 0, -0.35 * k], shoulderR: [0, 0, 0.35 * k] }, lift: -0.18 * k };
  },
  hurt(): Pose {
    return { joints: { hips: [0.3, 0, 0.2] } };
  },
};

// ------------------------------------------------------------- Repair Drone

/** The Warden's hovering add: a rotor disc with a repair emitter underneath. */
export class DroneModel {
  readonly rig = new Rig();
  readonly lens: THREE.MeshStandardMaterial;
  private rotors: THREE.Group[] = [];

  constructor(color = 0x6a90a8) {
    const j = this.rig.joints;
    const body = mat(color, { rough: 0.45 });
    const dark = mat(0x2a2e36, { rough: 0.6 });
    const stripe = mat(STRIPE);
    this.lens = glow(0x60ffb0, 1.4);
    this.rig.tintable.push(body);

    j.hips.position.y = 2.2;
    this.rig.root.add(j.hips);
    part(j.hips, new THREE.CylinderGeometry(0.62, 0.7, 0.3, 10), body);
    part(j.hips, new THREE.CylinderGeometry(0.72, 0.72, 0.06, 10), stripe, [0, -0.08, 0]);
    part(j.hips, new THREE.SphereGeometry(0.38, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), dark, [0, 0.14, 0]);
    part(j.hips, new THREE.CylinderGeometry(0.16, 0.26, 0.3, 8), dark, [0, -0.3, 0]);
    part(j.hips, new THREE.SphereGeometry(0.15, 8, 6), this.lens, [0, -0.45, 0]);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      part(j.hips, new THREE.BoxGeometry(0.12, 0.08, 0.7), dark, [Math.sin(a) * 0.9, 0.05, Math.cos(a) * 0.9], [0, a, 0]);
      const rotor = new THREE.Group();
      rotor.position.set(Math.sin(a) * 1.25, 0.12, Math.cos(a) * 1.25);
      part(rotor, new THREE.BoxGeometry(0.75, 0.025, 0.1), dark);
      part(rotor, new THREE.BoxGeometry(0.1, 0.025, 0.75), dark);
      j.hips.add(rotor);
      this.rotors.push(rotor);
    }
    this.rig.finalize();
  }

  /** Spin the rotors; the lens brightens while it beams repairs. */
  update(t: number, repairing: boolean, alive: boolean): void {
    for (const [i, r] of this.rotors.entries()) r.rotation.y = alive ? t * 28 + i : r.rotation.y;
    this.lens.emissiveIntensity = !alive ? 0.05 : repairing ? 2.4 + Math.sin(t * 14) * 0.6 : 1.2;
  }
}

export const dronePoses = {
  hover(t: number): Pose {
    return { joints: { hips: [Math.sin(t * 1.3) * 0.06, 0, Math.sin(t * 1.7) * 0.06] }, lift: Math.sin(t * 2.2) * 0.12 };
  },
  hurt(): Pose {
    return { joints: { hips: [0.45, 0, 0.3] }, lift: -0.3 };
  },
};

// ----------------------------------------------------------------- Warden

export interface WardenPoseParams {
  /** Glow on the visor, core and chest projectors (0..1). */
  charge: number;
  /** Projecting a floor pattern: head bowed, projectors blazing (0..1). */
  cast: number;
  /** Chest plates parted over the venting core (0..1). */
  coreOpen: number;
  /** Hand (palm centre) positions in model space. */
  handL: THREE.Vector3;
  handR: THREE.Vector3;
  /** Death collapse (0..1). */
  dead: number;
  flash: boolean;
  enraged: boolean;
  time: number;
}

/** Right hand at rest, palm on the deck beside the core (model space; the left mirrors x). */
export const WARDEN_HAND_REST = new THREE.Vector3(9.5, 0.9, 3.8);

const UPPER_ARM = 6.5;
const FOREARM = 7;
const UP = new THREE.Vector3(0, 1, 0);

interface WardenArm {
  shoulder: THREE.Vector3;
  upper: THREE.Group;
  fore: THREE.Group;
  hand: THREE.Group;
  side: number;
}

/**
 * The Warden: a colossus bolted into the end of its hall, facing +Z. Its core sits
 * low in the abdomen (2.1 m in front of the origin, 3.6 m up), the head 11 m up;
 * two long arms reach the deck with heavy hands (posed by IK).
 */
export class WardenModel {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private head = new THREE.Group();
  private plates: THREE.Mesh[] = [];
  private arms: WardenArm[] = [];
  private coreMat: THREE.MeshStandardMaterial;
  private ventMat: THREE.MeshStandardMaterial;
  private visorMat: THREE.MeshStandardMaterial;
  private projMat: THREE.MeshStandardMaterial;
  private bodyMats: THREE.MeshStandardMaterial[] = [];
  private steam: THREE.Mesh[] = [];
  private steamMat: THREE.MeshBasicMaterial;
  private tmpA = new THREE.Vector3();
  private tmpB = new THREE.Vector3();
  private tmpC = new THREE.Vector3();
  private elbow = new THREE.Vector3();
  private wrist = new THREE.Vector3();

  constructor() {
    const body = mat(0x6a6e78, { rough: 0.5 });
    const dark = mat(0x30333a, { rough: 0.6 });
    const red = mat(0x8a2a24, { rough: 0.55 });
    const stripe = mat(STRIPE);
    this.bodyMats.push(body, red);
    this.coreMat = glow(0xff6a20, 1.2);
    this.ventMat = glow(0xff8a30, 0.5);
    this.visorMat = glow(0xff2a20, 1.6);
    this.projMat = glow(0xff4a30, 0.6);

    // Plinth bolted to the deck: it never moves.
    part(this.root, new THREE.BoxGeometry(13, 2, 5.4), dark, [0, 1, -0.4]);
    part(this.root, new THREE.BoxGeometry(13.2, 0.3, 5.6), stripe, [0, 2.05, -0.4]);
    for (const s of [-1, 1]) {
      part(this.root, new THREE.CylinderGeometry(0.35, 0.35, 5, 8), body, [s * 5.2, 3.2, 1.2], [0.5, 0, s * 0.25]);
      part(this.root, new THREE.BoxGeometry(2.4, 6, 2.4), dark, [s * 11.5, 3, -2.2]);
    }

    // The rest sags when it dies.
    this.root.add(this.body);
    // Hips and the abdomen holding the core.
    part(this.body, new THREE.BoxGeometry(7.4, 2.2, 4.2), body, [0, 3, -0.4]);
    part(this.body, new THREE.BoxGeometry(5.4, 3.4, 3.6), dark, [0, 3.9, 0.4]);
    part(this.body, new THREE.SphereGeometry(1.0, 14, 10), this.coreMat, [0, 3.6, 2.1]);
    part(this.body, new THREE.TorusGeometry(1.15, 0.16, 6, 20), stripe, [0, 3.6, 2.2]);
    for (const s of [-1, 1]) {
      this.plates.push(part(this.body, new THREE.BoxGeometry(1.25, 2.6, 0.32), red, [s * 0.63, 3.6, 2.45]));
      // Exhaust ports either side of the core: steam while it vents.
      part(this.body, new THREE.CylinderGeometry(0.32, 0.4, 0.5, 8).rotateX(Math.PI / 2), this.ventMat, [s * 2.0, 4.6, 2.3]);
    }
    // Chest: the big armoured block with three projector lenses.
    part(this.body, new THREE.BoxGeometry(10.4, 4.8, 4.8), body, [0, 7.8, -0.2]);
    part(this.body, new THREE.BoxGeometry(10.6, 0.5, 5), red, [0, 10.1, -0.2]);
    part(this.body, new THREE.BoxGeometry(10.6, 0.25, 5), stripe, [0, 5.6, -0.2]);
    for (const s of [-1, 1]) part(this.body, new THREE.BoxGeometry(4.4, 3.6, 0.5), red, [s * 2.5, 7.9, 2.2], [0, s * -0.22, 0]);
    for (const x of [-2.6, 0, 2.6]) {
      part(this.body, new THREE.CylinderGeometry(0.42, 0.5, 0.4, 10).rotateX(Math.PI / 2), dark, [x, 6.4, 2.35]);
      part(this.body, new THREE.CircleGeometry(0.34, 12), this.projMat, [x, 6.4, 2.56]);
    }
    // Stacks and pipes behind, into the wall.
    for (const x of [-4.4, -2.4, 2.4, 4.4]) {
      part(this.body, new THREE.CylinderGeometry(0.5, 0.6, 5, 8), dark, [x, 12.4, -2.0]);
      part(this.body, new THREE.CylinderGeometry(0.42, 0.42, 0.08, 8), this.ventMat, [x, 14.95, -2.0]);
    }
    for (const y of [5, 7.5]) part(this.body, new THREE.CylinderGeometry(0.4, 0.4, 22, 8).rotateZ(Math.PI / 2), dark, [0, y, -2.9]);

    // Head: a wide visor block on a short neck.
    part(this.body, new THREE.CylinderGeometry(1.2, 1.5, 1.2, 8), dark, [0, 10.6, 0]);
    this.head.position.set(0, 10.9, 0.4);
    this.body.add(this.head);
    part(this.head, new THREE.BoxGeometry(3.8, 2.4, 3.2), body, [0, 1.2, 0]);
    part(this.head, new THREE.BoxGeometry(3.2, 0.38, 0.12), this.visorMat, [0, 1.5, 1.62]);
    part(this.head, new THREE.SphereGeometry(0.42, 10, 8), this.projMat, [0, 0.75, 1.5]);
    part(this.head, new THREE.BoxGeometry(0.3, 1.2, 2.6), red, [0, 2.8, -0.2]);
    part(this.head, new THREE.BoxGeometry(2.6, 0.6, 1.2), dark, [0, 0.15, 1.1]);

    // Arms: shoulder, upper arm, forearm and a heavy hand; pose() solves the elbow.
    for (const side of [-1, 1]) {
      const shoulder = new THREE.Vector3(side * 6.6, 8.8, 0.1);
      part(this.body, new THREE.SphereGeometry(1.9, 10, 8), dark, [shoulder.x, shoulder.y, shoulder.z]);
      part(this.body, new THREE.BoxGeometry(3.8, 1.3, 3.8), red, [shoulder.x + side * 0.3, shoulder.y + 1.5, shoulder.z], [0, 0, side * -0.25]);
      const upper = new THREE.Group();
      part(upper, new THREE.CylinderGeometry(0.85, 1.05, UPPER_ARM, 8).translate(0, UPPER_ARM / 2, 0), body);
      part(upper, new THREE.SphereGeometry(1.15, 8, 6), dark, [0, UPPER_ARM, 0]);
      const fore = new THREE.Group();
      part(fore, new THREE.CylinderGeometry(0.95, 0.7, FOREARM, 8).translate(0, FOREARM / 2, 0), dark);
      part(fore, new THREE.BoxGeometry(0.16, FOREARM * 0.5, 0.7).translate(0, FOREARM * 0.45, 0), stripe, [side * 0.8, 0, 0]);
      const hand = new THREE.Group();
      part(hand, new THREE.BoxGeometry(2.6, 1.0, 2.6), body);
      part(hand, new THREE.BoxGeometry(2.7, 0.35, 0.5), red, [0, 0.45, -0.9]);
      for (let i = 0; i < 3; i++) part(hand, new THREE.BoxGeometry(0.62, 0.7, 1.4), dark, [(i - 1) * 0.82, -0.15, 1.85], [0.35, 0, 0]);
      part(hand, new THREE.BoxGeometry(0.6, 0.6, 1.2), dark, [-side * 1.5, -0.1, 0.6], [0, side * 0.6, 0]);
      part(hand, new THREE.CylinderGeometry(0.75, 0.75, 0.25, 10), this.ventMat, [0, -0.55, 0]);
      this.root.add(upper, fore, hand);
      this.arms.push({ shoulder, upper, fore, hand, side });
    }

    // Steam from the exhaust ports while the core vents.
    this.steamMat = new THREE.MeshBasicMaterial({ color: 0xffe0c0, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    for (let i = 0; i < 6; i++) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 6), this.steamMat);
      this.body.add(puff);
      this.steam.push(puff);
    }

    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = true;
    });
    for (const p of this.steam) p.castShadow = false;
  }

  /** Place one arm so its hand sits at `at` (model space): two-bone IK with the elbow out and back. */
  private reach(arm: WardenArm, at: THREE.Vector3, drop: number): void {
    const s = this.tmpA.copy(arm.shoulder);
    s.y -= drop;
    const wrist = this.wrist.set(at.x - arm.side * 0.2, at.y + 0.6, at.z - 1.4);
    const dir = this.tmpB.subVectors(wrist, s);
    const d = THREE.MathUtils.clamp(dir.length(), 1, UPPER_ARM + FOREARM - 0.05);
    dir.normalize();
    // Elbow bends outward, a little up and back.
    const pole = this.tmpC.set(arm.side, 0.4, -0.6);
    pole.addScaledVector(dir, -pole.dot(dir)).normalize();
    const cosA = (UPPER_ARM * UPPER_ARM + d * d - FOREARM * FOREARM) / (2 * UPPER_ARM * d);
    const angA = Math.acos(THREE.MathUtils.clamp(cosA, -1, 1));
    const elbow = this.elbow.copy(s).addScaledVector(dir, Math.cos(angA) * UPPER_ARM).addScaledVector(pole, Math.sin(angA) * UPPER_ARM);
    // The wrist actually reached (a fully stretched arm can fall short).
    wrist.copy(s).addScaledVector(dir, d);
    arm.upper.position.copy(s);
    arm.upper.quaternion.setFromUnitVectors(UP, dir.subVectors(elbow, s).normalize());
    arm.fore.position.copy(elbow);
    arm.fore.quaternion.setFromUnitVectors(UP, dir.subVectors(wrist, elbow).normalize());
    arm.hand.position.set(wrist.x + arm.side * 0.2, wrist.y - 0.6, wrist.z + 1.4);
    arm.hand.rotation.set(0.08, -arm.side * 0.12, 0);
  }

  pose(p: WardenPoseParams): void {
    const t = p.time;
    const d = p.dead;
    this.body.position.y = -d * 1.6;
    this.body.position.z = d * 0.6;
    this.body.rotation.x = d * 0.32 + p.cast * 0.03;
    this.head.rotation.x = d * 0.5 + p.cast * 0.3 + Math.sin(t * 0.7) * 0.02;
    this.head.rotation.y = Math.sin(t * 0.4) * 0.12 * (1 - d) * (1 - p.cast);
    for (const arm of this.arms) this.reach(arm, arm.side < 0 ? p.handL : p.handR, d * 1.6);
    // Chest plates part over the core.
    this.plates.forEach((pl, i) => (pl.position.x = (i === 0 ? -1 : 1) * (0.63 + p.coreOpen * 0.85)));
    const live = 1 - d;
    const coreK = Math.max(p.charge * 0.6, p.coreOpen);
    this.coreMat.emissiveIntensity = live * (1 + coreK * 2.4 + Math.sin(t * 10) * 0.3 * coreK);
    this.coreMat.emissive.setHex(p.coreOpen > 0.5 ? 0xffe060 : 0xff6a20);
    this.ventMat.emissiveIntensity = live * (0.5 + p.charge * 1.5 + p.coreOpen * 2.5);
    this.projMat.emissiveIntensity = live * (0.5 + p.cast * 3.5 + p.charge * 1.2 + (p.cast > 0 ? Math.sin(t * 18) * 0.5 : 0));
    this.visorMat.emissiveIntensity = d > 0 ? 0.1 + live * 1.5 : 1.6 + p.charge * 1.2;
    // Steam rising off the core while it vents.
    this.steamMat.opacity = p.coreOpen * 0.22;
    this.steam.forEach((s, i) => {
      s.visible = p.coreOpen > 0.05;
      const k = (t * 0.9 + i / this.steam.length) % 1;
      const side = i % 2 ? 1 : -1;
      s.position.set(side * (2 + k * 0.6), 4.8 + k * 4, 2.4 + k * 1.2);
      s.scale.setScalar(0.6 + k * 1.8);
    });
    // Tint: flash white on hits, redden when enraged.
    for (const m of this.bodyMats) {
      if (p.flash) {
        m.emissive.setHex(0xffffff);
        m.emissiveIntensity = 0.5;
      } else if (p.enraged && d === 0) {
        m.emissive.setHex(0x501008);
        m.emissiveIntensity = 0.45 + Math.sin(t * 6) * 0.25;
      } else {
        m.emissive.setHex(0x000000);
      }
    }
  }
}
