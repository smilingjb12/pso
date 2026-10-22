import { describe, expect, it } from 'vitest';
import { Character, compareEquip, dropVerdict, makeItem, readAffixData, type CharacterData, type ItemInstance } from './character';
import { hasteCfg } from './config';
import { ITEM_AFFIXES, maxAffixTier, RETIRED_AFFIXES, tierIlvl, tierRange, type AffixRoll } from './data/itemAffixes';
import { rareCount, rollAffixValue, rollArmor, rollWeapon } from './loot';
import { upgradeSavedItems } from './savedItems';

/** A seeded generator, so every run rolls the same. */
function seq(seed = 1): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

const kind = (r: AffixRoll) => ITEM_AFFIXES[r.id].kind;
const isDown = (r: AffixRoll) => !!ITEM_AFFIXES[r.id].penalty;
const prefixes = (it: ItemInstance) => (it.affixes ?? []).filter((r) => kind(r) === 'prefix').length;

describe('affix counts (fixed by item level)', () => {
  it('rares have 4 / 5 / 6 by item level and nothing dormant; magic items 2', () => {
    expect([rareCount(tierIlvl(7)), rareCount(tierIlvl(8)), rareCount(tierIlvl(12)), rareCount(116)]).toEqual([4, 5, 6, 6]);
    const rng = seq(3);
    for (const [tier, ilvl] of [[5, undefined], [10, undefined], [15, undefined], [15, 116]] as const) {
      for (let i = 0; i < 80; i++) {
        for (const it of [rollWeapon(tier, rng, 'rare', ilvl), rollArmor(tier, rng, 'rare', ilvl)]) {
          expect(it.affixes?.length ?? 0).toBe(rareCount(it.ilvl ?? tierIlvl(tier)));
          expect(it.dormant).toBeUndefined();
          expect(prefixes(it)).toBeLessThanOrEqual(3);
          expect(it.affixes!.filter((r) => kind(r) === 'suffix').length).toBeLessThanOrEqual(3);
          const ids = it.affixes!.map((r) => r.id);
          expect(new Set(ids).size).toBe(ids.length);
        }
      }
      for (let i = 0; i < 40; i++) {
        const m = rollWeapon(tier, rng, 'magic', ilvl);
        expect(m.affixes?.length ?? 0).toBe(2);
        expect(prefixes(m)).toBe(1);
      }
    }
  });

  it('Hell and rift rares always carry a downside (nothing can swap it out); lower rares only now and then', () => {
    const rng = seq(9);
    for (let i = 0; i < 400; i++) {
      for (const it of [rollArmor(15, rng, 'rare', 112), rollWeapon(13, rng, 'rare'), rollArmor(13, rng, 'rare')]) {
        expect(it.affixes!.some(isDown)).toBe(true);
      }
    }
    let with8 = 0;
    for (let i = 0; i < 400; i++) if (rollArmor(9, rng, 'rare').affixes!.some(isDown)) with8++;
    expect(with8).toBeGreaterThan(0);
    expect(with8).toBeLessThan(400);
  });

  it('Hell weapon rares draw their 3 suffixes from 6, not always the same 3', () => {
    const rng = seq(4);
    const sets = new Set<string>();
    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) {
      const suf = rollWeapon(15, rng, 'rare').affixes!.filter((r) => kind(r) === 'suffix').map((r) => r.id);
      expect(suf).toHaveLength(3);
      sets.add([...suf].sort().join());
      suf.forEach((id) => seen.add(id));
    }
    expect([...seen].sort()).toEqual(['haste', 'injCharge', 'lck', 'tpCost', 'tpRefill', 'tpRegen']);
    expect(sets.size).toBeGreaterThan(4);
  });
});

