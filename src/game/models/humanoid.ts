import * as THREE from 'three';
import { limbGeo, mat, part, Rig, type Euler3, type JointName, type Pose } from './Rig';
import type { LegDims } from './gait';

// Low-poly humanoids in the spirit of PSO's Dreamcast character models:
// slim anime proportions, flat shading, saturated futuristic outfits.

export interface HumanoidStyle {
  build: 'male' | 'female';
  skin: number;
  hair: number;
  hairStyle: 'spiky' | 'short' | 'long' | 'bob' | 'hunewearl';
  eyes?: number;
  suit: number;
  trim: number;
  pants: number;
  boots: number;
  gloves: number;
  /** Bare thighs (leotard + shorts) instead of trousers. */
  bareLegs?: boolean;
  /** Bare upper arms (sleeveless). */
  bareArms?: boolean;
  /** Knee-high boots with a coloured sole/toe cap. */
  tallBoots?: { sole: number };
  /** Elbow-length gauntlets with a band near the elbow. */
  gauntlets?: { band: number };
  pads?: number;
  /** Tall shoulder plates (HUnewearl style). */
  plates?: { color: number; trim: number };
  /** Skirt of armour panels around the hips, open at the front. */
  tassets?: { color: number; stripe: number };
  /** Emblem on the upper chest. */
  emblem?: number;
  /** Choker / high collar colour. */
  collar?: number;
  hat?: 'ranger' | 'force' | 'cap';
  hatColor?: number;
  hatTrim?: number;
  /** Long coat tails (RAmar) or long dress (FOmarl). */
  skirt?: { color: number; length: number; flare: number };
}

export const STYLES = {
  // RAmarl: white leotard with crimson trim, tall shoulder plates, crimson
  // gauntlets, striped armour skirt, knee-high boots, red bob haircut.
  ranger: {
    build: 'female', skin: 0xf6dccb, hair: 0xc8343a, hairStyle: 'hunewearl', eyes: 0x8a1a22,
    suit: 0xf0f0f4, trim: 0x8c1a32, pants: 0x18181e, boots: 0x16161c, gloves: 0x8c1a32,
    bareLegs: true, bareArms: true, tallBoots: { sole: 0x56688c }, gauntlets: { band: 0xf0f0f4 },
    plates: { color: 0xf0f0f4, trim: 0x8c1a32 }, tassets: { color: 0x8c1a32, stripe: 0xf0f0f4 },
    emblem: 0x14141a, collar: 0x8c1a32,
  },
  // HUmar: navy long coat, white trim, wide cap with a gold band.
  hunter: {
    build: 'male', skin: 0xeec09a, hair: 0x2a2018, hairStyle: 'short', eyes: 0x2a3050,
    suit: 0x2c4fae, trim: 0xf0f0f0, pants: 0x1e2030, boots: 0x30303e, gloves: 0x23232e, collar: 0xf0f0f0,
    hat: 'ranger', hatColor: 0x1e3478, hatTrim: 0xe8c040, tallBoots: { sole: 0x5a5a6a },
    skirt: { color: 0x22408e, length: 0.62, flare: 0.07 },
  },
  // FOmarl: long blue dress, white top, huge wide-brimmed force hat, blonde hair.
  force: {
    build: 'female', skin: 0xf6d2b4, hair: 0xf2d27a, hairStyle: 'long', eyes: 0x2a5ab0,
    suit: 0xf4f4fa, trim: 0x3a76d8, pants: 0xf4f4fa, boots: 0x2e5cc8, gloves: 0xf4f4fa, collar: 0x3a76d8,
    hat: 'force', hatColor: 0x2e5cc8, hatTrim: 0xf4d060, gauntlets: { band: 0xf4d060 },
    skirt: { color: 0x2e5cc8, length: 0.82, flare: 0.16 },
  },
  shopkeeper: {
    build: 'male', skin: 0xe8b890, hair: 0x30241c, hairStyle: 'short',
    suit: 0x56677f, trim: 0xf0b040, pants: 0x2a3040, boots: 0x22252e, gloves: 0x56677f, hat: 'cap', hatColor: 0x405068, hatTrim: 0xf0b040,
  },
  armorer: {
    build: 'male', skin: 0xd8a882, hair: 0x101010, hairStyle: 'spiky',
    suit: 0x6a5a48, trim: 0x9fd0ff, pants: 0x3a3430, boots: 0x2a2420, gloves: 0x3a3430, pads: 0x8a8a92,
  },
  clerk: {
    build: 'female', skin: 0xf2caa8, hair: 0x8a3a20, hairStyle: 'bob',
    suit: 0x3a9a6a, trim: 0xf4f4f4, pants: 0x2a3a34, boots: 0x22302a, gloves: 0xf4f4f4, collar: 0xf4f4f4,
  },
  nurse: {
    build: 'female', skin: 0xf6d2b4, hair: 0xf0a0b8, hairStyle: 'bob',
    suit: 0xf8f8fc, trim: 0xff6aa0, pants: 0xf8f8fc, boots: 0xf0f0f4, gloves: 0xf8f8fc, hat: 'cap', hatColor: 0xf8f8fc, hatTrim: 0xff6aa0,
    skirt: { color: 0xf8f8fc, length: 0.45, flare: 0.08 },
  },
} satisfies Record<string, HumanoidStyle>;

export class Humanoid {
  readonly rig = new Rig();
  /** Weapon mount in the right hand; +Z points out of the fist. */
  readonly grip = new THREE.Group();
  readonly height: number;
  /** Leg geometry for IK-driven locomotion. */
  readonly legs: LegDims;

