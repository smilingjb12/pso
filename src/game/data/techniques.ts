import { techScaling } from '../config';

// Techniques (2026-10-14, the Arts redesign): every attack technique is its own Art, PSO's names in three elements
// and three shapes each, so the name says what it does: the plain one strikes the target, Gi- bursts around (or out
// from) the caster, Ra- covers an area at the target. Resta is a support Art anyone can slot (Shifta and Deband went on
// 2026-10-15, the user's call).
// Tech damage (the `mst` stat) scales them all; TP cost rises with it (the floor keeps damage per TP growing).

export type TechId =
  | 'foie' | 'gifoie' | 'rafoie'
  | 'zonde' | 'gizonde' | 'razonde'
  | 'barta' | 'gibarta' | 'rabarta'
  | 'resta';

export type TechElement = 'fire' | 'lightning' | 'ice';

/**
 * How a technique lands: a homing fireball (`bolt`), lightning chaining between enemies (`chain`), an ice spike
 * under the target (`spike`), a ring around the caster (`nova`), piercing lines in a fan (`lines`), a wave in a cone
 * (`cone`), a delayed meteor on an area (`meteor`), strikes over an area for a while (`storm`), a blizzard around
 * the caster (`blizzard`), or a heal.
 */
export type TechShape = 'bolt' | 'chain' | 'spike' | 'nova' | 'lines' | 'cone' | 'meteor' | 'storm' | 'blizzard' | 'heal';

export interface TechDef {
  id: TechId;
  name: string;
  shape: TechShape;
  /** Fire always burns, ice always chills, lightning may stun. Support techniques have none. */
  element: TechElement | null;
  /**
   * Strength at tech damage = techScaling.mstRef (100): damage for attack techs (Foie's 330 is 3.3x your tech
   * damage per enemy hit), HP for Resta. Tech damage alone scales it.
   */
  power: number;
  /** TP cost at tech damage = techScaling.mstRef (lower pays less, higher more). */
  tp: number;
  /** Seconds from starting the cast until the technique fires. */
  castTime: number;
  /** Seconds the caster stays rooted after it fires. */
  recovery: number;
  /** How far it reaches (to the target, or the size of its shape around the caster). */
  range: number;
  /** Radius of its area (nova, meteor, storm, blizzard, the fireball's splash). */
  radius: number;
  color: number;
  /** Stun chance (lightning). */
  statusChance: number;
  /** Character level it is learned at. */
  level: number;
  desc: string;
}

const FIRE = 0xff6a20;
const BOLT = 0xfff060;
const ICE = 0x80d8ff;

