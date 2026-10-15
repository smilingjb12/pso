import { skillCfg as K } from './config';
import { ARTS, type ArtId } from './data/arts';
import type { ClassId } from './data/stats';
import { passiveLevel, passiveRanks, PASSIVES, type PassiveId } from './passives';

// Skills (2026-10-15, the second take the same day; the user: "something like Diablo 2 where you would have to put
// points into Foie to unlock Gifoie"). Each class has four trees, shown one at a time, each a small grid of Arts and
// passives joined by prerequisites (Foie → Gifoie → Rafoie). One point a level.
// - An Art costs a point to learn (rank 1) and takes up to ten: each rank adds power and takes off some TP
//   (skillCfg). Its two modifier rows (pick one of three, free to swap) open at ranks 5 and 10.
// - A passive takes up to five ranks (or one, for the on/off ones): its numbers scale up to the full effect at the
//   top rank (passives.ts rankMult / rankAmt).
// - A node needs its level and a point in the node it hangs from. Points come back for free out of a fight, one rank
//   at a time; the last rank can't go while a node hanging from it has points.
// Pure data + rules; Character holds the picks.

/** A node's place in its tree: grid row and column (0-3), and the node it hangs from. */
type Place = [id: ArtId | PassiveId, row: number, col: number, pre?: ArtId | PassiveId];

export interface SkillTreeDef {
  id: string;
  name: string;
  nodes: Place[];
}

export interface SkillNode {
  kind: 'art' | 'passive';
  id: string;
  tree: string;
  row: number;
  col: number;
  pre?: string;
  level: number;
  /** Top rank. */
  max: number;
}

/** Ranks put in (by node id) and the modifier picked in each of an Art's rows. */
export interface SkillPicks {
  ranks: Record<string, number>;
  mods: Partial<Record<ArtId, (string | null)[]>>;
}

export const emptySkills = (): SkillPicks => ({ ranks: {}, mods: {} });

/** Grid columns a tree has. */
export const TREE_COLS = 4;

