import * as THREE from 'three';
import { limbGeo, mat, part, Rig, type Euler3, type Pose } from './Rig';

// Ruins enemies: the Dimenian family (sword-carrying soldiers), the Delsaber shield
// knight, the floating Chaos Sorcerer, the giant Dark Belra and the centaur Chaos
// Bringer, plus the Darvants of Dark Falz's swarm. Dark, glossy armour with violet
// light in the seams, so they read against the pale temple stone.
// Conventions (like the Booma rig): models face +Z, the left side is +X, arms and legs
// hang along -Y. Shoulder X < 0 raises an arm forward, Z > 0 lifts the left arm outward.

/** A material that keeps its own glow (emissive flashes and tints skip it). */
function glow(color: number, intensity = 1.4): THREE.MeshStandardMaterial {
  const m = mat(color, { emissive: color, emissiveIntensity: intensity });
  m.userData.glow = true;
  return m;
}

const VIOLET = 0xb050ff;
const GOLD = 0xd8b060;

/** Smoothstep 0..1. */
const ease = (k: number) => {
  const c = Math.max(0, Math.min(1, k));
  return c * c * (3 - 2 * c);
};

// ---------------------------------------------------------------- Dimenian

export class DimenianModel {
  readonly rig = new Rig();
  readonly eyes: THREE.MeshStandardMaterial;
  readonly blade: THREE.MeshStandardMaterial;

  constructor(color = 0x4a5ad0) {
    const j = this.rig.joints;
    const body = mat(color, { rough: 0.45 });
    const armour = mat(0x2a2838, { rough: 0.4 });
    const trim = mat(GOLD, { rough: 0.35 });
    const cloth = mat(new THREE.Color(color).multiplyScalar(0.55).getHex(), { rough: 0.8 });
    this.eyes = glow(0xff4060, 1.6);
    this.blade = glow(0xc080ff, 1.1);
    this.rig.tintable.push(body, cloth);

    j.hips.position.y = 0.96;
    this.rig.root.add(j.hips);
    part(j.hips, new THREE.BoxGeometry(0.36, 0.2, 0.24), armour);
    // A tabard hanging front and back.
    part(j.hips, new THREE.BoxGeometry(0.26, 0.42, 0.03), cloth, [0, -0.28, 0.13], [0.08, 0, 0]);
    part(j.hips, new THREE.BoxGeometry(0.3, 0.46, 0.03), cloth, [0, -0.28, -0.13], [-0.08, 0, 0]);
    for (const [hip, knee, s] of [[j.hipL, j.kneeL, 1], [j.hipR, j.kneeR, -1]] as const) {
      hip.position.set(s * 0.14, -0.06, 0);
      j.hips.add(hip);
      part(hip, limbGeo(0.085, 0.065, 0.48), body);
      knee.position.y = -0.48;
      hip.add(knee);
      part(knee, new THREE.SphereGeometry(0.075, 6, 4), trim);
      part(knee, limbGeo(0.07, 0.055, 0.46), armour);
      part(knee, new THREE.BoxGeometry(0.11, 0.07, 0.26), armour, [0, -0.48, 0.05]);
    }

    j.spine.position.y = 0.1;
    j.hips.add(j.spine);
    part(j.spine, new THREE.CylinderGeometry(0.16, 0.13, 0.3, 6), body, [0, 0.15, 0]);
    j.chest.position.y = 0.3;
    j.spine.add(j.chest);
    part(j.chest, new THREE.CylinderGeometry(0.27, 0.17, 0.42, 6), armour, [0, 0.18, 0]);
    part(j.chest, new THREE.BoxGeometry(0.2, 0.2, 0.06), trim, [0, 0.2, 0.17]);
    part(j.chest, new THREE.OctahedronGeometry(0.05), this.eyes, [0, 0.2, 0.21]);
    // A short cape from the shoulders.
    j.tail.position.set(0, 0.36, -0.16);
    j.chest.add(j.tail);
    part(j.tail, new THREE.BoxGeometry(0.42, 0.62, 0.03), cloth, [0, -0.3, -0.02]);

    j.head.position.y = 0.44;
    j.chest.add(j.head);
    part(j.head, new THREE.SphereGeometry(0.15, 8, 6), armour, [0, 0.08, 0], [0, 0, 0], [0.95, 1.15, 1.05]);
    part(j.head, new THREE.BoxGeometry(0.2, 0.04, 0.06), this.eyes, [0, 0.08, 0.13]);
    // Swept-back crest, gold horns.
    part(j.head, new THREE.ConeGeometry(0.05, 0.42, 4), body, [0, 0.24, -0.12], [-1.0, 0, 0]);
    for (const s of [1, -1]) part(j.head, new THREE.ConeGeometry(0.03, 0.2, 4), trim, [s * 0.12, 0.16, 0.02], [-0.3, 0, -s * 0.9]);

    for (const [sh, el, hand, s] of [[j.shoulderL, j.elbowL, j.handL, 1], [j.shoulderR, j.elbowR, j.handR, -1]] as const) {
      sh.position.set(s * 0.32, 0.3, 0);
      j.chest.add(sh);
      part(sh, new THREE.SphereGeometry(0.11, 6, 4), armour, [0, 0.02, 0], [0, 0, 0], [1.4, 1, 1.3]);
      part(sh, new THREE.ConeGeometry(0.05, 0.16, 4), trim, [s * 0.1, 0.12, 0], [0, 0, -s * 0.5]);
      part(sh, limbGeo(0.065, 0.055, 0.32), body);
      el.position.y = -0.32;
      sh.add(el);
      part(el, limbGeo(0.07, 0.06, 0.3), armour);
      hand.position.y = -0.3;
      el.add(hand);
      part(hand, new THREE.BoxGeometry(0.09, 0.1, 0.1), armour);
    }
    // A long curved photon blade in the right hand, held forward.
    part(j.handR, new THREE.BoxGeometry(0.05, 0.05, 0.22), trim, [0, -0.04, 0.06]);
    part(j.handR, new THREE.BoxGeometry(0.03, 0.12, 0.95), this.blade, [0, -0.06, 0.6], [0.12, 0, 0]);

    this.rig.finalize();
  }
}

