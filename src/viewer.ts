import GUI from 'lil-gui';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { weaponKinds, type WeaponKind } from './game/data/items';
import { BoomaModel, boomaPoses } from './game/models/booma';
import { HidoomModel, LilyModel, lilyPoses, MigiumModel, migiumPoses, PanArmsModel } from './game/models/cave';
import { DeRolLeModel } from './game/models/derolle';
import {
  garanzPoses, GaranzModel, gunbotPoses, GunbotModel, NodeModel, nodePoses, sinowPoses, SinowModel, WARDEN_HAND_REST, WardenModel,
} from './game/models/mines';
import { DragonModel, type DragonPoseParams } from './game/models/dragon';
import { Heroine, PLAYER_LOOK, type CharacterModel } from './game/models/heroine';
import { Humanoid, humanPoses, STYLES, type Grip } from './game/models/humanoid';
import { CLASS_ARM, LEAD_FORMS, MAG_STATS, STAGE1, type MagStat } from './game/mag';
import { MagCompanion } from './game/models/mag';
import { buildProp, type PropKind } from './game/models/props';
import type { Pose, Rig } from './game/models/Rig';
import { buildWeapon, WEAPON_GRIP } from './game/models/weapons';
import { gaitPose, PLAYER_GAIT, scaleGait } from './game/models/gait';
import { PLAYER_SWING, swingFrame, WeaponHold, type HoldRequest } from './game/models/swings';
import { LEFT_HAND_AT, type HiltTarget } from './game/models/twoHand';
import { player as playerCfg } from './game/config';

// Standalone model viewer: inspect and pose the procedural models without
// running the game. Open /viewer.html on the dev server.

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a2232);
const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.05, 200);
camera.position.set(3.2, 2.2, 4.2);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1, 0);
controls.enableDamping = true;

