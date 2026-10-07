import type { Euler3, JointName, Pose } from './Rig';
import type { Grip } from './humanoid';

// IK-driven run cycles. Each foot follows a physically sensible path: planted
// and sliding backward at ground speed during stance, lifted and brought
// forward during swing. Hip/knee angles are solved with two-bone IK, so knees
// only ever bend the natural way and planted feet never slide.

export interface GaitStyle {
  name: string;
  desc: string;
  /** Metres travelled per full cycle (two steps). With speed this sets cadence. */
  cycleLength: number;
  /** Fraction of the cycle each foot spends on the ground (<0.5 = flight phase). */
  duty: number;
  /** Swing-foot height (heel recovery). */
  lift: number;
  /** Where in the swing the foot is highest (0..1; low = heel kicks up early, behind). */
  liftPeak: number;
  /** Hip lowering as a fraction of leg length (knee bend at mid-stance). */
  crouch: number;
  /** Pelvis vertical bounce amplitude (m). */
  bounce: number;
  /** Torso forward lean (rad). */
  lean: number;
  pelvisYaw: number;
  /** Hip drop on the swing side (rad). */
  pelvisDrop: number;
  /** Shoulder counter-rotation against the pelvis (rad). */
  chestCounter: number;
  /** Lateral foot placement from the body midline (m). Small = feet land in line. */
  footWidth: number;
  armSwing: number;
  /** Base elbow bend and how much it changes through the swing (rad). */
  elbow: number;
  elbowSwing: number;
  /** Arm abduction (rad): forearms carried away from the body. */
  armOut: number;
  /** Wrist flick outward (rad). */
  wrist: number;
  /** Fraction of the hip tilt that reaches the upper body (0 = torso perfectly upright). */
  torsoSway?: number;
  /** How much the swinging foot already sweeps backward at touchdown (0..1). */
  touchdownMatch?: number;
  /** Width of the leg-motion smoothing, as a fraction of the cycle. */
  smoothing?: number;
  /** Extra forward bend in the upper back, on top of `lean` (rad). */
  chestLean?: number;
  /** Head pitch relative to the chest (rad, + = nod forward). Default: cancels most of the lean. */
  headPitch?: number;
  /** Extra forward dip at each push-off (rad), returning upright in flight. */
  leanPulse?: number;
  /**
   * How sharply the swing foot drops after its highest point (2 = the original sin² curve).
   * Higher values bring the foot down before it passes in front of the hip, so the knee stays low.
   */
  dropPow?: number;
  /** Arms swept back and streaming behind instead of pumping (see TRAILS). */
  trail?: TrailArms;
}

/**
 * Arms carried behind the body as if blown back by the wind. Angles in radians.
 * The flutter is a travelling wave: each joint further down the arm moves a little
 * more and a little later than the one above it, at twice the stride rate (each footfall).
 */
export interface TrailArms {
  name: string;
  desc: string;
  /** How far behind the body the arms point (0 = hanging, ~1.6 = horizontal). */
  back: number;
  /** Spread away from the sides. */
  out: number;
  /** Elbow bend (0 = straight). */
  elbow: number;
  /** Wrists bend up/back. */
  wrist: number;
  /** Upper-arm twist so the palms turn up (+) or down (-). */
  twist: number;
  /** Residual swing in time with the legs. */
  pump: number;
  /** Flutter amplitude at the shoulder; the elbow and hand add more. */
  flutter: number;
  /** Extra torso lean added on top of the gait's own. */
  lean: number;
  /** Keep the weapon carried in front; only the free arm streams back. */
  freeArmOnly?: boolean;
}

