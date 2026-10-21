import { describe, expect, it } from 'vitest';
import {
  Character, compareEquip, dropVerdict, gearVerdict, grindBonus, itemName, LOADABLE_VERSIONS, makeItem, rarityOf, readAffixData, SAVE_VERSION, statDef,
  type CharacterData, type ItemInstance,
} from './character';
import { enemies } from './config';
import { upgradeCrafting } from './crafting';
import { areas } from './data/areas';
import { BASE_STATS, MAX_LEVEL, START_INJECTOR, START_WEAPON, xpToNext } from './data/stats';
import { BARE_KIND, getDef, grindCap, INVENTORY_SIZE, itemDefs, PHOTON_STACK, weaponKinds, type ArmorItemDef, type WeaponItemDef } from './data/items';
import { affixFits, ITEM_AFFIXES, RETIRED_AFFIXES, tierIlvl } from './data/itemAffixes';
import { restaHeal } from './data/techniques';
import {
  dormantCount, rareCount, rollArmor, rollDragonDrops, rollDrop, rollEliteBonus, rollEnemyDrop, rollFalzDrops, rollInjector, rollUnit, rollWardenDrops, rollWeapon,
  shopStock, shopTier,
} from './loot';
import { Level, mulberry32, TILE } from './world/Level';

/** A character at `level` (no Mag points spent). */
function atLevel(level: number): Character {
  const ch = Character.create('T');
  ch.data.level = level;
  return ch;
}