scene.add(new THREE.HemisphereLight(0xcfe4ff, 0x3a3a30, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.7);
sun.position.set(6, 10, 5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const sc = sun.shadow.camera;
sc.left = sc.bottom = -12;
sc.right = sc.top = 12;
scene.add(sun);

const ground = new THREE.Mesh(new THREE.CircleGeometry(14, 48), new THREE.MeshStandardMaterial({ color: 0x3d5a3a, roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
const grid = new THREE.GridHelper(28, 28, 0x5a7a56, 0x4a6a46);
grid.position.y = 0.002;
scene.add(grid);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ------------------------------------------------------------- catalogue

type Entry =
  | { kind: 'human'; style: keyof typeof STYLES | 'player' }
  | { kind: 'booma'; color: number; scale: number }
  | { kind: 'brute'; which: 'panarms' | 'hidoom' }
  | { kind: 'lily'; nar: boolean }
  | { kind: 'migium' }
  | { kind: 'derolle' }
  | { kind: 'dragon' }
  | { kind: 'prop'; prop: PropKind }
  | { kind: 'weapon'; weapon: WeaponKind }
  | { kind: 'mag' }
  | { kind: 'gunbot' }
  | { kind: 'garanz' }
  | { kind: 'sinow' }
  | { kind: 'node' }
  | { kind: 'warden' };

const CATALOGUE: Record<string, Entry> = {
  'Player (all classes)': { kind: 'human', style: 'player' },
  'Old: HUmar': { kind: 'human', style: 'hunter' },
  'Old: RAmarl': { kind: 'human', style: 'ranger' },
  'Old: FOmarl': { kind: 'human', style: 'force' },
  'NPC: Armorer': { kind: 'human', style: 'armorer' },
  'NPC: Shopkeeper': { kind: 'human', style: 'shopkeeper' },
  'NPC: Clerk': { kind: 'human', style: 'clerk' },
  'NPC: Nurse': { kind: 'human', style: 'nurse' },
  Booma: { kind: 'booma', color: 0x8a5a2b, scale: 1 },
  Gobooma: { kind: 'booma', color: 0x3f6b8a, scale: 1.12 },
  Gigobooma: { kind: 'booma', color: 0x6a2f7a, scale: 1.25 },
  'Cave Booma': { kind: 'booma', color: 0xa8442a, scale: 1.04 },
  'Cave Gobooma': { kind: 'booma', color: 0x2f5a6a, scale: 1.15 },
  'Cave Gigobooma': { kind: 'booma', color: 0x5a5a62, scale: 1.28 },
  'Poison Lily': { kind: 'lily', nar: false },
  'Nar Lily': { kind: 'lily', nar: true },
  'Pan Arms': { kind: 'brute', which: 'panarms' },
  Hidoom: { kind: 'brute', which: 'hidoom' },
  Migium: { kind: 'migium' },
  Dragon: { kind: 'dragon' },
  'De Rol Le': { kind: 'derolle' },
  Gillchic: { kind: 'gunbot' },
  Garanz: { kind: 'garanz' },
  'Sinow Beat': { kind: 'sinow' },
  'Control Node': { kind: 'node' },
  'Warden': { kind: 'warden' },
  'Prop: Pine': { kind: 'prop', prop: 'pine' },
  'Prop: Broadleaf': { kind: 'prop', prop: 'broadleaf' },
  'Prop: Tall pine (in-room)': { kind: 'prop', prop: 'tallpine' },
  'Prop: Tall broadleaf (in-room)': { kind: 'prop', prop: 'tallbroad' },
  'Prop: Bush': { kind: 'prop', prop: 'bush' },
  'Prop: Rock': { kind: 'prop', prop: 'rock' },
  'Prop: Grass': { kind: 'prop', prop: 'grass' },
  'Prop: Stump': { kind: 'prop', prop: 'stump' },
  'Prop: Stalagmites': { kind: 'prop', prop: 'stalag' },
  'Prop: Mossy crag': { kind: 'prop', prop: 'mosscrag' },
  'Prop: Mushrooms': { kind: 'prop', prop: 'mushroom' },
  'Prop: Crystal': { kind: 'prop', prop: 'crystal' },
  'Prop: Crate': { kind: 'prop', prop: 'crate' },
  'Prop: Drum': { kind: 'prop', prop: 'drum' },
  'Prop: Tank': { kind: 'prop', prop: 'tank' },
  'Prop: Pipes': { kind: 'prop', prop: 'pipes' },
  'Prop: Console': { kind: 'prop', prop: 'console' },
  'Prop: Girder': { kind: 'prop', prop: 'girder' },
  'Prop: Chimney stack': { kind: 'prop', prop: 'stack' },
  ...Object.fromEntries((Object.keys(weaponKinds) as WeaponKind[]).map((w) => [`Weapon: ${weaponKinds[w].label}`, { kind: 'weapon', weapon: w }])),
  'Mag: all forms': { kind: 'mag' },
};

/**
 * Every Mag form, one row per stage (top to bottom): Mag and the three class forms, then the
 * DEF / POW / DEX / MIND forms of stages 2, 3 and 4 (the twins). The plain Mag's stripes are lit.
 */
const MAG_LINEUP: { stage: number; name: string; color: number; theme?: MagStat; glow: boolean; col: number; row: number }[] = [
  { stage: 0, name: 'Mag', color: 0xc8d4e8, glow: true, col: 0, row: 0 },
  ...(['hunter', 'ranger', 'force'] as const).map((c, i) => ({ stage: 1, name: STAGE1[c][0], color: STAGE1[c][1], theme: CLASS_ARM[c], glow: false, col: i + 1, row: 0 })),
  ...[2, 3, 4].flatMap((stage) =>
    MAG_STATS.map((s, i) => ({ stage, name: stage === 4 ? 'Ashvinau' : LEAD_FORMS[s][stage === 2 ? 0 : 1], color: LEAD_FORMS[s][2], theme: s, glow: false, col: i, row: stage - 1 })),
  ),
];
const MAG_COL_W = 2.4;
const MAG_ROW_H = 0.85;
/** Where each lineup Mag's owner stands, so the Mag (or twin pair) centres on its grid cell. */
const magOwner = (i: number): THREE.Vector3 => {
  const e = MAG_LINEUP[i];
  // A single Mag sits 0.5 to its owner's left, which is +X for an owner facing the camera.
  return new THREE.Vector3((e.col - 1.5) * MAG_COL_W - (e.stage >= 4 ? 0 : 0.5), (3 - e.row) * MAG_ROW_H - 0.8, 0);
};
let mags: MagCompanion[] = [];

function textSprite(text: string, color: number): THREE.Sprite {
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 64;
  const ctx = cv.getContext('2d')!;
  ctx.font = 'bold 34px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = `#${new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.35).getHexString()}`;
  ctx.fillText(text, 128, 32);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), depthWrite: false }));
  sprite.scale.set(0.8, 0.2, 1);
  return sprite;
}

const HUMAN_ANIMS = ['idle', 'run', 'slash 1', 'slash 2', 'slash 3 (overhead)', 'thrust (partisan)', 'shoot', 'cast 1', 'cast 2', 'cast 3 (finisher)', 'cast (support)', 'hurt', 'drink', 'wave'];
const BOOMA_ANIMS = ['idle', 'walk', 'windup', 'strike', 'attack loop', 'hurt', 'crouch'];
const DRAGON_ANIMS = ['idle', 'walk', 'roar', 'stomp windup', 'breath', 'charge', 'stunned (weak point)', 'dead'];
const LILY_ANIMS = ['idle', 'aim', 'spit', 'burst windup', 'burst', 'attack loop', 'hurt', 'dead'];
const MIGIUM_ANIMS = ['idle', 'walk', 'cast', 'release', 'cast loop', 'hurt'];
const DRL_ANIMS = ['swim', 'roar', 'beam charge', 'phase 2', 'lying across deck'];
const GUNBOT_ANIMS = ['idle', 'walk', 'aim', 'fire', 'swipe windup', 'swipe', 'hurt', 'offline'];
const GARANZ_ANIMS = ['idle', 'walk', 'plant', 'fire', 'stomp windup', 'stomp', 'hurt', 'dead'];
const SINOW_ANIMS = ['idle', 'run', 'crouch', 'leap', 'slash 1', 'slash 2', 'slash 3 (burns)', 'combo loop', 'hurt'];
const NODE_ANIMS = ['live', 'destroyed'];
const WARDEN_ANIMS = ['idle', 'slam', 'floor pattern', 'lockdown (reach)', 'vent (core open)', 'enraged', 'dead'];
const NO_ANIMS = ['\u2014'];
const ANIMS: Record<Entry['kind'], string[]> = {
  human: HUMAN_ANIMS, booma: BOOMA_ANIMS, brute: BOOMA_ANIMS, lily: LILY_ANIMS, migium: MIGIUM_ANIMS,
  derolle: DRL_ANIMS, dragon: DRAGON_ANIMS, prop: NO_ANIMS, weapon: NO_ANIMS, mag: NO_ANIMS,
  gunbot: GUNBOT_ANIMS, garanz: GARANZ_ANIMS, sinow: SINOW_ANIMS, node: NODE_ANIMS, warden: WARDEN_ANIMS,
};
const GRIPS = WEAPON_GRIP;

const params = {
  model: 'Player (all classes)',
  animation: 'idle',
  weapon: 'saber' as WeaponKind | 'none',
  playing: true,
  speed: 1,
  scrub: 0,
  turntable: false,
  wireframe: false,
  showGrid: true,
};

// ------------------------------------------------------------ live model

let root: THREE.Object3D | null = null;
let human: CharacterModel | null = null;
let booma: BoomaModel | null = null;
let brute: { rig: Rig } | null = null;
let lily: LilyModel | null = null;
let migium: MigiumModel | null = null;
let drl: DeRolLeModel | null = null;
let dragon: DragonModel | null = null;
let gunbot: GunbotModel | null = null;
let garanz: GaranzModel | null = null;
let sinow: SinowModel | null = null;
let node: NodeModel | null = null;
let warden: WardenModel | null = null;
let time = 0;

function frame(obj: THREE.Object3D): void {
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const r = Math.max(size.x, size.y, size.z);
  controls.target.copy(center);
  const dir = new THREE.Vector3(0.6, 0.35, 0.75).normalize();
  camera.position.copy(center).addScaledVector(dir, r * 1.9 + 0.6);
}

function stats(obj: THREE.Object3D): { tris: number; meshes: number } {
  let tris = 0;
  let meshes = 0;
  obj.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      meshes++;
      const g = o.geometry as THREE.BufferGeometry;
      tris += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
    }
  });
  return { tris: Math.round(tris), meshes };
}

