import type { EnemyArchetype } from '../config';

/** Elite affixes. Normal Mines elites roll the first two; Hard elites and champions roll the whole pool. */
export type Affix = 'overclocked' | 'volatile' | 'shielding' | 'regenerating' | 'splitting' | 'molten' | 'stormcaller' | 'frenzied';

export interface AffixDef {
  id: Affix;
  name: string;
  /** Aura and HUD chip colour. */
  color: number;
  /** What it does, in one line (design reference; the enemy frame shows only the name chip). */
  desc: string;
}

export const AFFIXES: Record<Affix, AffixDef> = {
  overclocked: { id: 'overclocked', name: 'Overclocked', color: 0x40d8ff, desc: 'Moves and attacks 50% faster, and follows every attack with a second one.' },
  volatile: { id: 'volatile', name: 'Volatile', color: 0xff7a30, desc: 'Vents a blast around itself every few seconds while you are close; explodes when it dies and leaves the ground burning.' },
  shielding: { id: 'shielding', name: 'Shielding', color: 0x60ffc8, desc: 'Tethered allies take 70% less damage; it hangs back behind them, and shields its front once alone.' },
  regenerating: { id: 'regenerating', name: 'Regenerating', color: 0x70ff70, desc: 'Heals fast once left alone for a moment and pulses heals to nearby allies; Burn or Poison stop it.' },
  splitting: { id: 'splitting', name: 'Splitting', color: 0xffe060, desc: 'Splits into three small, fast copies when it dies (plain, weaker versions with no affixes).' },
  molten: { id: 'molten', name: 'Molten', color: 0xff4a20, desc: 'Leaves burning ground where it walks, where its attacks land and where its lobbed globs fall. Immune to Burn.' },
  stormcaller: { id: 'stormcaller', name: 'Stormcaller', color: 0xc0a0ff, desc: 'Calls lightning circles near you every few seconds, one where you are heading: keep moving.' },
  frenzied: { id: 'frenzied', name: 'Frenzied', color: 0xff3a5a, desc: "Below 40% HP it roars you back, then attacks faster, hits harder and can't be staggered." },
};

export const MINES_AFFIXES: Affix[] = ['overclocked', 'volatile'];
export const HARD_AFFIXES = Object.keys(AFFIXES) as Affix[];

/** Can this kind of enemy carry the affix? (Rooted Lilies don't walk; Pan Arms already splits.) */
export function affixFits(a: Affix, arch: EnemyArchetype): boolean {
  if (a === 'molten') return arch.moveSpeed > 0;
  if (a === 'splitting') return arch.ai === 'brawler' || arch.ai === 'gunbot' || arch.ai === 'garanz' || arch.ai === 'sinow';
  return true;
}

/** Roll `n` different affixes that fit this enemy. */
export function rollAffixes(n: number, arch: EnemyArchetype, rng: () => number, pool: Affix[] = HARD_AFFIXES): Affix[] {
  const options = pool.filter((a) => affixFits(a, arch));
  const out: Affix[] = [];
  while (out.length < n && options.length) out.push(options.splice(Math.floor(rng() * options.length), 1)[0]);
  return out;
}
