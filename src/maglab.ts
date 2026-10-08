import GUI from 'lil-gui';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { LEAD_FORMS, MAG_STAT_LABEL, MAG_STATS, STAGE1, type MagStat } from './game/mag';
import { MagModel } from './game/models/mag';
import { MAG_DESIGNS, type MagTheme } from './game/models/magDesigns';

// Mag Lab: compare Mag designs. "All forms" shows every form of one design; "One arm"
// shows one arm's stages 1-3 in every design, a row per design.

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setScissorTest(true);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1c2638);
scene.add(new THREE.HemisphereLight(0xdfeaff, 0x40403a, 1.3));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(3, 6, 4);
scene.add(sun);

const DESIGNS: Record<string, { name: string; desc: string }> = {
  classic: { name: 'Classic', desc: 'The current Mag: one shape per stage, the form only changes its colour.' },
  ...MAG_DESIGNS,
};

interface Spec {
  title: string;
  sub: string;
  stage: number;
  color: number;
  theme?: MagTheme;
  design: string;
}

const params = {
  mode: 'All forms' as 'All forms' | 'One arm',
  design: 'kits',
  arm: 'pow' as MagStat,
  view: 'front 3/4',
  turntable: false,
  stripesLit: false,
  /** Show one preview full-screen (-1 = grid). */
  solo: -1,
};

const hexStr = (n: number) => `#${new THREE.Color(n).lerp(new THREE.Color(0xffffff), 0.3).getHexString()}`;

function specs(): Spec[] {
  if (params.mode === 'All forms') {
    const d = params.design;
    return [
      { title: 'Mag', sub: 'stage 0 · shared', stage: 0, color: 0xc8d4e8, design: d },
      ...MAG_STATS.map((a) => ({
        title: STAGE1[a][0], sub: `stage 1 · ${MAG_STAT_LABEL[a]} leads`, stage: 1, color: STAGE1[a][1], theme: a, design: d,
      })),
      ...[2, 3].flatMap((stage) =>
        MAG_STATS.map((s) => ({ title: LEAD_FORMS[s][stage === 2 ? 0 : 1], sub: `stage ${stage} · ${MAG_STAT_LABEL[s]} lead`, stage, color: LEAD_FORMS[s][2], theme: s, design: d })),
      ),
    ];
  }
  const s = params.arm;
  return Object.keys(DESIGNS).flatMap((d) =>
    [1, 2, 3].map((stage) => {
      const stage1 = stage === 1;
      return {
        title: `${DESIGNS[d].name}: ${stage1 ? STAGE1[s][0] : LEAD_FORMS[s][stage === 2 ? 0 : 1]}`,
        sub: `stage ${stage}`,
        stage,
        color: stage1 ? STAGE1[s][1] : LEAD_FORMS[s][2],
        theme: s,
        design: d,
      };
    }),
  );
}

interface Cell {
  spec: Spec | null;
  origin: THREE.Vector3;
  holder: THREE.Group;
  model: MagModel | null;
  camera: THREE.PerspectiveCamera;
  label: HTMLDivElement;
  border: HTMLDivElement;
}

const cells: Cell[] = Array.from({ length: 12 }, (_, i) => {
  const origin = new THREE.Vector3(i * 6, 0, 0);
  const holder = new THREE.Group();
  holder.position.copy(origin);
  scene.add(holder);
  const label = document.createElement('div');
  label.className = 'cell-label';
  document.body.appendChild(label);
  const border = document.createElement('div');
  border.className = 'cell-border';
  document.body.appendChild(border);
  return { spec: null, origin, holder, model: null, camera: new THREE.PerspectiveCamera(30, 1, 0.02, 20), label, border };
});

const master = new THREE.PerspectiveCamera(30, 1, 0.02, 20);
const controls = new OrbitControls(master, renderer.domElement);
controls.enableDamping = true;
controls.minDistance = 0.3;
controls.maxDistance = 5;

