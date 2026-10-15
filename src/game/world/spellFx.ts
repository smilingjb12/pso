import * as THREE from 'three';
import type { Effect } from './Effects';
import { glowSprite, glowTexture } from './glow';
import type { TelegraphShape } from './Telegraph';

// Technique visuals (2026-10-14): soft and steady. Particles, fading ground marks, thin jagged lightning and ice
// that grows out of the floor; never a full-area flash on a rhythm (Rabarta's half-second pulses used to read as a
// strobe). Cosmetic only, so Math.random is fine here.

const rand = (a: number, b: number) => a + Math.random() * (b - a);

// ------------------------------------------------------------------ particles

/** How a batch of particles looks and moves. Additive: each fades to black (and so to nothing) over its life. */
export interface SparkSpec {
  color: number;
  /** The colour it turns on the way out (fire: yellow to red). */
  to?: number;
  life: [number, number];
  speed: [number, number];
  /** Which way they fly: every way, mostly up, flat outward, or down. */
  spread: 'sphere' | 'up' | 'ring' | 'down';
  /** World size of one particle. */
  size: number;
  /** Pull down per second² (negative lifts, like embers). */
  gravity?: number;
  /** Share of speed lost per second. */
  drag?: number;
  /** Spawn this far from the point, at random. */
  jitter?: number;
  /** Colour multiplier (keeps bloom in check). */
  brightness?: number;
}

/** A fixed pool of additive point particles; emitting reuses the oldest slot. */
class Sparks {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private col: Float32Array;
  private vel: Float32Array;
  private age: Float32Array;
  private life: Float32Array;
  private next = 0;
  private c0: THREE.Color;
  private c1: THREE.Color;
  private tmp = new THREE.Color();
  private geo = new THREE.BufferGeometry();
  private mat: THREE.PointsMaterial;

