import * as THREE from 'three';
import { dragon as cfg } from '../config';
import { mat, part } from '../models/Rig';
import { Ring, type Effect } from '../world/Effects';
import type { TreeCollider } from '../world/Level';

// The Hell Dragon's Hellfire Rampage (see Dragon): the cover rocks in her lair, the test of whether one stands
// between her and you, the shadows they cast on the floor while she winds up, and the violet lane of her charge.

/** A cover rock's footprint. */
export interface CoverSpot {
  x: number;
  z: number;
  r: number;
}

/**
 * The rock covering (tx, tz) from (fx, fz): the nearest one whose centre lies within its radius of the line between
 * them, short of the target (what a charge along that line runs into first). Null in the open.
 */
export function coverOnLine<T extends CoverSpot>(fx: number, fz: number, tx: number, tz: number, rocks: readonly T[]): T | null {
  const dx = tx - fx;
  const dz = tz - fz;
  const len2 = dx * dx + dz * dz;
  if (len2 < 1e-6) return null;
  let best: T | null = null;
  let bestT = Infinity;
  for (const c of rocks) {
    const t = ((c.x - fx) * dx + (c.z - fz) * dz) / len2;
    if (t <= 0 || t >= 1 || t >= bestT) continue;
    const ox = fx + dx * t - c.x;
    const oz = fz + dz * t - c.z;
    if (ox * ox + oz * oz >= c.r * c.r) continue;
    best = c;
    bestT = t;
  }
  return best;
}

/**
 * The rampage's windup in real seconds: the base cut by the enrage (`sm`) and a rift's tempo, never under the floor
 * (so the walk to cover stays possible however deep the rift).
 */
export function rampageWindup(sm: number, tempo: number): number {
  return Math.max((cfg.rampageWindup * sm) / tempo, cfg.rampageWindupFloor);
}

/** Share of a rock's radius a reachable cover spot keeps inside its shadow's edges. */
const REACH_INSET = 0.7;

/**
 * How far (m, straight line) the player at (px, pz) has to walk to stand in cover from (fx, fz): 0 if covered
 * already, Infinity if no rock casts a shadow on open floor. Samples each rock's shadow (the wedge behind it,
 * seen from her) up to 10 m back, a little inside its edges.
 */
export function coverReach(
  fx: number, fz: number, px: number, pz: number, rocks: readonly CoverSpot[], open: (x: number, z: number) => boolean, pr: number,
): number {
  if (coverOnLine(fx, fz, px, pz, rocks)) return 0;
  let best = Infinity;
  for (const c of rocks) {
    const d = Math.hypot(c.x - fx, c.z - fz);
    if (d <= c.r + 0.5) continue;
    const half = Math.asin((c.r * REACH_INSET) / d);
    const a0 = Math.atan2(c.x - fx, c.z - fz);
    for (let s = d + c.r + pr + 0.2; s <= d + 10; s += 0.5) {
      for (let j = -4; j <= 4; j++) {
        const a = a0 + (half * j) / 4;
        const x = fx + Math.sin(a) * s;
        const z = fz + Math.cos(a) * s;
        const w = Math.hypot(x - px, z - pz);
        if (w < best && open(x, z)) best = w;
      }
    }
  }
  return best;
}

// ------------------------------------------------------------------ rocks

/** Height of a cover rock (it sinks this far to hide, and rises from there). */
const ROCK_H = 3.7;
/** Length of the shadow drawn behind a rock while she winds up. */
const SHADOW_LEN = 10;
/** Cool white: what reads as cover (the rocks' veins, their base ring, the edges of their shadows). */
const COVER_COLOR = 0xa8d8ff;
/** An eruption warning's red: the veins of the rocks its blast will break. */
const DOOM_COLOR = 0xff4020;
/** The ring at a rock's foot. */
const BASE_OPACITY = 0.16;
/** Width of the pale edges drawn along a shadow's sides. */
const SHADOW_EDGE = 0.14;
const STONE = 0x2b2521;
/** A rock this close to you (m past its radius) fades to this opacity. */
const ROCK_FADE_REACH = 4.5;
const ROCK_FADE = 0.3;

type RockState = 'standing' | 'rising' | 'broken';

