import { magCfg } from './config';
import type { StatKey } from './data/classes';
import type { ClassId } from './data/items';

// The Mag: a companion whose growth is a talent grid. Pure data + rules, no rendering.
// Every character level gives one point. Points buy squares on a diamond grid that spreads
// out from the Mag at its centre; a square can only be taken next to one already owned.
// Four arms (POW up, DEX right, MIND down, DEF left) carry flat stat squares, a notable
// passive partway out and a keystone passive at the tip; the diagonals between two arms
// give half of each.

export type MagStat = 'def' | 'pow' | 'dex' | 'mind';
export const MAG_STATS: MagStat[] = ['def', 'pow', 'dex', 'mind'];
export const MAG_STAT_LABEL: Record<MagStat, string> = { def: 'DEF', pow: 'POW', dex: 'DEX', mind: 'MIND' };

/** What one stat square of each arm adds to the character. */
export const MAG_BONUS: Record<MagStat, [StatKey, number]> = {
  def: ['dfp', 2],
  pow: ['atp', 3],
  dex: ['ata', 2],
  mind: ['mst', 3],
};
/** A diagonal (hybrid) square gives this much of each of its two arms' stats. */
const HALF_BONUS: Record<MagStat, number> = { def: 1, pow: 2, dex: 1, mind: 2 };

export type MagPassive = 'bulwark' | 'lastStand' | 'followThrough' | 'crush' | 'rhythm' | 'deadeye' | 'efficiency' | 'clarity';

export const PASSIVE_INFO: Record<MagPassive, { name: string; desc: () => string }> = {
  bulwark: { name: 'Bulwark', desc: () => `Area attacks, boss attacks and hazards deal ${pct(1 - magCfg.bulwarkMult)}% less damage, and Mate injector doses heal ${pct(magCfg.injectorBoost)}% more.` },
  lastStand: { name: 'Last Stand', desc: () => `A hit that would knock you out leaves you at 1 HP instead and fires a free dose from your Mate injector. Recharges after ${magCfg.lastStandCooldown} s.` },
  followThrough: { name: 'Follow-through', desc: () => `Combo finishers (the 3rd hit) deal ${pct(magCfg.followThroughMult - 1)}% more damage.` },
  crush: { name: 'Crush', desc: () => `Heavy attacks ignore ${pct(magCfg.crushDfpIgnore)}% of the enemy's DFP.` },
  rhythm: { name: 'Rhythm', desc: () => `The perfect window is ${magCfg.rhythmBonus.toFixed(2)} s longer, for weapon combos and cast chains, and every perfect chain adds ${magCfg.rhythmCharge} of a dose to each injector.` },
  deadeye: { name: 'Deadeye', desc: () => `Heavy attacks can reach ${magCfg.deadeyeMaxHit}% hit chance (normally 85%), and guns lose half as much accuracy at long range.` },
  efficiency: { name: 'Efficiency', desc: () => `Attack techniques cost ${pct(1 - magCfg.efficiencyTpMult)}% less TP, and Fluid injector doses restore ${pct(magCfg.injectorBoost)}% more.` },
  clarity: { name: 'Clarity', desc: () => `After a Fluid injector dose, attack techniques cost no TP for ${magCfg.clarityTime} s.` },
};
const pct = (f: number) => Math.round(f * 100);

/** [notable, keystone] passive of each arm. */
const ARM_PASSIVES: Record<MagStat, [MagPassive, MagPassive]> = {
  def: ['bulwark', 'lastStand'],
  pow: ['followThrough', 'crush'],
  dex: ['rhythm', 'deadeye'],
  mind: ['efficiency', 'clarity'],
};

export type MagCellKind = 'core' | 'stat' | 'hybrid' | 'notable' | 'keystone';

export interface MagCell {
  /** "x,y" grid offset from the core (y < 0 is up). */
  id: string;
  x: number;
  y: number;
  kind: MagCellKind;
  /** The arm(s) the square belongs to (two for a hybrid, none for the core). */
  stats: MagStat[];
  bonus: Partial<Record<StatKey, number>>;
  passive?: MagPassive;
}

/** Grid radius (Manhattan distance from the core). */
export const MAG_RADIUS = 5;
/** Distance along an arm of its notable; the keystone sits at the tip. */
const NOTABLE_AT = 3;
export const CORE_ID = '0,0';