  constructor(private cap: number, private spec: SparkSpec) {
    this.pos = new Float32Array(cap * 3);
    this.col = new Float32Array(cap * 3);
    this.vel = new Float32Array(cap * 3);
    this.age = new Float32Array(cap);
    this.life = new Float32Array(cap);
    this.c0 = new THREE.Color(spec.color);
    this.c1 = new THREE.Color(spec.to ?? spec.color);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.mat = new THREE.PointsMaterial({
      size: spec.size,
      map: glowTexture(),
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
  }

  emit(n: number, x: number, y: number, z: number): void {
    const s = this.spec;
    for (let k = 0; k < n; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.cap;
      let dx: number, dy: number, dz: number;
      if (s.spread === 'ring') {
        const a = Math.random() * Math.PI * 2;
        dx = Math.cos(a);
        dy = rand(0.05, 0.25);
        dz = Math.sin(a);
      } else if (s.spread === 'down') {
        dx = rand(-0.2, 0.2);
        dy = -1;
        dz = rand(-0.2, 0.2);
      } else {
        // A random direction (rejection sampling keeps it even), lifted for 'up'.
        do {
          dx = rand(-1, 1);
          dy = rand(-1, 1);
          dz = rand(-1, 1);
        } while (dx * dx + dy * dy + dz * dz > 1 || dx * dx + dy * dy + dz * dz < 0.01);
        if (s.spread === 'up') dy = Math.abs(dy) * 0.7 + 0.5;
      }
      const len = Math.hypot(dx, dy, dz);
      const v = rand(s.speed[0], s.speed[1]) / len;
      const j = s.jitter ?? 0;
      const ja = Math.random() * Math.PI * 2;
      const jr = j * Math.sqrt(Math.random());
      this.pos.set([x + Math.cos(ja) * jr, y, z + Math.sin(ja) * jr], i * 3);
      this.vel.set([dx * v, dy * v, dz * v], i * 3);
      this.age[i] = 0;
      this.life[i] = rand(s.life[0], s.life[1]);
    }
  }

  /** Advance every particle; false once none is left alive. */
  update(dt: number): boolean {
    const s = this.spec;
    const drag = Math.max(0, 1 - (s.drag ?? 0) * dt);
    const g = (s.gravity ?? 0) * dt;
    const bright = s.brightness ?? 1;
    let alive = false;
    for (let i = 0; i < this.cap; i++) {
      if (this.age[i] >= this.life[i]) {
        this.col[i * 3] = this.col[i * 3 + 1] = this.col[i * 3 + 2] = 0;
        continue;
      }
      alive = true;
      this.age[i] += dt;
      const k = Math.min(1, this.age[i] / this.life[i]);
      this.vel[i * 3] *= drag;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * drag - g;
      this.vel[i * 3 + 2] *= drag;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] = Math.max(0.03, this.pos[i * 3 + 1] + this.vel[i * 3 + 1] * dt);
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const fade = (1 - k) ** 1.3 * bright;
      this.tmp.copy(this.c0).lerp(this.c1, k).multiplyScalar(fade);
      this.col[i * 3] = this.tmp.r;
      this.col[i * 3 + 1] = this.tmp.g;
      this.col[i * 3 + 2] = this.tmp.b;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    return alive;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}

/** A one-off spray of particles from a point (impacts, bursts). */
export class Burst implements Effect {
  readonly object: THREE.Points;
  private s: Sparks;

  constructor(x: number, y: number, z: number, count: number, spec: SparkSpec) {
    this.s = new Sparks(count, spec);
    this.s.emit(count, x, y, z);
    this.object = this.s.points;
  }

  update(dt: number): boolean {
    if (this.s.update(dt)) return true;
    this.s.dispose();
    return false;
  }
}

/** Particles shed behind something moving (a fireball, a meteor), with an optional glow on it. */
export class Trail implements Effect {
  readonly object = new THREE.Group();
  private s: Sparks;
  private acc = 0;
  private head: THREE.Sprite | null = null;

  constructor(private source: () => THREE.Vector3 | null, private rate: number, spec: SparkSpec, head?: { color: number; size: number }) {
    this.s = new Sparks(Math.ceil(rate * spec.life[1]) + 8, spec);
    this.object.add(this.s.points);
    if (head) {
      this.head = glowSprite(head.color, head.size, 0.85);
      this.object.add(this.head);
    }
  }

  update(dt: number): boolean {
    const at = this.source();
    if (at) {
      this.acc += this.rate * dt;
      for (; this.acc >= 1; this.acc--) this.s.emit(1, at.x, at.y, at.z);
      this.head?.position.copy(at);
    } else if (this.head) this.head.visible = false;
    const alive = this.s.update(dt);
    if (at || alive) return true;
    this.s.dispose();
    return false;
  }
}

/** A ball of light flying in a straight line from `from` to `to` over `seconds` (a meteor), shedding a trail. */
export class Fall implements Effect {
  readonly object = new THREE.Group();
  private t = 0;
  private at = new THREE.Vector3();
  private trail: Trail;

  constructor(private from: THREE.Vector3, private to: THREE.Vector3, private seconds: number, color: number, size: number, spec: SparkSpec) {
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(size, 1), new THREE.MeshBasicMaterial({ color: 0xfff0c0 }));
    core.name = 'core';
    this.object.add(core);
    this.trail = new Trail(() => (this.t < this.seconds ? this.at : null), 90, spec, { color, size: size * 7 });
    this.object.add(this.trail.object);
    this.at.copy(from);
    core.position.copy(from);
  }

  update(dt: number): boolean {
    this.t += dt;
    const k = Math.min(1, this.t / Math.max(0.001, this.seconds));
    this.at.lerpVectors(this.from, this.to, k * k);
    const core = this.object.getObjectByName('core')!;
    core.position.copy(this.at);
    core.visible = k < 1;
    return this.trail.update(dt);
  }
}

/** A soft glow that swells and fades (the flash of an impact, without lighting up the whole area). */
export class Puff implements Effect {
  readonly object: THREE.Sprite;
  private t = 0;

  constructor(x: number, y: number, z: number, color: number, private size: number, private seconds = 0.3, private peak = 0.7) {
    this.object = glowSprite(color, size * 0.5, peak);
    this.object.position.set(x, y, z);
  }

  update(dt: number): boolean {
    this.t += dt;
    const k = Math.min(1, this.t / this.seconds);
    this.object.scale.setScalar(this.size * (0.5 + 0.5 * Math.sqrt(k)));
    this.object.material.opacity = this.peak * (1 - k) ** 1.5;
    if (k < 1) return true;
    this.object.material.dispose();
    return false;
  }
}

// ------------------------------------------------------------------ ground marks

let frostTex: THREE.DataTexture | null = null;
let scorchTex: THREE.DataTexture | null = null;

function radialTexture(alpha: (d: number, x: number, y: number) => number): THREE.DataTexture {
  const size = 128;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const d = Math.min(1, Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) / (size / 2));
      data.set([255, 255, 255, Math.round(Math.max(0, Math.min(1, alpha(d, x, y))) * 255)], (y * size + x) * 4);
    }
  const tex = new THREE.DataTexture(data, size, size);
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/** Frost: faint in the middle, thickest just inside the edge, then gone (shared, never disposed). */
function frostTexture(): THREE.DataTexture {
  return (frostTex ??= radialTexture((d) => (d < 0.85 ? 0.35 + 0.65 * (d / 0.85) ** 2 : 1 - (d - 0.85) / 0.15)));
}

/** Scorch: a blotchy dark patch, ragged at the edge (shared, never disposed). */
function scorchTexture(): THREE.DataTexture {
  // Cheap value noise from a few sine waves: enough to break up the circle.
  const noise = (x: number, y: number) => 0.5 + 0.25 * Math.sin(x * 0.21 + Math.sin(y * 0.13) * 2) + 0.25 * Math.sin(y * 0.27 + Math.cos(x * 0.17) * 2);
  return (scorchTex ??= radialTexture((d, x, y) => {
    const n = noise(x, y);
    const edge = 0.7 + 0.25 * n;
    return d < edge ? 0.55 + 0.45 * n : Math.max(0, 1 - (d - edge) / 0.12) * (0.55 + 0.45 * n);
  }));
}

/** Geometry for a ground shape, lying flat (UVs cover the shape's bounding circle, so radial textures fit). */
function shapeGeometry(shape: TelegraphShape): THREE.BufferGeometry {
  switch (shape.kind) {
    case 'circle':
      return new THREE.CircleGeometry(shape.radius, 48);
    case 'cone': {
      const half = THREE.MathUtils.degToRad(shape.arcDeg) / 2;
      return new THREE.CircleGeometry(shape.range, 32, Math.PI / 2 - half, half * 2);
    }
    case 'line':
      return new THREE.PlaneGeometry(shape.width, shape.length).translate(0, shape.length / 2, 0);
    case 'arc': {
      const half = THREE.MathUtils.degToRad(shape.arcDeg) / 2;
      return new THREE.RingGeometry(shape.inner, shape.outer, 48, 1, Math.PI / 2 - half, half * 2);
    }
  }
}

export interface MarkSpec {
  color: number;
  /** Peak opacity. */
  opacity: number;
  look: 'soft' | 'frost' | 'scorch';
  /** Fade in, hold, fade out (seconds). */
  fadeIn: number;
  hold: number;
  fadeOut: number;
  /** Glows (additive) rather than stains (normal blending). */
  glow?: boolean;
}

/** A soft mark on the floor in an area's shape that fades in, stays a while and fades out. */
export class GroundMark implements Effect {
  readonly object = new THREE.Group();
  private t = 0;
  private mat: THREE.MeshBasicMaterial;
  private geo: THREE.BufferGeometry;

