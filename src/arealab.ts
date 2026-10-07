import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DEFAULT_LIGHT, expeditionOf, type AreaId } from './game/data/areas';
import { areaDef, labLookPicks, LOOK_PICKS, LOOKS, lookPick, setLabLookPicks } from './game/data/looks';
import { Heroine, PLAYER_LOOK } from './game/models/heroine';
import { Atmosphere } from './game/world/Atmosphere';
import type { MachineHooks } from './game/world/Machinery';
import { newRun, World, type WorldHooks } from './game/world/World';

// Area Lab: load a real Cave / Mine area in-engine and flip between its look
// variants (sky, fog, light, palette, glow, bloom). Click "Pick" to use one in
// the game (this browser); "Copy LOOK_PICKS" gives the code to bake into
// src/game/data/looks.ts.

const AREAS = Object.keys(LOOKS) as AreaId[];
const LETTERS = 'ABCDEF';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 300);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
const hemi = new THREE.HemisphereLight(DEFAULT_LIGHT.hemiSky, DEFAULT_LIGHT.hemiGround, DEFAULT_LIGHT.hemi);
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, far: 160 });
scene.add(hemi, sun, sun.target);
const atmosphere = new Atmosphere(renderer, scene, camera);
const heroine = new Heroine(PLAYER_LOOK);
scene.add(heroine.rig.root);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  atmosphere.resize(window.innerWidth, window.innerHeight);
});

const state = { area: AREAS[0], variant: lookPick(AREAS[0]), room: '' };
let world: World | null = null;

const noop = () => {};
const stubHooks = { hazards: { hurtPlayer: noop, poisonPlayer: noop, burnPlayer: noop, hurtEnemy: noop } } as unknown as WorldHooks;
const body = { pos: new THREE.Vector3(1e4, 0, 1e4), alive: false, radius: 0.45 };
const machineHooks: MachineHooks = { hurtPlayer: noop, burnPlayer: noop, hurtEnemy: noop };

function build(): void {
  if (world) {
    scene.remove(world.group);
    world.dispose();
  }
  const def = areaDef(state.area, state.variant);
  world = new World(state.area, newRun(expeditionOf(state.area) ?? 'caves'), stubHooks, def);
  scene.add(world.group);
  const light = def.theme.light ?? DEFAULT_LIGHT;
  hemi.color.set(light.hemiSky);
  hemi.groundColor.set(light.hemiGround);
  hemi.intensity = light.hemi;
  sun.color.set(light.sunColor);
  sun.intensity = light.sun;
  atmosphere.apply(def.theme);
  const rooms = world.level.rooms;
  if (!rooms.some((r) => r.def.id === state.room)) state.room = (rooms.find((r) => r.def.waves?.length) ?? rooms[0]).def.id;
  view(false);
  render();
}

/** Frame the current room: a high three-quarter view, or eye height behind the heroine. */
function view(eye: boolean): void {
  const r = world!.level.rooms.find((r) => r.def.id === state.room)!;
  const q = r.rect;
  const cx = (q.minX + q.maxX) / 2;
  const cz = (q.minZ + q.maxZ) / 2;
  heroine.rig.root.position.set(cx, 0, cz + (q.maxZ - q.minZ) * 0.2);
  heroine.rig.root.rotation.y = Math.PI;
  sun.position.set(cx + 12, 25, cz + 8);
  sun.target.position.set(cx, 0, cz);
  if (eye) {
    camera.position.set(cx, 2.2, cz + (q.maxZ - q.minZ) * 0.2 + 5);
    controls.target.set(cx, 1.8, cz - 4);
  } else {
    const span = Math.max(q.maxX - q.minX, q.maxZ - q.minZ);
    // Inside the room, above head height: walls and skyline props stay out of the way.
    camera.position.set(cx + span * 0.2, 9 + span * 0.15, cz + span * 0.42);
    controls.target.set(cx, 0, cz);
  }
}

// --------------------------------------------------------------------- UI

const panel = document.getElementById('panel')!;

function render(): void {
  const looks = LOOKS[state.area]!;
  const picks = labLookPicks();
  const used = lookPick(state.area);
  panel.innerHTML = `
    <h1>Area Lab</h1>
    <div class="row">${AREAS.map((a) => `<button class="tab${a === state.area ? ' on' : ''}" data-act="area" data-arg="${a}">${areaDef(a).name}</button>`).join('')}</div>
    <h2>Look</h2>
    ${looks
      .map(
        (l, i) => `<div class="var${i === state.variant ? ' on' : ''}" data-act="variant" data-arg="${i}">
          <b>${LETTERS[i]}</b> ${l.name}${i === used ? ' <span class="used">✓ in game</span>' : ''}
          <div class="desc">${l.desc}</div>
          ${i === state.variant && i !== used ? `<button data-act="pick" data-arg="${i}">Use in game</button>` : ''}
        </div>`,
      )
      .join('')}
    <h2>Room</h2>
    <div class="row">${world!.level.rooms.map((r) => `<button class="tab small${r.def.id === state.room ? ' on' : ''}" data-act="room" data-arg="${r.def.id}">${r.def.id}</button>`).join('')}</div>
    <div class="row"><button data-act="eye">Eye-level view</button><button data-act="top">Overview</button></div>
    <h2>Picks</h2>
    <div class="desc">${AREAS.map((a) => `${a}: <b>${LETTERS[lookPick(a)]}</b>${picks[a] !== undefined && picks[a] !== LOOK_PICKS[a] ? '*' : ''}`).join(' · ')}</div>
    <div class="desc">* picked here, not yet baked into looks.ts</div>
    <button data-act="copy">Copy LOOK_PICKS</button>
    <div class="desc">Drag to orbit · right-drag to pan · wheel to zoom</div>`;
}

panel.addEventListener('click', (ev) => {
  const t = (ev.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
  if (!t) return;
  const arg = t.dataset.arg!;
  switch (t.dataset.act) {
    case 'area':
      state.area = arg as AreaId;
      state.variant = lookPick(state.area);
      state.room = '';
      build();
      return;
    case 'variant':
      if (+arg === state.variant) return;
      state.variant = +arg;
      build();
      return;
    case 'pick':
      setLabLookPicks({ ...labLookPicks(), [state.area]: +arg });
      break;
    case 'room':
      state.room = arg;
      view(false);
      break;
    case 'eye':
      view(true);
      break;
    case 'top':
      view(false);
      break;
    case 'copy': {
      const all = Object.fromEntries(AREAS.map((a) => [a, lookPick(a)]));
      void navigator.clipboard?.writeText(`export const LOOK_PICKS: Partial<Record<AreaId, number>> = ${JSON.stringify(all)};`);
      t.textContent = 'Copied!';
      return;
    }
  }
  ev.stopPropagation();
  render();
});

// ------------------------------------------------------------------- loop

let time = 0;
function tick(dt: number): void {
  time += dt;
  if (world) {
    world.level.update(dt);
    for (const v of world.vents) v.update(dt, body as never, [], stubHooks.hazards);
    for (const m of world.machines) m.update(dt, body, [], machineHooks);
    for (const p of world.pools) p.update(dt, body as never, stubHooks.hazards);
    for (const it of world.interactables) it.update(dt);
  }
  heroine.update?.(dt);
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

// Automated screenshots in a hidden tab (no requestAnimationFrame there).
(window as unknown as Record<string, unknown>).arealab = {
  state,
  build,
  view,
  step(sec = 0.2) {
    for (let t = 0; t < sec; t += 1 / 60) tick(1 / 60);
  },
  get time() {
    return time;
  },
};