export const GAITS: Record<string, GaitStyle> = {
  A: {
    name: 'Natural jog',
    desc: 'Realistic recreational jog: moderate stride, short flight, relaxed bent arms.',
    cycleLength: 2.9, duty: 0.32, lift: 0.24, liftPeak: 0.38, crouch: 0.09, bounce: 0.045, lean: 0.12,
    pelvisYaw: 0.12, pelvisDrop: 0.05, chestCounter: 0.18, footWidth: 0.07,
    armSwing: 0.55, elbow: 1.45, elbowSwing: 0.2, armOut: 0.12, wrist: 0,
  },
  B: {
    name: 'Light anime jog',
    desc: 'Quicker, shorter steps with a visible heel kick, upright torso, forearms carried out.',
    cycleLength: 2.4, duty: 0.34, lift: 0.32, liftPeak: 0.3, crouch: 0.07, bounce: 0.035, lean: 0.06,
    pelvisYaw: 0.1, pelvisDrop: 0.07, chestCounter: 0.12, footWidth: 0.05,
    armSwing: 0.45, elbow: 1.6, elbowSwing: 0.1, armOut: 0.22, wrist: 0.2,
  },
  C: {
    name: 'Athletic run',
    desc: 'Long powerful stride, high heel recovery, forward lean, strong arm drive.',
    cycleLength: 3.4, duty: 0.26, lift: 0.42, liftPeak: 0.35, crouch: 0.11, bounce: 0.06, lean: 0.2,
    pelvisYaw: 0.16, pelvisDrop: 0.05, chestCounter: 0.26, footWidth: 0.08,
    armSwing: 0.8, elbow: 1.5, elbowSwing: 0.35, armOut: 0.08, wrist: 0,
  },
  D: {
    name: 'Soft trot',
    desc: 'Gentle, floaty trot: almost no flight, low foot lift, minimal bounce.',
    cycleLength: 2.2, duty: 0.42, lift: 0.15, liftPeak: 0.5, crouch: 0.08, bounce: 0.02, lean: 0.05,
    pelvisYaw: 0.08, pelvisDrop: 0.04, chestCounter: 0.1, footWidth: 0.08,
    armSwing: 0.35, elbow: 1.1, elbowSwing: 0.1, armOut: 0.12, wrist: 0,
  },
  E: {
    name: 'Dreamcast classic',
    desc: 'Like late-90s game runs: upright, fairly straight legs, long straight-arm swing.',
    cycleLength: 2.7, duty: 0.36, lift: 0.2, liftPeak: 0.45, crouch: 0.05, bounce: 0.03, lean: 0.04,
    pelvisYaw: 0.06, pelvisDrop: 0.02, chestCounter: 0.08, footWidth: 0.09,
    armSwing: 0.7, elbow: 0.5, elbowSwing: 0.15, armOut: 0.1, wrist: 0,
  },
  // ---- Variations of B (light anime jog), with calmer hips and upper body.
  B1: {
    name: 'B · smooth & steady',
    desc: 'B with half the hip sway and twist, torso held upright, feet a touch wider.',
    cycleLength: 2.4, duty: 0.34, lift: 0.3, liftPeak: 0.3, crouch: 0.09, bounce: 0.03, lean: 0.06,
    pelvisYaw: 0.06, pelvisDrop: 0.035, chestCounter: 0.08, footWidth: 0.065,
    armSwing: 0.45, elbow: 1.6, elbowSwing: 0.1, armOut: 0.22, wrist: 0.2, torsoSway: 0.1,
  },
  B2: {
    name: 'B · gliding',
    desc: 'More time on the ground, low bounce and foot lift: smooth, almost floating.',
    cycleLength: 2.4, duty: 0.4, lift: 0.24, liftPeak: 0.38, crouch: 0.1, bounce: 0.02, lean: 0.06,
    pelvisYaw: 0.05, pelvisDrop: 0.03, chestCounter: 0.07, footWidth: 0.065,
    armSwing: 0.38, elbow: 1.6, elbowSwing: 0.08, armOut: 0.2, wrist: 0.2, torsoSway: 0.05,
  },
  B3: {
    name: 'B · springy',
    desc: 'Lighter and bouncier with an earlier heel kick, but steady hips.',
    cycleLength: 2.4, duty: 0.3, lift: 0.34, liftPeak: 0.26, crouch: 0.085, bounce: 0.045, lean: 0.07,
    pelvisYaw: 0.06, pelvisDrop: 0.03, chestCounter: 0.08, footWidth: 0.06,
    armSwing: 0.45, elbow: 1.6, elbowSwing: 0.12, armOut: 0.26, wrist: 0.3, torsoSway: 0.1,
  },
  B4: {
    name: 'B · quick & neat',
    desc: 'Shorter, quicker steps; minimal sway; arms tucked and compact.',
    cycleLength: 2.1, duty: 0.36, lift: 0.27, liftPeak: 0.32, crouch: 0.09, bounce: 0.025, lean: 0.06,
    pelvisYaw: 0.05, pelvisDrop: 0.025, chestCounter: 0.07, footWidth: 0.07,
    armSwing: 0.38, elbow: 1.7, elbowSwing: 0.08, armOut: 0.18, wrist: 0.2, torsoSway: 0.05,
  },
  B5: {
    name: 'B · longer stride',
    desc: 'Same light style with a longer, more confident stride and a little more lean.',
    cycleLength: 2.75, duty: 0.32, lift: 0.34, liftPeak: 0.3, crouch: 0.1, bounce: 0.035, lean: 0.09,
    pelvisYaw: 0.08, pelvisDrop: 0.035, chestCounter: 0.12, footWidth: 0.06,
    armSwing: 0.5, elbow: 1.55, elbowSwing: 0.12, armOut: 0.2, wrist: 0.2, torsoSway: 0.1,
  },
  // ---- Forward-lean variations of B (the in-game run). Same legs and arms;
  // only how much the torso and head tip into the run changes.
  L1: {
    name: 'Subtle lean',
    desc: 'Torso tips ~8° forward, head follows it with a slight downward gaze.',
    cycleLength: 2.4, duty: 0.34, lift: 0.32, liftPeak: 0.3, crouch: 0.07, bounce: 0.035, lean: 0.11,
    pelvisYaw: 0.1, pelvisDrop: 0.07, chestCounter: 0.12, footWidth: 0.05,
    armSwing: 0.45, elbow: 1.6, elbowSwing: 0.1, armOut: 0.22, wrist: 0.2, chestLean: 0.01, headPitch: 0.02,
  },
  L2: {
    name: 'Moderate lean, eyes ahead',
    desc: 'Torso ~13° forward; head tilts ~7° but lifts the chin to look where she is going.',
    cycleLength: 2.4, duty: 0.34, lift: 0.32, liftPeak: 0.3, crouch: 0.07, bounce: 0.035, lean: 0.17,
    pelvisYaw: 0.1, pelvisDrop: 0.07, chestCounter: 0.12, footWidth: 0.05,
    armSwing: 0.45, elbow: 1.6, elbowSwing: 0.1, armOut: 0.22, wrist: 0.2, chestLean: 0.04, headPitch: -0.1,
  },
  L3: {
    name: 'Rounded upper back',
    desc: 'Bend comes from the upper back: shoulders and head reach forward, waist stays fairly upright.',
    cycleLength: 2.4, duty: 0.34, lift: 0.32, liftPeak: 0.3, crouch: 0.07, bounce: 0.035, lean: 0.07,
    pelvisYaw: 0.1, pelvisDrop: 0.07, chestCounter: 0.12, footWidth: 0.05,
    armSwing: 0.45, elbow: 1.6, elbowSwing: 0.1, armOut: 0.22, wrist: 0.2, chestLean: 0.14, headPitch: 0.03,
  },
  L4: {
    name: 'Strong dash lean',
    desc: 'Determined anime dash: torso ~19° forward, head ~10°, chin pushed toward the goal.',
    cycleLength: 2.4, duty: 0.34, lift: 0.32, liftPeak: 0.3, crouch: 0.07, bounce: 0.035, lean: 0.25,
    pelvisYaw: 0.1, pelvisDrop: 0.07, chestCounter: 0.12, footWidth: 0.05,
    armSwing: 0.45, elbow: 1.6, elbowSwing: 0.1, armOut: 0.22, wrist: 0.2, chestLean: 0.06, headPitch: -0.14,
  },
  L5: {
    name: 'Moderate lean + push-off dip',
    desc: 'Like L2, but the torso dips a little further forward on each push-off and rises in flight.',
    cycleLength: 2.4, duty: 0.34, lift: 0.32, liftPeak: 0.3, crouch: 0.07, bounce: 0.035, lean: 0.16,
    pelvisYaw: 0.1, pelvisDrop: 0.07, chestCounter: 0.12, footWidth: 0.05,
    armSwing: 0.45, elbow: 1.6, elbowSwing: 0.1, armOut: 0.22, wrist: 0.2, chestLean: 0.04, headPitch: -0.08, leanPulse: 0.045,
  },
  // ---- Lower-knee variations of L1 (the in-game run). In L1 the swinging foot is
  // still lifted when it reaches out in front, so the thigh rises ~53°. These bring it
  // down before it passes the hip, reach forward less, and stand a little taller.
  K1: {
    name: 'Heel flick, low knee',
    desc: 'Keeps the anime heel kick, but the heel rises behind her and drops before the knee comes through. Thigh ~37°.',
    cycleLength: 2.4, duty: 0.34, lift: 0.3, liftPeak: 0.18, crouch: 0.07, bounce: 0.035, lean: 0.11,
    pelvisYaw: 0.1, pelvisDrop: 0.07, chestCounter: 0.12, footWidth: 0.05,
    armSwing: 0.45, elbow: 1.6, elbowSwing: 0.1, armOut: 0.22, wrist: 0.2, chestLean: 0.01, headPitch: 0.02,
    dropPow: 4, touchdownMatch: 0.45,
  },
  K2: {
    name: 'Low & smooth',
    desc: 'Feet skim lower all the way through the swing; a calmer, gliding jog. Thigh ~37°.',
    cycleLength: 2.4, duty: 0.34, lift: 0.2, liftPeak: 0.3, crouch: 0.06, bounce: 0.03, lean: 0.11,
    pelvisYaw: 0.1, pelvisDrop: 0.07, chestCounter: 0.12, footWidth: 0.05,
    armSwing: 0.45, elbow: 1.6, elbowSwing: 0.1, armOut: 0.22, wrist: 0.2, chestLean: 0.01, headPitch: 0.02,
    dropPow: 3, touchdownMatch: 0.45,
  },
  K3: {
    name: 'Tall & light',
    desc: 'Straighter legs (less crouch), early heel lift, foot down early: the lowest knees. Thigh ~30°.',
    cycleLength: 2.4, duty: 0.34, lift: 0.24, liftPeak: 0.22, crouch: 0.045, bounce: 0.035, lean: 0.11,
    pelvisYaw: 0.1, pelvisDrop: 0.07, chestCounter: 0.12, footWidth: 0.05,
    armSwing: 0.45, elbow: 1.6, elbowSwing: 0.1, armOut: 0.22, wrist: 0.2, chestLean: 0.01, headPitch: 0.02,
    dropPow: 4, touchdownMatch: 0.45,
  },
  K4: {
    name: 'Quicker, shorter steps',
    desc: 'Shorter stride at a higher cadence, so each step reaches forward less. Thigh ~39°.',
    cycleLength: 2.1, duty: 0.34, lift: 0.26, liftPeak: 0.22, crouch: 0.07, bounce: 0.03, lean: 0.11,
    pelvisYaw: 0.09, pelvisDrop: 0.06, chestCounter: 0.11, footWidth: 0.05,
    armSwing: 0.42, elbow: 1.6, elbowSwing: 0.1, armOut: 0.22, wrist: 0.2, chestLean: 0.01, headPitch: 0.02,
    dropPow: 3.5, touchdownMatch: 0.45,
  },
  K5: {
    name: 'Just a bit lower',
    desc: 'The smallest change from today: same stride and lift, the foot just drops a little sooner. Thigh ~45°.',
    cycleLength: 2.4, duty: 0.34, lift: 0.32, liftPeak: 0.25, crouch: 0.07, bounce: 0.035, lean: 0.11,
    pelvisYaw: 0.1, pelvisDrop: 0.07, chestCounter: 0.12, footWidth: 0.05,
    armSwing: 0.45, elbow: 1.6, elbowSwing: 0.1, armOut: 0.22, wrist: 0.2, chestLean: 0.01, headPitch: 0.02,
    dropPow: 3, touchdownMatch: 0.5,
  },
  // ---- Picked for the game: K2's low-knee legs with F's graceful style.
  K2F: {
    name: 'Low & smooth, graceful',
    desc: 'K2’s low-knee legs with F’s style: feet landing near the midline, more hip sway, arms carried close with relaxed wrists.',
    cycleLength: 2.4, duty: 0.34, lift: 0.2, liftPeak: 0.3, crouch: 0.06, bounce: 0.03, lean: 0.11,
    pelvisYaw: 0.1, pelvisDrop: 0.11, chestCounter: 0.08, footWidth: 0.015,
    armSwing: 0.38, elbow: 1.65, elbowSwing: 0.1, armOut: 0.28, wrist: 0.35, chestLean: 0.01, headPitch: 0.02,
    dropPow: 3, touchdownMatch: 0.45,
  },
  F: {
    name: 'Graceful (feminine)',
    desc: 'Feet land near the midline, pronounced hip drop, light bounce, arms close with wrists out.',
    cycleLength: 2.5, duty: 0.33, lift: 0.32, liftPeak: 0.3, crouch: 0.07, bounce: 0.03, lean: 0.05,
    pelvisYaw: 0.1, pelvisDrop: 0.11, chestCounter: 0.08, footWidth: 0.015,
    armSwing: 0.38, elbow: 1.65, elbowSwing: 0.1, armOut: 0.28, wrist: 0.35,
  },
};

