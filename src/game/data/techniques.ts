import { techScaling } from '../config';

export type TechId = 'foie' | 'zonde' | 'barta' | 'resta' | 'shifta' | 'deband';

export interface TechDef {
  id: TechId;
  name: string;
  kind: 'projectile' | 'bolt' | 'wave' | 'heal' | 'buff';
  /**
   * Strength at MST = techScaling.mstRef: damage for attack techs, HP for Resta, % for buffs.
   * Every class knows every tech; MST alone scales it (see techScaling).
   */
  power: number;
  /** TP cost at MST = techScaling.mstRef (lower MST pays less, higher more). */
  tp: number;
  /** Seconds from starting the cast until the technique fires. */
  castTime: number;
  /** Seconds the caster stays rooted after it fires (scaled by casting.recoveryMult). */
  recovery: number;
  range: number;
  color: number;
  /** Status chance for attack techs (burn / stun / freeze). */
  statusChance: number;
  buffStat?: 'atp' | 'dfp';
  desc: string;
}

export const techniques: Record<TechId, TechDef> = {
  foie: {
    id: 'foie', name: 'Foie', kind: 'projectile', power: 40, tp: 4.5,
    castTime: 0.55, recovery: 0.65, range: 18, color: 0xff6a20, statusChance: 0.15,
    desc: 'Light: a cone of flame. Heavy: a homing fireball. May burn.',
  },
  zonde: {
    id: 'zonde', name: 'Zonde', kind: 'bolt', power: 52, tp: 5.5,
    castTime: 0.5, recovery: 0.75, range: 13, color: 0xfff060, statusChance: 0.12,
    desc: 'Light: lightning that chains to 3 enemies. Heavy: one big bolt. May stun.',
  },
  barta: {
    id: 'barta', name: 'Barta', kind: 'wave', power: 36, tp: 6.5,
    castTime: 0.65, recovery: 0.65, range: 11, color: 0x80d8ff, statusChance: 0.12,
    desc: 'Light: a line of ice that hits everything in its path. Heavy: an ice spike on one target. May freeze.',
  },
  resta: {
    id: 'resta', name: 'Resta', kind: 'heal', power: 60, tp: 5,
    castTime: 0.7, recovery: 0.55, range: 0, color: 0x70ff9a, statusChance: 0,
    desc: 'Restores HP.',
  },
  shifta: {
    id: 'shifta', name: 'Shifta', kind: 'buff', power: 6.5, tp: 6,
    castTime: 0.7, recovery: 0.55, range: 0, color: 0xff5050, statusChance: 0,
    buffStat: 'atp', desc: 'Raises ATP for a while.',
  },
  deband: {
    id: 'deband', name: 'Deband', kind: 'buff', power: 6.5, tp: 6,
    castTime: 0.7, recovery: 0.55, range: 0, color: 0x5090ff, statusChance: 0,
    buffStat: 'dfp', desc: 'Raises DFP for a while.',
  },
};

export const TECH_IDS = Object.keys(techniques) as TechId[];

/** Attack techniques have light (area) and heavy (single target) forms; heal and buffs don't. */
export function isAttackTech(id: TechId): boolean {
  const k = techniques[id].kind;
  return k !== 'heal' && k !== 'buff';
}

/** Attack techniques, in technique order (what the mouse wheel cycles through). */
export const ATTACK_TECHS = TECH_IDS.filter(isAttackTech);

/** MST relative to the reference MST (never below a sliver, so a 0-MST character still casts something). */
function mstRatio(mst: number): number {
  return Math.max(0.01, mst / techScaling.mstRef);
}

/**
 * Base TP cost at this MST. High MST costs more per cast, but attack damage grows faster than cost
 * (mstExp > 1 against a floored, linear cost), so a Force gets more damage per TP than a dabbler.
 */
export function techTpCost(id: TechId, mst: number): number {
  const f = techScaling.tpFloor;
  return Math.max(1, Math.round(techniques[id].tp * (f + (1 - f) * mstRatio(mst))));
}

/** Attack damage at this MST, before the weapon's technique boost, the spell form, streak and crits. */
export function techAttackPower(id: TechId, mst: number): number {
  return techniques[id].power * Math.pow(mstRatio(mst), techScaling.mstExp);
}

/** HP one Resta restores at this MST (before crits). */
export function restaHeal(mst: number): number {
  return Math.round(techniques.resta.power * mstRatio(mst));
}

/** Shifta / Deband boost in % at this MST (before crits), capped. */
export function buffPct(id: TechId, mst: number): number {
  return Math.min(techScaling.buffCap, techniques[id].power * mstRatio(mst));
}