/** One cover rock: a dark standing stone with pale veins, on a faint ring. */
export class CoverRock implements CoverSpot {
  state: RockState = 'standing';
  /** Broken, and asked to rise again (it does once nobody stands on its spot). */
  regrow = false;
  riseT = 0;
  readonly collider: TreeCollider;
  readonly mesh = new THREE.Group();
  readonly rubble = new THREE.Group();
  /** Its shadow from her while she winds up: a dark wedge with pale edges. */
  readonly shadow = new THREE.Group();
  readonly shadowFill: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  readonly shadowEdge: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  readonly veins: THREE.MeshBasicMaterial;
  /** The ring at its foot. */
  readonly base: THREE.MeshBasicMaterial;
  /** Its own stone, so it alone can turn see-through while you hide behind it (see `CoverRocks.seeThrough`). */
  readonly body: THREE.Material;

  constructor(readonly x: number, readonly z: number, readonly r: number, stone: THREE.Material, seed: number) {
    this.collider = { x, z, r };
    this.body = stone.clone();
    const rnd = (k: number) => {
      const s = Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453;
      return s - Math.floor(s);
    };
    const s = r / 1.5;
    // The slab: a tapered hexagonal stone, leaning a touch, a broken-off cap and a smaller stone at its foot.
    const slab = new THREE.Group();
    slab.rotation.set((rnd(1) - 0.5) * 0.12, rnd(2) * Math.PI, (rnd(3) - 0.5) * 0.12);
    slab.scale.setScalar(s);
    this.mesh.add(slab);
    part(slab, new THREE.CylinderGeometry(0.8, 1.35, 3.3, 6), this.body, [0, 1.65, 0]);
    part(slab, new THREE.DodecahedronGeometry(0.75, 0), this.body, [0.1, 3.35, 0], [0.4, 0.3, 0.2], [1, 0.6, 0.9]);
    part(this.mesh, new THREE.DodecahedronGeometry(0.45, 0), this.body, [r * 0.6, 0.22, r * 0.3], [0.3, rnd(4) * 3, 0.1], [1.2, 0.7, 1]);
    // Pale veins down three of its faces (CylinderGeometry's faces sit between its vertices, every 60 deg from 30).
    this.veins = new THREE.MeshBasicMaterial({ color: COVER_COLOR, transparent: true, opacity: 0.55 });
    for (const k of [0, 2, 4]) {
      const a = Math.PI / 6 + (k * Math.PI) / 3;
      const pivot = new THREE.Group();
      pivot.rotation.y = a;
      slab.add(pivot);
      const v = new THREE.Mesh(new THREE.BoxGeometry(0.09, 2.3 - k * 0.15, 0.05), this.veins);
      // On the face, tilted with the taper (1.35 to 0.8 over 3.3 m).
      v.position.set((rnd(5 + k) - 0.5) * 0.3, 1.6, Math.cos(Math.PI / 6) * 1.08 + 0.03);
      v.rotation.set(-Math.atan2(0.55 * Math.cos(Math.PI / 6), 3.3), 0, (rnd(9 + k) - 0.5) * 0.4);
      pivot.add(v);
    }
    // A faint ring at its foot marks it as cover.
    this.base = new THREE.MeshBasicMaterial({ color: COVER_COLOR, transparent: true, opacity: BASE_OPACITY, depthWrite: false });
    const ring = new THREE.Mesh(new THREE.RingGeometry(r + 0.15, r + 0.45, 32).rotateX(-Math.PI / 2), this.base);
    ring.position.y = 0.03;
    this.mesh.add(ring);
    this.mesh.position.set(x, 0, z);

    // What's left when it shatters: a low pile of stones (not solid), gone when it rises again.
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + rnd(20 + i);
      const d = r * (0.2 + rnd(30 + i) * 0.7);
      part(this.rubble, new THREE.DodecahedronGeometry(0.25 + rnd(40 + i) * 0.25, 0), stone, [Math.sin(a) * d, 0.08, Math.cos(a) * d], [rnd(50 + i) * 3, rnd(60 + i) * 3, 0], [1, 0.55, 1]);
    }
    this.rubble.position.set(x, 0, z);
    this.rubble.visible = false;

