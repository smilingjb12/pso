import { describe, expect, it } from 'vitest';
import { Character } from './character';
import { passiveCfg } from './config';
import { needText, PASSIVES, weaponFits, type PassiveId } from './passives';
import { skillNodes } from './skills';

/** A character at `level`. */
function at(level: number): Character {
  const ch = Character.create('T');
  ch.data.level = level;
  return ch;
}

describe('passives (2026-10-14, replacing talents; Skills tree nodes since 2026-10-15)', () => {
  it('put every defined passive in the trees, once', () => {
    const ids = skillNodes().filter((n) => n.kind === 'passive').map((n) => n.id as PassiveId);
    expect(ids.length).toBeGreaterThanOrEqual(20);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(Object.keys(PASSIVES).sort());
    for (const id of ids) expect(PASSIVES[id].desc().length, id).toBeGreaterThan(10);
    // The general ones the user named stay, with the five kept from the Hunter and Ranger trees.
    for (const id of ['fleet', 'resonance', 'efficiency', 'overload', 'swiftCast', 'bloodlust', 'lightFeet', 'lastStand', 'bulwark', 'fieldMedic'] as const) {
      expect(ids).toContain(id);
    }
  });

  it('bolt passives only work with a rod or wand in hand', () => {
    expect(weaponFits('siphonStaff', true)).toBe(true);
    expect(weaponFits('siphonStaff', false)).toBe(false);
    expect(weaponFits('efficiency', false)).toBe(true);
    expect(needText('siphonStaff')).toBe('needs a rod or wand');
    expect(needText('fleet')).toBe('');
    const ch = at(60);
    ch.data.skills.ranks.siphonStaff = 5;
    expect(ch.hasPassive('siphonStaff')).toBe(true); // the start wand
    delete ch.data.equipped.weapon;
    expect(ch.passiveTaken('siphonStaff')).toBe(true);
    expect(ch.hasPassive('siphonStaff')).toBe(false);
    expect(ch.passiveK('siphonStaff')).toBe(0);
  });

  it('Swift Cast speeds up casts (on top of Haste)', () => {
    const f = at(80);
    const cast = f.castTimeMult();
    f.data.skills.ranks.swiftCast = 5;
    expect(f.castTimeMult()).toBeCloseTo(cast * passiveCfg.swiftCastMult);
  });

  it('Efficiency makes attack techniques cheaper, whatever is in hand', () => {
    const ch = at(46);
    ch.data.equipped.weapon = undefined;
    const plain = ch.techCost('foie');
    ch.data.skills.ranks.efficiency = 5;
    expect(ch.techCost('foie')).toBeLessThan(plain);
  });

  it('old saves lose their talent picks but keep a picked photon blast', () => {
    const data = at(90).data as unknown as Record<string, unknown>;
    data.talents = ['hotStreak', null, null, null, null, null, null, null, null, 'pbLeilla'];
    data.palette = [{ mouse: 'weapon', quick: [{ kind: 'empty' }, { kind: 'empty' }] }];
    data.selectedTech = 'zonde';
    const ch = new Character(JSON.parse(JSON.stringify(data)));
    expect(ch.data.talents).toBeUndefined();
    expect(ch.data.palette).toBeUndefined();
    expect(ch.data.photonBlast).toBe('leilla');
    expect(ch.photonBlast).toBe('leilla');
    expect(ch.data.skills.ranks).toEqual({ foie: 1 }); // learned at creation
  });
});
