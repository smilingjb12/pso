import { makeItem, newUid, type ItemInstance } from './character';
import { drops, hasteCfg, type EnemyArchetype } from './config';
import { expeditionOfBoss } from './data/areas';
import { BOSS_IDS, BOSSES, type BossId, type ShopUnlock } from './data/bosses';
import {
  INJECTOR_MODS, itemDefs, kindFamily, weaponKinds, type ArmorLine, type InjectorMod, type ItemDef, type Rarity, type SpecialId,
} from './data/items';
import {
  AFFIX_IDS, affixFits, ITEM_AFFIXES, maxAffixTier, RARE_FIRST, RARE_SECOND, tierIlvl, tierRange, type AffixRoll, type AffixSlot, type ItemAffixDef, type ItemAffixId,
} from './data/itemAffixes';
import type { WeaponFamily } from './data/stats';
import { isUniqueUnit, UNIQUE_IDS, UNIQUES, uniqueDropId, type UniqueId, type UniquePool } from './data/uniques';
import type { RiftShard } from './rifts';
import { hardScale } from './hard';
import { asDifficulty, type Difficulty } from './difficulty';

export type Rng = () => number;

/** What drops and shops lean toward: the class's weapon family (and its armour line). */
export type LootBias = WeaponFamily;

/** What drops: an item, Meseta, or a Rift Shard (charge orbs went on 2026-10-11, the user's call). */
export type Drop = { kind: 'item'; item: ItemInstance } | { kind: 'meseta'; amount: number } | { kind: 'shard'; shard: RiftShard };

const pick = <T>(arr: readonly T[], rng: Rng): T => arr[Math.floor(rng() * arr.length)];

function weighted<T>(entries: [T, number][], rng: Rng): T {
  const total = entries.reduce((a, [, w]) => a + w, 0);
  let r = rng() * total;
  for (const [v, w] of entries) {
    r -= w;
    if (r <= 0) return v;
  }
  return entries[entries.length - 1][0];
}

/** Share of drops that lean to the class's family / armour line. */
export const LOOT_LEAN = 0.8;
const BIAS_LINE: Record<WeaponFamily, ArmorLine> = { melee: 'guard', ranged: 'combat', caster: 'psy' };

/** Specials a weapon can roll as a prefix (Venom: none since the old uniques went, 2026-10-12). */
export const SPECIAL_POOL: SpecialId[] = ['heat', 'ice', 'shock', 'draw', 'dim'];

// ------------------------------------------------------------------ rarity

/** Odds of each rarity on a field drop (rareMult boosts rares: elites, champions). */
const RARITY_WEIGHT: Record<Exclude<Rarity, 'unique'>, number> = { normal: 40, magic: 47, rare: 13 };

export function rollRarity(rng: Rng, rareMult = 1, min: Exclude<Rarity, 'unique'> = 'normal'): Exclude<Rarity, 'unique'> {
  const order = ['normal', 'magic', 'rare'] as const;
  const from = order.indexOf(min);
  return weighted(order.slice(from).map((r): [typeof r, number] => [r, RARITY_WEIGHT[r] * (r === 'rare' ? rareMult : 1)]), rng);
}

/**
 * How many affixes a rare has active, by item level (2026-10-13, the user's redesign: fixed counts, no empty slots):
 * 4 on Normal gear, 5 on Nightmare (gear tier 8's item level and up), 6 on Hell and in the rifts (tier 12's and up).
 * Magic items always have 2 (a prefix and a suffix).
 */
export function rareCount(ilvl: number): number {
  return ilvl >= tierIlvl(12) ? 6 : ilvl >= tierIlvl(8) ? 5 : 4;
}

/** Dormant affixes a rare holds besides its active ones (a Photon Crystal swaps one in): 1, 2 or 3. */
export const dormantCount = (ilvl: number) => rareCount(ilvl) - 3;

// ------------------------------------------------------------------ affixes

/**
 * A value for `def` on an item of `tier`: the best strength tier its item level allows (its tier's, or a rift
 * drop's own), often one or two below.
 */
