import { describe, expect, it } from 'vitest';
import { Character, makeItem, simulateEquip } from './character';
import { damageBreakdown, estimateDamage, expeditionFoe } from './dps';

const force = () => {
  const ch = Character.create('T', 'force');
  ch.addXp(1e6);
  return ch;
};

describe('damage estimates', () => {
  it('measures against the expedition average, tougher on Nightmare', () => {
    const forest = expeditionFoe('forest', false);
    expect(forest.label).toBe('Forest');
    expect(forest.armor).toBeGreaterThan(0);
    expect(expeditionFoe('mines', false).armor).toBeGreaterThan(forest.armor);
    const hard = expeditionFoe('forest', true);
    expect(hard.label).toBe('Forest (Nightmare)');
    expect(hard.armor).toBeGreaterThan(forest.armor);
  });

  it('Flow (TP refill) pays for Arts sooner, without touching the chain itself', () => {
    const ch = Character.create('T', 'hunter');
    ch.data.level = 60;
    const foe = expeditionFoe('mines', 'nightmare');
    const plain = damageBreakdown(simulateEquip(ch, makeItem('saber_8'), 'weapon'), foe);
    const flow = damageBreakdown(simulateEquip(ch, makeItem('saber_8', { affixes: [{ id: 'tpRefill', v: 20 }] }), 'weapon'), foe);
    expect(flow.basic.dps).toBeCloseTo(plain.basic.dps, 9);
    const hits = plain.arts.filter((a) => a.perUse > 0);
    expect(hits.length).toBeGreaterThan(0);
    for (const a of hits) expect(flow.arts.find((x) => x.id === a.id)!.sustained).toBeGreaterThanOrEqual(a.sustained - 1e-9);
    expect(flow.arts.some((x, i) => x.sustained > plain.arts[i].sustained + 1e-9)).toBe(true);
  });

  it('more tech damage means more spell damage; only casters get the spell column', () => {
    const ch = force();
    const foe = expeditionFoe('forest', false);
    const low = estimateDamage(simulateEquip(ch, makeItem('rod_2'), 'weapon'), foe, true);
    const high = estimateDamage(simulateEquip(ch, makeItem('rod_6'), 'weapon'), foe, true);
    expect(high.spell!).toBeGreaterThan(low.spell!);
    expect(high.weapon).toBeGreaterThan(low.weapon);
    expect(estimateDamage(Character.create('H', 'hunter'), foe, false).spell).toBeNull();
  });
});

describe('damage breakdown (Damage tab)', () => {
  it('adds up to the same numbers as the estimate it opens up', () => {
    for (const cls of ['hunter', 'ranger', 'force'] as const) {
      const ch = Character.create('T', cls);
      ch.data.level = 60;
      const foe = expeditionFoe('mines', 'nightmare');
      const est = estimateDamage(ch, foe, true);
      const b = damageBreakdown(ch, foe);
      expect(b.basic.dps).toBeCloseTo(est.weapon, 6);
      expect(b.basic.steps).toHaveLength(3);
      expect(b.basic.steps.reduce((t, s) => t + s.secs, 0)).toBeCloseTo(b.basic.secs, 9);
      // Every Art on the bar has a line; attack ones deal damage, at their TP.
      for (const a of b.arts) {
        expect(a.secs).toBeGreaterThan(0);
        expect(a.tp).toBeGreaterThan(0);
        // Paid for by basic swings: between the basic chain and the Art back to back.
        if (a.perUse > 0) expect(a.sustained).toBeGreaterThanOrEqual(Math.min(a.dps, b.basic.dps) - 1e-9);
        if (a.perUse > 0) expect(a.sustained).toBeLessThanOrEqual(Math.max(a.dps, b.basic.dps) + 1e-9);
      }
      const tech = b.arts.find((a) => a.id === est.tech);
      if (tech) expect(tech.dps).toBeCloseTo(est.spell!, 6);
    }
  });
});

describe('Cast speed folded into Haste (2026-10-11)', () => {
  it('turns saved Cast speed rolls into Haste, capped by tier, dropped below tier 8', () => {
    const data = Character.create('T', 'force').data;
    const rod15 = makeItem('rod_15', { rarity: 'rare', affixes: [{ id: 'castSpeed' as never, v: 14 }, { id: 'techPct', v: 20 }] });
    const rod11 = makeItem('rod_11', { rarity: 'rare', affixes: [{ id: 'haste', v: 3 }, { id: 'castSpeed' as never, v: 2 }] });
    const rod3 = makeItem('rod_3', { rarity: 'magic', affixes: [{ id: 'castSpeed' as never, v: 4 }] });
    data.inventory.push(rod15, rod11, rod3);
    const ch = new Character(JSON.parse(JSON.stringify(data)));
    const get = (uid: string) => ch.find(uid)!.affixes;
    expect(get(rod15.uid)).toEqual([{ id: 'haste', v: 12 }, { id: 'techPct', v: 20 }]);
    expect(get(rod11.uid)).toEqual([{ id: 'haste', v: 3 }]);
    expect(get(rod3.uid)).toEqual([]);
  });
});
