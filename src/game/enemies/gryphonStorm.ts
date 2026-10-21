import * as THREE from 'three';
import { galGryphon as cfg, player as playerCfg } from '../config';
import { mat, part } from '../models/Rig';
import { glowDecal, glowSprite, glowTexture } from '../world/glow';
import type { TreeCollider } from '../world/Level';

// Gal Gryphon's storm and its sparks (see GalGryphon and DESIGN.md "Gal Gryphon"): the six lightning rods round Storm
// Peak, the one each storm lights (step into its pillar of light before the third pulse), when the pulses come, where its
// feathers fall, the layouts of its paired and triple attacks (each with its way out), and the
// sparks that drift through the arena all fight long. A rod that grounded it is scorched for the storm after. Pure
// rules first, so they can be tested without the boss.

/** What a rod is doing: off (no storm), or in a storm the lit one (it draws the bolts) or idle. */
export type RodRole = 'off' | 'lit' | 'idle';

/** A rod's spot and state. `charge`: the bolts it has drawn this storm. `firedIn`: the storm it last discharged in (it sits out the next one). */
export interface RodState {
  x: number;
  z: number;
  charge: number;
  firedIn: number;
}

/** The rods' spots: `n` evenly round (cx, cz) at `ring` m, the first 30° east of north (-z). */
export function rodSpots(cx: number, cz: number, ring = cfg.rodRing, n = cfg.rodCount): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = ((30 + (360 / n) * i) * Math.PI) / 180;
    out.push([cx + Math.sin(a) * ring, cz - Math.cos(a) * ring]);
  }
  return out;
}

/** Can this rod draw bolts in storm number `storm` (it sits out the storm after the one it fired in)? */
export function rodUsable(r: RodState, storm: number): boolean {
  return storm > r.firedIn + 1;
}

/** The usable rod whose reach (x, z) stands in this storm, or null (in the open, or by a scorched one). */
export function rodAt<T extends RodState>(rods: readonly T[], x: number, z: number, storm: number, reach = cfg.rodReach): T | null {
  for (const r of rods) if (rodUsable(r, storm) && Math.hypot(r.x - x, r.z - z) <= reach) return r;
  return null;
}

/** How far (m) (x, z) has to walk to stand in a usable rod's reach this storm (0 inside one; Infinity if none is usable). */
export function rodWalk(rods: readonly RodState[], x: number, z: number, storm: number, reach = cfg.rodReach): number {
  let best = Infinity;
  for (const r of rods) if (rodUsable(r, storm)) best = Math.min(best, Math.max(0, Math.hypot(r.x - x, r.z - z) - reach));
  return best;
}

/**
 * A storm's pulses, in boss seconds from the call: every `gap` s (never under `floor` real seconds apart at a rift's
 * tempo), the last one the thunderstorm.
 */
export function pulseTimes(tempo: number, n = cfg.pulses, gap = cfg.pulseGap, floor = cfg.pulseFloor): number[] {
  const g = Math.max(gap, floor * tempo);
  return Array.from({ length: n }, (_, i) => g * (i + 1));
}

/** How far (m) the lit rod's reach can be from you: a walk to it with `cfg.stormSpare` s left before the last pulse. */
export function stormWalk(tempo: number): number {
  const times = pulseTimes(tempo);
  return playerCfg.moveSpeed * Math.max(0, times[times.length - 1] / tempo - 0.35 - cfg.stormSpare);
}

// ------------------------------------------------------------------ the lit rod

/** The usable rod nearest (x, z) this storm (its index), or -1 if none is usable. */
export function nearestRod(rods: readonly RodState[], x: number, z: number, storm: number): number {
  let best = -1;
  let bestD = Infinity;
  rods.forEach((r, i) => {
    const d = Math.hypot(r.x - x, r.z - z);
    if (rodUsable(r, storm) && d < bestD) {
      best = i;
      bestD = d;
    }
  });
  return best;
}

/**
 * The rod a storm lights: at random among the usable ones whose reach (x, z) can walk to (`walk` m), never the one you
 * stand by while another is in reach, so getting there is the task (2026-10-22, the user's call: one rod a storm, no
 * relay); -1 if none is in reach (the storm waits).
 */