export const techniques: Record<TechId, TechDef> = {
  foie: {
    id: 'foie', name: 'Foie', shape: 'bolt', element: 'fire', power: 510, tp: 10, level: 1,
    castTime: 0.45, recovery: 0.6, range: 18, radius: 1.4, color: FIRE, statusChance: 0,
    desc: 'A homing fireball that bursts on the target (and anything right beside it). Burns.',
  },
  gifoie: {
    id: 'gifoie', name: 'Gifoie', shape: 'nova', element: 'fire', power: 265, tp: 14, level: 15,
    castTime: 0.55, recovery: 0.7, range: 5, radius: 5, color: FIRE, statusChance: 0,
    desc: 'A ring of fire bursting out around you. Burns everything it touches.',
  },
  rafoie: {
    id: 'rafoie', name: 'Rafoie', shape: 'meteor', element: 'fire', power: 460, tp: 18, level: 36,
    castTime: 0.7, recovery: 0.8, range: 16, radius: 4, color: FIRE, statusChance: 0,
    desc: 'A meteor falls on the target a moment later, and the ground there keeps burning.',
  },
  zonde: {
    id: 'zonde', name: 'Zonde', shape: 'chain', element: 'lightning', power: 460, tp: 10, level: 1,
    castTime: 0.45, recovery: 0.6, range: 13, radius: 5, color: BOLT, statusChance: 0.12,
    desc: 'Lightning strikes the target and jumps on to two more enemies nearby. May stun.',
  },
  gizonde: {
    id: 'gizonde', name: 'Gizonde', shape: 'lines', element: 'lightning', power: 355, tp: 14, level: 20,
    castTime: 0.55, recovery: 0.7, range: 9, radius: 0.9, color: BOLT, statusChance: 0.12,
    desc: 'Three bolts of lightning race out ahead in a fan, through everything in their way. May stun.',
  },
  razonde: {
    id: 'razonde', name: 'Razonde', shape: 'storm', element: 'lightning', power: 215, tp: 18, level: 46,
    castTime: 0.7, recovery: 0.8, range: 14, radius: 5, color: BOLT, statusChance: 0.12,
    desc: 'A storm over the target: eight strikes over 3 s on whatever stands under it, at most three on any one enemy. May stun each enemy once.',
  },
  barta: {
    id: 'barta', name: 'Barta', shape: 'spike', element: 'ice', power: 495, tp: 10, level: 1,
    castTime: 0.45, recovery: 0.6, range: 12, radius: 1.2, color: ICE, statusChance: 0,
    desc: 'An ice spike erupts under the target. Chills (slows) it.',
  },
  gibarta: {
    id: 'gibarta', name: 'Gibarta', shape: 'cone', element: 'ice', power: 325, tp: 14, level: 12,
    castTime: 0.55, recovery: 0.7, range: 8, radius: 8, color: ICE, statusChance: 0,
    desc: 'A wave of ice rolls out ahead of you. Chills everything it touches.',
  },
  rabarta: {
    id: 'rabarta', name: 'Rabarta', shape: 'blizzard', element: 'ice', power: 125, tp: 18, level: 28,
    castTime: 0.7, recovery: 0.8, range: 6, radius: 6, color: ICE, statusChance: 0,
    desc: 'A blizzard around you for 3 s: six pulses that chill, and the last one freezes chilled enemies.',
  },
  resta: {
    id: 'resta', name: 'Resta', shape: 'heal', element: null, power: 60, tp: 15, level: 1,
    castTime: 0.6, recovery: 0.45, range: 0, radius: 0, color: 0x70ff9a, statusChance: 0,
    desc: 'Restores HP.',
  },
};

export const TECH_IDS = Object.keys(techniques) as TechId[];

/** Attack techniques deal damage; Resta heals. */
export function isAttackTech(id: TechId): boolean {
  return techniques[id].element !== null;
}

/** Attack techniques, in technique order. */
export const ATTACK_TECHS = TECH_IDS.filter(isAttackTech);

/**
 * Area techniques that go somewhere (Gizonde's lines, Gibarta's cone, Rafoie's meteor, Razonde's storm) go where the
 * camera looks, not where she faces (2026-10-16, the user's ask). The single-target ones go to the camera's target
 * (same day, see Combat "aiming"); the ones around her need no aim.
 */
export function aimsWithCamera(id: TechId): boolean {
  const s = techniques[id].shape;
  return s === 'lines' || s === 'cone' || s === 'meteor' || s === 'storm';
}

/** Tech damage relative to the reference (never below a sliver, so a character with none still casts something). */
function mstRatio(mst: number): number {
  return Math.max(0.01, mst / techScaling.mstRef);
}

/**
 * Base TP cost at this tech damage. More tech damage costs more per cast, but damage grows faster than cost (the
 * cost has a floor), so a Force gets more damage per TP than a dabbler.
 */
export function techTpCost(id: TechId, mst: number): number {
  const f = techScaling.tpFloor;
  return Math.max(1, Math.round(techniques[id].tp * (f + (1 - f) * mstRatio(mst))));
}

/**
 * Attack damage at this tech damage, before the weapon's technique boost, streak and crits: in proportion to it
 * since 2026-10-14 (it grew with MST^1.2 before; enemy technique resistance was refit per band so kill times held).
 */
export function techAttackPower(id: TechId, mst: number): number {
  return techniques[id].power * mstRatio(mst) * techScaling.damageMult;
}

/** HP one Resta restores at this tech damage (before crits). */
export function restaHeal(mst: number): number {
  return Math.round(techniques.resta.power * mstRatio(mst));
}
