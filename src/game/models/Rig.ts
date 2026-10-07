import * as THREE from 'three';

// A tiny procedural rig: a hierarchy of pivot groups with low-poly,
// flat-shaded parts. Poses are joint rotations (offsets from the rest pose)
// that the rig eases toward, so transitions blend automatically.

export type JointName =
  | 'hips'
  | 'spine'
  | 'chest'
  | 'head'
  | 'shoulderL'
  | 'elbowL'
  | 'handL'
  | 'shoulderR'
  | 'elbowR'
  | 'handR'
  | 'hipL'
  | 'kneeL'
  | 'hipR'
  | 'kneeR'
  | 'tail';

export type Euler3 = [number, number, number];

export interface Pose {
  joints: Partial<Record<JointName, Euler3>>;
  /** Vertical offset of the hips (bobbing, crouching). */
  lift?: number;
}

export function mat(color: number, opts: { emissive?: number; emissiveIntensity?: number; flat?: boolean; rough?: number } = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    flatShading: opts.flat ?? true,
    roughness: opts.rough ?? 0.75,
    metalness: 0.05,
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 1,
  });
}

/** Add a mesh to a parent at a position (and optional rotation / scale). */
export function part(
  parent: THREE.Object3D,
  geo: THREE.BufferGeometry,
  material: THREE.Material,
  pos: [number, number, number] = [0, 0, 0],
  rot: [number, number, number] = [0, 0, 0],
  scale: [number, number, number] = [1, 1, 1],
): THREE.Mesh {
  const m = new THREE.Mesh(geo, material);
  m.position.set(...pos);
  m.rotation.set(...rot);
  m.scale.set(...scale);
  m.castShadow = true;
  parent.add(m);
  return m;
}

/** Cylinder hanging down from its pivot (length along -Y). */
export function limbGeo(rTop: number, rBottom: number, length: number, segs = 6): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(rTop, rBottom, length, segs).translate(0, -length / 2, 0);
}

const ALL_JOINTS: JointName[] = [
  'hips', 'spine', 'chest', 'head', 'shoulderL', 'elbowL', 'handL', 'shoulderR', 'elbowR', 'handR',
  'hipL', 'kneeL', 'hipR', 'kneeR', 'tail',
];

export class Rig {
  readonly root = new THREE.Group();
  readonly joints = {} as Record<JointName, THREE.Group>;
  private rest = {} as Record<JointName, THREE.Euler>;
  private cur = {} as Record<JointName, THREE.Vector3>;
  private hipsY = 0;
  private lift = 0;
  /** Materials that receive status tints (fur / cloth). */
  readonly tintable: THREE.MeshStandardMaterial[] = [];
  /** Every material, for emissive flashes. */
  readonly materials = new Set<THREE.MeshStandardMaterial>();

  constructor() {
    for (const j of ALL_JOINTS) {
      this.joints[j] = new THREE.Group();
      this.joints[j].name = j;
      this.cur[j] = new THREE.Vector3();
    }
  }

  /** Call once the hierarchy is built: records rest rotations. */
  finalize(): void {
    for (const j of ALL_JOINTS) this.rest[j] = this.joints[j].rotation.clone();
    this.hipsY = this.joints.hips.position.y;
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) if (m instanceof THREE.MeshStandardMaterial) this.materials.add(m);
      }
    });
  }

  /** Ease the rig toward a pose. rate: 1/seconds (higher = snappier); Infinity = snap. */
  apply(pose: Pose, dt: number, rate = 12): void {
    const k = rate === Infinity ? 1 : 1 - Math.exp(-rate * dt);
    for (const j of ALL_JOINTS) {
      const t = pose.joints[j];
      const c = this.cur[j];
      c.x += ((t?.[0] ?? 0) - c.x) * k;
      c.y += ((t?.[1] ?? 0) - c.y) * k;
      c.z += ((t?.[2] ?? 0) - c.z) * k;
      const r = this.rest[j];
      this.joints[j].rotation.set(r.x + c.x, r.y + c.y, r.z + c.z);
    }
    this.lift += ((pose.lift ?? 0) - this.lift) * k;
    this.joints.hips.position.y = this.hipsY + this.lift;
  }

  setEmissive(hex: number, intensity = 1): void {
    for (const m of this.materials) {
      if (m.userData.glow) continue; // photon parts keep their own glow
      if (m.userData.baseEmissive === undefined) {
        m.userData.baseEmissive = m.emissive.getHex();
        m.userData.baseEmissiveIntensity = m.emissiveIntensity;
      }
      // 0x000000 means "no effect": restore the material's own emissive (e.g. skin warmth).
      if (hex === 0) {
        m.emissive.setHex(m.userData.baseEmissive);
        m.emissiveIntensity = m.userData.baseEmissiveIntensity;
      } else {
        m.emissive.setHex(hex);
        m.emissiveIntensity = intensity;
      }
    }
  }
}
