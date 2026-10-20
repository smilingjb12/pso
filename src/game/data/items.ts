import type { AttackTiming, WeaponWeight } from '../config';
import type { AffixRoll } from './itemAffixes';
import type { StatBonus, StatKey, WeaponFamily } from './stats';
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

// ------------------------------------------------------------------ specials

export type SpecialId = 'heat' | 'ice' | 'shock' | 'draw' | 'dim' | 'venom';

export interface SpecialDef {
  id: SpecialId;
  name: string;
  /** Chance per heavy hit (specials only roll on heavy attacks). */
  procChance: number;
  effect: 'burn' | 'freeze' | 'stun' | 'drain' | 'instakill' | 'poison';
  /** burn: dps; poison: fraction of max HP per second; freeze/stun: seconds; drain: % of damage healed; instakill: unused. */
  power: number;
  duration: number;
}

export const specials: Record<SpecialId, SpecialDef> = {
  heat: { id: 'heat', name: 'Heat', procChance: 0.3, effect: 'burn', power: 39, duration: 3 },
  ice: { id: 'ice', name: 'Ice', procChance: 0.2, effect: 'freeze', power: 0, duration: 2.5 },
  shock: { id: 'shock', name: 'Shock', procChance: 0.25, effect: 'stun', power: 0, duration: 1.4 },
  draw: { id: 'draw', name: 'Draw', procChance: 0.5, effect: 'drain', power: 0.045, duration: 0 },
  dim: { id: 'dim', name: 'Dim', procChance: 0.07, effect: 'instakill', power: 0, duration: 0 },
  // Poison scales with the target's max HP (capped for bosses), so it shines on tough enemies.
  venom: { id: 'venom', name: 'Venom', procChance: 0.3, effect: 'poison', power: 0.04, duration: 5 },
};

// ------------------------------------------------------------- weapon kinds

// Eight kinds since 2026-10-14 (the user's call, trimming twelve): the Partisan, Mechgun, Slicer and Cane went, each
// beaten on every measure by a kind of its own class (Sword, Handgun, Rifle, Rod). Old ones become those on load.
export type WeaponKind =
  | 'saber'
  | 'sword'
  | 'dagger'
  | 'handgun'
  | 'rifle'
  | 'shot'
  | 'rod'
  | 'wand';

/** Kinds that went on 2026-10-14, and the kind a saved one becomes (same tier and affixes). */
export const RETIRED_KINDS: Record<string, WeaponKind> = { partisan: 'sword', mechgun: 'handgun', slicer: 'rifle', cane: 'rod' };

export interface WeaponKindDef {
  kind: WeaponKind;
  label: string;
  ranged: boolean;
  /** Melee reach, or projectile max range for guns. */
  range: number;
  // The light (area) attack's shape. Heavy is always single target: one swing at the aimed
  // enemy, or one homing shot.
  /** Light melee: sweep arc in degrees. */
  arcDeg: number;
  /** Light: most enemies one attack can hit (each is hit once). */
  maxTargets: number;
  /** Damage instances per swing, light and heavy (daggers hit twice). */
  hits: number;
  /** Light ranged: projectiles per shot, fanned over spreadDeg (use odd counts so one flies straight). */
  projectiles: number;
  projSpeed: number;
  spreadDeg?: number;
  /** Light ranged: one projectile flies straight through up to maxTargets enemies (rifles). */
  pierce?: boolean;
  /** Ranged: distance where damage starts falling off (defaults to rangedFalloff.start). */
  falloffStart?: number;
  /** Per-hit damage multiplier (daggers' double hits are weaker each). */
  damageScale: number;
  timing: AttackTiming;
  /** Technique power multiplier while equipped. */
  techBoost: number;
  /** TP a landed basic step refills, times the usual (casters: the Wand refills more, the Rod less). */
  tpRefill?: number;
  /** Casters: a photon bolt deals this many times your tech damage (with the kind's technique boost). */
  boltPower?: number;
  /** Melee weight class (config weaponWeights): heavy kinds stagger more, lunge further and have Poise. */
  weight?: WeaponWeight;
  /** What it fights with: melee, guns, or techniques (rods, wands). Talents follow it. */
  family: WeaponFamily;
  color: number;
}

