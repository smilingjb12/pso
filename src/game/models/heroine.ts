import * as THREE from 'three';
import { itemDefs, type ArmorItemDef, type ArmorLine, type ClassId } from '../data/items';
import { limbGeo, mat, part, Rig } from './Rig';
import type { LegDims } from './gait';

// The player character: one anime-styled heroine used for every class.
// Built procedurally from interchangeable parts so the Character Lab can
// compare body proportions, hair, outfits, accessories and colour schemes.
// Long hair and skirt/coat panels get simple secondary motion (springs) and
// are pushed clear of the legs every frame, so they never clip when running.

// ------------------------------------------------------------ catalogues

export interface BodySpec {
  name: string;
  desc: string;
  /** Total height (m). */
  height: number;
  /** Crown-to-chin head height (m). */
  headH: number;
  /** Hip joint height as a fraction of total height (leg length). */
  legRatio: number;
  shoulderW: number;
  hipW: number;
  /** Limb thickness multiplier. */
  limb: number;
  bust: number;
}

export const BODIES: Record<string, BodySpec> = {
  P1: {
    name: 'PSO classic',
    desc: 'About 6.5 heads tall: bigger head, shorter legs, close to the Dreamcast models.',
    height: 1.66, headH: 0.255, legRatio: 0.49, shoulderW: 0.165, hipW: 0.086, limb: 1.0, bust: 1.0,
  },
  P2: {
    name: 'Anime, 7 heads',
    desc: 'Balanced anime proportions: slimmer limbs, longer legs, smaller head.',
    height: 1.68, headH: 0.235, legRatio: 0.52, shoulderW: 0.155, hipW: 0.082, limb: 0.92, bust: 1.0,
  },
  P3: {
    name: 'Illustration, 8 heads',
    desc: 'Tall and leggy like the reference art: small head, very long legs, narrow shoulders.',
    height: 1.72, headH: 0.215, legRatio: 0.55, shoulderW: 0.148, hipW: 0.08, limb: 0.86, bust: 0.95,
  },
  P4: {
    name: 'Petite',
    desc: 'Shorter (1.56 m) and slight, with a slightly larger head.',
    height: 1.56, headH: 0.232, legRatio: 0.515, shoulderW: 0.145, hipW: 0.078, limb: 0.86, bust: 0.85,
  },
};

export const HAIRS: Record<string, { name: string; desc: string }> = {
  H1: { name: 'Long & straight', desc: 'Waist-length with swept, pointed bangs and long locks over the chest.' },
  H2: { name: 'Hime cut', desc: 'Very long, straight, with blunt bangs and cheek-length side locks.' },
  H3: { name: 'High ponytail', desc: 'Long ponytail tied high at the back; side bangs frame the face.' },
  H4: { name: 'Twin tails', desc: 'Two long tails tied high at the sides.' },
  H5: { name: 'Bob (HUnewearl)', desc: 'Voluminous chin-length bob with spiky tips, like the PSO original.' },
  H6: { name: 'Layered, shoulder', desc: 'Sporty shoulder-length layers with flicked ends.' },
  H7: { name: 'Space buns', desc: 'Two buns on top with rings, long hair down the back.' },
  H8: { name: 'Side ponytail', desc: 'A long ponytail tied at the left, bangs swept to the right.' },
  H9: { name: 'Pixie & long locks', desc: 'Short cut with long locks falling in front, and a stray strand on top.' },
};

export const OUTFITS: Record<string, { name: string; desc: string }> = {
  O1: { name: 'Coat & knit', desc: 'Open long coat over a turtleneck sweater, short shorts and buckled ankle boots.' },
  O2: { name: 'Blouse & pleated skirt', desc: 'Puff-sleeve blouse with a bow, flared pleated skirt, thigh-high stockings.' },
  O3: { name: 'HUnewearl armour', desc: 'PSO hunter: leotard, tall shoulder plates, gauntlets, armour skirt, tall boots.' },
  O4: { name: 'Ranger jacket', desc: 'Bodysuit, cropped high-collar jacket, belt with pouches, coat tails, armoured boots.' },
  O5: { name: 'Force robe', desc: 'High-collar dress with a long split skirt, detached bell sleeves and a gem.' },
};

export const ACCESSORIES: Record<string, { name: string; desc: string }> = {
  A1: { name: 'None', desc: 'Nothing on the head.' },
  A2: { name: 'Hairband', desc: 'Two-tone band across the top of the head.' },
  A3: { name: 'Ribbon bow', desc: 'Large ribbon tied at the side of the head.' },
  A4: { name: 'PSO headset', desc: 'Ear units with swept-back fins and a glowing strip.' },
  A5: { name: 'Visor goggles', desc: 'Tinted visor pushed up on the forehead.' },
  A6: { name: 'Choker & earrings', desc: 'Neck choker with a charm and drop earrings.' },
  A7: { name: 'Android ear units', desc: 'Angular ear covers with long swept-back fins and glow rings.' },
  A8: { name: 'HUD scouter', desc: 'Ear unit with a glowing holo lens over the left eye.' },
  A9: { name: 'Tech hair clips', desc: 'Glowing geometric clips in the hair and small ear fins.' },
};

export const GLOWS: Record<string, { name: string; desc: string }> = {
  G0: { name: 'No glow', desc: 'Plain fabric and trim.' },
  G1: { name: 'Glow trim', desc: 'Glowing lines along edges, hems, cuffs, collar and boots.' },
  G2: { name: 'Circuitry', desc: 'Glow trim plus circuit-like panel lines on the clothes.' },
};

export const ARMORS: Record<string, { name: string; desc: string }> = {
  R0: { name: 'No armour', desc: 'Clothes only.' },
  R1: { name: 'Light', desc: 'Layered shoulder guards and forearm bracers.' },
  R2: { name: 'Medium', desc: 'Light, plus a chest plate with a core and front hip plates.' },
  R3: { name: 'Heavy', desc: 'Medium, plus knee guards, shin plates and heel thrusters.' },
};

export const BACKS: Record<string, { name: string; desc: string }> = {
  B0: { name: 'None', desc: 'Nothing on the back.' },
  B1: { name: 'Shoulder pods', desc: 'Compact units behind the shoulders with up-swept fins and vents.' },
  B2: { name: 'Hover bits', desc: 'Four small drones floating behind her.' },
  B3: { name: 'Halo ring', desc: 'A slowly turning ring of light behind her head.' },
  B4: { name: 'Wing thrusters', desc: 'Shoulder pods with angled thruster blades.' },
  B5: { name: 'Light wings', desc: 'Translucent wings of light that beat slowly.' },
  B6: { name: 'Fin funnels', desc: 'Six blades floating in two V formations behind her.' },
  B7: { name: 'Gear halo', desc: 'Mechanical toothed ring with a glowing inner ring, turning against each other.' },
  B8: { name: 'Thrusters + halo', desc: 'Wing thrusters and the halo ring together.' },
};

export const FACES: Record<string, { name: string; desc: string }> = {
  F0: { name: 'None', desc: 'Bare face.' },
  F1: { name: 'Blindfold', desc: 'Dark band over the eyes with a glowing seam; the knot tails flutter.' },
  F2: { name: 'Holo visor', desc: 'Wraparound translucent glowing visor.' },
  F3: { name: 'Slit visor', desc: 'Opaque wraparound visor with a single glowing slit.' },
  F4: { name: 'Half mask', desc: 'Armoured mask over nose and mouth with glowing vents.' },
  F5: { name: 'Glow markings', desc: 'Glowing strokes under the eyes.' },
  F6: { name: 'Lens goggles', desc: 'Round glowing lenses over the eyes on a strap.' },
};

/** Optional colour overrides on top of the palette. */
export type LookColors = Partial<Pick<Palette, 'hair' | 'main' | 'second' | 'accent'>>;

export interface Palette {
  name: string;
  skin: number;
  hair: number;
  eyes: number;
  /** Dominant garment colour. */
  main: number;
  /** Secondary garment colour. */
  second: number;
  /** Small details: buttons, ribbons, stripes. */
  accent: number;
  legwear: number;
  shoes: number;
  metal: number;
  /** Armour plates. */
  plate: number;
}

export const PALETTES: Record<string, Palette> = {
  C1: { name: 'Rose & charcoal', skin: 0xf0c8b6, hair: 0xe88c78, eyes: 0xc8303c, main: 0x3c4150, second: 0xe6e1d8, accent: 0x3cb4c4, legwear: 0x34343e, shoes: 0x1a1a20, metal: 0xe0b848, plate: 0xb4bcca },
  C2: { name: 'Midnight & azure', skin: 0xf2cfbf, hair: 0x1e2846, eyes: 0x3c9ee6, main: 0x26386a, second: 0xf4f6fa, accent: 0x4ab8ee, legwear: 0x24242e, shoes: 0x1e2840, metal: 0xc8d4e8, plate: 0xdfe6f0 },
  C3: { name: 'PSO crimson', skin: 0xefcab6, hair: 0xc8343a, eyes: 0x8a1a22, main: 0xf0f0f4, second: 0x8c1a32, accent: 0x56688c, legwear: 0x18181e, shoes: 0x16161c, metal: 0xd8d8e0, plate: 0xf0f0f4 },
  C4: { name: 'Silver & violet', skin: 0xf0cdc2, hair: 0xdcdcea, eyes: 0x8a5ad8, main: 0x3a2c60, second: 0xe2def0, accent: 0xb478ff, legwear: 0x1e1828, shoes: 0x241c34, metal: 0xd8c070, plate: 0xe8e4f4 },
  C5: { name: 'Blonde & emerald', skin: 0xeec4a8, hair: 0xf2d27a, eyes: 0x2a9060, main: 0x1f6a4c, second: 0xf6f2e6, accent: 0xe8c040, legwear: 0x1c2a24, shoes: 0x2a2018, metal: 0xe8c860, plate: 0xf6f2e6 },
  C6: { name: 'Raven & scarlet', skin: 0xeec6b8, hair: 0x1a181e, eyes: 0xd83a3a, main: 0x1c1c24, second: 0xb02a3c, accent: 0xe8e8ee, legwear: 0x141418, shoes: 0x121216, metal: 0xc0c4cc, plate: 0x8a8e98 },
};

/** The colours `look` is drawn in: its palette with any per-colour overrides. */
export function lookPalette(look: Look): Palette {
  return { ...(PALETTES[look.palette] ?? PALETTES.C1), ...look.colors };
}

export interface Look {
  body: string;
  hair: string;
  outfit: string;
  accessory: string;
  palette: string;
  glow: string;
  armor: string;
  back: string;
  face: string;
  colors?: LookColors;
  /**
   * Armour evolution stage (0-4) from the equipped frame. When set, it replaces
   * `glow`, `armor` and `back` with the outfit's own evolution (see EVOLUTIONS).
   */
  evo?: number;
}

// ------------------------------------------------------------ armour evolutions

/** The outfit each class wears in a Standard frame (or none). */
export const CLASS_OUTFIT: Record<ClassId, string> = { hunter: 'O4', ranger: 'O1', force: 'O5' };
/** The outfit each armour line dresses her in: the frame decides the clothes. */
export const LINE_OUTFIT: Partial<Record<ArmorLine, string>> = { guard: 'O4', combat: 'O1', psy: 'O5' };
/** Evolution stage per frame tier (index = tier 1-9): Normal tops out at stage 3, Nightmare frames reach 4. */
export const TIER_STAGE = [0, 0, 1, 2, 2, 3, 3, 4, 4, 4];

export interface Evolution {
  name: string;
  stages: { name: string; desc: string }[];
}

/** What each outfit gains as its frame improves. Every stage keeps the previous stage's parts. */
export const EVOLUTIONS: Record<string, Evolution> = {
  O4: {
    name: 'Vanguard',
    stages: [
      { name: 'Jacket', desc: 'The plain ranger jacket.' },
      { name: 'Pauldrons', desc: 'Layered shoulder guards and forearm bracers.' },
      { name: 'Breastplate', desc: 'Chest plate with a core, hip plates, plated coat tails; glow trim lights up.' },
      { name: 'Thrusters', desc: 'Finned thruster pods behind the shoulders, knee and shin plates, heel jets; circuit lines.' },
      { name: 'Bastion', desc: 'Thruster blades fan from the pods and two hex photon shields guard her sides; the glow pulses.' },
    ],
  },
  O1: {
    name: 'Overwatch',
    stages: [
      { name: 'Coat', desc: 'The plain long coat.' },
      { name: 'Drone', desc: 'A support drone hovers at her side.' },
      { name: 'Targeting', desc: 'A second drone and a holo-reticle gauntlet; glow trim lights up.' },
      { name: 'Ordnance', desc: 'A sensor pod and a missile pod over the shoulders; circuit lines.' },
      { name: 'Funnels', desc: 'Six fin funnels float behind her in two V formations; the glow pulses.' },
    ],
  },
  O5: {
    name: 'Halo',
    stages: [
      { name: 'Robe', desc: 'The plain Force robe.' },
      { name: 'Halo', desc: 'A ring of light turns behind her head.' },
      { name: 'Armlets', desc: 'Floating rings circle her upper arms; glow trim lights up.' },
      { name: 'Orbit', desc: 'A ring of light with three crystals orbits her hips; the halo gains rune plates; circuit lines.' },
      { name: 'Seraph', desc: 'Wings of light and a mandala halo; the glow pulses.' },
    ],
  },
};

/** Outfit and evolution stage for a class wearing `frame` (its own outfit at stage 0 without one). */
export function armorLook(cls: ClassId, frame?: ArmorItemDef | null): { outfit: string; evo: number } {
  if (!frame) return { outfit: CLASS_OUTFIT[cls], evo: 0 };
  return { outfit: LINE_OUTFIT[frame.line] ?? CLASS_OUTFIT[cls], evo: TIER_STAGE[clamp(Math.round(frame.tier), 1, 9)] };
}

const COAT: Look = { body: 'P3', hair: 'H1', outfit: 'O1', accessory: 'A2', palette: 'C1', glow: 'G0', armor: 'R0', back: 'B0', face: 'F0' };
const ROBE: Look = { body: 'P2', hair: 'H4', outfit: 'O5', accessory: 'A6', palette: 'C4', glow: 'G0', armor: 'R0', back: 'B0', face: 'F0' };

/** Curated combinations for the Character Lab: the two chosen looks at three levels of tech. */
export const LOOKS: Record<string, { name: string; look: Look }> = {
  L1: { name: 'Rose coat', look: COAT },
  L2: { name: 'Rose coat · tech', look: { ...COAT, glow: 'G1', armor: 'R1', accessory: 'A7', back: 'B1' } },
  L3: { name: 'Rose coat · armoured', look: { ...COAT, glow: 'G2', armor: 'R3', accessory: 'A8', back: 'B4' } },
  L4: { name: 'Violet force', look: ROBE },
  L5: { name: 'Violet force · tech', look: { ...ROBE, glow: 'G1', armor: 'R1', accessory: 'A9', back: 'B3' } },
  L6: { name: 'Violet force · armoured', look: { ...ROBE, glow: 'G2', armor: 'R2', accessory: 'A7', back: 'B2' } },
};

/** Look fields the player picks; the outfit, glow and back tech come from the equipped frame (see armorLook). */
export type ChosenKey = 'body' | 'hair' | 'face' | 'palette';

/** Choices offered at character creation (a subset of the Character Lab catalogues). */
export const CREATION_CHOICES: { key: ChosenKey; label: string; options: string[]; names: Record<string, { name: string; desc?: string }> }[] = [
  { key: 'body', label: 'Body', options: ['P1', 'P2', 'P3', 'P4'], names: BODIES },
  { key: 'hair', label: 'Hair', options: ['H1', 'H3', 'H4', 'H7'], names: HAIRS },
  { key: 'face', label: 'Face gear', options: ['F0', 'F3', 'F4', 'F6'], names: FACES },
  { key: 'palette', label: 'Colours', options: Object.keys(PALETTES), names: PALETTES },
];

/** Starting appearance on the creation screen (the outfit and its gear come from the class's armour). */
export const DEFAULT_APPEARANCE: Look = { body: 'P3', hair: 'H1', outfit: 'O1', accessory: 'A1', palette: 'C1', glow: 'G0', armor: 'R0', back: 'B0', face: 'F6' };

/** Legacy looks: saves made before full customisation stored one of these ids. */
export const PLAYER_LOOKS: Record<string, { name: string; desc: string; look: Look }> = {
  coat: { name: 'Rose coat', desc: 'Long open coat over a knit, long pink hair.', look: { ...LOOKS.L2.look, back: 'B4' } },
  robe: { name: 'Violet force', desc: 'High-collar robe with a split skirt, silver twin tails.', look: LOOKS.L5.look },
};
export const DEFAULT_PLAYER_LOOK = 'coat';

/** Default look for previews (viewer, run lab). */
export const PLAYER_LOOK: Look = DEFAULT_APPEARANCE;

/** The look stored on a character (older saves included), dressed in its equipped frame. */
export function playerLook(data: {
  appearance?: Look;
  look?: string;
  colors?: LookColors;
  classId?: ClassId;
  equipped?: { frame?: string };
  inventory?: { uid: string; id: string }[];
}): Look {
  const legacy = PLAYER_LOOKS[data.look ?? DEFAULT_PLAYER_LOOK] ?? PLAYER_LOOKS[DEFAULT_PLAYER_LOOK];
  const look = data.appearance ? { ...DEFAULT_APPEARANCE, ...data.appearance } : { ...legacy.look, colors: data.colors };
  const frameId = data.equipped?.frame && data.inventory?.find((it) => it.uid === data.equipped!.frame)?.id;
  const def = frameId ? itemDefs[frameId] : undefined;
  const gear = armorLook(data.classId ?? 'hunter', def?.type === 'armor' ? def : null);
  // The frame decides the outfit and its evolution; players don't get head accessories (Character Lab only).
  return { ...look, ...gear, accessory: 'A1', armor: 'R0', glow: 'G0', back: 'B0' };
}

// ------------------------------------------------------------ geometry helpers

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function shade(hex: number, k: number): number {
  const c = new THREE.Color(hex);
  c.multiplyScalar(k);
  return c.getHex();
}

