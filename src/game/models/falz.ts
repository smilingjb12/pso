import * as THREE from 'three';
import { glowTexture } from '../world/glow';
import { limbGeo, mat, part, Rig, type Pose } from './Rig';

// Dark Falz in its three forms: the husk (a crystal cocoon with a great eye, petals that open),
// Dark Falz itself (a tall winged demon with scythe arms) and the Angel (a radiant six-winged
// figure with a halo). Each form is its own model; the boss shows one at a time.

function glow(color: number, intensity = 1.4): THREE.MeshStandardMaterial {
  const m = mat(color, { emissive: color, emissiveIntensity: intensity });
  m.userData.glow = true;
  return m;
}

const ease = (k: number) => {
  const c = Math.max(0, Math.min(1, k));
  return c * c * (3 - 2 * c);
};

/** A soft additive sprite (eye glare, core light). */
function glare(color: number, size: number, opacity = 0.8): THREE.Sprite {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending }));
  s.scale.setScalar(size);
  return s;
}

// -------------------------------------------------------------------- Husk

export interface HuskPose {
  /** 0 closed .. 1 petals wide open (the weak point). */
  open: number;
  /** 0..1 charging an attack (the eye flares). */
  charge: number;
  time: number;
  flash: boolean;
  /** 0..1 cracking apart (the morph into Dark Falz). */
  shatter: number;
}

export class HuskModel {
  readonly root = new THREE.Group();
  private eyeMat: THREE.MeshStandardMaterial;
  private shell: THREE.MeshStandardMaterial;
  private petals: { pivot: THREE.Group; yaw: number }[] = [];
  private ring: THREE.Mesh;
  private ring2: THREE.Mesh;
  private tendrils: THREE.Group[] = [];
  private eyeGlare: THREE.Sprite;
  private body = new THREE.Group();

  constructor() {
    this.shell = mat(0x2a2040, { rough: 0.3 });
    const shellLight = mat(0x4a3a6a, { rough: 0.3 });
    const vein = glow(0xc050ff, 1.3);
    this.eyeMat = glow(0xff3060, 2);
    this.root.add(this.body);
    this.body.position.y = 3.4;
    // The eye.
    part(this.body, new THREE.SphereGeometry(0.85, 16, 12), this.eyeMat);
    part(this.body, new THREE.SphereGeometry(0.35, 10, 8), mat(0x100008), [0, 0, 0.62], [0, 0, 0], [1, 1.5, 0.5]);
    this.eyeGlare = glare(0xff4080, 4, 0.5);
    this.body.add(this.eyeGlare);
    // Six crystal petals closing around it.
    for (let i = 0; i < 6; i++) {
      const yaw = (i / 6) * Math.PI * 2;
      const pivot = new THREE.Group();
      pivot.position.set(Math.sin(yaw) * 0.5, -1.2, Math.cos(yaw) * 0.5);
      pivot.rotation.y = yaw;
      this.body.add(pivot);
      const petal = part(pivot, new THREE.OctahedronGeometry(1, 0), i % 2 ? this.shell : shellLight, [0, 1.25, 0.35], [0, 0, 0], [0.55, 1.6, 0.3]);
      petal.rotation.x = -0.25;
      part(pivot, new THREE.BoxGeometry(0.06, 1.8, 0.04), vein, [0, 1.2, 0.55], [-0.28, 0, 0]);
      this.petals.push({ pivot, yaw });
    }
    // Spikes underneath and dark tendrils hanging to the altar.
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      part(this.body, new THREE.ConeGeometry(0.18, 1.4, 5), this.shell, [Math.sin(a) * 0.9, -1.7, Math.cos(a) * 0.9], [Math.PI + Math.cos(a) * 0.5, 0, -Math.sin(a) * 0.5]);
      const t = new THREE.Group();
      t.position.set(Math.sin(a + 0.3) * 0.7, -1.6, Math.cos(a + 0.3) * 0.7);
      this.body.add(t);
      part(t, limbGeo(0.09, 0.03, 1.8, 5), this.shell);
      this.tendrils.push(t);
    }
    // Rune rings turning around it.
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.06, 6, 48), vein);
    this.ring2 = new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.04, 6, 48), vein);
    this.body.add(this.ring, this.ring2);
  }

  pose(p: HuskPose): void {
    const o = ease(p.open);
    this.body.position.y = 3.4 + Math.sin(p.time * 0.9) * 0.15;
    this.body.rotation.y = p.time * 0.15;
    for (const { pivot } of this.petals) pivot.rotation.x = 0.9 * o + p.shatter * 1.6;
    this.ring.rotation.set(Math.PI / 2 + Math.sin(p.time * 0.5) * 0.3, p.time * 0.6, 0);
    this.ring2.rotation.set(Math.PI / 2 + Math.cos(p.time * 0.4) * 0.4, -p.time * 0.4, 0.3);
    this.tendrils.forEach((t, i) => (t.rotation.set(Math.sin(p.time * 1.3 + i) * 0.25, 0, Math.cos(p.time * 1.1 + i) * 0.25)));
    this.eyeMat.emissiveIntensity = p.flash ? 5 : 1.6 + p.charge * 2.5 + o * 1.5;
    (this.eyeGlare.material as THREE.SpriteMaterial).opacity = 0.35 + p.charge * 0.4 + o * 0.3;
    this.root.scale.setScalar(1 - ease(p.shatter) * 0.25);
    this.root.visible = p.shatter < 1;
  }
}