/** Dimenian poses (the Brawler AI's set): a raised sword windup and a diagonal cut. */
export const dimenianPoses = {
  idle(t: number): Pose {
    const b = Math.sin(t * 2);
    return {
      joints: {
        hipL: [-0.2, 0, 0], kneeL: [0.35, 0, 0], hipR: [0.15, 0, 0], kneeR: [0.2, 0, 0],
        spine: [0.15, 0, 0], chest: [0.03 * b, 0, 0], head: [-0.1, Math.sin(t * 0.8) * 0.25, 0],
        shoulderL: [-0.2, 0, 0.25], elbowL: [-0.5, 0, 0],
        shoulderR: [-0.5, 0, -0.2], elbowR: [-0.6, 0, 0],
        tail: [0.15 + b * 0.05, 0, 0],
      },
      lift: -0.04 + b * 0.015,
    };
  },
  walk(phase: number, intensity = 1): Pose {
    const s = Math.sin(phase) * intensity;
    const c = Math.cos(phase);
    return {
      joints: {
        hipL: [-s * 0.7 - 0.1, 0, 0], kneeL: [0.2 + Math.max(0, c) * 0.9 * intensity, 0, 0],
        hipR: [s * 0.7 - 0.1, 0, 0], kneeR: [0.2 + Math.max(0, -c) * 0.9 * intensity, 0, 0],
        spine: [0.3 * intensity, 0, 0], head: [-0.2 * intensity, 0, 0],
        shoulderL: [s * 0.5 - 0.2, 0, 0.25], elbowL: [-0.6, 0, 0],
        shoulderR: [-0.7, 0, -0.25], elbowR: [-0.5, 0, 0],
        tail: [0.4 * intensity, 0, 0],
      },
      lift: Math.abs(c) * 0.05 * intensity - 0.03,
    };
  },
  /** The sword rises over the right shoulder (k 0..1). */
  windup(k: number): Pose {
    const e = ease(k);
    return {
      joints: {
        hipL: [-0.5 * e, 0, 0], kneeL: [0.6 * e, 0, 0], hipR: [0.3 * e, 0, 0], kneeR: [0.3 * e, 0, 0],
        spine: [-0.15 * e, -0.5 * e, 0], head: [-0.2 * e, 0.4 * e, 0],
        shoulderR: [-2.7 * e, 0, -0.6 * e], elbowR: [-0.9 * e, 0, 0],
        shoulderL: [-0.6 * e, 0, 0.5 * e], elbowL: [-0.8 * e, 0, 0],
      },
      lift: -0.1 * e,
    };
  },
  /** A diagonal cut down across the body. */
  strike(): Pose {
    return {
      joints: {
        hipL: [-0.7, 0, 0], kneeL: [0.8, 0, 0], hipR: [0.4, 0, 0], kneeR: [0.3, 0, 0],
        spine: [0.5, 0.45, 0], head: [0.1, -0.3, 0],
        shoulderR: [-1.1, 0, 0.6], elbowR: [-0.2, 0, 0],
        shoulderL: [0.3, 0, 0.6], elbowL: [-0.4, 0, 0],
        tail: [0.8, 0, 0],
      },
      lift: -0.14,
    };
  },
  hurt(): Pose {
    return {
      joints: {
        spine: [-0.45, 0, 0], head: [-0.4, 0, 0],
        shoulderL: [0.4, 0, 0.8], shoulderR: [0.4, 0, -0.8], elbowL: [-0.5, 0, 0], elbowR: [-0.5, 0, 0],
        kneeL: [0.3, 0, 0], kneeR: [0.3, 0, 0],
      },
    };
  },
  crouch(): Pose {
    return { joints: { spine: [0.5, 0, 0], hipL: [-0.9, 0, 0], kneeL: [1.2, 0, 0], hipR: [-0.9, 0, 0], kneeR: [1.2, 0, 0] }, lift: -0.3 };
  },
};

// ---------------------------------------------------------------- Delsaber

export class DelsaberModel {
  readonly rig = new Rig();
  readonly eyes: THREE.MeshStandardMaterial;
  readonly blade: THREE.MeshStandardMaterial;
  /** The shield's face: it lights up while the guard is up and flashes when it blocks. */
  readonly ward: THREE.MeshStandardMaterial;

  constructor(color = 0x3a4a6a) {
    const j = this.rig.joints;
    const body = mat(color, { rough: 0.4 });
    const plate = mat(0x22202e, { rough: 0.35 });
    const trim = mat(0xb8bccc, { rough: 0.3 });
    this.eyes = glow(0xff3a50, 1.8);
    this.blade = glow(0xff7aa0, 1.1);
    this.ward = glow(VIOLET, 0.5);
    this.rig.tintable.push(body);

    j.hips.position.y = 1.04;
    this.rig.root.add(j.hips);
    part(j.hips, new THREE.BoxGeometry(0.44, 0.24, 0.28), plate);
    // Plated faulds.
    for (const s of [1, -1]) part(j.hips, new THREE.BoxGeometry(0.2, 0.3, 0.05), body, [s * 0.13, -0.2, 0.14], [0.15, 0, 0]);
    for (const [hip, knee, s] of [[j.hipL, j.kneeL, 1], [j.hipR, j.kneeR, -1]] as const) {
      hip.position.set(s * 0.16, -0.08, 0);
      j.hips.add(hip);
      part(hip, limbGeo(0.11, 0.085, 0.5), body);
      knee.position.y = -0.5;
      hip.add(knee);
      part(knee, new THREE.SphereGeometry(0.1, 6, 4), trim);
      part(knee, limbGeo(0.09, 0.075, 0.48), plate);
      part(knee, new THREE.BoxGeometry(0.15, 0.09, 0.32), plate, [0, -0.5, 0.06]);
    }

    j.spine.position.y = 0.12;
    j.hips.add(j.spine);
    part(j.spine, new THREE.CylinderGeometry(0.2, 0.16, 0.3, 6), body, [0, 0.15, 0]);
    j.chest.position.y = 0.3;
    j.spine.add(j.chest);
    part(j.chest, new THREE.CylinderGeometry(0.34, 0.2, 0.5, 6), plate, [0, 0.22, 0]);
    part(j.chest, new THREE.BoxGeometry(0.3, 0.26, 0.06), body, [0, 0.24, 0.2]);
    part(j.chest, new THREE.BoxGeometry(0.06, 0.2, 0.02), this.eyes, [0, 0.24, 0.235]);

    j.head.position.y = 0.52;
    j.chest.add(j.head);
    part(j.head, new THREE.CylinderGeometry(0.14, 0.17, 0.3, 6), plate, [0, 0.1, 0]);
    part(j.head, new THREE.BoxGeometry(0.22, 0.035, 0.05), this.eyes, [0, 0.12, 0.15]);
    // Swept horns.
    for (const s of [1, -1]) {
      part(j.head, new THREE.ConeGeometry(0.045, 0.42, 5), trim, [s * 0.16, 0.24, -0.04], [-0.5, 0, -s * 0.55]);
    }

    for (const [sh, el, hand, s] of [[j.shoulderL, j.elbowL, j.handL, 1], [j.shoulderR, j.elbowR, j.handR, -1]] as const) {
      sh.position.set(s * 0.4, 0.36, 0);
      j.chest.add(sh);
      part(sh, new THREE.SphereGeometry(0.16, 6, 4), plate, [s * 0.04, 0.03, 0], [0, 0, 0], [1.3, 0.9, 1.2]);
      part(sh, new THREE.ConeGeometry(0.06, 0.24, 4), trim, [s * 0.14, 0.15, 0], [0, 0, -s * 0.6]);
      part(sh, limbGeo(0.08, 0.07, 0.36), body);
      el.position.y = -0.36;
      sh.add(el);
      part(el, limbGeo(0.085, 0.075, 0.34), plate);
      hand.position.y = -0.34;
      el.add(hand);
      part(hand, new THREE.BoxGeometry(0.11, 0.11, 0.12), plate);
    }
    // Kite shield on the left forearm: its face points along the forearm, so a raised forearm holds it in front.
    part(j.elbowL, new THREE.BoxGeometry(0.78, 0.08, 1.05), plate, [0.02, -0.26, 0.05]);
    part(j.elbowL, new THREE.BoxGeometry(0.62, 0.02, 0.86), this.ward, [0.02, -0.31, 0.05]);
    part(j.elbowL, new THREE.ConeGeometry(0.36, 0.42, 4), plate, [0.02, -0.26, -0.68], [-Math.PI / 2, Math.PI / 4, 0], [1, 1, 0.2]);
    // Long sword in the right hand.
    part(j.handR, new THREE.BoxGeometry(0.28, 0.05, 0.06), trim, [0, -0.04, 0.08]);
    part(j.handR, new THREE.BoxGeometry(0.035, 0.1, 1.25), this.blade, [0, -0.05, 0.74]);

    this.rig.finalize();
  }
}