  constructor(readonly style: HumanoidStyle) {
    const f = style.build === 'female';
    const j = this.rig.joints;
    // A little self-light keeps faces from going grey under flat shading.
    const skin = mat(style.skin, { emissive: style.skin, emissiveIntensity: 0.22 });
    const suit = mat(style.suit);
    const trim = mat(style.trim);
    const pants = mat(style.pants);
    const boots = mat(style.boots);
    const gloves = mat(style.gloves);
    const hair = mat(style.hair);
    this.rig.tintable.push(suit, pants);

    // Slim, long-legged anime proportions.
    const thigh = f ? 0.44 : 0.45;
    const shin = f ? 0.44 : 0.45;
    const shoulderW = f ? 0.17 : 0.22;
    this.height = f ? 1.7 : 1.8;
    const hipWidth = f ? 0.085 : 0.095;
    // Hip pivots sit 0.05 below the hips joint; soles end ~0.055 below the shin.
    this.legs = { thigh, shin: shin + 0.055, hipWidth, restHipY: thigh + shin + 0.01 };

    // --- hips & legs
    j.hips.position.y = thigh + shin + 0.06;
    this.rig.root.add(j.hips);
    if (style.bareLegs) {
      // High-cut leotard over short shorts.
      part(j.hips, new THREE.CylinderGeometry(0.15, 0.16, 0.14, 7), pants, [0, -0.02, 0], [0, 0, 0], [1, 1, 0.72]);
      part(j.hips, new THREE.CylinderGeometry(0.13, 0.155, 0.12, 7), suit, [0, 0.07, 0], [0, 0, 0], [1, 1, 0.72]);
    } else {
      part(j.hips, new THREE.BoxGeometry(f ? 0.32 : 0.31, 0.16, 0.2), pants, [0, -0.02, 0]);
    }
    if (!style.tassets) part(j.hips, new THREE.BoxGeometry(f ? 0.33 : 0.33, 0.05, 0.215), trim, [0, 0.07, 0]); // belt
    for (const [hip, knee, side] of [
      [j.hipL, j.kneeL, 1],
      [j.hipR, j.kneeR, -1],
    ] as const) {
      hip.position.set(side * hipWidth, -0.05, 0);
      j.hips.add(hip);
      part(hip, limbGeo(f ? 0.08 : 0.084, f ? 0.058 : 0.064, thigh), style.bareLegs ? skin : pants);
      if (style.bareLegs) part(hip, limbGeo(0.08, 0.078, 0.07), pants, [0, 0.02, 0]); // shorts leg
      knee.position.y = -thigh;
      hip.add(knee);
      if (style.tallBoots) {
        // Knee-high boot with a flared cuff and a coloured sole / toe cap.
        part(knee, limbGeo(0.062, 0.045, shin - 0.06), boots, [0, 0.02, 0]);
        part(knee, new THREE.CylinderGeometry(0.075, 0.064, 0.07, 7), boots, [0, 0.03, 0.005], [-0.15, 0, 0]);
        part(knee, new THREE.BoxGeometry(0.095, 0.07, 0.2), boots, [0, -shin + 0.01, 0.045]);
        part(knee, new THREE.BoxGeometry(0.1, 0.035, 0.22), mat(style.tallBoots.sole), [0, -shin - 0.035, 0.05]);
        part(knee, new THREE.BoxGeometry(0.098, 0.05, 0.06), mat(style.tallBoots.sole), [0, -shin + 0.0, 0.13]);
      } else {
        part(knee, limbGeo(0.06, 0.05, shin - 0.08), pants);
        part(knee, limbGeo(0.07, 0.065, 0.2), boots, [0, -shin + 0.2, 0]);
        part(knee, new THREE.BoxGeometry(0.1, 0.08, 0.21), boots, [0, -shin - 0.02, 0.04]);
      }
    }
    if (style.tassets) this.buildTassets(j.hips, style.tassets);
    if (style.skirt) {
      const s = style.skirt;
      const g = new THREE.CylinderGeometry(f ? 0.16 : 0.17, 0.17 + s.flare, s.length, 7, 1, true).translate(0, -s.length / 2, 0);
      const skirtMat = mat(s.color);
      skirtMat.side = THREE.DoubleSide;
      this.rig.tintable.push(skirtMat);
      part(j.hips, g, skirtMat, [0, 0.06, -0.01]);
      part(j.hips, new THREE.CylinderGeometry(0.17 + s.flare + 0.005, 0.17 + s.flare + 0.005, 0.04, 7, 1, true).translate(0, -s.length + 0.08, 0), trim, [0, 0.06, -0.01]);
    }

    // --- torso: narrow waist, defined chest
    j.spine.position.y = 0.08;
    j.hips.add(j.spine);
    part(j.spine, new THREE.CylinderGeometry(f ? 0.11 : 0.14, f ? 0.13 : 0.145, 0.22, 7), suit, [0, 0.1, 0], [0, 0, 0], [1, 1, 0.72]);
    j.chest.position.y = 0.21;
    j.spine.add(j.chest);
    part(j.chest, new THREE.CylinderGeometry(f ? 0.17 : 0.23, f ? 0.12 : 0.15, 0.34, 7), suit, [0, 0.16, 0], [0, Math.PI / 7, 0], [1, 1, 0.66]);
    if (f) for (const sx of [-0.065, 0.065]) part(j.chest, new THREE.SphereGeometry(0.07, 6, 4), suit, [sx, 0.2, 0.065], [0, 0, 0], [1, 0.9, 0.85]);
    // Trim: side panels sweeping from the shoulders down to the waist.
    for (const sx of [-1, 1]) {
      part(j.chest, new THREE.BoxGeometry(0.022, 0.3, 0.19), trim, [sx * (f ? 0.135 : 0.19), 0.17, 0], [0, 0, sx * -0.16]);
      part(j.spine, new THREE.BoxGeometry(0.02, 0.2, 0.15), trim, [sx * (f ? 0.118 : 0.142), 0.11, 0], [0, 0, sx * 0.06]);
    }
    if (!style.plates && !style.emblem) part(j.chest, new THREE.BoxGeometry(0.06, 0.3, 0.05), trim, [0, 0.16, f ? 0.11 : 0.14]);
    if (style.emblem !== undefined) {
      part(j.chest, new THREE.CylinderGeometry(0.045, 0.045, 0.02, 8), trim, [0, 0.29, f ? 0.105 : 0.13], [Math.PI / 2, 0, 0], [1.4, 1, 0.8]);
      part(j.chest, new THREE.CylinderGeometry(0.032, 0.032, 0.025, 8), mat(style.emblem), [0, 0.29, f ? 0.112 : 0.137], [Math.PI / 2, 0, 0], [1.4, 1, 0.8]);
    }
    // Collar / choker.
    part(j.chest, new THREE.CylinderGeometry(0.07, 0.1, 0.08, 7), style.collar !== undefined ? mat(style.collar) : trim, [0, 0.36, 0]);

    // --- head
    j.head.position.y = 0.39;
    j.chest.add(j.head);
    part(j.head, limbGeo(0.045, 0.05, 0.09).translate(0, 0.09, 0), skin);
    const headY = 0.16;
    part(j.head, new THREE.IcosahedronGeometry(0.12, 1), skin, [0, headY, 0.01], [0, 0, 0], [0.92, 1.12, 1.0]);
    part(j.head, new THREE.ConeGeometry(0.075, 0.09, 6), skin, [0, headY - 0.085, 0.045], [Math.PI, 0, 0], [1, 1, 0.8]); // chin
    // Big anime eyes: white, coloured iris, highlight.
    const white = mat(0xf8f8ff);
    const iris = mat(style.eyes ?? 0x2a3040);
    const shine = mat(0xffffff, { emissive: 0xffffff, emissiveIntensity: 0.6 });
    for (const sx of [-0.045, 0.045]) {
      part(j.head, new THREE.BoxGeometry(0.04, 0.034, 0.01), white, [sx, headY + 0.005, 0.107]);
      part(j.head, new THREE.BoxGeometry(0.026, 0.034, 0.012), iris, [sx + Math.sign(sx) * -0.004, headY + 0.003, 0.11]);
      part(j.head, new THREE.BoxGeometry(0.009, 0.009, 0.012), shine, [sx - 0.006, headY + 0.012, 0.115]);
      part(j.head, new THREE.BoxGeometry(0.042, 0.007, 0.01), hair, [sx, headY + 0.034, 0.108], [0, 0, -Math.sign(sx) * 0.12]); // brow
    }
    part(j.head, new THREE.BoxGeometry(0.022, 0.005, 0.01), mat(0xb05a5a), [0, headY - 0.06, 0.1]); // mouth
    this.buildHair(j.head, hair, headY, style.hairStyle);
    if (style.hat) this.buildHat(j.head, headY, style);

    // --- arms
    for (const [sh, el, hand, side] of [
      [j.shoulderL, j.elbowL, j.handL, 1],
      [j.shoulderR, j.elbowR, j.handR, -1],
    ] as const) {
      sh.position.set(side * shoulderW, 0.29, 0);
      j.chest.add(sh);
      const upper = style.bareArms ? skin : suit;
      part(sh, new THREE.SphereGeometry(0.06, 6, 4), upper);
      part(sh, limbGeo(f ? 0.045 : 0.055, f ? 0.038 : 0.046, 0.27), upper);
      if (style.pads) part(sh, new THREE.BoxGeometry(0.15, 0.08, 0.16), mat(style.pads), [side * 0.03, 0.04, 0], [0, 0, side * -0.35]);
      if (style.plates) this.buildPlate(sh, side, style.plates);
      el.position.y = -0.27;
      sh.add(el);
      if (style.gauntlets) {
        part(el, limbGeo(0.05, 0.042, 0.25), gloves, [0, 0.01, 0]);
        part(el, new THREE.CylinderGeometry(0.056, 0.056, 0.04, 7), mat(style.gauntlets.band), [0, -0.05, 0]);
        part(el, new THREE.CylinderGeometry(0.05, 0.05, 0.025, 7), mat(style.gauntlets.band), [0, -0.1, 0]);
      } else {
        part(el, limbGeo(0.045, 0.04, 0.2), style.bareArms ? skin : suit);
        part(el, limbGeo(0.052, 0.05, 0.07), gloves, [0, -0.18, 0]); // cuff
      }
      hand.position.y = -0.26;
      el.add(hand);
      part(hand, new THREE.BoxGeometry(0.065, 0.09, 0.06), gloves, [0, -0.045, 0.005]);
      part(hand, new THREE.BoxGeometry(0.025, 0.05, 0.03), gloves, [side * -0.035, -0.03, 0.03]); // thumb
    }
    // Weapon grip: in the rest pose the weapon points forward and slightly down.
    this.grip.position.set(0, -0.065, 0.02);
    this.grip.rotation.x = 0.3;
    j.handR.add(this.grip);

    this.rig.finalize();
  }

