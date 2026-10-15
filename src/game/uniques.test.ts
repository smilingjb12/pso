import { describe, expect, it } from 'vitest';
import { Character, forgeMult, makeItem, rarityOf, statDef } from './character';
import { drops, formulas, uniqueCfg } from './config';
import { craftable } from './crafting';
import { estimateDamage, techDps, type Foe } from './dps';
import { getDef, itemDefs, type ArmorItemDef, type WeaponItemDef } from './data/items';
import { UNIQUE_IDS, UNIQUES, uniqueItemId, type UniqueId } from './data/uniques';
import { itemSlot } from './itemTypes';
import { bossUniqueTier, rollBossDrops, rollBoxDrop, rollEliteBonus, rollEnemyDrop, rollRiftEndDrops, rollUnique } from './loot';
import { enemies } from './config';
import { riftCfg, riftIlvl } from './rifts';
import { mulberry32 } from './world/Level';

/** A Lv 100 character of `cls` wearing `ids` (requirements ignored). */
function wearing(cls: 'hunter' | 'ranger' | 'force', ...ids: string[]): Character {
  const ch = Character.create('t', cls);
  ch.data.level = 100;
  for (const id of ids) {
    const inst = makeItem(id);
    ch.data.inventory.push(inst);
    ch.data.equipped[itemSlot(getDef(id))!] = inst.uid;
  }
  return ch;
}

const foe: Foe = { armor: 12, techResist: 15, label: 'test', mainRace: null, bossRace: null };

describe('unique definitions', () => {
  it('are six: one weapon per class from main-game bosses, three armour pieces from rift bosses', () => {
    expect(UNIQUE_IDS).toHaveLength(6);
    const main = UNIQUE_IDS.filter((id) => UNIQUES[id].pool === 'main');
    expect(main.map((id) => UNIQUES[id].cls).sort()).toEqual(['force', 'hunter', 'ranger']);
    for (const id of main) expect(UNIQUES[id].base.type).toBe('weapon');
    for (const id of UNIQUE_IDS.filter((u) => UNIQUES[u].pool === 'rift')) expect(UNIQUES[id].base.type).toBe('armor');
  });

  it('exist at every tier with that tier\'s base stats, as uniques that can\'t be crafted', () => {
    for (const id of UNIQUE_IDS) {
      const u = UNIQUES[id];
      for (let tier = 1; tier <= 15; tier++) {
        const def = getDef(uniqueItemId(id, tier));
        expect(def.unique).toBe(id);
        expect(def.name).toBe(u.name);
        expect(rarityOf(makeItem(def.id))).toBe('unique');
        expect(craftable(makeItem(def.id))).toBe(false);
        if (u.base.type === 'weapon') {
          const base = getDef(`${u.base.kind}_${tier}`) as WeaponItemDef;
          const w = def as WeaponItemDef;
          expect([w.atpMin, w.atpMax, w.req]).toEqual([base.atpMin, base.atpMax, base.req]);
        } else {
          const a = def as ArmorItemDef;
          expect(a.slot).toBe(u.base.slot);
          expect(a.req).toBe(0);
          expect(a.dr).toBeGreaterThan(0);
        }
      }
    }
    // The old thirty are gone (saves drop them on load: unknown items leave the bag).
    for (const old of ['red_saber', 'dark_flow', 'falz_halo', 'excalibur', 'warden_core']) expect(itemDefs[old]).toBeUndefined();
  });
});

