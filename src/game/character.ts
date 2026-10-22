import { casting, drops, formulas, hasteCfg, magCfg, passiveCfg, skillCfg, uniqueCfg, type AttackTiming } from './config';
import type { BossId } from './data/bosses';
import { asDifficulty, type Difficulty } from './difficulty';
import type { Look } from './models/heroine';
import {
  addBonus,
  BONUS_ORDER,
  bonusText,
  MAX_LEVEL,
  START_INJECTOR,
  START_WEAPON,
  STAT_LABEL,
  statDelta,
  statsAtLevel,
  statValue,
  xpToNext,
  type StatBonus,
  type StatKey,
  type Stats,
} from './data/stats';
import {
  itemDefs,
  armorLines,
  BARE_KIND,
  getDef,
  grindCap,
  INJECTOR_MODS,
  INVENTORY_SIZE,
  RARITY_LABEL,
  RETIRED_KINDS,
  RETIRED_LINES,
  weaponKinds,
  type ArmorItemDef,
  type InjectorMod,
  type ItemDef,
  type Rarity,
  type WeaponItemDef,
  type WeaponKindDef,
} from './data/items';
import type { RiftSave } from './rifts';
import { AFFIX_CAPS, AFFIX_TIERS, affixText, ITEM_AFFIXES, RETIRED_AFFIXES, RIFT_TOP_ILVL, tierIlvl, tierRange, type AffixRoll, type ItemAffixId } from './data/itemAffixes';
import { critChance } from './formulas';
import { ATTACK_TECHS, isAttackTech, techAttackPower, techniques, techTpCost, type TechId } from './data/techniques';
import { ART_IDS, ARTS, SUPPORT_ARTS, type ArtId } from './data/arts';
import { hastened } from './combo';
import { estimateDamage, type Foe } from './dps';
import { UNIQUES, type UniqueId } from './data/uniques';
import { chargeOf, describeInjector, injectorDef, injectorStats } from './injectors';
import { GEAR_SLOTS, isGear, isStackable, itemRequirement, itemSlot, stackCap, type GearSlot, type ItemDefOf, type ItemType } from './itemTypes';
import { magBonuses, magPointsFree, magSpend, newMag, PHOTON_BLASTS, readMag, type MagData, type MagStat, type PhotonBlastId } from './mag';
import { passiveRanks, rankAmt, rankMult, weaponFits, type PassiveId } from './passives';
import { emptySkills, migrateSkills, modNodeId, pointsSpent, rankDown, rankOf, rankUp, rankUpBlock, readSkills, skillNodes, skillPoints, starterArt, type SkillPicks } from './skills';

// Persistent character state plus derived-stat helpers. No rendering here.

export interface ItemInstance {
  uid: string;
  id: string;
  qty?: number;
  /**
   * Old saves only: grind levels and Bane (race levels). Grinding went on 2026-10-11 (the user's call): every weapon,
   * frame and barrier counts as fully ground (`grindLevels`); both fields are dropped on load.
   */
  grind?: number;
  bane?: Record<string, number>;
  /** Old saves only: a rolled weapon special (specials went on 2026-10-21; dropped on load). */
  special?: string;
  /** Normal when missing; a def marked `rare` is always unique. */
  rarity?: Rarity;
  /** Rolled affixes (a unique's fixed ones are on its def). */
  affixes?: AffixRoll[];
  /** A rare's rolled name ("Doom Edge"). */
  name?: string;
  /** Old saves only: units that sat in this frame (moved to the Mag on load). */
  units?: ItemInstance[];
  /** Old saves only: a frame's unit slots (dropped on load since 2026-10-21). */
  slots?: number;
  /** Injectors: the rolled mod, and doses ready (undefined = full). */
  mod?: InjectorMod;
  charge?: number;
  /** Item level when it isn't its tier's (Falz Rift drops: 100 + the rift tier, which opens affix tiers 7-8). */
  ilvl?: number;
  /** Old saves only: a rare's dormant affixes, for Photon Crystals to swap in (2026-10-13 to 10-22; dropped on load). */
  dormant?: AffixRoll[];
  /** Old saves only: crafting Potential and Crystal / Augment offers (both went on 2026-10-13; dropped on load). */
  pot?: number;
  potMax?: number;
  offers?: unknown;
}

/**
 * Save format. Saves from before classes came back (versions 1-4) are deleted, not migrated. Version 5 had classes
 * (Hunter, Ranger, Force): those load and are converted (2026-10-21; the constructor says how).
 */
export const SAVE_VERSION = 6;
/** Save versions that still load (and are brought up to SAVE_VERSION). */
export const LOADABLE_VERSIONS = [5, 6];

export interface CharacterData {
  version: typeof SAVE_VERSION;
  name: string;
  /** Old saves only: the class (Hunter, Ranger, Force) until the classes went on 2026-10-21. */
  cls?: string;
  /** Appearance chosen at creation. */
  appearance?: Look;
  level: number;
  xp: number; // progress toward next level
  meseta: number;
  inventory: ItemInstance[];
  equipped: Partial<Record<GearSlot, string>>;
  /** Arts (2026-10-14): what sits on RMB, Q, E and R. */
  arts: ArtLoadout;
  /** The Skills trees (2026-10-15): ranks in Arts and passives, and the Arts' modifier picks (skills.ts). */
  skills: SkillPicks;
  /** Old saves only (turned into skills on load): the four passive slots. */
  passives?: unknown;
  /** The photon blast the Mag teaches (picked on the Mag tab from magCfg.pbLevel). */
  photonBlast?: PhotonBlastId;
  /** Old saves only (dropped on load): the action palette, the wheel's technique and the talent picks. */
  palette?: unknown;
  selectedTech?: unknown;
  talents?: unknown;
  /** Mag points per stat (permanent). */
  mag: MagData;
  /**
   * Learned units: one per kind (its affix, or a unique unit's own), the best roll found. Picking up a better one
   * replaces it.
   */
  units: ItemInstance[];
  /** Kinds slotted in the Mag (up to MAG_UNIT_SLOTS, all of them active). */
  magUnits: UnitKind[];
  stats: {
    kills: number;
    deaths: number;
    playSeconds: number;
    /** Bosses beaten on Normal (each opens the next expedition, some a shop tier). */
    bossKills: Partial<Record<BossId, number>>;
    /** Pylons lit (the first one explains them). */
    pylonsLit?: number;
    /** Unused since classes came back (old saves are deleted); kept so the unlock checks read the same. */
    nightmareKept?: boolean;
    dashes?: number;
    /** Bosses beaten on Hard (each opens the next Hard expedition and a shop tier). */
    hardKills?: Partial<Record<BossId, number>>;
    /** Bosses beaten on Hell (each opens the next Hell expedition and a shop tier). */
    hellKills?: Partial<Record<BossId, number>>;
  };
  /** Falz Rifts (after the Hell Dark Falz): the tier ladder, the shard stash and counts (see rifts.ts riftSave). */
  rift?: RiftSave;
  /**
   * 2 once affix rolls are in the 2026-10-14 units (damage taken in %, Weapon damage % on the whole hit). Older saves
   * convert on load: DFP rolls become Strike damage taken, Bastion and the downside penalties shrink to the new
   * scale, Weapon damage % and Reckless come down to their new tops.
   */
  affixUnits?: number;
}

/** Art slots on the bar: RMB, Q, E, R. */
export const ART_SLOTS = 4;

/**
 * The Art bar: one since 2026-10-21 (it was one per weapon kind in hand, when weapons had Arts of their own). Unset
 * until the player changes it.
 */
export interface ArtLoadout {
  bar?: (ArtId | null)[];
  /** Old saves only: a bar per weapon kind ('none': bare hands). */
  bars?: Record<string, unknown>;
}

/**
 * The saved Art bar with anything that no longer exists dropped. An old save's bars (one per weapon kind) become the
 * bar of the weapon in hand (`held`), or the first one kept.
 */
function readArts(raw: unknown, held: string | undefined): ArtLoadout {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as ArtLoadout;
  const old = r.bars ?? {};
  const bar = r.bar ?? (held && old[held]) ?? old.rod ?? old.wand ?? old.none;
  if (!Array.isArray(bar)) return {};
  const seen = new Set<string>();
  return {
    bar: Array.from({ length: ART_SLOTS }, (_, i) => {
      const id = bar[i];
      if (typeof id !== 'string' || seen.has(id) || !Object.hasOwn(ARTS, id)) return null;
      seen.add(id);
      return id as ArtId;
    }),
  };
}

let uidCounter = 0;
/** Equip-requirement failure text. */
function reqReason(level: number, have: number): string {
  return `Requires Lv ${level} (you are Lv ${have})`;
}

