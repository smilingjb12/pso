import { describe, expect, it } from 'vitest';
import { Character } from './character';

describe('Palette', () => {
  it('new characters get a weapon row and a magic row', () => {
    const h = Character.create('H', 'vanguard');
    expect(h.data.palette.map((r) => r.mouse)).toEqual(['weapon', 'magic']);
    const f = Character.create('F', 'mystic');
    expect(f.data.palette.map((r) => r.mouse)).toEqual(['magic', 'weapon']);
    expect(f.data.palette[0].quick[0]).toEqual({ kind: 'tech', tech: 'resta' });
  });

  it('the mouse wheel cycles every attack technique, for every kit', () => {
    for (const cls of ['mystic', 'vanguard'] as const) {
      const ch = Character.create('T', cls);
      expect(ch.selectedTech()).toBe('foie');
      expect(ch.cycleTech(1)).toBe('zonde');
      expect(ch.cycleTech(1)).toBe('barta');
      expect(ch.cycleTech(1)).toBe('foie');
      expect(ch.cycleTech(-1)).toBe('barta');
    }
  });
});
