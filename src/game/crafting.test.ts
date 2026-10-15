import { describe, expect, it } from 'vitest';
import { bestCrafted, Character, compareEquip, dropVerdict, makeItem, readAffixData, type CharacterData, type ItemInstance } from './character';
import { craftLoadouts, maxedRoll, rollCost } from './craftCeiling';
import { affixTier, applyCraft, craftable, craftPlan, craftWith, salvageYield, upgradeCrafting } from './crafting';
import { getDef, raceCap } from './data/items';
import { ITEM_AFFIXES, tierIlvl, tierRange, type AffixRoll } from './data/itemAffixes';
import { dormantCount, rareCount, rollArmor, rollPhoton, rollWeapon } from './loot';

/** A seeded generator, so every run rolls the same. */
function seq(seed = 1): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/** A rare tier 15 saber at item level `ilvl` with the given affixes (and dormant ones). */
function rare(affixes: AffixRoll[], ilvl = 98, dormant?: AffixRoll[]): ItemInstance {
  return makeItem('saber_15', { rarity: 'rare', name: 'Doom Edge', affixes, ilvl: ilvl === 98 ? undefined : ilvl, ...(dormant ? { dormant } : {}) });
}

const kind = (r: AffixRoll) => ITEM_AFFIXES[r.id].kind;
const isDown = (r: AffixRoll) => !!ITEM_AFFIXES[r.id].penalty;
const isRace = (r: AffixRoll) => r.id.startsWith('race');
/** Active prefixes, a rolled special counted. */
const prefixes = (it: ItemInstance) => (it.affixes ?? []).filter((r) => kind(r) === 'prefix').length + (it.special ? 1 : 0);

describe('affix counts (fixed by item level)', () => {
  it('rares have 4 / 5 / 6 active by item level and 1 / 2 / 3 dormant; magic items 2', () => {
    expect([rareCount(tierIlvl(7)), rareCount(tierIlvl(8)), rareCount(tierIlvl(12)), rareCount(116)]).toEqual([4, 5, 6, 6]);
    const rng = seq(3);
    for (const [tier, ilvl] of [[5, undefined], [10, undefined], [15, undefined], [15, 116]] as const) {
      for (let i = 0; i < 80; i++) {
        for (const it of [rollWeapon(tier, rng, 'melee', 'rare', ilvl), rollArmor(tier, rng, 'caster', 'rare', ilvl)]) {
          const lvl = it.ilvl ?? tierIlvl(tier);
          expect((it.affixes?.length ?? 0) + (it.special ? 1 : 0)).toBe(rareCount(lvl));
          expect(it.dormant?.length).toBe(dormantCount(lvl));
          expect(prefixes(it)).toBeLessThanOrEqual(3);
          expect(it.affixes!.filter((r) => kind(r) === 'suffix').length).toBeLessThanOrEqual(3);
          const ids = [...it.affixes!, ...it.dormant!].map((r) => r.id);
          expect(new Set(ids).size).toBe(ids.length);
          expect(it.affixes!.filter(isRace).length).toBeLessThanOrEqual(1);
        }
      }
      for (let i = 0; i < 40; i++) {
        const m = rollWeapon(tier, rng, 'ranged', 'magic', ilvl);
        expect((m.affixes?.length ?? 0) + (m.special ? 1 : 0)).toBe(2);
        expect(prefixes(m)).toBe(1);
        expect(m.dormant).toBeUndefined();
      }
    }
  });

  it('Hell and rift rares hold a downside, active or dormant, and an active one always has a dormant prefix to swap for', () => {
    const rng = seq(9);
    let active = 0;
    let dormant = 0;
    for (let i = 0; i < 400; i++) {
      for (const it of [rollArmor(15, rng, 'melee', 'rare', 112), rollWeapon(13, rng, 'caster', 'rare'), rollArmor(13, rng, 'ranged', 'rare')]) {
        const a = it.affixes!.some(isDown);
        const d = it.dormant!.some(isDown);
        expect(a || d).toBe(true);
        if (a) active++;
        if (d) dormant++;
        if (a) expect(it.dormant!.some((r) => kind(r) === 'prefix' && !isDown(r))).toBe(true);
      }
    }
    expect(active).toBeGreaterThan(100);
    expect(dormant).toBeGreaterThan(100);
  });

  it('each race % draws at half a normal affix (one active at most; more can lie dormant)', () => {
    // A Normal rare's 2 suffixes: a melee weapon draws from LCK, Stagger and four races.
    const rng = seq(4);
    let dark = 0;
    let lck = 0;
    for (let i = 0; i < 2000; i++) {
      const ids = rollWeapon(5, rng, 'melee', 'rare').affixes!.map((r) => r.id);
      if (ids.includes('raceDark')) dark++;
      if (ids.includes('lck')) lck++;
    }
    expect(dark).toBeLessThan(lck * 0.65);
    expect(dark).toBeGreaterThan(lck * 0.3);
  });
});