/** The run cycle used in game (picked in the Run Lab). */
export const PLAYER_GAIT = GAITS.K2F;

/** Wind-swept arm styles: both arms stream behind her instead of pumping. */
export const TRAILS: Record<string, TrailArms> = {
  W1: {
    name: 'Ninja dash',
    desc: 'Arms nearly straight, swept well back and close to the body, palms up; strong forward lean.',
    back: 1.15, out: 0.1, elbow: 0.05, wrist: 0.3, twist: 0.7, pump: 0.03, flutter: 0.05, lean: 0.16,
  },
  W2: {
    name: 'Loose streaming',
    desc: 'Arms trail lower and relaxed with soft elbows; hands flutter most, like ribbons.',
    back: 0.75, out: 0.16, elbow: 0.35, wrist: 0.2, twist: 0.35, pump: 0.06, flutter: 0.1, lean: 0.08,
  },
  W3: {
    name: 'Swept wings',
    desc: 'Arms back and spread out to the sides, palms down, as if gliding.',
    back: 0.85, out: 0.55, elbow: 0.12, wrist: 0.35, twist: -0.45, pump: 0.02, flutter: 0.08, lean: 0.12,
  },
  W4: {
    name: 'Swept, still pumping',
    desc: 'Arms held back but still swinging a little with each stride: wind-blown yet grounded.',
    back: 0.85, out: 0.14, elbow: 0.25, wrist: 0.15, twist: 0.35, pump: 0.22, flutter: 0.05, lean: 0.1,
  },
  W5: {
    name: 'Free arm only',
    desc: 'Weapon stays carried in front as today; only the free arm streams back.',
    back: 0.8, out: 0.16, elbow: 0.3, wrist: 0.2, twist: 0.35, pump: 0.05, flutter: 0.09, lean: 0.08, freeArmOnly: true,
  },
};

