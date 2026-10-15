import { newUid, type CharacterData } from './character';
import { drops, enemies, hard as hardCfg, hell, type EnemyArchetype, type EnemyId, type HardBossScale, type HardScale } from './config';
import { AFFIXES, type Affix } from './data/affixes';
import { areas, expeditions, type AreaDef, type AreaId, type BossId } from './data/areas';
import { areaDef } from './data/looks';
import type { Foe } from './dps';
import { hardArch } from './hard';
import { generateRift, RIFT_ROSTERS } from './riftGen';
import { RIFT_BIOMES, type RiftBiome } from './riftTypes';

// Falz Rifts (DESIGN.md "Endgame: Falz Rifts"): after the Hell Dark Falz, generated rifts. Every rift rolls a random
// region (since 2026-10-14; always the Forest from 2026-10-11) whose look, music and hazards its floor takes, untinted,
// filled with enemies from every expedition, one expedition a wave; every one ends at a random one of the four bosses in
// its own arena (riftCfg.bossChance; a third until 2026-10-12). No region to pick (2026-10-11, the user's call: the
// Forest was always the easy pick). Plain rifts of any unlocked tier are free from the Rift Gate in Pioneer 2; Rift Shards
// (dropped in rifts) add modifiers that raise item quantity and rarity. A rift's item level is 100 + its tier,
// which opens affix tiers 7 and 8 (data/itemAffixes.ts). The ladder has no top (2026-10-14, the user's call:
// endless depth). Numbers are first drafts; `riftCfg` is live in the tuning panel.

export { RIFT_BIOMES, type RiftBiome };

export const riftCfg = {
  /**
   * Enemy HP and damage (field enemies' and bosses' ATP, bosses' flat damage) grow this much per tier, compounding
   * (2026-10-14, the user's call: 9 to 10 felt like nothing at HP ×1.065 and ATP +15 a tier). HP doubles about every
   * six tiers.
   */
  hpPerTier: 1.12,
  dmgPerTier: 1.07,
  /** Armour % and technique resistance % add this much per tier, up to `capTier`. */
  armorPerTier: 0.25,
  techResistPerTier: 0.8,
  /**
   * Rift bosses run this much faster per tier above 1, up to `capTier` (×1.3 at tier 16): attacks, recoveries and
   * telegraphs alike (2026-10-12, the user's pick: with rift gear's damage, Haste and run speed the Hell tempo left
   * long windows).
   */
  bossTempoPerTier: 0.02,
  /**
   * Boss tempo, armour and technique resistance stop growing at this tier (the old top of the ladder): telegraphs
   * stay as long as tier 16's, and resistances can't climb toward immunity. HP and damage go on.
   */
  capTier: 16,
  /** Share of spawns that come in as elites (the Hell Ruins'), and what the Elites modifier adds. */
  elite: 0.65,
  /**
   * Chance a rift ends at a boss (a random one of the four; otherwise the Guardian room finishes it). Every rift
   * since 2026-10-12 (the user's call, when uniques became boss drops; it was a third).
   */
  bossChance: 1,
  /**
   * Rift Shards at a rift's end (Guardian or boss), times 1 + item quantity: 1 = always one, and the quantity is
   * the chance of a second (2026-10-10, the user's pick after two empty rifts; was 0.6). Champions sometimes.
   */
  guardianShard: 1,
  championShard: 0.03,
  /** Shards the Rift Gate holds. */
  stash: 30,
  /** Chance a shard is yellow (3-4 modifiers) rather than blue (1-2). */
  yellow: 0.4,
};

// ------------------------------------------------------------------ modifiers

export type RiftModId =
  | 'overclocked' | 'molten' | 'stormcaller' | 'frenzied' | 'regenerating' | 'volatile'
  | 'champions' | 'elites' | 'corruption' | 'bleed' | 'haste' | 'swift' | 'starved' | 'tough' | 'brutal';

