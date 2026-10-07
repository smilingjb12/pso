import GUI from 'lil-gui';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { player as playerCfg } from './game/config';
import { weaponKinds, type WeaponKind } from './game/data/items';
import { gaitPose, PLAYER_GAIT, scaleGait } from './game/models/gait';
import { ACCESSORIES, ARMORS, BACKS, BODIES, FACES, GLOWS, HAIRS, Heroine, LOOKS, OUTFITS, PALETTES, type Look } from './game/models/heroine';
import { humanPoses, type Grip } from './game/models/humanoid';
import { buildWeapon, WEAPON_GRIP } from './game/models/weapons';

// Character Lab: variations of the player heroine side by side. Pick a
// category to vary one element (hair, outfit, ...) while the others stay at
// the current pick. Click a preview to make it the current pick.

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.setScissorTest(true);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1c2638);
scene.fog = new THREE.Fog(0x1c2638, 10, 24);
scene.add(new THREE.HemisphereLight(0xdfeaff, 0x40403a, 1.25));

type Category = 'Full looks' | 'Proportions' | 'Hair' | 'Outfit' | 'Accessory' | 'Face gear' | 'Glow' | 'Armour' | 'Back tech' | 'Colours';
const FIELD: Record<Exclude<Category, 'Full looks'>, keyof Look> = {
  Proportions: 'body',
  Hair: 'hair',
  Outfit: 'outfit',
  Accessory: 'accessory',
  'Face gear': 'face',
  Glow: 'glow',
  Armour: 'armor',
  'Back tech': 'back',
  Colours: 'palette',
};
const CATALOG: Record<Exclude<Category, 'Full looks'>, Record<string, { name: string; desc?: string }>> = {
  Proportions: BODIES,
  Hair: HAIRS,
  Outfit: OUTFITS,
  Accessory: ACCESSORIES,
  'Face gear': FACES,
  Glow: GLOWS,
  Armour: ARMORS,
  'Back tech': BACKS,
  Colours: PALETTES,
};

const params = {
  category: 'Full looks' as Category,
  animation: 'idle',
  speed: playerCfg.moveSpeed,
  timeScale: 1,
  view: 'full body',
  weapon: 'none' as WeaponKind | 'none',
  /** Show one preview full-screen (-1 = grid). */
  solo: -1,
};
const pick: Look = { ...LOOKS.L1.look };

const GRIPS = WEAPON_GRIP;

function stripeTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#4a5a72';
  g.fillRect(0, 0, 64, 128);
  g.fillStyle = '#425068';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = 'rgba(255,255,255,0.18)';
  g.fillRect(0, 0, 64, 3);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface Cell {
  key: string;
  look: Look;
  origin: THREE.Vector3;
  model: Heroine | null;
  holder: THREE.Group;
  tex: THREE.CanvasTexture;
  camera: THREE.PerspectiveCamera;
  label: HTMLDivElement;
  border: HTMLDivElement;
  u: number;
}

