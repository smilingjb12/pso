import * as THREE from 'three';
import { barbaRay as cfg, player as playerCfg } from '../config';
import type { Hittable, StatusEffect } from '../combat/types';
import { mat, part } from '../models/Rig';
import { rayMesh } from '../models/barbaRay';
import { glowDecal } from '../world/glow';

// Barba Ray's flood and its rays (see BarbaRay and DESIGN.md "Barba Ray"): where the platforms stand and which one sinks
// next, the layouts of its attacks (the spout line, the ripple bands, the Pig Ray burst), the lanes the Pig Rays dart
// along, and the pieces of the arena it owns: the platforms, the water, the Pig Rays and the Ul Rays. Pure rules first,
// so they can be tested without the boss.

type Pt = [number, number];
const on = (x: number, z: number, yaw: number, d: number): Pt => [x + Math.sin(yaw) * d, z + Math.cos(yaw) * d];

// ------------------------------------------------------------------ the platforms

/**
 * A platform's spot and whether it stands (dry in a flood) or has sunk; `sinking`: warned, going under once the warning
 * runs out (still dry till then). `inner`: one of the ring round the middle.
 */
export interface PlatformState {
  x: number;
  z: number;
  inner: boolean;
  up: boolean;
  sinking?: boolean;
}

/**
 * Where the platforms stand round (cx, cz): `count` evenly `ring` m out (the first 22.5° east of north, so none sits
 * under its perch), and `innerCount` round the middle `innerRing` m out, between them.
 */
export function platformSpots(cx: number, cz: number): { x: number; z: number; inner: boolean }[] {
  const out: { x: number; z: number; inner: boolean }[] = [];
  for (let i = 0; i < cfg.platformCount; i++) {
    const a = ((22.5 + (360 / cfg.platformCount) * i) * Math.PI) / 180;
    out.push({ x: cx + Math.sin(a) * cfg.platformRing, z: cz - Math.cos(a) * cfg.platformRing, inner: false });
  }
  for (let i = 0; i < cfg.innerCount; i++) {
    const a = ((60 + (360 / cfg.innerCount) * i) * Math.PI) / 180;
    out.push({ x: cx + Math.sin(a) * cfg.innerRing, z: cz - Math.cos(a) * cfg.innerRing, inner: true });
  }
  return out;
}

/** The standing platform (x, z) is on (its index), or -1 in the water. Its edge counts: a body half on it stands dry. */
export function platformAt(ps: readonly PlatformState[], x: number, z: number, r = cfg.platformR): number {
  return ps.findIndex((p) => p.up && Math.hypot(p.x - x, p.z - z) <= r);
}

/** How far (m) (x, z) has to go to stand on a standing platform (0 on one; Infinity with none up). */
export function dryWalk(ps: readonly PlatformState[], x: number, z: number, r = cfg.platformR): number {
  let best = Infinity;
  for (const p of ps) if (p.up) best = Math.min(best, Math.max(0, Math.hypot(p.x - x, p.z - z) - r));
  return best;
}

/**
 * The platform a flood sinks next (its index), or -1: never below `keep` standing. The one you stand on `under` of the
 * time (rng), else one of the two standing nearest you (not yours); in a whirlpool (phase 3) the one nearest the middle.
 */
export function sinkPick(
  ps: readonly PlatformState[], px: number, pz: number, cx: number, cz: number, rng: () => number, whirl = false, keep = cfg.keepPlatforms, under = cfg.sinkUnder,
): number {
  const up = ps.map((_, i) => i).filter((i) => ps[i].up && !ps[i].sinking);
  if (up.length <= keep) return -1;
  if (whirl) return up.reduce((a, b) => (Math.hypot(ps[b].x - cx, ps[b].z - cz) < Math.hypot(ps[a].x - cx, ps[a].z - cz) ? b : a));
  const mine = platformAt(ps, px, pz);
  if (mine >= 0 && !ps[mine].sinking && rng() < under) return mine;
  const near = up.filter((i) => i !== mine).sort((a, b) => Math.hypot(ps[a].x - px, ps[a].z - pz) - Math.hypot(ps[b].x - px, ps[b].z - pz));
  return near[Math.floor(rng() * Math.min(2, near.length))] ?? -1;
}

/** Edge-to-edge gap (m) between platform `i` and the nearest other standing one. */
export function nearestGap(ps: readonly PlatformState[], i: number, r = cfg.platformR): number {
  let best = Infinity;
  ps.forEach((p, j) => {
    if (j !== i && p.up) best = Math.min(best, Math.hypot(p.x - ps[i].x, p.z - ps[i].z) - 2 * r);
  });
  return best;
}

// ------------------------------------------------------------------ attack layouts