/** Leg geometry the IK needs, taken from the built model. */
export interface LegDims {
  thigh: number; // hip pivot -> knee
  shin: number; // knee -> sole
  hipWidth: number; // lateral offset of each hip pivot
  restHipY: number; // hip pivot height above the ground in the rest pose
}

const TAU = Math.PI * 2;

/** Speed (m/s) the gait parameters are authored for. */
export const GAIT_REF_SPEED = 4.6;

/**
 * Adapt a gait to a running speed. Like real runners, slowing down mostly
 * shortens the stride (cadence drops only a little), and the motion gets
 * smaller: lower foot lift, less bounce, lean and arm drive.
 */
export function scaleGait(g: GaitStyle, speed: number): GaitStyle {
  const k = Math.max(0.3, speed / GAIT_REF_SPEED);
  const stride = Math.pow(k, 0.65);
  const energy = Math.min(1.3, 0.45 + 0.55 * k);
  return {
    ...g,
    cycleLength: g.cycleLength * stride,
    lift: g.lift * energy,
    bounce: g.bounce * energy,
    lean: g.lean * energy,
    chestLean: (g.chestLean ?? 0) * energy,
    headPitch: g.headPitch === undefined ? undefined : g.headPitch * energy,
    leanPulse: (g.leanPulse ?? 0) * energy,
    armSwing: g.armSwing * (0.6 + 0.4 * k),
  };
}
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
/** 0..1 blend that rises smoothly as cos goes from -1 to +1 (no kinks, unlike max(0, c)). */
const soft01 = (cos: number) => 0.5 + 0.5 * cos;

