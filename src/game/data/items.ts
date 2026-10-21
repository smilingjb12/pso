import type { AttackTiming } from '../config';
import type { AffixRoll } from './itemAffixes';
import type { StatBonus, StatKey } from './stats';
import { UNIQUES, uniqueItemId, uniqueUnitId, type UniqueId } from './uniques';

/** Normal (white, no affixes), magic (blue, 1-2), rare (yellow, 3-6) and unique (purple, a fixed set). */
export type Rarity = 'normal' | 'magic' | 'rare' | 'unique';
export const RARITY_LABEL: Record<Rarity, string> = { normal: 'Normal', magic: 'Magic', rare: 'Rare', unique: 'Unique' };

/**
 * Grind levels a weapon, frame or barrier counts as having: 5 at tiers 1-2 up to 12 at tier 15, uniques 2 more.
 * Every item is fully ground since grinders went (2026-10-11; `grindLevels` in character.ts).
 */
export function grindCap(def: { tier: number; rare?: boolean }): number {
  return 4 + Math.ceil(def.tier / 2) + (def.rare ? 2 : 0);
}

// Weapon specials (Heat, Ice, Shock...) went on 2026-10-21: they rolled on weapon hits only, which a caster never makes.

// ------------------------------------------------------------- weapon kinds

// Two kinds since 2026-10-21 (the classes went: one caster for everyone, the user's call). Eight until then, twelve
// until 2026-10-14. Old weapons become a Rod (blades, and the Cane) or a Wand (guns) of the same tier on load.
export type WeaponKind = 'rod' | 'wand';

/** Kinds that went (2026-10-14, 2026-10-21), and the kind a saved one becomes (same tier; affixes that no longer fit reroll). */
export const RETIRED_KINDS: Record<string, WeaponKind> = {
  saber: 'rod', sword: 'rod', dagger: 'rod', partisan: 'rod', cane: 'rod',
  handgun: 'wand', rifle: 'wand', shot: 'wand', mechgun: 'wand', slicer: 'wand',
};

export interface WeaponKindDef {
  kind: WeaponKind;
  label: string;
  /** The basic chain's rhythm: one photon bolt a step. */
  timing: AttackTiming;
  /** Technique power multiplier while equipped. */
  techBoost: number;
  /** TP a landed basic step refills, times the usual (the Wand refills more, the Rod less). */
  tpRefill: number;
  /** A photon bolt deals this many times your tech damage (with the kind's technique boost). */
  boltPower: number;
  color: number;
}

// Each kind wins one thing (the rhythm feel too: the wand gets a tight perfect window and short grace, the rod wide
// ones):
// - Rod: the pure caster's weapon (the biggest technique boost) and a heavy, slow bolt.
// - Wand: less boost, quick bolts that refill more TP.
export const weaponKinds: Record<WeaponKind, WeaponKindDef> = {
  rod: {
    kind: 'rod', label: 'Rod',
    timing: { windup: 0.3, active: 0.12, recovery: 0.62, perfect: 0.14, grace: 0.26 }, techBoost: 1.2, tpRefill: 1.5, boltPower: 0.9, color: 0xb080ff,
  },
  wand: {
    kind: 'wand', label: 'Wand',
    timing: { windup: 0.15, active: 0.08, recovery: 0.42, perfect: 0.08, grace: 0.14 }, techBoost: 1.1, tpRefill: 2.2, boltPower: 0.55, color: 0xff90e0,
  },
};

/** Bare hands: a weak bolt at the wand's pace, no technique boost. */
export const BARE_KIND: WeaponKindDef = {
  kind: 'wand', label: 'Bare hands', timing: weaponKinds.wand.timing, techBoost: 1, tpRefill: 1, boltPower: 0.4, color: 0xffffff,
};

// --------------------------------------------------------------- armor lines

/**
 * Armour lines: one since 2026-10-21 (the user's pick when the classes went), Psy, plus the plain starter pieces.
 * Guard and Combat (weapon damage) became Psy of the same tier on load.
 */
export type ArmorLine = 'basic' | 'psy';

export interface ArmorLineDef {
  line: ArmorLine;
  label: string;
  desc: string;
}

export const armorLines: Record<ArmorLine, ArmorLineDef> = {
  basic: { line: 'basic', label: 'Standard', desc: 'Plain protection.' },
  psy: { line: 'psy', label: 'Psy', desc: 'A light weave: tech damage and TP.' },
};

