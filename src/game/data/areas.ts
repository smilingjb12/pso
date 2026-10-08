import type { EnemyId } from '../config';
import { RUINS_AFFIXES, type Affix } from './affixes';

// Areas are authored as rectangular rooms (in 2m tiles) joined by straight
// corridors. The level builder carves corridors through the overlap of two
// rooms and puts laser-fence gates at each end.

export type AreaId = 'city' | 'forest1' | 'dragon' | 'cave1' | 'cave2' | 'derolle' | 'mine1' | 'mine2' | 'warden' | 'ruin1' | 'ruin2' | 'falz';

export type FeatureKind =
  | 'start' | 'switch' | 'toBoss' | 'toNext' | 'toCity'
  | 'shopWeapon' | 'shopArmor' | 'shopItem' | 'medical' | 'stylist' | 'cityTeleporter'
  /** A Telepipe portal (placed at runtime, never in area data). */
  | 'portal'
  /** Mines: a power switch (toggles the machinery wired to it). */
  | 'power'
  /** Ruins: a light pylon (placed from the room's `pylons`, never as a feature). */
  | 'pylon';

/** Features with an NPC behind a counter (talk, solid). */
export const isCounter = (k: FeatureKind) => k.startsWith('shop') || k === 'medical' || k === 'stylist';

export interface FeatureDef {
  kind: FeatureKind;
  /** Tile position relative to the room's top-left corner. */
  tx: number;
  tz: number;
  /** For switches: the lock they open. For power switches: the circuit they toggle. */
  lock?: string;
  /** For teleporters (toBoss / toNext): the destination area. */
  to?: AreaId;
  label?: string;
}

/** A wave entry: an enemy at a random spot, or pinned to a tile (rooted Lilies behind hazards). */
export type SpawnDef = EnemyId | { e: EnemyId; tx: number; tz: number };

export interface RoomDef {
  id: string;
  x: number;
  z: number;
  w: number;
  h: number;
  waves?: SpawnDef[][];
  /** Waves (by index) that drop in behind the player instead of around the room. */
  ambush?: number[];
  /** The next wave starts once a third (or less) of the current one is left. */
  overlap?: boolean;
  /** Lava vents: tile position and a phase offset (seconds). */
  vents?: [number, number, number?][];
  /** Poison marsh pools: tile centre and radii in tiles. */
  marsh?: [number, number, number, number][];
  /** Mines slag pools (same layout as marsh): they slow and keep adding Burn. */
  slag?: [number, number, number, number][];
  /** Mines machinery (room tiles). `power` wires it to the power switch with that circuit id. */
  crushers?: { tx: number; tz: number; phase?: number; power?: string }[];
  /** Laser fences between two posts; they cycle on and off. */
  lasers?: { ax: number; az: number; bx: number; bz: number; phase?: number; power?: string }[];
  /** Conveyor belts: a rectangle that carries whoever stands on it (dir: the way it runs). */
  conveyors?: { tx: number; tz: number; w: number; h: number; dir: 'n' | 's' | 'e' | 'w'; power?: string }[];
  /** Ruins light pylons (room tiles): the interact key lights one (see config pylonCfg). */
  pylons?: [number, number][];
  trees?: number;
  boxes?: number;
  features?: FeatureDef[];
}

export interface LinkDef {
  a: string;
  b: string;
  /** Gate stays shut until a switch with this lock is pressed. */
  lock?: string;
}

export interface AreaTheme {
  floor: number;
  floorAlt: number;
  wall: number;
  wallHeight: number;
  sky: number;
  fogNear: number;
  fogFar: number;
  trees: boolean;
  /** Set dressing beyond the defaults (forest = trees, boss = Dragon's lair). */
  scenery?: 'volcanic' | 'marsh' | 'river' | 'foundry' | 'control' | 'warden' | 'temple' | 'sanctum' | 'altar';
  /** Ambient/sun override; defaults to neutral daylight. */
  light?: AreaLight;
  // ---- Look extras (data/looks.ts fills these for the Caves and Mines; others keep the flat sky). ----
  /** A sky dome instead of the flat `sky` colour. */
  skybox?: SkyDef;
  /** Fog colour (defaults to `sky`): distance fades into haze, not black. */
  fogColor?: number;
  /** Bloom on bright and emissive things (no post-processing without it). */
  bloom?: { strength: number; radius: number; threshold: number };
  /** Sky reflections on materials (0 = none). */
  envIntensity?: number;
  /** 0 matte rock .. 1 polished deck plates. */
  floorGloss?: number;
  /** Glow colours: strips, crystals, signs, moss. */
  accent?: number;
  accent2?: number;
  accent3?: number;
  /** Lava cracks / molten metal. */
  lava?: number;
  /** Marsh pools (poison water). */
  pool?: number;
  /** Floating motes (sparks, spores, dust). */
  motes?: number;
}