/**
 * Two-bone IK in the leg's sagittal plane. Target is relative to the hip pivot
 * (z forward, y up). Uses "soft IK": as the target approaches full leg
 * extension the reach is eased, so the knee never snaps straight.
 */
function legIK(tz: number, ty: number, a: number, b: number): [number, number] {
  const L = a + b;
  let d = Math.max(0.05, Math.hypot(tz, ty));
  const softStart = L * 0.965; // only the last few % of extension are eased
  if (d > softStart) {
    const s = L - softStart;
    d = softStart + s * (1 - Math.exp(-(d - softStart) / s));
  }
  const toTarget = Math.atan2(tz, -ty); // 0 = straight down, + = forward
  const alpha = Math.acos(clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1));
  const kneeInterior = Math.acos(clamp((a * a + b * b - d * d) / (2 * a * b), -1, 1));
  // Hip: negative X swings the thigh forward. Knee: positive X folds the shin back.
  return [-(toTarget + alpha), Math.PI - kneeInterior];
}

/**
 * Foot position relative to its hip pivot at cycle phase u (0..1, 0 = touchdown).
 * Returns [z forward, y up] for ground at hipHeight below the pivot.
 *
 * Velocity-continuous: the swing is a Hermite curve whose start tangent equals
 * the stance (ground) speed, so the foot rolls off the ground instead of
 * stopping dead, and whose end tangent partially matches ground speed, so it
 * sweeps back into contact. Height uses sin^2, which leaves and returns to the
 * ground with zero vertical speed.
 */
