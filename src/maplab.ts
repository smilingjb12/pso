import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DEFAULT_LIGHT, type AreaDef, type AreaId, type RoomDef } from './game/data/areas';
import { areaDef } from './game/data/looks';
import { corridorRect, generateRift, riftThreat } from './game/riftGen';
import { RIFT_BIOMES, type RiftBiome, type RiftGenOptions } from './game/riftTypes';
import { Atmosphere } from './game/world/Atmosphere';
import { TILE } from './game/world/Level';
import type { MachineHooks } from './game/world/Machinery';
import { newRun, World, type WorldHooks } from './game/world/World';

// Map Lab: preview generated Falz Rift layouts (riftGen.ts) in-engine, from above, with a 2D map overlay.
// Driven from a script via window.maplab = { params, build() }.

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.5, 3000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
const hemi = new THREE.HemisphereLight(DEFAULT_LIGHT.hemiSky, DEFAULT_LIGHT.hemiGround, DEFAULT_LIGHT.hemi);
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
scene.add(hemi, sun, sun.target);
const atmosphere = new Atmosphere(renderer, scene, camera);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  atmosphere.resize(window.innerWidth, window.innerHeight);
});

interface Params {
  biome: RiftBiome;
  seed: number;
  boss: boolean;
  hazardMult: 1 | 2;
  hazardBiome: RiftBiome | '';
  mixBiome: RiftBiome | '';
  /** Every wave from a random region's roster (what the game's rifts use: the Forest with every expedition). */
  mixAll: boolean;
  /** Keep the area's fog (off: the whole map is visible from above). */
  fog: boolean;
}

const params: Params = { biome: 'forest', seed: 1, boss: true, hazardMult: 1, hazardBiome: '', mixBiome: '', mixAll: true, fog: false };

/** The authored floor whose look a rift of this biome borrows (two variants alternate by seed). */
function lookArea(p: Params): AreaId {
  const pair: Record<RiftBiome, [AreaId, AreaId]> = {
    forest: ['forest1', 'forest1'],
    caves: ['cave1', 'cave2'],
    mines: ['mine1', 'mine2'],
    ruins: ['ruin1', 'ruin2'],
  };
  return pair[p.biome][Math.abs(p.seed) % 2];
}

let world: World | null = null;
let def: AreaDef | null = null;
let error = '';

const noop = () => {};
const stubHooks = { hazards: { hurtPlayer: noop, poisonPlayer: noop, burnPlayer: noop, hurtEnemy: noop } } as unknown as WorldHooks;
const body = { pos: new THREE.Vector3(1e4, 0, 1e4), alive: false, radius: 0.45 };
const machineHooks: MachineHooks = { hurtPlayer: noop, burnPlayer: noop, hurtEnemy: noop };

function options(): RiftGenOptions {
  return {
    biome: params.biome,
    seed: params.seed,
    boss: params.boss,
    hazardMult: params.hazardMult,
    ...(params.hazardBiome ? { hazardBiome: params.hazardBiome } : {}),
    ...(params.mixBiome ? { mixBiome: params.mixBiome } : {}),
    ...(params.mixAll ? { mixAll: true } : {}),
  };
}

function build(): void {
  if (world) {
    scene.remove(world.group);
    world.dispose();
    world = null;
  }
  error = '';
  try {
    const { rooms, links } = generateRift(options());
    const area = lookArea(params);
    const base = areaDef(area);
    def = { ...base, rooms, links };
    world = new World(area, newRun(params.biome), stubHooks, def);
    scene.add(world.group);
    const light = def.theme.light ?? DEFAULT_LIGHT;
    hemi.color.set(light.hemiSky);
    hemi.groundColor.set(light.hemiGround);
    hemi.intensity = light.hemi;
    sun.color.set(light.sunColor);
    sun.intensity = light.sun;
    atmosphere.apply(def.theme);
    if (!params.fog) scene.fog = null;
    overview();
  } catch (e) {
    error = String(e instanceof Error ? e.stack ?? e.message : e);
    console.error(e);
  }
  render();
  drawMap();
}

