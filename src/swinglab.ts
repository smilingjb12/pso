import GUI from 'lil-gui';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Combo } from './game/combo';
import { attackTypes, combo as comboCfg, type AttackType } from './game/config';
import { weaponKinds, type WeaponKind } from './game/data/items';
import { Heroine, PLAYER_LOOK } from './game/models/heroine';
import { humanPoses } from './game/models/humanoid';
import { PLAYER_SWING, SWING_STYLES, swingFrame, WeaponHold, type HoldRequest } from './game/models/swings';
import { holdTwoHanded, LEFT_HAND_AT, type HiltTarget } from './game/models/twoHand';
import { buildWeapon } from './game/models/weapons';

// Swing Lab: the two-handed melee combo styles side by side. Every cell plays the same
// three-hit combo with the weapon's in-game timing, chaining on the perfect beat.

const SLASH_IMPACT = 0.42; // same as Player

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

const MELEE: WeaponKind[] = ['saber', 'sword', 'dagger', 'partisan', 'cane', 'rod', 'wand'];
const SETS: Record<string, string[]> = {
  'M3 diagonals': ['M3', 'D1', 'D2', 'X1', 'X2'],
  'All styles': ['M0', 'M1', 'M2', 'M3', 'M4'],
};
const params = {
  set: 'M3 diagonals',
  weapon: 'sword' as WeaponKind,
  attack: 'light' as AttackType,
  slowMotion: 1,
  view: 'three-quarter',
  playing: true,
  /** Paused: which hit and how far through it. */
  scrubHit: 0,
  scrub: 0.5,
};

interface Cell {
  key: string;
  origin: THREE.Vector3;
  model: Heroine;
  hold: WeaponHold;
  hilt: HiltTarget;
  label: HTMLDivElement;
  border: HTMLDivElement;
}

const KEYS = SETS[params.set];
const COLS = 3;
const ROWS = Math.ceil(KEYS.length / COLS);

const cells: Cell[] = KEYS.map((key, i) => {
  const origin = new THREE.Vector3(i * 40, 0, 0);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(4, 32), new THREE.MeshStandardMaterial({ color: 0x4a7a3e, roughness: 1 }));
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
  const label = document.createElement('div');
  label.className = 'cell-label';
  document.body.appendChild(label);
  const border = document.createElement('div');
  border.className = 'cell-border';
  document.body.appendChild(border);
  return {
    key, origin, model: null as unknown as Heroine, hold: new WeaponHold(),
    hilt: { at: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, 1) }, label, border,
  };
});

const help = document.createElement('div');
help.className = 'cell-label';
help.innerHTML = `<span>How to read this</span><div>Each cell loops the full three-hit combo at the chosen weapon’s in-game speed, chaining on the perfect beat.
Drag to orbit (all cells share the camera), right-drag to pan, wheel to zoom. Use <b style="font-size:12px">time scale</b> for slow motion,
or untick <b style="font-size:12px">play</b> and scrub a single hit.</div>`;
document.body.appendChild(help);

function buildModels(): void {
  for (const c of cells) {
    if (c.model) c.model.rig.root.removeFromParent();
    c.model = new Heroine(PLAYER_LOOK);
    c.model.rig.root.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = true;
    });
    c.model.grip.add(buildWeapon(params.weapon, weaponKinds[params.weapon].color).group);
    c.model.rig.root.position.copy(c.origin);
    scene.add(c.model.rig.root);
    c.hold = new WeaponHold();
  }
}

function labels(): void {
  cells.forEach((c, i) => {
    c.key = SETS[params.set][i];
    const s = SWING_STYLES[c.key];
    const thrust = params.weapon === 'partisan' && !s.oneHanded;
    const desc = thrust ? 'Partisans thrust instead of slashing: same lunge in every style, left hand forward on the shaft.' : s.desc;
    const inGame = s === PLAYER_SWING ? ' <span style="color:#7fe0a0;font-size:12px">· in game</span>' : '';
    c.label.innerHTML = `<b>${c.key}</b><span>${s.name}</span>${inGame}<div>${desc}</div>`;
  });
}

// One combo drives every cell, pressed like a player hitting each perfect window.
const combo = new Combo(comboCfg, attackTypes, () => weaponKinds[params.weapon].timing);
let idleT = 0;
let time = 0;

function driveCombo(dt: number): void {
  if (combo.phase === 'swing') {
    if (!combo.isFinisher && combo.t >= combo.times.windowOpenAt + 0.02) combo.press(params.attack);
  } else if (combo.phase === 'idle') {
    idleT += dt;
    if (idleT > 0.9) {
      idleT = 0;
      combo.press(params.attack);
    }
  }
  combo.update(dt);
}

/** Swing progress k (0..1) with the blow landing at SLASH_IMPACT, exactly as the Player maps it. */
function swingK(): number {
  const { hitAt, duration } = combo.times;
  const t = combo.t;
  return t < hitAt ? (t / hitAt) * SLASH_IMPACT : SLASH_IMPACT + Math.min(1, (t - hitAt) / Math.max(0.01, duration - hitAt)) * (1 - SLASH_IMPACT);
}

