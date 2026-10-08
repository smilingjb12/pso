import GUI from 'lil-gui';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { player as playerCfg } from './game/config';
import { itemDefs, weaponKinds, type ArmorLine, type WeaponKind } from './game/data/items';
import { LEAD_FORMS, STAGE1, type MagStat } from './game/mag';
import { GAITS, gaitPose, scaleGait } from './game/models/gait';
import { BODIES, EVOLUTIONS, FACES, HAIRS, Heroine, LINE_OUTFIT, PALETTES, TIER_STAGE, type Look } from './game/models/heroine';
import { humanPoses } from './game/models/humanoid';
import { MagCompanion } from './game/models/mag';
import { buildWeapon, WEAPON_GRIP } from './game/models/weapons';

// Armor Lab: the armour evolutions side by side. Each armour line dresses the
// heroine in its own outfit; the frame's tier picks the evolution stage (0-5).

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.setScissorTest(true);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1c2638);
scene.add(new THREE.HemisphereLight(0xdfeaff, 0x40403a, 1.25));
// One shadow-casting sun, moved over each cell before it renders (15 shadow maps exceed the texture units).
const sun = new THREE.DirectionalLight(0xffffff, 1.7);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = sun.shadow.camera.bottom = -2;
sun.shadow.camera.right = sun.shadow.camera.top = 2;
scene.add(sun, sun.target);

type Line = Exclude<ArmorLine, 'basic'>;
const LINES: Line[] = ['guard', 'combat', 'psy'];
const LINE_INFO: Record<Line, { cls: string; weapon: WeaponKind; mag: MagStat }> = {
  guard: { cls: 'Guard line (ATP)', weapon: 'saber', mag: 'pow' },
  combat: { cls: 'Combat line (ATA)', weapon: 'handgun', mag: 'dex' },
  psy: { cls: 'Psy line (MST)', weapon: 'cane', mag: 'mind' },
};
const LINE_COLOR: Record<Line, string> = { guard: '#7aa8ff', combat: '#ff8a7a', psy: '#c49aff' };
/** Colour schemes used with 'per line', so each row shows a different glow colour. */
const LINE_PALETTE: Record<Line, string> = { guard: 'C2', combat: 'C1', psy: 'C4' };

const params = {
  mode: 'All lines' as 'All lines' | Line,
  view: 'front 3/4',
  animation: 'idle',
  weapon: true,
  mag: 'none' as 'none' | 'single' | 'twin',
  palette: 'per line',
  hair: 'H1',
  body: 'P3',
  face: 'F0',
  timeScale: 1,
  /** One line: stages from the front (top row) and from behind (bottom row). */
  frontBack: false,
  /** Show one preview full-screen (-1 = grid). */
  solo: -1,
};

/** Frame names at each stage for a line, e.g. "T3–T4 · Mind Armor, Psycho Frame". */
function tierText(line: Line, stage: number): string {
  const tiers = TIER_STAGE.map((st, t) => (t >= 1 && st === stage ? t : 0)).filter(Boolean);
  const range = tiers.length > 1 ? `T${tiers[0]}–T${tiers[tiers.length - 1]}` : `T${tiers[0]}`;
  const names = tiers.map((t) => itemDefs[`frame_${line}_${t}`]?.name).filter(Boolean);
  const nm = stage === 5 ? ' (Hell)' : stage === 4 ? ' (Nightmare)' : '';
  return names.length ? `${range}${nm} · ${names.join(', ')}` : `${range}${nm}`;
}

interface Spec {
  line: Line;
  stage: number;
  /** Fixed camera (front + back mode) instead of the orbit camera. */
  view?: string;
}

const STAGES = [0, 1, 2, 3, 4, 5];

function specs(): Spec[] {
  if (params.mode !== 'All lines' && params.frontBack) {
    const line = params.mode;
    return ['front 3/4', 'behind (game view)'].flatMap((view) => STAGES.map((stage) => ({ line, stage, view })));
  }
  const lines = params.mode === 'All lines' ? LINES : [params.mode];
  return lines.flatMap((line) => STAGES.map((stage) => ({ line, stage })));
}

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
  spec: Spec | null;
  origin: THREE.Vector3;
  holder: THREE.Group;
  model: Heroine | null;
  mag: MagCompanion | null;
  tex: THREE.CanvasTexture;
  camera: THREE.PerspectiveCamera;
  label: HTMLDivElement;
  border: HTMLDivElement;
  u: number;
}