// ---------------------------------------------------------------- Dark Falz

export class FalzModel {
  readonly rig = new Rig();
  readonly core: THREE.MeshStandardMaterial;
  readonly eyes: THREE.MeshStandardMaterial;
  private wings: THREE.Group[] = [];

  constructor() {
    const j = this.rig.joints;
    const hide = mat(0x1e1a2c, { rough: 0.35 });
    const plate = mat(0x3a2e54, { rough: 0.3 });
    const bone = mat(0xe8e0d0, { rough: 0.45 });
    const cloak = mat(0x14101e, { rough: 0.8 });
    const vein = glow(0xb040ff, 1.2);
    this.core = glow(0xff2a6a, 1.8);
    this.eyes = glow(0xffd040, 2.4);
    this.rig.tintable.push(hide);

    // It floats: a tattered cloak below the waist instead of legs.
    j.hips.position.y = 2.1;
    this.rig.root.add(j.hips);
    part(j.hips, new THREE.CylinderGeometry(0.35, 0.95, 1.9, 9, 1, true), cloak, [0, -0.9, 0]);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      part(j.hips, new THREE.ConeGeometry(0.16, 0.7, 4), cloak, [Math.sin(a) * 0.85, -2.0, Math.cos(a) * 0.85], [Math.PI, 0, 0]);
    }
    part(j.hips, new THREE.TorusGeometry(0.4, 0.05, 5, 16), vein, [0, 0.05, 0], [Math.PI / 2, 0, 0]);