    const quads = (n: number, color: number) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 12), 3));
      geo.setIndex(Array.from({ length: n }, (_, i) => [0, 1, 2, 0, 2, 3].map((v) => v + i * 4)).flat());
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
      m.frustumCulled = false;
      this.shadow.add(m);
      return m;
    };
    this.shadowFill = quads(1, 0x000000);
    this.shadowEdge = quads(2, COVER_COLOR);
    this.shadowEdge.position.y = 0.005;
    this.shadow.visible = false;
  }

  /** Standing, or on its way up (solid either way). */
  get solid(): boolean {
    return this.state !== 'broken';
  }

  /**
   * Lay its shadow as seen from (fx, fz): the wedge behind it where the line to her passes through it (exactly
   * what `coverOnLine` counts). False if she's on top of it.
   */
  layShadow(fx: number, fz: number): boolean {
    const d = Math.hypot(this.x - fx, this.z - fz);
    if (d <= this.r + 0.1) return false;
    const ux = (this.x - fx) / d;
    const uz = (this.z - fz) / d;
    const tan = this.r / Math.sqrt(d * d - this.r * this.r);
    const fill = this.shadowFill.geometry.getAttribute('position') as THREE.BufferAttribute;
    const edge = this.shadowEdge.geometry.getAttribute('position') as THREE.BufferAttribute;
    // `s` m out from her, on `side` of the line through the rock, `inset` m in from the edge.
    const at = (p: THREE.BufferAttribute, i: number, s: number, side: number, inset = 0) => {
      const w = side * (s * tan - inset);
      p.setXYZ(i, fx + ux * s + uz * w, 0.045, fz + uz * s - ux * w);
    };
    const far = d + SHADOW_LEN;
    at(fill, 0, d, -1);
    at(fill, 1, d, 1);
    at(fill, 2, far, 1);
    at(fill, 3, far, -1);
    for (const [k, side] of [[0, -1], [1, 1]]) {
      at(edge, k * 4, d, side);
      at(edge, k * 4 + 1, d, side, SHADOW_EDGE);
      at(edge, k * 4 + 2, far, side, SHADOW_EDGE);
      at(edge, k * 4 + 3, far, side);
    }
    fill.needsUpdate = true;
    edge.needsUpdate = true;
    return true;
  }
}

/**
 * The cover rocks of the Hell Dragon's lair. They stand from the start; the rampage shatters the one you hid
 * behind and an eruption every one its blast reaches, and broken ones rise back out of the ground when asked
 * (every burrow, or when too few are left), as soon as nobody stands on their spot. Solid ones are colliders in
 * the level (see `sync`).
 */
export class CoverRocks {
  readonly group = new THREE.Group();
  readonly list: CoverRock[];
  private readonly stone = mat(STONE, { rough: 0.9 });

  constructor(spots: readonly (readonly [number, number])[], cx: number, cz: number, r: number, private readonly riseTime: number) {
    this.list = spots.map(([dx, dz], i) => new CoverRock(cx + dx, cz + dz, r, this.stone, i + 1));
    for (const rock of this.list) this.group.add(rock.mesh, rock.rubble, rock.shadow);
  }

  solid(): CoverRock[] {
    return this.list.filter((r) => r.solid);
  }

  /** The first solid rock a body at (x, z) touches. */
  touching(x: number, z: number, radius: number): CoverRock | null {
    return this.list.find((r) => r.solid && Math.hypot(r.x - x, r.z - z) < r.r + radius) ?? null;
  }

  /** Smash it: gone (mesh and collision) until it rises again; a burst of stone and dust. */
  shatter(rock: CoverRock, effect: (e: Effect) => void): void {
    rock.state = 'broken';
    rock.regrow = false;
    this.unmark(rock);
    rock.mesh.visible = false;
    rock.rubble.visible = true;
    rock.shadow.visible = false;
    effect(new RockBurst(rock.x, rock.z, this.stone, 16, 1));
    effect(new Ring(rock.x, rock.z, 0x9a8a78, rock.r * 3.2, 0.5, 0.7));
  }

  /** The solid rocks a circle reaches (any part of the footprint inside it). */
  inCircle(x: number, z: number, radius: number): CoverRock[] {
    return this.list.filter((r) => r.solid && Math.hypot(r.x - x, r.z - z) < r.r + radius);
  }

