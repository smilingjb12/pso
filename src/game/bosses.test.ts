import { describe, expect, it } from 'vitest';
import { Character, migrateBossKills, type CharacterData } from './character';
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
    expect(Object.keys(areas).filter((a) => areas[a as keyof typeof areas].boss)).toHaveLength(BOSS_IDS.length);
  });

  it('old saves move their per-boss kill fields into bossKills', () => {
    const stats = { kills: 9, deaths: 1, playSeconds: 5, dragonKills: 3, deRolLeKills: 1, falzKills: 0 } as unknown as CharacterData['stats'];
    migrateBossKills(stats);
    expect(stats.bossKills).toEqual({ dragon: 3, derolle: 1, falz: 0 });
    expect('dragonKills' in stats).toBe(false);
    migrateBossKills(stats);
    expect(stats.bossKills.dragon).toBe(3);
  });

  it('counts kills per difficulty', () => {
    const ch = Character.create('T', 'mystic');
    expect(ch.addBossKill('warden', false)).toBe(1);
    expect(ch.addBossKill('warden', true)).toBe(1);
    expect(ch.addBossKill('warden', true)).toBe(2);
    expect(ch.bossKills('warden', false)).toBe(1);
    expect(ch.bossKills('falz', true)).toBe(0);
  });
});
