/** Hard mode stat scaling for one expedition's field enemies (see DESIGN.md "Nightmare"). */
export interface HardScale {
  /** Multipliers on HP, XP and Meseta. */
  hp: number;
  xp: number;
  meseta: number;
  /** Flat addition to ATP (multiplying would widen the gap between brutes and grunts too much). */
  atp: number;
  /** Armour % added to each enemy's own (it can be below 0: higher bands mean more weapon damage to cut). */
  armor: number;
  /** Technique resistance %: replaces each enemy's own. */
  techResist: number;
  /** Drop tier for every enemy (drops roll the top three tiers up to it). */
  dropTier: number;
  /** Hell: share of spawns that come in as elites (Nightmare uses `hard.eliteChance` everywhere). */
  elite?: number;
}

/** Hard mode boss scaling. */
export interface HardBossScale {
  hp: number;
  /** Added to the boss's ATP and armour %. */
  atp: number;
  armor: number;
  /** Technique resistance %: replaces the boss's own. */
  techResist: number;
  /** Multiplier on flat (non-ATP) damage: breath and beam ticks, the laser wall, burning zones. */
  flat: number;
  xp: number;
  /** Hell: the boss gets its third phase (triple telegraphs; Dark Falz's third form takes them). */
  hell?: boolean;
  /** Rifts: speed of its state machine and telegraphs (1 = Hell's; a fixed one per boss, `riftCfg.bossTempo`). */
  tempo?: number;
  /** Rifts: multiplier on its whole ATP (its own plus `atp`), compounding with the tier. */
  atpMult?: number;
}

/**
 * Hard mode. Same maps and waves as Normal; enemies are scaled per expedition so each Hard
 * band (Forest 42-52, Caves 52-62, Mines 62-72, Ruins 72-82) plays like the Normal Ruins at their level.
 * (Before the Ruins it was Forest 32-42, Caves 42-52, Mines 52-62, set against the Normal Mines.)
 */
export const hard = {
  /** Field enemies per expedition. */
  forest: { hp: 7.07, xp: 22, meseta: 11, atp: 85, armor: 4, techResist: 14, dropTier: 8 } as HardScale,
  caves: { hp: 4.89, xp: 5.7, meseta: 4.5, atp: 124, armor: 0, techResist: 11, dropTier: 9 } as HardScale,
  mines: { hp: 3.02, xp: 3.4, meseta: 3.3, atp: 101, armor: -1, techResist: 7, dropTier: 10 } as HardScale,
  ruins: { hp: 2.7, xp: 3, meseta: 2.8, atp: 117, armor: -1, techResist: 4, dropTier: 11 } as HardScale,
  bosses: {
    dragon: { hp: 28.08, atp: 258, armor: 1, techResist: 11, flat: 2.07, xp: 3600 } as HardBossScale,
    derolle: { hp: 16.22, atp: 196, armor: -2, techResist: 8, flat: 1.81, xp: 6400 } as HardBossScale,
    warden: { hp: 5.1, atp: 161, armor: -4, techResist: 5, flat: 1.74, xp: 9000 } as HardBossScale,
    falz: { hp: 5, atp: 150, armor: -4, techResist: 2, flat: 1.93, xp: 12000 } as HardBossScale,
  },
  // Busier, not shorter: recoveries and cooldowns shrink, telegraphs barely do.
  recoveryMult: 0.8,
  cooldownMult: 0.8,
  moveMult: 1.1,
  telegraphMult: 0.9,
  /** Telegraphs are never pushed below this (one already shorter stays as it is). */
  telegraphFloor: 0.8,
  /** Elites (one affix): 40% of spawns, everywhere (1 in 8 until 2026-10-07, 1 in 4 until 2026-10-09). */
  eliteChance: 0.4,
  /** Chance a room gets its one champion (was 0.6 until 2026-10-09). */
  championChance: 0.7,
  /** Champions (two affixes): tougher than an elite. */
  championHp: 2,
  championAtp: 1.15,
  championXp: 4,
  championPoise: 2,
};