function armAt(x: number, y: number): MagStat {
  if (Math.abs(y) > Math.abs(x)) return y < 0 ? 'pow' : 'mind';
  return x > 0 ? 'dex' : 'def';
}

function buildGrid(): MagCell[] {
  const cells: MagCell[] = [];
  for (let y = -MAG_RADIUS; y <= MAG_RADIUS; y++) {
    for (let x = -MAG_RADIUS; x <= MAG_RADIUS; x++) {
      const d = Math.abs(x) + Math.abs(y);
      if (d > MAG_RADIUS) continue;
      const id = `${x},${y}`;
      if (d === 0) {
        cells.push({ id, x, y, kind: 'core', stats: [], bonus: {} });
        continue;
      }
      if (x !== 0 && Math.abs(x) === Math.abs(y)) {
        // Diagonal between two arms: half of each.
        const a = y < 0 ? 'pow' : 'mind';
        const b = x > 0 ? 'dex' : 'def';
        const bonus: Partial<Record<StatKey, number>> = {};
        for (const s of [a, b] as MagStat[]) bonus[MAG_BONUS[s][0]] = HALF_BONUS[s];
        cells.push({ id, x, y, kind: 'hybrid', stats: [a, b], bonus });
        continue;
      }
      const arm = armAt(x, y);
      const onAxis = x === 0 || y === 0;
      if (onAxis && d === NOTABLE_AT) cells.push({ id, x, y, kind: 'notable', stats: [arm], bonus: {}, passive: ARM_PASSIVES[arm][0] });
      else if (onAxis && d === MAG_RADIUS) cells.push({ id, x, y, kind: 'keystone', stats: [arm], bonus: {}, passive: ARM_PASSIVES[arm][1] });
      else {
        const [key, v] = MAG_BONUS[arm];
        cells.push({ id, x, y, kind: 'stat', stats: [arm], bonus: { [key]: v } });
      }
    }
  }
  return cells;
}

export const MAG_GRID: MagCell[] = buildGrid();
export const MAG_CELLS: Record<string, MagCell> = Object.fromEntries(MAG_GRID.map((c) => [c.id, c]));

export function neighbours(id: string): string[] {
  const c = MAG_CELLS[id];
  if (!c) return [];
  return [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => `${c.x + dx},${c.y + dy}`).filter((n) => MAG_CELLS[n]);
}

export interface MagData {
  /** Squares bought, in the order they were taken (the core is implied). */
  cells: string[];
}

export function newMag(): MagData {
  return { cells: [] };
}

/** Old saves stored fed stat levels; they get a fresh grid (their points come from the character level). */
export function migrateMag(raw: unknown): MagData {
  const m = raw as Partial<MagData> | undefined;
  if (!m || !Array.isArray(m.cells)) return newMag();
  return { cells: m.cells.filter((id) => typeof id === 'string' && MAG_CELLS[id] && id !== CORE_ID) };
}

/** Points spent = the Mag's level. */
export function magLevel(m: MagData): number {
  return m.cells.length;
}

/** Points a character of `charLevel` has earned in total. */
export function magPointsEarned(charLevel: number): number {
  return Math.max(0, Math.floor(charLevel * magCfg.pointsPerLevel));
}

export function magPointsFree(m: MagData, charLevel: number): number {
  return Math.max(0, magPointsEarned(charLevel) - magLevel(m));
}

/** Stat bonuses the Mag gives right now. */
export function magBonuses(m: MagData): Partial<Record<StatKey, number>> {
  const out: Partial<Record<StatKey, number>> = {};
  for (const id of m.cells) {
    for (const [k, v] of Object.entries(MAG_CELLS[id]?.bonus ?? {})) out[k as StatKey] = (out[k as StatKey] ?? 0) + v;
  }
  return out;
}

export function hasPassive(m: MagData, p: MagPassive): boolean {
  return m.cells.some((id) => MAG_CELLS[id]?.passive === p);
}

/**
 * Why `id` can't be taken next, given the squares owned (plus any already planned), or null if it can.
 * Ignores points; callers check those.
 */
export function cellBlocked(owned: Iterable<string>, id: string): string | null {
  const set = new Set(owned);
  set.add(CORE_ID);
  const c = MAG_CELLS[id];
  if (!c || c.kind === 'core') return 'Not a square';
  if (set.has(id)) return 'Already learned';
  if (!neighbours(id).some((n) => set.has(n))) return 'Take a square next to it first';
  if (c.kind === 'keystone' && set.size - 1 < magCfg.keystoneMinSpent) return `Keystones need ${magCfg.keystoneMinSpent} squares learned first`;
  return null;
}

