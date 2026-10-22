import { statDelta, type StatKey } from './stats';

// Item affixes (Diablo 2 / Path of Exile style): numbers only. Behaviour changes live in talents; an affix
// adds a stat, a percentage or a resistance. Each affix has six strength tiers; the item level (from the
// item's tier) decides the best tier it can roll. Magic items roll 1-2 (one prefix, one suffix), rares 3-6
// (up to 3 of each). Prefixes are offence plus flat HP and TP, so survivability competes with damage for the
// same slots; suffixes are defence, utility and resistances. Downside affixes pair a big gain with a
// penalty: the glass-cannon dial. Units carry exactly one affix and are learned (one per affix) into the Mag.
// Every text says what it does in the stat's own words (2026-10-14): "Tech damage +20%", "Crit chance +2.4%",
// "Strike damage taken −5%". The weapon damage, melee and gun affixes went with the classes on 2026-10-21.

export type ItemAffixId =
  // weapons
  | 'lck' | 'critDmg' | 'haste' | 'tpRefill'
  | 'techPct' | 'mstFlat' | 'firePct' | 'lightningPct' | 'icePct' | 'tpCost' | 'tpRegen'
  // frames, barriers and units
  | 'hp' | 'tp' | 'strike' | 'regen' | 'injPotency' | 'injCharge' | 'walk' | 'dashRecharge'
  | 'resPoison' | 'resPara' | 'resBurn' | 'resCorrupt' | 'areaDr' | 'stability'
  // downsides (rares and units)
  | 'overcharged' | 'brittle' | 'frail';

export type AffixSlot = 'weapon' | 'frame' | 'barrier' | 'unit';

/** One rolled affix on an item: its value, and a downside affix's penalty. */
export interface AffixRoll {
  id: ItemAffixId;
  v: number;
  /** Downside affixes: the penalty (a positive number, taken off). */
  p?: number;
  /** Strength tier it rolled at (1-8; older rolls may go without). Haste has none. */
  t?: number;
}

export interface ItemAffixDef {
  id: ItemAffixId;
  kind: 'prefix' | 'suffix';
  slots: AffixSlot[];
  /** [lo, hi] for tiers 1-6 (tier n needs item level AFFIX_TIER_ILVL[n - 1]); tiers 7-8 extend them (`affixRange`). */
  tiers: [number, number][];
  /** Downside affixes: the penalty's [lo, hi] per tier, and the stat it comes off ('dr': both damage-taken stats). */
  penalty?: { stat: StatKey | 'dr'; tiers: [number, number][] };
  /** "Tech damage +12%". */
  text: (v: number) => string;
  /** The word a magic item takes from it ("Mystic Rod", "Rod of Luck"). */
  word: string;
  /** A unit carrying it: "Heart Unit". */
  unit?: string;
  /** Flat stat it adds (shown with the item's stats, counted by Character.stats). */
  stat?: StatKey;
  rareOnly?: boolean;
  /** Only rolls on items of this tier and up (Haste and Frail: tier 8, Nightmare). */
  minTier?: number;
}

/**
 * Item level an affix tier needs. Tiers 1-6 cover Normal to Hell (item levels 1-98); tiers 7 and 8 only roll
 * on Falz Rift drops (item level 100 + 2 x the rift's tier): tier 7 from rift tier 4 and tier 8 from rift tier 7,
 * where Rift Circles II and III start (2026-10-17; they opened at old tiers 5 and 12).
 */
export const AFFIX_TIER_ILVL = [1, 10, 22, 36, 55, 80, 108, 114];
/** The deepest rift's item level (tier 10): nothing drops higher, and Rift-forging stops there. */
export const RIFT_TOP_ILVL = 120;
/** Strength tiers in all. */
export const AFFIX_TIERS = AFFIX_TIER_ILVL.length;

/**
 * An affix's [lo, hi] at strength tier `t` (1-8). Tiers 7 and 8 carry on from the authored six: tier 7 adds half
 * of the last step (tier 5 to 6), tier 8 the whole step, so no affix needs new numbers.
 */
export function tierRange(tiers: [number, number][], t: number): [number, number] {
  const n = tiers.length;
  if (t <= n) return tiers[Math.max(0, t - 1)];
  const [lo6, hi6] = tiers[n - 1];
  const [lo5, hi5] = tiers[n - 2] ?? tiers[n - 1];
  const k = t - n;
  const step = (a: number, b: number) => (k === 1 ? Math.floor((a - b) / 2) : (a - b) * (k - 1));
  const lo = lo6 + step(lo6, lo5);
  return [lo, Math.max(lo, hi6 + step(hi6, hi5))];
}