/** Top-down over the whole map. */
function overview(): void {
  if (!world) return;
  const w = world.level.width * TILE;
  const h = world.level.height * TILE;
  const cx = w / 2;
  const cz = h / 2;
  // Height that fits the whole map in the view (vertical fov; the width through the aspect).
  const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const dist = Math.max(h / 2 / t, w / 2 / (t * camera.aspect)) * 1.1;
  camera.position.set(cx, dist, cz + dist * 0.08);
  controls.target.set(cx, 0, cz);
  sun.position.set(cx + 30, 80, cz + 20);
  sun.target.position.set(cx, 0, cz);
}

// --------------------------------------------------------------- 2D map

const canvas = document.getElementById('map') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

function roomRole(r: RoomDef, sideRooms: Set<string>): { fill: string; tag: string } {
  const has = (k: string) => (r.features ?? []).some((f) => f.kind === k);
  if (r.id === 'k0') return { fill: '#2f7a46', tag: 'S' };
  if (has('toBoss')) return { fill: '#6a3a9a', tag: 'B' };
  if (r.guardian) return { fill: '#9a2f2f', tag: 'G' };
  if (has('switch')) return { fill: '#8a7420', tag: 'SW' };
  if (sideRooms.has(r.id)) return { fill: '#2f5a8a', tag: '+' };
  return { fill: '#3a4660', tag: '' };
}

function drawMap(): void {
  ctx.fillStyle = '#060a14';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!def) return;
  const rooms = def.rooms;
  const W = Math.max(...rooms.map((r) => r.x + r.w));
  const H = Math.max(...rooms.map((r) => r.z + r.h));
  const pad = 8;
  const s = Math.min((canvas.width - pad * 2) / W, (canvas.height - pad * 2) / H);
  const X = (tx: number) => pad + tx * s;
  const Z = (tz: number) => pad + tz * s;
  const byId = new Map(rooms.map((r) => [r.id, r]));
  // Side rooms: a single link, not the start, not a teleporter room.
  const degree = new Map<string, number>();
  for (const l of def.links) for (const id of [l.a, l.b]) degree.set(id, (degree.get(id) ?? 0) + 1);
  const side = new Set(rooms.filter((r) => degree.get(r.id) === 1 && r.id !== 'k0').map((r) => r.id));

  for (const l of def.links) {
    const c = corridorRect(byId.get(l.a)!, byId.get(l.b)!);
    if (!c) continue;
    ctx.fillStyle = l.lock ? '#ffb020' : '#7a8498';
    ctx.fillRect(X(c.x), Z(c.z), c.w * s, c.h * s);
  }
  for (const r of rooms) {
    const role = roomRole(r, side);
    ctx.fillStyle = role.fill;
    ctx.fillRect(X(r.x), Z(r.z), r.w * s, r.h * s);
    ctx.strokeStyle = '#9ab0d8';
    ctx.lineWidth = 1;
    ctx.strokeRect(X(r.x) + 0.5, Z(r.z) + 0.5, r.w * s - 1, r.h * s - 1);
    const dot = (tx: number, tz: number, color: string, rad = 2.2) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(X(r.x + tx), Z(r.z + tz), rad, 0, Math.PI * 2);
      ctx.fill();
    };
    const ell = (tx: number, tz: number, rx: number, rz: number, color: string) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.ellipse(X(r.x + tx), Z(r.z + tz), rx * s, rz * s, 0, 0, Math.PI * 2);
      ctx.fill();
    };
    for (const [tx, tz, rx, rz] of r.marsh ?? []) ell(tx, tz, rx, rz, 'rgba(90,220,120,0.45)');
    for (const [tx, tz, rx, rz] of r.slag ?? []) ell(tx, tz, rx, rz, 'rgba(255,120,40,0.5)');
    for (const c of r.conveyors ?? []) {
      ctx.fillStyle = 'rgba(200,200,90,0.45)';
      ctx.fillRect(X(r.x + c.tx), Z(r.z + c.tz), c.w * s, c.h * s);
    }
    for (const l of r.lasers ?? []) {
      ctx.strokeStyle = l.power ? '#ff5050' : '#ff9090';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(X(r.x + l.ax), Z(r.z + l.az));
      ctx.lineTo(X(r.x + l.bx), Z(r.z + l.bz));
      ctx.stroke();
    }
    for (const [tx, tz] of r.vents ?? []) dot(tx, tz, '#ff6a20', 3);
    for (const c of r.crushers ?? []) dot(c.tx, c.tz, '#c0c8d0', 3);
    for (const [tx, tz] of r.pylons ?? []) dot(tx, tz, '#d8c8ff', 3);
    for (const w of r.waves ?? []) for (const e of w) if (typeof e !== 'string') dot(e.tx, e.tz, e.e === 'ControlNode' ? '#40e0ff' : '#c040ff', 2.5);
    for (const f of r.features ?? []) {
      const color = f.kind === 'switch' ? '#ffd75a' : f.kind === 'power' ? '#ffa040' : f.kind === 'start' ? '#7dffa8' : '#80c0ff';
      ctx.fillStyle = color;
      ctx.fillRect(X(r.x + f.tx) - 3, Z(r.z + f.tz) - 3, 6, 6);
    }
    ctx.fillStyle = '#ffffff';
    ctx.font = '10px Segoe UI, sans-serif';
    ctx.fillText(`${r.id}${role.tag ? ' ' + role.tag : ''}${r.waves ? ` ${r.waves.length}w` : ''}`, X(r.x) + 3, Z(r.z) + 11);
  }
}

