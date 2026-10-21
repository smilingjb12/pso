import type { CharacterData } from './character';
import { CC_AFFIXES, type CcKind } from './ccResist';
import {
  crowdControl as ccCfg, darkFalz as darkFalzCfg, deRolLe as deRolLeCfg, dragon as dragonCfg, drops, enemies, formulas, galGryphon as gryphonCfg,
  hard as hardCfg, hell, warden as wardenCfg, type EnemyArchetype, type EnemyId, type HardBossScale, type HardScale,
} from './config';
import { cutMult } from './formulas';
import { AFFIXES, type Affix } from './data/affixes';
import { areas, expeditions, type AreaDef, type AreaId, type BossId } from './data/areas';
import { isMainBoss, type PinnacleBossId, type RiftBossId } from './data/bosses';
import { areaDef } from './data/looks';
import type { Foe } from './dps';
import { hardArch } from './hard';
import { generateRift, RIFT_ROSTERS } from './riftGen';
import { mapBest, mapDepth, mapFromLadder, type CacheKind, type RiftMapSave, type RoomKind } from './riftMap';
import { RIFT_BIOMES, type RiftBiome } from './riftTypes';

// Falz Rifts (DESIGN.md "Endgame: Falz Rifts"): after the Hell Dark Falz, generated rifts. Since 2026-10-21 the Rift
// Gate opens a map (riftMap.ts) instead of a tier ladder and a stash of Rift Shards: each node is a run of its own. A
// room node is a short generated floor (three fight rooms and the Guardian room, or a Vault or a Gauntlet) in its
// quarter's region (look, music and hazards, untinted) with enemies from every expedition, one expedition a wave, and
// the modifiers it rolled; a boss node is one of the four bosses in its own arena. A rift's item level is 100 + 2 x its
// tier (120 at tier 10), which opens affix tiers 7 and 8 (data/itemAffixes.ts). Ten tiers (2026-10-17: the old 1-20,
// squished), grouped into three Rift Circles whose bosses drop their own uniques (riftCircles.ts). Numbers are first
// drafts; `riftCfg` is live in the tuning panel.

export { RIFT_BIOMES, type RiftBiome };

export const riftCfg = {
  /**
   * The deepest tier (2026-10-17, the user's call: the ladder ends at 10, and the Heart, a final node with its own
   * boss, comes later as the end of the game). The old tiers 1-20 were squished into these ten, so every step is a real one.
   */
  maxTier: 10,
  /**
   * Per tier, compounding: field enemies' HP, bosses' HP (more, so their mechanics stay a test of keeping it up), heavy
   * hits (melee strikes, slams, charges and every boss attack) and chip damage (ranged shots and elite affix side
   * attacks). Damage-first (2026-10-17, the user's call: what gets dangerous is what enemies deal, until a heavy hit
   * almost one-shots at the top). HP first came down to ×1.08 / ×1.15 for quick rooms, but the same day near-top
   * gear (66% Haste, Zonde 49k a cast) killed tier 10 enemies in one cast and bosses in ~22 s, before they could
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
   * hits tiny (about 3% of max HP a hit); at ×8 the average heavy hit is about 26% of a geared character's HP at
   * tier 1 and 135% at tier 10.
   */
  heavyBase: 8,
  chipBase: 4,
  /**
   * How much faster than on Hell each rift boss runs, the same at every tier: attacks, recoveries and telegraphs
   * alike. 2026-10-17, the user's call when the Hell boss mechanics came in: deep rifts get harder through the
   * bosses' damage and HP (the mechanics become a must, and harder to keep flawless), not speed. ×1.15 is the middle
   * of the old ladder (+2% a tier, ×1.0 at tier 1 to ×1.3 from tier 16; 2026-10-12 to 10-17).
   */
  bossTempo: { dragon: 1.15, derolle: 1.15, warden: 1.15, falz: 1.15, gryphon: 1.15 } as Record<RiftBossId, number>,
  /**
   * Every rift boss has the same HP at a tier (2026-10-17, the user's call: De Rol Le felt tankier than Dark Falz):
   * `bossHp` at tier 1, grown per tier (`bossHpPerTier`) and by Tough. 420k is about the four's average before, when
   * each kept its Hell HP lifted to Lv 100 (Dragon 384k, De Rol Le 375k but ~440k to kill through its shell, Warden
   * 390k, Dark Falz 478k). `bossHpMult` is there to trim one whose bar isn't all it takes (all 1: De Rol Le's shell,
   * the one that was, soaks nothing since the same day).
   */
  bossHp: 420000,
  bossHpMult: { dragon: 1, derolle: 1, warden: 1, falz: 1, gryphon: 1 } as Record<RiftBossId, number>,
  /**
   * Crowd-control resistance stops growing at this tier (the old tier 16). Armour and technique resistance no longer
   * grow with the tier at all (2026-10-17: they only made rooms slower).
   */
  capTier: 8,
  /** Share of spawns that come in as elites (the Hell Ruins'), and what the Elites modifier adds. */
  elite: 0.65,
};