/** Item level of a drop of each item tier (the level band it drops in). */
const TIER_ILVL = [1, 5, 10, 17, 24, 30, 37, 47, 57, 67, 77, 85, 89, 94, 98];
export function tierIlvl(tier: number): number {
  return TIER_ILVL[Math.max(0, Math.min(TIER_ILVL.length - 1, tier - 1))];
}

/** Best affix tier (1-8) an item of `ilvl` can roll. */
export function maxAffixTier(ilvl: number): number {
  let t = 1;
  AFFIX_TIER_ILVL.forEach((need, i) => {
    if (ilvl >= need) t = i + 1;
  });
  return t;
}

/** Caps on totals from everything worn (talents included where they add to the same thing). */
export const AFFIX_CAPS = {
  /** Run speed from gear and talents together, as a fraction (+20%). */
  walk: 0.2,
  /** Strike and Area damage taken, each: at most this % less (gear, Mag, class and Farlla together). */
  damageTaken: 75,
  /** Each status resistance, percent. */
  resist: 75,
  /** Lowest a status resistance can go (a unique's cost, Red Ring, can push it below 0). */
  resistFloor: -50,
};

const W: AffixSlot[] = ['weapon'];
const ARMOR: AffixSlot[] = ['frame', 'barrier', 'unit'];
const FRAME: AffixSlot[] = ['frame', 'unit'];
const BARRIER: AffixSlot[] = ['barrier', 'unit'];
const pct = (label: string) => (v: number) => `${label} +${v}%`;
const flat = (label: string) => (v: number) => `${label} +${v}`;