function attachWeapon(): void {
  if (!human) return;
  human.grip.clear();
  if (params.weapon !== 'none') human.grip.add(buildWeapon(params.weapon, weaponKinds[params.weapon].color).group);
}

function build(): void {
  if (root) scene.remove(root);
  human = booma = dragon = lily = migium = drl = null;
  gunbot = null;
  garanz = null;
  sinow = null;
  node = null;
  warden = null;
  brute = null;
  mags = [];
  const e = CATALOGUE[params.model];
  switch (e.kind) {
    case 'human':
      human = e.style === 'player' ? new Heroine(PLAYER_LOOK) : new Humanoid(STYLES[e.style]);
      root = human.rig.root;
      attachWeapon();
      break;
    case 'booma':
      booma = new BoomaModel(e.color);
      booma.rig.root.scale.setScalar(e.scale);
      root = booma.rig.root;
      break;
    case 'dragon':
      dragon = new DragonModel();
      root = dragon.group;
      break;
    case 'brute':
      brute = e.which === 'panarms' ? new PanArmsModel() : new HidoomModel();
      root = brute.rig.root;
      break;
    case 'lily':
      lily = e.nar ? new LilyModel(0xd83a3a, 0x3a6a2a, 0xffd040) : new LilyModel();
      if (e.nar) lily.rig.root.scale.setScalar(1.12);
      root = lily.rig.root;
      break;
    case 'migium':
      migium = new MigiumModel();
      root = migium.rig.root;
      break;
    case 'derolle':
      drl = new DeRolLeModel(8);
      root = drl.root;
      break;
    case 'gunbot':
      gunbot = new GunbotModel();
      root = gunbot.rig.root;
      break;
    case 'garanz':
      garanz = new GaranzModel();
      root = garanz.rig.root;
      break;
    case 'sinow':
      sinow = new SinowModel();
      root = sinow.rig.root;
      break;
    case 'node':
      node = new NodeModel();
      root = node.rig.root;
      break;
    case 'warden':
      warden = new WardenModel();
      root = warden.root;
      break;
    case 'prop':
      root = buildProp(e.prop);
      break;
    case 'mag':
      root = new THREE.Group();
      mags = MAG_LINEUP.map((e, i) => {
        const m = new MagCompanion();
        m.setForm(e.stage, e.color, { theme: e.theme });
        m.setGlow(e.glow, 0x3cb4c4); // default palette accent
        root!.add(m.root);
        const label = textSprite(e.name, e.color);
        label.position.set((e.col - 1.5) * MAG_COL_W, magOwner(i).y + 1.38, 0.35);
        root!.add(label);
        return m;
      });
      break;
    case 'weapon': {
      const w = buildWeapon(e.weapon, weaponKinds[e.weapon].color).group;
      w.rotation.y = Math.PI / 2;
      w.position.y = 1;
      root = new THREE.Group().add(w);
      break;
    }
  }
  scene.add(root);
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true;
  });
  applyWireframe();
  const anims = ANIMS[e.kind];
  animCtrl.options(anims);
  if (!anims.includes(params.animation)) params.animation = anims[0];
  animCtrl.setValue(params.animation);
  weaponCtrl.show(e.kind === 'human');
  // Pose once so the framing uses the posed bounds.
  tick(0, true);
  frame(root);
  updateInfo();
}

