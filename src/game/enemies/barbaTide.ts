import * as THREE from 'three';
import { barbaRay as cfg, player as playerCfg } from '../config';
import type { Hittable, StatusEffect } from '../combat/types';
import { mat, part } from '../models/Rig';
import { rayMesh } from '../models/barbaRay';
import type { Effect } from '../world/Effects';
import { glowDecal } from '../world/glow';

// Barba Ray's three phases and its brood (see BarbaRay and DESIGN.md "Barba Ray"): where a clutch's eggs land and the
// lanes their Pig Rays dart along, where the platforms stand and which one sinks next, the surge rolling across the
// court, the vents of the Deep, and the pieces of the arena it owns (the platforms, the water, the egg sacs, the Pig
// Rays, the Ul Rays, the surge's wall, the vents and the Deep itself). Pure rules first, so they can be tested without
// the boss.

type Pt = [number, number];
const on = (x: number, z: number, yaw: number, d: number): Pt => [x + Math.sin(yaw) * d, z + Math.cos(yaw) * d];

// ------------------------------------------------------------------ the Brood

/**
 * Where a clutch's sacs land round (cx, cz): the first about `near` m from you (toward the middle if that would be off
 * the court), the rest at least `apart` m from each other and from the first, all within `ring` m of the middle.
 */
export function clutchSpots(
  cx: number, cz: number, px: number, pz: number, rng: () => number, n = cfg.clutchCount, near = cfg.clutchNear, apart = cfg.clutchApart, ring = cfg.clutchRing,
): Pt[] {
  const inside = (x: number, z: number) => Math.hypot(x - cx, z - cz) <= ring;
  const out: Pt[] = [];
  for (let i = 0; i < 40 && !out.length; i++) {
    const p = on(px, pz, rng() * Math.PI * 2, near);
    if (inside(p[0], p[1])) out.push(p);
  }
  if (!out.length) {
    const d = Math.max(0.1, Math.hypot(cx - px, cz - pz));
    out.push([px + ((cx - px) / d) * near, pz + ((cz - pz) / d) * near]);
  }
  for (let i = 0; i < 400 && out.length < n; i++) {
    const p = on(cx, cz, rng() * Math.PI * 2, Math.sqrt(rng()) * ring);
    if (out.every(([x, z]) => Math.hypot(x - p[0], z - p[1]) >= apart)) out.push(p);
  }
  // Never short: evenly round the court, as far from the first as it goes.
  const a0 = Math.atan2(out[0][0] - cx, out[0][1] - cz);
  for (let i = 1; out.length < n; i++) out.push(on(cx, cz, a0 + (i * Math.PI * 2) / n, ring * 0.8));
  return out;
}

/** The lane a Pig Ray darts along: from (x, z) at (tx, tz) give or take `spread` m, on past the rim. */
export function dartLane(
  x: number, z: number, tx: number, tz: number, cx: number, cz: number, rng: () => number, spread = cfg.pigSpread,
): { x: number; z: number; yaw: number; length: number } {
  const o = rng() * Math.PI * 2;
  const r = Math.sqrt(rng()) * spread;
  const yaw = Math.atan2(tx + Math.sin(o) * r - x, tz + Math.cos(o) * r - z);
  return { x, z, yaw, length: toCircle(x, z, yaw, cx, cz, cfg.arenaRadius + 1) };
}

// ------------------------------------------------------------------ the platforms

/**
 * A platform's spot and whether it stands (dry in the water) or has sunk; `sinking`: warned, going under once the
 * warning runs out (still dry till then). `inner`: one of the ring round the middle.
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
 * The platform that sinks next (its index), or -1: never below `keep` standing. The one you stand on `under` of the
 * time (rng), else one of the two standing nearest you (not yours).
 */