export function stormRod(rods: readonly RodState[], x: number, z: number, storm: number, walk: number, rng: () => number, reach = cfg.rodReach): number {
  const ok = rods.map((_, i) => i).filter((i) => rodUsable(rods[i], storm) && Math.max(0, Math.hypot(rods[i].x - x, rods[i].z - z) - reach) <= walk);
  const away = ok.filter((i) => Math.hypot(rods[i].x - x, rods[i].z - z) > reach);
  const pool = away.length ? away : ok;
  return pool.length ? pool[Math.floor(rng() * pool.length)] : -1;
}

// ------------------------------------------------------------------ attack layouts

type Pt = [number, number];
const on = (x: number, z: number, yaw: number, d: number): Pt => [x + Math.sin(yaw) * d, z + Math.cos(yaw) * d];

/**
 * Feather rain (each storm, from the sky): one circle by you, its middle `near` m off you on the side away from the
 * lit rod (stepping toward the rod gets you out, inside its reach), and one `far` m farther out (within 45° of away
 * from the rod, so it never shuts the way in). Hugging the rod's post (within `hug` m of it) the near one comes from
 * beside you instead, so you step round the post.
 */
export function featherSpots(px: number, pz: number, rodX: number, rodZ: number, rng: () => number, near = cfg.featherNear, far = cfg.featherFar, hug = 2.2): [Pt, Pt] {
  const out = Math.atan2(px - rodX, pz - rodZ);
  const away = Math.hypot(px - rodX, pz - rodZ) < hug ? out + (rng() < 0.5 ? 1 : -1) * (Math.PI / 2) : out + (rng() - 0.5) * (Math.PI * 2 / 3);
  const a = out + (rng() - 0.5) * (Math.PI / 2);
  const d = far[0] + rng() * (far[1] - far[0]);
  return [on(px, pz, away, near), on(px, pz, a, d)];
}

/** Which side of a lane (yaw) points into the summit more: +1 (its right, yaw + 90°) or -1. */
function inward(px: number, pz: number, yaw: number, cx: number, cz: number): 1 | -1 {
  const [rx, rz] = on(0, 0, yaw + Math.PI / 2, 1);
  return (cx - px) * rx + (cz - pz) * rz >= 0 ? 1 : -1;
}

/**
 * Swoop + flank orbs: three orb circles along one side of a swoop lane through you (at you and `spacing` m either way
 * along it, `offset` m off its middle), so the way out is the other side, the one facing into the summit. Returns the
 * orbs' middles and the open side.
 */
export function flankOrbs(px: number, pz: number, yaw: number, cx: number, cz: number, offset = cfg.flankOffset, spacing = cfg.flankSpacing): { orbs: Pt[]; open: 1 | -1 } {
  const open = inward(px, pz, yaw, cx, cz);
  const side = yaw - (open * Math.PI) / 2;
  const orbs = [-1, 0, 1].map((k): Pt => {
    const [ax, az] = on(px, pz, yaw, k * spacing);
    return on(ax, az, side, offset);
  });
  return { orbs, open };
}

/**
 * A ring of orbs round a plummet's circle with one gap (toward the middle of the summit, give or take 60°): `slots`
 * evenly round at `ring` m from (px, pz), the gap's left out. Returns the orbs and the gap's direction.
 */
export function ringOrbs(px: number, pz: number, cx: number, cz: number, rng: () => number, slots = cfg.ringSlots, ring = cfg.ringR): { orbs: Pt[]; gap: number } {
  const toMid = Math.hypot(cx - px, cz - pz) > 1 ? Math.atan2(cx - px, cz - pz) : rng() * Math.PI * 2;
  const step = (Math.PI * 2) / slots;
  const gap = toMid + Math.round(((rng() - 0.5) * (Math.PI * 2 / 3)) / step) * step;
  const orbs: Pt[] = [];
  for (let i = 1; i < slots; i++) orbs.push(on(px, pz, gap + i * step, ring));
  return { orbs, gap };
}

/**
 * Below 1/3 HP, the cage (a Hell triple: three telegraphs at once, one way out): the swoop's lane through you along
 * `yaw`, the lash's across it through you, and orbs in three of the four corners the cross leaves, `dist` m out on
 * the diagonals. The free corner is one whose pocket (`pocketAt` m out on its diagonal) lies on the summit, nearest
 * its middle; null if none does. Returns the lash's yaw, the orbs and the pocket.
 */
