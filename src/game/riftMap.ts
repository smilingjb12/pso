import type { AreaId } from './data/areas';
import type { BossId, PinnacleBossId, RiftBossId } from './data/bosses';
import type { RiftCircle } from './data/uniques';
import { firstKillOwed } from './riftCircles';
import type { RiftBiome } from './riftTypes';
import { regionFloors, RIFT_MOD_IDS, RIFT_MODS, type RiftInfo, type RiftModId, type RiftSave } from './rifts';
import { hashString, mulberry32 } from './world/Level';

// The Rift Map (DESIGN.md "Endgame: Falz Rifts" > "The Rift Map"; 2026-10-21, the user's design, picked from a
// clickable mockup with every recommendation taken): one persistent map per character replaces Rift Shards. Rings
// are tiers (1 at the rim, 10 innermost) grouped into the three Rift Circles; quarters belong to the four bosses
// (north the Dragon's Forest, east De Rol Le's Caves, south the Warden's Mines, west Dark Falz's Ruins) and the Heart
// sits at the centre. Clearing a node opens the nodes linked to it, and every node stays open to replay. Room nodes
// (and their Vault and Gauntlet variants) roll modifiers and a cache, anew after every clear; each boss stands at the
// inner edge of every circle in its quarter and replays on Resonance, which rooms cleared in its quarter fill.
// Pinnacles (both neighbouring bosses of a circle) and the Heart (all four Circle III bosses) hold bosses of their own:
// Gal Gryphon at P2NE since 2026-10-21 and Barba Ray at P2SW since 2026-10-22 (PINNACLE_BOSS); the rest are landmarks
// for bosses still to come. The shape is
// fixed (the same for everyone); what a node holds rolls from the character's seed.

/** What a node is. Rooms, Vaults and Gauntlets are the room-like ones (they fill Resonance and roll a cache). */
export type NodeKind = 'room' | 'vault' | 'gauntlet' | 'boss' | 'pinnacle' | 'heart';
export type RoomKind = 'room' | 'vault' | 'gauntlet';
/** What a room node's end drops more of. */
export type CacheKind = 'weapons' | 'armour' | 'units' | 'photons';
export const CACHE_KINDS: CacheKind[] = ['weapons', 'armour', 'units', 'photons'];
export const CACHE_NAME: Record<CacheKind, string> = { weapons: 'Weapons', armour: 'Armour', units: 'Units', photons: 'Photons' };

export const mapCfg = {
  /** Modifiers a room node rolls, by circle: fewest and most (a Gauntlet's Swarming comes on top). */
  mods: { 1: [0, 2], 2: [1, 3], 3: [2, 4] } as Record<RiftCircle, [number, number]>,
  /** Resonance: each room node cleared adds one to its quarter's boss, up to `resonanceCap`. */
  resonanceCap: 6,
  /** A boss fight past its circle's first kill takes this much of its quarter's Resonance. */
  resonanceCost: 2,
  /** A pinnacle fight past its first kill takes this much from each of its two quarters (2026-10-21, the user's pick: 2 + 2). */
  pinnacleCost: 2,
  /** A cache's extra pieces of its kind (Photons: Spheres, and a chance of a Crystal on top). */
  cache: 3,
  spheres: 2,
  crystal: 0.25,
  /** A Vault's cache is this many times a room's (pieces and the Crystal chance). */
  vaultMult: 2,
  /** A Gauntlet's cache gets one more piece for every this many kills. */
  killsPerPiece: 8,
};

/** The four quarters, clockwise from the north: whose boss, which region. */
export const QUARTERS: { region: RiftBiome; boss: BossId; ang: number; key: string }[] = [
  { region: 'forest', boss: 'dragon', ang: -90, key: 'N' },
  { region: 'caves', boss: 'derolle', ang: 0, key: 'E' },
  { region: 'mines', boss: 'warden', ang: 90, key: 'S' },
  { region: 'ruins', boss: 'falz', ang: 180, key: 'W' },
];
export const quarterOf = (b: BossId) => QUARTERS.findIndex((q) => q.boss === b);

export interface MapNode {
  id: string;
  kind: NodeKind;
  /** The quarter (rooms and bosses): index into QUARTERS. */
  q?: number;
  tier: number;
  circle: RiftCircle;
  /** Where it is drawn: radius (the map is 470 across the rim) and angle in degrees (0 east, clockwise). */
  r: number;
  ang: number;
  /** Pinnacles and the Heart: the boss nodes that must be dead first. */
  req?: string[];
}

