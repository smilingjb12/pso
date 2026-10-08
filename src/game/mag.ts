import { dash as dashCfg, magCfg } from './config';
import { ATTRIBUTE_INFO, type AttributeId, type AttributePoints, type StatKey } from './data/stats';

// The Mag: a companion whose growth is a talent grid. Pure data + rules, no rendering.
// Every character level gives one point. Points buy squares on a diamond grid that spreads
// out from the Mag at its centre; a square can only be taken next to one already owned, and
// every square is permanent. Four arms (POW up, DEX right, MIND down, DEF left) carry flat
// stat squares, a notable passive 3 squares out and two keystones (5 out and at the tip); the
// diagonals between two arms give half of each, with a two-arm notable 3 squares along each.
// Keystones need squares of their colour and points in their attribute; two-arm notables
// need points in both.

/** The arms are the four attributes (data/stats.ts). */
export type MagStat = AttributeId;
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

export type MagPassive =
  | 'followThrough' | 'breaker' | 'crush'
  | 'fleet' | 'deadeye' | 'rhythm'
  | 'efficiency' | 'clarity' | 'swiftCast'
  | 'bulwark' | 'steadfast' | 'lastStand'
  | 'slipstream' | 'longshot' | 'barrier' | 'retaliate';

const pct = (f: number) => Math.round(f * 100);

export const PASSIVE_INFO: Record<MagPassive, { name: string; desc: () => string }> = {
  followThrough: { name: 'Follow-through', desc: () => `Combo finishers (the 3rd hit) deal ${pct(magCfg.followThroughMult - 1)}% more damage.` },
  breaker: { name: 'Breaker', desc: () => `Melee hits fill enemy stagger meters ${pct(magCfg.breakerMult - 1)}% faster.` },
  crush: { name: 'Crush', desc: () => `Heavy melee attacks ignore ${pct(magCfg.crushDfpIgnore)}% of the enemy's DFP.` },
  fleet: { name: 'Fleet', desc: () => `+${magCfg.fleetCharges} dash charge (${dashCfg.charges + magCfg.fleetCharges} instead of ${dashCfg.charges}).` },
  deadeye: { name: 'Deadeye', desc: () => `Heavy attacks can reach ${magCfg.deadeyeMaxHit}% hit chance (normally 85%), and guns lose half as much accuracy at long range.` },
  rhythm: { name: 'Rhythm', desc: () => `The perfect window is ${magCfg.rhythmBonus.toFixed(2)} s longer, for weapon combos and cast chains, and you run ${pct(magCfg.rhythmRunMult - 1)}% faster.` },
  efficiency: { name: 'Efficiency', desc: () => `Attack techniques cost ${pct(1 - magCfg.efficiencyTpMult)}% less TP, and Fluid injector doses restore ${pct(magCfg.injectorBoost)}% more.` },
  clarity: { name: 'Clarity', desc: () => `After a Fluid injector dose, attack techniques cost no TP for ${magCfg.clarityTime} s.` },
  swiftCast: { name: 'Swift Cast', desc: () => `Techniques cast ${pct(1 - magCfg.swiftCastMult)}% faster (wind-up and recovery), Resta and buffs included.` },
  bulwark: { name: 'Bulwark', desc: () => `Area attacks, boss attacks and hazards deal ${pct(1 - magCfg.bulwarkMult)}% less damage, and Mate injector doses heal ${pct(magCfg.injectorBoost)}% more.` },
  steadfast: { name: 'Steadfast', desc: () => `Every melee swing carries Poise: a hit between the start of the swing and its strike still hurts but doesn't cancel it. You take ${pct(1 - magCfg.steadfastKnockback)}% less knockback.` },
  lastStand: { name: 'Last Stand', desc: () => `A hit that would knock you out leaves you at 1 HP instead and fires a free dose from your Mate injector. Recharges after ${magCfg.lastStandCooldown} s.` },
  slipstream: { name: 'Slipstream', desc: () => `Dash out of an enemy's telegraph and your next attack or cast within ${magCfg.slipstreamTime} s lands perfect, as if chained on time.` },
  longshot: { name: 'Longshot', desc: () => `Guns and techniques deal ${pct(magCfg.longshotMult - 1)}% more damage to enemies more than ${magCfg.longshotRange} m away.` },
  barrier: { name: 'Barrier', desc: () => `Resta healing past full HP becomes a shield (up to ${pct(magCfg.barrierCap)}% of max HP) that fades over ${magCfg.barrierFade} s.` },
  retaliate: { name: 'Retaliate', desc: () => `After an enemy hits you, your next melee swing within ${magCfg.retaliateTime} s deals ${pct(magCfg.retaliateMult - 1)}% more damage.` },
};

