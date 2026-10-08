import type { AttackTiming, Race, WeaponWeight } from '../config';

export type Attr = Race | 'hit';
export const ATTRS: Attr[] = ['native', 'abeast', 'machine', 'dark', 'hit'];
export const ATTR_LABEL: Record<Attr, string> = {
  native: 'Native',
  abeast: 'A.Beast',
  machine: 'Machine',
  dark: 'Dark',
  hit: 'Hit',
};

/** Highest race % a weapon of `tier` can roll (5% steps): 10% at tier 1 up to 60% at tier 11. */
export function raceCap(tier: number): number {
  return 5 + tier * 5;
}

/**
 * Grind levels a weapon takes: 5 at tiers 1-2 up to 10 at tier 11, rares 2 more. Few enough that a weapon
 * fills up (an expedition clear drops about one weapon's worth), so each level is a choice.
 */
export function grindCap(def: { tier: number; rare?: boolean }): number {
  return 4 + Math.ceil(def.tier / 2) + (def.rare ? 2 : 0);
}

/** Name suffix for a weapon whose best race % is at least half its tier's cap ("Brand of Beasts"). */
export const RACE_SUFFIX: Record<Race, string> = {
  native: 'of Natives',
  abeast: 'of Beasts',
  machine: 'of Machines',
  dark: 'of Darkness',
};

// ------------------------------------------------------------------ specials

export type SpecialId = 'heat' | 'ice' | 'shock' | 'draw' | 'dim' | 'venom' | 'arc';

export interface SpecialDef {
  id: SpecialId;
  name: string;
  /** Chance per heavy hit (specials only roll on heavy attacks). */
  procChance: number;
  effect: 'burn' | 'freeze' | 'stun' | 'drain' | 'instakill' | 'poison' | 'chain';
  /** burn: dps; poison: fraction of max HP per second; freeze/stun: seconds; drain: % of damage healed; instakill: unused; chain: share of the hit each jump deals. */
  power: number;
  duration: number;
}

export const specials: Record<SpecialId, SpecialDef> = {
  heat: { id: 'heat', name: 'Heat', procChance: 0.3, effect: 'burn', power: 7, duration: 3 },
  ice: { id: 'ice', name: 'Ice', procChance: 0.2, effect: 'freeze', power: 0, duration: 2.5 },
  shock: { id: 'shock', name: 'Shock', procChance: 0.25, effect: 'stun', power: 0, duration: 1.4 },
  draw: { id: 'draw', name: 'Draw', procChance: 0.5, effect: 'drain', power: 0.25, duration: 0 },
  dim: { id: 'dim', name: 'Dim', procChance: 0.07, effect: 'instakill', power: 0, duration: 0 },
  // Poison scales with the target's max HP (capped for bosses), so it shines on tough enemies.
  venom: { id: 'venom', name: 'Venom', procChance: 0.3, effect: 'poison', power: 0.04, duration: 5 },
  // The Warden's signature: the shot arcs on to two more enemies nearby (and stuns them briefly).
  arc: { id: 'arc', name: 'Arc', procChance: 0.4, effect: 'chain', power: 0.5, duration: 0.8 },
};

// ------------------------------------------------------------- weapon kinds

export type WeaponKind =
  | 'saber'
  | 'sword'
  | 'dagger'
  | 'partisan'
  | 'slicer'
  | 'handgun'
  | 'rifle'
  | 'mechgun'
  | 'shot'
  | 'cane'
  | 'rod'
  | 'wand';

export interface WeaponKindDef {
  kind: WeaponKind;
  label: string;
  ranged: boolean;
  /** Melee reach, or projectile max range for guns. */
  range: number;
  // The light (area) attack's shape. Heavy is always single target: one swing at the aimed
  // enemy, or one homing shot (heavyProjectiles for bursts).
  /** Light melee: sweep arc in degrees. */
  arcDeg: number;
  /** Light melee: strike a straight line this wide instead of the arc (partisans). */
  lineWidth?: number;
  /** Light: most enemies one attack can hit (each rolls accuracy on its own, and is hit once). */
  maxTargets: number;
  /** Damage instances per swing, light and heavy (daggers hit twice). */
  hits: number;
  /** Light ranged: projectiles per shot, fanned over spreadDeg (use odd counts so one flies straight). */
  projectiles: number;
  projSpeed: number;
  spreadDeg?: number;
  /** Light ranged: one projectile flies straight through up to maxTargets enemies (slicers, rifles). */
  pierce?: boolean;
  /** Heavy ranged: rounds in the shot (mechgun bursts), each at heavyScale damage. */
  heavyProjectiles?: number;
  heavyScale?: number;
  /** Ranged: distance where accuracy starts falling off (defaults to accuracy.rangedFalloffStart). */
  falloffStart?: number;
  /** Per-hit damage multiplier (daggers' double hits are weaker each). */
  damageScale: number;
  timing: AttackTiming;
  /** Technique power multiplier while equipped. */
  techBoost: number;
  /** Melee only: TP restored per landed hit (doubled on heavies / combo finishers). */
  tpOnHit?: number;
  /** Melee weight class (config weaponWeights): heavy kinds stagger more, lunge further and have Poise. */
  weight?: WeaponWeight;
  /** Stat checked for the equip requirement. */
  reqStat: 'atp' | 'ata' | 'mst';
  color: number;
}

