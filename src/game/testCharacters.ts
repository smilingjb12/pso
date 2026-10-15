import { BOSS_IDS } from './data/bosses';
import { CLASSES, MAX_LEVEL } from './data/stats';
import type { AffixRoll } from './data/itemAffixes';
import { Character, makeItem, MAG_UNIT_SLOTS, type CharacterData, type ItemInstance } from './character';
import { magPointsEarned } from './mag';
import { UNIQUE_IDS, uniqueItemId } from './data/uniques';

// Dev-only premade characters for testing (debug panel). They go into an empty save slot.

export type TestClass = 'ranger' | 'hunter';

const a = (id: AffixRoll['id'], v: number, p?: number): AffixRoll => (p ? { id, v, p } : { id, v });

/** A rare with fixed, top-of-tier affixes (tier 11 tops out at affix tier 5, Haste at 4%). */
function rare(id: string, name: string, affixes: AffixRoll[], extra: Partial<ItemInstance> = {}): ItemInstance {
  return makeItem(id, { rarity: 'rare', name, affixes, ...extra });
}

interface Kit {
  /** Equipped first: the main weapon, then the other kinds. */
  weapons: ItemInstance[];
  frame: ItemInstance;
  barrier: ItemInstance;
  units: ItemInstance[];
  /** Uniques a Nightmare clear could have turned up, ground to their cap. */
}

const unit = (id: AffixRoll['id'], v: number) => makeItem('unit_11', { rarity: 'magic', affixes: [a(id, v)] });

function rangerKit(): Kit {
  // Five affixes (a tier 11 rare's most): three offence prefixes, crit chance and Haste. Ground to the cap (10), all Edge.
  const gun = (id: string, name: string) =>
    rare(id, name, [a('atpPct', 26), a('atpFlat', 45), a('perfectPct', 17), a('lck', 32), a('haste', 4)]);
  return {
    weapons: [gun('rifle_11', 'Star Gaze'), gun('handgun_11', 'Doom Bolt'), gun('shot_11', 'Nova Flare')],
    frame: rare('frame_combat_11', 'Night Mantle', [a('hp', 110), a('strike', 6), a('atpFlat', 45), a('regen', 4), a('injCharge', 22)], { slots: 3 }),
    barrier: rare('barrier_combat_11', 'Dawn Aegis', [a('hp', 110), a('strike', 6), a('areaDr', 6), a('resCorrupt', 32), a('haste', 4)]),
    units: [unit('lck', 32), unit('atpFlat', 45), unit('hp', 110), unit('strike', 6)],
  };
}

function hunterKit(): Kit {
  // Three offence prefixes (finisher damage for the melee one), Stagger and Haste.
  const blade = (id: string, name: string) =>
    rare(id, name, [a('atpPct', 26), a('atpFlat', 45), a('finisherPct', 18), a('staggerPct', 25), a('haste', 4)]);
  return {
    weapons: [blade('saber_11', 'Doom Edge'), blade('sword_11', 'Grim Cleaver'), blade('dagger_11', 'Night Fang')],
    frame: rare('frame_guard_11', 'Iron Carapace', [a('hp', 110), a('strike', 6), a('atpFlat', 45), a('regen', 4), a('injCharge', 22)], { slots: 3 }),
    barrier: rare('barrier_guard_11', 'Iron Bulwark', [a('hp', 110), a('strike', 6), a('areaDr', 6), a('stability', 42), a('haste', 4)]),
    units: [unit('atpFlat', 45), unit('hp', 110), unit('strike', 6), unit('lck', 32)],
  };
}

const KITS: Record<TestClass, () => Kit> = { ranger: rangerKit, hunter: hunterKit };

/**
 * A Lv 76 character who has just beaten Dark Falz on Nightmare (Hell open, every Normal and Nightmare expedition
 * open). Gear is the Nightmare ceiling: tier 11 god-rolled rares in every kind of the class's family, fully
 * Edge-ground, every unique (tier 15) in the bag, all Mag points in the class's own stat. Talents are left to pick.
 */
export function testCharacter(cls: TestClass, level = 76): CharacterData {
  const name = `Test ${CLASSES[cls].name}`;
  const d = Character.create(name, cls).data;
  d.level = Math.min(MAX_LEVEL, level);
  d.xp = 0;
  d.meseta = 500_000;
  d.mag = { pow: 0, dex: 0, mind: 0, def: 0, [CLASSES[cls].magStat]: magPointsEarned(d.level) };

  const kit = KITS[cls]();
  const injector = makeItem('mate_6', { mod: 'reserve' });
  d.inventory = [
    ...kit.weapons, kit.frame, kit.barrier, injector,
    // Every unique, at tier 15.
    ...UNIQUE_IDS.map((id) => makeItem(uniqueItemId(id, 15))),
    makeItem('photon_drop', { qty: 10 }),
    makeItem('photon_sphere', { qty: 3 }),
    makeItem('photon_crystal', { qty: 2 }),
  ];
  d.equipped = { weapon: kit.weapons[0].uid, frame: kit.frame.uid, barrier: kit.barrier.uid, injector: injector.uid };
  d.units = kit.units;
  d.magUnits = kit.units.slice(0, MAG_UNIT_SLOTS).map((u) => u.affixes![0].id);

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
