export const drops = {
  /** Global multiplier on drop chance (debug). */
  rateMult: 1,
  rareMult: 1,
  boxDropRate: 0.6,
};

/**
 * Bump when the attribute or Mag tree rules change in a way that breaks existing builds: every character
 * gets all its attribute points and Mag squares back to spend again (the only way they are ever refunded).
 */
export const BUILD_VERSION = 1;

/** Attribute points (POW / DEX / MIND / DEF, see data/stats.ts). Permanent once spent. */
export const attributeCfg = {
  /** Points per level gained (none at Lv 1). */
  pointsPerLevel: 3,
};

/** The Mag's talent grid (see mag.ts) and its passives. Squares are permanent once learned. */
export const magCfg = {
  /** Mag points per character level (Lv 1 already has one). */
  pointsPerLevel: 1,
  /**
   * Keystone I (ring 5) and II (the tip): squares of the arm's colour learned first, and points in the arm's
   * attribute. Three points a level all in one attribute reach 45 at Lv 16 and 115 at Lv 39; two a level at
   * Lv 23 and 58; half at Lv 31 and 78.
   */
  keystoneReq: [
    { squares: 8, points: 45 },
    { squares: 16, points: 115 },
  ],
  /** The four two-arm notables need this many points in each of their two attributes. */
  hybridReqPoints: 20,
  /** Bulwark: damage multiplier on area attacks, boss attacks and hazards. */
  bulwarkMult: 0.85,
  /** Last Stand: seconds before it can save you again. */
  lastStandCooldown: 120,
  /** Follow-through: damage multiplier on combo finishers. */
  followThroughMult: 1.15,
  /** Breaker: melee hits fill enemy stagger meters this much faster. */
  breakerMult: 1.25,
  /** Crush: fraction of enemy DFP heavy melee attacks ignore. */
  crushDfpIgnore: 0.3,
  /** Fleet: extra dash charges. */
  fleetCharges: 1,
  /** Deadeye: heavy hit-chance cap. */
  deadeyeMaxHit: 95,
  /** Rhythm: seconds added to the perfect window, and the run speed multiplier. */
  rhythmBonus: 0.03,
  rhythmRunMult: 1.1,
  /** Efficiency: attack technique TP cost multiplier. */
  efficiencyTpMult: 0.85,
  /** Bulwark / Efficiency: Mate / Fluid injector doses restore this much more. */
  injectorBoost: 0.2,
  /** Clarity: seconds after a Fluid dose during which attack techniques cost no TP. */
  clarityTime: 4,
  /** Swift Cast: technique cast time (wind-up and recovery) multiplier. */
  swiftCastMult: 0.8,
  /** Steadfast: knockback taken multiplier (melee swings also carry Poise). */
  steadfastKnockback: 0.5,
  /** Slipstream: seconds after dashing out of an enemy telegraph during which the next attack or cast lands perfect. */
  slipstreamTime: 3,
  /** Longshot: guns and techniques deal this much more to enemies farther than longshotRange metres. */
  longshotMult: 1.12,
  longshotRange: 8,
  /** Barrier: Resta overheal becomes a shield up to this fraction of max HP, fading to nothing over barrierFade s. */
  barrierCap: 0.2,
  barrierFade: 4,
  /** Retaliate: after taking a hit, the next melee swing within retaliateTime s deals this much more. */
  retaliateMult: 1.25,
  retaliateTime: 2,
};

/**
 * Injectors (Mate = HP, Fluid = TP), one slot: doses refill from damage dealt and in Pioneer 2, nothing
 * else. A floor (~35 enemies) is worth about 3 + 5 Mate doses (plus charge orbs): a budget a sloppy run burns through.
 */
export const injectorCfg = {
  /** Doses the injector gains for taking a normal enemy from full HP to 0 (partial damage gives part). */
  chargePerEnemy: 0.15,
  /** Fluid injectors charge at this fraction of that rate (from damage, bosses and Rhythm alike). */
  fluidChargeMult: 0.5,
  /** Elites count this many times over. */
  eliteChargeMult: 2,
  /**
   * Out of combat (no room fight, no boss engaged) the injector refills at calmRate doses a second, either kind,
   * once calmDelay seconds have passed since the fight: empty to full (3 doses) in about half a minute.
   */
  calmDelay: 3,
  calmRate: 0.1,
  /** Seconds the hands are busy after a dose (a hit cancels the lock, not the dose). */
  useLock: 0.45,
  /** Steady: seconds a dose takes and how much more it restores in total. */
  steadyTime: 4,
  steadyMult: 1.6,
  /** Emergency: gauge fraction below which a dose restores emergencyMult more. */
  emergencyBelow: 0.35,
  emergencyMult: 1.6,
  /** Reserve: extra doses it holds. */
  reserveDoses: 1,
  /**
   * Charge orbs: walk-over drops worth this many doses of the equipped injector (either kind, at full rate).
   * Not taken while the injector is full; they fade after orbLife seconds.
   */
  orbDoses: 1,
  /** Chance a normal enemy drops one (elites and champions always do; bosses never). About 1.4 a floor. */
  orbChance: 0.04,
  /** Chance a crate holds one. */
  orbBoxChance: 0.03,
  orbLife: 25,
  /** Absorbent: charge gain multiplier. */
  absorbentMult: 1.5,
  /** Sol: paralysis ward after a dose (seconds). */
  solWard: 4,
  /** Bracing: damage-taken multiplier and its duration. */
  braceMult: 0.7,
  braceTime: 3,
};

/** The Telepipe: a long, breakable cast that opens a portal back to Pioneer 2. */
export const telepipeCfg = {
  castTime: 3.5,
};
