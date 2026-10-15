import { skillCfg as K } from './config';
import { ARTS, type ArtId } from './data/arts';
import type { ClassId } from './data/stats';
import { passiveLevel, passiveRanks, PASSIVES, type PassiveId } from './passives';

// Skills (2026-10-15, the second take the same day; the user: "something like Diablo 2 where you would have to put
// points into Foie to unlock Gifoie"). Each class has four trees, shown one at a time, each a grid of Arts, their
// modifiers and passives joined by prerequisites (Foie → Gifoie → Rafoie). One point a level.
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

/** Grid columns a lane of Arts takes (one per modifier of a row); passives take two more. */
export const LANE_COLS = 3;
export const PASSIVE_COLS = 2;

/** Grid rows an Art takes in its lane: itself and its two modifier rows. */
const ART_ROWS = 3;

const P = (id: PassiveId, pre?: ArtId | PassiveId): [PassiveId, (ArtId | PassiveId)?] => [id, pre];

export const SKILL_TREES: Record<ClassId, SkillTreeDef[]> = {
  hunter: [
    {
      id: 'sword', name: 'Sword', lanes: [['cyclone', 'groundBreaker', 'sunder']],
      passives: [P('followThrough'), P('cleave', 'followThrough'), P('crush', 'sunder'), P('whirl', 'cleave'), P('breaker', 'crush'), P('shatter', 'whirl')],
    },
    {
      id: 'saber', name: 'Saber', lanes: [['risingEdge', 'crescent', 'guardStance']],
      passives: [P('parry'), P('sweepGuard', 'parry'), P('steadfast', 'sweepGuard'), P('retaliate', 'guardStance'), P('balance', 'steadfast'), P('secondWind', 'retaliate'), P('daunt', 'secondWind')],
    },
    {
      id: 'dagger', name: 'Dagger', lanes: [['venomEdge', 'shadowStep', 'bladeDance']],
      passives: [P('lunge'), P('flurry', 'bladeDance'), P('hunterFocus', 'lunge'), P('executioner', 'flurry'), P('ironFinish', 'hunterFocus'), P('fervor', 'executioner')],
    },
    {
      id: 'combat', name: 'Combat', lanes: [['leap', 'warCry', 'ironWill'], ['resta']],
      passives: [P('tempo'), P('fleet', 'tempo'), P('slipstream', 'tempo'), P('shockwave', 'fleet'), P('lastStand', 'slipstream'), P('bloodlust', 'shockwave'), P('rush', 'bloodlust'), P('composure', 'lastStand')],
    },
  ],
  ranger: [
    {
      id: 'handgun', name: 'Handgun', lanes: [['rapidVolley', 'flashShot', 'ricochet']],
      passives: [P('hotStreak'), P('spread', 'hotStreak'), P('rangerFocus', 'ricochet'), P('arc', 'spread'), P('rounds', 'rangerFocus'), P('rapidFire', 'arc')],
    },
    {
      id: 'rifle', name: 'Rifle', lanes: [['chargedShot', 'mark', 'freezeRound']],
      passives: [P('pierce'), P('deadeye', 'freezeRound'), P('longshot', 'pierce'), P('pin', 'deadeye'), P('piercingRound', 'longshot'), P('pinningFire', 'pin')],
    },
    {
      id: 'shot', name: 'Shot', lanes: [['scatterBlast', 'napalmShell', 'slug']],
      passives: [P('breathingRoom'), P('suppress', 'breathingRoom'), P('adrenaline', 'napalmShell'), P('bulwark', 'suppress'), P('pointBlank', 'slug')],
    },
    {
      id: 'gunnery', name: 'Gunnery', lanes: [['freezeTrap', 'backflipShot', 'grenade'], ['resta']],
      passives: [P('tempo'), P('backstepShot', 'tempo'), P('fleet', 'tempo'), P('lightFeet', 'fleet'), P('lastStand', 'lightFeet'), P('bloodlust', 'backstepShot'), P('fieldMedic', 'resta'), P('rush', 'bloodlust'), P('composure', 'lastStand')],
    },
  ],
  force: [
    // No Support tree (the user, 2026-10-15): Resta sits with Ice, and the support passives go where they fit (TP ones
    // with Lightning and Fire, healing and shields with Ice).
    {
      id: 'fire', name: 'Fire', lanes: [['foie', 'gifoie', 'rafoie']],
      passives: [P('resonance'), P('overcast', 'foie'), P('focusBolt', 'resonance'), P('kindle', 'overcast'), P('efficiency', 'resonance'), P('overload', 'kindle')],
    },
    {
      id: 'lightning', name: 'Lightning', lanes: [['zonde', 'gizonde', 'razonde']],
      passives: [P('tempo'), P('calmMind', 'zonde'), P('blink', 'tempo'), P('conductor', 'gizonde'), P('techLongshot', 'conductor'), P('siphonStaff', 'calmMind'), P('clarity', 'siphonStaff'), P('echo', 'techLongshot'), P('swiftCast', 'echo'), P('rush', 'blink')],
    },
    {
      id: 'ice', name: 'Ice', lanes: [['barta', 'gibarta', 'rabarta'], ['resta']],
      passives: [P('fleet'), P('slipstream', 'fleet'), P('barrier', 'resta'), P('purify', 'barrier'), P('ward', 'gibarta'), P('frostbite', 'ward'), P('aegis', 'frostbite'), P('composure', 'aegis')],
    },
  ],
};