describe('Photon Drop and Photon Sphere', () => {
  it('a Drop rerolls the value inside its strength tier (penalty too), as often as you like', () => {
    const rng = seq(11);
    const w = rare([{ id: 'atpPct', v: 25, t: 6 }, { id: 'reckless', v: 27, p: 6, t: 6 }]);
    for (let i = 0; i < 15; i++) {
      expect(applyCraft(w, 'drop', '0', rng).ok).toBe(true);
      expect(applyCraft(w, 'drop', '1', rng).ok).toBe(true);
      const [a, r] = w.affixes!;
      expect(a.v).toBeGreaterThanOrEqual(23);
      expect(a.v).toBeLessThanOrEqual(28);
      expect(r.p).toBeGreaterThanOrEqual(5);
      expect(r.p).toBeLessThanOrEqual(7);
    }
  });

  it('a Sphere raises a tier up to what the item level allows, never lowering the value', () => {
    // Hell tier 15 (item level 98): tier 6 is the top.
    const hell = rare([{ id: 'atpPct', v: 26, t: 6 }, { id: 'atpFlat', v: 30, t: 5 }]);
    const plan = craftPlan(hell, 'sphere');
    expect(plan.choices[0]).toMatchObject({ ok: false, reason: 'Tier 6 is the best item level 98 allows' });
    expect(plan.choices[1]).toMatchObject({ ok: true, after: 'tier 6: 45-65' });
    expect(applyCraft(hell, 'sphere', '1', seq()).ok).toBe(true);
    expect(hell.affixes![1]).toMatchObject({ t: 6 });
    // A rift tier 12 drop (item level 112) goes to tier 8.
    const rift = rare([{ id: 'atpPct', v: 28, t: 6 }], 112);
    expect(applyCraft(rift, 'sphere', '0', seq()).ok).toBe(true);
    expect(rift.affixes![0].t).toBe(7);
    expect(rift.affixes![0].v).toBeGreaterThanOrEqual(28);
    expect(applyCraft(rift, 'sphere', '0', seq()).ok).toBe(true);
    const [lo, hi] = tierRange(ITEM_AFFIXES.atpPct.tiers, 8);
    expect(rift.affixes![0].v).toBeGreaterThanOrEqual(lo);
    expect(rift.affixes![0].v).toBeLessThanOrEqual(hi);
    expect(craftPlan(rift, 'sphere').choices[0].ok).toBe(false);
  });

  it('race % and Haste step up to the item tier cap instead', () => {
    const w = rare([{ id: 'raceDark', v: 75 }, { id: 'haste', v: 12 }]);
    const plan = craftPlan(w, 'sphere');
    expect(plan.choices[0]).toMatchObject({ ok: true, after: '75 → 80' });
    expect(plan.choices[1]).toMatchObject({ ok: false, reason: "At this tier's cap (12)" });
    expect(applyCraft(w, 'sphere', '0', seq()).ok).toBe(true);
    expect(w.affixes![0].v).toBe(80);
  });

  it('rolls without a stored tier get one from their value; dormant affixes are left alone', () => {
    const w = rare([{ id: 'atpPct', v: 27 }, { id: 'atpPct', v: 3 }], 98, [{ id: 'lck', v: 30, t: 6 }]);
    expect(affixTier(w, w.affixes![0])).toBe(6);
    expect(affixTier(w, w.affixes![1])).toBe(1);
    expect(craftPlan(w, 'drop').choices).toHaveLength(2);
  });

  it("uniques can't be crafted", () => {
    expect(craftable(makeItem('unique_darkFlow_3'))).toBe(false);
    expect(craftPlan(makeItem('unique_darkFlow_3'), 'drop').reason).toBe("Uniques can't be crafted");
    expect(craftable(makeItem('mate_3'))).toBe(false);
  });
});