  /** Tall white shoulder plate standing off the upper arm. */
  private buildPlate(sh: THREE.Object3D, side: number, p: { color: number; trim: number }): void {
    const c = mat(p.color);
    const t = mat(p.trim);
    const g = new THREE.Group();
    g.position.set(side * 0.085, -0.03, 0);
    g.rotation.z = side * 0.12;
    sh.add(g);
    part(g, new THREE.BoxGeometry(0.05, 0.26, 0.17), c, [0, 0, 0]);
    part(g, new THREE.BoxGeometry(0.055, 0.05, 0.175), t, [0, -0.1, 0]);
    part(g, new THREE.BoxGeometry(0.056, 0.015, 0.177), mat(0x1a1a22), [0, 0.06, 0]);
    part(g, new THREE.BoxGeometry(0.04, 0.06, 0.15), c, [0, 0.15, 0], [0, 0, side * -0.4]); // upturned top edge
  }

  /** Armour-panel skirt: crimson plates with white stripes, open at the front. */
  private buildTassets(hips: THREE.Object3D, t: { color: number; stripe: number }): void {
    const c = mat(t.color);
    const s = mat(t.stripe);
    part(hips, new THREE.CylinderGeometry(0.165, 0.165, 0.045, 8), c, [0, 0.07, 0], [0, 0, 0], [1, 1, 0.75]); // waistband
    // Panels from the hips round the back; none at the front centre.
    const angles = [-2.0, -1.35, -0.75, Math.PI, 0.75, 1.35, 2.0].map((a) => (a === Math.PI ? Math.PI : a + (a > 0 ? 0.35 : -0.35)));
    for (const a of angles) {
      const panel = new THREE.Group();
      panel.position.set(Math.sin(a) * 0.165, 0.06, Math.cos(a) * 0.125);
      panel.rotation.y = a;
      hips.add(panel);
      const tilt = new THREE.Group();
      tilt.rotation.x = -0.42; // flare outward
      panel.add(tilt);
      part(tilt, new THREE.BoxGeometry(0.13, 0.27, 0.02), c, [0, -0.135, 0]);
      part(tilt, new THREE.BoxGeometry(0.132, 0.02, 0.026), s, [0, -0.15, 0]);
      part(tilt, new THREE.BoxGeometry(0.132, 0.012, 0.026), s, [0, -0.2, 0]);
      part(tilt, new THREE.BoxGeometry(0.018, 0.27, 0.026), s, [0.035, -0.135, 0]);
    }
  }