function applyWireframe(): void {
  root?.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) if ('wireframe' in m) (m as THREE.MeshStandardMaterial).wireframe = params.wireframe;
  });
}

function updateInfo(): void {
  if (!root) return;
  const s = stats(root);
  document.getElementById('info')!.innerHTML =
    `<b>${params.model}</b> · ${s.meshes} parts · ${s.tris.toLocaleString()} triangles<br>` +
    `Drag to orbit · right-drag to pan · wheel to zoom · <b>scrub</b> poses a single frame when playback is paused`;
}

// ---------------------------------------------------------------- posing

/** 0..1 phase for one-shot animations, looping while playing. */
function phase(period: number): number {
  return params.playing ? (time % period) / period : params.scrub;
}

const humanHold = new WeaponHold();
const humanHilt: HiltTarget = { at: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, 1) };

function humanPose(): { pose: Pose; rate: number; hold?: HoldRequest } {
  const grip: Grip = params.weapon === 'none' ? 'none' : GRIPS[params.weapon];
  const impact = 0.42;
  switch (params.animation) {
    case 'run':
      // Same cycle as the game, at the in-game speed.
      return { pose: gaitPose((time * playerCfg.moveSpeed) / scaleGait(PLAYER_GAIT, playerCfg.moveSpeed).cycleLength, PLAYER_GAIT, human!.legs, grip, playerCfg.moveSpeed), rate: Infinity };
    case 'slash 1':
    case 'slash 2':
    case 'slash 3 (overhead)': {
      // The in-game swings, both hands on the weapon (one-handed when nothing is held).
      const i = params.animation === 'slash 1' ? 0 : params.animation === 'slash 2' ? 1 : 2;
      const k = phase(i === 2 ? 1.2 : 1);
      if (params.weapon === 'none') return { pose: humanPoses.slash(i, k, impact), rate: 30 };
      const f = swingFrame(PLAYER_SWING, i, k, impact, humanHilt);
      return { pose: f.pose, rate: 30, hold: { hilt: f.hilt } };
    }
    case 'thrust (partisan)':
      return { pose: humanPoses.thrust(0, phase(1), impact), rate: 30, hold: params.weapon === 'none' ? undefined : {} };
    case 'shoot':
      return { pose: humanPoses.shoot(phase(0.8), 0.25, grip), rate: 30 };
    case 'cast 1':
      return { pose: humanPoses.castChain(0, phase(1.4), 0.6), rate: 30 };
    case 'cast 2':
      return { pose: humanPoses.castChain(1, phase(1.4), 0.6), rate: 30 };
    case 'cast 3 (finisher)':
      return { pose: humanPoses.castChain(2, phase(1.6), 0.6), rate: 30 };
    case 'cast (support)':
      return { pose: humanPoses.cast(phase(1)), rate: 16 };
    case 'hurt':
      return { pose: humanPoses.hurt(), rate: 20 };
    case 'drink':
      return { pose: humanPoses.drink(), rate: 12 };
    case 'wave':
      return { pose: humanPoses.wave(time), rate: 8 };
    default:
      return { pose: humanPoses.idle(time, grip), rate: 8 };
  }
}