describe('Photon Crystal (swap)', () => {
  const item = () =>
    rare(
      [{ id: 'atpPct', v: 26, t: 6 }, { id: 'atpFlat', v: 40, t: 5 }, { id: 'lck', v: 30, t: 6 }, { id: 'raceDark', v: 40 }],
      98,
      [{ id: 'reckless', v: 27, p: 6, t: 6 }, { id: 'staggerPct', v: 20, t: 5 }, { id: 'raceNative', v: 30 }],
    );

  it('offers each active affix against each dormant one of its kind', () => {
    const plan = craftPlan(item(), 'crystal');
    expect(plan.ok).toBe(true);
    // 2 prefixes x 1 dormant prefix + 2 suffixes x 2 dormant suffixes.
    expect(plan.choices.map((c) => c.key).sort()).toEqual(['0:0', '1:0', '2:1', '2:2', '3:1', '3:2']);
    expect(plan.choices.find((c) => c.key === '0:0')).toMatchObject({ downside: true, after: 'Weapon damage +27% · Damage taken +6%' });
  });

  it('swaps the pick, each keeping its roll, and can swap back', () => {
    const w = item();
    expect(applyCraft(w, 'crystal', '1:0', seq()).ok).toBe(true);
    expect(w.affixes![1]).toMatchObject({ id: 'reckless', v: 27, p: 6 });
    expect(w.dormant![0]).toMatchObject({ id: 'atpFlat', v: 40, t: 5 });
    expect(applyCraft(w, 'crystal', '1:0', seq()).ok).toBe(true);
    expect(w.affixes![1]).toMatchObject({ id: 'atpFlat', v: 40 });
  });

  it('one race at a time: a dormant race only comes in for the active one', () => {
    const plan = craftPlan(item(), 'crystal');
    expect(plan.choices.find((c) => c.key === '2:2')).toMatchObject({ ok: false, reason: 'One race affix at a time' });
    expect(plan.choices.find((c) => c.key === '3:2')).toMatchObject({ ok: true });
  });

  it('needs dormant affixes (rares only)', () => {
    expect(craftPlan(makeItem('saber_15', { rarity: 'magic', affixes: [{ id: 'atpPct', v: 20 }] }), 'crystal').reason).toBe('Only rares have dormant affixes');
    expect(craftPlan(rare([{ id: 'atpPct', v: 20 }]), 'crystal').reason).toBe('No dormant affixes');
  });
});

describe('using photons', () => {
  it('uses the photon up, only on success', () => {
    const ch = Character.create('T', 'hunter');
    const w = rare([{ id: 'atpPct', v: 26, t: 6 }]);
    const drop = makeItem('photon_drop', { qty: 2 });
    ch.addItem(w);
    ch.addItem(drop);
    expect(craftWith(ch, w.uid, drop.uid, '0', seq()).ok).toBe(true);
    expect(ch.countOf('photon_drop')).toBe(1);
    expect(craftWith(ch, w.uid, drop.uid, '5', seq()).ok).toBe(false);
    expect(ch.countOf('photon_drop')).toBe(1);
  });

  it('salvage gives a Photon Drop for a rare, sometimes for a magic item, none for normal or unique', () => {
    expect(salvageYield(rare([]))).toBe(1);
    expect(salvageYield(makeItem('saber_3'))).toBe(0);
    expect(salvageYield(makeItem('unique_darkFlow_3'))).toBe(0);
    const rng = seq(23);
    let got = 0;
    for (let i = 0; i < 400; i++) got += salvageYield(makeItem('saber_3', { rarity: 'magic' }), rng);
    expect(got / 400).toBeGreaterThan(0.25);
    expect(got / 400).toBeLessThan(0.45);
  });

  it('photons drop by difficulty: only Photon Drops on Normal, Spheres and Crystals from Nightmare, most in rifts', () => {
    const rng = seq(31);
    const count = (tier: number, ilvl?: number) => {
      const out: Record<string, number> = {};
      for (let i = 0; i < 2000; i++) {
        const id = rollPhoton(tier, rng, ilvl).id;
        out[id] = (out[id] ?? 0) + 1;
      }
      return out;
    };
    expect(Object.keys(count(7))).toEqual(['photon_drop']);
    const nm = count(10);
    const rift = count(15, 110);
    expect(nm.photon_crystal).toBeGreaterThan(0);
    expect(rift.photon_crystal).toBeGreaterThan(nm.photon_crystal * 2);
    expect(rift.photon_drop).toBeGreaterThan(rift.photon_sphere);
    expect(rift.photon_sphere).toBeGreaterThan(rift.photon_crystal);
    for (const id of Object.keys(rift)) expect(getDef(id).type).toBe('photon');
  });
});

