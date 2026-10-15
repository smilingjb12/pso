import { describe, expect, it } from 'vitest';
import { Character } from './character';
import { magBonuses, magForm, magLevel, magPointsFree, magSpend, newMag, readMag } from './mag';

describe('Mag stats', () => {
  it('earns one point per character level, spent into POW / DEX / MIND / DEF', () => {
    const m = newMag();
    expect(magPointsFree(m, 1)).toBe(1);
    expect(magSpend(m, 1, 'pow')).toBeNull();
    expect(magPointsFree(m, 1)).toBe(0);
    expect(magSpend(m, 1, 'dex')).toMatch(/No Mag points/);
    expect(magSpend(m, 10, 'mind', 5)).toBeNull();
    expect(magLevel(m)).toBe(6);
    expect(magPointsFree(m, 10)).toBe(4);
  });

  it('adds a main stat and a secondary every class can use', () => {
    const m = { pow: 2, dex: 3, mind: 4, def: 5 };
    // Weapon + HP: 3 + 3; Weapon + Crit: 2.5 + 0.2%; Tech + TP: 3 + 2; Defense + HP: damage taken −0.25% (both) + 4.
    expect(magBonuses(m)).toEqual({ atp: 6 + 7, hp: 6 + 20, lck: 6, mst: 12, tp: 8, strike: 1, area: 1 });
  });

  it('reads back only point counts', () => {
    expect(readMag({ pow: 3, dex: -1, mind: 'x', cells: ['1,0'] })).toEqual({ pow: 3, dex: 0, mind: 0, def: 0 });
    expect(readMag(undefined)).toEqual(newMag());
  });

  it('adds to the character own stats, but never to requirements (only the level counts)', () => {
    const force = Character.create('F', 'force');
    force.data.level = 11;
    const saber = { uid: 's', id: 'saber_4' };
    force.data.inventory.push(saber);
    expect(force.canEquip(saber).ok).toBe(false);
    const before = force.ownStats().atp;
    force.spendMag('pow', 11);
    expect(force.ownStats().atp).toBe(before + 33);
    expect(force.canEquip(saber).ok).toBe(false);
    force.data.level = 12;
    expect(force.canEquip(saber).ok).toBe(true);
  });
});

describe('Mag evolution', () => {
  it('takes its first form from the class and later forms from the leading stat', () => {
    const m = newMag();
    expect(magForm(m, 'mind').stage).toBe(0);
    m.pow = 5;
    expect(magForm(m, 'mind')).toMatchObject({ stage: 1, name: 'Vritra', lead: 'pow', theme: 'mind' });
    m.mind = 12;
    expect(magForm(m, 'pow')).toMatchObject({ stage: 2, lead: 'mind', theme: 'mind' });
    m.dex = 20;
    expect(magForm(m, 'mind')).toMatchObject({ stage: 3, lead: 'dex' });
    m.def = 10;
    expect(magForm(m, 'pow')).toMatchObject({ stage: 4, name: 'Ashvinau' });
  });

  it('breaks ties toward the class stat', () => {
    expect(magForm({ pow: 10, dex: 10, mind: 0, def: 0 }, 'dex').lead).toBe('dex');
  });
});
