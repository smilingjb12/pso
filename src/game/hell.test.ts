import { describe, expect, it } from 'vitest';
import { Character } from './character';
import { Combo, hastened } from './combo';
import { combo as comboCfg, enemies, hard, hasteCfg, hell } from './config';
import { expeditions, type ExpeditionId } from './data/areas';
import { ARTS } from './data/arts';
import { getDef } from './data/items';
import { cutMult } from './formulas';
import { hardArch, hardBoss } from './hard';
import { rollAffixValue, rollArmor, rollBossDrops, rollWeapon, shopTier } from './loot';
import { ITEM_AFFIXES } from './data/itemAffixes';
import type { ItemInstance } from './character';
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
    // At least Nightmare's elites, ramping up through the expeditions.
    expect(hell.forest.elite!).toBeGreaterThanOrEqual(hard.eliteChance);
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
    const ch = Character.create('T');
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
    expect(shopTier(86, u)).toBe(11);
    expect(shopTier(87, u)).toBe(12);
    expect(shopTier(100, { ...u, hell: all })).toBe(15);
  });

  it('drops the expedition top tier from Hell bosses', () => {
    const rng = mulberry32(5);
    const tiers = rollBossDrops('falz', 'hell', rng).flatMap((d) => (d.kind === 'item' ? [getDef(d.item.id)] : []));
    expect(tiers.some((d) => (d.type === 'weapon' || d.type === 'armor') && d.tier === 15)).toBe(true);
  });

  it('dresses Hell frames in armour stage 5', () => {
    for (let t = 12; t <= 15; t++) expect(TIER_STAGE[t]).toBe(5);
    expect(TIER_STAGE[11]).toBe(4);
  });
});

const haste = (it: ItemInstance) => (it.affixes ?? []).find((r) => r.id === 'haste')?.v;

describe('Haste', () => {
  it('rolls only on tier 8+ gear (Nightmare), up to the tier cap, Frail included', () => {
    const rng = mulberry32(3);
    for (let i = 0; i < 200; i++) {
      const normal = rollWeapon(7, rng, 'rare');
      expect(haste(normal)).toBeUndefined();
      expect((normal.affixes ?? []).some((r) => r.id === 'frail')).toBe(false);
      expect(haste(rollWeapon(8, rng, 'rare')) ?? 0).toBeLessThanOrEqual(hasteCfg.capByTier[8]);
      const w = rollWeapon(15, rng, 'rare');
      expect(haste(w) ?? 1).toBeGreaterThanOrEqual(1);
      expect(haste(w) ?? 0).toBeLessThanOrEqual(hasteCfg.capByTier[15]);
      expect(haste(rollArmor(11, rng, 'rare')) ?? 0).toBeLessThanOrEqual(hasteCfg.capByTier[11]);
    }
    const seen = new Set<number>();
    for (let i = 0; i < 400; i++) seen.add(rollAffixValue(ITEM_AFFIXES.haste, 13, rng).v);
    expect(Math.max(...seen)).toBe(hasteCfg.capByTier[13]);
  });

  it('adds up across weapon, frame and barrier and shortens wind-ups and recoveries (not the chain grace)', () => {
    const ch = Character.create('T');
    const w = ch.data.inventory.find((i) => i.uid === ch.data.equipped.weapon)!;
    w.affixes = [{ id: 'haste', v: 10 }];
    const f = ch.data.inventory.find((i) => i.uid === ch.data.equipped.frame)!;
    f.affixes = [{ id: 'haste', v: 10 }, { id: 'frail', v: 5, p: 20 }];
    expect(ch.haste()).toBe(25);
    expect(ch.hasteMult()).toBeCloseTo(0.8);
    const base = ch.weaponKind().timing;
    const fast = hastened(base, ch.hasteMult());
    expect(fast.windup).toBeCloseTo(base.windup * 0.8);
    expect(fast.recovery).toBeCloseTo(base.recovery * 0.8);
    expect(fast.grace).toBe(base.grace);
    expect(ch.basicTiming()).toEqual(fast);
    // Casts too: a technique's wind-up and recovery.
    expect(ch.artTiming('foie').windup).toBeCloseTo(ARTS.foie.windup * 0.8);
    expect(ch.artTiming('foie').recovery).toBeCloseTo(ARTS.foie.recovery * 0.8);
    const slow = new Combo(comboCfg, () => base).computeTimes(0, 'basic');
    const quick = new Combo(comboCfg, () => fast).computeTimes(0, 'basic');
    expect(quick.duration).toBeLessThan(slow.duration);
    expect(quick.windowCloseAt - quick.duration).toBeCloseTo(slow.windowCloseAt - slow.duration);
  });
});

describe('Technique resistance', () => {
  it('is each enemy own on Normal and its difficulty and expedition on Nightmare and Hell, a plain % cut', () => {
    expect(enemies.Booma.techResist).toBeGreaterThan(0);
    expect(hardArch(enemies.Booma, hard.forest).techResist).toBe(hard.forest.techResist);
    expect(hardArch(enemies.ChaosBringer, hell.ruins).techResist).toBe(hell.ruins.techResist);
    expect(cutMult(hell.ruins.techResist)).toBeCloseTo(1 - hell.ruins.techResist / 100);
    expect(hardBoss('falz', true).techResist).toBe(hell.bosses.falz.techResist);
    expect(cutMult(0)).toBe(1);
  });

  it('adds armour per expedition on top of each enemy own, never below 0', () => {
    for (const s of [hard.forest, hard.ruins, hell.forest, hell.ruins]) {
      for (const e of [enemies.Booma, enemies.ChaosBringer]) expect(hardArch(e, s).armor).toBe(Math.max(0, e.armor + s.armor));
    }
  });
});
