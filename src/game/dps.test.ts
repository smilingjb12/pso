import { describe, expect, it } from 'vitest';
import { Character, makeItem, simulateEquip } from './character';
import { estimateDamage, expeditionFoe } from './dps';

const force = () => {
  const ch = Character.create('T', 'mystic');
  ch.addXp(1e6);
  return ch;
};

describe('damage estimates', () => {
  it('measures against the expedition average, tougher on Nightmare', () => {
    const forest = expeditionFoe('forest', false);
    expect(forest.label).toBe('Forest');
    expect(forest.dfp).toBeGreaterThan(0);
    expect(expeditionFoe('mines', false).dfp).toBeGreaterThan(forest.dfp);
    const hard = expeditionFoe('forest', true);
    expect(hard.label).toBe('Forest (Nightmare)');
    expect(hard.dfp).toBeGreaterThan(forest.dfp);
  });

  it('race % multiplies spell damage exactly and weapon damage roughly', () => {
    const ch = force();
    const rod = makeItem('rod_5', { attrs: { abeast: 40 } });
    const e = estimateDamage(simulateEquip(ch, rod, 'weapon'), expeditionFoe('caves', false), true);
    expect(e.spell!.abeast / e.spell!.native).toBeCloseTo(1.4);
    expect(e.spell!.machine).toBeCloseTo(e.spell!.native);
    // Weapon hits apply race % before DFP, so the gain is a bit over 40%.
    expect(e.weapon.abeast / e.weapon.native).toBeGreaterThan(1.4);
  });

  it('more MST means more spell damage; only casters get the spell column', () => {
    const ch = force();
    const foe = expeditionFoe('forest', false);
    const low = estimateDamage(simulateEquip(ch, makeItem('rod_2'), 'weapon'), foe, true);
    const high = estimateDamage(simulateEquip(ch, makeItem('rod_6'), 'weapon'), foe, true);
    expect(high.spell!.native).toBeGreaterThan(low.spell!.native);
    expect(high.weapon.native).toBeGreaterThan(low.weapon.native);
    expect(estimateDamage(Character.create('H', 'vanguard'), foe, false).spell).toBeNull();
  });
});
