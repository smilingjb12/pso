import { describe, expect, it } from 'vitest';
import { darkFalz, deRolLe, dragon, hard as hardCfg, warden, type EnemyId } from './config';
import { areaDef } from './data/looks';
import { Character, forgeMult, makeItem, rarityLine, statDef } from './character';
import { AFFIX_IDS, AFFIX_TIERS, ITEM_AFFIXES, maxAffixTier, tierRange } from './data/itemAffixes';
import { rollArmor, rollEnemyDrops, rollRiftEndDrops, rollWeapon } from './loot';
import {
  BIOME_NAME, buildRiftArea, buildRiftBossArea, enemyHome, plainRift, regionFloors, RIFT_BIOMES, shardRift, RIFT_MODS, riftArch, riftBossOf, riftBossScale, riftCfg, riftElite, riftFoe, riftGrowth, riftIlvl,
  riftSave, riftScale, riftThreat, rollShard, type RiftInfo,
} from './rifts';

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rift = (over: Partial<RiftInfo> = {}): RiftInfo => ({ region: 'forest', look: 'forest1', bossRegion: 'mines', tier: 1, mods: [], seed: 7, boss: false, shard: false, complete: false, ...over });

describe('affix tiers 7-8 (rift item levels)', () => {
  it('opens tier 7 at rift tier 4 and tier 8 at tier 7 (where circles II and III start), never on Hell drops', () => {
    expect(maxAffixTier(98)).toBe(6);
    expect(maxAffixTier(riftIlvl(3))).toBe(6);
    expect(maxAffixTier(riftIlvl(4))).toBe(7);
    expect(maxAffixTier(riftIlvl(6))).toBe(7);
    expect(maxAffixTier(riftIlvl(7))).toBe(8);
    expect(maxAffixTier(riftIlvl(riftCfg.maxTier))).toBe(AFFIX_TIERS);
    // Two item levels a tier, 120 at the top, and nothing deeper.
    expect(riftIlvl(1)).toBe(102);
    expect(riftIlvl(riftCfg.maxTier)).toBe(120);
    expect(riftIlvl(60)).toBe(120);
  });

  it('extends every affix (and penalty) upward with lo <= hi', () => {
    for (const id of AFFIX_IDS) {
      const def = ITEM_AFFIXES[id];
      for (const tiers of [def.tiers, def.penalty?.tiers].filter((t): t is [number, number][] => !!t)) {
        let prev = tiers[5];
        for (const t of [7, 8]) {
          const [lo, hi] = tierRange(tiers, t);
          expect(lo, `${id} t${t}`).toBeLessThanOrEqual(hi);
          expect(lo, `${id} t${t}`).toBeGreaterThanOrEqual(prev[0]);
          expect(hi, `${id} t${t}`).toBeGreaterThanOrEqual(prev[1]);
          prev = [lo, hi];
        }
      }
    }
  });

  it('lets rift drops roll past the tier 6 top, and Hell drops never', () => {
    const rng = mulberry(3);
    const top6 = tierRange(ITEM_AFFIXES.atpPct.tiers, 6)[1];
    let over = 0;
    for (let i = 0; i < 600; i++) {
      const hell = rollWeapon(15, rng, 'melee', 'rare');
      for (const a of hell.affixes ?? []) if (a.id === 'atpPct') expect(a.v).toBeLessThanOrEqual(top6);
      const r = rollWeapon(15, rng, 'melee', 'rare', riftIlvl(8));
      expect(r.ilvl).toBe(116);
      for (const a of r.affixes ?? []) if (a.id === 'atpPct' && a.v > top6) over++;
    }
    expect(over).toBeGreaterThan(0);
  });

  it('gives every rift rare 6 affixes and 3 dormant', () => {
    const rng = mulberry(5);
    for (let i = 0; i < 200; i++) {
      const it = rollArmor(15, rng, 'melee', 'rare', riftIlvl(1 + (i % 10)));
      expect((it.affixes?.length ?? 0) + (it.special ? 1 : 0)).toBe(6);
      expect(it.dormant).toHaveLength(3);
    }
  });

  it('drops rift end loot at the rift item level', () => {
    const drops = rollRiftEndDrops(true, 9, riftIlvl(9), mulberry(1));
    const items = drops.filter((d) => d.kind === 'item');
    expect(items.length).toBeGreaterThanOrEqual(6);
    expect(items.some((d) => d.kind === 'item' && d.item.ilvl === riftIlvl(9))).toBe(true);
  });

  it('drops more loot with item quantity: extra rare gear at the end, a second drop past a drop rate of 1', () => {
    const count = (qty: number) => {
      const rng = mulberry(3);
      let n = 0;
      for (let i = 0; i < 300; i++) n += rollRiftEndDrops(false, 9, riftIlvl(9), rng, undefined, qty).length;
      return n / 300;
    };
    expect(count(100) - count(0)).toBeCloseTo(3, 0);
    const rng = mulberry(4);
    const plain = riftArch('Booma', { tier: 10, mods: [] });
    expect(plain.dropRate).toBeCloseTo(riftArch('Booma', { tier: 1, mods: [] }).dropRate * (2 / 1.1));
    const arch = { ...plain, dropRate: 1.6 };
    let n = 0;
    for (let i = 0; i < 2000; i++) n += rollEnemyDrops(arch, rng).length;
    expect(n / 2000).toBeCloseTo(arch.dropRate, 1);
  });
});