describe('unique drops', () => {
  it('never come from regular enemies, elites or boxes', () => {
    const rng = mulberry32(5);
    for (const arch of Object.values(enemies)) {
      for (let i = 0; i < 300; i++) {
        for (const d of [rollEnemyDrop(arch, rng), rollEliteBonus(arch, rng), rollBoxDrop(rng)]) {
          if (d?.kind === 'item') expect(getDef(d.item.id).unique).toBeUndefined();
        }
      }
    }
  });

  it('come from main-game bosses now and then, at the boss\'s tier, leaning to the class', () => {
    const rng = mulberry32(9);
    let got = 0;
    const kinds: Record<string, number> = {};
    const n = 6000;
    for (let i = 0; i < n; i++) {
      for (const d of rollBossDrops('falz', 'hell', rng, 'melee')) {
        if (d.kind !== 'item' || !getDef(d.item.id).unique) continue;
        got++;
        const def = getDef(d.item.id);
        expect((def as WeaponItemDef).tier).toBe(bossUniqueTier('falz', 'hell'));
        kinds[def.unique!] = (kinds[def.unique!] ?? 0) + 1;
      }
    }
    expect(got / n).toBeGreaterThan(drops.uniqueBoss.hell * 0.7);
    expect(got / n).toBeLessThan(drops.uniqueBoss.hell * 1.3);
    expect(Object.keys(kinds).sort()).toEqual(['darkFlow', 'frozenShooter', 'reactorRod']);
    // Dark Flow (melee) counts double: about half.
    expect(kinds.darkFlow / got).toBeGreaterThan(0.4);
    expect(bossUniqueTier('dragon', 'normal')).toBe(3);
    expect(bossUniqueTier('falz', 'nightmare')).toBe(11);
    expect(bossUniqueTier('falz', 'hell')).toBe(15);
  });

  it('come from rift bosses from the rift pool, Rift-forged', () => {
    const rng = mulberry32(10);
    const seen = new Set<UniqueId>();
    for (let i = 0; i < 400; i++) {
      for (const d of rollRiftEndDrops(true, 16, riftIlvl(16), rng)) {
        if (d.kind !== 'item' || !getDef(d.item.id).unique) continue;
        const def = getDef(d.item.id);
        expect(UNIQUES[def.unique!].pool).toBe('rift');
        expect(d.item.ilvl).toBe(116);
        expect(forgeMult(d.item)).toBeGreaterThan(1);
        seen.add(def.unique!);
      }
    }
    expect([...seen].sort()).toEqual(['falzHalo', 'overclockCore', 'redRing']);
    expect(riftCfg.bossChance).toBe(1);
    const halo = rollUnique('rift', 15, () => 0, undefined, riftIlvl(7));
    expect((statDef(halo) as ArmorItemDef).dr).toBeGreaterThan((getDef(halo.id) as ArmorItemDef).dr);
  });
});

describe('unique effects (character side)', () => {
  it('Red Ring: crit damage +100%, Corruption resistance −50% (floored)', () => {
    const ch = wearing('hunter', uniqueItemId('redRing', 15));
    expect(wearing('hunter').critDamage()).toBe(formulas.critDamage);
    expect(ch.critDamage()).toBe(formulas.critDamage + uniqueCfg.redRingCrit);
    expect(ch.resist('resCorrupt')).toBe(-50);
    expect(ch.resist('resBurn')).toBe(0);
  });

  it('Overclock Core: gear Haste counts double, max HP halved', () => {
    const plain = wearing('hunter', 'sword_15');
    const core = wearing('hunter', 'sword_15', uniqueItemId('overclockCore', 15));
    for (const ch of [plain, core]) ch.equippedItem('weapon')!.affixes = [{ id: 'haste', v: 10 }];
    expect(plain.haste()).toBe(10);
    expect(core.haste()).toBe(20);
    const noHp = wearing('hunter', uniqueItemId('overclockCore', 15));
    const base = Character.create('t', 'hunter');
    base.data.level = 100;
    expect(noHp.maxHp).toBeLessThan(base.maxHp * 0.6);
  });

  it('Reactor Rod: techniques cost 3× TP, and estimates count the ramp', () => {
    const rod = wearing('force', uniqueItemId('reactorRod', 15));
    const plain = wearing('force', 'rod_15');
    // (A unique counts 2 more grind levels, so its MST, and the base cost with it, is a little higher.)
    const cost = rod.techCost('foie') / plain.techCost('foie');
    expect(cost).toBeGreaterThan(uniqueCfg.reactorTpMult * 0.95);
    expect(cost).toBeLessThan(uniqueCfg.reactorTpMult * 1.1);
    const ramp = techDps(rod, foe, 'foie').native / techDps(plain, foe, 'foie').native;
    expect(ramp).toBeGreaterThan(1.6);
    expect(ramp).toBeLessThan(2.1);
  });

  it('Frozen Shooter: a heavy-then-shatter rhythm, estimated against a regular enemy', () => {
    const shooter = estimateDamage(wearing('ranger', uniqueItemId('frozenShooter', 15)), foe, false).weapon.native;
    const rifle = estimateDamage(wearing('ranger', 'rifle_15'), foe, false).weapon.native;
    // Worse than ×0.5 everywhere would be, better than shattering every shot.
    expect(shooter).toBeGreaterThan(rifle * uniqueCfg.frozenOtherMult);
    expect(shooter).toBeLessThan(rifle * uniqueCfg.frozenShatterMult);
  });

  it('only work while worn', () => {
    const ch = wearing('hunter');
    ch.data.inventory.push(makeItem(uniqueItemId('redRing', 15)));
    expect(ch.hasUnique('redRing')).toBe(false);
    expect(wearing('hunter', uniqueItemId('darkFlow', 9)).hasUnique('darkFlow')).toBe(true);
  });
});
