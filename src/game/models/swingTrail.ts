import * as THREE from 'three';

// PSO1-style weapon trail: a ribbon swept by the blade, spanning from part way up the blade
// to its tip. Each frame of a swing records where the blade's base and tip are in world space;
// the ribbon joins those samples with Catmull-Rom curves (so even a fast cut sampled a handful
// of times reads as a clean arc) and fades out quickly, brightest along the tip edge.

const LIFE = 0.2; // seconds a sample lasts
const MAX_SAMPLES = 24;
const SUBDIV = 5; // ribbon segments between two samples
const MAX_VERTS = (MAX_SAMPLES - 1) * SUBDIV + 1;

interface Sample {
  base: THREE.Vector3;
  tip: THREE.Vector3;
  color: THREE.Color;
  age: number;
  /** First sample of a new cut: the ribbon doesn't bridge back to the previous one. */
  start: boolean;
}

// tint: rgb = photon colour, a = fade (age); side: 0 on the inner edge, 1 at the tip.
const vert = /* glsl */ `
  attribute vec4 tint;
  attribute float side;
  varying vec4 vTint;
  varying float vSide;
  void main() {
    vTint = tint;
    vSide = side;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const frag = /* glsl */ `
  uniform float strength;
  varying vec4 vTint;
  varying float vSide;
  void main() {
    // A soft band that thickens toward the tip, with a hot whitened edge right at it.
    float band = 0.18 + 0.62 * smoothstep(0.0, 1.0, vSide);
    float edge = smoothstep(0.82, 1.0, vSide);
    vec3 col = mix(vTint.rgb, vec3(1.0), edge * 0.55) * (band + edge * 0.6);
    gl_FragColor = vec4(col * vTint.a * strength, 1.0);
  }
`;

const catmull = (p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3, t: number, out: THREE.Vector3) => {
  const t2 = t * t;
  const t3 = t2 * t;
  const a = -0.5 * t3 + t2 - 0.5 * t;
  const b = 1.5 * t3 - 2.5 * t2 + 1;
  const c = -1.5 * t3 + 2 * t2 + 0.5 * t;
  const d = 0.5 * t3 - 0.5 * t2;
  return out.set(
    a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    a * p0.y + b * p1.y + c * p2.y + d * p3.y,
    a * p0.z + b * p1.z + c * p2.z + d * p3.z,
  );
};

export class SwingTrail {
  readonly mesh: THREE.Mesh;
  private readonly samples: Sample[] = [];
  private readonly pos: THREE.BufferAttribute;
  private readonly tint: THREE.BufferAttribute;
  private readonly index: THREE.BufferAttribute;
  private readonly geo = new THREE.BufferGeometry();
  private readonly mat: THREE.ShaderMaterial;
  private wasEmitting = false;
  private readonly tmp = { a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Color() };

  constructor() {
    this.pos = new THREE.BufferAttribute(new Float32Array(MAX_VERTS * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.tint = new THREE.BufferAttribute(new Float32Array(MAX_VERTS * 2 * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', this.pos);
    this.geo.setAttribute('tint', this.tint);
    const side = new Float32Array(MAX_VERTS * 2);
    for (let i = 0; i < MAX_VERTS; i++) side[i * 2 + 1] = 1;
    this.geo.setAttribute('side', new THREE.BufferAttribute(side, 1));
    this.index = new THREE.BufferAttribute(new Uint16Array((MAX_VERTS - 1) * 6), 1).setUsage(THREE.DynamicDrawUsage);
    this.geo.setIndex(this.index);
    this.geo.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: { strength: { value: 1 } },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
  }

  /** Overall brightness (dimmed in areas with bloom, like the weapon's photon glow). */
  set strength(v: number) {
    this.mat.uniforms.strength.value = v;
  }

  /**
   * Age the trail and, while `emit`, add a sample of the blade (world-space base and tip).
   * Call once per frame.
   */
  update(dt: number, emit: boolean, base?: THREE.Vector3, tip?: THREE.Vector3, color?: THREE.ColorRepresentation): void {
    for (const s of this.samples) s.age += dt;
    while (this.samples.length && this.samples[0].age >= LIFE) this.samples.shift();
    if (emit && base && tip) {
      const s: Sample = { base: base.clone(), tip: tip.clone(), color: new THREE.Color(color ?? 0xffffff), age: 0, start: !this.wasEmitting };
      this.samples.push(s);
      if (this.samples.length > MAX_SAMPLES) this.samples.shift();
    }
    this.wasEmitting = emit;
    this.rebuild();
  }

  clear(): void {
    this.samples.length = 0;
    this.wasEmitting = false;
    this.geo.setDrawRange(0, 0);
  }

  private rebuild(): void {
    const S = this.samples;
    const P = this.pos.array as Float32Array;
    const T = this.tint.array as Float32Array;
    const I = this.index.array as Uint16Array;
    let v = 0; // ribbon columns written
    let n = 0; // indices written
    const { a, b, c } = this.tmp;
    // Each run of samples that belongs to one cut is its own strip.
    let i = 0;
    while (i < S.length) {
      let j = i + 1;
      while (j < S.length && !S[j].start) j++;
      const run = S.slice(i, j);
      const first = v;
      if (run.length >= 2) {
        for (let k = 0; k < run.length - 1; k++) {
          const p0 = run[Math.max(0, k - 1)], p1 = run[k], p2 = run[k + 1], p3 = run[Math.min(run.length - 1, k + 2)];
          const steps = k === run.length - 2 ? SUBDIV + 1 : SUBDIV;
          for (let s = 0; s < steps; s++) {
            if (v >= MAX_VERTS) break;
            const t = s / SUBDIV;
            catmull(p0.base, p1.base, p2.base, p3.base, t, a);
            catmull(p0.tip, p1.tip, p2.tip, p3.tip, t, b);
            const age = p1.age + (p2.age - p1.age) * t;
            c.copy(p1.color).lerp(p2.color, t);
            // Fade with age, so the old end of the cut thins out first.
            const life = Math.max(0, 1 - age / LIFE);
            const fade = Math.pow(life, 1.4);
            const o = v * 6;
            P[o] = a.x; P[o + 1] = a.y; P[o + 2] = a.z;
            P[o + 3] = b.x; P[o + 4] = b.y; P[o + 5] = b.z;
            const q = v * 8;
            T[q] = T[q + 4] = c.r;
            T[q + 1] = T[q + 5] = c.g;
            T[q + 2] = T[q + 6] = c.b;
            T[q + 3] = T[q + 7] = fade;
            v++;
          }
        }
        // Quads only within this strip, so separate cuts never bridge.
        for (let k = first; k < v - 1; k++) {
          const a0 = k * 2;
          I[n++] = a0; I[n++] = a0 + 1; I[n++] = a0 + 2;
          I[n++] = a0 + 1; I[n++] = a0 + 3; I[n++] = a0 + 2;
        }
      }
      i = j;
    }
    this.pos.needsUpdate = true;
    this.tint.needsUpdate = true;
    this.index.needsUpdate = true;
    this.geo.setDrawRange(0, n);
  }
}