// Attack speed comes from the weapon class, as in PSO. The chained-hit rhythm is
// roughly combo.windowOpen (0.55) x swing length: handgun/dagger ~0.30s,
// wand ~0.36s, saber ~0.40s, mechgun/cane ~0.50s, partisan/rod ~0.57s, sword ~0.58s,
// slicer ~0.59s, shot ~0.60s, rifle ~0.65s.
// Melee kinds come in weight classes: light (dagger, wand), medium (saber, cane) and heavy
// (sword, partisan, rod). Heavy swings take ~1.4x a saber's but hit harder per blow, stagger
// double and carry Poise (config weaponWeights), so their single-target damage stays near the
// saber's and they win on packs. Daggers are the single-target kings (~1.25x a saber).
// The rod is the pure caster's weapon (biggest technique boost); the wand trades boost for
// fast swings that refill TP.
// Each kind also has a rhythm feel: quick kinds (dagger, mechgun, wand, handgun) get a tight
// perfect window and short grace, slow kinds (sword, rod, rifle, partisan) wide ones.
// Saber and cane use the combo defaults.
// Every kind's light attack hits an area; the kind sets its shape: sword and rod sweep widest,
// partisans stab a line, slicers and rifles pierce, shots spread widest, daggers stay tight.
export const weaponKinds: Record<WeaponKind, WeaponKindDef> = {
  saber: {
    kind: 'saber', label: 'Saber', ranged: false,
    range: 2.4, arcDeg: 110, maxTargets: 3, hits: 1, projectiles: 0, projSpeed: 0, damageScale: 1,
    timing: { windup: 0.17, active: 0.09, recovery: 0.47 }, techBoost: 1, weight: 'medium', reqStat: 'atp', color: 0x3aa0ff,
  },
  sword: {
    kind: 'sword', label: 'Sword', ranged: false,
    range: 3.0, arcDeg: 160, maxTargets: 4, hits: 1, projectiles: 0, projSpeed: 0, damageScale: 1.05,
    timing: { windup: 0.32, active: 0.12, recovery: 0.62, perfect: 0.15, grace: 0.26 }, techBoost: 1, weight: 'heavy', reqStat: 'atp', color: 0x9fffc0,
  },
  dagger: {
    kind: 'dagger', label: 'Dagger', ranged: false,
    range: 2.0, arcDeg: 90, maxTargets: 2, hits: 2, projectiles: 0, projSpeed: 0, damageScale: 0.6,
    timing: { windup: 0.12, active: 0.1, recovery: 0.33, perfect: 0.065, grace: 0.12 }, techBoost: 1, weight: 'light', reqStat: 'atp', color: 0xffe070,
  },
  partisan: {
    kind: 'partisan', label: 'Partisan', ranged: false,
    range: 4.2, arcDeg: 30, lineWidth: 1.4, maxTargets: 4, hits: 1, projectiles: 0, projSpeed: 0, damageScale: 1.1,
    timing: { windup: 0.3, active: 0.1, recovery: 0.64, perfect: 0.13, grace: 0.24 }, techBoost: 1, weight: 'heavy', reqStat: 'atp', color: 0x70e0ff,
  },
  slicer: {
    kind: 'slicer', label: 'Slicer', ranged: true,
    range: 15, arcDeg: 0, maxTargets: 3, hits: 1, projectiles: 1, projSpeed: 20, pierce: true, damageScale: 1,
    timing: { windup: 0.28, active: 0.08, recovery: 0.71, perfect: 0.12, grace: 0.22 }, techBoost: 1, reqStat: 'atp', color: 0xff80c0,
  },
  handgun: {
    kind: 'handgun', label: 'Handgun', ranged: true,
    range: 16, arcDeg: 0, maxTargets: 2, hits: 1, projectiles: 3, projSpeed: 28, spreadDeg: 18, damageScale: 1,
    timing: { windup: 0.12, active: 0.05, recovery: 0.38, perfect: 0.085, grace: 0.15 }, techBoost: 1, reqStat: 'ata', color: 0xffc040,
  },
  rifle: {
    kind: 'rifle', label: 'Rifle', ranged: true,
    range: 26, arcDeg: 0, maxTargets: 3, hits: 1, projectiles: 1, projSpeed: 41, pierce: true, damageScale: 1, falloffStart: 18,
    timing: { windup: 0.36, active: 0.06, recovery: 0.76, perfect: 0.13, grace: 0.24 }, techBoost: 1, reqStat: 'ata', color: 0xff8040,
  },
  mechgun: {
    kind: 'mechgun', label: 'Mechgun', ranged: true,
    range: 13, arcDeg: 0, maxTargets: 3, hits: 1, projectiles: 5, projSpeed: 26, spreadDeg: 30, damageScale: 1,
    heavyProjectiles: 3, heavyScale: 0.5,
    timing: { windup: 0.15, active: 0.25, recovery: 0.51, perfect: 0.075, grace: 0.14 }, techBoost: 1, reqStat: 'ata', color: 0xffa020,
  },
  shot: {
    kind: 'shot', label: 'Shot', ranged: true,
    range: 11, arcDeg: 0, maxTargets: 5, hits: 1, projectiles: 5, projSpeed: 26, spreadDeg: 36, damageScale: 1,
    timing: { windup: 0.26, active: 0.06, recovery: 0.78, perfect: 0.12, grace: 0.22 }, techBoost: 1, reqStat: 'ata', color: 0x90ff60,
  },
  cane: {
    kind: 'cane', label: 'Cane', ranged: false,
    range: 2.4, arcDeg: 110, maxTargets: 3, hits: 1, projectiles: 0, projSpeed: 0, damageScale: 1,
    timing: { windup: 0.24, active: 0.1, recovery: 0.58 }, techBoost: 1.05, tpOnHit: 4, weight: 'medium', reqStat: 'mst', color: 0xd0a0ff,
  },
  rod: {
    kind: 'rod', label: 'Rod', ranged: false,
    range: 2.8, arcDeg: 150, maxTargets: 4, hits: 1, projectiles: 0, projSpeed: 0, damageScale: 1.1,
    timing: { windup: 0.3, active: 0.12, recovery: 0.62, perfect: 0.14, grace: 0.26 }, techBoost: 1.2, tpOnHit: 2, weight: 'heavy', reqStat: 'mst', color: 0xb080ff,
  },
  wand: {
    kind: 'wand', label: 'Wand', ranged: false,
    range: 2.2, arcDeg: 100, maxTargets: 2, hits: 1, projectiles: 0, projSpeed: 0, damageScale: 1,
    timing: { windup: 0.15, active: 0.08, recovery: 0.42, perfect: 0.08, grace: 0.14 }, techBoost: 1.1, tpOnHit: 6, weight: 'light', reqStat: 'mst', color: 0xff90e0,
  },
};

