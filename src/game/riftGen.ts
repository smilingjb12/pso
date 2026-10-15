import type { EnemyId } from './config';
import type { FeatureDef, LinkDef, RoomDef, SpawnDef } from './data/areas';
import { RIFT_BIOMES, type RiftBiome, type RiftGenOptions } from './riftTypes';
import { hashString, mulberry32 } from './world/Level';

// Falz Rifts room generator (DESIGN.md "Endgame: Falz Rifts"). Pure and deterministic: every random choice comes
// from `o.seed`, so the same options always give the same rooms and links.
//
// Layout: a 10x10 start room, a main path of fight rooms grown one from the other (a random free side of the
// previous room, never back the way we came, the rooms overlapping by >= 4 tiles so the level builder can carve a
// straight corridor), one switch side room whose `L1` switch opens the main-path gate after the room it hangs off,
// an optional bonus side room, and the Guardian room last (plus, with `boss`, a small teleporter room after it).
// Placements that crowd another room or corridor are rejected; a stuck layout restarts from a derived seed.
// Contents follow the hand-authored floors in data/areas.ts: waves filled to a threat budget that grows with the
// room's area, pinned Lilies / control nodes, the region's hazards, boxes and trees.

type Side = 'n' | 'e' | 's' | 'w';
type Role = 'start' | 'fight' | 'switch' | 'bonus' | 'guardian' | 'boss';

export interface Rect {
  x: number;
  z: number;
  w: number;
  h: number;
}

/** Tuning for the generator (sizes in 2 m tiles, budgets in threat points; see RIFT_THREAT). */
export const RIFT_GEN = {
  /** Fight rooms on the main path, the Guardian room included. */
  mainRooms: [5, 7] as [number, number],
  gap: [4, 8] as [number, number],
  /** Minimum overlap between a room and the one it grows from (on the axis the corridor runs across). */
  overlap: 4,
  /** Empty tiles kept between two rooms, and between a room and a corridor it doesn't own. */
  roomPad: 3,
  corridorPad: 2,
  /** Fitting placements compared per room (the most compact wins; 1 = a pure random walk). */
  candidates: 3,
  start: [10, 10] as [number, number],
  fightW: [12, 20] as [number, number],
  fightH: [10, 18] as [number, number],
  switchW: [12, 14] as [number, number],
  switchH: [10, 12] as [number, number],
  bonusW: [12, 14] as [number, number],
  bonusH: [10, 12] as [number, number],
  guardianW: [18, 22] as [number, number],
  guardianH: [16, 20] as [number, number],
  bossRoom: [8, 10] as [number, number],
  /** Per-wave threat: `min` at `areaLo` tiles², `max` at `areaHi` and above, ± jitter/2. */
  wave: { min: 4, max: 5, areaLo: 120, areaHi: 340, jitter: 0.8, guardian: 6, maxSize: 7 },
  /** Fight rooms at least this big get a third wave. */
  bigArea: 340,
  ambushChance: 0.28,
  overlapChance: 0.28,
  /** Convergence: share of each wave's budget from the mixed-in region. */
  mixShare: 0.4,
  /** Bleed: share of fight rooms that also get the second region's hazards, and how much of them. */
  bleedChance: 0.5,
  bleedScale: 0.6,
  /** Hazard points per 100 tiles² (one point ~ one vent / crusher / laser / pool). */
  hazardPer100: 1,
  /** Forest trees: one per this many tiles². */
  treeArea: 40,
  /** Features stay this far from walls and corridor mouths. */
  wallMargin: 1.5,
  mouthClear: 3,
};

// ------------------------------------------------------------------ rosters

/** Threat cost of one enemy (basic 1, mid 1.25-2, brute 3, Chaos Bringer 4). */
export const RIFT_THREAT: Partial<Record<EnemyId, number>> = {
  Booma: 1, Gobooma: 1.5, Gigobooma: 3,
  CaveBooma: 1, CaveGobooma: 1.5, CaveGigobooma: 3, PanArms: 3, PoisonLily: 1,
  Gillchic: 1, Sinow: 1.5, Garanz: 2, ControlNode: 1.5,
  Dimenian: 1, LaDimenian: 1.25, SoDimenian: 1.5, Delsaber: 2, ChaosSorcerer: 2, DarkBelra: 3, ChaosBringer: 4,
};

interface RosterEntry {
  e: EnemyId;
  /** Relative pick weight. */
  w: number;
  /** Most per wave. */
  max?: number;
  /** Most per room. */
  perRoom?: number;
}

