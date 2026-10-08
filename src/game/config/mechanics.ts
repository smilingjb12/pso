/** Control nodes: linked gunbots reboot until the node goes down. */
export const nodes = {
  /** Seconds a linked gunbot stays offline before it reboots. */
  rebootAfter: 4,
  /** HP fraction it comes back with. */
  rebootHp: 0.6,
};

/** Pan Arms split / merge rules. */
export const panArms = {
  /** Fraction of max HP at which it splits. */
  splitAt: 0.5,
  /** Seconds after one half dies before it re-forms (unless the other dies too). */
  reformAfter: 6,
  /** HP fraction a re-formed half comes back with. */
  reformHp: 0.25,
  /** Seconds both halves must survive before they merge back. */
  mergeAfter: 12,
};

/** Player status effects. */
export const statuses = {
  /** Poison: fraction of max HP lost per second, and default duration. */
  poisonPctPerSec: 0.015,
  poisonDuration: 10,
  paralysisDuration: 2,
  /** Immunity after paralysis wears off (or is cured). */
  paralysisImmunity: 4,
  /** Burn (Mines): stacks that each drain this fraction of max HP per second. */
  burnPctPerStack: 0.005,
  burnMaxStacks: 5,
  /** Seconds one stack lasts while standing still; moving sheds stacks burnMoveMult times faster. */
  burnStackTime: 3,
  burnMoveMult: 3.5,
  /**
   * Corruption (Ruins): each stack takes this share of max HP away (current HP follows), up to the cap.
   * It never wears off on its own: pylon light sheds one stack per corruptLightTime s, and a cleared room,
   * a Sol dose or Pioneer 2 clear it all.
   */
  corruptPctPerStack: 0.06,
  corruptMaxStacks: 5,
  corruptLightTime: 1,
};

/**
 * Light pylons (Ruins rooms and the Dark Falz altar): the interact key lights one for `litTime` s, then it
 * recharges. Inside its circle Corruption sheds and Dark enemies are slowed and take more damage.
 * Chaos Sorcerers blink over and snuff a lit pylon (`snuffTime` s, any hit interrupts).
 */
export const pylonCfg = {
  radius: 5,
  litTime: 10,
  recharge: 20,
  /** Tempo (movement and attack speed) of Dark enemies standing in the light. */
  enemySlow: 0.7,
  /** Damage-taken multiplier on Dark enemies in the light. */
  enemyDamage: 1.25,
  snuffTime: 1.2,
  /** Seconds a Sorcerer waits after a snuff (or a failed try) before going for a pylon again. */
  snuffCooldown: 9,
  /** Seal of Light / Falz Halo: pylons you light last this much longer. */
  sealLitMult: 1.5,
  /** Seal of Light / Falz Halo: Corruption takes this share of what it normally would. */
  sealCorruptMult: 0.5,
};

/** Ruins enemies' special moves (field stats are in `enemies`). */
export const ruinsCfg = {
  /** Delsaber: damage a light hit to its guarded front still does, the guard's half-arc, and how long a broken guard stays down. */
  guardMult: 0.12,
  guardArcDeg: 70,
  guardBreakStun: 1.3,
  guardDown: 3.5,
  /** Delsaber leap: seconds in the air. */
  leapTime: 0.4,
  /** Chaos Sorcerer: blinks away when you come this close (cooldown blinkCooldown s), reappearing about blinkTo m from you. */
  blinkRange: 4,
  blinkCooldown: 5,
  blinkTo: 10,
  /** Fire ring (around you): inner and outer radius; the ice line's width; lightning field: circles and radius. */
  ringInner: 1.6,
  ringOuter: 3.6,
  iceWidth: 1.8,
  fieldBolts: 3,
  fieldRadius: 1.7,
  /** Dark Belra slam radius comes from strikeRange; its punch lane length and width from shotRange / shotRadius. */
  punchAtpMult: 1.0,
  slamAtpMult: 0.9,
  /** Chaos Bringer charge: windup, speed (m/s), lane width, damage and the cooldown between charges. */
  chargeWindup: 1.4,
  chargeSpeed: 13,
  chargeWidth: 2.6,
  chargeAtpMult: 1.15,
  chargeCooldown: 7,
  /** Chaos Bringer lasers: lanes in the fan and the angle between them. */
  laserLanes: 3,
  laserSpreadDeg: 24,
  laserAtpMult: 1.0,
};

/** Mines machinery. Power switches turn crushers, lasers and conveyors on or off. */
export const machinery = {
  crusherPeriod: 5.2,
  crusherWarning: 1.3,
  crusherSize: 3.4,
  crusherDamage: 120,
  /** Fraction of an enemy's max HP a crusher deals. */
  crusherEnemyPct: 0.45,
  laserOn: 2.4,
  laserOff: 2.6,
  laserWarning: 0.8,
  laserDamage: 55,
  laserBurn: 2,
  laserEnemyPct: 0.2,
  conveyorSpeed: 2.4,
  /** Garanz missiles: damage to machines caught in a blast, as a fraction of their max HP. */
  missileEnemyPct: 0.12,
  switchRange: 1.8,
};

/** Cave hazards. */
export const hazards = {
  ventPeriod: 6.5,
  ventWarning: 1.6,
  ventEruption: 1.4,
  ventRadius: 1.9,
  /** Flat damage to the player per eruption (reduced by DFP like boss ticks). */
  ventDamage: 70,
  /** Fraction of an enemy's max HP an eruption deals. */
  ventEnemyPct: 0.3,
  marshSlow: 0.7,
  /** Poison seconds refreshed while standing in a marsh / poison puddle. */
  marshPoison: 3,
  /** Mines slag pools: Burn stacks per second spent in one (they slow like the marsh). */
  slagBurnPerSec: 1,
};