  private buildHair(head: THREE.Object3D, hair: THREE.Material, y: number, styleName: HumanoidStyle['hairStyle']): void {
    // Cap covering the top/back of the head.
    part(head, new THREE.SphereGeometry(0.128, 7, 5, 0, Math.PI * 2, 0, Math.PI * 0.55), hair, [0, y + 0.025, -0.008], [-0.25, 0, 0]);
    if (styleName === 'spiky') {
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        part(head, new THREE.ConeGeometry(0.05, 0.16, 4), hair, [Math.sin(a) * 0.08, y + 0.1, Math.cos(a) * 0.06 - 0.04], [-0.9 * Math.cos(a) - 0.4, 0, 0.9 * Math.sin(a)]);
      }
    } else if (styleName === 'long') {
      part(head, new THREE.BoxGeometry(0.23, 0.42, 0.08), hair, [0, y - 0.18, -0.1], [0.12, 0, 0]);
      part(head, new THREE.BoxGeometry(0.06, 0.26, 0.06), hair, [0.115, y - 0.08, 0.02]);
      part(head, new THREE.BoxGeometry(0.06, 0.26, 0.06), hair, [-0.115, y - 0.08, 0.02]);
    } else if (styleName === 'bob') {
      part(head, new THREE.CylinderGeometry(0.135, 0.145, 0.16, 7), hair, [0, y - 0.04, -0.02], [0, 0, 0], [1, 1, 0.95]);
    } else if (styleName === 'hunewearl') {
      // Voluminous red bob: back volume, chin-length side locks, swept bangs.
      part(head, new THREE.SphereGeometry(0.13, 7, 5), hair, [0, y + 0.0, -0.075], [0, 0, 0], [1.08, 1.0, 0.9]);
      part(head, new THREE.CylinderGeometry(0.12, 0.145, 0.13, 7), hair, [0, y - 0.09, -0.08], [0.25, 0, 0], [1, 1, 0.85]);
      for (const sx of [-1, 1]) {
        part(head, new THREE.BoxGeometry(0.035, 0.19, 0.05), hair, [sx * 0.118, y - 0.05, 0.035], [0.1, 0, sx * 0.1]);
        part(head, new THREE.ConeGeometry(0.025, 0.07, 4), hair, [sx * 0.122, y - 0.175, 0.045], [Math.PI, 0, 0]);
      }
      // Bangs: short angled wedges along the hairline, clear of the eyes.
      [-0.07, -0.025, 0.025, 0.07].forEach((bx, i) =>
        part(head, new THREE.ConeGeometry(0.035, 0.085, 4), hair, [bx, y + 0.085, 0.095], [Math.PI - 0.7, 0, (i - 1.5) * 0.3]),
      );
      // A couple of spiky tips at the back, Dreamcast style.
      for (const sx of [-0.06, 0.06]) part(head, new THREE.ConeGeometry(0.04, 0.12, 4), hair, [sx, y - 0.14, -0.13], [2.3, 0, sx * 4]);
    }
  }

  private buildHat(head: THREE.Object3D, y: number, s: HumanoidStyle): void {
    const hc = mat(s.hatColor ?? 0x333333);
    const ht = mat(s.hatTrim ?? 0xcccccc);
    if (s.hat === 'ranger') {
      // Wide visor cap with a gold band.
      part(head, new THREE.CylinderGeometry(0.15, 0.145, 0.13, 7), hc, [0, y + 0.1, -0.01]);
      part(head, new THREE.CylinderGeometry(0.152, 0.152, 0.035, 7), ht, [0, y + 0.06, -0.01]);
      part(head, new THREE.CylinderGeometry(0.24, 0.24, 0.02, 8), hc, [0, y + 0.04, 0.05], [0, 0, 0], [1, 1, 1.1]);
    } else if (s.hat === 'force') {
      // Huge brim + tall pointed crown that bends back.
      part(head, new THREE.CylinderGeometry(0.4, 0.4, 0.025, 10), hc, [0, y + 0.07, 0]);
      part(head, new THREE.CylinderGeometry(0.155, 0.155, 0.05, 8), ht, [0, y + 0.1, 0]);
      part(head, new THREE.ConeGeometry(0.16, 0.42, 8), hc, [0, y + 0.3, -0.05], [-0.35, 0, 0]);
      part(head, new THREE.OctahedronGeometry(0.04), ht, [0, y + 0.5, -0.14]);
    } else {
      part(head, new THREE.CylinderGeometry(0.135, 0.14, 0.07, 7), hc, [0, y + 0.1, 0]);
      part(head, new THREE.BoxGeometry(0.16, 0.015, 0.1), ht, [0, y + 0.07, 0.13]);
    }
  }
}