/** path: the way down a quarter; cross: into the next quarter at the same tier (both ways); req / seal: what opens a pinnacle / the Heart. */
export interface MapEdge {
  a: string;
  b: string;
  kind: 'path' | 'cross' | 'req' | 'seal';
}

const circleOfTier = (t: number): RiftCircle => (t >= 7 ? 3 : t >= 4 ? 2 : 1);
/** The tier each circle's bosses fight at (the inner edge of the circle). */
export const BOSS_TIER: Record<RiftCircle, number> = { 1: 3, 2: 6, 3: 10 };

/**
 * One quarter from the rim inward: a room step has 1 or 2 nodes (`sp`: half the angle between a pair, degrees;
 * `cross`: quarters whose clockwise neighbour this tier links to), a boss step is that circle's boss.
 */
const STEPS: ({ room: number; n: 1 | 2; r: number; sp?: number; cross?: number[] } | { boss: RiftCircle; r: number })[] = [
  { room: 1, n: 1, r: 454 },
  { room: 2, n: 2, r: 426, sp: 11, cross: [0, 2] },
  { room: 3, n: 2, r: 398, sp: 18 },
  { boss: 1, r: 368 },
  { room: 4, n: 1, r: 328 },
  { room: 5, n: 2, r: 300, sp: 13, cross: [1, 3] },
  { room: 6, n: 2, r: 270, sp: 21 },
  { boss: 2, r: 236 },
  { room: 7, n: 1, r: 198 },
  { room: 8, n: 2, r: 172, sp: 16, cross: [0, 2] },
  { room: 9, n: 2, r: 146, sp: 27 },
  { room: 10, n: 2, r: 118, sp: 17 },
  { boss: 3, r: 78 },
];

/** Vaults and Gauntlets: one in each quarter's circle, sides alternating. */
function specialOf(q: number, tier: number, i: number): RoomKind | null {
  if (tier === 3 && i === q % 2) return q % 2 ? 'gauntlet' : 'vault';
  if (tier === 6 && i === (q + 1) % 2) return q % 2 ? 'vault' : 'gauntlet';
  if (tier === 9 && i === q % 2) return q % 2 ? 'gauntlet' : 'vault';
  return null;
}

/** Ids: "N5a" (quarter, tier, side), "EB2" (a quarter's boss of circle II), "P2NE" (pinnacles), "HEART". */
function buildMap(): { nodes: Record<string, MapNode>; edges: MapEdge[] } {
  const nodes: Record<string, MapNode> = {};
  const edges: MapEdge[] = [];
  QUARTERS.forEach((qd, q) => {
    let prev: string[] = [];
    for (const st of STEPS) {
      const ids: string[] = [];
      if ('room' in st) {
        for (let i = 0; i < st.n; i++) {
          const id = `${qd.key}${st.room}${st.n === 1 ? '' : i ? 'b' : 'a'}`;
          const side = st.n === 1 ? 0 : i ? 1 : -1;
          nodes[id] = { id, kind: (st.n === 2 && specialOf(q, st.room, i)) || 'room', q, tier: st.room, circle: circleOfTier(st.room), r: st.r, ang: qd.ang + side * (st.sp ?? 0) };
          ids.push(id);
        }
      } else {
        const id = `${qd.key}B${st.boss}`;
        nodes[id] = { id, kind: 'boss', q, tier: BOSS_TIER[st.boss], circle: st.boss, r: st.r, ang: qd.ang };
        ids.push(id);
      }
      if (prev.length === 1 || ids.length === 1) for (const a of prev) for (const b of ids) edges.push({ a, b, kind: 'path' });
      else if (prev.length) {
        // Two into two: straight down both sides, plus one diagonal (alternating) so the branches can swap.
        const t = 'room' in st ? st.room : 0;
        edges.push({ a: prev[0], b: ids[0], kind: 'path' }, { a: prev[1], b: ids[1], kind: 'path' });
        edges.push((t + q) % 2 ? { a: prev[0], b: ids[1], kind: 'path' } : { a: prev[1], b: ids[0], kind: 'path' });
      }
      prev = ids;
    }
  });
  for (const st of STEPS) {
    if (!('room' in st) || !st.cross) continue;
    for (const q of st.cross) edges.push({ a: `${QUARTERS[q].key}${st.room}b`, b: `${QUARTERS[(q + 1) % 4].key}${st.room}a`, kind: 'cross' });
  }
  // Pinnacles sit on the spokes between two quarters: Circle II's past their bosses II, Circle III's past their bosses III.
  const pins: [string, RiftCircle, number, number, [number, number]][] = [
    ['P2NE', 2, -45, 254, [0, 1]],
    ['P2SW', 2, 135, 254, [2, 3]],
    ['P3SE', 3, 45, 100, [1, 2]],
    ['P3NW', 3, -135, 100, [3, 0]],
  ];
  for (const [id, circle, ang, r, qs] of pins) {
    const req = qs.map((q) => `${QUARTERS[q].key}B${circle}`);
    nodes[id] = { id, kind: 'pinnacle', tier: BOSS_TIER[circle], circle, r, ang, req };
    for (const a of req) edges.push({ a, b: id, kind: 'req' });
  }
  const seals = QUARTERS.map((q) => `${q.key}B3`);
  nodes.HEART = { id: 'HEART', kind: 'heart', tier: 10, circle: 3, r: 0, ang: 0, req: seals };
  for (const a of seals) edges.push({ a, b: 'HEART', kind: 'seal' });
  return { nodes, edges };
}