describe('rift scaling', () => {
  it('grows with tier from its region\'s Hell numbers, and modifiers add on top', () => {
    for (const home of RIFT_BIOMES) {
      const first = riftScale(home, { tier: 1, mods: [] });
      let prev = first;
      expect(first.atp).toBeGreaterThan(0);
      for (let t = 2; t <= riftCfg.maxTier; t++) {
        const s = riftScale(home, { tier: t, mods: [] });
        expect(s.hp).toBeCloseTo(prev.hp * riftCfg.fieldHpPerTier);
        // Armour and technique resistance no longer climb (2026-10-17): they only made rooms slower.
        expect(s.techResist).toBe(first.techResist);
        expect(s.armor).toBe(first.armor);
        prev = s;
      }
      // Nothing past the deepest tier.
      expect(riftScale(home, { tier: riftCfg.maxTier + 5, mods: [] }).hp).toBeCloseTo(prev.hp);
      expect(riftScale(home, { tier: 3, mods: ['tough'] }).hp).toBeCloseTo(riftScale(home, { tier: 3, mods: [] }).hp * 1.4);
    }
    expect(riftElite({ mods: ['elites'] })).toBeGreaterThan(riftElite({ mods: [] }));
  });

  it('grows HP, heavy hits and (slower) chip damage every tier up to the deepest', () => {
    for (const id of ['Booma', 'ChaosBringer', 'Sinow', 'Garanz'] as const) {
      const at = (tier: number) => riftArch(id, rift({ tier }));
      const chip = (tier: number) => at(tier).atp * at(tier).chipMult!;
      for (const t of [2, 5, 10]) {
        expect(at(t).hp / at(t - 1).hp).toBeCloseTo(riftCfg.fieldHpPerTier, 1);
        expect(at(t).atp / at(t - 1).atp).toBeCloseTo(riftCfg.heavyPerTier, 1);
        expect(chip(t) / chip(t - 1)).toBeCloseTo(riftCfg.chipPerTier, 1);
      }
      // Heavy hits start at heavyBase over the Hell numbers, shots at chipBase.
      expect(at(1).chipMult).toBeCloseTo(riftCfg.chipBase / riftCfg.heavyBase);
      expect(at(riftCfg.maxTier + 3).atp).toBe(at(riftCfg.maxTier).atp);
      // Hit harder with Brutal, on top of the tier.
      expect(riftArch(id, rift({ tier: 8, mods: ['brutal'] })).atp / at(8).atp).toBeCloseTo(1.12, 1);
    }
    expect(riftGrowth(1)).toEqual({ hp: 1, bossHp: 1, heavy: 1, chip: 1 });
    // At the top: enemies about 7.5 times as tough as at tier 1 (top gear has to take a few casts on each), bosses
    // more, heavy hits about five times as hard, chip damage twice.
    const top = riftGrowth(riftCfg.maxTier);
    expect(top.hp).toBeGreaterThan(6);
    expect(top.bossHp).toBeGreaterThan(top.hp);
    expect(top.heavy).toBeGreaterThan(4);
    expect(top.chip).toBeLessThan(top.heavy / 2);
  });

  it('reads how hard a tier hits you: heavy hits near a one-shot at the top for a squishy build', () => {
    const t1 = riftThreat(1, 1500, 60, 60);
    const t10 = riftThreat(riftCfg.maxTier, 1500, 60, 60);
    expect(t10.heavy / t1.heavy).toBeCloseTo(riftGrowth(riftCfg.maxTier).heavy, 1);
    expect(t10.hardest).toBeGreaterThan(t10.heavy);
    expect(t10.chip).toBeLessThan(t10.heavy);
    expect(t10.hardest).toBeGreaterThan(60);
  });

  it('scales every enemy from its home expedition, so early grunts stay as tough as late ones', () => {
    const home: Record<string, string> = { Booma: 'forest', CaveBooma: 'caves', PoisonLily: 'caves', Hidoom: 'caves', Gillchic: 'mines', SparkMite: 'mines', Dimenian: 'ruins', ChaosBringer: 'ruins' };
    for (const [id, b] of Object.entries(home)) expect(enemyHome(id as EnemyId)).toBe(b);
    // A Booma (Forest base HP) and a Dimenian (Ruins base HP) end up within a factor of ~2 of each other.
    const booma = riftArch('Booma', rift()).hp;
    const dim = riftArch('Dimenian', rift()).hp;
    expect(booma / dim).toBeGreaterThan(0.4);
    expect(booma / dim).toBeLessThan(2.5);
    const foe = riftFoe(rift({ tier: 5 }));
    expect(foe.techResist).toBe(riftFoe(rift({ tier: 1 })).techResist);
  });

  it('stamps loot and keeps telegraphs above the floor', () => {
    const r = rift({ tier: 8, mods: ['swift', 'haste', 'overclocked'] });
    for (const id of ['Gillchic', 'Garanz', 'Sinow', 'Booma', 'ChaosSorcerer'] as const) {
      const base = riftArch(id, rift({ tier: 8 }));
      const a = riftArch(id, r);
      expect(a.ilvl).toBe(riftIlvl(8));
      expect(a.dropRate).toBeGreaterThan(base.dropRate * 0.999);
      expect(a.lootRare).toBeGreaterThan(base.lootRare!);
      expect(base.lootRare).toBeGreaterThan(1);
      // The tier's own quantity and rarity: tier 8 over tier 1, with no shard.
      expect(base.dropRate).toBeGreaterThan(riftArch(id, rift({ tier: 1 })).dropRate);
      expect(base.lootRare).toBeGreaterThan(riftArch(id, rift({ tier: 1 })).lootRare!);
      if (base.windup >= hardCfg.telegraphFloor) expect(a.windup).toBeGreaterThanOrEqual(hardCfg.telegraphFloor);
      expect(a.attackCooldown).toBeLessThan(base.attackCooldown);
    }
  });

  it('gives rift bosses their Hell third phase', () => {
    for (const bossRegion of RIFT_BIOMES) {
      const s = riftBossScale({ bossRegion, tier: 6, mods: [] });
      expect(s.hell).toBe(true);
      expect(riftBossScale({ bossRegion, tier: 7, mods: [] }).hp).toBeGreaterThan(s.hp);
    }
  });

  it('gives every rift boss the same HP at a tier (De Rol Le trimmed for its shell), growing with the tier', () => {
    const base = { forest: dragon.hp, caves: deRolLe.hp, mines: warden.hp, ruins: darkFalz.hp };
    for (const tier of [1, 9, 25]) {
      for (const bossRegion of RIFT_BIOMES) {
        const id = riftBossOf(bossRegion);
        const maxHp = base[bossRegion] * riftBossScale({ bossRegion, tier, mods: [] }).hp;
        expect(maxHp).toBeCloseTo(riftCfg.bossHp * riftCfg.bossHpMult[id] * riftGrowth(tier).bossHp, 0);
      }
    }
    expect(riftBossScale({ bossRegion: 'ruins', tier: 5, mods: ['tough'] }).hp / riftBossScale({ bossRegion: 'ruins', tier: 5, mods: [] }).hp).toBeCloseTo(1.4);
  });

  it('runs each rift boss at its own fixed speed, whatever the tier', () => {
    for (const bossRegion of RIFT_BIOMES) {
      const at = (tier: number) => riftBossScale({ bossRegion, tier, mods: [] }).tempo;
      expect(at(1)).toBe(riftCfg.bossTempo[riftBossOf(bossRegion)]);
      expect(at(16)).toBe(at(1));
      expect(at(40)).toBe(at(1));
    }
  });

  it('makes rift bosses hit like heavy hits, harder every tier up to the top', () => {
    for (const bossRegion of RIFT_BIOMES) {
      const at = (tier: number) => riftBossScale({ bossRegion, tier, mods: [] });
      expect(at(1).atpMult).toBe(riftCfg.heavyBase);
      expect(at(10).atpMult! / at(9).atpMult!).toBeCloseTo(riftCfg.heavyPerTier);
      expect(at(10).flat / at(9).flat).toBeCloseTo(riftCfg.heavyPerTier);
      expect(at(10).hp / at(9).hp).toBeCloseTo(riftCfg.bossHpPerTier);
      expect(at(14).atpMult).toBe(at(10).atpMult);
      expect(riftBossScale({ bossRegion, tier: 9, mods: ['brutal'] }).atpMult).toBeCloseTo(at(9).atpMult! * 1.12);
    }
  });
});