export function rollAffixValue(def: ItemAffixDef, tier: number, rng: Rng, ilvl = tierIlvl(tier)): AffixRoll {
  if (def.id === 'haste') return { id: def.id, v: 1 + Math.floor(rng() * (hasteCfg.capByTier[tier] ?? 1)) };
  const top = maxAffixTier(ilvl);
  const t = Math.max(1, top - weighted<number>([[0, 50], [1, 30], [2, 20]], rng));
  const [lo, hi] = tierRange(def.tiers, t);
  const roll: AffixRoll = { id: def.id, v: lo + Math.floor(rng() * (hi - lo + 1)), t };
  if (def.penalty) {
    const [plo, phi] = tierRange(def.penalty.tiers, t);
    roll.p = plo + Math.floor(rng() * (phi - plo + 1));
  }
  return roll;
}

/** Draw weights: a normal affix 1, a weapon special 1.2, a downside 0.5. */
const affixWeight = (a: ItemAffixDef) => (a.penalty ? 0.5 : 1);
const SPECIAL_WEIGHT = 1.2;

/**
 * Roll `inst`'s affixes for its rarity (2026-10-13, the user's redesign): a magic item one prefix and one suffix; a
 * rare `rareCount` active (up to 3 of each; a weapon's rolled special counts as a prefix) and `dormantCount` dormant
 * ones of any kind, which a Photon Crystal swaps with an active one of the same kind. No affix twice. A Hell or rift rare holds at least one downside, active or dormant, and an active
 * downside always has a dormant prefix to be swapped for.
 *
 * Tops up what the item already has, so it also fills older items to the new counts (on load, seeded by the uid):
 * only rolls it draws itself can be replaced by those two guarantees.
 */
export function rollAffixes(inst: ItemInstance, def: ItemDef, rarity: Rarity, rng: Rng): void {
  if (rarity === 'normal' || rarity === 'unique') return;
  const slot: AffixSlot = def.type === 'weapon' ? 'weapon' : def.type === 'armor' ? def.slot : 'unit';
  const family = def.type === 'weapon' ? kindFamily(weaponKinds[def.kind]) : null;
  const tier = 'tier' in def ? def.tier : 1;
  const ilvl = inst.ilvl ?? tierIlvl(tier);
  const pool = AFFIX_IDS.map((id) => ITEM_AFFIXES[id]).filter((a) => (rarity === 'rare' || !a.rareOnly) && affixFits(a, slot, family, tier));
  const active = [...(inst.affixes ?? [])];
  const dormant = rarity === 'rare' ? [...(inst.dormant ?? [])] : [];
  const fresh = new Set<AffixRoll>();
  const kindOf = (r: AffixRoll) => ITEM_AFFIXES[r.id].kind;
  const taken = (id: ItemAffixId) => active.some((r) => r.id === id) || dormant.some((r) => r.id === id);
  const canSpecial = slot === 'weapon' && !(def.type === 'weapon' && def.special);
  const roll = (a: ItemAffixDef) => {
    const r = rollAffixValue(a, tier, rng, ilvl);
    fresh.add(r);
    return r;
  };

  // Active: the split first (a rare's 5 goes either way), never below what the item already has.
  const n = rarity === 'magic' ? 2 : rareCount(ilvl);
  const has = (kind: 'prefix' | 'suffix') => active.filter((r) => kindOf(r) === kind).length + (kind === 'prefix' && inst.special ? 1 : 0);
  const want = rarity === 'magic' ? 1 : n === 6 ? 3 : n === 4 ? 2 : rng() < 0.5 ? 3 : 2;
  const pre = Math.max(has('prefix'), Math.min(want, n - has('suffix')));
  const target = { prefix: pre, suffix: n - pre };
  for (const kind of ['prefix', 'suffix'] as const) {
    while (has(kind) < target[kind]) {
      const entries: [ItemAffixDef | 'special', number][] = pool
        .filter((a) => a.kind === kind && !taken(a.id))
        .map((a) => [a, affixWeight(a)]);
      if (kind === 'prefix' && canSpecial && !inst.special) entries.push(['special', SPECIAL_WEIGHT]);
      if (!entries.length) break;
      const got = weighted(entries, rng);
      if (got === 'special') inst.special = pick(SPECIAL_POOL, rng);
      else active.push(roll(got));
    }
  }

  if (rarity === 'rare') {
    // Dormant: any kind, from what is left.
    while (dormant.length < dormantCount(ilvl)) {
      const entries = pool.filter((a) => !taken(a.id)).map((a): [ItemAffixDef, number] => [a, affixWeight(a)]);
      if (!entries.length) break;
      dormant.push(roll(weighted(entries, rng)));
    }
    const downsides = () => pool.filter((a) => a.penalty && !taken(a.id));
    // Hell and rift rares hold a downside: one of the prefixes it drew becomes one, active or dormant alike.
    if (rareCount(ilvl) === 6 && ![...active, ...dormant].some((r) => ITEM_AFFIXES[r.id].penalty)) {
      const spots = [...active, ...dormant].filter((r) => fresh.has(r) && kindOf(r) === 'prefix');
      const options = downsides();
      if (spots.length && options.length) {
        const spot = pick(spots, rng);
        const list = active.includes(spot) ? active : dormant;
        list[list.indexOf(spot)] = roll(pick(options, rng));
      }
    }
    // An active downside can always be swapped out: one dormant affix is a plain prefix.
    const plainPrefix = (r: AffixRoll) => kindOf(r) === 'prefix' && !ITEM_AFFIXES[r.id].penalty;
    if (active.some((r) => ITEM_AFFIXES[r.id].penalty) && !dormant.some(plainPrefix)) {
      const spots = dormant.filter((r) => fresh.has(r));
      const options = pool.filter((a) => a.kind === 'prefix' && !a.penalty && !taken(a.id));
      if (spots.length && options.length) dormant[dormant.indexOf(pick(spots, rng))] = roll(weighted(options.map((a): [ItemAffixDef, number] => [a, affixWeight(a)]), rng));
    }
  }
  if (active.length) inst.affixes = active;
  if (dormant.length) inst.dormant = dormant;
}

