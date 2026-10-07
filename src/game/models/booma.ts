import * as THREE from 'three';
import { limbGeo, mat, part, Rig, type Pose } from './Rig';

// Booma family: hunched, long-armed forest brutes with big claws and a pale
// belly. One rig for all three tiers; colour and scale differ.

export class BoomaModel {
  readonly rig = new Rig();
  readonly height = 2.0;

  constructor(fur: number, belly = 0xe8d8a8) {
    const j = this.rig.joints;
    const furM = mat(fur);
    const furDark = mat(new THREE.Color(fur).multiplyScalar(0.7).getHex());
    const bellyM = mat(belly);
    const claw = mat(0xf2efe6, { rough: 0.4 });
    const eye = mat(0xffe040, { emissive: 0xffc020, emissiveIntensity: 1.2 });
    eye.userData.glow = true;
    const mouth = mat(0x501010);
    this.rig.tintable.push(furM, furDark);

    // Short thick legs.
    j.hips.position.y = 0.72;
    this.rig.root.add(j.hips);
    part(j.hips, new THREE.SphereGeometry(0.34, 7, 5), furM, [0, 0.05, -0.05], [0, 0, 0], [1.1, 0.8, 0.9]);
    for (const [hip, knee, side] of [
      [j.hipL, j.kneeL, 1],
      [j.hipR, j.kneeR, -1],
    ] as const) {
      hip.position.set(side * 0.22, -0.05, 0);
      j.hips.add(hip);
      part(hip, limbGeo(0.16, 0.13, 0.36), furM);
      knee.position.y = -0.34;
      hip.add(knee);
      part(knee, limbGeo(0.13, 0.11, 0.3), furDark);
      part(knee, new THREE.BoxGeometry(0.22, 0.09, 0.3), furDark, [0, -0.33, 0.06]);
      for (const cx of [-0.06, 0, 0.06]) part(knee, new THREE.ConeGeometry(0.03, 0.1, 4), claw, [cx, -0.34, 0.23], [Math.PI / 2, 0, 0]);
    }

    // Barrel torso, hunched forward.
    j.spine.position.y = 0.1;
    j.spine.rotation.x = 0.35;
    j.hips.add(j.spine);
    part(j.spine, new THREE.SphereGeometry(0.5, 7, 6), furM, [0, 0.38, 0], [0, 0, 0], [1.05, 1.0, 0.85]);
    part(j.spine, new THREE.SphereGeometry(0.36, 6, 5), bellyM, [0, 0.3, 0.2], [0, 0, 0], [1, 1.1, 0.6]);
    j.chest.position.y = 0.62;
    j.spine.add(j.chest);
    part(j.chest, new THREE.SphereGeometry(0.42, 7, 5), furDark, [0, 0.05, -0.08], [0, 0, 0], [1.3, 0.75, 0.9]); // shoulder hump
    // Spiky ridge down the back.
    for (let i = 0; i < 4; i++) part(j.chest, new THREE.ConeGeometry(0.07, 0.22, 4), furDark, [0, 0.25 - i * 0.18, -0.38 + i * 0.05], [-0.9, 0, 0]);

    // Small head set low and forward.
    j.head.position.set(0, 0.1, 0.36);
    j.head.rotation.x = -0.35; // counter the hunch so it looks ahead
    j.chest.add(j.head);
    part(j.head, new THREE.IcosahedronGeometry(0.22, 0), furM, [0, 0.05, 0.05], [0, 0, 0], [1.1, 0.9, 1]);
    part(j.head, new THREE.BoxGeometry(0.2, 0.12, 0.16), bellyM, [0, -0.02, 0.2]); // snout
    part(j.head, new THREE.BoxGeometry(0.16, 0.04, 0.05), mouth, [0, -0.07, 0.27]);
    for (const sx of [-0.09, 0.09]) {
      part(j.head, new THREE.OctahedronGeometry(0.045), eye, [sx, 0.1, 0.2]);
      part(j.head, new THREE.ConeGeometry(0.06, 0.14, 4), furDark, [sx * 1.6, 0.24, -0.02], [0, 0, -sx * 3]);
    }

    // Long gorilla arms with heavy claws.
    for (const [sh, el, hand, side] of [
      [j.shoulderL, j.elbowL, j.handL, 1],
      [j.shoulderR, j.elbowR, j.handR, -1],
    ] as const) {
      sh.position.set(side * 0.55, 0.12, 0.08);
      sh.rotation.x = -0.35;
      j.chest.add(sh);
      part(sh, new THREE.SphereGeometry(0.17, 6, 4), furM);
      part(sh, limbGeo(0.14, 0.12, 0.48), furM);
      el.position.y = -0.46;
      sh.add(el);
      part(el, limbGeo(0.12, 0.16, 0.46), furDark);
      hand.position.y = -0.46;
      el.add(hand);
      part(hand, new THREE.BoxGeometry(0.24, 0.13, 0.24), furDark, [0, -0.05, 0.02]);
      for (const cx of [-0.08, 0, 0.08]) part(hand, new THREE.ConeGeometry(0.035, 0.2, 4), claw, [cx, -0.16, 0.12], [2.3, 0, 0]);
    }

    this.rig.finalize();
  }
}