// Attack speed comes from the weapon class, as in PSO. The chained-hit rhythm is
// roughly combo.windowOpen (0.55) x swing length: handgun/dagger ~0.30s,
// wand ~0.36s, saber ~0.40s, rod ~0.57s, sword ~0.58s, shot ~0.60s, rifle ~0.65s.
// Each class has kinds that each win one thing (2026-10-14):
// - Hunter, one per weight class: dagger (light) the most single-target damage, saber (medium)
//   in between and the quickest to commit, sword (heavy) the most on packs. Heavy swings take
//   ~1.4x a saber's but hit harder per blow, stagger double and carry Poise (config weaponWeights).
// - Ranger: handgun fast and single target, rifle long range through a line, shot a close fan for packs.
// - Force: the rod is the pure caster's weapon (biggest technique boost); the wand trades boost for
//   fast swings that refill TP.
// Each kind also has a rhythm feel: quick kinds (dagger, wand, handgun) get a tight perfect
// window and short grace, slow kinds (sword, rod, rifle) wide ones. The saber uses the combo defaults.
// Every kind's light attack hits an area; the kind sets its shape: sword and rod sweep widest,
// rifles pierce, shots spread widest, daggers stay tight.
export const weaponKinds: Record<WeaponKind, WeaponKindDef> = {
  saber: {
    kind: 'saber', label: 'Saber', ranged: false,
    range: 2.4, arcDeg: 110, maxTargets: 3, hits: 1, projectiles: 0, projSpeed: 0, damageScale: 1.04,
    timing: { windup: 0.17, active: 0.09, recovery: 0.47 }, techBoost: 1, weight: 'medium', family: 'melee', color: 0x3aa0ff,
  },
  sword: {
    kind: 'sword', label: 'Sword', ranged: false,
    range: 3.0, arcDeg: 160, maxTargets: 4, hits: 1, projectiles: 0, projSpeed: 0, damageScale: 0.95,
    timing: { windup: 0.32, active: 0.12, recovery: 0.62, perfect: 0.15, grace: 0.26 }, techBoost: 1, weight: 'heavy', family: 'melee', color: 0x9fffc0,
  },
  dagger: {
    kind: 'dagger', label: 'Dagger', ranged: false,
    range: 2.0, arcDeg: 90, maxTargets: 2, hits: 2, projectiles: 0, projSpeed: 0, damageScale: 0.6,
    timing: { windup: 0.12, active: 0.1, recovery: 0.33, perfect: 0.065, grace: 0.12 }, techBoost: 1, weight: 'light', family: 'melee', color: 0xffe070,
  },
  handgun: {
    kind: 'handgun', label: 'Handgun', ranged: true,
    range: 16, arcDeg: 0, maxTargets: 2, hits: 1, projectiles: 3, projSpeed: 28, spreadDeg: 18, damageScale: 1,
    timing: { windup: 0.12, active: 0.05, recovery: 0.38, perfect: 0.085, grace: 0.15 }, techBoost: 1, family: 'ranged', color: 0xffc040,
  },
  rifle: {
    kind: 'rifle', label: 'Rifle', ranged: true,
    range: 26, arcDeg: 0, maxTargets: 4, hits: 1, projectiles: 1, projSpeed: 41, pierce: true, damageScale: 1, falloffStart: 18,
    timing: { windup: 0.36, active: 0.06, recovery: 0.76, perfect: 0.13, grace: 0.24 }, techBoost: 1, family: 'ranged', color: 0xff8040,
  },
  shot: {
    kind: 'shot', label: 'Shot', ranged: true,
    range: 11, arcDeg: 0, maxTargets: 5, hits: 1, projectiles: 5, projSpeed: 26, spreadDeg: 36, damageScale: 1,
    timing: { windup: 0.26, active: 0.06, recovery: 0.78, perfect: 0.12, grace: 0.22 }, techBoost: 1, family: 'ranged', color: 0x90ff60,
  },
  rod: {
    kind: 'rod', label: 'Rod', ranged: false,
    range: 2.8, arcDeg: 150, maxTargets: 4, hits: 1, projectiles: 0, projSpeed: 0, damageScale: 1.1,
    timing: { windup: 0.3, active: 0.12, recovery: 0.62, perfect: 0.14, grace: 0.26 }, techBoost: 1.2, tpRefill: 1.5, boltPower: 0.9, weight: 'heavy', family: 'caster', color: 0xb080ff,
  },
  wand: {
    kind: 'wand', label: 'Wand', ranged: false,
    range: 2.2, arcDeg: 100, maxTargets: 2, hits: 1, projectiles: 0, projSpeed: 0, damageScale: 1,
    timing: { windup: 0.15, active: 0.08, recovery: 0.42, perfect: 0.08, grace: 0.14 }, techBoost: 1.1, tpRefill: 2.2, boltPower: 0.55, weight: 'light', family: 'caster', color: 0xff90e0,
  },
};