const BUILT = buildMap();
export const MAP_NODES: Readonly<Record<string, MapNode>> = BUILT.nodes;
export const MAP_EDGES: readonly MapEdge[] = BUILT.edges;
export const MAP_IDS = Object.keys(MAP_NODES);

/** What clearing a node opens (path edges forward, cross-links both ways). Pinnacles and the Heart open by `req`. */
const OPENS: Record<string, string[]> = Object.fromEntries(MAP_IDS.map((id) => [id, [] as string[]]));
/** Linked nodes either way (path and cross): a locked node next to a reached one is "in reach" and shown. */
export const MAP_NEIGHBOURS: Record<string, string[]> = Object.fromEntries(MAP_IDS.map((id) => [id, [] as string[]]));
for (const e of MAP_EDGES) {
  if (e.kind !== 'path' && e.kind !== 'cross') continue;
  OPENS[e.a].push(e.b);
  if (e.kind === 'cross') OPENS[e.b].push(e.a);
  MAP_NEIGHBOURS[e.a].push(e.b);
  MAP_NEIGHBOURS[e.b].push(e.a);
}
const GATED = MAP_IDS.filter((id) => MAP_NODES[id].req);

export const isRoomKind = (k: NodeKind): k is RoomKind => k === 'room' || k === 'vault' || k === 'gauntlet';

/**
 * The pinnacles that hold a boss: Gal Gryphon on Storm Peak, between the Dragon's and De Rol Le's quarters (2026-10-21),
 * and Barba Ray on the Temple Court, between the Warden's and Dark Falz's (2026-10-22). The others stay landmarks.
 */
export const PINNACLE_BOSS: Partial<Record<string, PinnacleBossId>> = { P2NE: 'gryphon', P2SW: 'barba' };
/** The region whose floor music plays after a pinnacle's kill (its first quarter's). */
const pinnacleRegion = (n: MapNode): RiftBiome => QUARTERS[quarterOf(n.req ? bossOfNode(n.req[0]) : 'dragon')].region;
const bossOfNode = (id: string): BossId => QUARTERS[MAP_NODES[id].q!].boss;
/** The boss a boss node is (rooms: their quarter's). */
export const nodeBoss = (n: MapNode): BossId | undefined => (n.q !== undefined ? QUARTERS[n.q].boss : undefined);
/** Who a node's fight is against: a boss node's quarter boss, a pinnacle's own (undefined for rooms and empty landmarks). */
export function nodeFighter(n: MapNode): RiftBossId | undefined {
  if (n.kind === 'boss') return nodeBoss(n);
  return n.kind === 'pinnacle' ? PINNACLE_BOSS[n.id] : undefined;
}
/** The quarter bosses whose Resonance a pinnacle's replay takes (both its neighbours). */
export const pinnacleQuarters = (n: MapNode): BossId[] => (n.req ?? []).map(bossOfNode);
export const nodeRegion = (n: MapNode): RiftBiome | undefined => (n.q !== undefined ? QUARTERS[n.q].region : undefined);

// ------------------------------------------------------------------ save

export type NodeStatus = 'locked' | 'open' | 'cleared';