export const ITEM_AFFIXES: Record<ItemAffixId, ItemAffixDef> = {
  // ---------------------------------------------------------------- weapons
  // Crit chance rolls in tenths of a percent (the `lck` stat's unit): 24 is +2.4%.
  lck: { id: 'lck', kind: 'suffix', slots: [...W, ...ARMOR], word: 'of Luck', unit: 'Luck', stat: 'lck', text: (v) => `Crit chance +${(v / 10).toFixed(1)}%`, tiers: [[3, 6], [6, 10], [10, 16], [16, 24], [24, 32], [32, 40]] },
  // Crits deal ×2 plus this (2026-10-14): the crit build's other half, so crit chance has something to multiply.
  critDmg: { id: 'critDmg', kind: 'prefix', slots: [...W, 'unit'], word: 'Savage', unit: 'Fang', text: pct('Crit damage'), tiers: [[6, 10], [10, 16], [16, 24], [24, 32], [32, 42], [42, 55]] },
  // Haste rolls 1% up to the item tier's cap (hasteCfg), from tier 8 (Nightmare).
  haste: { id: 'haste', kind: 'suffix', slots: ['weapon', 'frame', 'barrier'], word: 'of Haste', minTier: 8, text: (v) => `Haste +${v}% (faster bolts and casts)`, tiers: [[1, 1], [1, 1], [1, 1], [1, 1], [1, 1], [1, 1]] },
  // TP refill and Injector charge (also on frames) took the race % suffixes' place on 2026-10-17, when enemy races
  // went (the user's call).
  tpRefill: { id: 'tpRefill', kind: 'suffix', slots: W, word: 'of Flow', text: (v) => `Photon bolts refill ${v}% more TP`, tiers: [[3, 5], [5, 8], [8, 11], [11, 14], [14, 17], [17, 20]] },

  techPct: { id: 'techPct', kind: 'prefix', slots: W, word: 'Arcane', text: pct('Tech damage'), tiers: [[3, 6], [6, 10], [10, 14], [14, 18], [18, 23], [23, 28]] },
  mstFlat: { id: 'mstFlat', kind: 'prefix', slots: [...W, 'frame', 'unit'], word: 'Mystic', unit: 'Mind', stat: 'mst', text: flat('Tech damage'), tiers: [[3, 6], [6, 12], [12, 20], [20, 32], [32, 48], [48, 68]] },
  firePct: { id: 'firePct', kind: 'prefix', slots: W, word: 'Blazing', text: pct('Fire damage (Foie, Gifoie, Rafoie)'), tiers: [[5, 9], [9, 14], [14, 19], [19, 25], [25, 32], [32, 40]] },
  lightningPct: { id: 'lightningPct', kind: 'prefix', slots: W, word: 'Thundering', text: pct('Lightning damage (Zonde, Gizonde, Razonde)'), tiers: [[5, 9], [9, 14], [14, 19], [19, 25], [25, 32], [32, 40]] },
  icePct: { id: 'icePct', kind: 'prefix', slots: W, word: 'Frozen', text: pct('Ice damage (Barta, Gibarta, Rabarta)'), tiers: [[5, 9], [9, 14], [14, 19], [19, 25], [25, 32], [32, 40]] },
  tpCost: { id: 'tpCost', kind: 'suffix', slots: W, word: 'of Thrift', text: (v) => `Technique TP cost −${v}%`, tiers: [[2, 4], [4, 6], [6, 8], [8, 10], [10, 12], [12, 15]] },
  // Cast speed (casts only, caster weapons) was folded into Haste on 2026-10-11 (the user's call: one speed stat).
  // A trickle, not a TP source: something to cast with once the injector runs dry deep in a fight (2026-10-10).
  tpRegen: { id: 'tpRegen', kind: 'suffix', slots: W, word: 'of the Spring', text: (v) => `+${v} TP a second, in fights too`, tiers: [[1, 1], [1, 1], [1, 1], [1, 2], [1, 2], [2, 2]] },

  // ------------------------------------------------------- frames, barriers, units
  hp: { id: 'hp', kind: 'prefix', slots: ARMOR, word: 'Sturdy', unit: 'Heart', stat: 'hp', text: flat('HP'), tiers: [[5, 12], [12, 25], [25, 45], [45, 75], [75, 110], [110, 160]] },
  tp: { id: 'tp', kind: 'prefix', slots: ARMOR, word: 'Focused', unit: 'Spirit', stat: 'tp', text: flat('TP'), tiers: [[4, 9], [9, 18], [18, 32], [32, 50], [50, 75], [75, 110]] },
  // The two damage-taken stats are prefixes (2026-10-14: survivability competes with damage for the same slots).
  strike: { id: 'strike', kind: 'prefix', slots: ARMOR, word: 'Plated', unit: 'Guard', stat: 'strike', text: (v) => `Strike damage taken −${v}%`, tiers: [[1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 8]] },
  regen: { id: 'regen', kind: 'suffix', slots: FRAME, word: 'of Mending', unit: 'Mend', text: (v) => `+${v} HP a second, in fights too`, tiers: [[1, 1], [1, 1], [1, 2], [2, 3], [2, 4], [3, 5]] },
  injPotency: { id: 'injPotency', kind: 'suffix', slots: FRAME, word: 'of the Medic', unit: 'Medic', text: (v) => `Injector doses restore ${v}% more`, tiers: [[3, 5], [5, 8], [8, 11], [11, 14], [14, 17], [17, 20]] },
  injCharge: { id: 'injCharge', kind: 'suffix', slots: [...W, ...FRAME], word: 'of Absorption', unit: 'Absorb', text: (v) => `Injector charges ${v}% faster`, tiers: [[4, 7], [7, 10], [10, 14], [14, 18], [18, 22], [22, 26]] },
  walk: { id: 'walk', kind: 'suffix', slots: FRAME, word: 'of Speed', unit: 'Swift', text: (v) => `Run speed +${v}%`, tiers: [[2, 3], [3, 4], [4, 6], [5, 7], [6, 8], [7, 10]] },
  dashRecharge: { id: 'dashRecharge', kind: 'suffix', slots: FRAME, word: 'of the Wind', unit: 'Gale', text: (v) => `Dashes recharge ${v}% faster`, tiers: [[4, 6], [6, 9], [9, 12], [12, 15], [15, 18], [18, 22]] },
  resPoison: { id: 'resPoison', kind: 'suffix', slots: ARMOR, word: 'of Antidote', unit: 'Antidote', text: (v) => `Poison −${v}%`, tiers: [[5, 10], [10, 15], [15, 20], [20, 26], [26, 32], [32, 40]] },
  resPara: { id: 'resPara', kind: 'suffix', slots: ARMOR, word: 'of Nerve', unit: 'Nerve', text: (v) => `Paralysis −${v}%`, tiers: [[5, 10], [10, 15], [15, 20], [20, 26], [26, 32], [32, 40]] },
  resBurn: { id: 'resBurn', kind: 'suffix', slots: ARMOR, word: 'of Cooling', unit: 'Coolant', text: (v) => `Burn −${v}%`, tiers: [[5, 10], [10, 15], [15, 20], [20, 26], [26, 32], [32, 40]] },
  resCorrupt: { id: 'resCorrupt', kind: 'suffix', slots: ARMOR, word: 'of Purity', unit: 'Purity', text: (v) => `Corruption −${v}%`, tiers: [[5, 10], [10, 15], [15, 20], [20, 26], [26, 32], [32, 40]] },
  areaDr: { id: 'areaDr', kind: 'prefix', slots: ARMOR, word: 'Warded', unit: 'Bastion', stat: 'area', text: (v) => `Area damage taken −${v}%`, tiers: [[1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 8]] },
  stability: { id: 'stability', kind: 'suffix', slots: BARRIER, word: 'of Stability', unit: 'Anchor', text: (v) => `Knockback −${v}%`, tiers: [[10, 15], [15, 20], [20, 28], [28, 35], [35, 42], [42, 50]] },

  // ------------------------------------------------------------ downsides
  overcharged: {
    id: 'overcharged', kind: 'prefix', slots: ARMOR, word: 'Overcharged', unit: 'Overcharge', stat: 'tp', rareOnly: true,
    text: (v) => `TP +${v}`, tiers: [[15, 25], [25, 40], [40, 60], [60, 85], [85, 115], [115, 150]],
    penalty: { stat: 'hp', tiers: [[8, 14], [14, 24], [24, 36], [36, 52], [52, 70], [70, 95]] },
  },
  brittle: {
    id: 'brittle', kind: 'prefix', slots: [...FRAME, 'weapon'], word: 'Brittle', unit: 'Glass', rareOnly: true,
    text: pct('Tech damage'), tiers: [[5, 8], [8, 12], [12, 16], [16, 20], [20, 25], [25, 30]],
    penalty: { stat: 'dr', tiers: [[1, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 7]] },
  },
  frail: {
    id: 'frail', kind: 'prefix', slots: [...ARMOR, 'weapon'], word: 'Frail', unit: 'Frenzy', rareOnly: true, minTier: 8,
    text: (v) => `Haste +${v}%`, tiers: [[1, 2], [2, 3], [2, 4], [3, 5], [4, 6], [5, 8]],
    penalty: { stat: 'hp', tiers: [[5, 10], [10, 20], [20, 35], [35, 55], [55, 80], [80, 110]] },
  },
};

