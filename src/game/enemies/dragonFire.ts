import * as THREE from 'three';
import type { Effect } from '../world/Effects';
import { glowSprite, glowTexture } from '../world/glow';

// The Hell Dragon's fire rain (see Dragon.ts and DESIGN.md "Hell" > "Boss mechanics"): on its own clock, batches of
// fireballs warned on the ground one after another, each falling out of the sky as its warning runs out and leaving
// burning ground for a while. The schedule is pure, so its interleaving can be tested without the boss.

/** One fireball of a batch: when it is warned and when it lands (s from the batch's start). */
export interface FireSlot {
  warn: number;
  land: number;
}

/**
 * A batch of `n`: warned `stagger` s apart, each landing `windup` s after its warning. With stagger < windup <
 * 2 x stagger the warnings and landings take turns: warn 1, warn 2, land 1, warn 3, land 2, land 3.
 */
export function fireSchedule(n: number, stagger: number, windup: number): FireSlot[] {
  return Array.from({ length: n }, (_, k) => ({ warn: k * stagger, land: k * stagger + windup }));
}

const FIRE_COLOR = 0xff6a20;
const EDGE_COLOR = 0xffb050;
/** Seconds a patch takes to flare up, and to die down at the end of its life. */
const PATCH_IN = 0.2;
const PATCH_OUT = 1;
const EMBERS = 34;

interface Patch {
  x: number;
  z: number;
  r: number;
  /** Seconds left, and its whole life. */
  left: number;
  life: number;
  group: THREE.Group;
  glow: THREE.MeshBasicMaterial;
  edge: THREE.MeshBasicMaterial;
  embers: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  pos: Float32Array;
}

/** Burning ground where the fireballs landed: a glowing disc with a bright rim and rising embers. */
export class FirePatches {
  readonly group = new THREE.Group();
  private list: Patch[] = [];

  add(x: number, z: number, r: number, life: number): void {
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    const glow = new THREE.MeshBasicMaterial({ map: glowTexture(), color: FIRE_COLOR, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    const disc = new THREE.Mesh(new THREE.CircleGeometry(r * 1.25, 32).rotateX(-Math.PI / 2), glow);
    disc.position.y = 0.04;
    const edge = new THREE.MeshBasicMaterial({ color: EDGE_COLOR, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    const rim = new THREE.Mesh(new THREE.RingGeometry(r - 0.12, r, 40).rotateX(-Math.PI / 2), edge);
    rim.position.y = 0.05;
    const pos = new Float32Array(EMBERS * 3);
    for (let i = 0; i < EMBERS; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.sqrt(Math.random()) * r * 0.95;
      pos.set([Math.sin(a) * d, Math.random() * 1.6, Math.cos(a) * d], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const embers = new THREE.Points(geo, new THREE.PointsMaterial({ map: glowTexture(), color: 0xff8a30, size: 0.5, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    group.add(disc, rim, embers);
    this.group.add(group);
    this.list.push({ x, z, r, left: life, life, group, glow, edge, embers, pos });
  }

  /** The patch (x, z) stands in, `pad` m of body counted; null if none. */
  at(x: number, z: number, pad = 0): { x: number; z: number; r: number } | null {
    return this.list.find((p) => Math.hypot(p.x - x, p.z - z) < p.r + pad) ?? null;
  }

  update(dt: number, time: number): void {
    for (const p of this.list) {
      p.left -= dt;
      const age = p.life - p.left;
      const k = Math.max(0, Math.min(1, age / PATCH_IN, p.left / PATCH_OUT));
      const flicker = 0.85 + 0.15 * Math.sin(time * 9 + p.x * 3) * Math.sin(time * 5.3 + p.z * 2);
      p.glow.opacity = 0.55 * k * flicker;
      p.edge.opacity = 0.85 * k;
      p.embers.material.opacity = k;
      for (let i = 1; i < p.pos.length; i += 3) {
        p.pos[i] += dt * 1.9;
        if (p.pos[i] > 1.6) p.pos[i] -= 1.6;
      }
      p.embers.geometry.attributes.position.needsUpdate = true;
    }
    for (const p of this.list.filter((q) => q.left <= 0)) this.remove(p);
  }

  clear(): void {
    for (const p of [...this.list]) this.remove(p);
  }

  private remove(p: Patch): void {
    this.group.remove(p.group);
    p.group.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Points) o.geometry.dispose();
    });
    for (const m of [p.glow, p.edge, p.embers.material]) m.dispose();
    this.list.splice(this.list.indexOf(p), 1);
  }
}

/** A fireball falling out of the sky at a slant onto (x, z): hidden `delay` s, then a `fall` s drop. */
export class Meteor implements Effect {
  readonly object = new THREE.Group();
  private t = 0;
  private from: THREE.Vector3;
  private to: THREE.Vector3;

  constructor(x: number, z: number, private delay: number, private fall: number) {
    const a = Math.random() * Math.PI * 2;
    this.from = new THREE.Vector3(x + Math.sin(a) * 6, 18, z + Math.cos(a) * 6);
    this.to = new THREE.Vector3(x, 0.3, z);
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55, 1), new THREE.MeshBasicMaterial({ color: 0xffd090 }));
    this.object.add(core, glowSprite(FIRE_COLOR, 5, 0.95));
    this.object.position.copy(this.from);
    this.object.visible = false;
  }

  update(dt: number): boolean {
    this.t += dt;
    const k = (this.t - this.delay) / this.fall;
    this.object.visible = k >= 0;
    if (k >= 0) this.object.position.lerpVectors(this.from, this.to, Math.min(1, k * k));
    return k < 1;
  }
}