describe('affix rolls (what drops is what you get)', () => {
  it("lands at the top of the item level's best tier, or of one or two tiers below (50 / 30 / 20)", () => {
    const rng = seq(17);
    const n = 3000;
    const seen = [0, 0, 0];
    for (let i = 0; i < n; i++) {
      const r = rollAffixValue(ITEM_AFFIXES.techPct, 15, rng, 116);
      const down = maxAffixTier(116) - r.t!;
      expect(down).toBeGreaterThanOrEqual(0);
      expect(down).toBeLessThanOrEqual(2);
      expect(r.v).toBe(tierRange(ITEM_AFFIXES.techPct.tiers, r.t!)[1]);
      seen[down]++;
    }
    expect(seen[0] / n).toBeCloseTo(0.5, 1);
    expect(seen[1] / n).toBeCloseTo(0.3, 1);
    expect(seen[2] / n).toBeCloseTo(0.2, 1);
  });

  it("gives a downside its tier's smallest penalty, never goes under tier 1, and steps Haste down from the cap", () => {
    const rng = seq(21);
    for (let i = 0; i < 200; i++) {
      const b = rollAffixValue(ITEM_AFFIXES.brittle, 15, rng, 110);
      expect(b.v).toBe(tierRange(ITEM_AFFIXES.brittle.tiers, b.t!)[1]);
      expect(b.p).toBe(tierRange(ITEM_AFFIXES.brittle.penalty!.tiers, b.t!)[0]);
      expect(rollAffixValue(ITEM_AFFIXES.techPct, 1, rng)).toEqual({ id: 'techPct', v: 6, t: 1 });
    }
    const haste = new Set<number>();
    for (let i = 0; i < 200; i++) haste.add(rollAffixValue(ITEM_AFFIXES.haste, 15, rng).v);
    const cap = hasteCfg.capByTier[15];
    expect([...haste].sort((a, b) => a - b)).toEqual([cap - 2, cap - 1, cap]);
  });
});

describe('old saves', () => {
  const save = (inventory: ItemInstance[]): CharacterData => ({ ...Character.create('T').data, inventory });

  it('pays photons (and the older Null Photons and Augment Cores) out in Meseta, and drops Potential', () => {
    const data = save([
      { uid: 'd', id: 'photon_drop', qty: 10 },
      { uid: 'c', id: 'photon_crystal', qty: 2 },
      { uid: 's', id: 'photon_sphere', qty: 1 },
      { uid: 'n', id: 'null_photon', qty: 1 },
      makeItem('rod_15', { pot: 4, potMax: 12 }),
    ]);
    const before = data.meseta;
    const ch = new Character(upgradeSavedItems(data));
    expect(ch.data.meseta - before).toBe(10 * 1200 + 2 * 20000 + 6000 + 6000);
    expect(ch.data.inventory.map((it) => it.id)).toEqual(['rod_15']);
    expect(ch.data.inventory[0].pot).toBeUndefined();
  });

  it('drops dormant affixes and tops gear up to the fixed counts once, keeping its rolls as they are', () => {
    const had: AffixRoll = { id: 'techPct', v: 26, t: 6 };
    const r = makeItem('frame_psy_15', { rarity: 'rare', name: 'X', affixes: [{ id: 'hp', v: 100, t: 5 }], dormant: [{ id: 'lck', v: 30, t: 6 }] });
    const m = makeItem('rod_15', { rarity: 'magic', affixes: [had] });
    const data = upgradeSavedItems(save([r, m]));
    const [r2, m2] = data.inventory;
    expect(r2.affixes![0]).toEqual({ id: 'hp', v: 100, t: 5 });
    expect(r2.affixes!.length).toBe(6);
    expect(r2.dormant).toBeUndefined();
    expect(r2.affixes!.some(isDown)).toBe(true);
    expect(m2.affixes![0]).toEqual(had);
    expect(m2.affixes!.length).toBe(2);
    // A second load changes nothing.
    const again = JSON.parse(JSON.stringify(data.inventory));
    upgradeSavedItems(data);
    expect(data.inventory).toEqual(again);
  });

  it('loads a save whose rolls predate the 2026-10-14 stat units (a DFP roll used to break the upgrade)', () => {
    const old = makeItem('frame_psy_15', {
      rarity: 'rare', name: 'X',
      affixes: [{ id: 'dfp' as never, v: 40, t: 6 }, { id: 'hp', v: 100, t: 5 }, { id: 'areaDr', v: 10, t: 6 }],
      dormant: [{ id: 'brittle', v: 27, p: 30, t: 6 }],
    });
    const data = save([old]);
    delete data.affixUnits;
    const ch = new Character(upgradeSavedItems(readAffixData(data)));
    const it = ch.find(old.uid)!;
    expect(it.affixes!.slice(0, 3)).toEqual([{ id: 'strike', v: 7, t: 6 }, { id: 'hp', v: 100, t: 5 }, { id: 'areaDr', v: 7, t: 6 }]);
    expect(it.dormant).toBeUndefined();
    expect(it.affixes!.every((r) => ITEM_AFFIXES[r.id])).toBe(true);
  });

  it('makes class-era gear rods, wands and Psy armour, its weapon affixes and specials replaced (2026-10-21)', () => {
    const blade: ItemInstance = { uid: 'b', id: 'saber_15', rarity: 'magic', affixes: [{ id: 'atpPct' as never, v: 26, t: 6 }, { id: 'lck', v: 30, t: 6 }], special: 'heat' };
    const gun: ItemInstance = { uid: 'g', id: 'rifle_9' };
    const armour: ItemInstance = {
      uid: 'a', id: 'frame_combat_12', rarity: 'rare', name: 'X',
      affixes: [{ id: 'hp', v: 100, t: 5 }, { id: 'reckless' as never, v: 30, p: 5, t: 6 }],
      dormant: [{ id: 'staggerPct' as never, v: 20, t: 5 }],
    };
    const ch = new Character(upgradeSavedItems(readAffixData(save([blade, gun, armour]))));
    const [b, g, a] = ['b', 'g', 'a'].map((uid) => ch.find(uid)!);
    expect([b.id, g.id, a.id]).toEqual(['rod_15', 'wand_9', 'frame_psy_12']);
    expect(b.special).toBeUndefined();
    // Weapon damage went: a fresh prefix takes its place beside the roll it kept.
    expect(b.affixes).toHaveLength(2);
    expect(b.affixes).toContainEqual({ id: 'lck', v: 30, t: 6 });
    expect(prefixes(b)).toBe(1);
    expect(a.affixes![0]).toEqual({ id: 'hp', v: 100, t: 5 });
    expect(a.affixes!.length).toBe(rareCount(tierIlvl(12)));
    expect(a.dormant).toBeUndefined();
    for (const it of [b, a]) {
      for (const r of it.affixes!) {
        expect(RETIRED_AFFIXES).not.toContain(r.id);
        expect(ITEM_AFFIXES[r.id].slots).toContain(it === b ? 'weapon' : 'frame');
      }
    }
  });
});