/** Body shell from a radius profile [(r, y)], elliptical in depth, optionally open at the front. */
function shellGeo(profile: [number, number][], depth: number, gap = 0, segs = 9): THREE.BufferGeometry {
  const pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(0.001, r), y));
  const g = new THREE.LatheGeometry(pts, segs, gap / 2, Math.PI * 2 - gap);
  g.scale(1, 1, depth);
  return g;
}

/** Panel hanging down from its top edge: trapezoid wTop -> wBot, thickness t. */
function taperBox(wTop: number, wBot: number, h: number, t: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(1, h, t).translate(0, -h / 2, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setX(i, p.getX(i) * (p.getY(i) > -h / 2 ? wTop : wBot));
  g.computeVertexNormals();
  return g;
}

/**
 * A tapered, flattened prism from a to b: a hair strand or ribbon piece.
 * `out` is the direction its flat face should look at (away from the head).
 */
function piece(parent: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, w0: number, w1: number, t: number, out: THREE.Vector3, m: THREE.Material): THREE.Mesh {
  const dir = b.clone().sub(a);
  const len = dir.length();
  dir.normalize();
  const g = new THREE.CylinderGeometry(w0 / Math.SQRT2, Math.max(0.001, w1) / Math.SQRT2, len, 4).rotateY(Math.PI / 4);
  g.scale(1, 1, t / Math.max(0.001, w0));
  const y = dir.clone().negate();
  let x = new THREE.Vector3().crossVectors(y, out);
  if (x.lengthSq() < 1e-6) x = new THREE.Vector3(1, 0, 0);
  x.normalize();
  const z = new THREE.Vector3().crossVectors(x, y).normalize();
  const mesh = new THREE.Mesh(g, m);
  mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

/** Draw a strand through several nodes with per-node widths. */
function strand(parent: THREE.Object3D, nodes: THREE.Vector3[], widths: number[], t: number, center: THREE.Vector3, m: THREE.Material): void {
  for (let i = 0; i < nodes.length - 1; i++) {
    const mid = nodes[i].clone().add(nodes[i + 1]).multiplyScalar(0.5);
    const out = mid.clone().sub(center);
    out.y *= 0.3;
    piece(parent, nodes[i], nodes[i + 1], widths[i], widths[i + 1], t * (i === nodes.length - 2 ? 0.8 : 1), out.normalize(), m);
  }
}

/** Anime head: round cranium, narrow pointed jaw, small chin. */
function deformHead(v: THREE.Vector3, r: number): THREE.Vector3 {
  let { x, y, z } = v;
  if (y < 0) {
    const t = clamp(-y / r, 0, 1);
    x *= 1 - 0.46 * Math.pow(t, 1.4);
    z *= z > 0 ? 1 - 0.12 * t : 1 - 0.5 * t;
    z += 0.2 * r * t * t;
    y *= 1 + 0.36 * t;
  } else {
    y *= 1.04;
  }
  return new THREE.Vector3(x, y, z);
}

function headGeo(r: number): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(r, 14, 10);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const d = deformHead(v, r);
    p.setXYZ(i, d.x, d.y, d.z);
  }
  g.computeVertexNormals();
  return g;
}

/** A point on the face surface given unit-sphere x/y (front hemisphere), lifted off by `off`. */
function facePoint(r: number, x: number, y: number, off: number): THREE.Vector3 {
  const z = Math.sqrt(Math.max(0, 1 - x * x - y * y));
  const p = deformHead(new THREE.Vector3(x * r, y * r, z * r), r);
  const n = p.clone().normalize();
  return p.addScaledVector(n, off);
}

// ------------------------------------------------------------ secondary motion

interface ChainSeg {
  g: THREE.Group;
  a: number;
  b: number;
  va: number;
  vb: number;
  /** Allowed pitch in the chest frame (+ = toward the back). */
  aMin: number;
  aMax: number;
  bMin: number;
  bMax: number;
}

/** A hanging chain (hair mass, tail, ribbon) that swings toward gravity and trails in the wind. */
class Chain {
  readonly segs: ChainSeg[] = [];
  constructor(
    readonly root: THREE.Group,
    readonly stiffness = 90,
    readonly damping = 9,
    readonly drag = 0.085,
  ) {}
  add(g: THREE.Group, aRange: [number, number], bRange: [number, number] = [-0.9, 0.9]): void {
    this.segs.push({ g, a: 0, b: 0, va: 0, vb: 0, aMin: aRange[0], aMax: aRange[1], bMin: bRange[0], bMax: bRange[1] });
  }
}

interface Panel {
  hinge: THREE.Group;
  tilt: THREE.Group;
  theta: number;
  y0: number;
  len: number;
  halfW: number;
  base: number;
  phi: number;
  v: number;
}

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const DOWN = new THREE.Vector3(0, -1, 0);

// ------------------------------------------------------------ the model

interface Dims {
  s: number;
  H: number;
  r: number;
  hipPivotY: number;
  thigh: number;
  shin: number;
  ankle: number;
  hipW: number;
  shoulderW: number;
  spineRel: number;
  chestRel: number;
  neckRel: number;
  shoulderRel: number;
  headCenter: number;
  upper: number;
  fore: number;
  limb: number;
  bust: number;
}

interface Mats {
  skin: THREE.MeshStandardMaterial;
  hair: THREE.MeshStandardMaterial;
  hairDark: THREE.MeshStandardMaterial;
  main: THREE.MeshStandardMaterial;
  mainDark: THREE.MeshStandardMaterial;
  second: THREE.MeshStandardMaterial;
  accent: THREE.MeshStandardMaterial;
  legwear: THREE.MeshStandardMaterial;
  shoes: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  plate: THREE.MeshStandardMaterial;
  dark: THREE.MeshStandardMaterial;
  glow: THREE.MeshStandardMaterial;
}

export interface CharacterModel {
  readonly rig: Rig;
  readonly grip: THREE.Group;
  readonly legs: LegDims;
  readonly height: number;
  update?(dt: number, extraVel?: THREE.Vector3): void;
}

export class Heroine implements CharacterModel {
  readonly rig = new Rig();
  readonly grip = new THREE.Group();
  readonly height: number;
  readonly legs: LegDims;
  readonly look: Look;
  private readonly d: Dims;
  private readonly m: Mats;
  private readonly chains: Chain[] = [];
  private readonly panels: Panel[] = [];
  /** Leg capsules the panels must stay outside of. */
  private panelLegs: 'thigh' | 'full' = 'thigh';
  /** Hovering parts (bits, halo) animated in update(). */
  private floaters: { obj: object; tick: (t: number, dt: number) => void }[] = [];
  readonly pal: Palette;
  /** Glow lines: 0 none, 1 trim, 2 trim + circuitry (from `glow`, or the evolution stage). */
  private readonly glowLvl: number;
  private time = 0;
  private lastAnchor = new Map<object, THREE.Vector3>();
  private vel = new Map<object, THREE.Vector3>();

  constructor(look: Look) {
    this.look = look;
    const body = BODIES[look.body] ?? BODIES.P2;
    const pal = lookPalette(look);
    this.pal = pal;
    this.d = this.dims(body);
    this.m = this.mats(pal);
    this.glowLvl = look.evo !== undefined ? (look.evo >= 3 ? 2 : look.evo >= 2 ? 1 : 0) : ({ G1: 1, G2: 2 } as Record<string, number>)[look.glow] ?? 0;
    const d = this.d;
    this.height = d.H;
    this.legs = { thigh: d.thigh, shin: d.shin + d.ankle, hipWidth: d.hipW, restHipY: d.hipPivotY };

    this.buildSkeleton();
    this.buildHead();
    this.buildOutfit(look.outfit);
    this.buildHair(look.hair);
    this.buildAccessory(look.accessory);
    this.buildFace(look.face ?? 'F0');
    this.buildTech();

    this.rig.tintable.push(this.m.main, this.m.second);
    this.rig.finalize();
  }

  // ---------------------------------------------------------- setup

  private dims(b: BodySpec): Dims {
    const H = b.height;
    const s = H / 1.68;
    const r = b.headH / 2.4;
    const chinY = H - b.headH;
    const neckBaseY = chinY - 0.33 * b.headH;
    const hipPivotY = b.legRatio * H;
    const ankle = 0.058 * s;
    const thigh = 0.505 * (hipPivotY - ankle);
    const shin = hipPivotY - ankle - thigh;
    const hipsY = hipPivotY + 0.05 * s;
    const spineRel = 0.08 * s;
    const spineY = hipsY + spineRel;
    const chestRel = 0.42 * (neckBaseY - spineY);
    const neckRel = neckBaseY - spineY - chestRel;
    return {
      s, H, r, hipPivotY, thigh, shin, ankle,
      hipW: b.hipW * s / 1.0,
      shoulderW: b.shoulderW * s,
      spineRel, chestRel, neckRel,
      shoulderRel: neckRel - 0.045 * s,
      headCenter: chinY + 1.36 * r - neckBaseY,
      upper: 0.168 * H,
      fore: 0.142 * H,
      limb: b.limb * s,
      bust: b.bust,
    };
  }

  private mats(p: Palette): Mats {
    const m = (c: number, o: Parameters<typeof mat>[1] = {}) => mat(c, o);
    const glow = m(p.accent, { emissive: p.accent, emissiveIntensity: 0.9 });
    glow.userData.glow = true;
    return {
      // A little self-light keeps faces and hair from going grey under flat shading.
      skin: m(p.skin, { emissive: p.skin, emissiveIntensity: 0.1 }),
      hair: m(p.hair, { emissive: p.hair, emissiveIntensity: 0.06, rough: 0.6 }),
      hairDark: m(shade(p.hair, 0.72), { emissive: p.hair, emissiveIntensity: 0.05 }),
      main: m(p.main),
      mainDark: m(shade(p.main, 0.78)),
      second: m(p.second),
      accent: m(p.accent),
      legwear: m(p.legwear, { rough: 0.55 }),
      shoes: m(p.shoes, { rough: 0.45 }),
      metal: m(p.metal, { rough: 0.35 }),
      plate: m(p.plate, { rough: 0.4 }),
      dark: m(0x18161c),
      glow,
    };
  }

  /** Joints only; meshes are added by the outfit. */
  private buildSkeleton(): void {
    const { s, hipPivotY, thigh, hipW, spineRel, chestRel, neckRel, shoulderRel, shoulderW, upper, fore } = this.d;
    const j = this.rig.joints;
    j.hips.position.y = hipPivotY + 0.05 * s;
    this.rig.root.add(j.hips);
    for (const [hip, knee, side] of [
      [j.hipL, j.kneeL, 1],
      [j.hipR, j.kneeR, -1],
    ] as const) {
      hip.position.set(side * hipW, -0.05 * s, 0);
      j.hips.add(hip);
      knee.position.y = -thigh;
      hip.add(knee);
    }
    j.spine.position.y = spineRel;
    j.hips.add(j.spine);
    j.chest.position.y = chestRel;
    j.spine.add(j.chest);
    j.head.position.y = neckRel;
    j.chest.add(j.head);
    for (const [sh, el, hand, side] of [
      [j.shoulderL, j.elbowL, j.handL, 1],
      [j.shoulderR, j.elbowR, j.handR, -1],
    ] as const) {
      sh.position.set(side * shoulderW, shoulderRel, 0);
      j.chest.add(sh);
      el.position.y = -upper;
      sh.add(el);
      hand.position.y = -fore;
      el.add(hand);
    }
    // Weapon grip: in the rest pose the weapon points forward and slightly down.
    this.grip.position.set(0, -0.06 * s, 0.02 * s);
    this.grip.rotation.x = 0.3;
    j.handR.add(this.grip);
  }

  // ---------------------------------------------------------- body parts

  private torso(pelvis: THREE.Material, waist: THREE.Material, chest: THREE.Material, bustMat = chest): void {
    const { s, chestRel, neckRel, hipW, limb } = this.d;
    const j = this.rig.joints;
    const hw = (hipW / s / 0.082) * s; // hip width factor
    part(j.hips, shellGeo([[0.05 * s, -0.115 * s], [0.12 * hw, -0.085 * s], [0.148 * hw, -0.035 * s], [0.152 * hw, 0.005 * s], [0.138 * s, 0.05 * s], [0.122 * s, 0.085 * s]], 0.78), pelvis);
    part(j.spine, shellGeo([[0.124 * s, -0.005 * s], [0.108 * s, chestRel * 0.55], [0.116 * s, chestRel + 0.005 * s]], 0.76), waist);
    const sw = this.d.shoulderW / s / 0.155;
    part(j.chest, shellGeo([[0.116 * s, -0.005 * s], [0.13 * s, neckRel * 0.3], [0.142 * s * sw, neckRel * 0.6], [0.146 * s * sw, neckRel * 0.8], [0.11 * s * sw, neckRel * 0.95], [0.05 * s, neckRel * 1.02]], 0.68), chest);
    this.bust(bustMat);
    // Neck.
    part(j.head, limbGeo(0.03 * limb, 0.034 * limb, this.d.headCenter * 0.75).translate(0, this.d.headCenter * 0.75, 0), this.m.skin);
  }

  private bust(m: THREE.Material, grow = 1): void {
    const { s, neckRel, bust } = this.d;
    if (bust <= 0) return;
    for (const sx of [-1, 1])
      part(this.rig.joints.chest, new THREE.SphereGeometry(0.056 * s * bust * grow, 7, 5), m, [sx * 0.052 * s, neckRel * 0.42, 0.062 * s], [0, 0, 0], [1, 0.85, 0.7]);
  }

  private arms(upperMat: THREE.Material, foreMat: THREE.Material, handMat: THREE.Material, shoulderMat = upperMat): void {
    const { s, limb, upper, fore } = this.d;
    const j = this.rig.joints;
    for (const [sh, el, hand, side] of [
      [j.shoulderL, j.elbowL, j.handL, 1],
      [j.shoulderR, j.elbowR, j.handR, -1],
    ] as const) {
      part(sh, new THREE.SphereGeometry(0.047 * limb, 7, 5), shoulderMat, [0, -0.005 * s, 0]);
      part(sh, limbGeo(0.042 * limb, 0.034 * limb, upper + 0.01), upperMat);
      part(el, new THREE.SphereGeometry(0.034 * limb, 6, 4), foreMat);
      part(el, limbGeo(0.034 * limb, 0.025 * limb, fore), foreMat);
      // Small hand: palm, fingers, thumb.
      part(hand, new THREE.BoxGeometry(0.046 * s, 0.06 * s, 0.03 * s), handMat, [0, -0.032 * s, 0.004 * s]);
      part(hand, new THREE.BoxGeometry(0.042 * s, 0.045 * s, 0.026 * s), handMat, [0, -0.078 * s, 0.012 * s], [0.35, 0, 0]);
      part(hand, new THREE.BoxGeometry(0.018 * s, 0.042 * s, 0.02 * s), handMat, [side * -0.026 * s, -0.035 * s, 0.022 * s], [0.4, 0, side * 0.3]);
    }
  }

  /** Thighs and shins. `stockingTop`: fraction of the thigh (from the knee up) covered by `shinMat`. */
  private legsGeo(thighMat: THREE.Material, shinMat: THREE.Material, stockingTop = 0, stockingBand?: THREE.Material): void {
    const { limb, thigh, shin } = this.d;
    const j = this.rig.joints;
    for (const [hip, knee] of [
      [j.hipL, j.kneeL],
      [j.hipR, j.kneeR],
    ] as const) {
      const r0 = 0.074 * limb;
      const r1 = 0.047 * limb;
      if (stockingTop > 0) {
        const cut = thigh * (1 - stockingTop);
        const rc = r0 + (r1 - r0) * (cut / thigh);
        part(hip, limbGeo(r0, rc, cut + 0.005), thighMat);
        part(hip, limbGeo(rc * 1.01, r1 * 1.01, thigh - cut), shinMat, [0, -cut, 0]);
        if (stockingBand) part(hip, limbGeo(rc * 1.07, rc * 1.04, 0.035 * limb), stockingBand, [0, -cut + 0.01, 0]);
      } else {
        part(hip, limbGeo(r0, r1, thigh + 0.005), thighMat);
      }
      part(knee, new THREE.SphereGeometry(r1 * 1.0, 6, 4), shinMat);
      // Calf: a gentle bulge, then a slim ankle.
      part(knee, limbGeo(r1, 0.049 * limb, shin * 0.38), shinMat);
      part(knee, limbGeo(0.049 * limb, 0.027 * limb, shin * 0.62 + 0.004), shinMat, [0, -shin * 0.38, 0]);
    }
  }

  /** Calf radius at fraction t (0 = knee, 1 = ankle). */
  private calfR(t: number): number {
    const { limb } = this.d;
    const r1 = 0.047 * limb;
    const r2 = 0.049 * limb;
    const r3 = 0.027 * limb;
    return t < 0.38 ? r1 + (r2 - r1) * (t / 0.38) : r2 + (r3 - r2) * ((t - 0.38) / 0.62);
  }

  /** A sleeve hugging the calf from t0 to t1 (0 = knee, 1 = ankle), `pad` thicker. */
  private calfSleeve(knee: THREE.Object3D, t0: number, t1: number, pad: number, m: THREE.Material): void {
    const { shin } = this.d;
    const ts = [t0, ...[0.38].filter((t) => t > t0 && t < t1), t1];
    const prof: [number, number][] = ts.map((t) => [Math.max(this.calfR(t) + pad, t > 0.7 ? 0.034 * this.d.limb + pad : 0), -shin * t]);
    part(knee, shellGeo(prof.reverse(), 1, 0, 8), m);
    part(knee, new THREE.CircleGeometry(prof[prof.length - 1][0], 8).rotateX(-Math.PI / 2), m, [0, -shin * t0, 0]);
  }