describe('old saves', () => {
  const save = (inventory: ItemInstance[]): CharacterData => ({ ...Character.create('T', 'hunter').data, inventory });

  it('turns retired photons into Spheres and Crystals, and drops Potential', () => {
    const data = save([
      { uid: 'n', id: 'null_photon', qty: 3 },
      makeItem('photon_sphere', { qty: 2 }),
      { uid: 'a', id: 'augment_core', qty: 1 },
      makeItem('saber_15', { pot: 4, potMax: 12 }),
    ]);
    const ch = new Character(upgradeCrafting(data));
    expect(ch.countOf('photon_sphere')).toBe(5);
    expect(ch.countOf('photon_crystal')).toBe(1);
    expect(ch.data.inventory.some((it) => it.id === 'null_photon' || it.id === 'augment_core')).toBe(false);
    expect(ch.data.inventory.find((it) => it.id === 'saber_15')!.pot).toBeUndefined();
  });

  it('tops gear up to the fixed counts once, keeping what it had', () => {
    const had: AffixRoll = { id: 'atpPct', v: 26, t: 6 };
    const r = makeItem('frame_guard_15', { rarity: 'rare', name: 'X', affixes: [{ id: 'hp', v: 100, t: 5 }] });
    const m = makeItem('saber_15', { rarity: 'magic', affixes: [had] });
    const data = upgradeCrafting(save([r, m]));
    const [r2, m2] = data.inventory;
    expect(r2.affixes![0]).toMatchObject({ id: 'hp', v: 100 });
    expect(r2.affixes!.length).toBe(6);
    expect(r2.dormant!.length).toBe(3);
    expect(m2.affixes![0]).toMatchObject(had);
    expect((m2.affixes?.length ?? 0) + (m2.special ? 1 : 0)).toBe(2);
    // A second load changes nothing.
    const again = JSON.parse(JSON.stringify(data.inventory));
    upgradeCrafting(data);
    expect(data.inventory).toEqual(again);
  });
  it('loads a save whose rolls predate the 2026-10-14 stat units (a DFP roll used to break the crafting upgrade)', () => {
    const old = makeItem('frame_guard_15', {
      rarity: 'rare', name: 'X',
      affixes: [{ id: 'dfp' as never, v: 40, t: 6 }, { id: 'hp', v: 100, t: 5 }, { id: 'areaDr', v: 10, t: 6 }],
      dormant: [{ id: 'reckless', v: 33, p: 30, t: 6 }],
    });
    const data = save([old]);
    delete data.affixUnits;
    const ch = new Character(upgradeCrafting(readAffixData(data)));
    const it = ch.find(old.uid)!;
    expect(it.affixes!.slice(0, 3)).toEqual([{ id: 'strike', v: 7, t: 6 }, { id: 'hp', v: 100, t: 5 }, { id: 'areaDr', v: 7, t: 6 }]);
    expect(it.dormant![0]).toEqual({ id: 'reckless', v: 30, p: 5, t: 6 });
    expect([...it.affixes!, ...it.dormant!].every((r) => ITEM_AFFIXES[r.id])).toBe(true);
  });
});