  /**
   * An eruption's blast: every rock it reaches shatters, and a broken one in it stops waiting to rise (they come
   * back at the next call-up). Returns how many were standing.
   */
  blast(x: number, z: number, radius: number, effect: (e: Effect) => void): number {
    let n = 0;
    for (const r of this.list) {
      if (Math.hypot(r.x - x, r.z - z) >= r.r + radius) continue;
      if (r.solid) {
        this.shatter(r, effect);
        n++;
      } else r.regrow = false;
    }
    return n;
  }

  /** While an eruption winds up: the rocks it will break (`doomed`) pulse in its warning's red, veins and ring. */
  markDoomed(doomed: readonly CoverRock[], time: number): void {
    const pulse = 0.5 + 0.5 * Math.sin(time * 10);
    for (const r of this.list) {
      if (!doomed.includes(r)) {
        this.unmark(r);
        continue;
      }
      r.veins.color.setHex(DOOM_COLOR);
      r.veins.opacity = 0.7 + 0.3 * pulse;
      r.base.color.setHex(DOOM_COLOR);
      r.base.opacity = 0.35 + 0.3 * pulse;
    }
  }

  private unmark(r: CoverRock): void {
    r.veins.color.setHex(COVER_COLOR);
    r.veins.opacity = 0.55;
    r.base.color.setHex(COVER_COLOR);
    r.base.opacity = BASE_OPACITY;
  }

  /** Every broken rock rises again, each as soon as its spot is clear. */
  regrowAll(): void {
    for (const r of this.list) if (r.state === 'broken') r.regrow = true;
  }

  /**
   * Let the asked-for ones rise (`clear`: nobody on the spot), with a puff of dust and grit. Returns the ones that
   * started up this tick.
   */
  update(dt: number, clear: (r: CoverRock) => boolean, effect: (e: Effect) => void): CoverRock[] {
    const started: CoverRock[] = [];
    for (const r of this.list) {
      if (r.state === 'broken' && r.regrow && clear(r)) {
        r.state = 'rising';
        r.regrow = false;
        r.riseT = 0;
        r.mesh.visible = true;
        r.rubble.visible = false;
        effect(new Ring(r.x, r.z, 0x9a8a78, r.r * 2.4, 0.6, 0.6));
        effect(new RockBurst(r.x, r.z, this.stone, 7, 0.45));
        started.push(r);
      }
      if (r.state !== 'rising') continue;
      r.riseT += dt;
      const k = Math.min(1, r.riseT / this.riseTime);
      // Up out of the floor, easing in at the top, grinding side to side on the way.
      const e = 1 - (1 - k) ** 3;
      const judder = (1 - k) * 0.06;
      r.mesh.position.set(r.x + Math.sin(r.riseT * 47) * judder, -ROCK_H * (1 - e), r.z + Math.cos(r.riseT * 53) * judder);
      if (k >= 1) {
        r.state = 'standing';
        r.mesh.position.set(r.x, 0, r.z);
      }
    }
    return started;
  }

  /**
   * A rock close to you (px, pz) turns see-through, so hiding behind one doesn't fill the screen with stone: the
   * camera trails you, so the rock is between it and you, or between you and her. Eases back when you leave.
   */
  seeThrough(dt: number, px: number, pz: number): void {
    for (const r of this.list) {
      const target = r.solid && Math.hypot(r.x - px, r.z - pz) < r.r + ROCK_FADE_REACH ? ROCK_FADE : 1;
      const m = r.body;
      m.opacity += (target - m.opacity) * Math.min(1, dt * 8);
      if (Math.abs(m.opacity - target) < 0.01) m.opacity = target;
      const see = m.opacity < 1;
      if (m.transparent !== see) {
        m.transparent = see;
        m.depthWrite = !see;
        m.needsUpdate = true;
      }
    }
  }

  /** Keep the level's colliders in step: solid rocks block like tree trunks, broken ones don't. */
  sync(trees: TreeCollider[]): void {
    for (const r of this.list) {
      const i = trees.indexOf(r.collider);
      if (r.solid && i < 0) trees.push(r.collider);
      else if (!r.solid && i >= 0) trees.splice(i, 1);
    }
  }