export interface SkyDef {
  top: number;
  horizon: number;
  bottom: number;
  /** Star density 0..1. */
  stars?: number;
  nebulae?: { color: number; dir: [number, number, number]; size: number; opacity?: number }[];
  aurora?: { color: number; color2: number; strength?: number; yaw?: number };
  /** `glowOpacity`: the halo's strength (an eclipse: a near-black body with a bright corona). */
  planet?: { color: number; color2?: number; ring?: number; glow?: number; glowOpacity?: number; dir: [number, number, number]; size: number; light?: [number, number, number] };
}

export interface AreaLight {
  hemiSky: number;
  hemiGround: number;
  hemi: number;
  sunColor: number;
  sun: number;
}

export const DEFAULT_LIGHT: AreaLight = { hemiSky: 0xcfe4ff, hemiGround: 0x2a3a20, hemi: 1.1, sunColor: 0xffffff, sun: 1.6 };

export type BossId = 'dragon' | 'derolle' | 'warden' | 'falz';

export interface AreaDef {
  id: AreaId;
  name: string;
  kind: 'city' | 'field' | 'boss';
  /** Boss areas: who lives here. */
  boss?: BossId;
  /** Field areas: elite and rare (Nar Lily) spawns can appear. */
  elites?: boolean;
  /** Elites roll an affix from `affixPool` (Mines: Overclocked / Volatile) instead of plain elite stats. */
  affixes?: boolean;
  /** Normal elites' affix pool where `affixes` is set (defaults to the Mines pair). */
  affixPool?: Affix[];
  /** Facing on arrival at the start point (radians, 0 = +Z). */
  startYaw?: number;
  theme: AreaTheme;
  rooms: RoomDef[];
  links: LinkDef[];
}

// ------------------------------------------------------------- expeditions

export type ExpeditionId = 'forest' | 'caves' | 'mines' | 'ruins';

export interface ExpeditionDef {
  id: ExpeditionId;
  name: string;
  /**
   * Floors in order, the boss arena last. They are the checkpoints: the furthest floor reached is where the
   * city teleporter takes you back to (its start), until the boss falls or you log out.
   */
  floors: AreaId[];
  /** Unlocked by killing this boss on this character. */
  needs?: 'dragon' | 'derolle' | 'warden';
}

export const expeditions: Record<ExpeditionId, ExpeditionDef> = {
  forest: { id: 'forest', name: 'Forest', floors: ['forest1', 'dragon'] },
  caves: { id: 'caves', name: 'Caves', floors: ['cave1', 'cave2', 'derolle'], needs: 'dragon' },
  mines: { id: 'mines', name: 'Mines', floors: ['mine1', 'mine2', 'warden'], needs: 'derolle' },
  ruins: { id: 'ruins', name: 'Ruins', floors: ['ruin1', 'ruin2', 'falz'], needs: 'warden' },
};

/** Which expedition an area belongs to (null for the city). */
export function expeditionOf(area: AreaId): ExpeditionId | null {
  if (area === 'forest1' || area === 'dragon') return 'forest';
  if (area === 'cave1' || area === 'cave2' || area === 'derolle') return 'caves';
  if (area === 'mine1' || area === 'mine2' || area === 'warden') return 'mines';
  if (area === 'ruin1' || area === 'ruin2' || area === 'falz') return 'ruins';
  return null;
}

const B: EnemyId = 'Booma';
const Go: EnemyId = 'Gobooma';
const Gi: EnemyId = 'Gigobooma';
const CB: EnemyId = 'CaveBooma';
const CGo: EnemyId = 'CaveGobooma';
const CGi: EnemyId = 'CaveGigobooma';
const PA: EnemyId = 'PanArms';
/** A Poison Lily rooted at a tile of the room. */
const L = (tx: number, tz: number): SpawnDef => ({ e: 'PoisonLily', tx, tz });
const Gc: EnemyId = 'Gillchic';
const Gz: EnemyId = 'Garanz';
const Sn: EnemyId = 'Sinow';
/** A control node at a tile of the room: gunbots in its room reboot until it is destroyed. */
const N = (tx: number, tz: number): SpawnDef => ({ e: 'ControlNode', tx, tz });
const D: EnemyId = 'Dimenian';
const LD: EnemyId = 'LaDimenian';
const SD: EnemyId = 'SoDimenian';
const Ds: EnemyId = 'Delsaber';
const Cs: EnemyId = 'ChaosSorcerer';
const Br: EnemyId = 'DarkBelra';
const Cb: EnemyId = 'ChaosBringer';