  constructor(shape: TelegraphShape, private spec: MarkSpec) {
    const map = spec.look === 'frost' ? frostTexture() : spec.look === 'scorch' ? scorchTexture() : glowTexture();
    this.mat = new THREE.MeshBasicMaterial({
      color: spec.color,
      map,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: spec.glow ? THREE.AdditiveBlending : THREE.NormalBlending,
      side: THREE.DoubleSide,
    });
    this.geo = shapeGeometry(shape);
    const mesh = new THREE.Mesh(this.geo, this.mat);
    mesh.rotation.x = -Math.PI / 2;
    // Marks laid later sit a hair higher, so overlapping ones don't flicker against each other.
    mesh.position.y = 0.035 + Math.random() * 0.01;
    this.object.add(mesh);
    this.object.position.set(shape.x, 0, shape.z);
    if (shape.kind !== 'circle') this.object.rotation.y = shape.yaw + Math.PI;
  }

  update(dt: number): boolean {
    this.t += dt;
    const { fadeIn, hold, fadeOut, opacity } = this.spec;
    const t = this.t;
    const env = t < fadeIn ? t / fadeIn : t < fadeIn + hold ? 1 : 1 - (t - fadeIn - hold) / fadeOut;
    this.mat.opacity = opacity * Math.max(0, env);
    if (t < fadeIn + hold + fadeOut) return true;
    this.geo.dispose();
    this.mat.dispose();
    return false;
  }
}

/** A random point inside an area (for particles that rise from all over it). */
export function pointIn(shape: TelegraphShape, out = new THREE.Vector3()): THREE.Vector3 {
  switch (shape.kind) {
    case 'circle': {
      const a = Math.random() * Math.PI * 2;
      const r = shape.radius * Math.sqrt(Math.random());
      return out.set(shape.x + Math.cos(a) * r, 0.1, shape.z + Math.sin(a) * r);
    }
    case 'cone': {
      const a = shape.yaw + THREE.MathUtils.degToRad((Math.random() - 0.5) * shape.arcDeg);
      const r = shape.range * Math.sqrt(Math.random());
      return out.set(shape.x + Math.sin(a) * r, 0.1, shape.z + Math.cos(a) * r);
    }
    case 'line': {
      const along = Math.random() * shape.length;
      const side = (Math.random() - 0.5) * shape.width;
      return out.set(shape.x + Math.sin(shape.yaw) * along + Math.cos(shape.yaw) * side, 0.1, shape.z + Math.cos(shape.yaw) * along - Math.sin(shape.yaw) * side);
    }
    case 'arc': {
      const a = shape.yaw + THREE.MathUtils.degToRad((Math.random() - 0.5) * shape.arcDeg);
      const r = rand(shape.inner, shape.outer);
      return out.set(shape.x + Math.sin(a) * r, 0.1, shape.z + Math.cos(a) * r);
    }
  }
}

/** Something lingering on the ground (burning, frost, a storm): a mark plus particles rising from all over it. */
export class Field implements Effect {
  readonly object = new THREE.Group();
  private t = 0;
  private acc = 0;
  private mark: GroundMark;
  private s: Sparks;
  private p = new THREE.Vector3();

