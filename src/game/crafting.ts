import { rarityOf, type Character, type CharacterData, type ItemInstance } from './character';
import { craftCfg } from './config';
import { affixTier, capOf, capped, gearDef, ilvlOf, isRace } from './craftCeiling';
import { getDef, itemDefs, PHOTON_STACK, type CraftId } from './data/items';
import { affixText, ITEM_AFFIXES, maxAffixTier, tierRange, type AffixRoll } from './data/itemAffixes';
import { rollAffixes, type Rng } from './loot';

export { affixTier };

// Crafting with photons (DESIGN.md "Crafting: Photons"; redesigned 2026-10-13, the user's call): a weapon, frame or
// barrier that isn't a unique has fixed affix counts (rares also hold dormant affixes), and three photons work on its
// active affixes as often as you have them. Drop (common): reroll a value in its strength tier. Sphere (rare): a
// strength tier up, to the best the item level allows. Crystal (very rare): swap an active affix for a dormant one of
// the same kind. The player picks the target of every craft; what can be swapped in is the item's own (its 9 on a
// Hell or rift rare), so the chase is still for the right drop. No Potential budget any more.

/** How often each photon drops, for its card. */
export const PHOTON_RARITY: Record<CraftId, string> = { drop: 'Common photon', sphere: 'Rare photon', crystal: 'Very rare photon' };

/** Weapons, frames and barriers that aren't uniques. */
export function craftable(inst: ItemInstance): boolean {
  const def = getDef(inst.id);
  return (def.type === 'weapon' || def.type === 'armor') && !def.rare;
}

