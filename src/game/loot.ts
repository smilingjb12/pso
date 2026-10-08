import { makeItem, type ItemInstance } from './character';
import { drops, type EnemyArchetype } from './config';
import { expeditionOfBoss } from './data/areas';
import { BOSS_IDS, BOSSES, type BossId, type ShopUnlock } from './data/bosses';
import {
  armorLines, ATTRS, INJECTOR_MODS, itemDefs, raceCap, specials, weaponKinds, type ArmorLine, type Attr, type InjectorMod, type ItemDef, type SpecialId,
} from './data/items';
import { hardScale } from './hard';

export type Rng = () => number;

/** What drops and shops lean toward: the stat of the character's weapon (ATP blades, ATA guns, MST staves). */
export type LootBias = 'atp' | 'ata' | 'mst';

/** A charge orb: one dose for the equipped injector, taken by walking over it (rolled by the game, not here). */
export type Drop = { kind: 'item'; item: ItemInstance } | { kind: 'meseta'; amount: number } | { kind: 'charge' };

const pick = <T>(arr: readonly T[], rng: Rng): T => arr[Math.floor(rng() * arr.length)];

function weighted<T>(entries: [T, number][], rng: Rng): T {
  const total = entries.reduce((a, [, w]) => a + w, 0);
  let r = rng() * total;
  for (const [v, w] of entries) {
    r -= w;
    if (r <= 0) return v;
  }
  return entries[entries.length - 1][0];
}

const RARE_POOL = ['red_saber', 'flowens_sword', 'varista', 'club_of_laconium'];
const SPECIAL_POOL: SpecialId[] = ['heat', 'ice', 'shock', 'draw', 'dim'];

/** Roll a normal (non-rare) weapon of a given tier with random grind/attributes/special. */
export function rollWeapon(tier: number, rng: Rng, bias?: LootBias): ItemInstance {
  let candidates = Object.values(itemDefs).filter((d) => d.type === 'weapon' && !d.rare && d.tier === tier);
  if (bias && rng() < 0.6) {
    const biased = candidates.filter((d) => d.type === 'weapon' && weaponKinds[d.kind].reqStat === bias);
    if (biased.length) candidates = biased;
  }
  const def = pick(candidates, rng);
  return decorateWeapon(def, tier, rng);
}

function decorateWeapon(def: ItemDef, tier: number, rng: Rng): ItemInstance {
  const inst = makeItem(def.id);
  if (def.type !== 'weapon') return inst;
  // Attributes: 0-2 races plus an occasional Hit%. Race % boosts weapon hits and techs alike, so it
  // stays modest: 10% at tier 1 up to 45% at tier 8.
  const attrs: Partial<Record<Attr, number>> = {};
  const races = ATTRS.filter((a) => a !== 'hit');
  const nAttr = rng() < 0.5 ? 0 : rng() < 0.7 ? 1 : 2;
  const maxPct = raceCap(tier);
  for (let i = 0; i < nAttr; i++) {
    const a = pick(races, rng);
    attrs[a] = Math.max(attrs[a] ?? 0, 5 * (1 + Math.floor(rng() * (maxPct / 5))));
  }
  if (rng() < 0.12) attrs.hit = 5 * (1 + Math.floor(rng() * 3));
  if (Object.keys(attrs).length) inst.attrs = attrs;
  if (!def.special && rng() < 0.18) inst.special = pick(SPECIAL_POOL, rng);
  // Pre-ground drops are Edge levels; caps are only 5-9, so mostly +1.
  if (rng() < 0.2) inst.grind = rng() < 0.25 ? 2 : 1;
  return inst;
}

export function rollRare(rng: Rng, pool = RARE_POOL): ItemInstance {
  const def = itemDefs[pick(pool, rng)];
  const inst = decorateWeapon(def, def.type === 'weapon' ? def.tier : 1, rng);
  delete inst.special; // rares keep their fixed special
  return inst;
}