  /** Feet and footwear. */
  private shoes(kind: 'ankle' | 'maryjane' | 'tall' | 'armored', soleAccent?: THREE.Material): void {
    const { s, limb, shin, ankle } = this.d;
    const { shoes, metal, accent, dark } = this.m;
    const j = this.rig.joints;
    for (const [knee, side] of [
      [j.kneeL, 1],
      [j.kneeR, -1],
    ] as const) {
      const ay = -shin; // ankle joint height in knee space; sole is `ankle` lower
      const footL = 0.2 * s;
      const sole = soleAccent ?? dark;
      if (kind === 'maryjane') {
        part(knee, new THREE.BoxGeometry(0.07 * s, ankle * 0.7, footL * 0.92), shoes, [0, ay - ankle * 0.55, 0.045 * s]);
        part(knee, new THREE.BoxGeometry(0.072 * s, 0.012 * s, footL * 0.94), dark, [0, ay - ankle + 0.006 * s, 0.045 * s]);
        part(knee, new THREE.BoxGeometry(0.074 * s, 0.008 * s, 0.014 * s), shoes, [0, ay - ankle * 0.15, 0.0], [0.4, 0, 0]); // strap
        for (const bx of [-1, 1]) part(knee, new THREE.ConeGeometry(0.012 * s, 0.03 * s, 4), accent, [bx * 0.016 * s, ay - ankle * 0.3, 0.115 * s], [0, 0, bx * -Math.PI / 2]); // bow
        // Stocking-covered foot top.
        part(knee, new THREE.BoxGeometry(0.06 * s, ankle * 0.6, footL * 0.5), this.m.legwear, [0, ay - ankle * 0.25, 0.02 * s]);
        continue;
      }
      // Foot block (toe to heel).
      part(knee, new THREE.BoxGeometry(0.074 * s, ankle * 0.95, footL), shoes, [0, ay - ankle * 0.5, 0.042 * s]);
      part(knee, new THREE.BoxGeometry(0.068 * s, ankle * 0.7, 0.05 * s), shoes, [0, ay - ankle * 0.55, 0.15 * s], [0.25, 0, 0]); // toe slope
      part(knee, new THREE.BoxGeometry(0.078 * s, 0.016 * s, footL + 0.01 * s), sole, [0, ay - ankle + 0.008 * s, 0.045 * s]);
      if (kind === 'ankle') {
        // Chunky ankle boots with two buckled straps and a block heel.
        this.calfSleeve(knee, 0.72, 1, 0.012 * s, shoes);
        part(knee, new THREE.BoxGeometry(0.06 * s, 0.035 * s, 0.05 * s), sole, [0, ay - ankle + 0.017 * s, -0.025 * s]);
        for (const [yy, k] of [[-shin * 0.82, 1.08], [-shin * 0.93, 1.1]] as const) {
          part(knee, limbGeo(0.046 * limb * k, 0.046 * limb * k, 0.014 * s), dark, [0, yy, 0]);
          part(knee, new THREE.BoxGeometry(0.01 * s, 0.02 * s, 0.022 * s), metal, [side * 0.05 * limb, yy - 0.007 * s, 0.006 * s]);
        }
        part(knee, new THREE.BoxGeometry(0.012 * s, shin * 0.22, 0.012 * s), metal, [0, -shin * 0.86, 0.042 * limb]); // front zip
      } else if (kind === 'tall') {
        // Knee-high boots with a flared cuff (PSO).
        this.calfSleeve(knee, 0.04, 1, 0.006 * s, shoes);
        part(knee, new THREE.CylinderGeometry(0.064 * limb, 0.056 * limb, 0.06 * s, 7), shoes, [0, -shin * 0.04, 0.005], [-0.15, 0, 0]);
        if (soleAccent) part(knee, new THREE.BoxGeometry(0.072 * s, 0.04 * s, 0.05 * s), soleAccent, [0, ay - ankle * 0.4, 0.13 * s]);
      } else {
        // Armoured boots to the knee with a knee guard.
        this.calfSleeve(knee, 0.0, 1, 0.008 * s, shoes);
        part(knee, new THREE.BoxGeometry(0.075 * limb, 0.1 * s, 0.03 * s), metal, [0, -0.01 * s, 0.045 * limb], [-0.1, 0, 0]);
        part(knee, new THREE.BoxGeometry(0.06 * limb, shin * 0.4, 0.02 * s), shoes, [0, -shin * 0.35, 0.05 * limb], [0.06, 0, 0]); // shin plate
        part(knee, new THREE.BoxGeometry(0.03 * s, 0.012 * s, 0.03 * s), accent, [side * 0.05 * limb, -shin * 0.5, 0]);
      }
    }
  }

  // ---------------------------------------------------------- head

  private buildHead(): void {
    const { r, headCenter } = this.d;
    const head = this.rig.joints.head;
    const c = headCenter;
    // Smooth-shaded face with a little more self-light: anime faces read flat and bright.
    const face = mat(this.m.skin.color.getHex(), { emissive: this.m.skin.color.getHex(), emissiveIntensity: 0.28, flat: false });
    part(head, headGeo(r), face, [0, c, 0]);
    // Ears (mostly hidden by hair).
    for (const sx of [-1, 1]) part(head, new THREE.SphereGeometry(r * 0.2, 5, 4), this.m.skin, [sx * r * 0.93, c - r * 0.18, -r * 0.05], [0, 0, 0], [0.5, 1, 0.7]);

    // Big anime eyes, built flat in eye space and set onto the face.
    const pal = this.pal;
    const decal = (color: number, glow = 0.35) => {
      const m = mat(color, { emissive: color, emissiveIntensity: glow });
      m.polygonOffset = true;
      m.polygonOffsetFactor = -2;
      m.polygonOffsetUnits = -2;
      return m;
    };
    const white = decal(0xfafaff, 0.45);
    const iris = decal(pal.eyes, 0.35);
    const irisDark = decal(shade(pal.eyes, 0.45), 0.2);
    const lash = decal(0x221418, 0.1);
    const shine = decal(0xffffff, 1);
    shine.userData.glow = true;
    const ew = r * 0.36;
    const eh = r * 0.4;
    for (const sx of [-1, 1]) {
      const p = facePoint(r, sx * 0.4, -0.16, r * 0.012);
      const eye = new THREE.Group();
      eye.position.set(p.x, c + p.y, p.z);
      eye.rotation.set(0.04, sx * 0.42, 0);
      head.add(eye);
      const disc = (rx: number, ry: number, m: THREE.Material, x: number, y: number, z: number, segs = 10) =>
        part(eye, new THREE.CircleGeometry(1, segs), m, [x, y, z], [0, 0, 0], [rx, ry, 1]);
      disc(ew * 0.5, eh * 0.46, white, 0, -eh * 0.02, 0);
      disc(ew * 0.33, eh * 0.43, iris, sx * -ew * 0.04, -eh * 0.04, 0.0006);
      disc(ew * 0.2, eh * 0.26, irisDark, sx * -ew * 0.04, eh * 0.04, 0.0012);
      disc(ew * 0.09, eh * 0.09, shine, sx * -ew * 0.14, eh * 0.16, 0.0018, 6);
      disc(ew * 0.05, eh * 0.05, shine, sx * ew * 0.07, -eh * 0.2, 0.0018, 5);
      // Upper lash line with a flick at the outer corner, and a thin lower line.
      part(eye, new THREE.BoxGeometry(ew * 1.12, eh * 0.13, 0.002), lash, [0, eh * 0.42, 0.002], [0, 0, sx * -0.12]);
      part(eye, new THREE.BoxGeometry(ew * 0.3, eh * 0.1, 0.002), lash, [sx * ew * 0.55, eh * 0.34, 0.002], [0, 0, sx * -0.55]);
      part(eye, new THREE.BoxGeometry(ew * 0.5, eh * 0.04, 0.002), lash, [sx * ew * 0.12, -eh * 0.46, 0.002]);
      // Brow (thin, high; usually under the bangs).
      part(eye, new THREE.BoxGeometry(ew * 0.8, eh * 0.06, 0.002), this.m.hairDark, [0, eh * 0.95, 0.004], [0, 0, sx * -0.1]);
    }
    // Tiny nose and mouth.
    const nose = facePoint(r, 0, -0.44, 0.002);
    part(head, new THREE.ConeGeometry(r * 0.04, r * 0.08, 3), this.m.skin, [nose.x, c + nose.y, nose.z], [-0.6, 0, 0]);
    const mouth = facePoint(r, 0, -0.68, 0.002);
    part(head, new THREE.BoxGeometry(r * 0.13, r * 0.022, 0.003), decal(0xb8585e, 0.2), [mouth.x, c + mouth.y, mouth.z], [-0.35, 0, 0]);
  }

  // ---------------------------------------------------------- hair

  private buildHair(key: string): void {
    const { r, headCenter: c } = this.d;
    const head = this.rig.joints.head;
    const { hair, hairDark } = this.m;
    const C = V(0, c, 0);

    // Cap over the cranium: hairline high at the front, low at the nape.
    part(head, new THREE.SphereGeometry(r * 1.1, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.62), hair, [0, c + r * 0.03, -r * 0.03], [-0.5, 0, 0], [1.04, 1, 1.07]);
    // Back-of-head volume.
    part(head, new THREE.SphereGeometry(r * 1.06, 10, 7), hair, [0, c - r * 0.05, -r * 0.2], [0, 0, 0], [1.02, 1, 0.92]);

    /** Bangs across the forehead: [angle across, length, width, curl]. */
    const bangs = (list: [number, number, number, number][], blunt = false) => {
      for (const [ang, len, w, curl] of list) {
        const e0 = 0.85;
        const root = V(Math.sin(ang) * Math.cos(e0), Math.sin(e0), Math.cos(ang) * Math.cos(e0)).multiplyScalar(r * 1.08).add(C);
        const mid = V(Math.sin(ang + curl * 0.5) * 1.0, 0.45, Math.cos(ang + curl * 0.5) * 1.1).multiplyScalar(r).add(C);
        const tipY = 0.62 - 0.6 * len; // len 1 ≈ just above the eyes
        const tip = V(Math.sin(ang + curl) * 0.92, tipY, Math.cos(ang + curl) * 1.06).multiplyScalar(r).add(C);
        strand(head, [root, mid, tip], [w * r, w * r * 0.9, blunt ? w * r * 0.85 : 0.002], r * 0.1, C, hair);
      }
    };
    /** Locks falling at the sides of the face: [side, length, forward]. */
    const sideLocks = (len: number, fwd: number, w: number, blunt = false) => {
      for (const sx of [-1, 1]) {
        const root = V(sx * r * 0.9, c + r * 0.55, r * 0.35);
        const a = V(sx * r * 1.04, c - r * 0.1, r * (0.32 + fwd * 0.2));
        const b = V(sx * r * 0.98, c - r * (0.1 + len), r * (0.3 + fwd));
        strand(head, [root, a, b], [w * r, w * r * 0.85, blunt ? w * r * 0.8 : 0.002], r * 0.12, C, hair);
      }
    };

    if (key === 'H1') {
      bangs([[-0.75, 1.05, 0.42, 0.1], [-0.4, 1.25, 0.45, 0.18], [-0.08, 1.15, 0.42, 0.22], [0.25, 1.3, 0.44, 0.2], [0.55, 1.1, 0.42, 0.1], [0.85, 0.95, 0.38, 0.05]]);
      sideLocks(0.9, 0.25, 0.42);
      this.frontLocks(3.6);
      this.backHair([0.14, 0.15, 0.14, 0.11], 9, 1.0, false);
    } else if (key === 'H2') {
      bangs([[-0.66, 0.95, 0.46, 0], [-0.33, 0.98, 0.46, 0], [0, 0.98, 0.46, 0], [0.33, 0.98, 0.46, 0], [0.66, 0.95, 0.46, 0]], true);
      sideLocks(0.8, 0.15, 0.62, true);
      this.backHair([0.17, 0.19, 0.19, 0.17], 9, 1.05, true);
    } else if (key === 'H3') {
      bangs([[-0.6, 1.1, 0.42, 0.15], [-0.2, 1.0, 0.42, 0.2], [0.2, 1.15, 0.42, 0.2], [0.6, 1.0, 0.42, 0.15]]);
      sideLocks(1.15, 0.2, 0.32);
      this.ponytail(V(0, c + r * 0.6, -r * 0.92), [0.12, 0.14, 0.14, 0.11], 0, [0.35, 1.7]);
    } else if (key === 'H4') {
      bangs([[-0.6, 1.05, 0.42, 0.15], [-0.2, 1.15, 0.42, 0.15], [0.2, 1.0, 0.42, 0.25], [0.6, 1.1, 0.42, 0.1]]);
      sideLocks(0.75, 0.15, 0.32);
      for (const sx of [-1, 1]) this.ponytail(V(sx * r * 0.88, c + r * 0.42, -r * 0.42), [0.13, 0.15, 0.16, 0.13], sx, [0.28, 1.6]);
      // Short nape layer.
      this.nape(0.55);
    } else if (key === 'H5') {
      // Voluminous red bob: back volume, chin-length side locks, swept bangs, spiky tips.
      part(head, new THREE.CylinderGeometry(r * 1.0, r * 1.22, r * 1.05, 9), hair, [0, c - r * 0.65, -r * 0.18], [0.22, 0, 0], [1, 1, 0.9]);
      bangs([[-0.7, 0.95, 0.42, 0.25], [-0.32, 1.1, 0.46, 0.3], [0.05, 1.0, 0.46, 0.3], [0.42, 1.1, 0.44, 0.25], [0.78, 0.9, 0.4, 0.2]]);
      sideLocks(1.15, 0.3, 0.5);
      for (let i = 0; i < 7; i++) {
        const a = Math.PI + (i - 3) * 0.42;
        const root = V(Math.sin(a) * r * 1.05, c - r * 0.75, Math.cos(a) * r * 0.95 - r * 0.15);
        const tip = V(Math.sin(a) * r * 1.35, c - r * 1.35, Math.cos(a) * r * 1.2 - r * 0.15);
        strand(head, [root, tip], [r * 0.5, 0.002], r * 0.14, C, i % 2 ? hairDark : hair);
      }
    } else if (key === 'H7') {
      // Space buns on top, long hair down the back.
      bangs([[-0.6, 1.05, 0.42, 0.12], [-0.2, 1.2, 0.42, 0.18], [0.2, 1.1, 0.42, 0.18], [0.6, 1.0, 0.42, 0.1]]);
      sideLocks(1.0, 0.2, 0.36);
      for (const sx of [-1, 1]) {
        const at = V(sx * r * 0.74, c + r * 0.98, -r * 0.32);
        part(head, new THREE.SphereGeometry(r * 0.5, 8, 6), hair, [at.x, at.y, at.z], [0, 0, 0], [1, 0.92, 1]);
        part(head, new THREE.TorusGeometry(r * 0.42, r * 0.08, 4, 10), hairDark, [at.x - sx * r * 0.06, at.y - r * 0.2, at.z], [Math.PI / 2, 0, sx * 0.55]);
        part(head, new THREE.TorusGeometry(r * 0.36, r * 0.06, 4, 10), this.m.accent, [at.x - sx * r * 0.12, at.y - r * 0.34, at.z], [Math.PI / 2, 0, sx * 0.55]);
      }
      this.backHair([0.13, 0.14, 0.13], 7, 0.95, false);
    } else if (key === 'H8') {
      // Side ponytail on the left, bangs swept to the right.
      bangs([[-0.85, 0.95, 0.4, -0.25], [-0.5, 1.1, 0.44, -0.3], [-0.15, 1.2, 0.46, -0.32], [0.2, 1.15, 0.44, -0.3], [0.55, 1.0, 0.4, -0.2]]);
      sideLocks(1.1, 0.25, 0.34);
      this.nape(0.5);
      this.ponytail(V(r * 0.86, c + r * 0.3, -r * 0.38), [0.13, 0.15, 0.15, 0.12], 1, [0.2, 1.5]);
    } else if (key === 'H9') {
      // Pixie cut with long front locks and a stray strand on top.
      bangs([[-0.7, 0.9, 0.38, 0.1], [-0.35, 1.05, 0.4, 0.15], [0.0, 0.95, 0.4, 0.2], [0.35, 1.1, 0.4, 0.15], [0.7, 0.9, 0.38, 0.1]]);
      sideLocks(0.55, 0.15, 0.32);
      this.frontLocks(4.2);
      this.nape(0.3);
      for (let i = 0; i < 6; i++) {
        const a = Math.PI + (i - 2.5) * 0.4;
        const root = V(Math.sin(a) * r * 0.95, c + r * 0.25, Math.cos(a) * r * 0.95);
        const tip = V(Math.sin(a) * r * 1.2, c - r * 0.25, Math.cos(a) * r * 1.15);
        strand(head, [root, tip], [r * 0.45, 0.002], r * 0.13, C, i % 2 ? hairDark : hair);
      }
      strand(head, [V(0, c + r * 1.05, r * 0.1), V(r * 0.1, c + r * 1.45, r * 0.25), V(r * 0.28, c + r * 1.5, r * 0.45)], [r * 0.14, r * 0.1, 0.002], r * 0.06, C, hair);
    } else {
      // H6: layered shoulder-length.
      bangs([[-0.7, 0.95, 0.4, -0.1], [-0.35, 1.2, 0.42, 0.1], [0.0, 1.05, 0.42, 0.15], [0.35, 1.25, 0.42, 0.2], [0.7, 0.95, 0.4, 0.15]]);
      sideLocks(1.35, 0.3, 0.38);
      this.backHair([0.12, 0.1], 8, 1.0, false, true);
    }
  }

  /** Long hair down the back: a fan of strands on a swinging chain. */
  private backHair(segLens: number[], count: number, spread: number, blunt: boolean, flicked = false): void {
    const { r, headCenter: c, s } = this.d;
    const head = this.rig.joints.head;
    const root = new THREE.Group();
    root.position.set(0, c - r * 0.1, -r * 0.55);
    head.add(root);
    const chain = new Chain(root, 80, 8);
    this.chains.push(chain);
    const n = segLens.length;
    let parent: THREE.Object3D = root;
    const groups: THREE.Group[] = [];
    for (let i = 0; i < n; i++) {
      const g = new THREE.Group();
      if (i > 0) g.position.y = -segLens[i - 1] * s;
      parent.add(g);
      groups.push(g);
      chain.add(g, i === 0 ? [0.04, 1.5] : [0.02, 1.5], [-0.6, 0.6]);
      parent = g;
    }
    for (let k = 0; k < count; k++) {
      const u = (k / (count - 1)) * 2 - 1; // -1..1 across the back
      const ang = Math.PI + u * 1.35;
      const outDir = V(Math.sin(ang), 0, Math.cos(ang));
      const m = k % 2 ? this.m.hairDark : this.m.hair;
      // Node offsets per segment boundary, in each segment's frame.
      const node = (i: number): THREE.Vector3 => {
        if (i === 0) return V(Math.sin(ang) * r * 0.95, 0, Math.cos(ang) * r * 0.6 + r * 0.08);
        const f = i / n;
        const wide = r * (1.05 + 0.35 * Math.min(1, f * 2)) * spread;
        return V(u * wide, 0, -r * (0.62 + 0.18 * f) + Math.abs(u) * r * 0.2);
      };
      const lenFactor = flicked ? 1 - Math.abs(u) * 0.2 : 1 - Math.abs(u) * 0.08;
      for (let i = 0; i < n; i++) {
        const a = node(i);
        const b = node(i + 1);
        const segLen = segLens[i] * s * (i === n - 1 ? lenFactor : 1);
        b.y = -segLen;
        const w0 = r * (i === 0 ? 0.55 : 0.5 - 0.05 * i);
        const last = i === n - 1;
        const w1 = last ? (blunt ? w0 * 0.7 : 0.002) : r * (0.5 - 0.05 * (i + 1));
        const out = outDir.clone().add(V(0, 0, -0.6)).normalize();
        piece(groups[i], a, b, w0, w1, r * 0.13, out, m);
        if (last && flicked) {
          const tip = b.clone().add(V(Math.sign(u || 1) * r * 0.25, r * 0.1, -r * 0.15));
          piece(groups[i], b, tip, w1 + r * 0.15, 0.002, r * 0.1, out, m);
        }
      }
    }
  }

