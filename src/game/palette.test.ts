import { describe, expect, it } from 'vitest';
import { Character, type CharacterData } from './character';

describe('Palette', () => {
  it('new characters get a weapon row and a magic row', () => {
    const h = Character.create('H', 'hunter');
    expect(h.data.palette.map((r) => r.mouse)).toEqual(['weapon', 'magic']);
    const f = Character.create('F', 'force');
    expect(f.data.palette.map((r) => r.mouse)).toEqual(['magic', 'weapon']);
    expect(f.data.palette[0].quick[0]).toEqual({ kind: 'tech', tech: 'resta' });
  });

  it('migrates old three-slot palettes: items and support techs move to quick slots', () => {
    const data = JSON.parse(JSON.stringify(Character.create('F', 'force').data)) as CharacterData;
    (data as unknown as { palette: unknown }).palette = [
      [{ kind: 'attack', type: 'normal' }, { kind: 'tech', tech: 'foie' }, { kind: 'tech', tech: 'resta' }],
      [{ kind: 'item', item: 'monomate' }, { kind: 'item', item: 'monofluid' }, { kind: 'attack', type: 'heavy' }],
    ];
    const ch = new Character(data);
    // Old mates and fluids point at the Mate (slot 1) and Fluid (slot 2) injectors.
    expect(ch.data.palette).toEqual([
      { mouse: 'magic', quick: [{ kind: 'tech', tech: 'resta' }, { kind: 'injector', slot: 0 }] },
      { mouse: 'weapon', quick: [{ kind: 'injector', slot: 1 }, { kind: 'empty' }] },
    ]);
    expect(ch.selectedTech()).toBe('foie');
  });

  it('the mouse wheel cycles every attack technique, for every class', () => {
    for (const cls of ['force', 'hunter'] as const) {
      const ch = Character.create('T', cls);
      expect(ch.selectedTech()).toBe('foie');
      expect(ch.cycleTech(1)).toBe('zonde');
      expect(ch.cycleTech(1)).toBe('barta');
      expect(ch.cycleTech(1)).toBe('foie');
      expect(ch.cycleTech(-1)).toBe('barta');
    }
  });
});
