import type { TrackId } from '../../audio';
import { darkFalz, deRolLe, dragon, galGryphon, warden } from '../config';

// One entry per area boss: everything the rest of the game needs to know about it besides its fight
// (the class in enemies/, built by enemies/createBoss.ts) and its loot (loot.ts BOSS_DROPS / HARD_BOSS_LOOT).
// Which expedition it guards and which one it opens come from data/areas.ts (`floors`, `needs`).

/** The main game's bosses (one per expedition). */
export type BossId = 'dragon' | 'derolle' | 'warden' | 'falz';
/** The Rift Map's pinnacle bosses (rift-only: no expedition, no difficulty of their own). */
export type PinnacleBossId = 'gryphon';
/** Any boss that can stand in a rift: the four, and the pinnacles'. */
export type RiftBossId = BossId | PinnacleBossId;

/** A shop tier that a boss kill opens, from a character level. */
export interface ShopUnlock {
  tier: number;
  level: number;
}

export interface BossDef {
  id: RiftBossId;
  name: string;
  /** As it reads in a sentence: "Defeat the Warden to unlock". */
  title: string;
  /** Its fight's track (the battle layer comes in with its last phase). */
  music: TrackId;
  /** Normal XP, read live from the tuning config. Nightmare XP is `hard.bosses[id].xp`, Hell's `hell.bosses[id].xp`. */
  xp(): number;
  /** Shop tiers it opens once beaten on Normal / on Nightmare / on Hell. The first entry is the one announced. */
  shop: ShopUnlock[];
  hardShop: ShopUnlock[];
  hellShop: ShopUnlock[];
  /** Beating it on Normal opens Nightmare; on Nightmare, Hell. */
  opensNightmare?: boolean;
  /** Where its loot lands: the arena centre, or where it fell. */
  dropsAt: 'center' | 'body';
  /** Radius of the loot ring, and its stretch along z (De Rol Le's long deck). */
  dropRing: number;
  dropStretch?: number;
  /** A Rift Map pinnacle's boss: rift-only (no shops, no expedition). */
  pinnacle?: boolean;
}

export const BOSSES: Record<RiftBossId, BossDef> = {
  dragon: {
    id: 'dragon', name: 'Dragon', title: 'the Dragon', music: 'dragon',
    xp: () => dragon.xp,
    shop: [],
    // Characters who played Nightmare before the Ruins got tier 7 from its Dragon: they keep it.
    hardShop: [{ tier: 8, level: 52 }, { tier: 7, level: 42 }],
    hellShop: [{ tier: 12, level: 87 }],
    dropsAt: 'body', dropRing: 3,
  },
  derolle: {
    id: 'derolle', name: 'De Rol Le', title: 'De Rol Le', music: 'derolle',
    xp: () => deRolLe.xp,
    shop: [{ tier: 5, level: 24 }],
    hardShop: [{ tier: 9, level: 62 }],
    hellShop: [{ tier: 13, level: 91 }],
    dropsAt: 'center', dropRing: 2.6, dropStretch: 2,
  },
  warden: {
    id: 'warden', name: 'Warden', title: 'the Warden', music: 'warden',
    xp: () => warden.xp,
    shop: [{ tier: 6, level: 32 }],
    hardShop: [{ tier: 10, level: 72 }],
    hellShop: [{ tier: 14, level: 96 }],
    dropsAt: 'center', dropRing: 3,
  },
  falz: {
    id: 'falz', name: 'Dark Falz', title: 'Dark Falz', music: 'falz',
    xp: () => darkFalz.xp,
    shop: [{ tier: 7, level: 42 }],
    hardShop: [{ tier: 11, level: 82 }],
    hellShop: [{ tier: 15, level: 100 }],
    opensNightmare: true,
    dropsAt: 'center', dropRing: 3,
  },
  // The Rift Map's Circle II pinnacle (2026-10-21): Storm Peak, between the Dragon's and De Rol Le's quarters.
  gryphon: {
    id: 'gryphon', name: 'Gal Gryphon', title: 'Gal Gryphon', music: 'gryphon',
    xp: () => galGryphon.xp,
    shop: [], hardShop: [], hellShop: [],
    // The summit is round with cloud all round it: loot by the body could land off the edge.
    dropsAt: 'center', dropRing: 3,
    pinnacle: true,
  },
};

/** The main game's four, in expedition order (the pinnacle bosses are rift-only). */
export const BOSS_IDS: BossId[] = ['dragon', 'derolle', 'warden', 'falz'];
/** Every boss a rift can hold. */
export const RIFT_BOSS_IDS: RiftBossId[] = [...BOSS_IDS, 'gryphon'];

export const isMainBoss = (id: RiftBossId): id is BossId => !BOSSES[id].pinnacle;
