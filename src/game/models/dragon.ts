import * as THREE from 'three';
import { mat, part } from './Rig';

// The Forest boss: a heavy, horned dragon with bat wings. Built from flat-shaded
// primitives; posed by a handful of scalar parameters.

export interface DragonPoseParams {
  neckPitch: number; // + lowers the head
  jaw: number; // 0 closed .. 1 open
  bodyLift: number;
  bodyPitch: number;
  wingFlap: number; // radians, + raises the wings
  flame: number; // 0..1 opacity of the breath cone
  weak: number; // 0..1 weak-point glow
  headColor: number;
  flash: boolean;
  enraged: boolean;
  walk: number; // leg cycle phase (radians), NaN = standing
  time: number;
}

export class DragonModel {
  readonly group = new THREE.Group();
  readonly body = new THREE.Group();
  readonly neck = new THREE.Group();
  readonly headGroup = new THREE.Group();
  readonly jaw = new THREE.Group();
  readonly bodyMat: THREE.MeshStandardMaterial;
  readonly headMat: THREE.MeshStandardMaterial;
  readonly flameMat: THREE.MeshBasicMaterial;
  readonly weakMat: THREE.MeshBasicMaterial;
  readonly flame: THREE.Mesh;
  private wings: THREE.Group[] = [];
  private tail: THREE.Group[] = [];
  private legs: { pivot: THREE.Group; phase: number }[] = [];