const isArt = (id: string): id is ArtId => Object.hasOwn(ARTS, id);

/** A modifier's node id. */
export const modNodeId = (art: ArtId, mod: string): string => `${art}:${mod}`;

/** Grid columns a tree takes. */
export const treeCols = (t: SkillTreeDef): number => t.lanes.length * LANE_COLS + PASSIVE_COLS;

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
  // Passives: in the columns right of the lanes, no higher than what they hang from or the Arts open by their level.
  const first = t.lanes.length * LANE_COLS;
  const rowOf = (id: string) => out.find((n) => n.id === id)?.row;
  const levelRow = (lv: number) => Math.max(0, ...out.filter((n) => n.kind === 'art' && n.level <= lv).map((n) => n.row));
  const todo = [...t.passives].sort(([a], [b]) => passiveLevel(a) - passiveLevel(b));
  while (todo.length) {
    const i = todo.findIndex(([, pre]) => !pre || rowOf(pre) !== undefined);
    const [id, pre] = todo.splice(i < 0 ? 0 : i, 1)[0];
    const preNode = pre ? out.find((n) => n.id === pre) : undefined;
    let row = Math.max(preNode ? preNode.row + 1 : 0, levelRow(passiveLevel(id)));
    const cols = preNode?.kind === 'passive' ? [preNode.col, ...[first, first + 1].filter((c) => c !== preNode.col)] : [first, first + 1];
    for (;;) {
      const col = cols.find((c) => !taken.has(at(row, c)));
      if (col !== undefined) {
        out.push({ kind: 'passive', id, tree: t.id, row, col, pre, level: passiveLevel(id), max: passiveRanks(id) });
        taken.add(at(row, col));
        break;
      }
      row++;
    }
  }
  return out;
}

const NODES = {} as Record<ClassId, SkillNode[]>;
const BY_ID = {} as Record<ClassId, Map<string, SkillNode>>;

/** Every node of a class's trees, tree by tree. */
export function skillNodes(cls: ClassId): SkillNode[] {
  if (!NODES[cls]) {
    NODES[cls] = SKILL_TREES[cls].flatMap(buildTree);
    BY_ID[cls] = new Map(NODES[cls].map((n) => [n.id, n]));
  }
  return NODES[cls];
}

export function skillNode(cls: ClassId, id: string): SkillNode | undefined {
  skillNodes(cls);
  return BY_ID[cls].get(id);
}

/** The tree a node sits in. */
export function treeOf(cls: ClassId, id: string): SkillTreeDef | undefined {
  const n = skillNode(cls, id);
  return n && SKILL_TREES[cls].find((t) => t.id === n.tree);
}

/**
 * The lines a tree draws, as [from, to] node ids (lit once `to` has a point): an Art to its first modifiers, each
 * first modifier to the one below it, the middle second modifier to the next Art, a passive to what it hangs from.
 */