describe('fully crafted (the verdict judges gear by its best)', () => {
  it('maxes an affix to the top tier its item level allows, a race % and Haste to the cap', () => {
    const w = rare([]);
    expect(maxedRoll(w, { id: 'atpPct', v: 16, t: 4 })).toEqual({ id: 'atpPct', v: 28, t: 6 });
    expect(maxedRoll(w, { id: 'reckless', v: 22, p: 5, t: 5 })).toMatchObject({ v: 30, p: 5, t: 6 });
    expect(maxedRoll(w, { id: 'raceDark', v: 10 }).v).toBe(raceCap(15));
    expect(maxedRoll(rare([], 60), { id: 'atpPct', v: 16, t: 4 })).toMatchObject({ v: 23, t: 5 });
    expect(rollCost(w, { id: 'atpPct', v: 16, t: 4 }, { id: 'atpPct', v: 28, t: 6 })).toEqual({ spheres: 2, reroll: true });
    expect(rollCost(w, { id: 'raceDark', v: 10 }, { id: 'raceDark', v: 20 })).toEqual({ spheres: 2, reroll: false });
  });

  it('reaches every active set Crystals can make: same prefix / suffix split, one race', () => {
    const w = rare(
      [{ id: 'atpPct', v: 26, t: 6 }, { id: 'atpFlat', v: 40, t: 5 }, { id: 'lck', v: 30, t: 6 }, { id: 'raceDark', v: 40 }],
      98,
      [{ id: 'reckless', v: 27, p: 6, t: 6 }, { id: 'staggerPct', v: 20, t: 5 }, { id: 'raceNative', v: 30 }],
    );
    const sets = craftLoadouts(w);
    // 3 prefixes choose 2, times 4 suffixes choose 2 less the two-race pair.
    expect(sets.length).toBe(3 * 5);
    expect(sets[0]).toEqual(w.affixes);
    expect(sets.every((s) => s.filter(isRace).length <= 1)).toBe(true);
  });

  const holding = (equip: ItemInstance) => {
    const ch = Character.create('T', 'hunter');
    ch.addXp(1e7);
    ch.addItem(equip);
    ch.data.equipped.weapon = equip.uid;
    return ch;
  };

  it('calls a weak roll on a good base a crafted upgrade, not junk, and leaves useless affixes alone', () => {
    const ch = holding(makeItem('saber_15', { rarity: 'magic', affixes: [{ id: 'atpPct', v: 20, t: 4 }] }));
    const drop = rare([{ id: 'atpFlat', v: 2, t: 1 }, { id: 'staggerPct', v: 5, t: 1 }], 98, [{ id: 'atpPct', v: 3, t: 1 }]);
    const before = JSON.stringify(drop);
    const best = bestCrafted(ch, drop)!;
    expect(JSON.stringify(drop)).toBe(before);
    expect(best.rows[0].delta).toBeGreaterThan(0);
    // Stagger adds no damage: not Sphered, not swapped.
    expect(best.affixes).toContain(drop.affixes![1]);
    expect(best.spheres).toBe(5);
    expect(best.rerolls).toBe(1);
    const v = dropVerdict(ch, drop);
    expect(v).toMatchObject({ look: 'plain', mark: 'down' });
    expect(v.note).toMatch(/^Downgrade: Damage\/s −/);
    expect(v.crafted?.up).toBe(true);
    expect(v.crafted?.text).toMatch(/^Fully crafted: Damage\/s \+\d+% \(.*5 Spheres · Drops\)$/);
    // The same in the bag: the crafted version is judged, not the bag's copy.
    ch.addItem(drop);
    expect(bestCrafted(ch, drop)!.rows[0].delta).toBeCloseTo(best.rows[0].delta);
  });

  it('swaps in a dormant affix when that is what pays', () => {
    const ch = holding(makeItem('saber_15', { rarity: 'magic', affixes: [{ id: 'atpPct', v: 28, t: 6 }] }));
    const drop = rare([{ id: 'finisherPct', v: 22, t: 6 }, { id: 'staggerPct', v: 30, t: 6 }], 98, [{ id: 'atpPct', v: 28, t: 6 }, { id: 'lck', v: 40, t: 6 }]);
    const best = bestCrafted(ch, drop)!;
    expect(best.swaps.map((s) => s.in).sort()).toEqual(['Crit chance +4.0%', 'Weapon damage +28%']);
    expect(best.spheres).toBe(0);
    expect(dropVerdict(ch, drop).crafted?.text).toMatch(/\(2 Crystals\)$/);
  });

  it("judges armour by damage first: a caster's HP and resistance frame never beats a crit one, crafted or not", () => {
    const ch = Character.create('T', 'force');
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
      dormant: [{ id: 'injCharge', v: 27, t: 8 }, { id: 'resPoison', v: 39, t: 7 }, { id: 'strike', v: 8, t: 7 }],
    });
    const c = compareEquip(ch, drop)!;
    expect(c.rows[0]).toMatchObject({ label: 'Damage/s (tech)', key: true });
    expect(c.rows[0].delta).toBeLessThan(0);
    expect(c.rows[1]).toMatchObject({ label: 'Rating', tie: true });
    expect(c.rows[1].delta).toBeGreaterThan(0);
    const v = dropVerdict(ch, drop);
    expect(v).toMatchObject({ look: 'junk', mark: 'down' });
    expect(v.crafted).toMatchObject({ up: false });
    expect(v.crafted?.text).toMatch(/^Even fully crafted: Damage\/s \(tech\) −\d+%/);
  });

  it('still junks what no crafting saves, and says so', () => {
    const ch = holding(makeItem('saber_15', { rarity: 'magic', affixes: [{ id: 'atpPct', v: 28, t: 6 }] }));
    const v = dropVerdict(ch, makeItem('saber_1', { rarity: 'magic', affixes: [{ id: 'atpPct', v: 3, t: 1 }] }));
    expect(v.look).toBe('junk');
    expect(v.crafted).toMatchObject({ up: false });
    expect(v.crafted?.text).toMatch(/^Even fully crafted: Damage\/s −\d+%/);
    // Nothing photons can add: no line.
    expect(bestCrafted(ch, makeItem('saber_1'))).toBeNull();
    expect(bestCrafted(ch, makeItem('unique_darkFlow_3'))).toBeNull();
  });
});
