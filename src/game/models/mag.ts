import * as THREE from 'three';
import type { Palette } from './heroine';
import { MAG_DESIGNS, type MagKit, type MagTheme } from './magDesigns';
import { mat, part } from './Rig';

// Low-poly Mag that floats behind the player's shoulder. Each evolution stage
// adds parts: 0 a pod with stub fins, 1 swept wings and a tail, 2 a halo ring,
// 3 a second wing pair and a crown (stage 4, the twin form, is two of those).
// The form colour tints accents and the eye, unless the owner's colours are given:
// then the shell takes their outfit colour, the trim their trim and the glow their glow. Stripes banding the pod stay dark
// until a Mag point is waiting to be spent, then pulse in the owner's accent colour.
// Given the arm it follows, stages 1-3 use a design from magDesigns.ts instead,
// which swaps the wings, ring and crown for that arm's gear.

/** The design the game uses (the Mag Lab compares the others). */
export const MAG_DESIGN = 'kits';

export interface MagLook {
  /** Arm the look follows (the class's arm at stage 1, the lead arm after); without one, the classic look. */
  theme?: MagTheme;
  /** Key of MAG_DESIGNS (default MAG_DESIGN); anything else keeps the classic look. */
  design?: string;
  /** The owner's colours (outfit, trim, glow); without them, a white shell tinted by the form colour. */
  colors?: Pick<Palette, 'main' | 'second' | 'accent'>;
}

export class MagModel {
  readonly group = new THREE.Group();
  private body = new THREE.Group();
  private wings: THREE.Object3D[] = [];
  private ring: THREE.Object3D | null = null;
  private t: number;
  /** Shared by every stripe: dark when idle, pulsing in the owner's colour while lit. */
  private stripe = mat(0x7a8498, { rough: 0.4 });
  private glowColor: THREE.Color | null = null;
  /** Animation of a designed look (empty for the classic one). */
  private anim: MagKit['anim'] = [];

  /** `phase` lets a twin pair bob in step. */
  constructor(readonly stage: number, readonly color: number, phase = Math.random() * 10, look: MagLook = {}) {
    this.t = phase;
    const shape = Math.min(stage, 3);
    const c = look.colors;
    const tint = c?.accent ?? color;
    const shell = mat(c?.main ?? 0xe4e9f2, { rough: 0.35 });
    const trim = mat(c?.second ?? color, { rough: 0.5 });
    const glow = mat(tint, { emissive: tint, emissiveIntensity: 1.2 });
    glow.userData.glow = true;
    this.stripe.userData.glow = true;
    this.group.add(this.body);
    this.body.scale.setScalar(1.5); // about head-sized, readable at the default camera distance

    const design = shape > 0 && look.theme ? MAG_DESIGNS[look.design ?? MAG_DESIGN] : undefined;
    if (design) {
      design.build({ body: this.body, stage: shape, theme: look.theme!, color: tint, shell, trim, glow, stripe: this.stripe, anim: this.anim });
      this.group.traverse((o) => {
        if (o instanceof THREE.Mesh) o.castShadow = false;
      });
      return;
    }

    // Core pod, stretched along its facing (+Z).
    part(this.body, new THREE.OctahedronGeometry(0.1, shape >= 2 ? 1 : 0), shell, [0, 0, 0], [0, 0, 0], [1, 0.85, 1.25]);
    part(this.body, new THREE.SphereGeometry(0.035, 8, 6), glow, [0, 0.01, 0.11]);
    // Glow stripes: three bands hugging the pod. Stage 0-1 pods are plain octahedra (square
    // cross-sections, so 4-segment rings fit their facets); stage 2+ pods are rounded.
    const round = shape >= 2;
    for (const y of [0, 0.036, -0.036]) {
      const yn = y / 0.85; // undo the pod's vertical squash
      const r = (round ? Math.sqrt(0.01 - yn * yn) : 0.1 - Math.abs(yn)) + 0.004;
      part(this.body, new THREE.TorusGeometry(r, 0.0065, 3, round ? 16 : 4), this.stripe, [0, y, 0], [Math.PI / 2, 0, 0], [1, 1.25, 1]);
    }

    if (shape === 0) {
      for (const side of [-1, 1]) {
        this.wings.push(part(this.body, new THREE.BoxGeometry(0.09, 0.012, 0.06), trim, [side * 0.12, 0, -0.01], [0, 0, side * 0.3]));
      }
    } else {
      const span = shape >= 3 ? 0.2 : 0.16;
      for (const side of [-1, 1]) {
        // Swept wing plate, pivoting at the pod.
        const pivot = new THREE.Group();
        pivot.position.set(side * 0.07, 0.01, -0.02);
        this.body.add(pivot);
        part(pivot, new THREE.BoxGeometry(span, 0.014, 0.07), trim, [side * span * 0.5, 0, -0.03], [0, side * 0.45, 0]);
        part(pivot, new THREE.BoxGeometry(span * 0.5, 0.018, 0.02), glow, [side * span * 0.55, 0.004, 0.0], [0, side * 0.45, 0]);
        this.wings.push(pivot);
        if (shape >= 3) {
          const low = new THREE.Group();
          low.position.set(side * 0.06, -0.04, -0.03);
          this.body.add(low);
          part(low, new THREE.BoxGeometry(span * 0.7, 0.012, 0.05), trim, [side * span * 0.35, 0, -0.02], [0, side * 0.7, side * -0.35]);
          this.wings.push(low);
        }
      }
      part(this.body, new THREE.ConeGeometry(0.03, 0.14, 5), trim, [0, 0, -0.16], [-Math.PI / 2, 0, 0]);
    }
    if (shape >= 2) {
      this.ring = part(this.body, new THREE.TorusGeometry(0.15, 0.008, 4, 18), glow, [0, 0, 0], [Math.PI / 2, 0, 0]);
    }
    if (shape >= 3) {
      for (let i = -1; i <= 1; i++) {
        part(this.body, new THREE.ConeGeometry(0.014, 0.08 - Math.abs(i) * 0.02, 4), glow, [i * 0.035, 0.1 - Math.abs(i) * 0.015, 0.02], [0, 0, -i * 0.35]);
      }
    }
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = false;
    });
  }

  /** Light the stripes in the owner's `color` (while Mag points are unspent). */
  setGlow(on: boolean, color: number): void {
    // Called every frame by the owner, so reuse the colour instead of allocating.
    if (on) {
      (this.glowColor ??= new THREE.Color()).setHex(color);
      return;
    }
    if (this.glowColor) {
      this.glowColor = null;
      this.stripe.color.setHex(0x7a8498);
      this.stripe.emissive.setHex(0x000000);
    }
  }

  update(dt: number): void {
    this.t += dt;
    const t = this.t;
    this.body.position.y = Math.sin(t * 2.1) * 0.035;
    this.body.rotation.z = Math.sin(t * 1.3) * 0.08;
    this.body.rotation.x = Math.sin(t * 1.7) * 0.05;
    for (const a of this.anim) a(t);
    const flap = Math.sin(t * (this.stage ? 3.2 : 5)) * 0.18;
    this.wings.forEach((w, i) => (w.rotation.z = (i % 2 ? -1 : 1) * flap * (this.stage ? 1 : 0.6)));
    if (this.ring) this.ring.rotation.z += dt * 0.9;
    if (this.glowColor) {
      // Slow breathing pulse; never fully dark so it reads as "lit".
      const pulse = 0.5 + 0.5 * Math.sin(t * 3);
      this.stripe.color.copy(this.glowColor);
      this.stripe.emissive.copy(this.glowColor);
      this.stripe.emissiveIntensity = 0.35 + 0.85 * pulse;
    }
  }

  dispose(): void {
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
  }
}

