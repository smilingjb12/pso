// Character stats, the character's growth and XP.

/**
 * Stats are named after what they do and shown in the unit you feel (2026-10-14, the user's call: no proxy words, no
 * descriptions needed). The keys are the old ones so saves load unchanged:
 * - `mst` Tech damage: what techniques and photon bolts deal (each a multiple of it), and what heals grow with.
 * - `lck` Crit chance, kept in tenths of a percent (24 = 2.4%) so it stays a whole number.
 * - `strike` / `area` Strike / Area damage taken, in % less (capped at AFFIX_CAPS.damageTaken): direct swings and
 *   shots, or telegraphed areas, boss attacks and hazards.
 */
export type StatKey = 'hp' | 'tp' | 'mst' | 'lck' | 'strike' | 'area';
export type Stats = Record<StatKey, number>;
export const STAT_KEYS: StatKey[] = ['hp', 'tp', 'mst', 'lck', 'strike', 'area'];
export const STAT_LABEL: Record<StatKey, string> = {
  hp: 'HP', tp: 'TP', mst: 'Tech damage', lck: 'Crit chance', strike: 'Strike damage taken', area: 'Area damage taken',
};

/** A stat's value as shown: "340", "5.7%" (crit chance), "−20%" (damage taken). */
export function statValue(k: StatKey, v: number): string {
  if (k === 'lck') return `${(v / 10).toFixed(1)}%`;
  if (k === 'strike' || k === 'area') return `${v > 0 ? '−' : v < 0 ? '+' : ''}${Math.abs(Math.round(v))}%`;
  return `${Math.round(v)}`;
}

/** A change in a stat as item text: "Tech damage +12", "Crit chance +0.4%", "Area damage taken −3%", "HP −20". */
export function statDelta(k: StatKey, v: number): string {
  if (k === 'lck') return `${STAT_LABEL[k]} ${v < 0 ? '−' : '+'}${+(Math.abs(v) / 10).toFixed(1)}%`;
  if (k === 'strike' || k === 'area') return `${STAT_LABEL[k]} ${v < 0 ? '+' : '−'}${+Math.abs(v).toFixed(2)}%`;
  return `${STAT_LABEL[k]} ${v < 0 ? `−${+(-v).toFixed(1)}` : `+${+v.toFixed(1)}`}`;
}

/** Flat stats a piece of gear adds while worn (`bonus` on weapons and armour, and flat affixes). */
export type StatBonus = Partial<Record<StatKey, number>>;

/** The order gear bonuses are listed and compared in. */
export const BONUS_ORDER: StatKey[] = ['mst', 'lck', 'tp', 'hp', 'strike', 'area'];

/** A bonus's non-zero stats, in BONUS_ORDER. */
export function bonusEntries(bonus: StatBonus | undefined): [StatKey, number][] {
  return BONUS_ORDER.filter((k) => bonus?.[k]).map((k) => [k, bonus![k]!]);
}

/** ["Tech damage +6", "HP −20"]: a bonus as item text. */
export function bonusText(bonus: StatBonus | undefined): string[] {
  return bonusEntries(bonus).map(([k, v]) => statDelta(k, v));
}

/** Add a bonus onto `s` in place. */
export function addBonus(s: Stats, bonus: StatBonus | undefined): void {
  for (const [k, v] of bonusEntries(bonus)) s[k] += v;
}

// ---------------------------------------------------------------- the character

/**
 * The two Mag stats (and their colours): each Mag point goes into one. POW and DEX went with Weapon damage on
 * 2026-10-21 (the user's pick: offence or defence, nothing else).
 */
export type MagStat = 'mind' | 'def';
export const MAG_STATS: MagStat[] = ['mind', 'def'];

/**
 * Every character starts and grows the same since the classes went (2026-10-21, the user's call: melee, guns and
 * techniques together were too hard to balance): the Force's numbers, so the tuning made with her still holds.
 */
export const BASE_STATS: Stats = { hp: 70, tp: 80, mst: 60, lck: 45, strike: 0, area: 0 };
/** Stats gained per level (fractions add up; the total is rounded down). */
export const GROWTH: Stats = { hp: 7.5, tp: 6, mst: 4, lck: 1, strike: 0.1, area: 0.1 };
/** What a new character starts with equipped. */
export const START_WEAPON = 'wand_1';
export const START_INJECTOR = 'fluid_1';

/** The level cap: Hell's bands end at Lv 100, and past it the chase is items. */
export const MAX_LEVEL = 100;

/** XP needed to go from `level` to `level + 1`. */
export function xpToNext(level: number): number {
  return Math.round(25 * Math.pow(level, 1.5));
}

/** Level-up stats: the Lv 1 stats plus the growth. */
export function statsAtLevel(level: number): Stats {
  const out = {} as Stats;
  for (const k of STAT_KEYS) out[k] = Math.floor(BASE_STATS[k] + GROWTH[k] * (level - 1) + 1e-6);
  return out;
}