// --------------------------------------------------------------- armor lines

export type ArmorLine = 'basic' | 'guard' | 'combat' | 'psy';

/** Armor lines work like weapon kinds: a stat requirement (base + Mag) decides who can wear them. */
export interface ArmorLineDef {
  line: ArmorLine;
  label: string;
  reqStat: 'atp' | 'ata' | 'mst' | null;
  desc: string;
}

export const armorLines: Record<ArmorLine, ArmorLineDef> = {
  basic: { line: 'basic', label: 'Standard', reqStat: null, desc: 'Plain protection anyone can wear.' },
  guard: { line: 'guard', label: 'Guard', reqStat: 'atp', desc: 'Heavy plating for the front line: most DFP, little EVP, a small ATP bonus.' },
  combat: { line: 'combat', label: 'Combat', reqStat: 'ata', desc: 'Balanced DFP and EVP with the biggest ATP and ATA bonus.' },
  psy: { line: 'psy', label: 'Psy', reqStat: 'mst', desc: 'Light weave that amplifies techniques: low DFP, adds MST and TP.' },
};

// --------------------------------------------------------------- item defs

interface BaseDef {
  id: string;
  name: string;
  price: number;
  rare?: boolean;
  desc?: string;
}

export interface WeaponItemDef extends BaseDef {
  type: 'weapon';
  kind: WeaponKind;
  tier: number;
  atpMin: number;
  atpMax: number;
  ata: number;
  req: number; // required base value of the kind's reqStat
  special?: SpecialId;
  /** Flat MST while equipped (canes, rods and wands). */
  mst?: number;
}

export interface ArmorItemDef extends BaseDef {
  type: 'armor';
  slot: 'frame' | 'barrier';
  line: ArmorLine;
  tier: number;
  dfp: number;
  evp: number;
  /** Flat bonuses on top of DFP/EVP (the line's specialty). */
  atp?: number;
  ata?: number;
  mst?: number;
  tp?: number;
  req: number; // required base value of the line's reqStat (0 = none)
}

/** The Telepipe opens a portal to Pioneer 2 (injector refills are charge orbs on the ground, not items). */
export type ConsumableEffect = 'telepipe';

export interface ConsumableItemDef extends BaseDef {
  type: 'consumable';
  effect: ConsumableEffect;
  /** Only usable outside of the city. */
  fieldOnly?: boolean;
  /** Most you can carry (default MAX_STACK). */
  maxStack?: number;
}

export interface GrinderItemDef extends BaseDef {
  type: 'grinder';
  amount: number;
}

// ---------------------------------------------------------------- injectors

/** Mate injectors restore HP, Fluid injectors TP. */
export type InjectorKind = 'mate' | 'fluid';

/**
 * Injectors replace stacks of mates and fluids. Each holds a few doses; a dose restores a share of
 * the max gauge. Doses refill from damage dealt to enemies (and slowly, up to one, between fights).
 * Two equipment slots take any mix. Higher tiers need DFP (Mate) or MST (Fluid), base + Mag.
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

export const INJECTOR_REQ_STAT: Record<InjectorKind, 'dfp' | 'mst'> = { mate: 'dfp', fluid: 'mst' };

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

export type ItemDef = WeaponItemDef | ArmorItemDef | ConsumableItemDef | GrinderItemDef | InjectorItemDef;

export const MAX_STACK = 10;
export const INVENTORY_SIZE = 30;

/** Most of one item you can carry in its stack. */
export function stackCap(def: ItemDef): number {
  return def.type === 'consumable' ? (def.maxStack ?? MAX_STACK) : MAX_STACK;
}

export function isStackable(def: ItemDef): boolean {
  return def.type === 'consumable' || def.type === 'grinder';
}