function boomaPose(): { pose: Pose; rate: number } {
  switch (params.animation) {
    case 'walk':
      return { pose: boomaPoses.walk(time * 5), rate: 10 };
    case 'windup':
      return { pose: boomaPoses.windup(phase(1)), rate: 20 };
    case 'strike':
      return { pose: boomaPoses.strike(), rate: 35 };
    case 'attack loop': {
      const k = phase(2.2);
      if (k < 0.45) return { pose: boomaPoses.windup(k / 0.45), rate: 20 };
      if (k < 0.55) return { pose: boomaPoses.strike(), rate: 35 };
      return { pose: boomaPoses.idle(time), rate: 5 };
    }
    case 'hurt':
      return { pose: boomaPoses.hurt(), rate: 20 };
    case 'crouch':
      return { pose: boomaPoses.crouch(), rate: 8 };
    default:
      return { pose: boomaPoses.idle(time), rate: 6 };
  }
}

function lilyPose(): { pose: Pose; rate: number } {
  switch (params.animation) {
    case 'aim':
      return { pose: lilyPoses.aim(phase(1)), rate: 18 };
    case 'spit':
      return { pose: lilyPoses.spit(), rate: 30 };
    case 'burst windup':
      return { pose: lilyPoses.burstWindup(phase(1)), rate: 16 };
    case 'burst':
      return { pose: lilyPoses.burst(), rate: 30 };
    case 'attack loop': {
      const k = phase(2.4);
      if (k < 0.25) return { pose: lilyPoses.aim(k / 0.25), rate: 18 };
      if (k < 0.4) return { pose: lilyPoses.spit(), rate: 30 };
      return { pose: lilyPoses.idle(time), rate: 5 };
    }
    case 'hurt':
      return { pose: lilyPoses.hurt(), rate: 20 };
    case 'dead':
      return { pose: lilyPoses.dead(), rate: 5 };
    default:
      return { pose: lilyPoses.idle(time), rate: 6 };
  }
}

