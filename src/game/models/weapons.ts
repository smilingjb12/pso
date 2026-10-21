import * as THREE from 'three';
import type { WeaponKind } from '../data/items';
import type { Grip } from './humanoid';
import { mat, part } from './Rig';

/** How each weapon kind is held (idle / run poses). */
export const WEAPON_GRIP: Record<WeaponKind, Grip> = {
  rod: 'melee',
  wand: 'melee',
};

// Low-poly weapons. Each points along +Z from its grip at the origin.
// Photon parts use materials flagged userData.glow so rig flashes skip them.

export interface WeaponModel {
  group: THREE.Group;
  /** Photon materials whose emissive colour signals attack type. */
  glow: THREE.MeshStandardMaterial[];
}

function glowMat(color: number): THREE.MeshStandardMaterial {
  const m = mat(color, { emissive: color, emissiveIntensity: 0.9 });
  m.userData.glow = true;
  return m;
}

const metal = () => mat(0x8a8f9c, { rough: 0.4 });

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
  return { group: g, glow };
}
