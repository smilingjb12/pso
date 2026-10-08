import { describe, expect, it } from 'vitest';
import { Character, compareEquip, describeItem, itemHeadline, makeItem } from './character';
import { getDef, itemDefs, MAX_STACK } from './data/items';
import { isGear, isStackable, itemRequirement, itemSlot, ITEM_TYPES, stackCap } from './itemTypes';

/** A fresh Vanguard wearing `ids` (added to the inventory and equipped, requirements ignored). */
function wearing(...ids: string[]): Character {
  const ch = Character.create('t', 'vanguard');
  for (const id of ids) {
    const inst = makeItem(id);
    ch.data.inventory.push(inst);
    ch.data.equipped[itemSlot(getDef(id))!] = inst.uid;
  }
  return ch;
}

describe('item type table', () => {
  it('has a handler for every item type in use', () => {
    for (const def of Object.values(itemDefs)) expect(ITEM_TYPES[def.type]).toBeDefined();
  });

  it('puts gear in slots and stacks only bag items', () => {
    expect(itemSlot(getDef('saber_1'))).toBe('weapon');
    expect(itemSlot(getDef('frame_psy_2'))).toBe('frame');
    expect(itemSlot(getDef('barrier_combat_2'))).toBe('barrier');
    expect(itemSlot(getDef('mate_3'))).toBe('injector');
    expect(itemSlot(getDef('telepipe'))).toBeNull();
    for (const def of Object.values(itemDefs)) {
      expect(isStackable(def)).toBe(!isGear(def));
      expect(stackCap(def)).toBe(def.type === 'consumable' ? (def.maxStack ?? MAX_STACK) : MAX_STACK);
    }
  });

  it('reads each type\'s requirement stat', () => {
    expect(itemRequirement(getDef('coral_rod'))).toEqual({ stat: 'mst', req: 150 });
    expect(itemRequirement(getDef('barrier_combat_2'))).toEqual({ stat: 'ata', req: 79 });
    expect(itemRequirement(getDef('mate_3'))).toEqual({ stat: 'dfp', req: 45 });
    expect(itemRequirement(getDef('frame_1'))).toBeNull();
    expect(itemRequirement(getDef('monogrinder'))).toBeNull();
  });
});

describe('gear stat bonuses', () => {
  it('adds armour and weapon bonuses to the stat totals', () => {
    const base = wearing().stats();
    const ch = wearing('frame_psy_2', 'barrier_combat_2', 'coral_rod');
    const s = ch.stats();
    const saber = getDef('saber_1');
    const rod = getDef('coral_rod');
    if (saber.type !== 'weapon' || rod.type !== 'weapon') throw new Error('not a weapon');
    // frame_1 (DFP 5, EVP 5) is swapped for Psy Armor (6 / 8, MST 12, TP 10); Combat Shield adds 6 / 11, ATP 3, ATA 3.
    expect(s.dfp - base.dfp).toBe(6 - 5 + 6);
    expect(s.evp - base.evp).toBe(8 - 5 + 11);
    expect(s.mst - base.mst).toBe(12 + 30);
    expect(s.tp - base.tp).toBe(10);
    expect(s.atp - base.atp).toBe(3);
    expect(s.ata - base.ata).toBe(3 + rod.ata - saber.ata);
    for (const k of ['hp', 'lck'] as const) expect(s[k]).toBe(base[k]);
  });

  it('keeps the item text', () => {
    expect(describeItem(makeItem('frame_psy_2'))).toEqual([
      'Psy Frame', 'DFP +6  EVP +8  MST +12  TP +10', 'Light weave that amplifies techniques: low DFP, adds MST and TP.', 'Req: MST 80',
    ]);
    expect(describeItem(makeItem('barrier_combat_2'))[1]).toBe('DFP +6  EVP +11  ATP +3  ATA +3');
    const rod = makeItem('coral_rod', { grind: 3, bane: { dark: 1 }, attrs: { native: 20, hit: 10 }, special: 'heat' });
    expect(describeItem(rod)).toEqual([
      'Rod · ★ RARE', 'ATP 131-161  ATA 43  MST +39', 'Grind 3/8 · Edge 2 · Dark 1', 'Special: Heat', 'Native 20% · Dark 5% · Hit 10%',
      'Req: MST 150', 'A rod of living cave coral that chills on contact.',
    ]);
    expect(itemHeadline(rod)).toBe('ATP 131-161  ATA 43  MST +39');
    expect(describeItem(makeItem('mate_3'))).toEqual([
      'Mate injector · tier 3', '3 doses · each restores 36% of max HP',
      'Refills as you damage enemies, slowly between fights, and fully in Pioneer 2.', 'Req: DFP 45',
    ]);
    expect(itemHeadline(makeItem('mate_3'))).toBe('HP 36% · 3/3 doses');
    expect(describeItem(makeItem('telepipe'))[0]).toBe('Carry up to 10 · field only · use it from the Items tab or a Q / E quick slot');
    expect(describeItem(makeItem('telepipe'), wearing()).some((l) => l.startsWith('✖'))).toBe(false);
  });

  it('compares headline stats, then the bonuses that change', () => {
    const rows = (id: string) => compareEquip(wearing(), makeItem(id))!.rows.map((r) => [r.label, r.delta]);
    expect(rows('frame_psy_2')).toEqual([['DFP', 1], ['EVP', 3], ['MST', 12], ['TP', 10]]);
    expect(rows('barrier_combat_2')).toEqual([['DFP', 6], ['EVP', 11], ['ATP', 3], ['ATA', 3]]);
    expect(rows('coral_rod')).toEqual([['ATP', 87.5], ['ATA', 10], ['MST', 30], ['Special', 0]]);
  });
});

describe('item passives', () => {
  it('come from whatever is worn', () => {
    expect(wearing().hasGearPassive('hazardWard')).toBe(false);
    const core = wearing('warden_core');
    expect(core.hasGearPassive('hazardWard')).toBe(true);
    expect(core.hasGearPassive('switchBrace')).toBe(true);
    expect(core.hasGearPassive('corruptionWard')).toBe(false);
    for (const id of ['seal_of_light', 'falz_halo']) {
      const ch = wearing(id);
      expect(ch.hasGearPassive('corruptionWard')).toBe(true);
      expect(ch.hasGearPassive('pylonKeeper')).toBe(true);
    }
  });
});
