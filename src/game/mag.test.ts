import { describe, expect, it } from 'vitest';
import { Character, makeItem } from './character';
import { magCfg } from './config';
import {
  cellBlocked, connected, hasPassive, learnCells, MAG_CELLS, MAG_GRID, magBonuses, magForm, magLevel, magPointsFree, migrateMag, newMag, respecCost,
  type MagStat,
} from './mag';

const statCells = (arm: MagStat) => MAG_GRID.filter((c) => c.kind === 'stat' && c.stats[0] === arm);

describe('Mag grid', () => {
  it('is a diamond of four arms with diagonal hybrids', () => {
    expect(MAG_GRID.length).toBe(61);
    const count = (kind: string) => MAG_GRID.filter((c) => c.kind === kind).length;
    expect(count('core')).toBe(1);
    expect(count('notable')).toBe(4);
    expect(count('keystone')).toBe(4);
    expect(count('hybrid')).toBe(8);
    for (const arm of ['def', 'pow', 'dex', 'mind'] as MagStat[]) expect(statCells(arm).length).toBe(11);
    expect(MAG_CELLS['0,-3'].passive).toBe('followThrough'); // POW is up
    expect(MAG_CELLS['5,0'].passive).toBe('deadeye'); // DEX keystone at the right tip
    expect(MAG_CELLS['1,1'].stats).toEqual(['mind', 'dex']);
  });

  it('earns one point per character level', () => {
    const m = newMag();
    expect(magPointsFree(m, 1)).toBe(1);
    expect(magPointsFree(m, 12)).toBe(12);
    m.cells = ['0,-1'];
    expect(magPointsFree(m, 12)).toBe(11);
  });

  it('only learns squares next to one it knows, all or nothing', () => {
    const m = newMag();
    expect(learnCells(m, 10, ['0,-2'])).toMatch(/next to/);
    expect(learnCells(m, 10, ['0,-1', '0,-2', '5,5'])).not.toBeNull(); // the last one isn't a square
    expect(m.cells).toEqual([]);
    expect(learnCells(m, 10, ['0,-1', '0,-2', '1,-2'])).toBeNull();
    expect(m.cells).toEqual(['0,-1', '0,-2', '1,-2']);
    expect(learnCells(m, 3, ['-1,0'])).toMatch(/points/);
  });

  it('gates keystones behind squares already learned', () => {
    const path = ['0,-1', '0,-2', '0,-3', '0,-4'];
    expect(cellBlocked(path, '0,-5')).toMatch(/Keystones need/);
    const more = [...path, ...statCells('dex').slice(0, magCfg.keystoneMinSpent - path.length).map((c) => c.id)];
    expect(cellBlocked(more, '0,-5')).toBeNull();
  });

  it('drops planned squares cut off from the core', () => {
    expect(connected(['0,-1'], ['0,-2', '0,-3'])).toEqual(['0,-2', '0,-3']);
    expect(connected(['0,-1'], ['0,-3'])).toEqual([]);
  });

  it('adds stat squares, half of each on hybrids, and passives', () => {
    const m = newMag();
    m.cells = ['0,-1', '0,-2', '1,0', '1,-1', '0,-3'];
    expect(magBonuses(m)).toEqual({ atp: 3 + 3 + 2, ata: 2 + 1 });
    expect(hasPassive(m, 'followThrough')).toBe(true);
    expect(hasPassive(m, 'crush')).toBe(false);
  });

  it('evolves by squares learned, shaped by the leading arm', () => {
    const m = newMag();
    expect(magForm(m, 'force').stage).toBe(0);
    m.cells = statCells('pow').slice(0, 5).map((c) => c.id);
    // Stage 1 wears the class's gear whatever the build; later stages follow the lead arm.
    expect(magForm(m, 'force')).toMatchObject({ name: 'Vritra', lead: 'pow', theme: 'mind' });
    m.cells = [...statCells('mind').slice(0, 8), ...statCells('pow').slice(0, 7)].map((c) => c.id);
    expect(magForm(m, 'hunter')).toMatchObject({ stage: 2, lead: 'mind', theme: 'mind' });
    m.cells = [...statCells('mind').slice(0, 8), ...statCells('pow').slice(0, 8), ...statCells('dex').slice(0, 9)].map((c) => c.id);
    expect(magForm(m, 'force')).toMatchObject({ stage: 3, lead: 'dex' });
    // A tie (POW 9, DEX 9) goes to the class's own arm.
    m.cells = [...statCells('mind').slice(0, 8), ...statCells('pow').slice(0, 9), ...statCells('dex').slice(0, 9)].map((c) => c.id);
    expect(magForm(m, 'ranger').lead).toBe('dex');
    m.cells = MAG_GRID.filter((c) => c.kind !== 'core').slice(0, 40).map((c) => c.id);
    expect(magForm(m, 'hunter')).toMatchObject({ stage: 4, name: 'Ashvinau' });
  });

  it('counts toward weapon requirements and total stats', () => {
    const ch = Character.create('T', 'force');
    const rod = makeItem('rod_2'); // MST 80
    ch.addItem(rod);
    expect(ch.canEquip(rod).ok).toBe(false);
    ch.mag.cells = statCells('mind').slice(0, 7).map((c) => c.id); // +21 MST
    expect(ch.canEquip(rod).ok).toBe(true);
    expect(ch.stats().mst).toBe(ch.baseStats().mst + 21 + (ch.weaponDef().mst ?? 0));
  });

  it('respecs for free at low level, then for Meseta', () => {
    const m = newMag();
    m.cells = ['0,-1', '0,-2'];
    expect(respecCost(m, magCfg.freeRespecBelow - 1)).toBe(0);
    expect(respecCost(m, magCfg.freeRespecBelow)).toBe(2 * magCfg.respecCostPerPoint);
  });

  it('gives old saves (no Mag, or the old fed Mag) a fresh grid', () => {
    const data = Character.create('T', 'ranger').data;
    delete data.mag;
    expect(magLevel(new Character(data).mag)).toBe(0);
    const old = { levels: { def: 3, pow: 10, dex: 0, mind: 0 }, progress: { def: 0, pow: 0, dex: 0, mind: 0 }, feeds: 2, kills: 4 };
    expect(migrateMag(old)).toEqual({ cells: [] });
    expect(migrateMag({ cells: ['0,-1', 'bogus', '0,0'] })).toEqual({ cells: ['0,-1'] });
  });
});
