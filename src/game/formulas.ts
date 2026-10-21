import { formulas } from './config';

export type Rng = () => number;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Crit chance in percent from the crit stat (kept in tenths of a percent), photon bolts and techniques alike; up to critCap. */
export function critChance(lck: number): number {
  return clamp(lck / 10, 0, formulas.critCap);
}

/**
 * Share of a hit that gets through a % cut: an enemy's technique resistance, or the player's damage taken (both plain
 * % since 2026-10-14). Negative resistance means it takes more.
 */
export function cutMult(pct: number): number {
  return 1 - clamp(pct, -100, 95) / 100;
}

/** Enemy damage against the player: its ATP × enemyDamageScale (±10%), less the player's damage taken % (strike or area). */
export function enemyDamage(atp: number, damageTaken: number, rng: Rng): number {
  const raw = atp * formulas.enemyDamageScale * (0.9 + rng() * 0.2) * cutMult(damageTaken);
  return Math.max(formulas.minDamage, Math.round(raw));
}

export function rollPercent(chance: number, rng: Rng): boolean {
  return rng() * 100 < chance;
}

export function randRange(lo: number, hi: number, rng: Rng): number {
  return lo + (hi - lo) * rng();
}