export const SKILL_TREES: Record<ClassId, SkillTreeDef[]> = {
  hunter: [
    {
      id: 'sword', name: 'Sword',
      nodes: [
        ['cyclone', 0, 0], ['followThrough', 0, 2], ['groundBreaker', 1, 0, 'cyclone'], ['cleave', 2, 2, 'followThrough'],
        ['sunder', 3, 0, 'groundBreaker'], ['crush', 4, 1, 'sunder'], ['whirl', 5, 2, 'cleave'], ['breaker', 6, 1, 'crush'], ['shatter', 6, 3, 'whirl'],
      ],
    },
    {
      id: 'saber', name: 'Saber',
      nodes: [
        ['risingEdge', 0, 0], ['parry', 0, 2], ['crescent', 1, 0, 'risingEdge'], ['sweepGuard', 2, 2, 'parry'],
        ['guardStance', 3, 0, 'crescent'], ['steadfast', 3, 2, 'sweepGuard'], ['retaliate', 4, 1, 'guardStance'], ['balance', 4, 2, 'steadfast'],
        ['secondWind', 5, 1, 'retaliate'], ['daunt', 6, 1, 'secondWind'],
      ],
    },
    {
      id: 'dagger', name: 'Dagger',
      nodes: [
        ['venomEdge', 0, 0], ['shadowStep', 1, 0, 'venomEdge'], ['lunge', 1, 2], ['bladeDance', 3, 0, 'shadowStep'],
        ['flurry', 4, 1, 'bladeDance'], ['executioner', 5, 1, 'flurry'], ['hunterFocus', 5, 2, 'lunge'], ['fervor', 6, 1, 'executioner'],
        ['ironFinish', 6, 2, 'hunterFocus'],
      ],
    },
    {
      id: 'combat', name: 'Combat',
      nodes: [
        ['leap', 0, 0], ['tempo', 0, 1], ['resta', 0, 3], ['fleet', 1, 1, 'tempo'], ['slipstream', 1, 2, 'tempo'], ['shifta', 1, 3, 'resta'],
        ['warCry', 2, 0, 'leap'], ['shockwave', 2, 1, 'fleet'], ['deband', 2, 3, 'shifta'], ['lastStand', 3, 2, 'slipstream'],
        ['ironWill', 4, 0, 'warCry'], ['bloodlust', 5, 1, 'shockwave'], ['rush', 6, 1, 'bloodlust'], ['composure', 6, 2, 'lastStand'],
      ],
    },
  ],
  ranger: [
    {
      id: 'handgun', name: 'Handgun',
      nodes: [
        ['rapidVolley', 0, 0], ['hotStreak', 0, 2], ['flashShot', 1, 0, 'rapidVolley'], ['spread', 2, 2, 'hotStreak'],
        ['ricochet', 3, 0, 'flashShot'], ['rangerFocus', 5, 1, 'ricochet'], ['arc', 5, 2, 'spread'], ['rounds', 6, 1, 'rangerFocus'],
        ['rapidFire', 6, 2, 'arc'],
      ],
    },
    {
      id: 'rifle', name: 'Rifle',
      nodes: [
        ['chargedShot', 0, 0], ['mark', 1, 0, 'chargedShot'], ['pierce', 2, 2], ['freezeRound', 3, 0, 'mark'],
        ['deadeye', 4, 1, 'freezeRound'], ['longshot', 4, 2, 'pierce'], ['pin', 5, 1, 'deadeye'], ['piercingRound', 5, 2, 'longshot'],
        ['pinningFire', 6, 1, 'pin'],
      ],
    },
    {
      id: 'shot', name: 'Shot',
      nodes: [
        ['scatterBlast', 0, 0], ['breathingRoom', 0, 2], ['napalmShell', 1, 0, 'scatterBlast'], ['suppress', 2, 2, 'breathingRoom'],
        ['slug', 3, 0, 'napalmShell'], ['adrenaline', 3, 1, 'napalmShell'], ['bulwark', 3, 2, 'suppress'], ['pointBlank', 4, 1, 'slug'],
      ],
    },
    {
      id: 'gunnery', name: 'Gunnery',
      nodes: [
        ['freezeTrap', 0, 0], ['tempo', 0, 1], ['resta', 0, 3], ['backstepShot', 1, 1, 'tempo'], ['fleet', 1, 2, 'tempo'],
        ['shifta', 1, 3, 'resta'], ['backflipShot', 2, 0, 'freezeTrap'], ['lightFeet', 2, 2, 'fleet'], ['deband', 2, 3, 'shifta'],
        ['lastStand', 3, 2, 'lightFeet'], ['grenade', 4, 0, 'backflipShot'], ['bloodlust', 5, 1, 'backstepShot'],
        ['fieldMedic', 5, 3, 'deband'], ['rush', 6, 1, 'bloodlust'], ['composure', 6, 2, 'lastStand'],
      ],
    },
  ],
  force: [
    {
      id: 'fire', name: 'Fire',
      nodes: [
        ['foie', 0, 0], ['resonance', 0, 2], ['gifoie', 1, 0, 'foie'], ['overcast', 2, 1, 'foie'], ['focusBolt', 3, 2, 'resonance'],
        ['rafoie', 4, 0, 'gifoie'], ['kindle', 4, 1, 'overcast'], ['overload', 5, 1, 'kindle'],
      ],
    },
    {
      id: 'lightning', name: 'Lightning',
      nodes: [
        ['zonde', 0, 0], ['tempo', 0, 2], ['blink', 1, 2, 'tempo'], ['gizonde', 2, 0, 'zonde'], ['conductor', 3, 1, 'gizonde'],
        ['techLongshot', 4, 1, 'conductor'], ['razonde', 5, 0, 'gizonde'], ['echo', 5, 1, 'techLongshot'], ['swiftCast', 6, 1, 'echo'],
        ['rush', 6, 2, 'blink'],
      ],
    },
    {
      id: 'ice', name: 'Ice',
      nodes: [
        ['barta', 0, 0], ['gibarta', 1, 0, 'barta'], ['fleet', 1, 2], ['slipstream', 1, 3], ['rabarta', 3, 0, 'gibarta'],
        ['ward', 3, 1, 'gibarta'], ['frostbite', 4, 1, 'ward'], ['aegis', 5, 1, 'frostbite'],
      ],
    },
    {
      id: 'support', name: 'Support',
      nodes: [
        ['resta', 0, 0], ['calmMind', 0, 3], ['shifta', 1, 1, 'resta'], ['deband', 1, 2, 'resta'], ['barrier', 2, 0, 'resta'],
        ['purify', 3, 0, 'barrier'], ['efficiency', 5, 1, 'shifta'], ['clarity', 5, 2, 'deband'], ['siphonStaff', 5, 3, 'calmMind'],
        ['composure', 6, 2, 'clarity'],
      ],
    },
  ],
};

const isArt = (id: string): id is ArtId => Object.hasOwn(ARTS, id);

function buildNodes(cls: ClassId): SkillNode[] {
  return SKILL_TREES[cls].flatMap((t) =>
    t.nodes.map(([id, row, col, pre]): SkillNode => {
      const art = isArt(id);
      return {
        kind: art ? 'art' : 'passive', id, tree: t.id, row, col, pre,
        level: art ? ARTS[id].level : passiveLevel(id as PassiveId),
        max: art ? K.artRanks : passiveRanks(id as PassiveId),
      };
    }),
  );
}

const NODES = {} as Record<ClassId, SkillNode[]>;
const BY_ID = {} as Record<ClassId, Map<string, SkillNode>>;