export function sinkPick(
  ps: readonly PlatformState[], px: number, pz: number, rng: () => number, keep = cfg.keepPlatforms, under = cfg.sinkUnder,
): number {
  const up = ps.map((_, i) => i).filter((i) => ps[i].up && !ps[i].sinking);
  if (up.length <= keep) return -1;
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

/** A surge set off from (x0, z0) heading `yaw`: how far it has to roll to reach (x, z) (m; below 0 behind its start). */
export const surgeAlong = (x0: number, z0: number, yaw: number, x: number, z: number): number => (x - x0) * Math.sin(yaw) + (z - z0) * Math.cos(yaw);

/** Walking a warning of `seconds` (its clock) at a rift tempo covers this much, after the usual 0.35 s reaction. */
export const walkIn = (seconds: number, tempo: number): number => playerCfg.moveSpeed * Math.max(0, seconds / tempo - 0.35);

// ------------------------------------------------------------------ the Deep's vents

/** Where the vents are round (cx, cz): four `inner` m out between the axes, four `outer` m out on them. */
export function ventSpots(cx: number, cz: number, inner = cfg.ventInner, outer = cfg.ventOuter): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < 4; i++) out.push(on(cx, cz, Math.PI / 4 + (i * Math.PI) / 2, inner));
  for (let i = 0; i < 4; i++) out.push(on(cx, cz, (i * Math.PI) / 2, outer));
  return out;
}

/** A vent: off, stirring (bubbles, no air yet) or flowing (air), and seconds in that (its clock). */
export interface VentState {
  x: number;
  z: number;
  phase: 'off' | 'stir' | 'flow';
  t: number;
  /** A flowing vent's successor (its index), stirring until this one stops. */
  next?: number;
}

/** The flowing vent (x, z) stands in (its index), or -1. */
export function ventAt(vs: readonly VentState[], x: number, z: number, r = cfg.ventRadius): number {
  return vs.findIndex((v) => v.phase === 'flow' && Math.hypot(v.x - x, v.z - z) <= r);
}

/**
 * Run the vents on `dt` (its clock): `ventStir` s before a flowing vent stops it stirs up its successor (a random one
 * that's off), which flows the moment it stops, so `ventsOn` always flow.
 */
export function tickVents(vs: VentState[], dt: number, rng: () => number): void {
  for (const v of vs) if (v.phase !== 'off') v.t += dt;
  vs.forEach((v) => {
    if (v.phase !== 'flow') return;
    if (v.next === undefined && v.t >= cfg.ventLife - cfg.ventStir) {
      const off = vs.map((_, i) => i).filter((i) => vs[i].phase === 'off');
      const n = off[Math.floor(rng() * off.length)];
      if (n !== undefined) {
        vs[n].phase = 'stir';
        vs[n].t = v.t - (cfg.ventLife - cfg.ventStir);
        v.next = n;
      }
    }
    if (v.t < cfg.ventLife) return;
    v.phase = 'off';
    v.t = 0;
    const n = v.next !== undefined ? vs[v.next] : undefined;
    v.next = undefined;
    if (n?.phase === 'stir') {
      n.phase = 'flow';
      n.t = 0;
    }
  });
}

/** The vents as the Deep begins: `ventsOn` flowing, a random set, staggered so they hand over one at a time. */
export function startVents(vs: VentState[], rng: () => number): void {
  for (const v of vs) {
    v.phase = 'off';
    v.t = 0;
    v.next = undefined;
  }
  const pool = vs.slice();
  for (let i = 0; i < cfg.ventsOn && pool.length; i++) {
    const v = pool.splice(Math.floor(rng() * pool.length), 1)[0];
    v.phase = 'flow';
    v.t = (i * cfg.ventLife) / cfg.ventsOn;
  }
}

// ------------------------------------------------------------------ the platforms (meshes)

const MARBLE = 0xf2efe6;
const GOLD = 0xd9b24a;
const DRY = 0x7ae0ff;
const SINKING = 0xff6a4a;
const WATER = 0x2a90d8;

