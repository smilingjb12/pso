import type { SfxId } from './sfx';

// Which variant of each sound the game plays (index into its variants; 0 when
// missing). Chosen by ear in /soundlab.html, like PLAYER_LOOK for the heroine.
export const SOUND_PICKS: Partial<Record<SfxId, number>> = {};

/** Picks made in the sound lab but not yet baked in above (this browser only). */
export const LAB_PICKS_KEY = 'pso.soundPicks';

let cache: Partial<Record<SfxId, number>> | null = null;

export function labPicks(): Partial<Record<SfxId, number>> {
  if (cache) return cache;
  try {
    cache = JSON.parse(localStorage.getItem(LAB_PICKS_KEY) ?? '{}') ?? {};
  } catch {
    cache = {};
  }
  return cache!;
}

export function setLabPicks(p: Partial<Record<SfxId, number>>): void {
  cache = p;
  try {
    localStorage.setItem(LAB_PICKS_KEY, JSON.stringify(p));
  } catch {
    // Storage unavailable: picks last for this page only.
  }
}

// The lab usually runs in another tab: pick up its changes live.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === LAB_PICKS_KEY) cache = null;
  });
}

export function pickOf(id: SfxId): number {
  return labPicks()[id] ?? SOUND_PICKS[id] ?? 0;
}