/** Every node of a class's trees, tree by tree. */
export function skillNodes(cls: ClassId): SkillNode[] {
  if (!NODES[cls]) {
    NODES[cls] = buildNodes(cls);
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

/** The rank an Art's modifier row opens at. */
export const modRowRank = (row: 0 | 1): number => K.modRanks[row];

/** Why another rank can't go into this node now, or null. */
export function rankUpBlock(cls: ClassId, level: number, picks: SkillPicks, n: SkillNode): string | null {
  if (rankOf(picks, n.id) >= n.max) return 'At its top rank';
  if (level < n.level) return `Opens at Lv ${n.level}`;
  if (n.pre && rankOf(picks, n.pre) < 1) return `Needs a point in ${skillName(skillNode(cls, n.pre)!)}`;
  if (pointsSpent(picks) >= skillPoints(level)) return 'No skill points left';
  return null;
}

/** Nodes hanging from this one that have points. */
export function dependents(cls: ClassId, picks: SkillPicks, id: string): SkillNode[] {
  return skillNodes(cls).filter((n) => n.pre === id && rankOf(picks, n.id) > 0);
}

/** Why a rank can't come out of this node, or null. */
export function rankDownBlock(cls: ClassId, picks: SkillPicks, n: SkillNode): string | null {
  const r = rankOf(picks, n.id);
  if (r < 1) return 'No points in it';
  const deps = dependents(cls, picks, n.id);
  if (r === 1 && deps.length) return `Take the points out of ${deps.map((d) => skillName(d)).join(', ')} first`;
  return null;
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

/** Take a rank out (an Art's modifier picks above the new rank go with it). Returns why not, or null. */
export function rankDown(cls: ClassId, picks: SkillPicks, id: string): string | null {
  const n = skillNode(cls, id);
  if (!n) return 'No such skill';
  const block = rankDownBlock(cls, picks, n);
  if (block) return block;
  const r = rankOf(picks, id) - 1;
  if (r) picks.ranks[id] = r;
  else delete picks.ranks[id];
  dropLockedMods(picks, id);
  return null;
}

function dropLockedMods(picks: SkillPicks, id: string): void {
  const m = picks.mods[id as ArtId];
  if (!m) return;
  const r = rankOf(picks, id);
  ([0, 1] as const).forEach((row) => {
    if (r < modRowRank(row)) m[row] = null;
  });
  if (!m[0] && !m[1]) delete picks.mods[id as ArtId];
}

/** Pick an Art's modifier in a row (null clears it); the row opens at its rank. Returns why not, or null. */
export function pickMod(picks: SkillPicks, art: ArtId, row: 0 | 1, mod: string | null): string | null {
  if (rankOf(picks, art) < modRowRank(row)) return `Opens at rank ${modRowRank(row)} of ${ARTS[art].name}`;
  if (mod && !ARTS[art].mods[row].some((m) => m.id === mod)) return 'Not a modifier of that row';
  const m = (picks.mods[art] ??= [null, null]);
  m[row] = mod;
  dropLockedMods(picks, art);
  return null;
}

/** Open modifier rows with nothing picked (the Skills tab badge counts them with unspent points). */
export function modsUnpicked(cls: ClassId, picks: SkillPicks): number {
  let n = 0;
  for (const node of skillNodes(cls)) {
    if (node.kind !== 'art') continue;
    for (const row of [0, 1] as const) if (rankOf(picks, node.id) >= modRowRank(row) && !picks.mods[node.id as ArtId]?.[row]) n++;
  }
  return n;
}

/** Stored picks with anything unknown, out of reach, over a top rank or over budget dropped (highest levels first). */
export function readSkills(raw: unknown, cls: ClassId, level: number): SkillPicks {
  const out = emptySkills();
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Partial<SkillPicks>;
  // Rebuild rank by rank in level order, so prerequisites and the budget hold.
  const want = Object.entries(r.ranks ?? {})
    .map(([id, v]) => [skillNode(cls, id), typeof v === 'number' ? Math.floor(v) : 0] as const)
    .filter((e): e is readonly [SkillNode, number] => !!e[0] && e[1] > 0)
    .sort(([a], [b]) => a.level - b.level || (a.pre ? 1 : 0) - (b.pre ? 1 : 0));
  for (let pass = 0; pass < 3; pass++) {
    for (const [n, v] of want) while (rankOf(out, n.id) < v && !rankUp(cls, level, out, n.id));
  }
  for (const [art, picks] of Object.entries(r.mods ?? {})) {
    if (!isArt(art) || !Array.isArray(picks)) continue;
    ([0, 1] as const).forEach((row) => {
      if (typeof picks[row] === 'string') pickMod(out, art, row, picks[row]);
    });
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
    if (!n || depth > 8 || rankOf(out, id) > 0) return;
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
  return SKILL_TREES[cls].flatMap((t) => t.nodes).map(([id]) => id).find((id): id is ArtId => isArt(id) && ARTS[id].level <= 1 && usable(id));
}

export function skillName(n: SkillNode): string {
  return n.kind === 'art' ? ARTS[n.id as ArtId].name : PASSIVES[n.id as PassiveId].name;
}
