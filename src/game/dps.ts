import { basicAttack, combo as comboCfg, enemies, formulas, passiveCfg, uniqueCfg, type AttackTiming, type EnemyId, type Race } from './config';
import { Combo, MAX_HITS, type ComboSettings } from './combo';
import type { Character } from './character';
import { areas, expeditions, type ExpeditionId } from './data/areas';
import { ARTS, isTechArt, type ArtId } from './data/arts';
import { BOSSES } from './data/bosses';
import { isAttackTech, type TechId } from './data/techniques';
import { critChance, cutMult, playerDamageRaw } from './formulas';
import { hardArch, hardScale } from './hard';
import { asDifficulty, difficultyTag, type Difficulty } from './difficulty';

// Rough damage-per-second figures for the item cards and the Damage tab, so two weapons can be compared per enemy
// race. Same terms as Combat.weaponHit / techHit and the real Combo timings, against one average enemy, with crits
// averaged in (crit gear counts); perfect-chain streaks, specials, buffs and TP are left out.
// Weapon verdicts measure the basic chain (Arts scale with the same weapon damage); caster verdicts a chain of the
// main attack technique cast back to back (2026-10-14, the Arts redesign: light / heavy mixes went).

export const RACES: Race[] = ['native', 'abeast', 'machine', 'dark'];

/** The enemy the estimates are measured against. */
export interface Foe {
  /** % of weapon damage its armour takes off. */
  armor: number;
  /** % of technique damage it shrugs off. */
  techResist: number;
  /** "Forest", "Caves (Nightmare)". */
  label: string;
  /** The race most of the expedition's enemies are (by spawn count). */
  mainRace: Race | null;
  /** The race of the expedition's boss. */
  bossRace: Race | null;
}