/** The squares of `ids` still connected to the core (through `owned` and each other). */
export function connected(owned: Iterable<string>, ids: string[]): string[] {
  const all = new Set([CORE_ID, ...owned, ...ids]);
  const seen = new Set([CORE_ID]);
  const queue = [CORE_ID];
  while (queue.length) {
    for (const n of neighbours(queue.pop()!)) {
      if (all.has(n) && !seen.has(n)) {
        seen.add(n);
        queue.push(n);
      }
    }
  }
  return ids.filter((id) => seen.has(id));
}

/** Learn squares in order. All or nothing: returns why not, or null when learned. */
export function learnCells(m: MagData, charLevel: number, ids: string[]): string | null {
  if (ids.length > magPointsFree(m, charLevel)) return 'Not enough Mag points';
  const owned = [...m.cells];
  for (const id of ids) {
    const why = cellBlocked(owned, id);
    if (why) return why;
    owned.push(id);
  }
  m.cells = owned;
  return null;
}

/** Meseta to refund every square (free at low level). */
export function respecCost(m: MagData, charLevel: number): number {
  return charLevel < magCfg.freeRespecBelow ? 0 : magLevel(m) * magCfg.respecCostPerPoint;
}

// ------------------------------------------------------------- evolution

export interface MagForm {
  /** 4 is the twin form: two mirrored Mags. */
  stage: 0 | 1 | 2 | 3 | 4;
  name: string;
  color: number;
  /** Arm with the most squares (decides the stage 2+ form). */
  lead: MagStat;
  /** Arm the model's gear follows: the class's own arm up to stage 1, the lead arm after. */
  theme: MagStat;
}

/** Mag levels (squares learned) at which the Mag evolves (the last one splits it into a twin pair). */
export const MAG_EVOLVE_AT = [5, 15, 25, 40];

export const STAGE1: Record<ClassId, [string, number]> = {
  hunter: ['Varuna', 0x4a8aff],
  ranger: ['Kalki', 0xff6a5a],
  force: ['Vritra', 0xb070ff],
};
export const LEAD_FORMS: Record<MagStat, [string, string, number]> = {
  def: ['Namuci', 'Soma', 0xffc040],
  pow: ['Rudra', 'Sumba', 0xff5030],
  dex: ['Marutah', 'Ila', 0x50e080],
  mind: ['Vayu', 'Mitra', 0x6aa0ff],
};
export const CLASS_ARM: Record<ClassId, MagStat> = { hunter: 'pow', ranger: 'dex', force: 'mind' };

/** Squares per arm (a hybrid counts half for each of its two arms). */
export function armWeights(m: MagData): Record<MagStat, number> {
  const w: Record<MagStat, number> = { def: 0, pow: 0, dex: 0, mind: 0 };
  for (const id of m.cells) {
    const c = MAG_CELLS[id];
    if (c) for (const s of c.stats) w[s] += 1 / c.stats.length;
  }
  return w;
}

export function magForm(m: MagData, classId: ClassId): MagForm {
  const total = magLevel(m);
  const w = armWeights(m);
  const own = CLASS_ARM[classId];
  // Ties go to the class's own arm, then the arm order.
  const lead = [own, ...MAG_STATS].reduce((a, b) => (w[b] > w[a] ? b : a));
  if (total >= MAG_EVOLVE_AT[3]) return { stage: 4, name: 'Ashvinau', color: LEAD_FORMS[lead][2], lead, theme: lead };
  if (total >= MAG_EVOLVE_AT[2]) return { stage: 3, name: LEAD_FORMS[lead][1], color: LEAD_FORMS[lead][2], lead, theme: lead };
  if (total >= MAG_EVOLVE_AT[1]) return { stage: 2, name: LEAD_FORMS[lead][0], color: LEAD_FORMS[lead][2], lead, theme: lead };
  if (total >= MAG_EVOLVE_AT[0]) return { stage: 1, name: STAGE1[classId][0], color: STAGE1[classId][1], lead, theme: own };
  return { stage: 0, name: 'Mag', color: 0xc8d4e8, lead, theme: own };
}