  constructor(breathRange = 13, breathArcDeg = 50) {
    this.bodyMat = mat(0x8a2418);
    this.headMat = mat(0x9a2c1c);
    const dark = mat(0x5a160e);
    const belly = mat(0xd8b070);
    const horn = mat(0xf0e6c8, { rough: 0.4 });
    const membrane = mat(0x9a3424);
    membrane.side = THREE.DoubleSide;
    const eye = mat(0xffe040, { emissive: 0xffd020, emissiveIntensity: 1.5 });
    eye.userData.glow = true;

    // --- torso
    part(this.body, new THREE.SphereGeometry(1, 8, 6), this.bodyMat, [0, 2.5, 0], [0, 0, 0], [1.7, 1.45, 2.6]);
    for (let i = 0; i < 5; i++) {
      part(this.body, new THREE.BoxGeometry(1.5 - Math.abs(i - 2) * 0.2, 0.18, 0.6), belly, [0, 1.15 + Math.abs(i - 2) * 0.12, -1.3 + i * 0.65], [0.1 * (i - 2), 0, 0]);
    }
    for (let i = 0; i < 6; i++) {
      part(this.body, new THREE.ConeGeometry(0.22, 0.7 - i * 0.05, 4), dark, [0, 3.95 - Math.abs(i - 2) * 0.12, 1.4 - i * 0.6], [-0.4, 0, 0]);
    }

    // --- legs (front pair taller)
    for (const [x, z, h, phase] of [
      [-1.25, 1.3, 2.0, 0],
      [1.25, 1.3, 2.0, Math.PI],
      [-1.35, -1.4, 1.8, Math.PI],
      [1.35, -1.4, 1.8, 0],
    ] as const) {
      const pivot = new THREE.Group();
      pivot.position.set(x, h, z);
      this.body.add(pivot);
      part(pivot, new THREE.SphereGeometry(0.55, 6, 5), this.bodyMat, [0, -0.2, 0], [0, 0, 0], [1, 1.3, 1.1]);
      part(pivot, new THREE.CylinderGeometry(0.32, 0.28, h - 0.3, 6), dark, [0, -h / 2, 0.05]);
      part(pivot, new THREE.BoxGeometry(0.6, 0.25, 0.8), dark, [0, -h + 0.1, 0.25]);
      for (const cx of [-0.18, 0, 0.18]) part(pivot, new THREE.ConeGeometry(0.07, 0.25, 4), horn, [cx, -h + 0.08, 0.72], [Math.PI / 2, 0, 0]);
      this.legs.push({ pivot, phase });
    }

    // --- tail: chained segments so it can sway
    let parent: THREE.Object3D = this.body;
    let pos = new THREE.Vector3(0, 2.4, -2.4);
    for (let i = 0; i < 5; i++) {
      const seg = new THREE.Group();
      seg.position.copy(pos);
      parent.add(seg);
      const r = 0.6 - i * 0.11;
      part(seg, new THREE.CylinderGeometry(r * 0.8, r, 1.2, 6).rotateX(Math.PI / 2 - 0.2), i % 2 ? dark : this.bodyMat, [0, -0.1, -0.55]);
      part(seg, new THREE.ConeGeometry(0.12, 0.4 - i * 0.05, 4), dark, [0, r * 0.9, -0.5], [-0.5, 0, 0]);
      this.tail.push(seg);
      parent = seg;
      pos = new THREE.Vector3(0, -0.2, -1.1);
    }
    part(parent, new THREE.ConeGeometry(0.35, 0.8, 4).rotateX(-Math.PI / 2), horn, [0, -0.2, -1.4]);

    // --- wings
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 1.2, 3.6, 0.6);
      pivot.rotation.x = -0.3; // swept back
      this.body.add(pivot);
      const span = 4.6;
      // Leading-edge strut and fingers.
      part(pivot, new THREE.CylinderGeometry(0.1, 0.06, span, 5).rotateZ(Math.PI / 2), dark, [(side * span) / 2, 0.3, 0]);
      const tips: THREE.Vector3[] = [];
      for (let f = 0; f < 3; f++) {
        const len = 3.2 - f * 0.6;
        const ang = -0.35 - f * 0.45;
        const base = new THREE.Vector3(side * span * (0.95 - f * 0.25), 0.3, 0);
        const tip = base.clone().add(new THREE.Vector3(side * Math.sin(-ang) * len * 0.3, -Math.cos(ang) * len * 0.15, -len));
        const mid = base.clone().add(tip).multiplyScalar(0.5);
        const strut = part(pivot, new THREE.CylinderGeometry(0.04, 0.03, base.distanceTo(tip), 4), dark, [mid.x, mid.y, mid.z]);
        strut.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tip.clone().sub(base).normalize());
        tips.push(tip);
      }
      // Membrane: fan from the shoulder through the finger tips.
      const pts = [new THREE.Vector3(0, 0.3, 0), new THREE.Vector3(side * span, 0.3, 0), ...tips, new THREE.Vector3(0, 0, -2.2)];
      const verts: number[] = [];
      for (let i = 1; i < pts.length - 1; i++) verts.push(...pts[0].toArray(), ...pts[i].toArray(), ...pts[i + 1].toArray());
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      geo.computeVertexNormals();
      part(pivot, geo, membrane);
      this.wings.push(pivot);
    }

    // --- neck & head
    this.neck.position.set(0, 3.2, 2.0);
    this.body.add(this.neck);
    for (let i = 0; i < 3; i++) {
      part(this.neck, new THREE.CylinderGeometry(0.55 - i * 0.07, 0.65 - i * 0.07, 0.9, 6).rotateX(Math.PI / 2 - 0.7), i % 2 ? dark : this.bodyMat, [0, 0.35 + i * 0.55, 0.35 + i * 0.5]);
      part(this.neck, new THREE.ConeGeometry(0.12, 0.35, 4), dark, [0, 0.85 + i * 0.55, 0.15 + i * 0.5], [-0.6, 0, 0]);
    }
    this.headGroup.position.set(0, 1.9, 1.75);
    this.neck.add(this.headGroup);
    part(this.headGroup, new THREE.BoxGeometry(1.0, 0.7, 1.1), this.headMat, [0, 0.1, 0]);
    part(this.headGroup, new THREE.CylinderGeometry(0.32, 0.45, 0.9, 4).rotateX(Math.PI / 2).rotateZ(Math.PI / 4), this.headMat, [0, 0.0, 0.85]); // snout
    for (const sx of [-0.32, 0.32]) {
      part(this.headGroup, new THREE.OctahedronGeometry(0.1), eye, [sx, 0.3, 0.45]);
      part(this.headGroup, new THREE.ConeGeometry(0.12, 0.9, 5), horn, [sx * 1.2, 0.55, -0.4], [-1.1, 0, -sx * 0.8]);
      part(this.headGroup, new THREE.ConeGeometry(0.07, 0.4, 4), horn, [sx * 1.4, 0.15, -0.3], [-1.3, 0, -sx * 2]);
    }
    for (let i = 0; i < 3; i++) part(this.headGroup, new THREE.ConeGeometry(0.06, 0.25, 4), horn, [0, 0.45, 0.3 - i * 0.3], [-0.5, 0, 0]);
    // Lower jaw hinged at the back of the head.
    this.jaw.position.set(0, -0.2, 0.0);
    this.headGroup.add(this.jaw);
    part(this.jaw, new THREE.BoxGeometry(0.8, 0.22, 1.3), dark, [0, -0.08, 0.65]);
    for (const sx of [-0.25, 0.25]) for (let i = 0; i < 3; i++) part(this.jaw, new THREE.ConeGeometry(0.04, 0.14, 4), horn, [sx, 0.08, 0.4 + i * 0.3]);

    this.weakMat = new THREE.MeshBasicMaterial({ color: 0xffff60, transparent: true, opacity: 0, depthWrite: false });
    this.headGroup.add(new THREE.Mesh(new THREE.SphereGeometry(0.95, 10, 8), this.weakMat));

    this.flameMat = new THREE.MeshBasicMaterial({ color: 0xff7a20, transparent: true, opacity: 0, depthWrite: false });
    // As wide as the damage sector (half-arc), so the fire you see is the fire that hurts.
    const flameRadius = breathRange * Math.tan(THREE.MathUtils.degToRad(breathArcDeg) / 2);
    this.flame = new THREE.Mesh(new THREE.ConeGeometry(flameRadius, breathRange, 12, 1, true).rotateX(-Math.PI / 2), this.flameMat);
    this.flame.position.set(0, -0.1, 1.3 + breathRange / 2);
    this.headGroup.add(this.flame);

    this.group.add(this.body);
  }

  pose(p: DragonPoseParams): void {
    this.body.position.y = p.bodyLift;
    this.body.rotation.x = p.bodyPitch;
    this.neck.rotation.x = p.neckPitch;
    this.headGroup.rotation.x = -p.neckPitch * 0.4;
    this.jaw.rotation.x = p.jaw * 0.6;
    // Wings rest raised so they read in silhouette from the ground.
    this.wings[0].rotation.z = -(0.45 + p.wingFlap);
    this.wings[1].rotation.z = 0.45 + p.wingFlap;
    this.tail.forEach((seg, i) => (seg.rotation.y = Math.sin(p.time * 1.6 - i * 0.6) * 0.12));
    for (const leg of this.legs) leg.pivot.rotation.x = Number.isNaN(p.walk) ? 0 : Math.sin(p.walk + leg.phase) * 0.35;
    this.flameMat.opacity = p.flame;
    this.flame.visible = p.flame > 0;
    this.flame.scale.set(1 + Math.random() * 0.08 * p.flame, 1 + Math.random() * 0.08 * p.flame, 1);
    this.weakMat.opacity = p.weak;
    this.headMat.color.setHex(p.flash ? 0xffffff : p.headColor);
    this.bodyMat.emissive.setHex(p.flash ? 0x806060 : p.enraged ? 0x3a0a00 : 0x000000);
  }
}
