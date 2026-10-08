/** Hard mode stat scaling for one expedition's field enemies (see DESIGN.md "Nightmare"). */
export interface HardScale {
  /** Multipliers on HP, XP and Meseta. */
  hp: number;
  xp: number;
  meseta: number;
  /** Flat additions to ATP, DFP, ATA and EVP (multiplying would widen the gap between brutes and grunts too much). */
  atp: number;
  dfp: number;
  ata: number;
  evp: number;
  /** Drop tier for every enemy (drops roll the top three tiers up to it). */
  dropTier: number;
  /** The expedition's Hard rares. */
  rares: string[];
}

/** Hard mode boss scaling. */
export interface HardBossScale {
  hp: number;
  atp: number;
  dfp: number;
  ata: number;
  evp: number;
  /** Multiplier on flat (non-ATP) damage: breath and beam ticks, the laser wall, burning zones. */
  flat: number;
  xp: number;
}

/**
 * Hard mode. Same maps and waves as Normal; enemies are scaled per expedition so each Hard
 * band (Forest 42-52, Caves 52-62, Mines 62-72, Ruins 72-82) plays like the Normal Ruins at their level.
 * (Before the Ruins it was Forest 32-42, Caves 42-52, Mines 52-62, set against the Normal Mines.)
 */
export const hard = {
  /** Field enemies per expedition. */
  forest: { hp: 6.8, xp: 22, meseta: 11, atp: 240, dfp: 82, ata: 105, evp: 70, dropTier: 8, rares: ['verdant_edge', 'thornshot'] } as HardScale,
  caves: { hp: 4.7, xp: 5.7, meseta: 4.5, atp: 280, dfp: 82, ata: 107, evp: 65, dropTier: 9, rares: ['magma_blade', 'glacier_wand'] } as HardScale,
  mines: { hp: 2.9, xp: 3.4, meseta: 3.3, atp: 255, dfp: 70, ata: 95, evp: 70, dropTier: 10, rares: ['overcharge_gatling', 'reactor_rod'] } as HardScale,
  ruins: { hp: 2.6, xp: 3, meseta: 2.8, atp: 270, dfp: 77, ata: 100, evp: 70, dropTier: 11, rares: ['excalibur', 'heaven_punisher'] } as HardScale,
  bosses: {
    dragon: { hp: 13.5, atp: 375, dfp: 72, ata: 100, evp: 50, flat: 3.2, xp: 3600 } as HardBossScale,
    derolle: { hp: 7.8, atp: 345, dfp: 68, ata: 95, evp: 50, flat: 2.4, xp: 6400 } as HardBossScale,
    warden: { hp: 2.45, atp: 320, dfp: 58, ata: 85, evp: 50, flat: 1.9, xp: 9000 } as HardBossScale,
    falz: { hp: 2.4, atp: 310, dfp: 58, ata: 85, evp: 50, flat: 1.8, xp: 12000 } as HardBossScale,
  },
  // Busier, not shorter: recoveries and cooldowns shrink, telegraphs barely do.
  recoveryMult: 0.8,
  cooldownMult: 0.8,
  moveMult: 1.1,
  telegraphMult: 0.9,
  /** Telegraphs are never pushed below this (one already shorter stays as it is). */
  telegraphFloor: 0.8,
  /** Elites: 1 in 4 spawns, everywhere (doubled from 1 in 8 on 2026-10-07). */
  eliteChance: 1 / 4,
  /** Chance a room gets its one champion. */
  championChance: 0.6,
  /** Champions (two affixes): tougher than an elite. */
  championHp: 2,
  championAtp: 1.15,
  championXp: 4,
  championPoise: 2,
};