/** One platform: a low marble dais with a gold rim, its dry ring lit in the water; it sinks under the water and rises again. */
export class Platform implements PlatformState {
  readonly group = new THREE.Group();
  up = true;
  /** Warned: it goes under when its warning runs out (`sink`). */
  sinking = false;
  /** Seconds it has been under (its clock; 0 while up). */
  downT = 0;
  /** 0 standing .. 1 sunk (the animation). */
  private sunk = 0;
  /** 0 dry .. 1 flooded (the dry ring eases up to its flood glow). */
  private lit = 0;
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

  /** Back up. */
  rise(): void {
    this.up = true;
    this.sinking = false;
  }

  /**
   * `flood`: the water is up (the dry ring shows). Steady glows, no pulsing (the user found it distracting, 2026-10-22):
   * a sinking platform's countdown is its telegraph's fill.
   */
  update(dt: number, _time: number, flood: boolean): void {
    this.downT = this.up ? 0 : this.downT + dt;
    this.sunk += ((this.up ? 0 : 1) - this.sunk) * Math.min(1, dt * 4);
    this.group.position.y = -0.9 * this.sunk;
    this.lit += ((flood ? 1 : 0) - this.lit) * Math.min(1, dt * 3);
    const sinking = this.sinking;
    this.ring.material.color.setHex(sinking ? SINKING : DRY);
    this.ring.material.opacity = !this.up ? 0 : sinking ? 0.75 : 0.12 + 0.23 * this.lit;
    this.crack.material.opacity = sinking ? 0.3 : 0;
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

/** High Tide: a sheet of sea over the court that rises (and drains when it dies), with ripples, and the whirlpool into the Deep. */
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
    // Drawn before every other see-through thing, so telegraphs show over the water wherever the camera is.
    this.sheet.renderOrder = -2;
    this.group.add(this.sheet);
    // Ripple rings drifting outward over the sheet.
    for (let i = 0; i < 6; i++) {
      const r = new THREE.Mesh(
        new THREE.RingGeometry(0.92, 1, 64).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0xbfeaff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }),
      );
      r.renderOrder = -1;
      this.shine.push(r);
      this.group.add(r);
    }
    // The whirlpool: rings spiralling in on the middle.
    for (let i = 0; i < 5; i++) {
      const r = new THREE.Mesh(
        new THREE.RingGeometry(0.8, 1, 48, 1, 0, Math.PI * 1.4).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0xe6f8ff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
      );
      r.renderOrder = -1;
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

// ------------------------------------------------------------------ the egg sacs

const EGG = 0xf08ab4;

/**
 * An egg sac of a Pig Ray clutch: a cluster of rose eggs on the court with HP of its own (hits on it don't touch the
 * boss's bar). It lands from a lob, the eggs swell as the hatch nears, and it bursts when it is broken or hatches.
 */
export class EggSac implements Hittable {
  readonly group = new THREE.Group();
  readonly pos = this.group.position;
  readonly radius = cfg.clutchRadius;
  readonly name = 'Pig Ray clutch';
  readonly armor = 0;
  readonly techResist = 0;
  readonly maxHp: number;
  hp: number;
  /** It has hatched (its Pig Rays are the boss's to send). */
  hatched = false;
  private landT: number;
  private flashT = 0;
  /** Seconds since it burst (broken or hatched): the burst plays, then it's gone. */
  private burstT = -1;
  private eggs: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>[] = [];

  /** `landIn`: seconds (its clock) until its lob lands. */
  constructor(hp: number, x: number, z: number, landIn: number) {
    this.maxHp = this.hp = Math.max(1, Math.round(hp));
    this.landT = landIn;
    this.pos.set(x, 0, z);
    // A slimy base, then four eggs heaped on it.
    part(this.group, new THREE.CylinderGeometry(0.95, 1.1, 0.12, 18), mat(0x8a4a6e, { rough: 0.3 }), [0, 0.06, 0]);
    const spots: [number, number, number, number][] = [[0, 0.5, 0, 0.5], [0.42, 0.34, 0.2, 0.36], [-0.36, 0.32, 0.28, 0.34], [0.05, 0.3, -0.42, 0.33]];
    for (const [ex, ey, ez, r] of spots) {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(r, 14, 10),
        new THREE.MeshStandardMaterial({ color: EGG, emissive: 0xff3c8c, emissiveIntensity: 0.35, roughness: 0.25, transparent: true, opacity: 0.9 }),
      );
      m.position.set(ex, ey, ez);
      m.castShadow = true;
      this.eggs.push(m);
      this.group.add(m);
    }
    this.group.visible = false;
  }

  get alive(): boolean {
    return this.hp > 0 && !this.hatched;
  }
  get landed(): boolean {
    return this.landT <= 0;
  }
  get aimHeight(): number {
    return 0.6;
  }
  get invulnerable(): boolean {
    return !this.alive || !this.landed;
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

  /** It hatches (the boss sends its Pig Rays). */
  hatch(): void {
    this.hatched = true;
  }

  /** The look (its clock): swelling as its hatch nears; false once it has burst and faded. */
  update(dt: number): boolean {
    this.landT -= dt;
    const k = Math.max(0, -this.landT) / cfg.clutchHatch;
    this.group.visible = this.landed;
    this.flashT = Math.max(0, this.flashT - dt);
    if (!this.alive && this.burstT < 0) this.burstT = 0;
    if (this.burstT >= 0) {
      this.burstT += dt;
      const b = Math.min(1, this.burstT / 0.4);
      this.group.scale.setScalar(1 + b * 0.5);
      for (const e of this.eggs) e.material.opacity = 0.9 * (1 - b);
      return b < 1;
    }
    // Swelling toward the hatch: bigger and brighter, no pulsing.
    const s = 0.8 + 0.35 * Math.min(1, k);
    this.group.scale.setScalar(s);
    for (const e of this.eggs) e.material.emissiveIntensity = this.flashT > 0 ? 1.4 : 0.3 + 0.6 * Math.min(1, k);
    return true;
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
  /** m/s (default `pigSpeed`). */
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
 * An Ul Ray: a teal ray that rises with High Tide, swims round the court and lunges at you along a warned lane.
 * Hittable with HP of its own (the boss's bar doesn't drop when it is hit); it sinks away into the Deep.
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

  /** Sink away (into the Deep, or the boss died). */
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

// ------------------------------------------------------------------ the surge

/** The surge's wall of water: a long foaming wave as wide as the court, rolling across it. */
export class SurgeWall {
  readonly group = new THREE.Group();

  constructor() {
    const width = 2 * cfg.arenaRadius + 6;
    // Across its heading (+Z), leaning forward as it breaks.
    // Lit materials, not glowing ones: under the court's bloom a white basic one blew out into a beam of light.
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(width, 2.2, 1.8),
      new THREE.MeshStandardMaterial({ color: 0x2f8fd0, emissive: 0x0a3a70, emissiveIntensity: 0.25, roughness: 0.2, transparent: true, opacity: 0.8, depthWrite: false }),
    );
    body.position.set(0, 0.9, -0.7);
    body.rotation.x = 0.3;
    const foam = new THREE.Mesh(
      new THREE.BoxGeometry(width, 0.35, 0.9),
      new THREE.MeshStandardMaterial({ color: 0xcfe8f5, roughness: 0.7, transparent: true, opacity: 0.85, depthWrite: false }),
    );
    foam.position.set(0, 2.05, -0.25);
    // The wake behind it: a low sheet of churned water.
    const wake = new THREE.Mesh(
      new THREE.PlaneGeometry(width, 5).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x8fd0f0, roughness: 0.4, transparent: true, opacity: 0.35, depthWrite: false }),
    );
    wake.position.set(0, 0.2, -3.6);
    this.group.add(body, foam, wake);
    this.group.visible = false;
  }

  /** Its front at (x, z) heading `yaw`; null hides it. */
  place(at: { x: number; z: number; yaw: number } | null, time: number): void {
    this.group.visible = !!at;
    if (!at) return;
    this.group.position.set(at.x, 0, at.z);
    this.group.rotation.y = at.yaw;
    this.group.scale.y = 1 + Math.sin(time * 6) * 0.05;
  }
}