/** The spout line: `n` geysers `spacing` m apart along `yaw` from (x, z), the first `first` m out. */
export function spoutLine(x: number, z: number, yaw: number, first = 3, n = cfg.spoutCount, spacing = cfg.spoutSpacing): Pt[] {
  return Array.from({ length: n }, (_, i) => on(x, z, yaw, first + i * spacing));
}

/** The ripple bands round the slam: [inner, outer] m, `n` of them `band` m wide from `inner`. */
export function rippleBands(inner = cfg.rippleInner, band = cfg.rippleBand, n = cfg.rippleBands): [number, number][] {
  return Array.from({ length: n }, (_, i): [number, number] => [inner + i * band, inner + (i + 1) * band]);
}

/** The Pig Ray burst: `n` headings `spread`° apart, the middle one at `yaw` (n odd: one straight at you). */
export function burstYaws(yaw: number, n = cfg.burstCount, spread = cfg.burstSpread): number[] {
  const step = (spread * Math.PI) / 180;
  return Array.from({ length: n }, (_, i) => yaw + (i - (n - 1) / 2) * step);
}

/** How far (m) from (x, z) along `yaw` to a circle of radius `R` round (cx, cz) (0 if outside it, heading out). */
export function toCircle(x: number, z: number, yaw: number, cx: number, cz: number, R: number): number {
  const dx = Math.sin(yaw);
  const dz = Math.cos(yaw);
  const ox = x - cx;
  const oz = z - cz;
  const b = ox * dx + oz * dz;
  const c = ox * ox + oz * oz - R * R;
  return Math.max(0, -b + Math.sqrt(Math.max(0, b * b - c)));
}

/** A lane a Pig Ray darts along: from a random point just past the rim, aimed at (tx, tz) give or take `spread` m, to past the far rim. */
export function pigLane(cx: number, cz: number, tx: number, tz: number, rng: () => number, spread = cfg.pigSpread): { x: number; z: number; yaw: number; length: number } {
  const rim = cfg.arenaRadius + 1;
  const a = rng() * Math.PI * 2;
  const x = cx + Math.sin(a) * rim;
  const z = cz + Math.cos(a) * rim;
  const o = rng() * Math.PI * 2;
  const r = Math.sqrt(rng()) * spread;
  const yaw = Math.atan2(tx + Math.sin(o) * r - x, tz + Math.cos(o) * r - z);
  return { x, z, yaw, length: toCircle(x, z, yaw, cx, cz, rim + 0.5) };
}

/** Walking a warning of `seconds` (its clock) at a rift tempo covers this much, after the usual 0.35 s reaction. */
export const walkIn = (seconds: number, tempo: number): number => playerCfg.moveSpeed * Math.max(0, seconds / tempo - 0.35);

// ------------------------------------------------------------------ the platforms (meshes)

const MARBLE = 0xf2efe6;
const GOLD = 0xd9b24a;
const DRY = 0x7ae0ff;
const SINKING = 0xff6a4a;
const WATER = 0x2a90d8;

/** One platform: a low marble dais with a gold rim, its dry ring lit in a flood; it sinks under the water and rises again. */
export class Platform implements PlatformState {
  readonly group = new THREE.Group();
  up = true;
  /** Warned: it goes under when its warning runs out (`sink`). */
  sinking = false;
  /** 0 standing .. 1 sunk (the animation). */
  private sunk = 0;
  private ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private crack: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;