  /** Long locks falling in front of the shoulders onto the chest (H1). */
  private frontLocks(len: number): void {
    const { r, headCenter: c } = this.d;
    const head = this.rig.joints.head;
    for (const sx of [-1, 1]) {
      const root = new THREE.Group();
      root.position.set(sx * r * 1.0, c - r * 0.2, r * 0.14);
      head.add(root);
      const chain = new Chain(root, 110, 10, 0.05);
      this.chains.push(chain);
      const g1 = new THREE.Group();
      root.add(g1);
      const l1 = r * len * 0.5;
      const g2 = new THREE.Group();
      g2.position.y = -l1;
      g1.add(g2);
      // Upper part angles forward over the shoulder; lower part hangs over the chest.
      chain.add(g1, [-0.62, -0.45], sx > 0 ? [0.0, 0.22] : [-0.22, 0.0]);
      chain.add(g2, [-0.35, 0.05], [-0.15, 0.15]);
      // Flat side faces forward so the lock reads as a wide ribbon of hair from the front.
      const out = V(sx * 0.35, 0, 1).normalize();
      piece(g1, V(0, r * 0.4, 0), V(0, -l1, 0), r * 0.52, r * 0.44, r * 0.13, out, this.m.hair);
      piece(g2, V(0, 0, 0), V(0, -r * len * 0.5, 0), r * 0.44, 0.002, r * 0.12, out, this.m.hair);
      piece(g1, V(sx * r * 0.12, r * 0.2, -r * 0.06), V(sx * r * 0.16, -l1 * 0.9, -r * 0.05), r * 0.36, 0.002, r * 0.1, out, this.m.hairDark);
    }
  }

  /** Short hair at the nape (under tails / ponytails). */
  private nape(len: number): void {
    const { r, headCenter: c } = this.d;
    const head = this.rig.joints.head;
    const C = V(0, c, 0);
    for (let i = 0; i < 5; i++) {
      const a = Math.PI + (i - 2) * 0.45;
      const root = V(Math.sin(a) * r * 0.95, c - r * 0.4, Math.cos(a) * r * 0.85 - r * 0.1);
      const tip = V(Math.sin(a) * r * 1.0, c - r * (0.4 + len + 0.4), Math.cos(a) * r * 0.95 - r * 0.15);
      strand(head, [root, tip], [r * 0.5, 0.002], r * 0.12, C, this.m.hair);
    }
  }