const TIER_NAMES: Record<WeaponKind, string[]> = {
  saber: ['Saber', 'Brand', 'Buster', 'Pallasch', 'Gladius', 'Galatine', 'Astra Saber', 'Nova Blade', 'Stellar Saber', 'Quasar Saber', 'Cosmic Saber'],
  sword: ['Sword', 'Gigush', 'Breaker', 'Claymore', 'Calibur', 'Zanbato', 'Titan Cleaver', 'Meteor Sword', 'Colossus', 'Behemoth', 'Worldsplitter'],
  dagger: ['Dagger', 'Knife', 'Blade', 'Edge', 'Ripper', 'Vibro Edge', 'Nebula Fang', 'Phase Knife', 'Void Stiletto', 'Rift Dagger', 'Horizon Fang'],
  partisan: ['Partisan', 'Halbert', 'Glaive', 'Berdys', 'Gungnir', 'Vjaya', 'Comet Pike', 'Star Lance', 'Zenith Spear', 'Nadir Glaive', 'Aurora Halberd'],
  slicer: ['Slicer', 'Spinner', 'Cutter', 'Sawcer', 'Diska', 'Arc Disc', 'Halo Disc', 'Orbit Slicer', 'Eclipse Ring', 'Corona Disc', 'Solar Wheel'],
  handgun: ['Handgun', 'Autogun', 'Lockgun', 'Railgun', 'Raygun', 'Hypergun', 'Plasma Pistol', 'Ion Gun', 'Pulsar Gun', 'Quasar Gun', 'Nova Pistol'],
  rifle: ['Rifle', 'Sniper', 'Blaster', 'Beam', 'Laser', 'Photon Lancer', 'Ion Rifle', 'Meteor Beam', 'Horizon Rifle', 'Zenith Beam', 'Infinity Rifle'],
  mechgun: ['Mechgun', 'Assault', 'Repeater', 'Gatling', 'Vulcan', 'Typhoon', 'Storm', 'Cyclone', 'Maelstrom', 'Tempest', 'Hurricane'],
  shot: ['Shot', 'Spread', 'Cannon', 'Arms', 'Launcher', 'Hyper Cannon', 'Nova Cannon', 'Supernova', 'Starburst', 'Hypernova', 'Big Bang'],
  cane: ['Cane', 'Stick', 'Mace', 'Club', 'Maul', 'Quasar Mace', 'Pulsar Mace', 'Nebula Club', 'Singularity', 'Event Mace', 'Genesis Club'],
  rod: ['Rod', 'Pole', 'Pillar', 'Striker', 'Obelisk', 'Monolith', 'Spire', 'Zenith Rod', 'Eternal Pillar', 'Sky Pillar', 'Axis Rod'],
  wand: ['Wand', 'Staff', 'Baton', 'Scepter', 'Diadem', 'Aurora Staff', 'Celestial Staff', 'Starlight Wand', 'Halo Scepter', 'Seraph Staff', 'Empyrean Wand'],
};

/** Tier-1 base [atpMin, atpMax, ata] for each kind. */
const KIND_BASE: Record<WeaponKind, [number, number, number]> = {
  saber: [40, 55, 30],
  sword: [70, 90, 25],
  dagger: [25, 40, 25],
  partisan: [55, 70, 20],
  slicer: [30, 42, 18],
  handgun: [30, 40, 50],
  rifle: [45, 60, 60],
  mechgun: [18, 26, 40],
  shot: [32, 44, 36],
  cane: [25, 35, 30],
  rod: [35, 45, 25],
  wand: [20, 30, 35],
};

/** Tier-1 MST bonus for the MST-requirement kinds; scales with TIER_ATP. */
const KIND_MST: Partial<Record<WeaponKind, number>> = { cane: 4, wand: 6, rod: 8 };

// Tier 5 drops in the Caves (shops stock it after De Rol Le). Its requirements sit around
// Lv 26-30 base, so a well-fed Mag pulls it into the low 20s. Tier 6 drops in the Mines
// (shops after the Warden): about Lv 34-38 base, so a Mag built for it reaches it near 30.
// Tier 7 drops in the Ruins (shops after Dark Falz), reqs about Lv 44 base. Tiers 8-11 drop on Nightmare
// (Forest, Caves, Mines, Ruins), reqs reachable near the Lv 52 / 62 / 72 / 82 band tops.
const TIER_ATP = [1, 1.7, 2.5, 3.4, 4.4, 5.5, 6.7, 8.0, 9.4, 10.9, 12.5];
const TIER_ATA = [1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2.0];
const TIER_PRICE = [250, 900, 2800, 7500, 16000, 30000, 50000, 80000, 120000, 170000, 230000];
const TIER_REQ: Record<'atp' | 'ata' | 'mst', number[]> = {
  atp: [0, 60, 90, 130, 160, 185, 215, 245, 275, 305, 335],
  ata: [0, 75, 95, 120, 135, 150, 165, 180, 195, 210, 225],
  mst: [0, 80, 120, 170, 200, 230, 260, 290, 320, 350, 380],
};

export const itemDefs: Record<string, ItemDef> = {};

function add(def: ItemDef): void {
  itemDefs[def.id] = def;
}

for (const kind of Object.keys(TIER_NAMES) as WeaponKind[]) {
  TIER_NAMES[kind].forEach((name, i) => {
    const [mn, mx, ata] = KIND_BASE[kind];
    const mst = KIND_MST[kind];
    add({
      id: `${kind}_${i + 1}`,
      type: 'weapon',
      name,
      kind,
      tier: i + 1,
      atpMin: Math.round(mn * TIER_ATP[i]),
      atpMax: Math.round(mx * TIER_ATP[i]),
      ata: Math.round(ata * TIER_ATA[i]),
      req: TIER_REQ[weaponKinds[kind].reqStat][i],
      ...(mst ? { mst: Math.round(mst * TIER_ATP[i]) } : {}),
      price: TIER_PRICE[i],
    });
  });
}

// Rares: fixed specials, strong for the area.
add({ id: 'red_saber', type: 'weapon', name: 'Red Saber', kind: 'saber', tier: 2, rare: true,
  atpMin: 100, atpMax: 130, ata: 40, req: 55, special: 'heat', price: 8000,
  desc: 'A crimson photon blade. Burns on heavy attacks.' });
