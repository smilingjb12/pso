import * as THREE from 'three';
import type { WeaponKind } from '../data/items';
import type { Grip } from './humanoid';
import { mat, part } from './Rig';

/** How each weapon kind is held (idle / run / shoot poses). */
export const WEAPON_GRIP: Record<WeaponKind, Grip> = {
  saber: 'melee',
  sword: 'melee',
  dagger: 'melee',
  partisan: 'melee',
  slicer: 'gun',
  handgun: 'gun',
  rifle: 'rifle',
  mechgun: 'rifle',
  shot: 'rifle',
  cane: 'melee',
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
}

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
    case 'partisan': {
      // Long pole with a photon spearhead and two small side blades.
      part(g, Z(new THREE.CylinderGeometry(0.025, 0.025, 2.0, 6)), dark(), [0, 0, 0.35]);
      part(g, Z(new THREE.CylinderGeometry(0.04, 0.04, 0.1, 6)), metal(), [0, 0, 1.36]);
      part(g, Z(new THREE.ConeGeometry(0.075, 0.5, 4)), photon(), [0, 0, 1.66], [0, 0, Math.PI / 4]);
      for (const sx of [-1, 1]) part(g, new THREE.BoxGeometry(0.16, 0.02, 0.05), photon(), [sx * 0.09, 0, 1.43], [0, sx * 0.5, 0]);
      part(g, Z(new THREE.ConeGeometry(0.035, 0.1, 6)), metal(), [0, 0, -0.68], [Math.PI, 0, 0]);
      break;
    }
    case 'slicer': {
      // A hand-held throwing disc: hub, photon rim and three blades.
      part(g, new THREE.CylinderGeometry(0.06, 0.06, 0.05, 8), metal(), [0, 0, 0.2]);
      part(g, new THREE.TorusGeometry(0.2, 0.02, 4, 12), photon(), [0, 0, 0.2], [Math.PI / 2, 0, 0]);
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        part(g, new THREE.BoxGeometry(0.05, 0.02, 0.2), photon(), [Math.sin(a) * 0.12, 0, 0.2 + Math.cos(a) * 0.12], [0, a, 0]);
      }
      part(g, new THREE.BoxGeometry(0.03, 0.03, 0.14), dark(), [0, 0, 0.05]);
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
    case 'mechgun': {
      part(g, new THREE.BoxGeometry(0.06, 0.12, 0.07), dark(), [0, -0.03, 0], [0.3, 0, 0]);
      part(g, new THREE.BoxGeometry(0.13, 0.15, 0.38), metal(), [0, 0.07, 0.12]);
      for (const sx of [-0.035, 0.035]) part(g, Z(new THREE.CylinderGeometry(0.02, 0.02, 0.22, 6)), dark(), [sx, 0.08, 0.4]);
      part(g, new THREE.CylinderGeometry(0.07, 0.07, 0.1, 8), dark(), [0, -0.04, 0.16]);
      part(g, new THREE.BoxGeometry(0.07, 0.018, 0.3), photon(), [0, 0.154, 0.12]); // top rail (body top is y=0.145)
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
    case 'cane': {
      part(g, Z(new THREE.CylinderGeometry(0.022, 0.026, 1.15, 6)), mat(0x6a4a2a), [0, 0, 0.2]);
      part(g, new THREE.IcosahedronGeometry(0.07, 0), photon(), [0, 0, 0.82]);
      part(g, Z(new THREE.CylinderGeometry(0.035, 0.035, 0.05, 6)), metal(), [0, 0, 0.74]);
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
  return { group: g, glow };
}