    j.spine.position.y = 0.1;
    j.hips.add(j.spine);
    part(j.spine, new THREE.CylinderGeometry(0.34, 0.3, 0.5, 7), hide, [0, 0.25, 0]);
    for (let i = 0; i < 3; i++) part(j.spine, new THREE.BoxGeometry(0.5 - i * 0.08, 0.05, 0.06), plate, [0, 0.1 + i * 0.13, 0.28]);
    j.chest.position.y = 0.5;
    j.spine.add(j.chest);
    part(j.chest, new THREE.CylinderGeometry(0.68, 0.38, 0.85, 7), hide, [0, 0.4, 0]);
    part(j.chest, new THREE.SphereGeometry(0.22, 10, 8), this.core, [0, 0.45, 0.48]);
    for (const s of [1, -1]) {
      part(j.chest, new THREE.BoxGeometry(0.4, 0.06, 0.06), vein, [s * 0.32, 0.55, 0.42], [0, 0, s * 0.5]);
      part(j.chest, new THREE.ConeGeometry(0.16, 0.9, 5), bone, [s * 0.62, 0.95, -0.1], [-0.2, 0, -s * 0.6]);
    }
    // Wings: tattered membranes on bone spars (flapped by the model).
    for (const s of [1, -1]) {
      const w = new THREE.Group();
      w.position.set(s * 0.3, 0.7, -0.35);
      j.chest.add(w);
      for (let i = 0; i < 4; i++) {
        const spar = part(w, limbGeo(0.05, 0.02, 2.4 - i * 0.3, 4), bone, [0, 0, 0], [0, 0, 0]);
        spar.rotation.set(0.3, 0, s * (1.1 + i * 0.35));
      }
      const membrane = new THREE.Mesh(
        new THREE.ShapeGeometry(wingShape()),
        new THREE.MeshStandardMaterial({ color: 0x3a1450, emissive: 0x200830, transparent: true, opacity: 0.8, side: THREE.DoubleSide, flatShading: true }),
      );
      membrane.scale.set(s * 2.3, 2.1, 1);
      membrane.rotation.y = 0.25 * s;
      w.add(membrane);
      this.wings.push(w);
    }
    j.head.position.y = 1.0;
    j.chest.add(j.head);
    part(j.head, new THREE.ConeGeometry(0.28, 0.62, 6), bone, [0, 0.12, 0.05], [Math.PI, 0, 0]);
    part(j.head, new THREE.SphereGeometry(0.24, 8, 6), hide, [0, 0.28, -0.04]);
    for (const s of [1, -1]) {
      part(j.head, new THREE.OctahedronGeometry(0.05), this.eyes, [s * 0.1, 0.22, 0.2]);
      part(j.head, new THREE.ConeGeometry(0.07, 1.0, 5), bone, [s * 0.24, 0.62, -0.15], [-0.45, 0, -s * 0.35]);
    }
    for (const [sh, el, hand, s] of [[j.shoulderL, j.elbowL, j.handL, 1], [j.shoulderR, j.elbowR, j.handR, -1]] as const) {
      sh.position.set(s * 0.82, 0.72, 0);
      j.chest.add(sh);
      part(sh, new THREE.DodecahedronGeometry(0.28, 0), plate);
      part(sh, limbGeo(0.15, 0.12, 0.85), hide);
      el.position.y = -0.85;
      sh.add(el);
      part(el, limbGeo(0.13, 0.1, 0.8), plate);
      hand.position.y = -0.8;
      el.add(hand);
      part(hand, new THREE.SphereGeometry(0.12, 6, 4), hide);
      // A long scythe blade curving forward from each wrist.
      part(hand, new THREE.BoxGeometry(0.05, 0.22, 1.5), bone, [0, -0.15, 0.72], [-0.25, 0, 0]);
      part(hand, new THREE.BoxGeometry(0.04, 0.08, 1.2), vein, [0, -0.06, 0.66], [-0.25, 0, 0]);
    }
    this.rig.finalize();
  }

  /** Beat the wings (beat 0..1 how hard) and fade it in or out (0 gone .. 1 solid, for teleports). */
  update(t: number, beat: number, presence: number): void {
    this.wings.forEach((w, i) => {
      const s = i === 0 ? 1 : -1;
      w.rotation.y = s * (0.35 + Math.sin(t * (2 + beat * 4)) * (0.15 + beat * 0.35));
      w.rotation.z = s * 0.15 * Math.sin(t * 1.2);
    });
    this.rig.root.scale.set(presence, Math.max(0.02, presence), presence);
    this.rig.root.visible = presence > 0.02;
  }
}

