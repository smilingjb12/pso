import { describe, expect, it } from 'vitest';
import { Character, makeItem } from './character';
import { Combo, hastened } from './combo';
import { attackTypes, combo as comboCfg, enemies, hard, hasteCfg, hell } from './config';
import { expeditions, type ExpeditionId } from './data/areas';
import { getDef } from './data/items';
import { hardArch, hardBoss } from './hard';
import { rollArmor, rollBossDrops, rollHaste, rollWeapon, shopTier } from './loot';
import { TIER_STAGE } from './models/heroine';
import { hellOpen, nightmareOpen, openDifficulties } from '../ui/title';
import { mulberry32 } from './world/Level';

const EXPS = Object.keys(expeditions) as ExpeditionId[];

describe('Hell scaling', () => {
  it('makes every Hell expedition tougher than the same Nightmare one, and the next Hell one tougher still', () => {
    const b = enemies.Booma;
    for (const e of EXPS) {
      const nm = hardArch(b, hard[e]);
      const h = hardArch(b, hell[e]);
      expect(h.hp).toBeGreaterThan(nm.hp);
      expect(h.atp).toBeGreaterThan(nm.atp);
      expect(h.dropTier).toBe(hard[e].dropTier + 4);
    }
    // More elites than Nightmare, ramping up through the expeditions.
    expect(hell.forest.elite!).toBeGreaterThan(hard.eliteChance);
    for (let i = 1; i < EXPS.length; i++) expect(hell[EXPS[i]].elite!).toBeGreaterThan(hell[EXPS[i - 1]].elite!);
  });

  it('gives Hell bosses their third phase flag (Nightmare bosses none)', () => {
    for (const id of ['dragon', 'derolle', 'warden', 'falz'] as const) {
      expect(hardBoss(id, true).hell).toBe(true);
      expect(hardBoss(id).hell).toBeFalsy();
      expect(hardBoss(id, true).hp).toBeGreaterThan(hardBoss(id).hp);
    }
  });
});

describe('Hell unlocks and loot', () => {
  it('opens Hell once Dark Falz falls on Nightmare, and counts Hell kills apart', () => {
    const ch = Character.create('T', 'vanguard');
    expect(openDifficulties(ch.data)).toEqual(['normal']);
    ch.addBossKill('falz', 'normal');
    expect(nightmareOpen(ch.data)).toBe(true);
    expect(hellOpen(ch.data)).toBe(false);
    ch.addBossKill('falz', 'nightmare');
    expect(openDifficulties(ch.data)).toEqual(['normal', 'nightmare', 'hell']);
    expect(ch.addBossKill('dragon', 'hell')).toBe(1);
    expect(ch.bossKills('dragon', 'hell')).toBe(1);
    expect(ch.bossKills('dragon', 'nightmare')).toBe(0);
  });

  it('opens shop tiers 12-15 after the Hell bosses, at the band tops', () => {
    const all = { dragon: true, derolle: true, warden: true, falz: true };
    const u = { ...all, hard: all, hell: { dragon: true } };
    expect(shopTier(91, u)).toBe(11);
    expect(shopTier(92, u)).toBe(12);
    expect(shopTier(130, { ...u, hell: all })).toBe(15);
  });

  it('drops the expedition top tier from Hell bosses', () => {
    const rng = mulberry32(5);
    const tiers = rollBossDrops('falz', 'hell', rng, 'atp').flatMap((d) => (d.kind === 'item' ? [getDef(d.item.id)] : []));
    expect(tiers.some((d) => (d.type === 'weapon' || d.type === 'armor') && d.tier === 15)).toBe(true);
  });

  it('dresses Hell frames in armour stage 5', () => {
    for (let t = 12; t <= 15; t++) expect(TIER_STAGE[t]).toBe(5);
    expect(TIER_STAGE[11]).toBe(4);
  });
});

describe('Haste', () => {
  it('rolls only on tier 11+ gear, up to the tier cap', () => {
    const rng = mulberry32(3);
    for (let i = 0; i < 200; i++) {
      expect(rollWeapon(10, rng).haste).toBeUndefined();
      const w = rollWeapon(15, rng);
      if (w.haste !== undefined) expect(w.haste).toBeGreaterThanOrEqual(1);
      expect(w.haste ?? 0).toBeLessThanOrEqual(hasteCfg.capByTier[15]);
      expect(rollArmor(11, rng).haste ?? 0).toBeLessThanOrEqual(hasteCfg.capByTier[11]);
    }
    const seen = new Set<number>();
    for (let i = 0; i < 400; i++) seen.add(rollHaste(makeItem('frame_guard_13'), 13, rng).haste ?? 0);
    expect(Math.max(...seen)).toBe(hasteCfg.capByTier[13]);
  });

  it('adds up across weapon, frame and barrier and shortens wind-ups and recoveries (not the chain grace)', () => {
    const ch = Character.create('T', 'vanguard');
    const w = ch.data.inventory.find((i) => i.uid === ch.data.equipped.weapon)!;
    w.haste = 10;
    const f = ch.data.inventory.find((i) => i.uid === ch.data.equipped.frame)!;
    f.haste = 15;
    expect(ch.haste()).toBe(25);
    expect(ch.hasteMult()).toBeCloseTo(0.8);
    const base = ch.weaponKind().timing;
    const fast = hastened(base, ch.hasteMult());
    expect(fast.windup).toBeCloseTo(base.windup * 0.8);
    expect(fast.recovery).toBeCloseTo(base.recovery * 0.8);
    expect(fast.grace).toBe(base.grace);
    const slow = new Combo(comboCfg, attackTypes, () => base).computeTimes(0, 'light');
    const quick = new Combo(comboCfg, attackTypes, () => fast).computeTimes(0, 'light');
    expect(quick.duration).toBeLessThan(slow.duration);
    expect(quick.windowCloseAt - quick.duration).toBeCloseTo(slow.windowCloseAt - slow.duration);
  });
});
