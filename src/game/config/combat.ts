export type EarlyPressPolicy = 'break' | 'ignore';
export type Race = 'native' | 'abeast' | 'machine' | 'dark';

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
 * The basic attack (2026-10-14, the Arts redesign; it was the light attack, beside a heavy one): every weapon kind
 * sweeps or fires its own shape for low damage per enemy, and it is the TP generator. Arts spend the TP. Nothing
 * misses (2026-10-09, the user's call).
 */
export const basicAttack = {
  /** Damage per enemy hit, as a multiple of one weapon hit (Arts list theirs on the same scale). */
  damageMult: 0.7,
  /**
   * TP a landed basic step refills, as a share of the class's base TP at your level (gear and Mag TP make the pool
   * bigger, not the refill): the finisher refills finisherTp times that, a perfectly chained step perfectTp times.
   */
  tpRefill: 0.06,
  finisherTp: 2,
  perfectTp: 1.5,
  /** Casters fire photon bolts: homing, this fast, this far; their damage is the caster kind's boltPower x tech damage. */
  boltSpeed: 24,
  boltRange: 13,
};

export type WeaponWeight = 'light' | 'medium' | 'heavy';

/**
 * Melee weight classes (weaponKinds[].weight). Slow kinds pay for their swing with bigger blows:
 * heavy weapons stagger more, step further into the swing and carry Poise (an enemy hit during the
 * wind-up or strike still hurts but doesn't cancel the swing; the recovery stays punishable).
 * lunge: the step into a basic swing; lungeHeavy: into a melee Art.
 */
export const weaponWeights: Record<WeaponWeight, { staggerMult: number; lunge: number; lungeHeavy: number; poise: boolean }> = {
  light: { staggerMult: 1, lunge: 0.25, lungeHeavy: 0.4, poise: false },
  medium: { staggerMult: 1, lunge: 0.25, lungeHeavy: 0.4, poise: false },
  heavy: { staggerMult: 2, lunge: 0.45, lungeHeavy: 0.65, poise: true },
};

/** Damage multiplier by perfect streak: perfect chains in a row (basic steps and Arts). */
export const comboDamage = [1.0, 1.15, 1.4];

export const formulas = {
  /**
   * Crits (2026-10-09, when ATA and EVP went; their own stat since 2026-10-14): chance up to critCap %. A crit deals
   * critDamage x (plus Crit damage affixes) on weapon hits and attack techs; Resta heals
   * get critSupport x.
   */
  critCap: 75,
  critDamage: 2,
  critSupport: 1.5,
  /**
   * A weapon hit is weapon damage x the swing's multiplier x the kind's and the family's, less the enemy's armour %;
   * a technique tech damage x its own multiplier, less the enemy's technique resistance % (2026-10-14: both were
   * DFP / MDF before, and enemy HP went up x5.56 with the change, so kill times held).
   */
  minDamage: 1,
  /**
   * Each grind level on a weapon (Edge) adds a share of the weapon's own ATP (both ends of the range), so a
   * level is worth about the same at every tier and on light or heavy weapons (~3% damage).
   */
  edgeAtpPct: 0.04,
  /**
   * Edge MST, as a share of the weapon's own MST (only rods and wands have any), sized so a level
   * is worth about as much technique damage as the ATP share gives weapon damage.
   */
  edgeMstPct: 0.15,
  /** Each grind level on a frame or barrier raises its stat bonuses by this share (2026-10-11, crafting). */
  refineArmorPct: 0.05,
  /** Enemy damage = ATP x enemyDamageScale, less the player's Strike or Area damage taken %. */
  enemyDamageScale: 0.35,
  /** Passive TP regen per second (none: Fluid injectors and caster melee refill TP). */
  tpRegen: 0,
  /**
   * Weapon damage multipliers: melee takes the risk of standing in reach, so it hits harder. Raised 2026-10-09
   * (the user's call): melee 1.1 -> 1.65 so a saber Hunter matches a Force on Normal and leads on Nightmare and
   * Hell; ranged 0.85 -> 1.5 so a handgun Ranger does ~0.85x the saber Hunter. When misses went and LCK took
   * ATA's numbers (2026-10-09), melee 1.65 -> 1.52 (no more 15% heavy whiffs, bigger crits) and ranged 1.5 -> 1.58
   * (Precision's up-to-25% went; the Ranger's crits make up the rest).
   */
  meleeDamageMult: 1.52,
  rangedDamageMult: 1.58,
};

/** Guns hit for less past their effective range (it used to be accuracy, until misses went on 2026-10-09). */
export const rangedFalloff = {
  /** Damage starts dropping past this distance (weaponKinds[].falloffStart overrides). */
  start: 10,
  /** Fraction of the damage lost per metre beyond the start... */
  perM: 0.025,
  /** ...down to at most this fraction of it. */
  floor: 0.5,
};

/**
 * Stagger meter: hits add points and an enemy flinches once they reach its poise.
 * A melee heavy finisher always staggers; a light finisher counts double.
 */
export const stagger = {
  /** Per enemy hit by a light attack or light technique. */
  light: 0.6,
  /** Heavy attack or heavy technique. */
  heavy: 1.5,
  /** Gun hits stagger this fraction of a melee hit (also scaled by the weapon's damageScale). */
  rangedMult: 0.75,
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