function footPath(u: number, g: GaitStyle, D: number, stance: number, hipHeight: number): [number, number] {
  const ground = -hipHeight;
  const front = stance * 0.55; // touchdown slightly ahead of the hip
  const back = -stance * 0.45;
  if (u < D) return [front + (back - front) * (u / D), ground];

  const v = (u - D) / (1 - D);
  const groundVel = ((back - front) / D) * (1 - D); // dz/dv during stance, in swing-time units
  const m0 = groundVel;
  const m1 = groundVel * (g.touchdownMatch ?? 0.6);
  const t2 = v * v;
  const t3 = t2 * v;
  const z = (2 * t3 - 3 * t2 + 1) * back + (t3 - 2 * t2 + v) * m0 + (-2 * t3 + 3 * t2) * front + (t3 - t2) * m1;

  const p = g.liftPeak;
  const f = v < p ? (0.5 * v) / p : 0.5 + (0.5 * (v - p)) / (1 - p);
  const s = Math.sin(Math.PI * f);
  const h = v < p ? s * s : Math.pow(Math.max(0, s), g.dropPow ?? 2);
  return [z, ground + g.lift * h];
}

type P = Partial<Record<JointName, Euler3>>;

/**
 * Full-body run pose at cycle phase u (0..1, left foot touchdown at 0).
 * Uses the gait's stance length and the model's leg dimensions.
 */
