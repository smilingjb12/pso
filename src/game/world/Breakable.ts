import * as THREE from 'three';
import { glowSprite } from './glow';

const BAND_COLOR = 0x4ab8ff;

/** A supply box. Broken open with the interact key; attacks pass it by. */
export class Breakable {
  readonly group = new THREE.Group();
  readonly pos = this.group.position;
  readonly radius = 0.55;
  brokenT = -1;
  private t = Math.random() * 10;
  private bandMat: THREE.MeshStandardMaterial;
  private bandGlow: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>;
  private halo: THREE.Sprite;

  constructor(readonly id: string, x: number, z: number) {
    this.pos.set(x, 0, z);
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 0.9, 0.9),
      new THREE.MeshStandardMaterial({ color: 0x8a7a4a, roughness: 0.8 }),
    );
    box.position.y = 0.45;
    box.castShadow = true;
    // Glowing stripe: bright emissive band, an additive shell around it and a faint halo.
    this.bandMat = new THREE.MeshStandardMaterial({ color: 0x4a90c8, emissive: BAND_COLOR, emissiveIntensity: 0.8 });
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.12, 0.95), this.bandMat);
    band.position.y = 0.45;
    this.bandGlow = new THREE.Mesh(
      new THREE.BoxGeometry(1.02, 0.22, 1.02),
      new THREE.MeshBasicMaterial({ color: BAND_COLOR, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.bandGlow.position.y = 0.45;
    this.halo = glowSprite(BAND_COLOR, 1.9, 0.25);
    this.halo.position.y = 0.45;
    this.group.add(box, band, this.bandGlow, this.halo);
  }

  get alive(): boolean {
    return this.brokenT < 0;
  }

  /** Break it open (plays the squash-out). Returns false if it was already broken. */
  smash(): boolean {
    if (!this.alive) return false;
    this.brokenT = 0;
    return true;
  }

  update(dt: number): void {
    if (this.brokenT < 0) {
      this.t += dt;
      const pulse = 0.5 + 0.5 * Math.sin(this.t * 2.5);
      this.bandMat.emissiveIntensity = 0.6 + 0.6 * pulse;
      this.bandGlow.material.opacity = 0.18 + 0.2 * pulse;
      this.halo.material.opacity = 0.15 + 0.15 * pulse;
      return;
    }
    this.halo.visible = this.bandGlow.visible = false;
    this.brokenT += dt;
    const k = Math.min(1, this.brokenT / 0.3);
    this.group.scale.set(1 + k * 0.4, Math.max(0.01, 1 - k), 1 + k * 0.4);
  }
}
