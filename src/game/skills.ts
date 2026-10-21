import { skillCfg as K } from './config';
import { ARTS, type ArtId } from './data/arts';
import { passiveLevel, passiveRanks, PASSIVES, type PassiveId } from './passives';

// Skills (2026-10-15, the second take the same day; the user: "something like Diablo 2 where you would have to put
// points into Foie to unlock Gifoie"). Three trees (Fire, Lightning, Ice; one set for everyone since the classes went
// on 2026-10-21), shown one at a time, each a grid of Arts, their modifiers and passives joined by prerequisites
// (Foie → Gifoie → Rafoie). One point a level.
// - An Art costs a point to learn (rank 1) and takes up to ten: each rank adds power and takes off some TP (skillCfg).
// - Its six modifiers fork below it in the tree (the user's pick, the same day: "make these modifiers part of the tree"):
//   two rows of three, one per row, a point each. Row 1 needs the Art at rank 5, row 2 at rank 10 and a row 1 pick.
// - A passive takes up to five ranks (or one, for the on/off ones): its numbers scale up to the full effect at the
//   top rank (passives.ts rankMult / rankAmt).
// - A node needs its level and a point in the node it hangs from. Points come back for free out of a fight, one rank
//   at a time; nothing can be taken back while something resting on it still has points.
// Pure data + rules; Character holds the picks.

/**
 * A tree: lanes of Arts (each Art hangs from the one before it in its lane, with its modifier fork between them) and
 * passives (each with the node it hangs from, if any).
 */
export interface SkillTreeDef {
  id: string;
  name: string;
  lanes: ArtId[][];
  passives: [PassiveId, (ArtId | PassiveId)?][];
}

export interface SkillNode {
  kind: 'art' | 'mod' | 'passive';
  id: string;
  tree: string;
  /** Grid cell. */
  row: number;
  col: number;
  /** The node it hangs from (Arts and passives; a modifier hangs from its Art, see `art`). */
  pre?: string;
  /** Modifiers: the Art, the row (0: needs rank 5, 1: needs rank 10) and the modifier's id. */
  art?: ArtId;
  modRow?: 0 | 1;
  mod?: string;
  level: number;
  /** Top rank. */
  max: number;
}

/** Ranks put in, by node id ("zonde", "tempo", "zonde:storm" for a modifier). */
export interface SkillPicks {
  ranks: Record<string, number>;
}

export const emptySkills = (): SkillPicks => ({ ranks: {} });

/** Grid columns a lane of Arts takes (one per modifier of a row); passives take up to MAX_PASSIVE_COLS more. */
export const LANE_COLS = 3;
const MAX_PASSIVE_COLS = 3;

/** Grid rows an Art takes in its lane: itself and its two modifier rows. */
const ART_ROWS = 3;

const P = (id: PassiveId, pre?: ArtId | PassiveId): [PassiveId, (ArtId | PassiveId)?] => [id, pre];

// No Support tree (the user, 2026-10-15): Resta sits with Ice, and the support passives go where they fit (TP ones with
// Lightning and Fire, healing and shields with Ice). The five general passives kept from the Hunter and Ranger trees
// (2026-10-21) went the same way: Bloodlust with Fire, Light Feet with Lightning, Last Stand, Bulwark and Field Medic
// with Ice.
export const SKILL_TREES: SkillTreeDef[] = [
  {
    id: 'fire', name: 'Fire', lanes: [['foie', 'gifoie', 'rafoie']],
    passives: [P('resonance'), P('overcast', 'foie'), P('focusBolt', 'resonance'), P('kindle', 'overcast'), P('efficiency', 'focusBolt'), P('bloodlust', 'resonance'), P('overload', 'kindle')],
  },
  {
    id: 'lightning', name: 'Lightning', lanes: [['zonde', 'gizonde', 'razonde']],
    passives: [P('tempo'), P('calmMind', 'zonde'), P('blink', 'tempo'), P('lightFeet', 'blink'), P('conductor', 'gizonde'), P('techLongshot', 'conductor'), P('siphonStaff', 'calmMind'), P('clarity', 'siphonStaff'), P('echo', 'techLongshot'), P('swiftCast', 'echo'), P('rush', 'lightFeet')],
  },
  {
    id: 'ice', name: 'Ice', lanes: [['barta', 'gibarta', 'rabarta'], ['resta']],
    passives: [P('fleet'), P('slipstream', 'fleet'), P('lastStand', 'slipstream'), P('barrier', 'resta'), P('purify', 'barrier'), P('fieldMedic', 'barrier'), P('ward', 'gibarta'), P('bulwark', 'ward'), P('frostbite', 'ward'), P('aegis', 'frostbite'), P('composure', 'aegis')],
  },
];

