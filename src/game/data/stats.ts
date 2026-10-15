// Character stats, the three classes and XP.

/**
 * Stats are named after what they do and shown in the unit you feel (2026-10-14, the user's call: no proxy words, no
 * descriptions needed). The keys are the old ones so saves load unchanged:
 * - `atp` Weapon damage: what a weapon hit deals before its swing's multiplier and the enemy's armour (class, Mag,
 *   flat affixes; the weapon adds its own range on top).
 * - `mst` Tech damage: the same for techniques (each deals a multiple of it), and what heals and buffs grow with.
 * - `lck` Crit chance, kept in tenths of a percent (24 = 2.4%) so it stays a whole number.
 * - `strike` / `area` Strike / Area damage taken, in % less (capped at AFFIX_CAPS.damageTaken): direct swings and
 *   shots, or telegraphed areas, boss attacks and hazards.
 */
export type StatKey = 'hp' | 'tp' | 'atp' | 'mst' | 'lck' | 'strike' | 'area';
export type Stats = Record<StatKey, number>;
export const STAT_KEYS: StatKey[] = ['hp', 'tp', 'atp', 'mst', 'lck', 'strike', 'area'];
export const STAT_LABEL: Record<StatKey, string> = {
  hp: 'HP', tp: 'TP', atp: 'Weapon damage', mst: 'Tech damage', lck: 'Crit chance', strike: 'Strike damage taken', area: 'Area damage taken',
};

/** A stat's value as shown: "340", "5.7%" (crit chance), "−20%" (damage taken). */
export function statValue(k: StatKey, v: number): string {
  if (k === 'lck') return `${(v / 10).toFixed(1)}%`;
  if (k === 'strike' || k === 'area') return `${v > 0 ? '−' : v < 0 ? '+' : ''}${Math.abs(Math.round(v))}%`;
  return `${Math.round(v)}`;
}

/** A change in a stat as item text: "Weapon damage +12", "Crit chance +0.4%", "Area damage taken −3%", "HP −20". */
export function statDelta(k: StatKey, v: number): string {
  if (k === 'lck') return `${STAT_LABEL[k]} ${v < 0 ? '−' : '+'}${+(Math.abs(v) / 10).toFixed(1)}%`;
  if (k === 'strike' || k === 'area') return `${STAT_LABEL[k]} ${v < 0 ? '+' : '−'}${+Math.abs(v).toFixed(2)}%`;
  return `${STAT_LABEL[k]} ${v < 0 ? `−${+(-v).toFixed(1)}` : `+${+v.toFixed(1)}`}`;
}

/** Flat stats a piece of gear adds while worn (`bonus` on weapons and armour, and flat affixes). */
export type StatBonus = Partial<Record<StatKey, number>>;

/** The order gear bonuses are listed and compared in. */
export const BONUS_ORDER: StatKey[] = ['atp', 'mst', 'lck', 'tp', 'hp', 'strike', 'area'];

/** A bonus's non-zero stats, in BONUS_ORDER. */
export function bonusEntries(bonus: StatBonus | undefined): [StatKey, number][] {
  return BONUS_ORDER.filter((k) => bonus?.[k]).map((k) => [k, bonus![k]!]);
}

/** ["Weapon damage +2", "Tech damage +6", "HP −20"]: a bonus as item text. */
export function bonusText(bonus: StatBonus | undefined): string[] {
  return bonusEntries(bonus).map(([k, v]) => statDelta(k, v));
}

/** Add a bonus onto `s` in place. */
export function addBonus(s: Stats, bonus: StatBonus | undefined): void {
  for (const [k, v] of bonusEntries(bonus)) s[k] += v;
}

// ------------------------------------------------------------------ classes

/** The four Mag stats (and their colours): each Mag point goes into one. They also name a class's lean. */
export type MagStat = 'pow' | 'dex' | 'mind' | 'def';
export const MAG_STATS: MagStat[] = ['pow', 'dex', 'mind', 'def'];