function migiumPose(): { pose: Pose; rate: number } {
  switch (params.animation) {
    case 'walk':
      return { pose: migiumPoses.walk(time * 5), rate: 10 };
    case 'cast':
      return { pose: migiumPoses.cast(phase(1)), rate: 14 };
    case 'release':
      return { pose: migiumPoses.release(), rate: 30 };
    case 'cast loop': {
      const k = phase(2.2);
      if (k < 0.5) return { pose: migiumPoses.cast(k / 0.5), rate: 14 };
      if (k < 0.65) return { pose: migiumPoses.release(), rate: 30 };
      return { pose: migiumPoses.idle(time), rate: 6 };
    }
    case 'hurt':
      return { pose: migiumPoses.hurt(), rate: 20 };
    default:
      return { pose: migiumPoses.idle(time), rate: 6 };
  }
}

/** Lay De Rol Le's head and segments along a curve (in game, the boss does this from its swim trail). */
function poseDeRolLe(m: DeRolLeModel): void {
  const a = params.animation;
  const lying = a === 'lying across deck';
  const curve = (s: number): THREE.Vector3 => {
    if (lying) return new THREE.Vector3(-s, 0.8, 0);
    const w = a === 'swim' ? time * 2 : 0;
    return new THREE.Vector3(Math.sin(s * 0.35 - w) * 1.6, 1.4 + Math.max(0, 2.2 - s * 0.6), -s);
  };
  const rear = a === 'roar' || a === 'beam charge' || a === 'phase 2';
  const head = rear ? new THREE.Vector3(0, 3.6, 1.2) : curve(0);
  m.head.position.copy(head);
  m.head.rotation.set(rear ? 0.2 : 0, lying ? -Math.PI / 2 : 0, 0);
  m.segs.forEach((g, i) => {
    const s = 1.5 + (i + 1) * 2.1;
    const q = curve(s - 0.7).sub(curve(s + 0.7));
    g.position.copy(curve(s));
    g.rotation.set(-Math.atan2(q.y, Math.hypot(q.x, q.z)), Math.atan2(q.x, q.z), 0);
  });
  const p2 = a === 'phase 2';
  m.mask.visible = !p2;
  m.plates.forEach((pl) => (pl.visible = !p2));
  m.pose({
    jaw: a === 'roar' || p2 ? 0.6 + Math.sin(time * 6) * 0.4 : a === 'beam charge' ? 0.6 : 0.2,
    flash: false, exposed: p2, enraged: false, weak: 0, charge: a === 'beam charge' ? phase(1.5) : 0, time,
  });
}

function dragonPose(): DragonPoseParams {
  const p: DragonPoseParams = {
    neckPitch: 0, jaw: 0, bodyLift: 0, bodyPitch: 0, wingFlap: 0.25 + Math.sin(time * 2) * 0.12, flame: 0, weak: 0,
    headColor: 0x9a2c1c, flash: false, enraged: false, walk: NaN, time,
  };
  const k = phase(1.4);
  switch (params.animation) {
    case 'walk':
      p.walk = time * 4;
      break;
    case 'roar':
      p.neckPitch = -0.7;
      p.jaw = 1;
      p.wingFlap = 0.5 + Math.sin(time * 10) * 0.5;
      break;
    case 'stomp windup':
      p.bodyPitch = -0.35 * k;
      p.bodyLift = 1.2 * k;
      p.wingFlap = 0.3 + Math.sin(time * 12) * 0.5 * k;
      break;
    case 'breath':
      p.neckPitch = 0.15;
      p.jaw = 1;
      p.flame = 0.6 + Math.random() * 0.3;
      p.headColor = 0xff8030;
      break;
    case 'charge':
      p.neckPitch = 0.35;
      p.bodyPitch = 0.15;
      p.wingFlap = Math.sin(time * 14) * 0.4;
      p.walk = time * 9;
      break;
    case 'stunned (weak point)':
      p.neckPitch = 0.75;
      p.bodyPitch = 0.15;
      p.weak = 0.45 + Math.sin(time * 8) * 0.2;
      p.headColor = 0xffe080;
      p.jaw = 0.3;
      break;
    case 'dead':
      p.bodyLift = -1.6 * k;
      p.bodyPitch = 0.4 * k;
      p.neckPitch = 0.9 * k;
      p.wingFlap = -0.3;
      p.jaw = 0.6;
      break;
  }
  return p;
}

