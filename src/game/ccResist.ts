import { crowdControl as cfg, type EnemyArchetype } from './config';

// Crowd-control resistance (2026-10-16, the user's design; DESIGN.md "Crowd control on enemies"): four affixes apart
// from the elite ones, each a % chance to shrug off one kind of crowd control. Every stun, freeze, slow or shove rolls
// it (Combat.resisted); nothing wears it down, and nothing builds it up. The frame shows them as icon chips.

export type CcKind = 'stun' | 'freeze' | 'slow' | 'knockback';
export const CC_KINDS: CcKind[] = ['stun', 'freeze', 'slow', 'knockback'];

/** A mob's CC resistances, percent (missing: none; 100: immune). */
export type CcResist = Partial<Record<CcKind, number>>;

export interface CcAffixDef {
  kind: CcKind;
  /** The affix's name (rift modifiers and the design doc; the frame shows an icon). */
  name: string;
  /** What it resists, in words. */
  label: string;
}

export const CC_AFFIXES: Record<CcKind, CcAffixDef> = {
  stun: { kind: 'stun', name: 'Steadfast', label: 'stun' },
  freeze: { kind: 'freeze', name: 'Insulated', label: 'freeze' },
  slow: { kind: 'slow', name: 'Relentless', label: 'slow' },
  knockback: { kind: 'knockback', name: 'Anchored', label: 'knockback' },
};

export type CcDifficulty = 'normal' | 'nightmare' | 'hell';
export type CcRank = 'regular' | 'elite' | 'champion';

export interface CcRoll {
  /** Rifts roll as Hell. */
  difficulty: CcDifficulty;
  rank: CcRank;
  arch: Pick<EnemyArchetype, 'ai'>;
  /** Strength a rift's tier adds, percent. */
  grow?: number;
  /** Affixes a rift's tier adds. */
  extra?: number;
  /** Kinds a rift's modifiers give every enemy. */
  forced?: CcKind[];
}

/** Rooted bodies never move, so knockback is moot for them (they are immune already). */
const ROOTED = ['lily', 'node'];

/** Can this body carry a resistance to `kind`? The Control Node never fights, so it carries none. */
function fits(kind: CcKind, arch: Pick<EnemyArchetype, 'ai'>): boolean {
  if (arch.ai === 'node') return false;
  return kind !== 'knockback' || !ROOTED.includes(arch.ai);
}

/** Rooted bodies (Lilies, the Control Node) can't be knocked back at all. */
export const rootedAi = (ai: EnemyArchetype['ai']): boolean => ROOTED.includes(ai);

const RANK_INDEX: Record<CcRank, number> = { regular: 0, elite: 1, champion: 2 };

/** How many CC affixes a mob rolls: its rank's count on the difficulty (a fraction is the chance of one more). */
export function ccCount(r: Pick<CcRoll, 'difficulty' | 'rank' | 'extra'>, rng: () => number): number {
  const n = cfg.count[r.difficulty][RANK_INDEX[r.rank]] + (r.extra ?? 0);
  const whole = Math.floor(n);
  return whole + (rng() < n - whole ? 1 : 0);
}

/** A mob's CC resistances: distinct kinds, each rolled in the difficulty's range (plus a rift's growth), capped. */
export function rollCcResist(r: CcRoll, rng: () => number): CcResist {
  const out: CcResist = {};
  const grow = r.grow ?? 0;
  const options = CC_KINDS.filter((k) => fits(k, r.arch));
  if (!options.length) return out;
  const [lo, hi] = cfg.strength[r.difficulty];
  for (let n = ccCount(r, rng); n > 0 && options.length; n--) {
    const kind = options.splice(Math.floor(rng() * options.length), 1)[0];
    out[kind] = Math.min(cfg.cap, Math.round(lo + rng() * (hi - lo) + grow));
  }
  // A rift modifier lifts its kind on everyone that can carry it.
  for (const kind of r.forced ?? []) {
    if (fits(kind, r.arch)) out[kind] = Math.min(cfg.cap, Math.max(out[kind] ?? 0, Math.round(cfg.riftModFloor + grow)));
  }
  return out;
}
