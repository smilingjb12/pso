import type { ClassId } from './items';
import type { TechId } from './techniques';

export type StatKey = 'hp' | 'tp' | 'atp' | 'dfp' | 'mst' | 'ata' | 'evp' | 'lck';
export type Stats = Record<StatKey, number>;
export const STAT_KEYS: StatKey[] = ['hp', 'tp', 'atp', 'dfp', 'mst', 'ata', 'evp', 'lck'];
export const STAT_LABEL: Record<StatKey, string> = {
  hp: 'HP', tp: 'TP', atp: 'ATP', dfp: 'DFP', mst: 'MST', ata: 'ATA', evp: 'EVP', lck: 'LCK',
};

/** What each stat does: a one-liner for the status screen and a longer hover tooltip. */
export const STAT_INFO: Record<StatKey, { short: string; detail: string }> = {
  hp: {
    short: 'Health. You collapse at 0.',
    detail: 'Hit Points. Restored by a Mate injector (keys 1 / 2), Resta and the Medical Center. Grows with level.',
  },
  tp: {
    short: 'Spent to cast techniques.',
    detail: 'Technique Points. No natural regen: refill with a Fluid injector (keys 1 / 2), or land melee hits with a cane, rod or wand.',
  },
  atp: {
    short: 'Weapon damage. Base + weapon roll.',
    detail: 'Attack Power. Weapon hit damage ≈ (ATP − enemy DFP) ÷ 5. Weapon ATP is rolled per hit; grinding and Shifta raise it.',
  },
  dfp: {
    short: 'Reduces damage taken.',
    detail: 'Defense Power. Enemy hit damage ≈ (enemy ATP − DFP) × 0.35. Frames, barriers and Deband raise it.',
  },
  mst: {
    short: 'Technique power.',
    detail: 'Mental Strength. Every class knows every technique; MST alone decides how strong they are. Attack damage grows a little faster than MST, Resta heals 0.6 HP per MST, Shifta / Deband give 6.5% per 100 MST. TP cost rises with MST too, but slower than damage. Canes, rods and wands boost techniques further.',
  },
  ata: {
    short: 'Accuracy of weapon attacks.',
    detail: 'Accuracy. Hit % = ATA × attack/combo modifier − enemy EVP × 0.2. Later combo hits are more accurate; heavy attacks less (and never above 85%). Melee weapons get +15%; guns lose accuracy at long range.',
  },
  evp: {
    short: 'Chance to dodge enemy attacks.',
    detail: 'Evasion. Enemy hit % = enemy ATA − EVP × 0.2. Frames and barriers add EVP. Boss area attacks are harder to dodge.',
  },
  lck: {
    short: 'Critical hit chance.',
    detail: 'Luck. Crit chance = LCK ÷ 5 % for weapon hits and techniques. Crits deal 1.5× damage (Resta heals 1.5×, Shifta / Deband boost 1.5×).',
  },
};

/** One-press palette action on Q / E: an item, an equipped injector (slot 0 / 1), or a support technique (Resta, Shifta, Deband). */
export type QuickAction =
  | { kind: 'tech'; tech: TechId }
  | { kind: 'item'; item: string }
  | { kind: 'injector'; slot: 0 | 1 }
  | { kind: 'empty' };

/**
 * A palette row. LMB / RMB use its attack source (light / heavy): the equipped weapon, or magic
 * (the attack technique picked with the mouse wheel). Q and E are quick slots. Shift swaps rows.
 */
export interface PaletteRow {
  mouse: 'weapon' | 'magic';
  quick: [QuickAction, QuickAction];
}

/** What the palette editor assigns: a row's mouse source (column 0) or a quick slot (columns 1-2). */
export type PaletteEdit = QuickAction | { kind: 'source'; source: PaletteRow['mouse'] };

export interface ClassDef {
  id: ClassId;
  name: string;
  title: string;
  desc: string;
  color: number;
  base: Stats;
  growth: Stats;
  startWeapon: string;
  startItems: [string, number][];
  /** Injectors equipped in slots 1 and 2. */
  startInjectors: string[];
  palette: PaletteRow[];
}

const I = (item: string): QuickAction => ({ kind: 'item', item });
const T = (tech: TechId): QuickAction => ({ kind: 'tech', tech });
const J = (slot: 0 | 1): QuickAction => ({ kind: 'injector', slot });
const E: QuickAction = { kind: 'empty' };

export const classes: Record<ClassId, ClassDef> = {
  hunter: {
    id: 'hunter',
    name: 'Hunter',
    title: 'HUnewearl',
    desc: 'Front-line melee fighter. High HP and ATP, solid defense. Sabers, daggers, and swords, partisans and slicers that hit several enemies.',
    color: 0x2c4fae,
    base: { hp: 120, tp: 30, atp: 40, dfp: 24, mst: 15, ata: 50, evp: 48, lck: 10 },
    growth: { hp: 14, tp: 2, atp: 4, dfp: 3, mst: 1, ata: 1.2, evp: 2.3, lck: 0.3 },
    startWeapon: 'saber_1',
    startItems: [['telepipe', 1]],
    startInjectors: ['mate_1', 'fluid_1'],
    palette: [
      { mouse: 'weapon', quick: [J(0), J(1)] },
      { mouse: 'magic', quick: [I('telepipe'), E] },
    ],
  },
  ranger: {
    id: 'ranger',
    name: 'Ranger',
    title: 'RAmarl',
    desc: 'Marksman. Excellent ATA for reliable hits at range. Handguns, rifles, mechguns, and shots that hit several enemies.',
    color: 0xb02a3c,
    base: { hp: 105, tp: 30, atp: 32, dfp: 16, mst: 15, ata: 70, evp: 45, lck: 10 },
    growth: { hp: 12, tp: 2, atp: 3.4, dfp: 2.2, mst: 1, ata: 1.8, evp: 2.2, lck: 0.4 },
    startWeapon: 'handgun_1',
    startItems: [['telepipe', 1]],
    startInjectors: ['mate_1', 'fluid_1'],
    palette: [
      { mouse: 'weapon', quick: [J(0), J(1)] },
      { mouse: 'magic', quick: [I('telepipe'), E] },
    ],
  },
  force: {
    id: 'force',
    name: 'Force',
    title: 'FOmarl',
    desc: 'Technique caster. Huge TP and MST. Fragile up close; canes, rods and wands boost techniques.',
    color: 0x9a3ac8,
    base: { hp: 70, tp: 80, atp: 25, dfp: 10, mst: 60, ata: 45, evp: 50, lck: 10 },
    growth: { hp: 7.5, tp: 6, atp: 2.2, dfp: 1.3, mst: 4, ata: 1, evp: 2.4, lck: 0.3 },
    startWeapon: 'cane_1',
    startItems: [['telepipe', 1]],
    startInjectors: ['mate_1', 'fluid_1'],
    palette: [
      { mouse: 'magic', quick: [T('resta'), J(1)] },
      { mouse: 'weapon', quick: [J(0), I('telepipe')] },
    ],
  },
};

export const MAX_LEVEL = 100;

/** XP needed to go from `level` to `level + 1`. */
export function xpToNext(level: number): number {
  return Math.round(25 * Math.pow(level, 1.5));
}

export function statsAtLevel(cls: ClassDef, level: number): Stats {
  const out = {} as Stats;
  for (const k of Object.keys(cls.base) as StatKey[]) {
    out[k] = Math.floor(cls.base[k] + cls.growth[k] * (level - 1));
  }
  return out;
}