add({ id: 'flowens_sword', type: 'weapon', name: "Flowen's Sword", kind: 'sword', tier: 3, rare: true,
  atpMin: 160, atpMax: 200, ata: 40, req: 80, special: 'shock', price: 12000,
  desc: 'The sword of the legendary hunter Flowen.' });
add({ id: 'varista', type: 'weapon', name: 'Varista', kind: 'handgun', tier: 2, rare: true,
  atpMin: 70, atpMax: 90, ata: 75, req: 70, special: 'ice', price: 9000,
  desc: 'A custom handgun with a freezing payload.' });
add({ id: 'club_of_laconium', type: 'weapon', name: 'Club of Laconium', kind: 'cane', tier: 2, rare: true,
  atpMin: 60, atpMax: 80, ata: 40, req: 70, special: 'draw', mst: 10, price: 9000,
  desc: 'A heavy laconium cane that drains life.' });
add({ id: 'dragon_slayer', type: 'weapon', name: 'Dragon Slayer', kind: 'sword', tier: 3, rare: true,
  atpMin: 190, atpMax: 230, ata: 45, req: 85, special: 'heat', price: 20000,
  desc: 'Forged from the scales of a fallen dragon.' });
// Cave rares.
add({ id: 'lily_sting', type: 'weapon', name: 'Lily Sting', kind: 'dagger', tier: 4, rare: true,
  atpMin: 120, atpMax: 150, ata: 45, req: 110, special: 'venom', price: 16000,
  desc: 'Twin needles grown from a Poison Lily. Poisons on heavy attacks.' });
add({ id: 'spread_needle', type: 'weapon', name: 'Spread Needle', kind: 'shot', tier: 4, rare: true,
  atpMin: 130, atpMax: 160, ata: 60, req: 110, special: 'venom', price: 16000,
  desc: 'A shot that sprays venom-tipped needles.' });
add({ id: 'coral_rod', type: 'weapon', name: 'Coral Rod', kind: 'rod', tier: 4, rare: true,
  atpMin: 120, atpMax: 150, ata: 40, req: 150, special: 'ice', mst: 30, price: 16000,
  desc: 'A rod of living cave coral that chills on contact.' });
add({ id: 'rol_lance', type: 'weapon', name: 'Rol Lance', kind: 'partisan', tier: 5, rare: true,
  atpMin: 260, atpMax: 310, ata: 40, req: 145, special: 'shock', price: 30000,
  desc: 'Carved from a mandible of De Rol Le. Shocks on heavy attacks.' });
// Warden signature drop (a handgun, so every class can carry it).
add({ id: 'arc_welder', type: 'weapon', name: 'Arc Welder', kind: 'handgun', tier: 6, rare: true,
  atpMin: 190, atpMax: 240, ata: 85, req: 140, special: 'arc', price: 45000,
  desc: "The Warden's welding arm, rebuilt as a sidearm. Heavy shots can arc on to two more enemies nearby and stun them." });

// Armor: a neutral starter (tier 1 only) plus three lines per tier.
// Balance: 1 DFP ≈ 1.5% less damage taken, 1 ATP ≈ 0.7% more weapon damage,
// 1 MST ≈ 0.4% more tech damage, 1 EVP ≈ 0.3% fewer hits taken (Forest numbers).
// Melee eats far more hits than ranged, so DFP is worth more to a Hunter and
// offense more to a Ranger; each line should win for its own class only.
// Requirements equal the line's main class stat at levels 6 / 12 / 20 / 28 / 36 / 44 (Ruins), then 52 / 60 / 68 / 76 (Nightmare).
add({ id: 'frame_1', type: 'armor', slot: 'frame', line: 'basic', name: 'Frame', tier: 1, dfp: 5, evp: 5, req: 0, price: 200 });
add({ id: 'barrier_1', type: 'armor', slot: 'barrier', line: 'basic', name: 'Barrier', tier: 1, dfp: 4, evp: 6, req: 0, price: 200 });