const isArt = (id: string): id is ArtId => Object.hasOwn(ARTS, id);

/** A modifier's node id. */
export const modNodeId = (art: ArtId, mod: string): string => `${art}:${mod}`;

/** Grid columns a tree takes (its lanes, and as many passive columns as its lines need to stay clear). */
export function treeCols(tree: string): number {
  return Math.max(...skillNodes().filter((n) => n.tree === tree).map((n) => n.col)) + 1;
}

function buildTree(t: SkillTreeDef): SkillNode[] {
  const out: SkillNode[] = [];
  const taken = new Set<string>();
  const at = (row: number, col: number) => `${row}:${col}`;
  t.lanes.forEach((lane, l) => {
    const left = l * LANE_COLS;
    lane.forEach((art, i) => {
      const row = i * ART_ROWS;
      out.push({ kind: 'art', id: art, tree: t.id, row, col: left + 1, pre: lane[i - 1], level: ARTS[art].level, max: K.artRanks });
      taken.add(at(row, left + 1));
      ([0, 1] as const).forEach((modRow) => {
        ARTS[art].mods[modRow].forEach((m, k) => {
          out.push({ kind: 'mod', id: modNodeId(art, m.id), tree: t.id, row: row + 1 + modRow, col: left + k, art, modRow, mod: m.id, level: ARTS[art].level, max: 1 });
          taken.add(at(row + 1 + modRow, left + k));
        });
      });
    });
  });
  // Passives: columns right of the lanes (a third only when two can't keep the lines clear), no higher than what they hang from or the Arts open by their level, and
  // placed so their lines run through empty cells only (the cells a line crosses are kept free for later passives too).
  // One hanging from an Art takes a line from the Art's right side across its row, down the gutter and in from the
  // left; one hanging from a passive drops straight down its column, or turns in the gap below it to another column.
  const first = t.lanes.length * LANE_COLS;
  const reserved = new Set<string>();
  const free = (row: number, col: number) => !taken.has(at(row, col)) && !reserved.has(at(row, col));
  const levelRow = (lv: number) => Math.max(0, ...out.filter((n) => n.kind === 'art' && n.level <= lv).map((n) => n.row));
  const todo = [...t.passives].sort(([a], [b]) => passiveLevel(a) - passiveLevel(b));
  while (todo.length) {
    const i = todo.findIndex(([, pre]) => !pre || out.some((n) => n.id === pre));
    const [id, pre] = todo.splice(i < 0 ? 0 : i, 1)[0];
    const from = pre ? out.find((n) => n.id === pre) : undefined;
    const all = Array.from({ length: MAX_PASSIVE_COLS }, (_, i) => first + i);
    const cols = from?.kind === 'passive' ? [from.col, ...all.filter((c) => c !== from.col)] : all;
    // The cells a line to (row, col) would cross, or null if it can't get there.
    const path = (row: number, col: number): string[] | null => {
      const cells: string[] = [];
      if (from?.kind === 'art') {
        for (let c = from.col + 1; c < first; c++) cells.push(at(from.row, c));
        for (let c = first; c < col; c++) cells.push(at(row, c));
      } else if (from) {
        for (let r = from.row + 1; r < row; r++) cells.push(at(r, col));
      }
      return cells.every((c) => !taken.has(c)) ? cells : null;
    };
    let row = Math.max(from ? from.row + (from.kind === 'art' ? 0 : 1) : 0, levelRow(passiveLevel(id)));
    for (;; row++) {
      // (Far down, a line that can't be kept clear is drawn anyway: the tests check none of the trees needs that.)
      const col = cols.find((c) => free(row, c) && (path(row, c) || row > 40));
      if (col === undefined) continue;
      out.push({ kind: 'passive', id, tree: t.id, row, col, pre, level: passiveLevel(id), max: passiveRanks(id) });
      taken.add(at(row, col));
      for (const c of path(row, col) ?? []) reserved.add(c);
      break;
    }
  }
  return out;
}

let NODES: SkillNode[] | null = null;
let BY_ID = new Map<string, SkillNode>();

/** Every node of the trees, tree by tree. */
export function skillNodes(): SkillNode[] {
  if (!NODES) {
    NODES = SKILL_TREES.flatMap(buildTree);
    BY_ID = new Map(NODES.map((n) => [n.id, n]));
  }
  return NODES;
}

export function skillNode(id: string): SkillNode | undefined {
  skillNodes();
  return BY_ID.get(id);
}

