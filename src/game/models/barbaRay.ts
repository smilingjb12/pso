import * as THREE from 'three';
import { mat, part } from './Rig';

// Barba Ray (the Rift Map's second Circle II pinnacle boss): a giant manta out of PSO's VR Temple. A deep violet-blue
// back with gold trim along the wings' leading edges, a pale lilac belly, two curling horns (cephalic fins) either side
// of the mouth, cyan spots down the back that glow brighter as it charges, glowing spiracles behind the eyes (its weak
// point, lit while it is beached), and a long whip tail with a gold barb. About 13 m across the wings and 14 m nose to
// barb. Its brood: rose Pig Rays and teal Ul Rays (`rayMesh`). Faces +Z; posed by a handful of scalars like the Gryphon.

export interface BarbaPoseParams {
  /** Height of the whole ray off the floor (m). */
  lift: number;
  /** + noses down. */
  pitch: number;
  /** Banking roll (radians, + right wing down). */
  roll: number;
  /** How far the wings sweep up and down (0 still .. 1 a full beat). */
  flap: number;
  /** The wing wave's phase (radians: it runs along the wing, root to tip). */
  wave: number;
  /** 0 closed .. 1 gaping. */
  mouth: number;
  /** Tail swing (radians, + right). */
  tail: number;
  /** 0 dark .. 1 blazing: the spots down its back. */
  spots: number;
  /** 0..1 weak-point glow (beached: the spiracles). */
  weak: number;
  /** 0 aloft .. 1 beached: the wings slump onto the floor. */
  flat: number;
  flash: boolean;
  enraged: boolean;
  time: number;
}

const BACK = 0x3a3f9e;
const EDGE = 0x262a74;
const BELLY = 0xe6dcf2;
const GOLD = 0xd9b24a;
const SPOT = 0x6ae8ff;

/** A manta's outline in the shape plane (x across, y forward), `s` m across the wings. */
function outline(s: number): THREE.Shape {
  const h = s / 2;
  const shape = new THREE.Shape();
  shape.moveTo(0, 0.34 * s);
  shape.quadraticCurveTo(0.22 * s, 0.3 * s, h, -0.02 * s);
  shape.quadraticCurveTo(0.3 * s, -0.12 * s, 0.1 * s, -0.24 * s);
  shape.lineTo(0, -0.3 * s);
  shape.lineTo(-0.1 * s, -0.24 * s);
  shape.quadraticCurveTo(-0.3 * s, -0.12 * s, -h, -0.02 * s);
  shape.quadraticCurveTo(-0.22 * s, 0.3 * s, 0, 0.34 * s);
  return shape;
}

/** A flat manta plate `s` m across, `t` thick, lying in the XZ plane (forward +Z), top at y = t. */
function plate(s: number, t: number): THREE.BufferGeometry {
  return new THREE.ExtrudeGeometry(outline(s), { depth: t, bevelEnabled: true, bevelThickness: t * 0.5, bevelSize: s * 0.012, bevelSegments: 1, curveSegments: 6 })
    .rotateX(Math.PI / 2)
    .translate(0, t, 0);
}

/**
 * A small ray of the brood, `span` m across the wings: a flat plate, two horns, eyes and a whip tail. Its materials
 * glow faintly (emissive) so a hit can flash them.
 */
export function rayMesh(color: number, span: number): THREE.Group {
  const g = new THREE.Group();
  const skin = mat(color, { emissive: color, emissiveIntensity: 0.35, rough: 0.5 });
  const belly = mat(new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.55).getHex(), { rough: 0.6 });
  part(g, plate(span, span * 0.05), skin, [0, 0, 0]);
  part(g, plate(span * 0.96, span * 0.02), belly, [0, -span * 0.03, 0]);
  for (const side of [-1, 1]) {
    part(g, new THREE.ConeGeometry(span * 0.03, span * 0.16, 5).rotateX(Math.PI / 2), skin, [side * span * 0.07, span * 0.03, span * 0.36], [0, side * 0.25, 0]);
    part(g, new THREE.SphereGeometry(span * 0.025, 6, 4), mat(0x101018, { emissive: 0xffe08a, emissiveIntensity: 0.8 }), [side * span * 0.09, span * 0.06, span * 0.24]);
  }
  part(g, new THREE.CylinderGeometry(span * 0.012, span * 0.004, span * 0.7, 4).rotateX(Math.PI / 2), skin, [0, span * 0.03, -span * 0.62]);
  return g;
}

/** One wing: a root panel and a tip panel hinged at the elbow, so a wave can run out along it. */
interface Wing {
  root: THREE.Group;
  tip: THREE.Group;
  side: number;
}

