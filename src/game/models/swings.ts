import * as THREE from 'three';
import { keyedSlash, lerpPose, SLASH_KEYS, SLASH_READY, slashPhase } from './humanoid';
import type { Euler3, JointName, Pose } from './Rig';
import type { CharacterModel } from './heroine';
import { holdTwoHanded, type HiltTarget } from './twoHand';

// Melee combo styles with both hands on the weapon. "Joint" styles reuse the classic
// joint keyframes for the body and right arm, and the left hand is placed on the handle
// by IK. "Blade" styles key the weapon itself (where the grip is, which way the blade
// points) and both arms reach for it, so the blade sweeps a clean arc whatever the body does.

type P = Partial<Record<JointName, Euler3>>;

/**
 * Weapon keyframe in the character's own space (feet at the origin, +Z ahead, +X her left).
 * `at` is the right-hand grip; it travels on an arc round the upper chest, so keep an
 * overhead grip just in front of the head (z > 0) or the arc swings out to one side. The blade points along heading `yaw` (0 = ahead, + = toward
 * her left) and `pitch` (+ = up); past ±π/2 the blade tips over and points behind her,
 * so a vertical swing is just pitch running from ~2.5 (raised back) down to ~-0.3.
 */
export interface BladeKey {
  at: [number, number, number];
  yaw: number;
  pitch: number;
}

interface BladeMove {
  windup: P;
  end: P;
  bladeWindup: BladeKey;
  bladeEnd: BladeKey;
}

export interface SwingStyle {
  name: string;
  desc: string;
  /** No left hand (the swing as it is today). */
  oneHanded?: boolean;
  /** Joint styles: body + right arm keys. */
  keys?: { windup: P; end: P }[];
  /** Blade styles: guard pose and the three moves. */
  ready?: BladeKey;
  readyBody?: P;
  moves?: BladeMove[];
  /** How far the finisher sinks the hips after impact (m). */
  finisherDrop?: number;
}

const HEAD_FOLLOW = 0.7; // the head turns back against the chest so she keeps her eyes on the target
const body = (spine: Euler3, chest: Euler3, legs: P = {}, extra: P = {}): P => ({
  spine,
  chest,
  head: [-(spine[0] + chest[0]) * 0.5, -(spine[1] + chest[1]) * HEAD_FOLLOW, -(spine[2] + chest[2]) * HEAD_FOLLOW],
  ...legs,
  ...extra,
});
const stepL = (h: number, k: number, back = 0.2): P => ({ hipL: [-h, 0, 0], kneeL: [k, 0, 0], hipR: [back, 0, 0] });
const stepR = (h: number, k: number, back = 0.2): P => ({ hipR: [-h, 0, 0], kneeR: [k, 0, 0], hipL: [back, 0, 0] });

/** The classic keys without the arms: the body moves exactly as today, the hands follow the blade keys. */
const bodyOf = (pose: P): P => {
  const out: P = { ...pose };
  for (const j of ['shoulderL', 'elbowL', 'handL', 'shoulderR', 'elbowR', 'handR'] as const) delete out[j];
  return out;
};

const GUARD: BladeKey = { at: [-0.06, 1.02, 0.3], yaw: 0.05, pitch: 0.55 };
const GUARD_BODY = body([0.06, 0, 0], [0, -0.1, 0], { hipL: [-0.15, 0, 0], kneeL: [0.2, 0, 0], hipR: [0.1, 0, 0], kneeR: [0.1, 0, 0] });

// Wide sweeps (M3): the whole body turns into each arc, then a leaping slam into the ground.
const SLAM: BladeMove = {
  bladeWindup: { at: [-0.03, 1.86, 0.06], yaw: 0, pitch: 2.75 },
  bladeEnd: { at: [0, 0.8, 0.44], yaw: 0, pitch: -0.95 },
  windup: body([-0.3, -0.15, 0], [0, -0.2, 0], { hipL: [-0.3, 0, 0], kneeL: [0.4, 0, 0] }),
  end: body([0.6, 0, 0], [0.15, 0, 0], stepL(0.8, 0.9, 0.45), { kneeR: [0.5, 0, 0] }),
};

