import { attackTypes, comboAccuracy, formulas, type AttackType } from './config';

export type Rng = () => number;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** PSO-style hit chance in percent: ATA * typeMod * comboMod - EVP * 0.2. */
export function hitChance(ata: number, evp: number, type: AttackType, hitIndex: number): number {
  const typeMod = attackTypes[type].accuracyMult;
  const comboMod = comboAccuracy[Math.min(hitIndex, comboAccuracy.length - 1)];
  return clamp(ata * typeMod * comboMod - evp * formulas.evpFactor, 0, 100);
}

/** Player-weapon damage against a defender. */
export function playerDamage(atp: number, dfp: number, type: AttackType): number {
  const raw = ((atp - dfp) / formulas.damageDivisor) * formulas.damageScale * attackTypes[type].damageMult;
  return Math.max(formulas.minDamage, Math.round(raw));
}

/** Enemy damage against the player. Enemies use a flatter curve than weapons. */
export function enemyDamage(atp: number, dfp: number, rng: Rng): number {
  const raw = (atp - dfp) * 0.35 * (0.9 + rng() * 0.2);
  return Math.max(formulas.minDamage, Math.round(raw));
}

/** Enemy accuracy vs player: ATA - EVP * 0.2, straight percentage. */
export function enemyHitChance(ata: number, evp: number): number {
  return clamp(ata - evp * formulas.evpFactor, 0, 100);
}

export function rollPercent(chance: number, rng: Rng): boolean {
  return rng() * 100 < chance;
}

export function randRange(lo: number, hi: number, rng: Rng): number {
  return lo + (hi - lo) * rng();
}
