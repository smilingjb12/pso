import * as THREE from 'three';
import { sfx } from '../../audio';
import { machinery as cfg } from '../config';
import type { Enemy } from '../enemies/Enemy';

// Mines machinery. Every machine can be wired to a power switch (`power` is the
// circuit id): a switch stops or starts crushers, lasers and belts. Machinery
// hurts enemies too, so luring them in is part of the fight.

/** Who machinery can hit: the player (or a stand-in with her position). */
export interface Body {
  readonly pos: THREE.Vector3;
  readonly alive: boolean;
  readonly radius: number;
}

export interface MachineHooks {
  hurtPlayer(damage: number, fromX: number, fromZ: number, knockback: number, source: string): void;
  burnPlayer(stacks: number): void;
  hurtEnemy(enemy: Enemy, damage: number): void;
}

export interface Machine {
  readonly group: THREE.Object3D;
  /** Circuit id of the power switch it is wired to. */
  readonly power: string | null;
  /** The switch toggled: stop / start. */
  setFlipped(flipped: boolean): void;
  update(dt: number, player: Body, enemies: readonly Enemy[], hooks: MachineHooks): void;
}

const STEEL = 0x4a4f58;
const DARK = 0x2a2d33;

function std(color: number, rough = 0.55): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.35, flatShading: true });
}

/** Yellow / black hazard stripes for floor borders (DataTexture: no DOM needed). */
let stripeTex: THREE.DataTexture | null = null;
function stripeTexture(): THREE.DataTexture {
  if (stripeTex) return stripeTex;
  const n = 32;
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const on = ((x + y) % 16) < 8;
      data.set(on ? [224, 176, 32, 255] : [30, 30, 32, 255], (y * n + x) * 4);
    }
  stripeTex = new THREE.DataTexture(data, n, n);
  stripeTex.wrapS = stripeTex.wrapT = THREE.RepeatWrapping;
  stripeTex.needsUpdate = true;
  return stripeTex;
}

/** Chevrons for conveyor belts, pointing along +V. */
let chevronTex: THREE.DataTexture | null = null;
function chevronTexture(): THREE.DataTexture {
  if (chevronTex) return chevronTex;
  const n = 32;
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const v = (y + Math.abs(x - n / 2)) % 16;
      const on = v < 4;
      data.set(on ? [150, 150, 140, 255] : [44, 44, 46, 255], (y * n + x) * 4);
    }
  chevronTex = new THREE.DataTexture(data, n, n);
  chevronTex.wrapS = chevronTex.wrapT = THREE.RepeatWrapping;
  chevronTex.needsUpdate = true;
  return chevronTex;
}

/** Distance from a point to a segment (XZ). */
function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const vx = bx - ax;
  const vz = bz - az;
  const len2 = vx * vx + vz * vz || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / len2));
  return Math.hypot(px - (ax + vx * t), pz - (az + vz * t));
}

// ----------------------------------------------------------------- crusher

/** A hydraulic press over a square of floor: warns, slams, rises. Off = held up. */
export class Crusher implements Machine {
  readonly group = new THREE.Group();
  private t: number;
  private on = true;
  private head: THREE.Group;
  private fill: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private lamp: THREE.MeshBasicMaterial;
  private struck = false;
  private size = cfg.crusherSize;