export const boomaPoses = {
  idle(t: number): Pose {
    const b = Math.sin(t * 2.2);
    return {
      joints: {
        chest: [0.04 * b, 0, 0],
        head: [0, Math.sin(t * 0.7) * 0.25, 0],
        shoulderL: [-0.1 + b * 0.05, 0, 0.18],
        shoulderR: [-0.1 + b * 0.05, 0, -0.18],
        elbowL: [-0.3, 0, 0],
        elbowR: [-0.3, 0, 0],
      },
      lift: b * 0.02,
    };
  },

  walk(phase: number, intensity = 1): Pose {
    const s = Math.sin(phase) * intensity;
    const c = Math.cos(phase);
    return {
      joints: {
        spine: [0.08 * intensity, 0, 0],
        chest: [0, s * 0.15, s * 0.05],
        hipL: [-s * 0.55, 0, 0],
        hipR: [s * 0.55, 0, 0],
        kneeL: [0.15 + 0.5 * Math.max(0, c) * intensity, 0, 0],
        kneeR: [0.15 + 0.5 * Math.max(0, -c) * intensity, 0, 0],
        shoulderL: [s * 0.45 - 0.15, 0, 0.2],
        shoulderR: [-s * 0.45 - 0.15, 0, -0.2],
        elbowL: [-0.4, 0, 0],
        elbowR: [-0.4, 0, 0],
      },
      lift: Math.abs(c) * 0.06 * intensity,
    };
  },

  /** k: 0..1 windup progress. Arms rise high and back — the telegraph. */
  windup(k: number): Pose {
    const e = k * k * (3 - 2 * k);
    return {
      joints: {
        spine: [-0.4 * e, 0, 0],
        head: [-0.35 * e, 0, 0],
        shoulderL: [-2.6 * e, 0, 0.35 * e],
        shoulderR: [-2.6 * e, 0, -0.35 * e],
        elbowL: [-0.7 * e, 0, 0],
        elbowR: [-0.7 * e, 0, 0],
        hipL: [-0.2 * e, 0, 0],
        kneeL: [0.25 * e, 0, 0],
      },
      lift: -0.06 * e,
    };
  },

  strike(): Pose {
    return {
      joints: {
        spine: [0.55, 0, 0],
        head: [0.1, 0, 0],
        shoulderL: [-1.0, 0, 0.05],
        shoulderR: [-1.0, 0, -0.05],
        elbowL: [-0.1, 0, 0],
        elbowR: [-0.1, 0, 0],
        hipL: [-0.5, 0, 0],
        kneeL: [0.5, 0, 0],
        hipR: [0.3, 0, 0],
      },
      lift: -0.12,
    };
  },

  hurt(): Pose {
    return {
      joints: {
        spine: [-0.5, 0, 0],
        head: [-0.45, 0, 0],
        shoulderL: [0.4, 0, 0.7],
        shoulderR: [0.4, 0, -0.7],
        elbowL: [-0.5, 0, 0],
        elbowR: [-0.5, 0, 0],
      },
    };
  },

  crouch(): Pose {
    return { joints: { spine: [0.5, 0, 0], kneeL: [0.8, 0, 0], kneeR: [0.8, 0, 0], hipL: [-0.8, 0, 0], hipR: [-0.8, 0, 0] }, lift: -0.25 };
  },
};