/** A rare's two-word name, by what it is. */
export function rareName(def: ItemDef, rng: Rng): string {
  const group = def.type === 'weapon' ? kindFamily(weaponKinds[def.kind]) : def.type === 'armor' ? def.slot : 'frame';
  return `${pick(RARE_FIRST, rng)} ${pick(RARE_SECOND[group], rng)}`;
}

/** Give a fresh item its rarity, affixes (active and dormant), name and (frames) unit slots. */
export function decorate(inst: ItemInstance, rarity: Exclude<Rarity, 'unique'>, rng: Rng): ItemInstance {
  const def = itemDefs[inst.id];
  if (rarity !== 'normal') inst.rarity = rarity;
  rollAffixes(inst, def, rarity, rng);
  if (rarity === 'rare') inst.name = rareName(def, rng);
  if (def.type === 'armor' && def.slot === 'frame') {
    const [lo, hi] = rarity === 'rare' ? [2, 3] : rarity === 'magic' ? [1, 2] : [0, 1];
    const n = lo + Math.floor(rng() * (hi - lo + 1));
    if (n) inst.slots = n;
  }
  return inst;
}

// ------------------------------------------------------------------ items

/** A weapon of a given tier (80% from the bias family) with a rolled rarity. Pre-ground now and then. */
export function rollWeapon(tier: number, rng: Rng, bias?: LootBias, rarity: Exclude<Rarity, 'unique'> = rollRarity(rng), ilvl?: number): ItemInstance {
  let candidates = Object.values(itemDefs).filter((d) => d.type === 'weapon' && !d.rare && d.tier === tier);
  if (bias && rng() < LOOT_LEAN) {
    const biased = candidates.filter((d) => d.type === 'weapon' && kindFamily(weaponKinds[d.kind]) === bias);
    if (biased.length) candidates = biased;
  }
  return decorate(makeItem(pick(candidates, rng).id, ilvl ? { ilvl } : {}), rarity, rng);
}

/** A frame or barrier of `tier`; 80% of the time from the bias family's line (Guard, Combat, Psy). */
export function rollArmor(tier: number, rng: Rng, bias?: LootBias, rarity: Exclude<Rarity, 'unique'> = rollRarity(rng), ilvl?: number): ItemInstance {
  const slot = rng() < 0.5 ? 'frame' : 'barrier';
  const line = bias && rng() < LOOT_LEAN ? BIAS_LINE[bias] : pick(ARMOR_LINES, rng);
  return decorate(makeItem(`${slot}_${line}_${tier}`, ilvl ? { ilvl } : {}), rarity, rng);
}

/** A unit of `tier`: one affix from the frame / barrier pool; now and then a downside one. */
export function rollUnit(tier: number, rng: Rng, ilvl?: number): ItemInstance {
  const inst = makeItem(`unit_${Math.max(1, Math.min(15, tier))}`, ilvl ? { ilvl } : {});
  const pool = AFFIX_IDS.map((id) => ITEM_AFFIXES[id]).filter((a) => affixFits(a, 'unit', null, tier));
  const def = weighted(pool.map((a): [ItemAffixDef, number] => [a, a.penalty ? 0.4 : 1]), rng);
  inst.affixes = [rollAffixValue(def, tier, rng, inst.ilvl)];
  inst.rarity = def.penalty ? 'rare' : 'magic';
  return inst;
}