type ArmorRow = { name: string; dfp: number; evp: number; atp?: number; ata?: number; mst?: number; tp?: number };
const ARMOR_TABLE: Record<'frame' | 'barrier', Record<Exclude<ArmorLine, 'basic'>, ArmorRow[]>> = {
  frame: {
    guard: [
      { name: 'Guard Frame', dfp: 7, evp: 3, atp: 1 },
      { name: 'Guard Armor', dfp: 13, evp: 4, atp: 2 },
      { name: 'Hard Armor', dfp: 21, evp: 6, atp: 3 },
      { name: 'Giga Frame', dfp: 31, evp: 9, atp: 5 },
      { name: 'Crimson Coat', dfp: 43, evp: 12, atp: 7 },
      { name: 'Bastion Frame', dfp: 57, evp: 16, atp: 9 },
      { name: 'Fortress Frame', dfp: 72, evp: 20, atp: 11 },
      { name: 'Citadel Armor', dfp: 88, evp: 24, atp: 13 },
      { name: 'Aegis Frame', dfp: 105, evp: 28, atp: 15 },
      { name: 'Bulwark Frame', dfp: 123, evp: 32, atp: 17 },
      { name: 'Paragon Frame', dfp: 142, evp: 36, atp: 19 },
    ],
    combat: [
      { name: 'Combat Frame', dfp: 4, evp: 6, atp: 2, ata: 2 },
      { name: 'Combat Armor', dfp: 8, evp: 9, atp: 5, ata: 4 },
      { name: 'Ranger Armor', dfp: 13, evp: 14, atp: 8, ata: 6 },
      { name: 'Sniper Frame', dfp: 19, evp: 21, atp: 12, ata: 8 },
      { name: 'Commander Frame', dfp: 26, evp: 30, atp: 17, ata: 11 },
      { name: 'Vanguard Frame', dfp: 34, evp: 40, atp: 23, ata: 14 },
      { name: 'Paladin Frame', dfp: 43, evp: 51, atp: 29, ata: 17 },
      { name: 'Sentinel Frame', dfp: 53, evp: 63, atp: 36, ata: 20 },
      { name: 'Warlord Frame', dfp: 64, evp: 76, atp: 43, ata: 23 },
      { name: 'Champion Frame', dfp: 75, evp: 90, atp: 50, ata: 26 },
      { name: 'Legend Frame', dfp: 87, evp: 105, atp: 58, ata: 29 },
    ],
    psy: [
      { name: 'Psy Frame', dfp: 3, evp: 5, mst: 6, tp: 5 },
      { name: 'Psy Armor', dfp: 6, evp: 8, mst: 12, tp: 10 },
      { name: 'Mind Armor', dfp: 10, evp: 12, mst: 19, tp: 16 },
      { name: 'Psycho Frame', dfp: 14, evp: 18, mst: 28, tp: 25 },
      { name: 'Spirit Garment', dfp: 19, evp: 25, mst: 39, tp: 36 },
      { name: 'Astral Garment', dfp: 25, evp: 33, mst: 52, tp: 48 },
      { name: 'Ethereal Garment', dfp: 32, evp: 42, mst: 66, tp: 61 },
      { name: 'Celestial Garment', dfp: 40, evp: 52, mst: 81, tp: 75 },
      { name: 'Divine Garment', dfp: 49, evp: 63, mst: 97, tp: 90 },
      { name: 'Seraphic Garment', dfp: 58, evp: 75, mst: 114, tp: 106 },
      { name: 'Empyrean Garment', dfp: 68, evp: 88, mst: 132, tp: 123 },
    ],
  },
  barrier: {
    guard: [
      { name: 'Guard Barrier', dfp: 5, evp: 4, atp: 1 },
      { name: 'Guard Shield', dfp: 10, evp: 6, atp: 1 },
      { name: 'Hard Shield', dfp: 18, evp: 8, atp: 2 },
      { name: 'Giga Shield', dfp: 26, evp: 12, atp: 3 },
      { name: 'Soul Barrier', dfp: 36, evp: 16, atp: 4 },
      { name: 'Bastion Shield', dfp: 47, evp: 21, atp: 5 },
      { name: 'Fortress Shield', dfp: 59, evp: 27, atp: 6 },
      { name: 'Citadel Shield', dfp: 72, evp: 33, atp: 7 },
      { name: 'Aegis Shield', dfp: 86, evp: 40, atp: 8 },
      { name: 'Bulwark Shield', dfp: 101, evp: 47, atp: 9 },
      { name: 'Paragon Shield', dfp: 117, evp: 55, atp: 10 },
    ],
    combat: [
      { name: 'Combat Barrier', dfp: 3, evp: 7, atp: 1, ata: 1 },
      { name: 'Combat Shield', dfp: 6, evp: 11, atp: 3, ata: 3 },
      { name: 'Ranger Shield', dfp: 11, evp: 16, atp: 5, ata: 4 },
      { name: 'Sniper Shield', dfp: 16, evp: 23, atp: 8, ata: 6 },
      { name: 'Commander Shield', dfp: 22, evp: 32, atp: 11, ata: 8 },
      { name: 'Vanguard Shield', dfp: 29, evp: 42, atp: 15, ata: 10 },
      { name: 'Paladin Shield', dfp: 37, evp: 53, atp: 19, ata: 12 },
      { name: 'Sentinel Shield', dfp: 46, evp: 65, atp: 23, ata: 14 },
      { name: 'Warlord Shield', dfp: 56, evp: 78, atp: 28, ata: 16 },
      { name: 'Champion Shield', dfp: 67, evp: 92, atp: 33, ata: 18 },
      { name: 'Legend Shield', dfp: 79, evp: 107, atp: 38, ata: 20 },
    ],
    psy: [
      { name: 'Psy Barrier', dfp: 2, evp: 6, mst: 4, tp: 3 },
      { name: 'Psy Shield', dfp: 5, evp: 10, mst: 8, tp: 6 },
      { name: 'Mind Shield', dfp: 9, evp: 15, mst: 12, tp: 10 },
      { name: 'Psycho Shield', dfp: 12, evp: 21, mst: 18, tp: 15 },
      { name: 'Spirit Shield', dfp: 17, evp: 29, mst: 25, tp: 21 },
      { name: 'Astral Shield', dfp: 22, evp: 38, mst: 33, tp: 28 },
      { name: 'Ethereal Shield', dfp: 28, evp: 48, mst: 42, tp: 36 },
      { name: 'Celestial Shield', dfp: 35, evp: 59, mst: 52, tp: 45 },
      { name: 'Divine Shield', dfp: 43, evp: 71, mst: 63, tp: 55 },
      { name: 'Seraphic Shield', dfp: 52, evp: 84, mst: 75, tp: 66 },
      { name: 'Empyrean Shield', dfp: 61, evp: 98, mst: 88, tp: 78 },
    ],
  },
};
export const ARMOR_REQ: Record<'atp' | 'ata' | 'mst', number[]> = {
  atp: [0, 60, 84, 116, 148, 180, 212, 244, 276, 308, 340],
  ata: [0, 79, 89, 104, 119, 133, 147, 161, 175, 189, 203],
  mst: [0, 80, 104, 136, 168, 200, 232, 264, 296, 328, 360],
};
const ARMOR_PRICE = [250, 800, 2400, 6500, 14000, 28000, 45000, 70000, 100000, 135000, 180000];
for (const slot of ['frame', 'barrier'] as const) {
  for (const line of ['guard', 'combat', 'psy'] as const) {
    ARMOR_TABLE[slot][line].forEach((row, i) =>
      add({
        id: `${slot}_${line}_${i + 1}`, type: 'armor', slot, line, tier: i + 1, ...row,
        req: ARMOR_REQ[armorLines[line].reqStat!][i], price: ARMOR_PRICE[i],
      }),
    );
  }
}
add({ id: 'dragon_scale', type: 'armor', slot: 'barrier', line: 'basic', name: 'Dragon Scale', tier: 3, rare: true,
  dfp: 22, evp: 18, req: 0, price: 15000, desc: 'A shield cut from a dragon scale. No requirement: anyone can wear it.' });