// ------------------------------------------------------------------ the vents (meshes)

const BUBBLES = 22;

/** The Deep's vents: a glowing ring on the floor and a column of bubbles rising from each that flows or stirs. */
export class Vents {
  readonly group = new THREE.Group();
  readonly list: VentState[];
  private looks: { ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>; bubbles: THREE.InstancedMesh; seeds: number[]; k: number }[] = [];
  private tmp = new THREE.Object3D();

  constructor(cx: number, cz: number) {
    this.list = ventSpots(cx, cz).map(([x, z]) => ({ x, z, phase: 'off' as const, t: 0 }));
    const bubbleMat = new THREE.MeshBasicMaterial({ color: 0xdff6ff, transparent: true, opacity: 0.75, depthWrite: false });
    for (const v of this.list) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(cfg.ventRadius - 0.25, cfg.ventRadius, 40).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0x9ff0ff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }),
      );
      ring.position.set(v.x, 0.06, v.z);
      const bubbles = new THREE.InstancedMesh(new THREE.SphereGeometry(0.12, 8, 6), bubbleMat, BUBBLES);
      bubbles.frustumCulled = false;
      const seeds = Array.from({ length: BUBBLES }, (_, i) => (i * 0.6180339) % 1);
      this.looks.push({ ring, bubbles, seeds, k: 0 });
      this.group.add(ring, bubbles);
    }
    this.group.visible = false;
  }

  /** `on`: the Deep is under way (else every vent fades out). */
  update(dt: number, time: number, on: boolean): void {
    let any = false;
    this.list.forEach((v, i) => {
      const l = this.looks[i];
      const want = !on ? 0 : v.phase === 'flow' ? 1 : v.phase === 'stir' ? 0.3 : 0;
      l.k += (want - l.k) * Math.min(1, dt * 3);
      if (l.k > 0.01) any = true;
      l.ring.material.opacity = 0.75 * l.k;
      // Bubbles rising in a loose column, more of them the stronger it flows.
      const shown = Math.round(BUBBLES * l.k);
      for (let b = 0; b < BUBBLES; b++) {
        const s = l.seeds[b];
        const h = ((time * (0.5 + s * 0.4) + s) % 1) * 9;
        const a = s * 40 + time * (1 + s);
        const r = (0.3 + s * 0.9) * (cfg.ventRadius / 1.7);
        this.tmp.position.set(v.x + Math.sin(a) * r, 0.2 + h, v.z + Math.cos(a) * r);
        this.tmp.scale.setScalar(b < shown ? 0.6 + s * 0.9 : 0.0001);
        this.tmp.updateMatrix();
        l.bubbles.setMatrixAt(b, this.tmp.matrix);
      }
      l.bubbles.instanceMatrix.needsUpdate = true;
    });
    this.group.visible = any;
  }
}