/**
 * M3's first two sweeps, tilted. `rise`: 0 = flat at chest height, 1 = steep (the blade's
 * plane ~45° off level). The first cut comes down from high right to low left; the second
 * either rises back up the same line or, with `cross`, comes down from high left to low
 * right so the two cuts make an X. The torso leans toward the low side as the blade lands.
 */
function diagonalSweeps(rise: number, cross: boolean): BladeMove[] {
  const hi = 1.15 + 0.38 * rise; // grip height on the high side
  const lo = 1.12 - 0.24 * rise; // and on the low side
  const up = 0.15 + 0.75 * rise; // blade pitch on the high side
  const down = 0.05 - 0.65 * rise; // and on the low side
  const lean = 0.12 * rise;
  const first: BladeMove = {
    bladeWindup: { at: [-0.42 + 0.06 * rise, hi, 0], yaw: -2.0, pitch: up },
    bladeEnd: { at: [0.36 - 0.1 * rise, lo, 0.14 + 0.1 * rise], yaw: 2.0, pitch: down },
    windup: body([0.05 - 0.1 * rise, -0.3, 0], [0, -0.6, 0], stepL(0.25, 0.3)),
    end: body([0.15 + 0.15 * rise, 0.3, -lean], [0, 0.6, 0], stepL(0.5, 0.45, 0.3)),
  };
  const second: BladeMove = cross
    ? {
        bladeWindup: { at: [0.36 - 0.04 * rise, hi, 0.05], yaw: 2.1, pitch: up },
        bladeEnd: { at: [-0.38 + 0.1 * rise, lo + 0.04 * rise, 0.16 + 0.04 * rise], yaw: -2.0, pitch: down },
        windup: body([0.1 - 0.1 * rise, 0.3, 0], [0, 0.6, 0], stepR(0.3, 0.35)),
        end: body([0.15 + 0.15 * rise, -0.3, lean], [0, -0.6, 0], stepR(0.5, 0.45, 0.3)),
      }
    : {
        bladeWindup: { at: [0.36 - 0.08 * rise, lo + 0.04 * rise, 0.05 + 0.1 * rise], yaw: 2.1, pitch: down - 0.1 * rise },
        bladeEnd: { at: [-0.38 + 0.06 * rise, hi, 0.16 - 0.06 * rise], yaw: -2.0, pitch: up },
        windup: body([0.1 + 0.15 * rise, 0.3, -lean], [0, 0.6, 0], stepR(0.3, 0.35)),
        end: body([0.15 - 0.15 * rise, -0.3, 0.04 * rise], [0, -0.6, 0], stepR(0.5, 0.45, 0.3)),
      };
  return [first, second];
}