// ------------------------------------------------------------------ uniques

/** The weapon family a unique is made for (null: armour, anyone's). */
function uniqueFamily(id: UniqueId): WeaponFamily | null {
  const b = UNIQUES[id].base;
  return b.type === 'weapon' ? kindFamily(weaponKinds[b.kind]) : null;
}

/**
 * A unique from `pool` at gear tier `tier` (its base stats; `ilvl`: a rift drop's item level, so it comes
 * Rift-forged). In the main pool the class's own weapon (the bias family) counts `drops.uniqueClassWeight` times.
 */
export function rollUnique(pool: UniquePool, tier: number, rng: Rng, bias?: LootBias, ilvl?: number): ItemInstance {
  const entries = UNIQUE_IDS.filter((id) => UNIQUES[id].pool === pool).map(
    (id): [UniqueId, number] => [id, bias && uniqueFamily(id) === bias ? drops.uniqueClassWeight : 1],
  );
  const id = weighted(entries, rng);
  const inst = makeItem(uniqueDropId(id, tier));
  if (ilvl && !isUniqueUnit(id)) inst.ilvl = ilvl;
  return inst;
}

/** The gear tier a main-game boss's unique drops at: its Normal top tier, or its expedition's on Nightmare / Hell. */
const NORMAL_UNIQUE_TIER: Record<BossId, number> = { dragon: 3, derolle: 5, warden: 6, falz: 7 };
export function bossUniqueTier(boss: BossId, d: Difficulty): number {
  return d === 'normal' ? NORMAL_UNIQUE_TIER[boss] : hardScale(expeditionOfBoss(boss), d === 'hell').dropTier;
}

function rollTier(maxTier: number, rng: Rng): number {
  if (maxTier <= 1) return 1;
  if (maxTier <= 3) return rng() < 0.7 ? 1 : Math.min(maxTier, 2 + (rng() < 0.15 ? 1 : 0));
  // Caves on: the top three tiers, weighted toward the low end.
  const r = rng();
  return r < 0.5 ? maxTier - 2 : r < 0.85 ? maxTier - 1 : maxTier;
}

const ARMOR_LINES = ['guard', 'combat', 'psy'] as const;

const INJECTOR_MOD_POOL = Object.keys(INJECTOR_MODS) as InjectorMod[];

/** An injector of `tier`: casters lean Fluid, the others Mate; about half roll a mod. */
export function rollInjector(tier: number, rng: Rng, bias?: LootBias, modChance = 0.5, maxTier = 5): ItemInstance {
  const mateOdds = bias === 'caster' ? 0.35 : bias ? 0.65 : 0.5;
  // Normal drops stop at tier 5; tier 6 only comes from Hard bosses and champions (maxTier 6).
  const inst = makeItem(`${rng() < mateOdds ? 'mate' : 'fluid'}_${Math.min(maxTier, tier)}`);
  if (rng() < modChance) inst.mod = pick(INJECTOR_MOD_POOL, rng);
  return inst;
}

/**
 * A photon (crafting) by where it drops (DESIGN.md "Crafting: Photons"): Photon Drops (common) everywhere; Spheres
 * (rare) from Nightmare (tier 8); Crystals (very rare) now and then from Nightmare, most in Falz Rifts.
 */
export function rollPhoton(tier: number, rng: Rng, ilvl?: number): ItemInstance {
  const table: [string, number][] =
    ilvl && ilvl > 100
      ? [['photon_drop', 60], ['photon_sphere', 30], ['photon_crystal', 10]]
      : tier >= 12
        ? [['photon_drop', 65], ['photon_sphere', 28], ['photon_crystal', 7]]
        : tier >= 8
          ? [['photon_drop', 72], ['photon_sphere', 25], ['photon_crystal', 3]]
          : [['photon_drop', 1]];
  return makeItem(weighted(table, rng));
}

/**
 * Generic drop roll used by enemies and boxes. `rareMult` raises the odds of a rare (yellow) item. Uniques never
 * come from here: bosses drop them (rollBossDrops, rollRiftEndDrops).
 */