  constructor(private shape: TelegraphShape, private seconds: number, mark: MarkSpec, private rate: number, spec: SparkSpec) {
    this.mark = new GroundMark(shape, mark);
    this.s = new Sparks(Math.ceil(rate * spec.life[1]) + 8, spec);
    this.object.add(this.mark.object, this.s.points);
  }

  update(dt: number): boolean {
    this.t += dt;
    if (this.t < this.seconds) {
      this.acc += this.rate * dt;
      for (; this.acc >= 1; this.acc--) {
        pointIn(this.shape, this.p);
        this.s.emit(1, this.p.x, this.p.y, this.p.z);
      }
    }
    const markOn = this.mark.update(dt);
    const alive = this.s.update(dt);
    if (markOn || alive) return true;
    this.s.dispose();
    return false;
  }
}

/** How long a lingering field's mark lasts so it fades out as the field ends. */
export function fieldMark(seconds: number, base: Omit<MarkSpec, 'fadeIn' | 'hold' | 'fadeOut'>): MarkSpec {
  const fadeIn = Math.min(0.3, seconds * 0.2);
  const fadeOut = Math.min(0.8, seconds * 0.3);
  return { ...base, fadeIn, hold: Math.max(0, seconds - fadeIn - fadeOut * 0.5), fadeOut };
}

// ------------------------------------------------------------------ lightning

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5);