/** The shield arm held in front (forearm level, pointing forward). */
const GUARD_L: Record<string, Euler3> = { shoulderL: [-0.55, 0.35, 0.15], elbowL: [-1.05, 0, 0] };

export const delsaberPoses = {
  idle(t: number): Pose {
    const b = Math.sin(t * 1.8);
    return {
      joints: {
        hipL: [-0.35, 0, 0], kneeL: [0.45, 0, 0], hipR: [0.2, 0, 0], kneeR: [0.25, 0, 0],
        spine: [0.12, 0, 0], chest: [0.02 * b, 0, 0], head: [-0.05, Math.sin(t * 0.7) * 0.2, 0],
        ...GUARD_L,
        shoulderR: [-0.3, 0, -0.25], elbowR: [-0.8, 0, 0],
      },
      lift: -0.06 + b * 0.01,
    };
  },
  walk(phase: number, intensity = 1): Pose {
    const s = Math.sin(phase) * intensity;
    const c = Math.cos(phase);
    return {
      joints: {
        hipL: [-s * 0.55 - 0.1, 0, 0], kneeL: [0.2 + Math.max(0, c) * 0.7 * intensity, 0, 0],
        hipR: [s * 0.55 - 0.1, 0, 0], kneeR: [0.2 + Math.max(0, -c) * 0.7 * intensity, 0, 0],
        spine: [0.18 * intensity, 0, 0],
        ...GUARD_L,
        shoulderR: [-s * 0.3 - 0.35, 0, -0.25], elbowR: [-0.7, 0, 0],
      },
      lift: Math.abs(c) * 0.04 * intensity - 0.04,
    };
  },
  /** Crouching to leap (k 0..1): sword drawn back, shield still up. */
  crouch(k: number): Pose {
    const e = ease(k);
    return {
      joints: {
        hipL: [-1.0 * e, 0, 0], kneeL: [1.5 * e, 0, 0], hipR: [-0.8 * e, 0, 0], kneeR: [1.4 * e, 0, 0],
        spine: [0.45 * e, 0, 0], head: [-0.4 * e, 0, 0],
        ...GUARD_L,
        shoulderR: [0.6 * e, 0, -0.5 * e], elbowR: [-0.6 * e, 0, 0],
      },
      lift: -0.36 * e,
    };
  },
  leap(): Pose {
    return {
      joints: {
        hipL: [-1.3, 0, 0], kneeL: [1.8, 0, 0], hipR: [-0.9, 0, 0], kneeR: [1.6, 0, 0],
        spine: [0.2, 0, 0],
        shoulderL: [-1.0, 0, 0.3], elbowL: [-0.6, 0, 0],
        shoulderR: [-2.8, 0, -0.3], elbowR: [-0.5, 0, 0],
      },
      lift: 0.15,
    };
  },
  /** Cut i (0..2): right-to-left, back across, then an overhead finisher; k = swing progress. */
  slash(i: number, k: number): Pose {
    const e = ease(k);
    let arm: Euler3;
    let spineY: number;
    if (i === 2) {
      arm = [-2.9 + 2.1 * e, 0, -0.1];
      spineY = 0;
    } else {
      const from = i === 0 ? -0.9 : 0.6;
      const to = -from;
      arm = [-1.5, 0, from + (to - from) * e];
      spineY = (i === 0 ? -0.5 : 0.5) + (i === 0 ? 1 : -1) * e;
    }
    return {
      joints: {
        hipL: [-0.6, 0, 0], kneeL: [0.7, 0, 0], hipR: [0.3, 0, 0], kneeR: [0.3, 0, 0],
        spine: [0.25 + (i === 2 ? 0.4 * e : 0), spineY, 0],
        shoulderR: arm, elbowR: [-0.15, 0, 0],
        shoulderL: [-0.3, 0, 0.6], elbowL: [-0.9, 0, 0],
      },
      lift: -0.12,
    };
  },
  /** Guard broken: the shield arm flung wide, reeling back. */
  broken(): Pose {
    return {
      joints: {
        spine: [-0.35, 0.3, 0], head: [-0.3, 0, 0],
        shoulderL: [0.2, 0, 1.4], elbowL: [-0.3, 0, 0],
        shoulderR: [0.3, 0, -0.7], elbowR: [-0.4, 0, 0],
        hipL: [0.2, 0, 0], kneeL: [0.4, 0, 0], hipR: [-0.3, 0, 0], kneeR: [0.5, 0, 0],
      },
      lift: -0.05,
    };
  },
  hurt(): Pose {
    return {
      joints: {
        spine: [-0.35, 0, 0], head: [-0.35, 0, 0],
        ...GUARD_L,
        shoulderR: [0.3, 0, -0.7], elbowR: [-0.4, 0, 0],
        kneeL: [0.3, 0, 0], kneeR: [0.3, 0, 0],
      },
    };
  },
};

