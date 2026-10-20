import { newUid, type CharacterData } from './character';
import { CC_AFFIXES, type CcKind } from './ccResist';
import {
  crowdControl as ccCfg, darkFalz as darkFalzCfg, deRolLe as deRolLeCfg, dragon as dragonCfg, drops, enemies, formulas, hard as hardCfg, hell,
  warden as wardenCfg, type EnemyArchetype, type EnemyId, type HardBossScale, type HardScale,
} from './config';
import { cutMult } from './formulas';
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
// (dropped in rifts) add modifiers that raise item quantity and rarity. A rift's item level is 100 + 2 x its tier
// (120 at tier 10), which opens affix tiers 7 and 8 (data/itemAffixes.ts). Ten tiers (2026-10-17: the old 1-20,
// squished; endless from 2026-10-14 until then), grouped into three Rift Circles whose bosses drop their own uniques
// (riftCircles.ts). Numbers are first drafts; `riftCfg` is live in the tuning panel.

export { RIFT_BIOMES, type RiftBiome };

export const riftCfg = {
  /**
   * The deepest tier (2026-10-17, the user's call: the ladder ends at 10, and a final node with its own boss comes
   * later as the end of the game). The old tiers 1-20 were squished into these ten, so every step is a real one.
   */
  maxTier: 10,
  /**
   * Per tier, compounding: field enemies' HP, bosses' HP (more, so their mechanics stay a test of keeping it up), heavy
   * hits (melee strikes, slams, charges and every boss attack) and chip damage (ranged shots and elite affix side
   * attacks). Damage-first (2026-10-17, the user's call: what gets dangerous is what enemies deal, until a heavy hit
   * almost one-shots at the top). HP first came down to ×1.08 / ×1.15 for quick rooms, but the same day near-top
   * Force gear (66% Haste, Zonde 49k a cast) killed tier 10 enemies in one cast and bosses in ~22 s, before they could
   * swing: field HP went back to the old curve (×1.12 per old tier is ×1.25 per new one, ×7.5 at tier 10), bosses
   * ×1.30 (×10.6), then ×1.40 (×20.7, 8.7M at tier 10) when bosses still died too fast (the user, same day). Gear
   * grows about 5-8× from Hell entry to the top, and HP has to keep pace or the top tiers are a one-cast zone. No
   * Haste cap (the user's call).
   */
  fieldHpPerTier: 1.25,
  bossHpPerTier: 1.4,
  heavyPerTier: 1.2,
  chipPerTier: 1.08,
  /**
   * What heavy hits and chip damage deal at tier 1 over the Hell numbers lifted to Lv 100. Rift gear had made enemy
   * hits tiny (a Hunter took about 1% of max HP a hit, a Force 3%); at ×8 the average heavy hit is about 9% of a
   * geared Hunter's HP at tier 1 and 45% at tier 10 (Ranger 12% / 60%, Force 26% / 135%).
   */
  heavyBase: 8,
  chipBase: 4,
  /**
   * How much faster than on Hell each rift boss runs, the same at every tier: attacks, recoveries and telegraphs
   * alike. 2026-10-17, the user's call when the Hell boss mechanics came in: deep rifts get harder through the
   * bosses' damage and HP (the mechanics become a must, and harder to keep flawless), not speed. ×1.15 is the middle
   * of the old ladder (+2% a tier, ×1.0 at tier 1 to ×1.3 from tier 16; 2026-10-12 to 10-17).
   */
  bossTempo: { dragon: 1.15, derolle: 1.15, warden: 1.15, falz: 1.15 } as Record<BossId, number>,
  /**
   * Every rift boss has the same HP at a tier (2026-10-17, the user's call: De Rol Le felt tankier than Dark Falz):
   * `bossHp` at tier 1, grown per tier (`bossHpPerTier`) and by Tough. 420k is about the four's average before, when
   * each kept its Hell HP lifted to Lv 100 (Dragon 384k, De Rol Le 375k but ~440k to kill through its shell, Warden
   * 390k, Dark Falz 478k). `bossHpMult` is there to trim one whose bar isn't all it takes (all 1: De Rol Le's shell,
   * the one that was, soaks nothing since the same day).
   */
  bossHp: 420000,
  bossHpMult: { dragon: 1, derolle: 1, warden: 1, falz: 1 } as Record<BossId, number>,
  /**
   * Crowd-control resistance stops growing at this tier (the old tier 16). Armour and technique resistance no longer
   * grow with the tier at all (2026-10-17: they only made rooms slower).
   */
  capTier: 8,
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
  /** Chance a shard names the boss its rift ends at (Rift Circles, 2026-10-17). */
  bossShard: 0.3,
};

