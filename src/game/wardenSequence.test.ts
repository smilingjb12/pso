import { describe, expect, it } from 'vitest';
import { dash, player, warden } from './config';
import { beatGap, cellSteps, planSequence } from './enemies/wardenSequence';
import { mulberry32 } from './world/Level';

// The Warden's hall: a 7 x 6 deck of 4 m cells (row 0 against the alcove).
const COLS = 7;
const ROWS = 6;
const CELLS = COLS * ROWS;

describe('Warden sequence (Hell)', () => {
  it('lights different cells, the first on or next to yours and each next one beside the one before', () => {
    const rng = mulberry32(11);
    for (let roll = 0; roll < 2000; roll++) {
      const here = Math.floor(rng() * CELLS);
      // A few burning cells, and the three in front of the core, as in the fight.
      const blocked = new Set([2, 3, 4]);
      for (let k = 0; k < 5; k++) blocked.add(Math.floor(rng() * CELLS));
      const seq = planSequence(COLS, ROWS, here, (i) => !blocked.has(i), rng, warden.seqCells);
      if (!seq) continue;
      expect(seq).toHaveLength(warden.seqCells);
      expect(new Set(seq).size).toBe(seq.length);
      for (const i of seq) {
        expect(Number.isInteger(i) && i >= 0 && i < CELLS).toBe(true);
        expect(blocked.has(i)).toBe(false);
      }
      expect(cellSteps(seq[0], here, COLS)).toBeLessThanOrEqual(1);
      for (let k = 1; k < seq.length; k++) expect(cellSteps(seq[k], seq[k - 1], COLS)).toBe(1);
    }
  });

  it('never steps off the deck from an edge or corner, and starts anywhere around you', () => {
    const rng = mulberry32(3);
    // Corner (0, 0): only it and its three neighbours can open the sequence.
    const firsts = new Set<number>();
    for (let roll = 0; roll < 300; roll++) {
      const seq = planSequence(COLS, ROWS, 0, () => true, rng)!;
      firsts.add(seq[0]);
      for (const i of seq) expect(i >= 0 && i < CELLS && i % COLS <= 3 && Math.floor(i / COLS) <= 3).toBe(true);
    }
    expect([...firsts].sort((a, b) => a - b)).toEqual([0, 1, COLS, COLS + 1]);
    // In the middle all nine cells around (and under) you come up.
    const mid = 3 * COLS + 3;
    const around = new Set<number>();
    for (let roll = 0; roll < 600; roll++) around.add(planSequence(COLS, ROWS, mid, () => true, rng)![0]);
    expect(around.size).toBe(9);
  });

  it('keeps to the rows nearest the Warden, its first cell in reach from anywhere on the deck', () => {
    const rng = mulberry32(17);
    // The fight's rule: the first seqRows rows, not the three cells in front of the core.
    const ok = (i: number) => Math.floor(i / COLS) < warden.seqRows && ![2, 3, 4].includes(i);
    for (let here = 0; here < CELLS; here++) {
      for (let roll = 0; roll < 20; roll++) {
        const seq = planSequence(COLS, ROWS, here, ok, rng, warden.seqCells, warden.seqFirstReach);
        expect(seq).not.toBeNull();
        for (const i of seq!) expect(ok(i)).toBe(true);
        expect(cellSteps(seq![0], here, COLS)).toBeLessThanOrEqual(warden.seqFirstReach);
        for (let k = 1; k < seq!.length; k++) expect(cellSteps(seq![k], seq![k - 1], COLS)).toBe(1);
      }
    }
  });

  it('gives up when no sequence fits (it attacks normally instead)', () => {
    const rng = mulberry32(5);
    const here = 2 * COLS + 2;
    // Only your cell and one neighbour are free: no room for a third.
    expect(planSequence(COLS, ROWS, here, (i) => i === here || i === here + 1, rng)).toBeNull();
    // A free line of three starting on you: the only way is along it.
    const line = [here, here + 1, here + 2];
    expect(planSequence(COLS, ROWS, here, (i) => line.includes(i), rng)).toEqual(line);
  });

  it('leaves time to reach a diagonal neighbour from a cell\'s far corner: walking at Hell tempo, walk + dash at rift tempo', () => {
    // From a corner of one cell to 0.5 m inside its diagonal neighbour: 6.36 m.
    const worst = Math.SQRT2 * (warden.cell + 0.5);
    const react = 0.35;
    const dashGain = dash.distance - player.moveSpeed * dash.duration;
    const real = (tempo: number) => beatGap(warden.seqBeat, warden.seqBeatFloor, tempo) / tempo;
    expect(real(1)).toBeCloseTo(warden.seqBeat);
    expect(player.moveSpeed * (real(1) - react)).toBeGreaterThanOrEqual(worst);
    for (let tempo = 1; tempo <= 1.6; tempo += 0.05) {
      expect(real(tempo)).toBeGreaterThanOrEqual(warden.seqBeatFloor - 1e-9);
      expect(player.moveSpeed * (real(tempo) - react) + dashGain).toBeGreaterThanOrEqual(worst);
    }
    // From the middle of a cell walking alone still makes it at the floor.
    expect(player.moveSpeed * (warden.seqBeatFloor - react)).toBeGreaterThanOrEqual(Math.SQRT2 * (warden.cell / 2 + 0.5));
  });
});