export const SWING_STYLES: Record<string, SwingStyle> = {
  M0: {
    name: 'Today (one hand)',
    desc: 'The current swings for comparison: the left arm just hangs.',
    oneHanded: true,
    keys: SLASH_KEYS,
  },
  M1: {
    name: 'Same swings, both hands',
    desc: 'Today’s three cuts and body motion, the blade on the same arcs, but drawn in closer so both hands stay on the hilt.',
    ready: { at: [-0.15, 0.98, 0.33], yaw: 0.02, pitch: 0.4 },
    readyBody: {},
    finisherDrop: 0.08,
    moves: [
      {
        bladeWindup: { at: [-0.42, 1.3, -0.02], yaw: -1.37, pitch: 0.54 },
        bladeEnd: { at: [0.36, 1.2, 0.3], yaw: 1.16, pitch: 0.09 },
        windup: bodyOf(SLASH_KEYS[0].windup),
        end: bodyOf(SLASH_KEYS[0].end),
      },
      {
        bladeWindup: { at: [0.3, 1.45, 0.24], yaw: 0.85, pitch: 1.07 },
        bladeEnd: { at: [-0.42, 1.35, -0.05], yaw: -1.78, pitch: 0.37 },
        windup: bodyOf(SLASH_KEYS[1].windup),
        end: bodyOf(SLASH_KEYS[1].end),
      },
      {
        bladeWindup: { at: [-0.06, 1.76, 0.08], yaw: -0.23, pitch: 3.34 },
        bladeEnd: { at: [-0.12, 0.85, 0.36], yaw: -0.13, pitch: -0.79 },
        windup: bodyOf(SLASH_KEYS[2].windup),
        end: bodyOf(SLASH_KEYS[2].end),
      },
    ],
  },
  M2: {
    name: 'Katana',
    desc: 'Compact and precise: a diagonal cut down from the right shoulder, a rising cut back up, then a straight overhead strike. Hands stay on the centre line.',
    ready: GUARD,
    readyBody: GUARD_BODY,
    finisherDrop: 0.08,
    moves: [
      {
        bladeWindup: { at: [-0.22, 1.6, 0.12], yaw: 0.5, pitch: 2.2 },
        bladeEnd: { at: [0.12, 0.95, 0.38], yaw: 0.75, pitch: -0.55 },
        windup: body([-0.05, 0, 0], [0, -0.45, 0], stepL(0.2, 0.25)),
        end: body([0.28, 0, 0], [0, 0.45, 0], stepL(0.45, 0.45, 0.3)),
      },
      {
        bladeWindup: { at: [0.16, 0.95, 0.22], yaw: -0.6, pitch: -2.3 },
        bladeEnd: { at: [-0.2, 1.45, 0.3], yaw: -0.6, pitch: 0.9 },
        windup: body([0.2, 0, 0], [0, 0.4, 0], stepR(0.3, 0.35)),
        end: body([0.05, 0, 0], [0, -0.45, 0], stepR(0.45, 0.4, 0.3)),
      },
      {
        bladeWindup: { at: [-0.02, 1.88, 0.07], yaw: 0, pitch: 2.5 },
        bladeEnd: { at: [-0.02, 0.98, 0.45], yaw: 0, pitch: -0.3 },
        windup: body([-0.2, 0, 0], [0, -0.1, 0], { hipL: [-0.15, 0, 0] }),
        end: body([0.4, 0, 0], [0.15, 0, 0], stepL(0.65, 0.6, 0.35)),
      },
    ],
  },
  M3: {
    name: 'Wide sweeps',
    desc: 'Big flat arcs at chest height with the whole body turning into them, then a leaping overhead slam into the ground.',
    ready: GUARD,
    readyBody: GUARD_BODY,
    finisherDrop: 0.16,
    moves: [...diagonalSweeps(0, false), SLAM],
  },
  D1: {
    name: 'Diagonal: down, then back up',
    desc: 'M3 with the first two sweeps tilted ~30°: down from high right to low left, then rising back up to high right.',
    ready: GUARD,
    readyBody: GUARD_BODY,
    finisherDrop: 0.16,
    moves: [...diagonalSweeps(0.6, false), SLAM],
  },
  D2: {
    name: 'Steep: down, then back up',
    desc: 'As D1 but steeper (~45°).',
    ready: GUARD,
    readyBody: GUARD_BODY,
    finisherDrop: 0.16,
    moves: [...diagonalSweeps(1, false), SLAM],
  },
  X1: {
    name: 'Diagonal X',
    desc: 'Both sweeps come down ~30°: high right to low left, then high left to low right, crossing in an X.',
    ready: GUARD,
    readyBody: GUARD_BODY,
    finisherDrop: 0.16,
    moves: [...diagonalSweeps(0.6, true), SLAM],
  },
  X2: {
    name: 'Steep X',
    desc: 'As X1 but steeper (~45°).',
    ready: GUARD,
    readyBody: GUARD_BODY,
    finisherDrop: 0.16,
    moves: [...diagonalSweeps(1, true), SLAM],
  },
  M4: {
    name: 'Heavy greatsword',
    desc: 'Weighty and committed: the blade rests on her right shoulder, chops down across, heaves back up, then is raised behind her back for a huge vertical slam.',
    ready: GUARD,
    readyBody: GUARD_BODY,
    finisherDrop: 0.18,
    moves: [
      {
        bladeWindup: { at: [-0.18, 1.42, 0.2], yaw: 0.35, pitch: 2.75 },
        bladeEnd: { at: [0.12, 0.88, 0.4], yaw: 0.6, pitch: -0.95 },
        windup: body([-0.08, -0.1, 0], [0, -0.35, 0], stepL(0.15, 0.25)),
        end: body([0.4, 0.1, 0], [0, 0.55, 0], stepR(0.55, 0.5, 0.3)),
      },
      {
        bladeWindup: { at: [0.16, 0.98, 0.22], yaw: -0.55, pitch: -2.5 },
        bladeEnd: { at: [-0.22, 1.55, 0.25], yaw: -0.55, pitch: 1.15 },
        windup: body([0.25, 0.1, 0], [0, 0.6, 0], stepR(0.35, 0.45)),
        end: body([-0.1, -0.1, 0], [0, -0.55, 0], stepL(0.35, 0.35, 0.25)),
      },
      {
        bladeWindup: { at: [-0.02, 1.76, 0.08], yaw: 0, pitch: 3.3 },
        bladeEnd: { at: [0, 0.78, 0.45], yaw: 0, pitch: -1.05 },
        windup: body([-0.25, 0, 0], [-0.1, 0, 0], { hipL: [-0.2, 0, 0], kneeL: [0.3, 0, 0], kneeR: [0.15, 0, 0] }),
        end: body([0.6, 0, 0], [0.2, 0, 0], stepL(0.8, 0.95, 0.45), { kneeR: [0.55, 0, 0] }),
      },
    ],
  },
};

