/** Session difficulty, picked at login (Diablo style). Nightmare is the run state's `hard` flag; Hell sets `hell` too. */
export type Difficulty = 'normal' | 'nightmare' | 'hell';

export const DIFFICULTY_NAME: Record<Difficulty, string> = { normal: 'Normal', nightmare: 'Nightmare', hell: 'Hell' };

/** What area names get on this difficulty: "" / " (Nightmare)" / " (Hell)". */
export function difficultyTag(d: Difficulty): string {
  return d === 'normal' ? '' : ` (${DIFFICULTY_NAME[d]})`;
}

/** A run's difficulty from its flags. */
export function runDifficulty(run: { hard: boolean; hell?: boolean }): Difficulty {
  return run.hell ? 'hell' : run.hard ? 'nightmare' : 'normal';
}

/** Older call sites pass `hard` as a boolean (true = Nightmare). */
export function asDifficulty(d: Difficulty | boolean): Difficulty {
  return d === true ? 'nightmare' : d === false ? 'normal' : d;
}