/** Lines that went on 2026-10-21; a saved piece becomes Psy of the same tier. */
export const RETIRED_LINES = ['guard', 'combat'];

// --------------------------------------------------------------- item defs

interface BaseDef {
  id: string;
  name: string;
  price: number;
  /** A unique: a fixed name and affixes (it never rolls). */
  rare?: boolean;
  desc?: string;
  /** A unique's fixed affixes (numbers only, like every affix). */
  fixed?: AffixRoll[];
  /** A unique: which one (its effect lives in code, see data/uniques.ts). */
  unique?: UniqueId;
  /** A unique frame's unit slots. */
  slots?: number;
}

export interface WeaponItemDef extends BaseDef {
  type: 'weapon';
  kind: WeaponKind;
  tier: number;
  /** Character level needed to equip it (0 = none). */
  req: number;
  /** Flat stats while equipped: its Tech damage (the built-in Edge grind raises it too). */
  bonus: StatBonus;
}

export interface ArmorItemDef extends BaseDef {
  type: 'armor';
  slot: 'frame' | 'barrier';
  line: ArmorLine;
  tier: number;
  /** % less damage taken while worn, strike and area alike. */
  dr: number;
  /** Flat stats on top (the line's specialty). */
  bonus?: StatBonus;
  /** Character level needed to equip it (0 = none). */
  req: number;
}

/** What a consumable does. None are left since the Telepipe went (2026-10-11, the user's call); the type stays for new ones. */
export type ConsumableEffect = never;

export interface ConsumableItemDef extends BaseDef {
  type: 'consumable';
  effect: ConsumableEffect;
  /** Only usable outside of the city. */
  fieldOnly?: boolean;
  /** Most you can carry (default MAX_STACK). */
  maxStack?: number;
}

/**
 * Photon crafting items (2026-10-11, replacing grinding's race picks; three since 2026-10-13, the user's redesign):
 * each works on one active affix of a weapon or armour piece, as often as you have photons. Drop (common): reroll
 * its value in its strength tier. Sphere (rare): a strength tier up. Crystal (very rare): swap it for one of the
 * item's dormant affixes of the same kind. Null Photons and Augment Cores went (old ones turn into Spheres and Crystals).
 */
export type CraftId = 'drop' | 'sphere' | 'crystal';

export interface PhotonItemDef extends BaseDef {
  type: 'photon';
  craft: CraftId;
}

/**
 * Most photons of one kind you carry (they come in from salvage too). Photons are a crafting currency
 * (2026-10-12, the user's call): picked up by walking over them, a stack of each kind that takes no bag space.
 */
export const PHOTON_STACK = 100;

// ---------------------------------------------------------------- injectors

/** Mate injectors restore HP, Fluid injectors TP. */
export type InjectorKind = 'mate' | 'fluid';

/**
 * Injectors replace stacks of mates and fluids. Each holds a few doses; a dose restores a share of
 * the max gauge. Doses refill from damage dealt to enemies, and in full after a fight. Higher tiers need a level.
 */
export interface InjectorItemDef extends BaseDef {
  type: 'injector';
  kind: InjectorKind;
  tier: number;
  doses: number;
  /** Fraction of the max gauge one dose restores. */
  potency: number;
  req: number;
}

/** One rolled property on an injector. */
export type InjectorMod = 'steady' | 'emergency' | 'reserve' | 'absorbent' | 'sol' | 'bracing';

export const INJECTOR_MODS: Record<InjectorMod, { name: string; desc: string }> = {
  steady: { name: 'Steady', desc: 'Restores over 4 s instead of at once, but 60% more in total.' },
  emergency: { name: 'Emergency', desc: 'Restores 60% more while that gauge is below 35%.' },
  reserve: { name: 'Reserve', desc: 'Holds 4 doses instead of 3.' },
  absorbent: { name: 'Absorbent', desc: 'Refills 50% faster.' },
  sol: { name: 'Sol', desc: 'Each dose also cures poison, paralysis and Burn, and wards off paralysis for 4 s. Usable while paralysed.' },
  bracing: { name: 'Bracing', desc: 'Each dose also cuts damage taken by 30% for 3 s.' },
};