function rollTier(maxTier: number, rng: Rng): number {
  if (maxTier <= 1) return 1;
  if (maxTier <= 3) return rng() < 0.7 ? 1 : Math.min(maxTier, 2 + (rng() < 0.15 ? 1 : 0));
  // Caves: the top three tiers, weighted toward the low end (T5 is the prize).
  const r = rng();
  return r < 0.5 ? maxTier - 2 : r < 0.85 ? maxTier - 1 : maxTier;
}

const ARMOR_LINES = ['guard', 'combat', 'psy'] as const;

/** A frame or barrier of `tier`; 60% of the time from the line that shares the bias stat (like weapon drops). */
export function rollArmor(tier: number, rng: Rng, bias?: LootBias): ItemInstance {
  const slot = rng() < 0.5 ? 'frame' : 'barrier';
  let lines: readonly ArmorLine[] = ARMOR_LINES;
  if (bias && rng() < 0.6) lines = ARMOR_LINES.filter((l) => armorLines[l].reqStat === bias);
  return makeItem(`${slot}_${pick(lines, rng)}_${tier}`);
}

/** The one consumable left: injector refills are charge orbs now. */
export function rollConsumable(): ItemInstance {
  return makeItem('telepipe');
}

const INJECTOR_MOD_POOL = Object.keys(INJECTOR_MODS) as InjectorMod[];

/** An injector of `tier`: casters (MST bias) lean Fluid, the others Mate; about half roll a mod. */
export function rollInjector(tier: number, rng: Rng, bias?: LootBias, modChance = 0.5, maxTier = 5): ItemInstance {
  const mateOdds = bias === 'mst' ? 0.35 : bias ? 0.65 : 0.5;
  // Normal drops stop at tier 5; tier 6 only comes from Hard bosses and champions (maxTier 6).
  const inst = makeItem(`${rng() < mateOdds ? 'mate' : 'fluid'}_${Math.min(maxTier, tier)}`);
  if (rng() < modChance) inst.mod = pick(INJECTOR_MOD_POOL, rng);
  return inst;
}

/** A grinder (the misc drop since technique disks were removed). Bosses drop two. */
export function rollMisc(rng: Rng): ItemInstance {
  return makeItem(weighted<string>([['monogrinder', 70], ['digrinder', 25], ['trigrinder', 5]], rng));
}

/** Generic drop roll used by enemies and boxes. */
export function rollDrop(
  tier: number, rareRate: number, rng: Rng, bias?: LootBias, mesetaRange: [number, number] = [10, 30], rarePool = RARE_POOL,
): Drop {
  if (rng() < rareRate * drops.rareMult) return { kind: 'item', item: rollRare(rng, rarePool) };
  // Healing comes from injectors now, so consumables are rare and gear shows up more often.
  const cat = weighted<'meseta' | 'consumable' | 'injector' | 'weapon' | 'armor' | 'misc'>(
    [
      // Consumables are only Telepipes since Trimate / Trifluid became charge orbs (same Telepipe rate as before).
      ['meseta', 57],
      ['consumable', 3],
      ['injector', 5],
      // Misc was grinders 45% / technique disks 55%; the disk share went to weapons and armor.
      // Grinders 3 -> 6 with the grind rework (2026-10-07): a clear drops about one weapon's worth of levels.
      ['weapon', 18],
      ['armor', 11],
      ['misc', 6],
    ],
    rng,
  );
  const t = rollTier(tier, rng);
  switch (cat) {
    case 'meseta': {
      const [lo, hi] = mesetaRange;
      return { kind: 'meseta', amount: Math.round(lo + rng() * (hi - lo)) };
    }
    case 'consumable':
      return { kind: 'item', item: rollConsumable() };
    case 'injector':
      return { kind: 'item', item: rollInjector(t, rng, bias) };
    case 'weapon':
      return { kind: 'item', item: rollWeapon(t, rng, bias) };
    case 'armor':
      return { kind: 'item', item: rollArmor(t, rng, bias) };
    case 'misc':
      return { kind: 'item', item: rollMisc(rng) };
  }
}

