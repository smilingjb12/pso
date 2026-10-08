import type { HardBossScale, HardScale } from './hard';

/**
 * Hell (see DESIGN.md "Hell"): the third difficulty, after Nightmare. Same maps and waves; enemies scale per
 * expedition the Nightmare way (HP / XP / Meseta multipliers on the Normal numbers, flat ATP / DFP / ATA / EVP
 * additions), carrying on from the Nightmare Ruins about one band per expedition (Forest 82-92, Caves 92-102,
 * Mines 102-112, Ruins 112-122), with HP growing a little less steeply than Nightmare's. Tempo is Nightmare's
 * (`hard.recoveryMult` and the rest). Hell is meant to be harder through Corruption and affixes.
 */
export const hell = {
  forest: { hp: 15.2, xp: 56, meseta: 34, atp: 569, dfp: 170, ata: 223, evp: 131, dropTier: 12, rares: [], elite: 0.4 } as HardScale,
  caves: { hp: 7.7, xp: 21, meseta: 13, atp: 577, dfp: 171, ata: 226, evp: 132, dropTier: 13, rares: [], elite: 0.48 } as HardScale,
  mines: { hp: 5.2, xp: 9.6, meseta: 6, atp: 551, dfp: 166, ata: 221, evp: 128, dropTier: 14, rares: [], elite: 0.56 } as HardScale,
  ruins: { hp: 4.3, xp: 5.7, meseta: 3.6, atp: 545, dfp: 165, ata: 220, evp: 130, dropTier: 15, rares: [], elite: 0.65 } as HardScale,
  bosses: {
    dragon: { hp: 23.6, atp: 530, dfp: 120, ata: 140, evp: 55, flat: 5.4, xp: 8500, hell: true } as HardBossScale,
    derolle: { hp: 13, atp: 540, dfp: 125, ata: 145, evp: 55, flat: 3.9, xp: 13800, hell: true } as HardBossScale,
    warden: { hp: 4, atp: 540, dfp: 130, ata: 150, evp: 55, flat: 2.95, xp: 17600, hell: true } as HardBossScale,
    falz: { hp: 3.6, atp: 520, dfp: 135, ata: 155, evp: 55, flat: 2.7, xp: 22400, hell: true } as HardBossScale,
  },
  /** Chance that any landed enemy or boss hit corrupts (violet attacks always do). */
  corruptChance: 0.3,
  /** Every room has a champion; rooms with at least this many spawns in the Hell Ruins get a second. */
  bigRoomSpawns: 9,
  /** At most this many affix area attacks (Volatile vents, Molten globs, Stormcaller circles) warning at once. */
  maxAffixAreas: 2,
};