/** A node's progress: open or cleared (locked ones aren't stored), how often it was cleared, its roll count. */
export interface NodeSave {
  s: 'open' | 'cleared';
  /** Clears (room-like) or kills (bosses). */
  n?: number;
  /** Room nodes: how many times it rolled anew (once a clear); what it holds comes from the seed and this. */
  roll?: number;
}

export interface RiftMapSave {
  /** Seeds every node's roll (so two characters' maps hold different things). */
  seed: number;
  nodes: Record<string, NodeSave>;
  /** Resonance per boss: room nodes cleared in its quarter, up to mapCfg.resonanceCap. */
  res: Partial<Record<BossId, number>>;
  /** The node last picked on the map (the Rift Gate opens on it). */
  sel?: string;
}

const ENTRIES = QUARTERS.map((q) => `${q.key}1`);

/** A new map: the four tier-1 rooms open. */
export function newMap(seed: number): RiftMapSave {
  return { seed, nodes: Object.fromEntries(ENTRIES.map((id) => [id, { s: 'open' } as NodeSave])), res: {} };
}

export function nodeStatus(map: RiftMapSave, id: string): NodeStatus {
  return map.nodes[id]?.s ?? 'locked';
}

/** Open what a cleared node links to, and any pinnacle or the Heart whose bosses are all down. Returns the newly opened. */
function openFrom(map: RiftMapSave, id: string): string[] {
  const opened: string[] = [];
  const open = (x: string) => {
    if (map.nodes[x]) return;
    map.nodes[x] = { s: 'open' };
    opened.push(x);
  };
  for (const x of OPENS[id] ?? []) if (!MAP_NODES[x].req) open(x);
  for (const g of GATED) if (MAP_NODES[g].req!.every((r) => nodeStatus(map, r) === 'cleared')) open(g);
  return opened;
}

/**
 * The old tier ladder on the map (saves from before 2026-10-21): everything below the highest open tier counts as
 * cleared (rooms and bosses), the tier itself is open, and a boss on it is cleared too if it was ever closed (`best`).
 * Resonance starts empty; first-kill uniques still owed stay owed (RiftSave.firsts).
 */
export function mapFromLadder(tier: number, best: number, seed: number): RiftMapSave {
  const map = newMap(seed);
  for (const id of MAP_IDS) {
    const n = MAP_NODES[id];
    if (n.kind === 'pinnacle' || n.kind === 'heart') continue;
    if (n.tier < tier || (n.kind === 'boss' && n.tier <= best)) map.nodes[id] = { s: 'cleared', n: 1 };
  }
  for (const id of MAP_IDS) if (nodeStatus(map, id) === 'cleared') openFrom(map, id);
  return map;
}

/** The deepest tier a reached node stands on (1 on a new map). */
export function mapDepth(map: RiftMapSave): number {
  let d = 1;
  for (const id of Object.keys(map.nodes)) if (MAP_NODES[id] && isRoomOrBoss(MAP_NODES[id])) d = Math.max(d, MAP_NODES[id].tier);
  return d;
}
const isRoomOrBoss = (n: MapNode) => isRoomKind(n.kind) || n.kind === 'boss';

/** The deepest tier with a node cleared (0 if none). */
export function mapBest(map: RiftMapSave): number {
  let d = 0;
  for (const [id, s] of Object.entries(map.nodes)) if (s.s === 'cleared' && MAP_NODES[id] && isRoomOrBoss(MAP_NODES[id])) d = Math.max(d, MAP_NODES[id].tier);
  return d;
}

/** Shown on the map: reached nodes, locked ones linked to a reached one, and the landmarks (bosses, pinnacles, the Heart). */
export function nodeShown(map: RiftMapSave, id: string): boolean {
  const n = MAP_NODES[id];
  if (!isRoomKind(n.kind) || map.nodes[id]) return true;
  return MAP_NEIGHBOURS[id].some((x) => map.nodes[x]);
}

// ------------------------------------------------------------------ rolls

/** What a room node holds this time round: its modifiers, cache, look and layout seed. */
export interface NodeRoll {
  mods: RiftModId[];
  cache: CacheKind;
  /** Bleeding: whose hazards come through. */
  second?: RiftBiome;
  look: AreaId;
  seed: number;
}

const BLEED_REGIONS: RiftBiome[] = ['caves', 'mines', 'ruins'];