describe('Rift Shards', () => {
  it('roll near their tier with 1-4 different modifiers, at most one forced affix', () => {
    const rng = mulberry(11);
    let bosses = 0;
    for (let i = 0; i < 2000; i++) {
      const tier = 1 + (i % 14);
      const s = rollShard(tier, rng);
      expect(Math.abs(s.tier - Math.min(tier, riftCfg.maxTier))).toBeLessThanOrEqual(1);
      expect(s.tier).toBeGreaterThanOrEqual(1);
      expect(s.tier).toBeLessThanOrEqual(riftCfg.maxTier);
      if (s.boss) bosses++;
      expect(s.mods.length).toBeGreaterThanOrEqual(1);
      expect(s.mods.length).toBeLessThanOrEqual(4);
      expect(new Set(s.mods).size).toBe(s.mods.length);
      expect(s.mods.filter((m) => RIFT_MODS[m].affix).length).toBeLessThanOrEqual(1);
      const needs = s.mods.some((m) => RIFT_MODS[m].second);
      expect(!!s.second).toBe(needs);
      if (s.second) expect(s.second).not.toBe('forest');
    }
    // About a third name their boss.
    expect(bosses / 2000).toBeCloseTo(riftCfg.bossShard, 1);
  });

  it('end at the boss a shard names', () => {
    const rng = mulberry(17);
    for (const [boss, region] of [['dragon', 'forest'], ['derolle', 'caves'], ['warden', 'mines'], ['falz', 'ruins']] as const) {
      for (let i = 0; i < 20; i++) expect(shardRift({ uid: 'x', tier: 3, mods: ['tough'], boss }, rng).bossRegion).toBe(region);
    }
  });

  it('cleans shards from before the region change out of old saves', () => {
    const ch = Character.create('T', 'hunter');
    ch.data.rift = {
      tier: 3, clears: 2, best: 2,
      shards: [
        { uid: 'a', biome: 'mines', tier: 3, mods: ['hazards', 'convergence'], second: 'ruins' },
        { uid: 'b', biome: 'caves', tier: 2, mods: ['tough', 'hazards', 'bleed'], second: 'forest' },
      ] as never,
    };
    const save = riftSave(ch.data);
    // (A save that old has its tiers squished too.)
    expect(save.shards).toEqual([{ uid: 'b', tier: 1, mods: ['tough', 'bleed'], second: 'mines' }]);
  });

  it('squishes an old save onto the ten tiers once', () => {
    const ch = Character.create('T', 'hunter');
    ch.data.rift = { tier: 23, clears: 40, best: 22, shards: [{ uid: 's', tier: 13, mods: ['tough'] }, { uid: 't', tier: 1, mods: ['brutal'] }] };
    const save = riftSave(ch.data);
    expect(save.tier).toBe(riftCfg.maxTier);
    expect(save.best).toBe(riftCfg.maxTier);
    expect(save.shards.map((x) => x.tier)).toEqual([7, 1]);
    expect(save.clears).toBe(40);
    save.tier = 6;
    expect(riftSave(ch.data).tier).toBe(6);
    // A new character starts on the new ladder.
    const fresh = Character.create('F', 'force');
    expect(riftSave(fresh.data).ladder).toBe(2);
  });
});

