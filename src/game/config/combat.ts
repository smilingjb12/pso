export type EarlyPressPolicy = 'break' | 'ignore';

export interface AttackTiming {
  windup: number; // seconds before the hit lands
  active: number; // seconds the hit is live
  recovery: number; // seconds after the hit before the swing ends
  /** Rhythm overrides for this weapon: perfect-window length and grace (default: combo settings). */
  perfect?: number;
  grace?: number;
}

export const combo = {
  /** Fraction of the swing (0..1) after which the chain window opens. */
  windowOpen: 0.55,
  /** Extra seconds after the swing ends where the pose is held and a chain is still accepted. */
  grace: 0.18,
  /** What happens when the player presses before the window opens. */
  earlyPress: 'break' as EarlyPressPolicy,
  /** Seconds after a combo ends (or breaks) before a new one can begin. */
  resetDelay: 0.25,
  /** Extra recovery multiplier on the 3rd (finishing) hit. */
  finisherRecoveryMult: 1.5,
  /** Seconds at the start of the chain window that count as a perfect chain (weapon timing can override). */
  perfect: 0.1,
  showCue: true,
};

/**
 * The basic attack (2026-10-14, the Arts redesign; it was the light attack, beside a heavy one): a photon bolt, the TP
 * generator. Arts spend the TP. Nothing misses (2026-10-09, the user's call).
 */
export const basicAttack = {
  /**
   * TP a landed basic step refills, as a share of base TP at your level (gear and Mag TP make the pool bigger, not
   * the refill): the finisher refills finisherTp times that, a perfectly chained step perfectTp times.
   */
  tpRefill: 0.06,
  finisherTp: 2,
  perfectTp: 1.5,
  /** Photon bolts: homing, this fast, this far; their damage is the kind's boltPower x tech damage. */
  boltSpeed: 24,
  boltRange: 13,
};

/** Damage multiplier by perfect streak: perfect chains in a row (basic steps and Arts). */
export const comboDamage = [1.0, 1.15, 1.4];

export const formulas = {
  /**
   * Crits (2026-10-09, when ATA and EVP went; their own stat since 2026-10-14): chance up to critCap %. A crit deals
   * critDamage x (plus Crit damage affixes) on photon bolts and attack techs; Resta heals get critSupport x.
   */
  critCap: 75,
  critDamage: 2,
  critSupport: 1.5,
  /**
   * A technique hit is tech damage x its own multiplier, less the enemy's technique resistance % (2026-10-14: it was
   * MDF before, and enemy HP went up x5.56 with the change, so kill times held).
   */
  minDamage: 1,
  /** Each grind level on a weapon (Edge, built in) adds this share of its Tech damage. */
  edgeMstPct: 0.15,
  /** Each grind level on a frame or barrier raises its stat bonuses by this share (2026-10-11, crafting). */
  refineArmorPct: 0.05,
  /** Enemy damage = ATP x enemyDamageScale, less the player's Strike or Area damage taken %. */
  enemyDamageScale: 0.35,
  /** Passive TP regen per second (none: photon bolts and Fluid injectors refill TP). */
  tpRegen: 0,
};

/** Stagger meter: hits add points and an enemy flinches once they reach its poise. A bolt finisher counts double. */
export const stagger = {
  /** Per enemy hit by a photon bolt or a technique (single-target ones stagger a few times that). */
  light: 0.6,
  /** A photon blast (Mylla & Youlla counts double that). */
  heavy: 1.5,
  /** Hits that land while the enemy is winding up an attack count this many times over. */
  counterMult: 2,
  /** Seconds without being hit before the meter drains, and points drained per second. */
  decayDelay: 1.2,
  decayPerSec: 0.6,
};

export const debug = {
  timeScale: 1,
  showLog: true,
  invincible: false,
};