const cells: Cell[] = Array.from({ length: 9 }, (_, i) => {
  const origin = new THREE.Vector3(i * 40, 0, 0);
  const tex = stripeTexture();
  tex.repeat.set(1, 20);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(6, 40), new THREE.MeshStandardMaterial({ map: tex, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.copy(origin);
  ground.receiveShadow = true;
  scene.add(ground);
  const sun = new THREE.DirectionalLight(0xffffff, 1.7);
  sun.position.copy(origin).add(new THREE.Vector3(2.5, 6, 5));
  sun.target.position.copy(origin);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = sun.shadow.camera.bottom = -2;
  sun.shadow.camera.right = sun.shadow.camera.top = 2;
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
  return { key: '', look: { ...pick }, origin, model: null, holder, tex, camera: new THREE.PerspectiveCamera(30, 1, 0.05, 60), label, border, u: i * 0.17 };
});

const master = new THREE.PerspectiveCamera(30, 1, 0.05, 60);
const controls = new OrbitControls(master, renderer.domElement);
controls.enableDamping = true;
controls.minDistance = 0.4;
controls.maxDistance = 12;
controls.maxPolarAngle = Math.PI * 0.55;

/** Keys shown in the grid for the current category. */
function variantKeys(): string[] {
  return params.category === 'Full looks' ? Object.keys(LOOKS) : Object.keys(CATALOG[params.category]);
}

function lookFor(key: string): Look {
  if (params.category === 'Full looks') return { ...LOOKS[key].look, colors: pick.colors };
  return { ...pick, [FIELD[params.category]]: key };
}

function isPicked(c: Cell): boolean {
  return (Object.keys(pick) as (keyof Look)[]).every((k) => k === 'colors' || pick[k] === c.look[k]);
}

function rebuild(): void {
  const keys = variantKeys();
  cells.forEach((c, i) => {
    c.holder.clear();
    c.model = null;
    c.key = keys[i] ?? '';
    c.label.style.display = c.border.style.display = c.key ? '' : 'none';
    if (!c.key) return;
    c.look = lookFor(c.key);
    c.model = new Heroine(c.look);
    if (params.weapon !== 'none') c.model.grip.add(buildWeapon(params.weapon, weaponKinds[params.weapon].color).group);
    c.holder.add(c.model.rig.root);
    let name: string;
    let desc: string;
    if (params.category === 'Full looks') {
      const l = c.look;
      name = LOOKS[c.key].name;
      desc = `${OUTFITS[l.outfit].name} · ${ACCESSORIES[l.accessory].name} · ${FACES[l.face].name} · ${GLOWS[l.glow].name} · armour: ${ARMORS[l.armor].name} · ${BACKS[l.back].name}`;
      desc += `<br>${l.body} ${l.hair} ${l.outfit} ${l.accessory} ${l.face} ${l.palette} ${l.glow} ${l.armor} ${l.back}`;
    } else {
      const e = CATALOG[params.category][c.key];
      name = e.name;
      desc = e.desc ?? '';
    }
    c.label.innerHTML = `<b>${c.key}</b><span>${name}</span><div>${desc}</div>`;
  });
  refreshPicks();
}

function refreshPicks(): void {
  for (const c of cells) c.border.classList.toggle('picked', !!c.key && isPicked(c));
  const p = pick;
  document.getElementById('picks')!.innerHTML =
    `Current pick: <b>${p.body}</b> ${BODIES[p.body].name} · <b>${p.hair}</b> ${HAIRS[p.hair].name} · <b>${p.outfit}</b> ${OUTFITS[p.outfit].name} · ` +
    `<b>${p.accessory}</b> ${ACCESSORIES[p.accessory].name} · <b>${p.palette}</b> ${PALETTES[p.palette].name}<br>` +
    `<b>${p.face}</b> ${FACES[p.face].name} · <b>${p.glow}</b> ${GLOWS[p.glow].name} · <b>${p.armor}</b> armour: ${ARMORS[p.armor].name} · <b>${p.back}</b> ${BACKS[p.back].name}` +
    (p.colors ? ` · custom colours: hair ${hex(p.colors.hair)}, outfit ${hex(p.colors.main)}, trim ${hex(p.colors.second)}, glow ${hex(p.colors.accent)}` : '');
  for (const c of Object.values(pickCtl)) c.updateDisplay();
  if (!colorState.custom) syncColors();
}

const hex = (n?: number) => (n === undefined ? '—' : `#${n.toString(16).padStart(6, '0')}`);

/** Colour overrides (hair, outfit, trim, glow) on top of the chosen palette. */
const colorState = { custom: false, hair: '#000000', main: '#000000', second: '#000000', accent: '#000000' };
const COLOR_KEYS = ['hair', 'main', 'second', 'accent'] as const;
function syncColors(): void {
  const pal = PALETTES[pick.palette];
  for (const k of COLOR_KEYS) colorState[k] = hex(pick.colors?.[k] ?? pal[k]);
  for (const c of colorCtl) c.updateDisplay();
}
function applyColors(): void {
  pick.colors = colorState.custom ? Object.fromEntries(COLOR_KEYS.map((k) => [k, parseInt(colorState[k].slice(1), 16)])) : undefined;
  rebuild();
}

function grid(): { cols: number; rows: number; w: number; h: number } {
  if (params.solo >= 0) return { cols: 1, rows: 1, w: window.innerWidth, h: window.innerHeight };
  const n = Math.max(1, variantKeys().length);
  const cols = n <= 4 ? n : 3;
  const rows = Math.ceil(n / cols);
  return { cols, rows, w: window.innerWidth / cols, h: window.innerHeight / rows };
}

function layout(): void {
  const { cols, w, h } = grid();
  cells.forEach((c, i) => {
    const slot = params.solo >= 0 ? (i === params.solo ? 0 : -1) : i;
    c.label.style.visibility = c.border.style.visibility = slot < 0 ? 'hidden' : '';
    const col = Math.max(0, slot) % cols;
    const row = Math.floor(Math.max(0, slot) / cols);
    c.label.style.left = `${col * w}px`;
    c.label.style.top = `${row * h}px`;
    c.label.style.maxWidth = `${w - 20}px`;
    Object.assign(c.border.style, { left: `${col * w}px`, top: `${row * h}px`, width: `${w}px`, height: `${h}px` });
    c.camera.aspect = w / h;
    c.camera.updateProjectionMatrix();
  });
  master.aspect = w / h;
  master.updateProjectionMatrix();
}

function placeCamera(): void {
  const views: Record<string, [THREE.Vector3, THREE.Vector3]> = {
    'full body': [new THREE.Vector3(1.6, 1.35, 4.2), new THREE.Vector3(0, 0.88, 0)],
    face: [new THREE.Vector3(0.35, 1.55, 1.05), new THREE.Vector3(0, 1.5, 0)],
    'upper body': [new THREE.Vector3(0.7, 1.4, 2.0), new THREE.Vector3(0, 1.25, 0)],
    side: [new THREE.Vector3(4.4, 1.2, 0), new THREE.Vector3(0, 0.88, 0)],
    back: [new THREE.Vector3(-1.2, 1.4, -4.2), new THREE.Vector3(0, 0.95, 0)],
  };
  const [pos, target] = views[params.view];
  master.position.copy(pos);
  controls.target.copy(target);
  controls.update();
}

function syncCameras(): void {
  for (const c of cells) {
    c.camera.position.copy(master.position).add(c.origin);
    c.camera.quaternion.copy(master.quaternion);
  }
}

let time = 0;
function tick(dt: number): void {
  time += dt;
  const grip: Grip = params.weapon === 'none' ? 'none' : GRIPS[params.weapon];
  const running = params.animation === 'run';
  for (const c of cells) {
    if (!c.model) continue;
    let extra: THREE.Vector3 | undefined;
    if (running) {
      const g = PLAYER_GAIT;
      c.u = (c.u + (params.speed * dt) / scaleGait(g, params.speed).cycleLength) % 1;
      c.model.rig.apply(gaitPose(c.u, g, c.model.legs, grip, params.speed), dt, Infinity);
      c.tex.offset.y -= (params.speed * dt) / 2;
      // The treadmill does not move the model: tell the hair/cloth how fast it is going.
      extra = new THREE.Vector3(0, 0, params.speed).applyQuaternion(c.holder.quaternion);
      c.holder.rotation.y = 0;
    } else {
      c.model.rig.apply(humanPoses.idle(time + c.u * 5, grip), dt, 8);
      c.holder.rotation.y = params.animation === 'turntable' ? time * 0.6 : 0;
    }
    c.model.update(dt, extra);
  }
}

function render(): void {
  syncCameras();
  const { cols, rows, w, h } = grid();
  cells.forEach((c, i) => {
    if (!c.key) return;
    const slot = params.solo >= 0 ? (i === params.solo ? 0 : -1) : i;
    if (slot < 0) return;
    const col = slot % cols;
    const row = rows - 1 - Math.floor(slot / cols);
    renderer.setViewport(col * w, row * h, w, h);
    renderer.setScissor(col * w, row * h, w, h);
    renderer.render(scene, c.camera);
  });
}

// Click (not drag) on a preview makes it the current pick.
let down: { x: number; y: number } | null = null;
renderer.domElement.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY }));
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
  const { cols, w, h } = grid();
  const i = params.solo >= 0 ? params.solo : Math.floor(e.clientY / h) * cols + Math.floor(e.clientX / w);
  const c = cells[i];
  if (!c?.key) return;
  Object.assign(pick, c.look);
  refreshPicks();
});