// ---------------------------------------------------------- Chaos Sorcerer

export class SorcererModel {
  readonly rig = new Rig();
  readonly eyes: THREE.MeshStandardMaterial;
  readonly hands: THREE.MeshStandardMaterial;
  /** The two orbiting bits. */
  readonly bits: THREE.Mesh[] = [];
  private bitMat: THREE.MeshStandardMaterial;
  private body: THREE.Group;

  constructor(color = 0x6a2a8a) {
    const j = this.rig.joints;
    const robe = mat(color, { rough: 0.7 });
    const robeDark = mat(new THREE.Color(color).multiplyScalar(0.5).getHex(), { rough: 0.8 });
    const mask = mat(0xe8d8b0, { rough: 0.3 });
    const gold = mat(GOLD, { rough: 0.3 });
    this.eyes = glow(0x60f0ff, 1.8);
    this.hands = glow(VIOLET, 1.2);
    this.bitMat = glow(0xff60d0, 1.6);
    this.rig.tintable.push(robe);

    // It floats: no legs, a long robe hanging from the waist.
    this.body = new THREE.Group();
    this.rig.root.add(this.body);
    j.hips.position.y = 1.35;
    this.body.add(j.hips);
    part(j.hips, new THREE.CylinderGeometry(0.2, 0.62, 1.25, 8, 1, true), robe, [0, -0.58, 0]);
    part(j.hips, new THREE.CylinderGeometry(0.62, 0.66, 0.06, 8), robeDark, [0, -1.2, 0]);
    // Glowing hem lines down the robe's front.
    for (const s of [1, -1]) part(j.hips, new THREE.BoxGeometry(0.03, 1.15, 0.02), this.hands, [s * 0.16, -0.6, 0.38], [-0.33, 0, s * 0.2]);

    j.spine.position.y = 0.0;
    j.hips.add(j.spine);
    part(j.spine, new THREE.CylinderGeometry(0.2, 0.2, 0.3, 6), robeDark, [0, 0.15, 0]);
    j.chest.position.y = 0.3;
    j.spine.add(j.chest);
    part(j.chest, new THREE.CylinderGeometry(0.34, 0.2, 0.42, 6), robe, [0, 0.2, 0]);
    // High spiked collar.
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      if (Math.cos(a) > 0.6) continue; // open in front of the face
      part(j.chest, new THREE.ConeGeometry(0.06, 0.4, 4), robeDark, [Math.sin(a) * 0.26, 0.5, Math.cos(a) * 0.22], [Math.cos(a) * -0.4, 0, Math.sin(a) * 0.4]);
    }
    part(j.chest, new THREE.OctahedronGeometry(0.09), this.hands, [0, 0.22, 0.24]);

    j.head.position.y = 0.48;
    j.chest.add(j.head);
    // Tall pale mask with three eyes and a crown.
    part(j.head, new THREE.SphereGeometry(0.15, 8, 6), mask, [0, 0.14, 0.02], [0, 0, 0], [0.9, 1.6, 0.9]);
    for (const [x, y] of [[-0.06, 0.16], [0.06, 0.16], [0, 0.27]]) part(j.head, new THREE.OctahedronGeometry(0.03), this.eyes, [x, y, 0.14]);
    for (let i = 0; i < 5; i++) {
      const a = ((i - 2) / 4) * 1.6;
      part(j.head, new THREE.ConeGeometry(0.03, 0.26, 4), gold, [Math.sin(a) * 0.12, 0.42, -0.02 + Math.cos(a) * 0.02], [0, 0, -a * 0.6]);
    }

    for (const [sh, el, hand, s] of [[j.shoulderL, j.elbowL, j.handL, 1], [j.shoulderR, j.elbowR, j.handR, -1]] as const) {
      sh.position.set(s * 0.38, 0.34, 0);
      j.chest.add(sh);
      part(sh, new THREE.SphereGeometry(0.15, 6, 4), robeDark, [s * 0.04, 0.04, 0], [0, 0, 0], [1.3, 0.8, 1.2]);
      part(sh, new THREE.ConeGeometry(0.08, 0.3, 4), gold, [s * 0.16, 0.16, 0], [0, 0, -s * 0.7]);
      // Wide sleeves.
      part(sh, new THREE.CylinderGeometry(0.07, 0.13, 0.4, 6).translate(0, -0.2, 0), robe);
      el.position.y = -0.4;
      sh.add(el);
      part(el, new THREE.CylinderGeometry(0.12, 0.2, 0.36, 6, 1, true).translate(0, -0.18, 0), robe);
      hand.position.y = -0.38;
      el.add(hand);
      part(hand, new THREE.SphereGeometry(0.06, 6, 4), this.hands);
      for (let f = 0; f < 3; f++) part(hand, new THREE.ConeGeometry(0.018, 0.16, 4), this.hands, [(f - 1) * 0.04, -0.1, 0.03], [0.4, 0, (f - 1) * 0.3]);
    }