/** The melee combo used in game (picked in the Swing Lab). */
export const PLAYER_SWING = SWING_STYLES.D1;

/** Arc centre for blade keys: hands circle the upper chest rather than travelling in straight lines. */
const PIVOT = new THREE.Vector3(0, 1.3, 0);

function toSph(at: [number, number, number]): [number, number, number] {
  const x = at[0] - PIVOT.x;
  const y = at[1] - PIVOT.y;
  const z = at[2] - PIVOT.z;
  return [Math.hypot(x, y, z), Math.atan2(x, z), Math.atan2(y, Math.hypot(x, z))];
}

/** Blend two weapon keys: grip along an arc about the chest, blade heading and pitch linearly. */
export function lerpBlade(a: BladeKey, b: BladeKey, t: number, out: HiltTarget): HiltTarget {
  const [ra, aa, ea] = toSph(a.at);
  const [rb, ab, eb] = toSph(b.at);
  const r = ra + (rb - ra) * t;
  const az = aa + (ab - aa) * t;
  const el = ea + (eb - ea) * t;
  out.at.set(Math.sin(az) * Math.cos(el) * r, Math.sin(el) * r, Math.cos(az) * Math.cos(el) * r).add(PIVOT);
  const yaw = a.yaw + (b.yaw - a.yaw) * t;
  const pitch = a.pitch + (b.pitch - a.pitch) * t;
  out.dir.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
  return out;
}

export interface SwingFrame {
  pose: Pose;
  /** Weapon target for blade styles (character space). */
  hilt?: HiltTarget;
  /** Put the left hand on the handle. */
  twoHanded: boolean;
}

/** Slash `hitIndex` of a style at swing progress k (impact = the hit frame), like humanPoses.slash. */
export function swingFrame(style: SwingStyle, hitIndex: number, k: number, impact: number, hilt: HiltTarget): SwingFrame {
  const i = hitIndex % 3;
  if (style.keys) {
    return { pose: keyedSlash(style.keys, SLASH_READY, i, k, impact), twoHanded: !style.oneHanded };
  }
  const m = style.moves![i];
  const { sweeping, u } = slashPhase(k, impact);
  // Each windup starts from where the last cut ended, so chained hits flow without a jump.
  const from = i === 0 ? style.ready! : style.moves![i - 1].bladeEnd;
  if (sweeping) lerpBlade(m.bladeWindup, m.bladeEnd, u, hilt);
  else lerpBlade(from, m.bladeWindup, u, hilt);
  const fromBody = i === 0 ? (style.readyBody ?? {}) : style.moves![i - 1].end;
  const joints = sweeping ? lerpPose(m.windup, m.end, u) : lerpPose(fromBody, m.windup, u);
  const drop = i === 2 ? (style.finisherDrop ?? 0.08) * Math.min(1, Math.max(0, (k - impact) * 4)) : 0;
  return { pose: { joints, lift: -0.03 - drop }, hilt, twoHanded: true };
}

