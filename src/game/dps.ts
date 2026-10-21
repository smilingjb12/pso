import { basicAttack, combo as comboCfg, enemies, passiveCfg, uniqueCfg, type AttackTiming, type EnemyId } from './config';
import { Combo, MAX_HITS, type ComboSettings } from './combo';
import type { Character } from './character';
import { areas, expeditions, type ExpeditionId } from './data/areas';
import type { ArtId } from './data/arts';
import { isAttackTech, techniques, type TechId } from './data/techniques';
import { critChance, cutMult } from './formulas';
import { hardArch, hardScale } from './hard';
import { asDifficulty, difficultyTag, type Difficulty } from './difficulty';

// Rough damage-per-second figures for the item cards and the Damage tab, so two weapons can be compared. Same terms as
// Combat.boltHit / techHit and the real Combo timings, against one average enemy, with crits averaged in (crit gear
// counts); perfect-chain streaks, buffs and TP are left out. Verdicts measure the main attack technique cast back to
// back (2026-10-14, the Arts redesign).

/** The enemy the estimates are measured against. */
export interface Foe {
  /** % of technique (and photon bolt) damage it shrugs off. */
  techResist: number;
  /** "Forest", "Caves (Nightmare)". */
  label: string;
}

/** The average regular enemy of an expedition (each type counted once; Nightmare scaling applied). */
export function expeditionFoe(exp: ExpeditionId, d: Difficulty | boolean): Foe {
  const diff = asDifficulty(d);
  const hard = diff !== 'normal';
  const ids = new Set<EnemyId>();
  for (const floor of expeditions[exp].floors) {
    for (const room of areas[floor].rooms) {
      for (const wave of room.waves ?? []) for (const s of wave) ids.add(typeof s === 'string' ? s : s.e);
    }
  }
  // Control nodes are switches, not fights.
  const archs = [...ids].map((id) => enemies[id]).filter((a) => a.ai !== 'node').map((a) => (hard ? hardArch(a, hardScale(exp, diff === 'hell')) : a));
  const avg = (v: (a: (typeof archs)[number]) => number) => Math.round(archs.reduce((t, a) => t + v(a), 0) / Math.max(1, archs.length));
  return { techResist: avg((a) => a.techResist ?? 0), label: `${expeditions[exp].name}${difficultyTag(diff)}` };
}

/** Per-step seconds of a chain at the earliest moment: every step to its window, the last to its end, then the reset. */
function stepSeconds(settings: ComboSettings, timing: AttackTiming, steps = MAX_HITS): number[] {
  const c = new Combo(settings, () => timing);
  const last = steps - 1;
  return Array.from({ length: steps }, (_, i) => {
    const s = c.computeTimes(i, 'basic');
    return i < last ? s.windowOpenAt : s.duration + settings.resetDelay;
  });
}

/** Reactor Rod: the average cast multiplier over a 10-cast run (×1, ×1.3 ... up to ×2), for the estimates. */
function reactorMult(ch: Character): number {
  if (!ch.hasUnique('reactorRod')) return 1;
  let total = 0;
  for (let i = 0; i < 10; i++) total += Math.min(uniqueCfg.reactorCap, 1 + uniqueCfg.reactorStep * i);
  return total / 10;
}

/**
 * Frozen Shooter against a regular enemy: anything not frozen takes less, and an ice technique cast back to back
 * freezes, then shatters it on the next cast (the average of the two). 1 without it.
 */
function frozenMult(ch: Character, tech: TechId | null): number {
  if (!ch.hasUnique('frozenShooter')) return 1;
  return tech && techniques[tech].element === 'ice' ? (uniqueCfg.frozenShatterMult + uniqueCfg.frozenOtherMult) / 2 : uniqueCfg.frozenOtherMult;
}

export interface DamageEstimate {
  /** The basic chain (photon bolts) on one target, damage per second. */
  bolt: number;
  /** The main attack technique cast back to back, damage per second. */
  spell: number;
  tech: TechId;
}

/** One basic step's expected damage on one target, crits averaged in: a photon bolt through technique resistance. */
function basicHit(ch: Character, foe: Foe): { hits: number; hit: number; expected: number } {
  const crit = 1 + (critChance(ch.stats().lck) / 100) * (ch.critDamage() - 1);
  const hit = ch.boltDamage() * cutMult(foe.techResist) * frozenMult(ch, null);
  return { hits: 1, hit, expected: hit * crit };
}

/** What `ch` deals per second with what it has equipped now (simulate other gear with simulateEquip). */
export function estimateDamage(ch: Character, foe: Foe): DamageEstimate {
  const secs = stepSeconds(comboCfg, ch.basicTiming());
  const total = secs.reduce((a, b) => a + b, 0);
  const tech = ch.mainTech();
  return { bolt: (basicHit(ch, foe).expected * MAX_HITS) / total, spell: techDps(ch, foe, tech), tech };
}

