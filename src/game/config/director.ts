/**
 * The attack director. Every field enemy attack takes a share of a threat budget from its
 * telegraph until it resolves (melee windups, aimed shots, globs and missiles still in the air);
 * an enemy that can't get a share waits and repositions. Bosses and facility machinery don't count.
 */
export const ai = {
  /** Threat budget: how many attacks may be live on the player at once. */
  maxThreat: 2,
  /** A Garanz barrage's share (missiles in flight): 2 takes the whole budget. */
  barrageThreat: 2,
  /** Minimum seconds between two enemies starting an attack, so attacks come in a readable rhythm. */
  attackStagger: 0.6,
  /** Minimum seconds between two ranged attacks starting. */
  shotGap: 0.8,
  /** Seconds between waves in a room. */
  waveDelay: 1.2,
};
