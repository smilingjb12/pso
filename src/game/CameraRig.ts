import * as THREE from 'three';
import { camera as cfg, lockOn } from './config';
import { angleDelta } from './collision';

// Third-person orbit camera. Mouse orbits freely; while locked on, the yaw is
// pulled toward framing the target from behind the player.

export class CameraRig {
  yaw = 0; // camera looks along +Z, i.e. behind a player facing +Z
  pitch = 0.35;
  private focus = new THREE.Vector3();
  private shakeT = 0;
  private shakeMag = 0;
  private tmp = new THREE.Vector3();
  private placed = false;

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    /** Returns how far along the ray the camera can go before hitting a wall. */
    public blocker: (from: THREE.Vector3, dir: THREE.Vector3, max: number) => number,
  ) {}

  /** Forward on XZ (where W moves). */
  forward(out: THREE.Vector3): THREE.Vector3 {
    return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  right(out: THREE.Vector3): THREE.Vector3 {
    return out.set(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
  }

  snapBehind(playerYaw: number): void {
    this.yaw = playerYaw;
  }

  /** Jump straight to the target (area change) instead of lerping. */
  teleport(): void {
    this.placed = false;
  }

  shake(mag: number): void {
    this.shakeMag = Math.max(this.shakeMag, mag);
    this.shakeT = 0.2;
  }

  orbit(dx: number, dy: number): void {
    this.yaw -= dx * cfg.sensitivity;
    this.pitch = THREE.MathUtils.clamp(this.pitch + dy * cfg.sensitivity, cfg.minPitch, cfg.maxPitch);
  }

  /** realDt: unscaled time so the camera keeps moving during hitstop. */
  update(realDt: number, target: THREE.Vector3, lockYaw: number | null): void {
    if (lockYaw !== null) {
      this.yaw += angleDelta(this.yaw, lockYaw) * Math.min(1, lockOn.cameraFollow * realDt);
    }

    const goal = this.tmp.set(target.x, target.y + cfg.height, target.z);
    this.focus.lerp(goal, Math.min(1, cfg.followLerp * realDt));
    if (!this.placed || this.focus.distanceToSquared(goal) > 100) this.focus.copy(goal);
    this.placed = true;

    const cp = Math.cos(this.pitch);
    const dir = new THREE.Vector3(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);

    // Pull in if a wall is between the focus point and the camera.
    const hit = this.blocker(this.focus, dir, cfg.distance);
    const dist = hit < cfg.distance ? Math.max(1.2, hit - 0.4) : cfg.distance;

    this.camera.position.copy(this.focus).addScaledVector(dir, dist);

    if (this.shakeT > 0) {
      this.shakeT -= realDt;
      const m = this.shakeMag * (this.shakeT / 0.2);
      this.camera.position.x += (Math.random() - 0.5) * 2 * m;
      this.camera.position.y += (Math.random() - 0.5) * 2 * m;
      if (this.shakeT <= 0) this.shakeMag = 0;
    }
    this.camera.lookAt(this.focus);
  }
}