export interface RiftModDef {
  id: RiftModId;
  name: string;
  /** One line, shown on the shard and on entry ("{second}" is the second region's name). */
  desc: string;
  /** Item quantity / rarity it adds, percent. */
  qty: number;
  rar: number;
  /** Every enemy carries this affix (on top of its own rolls, where it fits). */
  affix?: Affix;
  /** Needs a second region (Bleed: whose hazards). */
  second?: boolean;
}

const affixMod = (id: RiftModId & Affix, qty: number, rar: number): RiftModDef => ({
  id, name: AFFIXES[id].name, desc: `Every enemy is ${AFFIXES[id].name}`, qty, rar, affix: id,
});

export const RIFT_MODS: Record<RiftModId, RiftModDef> = {
  overclocked: affixMod('overclocked', 14, 10),
  molten: affixMod('molten', 10, 8),
  stormcaller: affixMod('stormcaller', 10, 8),
  frenzied: affixMod('frenzied', 8, 6),
  regenerating: affixMod('regenerating', 8, 6),
  volatile: affixMod('volatile', 10, 8),
  champions: { id: 'champions', name: 'Exalted', desc: 'Elites and champions carry one more affix', qty: 12, rar: 15 },
  elites: { id: 'elites', name: 'Teeming', desc: 'Far more elites (+20% of spawns)', qty: 14, rar: 10 },
  corruption: { id: 'corruption', name: 'Abyssal', desc: 'Corruption wears off half as fast', qty: 10, rar: 8 },
  bleed: { id: 'bleed', name: 'Bleeding', desc: 'Hazards from the {second} bleed through', qty: 8, rar: 6, second: true },
  haste: { id: 'haste', name: 'Hasted', desc: 'Enemies move and attack 20% faster', qty: 12, rar: 10 },
  swift: { id: 'swift', name: 'Swift', desc: 'Enemy wind-ups 15% shorter (never under 0.8 s)', qty: 10, rar: 8 },
  starved: { id: 'starved', name: 'Starved', desc: 'Injectors charge 30% slower', qty: 10, rar: 10 },
  tough: { id: 'tough', name: 'Hardened', desc: 'Enemies have 40% more HP', qty: 12, rar: 10 },
  brutal: { id: 'brutal', name: 'Brutal', desc: 'Enemies hit 12% harder', qty: 12, rar: 10 },
};
export const RIFT_MOD_IDS = Object.keys(RIFT_MODS) as RiftModId[];
const AFFIX_MOD_IDS = RIFT_MOD_IDS.filter((m) => RIFT_MODS[m].affix);

// ------------------------------------------------------------------ rifts and shards

/** A dropped Rift Shard, kept in the Rift Gate's stash (never in the bag). */
export interface RiftShard {
  uid: string;
  tier: number;
  mods: RiftModId[];
  /** Bleed: the region whose hazards come through (Caves, Mines or Ruins). */
  second?: RiftBiome;
}

/** One open rift (on its run state). */
export interface RiftInfo {
  /** The region the floor is drawn from (its look, music and hazards), rolled at random; waves mix every expedition. */
  region: RiftBiome;
  /** Which of the region's floors lends the look (the Caves and Mines have two each, the Ruins two). */
  look: AreaId;
  /** Whose boss a boss rift ends at (picked at random, apart from the region). */
  bossRegion: RiftBiome;
  tier: number;
  mods: RiftModId[];
  second?: RiftBiome;
  seed: number;
  /** Ends at a boss (`bossRegion`'s) instead of the Guardian room. */
  boss: boolean;
  /** Opened from a shard (shown on the Gate, nothing else). */
  shard: boolean;
  complete: boolean;
}

/** What a character keeps: the highest tier open, the shard stash, and a count of rifts closed. */
export interface RiftSave {
  tier: number;
  shards: RiftShard[];
  clears: number;
  /** Highest tier closed. */
  best: number;
}