/** The average regular enemy of an expedition (each type counted once; Nightmare scaling applied). */
export function expeditionFoe(exp: ExpeditionId, d: Difficulty | boolean): Foe {
  const diff = asDifficulty(d);
  const hard = diff !== 'normal';
  const ids = new Set<EnemyId>();
  const spawns: Partial<Record<Race, number>> = {};
  let bossRace: Race | null = null;
  for (const floor of expeditions[exp].floors) {
    const boss = areas[floor].boss;
    if (boss) bossRace = BOSSES[boss].race;
    for (const room of areas[floor].rooms) {
      for (const wave of room.waves ?? []) {
        for (const s of wave) {
          const id = typeof s === 'string' ? s : s.e;
          ids.add(id);
          if (enemies[id].ai !== 'node') spawns[enemies[id].race] = (spawns[enemies[id].race] ?? 0) + 1;
        }
      }
    }
  }
  const mainRace = RACES.reduce<Race | null>((best, r) => ((spawns[r] ?? 0) > (best ? (spawns[best] ?? 0) : 0) ? r : best), null);
  // Control nodes are switches, not fights.
  const archs = [...ids].map((id) => enemies[id]).filter((a) => a.ai !== 'node').map((a) => (hard ? hardArch(a, hardScale(exp, diff === 'hell')) : a));
  const avg = (v: (a: (typeof archs)[number]) => number) => Math.round(archs.reduce((t, a) => t + v(a), 0) / Math.max(1, archs.length));
  return { armor: avg((a) => a.armor), techResist: avg((a) => a.techResist ?? 0), label: `${expeditions[exp].name}${difficultyTag(diff)}`, mainRace, bossRace };
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
 * Frozen Shooter: a rifle Art (the chain's 3rd step) freezes, the next chain's first shot shatters it, everything
 * else takes less: the average over a chain's three steps, against a regular enemy. 1 without it.
 */
function frozenMult(ch: Character): number {
  if (!ch.hasUnique('frozenShooter')) return 1;
  return (uniqueCfg.frozenShatterMult + 2 * uniqueCfg.frozenOtherMult) / 3;
}

export interface DamageEstimate {
  /** The basic chain on one target, damage per second by race. */
  weapon: Record<Race, number>;
  /** The main attack technique cast back to back, damage per second by race (casters only). */
  spell: Record<Race, number> | null;
  tech: TechId;
}

/** One basic step's expected damage on one target (`index` in the chain), crits averaged in. */
function basicHit(ch: Character, foe: Foe, raceMult: number, index: number): { hits: number; hit: number; expected: number } {
  const kind = ch.weaponKind();
  const s = ch.stats();
  const crit = 1 + (critChance(s.lck) / 100) * (ch.critDamage() - 1);
  const finisher = index === MAX_HITS - 1 ? ch.pMult('followThrough', passiveCfg.followThroughMult) * (1 + ch.gearAffix('finisherPct') / 100) : 1;
  if (kind.family === 'caster' && ch.weaponInstance()) {
    // A photon bolt: tech damage x the kind's bolt power, through technique resistance.
    const hit = ch.boltDamage() * raceMult * finisher * cutMult(foe.techResist);
    return { hits: 1, hit, expected: hit * crit };
  }
  const [lo, hi] = ch.weaponDamage();
  const rangeMult = kind.ranged ? formulas.rangedDamageMult : formulas.meleeDamageMult;
  // Melee strikes `hits` times; a shot hits one target once.
  const n = kind.ranged ? 1 : kind.hits;
  const hit = Math.max(formulas.minDamage, playerDamageRaw(((lo + hi) / 2) * raceMult, foe.armor, basicAttack.damageMult) * kind.damageScale * rangeMult * finisher * frozenMult(ch));
  return { hits: n, hit, expected: n * hit * crit };
}

/** What `ch` deals per second with what it has equipped now (simulate other gear with simulateEquip). */
export function estimateDamage(ch: Character, foe: Foe, withSpell: boolean): DamageEstimate {
  const secs = stepSeconds(comboCfg, ch.basicTiming());
  const total = secs.reduce((a, b) => a + b, 0);
  const weapon = {} as Record<Race, number>;
  for (const race of RACES) {
    const raceMult = 1 + ch.weaponAttr(race) / 100;
    let dmg = 0;
    for (let i = 0; i < MAX_HITS; i++) dmg += basicHit(ch, foe, raceMult, i).expected;
    weapon[race] = dmg / total;
  }
  const tech = ch.mainTech();
  return { weapon, spell: withSpell ? techDps(ch, foe, tech) : null, tech };
}

/** One cast's damage on one target before crits (the technique's single-target share). */
function techCastHit(ch: Character, foe: Foe, tech: TechId, raceMult: number): number {
  return ch.techDamage(tech) * (tech === 'foie' || tech === 'zonde' || tech === 'barta' ? ch.pMult('focusBolt', passiveCfg.focusBoltMult) : 1) * cutMult(foe.techResist) * raceMult * reactorMult(ch);
}

/** TP one basic chain wins back with every step landing (not perfect), as Combat.basicRefill gives it. */
function basicTpPerChain(ch: Character): number {
  const kind = ch.weaponKind();
  let mult = (kind.tpRefill ?? 1) * ch.pMult('hunterFocus', passiveCfg.focusTpMult) * ch.pMult('rangerFocus', passiveCfg.focusTpMult);
  if (kind.family === 'caster') mult *= ch.pMult('siphonStaff', passiveCfg.siphonMult);
  return basicAttack.tpRefill * ch.baseTp() * (MAX_HITS - 1 + basicAttack.finisherTp) * mult;
}

/** Seconds per cast of an Art chained back to back (its wind-up, channel and recovery, the reset shared out). */
function artSeconds(ch: Character, id: ArtId): number {
  return stepSeconds(comboCfg, ch.artTiming(id)).reduce((a, b) => a + b, 0) / MAX_HITS;
}

/** The technique cast back to back, damage per second by race (crits averaged in, TP not counted). */
export function techDps(ch: Character, foe: Foe, tech: TechId): Record<Race, number> {
  const crit = 1 + (ch.critChance() / 100) * (ch.critDamage() - 1);
  const secs = artSeconds(ch, tech);
  const out = {} as Record<Race, number>;
  for (const race of RACES) out[race] = (techCastHit(ch, foe, tech, 1 + ch.weaponAttr(race) / 100) * crit) / secs;
  return out;
}

// ------------------------------------------------------------------ breakdown (the Damage tab)

/** One step of the basic chain: what it deals and how long it holds the chain. */
export interface SwingStep {
  /** Strikes (melee) or shots that land on one target. */
  hits: number;
  /** One strike's damage, and the same strike as a crit. */
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

/** One Art on the bar: one use on one target (its whole channel), how long it takes and what it costs. */
export interface ArtLine {
  id: ArtId;
  /** Damage of one use on one target, crits averaged in (0 for Arts that don't hit). */
  perUse: number;
  /** Seconds one use holds you (chained back to back, the reset shared out). */
  secs: number;
  dps: number;
  /** Damage per second using it whenever its TP and cooldown allow, the basic chain in between refilling the TP
   *  (0 for Arts that don't hit). */
  sustained: number;
  tp: number;
  cooldown: number;
}

export interface DamageBreakdown {
  /** Damage multiplier from the weapon's race % against the picked race (the average with none). */
  raceMult: number;
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
 * `race` null = the average over the four races.
 */
export function damageBreakdown(ch: Character, foe: Foe, race: Race | null): DamageBreakdown {
  const chance = ch.critChance();
  const critAvg = 1 + (chance / 100) * (ch.critDamage() - 1);
  const raceMult = race ? 1 + ch.weaponAttr(race) / 100 : RACES.reduce((t, r) => t + 1 + ch.weaponAttr(r) / 100, 0) / RACES.length;

  const chain = (timing: AttackTiming): ComboLine => {
    const secs = stepSeconds(comboCfg, timing);
    const steps = secs.map((s, i): SwingStep => {
      const b = basicHit(ch, foe, raceMult, i);
      return { hits: b.hits, hit: b.hit, crit: b.hit * ch.critDamage(), expected: b.expected, secs: s };
    });
    const total = secs.reduce((a, b) => a + b, 0);
    const damage = steps.reduce((a, st) => a + st.expected, 0);
    return { steps, secs: total, damage, dps: damage / total };
  };
  const basic = chain(ch.basicTiming());
  // Haste's share alone (Fervor / Rapid Fire stay in).
  const t = ch.weaponKind().timing;
  const k = ch.swingTimeMult() / ch.hasteMult();
  const unhasted = chain({ ...t, windup: t.windup * k, recovery: t.recovery * k });

  const kind = ch.weaponKind();
  const tpPerSec = basicTpPerChain(ch) / basic.secs;
  const [lo, hi] = ch.weaponDamage();
  const weaponHit = (power: number) =>
    playerDamageRaw(((lo + hi) / 2) * raceMult, foe.armor, power) * kind.damageScale * (kind.ranged ? formulas.rangedDamageMult : formulas.meleeDamageMult) * critAvg;
  const arts = ch
    .artBar()
    .filter((id): id is ArtId => !!id && ch.artUsable(id))
    .map((id): ArtLine => {
      const a = ARTS[id];
      let perUse = 0;
      if (isTechArt(id)) {
        if (isAttackTech(id)) perUse = techCastHit(ch, foe, id, raceMult) * critAvg;
      } else if (a.power > 0) {
        perUse = weaponHit(a.power) * ch.artRankPower(id) * Math.max(1, ch.artTicks(id));
      }
      const secs = artSeconds(ch, id);
      const tp = ch.artCost(id);
      const cooldown = ch.artCooldown(id);
      // Basic swings between uses: enough to win its TP back, or to wait out its cooldown.
      const wait = Math.max(tp / tpPerSec, cooldown - secs, 0);
      const sustained = perUse > 0 ? (perUse + basic.dps * wait) / (secs + wait) : 0;
      return { id, perUse, secs, dps: perUse / secs, sustained, tp, cooldown };
    });
  return {
    raceMult,
    critChance: chance,
    critGain: critAvg - 1,
    haste: ch.haste(),
    hasteGain: basic.dps / unhasted.dps - 1,
    basic,
    arts,
  };
}