// --------------------------------------------------------------------- UI

const panel = document.getElementById('panel')!;

function stats(): string {
  if (!def) return '';
  const rooms = def.rooms;
  const fights = rooms.filter((r) => r.waves?.length);
  const enemies = fights.reduce((n, r) => n + (r.waves ?? []).reduce((m, w) => m + w.length, 0), 0);
  const count = (f: (r: RoomDef) => number) => rooms.reduce((n, r) => n + f(r), 0);
  const hz = [
    ['vents', count((r) => r.vents?.length ?? 0)],
    ['marsh', count((r) => r.marsh?.length ?? 0)],
    ['slag', count((r) => r.slag?.length ?? 0)],
    ['crushers', count((r) => r.crushers?.length ?? 0)],
    ['lasers', count((r) => r.lasers?.length ?? 0)],
    ['belts', count((r) => r.conveyors?.length ?? 0)],
    ['pylons', count((r) => r.pylons?.length ?? 0)],
    ['trees', count((r) => r.trees ?? 0)],
  ].filter(([, n]) => n);
  const W = Math.max(...rooms.map((r) => r.x + r.w));
  const H = Math.max(...rooms.map((r) => r.z + r.h));
  return `<div class="desc">Rooms <b>${rooms.length}</b> · fights <b>${fights.length}</b> · waves <b>${fights.reduce((n, r) => n + r.waves!.length, 0)}</b></div>
    <div class="desc">Enemies <b>${enemies}</b> · threat <b>${riftThreat(rooms).toFixed(1)}</b></div>
    <div class="desc">Size ${W} x ${H} tiles · look ${lookArea(params)}</div>
    <div class="desc">${hz.map(([k, n]) => `${k} ${n}`).join(' · ') || 'no hazards'}</div>`;
}

const biomeSelect = (act: string, value: string, none: boolean) =>
  `<select data-act="${act}">${none ? `<option value="">none</option>` : ''}${RIFT_BIOMES.map((b) => `<option value="${b}"${b === value ? ' selected' : ''}>${b}</option>`).join('')}</select>`;

