import { describe, expect, it } from 'vitest';
import { Character } from './character';
import { areas, bossOf, expeditionOf, expeditionOfBoss, expeditionOpenedBy, expeditions } from './data/areas';
import { BOSS_IDS } from './data/bosses';

describe('boss registry', () => {
  it('every boss guards exactly one expedition, and each expedition but the first is opened by one', () => {
    for (const id of BOSS_IDS) expect(bossOf(expeditionOfBoss(id))).toBe(id);
    for (const exp of Object.values(expeditions)) {
      if (exp.needs) expect(expeditionOpenedBy(exp.needs)?.id).toBe(exp.id);
      for (const floor of exp.floors) expect(expeditionOf(floor)).toBe(exp.id);
    }
    expect(expeditionOf('city')).toBeNull();
    // The Falz Rifts' boss slot ('riftBoss') is filled at runtime with one of these arenas.
    expect(Object.keys(areas).filter((a) => a !== 'riftBoss' && areas[a as keyof typeof areas].boss)).toHaveLength(BOSS_IDS.length);
  });

  it('counts kills per difficulty', () => {
    const ch = Character.create('T');
    expect(ch.addBossKill('warden', false)).toBe(1);
    expect(ch.addBossKill('warden', true)).toBe(1);
    expect(ch.addBossKill('warden', true)).toBe(2);
    expect(ch.bossKills('warden', false)).toBe(1);
    expect(ch.bossKills('falz', true)).toBe(0);
  });
});