export const areas: Record<AreaId, AreaDef> = {
  city: {
    id: 'city',
    name: 'Pioneer 2',
    kind: 'city',
    theme: {
      floor: 0x6d7690, floorAlt: 0x646d86, wall: 0x9aa4c0, wallHeight: 5,
      sky: 0x1a2236, fogNear: 40, fogFar: 90, trees: false,
    },
    rooms: [
      {
        id: 'plaza', x: 0, z: 0, w: 22, h: 16,
        features: [
          { kind: 'start', tx: 11, tz: 9 },
          { kind: 'shopWeapon', tx: 4, tz: 1.2, label: 'Weapon Shop' },
          { kind: 'shopArmor', tx: 9, tz: 1.2, label: 'Armor Shop' },
          { kind: 'shopItem', tx: 14, tz: 1.2, label: 'Item Shop' },
          { kind: 'medical', tx: 20.8, tz: 6, label: 'Medical Center' },
          { kind: 'stylist', tx: 1.2, tz: 6, label: 'Stylist' },
          { kind: 'cityTeleporter', tx: 11, tz: 13, label: 'Teleporter' },
        ],
      },
    ],
    links: [],
  },

  forest1: {
    id: 'forest1',
    name: 'Forest 1',
    kind: 'field',
    theme: {
      floor: 0x5a8a46, floorAlt: 0x54833f, wall: 0x2f4a26, wallHeight: 4,
      sky: 0x86b4dc, fogNear: 35, fogFar: 95, trees: true,
    },
    rooms: [
      { id: 'r0', x: 0, z: 0, w: 10, h: 10, trees: 3,
        features: [{ kind: 'start', tx: 5, tz: 3 }, { kind: 'toCity', tx: 2, tz: 2, label: 'Teleporter to Pioneer 2' }] },
      { id: 'r1', x: 0, z: 16, w: 14, h: 12, trees: 4, boxes: 2, waves: [[B, B, B]] },
      { id: 'r2', x: 20, z: 14, w: 18, h: 18, trees: 6, boxes: 3, waves: [[B, B, B], [B, B, Go]] },
      { id: 'r3', x: 20, z: 38, w: 14, h: 12, trees: 4, boxes: 2, waves: [[B, B, Go], [Go, Go]],
        features: [{ kind: 'switch', tx: 7, tz: 9, lock: 'L1', label: 'Gate switch' }] },
      { id: 'r4', x: 44, z: 18, w: 10, h: 10, trees: 2, boxes: 4 },
      { id: 'r5', x: 44, z: 34, w: 16, h: 14, trees: 5, boxes: 2, waves: [[B, B, B, B], [Go, Go, B, B]] },
      { id: 'r6', x: 64, z: 34, w: 14, h: 14, trees: 4, boxes: 2, waves: [[Gi], [Go, Go, B, B]] },
      { id: 'r7', x: 62, z: 6, w: 22, h: 22, trees: 9, boxes: 3, waves: [[B, B, B, Go], [Go, Go, Gi], [Gi, Gi, B, B]] },
      { id: 'r8', x: 88, z: 12, w: 8, h: 10, trees: 0, boxes: 2,
        features: [{ kind: 'toBoss', tx: 4, tz: 5, to: 'dragon', label: "Teleporter to the Dragon's lair" }] },
    ],
    links: [
      { a: 'r0', b: 'r1' },
      { a: 'r1', b: 'r2' },
      { a: 'r2', b: 'r3' },
      { a: 'r2', b: 'r4', lock: 'L1' },
      { a: 'r4', b: 'r5' },
      { a: 'r5', b: 'r6' },
      { a: 'r6', b: 'r7' },
      { a: 'r7', b: 'r8' },
    ],
  },

  dragon: {
    id: 'dragon',
    name: "Dragon's Lair",
    kind: 'boss',
    boss: 'dragon',
    theme: {
      floor: 0x4c4238, floorAlt: 0x3a322b, wall: 0x2e2822, wallHeight: 6,
      sky: 0x2c1610, fogNear: 30, fogFar: 85, trees: false,
      // Smoky, ember-lit: warm dim ambient and a low reddish sun.
      light: { hemiSky: 0xffb08a, hemiGround: 0x3a1a10, hemi: 0.85, sunColor: 0xffc49a, sun: 1.25 },
    },
    rooms: [
      { id: 'arena', x: 0, z: 0, w: 24, h: 24, features: [{ kind: 'start', tx: 12, tz: 21 }] },
    ],
    links: [],
  },

  // Cave 1: volcanic. Lava vents erupt on a rhythm; Lilies hold the back of mixed waves.
  cave1: {
    id: 'cave1',
    name: 'Cave 1',
    kind: 'field',
    elites: true,
    theme: {
      floor: 0x4a3a33, floorAlt: 0x42332d, wall: 0x2c2220, wallHeight: 5,
      sky: 0x140a08, fogNear: 22, fogFar: 72, trees: false, scenery: 'volcanic',
      light: { hemiSky: 0xffa078, hemiGround: 0x2a1008, hemi: 0.8, sunColor: 0xffb88a, sun: 1.05 },
    },
    rooms: [
      { id: 'c0', x: 0, z: 0, w: 10, h: 10, boxes: 2,
        features: [{ kind: 'start', tx: 5, tz: 3 }, { kind: 'toCity', tx: 2, tz: 2, label: 'Teleporter to Pioneer 2' }] },
      { id: 'c1', x: 0, z: 16, w: 14, h: 12, boxes: 2, vents: [[10, 4]],
        waves: [[CB, CB, CB], [CB, CB, L(11, 9)]] },
      { id: 'c2', x: 20, z: 14, w: 16, h: 16, boxes: 3, vents: [[5, 8, 0], [11, 8, 3.2]],
        waves: [[CB, CB, CGo], [L(4, 13), L(12, 13), CB, CB]] },
      { id: 'c3', x: 20, z: 36, w: 14, h: 12, boxes: 2, vents: [[3, 6]], overlap: true,
        waves: [[CGo, CGo, L(7, 9)], [CB, CB, CB, CGo]],
        features: [{ kind: 'switch', tx: 11, tz: 10, lock: 'L1', label: 'Gate switch' }] },
      { id: 'c4', x: 42, z: 14, w: 12, h: 12, boxes: 2, vents: [[3, 3], [8, 3, 3.2]],
        waves: [[PA], [CB, CB, L(9, 9)]] },
      { id: 'c5', x: 42, z: 32, w: 18, h: 16, boxes: 3, vents: [[6, 5], [12, 10, 2.1], [9, 3, 4.3]], ambush: [1],
        waves: [[CGo, CGo, CB, L(14, 12)], [PA, CB, CB], [CGi, L(3, 12), L(14, 3)]] },
      { id: 'c6', x: 66, z: 36, w: 8, h: 10, boxes: 2,
        features: [{ kind: 'toNext', tx: 4, tz: 5, to: 'cave2', label: 'Teleporter to Cave 2' }] },
    ],
    links: [
      { a: 'c0', b: 'c1' },
      { a: 'c1', b: 'c2' },
      { a: 'c2', b: 'c3' },
      { a: 'c2', b: 'c4', lock: 'L1' },
      { a: 'c4', b: 'c5' },
      { a: 'c5', b: 'c6' },
    ],
  },

  // Cave 2: flooded marsh. Poison pools, Lilies behind them, ambushes and overlapping waves.
  cave2: {
    id: 'cave2',
    name: 'Cave 2',
    kind: 'field',
    elites: true,
    startYaw: Math.PI / 2,
    theme: {
      floor: 0x3a4842, floorAlt: 0x33413b, wall: 0x22302c, wallHeight: 5,
      sky: 0x081212, fogNear: 20, fogFar: 66, trees: false, scenery: 'marsh',
      light: { hemiSky: 0x9adcc8, hemiGround: 0x10201a, hemi: 0.85, sunColor: 0xc8f0e0, sun: 0.95 },
    },
    rooms: [
      { id: 'd0', x: 0, z: 0, w: 10, h: 10, boxes: 2,
        features: [{ kind: 'start', tx: 5, tz: 7 }, { kind: 'toCity', tx: 5, tz: 3, label: 'Teleporter to Pioneer 2' }] },
      { id: 'd1', x: 16, z: 0, w: 16, h: 14, boxes: 2, marsh: [[8, 7, 3.5, 2.6]],
        waves: [[CGo, CGo, L(13, 3)], [L(13, 11), L(3, 11), CGi]] },
      { id: 'd2', x: 16, z: 20, w: 14, h: 14, boxes: 2, marsh: [[4, 10, 2.8, 2.2], [10, 4, 2.4, 2]], ambush: [1], overlap: true,
        waves: [[PA, L(11, 11)], [CGo, CGo, CB, CB]] },
      { id: 'd3', x: 36, z: 20, w: 16, h: 18, boxes: 2, vents: [[8, 9]], marsh: [[3, 14, 2.4, 2.4], [13, 4, 2.4, 2]], overlap: true,
        waves: [[CGi, CGo, L(13, 15), L(3, 4)], [PA, PA], [CGi, CGo, L(8, 15)]] },
      { id: 'd7', x: 36, z: 44, w: 12, h: 10, boxes: 3, marsh: [[6, 3, 2.5, 1.6]], ambush: [0],
        waves: [[L(2, 7), L(10, 7), CGo, CGo]],
        features: [{ kind: 'switch', tx: 6, tz: 8, lock: 'L2', label: 'Gate switch' }] },
      { id: 'd4', x: 58, z: 22, w: 12, h: 12, boxes: 2, marsh: [[6, 6, 2.6, 2.6]], ambush: [1],
        waves: [[CGo, L(10, 10), L(2, 10), CGo], [PA, CGi]] },
      { id: 'd5', x: 58, z: 40, w: 18, h: 18, boxes: 3, vents: [[5, 5], [13, 13, 3.2]], marsh: [[13, 5, 3, 2.4], [4, 13, 3, 2.4]],
        overlap: true, ambush: [2],
        waves: [[CGi, CGo, CGo, L(15, 3)], [PA, L(3, 15), L(15, 15)], [CGi, CGo, PA]] },
      { id: 'd6', x: 80, z: 44, w: 8, h: 10, boxes: 2,
        features: [{ kind: 'toBoss', tx: 4, tz: 5, to: 'derolle', label: 'Teleporter to the underground river' }] },
    ],
    links: [
      { a: 'd0', b: 'd1' },
      { a: 'd1', b: 'd2' },
      { a: 'd2', b: 'd3' },
      { a: 'd3', b: 'd7' },
      { a: 'd3', b: 'd4', lock: 'L2' },
      { a: 'd4', b: 'd5' },
      { a: 'd5', b: 'd6' },
    ],
  },

  // De Rol Le: a long raft drifting down an underground river.
  derolle: {
    id: 'derolle',
    name: 'Underground River',
    kind: 'boss',
    boss: 'derolle',
    theme: {
      floor: 0x6c727a, floorAlt: 0x646a72, wall: 0x1a2a30, wallHeight: 1,
      sky: 0x061014, fogNear: 26, fogFar: 88, trees: false, scenery: 'river',
      light: { hemiSky: 0x9ac8ff, hemiGround: 0x0a1a20, hemi: 0.85, sunColor: 0xbfe0ff, sun: 1.1 },
    },
    rooms: [
      { id: 'raft', x: 0, z: 0, w: 5, h: 15, features: [{ kind: 'start', tx: 2.5, tz: 13 }] },
    ],
    links: [],
  },

  // Mine 1: the foundry. Slag pools (slow, keep adding Burn), crushers, conveyors.
  // Control nodes keep the room's gunbots rebooting until they are destroyed.
  mine1: {
    id: 'mine1',
    name: 'Mine 1',
    kind: 'field',
    elites: true,
    affixes: true,
    startYaw: Math.PI / 2,
    theme: {
      floor: 0x5c5853, floorAlt: 0x514d49, wall: 0x3a3531, wallHeight: 5,
      sky: 0x120c0a, fogNear: 24, fogFar: 78, trees: false, scenery: 'foundry',
      light: { hemiSky: 0xffc8a0, hemiGround: 0x2a1a10, hemi: 0.85, sunColor: 0xffd0a8, sun: 1.1 },
    },
    rooms: [
      { id: 'm0', x: 0, z: 0, w: 10, h: 10, boxes: 2,
        features: [{ kind: 'start', tx: 3, tz: 5 }, { kind: 'toCity', tx: 2.5, tz: 2.5, label: 'Teleporter to Pioneer 2' }] },
      // Gunbots alone, and a belt carrying you toward them.
      { id: 'm1', x: 16, z: 0, w: 14, h: 12, boxes: 2,
        conveyors: [{ tx: 1, tz: 5, w: 12, h: 2, dir: 'e' }],
        waves: [[Gc, Gc], [Gc, Gc, Gc]] },
      // First node, behind a pair of crushers. The switch stops (or restarts) them.
      { id: 'm2', x: 16, z: 18, w: 16, h: 16, boxes: 3, slag: [[3, 12, 2.2, 1.6], [11, 4, 1.8, 1.5]],
        crushers: [{ tx: 11, tz: 13.5, power: 'P1' }, { tx: 14, tz: 10.5, phase: 2.6, power: 'P1' }],
        waves: [[N(14.2, 14.2), Gc, Gc, Gc], [Gz, Gc]],
        features: [{ kind: 'power', tx: 1.5, tz: 8, lock: 'P1', label: 'Crusher power' }] },
      // Gate switch side room: Sinow pair, then a planted Garanz behind a belt.
      { id: 'm3', x: 38, z: 20, w: 12, h: 12, boxes: 2, slag: [[7, 4, 1.8, 1.4]], overlap: true,
        conveyors: [{ tx: 1, tz: 8, w: 10, h: 2, dir: 'w' }],
        waves: [[Sn, Sn], [Gc, Gc, Gz]],
        features: [{ kind: 'switch', tx: 10, tz: 10.5, lock: 'L1', label: 'Gate switch' }] },
      { id: 'm4', x: 16, z: 40, w: 14, h: 12, boxes: 2, slag: [[3, 3, 1.8, 1.5], [10, 9, 2, 1.5]], ambush: [1],
        crushers: [{ tx: 7, tz: 6, power: 'P2' }],
        waves: [[Gz, Gz], [Sn, Sn, Gc]],
        features: [{ kind: 'power', tx: 12.5, tz: 1.5, lock: 'P2', label: 'Crusher power' }] },
      // The foundry floor: a node on the far side of two belts and a crusher line.
      { id: 'm5', x: 36, z: 40, w: 20, h: 16, boxes: 3, slag: [[4, 13, 2.2, 1.6], [16, 3, 2, 1.6]], overlap: true, ambush: [2],
        conveyors: [{ tx: 4, tz: 5, w: 2, h: 7, dir: 's' }, { tx: 13, tz: 4, w: 2, h: 7, dir: 'n' }],
        crushers: [{ tx: 9.5, tz: 4, power: 'P3' }, { tx: 9.5, tz: 8, phase: 1.7, power: 'P3' }, { tx: 9.5, tz: 12, phase: 3.4, power: 'P3' }],
        waves: [[N(18.2, 14.2), Gc, Gc, Gc, Gz], [Sn, Sn, Gc, Gc], [Gz, Sn, Sn]],
        features: [{ kind: 'power', tx: 1.5, tz: 1.5, lock: 'P3', label: 'Crusher power' }] },
      { id: 'm6', x: 62, z: 44, w: 8, h: 10, boxes: 2,
        features: [{ kind: 'toNext', tx: 4, tz: 5, to: 'mine2', label: 'Teleporter to Mine 2' }] },
    ],
    links: [
      { a: 'm0', b: 'm1' },
      { a: 'm1', b: 'm2' },
      { a: 'm2', b: 'm3' },
      { a: 'm2', b: 'm4', lock: 'L1' },
      { a: 'm4', b: 'm5' },
      { a: 'm5', b: 'm6' },
    ],
  },

  // Mine 2: the control sector. Laser fences, crushers and belts, with power switches in
  // reach of the fight. Its first room has a teleporter to Pioneer 2.
  mine2: {
    id: 'mine2',
    name: 'Mine 2',
    kind: 'field',
    elites: true,
    affixes: true,
    theme: {
      floor: 0x4c5866, floorAlt: 0x45505d, wall: 0x2a323e, wallHeight: 5,
      sky: 0x060a12, fogNear: 24, fogFar: 78, trees: false, scenery: 'control',
      light: { hemiSky: 0xa8d8ff, hemiGround: 0x0c1420, hemi: 0.85, sunColor: 0xd0ecff, sun: 1.05 },
    },
    rooms: [
      { id: 'n0', x: 0, z: 0, w: 10, h: 10, boxes: 2,
        features: [{ kind: 'start', tx: 5, tz: 6 }, { kind: 'toCity', tx: 5, tz: 2.5, label: 'Teleporter to Pioneer 2' }] },
      // A laser fence across the west side; its switch is in the far corner.
      { id: 'n1', x: 0, z: 16, w: 14, h: 14, boxes: 2,
        lasers: [{ ax: 1, az: 7, bx: 5, bz: 7, power: 'T1' }],
        waves: [[Gc, Gc, Sn], [Gz, Gc, Gc]],
        features: [{ kind: 'power', tx: 1.5, tz: 12.5, lock: 'T1', label: 'Laser power' }] },
      // Node behind two laser fences; their power switch sits by the door.
      { id: 'n2', x: 20, z: 16, w: 16, h: 14, boxes: 2, ambush: [1],
        lasers: [{ ax: 10, az: 1, bx: 10, bz: 6, power: 'P1' }, { ax: 10, az: 8, bx: 10, bz: 13, phase: 2.5, power: 'P1' }],
        waves: [[N(14, 11.5), Gc, Gc, Gc], [Sn, Sn, Gc]],
        features: [{ kind: 'power', tx: 1.5, tz: 1.5, lock: 'P1', label: 'Laser power' }] },
      // Gate switch side room.
      { id: 'n3', x: 20, z: 36, w: 14, h: 12, boxes: 3, ambush: [0],
        conveyors: [{ tx: 2, tz: 5, w: 10, h: 2, dir: 'w' }],
        crushers: [{ tx: 7, tz: 9 }],
        waves: [[Gz, Sn, Sn]],
        features: [{ kind: 'switch', tx: 12, tz: 10, lock: 'L2', label: 'Gate switch' }] },
      // A laser fence across the middle; Garanz missiles can flip its switch too.
      { id: 'n4', x: 42, z: 16, w: 14, h: 14, boxes: 2, overlap: true,
        lasers: [{ ax: 4, az: 7, bx: 10, bz: 7, power: 'P2' }],
        waves: [[Gz, Gz, Gc], [Sn, Sn, Gc, Gc]],
        features: [{ kind: 'power', tx: 7, tz: 1.5, lock: 'P2', label: 'Laser power' }] },
      // The control room: everything at once.
      { id: 'n5', x: 42, z: 36, w: 20, h: 18, boxes: 3, overlap: true, ambush: [2],
        lasers: [{ ax: 6, az: 9, bx: 14, bz: 9, power: 'P3' }],
        crushers: [{ tx: 4, tz: 4, power: 'P3' }, { tx: 16, tz: 14, phase: 2.6, power: 'P3' }],
        waves: [[N(10, 15.5), Gc, Gc, Gc, Gz], [Sn, Sn, Gz], [Gc, Gc, Sn, Sn]],
        features: [{ kind: 'power', tx: 18.5, tz: 16.5, lock: 'P3', label: 'Machinery power' }] },
      { id: 'n6', x: 68, z: 40, w: 8, h: 10, boxes: 2,
        features: [{ kind: 'toBoss', tx: 4, tz: 5, to: 'warden', label: 'Teleporter to the control core' }] },
    ],
    links: [
      { a: 'n0', b: 'n1' },
      { a: 'n1', b: 'n2' },
      { a: 'n2', b: 'n3' },
      { a: 'n2', b: 'n4', lock: 'L2' },
      { a: 'n4', b: 'n5' },
      { a: 'n5', b: 'n6' },
    ],
  },

  // The Warden: a colossus built into the north end of a rectangular hall (the first
  // `warden.alcove` metres are its own). The deck in front is a grid of `warden.cell` cells.
  warden: {
    id: 'warden',
    name: 'Control Core',
    kind: 'boss',
    boss: 'warden',
    theme: {
      floor: 0x515861, floorAlt: 0x474d55, wall: 0x262a30, wallHeight: 6,
      sky: 0x08060a, fogNear: 30, fogFar: 90, trees: false, scenery: 'warden',
      light: { hemiSky: 0xd0d8ff, hemiGround: 0x180c10, hemi: 0.8, sunColor: 0xffd8c8, sun: 1.15 },
    },
    rooms: [
      { id: 'arena', x: 0, z: 0, w: 14, h: 15,
        features: [{ kind: 'start', tx: 7, tz: 13 }] },
    ],
    links: [],
  },

  // ---- Expedition 4: the Ruins (Lv 32-42). Dark enemies, Corruption and light pylons. ----
  // Ruin 1: the outer temple. Dimenian packs, Delsaber knights and the first Sorcerers.
  ruin1: {
    id: 'ruin1',
    name: 'Ruin 1',
    kind: 'field',
    elites: true,
    affixes: true,
    affixPool: RUINS_AFFIXES,
    startYaw: Math.PI / 2,
    theme: {
      floor: 0x5a5470, floorAlt: 0x524c68, wall: 0x3a3450, wallHeight: 5,
      sky: 0x0c0818, fogNear: 28, fogFar: 92, trees: false, scenery: 'temple',
      light: { hemiSky: 0xc0a8ff, hemiGround: 0x1a1028, hemi: 1.1, sunColor: 0xffe8c8, sun: 1.1 },
    },
    rooms: [
      { id: 'r0', x: 0, z: 0, w: 10, h: 10, boxes: 2,
        features: [{ kind: 'start', tx: 3, tz: 5 }, { kind: 'toCity', tx: 2.5, tz: 2.5, label: 'Teleporter to Pioneer 2' }] },
      // A Dimenian pack and the first pylon.
      { id: 'r1', x: 16, z: 0, w: 14, h: 12, boxes: 2, pylons: [[7, 6]],
        waves: [[D, D, D], [D, D, LD, LD]] },
      // Delsabers guard the hall; a Sorcerer joins the second wave.
      { id: 'r2', x: 36, z: 0, w: 16, h: 14, boxes: 3, pylons: [[4, 4], [12, 10]],
        waves: [[Ds, D, D], [Cs, D, D, LD]] },
      // Gate switch side room.
      { id: 'r3', x: 58, z: 2, w: 12, h: 12, boxes: 2, overlap: true, pylons: [[6, 6]],
        waves: [[Ds, Ds], [Cs, LD, LD]],
        features: [{ kind: 'switch', tx: 10, tz: 10.5, lock: 'L1', label: 'Gate switch' }] },
      // The first Dark Belra, then a pack drops in behind you.
      { id: 'r4', x: 36, z: 20, w: 14, h: 12, boxes: 2, ambush: [1], pylons: [[7, 6]],
        waves: [[Br, D, D], [LD, LD, SD]] },
      // The great hall: everything at once.
      { id: 'r5', x: 34, z: 38, w: 20, h: 16, boxes: 3, overlap: true, ambush: [2], pylons: [[5, 8], [15, 8]],
        waves: [[Br, Ds, D, D], [Cs, Cs, LD, LD], [SD, Ds, Br]] },
      { id: 'r6', x: 60, z: 42, w: 8, h: 10, boxes: 2,
        features: [{ kind: 'toNext', tx: 4, tz: 5, to: 'ruin2', label: 'Teleporter to Ruin 2' }] },
    ],
    links: [
      { a: 'r0', b: 'r1' },
      { a: 'r1', b: 'r2' },
      { a: 'r2', b: 'r3' },
      { a: 'r2', b: 'r4', lock: 'L1' },
      { a: 'r4', b: 'r5' },
      { a: 'r5', b: 'r6' },
    ],
  },

  // Ruin 2: the inner sanctum. Chaos Bringers, Belras and Sorcerers; its first room has a
  // teleporter to Pioneer 2.
  ruin2: {
    id: 'ruin2',
    name: 'Ruin 2',
    kind: 'field',
    elites: true,
    affixes: true,
    affixPool: RUINS_AFFIXES,
    theme: {
      floor: 0x4e4a66, floorAlt: 0x47435e, wall: 0x302a46, wallHeight: 6,
      sky: 0x080612, fogNear: 28, fogFar: 92, trees: false, scenery: 'sanctum',
      light: { hemiSky: 0xb8a0ff, hemiGround: 0x140c22, hemi: 1.05, sunColor: 0xffe0c0, sun: 1.05 },
    },
    rooms: [
      { id: 's0', x: 0, z: 0, w: 10, h: 10, boxes: 2,
        features: [{ kind: 'start', tx: 5, tz: 6 }, { kind: 'toCity', tx: 5, tz: 2.5, label: 'Teleporter to Pioneer 2' }] },
      { id: 's1', x: 0, z: 16, w: 14, h: 14, boxes: 2, pylons: [[7, 7]],
        waves: [[Ds, Ds, D], [Cs, LD, LD]] },
      // The first Chaos Bringer, alone; a Sorcerer and So Dimenians drop in behind you after it.
      { id: 's2', x: 20, z: 16, w: 16, h: 14, boxes: 2, ambush: [1], pylons: [[4, 7], [12, 7]],
        waves: [[Cb], [Cs, SD, SD]] },
      // Gate switch side room: a Belra with a La Dimenian escort.
      { id: 's3', x: 20, z: 36, w: 14, h: 12, boxes: 3, pylons: [[7, 6]],
        waves: [[Br, LD, LD], [SD, SD, Cs]],
        features: [{ kind: 'switch', tx: 12, tz: 10, lock: 'L2', label: 'Gate switch' }] },
      { id: 's4', x: 42, z: 16, w: 14, h: 14, boxes: 2, overlap: true, pylons: [[7, 7]],
        waves: [[Ds, Ds, Cs], [Br, LD, LD, SD]] },
      // The sanctum: a Bringer leads, the rest follow.
      { id: 's5', x: 42, z: 36, w: 20, h: 18, boxes: 3, overlap: true, ambush: [2], pylons: [[5, 9], [15, 9]],
        waves: [[Cb, D, D, D], [Cs, Cs, Ds, Ds], [Br, SD, SD]] },
      { id: 's6', x: 68, z: 40, w: 8, h: 10, boxes: 2,
        features: [{ kind: 'toBoss', tx: 4, tz: 5, to: 'falz', label: 'Teleporter to the altar' }] },
    ],
    links: [
      { a: 's0', b: 's1' },
      { a: 's1', b: 's2' },
      { a: 's2', b: 's3' },
      { a: 's2', b: 's4', lock: 'L2' },
      { a: 's4', b: 's5' },
      { a: 's5', b: 's6' },
    ],
  },

  // Dark Falz: a round altar over the void (darkFalz.altarRadius), four light pylons near its rim.
  falz: {
    id: 'falz',
    name: 'The Altar',
    kind: 'boss',
    boss: 'falz',
    theme: {
      floor: 0x5a5470, floorAlt: 0x524c68, wall: 0x2a2440, wallHeight: 1,
      sky: 0x06040c, fogNear: 40, fogFar: 130, trees: false, scenery: 'altar',
      light: { hemiSky: 0xd0b8ff, hemiGround: 0x140a20, hemi: 1.0, sunColor: 0xfff0d8, sun: 1.15 },
    },
    rooms: [
      { id: 'arena', x: 0, z: 0, w: 15, h: 15, pylons: [[3.6, 3.6], [11.4, 3.6], [3.6, 11.4], [11.4, 11.4]],
        features: [{ kind: 'start', tx: 7.5, tz: 13.2 }] },
    ],
    links: [],
  },
};
