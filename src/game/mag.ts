import { magCfg, techScaling } from './config';
import { MAG_STATS, type MagStat, type StatKey } from './data/stats';

// The Mag: a companion that grows like PSO's, without the feeding. Pure data + rules, no rendering.
// Every character level gives one point, put into one of four tracks (code keys pow, dex, mind, def). Points are
// permanent: the Mag is the long-term stat dial, while Arts and passives are the flexible part. From magCfg.pbLevel the
// Mag also teaches the photon blasts (2026-10-14; a talent row before): pick one on the Mag tab.

export { MAG_STATS, type MagStat };
/** Each track is named by what its points give (2026-10-14: the PSO names POW / DEX / MIND / DEF were proxy words). */
export const MAG_STAT_LABEL: Record<MagStat, string> = { pow: 'Weapon + HP', dex: 'Weapon + Crit', mind: 'Tech + TP', def: 'Defense + HP' };

/**
 * What one point in each track adds: a main stat plus a secondary every class can use, so each of the four is a real
 * choice for every class (2026-10-08). The crit track (2026-10-09) is a little less weapon damage than the HP one and
 * no HP, plus crit chance for weapons and techniques. Defense is both damage-taken stats. Fractions add up; totals are
 * rounded down.
 */
export const MAG_BONUS: Record<MagStat, Partial<Record<StatKey, number>>> = {
  pow: { atp: 3, hp: 3 },
  dex: { atp: 2.5, lck: 2 },
  mind: { mst: 3, tp: 2 },
  def: { strike: 0.25, area: 0.25, hp: 4 },
};

export type MagData = Record<MagStat, number>;

export type PhotonBlastId = 'mylla' | 'leilla' | 'farlla';

/** The photon blasts (they fire by themselves when the gauge is full, in a fight). */
export const PHOTON_BLASTS: Record<PhotonBlastId, { name: string; desc: () => string }> = {
  mylla: {
    name: 'Mylla & Youlla',
    desc: () => `The twin Mags strike every enemy within ${magCfg.pbMyllaRange} m for ${magCfg.pbMyllaMult}x your basic finisher (or photon bolt). Waits for an enemy in reach.`,
  },
  leilla: {
    name: 'Leilla',
    desc: () => `Heals ${Math.round(magCfg.pbLeillaHeal * 100)}% of max HP and you take ${Math.round((1 - magCfg.pbLeillaMult) * 100)}% less damage for ${magCfg.pbLeillaTime} s.`,
  },
  farlla: {
    name: 'Farlla',
    desc: () => `Weapon damage +${magCfg.pbFarllaPct}% and damage taken −${Math.round(magCfg.pbFarllaPct * techScaling.debandShare)}% for ${techScaling.buffDuration} s.`,
  },
};

export function newMag(): MagData {
  return { pow: 0, dex: 0, mind: 0, def: 0 };
}

/** A stored Mag with anything that isn't a point count dropped. */
export function readMag(raw: unknown): MagData {
  const m = newMag();
  const r = raw as Partial<Record<MagStat, unknown>> | undefined;
  for (const s of MAG_STATS) {
    const v = r?.[s];
    if (typeof v === 'number' && v > 0) m[s] = Math.floor(v);
  }
  return m;
}

/** Points spent = the Mag's level. */
export function magLevel(m: MagData): number {
  return MAG_STATS.reduce((n, s) => n + m[s], 0);
}

/** Points a character of `charLevel` has earned in total (Lv 1 already has one). */
export function magPointsEarned(charLevel: number): number {
  return Math.max(0, Math.floor(charLevel * magCfg.pointsPerLevel));
}

export function magPointsFree(m: MagData, charLevel: number): number {
  return Math.max(0, magPointsEarned(charLevel) - magLevel(m));
}

/** Stat bonuses the Mag gives right now. */
export function magBonuses(m: MagData): Partial<Record<StatKey, number>> {
  const out: Partial<Record<StatKey, number>> = {};
  for (const s of MAG_STATS) {
    if (!m[s]) continue;
    for (const [k, v] of Object.entries(MAG_BONUS[s]) as [StatKey, number][]) out[k] = (out[k] ?? 0) + m[s] * v;
  }
  for (const k of Object.keys(out) as StatKey[]) out[k] = Math.floor(out[k]! + 1e-6);
  return out;
}

/** Put `n` points into a stat (permanent). Returns why not, or null when spent. */
export function magSpend(m: MagData, charLevel: number, stat: MagStat, n = 1): string | null {
  if (!MAG_STATS.includes(stat)) return 'No such Mag stat';
  if (n < 1 || n > magPointsFree(m, charLevel)) return 'No Mag points left. Level up to earn more.';
  m[stat] += n;
  return null;
}

// ------------------------------------------------------------- evolution

export interface MagForm {
  /** 4 is the twin form: two mirrored Mags. */
  stage: 0 | 1 | 2 | 3 | 4;
  name: string;
  color: number;
  /** Stat with the most points (decides the stage 2+ form). */
  lead: MagStat;
  /** Stat the model's gear follows: the class's own up to stage 1, the lead stat after. */
  theme: MagStat;
}

/** Mag levels (points spent) at which the Mag evolves (the last one splits it into a twin pair). */
export const MAG_EVOLVE_AT = [5, 15, 25, 40];

/** Stage 1 form, by the class's own Mag stat. */
export const STAGE1: Record<MagStat, [string, number]> = {
  pow: ['Varuna', 0x4a8aff],
  dex: ['Kalki', 0xff6a5a],
  mind: ['Vritra', 0xb070ff],
  def: ['Bhima', 0xe0a040],
};
export const LEAD_FORMS: Record<MagStat, [string, string, number]> = {
  def: ['Namuci', 'Soma', 0xffc040],
  pow: ['Rudra', 'Sumba', 0xff5030],
  dex: ['Marutah', 'Ila', 0x50e080],
  mind: ['Vayu', 'Mitra', 0x6aa0ff],
};

/** The Mag's form; `own` is the class's Mag stat (stage 0-1 look, and ties). */
export function magForm(m: MagData, own: MagStat): MagForm {
  const total = magLevel(m);
  // Ties go to the class's own stat, then the stat order.
  const lead = [own, ...MAG_STATS].reduce((a, b) => (m[b] > m[a] ? b : a));
  if (total >= MAG_EVOLVE_AT[3]) return { stage: 4, name: 'Ashvinau', color: LEAD_FORMS[lead][2], lead, theme: lead };
  if (total >= MAG_EVOLVE_AT[2]) return { stage: 3, name: LEAD_FORMS[lead][1], color: LEAD_FORMS[lead][2], lead, theme: lead };
  if (total >= MAG_EVOLVE_AT[1]) return { stage: 2, name: LEAD_FORMS[lead][0], color: LEAD_FORMS[lead][2], lead, theme: lead };
  if (total >= MAG_EVOLVE_AT[0]) return { stage: 1, name: STAGE1[own][0], color: STAGE1[own][1], lead, theme: own };
  return { stage: 0, name: 'Mag', color: 0xc8d4e8, lead, theme: own };
}
