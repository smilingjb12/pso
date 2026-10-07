import * as THREE from 'three';
import { glowSprite } from './glow';

// Short-lived cosmetic effects (no gameplay): globs in flight, lightning, bursts.

export interface Effect {
  readonly object: THREE.Object3D;
  /** Advance; false once finished. */
  update(dt: number): boolean;
}

/** An arcing glob from a mouth to a landing spot, timed to land as its telegraph fires. */
export class Lob implements Effect {
  readonly object = new THREE.Group();
  private t = 0;
  private from: THREE.Vector3;
  private to: THREE.Vector3;
  private height: number;

  constructor(from: THREE.Vector3, toX: number, toZ: number, private duration: number, color: number, size = 0.28) {
    this.from = from.clone();
    this.to = new THREE.Vector3(toX, 0.2, toZ);
    this.height = 2 + this.from.distanceTo(this.to) * 0.25;
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(size, 0), new THREE.MeshBasicMaterial({ color }));
    this.object.add(core, glowSprite(color, size * 7, 0.8));
    this.object.position.copy(this.from);
  }

  update(dt: number): boolean {
    this.t += dt;
    const k = Math.min(1, this.t / this.duration);
    this.object.position.lerpVectors(this.from, this.to, k);
    this.object.position.y += this.height * 4 * k * (1 - k);
    this.object.rotation.x += dt * 6;
    return k < 1;
  }
}

/** A vertical flash (lightning, eruption) that fades out. */
export class Pillar implements Effect {
  readonly object = new THREE.Group();
  private t = 0;
  private mat: THREE.MeshBasicMaterial;

  constructor(x: number, z: number, color: number, private duration = 0.25, radius = 0.35, height = 12) {
    this.mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending });
    const m = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.4, radius, height, 7, 1, true), this.mat);
    m.position.y = height / 2;
    this.object.add(m, glowSprite(color, radius * 10, 0.9));
    this.object.position.set(x, 0, z);
  }

  update(dt: number): boolean {
    this.t += dt;
    const k = this.t / this.duration;
    this.mat.opacity = 0.95 * (1 - k);
    this.object.scale.set(1 + k * 0.5, 1, 1 + k * 0.5);
    return k < 1;
  }
}

/** Expanding ring on the ground (explosions, bursts). */
export class Ring implements Effect {
  readonly object: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private t = 0;

  constructor(x: number, z: number, color: number, private radius: number, private duration = 0.35) {
    this.object = new THREE.Mesh(
      new THREE.RingGeometry(0.7, 1, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
    );
    this.object.position.set(x, 0.08, z);
  }

  update(dt: number): boolean {
    this.t += dt;
    const k = Math.min(1, this.t / this.duration);
    this.object.scale.setScalar(Math.max(0.01, this.radius * (0.3 + 0.7 * k)));
    this.object.material.opacity = 0.9 * (1 - k);
    return k < 1;
  }
}

/** A straight shot flashing along a lane, then fading (gunbot fire). */
export class Tracer implements Effect {
  readonly object = new THREE.Group();
  private t = 0;
  private mat: THREE.MeshBasicMaterial;

  constructor(x: number, z: number, yaw: number, length: number, color: number, private duration = 0.18, width = 0.18) {
    this.mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending });
    const beam = new THREE.Mesh(new THREE.BoxGeometry(width, width, length).translate(0, 1.25, length / 2), this.mat);
    const halo = new THREE.Mesh(
      new THREE.BoxGeometry(width * 4, width * 4, length).translate(0, 1.25, length / 2),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.25, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.object.add(beam, halo);
    this.object.position.set(x, 0, z);
    this.object.rotation.y = yaw;
  }

  update(dt: number): boolean {
    this.t += dt;
    const k = Math.min(1, this.t / this.duration);
    this.mat.opacity = 0.95 * (1 - k);
    (this.object.children[1] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>).material.opacity = 0.25 * (1 - k);
    this.object.scale.set(1 - k * 0.6, 1 - k * 0.6, 1);
    return k < 1;
  }
}

/** A photon streak along the floor behind a dash: it follows her for the dash, then fades. */
export class DashTrail implements Effect {
  readonly object: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private t = 0;
  private from: THREE.Vector3;

  constructor(from: THREE.Vector3, private follow: THREE.Vector3, private dashTime: number, private fade = 0.3, color = 0x7fe8ff) {
    this.from = from.clone();
    // Unit plane along +Z from the origin, stretched to the path each frame. Vertex colours fade it
    // from nothing at the start to full at her feet (additive, so black is invisible).
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0, 0.5);
    const c = new THREE.Color(color);
    const pos = geo.getAttribute('position');
    const cols = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const k = pos.getZ(i);
      cols.set([c.r * k, c.g * k, c.b * k], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    this.object = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
    );
    this.object.position.set(from.x, 0.06, from.z);
    this.object.scale.set(0.5, 1, 0.01);
  }

  update(dt: number): boolean {
    this.t += dt;
    if (this.t <= this.dashTime) {
      const dx = this.follow.x - this.from.x;
      const dz = this.follow.z - this.from.z;
      this.object.rotation.y = Math.atan2(dx, dz);
      this.object.scale.z = Math.max(0.01, Math.hypot(dx, dz));
      return true;
    }
    const k = Math.min(1, (this.t - this.dashTime) / this.fade);
    this.object.material.opacity = 0.55 * (1 - k);
    this.object.scale.x = 0.5 * (1 - k * 0.6);
    return k < 1;
  }
}