/** The character's rift progress (created on first use). */
export function riftSave(data: CharacterData): RiftSave {
  const save = (data.rift ??= { tier: 1, shards: [], clears: 0, best: 0 });
  // Shards from before 2026-10-11 named a region and could carry Ruinous / Convergent: drop what no longer exists.
  if (save.shards.some((s) => 'biome' in s || s.mods.some((m) => !RIFT_MODS[m]))) {
    save.shards = save.shards
      .map(({ uid, tier, mods, second }) => {
        const kept = mods.filter((m) => RIFT_MODS[m]);
        return { uid, tier, mods: kept, ...(kept.some((m) => RIFT_MODS[m].second) ? { second: second && second !== 'forest' ? second : 'mines' } : {}) };
      })
      .filter((s) => s.mods.length);
  }
  return save;
}

/** Rifts open once Dark Falz has fallen on Hell. */
export function riftsOpen(data: CharacterData): boolean {
  return (data.stats.hellKills?.falz ?? 0) > 0;
}

export const BIOME_NAME: Record<RiftBiome, string> = { forest: 'Forest', caves: 'Caves', mines: 'Mines', ruins: 'Ruins' };

/** "Rift · Tier 7". */
export function riftTitle(r: { tier: number }): string {
  return `Rift · Tier ${r.tier}`;
}

/** An open rift with its region: "Rift · Tier 7 · Caves". */
export function riftName(r: Pick<RiftInfo, 'tier' | 'region'>): string {
  return `${riftTitle(r)} · ${BIOME_NAME[r.region]}`;
}

export function modText(m: RiftModId, second?: RiftBiome): string {
  return RIFT_MODS[m].desc.replace('{second}', second ? BIOME_NAME[second] : 'other region');
}

/** Item quantity and rarity bonuses of a set of modifiers, percent. */
export function riftBonus(mods: RiftModId[]): { qty: number; rar: number } {
  return mods.reduce((a, m) => ({ qty: a.qty + RIFT_MODS[m].qty, rar: a.rar + RIFT_MODS[m].rar }), { qty: 0, rar: 0 });
}

/** Item quantity and rarity a rift's tier gives on its own, percent (drops.riftQtyPerTier / riftRarePerTier). */
export function riftTierBonus(tier: number): { qty: number; rar: number } {
  return { qty: Math.round(100 * drops.riftQtyPerTier * tier), rar: Math.round(100 * drops.riftRarePerTier * tier) };
}

/** A rift's whole item quantity and rarity, percent: its tier's, plus its shard's modifiers on top. */
export function riftLoot(r: Pick<RiftInfo, 'tier' | 'mods'>): { qty: number; rar: number } {
  const t = riftTierBonus(r.tier);
  const m = riftBonus(r.mods);
  return { qty: t.qty + m.qty, rar: t.rar + m.rar };
}

/** Item level of a rift's drops. */
export const riftIlvl = (tier: number) => 100 + tier;

const pick = <T>(arr: readonly T[], rng: () => number): T => arr[Math.floor(rng() * arr.length)];

/** A region's field floors: a rift in that region wears one of their looks. */
export const regionFloors = (b: RiftBiome): AreaId[] => expeditions[b].floors.filter((f) => areas[f].kind === 'field');

/**
 * A rift's region, at random (2026-10-14, the user's call: always the Forest got samey, and a random roll can't be
 * gamed the way picking one could). Never the region a Bleeding shard brings in, so Bleeding always adds something.
 */
function rollRegion(rng: () => number, not?: RiftBiome): Pick<RiftInfo, 'region' | 'look'> {
  const region = pick(RIFT_BIOMES.filter((b) => b !== not), rng);
  return { region, look: pick(regionFloors(region), rng) };
}

/** A plain rift from the Gate: no modifiers. */
export function plainRift(tier: number, rng: () => number): RiftInfo {
  return {
    ...rollRegion(rng), bossRegion: pick(RIFT_BIOMES, rng), tier, mods: [],
    seed: Math.floor(rng() * 2 ** 31), boss: rng() < riftCfg.bossChance, shard: false, complete: false,
  };
}

