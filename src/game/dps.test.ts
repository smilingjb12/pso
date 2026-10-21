import { describe, expect, it } from 'vitest';
import { Character, makeItem, simulateEquip } from './character';
import { hard, hell } from './config';
import { damageBreakdown, estimateDamage, expeditionFoe } from './dps';

const force = () => {
  const ch = Character.create('T');
  ch.addXp(1e6);
  return ch;
};

/** A Lv 60 character holding `weapon`, with Foie, Gizonde, Rabarta and Resta on the bar. */
const caster = (weapon: string) => {
  const ch = Character.create('T');
  ch.data.level = 60;
  for (const id of ['zonde', 'gizonde', 'barta', 'gibarta', 'rabarta', 'resta']) expect(ch.rankUp(id)).toBeNull();
  (['foie', 'gizonde', 'rabarta', 'resta'] as const).forEach((id, slot) => expect(ch.setArtSlot(slot, id)).toBeNull());
  return simulateEquip(ch, makeItem(weapon), 'weapon');
};

/** Share of the time a technique is cast when bolts pay for its TP: sustained = share x cast dps + the rest x bolt dps. */
const castShare = (b: ReturnType<typeof damageBreakdown>, id: string) => {
  const a = b.arts.find((x) => x.id === id)!;
  return (a.sustained - b.basic.dps) / (a.dps - b.basic.dps);
};

describe('damage estimates', () => {
  it('measures against the expedition average: each enemy its own resistance on Normal, the expedition one on Nightmare and Hell', () => {
    const forest = expeditionFoe('forest', false);
    expect(forest.label).toBe('Forest');
    expect(forest.techResist).toBeGreaterThan(0);
    const nm = expeditionFoe('forest', true);
    expect(nm.label).toBe('Forest (Nightmare)');
    expect(nm.techResist).toBe(hard.forest.techResist);
    const h = expeditionFoe('forest', 'hell');
    expect(h.label).toBe('Forest (Hell)');
    expect(h.techResist).toBe(hell.forest.techResist);
  });

  it('cuts bolts and techniques alike by the technique resistance', () => {
    const ch = force();
    const open = estimateDamage(ch, { techResist: 0, label: 'x' });
    const tough = estimateDamage(ch, { techResist: 20, label: 'x' });
    expect(tough.bolt).toBeCloseTo(open.bolt * 0.8, 6);
    expect(tough.spell).toBeCloseTo(open.spell * 0.8, 6);
  });

  it('Flow (TP refill) pays for Arts sooner, without touching the chain itself', () => {
    const ch = Character.create('T');
    ch.data.level = 60;
    const foe = expeditionFoe('mines', 'nightmare');
    const plain = damageBreakdown(simulateEquip(ch, makeItem('wand_8'), 'weapon'), foe);
    const flow = damageBreakdown(simulateEquip(ch, makeItem('wand_8', { affixes: [{ id: 'tpRefill', v: 20 }] }), 'weapon'), foe);
    expect(flow.basic.dps).toBeCloseTo(plain.basic.dps, 9);
    const hits = plain.arts.filter((a) => a.perUse > 0);
    expect(hits.length).toBeGreaterThan(0);
    for (const a of hits) expect(flow.arts.find((x) => x.id === a.id)!.sustained).toBeGreaterThanOrEqual(a.sustained - 1e-9);
    expect(flow.arts.some((x, i) => x.sustained > plain.arts[i].sustained + 1e-9)).toBe(true);
  });

  it('more tech damage means more spell and bolt damage', () => {
    const ch = force();
    const foe = expeditionFoe('forest', false);
    const low = estimateDamage(simulateEquip(ch, makeItem('rod_2'), 'weapon'), foe);
    const high = estimateDamage(simulateEquip(ch, makeItem('rod_6'), 'weapon'), foe);
    expect(high.spell).toBeGreaterThan(low.spell);
    expect(high.bolt).toBeGreaterThan(low.bolt);
  });

  it("a rod's techniques and bolts hit harder; a wand's quicker bolts pay for techniques sooner", () => {
    const foe = expeditionFoe('mines', 'nightmare');
    const rod = caster('rod_8');
    const wand = caster('wand_8');
    expect(estimateDamage(rod, foe).spell).toBeGreaterThan(estimateDamage(wand, foe).spell);
    const r = damageBreakdown(rod, foe);
    const w = damageBreakdown(wand, foe);
    expect(r.arts.find((a) => a.id === 'foie')!.perUse).toBeGreaterThan(w.arts.find((a) => a.id === 'foie')!.perUse);
    expect(r.basic.steps[0].hit).toBeGreaterThan(w.basic.steps[0].hit);
    expect(w.basic.secs).toBeLessThan(r.basic.secs);
    // More of the wand's sustained figure is spent casting: its bolts win the TP back sooner.
    for (const id of ['foie', 'gizonde', 'rabarta']) {
      expect(castShare(r, id)).toBeGreaterThan(0);
      expect(castShare(w, id)).toBeLessThan(1);
      expect(castShare(w, id)).toBeGreaterThan(castShare(r, id));
    }
  });

  it('Haste speeds up both the bolts and the casts', () => {
    const ch = caster('wand_8');
    const foe = expeditionFoe('mines', 'nightmare');
    const fast = simulateEquip(ch, makeItem('wand_8', { affixes: [{ id: 'haste', v: 10 }] }), 'weapon');
    const slow = damageBreakdown(ch, foe);
    const quick = damageBreakdown(fast, foe);
    expect(slow.hasteGain).toBeCloseTo(0, 9);
    expect(quick.haste).toBe(10);
    expect(quick.hasteGain).toBeGreaterThan(0);
    expect(quick.basic.secs).toBeLessThan(slow.basic.secs);
    expect(quick.basic.dps).toBeCloseTo(slow.basic.dps * (1 + quick.hasteGain), 6);
    for (const a of quick.arts) expect(a.secs).toBeLessThan(slow.arts.find((x) => x.id === a.id)!.secs);
    expect(estimateDamage(fast, foe).bolt).toBeGreaterThan(estimateDamage(ch, foe).bolt);
    expect(estimateDamage(fast, foe).spell).toBeGreaterThan(estimateDamage(ch, foe).spell);
  });
});