describe('verdicts judge gear as it dropped', () => {
  /** A Lv 100 character (Foie its one technique) holding `equip`. */
  const holding = (equip: ItemInstance) => {
    const ch = Character.create('T');
    ch.addXp(1e7);
    ch.addItem(equip);
    ch.data.equipped.weapon = equip.uid;
    return ch;
  };

  it('junks a drop that is no better than what is worn, with no crafted line', () => {
    const ch = holding(makeItem('rod_15', { rarity: 'magic', affixes: [{ id: 'mstFlat', v: 68, t: 6 }] }));
    const worse = makeItem('rod_15', { rarity: 'rare', name: 'X', affixes: [{ id: 'mstFlat', v: 48, t: 5 }, { id: 'injCharge', v: 22, t: 6 }] });
    const v = dropVerdict(ch, worse);
    expect(v).toEqual({ look: 'junk', mark: 'down', note: expect.stringMatching(/^Downgrade: Damage\/s −/) });
    const better = makeItem('rod_15', { rarity: 'rare', name: 'Y', affixes: [{ id: 'mstFlat', v: 68, t: 6 }, { id: 'techPct', v: 28, t: 6 }] });
    expect(dropVerdict(ch, better)).toMatchObject({ look: 'upgrade', mark: 'up' });
  });

  it('judges armour by damage first: an HP and resistance frame never beats a crit one', () => {
    const ch = Character.create('T');
    ch.addXp(1e7);
    const worn = makeItem('frame_psy_15', {
      rarity: 'rare', name: 'Thunder Mantle', ilvl: 116,
      affixes: [{ id: 'brittle', v: 35, p: 9, t: 8 }, { id: 'haste', v: 12 }, { id: 'lck', v: 47, t: 8 }, { id: 'walk', v: 11, t: 8 }],
    });
    ch.addItem(worn);
    ch.data.equipped.frame = worn.uid;
    const drop = makeItem('frame_psy_15', {
      rarity: 'rare', name: 'Void Mantle', ilvl: 116,
      affixes: [{ id: 'hp', v: 156, t: 7 }, { id: 'brittle', v: 33, p: 8, t: 8 }, { id: 'resPara', v: 45, t: 8 }, { id: 'haste', v: 12 }, { id: 'resCorrupt', v: 39, t: 7 }],
    });
    const c = compareEquip(ch, drop)!;
    expect(c.rows[0]).toMatchObject({ label: 'Damage/s', key: true });
    expect(c.rows[0].delta).toBeLessThan(0);
    expect(c.rows[1]).toMatchObject({ label: 'Rating', tie: true });
    expect(c.rows[1].delta).toBeGreaterThan(0);
    expect(dropVerdict(ch, drop)).toMatchObject({ look: 'junk', mark: 'down' });
  });
});