/**
 * A jagged bolt between two points: a thin bright core in a coloured glow, re-forking twice in its short life (one
 * crackle, not a rhythm), with a small side branch.
 */
export class Lightning implements Effect {
  readonly object = new THREE.Group();
  private t = 0;
  private shapeT = 0;
  private core: THREE.MeshBasicMaterial;
  private glow: THREE.MeshBasicMaterial;
  private segs: THREE.Mesh[] = [];
  private glows: THREE.Mesh[] = [];
  private joints: THREE.Vector3[] = [];

  constructor(private a: THREE.Vector3, private b: THREE.Vector3, color: number, private seconds = 0.22, private width = 1) {
    this.core = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending });
    this.glow = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending });
    const n = Math.max(5, Math.min(16, Math.round(a.distanceTo(b) / 0.9)));
    for (let i = 0; i <= n; i++) this.joints.push(new THREE.Vector3());
    // Main bolt plus a three-segment branch.
    for (let i = 0; i < n + 3; i++) {
      const s = new THREE.Mesh(UNIT_BOX, this.core);
      const g = new THREE.Mesh(UNIT_BOX, this.glow);
      this.segs.push(s);
      this.glows.push(g);
      this.object.add(g, s);
    }
    this.reshape();
  }

  private place(i: number, from: THREE.Vector3, to: THREE.Vector3, w: number): void {
    const len = from.distanceTo(to);
    for (const [m, k] of [[this.segs[i], 0.05], [this.glows[i], 0.22]] as const) {
      m.position.copy(from);
      m.lookAt(to);
      m.scale.set(k * w * this.width, k * w * this.width, len);
    }
  }

  private reshape(): void {
    const n = this.joints.length - 1;
    const len = this.a.distanceTo(this.b);
    const jag = Math.min(0.9, 0.12 * len);
    for (let i = 0; i <= n; i++) {
      const k = i / n;
      const j = this.joints[i].lerpVectors(this.a, this.b, k);
      if (i > 0 && i < n) j.add(new THREE.Vector3(rand(-jag, jag), rand(-jag, jag) * 0.5, rand(-jag, jag)));
    }
    for (let i = 0; i < n; i++) this.place(i, this.joints[i], this.joints[i + 1], 1 - (i / n) * 0.3);
    // The branch: off a joint a third of the way along, three short segments heading away.
    let from = this.joints[Math.max(1, Math.floor(n / 3))].clone();
    const dir = new THREE.Vector3(rand(-1, 1), rand(-0.6, 0.2), rand(-1, 1)).normalize().multiplyScalar(Math.min(1.2, len * 0.12));
    for (let i = 0; i < 3; i++) {
      const to = from.clone().add(dir).add(new THREE.Vector3(rand(-0.3, 0.3), rand(-0.3, 0.3), rand(-0.3, 0.3)));
      this.place(n + i, from, to, 0.6 - i * 0.15);
      from = to;
    }
  }

  update(dt: number): boolean {
    this.t += dt;
    this.shapeT += dt;
    if (this.shapeT > this.seconds / 3 && this.t < this.seconds * 0.7) {
      this.shapeT = 0;
      this.reshape();
    }
    const k = Math.min(1, this.t / this.seconds);
    this.core.opacity = 0.95 * (1 - k * k);
    this.glow.opacity = 0.45 * (1 - k);
    if (k < 1) return true;
    this.core.dispose();
    this.glow.dispose();
    return false;
  }
}

// ------------------------------------------------------------------ ice

/** A cluster of ice crystals bursting out of the floor, standing a moment, then sinking away. */
export class IceSpikes implements Effect {
  readonly object = new THREE.Group();
  private t = 0;
  private mat: THREE.MeshStandardMaterial;
  private spikes: { m: THREE.Mesh; delay: number; h: number }[] = [];