  constructor(readonly x: number, readonly z: number, phase: number, readonly power: string | null) {
    this.t = phase;
    this.group.position.set(x, 0, z);
    const s = this.size;
    // Floor plate with a striped border.
    const border = new THREE.Mesh(
      new THREE.PlaneGeometry(s + 0.6, s + 0.6).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: stripeTexture(), roughness: 0.8 }),
    );
    border.material.map!.repeat.set(2, 2);
    border.position.y = 0.012;
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(s, s).rotateX(-Math.PI / 2), std(0x3a3d44, 0.7));
    plate.position.y = 0.016;
    plate.receiveShadow = true;
    this.fill = new THREE.Mesh(
      new THREE.PlaneGeometry(s, s).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xff3020, transparent: true, opacity: 0, depthWrite: false }),
    );
    this.fill.position.y = 0.03;
    this.group.add(border, plate, this.fill);
    // Four guide pillars and a top frame.
    const pillar = std(STEEL);
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.3, 5, 0.3), pillar);
      p.position.set(dx * (s / 2 + 0.15), 2.5, dz * (s / 2 + 0.15));
      p.castShadow = true;
      this.group.add(p);
    }
    const frame = new THREE.Mesh(new THREE.BoxGeometry(s + 0.6, 0.35, s + 0.6), std(DARK));
    frame.position.y = 5.1;
    this.group.add(frame);
    // The press head.
    this.head = new THREE.Group();
    const block = new THREE.Mesh(new THREE.BoxGeometry(s - 0.1, 0.9, s - 0.1), std(0x5c6068));
    block.position.y = 0.45;
    block.castShadow = true;
    const band = new THREE.Mesh(new THREE.BoxGeometry(s, 0.18, s), new THREE.MeshStandardMaterial({ map: stripeTexture(), roughness: 0.7 }));
    band.position.y = 0.12;
    const ram = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 4, 8), std(0x8a8e96, 0.3));
    ram.position.y = 2.9;
    this.head.add(block, band, ram);
    this.group.add(this.head);
    this.lamp = new THREE.MeshBasicMaterial({ color: 0xff4020 });
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), this.lamp);
    lamp.position.set(s / 2 + 0.15, 5.4, s / 2 + 0.15);
    this.group.add(lamp);
    this.pose(0);
  }

  setFlipped(flipped: boolean): void {
    this.on = !flipped;
  }

  contains(x: number, z: number, r: number): boolean {
    const h = this.size / 2 + r * 0.6;
    return Math.abs(x - this.x) <= h && Math.abs(z - this.z) <= h;
  }

  /** Head height above the floor (0 = slammed shut). */
  private pose(drop: number): void {
    this.head.position.y = 3.6 * (1 - drop);
  }

  update(dt: number, player: Body, enemies: readonly Enemy[], hooks: MachineHooks): void {
    if (!this.on) {
      // Held up and parked.
      this.head.position.y += (3.6 - this.head.position.y) * Math.min(1, dt * 3);
      this.fill.material.opacity = 0;
      this.lamp.color.setHex(0x40ff70);
      return;
    }
    this.t += dt;
    const P = cfg.crusherPeriod;
    const c = ((this.t % P) + P) % P;
    const slamAt = P - 1.4;
    const warnAt = slamAt - cfg.crusherWarning;
    const prev = c - dt;
    if (c >= warnAt && c < slamAt) {
      const k = (c - warnAt) / cfg.crusherWarning;
      this.fill.material.opacity = 0.15 + 0.35 * k;
      this.fill.scale.setScalar(Math.max(0.05, k));
      this.lamp.color.setHex(Math.sin(this.t * 24) > 0 ? 0xff3020 : 0x401008);
      this.pose(0);
      this.head.position.y = 3.6 + Math.sin(this.t * 60) * 0.04 * k;
      if (prev < warnAt) sfx('crusher.warn', { x: this.x, z: this.z });
      this.struck = false;
    } else if (c >= slamAt && c < slamAt + 0.15) {
      this.fill.material.opacity = 0.6;
      this.fill.scale.setScalar(1);
      this.pose(Math.min(1, (c - slamAt) / 0.12));
      if (!this.struck && c - slamAt >= 0.1) {
        this.struck = true;
        sfx('crusher.slam', { x: this.x, z: this.z });
        if (player.alive && this.contains(player.pos.x, player.pos.z, player.radius)) {
          hooks.hurtPlayer(cfg.crusherDamage, this.x, this.z, 12, 'Crusher');
        }
        for (const e of enemies) {
          if (e.alive && !e.invulnerable && this.contains(e.pos.x, e.pos.z, e.radius)) hooks.hurtEnemy(e, Math.max(1, Math.round(e.maxHp * cfg.crusherEnemyPct)));
        }
      }
    } else if (c >= slamAt + 0.15 && c < slamAt + 0.6) {
      this.pose(1);
      this.fill.material.opacity = Math.max(0, 0.6 - (c - slamAt) * 1.2);
    } else {
      // Rising back up, then waiting.
      const k = c >= slamAt + 0.6 ? Math.min(1, (c - slamAt - 0.6) / 0.8) : 1;
      this.pose(1 - k);
      this.fill.material.opacity = 0;
      this.lamp.color.setHex(0xffa020);
    }
  }
}

// ------------------------------------------------------------- laser fence

/** A fence of laser bars between two posts. Cycles on and off; it burns. */
export class LaserFence implements Machine {
  readonly group = new THREE.Group();
  private t: number;
  private on = true;
  private beams: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>[] = [];
  private ground: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private struck = new Set<object>();
  private wasLive = false;
  private len: number;