    // The two bits orbit it (positions set in update).
    for (let i = 0; i < 2; i++) {
      const bit = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 0), this.bitMat);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.025, 4, 12), gold);
      bit.add(ring);
      bit.castShadow = true;
      this.rig.root.add(bit);
      this.bits.push(bit);
    }

    this.rig.finalize();
  }

  /** Float, orbit the bits (they gather in front while casting) and shrink away while blinking (blink 0..1). */
  update(t: number, cast: number, blink: number, alive: boolean): void {
    this.body.position.y = alive ? 0.18 + Math.sin(t * 1.8) * 0.1 : 0;
    const s = 1 - ease(blink);
    this.rig.root.scale.setScalar(Math.max(0.02, s));
    this.bits.forEach((b, i) => {
      const a = t * (1.6 + cast * 2) + i * Math.PI;
      const r = 0.95 - cast * 0.45;
      b.visible = alive;
      b.position.set(Math.sin(a) * r, 1.7 + Math.sin(t * 3 + i) * 0.15 + cast * 0.4, Math.cos(a) * r + cast * 0.55);
      b.rotation.set(t * 2 + i, t * 3, 0);
    });
    this.bitMat.emissiveIntensity = alive ? 1.4 + cast * 1.6 : 0.1;
    this.hands.emissiveIntensity = alive ? 1 + cast * 2 : 0.1;
  }
}

export const sorcererPoses = {
  idle(t: number): Pose {
    const b = Math.sin(t * 1.4);
    return {
      joints: {
        spine: [0.05, 0, 0], chest: [0.03 * b, 0, 0], head: [-0.05, Math.sin(t * 0.6) * 0.3, 0],
        shoulderL: [-0.3, 0, 0.45 + b * 0.05], elbowL: [-0.7, 0, 0],
        shoulderR: [-0.3, 0, -0.45 - b * 0.05], elbowR: [-0.7, 0, 0],
      },
    };
  },
  /** Gliding along (lean into the move). */
  glide(lean: number): Pose {
    return {
      joints: {
        spine: [0.3 * lean, 0, 0], head: [-0.2 * lean, 0, 0],
        shoulderL: [0.5 * lean, 0, 0.6], elbowL: [-0.4, 0, 0],
        shoulderR: [0.5 * lean, 0, -0.6], elbowR: [-0.4, 0, 0],
      },
    };
  },
  /** Raising both hands to cast (k 0..1). */
  cast(k: number): Pose {
    const e = ease(k);
    return {
      joints: {
        spine: [-0.2 * e, 0, 0], head: [-0.35 * e, 0, 0],
        shoulderL: [-2.5 * e, 0, 0.7], elbowL: [-0.3, 0, 0],
        shoulderR: [-2.5 * e, 0, -0.7], elbowR: [-0.3, 0, 0],
      },
    };
  },
  /** The spell goes off: hands thrown forward. */
  release(): Pose {
    return {
      joints: {
        spine: [0.3, 0, 0],
        shoulderL: [-1.5, 0, 0.25], elbowL: [0, 0, 0],
        shoulderR: [-1.5, 0, -0.25], elbowR: [0, 0, 0],
      },
    };
  },
  /** Draining a pylon: one clawed hand reaching toward it. */
  drain(t: number): Pose {
    return {
      joints: {
        spine: [0.2, 0, 0], head: [0.1, 0, 0],
        shoulderR: [-1.6, 0, -0.1 + Math.sin(t * 20) * 0.05], elbowR: [-0.1, 0, 0],
        shoulderL: [-0.6, 0, 0.9], elbowL: [-0.9, 0, 0],
      },
    };
  },
  hurt(): Pose {
    return {
      joints: {
        spine: [-0.4, 0, 0], head: [-0.4, 0, 0],
        shoulderL: [0.3, 0, 1.0], shoulderR: [0.3, 0, -1.0], elbowL: [-0.4, 0, 0], elbowR: [-0.4, 0, 0],
      },
    };
  },
};

// -------------------------------------------------------------- Dark Belra

/** Metres the Belra's fist sits from its elbow at rest. */
const BELRA_FOREARM = 1.0;

export class BelraModel {
  readonly rig = new Rig();
  readonly cracks: THREE.MeshStandardMaterial;
  readonly eyes: THREE.MeshStandardMaterial;
  /** The stretch of rock between elbow and fist while the punch is out. */
  private stretch: THREE.Mesh;

  constructor(color = 0x5a3a7a) {
    const j = this.rig.joints;
    const rock = mat(color, { rough: 0.9 });
    const rockDark = mat(new THREE.Color(color).multiplyScalar(0.55).getHex(), { rough: 0.95 });
    const bone = mat(0xd8d0c0, { rough: 0.6 });
    this.cracks = glow(VIOLET, 1.2);
    this.eyes = glow(0xffd040, 2);
    this.rig.tintable.push(rock, rockDark);

    j.hips.position.y = 1.25;
    this.rig.root.add(j.hips);
    part(j.hips, new THREE.DodecahedronGeometry(0.5, 0), rockDark, [0, 0, -0.05], [0, 0, 0], [1.3, 0.8, 1]);
    for (const [hip, knee, s] of [[j.hipL, j.kneeL, 1], [j.hipR, j.kneeR, -1]] as const) {
      hip.position.set(s * 0.45, -0.15, 0);
      j.hips.add(hip);
      part(hip, limbGeo(0.28, 0.24, 0.6, 7), rock);
      knee.position.y = -0.6;
      hip.add(knee);
      part(knee, new THREE.DodecahedronGeometry(0.24, 0), rockDark);
      part(knee, limbGeo(0.24, 0.3, 0.5, 7), rockDark);
      part(knee, new THREE.BoxGeometry(0.5, 0.18, 0.62), rockDark, [0, -0.52, 0.08]);
    }

    // A huge hunched torso of stacked stone with glowing seams.
    j.spine.position.y = 0.15;
    j.spine.rotation.x = 0.25;
    j.hips.add(j.spine);
    part(j.spine, new THREE.DodecahedronGeometry(0.75, 0), rock, [0, 0.55, 0], [0, 0.3, 0], [1.25, 1.0, 0.95]);
    part(j.spine, new THREE.BoxGeometry(0.5, 0.06, 0.04), this.cracks, [0, 0.5, 0.72], [0, 0, 0.3]);
    j.chest.position.y = 1.0;
    j.spine.add(j.chest);
    part(j.chest, new THREE.DodecahedronGeometry(0.85, 0), rockDark, [0, 0.2, -0.05], [0.2, 0, 0], [1.6, 0.85, 1.05]);
    part(j.chest, new THREE.OctahedronGeometry(0.22), this.cracks, [0, 0.12, 0.75]);
    for (let i = 0; i < 4; i++) part(j.chest, new THREE.ConeGeometry(0.16, 0.6, 5), bone, [(i - 1.5) * 0.4, 0.75, -0.3], [-0.6, 0, (i - 1.5) * 0.3]);
    // A small head sunk between the shoulders.
    j.head.position.set(0, 0.45, 0.55);
    j.head.rotation.x = -0.25;
    j.chest.add(j.head);
    part(j.head, new THREE.DodecahedronGeometry(0.3, 0), rock, [0, 0.05, 0]);
    for (const s of [1, -1]) part(j.head, new THREE.OctahedronGeometry(0.06), this.eyes, [s * 0.12, 0.08, 0.25]);
    part(j.head, new THREE.BoxGeometry(0.3, 0.08, 0.1), bone, [0, -0.12, 0.24]);

    // Massive arms that reach the floor.
    for (const [sh, el, hand, s] of [[j.shoulderL, j.elbowL, j.handL, 1], [j.shoulderR, j.elbowR, j.handR, -1]] as const) {
      sh.position.set(s * 1.15, 0.25, 0.1);
      sh.rotation.x = -0.25;
      j.chest.add(sh);
      part(sh, new THREE.DodecahedronGeometry(0.45, 0), rockDark, [s * 0.1, 0.1, 0]);
      part(sh, limbGeo(0.32, 0.3, 0.9, 7), rock);
      el.position.y = -0.9;
      sh.add(el);
      part(el, new THREE.DodecahedronGeometry(0.32, 0), rockDark);
      part(el, limbGeo(0.36, 0.45, BELRA_FOREARM - 0.2, 7), rock);
      hand.position.y = -BELRA_FOREARM;
      el.add(hand);
      part(hand, new THREE.DodecahedronGeometry(0.52, 0), rockDark, [0, -0.15, 0.05], [0.4, 0.3, 0]);
      part(hand, new THREE.BoxGeometry(0.4, 0.05, 0.05), this.cracks, [0, -0.15, 0.5]);
      for (let f = 0; f < 3; f++) part(hand, new THREE.ConeGeometry(0.1, 0.32, 5), bone, [(f - 1) * 0.22, -0.55, 0.25], [2.4, 0, 0]);
    }
    // The punch stretches a column of rock out of the right forearm.
    this.stretch = part(j.elbowR, new THREE.CylinderGeometry(0.22, 0.26, 1, 6), this.cracks, [0, -BELRA_FOREARM, 0]);
    this.stretch.visible = false;

    this.rig.finalize();
  }