// ---------------------------------------------------------------- poses

type P = Partial<Record<JointName, Euler3>>;

const DASH_FWD: P = {
  spine: [0.45, 0, 0],
  chest: [0.1, 0, 0],
  head: [-0.4, 0, 0],
  hipL: [-0.95, 0, 0],
  kneeL: [0.85, 0, 0],
  hipR: [0.55, 0, 0],
  kneeR: [0.75, 0, 0],
  shoulderL: [0.75, 0, 0.25],
  elbowL: [-0.35, 0, 0],
  shoulderR: [0.6, 0, -0.3],
  elbowR: [-0.5, 0, 0],
};
const DASH_BACK: P = {
  spine: [0.2, 0, 0],
  head: [-0.15, 0, 0],
  hipL: [0.55, 0, 0],
  kneeL: [0.35, 0, 0],
  hipR: [-0.7, 0, 0],
  kneeR: [1.2, 0, 0],
  shoulderL: [-0.55, 0, 0.55],
  elbowL: [-0.7, 0, 0],
  shoulderR: [-0.45, 0, -0.55],
  elbowR: [-0.7, 0, 0],
};
/** Skipping to her right: the right leg reaches out, the left pushes off, arms out for balance. */
const DASH_SIDE: P = {
  spine: [0.2, 0, -0.18],
  head: [-0.15, 0, 0.12],
  hipL: [-0.15, 0, 0.18],
  kneeL: [0.7, 0, 0],
  hipR: [-0.3, 0, -0.5],
  kneeR: [0.25, 0, 0],
  shoulderL: [-0.2, 0, 0.7],
  elbowL: [-0.5, 0, 0],
  shoulderR: [-0.2, 0, -0.75],
  elbowR: [-0.4, 0, 0],
};

/** Left-right mirror of a pose: swap L / R joints and flip their sideways rotations. */
function mirrorPose(a: P): P {
  const out: P = {};
  for (const k of Object.keys(a) as JointName[]) {
    const m = (k.endsWith('L') ? k.slice(0, -1) + 'R' : k.endsWith('R') ? k.slice(0, -1) + 'L' : k) as JointName;
    const v = a[k]!;
    out[m] = [v[0], -v[1], -v[2]];
  }
  return out;
}