/** A seeded generator (mulberry32) from a string: an older item tops up the same way on every load. */
function seeded(key: string): Rng {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------ plans

/** One thing a craft can do to the item: an affix to work on, or (Crystal) an active-dormant pair to swap. */
export interface CraftChoice {
  /** Passed back to applyCraft: an affix index, or 'active:dormant' indices for a swap. */
  key: string;
  /** What it is now ("Weapon damage +27%"). */
  label: string;
  /** Strength tier now (tiered affixes only). */
  tier?: number;
  /** What the craft makes of it ("27 → 26-32", "tier 7: 29-35", or for a swap the affix coming in). */
  after: string;
  ok: boolean;
  /** Why it can't ('' when it can). */
  reason: string;
  /** A downside affix (gain and penalty): the one worked on, or for a swap the one coming in. */
  downside?: boolean;
}

export interface CraftPlan {
  craft: CraftId;
  /** The craft can be used on this item at all (some choice may still be unavailable). */
  ok: boolean;
  reason: string;
  choices: CraftChoice[];
}

const range = (lo: number, hi: number) => (lo === hi ? `${lo}` : `${lo}-${hi}`);

/** What rerolling or raising affix `r` would do (Photon Drop / Sphere). */
function valueChoice(inst: ItemInstance, r: AffixRoll, i: number, craft: 'drop' | 'sphere'): CraftChoice {
  const def = ITEM_AFFIXES[r.id];
  const base = { key: String(i), label: affixText(r), downside: !!def.penalty };
  if (capped(r.id)) {
    const { cap, step } = capOf(inst, r.id);
    if (craft === 'drop') {
      const ok = cap > step;
      return { ...base, after: `${r.v} → ${range(step, cap)}`, ok, reason: ok ? '' : 'Only one value' };
    }
    const ok = r.v + step <= cap;
    return { ...base, after: `${r.v} → ${r.v + step}`, ok, reason: ok ? '' : `At this tier's cap (${cap})` };
  }
  const t = affixTier(inst, r);
  const [lo, hi] = tierRange(def.tiers, t);
  const pen = def.penalty ? tierRange(def.penalty.tiers, t) : null;
  if (craft === 'drop') {
    const ok = hi > lo || (!!pen && pen[1] > pen[0]);
    const penText = pen ? ` · ${def.penalty!.stat.toUpperCase()} −${range(pen[0], pen[1])}` : '';
    return { ...base, tier: t, after: `${r.v} → ${range(lo, hi)}${penText}`, ok, reason: ok ? '' : 'Only one value at this tier' };
  }
  const top = maxAffixTier(ilvlOf(inst));
  if (t >= top) return { ...base, tier: t, after: '', ok: false, reason: `Tier ${t} is the best item level ${ilvlOf(inst)} allows` };
  const [nlo, nhi] = tierRange(def.tiers, t + 1);
  if (nhi <= r.v) return { ...base, tier: t, after: '', ok: false, reason: 'No higher values a tier up' };
  const npen = def.penalty ? tierRange(def.penalty.tiers, t + 1) : null;
  const penText = npen ? ` · ${def.penalty!.stat.toUpperCase()} −${range(npen[0], npen[1])}` : '';
  return { ...base, tier: t, after: `tier ${t + 1}: ${range(Math.max(nlo, r.v + 1), nhi)}${penText}`, ok: true, reason: '' };
}

/**
 * Every swap a Crystal can make on `inst`: each active affix with each dormant one of its kind. A race can only come
 * in for the active race (one at a time).
 */
export function swapChoices(inst: ItemInstance): CraftChoice[] {
  const active = inst.affixes ?? [];
  const out: CraftChoice[] = [];
  active.forEach((a, i) => {
    (inst.dormant ?? []).forEach((d, j) => {
      if (ITEM_AFFIXES[a.id].kind !== ITEM_AFFIXES[d.id].kind) return;
      const clash = isRace(d.id) && !isRace(a.id) && active.some((x) => isRace(x.id));
      out.push({
        key: `${i}:${j}`, label: affixText(a), tier: a.t, after: affixText(d), downside: !!ITEM_AFFIXES[d.id].penalty,
        ok: !clash, reason: clash ? 'One race affix at a time' : '',
      });
    });
  });
  return out;
}

/** What `craft` can do to `inst`: whether it can be used at all, and each choice (an affix, or a swap). */
export function craftPlan(inst: ItemInstance, craft: CraftId): CraftPlan {
  const plan: CraftPlan = { craft, ok: false, reason: '', choices: [] };
  const def = gearDef(inst);
  if (!def) return { ...plan, reason: 'Photons work on weapons, frames and barriers' };
  if (def.rare) return { ...plan, reason: "Uniques can't be crafted" };
  if (craft === 'crystal') {
    plan.choices = swapChoices(inst);
    if (!inst.dormant?.length) plan.reason = rarityOf(inst) === 'rare' ? 'No dormant affixes' : 'Only rares have dormant affixes';
    else if (!plan.choices.length) plan.reason = 'No dormant affix matches an active one';
  } else {
    plan.choices = (inst.affixes ?? []).map((r, i) => valueChoice(inst, r, i, craft));
    if (!plan.choices.length) plan.reason = 'No affixes to work on';
  }
  plan.ok = !plan.reason && plan.choices.some((c) => c.ok);
  if (!plan.reason && !plan.ok) {
    const reasons = new Set(plan.choices.map((c) => c.reason));
    plan.reason =
      reasons.size === 1 ? [...reasons][0]
      : craft === 'sphere' ? 'No affix can go a tier higher'
      : craft === 'drop' ? 'No affix has values to reroll'
      : 'Nothing it can swap';
  }
  return plan;
}

// ------------------------------------------------------------------ applying

const between = (lo: number, hi: number, rng: Rng) => lo + Math.floor(rng() * (hi - lo + 1));

/**
 * Do `craft` to `inst` with choice `key` (from craftPlan). Returns what happened ("Weapon damage +27% → +31%"), or an
 * error.
 */
export function applyCraft(inst: ItemInstance, craft: CraftId, key: string, rng: Rng = Math.random): { ok: true; text: string } | { ok: false; reason: string } {
  const plan = craftPlan(inst, craft);
  if (!plan.ok) return { ok: false, reason: plan.reason };
  const choice = plan.choices.find((c) => c.key === key);
  if (!choice) return { ok: false, reason: 'Pick what to change' };
  if (!choice.ok) return { ok: false, reason: choice.reason };
  const affixes = inst.affixes!;
  if (craft === 'crystal') {
    // A swap: the dormant one comes in with its own roll, the active one goes dormant with its.
    const [i, j] = key.split(':').map(Number);
    const dormant = inst.dormant!;
    [affixes[i], dormant[j]] = [dormant[j], affixes[i]];
    return { ok: true, text: `${affixText(dormant[j])} → ${affixText(affixes[i])}` };
  }
  const r = affixes[Number(key)];
  const a = ITEM_AFFIXES[r.id];
  const before = affixText(r);
  if (capped(r.id)) {
    const { cap, step } = capOf(inst, r.id);
    r.v = craft === 'drop' ? step * between(1, cap / step, rng) : r.v + step;
  } else {
    const t = affixTier(inst, r) + (craft === 'sphere' ? 1 : 0);
    const [lo, hi] = tierRange(a.tiers, t);
    // A Sphere never lowers the value: at least one more than before.
    r.v = craft === 'sphere' ? Math.max(between(lo, hi, rng), Math.min(hi, r.v + 1)) : between(lo, hi, rng);
    if (a.penalty) r.p = between(...tierRange(a.penalty.tiers, t), rng);
    r.t = t;
  }
  return { ok: true, text: `${before} → ${affixText(r)}` };
}

/**
 * Use a photon from the bag on an item in it: the craft is done and the photon used up. Returns what happened, or
 * an error.
 */
export function craftWith(ch: Character, targetUid: string, photonUid: string, key: string, rng: Rng = Math.random): { ok: true; text: string } | { ok: false; reason: string } {
  const target = ch.find(targetUid);
  const photon = ch.find(photonUid);
  if (!target || !photon) return { ok: false, reason: 'Missing item' };
  const pdef = getDef(photon.id);
  if (pdef.type !== 'photon') return { ok: false, reason: 'Not a photon' };
  const r = applyCraft(target, pdef.craft, key, rng);
  if (r.ok) ch.removeItem(photonUid, 1);
  return r;
}

/** Photon Drops salvaging this junk gives: a rare always one, a magic item sometimes one, anything else none. */
export function salvageYield(inst: ItemInstance, rng: Rng = Math.random): number {
  if (!craftable(inst)) return 0;
  const r = rarityOf(inst);
  return r === 'rare' ? 1 : r === 'magic' && rng() < craftCfg.salvageMagic ? 1 : 0;
}

// ------------------------------------------------------------------ old saves

/** Photons that went on 2026-10-13, and what they turn into. */
const RETIRED_PHOTONS: Record<string, string> = { null_photon: 'photon_sphere', augment_core: 'photon_crystal' };

/**
 * A saved character brought up to the 2026-10-13 crafting (call before `new Character`): Null Photons become
 * Spheres and Augment Cores Crystals (stacks merged, up to PHOTON_STACK); Potential and offers go; magic and rare
 * gear is topped up to the fixed counts and rares get their dormant affixes (seeded by the uid, so the same on
 * every load; affixes they already have stay).
 */
export function upgradeCrafting(data: CharacterData): CharacterData {
  for (const it of [...data.inventory]) {
    const to = RETIRED_PHOTONS[it.id];
    if (!to) continue;
    const n = it.qty ?? 1;
    const stack = data.inventory.find((x) => x.id === to);
    if (stack) {
      stack.qty = Math.min(PHOTON_STACK, (stack.qty ?? 1) + n);
      data.inventory.splice(data.inventory.indexOf(it), 1);
    } else it.id = to;
  }
  for (const it of data.inventory) {
    delete it.pot;
    delete it.potMax;
    delete it.offers;
    const def = itemDefs[it.id];
    if (!def || !craftable(it)) continue;
    const r = rarityOf(it);
    if (r === 'magic' || r === 'rare') rollAffixes(it, def, r, seeded(it.uid));
  }
  return data;
}