/** A kind's family: guns are ranged, rods and wands caster, the rest melee. Talents follow it. */
export function kindFamily(kind: WeaponKindDef): WeaponFamily {
  return kind.family;
}

// --------------------------------------------------------------- armor lines

export type ArmorLine = 'basic' | 'guard' | 'combat' | 'psy';

/** Armor lines: anyone of the level can wear any of them (2026-10-14); each leans to one class's way of fighting. */
export interface ArmorLineDef {
  line: ArmorLine;
  label: string;
  desc: string;
}

export const armorLines: Record<ArmorLine, ArmorLineDef> = {
  basic: { line: 'basic', label: 'Standard', desc: 'Plain protection.' },
  guard: { line: 'guard', label: 'Guard', desc: 'Heavy plating: the least damage taken, a little weapon damage.' },
  combat: { line: 'combat', label: 'Combat', desc: 'Light plating with the most weapon damage, plus crit chance.' },
  psy: { line: 'psy', label: 'Psy', desc: 'A light weave: tech damage and TP, more damage taken.' },
};

// --------------------------------------------------------------- item defs

interface BaseDef {
  id: string;
  name: string;
  price: number;
  /** A unique: a fixed name, special and affixes (it never rolls). */
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
  atpMin: number;
  atpMax: number;
  /** Character level needed to equip it (0 = none). */
  req: number;
  special?: SpecialId;
  /** Flat stats while equipped (MST on rods and wands; the built-in Edge grind raises an MST bonus too). */
  bonus?: StatBonus;
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

/** One rolled property on an injector (like a weapon special). */
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
  saber: ['Saber', 'Brand', 'Buster', 'Pallasch', 'Gladius', 'Galatine', 'Astra Saber', 'Nova Blade', 'Stellar Saber', 'Quasar Saber', 'Cosmic Saber', 'Galaxy Saber', 'Eclipse Saber', 'Infinity Saber', 'Omega Saber'],
  sword: ['Sword', 'Gigush', 'Breaker', 'Claymore', 'Calibur', 'Zanbato', 'Titan Cleaver', 'Meteor Sword', 'Colossus', 'Behemoth', 'Worldsplitter', 'Titanomachy', 'Ragnarok Blade', 'Apocalypse', 'Omega Cleaver'],
  dagger: ['Dagger', 'Knife', 'Blade', 'Edge', 'Ripper', 'Vibro Edge', 'Nebula Fang', 'Phase Knife', 'Void Stiletto', 'Rift Dagger', 'Horizon Fang', 'Abyss Fang', 'Eclipse Dagger', 'Oblivion Edge', 'Omega Fang'],
  handgun: ['Handgun', 'Autogun', 'Lockgun', 'Railgun', 'Raygun', 'Hypergun', 'Plasma Pistol', 'Ion Gun', 'Pulsar Gun', 'Quasar Gun', 'Nova Pistol', 'Magnetar Gun', 'Eclipse Pistol', 'Infinity Gun', 'Omega Pistol'],
  rifle: ['Rifle', 'Sniper', 'Blaster', 'Beam', 'Laser', 'Photon Lancer', 'Ion Rifle', 'Meteor Beam', 'Horizon Rifle', 'Zenith Beam', 'Infinity Rifle', 'Gamma Ray', 'Eclipse Beam', 'Starfall Rifle', 'Omega Rifle'],
  shot: ['Shot', 'Spread', 'Cannon', 'Arms', 'Launcher', 'Hyper Cannon', 'Nova Cannon', 'Supernova', 'Starburst', 'Hypernova', 'Big Bang', 'Hyperion', 'Eclipse Cannon', 'Infinity Cannon', 'Omega Cannon'],
  rod: ['Rod', 'Pole', 'Pillar', 'Striker', 'Obelisk', 'Monolith', 'Spire', 'Zenith Rod', 'Eternal Pillar', 'Sky Pillar', 'Axis Rod', 'World Pillar', 'Eclipse Rod', 'Infinity Pillar', 'Omega Rod'],
  wand: ['Wand', 'Staff', 'Baton', 'Scepter', 'Diadem', 'Aurora Staff', 'Celestial Staff', 'Starlight Wand', 'Halo Scepter', 'Seraph Staff', 'Empyrean Wand', 'Archon Staff', 'Eclipse Wand', 'Ascension Staff', 'Omega Wand'],
};

/** Tier-1 base [atpMin, atpMax] for each kind. */
const KIND_BASE: Record<WeaponKind, [number, number]> = {
  saber: [40, 55],
  sword: [70, 90],
  dagger: [25, 40],
  handgun: [30, 40],
  rifle: [45, 60],
  shot: [32, 44],
  rod: [35, 45],
  wand: [20, 30],
};