export function newUid(): string {
  uidCounter = (uidCounter + 1) % 1e6;
  return `${Date.now().toString(36)}${uidCounter.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function makeItem(id: string, extra: Partial<ItemInstance> = {}): ItemInstance {
  const def = getDef(id);
  const inst: ItemInstance = { uid: newUid(), id, ...extra };
  if (isStackable(def) && inst.qty === undefined) inst.qty = 1;
  return inst;
}

/**
 * Rift-forged items (item level above 100): how much their base stats are raised (1 = not forged). It stops at the
 * deepest rift's item level (drops from the old, deeper tiers count as from there).
 */
export function forgeMult(inst: Pick<ItemInstance, 'ilvl'>): number {
  return inst.ilvl && inst.ilvl > 100 ? 1 + drops.riftForgePerTier * (Math.min(inst.ilvl, RIFT_TOP_ILVL) - 100) : 1;
}

/**
 * An item's definition with its base stats as this copy has them: a Rift-forged drop's stat bonuses, or armour damage
 * taken and bonuses, raised by `forgeMult`; a frame or barrier's bonuses raised by its
 * (built-in) grind levels too (a weapon's grind is Edge, added by grindBonus). Everything that reads base stats goes
 * through this.
 */
export function statDef(inst: ItemInstance): ItemDef {
  const def = getDef(inst.id);
  const refine = def.type === 'armor' ? 1 + formulas.refineArmorPct * grindLevels(inst) : 1;
  const k = forgeMult(inst) * refine;
  if (k === 1) return def;
  const bonus = def.type === 'weapon' || def.type === 'armor' ? def.bonus : undefined;
  const scaled = bonus ? (Object.fromEntries(Object.entries(bonus).map(([s, v]) => [s, Math.round((v as number) * k)])) as StatBonus) : undefined;
  if (def.type === 'weapon') return { ...def, ...(scaled ? { bonus: scaled } : {}) };
  // The damage-taken cut grows with Rift-forging only (the table value is already the fully ground one).
  if (def.type === 'armor') return { ...def, dr: Math.round(def.dr * forgeMult(inst)), ...(scaled ? { bonus: scaled } : {}) };
  return def;
}

/** Normal, magic, rare or unique (a def marked `rare` is always unique). */
export function rarityOf(inst: ItemInstance): Rarity {
  return getDef(inst.id).rare ? 'unique' : (inst.rarity ?? 'normal');
}

/** The item's own affixes: a unique's fixed ones, then what it rolled. */
export function ownAffixes(inst: ItemInstance): AffixRoll[] {
  const fixed = getDef(inst.id).fixed ?? [];
  return inst.affixes?.length ? [...fixed, ...inst.affixes] : fixed;
}


/**
 * Saved affix rolls made current: ATA and EVP went on 2026-10-09 (ATA rolls become LCK, EVP rolls DFP, the
 * heavy hit-chance cap is gone); anything else unknown is dropped, and Mending rolls are capped at its new top.
 * TP per staff hit became TP a second on 2026-10-10 (capped at its top). Cast speed became Haste on 2026-10-11:
 * capped at the item tier's Haste top, dropped below tier 8 (no Haste there), the larger one kept if the item
 * already has Haste. Race % went with enemy races on 2026-10-17: those rolls are dropped here (unknown), and
 * upgradeCrafting tops the item back up to its counts with fresh ones.
 */
function readAffixes(rolls: AffixRoll[], tier = 1, legacy = false): AffixRoll[] {
  // Foie / Zonde / Barta damage became Fire / Lightning / Ice damage on 2026-10-14 (the Arts redesign).
  const renamed: Record<string, ItemAffixId> = { ata: 'lck', evp: 'strike', dfp: 'strike', staffTp: 'tpRegen', foiePct: 'firePct', zondePct: 'lightningPct', bartaPct: 'icePct' };
  const out: AffixRoll[] = [];
  for (const raw of rolls) {
    // The weapon damage, melee and gun affixes went with the classes (2026-10-21): upgradeCrafting rolls replacements.
    if (RETIRED_AFFIXES.includes(raw.id)) continue;
    const r = legacy ? toPercentUnits(raw) : raw;
    if ((r.id as string) === 'castSpeed') {
      const cap = hasteCfg.capByTier[tier];
      if (!cap) continue;
      const v = Math.min(r.v, cap);
      const had = out.find((x) => x.id === 'haste') ?? rolls.find((x) => x.id === 'haste');
      if (had) had.v = Math.max(had.v, v);
      else out.push({ id: 'haste', v });
      continue;
    }
    const id = renamed[r.id] ?? r.id;
    if (!ITEM_AFFIXES[id]) continue;
    if (id === 'haste' && out.some((x) => x.id === 'haste')) continue;
    // Mending works in fights since 2026-10-09, at lower values: old rolls come down to the new top.
    const v = id === 'regen' || id === 'tpRegen' ? Math.min(r.v, tierRange(ITEM_AFFIXES[id].tiers, AFFIX_TIERS)[1]) : r.v;
    out.push({ ...r, id, v });
  }
  return out;
}

/**
 * One saved roll moved to the 2026-10-14 units: DFP (and EVP) became Strike damage taken (about 6 DFP a %), and Bastion
 * and the downside penalties (DFP) shrank to the new scale.
 */
function toPercentUnits(r: AffixRoll): AffixRoll {
  const id = r.id as string;
  if (id === 'dfp' || id === 'evp') return { ...r, id: 'strike', v: Math.max(1, Math.round(r.v / 6)) };
  if (id === 'areaDr') return { ...r, v: Math.max(1, Math.round((r.v * 2) / 3)) };
  if (id === 'brittle') return { ...r, ...(r.p ? { p: Math.max(1, Math.round(r.p / 6)) } : {}) };
  return r;
}

/**
 * Items of kinds that went made current: four kinds on 2026-10-14, and with the classes on 2026-10-21 every blade
 * and the Cane become a Rod, every gun a Wand, Guard and Combat armour Psy, each of the same tier (uniques keep their
 * ids: their bases changed instead). Weapon specials are gone. The Pig Ray unit became the Azure Ray on 2026-10-22
 * (bag, learned and in the Mag). Safe to run more than once.
 */
function convertRetiredItems(data: CharacterData): void {
  for (const it of data.inventory) {
    const m = /^([a-z]+)_(\d+)$/.exec(it.id);
    const kind = m && Object.hasOwn(RETIRED_KINDS, m[1]) ? RETIRED_KINDS[m[1]] : null;
    if (kind) it.id = `${kind}_${m![2]}`;
    const a = /^(frame|barrier)_([a-z]+)_(\d+)$/.exec(it.id);
    if (a && RETIRED_LINES.includes(a[2])) it.id = `${a[1]}_psy_${a[3]}`;
    delete it.special;
  }
  for (const it of [...data.inventory, ...(data.units ?? [])]) if (it.id === 'uunit_pigRay') it.id = 'uunit_azureRay';
  data.magUnits = data.magUnits?.map((k) => ((k as string) === 'pigRay' ? 'azureRay' : k));
}

/**
 * Every saved affix roll made current (readAffixes), and old units moved to the 2026-10-14 ones once (`affixUnits`).
 * Safe to run more than once. Save loading calls it before anything else reads the rolls (upgradeCrafting does: a
 * roll with a retired id would break it, and it tops converted items back up to their affix counts), and the
 * Character constructor again. Items of retired kinds are converted first.
 */
export function readAffixData(data: CharacterData): CharacterData {
  convertRetiredItems(data);
  const legacy = (data.affixUnits ?? 1) < 2;
  // Units that still sit in frames (older saves; the constructor moves them to the Mag) included.
  for (const it of [...data.inventory, ...data.inventory.flatMap((x) => x.units ?? []), ...(data.units ?? [])]) {
    const def = itemDefs[it.id];
    if (!def) continue;
    const tier = 'tier' in def ? def.tier : 1;
    if (it.affixes) it.affixes = readAffixes(it.affixes, tier, legacy);
    // Dormant affixes went with crafting (2026-10-22).
    delete it.dormant;
  }
  // Units learned as DFP are Strike units now; units of retired affixes (Power, Fury) are gone.
  const emptyUnit = (u: ItemInstance) => itemDefs[u.id]?.type === 'unit' && !itemDefs[u.id].unique && !!u.affixes && !u.affixes.length;
  if (data.units) data.units = data.units.filter((u) => !emptyUnit(u));
  data.inventory = data.inventory.filter((u) => !emptyUnit(u));
  data.magUnits = data.magUnits?.map((k) => ((k as string) === 'dfp' ? 'strike' : k)).filter((k) => !RETIRED_AFFIXES.includes(k));
  data.affixUnits = 2;
  return data;
}

/** Sum of one affix over a list of rolls. */
function affixSum(rolls: AffixRoll[], id: ItemAffixId): number {
  let t = 0;
  for (const r of rolls) if (r.id === id) t += r.v;
  return t;
}

/** A unit's own name, as the Mag tab lists it: its affix's unit word ("Heart"), or a unique unit's name. */
export function unitTitle(inst: ItemInstance): string {
  const def = getDef(inst.id);
  if (def.unique) return def.name;
  const a = inst.affixes?.[0];
  return a ? (ITEM_AFFIXES[a.id].unit ?? ITEM_AFFIXES[a.id].word) : 'Unit';
}

/** What a unit is called as an item: "Heart Unit" (a unique unit its own name). */
function unitName(inst: ItemInstance): string {
  return getDef(inst.id).unique || !inst.affixes?.[0] ? unitTitle(inst) : `${unitTitle(inst)} Unit`;
}

/**
 * The item's name. Magic items take a word from their prefix affix and their suffix ("Mystic Pole of Luck"), rares
 * their rolled name ("Doom Spire"), uniques their own.
 */
export function itemName(inst: ItemInstance): string {
  const def = getDef(inst.id);
  if (def.type === 'unit') return unitName(inst);
  let name = def.name;
  if (def.type === 'injector' && inst.mod) name = `${INJECTOR_MODS[inst.mod].name} ${name}`;
  const rarity = rarityOf(inst);
  if (rarity === 'rare' && inst.name) name = inst.name;
  else if (rarity === 'magic') {
    const pre = inst.affixes?.find((a) => ITEM_AFFIXES[a.id].kind === 'prefix');
    const suf = inst.affixes?.find((a) => ITEM_AFFIXES[a.id].kind === 'suffix');
    if (pre) name = `${ITEM_AFFIXES[pre.id].word} ${name}`;
    if (suf) name += ` ${ITEM_AFFIXES[suf.id].word}`;
  }
  if (inst.qty !== undefined && inst.qty > 1) name += ` x${inst.qty}`;
  return name;
}

/**
 * Grind levels an item counts as having: every weapon, frame and barrier is fully ground (its tier's cap, uniques 2
 * more) since grinders went on 2026-10-11 (the user's call: grinding had no choice left in it, and a fresh drop
 * started a dozen levels behind the gear it should replace). 0 for anything else.
 */
export function grindLevels(inst: Pick<ItemInstance, 'id'>): number {
  const def = getDef(inst.id);
  return def.type === 'weapon' || def.type === 'armor' ? grindCap(def) : 0;
}

const RARITY_PRICE: Record<Rarity, number> = { normal: 1, magic: 1.6, rare: 2.8, unique: 1 };

export function sellPrice(inst: ItemInstance): number {
  const def = getDef(inst.id);
  let p = (def.price / 4) * RARITY_PRICE[rarityOf(inst)];
  if (inst.mod) p *= 1.4;
  return Math.max(1, Math.floor(p)) * (inst.qty ?? 1);
}

/** What `edge` grind levels add to a weapon: a share of its Tech damage. */
export function grindBonus(def: WeaponItemDef, edge: number): number {
  const mst = def.bonus.mst;
  return mst ? Math.round(edge * formulas.edgeMstPct * mst) : 0;
}

/** A weapon's flat stat bonuses with `edge` grind levels counted (Edge raises its Tech damage). */
export function weaponBonus(def: WeaponItemDef, edge: number): StatBonus {
  const out = { ...def.bonus };
  const g = grindBonus(def, edge);
  if (g) out.mst = (out.mst ?? 0) + g;
  return out;
}

/** Flat stats a set of affixes adds (stat affixes, and downside penalties taken off). */
export function affixStats(rolls: AffixRoll[]): StatBonus {
  const out: StatBonus = {};
  for (const r of rolls) {
    const def = ITEM_AFFIXES[r.id];
    if (def.stat) out[def.stat] = (out[def.stat] ?? 0) + r.v;
    if (def.penalty && r.p) {
      for (const k of def.penalty.stat === 'dr' ? (['strike', 'area'] as const) : [def.penalty.stat]) out[k] = (out[k] ?? 0) - r.p;
    }
  }
  return out;
}

/** The weapon used when nothing is equipped (its kind: BARE_KIND, a weak bolt). */
const BARE_HANDS: WeaponItemDef = {
  id: '__bare', type: 'weapon', name: 'Bare hands', kind: 'wand', tier: 0, req: 0, price: 0, bonus: {},
};

export class Character {
  constructor(public data: CharacterData) {
    // Blades, guns and Guard / Combat armour become rods, wands and Psy armour (2026-10-21, the classes went).
    convertRetiredItems(data);
    // Items that no longer exist (the Telepipe went on 2026-10-11) leave the bag.
    data.inventory = data.inventory.filter((it) => itemDefs[it.id]);
    data.mag = readMag(data.mag);
    // The Arts redesign (2026-10-14): the action palette, the wheel's technique and the talents went. A photon blast
    // picked in the talents' last row stays picked (the Mag teaches it now).
    const oldPb = Array.isArray(data.talents) ? (data.talents as unknown[])[9] : null;
    if (!data.photonBlast && typeof oldPb === 'string') data.photonBlast = ({ pbMylla: 'mylla', pbLeilla: 'leilla', pbFarlla: 'farlla' } as Record<string, PhotonBlastId>)[oldPb];
    if (data.photonBlast && !PHOTON_BLASTS[data.photonBlast]) delete data.photonBlast;
    delete data.palette;
    delete data.selectedTech;
    delete data.talents;
    // A Hunter's or Ranger's skills and Art bars were for trees that went with the classes (2026-10-21): they start
    // over with Foie learned, like a new character, and every other point back to spend (a Force's stay).
    const fromOldClass = data.cls === 'hunter' || data.cls === 'ranger';
    if (fromOldClass) {
      data.skills = emptySkills();
      data.arts = {};
    }
    const held = data.inventory.find((it) => it.uid === data.equipped.weapon);
    data.arts = readArts(data.arts, held && /^([a-z]+)_\d+$/.exec(held.id)?.[1]);
    // The Skills trees (2026-10-15, ranked): saves from before them learn the Arts on their bars and their old passives
    // a rank each (skills.ts migrateSkills); the rest is left to spend.
    const raw = data.skills as unknown;
    if (raw && typeof raw === 'object' && 'ranks' in raw) data.skills = readSkills(raw, data.level);
    else {
      const old = [...(Array.isArray(data.passives) ? data.passives : []), ...(raw && typeof raw === 'object' ? Object.keys(raw) : [])].filter((x): x is string => typeof x === 'string');
      data.skills = migrateSkills(data.level, (data.arts.bar ?? []).filter((x): x is ArtId => !!x), old);
    }
    delete data.passives;
    delete data.cls;
    data.version = SAVE_VERSION;
    data.stats.bossKills ??= {};
    data.units ??= [];
    // Units used to sit in frames: move them to the Mag (any beyond its slots go back to the bag).
    for (const it of data.inventory) {
      if (!it.units?.length) continue;
      for (const u of it.units) (data.units.length < MAG_UNIT_SLOTS ? data.units : data.inventory).push(u);
      delete it.units;
    }
    for (const it of data.inventory) {
      // Grind levels and Bane went on 2026-10-11: every weapon, frame and barrier counts as fully ground now.
      delete it.grind;
      delete it.bane;
      // Frames' unit slots went on 2026-10-21: the Mag always runs four.
      delete it.slots;
    }
    readAffixData(data);
    if (!data.magUnits) {
      // Units used to be bag items slotted into the Mag: learn every one (Mag and bag, the best of each kind)
      // and keep the Mag's slots. Weaker copies stay in the bag as junk to sell.
      const slotted = data.units;
      data.units = [];
      data.magUnits = [];
      for (const u of slotted) {
        this.learnUnit(u);
        const kind = unitKind(u);
        if (kind && !data.magUnits.includes(kind) && data.magUnits.length < MAG_UNIT_SLOTS) data.magUnits.push(kind);
      }
      for (const u of data.inventory.filter((it) => getDef(it.id).type === 'unit')) if (this.learnUnit(u) !== false) this.removeItem(u.uid, 1);
    }
    if (fromOldClass) {
      const first = starterArt((id) => this.artUsable(id, true));
      if (first) this.rankUp(first);
    }
  }

  /** Times this boss has been beaten on a difficulty (`true` = Nightmare, `false` = Normal). */
  bossKills(boss: BossId, d: Difficulty | boolean): number {
    const st = this.data.stats;
    const diff = asDifficulty(d);
    return (diff === 'hell' ? st.hellKills?.[boss] : diff === 'nightmare' ? st.hardKills?.[boss] : st.bossKills[boss]) ?? 0;
  }

  /** Count a boss kill; returns the new count. */
  addBossKill(boss: BossId, d: Difficulty | boolean): number {
    const st = this.data.stats;
    const diff = asDifficulty(d);
    const kills = diff === 'hell' ? (st.hellKills ??= {}) : diff === 'nightmare' ? (st.hardKills ??= {}) : st.bossKills;
    return (kills[boss] = (kills[boss] ?? 0) + 1);
  }

  static create(name: string, appearance?: Look): Character {
    const weapon = makeItem(START_WEAPON);
    const frame = makeItem('frame_1');
    const injector = makeItem(START_INJECTOR);
    const data: CharacterData = {
      version: SAVE_VERSION,
      name,
      appearance: appearance && { ...appearance, colors: appearance.colors && Object.keys(appearance.colors).length ? { ...appearance.colors } : undefined },
      level: 1,
      xp: 0,
      meseta: 300,
      inventory: [weapon, frame, injector],
      equipped: { weapon: weapon.uid, frame: frame.uid, injector: injector.uid },
      arts: {},
      skills: emptySkills(),
      mag: newMag(),
      units: [],
      magUnits: [],
      stats: { kills: 0, deaths: 0, playSeconds: 0, bossKills: {} },
      affixUnits: 2,
    };
    const ch = new Character(data);
    // A new character knows Foie: the Lv 1 point goes there.
    const first = starterArt((id) => ch.artUsable(id, true));
    if (first) ch.rankUp(first);
    return ch;
  }

  get level() {
    return this.data.level;
  }

  // ------------------------------------------------------------ Arts

  /** Base TP at this level (gear and the Mag left out): basic refills scale with it. */
  baseTp(): number {
    return statsAtLevel(this.data.level).tp;
  }

  /** Can this Art go on the bar: learned in the Skills trees (`unlearned`: or could be, by level)? */
  artUsable(id: ArtId, unlearned = false): boolean {
    const a = ARTS[id];
    if (!a || this.data.level < a.level) return false;
    return unlearned || this.artRank(id) >= 1;
  }

  /** Every Art that can go on the bar now: attack techniques, then Resta, each in unlock order. */
  artsFor(): ArtId[] {
    const rank = (id: ArtId) => (SUPPORT_ARTS.includes(id) ? 1000 : 0) + ARTS[id].level;
    return ART_IDS.filter((id) => this.artUsable(id)).sort((a, b) => rank(a) - rank(b));
  }

  /** The Art bar (RMB, Q, E, R). Until the player changes it, it is the first Arts learned (read only, so a gear
   *  preview never writes a bar into the save). */
  artBar(): readonly (ArtId | null)[] {
    return this.data.arts.bar ?? this.defaultBar();
  }

  /** What fills the bar by itself, in unlock order (attack techniques first on a tie), so a slot never moves as Arts unlock. */
  private defaultBar(): (ArtId | null)[] {
    const rank = (id: ArtId) => ARTS[id].level * 10 + (SUPPORT_ARTS.includes(id) ? 1 : 0);
    const fits = ART_IDS.filter((id) => this.artUsable(id)).sort((a, b) => rank(a) - rank(b));
    return Array.from({ length: ART_SLOTS }, (_, i) => fits[i] ?? null);
  }

  /** The bar as stored, made from the default the first time the player changes it. */
  private ownBar(): (ArtId | null)[] {
    return (this.data.arts.bar ??= this.defaultBar());
  }

  /** The Art in a bar slot, if it is learned. */
  artInSlot(slot: number): ArtId | null {
    const id = this.artBar()[slot] ?? null;
    return id && this.artUsable(id) ? id : null;
  }

  /** Slot an Art (null empties the slot). An Art already elsewhere on the bar swaps places. Returns why not, or null. */
  setArtSlot(slot: number, id: ArtId | null): string | null {
    if (slot < 0 || slot >= ART_SLOTS) return 'No such slot';
    if (id && !this.artUsable(id)) return `${ARTS[id]?.name ?? 'That Art'} isn't learned yet`;
    const bar = this.ownBar();
    const at = id ? bar.indexOf(id) : -1;
    if (at >= 0) bar[at] = bar[slot];
    bar[slot] = id;
    return null;
  }

  /** Has this modifier taken in the Skills trees (a node forking below its Art)? */
  artMod(id: ArtId, mod: string): boolean {
    return rankOf(this.data.skills, modNodeId(id, mod)) > 0;
  }

  /** An Art's rank in the Skills trees (0: not learned). */
  artRank(id: ArtId): number {
    return rankOf(this.data.skills, id);
  }

  /** An Art's power from its rank (damage, and Resta's healing): skillCfg. */
  artRankPower(id: ArtId): number {
    const r = Math.max(1, this.artRank(id));
    return skillCfg.artBasePower * (1 + skillCfg.artPowerPerRank * (r - 1));
  }

  /** An Art's TP multiplier from its rank. */
  artRankTp(id: ArtId): number {
    return 1 - skillCfg.artTpPerRank * (Math.max(1, this.artRank(id)) - 1);
  }

  /** TP for one cast of an Art now (Combat adds Clarity, Overload and the like). */
  artCost(id: ArtId): number {
    // The Limiter: every technique costs more.
    const limiter = this.hasUnique('limiter') ? 1 + this.uval(uniqueCfg.limiterTp) : 1;
    return Math.max(1, Math.round(this.techCost(id) * limiter));
  }

  /** An Art's timing now: wind-up and recovery sped up by Haste and cast speed, and the casting perfect window. */
  artTiming(id: ArtId): AttackTiming {
    const a = ARTS[id];
    let { windup, recovery } = a;
    if (this.artMod(id, 'quick')) {
      windup *= 0.7;
      recovery *= 0.7;
    }
    const k = this.castTimeMult();
    return { windup: windup * k, active: 0, recovery: recovery * k, perfect: casting.perfect, grace: casting.grace };
  }

  /** The basic step's timing: the weapon kind's bolt, sped up by Haste. */
  basicTiming(): AttackTiming {
    return hastened(this.weaponKind().timing, this.hasteMult());
  }

  /** The attack technique the estimates measure (the first one on the bar, or the first one learned). */
  mainTech(): TechId {
    const bar = this.artBar().filter((id): id is TechId => !!id && isAttackTech(id));
    return bar[0] ?? ATTACK_TECHS.find((t) => this.artUsable(t)) ?? 'foie';
  }

  // ------------------------------------------------------------ skills (ranked Arts and passives)

  /** Skill points at this level, and those not spent. */
  get skillPoints(): number {
    return skillPoints(this.data.level);
  }

  get skillPointsLeft(): number {
    return Math.max(0, this.skillPoints - pointsSpent(this.data.skills));
  }

  /** The Skills tab badge: points left while something can take one. */
  get skillPointsFree(): number {
    const left = this.skillPointsLeft;
    return left > 0 && skillNodes().some((n) => !rankUpBlock(this.data.level, this.data.skills, n)) ? left : 0;
  }

  /** Put a rank into a skill (an Art just learned goes into a free slot of a changed bar). Returns why not, or null. */
  rankUp(id: string): string | null {
    const err = rankUp(this.data.level, this.data.skills, id);
    if (!err && Object.hasOwn(ARTS, id) && this.artRank(id as ArtId) === 1) {
      const bar = this.data.arts.bar;
      const free = bar ? bar.indexOf(null) : -1;
      if (bar && free >= 0 && !bar.includes(id as ArtId) && this.artUsable(id as ArtId)) bar[free] = id as ArtId;
    }
    return err;
  }

  /** Take a rank out of a skill (an Art taken back to 0 leaves the bar). Returns why not, or null. */
  rankDown(id: string): string | null {
    const err = rankDown(this.data.skills, id);
    if (!err && Object.hasOwn(ARTS, id) && this.artRank(id as ArtId) === 0) {
      const bar = this.data.arts.bar;
      bar?.forEach((x, i) => x === id && (bar[i] = null));
    }
    return err;
  }

  /** A passive's rank, whatever the weapon in hand. */
  passiveRank(id: PassiveId): number {
    return rankOf(this.data.skills, id);
  }

  passiveTaken(id: PassiveId): boolean {
    return this.passiveRank(id) > 0;
  }

  /** Learned, and what is in hand lets it work (bolt passives need a rod or wand). */
  hasPassive(id: PassiveId): boolean {
    return this.passiveTaken(id) && weaponFits(id, !!this.weaponInstance());
  }

  /** How much of a passive's full effect works now: its rank over its top rank (0 if not learned or bare-handed). */
  passiveK(id: PassiveId): number {
    return this.hasPassive(id) ? Math.min(1, this.passiveRank(id) / passiveRanks(id)) : 0;
  }

  /** A passive's multiplier at its rank (1 without it), from its full value. */
  pMult(id: PassiveId, full: number): number {
    return rankMult(full, this.passiveK(id));
  }

  /** A passive's amount at its rank (0 without it), from its full value. */
  pAmt(id: PassiveId, full: number): number {
    return rankAmt(full, this.passiveK(id));
  }

  // ------------------------------------------------------------ photon blast

  /** The photon blast the Mag fires (once it teaches them, magCfg.pbLevel), if one is picked. */
  get photonBlast(): PhotonBlastId | null {
    return this.data.level >= magCfg.pbLevel ? (this.data.photonBlast ?? null) : null;
  }

  // ---------------------------------------------------------------- Mag

  get mag(): MagData {
    return (this.data.mag ??= newMag());
  }

  /** Unspent Mag points. */
  get magPoints(): number {
    return magPointsFree(this.mag, this.data.level);
  }

  /** Put points into a Mag stat (permanent). */
  spendMag(stat: MagStat, n = 1): string | null {
    return magSpend(this.mag, this.data.level, stat, n);
  }

  // ------------------------------------------------------------- stats

  /** Level-up stats. */
  baseStats(): Stats {
    return statsAtLevel(this.data.level);
  }

  /** Base + Mag: the character's own stats, before gear. */
  ownStats(): Stats {
    const s = this.baseStats();
    for (const [k, v] of Object.entries(magBonuses(this.mag))) s[k as StatKey] += v;
    return s;
  }

  /** Affix rolls from everything worn (weapon, frame, barrier) and the Mag's active units. */
  wornAffixes(): AffixRoll[] {
    const out: AffixRoll[] = [];
    for (const slot of ['weapon', 'frame', 'barrier'] as const) {
      const inst = this.equippedItem(slot);
      if (inst) out.push(...ownAffixes(inst));
    }
    for (const u of this.activeUnits()) out.push(...ownAffixes(u));
    return out;
  }

  /** The learned unit of this kind, if any. */
  learnedUnit(kind: UnitKind): ItemInstance | undefined {
    return this.data.units.find((u) => unitKind(u) === kind);
  }

  /** The units slotted in the Mag, in its order. */
  slottedUnits(): ItemInstance[] {
    return this.data.magUnits.map((k) => this.learnedUnit(k)).filter((u): u is ItemInstance => !!u);
  }

  /** The Mag's units at work: every one slotted (2026-10-21; frames' unit slots used to switch some off). */
  activeUnits(): ItemInstance[] {
    return this.slottedUnits().slice(0, MAG_UNIT_SLOTS);
  }

  /** The Mag has a free slot and a learned unit isn't slotted: worth a look at the Mag tab. */
  get unitSlotIdle(): boolean {
    return this.data.magUnits.length < MAG_UNIT_SLOTS && this.data.units.length > this.data.magUnits.length;
  }

  /** What a unit means to this character: a kind not learned yet, a better roll than the learned one, or no use. */
  unitStatus(inst: ItemInstance): 'new' | 'better' | 'known' {
    const kind = unitKind(inst);
    if (!kind) return 'known';
    const have = this.learnedUnit(kind);
    if (!have) return 'new';
    return unitBetter(inst, have) ? 'better' : 'known';
  }

  /**
   * Learn a unit (it is used up): a new kind joins the learned units, a better roll replaces the learned one (which
   * is gone; a slotted kind stays slotted). Returns the roll it replaced (null for a new kind), or false if it is no
   * use (that kind is learned at least as well).
   */
  learnUnit(inst: ItemInstance): AffixRoll | null | false {
    if (this.unitStatus(inst) === 'known') return false;
    const u = this.data.units;
    const i = u.findIndex((x) => unitKind(x) === unitKind(inst));
    if (i < 0) {
      u.push(inst);
      return null;
    }
    const before = u[i].affixes![0];
    u[i] = inst;
    return before;
  }

  /**
   * Take an item in: a unit worth learning is learned (no bag slot needed), anything else goes to the bag.
   * 'learned' (with the roll it replaced), 'bag', or 'full'.
   */
  take(inst: ItemInstance): { to: 'learned'; before: AffixRoll | null } | { to: 'bag' | 'full' } {
    if (getDef(inst.id).type === 'unit') {
      const before = this.learnUnit(inst);
      if (before !== false) return { to: 'learned', before };
    }
    return this.addItem(inst) ? { to: 'bag' } : { to: 'full' };
  }

  /** Total of one affix over everything worn. */
  gearAffix(id: ItemAffixId): number {
    return affixSum(this.wornAffixes(), id);
  }

  /** Stats including Mag and equipment (not runtime buffs or caps); damage taken comes uncapped (damageTaken caps it). */
  stats(): Stats {
    const s = this.ownStats();
    const w = this.weaponDef();
    addBonus(s, weaponBonus(w, this.weaponEdge()));
    for (const slot of ['frame', 'barrier'] as const) {
      const inst = this.equippedItem(slot);
      if (!inst) continue;
      const def = statDef(inst);
      if (def.type === 'armor') {
        s.strike += def.dr;
        s.area += def.dr;
        addBonus(s, def.bonus);
      }
    }
    addBonus(s, affixStats(this.wornAffixes()));
    if (this.hasUnique('overclockCore')) s.hp = Math.round(s.hp * uniqueCfg.overclockHpMult);
    // Max TP the Yasakani Magatama and Dark Bridge cost.
    if (this.hasUnique('yasakani')) s.tp = Math.round(s.tp * Math.max(0.1, 1 - this.uval(uniqueCfg.yasakaniTp)));
    if (this.hasUnique('darkBridge')) s.tp = Math.round(s.tp * (1 - uniqueCfg.bridgeTp));
    return s;
  }

  /** Haste % that only lasts a while (Dragon Fang's Rampage), set by combat. Not saved. */
  extraHaste = 0;

  /** All healing's multiplier (DF Shield takes some away). */
  healMult(): number {
    return this.hasUnique('dfShield') ? 1 - uniqueCfg.dfHeal : 1;
  }

  /** Haste % from what is worn (Haste and Frail affixes): it adds up (the Overclock Core doubles it). */
  haste(): number {
    const h = this.gearAffix('haste') + this.gearAffix('frail');
    return (this.hasUnique('overclockCore') ? h * uniqueCfg.overclockHasteMult : h) + this.extraHaste;
  }

  /** Is this unique worn (weapon, frame or barrier), or a unique unit active in the Mag? Its effect works while it is. */
  hasUnique(id: UniqueId): boolean {
    if (UNIQUES[id].base.type === 'unit') return this.activeUnits().some((u) => getDef(u.id).unique === id);
    for (const slot of ['weapon', 'frame', 'barrier'] as const) {
      const inst = this.equippedItem(slot);
      if (inst && getDef(inst.id).unique === id) return true;
    }
    return false;
  }

  /**
   * A unique unit's number, raised by the Heart of Falz (its own aside): `base` is the effect (or cost) at strength 1.
   * Effects scale away from 1 for multipliers: uval(0.3) is 0.45 with the Heart.
   */
  uval(base: number): number {
    return this.hasUnique('heartOfFalz') ? base * uniqueCfg.heartMult : base;
  }

  /** Crit chance in percent (the crit stat is kept in tenths), capped. */
  critChance(): number {
    return critChance(this.stats().lck);
  }

  /** Damage multiplier of a crit: ×2, plus Crit damage affixes (and the Red Ring's +100%). */
  critDamage(): number {
    return formulas.critDamage + this.gearAffix('critDmg') / 100 + (this.hasUnique('redRing') ? uniqueCfg.redRingCrit : 0)
      - (this.hasUnique('venomSac') ? this.uval(uniqueCfg.venomSacCrit) : 0);
  }

  /** Strike or Area damage taken, in % less: gear, Mag and level (Farlla adds in combat), capped. */
  damageTaken(kind: 'strike' | 'area', buff = 0): number {
    return Math.min(AFFIX_CAPS.damageTaken, this.stats()[kind] + buff);
  }

  /** Swing and cast times scale by this: 1 / (1 + Haste%). */
  hasteMult(): number {
    return 1 / (1 + this.haste() / 100);
  }

  /** Technique wind-up and recovery multiplier from Haste, Swift Cast and the Limiter. */
  castTimeMult(): number {
    const swift = this.pMult('swiftCast', passiveCfg.swiftCastMult);
    const limiter = this.hasUnique('limiter') ? Math.max(0.1, 1 - this.uval(uniqueCfg.limiterCast)) : 1;
    return swift * limiter * this.hasteMult();
  }

  /** A status resistance from gear (%, capped; the Red Ring takes Corruption resistance away, down to the floor). */
  resist(id: 'resPoison' | 'resPara' | 'resBurn' | 'resCorrupt'): number {
    const ring = id === 'resCorrupt' && this.hasUnique('redRing') ? uniqueCfg.redRingCorrupt : 0;
    return Math.max(AFFIX_CAPS.resistFloor, Math.min(AFFIX_CAPS.resist, this.gearAffix(id) + ring));
  }

  get maxHp() {
    return Math.max(1, this.stats().hp);
  }

  get maxTp() {
    return Math.max(0, this.stats().tp);
  }

  xpToNext(): number {
    return xpToNext(this.data.level);
  }

  /** At the level cap XP no longer counts. */
  get maxed(): boolean {
    return this.data.level >= MAX_LEVEL;
  }

  /** Adds XP; returns number of levels gained. */
  addXp(amount: number): number {
    let gained = 0;
    if (this.maxed) return 0;
    this.data.xp += amount;
    while (this.data.level < MAX_LEVEL && this.data.xp >= xpToNext(this.data.level)) {
      this.data.xp -= xpToNext(this.data.level);
      this.data.level++;
      gained++;
    }
    if (this.maxed) this.data.xp = 0;
    return gained;
  }

  // ------------------------------------------------------------ weapon

  weaponInstance(): ItemInstance | undefined {
    return this.equippedItem('weapon');
  }

  weaponDef(): WeaponItemDef {
    const inst = this.weaponInstance();
    if (!inst) return BARE_HANDS;
    const def = statDef(inst);
    return def.type === 'weapon' ? def : BARE_HANDS;
  }

  /** The kind in hand (bare hands: a weak bolt). */
  weaponKind(): WeaponKindDef {
    const def = this.weaponDef();
    return def === BARE_HANDS ? BARE_KIND : weaponKinds[def.kind];
  }

  /** Grind (Edge) levels on the equipped weapon: its built-in full grind. */
  weaponEdge(): number {
    const w = this.weaponInstance();
    return w ? grindLevels(w) : 0;
  }


  // --------------------------------------------------------- inventory

  find(uid: string): ItemInstance | undefined {
    return this.data.inventory.find((i) => i.uid === uid);
  }

  equippedItem(slot: GearSlot): ItemInstance | undefined {
    const uid = this.data.equipped[slot];
    return uid ? this.find(uid) : undefined;
  }

  /** The equipped injector (key 1). */
  injector(): ItemInstance | undefined {
    return this.equippedItem('injector');
  }

  isEquipped(uid: string): boolean {
    return GEAR_SLOTS.some((s) => this.data.equipped[s] === uid);
  }

  countOf(id: string): number {
    return this.data.inventory.filter((i) => i.id === id).reduce((n, i) => n + (i.qty ?? 1), 0);
  }

  /** Bag rows in use. */
  get bagCount(): number {
    return this.data.inventory.length;
  }

  get full(): boolean {
    return this.bagCount >= INVENTORY_SIZE;
  }

  /** Can this instance be added without exceeding capacity? */
  canAdd(inst: ItemInstance): boolean {
    const def = getDef(inst.id);
    if (isStackable(def)) {
      const stack = this.data.inventory.find((i) => i.id === inst.id);
      if (stack && (stack.qty ?? 1) + (inst.qty ?? 1) <= stackCap(def)) return true;
      if (stack) return false; // single stack per item type, like PSO
    }
    return !this.full;
  }

  addItem(inst: ItemInstance): boolean {
    if (!this.canAdd(inst)) return false;
    const def = getDef(inst.id);
    if (isStackable(def)) {
      const stack = this.data.inventory.find((i) => i.id === inst.id);
      if (stack) {
        stack.qty = (stack.qty ?? 1) + (inst.qty ?? 1);
        return true;
      }
    }
    this.data.inventory.push(inst);
    return true;
  }

  /** Remove qty from a stack (or the whole item). Unequips if needed. */
  removeItem(uid: string, qty = 1): ItemInstance | undefined {
    const idx = this.data.inventory.findIndex((i) => i.uid === uid);
    if (idx < 0) return undefined;
    const inst = this.data.inventory[idx];
    if (inst.qty !== undefined && inst.qty > qty) {
      inst.qty -= qty;
      return { ...inst, uid: newUid(), qty };
    }
    this.data.inventory.splice(idx, 1);
    this.unequip(uid);
    return inst;
  }

  /** Remove one item of a given def id (first stack). */
  consume(id: string): boolean {
    const inst = this.data.inventory.find((i) => i.id === id);
    if (!inst) return false;
    this.removeItem(inst.uid, 1);
    return true;
  }

  /** Whether the item can be worn now; `need` is set when only its level requirement is in the way. */
  canEquip(inst: ItemInstance): { ok: boolean; reason?: string; need?: { level: number } } {
    const def = getDef(inst.id);
    if (!isGear(def)) return { ok: false, reason: 'Not equippable' };
    const need = itemRequirement(def);
    if (need && this.level < need.level) return { ok: false, reason: reqReason(need.level, this.level), need };
    return { ok: true };
  }

  /** Equip into its slot (replacing what was there). */
  equip(uid: string): { ok: boolean; reason?: string } {
    const inst = this.find(uid);
    if (!inst) return { ok: false, reason: 'No such item' };
    const check = this.canEquip(inst);
    if (!check.ok) return check;
    const slot = gearSlot(inst);
    if (slot) this.data.equipped[slot] = uid;
    return { ok: true };
  }

  unequip(uid: string): void {
    const e = this.data.equipped;
    for (const s of GEAR_SLOTS) if (e[s] === uid) delete e[s];
  }

  /** Slot a learned unit into the Mag (at the end of its order). */
  insertUnit(kind: UnitKind): string | null {
    if (!this.learnedUnit(kind)) return 'You have not learned that unit';
    const m = this.data.magUnits;
    if (m.includes(kind)) return 'Already in your Mag';
    if (m.length >= MAG_UNIT_SLOTS) return `Your Mag holds ${MAG_UNIT_SLOTS} units: remove one first`;
    m.push(kind);
    return null;
  }

  /** Take a unit out of the Mag (it stays learned). */
  removeUnit(index: number): string | null {
    if (!this.data.magUnits[index]) return 'No unit there';
    this.data.magUnits.splice(index, 1);
    return null;
  }

  /** Slot exactly these learned units in the Mag (the Damage tab's picks). */
  setActiveUnits(kinds: UnitKind[]): string | null {
    if (kinds.some((k) => !this.learnedUnit(k))) return 'You have not learned that unit';
    this.data.magUnits = kinds.slice(0, MAG_UNIT_SLOTS);
    return null;
  }

  // -------------------------------------------------------- techniques

  /**
   * TP for one cast of this technique at the current tech damage: Efficiency, TP cost affixes, the Reactor Rod and
   * its modifiers. Combat adds Clarity and Overload on top.
   */
  techCost(tech: TechId): number {
    let mult = 1;
    if (isAttackTech(tech)) {
      mult *= this.pMult('efficiency', passiveCfg.efficiencyTpMult);
      mult *= 1 - Math.min(50, this.gearAffix('tpCost')) / 100;
    }
    if (this.hasUnique('reactorRod')) mult *= uniqueCfg.reactorTpMult;
    if (this.artMod(tech, 'efficient')) mult *= 0.75;
    if (this.artMod(tech, 'cheap')) mult *= 0.7;
    mult *= this.artRankTp(tech);
    return Math.max(1, Math.round(techTpCost(tech, this.stats().mst) * mult));
  }

  /** Technique damage % from gear: Technique damage (Brittle included) and the element's own affix. */
  techAffixPct(tech: TechId): number {
    const el = techniques[tech].element;
    const own = el === 'fire' ? 'firePct' : el === 'lightning' ? 'lightningPct' : el === 'ice' ? 'icePct' : null;
    return this.gearAffix('techPct') + this.gearAffix('brittle') + (own ? this.gearAffix(own) : 0);
  }

  /** Attack damage of one cast before streak and crits: tech damage, its rank, the weapon's boost and affixes. */
  techDamage(tech: TechId): number {
    return techAttackPower(tech, this.stats().mst) * this.artRankPower(tech) * this.weaponKind().techBoost * (1 + this.techAffixPct(tech) / 100);
  }

  /** A photon bolt's damage (the basic step) before streak, crits and resistance: tech damage x the kind's bolt power. */
  boltDamage(): number {
    const kind = this.weaponKind();
    return kind.boltPower * this.stats().mst * kind.techBoost * (1 + (this.gearAffix('techPct') + this.gearAffix('brittle')) / 100);
  }
}