/**
 * Eases the weapon target toward the keyed one (like the rig eases joints), so starting a
 * swing from a run, or a new combo from mid-recovery, blends instead of snapping.
 */
export class HiltFollower {
  readonly cur: HiltTarget = { at: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, 1) };
  private live = false;

  follow(target: HiltTarget, dt: number, rate: number): HiltTarget {
    if (!this.live) {
      this.cur.at.copy(target.at);
      this.cur.dir.copy(target.dir);
      this.live = true;
      return this.cur;
    }
    const k = 1 - Math.exp(-rate * dt);
    this.cur.at.lerp(target.at, k);
    this.cur.dir.lerp(target.dir, k).normalize();
    return this.cur;
  }

  /** Start from the weapon's current place next time (grip point and axis in character space). */
  seed(at: THREE.Vector3, dir: THREE.Vector3): void {
    this.cur.at.copy(at);
    this.cur.dir.copy(dir);
    this.live = true;
  }

  reset(): void {
    this.live = false;
  }
}

/** What a pose wants from the hands: a keyed blade for both, or (no hilt) just the left hand on the weapon. */
export interface HoldRequest {
  hilt?: HiltTarget;
}

/** How fast the hands take hold of the weapon and let go (1/s). */
const HOLD_RATE = 20;
/** How fast a keyed blade follows its keys (1/s), the same as the rig's swing rate. */
const BLADE_RATE = 30;

const _at = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qr = new THREE.Quaternion();

/**
 * Keeps both hands on the weapon from pose to pose. Call update() after the rig has applied
 * the frame's pose: it eases the hold in and out, starts a keyed blade from wherever the
 * weapon already is (a swing out of a run doesn't snap), and lets go smoothly afterwards.
 */
export class WeaponHold {
  private readonly follower = new HiltFollower();
  private weight = 0;
  private keyed = false;
  /** Arm stretch last frame (1 = an arm fully straight; above ~0.99 a hand can't quite reach). */
  stretch = 0;

  /** `leftAt`: where the left hand holds the weapon (see LEFT_HAND_AT). `snap`: jump straight to the request. */
  update(model: CharacterModel, dt: number, want: HoldRequest | null, leftAt: number, snap = false): void {
    const target = want ? 1 : 0;
    this.weight = snap ? target : this.weight + (target - this.weight) * (1 - Math.exp(-HOLD_RATE * dt));
    let hilt: HiltTarget | undefined;
    if (want?.hilt) {
      if (snap) hilt = want.hilt;
      else {
        if (!this.keyed) this.seedFromGrip(model);
        hilt = this.follower.follow(want.hilt, dt, BLADE_RATE);
      }
      this.keyed = true;
    } else if (!want && this.keyed && this.weight > 0.001) {
      hilt = this.follower.cur; // letting go: keep reaching for where the blade was
    } else {
      this.keyed = false;
    }
    this.stretch = holdTwoHanded(model, this.weight, leftAt, hilt);
  }

  /** Start the keyed blade from the weapon's current place (character space). */
  private seedFromGrip(model: CharacterModel): void {
    const root = model.rig.root;
    root.updateWorldMatrix(true, true);
    _at.setFromMatrixPosition(model.grip.matrixWorld);
    root.worldToLocal(_at);
    model.grip.getWorldQuaternion(_q);
    root.getWorldQuaternion(_qr);
    _dir.set(0, 0, 1).applyQuaternion(_q).applyQuaternion(_qr.invert());
    this.follower.seed(_at, _dir);
  }
}