/** Pose one cell. `snap`: jump straight to the target (scrubbing). */
function poseCell(c: Cell, swinging: boolean, hitIndex: number, k: number, dt: number, snap: boolean): void {
  const style = SWING_STYLES[c.key];
  const m = c.model;
  let want: HoldRequest | null = null;
  if (!swinging) {
    m.rig.apply(humanPoses.idle(time, 'melee'), dt, snap ? Infinity : 8);
  } else if (params.weapon === 'partisan') {
    m.rig.apply(humanPoses.thrust(hitIndex, k, SLASH_IMPACT), dt, snap ? Infinity : 30);
    if (!style.oneHanded) want = {};
  } else {
    const f = swingFrame(style, hitIndex, k, SLASH_IMPACT, c.hilt);
    m.rig.apply(f.pose, dt, snap ? Infinity : 30);
    if (f.twoHanded) want = { hilt: f.hilt };
  }
  c.hold.update(m, dt, want, LEFT_HAND_AT[params.weapon] ?? -0.085, snap);
  m.update(dt);
}

function tick(dt: number): void {
  time += dt;
  if (params.playing) {
    driveCombo(dt);
    const swinging = combo.phase === 'swing';
    const k = swinging ? swingK() : 0;
    for (const c of cells) poseCell(c, swinging, combo.hitIndex, k, dt, false);
  } else {
    for (const c of cells) poseCell(c, true, params.scrubHit, params.scrub, dt, true);
  }
}

// ---------------------------------------------------------------- view

const master = new THREE.PerspectiveCamera(32, 1, 0.1, 60);
const controls = new OrbitControls(master, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 1.0, 0);
controls.minDistance = 1.5;
controls.maxDistance = 14;
const cams = cells.map(() => new THREE.PerspectiveCamera(32, 1, 0.1, 60));

function placeCamera(): void {
  const views: Record<string, THREE.Vector3> = {
    'three-quarter': new THREE.Vector3(3.2, 1.7, 4.2),
    front: new THREE.Vector3(0, 1.4, 5.4),
    side: new THREE.Vector3(5.4, 1.3, 0.3),
    'behind (game camera)': new THREE.Vector3(-1.2, 2.4, -4.6),
    above: new THREE.Vector3(0.3, 6, 1.5),
  };
  controls.target.set(0, 1.0, 0);
  master.position.copy(views[params.view]);
  controls.update();
}

function layout(): void {
  const w = window.innerWidth / COLS;
  const h = window.innerHeight / ROWS;
  const place = (el: HTMLDivElement, i: number) => {
    el.style.left = `${(i % COLS) * w}px`;
    el.style.top = `${Math.floor(i / COLS) * h}px`;
  };
  cells.forEach((c, i) => {
    place(c.label, i);
    place(c.border, i);
    Object.assign(c.border.style, { width: `${w}px`, height: `${h}px` });
    cams[i].aspect = w / h;
    cams[i].updateProjectionMatrix();
  });
  place(help, cells.length);
  master.aspect = w / h;
  master.updateProjectionMatrix();
}

function render(): void {
  const w = window.innerWidth / COLS;
  const h = window.innerHeight / ROWS;
  renderer.setScissor(0, 0, window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x141c2a);
  renderer.clear();
  cells.forEach((c, i) => {
    cams[i].position.copy(master.position).add(c.origin);
    cams[i].quaternion.copy(master.quaternion);
    const col = i % COLS;
    const row = ROWS - 1 - Math.floor(i / COLS); // WebGL viewport origin is bottom-left
    renderer.setViewport(col * w, row * h, w, h);
    renderer.setScissor(col * w, row * h, w, h);
    renderer.render(scene, cams[i]);
  });
}

/** Worst arm stretch over the whole combo for each style (above ~0.99 a hand can't reach the handle). */
function measure(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of cells) {
    let worst = 0;
    let where = '';
    for (let hit = 0; hit < 3; hit++) {
      for (let k = 0; k <= 1.0001; k += 0.02) {
        const style = SWING_STYLES[c.key];
        if (style.oneHanded) continue;
        const f = swingFrame(style, hit, k, SLASH_IMPACT, c.hilt);
        c.model.rig.apply(f.pose, 1, Infinity);
        const s = holdTwoHanded(c.model, 1, LEFT_HAND_AT[params.weapon] ?? -0.08, f.hilt);
        if (s > worst) {
          worst = s;
          where = `hit ${hit + 1} k=${k.toFixed(2)}`;
        }
      }
    }
    out[c.key] = `${worst.toFixed(3)} at ${where}`;
  }
  return out;
}

const gui = new GUI({ title: 'Swing Lab' });
gui.add(params, 'set', Object.keys(SETS)).name('show').onChange(() => {
  buildModels();
  labels();
});
gui.add(params, 'weapon', MELEE).onChange(() => {
  buildModels();
  labels();
});
gui.add(params, 'attack', ['light', 'heavy']).name('attack type');
gui.add(params, 'slowMotion', 0.05, 1, 0.05).name('time scale');
gui.add(params, 'view', ['three-quarter', 'front', 'side', 'behind (game camera)', 'above']).name('camera preset').onChange(placeCamera);
gui.add({ reset: placeCamera }, 'reset').name('reset camera');
gui.add(params, 'playing').name('play');
gui.add(params, 'scrubHit', { 'hit 1': 0, 'hit 2': 1, 'hit 3': 2 }).name('scrub hit (paused)');
gui.add(params, 'scrub', 0, 1, 0.01).name('scrub (paused)');

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  layout();
});

buildModels();
labels();
layout();
placeCamera();

let last = performance.now();
renderer.setAnimationLoop((now) => {
  const dt = Math.min(0.05, (now - last) / 1000) * params.slowMotion;
  last = now;
  tick(dt);
  controls.update();
  render();
});

(window as unknown as Record<string, unknown>).swinglab = {
  params,
  master,
  controls,
  placeCamera,
  buildModels,
  measure,
  labels,
  cells,
  step(sec = 0.5) {
    for (let t = 0; t < sec; t += 1 / 60) tick(1 / 60);
    render();
  },
};