/** A unit's kind: the affix it carries, or (a unique unit) its own. */
export type UnitKind = ItemAffixId | UniqueId;

/** A unit's kind: the affix it carries, or the unique it is. */
export function unitKind(inst: ItemInstance): UnitKind | undefined {
  const def = getDef(inst.id);
  if (def.type !== 'unit') return undefined;
  return def.unique ?? inst.affixes?.[0]?.id;
}

/** A unique unit kind (its effect and cost on the card), not an affix. */
export const isUniqueKind = (k: UnitKind): k is UniqueId => !!UNIQUES[k as UniqueId];

/** A unit roll beats another of its kind: a bigger value, or the same with a smaller penalty. A unique unit never does. */
function unitBetter(a: ItemInstance, b: ItemInstance): boolean {
  const x = a.affixes?.[0];
  const y = b.affixes?.[0];
  if (!x || !y) return false;
  return x.v > y.v || (x.v === y.v && (x.p ?? 0) < (y.p ?? 0));
}

/** Units the Mag holds, every one of them active (2026-10-21, the user's call: frames no longer have unit slots). */
export const MAG_UNIT_SLOTS = 4;

// ------------------------------------------------------------ comparison

export { GEAR_SLOTS, type GearSlot };

/** The slot an item goes in, or null if it isn't gear. */
export function gearSlot(inst: ItemInstance): GearSlot | null {
  return itemSlot(getDef(inst.id));
}