  /** Throw the right fist `m` metres past its forearm (0 = at rest). */
  setReach(m: number): void {
    const j = this.rig.joints;
    j.handR.position.y = -BELRA_FOREARM - m;
    this.stretch.visible = m > 0.05;
    this.stretch.scale.y = Math.max(0.01, m);
    this.stretch.position.y = -BELRA_FOREARM - m / 2;
  }
}

export const belraPoses = {
  idle(t: number): Pose {
    const b = Math.sin(t * 1.3);
    return {
      joints: {
        chest: [0.05 * b, 0, 0], head: [0, Math.sin(t * 0.5) * 0.25, 0],
        shoulderL: [-0.15 + b * 0.04, 0, 0.12], elbowL: [-0.3, 0, 0],
        shoulderR: [-0.15 + b * 0.04, 0, -0.12], elbowR: [-0.3, 0, 0],
        hipL: [-0.1, 0, 0], kneeL: [0.25, 0, 0], hipR: [-0.1, 0, 0], kneeR: [0.25, 0, 0],
      },
      lift: -0.08 + b * 0.02,
    };
  },
  walk(phase: number, intensity = 1): Pose {
    const s = Math.sin(phase) * intensity;
    const c = Math.cos(phase);
    return {
      joints: {
        chest: [0, s * 0.18, s * 0.06],
        hipL: [-s * 0.4, 0, 0], kneeL: [0.25 + Math.max(0, c) * 0.5 * intensity, 0, 0],
        hipR: [s * 0.4, 0, 0], kneeR: [0.25 + Math.max(0, -c) * 0.5 * intensity, 0, 0],
        shoulderL: [s * 0.35 - 0.2, 0, 0.15], elbowL: [-0.35, 0, 0],
        shoulderR: [-s * 0.35 - 0.2, 0, -0.15], elbowR: [-0.35, 0, 0],
      },
      lift: Math.abs(c) * 0.08 * intensity - 0.08,
    };
  },
  /** Drawing the right fist back for the punch (k 0..1). */
  punchWindup(k: number): Pose {
    const e = ease(k);
    return {
      joints: {
        spine: [0.1, -0.4 * e, 0], chest: [0, -0.25 * e, 0],
        shoulderR: [0.8 * e, 0, -0.5 * e], elbowR: [-1.2 * e, 0, 0],
        shoulderL: [-0.9 * e, 0, 0.4], elbowL: [-0.6, 0, 0],
        hipL: [-0.4 * e, 0, 0], kneeL: [0.5 * e, 0, 0], hipR: [0.2 * e, 0, 0], kneeR: [0.3, 0, 0],
      },
      lift: -0.15 * e,
    };
  },
  /** The punch: the right arm straight out in front. */
  punch(): Pose {
    return {
      joints: {
        spine: [0.35, 0.15, 0], chest: [0, 0.1, 0],
        shoulderR: [-1.75, 0, 0.12], elbowR: [0, 0, 0],
        shoulderL: [0.3, 0, 0.4], elbowL: [-0.5, 0, 0],
        hipL: [-0.6, 0, 0], kneeL: [0.6, 0, 0], hipR: [0.3, 0, 0], kneeR: [0.2, 0, 0],
      },
      lift: -0.2,
    };
  },
  /** Both arms raised for the slam (k 0..1). */
  slamWindup(k: number): Pose {
    const e = ease(k);
    return {
      joints: {
        spine: [-0.45 * e, 0, 0], head: [-0.3 * e, 0, 0],
        shoulderL: [-2.7 * e, 0, 0.3 * e], elbowL: [-0.5 * e, 0, 0],
        shoulderR: [-2.7 * e, 0, -0.3 * e], elbowR: [-0.5 * e, 0, 0],
        kneeL: [0.4 * e, 0, 0], kneeR: [0.4 * e, 0, 0],
      },
      lift: 0.05 * e,
    };
  },
  slam(): Pose {
    return {
      joints: {
        spine: [0.75, 0, 0], head: [0.2, 0, 0],
        shoulderL: [-1.1, 0, 0.1], elbowL: [-0.1, 0, 0],
        shoulderR: [-1.1, 0, -0.1], elbowR: [-0.1, 0, 0],
        hipL: [-0.7, 0, 0], kneeL: [0.9, 0, 0], hipR: [-0.7, 0, 0], kneeR: [0.9, 0, 0],
      },
      lift: -0.35,
    };
  },
  hurt(): Pose {
    return {
      joints: {
        spine: [-0.25, 0, 0], head: [-0.3, 0, 0],
        shoulderL: [0.3, 0, 0.5], shoulderR: [0.3, 0, -0.5], elbowL: [-0.4, 0, 0], elbowR: [-0.4, 0, 0],
      },
    };
  },
};

