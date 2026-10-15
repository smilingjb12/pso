import type { HardBossScale, HardScale } from './hard';

/**
 * Hell (see DESIGN.md "Hell"): the third difficulty, after Nightmare. Same maps and waves; enemies scale per
 * expedition the Nightmare way (HP / XP / Meseta multipliers on the Normal numbers, flat ATP and armour %
 * additions, a technique resistance), carrying on from the Nightmare Ruins. Bands: Forest 82-87, Caves 87-91, Mines
 * 91-96, Ruins 96-100 (squeezed when the level cap came down to 100; they were 82-122). XP is set so a level takes
 * about twice the kills (48): Hell is where levelling hands over to gear. ATP, armour and technique resistance were
 * refit on 2026-10-14 when DFP and MDF went (DESIGN.md "Stats: named by what they do"). Tempo is Nightmare's
 * (`hard.recoveryMult` and the rest). Hell is meant to be harder through Corruption and affixes.
 */
export const hell = {
  forest: { hp: 15.66, xp: 27, meseta: 34, atp: 249, armor: 4, techResist: 21, dropTier: 12, elite: 0.4 } as HardScale,
  caves: { hp: 7.34, xp: 9.2, meseta: 13, atp: 223, armor: -2, techResist: 20, dropTier: 13, elite: 0.48 } as HardScale,
  mines: { hp: 4.59, xp: 3.9, meseta: 6, atp: 189, armor: -2, techResist: 18, dropTier: 14, elite: 0.56 } as HardScale,
  ruins: { hp: 3.56, xp: 2.2, meseta: 3.6, atp: 152, armor: -4, techResist: 16, dropTier: 15, elite: 0.65 } as HardScale,
  bosses: {
    dragon: { hp: 48.82, atp: 191, armor: -3, techResist: 20, flat: 4.02, xp: 4070, hell: true } as HardBossScale,
    derolle: { hp: 24.62, atp: 162, armor: -4, techResist: 18, flat: 3.11, xp: 6070, hell: true } as HardBossScale,
    warden: { hp: 7.06, atp: 132, armor: -6, techResist: 16, flat: 2.61, xp: 7180, hell: true } as HardBossScale,
    falz: { hp: 5.96, atp: 58, armor: -5, techResist: 14, flat: 2.62, xp: 8580, hell: true } as HardBossScale,
  },
  /** Chance that any landed enemy or boss hit corrupts: every one does (2026-10-08, the user's call; was 0.3). */
  corruptChance: 1,
  /** Affixes per rank: every Hell enemy has at least one (2026-10-08, the user's call), elites and champions one more each. */
  affixCount: { regular: 1, elite: 2, champion: 3 },
  /** Every room has a champion; rooms with at least this many spawns in the Hell Ruins get a second. */
  bigRoomSpawns: 9,
  /** At most this many affix area attacks (Volatile vents, Molten globs, Stormcaller circles) warning at once. */
  maxAffixAreas: 2,
};