export function fitsSlot(inst: ItemInstance, slot: GearSlot): boolean {
  return gearSlot(inst) === slot;
}

export interface CompareRow {
  label: string;
  /** The stat compared (unset for damage, rating and Haste). */
  stat?: StatKey;
  before: string;
  after: string;
  /** Change in the compared value (positive = better). */
  delta: number;
  /** The row that decides the verdict: damage per second (weapons and armour alike). */
  key?: boolean;
  /** Armour's overall rating: decides when the damage is the same. */
  tie?: boolean;
}

/** A throwaway copy of `ch` with `inst` equipped in `slot` (it may come from outside the inventory, e.g. shop stock). */
export function simulateEquip(ch: Character, inst: ItemInstance, slot: GearSlot): Character {
  const sim = new Character(JSON.parse(JSON.stringify(ch.data)) as CharacterData);
  // The item as given, even if the bag holds it.
  const copy = JSON.parse(JSON.stringify(inst)) as ItemInstance;
  const at = sim.data.inventory.findIndex((it) => it.uid === inst.uid);
  if (at >= 0) sim.data.inventory[at] = copy;
  else sim.data.inventory.push(copy);
  sim.data.equipped[slot] = inst.uid;
  return sim;
}

/** The same character with these units switched on (the Damage tab compares it; nothing changes until they're used). */
export function simulateUnits(ch: Character, kinds: UnitKind[]): Character {
  const sim = new Character(JSON.parse(JSON.stringify(ch.data)) as CharacterData);
  sim.setActiveUnits(kinds);
  return sim;
}

