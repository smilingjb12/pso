import { describe, expect, it } from 'vitest';
import { hard as hardCfg, type EnemyId } from './config';
import { areaDef } from './data/looks';
import { Character, forgeMult, makeItem, rarityLine, statDef } from './character';
import { AFFIX_IDS, AFFIX_TIERS, ITEM_AFFIXES, maxAffixTier, tierRange } from './data/itemAffixes';
import { rollArmor, rollEnemyDrops, rollRiftEndDrops, rollWeapon } from './loot';
import {
  BIOME_NAME, buildRiftArea, buildRiftBossArea, enemyHome, plainRift, regionFloors, RIFT_BIOMES, shardRift, RIFT_MODS, riftArch, riftBossScale, riftCfg, riftElite, riftFoe, riftGrowth, riftIlvl,
  riftSave, riftScale, rollShard, type RiftInfo,
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
  it('opens tier 7 at item level 105 and tier 8 at 112, never on Hell drops', () => {
    expect(maxAffixTier(98)).toBe(6);
    expect(maxAffixTier(riftIlvl(4))).toBe(6);
    expect(maxAffixTier(riftIlvl(5))).toBe(7);
    expect(maxAffixTier(riftIlvl(12))).toBe(8);
    expect(maxAffixTier(riftIlvl(16))).toBe(AFFIX_TIERS);
    expect(maxAffixTier(riftIlvl(60))).toBe(AFFIX_TIERS);
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
      const r = rollWeapon(15, rng, 'melee', 'rare', riftIlvl(16));
      expect(r.ilvl).toBe(116);
      for (const a of r.affixes ?? []) if (a.id === 'atpPct' && a.v > top6) over++;
    }
    expect(over).toBeGreaterThan(0);
  });

  it('gives every rift rare 6 affixes and 3 dormant', () => {
    const rng = mulberry(5);
    for (let i = 0; i < 200; i++) {
      const it = rollArmor(15, rng, 'melee', 'rare', riftIlvl(1 + (i % 16)));
      expect((it.affixes?.length ?? 0) + (it.special ? 1 : 0)).toBe(6);
      expect(it.dormant).toHaveLength(3);
    }
  });

  it('drops rift end loot at the rift item level', () => {
    const drops = rollRiftEndDrops(true, 9, riftIlvl(9), mulberry(1));
    const items = drops.filter((d) => d.kind === 'item');
    expect(items.length).toBeGreaterThanOrEqual(6);
    expect(items.some((d) => d.kind === 'item' && d.item.ilvl === 109)).toBe(true);
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
    const plain = riftArch('Booma', { tier: 16, mods: [] });
    expect(plain.dropRate).toBeCloseTo(riftArch('Booma', { tier: 1, mods: [] }).dropRate * (1.8 / 1.05));
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
      for (let t = 2; t <= 40; t++) {
        const s = riftScale(home, { tier: t, mods: [] });
        expect(s.hp).toBeCloseTo(prev.hp * riftCfg.hpPerTier);
        expect(s.techResist).toBeGreaterThanOrEqual(prev.techResist);
        if (t > riftCfg.capTier) {
          expect(s.techResist).toBe(prev.techResist);
          expect(s.armor).toBe(prev.armor);
        }
        prev = s;
      }
      expect(prev.techResist).toBeGreaterThan(first.techResist);
      expect(prev.armor).toBeGreaterThan(first.armor);
      expect(prev.techResist).toBe(riftScale(home, { tier: riftCfg.capTier, mods: [] }).techResist);
      expect(riftScale(home, { tier: 3, mods: ['tough'] }).hp).toBeCloseTo(riftScale(home, { tier: 3, mods: [] }).hp * 1.4);
    }
    expect(riftElite({ mods: ['elites'] })).toBeGreaterThan(riftElite({ mods: [] }));
  });

  it('compounds HP and damage every tier with no top, each step big enough to feel', () => {
    for (const id of ['Booma', 'ChaosBringer', 'Sinow', 'Garanz'] as const) {
      const at = (tier: number) => riftArch(id, rift({ tier }));
      for (const t of [2, 10, 17, 30]) {
        expect(at(t).hp / at(t - 1).hp).toBeGreaterThan(1.1);
        expect(at(t).atp / at(t - 1).atp).toBeCloseTo(riftCfg.dmgPerTier, 1);
      }
      // Hit harder with Brutal, on top of the tier.
      expect(riftArch(id, rift({ tier: 20, mods: ['brutal'] })).atp / at(20).atp).toBeCloseTo(1.12, 1);
    }
    expect(riftGrowth(1)).toEqual({ hp: 1, dmg: 1, armor: 0, techResist: 0, tempo: 1 });
    // HP about doubles every six tiers.
    expect(riftGrowth(7).hp).toBeGreaterThan(1.9);
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
    expect(foe.mainRace).toBeNull();
    expect(foe.techResist).toBeGreaterThan(riftFoe(rift({ tier: 1 })).techResist);
  });

  it('stamps loot and keeps telegraphs above the floor', () => {
    const r = rift({ tier: 8, mods: ['swift', 'haste', 'overclocked'] });
    for (const id of ['Gillchic', 'Garanz', 'Sinow', 'Booma', 'ChaosSorcerer'] as const) {
      const base = riftArch(id, rift({ tier: 8 }));
      const a = riftArch(id, r);
      expect(a.ilvl).toBe(108);
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

  it('speeds rift bosses up with the tier', () => {
    expect(riftBossScale({ bossRegion: 'forest', tier: 1, mods: [] }).tempo).toBe(1);
    expect(riftBossScale({ bossRegion: 'ruins', tier: 16, mods: [] }).tempo).toBeCloseTo(1.3);
    expect(riftBossScale({ bossRegion: 'ruins', tier: 40, mods: [] }).tempo).toBeCloseTo(1.3);
  });

  it('makes rift bosses hit harder every tier, with no top', () => {
    for (const bossRegion of RIFT_BIOMES) {
      const at = (tier: number) => riftBossScale({ bossRegion, tier, mods: [] });
      expect(at(1).atpMult).toBe(1);
      expect(at(30).atpMult! / at(29).atpMult!).toBeCloseTo(riftCfg.dmgPerTier);
      expect(at(30).flat / at(29).flat).toBeCloseTo(riftCfg.dmgPerTier);
      expect(at(30).hp / at(29).hp).toBeCloseTo(riftCfg.hpPerTier);
      expect(riftBossScale({ bossRegion, tier: 9, mods: ['brutal'] }).atpMult).toBeCloseTo(at(9).atpMult! * 1.12);
    }
  });
});

describe('Rift Shards', () => {
  it('roll near their tier with 1-4 different modifiers, at most one forced affix', () => {
    const rng = mulberry(11);
    for (let i = 0; i < 2000; i++) {
      const tier = 1 + (i % 40);
      const s = rollShard(tier, rng);
      expect(Math.abs(s.tier - tier)).toBeLessThanOrEqual(1);
      expect(s.tier).toBeGreaterThanOrEqual(1);
      expect(s.mods.length).toBeGreaterThanOrEqual(1);
      expect(s.mods.length).toBeLessThanOrEqual(4);
      expect(new Set(s.mods).size).toBe(s.mods.length);
      expect(s.mods.filter((m) => RIFT_MODS[m].affix).length).toBeLessThanOrEqual(1);
      const needs = s.mods.some((m) => RIFT_MODS[m].second);
      expect(!!s.second).toBe(needs);
      if (s.second) expect(s.second).not.toBe('forest');
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
    expect(save.shards).toEqual([{ uid: 'b', tier: 2, mods: ['tough', 'bleed'], second: 'mines' }]);
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

describe('Rift-forged drops and rarer finds', () => {
  it('raise a rift drop base stats 3% a tier, and leave other items alone', () => {
    expect(forgeMult({})).toBe(1);
    expect(forgeMult({ ilvl: 98 })).toBe(1);
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
    expect(riftArch('Booma', rift({ tier: 7 })).lootRare).toBeCloseTo(1.42);
  });
});