export function rollDrop(
  tier: number, rng: Rng, bias?: LootBias, mesetaRange: [number, number] = [10, 30], rareMult = 1,
  /** Falz Rifts: the item level gear rolls at (100 + the rift tier). */
  ilvl?: number,
): Drop {
  // Fewer, better drops (Diablo 3's Loot 2.0 rather than Diablo 2's volume): gear rolls rarity and affixes.
  // Photons (crafting) came in at 4 (2026-10-11) and took the grinders' 8 when grinding went the same day (12).
  const cat = weighted<'meseta' | 'injector' | 'weapon' | 'armor' | 'unit' | 'photon'>(
    [
      ['meseta', 54],
      ['injector', 5],
      ['weapon', 13],
      ['armor', 9],
      ['unit', 4],
      ['photon', 12],
    ],
    rng,
  );
  const t = rollTier(tier, rng);
  switch (cat) {
    case 'meseta': {
      const [lo, hi] = mesetaRange;
      return { kind: 'meseta', amount: Math.round(lo + rng() * (hi - lo)) };
    }
    case 'injector':
      return { kind: 'item', item: rollInjector(t, rng, bias) };
    case 'weapon':
      return { kind: 'item', item: rollWeapon(t, rng, bias, rollRarity(rng, rareMult), ilvl) };
    case 'armor':
      return { kind: 'item', item: rollArmor(t, rng, bias, rollRarity(rng, rareMult), ilvl) };
    case 'unit':
      return { kind: 'item', item: rollUnit(t, rng, ilvl) };
    case 'photon':
      return { kind: 'item', item: rollPhoton(tier, rng, ilvl) };
  }
}

/**
 * An enemy's drops. `dropRate` is the expected count: up to 1 it is the chance of a drop, past it (a rift's item
 * quantity) the rest is the chance of another.
 */
export function rollEnemyDrops(arch: EnemyArchetype, rng: Rng, bias?: LootBias): Drop[] {
  const out: Drop[] = [];
  for (let odds = arch.dropRate * drops.rateMult; odds > 0; odds--) {
    if (rng() < odds) out.push(rollDrop(arch.dropTier, rng, bias, arch.meseta, arch.lootRare, arch.ilvl));
  }
  return out;
}

export function rollEnemyDrop(arch: EnemyArchetype, rng: Rng, bias?: LootBias): Drop | null {
  return rollEnemyDrops(arch, rng, bias)[0] ?? null;
}

/**
 * Elites roll an extra drop that always lands, one tier richer, with rares 2.5× as likely (tier 6 stays in the
 * Mines, and Hard enemies already drop up to their expedition's top tier).
 */
export function rollEliteBonus(arch: EnemyArchetype, rng: Rng, bias?: LootBias): Drop {
  const [lo, hi] = arch.meseta;
  const cap = arch.dropTier >= 6 ? arch.dropTier : 5;
  return rollDrop(Math.min(cap, arch.dropTier + 1), rng, bias, [lo * 2, hi * 2], 2.5 * (arch.lootRare ?? 1), arch.ilvl);
}

/** Hard champions: two bonus drops, and a chance at a tier 6 injector. */
export function rollChampionBonus(arch: EnemyArchetype, rng: Rng, bias?: LootBias): Drop[] {
  const out = [rollEliteBonus(arch, rng, bias), rollEliteBonus(arch, rng, bias)];
  if (rng() < 0.25) out.push({ kind: 'item', item: rollInjector(6, rng, bias, 1, 6) });
  return out;
}

export function rollBoxDrop(rng: Rng, bias?: LootBias): Drop | null {
  if (rng() >= drops.boxDropRate * drops.rateMult) return null;
  return rollDrop(1, rng, bias, [10, 40]);
}

/** A boss's gear: at least magic, often rare. */
const bossRarity = (rng: Rng) => rollRarity(rng, 3, 'magic');

export function rollDragonDrops(rng: Rng, bias?: LootBias): Drop[] {
  const out: Drop[] = [{ kind: 'meseta', amount: 1100 + Math.round(rng() * 400) }];
  out.push({ kind: 'item', item: rollWeapon(2 + (rng() < 0.4 ? 1 : 0), rng, bias, bossRarity(rng)) });
  out.push({ kind: 'item', item: rollArmor(2, rng, bias, bossRarity(rng)) });
  out.push({ kind: 'item', item: rollUnit(2, rng) });
  out.push({ kind: 'item', item: rollPhoton(2, rng) }, { kind: 'item', item: rollPhoton(2, rng) });
  return out;
}