/** A room node's roll (deterministic: the map's seed, the node and how many times it rolled anew). */
export function nodeRoll(map: RiftMapSave, id: string): NodeRoll {
  const n = MAP_NODES[id];
  const region = nodeRegion(n)!;
  const rng = mulberry32(hashString(`riftmap:${map.seed}:${id}:${map.nodes[id]?.roll ?? 0}`));
  const pick = <T>(a: readonly T[]): T => a[Math.floor(rng() * a.length)];
  const floors = regionFloors(region);
  const look = pick(floors);
  const [lo, hi] = mapCfg.mods[n.circle];
  const want = lo + Math.floor(rng() * (hi - lo + 1));
  const mods: RiftModId[] = [];
  while (mods.length < want) {
    // At most one elite-affix modifier and one crowd-control modifier; a Gauntlet's Swarming is already there.
    const options = RIFT_MOD_IDS.filter((m) => !mods.includes(m)
      && !(n.kind === 'gauntlet' && m === 'swarming')
      && !(RIFT_MODS[m].affix && mods.some((x) => RIFT_MODS[x].affix))
      && !(RIFT_MODS[m].cc && mods.some((x) => RIFT_MODS[x].cc)));
    mods.push(pick(options));
  }
  const cache = pick(CACHE_KINDS);
  const roll: NodeRoll = { mods, cache, look, seed: Math.floor(rng() * 2 ** 31) };
  if (mods.some((m) => RIFT_MODS[m].second)) roll.second = pick(BLEED_REGIONS.filter((b) => b !== region));
  if (n.kind === 'gauntlet') roll.mods = ['swarming', ...mods];
  return roll;
}

/** The run a node opens: a room node's roll on its quarter's region, or the boss in its own arena (no modifiers). */
export function nodeRift(map: RiftMapSave, id: string): RiftInfo {
  const n = MAP_NODES[id];
  const pin = n.kind === 'pinnacle' ? PINNACLE_BOSS[id] : undefined;
  if (pin) {
    const region = pinnacleRegion(n);
    const seed = hashString(`riftmap:${map.seed}:${id}:${map.nodes[id]?.n ?? 0}`);
    return { region, look: regionFloors(region)[0], bossRegion: region, pinnacle: pin, tier: n.tier, mods: [], seed, boss: true, node: id, kind: 'boss', complete: false };
  }
  const region = nodeRegion(n);
  if (!region || !(isRoomKind(n.kind) || n.kind === 'boss')) throw new Error(`nodeRift: ${id} can't be entered`);
  if (n.kind === 'boss') {
    const seed = hashString(`riftmap:${map.seed}:${id}:${map.nodes[id]?.n ?? 0}`);
    return { region, look: regionFloors(region)[0], bossRegion: region, tier: n.tier, mods: [], seed, boss: true, node: id, kind: 'boss', complete: false };
  }
  const r = nodeRoll(map, id);
  return {
    region, look: r.look, bossRegion: region, tier: n.tier, mods: r.mods, ...(r.second ? { second: r.second } : {}),
    seed: r.seed, boss: false, node: id, kind: n.kind as RoomKind, cache: r.cache, complete: false,
  };
}

// ------------------------------------------------------------------ entering and clearing

/**
 * Resonance a fight takes now, per quarter boss: a boss node's from its own quarter, a pinnacle's from both of its
 * quarters. None while its circle's first-kill unique is owed (or it was never killed).
 */
export function nodeCosts(save: RiftSave, id: string): Partial<Record<BossId, number>> {
  const n = MAP_NODES[id];
  const who = nodeFighter(n);
  if (!who || nodeStatus(save.map!, id) !== 'cleared' || firstKillOwed(save, who, n.circle)) return {};
  if (n.kind === 'boss') return { [who as BossId]: mapCfg.resonanceCost };
  return Object.fromEntries(pinnacleQuarters(n).map((b) => [b, mapCfg.pinnacleCost]));
}

/** All the Resonance a fight takes now (summed over its quarters). */
export function nodeCost(save: RiftSave, id: string): number {
  return Object.values(nodeCosts(save, id)).reduce((a, v) => a + (v ?? 0), 0);
}

export const resonance = (save: RiftSave, boss: BossId) => save.map?.res[boss] ?? 0;