// ------------------------------------------------------------ Chaos Bringer

/** A centaur: the Rig's hip / knee joints drive the front legs, the model swings the back pair itself. */
export class BringerModel {
  readonly rig = new Rig();
  readonly core: THREE.MeshStandardMaterial;
  readonly eyes: THREE.MeshStandardMaterial;
  private back: { hip: THREE.Group; knee: THREE.Group; side: number }[] = [];

  constructor(color = 0x2a2a3a) {
    const j = this.rig.joints;
    const hide = mat(color, { rough: 0.5 });
    const plate = mat(new THREE.Color(color).lerp(new THREE.Color(0x8a7aa8), 0.35).getHex(), { rough: 0.4 });
    const bone = mat(0xe0d6c8, { rough: 0.5 });
    const gold = mat(GOLD, { rough: 0.35 });
    this.core = glow(0xff3070, 1.4);
    this.eyes = glow(0xff4040, 2);
    this.rig.tintable.push(hide);

    // Horse body: the hips joint is its middle.
    j.hips.position.y = 1.55;
    this.rig.root.add(j.hips);
    part(j.hips, new THREE.CapsuleGeometry(0.62, 1.5, 4, 8).rotateX(Math.PI / 2), hide, [0, 0, -0.1]);
    part(j.hips, new THREE.BoxGeometry(1.0, 0.25, 1.7), plate, [0, 0.5, -0.1]); // armoured back
    for (let i = 0; i < 3; i++) part(j.hips, new THREE.ConeGeometry(0.1, 0.4, 4), bone, [0, 0.75, -0.7 + i * 0.5], [-0.4, 0, 0]);
    // Front legs on the rig.
    for (const [hip, knee, s] of [[j.hipL, j.kneeL, 1], [j.hipR, j.kneeR, -1]] as const) {
      hip.position.set(s * 0.38, -0.2, 0.75);
      j.hips.add(hip);
      part(hip, limbGeo(0.2, 0.15, 0.72), hide);
      knee.position.y = -0.72;
      hip.add(knee);
      part(knee, new THREE.SphereGeometry(0.13, 6, 4), plate);
      part(knee, limbGeo(0.13, 0.1, 0.62), plate);
      part(knee, new THREE.CylinderGeometry(0.16, 0.2, 0.16, 6), bone, [0, -0.66, 0]);
    }
    // Back legs, posed by the model.
    for (const s of [1, -1]) {
      const hip = new THREE.Group();
      hip.position.set(s * 0.38, -0.15, -0.95);
      j.hips.add(hip);
      part(hip, limbGeo(0.24, 0.16, 0.72), hide);
      const knee = new THREE.Group();
      knee.position.y = -0.72;
      knee.rotation.x = -0.35;
      hip.add(knee);
      part(knee, new THREE.SphereGeometry(0.14, 6, 4), plate);
      part(knee, limbGeo(0.13, 0.1, 0.66), plate);
      part(knee, new THREE.CylinderGeometry(0.16, 0.2, 0.16, 6), bone, [0, -0.7, 0]);
      this.back.push({ hip, knee, side: s });
    }
    // A whip of a tail.
    j.tail.position.set(0, 0.25, -1.55);
    j.hips.add(j.tail);
    part(j.tail, new THREE.ConeGeometry(0.12, 1.1, 5), hide, [0, -0.35, -0.3], [-2.4, 0, 0]);

    // The upper body rises from the front of the horse body.
    j.spine.position.set(0, 0.45, 0.85);
    j.spine.rotation.x = -0.15;
    j.hips.add(j.spine);
    part(j.spine, new THREE.CylinderGeometry(0.36, 0.48, 0.6, 7), hide, [0, 0.3, 0]);
    j.chest.position.y = 0.6;
    j.spine.add(j.chest);
    part(j.chest, new THREE.CylinderGeometry(0.62, 0.38, 0.8, 7), plate, [0, 0.38, 0]);
    // The chest laser: a big glowing eye set in plates.
    part(j.chest, new THREE.SphereGeometry(0.24, 10, 8), this.core, [0, 0.4, 0.42]);
    part(j.chest, new THREE.TorusGeometry(0.3, 0.06, 5, 12), gold, [0, 0.4, 0.44]);
    for (let i = 0; i < 3; i++) part(j.chest, new THREE.ConeGeometry(0.1, 0.5, 4), bone, [(i - 1) * 0.35, 0.95, -0.25], [-0.7, 0, (i - 1) * 0.4]);
    j.head.position.y = 0.92;
    j.chest.add(j.head);
    part(j.head, new THREE.ConeGeometry(0.22, 0.5, 6), plate, [0, 0.1, 0.05], [Math.PI, 0, 0]);
    for (const s of [1, -1]) {
      part(j.head, new THREE.OctahedronGeometry(0.05), this.eyes, [s * 0.08, 0.15, 0.18]);
      part(j.head, new THREE.ConeGeometry(0.06, 0.7, 5), bone, [s * 0.22, 0.4, -0.05], [-0.3, 0, -s * 0.6]);
    }
    for (const [sh, el, hand, s] of [[j.shoulderL, j.elbowL, j.handL, 1], [j.shoulderR, j.elbowR, j.handR, -1]] as const) {
      sh.position.set(s * 0.7, 0.62, 0);
      j.chest.add(sh);
      part(sh, new THREE.DodecahedronGeometry(0.26, 0), plate);
      part(sh, limbGeo(0.14, 0.12, 0.6), hide);
      el.position.y = -0.6;
      sh.add(el);
      part(el, limbGeo(0.13, 0.11, 0.55), plate);
      hand.position.y = -0.55;
      el.add(hand);
      // A scythe blade along each forearm.
      part(hand, new THREE.BoxGeometry(0.04, 0.9, 0.18), bone, [s * 0.06, -0.3, 0.12], [0.3, 0, 0]);
    }

    this.rig.finalize();
  }

