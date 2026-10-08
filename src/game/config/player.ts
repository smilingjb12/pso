import type { EarlyPressPolicy } from './combat';

export const player = {
  moveSpeed: 4.6,
  turnSpeed: 9, // radians/sec toward move direction
  attackTurnSpeed: 7, // how fast you can re-aim during windup
  radius: 0.45,
  hitstun: 0.45,
  iframes: 0.7,
  knockback: 5,
  pickupRange: 1.6,
  /** How close (to the box's edge) the player must be to break a supply box with the interact key. */
  boxRange: 1.2,
  interactRange: 2.6,
};

/**
 * Dash (Space + a direction): pure movement, no invulnerability. It can start at any time
 * you can act (not in hitstun or paralysis) and cancels whatever you were doing: a swing in
 * its windup never lands, a chain and its perfect streak are lost, a cast in progress fizzles
 * (its TP stays spent), the Telepipe breaks.
 */
export const dash = {
  charges: 2,
  /** Seconds to refill one charge (they refill one at a time). */
  recharge: 4.5,
  /** Metres travelled. */
  distance: 3.5,
  duration: 0.22,
  /** Seconds after a dash before you can attack or cast (walking and dashing again are fine). */
  recovery: 0.15,
  /** Burn stacks a dash shakes off. */
  burnShed: 1,
  /**
   * Boss telegraphs tuned so walking can't clear them in time (a "dash check") get a pulsing cyan
   * rim in the dash colour. Rule of thumb for tuning one: walking covers moveSpeed x (warning - ~0.35 s
   * reaction); a dash adds about 2.5 m on top. Aim the escape distance between the two.
   */
  cueTelegraphs: true,
  /** The first few dash checks remind you of the key until you've dashed this many times. */
  hintUntilDashes: 5,
};

/**
 * Technique scaling. Every class knows every technique; MST is the only thing that makes them stronger
 * (and dearer). Each tech's `power` and `tp` in techniques.ts are its values at MST = mstRef.
 */
export const techScaling = {
  /** The MST at which a technique deals / heals / costs exactly its listed power and TP. */
  mstRef: 100,
  /** Attack damage = power × (MST / mstRef)^mstExp: a little faster than MST, so the Force pulls ahead. */
  mstExp: 1.2,
  /** TP cost = tp × (tpFloor + (1 − tpFloor) × MST / mstRef): high MST casts cost more, but less per point of damage. */
  tpFloor: 0.4,
  /** Shifta / Deband: power × MST / mstRef percent, never above this. */
  buffCap: 35,
  /** Seconds a Shifta / Deband lasts. */
  buffDuration: 60,
  /** Status chance added per point of MST (on top of the tech's own chance). */
  statusPerMst: 0.0003,
  /** Burn damage per tick: 5 + MST / burnMstDivisor. */
  burnMstDivisor: 40,
};

/** Casting, including cast chains: attack techs chain like combo hits (up to 3, same perfect streak). */
export const casting = {
  /** Scales every technique's post-cast recovery (rooted after the tech fires). */
  recoveryMult: 1,
  /** Seconds after a cast (or cast chain) ends before another can begin. */
  resetDelay: 0.25,
  /** Fraction of the cast after which the next attack tech can chain. */
  windowOpen: 0.6,
  /** Extra seconds after the recovery where a chain is still accepted. */
  grace: 0.15,
  earlyPress: 'break' as EarlyPressPolicy,
  /** Extra recovery on the 3rd cast of a chain. */
  finisherRecoveryMult: 1.5,
  /** Seconds at the start of the cast-chain window that count as perfect. */
  perfect: 0.12,
};

export const lockOn = {
  range: 16,
  /** Soft auto-aim when not locked: max angle off-facing to snap an attack to a target. */
  softAimDeg: 60,
  softAimRange: 4,
  /** Ranged weapons soft-aim further, in a narrower cone. */
  rangedSoftAimDeg: 30,
  rangedSoftAimRange: 18,
  /** How strongly the camera turns to frame the locked target (per second). */
  cameraFollow: 4,
};

export const camera = {
  distance: 5,
  height: 1.5,
  sensitivity: 0.0025,
  minPitch: -0.25,
  maxPitch: 1.1,
  followLerp: 12,
  fov: 60,
};

export const feel = {
  hitstopNormal: 0.045,
  hitstopHeavy: 0.08,
  hitstopPlayerHurt: 0.09,
  shakeOnHit: 0.06,
  shakeOnHurt: 0.18,
  enemyKnockback: 2.5,
};
