import GUI from 'lil-gui';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { weaponKinds, type WeaponKind } from './game/data/items';
import { GAITS, gaitPose, PLAYER_GAIT, scaleGait, TRAILS, type GaitStyle } from './game/models/gait';
import { Heroine, PLAYER_LOOK, type CharacterModel } from './game/models/heroine';
import { Humanoid, STYLES, type Grip } from './game/models/humanoid';
import { buildWeapon, WEAPON_GRIP } from './game/models/weapons';

// Run Lab: the candidate run cycles side by side, each on a scrolling
// "treadmill" so you can judge whether planted feet stick to the ground.

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.setScissorTest(true);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1c2638);
scene.fog = new THREE.Fog(0x1c2638, 9, 22);
scene.add(new THREE.HemisphereLight(0xcfe4ff, 0x3a3a30, 1.2));

const SETS: Record<string, string[]> = {
  'Picked (K2 + F)': ['K2F', 'K2', 'F', 'L1', 'K1', 'K3'],
  'Knee height': ['L1', 'K1', 'K2', 'K3', 'K4', 'K5'],
  'Wind-swept arms': ['ARMS', 'W1', 'W2', 'W3', 'W4', 'W5'],
  'Lean variations': ['B', 'L1', 'L2', 'L3', 'L4', 'L5'],
  'B variations': ['B', 'B1', 'B2', 'B3', 'B4', 'B5'],
  'Originals A–F': ['A', 'B', 'C', 'D', 'E', 'F'],
};

const params = {
  set: 'Picked (K2 + F)',
  /** Legs under the wind-swept arm options. */
  legs: 'K1',
  character: 'Player',
  speed: 4.6,
  slowMotion: 1,
  view: 'side',
  weapon: 'saber' as WeaponKind | 'none',
  playing: true,
  scrub: 0,
};
const CHARACTERS: Record<string, keyof typeof STYLES | 'player'> = {
  Player: 'player',
  'RAmarl (Ranger)': 'ranger',
  'HUmar (Hunter)': 'hunter',
  'FOmarl (Force)': 'force',
};
const GRIPS = WEAPON_GRIP;

/** The gait a cell shows: arm options ride on the legs picked in the panel. */
function gaitFor(key: string): GaitStyle {
  if (key === 'ARMS') return GAITS[params.legs];
  if (TRAILS[key]) return { ...GAITS[params.legs], trail: TRAILS[key] };
  return GAITS[key];
}

// Striped ground texture: 1 m stripes make foot sliding obvious.
function stripeTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#4a7a3e';
  g.fillRect(0, 0, 64, 128);
  g.fillStyle = '#3e6a34';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = 'rgba(255,255,255,0.25)';
  g.fillRect(0, 0, 64, 3);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface Cell {
  key: string;
  origin: THREE.Vector3;
  model: CharacterModel | null;
  holder: THREE.Group;
  tex: THREE.CanvasTexture;
  camera: THREE.PerspectiveCamera;
  label: HTMLDivElement;
  border: HTMLDivElement;
}

const keys = SETS[params.set];
const cells: Cell[] = keys.map((key, i) => {
  const origin = new THREE.Vector3(i * 40, 0, 0);
  const tex = stripeTexture();
  tex.repeat.set(1, 20); // 2 m texture period over a 40 m strip => 1 m stripes
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(6, 40), new THREE.MeshStandardMaterial({ map: tex, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.copy(origin);
  ground.receiveShadow = true;
  scene.add(ground);
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.copy(origin).add(new THREE.Vector3(3, 8, 4));
  sun.target.position.copy(origin);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  scene.add(sun, sun.target);
  const holder = new THREE.Group();
  holder.position.copy(origin);
  scene.add(holder);
  const label = document.createElement('div');
  label.className = 'cell-label';
  document.body.appendChild(label);
  const border = document.createElement('div');
  border.className = 'cell-border';
  document.body.appendChild(border);
  return { key, origin, model: null, holder, tex, camera: new THREE.PerspectiveCamera(32, 1, 0.1, 60), label, border };
});

// One shared camera, expressed relative to "a character at the origin".
// Orbit / pan / zoom it anywhere on the page; every preview copies its view.
const master = new THREE.PerspectiveCamera(32, 1, 0.1, 60);
const controls = new OrbitControls(master, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 0.8, 0);
controls.minDistance = 1.5;
controls.maxDistance = 14;
controls.maxPolarAngle = Math.PI * 0.53;

/** Point the six cells at a gait set and refresh their labels. */
function applySet(): void {
  SETS[params.set].forEach((key, i) => {
    const c = cells[i];
    c.key = key;
    (c as Cell & { u?: number }).u = 0;
    const current = params.set === 'Lean variations';
    let name: string;
    let desc: string;
    if (key === 'ARMS') {
      name = 'Arms as today';
      desc = `Pumping arms, on legs ${params.legs} (${GAITS[params.legs].name}) for comparison.`;
    } else if (TRAILS[key]) {
      name = TRAILS[key].name;
      desc = `${TRAILS[key].desc} Legs: ${params.legs}.`;
    } else if (key === 'L1' && params.set !== 'Lean variations' && params.set !== 'B variations') {
      name = 'L1 · previous in-game run';
      desc = 'The swinging foot is still high when it reaches forward, so the thigh lifts ~53°.';
    } else if (key === 'B' && params.set !== 'Originals A–F') {
      name = current ? 'B · current (upright)' : 'B · original settings';
      desc = current ? 'The in-game run today: torso ~4° forward, head held vertical.' : 'B as before, but with the smoothness fixes (foot path, knee, upright torso).';
    } else {
      name = GAITS[key].name;
      desc = GAITS[key].desc;
    }
    const inGame = GAITS[key] === PLAYER_GAIT ? ' <span style="color:#7fe0a0;font-size:12px">· in game</span>' : '';
    c.label.innerHTML = `<b>${key === 'ARMS' ? params.legs : key}</b><span>${name}</span>${inGame}<div>${desc}</div>`;
  });
}

function buildModels(): void {
  for (const c of cells) {
    c.holder.clear();
    const key = CHARACTERS[params.character];
    c.model = key === 'player' ? new Heroine(PLAYER_LOOK) : new Humanoid(STYLES[key]);
    c.model.rig.root.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = true;
    });
    if (params.weapon !== 'none') c.model.grip.add(buildWeapon(params.weapon, weaponKinds[params.weapon].color).group);
    c.holder.add(c.model.rig.root);
  }
}

