import * as THREE from 'three';
import { isCounter, type AreaId, type FeatureKind } from '../data/areas';
import { Heroine, type CharacterModel } from '../models/heroine';
import { Humanoid, humanPoses, STYLES } from '../models/humanoid';
import { glowDecal } from './glow';

// World objects the player can use with the interact key: NPC counters,
// teleporters, switches.

// Shared teleporter beam textures (DataTextures so levels build without a DOM).
let beamFade: THREE.DataTexture | null = null;
let beamStreaks: THREE.DataTexture | null = null;

/** Alpha map along the beam's height: bright at the pad, gone well before the top edge. */
function beamFadeTexture(): THREE.DataTexture {
  if (beamFade) return beamFade;
  const h = 64;
  const data = new Uint8Array(h * 4);
  for (let y = 0; y < h; y++) {
    const v = y / (h - 1);
    const a = Math.pow(1 - v, 1.8) * (0.55 + 0.45 * Math.min(1, v * 12));
    const c = Math.round(a * 255);
    data.set([c, c, c, 255], y * 4);
  }
  beamFade = new THREE.DataTexture(data, 1, h);
  beamFade.magFilter = beamFade.minFilter = THREE.LinearFilter;
  beamFade.needsUpdate = true;
  return beamFade;
}

/** Tileable light streaks of uneven length and brightness, scrolled upward. */
function beamStreakTexture(): THREE.DataTexture {
  if (beamStreaks) return beamStreaks;
  const w = 64, h = 64;
  const data = new Uint8Array(w * h * 4);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let x = 0; x < w; x++) {
    const bright = rnd() < 0.35 ? 0.5 + rnd() * 0.5 : rnd() * 0.18;
    const start = rnd() * h, len = h * (0.25 + rnd() * 0.5);
    for (let y = 0; y < h; y++) {
      const d = (y - start + h) % h;
      const a = d < len ? bright * Math.sin((d / len) * Math.PI) : 0;
      const c = Math.round(a * 255);
      data.set([c, c, c, 255], (y * w + x) * 4);
    }
  }
  beamStreaks = new THREE.DataTexture(data, w, h);
  beamStreaks.wrapS = beamStreaks.wrapT = THREE.RepeatWrapping;
  beamStreaks.magFilter = beamStreaks.minFilter = THREE.LinearFilter;
  beamStreaks.needsUpdate = true;
  return beamStreaks;
}

function beamMaterial(color: number, opacity: number, map?: THREE.Texture): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    map,
    alphaMap: beamFadeTexture(),
    opacity,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
}

const STYLIST_LOOK = { body: 'P2', hair: 'H8', outfit: 'O2', accessory: 'A1', palette: 'C4', glow: 'G1', armor: 'R0', back: 'B0', face: 'F0' };

export class Interactable {
  readonly group = new THREE.Group();
  readonly pos = this.group.position;
  enabled = true;
  /** Visual state for switches and power switches. */
  active = false;
  /** Power switches: the status light's colour (set by the world). */
  lightColor = 0xffa020;
  private light: THREE.MeshBasicMaterial | null = null;
  private lever: THREE.Object3D | null = null;
  private glow: THREE.Mesh | null = null;
  private glowMat: THREE.MeshBasicMaterial | null = null;
  private t = Math.random() * 10;
  private npc: CharacterModel | null = null;
  /** Telepipe portal: the spinning ring and its inner swirl. */
  private portal: { ring: THREE.Object3D; swirl: THREE.Mesh; swirlMat: THREE.MeshBasicMaterial } | null = null;
  private waveT = 0;
  /** Teleporter beam: additive layers with their full-strength opacities, rising rings, scrolling streaks. */
  private beam: {
    mats: { mat: THREE.MeshBasicMaterial; base: number }[];
    rings: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>[];
    streaks: THREE.Texture;
    level: number;
  } | null = null;

  constructor(
    readonly kind: FeatureKind,
    public label: string,
    x: number,
    z: number,
    readonly lock?: string,
    /** Teleporters: where they lead. */
    readonly to?: AreaId,
  ) {
    this.pos.set(x, 0, z);
    this.build();
  }