/** A unit: one affix, learned into the Mag (PSO's units); the frame's unit slots activate them. Its tier sets the affix's item level. */
export interface UnitItemDef extends BaseDef {
  type: 'unit';
  tier: number;
}

export type ItemDef = WeaponItemDef | ArmorItemDef | ConsumableItemDef | PhotonItemDef | InjectorItemDef | UnitItemDef;

export const MAX_STACK = 10;
export const INVENTORY_SIZE = 30;

const TIER_NAMES: Record<WeaponKind, string[]> = {
  rod: ['Rod', 'Pole', 'Pillar', 'Striker', 'Obelisk', 'Monolith', 'Spire', 'Zenith Rod', 'Eternal Pillar', 'Sky Pillar', 'Axis Rod', 'World Pillar', 'Eclipse Rod', 'Infinity Pillar', 'Omega Rod'],
  wand: ['Wand', 'Staff', 'Baton', 'Scepter', 'Diadem', 'Aurora Staff', 'Celestial Staff', 'Starlight Wand', 'Halo Scepter', 'Seraph Staff', 'Empyrean Wand', 'Archon Staff', 'Eclipse Wand', 'Ascension Staff', 'Omega Wand'],
};

/** Tier-1 Tech damage bonus of each kind; scales with TIER_MULT. */
const KIND_MST: Record<WeaponKind, number> = { wand: 6, rod: 8 };

// Tier 5 drops in the Caves (shops stock it after De Rol Le), tier 6 in the Mines (shops after the Warden), tier 7
// in the Ruins (shops after Dark Falz). Tiers 8-11 drop on Nightmare (Forest, Caves, Mines, Ruins), tiers 12-15 on
// Hell.
const TIER_MULT = [1, 1.7, 2.5, 3.4, 4.4, 5.5, 6.7, 8.0, 9.4, 10.9, 12.5, 14.2, 16.0, 17.9, 19.9];
const TIER_PRICE = [250, 900, 2800, 7500, 16000, 30000, 50000, 80000, 120000, 170000, 230000, 300000, 380000, 470000, 570000];
/**
 * Level needed to equip an item of each tier: about where its expedition's band starts, so the gear of the area you
 * are in can be worn (T7 the Ruins at Lv 32, T8 Nightmare at 42, T11 the Nightmare Ruins at 72, T12-15 just under
 * the Hell bands). Requirements are levels only since 2026-10-14: they were stats (with Mag points counting), which
 * would have read "Needs Crit 9%".
 */
export const TIER_LEVEL = [0, 3, 7, 12, 18, 24, 32, 42, 52, 62, 72, 80, 84, 89, 93];

export const itemDefs: Record<string, ItemDef> = {};

function add(def: ItemDef): void {
  itemDefs[def.id] = def;
}

for (const kind of Object.keys(TIER_NAMES) as WeaponKind[]) {
  TIER_NAMES[kind].forEach((name, i) => {
    add({
      id: `${kind}_${i + 1}`,
      type: 'weapon',
      name,
      kind,
      tier: i + 1,
      req: TIER_LEVEL[i],
      bonus: { mst: Math.round(KIND_MST[kind] * TIER_MULT[i]) },
      price: TIER_PRICE[i],
    });
  });
}

// Armor: a neutral starter (tier 1 only) plus the Psy line, one piece a tier. Each piece cuts damage taken by a share
// (strike and area alike), growing a little a tier (2026-10-14, replacing DFP). The Guard and Combat lines (weapon
// damage) went with the classes on 2026-10-21.
add({ id: 'frame_1', type: 'armor', slot: 'frame', line: 'basic', name: 'Frame', tier: 1, dr: 4, req: 0, price: 200 });
add({ id: 'barrier_1', type: 'armor', slot: 'barrier', line: 'basic', name: 'Barrier', tier: 1, dr: 3, req: 0, price: 200 });

/** % less damage taken at tier 1 and per tier after (frame, barrier). */
const PSY_DR: Record<'frame' | 'barrier', [number, number]> = { frame: [3, 0.55], barrier: [2, 0.5] };

/** A Psy frame or barrier's % less damage taken at `tier`. */
export function lineDr(slot: 'frame' | 'barrier', tier: number): number {
  const [at1, per] = PSY_DR[slot];
  return Math.round(at1 + per * (tier - 1));
}

