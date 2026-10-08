import type { TechId } from './techniques';

// Character stats, the four attributes and the starting kits (there are no classes), palette types and XP.

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
    detail: 'Hit Points. Restored by a Mate injector (key 1), Resta and the Medical Center. Grows with level, POW, DEX and most with DEF.',
  },
  tp: {
    short: 'Spent to cast techniques.',
    detail: 'Technique Points. No natural regen: refill with a Fluid injector (key 1), or land melee hits with a cane, rod or wand. MIND raises it.',
  },
  atp: {
    short: 'Weapon damage. Base + weapon roll.',
    detail: 'Attack Power. Weapon hit damage ≈ (ATP − enemy DFP) ÷ 5. Weapon ATP is rolled per hit; POW (and a little DEX), grinding and Shifta raise it.',
  },
  dfp: {
    short: 'Reduces damage taken.',
    detail: 'Defense Power. Enemy hit damage ≈ (enemy ATP − DFP) × 0.35. DEF (and a little DEX), frames, barriers and Deband raise it.',
  },
  mst: {
    short: 'Technique power.',
    detail: 'Mental Strength. Everyone knows every technique; MST alone decides how strong they are. Attack damage grows a little faster than MST, Resta heals 0.6 HP per MST, Shifta / Deband give 6.5% per 100 MST. TP cost rises with MST too, but slower than damage. MIND raises it; canes, rods and wands boost techniques further.',
  },
  ata: {
    short: 'Accuracy of weapon attacks.',
    detail: 'Accuracy. Hit % = ATA × attack/combo modifier − enemy EVP × 0.2. Later combo hits are more accurate; heavy attacks less (and never above 85%). Melee weapons get +15%; guns lose accuracy at long range. DEX (and a little POW) raises it.',
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

/** One-press palette action on Q / E: an item, the equipped injector, or a support technique (Resta, Shifta, Deband). */
export type QuickAction =
  | { kind: 'tech'; tech: TechId }
  | { kind: 'item'; item: string }
  | { kind: 'injector' }
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

// -------------------------------------------------------------- attributes

/**
 * The four attributes. There are no classes: each level gives attribute points on top of a growth everyone
 * shares, and where they go (with the Mag tree and the gear) makes the character. They share their names
 * and colours with the Mag's arms. Points are permanent.
 */
export type AttributeId = 'pow' | 'dex' | 'mind' | 'def';
export const ATTRIBUTES: AttributeId[] = ['pow', 'dex', 'mind', 'def'];

export interface AttributeDef {
  label: string;
  /** What a character led by this attribute is called. */
  title: string;
  desc: string;
  /** Stats one point adds (fractions add up; the total is rounded down). */
  gain: Partial<Stats>;
}

/**
 * Three points a level (attributeCfg.pointsPerLevel). All three in MIND grows like the old Force, two POW and
 * one DEF like the old Hunter, two DEX and one POW like the old Ranger (to within 0.2 EVP a level).
 */
export const ATTRIBUTE_INFO: Record<AttributeId, AttributeDef> = {
  pow: { label: 'POW', title: 'Vanguard', desc: 'Weapon power, with a little ATA and some HP.', gain: { atp: 0.9, ata: 0.1, hp: 1.5 } },
  dex: { label: 'DEX', title: 'Ranger', desc: 'Accuracy, with a little ATP, DFP and HP.', gain: { ata: 0.35, atp: 0.15, dfp: 0.45, hp: 1.5 } },
  mind: { label: 'MIND', title: 'Mystic', desc: 'Technique power (MST) and TP.', gain: { mst: 1, tp: 4 / 3 } },
  def: { label: 'DEF', title: 'Guardian', desc: 'Defense, and the most HP.', gain: { dfp: 1.7, hp: 3.5 } },
};

/** Growth every character gets per level, whatever their points (the lowest of the old classes in each stat). */
export const SHARED_GROWTH: Stats = { hp: 7.5, tp: 2, atp: 2.2, dfp: 1.3, mst: 1, ata: 1, evp: 2.2, lck: 0.3 };

export type AttributePoints = Record<AttributeId, number>;

export const noAttributes = (): AttributePoints => ({ pow: 0, dex: 0, mind: 0, def: 0 });

// ------------------------------------------------------------ starting kits

export type KitId = 'vanguard' | 'ranger' | 'mystic';

/**
 * Picked at creation: starting gear, palette and Lv 1 stats (the old classes' starting stats, so the first
 * hour plays as before). It locks nothing; after Lv 1 only attribute points, the Mag and gear shape you.
 */
export interface KitDef {
  id: KitId;
  name: string;
  desc: string;
  color: number;
  /** The attribute it leans toward: the title and the Mag's look follow it until points say otherwise. */
  attribute: AttributeId;
  base: Stats;
  startWeapon: string;
  startItems: [string, number][];
  /** The injector it starts with equipped (Mate for fighters, Fluid for casters). */
  startInjector: string;
  palette: PaletteRow[];
}

const I = (item: string): QuickAction => ({ kind: 'item', item });
const T = (tech: TechId): QuickAction => ({ kind: 'tech', tech });
const J: QuickAction = { kind: 'injector' };
const E: QuickAction = { kind: 'empty' };

export const KITS: Record<KitId, KitDef> = {
  vanguard: {
    id: 'vanguard',
    name: 'Vanguard',
    desc: 'Saber and a Mate injector. Starts with the most HP, ATP and DFP.',
    color: 0x2c4fae,
    attribute: 'pow',
    base: { hp: 120, tp: 30, atp: 40, dfp: 24, mst: 15, ata: 50, evp: 48, lck: 10 },
    startWeapon: 'saber_1',
    startItems: [['telepipe', 1]],
    startInjector: 'mate_1',
    palette: [
      { mouse: 'weapon', quick: [J, E] },
      { mouse: 'magic', quick: [I('telepipe'), E] },
    ],
  },
  ranger: {
    id: 'ranger',
    name: 'Ranger',
    desc: 'Handgun and a Mate injector. Starts with the best ATA.',
    color: 0xb02a3c,
    attribute: 'dex',
    base: { hp: 105, tp: 30, atp: 32, dfp: 16, mst: 15, ata: 70, evp: 45, lck: 10 },
    startWeapon: 'handgun_1',
    startItems: [['telepipe', 1]],
    startInjector: 'mate_1',
    palette: [
      { mouse: 'weapon', quick: [J, E] },
      { mouse: 'magic', quick: [I('telepipe'), E] },
    ],
  },
  mystic: {
    id: 'mystic',
    name: 'Mystic',
    desc: 'Cane and a Fluid injector. Starts with the most MST and TP, and the least HP.',
    color: 0x9a3ac8,
    attribute: 'mind',
    base: { hp: 70, tp: 80, atp: 25, dfp: 10, mst: 60, ata: 45, evp: 50, lck: 10 },
    startWeapon: 'cane_1',
    startItems: [['telepipe', 1]],
    startInjector: 'fluid_1',
    palette: [
      { mouse: 'magic', quick: [T('resta'), J] },
      { mouse: 'weapon', quick: [J, I('telepipe')] },
    ],
  },
};

export const MAX_LEVEL = 100;

/** XP needed to go from `level` to `level + 1`. */
export function xpToNext(level: number): number {
  return Math.round(25 * Math.pow(level, 1.5));
}

/** Attribute points a character of `level` has earned in all (none at Lv 1). */
export function attributePointsEarned(level: number, perLevel: number): number {
  return Math.max(0, Math.floor((level - 1) * perLevel));
}

/** Level-up stats: the kit's Lv 1 stats, the shared growth and what the attribute points add. */
export function statsAtLevel(kit: KitDef, level: number, points: AttributePoints): Stats {
  const out = {} as Stats;
  for (const k of STAT_KEYS) {
    let v = kit.base[k] + SHARED_GROWTH[k] * (level - 1);
    for (const a of ATTRIBUTES) v += points[a] * (ATTRIBUTE_INFO[a].gain[k] ?? 0);
    out[k] = Math.floor(v + 1e-6);
  }
  return out;
}

/** The attribute with the most points (a tie, or none yet, goes to the kit's). */
export function leadAttribute(kit: KitId, points: AttributePoints): AttributeId {
  const own = KITS[kit]?.attribute ?? 'pow';
  return [own, ...ATTRIBUTES].reduce((a, b) => (points[b] > points[a] ? b : a));
}

/** "Vanguard", "Mystic"...: what the character is called, from the attribute that leads. */
export function buildTitle(kit: KitId, points: AttributePoints): string {
  return ATTRIBUTE_INFO[leadAttribute(kit, points)].title;
}