function layout(): void {
  const cols = 3;
  const rows = Math.ceil(cells.length / cols);
  const w = window.innerWidth / cols;
  const h = window.innerHeight / rows;
  cells.forEach((c, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    c.label.style.left = `${col * w}px`;
    c.label.style.top = `${row * h}px`;
    Object.assign(c.border.style, { left: `${col * w}px`, top: `${row * h}px`, width: `${w}px`, height: `${h}px` });
    c.camera.aspect = w / h;
    c.camera.updateProjectionMatrix();
  });
  master.aspect = w / h;
  master.updateProjectionMatrix();
}

function placeCameras(): void {
  const views: Record<string, THREE.Vector3> = {
    side: new THREE.Vector3(5.6, 1.1, 0),
    'three-quarter': new THREE.Vector3(4.3, 1.6, 3.5),
    front: new THREE.Vector3(0.4, 1.2, 5.6),
    back: new THREE.Vector3(0.4, 1.6, -5.6),
  };
  controls.target.set(0, 0.8, 0);
  master.position.copy(views[params.view]);
  controls.update();
}

/** Copy the shared view onto each cell's camera, offset to that cell's character. */
function syncCameras(): void {
  for (const c of cells) {
    c.camera.position.copy(master.position).add(c.origin);
    c.camera.quaternion.copy(master.quaternion);
  }
}

function tick(dt: number): void {
  const travelled = params.speed * dt;
  for (const c of cells) {
    const g = gaitFor(c.key);
    // Each gait has its own cadence for the same speed; keep per-cell phase.
    const cellPhase = (c as Cell & { u?: number }).u ?? 0;
    const cycle = scaleGait(g, params.speed).cycleLength;
    const u = params.playing ? (cellPhase + travelled / cycle) % 1 : params.scrub;
    (c as Cell & { u?: number }).u = u;
    if (c.model) {
      const grip: Grip = params.weapon === 'none' ? 'none' : GRIPS[params.weapon];
      c.model.rig.apply(gaitPose(u, g, c.model.legs, grip, params.speed), 1, Infinity);
      c.model.update?.(dt, params.playing ? new THREE.Vector3(0, 0, params.speed) : undefined);
    }
    // Ground scrolls backward at running speed (planted feet should stick to it).
    // One texture period is 2 m (40 m strip, 20 repeats).
    if (params.playing) c.tex.offset.y -= travelled / 2;
  }
}

function render(): void {
  syncCameras();
  const cols = 3;
  const rows = Math.ceil(cells.length / cols);
  const w = window.innerWidth / cols;
  const h = window.innerHeight / rows;
  cells.forEach((c, i) => {
    const col = i % cols;
    const row = rows - 1 - Math.floor(i / cols); // WebGL viewport origin is bottom-left
    renderer.setViewport(col * w, row * h, w, h);
    renderer.setScissor(col * w, row * h, w, h);
    renderer.render(scene, c.camera);
  });
}

const gui = new GUI({ title: 'Run Lab' });
gui.add(params, 'set', Object.keys(SETS)).name('show').onChange(applySet);
gui.add(params, 'legs', ['L1', 'K1', 'K2', 'K3', 'K4', 'K5']).name('legs (arm options)').onChange(applySet);
gui.add(params, 'character', Object.keys(CHARACTERS)).onChange(buildModels);
gui.add(params, 'speed', 1, 6, 0.1).name('speed (m/s)');
gui.add(params, 'slowMotion', 0.05, 1, 0.05).name('time scale');
gui.add(params, 'view', ['three-quarter', 'side', 'front', 'back']).name('camera preset').onChange(placeCameras);
gui.add({ reset: placeCameras }, 'reset').name('reset camera');
gui.add(params, 'weapon', ['none', ...Object.keys(weaponKinds)]).onChange(buildModels);
gui.add(params, 'playing').name('play');
gui.add(params, 'scrub', 0, 1, 0.01).name('scrub (paused)');

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  layout();
});

applySet();
buildModels();
layout();
placeCameras();

let last = performance.now();
renderer.setAnimationLoop((now) => {
  const dt = Math.min(0.05, (now - last) / 1000) * params.slowMotion;
  last = now;
  tick(dt);
  controls.update();
  render();
});

(window as unknown as Record<string, unknown>).runlab = {
  params,
  placeCameras,
  applySet,
  buildModels,
  master,
  controls,
  step(sec = 0.5) {
    for (let t = 0; t < sec; t += 1 / 60) tick(1 / 60);
    render();
  },
};