// ------------------------------------------------------------------ modifiers

export type RiftModId =
  | 'overclocked' | 'molten' | 'stormcaller' | 'frenzied' | 'regenerating' | 'volatile'
  | 'champions' | 'elites' | 'corruption' | 'bleed' | 'haste' | 'swift' | 'starved' | 'tough' | 'brutal'
  | 'steadfast' | 'insulated' | 'relentless' | 'anchored' | 'swarming';

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
  /** Every enemy resists this kind of crowd control, at least ccCfg.riftModFloor % (on top of its own rolls). */
  cc?: CcKind;
  /** Needs a second region (Bleed: whose hazards). */
  second?: boolean;
}

const affixMod = (id: RiftModId & Affix, qty: number, rar: number): RiftModDef => ({
  id, name: AFFIXES[id].name, desc: `Every enemy is ${AFFIXES[id].name}`, qty, rar, affix: id,
});

/** A crowd-control modifier (2026-10-16): every enemy resists one kind, at least ccCfg.riftModFloor %. */
const ccMod = (id: RiftModId, cc: CcKind): RiftModDef => ({
  id, name: CC_AFFIXES[cc].name, desc: `Every enemy resists ${CC_AFFIXES[cc].label} (${ccCfg.riftModFloor}%+)`, qty: 8, rar: 6, cc,
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
  steadfast: ccMod('steadfast', 'stun'),
  insulated: ccMod('insulated', 'freeze'),
  relentless: ccMod('relentless', 'slow'),
  anchored: ccMod('anchored', 'knockback'),
  // 2026-10-17, the user's ask: more enemies a wave; the extra ones are fodder (riftGen.ts RIFT_GEN.swarm).
  swarming: { id: 'swarming', name: 'Swarming', desc: 'Far more enemies in every wave (the extra ones are never elite)', qty: 10, rar: 5 },
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
  /**
   * The boss its rift ends at (2026-10-17, Rift Circles: so a hunt for one boss's uniques can be aimed); unset, a
   * random one. It comes on top of the modifiers and counts as none of them.
   */
  boss?: BossId;
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
  /** 2: tiers squished into 1-10 (2026-10-17). Saves without it have their tiers halved once. */
  ladder?: number;
  /** Rift Circles (riftCircles.ts): the boss + circle kills that already got their first-kill unique ("dragon2"). */
  firsts?: string[];
  /** Rift boss kills in a row without a unique, per boss (raises the next one's odds). */
  dry?: Partial<Record<BossId, number>>;
  /** The tier last picked at the Rift Gate (unset: the top one open). */
  picked?: number;
}

/** A tier on the ladder: 1 to riftCfg.maxTier. */
export const clampTier = (tier: number) => Math.max(1, Math.min(riftCfg.maxTier, Math.round(tier)));

/** An old (1-20, or deeper) tier on today's ladder. */
const squish = (tier: number) => clampTier(Math.ceil(tier / 2));

/** The character's rift progress (created on first use). */
export function riftSave(data: CharacterData): RiftSave {
  const save = (data.rift ??= { tier: 1, shards: [], clears: 0, best: 0, ladder: 2 });
  if (save.ladder !== 2) {
    // 2026-10-17: the ladder went from endless to ten tiers, two old tiers to each.
    save.tier = squish(save.tier);
    save.best = save.best ? squish(save.best) : 0;
    for (const s of save.shards) s.tier = squish(s.tier);
    save.ladder = 2;
  }
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

/** The tier picked at the Rift Gate, within the open ones (the gate opens on it; the debug panel's rift warps use it). */
export function pickedTier(save: RiftSave): number {
  return Math.max(1, Math.min(save.tier, save.picked ?? save.tier));
}

/** Rifts open once Dark Falz has fallen on Hell. */
export function riftsOpen(data: CharacterData): boolean {
  return (data.stats.hellKills?.falz ?? 0) > 0;
}

export const BIOME_NAME: Record<RiftBiome, string> = { forest: 'Forest', caves: 'Caves', mines: 'Mines', ruins: 'Ruins' };

/** Each region's boss (a rift's `bossRegion` names whose arena it ends in), and back. */
const BIOME_BOSS: Record<RiftBiome, BossId> = { forest: 'dragon', caves: 'derolle', mines: 'warden', ruins: 'falz' };
const BOSS_BIOME: Record<BossId, RiftBiome> = { dragon: 'forest', derolle: 'caves', warden: 'mines', falz: 'ruins' };

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

/** Item level of a rift's drops: 102 at tier 1, 120 at the top (two a tier, so the squished ladder kept its loot). */
export const riftIlvl = (tier: number) => 100 + 2 * clampTier(tier);

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

/** A rift opened from a shard (its boss, if it names one). */
export function shardRift(s: RiftShard, rng: () => number): RiftInfo {
  const region = rollRegion(rng, s.mods.includes('bleed') ? s.second : undefined);
  const bossRegion = pick(RIFT_BIOMES, rng);
  return {
    ...region, bossRegion: s.boss ? BOSS_BIOME[s.boss] : bossRegion,
    tier: s.tier, mods: [...s.mods], second: s.second,
    seed: Math.floor(rng() * 2 ** 31), boss: rng() < riftCfg.bossChance, shard: true, complete: false,
  };
}

/** Regions whose hazards can bleed into a rift (the Forest's are only trees); a rift never rolls its shard's. */
const BLEED_REGIONS: RiftBiome[] = ['caves', 'mines', 'ruins'];

/** A shard dropped in a rift of `tier`: mostly the same tier, now and then one up or down; 1-2 or 3-4 modifiers. */
export function rollShard(tier: number, rng: () => number): RiftShard {
  const r = rng();
  const t = clampTier(tier + (r < 0.2 ? 1 : r < 0.3 ? -1 : 0));
  const yellow = rng() < riftCfg.yellow;
  const n = yellow ? 3 + (rng() < 0.5 ? 1 : 0) : 1 + (rng() < 0.5 ? 1 : 0);
  const mods: RiftModId[] = [];
  while (mods.length < n) {
    // At most one elite-affix modifier and one crowd-control modifier a shard.
    const options = RIFT_MOD_IDS.filter((m) => !mods.includes(m)
      && !(RIFT_MODS[m].affix && mods.some((x) => RIFT_MODS[x].affix))
      && !(RIFT_MODS[m].cc && mods.some((x) => RIFT_MODS[x].cc)));
    mods.push(pick(options, rng));
  }
  const shard: RiftShard = { uid: newUid(), tier: t, mods };
  if (mods.some((m) => RIFT_MODS[m].second)) shard.second = pick(BLEED_REGIONS, rng);
  if (rng() < riftCfg.bossShard) shard.boss = BIOME_BOSS[pick(RIFT_BIOMES, rng)];
  return shard;
}

/** "Ends at the Dragon". */
export const shardBossText = (boss: BossId) => `The rift ends at ${BOSS_NAMES[boss]}`;
const BOSS_NAMES: Record<BossId, string> = { dragon: 'the Dragon', derolle: 'De Rol Le', warden: 'the Warden', falz: 'Dark Falz' };

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
 * What a tier adds over tier 1, compounding (damage-first, 2026-10-17): field enemies' HP, bosses' HP, heavy hits and
 * chip damage (riftCfg). Tier-1 damage itself is lifted by `heavyBase` / `chipBase` (riftArch, riftBossScale).
 */
export function riftGrowth(tier: number): { hp: number; bossHp: number; heavy: number; chip: number } {
  const k = clampTier(tier) - 1;
  return {
    hp: riftCfg.fieldHpPerTier ** k,
    bossHp: riftCfg.bossHpPerTier ** k,
    heavy: riftCfg.heavyPerTier ** k,
    chip: riftCfg.chipPerTier ** k,
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
    meseta: h.meseta * (1 + 0.1 * r.tier),
    atp: h.atp + RIFT_LIFT[home].atp,
    armor: Math.round(h.armor + RIFT_LIFT[home].armor),
    techResist: Math.round(h.techResist + RIFT_LIFT[home].techResist),
    dropTier: 15,
    elite: riftElite(r),
  };
}

/**
 * What a rift does to its enemies' crowd-control resistances (ccResist.ts): more strength per tier (up to
 * `capTier`, like armour), one more affix from ccCfg.riftExtraFrom, and the kinds its modifiers give everyone.
 */
export function riftCc(r: Pick<RiftInfo, 'tier' | 'mods'>): { grow: number; extra: number; forced: CcKind[] } {
  const kc = Math.min(Math.max(0, r.tier - 1), riftCfg.capTier - 1);
  return {
    grow: ccCfg.riftPerTier * kc,
    extra: r.tier >= ccCfg.riftExtraFrom ? 1 : 0,
    forced: r.mods.flatMap((m) => RIFT_MODS[m].cc ?? []),
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
  // Heavy hits (strikes, slams, charges) on the enemy's ATP; its ranged shots and affix side attacks take the chip
  // share of that (Combat.enemyArea).
  const g = riftGrowth(r.tier);
  if (a.atp > 0) a.atp = Math.round(a.atp * riftCfg.heavyBase * g.heavy * (has('brutal') ? 1.12 : 1));
  a.chipMult = (riftCfg.chipBase * g.chip) / (riftCfg.heavyBase * g.heavy);
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

export const riftBossOf = (b: RiftBiome): BossId => BIOME_BOSS[b];

/** Each boss's own (Normal) stats block: a rift boss's HP multiplier is worked out against its base HP. */
const BOSS_STATS: Record<BossId, { hp: number }> = { dragon: dragonCfg, derolle: deRolLeCfg, warden: wardenCfg, falz: darkFalzCfg };

/** A rift boss's max HP: the same for all four at a tier (`riftCfg.bossHp`, De Rol Le's trimmed for its shell). */
export function riftBossHp(r: Pick<RiftInfo, 'bossRegion' | 'tier' | 'mods'>): number {
  const id = BIOME_BOSS[r.bossRegion];
  return riftCfg.bossHp * riftCfg.bossHpMult[id] * riftGrowth(r.tier).bossHp * (r.mods.includes('tough') ? 1.4 : 1);
}

/**
 * A rift boss: its Hell scaling (third phase included) lifted to Lv 100 and grown per tier, at its fixed rift tempo,
 * with the common rift boss HP (`riftBossHp`).
 */
export function riftBossScale(r: Pick<RiftInfo, 'bossRegion' | 'tier' | 'mods'>): HardBossScale {
  const id = BIOME_BOSS[r.bossRegion];
  const b = hell.bosses[id];
  const lift = RIFT_BOSS_LIFT[id];
  const g = riftGrowth(r.tier);
  const brutal = r.mods.includes('brutal') ? 1.12 : 1;
  // Every boss attack is a heavy hit, its flat damage (breath and beam ticks, burning zones) too.
  const heavy = riftCfg.heavyBase * g.heavy * brutal;
  return {
    ...b,
    hp: riftBossHp(r) / BOSS_STATS[id].hp,
    atp: b.atp + lift.atp,
    atpMult: heavy,
    armor: Math.round(b.armor + lift.armor),
    techResist: Math.round(b.techResist + lift.techResist),
    flat: b.flat * heavy,
    tempo: riftCfg.bossTempo[id],
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
    swarm: r.mods.includes('swarming'),
  });
  return { ...src, id: 'rift', name: riftName(r), elites: true, startYaw: undefined, rooms, links };
}

/** The rift's boss arena: the boss's own, as it looks on its expedition. After the kill, the rift floor's music. */
export function buildRiftBossArea(r: RiftInfo): AreaDef {
  const src = areaDef(BOSS_AREA[r.bossRegion]);
  return { ...src, id: 'riftBoss', name: `Rift Core · Tier ${r.tier} · ${src.name}`, audio: { ...src.audio, after: areas[r.look].audio.track ?? src.audio.after } };
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
  return { armor: avg((a) => a.armor), techResist: avg((a) => a.techResist ?? 0), label: riftTitle(r as { tier: number }) };
}

/**
 * What a tier's field enemies deal to someone with this much max HP and Strike / Area damage taken cut, as % of max
 * HP: the average heavy hit (a strike at its ATP) over every roster, the hardest one, and the average shot.
 */
export function riftThreat(tier: number, maxHp: number, strikeCut: number, areaCut: number): { heavy: number; hardest: number; chip: number } {
  const archs = RIFT_BIOMES.flatMap((b) => RIFT_ROSTERS[b].map((x) => riftArch(x.e, { tier, mods: [] })));
  const pct = (atp: number, cut: number) => (100 * atp * formulas.enemyDamageScale * cutMult(cut)) / Math.max(1, maxHp);
  const heavy = archs.map((a) => pct(a.atp, strikeCut));
  const chip = archs.map((a) => pct(a.atp * (a.chipMult ?? 1), areaCut));
  const avg = (v: number[]) => v.reduce((t, x) => t + x, 0) / v.length;
  return { heavy: avg(heavy), hardest: Math.max(...heavy), chip: avg(chip) };
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
