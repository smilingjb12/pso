import { describe, expect, it } from 'vitest';
import { Character, compareEquip, describeItem, itemHeadline, makeItem } from './character';
import { getDef, itemDefs, MAX_STACK } from './data/items';
import { isGear, isStackable, itemRequirement, itemSlot, ITEM_TYPES, stackCap } from './itemTypes';

/** A fresh character wearing `ids` (added to the inventory and equipped, requirements ignored). */
function wearing(...ids: string[]): Character {
  const ch = Character.create('t');
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
    expect(itemSlot(getDef('rod_1'))).toBe('weapon');
    expect(itemSlot(getDef('wand_1'))).toBe('weapon');
    expect(itemSlot(getDef('frame_psy_2'))).toBe('frame');
    expect(itemSlot(getDef('barrier_psy_2'))).toBe('barrier');
    expect(itemSlot(getDef('mate_3'))).toBe('injector');
    expect(itemDefs.photon_drop).toBeUndefined();
    expect(itemDefs.telepipe).toBeUndefined();
    for (const def of Object.values(itemDefs)) {
      expect(isStackable(def)).toBe(!isGear(def) && def.type !== 'unit');
      expect(stackCap(def)).toBe(def.type === 'consumable' ? (def.maxStack ?? MAX_STACK) : MAX_STACK);
    }
  });

  it('reads each type\'s level requirement', () => {
    expect(itemRequirement(getDef('rod_4'))).toEqual({ level: 12 });
    expect(itemRequirement(getDef('unique_reactorRod_4'))).toEqual({ level: 12 });
    expect(itemRequirement(getDef('unique_redRing_12'))).toBeNull();
    expect(itemRequirement(getDef('barrier_psy_2'))).toEqual({ level: 3 });
    expect(itemRequirement(getDef('mate_3'))).toEqual({ level: 7 });
    expect(itemRequirement(getDef('frame_1'))).toBeNull();
    expect(itemDefs.monogrinder).toBeUndefined();
  });
});

describe('gear stat bonuses', () => {
  it('adds armour and weapon bonuses to the stat totals', () => {
    const base = wearing().stats();
    const ch = wearing('frame_psy_2', 'barrier_psy_2', 'rod_4');
    const s = ch.stats();
    const rodMst = wearing('rod_4').stats().mst - base.mst;
    // Everything counts as fully ground (2026-10-11): armour bonuses x1.25 at tier 1-2. frame_1 (damage taken −4%) is
    // swapped for Psy Armor (−4%, tech damage 15, TP 13); the Psy Shield adds −3%, tech damage 10, TP 8; the rod its
    // tech damage with its Edge (27 + 24) in place of the start Wand's (6 + 5).
    expect(rodMst).toBe(27 + 24 - (6 + 5));
    expect(s.strike - base.strike).toBe(4 - 4 + 3);
    expect(s.area - base.area).toBe(4 - 4 + 3);
    expect(s.mst - base.mst).toBe(15 + 10 + rodMst);
    expect(s.tp - base.tp).toBe(13 + 8);
    expect(s.lck).toBe(base.lck);
    expect(s.hp).toBe(base.hp);
  });

  it('keeps the item text', () => {
    expect(describeItem(makeItem('frame_psy_2'))).toEqual([
      'Normal Psy Frame · iLvl 5', 'Damage taken −4%  Tech damage +15  TP +13', 'A light weave: tech damage and TP.', 'Req: Lv 3',
    ]);
    expect(describeItem(makeItem('barrier_psy_2'))[1]).toBe('Damage taken −3%  Tech damage +10  TP +8');
    const rod = makeItem('unique_reactorRod_4');
    const lines = describeItem(rod);
    expect(lines[0]).toBe('Unique Rod · iLvl 17');
    expect(lines).toContain('Req: Lv 12');
    expect(lines).toContain("A control rod from the Mines' core, run past its limits.");
    expect(itemHeadline(rod)).toBe(lines[1]);
    expect(describeItem(makeItem('mate_3'))).toEqual([
      'Mate injector · tier 3', '3 doses · each restores 36% of max HP',
      'Refills as you damage enemies, and fully between fights and in Pioneer 2.', 'Req: Lv 7',
    ]);
    expect(itemHeadline(makeItem('mate_3'))).toBe('HP 36% · 3/3 doses');
  });

  it('compares by damage (and armour by its rating next), then the stats that change', () => {
    const rows = (id: string) => compareEquip(wearing(), makeItem(id))!.rows;
    const plain = (id: string) => rows(id).filter((r) => !r.key && !r.tie).map((r) => [r.label, r.delta]);
    expect(rows('frame_psy_2')[0]).toMatchObject({ label: 'Damage/s', key: true });
    expect(rows('frame_psy_2')[1]).toMatchObject({ label: 'Rating', tie: true });
    expect(plain('frame_psy_2')).toEqual([['Strike damage taken', 0], ['Area damage taken', 0], ['Tech damage', 15], ['TP', 13]]);
    expect(plain('barrier_psy_2')).toEqual([['Strike damage taken', 3], ['Area damage taken', 3], ['Tech damage', 10], ['TP', 8]]);
    expect(rows('rod_4')[0]).toMatchObject({ label: 'Damage/s', key: true });
    expect(plain('rod_4')).toEqual([['Tech damage', 27 + 24 - (6 + 5)]]);
    // A better weapon wins on damage per second.
    expect(rows('rod_4')[0].delta).toBeGreaterThan(0);
    expect(rows('wand_3')[0].delta).toBeGreaterThan(0);
  });
});