describe('rift areas', () => {
  it('take a random region\'s look with every expedition in the waves, and any boss', () => {
    const rng = mulberry(9);
    const homes = new Set<string>();
    for (const bossRegion of RIFT_BIOMES) {
      for (const boss of [false, true]) {
        const r = { ...plainRift(4, rng), bossRegion, boss, mods: ['bleed'] as RiftInfo['mods'], second: 'mines' as const };
        const def = buildRiftArea(r);
        expect(def.id).toBe('rift');
        expect(regionFloors(r.region)).toContain(r.look);
        expect(def.theme).toEqual(areaDef(r.look).theme);
        expect(def.theme.trees).toBe(r.region === 'forest');
        expect(def.name).toContain(BIOME_NAME[r.region]);
        expect(def.rooms.some((room) => room.guardian)).toBe(true);
        expect(def.rooms.some((room) => room.features?.some((f) => f.kind === 'toBoss'))).toBe(boss);
        for (const room of def.rooms) for (const w of room.waves ?? []) for (const e of w) homes.add(enemyHome(typeof e === 'string' ? e : e.e));
        const arena = buildRiftBossArea(r);
        expect(arena.id).toBe('riftBoss');
        expect(arena.kind).toBe('boss');
        expect(arena.theme).toEqual(areaDef(({ forest: 'dragon', caves: 'derolle', mines: 'warden', ruins: 'falz' } as const)[bossRegion]).theme);
      }
    }
    expect([...homes].sort()).toEqual([...RIFT_BIOMES].sort());
  });
  it('roll every region and floor look at random, and never the region a Bleeding shard brings', () => {
    const rng = mulberry(21);
    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) {
      const r = plainRift(3, rng);
      expect(regionFloors(r.region)).toContain(r.look);
      seen.add(`${r.region}:${r.look}`);
    }
    expect([...seen].sort()).toEqual(RIFT_BIOMES.flatMap((b) => regionFloors(b).map((f) => `${b}:${f}`)).sort());
    for (let i = 0; i < 200; i++) {
      const s = { uid: 'x', tier: 5, mods: ['bleed'] as RiftInfo['mods'], second: (['caves', 'mines', 'ruins'] as const)[i % 3] };
      expect(shardRift(s, rng).region).not.toBe(s.second);
    }
  });
});

