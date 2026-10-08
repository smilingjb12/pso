/** Light hits an area (several enemies, weaker each); heavy hits one target hard. */
export type AttackType = 'light' | 'heavy';
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

// Light sweeps an area (the weapon kind sets its shape and target cap) for low damage per enemy;
// heavy hits one target hard and rolls the weapon special. Heavy can't reach a sure hit: maxHit
// caps its chance after ATA, so high-ATA builds still risk misses.
export const attackTypes = {
  light: { timingMult: 1.0, recoveryMult: 1.0, damageMult: 0.7, accuracyMult: 1.0, maxHit: 100 },
  heavy: { timingMult: 1.55, recoveryMult: 1.2, damageMult: 1.5, accuracyMult: 0.8, maxHit: 85 },
};

export type WeaponWeight = 'light' | 'medium' | 'heavy';

/**
 * Melee weight classes (weaponKinds[].weight). Slow kinds pay for their swing with bigger blows:
 * heavy weapons stagger more, step further into the swing and carry Poise (an enemy hit during the
 * wind-up or strike still hurts but doesn't cancel the swing; the recovery stays punishable).
 */
export const weaponWeights: Record<WeaponWeight, { staggerMult: number; lunge: number; lungeHeavy: number; poise: boolean }> = {
  light: { staggerMult: 1, lunge: 0.25, lungeHeavy: 0.4, poise: false },
  medium: { staggerMult: 1, lunge: 0.25, lungeHeavy: 0.4, poise: false },
  heavy: { staggerMult: 2, lunge: 0.45, lungeHeavy: 0.65, poise: true },
};

/**
 * Technique forms, like attackTypes for casting: light is the area version of a spell
 * (Foie cone, Zonde chain, Barta wave), heavy the single-target one (fireball, big bolt, ice spike).
 */
export const spellForms = {
  light: { timingMult: 1.0, recoveryMult: 1.0, powerMult: 0.5, tpMult: 1.0, statusMult: 0.5 },
  heavy: { timingMult: 1.2, recoveryMult: 1.1, powerMult: 1.35, tpMult: 1.3, statusMult: 1.5 },
};

/** Accuracy multiplier by hit index in the combo (PSO used 1.0 / 1.3 / 1.69; the reward is now mostly damage). */
export const comboAccuracy = [1.0, 1.15, 1.3];

/** Damage multiplier by perfect streak: perfect chains in a row (weapon hits and attack techs). */
export const comboDamage = [1.0, 1.15, 1.4];

export const formulas = {
  /** Damage = (ATP - DFP) / divisor * scale */
  damageDivisor: 5,
  damageScale: 0.9,
  /** Hit% = ATA * mods - EVP * evpFactor */
  evpFactor: 0.2,
  minDamage: 1,
  /**
   * Each grind level is spent on Edge or on a race (Bane). Edge adds a share of the weapon's own ATP (both
   * ends of the range) and ATA, so a level is worth about the same at every tier and on light or heavy
   * weapons (~3% damage).
   */
  edgeAtpPct: 0.04,
  edgeAtaPct: 0.04,
  /**
   * Edge MST, as a share of the weapon's own MST (only canes, rods and wands have any), sized so a level
   * is worth about as much technique damage as the ATP share gives weapon damage.
   */
  edgeMstPct: 0.15,
  /** Bane: race % per level (one attribute roll step, ~5-6% damage against that race), up to the tier's roll cap. */
  banePerGrind: 5,
  /** Enemy damage = (ATP - DFP) * enemyDamageScale */
  enemyDamageScale: 0.35,
  /** Passive TP regen per second (none: Fluid injectors and caster melee refill TP). */
  tpRegen: 0,
  /** Scales the TP that caster melee weapons restore per hit (weaponKinds[].tpOnHit). */
  meleeTpMult: 1,
  /** Weapon damage multipliers: melee takes the risk of standing in reach, so it hits harder. */
  meleeDamageMult: 1.1,
  rangedDamageMult: 0.85,
};

/** Weapon accuracy on top of the PSO hit formula. */
export const accuracy = {
  /** Flat hit % added to melee weapon attacks. */
  meleeBonus: 15,
  /** Ranged hit chance starts dropping past this distance (weaponKinds[].falloffStart overrides). */
  rangedFalloffStart: 10,
  /** Fraction of the hit chance lost per metre beyond the falloff start... */
  rangedFalloffPerM: 0.025,
  /** ...down to at most this fraction of it. */
  rangedFalloffFloor: 0.5,
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