/**
 * What one more Mag point in `stat` would add to the character's damage per second against `foe`, in percent
 * (the Mag screen shows it, so the tracks can be weighed). Null for the defense track, which adds no damage.
 */
export function magPointValue(ch: Character, stat: MagStat, foe: Foe): number | null {
  if (stat === 'def') return null;
  const sim = new Character(JSON.parse(JSON.stringify(ch.data)) as CharacterData);
  sim.data.mag[stat]++;
  const before = damageRating(ch, foe);
  return before > 0 ? (damageRating(sim, foe) / before - 1) * 100 : 0;
}

/** A plain enemy of the character's level, for verdicts made without an expedition in mind. */
export function levelFoe(_level: number): Foe {
  return { techResist: 0, label: 'enemy' };
}

/** Damage per second a character deals: its main technique. */
export function damageRating(ch: Character, foe: Foe): number {
  return estimateDamage(ch, foe).spell;
}

/**
 * How much a frame or barrier helps, as one number: its stats and affixes (tech damage and TP weigh most). Only
 * differences between two of these mean anything. A point of damage taken is worth about what 1.5 DFP was (2026-10-14).
 */
export function armorRating(ch: Character): number {
  const s = ch.stats();
  const a = (id: ItemAffixId) => ch.gearAffix(id);
  const res = a('resPoison') + a('resPara') + a('resBurn') + a('resCorrupt');
  const cap = AFFIX_CAPS.damageTaken;
  return (
    Math.min(cap, s.strike) * 1.6 + Math.min(cap, s.area) * 1.3 + s.hp * 0.12 + s.tp * 0.12 +
    s.mst * 0.6 + s.lck * 0.12 + ch.haste() * 4 + res * 0.08 + a('stability') * 0.04 + a('injPotency') * 0.4 +
    a('injCharge') * 0.3 + Math.min(20, a('walk')) * 0.3 + a('dashRecharge') * 0.15 + a('regen') * 1.5 +
    (a('techPct') + a('brittle')) * 1.2
  );
}