  get range(): number {
    return isCounter(this.kind) ? 3.2 : 2.6;
  }

  private build(): void {
    switch (this.kind) {
      case 'shopWeapon':
      case 'shopArmor':
      case 'shopItem':
      case 'medical': {
        const colors: Record<string, number> = { shopWeapon: 0xff8a30, shopArmor: 0x4aa8ff, shopItem: 0x50e070, medical: 0xff6aa0 };
        const counter = new THREE.Mesh(
          new THREE.BoxGeometry(3.2, 1.1, 1),
          new THREE.MeshStandardMaterial({ color: 0x3a4258 }),
        );
        counter.position.y = 0.55;
        const style = { shopWeapon: STYLES.armorer, shopArmor: STYLES.shopkeeper, shopItem: STYLES.clerk, medical: STYLES.nurse }[this.kind];
        this.npc = new Humanoid(style);
        const npc = this.npc.rig.root;
        npc.position.set(0, 0, -0.95);
        if (this.kind === 'medical') {
          counter.rotation.y = Math.PI / 2;
          npc.position.set(0.95, 0, 0);
          npc.rotation.y = -Math.PI / 2;
        }
        const sign = new THREE.Mesh(
          new THREE.BoxGeometry(2.4, 0.5, 0.1),
          new THREE.MeshBasicMaterial({ color: colors[this.kind] }),
        );
        sign.position.set(0, 3, this.kind === 'medical' ? 0 : -1.1);
        if (this.kind === 'medical') {
          sign.rotation.y = Math.PI / 2;
          sign.position.set(1.1, 3, 0);
        }
        this.group.add(counter, npc, sign);
        break;
      }
      case 'stylist': {
        // Counter along the west wall, stylist behind it facing east.
        const counter = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.1, 1), new THREE.MeshStandardMaterial({ color: 0x3a4258 }));
        counter.position.y = 0.55;
        counter.rotation.y = Math.PI / 2;
        this.npc = new Heroine(STYLIST_LOOK);
        const npc = this.npc.rig.root;
        npc.position.set(-0.95, 0, 0);
        npc.rotation.y = Math.PI / 2;
        const sign = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.5, 0.1), new THREE.MeshBasicMaterial({ color: 0xc070ff }));
        sign.rotation.y = Math.PI / 2;
        sign.position.set(-1.1, 3, 0);
        // A tall mirror beside the counter.
        const frame = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.2, 1.0), new THREE.MeshStandardMaterial({ color: 0xc8b070, metalness: 0.6, roughness: 0.3 }));
        frame.position.set(-1.0, 1.2, 2.2);
        const glass = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.95, 0.8), new THREE.MeshStandardMaterial({ color: 0xbfd8ff, metalness: 0.9, roughness: 0.08 }));
        glass.position.set(-0.93, 1.2, 2.2);
        this.group.add(counter, npc, sign, frame, glass);
        break;
      }
      case 'cityTeleporter':
      case 'toCity':
      case 'toBoss':
      case 'toNext': {
        const color = this.kind === 'toBoss' ? 0xff4040 : this.kind === 'toNext' ? 0xb080ff : 0x40c0ff;
        const metal = new THREE.MeshStandardMaterial({ color: 0x4a5062, metalness: 0.55, roughness: 0.45 });
        const dark = new THREE.MeshStandardMaterial({ color: 0x2c3140, metalness: 0.4, roughness: 0.6 });
        // Two-step pad: a wide plinth, then a raised emitter plate.
        const plinth = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.85, 0.16, 40), dark);
        plinth.position.y = 0.08;
        const plate = new THREE.Mesh(new THREE.CylinderGeometry(1.32, 1.42, 0.14, 40), metal);
        plate.position.y = 0.23;
        // Emitter nodes around the plinth.
        const nodeMat = new THREE.MeshBasicMaterial({ color });
        const nodeGeo = new THREE.BoxGeometry(0.16, 0.06, 0.26);
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
          const node = new THREE.Mesh(nodeGeo, nodeMat);
          node.position.set(Math.cos(a) * 1.55, 0.17, Math.sin(a) * 1.55);
          node.rotation.y = -a;
          this.group.add(node);
        }
        // Glowing trim on the plate edge.
        const rimMat = new THREE.MeshBasicMaterial({ color });
        const rim = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.035, 6, 56), rimMat);
        rim.rotation.x = Math.PI / 2;
        rim.position.y = 0.31;
        const pool = glowDecal(color, 2.6, 0.7);
        pool.position.y = 0.305;
        const halo = glowDecal(color, 5, 0.25);
        halo.position.y = 0.02;
        // The beam: a soft outer sheath plus scrolling streaks, both fading out with height.
        const sheathMat = beamMaterial(color, 0.5);
        const sheath = new THREE.Mesh(new THREE.CylinderGeometry(1.08, 1.15, 3.6, 40, 1, true), sheathMat);
        sheath.position.y = 0.3 + 1.8;
        const streaks = beamStreakTexture().clone();
        streaks.repeat.set(4, 0.6);
        streaks.needsUpdate = true;
        const streakMat = beamMaterial(color, 0.9, streaks);
        const streakBeam = new THREE.Mesh(new THREE.CylinderGeometry(0.98, 1.05, 3.2, 40, 1, true), streakMat);
        streakBeam.position.y = 0.3 + 1.6;
        const coreMat = beamMaterial(0xffffff, 0.12);
        const core = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.75, 2.2, 24, 1, true), coreMat);
        core.position.y = 0.3 + 1.1;
        // Thin rings that drift up the beam and fade.
        const ringGeo = new THREE.RingGeometry(1.0, 1.1, 48).rotateX(-Math.PI / 2);
        const rings = [0, 1, 2].map(() => {
          const r = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
          this.group.add(r);
          return r;
        });
        this.group.add(plinth, plate, rim, pool, halo, sheath, streakBeam, core);
        this.beam = {
          mats: [
            { mat: nodeMat, base: 1 },
            { mat: rimMat, base: 1 },
            { mat: pool.material, base: 0.7 },
            { mat: halo.material, base: 0.25 },
            { mat: sheathMat, base: 0.5 },
            { mat: streakMat, base: 0.9 },
            { mat: coreMat, base: 0.12 },
          ],
          rings,
          streaks,
          level: 1,
        };
        nodeMat.transparent = rimMat.transparent = true;
        break;
      }
      case 'switch': {
        const post = new THREE.Mesh(
          new THREE.CylinderGeometry(0.3, 0.4, 1.0, 12),
          new THREE.MeshStandardMaterial({ color: 0x5a6070 }),
        );
        post.position.y = 0.5;
        this.glowMat = new THREE.MeshBasicMaterial({ color: 0xffb020 });
        this.glow = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 8), this.glowMat);
        this.glow.position.y = 1.2;
        this.group.add(post, this.glow);
        break;
      }
      case 'power': {
        // A console on a plinth: an angled panel, a lever and a status lamp.
        const steel = new THREE.MeshStandardMaterial({ color: 0x4a505a, metalness: 0.45, roughness: 0.5, flatShading: true });
        const dark = new THREE.MeshStandardMaterial({ color: 0x272a30, metalness: 0.3, roughness: 0.6, flatShading: true });
        const base = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.0, 0.6), steel);
        base.position.y = 0.5;
        const panel = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.12, 0.7), dark);
        panel.position.set(0, 1.05, 0.05);
        panel.rotation.x = -0.5;
        this.lever = new THREE.Group();
        this.lever.position.set(0.22, 1.1, 0.05);
        const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.45, 6).translate(0, 0.22, 0), steel);
        const knob = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshStandardMaterial({ color: 0xc03020 }));
        knob.position.y = 0.45;
        this.lever.add(stick, knob);
        this.light = new THREE.MeshBasicMaterial({ color: this.lightColor });
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), this.light);
        lamp.position.set(-0.22, 1.2, 0.05);
        this.glowMat = new THREE.MeshBasicMaterial({ color: this.lightColor, transparent: true, opacity: 0.3, depthWrite: false });
        this.glow = new THREE.Mesh(new THREE.CircleGeometry(1.1, 24), this.glowMat);
        this.glow.rotation.x = -Math.PI / 2;
        this.glow.position.y = 0.025;
        for (const m of [base, panel]) m.castShadow = true;
        this.group.add(base, panel, this.lever, lamp, this.glow);
        break;
      }
      case 'portal': {
        // A standing ring of light over a glowing floor disc, like a Telepipe's beam-out gate.
        const ringMat = new THREE.MeshBasicMaterial({ color: 0x7ae8ff });
        const ring = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.07, 8, 40), ringMat);
        ring.position.y = 1.35;
        const swirlMat = new THREE.MeshBasicMaterial({ color: 0x2a9cff, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false });
        const swirl = new THREE.Mesh(new THREE.CircleGeometry(0.95, 6), swirlMat);
        swirl.position.y = 1.35;
        const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.5, 10), new THREE.MeshStandardMaterial({ color: 0x8ab0d8, metalness: 0.5, roughness: 0.4 }));
        pipe.position.y = 0.25;
        this.glowMat = new THREE.MeshBasicMaterial({ color: 0x4ae0ff, transparent: true, opacity: 0.35, depthWrite: false });
        this.glow = new THREE.Mesh(new THREE.CircleGeometry(1.3, 24), this.glowMat);
        this.glow.rotation.x = -Math.PI / 2;
        this.glow.position.y = 0.03;
        this.group.add(ring, swirl, pipe, this.glow);
        this.portal = { ring, swirl, swirlMat };
        break;
      }
      case 'start':
        break;
    }
  }

  update(dt: number): void {
    this.t += dt;
    if (this.npc) {
      // Idle, with the occasional friendly wave.
      this.waveT -= dt;
      if (this.waveT < -6 - Math.random() * 6) this.waveT = 1.6;
      this.npc.rig.apply(this.waveT > 0 ? humanPoses.wave(this.t) : humanPoses.idle(this.t, 'none'), dt, 6);
      this.npc.update?.(dt);
    }
    if (this.portal) {
      this.portal.ring.rotation.y = this.t * 1.6;
      this.portal.swirl.rotation.y = this.t * 1.6;
      this.portal.swirl.rotation.z = this.t * 4;
      this.portal.swirlMat.opacity = 0.45 + Math.sin(this.t * 5) * 0.12;
    }
    if (this.beam) {
      const b = this.beam;
      b.level += (1 - b.level) * Math.min(1, dt * 3);
      const pulse = b.level * (0.88 + Math.sin(this.t * 2.6) * 0.12);
      for (const { mat, base } of b.mats) mat.opacity = base * pulse;
      b.streaks.offset.y = -this.t * 0.35;
      b.rings.forEach((r, i) => {
        const p = (this.t * 0.32 + i / b.rings.length) % 1;
        r.position.y = 0.35 + p * 2.6;
        r.scale.setScalar(1 - p * 0.08);
        r.material.opacity = 0.55 * pulse * Math.sin(p * Math.PI) * (1 - p);
      });
    }
    if (!this.glow || !this.glowMat) return;
    if (this.kind === 'power') {
      this.light?.color.setHex(this.lightColor);
      this.glowMat.color.setHex(this.lightColor);
      this.glowMat.opacity = 0.22 + Math.sin(this.t * 2.5) * 0.06;
      if (this.lever) this.lever.rotation.x += ((this.active ? -0.7 : 0.5) - this.lever.rotation.x) * Math.min(1, dt * 10);
      return;
    }
    if (this.kind === 'switch') {
      this.glowMat.color.setHex(this.active ? 0x40ff70 : 0xffb020);
    } else {
      this.glow.rotation.y += dt;
      this.glowMat.opacity = 0.3 + Math.sin(this.t * 3) * 0.08;
    }
  }
}
