import { rarityOf, type CharacterData } from './character';
import { itemDefs } from './data/items';
import { rollAffixes, type Rng } from './loot';

// Saved items brought up to the current loot (DESIGN.md "Affixes: what drops is what you get"). Crafting with photons
// (2026-10-11 to 10-22) went at the user's call: gear keeps the affixes it dropped with, and nothing changes them.

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

/** Crafting items that went, and the Meseta each is paid out at (its old shop price). */
const RETIRED_PHOTONS: Record<string, number> = {
  photon_drop: 1200, photon_sphere: 6000, photon_crystal: 20000, null_photon: 6000, augment_core: 20000,
};

/**
 * A saved character's items made current (call before `new Character`): photons (and the older Null Photons and
 * Augment Cores) are paid out in Meseta; Potential, offers and dormant affixes go; magic and rare gear is topped up to
 * the fixed affix counts (seeded by the uid, so the same on every load; affixes it already has stay as they are).
 */
export function upgradeSavedItems(data: CharacterData): CharacterData {
  for (const it of [...data.inventory]) {
    const price = RETIRED_PHOTONS[it.id];
    if (price === undefined) continue;
    data.meseta += price * (it.qty ?? 1);
    data.inventory.splice(data.inventory.indexOf(it), 1);
  }
  for (const it of data.inventory) {
    delete it.pot;
    delete it.potMax;
    delete it.offers;
    delete it.dormant;
    const def = itemDefs[it.id];
    if (!def || (def.type !== 'weapon' && def.type !== 'armor') || def.rare) continue;
    const r = rarityOf(it);
    if (r === 'magic' || r === 'rare') rollAffixes(it, def, r, seeded(it.uid));
  }
  return data;
}
