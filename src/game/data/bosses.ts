import type { TrackId } from '../../audio';
import { darkFalz, deRolLe, dragon, warden, type Race } from '../config';

// One entry per area boss: everything the rest of the game needs to know about it besides its fight
// (the class in enemies/, built by enemies/createBoss.ts) and its loot (loot.ts BOSS_DROPS / HARD_BOSS_LOOT).
// Which expedition it guards and which one it opens come from data/areas.ts (`floors`, `needs`).

export type BossId = 'dragon' | 'derolle' | 'warden' | 'falz';

/** A shop tier that a boss kill opens, from a character level. */
export interface ShopUnlock {
  tier: number;
  level: number;
}

export interface BossDef {
  id: BossId;
  name: string;
  /** As it reads in a sentence: "Defeat the Warden to unlock". */
  title: string;
  race: Race;
  /** Its fight's track (the battle layer comes in with its last phase). */
  music: TrackId;
  /** Normal XP, read live from the tuning config. Nightmare XP is `hard.bosses[id].xp`. */
  xp(): number;
  /** Shop tiers it opens once beaten on Normal / on Nightmare. The first entry is the one announced. */
  shop: ShopUnlock[];
  hardShop: ShopUnlock[];
  /** Beating it on Normal opens Nightmare. */
  opensNightmare?: boolean;
  /** Where its loot lands: the arena centre, or where it fell. */
  dropsAt: 'center' | 'body';
  /** Radius of the loot ring, and its stretch along z (De Rol Le's long deck). */
  dropRing: number;
  dropStretch?: number;
}

export const BOSSES: Record<BossId, BossDef> = {
  dragon: {
    id: 'dragon', name: 'Dragon', title: 'the Dragon', race: 'native', music: 'dragon',
    xp: () => dragon.xp,
    shop: [],
    // Characters who played Nightmare before the Ruins got tier 7 from its Dragon: they keep it.
    hardShop: [{ tier: 8, level: 52 }, { tier: 7, level: 42 }],
    dropsAt: 'body', dropRing: 3,
  },
  derolle: {
    id: 'derolle', name: 'De Rol Le', title: 'De Rol Le', race: 'dark', music: 'derolle',
    xp: () => deRolLe.xp,
    shop: [{ tier: 5, level: 24 }],
    hardShop: [{ tier: 9, level: 62 }],
    dropsAt: 'center', dropRing: 2.6, dropStretch: 2,
  },
  warden: {
    id: 'warden', name: 'Warden', title: 'the Warden', race: 'machine', music: 'warden',
    xp: () => warden.xp,
    shop: [{ tier: 6, level: 32 }],
    hardShop: [{ tier: 10, level: 72 }],
    dropsAt: 'center', dropRing: 3,
  },
  falz: {
    id: 'falz', name: 'Dark Falz', title: 'Dark Falz', race: 'dark', music: 'falz',
    xp: () => darkFalz.xp,
    shop: [{ tier: 7, level: 42 }],
    hardShop: [{ tier: 11, level: 82 }],
    opensNightmare: true,
    dropsAt: 'center', dropRing: 3,
  },
};

export const BOSS_IDS = Object.keys(BOSSES) as BossId[];