export type ClassId = 'hunter' | 'ranger' | 'force';
export const CLASS_IDS: ClassId[] = ['hunter', 'ranger', 'force'];

/** What a class fights with: its Arts and passives work with this family's weapons (Force ones with techniques too). */
export type WeaponFamily = 'melee' | 'ranged' | 'caster';

/**
 * Picked at creation and fixed: Lv 1 stats, growth per level and starting gear. The class's Arts and passives
 * work with its weapon family; gear is gated by level only, so a Force can carry a saber, but none of her Arts
 * or passives help it.
 */
export interface ClassDef {
  id: ClassId;
  name: string;
  desc: string;
  color: number;
  family: WeaponFamily;
  /** The Mag stat it leans on: the outfit before a frame decides it, and the Mag's first form. */
  magStat: MagStat;
  base: Stats;
  /** Stats gained per level (fractions add up; the total is rounded down). */
  growth: Stats;
  startWeapon: string;
  startItems: [string, number][];
  /** The injector it starts with equipped (Mate for fighters, Fluid for casters). */
  startInjector: string;
}


// Growth per level is the old classes' (a shared base plus three attribute points a level: 2 POW + 1 DEF for
// the Hunter, 2 DEX + 1 POW for the Ranger, 3 MIND for the Force), so gear requirements and tuning still hold.
export const CLASSES: Record<ClassId, ClassDef> = {
  hunter: {
    id: 'hunter',
    name: 'Hunter',
    desc: 'Melee: sabers, swords and daggers. The most HP, weapon damage and defense.',
    color: 0x2c4fae,
    family: 'melee',
    magStat: 'pow',
    base: { hp: 120, tp: 30, atp: 40, mst: 15, lck: 50, strike: 2, area: 2 },
    growth: { hp: 14, tp: 2, atp: 4, mst: 1, lck: 1.2, strike: 0.25, area: 0.25 },
    startWeapon: 'saber_1',
    startItems: [],
    startInjector: 'mate_1',
  },
  ranger: {
    id: 'ranger',
    name: 'Ranger',
    desc: 'Ranged: handguns, rifles and shots. The highest crit chance.',
    color: 0xb02a3c,
    family: 'ranged',
    magStat: 'dex',
    base: { hp: 105, tp: 30, atp: 32, mst: 15, lck: 70, strike: 1, area: 1 },
    growth: { hp: 12, tp: 2, atp: 3.4, mst: 1, lck: 1.8, strike: 0.17, area: 0.17 },
    startWeapon: 'handgun_1',
    startItems: [],
    startInjector: 'mate_1',
  },
  force: {
    id: 'force',
    name: 'Force',
    desc: 'Techniques, with a rod or wand in hand. The most tech damage and TP, the least HP.',
    color: 0x9a3ac8,
    family: 'caster',
    magStat: 'mind',
    base: { hp: 70, tp: 80, atp: 25, mst: 60, lck: 45, strike: 0, area: 0 },
    growth: { hp: 7.5, tp: 6, atp: 2.2, mst: 4, lck: 1, strike: 0.1, area: 0.1 },
    startWeapon: 'wand_1',
    startItems: [],
    startInjector: 'fluid_1',
  },
};

/** The level cap: Hell's bands end at Lv 100, and past it the chase is items. */
export const MAX_LEVEL = 100;

/** XP needed to go from `level` to `level + 1`. */
export function xpToNext(level: number): number {
  return Math.round(25 * Math.pow(level, 1.5));
}

/** Level-up stats: the class's Lv 1 stats plus its growth. */
export function statsAtLevel(cls: ClassDef, level: number): Stats {
  const out = {} as Stats;
  for (const k of STAT_KEYS) out[k] = Math.floor(cls.base[k] + cls.growth[k] * (level - 1) + 1e-6);
  return out;
}