/** Wave rosters per region (the free-roaming types; pinned Lilies and control nodes are added separately). */
export const RIFT_ROSTERS: Record<RiftBiome, RosterEntry[]> = {
  forest: [
    { e: 'Booma', w: 4 },
    { e: 'Gobooma', w: 3 },
    { e: 'Gigobooma', w: 1.2, max: 1 },
  ],
  caves: [
    { e: 'CaveBooma', w: 4 },
    { e: 'CaveGobooma', w: 3 },
    { e: 'CaveGigobooma', w: 1, max: 1 },
    { e: 'PanArms', w: 1, max: 1 },
  ],
  mines: [
    { e: 'Gillchic', w: 4 },
    { e: 'Sinow', w: 2.5, max: 3 },
    { e: 'Garanz', w: 1.8, max: 2 },
  ],
  ruins: [
    { e: 'Dimenian', w: 3 },
    { e: 'LaDimenian', w: 2.5 },
    { e: 'SoDimenian', w: 2 },
    { e: 'Delsaber', w: 1.6, max: 2 },
    { e: 'ChaosSorcerer', w: 1.4, max: 2 },
    { e: 'DarkBelra', w: 1, max: 1 },
    { e: 'ChaosBringer', w: 0.5, max: 1, perRoom: 1 },
  ],
};

const threatOf = (e: EnemyId) => RIFT_THREAT[e] ?? 1;
const spawnId = (s: SpawnDef): EnemyId => (typeof s === 'string' ? s : s.e);

/** Total threat of a set of rooms' waves (for readouts and balance). */
export function riftThreat(rooms: RoomDef[]): number {
  let t = 0;
  for (const r of rooms) for (const w of r.waves ?? []) for (const s of w) t += threatOf(spawnId(s));
  return t;
}

// ---------------------------------------------------------------- geometry

/** Do two rects intersect once `a` is grown by `pad` tiles on every side? */
export function rectsHit(a: Rect, b: Rect, pad = 0): boolean {
  return a.x - pad < b.x + b.w && b.x < a.x + a.w + pad && a.z - pad < b.z + b.h && b.z < a.z + a.h + pad;
}

/**
 * The tiles a link carves, exactly as Level.carveLink does: a 2-tile corridor through the middle of the rooms'
 * overlap. Null when the rooms aren't aligned (Level would throw).
 */
export function corridorRect(a: Rect, b: Rect): Rect | null {
  const ox0 = Math.max(a.x, b.x);
  const ox1 = Math.min(a.x + a.w, b.x + b.w) - 1;
  const oz0 = Math.max(a.z, b.z);
  const oz1 = Math.min(a.z + a.h, b.z + b.h) - 1;
  if (ox1 - ox0 >= 1 && (a.z + a.h <= b.z || b.z + b.h <= a.z)) {
    const [t, u] = a.z > b.z ? [b, a] : [a, b];
    const cx = Math.floor((ox0 + ox1) / 2);
    return { x: cx, z: t.z + t.h, w: 2, h: u.z - (t.z + t.h) };
  }
  if (oz1 - oz0 >= 1 && (a.x + a.w <= b.x || b.x + b.w <= a.x)) {
    const [l, r] = a.x > b.x ? [b, a] : [a, b];
    const cz = Math.floor((oz0 + oz1) / 2);
    return { x: l.x + l.w, z: cz, w: r.x - (l.x + l.w), h: 2 };
  }
  return null;
}

/** Where a link's corridor meets each room (room-local tiles: the middle of the 2-tile opening on the wall). */
export function linkMouths(a: Rect, b: Rect): [{ tx: number; tz: number }, { tx: number; tz: number }] | null {
  const c = corridorRect(a, b);
  if (!c) return null;
  const mouth = (r: Rect) => {
    if (c.w === 2 && (c.z === r.z + r.h || c.z + c.h === r.z)) {
      return { tx: c.x + 1 - r.x, tz: c.z === r.z + r.h ? r.h : 0 };
    }
    return { tx: c.x === r.x + r.w ? r.w : 0, tz: c.z + 1 - r.z };
  };
  return [mouth(a), mouth(b)];
}

/** Every corridor mouth of each room, by room id. */
export function roomMouths(rooms: RoomDef[], links: LinkDef[]): Map<string, { tx: number; tz: number }[]> {
  const byId = new Map(rooms.map((r) => [r.id, r]));
  const out = new Map<string, { tx: number; tz: number }[]>(rooms.map((r) => [r.id, []]));
  for (const l of links) {
    const a = byId.get(l.a);
    const b = byId.get(l.b);
    if (!a || !b) continue;
    const m = linkMouths(a, b);
    if (!m) continue;
    out.get(a.id)!.push(m[0]);
    out.get(b.id)!.push(m[1]);
  }
  return out;
}

