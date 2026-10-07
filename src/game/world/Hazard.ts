import * as THREE from 'three';
import { hazards as cfg } from '../config';
import type { Enemy } from '../enemies/Enemy';
import type { Player } from '../Player';
import { glowDecal, glowSprite } from './glow';

// Cave hazards. Lava vents erupt on a fixed rhythm with a visible countdown and
// burn anything standing in them (enemies too, so they can be baited). Poison
// pools (marsh water, De Rol Le's spray) poison and slow whoever wades in.

export interface HazardHooks {
  hurtPlayer(damage: number, fromX: number, fromZ: number, knockback?: number, source?: string): void;
  poisonPlayer(seconds: number): void;
  /** Add Burn stacks (Mines). */
  burnPlayer(stacks: number): void;
  hurtEnemy(enemy: Enemy, damage: number): void;
}

export class LavaVent {
  readonly group = new THREE.Group();
  private t: number;
  private poolMat: THREE.MeshBasicMaterial;
  private ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private fill: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  private pillar: THREE.Group;
  private pillarMat: THREE.MeshBasicMaterial;
  private light: THREE.PointLight;
  private halo: THREE.Sprite;
  private struck = new Set<object>();
  private wasErupting = false;
  /** Wired to a power switch that is off: the vent idles. */
  on = true;
  readonly power: string | null = null;

  private base: THREE.Color;
  private hot: THREE.Color;

  /** `color`: the molten glow (area look). */
  constructor(readonly x: number, readonly z: number, phase = 0, color = 0xff6a20) {
    this.t = phase;
    this.group.position.set(x, 0, z);
    const r = cfg.ventRadius;
    this.base = new THREE.Color(color);
    this.hot = this.base.clone().lerp(new THREE.Color(0xffffff), 0.45);
    const c = (k: number) => this.base.clone().lerp(new THREE.Color(0xffffff), k).getHex();
    this.poolMat = new THREE.MeshBasicMaterial({ color });
    const pool = new THREE.Mesh(new THREE.CircleGeometry(r * 0.45, 12).rotateX(-Math.PI / 2), this.poolMat);
    pool.position.y = 0.04;
    const crust = new THREE.Mesh(
      new THREE.TorusGeometry(r * 0.55, 0.28, 5, 12).rotateX(Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x241a14, roughness: 1, flatShading: true }),
    );
    crust.scale.y = 0.5;
    crust.receiveShadow = true;
    // Countdown: an outline of the danger zone, and a fill that grows until it blows.
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(r - 0.12, r, 36).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.25, depthWrite: false }),
    );
    this.ring.position.y = 0.05;
    this.fill = new THREE.Mesh(
      new THREE.CircleGeometry(r, 36).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false }),
    );
    this.fill.position.y = 0.045;
    const decal = glowDecal(color, r * 3.2, 0.45);
    this.pillarMat = new THREE.MeshBasicMaterial({ color: c(0.3), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    this.pillar = new THREE.Group();
    const core = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.9, 7, 9, 1, true), this.pillarMat);
    core.position.y = 3.5;
    const inner = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.25, r * 0.5, 8, 7, 1, true), this.pillarMat);
    inner.position.y = 4;
    this.pillar.add(core, inner);
    this.pillar.visible = false;
    this.halo = glowSprite(c(0.1), r * 5, 0);
    this.halo.position.y = 2;
    this.light = new THREE.PointLight(color, 8, 12, 2);
    this.light.position.y = 1.2;
    this.group.add(decal, pool, crust, this.ring, this.fill, this.pillar, this.halo, this.light);
  }

  /** Seconds into the current cycle, and the phase it is in. */
  private phase(): { c: number; warn: boolean; erupt: boolean } {
    const c = ((this.t % cfg.ventPeriod) + cfg.ventPeriod) % cfg.ventPeriod;
    const eruptAt = cfg.ventPeriod - cfg.ventEruption;
    const warnAt = eruptAt - cfg.ventWarning;
    return { c, warn: c >= warnAt && c < eruptAt, erupt: c >= eruptAt };
  }

  get erupting(): boolean {
    return this.on && this.phase().erupt;
  }

  /** Bubbling before an eruption. */
  get warning(): boolean {
    return this.on && this.phase().warn;
  }

  /** Is (x, z) with radius r inside the blast? */
  contains(x: number, z: number, r: number): boolean {
    return Math.hypot(x - this.x, z - this.z) <= cfg.ventRadius + r * 0.5;
  }

  update(dt: number, player: Player, enemies: readonly Enemy[], hooks: HazardHooks): void {
    this.t += dt;
    let { c, warn, erupt } = this.phase();
    if (!this.on) {
      warn = false;
      erupt = false;
    }
    const eruptAt = cfg.ventPeriod - cfg.ventEruption;
    const warnAt = eruptAt - cfg.ventWarning;
    const flicker = Math.sin(this.t * 13) * 0.5 + 0.5;

    if (warn) {
      const k = (c - warnAt) / cfg.ventWarning;
      this.fill.scale.setScalar(Math.max(0.01, k));
      this.fill.material.opacity = 0.25 + 0.25 * k;
      this.ring.material.opacity = 0.45 + 0.4 * flicker * k;
      this.poolMat.color.copy(k > 0.6 && flicker > 0.5 ? this.hot : this.base);
      this.light.intensity = 10 + 30 * k;
    } else if (!erupt) {
      this.fill.material.opacity = 0;
      this.ring.material.opacity = 0.18;
      this.poolMat.color.copy(this.base);
      this.light.intensity = 7 + 2 * flicker;
    }

    this.pillar.visible = erupt;
    if (erupt) {
      const k = (c - eruptAt) / cfg.ventEruption;
      this.pillarMat.opacity = 0.85 * (1 - k * k);
      this.pillar.scale.set(1 + Math.sin(this.t * 30) * 0.06, 0.6 + 0.4 * Math.min(1, k * 6), 1 + Math.cos(this.t * 27) * 0.06);
      this.halo.material.opacity = 0.9 * (1 - k);
      this.fill.material.opacity = 0.5 * (1 - k);
      this.light.intensity = 60 * (1 - k) + 10;
      if (!this.wasErupting) this.struck.clear();
      // Anything standing in the column gets burned once per eruption.
      if (player.alive && !this.struck.has(player) && this.contains(player.pos.x, player.pos.z, player.radius)) {
        this.struck.add(player);
        hooks.hurtPlayer(cfg.ventDamage, this.x, this.z, 9, 'Lava vent');
      }
      for (const e of enemies) {
        if (!e.alive || e.invulnerable || this.struck.has(e) || !this.contains(e.pos.x, e.pos.z, e.radius)) continue;
        this.struck.add(e);
        hooks.hurtEnemy(e, Math.max(1, Math.round(e.maxHp * cfg.ventEnemyPct)));
      }
    } else {
      this.halo.material.opacity = 0;
    }
    this.wasErupting = erupt;
  }
}