/** The tree a node sits in. */
export function treeOf(id: string): SkillTreeDef | undefined {
  const n = skillNode(id);
  return n && SKILL_TREES.find((t) => t.id === n.tree);
}

/** How a line runs (the menu draws each at right angles). */
export type SkillLineKind =
  /** An Art to the next in its lane, down the lane's left side. */
  | 'spine'
  /** An Art to one of its first-row modifiers. */
  | 'fork'
  /** A first-row modifier to a second-row one (drawn from the first-row pick, once there is one). */
  | 'fork2'
  /** An Art to a passive: out of its right side, down the gutter, into the passive's left side. */
  | 'branch'
  /** A passive to the one below it. */
  | 'chain';

export interface SkillLine {
  from: string;
  to: string;
  kind: SkillLineKind;
}

/** The lines a tree draws (each lit once `to` has a point). */
export function treeLines(tree: string): SkillLine[] {
  const nodes = skillNodes().filter((n) => n.tree === tree);
  const lines: SkillLine[] = [];
  const mods = (art: string, row: 0 | 1) => nodes.filter((n) => n.art === art && n.modRow === row);
  for (const n of nodes) {
    if (n.kind === 'art') {
      for (const m of mods(n.id, 0)) lines.push({ from: n.id, to: m.id, kind: 'fork' });
      if (n.pre) lines.push({ from: n.pre, to: n.id, kind: 'spine' });
    } else if (n.kind === 'mod' && n.modRow === 1) {
      lines.push({ from: mods(n.art!, 0)[1].id, to: n.id, kind: 'fork2' });
    } else if (n.kind === 'passive' && n.pre) {
      lines.push({ from: n.pre, to: n.id, kind: skillNode(n.pre)!.kind === 'art' ? 'branch' : 'chain' });
    }
  }
  return lines;
}

/** Skill points a character has at `level`. */
export function skillPoints(level: number): number {
  return Math.floor(level * K.pointsPerLevel);
}

export function pointsSpent(picks: SkillPicks): number {
  return Object.values(picks.ranks).reduce((a, r) => a + r, 0);
}

/** Points in one tree. */
export function treeSpent(picks: SkillPicks, tree: string): number {
  return skillNodes().filter((n) => n.tree === tree).reduce((a, n) => a + (picks.ranks[n.id] ?? 0), 0);
}

export const rankOf = (picks: SkillPicks, id: string): number => picks.ranks[id] ?? 0;

/** The Art rank a modifier row opens at. */
export const modRowRank = (row: 0 | 1): number => K.modRanks[row];

/** An Art's modifiers taken in a row. */
function modsTaken(picks: SkillPicks, art: string, row: 0 | 1): SkillNode[] {
  return skillNodes().filter((n) => n.art === art && n.modRow === row && rankOf(picks, n.id) > 0);
}

/** Why another rank can't go into this node now, or null. */
export function rankUpBlock(level: number, picks: SkillPicks, n: SkillNode): string | null {
  if (rankOf(picks, n.id) >= n.max) return n.kind === 'mod' ? 'Taken' : 'At its top rank';
  if (level < n.level) return `Opens at Lv ${n.level}`;
  if (n.pre && rankOf(picks, n.pre) < 1) return `Needs a point in ${skillName(skillNode(n.pre)!)}`;
  if (n.kind === 'mod') {
    const art = ARTS[n.art!].name;
    const row = n.modRow!;
    if (rankOf(picks, n.art!) < modRowRank(row)) return `Needs ${art} at rank ${modRowRank(row)}`;
    if (row === 1 && !modsTaken(picks, n.art!, 0).length) return `Needs one of ${art}'s first modifiers`;
    const other = modsTaken(picks, n.art!, row)[0];
    if (other) return `One per row: take ${skillName(other)} back first`;
  }
  if (pointsSpent(picks) >= skillPoints(level)) return 'No skill points left';
  return null;
}

/**
 * Could points ever reach this node at this level: its level met, and the same up the nodes it hangs from (a
 * modifier's: its Art's)? Ranks, points and a taken sibling modifier don't count: those only take spending (or a
 * swap). The tree outlines these in their colour so what is in reach stands out from what still waits on a level.
 */
export function skillReachable(level: number, n: SkillNode): boolean {
  if (level < n.level) return false;
  const up = n.kind === 'mod' ? n.art : n.pre;
  return !up || skillReachable(level, skillNode(up)!);
}

