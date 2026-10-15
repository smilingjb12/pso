import { describe, expect, it } from 'vitest';
import { Character, compareEquip, dropVerdict, gearVerdict, grindBonus, itemName, makeItem, rarityOf, statDef } from './character';
import { enemies, techScaling } from './config';
import { areas } from './data/areas';
import { CLASS_IDS, MAX_LEVEL, xpToNext, type ClassId } from './data/stats';
import { getDef, grindCap, INVENTORY_SIZE, itemDefs, kindFamily, PHOTON_STACK, raceCap, weaponKinds, type ArmorItemDef } from './data/items';
import { ITEM_AFFIXES } from './data/itemAffixes';
import { buffPct, restaHeal } from './data/techniques';
import {
  LOOT_LEAN, rollArmor, rollDragonDrops, rollDrop, rollEliteBonus, rollEnemyDrop, rollFalzDrops, rollUnit, rollWardenDrops, rollWeapon, shopStock, shopTier, type LootBias,
} from './loot';
import { Level, mulberry32, TILE } from './world/Level';

const BIASES: LootBias[] = ['melee', 'ranged', 'caster'];

/** A character of `cls` at `level` (no Mag points spent). */
function atLevel(cls: ClassId, level: number): Character {
  const ch = Character.create('T', cls);
  ch.data.level = level;
  return ch;
}