const gui = new GUI({ title: 'Character Lab' });
gui.add(params, 'category', ['Full looks', 'Proportions', 'Hair', 'Outfit', 'Accessory', 'Face gear', 'Glow', 'Armour', 'Back tech', 'Colours']).name('compare').onChange(() => {
  rebuild();
  layout();
});
gui.add(params, 'animation', ['idle', 'run', 'turntable']);
gui.add(params, 'speed', 1, 6, 0.1).name('run speed (m/s)');
gui.add(params, 'timeScale', 0.05, 1, 0.05).name('time scale');
gui.add(params, 'view', ['full body', 'upper body', 'face', 'side', 'back']).name('camera preset').onChange(placeCamera);
gui.add({ reset: placeCamera }, 'reset').name('reset camera');
gui.add(params, 'weapon', ['none', ...Object.keys(weaponKinds)]).onChange(rebuild);
const picks = gui.addFolder('Current pick (click a preview, or set here)');
const pickCtl = {
  body: picks.add(pick, 'body', Object.keys(BODIES)).name('proportions'),
  hair: picks.add(pick, 'hair', Object.keys(HAIRS)),
  outfit: picks.add(pick, 'outfit', Object.keys(OUTFITS)),
  accessory: picks.add(pick, 'accessory', Object.keys(ACCESSORIES)),
  face: picks.add(pick, 'face', Object.keys(FACES)).name('face gear'),
  palette: picks.add(pick, 'palette', Object.keys(PALETTES)).name('colours'),
  glow: picks.add(pick, 'glow', Object.keys(GLOWS)),
  armor: picks.add(pick, 'armor', Object.keys(ARMORS)).name('armour'),
  back: picks.add(pick, 'back', Object.keys(BACKS)).name('back tech'),
};
for (const c of Object.values(pickCtl)) c.onChange(() => (params.category === 'Full looks' ? refreshPicks() : rebuild()));
const colors = gui.addFolder('Colours (override the palette)');
colors.add(colorState, 'custom').name('use custom colours').onChange(applyColors);
const colorCtl = [
  colors.addColor(colorState, 'hair').name('hair'),
  colors.addColor(colorState, 'main').name('outfit'),
  colors.addColor(colorState, 'second').name('trim / 2nd'),
  colors.addColor(colorState, 'accent').name('glow / accent'),
];
for (const c of colorCtl)
  c.onFinishChange(() => {
    colorState.custom = true;
    colors.controllers[0].updateDisplay();
    applyColors();
  });

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  layout();
});

rebuild();
layout();
placeCamera();

let last = performance.now();
renderer.setAnimationLoop((now) => {
  const dt = Math.min(0.05, (now - last) / 1000) * params.timeScale;
  last = now;
  tick(dt);
  controls.update();
  render();
});

(window as unknown as Record<string, unknown>).charlab = {
  params,
  pick,
  rebuild,
  layout,
  placeCamera,
  master,
  controls,
  cells,
  gui,
  solo(i = -1) {
    params.solo = i;
    layout();
    render();
  },
  step(sec = 0.5) {
    for (let t = 0; t < sec; t += 1 / 60) tick(1 / 60);
    controls.update();
    render();
  },
};