/** A tier of the line: its flat bonuses written inline (they become the item's `bonus`). */
type ArmorRow = { name: string } & Partial<Record<StatKey, number>>;
const ARMOR_TABLE: Record<'frame' | 'barrier', ArmorRow[]> = {
  frame: [
    { name: 'Psy Frame', mst: 6, tp: 5 },
    { name: 'Psy Armor', mst: 12, tp: 10 },
    { name: 'Mind Armor', mst: 19, tp: 16 },
    { name: 'Psycho Frame', mst: 28, tp: 25 },
    { name: 'Spirit Garment', mst: 39, tp: 36 },
    { name: 'Astral Garment', mst: 52, tp: 48 },
    { name: 'Ethereal Garment', mst: 66, tp: 61 },
    { name: 'Celestial Garment', mst: 81, tp: 75 },
    { name: 'Divine Garment', mst: 97, tp: 90 },
    { name: 'Seraphic Garment', mst: 114, tp: 106 },
    { name: 'Empyrean Garment', mst: 132, tp: 123 },
    { name: 'Oracle Garment', mst: 151, tp: 141 },
    { name: 'Ascendant Garment', mst: 171, tp: 160 },
    { name: 'Eternal Garment', mst: 192, tp: 180 },
    { name: 'Archon Garment', mst: 214, tp: 201 },
  ],
  barrier: [
    { name: 'Psy Barrier', mst: 4, tp: 3 },
    { name: 'Psy Shield', mst: 8, tp: 6 },
    { name: 'Mind Shield', mst: 12, tp: 10 },
    { name: 'Psycho Shield', mst: 18, tp: 15 },
    { name: 'Spirit Shield', mst: 25, tp: 21 },
    { name: 'Astral Shield', mst: 33, tp: 28 },
    { name: 'Ethereal Shield', mst: 42, tp: 36 },
    { name: 'Celestial Shield', mst: 52, tp: 45 },
    { name: 'Divine Shield', mst: 63, tp: 55 },
    { name: 'Seraphic Shield', mst: 75, tp: 66 },
    { name: 'Empyrean Shield', mst: 88, tp: 78 },
    { name: 'Oracle Shield', mst: 102, tp: 91 },
    { name: 'Ascendant Shield', mst: 117, tp: 105 },
    { name: 'Eternal Shield', mst: 133, tp: 120 },
    { name: 'Archon Shield', mst: 150, tp: 136 },
  ],
};
const ARMOR_PRICE = [250, 800, 2400, 6500, 14000, 28000, 45000, 70000, 100000, 135000, 180000, 230000, 290000, 360000, 440000];
for (const slot of ['frame', 'barrier'] as const) {
  ARMOR_TABLE[slot].forEach(({ name, ...bonus }, i) =>
    add({
      id: `${slot}_psy_${i + 1}`, type: 'armor', slot, line: 'psy', tier: i + 1, name, dr: lineDr(slot, i + 1), bonus,
      req: TIER_LEVEL[i], price: ARMOR_PRICE[i],
    }),
  );
}
// Tier 6 standard barrier: weaker than the line, but with no requirement.
add({ id: 'barrier_6', type: 'armor', slot: 'barrier', line: 'basic', name: 'Photon Barrier', tier: 6,
  dr: 9, req: 0, price: 24000, desc: 'A plain photon barrier anyone can wear.' });

// Uniques (data/uniques.ts): every tier of each, so a drop carries the base stats of the tier it dropped at.
// Weapons have their kind's stats at that tier (and its requirement); armour no requirement and more damage taken off
// than Psy (where the old Guard and Combat lines met), with no line bonus: the unique effect is the point.
for (const u of Object.values(UNIQUES)) {
  if (u.base.type === 'unit') {
    // A unique unit: one def (no base stats), learned into the Mag on pickup.
    add({ id: uniqueUnitId(u.id), type: 'unit', name: u.name, tier: 15, rare: true, unique: u.id, desc: u.flavour, price: 90000 });
    continue;
  }
  for (let tier = 1; tier <= TIER_PRICE.length; tier++) {
    const id = uniqueItemId(u.id, tier);
    const common = { id, name: u.name, tier, rare: true, unique: u.id, desc: u.flavour, price: TIER_PRICE[tier - 1] };
    if (u.base.type === 'weapon') {
      const base = itemDefs[`${u.base.kind}_${tier}`] as WeaponItemDef;
      add({ ...common, type: 'weapon', kind: u.base.kind, req: base.req, bonus: { ...base.bonus } });
    } else {
      const dr = uniqueDr(u.base.slot, tier);
      add({ ...common, type: 'armor', slot: u.base.slot, line: 'basic', dr, req: 0, ...(u.base.slot === 'frame' ? { slots: 2 } : {}) });
    }
  }
}