export function treeLines(cls: ClassId, tree: string): [string, string][] {
  const nodes = skillNodes(cls).filter((n) => n.tree === tree);
  const lines: [string, string][] = [];
  const mods = (art: string, row: 0 | 1) => nodes.filter((n) => n.art === art && n.modRow === row);
  for (const n of nodes) {
    if (n.kind === 'art') {
      for (const m of mods(n.id, 0)) lines.push([n.id, m.id]);
      if (n.pre) lines.push([mods(n.pre, 1)[1].id, n.id]);
    } else if (n.kind === 'mod' && n.modRow === 1) {
      lines.push([mods(n.art!, 0)[n.col % LANE_COLS].id, n.id]);
    } else if (n.kind === 'passive' && n.pre) {
      lines.push([n.pre, n.id]);
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
export function treeSpent(cls: ClassId, picks: SkillPicks, tree: string): number {
  return skillNodes(cls).filter((n) => n.tree === tree).reduce((a, n) => a + (picks.ranks[n.id] ?? 0), 0);
}

export const rankOf = (picks: SkillPicks, id: string): number => picks.ranks[id] ?? 0;

/** The Art rank a modifier row opens at. */
export const modRowRank = (row: 0 | 1): number => K.modRanks[row];

/** An Art's modifiers taken in a row. */
function modsTaken(cls: ClassId, picks: SkillPicks, art: string, row: 0 | 1): SkillNode[] {
  return skillNodes(cls).filter((n) => n.art === art && n.modRow === row && rankOf(picks, n.id) > 0);
}

/** Why another rank can't go into this node now, or null. */
export function rankUpBlock(cls: ClassId, level: number, picks: SkillPicks, n: SkillNode): string | null {
  if (rankOf(picks, n.id) >= n.max) return n.kind === 'mod' ? 'Taken' : 'At its top rank';
  if (level < n.level) return `Opens at Lv ${n.level}`;
  if (n.pre && rankOf(picks, n.pre) < 1) return `Needs a point in ${skillName(skillNode(cls, n.pre)!)}`;
  if (n.kind === 'mod') {
    const art = ARTS[n.art!].name;
    const row = n.modRow!;
    if (rankOf(picks, n.art!) < modRowRank(row)) return `Needs ${art} at rank ${modRowRank(row)}`;
    if (row === 1 && !modsTaken(cls, picks, n.art!, 0).length) return `Needs one of ${art}'s first modifiers`;
    const other = modsTaken(cls, picks, n.art!, row)[0];
    if (other) return `One per row: take ${skillName(other)} back first`;
  }
  if (pointsSpent(picks) >= skillPoints(level)) return 'No skill points left';
  return null;
}

/** Why a rank can't come out of this node, or null. */
export function rankDownBlock(cls: ClassId, picks: SkillPicks, n: SkillNode): string | null {
  const r = rankOf(picks, n.id);
  if (r < 1) return 'No points in it';
  const resting: SkillNode[] = [];
  if (r === 1) resting.push(...skillNodes(cls).filter((m) => m.pre === n.id && rankOf(picks, m.id) > 0));
  if (n.kind === 'art') for (const row of [0, 1] as const) if (r - 1 < modRowRank(row)) resting.push(...modsTaken(cls, picks, n.id, row));
  if (n.kind === 'mod' && n.modRow === 0) resting.push(...modsTaken(cls, picks, n.art!, 1));
  return resting.length ? `Take ${resting.map((d) => skillName(d)).join(', ')} back first` : null;
}

/** Put a rank in. Returns why not, or null. */
export function rankUp(cls: ClassId, level: number, picks: SkillPicks, id: string): string | null {
  const n = skillNode(cls, id);
  if (!n) return 'No such skill';
  const block = rankUpBlock(cls, level, picks, n);
  if (block) return block;
  picks.ranks[id] = rankOf(picks, id) + 1;
  return null;
}

/** Take a rank out. Returns why not, or null. */
export function rankDown(cls: ClassId, picks: SkillPicks, id: string): string | null {
  const n = skillNode(cls, id);
  if (!n) return 'No such skill';
  const block = rankDownBlock(cls, picks, n);
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
export function readSkills(raw: unknown, cls: ClassId, level: number): SkillPicks {
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
    .map(([id, v]) => [skillNode(cls, id), typeof v === 'number' ? Math.floor(v) : 0] as const)
    .filter((e): e is readonly [SkillNode, number] => !!e[0] && e[1] > 0)
    .sort(([a], [b]) => a.level - b.level || order[a.kind] - order[b.kind] || (a.modRow ?? 0) - (b.modRow ?? 0));
  for (let pass = 0; pass < 6; pass++) {
    for (const [n, v] of want) while (rankOf(out, n.id) < v && !rankUp(cls, level, out, n.id));
  }
  return out;
}

/**
 * Saves from before the ranked trees (the passive slots of 2026-10-14, or the first Skills tree of the morning of
 * 2026-10-15): the Arts on the bars learn a rank each (with what they hang from), then the old passives one rank each,
 * while points allow. The rest is left to spend.
 */
export function migrateSkills(cls: ClassId, level: number, barArts: ArtId[], oldPassives: string[]): SkillPicks {
  const out = emptySkills();
  const learn = (id: string, depth = 0): void => {
    const n = skillNode(cls, id);
    if (!n || n.kind === 'mod' || depth > 8 || rankOf(out, id) > 0) return;
    if (n.pre) learn(n.pre, depth + 1);
    rankUp(cls, level, out, id);
  };
  for (const id of [...barArts].sort((a, b) => ARTS[a].level - ARTS[b].level)) learn(id);
  for (const id of oldPassives) learn(id);
  return out;
}

/** Tests and sims: every Art the class has at this level, at `rank` (no points spent, no prerequisites checked). */
export function grantArts(cls: ClassId, level: number, picks: SkillPicks, rank: number): void {
  for (const n of skillNodes(cls)) if (n.kind === 'art' && n.level <= level) picks.ranks[n.id] = Math.max(rankOf(picks, n.id), Math.min(n.max, rank));
}

/** The first Art a new character knows: the start weapon's (or the class's first technique), rank 1. */
export function starterArt(cls: ClassId, usable: (id: ArtId) => boolean): ArtId | undefined {
  return SKILL_TREES[cls].flatMap((t) => t.lanes.flat()).find((id) => ARTS[id].level <= 1 && usable(id));
}

export function skillName(n: SkillNode): string {
  if (n.kind === 'art') return ARTS[n.id as ArtId].name;
  if (n.kind === 'mod') return ARTS[n.art!].mods[n.modRow!].find((m) => m.id === n.mod)!.name;
  return PASSIVES[n.id as PassiveId].name;
}