function render(): void {
  panel.innerHTML = `
    <h1>Map Lab</h1>
    <div class="row">${RIFT_BIOMES.map((b) => `<button class="tab${b === params.biome ? ' on' : ''}" data-act="biome" data-arg="${b}">${b}</button>`).join('')}</div>
    <div class="row"><label>Seed</label><input data-act="seed" type="number" value="${params.seed}"><button data-act="reroll">Reroll</button></div>
    <div class="row"><label>Boss room</label><button class="tab${params.boss ? ' on' : ''}" data-act="boss">${params.boss ? 'on' : 'off'}</button></div>
    <div class="row"><label>Hazards x</label>${[1, 2].map((m) => `<button class="tab${m === params.hazardMult ? ' on' : ''}" data-act="mult" data-arg="${m}">${m}</button>`).join('')}</div>
    <div class="row"><label>Bleed</label>${biomeSelect('hazardBiome', params.hazardBiome, true)}</div>
    <div class="row"><label>Every region</label><button class="tab${params.mixAll ? ' on' : ''}" data-act="mixAll">${params.mixAll ? 'on (game rifts)' : 'off'}</button></div>
    <div class="row"><label>Convergence</label>${biomeSelect('mixBiome', params.mixBiome, true)}</div>
    <div class="row"><label>Fog</label><button class="tab${params.fog ? ' on' : ''}" data-act="fog">${params.fog ? 'on' : 'off'}</button><button data-act="top">Overview</button></div>
    <h2>Rift</h2>
    ${error ? `<div class="desc err">${error.split('\n')[0]}</div>` : stats()}
    <h2>Map key</h2>
    <div class="desc">S start · G guardian · SW switch room · + side room · B boss teleporter · orange corridor = locked (L1)</div>
    <div class="desc">squares: features (yellow switch, orange power, green start, blue teleporters) · dots: vents, crushers, pylons, pinned Lilies (violet) / nodes (cyan)</div>
    <div class="desc">Drag to orbit · right-drag to pan · wheel to zoom</div>`;
}

panel.addEventListener('click', (ev) => {
  const t = (ev.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
  if (!t || t.tagName === 'SELECT' || t.tagName === 'INPUT') return;
  const arg = t.dataset.arg!;
  switch (t.dataset.act) {
    case 'biome':
      params.biome = arg as RiftBiome;
      break;
    case 'reroll':
      params.seed = Math.floor(Math.random() * 1e9);
      break;
    case 'boss':
      params.boss = !params.boss;
      break;
    case 'mixAll':
      params.mixAll = !params.mixAll;
      break;
    case 'mult':
      params.hazardMult = +arg as 1 | 2;
      break;
    case 'fog':
      params.fog = !params.fog;
      break;
    case 'top':
      overview();
      return;
    default:
      return;
  }
  build();
});

panel.addEventListener('change', (ev) => {
  const t = ev.target as HTMLInputElement | HTMLSelectElement;
  switch (t.dataset.act) {
    case 'seed':
      params.seed = Math.floor(+t.value) || 0;
      break;
    case 'hazardBiome':
      params.hazardBiome = t.value as RiftBiome | '';
      break;
    case 'mixBiome':
      params.mixBiome = t.value as RiftBiome | '';
      break;
    default:
      return;
  }
  build();
});

// ------------------------------------------------------------------- loop

function tick(dt: number): void {
  if (world) {
    world.level.update(dt);
    for (const v of world.vents) v.update(dt, body as never, [], stubHooks.hazards);
    for (const m of world.machines) m.update(dt, body, [], machineHooks);
    for (const p of world.pools) p.update(dt, body as never, stubHooks.hazards);
    for (const it of world.interactables) it.update(dt);
  }
  atmosphere.update(dt);
  controls.update();
  atmosphere.render();
}

build();
let last = performance.now();
renderer.setAnimationLoop((now) => {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  tick(dt);
});

// Scripted use (and screenshots in a hidden tab, where there is no requestAnimationFrame).
(window as unknown as Record<string, unknown>).maplab = {
  params,
  build,
  overview,
  get def() {
    return def;
  },
  get error() {
    return error;
  },
  step(sec = 0.2) {
    for (let t = 0; t < sec; t += 1 / 60) tick(1 / 60);
  },
};