/**
 * What equipping `inst` would change, against what is in its slot now. Weapons are judged by damage per
 * second against `foe` (the current expedition's average enemy), armour by its rating. Works for items not
 * in the inventory yet (shop stock). Requirements are ignored here; callers show canEquip() separately.
 */
export function compareEquip(ch: Character, inst: ItemInstance, foe: Foe = levelFoe(ch.level)): { slot: GearSlot; current?: ItemInstance; rows: CompareRow[] } | null {
  const slot = gearSlot(inst);
  if (!slot || injectorDef(inst)) return null;
  const sim = simulateEquip(ch, inst, slot);
  const [b, a] = [ch.stats(), sim.stats()];
  const rows: CompareRow[] = [];
  const num = (stat: StatKey) => rows.push({ label: STAT_LABEL[stat], stat, before: statValue(stat, b[stat]), after: statValue(stat, a[stat]), delta: a[stat] - b[stat] });
  // Damage first, armour too (2026-10-13, the user's call: a caster's frame is judged by its techniques).
  const [d0, d1] = [damageRating(ch, foe), damageRating(sim, foe)];
  rows.push({ label: 'Damage/s', before: `${Math.round(d0)}`, after: `${Math.round(d1)}`, delta: d1 - d0, key: true });
  if (slot !== 'weapon') {
    // Its overall rating (HP, damage taken, resistances, utility) decides between frames that deal the same.
    const [r0, r1] = [armorRating(ch), armorRating(sim)];
    rows.push({ label: 'Rating', before: `${Math.round(r0)}`, after: `${Math.round(r1)}`, delta: r1 - r0, tie: true });
    num('strike');
    num('area');
  }
  for (const k of BONUS_ORDER) if (!rows.some((r) => r.stat === k) && b[k] !== a[k]) num(k);
  const [h0, h1] = [ch.haste(), sim.haste()];
  if (h0 || h1) rows.push({ label: 'Haste', before: `${h0}%`, after: `${h1}%`, delta: h1 - h0 });
  return { slot, current: ch.equippedItem(slot), rows };
}

