import * as THREE from 'three';
import { mat, part } from './Rig';

// De Rol Le: a giant armoured sea worm. A masked, mandibled head followed by a
// chain of body segments, each wearing a bone shell plate. The boss positions
// every group itself (they all face +Z), so the model is just parts plus a few
// knobs: mandibles, plates, mask, glow.

export interface DeRolLePose {
  /** 0 closed .. 1 wide open. */
  jaw: number;
  flash: boolean;
  /** Phase 2: exposed flesh glows. */
  exposed: boolean;
  enraged: boolean;
  /** Head resting on the deck: weak-point glow 0..1. */
  weak: number;
  /** Beam charge 0..1. */
  charge: number;
  time: number;
}

export class DeRolLeModel {
  readonly root = new THREE.Group();
  readonly head = new THREE.Group();
  readonly segs: THREE.Group[] = [];
  readonly plates: THREE.Group[] = [];
  readonly mask = new THREE.Group();
  private jawL = new THREE.Group();
  private jawR = new THREE.Group();
  private bodyMat: THREE.MeshStandardMaterial;
  private darkMat: THREE.MeshStandardMaterial;
  private faceMat: THREE.MeshStandardMaterial;
  private mouthMat: THREE.MeshStandardMaterial;
  private weakMat: THREE.MeshBasicMaterial;
  private legs: THREE.Group[] = [];

  constructor(segCount = 8, private segRadius = (i: number) => 1.25 - i * 0.055) {
    this.bodyMat = mat(0x4a3a6e);
    this.darkMat = mat(0x2a2044);
    const belly = mat(0x9a86b0);
    const plate = mat(0xd8cfb0, { rough: 0.5 });
    const plateDark = mat(0x8a8068, { rough: 0.6 });
    const teal = mat(0x3aa8a0, { emissive: 0x0a3a36, emissiveIntensity: 1 });
    const bone = mat(0xece4cc, { rough: 0.45 });
    const eye = mat(0xff3030, { emissive: 0xff2020, emissiveIntensity: 1.6 });
    eye.userData.glow = true;
    this.faceMat = mat(0x9a40c0, { emissive: 0x501080, emissiveIntensity: 1 });
    this.mouthMat = mat(0xff70e0, { emissive: 0xc030c0, emissiveIntensity: 1 });
    this.mouthMat.userData.glow = true;
    this.weakMat = new THREE.MeshBasicMaterial({ color: 0xffff60, transparent: true, opacity: 0, depthWrite: false });

    // --- head (faces +Z)
    const h = this.head;
    h.rotation.order = 'YXZ';
    part(h, new THREE.SphereGeometry(1.3, 9, 7), this.bodyMat, [0, 0, -0.1], [0, 0, 0], [1.1, 0.85, 1.35]);
    part(h, new THREE.SphereGeometry(1.0, 8, 6), belly, [0, -0.45, 0.2], [0, 0, 0], [1, 0.5, 1.2]);
    // Exposed face under the mask: glowing violet flesh, two pairs of yellow eyes.
    part(h, new THREE.SphereGeometry(0.85, 8, 6), this.faceMat, [0, 0.05, 0.95], [0, 0, 0], [1.05, 0.85, 0.7]);
    const faceEye = mat(0xffe040, { emissive: 0xffc020, emissiveIntensity: 1.5 });
    faceEye.userData.glow = true;
    for (const sx of [-1, 1]) {
      part(h, new THREE.OctahedronGeometry(0.12), faceEye, [sx * 0.35, 0.3, 1.45]);
      part(h, new THREE.OctahedronGeometry(0.08), faceEye, [sx * 0.55, 0.1, 1.38]);
    }
    part(h, new THREE.SphereGeometry(0.35, 7, 5), this.mouthMat, [0, -0.3, 1.45], [0, 0, 0], [1.2, 0.6, 0.5]);
    // Bone mask over the face, with eye slits and a swept-back crest.
    this.mask.position.set(0, 0.1, 1.0);
    h.add(this.mask);
    part(this.mask, new THREE.SphereGeometry(1.02, 9, 6, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2), bone, [0, 0, 0], [0, 0, 0], [1.08, 0.95, 0.72]);
    for (const sx of [-1, 1]) {
      part(this.mask, new THREE.BoxGeometry(0.42, 0.1, 0.12), this.darkMat, [sx * 0.42, 0.22, 0.68], [0, 0, sx * 0.25]);
      part(this.mask, new THREE.OctahedronGeometry(0.08), eye, [sx * 0.42, 0.22, 0.72]);
      part(this.mask, new THREE.ConeGeometry(0.16, 1.1, 4), bone, [sx * 0.75, 0.55, -0.3], [-1.2, 0, -sx * 0.5]);
    }
    for (let i = 0; i < 3; i++) part(this.mask, new THREE.ConeGeometry(0.14 - i * 0.03, 0.9 - i * 0.15, 4), bone, [0, 0.85 - i * 0.05, -0.2 - i * 0.45], [-1.3, 0, 0]);
    part(this.mask, new THREE.BoxGeometry(0.16, 0.5, 0.2), plateDark, [0, -0.15, 0.72]);
    // Mandibles: curved horns hinged at the jaw.
    for (const [g, sx] of [[this.jawL, 1], [this.jawR, -1]] as const) {
      g.position.set(sx * 0.75, -0.45, 1.0);
      h.add(g);
      part(g, new THREE.ConeGeometry(0.24, 1.7, 5).rotateX(Math.PI / 2), bone, [0, 0, 0.8], [0, -sx * 0.25, 0]);
      part(g, new THREE.ConeGeometry(0.12, 0.7, 4).rotateX(Math.PI / 2), bone, [-sx * 0.25, 0, 1.55], [0, -sx * 1.0, 0]);
      for (let i = 0; i < 3; i++) part(g, new THREE.ConeGeometry(0.05, 0.22, 4), bone, [-sx * 0.15, 0.05, 0.4 + i * 0.3], [0, 0, sx * Math.PI / 2]);
    }
    // Frill behind the head.
    part(h, new THREE.TorusGeometry(1.15, 0.18, 5, 12), this.darkMat, [0, 0, -0.9]);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      part(h, new THREE.ConeGeometry(0.12, 0.6, 4), teal, [Math.sin(a) * 1.3, Math.cos(a) * 1.3, -1.0], [Math.cos(a) * 1.2, 0, -Math.sin(a) * 1.2]);
    }
    h.add(new THREE.Mesh(new THREE.SphereGeometry(1.7, 10, 8), this.weakMat));
    this.root.add(h);

