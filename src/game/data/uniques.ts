import type { ClassId } from './stats';
import type { WeaponKind } from './items';

// Uniques (2026-10-12, the user's redesign): six items, each with one effect nothing else has and a real cost,
// dropped by bosses only. Two pools by how far into the game you are: the main game (Normal, Nightmare and Hell
// bosses) drops one weapon per class; Falz Rift bosses drop armour anyone can wear. A unique has no affixes and
// can't be crafted: its base stats come from its item level (the tier it dropped at; a rift's are Rift-forged),
// so finding one again deeper in the game is the upgrade. Effects live in code (Character.hasUnique callers).

export type UniqueId = 'darkFlow' | 'frozenShooter' | 'reactorRod' | 'falzHalo' | 'redRing' | 'overclockCore';
export const UNIQUE_IDS: UniqueId[] = ['darkFlow', 'frozenShooter', 'reactorRod', 'falzHalo', 'redRing', 'overclockCore'];

/** Where a unique drops: main-game bosses, or Falz Rift bosses. */
export type UniquePool = 'main' | 'rift';

export interface UniqueDef {
  id: UniqueId;
  name: string;
  pool: UniquePool;
  /** The class it is made for (main-pool weapons; drops lean to it). */
  cls?: ClassId;
  base: { type: 'weapon'; kind: WeaponKind } | { type: 'armor'; slot: 'frame' | 'barrier' };
  /** What it does, and what it costs (the item card's two Unique lines). */
  effect: string;
  cost: string;
  flavour: string;
}

export const UNIQUES: Record<UniqueId, UniqueDef> = {
  darkFlow: {
    id: 'darkFlow', name: 'Dark Flow', pool: 'main', cls: 'hunter', base: { type: 'weapon', kind: 'sword' },
    effect: 'Kills heal 5% of your max HP and remove a Corruption stack',
    cost: "Mate injectors don't work",
    flavour: 'A blade of living darkness taken from Dark Falz.',
  },
  frozenShooter: {
    id: 'frozenShooter', name: 'Frozen Shooter', pool: 'main', cls: 'ranger', base: { type: 'weapon', kind: 'rifle' },
    effect: 'Heavy shots freeze; a shot on a frozen enemy shatters it for ×2.5 (then it can’t freeze for 3 s)',
    cost: '50% less damage to anything not frozen (bosses never freeze)',
    flavour: 'Fires a beam of cold white light.',
  },
  reactorRod: {
    id: 'reactorRod', name: 'Reactor Rod', pool: 'main', cls: 'force', base: { type: 'weapon', kind: 'rod' },
    effect: 'Each attack cast within 1.5 s of the last is 30% stronger, up to ×2',
    cost: 'Techniques cost 3× TP',
    flavour: "A control rod from the Mines' core, run past its limits.",
  },
  falzHalo: {
    id: 'falzHalo', name: 'Falz Halo', pool: 'rift', base: { type: 'armor', slot: 'barrier' },
    effect: 'Each Corruption stack adds 10% damage',
    cost: "Corruption doesn't wear off and pylon light doesn't shed it (a cleared room or Pioneer 2 still does)",
    flavour: "The Angel's halo, torn loose in the rifts.",
  },
  redRing: {
    id: 'redRing', name: 'Red Ring', pool: 'rift', base: { type: 'armor', slot: 'barrier' },
    effect: 'Crit damage +100%',
    cost: 'Corruption resistance −50%',
    flavour: 'A crimson ring of photon plating. It burns to wear.',
  },
  overclockCore: {
    id: 'overclockCore', name: 'Overclock Core', pool: 'rift', base: { type: 'armor', slot: 'frame' },
    effect: 'Haste from gear counts double',
    cost: 'Max HP −50%',
    flavour: "The Warden's reactor, strapped to your chest and run hot.",
  },
};

/** The item id of `unique` at gear tier `tier` (1-15): every tier exists, the drop picks one. */
export const uniqueItemId = (id: UniqueId, tier: number): string => `unique_${id}_${tier}`;