/** Quick verdict for list rows: +1 better, -1 worse, 0 same (by damage per second, then the armour rating). */
export function gearVerdict(ch: Character, inst: ItemInstance, foe?: Foe): number {
  const c = compareEquip(ch, inst, foe);
  if (!c || ch.isEquipped(inst.uid)) return 0;
  return rowsVerdict(c.rows);
}

/** Damage within half a percent is the same; the armour rating needs half a point. */
function sameRow(r: CompareRow): boolean {
  return r.tie ? Math.abs(r.delta) < 0.5 : Math.abs(r.delta) / Math.max(1, Number(r.before)) < 0.005;
}

/** The row a verdict goes by: damage per second, or armour's rating when the damage is the same. */
export function decidingRow(rows: CompareRow[]): CompareRow | undefined {
  const key = rows.find((r) => r.key);
  const tie = rows.find((r) => r.tie);
  return key && tie && sameRow(key) ? tie : key;
}

function rowsVerdict(rows: CompareRow[]): number {
  const d = decidingRow(rows);
  return !d || sameRow(d) ? 0 : Math.sign(d.delta);
}

/** How a drop on the floor reads for this character: its look on the ground and the pickup prompt's note. */
export interface DropVerdict {
  /** junk: no better than what is equipped (damage, then armour's rating); upgrade: better and equippable now. */
  look: 'plain' | 'junk' | 'upgrade';
  /** The inventory's mark: up ▲, down ▼, same =, no ✖ ('' for items that aren't gear). */
  mark: '' | 'up' | 'down' | 'same' | 'no';
  /** "Needs Lv 24 (you are Lv 21)" or the change ("Damage/s +14% · Crit chance +0.3%"). */
  note: string;
}

