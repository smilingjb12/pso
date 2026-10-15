import { describe, expect, it } from 'vitest';
import { Character, makeItem } from './character';
import { passiveCfg } from './config';
import { CLASS_IDS } from './data/stats';
import { PASSIVES, type PassiveId } from './passives';
import { skillNodes } from './skills';

/** A character of `cls` at `level`. */
function at(cls: 'hunter' | 'ranger' | 'force', level: number): Character {
  const ch = Character.create('T', cls);
  ch.data.level = level;
  return ch;
}

describe('passives (2026-10-14, replacing talents; Skills tree nodes since 2026-10-15)', () => {
  it('give every class a set of defined passives in its tree', () => {
    for (const cls of CLASS_IDS) {
      const ids = skillNodes(cls).filter((n) => n.kind === 'passive').map((n) => n.id as PassiveId);
      expect(ids.length).toBeGreaterThanOrEqual(20);
      expect(new Set(ids).size).toBe(ids.length);
      for (const id of ids) {
        expect(PASSIVES[id], id).toBeDefined();
        expect(PASSIVES[id].desc().length).toBeGreaterThan(10);
      }
      // The general ones the user named stay: Fleet everywhere, Resonance / Efficiency / Overload / Swift Cast for Forces.
      expect(ids).toContain('fleet');
    }
    const force = skillNodes('force').map((n) => n.id);
    for (const id of ['resonance', 'efficiency', 'overload', 'swiftCast'] as const) expect(force).toContain(id);
  });

  it('weapon passives only work with their family in hand', () => {
    const ch = at('hunter', 60);
    ch.data.skills.ranks.cleave = 5;
    expect(ch.hasPassive('cleave')).toBe(true);
    const gun = makeItem('handgun_1');
    ch.data.inventory.push(gun);
    ch.data.equipped.weapon = gun.uid;
    expect(ch.passiveTaken('cleave')).toBe(true);
    expect(ch.hasPassive('cleave')).toBe(false);
  });

  it('the weight passives need their own kind of blade', () => {
    const ch = at('hunter', 60);
    ch.data.skills.ranks.crush = 5;
    expect(ch.hasPassive('crush')).toBe(false); // a saber in hand
    const sword = makeItem('sword_1');
    ch.data.inventory.push(sword);
    ch.data.equipped.weapon = sword.uid;
    expect(ch.hasPassive('crush')).toBe(true);
  });

  it('Fervor speeds up swings like Swift Cast does casts (on top of Haste)', () => {
    const h = at('hunter', 80);
    const base = h.swingTimeMult();
    h.data.skills.ranks.fervor = 5;
    expect(h.swingTimeMult()).toBeCloseTo(base * passiveCfg.swingSpeedMult);
    const f = at('force', 80);
    const cast = f.castTimeMult();
    f.data.skills.ranks.swiftCast = 5;
    expect(f.castTimeMult()).toBeCloseTo(cast * passiveCfg.swiftCastMult);
  });

  it('Efficiency makes attack techniques cheaper, whatever is in hand', () => {
    const ch = at('force', 46);
    ch.data.equipped.weapon = undefined;
    const plain = ch.techCost('foie');
    ch.data.skills.ranks.efficiency = 5;
    expect(ch.techCost('foie')).toBeLessThan(plain);
  });

  it('old saves lose their talent picks but keep a picked photon blast', () => {
    const data = at('ranger', 90).data as unknown as Record<string, unknown>;
    data.talents = ['hotStreak', null, null, null, null, null, null, null, null, 'pbLeilla'];
    data.palette = [{ mouse: 'weapon', quick: [{ kind: 'empty' }, { kind: 'empty' }] }];
    data.selectedTech = 'zonde';
    const ch = new Character(JSON.parse(JSON.stringify(data)));
    expect(ch.data.talents).toBeUndefined();
    expect(ch.data.palette).toBeUndefined();
    expect(ch.data.photonBlast).toBe('leilla');
    expect(ch.photonBlast).toBe('leilla');
    expect(ch.data.skills.ranks).toEqual({ rapidVolley: 1 }); // the start weapon's Art, learned at creation
  });
});