const cells: Cell[] = Array.from({ length: 18 }, (_, i) => {
  const origin = new THREE.Vector3(i * 40, 0, 0);
  const tex = stripeTexture();
  tex.repeat.set(1, 20);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(6, 40), new THREE.MeshStandardMaterial({ map: tex, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.copy(origin);
  ground.receiveShadow = true;
  scene.add(ground);
  const holder = new THREE.Group();
  holder.position.copy(origin);
  scene.add(holder);
  const label = document.createElement('div');
  label.className = 'cell-label';
  document.body.appendChild(label);
  const border = document.createElement('div');
  border.className = 'cell-border';
  document.body.appendChild(border);
  return { spec: null, origin, holder, model: null, mag: null, tex, camera: new THREE.PerspectiveCamera(30, 1, 0.05, 60), label, border, u: i * 0.17 };
});

const master = new THREE.PerspectiveCamera(30, 1, 0.05, 60);
const controls = new OrbitControls(master, renderer.domElement);
controls.enableDamping = true;
controls.minDistance = 0.4;
controls.maxDistance = 12;
controls.maxPolarAngle = Math.PI * 0.55;

function lookFor(s: Spec): Look {
  return {
    body: params.body, hair: params.hair, face: params.face, palette: params.palette === 'per line' ? LINE_PALETTE[s.line] : params.palette,
    outfit: LINE_OUTFIT[s.line]!, evo: s.stage,
    accessory: 'A1', glow: 'G0', armor: 'R0', back: 'B0',
  };
}

function rebuild(): void {
  const list = specs();
  cells.forEach((c, i) => {
    c.mag?.dispose();
    c.mag = null;
    c.holder.clear();
    c.model = null;
    c.spec = list[i] ?? null;
    c.label.style.display = c.border.style.display = c.spec ? '' : 'none';
    if (!c.spec) return;
    const s = c.spec;
    c.model = new Heroine(lookFor(s));
    c.model.rig.root.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = true;
    });
    const info = LINE_INFO[s.line];
    if (params.weapon) c.model.grip.add(buildWeapon(info.weapon, weaponKinds[info.weapon].color).group);
    c.holder.add(c.model.rig.root);
    if (params.mag !== 'none') {
      c.mag = new MagCompanion(0.75); // in-game size
      const arm = info.mag;
      if (params.mag === 'twin') c.mag.setForm(4, LEAD_FORMS[arm][2], { theme: arm, colors: c.model.pal });
      else c.mag.setForm(1, STAGE1[info.mag][1], { theme: arm, colors: c.model.pal });
      c.holder.add(c.mag.root);
    }
    const evo = EVOLUTIONS[LINE_OUTFIT[s.line]!];
    const st = evo.stages[s.stage];
    const head = `<b style="color:${LINE_COLOR[s.line]}">${s.stage} · ${st.name}</b>`;
    c.label.innerHTML =
      s.view === 'behind (game view)'
        ? `${head} <span class="tier">from behind (game camera)</span>`
        : `${head}<div class="tier">${tierText(s.line, s.stage)}</div><div class="desc">${st.desc}</div>`;
  });
  const lines = params.mode === 'All lines' ? LINES : [params.mode];
  document.getElementById('note')!.innerHTML = lines
    .map((l) => `<b style="color:${LINE_COLOR[l]}">${EVOLUTIONS[LINE_OUTFIT[l]!].name}</b> ${LINE_INFO[l].cls}`)
    .join(' &nbsp;·&nbsp; ') + ' &nbsp;—&nbsp; the frame picks the outfit; its tier picks the stage';
}

function grid(): { cols: number; rows: number; w: number; h: number } {
  if (params.solo >= 0) return { cols: 1, rows: 1, w: window.innerWidth, h: window.innerHeight };
  const cols = STAGES.length;
  const rows = Math.ceil(specs().length / cols);
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
    c.label.style.width = `${w}px`;
    Object.assign(c.border.style, { left: `${col * w}px`, top: `${row * h}px`, width: `${w}px`, height: `${h}px` });
    c.camera.aspect = w / h;
    c.camera.updateProjectionMatrix();
  });
  master.aspect = w / h;
  master.updateProjectionMatrix();
}

const VIEWS: Record<string, [THREE.Vector3, THREE.Vector3]> = {
  'front 3/4': [new THREE.Vector3(1.7, 1.35, 4.9), new THREE.Vector3(0, 0.98, 0)],
  front: [new THREE.Vector3(0, 1.2, 5.0), new THREE.Vector3(0, 0.98, 0)],
  'behind (game view)': [new THREE.Vector3(-1.2, 2.1, -4.8), new THREE.Vector3(0, 1.02, 0)],
  side: [new THREE.Vector3(4.5, 1.2, 0), new THREE.Vector3(0, 0.95, 0)],
  'upper body': [new THREE.Vector3(0.8, 1.45, 2.4), new THREE.Vector3(0, 1.3, 0)],
};