/** [notable, keystone I, keystone II] of each arm, from the core outward. */
export const ARM_PASSIVES: Record<MagStat, [MagPassive, MagPassive, MagPassive]> = {
  pow: ['followThrough', 'breaker', 'crush'],
  dex: ['fleet', 'deadeye', 'rhythm'],
  mind: ['efficiency', 'clarity', 'swiftCast'],
  def: ['bulwark', 'steadfast', 'lastStand'],
};

/** The two-arm notable on each diagonal (POW up, DEX right, MIND down, DEF left). */
const HYBRID_PASSIVES: Record<string, MagPassive> = {
  '3,-3': 'slipstream', // POW + DEX
  '3,3': 'longshot', // MIND + DEX
  '-3,3': 'barrier', // MIND + DEF
  '-3,-3': 'retaliate', // POW + DEF
};

export type MagCellKind = 'core' | 'stat' | 'hybrid' | 'notable' | 'keystone';

export interface MagCell {
  /** "x,y" grid offset from the core (y < 0 is up). */
  id: string;
  x: number;
  y: number;
  kind: MagCellKind;
  /** The arm(s) the square belongs to (two for a hybrid or a two-arm notable, none for the core). */
  stats: MagStat[];
  bonus: Partial<Record<StatKey, number>>;
  passive?: MagPassive;
  /** Keystones: 1 (ring 5) or 2 (the tip). */
  tier?: 1 | 2;
}

/** Grid radius (Manhattan distance from the core). */
export const MAG_RADIUS = 7;
/** Distance along an arm of its notable and its two keystones. */
const NOTABLE_AT = 3;
const KEYSTONE_AT = [5, 7];
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
        // Diagonal between two arms: half of each, or the two-arm notable.
        const pair: MagStat[] = [y < 0 ? 'pow' : 'mind', x > 0 ? 'dex' : 'def'];
        if (HYBRID_PASSIVES[id]) {
          cells.push({ id, x, y, kind: 'notable', stats: pair, bonus: {}, passive: HYBRID_PASSIVES[id] });
          continue;
        }
        const bonus: Partial<Record<StatKey, number>> = {};
        for (const s of pair) bonus[MAG_BONUS[s][0]] = HALF_BONUS[s];
        cells.push({ id, x, y, kind: 'hybrid', stats: pair, bonus });
        continue;
      }
      const arm = armAt(x, y);
      const onAxis = x === 0 || y === 0;
      const ks = KEYSTONE_AT.indexOf(d);
      if (onAxis && d === NOTABLE_AT) cells.push({ id, x, y, kind: 'notable', stats: [arm], bonus: {}, passive: ARM_PASSIVES[arm][0] });
      else if (onAxis && ks >= 0) cells.push({ id, x, y, kind: 'keystone', stats: [arm], bonus: {}, passive: ARM_PASSIVES[arm][ks + 1], tier: (ks + 1) as 1 | 2 });
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