function gunbotPose(): { pose: Pose; rate: number } {
  const k = phase(1.2);
  switch (params.animation) {
    case 'walk':
      return { pose: gunbotPoses.walk(time * 5), rate: 10 };
    case 'aim':
      return { pose: gunbotPoses.aim(Math.min(1, k * 2)), rate: 14 };
    case 'fire':
      return { pose: gunbotPoses.fire(), rate: 30 };
    case 'swipe windup':
      return { pose: gunbotPoses.windup(k), rate: 20 };
    case 'swipe':
      return { pose: gunbotPoses.strike(), rate: 35 };
    case 'hurt':
      return { pose: gunbotPoses.hurt(), rate: 22 };
    case 'offline':
      return { pose: gunbotPoses.offline(), rate: 8 };
    default:
      return { pose: gunbotPoses.idle(time), rate: 6 };
  }
}

function garanzPose(): { pose: Pose; rate: number } {
  const k = phase(1.5);
  switch (params.animation) {
    case 'walk':
      return { pose: garanzPoses.walk(time * 4), rate: 10 };
    case 'plant':
      return { pose: garanzPoses.plant(Math.min(1, k * 1.5)), rate: 10 };
    case 'fire':
      return { pose: k % 0.2 < 0.05 ? garanzPoses.fire() : garanzPoses.plant(1), rate: 25 };
    case 'stomp windup':
      return { pose: garanzPoses.stompWindup(k), rate: 14 };
    case 'stomp':
      return { pose: garanzPoses.stomp(), rate: 35 };
    case 'hurt':
      return { pose: garanzPoses.hurt(), rate: 22 };
    case 'dead':
      return { pose: garanzPoses.dead(), rate: 4 };
    default:
      return { pose: garanzPoses.idle(time), rate: 6 };
  }
}

function sinowPose(): { pose: Pose; rate: number } {
  const k = phase(0.36);
  switch (params.animation) {
    case 'run':
      return { pose: sinowPoses.run(time * 9), rate: 12 };
    case 'crouch':
      return { pose: sinowPoses.crouch(phase(0.8)), rate: 16 };
    case 'leap':
      return { pose: sinowPoses.leap(), rate: 20 };
    case 'slash 1':
      return { pose: sinowPoses.slash(0, Math.min(1, k * 3)), rate: 35 };
    case 'slash 2':
      return { pose: sinowPoses.slash(1, Math.min(1, k * 3)), rate: 35 };
    case 'slash 3 (burns)':
      return { pose: sinowPoses.slash(2, Math.min(1, k * 3)), rate: 35 };
    case 'combo loop': {
      const i = Math.floor((params.playing ? time : params.scrub * 1.08) / 0.36) % 3;
      return { pose: sinowPoses.slash(i, Math.min(1, k * 3)), rate: 35 };
    }
    case 'hurt':
      return { pose: sinowPoses.hurt(), rate: 22 };
    default:
      return { pose: sinowPoses.idle(time), rate: 6 };
  }
}

const wardenL = new THREE.Vector3();
const wardenR = new THREE.Vector3();

function poseWarden(w: WardenModel): void {
  const a = params.animation;
  const rest = WARDEN_HAND_REST;
  wardenL.set(-rest.x, rest.y, rest.z);
  wardenR.copy(rest);
  if (a === 'slam') {
    // Raise over a spot on the deck, then slam down.
    const k = phase(1.8);
    wardenR.set(6, k < 0.7 ? 1 + (k / 0.7) * 5.5 : Math.max(rest.y, 6.5 - ((k - 0.7) / 0.08) * 6), 9);
  } else if (a === 'floor pattern') {
    wardenL.set(-7.5, 6.5, 4.5);
    wardenR.set(7.5, 6.5, 4.5);
  } else if (a === 'lockdown (reach)') {
    wardenL.set(-4, 4.5, 12);
  }
  w.pose({
    charge: a === 'slam' || a === 'lockdown (reach)' ? 1 : 0.2,
    cast: a === 'floor pattern' ? 1 : 0,
    coreOpen: a === 'vent (core open)' ? 1 : 0,
    handL: wardenL,
    handR: wardenR,
    dead: a === 'dead' ? Math.min(1, phase(2) * 1.5) : 0,
    flash: false,
    enraged: a === 'enraged',
    time,
  });
}