describe('Character', () => {
  it('starts with a usable wand and a Fluid injector equipped', () => {
    const ch = Character.create('T');
    const w = ch.weaponInstance();
    expect(w?.id).toBe(START_WEAPON);
    expect(ch.canEquip(w!).ok).toBe(true);
    expect(ch.injector()?.id).toBe(START_INJECTOR);
    expect(ch.equippedItem('frame')?.id).toBe('frame_1');
    expect(ch.maxHp).toBeGreaterThan(0);
  });

  it('levels up and carries over excess XP', () => {
    const ch = Character.create('T');
    const hp1 = ch.maxHp;
    const gained = ch.addXp(xpToNext(1) + xpToNext(2) + 5);
    expect(gained).toBe(2);
    expect(ch.level).toBe(3);
    expect(ch.data.xp).toBe(5);
    expect(ch.maxHp).toBeGreaterThan(hp1);
  });

  it('stacks bag items up to the cap, one stack per type', () => {
    const ch = Character.create('T');
    const start = ch.countOf('photon_drop');
    expect(ch.addItem(makeItem('photon_drop', { qty: PHOTON_STACK - start }))).toBe(true);
    expect(ch.countOf('photon_drop')).toBe(PHOTON_STACK);
    expect(ch.addItem(makeItem('photon_drop'))).toBe(false);
  });

  it('carries photons outside the bag: a full bag still takes them', () => {
    const ch = Character.create('T');
    while (!ch.full) ch.addItem(makeItem('rod_1'));
    expect(ch.addItem(makeItem('photon_sphere'))).toBe(true);
    expect(ch.full).toBe(true);
    expect(ch.bagCount).toBe(INVENTORY_SIZE);
  });

  it('drops items that no longer exist (the Telepipe) from old saves', () => {
    const data = Character.create('T').data;
    data.inventory.push({ uid: 'old', id: 'telepipe', qty: 3 });
    const ch = new Character(JSON.parse(JSON.stringify(data)));
    expect(ch.data.inventory.some((i) => i.id === 'telepipe')).toBe(false);
  });

  it('respects inventory capacity for non-stackables', () => {
    const ch = Character.create('T');
    while (ch.data.inventory.length < INVENTORY_SIZE) expect(ch.addItem(makeItem('rod_1'))).toBe(true);
    expect(ch.addItem(makeItem('rod_1'))).toBe(false);
  });

  it('gates gear by level only', () => {
    const ch = Character.create('T');
    expect(ch.canEquip(makeItem('rod_1')).ok).toBe(true);
    expect(ch.canEquip(makeItem('rod_3'))).toMatchObject({ ok: false, reason: 'Requires Lv 7 (you are Lv 1)', need: { level: 7 } });
    ch.addXp(100000);
    expect(ch.canEquip(makeItem('rod_3')).ok).toBe(true);
  });

  it('grows like the old Force', () => {
    // Lv 31 = 30 levels of growth; damage taken grows a little a level (it replaced DFP growth on 2026-10-14).
    expect(atLevel(1).baseStats()).toEqual(BASE_STATS);
    expect(atLevel(31).baseStats()).toEqual({ hp: 70 + 7.5 * 30, tp: 80 + 6 * 30, mst: 60 + 4 * 30, lck: 45 + 30, strike: 3, area: 3 });
  });

  it('stops levelling at the cap', () => {
    const ch = Character.create('T');
    ch.addXp(1e12);
    expect(ch.level).toBe(MAX_LEVEL);
    expect(ch.maxed).toBe(true);
    expect(ch.addXp(1e6)).toBe(0);
    expect(ch.data.xp).toBe(0);
  });

  it('counts every weapon as fully ground (Edge at its cap): a share more of its tech damage', () => {
    const ch = Character.create('T');
    const wand = ch.weaponDef(); // Wand: tech damage 6
    expect(wand.kind).toBe('wand');
    expect(ch.weaponEdge()).toBe(grindCap(wand));
    expect(grindBonus(wand, grindCap(wand))).toBeGreaterThan(0);
    expect(ch.stats().mst - ch.ownStats().mst).toBe(wand.bonus.mst! + grindBonus(wand, grindCap(wand)));
  });

  it('weapons and armour take 5-12 grind levels by tier, uniques 2 more', () => {
    expect([1, 2, 3, 5, 7, 9, 15].map((tier) => grindCap({ tier }))).toEqual([5, 5, 6, 7, 8, 9, 12]);
    expect(grindCap(itemDefs.unique_darkFlow_2 as { tier: number; rare?: boolean })).toBe(7);
  });

  it('counts frames and barriers as fully ground too: a share more of their stat bonuses (damage taken is the ground value)', () => {
    const f = makeItem('frame_psy_4');
    const base = itemDefs.frame_psy_4 as ArmorItemDef;
    const refined = statDef(f) as ArmorItemDef;
    expect(refined.bonus!.mst).toBe(Math.round(base.bonus!.mst! * (1 + 0.05 * grindCap(base))));
    expect(refined.dr).toBe(base.dr);
    expect(itemName(f)).not.toMatch(/\+\d+$/);
  });

  it('old saves drop their grind and Bane levels (everything counts as fully ground now)', () => {
    const d = Character.create('T').data;
    const w = makeItem('rod_5', { grind: 4, bane: { machine: 2, dark: 1 } });
    d.inventory.push(w, { uid: 'g', id: 'monogrinder', qty: 3 });
    const ch = new Character(d);
    const after = ch.find(w.uid)!;
    expect(after.grind).toBeUndefined();
    expect(after.bane).toBeUndefined();
    expect(itemName(after)).toBe('Obelisk');
    expect(ch.countOf('monogrinder')).toBe(0);
  });

  it('old saves move their affix rolls to the 2026-10-14 units once', () => {
    const d = Character.create('T').data;
    delete d.affixUnits;
    const frame = makeItem('frame_psy_11', {
      rarity: 'rare',
      affixes: [{ id: 'dfp' as never, v: 32, t: 6 }, { id: 'areaDr', v: 10, t: 6 }, { id: 'brittle', v: 20, p: 30, t: 6 }],
      dormant: [{ id: 'lck', v: 30, t: 6 }],
    });
    const unit = makeItem('unit_11', { rarity: 'magic', affixes: [{ id: 'dfp' as never, v: 45, t: 6 }] });
    d.inventory.push(frame);
    d.units = [unit];
    d.magUnits = ['dfp' as never];
    const ch = new Character(d);
    expect(ch.find(frame.uid)!.affixes).toEqual([
      { id: 'strike', v: 5, t: 6 },
      { id: 'areaDr', v: 7, t: 6 },
      { id: 'brittle', v: 20, p: 5, t: 6 },
    ]);
    expect(ch.find(frame.uid)!.dormant).toEqual([{ id: 'lck', v: 30, t: 6 }]);
    expect(ch.data.units[0].affixes).toEqual([{ id: 'strike', v: 8, t: 6 }]);
    expect(ch.data.magUnits).toEqual(['strike']);
    // Only once: a save already in the new units keeps its rolls.
    const again = new Character(JSON.parse(JSON.stringify(ch.data)));
    expect(again.find(frame.uid)!.affixes).toEqual(ch.find(frame.uid)!.affixes);
  });

  it('lets tech damage alone decide how strong techniques are, and what they cost', () => {
    const plain = atLevel(42);
    const mind = atLevel(42);
    expect(mind.spendMag('mind', 42)).toBeNull();
    const [pMst, mMst] = [plain.stats().mst, mind.stats().mst];
    expect(mMst).toBeGreaterThan(pMst);
    // Attack techs hit in proportion to tech damage, and more tech damage gets more damage out of each TP...
    expect(mind.techDamage('foie') / plain.techDamage('foie')).toBeCloseTo(mMst / pMst);
    expect(mind.techDamage('foie') / mind.techCost('foie')).toBeGreaterThan(plain.techDamage('foie') / plain.techCost('foie'));
    // ...but each cast costs more TP.
    expect(mind.techCost('foie')).toBeGreaterThan(plain.techCost('foie'));
    // Resta heals more with more tech damage.
    expect(restaHeal(mMst)).toBeGreaterThan(restaHeal(pMst));
    // More MST from gear raises both damage and cost.
    const before = [plain.techDamage('zonde'), plain.techCost('zonde')];
    const rod = makeItem('rod_4');
    plain.addItem(rod);
    expect(plain.equip(rod.uid).ok).toBe(true);
    expect(plain.techDamage('zonde')).toBeGreaterThan(before[0]);
    expect(plain.techCost('zonde')).toBeGreaterThanOrEqual(before[1]);
  });
});