/** Tier-1 MST bonus for the caster kinds; scales with TIER_ATP. */
const KIND_MST: Partial<Record<WeaponKind, number>> = { wand: 6, rod: 8 };

// Tier 5 drops in the Caves (shops stock it after De Rol Le), tier 6 in the Mines (shops after the Warden), tier 7
// in the Ruins (shops after Dark Falz). Tiers 8-11 drop on Nightmare (Forest, Caves, Mines, Ruins), tiers 12-15 on
// Hell.
const TIER_ATP = [1, 1.7, 2.5, 3.4, 4.4, 5.5, 6.7, 8.0, 9.4, 10.9, 12.5, 14.2, 16.0, 17.9, 19.9];
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
    const [mn, mx] = KIND_BASE[kind];
    const mst = KIND_MST[kind];
    add({
      id: `${kind}_${i + 1}`,
      type: 'weapon',
      name,
      kind,
      tier: i + 1,
      atpMin: Math.round(mn * TIER_ATP[i]),
      atpMax: Math.round(mx * TIER_ATP[i]),
      req: TIER_LEVEL[i],
      ...(mst ? { bonus: { mst: Math.round(mst * TIER_ATP[i]) } } : {}),
      price: TIER_PRICE[i],
    });
  });
}

// Armor: a neutral starter (tier 1 only) plus three lines per tier. Each piece cuts damage taken by a share (strike
// and area alike), growing a little a tier: Guard the most, Psy the least (2026-10-14, replacing DFP). Melee eats far
// more hits than ranged, so defense is worth more to a Hunter and offense more to a Ranger; each line should win for
// its own class only. Anyone of the tier's level can wear any line.
add({ id: 'frame_1', type: 'armor', slot: 'frame', line: 'basic', name: 'Frame', tier: 1, dr: 4, req: 0, price: 200 });
add({ id: 'barrier_1', type: 'armor', slot: 'barrier', line: 'basic', name: 'Barrier', tier: 1, dr: 3, req: 0, price: 200 });

/** % less damage taken at tier 1 and per tier after, by line (frame, barrier). */
const LINE_DR: Record<'frame' | 'barrier', Record<Exclude<ArmorLine, 'basic'>, [number, number]>> = {
  frame: { guard: [5, 1.15], combat: [4, 0.75], psy: [3, 0.55] },
  barrier: { guard: [4, 1], combat: [3, 0.65], psy: [2, 0.5] },
};

/** A frame or barrier's % less damage taken at `tier`. */
export function lineDr(slot: 'frame' | 'barrier', line: Exclude<ArmorLine, 'basic'>, tier: number): number {
  const [at1, per] = LINE_DR[slot][line];
  return Math.round(at1 + per * (tier - 1));
}

