import * as THREE from 'three';

// Cheap "glow" without a bloom pass: additive soft-dot sprites and floor decals.

let tex: THREE.DataTexture | null = null;

/** Alpha falloff stops: [radius 0..1, alpha]. */
const FALLOFF: [number, number][] = [
  [0, 1],
  [0.25, 0.55],
  [0.6, 0.12],
  [1, 0],
];

/**
 * Shared white radial falloff (never disposed: materials don't own their maps).
 * Built as a DataTexture so levels can also be constructed without a DOM (tests).
 */
export function glowTexture(): THREE.DataTexture {
  if (tex) return tex;
  const size = 128;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const d = Math.min(1, Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) / (size / 2));
      let a = 0;
      for (let i = 1; i < FALLOFF.length; i++) {
        const [r0, a0] = FALLOFF[i - 1];
        const [r1, a1] = FALLOFF[i];
        if (d <= r1) {
          a = a0 + ((d - r0) / (r1 - r0)) * (a1 - a0);
          break;
        }
      }
      data.set([255, 255, 255, Math.round(a * 255)], (y * size + x) * 4);
    }
  tex = new THREE.DataTexture(data, size, size);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/** Camera-facing halo. */
export function glowSprite(color: number, size: number, opacity: number): THREE.Sprite {
  const s = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTexture(),
      color,
      opacity,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  s.scale.setScalar(size);
  return s;
}

/** Soft-edged decal material: additive for glows, normal blending for dark blotches (scorch marks). */
export function glowMaterial(color: number, opacity: number, additive = true): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    map: glowTexture(),
    color,
    opacity,
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
}

let markerTex: THREE.DataTexture | null = null;

/** White ▲ with a darker rim (the material colour tints both), for camera-facing marker sprites. */
export function markerTexture(): THREE.DataTexture {
  if (markerTex) return markerTex;
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  // Counter-clockwise corners in -1..1 (row 0 is the bottom of a DataTexture).
  const pts: [number, number][] = [[-0.85, -0.65], [0.85, -0.65], [0, 0.8]];
  const px = 2 / size;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = ((x + 0.5) / size) * 2 - 1;
      const v = ((y + 0.5) / size) * 2 - 1;
      // Distance inside the triangle: the nearest edge, positive inside.
      let d = Infinity;
      for (let i = 0; i < 3; i++) {
        const [ax, ay] = pts[i];
        const [bx, by] = pts[(i + 1) % 3];
        d = Math.min(d, ((bx - ax) * (v - ay) - (by - ay) * (u - ax)) / Math.hypot(bx - ax, by - ay));
      }
      const a = Math.min(1, Math.max(0, (d + px) / (2 * px)));
      const rim = 0.12;
      const shade = d >= rim ? 255 : Math.round(70 + (185 * Math.max(0, d)) / rim);
      data.set([shade, shade, shade, Math.round(a * 255)], (y * size + x) * 4);
    }
  markerTex = new THREE.DataTexture(data, size, size);
  markerTex.magFilter = THREE.LinearFilter;
  markerTex.minFilter = THREE.LinearMipmapLinearFilter;
  markerTex.generateMipmaps = true;
  markerTex.needsUpdate = true;
  return markerTex;
}

/** Flat glow pool lying on the floor. */
export function glowDecal(color: number, size: number, opacity: number): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2), glowMaterial(color, opacity));
  m.position.y = 0.03;
  m.renderOrder = 1;
  return m;
}