describe('loot', () => {
  it('never drops or sells technique disks', () => {
    const rng = mulberry32(7);
    for (const arch of [enemies.Booma, enemies.Gobooma, enemies.Gigobooma]) {
      for (let i = 0; i < 2000; i++) {
        const d = rollEnemyDrop(arch, rng);
        if (d?.kind === 'item') expect(d.item.id.startsWith('disk_')).toBe(false);
      }
    }
    for (const lv of [1, 20, 60]) {
      for (const it of shopStock('item', lv, rng, { derolle: true, warden: true })) expect(it.id.startsWith('disk_')).toBe(false);
    }
  });

  it('Cave enemies drop tiers 2-5 and never a unique', () => {
    const rng = mulberry32(11);
    const tiers = new Set<number>();
    const rares = new Set<string>();
    for (const arch of Object.values(enemies).filter((a) => a.dropTier >= 4 && a.dropTier <= 5)) {
      for (let i = 0; i < 3000; i++) {
        const d = rollEnemyDrop(arch, rng);
        if (d?.kind !== 'item') continue;
        const def = getDef(d.item.id);
        if (def.rare) rares.add(def.id);
        else if (def.type === 'weapon' || def.type === 'armor') tiers.add(def.tier);
      }
      // Cave elites never reach tier 6 either.
      for (let i = 0; i < 500; i++) {
        const d = rollEliteBonus(arch, rng);
        if (d.kind !== 'item') continue;
        const def = getDef(d.item.id);
        if (!def.rare && (def.type === 'weapon' || def.type === 'armor')) expect(def.tier).toBeLessThanOrEqual(5);
      }
    }
    expect([...tiers].sort()).toEqual([2, 3, 4, 5]);
    expect(rares.size).toBe(0);
  });

  it('Mines enemies drop tiers 4-6, and injectors stop at tier 5', () => {
    const rng = mulberry32(12);
    const tiers = new Set<number>();
    for (const arch of Object.values(enemies).filter((a) => a.dropTier === 6)) {
      for (let i = 0; i < 3000; i++) {
        const d = i % 2 ? rollEnemyDrop(arch, rng) : rollEliteBonus(arch, rng);
        if (d?.kind !== 'item') continue;
        const def = getDef(d.item.id);
        if (def.type === 'injector') expect(def.tier).toBeLessThanOrEqual(5);
        if (!def.rare && (def.type === 'weapon' || def.type === 'armor')) tiers.add(def.tier);
      }
    }
    expect([...tiers].sort()).toEqual([4, 5, 6]);
  });

  it('the Warden drops tier 5-6 gear', () => {
    const rng = mulberry32(13);
    for (let i = 0; i < 400; i++) {
      for (const d of rollWardenDrops(rng)) {
        if (d.kind !== 'item') continue;
        const def = getDef(d.item.id);
        expect(def.rare).toBeFalsy();
        if (def.type === 'weapon' || def.type === 'armor') expect(def.tier).toBeGreaterThanOrEqual(5);
      }
    }
  });

  it('shops stock tier 6 only after the Warden, from Lv 32', () => {
    expect(shopTier(40, { derolle: true })).toBe(5);
    expect(shopTier(31, { derolle: true, warden: true })).toBe(5);
    expect(shopTier(32, { derolle: true, warden: true })).toBe(6);
    const rng = mulberry32(14);
    for (const kind of ['weapon', 'armor', 'item'] as const) {
      for (const item of shopStock(kind, 35, rng, { derolle: true, warden: true })) expect(() => getDef(item.id)).not.toThrow();
    }
  });

  it('Ruins enemies drop tiers 5-7, and Dark Falz tier 6-7 gear', () => {
    const rng = mulberry32(15);
    const tiers = new Set<number>();
    for (const arch of Object.values(enemies).filter((a) => a.dropTier === 7)) {
      for (let i = 0; i < 2000; i++) {
        const d = i % 2 ? rollEnemyDrop(arch, rng) : rollEliteBonus(arch, rng);
        if (d?.kind !== 'item') continue;
        const def = getDef(d.item.id);
        if (def.type === 'injector') expect(def.tier).toBeLessThanOrEqual(5);
        if (!def.rare && (def.type === 'weapon' || def.type === 'armor')) tiers.add(def.tier);
      }
    }
    expect([...tiers].sort()).toEqual([5, 6, 7]);
    for (let i = 0; i < 400; i++) {
      for (const d of rollFalzDrops(rng)) {
        if (d.kind !== 'item') continue;
        const def = getDef(d.item.id);
        expect(def.rare).toBeFalsy();
        if (def.type === 'weapon' || def.type === 'armor') expect(def.tier).toBeGreaterThanOrEqual(6);
      }
    }
  });

  it('only ever produces valid items', () => {
    const rng = mulberry32(42);
    for (let i = 0; i < 3000; i++) {
      const d = rollDrop(2, rng);
      if (d.kind === 'item') expect(itemDefs[d.item.id]).toBeDefined();
      else if (d.kind === 'meseta') expect(d.amount).toBeGreaterThan(0);
    }
    for (const arch of Object.values(enemies)) {
      for (let i = 0; i < 200; i++) {
        const d = rollEnemyDrop(arch, rng);
        if (d?.kind === 'item') expect(itemDefs[d.item.id]).toBeDefined();
      }
    }
    expect(rollDragonDrops(rng).length).toBeGreaterThan(3);
  });

  it('weapon shop stocks rods and wands, white or blue only', () => {
    const rng = mulberry32(7);
    const kinds = new Set<string>();
    for (let i = 0; i < 4; i++) {
      for (const s of shopStock('weapon', 1, rng)) kinds.add((getDef(s.id) as WeaponItemDef).kind);
    }
    expect([...kinds].sort()).toEqual(['rod', 'wand']);
    for (const it of [...shopStock('weapon', 1, rng), ...shopStock('armor', 30, rng)]) expect(['normal', 'magic']).toContain(rarityOf(it));
  });

  it('drops only rods and wands, Psy armour, and injectors leaning Fluid', () => {
    const rng = mulberry32(21);
    const kinds = new Set<string>();
    for (let i = 0; i < 1500; i++) {
      const tier = 1 + (i % 15);
      const def = getDef(rollWeapon(tier, rng).id);
      if (def.type === 'weapon') kinds.add(def.kind);
      expect(rollArmor(tier, rng).id).toMatch(/^(frame|barrier)_psy_\d+$/);
    }
    expect([...kinds].sort()).toEqual(['rod', 'wand']);
    let mate = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) if (rollInjector(3, rng).id.startsWith('mate_')) mate++;
    // 35% Mate: casting runs on TP.
    expect(mate / n).toBeGreaterThan(0.3);
    expect(mate / n).toBeLessThan(0.4);
  });
});