// ------------------------------------------------------------------ random

class Rng {
  private next: () => number;
  constructor(seed: number) {
    this.next = mulberry32(seed);
  }
  f(): number {
    return this.next();
  }
  range(lo: number, hi: number): number {
    return lo + this.next() * (hi - lo);
  }
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }
  /** An even number in [lo, hi]. */
  even(lo: number, hi: number): number {
    return 2 * this.int(Math.ceil(lo / 2), Math.floor(hi / 2));
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(a: readonly T[]): T {
    return a[Math.floor(this.next() * a.length)];
  }
  shuffle<T>(a: T[]): T[] {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
}

const r1 = (x: number) => Math.round(x * 10) / 10;

class Retry extends Error {}

// ------------------------------------------------------------------ layout

interface Node {
  id: string;
  rect: Rect;
  role: Role;
  used: Set<Side>;
}

interface Layout {
  nodes: Node[];
  links: LinkDef[];
  corridors: Rect[];
}

const OPPOSITE: Record<Side, Side> = { n: 's', s: 'n', e: 'w', w: 'e' };

function childRect(rng: Rng, p: Rect, side: Side, w: number, h: number): Rect {
  const gap = rng.int(RIFT_GEN.gap[0], RIFT_GEN.gap[1]);
  const ov = RIFT_GEN.overlap;
  if (side === 'e' || side === 'w') {
    const z = rng.int(p.z - h + ov, p.z + p.h - ov);
    return { x: side === 'e' ? p.x + p.w + gap : p.x - gap - w, z, w, h };
  }
  const x = rng.int(p.x - w + ov, p.x + p.w - ov);
  return { x, z: side === 's' ? p.z + p.h + gap : p.z - gap - h, w, h };
}

/** Bounding-box area of the layout with one more rect. */
function spread(lay: Layout, extra: Rect): number {
  let x0 = extra.x;
  let z0 = extra.z;
  let x1 = extra.x + extra.w;
  let z1 = extra.z + extra.h;
  for (const n of lay.nodes) {
    x0 = Math.min(x0, n.rect.x);
    z0 = Math.min(z0, n.rect.z);
    x1 = Math.max(x1, n.rect.x + n.rect.w);
    z1 = Math.max(z1, n.rect.z + n.rect.h);
  }
  return (x1 - x0) * (z1 - z0);
}

/**
 * Grow a room of this size off `parent`, or null if every try crowds something. Of the first few placements that
 * fit, the one that keeps the map most compact wins (a pure random walk sprawls).
 */
function grow(rng: Rng, lay: Layout, parent: Node, role: Role, w: number, h: number, lock?: string): Node | null {
  const sides = (['n', 'e', 's', 'w'] as Side[]).filter((s) => !parent.used.has(s));
  if (!sides.length) return null;
  let best: { rect: Rect; cor: Rect; side: Side; score: number } | null = null;
  let found = 0;
  for (let attempt = 0; attempt < 40 && found < RIFT_GEN.candidates; attempt++) {
    const side = rng.pick(sides);
    // Rooms grown north/south turn sideways now and then (sizes stay in range).
    const [rw, rh] = (side === 'n' || side === 's') && role !== 'boss' && rng.chance(0.3) && h + 2 <= w ? [h + 2, w - 2] : [w, h];
    const rect = childRect(rng, parent.rect, side, rw, rh);
    const cor = corridorRect(parent.rect, rect);
    if (!cor) continue;
    if (lay.nodes.some((n) => rectsHit(rect, n.rect, RIFT_GEN.roomPad))) continue;
    if (lay.corridors.some((c) => rectsHit(rect, c, RIFT_GEN.corridorPad))) continue;
    if (lay.nodes.some((n) => n !== parent && rectsHit(cor, n.rect, RIFT_GEN.corridorPad))) continue;
    if (lay.corridors.some((c) => rectsHit(cor, c, 1))) continue;
    found++;
    const score = spread(lay, rect);
    if (!best || score < best.score) best = { rect, cor, side, score };
  }
  if (!best) return null;
  const node: Node = { id: `k${lay.nodes.length}`, rect: best.rect, role, used: new Set([OPPOSITE[best.side]]) };
  parent.used.add(best.side);
  lay.nodes.push(node);
  lay.corridors.push(best.cor);
  lay.links.push(lock ? { a: parent.id, b: node.id, lock } : { a: parent.id, b: node.id });
  return node;
}

function layout(rng: Rng, boss: boolean): Layout {
  const G = RIFT_GEN;
  const n = rng.int(G.mainRooms[0], G.mainRooms[1]);
  // 8-10 rooms before the boss teleporter: two side rooms when the main path is short.
  const branches = n <= 6 ? 2 : rng.chance(0.5) ? 2 : 1;
  // The switch room hangs off main fight room `branchAt` (1-based); the gate after it is locked.
  const branchAt = rng.int(2, n - 2);
  const bonusAt = branches === 2 ? rng.pick(Array.from({ length: n - 1 }, (_, i) => i + 1).filter((i) => i !== branchAt)) : -1;

  const start: Node = { id: 'k0', rect: { x: 0, z: 0, w: G.start[0], h: G.start[1] }, role: 'start', used: new Set() };
  const lay: Layout = { nodes: [start], links: [], corridors: [] };
  let prev = start;
  for (let m = 1; m <= n; m++) {
    const guardian = m === n;
    const w = guardian ? rng.even(G.guardianW[0], G.guardianW[1]) : rng.even(G.fightW[0], G.fightW[1]);
    const h = guardian ? rng.even(G.guardianH[0], G.guardianH[1]) : rng.even(G.fightH[0], G.fightH[1]);
    const node = grow(rng, lay, prev, guardian ? 'guardian' : 'fight', w, h, m === branchAt + 1 ? 'L1' : undefined);
    if (!node) throw new Retry();
    if (m === branchAt && !grow(rng, lay, node, 'switch', rng.even(G.switchW[0], G.switchW[1]), rng.even(G.switchH[0], G.switchH[1]))) throw new Retry();
    if (m === bonusAt && !grow(rng, lay, node, 'bonus', rng.even(G.bonusW[0], G.bonusW[1]), rng.even(G.bonusH[0], G.bonusH[1]))) throw new Retry();
    prev = node;
  }
  if (boss && !grow(rng, lay, prev, 'boss', G.bossRoom[0], G.bossRoom[1])) throw new Retry();
  return lay;
}

// ------------------------------------------------------------ room filling

interface Blob {
  x: number;
  z: number;
  r: number;
  mouth?: boolean;
}

/** Free-space bookkeeping inside one room (room-local tiles). */
class Space {
  readonly blobs: Blob[] = [];
  constructor(
    readonly w: number,
    readonly h: number,
    readonly mouths: { tx: number; tz: number }[],
  ) {
    for (const m of mouths) this.blobs.push({ x: m.tx, z: m.tz, r: RIFT_GEN.mouthClear, mouth: true });
  }

  wallDist(x: number, z: number): number {
    return Math.min(x, z, this.w - x, this.h - z);
  }

  /** Is a circle free? `mouthExtra` keeps it further from corridor mouths. */
  free(c: Blob, wall: number, mouthExtra = 0): boolean {
    if (this.wallDist(c.x, c.z) < wall) return false;
    return this.blobs.every((b) => Math.hypot(b.x - c.x, b.z - c.z) >= b.r + c.r + (b.mouth ? mouthExtra : 0));
  }

  /** All circles free (a multi-part shape). */
  allFree(cs: Blob[], wall: number, mouthExtra = 0): boolean {
    return cs.every((c) => this.free(c, wall, mouthExtra));
  }

  /**
   * A free spot with radius `r`, at least `wall` from every wall (and at most `maxWall` from the nearest one, when
   * given: switches and power boxes sit by a wall). Null if none was found.
   */
  spot(rng: Rng, r: number, wall: number, opts: { maxWall?: number; mouthExtra?: number; tries?: number } = {}): Blob | null {
    const { maxWall, mouthExtra = 0, tries = 80 } = opts;
    if (this.w < wall * 2 || this.h < wall * 2) return null;
    for (let i = 0; i < tries; i++) {
      let x: number;
      let z: number;
      if (maxWall !== undefined) {
        const side = rng.pick(['n', 'e', 's', 'w'] as Side[]);
        const d = rng.range(wall, maxWall);
        if (side === 'n' || side === 's') {
          x = rng.range(wall, this.w - wall);
          z = side === 'n' ? d : this.h - d;
        } else {
          z = rng.range(wall, this.h - wall);
          x = side === 'w' ? d : this.w - d;
        }
      } else {
        x = rng.range(wall, this.w - wall);
        z = rng.range(wall, this.h - wall);
      }
      const c = { x: r1(x), z: r1(z), r };
      if (this.free(c, wall, mouthExtra)) return c;
    }
    return null;
  }

  take(...cs: Blob[]): void {
    this.blobs.push(...cs);
  }
}

/** Hazard counts are fractional budgets: 2.4 → 2, plus a 40% chance of a third. */
const count = (rng: Rng, x: number) => Math.floor(x) + (rng.chance(x - Math.floor(x)) ? 1 : 0);

interface Fill {
  room: RoomDef;
  space: Space;
  rng: Rng;
  /** Circuit ids handed out in this area. */
  circuits: { n: number };
}

function addFeature(f: Fill, def: FeatureDef, at: Blob): void {
  f.space.take(at);
  (f.room.features ??= []).push(def);
}

function placeVent(f: Fill): boolean {
  const c = f.space.spot(f.rng, 1.4, 2);
  if (!c) return false;
  f.space.take(c);
  (f.room.vents ??= []).push([c.x, c.z, r1(f.rng.range(0, 6.4))]);
  return true;
}

function placePool(f: Fill, kind: 'marsh' | 'slag'): boolean {
  const { rng } = f;
  const rx = r1(kind === 'marsh' ? rng.range(2, 3.4) : rng.range(1.5, 2.2));
  const rz = r1(kind === 'marsh' ? rng.range(1.6, 2.6) : rng.range(1.3, 1.6));
  const R = Math.max(rx, rz);
  const c = f.space.spot(rng, R + 0.3, R + 1.2);
  if (!c) return false;
  f.space.take(c);
  (f.room[kind] ??= []).push([c.x, c.z, rx, rz]);
  return true;
}

function placeCrusher(f: Fill, power?: string): boolean {
  const c = f.space.spot(f.rng, 1.5, 2);
  if (!c) return false;
  f.space.take(c);
  const phase = f.rng.chance(0.6) ? r1(f.rng.range(0.5, 3.5)) : undefined;
  (f.room.crushers ??= []).push({ tx: c.x, tz: c.z, ...(phase !== undefined ? { phase } : {}), ...(power ? { power } : {}) });
  return true;
}

/** A laser fence between two posts, axis-aligned and short enough to walk round both ends. */
function placeLaser(f: Fill, power?: string): boolean {
  const { rng, space } = f;
  for (let i = 0; i < 40; i++) {
    const horiz = rng.chance(0.5);
    const span = horiz ? space.w : space.h;
    const across = horiz ? space.h : space.w;
    const maxLen = Math.min(7, Math.floor(span * 0.55));
    if (maxLen < 4 || across < 6) return false;
    const len = rng.int(4, maxLen);
    const a = r1(rng.range(2, span - 2 - len));
    const c = r1(rng.range(3, across - 3));
    const blobs: Blob[] = [];
    for (let k = 0; k <= len; k++) blobs.push(horiz ? { x: a + k, z: c, r: 0.7 } : { x: c, z: a + k, r: 0.7 });
    if (!space.allFree(blobs, 1.5, 1)) continue;
    space.take(...blobs);
    const phase = rng.chance(0.5) ? r1(rng.range(0.5, 4.5)) : undefined;
    (f.room.lasers ??= []).push({
      ...(horiz ? { ax: a, az: c, bx: a + len, bz: c } : { ax: c, az: a, bx: c, bz: a + len }),
      ...(phase !== undefined ? { phase } : {}),
      ...(power ? { power } : {}),
    });
    return true;
  }
  return false;
}

/** A conveyor belt: 2 tiles wide, running along its length. */
function placeConveyor(f: Fill, power?: string): boolean {
  const { rng, space } = f;
  for (let i = 0; i < 40; i++) {
    const horiz = rng.chance(0.5);
    const span = horiz ? space.w : space.h;
    const across = horiz ? space.h : space.w;
    const maxLen = Math.min(10, span - 4);
    if (maxLen < 5 || across < 7) return false;
    const len = rng.int(5, maxLen);
    const a = rng.int(2, span - 2 - len);
    const c = rng.int(2, across - 4);
    const blobs: Blob[] = [];
    for (let k = 0; k < len; k++) for (let j = 0; j < 2; j++) {
      blobs.push(horiz ? { x: a + k + 0.5, z: c + j + 0.5, r: 0.8 } : { x: c + j + 0.5, z: a + k + 0.5, r: 0.8 });
    }
    if (!space.allFree(blobs, 1.2, 1)) continue;
    space.take(...blobs);
    const dir = horiz ? rng.pick(['e', 'w'] as const) : rng.pick(['n', 's'] as const);
    (f.room.conveyors ??= []).push({
      ...(horiz ? { tx: a, tz: c, w: len, h: 2 } : { tx: c, tz: a, w: 2, h: len }),
      dir,
      ...(power ? { power } : {}),
    });
    return true;
  }
  return false;
}

function placePylon(f: Fill): boolean {
  const { rng, space, room } = f;
  for (let i = 0; i < 30; i++) {
    const c = space.spot(rng, 1.2, 3, { tries: 10 });
    if (!c) return false;
    // Pylons light 5 m: keep them apart so their circles don't double up.
    if ((room.pylons ?? []).some(([x, z]) => Math.hypot(x - c.x, z - c.z) < 6)) continue;
    space.take(c);
    (room.pylons ??= []).push([c.x, c.z]);
    return true;
  }
  return false;
}

/** The region's hazards in a room, `scale` x the usual amount (hazardMult, bleed share). */
function addHazards(f: Fill, biome: RiftBiome, scale: number): void {
  const { rng, room } = f;
  const area = room.w * room.h;
  const pts = (area / 100) * RIFT_GEN.hazardPer100 * scale * rng.range(0.85, 1.15);
  switch (biome) {
    case 'forest':
      room.trees = Math.max(room.trees ?? 0, Math.min(16, Math.max(2, Math.round((area / RIFT_GEN.treeArea) * scale))));
      return;
    case 'caves':
      if (rng.chance(0.5)) {
        // Volcanic: vents on staggered rhythms.
        for (let i = Math.max(1, count(rng, pts)); i > 0; i--) placeVent(f);
      } else {
        // Marsh: poison pools, maybe a vent.
        for (let i = Math.max(1, count(rng, pts * 0.6)); i > 0; i--) placePool(f, 'marsh');
        for (let i = count(rng, pts * 0.35); i > 0; i--) placeVent(f);
      }
      return;
    case 'mines': {
      // Two in three rooms wire their crushers and fences to a power switch by a wall.
      let power: string | undefined;
      let at: Blob | null = null;
      if (rng.chance(0.7)) {
        at = f.space.spot(rng, 0.8, RIFT_GEN.wallMargin, { maxWall: 2.5, mouthExtra: 0.5 });
        if (at) {
          f.space.take(at);
          power = `P${f.circuits.n + 1}`;
        }
      }
      let crushers = 0;
      let lasers = 0;
      if (rng.chance(0.5)) {
        // Foundry: slag pools and crushers, maybe a belt.
        for (let i = Math.max(1, count(rng, pts * 0.45)); i > 0; i--) placePool(f, 'slag');
        for (let i = Math.max(1, count(rng, pts * 0.55)); i > 0; i--) crushers += placeCrusher(f, power) ? 1 : 0;
        if (rng.chance(Math.min(0.9, 0.35 * scale))) placeConveyor(f);
      } else {
        // Control: laser fences, a crusher or two, maybe a belt.
        for (let i = Math.max(1, count(rng, pts * 0.4)); i > 0; i--) lasers += placeLaser(f, power) ? 1 : 0;
        for (let i = count(rng, pts * 0.4); i > 0; i--) crushers += placeCrusher(f, power) ? 1 : 0;
        if (rng.chance(Math.min(0.9, 0.3 * scale))) placeConveyor(f);
      }
      if (power && at) {
        if (crushers + lasers > 0) {
          f.circuits.n++;
          const label = lasers && crushers ? 'Machinery power' : lasers ? 'Laser power' : 'Crusher power';
          (room.features ??= []).push({ kind: 'power', tx: at.x, tz: at.z, lock: power, label });
        } else {
          f.space.blobs.splice(f.space.blobs.indexOf(at), 1);
        }
      }
      return;
    }
    case 'ruins': {
      const n = Math.min(4, Math.max(1, Math.round((area >= 220 ? 2 : 1) * scale)));
      for (let i = 0; i < n; i++) placePylon(f);
      return;
    }
  }
}

// ------------------------------------------------------------------- waves

/** Fill a budget from a roster (respecting per-wave and per-room caps). */
function fillBudget(rng: Rng, roster: RosterEntry[], budget: number, wave: EnemyId[], room: Map<EnemyId, number>, maxSize: number): void {
  let left = budget;
  while (wave.length < maxSize) {
    const brute = wave.some((e) => threatOf(e) >= 3);
    const ok = roster.filter((r) => {
      const t = threatOf(r.e);
      if (t > left + 0.3) return false;
      if (t >= 3 && brute) return false;
      if (r.max !== undefined && wave.filter((e) => e === r.e).length >= r.max) return false;
      if (r.perRoom !== undefined && (room.get(r.e) ?? 0) >= r.perRoom) return false;
      return true;
    });
    if (!ok.length) break;
    let roll = rng.f() * ok.reduce((s, r) => s + r.w, 0);
    let pick = ok[ok.length - 1];
    for (const r of ok) {
      roll -= r.w;
      if (roll < 0) {
        pick = r;
        break;
      }
    }
    wave.push(pick.e);
    room.set(pick.e, (room.get(pick.e) ?? 0) + 1);
    left -= threatOf(pick.e);
  }
}

function waveBudget(rng: Rng, area: number): number {
  const W = RIFT_GEN.wave;
  const t = Math.min(1, Math.max(0, (area - W.areaLo) / (W.areaHi - W.areaLo)));
  return W.min + (W.max - W.min) * t + (rng.f() - 0.5) * W.jitter;
}

function addWaves(f: Fill, role: Role, o: RiftGenOptions): void {
  const { rng, room, space } = f;
  const G = RIFT_GEN;
  const area = room.w * room.h;
  const nWaves = role === 'guardian' ? 3 : role === 'bonus' ? 1 : role === 'fight' && area >= G.bigArea ? 3 : 2;
  const budgets = Array.from({ length: nWaves }, () =>
    role === 'guardian' ? G.wave.guardian + (rng.f() - 0.5) * 0.8 : waveBudget(rng, area) * (role === 'switch' ? 0.9 : 1),
  );
  const pinned: SpawnDef[][] = budgets.map(() => []);
  // Each wave's region: the rift's own, or (mixAll) a random one per wave.
  const region: RiftBiome[] = budgets.map(() => (o.mixAll ? RIFT_BIOMES[rng.int(0, RIFT_BIOMES.length - 1)] : o.biome));

  // Mines: a control node rooted in a far corner, its gunbots in the same (first) wave.
  let node = false;
  if (region[0] === 'mines' && rng.chance(role === 'guardian' ? 0.7 : area >= 220 ? 0.5 : 0.3)) {
    const at = space.spot(rng, 1.2, 1.8, { maxWall: 3, mouthExtra: 4 });
    if (at) {
      space.take(at);
      pinned[0].push({ e: 'ControlNode', tx: at.x, tz: at.z }, 'Gillchic', 'Gillchic', 'Gillchic');
      node = true;
    }
  }
  // Caves: Poison Lilies rooted round the edges, spread over the Caves waves.
  const caveWaves = region.map((r, i) => (r === 'caves' ? i : -1)).filter((i) => i >= 0);
  if (caveWaves.length) {
    const lilies = o.mixAll
      ? caveWaves.length + (rng.chance(0.5) ? 1 : 0)
      : (role === 'guardian' ? 3 : 1) + (rng.chance(0.5) ? 1 : 0) + (area >= 260 ? 1 : 0);
    for (let i = 0; i < lilies; i++) {
      const at = space.spot(rng, 1.4, 2, { maxWall: 4, mouthExtra: 2 });
      if (!at) continue;
      space.take(at);
      pinned[caveWaves[rng.int(0, caveWaves.length - 1)]].push({ e: 'PoisonLily', tx: at.x, tz: at.z });
    }
  }

  const mix = o.mixBiome && o.mixBiome !== o.biome ? RIFT_ROSTERS[o.mixBiome] : null;
  const perRoom = new Map<EnemyId, number>();
  room.waves = budgets.map((b, i) => {
    const fixed = pinned[i];
    let left = b - fixed.reduce((s, e) => s + threatOf(spawnId(e)), 0);
    const free: EnemyId[] = [];
    const maxSize = G.wave.maxSize - fixed.length;
    if (mix) {
      const share = b * G.mixShare;
      fillBudget(rng, mix, share, free, perRoom, maxSize);
      left -= free.reduce((s, e) => s + threatOf(e), 0);
    }
    fillBudget(rng, RIFT_ROSTERS[region[i]], left, free, perRoom, maxSize);
    const wave: SpawnDef[] = [...free, ...fixed];
    if (!wave.length) wave.push(RIFT_ROSTERS[region[i]][0].e);
    return wave;
  });

  if (role === 'guardian') {
    room.overlap = true;
    room.ambush = [rng.int(1, 2)];
    return;
  }
  if (nWaves >= 2) {
    if (rng.chance(G.overlapChance)) room.overlap = true;
    if (rng.chance(G.ambushChance)) room.ambush = [rng.int(1, nWaves - 1)];
  } else if (!node && rng.chance(G.ambushChance)) {
    room.ambush = [0];
  }
}

// -------------------------------------------------------------------- main

function fillRoom(node: Node, room: RoomDef, mouths: { tx: number; tz: number }[], o: RiftGenOptions, rng: Rng, circuits: { n: number }): void {
  const f: Fill = { room, space: new Space(room.w, room.h, mouths), rng, circuits };
  const G = RIFT_GEN;
  const mult = o.hazardMult ?? 1;
  const area = room.w * room.h;
  const need = (b: Blob | null): Blob => {
    if (!b) throw new Retry();
    return b;
  };

  switch (node.role) {
    case 'start': {
      room.boxes = 2;
      if (o.biome === 'forest') room.trees = 3;
      // The teleporter in the corner furthest from the way out, the start point in the middle.
      const corners = [[2.5, 2.5], [room.w - 2.5, 2.5], [2.5, room.h - 2.5], [room.w - 2.5, room.h - 2.5]];
      const far = (c: number[]) => Math.min(...mouths.map((m) => Math.hypot(m.tx - c[0], m.tz - c[1])));
      const [tx, tz] = corners.reduce((a, b) => (far(b) > far(a) ? b : a));
      addFeature(f, { kind: 'toCity', tx, tz, label: 'Teleporter to Pioneer 2' }, { x: tx, z: tz, r: 0.6 });
      addFeature(f, { kind: 'start', tx: room.w / 2, tz: room.h / 2 }, { x: room.w / 2, z: room.h / 2, r: 0.6 });
      return;
    }
    case 'boss': {
      room.boxes = 2;
      const at = { x: room.w / 2, z: room.h / 2, r: 0.6 };
      if (!f.space.free(at, G.wallMargin)) throw new Retry();
      addFeature(f, { kind: 'toBoss', tx: at.x, tz: at.z, to: 'riftBoss', label: 'Teleporter to the Rift Core' }, at);
      return;
    }
    default:
      break;
  }

  // Fight rooms: features first (they must fit), then pinned enemies, then hazards around them.
  room.boxes = node.role === 'bonus' ? 4 : area >= 250 || node.role === 'guardian' ? 3 : rng.int(2, 3);
  if (node.role === 'guardian') room.guardian = true;
  if (node.role === 'switch') {
    const at = need(f.space.spot(rng, 0.8, G.wallMargin, { maxWall: 2.5, mouthExtra: 1 }) ?? f.space.spot(rng, 0.6, G.wallMargin));
    addFeature(f, { kind: 'switch', tx: at.x, tz: at.z, lock: 'L1', label: 'Gate switch' }, at);
  }
  if (node.role === 'guardian' && !o.boss) {
    const at = need(f.space.spot(rng, 0.8, G.wallMargin, { maxWall: 2.5, mouthExtra: 1 }) ?? f.space.spot(rng, 0.6, G.wallMargin));
    addFeature(f, { kind: 'toCity', tx: at.x, tz: at.z, label: 'Teleporter to Pioneer 2' }, at);
  }
  // Waves claim their pinned spots before the hazards go down.
  addWaves(f, node.role, o);
  addHazards(f, o.biome, mult);
  if (o.hazardBiome && o.hazardBiome !== o.biome && rng.chance(G.bleedChance)) addHazards(f, o.hazardBiome, mult * G.bleedScale);
}

/** Generate a rift's rooms and links (see the header comment). Same options → same output. */
export function generateRift(o: RiftGenOptions): { rooms: RoomDef[]; links: LinkDef[] } {
  for (let attempt = 0; attempt < 200; attempt++) {
    const rng = new Rng(hashString(attempt === 0 ? `rift:${o.biome}:${o.seed}` : `rift:${o.biome}:${o.seed}:${attempt}`));
    try {
      const lay = layout(rng, o.boss);
      const minX = Math.min(...lay.nodes.map((n) => n.rect.x));
      const minZ = Math.min(...lay.nodes.map((n) => n.rect.z));
      const rooms: RoomDef[] = lay.nodes.map((n) => ({ id: n.id, x: n.rect.x - minX, z: n.rect.z - minZ, w: n.rect.w, h: n.rect.h }));
      const mouths = roomMouths(rooms, lay.links);
      const circuits = { n: 0 };
      lay.nodes.forEach((n, i) => fillRoom(n, rooms[i], mouths.get(n.id)!, o, rng, circuits));
      return { rooms, links: lay.links };
    } catch (e) {
      if (!(e instanceof Retry)) throw e;
    }
  }
  throw new Error(`generateRift: no layout for seed ${o.seed}`);
}