// ------------------------------------------------------------------ modifiers

export type RiftModId =
  | 'overclocked' | 'molten' | 'stormcaller' | 'frenzied' | 'regenerating' | 'volatile'
  | 'champions' | 'elites' | 'corruption' | 'bleed' | 'haste' | 'swift' | 'starved' | 'tough' | 'brutal'
  | 'steadfast' | 'insulated' | 'relentless' | 'anchored' | 'swarming';

export interface RiftModDef {
  id: RiftModId;
  name: string;
  /** One line, shown on the map and on entry ("{second}" is the second region's name). */
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

// ------------------------------------------------------------------ rifts

/** One open rift (on its run state): a Rift Map node's run. */
export interface RiftInfo {
  /** The region the floor is drawn from (its look, music and hazards): the node's quarter's. Waves mix every expedition. */
  region: RiftBiome;
  /** Which of the region's floors lends the look (the Caves and Mines have two each, the Ruins two). */
  look: AreaId;
  /** Whose boss a boss node fights (its quarter's; a pinnacle's region only lends the music after the kill). */
  bossRegion: RiftBiome;
  /** A pinnacle node's boss (its own arena; `bossRegion` then names no boss). */
  pinnacle?: PinnacleBossId;
  tier: number;
  mods: RiftModId[];
  second?: RiftBiome;
  seed: number;
  /** A boss node: the fight in the boss's own arena (no floor). */
  boss: boolean;
  /** The Rift Map node this run is (riftMap.ts). */
  node: string;
  /** A room node (three fight rooms and the Guardian room), a Vault, a Gauntlet, or a boss. */
  kind: RoomKind | 'boss';
  /** A room node's cache: what its end drops more of. */
  cache?: CacheKind;
  complete: boolean;
}

/** What a character keeps: the Rift Map, counts, and the Rift Circles' first kills and dry streaks. */
export interface RiftSave {
  /** The deepest tier reached on the map (kept in step with it; the Uniques tab and the damage estimates read it). */
  tier: number;
  clears: number;
  /** Deepest tier with a node cleared. */
  best: number;
  /** 2: tiers squished into 1-10 (2026-10-17). Saves without it have their tiers halved once. */
  ladder?: number;
  /** Rift Circles (riftCircles.ts): the boss + circle kills that already got their first-kill unique ("dragon2"). */
  firsts?: string[];
  /** Rift boss kills in a row without a unique, per boss (raises the next one's odds). */
  dry?: Partial<Record<RiftBossId, number>>;
  /** The Rift Map (2026-10-21): which nodes are open or cleared, their rolls, and Resonance. */
  map?: RiftMapSave;
}

/** A tier on the ladder: 1 to riftCfg.maxTier. */
export const clampTier = (tier: number) => Math.max(1, Math.min(riftCfg.maxTier, Math.round(tier)));

/** An old (1-20, or deeper) tier on today's ladder. */
const squish = (tier: number) => clampTier(Math.ceil(tier / 2));

/** The character's rift progress (created on first use). */
export function riftSave(data: CharacterData): RiftSave {
  const save = (data.rift ??= { tier: 1, clears: 0, best: 0, ladder: 2 });
  if (save.ladder !== 2) {
    // 2026-10-17: the ladder went from endless to ten tiers, two old tiers to each.
    save.tier = squish(save.tier);
    save.best = save.best ? squish(save.best) : 0;
    save.ladder = 2;
  }
  if (!save.map) {
    // 2026-10-21: the Rift Map replaced the tier ladder and Rift Shards. An old ladder carries over (everything below
    // its highest open tier cleared); the shard stash and the picked tier go.
    save.map = mapFromLadder(save.tier, save.best, Math.floor(Math.random() * 2 ** 31));
    const old = save as RiftSave & { shards?: unknown; picked?: unknown };
    delete old.shards;
    delete old.picked;
  }
  return save;
}

/** Keep the save's tier and best in step with the map after a clear. */
export function syncRiftDepth(save: RiftSave): void {
  save.tier = mapDepth(save.map!);
  save.best = Math.max(save.best, mapBest(save.map!));
}

/** Rifts open once Dark Falz has fallen on Hell. */
export function riftsOpen(data: CharacterData): boolean {
  return (data.stats.hellKills?.falz ?? 0) > 0;
}

export const BIOME_NAME: Record<RiftBiome, string> = { forest: 'Forest', caves: 'Caves', mines: 'Mines', ruins: 'Ruins' };

/** Each region's boss (a boss node's `bossRegion` names whose arena it fights in). */
const BIOME_BOSS: Record<RiftBiome, BossId> = { forest: 'dragon', caves: 'derolle', mines: 'warden', ruins: 'falz' };

/** "Rift · Tier 7". */
export function riftTitle(r: { tier: number }): string {
  return `Rift · Tier ${r.tier}`;
}

/** An open rift with its region: "Rift · Tier 7 · Caves", "Rift Vault · Tier 7 · Caves". */
export function riftName(r: Pick<RiftInfo, 'tier' | 'region'> & { kind?: RiftInfo['kind'] }): string {
  const kind = r.kind === 'vault' ? ' Vault' : r.kind === 'gauntlet' ? ' Gauntlet' : '';
  return `Rift${kind} · Tier ${r.tier} · ${BIOME_NAME[r.region]}`;
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

/** A rift's whole item quantity and rarity, percent: its tier's, plus its node's modifiers on top. */
export function riftLoot(r: Pick<RiftInfo, 'tier' | 'mods'>): { qty: number; rar: number } {
  const t = riftTierBonus(r.tier);
  const m = riftBonus(r.mods);
  return { qty: t.qty + m.qty, rar: t.rar + m.rar };
}

/** Item level of a rift's drops: 102 at tier 1, 120 at the top (two a tier, so the squished ladder kept its loot). */
export const riftIlvl = (tier: number) => 100 + 2 * clampTier(tier);

/** A region's field floors: a rift in that region wears one of their looks. */
export const regionFloors = (b: RiftBiome): AreaId[] => expeditions[b].floors.filter((f) => areas[f].kind === 'field');

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
/** The same for each rift boss over its Hell numbers (a pinnacle boss's `rift` block is already its rift numbers). */
const RIFT_BOSS_LIFT: Record<RiftBossId, { atp: number; armor: number; techResist: number }> = {
  dragon: { atp: -92, armor: -1, techResist: -6 },
  derolle: { atp: -60, armor: -1, techResist: -4 },
  warden: { atp: -32, armor: -1, techResist: -2 },
  falz: { atp: 11, armor: 0, techResist: 0 },
  gryphon: { atp: 0, armor: 0, techResist: 0 },
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
  // More and rarer finds as the tiers climb, a node's modifiers on top. The drop rate can pass 1: the rest is the
  // chance of a second drop (rollEnemyDrops).
  a.dropRate *= 1 + qty / 100;
  a.ilvl = riftIlvl(r.tier);
  a.lootRare = 1 + rar / 100;
  return a;
}

export const riftBossOf = (b: RiftBiome): BossId => BIOME_BOSS[b];

/** The boss a boss node fights: a pinnacle's own, else its quarter's. */
export const riftBossId = (r: Pick<RiftInfo, 'bossRegion' | 'pinnacle'>): RiftBossId => r.pinnacle ?? BIOME_BOSS[r.bossRegion];

/** Each boss's own (Normal) stats block: a rift boss's HP multiplier is worked out against its base HP. */
const BOSS_STATS: Record<RiftBossId, { hp: number }> = { dragon: dragonCfg, derolle: deRolLeCfg, warden: wardenCfg, falz: darkFalzCfg, gryphon: gryphonCfg };

/** What the rift lifts a boss from: Hell's boss scaling for the four, a pinnacle boss's own `rift` block. */
function riftBase(id: RiftBossId): HardBossScale {
  return isMainBoss(id) ? hell.bosses[id] : { ...gryphonCfg.rift, hell: true };
}

/** The XP a rift boss's kill gives (its Hell XP; a pinnacle boss's own). */
export const riftBossXp = (id: RiftBossId): number => riftBase(id).xp;

/** A rift boss's max HP: the same for all at a tier (`riftCfg.bossHp`; `bossHpMult` can trim one). */
export function riftBossHp(r: Pick<RiftInfo, 'bossRegion' | 'tier' | 'mods' | 'pinnacle'>): number {
  const id = riftBossId(r);
  return riftCfg.bossHp * riftCfg.bossHpMult[id] * riftGrowth(r.tier).bossHp * (r.mods.includes('tough') ? 1.4 : 1);
}

/**
 * A rift boss: its Hell scaling (third phase included) lifted to Lv 100 and grown per tier, at its fixed rift tempo,
 * with the common rift boss HP (`riftBossHp`).
 */
export function riftBossScale(r: Pick<RiftInfo, 'bossRegion' | 'tier' | 'mods' | 'pinnacle'>): HardBossScale {
  const id = riftBossId(r);
  const b = riftBase(id);
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
/** Each pinnacle boss's arena. */
const PINNACLE_AREA: Record<PinnacleBossId, AreaId> = { gryphon: 'stormPeak' };

/**
 * Build the rift's floor: generated rooms in its region's own look (one of the region's floors, untinted), music and
 * hazards; waves from every expedition.
 */
export function buildRiftArea(r: RiftInfo): AreaDef {
  const src = areaDef(r.look);
  const { rooms, links } = generateRift({
    biome: r.region,
    seed: r.seed,
    boss: false,
    kind: r.kind === 'boss' ? 'room' : r.kind,
    mixAll: true,
    hazardBiome: r.mods.includes('bleed') ? r.second : undefined,
    swarm: r.mods.includes('swarming'),
  });
  return { ...src, id: 'rift', name: riftName(r), elites: true, startYaw: undefined, rooms, links };
}

/** The rift's boss arena: the boss's own, as it looks on its expedition (a pinnacle's own arena). After the kill, the rift floor's music. */
export function buildRiftBossArea(r: RiftInfo): AreaDef {
  const src = areaDef(r.pinnacle ? PINNACLE_AREA[r.pinnacle] : BOSS_AREA[r.bossRegion]);
  return { ...src, id: 'riftBoss', name: `Rift Core · Tier ${r.tier} · ${src.name}`, audio: { ...src.audio, after: areas[r.look].audio.track ?? src.audio.after } };
}

/** Put a node's area in place before it loads: a room node's floor in `rift`, a boss node's arena in `riftBoss`. */
export function setRiftAreas(r: RiftInfo): void {
  if (r.boss) areas.riftBoss = buildRiftBossArea(r);
  else areas.rift = buildRiftArea(r);
}

/** The enemy the damage estimates (and the ▲ verdicts) measure against in a rift: the average of every roster. */
export function riftFoe(r: Pick<RiftInfo, 'tier' | 'mods'>): Foe {
  const ids = RIFT_BIOMES.flatMap((b) => RIFT_ROSTERS[b].map((x) => x.e));
  const archs = ids.map((id) => riftArch(id, r));
  const avg = (v: (a: EnemyArchetype) => number) => Math.round(archs.reduce((t, a) => t + v(a), 0) / archs.length);
  return { techResist: avg((a) => a.techResist ?? 0), label: riftTitle(r as { tier: number }) };
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

/** Every enemy's forced affix in this rift, if a modifier sets one. */
export function riftForcedAffix(r: RiftInfo | undefined): Affix | undefined {
  return r?.mods.map((m) => RIFT_MODS[m].affix).find((a) => a);
}

/** The modifiers that force an affix (a room node rolls at most one). */
export const RIFT_AFFIX_MODS = AFFIX_MOD_IDS;
