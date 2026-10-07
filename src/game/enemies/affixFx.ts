import * as THREE from 'three';
import { AFFIXES, type Affix } from '../data/affixes';
import { glowTexture } from '../world/glow';

// Body effects for elite affixes: each affix reads on the enemy itself, so it can be told
// apart without the enemy frame (the floor glow only marks elite / champion). Each one sits on
// a different part of the body, so a champion's two stay readable:
//   Overclocked  cyan sparks over the body, speed streaks behind it
//   Volatile     orange glow at the core that flickers faster as it weakens, smoke on top
//   Shielding    teal rings orbiting the waist (a hex plate in front once it is alone)
//   Regenerating green motes spiralling up (bright while healing, grey while suppressed)
//   Splitting    a yellow seam down the middle that widens as it weakens
//   Molten       embers rising and dripping (the body darkens; see Enemy)
//   Stormcaller  a storm cloud over its head, lightning into it
//   Frenzied     steam before the threshold, red flames after (it also grows; see Enemy)

/** What the effects need from the enemy each frame. */
export interface AffixFxState {
  alive: boolean;
  /** Ground speed, m/s. */
  speed: number;
  /** HP share left, 0..1. */
  hpK: number;
  frenzied: boolean;
  /** Frenzied: how close it is to the threshold (0 = far, 1 = at it). */
  frenzyNear: number;
  /** Regenerating: healing right now, idle (recently hit), or suppressed by Burn / Poison. */
  regen: 'active' | 'idle' | 'off';
  /** Shielding with nobody tethered: its frontal plate is up. */
  shieldAlone: boolean;
}

interface Particle {
  s: THREE.Sprite;
  age: number;
  life: number;
  vx: number;
  vy: number;
  vz: number;
  size: number;
}

function sprite(color: number, opacity: number, additive = true, depthTest = true): THREE.Sprite {
  const s = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTexture(),
      color,
      opacity,
      transparent: true,
      depthWrite: false,
      depthTest,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    }),
  );
  s.renderOrder = 2;
  return s;
}

/** A small pool of sprites that are born, drift and fade. */
class Emitter {
  readonly ps: Particle[] = [];
  private acc = 0;

  constructor(
    group: THREE.Group,
    n: number,
    color: number,
    private opacity: number,
    additive: boolean,
    /** Place a reborn particle (position, velocity, life, size). */
    private born: (p: Particle) => void,
    /** Growth of the size over the life (end size multiplier). */
    private grow = 1,
  ) {
    for (let i = 0; i < n; i++) {
      const s = sprite(color, 0, additive);
      s.visible = false;
      group.add(s);
      this.ps.push({ s, age: 1, life: 1, vx: 0, vy: 0, vz: 0, size: 0.2 });
    }
  }

  /** Spawn `rate` particles per second (free slots only), then advance them. `fade` scales opacity. */
  update(dt: number, rate: number, fade = 1): void {
    this.acc += rate * dt;
    for (const p of this.ps) {
      if (this.acc < 1) break;
      if (p.age < p.life) continue;
      this.acc -= 1;
      p.age = 0;
      this.born(p);
      p.s.visible = true;
    }
    this.acc = Math.min(this.acc, 1);
    for (const p of this.ps) {
      if (p.age >= p.life) {
        p.s.visible = false;
        continue;
      }
      p.age += dt;
      const k = Math.min(1, p.age / p.life);
      p.s.position.x += p.vx * dt;
      p.s.position.y += p.vy * dt;
      p.s.position.z += p.vz * dt;
      p.s.scale.setScalar(p.size * (1 + (this.grow - 1) * k));
      // Quick fade in, long fade out.
      p.s.material.opacity = this.opacity * fade * Math.min(1, k * 6) * (1 - k);
    }
  }

  setColor(c: number): void {
    for (const p of this.ps) p.s.material.color.setHex(c);
  }
}

/** One affix's look. */
interface Part {
  update(dt: number, st: AffixFxState, t: number): void;
}

export class AffixFx {
  readonly group = new THREE.Group();
  private parts: Part[] = [];
  private t = Math.random() * 10;