  /**
   * While she winds up: every solid rock's shadow from (fx, fz) at `alpha`, the veins brighter, and the rock that
   * covers you right now (`lit`) brightest. `alpha` 0 puts it all back.
   */
  showCover(fx: number, fz: number, alpha: number, lit: CoverRock | null, time: number): void {
    const pulse = 0.5 + 0.5 * Math.sin(time * 8);
    for (const r of this.list) {
      r.shadow.visible = alpha > 0 && r.solid && r.layShadow(fx, fz);
      r.shadowFill.material.opacity = alpha * (r === lit ? 0.5 : 0.4);
      r.shadowEdge.material.opacity = alpha * (r === lit ? 0.75 + 0.25 * pulse : 0.55);
      r.veins.opacity = alpha <= 0 ? 0.55 : r === lit ? 1 : 0.6 + 0.35 * pulse * alpha;
      r.veins.color.setHex(COVER_COLOR);
      if (r === lit) r.veins.color.multiplyScalar(1.3);
    }
  }
}

// ------------------------------------------------------------------ the lane

/** Her charge's line, violet, from her to where it will end (the rock that covers you, or you), filling up. */
export class RampageLane {
  readonly group = new THREE.Group();
  private readonly outline: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private readonly fill: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;

  constructor(private readonly width: number, color: number) {
    // A unit strip from the origin along +Z (yaw 0), stretched to length.
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0, 0.5);
    const m = (opacity: number) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });
    this.outline = new THREE.Mesh(geo, m(0.22));
    this.fill = new THREE.Mesh(geo, m(0.45));
    this.outline.position.y = 0.05;
    this.fill.position.y = 0.055;
    this.group.add(this.outline, this.fill);
    this.group.visible = false;
  }

  /** From (x, z) along `yaw`, `length` long, its fill `k` (0..1) of the way. */
  show(x: number, z: number, yaw: number, length: number, k: number, time: number): void {
    this.group.visible = true;
    this.group.position.set(x, 0, z);
    this.group.rotation.y = yaw;
    const len = Math.max(0.1, length);
    this.outline.scale.set(this.width, 1, len);
    this.fill.scale.set(this.width * 0.8, 1, Math.max(0.01, len * k));
    this.outline.material.opacity = 0.18 + 0.1 * (0.5 + 0.5 * Math.sin(time * 10));
  }

  hide(): void {
    this.group.visible = false;
  }
}

// ------------------------------------------------------------------ debris

const CHUNK = new THREE.DodecahedronGeometry(1, 0);

/** Chunks of stone thrown up and out from a point; they bounce, settle and shrink away. */
export class RockBurst implements Effect {
  readonly object = new THREE.Group();
  private t = 0;
  private readonly chunks: { m: THREE.Mesh; v: THREE.Vector3; spin: THREE.Vector3; size: number }[] = [];

  constructor(x: number, z: number, material: THREE.Material, n: number, power: number, private readonly duration = 1.6) {
    this.object.position.set(x, 0, z);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const out = (3 + Math.random() * 6) * power;
      const size = (0.18 + Math.random() * 0.32) * Math.min(1.4, 0.6 + power * 0.4);
      const m = new THREE.Mesh(CHUNK, material);
      m.scale.setScalar(size);
      m.position.set(Math.sin(a) * 0.8, 0.6 + Math.random() * 2.4 * power, Math.cos(a) * 0.8);
      m.castShadow = true;
      this.object.add(m);
      this.chunks.push({
        m,
        v: new THREE.Vector3(Math.sin(a) * out, (4 + Math.random() * 6) * power, Math.cos(a) * out),
        spin: new THREE.Vector3(Math.random() * 10, Math.random() * 10, Math.random() * 10),
        size,
      });
    }
  }

  update(dt: number): boolean {
    this.t += dt;
    const fade = Math.max(0, Math.min(1, (this.duration - this.t) / (this.duration * 0.35)));
    for (const c of this.chunks) {
      c.v.y -= 22 * dt;
      c.m.position.addScaledVector(c.v, dt);
      if (c.m.position.y < c.size * 0.5) {
        c.m.position.y = c.size * 0.5;
        c.v.y = Math.abs(c.v.y) * 0.3;
        c.v.x *= 0.55;
        c.v.z *= 0.55;
        c.spin.multiplyScalar(0.6);
      }
      c.m.rotation.x += c.spin.x * dt;
      c.m.rotation.y += c.spin.y * dt;
      c.m.rotation.z += c.spin.z * dt;
      c.m.scale.setScalar(c.size * fade);
    }
    return this.t < this.duration;
  }
}