/** Why a rank can't come out of this node, or null. */
export function rankDownBlock(picks: SkillPicks, n: SkillNode): string | null {
  const r = rankOf(picks, n.id);
  if (r < 1) return 'No points in it';
  const resting: SkillNode[] = [];
  if (r === 1) resting.push(...skillNodes().filter((m) => m.pre === n.id && rankOf(picks, m.id) > 0));
  if (n.kind === 'art') for (const row of [0, 1] as const) if (r - 1 < modRowRank(row)) resting.push(...modsTaken(picks, n.id, row));
  if (n.kind === 'mod' && n.modRow === 0) resting.push(...modsTaken(picks, n.art!, 1));
  return resting.length ? `Take ${resting.map((d) => skillName(d)).join(', ')} back first` : null;
}

/** Put a rank in. Returns why not, or null. */
export function rankUp(level: number, picks: SkillPicks, id: string): string | null {
  const n = skillNode(id);
  if (!n) return 'No such skill';
  const block = rankUpBlock(level, picks, n);
  if (block) return block;
  picks.ranks[id] = rankOf(picks, id) + 1;
  return null;
}

/** Take a rank out. Returns why not, or null. */
export function rankDown(picks: SkillPicks, id: string): string | null {
  const n = skillNode(id);
  if (!n) return 'No such skill';
  const block = rankDownBlock(picks, n);
  if (block) return block;
  const r = rankOf(picks, id) - 1;
  if (r) picks.ranks[id] = r;
  else delete picks.ranks[id];
  return null;
}

/**
 * Stored picks with anything unknown, out of reach, over a top rank or over budget dropped. Modifier picks stored
 * apart (`mods`, the first take of the ranked trees) become modifier nodes.
 */
export function readSkills(raw: unknown, level: number): SkillPicks {
  const out = emptySkills();
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as { ranks?: Record<string, unknown>; mods?: Record<string, unknown> };
  const ranks: Record<string, unknown> = { ...(r.ranks ?? {}) };
  for (const [art, picks] of Object.entries(r.mods ?? {})) {
    if (isArt(art) && Array.isArray(picks)) for (const m of picks) if (typeof m === 'string') ranks[modNodeId(art, m)] = 1;
  }
  // Rebuild rank by rank in level order (Arts before their modifiers), so prerequisites and the budget hold.
  const order = { art: 0, passive: 1, mod: 2 } as const;
  const want = Object.entries(ranks)
    .map(([id, v]) => [skillNode(id), typeof v === 'number' ? Math.floor(v) : 0] as const)
    .filter((e): e is readonly [SkillNode, number] => !!e[0] && e[1] > 0)
    .sort(([a], [b]) => a.level - b.level || order[a.kind] - order[b.kind] || (a.modRow ?? 0) - (b.modRow ?? 0));
  for (let pass = 0; pass < 6; pass++) {
    for (const [n, v] of want) while (rankOf(out, n.id) < v && !rankUp(level, out, n.id));
  }
  return out;
}

/**
 * Saves from before the ranked trees (the passive slots of 2026-10-14, or the first Skills tree of the morning of
 * 2026-10-15): the Arts on the bars learn a rank each (with what they hang from), then the old passives one rank each,
 * while points allow. The rest is left to spend.
 */
export function migrateSkills(level: number, barArts: ArtId[], oldPassives: string[]): SkillPicks {
  const out = emptySkills();
  const learn = (id: string, depth = 0): void => {
    const n = skillNode(id);
    if (!n || n.kind === 'mod' || depth > 8 || rankOf(out, id) > 0) return;
    if (n.pre) learn(n.pre, depth + 1);
    rankUp(level, out, id);
  };
  for (const id of [...barArts].sort((a, b) => ARTS[a].level - ARTS[b].level)) learn(id);
  for (const id of oldPassives) learn(id);
  return out;
}

/** Tests and sims: every Art open at this level, at `rank` (no points spent, no prerequisites checked). */
export function grantArts(level: number, picks: SkillPicks, rank: number): void {
  for (const n of skillNodes()) if (n.kind === 'art' && n.level <= level) picks.ranks[n.id] = Math.max(rankOf(picks, n.id), Math.min(n.max, rank));
}

/** The first Art a new character knows (Foie), rank 1. */
export function starterArt(usable: (id: ArtId) => boolean): ArtId | undefined {
  return SKILL_TREES.flatMap((t) => t.lanes.flat()).find((id) => ARTS[id].level <= 1 && usable(id));
}

export function skillName(n: SkillNode): string {
  if (n.kind === 'art') return ARTS[n.id as ArtId].name;
  if (n.kind === 'mod') return ARTS[n.art!].mods[n.modRow!].find((m) => m.id === n.mod)!.name;
  return PASSIVES[n.id as PassiveId].name;
}