/** Can this node be entered now, and if not, why ("" when it can). */
export function enterBlock(save: RiftSave, id: string): string {
  const n = MAP_NODES[id];
  const st = nodeStatus(save.map!, id);
  if (n.kind === 'heart' || (n.kind === 'pinnacle' && !PINNACLE_BOSS[id])) return 'A boss still to come will stand here.';
  if (st === 'locked') {
    if (n.kind === 'pinnacle') return `Opens once ${n.req!.map(nodeName).join(' and ')} are dead.`;
    return n.kind === 'boss' ? 'Clear a room linked to it to open it.' : 'Clear a node linked to it to open it.';
  }
  const short = Object.entries(nodeCosts(save, id)).filter(([b, c]) => resonance(save, b as BossId) < (c ?? 0));
  if (!short.length) return '';
  if (n.kind === 'boss') {
    const [b, c] = short[0];
    return `Needs ${c} Resonance (you have ${resonance(save, b as BossId)}): clear rooms in its quarter.`;
  }
  const each = Object.entries(nodeCosts(save, id)).map(([b, c]) => `${c} ${BOSS_NAME[b as BossId]} (you have ${resonance(save, b as BossId)})`);
  return `Needs ${each.join(' and ')} Resonance: clear rooms in both quarters.`;
}

/** Take a replay's Resonance as it is entered (a pinnacle's from both quarters). Returns the total taken. */
export function payEntry(save: RiftSave, id: string): number {
  let paid = 0;
  for (const [b, c] of Object.entries(nodeCosts(save, id))) {
    const boss = b as BossId;
    save.map!.res[boss] = Math.max(0, resonance(save, boss) - (c ?? 0));
    paid += c ?? 0;
  }
  return paid;
}

/**
 * A node was cleared (a room's Guardian room, a Vault, a Gauntlet, or a boss down): it counts, a room node rolls
 * anew and adds Resonance to its quarter's boss, and what it links to opens. Returns the newly opened nodes.
 */
export function clearNode(save: RiftSave, id: string): string[] {
  const map = save.map!;
  const n = MAP_NODES[id];
  const s = (map.nodes[id] ??= { s: 'open' });
  s.s = 'cleared';
  s.n = (s.n ?? 0) + 1;
  if (isRoomKind(n.kind)) {
    s.roll = (s.roll ?? 0) + 1;
    const boss = nodeBoss(n)!;
    map.res[boss] = Math.min(mapCfg.resonanceCap, resonance(save, boss) + 1);
  }
  return openFrom(map, id);
}

/** "Rift · Tier 5 · Caves", "Rift Vault · Tier 5 · Caves", "Warden II" ... */
export function nodeName(id: string): string {
  const n = MAP_NODES[id];
  const region = nodeRegion(n);
  const roman = ['I', 'II', 'III'][n.circle - 1];
  switch (n.kind) {
    case 'boss':
      return `${BOSS_NAME[nodeBoss(n)!]} ${roman}`;
    case 'pinnacle':
      return PINNACLE_BOSS[id] ? BOSS_NAME[PINNACLE_BOSS[id]!] : `Pinnacle ${roman}`;
    case 'heart':
      return 'The Heart';
    default:
      return `Rift${n.kind === 'room' ? '' : n.kind === 'vault' ? ' Vault' : ' Gauntlet'} · Tier ${n.tier} · ${REGION_NAME[region!]}`;
  }
}
const BOSS_NAME: Record<RiftBossId, string> = { dragon: 'Dragon', derolle: 'De Rol Le', warden: 'Warden', falz: 'Dark Falz', gryphon: 'Gal Gryphon', barba: 'Barba Ray' };
const REGION_NAME: Record<RiftBiome, string> = { forest: 'Forest', caves: 'Caves', mines: 'Mines', ruins: 'Ruins' };

/** Every node opened (debug): nothing cleared, every first kill still where it was. */
export function openWholeMap(map: RiftMapSave): void {
  for (const id of MAP_IDS) map.nodes[id] ??= { s: 'open' };
}

/** The deepest reached node of a kind (rooms: any room-like), for the debug warps. */
export function deepestNode(map: RiftMapSave, boss: boolean): string | null {
  let best: MapNode | null = null;
  for (const id of Object.keys(map.nodes)) {
    const n = MAP_NODES[id];
    if (!n || (boss ? n.kind !== 'boss' : n.kind !== 'room')) continue;
    if (!best || n.tier > best.tier) best = n;
  }
  return best?.id ?? null;
}