  constructor(x: number, z: number, count: number, spread: number, height: number, private hold = 0.45, color = 0xbfeaff) {
    this.mat = new THREE.MeshStandardMaterial({
      color,
      emissive: 0x2a7fb8,
      emissiveIntensity: 0.55,
      roughness: 0.15,
      metalness: 0,
      flatShading: true,
      transparent: true,
      opacity: 0.92,
    });
    for (let i = 0; i < count; i++) {
      const h = height * rand(0.55, 1.1) * (i === 0 ? 1.2 : 1);
      const r = h * rand(0.13, 0.2);
      const geo = new THREE.ConeGeometry(r, h, 5).translate(0, h / 2, 0);
      const m = new THREE.Mesh(geo, this.mat);
      const a = (i / count) * Math.PI * 2 + rand(-0.4, 0.4);
      const d = i === 0 ? 0 : spread * Math.sqrt(rand(0.2, 1));
      m.position.set(Math.cos(a) * d, 0, Math.sin(a) * d);
      // Lean outward from the middle.
      m.rotation.set(Math.sin(a) * rand(0.15, 0.45) * (d > 0 ? 1 : 0.3), rand(0, Math.PI), -Math.cos(a) * rand(0.15, 0.45) * (d > 0 ? 1 : 0.3));
      m.scale.set(1, 0.001, 1);
      this.spikes.push({ m, delay: i === 0 ? 0 : rand(0, 0.07), h });
      this.object.add(m);
    }
    this.object.position.set(x, 0, z);
  }

  update(dt: number): boolean {
    this.t += dt;
    const grow = 0.11;
    const sinkAt = grow + 0.07 + this.hold;
    const sink = 0.35;
    for (const s of this.spikes) {
      const t = this.t - s.delay;
      const k = Math.max(0, Math.min(1, t / grow));
      s.m.scale.y = Math.max(0.001, 1 - (1 - k) ** 3);
      if (t > sinkAt) s.m.position.y = -s.h * Math.min(1, (t - sinkAt) / sink);
    }
    this.mat.opacity = 0.92 * Math.max(0, Math.min(1, 1 - (this.t - sinkAt - 0.1) / sink));
    if (this.t < sinkAt + sink + 0.1) return true;
    for (const s of this.spikes) s.m.geometry.dispose();
    this.mat.dispose();
    return false;
  }
}

/**
 * Rabarta: snow swirling around a spot for a while over a frosted floor. Soft and steady on purpose (its pulses
 * used to flash a ring every half second, which read as a strobe): it fades in, swirls, and fades out.
 */
export class Blizzard implements Effect {
  readonly object = new THREE.Group();
  private t = 0;
  private frost: THREE.MeshBasicMaterial;
  private rim: THREE.MeshBasicMaterial;
  private snowMat: THREE.PointsMaterial;
  private flakes: { a: number; r: number; y: number; spin: number; fall: number; phase: number }[] = [];
  private pos: Float32Array;
  private geo: THREE.BufferGeometry;

  constructor(x: number, z: number, private radius: number, private duration: number, color: number) {
    this.frost = new THREE.MeshBasicMaterial({ color, map: frostTexture(), transparent: true, opacity: 0, depthWrite: false });
    const disc = new THREE.Mesh(new THREE.CircleGeometry(radius, 48).rotateX(-Math.PI / 2), this.frost);
    disc.position.y = 0.04;
    this.rim = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
    const rim = new THREE.Mesh(new THREE.RingGeometry(radius - 0.1, radius, 64).rotateX(-Math.PI / 2), this.rim);
    rim.position.y = 0.05;
    // Flakes: spread evenly over the disc, circling the middle as they drift down.
    const n = Math.round(radius * radius * 5);
    for (let i = 0; i < n; i++) {
      this.flakes.push({
        a: Math.random() * Math.PI * 2,
        r: radius * Math.sqrt(0.04 + 0.96 * Math.random()),
        y: Math.random() * 3,
        spin: 1.1 + Math.random() * 0.9,
        fall: 0.7 + Math.random() * 0.8,
        phase: Math.random() * Math.PI * 2,
      });
    }
    this.pos = new Float32Array(n * 3);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.snowMat = new THREE.PointsMaterial({ color: 0xeef8ff, map: glowTexture(), size: 0.22, transparent: true, opacity: 0, depthWrite: false });
    const snow = new THREE.Points(this.geo, this.snowMat);
    snow.frustumCulled = false;
    this.object.add(disc, rim, snow);
    this.object.position.set(x, 0, z);
    this.place(0);
  }