/** One cast's damage on one target before crits (the technique's single-target share). */
function techCastHit(ch: Character, foe: Foe, tech: TechId): number {
  return ch.techDamage(tech) * (tech === 'foie' || tech === 'zonde' || tech === 'barta' ? ch.pMult('focusBolt', passiveCfg.focusBoltMult) : 1) * cutMult(foe.techResist) * reactorMult(ch) * frozenMult(ch, tech);
}

/** TP one basic chain wins back with every step landing (not perfect), as Combat.basicRefill gives it. */
function basicTpPerChain(ch: Character): number {
  let mult = ch.weaponKind().tpRefill * ch.pMult('siphonStaff', passiveCfg.siphonMult);
  mult *= 1 + ch.gearAffix('tpRefill') / 100;
  return basicAttack.tpRefill * ch.baseTp() * (MAX_HITS - 1 + basicAttack.finisherTp) * mult;
}

/** Seconds per cast of an Art chained back to back (its wind-up and recovery, the reset shared out). */
function artSeconds(ch: Character, id: ArtId): number {
  return stepSeconds(comboCfg, ch.artTiming(id)).reduce((a, b) => a + b, 0) / MAX_HITS;
}

/** The technique cast back to back, damage per second (crits averaged in, TP not counted). */
export function techDps(ch: Character, foe: Foe, tech: TechId): number {
  const crit = 1 + (ch.critChance() / 100) * (ch.critDamage() - 1);
  return (techCastHit(ch, foe, tech) * crit) / artSeconds(ch, tech);
}

// ------------------------------------------------------------------ breakdown (the Damage tab)

/** One step of the basic chain: what it deals and how long it holds the chain. */
export interface SwingStep {
  /** Bolts that land on one target. */
  hits: number;
  /** One bolt's damage, and the same bolt as a crit. */
  hit: number;
  crit: number;
  /** Expected damage of the whole step, crits averaged in. */
  expected: number;
  /** Seconds this step holds the chain (the last one adds the reset before the next chain). */
  secs: number;
}

export interface ComboLine {
  steps: SwingStep[];
  secs: number;
  damage: number;
  dps: number;
}

/** One Art on the bar: one cast on one target, how long it takes and what it costs. */
export interface ArtLine {
  id: ArtId;
  /** Damage of one cast on one target, crits averaged in (0 for Resta). */
  perUse: number;
  /** Seconds one cast holds you (chained back to back, the reset shared out). */
  secs: number;
  dps: number;
  /** Damage per second casting it whenever its TP allows, the basic chain in between refilling the TP (0 for Resta). */
  sustained: number;
  tp: number;
}

export interface DamageBreakdown {
  critChance: number;
  /** How much crits add to damage on average (0.17 = +17%). */
  critGain: number;
  haste: number;
  /** How much faster the basic chain runs thanks to Haste (0.08 = +8% damage / sec). */
  hasteGain: number;
  /** The basic chain: three basic steps. */
  basic: ComboLine;
  /** The Arts on the bar now. */
  arts: ArtLine[];
}

/**
 * The Damage tab's numbers: the same model as `estimateDamage` / `techDps` (single target, nothing misses, crits
 * averaged, Haste and cast speed in the timings, perfect chains and buffs left out), opened up step by step.
 */
export function damageBreakdown(ch: Character, foe: Foe): DamageBreakdown {
  const chance = ch.critChance();
  const critAvg = 1 + (chance / 100) * (ch.critDamage() - 1);

  const chain = (timing: AttackTiming): ComboLine => {
    const secs = stepSeconds(comboCfg, timing);
    const steps = secs.map((s): SwingStep => {
      const b = basicHit(ch, foe);
      return { hits: b.hits, hit: b.hit, crit: b.hit * ch.critDamage(), expected: b.expected, secs: s };
    });
    const total = secs.reduce((a, b) => a + b, 0);
    const damage = steps.reduce((a, st) => a + st.expected, 0);
    return { steps, secs: total, damage, dps: damage / total };
  };
  const basic = chain(ch.basicTiming());
  // Haste's share alone.
  const unhasted = chain(ch.weaponKind().timing);

  const tpPerSec = basicTpPerChain(ch) / basic.secs;
  const arts = ch
    .artBar()
    .filter((id): id is ArtId => !!id && ch.artUsable(id))
    .map((id): ArtLine => {
      const perUse = isAttackTech(id) ? techCastHit(ch, foe, id) * critAvg : 0;
      const secs = artSeconds(ch, id);
      const tp = ch.artCost(id);
      // Bolts between casts, enough to win its TP back.
      const wait = Math.max(tp / tpPerSec, 0);
      const sustained = perUse > 0 ? (perUse + basic.dps * wait) / (secs + wait) : 0;
      return { id, perUse, secs, dps: perUse / secs, sustained, tp };
    });
  return {
    critChance: chance,
    critGain: critAvg - 1,
    haste: ch.haste(),
    hasteGain: basic.dps / unhasted.dps - 1,
    basic,
    arts,
  };
}