export class BarbaRayModel {
  readonly group = new THREE.Group();
  readonly body = new THREE.Group();
  readonly backMat: THREE.MeshStandardMaterial;
  readonly spotMat: THREE.MeshStandardMaterial;
  readonly weakMat: THREE.MeshBasicMaterial;
  private wings: Wing[] = [];
  private tail: THREE.Group[] = [];
  private jaw: THREE.Group;
  private horns: THREE.Group[] = [];
  private eyeMat: THREE.MeshStandardMaterial;

  constructor() {
    this.group.add(this.body);
    this.backMat = mat(BACK, { rough: 0.45 });
    const edge = mat(EDGE, { rough: 0.5 });
    const belly = mat(BELLY, { rough: 0.6 });
    const gold = mat(GOLD, { rough: 0.3 });
    this.spotMat = mat(0x4a6a8a, { emissive: SPOT, emissiveIntensity: 0.4 });
    this.spotMat.userData.glow = true;
    this.eyeMat = mat(0x14101e, { emissive: 0xffd36a, emissiveIntensity: 1.6 });
    this.eyeMat.userData.glow = true;

    // The core: a thick ridge down the middle, the belly under it.
    part(this.body, new THREE.SphereGeometry(1, 16, 10), this.backMat, [0, 0.45, 0.4], [0, 0, 0], [1.9, 0.7, 4.2]);
    part(this.body, new THREE.SphereGeometry(1, 16, 8), belly, [0, 0.2, 0.4], [0, 0, 0], [1.8, 0.45, 4]);
    // The head's front: a broad lip between the horns, the mouth under it.
    part(this.body, new THREE.BoxGeometry(2.8, 0.45, 0.9), this.backMat, [0, 0.42, 4.3]);
    this.jaw = new THREE.Group();
    this.jaw.position.set(0, 0.2, 4.4);
    this.body.add(this.jaw);
    part(this.jaw, new THREE.BoxGeometry(2.4, 0.18, 0.7), belly, [0, -0.05, 0.1]);
    part(this.jaw, new THREE.BoxGeometry(2.2, 0.05, 0.5), mat(0x2a0e2a, { emissive: 0x7a2a6a, emissiveIntensity: 0.6 }), [0, 0.06, 0.05]);
    // The horns: cephalic fins curling forward and in, gold-tipped.
    for (const side of [-1, 1]) {
      const h = new THREE.Group();
      h.position.set(side * 1.45, 0.45, 4.5);
      this.body.add(h);
      this.horns.push(h);
      part(h, new THREE.BoxGeometry(0.35, 0.16, 1.6), this.backMat, [0, 0, 0.7], [0, -side * 0.12, 0]);
      part(h, new THREE.BoxGeometry(0.3, 0.14, 0.9), this.backMat, [-side * 0.25, 0, 1.75], [0, -side * 0.55, 0]);
      part(h, new THREE.ConeGeometry(0.11, 0.5, 5).rotateX(Math.PI / 2), gold, [-side * 0.55, 0, 2.2], [0, -side * 0.7, 0]);
      // Eyes on the sides of the head, spiracles behind them (the weak point).
      part(this.body, new THREE.SphereGeometry(0.28, 10, 8), this.eyeMat, [side * 1.55, 0.62, 3.6]);
    }
    // The wings: a root panel from the flank and a tip panel, gold along the leading edge, spots down the back. Built
    // once on the right (+X) and mirrored for the left (a negative scale; three.js flips the faces to match).
    const rootPanel = new THREE.Shape([new THREE.Vector2(0, 2.9), new THREE.Vector2(2.6, 1.3), new THREE.Vector2(2.6, -1.1), new THREE.Vector2(0, -2.4)]);
    const rootGeo = new THREE.ExtrudeGeometry(rootPanel, { depth: 0.22, bevelEnabled: false }).rotateX(Math.PI / 2).translate(0, 0.11, 0);
    const tipPanel = new THREE.Shape([new THREE.Vector2(0, 1.3), new THREE.Vector2(3.2, -0.6), new THREE.Vector2(2.2, -1.0), new THREE.Vector2(0, -1.1)]);
    const tipGeo = new THREE.ExtrudeGeometry(tipPanel, { depth: 0.16, bevelEnabled: false }).rotateX(Math.PI / 2).translate(0, 0.08, 0);
    for (const side of [-1, 1]) {
      const root = new THREE.Group();
      root.position.set(side * 1.4, 0.45, 0.6);
      root.scale.x = side;
      this.body.add(root);
      part(root, rootGeo, this.backMat);
      part(root, rootGeo.clone().scale(0.97, 0.5, 0.97).translate(0, -0.12, 0), belly);
      part(root, new THREE.BoxGeometry(0.16, 0.12, 3.1), gold, [1.3, 0.14, 2.15], [0, -0.55, 0]);
      for (let i = 0; i < 3; i++) part(root, new THREE.SphereGeometry(0.17, 8, 6), this.spotMat, [0.7 + i * 0.6, 0.2, 0.6 - i * 0.55]);
      const tip = new THREE.Group();
      tip.position.set(2.6, 0, 0);
      root.add(tip);
      part(tip, tipGeo, this.backMat);
      part(tip, tipGeo.clone().scale(0.97, 0.5, 0.97).translate(0, -0.09, 0), belly);
      part(tip, new THREE.BoxGeometry(0.12, 0.1, 3.4), gold, [1.55, 0.1, 0.4], [0, -1.07, 0]);
      part(tip, new THREE.BoxGeometry(0.6, 0.06, 0.2), edge, [2.7, 0.08, -0.75], [0, 0.4, 0]);
      for (let i = 0; i < 2; i++) part(tip, new THREE.SphereGeometry(0.13, 8, 6), this.spotMat, [0.6 + i * 0.8, 0.13, -0.1 - i * 0.2]);
      this.wings.push({ root, tip, side });
    }
    // Spots down the spine.
    for (let i = 0; i < 5; i++) part(this.body, new THREE.SphereGeometry(0.22 - i * 0.02, 8, 6), this.spotMat, [0, 1.12 - i * 0.04, 2.4 - i * 1.1]);
    // The weak point: three spiracle slits glowing behind the head (lit while beached).
    this.weakMat = new THREE.MeshBasicMaterial({ color: 0xff8ad8, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    for (const side of [-1, 1]) for (let i = 0; i < 3; i++) part(this.body, new THREE.BoxGeometry(0.5, 0.06, 0.12), this.weakMat, [side * 0.75, 1.13, 3.0 - i * 0.3], [0, side * 0.3, 0]);
    // The tail: a chain of tapering segments, a gold barb at the end.
    let parent: THREE.Object3D = this.body;
    let z = -3.4;
    for (let i = 0; i < 6; i++) {
      const seg = new THREE.Group();
      seg.position.set(0, i === 0 ? 0.4 : 0, i === 0 ? z : -1.25);
      parent.add(seg);
      part(seg, new THREE.CylinderGeometry(0.2 - i * 0.025, 0.17 - i * 0.025, 1.3, 5).rotateX(Math.PI / 2), i % 2 ? edge : this.backMat, [0, 0, -0.62]);
      this.tail.push(seg);
      parent = seg;
      z = -1.25;
    }
    part(parent, new THREE.ConeGeometry(0.18, 0.9, 5).rotateX(-Math.PI / 2), gold, [0, 0, -1.6]);
  }

  pose(p: BarbaPoseParams): void {
    this.group.position.y = p.lift;
    this.body.rotation.set(p.pitch, 0, p.roll);
    // The wave runs out along each wing: the tip lags the root. Beached, both slump onto the floor.
    for (const w of this.wings) {
      const beat = Math.sin(p.wave) * p.flap;
      const lag = Math.sin(p.wave - 0.9) * p.flap;
      // The root's rotation comes after the left wing's mirror (it takes the opposite angle to lift); the tip's comes
      // before it, inside the mirrored wing, so the same angle lifts both tips.
      w.root.rotation.set(0, 0, w.side * (beat * 0.45 - p.flat * 0.12));
      w.tip.rotation.set(0, 0, lag * 0.55 - p.flat * 0.18);
    }
    this.tail.forEach((s, i) => {
      s.rotation.y = p.tail * (0.25 + i * 0.05) + Math.sin(p.time * 2.2 - i * 0.7) * 0.08 * (1 - p.flat * 0.7);
      s.rotation.x = i === 0 ? -0.05 + p.flat * 0.08 : Math.sin(p.time * 1.6 - i) * 0.03;
    });
    this.jaw.rotation.x = p.mouth * 0.5;
    for (const [i, h] of this.horns.entries()) h.rotation.y = (i ? -1 : 1) * p.mouth * 0.25;
    this.backMat.color.setHex(p.flash ? 0xffffff : BACK);
    this.backMat.emissive.setHex(p.flash ? 0x707880 : p.enraged ? 0x2a0a3a : 0x000000);
    this.spotMat.emissiveIntensity = 0.3 + p.spots * 2.4;
    this.eyeMat.emissiveIntensity = p.weak > 0 ? 0.4 : 1.6;
    this.weakMat.opacity = p.weak;
  }
}