  /** `s`: the enemy's body scale (about 1 for a Booma, its height ~2 m). */
  constructor(affixes: Affix[], s: number) {
    for (const a of affixes) {
      const make = PARTS[a];
      if (make) this.parts.push(make(this.group, s));
    }
  }

  update(dt: number, st: AffixFxState): void {
    this.t += dt;
    this.group.visible = st.alive;
    if (!st.alive) return;
    for (const p of this.parts) p.update(dt, st, this.t);
  }
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);

const PARTS: Partial<Record<Affix, (g: THREE.Group, s: number) => Part>> = {
  overclocked(g, s) {
    const color = AFFIXES.overclocked.color;
    const sparks = Array.from({ length: 11 }, () => {
      const sp = sprite(color, 0, true, false);
      sp.scale.setScalar(0.34 * s);
      g.add(sp);
      return { sp, t: 0 };
    });
    const streaks = [-0.32, 0, 0.32].map((x, i) => {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(0.06 * s, 0.06 * s, 1),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }),
      );
      m.position.set(x * s, [0.65, 1.35, 1.0][i] * s, 0);
      g.add(m);
      return m;
    });
    return {
      update(dt, st) {
        for (const k of sparks) {
          k.t -= dt;
          if (k.t > 0) continue;
          k.t = rand(0.04, 0.13);
          const a = rand(0, Math.PI * 2);
          const r = rand(0.5, 0.85) * s;
          k.sp.position.set(Math.sin(a) * r, rand(0.3, 1.9) * s, Math.cos(a) * r);
          k.sp.material.opacity = Math.random() < 0.55 ? rand(0.6, 1) : 0;
        }
        const run = Math.min(1, Math.max(0, (st.speed - 0.4) / 2.5));
        streaks.forEach((m, i) => {
          const len = (0.5 + run * 1.6) * (0.8 + 0.3 * Math.sin(i * 2 + st.speed));
          m.scale.z = len;
          m.position.z = -(0.45 * s + len / 2);
          m.material.opacity = run * 0.8;
        });
      },
    };
  },

  volatile(g, s) {
    const color = AFFIXES.volatile.color;
    const core = sprite(color, 0.4, true, false);
    core.scale.setScalar(1.7 * s);
    core.position.set(0, 1.05 * s, 0.1 * s);
    const hot = sprite(0xffd090, 0.3, true, false);
    hot.scale.setScalar(0.75 * s);
    hot.position.copy(core.position);
    g.add(core, hot);
    const smoke = new Emitter(g, 7, 0x2e2a28, 0.6, false, (p) => {
      p.s.position.set(rand(-0.2, 0.2) * s, 1.7 * s, rand(-0.2, 0.2) * s);
      p.vx = rand(-0.1, 0.1);
      p.vy = rand(0.5, 0.8);
      p.vz = rand(-0.1, 0.1);
      p.life = rand(1.2, 1.8);
      p.size = 0.45 * s;
    }, 2.6);
    let phase = 0;
    return {
      update(dt, st) {
        // A ticking bomb: the lower its HP, the faster the core throbs.
        phase += dt * (1.5 + 9 * (1 - st.hpK));
        const beat = Math.pow(0.5 + 0.5 * Math.sin(phase * Math.PI * 2), 3);
        core.material.opacity = 0.15 + 0.6 * beat;
        hot.material.opacity = 0.1 + 0.8 * beat;
        smoke.update(dt, 2.5);
      },
    };
  },

  shielding(g, s) {
    const color = AFFIXES.shielding.color;
    const mat = () => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending });
    const rings = [0, 1].map((i) => {
      const r = new THREE.Mesh(new THREE.TorusGeometry(1.0 * s, 0.04 * s, 6, 44), mat());
      r.position.y = (0.95 + i * 0.12) * s;
      g.add(r);
      return r;
    });
    // Small emitter nodes riding the outer ring.
    const nodes = [0, 1, 2].map(() => {
      const n = sprite(color, 0.9);
      n.scale.setScalar(0.35 * s);
      g.add(n);
      return n;
    });
    const plate = new THREE.Group();
    const hex = new THREE.Mesh(
      new THREE.CircleGeometry(0.85 * s, 6),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }),
    );
    const edge = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.CircleGeometry(0.85 * s, 6)),
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending }),
    );
    plate.add(hex, edge);
    plate.position.set(0, 1.0 * s, 1.0 * s);
    plate.rotation.z = Math.PI / 6;
    g.add(plate);
    return {
      update(_dt, st, t) {
        rings[0].rotation.set(Math.PI / 2 + Math.sin(t * 0.9) * 0.25, 0, t * 1.4);
        rings[1].rotation.set(Math.PI / 2 - Math.sin(t * 0.7) * 0.3, Math.cos(t * 0.5) * 0.3, -t * 1.1);
        nodes.forEach((n, i) => {
          const a = t * 1.8 + (i * Math.PI * 2) / 3;
          n.position.set(Math.cos(a) * 1.0 * s, (1.0 + Math.sin(a * 2) * 0.1) * s, Math.sin(a) * 1.0 * s);
        });
        plate.visible = st.shieldAlone;
        if (st.shieldAlone) (hex.material as THREE.MeshBasicMaterial).opacity = 0.14 + Math.sin(t * 5) * 0.06;
      },
    };
  },

  regenerating(g, s) {
    const green = AFFIXES.regenerating.color;
    let ang = 0;
    const motes = new Emitter(g, 12, green, 0.9, true, (p) => {
      ang += 2.4;
      const r = rand(0.75, 0.95) * s;
      p.s.position.set(Math.sin(ang) * r, rand(0.1, 0.5) * s, Math.cos(ang) * r);
      p.vx = -Math.cos(ang) * 0.25;
      p.vz = Math.sin(ang) * 0.25;
      p.vy = rand(0.7, 1.1) * s;
      p.life = rand(1.4, 2);
      p.size = 0.3 * s;
    }, 0.5);
    let state: AffixFxState['regen'] | null = null;
    return {
      update(dt, st) {
        if (st.regen !== state) {
          state = st.regen;
          motes.setColor(state === 'off' ? 0x8a8a8a : green);
        }
        motes.update(dt, state === 'active' ? 7 : 2.5, state === 'active' ? 1 : state === 'idle' ? 0.45 : 0.35);
      },
    };
  },

  splitting(g, s) {
    const color = AFFIXES.splitting.color;
    // Drawn over the body (no depth test): a glowing slit straight down its middle.
    const seam = sprite(color, 0.8, true, false);
    const ghost = sprite(color, 0.25, true, false);
    seam.renderOrder = ghost.renderOrder = 5;
    seam.position.set(0, 1.0 * s, 0);
    ghost.position.copy(seam.position);
    g.add(ghost, seam);
    return {
      update(_dt, st, t) {
        const open = 1 - st.hpK;
        const w = (0.08 + 0.4 * open) * s;
        const flick = 0.8 + 0.2 * Math.sin(t * (8 + open * 20));
        seam.scale.set(w, 1.9 * s, 1);
        seam.material.opacity = (0.45 + 0.4 * open) * flick;
        // A faint doubled outline that drifts apart as it weakens.
        ghost.scale.set(w * 3, 2.1 * s, 1);
        ghost.position.x = Math.sin(t * 3) * 0.08 * s * (0.3 + open);
        ghost.material.opacity = 0.12 + 0.18 * open;
      },
    };
  },

  molten(g, s) {
    const color = AFFIXES.molten.color;
    const embers = new Emitter(g, 12, color, 1, true, (p) => {
      const a = rand(0, Math.PI * 2);
      const r = rand(0.65, 0.9) * s;
      p.s.position.set(Math.sin(a) * r, rand(0.4, 1.7) * s, Math.cos(a) * r);
      p.vx = Math.sin(a) * 0.3;
      p.vy = rand(0.6, 1.4);
      p.vz = Math.cos(a) * 0.3;
      p.life = rand(0.6, 1.1);
      p.size = rand(0.16, 0.26) * s;
    }, 0.4);
    const drips = new Emitter(g, 5, 0xffa040, 1, true, (p) => {
      const a = rand(0, Math.PI * 2);
      const r = rand(0.7, 0.85) * s;
      p.s.position.set(Math.sin(a) * r, rand(0.7, 1.2) * s, Math.cos(a) * r);
      p.vx = 0;
      p.vy = -rand(1.4, 2.2);
      p.vz = 0;
      p.life = 0.55 * s;
      p.size = 0.22 * s;
    }, 0.6);
    return {
      update(dt) {
        embers.update(dt, 9);
        drips.update(dt, 3);
      },
    };
  },

  stormcaller(g, s) {
    const color = AFFIXES.stormcaller.color;
    const top = 2.55 * s;
    const cloud = new THREE.Group();
    for (let i = 0; i < 6; i++) {
      const puff = sprite(i < 4 ? 0x4a4860 : 0x6a6688, 0.85, false);
      const a = (i / 6) * Math.PI * 2;
      puff.position.set(Math.sin(a) * 0.32 * s, (i % 2) * 0.1 * s, Math.cos(a) * 0.22 * s);
      puff.scale.setScalar(rand(0.55, 0.75) * s);
      cloud.add(puff);
    }
    const inner = sprite(color, 0);
    inner.scale.setScalar(1.2 * s);
    cloud.add(inner);
    cloud.position.y = top;
    g.add(cloud);
    const pts = new Float32Array(6 * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    const bolt = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending }));
    g.add(bolt);
    let next = rand(0.3, 1.2);
    let flash = 0;
    return {
      update(dt, _st, t) {
        cloud.position.y = top + Math.sin(t * 1.3) * 0.06 * s;
        cloud.rotation.y += dt * 0.4;
        next -= dt;
        if (next <= 0) {
          next = rand(0.5, 1.6);
          flash = 0.12;
          // A zigzag from the cloud down to its head.
          const x0 = rand(-0.2, 0.2) * s;
          for (let i = 0; i < 6; i++) {
            const k = i / 5;
            pts[i * 3] = x0 * (1 - k) + (i > 0 && i < 5 ? rand(-0.15, 0.15) * s : 0);
            pts[i * 3 + 1] = top - 0.1 * s - k * 0.75 * s;
            pts[i * 3 + 2] = i > 0 && i < 5 ? rand(-0.12, 0.12) * s : 0;
          }
          geo.attributes.position.needsUpdate = true;
        }
        flash = Math.max(0, flash - dt);
        const on = flash > 0 ? 1 : 0;
        bolt.material.opacity = on;
        inner.material.opacity = 0.15 + on * 0.7;
      },
    };
  },

  frenzied(g, s) {
    const steam = new Emitter(g, 8, 0xffd8d8, 0.45, false, (p) => {
      const side = Math.random() < 0.5 ? -1 : 1;
      p.s.position.set(side * 0.55 * s, 1.7 * s, rand(-0.1, 0.1) * s);
      p.vx = side * rand(0.2, 0.5);
      p.vy = rand(0.8, 1.2);
      p.vz = rand(-0.15, 0.15);
      p.life = rand(0.7, 1.1);
      p.size = 0.3 * s;
    }, 3);
    const flames = new Emitter(g, 16, AFFIXES.frenzied.color, 0.95, true, (p) => {
      const a = rand(0, Math.PI * 2);
      const r = rand(0.6, 0.9) * s;
      p.s.position.set(Math.sin(a) * r, rand(0.2, 1.6) * s, Math.cos(a) * r);
      p.vx = Math.sin(a) * 0.3;
      p.vy = rand(1.6, 2.6);
      p.vz = Math.cos(a) * 0.3;
      p.life = rand(0.35, 0.6);
      p.size = rand(0.4, 0.55) * s;
    }, 0.3);
    return {
      update(dt, st) {
        steam.update(dt, st.frenzied ? 0 : st.frenzyNear * 5);
        flames.update(dt, st.frenzied ? 26 : 0);
      },
    };
  },
};

/** A Shielding elite's bubble around an ally it protects (added and removed by the world). */
export function shieldBubble(scale: number): THREE.Mesh<THREE.IcosahedronGeometry, THREE.MeshBasicMaterial> {
  const m = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1.15 * scale, 1),
    new THREE.MeshBasicMaterial({
      color: AFFIXES.shielding.color,
      wireframe: true,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  m.position.y = 1.0 * scale;
  return m;
}