export function rollEnemyDrop(arch: EnemyArchetype, rng: Rng, bias?: LootBias): Drop | null {
  if (rng() >= arch.dropRate * drops.rateMult) return null;
  return rollDrop(arch.dropTier, arch.rareRate, rng, bias, arch.meseta, arch.rarePool);
}

/**
 * Elites roll an extra drop that always lands, one tier richer and with doubled rare odds (tier 6
 * stays in the Mines, and Hard enemies already drop up to their expedition's top tier).
 */
export function rollEliteBonus(arch: EnemyArchetype, rng: Rng, bias?: LootBias, rareMult = 2): Drop {
  const [lo, hi] = arch.meseta;
  const cap = arch.dropTier >= 6 ? arch.dropTier : 5;
  return rollDrop(Math.min(cap, arch.dropTier + 1), arch.rareRate * rareMult, rng, bias, [lo * 2, hi * 2], arch.rarePool);
}

/** Hard champions: two bonus drops with tripled rare odds, and a chance at a tier 6 injector. */
export function rollChampionBonus(arch: EnemyArchetype, rng: Rng, bias?: LootBias): Drop[] {
  const out = [rollEliteBonus(arch, rng, bias, 3), rollEliteBonus(arch, rng, bias, 3)];
  if (rng() < 0.25) out.push({ kind: 'item', item: rollInjector(6, rng, bias, 1, 6) });
  return out;
}

export function rollBoxDrop(rng: Rng, bias?: LootBias): Drop | null {
  if (rng() >= drops.boxDropRate * drops.rateMult) return null;
  return rollDrop(1, 0.004, rng, bias, [10, 40]);
}

export function rollDragonDrops(rng: Rng, bias?: LootBias): Drop[] {
  const out: Drop[] = [{ kind: 'meseta', amount: 1100 + Math.round(rng() * 400) }];
  if (rng() < 0.3 * drops.rareMult) out.push({ kind: 'item', item: rollRare(rng, ['dragon_slayer', 'dragon_scale']) });
  if (rng() < 0.15 * drops.rareMult) out.push({ kind: 'item', item: rollRare(rng) });
  out.push({ kind: 'item', item: rollWeapon(2 + (rng() < 0.4 ? 1 : 0), rng, bias) });
  out.push({ kind: 'item', item: rollArmor(2, rng, bias) });
  out.push({ kind: 'item', item: rollMisc(rng) }, { kind: 'item', item: rollMisc(rng) });
  return out;
}

export function rollDeRolLeDrops(rng: Rng, bias?: LootBias): Drop[] {
  const out: Drop[] = [{ kind: 'meseta', amount: 2800 + Math.round(rng() * 1200) }];
  if (rng() < 0.35 * drops.rareMult) out.push({ kind: 'item', item: rollRare(rng, ['rol_lance', 'rol_shell']) });
  if (rng() < 0.2 * drops.rareMult) out.push({ kind: 'item', item: rollRare(rng, ['lily_sting', 'spread_needle', 'coral_rod']) });
  out.push({ kind: 'item', item: rollWeapon(4 + (rng() < 0.45 ? 1 : 0), rng, bias) });
  out.push({ kind: 'item', item: rollArmor(4 + (rng() < 0.3 ? 1 : 0), rng, bias) });
  out.push({ kind: 'item', item: rollInjector(4 + (rng() < 0.3 ? 1 : 0), rng, bias, 1) });
  out.push({ kind: 'item', item: rollMisc(rng) }, { kind: 'item', item: rollMisc(rng) });
  return out;
}

