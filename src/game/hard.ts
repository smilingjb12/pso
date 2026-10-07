import { hard, type EnemyArchetype, type HardBossScale, type HardScale } from './config';
import type { BossId, ExpeditionId } from './data/areas';

/** A telegraph on Hard: a little shorter, never below the floor (one already shorter stays). */
export function hardWindup(t: number): number {
  return t < hard.telegraphFloor ? t : Math.max(hard.telegraphFloor, t * hard.telegraphMult);
}

/** Field enemy stats on Hard for one expedition: scaled stats, busier timings, the Hard drop tier. */
export function hardArch(arch: EnemyArchetype, s: HardScale): EnemyArchetype {
  const add = (v: number, by: number) => (v > 0 ? v + by : v);
  return {
    ...arch,
    hp: Math.round(arch.hp * s.hp),
    atp: add(arch.atp, s.atp),
    dfp: arch.dfp + s.dfp,
    ata: add(arch.ata, s.ata),
    evp: arch.evp + s.evp,
    xp: Math.round(arch.xp * s.xp),
    meseta: [Math.round(arch.meseta[0] * s.meseta), Math.round(arch.meseta[1] * s.meseta)],
    dropTier: s.dropTier,
    rarePool: s.rares,
    moveSpeed: arch.moveSpeed * hard.moveMult,
    recovery: arch.recovery * hard.recoveryMult,
    attackCooldown: arch.attackCooldown * hard.cooldownMult,
    windup: hardWindup(arch.windup),
    ...(arch.shotWindup !== undefined ? { shotWindup: hardWindup(arch.shotWindup) } : {}),
    ...(arch.shotCooldown !== undefined ? { shotCooldown: arch.shotCooldown * hard.cooldownMult } : {}),
  };
}

export function hardScale(exp: ExpeditionId): HardScale {
  return hard[exp];
}

export function hardBoss(id: BossId): HardBossScale {
  return hard.bosses[id];
}