describe('damage breakdown (Damage tab)', () => {
  it('adds up to the same numbers as the estimate it opens up', () => {
    for (const weapon of ['wand_8', 'rod_8']) {
      const ch = caster(weapon);
      const foe = expeditionFoe('mines', 'nightmare');
      const est = estimateDamage(ch, foe);
      const b = damageBreakdown(ch, foe);
      expect(b.basic.dps).toBeCloseTo(est.bolt, 6);
      expect(b.basic.steps).toHaveLength(3);
      expect(b.basic.steps.reduce((t, s) => t + s.secs, 0)).toBeCloseTo(b.basic.secs, 9);
      // Every Art on the bar has a line; attack ones deal damage, at their TP.
      expect(b.arts.map((a) => a.id).sort()).toEqual(['foie', 'gizonde', 'rabarta', 'resta']);
      for (const a of b.arts) {
        expect(a.secs).toBeGreaterThan(0);
        expect(a.tp).toBeGreaterThan(0);
        // Paid for by bolts: between the basic chain and the technique back to back.
        if (a.perUse > 0) expect(a.sustained).toBeGreaterThanOrEqual(Math.min(a.dps, b.basic.dps) - 1e-9);
        if (a.perUse > 0) expect(a.sustained).toBeLessThanOrEqual(Math.max(a.dps, b.basic.dps) + 1e-9);
      }
      const resta = b.arts.find((a) => a.id === 'resta')!;
      expect(resta.perUse).toBe(0);
      expect(resta.sustained).toBe(0);
      expect(est.tech).toBe('foie');
      expect(b.arts.find((a) => a.id === est.tech)!.dps).toBeCloseTo(est.spell, 6);
    }
  });
});

describe('Cast speed folded into Haste (2026-10-11)', () => {
  it('turns saved Cast speed rolls into Haste, capped by tier, dropped below tier 8', () => {
    const data = Character.create('T').data;
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
