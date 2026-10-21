import * as THREE from 'three';
import { galGryphon as cfg } from '../config';
import { mat, part } from '../models/Rig';
import { glowDecal, glowSprite } from '../world/glow';
import type { TreeCollider } from '../world/Level';

// Gal Gryphon's storm (see GalGryphon and DESIGN.md "Gal Gryphon"): the six lightning rods round Storm Peak, which rod
// a bolt bends into, when the bolts fall, and the ring that marks the next bolt on you. A rod that filled is scorched
// for the storm after; a part-filled one keeps its charge. Pure rules first, so they can be tested without the boss.

/** A rod's spot and state. `firedIn`: the storm it last discharged in (it sits out the next one). */
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

/** Boss seconds from the call to the first bolt: `lead`, but never under `floor` real seconds at a rift's tempo. */
export function stormLead(tempo: number, lead = cfg.stormLead, floor = cfg.stormLeadFloor): number {
  return Math.max(lead, floor * tempo);
}

/** A storm's bolts, in boss seconds from the call: when each is marked on you and when it falls. */
export function boltSchedule(n: number, lead: number, warn = cfg.boltWarn, gap = cfg.boltGap): { mark: number; fall: number }[] {
  return Array.from({ length: n }, (_, i) => ({ mark: lead - warn + i * gap, fall: lead + i * gap }));
}

// ------------------------------------------------------------------ the rods

const STEEL = 0x50586a;
/** A rod this near you (m) fades to ROD_FADE so it doesn't fill the screen (the camera trails you). */
const ROD_FADE_REACH = 4.5;
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
    this.group.add(this.ring, this.fill);
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

  /** A bolt bent into it. */
  struck(): void {
    this.charge = Math.min(cfg.rodCharge, this.charge + 1);
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

  /** `storm`: the storm on (or the next one, between storms) and whether it is on. */
  update(dt: number, time: number, storm: number, on: boolean): void {
    this.flash = Math.max(0, this.flash - dt * 3);
    const usable = rodUsable(this, storm);
    const pulse = 0.5 + 0.5 * Math.sin(time * 6 + this.x);
    this.coils.forEach((m, i) => {
      m.emissive.setHex(usable ? LIT : SCORCHED);
      m.emissiveIntensity = i < this.charge ? 1.6 + pulse * 0.6 : 0.05 + this.flash;
    });
    this.bulb.emissive.setHex(usable ? LIT : SCORCHED);
    this.bulb.emissiveIntensity = (usable ? 0.2 + (this.charge / cfg.rodCharge) * 1.2 : 0.1) + (on && usable ? 0.6 * pulse : 0) + this.flash * 2;
    this.halo.material.opacity = Math.min(1, (on && usable ? 0.35 + 0.25 * pulse : 0) + (this.charge / cfg.rodCharge) * 0.4 + this.flash);
    this.ring.material.color.setHex(usable ? LIT : SCORCHED);
    this.ring.material.opacity = usable ? (on ? 0.55 + 0.3 * pulse : 0.14) : on ? 0.25 : 0.08;
    this.fill.material.color.setHex(usable ? LIT : SCORCHED);
    this.fill.material.opacity = on ? (usable ? 0.1 + 0.05 * pulse : 0.04) : 0;
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

  update(dt: number, time: number, storm: number, on: boolean): void {
    for (const r of this.list) r.update(dt, time, storm, on);
  }

  seeThrough(dt: number, px: number, pz: number): void {
    for (const r of this.list) r.seeThrough(dt, px, pz);
  }
}

/** The ring that marks the next bolt on you: it follows you and fills as the bolt comes (cyan; amber when it will strike you). */
export class BoltMark {
  readonly group = new THREE.Group();
  private ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private disc: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;

  constructor() {
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(cfg.boltMark - 0.14, cfg.boltMark, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: LIT, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.disc = new THREE.Mesh(
      new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: LIT, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.ring.position.y = 0.07;
    this.disc.position.y = 0.065;
    this.group.add(this.ring, this.disc);
    this.group.visible = false;
  }

  /** `k`: 0..1 of its warning; `safe`: you stand in a usable reach (it will bend into the rod). */
  show(x: number, z: number, k: number, safe: boolean, time: number): void {
    this.group.visible = true;
    this.group.position.set(x, 0, z);
    const col = safe ? LIT : 0xffc040;
    this.ring.material.color.setHex(col);
    this.disc.material.color.setHex(col);
    this.ring.material.opacity = 0.65 + 0.3 * Math.sin(time * 20);
    this.disc.scale.setScalar(Math.max(0.01, cfg.boltMark * k));
  }

  hide(): void {
    this.group.visible = false;
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
