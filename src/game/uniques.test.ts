import { describe, expect, it } from 'vitest';
import { Character, makeItem, rarityOf, statDef } from './character';
import { drops, formulas, uniqueCfg } from './config';
import { craftable } from './crafting';
import { estimateDamage, techDps, type Foe } from './dps';
import { getDef, itemDefs, type ArmorItemDef, type WeaponItemDef } from './data/items';
import { isUniqueUnit, UNIQUE_IDS, UNIQUES, uniqueItemId, uniqueUnitId } from './data/uniques';
import { injectorStats } from './injectors';
import { itemSlot } from './itemTypes';
import { bossUniqueTier, rollBossDrops, rollBoxDrop, rollEliteBonus, rollEnemyDrop, rollRiftEndDrops, rollUnique, uniqueShare } from './loot';
import { enemies } from './config';
import { bossUniques, bossUniqueShare, CIRCLES, circleOf, rollBossUnique } from './riftCircles';
import { riftIlvl, riftSave } from './rifts';
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

const foe: Foe = { armor: 12, techResist: 15, label: 'test' };

describe('unique definitions', () => {
  it('are a weapon per class from main-game bosses, and a gear piece and a unit per rift boss and circle', () => {
    const main = UNIQUE_IDS.filter((id) => UNIQUES[id].pool === 'main');
    expect(main.map((id) => UNIQUES[id].cls).sort()).toEqual(['force', 'hunter', 'ranger']);
    for (const id of main) expect(UNIQUES[id].base.type).toBe('weapon');
    const rift = UNIQUE_IDS.filter((u) => UNIQUES[u].pool === 'rift');
    expect(rift).toHaveLength(24);
    for (const boss of ['dragon', 'derolle', 'warden', 'falz'] as const) {
      for (const c of [1, 2, 3] as const) {
        const two = bossUniques(boss, c, c);
        expect(two, `${boss} ${c}`).toHaveLength(2);
        expect(two.filter(isUniqueUnit), `${boss} ${c}`).toHaveLength(1);
      }
    }
    // Every class gets two rift weapons (and the circles' armour is anyone's).
    const weapons = rift.filter((id) => UNIQUES[id].base.type === 'weapon');
    for (const cls of ['hunter', 'ranger', 'force'] as const) expect(weapons.filter((id) => UNIQUES[id].cls === cls)).toHaveLength(2);
    for (const id of UNIQUE_IDS) expect(UNIQUES[id].effect.length && UNIQUES[id].cost.length).toBeTruthy();
  });

  it('give each unique unit one def that is learned like a unit', () => {
    for (const id of UNIQUE_IDS.filter(isUniqueUnit)) {
      const def = getDef(uniqueUnitId(id));
      expect(def.type).toBe('unit');
      expect(def.unique).toBe(id);
      expect(rarityOf(makeItem(def.id))).toBe('unique');
      expect(itemDefs[uniqueItemId(id, 15)]).toBeUndefined();
    }
  });

  it('exist at every tier with that tier\'s base stats, as uniques that can\'t be crafted', () => {
    for (const id of UNIQUE_IDS.filter((u) => !isUniqueUnit(u))) {
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
        } else if (u.base.type === 'armor') {
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

  it("never come in a rift's end loot: the boss rolls its own (Rift Circles)", () => {
    const rng = mulberry32(10);
    for (let i = 0; i < 300; i++) {
      for (const d of rollRiftEndDrops(true, 8, riftIlvl(8), rng)) if (d.kind === 'item') expect(getDef(d.item.id).unique).toBeUndefined();
    }
    const halo = rollUnique('rift', 15, () => 0, undefined, riftIlvl(7));
    expect((statDef(halo) as ArmorItemDef).dr).toBeGreaterThan((getDef(halo.id) as ArmorItemDef).dr);
  });

  it("drop from each rift boss: its circle's first kill always gives one you lack, then now and then", () => {
    const ch = Character.create('t', 'hunter');
    const save = riftSave(ch.data);
    const rng = mulberry32(12);
    // The first Dragon kill in circle II: one of circle II's two, Rift-forged if it's gear.
    const first = rollBossUnique('dragon', 5, riftIlvl(5), save, ch.data, rng)!;
    const id = getDef(first.id).unique!;
    expect(bossUniques('dragon', 2, 2)).toContain(id);
    if (!isUniqueUnit(id)) expect(first.ilvl).toBe(riftIlvl(5));
    ch.take(first);
    // The first kill elsewhere in that circle is still owed; this boss's isn't.
    expect(rollBossUnique('falz', 4, riftIlvl(4), save, ch.data, rng)).not.toBeNull();
    // After that, only this boss's own, from its circles so far, at about riftUnique a kill (a dry streak raises it).
    let got = 0;
    const n = 3000;
    for (let i = 0; i < n; i++) {
      const u = rollBossUnique('dragon', 5, riftIlvl(5), save, ch.data, rng);
      if (!u) continue;
      got++;
      const def = UNIQUES[getDef(u.id).unique!];
      expect(def.boss).toBe('dragon');
      expect(def.circle!).toBeLessThanOrEqual(circleOf(5));
    }
    expect(got / n).toBeGreaterThan(drops.riftUnique);
    expect(got / n).toBeLessThan(drops.riftUnique * 2);
    // A new character's first circle III Warden kill prefers the one it doesn't have.
    const ch2 = Character.create('u', 'force');
    const [gear] = bossUniques('warden', 3, 3).filter((x) => !isUniqueUnit(x));
    ch2.data.inventory.push(makeItem(uniqueItemId(gear, 15)));
    const pick = rollBossUnique('warden', 8, riftIlvl(8), riftSave(ch2.data), ch2.data, () => 0.99)!;
    expect(isUniqueUnit(getDef(pick.id).unique!)).toBe(true);
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
    const ramp = techDps(rod, foe, 'foie') / techDps(plain, foe, 'foie');
    expect(ramp).toBeGreaterThan(1.6);
    expect(ramp).toBeLessThan(2.1);
  });

  it('Frozen Shooter: a heavy-then-shatter rhythm, estimated against a regular enemy', () => {
    const shooter = estimateDamage(wearing('ranger', uniqueItemId('frozenShooter', 15)), foe, false).weapon;
    const rifle = estimateDamage(wearing('ranger', 'rifle_15'), foe, false).weapon;
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

  it('unique units: learned on pickup, active once slotted in the Mag, never learned twice', () => {
    const ch = wearing('hunter', 'frame_guard_15');
    const limiter = makeItem(uniqueUnitId('limiter'));
    expect(ch.take(limiter)).toEqual({ to: 'learned', before: null });
    expect(ch.unitStatus(makeItem(uniqueUnitId('limiter')))).toBe('known');
    expect(ch.hasUnique('limiter')).toBe(false);
    expect(ch.insertUnit('limiter')).toBeNull();
    expect(ch.hasUnique('limiter')).toBe(true);
    // Its numbers: cooldowns 30% shorter, Arts 20% more TP.
    const plain = wearing('hunter', 'frame_guard_15');
    expect(ch.artCooldown('leap')).toBeCloseTo(plain.artCooldown('leap') * (1 - uniqueCfg.limiterCd));
    expect(ch.artCost('leap') / plain.artCost('leap')).toBeCloseTo(1 + uniqueCfg.limiterTp, 1);
    // Taking it out of the Mag switches it off.
    expect(ch.removeUnit(0)).toBeNull();
    expect(ch.hasUnique('limiter')).toBe(false);
  });

  it('Heart of Falz: the other unique units hit 50% harder, costs too', () => {
    const ch = wearing('hunter', 'frame_guard_15');
    for (const id of ['venomSac', 'heartOfFalz'] as const) {
      ch.take(makeItem(uniqueUnitId(id)));
      ch.insertUnit(id);
    }
    expect(ch.uval(0.2)).toBeCloseTo(0.3);
    expect(ch.critDamage()).toBeCloseTo(formulas.critDamage - uniqueCfg.venomSacCrit * uniqueCfg.heartMult);
  });

  it('costs on the character: max TP (Yasakani, Dark Bridge), healing (DF Shield), injector doses (Rol Carapace)', () => {
    const base = wearing('force', 'rod_15');
    const bridge = wearing('force', uniqueItemId('darkBridge', 15));
    expect(bridge.maxTp).toBeLessThan(base.maxTp * (1 - uniqueCfg.bridgeTp) * 1.1);
    const shield = wearing('hunter', uniqueItemId('dfShield', 15));
    expect(shield.healMult()).toBeCloseTo(1 - uniqueCfg.dfHeal);
    expect(wearing('hunter').healMult()).toBe(1);
    const mate = makeItem('mate_6');
    const carapace = wearing('hunter', uniqueItemId('rolCarapace', 15));
    expect(injectorStats(mate, carapace).potency).toBeCloseTo(injectorStats(mate, wearing('hunter')).potency * (1 - uniqueCfg.carapaceInjector));
  });
});

describe('unique drop shares (the Uniques tab)', () => {
  it("add up to every drop of a pool, and a boss's in each circle", () => {
    for (const bias of [undefined, 'melee', 'ranged', 'caster'] as const) {
      const main = UNIQUE_IDS.filter((id) => UNIQUES[id].pool === 'main').reduce((a, id) => a + uniqueShare(id, bias), 0);
      expect(main).toBeCloseTo(1);
    }
    // The class's own weapon counts double.
    expect(uniqueShare('darkFlow', 'melee')).toBeCloseTo(2 * uniqueShare('frozenShooter', 'melee'));
    for (const boss of ['dragon', 'derolle', 'warden', 'falz'] as const) {
      for (const c of CIRCLES) expect(bossUniques(boss, c).reduce((a, id) => a + bossUniqueShare(id, c), 0)).toBeCloseTo(1);
    }
    // This circle's two count double; a deeper circle's aren't in an earlier one at all.
    expect(bossUniqueShare('redRing', 1)).toBeCloseTo(0.5);
    expect(bossUniqueShare('redRing', 2)).toBeCloseTo(1 / 6);
    expect(bossUniqueShare('flameVisit', 2)).toBeCloseTo(1 / 3);
    expect(bossUniqueShare('swordSaint', 2)).toBe(0);
  });
});