/** The Warden: its signature drops (Warden Core, Arc Welder), tier 5-6 gear and a modded injector. */
export function rollWardenDrops(rng: Rng, bias?: LootBias): Drop[] {
  const out: Drop[] = [{ kind: 'meseta', amount: 4000 + Math.round(rng() * 1500) }];
  if (rng() < 0.4 * drops.rareMult) out.push({ kind: 'item', item: rollRare(rng, ['warden_core', 'arc_welder']) });
  if (rng() < 0.15 * drops.rareMult) out.push({ kind: 'item', item: rollRare(rng, ['rol_lance', 'lily_sting', 'spread_needle', 'coral_rod']) });
  out.push({ kind: 'item', item: rollWeapon(rng() < 0.55 ? 6 : 5, rng, bias) });
  out.push({ kind: 'item', item: rng() < 0.3 ? makeItem('barrier_6') : rollArmor(rng() < 0.5 ? 6 : 5, rng, bias) });
  out.push({ kind: 'item', item: rollInjector(5, rng, bias, 1) });
  out.push({ kind: 'item', item: rollMisc(rng) }, { kind: 'item', item: rollMisc(rng) });
  return out;
}

/** Dark Falz: its signature drops (Dark Flow, Seal of Light), tier 6-7 gear and a modded injector. */
export function rollFalzDrops(rng: Rng, bias?: LootBias): Drop[] {
  const out: Drop[] = [{ kind: 'meseta', amount: 5500 + Math.round(rng() * 2000) }];
  if (rng() < 0.4 * drops.rareMult) out.push({ kind: 'item', item: rollRare(rng, ['dark_flow', 'seal_of_light']) });
  if (rng() < 0.15 * drops.rareMult) out.push({ kind: 'item', item: rollRare(rng, ['brionac', 'holy_ray', 'psycho_wand']) });
  out.push({ kind: 'item', item: rollWeapon(rng() < 0.55 ? 7 : 6, rng, bias) });
  out.push({ kind: 'item', item: rollArmor(rng() < 0.5 ? 7 : 6, rng, bias) });
  out.push({ kind: 'item', item: rollInjector(5, rng, bias, 1) });
  out.push({ kind: 'item', item: rollMisc(rng) }, { kind: 'item', item: rollMisc(rng) });
  return out;
}

/** Each boss's Normal loot. */
export const BOSS_DROPS: Record<BossId, (rng: Rng, bias?: LootBias) => Drop[]> = {
  dragon: rollDragonDrops,
  derolle: rollDeRolLeDrops,
  warden: rollWardenDrops,
  falz: rollFalzDrops,
};

/** Each Nightmare boss's signature drop and base Meseta (its top tier and rares are its expedition's, from `hard`). */
const HARD_BOSS_LOOT: Record<BossId, { sig: string; meseta: number }> = {
  dragon: { sig: 'elder_scale', meseta: 9000 },
  derolle: { sig: 'abyssal_carapace', meseta: 13000 },
  warden: { sig: 'overseer_cannon', meseta: 17000 },
  falz: { sig: 'falz_halo', meseta: 22000 },
};

/** Hard bosses: their expedition's top tier, a signature drop, Hard rares and a modded tier 6 injector. */
export function rollHardBossDrops(boss: BossId, rng: Rng, bias?: LootBias): Drop[] {
  const { sig, meseta: base } = HARD_BOSS_LOOT[boss];
  const { dropTier: top, rares } = hardScale(expeditionOfBoss(boss));
  // The +1000 replaced the Trimate and Trifluid they used to drop.
  const out: Drop[] = [{ kind: 'meseta', amount: base + 1000 + Math.round(rng() * base * 0.5) }];
  if (rng() < 0.4 * drops.rareMult) out.push({ kind: 'item', item: rollRare(rng, [sig]) });
  if (rng() < 0.25 * drops.rareMult) out.push({ kind: 'item', item: rollRare(rng, rares) });
  out.push({ kind: 'item', item: rollWeapon(rng() < 0.55 ? top : top - 1, rng, bias) });
  out.push({ kind: 'item', item: rollArmor(rng() < 0.5 ? top : top - 1, rng, bias) });
  out.push({ kind: 'item', item: rollInjector(6, rng, bias, 1, 6) });
  out.push({ kind: 'item', item: rollMisc(rng) }, { kind: 'item', item: rollMisc(rng) });
  return out;
}

