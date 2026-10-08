import { describe, expect, it } from 'vitest';
import { enemies, hard } from './config';
import { affixFits, HARD_AFFIXES, rollAffixes } from './data/affixes';
import { armorLines, getDef, itemDefs, weaponKinds, type WeaponKind } from './data/items';
import { hardArch, hardWindup } from './hard';
import { rollChampionBonus, rollEnemyDrop, rollHardBossDrops, rollInjector, shopTier } from './loot';
import { mulberry32 } from './world/Level';

describe('Hard scaling', () => {
  it('scales stats per expedition and keeps telegraphs readable', () => {
    const b = enemies.Booma;
    const h = hardArch(b, hard.forest);
    expect(h.hp).toBe(Math.round(b.hp * hard.forest.hp));
    expect(h.atp).toBe(b.atp + hard.forest.atp);
    expect(h.recovery).toBeCloseTo(b.recovery * hard.recoveryMult);
    expect(h.dropTier).toBe(8);
    expect(h.rarePool).toEqual(hard.forest.rares);
    // Every Hard telegraph stays at or above the floor unless it was already shorter.
    for (const a of Object.values(enemies)) {
      const w = hardWindup(a.windup);
      expect(w).toBeLessThanOrEqual(a.windup);
      if (a.windup >= hard.telegraphFloor) expect(w).toBeGreaterThanOrEqual(hard.telegraphFloor);
      else expect(w).toBe(a.windup);
    }
  });

  it('leaves attackless enemies at zero ATP', () => {
    expect(hardArch(enemies.ControlNode, hard.mines).atp).toBe(0);
  });

  it('drops Hard tiers from Hard enemies', () => {
    const rng = mulberry32(7);
    const tiers = new Set<number>();
    for (let i = 0; i < 400; i++) {
      const d = rollEnemyDrop(hardArch(enemies.Gillchic, hard.mines), rng, 'atp');
      if (d?.kind !== 'item') continue;
      const def = getDef(d.item.id);
      if ((def.type === 'weapon' || def.type === 'armor') && !def.rare) tiers.add(def.tier);
    }
    expect(Math.min(...tiers)).toBeGreaterThanOrEqual(8);
    expect(Math.max(...tiers)).toBe(10);
  });
});

describe('Affixes', () => {
  it('never gives a rooted Lily a trail or a splitting body', () => {
    expect(affixFits('molten', enemies.PoisonLily)).toBe(false);
    expect(affixFits('splitting', enemies.PoisonLily)).toBe(false);
    expect(affixFits('splitting', enemies.PanArms)).toBe(false);
    expect(affixFits('splitting', enemies.Booma)).toBe(true);
  });

  it('rolls distinct affixes for champions', () => {
    const rng = mulberry32(3);
    for (let i = 0; i < 50; i++) {
      const a = rollAffixes(2, enemies.Sinow, rng);
      expect(a).toHaveLength(2);
      expect(new Set(a).size).toBe(2);
      for (const x of a) expect(HARD_AFFIXES).toContain(x);
    }
  });
});

describe('Hard loot', () => {
  it('has tiers 7-15 for every weapon kind and armour line (12-15: Hell)', () => {
    for (const kind of Object.keys(weaponKinds) as WeaponKind[]) {
      for (const t of [7, 8, 9, 10, 11, 12, 13, 14, 15]) expect(itemDefs[`${kind}_${t}`]?.type).toBe('weapon');
      expect(itemDefs[`${kind}_16`]).toBeUndefined();
    }
    for (const line of Object.keys(armorLines).filter((l) => l !== 'basic')) {
      for (const slot of ['frame', 'barrier']) for (const t of [7, 8, 9, 10, 11, 12, 13, 14, 15]) expect(itemDefs[`${slot}_${line}_${t}`]?.type).toBe('armor');
    }
  });

  it('raises requirements and stats with every tier', () => {
    for (const kind of Object.keys(weaponKinds) as WeaponKind[]) {
      for (let t = 2; t <= 15; t++) {
        const a = getDef(`${kind}_${t - 1}`);
        const b = getDef(`${kind}_${t}`);
        if (a.type !== 'weapon' || b.type !== 'weapon') throw new Error('not a weapon');
        expect(b.atpMax).toBeGreaterThan(a.atpMax);
        expect(b.req).toBeGreaterThan(a.req);
      }
    }
  });

  it('keeps tier 6 injectors to Hard bosses and champions', () => {
    const rng = mulberry32(11);
    for (let i = 0; i < 50; i++) expect(getDef(rollInjector(9, rng).id)).toMatchObject({ tier: 5 });
    for (const boss of ['dragon', 'derolle', 'warden', 'falz'] as const) {
      const drops = rollHardBossDrops(boss, rng, 'mst');
      expect(drops.some((d) => d.kind === 'item' && d.item.id.endsWith('_6') && getDef(d.item.id).type === 'injector')).toBe(true);
    }
    expect(rollChampionBonus(hardArch(enemies.Booma, hard.forest), rng).length).toBeGreaterThanOrEqual(2);
  });

  it('opens shop tier 7 after Dark Falz and 8-11 after the Nightmare bosses, at the band tops', () => {
    const normal = { derolle: true, warden: true };
    expect(shopTier(45, normal)).toBe(6);
    expect(shopTier(41, { ...normal, falz: true })).toBe(6);
    expect(shopTier(42, { ...normal, falz: true })).toBe(7);
    const all = { ...normal, falz: true };
    expect(shopTier(51, { ...all, hard: { dragon: true } })).toBe(7);
    expect(shopTier(52, { ...all, hard: { dragon: true } })).toBe(8);
    expect(shopTier(65, { ...all, hard: { dragon: true, derolle: true } })).toBe(9);
    expect(shopTier(72, { ...all, hard: { dragon: true, derolle: true, warden: true } })).toBe(10);
    expect(shopTier(82, { ...all, hard: { dragon: true, derolle: true, warden: true, falz: true } })).toBe(11);
    // Nightmare played before the Ruins (Hard Dragon, no Dark Falz) keeps tier 7.
    expect(shopTier(45, { ...normal, hard: { dragon: true } })).toBe(7);
  });
});