/** A rift opened from a shard. */
export function shardRift(s: RiftShard, rng: () => number): RiftInfo {
  return {
    ...rollRegion(rng, s.mods.includes('bleed') ? s.second : undefined), bossRegion: pick(RIFT_BIOMES, rng),
    tier: s.tier, mods: [...s.mods], second: s.second,
    seed: Math.floor(rng() * 2 ** 31), boss: rng() < riftCfg.bossChance, shard: true, complete: false,
  };
}

/** Regions whose hazards can bleed into a rift (the Forest's are only trees); a rift never rolls its shard's. */
const BLEED_REGIONS: RiftBiome[] = ['caves', 'mines', 'ruins'];

/** A shard dropped in a rift of `tier`: mostly the same tier, now and then one up or down; 1-2 or 3-4 modifiers. */
export function rollShard(tier: number, rng: () => number): RiftShard {
  const r = rng();
  const t = Math.max(1, tier + (r < 0.2 ? 1 : r < 0.3 ? -1 : 0));
  const yellow = rng() < riftCfg.yellow;
  const n = yellow ? 3 + (rng() < 0.5 ? 1 : 0) : 1 + (rng() < 0.5 ? 1 : 0);
  const mods: RiftModId[] = [];
  while (mods.length < n) {
    const options = RIFT_MOD_IDS.filter((m) => !mods.includes(m) && !(RIFT_MODS[m].affix && mods.some((x) => RIFT_MODS[x].affix)));
    mods.push(pick(options, rng));
  }
  const shard: RiftShard = { uid: newUid(), tier: t, mods };
  if (mods.some((m) => RIFT_MODS[m].second)) shard.second = pick(BLEED_REGIONS, rng);
  return shard;
}

/** Yellow shards have 3+ modifiers. */
export const shardRarity = (s: { mods: RiftModId[] }) => (s.mods.length >= 3 ? 'rare' : s.mods.length ? 'magic' : 'normal');

// ------------------------------------------------------------------ scaling

/** Each region's Hell band middle: rifts lift every region to the level cap first. */
const HELL_MID: Record<RiftBiome, number> = { forest: 84.5, caves: 89, mines: 93.5, ruins: 98 };
const CAP = 100;

/**
 * What lifting a region's Hell enemies to Lv 100 adds to their ATP, armour and technique resistance: fitted on
 * 2026-10-14 so a tier 1 rift hits and soaks as it did with DFP and MDF, against tier 15 gear (a Lv 100 player out-gears
 * the Hell bands, so most of these come down).
 */
const RIFT_LIFT: Record<RiftBiome, { atp: number; armor: number; techResist: number }> = {
  forest: { atp: -137, armor: -5, techResist: -7 },
  caves: { atp: -109, armor: -3, techResist: -6 },
  mines: { atp: -80, armor: -2, techResist: -4 },
  ruins: { atp: -52, armor: -1, techResist: -2 },
};
/** The same for each rift boss over its Hell numbers. */
const RIFT_BOSS_LIFT: Record<BossId, { atp: number; armor: number; techResist: number }> = {
  dragon: { atp: -92, armor: -1, techResist: -6 },
  derolle: { atp: -60, armor: -1, techResist: -4 },
  warden: { atp: -32, armor: -1, techResist: -2 },
  falz: { atp: 11, armor: 0, techResist: 0 },
};

/** Each enemy's home expedition: rift enemies scale from their own region's Hell numbers. */
const ENEMY_HOME: Partial<Record<EnemyId, RiftBiome>> = {
  ...Object.fromEntries(RIFT_BIOMES.flatMap((b) => RIFT_ROSTERS[b].map((r) => [r.e, b]))),
  PoisonLily: 'caves', NarLily: 'caves', Hidoom: 'caves', Migium: 'caves',
  ControlNode: 'mines', SparkMite: 'mines', RepairDrone: 'mines',
};
export const enemyHome = (id: EnemyId): RiftBiome => ENEMY_HOME[id] ?? 'ruins';