/** A line's tier: its flat bonuses written inline (they become the item's `bonus`). */
type ArmorRow = { name: string } & Partial<Record<StatKey, number>>;
const ARMOR_TABLE: Record<'frame' | 'barrier', Record<Exclude<ArmorLine, 'basic'>, ArmorRow[]>> = {
  frame: {
    guard: [
      { name: 'Guard Frame', atp: 1 },
      { name: 'Guard Armor', atp: 2 },
      { name: 'Hard Armor', atp: 3 },
      { name: 'Giga Frame', atp: 5 },
      { name: 'Crimson Coat', atp: 7 },
      { name: 'Bastion Frame', atp: 9 },
      { name: 'Fortress Frame', atp: 11 },
      { name: 'Citadel Armor', atp: 13 },
      { name: 'Aegis Frame', atp: 15 },
      { name: 'Bulwark Frame', atp: 17 },
      { name: 'Paragon Frame', atp: 19 },
      { name: 'Sovereign Frame', atp: 21 },
      { name: 'Dominion Plate', atp: 23 },
      { name: 'Eclipse Armor', atp: 25 },
      { name: 'Imperator Frame', atp: 27 },
    ],
    combat: [
      { name: 'Combat Frame', atp: 2, lck: 2 },
      { name: 'Combat Armor', atp: 5, lck: 4 },
      { name: 'Ranger Armor', atp: 8, lck: 6 },
      { name: 'Sniper Frame', atp: 12, lck: 8 },
      { name: 'Commander Frame', atp: 17, lck: 11 },
      { name: 'Vanguard Frame', atp: 23, lck: 14 },
      { name: 'Paladin Frame', atp: 29, lck: 17 },
      { name: 'Sentinel Frame', atp: 36, lck: 20 },
      { name: 'Warlord Frame', atp: 43, lck: 23 },
      { name: 'Champion Frame', atp: 50, lck: 26 },
      { name: 'Legend Frame', atp: 58, lck: 29 },
      { name: 'Phantom Frame', atp: 66, lck: 32 },
      { name: 'Valkyrie Frame', atp: 75, lck: 35 },
      { name: 'Inferno Frame', atp: 84, lck: 38 },
      { name: 'Phoenix Frame', atp: 94, lck: 41 },
    ],
    psy: [
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
  },
  barrier: {
    guard: [
      { name: 'Guard Barrier', atp: 1 },
      { name: 'Guard Shield', atp: 1 },
      { name: 'Hard Shield', atp: 2 },
      { name: 'Giga Shield', atp: 3 },
      { name: 'Soul Barrier', atp: 4 },
      { name: 'Bastion Shield', atp: 5 },
      { name: 'Fortress Shield', atp: 6 },
      { name: 'Citadel Shield', atp: 7 },
      { name: 'Aegis Shield', atp: 8 },
      { name: 'Bulwark Shield', atp: 9 },
      { name: 'Paragon Shield', atp: 10 },
      { name: 'Sovereign Shield', atp: 11 },
      { name: 'Dominion Shield', atp: 12 },
      { name: 'Eclipse Shield', atp: 13 },
      { name: 'Imperator Shield', atp: 14 },
    ],
    combat: [
      { name: 'Combat Barrier', atp: 1, lck: 1 },
      { name: 'Combat Shield', atp: 3, lck: 3 },
      { name: 'Ranger Shield', atp: 5, lck: 4 },
      { name: 'Sniper Shield', atp: 8, lck: 6 },
      { name: 'Commander Shield', atp: 11, lck: 8 },
      { name: 'Vanguard Shield', atp: 15, lck: 10 },
      { name: 'Paladin Shield', atp: 19, lck: 12 },
      { name: 'Sentinel Shield', atp: 23, lck: 14 },
      { name: 'Warlord Shield', atp: 28, lck: 16 },
      { name: 'Champion Shield', atp: 33, lck: 18 },
      { name: 'Legend Shield', atp: 38, lck: 20 },
      { name: 'Phantom Shield', atp: 43, lck: 22 },
      { name: 'Valkyrie Shield', atp: 49, lck: 24 },
      { name: 'Inferno Shield', atp: 55, lck: 26 },
      { name: 'Phoenix Shield', atp: 61, lck: 28 },
    ],
    psy: [
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
  },
};
const ARMOR_PRICE = [250, 800, 2400, 6500, 14000, 28000, 45000, 70000, 100000, 135000, 180000, 230000, 290000, 360000, 440000];
for (const slot of ['frame', 'barrier'] as const) {
  for (const line of ['guard', 'combat', 'psy'] as const) {
    ARMOR_TABLE[slot][line].forEach(({ name, ...bonus }, i) =>
      add({
        id: `${slot}_${line}_${i + 1}`, type: 'armor', slot, line, tier: i + 1, name, dr: lineDr(slot, line, i + 1), bonus,
        req: TIER_LEVEL[i], price: ARMOR_PRICE[i],
      }),
    );
  }
}
// Tier 6 standard barrier: weaker than the lines, but anyone can wear it.
add({ id: 'barrier_6', type: 'armor', slot: 'barrier', line: 'basic', name: 'Photon Barrier', tier: 6,
  dr: 9, req: 0, price: 24000, desc: 'A plain photon barrier anyone can wear.' });

// Uniques (data/uniques.ts): every tier of each, so a drop carries the base stats of the tier it dropped at.
// Weapons have their kind's stats at that tier (and its requirement); armour no requirement and damage taken between
// the Guard and Combat lines', with no line bonus: the unique effect is the point.
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
      add({ ...common, type: 'weapon', kind: u.base.kind, atpMin: base.atpMin, atpMax: base.atpMax, req: base.req, ...(base.bonus ? { bonus: { ...base.bonus } } : {}) });
    } else {
      const dr = Math.round((lineDr(u.base.slot, 'guard', tier) + lineDr(u.base.slot, 'combat', tier)) / 2);
      add({ ...common, type: 'armor', slot: u.base.slot, line: 'basic', dr, req: 0, ...(u.base.slot === 'frame' ? { slots: 2 } : {}) });
    }
  }
}

/** Every injector holds this many doses; tiers differ in how much a dose restores. */
export const INJECTOR_DOSES = 3;
// Fluid restores a smaller share: TP pools grow faster than HP, and a Force's techs are its HP too (Resta).
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