add({ id: 'rol_shell', type: 'armor', slot: 'barrier', line: 'basic', name: 'De Rol Le Shell', tier: 5, rare: true,
  dfp: 32, evp: 26, req: 0, price: 26000, desc: "A plate of De Rol Le's armour. No requirement: anyone can wear it." });
// Tier 6 standard barrier: weaker than the lines, but anyone can wear it.
add({ id: 'barrier_6', type: 'armor', slot: 'barrier', line: 'basic', name: 'Photon Barrier', tier: 6,
  dfp: 30, evp: 30, req: 0, price: 24000, desc: 'A plain photon barrier anyone can wear.' });
// Warden signature drop.
add({ id: 'warden_core', type: 'armor', slot: 'barrier', line: 'basic', name: 'Warden Core', tier: 6, rare: true,
  dfp: 34, evp: 28, req: 0, price: 40000,
  desc: "The Warden's reactor core, set into a barrier. No requirement: anyone can wear it. Facility hazards and Burn hit you half as hard, and flipping a power switch braces you (30% less damage for 3 s)." });

// Ruins rares (tier 7) and Dark Falz's signature drops.
add({ id: 'brionac', type: 'weapon', name: 'Brionac', kind: 'partisan', tier: 7, rare: true,
  atpMin: 400, atpMax: 500, ata: 45, req: 210, special: 'shock', price: 55000,
  desc: 'A holy lance from the temple vaults. Shocks on heavy attacks.' });
add({ id: 'holy_ray', type: 'weapon', name: 'Holy Ray', kind: 'rifle', tier: 7, rare: true,
  atpMin: 330, atpMax: 430, ata: 110, req: 160, special: 'ice', price: 55000,
  desc: 'Fires a beam of cold white light. Freezes on heavy attacks.' });
add({ id: 'psycho_wand', type: 'weapon', name: 'Psycho Wand', kind: 'wand', tier: 7, rare: true,
  atpMin: 150, atpMax: 220, ata: 60, req: 255, special: 'heat', mst: 55, price: 55000,
  desc: 'A wand that hums with borrowed thought. Burns on heavy attacks.' });
add({ id: 'dark_flow', type: 'weapon', name: 'Dark Flow', kind: 'sword', tier: 7, rare: true,
  atpMin: 520, atpMax: 660, ata: 55, req: 210, special: 'draw', price: 70000,
  desc: 'A blade of living darkness taken from Dark Falz. Heavy attacks drain life.' });
add({ id: 'seal_of_light', type: 'armor', slot: 'barrier', line: 'basic', name: 'Seal of Light', tier: 7, rare: true,
  dfp: 44, evp: 38, req: 0, price: 60000,
  desc: 'The seal that once held Dark Falz. No requirement: anyone can wear it. Corruption takes half as much from you, and pylons you light burn 50% longer.' });

// Nightmare rares (tiers 8-11) and the Nightmare bosses' signature drops. Each moved up a tier when the
// Ruins took the Lv 32-42 band (the Nightmare expeditions moved up one with it).
add({ id: 'verdant_edge', type: 'weapon', name: 'Verdant Edge', kind: 'saber', tier: 8, rare: true,
  atpMin: 360, atpMax: 480, ata: 65, req: 240, special: 'draw', price: 85000,
  desc: 'A blade of living green photon from the deep Forest. Heavy attacks drain life.' });
add({ id: 'thornshot', type: 'weapon', name: 'Thornshot', kind: 'shot', tier: 8, rare: true,
  atpMin: 285, atpMax: 380, ata: 75, req: 175, special: 'venom', price: 85000,
  desc: 'Sprays barbed, venomous thorns. Poisons on heavy attacks.' });
add({ id: 'magma_blade', type: 'weapon', name: 'Magma Blade', kind: 'sword', tier: 9, rare: true,
  atpMin: 730, atpMax: 915, ata: 55, req: 270, special: 'heat', price: 125000,
  desc: "Forged in the Caves' deepest vents. Burns on heavy attacks." });
add({ id: 'glacier_wand', type: 'weapon', name: 'Glacier Wand', kind: 'wand', tier: 9, rare: true,
  atpMin: 210, atpMax: 305, ata: 60, req: 315, special: 'ice', mst: 70, price: 125000,
  desc: 'A shard of cave ice that never melts. Freezes on heavy attacks.' });
add({ id: 'overcharge_gatling', type: 'weapon', name: 'Overcharge Gatling', kind: 'mechgun', tier: 10, rare: true,
  atpMin: 220, atpMax: 315, ata: 85, req: 205, special: 'shock', price: 175000,
  desc: 'A Garanz autocannon run past its limits. Shocks on heavy attacks.' });