function rebuild(): void {
  const list = specs();
  cells.forEach((c, i) => {
    c.model?.dispose();
    c.holder.clear();
    c.model = null;
    c.spec = list[i] ?? null;
    c.label.style.display = c.border.style.display = c.spec ? '' : 'none';
    if (!c.spec) return;
    const s = c.spec;
    c.model = new MagModel(s.stage, s.color, i * 1.7, { theme: s.theme, design: s.design });
    c.model.setGlow(params.stripesLit, 0x3cb4c4);
    c.holder.add(c.model.group);
    c.label.innerHTML = `<b style="color:${hexStr(s.color)}">${s.title}</b><div>${s.sub}</div>`;
  });
  const d = DESIGNS[params.design];
  document.getElementById('note')!.innerHTML =
    params.mode === 'All forms'
      ? `<b>${d.name}</b>: ${d.desc} Stage 4 is two stage-3 Mags.`
      : `<b>${MAG_STAT_LABEL[params.arm]}</b> across designs, stages 1-3 left to right. Stage 4 is two stage-3 Mags.`;
}

function grid(): { cols: number; rows: number; w: number; h: number } {
  if (params.solo >= 0) return { cols: 1, rows: 1, w: window.innerWidth, h: window.innerHeight };
  const cols = params.mode === 'All forms' ? 4 : 3;
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
    Object.assign(c.border.style, { left: `${col * w}px`, top: `${row * h}px`, width: `${w}px`, height: `${h}px` });
    c.camera.aspect = w / h;
    c.camera.updateProjectionMatrix();
  });
  master.aspect = w / h;
  master.updateProjectionMatrix();
}

const VIEWS: Record<string, THREE.Vector3> = {
  'front 3/4': new THREE.Vector3(0.75, 0.45, 1.35),
  'behind (game view)': new THREE.Vector3(0.35, 0.75, -1.4),
  side: new THREE.Vector3(1.55, 0.2, 0),
  top: new THREE.Vector3(0, 1.6, 0.05),
};

function placeCamera(): void {
  master.position.copy(VIEWS[params.view]);
  controls.target.set(0, -0.01, 0);
  controls.update();
}

let time = 0;
function tick(dt: number): void {
  time += dt;
  for (const c of cells) {
    if (!c.model) continue;
    c.model.update(dt);
    c.holder.rotation.y = params.turntable ? time * 0.6 : 0;
  }
}

function render(): void {
  const { cols, rows, w, h } = grid();
  cells.forEach((c, i) => {
    if (!c.spec) return;
    const slot = params.solo >= 0 ? (i === params.solo ? 0 : -1) : i;
    if (slot < 0) return;
    c.camera.position.copy(master.position).add(c.origin);
    c.camera.quaternion.copy(master.quaternion);
    const col = slot % cols;
    const row = rows - 1 - Math.floor(slot / cols);
    renderer.setViewport(col * w, row * h, w, h);
    renderer.setScissor(col * w, row * h, w, h);
    renderer.render(scene, c.camera);
  });
}

const gui = new GUI({ title: 'Mag Lab' });
const refresh = () => {
  rebuild();
  layout();
};
gui.add(params, 'mode', ['All forms', 'One arm']).onChange(refresh);
gui.add(params, 'design', Object.fromEntries(Object.entries(DESIGNS).map(([k, d]) => [d.name, k]))).name('design (all forms)').onChange(refresh);
gui.add(params, 'arm', Object.fromEntries(MAG_STATS.map((s) => [MAG_STAT_LABEL[s], s]))).name('arm (one arm)').onChange(refresh);
gui.add(params, 'view', Object.keys(VIEWS)).name('camera').onChange(placeCamera);
gui.add(params, 'turntable');
gui.add(params, 'stripesLit').name('stripes lit (unspent points)').onChange(rebuild);
gui.add(params, 'solo', -1, 11, 1).name('solo cell (-1 = grid)').onChange(layout);

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  layout();
});

refresh();
placeCamera();

let last = performance.now();
renderer.setAnimationLoop((now) => {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  tick(dt);
  controls.update();
  render();
});

(window as unknown as Record<string, unknown>).maglab = {
  params,
  refresh,
  placeCamera,
  master,
  controls,
  gui,
  step(sec = 0.5) {
    for (let t = 0; t < sec; t += 1 / 60) tick(1 / 60);
    controls.update();
    render();
  },
};