export const falzPoses = {
  idle(t: number): Pose {
    const b = Math.sin(t * 1.2);
    return {
      joints: {
        chest: [0.05 * b, 0, 0], head: [0, Math.sin(t * 0.5) * 0.3, 0],
        shoulderL: [-0.3, 0, 0.45 + b * 0.05], elbowL: [-0.8, 0, 0],
        shoulderR: [-0.3, 0, -0.45 - b * 0.05], elbowR: [-0.8, 0, 0],
      },
      lift: b * 0.12,
    };
  },
  /** Gliding toward you. */
  glide(lean: number): Pose {
    return {
      joints: {
        spine: [0.35 * lean, 0, 0], head: [-0.25 * lean, 0, 0],
        shoulderL: [0.6 * lean, 0, 0.5], elbowL: [-0.5, 0, 0], shoulderR: [0.6 * lean, 0, -0.5], elbowR: [-0.5, 0, 0],
      },
    };
  },
  /** Scythe drawn back over the right shoulder (k 0..1). */
  scytheWindup(k: number): Pose {
    const e = ease(k);
    return {
      joints: {
        spine: [-0.1 * e, -0.7 * e, 0], head: [0, 0.5 * e, 0],
        shoulderR: [-1.6 * e, 0, -1.2 * e], elbowR: [-0.6 * e, 0, 0],
        shoulderL: [-0.6 * e, 0, 0.8], elbowL: [-0.6, 0, 0],
      },
    };
  },
  /** The sweep: right scythe across the body. */
  scythe(): Pose {
    return {
      joints: {
        spine: [0.4, 0.8, 0], head: [0.1, -0.5, 0],
        shoulderR: [-1.6, 0, 1.0], elbowR: [-0.1, 0, 0],
        shoulderL: [0.3, 0, 0.9], elbowL: [-0.4, 0, 0],
      },
    };
  },
  /** Both arms up, calling something down (k 0..1). */
  cast(k: number): Pose {
    const e = ease(k);
    return {
      joints: {
        spine: [-0.25 * e, 0, 0], head: [-0.4 * e, 0, 0],
        shoulderL: [-2.7 * e, 0, 0.6], elbowL: [-0.2, 0, 0], shoulderR: [-2.7 * e, 0, -0.6], elbowR: [-0.2, 0, 0],
      },
    };
  },
  /** Arms thrown forward (Megid released). */
  release(): Pose {
    return {
      joints: {
        spine: [0.35, 0, 0],
        shoulderL: [-1.6, 0, 0.3], elbowL: [0, 0, 0], shoulderR: [-1.6, 0, -0.3], elbowR: [0, 0, 0],
      },
    };
  },
  /** Diving down onto the slam (scythes first). */
  slam(): Pose {
    return {
      joints: {
        spine: [0.9, 0, 0], head: [0.2, 0, 0],
        shoulderL: [-1.0, 0, 0.2], elbowL: [0, 0, 0], shoulderR: [-1.0, 0, -0.2], elbowR: [0, 0, 0],
      },
      lift: -0.6,
    };
  },
  hurt(): Pose {
    return {
      joints: {
        spine: [-0.4, 0, 0], head: [-0.5, 0, 0],
        shoulderL: [0.3, 0, 1.1], shoulderR: [0.3, 0, -1.1], elbowL: [-0.4, 0, 0], elbowR: [-0.4, 0, 0],
      },
    };
  },
};

function wingShape(): THREE.Shape {
  // Unit wing pointing along +X, scalloped trailing edge.
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.lineTo(0.55, 0.5);
  s.lineTo(1.0, 0.65);
  s.lineTo(0.92, 0.2);
  s.lineTo(0.78, 0.32);
  s.lineTo(0.7, -0.05);
  s.lineTo(0.52, 0.12);
  s.lineTo(0.42, -0.25);
  s.lineTo(0.25, -0.05);
  s.lineTo(0.12, -0.35);
  s.lineTo(0, 0);
  return s;
}

// ------------------------------------------------------------------- Angel

export interface AngelPose {
  /** 0..1 charging an attack (wings flare). */
  charge: number;
  /** 0..1 arms raised to cast. */
  cast: number;
  time: number;
  flash: boolean;
  /** 0 gone .. 1 fully formed (the morph in, the death out). */
  presence: number;
}

export class AngelModel {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private wings: { pivot: THREE.Group; base: number; side: number; tier: number }[] = [];
  private wingMat: THREE.MeshBasicMaterial;
  private halo: THREE.Mesh;
  private haloMat: THREE.MeshBasicMaterial;
  private skin: THREE.MeshStandardMaterial;
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private aura: THREE.Sprite;