export function gaitPose(u: number, base: GaitStyle, dims: LegDims, grip: Grip, speed = GAIT_REF_SPEED): Pose {
  const g = scaleGait(base, speed);
  const legLen = dims.thigh + dims.shin;
  const c = Math.cos(TAU * u); // +1 when the left leg is forward
  // Stance length is the distance covered while a foot is down. Keep the
  // touchdown point comfortably inside the leg's reach; if the stride asks for
  // more, shorten ground contact instead (more flight) so the planted foot
  // still moves at exactly ground speed and never slides.
  // Hip is ~half a bounce above its low point when the foot touches down.
  const contactHip = legLen * (1 - g.crouch) + g.bounce * 0.6;
  const reach = legLen * 0.985; // knee ~20 degrees at touchdown
  const maxStance = Math.sqrt(Math.max(0.0004, reach * reach - contactHip * contactHip)) / 0.55;
  const D = Math.min(g.duty, maxStance / g.cycleLength);
  const stance = g.cycleLength * D;
  // Pelvis height: lowest at each mid-stance (twice per cycle).
  const midStance = D / 2;
  const bob = -g.bounce * Math.cos(TAU * 2 * (u - midStance));
  const hipHeight = legLen * (1 - g.crouch) + bob;

  const pelvisYaw = -g.pelvisYaw * c;
  const pelvisRoll = g.pelvisDrop * Math.cos(TAU * (u - midStance));

  // Leg angles at a given phase (pelvis height recomputed for that phase).
  const legAt = (phase: number): [number, number] => {
    const ph = ((phase % 1) + 1) % 1;
    const hh = legLen * (1 - g.crouch) - g.bounce * Math.cos(TAU * 2 * (ph - midStance));
    const [fz, fy] = footPath(ph, g, D, stance, hh);
    return legIK(fz, fy, dims.thigh, dims.shin);
  };
  // IK is exact but has corners where the foot leaves and meets the ground
  // (the knee reverses within a couple of frames). A short binomial blur over
  // the cycle rounds those corners off; mid-stance is practically unchanged.
  const BLUR = [
    [-2, 1],
    [-1, 4],
    [0, 6],
    [1, 4],
    [2, 1],
  ] as const;
  // Keep the blur well inside the ground-contact time so planted feet stay planted.
  const blurStep = Math.min(g.smoothing ?? 0.045, D * 0.12);
  const smoothLeg = (phase: number): [number, number] => {
    let hx = 0;
    let kx = 0;
    for (const [o, w] of BLUR) {
      const [h, k] = legAt(phase + o * blurStep);
      hx += h * w;
      kx += k * w;
    }
    return [hx / 16, kx / 16];
  };

  const legs: P = {};
  for (const [side, phase, hipJ, kneeJ] of [
    [1, u, 'hipL', 'kneeL'],
    [-1, (u + 0.5) % 1, 'hipR', 'kneeR'],
  ] as const) {
    const [hx, kx] = smoothLeg(phase);
    // Adduct so the foot lands at footWidth from the midline, and cancel the
    // pelvis twist/tilt so each leg keeps swinging straight along the run.
    const hz = (side * (g.footWidth - dims.hipWidth)) / legLen - pelvisRoll;
    legs[hipJ] = [hx, -pelvisYaw, hz];
    legs[kneeJ] = [kx, 0, 0];
  }

  // The hips tilt and twist, but the torso stays upright: only a fraction of
  // the pelvis roll reaches the chest.
  const torsoSway = g.torsoSway ?? 0.15;
  const twist = (g.pelvisYaw + g.chestCounter) * c;
  const swing = g.armSwing;
  // Forward dip peaks late in each stance (push-off) and eases off in flight;
  // the head only takes half of it, so the gaze stays steady.
  const pulse = (g.leanPulse ?? 0) * Math.cos(TAU * 2 * (u - D * 0.8));
  const headPitch = g.headPitch ?? -g.lean * 0.8;
  const trailLean = g.trail ? g.trail.lean * Math.min(1.3, 0.45 + 0.55 * (speed / GAIT_REF_SPEED)) : 0;
  const j: P = {
    ...legs,
    hips: [0, pelvisYaw, pelvisRoll],
    spine: [g.lean + trailLean + pulse, twist * 0.5, -pelvisRoll * (1 - torsoSway)],
    chest: [0.02 + (g.chestLean ?? 0), twist * 0.5, 0],
    head: [headPitch - pulse * 0.5, -g.chestCounter * c, -pelvisRoll * torsoSway],
    // Arms oppose the legs: left arm back when the left leg is forward.
    shoulderL: [swing * c - 0.1, 0, g.armOut],
    elbowL: [-(g.elbow + g.elbowSwing * soft01(-c)), 0, 0],
    handL: [0.15, 0, g.wrist],
    shoulderR: [-swing * c - 0.1, 0, -g.armOut],
    elbowR: [-(g.elbow + g.elbowSwing * soft01(c)), 0, 0],
    handR: [0.15, 0, -g.wrist],
  };
  if (g.trail) Object.assign(j, trailArms(g.trail, u - midStance, c, grip));
  // Weapon hand: keep the weapon carried, with a reduced swing.
  const carry = !g.trail || g.trail.freeArmOnly;
  if (grip === 'melee' && carry) Object.assign(j, { shoulderR: [-swing * 0.45 * c - 0.35, 0, -0.18], elbowR: [-1.15, 0, 0], handR: [1.0, 0, 0] });
  else if (grip === 'gun' && carry) Object.assign(j, { shoulderR: [-swing * 0.45 * c - 0.3, 0, -0.15], elbowR: [-1.3, 0, 0], handR: [1.0, 0, 0] });
  else if (grip === 'rifle')
    Object.assign(j, { shoulderR: [-0.45 - 0.1 * c, 0, -0.1], elbowR: [-1.3, 0, 0], handR: [0.95, 0.25, 0], shoulderL: [-0.5 + 0.08 * c, 0, -0.3], elbowL: [-1.2, 0, 0], handL: [0, 0, 0] });

  return { joints: j, lift: hipHeight - dims.restHipY };
}