  /** A tied tail (ponytail or one of the twin tails). side: 0 = centre back, ±1 = sides. */
  private ponytail(at: THREE.Vector3, segLens: number[], side: number, aRange: [number, number]): void {
    const { r, s } = this.d;
    const head = this.rig.joints.head;
    // Hair tie.
    const tie = part(head, new THREE.CylinderGeometry(r * 0.2, r * 0.2, r * 0.18, 7), this.m.accent, [at.x, at.y, at.z]);
    tie.rotation.set(side === 0 ? 1.0 : 0.6, 0, side * -0.9);
    const root = new THREE.Group();
    root.position.copy(at).add(V(side * r * 0.12, 0, side === 0 ? -r * 0.12 : -r * 0.05));
    head.add(root);
    const chain = new Chain(root, side === 0 ? 70 : 60, 6, 0.09);
    this.chains.push(chain);
    const n = segLens.length;
    let parent: THREE.Object3D = root;
    const groups: THREE.Group[] = [];
    for (let i = 0; i < n; i++) {
      const g = new THREE.Group();
      if (i > 0) g.position.y = -segLens[i - 1] * s;
      parent.add(g);
      groups.push(g);
      const b: [number, number] = side > 0 ? [0.12, 1.2] : side < 0 ? [-1.2, -0.12] : [-0.6, 0.6];
      chain.add(g, i === 0 ? aRange : [Math.min(aRange[0], 0.1), aRange[1]], i === 0 ? b : [-0.8, 0.8]);
      parent = g;
    }
    // Four strands bunched round the axis, swelling then tapering.
    const width = [0.28, 0.46, 0.4, 0.28, 0.002];
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + 0.4;
      const m = k % 2 ? this.m.hairDark : this.m.hair;
      for (let i = 0; i < n; i++) {
        const rad0 = width[i] * r * 0.45;
        const rad1 = width[i + 1] * r * 0.45;
        const p0 = V(Math.sin(a) * rad0, 0, Math.cos(a) * rad0);
        const p1 = V(Math.sin(a) * rad1, -segLens[i] * s, Math.cos(a) * rad1);
        piece(groups[i], p0, p1, width[i] * r, i === n - 1 ? 0.002 : width[i + 1] * r, r * 0.16, V(Math.sin(a), 0, Math.cos(a)), m);
      }
    }
  }

  // ---------------------------------------------------------- accessories

  private buildAccessory(key: string): void {
    const { r, headCenter: c, s } = this.d;
    const head = this.rig.joints.head;
    const { accent, metal, dark, second, glow } = this.m;
    if (key === 'A2') {
      // Two-tone band over the crown, just behind the bangs.
      const band = new THREE.Group();
      band.position.set(0, c + r * 0.05, r * 0.15);
      band.rotation.x = -0.45;
      head.add(band);
      part(band, new THREE.TorusGeometry(r * 1.13, r * 0.07, 4, 14, Math.PI), dark, [0, 0, 0], [0, 0, 0], [1, 1.05, 1]);
      part(band, new THREE.TorusGeometry(r * 1.155, r * 0.035, 4, 14, Math.PI * 0.8), metal, [0, 0, 0.01 * s], [0, 0, Math.PI * 0.1], [1, 1.05, 1]);
    } else if (key === 'A3') {
      // Big ribbon at the left side.
      const bow = new THREE.Group();
      bow.position.set(r * 0.8, c + r * 0.55, -r * 0.35);
      bow.rotation.set(0.2, 0.9, -0.4);
      head.add(bow);
      for (const sx of [-1, 1]) {
        part(bow, new THREE.ConeGeometry(r * 0.32, r * 0.65, 4), accent, [sx * r * 0.32, 0, 0], [0, 0, sx * Math.PI / 2], [1, 1, 0.35]);
        part(bow, new THREE.BoxGeometry(r * 0.14, r * 0.85, r * 0.03), accent, [sx * r * 0.12, -r * 0.45, -0.005], [0, 0, sx * 0.25]);
      }
      part(bow, new THREE.SphereGeometry(r * 0.13, 6, 4), accent);
    } else if (key === 'A4') {
      // PSO-style headset: ear units with swept-back fins.
      for (const sx of [-1, 1]) {
        part(head, new THREE.CylinderGeometry(r * 0.3, r * 0.3, r * 0.2, 8), second, [sx * r * 1.05, c - r * 0.15, -r * 0.05], [0, 0, Math.PI / 2]);
        part(head, new THREE.CylinderGeometry(r * 0.18, r * 0.18, r * 0.22, 8), glow, [sx * r * 1.08, c - r * 0.15, -r * 0.05], [0, 0, Math.PI / 2]);
        part(head, new THREE.BoxGeometry(r * 0.06, r * 0.22, r * 0.75), metal, [sx * r * 1.12, c + r * 0.05, -r * 0.45], [0.5, 0, 0]);
        part(head, new THREE.BoxGeometry(r * 0.05, r * 0.14, r * 0.5), second, [sx * r * 1.1, c + r * 0.26, -r * 0.5], [0.85, 0, 0]);
      }
    } else if (key === 'A5') {
      // Visor goggles pushed up on the forehead.
      const v = new THREE.Group();
      v.position.set(0, c + r * 0.62, r * 0.05);
      v.rotation.x = -0.35;
      head.add(v);
      part(v, new THREE.CylinderGeometry(r * 1.17, r * 1.17, r * 0.3, 14, 1, true, -1.2, 2.4), dark, [0, 0, 0], [0, 0, 0]).material = (() => {
        const m2 = dark.clone();
        m2.side = THREE.DoubleSide;
        return m2;
      })();
      const lens = mat(this.pal.accent, { emissive: this.pal.accent, emissiveIntensity: 0.5, rough: 0.2 });
      lens.side = THREE.DoubleSide;
      lens.userData.glow = true;
      part(v, new THREE.CylinderGeometry(r * 1.2, r * 1.2, r * 0.22, 14, 1, true, -0.95, 1.9), lens);
      part(v, new THREE.TorusGeometry(r * 1.1, r * 0.04, 4, 16), metal, [0, 0, 0], [Math.PI / 2, 0, 0]);
    } else if (key === 'A7' || key === 'A8') {
      // Angular ear covers with long swept fins (A8: only the left one carries a scouter lens).
      for (const sx of key === 'A7' ? [-1, 1] : [1]) {
        const ear = new THREE.Group();
        ear.position.set(sx * r * 1.06, c - r * 0.15, -r * 0.05);
        head.add(ear);
        part(ear, new THREE.CylinderGeometry(r * 0.34, r * 0.38, r * 0.2, 6), second, [0, 0, 0], [0, 0, Math.PI / 2]);
        part(ear, new THREE.TorusGeometry(r * 0.24, r * 0.035, 4, 6), glow, [sx * r * 0.11, 0, 0], [0, Math.PI / 2, 0]);
        part(ear, new THREE.CylinderGeometry(r * 0.12, r * 0.12, r * 0.24, 6), metal, [0, 0, 0], [0, 0, Math.PI / 2]);
        if (key === 'A7') {
          // Long fin sweeping back and up past the head.
          const fin = new THREE.Group();
          fin.position.set(sx * r * 0.06, r * 0.15, -r * 0.15);
          fin.rotation.set(-2.2, sx * 0.12, 0);
          ear.add(fin);
          part(fin, taperBox(r * 0.07, r * 0.03, r * 1.1, r * 0.32), this.m.main);
          part(fin, new THREE.BoxGeometry(r * 0.08, r * 0.7, r * 0.05), glow, [0, -r * 0.45, r * 0.1]);
          part(ear, new THREE.CylinderGeometry(r * 0.02, r * 0.02, r * 0.55, 4), metal, [0, -r * 0.2, -r * 0.3], [0.5, 0, 0]); // antenna
        } else {
          // Scouter arm reaching forward to a holo lens over the left eye.
          const eye = facePoint(r, 0.4, -0.16, 0);
          const lensPos = V(eye.x, c + eye.y + r * 0.02, eye.z + r * 0.32);
          const earPos = V(sx * r * 1.12, c - r * 0.1, r * 0.05);
          piece(head, earPos, V(r * 0.95, c - r * 0.02, r * 0.95), r * 0.06, r * 0.05, r * 0.06, V(1, 0, 0), metal);
          piece(head, V(r * 0.95, c - r * 0.02, r * 0.95), V(lensPos.x + r * 0.22, lensPos.y, lensPos.z), r * 0.05, r * 0.05, r * 0.05, V(1, 0, 0), metal);
          const lens = mat(this.pal.accent, { emissive: this.pal.accent, emissiveIntensity: 0.8, rough: 0.2 });
          lens.transparent = true;
          lens.opacity = 0.45;
          lens.side = THREE.DoubleSide;
          lens.depthWrite = false;
          lens.userData.glow = true;
          part(head, new THREE.CircleGeometry(r * 0.24, 6), lens, [lensPos.x, lensPos.y, lensPos.z], [0, 0.35, 0], [1.1, 0.85, 1]);
          part(head, new THREE.TorusGeometry(r * 0.25, r * 0.02, 3, 6), glow, [lensPos.x, lensPos.y, lensPos.z], [0, 0.35, 0], [1.1, 0.85, 1]);
        }
      }
    } else if (key === 'A9') {
      // Stacked glowing clips on the right, a triangle clip on the left, and small ear fins.
      for (let k = 0; k < 3; k++)
        part(head, new THREE.BoxGeometry(r * 0.06, r * 0.32, r * 0.05), k === 1 ? glow : metal, [-r * (0.95 + k * 0.025), c + r * (0.35 - k * 0.12), r * (0.28 - k * 0.1)], [0.2, -0.4, -0.5]);
      part(head, new THREE.ConeGeometry(r * 0.12, r * 0.2, 3), glow, [r * 0.97, c + r * 0.35, r * 0.25], [0, 0, -1.2], [1, 1, 0.4]);
      for (const sx of [-1, 1]) {
        part(head, new THREE.BoxGeometry(r * 0.05, r * 0.4, r * 0.18), second, [sx * r * 1.06, c - r * 0.05, -r * 0.18], [-0.6, 0, sx * -0.25]);
        part(head, new THREE.BoxGeometry(r * 0.055, r * 0.25, r * 0.04), glow, [sx * r * 1.08, c - r * 0.02, -r * 0.12], [-0.6, 0, sx * -0.25]);
      }
    } else if (key === 'A6') {
      // Choker with a charm, and drop earrings.
      const { limb } = this.d;
      part(this.rig.joints.head, limbGeo(0.037 * limb, 0.037 * limb, 0.018 * s), dark, [0, this.d.headCenter * 0.35, 0]);
      part(this.rig.joints.head, new THREE.OctahedronGeometry(0.012 * s), metal, [0, this.d.headCenter * 0.35 - 0.025 * s, 0.035 * limb]);
      for (const sx of [-1, 1]) {
        part(head, new THREE.SphereGeometry(r * 0.06, 5, 4), metal, [sx * r * 0.95, c - r * 0.42, -r * 0.02]);
        part(head, new THREE.OctahedronGeometry(r * 0.09), accent, [sx * r * 0.95, c - r * 0.62, -r * 0.02], [0, 0, 0], [0.7, 1.4, 0.7]);
      }
    }
  }

  // ---------------------------------------------------------- sci-fi gear

  /** Glowing line from a to b (in parent space). */
  private gline(parent: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, w = 0.006, out = V(0, 0, 1)): void {
    piece(parent, a, b, w * this.d.s, w * this.d.s, w * this.d.s * 0.6, out, this.m.glow);
  }

  /** Radius of the outermost layer at the chest/waist back and front, for placing lines. */
  private shellDepth(): { chest: number; waist: number } {
    const { s } = this.d;
    const sw = this.d.shoulderW / s / 0.155;
    if (this.look.outfit === 'O1') return { chest: 0.158 * sw * s * 0.74, waist: 0.128 * s * 0.8 };
    return { chest: 0.142 * sw * s * 0.68, waist: 0.108 * s * 0.76 };
  }

  /** Extra thickness of the boot over the calf, per outfit. */
  private bootPad(): number {
    return ({ O1: 0.012, O3: 0.006, O4: 0.008, O5: 0.006 } as Record<string, number>)[this.look.outfit] ?? 0;
  }

  private buildTech(): void {
    if (this.glowLvl > 0) this.glowLines(this.glowLvl > 1);
    if (this.look.evo !== undefined) {
      this.buildEvolution(this.look.evo);
      return;
    }
    const { armor, back } = this.look;
    const lvl = ({ R1: 1, R2: 2, R3: 3 } as Record<string, number>)[armor] ?? 0;
    if (lvl >= 1) this.armorLight();
    if (lvl >= 2) this.armorMedium();
    if (lvl >= 3) this.armorHeavy();
    if (back !== 'B0') this.backTech(back);
  }

  /** Glow parts on armour: plain accent until the evolution lights the trim. */
  private get lit(): THREE.MeshStandardMaterial {
    return this.glowLvl > 0 ? this.m.glow : this.m.accent;
  }

  /** The outfit's armour evolution up to `stage` (EVOLUTIONS); each stage keeps the earlier parts. */
  private buildEvolution(stage: number): void {
    const o = this.look.outfit;
    if (o === 'O4') {
      if (stage >= 1) this.armorLight(true);
      if (stage >= 2) this.armorMedium();
      if (stage >= 3) {
        this.armorHeavy();
        this.shoulderPods(stage >= 4);
      }
      if (stage >= 4) this.hexShields();
    } else if (o === 'O1') {
      const hs = this.d.H / 1.68;
      const s = this.d.s;
      if (stage >= 1) this.drone(V(0.34 * s, 1.12 * hs, -0.14 * s), 0);
      if (stage >= 2) {
        this.drone(V(-0.34 * s, 0.95 * hs, -0.2 * s), 2.1);
        this.reticleGauntlet();
      }
      if (stage >= 3) this.ordnancePods();
      if (stage >= 4) this.finFunnels();
    } else if (o === 'O5') {
      if (stage >= 1) this.halo(stage >= 4 ? 3 : stage >= 3 ? 2 : 1);
      if (stage >= 2) this.armlets();
      if (stage >= 3) this.orbitRing();
      if (stage >= 4) this.seraphWings();
    }
    // The final stage breathes: every glow line pulses slowly.
    if (stage >= 4) {
      const g = this.m.glow;
      const base = g.emissiveIntensity;
      this.anim(g, (t) => (g.emissiveIntensity = base * (1.05 + 0.35 * Math.sin(t * 2.2))));
    }
  }

  private glowLines(circuit: boolean): void {
    const { s, neckRel, chestRel, fore, shin, limb, upper } = this.d;
    const j = this.rig.joints;
    const o = this.look.outfit;
    const sw = this.d.shoulderW / s / 0.155;
    const depth = this.shellDepth();

    // Boots: a line down the outer side.
    const pad = this.bootPad();
    if (pad > 0) {
      const [t0, t1] = o === 'O1' ? [0.76, 0.97] : [0.12, 0.92];
      for (const [knee, side] of [[j.kneeL, 1], [j.kneeR, -1]] as const) {
        const pts = [t0, (t0 + t1) / 2, t1].map((t) => V(side * (this.calfR(t) + pad * s + 0.003 * s), -shin * t, 0));
        for (let i = 0; i < 2; i++) this.gline(knee, pts[i], pts[i + 1], 0.006, V(side, 0, 0));
      }
    }
    // Cuffs.
    for (const el of [j.elbowL, j.elbowR]) {
      if (o === 'O5') part(el, new THREE.TorusGeometry(0.087 * limb, 0.004 * s, 4, 10), this.m.glow, [0, -fore * 0.84 - 0.008 * s, 0], [Math.PI / 2, 0, 0]);
      else part(el, new THREE.TorusGeometry((o === 'O1' ? 0.041 : 0.03) * limb, 0.0035 * s, 4, 10), this.m.glow, [0, -fore + (o === 'O1' ? 0.045 : 0.02) * s, 0], [Math.PI / 2, 0, 0]);
    }

    if (o === 'O1') {
      // Coat opening edges and the collar rim.
      const half = 0.55;
      for (const sx of [-1, 1]) {
        const at = (r: number, y: number, d: number, h = half) => V(sx * Math.sin(h) * r, y, Math.cos(h) * r * d + 0.003 * s);
        this.gline(j.chest, at(0.13 * s, 0, 0.74), at(0.158 * s * sw, neckRel * 0.6, 0.74), 0.006, V(0, 0, 1));
        this.gline(j.chest, at(0.158 * s * sw, neckRel * 0.6, 0.74), at(0.13 * s * sw, neckRel * 0.96, 0.74), 0.006, V(0, 0, 1));
        this.gline(j.spine, at(0.142 * s, 0, 0.8, half + 0.075), at(0.132 * s, chestRel, 0.8, half + 0.075), 0.006, V(0, 0, 1));
        // Shorts side seams.
        part(sx > 0 ? j.hipL : j.hipR, new THREE.BoxGeometry(0.004 * s, 0.06 * s, 0.012 * s), this.m.glow, [sx * 0.081 * limb, -0.02 * s, 0]);
      }
      part(j.chest, new THREE.TorusGeometry(0.084 * s, 0.003 * s, 4, 12, Math.PI * 1.3), this.m.glow, [0, neckRel * 1.02 + 0.035 * s, -0.01 * s], [Math.PI / 2, 0, Math.PI * 0.35 + Math.PI / 2]);
    } else if (o === 'O5') {
      // Collar rim, chest straps and the sash.
      part(j.head, new THREE.TorusGeometry(0.043 * limb, 0.003 * s, 4, 12), this.m.glow, [0, this.d.headCenter * 0.4, 0], [Math.PI / 2, 0, 0]);
      for (const sx of [-1, 1]) part(j.chest, new THREE.BoxGeometry(0.005 * s, neckRel * 0.7, 0.012 * s), this.m.glow, [sx * 0.05 * s, neckRel * 0.55, 0.103 * s], [0.15, 0, sx * 0.35]);
      part(j.spine, new THREE.TorusGeometry(0.116 * s, 0.003 * s, 4, 14), this.m.glow, [0, chestRel * 0.5, 0], [Math.PI / 2, 0, 0], [1, 0.78, 1]);
    }

    if (!circuit) return;
    // Circuit traces on the back and down the sleeves.
    const b = (x: number, y: number, d: number) => V(x, y, -Math.sqrt(Math.max(0, 1 - (x / (d / 0.7)) ** 2)) * d - 0.003 * s);
    const lines: [THREE.Object3D, THREE.Vector3, THREE.Vector3][] = [
      [j.spine, b(0, 0.01 * s, depth.waist), b(0, chestRel, depth.waist)],
      [j.chest, b(0, 0, depth.chest), b(0, neckRel * 0.45, depth.chest)],
      [j.chest, b(0, neckRel * 0.45, depth.chest), b(0.05 * s, neckRel * 0.6, depth.chest)],
      [j.chest, b(0, neckRel * 0.45, depth.chest), b(-0.05 * s, neckRel * 0.6, depth.chest)],
      [j.chest, b(0.05 * s, neckRel * 0.6, depth.chest), b(0.05 * s, neckRel * 0.85, depth.chest)],
      [j.chest, b(-0.05 * s, neckRel * 0.6, depth.chest), b(-0.05 * s, neckRel * 0.85, depth.chest)],
    ];
    for (const [p, a, c] of lines) this.gline(p, a, c, 0.005, V(0, 0, -1));
    for (const x of [-0.05, 0.05]) part(j.chest, new THREE.BoxGeometry(0.014 * s, 0.014 * s, 0.006 * s), this.m.glow, [x * s, neckRel * 0.85, b(x * s, 0, depth.chest).z]);
    // Sleeves: outer line on the upper arm.
    const ur = (o === 'O5' ? 0.04 : 0.042) * limb + 0.002 * s;
    if (o !== 'O5')
      for (const [sh, side] of [[j.shoulderL, 1], [j.shoulderR, -1]] as const) {
        this.gline(sh, V(side * ur, -upper * 0.15, 0), V(side * ur * 0.85, -upper * 0.85, 0), 0.005, V(side, 0, 0));
      }
    // Robe: lines down the front of the dress.
    if (o === 'O5') {
      for (const sx of [-1, 1]) this.gline(j.spine, V(sx * 0.03 * s, 0.01 * s, 0.083 * s), V(sx * 0.03 * s, chestRel * 0.4, 0.084 * s), 0.005);
    }
  }

  /** Shoulder guards and forearm bracers. */
  private armorLight(big = false): void {
    const { s, limb, fore } = this.d;
    const j = this.rig.joints;
    const plate = this.m.plate;
    for (const [sh, el, side] of [[j.shoulderL, j.elbowL, 1], [j.shoulderR, j.elbowR, -1]] as const) {
      const g = new THREE.Group();
      g.position.set(side * (big ? 0.02 : 0.012) * s, (big ? 0.012 : 0.006) * s, 0);
      g.rotation.z = side * -0.38;
      sh.add(g);
      const R = (big ? 0.09 : 0.072) * limb;
      part(g, new THREE.SphereGeometry(R, 9, 4, 0, Math.PI * 2, 0, Math.PI * 0.4), plate, [0, 0, 0], [0, 0, 0], [1.1, 0.75, 1.0]);
      part(g, new THREE.SphereGeometry(R * 1.08, 9, 2, 0, Math.PI * 2, Math.PI * 0.3, Math.PI * 0.17), doubleSided(this.m.main), [0, -0.012 * s, 0], [0, 0, 0], [1.1, 0.75, 1.0]);
      const rim = R * Math.sin(Math.PI * 0.4);
      part(g, new THREE.TorusGeometry(rim, 0.004 * s, 4, 14), this.lit, [0, R * Math.cos(Math.PI * 0.4) * 0.75, 0], [Math.PI / 2, 0, 0], [1.1, 1.0, 1]);
      if (big) {
        // Pauldrons: a second lame below the dome and a crest fin swept back over it.
        part(g, new THREE.SphereGeometry(R * 1.18, 9, 2, 0, Math.PI * 2, Math.PI * 0.36, Math.PI * 0.14), doubleSided(plate), [0, -0.03 * s, 0], [0, 0, 0], [1.1, 0.75, 1.0]);
        const crest = new THREE.Group();
        crest.position.set(side * R * 0.25, R * 0.62, -R * 0.1);
        crest.rotation.set(-0.55, 0, side * -0.25);
        g.add(crest);
        part(crest, taperBox(0.06 * s, 0.014 * s, 0.085 * s, 0.012 * s).rotateX(Math.PI), this.m.main);
        part(crest, new THREE.BoxGeometry(0.014 * s, 0.06 * s, 0.006 * s), this.lit, [0, 0.035 * s, -0.004 * s]);
      }
      if (this.look.outfit === 'O5') {
        // Wrist cuff below the bell sleeve.
        part(el, limbGeo(0.033 * limb, 0.031 * limb, fore * 0.13), plate, [0, -fore * 0.86, 0]);
        part(el, new THREE.TorusGeometry(0.033 * limb, 0.003 * s, 4, 10), this.lit, [0, -fore * 0.92, 0], [Math.PI / 2, 0, 0]);
      } else {
        const r0 = 0.047 * limb;
        part(el, limbGeo(r0, r0 * 0.95, fore * 0.32), plate, [0, -fore * 0.6, 0]);
        part(el, new THREE.BoxGeometry(0.01 * s, fore * 0.3, 0.036 * limb), this.m.main, [side * (r0 + 0.004 * s), -fore * 0.75, 0]);
        part(el, new THREE.BoxGeometry(0.004 * s, fore * 0.22, 0.008 * s), this.lit, [side * (r0 + 0.01 * s), -fore * 0.75, 0]);
      }
    }
  }

  /** Chest plate with a glowing core, and two front hip plates. */
  private armorMedium(): void {
    const { s, neckRel } = this.d;
    const j = this.rig.joints;
    const sw = this.d.shoulderW / s / 0.155;
    const arc = this.look.outfit === 'O1' ? 0.62 : 0.85;
    const pts = [
      [0.152 * sw * s, neckRel * 0.58],
      [0.158 * sw * s, neckRel * 0.78],
      [0.122 * sw * s, neckRel * 0.97],
    ].map(([r, y]) => new THREE.Vector2(r, y));
    const plateGeo = new THREE.LatheGeometry(pts, 6, -arc, arc * 2).scale(1, 1, 0.72);
    part(j.chest, plateGeo, doubleSided(this.m.plate));
    const coreZ = 0.158 * sw * s * 0.72 + 0.004 * s;
    part(j.chest, new THREE.CylinderGeometry(0.022 * s, 0.022 * s, 0.01 * s, 6), this.m.metal, [0, neckRel * 0.76, coreZ - 0.002 * s], [Math.PI / 2 - 0.25, 0, 0]);
    part(j.chest, new THREE.CylinderGeometry(0.014 * s, 0.014 * s, 0.012 * s, 6), this.m.glow, [0, neckRel * 0.76, coreZ], [Math.PI / 2 - 0.25, 0, 0]);
    for (const sx of [-1, 1]) this.gline(j.chest, V(sx * 0.03 * s, neckRel * 0.6, coreZ - 0.008 * s), V(sx * 0.08 * s, neckRel * 0.66, coreZ - 0.016 * s), 0.004);
    // Front hip plates: hinged, so the thighs push them out like the skirt.
    this.skirt({ y: 0.025 * this.d.s, rx: 0.175 * s, rz: 0.14 * s, len: 0.12 * s, count: 2, from: -0.32, to: 0.32, base: 0.32, mat: this.m.plate, matB: this.m.plate, t: 0.014 * s, trim: this.m.main, w: 0.07 * s });
  }

  /** Knee guards, shin plates and heel thrusters. */
  private armorHeavy(): void {
    const { s, limb, shin, ankle } = this.d;
    const j = this.rig.joints;
    const pad = this.bootPad() * s;
    for (const [knee, side] of [[j.kneeL, 1], [j.kneeR, -1]] as const) {
      const kz = this.calfR(0) + pad + 0.012 * s;
      part(knee, new THREE.BoxGeometry(0.07 * limb, 0.085 * s, 0.022 * s), this.m.plate, [0, 0.0, kz], [-0.12, 0, 0]);
      part(knee, new THREE.BoxGeometry(0.05 * limb, 0.03 * s, 0.024 * s), this.m.main, [0, 0.045 * s, kz - 0.004 * s], [-0.5, 0, 0]);
      part(knee, new THREE.SphereGeometry(0.008 * s, 6, 4), this.m.glow, [0, 0, kz + 0.012 * s]);
      const sz = this.calfR(0.45) + pad + 0.007 * s;
      part(knee, new THREE.BoxGeometry(0.052 * limb, shin * 0.36, 0.014 * s), this.m.plate, [0, -shin * 0.45, sz], [0.06, 0, 0]);
      part(knee, new THREE.BoxGeometry(0.004 * s, shin * 0.28, 0.006 * s), this.m.glow, [0, -shin * 0.45, sz + 0.009 * s], [0.06, 0, 0]);
      // Heel thruster with a glowing nozzle, and an ankle fin.
      const hy = -shin - ankle * 0.45;
      part(knee, new THREE.CylinderGeometry(0.018 * s, 0.024 * s, 0.035 * s, 7), this.m.metal, [0, hy, -0.05 * s], [-Math.PI / 2, 0, 0]);
      part(knee, new THREE.CircleGeometry(0.016 * s, 7), this.m.glow, [0, hy, -0.068 * s], [0, Math.PI, 0]);
      part(knee, new THREE.BoxGeometry(0.006 * s, 0.05 * s, 0.045 * s), this.m.plate, [side * (0.04 * s + pad), -shin * 0.9, -0.01 * s], [-0.5, 0, 0]);
    }
  }

  private backTech(kind: string): void {
    if (kind === 'B1' || kind === 'B4' || kind === 'B8') this.shoulderPods(kind !== 'B1');
    if (kind === 'B2') this.hoverBits();
    if (kind === 'B3' || kind === 'B8') this.halo(2);
    if (kind === 'B5') this.lightWings();
    if (kind === 'B6') this.finFunnels();
    if (kind === 'B7') this.gearHalo();
  }

  /** Pods above and behind the shoulders, clear of long hair and the arms; `blades` fans three thruster blades from each. */
  private shoulderPods(blades: boolean): void {
    const { s, shoulderRel } = this.d;
    const sw = this.d.shoulderW / s;
    for (const side of [1, -1]) {
      const pod = new THREE.Group();
      pod.position.set(side * (sw + 0.02 * s), shoulderRel + 0.075 * s, -0.075 * s);
      pod.rotation.set(0.25, side * 0.3, side * -0.2);
      this.rig.joints.chest.add(pod);
      part(pod, new THREE.BoxGeometry(0.06 * s, 0.09 * s, 0.1 * s), this.m.plate);
      part(pod, new THREE.BoxGeometry(0.064 * s, 0.025 * s, 0.104 * s), this.m.main, [0, -0.03 * s, 0]);
      part(pod, new THREE.BoxGeometry(0.05 * s, 0.012 * s, 0.03 * s), this.m.glow, [0, -0.046 * s, -0.03 * s]); // vent
      const fin = new THREE.Group();
      fin.position.set(side * 0.01 * s, 0.04 * s, -0.03 * s);
      fin.rotation.set(-0.7, 0, side * -0.25);
      pod.add(fin);
      part(fin, taperBox(0.012 * s, 0.006 * s, 0.13 * s, 0.05 * s).rotateX(Math.PI), this.m.main);
      part(fin, new THREE.BoxGeometry(0.014 * s, 0.09 * s, 0.006 * s), this.m.glow, [0, 0.06 * s, -0.02 * s]);
      if (!blades) continue;
      // Three thruster blades fanning out and back.
      for (let k = 0; k < 3; k++) {
        const blade = new THREE.Group();
        blade.position.set(side * 0.03 * s, -0.01 * s, -0.04 * s);
        // Fan from out-and-up to out-and-down, swept back.
        blade.rotation.set(0, side * (0.75 - k * 0.1), side * (2.1 - k * 0.48));
        pod.add(blade);
        const L = (0.3 - k * 0.04) * s;
        part(blade, taperBox(0.065 * s, 0.03 * s, L, 0.012 * s), k === 1 ? this.m.main : this.m.plate);
        part(blade, new THREE.BoxGeometry(0.008 * s, L * 0.7, 0.014 * s), this.m.glow, [0, -L * 0.45, 0]);
        part(blade, new THREE.CylinderGeometry(0.012 * s, 0.016 * s, 0.03 * s, 6), this.m.metal, [0, -L - 0.01 * s, 0]);
      }
    }
  }

  /** Four bits hovering behind the shoulders. */
  private hoverBits(): void {
    const { s } = this.d;
    const hs = this.d.H / 1.68;
    const spots: [number, number, number][] = [
      [0.36, 1.48, -0.22],
      [-0.36, 1.48, -0.22],
      [0.26, 1.2, -0.34],
      [-0.26, 1.2, -0.34],
    ];
    spots.forEach(([x, y, z], i) => {
      const bit = new THREE.Group();
      this.rig.root.add(bit);
      part(bit, new THREE.OctahedronGeometry(0.035 * s), this.m.plate, [0, 0, 0], [0, 0, 0], [0.8, 1.4, 0.8]);
      part(bit, new THREE.BoxGeometry(0.075 * s, 0.01 * s, 0.02 * s), this.m.main);
      part(bit, new THREE.SphereGeometry(0.012 * s, 6, 4), this.m.glow, [0, 0, 0.022 * s]);
      part(bit, new THREE.ConeGeometry(0.008 * s, 0.03 * s, 4), this.m.glow, [0, -0.06 * s, 0], [Math.PI, 0, 0]);
      this.hover(bit, V(x * s, y * hs, z * s), i * 1.7);
    });
  }

  /**
   * Halo behind the head. 1: a ring of light with two beads; 2: an outer ring
   * with four rune plates instead; 3: plus an inner mandala turning the other way.
   */
  private halo(level: number): void {
    const { neckRel, headCenter, r } = this.d;
    const halo = new THREE.Group();
    halo.position.set(0, neckRel + headCenter + r * 0.4, -r * 2.2);
    this.rig.joints.chest.add(halo);
    const ring = new THREE.Group();
    halo.add(ring);
    part(ring, new THREE.TorusGeometry(r * 1.75, r * 0.07, 4, 28), this.m.glow);
    if (level === 1) {
      for (const a of [0, Math.PI]) part(ring, new THREE.OctahedronGeometry(r * 0.16), this.m.metal, [Math.cos(a) * r * 1.75, Math.sin(a) * r * 1.75, 0], [0, 0, a], [1.6, 1, 0.6]);
    } else {
      part(ring, new THREE.TorusGeometry(r * 2.05, r * 0.035, 4, 28), this.m.metal);
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2;
        part(ring, new THREE.BoxGeometry(r * 0.16, r * 0.4, r * 0.1), this.m.plate, [Math.cos(a) * r * 1.9, Math.sin(a) * r * 1.9, 0], [0, 0, a - Math.PI / 2]);
      }
    }
    this.spinner(ring, 0.5);
    if (level < 3) return;
    // Mandala: an inner ring of petals and four long rays, turning against the outer ring.
    const inner = new THREE.Group();
    halo.add(inner);
    part(inner, new THREE.TorusGeometry(r * 1.2, r * 0.04, 4, 24), this.m.glow);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      part(inner, new THREE.ConeGeometry(r * 0.12, r * 0.34, 3), k % 2 ? this.m.metal : this.m.glow, [Math.cos(a) * r * 1.42, Math.sin(a) * r * 1.42, 0], [0, 0, a - Math.PI / 2], [1, 1, 0.4]);
    }
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      piece(inner, V(Math.cos(a) * r * 2.15, Math.sin(a) * r * 2.15, 0), V(Math.cos(a) * r * 2.85, Math.sin(a) * r * 2.85, 0), r * 0.14, 0.002, r * 0.05, V(0, 0, 1), this.m.glow);
    }
    this.spinner(inner, -0.3);
  }

  /** Gear halo: a toothed outer ring and a glowing inner ring turning against each other. */
  private gearHalo(): void {
    const { neckRel, headCenter, r } = this.d;
    const base = new THREE.Group();
    base.position.set(0, neckRel + headCenter + r * 0.3, -r * 2.3);
    this.rig.joints.chest.add(base);
    const outer = new THREE.Group();
    base.add(outer);
    part(outer, new THREE.TorusGeometry(r * 2.0, r * 0.09, 4, 32), this.m.plate);
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      part(outer, new THREE.BoxGeometry(r * 0.18, r * 0.22, r * 0.14), k % 4 ? this.m.plate : this.m.main, [Math.cos(a) * r * 2.18, Math.sin(a) * r * 2.18, 0], [0, 0, a]);
    }
    const inner = new THREE.Group();
    base.add(inner);
    part(inner, new THREE.TorusGeometry(r * 1.55, r * 0.05, 4, 28), this.m.glow);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      piece(inner, V(Math.cos(a) * r * 1.55, Math.sin(a) * r * 1.55, 0), V(Math.cos(a) * r * 1.95, Math.sin(a) * r * 1.95, 0), r * 0.08, r * 0.08, r * 0.06, V(0, 0, 1), this.m.metal);
    }
    part(inner, new THREE.OctahedronGeometry(r * 0.16), this.m.glow, [0, r * 1.55, 0]);
    this.spinner(outer, 0.25);
    this.spinner(inner, -0.6);
  }

  /** Wings of light: translucent blades fanning from two emitters, gently beating. */
  private lightWings(): void {
    const { s, shoulderRel } = this.d;
    const sw = this.d.shoulderW / s;
    const light = this.lightMat(0.5);
    for (const side of [1, -1]) {
      const root = new THREE.Group();
      root.position.set(side * (sw - 0.01 * s), shoulderRel + 0.05 * s, -0.09 * s);
      this.rig.joints.chest.add(root);
      part(root, new THREE.BoxGeometry(0.04 * s, 0.05 * s, 0.03 * s), this.m.plate);
      part(root, new THREE.SphereGeometry(0.016 * s, 6, 4), this.m.glow, [0, 0, -0.018 * s]);
      const wing = new THREE.Group();
      wing.position.z = -0.02 * s;
      root.add(wing);
      for (let k = 0; k < 4; k++) {
        const f = new THREE.Group();
        f.rotation.set(0, side * (0.85 - k * 0.08), side * (2.35 - k * 0.42));
        wing.add(f);
        const L = (0.55 - k * 0.07) * s;
        part(f, taperBox(0.075 * s, 0.012 * s, L, 0.004 * s), light);
        part(f, new THREE.BoxGeometry(0.006 * s, L * 0.85, 0.006 * s), this.m.glow, [0, -L * 0.45, 0]);
      }
      this.anim(wing, (t) => (wing.rotation.y = side * 0.18 * Math.sin(t * 1.6)));
    }
  }

  /** Translucent photon material in the glow colour. */
  private lightMat(opacity: number): THREE.MeshStandardMaterial {
    const light = mat(this.pal.accent, { emissive: this.pal.accent, emissiveIntensity: 0.9, rough: 0.3 });
    light.transparent = true;
    light.opacity = opacity;
    light.depthWrite = false;
    light.side = THREE.DoubleSide;
    light.userData.glow = true;
    return light;
  }

  /**
   * Halo seraph wings: four long leaf-shaped feathers of light per side, swept
   * back from the shoulder blades (clear of the Mag above the shoulders), slowly beating.
   */
  private seraphWings(): void {
    const { s, shoulderRel } = this.d;
    const sw = this.d.shoulderW / s;
    const light = this.lightMat(0.32);
    for (const side of [1, -1]) {
      const root = new THREE.Group();
      root.position.set(side * sw * 0.55, shoulderRel - 0.03 * s, -0.15 * s);
      this.rig.joints.chest.add(root);
      part(root, new THREE.OctahedronGeometry(0.018 * s), this.m.glow, [0, 0, 0], [0, 0, 0], [1, 1.4, 1]);
      const wing = new THREE.Group();
      root.add(wing);
      const fan: [number, number][] = [[2.25, 0.48], [1.8, 0.58], [1.35, 0.62], [0.9, 0.52]];
      fan.forEach(([ang, len], k) => {
        const f = new THREE.Group();
        f.rotation.set(0, side * (0.95 - k * 0.05), side * ang);
        wing.add(f);
        const L = len * s;
        // Leaf: narrow at the root, widest at 40%, pointed tip.
        part(f, taperBox(0.012 * s, 0.075 * s, L * 0.4, 0.004 * s), light);
        part(f, taperBox(0.075 * s, 0.004 * s, L * 0.6, 0.004 * s), light, [0, -L * 0.4, 0]);
        part(f, new THREE.BoxGeometry(0.005 * s, L * 0.9, 0.006 * s), this.m.glow, [0, -L * 0.45, 0]);
      });
      this.anim(wing, (t) => (wing.rotation.y = side * 0.12 * Math.sin(t * 1.3)));
    }
  }

  /** Fin funnels: six blades floating in two V formations behind her. */
  private finFunnels(): void {
    const { s } = this.d;
    const hs = this.d.H / 1.68;
    for (const side of [1, -1])
      for (let k = 0; k < 3; k++) {
        const fin = new THREE.Group();
        fin.rotation.set(0.2, side * 0.35, side * (0.45 + k * 0.32));
        this.rig.root.add(fin);
        const L = (0.3 - k * 0.03) * s;
        part(fin, taperBox(0.05 * s, 0.014 * s, L, 0.014 * s).translate(0, L / 2, 0), this.m.plate);
        part(fin, new THREE.BoxGeometry(0.008 * s, L * 0.7, 0.018 * s), this.m.glow, [0, 0.02 * s, 0]);
        part(fin, new THREE.CylinderGeometry(0.01 * s, 0.014 * s, 0.025 * s, 6), this.m.metal, [0, L / 2 + 0.01 * s, 0]);
        part(fin, new THREE.ConeGeometry(0.009 * s, 0.04 * s, 5), this.m.glow, [0, L / 2 + 0.04 * s, 0]);
        this.hover(fin, V(side * (0.27 + k * 0.12) * s, (1.3 + k * 0.06) * hs, (-0.3 - k * 0.04) * s), k * 1.1 + (side > 0 ? 0 : 0.6), false);
      }
  }

  // ---------------------------------------------------------- evolution parts

  /** Halo armlets: two rings of light floating round each upper arm, wobbling as they turn. */
  private armlets(): void {
    const { s, limb, upper } = this.d;
    const j = this.rig.joints;
    for (const [sh, side] of [[j.shoulderL, 1], [j.shoulderR, -1]] as const) {
      [0.32, 0.68].forEach((f, k) => {
        const tilt = new THREE.Group();
        sh.add(tilt);
        const spin = new THREE.Group();
        tilt.add(spin);
        const R = (0.078 - k * 0.008) * limb;
        part(spin, new THREE.TorusGeometry(R, 0.0045 * s, 4, 20), this.m.glow, [0, 0, 0], [Math.PI / 2, 0, 0]);
        for (let b = 0; b < 3; b++) {
          const a = (b / 3) * Math.PI * 2;
          part(spin, new THREE.OctahedronGeometry(0.009 * s), this.m.metal, [Math.cos(a) * R, 0, Math.sin(a) * R], [0, 0, 0], [1, 1.6, 1]);
        }
        const y0 = -upper * f;
        const ph = k * 1.9 + (side > 0 ? 0 : 0.8);
        this.anim(tilt, (t) => {
          tilt.position.set(0, y0 + Math.sin(t * 1.5 + ph) * 0.008 * s, 0);
          tilt.rotation.set(0.25 * Math.sin(t * 0.9 + ph), 0, 0.25 * Math.cos(t * 0.9 + ph));
        });
        this.spinAxis(spin, k ? -0.9 : 0.7);
      });
    }
  }

  /** Halo orbit: a tilted ring of light round the hips with three crystals riding it. */
  private orbitRing(): void {
    const { s } = this.d;
    const tilt = new THREE.Group();
    this.rig.joints.hips.add(tilt);
    const spin = new THREE.Group();
    tilt.add(spin);
    const R = 0.27 * s;
    part(tilt, new THREE.TorusGeometry(R, 0.005 * s, 4, 44), this.m.glow, [0, 0, 0], [Math.PI / 2, 0, 0]);
    part(tilt, new THREE.TorusGeometry(R * 1.05, 0.0025 * s, 3, 44), this.m.metal, [0, 0, 0], [Math.PI / 2, 0, 0]);
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2;
      part(spin, new THREE.OctahedronGeometry(0.02 * s), this.m.glow, [Math.cos(a) * R, 0, Math.sin(a) * R], [0, 0, 0], [0.7, 1.7, 0.7]);
    }
    this.anim(tilt, (t) => {
      tilt.position.y = -0.02 * s + Math.sin(t * 1.2) * 0.012 * s;
      tilt.rotation.set(0.14 + 0.05 * Math.sin(t * 0.7), 0, 0.1 * Math.cos(t * 0.7));
    });
    this.spinAxis(spin, 0.6);
  }

  /** Vanguard: two hex photon shields hovering at her sides. */
  private hexShields(): void {
    const { s } = this.d;
    const hs = this.d.H / 1.68;
    const pane = mat(this.pal.accent, { emissive: this.pal.accent, emissiveIntensity: 0.6, rough: 0.3 });
    pane.transparent = true;
    pane.opacity = 0.28;
    pane.depthWrite = false;
    pane.side = THREE.DoubleSide;
    pane.userData.glow = true;
    const R = 0.13 * s;
    for (const side of [1, -1]) {
      const sh = new THREE.Group();
      sh.rotation.y = side * 0.6; // face forward and out
      this.rig.root.add(sh);
      part(sh, new THREE.CylinderGeometry(R, R, 0.006 * s, 6), pane, [0, 0, 0], [Math.PI / 2, 0, 0]);
      part(sh, new THREE.TorusGeometry(R, 0.006 * s, 3, 6), this.m.glow, [0, 0, 0], [0, 0, Math.PI / 6]);
      part(sh, new THREE.TorusGeometry(R * 0.42, 0.004 * s, 3, 6), this.m.glow, [0, 0, 0], [0, 0, Math.PI / 6]);
      // Clamps on alternate corners.
      for (let k = 0; k < 3; k++) {
        const a = Math.PI / 2 + (k / 3) * Math.PI * 2;
        part(sh, new THREE.BoxGeometry(0.035 * s, 0.035 * s, 0.014 * s), this.m.plate, [Math.cos(a) * R, Math.sin(a) * R, 0], [0, 0, a]);
      }
      this.hover(sh, V(side * 0.37 * s, 1.02 * hs, -0.02 * s), side > 0 ? 0 : 1.4);
    }
  }

  /** Overwatch: a support drone hovering at `base` (model space). */
  private drone(base: THREE.Vector3, phase: number): void {
    const { s } = this.d;
    const g = new THREE.Group();
    g.scale.setScalar(1.4);
    this.rig.root.add(g);
    part(g, new THREE.SphereGeometry(0.042 * s, 9, 6), this.m.plate, [0, 0, 0], [0, 0, 0], [1, 0.78, 1.15]);
    part(g, new THREE.TorusGeometry(0.045 * s, 0.007 * s, 4, 14), this.m.main, [0, 0, 0], [Math.PI / 2, 0, 0], [1, 1.15, 1]);
    part(g, new THREE.CylinderGeometry(0.017 * s, 0.021 * s, 0.022 * s, 8), this.m.dark, [0, 0.002 * s, 0.045 * s], [Math.PI / 2, 0, 0]);
    part(g, new THREE.CircleGeometry(0.013 * s, 8), this.m.glow, [0, 0.002 * s, 0.0565 * s]);
    for (const sx of [-1, 1]) {
      const fin = new THREE.Group();
      fin.position.set(sx * 0.04 * s, 0, -0.012 * s);
      fin.rotation.z = sx * 1.25;
      g.add(fin);
      part(fin, taperBox(0.034 * s, 0.012 * s, 0.055 * s, 0.006 * s), this.m.main);
      part(fin, new THREE.BoxGeometry(0.004 * s, 0.04 * s, 0.008 * s), this.lit, [0, -0.025 * s, 0]);
    }
    part(g, new THREE.ConeGeometry(0.011 * s, 0.03 * s, 6), this.m.glow, [0, -0.046 * s, 0], [Math.PI, 0, 0]);
    part(g, new THREE.CylinderGeometry(0.002 * s, 0.002 * s, 0.05 * s, 4), this.m.metal, [0.012 * s, 0.055 * s, -0.01 * s], [-0.3, 0, -0.2]);
    this.hover(g, base, phase);
  }

  /** Overwatch: a slim bracer on the left forearm with a holo reticle turning off the wrist. */
  private reticleGauntlet(): void {
    const { s, limb, fore } = this.d;
    const el = this.rig.joints.elbowL;
    const r0 = 0.047 * limb;
    part(el, limbGeo(r0, r0 * 0.94, fore * 0.34), this.m.plate, [0, -fore * 0.5, 0]);
    part(el, new THREE.BoxGeometry(0.006 * s, fore * 0.26, 0.012 * s), this.lit, [r0 + 0.002 * s, -fore * 0.66, 0]);
    const ret = new THREE.Group();
    ret.position.set(r0 + 0.045 * s, -fore * 0.64, 0.005 * s);
    ret.rotation.y = Math.PI / 2; // faces out from the arm
    el.add(ret);
    const spin = new THREE.Group();
    ret.add(spin);
    const R = 0.034 * s;
    part(spin, new THREE.TorusGeometry(R, 0.0025 * s, 3, 22), this.m.glow);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2;
      part(spin, new THREE.BoxGeometry(0.004 * s, 0.016 * s, 0.003 * s), this.m.glow, [Math.cos(a) * R * 0.78, Math.sin(a) * R * 0.78, 0], [0, 0, a - Math.PI / 2]);
    }
    part(ret, new THREE.OctahedronGeometry(0.005 * s), this.m.glow);
    this.spinner(spin, 0.8);
  }

  /** Overwatch: a sensor pod with a sweeping dish (left) and a missile pod (right) over the shoulders. */
  private ordnancePods(): void {
    const { s, shoulderRel } = this.d;
    const sw = this.d.shoulderW / s;
    for (const side of [1, -1]) {
      const pod = new THREE.Group();
      pod.position.set(side * (sw + 0.025 * s), shoulderRel + 0.085 * s, -0.08 * s);
      pod.rotation.set(0.15, side * 0.25, side * -0.15);
      this.rig.joints.chest.add(pod);
      if (side > 0) {
        part(pod, new THREE.BoxGeometry(0.06 * s, 0.07 * s, 0.09 * s), this.m.plate);
        part(pod, new THREE.BoxGeometry(0.064 * s, 0.02 * s, 0.094 * s), this.m.main, [0, -0.025 * s, 0]);
        part(pod, new THREE.BoxGeometry(0.004 * s, 0.03 * s, 0.05 * s), this.m.glow, [side * 0.032 * s, 0.008 * s, 0]);
        const dish = new THREE.Group();
        dish.position.set(0, 0.05 * s, -0.005 * s);
        pod.add(dish);
        part(dish, new THREE.CylinderGeometry(0.006 * s, 0.006 * s, 0.03 * s, 5), this.m.metal);
        const cup = new THREE.Group();
        cup.position.y = 0.02 * s;
        cup.rotation.x = 1.0; // faces forward and up
        dish.add(cup);
        part(cup, new THREE.CylinderGeometry(0.045 * s, 0.012 * s, 0.014 * s, 12, 1, true), doubleSided(this.m.plate));
        part(cup, new THREE.SphereGeometry(0.007 * s, 5, 4), this.m.glow, [0, 0.01 * s, 0]);
        part(cup, new THREE.CylinderGeometry(0.002 * s, 0.002 * s, 0.03 * s, 4), this.m.metal, [0, 0.012 * s, 0]);
        this.anim(dish, (t) => (dish.rotation.y = Math.sin(t * 0.8) * 1.1));
        // Antenna whip behind.
        part(pod, new THREE.CylinderGeometry(0.0025 * s, 0.0025 * s, 0.16 * s, 4), this.m.metal, [-0.018 * s, 0.1 * s, -0.04 * s], [-0.35, 0, 0]);
        part(pod, new THREE.SphereGeometry(0.007 * s, 5, 4), this.m.glow, [-0.018 * s, 0.175 * s, -0.068 * s]);
      } else {
        part(pod, new THREE.BoxGeometry(0.07 * s, 0.075 * s, 0.11 * s), this.m.plate);
        part(pod, new THREE.BoxGeometry(0.074 * s, 0.018 * s, 0.114 * s), this.m.main, [0, 0.03 * s, 0]);
        part(pod, new THREE.BoxGeometry(0.062 * s, 0.052 * s, 0.004 * s), this.m.dark, [0, -0.008 * s, 0.056 * s]);
        for (let i = 0; i < 2; i++)
          for (let k = 0; k < 2; k++)
            part(pod, new THREE.CylinderGeometry(0.009 * s, 0.009 * s, 0.006 * s, 6), this.m.glow, [(-0.015 + i * 0.03) * s, (-0.02 + k * 0.024) * s, 0.058 * s], [Math.PI / 2, 0, 0]);
        part(pod, new THREE.BoxGeometry(0.05 * s, 0.01 * s, 0.03 * s), this.m.glow, [0, -0.04 * s, -0.035 * s]); // exhaust
      }
    }
  }

  /** A part that hovers around a base position, drifting and turning a little. */
  private hover(obj: THREE.Object3D, base: THREE.Vector3, phase: number, sway = true): void {
    obj.position.copy(base);
    const ry = obj.rotation.y;
    this.anim(obj, (t) => {
      obj.position.copy(base);
      obj.position.y += Math.sin(t * 1.8 + phase) * 0.018;
      obj.position.x += Math.sin(t * 0.9 + phase) * 0.012;
      if (sway) obj.rotation.y = ry + Math.sin(t * 0.7 + phase) * 0.4;
    });
  }

  private spinner(obj: THREE.Object3D, speed: number): void {
    this.anim(obj, (_t, dt) => (obj.rotation.z += speed * dt));
  }

  /** Turn about the part's own y axis (rings lying flat). */
  private spinAxis(obj: THREE.Object3D, speed: number): void {
    this.anim(obj, (_t, dt) => (obj.rotation.y += speed * dt));
  }

  private anim(obj: object, tick: (t: number, dt: number) => void): void {
    this.floaters.push({ obj, tick });
  }

  /** Animate hovering / spinning parts. */
  private updateFloaters(dt: number): void {
    this.time += dt;
    for (const f of this.floaters) f.tick(this.time, dt);
  }

  // ---------------------------------------------------------- face gear

  private buildFace(key: string): void {
    if (key === 'F0') return;
    const { r, headCenter: c } = this.d;
    const head = this.rig.joints.head;
    const { glow, metal, dark, plate } = this.m;
    const eyeY = c - r * 0.17;
    // Bands round the eyes are wider than the head so they sit over the side hair.
    const bandScale: [number, number, number] = [1.13, 1, 1.07];
    const holo = () => {
      const m = mat(this.pal.accent, { emissive: this.pal.accent, emissiveIntensity: 0.8, rough: 0.2 });
      m.transparent = true;
      m.opacity = 0.45;
      m.depthWrite = false;
      m.side = THREE.DoubleSide;
      m.userData.glow = true;
      return m;
    };
    if (key === 'F1') {
      // Blindfold: dark band with a glowing seam, knotted at the back with two fluttering tails.
      const cloth = doubleSided(dark);
      part(head, new THREE.CylinderGeometry(r * 1.07, r * 1.03, r * 0.44, 18, 1, true), cloth, [0, eyeY, 0], [-0.06, 0, 0], bandScale);
      part(head, new THREE.TorusGeometry(r * 1.075, r * 0.012, 3, 28), glow, [0, eyeY, 0], [Math.PI / 2 - 0.06, 0, 0], [1.13, 1.07, 1]);
      part(head, new THREE.SphereGeometry(r * 0.13, 6, 4), cloth, [0, eyeY, -r * 1.15], [0, 0, 0], [1.3, 1, 0.8]);
      for (const sx of [-1, 1]) {
        const root = new THREE.Group();
        root.position.set(sx * r * 0.06, eyeY - r * 0.05, -r * 1.18);
        head.add(root);
        const chain = new Chain(root, 50, 4, 0.12);
        this.chains.push(chain);
        const g1 = new THREE.Group();
        root.add(g1);
        const g2 = new THREE.Group();
        g2.position.y = -r * 1.3;
        g1.add(g2);
        chain.add(g1, [0.25, 1.5], sx > 0 ? [0.05, 0.6] : [-0.6, -0.05]);
        chain.add(g2, [0.2, 1.5], [-0.5, 0.5]);
        piece(g1, V(0, 0, 0), V(0, -r * 1.3, 0), r * 0.16, r * 0.15, r * 0.03, V(0, 0, -1), cloth);
        piece(g2, V(0, 0, 0), V(0, -r * 1.2, 0), r * 0.15, r * 0.2, r * 0.03, V(0, 0, -1), cloth);
        part(g2, new THREE.BoxGeometry(r * 0.2, r * 0.03, r * 0.035), glow, [0, -r * 1.15, 0]);
      }
    } else if (key === 'F2' || key === 'F3') {
      // Wraparound visor: translucent holo glass (F2) or opaque with a glowing slit (F3).
      const arc = 1.35;
      const visor = new THREE.Group();
      visor.position.set(0, eyeY, 0);
      visor.rotation.x = -0.06;
      head.add(visor);
      part(visor, new THREE.CylinderGeometry(r * 1.1, r * 1.07, r * 0.46, 16, 1, true, -arc, arc * 2), key === 'F2' ? holo() : doubleSided(dark), [0, 0, 0], [0, 0, 0], bandScale);
      for (const y of [-0.23, 0.23]) part(visor, new THREE.CylinderGeometry(r * 1.11, r * 1.11, r * 0.035, 16, 1, true, -arc, arc * 2), doubleSided(metal), [0, y * r, 0], [0, 0, 0], bandScale);
      if (key === 'F3') part(visor, new THREE.CylinderGeometry(r * 1.115, r * 1.115, r * 0.04, 16, 1, true, -1.0, 2.0), doubleSided(glow), [0, r * 0.01, 0], [0, 0, 0], bandScale);
      for (const sx of [-1, 1]) {
        const x = sx * Math.sin(arc) * r * 1.1 * bandScale[0];
        const z = Math.cos(arc) * r * 1.1 * bandScale[2];
        part(visor, new THREE.CylinderGeometry(r * 0.17, r * 0.17, r * 0.12, 8), plate, [x, 0, z], [0, 0, Math.PI / 2]);
        part(visor, new THREE.CylinderGeometry(r * 0.09, r * 0.09, r * 0.13, 8), glow, [x, 0, z], [0, 0, Math.PI / 2]);
      }
    } else if (key === 'F4') {
      // Half mask over the nose and mouth with glowing vents.
      const mask = new THREE.Group();
      mask.position.set(0, c - r * 0.92, r * 0.06);
      head.add(mask);
      part(mask, new THREE.CylinderGeometry(r * 1.0, r * 0.62, r * 0.95, 14, 1, true, -1.3, 2.6), doubleSided(plate));
      part(mask, new THREE.BoxGeometry(r * 0.08, r * 0.9, r * 0.1), this.m.main, [0, 0, r * 0.83], [0.32, 0, 0]);
      for (const sx of [-1, 1]) {
        for (let k = 0; k < 3; k++) part(mask, new THREE.BoxGeometry(r * 0.24, r * 0.035, r * 0.04), glow, [sx * r * 0.52, -r * (0.05 + k * 0.12), r * 0.62], [0.3, sx * 0.75, 0]);
        part(mask, new THREE.CylinderGeometry(r * 0.15, r * 0.15, r * 0.1, 8), metal, [sx * r * 0.92, r * 0.25, r * 0.15], [0, 0, Math.PI / 2]);
      }
    } else if (key === 'F5') {
      // Glowing face markings: two strokes under each eye and a dot at the outer corner.
      for (const sx of [-1, 1]) {
        for (const [y0, y1, x0, x1] of [[-0.42, -0.58, 0.36, 0.46], [-0.44, -0.62, 0.5, 0.58]] as const) {
          const a = facePoint(r, sx * x0, y0, r * 0.015).add(V(0, c, 0));
          const b = facePoint(r, sx * x1, y1, r * 0.015).add(V(0, c, 0));
          piece(head, a, b, r * 0.035, r * 0.01, r * 0.012, a.clone().sub(V(0, c, 0)).normalize(), glow);
        }
        const dot = facePoint(r, sx * 0.66, -0.08, r * 0.012).add(V(0, c, 0));
        part(head, new THREE.OctahedronGeometry(r * 0.035), glow, [dot.x, dot.y, dot.z]);
      }
    } else if (key === 'F6') {
      // Lens goggles over the eyes, on a strap.
      part(head, new THREE.CylinderGeometry(r * 1.07, r * 1.06, r * 0.1, 18, 1, true), doubleSided(dark), [0, eyeY, 0], [-0.06, 0, 0], bandScale);
      const lens = holo();
      const centers: THREE.Vector3[] = [];
      for (const sx of [-1, 1]) {
        const p = facePoint(r, sx * 0.4, -0.16, r * 0.16);
        const at = V(p.x, c + p.y, p.z);
        centers.push(at);
        const g = new THREE.Group();
        g.position.copy(at);
        g.rotation.set(0.04, sx * 0.42, 0);
        head.add(g);
        part(g, new THREE.CylinderGeometry(r * 0.28, r * 0.3, r * 0.16, 10, 1, true), doubleSided(metal), [0, 0, -r * 0.06], [Math.PI / 2, 0, 0]);
        part(g, new THREE.CircleGeometry(r * 0.27, 10), lens, [0, 0, 0.002]);
        part(g, new THREE.TorusGeometry(r * 0.28, r * 0.03, 4, 12), glow, [0, 0, 0.004]);
        part(g, new THREE.BoxGeometry(r * 0.2, r * 0.08, r * 0.08), dark, [sx * r * 0.32, 0, -r * 0.1]);
      }
      piece(head, centers[0].clone().add(V(r * 0.26, 0, -r * 0.02)), centers[1].clone().add(V(-r * 0.26, 0, -r * 0.02)), r * 0.06, r * 0.06, r * 0.05, V(0, 0, 1), metal);
    }
  }

  // ---------------------------------------------------------- outfits

  private buildOutfit(key: string): void {
    const m = this.m;
    const j = this.rig.joints;
    const { s, limb, neckRel, chestRel, thigh } = this.d;
    if (key === 'O1') {
      // Open long coat over a turtleneck knit, short shorts, ankle boots.
      this.torso(m.legwear, m.second, m.second);
      this.arms(m.main, m.main, m.skin);
      this.legsGeo(m.skin, m.skin);
      this.shoes('ankle');
      for (const hip of [j.hipL, j.hipR]) part(hip, limbGeo(0.08 * limb, 0.077 * limb, 0.07 * s), m.legwear, [0, 0.01, 0]); // shorts legs
      // Turtleneck with ribbing.
      part(j.head, limbGeo(0.05 * limb, 0.056 * limb, this.d.headCenter * 0.3).translate(0, this.d.headCenter * 0.3, 0), m.second);
      part(j.head, limbGeo(0.058 * limb, 0.06 * limb, this.d.headCenter * 0.12).translate(0, this.d.headCenter * 0.12, 0), shadeMat(m.second, 0.9)); // fold
      // Cable-knit hint down the front.
      for (const sx of [-1, 1]) part(j.chest, new THREE.BoxGeometry(0.012 * s, neckRel * 0.8, 0.01 * s), shadeMat(m.second, 0.82), [sx * 0.022 * s, neckRel * 0.45, 0.1 * s]);
      // Pendant on a long chain.
      part(j.chest, new THREE.TorusGeometry(0.018 * s, 0.004 * s, 4, 10), m.metal, [0, neckRel * 0.25, 0.115 * s]);
      part(j.chest, new THREE.BoxGeometry(0.003 * s, neckRel * 0.6, 0.003 * s), m.metal, [0.025 * s, neckRel * 0.58, 0.11 * s], [0, 0, 0.12]);
      part(j.chest, new THREE.BoxGeometry(0.003 * s, neckRel * 0.6, 0.003 * s), m.metal, [-0.025 * s, neckRel * 0.58, 0.11 * s], [0, 0, -0.12]);
      // Coat body: an open shell on chest, waist and hips.
      const gap = 1.1;
      const coat = doubleSided(m.main);
      const sw = this.d.shoulderW / s / 0.155;
      part(j.chest, shellGeo([[0.13 * s, -0.01 * s], [0.145 * s, neckRel * 0.3], [0.158 * s * sw, neckRel * 0.6], [0.164 * s * sw, neckRel * 0.8], [0.13 * s * sw, neckRel * 0.96], [0.07 * s, neckRel * 1.06]], 0.74, gap), coat);
      part(j.spine, shellGeo([[0.142 * s, -0.01 * s], [0.128 * s, chestRel * 0.55], [0.132 * s, chestRel + 0.01 * s]], 0.8, gap + 0.15), coat);
      part(j.hips, shellGeo([[0.168 * s, 0.0], [0.155 * s, 0.05 * s], [0.142 * s, 0.09 * s]], 0.8, gap + 0.25), coat);
      // Lapels and buttons along the opening.
      for (const sx of [-1, 1]) {
        part(j.chest, new THREE.BoxGeometry(0.045 * s, neckRel * 0.75, 0.012 * s), m.mainDark, [sx * 0.075 * s, neckRel * 0.6, 0.105 * s], [0.12, sx * 0.5, sx * -0.25]);
        for (let i = 0; i < 2; i++) part(j.spine, new THREE.SphereGeometry(0.009 * s, 5, 3), m.accent, [sx * 0.07 * s, chestRel * (0.25 + i * 0.45), 0.098 * s]);
        // Pocket flaps.
        part(j.hips, new THREE.BoxGeometry(0.07 * s, 0.012 * s, 0.03 * s), m.mainDark, [sx * 0.135 * s, -0.04 * s, 0.07 * s], [0, sx * 0.9, 0]);
      }
      // Coat collar standing up at the back of the neck.
      part(j.chest, new THREE.CylinderGeometry(0.075 * s, 0.085 * s, 0.07 * s, 9, 1, true, Math.PI * 0.35, Math.PI * 1.3), coat, [0, neckRel * 1.02, -0.01 * s]);
      // Sleeve cuffs.
      for (const el of [j.elbowL, j.elbowR]) part(el, limbGeo(0.036 * limb, 0.04 * limb, 0.05 * s), m.mainDark, [0, -this.d.fore + 0.05 * s, 0]);
      // Coat skirt to mid-thigh, open at the front.
      this.skirt({ y: 0.0, rx: 0.17 * s, rz: 0.135 * s, len: 0.13 * s + thigh * 0.5, count: 10, from: 0.6, to: Math.PI * 2 - 0.6, base: 0.08, mat: coat, matB: coat, t: 0.012 * s, trim: m.mainDark });
    } else if (key === 'O2') {
      // Puff-sleeve blouse, bow, high-waisted pleated skirt, thigh-high stockings.
      this.torso(m.main, m.main, m.second);
      this.arms(m.skin, m.skin, m.skin, m.second);
      this.legsGeo(m.skin, m.legwear, 0.62, shadeMat(m.legwear, 1.4));
      this.shoes('maryjane');
      for (const sh of [j.shoulderL, j.shoulderR]) {
        part(sh, new THREE.SphereGeometry(0.07 * limb, 8, 6), m.second, [0, -0.045 * s, 0], [0, 0, 0], [1, 1.15, 1]);
        part(sh, limbGeo(0.058 * limb, 0.058 * limb, 0.014 * s), m.accent, [0, -0.11 * s, 0]);
      }
      // Round collar flaps and a bow.
      for (const sx of [-1, 1]) part(j.chest, new THREE.CylinderGeometry(0.04 * s, 0.04 * s, 0.006 * s, 8, 1, false, 0, Math.PI), m.second, [sx * 0.03 * s, neckRel * 0.95, 0.055 * s], [-1.1, sx * 0.4, 0]);
      const bow = new THREE.Group();
      bow.position.set(0, neckRel * 0.86, 0.085 * s);
      j.chest.add(bow);
      for (const sx of [-1, 1]) {
        part(bow, new THREE.ConeGeometry(0.022 * s, 0.045 * s, 4), m.accent, [sx * 0.022 * s, 0, 0], [0, 0, sx * Math.PI / 2], [1, 1, 0.4]);
        part(bow, new THREE.BoxGeometry(0.014 * s, 0.06 * s, 0.004 * s), m.accent, [sx * 0.01 * s, -0.035 * s, 0.002], [0, 0, sx * 0.25]);
      }
      part(bow, new THREE.SphereGeometry(0.01 * s, 5, 4), m.accent);
      // Buttons and a frilled placket.
      for (let i = 0; i < 3; i++) part(j.chest, new THREE.SphereGeometry(0.006 * s, 5, 3), m.mainDark, [0, neckRel * (0.2 + i * 0.17), 0.108 * s]);
      // High corset waist with lacing.
      part(j.spine, shellGeo([[0.128 * s, -0.01 * s], [0.112 * s, chestRel * 0.55], [0.124 * s, chestRel + 0.025 * s]], 0.78), m.main);
      for (let i = 0; i < 3; i++) part(j.spine, new THREE.BoxGeometry(0.04 * s, 0.004 * s, 0.004 * s), m.second, [0, chestRel * (0.2 + i * 0.28), 0.09 * s], [0, 0, (i % 2 ? 1 : -1) * 0.4]);
      // Flared pleated skirt (alternating shades) with a pale hem stripe.
      this.skirt({ y: 0.06 * s, rx: 0.14 * s, rz: 0.115 * s, len: 0.14 * s + thigh * 0.42, count: 16, from: 0, to: Math.PI * 2, base: 0.42, mat: doubleSided(m.main), matB: doubleSided(m.mainDark), t: 0.01 * s, trim: m.second });
    } else if (key === 'O3') {
      // HUnewearl: leotard, plates, gauntlets, tassets, tall boots.
      this.torso(m.main, m.main, m.main);
      this.arms(m.skin, m.second, m.second);
      this.legsGeo(m.skin, m.skin);
      this.shoes('tall', m.accent);
      // Trim panels sweeping from the shoulders to the waist.
      for (const sx of [-1, 1]) {
        part(j.chest, new THREE.BoxGeometry(0.018 * s, neckRel * 0.85, 0.15 * s), m.second, [sx * 0.125 * s, neckRel * 0.5, 0], [0, 0, sx * -0.16]);
        part(j.spine, new THREE.BoxGeometry(0.016 * s, chestRel * 0.95, 0.13 * s), m.second, [sx * 0.11 * s, chestRel * 0.5, 0], [0, 0, sx * 0.06]);
      }
      // Emblem and collar.
      part(j.chest, new THREE.CylinderGeometry(0.032 * s, 0.032 * s, 0.012 * s, 8), m.second, [0, neckRel * 0.78, 0.085 * s], [Math.PI / 2 - 0.3, 0, 0], [1.4, 1, 0.8]);
      part(j.chest, new THREE.CylinderGeometry(0.022 * s, 0.022 * s, 0.016 * s, 8), m.dark, [0, neckRel * 0.78, 0.089 * s], [Math.PI / 2 - 0.3, 0, 0], [1.4, 1, 0.8]);
      part(j.head, limbGeo(0.04 * limb, 0.045 * limb, this.d.headCenter * 0.3).translate(0, this.d.headCenter * 0.3, 0), m.second);
      // Gauntlet bands; tall shoulder plates.
      for (const [sh, el, side] of [[j.shoulderL, j.elbowL, 1], [j.shoulderR, j.elbowR, -1]] as const) {
        part(el, limbGeo(0.04 * limb, 0.04 * limb, 0.03 * s), m.main, [0, -0.04 * s, 0]);
        part(el, limbGeo(0.036 * limb, 0.036 * limb, 0.02 * s), m.main, [0, -0.09 * s, 0]);
        const g = new THREE.Group();
        g.position.set(side * 0.058 * s, -0.035 * s, 0);
        g.rotation.z = side * 0.12;
        sh.add(g);
        part(g, new THREE.BoxGeometry(0.04 * s, 0.22 * s, 0.15 * s), m.main);
        part(g, new THREE.BoxGeometry(0.044 * s, 0.045 * s, 0.155 * s), m.second, [0, -0.085 * s, 0]);
        part(g, new THREE.BoxGeometry(0.045 * s, 0.012 * s, 0.157 * s), m.dark, [0, 0.05 * s, 0]);
        part(g, new THREE.BoxGeometry(0.032 * s, 0.05 * s, 0.13 * s), m.main, [0, 0.125 * s, 0], [0, 0, side * -0.4]);
      }
      // Armour skirt: crimson panels with pale stripes, open at the front.
      this.skirt({ y: 0.07 * s, rx: 0.15 * s, rz: 0.12 * s, len: 0.24 * s, count: 7, from: 0.95, to: Math.PI * 2 - 0.95, base: 0.4, mat: m.second, matB: m.second, t: 0.018 * s, trim: m.main, stripes: true });
      part(j.hips, shellGeo([[0.148 * s, 0.05 * s], [0.145 * s, 0.095 * s]], 0.8), m.second); // waistband
    } else if (key === 'O4') {
      // Ranger: bodysuit, cropped jacket, belt with pouches, coat tails, armoured boots.
      this.torso(m.main, m.main, m.main);
      this.arms(m.second, m.second, m.dark);
      this.legsGeo(m.main, m.main);
      this.shoes('armored');
      const jacket = doubleSided(m.second);
      const sw = this.d.shoulderW / s / 0.155;
      // Cropped jacket: covers the chest only, open in a V.
      part(j.chest, shellGeo([[0.13 * s, neckRel * 0.25], [0.145 * s * sw, neckRel * 0.55], [0.155 * s * sw, neckRel * 0.8], [0.12 * s * sw, neckRel * 0.96], [0.07 * s, neckRel * 1.05]], 0.72, 0.8), jacket);
      this.bust(m.main, 1.0);
      // High collar flaring open at the front.
      part(j.chest, new THREE.CylinderGeometry(0.085 * s, 0.075 * s, 0.09 * s, 10, 1, true, 0.45, Math.PI * 2 - 0.9), jacket, [0, neckRel * 1.08, 0]);
      part(j.chest, new THREE.CylinderGeometry(0.087 * s, 0.087 * s, 0.012 * s, 10, 1, true, 0.45, Math.PI * 2 - 0.9), doubleSided(m.accent), [0, neckRel * 1.08 + 0.045 * s, 0]);
      // Accent seams on the bodysuit.
      for (const sx of [-1, 1]) part(j.spine, new THREE.BoxGeometry(0.01 * s, chestRel * 1.1, 0.012 * s), m.accent, [sx * 0.07 * s, chestRel * 0.5, 0.082 * s], [0, sx * 0.5, 0]);
      // Sleeve cuffs and shoulder guards.
      for (const [sh, el, side] of [[j.shoulderL, j.elbowL, 1], [j.shoulderR, j.elbowR, -1]] as const) {
        part(el, limbGeo(0.038 * limb, 0.04 * limb, 0.05 * s), m.accent, [0, -this.d.fore + 0.06 * s, 0]);
        part(sh, new THREE.SphereGeometry(0.062 * limb, 7, 4, 0, Math.PI * 2, 0, Math.PI * 0.45), m.metal, [side * 0.01 * s, 0.0, 0], [0, 0, side * -0.3]);
      }
      // Belt, buckle, pouches, holster.
      part(j.hips, shellGeo([[0.158 * s, 0.0], [0.152 * s, 0.04 * s]], 0.8), m.dark);
      part(j.hips, new THREE.BoxGeometry(0.04 * s, 0.035 * s, 0.01 * s), m.metal, [0, 0.02 * s, 0.125 * s]);
      for (const sx of [-1, 1]) part(j.hips, new THREE.BoxGeometry(0.045 * s, 0.05 * s, 0.03 * s), m.dark, [sx * 0.14 * s, -0.01 * s, 0.06 * s], [0, sx * 0.7, 0]);
      part(j.hipR, new THREE.BoxGeometry(0.03 * s, 0.11 * s, 0.07 * s), m.dark, [-0.075 * limb, -0.12 * s, 0]);
      part(j.hipR, limbGeo(0.08 * limb, 0.078 * limb, 0.015 * s), m.dark, [0, -0.14 * s, 0]);
      // Coat tails at the back only (plated from evolution stage 2).
      const plated = (this.look.evo ?? 0) >= 2;
      this.skirt({ y: 0.03 * s, rx: 0.165 * s, rz: 0.13 * s, len: 0.12 * s + thigh * 0.62, count: 5, from: Math.PI - 1.05, to: Math.PI + 1.05, base: 0.12, mat: jacket, matB: plated ? doubleSided(m.plate) : jacket, t: 0.012 * s, trim: m.accent, stripes: plated });
    } else {
      // O5 Force: high-collar dress, long split skirt, detached bell sleeves.
      this.torso(m.main, m.main, m.main);
      this.arms(m.skin, m.skin, m.skin, m.skin);
      this.legsGeo(m.legwear, m.legwear);
      this.shoes('tall', m.metal);
      // Mandarin collar and a chest gem.
      part(j.head, limbGeo(0.042 * limb, 0.048 * limb, this.d.headCenter * 0.4).translate(0, this.d.headCenter * 0.4, 0), m.second);
      part(j.chest, new THREE.OctahedronGeometry(0.02 * s), m.glow, [0, neckRel * 0.72, 0.1 * s], [0, 0, 0], [1, 1.3, 0.6]);
      for (const sx of [-1, 1]) part(j.chest, new THREE.BoxGeometry(0.014 * s, neckRel * 0.7, 0.01 * s), m.second, [sx * 0.05 * s, neckRel * 0.55, 0.1 * s], [0.15, 0, sx * 0.35]);
      // Sash.
      part(j.spine, shellGeo([[0.118 * s, chestRel * 0.15], [0.114 * s, chestRel * 0.5]], 0.78), m.second);
      // Detached bell sleeves.
      for (const el of [j.elbowL, j.elbowR]) {
        const bell = doubleSided(m.main);
        part(el, limbGeo(0.04 * limb, 0.085 * limb, this.d.fore * 0.85, 8), bell, [0, 0.01, 0]);
        part(el, new THREE.CylinderGeometry(0.088 * limb, 0.088 * limb, 0.02 * s, 8, 1, true), doubleSided(m.second), [0, -this.d.fore * 0.84, 0]);
        part(el, limbGeo(0.042 * limb, 0.042 * limb, 0.02 * s), m.second, [0, 0.005, 0]);
      }
      // Long skirt, split at the front.
      this.panelLegs = 'full';
      this.skirt({ y: 0.05 * s, rx: 0.15 * s, rz: 0.12 * s, len: 0.15 * s + thigh + this.d.shin * 0.45, count: 12, from: 0.45, to: Math.PI * 2 - 0.45, base: 0.1, mat: doubleSided(m.main), matB: doubleSided(m.mainDark), t: 0.01 * s, trim: m.second });
    }
  }

  /** Ring of hinged panels round the hips that sway and are pushed clear of the legs. */
  private skirt(o: { y: number; rx: number; rz: number; len: number; count: number; from: number; to: number; base: number; mat: THREE.Material; matB: THREE.Material; t: number; trim: THREE.Material; stripes?: boolean; w?: number }): void {
    const hips = this.rig.joints.hips;
    const full = o.to - o.from >= Math.PI * 2 - 1e-6;
    const n = o.count;
    const step = (o.to - o.from) / (full ? n : n - 1);
    const rAvg = (o.rx + o.rz) / 2;
    const wTop = o.w ?? rAvg * step * 1.2;
    const wBot = o.w ? o.w * 1.1 : (rAvg + o.len * Math.sin(o.base)) * step * 1.25;
    for (let i = 0; i < n; i++) {
      const theta = o.from + i * step;
      const hinge = new THREE.Group();
      hinge.position.set(Math.sin(theta) * o.rx, o.y, Math.cos(theta) * o.rz);
      hinge.rotation.y = theta;
      hips.add(hinge);
      const tilt = new THREE.Group();
      tilt.rotation.x = -o.base;
      hinge.add(tilt);
      part(tilt, taperBox(wTop, wBot, o.len, o.t), i % 2 ? o.matB : o.mat);
      // Hem trim.
      part(tilt, taperBox(wBot * 0.98, wBot, o.len * 0.07, o.t * 1.3), o.trim, [0, -o.len * 0.93, 0]);
      if (this.glowLvl > 0) {
        part(tilt, taperBox(wBot * 0.97, wBot * 0.98, o.len * 0.022, o.t * 1.5), this.m.glow, [0, -o.len * 0.89, 0]);
        if (this.glowLvl > 1) {
          // Circuit traces: a vertical run with a dog-leg and a node, alternating sides.
          const sx = (i % 2 ? 1 : -1) * wTop * 0.22;
          const z = o.t * 0.55;
          piece(tilt, V(sx, -o.len * 0.12, z), V(sx, -o.len * 0.5, z), 0.005, 0.005, 0.003, V(0, 0, 1), this.m.glow);
          piece(tilt, V(sx, -o.len * 0.5, z), V(sx * 0.3, -o.len * 0.62, z), 0.005, 0.005, 0.003, V(0, 0, 1), this.m.glow);
          piece(tilt, V(sx * 0.3, -o.len * 0.62, z), V(sx * 0.3, -o.len * 0.8, z), 0.005, 0.005, 0.003, V(0, 0, 1), this.m.glow);
          part(tilt, new THREE.BoxGeometry(0.014, 0.014, o.t * 1.4), this.m.glow, [sx, -o.len * 0.12, 0]);
        }
      }
      if (o.stripes) {
        part(tilt, taperBox(wTop * 1.01, wTop * 1.03, 0.014, o.t * 1.4), o.trim, [0, -o.len * 0.5, 0]);
        part(tilt, new THREE.BoxGeometry(0.014, o.len * 0.9, o.t * 1.4).translate(0, -o.len * 0.45, 0), o.trim, [wTop * 0.25, 0, 0]);
      }
      this.panels.push({ hinge, tilt, theta, y0: o.y, len: o.len, halfW: wBot / 2, base: o.base, phi: o.base, v: 0 });
    }
  }

  // ---------------------------------------------------------- simulation

  private anchorVel(key: object, obj: THREE.Object3D, dt: number, extra?: THREE.Vector3): THREE.Vector3 {
    const p = obj.getWorldPosition(new THREE.Vector3());
    const last = this.lastAnchor.get(key);
    let v = this.vel.get(key);
    if (!v) {
      v = new THREE.Vector3();
      this.vel.set(key, v);
    }
    if (last && dt > 0) {
      const raw = p.clone().sub(last).divideScalar(dt);
      // A jump (teleport / area change) resets instead of whipping the hair.
      if (raw.lengthSq() > 30 * 30) raw.set(0, 0, 0);
      if (extra) raw.add(extra);
      v.lerp(raw, 1 - Math.exp(-dt / 0.06));
    }
    this.lastAnchor.set(key, p);
    return v;
  }

  /**
   * Secondary motion. Call after the rig pose is applied each frame.
   * extraVel: world-space velocity not visible as motion (e.g. a treadmill preview).
   */
  update(dt: number, extraVel?: THREE.Vector3): void {
    if (dt <= 0) return;
    if (this.floaters.length) this.updateFloaters(dt);
    this.rig.root.updateMatrixWorld(true);
    const steps = Math.min(4, Math.ceil(dt / (1 / 60)));
    const h = dt / steps;
    const chest = this.rig.joints.chest;
    const chestQ = chest.getWorldQuaternion(new THREE.Quaternion());
    const chestInv = chestQ.clone().invert();

    for (const chain of this.chains) {
      const vel = this.anchorVel(chain, chain.root, dt, extraVel);
      // Gravity plus air drag: the hair trails opposite to the motion.
      const want = DOWN.clone().addScaledVector(_v.set(vel.x, 0, vel.z), -chain.drag).normalize();
      for (const seg of chain.segs) {
        const parent = seg.g.parent!;
        parent.getWorldQuaternion(_q);
        // Clamp the wanted direction in the chest frame so the hair stays clear of the body.
        const dc = want.clone().applyQuaternion(chestInv);
        let a = Math.atan2(-dc.z, -dc.y);
        let b = Math.asin(clamp(dc.x, -1, 1));
        a = clamp(a, seg.aMin, seg.aMax);
        b = clamp(b, seg.bMin, seg.bMax);
        _v2.set(Math.sin(b), -Math.cos(b) * Math.cos(a), -Math.cos(b) * Math.sin(a)).applyQuaternion(chestQ);
        // Into the parent's frame.
        const l = _v2.applyQuaternion(_q2.copy(_q).invert());
        const ta = Math.atan2(-l.z, -l.y);
        const tb = Math.asin(clamp(l.x, -1, 1));
        for (let k = 0; k < steps; k++) {
          seg.va += (chain.stiffness * (ta - seg.a) - chain.damping * seg.va) * h;
          seg.vb += (chain.stiffness * (tb - seg.b) - chain.damping * seg.vb) * h;
          seg.a += seg.va * h;
          seg.b += seg.vb * h;
        }
        // Hard limit in the chest frame as well (the spring can overshoot).
        seg.g.rotation.set(seg.a, 0, seg.b);
        seg.g.updateMatrixWorld(true);
        const dir = DOWN.clone().applyQuaternion(seg.g.getWorldQuaternion(_q)).applyQuaternion(chestInv);
        const ca = Math.atan2(-dir.z, -dir.y);
        if (ca < seg.aMin - 0.02) {
          seg.a += seg.aMin - ca;
          seg.va = Math.max(0, seg.va);
        } else if (ca > seg.aMax + 0.02) {
          seg.a -= ca - seg.aMax;
          seg.va = Math.min(0, seg.va);
        }
        seg.g.rotation.set(seg.a, 0, seg.b);
        seg.g.updateMatrixWorld(true);
      }
    }

    if (this.panels.length) this.updatePanels(dt, steps, h, extraVel);
  }

  private updatePanels(dt: number, steps: number, h: number, extraVel?: THREE.Vector3): void {
    const j = this.rig.joints;
    const hips = j.hips;
    const vel = this.anchorVel(this.panels, hips, dt, extraVel);
    const hipsInv = hips.getWorldQuaternion(new THREE.Quaternion()).invert();
    const vLocal = vel.clone().applyQuaternion(hipsInv);
    const { thigh, shin, limb } = this.d;

    // Leg sample points (hips space) with their radii.
    const samples: [THREE.Vector3, number][] = [];
    const tmp = new THREE.Vector3();
    for (const [hip, knee] of [[j.hipL, j.kneeL], [j.hipR, j.kneeR]] as const) {
      for (const t of [0.25, 0.5, 0.75, 1]) {
        tmp.set(0, -thigh * t, 0);
        hip.localToWorld(tmp);
        samples.push([hips.worldToLocal(tmp.clone()), (0.074 + (0.047 - 0.074) * t) * limb]);
      }
      if (this.panelLegs === 'full')
        for (const t of [0.3, 0.6, 0.9]) {
          tmp.set(0, -shin * t, 0);
          knee.localToWorld(tmp);
          samples.push([hips.worldToLocal(tmp.clone()), (t < 0.5 ? 0.06 : 0.05) * limb]);
        }
    }

    for (const p of this.panels) {
      const sn = Math.sin(p.theta);
      const cs = Math.cos(p.theta);
      // Required flare so the panel passes outside every leg sample beneath it.
      let need = -1;
      for (const [q, rad] of samples) {
        const dx = q.x - p.hinge.position.x;
        const dz = q.z - p.hinge.position.z;
        const rho = dx * sn + dz * cs;
        const tau = dx * cs - dz * sn;
        const depth = p.hinge.position.y - q.y;
        if (depth <= 0.01 || Math.abs(tau) > p.halfW + rad) continue;
        if (depth > p.len * Math.cos(p.phi) + rad) continue;
        need = Math.max(need, Math.atan2(rho + rad + 0.012, depth));
      }
      // Air pushes the panel against the motion: back panels lift when running.
      const along = -(vLocal.x * sn + vLocal.z * cs);
      const target = clamp(p.base + Math.max(0, along) * 0.08 - Math.max(0, -along) * 0.02, p.base - 0.15, p.base + 0.75);
      for (let k = 0; k < steps; k++) {
        p.v += (160 * (target - p.phi) - 11 * p.v) * h;
        p.phi += p.v * h;
        if (p.phi < need) {
          p.phi = need;
          if (p.v < 0) p.v = 0;
        }
      }
      p.phi = Math.min(p.phi, 1.4);
      p.tilt.rotation.x = -p.phi;
    }
  }
}

function doubleSided(m: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  const c = m.clone();
  c.side = THREE.DoubleSide;
  return c;
}

function shadeMat(m: THREE.MeshStandardMaterial, k: number): THREE.MeshStandardMaterial {
  const c = m.clone();
  c.color.multiplyScalar(k);
  return c;
}