function poseRig(rig: Rig, pr: { pose: Pose; rate: number }, dt: number, snap: boolean): void {
  rig.apply(pr.pose, snap ? 1 : dt, snap ? Infinity : pr.rate);
}

function tick(dt: number, snap = false): void {
  if (human) {
    const hp = humanPose();
    poseRig(human.rig, hp, dt, snap);
    humanHold.update(human, snap ? 1 / 60 : dt, hp.hold ?? null, params.weapon === 'none' ? -0.085 : (LEFT_HAND_AT[params.weapon] ?? -0.085), snap);
    // Hair and cloth: the run plays in place, so pass the running speed along.
    human.update?.(snap ? 1 / 60 : dt, params.animation === 'run' ? new THREE.Vector3(0, 0, playerCfg.moveSpeed).applyQuaternion(human.rig.root.getWorldQuaternion(new THREE.Quaternion())) : undefined);
  }
  if (booma) poseRig(booma.rig, boomaPose(), dt, snap);
  if (brute) poseRig(brute.rig, boomaPose(), dt, snap);
  if (lily) poseRig(lily.rig, lilyPose(), dt, snap);
  if (migium) poseRig(migium.rig, migiumPose(), dt, snap);
  if (drl) poseDeRolLe(drl);
  if (gunbot) poseRig(gunbot.rig, gunbotPose(), dt, snap);
  if (garanz) poseRig(garanz.rig, garanzPose(), dt, snap);
  if (sinow) poseRig(sinow.rig, sinowPose(), dt, snap);
  if (node) {
    poseRig(node.rig, { pose: params.animation === 'destroyed' ? nodePoses.hurt() : nodePoses.idle(time), rate: 6 }, dt, snap);
    node.update(time, params.animation === 'destroyed' ? 0 : 1);
  }
  if (warden) poseWarden(warden);
  if (dragon) dragon.pose(dragonPose());
  // Owners stand facing the camera (+Z) so each Mag sits at its usual shoulder offset.
  mags.forEach((m, i) => m.update(snap ? 0 : dt, magOwner(i), Math.PI, false));
}

// -------------------------------------------------------------------- UI

const gui = new GUI({ title: 'Model Viewer' });
gui.add(params, 'model', Object.keys(CATALOGUE)).onChange(build);
const animCtrl = gui.add(params, 'animation', HUMAN_ANIMS);
const weaponCtrl = gui.add(params, 'weapon', ['none', ...Object.keys(weaponKinds)]).onChange(attachWeapon);
gui.add(params, 'playing').name('play');
gui.add(params, 'speed', 0.05, 2, 0.05);
gui.add(params, 'scrub', 0, 1, 0.01).name('scrub (paused)');
gui.add(params, 'turntable');
gui.add(params, 'wireframe').onChange(applyWireframe);
gui.add(params, 'showGrid').name('grid').onChange((v: boolean) => (grid.visible = v));
gui.add({ reframe: () => root && frame(root) }, 'reframe').name('reframe camera');

build();

let last = performance.now();
renderer.setAnimationLoop((now) => {
  const dt = Math.min(0.05, (now - last) / 1000) * params.speed;
  last = now;
  if (params.playing) time += dt;
  tick(params.playing ? dt : 1 / 60, !params.playing);
  if (root && params.turntable) root.rotation.y += dt * 0.6;
  controls.update();
  renderer.render(scene, camera);
});

// Expose for automated screenshots / debugging.
(window as unknown as Record<string, unknown>).viewer = {
  params,
  build,
  frame: () => root && frame(root),
  get root() {
    return root;
  },
  camera,
  controls,
  /** Advance and render without requestAnimationFrame (hidden tabs). */
  step(sec = 0.5) {
    for (let t = 0; t < sec; t += 1 / 60) {
      if (params.playing) time += 1 / 60;
      tick(1 / 60);
    }
    controls.update();
    renderer.render(scene, camera);
  },
};
