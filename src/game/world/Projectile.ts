import * as THREE from 'three';
import type { Hittable } from '../combat/types';

// Simple straight-line (optionally homing) projectiles. Behaviour on contact is
// supplied by whoever fires it, so this module knows nothing about damage.

export interface ProjectileSpec {
  from: THREE.Vector3;
  dir: THREE.Vector3; // normalized XZ
  speed: number;
  range: number;
  radius: number;
  color: number;
  size: number;
  /** 'disc' is a flat spinning blade (slicers). Default 'orb'. */
  look?: 'orb' | 'disc';
  /** Seconds before it launches (bursts). Position is taken from `origin()` at launch. */
  delay?: number;
  origin?: () => THREE.Vector3;
  homing?: Hittable | null;
  homingRate?: number;
  /** Player projectile: called on touching a hittable. Return true to consume. */
  onHit?: (target: Hittable) => boolean;
  /** Enemy projectile: called when touching the player. Return true to consume. */
  onHitPlayer?: () => boolean;
  /** Called when the projectile expires or hits a wall. */
  onExpire?: (pos: THREE.Vector3) => void;
}

export class Projectile {
  readonly mesh: THREE.Mesh;
  readonly pos: THREE.Vector3;
  traveled = 0;
  dead = false;
  delay: number;
  private dir: THREE.Vector3;
  private hitIds = new Set<Hittable>();

  constructor(readonly spec: ProjectileSpec) {
    this.mesh = new THREE.Mesh(
      spec.look === 'disc'
        ? new THREE.CylinderGeometry(spec.size, spec.size, spec.size * 0.2, 5)
        : new THREE.SphereGeometry(spec.size, 8, 6),
      new THREE.MeshBasicMaterial({ color: spec.color }),
    );
    this.pos = this.mesh.position;
    this.pos.copy(spec.from);
    this.dir = spec.dir.clone();
    this.delay = spec.delay ?? 0;
    this.mesh.visible = this.delay <= 0;
  }

  update(
    dt: number,
    targets: readonly Hittable[],
    playerPos: THREE.Vector3,
    playerRadius: number,
    isSolid: (x: number, z: number) => boolean,
  ): void {
    if (this.dead) return;
    if (this.delay > 0) {
      this.delay -= dt;
      if (this.delay > 0) return;
      if (this.spec.origin) this.pos.copy(this.spec.origin());
      this.mesh.visible = true;
    }
    const s = this.spec;
    if (s.homing && s.homing.alive) {
      const want = new THREE.Vector3(s.homing.pos.x - this.pos.x, 0, s.homing.pos.z - this.pos.z).normalize();
      this.dir.lerp(want, Math.min(1, (s.homingRate ?? 6) * dt)).normalize();
    }
    if (s.look === 'disc') this.mesh.rotation.y += dt * 20;
    const step = s.speed * dt;
    this.pos.addScaledVector(this.dir, step);
    this.traveled += step;

    if (s.onHit) {
      for (const t of targets) {
        if (!t.alive || this.hitIds.has(t)) continue;
        const d = Math.hypot(t.pos.x - this.pos.x, t.pos.z - this.pos.z);
        if (d <= t.radius + s.radius) {
          this.hitIds.add(t);
          if (s.onHit(t)) {
            this.kill();
            return;
          }
        }
      }
    }
    if (s.onHitPlayer) {
      const d = Math.hypot(playerPos.x - this.pos.x, playerPos.z - this.pos.z);
      if (d <= playerRadius + s.radius && s.onHitPlayer()) {
        this.kill();
        return;
      }
    }
    if (this.traveled >= s.range || isSolid(this.pos.x, this.pos.z)) this.kill();
  }

  private kill(): void {
    this.dead = true;
    this.spec.onExpire?.(this.pos);
  }
}