function placeCamera(): void {
  const [pos, target] = VIEWS[params.view];
  master.position.copy(pos);
  controls.target.copy(target);
  controls.update();
}

let time = 0;
function tick(dt: number): void {
  time += dt;
  const running = params.animation === 'run';
  for (const c of cells) {
    if (!c.model || !c.spec) continue;
    const grip = params.weapon ? WEAPON_GRIP[LINE_INFO[c.spec.line].weapon] : 'none';
    let extra: THREE.Vector3 | undefined;
    if (running) {
      const g = GAITS.L1;
      const speed = playerCfg.moveSpeed;
      c.u = (c.u + (speed * dt) / scaleGait(g, speed).cycleLength) % 1;
      c.model.rig.apply(gaitPose(c.u, g, c.model.legs, grip, speed), dt, Infinity);
      c.tex.offset.y -= (speed * dt) / 2;
      extra = new THREE.Vector3(0, 0, speed);
      c.holder.rotation.y = 0;
    } else {
      c.model.rig.apply(humanPoses.idle(time + c.u * 5, grip), dt, 8);
      c.holder.rotation.y = params.animation === 'turntable' ? time * 0.6 : 0;
    }
    c.model.update(dt, extra);
    c.mag?.update(dt, new THREE.Vector3(), 0, false);
  }
}

const SUN_OFFSET = new THREE.Vector3(2.5, 6, 5);
function render(): void {
  const { cols, rows, w, h } = grid();
  cells.forEach((c, i) => {
    if (!c.spec) return;
    const slot = params.solo >= 0 ? (i === params.solo ? 0 : -1) : i;
    if (slot < 0) return;
    sun.position.copy(c.origin).add(SUN_OFFSET);
    sun.target.position.copy(c.origin);
    sun.target.updateMatrixWorld();
    if (c.spec.view) {
      const [pos, target] = VIEWS[c.spec.view];
      c.camera.position.copy(pos).add(c.origin);
      c.camera.lookAt(target.clone().add(c.origin));
    } else {
      c.camera.position.copy(master.position).add(c.origin);
      c.camera.quaternion.copy(master.quaternion);
    }
    const col = slot % cols;
    const row = rows - 1 - Math.floor(slot / cols);
    renderer.setViewport(col * w, row * h, w, h);
    renderer.setScissor(col * w, row * h, w, h);
    renderer.render(scene, c.camera);
  });
}

const gui = new GUI({ title: 'Armor Lab' });
const refresh = () => {
  rebuild();
  layout();
};
gui.add(params, 'mode', { 'All lines': 'All lines', 'Guard (ATP)': 'guard', 'Combat (ATA)': 'combat', 'Psy (MST)': 'psy' }).onChange(refresh);
gui.add(params, 'view', Object.keys(VIEWS)).name('camera').onChange(placeCamera);
gui.add({ reset: placeCamera }, 'reset').name('reset camera');
gui.add(params, 'frontBack').name('front + back (one line)').onChange(refresh);
gui.add(params, 'animation', ['idle', 'run', 'turntable']);
gui.add(params, 'timeScale', 0.05, 1, 0.05).name('time scale');
gui.add(params, 'weapon').name('line weapon').onChange(rebuild);
gui.add(params, 'mag', ['none', 'single', 'twin']).name('Mag').onChange(rebuild);
const look = gui.addFolder('Look');
look.add(params, 'palette', { 'Per line': 'per line', ...Object.fromEntries(Object.entries(PALETTES).map(([k, p]) => [p.name, k])) }).name('colours').onChange(rebuild);
look.add(params, 'hair', Object.fromEntries(Object.entries(HAIRS).map(([k, p]) => [p.name, k]))).onChange(rebuild);
look.add(params, 'body', Object.fromEntries(Object.entries(BODIES).map(([k, p]) => [p.name, k]))).name('proportions').onChange(rebuild);
look.add(params, 'face', Object.fromEntries(Object.entries(FACES).map(([k, p]) => [p.name, k]))).name('face gear').onChange(rebuild);
gui.add(params, 'solo', -1, 17, 1).name('solo cell (-1 = grid)').onChange(layout);

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  layout();
});

refresh();
placeCamera();

let last = performance.now();
renderer.setAnimationLoop((now) => {
  const dt = Math.min(0.05, (now - last) / 1000) * params.timeScale;
  last = now;
  tick(dt);
  controls.update();
  render();
});

(window as unknown as Record<string, unknown>).armorlab = {
  params,
  refresh,
  placeCamera,
  master,
  controls,
  cells,
  gui,
  step(sec = 0.5) {
    for (let t = 0; t < sec; t += 1 / 60) tick(1 / 60);
    controls.update();
    render();
  },
};