/** A unique frame or barrier's % less damage taken: between the old Guard and Combat lines (rounded as they were). */
function uniqueDr(slot: 'frame' | 'barrier', tier: number): number {
  const [guard, combat] = slot === 'frame' ? [[5, 1.15], [4, 0.75]] : [[4, 1], [3, 0.65]];
  const at = ([a, per]: number[]) => Math.round(a + per * (tier - 1));
  return Math.round((at(guard) + at(combat)) / 2);
}

/** Every injector holds this many doses; tiers differ in how much a dose restores. */
export const INJECTOR_DOSES = 3;
// Fluid restores a smaller share: TP pools grow faster than HP, and techniques are your healing too (Resta).
// Tier 6 drops only on Hard (bosses and champions).
// Every tier restores at least 35% (2026-10-09: the starting 30% ran dry early on; Caves-on tiers felt right).
const INJECTOR_POTENCY: Record<InjectorKind, number[]> = { mate: [0.35, 0.35, 0.36, 0.39, 0.42, 0.47], fluid: [0.35, 0.35, 0.35, 0.35, 0.36, 0.38] };
const INJECTOR_NAMES: Record<InjectorKind, string[]> = {
  mate: ['Mate Injector', 'Dimate Injector', 'Hi-Mate Injector', 'Star Mate Injector', 'Grand Mate Injector', 'Prime Mate Injector'],
  fluid: ['Fluid Injector', 'Difluid Injector', 'Hi-Fluid Injector', 'Star Fluid Injector', 'Grand Fluid Injector', 'Prime Fluid Injector'],
};
/** Level needed per tier (it was DFP for Mate and MST for Fluid, which builds for them reached about here). Tier 6 drops on Nightmare only. */
export const INJECTOR_REQ: Record<InjectorKind, number[]> = { mate: [0, 0, 7, 15, 24, 42], fluid: [0, 0, 7, 15, 24, 42] };
const INJECTOR_PRICE = [300, 1200, 3500, 8000, 16000, 32000];
for (const kind of ['mate', 'fluid'] as const) {
  INJECTOR_POTENCY[kind].forEach((potency, i) =>
    add({ id: `${kind}_${i + 1}`, type: 'injector', kind, tier: i + 1, name: INJECTOR_NAMES[kind][i], doses: INJECTOR_DOSES, potency, req: INJECTOR_REQ[kind][i], price: INJECTOR_PRICE[i] }),
  );
}


// Photons: crafting on weapons and armour (not uniques), one active affix at a time.
add({ id: 'photon_drop', type: 'photon', craft: 'drop', name: 'Photon Drop', price: 1200,
  desc: 'Rerolls the value of one affix, within its strength tier.' });
add({ id: 'photon_sphere', type: 'photon', craft: 'sphere', name: 'Photon Sphere', price: 6000,
  desc: "Raises one affix a strength tier, up to the best its item level allows." });
add({ id: 'photon_crystal', type: 'photon', craft: 'crystal', name: 'Photon Crystal', price: 20000,
  desc: "Swaps one active affix for one of the item's dormant ones (a prefix for a prefix, a suffix for a suffix). The one swapped out goes dormant, roll and all." });

// Units: one def per tier (the affix inside is rolled per drop).
const UNIT_PRICE = [400, 900, 1800, 3200, 5200, 8000, 12000, 17000, 23000, 30000, 38000, 47000, 57000, 68000, 80000];
UNIT_PRICE.forEach((price, i) => add({ id: `unit_${i + 1}`, type: 'unit', name: 'Unit', tier: i + 1, price, desc: 'Learned when picked up: your Mag keeps the best of each kind for good (Mag tab, Units). One affix each.' }));

export function getDef(id: string): ItemDef {
  const d = itemDefs[id];
  if (!d) throw new Error(`Unknown item: ${id}`);
  return d;
}