export function rollDeRolLeDrops(rng: Rng, bias?: LootBias): Drop[] {
  const out: Drop[] = [{ kind: 'meseta', amount: 2800 + Math.round(rng() * 1200) }];
  out.push({ kind: 'item', item: rollWeapon(4 + (rng() < 0.45 ? 1 : 0), rng, bias, bossRarity(rng)) });
  out.push({ kind: 'item', item: rollArmor(4 + (rng() < 0.3 ? 1 : 0), rng, bias, bossRarity(rng)) });
  out.push({ kind: 'item', item: rollUnit(5, rng) });
  out.push({ kind: 'item', item: rollInjector(4 + (rng() < 0.3 ? 1 : 0), rng, bias, 1) });
  out.push({ kind: 'item', item: rollPhoton(5, rng) }, { kind: 'item', item: rollPhoton(5, rng) });
  return out;
}

/** The Warden: tier 5-6 gear, a unit and a modded injector. */
export function rollWardenDrops(rng: Rng, bias?: LootBias): Drop[] {
  const out: Drop[] = [{ kind: 'meseta', amount: 4000 + Math.round(rng() * 1500) }];
  out.push({ kind: 'item', item: rollWeapon(rng() < 0.55 ? 6 : 5, rng, bias, bossRarity(rng)) });
  out.push({ kind: 'item', item: rng() < 0.3 ? decorate(makeItem('barrier_6'), bossRarity(rng), rng) : rollArmor(rng() < 0.5 ? 6 : 5, rng, bias, bossRarity(rng)) });
  out.push({ kind: 'item', item: rollUnit(6, rng) });
  out.push({ kind: 'item', item: rollInjector(5, rng, bias, 1) });
  out.push({ kind: 'item', item: rollPhoton(6, rng) }, { kind: 'item', item: rollPhoton(6, rng) });
  return out;
}

/** Dark Falz: tier 6-7 gear, a unit and a modded injector. */
export function rollFalzDrops(rng: Rng, bias?: LootBias): Drop[] {
  const out: Drop[] = [{ kind: 'meseta', amount: 5500 + Math.round(rng() * 2000) }];
  out.push({ kind: 'item', item: rollWeapon(rng() < 0.55 ? 7 : 6, rng, bias, bossRarity(rng)) });
  out.push({ kind: 'item', item: rollArmor(rng() < 0.5 ? 7 : 6, rng, bias, bossRarity(rng)) });
  out.push({ kind: 'item', item: rollUnit(7, rng) });
  out.push({ kind: 'item', item: rollInjector(5, rng, bias, 1) });
  out.push({ kind: 'item', item: rollPhoton(7, rng) }, { kind: 'item', item: rollPhoton(7, rng) });
  return out;
}

/** Each boss's Normal loot. */
export const BOSS_DROPS: Record<BossId, (rng: Rng, bias?: LootBias) => Drop[]> = {
  dragon: rollDragonDrops,
  derolle: rollDeRolLeDrops,
  warden: rollWardenDrops,
  falz: rollFalzDrops,
};

/** Each Nightmare boss's base Meseta (its top tier is its expedition's, from `hard`). */
const HARD_BOSS_MESETA: Record<BossId, number> = { dragon: 9000, derolle: 13000, warden: 17000, falz: 22000 };

/** Hard bosses: their expedition's top tier (rare at least once), a unit and a modded tier 6 injector. */
export function rollHardBossDrops(boss: BossId, rng: Rng, bias?: LootBias): Drop[] {
  const base = HARD_BOSS_MESETA[boss];
  const { dropTier: top } = hardScale(expeditionOfBoss(boss));
  // The +1000 replaced the Trimate and Trifluid they used to drop.
  const out: Drop[] = [{ kind: 'meseta', amount: base + 1000 + Math.round(rng() * base * 0.5) }];
  out.push({ kind: 'item', item: rollWeapon(rng() < 0.55 ? top : top - 1, rng, bias, 'rare') });
  out.push({ kind: 'item', item: rollArmor(rng() < 0.5 ? top : top - 1, rng, bias, bossRarity(rng)) });
  out.push({ kind: 'item', item: rollUnit(top, rng) });
  out.push({ kind: 'item', item: rollInjector(6, rng, bias, 1, 6) });
  out.push({ kind: 'item', item: rollPhoton(top, rng) }, { kind: 'item', item: rollPhoton(top, rng) });
  out.push({ kind: 'item', item: rollPhoton(top, rng) });
  return out;
}