  constructor() {
    this.skin = mat(0xf4ecdc, { rough: 0.35, emissive: 0x403020, emissiveIntensity: 0.6 });
    const robe = mat(0xfff6e8, { rough: 0.6, emissive: 0x302820, emissiveIntensity: 0.5 });
    const gold = mat(0xe8c060, { rough: 0.25, emissive: 0x402a00, emissiveIntensity: 0.6 });
    const gem = glow(0x80e8ff, 2);
    this.root.add(this.body);
    this.body.position.y = 1.8;
    // Flowing robe of light down to a point.
    part(this.body, new THREE.ConeGeometry(0.9, 2.8, 10, 1, true), robe, [0, -0.9, 0], [Math.PI, 0, 0]);
    part(this.body, new THREE.CylinderGeometry(0.42, 0.36, 0.9, 8), robe, [0, 0.95, 0]);
    part(this.body, new THREE.SphereGeometry(0.16, 10, 8), gem, [0, 1.1, 0.36]);
    for (const s of [1, -1]) part(this.body, new THREE.SphereGeometry(0.26, 8, 6), gold, [s * 0.5, 1.35, 0], [0, 0, 0], [1.2, 0.7, 1]);
    // Head: a smooth mask under a crown.
    part(this.body, new THREE.SphereGeometry(0.26, 12, 10), this.skin, [0, 1.85, 0.02], [0, 0, 0], [0.85, 1.15, 0.9]);
    for (let i = 0; i < 7; i++) {
      const a = ((i - 3) / 3) * 1.1;
      part(this.body, new THREE.ConeGeometry(0.035, 0.3 + (3 - Math.abs(i - 3)) * 0.06, 4), gold, [Math.sin(a) * 0.2, 2.15, Math.cos(a) * 0.12 - 0.05], [0, 0, -a * 0.5]);
    }
    // Arms (simple two-part limbs on pivots).
    for (const [arm, s] of [[this.armL, 1], [this.armR, -1]] as const) {
      arm.position.set(s * 0.55, 1.35, 0);
      this.body.add(arm);
      part(arm, limbGeo(0.09, 0.07, 0.7), this.skin);
      part(arm, new THREE.CylinderGeometry(0.1, 0.22, 0.6, 6, 1, true).translate(0, -0.55, 0), robe);
      part(arm, new THREE.SphereGeometry(0.08, 6, 4), gem, [0, -0.95, 0]);
    }
    // Six wings of light in three tiers.
    this.wingMat = new THREE.MeshBasicMaterial({ color: 0xfff0c0, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
    const feather = new THREE.ShapeGeometry(featherShape());
    for (let tier = 0; tier < 3; tier++) {
      for (const s of [1, -1]) {
        const pivot = new THREE.Group();
        pivot.position.set(s * 0.2, 1.3 - tier * 0.35, -0.3);
        this.body.add(pivot);
        const w = new THREE.Mesh(feather, this.wingMat);
        const len = 3.4 - tier * 0.7;
        w.scale.set(s * len, len * 0.42, 1);
        pivot.add(w);
        this.wings.push({ pivot, base: 0.35 - tier * 0.45, side: s, tier });
      }
    }
    // Halo behind the head.
    this.haloMat = new THREE.MeshBasicMaterial({ color: 0xffe8a0, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending });
    this.halo = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.06, 6, 40), this.haloMat);
    this.halo.position.set(0, 2.0, -0.35);
    this.body.add(this.halo);
    this.aura = glare(0xfff0c0, 7, 0.35);
    this.aura.position.y = 1;
    this.body.add(this.aura);
  }

  pose(p: AngelPose): void {
    const c = ease(p.charge);
    this.body.position.y = 1.8 + Math.sin(p.time * 0.8) * 0.2;
    this.body.rotation.y = Math.sin(p.time * 0.3) * 0.15;
    for (const w of this.wings) {
      const spread = 0.2 + c * 0.35 + Math.sin(p.time * 1.4 + w.tier) * 0.08;
      w.pivot.rotation.set(0, -w.side * (0.3 - c * 0.2), w.side * (w.base + spread));
    }
    const k = ease(p.cast);
    this.armL.rotation.set(-2.6 * k, 0, 0.5 + 0.2 * (1 - k));
    this.armR.rotation.set(-2.6 * k, 0, -0.5 - 0.2 * (1 - k));
    this.halo.rotation.z = p.time * 0.4;
    this.halo.scale.setScalar(1 + c * 0.25);
    this.wingMat.opacity = (0.45 + c * 0.35) * p.presence;
    this.haloMat.opacity = (0.75 + c * 0.25) * p.presence;
    (this.aura.material as THREE.SpriteMaterial).opacity = (0.25 + c * 0.35) * p.presence;
    this.skin.emissiveIntensity = p.flash ? 3 : 0.6;
    this.root.scale.setScalar(Math.max(0.02, 0.6 + 0.4 * p.presence));
    this.root.visible = p.presence > 0.02;
  }
}

function featherShape(): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.quadraticCurveTo(0.45, 0.6, 1.0, 0.35);
  s.lineTo(0.9, 0.15);
  s.lineTo(0.8, 0.22);
  s.lineTo(0.7, 0.02);
  s.lineTo(0.55, 0.1);
  s.lineTo(0.45, -0.12);
  s.quadraticCurveTo(0.2, -0.1, 0, 0);
  return s;
}
