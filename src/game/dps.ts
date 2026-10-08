import { accuracy, attackTypes, casting, combo as comboCfg, enemies, formulas, magCfg, spellForms, type AttackTiming, type AttackType, type EnemyId, type Race } from './config';
import { Combo, hastened, MAX_HITS, type AttackTypeMods, type ComboSettings } from './combo';
import type { Character } from './character';
import { areas, expeditions, type ExpeditionId } from './data/areas';
import { BOSSES } from './data/bosses';
import { techniques, type TechId } from './data/techniques';
import { hitChance, playerDamage } from './formulas';
import { hardArch, hardScale } from './hard';
import { asDifficulty, difficultyTag, type Difficulty } from './difficulty';

// Rough damage-per-second figures for the weapon card, so two weapons can be compared per enemy race.
// Same terms as Combat.hitTarget / finishCast and the real Combo timings, against one average enemy;
// crits, perfect-chain streaks, specials, buffs and TP are left out (they scale every weapon alike).

export const RACES: Race[] = ['native', 'abeast', 'machine', 'dark'];

/** The enemy the estimates are measured against. */
export interface Foe {
  dfp: number;
  evp: number;
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
  return { dfp: avg((a) => a.dfp), evp: avg((a) => a.evp), label: `${expeditions[exp].name}${difficultyTag(diff)}`, mainRace, bossRace };
}

/** Seconds for one combo of these attacks chained at the earliest moment, plus the reset before the next. */
function chainSeconds(settings: ComboSettings, mods: Record<AttackType, AttackTypeMods>, timing: AttackTiming, types: AttackType[]): number {
  const c = new Combo(settings, mods, () => timing);
  const last = types.length - 1;
  return types.reduce((t, type, i) => {
    const s = c.computeTimes(i, type);
    return t + (i < last ? s.windowOpenAt : s.duration);
  }, settings.resetDelay);
}

/** Every light / heavy mix of a full combo. */
const PATTERNS: AttackType[][] = Array.from({ length: 1 << MAX_HITS }, (_, m) =>
  Array.from({ length: MAX_HITS }, (_, i): AttackType => (m & (1 << i) ? 'heavy' : 'light')),
);

export interface DamageEstimate {
  /** Best single-target weapon combo (any light / heavy mix), damage per second by race. */
  weapon: Record<Race, number>;
  /** A chain of heavy casts of `tech`, damage per second by race (casters only). */
  spell: Record<Race, number> | null;
  tech: TechId;
}

/** What `ch` deals per second with what it has equipped now (simulate other gear with simulateEquip). */
export function estimateDamage(ch: Character, foe: Foe, withSpell: boolean): DamageEstimate {
  const kind = ch.weaponKind();
  const s = ch.stats();
  const [lo, hi] = ch.weaponAtp();
  const atp = s.atp + (lo + hi) / 2;
  const rangeMult = kind.ranged ? formulas.rangedDamageMult : formulas.meleeDamageMult;
  const hitBonus = ch.weaponAttr('hit') + (kind.ranged ? 0 : accuracy.meleeBonus);
  const deadeye = ch.hasMagPassive('deadeye');
  const crush = !kind.ranged && ch.hasMagPassive('crush');
  const followThrough = ch.hasMagPassive('followThrough');

  /** Expected damage of one swing on one target: accuracy x hits per swing x damage per hit. */
  const swing = (type: AttackType, index: number, raceMult: number): number => {
    const maxHit = type === 'heavy' && deadeye ? Math.max(attackTypes.heavy.maxHit, magCfg.deadeyeMaxHit) : attackTypes[type].maxHit;
    const chance = Math.min(maxHit, hitChance(s.ata, foe.evp, type, index) + hitBonus) / 100;
    const dfp = type === 'heavy' && crush ? foe.dfp * (1 - magCfg.crushDfpIgnore) : foe.dfp;
    // Melee strikes `hits` times; a light shot hits one target once; a heavy shot fires its whole burst at it.
    const [n, scale] = !kind.ranged ? [kind.hits, 1] : type === 'light' ? [1, 1] : [kind.heavyProjectiles ?? 1, kind.heavyScale ?? 1];
    const finisher = index === MAX_HITS - 1 && followThrough ? magCfg.followThroughMult : 1;
    const dmg = Math.max(formulas.minDamage, playerDamage(atp * raceMult, dfp, type) * kind.damageScale * scale * rangeMult * finisher);
    return chance * n * dmg;
  };
  const swingSecs = PATTERNS.map((p) => chainSeconds(comboCfg, attackTypes, hastened(kind.timing, ch.hasteMult()), p));

  const tech = ch.selectedTech();
  const t = techniques[tech];
  const swift = (ch.hasMagPassive('swiftCast') ? magCfg.swiftCastMult : 1) * ch.hasteMult();
  const castTiming = { windup: t.castTime * swift, active: 0, recovery: t.recovery * casting.recoveryMult * swift };
  const castSecs = chainSeconds(casting, spellForms, castTiming, Array<AttackType>(MAX_HITS).fill('heavy'));
  const perCast = ch.techDamage(tech) * spellForms.heavy.powerMult;

  const weapon = {} as Record<Race, number>;
  const spell = {} as Record<Race, number>;
  for (const race of RACES) {
    const raceMult = 1 + ch.weaponAttr(race) / 100;
    weapon[race] = Math.max(...PATTERNS.map((p, i) => p.reduce((d, type, idx) => d + swing(type, idx, raceMult), 0) / swingSecs[i]));
    spell[race] = (MAX_HITS * perCast * raceMult) / castSecs;
  }
  return { weapon, spell: withSpell ? spell : null, tech };
}