  /** Swing the back legs: a gallop (phase, amount 0..1), or tucked while rearing (rear 0..1). */
  legs(phase: number, amount: number, rear: number): void {
    for (const b of this.back) {
      const s = Math.sin(phase + (b.side > 0 ? Math.PI : 0)) * amount;
      b.hip.rotation.x = s * 0.6 + rear * 0.5;
      b.knee.rotation.x = -0.35 - Math.max(0, -s) * 0.8 - rear * 0.4;
    }
  }
}

export const bringerPoses = {
  idle(t: number): Pose {
    const b = Math.sin(t * 1.5);
    return {
      joints: {
        chest: [0.04 * b, 0, 0], head: [0, Math.sin(t * 0.6) * 0.3, 0],
        shoulderL: [-0.3, 0, 0.3], elbowL: [-0.8, 0, 0], shoulderR: [-0.3, 0, -0.3], elbowR: [-0.8, 0, 0],
        tail: [0.2 * b, 0.3 * Math.sin(t * 0.9), 0],
      },
      lift: b * 0.02,
    };
  },
  gallop(phase: number, amount = 1): Pose {
    const s = Math.sin(phase) * amount;
    const c = Math.cos(phase);
    return {
      joints: {
        hipL: [-s * 0.7, 0, 0], kneeL: [0.2 + Math.max(0, c) * 1.0 * amount, 0, 0],
        hipR: [s * 0.7, 0, 0], kneeR: [0.2 + Math.max(0, -c) * 1.0 * amount, 0, 0],
        spine: [0.2 * amount, 0, 0], chest: [0.05 * s, 0, 0],
        shoulderL: [0.6 * amount, 0, 0.4], elbowL: [-0.4, 0, 0], shoulderR: [0.6 * amount, 0, -0.4], elbowR: [-0.4, 0, 0],
        tail: [0.8 * amount, 0, 0],
      },
      lift: Math.abs(c) * 0.1 * amount,
    };
  },
  /** Rearing up on the back legs (k 0..1): before a charge or a stomp. */
  rear(k: number): Pose {
    const e = ease(k);
    return {
      joints: {
        hips: [-0.45 * e, 0, 0],
        hipL: [-1.3 * e, 0, 0], kneeL: [1.6 * e, 0, 0], hipR: [-1.1 * e, 0, 0], kneeR: [1.5 * e, 0, 0],
        spine: [0.25 * e, 0, 0], head: [-0.3 * e, 0, 0],
        shoulderL: [-2.5 * e, 0, 0.5], elbowL: [-0.3, 0, 0], shoulderR: [-2.5 * e, 0, -0.5], elbowR: [-0.3, 0, 0],
        tail: [0.6 * e, 0, 0],
      },
      lift: 0.25 * e,
    };
  },
  /** Charging: head down, arms swept back. */
  charge(phase: number): Pose {
    const p = bringerPoses.gallop(phase, 1.2);
    return {
      joints: { ...p.joints, spine: [0.55, 0, 0], head: [-0.4, 0, 0], shoulderL: [1.0, 0, 0.6], shoulderR: [1.0, 0, -0.6] },
      lift: p.lift,
    };
  },
  /** Opening the chest for the lasers (k 0..1): arms spread wide, leaning back. */
  laser(k: number): Pose {
    const e = ease(k);
    return {
      joints: {
        spine: [-0.3 * e, 0, 0], chest: [-0.15 * e, 0, 0], head: [-0.2 * e, 0, 0],
        shoulderL: [-0.4, 0, 1.5 * e], elbowL: [-0.4, 0, 0], shoulderR: [-0.4, 0, -1.5 * e], elbowR: [-0.4, 0, 0],
      },
    };
  },
  stomp(): Pose {
    return {
      joints: {
        hips: [0.15, 0, 0],
        hipL: [0.2, 0, 0], kneeL: [0.1, 0, 0], hipR: [0.2, 0, 0], kneeR: [0.1, 0, 0],
        spine: [0.5, 0, 0], shoulderL: [-1.2, 0, 0.3], shoulderR: [-1.2, 0, -0.3],
      },
      lift: -0.15,
    };
  },
  hurt(): Pose {
    return {
      joints: {
        hips: [-0.15, 0, 0], spine: [-0.3, 0, 0], head: [-0.4, 0, 0],
        shoulderL: [0.3, 0, 0.9], shoulderR: [0.3, 0, -0.9],
      },
    };
  },
};

// ----------------------------------------------------------------- Darvant

/** One of Dark Falz's Darvants: a spiked dark seed with membrane wings and a glowing eye. */
export function darvantModel(color = 0x3a2a5a, eye = 0xff4ad0): THREE.Group {
  const g = new THREE.Group();
  const shell = mat(color, { rough: 0.35 });
  const eyeM = glow(eye, 1.8);
  const wing = new THREE.MeshStandardMaterial({ color: new THREE.Color(color).lerp(new THREE.Color(eye), 0.3), transparent: true, opacity: 0.75, side: THREE.DoubleSide, flatShading: true });
  part(g, new THREE.OctahedronGeometry(0.32, 0), shell, [0, 0, 0], [0, 0, 0], [1, 0.8, 1.4]);
  part(g, new THREE.SphereGeometry(0.09, 6, 4), eyeM, [0, 0.02, 0.36]);
  for (const [x, y, z, rx, rz] of [[0, 0.3, -0.1, -0.6, 0], [0, -0.3, -0.1, 0.6 + Math.PI, 0], [0, 0, -0.45, -Math.PI / 2, 0]] as const) {
    part(g, new THREE.ConeGeometry(0.06, 0.4, 4), shell, [x, y, z], [rx, 0, rz]);
  }
  for (const s of [1, -1]) {
    const w = new THREE.Mesh(new THREE.ShapeGeometry(wingShape()), wing);
    w.position.set(s * 0.18, 0.05, -0.05);
    w.rotation.set(-Math.PI / 2, 0, s > 0 ? 0 : Math.PI);
    w.scale.set(s > 0 ? 1 : 1, 1, 1);
    w.name = s > 0 ? 'wingL' : 'wingR';
    g.add(w);
  }
  return g;
}

function wingShape(): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.lineTo(0.7, 0.15);
  s.lineTo(0.55, -0.1);
  s.lineTo(0.75, -0.3);
  s.lineTo(0.2, -0.25);
  s.lineTo(0, 0);
  return s;
}
