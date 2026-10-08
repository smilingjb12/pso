import { describe, expect, it } from 'vitest';
import { Character, makeItem } from './character';
import { magCfg } from './config';
import { noAttributes } from './data/stats';
import {
  armSquares, cellBlocked, hasPassive, learnCells, MAG_CELLS, MAG_GRID, magBonuses, magForm, magPointsFree, newMag, readMag, reqText,
  type MagStat,
} from './mag';

const statCells = (arm: MagStat) => MAG_GRID.filter((c) => c.kind === 'stat' && c.stats[0] === arm);
const points = (p: Partial<ReturnType<typeof noAttributes>> = {}) => ({ ...noAttributes(), ...p });
/** The squares straight out along an arm, up to `n` from the core. */
const axis = (dx: number, dy: number, n: number) => Array.from({ length: n }, (_, i) => `${dx * (i + 1)},${dy * (i + 1)}`);

describe('Mag grid', () => {
  it('is a radius-7 diamond: four arms of 25 squares, and diagonals with a two-arm notable each', () => {
    expect(MAG_GRID.length).toBe(113);
    const count = (kind: string) => MAG_GRID.filter((c) => c.kind === kind).length;
    expect(count('core')).toBe(1);
    expect(count('notable')).toBe(8);
    expect(count('keystone')).toBe(8);
    expect(count('hybrid')).toBe(8);
    for (const arm of ['def', 'pow', 'dex', 'mind'] as MagStat[]) expect(statCells(arm).length).toBe(22);
    // POW is up: notable, then keystone I and II further out.
    expect(MAG_CELLS['0,-3'].passive).toBe('followThrough');
    expect(MAG_CELLS['0,-5']).toMatchObject({ passive: 'breaker', kind: 'keystone', tier: 1 });
    expect(MAG_CELLS['0,-7']).toMatchObject({ passive: 'crush', kind: 'keystone', tier: 2 });
    expect(MAG_CELLS['3,0'].passive).toBe('fleet');
    expect(MAG_CELLS['5,0'].passive).toBe('deadeye');
    expect(MAG_CELLS['7,0'].passive).toBe('rhythm');
    expect(MAG_CELLS['0,5'].passive).toBe('clarity');
    expect(MAG_CELLS['0,7'].passive).toBe('swiftCast');
    expect(MAG_CELLS['-7,0'].passive).toBe('lastStand');
    expect(MAG_CELLS['3,-3']).toMatchObject({ passive: 'slipstream', stats: ['pow', 'dex'] });
    expect(MAG_CELLS['-3,3']).toMatchObject({ passive: 'barrier', stats: ['mind', 'def'] });
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
    expect(learnCells(m, 10, points(), ['0,-2'])).toMatch(/next to/);
    expect(learnCells(m, 10, points(), ['0,-1', '0,-2', '7,7'])).not.toBeNull(); // the last one isn't a square
    expect(m.cells).toEqual([]);
    expect(learnCells(m, 10, points(), ['0,-1', '0,-2', '1,-2'])).toBeNull();
    expect(m.cells).toEqual(['0,-1', '0,-2', '1,-2']);
    expect(learnCells(m, 3, points(), ['-1,0'])).toMatch(/points/);
  });

  it('gates keystones behind squares of their colour and points in their attribute', () => {
    const [k1, k2] = magCfg.keystoneReq;
    const path = axis(0, 1, 4); // MIND, up to Clarity
    expect(cellBlocked(path, '0,5', points({ mind: 999 }))).toMatch(new RegExp(`Needs ${k1.squares} MIND squares`));
    const more = [...path, ...statCells('mind').filter((c) => !path.includes(c.id)).slice(0, k1.squares - path.length).map((c) => c.id)];
    expect(armSquares(more, 'mind')).toBe(k1.squares);
    expect(cellBlocked(more, '0,5', points({ mind: k1.points - 1 }))).toMatch(new RegExp(`Needs MIND ${k1.points}`));
    expect(cellBlocked(more, '0,5', points({ mind: k1.points }))).toBeNull();
    // Points elsewhere don't count.
    expect(cellBlocked(more, '0,5', points({ pow: 200 }))).toMatch(/MIND/);
    // The tip needs more of both.
    const tip = [...more, '0,5', '0,6'];
    expect(cellBlocked(tip, '0,7', points({ mind: k1.points }))).not.toBeNull();
    const full = [...tip, ...statCells('mind').filter((c) => !tip.includes(c.id)).slice(0, k2.squares).map((c) => c.id)];
    expect(cellBlocked(full, '0,7', points({ mind: k2.points }))).toBeNull();
    expect(reqText(MAG_CELLS['0,7'])).toBe(`${k2.squares} MIND squares · MIND ${k2.points}`);
  });

  it('gates the two-arm notables behind points in both attributes', () => {
    const owned = ['0,1', '0,2', '0,3', '-1,3', '-2,3'];
    const n = magCfg.hybridReqPoints;
    expect(cellBlocked(owned, '-3,3', points({ mind: n }))).toMatch(/DEF/);
    expect(cellBlocked(owned, '-3,3', points({ mind: n, def: n }))).toBeNull();
    // Notables on an arm need nothing but a neighbour.
    expect(cellBlocked(['0,1', '0,2'], '0,3', points())).toBeNull();
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
    expect(magForm(m, 'mind').stage).toBe(0);
    m.cells = statCells('pow').slice(0, 5).map((c) => c.id);
    // Stage 1 follows the character's leading attribute whatever the build; later stages follow the lead arm.
    expect(magForm(m, 'mind')).toMatchObject({ name: 'Vritra', lead: 'pow', theme: 'mind' });
    expect(magForm(m, 'def')).toMatchObject({ name: 'Bhima', theme: 'def' });
    m.cells = [...statCells('mind').slice(0, 8), ...statCells('pow').slice(0, 7)].map((c) => c.id);
    expect(magForm(m, 'pow')).toMatchObject({ stage: 2, lead: 'mind', theme: 'mind' });
    m.cells = [...statCells('mind').slice(0, 8), ...statCells('pow').slice(0, 8), ...statCells('dex').slice(0, 9)].map((c) => c.id);
    expect(magForm(m, 'mind')).toMatchObject({ stage: 3, lead: 'dex' });
    // A tie (POW 9, DEX 9) goes to the character's own attribute.
    m.cells = [...statCells('mind').slice(0, 8), ...statCells('pow').slice(0, 9), ...statCells('dex').slice(0, 9)].map((c) => c.id);
    expect(magForm(m, 'dex').lead).toBe('dex');
    m.cells = MAG_GRID.filter((c) => c.kind !== 'core').slice(0, 40).map((c) => c.id);
    expect(magForm(m, 'pow')).toMatchObject({ stage: 4, name: 'Ashvinau' });
  });

  it('counts toward weapon requirements and total stats', () => {
    const ch = Character.create('T', 'mystic');
    const rod = makeItem('rod_2'); // MST 80
    ch.addItem(rod);
    expect(ch.canEquip(rod).ok).toBe(false);
    ch.mag.cells = statCells('mind').slice(0, 7).map((c) => c.id); // +21 MST
    expect(ch.canEquip(rod).ok).toBe(true);
    expect(ch.stats().mst).toBe(ch.baseStats().mst + 21 + (ch.weaponDef().bonus?.mst ?? 0));
  });

  it('reads stored Mags, dropping anything that is not a square', () => {
    expect(readMag(undefined)).toEqual({ cells: [] });
    expect(readMag({ cells: ['0,-1', 'bogus', '0,0', '7,0'] })).toEqual({ cells: ['0,-1', '7,0'] });
  });
});