  private place(dt: number): void {
    const R = this.radius;
    this.flakes.forEach((f, i) => {
      f.a += f.spin * dt;
      f.y -= f.fall * dt;
      if (f.y < 0.05) f.y += 3;
      const r = Math.min(R, f.r + 0.2 * Math.sin(this.t * 2 + f.phase));
      this.pos[i * 3] = Math.cos(f.a) * r;
      this.pos[i * 3 + 1] = f.y;
      this.pos[i * 3 + 2] = Math.sin(f.a) * r;
    });
    this.geo.attributes.position.needsUpdate = true;
  }

  update(dt: number): boolean {
    this.t += dt;
    // Fade in over 0.4 s and out over the last 0.6 s.
    const env = Math.max(0, Math.min(1, this.t / 0.4, (this.duration - this.t) / 0.6));
    this.frost.opacity = 0.3 * env;
    this.rim.opacity = 0.35 * env;
    this.snowMat.opacity = 0.85 * env;
    this.place(dt);
    if (this.t < this.duration) return true;
    this.geo.dispose();
    this.snowMat.dispose();
    this.frost.dispose();
    this.rim.dispose();
    return false;
  }
}

// ------------------------------------------------------------------ palettes

/** Embers: yellow-white turning red as they rise and die. */
export const EMBERS: SparkSpec = { color: 0xffd27a, to: 0xff3a10, life: [0.35, 0.7], speed: [0.4, 1.4], spread: 'up', size: 0.2, gravity: -2.2, drag: 1.5, brightness: 0.85 };
/** Lightning sparks: white-violet, quick. */
export const SPARKS: SparkSpec = { color: 0xf4eaff, to: 0x9a6bff, life: [0.15, 0.35], speed: [2.5, 6], spread: 'sphere', size: 0.12, gravity: 6, drag: 3, brightness: 0.9 };
/** Snow puffs and ice glitter. */
export const SNOW: SparkSpec = { color: 0xeaf8ff, to: 0x7ac8ff, life: [0.4, 0.8], speed: [0.8, 2.6], spread: 'up', size: 0.17, gravity: 2.5, drag: 2.5, brightness: 0.7 };
/** Frost fields: faint glitter drifting up off the ice. */
export const FROST_GLITTER: SparkSpec = { color: 0xeaf8ff, to: 0x7ac8ff, life: [0.6, 1.2], speed: [0.1, 0.4], spread: 'up', size: 0.12, gravity: -0.3, drag: 1, brightness: 0.5 };
/** Static crawling over a charged patch (Razonde). */
export const STATIC: SparkSpec = { color: 0xe8dcff, to: 0x6a4cff, life: [0.25, 0.5], speed: [0.3, 1.2], spread: 'up', size: 0.1, gravity: -0.5, drag: 2, brightness: 0.7 };

/** Area of a shape in m² (how many particles a lingering field sheds). */
export function shapeArea(shape: TelegraphShape): number {
  switch (shape.kind) {
    case 'circle':
      return Math.PI * shape.radius ** 2;
    case 'cone':
      return (THREE.MathUtils.degToRad(shape.arcDeg) / 2) * shape.range ** 2;
    case 'line':
      return shape.width * shape.length;
    case 'arc':
      return (THREE.MathUtils.degToRad(shape.arcDeg) / 2) * (shape.outer ** 2 - shape.inner ** 2);
  }
}
/** Photon motes: the Force's bolts and their sparks. */
export const MOTES: SparkSpec = { color: 0xffffff, life: [0.15, 0.35], speed: [0.1, 0.5], spread: 'sphere', size: 0.12, drag: 2, brightness: 0.7 };