add({ id: 'reactor_rod', type: 'weapon', name: 'Reactor Rod', kind: 'rod', tier: 10, rare: true,
  atpMin: 420, atpMax: 535, ata: 50, req: 345, special: 'heat', mst: 105, price: 175000,
  desc: "A control rod from the Mines' core. Burns on heavy attacks." });
add({ id: 'excalibur', type: 'weapon', name: 'Excalibur', kind: 'saber', tier: 11, rare: true,
  atpMin: 560, atpMax: 750, ata: 80, req: 330, special: 'shock', price: 240000,
  desc: 'The legendary photon sword, sealed in the deepest Ruins. Shocks on heavy attacks.' });
add({ id: 'heaven_punisher', type: 'weapon', name: 'Heaven Punisher', kind: 'rifle', tier: 11, rare: true,
  atpMin: 600, atpMax: 800, ata: 135, req: 220, special: 'ice', price: 240000,
  desc: 'A judgement-white beam rifle. Freezes on heavy attacks.' });
add({ id: 'elder_scale', type: 'armor', slot: 'barrier', line: 'basic', name: 'Elder Dragon Scale', tier: 8, rare: true,
  dfp: 60, evp: 51, req: 0, price: 95000, desc: 'A scale from the Dragon on Nightmare. No requirement: anyone can wear it.' });
add({ id: 'abyssal_carapace', type: 'armor', slot: 'barrier', line: 'basic', name: 'Abyssal Carapace', tier: 9, rare: true,
  dfp: 74, evp: 60, req: 0, price: 130000, desc: "A plate from De Rol Le's shell, taken on Nightmare. No requirement: anyone can wear it." });
add({ id: 'overseer_cannon', type: 'weapon', name: 'Overseer Cannon', kind: 'handgun', tier: 10, rare: true,
  atpMin: 350, atpMax: 465, ata: 120, req: 195, special: 'arc', price: 190000,
  desc: "The Warden's hand cannon, taken on Nightmare and rebuilt as a sidearm. Heavy shots can arc on to two more enemies nearby and stun them." });
add({ id: 'falz_halo', type: 'armor', slot: 'barrier', line: 'basic', name: 'Falz Halo', tier: 11, rare: true,
  dfp: 90, evp: 78, req: 0, price: 220000,
  desc: "The Angel's halo, taken on Nightmare. No requirement: anyone can wear it. Corruption takes half as much from you, and pylons you light burn 50% longer." });

add({ id: 'telepipe', type: 'consumable', name: 'Telepipe', effect: 'telepipe', price: 350, fieldOnly: true,
  desc: 'A long cast (any hit or step breaks it) that opens a portal to Pioneer 2. Step back through it from the city to return here; then it closes.' });

/** Every injector holds this many doses; tiers differ in how much a dose restores. */
export const INJECTOR_DOSES = 3;
// Fluid restores a smaller share: TP pools grow faster than HP, and a Force's techs are its HP too (Resta).
// Tier 6 drops only on Hard (bosses and champions).
const INJECTOR_POTENCY: Record<InjectorKind, number[]> = { mate: [0.3, 0.33, 0.36, 0.39, 0.42, 0.47], fluid: [0.3, 0.31, 0.32, 0.33, 0.34, 0.38] };
const INJECTOR_NAMES: Record<InjectorKind, string[]> = {
  mate: ['Mate Injector', 'Dimate Injector', 'Hi-Mate Injector', 'Star Mate Injector', 'Grand Mate Injector', 'Prime Mate Injector'],
  fluid: ['Fluid Injector', 'Difluid Injector', 'Hi-Fluid Injector', 'Star Fluid Injector', 'Grand Fluid Injector', 'Prime Fluid Injector'],
};
/** Base requirement (DFP for Mate, MST for Fluid): a Hunter-like build reaches Mate T3-5 around Lv 8 / 16 / 25, an all-MIND one Fluid T3-5 around Lv 6 / 15 / 23. */
export const INJECTOR_REQ: Record<InjectorKind, number[]> = { mate: [0, 0, 45, 70, 95, 125], fluid: [0, 0, 80, 115, 150, 200] };
const INJECTOR_PRICE = [300, 1200, 3500, 8000, 16000, 32000];
for (const kind of ['mate', 'fluid'] as const) {
  INJECTOR_POTENCY[kind].forEach((potency, i) =>
    add({ id: `${kind}_${i + 1}`, type: 'injector', kind, tier: i + 1, name: INJECTOR_NAMES[kind][i], doses: INJECTOR_DOSES, potency, req: INJECTOR_REQ[kind][i], price: INJECTOR_PRICE[i] }),
  );
}

const GRINDER_DESC = 'Pick where each level goes: Edge (more ATP, ATA and MST, against everything) or one race (more damage against it only).';
add({ id: 'monogrinder', type: 'grinder', name: 'Monogrinder', amount: 1, price: 1600, desc: GRINDER_DESC });
add({ id: 'digrinder', type: 'grinder', name: 'Digrinder', amount: 2, price: 3600, desc: `${GRINDER_DESC} Both levels go to the same pick.` });
add({ id: 'trigrinder', type: 'grinder', name: 'Trigrinder', amount: 3, price: 8000, desc: `${GRINDER_DESC} All three levels go to the same pick.` });

export function getDef(id: string): ItemDef {
  const d = itemDefs[id];
  if (!d) throw new Error(`Unknown item: ${id}`);
  return d;
}