export function rollBossDrops(boss: BossId, hard: boolean, rng: Rng, bias?: LootBias): Drop[] {
  return hard ? rollHardBossDrops(boss, rng, bias) : BOSS_DROPS[boss](rng, bias);
}

// ------------------------------------------------------------------ shops

export type ShopKind = 'weapon' | 'armor' | 'item';

/** Bosses this character has beaten on Normal, and on Nightmare (`hard`): each opens shop tiers (BOSSES[id].shop / hardShop). */
export type ShopUnlocks = Partial<Record<BossId, boolean>> & { hard?: Partial<Record<BossId, boolean>> };

/**
 * Highest tier a shop stocks for a given character level: the level ladder up to tier 4, then whatever the
 * bosses beaten open (tier 5 after De Rol Le from Lv 24 ... tier 11 after the Nightmare Dark Falz from Lv 82).
 */
export function shopTier(level: number, u: ShopUnlocks = {}): number {
  let tier = level >= 20 ? 4 : level >= 12 ? 3 : level >= 5 ? 2 : 1;
  const open = (unlocks: ShopUnlock[]) => {
    for (const s of unlocks) if (level >= s.level) tier = Math.max(tier, s.tier);
  };
  for (const id of BOSS_IDS) {
    if (u[id]) open(BOSSES[id].shop);
    if (u.hard?.[id]) open(BOSSES[id].hardShop);
  }
  return tier;
}

export function shopStock(kind: ShopKind, level: number, bias: LootBias, rng: Rng, unlocks: ShopUnlocks = {}): ItemInstance[] {
  const maxTier = shopTier(level, unlocks);
  const out: ItemInstance[] = [];
  if (kind === 'weapon') {
    // Guarantee a few weapons that use the player's weapon stat, then random fill.
    for (let i = 0; i < 9; i++) {
      const tier = Math.max(1, maxTier - (rng() < 0.5 ? 1 : 0));
      const w = rollWeapon(tier, rng, i < 5 ? bias : undefined);
      delete w.grind; // shops sell clean weapons... mostly
      if (rng() < 0.6) delete w.attrs;
      out.push(w);
    }
  } else if (kind === 'armor') {
    // Standard starters, then every line at the two best tiers on sale.
    out.push(makeItem('frame_1'), makeItem('barrier_1'));
    if (maxTier >= 6) out.push(makeItem('barrier_6'));
    for (let t = Math.max(1, maxTier - 1); t <= maxTier; t++) {
      for (const slot of ['frame', 'barrier'] as const) {
        for (const line of ARMOR_LINES) out.push(makeItem(`${slot}_${line}_${t}`));
      }
    }
  } else {
    // Clean injectors: tier 1 and the two best tiers on sale, plus a couple with a mod.
    out.push(makeItem('telepipe'));
    const injTop = Math.min(5, maxTier);
    for (const t of new Set([1, Math.max(1, injTop - 1), injTop])) out.push(makeItem(`mate_${t}`), makeItem(`fluid_${t}`));
    for (let i = 0; i < 2; i++) out.push(rollInjector(Math.max(1, injTop - 1), rng, bias, 1));
  }
  return out;
}

/** Price including attribute/grind premiums. */
export function buyPrice(inst: ItemInstance): number {
  const def = itemDefs[inst.id];
  let p = def.price;
  if (def.type === 'weapon') {
    p += (inst.grind ?? 0) * 250;
    const attrSum = Object.values(inst.attrs ?? {}).reduce((a, b) => a + (b ?? 0), 0);
    p += attrSum * 30;
    if (inst.special && !def.special) p += 600 + 100 * Object.keys(specials).indexOf(inst.special);
  }
  if (inst.mod) p *= 1.4;
  return Math.round(p);
}
