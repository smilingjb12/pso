import { describe, expect, it } from 'vitest';
import { Character } from './character';
import { magBonuses, magForm, magLevel, magPointsFree, magSpend, newMag, readMag } from './mag';

describe('Mag stats', () => {
  it('earns one point per character level, spent into MIND (Tech + TP) / DEF (Defense + HP)', () => {
    const m = newMag();
    expect(m).toEqual({ mind: 0, def: 0 });
    expect(magPointsFree(m, 1)).toBe(1);
    expect(magSpend(m, 1, 'def')).toBeNull();
    expect(magPointsFree(m, 1)).toBe(0);
    expect(magSpend(m, 1, 'mind')).toMatch(/No Mag points/);
    expect(magSpend(m, 10, 'mind', 5)).toBeNull();
    expect(magLevel(m)).toBe(6);
    expect(magPointsFree(m, 10)).toBe(4);
    expect(magSpend(m, 10, 'pow' as never)).toMatch(/No such Mag stat/);
  });

  it('adds offence or defence', () => {
    const m = { mind: 4, def: 5 };
    // Tech + TP: 3 + 2; Defense + HP: damage taken −0.25% (both) + 4.
    expect(magBonuses(m)).toEqual({ mst: 12, tp: 8, strike: 1, area: 1, hp: 20 });
  });

  it('reads back only point counts (POW and DEX points dropped)', () => {
    expect(readMag({ pow: 3, dex: 4, mind: 'x', def: -1, cells: ['1,0'] })).toEqual({ mind: 0, def: 0 });
    expect(readMag({ pow: 3, mind: 2, def: 5 })).toEqual({ mind: 2, def: 5 });
    expect(readMag(undefined)).toEqual(newMag());
  });

  it('adds to the character own stats, but never to requirements (only the level counts)', () => {
    const ch = Character.create('F');
    ch.data.level = 11;
    const rod = { uid: 'r', id: 'rod_4' };
    ch.data.inventory.push(rod);
    expect(ch.canEquip(rod).ok).toBe(false);
    const before = ch.ownStats().mst;
    ch.spendMag('mind', 11);
    expect(ch.ownStats().mst).toBe(before + 33);
    expect(ch.canEquip(rod).ok).toBe(false);
    ch.data.level = 12;
    expect(ch.canEquip(rod).ok).toBe(true);
  });
});

describe('Mag evolution', () => {
  it('takes its first form from MIND and later forms from the leading stat', () => {
    const m = newMag();
    expect(magForm(m).stage).toBe(0);
    m.def = 5;
    expect(magForm(m)).toMatchObject({ stage: 1, name: 'Vritra', lead: 'def', theme: 'mind' });
    m.mind = 12;
    expect(magForm(m)).toMatchObject({ stage: 2, name: 'Vayu', lead: 'mind', theme: 'mind' });
    m.def = 20;
    expect(magForm(m)).toMatchObject({ stage: 3, name: 'Soma', lead: 'def', theme: 'def' });
    m.mind = 20;
    expect(magForm(m)).toMatchObject({ stage: 4, name: 'Ashvinau' });
  });

  it('breaks ties toward MIND (or the stat it is given)', () => {
    expect(magForm({ mind: 10, def: 10 }).lead).toBe('mind');
    expect(magForm({ mind: 10, def: 10 }, 'def').lead).toBe('def');
  });
});