/**
 * A pool that slows and afflicts whoever wades in: poison marsh water (permanent),
 * a poison puddle with a lifetime, or molten slag (the Mines: it keeps adding Burn).
 */
export class PoisonPool {
  readonly group = new THREE.Group();
  done = false;
  private t = 0;
  /** Slag: seconds toward the next Burn stack while standing in it. */
  private burnAcc = 0;
  private mat: THREE.MeshBasicMaterial;
  private bubbles: THREE.Mesh[] = [];
  private glow: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;

  constructor(
    readonly x: number,
    readonly z: number,
    readonly rx: number,
    readonly rz: number,
    /** Seconds until it dries up (Infinity = marsh). */
    readonly life = Infinity,
    readonly slows = true,
    seed = Math.random(),
    /** Water colour (area look; poison green by default). */
    color = 0x4aa830,
    readonly effect: 'poison' | 'burn' = 'poison',
  ) {
    this.group.position.set(x, 0, z);
    const water = new THREE.Color(color);
    this.mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.62, depthWrite: false });
    const surface = new THREE.Mesh(new THREE.CircleGeometry(1, 28).rotateX(-Math.PI / 2), this.mat);
    surface.scale.set(rx, 1, rz);
    surface.position.y = 0.03;
    const rim = new THREE.Mesh(
      new THREE.RingGeometry(0.92, 1.05, 28).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: water.clone().multiplyScalar(0.35).getHex(), transparent: true, opacity: 0.7, depthWrite: false }),
    );
    rim.scale.set(rx, 1, rz);
    rim.position.y = 0.035;
    this.glow = glowDecal(water.clone().lerp(new THREE.Color(0xffffff), 0.25).getHex(), 2, 0.35);
    this.glow.scale.set(rx * 1.3, 1, rz * 1.3);
    this.group.add(this.glow, surface, rim);
    const bubbleMat = new THREE.MeshBasicMaterial({ color: water.clone().lerp(new THREE.Color(0xffffff), 0.5).getHex(), transparent: true, opacity: 0.8 });
    const n = Math.max(3, Math.round(rx * rz * 1.2));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + seed * 6;
      const d = 0.2 + ((i * 0.37 + seed) % 1) * 0.65;
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.09 + (i % 3) * 0.04, 6, 4), bubbleMat);
      b.position.set(Math.sin(a) * d * rx, 0, Math.cos(a) * d * rz);
      b.userData.phase = i * 0.9 + seed * 10;
      this.bubbles.push(b);
      this.group.add(b);
    }
  }

  contains(x: number, z: number): boolean {
    const dx = (x - this.x) / this.rx;
    const dz = (z - this.z) / this.rz;
    return dx * dx + dz * dz <= 1;
  }

  /** Returns true while the player stands in it. */
  update(dt: number, player: Player, hooks: HazardHooks): boolean {
    this.t += dt;
    for (const b of this.bubbles) {
      const k = ((this.t * 0.8 + b.userData.phase) % 2) / 2;
      b.position.y = 0.04 + k * 0.12;
      b.scale.setScalar(k < 0.85 ? 0.4 + k : (1 - k) * 8);
    }
    let fade = 1;
    if (this.life !== Infinity) {
      fade = Math.min(1, (this.life - this.t) / 1.5, this.t / 0.3);
      if (this.t >= this.life) this.done = true;
    }
    this.mat.opacity = 0.62 * fade;
    this.glow.material.opacity = (0.3 + Math.sin(this.t * 2) * 0.06) * fade;
    if (this.done || !player.alive || !this.contains(player.pos.x, player.pos.z)) {
      this.burnAcc = Math.min(this.burnAcc, 0.5);
      return false;
    }
    if (this.effect === 'burn') {
      // The first step in burns at once, then a stack every 1 / slagBurnPerSec seconds.
      this.burnAcc += dt * cfg.slagBurnPerSec;
      if (this.burnAcc >= 0.5) {
        this.burnAcc -= 1;
        hooks.burnPlayer(1);
      }
    } else hooks.poisonPlayer(cfg.marshPoison);
    return true;
  }
}