describe('affixes', () => {
  const prefixes = (it: ReturnType<typeof rollWeapon>) => (it.affixes ?? []).filter((r) => ITEM_AFFIXES[r.id].kind === 'prefix').length;
  const suffixes = (it: ReturnType<typeof rollWeapon>) => (it.affixes ?? []).filter((r) => ITEM_AFFIXES[r.id].kind === 'suffix').length;

  it('roll none on normal items, one prefix and / or one suffix on magic ones', () => {
    const rng = mulberry32(31);
    for (let i = 0; i < 500; i++) {
      const n = rollWeapon(3, rng, 'normal');
      expect(n.affixes).toBeUndefined();
      const m = rollArmor(3, rng, 'magic');
      expect(prefixes(m) + suffixes(m)).toBeGreaterThanOrEqual(1);
      expect(prefixes(m)).toBeLessThanOrEqual(1);
      expect(suffixes(m)).toBeLessThanOrEqual(1);
    }
  });

  it('give rares 3-4 affixes on Normal tiers, up to 5 on Nightmare and 4-6 on Hell, at most 3 of each kind', () => {
    const rng = mulberry32(32);
    for (const [tier, lo, hi] of [[5, 3, 4], [10, 3, 5], [14, 4, 6]]) {
      let most = 0;
      for (let i = 0; i < 600; i++) {
        const it = i % 2 ? rollWeapon(tier, rng, 'rare') : rollArmor(tier, rng, 'rare');
        const n = prefixes(it) + suffixes(it);
        expect(n).toBeGreaterThanOrEqual(lo);
        expect(n).toBeLessThanOrEqual(hi);
        expect(prefixes(it)).toBeLessThanOrEqual(3);
        expect(suffixes(it)).toBeLessThanOrEqual(3);
        const ids = (it.affixes ?? []).map((r) => r.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(it.name).toBeTruthy();
        most = Math.max(most, n);
      }
      expect(most).toBe(hi);
    }
  });

  it('only roll affixes that fit the item, and never a retired one', () => {
    const rng = mulberry32(33);
    for (let i = 0; i < 1500; i++) {
      const tier = 1 + (i % 15);
      const it = i % 2 ? rollWeapon(tier, rng, 'rare') : rollArmor(tier, rng, 'rare');
      const def = getDef(it.id);
      const slot = def.type === 'armor' ? def.slot : 'weapon';
      for (const r of [...(it.affixes ?? []), ...(it.dormant ?? [])]) {
        expect(affixFits(ITEM_AFFIXES[r.id], slot, tier), `${r.id} on ${it.id}`).toBe(true);
        expect(RETIRED_AFFIXES).not.toContain(r.id);
      }
    }
  });

  it('adds flat affixes and downside penalties to the stats', () => {
    const ch = Character.create('T');
    const base = ch.stats();
    ch.equippedItem('frame')!.affixes = [{ id: 'hp', v: 40 }, { id: 'overcharged', v: 60, p: 36 }];
    const s = ch.stats();
    expect(s.hp).toBe(base.hp + 40 - 36);
    expect(s.tp).toBe(base.tp + 60);
    expect(ch.maxHp).toBe(s.hp);
  });

  it('units carry one affix, are learned on pickup, and every one in the Mag is active (four at most)', () => {
    const rng = mulberry32(34);
    for (let i = 0; i < 200; i++) expect(rollUnit(6, rng).affixes).toHaveLength(1);
    const ch = Character.create('T');
    const frame = ch.equippedItem('frame')!;
    const a = makeItem('unit_3', { affixes: [{ id: 'hp', v: 20 }] });
    const b = makeItem('unit_3', { affixes: [{ id: 'strike', v: 3 }] });
    const bagBefore = ch.data.inventory.length;
    expect(ch.take(a)).toEqual({ to: 'learned', before: null });
    expect(ch.take(b)).toEqual({ to: 'learned', before: null });
    // Learned units need no bag slot.
    expect(ch.data.inventory).toHaveLength(bagBefore);
    expect(ch.insertUnit('hp')).toBeNull();
    expect(ch.insertUnit('strike')).toBeNull();
    expect(ch.insertUnit('lck')).not.toBeNull();
    // Both work, whatever frame is worn (or none).
    expect(ch.activeUnits()).toEqual([a, b]);
    expect(ch.wornAffixes()).toContainEqual(b.affixes![0]);
    ch.unequip(frame.uid);
    expect(ch.activeUnits()).toEqual([a, b]);
    // The Mag holds four.
    for (const id of ['lck', 'mstFlat', 'critDmg'] as const) ch.take(makeItem('unit_3', { affixes: [{ id, v: 5 }] }));
    expect(ch.insertUnit('lck')).toBeNull();
    expect(ch.insertUnit('mstFlat')).toBeNull();
    expect(ch.insertUnit('critDmg')).not.toBeNull();
    expect(ch.activeUnits()).toHaveLength(4);
    // Taking one out of the Mag keeps it learned.
    expect(ch.removeUnit(0)).toBeNull();
    expect(ch.data.magUnits).toEqual(['strike', 'lck', 'mstFlat']);
    expect(ch.learnedUnit('hp')).toBe(a);
  });

  it('keeps the best roll of each unit: a better one replaces it, a worse one is junk for the bag', () => {
    const ch = Character.create('T');
    const weak = makeItem('unit_3', { affixes: [{ id: 'hp', v: 20 }] });
    const strong = makeItem('unit_6', { affixes: [{ id: 'hp', v: 45 }] });
    const worse = makeItem('unit_4', { affixes: [{ id: 'hp', v: 30 }] });
    expect(dropVerdict(ch, weak).look).toBe('upgrade');
    ch.take(weak);
    ch.insertUnit('hp');
    expect(dropVerdict(ch, weak).look).toBe('junk');
    expect(dropVerdict(ch, strong).look).toBe('upgrade');
    expect(ch.take(strong)).toEqual({ to: 'learned', before: { id: 'hp', v: 20 } });
    expect(ch.data.units).toEqual([strong]);
    // The slotted kind stays slotted, now with the better roll.
    expect(ch.activeUnits()).toEqual([strong]);
    expect(ch.unitStatus(worse)).toBe('known');
    expect(dropVerdict(ch, worse).look).toBe('junk');
    expect(ch.take(worse)).toEqual({ to: 'bag' });
    expect(ch.find(worse.uid)).toBeDefined();
    // Same value: the smaller penalty wins.
    const oc1 = makeItem('unit_5', { affixes: [{ id: 'overcharged', v: 60, p: 40 }] });
    const oc2 = makeItem('unit_5', { affixes: [{ id: 'overcharged', v: 60, p: 30 }] });
    ch.take(oc1);
    expect(ch.unitStatus(oc2)).toBe('better');
  });

  it('old saves: units in the Mag and the bag are learned (best of each kind), the Mag keeps its slots', () => {
    const ch = Character.create('T');
    const inMag = makeItem('unit_3', { affixes: [{ id: 'hp', v: 20 }] });
    const inMag2 = makeItem('unit_3', { affixes: [{ id: 'hp', v: 15 }] });
    const better = makeItem('unit_6', { affixes: [{ id: 'hp', v: 45 }] });
    const other = makeItem('unit_3', { affixes: [{ id: 'lck', v: 8 }] });
    const data = JSON.parse(JSON.stringify(ch.data));
    delete data.magUnits;
    data.units = [inMag, inMag2];
    data.inventory.push(better, other, makeItem('unit_2', { affixes: [{ id: 'lck', v: 4 }] }));
    const loaded = new Character(data);
    expect(loaded.data.magUnits).toEqual(['hp']);
    expect(loaded.learnedUnit('hp')!.uid).toBe(better.uid);
    expect(loaded.learnedUnit('lck')!.uid).toBe(other.uid);
    // Learned ones left the bag; the weaker LCK unit stays as junk.
    const bagUnits = loaded.data.inventory.filter((it) => it.id.startsWith('unit_'));
    expect(bagUnits.map((u) => u.affixes![0].v)).toEqual([4]);
  });

  it('moves units that sat in a frame (old saves) into the Mag', () => {
    const ch = Character.create('T');
    const unit = makeItem('unit_3', { affixes: [{ id: 'hp', v: 20 }] });
    ch.equippedItem('frame')!.units = [unit];
    const data = JSON.parse(JSON.stringify(ch.data));
    delete data.units;
    delete data.magUnits;
    const loaded = new Character(data);
    expect(loaded.data.units.map((u) => u.uid)).toEqual([unit.uid]);
    expect(loaded.data.magUnits).toEqual(['hp']);
    expect(loaded.equippedItem('frame')!.units).toBeUndefined();
  });

  it('caps status resistance at 75%', () => {
    const ch = Character.create('T');
    ch.equippedItem('frame')!.affixes = [{ id: 'resPoison', v: 40 }];
    ch.data.units = [{ uid: 'u', id: 'unit_5', affixes: [{ id: 'resPoison', v: 40 }] }];
    ch.data.magUnits = ['resPoison'];
    expect(ch.resist('resPoison')).toBe(75);
  });
});

/** Flood fill floor tiles from a world point; returns reached room ids. */
function reachableRooms(level: Level, x: number, z: number): Set<string> {
  const seen = new Set<number>();
  const stack = [[Math.floor(x / TILE), Math.floor(z / TILE)]];
  const rooms = new Set<string>();
  while (stack.length) {
    const [tx, tz] = stack.pop()!;
    const key = tz * level.width + tx;
    if (seen.has(key) || level.isSolidTile(tx, tz)) continue;
    seen.add(key);
    const r = level.roomAt((tx + 0.5) * TILE, (tz + 0.5) * TILE);
    if (r) rooms.add(r.def.id);
    stack.push([tx + 1, tz], [tx - 1, tz], [tx, tz + 1], [tx, tz - 1]);
  }
  return rooms;
}

describe('Level', () => {
  it('builds every area', () => {
    for (const def of Object.values(areas)) expect(() => new Level(def)).not.toThrow();
  });

  it('Forest 1: locked gate blocks progress until the switch is used', () => {
    const level = new Level(areas.forest1);
    const start = level.features.find((f) => f.def.kind === 'start')!;
    const before = reachableRooms(level, start.x, start.z);
    expect(before.has('r3')).toBe(true); // switch room reachable
    expect(before.has('r4')).toBe(false); // locked behind L1
    expect(before.has('r8')).toBe(false);

    const sw = level.features.find((f) => f.def.kind === 'switch')!;
    level.unlock(sw.def.lock!);
    const after = reachableRooms(level, start.x, start.z);
    for (const r of areas.forest1.rooms) expect(after.has(r.id)).toBe(true);
  });

  it('closing a room seals it', () => {
    const level = new Level(areas.forest1);
    level.setRoomGates('r1', true);
    const r1 = level.rooms.find((r) => r.def.id === 'r1')!;
    const cx = (r1.rect.minX + r1.rect.maxX) / 2;
    const cz = (r1.rect.minZ + r1.rect.maxZ) / 2;
    expect([...reachableRooms(level, cx, cz)]).toEqual(['r1']);
  });

  it('scenery does not intersect: clutter, trees, gates and features keep their distance', () => {
    const level = new Level(areas.forest1);
    const clutter = level.solidClutter;
    expect(clutter.length).toBeGreaterThan(10);
    for (let i = 0; i < clutter.length; i++) {
      for (let k = i + 1; k < clutter.length; k++) {
        const a = clutter[i];
        const b = clutter[k];
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(a.r + b.r);
      }
    }
    const gates = level.gates.map((g) => [((g.tiles[0][0] + g.tiles[1][0]) / 2 + 0.5) * TILE, ((g.tiles[0][1] + g.tiles[1][1]) / 2 + 0.5) * TILE]);
    // Every collider (trunks, rocks, stumps) stays clear of doorways and features.
    for (const t of level.trees) {
      for (const [gx, gz] of gates) expect(Math.hypot(t.x - gx, t.z - gz)).toBeGreaterThan(3);
      for (const f of level.features) expect(Math.hypot(t.x - f.x, t.z - f.z)).toBeGreaterThan(2);
      for (const b of level.boxSpots) expect(Math.hypot(t.x - b.x, t.z - b.z)).toBeGreaterThan(t.r + 0.5);
      expect(level.isSolidAt(t.x, t.z)).toBe(false); // inside the walkable area, not embedded in a wall
    }
  });

  it('features and box spots are on open floor', () => {
    const level = new Level(areas.forest1);
    for (const f of level.features) expect(level.isSolidAt(f.x, f.z)).toBe(false);
    for (const b of level.boxSpots) expect(level.isSolidAt(b.x, b.z)).toBe(false);
  });
});

describe('Item names', () => {
  it('names magic items by their prefix and suffix', () => {
    expect(itemName(makeItem('rod_3', { rarity: 'magic', affixes: [{ id: 'techPct', v: 6 }, { id: 'tpRefill', v: 10 }] }))).toBe('Arcane Pillar of Flow');
    expect(itemName(makeItem('rod_3', { rarity: 'magic', affixes: [{ id: 'mstFlat', v: 5 }] }))).toBe('Mystic Pillar');
    expect(itemName(makeItem('frame_psy_2', { rarity: 'magic', affixes: [{ id: 'resBurn', v: 5 }] }))).toBe('Psy Armor of Cooling');
    expect(itemName(makeItem('rod_8'))).toBe('Zenith Rod');
  });

  it('names rares by their rolled name and uniques by their own', () => {
    expect(itemName(makeItem('rod_3', { rarity: 'rare', name: 'Doom Edge', affixes: [{ id: 'mstFlat', v: 5 }] }))).toBe('Doom Edge');
    expect(itemName(makeItem('unique_darkFlow_7'))).toBe('Dark Flow');
    expect(rarityOf(makeItem('unique_darkFlow_7'))).toBe('unique');
  });

  it('names injector mods and stacks as before', () => {
    expect(itemName(makeItem('fluid_4', { mod: 'steady' }))).toBe('Steady Star Fluid Injector');
    expect(itemName(makeItem('photon_drop', { qty: 3 }))).toBe('Photon Drop x3');
  });
});

describe('Equipment comparison', () => {
  it('previews a stronger weapon as a gain without changing the character', () => {
    const ch = Character.create('T');
    const before = JSON.stringify(ch.data);
    const better = makeItem('wand_2', { rarity: 'magic', affixes: [{ id: 'techPct', v: 10 }] });
    const c = compareEquip(ch, better)!;
    expect(c.slot).toBe('weapon');
    expect(c.current?.id).toBe('wand_1');
    expect(c.rows.find((r) => r.label === 'Tech damage')!.delta).toBeGreaterThan(0);
    expect(c.rows.some((r) => r.label === 'Weapon damage')).toBe(false);
    expect(c.rows[0]).toMatchObject({ label: 'Damage/s', key: true });
    expect(c.rows[0].delta).toBeGreaterThan(0);
    expect(gearVerdict(ch, better)).toBe(1);
    expect(JSON.stringify(ch.data)).toBe(before);
  });

  it('compares armour by damage taken and line bonuses, and the equipped item is neutral', () => {
    const ch = Character.create('T');
    const frame = makeItem('frame_psy_3');
    const c = compareEquip(ch, frame)!;
    expect(c.slot).toBe('frame');
    expect(c.rows.map((r) => r.label)).toEqual(['Damage/s', 'Rating', 'Strike damage taken', 'Area damage taken', 'Tech damage', 'TP']);
    expect(c.rows[0].delta).toBeGreaterThan(0);
    expect(c.rows[1].delta).toBeGreaterThan(0);
    expect(gearVerdict(ch, ch.equippedItem('frame')!)).toBe(0);
    expect(compareEquip(ch, makeItem('photon_drop'))).toBeNull();
    expect(compareEquip(ch, makeItem('mate_2'))).toBeNull();
  });
});

describe('Drop verdicts (ground look and pickup note)', () => {
  const wielding = (id: string, extra = {}) => {
    const ch = Character.create('T');
    ch.addXp(100000);
    const w = makeItem(id, extra);
    ch.addItem(w);
    expect(ch.equip(w.uid).ok).toBe(true);
    return ch;
  };

  it('flags an equippable upgrade, and junks downgrades and copies', () => {
    const ch = wielding('wand_1');
    const up = dropVerdict(ch, makeItem('wand_2'));
    expect(up.look).toBe('upgrade');
    expect(up.mark).toBe('up');
    expect(up.note).toMatch(/^Damage\/s \+\d+%/);
    const strong = wielding('wand_2');
    const down = dropVerdict(strong, makeItem('wand_1'));
    expect(down).toMatchObject({ look: 'junk', mark: 'down' });
    expect(down.note).toMatch(/^Downgrade: Damage\/s −\d+%/);
    expect(dropVerdict(ch, makeItem('wand_1'))).toEqual({ look: 'junk', mark: 'same', note: 'Same as equipped' });
  });

  it('never fades a unique, even a weaker one', () => {
    expect(dropVerdict(wielding('rod_5'), makeItem('unique_darkFlow_3')).look).not.toBe('junk');
  });

  it('never junks an upgrade for an unmet requirement', () => {
    const v = dropVerdict(Character.create('T'), makeItem('rod_5'));
    expect(v.look).toBe('plain');
    expect(v.mark).toBe('no');
    expect(v.note).toMatch(/^Needs Lv 18 \(you are Lv 1\) · Damage\/s \+/);
    expect(dropVerdict(Character.create('T'), makeItem('mate_5'))).toMatchObject({ look: 'plain', mark: 'no' });
    expect(dropVerdict(Character.create('T'), makeItem('photon_drop'))).toEqual({ look: 'plain', mark: '', note: '' });
  });
});

describe('Armor lines', () => {
  it('locks the Psy line by level only, like weapons; the standard pieces need nothing', () => {
    const ch = Character.create('T');
    expect(ch.canEquip(makeItem('frame_1')).ok).toBe(true);
    expect(ch.canEquip(makeItem('barrier_1')).ok).toBe(true);
    expect(ch.canEquip(makeItem('barrier_6')).ok).toBe(true);
    expect(ch.canEquip(makeItem('frame_psy_1')).ok).toBe(true);
    expect(ch.canEquip(makeItem('frame_psy_2')).ok).toBe(false); // Lv 3
  });

  it("opens each tier of the line at the tier's level (about where it starts dropping)", () => {
    for (const slot of ['frame', 'barrier']) {
      for (const [tier, level] of [[2, 3], [3, 7], [4, 12]]) {
        const ch = Character.create('T');
        while (ch.level < level - 1) ch.addXp(xpToNext(ch.level));
        expect(ch.canEquip(makeItem(`${slot}_psy_${tier}`)).ok).toBe(false);
        ch.addXp(xpToNext(ch.level));
        expect(ch.canEquip(makeItem(`${slot}_psy_${tier}`)).ok).toBe(true);
      }
    }
  });

  it('adds line bonuses to total stats (and TP to max TP), not to the character own', () => {
    const ch = Character.create('T');
    const psy = makeItem('frame_psy_1');
    ch.addItem(psy);
    const before = ch.stats();
    expect(ch.equip(psy.uid).ok).toBe(true);
    // Fully ground (x1.25 at tier 1): tech damage 6 -> 8, TP 5 -> 6.
    expect(ch.stats().mst).toBe(before.mst + 8);
    expect(ch.maxTp).toBe(before.tp + 6);
    expect(ch.ownStats().mst).toBe(ch.baseStats().mst);
  });

  it('judges frames by damage first, the overall rating only between frames that deal the same', () => {
    const ch = Character.create('T');
    ch.addXp(100000);
    const worn = makeItem('frame_psy_4', { rarity: 'magic', affixes: [{ id: 'hp', v: 110, t: 5 }] });
    ch.addItem(worn);
    ch.equip(worn.uid);
    // More tech damage wins, though the HP on the frame worn rates it higher.
    const next = makeItem('frame_psy_5');
    expect(compareEquip(ch, next)!.rows.find((r) => r.tie)!.delta).toBeLessThan(0);
    expect(gearVerdict(ch, next)).toBe(1);
    // Same damage: the HP decides.
    expect(gearVerdict(ch, makeItem('frame_psy_4', { rarity: 'magic', affixes: [{ id: 'hp', v: 160, t: 6 }] }))).toBe(1);
    expect(gearVerdict(ch, makeItem('frame_psy_4'))).toBe(-1);
    expect(gearVerdict(ch, makeItem('frame_psy_3'))).toBe(-1);
  });

  it('stocks the standard pieces and the Psy line in the armor shop', () => {
    const stock = shopStock('armor', 12, mulberry32(1)).map((i) => i.id);
    for (const id of ['frame_1', 'barrier_1', 'frame_psy_2', 'barrier_psy_2', 'frame_psy_3', 'barrier_psy_3']) expect(stock).toContain(id);
    for (const id of stock) expect(id).toMatch(/^(frame|barrier)_(psy_)?\d+$/);
  });
});

describe('Weapon kinds (two since 2026-10-21)', () => {
  it('has the Rod (more technique boost) and the Wand (more TP back); bare hands fire a weak bolt', () => {
    expect(Object.keys(weaponKinds).sort()).toEqual(['rod', 'wand']);
    expect(weaponKinds.rod.techBoost).toBeGreaterThan(weaponKinds.wand.techBoost);
    expect(weaponKinds.wand.tpRefill).toBeGreaterThan(weaponKinds.rod.tpRefill);
    const ch = Character.create('T');
    expect(ch.weaponDef().kind).toBe('wand');
    expect(ch.weaponKind()).toBe(weaponKinds.wand);
    delete ch.data.equipped.weapon;
    expect(ch.weaponKind()).toBe(BARE_KIND);
    expect(BARE_KIND.boltPower).toBeLessThan(weaponKinds.wand.boltPower);
    expect(ch.weaponEdge()).toBe(0);
    expect(ch.stats().mst).toBe(ch.ownStats().mst);
  });

  it('turns saved blades and the Cane into rods, guns into wands, Guard and Combat armour into Psy, of the same tier', () => {
    const data = Character.create('T').data;
    const old: ItemInstance[] = [
      { uid: 'p', id: 'partisan_7', rarity: 'rare', name: 'Storm Reaver', special: 'heat', affixes: [{ id: 'atpPct' as never, v: 20 }, { id: 'lck', v: 30 }] },
      { uid: 'sa', id: 'saber_2' },
      { uid: 'sw', id: 'sword_4' },
      { uid: 'd', id: 'dagger_5' },
      { uid: 'c', id: 'cane_1' },
      { uid: 'm', id: 'mechgun_12', rarity: 'magic', affixes: [{ id: 'lck', v: 30 }] },
      { uid: 'h', id: 'handgun_6' },
      { uid: 'r', id: 'rifle_8' },
      { uid: 'sh', id: 'shot_9' },
      { uid: 'sl', id: 'slicer_3' },
      { uid: 'fg', id: 'frame_guard_3' },
      { uid: 'bc', id: 'barrier_combat_5' },
    ];
    data.inventory.push(...old);
    data.equipped.weapon = 'p';
    const ch = new Character(data);
    const ids = Object.fromEntries(ch.data.inventory.map((i) => [i.uid, i.id]));
    expect(ids).toMatchObject({
      p: 'rod_7', sa: 'rod_2', sw: 'rod_4', d: 'rod_5', c: 'rod_1',
      m: 'wand_12', h: 'wand_6', r: 'wand_8', sh: 'wand_9', sl: 'wand_3',
      fg: 'frame_psy_3', bc: 'barrier_psy_5',
    });
    // Weapon damage % and the special went with the classes; the rest is kept.
    const p = ch.find('p')!;
    expect(p.affixes).toEqual([{ id: 'lck', v: 30 }]);
    expect(p.special).toBeUndefined();
    expect(itemName(p)).toBe('Storm Reaver');
    expect(ch.find('m')!.affixes).toEqual([{ id: 'lck', v: 30 }]);
    expect(ch.weaponDef().kind).toBe('rod');
  });
});

describe('Old saves (version 5, with classes)', () => {
  it('load a Hunter as the caster: her saber a rod, Guard armour Psy, POW / DEX points and her skills refunded', () => {
    const fresh = atLevel(40).data;
    const v5 = {
      ...fresh,
      version: 5,
      cls: 'hunter',
      inventory: [
        {
          uid: 'hs', id: 'saber_11', rarity: 'rare', name: 'Doom Edge',
          affixes: [{ id: 'atpPct', v: 30, t: 6 }, { id: 'finisherPct', v: 20, t: 6 }, { id: 'haste', v: 3 }],
        },
        { uid: 'hf', id: 'frame_guard_11' },
        ...fresh.inventory.filter((i) => getDef(i.id).type === 'injector'),
      ],
      equipped: { weapon: 'hs', frame: 'hf', injector: fresh.equipped.injector },
      mag: { pow: 20, dex: 10, def: 5 },
      // Tempo and Resta are in the caster trees too: she still starts over.
      skills: { ranks: { risingEdge: 1, cyclone: 3, tempo: 3, resta: 1 } },
      arts: { bars: { saber: ['risingEdge', 'cyclone', null, null], none: ['resta', null, null, null] } },
    };
    expect(LOADABLE_VERSIONS).toContain(v5.version);
    const load = (d: unknown) => new Character(upgradeCrafting(readAffixData(JSON.parse(JSON.stringify(d)) as CharacterData)));
    const ch = load(v5);
    expect(ch.data.cls).toBeUndefined();
    expect(ch.data.version).toBe(SAVE_VERSION);
    expect(SAVE_VERSION).toBe(6);
    // The saber is a rod of its tier, still equipped, with only current affixes: Haste kept, the rest rolled back up to
    // a tier 11 rare's counts.
    const rod = ch.weaponInstance()!;
    expect(rod.uid).toBe('hs');
    expect(rod.id).toBe('rod_11');
    expect(ch.weaponDef().kind).toBe('rod');
    expect(itemName(rod)).toBe('Doom Edge');
    expect(rod.affixes).toContainEqual({ id: 'haste', v: 3 });
    expect(rod.affixes).toHaveLength(rareCount(tierIlvl(11)));
    expect(rod.dormant).toHaveLength(dormantCount(tierIlvl(11)));
    for (const r of [...rod.affixes!, ...rod.dormant!]) {
      expect(RETIRED_AFFIXES).not.toContain(r.id);
      expect(affixFits(ITEM_AFFIXES[r.id], 'weapon', 11), r.id).toBe(true);
    }
    expect(ch.equippedItem('frame')).toMatchObject({ uid: 'hf', id: 'frame_psy_11' });
    // POW and DEX points come back to spend; DEF stays.
    expect(ch.data.mag).toEqual({ mind: 0, def: 5 });
    expect(ch.magPoints).toBe(40 - 5);
    // Her skills and Art bars are gone: she knows Foie, like a new character, and every other point is back.
    expect(ch.data.skills.ranks).toEqual({ foie: 1 });
    expect(ch.skillPointsLeft).toBe(ch.skillPoints - 1);
    expect(ch.artBar().filter(Boolean)).toEqual(['foie']);
    // Loading it again changes nothing (the top-up is seeded by the uid).
    const again = load(ch.data);
    expect(again.weaponInstance()!.affixes).toEqual(rod.affixes);
    expect(again.weaponInstance()!.dormant).toEqual(rod.dormant);
    expect(again.data.skills.ranks).toEqual({ foie: 1 });
  });

  it('load a Force with her skills and Art bar kept', () => {
    const fresh = atLevel(40).data;
    const v5 = {
      ...fresh,
      version: 5,
      cls: 'force',
      skills: { ranks: { foie: 4, zonde: 2, tempo: 1 } },
      arts: { bars: { wand: ['zonde', 'foie', null, null], rod: ['foie', null, null, null] } },
    };
    const ch = new Character(upgradeCrafting(readAffixData(JSON.parse(JSON.stringify(v5)) as CharacterData)));
    expect(ch.data.cls).toBeUndefined();
    expect(ch.data.skills.ranks).toEqual({ foie: 4, zonde: 2, tempo: 1 });
    // The bar of the wand in hand.
    expect(ch.artBar()).toEqual(['zonde', 'foie', null, null]);
  });
});