describe('Character', () => {
  it('starts every class with a usable weapon equipped', () => {
    for (const cls of CLASS_IDS) {
      const ch = Character.create('T', cls);
      const w = ch.weaponInstance();
      expect(w).toBeDefined();
      expect(ch.canEquip(w!).ok).toBe(true);
      expect(ch.maxHp).toBeGreaterThan(0);
    }
  });

  it('levels up and carries over excess XP', () => {
    const ch = Character.create('T', 'hunter');
    const hp1 = ch.maxHp;
    const gained = ch.addXp(xpToNext(1) + xpToNext(2) + 5);
    expect(gained).toBe(2);
    expect(ch.level).toBe(3);
    expect(ch.data.xp).toBe(5);
    expect(ch.maxHp).toBeGreaterThan(hp1);
  });

  it('stacks bag items up to the cap, one stack per type', () => {
    const ch = Character.create('T', 'hunter');
    const start = ch.countOf('photon_drop');
    expect(ch.addItem(makeItem('photon_drop', { qty: PHOTON_STACK - start }))).toBe(true);
    expect(ch.countOf('photon_drop')).toBe(PHOTON_STACK);
    expect(ch.addItem(makeItem('photon_drop'))).toBe(false);
  });

  it('carries photons outside the bag: a full bag still takes them', () => {
    const ch = Character.create('T', 'hunter');
    while (!ch.full) ch.addItem(makeItem('saber_1'));
    expect(ch.addItem(makeItem('photon_sphere'))).toBe(true);
    expect(ch.full).toBe(true);
    expect(ch.bagCount).toBe(INVENTORY_SIZE);
  });

  it('drops items that no longer exist (the Telepipe) from old saves', () => {
    const data = Character.create('T', 'hunter').data;
    data.inventory.push({ uid: 'old', id: 'telepipe', qty: 3 });
    const ch = new Character(JSON.parse(JSON.stringify(data)));
    expect(ch.data.inventory.some((i) => i.id === 'telepipe')).toBe(false);
  });

  it('respects inventory capacity for non-stackables', () => {
    const ch = Character.create('T', 'hunter');
    while (ch.data.inventory.length < INVENTORY_SIZE) expect(ch.addItem(makeItem('saber_1'))).toBe(true);
    expect(ch.addItem(makeItem('saber_1'))).toBe(false);
  });

  it('gates gear by stat requirements only, whatever the class', () => {
    const ch = Character.create('T', 'force');
    expect(ch.canEquip(makeItem('sword_1')).ok).toBe(true);
    expect(ch.canEquip(makeItem('rifle_1')).ok).toBe(true);
    const hunter = Character.create('T', 'hunter');
    expect(hunter.canEquip(makeItem('saber_3')).ok).toBe(false); // ATP req
    hunter.addXp(100000);
    expect(hunter.canEquip(makeItem('saber_3')).ok).toBe(true);
  });

  it('names the character after the class', () => {
    expect(Character.create('T', 'force').title).toBe('Force');
    expect(Character.create('T', 'hunter').title).toBe('Hunter');
  });

  it('grows like the old classes', () => {
    // The old classes' growth per level (Lv 31 = 30 levels of it).
    // Damage taken grows a little a level (it replaced DFP growth on 2026-10-14): Hunter most, Force least.
    expect(atLevel('force', 31).baseStats()).toMatchObject({ hp: 70 + 7.5 * 30, tp: 80 + 6 * 30, atp: 25 + 2.2 * 30, strike: 3, area: 3, mst: 60 + 4 * 30, lck: 45 + 30 });
    expect(atLevel('hunter', 31).baseStats()).toMatchObject({ hp: 120 + 14 * 30, tp: 30 + 2 * 30, atp: 40 + 4 * 30, strike: 2 + 7, mst: 15 + 30, lck: 50 + 1.2 * 30 });
    expect(atLevel('ranger', 31).baseStats()).toMatchObject({ hp: 105 + 12 * 30, atp: 32 + 3.4 * 30, strike: 1 + 5, lck: 70 + 1.8 * 30 });
  });

  it('stops levelling at the cap', () => {
    const ch = Character.create('T', 'hunter');
    ch.addXp(1e12);
    expect(ch.level).toBe(MAX_LEVEL);
    expect(ch.maxed).toBe(true);
    expect(ch.addXp(1e6)).toBe(0);
    expect(ch.data.xp).toBe(0);
  });

  it('counts every weapon as fully ground (Edge at its cap): a share of its damage, and tech damage on caster weapons', () => {
    const hunter = Character.create('T', 'hunter');
    const saber = hunter.weaponDef();
    expect(hunter.weaponEdge()).toBe(grindCap(saber));
    expect(hunter.weaponAtp()[0]).toBe(saber.atpMin + grindBonus(saber, grindCap(saber)).atp);
    expect(hunter.stats().mst).toBe(hunter.ownStats().mst); // no tech damage on a saber, ground or not
    const force = Character.create('T', 'force');
    const wand = force.weaponDef(); // Wand: weapon damage 20-30, tech damage 6
    expect(wand.kind).toBe('wand');
    expect(force.stats().mst - force.ownStats().mst).toBe((wand.bonus?.mst ?? 0) + grindBonus(wand, grindCap(wand)).mst);
  });

  it('weapons and armour take 5-12 grind levels by tier, uniques 2 more', () => {
    expect([1, 2, 3, 5, 7, 9, 15].map((tier) => grindCap({ tier }))).toEqual([5, 5, 6, 7, 8, 9, 12]);
    expect(grindCap(itemDefs.unique_darkFlow_2 as { tier: number; rare?: boolean })).toBe(7);
  });

  it('counts frames and barriers as fully ground too: a share more of their stat bonuses (damage taken is the ground value)', () => {
    const f = makeItem('frame_guard_4');
    const base = itemDefs.frame_guard_4 as ArmorItemDef;
    const refined = statDef(f) as ArmorItemDef;
    expect(refined.bonus!.atp).toBe(Math.round(base.bonus!.atp! * (1 + 0.05 * grindCap(base))));
    expect(refined.dr).toBe(base.dr);
    expect(itemName(f)).not.toMatch(/\+\d+$/);
  });

  it('old saves drop their grind and Bane levels (everything counts as fully ground now)', () => {
    const d = Character.create('T', 'hunter').data;
    const w = makeItem('saber_5', { grind: 4, bane: { machine: 2, dark: 1 } });
    d.inventory.push(w, { uid: 'g', id: 'monogrinder', qty: 3 });
    const ch = new Character(d);
    const after = ch.find(w.uid)!;
    expect(after.grind).toBeUndefined();
    expect(after.bane).toBeUndefined();
    expect(itemName(after)).toBe('Gladius');
    expect(ch.countOf('monogrinder')).toBe(0);
  });

  it('old saves move their affix rolls to the 2026-10-14 units once', () => {
    const d = Character.create('T', 'hunter').data;
    delete d.affixUnits;
    const frame = makeItem('frame_guard_11', {
      rarity: 'rare',
      affixes: [{ id: 'dfp' as never, v: 32, t: 6 }, { id: 'areaDr', v: 10, t: 6 }, { id: 'reckless', v: 34, p: 30, t: 6 }],
      dormant: [{ id: 'lck', v: 30, t: 6 }],
    });
    const saber = makeItem('saber_11', { rarity: 'magic', affixes: [{ id: 'atpPct', v: 32, t: 6 }] });
    const unit = makeItem('unit_11', { rarity: 'magic', affixes: [{ id: 'dfp' as never, v: 45, t: 6 }] });
    d.inventory.push(frame, saber);
    d.units = [unit];
    d.magUnits = ['dfp' as never];
    const ch = new Character(d);
    expect(ch.find(frame.uid)!.affixes).toEqual([
      { id: 'strike', v: 5, t: 6 },
      { id: 'areaDr', v: 7, t: 6 },
      { id: 'reckless', v: 30, p: 5, t: 6 },
    ]);
    expect(ch.find(frame.uid)!.dormant).toEqual([{ id: 'lck', v: 30, t: 6 }]);
    expect(ch.find(saber.uid)!.affixes).toEqual([{ id: 'atpPct', v: 28, t: 6 }]);
    expect(ch.data.units[0].affixes).toEqual([{ id: 'strike', v: 8, t: 6 }]);
    expect(ch.data.magUnits).toEqual(['strike']);
    // Only once: a save already in the new units keeps its rolls.
    const again = new Character(JSON.parse(JSON.stringify(ch.data)));
    expect(again.find(frame.uid)!.affixes).toEqual(ch.find(frame.uid)!.affixes);
  });

  it('knows every technique from the start; tech damage alone decides how strong they are', () => {
    const h = atLevel('hunter', 42);
    const f = atLevel('force', 42);
    const fMst = f.stats().mst;
    const hMst = h.stats().mst;
    expect(fMst).toBeGreaterThan(3 * hMst);
    // Attack techs: a Force hits far harder (in proportion to tech damage), and gets more damage out of each TP.
    expect(f.techDamage('foie')).toBeGreaterThan(3 * h.techDamage('foie'));
    expect(f.techDamage('foie') / f.techCost('foie')).toBeGreaterThan(h.techDamage('foie') / h.techCost('foie'));
    // ...but each cast costs more TP.
    expect(f.techCost('foie')).toBeGreaterThan(h.techCost('foie'));
    // Resta: the MST build heals more at the same level, in HP and as a share of its (smaller) bar.
    expect(restaHeal(fMst)).toBeGreaterThan(restaHeal(hMst));
    expect(restaHeal(fMst) / f.maxHp).toBeGreaterThan((restaHeal(hMst) / h.maxHp) * 4);
    // Buffs scale with MST too, up to a cap.
    expect(buffPct('shifta', fMst)).toBeGreaterThan(4 * buffPct('shifta', hMst));
    expect(buffPct('shifta', 5000)).toBe(techScaling.buffCap);
    // More MST from gear raises both damage and cost.
    const before = [f.techDamage('zonde'), f.techCost('zonde')];
    const rod = makeItem('rod_4');
    f.addItem(rod);
    expect(f.equip(rod.uid).ok).toBe(true);
    expect(f.techDamage('zonde')).toBeGreaterThan(before[0]);
    expect(f.techCost('zonde')).toBeGreaterThanOrEqual(before[1]);
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
      for (const it of shopStock('item', lv, 'caster', rng, { derolle: true, warden: true })) expect(it.id.startsWith('disk_')).toBe(false);
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
      for (const d of rollWardenDrops(rng, BIASES[i % 3])) {
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
      for (const item of shopStock(kind, 35, 'melee', rng, { derolle: true, warden: true })) expect(() => getDef(item.id)).not.toThrow();
    }
  });

  it('Ruins enemies drop tiers 5-7, and Dark Falz tier 6-7 gear', () => {
    const rng = mulberry32(15);
    const tiers = new Set<number>();
    for (const arch of Object.values(enemies).filter((a) => a.dropTier === 7)) {
      expect(arch.race).toBe('dark');
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
      for (const d of rollFalzDrops(rng, BIASES[i % 3])) {
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
      const d = rollDrop(2, rng, BIASES[i % 3]);
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

  it("weapon shop stocks weapons of the class's family, white or blue only", () => {
    const rng = mulberry32(7);
    for (const bias of BIASES) {
      const stock = shopStock('weapon', 1, bias, rng);
      const own = stock.filter((s) => {
        const def = getDef(s.id);
        return def.type === 'weapon' && kindFamily(weaponKinds[def.kind]) === bias;
      });
      expect(own.length).toBeGreaterThan(0);
      for (const it of [...stock, ...shopStock('armor', 30, bias, rng)]) expect(['normal', 'magic']).toContain(rarityOf(it));
    }
  });

  it('leans weapon drops 80% toward the class family', () => {
    const rng = mulberry32(21);
    let own = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) {
      const def = getDef(rollWeapon(5, rng, 'ranged').id);
      if (def.type === 'weapon' && kindFamily(weaponKinds[def.kind]) === 'ranged') own++;
    }
    // 80% leaned, plus the ranged share of the unleaned fifth (5 of 12 kinds).
    expect(own / n).toBeGreaterThan(LOOT_LEAN);
    expect(own / n).toBeLessThan(0.95);
  });
});

describe('affixes', () => {
  const prefixes = (it: ReturnType<typeof rollWeapon>) => (it.affixes ?? []).filter((r) => ITEM_AFFIXES[r.id].kind === 'prefix').length + (it.special ? 1 : 0);
  const suffixes = (it: ReturnType<typeof rollWeapon>) => (it.affixes ?? []).filter((r) => ITEM_AFFIXES[r.id].kind === 'suffix').length;

  it('roll none on normal items, one prefix and / or one suffix on magic ones', () => {
    const rng = mulberry32(31);
    for (let i = 0; i < 500; i++) {
      const n = rollWeapon(3, rng, undefined, 'normal');
      expect(n.affixes).toBeUndefined();
      expect(n.special).toBeUndefined();
      const m = rollArmor(3, rng, undefined, 'magic');
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
        const it = i % 2 ? rollWeapon(tier, rng, undefined, 'rare') : rollArmor(tier, rng, undefined, 'rare');
        const n = prefixes(it) + suffixes(it);
        expect(n).toBeGreaterThanOrEqual(lo);
        expect(n).toBeLessThanOrEqual(hi);
        expect(prefixes(it)).toBeLessThanOrEqual(3);
        expect(suffixes(it)).toBeLessThanOrEqual(3);
        const ids = (it.affixes ?? []).map((r) => r.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids.filter((id) => id.startsWith('race')).length).toBeLessThanOrEqual(1);
        expect(it.name).toBeTruthy();
        most = Math.max(most, n);
      }
      expect(most).toBe(hi);
    }
  });

  it("only roll a weapon family's affixes on its weapons, and never unique-only ones", () => {
    const rng = mulberry32(33);
    for (let i = 0; i < 1500; i++) {
      const w = rollWeapon(9, rng, undefined, 'rare');
      const fam = kindFamily(weaponKinds[(getDef(w.id) as { kind: keyof typeof weaponKinds }).kind]);
      for (const r of w.affixes ?? []) {
        const def = ITEM_AFFIXES[r.id];
        expect(def.slots).toContain('weapon');
        if (def.family) expect(def.family).toBe(fam);
      }
    }
  });

  it('rolls race % in 5% steps up to the weapon tier cap', () => {
    const rng = mulberry32(3);
    for (const tier of [1, 4, 8]) {
      let top = 0;
      for (let i = 0; i < 3000; i++) {
        for (const r of rollWeapon(tier, rng, undefined, 'rare').affixes ?? []) {
          if (!r.id.startsWith('race')) continue;
          expect(r.v % 5).toBe(0);
          top = Math.max(top, r.v);
        }
      }
      expect(top).toBe(raceCap(tier));
    }
  });

  it('adds flat affixes and downside penalties to the stats', () => {
    const ch = Character.create('T', 'force');
    const base = ch.stats();
    ch.equippedItem('frame')!.affixes = [{ id: 'hp', v: 40 }, { id: 'overcharged', v: 60, p: 36 }];
    const s = ch.stats();
    expect(s.hp).toBe(base.hp + 40 - 36);
    expect(s.tp).toBe(base.tp + 60);
    expect(ch.maxHp).toBe(s.hp);
  });

  it('units carry one affix, are learned on pickup, and the frame\'s slots decide how many are active', () => {
    const rng = mulberry32(34);
    for (let i = 0; i < 200; i++) expect(rollUnit(6, rng).affixes).toHaveLength(1);
    const ch = Character.create('T', 'hunter');
    const frame = ch.equippedItem('frame')!;
    frame.slots = 1;
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
    // One slot: only the first unit counts; reordering swaps which one.
    expect(ch.activeUnits()).toEqual([a]);
    expect(ch.inactiveUnits).toBe(1);
    ch.moveUnit(0, 1);
    expect(ch.activeUnits()).toEqual([b]);
    expect(ch.wornAffixes()).toContainEqual(b.affixes![0]);
    // No frame (or one without slots): all inactive, but still slotted.
    ch.unequip(frame.uid);
    expect(ch.activeUnits()).toEqual([]);
    expect(ch.data.magUnits).toEqual(['strike', 'hp']);
    // Taking one out of the Mag keeps it learned.
    expect(ch.removeUnit(0)).toBeNull();
    expect(ch.data.magUnits).toEqual(['hp']);
    expect(ch.learnedUnit('strike')).toBe(b);
  });

  it('keeps the best roll of each unit: a better one replaces it, a worse one is junk for the bag', () => {
    const ch = Character.create('T', 'hunter');
    ch.equippedItem('frame')!.slots = 1;
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
    const ch = Character.create('T', 'hunter');
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
    const ch = Character.create('T', 'hunter');
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
    const ch = Character.create('T', 'hunter');
    ch.equippedItem('frame')!.affixes = [{ id: 'resPoison', v: 40 }];
    ch.equippedItem('frame')!.slots = 1;
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
  it('names magic items by their prefix (a special or an affix) and suffix', () => {
    expect(itemName(makeItem('saber_3', { rarity: 'magic', special: 'heat', affixes: [{ id: 'raceAbeast', v: 10 }] }))).toBe('Heat Buster of Beasts');
    expect(itemName(makeItem('saber_3', { rarity: 'magic', affixes: [{ id: 'atpFlat', v: 5 }] }))).toBe('Heavy Buster');
    expect(itemName(makeItem('frame_guard_2', { rarity: 'magic', affixes: [{ id: 'resBurn', v: 5 }] }))).toBe('Guard Armor of Cooling');
    expect(itemName(makeItem('saber_8'))).toBe('Nova Blade');
  });

  it('names rares by their rolled name and uniques by their own', () => {
    expect(itemName(makeItem('saber_3', { rarity: 'rare', name: 'Doom Edge', affixes: [{ id: 'atpFlat', v: 5 }] }))).toBe('Doom Edge');
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
    const ch = Character.create('T', 'hunter');
    const before = JSON.stringify(ch.data);
    const better = makeItem('saber_2', { grind: 3, affixes: [{ id: 'raceNative', v: 20 }] });
    const c = compareEquip(ch, better)!;
    expect(c.slot).toBe('weapon');
    expect(c.current?.id).toBe('saber_1');
    const atp = c.rows.find((r) => r.label === 'Weapon damage')!;
    expect(atp.delta).toBeGreaterThan(0);
    expect(c.rows[0]).toMatchObject({ label: 'Damage/s', key: true });
    expect(c.rows[0].delta).toBeGreaterThan(0);
    expect(gearVerdict(ch, better)).toBe(1);
    expect(JSON.stringify(ch.data)).toBe(before);
  });

  it('compares armour by damage taken and line bonuses, and the equipped item is neutral', () => {
    const ch = Character.create('T', 'ranger');
    const frame = makeItem('frame_combat_3');
    const c = compareEquip(ch, frame)!;
    expect(c.slot).toBe('frame');
    expect(c.rows.map((r) => r.label)).toEqual(['Damage/s', 'Rating', 'Strike damage taken', 'Area damage taken', 'Weapon damage', 'Crit chance']);
    expect(c.rows[0].delta).toBeGreaterThan(0);
    expect(c.rows[1].delta).toBeGreaterThan(0);
    expect(gearVerdict(ch, ch.equippedItem('frame')!)).toBe(0);
    expect(compareEquip(ch, makeItem('photon_drop'))).toBeNull();
    expect(compareEquip(ch, makeItem('mate_2'))).toBeNull();
  });
});

describe('Drop verdicts (ground look and pickup note)', () => {
  const wielding = (id: string, extra = {}) => {
    const ch = Character.create('T', 'hunter');
    ch.addXp(100000);
    const w = makeItem(id, extra);
    ch.addItem(w);
    expect(ch.equip(w.uid).ok).toBe(true);
    return ch;
  };

  it('flags an equippable upgrade, and junks downgrades and copies', () => {
    const ch = wielding('saber_1');
    const up = dropVerdict(ch, makeItem('saber_2'));
    expect(up.look).toBe('upgrade');
    expect(up.mark).toBe('up');
    expect(up.note).toMatch(/^Damage\/s \+\d+%/);
    const strong = wielding('saber_2');
    const down = dropVerdict(strong, makeItem('saber_1'));
    expect(down).toMatchObject({ look: 'junk', mark: 'down' });
    expect(down.note).toMatch(/^Downgrade: Damage\/s −\d+%/);
    expect(dropVerdict(ch, makeItem('saber_1'))).toEqual({ look: 'junk', mark: 'same', note: 'Same as equipped' });
  });

  it('never fades a unique, even a weaker one', () => {
    expect(dropVerdict(wielding('saber_5'), makeItem('unique_darkFlow_3')).look).not.toBe('junk');
  });

  it('never junks an upgrade for an unmet requirement', () => {
    const v = dropVerdict(Character.create('T', 'hunter'), makeItem('saber_5'));
    expect(v.look).toBe('plain');
    expect(v.mark).toBe('no');
    expect(v.note).toMatch(/^Needs Lv 18 \(you are Lv 1\) · Damage\/s \+/);
    expect(dropVerdict(Character.create('T', 'hunter'), makeItem('mate_5'))).toMatchObject({ look: 'plain', mark: 'no' });
    expect(dropVerdict(Character.create('T', 'hunter'), makeItem('photon_drop'))).toEqual({ look: 'plain', mark: '', note: '' });
  });
});

describe('Armor lines', () => {
  it('locks lines by level only, like weapons', () => {
    const force = Character.create('T', 'force');
    expect(force.canEquip(makeItem('frame_guard_1')).ok).toBe(true);
    expect(force.canEquip(makeItem('frame_psy_1')).ok).toBe(true);
    expect(force.canEquip(makeItem('frame_psy_2')).ok).toBe(false); // MST 60 < 80
    expect(Character.create('T', 'hunter').canEquip(makeItem('frame_psy_1')).ok).toBe(true);
    expect(Character.create('T', 'hunter').canEquip(makeItem('frame_psy_2')).ok).toBe(false);
  });

  it("opens every line's tier to every class at the tier's level (about where it starts dropping)", () => {
    for (const cls of CLASS_IDS) {
      for (const line of ['guard', 'combat', 'psy']) {
        for (const [tier, level] of [[2, 3], [3, 7], [4, 12]]) {
          const ch = Character.create('T', cls);
          while (ch.level < level - 1) ch.addXp(xpToNext(ch.level));
          expect(ch.canEquip(makeItem(`frame_${line}_${tier}`)).ok).toBe(false);
          ch.addXp(xpToNext(ch.level));
          expect(ch.canEquip(makeItem(`frame_${line}_${tier}`)).ok).toBe(true);
        }
      }
    }
  });

  it('adds line bonuses to total stats (and TP to max TP), not to the character own', () => {
    const ch = Character.create('T', 'force');
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
    const hunter = Character.create('T', 'hunter');
    hunter.addXp(100000);
    const guard = makeItem('frame_guard_4');
    hunter.addItem(guard);
    hunter.equip(guard.uid);
    // The Combat line's weapon damage and crit beat the Guard line's defence (2026-10-13, the user's call).
    expect(gearVerdict(hunter, makeItem('frame_combat_4'))).toBe(1);
    // Same damage: the HP decides.
    expect(gearVerdict(hunter, makeItem('frame_guard_4', { rarity: 'magic', affixes: [{ id: 'hp', v: 40, t: 4 }] }))).toBe(1);
    expect(gearVerdict(hunter, makeItem('frame_guard_3'))).toBe(-1);
  });

  it('stocks every line in the armor shop', () => {
    const stock = shopStock('armor', 12, 'melee', mulberry32(1)).map((i) => i.id);
    for (const line of ['guard', 'combat', 'psy']) expect(stock).toContain(`frame_${line}_3`);
  });
});

describe('Weapon kinds (eight since 2026-10-14)', () => {
  it('gives each class its own kinds: Hunter dagger / saber / sword, Ranger handgun / rifle / shot, Force wand / rod', () => {
    const byFamily = (f: string) => Object.values(weaponKinds).filter((k) => kindFamily(k) === f).map((k) => k.kind).sort();
    expect(byFamily('melee')).toEqual(['dagger', 'saber', 'sword']);
    expect(byFamily('ranged')).toEqual(['handgun', 'rifle', 'shot']);
    expect(byFamily('caster')).toEqual(['rod', 'wand']);
    expect(Character.create('T', 'force').weaponDef().kind).toBe('wand');
  });

  it('turns saved partisans, mechguns, slicers and canes into swords, handguns, rifles and rods, affixes kept', () => {
    const data = Character.create('T', 'hunter').data;
    const affixes = [{ id: 'atpPct' as const, v: 20 }, { id: 'lck' as const, v: 30 }];
    const old = [
      { uid: 'p', id: 'partisan_7', rarity: 'rare' as const, name: 'Storm Reaver', affixes },
      { uid: 'm', id: 'mechgun_12', rarity: 'magic' as const, affixes },
      { uid: 's', id: 'slicer_3', affixes: [] },
      { uid: 'c', id: 'cane_1' },
    ];
    data.inventory.push(...old);
    data.equipped.weapon = 'p';
    const ch = new Character(data);
    const ids = Object.fromEntries(ch.data.inventory.map((i) => [i.uid, i.id]));
    expect(ids).toMatchObject({ p: 'sword_7', m: 'handgun_12', s: 'rifle_3', c: 'rod_1' });
    expect(ch.data.inventory.find((i) => i.uid === 'p')!.affixes).toEqual(affixes);
    expect(ch.weaponDef().kind).toBe('sword');
  });
});