export function cagePlan(
  px: number, pz: number, yaw: number, cx: number, cz: number, rim: number, dist = cfg.cageOrbDist, pocketAt = cfg.cagePocket,
): { lashYaw: number; orbs: Pt[]; pocket: Pt } | null {
  const corners = [1, 3, 5, 7].map((k) => yaw + (k * Math.PI) / 4);
  const pockets = corners.map((a) => on(px, pz, a, pocketAt));
  const ok = pockets.map(([x, z]) => Math.hypot(x - cx, z - cz) <= rim);
  let free = -1;
  pockets.forEach(([x, z], i) => {
    if (ok[i] && (free < 0 || Math.hypot(x - cx, z - cz) < Math.hypot(pockets[free][0] - cx, pockets[free][1] - cz))) free = i;
  });
  if (free < 0) return null;
  return {
    lashYaw: yaw + Math.PI / 2,
    orbs: corners.filter((_, i) => i !== free).map((a) => on(px, pz, a, dist)),
    pocket: pockets[free],
  };
}

// ------------------------------------------------------------------ sparks

/** One spark drifting across the summit (its own clock: `t` seconds old). */
export interface Spark {
  x: number;
  z: number;
  vx: number;
  vz: number;
  t: number;
}

/** A stream: `n` sparks in a line leaving (fx, fz) toward (tx, tz), `spacing` m apart (the first at the start). */
export function aimedStream(fx: number, fz: number, tx: number, tz: number, n = cfg.streamCount, spacing = cfg.streamSpacing, speed = cfg.sparkSpeed): Spark[] {
  const d = Math.hypot(tx - fx, tz - fz) || 1;
  const ux = (tx - fx) / d;
  const uz = (tz - fz) / d;
  return Array.from({ length: n }, (_, i) => ({ x: fx - ux * spacing * i, z: fz - uz * spacing * i, vx: ux * speed, vz: uz * speed, t: 0 }));
}

/** A spiral's beat: one spark out of each of `arms` arms at angle `base` (radians) round (x, z). */
export function spiralBurst(x: number, z: number, arms: number, base: number, speed = cfg.sparkSpeed): Spark[] {
  return Array.from({ length: arms }, (_, i) => {
    const a = base + (i * Math.PI * 2) / arms;
    return { x, z, vx: Math.sin(a) * speed, vz: Math.cos(a) * speed, t: 0 };
  });
}

/** Move a spark on `dt`; false once it has left the summit (`rim` m from its middle) or lived too long. */
export function driftSpark(s: Spark, dt: number, cx: number, cz: number, rim: number): boolean {
  s.x += s.vx * dt;
  s.z += s.vz * dt;
  s.t += dt;
  // Streams start just outside the rim: only those heading out again (or old ones) go.
  const out = Math.hypot(s.x - cx, s.z - cz) > rim + 1.5 && (s.x - cx) * s.vx + (s.z - cz) * s.vz > 0;
  return !out && s.t < cfg.sparkLife;
}

/** Does a spark touch a body of radius `r` at (x, z)? */
export const sparkTouches = (s: Spark, x: number, z: number, r: number): boolean => Math.hypot(s.x - x, s.z - z) <= cfg.sparkRadius + r;

// ------------------------------------------------------------------ the rods

const STEEL = 0x50586a;
/** A rod this near you (m) fades to ROD_FADE so it doesn't fill the screen (the camera trails you). */
const ROD_FADE_REACH = 6;
const ROD_FADE = 0.3;
const COPPER = 0xd08a4a;
const LIT = 0x8ae8ff;
const SCORCHED = 0xff7a4a;

/** One lightning rod: an iron mast on a stone plinth, three copper coils (one lights per bolt), a glass bulb on top and its reach ring. */
export class Rod implements RodState {
  readonly group = new THREE.Group();
  readonly collider: TreeCollider;
  charge = 0;
  firedIn = -10;
  private coils: THREE.MeshStandardMaterial[] = [];
  private bulb: THREE.MeshStandardMaterial;
  private halo: THREE.Sprite;
  private ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private fill: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  private smoke: THREE.Mesh[] = [];
  /** 0..1: a flash when a bolt lands on it. */
  private flash = 0;
  /** Its own materials, so it alone can turn see-through while you stand by it (`seeThrough`). */
  private solid: THREE.Material[] = [];
  /** The pillar of light that stands on it while it is the storm's lit rod: step into it. */
  private column: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;

