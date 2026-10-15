import * as THREE from 'three';
import type { WeaponKind } from '../data/items';
import type { Grip } from './humanoid';
import { mat, part } from './Rig';

/** How each weapon kind is held (idle / run / shoot poses). */
export const WEAPON_GRIP: Record<WeaponKind, Grip> = {
  saber: 'melee',
  sword: 'melee',
  dagger: 'melee',
  handgun: 'gun',
  rifle: 'rifle',
  shot: 'rifle',
  rod: 'melee',
  wand: 'melee',
};

// Low-poly weapons. Each points along +Z from its grip at the origin. Flat blades are
// wide along Y (the plane of the fist and forearm), so the edge leads a cut and the
// flat faces sideways when held; guards run the same way, past the edges.
// Photon parts use materials flagged userData.glow so rig flashes skip them.

export interface WeaponModel {
  group: THREE.Group;
  /** Photon materials whose emissive colour signals attack type. */
  glow: THREE.MeshStandardMaterial[];
  /** Melee swing trail span along the weapon's +Z axis (from, to), in grip space. */
  trail?: [number, number];
}

// Where the swing trail runs: most of a blade, or just the head of a pole or staff.
const TRAIL_SPAN: Partial<Record<WeaponKind, [number, number]>> = {
  saber: [0.28, 1.12],
  sword: [0.3, 1.7],
  dagger: [0.12, 0.47],
  rod: [0.85, 1.19],
  wand: [0.36, 0.63],
};

function glowMat(color: number): THREE.MeshStandardMaterial {
  const m = mat(color, { emissive: color, emissiveIntensity: 0.9 });
  m.userData.glow = true;
  return m;
}

const metal = () => mat(0x8a8f9c, { rough: 0.4 });
const dark = () => mat(0x30323a, { rough: 0.6 });

export function buildWeapon(kind: WeaponKind | 'none', color: number): WeaponModel {
  const g = new THREE.Group();
  const glow: THREE.MeshStandardMaterial[] = [];
  const Z = (geo: THREE.BufferGeometry) => geo.rotateX(Math.PI / 2); // cylinders/cones along Z
  const photon = (c = color) => {
    const m = glowMat(c);
    glow.push(m);
    return m;
  };

  switch (kind) {
    case 'saber': {
      part(g, Z(new THREE.CylinderGeometry(0.03, 0.03, 0.2, 6)), dark(), [0, 0, 0]);
      part(g, new THREE.BoxGeometry(0.04, 0.1, 0.04), metal(), [0, 0, 0.11]);
      part(g, new THREE.BoxGeometry(0.045, 0.045, 1.0), photon(), [0, 0, 0.62]);
      break;
    }
    case 'sword': {
      part(g, Z(new THREE.CylinderGeometry(0.035, 0.035, 0.32, 6)), dark(), [0, 0, -0.04]);
      part(g, new THREE.BoxGeometry(0.06, 0.28, 0.06), metal(), [0, 0, 0.13]);
      part(g, new THREE.BoxGeometry(0.035, 0.16, 1.35), photon(), [0, 0, 0.84]);
      part(g, Z(new THREE.ConeGeometry(0.11, 0.2, 4)), photon(), [0, 0, 1.6], [0, 0, 0], [0.16, 1, 1]); // flat arrowhead
      break;
    }
    case 'dagger': {
      part(g, Z(new THREE.CylinderGeometry(0.025, 0.025, 0.12, 6)), dark());
      part(g, new THREE.BoxGeometry(0.03, 0.08, 0.03), metal(), [0, 0, 0.07]);
      part(g, new THREE.BoxGeometry(0.02, 0.05, 0.38), photon(), [0, 0, 0.28]);
      break;
    }
    case 'handgun': {
      part(g, new THREE.BoxGeometry(0.06, 0.12, 0.07), dark(), [0, -0.02, -0.02], [0.3, 0, 0]);
      part(g, new THREE.BoxGeometry(0.08, 0.1, 0.28), metal(), [0, 0.07, 0.08]);
      part(g, Z(new THREE.CylinderGeometry(0.025, 0.025, 0.14, 6)), dark(), [0, 0.08, 0.28]);
      part(g, new THREE.BoxGeometry(0.04, 0.018, 0.2), photon(), [0, 0.129, 0.08]); // top rail (body top is y=0.12)
      break;
    }
    case 'rifle': {
      part(g, new THREE.BoxGeometry(0.06, 0.12, 0.08), dark(), [0, -0.03, 0], [0.3, 0, 0]);
      part(g, new THREE.BoxGeometry(0.08, 0.1, 0.7), metal(), [0, 0.06, 0.25]);
      part(g, new THREE.BoxGeometry(0.07, 0.12, 0.25), dark(), [0, 0.03, -0.2]);
      part(g, Z(new THREE.CylinderGeometry(0.022, 0.022, 0.4, 6)), dark(), [0, 0.07, 0.78]);
      part(g, Z(new THREE.CylinderGeometry(0.035, 0.035, 0.22, 6)), dark(), [0, 0.15, 0.2]);
      part(g, new THREE.BoxGeometry(0.04, 0.018, 0.24), photon(), [0, 0.119, 0.46]); // top rail ahead of the scope (body top is y=0.11)
      break;
    }
    case 'shot': {
      // Stubby wide-bodied gun with a flared muzzle.
      part(g, new THREE.BoxGeometry(0.06, 0.12, 0.08), dark(), [0, -0.03, 0], [0.3, 0, 0]);
      part(g, new THREE.BoxGeometry(0.07, 0.11, 0.24), dark(), [0, 0.03, -0.2]);
      part(g, new THREE.BoxGeometry(0.15, 0.13, 0.46), metal(), [0, 0.07, 0.2]);
      part(g, Z(new THREE.CylinderGeometry(0.1, 0.06, 0.16, 8)), dark(), [0, 0.07, 0.5]);
      part(g, new THREE.BoxGeometry(0.1, 0.05, 0.12), dark(), [0, -0.02, 0.3]);
      part(g, new THREE.BoxGeometry(0.08, 0.018, 0.32), photon(), [0, 0.144, 0.18]); // top rail (body top is y=0.135)
      break;
    }
    case 'rod': {
      part(g, Z(new THREE.CylinderGeometry(0.025, 0.03, 1.55, 6)), metal(), [0, 0, 0.3]);
      part(g, new THREE.TorusGeometry(0.11, 0.02, 4, 10), metal(), [0, 0, 1.12]);
      part(g, new THREE.OctahedronGeometry(0.07), photon(), [0, 0, 1.12]);
      part(g, Z(new THREE.ConeGeometry(0.04, 0.12, 6)), metal(), [0, 0, -0.5], [Math.PI, 0, 0]);
      break;
    }
    case 'wand': {
      part(g, Z(new THREE.CylinderGeometry(0.018, 0.022, 0.6, 6)), mat(0xf0f0f0), [0, 0, 0.18]);
      part(g, new THREE.OctahedronGeometry(0.075), photon(), [0, 0, 0.55]);
      part(g, new THREE.TorusGeometry(0.06, 0.012, 4, 8), photon(), [0, 0, 0.55], [0, Math.PI / 2, 0]);
      break;
    }
    case 'none':
      break;
  }
  return { group: g, glow, trail: kind === 'none' ? undefined : TRAIL_SPAN[kind] };
}