/**
 * What a tier adds over tier 1: HP and damage multipliers that compound without end, armour %, technique
 * resistance % and boss tempo that stop at `riftCfg.capTier`.
 */
export function riftGrowth(tier: number): { hp: number; dmg: number; armor: number; techResist: number; tempo: number } {
  const k = Math.max(0, tier - 1);
  const kc = Math.min(k, riftCfg.capTier - 1);
  return {
    hp: riftCfg.hpPerTier ** k,
    dmg: riftCfg.dmgPerTier ** k,
    armor: riftCfg.armorPerTier * kc,
    techResist: riftCfg.techResistPerTier * kc,
    tempo: 1 + riftCfg.bossTempoPerTier * kc,
  };
}

/**
 * Field enemy scaling for a rift: the enemy's home region's Hell numbers lifted to Lv 100 (HP by the level
 * ratio^1.5; ATP, armour and technique resistance by RIFT_LIFT), then grown per tier, plus the modifiers. Scaling
 * from each enemy's own region keeps a Booma and a Chaos Bringer as far apart as on Hell. The tier's damage
 * multiplier is on the enemy's whole ATP, so riftArch applies it (this `atp` is added to the enemy's own).
 */
export function riftScale(home: RiftBiome, r: Pick<RiftInfo, 'tier' | 'mods'>): HardScale {
  const h = hell[home];
  const g = riftGrowth(r.tier);
  const has = (m: RiftModId) => r.mods.includes(m);
  return {
    hp: h.hp * (CAP / HELL_MID[home]) ** 1.5 * g.hp * (has('tough') ? 1.4 : 1),
    xp: h.xp,
    meseta: h.meseta * (1 + 0.05 * r.tier),
    atp: h.atp + RIFT_LIFT[home].atp,
    armor: Math.round(h.armor + RIFT_LIFT[home].armor + g.armor),
    techResist: Math.round(h.techResist + RIFT_LIFT[home].techResist + g.techResist),
    dropTier: 15,
    elite: riftElite(r),
  };
}

/** Share of spawns that come in as elites. */
export function riftElite(r: Pick<RiftInfo, 'mods'>): number {
  return Math.min(0.9, riftCfg.elite + (r.mods.includes('elites') ? 0.2 : 0));
}

/**
 * A field enemy's stats in a rift: Hell's tempo and the rift's scaling (from its home region), the modifiers, and
 * its loot (item level, quantity, rarity).
 */
export function riftArch(type: EnemyId, r: Pick<RiftInfo, 'tier' | 'mods'>): EnemyArchetype {
  const a = hardArch(enemies[type], riftScale(enemyHome(type), r));
  const has = (m: RiftModId) => r.mods.includes(m);
  const { qty, rar } = riftLoot(r);
  if (a.atp > 0) a.atp = Math.round(a.atp * riftGrowth(r.tier).dmg * (has('brutal') ? 1.12 : 1));
  if (has('haste')) {
    a.moveSpeed *= 1.2;
    a.recovery /= 1.2;
    a.attackCooldown /= 1.2;
    if (a.shotCooldown !== undefined) a.shotCooldown /= 1.2;
  }
  if (has('swift')) {
    const cut = (t: number) => (t < hardCfg.telegraphFloor ? t : Math.max(hardCfg.telegraphFloor, t * 0.85));
    a.windup = cut(a.windup);
    if (a.shotWindup !== undefined) a.shotWindup = cut(a.shotWindup);
  }
  // More and rarer finds as the tiers climb, a shard's modifiers on top. The drop rate can pass 1: the rest is the
  // chance of a second drop (rollEnemyDrops).
  a.dropRate *= 1 + qty / 100;
  a.ilvl = riftIlvl(r.tier);
  a.lootRare = 1 + rar / 100;
  return a;
}

const BIOME_BOSS: Record<RiftBiome, BossId> = { forest: 'dragon', caves: 'derolle', mines: 'warden', ruins: 'falz' };
export const riftBossOf = (b: RiftBiome): BossId => BIOME_BOSS[b];