describe('Swarming', () => {
  it('fills bigger waves with fodder and marks where it starts', () => {
    const count = (mods: RiftInfo['mods']) => {
      let n = 0;
      let fodder = 0;
      for (let seed = 1; seed <= 20; seed++) {
        const def = buildRiftArea(rift({ seed, mods }));
        for (const room of def.rooms) {
          (room.waves ?? []).forEach((w, i) => {
            n += w.length;
            const from = room.fodder?.[i];
            if (from === undefined) return;
            for (const e of w.slice(from)) {
              const id = typeof e === 'string' ? e : e.e;
              expect(['Booma', 'CaveBooma', 'Gillchic', 'Dimenian', 'LaDimenian', 'PoisonLily']).toContain(id);
              fodder++;
            }
            expect(w.length).toBeLessThanOrEqual(11);
          });
        }
      }
      return { n, fodder };
    };
    const plain = count([]);
    const swarm = count(['swarming']);
    expect(plain.fodder).toBe(0);
    expect(swarm.fodder).toBeGreaterThan(0);
    expect(swarm.n / plain.n).toBeGreaterThan(1.3);
  });
});

describe('Rift-forged drops and rarer finds', () => {
  it('raise a rift drop base stats 3% an item level (6% a tier) up to the top, and leave other items alone', () => {
    expect(forgeMult({})).toBe(1);
    expect(forgeMult({ ilvl: 98 })).toBe(1);
    expect(forgeMult({ ilvl: riftIlvl(riftCfg.maxTier) })).toBeCloseTo(1.6);
    expect(forgeMult({ ilvl: 130 })).toBeCloseTo(1.6);
    expect(forgeMult({ ilvl: 107 })).toBeCloseTo(1.21);
    const plain = makeItem('rod_15');
    const forged = makeItem('rod_15', { ilvl: 107 });
    const a = statDef(plain);
    const b = statDef(forged);
    if (a.type !== 'weapon' || b.type !== 'weapon') throw new Error('not a weapon');
    expect(b.atpMax).toBe(Math.round(a.atpMax * 1.21));
    expect(b.bonus?.mst).toBe(Math.round((a.bonus?.mst ?? 0) * 1.21));
    expect(rarityLine(forged)).toContain('Rift-forged +21%');
    expect(rarityLine(plain)).not.toContain('Rift-forged');
    const armor = statDef(makeItem('frame_psy_15', { ilvl: 116 }));
    if (armor.type !== 'armor') throw new Error('not armour');
    expect(armor.dr).toBeGreaterThan((statDef(makeItem('frame_psy_15')) as typeof armor).dr);
  });

  it('counts the forge in the character stats', () => {
    const ch = Character.create('T', 'force');
    ch.data.level = 100;
    const w = makeItem('rod_15', { ilvl: 110 });
    ch.data.inventory.push(w);
    const before = ch.stats().mst;
    ch.data.equipped.weapon = w.uid;
    const forged = ch.stats().mst;
    const plain = makeItem('rod_15');
    ch.data.inventory.push(plain);
    ch.data.equipped.weapon = plain.uid;
    expect(forged).toBeGreaterThan(ch.stats().mst);
    expect(ch.stats().mst).toBeGreaterThan(before);
  });

  it('makes rares likelier as the tiers climb', () => {
    expect(riftArch('Booma', rift({ tier: 10 })).lootRare!).toBeGreaterThan(riftArch('Booma', rift({ tier: 2 })).lootRare!);
    expect(riftArch('Booma', rift({ tier: 7 })).lootRare).toBeCloseTo(1.84);
  });
});