  constructor(readonly x: number, readonly z: number, readonly inner: boolean) {
    this.group.position.set(x, 0, z);
    const R = cfg.platformR;
    part(this.group, new THREE.CylinderGeometry(R, R + 0.12, 0.16, 36), mat(MARBLE, { rough: 0.5 }), [0, 0.04, 0]);
    part(this.group, new THREE.TorusGeometry(R - 0.05, 0.06, 6, 40), mat(GOLD, { rough: 0.3 }), [0, 0.13, 0], [Math.PI / 2, 0, 0]);
    // A gold sunburst inlay on the top.
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      part(this.group, new THREE.BoxGeometry(0.08, 0.01, R * 0.7), mat(GOLD, { rough: 0.3 }), [Math.sin(a) * R * 0.4, 0.125, Math.cos(a) * R * 0.4], [0, a, 0]);
    }
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(R - 0.1, R + 0.25, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: DRY, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.ring.position.y = 0.16;
    this.crack = new THREE.Mesh(
      new THREE.CircleGeometry(R, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: SINKING, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.crack.position.y = 0.14;
    this.group.add(this.ring, this.crack, glowDecal(0x6ab8e0, R * 2.4, 0.25));
  }

  /** Its warning ran out: under it goes. */
  sink(): void {
    this.up = false;
    this.sinking = false;
  }

  /** Back up (the water drained). */
  rise(): void {
    this.up = true;
    this.sinking = false;
  }

  /** `flood`: the water is up (the dry ring shows). */
  update(dt: number, time: number, flood: boolean): void {
    this.sunk += ((this.up ? 0 : 1) - this.sunk) * Math.min(1, dt * 4);
    this.group.position.y = -0.9 * this.sunk;
    const pulse = 0.5 + 0.5 * Math.sin(time * 6 + this.x);
    const sinking = this.sinking;
    this.ring.material.color.setHex(sinking ? SINKING : DRY);
    this.ring.material.opacity = !this.up ? 0 : sinking ? 0.6 + 0.4 * Math.sin(time * 14) : flood ? 0.45 + 0.25 * pulse : 0.12;
    this.crack.material.opacity = sinking ? 0.25 + 0.2 * Math.sin(time * 14) : 0;
  }
}

/** All of them. */
export class Platforms {
  readonly group = new THREE.Group();
  readonly list: Platform[];

  constructor(cx: number, cz: number) {
    this.list = platformSpots(cx, cz).map((s) => new Platform(s.x, s.z, s.inner));
    for (const p of this.list) this.group.add(p.group);
  }

  update(dt: number, time: number, flood: boolean): void {
    for (const p of this.list) p.update(dt, time, flood);
  }
}

// ------------------------------------------------------------------ the water

/** The flood: a sheet of sea over the court that rises and drains, with ripples, and the phase 3 whirlpool. */
export class Water {
  readonly group = new THREE.Group();
  /** 0 drained .. 1 flooded. */
  level = 0;
  private sheet: THREE.Mesh<THREE.CircleGeometry, THREE.MeshStandardMaterial>;
  private shine: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>[] = [];
  private whirl: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>[] = [];
  private whirlOn = 0;

  constructor(cx: number, cz: number) {
    this.group.position.set(cx, 0, cz);
    this.sheet = new THREE.Mesh(
      new THREE.CircleGeometry(cfg.arenaRadius + 0.6, 72).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: WATER, emissive: 0x0a4a80, emissiveIntensity: 0.6, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.82, depthWrite: false }),
    );
    this.group.add(this.sheet);
    // Ripple rings drifting outward over the sheet.
    for (let i = 0; i < 6; i++) {
      const r = new THREE.Mesh(
        new THREE.RingGeometry(0.92, 1, 64).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0xbfeaff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }),
      );
      this.shine.push(r);
      this.group.add(r);
    }
    // The whirlpool: rings spiralling in on the middle.
    for (let i = 0; i < 5; i++) {
      const r = new THREE.Mesh(
        new THREE.RingGeometry(0.8, 1, 48, 1, 0, Math.PI * 1.4).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0xe6f8ff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
      );
      this.whirl.push(r);
      this.group.add(r);
    }
    this.group.visible = false;
  }

  update(dt: number, time: number, target: number, whirl: boolean): void {
    this.level += (target - this.level) * Math.min(1, dt * 3);
    if (Math.abs(this.level - target) < 0.002) this.level = target;
    this.whirlOn += ((whirl ? 1 : 0) - this.whirlOn) * Math.min(1, dt * 2);
    this.group.visible = this.level > 0.01;
    if (!this.group.visible) return;
    // Up from under the floor to a little over it (the platform tops stand clear of it).
    const y = -0.25 + 0.33 * this.level;
    this.sheet.position.y = y;
    this.sheet.material.opacity = 0.82 * Math.min(1, this.level * 1.4);
    this.shine.forEach((r, i) => {
      const k = (time * 0.12 + i / this.shine.length) % 1;
      const s = 1 + k * cfg.arenaRadius;
      r.scale.setScalar(s);
      r.position.y = y + 0.01;
      r.material.opacity = 0.18 * this.level * (1 - k);
    });
    this.whirl.forEach((r, i) => {
      const k = (time * 0.35 + i / this.whirl.length) % 1;
      r.scale.setScalar(1 + (1 - k) * 7);
      r.rotation.y = time * 3 + i;
      r.position.y = y + 0.02;
      r.material.opacity = 0.5 * this.whirlOn * this.level * k;
    });
  }
}

// ------------------------------------------------------------------ Pig Rays

/** One Pig Ray darting down its lane: where it is, the way left, and whether it has hit you. */
export interface PigRay {
  x: number;
  z: number;
  yaw: number;
  left: number;
  hit: boolean;
  t: number;
  /** m/s (default `pigSpeed`; a burst's fly faster). */
  speed?: number;
}

