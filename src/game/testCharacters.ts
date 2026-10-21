import { BOSS_IDS } from './data/bosses';
import { MAX_LEVEL } from './data/stats';
import type { AffixRoll } from './data/itemAffixes';
import { Character, makeItem, MAG_UNIT_SLOTS, type CharacterData, type ItemInstance } from './character';
import { magPointsEarned } from './mag';
import { isUniqueUnit, UNIQUE_IDS, uniqueItemId, uniqueUnitId } from './data/uniques';

// Dev-only premade characters for testing (debug panel). They go into an empty save slot.

const a = (id: AffixRoll['id'], v: number, p?: number): AffixRoll => (p ? { id, v, p } : { id, v });

/** A rare with fixed, top-of-tier affixes (tier 11 tops out at affix tier 5, Haste at 4%). */
function rare(id: string, name: string, affixes: AffixRoll[], extra: Partial<ItemInstance> = {}): ItemInstance {
  return makeItem(id, { rarity: 'rare', name, affixes, ...extra });
}

const unit = (id: AffixRoll['id'], v: number) => makeItem('unit_11', { rarity: 'magic', affixes: [a(id, v)] });

/**
 * A Lv 76 character who has just beaten Dark Falz on Nightmare (Hell open, every Normal and Nightmare expedition
 * open). Gear is the Nightmare ceiling: a god-rolled tier 11 rod and wand (three offence prefixes, TP cost and
 * Haste), Psy frame and barrier, every unique (tier 15) in the bag, all Mag points in MIND. Skills are left to pick.
 */
export function testCharacter(level = 76): CharacterData {
  const d = Character.create('Test Force').data;
  d.level = Math.min(MAX_LEVEL, level);
  d.xp = 0;
  d.meseta = 500_000;
  d.mag = { mind: magPointsEarned(d.level), def: 0 };

  const staff = (id: string, name: string) => rare(id, name, [a('techPct', 23), a('mstFlat', 48), a('firePct', 32), a('tpCost', 12), a('haste', 4)]);
  const weapons = [staff('rod_11', 'Star Spire'), staff('wand_11', 'Night Whisper')];
  const frame = rare('frame_psy_11', 'Spirit Mantle', [a('hp', 110), a('strike', 6), a('mstFlat', 48), a('regen', 4), a('injCharge', 22)]);
  const barrier = rare('barrier_psy_11', 'Dawn Veil', [a('hp', 110), a('strike', 6), a('areaDr', 6), a('resCorrupt', 32), a('haste', 4)]);
  const units = [unit('mstFlat', 48), unit('hp', 110), unit('strike', 6), unit('lck', 32)];
  const injector = makeItem('fluid_6', { mod: 'reserve' });
  d.inventory = [
    ...weapons, frame, barrier, injector,
    // Every gear unique, at tier 15 (the unique units are learned below).
    ...UNIQUE_IDS.filter((id) => !isUniqueUnit(id)).map((id) => makeItem(uniqueItemId(id, 15))),
    makeItem('photon_drop', { qty: 10 }),
    makeItem('photon_sphere', { qty: 3 }),
    makeItem('photon_crystal', { qty: 2 }),
  ];
  d.equipped = { weapon: weapons[0].uid, frame: frame.uid, barrier: barrier.uid, injector: injector.uid };
  d.units = [...units, ...UNIQUE_IDS.filter(isUniqueUnit).map((id) => makeItem(uniqueUnitId(id)))];
  d.magUnits = units.slice(0, MAG_UNIT_SLOTS).map((u) => u.affixes![0].id);

  // Dark Falz down on Normal and Nightmare: every expedition on both, and Hell, are open.
  const st = d.stats;
  st.hardKills = {};
  for (const id of BOSS_IDS) {
    st.bossKills[id] = 1;
    st.hardKills[id] = 1;
  }
  st.pylonsLit = 1;
  return d;
}