/** A stored Mag with anything that isn't a square of this grid dropped. */
export function readMag(raw: unknown): MagData {
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

/** Squares learned that carry an arm's colour (hybrids and two-arm notables count for both of theirs). */
export function armSquares(owned: Iterable<string>, arm: MagStat): number {
  let n = 0;
  for (const id of owned) if (MAG_CELLS[id]?.stats.includes(arm)) n++;
  return n;
}

/** What a square needs besides a learned neighbour: squares of its colour and attribute points. */
export interface MagReq {
  squares?: { arm: MagStat; n: number };
  points: { attr: AttributeId; n: number }[];
}

export function cellReq(c: MagCell): MagReq | null {
  if (c.kind === 'keystone' && c.tier) {
    const r = magCfg.keystoneReq[c.tier - 1];
    return { squares: { arm: c.stats[0], n: r.squares }, points: [{ attr: c.stats[0], n: r.points }] };
  }
  if (c.kind === 'notable' && c.stats.length === 2) return { points: c.stats.map((attr) => ({ attr, n: magCfg.hybridReqPoints })) };
  return null;
}

/** "8 MIND squares · MIND 45": a square's requirements as one line ('' if it has none). */
export function reqText(c: MagCell): string {
  const r = cellReq(c);
  if (!r) return '';
  const parts = r.squares ? [`${r.squares.n} ${MAG_STAT_LABEL[r.squares.arm]} squares`] : [];
  for (const p of r.points) parts.push(`${ATTRIBUTE_INFO[p.attr].label} ${p.n}`);
  return parts.join(' · ');
}

/**
 * Why `id` can't be taken next, given the squares owned and the character's attribute points, or null if
 * it can. Ignores Mag points; callers check those.
 */
export function cellBlocked(owned: Iterable<string>, id: string, points: AttributePoints): string | null {
  const set = new Set(owned);
  set.add(CORE_ID);
  const c = MAG_CELLS[id];
  if (!c || c.kind === 'core') return 'Not a square';
  if (set.has(id)) return 'Already learned';
  if (!neighbours(id).some((n) => set.has(n))) return 'Take a square next to it first';
  const r = cellReq(c);
  if (r?.squares) {
    const have = armSquares(set, r.squares.arm);
    if (have < r.squares.n) return `Needs ${r.squares.n} ${MAG_STAT_LABEL[r.squares.arm]} squares learned (you have ${have})`;
  }
  for (const p of r?.points ?? []) {
    if (points[p.attr] < p.n) return `Needs ${ATTRIBUTE_INFO[p.attr].label} ${p.n} (you have ${points[p.attr]})`;
  }
  return null;
}

/** Learn squares in order. All or nothing: returns why not, or null when learned. Learned squares are permanent. */
export function learnCells(m: MagData, charLevel: number, points: AttributePoints, ids: string[]): string | null {
  if (ids.length > magPointsFree(m, charLevel)) return 'Not enough Mag points';
  const owned = [...m.cells];
  for (const id of ids) {
    const why = cellBlocked(owned, id, points);
    if (why) return why;
    owned.push(id);
  }
  m.cells = owned;
  return null;
}

// ------------------------------------------------------------- evolution

export interface MagForm {
  /** 4 is the twin form: two mirrored Mags. */
  stage: 0 | 1 | 2 | 3 | 4;
  name: string;
  color: number;
  /** Arm with the most squares (decides the stage 2+ form). */
  lead: MagStat;
  /** Arm the model's gear follows: the character's leading attribute up to stage 1, the lead arm after. */
  theme: MagStat;
}

/** Mag levels (squares learned) at which the Mag evolves (the last one splits it into a twin pair). */
export const MAG_EVOLVE_AT = [5, 15, 25, 40];

/** Stage 1 form, by the character's leading attribute. */
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

/** Squares per arm (a hybrid counts half for each of its two arms). */
export function armWeights(m: MagData): Record<MagStat, number> {
  const w: Record<MagStat, number> = { def: 0, pow: 0, dex: 0, mind: 0 };
  for (const id of m.cells) {
    const c = MAG_CELLS[id];
    if (c) for (const s of c.stats) w[s] += 1 / c.stats.length;
  }
  return w;
}

/** The Mag's form; `own` is the character's leading attribute (stage 0-1 look, and ties). */
export function magForm(m: MagData, own: MagStat): MagForm {
  const total = magLevel(m);
  const w = armWeights(m);
  // Ties go to the character's own attribute, then the arm order.
  const lead = [own, ...MAG_STATS].reduce((a, b) => (w[b] > w[a] ? b : a));
  if (total >= MAG_EVOLVE_AT[3]) return { stage: 4, name: 'Ashvinau', color: LEAD_FORMS[lead][2], lead, theme: lead };
  if (total >= MAG_EVOLVE_AT[2]) return { stage: 3, name: LEAD_FORMS[lead][1], color: LEAD_FORMS[lead][2], lead, theme: lead };
  if (total >= MAG_EVOLVE_AT[1]) return { stage: 2, name: LEAD_FORMS[lead][0], color: LEAD_FORMS[lead][2], lead, theme: lead };
  if (total >= MAG_EVOLVE_AT[0]) return { stage: 1, name: STAGE1[own][0], color: STAGE1[own][1], lead, theme: own };
  return { stage: 0, name: 'Mag', color: 0xc8d4e8, lead, theme: own };
}
