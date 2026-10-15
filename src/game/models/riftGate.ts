import * as THREE from 'three';
import { glowDecal, glowSprite } from '../world/glow';

// The Rift Gate on Pioneer 2's teleporter deck (DESIGN.md "Endgame: Falz Rifts"): a dark ring standing on a
// stepped hex plinth, crowned with Falz crystal spikes, holding a swirling violet vortex. Solid from every side
// (the ring and spikes are real geometry; the vortex is double-sided), with orbiting shards and rising motes.

const VIOLET = 0xb070ff;
const DEEP = 0x5a1aa8;
const RING_R = 1.45;
const CENTER_Y = 2.15;

/** A swirling vortex: polar bands drawn in toward a black core, a bright violet rim. */
function vortexMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uA: { value: new THREE.Color(VIOLET) }, uB: { value: new THREE.Color(DEEP) } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec3 uA; uniform vec3 uB;
      varying vec2 vUv;
      void main() {
        vec2 p = vUv * 2.0 - 1.0;
        float r = length(p);
        if (r > 1.0) discard;
        float a = atan(p.y, p.x);
        // Spiral arms pulled inward over time, with a second slower layer for depth.
        float arms = sin(a * 4.0 + r * 9.0 - uTime * 2.2) * 0.5 + 0.5;
        float arms2 = sin(a * 7.0 - r * 14.0 + uTime * 1.3) * 0.5 + 0.5;
        float band = pow(arms, 3.0) * 0.75 + pow(arms2, 4.0) * 0.35;
        vec3 col = mix(uB, uA, band) * smoothstep(0.05, 0.75, r);
        // Bright rim and a black heart.
        col += uA * smoothstep(0.75, 0.98, r) * 0.7;
        col *= 0.35 + 0.65 * smoothstep(0.0, 0.35, r);
        float alpha = smoothstep(1.0, 0.92, r);
        gl_FragColor = vec4(col, alpha);
      }`,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
}

export class RiftGateModel {
  readonly root = new THREE.Group();
  private vortex: THREE.ShaderMaterial;
  private ring = new THREE.Group();
  private shards: THREE.Mesh[] = [];
  private motes: THREE.Points;
  private moteSeed: Float32Array;
  private halo: THREE.Sprite;
  private trim: THREE.MeshBasicMaterial;

  constructor() {
    const dark = new THREE.MeshStandardMaterial({ color: 0x1c1628, metalness: 0.65, roughness: 0.35, flatShading: true });
    const steel = new THREE.MeshStandardMaterial({ color: 0x3a3450, metalness: 0.7, roughness: 0.3, flatShading: true });
    const crystal = new THREE.MeshStandardMaterial({ color: 0x2a1048, emissive: VIOLET, emissiveIntensity: 0.55, metalness: 0.2, roughness: 0.25, flatShading: true });
    this.trim = new THREE.MeshBasicMaterial({ color: VIOLET, transparent: true });

    // Stepped hex plinth with glowing trim.
    const step1 = new THREE.Mesh(new THREE.CylinderGeometry(2.05, 2.2, 0.18, 6), dark);
    step1.position.y = 0.09;
    const step2 = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.75, 0.2, 6), steel);
    step2.position.y = 0.28;
    const trimRing = new THREE.Mesh(new THREE.TorusGeometry(1.68, 0.03, 4, 6), this.trim);
    trimRing.rotation.x = Math.PI / 2;
    trimRing.rotation.z = Math.PI / 6;
    trimRing.position.y = 0.39;
    this.root.add(step1, step2, trimRing, glowDecal(VIOLET, 6.5, 0.35));

    // The ring: a dark outer band, a lit inner lip, two feet planted in the plinth.
    this.ring.position.y = CENTER_Y;
    const band = new THREE.Mesh(new THREE.TorusGeometry(RING_R, 0.16, 8, 48), dark);
    const lip = new THREE.Mesh(new THREE.TorusGeometry(RING_R - 0.13, 0.04, 6, 48), this.trim);
    this.ring.add(band, lip);
    for (const side of [-1, 1]) {
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.9, 0.42), steel);
      foot.position.set(side * 0.95, -RING_R + 0.05, 0);
      foot.rotation.z = side * 0.55;
      this.ring.add(foot);
    }
    // Falz spikes crowning the ring: longest at the top, shorter down the sides, leaning outward.
    const spikes = 11;
    for (let i = 0; i < spikes; i++) {
      const a = Math.PI / 2 + ((i - (spikes - 1) / 2) / (spikes - 1)) * Math.PI * 1.1;
      const len = 0.35 + 0.45 * Math.cos((a - Math.PI / 2) * 0.9) ** 2 + (i % 2) * 0.12;
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.12, len, 5), crystal);
      spike.position.set(Math.cos(a) * (RING_R + 0.1 + len / 2), Math.sin(a) * (RING_R + 0.1 + len / 2), 0);
      spike.rotation.z = a - Math.PI / 2;
      this.ring.add(spike);
    }
    // Studs around the band, front and back, so it reads as machined from any side.
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      for (const z of [-0.15, 0.15]) {
        const stud = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.06), this.trim);
        stud.position.set(Math.cos(a) * RING_R, Math.sin(a) * RING_R, z);
        stud.rotation.z = a;
        this.ring.add(stud);
      }
    }
    this.vortex = vortexMaterial();
    const disc = new THREE.Mesh(new THREE.CircleGeometry(RING_R - 0.12, 48), this.vortex);
    this.ring.add(disc);
    this.root.add(this.ring);

    this.halo = glowSprite(VIOLET, 5.2, 0.35);
    this.halo.position.y = CENTER_Y;
    this.root.add(this.halo);

    // Shards orbiting the ring.
    for (let i = 0; i < 5; i++) {
      const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.13).scale(0.6, 1.8, 0.6), crystal);
      m.userData.phase = (i / 5) * Math.PI * 2;
      this.shards.push(m);
      this.root.add(m);
    }

    // Motes drifting up from the plinth into the vortex.
    const n = 40;
    this.moteSeed = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      this.moteSeed[i * 3] = Math.random() * Math.PI * 2;
      this.moteSeed[i * 3 + 1] = 0.4 + Math.random() * 1.4;
      this.moteSeed[i * 3 + 2] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    this.motes = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ color: 0xd8b8ff, size: 0.07, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.root.add(this.motes);
    this.update(0);
  }

  update(t: number): void {
    this.vortex.uniforms.uTime.value = t;
    this.trim.opacity = 0.75 + Math.sin(t * 2.4) * 0.25;
    this.halo.material.opacity = 0.3 + Math.sin(t * 1.7) * 0.08;
    this.shards.forEach((m, i) => {
      const a = t * 0.6 + m.userData.phase;
      const r = RING_R + 0.75;
      m.position.set(Math.cos(a) * r, CENTER_Y + Math.sin(a) * r * 0.9, Math.sin(t * 0.9 + i) * 0.35);
      m.rotation.set(0, t * 1.5 + i, a);
    });
    const pos = this.motes.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const [a0, rad, ph] = [this.moteSeed[i * 3], this.moteSeed[i * 3 + 1], this.moteSeed[i * 3 + 2]];
      const k = (t * 0.25 + ph) % 1;
      const a = a0 + k * 2.5;
      const rr = rad * (1 - k * 0.8);
      pos.setXYZ(i, Math.cos(a) * rr, 0.4 + k * CENTER_Y * 1.2, Math.sin(a) * rr * 0.6);
    }
    pos.needsUpdate = true;
  }
}