export const AFFIX_IDS = Object.keys(ITEM_AFFIXES) as ItemAffixId[];

/** Every kind of unit (an affix a unit can carry): what the learned units collection can hold. */
export const UNIT_KINDS = AFFIX_IDS.filter((id) => ITEM_AFFIXES[id].slots.includes('unit'));

/** A downside's penalty as text: "HP −36", "Damage taken +3%". */
export function penaltyText(stat: StatKey | 'dr', p: number): string {
  return stat === 'dr' ? `Damage taken +${p}%` : statDelta(stat, -p);
}

/** "TP +60 · HP −36": an affix roll as one line. */
export function affixText(r: AffixRoll): string {
  const def = ITEM_AFFIXES[r.id];
  const main = def.text(r.v);
  if (!def.penalty || !r.p) return main;
  return `${main} · ${penaltyText(def.penalty.stat, r.p)}`;
}

/** Can this affix roll on an item in `slot` of `tier` (rarity checked by the caller)? */
export function affixFits(def: ItemAffixDef, slot: AffixSlot, tier: number): boolean {
  if (!def.slots.includes(slot)) return false;
  if (def.minTier && tier < def.minTier) return false;
  return true;
}

/** Affixes that went on 2026-10-21 with the classes (weapon damage, melee and gun ones): saved rolls of them are dropped. */
export const RETIRED_AFFIXES = ['atpPct', 'atpFlat', 'reckless', 'staggerPct', 'finisherPct', 'falloff', 'perfectPct'];

// Rare names: two words, the second by what the item is.
export const RARE_FIRST = ['Doom', 'Storm', 'Grim', 'Bright', 'Void', 'Star', 'Blood', 'Rune', 'Ghost', 'Iron', 'Dawn', 'Night', 'Ember', 'Frost', 'Thunder', 'Echo', 'Spirit', 'Wraith', 'Sun', 'Moon', 'Photon', 'Nova', 'Ruin', 'Hollow'];
export const RARE_SECOND: Record<'weapon' | 'frame' | 'barrier', string[]> = {
  weapon: ['Mind', 'Spire', 'Whisper', 'Weave', 'Chant', 'Star', 'Sigil', 'Rod', 'Bolt', 'Call', 'Gaze', 'Flare'],
  frame: ['Shell', 'Coat', 'Mantle', 'Hide', 'Ward', 'Carapace', 'Skin', 'Vest'],
  barrier: ['Aegis', 'Guard', 'Halo', 'Wall', 'Bulwark', 'Shield', 'Veil', 'Bastion'],
};