/** Shoulder offsets (x right-negative, y up, z back-negative) in the owner's local frame. */
const SINGLE_SLOT: [number, number, number][] = [[-0.5, 1.75, -0.35]];
const TWIN_SLOTS: [number, number, number][] = [[-0.55, 1.8, -0.3], [0.55, 1.8, -0.3]];

/**
 * One Mag, or a mirrored twin pair at stage 4, floating at the owner's shoulders.
 * `root` lives in world space (or any frame the owner's position is given in) so
 * the Mags can trail behind as the owner moves and turns.
 */
export class MagCompanion {
  readonly root = new THREE.Group();
  private mags: MagModel[] = [];
  private pos: THREE.Vector3[] = [];
  private formKey = '';
  private glow = false;
  private glowColor = 0xffffff;
  private look: MagLook = {};

  /** `size` scales the Mags themselves (not their offsets), e.g. smaller for close-up menu cameras. */
  constructor(private readonly size = 1) {}

  setForm(stage: number, color: number, look: MagLook = {}): void {
    const c = look.colors;
    const key = `${stage}:${color}:${look.theme}:${look.design}:${c ? `${c.main}:${c.second}:${c.accent}` : ''}`;
    if (key === this.formKey) return;
    this.formKey = key;
    this.look = look;
    for (const m of this.mags) {
      m.group.removeFromParent();
      m.dispose();
    }
    const twin = stage >= 4;
    const phase = Math.random() * 10;
    this.mags = (twin ? TWIN_SLOTS : SINGLE_SLOT).map((_, i) => {
      const m = new MagModel(stage, color, phase, this.look);
      const k = this.size * (twin ? 0.9 : 1);
      m.group.scale.set(twin && i ? -k : k, k, k); // the left twin is a mirror image
      this.root.add(m.group);
      m.setGlow(this.glow, this.glowColor);
      return m;
    });
    this.pos = this.mags.map(() => new THREE.Vector3(NaN, 0, 0));
  }

  /** Pulse the stripes in the owner's colour (unspent Mag points). */
  setGlow(on: boolean, color: number): void {
    this.glow = on;
    this.glowColor = color;
    for (const m of this.mags) m.setGlow(on, color);
  }

  /** Follow an owner standing at `at` facing `yaw`; `trail` eases instead of snapping. */
  update(dt: number, at: THREE.Vector3, yaw: number, trail = true): void {
    const slots = this.mags.length > 1 ? TWIN_SLOTS : SINGLE_SLOT;
    const s = Math.sin(yaw);
    const c = Math.cos(yaw);
    const k = trail ? 1 - Math.exp(-8 * dt) : 1;
    this.mags.forEach((m, i) => {
      const [lx, ly, lz] = slots[i];
      const tx = at.x + lx * c + lz * s;
      const tz = at.z - lx * s + lz * c;
      const ty = at.y + ly;
      const p = this.pos[i];
      if (Number.isNaN(p.x) || (p.x - tx) ** 2 + (p.z - tz) ** 2 > 25) p.set(tx, ty, tz);
      p.x += (tx - p.x) * k;
      p.y += (ty - p.y) * k;
      p.z += (tz - p.z) * k;
      m.group.position.copy(p);
      const r = m.group.rotation;
      r.y += Math.atan2(Math.sin(yaw - r.y), Math.cos(yaw - r.y)) * (trail ? Math.min(1, dt * 6) : 1);
      m.update(dt);
    });
  }

  dispose(): void {
    for (const m of this.mags) m.dispose();
    this.root.removeFromParent();
  }
}
