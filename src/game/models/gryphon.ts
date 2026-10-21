import * as THREE from 'three';
import { mat, part } from './Rig';

// Gal Gryphon (the Rift Map's Circle II pinnacle boss): a storm griffin, PSO-faithful in colour. An eagle's head with a
// gold hooked beak and a swept crest, white chest and sky-blue plumage, deep blue flight feathers, gold-banded talons
// in front and a lion's haunches behind, a fan tail, and cyan lightning veins down the wings that flare as it charges
// and go dark when it is grounded. About 5 m to the crest standing, 16 m across the wings. Faces +Z; posed by a
// handful of scalars like the Dragon.

export interface GryphonPoseParams {
  /** Height of the whole bird off the floor (m). */
  lift: number;
  /** + noses down. */
  pitch: number;
  /** Banking roll (radians, + right wing down). */
  roll: number;
  /** Flap angle (radians, + up). */
  flap: number;
  /** 0 folded along the back .. 1 spread. */
  spread: number;
  /** + lowers the head. */
  neck: number;
  /** 0 closed .. 1 open. */
  beak: number;
  /** 0 standing .. 1 tucked under (flying). */
  tuck: number;
  /** 0 dark .. 1 blazing: its lightning veins. */
  veins: number;
  /** 0..1 weak-point glow (grounded). */
  weak: number;
  flash: boolean;
  enraged: boolean;
  /** Leg cycle phase (radians); NaN = standing. */
  walk: number;
  time: number;
}

const WHITE = 0xeef3f8;
const SKY = 0x82bde8;
const DEEP = 0x2e5d9c;
const GOLD = 0xd9b24a;
const VEIN = 0x6ae8ff;

export class GryphonModel {
  readonly group = new THREE.Group();
  readonly body = new THREE.Group();
  readonly neck = new THREE.Group();
  readonly head = new THREE.Group();
  readonly jaw = new THREE.Group();
  readonly plumeMat: THREE.MeshStandardMaterial;
  readonly chestMat: THREE.MeshStandardMaterial;
  readonly veinMat: THREE.MeshStandardMaterial;
  readonly weakMat: THREE.MeshBasicMaterial;
  private wings: { pivot: THREE.Group; elbow: THREE.Group; side: number }[] = [];
  private legs: { pivot: THREE.Group; knee: THREE.Group; phase: number; front: boolean }[] = [];
  private tail: THREE.Group;
  private tailFeathers: THREE.Mesh[] = [];
  private eyeMat: THREE.MeshStandardMaterial;