/** Each Hell boss's base Meseta. */
const HELL_BOSS_MESETA: Record<BossId, number> = { dragon: 30000, derolle: 40000, warden: 52000, falz: 66000 };

/** Hell bosses: their expedition's top tiers, all rare (up to 6 affixes), two units and a modded tier 6 injector. */
export function rollHellBossDrops(boss: BossId, rng: Rng, bias?: LootBias): Drop[] {
  const base = HELL_BOSS_MESETA[boss];
  const { dropTier: top } = hardScale(expeditionOfBoss(boss), true);
  const out: Drop[] = [{ kind: 'meseta', amount: base + Math.round(rng() * base * 0.5) }];
  out.push({ kind: 'item', item: rollWeapon(top, rng, bias, 'rare') });
  out.push({ kind: 'item', item: rollWeapon(rng() < 0.5 ? top : top - 1, rng, bias, 'rare') });
  out.push({ kind: 'item', item: rollArmor(top, rng, bias, 'rare') });
  out.push({ kind: 'item', item: rollArmor(rng() < 0.5 ? top : top - 1, rng, bias, 'rare') });
  out.push({ kind: 'item', item: rollUnit(top, rng) }, { kind: 'item', item: rollUnit(top, rng) });
  out.push({ kind: 'item', item: rollInjector(6, rng, bias, 1, 6) });
  out.push({ kind: 'item', item: rollPhoton(top, rng) }, { kind: 'item', item: rollPhoton(top, rng) }, { kind: 'item', item: rollPhoton(top, rng) });
  out.push({ kind: 'item', item: rollPhoton(top, rng) }, { kind: 'item', item: rollPhoton(top, rng) });
  return out;
}

/**
 * Falz Rifts: the end of a rift. A boss drops like its Hell self at the top gear tiers; the Guardian room (rifts
 * without a boss) a little less. Everything rolls at the rift's item level, so affix tiers 7-8 can show up.
 * `qty`: the rift's item quantity (tier and shard, percent), extra rare gear on top of the fixed pieces (+50% on a
 * Guardian's three: one or two more). The boss's own unique rolls apart (riftCircles.ts).
 */
export function rollRiftEndDrops(boss: boolean, tier: number, ilvl: number, rng: Rng, bias?: LootBias, qty = 0): Drop[] {
  const base = (boss ? 70000 : 40000) * (1 + 0.1 * tier);
  const out: Drop[] = [{ kind: 'meseta', amount: Math.round(base + rng() * base * 0.5) }];
  const top = 15;
  const t = () => (rng() < 0.5 ? top : top - 1);
  out.push({ kind: 'item', item: rollWeapon(top, rng, bias, 'rare', ilvl) });
  out.push({ kind: 'item', item: rollArmor(t(), rng, bias, 'rare', ilvl) });
  out.push({ kind: 'item', item: rollUnit(top, rng, ilvl) });
  if (boss) {
    out.push({ kind: 'item', item: rollWeapon(t(), rng, bias, 'rare', ilvl) });
    out.push({ kind: 'item', item: rollArmor(top, rng, bias, 'rare', ilvl) });
    out.push({ kind: 'item', item: rollUnit(top, rng, ilvl) });
    out.push({ kind: 'item', item: rollInjector(6, rng, bias, 1, 6) });
    out.push({ kind: 'item', item: rollPhoton(top, rng, ilvl) });
    out.push({ kind: 'item', item: rollPhoton(top, rng, ilvl) });
  }
  out.push({ kind: 'item', item: rollPhoton(top, rng, ilvl) }, { kind: 'item', item: rollPhoton(top, rng, ilvl) });
  out.push({ kind: 'item', item: rollPhoton(top, rng, ilvl) }, { kind: 'item', item: rollPhoton(top, rng, ilvl) });
  // (A rift boss's own unique rolls apart, with the save's first kills: riftCircles.ts rollBossUnique.)
  // Item quantity: more rare gear, a weapon, armour or unit each.
  for (let odds = ((boss ? 6 : 3) * qty) / 100; odds > 0; odds--) {
    if (rng() >= odds) continue;
    const r = rng();
    out.push({ kind: 'item', item: r < 0.4 ? rollWeapon(t(), rng, bias, 'rare', ilvl) : r < 0.8 ? rollArmor(t(), rng, bias, 'rare', ilvl) : rollUnit(top, rng, ilvl) });
  }
  return out;
}