// ------------------------------------------------------------------ the Deep

/** The colour of the Deep's water (the dome round the court, and the fog the world blends to). */
export const DEEP_COLOR = 0x0b3a66;

/**
 * The Deep: the court gone under the sea. A dome of deep water round it (hiding the sky and the islets), the surface
 * shimmering overhead, shafts of light slanting down, and motes drifting up. `k` fades it all in (0..1).
 */
export class DeepSea {
  readonly group = new THREE.Group();
  private dome: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  private surface: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  private shafts: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>[] = [];
  private motes: THREE.InstancedMesh;
  private moteSeeds: number[] = [];
  private tmp = new THREE.Object3D();

  constructor(cx: number, cz: number) {
    this.group.position.set(cx, 0, cz);
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(46, 32, 16),
      new THREE.MeshBasicMaterial({ color: DEEP_COLOR, side: THREE.BackSide, transparent: true, opacity: 0, depthWrite: false, fog: false }),
    );
    this.surface = new THREE.Mesh(
      new THREE.CircleGeometry(60, 48).rotateX(Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x6fd2ff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.surface.position.y = 12;
    this.group.add(this.dome, this.surface);
    for (let i = 0; i < 7; i++) {
      const s = new THREE.Mesh(
        new THREE.CylinderGeometry(0.8, 2.4, 13, 10, 1, true),
        new THREE.MeshBasicMaterial({ color: 0xbfeeff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
      );
      const a = (i / 7) * Math.PI * 2 + 0.4;
      const r = 4 + (i % 3) * 4.5;
      s.position.set(Math.sin(a) * r, 6, Math.cos(a) * r);
      s.rotation.z = 0.18;
      this.shafts.push(s);
      this.group.add(s);
    }
    this.motes = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.06, 6, 4),
      new THREE.MeshBasicMaterial({ color: 0xcff4ff, transparent: true, opacity: 0, depthWrite: false }),
      90,
    );
    this.motes.frustumCulled = false;
    for (let i = 0; i < 90; i++) this.moteSeeds.push((i * 0.7548776) % 1);
    this.group.add(this.motes);
    this.group.visible = false;
  }

  update(time: number, k: number): void {
    this.group.visible = k > 0.01;
    if (!this.group.visible) return;
    this.dome.material.opacity = Math.min(1, k * 1.2);
    this.surface.material.opacity = 0.35 * k;
    this.surface.rotation.y = time * 0.05;
    this.shafts.forEach((s, i) => {
      s.material.opacity = (0.05 + 0.03 * Math.sin(time * 0.7 + i * 1.7)) * k;
      s.rotation.y = Math.sin(time * 0.2 + i) * 0.3;
    });
    (this.motes.material as THREE.MeshBasicMaterial).opacity = 0.55 * k;
    this.moteSeeds.forEach((s, i) => {
      const a = s * 97;
      const r = Math.sqrt((s * 13.37) % 1) * (cfg.arenaRadius + 4);
      const h = ((time * (0.15 + s * 0.2) + s * 7) % 1) * 12;
      this.tmp.position.set(Math.sin(a) * r + Math.sin(time * 0.6 + i) * 0.3, h, Math.cos(a) * r);
      this.tmp.scale.setScalar(0.6 + s);
      this.tmp.updateMatrix();
      this.motes.setMatrixAt(i, this.tmp.matrix);
    });
    this.motes.instanceMatrix.needsUpdate = true;
  }
}

/** A wingbeat's current: streaks of bubbles running along its lane for a while (real seconds). */
export class CurrentStream implements Effect {
  readonly object = new THREE.Group();
  private t = 0;
  private streaks: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>[] = [];
  private seeds: number[] = [];

  constructor(x: number, z: number, yaw: number, private length: number, private width: number, private life: number) {
    this.object.position.set(x, 0, z);
    this.object.rotation.y = yaw;
    for (let i = 0; i < 16; i++) {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(0.12, 2.2),
        new THREE.MeshBasicMaterial({ color: 0xdff6ff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
      );
      m.rotation.x = -Math.PI / 2;
      this.streaks.push(m);
      this.seeds.push((i * 0.618) % 1);
      this.object.add(m);
    }
  }

  update(dt: number): boolean {
    this.t += dt;
    const fade = Math.min(1, this.t / 0.2) * Math.min(1, (this.life - this.t) / 0.3);
    this.streaks.forEach((m, i) => {
      const s = this.seeds[i];
      const along = ((this.t * (1.2 + s * 0.6) + s) % 1) * this.length;
      m.position.set((s - 0.5) * this.width * 0.9, 0.4 + s * 1.6, along);
      m.material.opacity = 0.5 * Math.max(0, fade);
    });
    return this.t < this.life;
  }
}