    // --- body segments
    for (let i = 0; i < segCount; i++) {
      const r = this.segRadius(i);
      const g = new THREE.Group();
      g.rotation.order = 'YXZ';
      part(g, new THREE.SphereGeometry(r, 9, 6), i % 2 ? this.darkMat : this.bodyMat, [0, 0, 0], [0, 0, 0], [1, 0.85, 1.15]);
      part(g, new THREE.SphereGeometry(r * 0.8, 8, 5), belly, [0, -r * 0.35, 0], [0, 0, 0], [1, 0.45, 1.1]);
      // Little tentacle legs on both flanks.
      const legs = new THREE.Group();
      for (const sx of [-1, 1])
        for (const lz of [-0.35, 0.35]) part(legs, new THREE.ConeGeometry(0.1 * r, 0.9 * r, 4), belly, [sx * r * 0.85, -r * 0.5, lz * r], [0, 0, sx * 2.4]);
      g.add(legs);
      this.legs.push(legs);
      // Shell plate: a bone dome with ridges and a glowing teal seam.
      const p = new THREE.Group();
      p.position.y = r * 0.15;
      part(p, new THREE.SphereGeometry(r * 1.08, 9, 5, 0, Math.PI * 2, 0, Math.PI / 2), plate, [0, 0, 0], [0, 0, 0], [1.05, 0.8, 1.12]);
      part(p, new THREE.TorusGeometry(r * 1.06, 0.06, 4, 16).rotateX(Math.PI / 2), teal, [0, 0.02, 0], [0, 0, 0], [1.05, 1, 1.12]);
      for (let k = 0; k < 3; k++) part(p, new THREE.ConeGeometry(0.13 * r, 0.6 * r, 4), plateDark, [0, r * 0.8, (k - 1) * r * 0.5], [-0.4, 0, 0]);
      for (const sx of [-1, 1]) part(p, new THREE.BoxGeometry(0.5 * r, 0.12, r * 1.4), plateDark, [sx * r * 0.85, r * 0.15, 0], [0, 0, sx * 0.6]);
      g.add(p);
      this.plates.push(p);
      if (i === segCount - 1) part(g, new THREE.ConeGeometry(r * 0.6, 2.2, 6).rotateX(-Math.PI / 2), this.darkMat, [0, 0, -r * 1.5]);
      this.segs.push(g);
      this.root.add(g);
    }
  }

  pose(p: DeRolLePose): void {
    const open = 0.15 + p.jaw * 0.55;
    this.jawL.rotation.y = open;
    this.jawR.rotation.y = -open;
    this.legs.forEach((l, i) => (l.rotation.x = Math.sin(p.time * 6 + i * 0.9) * 0.25));
    this.bodyMat.emissive.setHex(p.flash ? 0x806080 : p.enraged ? 0x3a0820 : p.exposed ? 0x1a0828 : 0x000000);
    this.darkMat.emissive.setHex(p.flash ? 0x604060 : 0x000000);
    this.faceMat.emissiveIntensity = p.exposed ? 1.4 + Math.sin(p.time * 5) * 0.4 : 1;
    this.mouthMat.emissiveIntensity = 1 + p.charge * 3 + (p.charge > 0 ? Math.sin(p.time * 40) * 0.5 : 0);
    this.weakMat.opacity = p.weak;
  }
}