  constructor() {
    this.plumeMat = mat(SKY);
    this.chestMat = mat(WHITE);
    const deep = mat(DEEP);
    const gold = mat(GOLD, { rough: 0.35 });
    const dark = mat(0x1e2c44);
    this.veinMat = mat(0x9ad8ff, { emissive: VEIN, emissiveIntensity: 0.6 });
    this.veinMat.userData.glow = true;
    this.eyeMat = mat(0xfff0a0, { emissive: 0xffc840, emissiveIntensity: 1.6 });
    this.eyeMat.userData.glow = true;
    const featherMat = mat(WHITE);
    featherMat.side = THREE.DoubleSide;
    const deepFeather = mat(DEEP);
    deepFeather.side = THREE.DoubleSide;
    const skyFeather = mat(SKY);
    skyFeather.side = THREE.DoubleSide;

    // --- torso: a deep chest in front, a lion's back and haunches behind
    this.body.position.y = 2.3;
    part(this.body, new THREE.SphereGeometry(1, 9, 7), this.plumeMat, [0, 0.2, -0.2], [0, 0, 0], [1.35, 1.25, 2.3]);
    part(this.body, new THREE.SphereGeometry(1, 9, 7), this.chestMat, [0, 0.35, 1.1], [-0.3, 0, 0], [1.3, 1.45, 1.2]);
    part(this.body, new THREE.SphereGeometry(1, 8, 6), this.plumeMat, [0, 0.0, -1.7], [0, 0, 0], [1.25, 1.1, 1.1]);
    // Breast ruff: layered white feather scales.
    for (let i = 0; i < 7; i++) {
      const a = (i - 3) * 0.32;
      part(this.body, new THREE.ConeGeometry(0.42, 1.1, 4), featherMat, [Math.sin(a) * 1.05, -0.35 + Math.abs(i - 3) * 0.08, 1.55 + Math.cos(a) * 0.35], [2.6, 0, a * 0.6]);
    }

    // --- legs: talons in front (gold-banded), haunches behind
    for (const [x, z, phase, front] of [
      [-0.8, 1.2, 0, true],
      [0.8, 1.2, Math.PI, true],
      [-0.95, -1.8, Math.PI, false],
      [0.95, -1.8, 0, false],
    ] as const) {
      const pivot = new THREE.Group();
      pivot.position.set(x, -0.2, z);
      this.body.add(pivot);
      part(pivot, new THREE.SphereGeometry(0.55, 6, 5), front ? this.chestMat : this.plumeMat, [0, -0.1, 0], [0, 0, 0], [1, 1.35, 1.15]);
      const knee = new THREE.Group();
      knee.position.set(0, -0.9, front ? 0.15 : -0.25);
      pivot.add(knee);
      part(knee, new THREE.CylinderGeometry(0.22, 0.17, 1.2, 6), front ? gold : this.plumeMat, [0, -0.55, 0]);
      if (front) {
        for (const y of [-0.25, -0.65]) part(knee, new THREE.TorusGeometry(0.21, 0.05, 4, 10), dark, [0, y, 0], [Math.PI / 2, 0, 0]);
        for (const cx of [-0.17, 0, 0.17]) part(knee, new THREE.ConeGeometry(0.07, 0.45, 4), dark, [cx, -1.12, 0.32], [1.9, 0, cx]);
        part(knee, new THREE.ConeGeometry(0.06, 0.35, 4), dark, [0, -1.1, -0.22], [-1.9, 0, 0]);
      } else {
        part(knee, new THREE.SphereGeometry(0.3, 6, 4), this.plumeMat, [0, -1.15, 0.1], [0, 0, 0], [1, 0.6, 1.3]);
      }
      this.legs.push({ pivot, knee, phase, front });
    }

    // --- tail: a fan of long feathers on a short stem
    this.tail = new THREE.Group();
    this.tail.position.set(0, 0.25, -2.6);
    this.body.add(this.tail);
    part(this.tail, new THREE.CylinderGeometry(0.35, 0.5, 1.2, 6).rotateX(Math.PI / 2 + 0.25), this.plumeMat, [0, 0, -0.4]);
    for (let i = 0; i < 7; i++) {
      const a = (i - 3) * 0.2;
      const f = part(this.tail, new THREE.BoxGeometry(0.42, 0.06, 3.2 - Math.abs(i - 3) * 0.25), i % 2 ? deepFeather : featherMat, [Math.sin(a) * 1.4, -0.1, -1.0 - Math.cos(a) * 1.4], [0.15, a, 0]);
      this.tailFeathers.push(f);
    }

    // --- wings: an arm out to the wrist (coverts), then the hand of long flight feathers; veins along both
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 1.05, 0.9, 0.55);
      this.body.add(pivot);
      const arm = 3.6;
      part(pivot, new THREE.BoxGeometry(arm, 0.35, 1.6), this.plumeMat, [(side * arm) / 2, 0, -0.5]);
      // Coverts: rows of short sky and white feathers along the arm's trailing edge.
      for (let i = 0; i < 6; i++) {
        part(pivot, new THREE.BoxGeometry(0.62, 0.05, 1.5), i % 2 ? skyFeather : featherMat, [side * (0.4 + i * 0.58), -0.12, -1.55], [0.1, side * 0.05, 0]);
      }
      part(pivot, new THREE.BoxGeometry(arm, 0.06, 0.1), this.veinMat, [(side * arm) / 2, 0.2, 0.2]);
      const elbow = new THREE.Group();
      elbow.position.set(side * arm, 0, 0);
      pivot.add(elbow);
      part(elbow, new THREE.BoxGeometry(1.2, 0.3, 1.2), this.plumeMat, [side * 0.55, 0, -0.35]);
      part(elbow, new THREE.SphereGeometry(0.22, 5, 4), gold, [side * 0.1, 0.1, 0.25]);
      // Primaries: long deep-blue flight feathers fanned back from the hand, white tipped.
      for (let i = 0; i < 7; i++) {
        const len = 4.2 - i * 0.35;
        const a = side * (0.15 + i * 0.2);
        const g = new THREE.Group();
        g.position.set(side * (0.9 - i * 0.12), -0.05, -0.2 - i * 0.12);
        g.rotation.y = (side * Math.PI) / 2 + a;
        elbow.add(g);
        part(g, new THREE.BoxGeometry(0.5, 0.05, len), deepFeather, [0, 0, len / 2]);
        part(g, new THREE.BoxGeometry(0.46, 0.06, 0.6), featherMat, [0, 0.005, len - 0.2]);
        if (i % 2 === 0) part(g, new THREE.BoxGeometry(0.06, 0.07, len * 0.8), this.veinMat, [0, 0.04, len * 0.45]);
      }
      this.wings.push({ pivot, elbow, side });
    }

    // --- neck and the eagle head
    this.neck.position.set(0, 1.0, 1.55);
    this.body.add(this.neck);
    part(this.neck, new THREE.CylinderGeometry(0.62, 0.85, 1.6, 7).rotateX(0.55), this.chestMat, [0, 0.55, 0.3]);
    // A gold collar round the base of the neck.
    part(this.neck, new THREE.TorusGeometry(0.8, 0.11, 5, 18), gold, [0, 0.15, 0.05], [Math.PI / 2 - 0.55, 0, 0]);
    this.head.position.set(0, 1.45, 0.75);
    this.neck.add(this.head);
    part(this.head, new THREE.SphereGeometry(0.75, 9, 7), this.chestMat, [0, 0, 0], [0, 0, 0], [1, 0.95, 1.15]);
    // The hooked gold beak: upper (a cone curling down at the tip) over a lower jaw.
    part(this.head, new THREE.ConeGeometry(0.36, 1.05, 6).rotateX(Math.PI / 2), gold, [0, 0.05, 0.95]);
    part(this.head, new THREE.ConeGeometry(0.13, 0.45, 5), gold, [0, -0.15, 1.42], [2.4, 0, 0]);
    this.jaw.position.set(0, -0.22, 0.55);
    this.head.add(this.jaw);
    part(this.jaw, new THREE.ConeGeometry(0.26, 0.75, 5).rotateX(Math.PI / 2), gold, [0, -0.05, 0.35]);
    for (const sx of [-0.36, 0.36]) {
      part(this.head, new THREE.OctahedronGeometry(0.12), this.eyeMat, [sx, 0.18, 0.5]);
      part(this.head, new THREE.BoxGeometry(0.3, 0.08, 0.25), dark, [sx, 0.32, 0.5], [0, 0, -sx * 0.6]);
    }
    // Swept crest: sky and deep-blue plumes streaming back, one vein of light down the middle.
    for (let i = 0; i < 5; i++) {
      const a = (i - 2) * 0.28;
      part(this.head, new THREE.ConeGeometry(0.16, 1.9 - Math.abs(i - 2) * 0.3, 4).rotateX(-Math.PI / 2 + 0.35), i % 2 ? deep : this.plumeMat, [Math.sin(a) * 0.45, 0.45, -0.8], [0, a * 0.5, 0]);
    }
    part(this.head, new THREE.BoxGeometry(0.06, 0.06, 1.4), this.veinMat, [0, 0.72, -0.55], [-0.5, 0, 0]);

    this.weakMat = new THREE.MeshBasicMaterial({ color: 0xffff70, transparent: true, opacity: 0, depthWrite: false });
    this.body.add(new THREE.Mesh(new THREE.SphereGeometry(1.9, 10, 8).scale(1, 0.9, 1.4), this.weakMat));

    this.group.add(this.body);
  }

  pose(p: GryphonPoseParams): void {
    this.group.position.y = p.lift;
    this.body.rotation.set(p.pitch, 0, p.roll);
    this.neck.rotation.x = p.neck * 0.6;
    this.head.rotation.x = p.neck * 0.35;
    this.jaw.rotation.x = p.beak * 0.55;
    for (const w of this.wings) {
      // Spread: the arm swings out from along the flank, the hand unfolds; folded, both lie back with the flight
      // feathers along the back. Flap lifts the whole wing.
      const s = p.spread;
      w.pivot.rotation.set(0, w.side * (1 - s) * 1.38, w.side * (p.flap - (1 - s) * 0.3));
      w.elbow.rotation.set(0, w.side * (1 - s) * 0.12, w.side * p.flap * 0.5);
    }
    this.tail.rotation.x = -p.pitch * 0.6 + Math.sin(p.time * 1.4) * 0.05;
    this.tailFeathers.forEach((f, i) => (f.rotation.x = 0.15 + Math.sin(p.time * 2 + i) * 0.04));
    for (const leg of this.legs) {
      const swing = Number.isNaN(p.walk) ? 0 : Math.sin(p.walk + leg.phase) * 0.4;
      leg.pivot.rotation.x = swing + p.tuck * (leg.front ? 1.1 : -0.9);
      leg.knee.rotation.x = p.tuck * (leg.front ? -1.6 : 1.4);
    }
    const flash = p.flash;
    this.plumeMat.color.setHex(flash ? 0xffffff : SKY);
    this.chestMat.emissive.setHex(flash ? 0x707880 : p.enraged ? 0x10203a : 0x000000);
    this.veinMat.emissiveIntensity = 0.15 + p.veins * 2.6;
    this.veinMat.color.setHex(p.veins > 0.05 ? 0xbaf4ff : 0x4a6a80);
    this.eyeMat.emissiveIntensity = p.weak > 0 ? 0.3 : 1.6;
    this.weakMat.opacity = p.weak;
  }
}