/** Move a Pig Ray on `dt`; false once it has run its lane. */
export function dartPig(p: PigRay, dt: number): boolean {
  const step = Math.min(p.left, (p.speed ?? cfg.pigSpeed) * dt);
  p.x += Math.sin(p.yaw) * step;
  p.z += Math.cos(p.yaw) * step;
  p.left -= step;
  p.t += dt;
  return p.left > 0;
}

/** Does a Pig Ray touch a body of radius `r` at (x, z)? */
export const pigTouches = (p: PigRay, x: number, z: number, r: number): boolean => Math.hypot(p.x - x, p.z - z) <= cfg.pigRadius + r;

/** The Pig Rays in flight, each a little rose ray skimming at waist height. The boss launches them and does the hits. */
export class PigRays {
  readonly group = new THREE.Group();
  readonly list: PigRay[] = [];
  private meshes: THREE.Group[] = [];

  add(p: PigRay): void {
    this.list.push(p);
  }

  clear(): void {
    this.list.length = 0;
    this.sync(0);
  }

  /** Move them on and drop the ones done (`keep`: false drops one, e.g. it hit you). */
  update(dt: number, time: number, keep: (p: PigRay) => boolean): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      if (!dartPig(p, dt) || !keep(p)) this.list.splice(i, 1);
    }
    this.sync(time);
  }

  private sync(time: number): void {
    while (this.meshes.length < this.list.length) {
      const m = rayMesh(0xf08ab4, 1.4);
      this.meshes.push(m);
      this.group.add(m);
    }
    this.meshes.forEach((m, i) => {
      const p = this.list[i];
      m.visible = !!p;
      if (!p) return;
      m.position.set(p.x, 0.9 + Math.sin(time * 7 + i) * 0.1, p.z);
      m.rotation.set(0, p.yaw, Math.sin(time * 9 + i) * 0.25);
    });
  }
}

// ------------------------------------------------------------------ Ul Rays

/**
 * An Ul Ray: a teal ray that rises with the flood, swims round the court and lunges at you along a warned lane.
 * Hittable with HP of its own (the boss's bar doesn't drop when it is hit); it sinks away when the water drains.
 */
export class UlRay implements Hittable {
  readonly group = new THREE.Group();
  readonly pos = this.group.position;
  readonly radius = cfg.ulRadius;
  readonly name = 'Ul Ray';
  readonly armor = 0;
  readonly techResist = 0;
  readonly maxHp: number;
  hp: number;
  /** Its spot on its swim circle (radians), and which way round it swims. */
  ang: number;
  dir: 1 | -1;
  /** Seconds to its next lunge (its clock). */
  lungeT: number;
  /** A lunge under way: its heading and the way left. */
  lunge: { yaw: number; left: number; hit: boolean } | null = null;
  /** Lunging is warned: no other lunge starts until it is done. */
  winding = false;
  private flashT = 0;
  private body: THREE.Group;
  /** 0 under the water .. 1 up. */
  private rise = 0;
  gone = false;

  constructor(hp: number, ang: number, dir: 1 | -1, firstLunge: number) {
    this.maxHp = this.hp = Math.max(1, Math.round(hp));
    this.ang = ang;
    this.dir = dir;
    this.lungeT = firstLunge;
    this.body = rayMesh(0x2fb8b0, 3.4);
    this.group.add(this.body);
  }

  get alive(): boolean {
    return this.hp > 0 && !this.gone;
  }
  get aimHeight(): number {
    return 0.9;
  }
  get invulnerable(): boolean {
    return !this.alive || this.rise < 0.6;
  }
  damage(amount: number): boolean {
    if (!this.alive) return false;
    this.flashT = 0.12;
    this.hp = Math.max(0, this.hp - amount);
    return this.hp <= 0;
  }
  applyStatus(_effect: StatusEffect, _power: number, _duration: number): void {}
  damageMult(): number {
    return 1;
  }
  ccResist(): number {
    return 100;
  }

  /** Sink away (the water drained, or the boss died). */
  sink(): void {
    this.gone = true;
  }

  /** The look: rising out of the water, beating its wings, flashing when hit; false once it has sunk out of sight. */
  update(dt: number, time: number, yaw: number): boolean {
    this.flashT = Math.max(0, this.flashT - dt);
    const up = this.alive ? 1 : 0;
    this.rise += (up - this.rise) * Math.min(1, dt * (up ? 2.5 : 4));
    this.group.position.y = -1.2 + 2 * this.rise;
    this.group.rotation.set(0, yaw, Math.sin(time * 3 + this.ang) * 0.15);
    this.body.scale.setScalar(1 + (this.flashT > 0 ? 0.08 : 0));
    this.body.children.forEach((c) => {
      const m = (c as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (m?.emissive) m.emissiveIntensity = this.flashT > 0 ? 1.4 : 0.35;
    });
    return this.rise > 0.02 || this.alive;
  }
}
