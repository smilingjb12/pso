import { makeItem, type CharacterData, type ItemInstance } from './character';
import { drops } from './config';
import { isMainBoss, type RiftBossId } from './data/bosses';
import { getDef } from './data/items';
import { isUniqueUnit, UNIQUE_IDS, UNIQUES, uniqueDropId, type RiftCircle, type UniqueId } from './data/uniques';
import type { RiftSave } from './rifts';

// Rift Circles (2026-10-17, the user's design; DESIGN.md "Rift Circles"): the ten rift tiers in three circles, and
// every boss drops its own uniques, a gear piece and a unit in each. Deeper circles add theirs to the boss's table,
// so each circle's bosses are worth farming for the power to clear the next. The first kill of each boss in each
// circle always drops one of that circle's two (one you lack, if any); after that a kill rolls drops.riftUnique, plus
// drops.riftUniqueDry for every kill of that boss in a row without one.

export const CIRCLES: RiftCircle[] = [1, 2, 3];

/** The tiers each circle covers. */
export const CIRCLE_TIERS: Record<RiftCircle, [number, number]> = { 1: [1, 3], 2: [4, 6], 3: [7, 10] };

/** The circle a rift tier is in. */
export function circleOf(tier: number): RiftCircle {
  return tier >= CIRCLE_TIERS[3][0] ? 3 : tier >= CIRCLE_TIERS[2][0] ? 2 : 1;
}

/** "I", "II", "III". */
export const circleName = (c: RiftCircle): string => ['I', 'II', 'III'][c - 1];

/** A boss's uniques from circle `from` to `to` (inclusive). */
export function bossUniques(boss: RiftBossId, to: RiftCircle, from: RiftCircle = 1): UniqueId[] {
  return UNIQUE_IDS.filter((id) => {
    const u = UNIQUES[id];
    return u.pool === 'rift' && u.boss === boss && (u.circle ?? 1) >= from && (u.circle ?? 1) <= to;
  });
}

/** Does this character have the unique already: a learned unit, or the gear in the bag (worn or not)? */
export function hasFound(data: Pick<CharacterData, 'units' | 'inventory'>, id: UniqueId): boolean {
  return (isUniqueUnit(id) ? data.units : data.inventory).some((it) => getDef(it.id).unique === id);
}

const firstKey = (boss: RiftBossId, c: RiftCircle) => `${boss}${c}`;

/** This boss in this circle still owes its first-kill unique. */
export function firstKillOwed(save: RiftSave, boss: RiftBossId, c: RiftCircle): boolean {
  return !save.firsts?.includes(firstKey(boss, c));
}

/** A later kill's pick in circle `c`: the boss's uniques so far, this circle's two counting double against the earlier circles'. */
function circleWeights(boss: RiftBossId, c: RiftCircle): [UniqueId, number][] {
  return bossUniques(boss, c).map((id) => [id, UNIQUES[id].circle === c ? 2 : 1]);
}

/** The share of its boss's unique drops (after the first kill) that are `id`, fought in circle `c` (0 before its own circle). */
export function bossUniqueShare(id: UniqueId, c: RiftCircle): number {
  const u = UNIQUES[id];
  if (!u.boss) return 0;
  const entries = circleWeights(u.boss, c);
  const total = entries.reduce((a, [, w]) => a + w, 0);
  return (entries.find(([x]) => x === id)?.[1] ?? 0) / Math.max(1, total);
}

/** The chance this boss's next kill (once its circle's first is claimed) drops one of its uniques; `rar`: item rarity, percent. */
export function riftUniqueOdds(save: RiftSave, boss: RiftBossId, rar = 0): number {
  // A pinnacle boss's odds are doubled (base and dry streak): its replay takes Resonance from two quarters.
  const mult = isMainBoss(boss) ? 1 : drops.pinnacleUniqueMult;
  return (drops.riftUnique + drops.riftUniqueDry * (save.dry?.[boss] ?? 0)) * mult * (1 + rar / 100) * drops.rareMult;
}

/**
 * A rift boss just fell at `tier`: the unique it drops, if any (and the save's first-kill and dry-streak marks move
 * on). `rar`: the shard's item rarity, percent, which raises the odds. Gear drops at gear tier 15 and the rift's
 * item level (Rift-forged).
 */
export function rollBossUnique(
  boss: RiftBossId, tier: number, ilvl: number, save: RiftSave, data: Pick<CharacterData, 'units' | 'inventory'>, rng: () => number, rar = 0,
): ItemInstance | null {
  const c = circleOf(tier);
  const dry = (save.dry ??= {});
  let pick: UniqueId | null = null;
  if (firstKillOwed(save, boss, c)) {
    // The first kill in a circle: one of its two, one you don't have if you can.
    const own = bossUniques(boss, c, c);
    const missing = own.filter((id) => !hasFound(data, id));
    const pool = missing.length ? missing : own;
    pick = pool[Math.floor(rng() * pool.length)] ?? null;
    (save.firsts ??= []).push(firstKey(boss, c));
  } else {
    if (rng() < riftUniqueOdds(save, boss, rar)) {
      const entries = circleWeights(boss, c);
      const total = entries.reduce((a, [, w]) => a + w, 0);
      let r = rng() * total;
      for (const [id, w] of entries) {
        r -= w;
        if (r <= 0) {
          pick = id;
          break;
        }
      }
      pick ??= entries[entries.length - 1]?.[0] ?? null;
    }
  }
  if (!pick) {
    dry[boss] = (dry[boss] ?? 0) + 1;
    return null;
  }
  dry[boss] = 0;
  return makeItem(uniqueDropId(pick, 15), isUniqueUnit(pick) ? {} : { ilvl });
}
