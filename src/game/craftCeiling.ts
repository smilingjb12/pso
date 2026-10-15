import type { ItemInstance } from './character';
import { hasteCfg } from './config';
import { getDef, raceCap, type ArmorItemDef, type WeaponItemDef } from './data/items';
import { ITEM_AFFIXES, maxAffixTier, tierIlvl, tierRange, type AffixRoll, type ItemAffixId } from './data/itemAffixes';

// How far photons can take an item (DESIGN.md "Crafting: Photons"): the limits crafting works within, and the
// best each affix and each set of active affixes can be. The drop verdict and the item card judge gear by its
// fully crafted self with these (character.ts bestCrafted), so a weak roll on a good base isn't called junk.

export type CraftGear = WeaponItemDef | ArmorItemDef;

export function gearDef(inst: ItemInstance): CraftGear | null {
  const def = getDef(inst.id);
  return def.type === 'weapon' || def.type === 'armor' ? def : null;
}

/** The item level its affixes roll at (a rift drop's own, or its tier's). */
export function ilvlOf(inst: ItemInstance): number {
  const def = gearDef(inst);
  return inst.ilvl ?? (def ? tierIlvl(def.tier) : 1);
}

export const isRace = (id: ItemAffixId) => id.startsWith('race');
/** Race % and Haste roll in steps up to the item tier's cap, not in strength tiers. */
export const capped = (id: ItemAffixId) => isRace(id) || id === 'haste';

/** Highest value a capped affix (race %, Haste) reaches on this item, and its step. */
export function capOf(inst: ItemInstance, id: ItemAffixId): { cap: number; step: number } {
  const tier = gearDef(inst)?.tier ?? 1;
  return isRace(id) ? { cap: raceCap(tier), step: 5 } : { cap: hasteCfg.capByTier[tier] ?? 1, step: 1 };
}

/** The strength tier (1-8) an affix roll is at: stored on rolls since crafting, worked out from the value before. */
export function affixTier(inst: ItemInstance, r: AffixRoll): number {
  if (r.t) return r.t;
  const def = ITEM_AFFIXES[r.id];
  for (let t = maxAffixTier(ilvlOf(inst)); t > 1; t--) if (r.v >= tierRange(def.tiers, t)[0]) return t;
  return 1;
}

/**
 * `r` at its best on `inst`: Spheres up to the top strength tier the item level allows, then Drops to the top of
 * that tier's range (a downside at the bottom of its penalty's); race % and Haste at the item tier's cap.
 */
export function maxedRoll(inst: ItemInstance, r: AffixRoll): AffixRoll {
  if (capped(r.id)) return { ...r, v: Math.max(r.v, capOf(inst, r.id).cap) };
  const def = ITEM_AFFIXES[r.id];
  const t = Math.max(affixTier(inst, r), maxAffixTier(ilvlOf(inst)));
  const out: AffixRoll = { id: r.id, v: Math.max(r.v, tierRange(def.tiers, t)[1]), t };
  if (def.penalty) out.p = tierRange(def.penalty.tiers, t)[0];
  return out;
}

/** Photons it takes to turn roll `from` into `to` (same affix): Spheres for the tiers (or cap steps), and whether Drops must reroll it. */
export function rollCost(inst: ItemInstance, from: AffixRoll, to: AffixRoll): { spheres: number; reroll: boolean } {
  if (capped(from.id)) return { spheres: Math.max(0, (to.v - from.v) / capOf(inst, from.id).step), reroll: false };
  const def = ITEM_AFFIXES[from.id];
  const t0 = affixTier(inst, from);
  const t1 = to.t ?? t0;
  // A Sphere lands anywhere above the old value in the new tier, so the top of the range is Drop luck too.
  const [lo, hi] = tierRange(def.tiers, t1);
  const pen = def.penalty ? tierRange(def.penalty.tiers, t1) : null;
  const luck = (to.v !== from.v || to.p !== from.p) && (hi > lo || (!!pen && pen[1] > pen[0]));
  return { spheres: t1 - t0, reroll: luck };
}

/**
 * Every set of active affixes Photon Crystals can give `inst`. A swap keeps the prefix / suffix split and only
 * trades places, so any as many of each kind as are active now can be picked from its active and dormant
 * affixes together (one race at most). Each set lists the item's own rolls (none maxed), the current one first.
 */
export function craftLoadouts(inst: ItemInstance): AffixRoll[][] {
  const active = inst.affixes ?? [];
  const all = [...active, ...(inst.dormant ?? [])];
  const choose = (pool: AffixRoll[], k: number): AffixRoll[][] => {
    if (k === 0) return [[]];
    if (pool.length < k) return [];
    const [head, ...rest] = pool;
    return [...choose(rest, k - 1).map((c) => [head, ...c]), ...choose(rest, k)];
  };
  const ofKind = (kind: 'prefix' | 'suffix') => {
    const pool = all.filter((r) => ITEM_AFFIXES[r.id].kind === kind);
    return choose(pool, active.filter((r) => ITEM_AFFIXES[r.id].kind === kind).length);
  };
  const out: AffixRoll[][] = [];
  for (const pre of ofKind('prefix')) {
    for (const suf of ofKind('suffix')) {
      const set = [...pre, ...suf];
      if (set.filter((r) => isRace(r.id)).length <= 1) out.push(set);
    }
  }
  return out;
}