/** A main-game boss's loot on difficulty `d`, and now and then (drops.uniqueBoss) a unique from the main pool. */
export function rollBossDrops(boss: BossId, d: Difficulty | boolean, rng: Rng, bias?: LootBias): Drop[] {
  const diff = asDifficulty(d);
  const out = diff === 'hell' ? rollHellBossDrops(boss, rng, bias) : diff === 'nightmare' ? rollHardBossDrops(boss, rng, bias) : BOSS_DROPS[boss](rng, bias);
  if (rng() < drops.uniqueBoss[diff] * drops.rareMult) out.push({ kind: 'item', item: rollUnique('main', bossUniqueTier(boss, diff), rng, bias) });
  return out;
}

// ------------------------------------------------------------------ shops

export type ShopKind = 'weapon' | 'armor' | 'item';

/** Bosses this character has beaten on Normal, on Nightmare (`hard`) and on Hell: each opens shop tiers (BOSSES[id].shop / hardShop / hellShop). */
export type ShopUnlocks = Partial<Record<BossId, boolean>> & { hard?: Partial<Record<BossId, boolean>>; hell?: Partial<Record<BossId, boolean>> };

/**
 * Highest tier a shop stocks for a given character level: the level ladder up to tier 4, then whatever the
 * bosses beaten open (tier 5 after De Rol Le from Lv 24 ... tier 15 after the Hell Dark Falz).
 */
export function shopTier(level: number, u: ShopUnlocks = {}): number {
  let tier = level >= 20 ? 4 : level >= 12 ? 3 : level >= 5 ? 2 : 1;
  const open = (unlocks: ShopUnlock[]) => {
    for (const s of unlocks) if (level >= s.level) tier = Math.max(tier, s.tier);
  };
  for (const id of BOSS_IDS) {
    if (u[id]) open(BOSSES[id].shop);
    if (u.hard?.[id]) open(BOSSES[id].hardShop);
    if (u.hell?.[id]) open(BOSSES[id].hellShop);
  }
  return tier;
}

/** Shops sell white and blue gear only: rares and uniques drop. */
const shopRarity = (rng: Rng) => (rng() < 0.35 ? 'magic' : 'normal');

export function shopStock(kind: ShopKind, level: number, bias: LootBias, rng: Rng, unlocks: ShopUnlocks = {}): ItemInstance[] {
  const maxTier = shopTier(level, unlocks);
  const out: ItemInstance[] = [];
  if (kind === 'weapon') {
    // Guarantee a few weapons of the class's family, then random fill.
    for (let i = 0; i < 9; i++) {
      const tier = Math.max(1, maxTier - (rng() < 0.5 ? 1 : 0));
      const w = rollWeapon(tier, rng, i < 5 ? bias : undefined, shopRarity(rng));
      out.push(w);
    }
  } else if (kind === 'armor') {
    // Standard starters, then every line at the two best tiers on sale (some of them magic).
    out.push(makeItem('frame_1'), makeItem('barrier_1'));
    if (maxTier >= 6) out.push(makeItem('barrier_6'));
    for (let t = Math.max(1, maxTier - 1); t <= maxTier; t++) {
      for (const slot of ['frame', 'barrier'] as const) {
        for (const line of ARMOR_LINES) out.push(decorate(makeItem(`${slot}_${line}_${t}`), shopRarity(rng), rng));
      }
    }
  } else {
    // Clean injectors: tier 1 and the two best tiers on sale, plus a couple with a mod.
    const injTop = Math.min(5, maxTier);
    for (const t of new Set([1, Math.max(1, injTop - 1), injTop])) out.push(makeItem(`mate_${t}`), makeItem(`fluid_${t}`));
    for (let i = 0; i < 2; i++) out.push(rollInjector(Math.max(1, injTop - 1), rng, bias, 1));
  }
  return out;
}

/** A shop copy of `proto` with its own uid (everything rolled carries over). */
export function shopCopy(proto: ItemInstance): ItemInstance {
  return { ...(JSON.parse(JSON.stringify(proto)) as ItemInstance), uid: newUid() };
}

const RARITY_BUY: Record<Rarity, number> = { normal: 1, magic: 1.6, rare: 2.8, unique: 1 };

/** Price including the rarity premium. */
export function buyPrice(inst: ItemInstance): number {
  const def = itemDefs[inst.id];
  let p = def.price * RARITY_BUY[def.rare ? 'unique' : (inst.rarity ?? 'normal')];
  if (inst.mod) p *= 1.4;
  return Math.round(p);
}

