// The Warden's Hell sequence (a memory test; see Warden.ts and DESIGN.md "Bosses" under Hell): a few deck cells
// light one after another, then go dark; then the whole deck discharges once per cell, sparing only that beat's
// cell. Pure rules, so they can be tested without the boss.

/** Steps between two cells of a cols-wide grid, counting diagonals as one (0: the same cell). */
export function cellSteps(a: number, b: number, cols: number): number {
  return Math.max(Math.abs((a % cols) - (b % cols)), Math.abs(Math.floor(a / cols) - Math.floor(b / cols)));
}

/** The up to 8 cells around cell i on a cols x rows grid. */
function around(i: number, cols: number, rows: number): number[] {
  const c = i % cols;
  const r = Math.floor(i / cols);
  const out: number[] = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const cc = c + dc;
      const rr = r + dr;
      if ((dc || dr) && cc >= 0 && cc < cols && rr >= 0 && rr < rows) out.push(rr * cols + cc);
    }
  }
  return out;
}

/**
 * A sequence of `n` cells on a cols x rows grid (row 0 against the alcove): the first within `reach` cells of `here`
 * (your cell; diagonals count as one), each next one among the 8 neighbours of the one before, never a cell `ok` turns
 * down (burning, under the core) and never one already in it (no stepping back). Every such sequence is equally
 * likely; null if none fits.
 */
export function planSequence(cols: number, rows: number, here: number, ok: (i: number) => boolean, rng: () => number, n = 3, reach = 1): number[] | null {
  const all: number[][] = [];
  const near = Array.from({ length: cols * rows }, (_, i) => i).filter((i) => cellSteps(i, here, cols) <= reach);
  const grow = (seq: number[]): void => {
    if (seq.length === n) {
      all.push(seq);
      return;
    }
    const next = seq.length ? around(seq[seq.length - 1], cols, rows) : near;
    for (const i of next) if (!seq.includes(i) && ok(i)) grow([...seq, i]);
  };
  grow([]);
  return all.length ? all[Math.floor(rng() * all.length)] : null;
}

/**
 * Boss seconds between the beats: `gap`, but never under `floor` real seconds however fast a rift's tempo runs its
 * clock (real spacing = max(gap / tempo, floor)).
 */
export function beatGap(gap: number, floor: number, tempo: number): number {
  return Math.max(gap, floor * tempo);
}