/** A rift boss: its Hell scaling (third phase included) lifted to Lv 100 and grown per tier. */
export function riftBossScale(r: Pick<RiftInfo, 'bossRegion' | 'tier' | 'mods'>): HardBossScale {
  const id = BIOME_BOSS[r.bossRegion];
  const b = hell.bosses[id];
  const lift = RIFT_BOSS_LIFT[id];
  const g = riftGrowth(r.tier);
  const brutal = r.mods.includes('brutal') ? 1.12 : 1;
  return {
    ...b,
    hp: b.hp * (CAP / HELL_MID[r.bossRegion]) ** 1.5 * g.hp * (r.mods.includes('tough') ? 1.4 : 1),
    atp: b.atp + lift.atp,
    atpMult: g.dmg * brutal,
    armor: Math.round(b.armor + lift.armor + g.armor),
    techResist: Math.round(b.techResist + lift.techResist + g.techResist),
    flat: b.flat * g.dmg * brutal,
    tempo: g.tempo,
    hell: true,
  };
}

// ------------------------------------------------------------------ areas

const BOSS_AREA: Record<RiftBiome, AreaId> = { forest: 'dragon', caves: 'derolle', mines: 'warden', ruins: 'falz' };

/**
 * Build the rift's floor: generated rooms in its region's own look (one of the region's floors, untinted), music and
 * hazards; waves from every expedition.
 */
export function buildRiftArea(r: RiftInfo): AreaDef {
  const src = areaDef(r.look);
  const { rooms, links } = generateRift({
    biome: r.region,
    seed: r.seed,
    boss: r.boss,
    mixAll: true,
    hazardBiome: r.mods.includes('bleed') ? r.second : undefined,
  });
  return { ...src, id: 'rift', name: riftName(r), elites: true, startYaw: undefined, rooms, links };
}

/** The rift's boss arena: the boss's own, as it looks on its expedition. After the kill, the rift floor's music. */
export function buildRiftBossArea(r: RiftInfo): AreaDef {
  const src = areaDef(BOSS_AREA[r.bossRegion]);
  return { ...src, id: 'riftBoss', name: `Rift Core · ${src.name}`, audio: { ...src.audio, after: areas[r.look].audio.track ?? src.audio.after } };
}

/** Put a rift's two areas in place (the `rift` and `riftBoss` slots of `areas`) before it loads. */
export function setRiftAreas(r: RiftInfo): void {
  areas.rift = buildRiftArea(r);
  areas.riftBoss = buildRiftBossArea(r);
}

/** The enemy the damage estimates (and the ▲ verdicts) measure against in a rift: the average of every roster. */
export function riftFoe(r: Pick<RiftInfo, 'tier' | 'mods'>): Foe {
  const ids = RIFT_BIOMES.flatMap((b) => RIFT_ROSTERS[b].map((x) => x.e));
  const archs = ids.map((id) => riftArch(id, r));
  const avg = (v: (a: EnemyArchetype) => number) => Math.round(archs.reduce((t, a) => t + v(a), 0) / archs.length);
  return { armor: avg((a) => a.armor), techResist: avg((a) => a.techResist ?? 0), label: riftTitle(r as { tier: number }), mainRace: null, bossRace: null };
}

/** Shards in a stash, highest tier first, then the most modifiers. */
export function sortedShards(shards: RiftShard[]): RiftShard[] {
  return [...shards].sort((a, b) => b.tier - a.tier || b.mods.length - a.mods.length);
}

/** Every enemy's forced affix in this rift, if a modifier sets one. */
export function riftForcedAffix(r: RiftInfo | undefined): Affix | undefined {
  return r?.mods.map((m) => RIFT_MODS[m].affix).find((a) => a);
}

/** The modifiers that force an affix (a shard rolls at most one). */
export const RIFT_AFFIX_MODS = AFFIX_MOD_IDS;