  constructor(readonly x: number, readonly z: number) {
    this.collider = { x, z, r: cfg.rodR };
    this.group.position.set(x, 0, z);
    const stone = mat(0x6a6e78);
    const steel = mat(STEEL, { rough: 0.45 });
    this.solid.push(stone, steel);
    part(this.group, new THREE.CylinderGeometry(0.85, 1.05, 0.6, 8), stone, [0, 0.3, 0]);
    part(this.group, new THREE.CylinderGeometry(0.62, 0.8, 0.35, 8), stone, [0, 0.75, 0]);
    part(this.group, new THREE.CylinderGeometry(0.16, 0.26, 5.6, 6), steel, [0, 3.6, 0]);
    // Guy fins at the foot and a crossbar under the bulb.
    for (let i = 0; i < 4; i++) part(this.group, new THREE.BoxGeometry(0.08, 1.4, 0.5), steel, [Math.sin((i * Math.PI) / 2) * 0.3, 1.5, Math.cos((i * Math.PI) / 2) * 0.3], [0, (i * Math.PI) / 2, 0]);
    part(this.group, new THREE.BoxGeometry(1.4, 0.1, 0.1), steel, [0, 5.7, 0]);
    for (let i = 0; i < 3; i++) {
      const m = mat(COPPER, { rough: 0.35, emissive: LIT, emissiveIntensity: 0 });
      this.coils.push(m);
      this.solid.push(m);
      part(this.group, new THREE.TorusGeometry(0.42 - i * 0.06, 0.09, 6, 14), m, [0, 2.4 + i * 1.05, 0], [Math.PI / 2, 0, 0]);
    }
    this.bulb = mat(0xb8d8e8, { rough: 0.15, emissive: LIT, emissiveIntensity: 0.15 });
    this.bulb.userData.glow = true;
    this.solid.push(this.bulb);
    part(this.group, new THREE.IcosahedronGeometry(0.42, 1), this.bulb, [0, 6.6, 0]);
    part(this.group, new THREE.ConeGeometry(0.07, 1.1, 5), steel, [0, 7.4, 0]);
    this.halo = glowSprite(LIT, 3.2, 0);
    this.halo.position.y = 6.6;
    this.group.add(this.halo);
    // The reach: a ring on the floor (and a faint fill while a storm is on).
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(cfg.rodReach - 0.16, cfg.rodReach, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: LIT, transparent: true, opacity: 0.2, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.ring.position.y = 0.04;
    this.fill = new THREE.Mesh(
      new THREE.CircleGeometry(cfg.rodReach - 0.16, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: LIT, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.fill.position.y = 0.035;
    this.column = new THREE.Mesh(
      new THREE.CylinderGeometry(cfg.rodReach, cfg.rodReach, 22, 40, 1, true),
      new THREE.MeshBasicMaterial({ color: LIT, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
    );
    this.column.position.y = 11;
    this.column.visible = false;
    this.group.add(this.ring, this.fill, this.column);
    // Smoke puffs while it is scorched.
    const smokeMat = new THREE.MeshBasicMaterial({ color: 0x3a3a40, transparent: true, opacity: 0.5, depthWrite: false });
    for (let i = 0; i < 4; i++) {
      const s = new THREE.Mesh(new THREE.IcosahedronGeometry(0.4, 0), smokeMat);
      s.visible = false;
      this.group.add(s);
      this.smoke.push(s);
    }
    this.group.add(glowDecal(0x4a6a8a, 3.6, 0.35));
  }

  /** The point bolts strike (the bulb). */
  top(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(this.x, 6.6, this.z);
  }

  /** A pulse of the storm into it: `charge` of its coils now lit (one a pulse). */
  struck(charge: number): void {
    this.charge = Math.min(cfg.pulses, charge);
    this.flash = 1;
  }

  /** Full: it discharges and is scorched for the storm after this one. */
  discharge(storm: number): void {
    this.charge = 0;
    this.firedIn = storm;
    this.flash = 1;
  }

  /** Fade it while you stand within ROD_FADE_REACH of it, back again once you step away. */
  seeThrough(dt: number, px: number, pz: number): void {
    const target = Math.hypot(this.x - px, this.z - pz) < ROD_FADE_REACH ? ROD_FADE : 1;
    for (const m of this.solid) {
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

  /** `storm`: the storm on (or the next one, between storms). `role`: off between storms; in one, lit (it draws the bolts) or idle. */
  update(dt: number, time: number, storm: number, role: RodRole): void {
    this.flash = Math.max(0, this.flash - dt * 3);
    const usable = rodUsable(this, storm);
    const on = role === 'lit';
    const pulse = 0.5 + 0.5 * Math.sin(time * 6 + this.x);
    this.coils.forEach((m, i) => {
      m.emissive.setHex(usable ? LIT : SCORCHED);
      m.emissiveIntensity = i < this.charge ? 1.6 + pulse * 0.6 : 0.05 + this.flash;
    });
    this.bulb.emissive.setHex(usable ? LIT : SCORCHED);
    this.bulb.emissiveIntensity = (usable ? 0.2 + (this.charge / cfg.pulses) * 1.2 : 0.1) + (on && usable ? 0.6 * pulse : 0) + this.flash * 2;
    this.halo.material.opacity = Math.min(1, (on && usable ? 0.35 + 0.25 * pulse : 0) + (this.charge / cfg.pulses) * 0.4 + this.flash);
    this.column.visible = on;
    this.column.material.opacity = on ? 0.16 + 0.08 * pulse + this.flash * 0.25 : 0;
    this.ring.material.color.setHex(usable ? LIT : SCORCHED);
    this.ring.material.opacity = !usable ? 0.08 : role === 'lit' ? 0.7 + 0.25 * pulse : role === 'idle' ? 0.07 : 0.14;
    this.fill.material.color.setHex(usable ? LIT : SCORCHED);
    this.fill.material.opacity = role === 'lit' ? 0.12 + 0.06 * pulse : 0;
    // Scorched: smoke curls off the bulb.
    const scorched = !usable;
    this.smoke.forEach((s, i) => {
      s.visible = scorched;
      if (!scorched) return;
      const k = (time * 0.35 + i / this.smoke.length) % 1;
      s.position.set(Math.sin(time + i * 2) * 0.3 * k, 6.8 + k * 3, Math.cos(time * 0.7 + i) * 0.3 * k);
      s.scale.setScalar(0.5 + k * 1.4);
      (s.material as THREE.MeshBasicMaterial).opacity = 0.45 * (1 - k);
    });
  }
}

/** All six, with their colliders kept in the level's tree list (they block like trunks). */
export class LightningRods {
  readonly group = new THREE.Group();
  readonly list: Rod[];

  constructor(cx: number, cz: number) {
    this.list = rodSpots(cx, cz).map(([x, z]) => new Rod(x, z));
    for (const r of this.list) this.group.add(r.group);
  }

  sync(trees: TreeCollider[]): void {
    for (const r of this.list) if (!trees.includes(r.collider)) trees.push(r.collider);
  }

  /** `lit`: the storm's rod while one is on (-1: none). */
  update(dt: number, time: number, storm: number, on: boolean, lit = -1): void {
    this.list.forEach((r, i) => r.update(dt, time, storm, !on ? 'off' : i === lit ? 'lit' : 'idle'));
  }

  seeThrough(dt: number, px: number, pz: number): void {
    for (const r of this.list) r.seeThrough(dt, px, pz);
  }
}

/** Phase 2: a tornado that wanders the summit for a while, leaning toward you; a touch tosses you (the boss does the hit). */
export class Cyclone {
  readonly group = new THREE.Group();
  life: number = cfg.cycloneLife;
  /** Seconds before it can hit again. */
  hitT = 0;
  private dir: number;
  private turn = 0;
  private rings: THREE.Mesh[] = [];
  private mat: THREE.MeshBasicMaterial;

  constructor(public x: number, public z: number, dir: number) {
    this.dir = dir;
    this.mat = new THREE.MeshBasicMaterial({ color: 0xc8dcf0, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
    // A funnel of stacked open rings, wider toward the top, spinning at different rates.
    for (let i = 0; i < 9; i++) {
      const r = cfg.cycloneRadius * (0.45 + i * 0.16);
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.86, 0.7, 14, 1, true), this.mat);
      ring.position.y = 0.35 + i * 0.75;
      this.rings.push(ring);
      this.group.add(ring);
    }
    this.group.add(glowDecal(0x9ab8d8, cfg.cycloneRadius * 3, 0.4));
    this.group.position.set(x, 0, z);
  }

  /** Wander, leaning toward (px, pz), kept on the summit (centre and radius). */
  update(dt: number, time: number, px: number, pz: number, cx: number, cz: number, rim: number): void {
    this.life -= dt;
    this.hitT = Math.max(0, this.hitT - dt);
    this.turn += (Math.sin(time * 0.9 + this.x) * 0.8 - this.turn) * dt;
    const seek = Math.atan2(px - this.x, pz - this.z);
    let d = seek - this.dir;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.dir += (this.turn + d * 0.35) * dt;
    this.x += Math.sin(this.dir) * cfg.cycloneSpeed * dt;
    this.z += Math.cos(this.dir) * cfg.cycloneSpeed * dt;
    const ox = this.x - cx;
    const oz = this.z - cz;
    const o = Math.hypot(ox, oz);
    if (o > rim) {
      this.x = cx + (ox / o) * rim;
      this.z = cz + (oz / o) * rim;
      this.dir = Math.atan2(-ox, -oz);
    }
    this.group.position.set(this.x, 0, this.z);
    const fade = Math.min(1, (cfg.cycloneLife - this.life) / 0.8, Math.max(0, this.life) / 0.8);
    this.mat.opacity = 0.32 * fade;
    this.rings.forEach((r, i) => (r.rotation.y = time * (5 + i * 0.7)));
    this.group.scale.setScalar(0.4 + 0.6 * fade);
  }

  get done(): boolean {
    return this.life <= 0;
  }
}

/**
 * The sparks drifting over the summit, drawn instanced: a white core in a cyan halo at chest height, and a glow on the
 * floor under each so you can read them at your feet. The boss spawns them and does the hits.
 */
export class SparkField {
  readonly group = new THREE.Group();
  readonly list: Spark[] = [];
  private cores: THREE.InstancedMesh;
  private halos: THREE.InstancedMesh;
  private floors: THREE.InstancedMesh;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private sc = new THREE.Vector3();

  constructor(private max = 220) {
    const add = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending } as const;
    this.cores = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.22, 1), new THREE.MeshBasicMaterial({ color: 0xf0fcff }), max);
    this.halos = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(cfg.sparkRadius, 1), new THREE.MeshBasicMaterial({ color: LIT, opacity: 0.32, ...add }), max);
    this.floors = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      // Dimmer and smaller than an orb's warning (the same cyan), so the two don't read alike.
      new THREE.MeshBasicMaterial({ color: LIT, map: glowTexture(), opacity: 0.35, ...add }),
      max,
    );
    for (const im of [this.cores, this.halos, this.floors]) {
      im.count = 0;
      im.frustumCulled = false;
      this.group.add(im);
    }
  }

  add(sparks: Spark[]): void {
    for (const s of sparks) if (this.list.length < this.max) this.list.push(s);
  }

  clear(): void {
    this.list.length = 0;
    this.draw(0);
  }

  /** Move them on and drop the ones gone (`keep`: false drops one, e.g. it hit you). */
  update(dt: number, time: number, cx: number, cz: number, rim: number, keep: (s: Spark) => boolean): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const s = this.list[i];
      if (!driftSpark(s, dt, cx, cz, rim) || !keep(s)) this.list.splice(i, 1);
    }
    this.draw(time);
  }

  private draw(time: number): void {
    const n = this.list.length;
    this.list.forEach((s, i) => {
      const y = cfg.sparkHeight + Math.sin(time * 9 + i * 1.7) * 0.08;
      const flicker = 0.85 + 0.3 * Math.sin(time * 31 + i * 2.3);
      this.m.compose(this.v.set(s.x, y, s.z), this.q.identity(), this.sc.setScalar(flicker));
      this.cores.setMatrixAt(i, this.m);
      this.m.compose(this.v.set(s.x, y, s.z), this.q, this.sc.setScalar(0.9 + 0.2 * flicker));
      this.halos.setMatrixAt(i, this.m);
      this.m.compose(this.v.set(s.x, 0.05, s.z), this.q, this.sc.set(1.2, 1, 1.2));
      this.floors.setMatrixAt(i, this.m);
    });
    for (const im of [this.cores, this.halos, this.floors]) {
      im.count = n;
      im.instanceMatrix.needsUpdate = true;
    }
  }
}