/**
 * Arms streaming behind the body. `ph` is the cycle phase measured from mid-stance and
 * `c` the leg swing (+1 = left leg forward). A held one-handed weapon trails with its arm,
 * the hand turned so the blade points back and up instead of into the legs.
 */
function trailArms(t: TrailArms, ph: number, c: number, grip: Grip): P {
  const out: P = {};
  // Body bounce peaks twice per cycle; each joint down the arm lags it a little more.
  const wave = (lag: number, side: number) => {
    const a = TAU * 2 * ph - lag - (side > 0 ? 0 : 0.6);
    return Math.sin(a) + 0.3 * Math.sin(1.5 * a + 1.1);
  };
  for (const side of [1, -1] as const) {
    const L = side === 1;
    const pump = t.pump * (L ? c : -c);
    out[L ? 'shoulderL' : 'shoulderR'] = [t.back + pump + t.flutter * wave(0.5, side), side * t.twist, side * t.out];
    out[L ? 'elbowL' : 'elbowR'] = [-t.elbow + 1.6 * t.flutter * wave(1.3, side), 0, 0];
    out[L ? 'handL' : 'handR'] = [t.wrist + 2.6 * t.flutter * wave(2.1, side), 0, side * 0.1];
  }
  // Weapon hand: flip the fist so the blade trails up behind instead of stabbing down.
  if (grip === 'melee' || grip === 'gun') {
    const h = out.handR!;
    const s = out.shoulderR!;
    out.shoulderR = [s[0], -0.5, s[2]]; // same arm twist in every style, so the blade angle is the same
    out.handR = [(h[0] - t.wrist) * 0.4 - 0.7, Math.PI, 0.15];
    out.elbowR = [Math.min(-0.15, out.elbowR![0]), 0, 0];
  }
  return out;
}
