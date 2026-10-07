import { describe, expect, it } from 'vitest';
import { chord, melody, note, progression, voicing } from './music/theory';
import { TRACKS } from './music/tracks';

describe('music theory helpers', () => {
  it('parses notes and chords', () => {
    expect(note('C4')).toBe(60);
    expect(note('F#3')).toBe(54);
    expect(note('Bb2')).toBe(46);
    expect(chord('D/F#')).toEqual({ root: 2, bass: 6, iv: [0, 4, 7] });
    expect(voicing(chord('Cmaj7'), 60)).toEqual([60, 64, 67, 71]);
  });

  it('reads melody strings (holds, rests, accents)', () => {
    const m = melody('C5 - - . E5! -', 2, 0.5);
    expect(m).toEqual([
      { s: 0, n: 72, l: 6, v: 0.5 },
      { s: 8, n: 76, l: 4, v: 0.625 },
    ]);
  });

  it('splits two-chord bars in half', () => {
    const p = progression(['Em7 A7']);
    expect(p.map((x) => [x.s, x.l])).toEqual([[0, 8], [8, 8]]);
  });
});

describe('tracks', () => {
  for (const t of Object.values(TRACKS)) {
    it(`${t.name}: melodies fill the loop and notes stay in range`, () => {
      const loop = t.bars * 16;
      for (const part of t.parts) {
        for (const e of part.notes) {
          expect(e.s).toBeGreaterThanOrEqual(0);
          expect(e.s).toBeLessThan(loop);
          expect(e.n).toBeGreaterThanOrEqual(24);
          expect(e.n).toBeLessThanOrEqual(100);
        }
      }
      // Every written melody is exactly the loop length (no drift between parts).
      const lead = t.parts.find((p) => ['flute', 'vibes', 'bell', 'brass', 'lead'].includes(p.inst) && p.notes.length > 20)!;
      const end = Math.max(...lead.notes.map((e) => e.s + e.l));
      expect(end).toBeLessThanOrEqual(loop);
      expect(end).toBeGreaterThan(loop - 16);
    });
  }
});