  constructor(readonly ax: number, readonly az: number, readonly bx: number, readonly bz: number, phase: number, readonly power: string | null) {
    this.t = phase;
    this.len = Math.hypot(bx - ax, bz - az);
    const mx = (ax + bx) / 2;
    const mz = (az + bz) / 2;
    const yaw = Math.atan2(bx - ax, bz - az);
    const post = std(STEEL);
    const cap = new THREE.MeshBasicMaterial({ color: 0xff4040 });
    for (const [x, z] of [[ax, az], [bx, bz]]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.35, 2.1, 0.35), post);
      p.position.set(x, 1.05, z);
      p.castShadow = true;
      const c = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.12, 0.4), cap);
      c.position.set(x, 2.15, z);
      this.group.add(p, c);
    }
    const holder = new THREE.Group();
    holder.position.set(mx, 0, mz);
    holder.rotation.y = yaw;
    this.group.add(holder);
    for (const y of [0.45, 1.0, 1.55]) {
      const b = new THREE.Mesh(
        new THREE.BoxGeometry(0.07, 0.07, this.len),
        new THREE.MeshBasicMaterial({ color: 0xff3a30, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }),
      );
      b.position.y = y;
      holder.add(b);
      this.beams.push(b);
    }
    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(0.9, this.len).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xff3020, transparent: true, opacity: 0.2, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.ground.position.y = 0.03;
    holder.add(this.ground);
  }

  setFlipped(flipped: boolean): void {
    this.on = !flipped;
  }

  /** Is the fence firing right now? */
  get live(): boolean {
    if (!this.on) return false;
    const P = cfg.laserOn + cfg.laserOff;
    const c = ((this.t % P) + P) % P;
    return c < cfg.laserOn;
  }

  touches(x: number, z: number, r: number): boolean {
    return segDist(x, z, this.ax, this.az, this.bx, this.bz) <= r + 0.15;
  }

  update(dt: number, player: Body, enemies: readonly Enemy[], hooks: MachineHooks): void {
    this.t += dt;
    const P = cfg.laserOn + cfg.laserOff;
    const c = ((this.t % P) + P) % P;
    const live = this.live;
    const warn = this.on && !live && c >= P - cfg.laserWarning;
    if (live && !this.wasLive) {
      this.struck.clear();
      sfx('laser.on', { x: (this.ax + this.bx) / 2, z: (this.az + this.bz) / 2 });
    }
    this.wasLive = live;
    for (const b of this.beams) {
      b.visible = live || (warn && Math.sin(this.t * 40) > 0);
      b.material.opacity = live ? 0.85 + Math.sin(this.t * 30) * 0.1 : 0.35;
      b.scale.set(live ? 1 : 0.4, live ? 1 : 0.4, 1);
    }
    this.ground.material.opacity = live ? 0.35 : warn ? 0.18 : 0.04;
    if (!live) return;
    if (player.alive && !this.struck.has(player) && this.touches(player.pos.x, player.pos.z, player.radius)) {
      this.struck.add(player);
      // Shoved straight off the fence.
      const vx = this.bx - this.ax;
      const vz = this.bz - this.az;
      const k = Math.max(0, Math.min(1, ((player.pos.x - this.ax) * vx + (player.pos.z - this.az) * vz) / (vx * vx + vz * vz || 1)));
      hooks.hurtPlayer(cfg.laserDamage, this.ax + vx * k, this.az + vz * k, 5, 'Laser fence');
      hooks.burnPlayer(cfg.laserBurn);
    }
    for (const e of enemies) {
      if (!e.alive || e.invulnerable || this.struck.has(e) || !this.touches(e.pos.x, e.pos.z, e.radius)) continue;
      this.struck.add(e);
      hooks.hurtEnemy(e, Math.max(1, Math.round(e.maxHp * cfg.laserEnemyPct)));
    }
  }
}

// ---------------------------------------------------------------- conveyor

/** A belt that carries anyone standing on it. Off = stopped. */
export class Conveyor implements Machine {
  readonly group = new THREE.Group();
  private on = true;
  private tex: THREE.Texture;
  private dx: number;
  private dz: number;

  constructor(
    readonly minX: number, readonly minZ: number, readonly maxX: number, readonly maxZ: number,
    dir: 'n' | 's' | 'e' | 'w', readonly power: string | null,
  ) {
    [this.dx, this.dz] = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] }[dir];
    const w = maxX - minX;
    const h = maxZ - minZ;
    const along = this.dx !== 0 ? w : h;
    const across = this.dx !== 0 ? h : w;
    this.tex = chevronTexture().clone();
    this.tex.needsUpdate = true;
    this.tex.repeat.set(across / 2, along / 2);
    const belt = new THREE.Mesh(new THREE.PlaneGeometry(across, along).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: this.tex, roughness: 0.9 }));
    belt.receiveShadow = true;
    // Plane +V runs toward -Z after the rotation; turn it so the chevrons point along the belt.
    belt.rotation.y = Math.atan2(this.dx, this.dz) + Math.PI;
    belt.position.set((minX + maxX) / 2, 0.02, (minZ + maxZ) / 2);
    this.group.add(belt);
    const rail = std(STEEL);
    for (const s of [-1, 1]) {
      const r = new THREE.Mesh(new THREE.BoxGeometry(this.dx !== 0 ? w : 0.14, 0.14, this.dx !== 0 ? 0.14 : h), rail);
      r.position.set((minX + maxX) / 2 + (this.dx !== 0 ? 0 : (s * w) / 2), 0.07, (minZ + maxZ) / 2 + (this.dx !== 0 ? (s * h) / 2 : 0));
      this.group.add(r);
    }
  }

  setFlipped(flipped: boolean): void {
    this.on = !flipped;
  }

  contains(x: number, z: number): boolean {
    return x >= this.minX && x <= this.maxX && z >= this.minZ && z <= this.maxZ;
  }

  update(dt: number, player: Body, enemies: readonly Enemy[]): void {
    if (!this.on) return;
    this.tex.offset.y -= (dt * cfg.conveyorSpeed) / 2;
    const step = cfg.conveyorSpeed * dt;
    if (player.alive && this.contains(player.pos.x, player.pos.z)) {
      player.pos.x += this.dx * step;
      player.pos.z += this.dz * step;
    }
    for (const e of enemies) {
      if (!e.alive || e.rooted || !this.contains(e.pos.x, e.pos.z)) continue;
      e.pos.x += this.dx * step;
      e.pos.z += this.dz * step;
    }
  }
}