export function lerpPose(a: P, b: P, t: number): P {
  const out: P = {};
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<JointName>;
  for (const k of keys) {
    const x = a[k] ?? [0, 0, 0];
    const y = b[k] ?? [0, 0, 0];
    out[k] = [x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t];
  }
  return out;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

export type Grip = 'melee' | 'gun' | 'rifle' | 'staff' | 'none';

export const humanPoses = {
  idle(t: number, grip: Grip): Pose {
    const b = Math.sin(t * 2);
    const j: P = {
      chest: [0.03 * b, 0, 0],
      head: [-0.02 * b, 0, 0],
      shoulderL: [0.05, 0, 0.12],
      elbowL: [-0.15, 0, 0],
      hipL: [0, 0, 0.04],
      hipR: [0, 0, -0.04],
    };
    if (grip === 'melee') Object.assign(j, { shoulderR: [-0.3, 0, -0.15], elbowR: [-0.75, 0, 0], handR: [0.85, 0, 0] });
    else if (grip === 'gun') Object.assign(j, { shoulderR: [-0.2, 0, -0.1], elbowR: [-1.0, 0, 0], handR: [0.6, 0, 0] });
    else if (grip === 'rifle')
      Object.assign(j, { shoulderR: [-0.3, 0, -0.05], elbowR: [-1.2, 0, 0], handR: [0.9, 0.3, 0], shoulderL: [-0.4, 0, -0.35], elbowL: [-1.1, 0, 0] });
    else if (grip === 'staff') Object.assign(j, { shoulderR: [-0.15, 0, -0.12], elbowR: [-0.5, 0, 0], handR: [-1.2, 0, 0] });
    else Object.assign(j, { shoulderR: [0.05, 0, -0.12], elbowR: [-0.15, 0, 0] });
    return { joints: j, lift: 0.005 * b };
  },

  /**
   * Jog cycle. The whole body moves: hips twist with the legs, shoulders
   * counter-rotate, the torso bobs (lowest on foot contact) and sways over the
   * planted leg, arms pump with bent elbows. The feminine variant is lighter:
   * more hip sway, upright posture, a narrow stride with feet landing toward
   * the midline, a heel flick, and arms carried close with relaxed wrists.
   */
  run(phase: number, grip: Grip, feminine = false): Pose {
    const s = Math.sin(phase);
    const c = Math.cos(phase);
    const bounce = Math.abs(c); // 1 mid-flight, 0 at foot contact
    const f = feminine;
    const j: P = f
      ? {
          hips: [0, s * 0.12, -s * 0.13],
          spine: [0.08 + bounce * 0.03, -s * 0.05, s * 0.09],
          chest: [-0.02, -s * 0.09, -s * 0.03],
          head: [-0.06, s * 0.03, s * 0.04],
          hipL: [-s * 0.62 - 0.08, 0, -0.06],
          hipR: [s * 0.62 - 0.08, 0, 0.06],
          // Light heel flick behind on the recovering leg.
          kneeL: [0.2 + 1.45 * Math.max(0, c) + 0.15 * Math.max(0, -s), 0, 0],
          kneeR: [0.2 + 1.45 * Math.max(0, -c) + 0.15 * Math.max(0, s), 0, 0],
          shoulderL: [s * 0.45 - 0.1, 0.25, 0.1],
          elbowL: [-1.55, 0, 0],
          handL: [0.3, 0, 0.35],
        }
      : {
          hips: [0, s * 0.2, -s * 0.06],
          spine: [0.2 + bounce * 0.05, -s * 0.12, s * 0.05],
          chest: [0.02 - bounce * 0.04, -s * 0.22, 0],
          head: [-0.18, s * 0.14, 0], // cancels the net torso twist so the head faces ahead
          hipL: [-s * 0.7 - 0.1, 0, 0.03],
          hipR: [s * 0.7 - 0.1, 0, -0.03],
          // The leg swinging forward tucks its knee high; the planted one stays straighter.
          kneeL: [0.25 + 1.25 * Math.max(0, c) + 0.2 * Math.max(0, -s), 0, 0],
          kneeR: [0.25 + 1.25 * Math.max(0, -c) + 0.2 * Math.max(0, s), 0, 0],
          shoulderL: [s * 0.85 - 0.15, 0, 0.18],
          elbowL: [-1.35 - Math.max(0, -s) * 0.3, 0, 0],
          handL: [0.2, 0, 0],
        };
    const swing = f ? 0.4 : 0.55;
    if (grip === 'melee') Object.assign(j, { shoulderR: [-s * swing - 0.35, 0, -0.18], elbowR: [-1.15, 0, 0], handR: [1.0, 0, 0] });
    else if (grip === 'gun') Object.assign(j, { shoulderR: [-s * swing - 0.3, 0, -0.15], elbowR: [-1.3, 0, 0], handR: [1.0, 0, 0] });
    else if (grip === 'rifle')
      Object.assign(j, { shoulderR: [-0.45 - s * 0.15, 0, -0.1], elbowR: [-1.3, 0, 0], handR: [0.95, 0.25, 0], shoulderL: [-0.5 + s * 0.1, 0, -0.3], elbowL: [-1.2, 0, 0], handL: [0, 0, 0] });
    else if (grip === 'staff') Object.assign(j, { shoulderR: [-s * swing - 0.15, 0, -0.15], elbowR: [-1.0, 0, 0], handR: [-1.2, 0, 0] });
    else if (f) Object.assign(j, { shoulderR: [-s * 0.45 - 0.1, -0.25, -0.1], elbowR: [-1.55, 0, 0], handR: [0.3, 0, -0.35] });
    else Object.assign(j, { shoulderR: [-s * 0.85 - 0.15, 0, -0.18], elbowR: [-1.35 - Math.max(0, s) * 0.3, 0, 0], handR: [0.2, 0, 0] });
    return { joints: j, lift: f ? -0.045 + bounce * 0.055 : -0.06 + bounce * 0.075 };
  },

  /** k: 0..1 through the swing, impact: where the blow lands. */
  slash(hitIndex: number, k: number, impact: number): Pose {
    return keyedSlash(SLASH_KEYS, SLASH_READY, hitIndex, k, impact);
  },

  /** Spear thrust (partisans): draw back, then lunge the point straight ahead. */
  thrust(hitIndex: number, k: number, impact: number): Pose {
    const lunge = hitIndex === 2 ? 1.3 : 1;
    let pose: P;
    if (k < impact - 0.06) {
      pose = lerpPose(SLASH_READY, THRUST_WINDUP, smooth(Math.min(1, k / Math.max(0.01, impact - 0.06))));
    } else {
      const u = smooth(Math.min(1, (k - (impact - 0.06)) / 0.14));
      pose = lerpPose(THRUST_WINDUP, THRUST_END, u * lunge);
    }
    return { joints: pose, lift: -0.04 };
  },

  shoot(k: number, impact: number, grip: Grip): Pose {
    const recoil = k > impact ? Math.max(0, 1 - (k - impact) * 5) * 0.3 : 0;
    const j: P = {
      chest: [0, -0.15, 0],
      shoulderR: [-1.5 + recoil, 0, -0.05],
      elbowR: [-0.05, 0, 0],
      handR: [1.25 - recoil * 0.5, 0, 0],
      shoulderL: [0.05, 0, 0.15],
      hipL: [-0.2, 0, 0],
      hipR: [0.15, 0, 0],
    };
    if (grip === 'rifle') Object.assign(j, { shoulderL: [-1.3, 0, -0.55], elbowL: [-0.5, 0, 0] });
    return { joints: j };
  },

  /**
   * Attack-tech cast chain, one move per chain step like the slash keys: the staff raised
   * skyward, a left-to-right staff sweep, then a two-handed overhead gather driven forward.
   * k: 0..1 through the cast, impact: where the tech fires.
   */
  castChain(hitIndex: number, k: number, impact: number): Pose {
    const keys = CAST_KEYS[hitIndex % 3];
    // The move finishes just ahead of the fire frame (the rig's smoothing trails the target
    // by a few frames, so the body lands right as the tech goes off), then holds until the cast ends.
    const start = impact - 0.05 - keys.sweep;
    if (k < start) {
      // Gather power: settle into the windup, then hold it.
      return { joints: lerpPose(CAST_READY, keys.windup, smooth(Math.min(1, k / (start * 0.7)))) };
    }
    const u = smooth(Math.min(1, (k - start) / keys.sweep));
    return { joints: lerpPose(keys.windup, keys.release, u), lift: keys.lift * u };
  },

  /** Support casts (heal / buff): both arms raised, then pushed out. */
  cast(k: number): Pose {
    const thrust = k > 0.75 ? (k - 0.75) * 4 : 0;
    return {
      joints: {
        spine: [-0.1 + thrust * 0.25, 0, 0],
        head: [-0.15, 0, 0],
        shoulderR: [-2.3 + thrust * 0.9, 0, -0.35],
        shoulderL: [-2.3 + thrust * 0.9, 0, 0.35],
        elbowR: [-0.35, 0, 0],
        elbowL: [-0.35, 0, 0],
        handR: [0.5, 0, 0],
      },
    };
  },

  hurt(): Pose {
    return {
      joints: {
        spine: [-0.3, 0, 0],
        head: [-0.35, 0, 0],
        shoulderL: [-0.2, 0, 0.7],
        shoulderR: [-0.2, 0, -0.7],
        elbowR: [-0.4, 0, 0],
        hipL: [-0.25, 0, 0],
        kneeL: [0.35, 0, 0],
      },
      lift: -0.04,
    };
  },

  /**
   * Dash, by direction relative to facing (fwd: +1 ahead / -1 back, side: +1 to her right):
   * a low sprinting lunge ahead, a crouched hop back, a side-skip with the lead leg reaching.
   */
  dash(fwd: number, side: number): Pose {
    const wf = Math.max(0, fwd);
    const wb = Math.max(0, -fwd);
    const ws = Math.abs(side);
    const sum = wf + wb + ws || 1;
    const sidePose = side >= 0 ? DASH_SIDE : mirrorPose(DASH_SIDE);
    const out: P = {};
    for (const [pose, w] of [[DASH_FWD, wf], [DASH_BACK, wb], [sidePose, ws]] as const) {
      for (const k of Object.keys(pose) as JointName[]) {
        const v = pose[k]!;
        const o = (out[k] ??= [0, 0, 0]);
        for (let i = 0; i < 3; i++) o[i] += (v[i] * w) / sum;
      }
    }
    return { joints: out, lift: -0.13 };
  },

  drink(): Pose {
    return {
      joints: { shoulderL: [-1.0, 0, -0.3], elbowL: [-1.8, 0, 0], head: [-0.25, 0, 0], shoulderR: [-0.2, 0, -0.15], elbowR: [-0.6, 0, 0] },
    };
  },

  wave(t: number): Pose {
    return {
      joints: { shoulderR: [0, 0, -2.6], elbowR: [-0.4 + Math.sin(t * 8) * 0.35, 0, 0], head: [0, -0.15, 0], shoulderL: [0.05, 0, 0.12] },
    };
  },
};

/** How far into the swing the windup gives way to the sweep, relative to the impact frame. */
export const SWEEP_LEAD = 0.08;
/** How long the sweep takes, as a fraction of the swing. */
export const SWEEP_LEN = 0.22;

/** Where a slash is at swing progress k: windup amount (0..1) before the sweep, then sweep amount (0..1). */
export function slashPhase(k: number, impact: number): { sweeping: boolean; u: number } {
  if (k < impact - SWEEP_LEAD) return { sweeping: false, u: smooth(Math.min(1, k / Math.max(0.01, impact - SWEEP_LEAD))) };
  // The sweep happens right around the impact frame, then holds the follow-through.
  return { sweeping: true, u: smooth(Math.min(1, (k - (impact - SWEEP_LEAD)) / SWEEP_LEN)) };
}

/** A three-hit slash from windup/end joint keys (the finisher drops into a low stance). */
export function keyedSlash(keys: { windup: P; end: P }[], ready: P, hitIndex: number, k: number, impact: number, finisherDrop = 0.08): Pose {
  const m = keys[hitIndex % 3];
  const { sweeping, u } = slashPhase(k, impact);
  const pose = sweeping ? lerpPose(m.windup, m.end, u) : lerpPose(ready, m.windup, u);
  return { joints: pose, lift: hitIndex === 2 ? -finisherDrop * Math.min(1, Math.max(0, (k - impact) * 4)) : -0.03 };
}

export const SLASH_READY: P = { shoulderR: [-0.3, 0, -0.15], elbowR: [-0.75, 0, 0], handR: [0.35, 0, 0], shoulderL: [0.05, 0, 0.12] };

// Spear thrust: drawn back low at the hip, then driven straight out with a lunge.
const THRUST_WINDUP: P = {
  spine: [0.05, 0, 0], chest: [0, 0.45, 0], shoulderR: [-0.6, 0, -0.3], elbowR: [-1.55, 0, 0], handR: [2.1, 0, 0],
  shoulderL: [-0.9, 0, -0.2], elbowL: [-1.1, 0, 0], hipR: [-0.25, 0, 0], kneeR: [0.3, 0, 0], hipL: [0.15, 0, 0],
};
const THRUST_END: P = {
  spine: [0.25, 0, 0], chest: [0, -0.35, 0], shoulderR: [-1.5, 0, -0.05], elbowR: [-0.05, 0, 0], handR: [1.25, 0, 0],
  shoulderL: [-1.2, 0, -0.45], elbowL: [-0.4, 0, 0], hipL: [-0.6, 0, 0], kneeL: [0.55, 0, 0], hipR: [0.35, 0, 0],
};

const CAST_READY: P = { shoulderR: [-0.2, 0, -0.15], elbowR: [-0.6, 0, 0], shoulderL: [0.05, 0, 0.12], elbowL: [-0.3, 0, 0] };

const CAST_KEYS: { windup: P; release: P; sweep: number; lift: number }[] = [
  {
    // Staff gathered upright in front of the chest, then thrust up to the sky.
    windup: {
      spine: [0.15, 0, 0], head: [0.05, 0, 0], shoulderR: [-0.35, 0, -0.2], elbowR: [-1.3, 0, 0], handR: [-0.3, 0, 0],
      shoulderL: [-0.7, 0, 0.1], elbowL: [-1.3, 0, 0], hipL: [-0.15, 0, 0], hipR: [-0.15, 0, 0], kneeL: [0.3, 0, 0], kneeR: [0.3, 0, 0],
    },
    release: {
      spine: [-0.15, 0, 0], head: [-0.3, 0, 0], shoulderR: [-2.95, 0, -0.15], elbowR: [-0.05, 0, 0], handR: [1.3, 0, 0],
      shoulderL: [-0.2, 0, 0.55], elbowL: [-0.2, 0, 0],
    },
    sweep: 0.1,
    lift: 0.03,
  },
  {
    // Staff cocked across to her left, then swept out flat to the right.
    windup: {
      spine: [0.1, 0, 0], chest: [0, 0.7, 0], head: [0, -0.4, 0], shoulderR: [-1.3, 0, 0.7], elbowR: [-1.1, 0, 0], handR: [1.7, 0, 0],
      shoulderL: [-0.2, 0, 0.4], elbowL: [-0.8, 0, 0], hipR: [-0.3, 0, 0], kneeR: [0.3, 0, 0], hipL: [0.2, 0, 0],
    },
    release: {
      spine: [0.15, 0, 0], chest: [0, -0.7, 0], head: [0, 0.4, 0], shoulderR: [-1.35, 0, -1.25], elbowR: [-0.1, 0, 0], handR: [1.2, 0, 0],
      shoulderL: [-0.3, 0, 0.3], elbowL: [-0.6, 0, 0], hipR: [-0.45, 0, 0], kneeR: [0.4, 0, 0], hipL: [0.3, 0, 0],
    },
    sweep: 0.14,
    lift: -0.02,
  },
  {
    // Finisher: both hands gather overhead, then drive forward into a low lunge.
    windup: {
      spine: [-0.3, 0, 0], chest: [-0.1, 0, 0], head: [-0.3, 0, 0], shoulderR: [-2.9, 0, -0.35], shoulderL: [-2.9, 0, 0.35],
      elbowR: [-0.6, 0, 0], elbowL: [-0.6, 0, 0], handR: [0.4, 0, 0], hipL: [-0.1, 0, 0], hipR: [-0.1, 0, 0], kneeL: [0.15, 0, 0], kneeR: [0.15, 0, 0],
    },
    release: {
      spine: [0.4, 0, 0], chest: [0.15, 0, 0], head: [-0.2, 0, 0], shoulderR: [-1.75, 0, 0.12], shoulderL: [-1.75, 0, -0.12],
      elbowR: [-0.05, 0, 0], elbowL: [-0.05, 0, 0], handR: [1.2, 0, 0], handL: [-0.3, 0, 0], hipL: [-0.7, 0, 0], kneeL: [0.7, 0, 0], hipR: [0.35, 0, 0], kneeR: [0.2, 0, 0],
    },
    sweep: 0.07,
    lift: -0.08,
  },
];

export const SLASH_KEYS: { windup: P; end: P }[] = [
  {
    // Right-to-left horizontal cut.
    windup: {
      spine: [0.08, 0, 0], chest: [0, -0.65, 0], shoulderR: [-1.15, 0, -1.05], elbowR: [-0.5, 0, 0], handR: [0.95, 0, 0],
      shoulderL: [-0.3, 0, 0.3], hipL: [-0.3, 0, 0], kneeL: [0.3, 0, 0], hipR: [0.2, 0, 0],
    },
    end: {
      spine: [0.2, 0, 0], chest: [0, 0.75, 0], shoulderR: [-1.4, 0, 0.45], elbowR: [-0.15, 0, 0], handR: [1.1, 0, 0],
      shoulderL: [0.25, 0, 0.45], hipL: [-0.45, 0, 0], kneeL: [0.4, 0, 0], hipR: [0.3, 0, 0],
    },
  },
  {
    // Backhand, left-to-right.
    windup: {
      spine: [0.1, 0, 0], chest: [0, 0.7, 0], shoulderR: [-1.3, 0, 0.7], elbowR: [-1.1, 0, 0], handR: [1.0, 0, 0],
      shoulderL: [0.2, 0, 0.4], hipR: [-0.3, 0, 0], kneeR: [0.3, 0, 0], hipL: [0.2, 0, 0],
    },
    end: {
      spine: [0.2, 0, 0], chest: [0, -0.7, 0], shoulderR: [-1.3, 0, -1.25], elbowR: [-0.15, 0, 0], handR: [1.0, 0, 0],
      shoulderL: [-0.3, 0, 0.3], hipR: [-0.45, 0, 0], kneeR: [0.4, 0, 0], hipL: [0.3, 0, 0],
    },
  },
  {
    // Overhead finisher.
    windup: {
      spine: [-0.25, 0, 0], chest: [0, -0.2, 0], shoulderR: [-2.9, 0, -0.15], elbowR: [-0.8, 0, 0], handR: [0.3, 0, 0],
      shoulderL: [-2.6, 0, 0.35], elbowL: [-0.9, 0, 0], hipL: [-0.15, 0, 0],
    },
    end: {
      spine: [0.45, 0, 0], chest: [0.2, 0, 0], shoulderR: [-0.95, 0, -0.1], elbowR: [-0.1, 0, 0], handR: [0.9, 0, 0],
      shoulderL: [-0.9, 0, 0.4], elbowL: [-0.3, 0, 0], hipL: [-0.65, 0, 0], kneeL: [0.6, 0, 0], hipR: [0.35, 0, 0],
    },
  },
];