const signed = (n: number) => (n > 0 ? `+${n}` : `−${-n}`);

/** A damage or rating row's change as a whole percent of before. */
export function rowPct(r: CompareRow): number {
  return Math.round((r.delta / Math.max(1, Number(r.before))) * 100);
}

/** The changes of a comparison, damage (and armour's rating) first as a %: "Damage/s +12% · Rating −3% · Crit chance −0.3%". */
function changesText(rows: CompareRow[], max = 4): string {
  const parts: string[] = [];
  for (const r of rows) {
    if (r.key || r.tie) {
      const p = rowPct(r);
      if (p) parts.push(`${r.label} ${signed(p)}%`);
    } else if (r.stat && Math.abs(r.delta) >= (r.stat === 'lck' ? 1 : 0.5)) parts.push(statDelta(r.stat, r.delta));
    else if (!r.stat && Math.round(r.delta)) parts.push(`${r.label} ${signed(Math.round(r.delta))}${r.after.endsWith('%') ? '%' : ''}`);
  }
  return parts.slice(0, max).join(' · ');
}

/**
 * Verdict for an item lying on the ground. Junk is gear that is no better than what is equipped (by damage per
 * second, then armour's rating); it stays as it dropped. Uniques never fade. Requirements don't make an item junk:
 * a locked upgrade stays plain, so it is still worth carrying until the level catches up.
 */
export function dropVerdict(ch: Character, inst: ItemInstance, foe?: Foe): DropVerdict {
  const def = getDef(inst.id);
  if (def.type === 'unit') return unitVerdict(ch, inst);
  if (!isGear(def)) return { look: 'plain', mark: '', note: '' };
  const need = itemRequirement(def);
  const locked = need && ch.level < need.level ? `Needs Lv ${need.level} (you are Lv ${ch.level})` : '';
  const c = compareEquip(ch, inst, foe);
  // Injectors aren't compared.
  if (!c) return { look: 'plain', mark: locked ? 'no' : '', note: locked };
  const v = rowsVerdict(c.rows);
  const changes = changesText(c.rows);
  if (v <= 0 && rarityOf(inst) !== 'unique') {
    return { look: 'junk', mark: v < 0 ? 'down' : 'same', note: changes ? `Downgrade: ${changes}` : 'Same as equipped' };
  }
  if (locked) return { look: 'plain', mark: 'no', note: v > 0 ? `${locked} · ${changes}` : locked };
  return { look: v > 0 ? 'upgrade' : 'plain', mark: v > 0 ? 'up' : v < 0 ? 'down' : 'same', note: changes };
}

/** A unit not learned yet (or a better roll) is worth picking up: it is learned on the spot. Anything else is junk. */
function unitVerdict(ch: Character, inst: ItemInstance): DropVerdict {
  const kind = unitKind(inst);
  const have = kind && ch.learnedUnit(kind);
  const yours = have?.affixes?.[0] ? affixText(have.affixes[0]) : '';
  if (getDef(inst.id).unique) {
    return ch.unitStatus(inst) === 'new'
      ? { look: 'upgrade', mark: 'up', note: 'New unique unit: learned on pickup' }
      : { look: 'junk', mark: 'same', note: 'Already learned' };
  }
  switch (ch.unitStatus(inst)) {
    case 'new':
      return { look: 'upgrade', mark: 'up', note: 'New unit: learned on pickup' };
    case 'better':
      return { look: 'upgrade', mark: 'up', note: `Better than yours (${yours})` };
    default:
      return { look: 'junk', mark: 'same', note: have ? `Already learned (${yours})` : 'No use' };
  }
}

/** "Damage taken −8%  Tech damage +12  TP +10" */
export function armorStatText(def: ArmorItemDef): string {
  return [`Damage taken −${def.dr}%`, ...bonusText(def.bonus)].join('  ');
}

/** "Rare Rod · iLvl 24", "Unique Barrier". */
export function rarityLine(inst: ItemInstance): string {
  const def = getDef(inst.id);
  const r = rarityOf(inst);
  const what =
    def.type === 'weapon' ? weaponKinds[def.kind].label : def.type === 'armor' ? `${def.line === 'basic' ? '' : `${armorLines[def.line].label} `}${def.slot === 'frame' ? 'Frame' : 'Barrier'}` : def.type === 'unit' ? 'Unit' : '';
  const base = r === 'rare' && def.type !== 'unit' ? ` (${def.name})` : '';
  const ilvl = 'tier' in def && def.type !== 'injector' && !(def.type === 'unit' && def.unique) ? ` · iLvl ${inst.ilvl ?? tierIlvl(def.tier)}` : '';
  const k = forgeMult(inst);
  const forged = k > 1 && (def.type === 'weapon' || def.type === 'armor') ? ` · Rift-forged +${Math.round((k - 1) * 100)}%` : '';
  return `${RARITY_LABEL[r]} ${what}${base}${ilvl}${forged}`;
}

/** Affix lines of an item (its own, then each inserted unit's). */
export function affixLines(inst: ItemInstance): string[] {
  const lines = ownAffixes(inst).map(affixText);
  return lines;
}

/** Menu text for one item type. */
interface ItemText<D extends ItemDef> {
  /** Its numbers on one line (gear lists): "Tech damage +12" with grind counted; '' if none. */
  headline(def: D, inst: ItemInstance, ch?: Character): string;
  /** Info lines; describeItem adds the requirement, the description and why it can't be worn after them. */
  describe(def: D, inst: ItemInstance, ch?: Character): string[];
}

const ITEM_TEXT: { [T in ItemType]: ItemText<ItemDefOf<T>> } = {
  weapon: {
    headline: (def, inst) => bonusText(weaponBonus(def, grindLevels(inst))).join('  '),
    describe: (def, inst) => [rarityLine(inst), ITEM_TEXT.weapon.headline(def, inst), ...affixLines(inst)],
  },
  armor: {
    headline: (def) => armorStatText(def),
    describe: (def, inst) => {
      const lines = [rarityLine(inst), armorStatText(def), ...affixLines(inst)];
      if (def.line !== 'basic') lines.push(armorLines[def.line].desc);
      return lines;
    },
  },
  injector: {
    headline: (def, inst, ch) => {
      const s = injectorStats(inst, ch);
      return `${def.kind === 'mate' ? 'HP' : 'TP'} ${Math.round(s.potency * 100)}% · ${Math.floor(chargeOf(inst, ch))}/${s.doses} doses`;
    },
    describe: (_def, inst, ch) => describeInjector(inst, ch),
  },
  consumable: {
    headline: () => '',
    describe: (def) => [`Carry up to ${stackCap(def)}${def.fieldOnly ? ' · field only' : ''} · use it from the Items tab or a Q / E quick slot`],
  },
  unit: {
    headline: (_def, inst) => affixLines(inst).join(' · '),
    describe: (_def, inst) => [rarityLine(inst), ...affixLines(inst)],
  },
};

function itemText<D extends ItemDef>(def: D): ItemText<D> {
  return ITEM_TEXT[def.type] as unknown as ItemText<D>;
}

/** An item's numbers on one line: "Tech damage +12" (grind counted), "Damage taken −8%  Tech damage +12", "HP 30% · 3/3 doses"; '' if none. */
export function itemHeadline(inst: ItemInstance, ch?: Character): string {
  const def = statDef(inst);
  return itemText(def).headline(def, inst, ch);
}

export function describeItem(inst: ItemInstance, ch?: Character): string[] {
  const def = statDef(inst);
  const lines = itemText(def).describe(def, inst, ch).filter(Boolean);
  const need = itemRequirement(def);
  if (need) lines.push(`Req: Lv ${need.level}`);
  if (def.desc) lines.push(def.desc);
  // An unmet stat requirement shows on the Req line itself (menus colour it); anything else in the way gets a line.
  if (ch && isGear(def)) {
    const c = ch.canEquip(inst);
    if (!c.ok && !c.need) lines.push(`✖ ${c.reason}`);
  }
  return lines;
}
