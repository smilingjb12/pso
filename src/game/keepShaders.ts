import type * as THREE from 'three';

/**
 * Keep every compiled built-in shader for the session (2026-10-23, the user: Foie on a training dummy hitched as it
 * hit). Spell effects make a material each and dispose it when they fade, and three.js deletes a shader program along
 * with the last material using it, so the next Foie after a short pause compiled its trail's shader again on the cast
 * and its scorch mark's on the hit: a dropped frame each (Zonde too, but its stall lands on the cast). One extra use
 * on each program keeps it. ShaderMaterials are left alone: theirs are keyed by shader ids that change once released,
 * so kept ones would never be reused, only pile up.
 */
const kept = new WeakSet<object>();

export function keepShaders(renderer: THREE.WebGLRenderer): void {
  for (const program of renderer.info.programs ?? []) {
    if (kept.has(program)) continue;
    kept.add(program);
    const type = (program as unknown as { type: string }).type;
    if (type === 'ShaderMaterial' || type === 'RawShaderMaterial') continue;
    program.usedTimes++;
  }
}
