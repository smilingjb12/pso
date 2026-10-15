import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { AreaTheme, FeatureKind } from '../data/areas';
import { glowMaterial, glowSprite } from './glow';
import { mulberry32, TILE, type PlacedFeature, type RoomRuntime } from './Level';

// Pioneer 2, PSO1 style: white deck panels with blue bands and gold trim, booth
// storefronts with lit signs, a holo-globe fountain in the plaza, a promenade
// arch, the transporter gate on the deck, and a window wall looking down on
// Ragol over the ship's hull. Built once per visit; static pieces are merged
// per material.

/** What the level hands the city builder. */
export interface CityHost {
  theme: AreaTheme;
  group: THREE.Group;
  rooms: RoomRuntime[];
  features: PlacedFeature[];
  /** Solid circles (the level's tree colliders): the player and the crowd stay out. */
  colliders: { x: number; z: number; r: number }[];
  width: number;
  height: number;
  isFloor(tx: number, tz: number): boolean;
  isWindow(tx: number, tz: number): boolean;
  animate(fn: (dt: number, t: number) => void): void;
}

/** Shop colours (signs, booth strips, floor mats). */
export const SHOP_COLORS: Partial<Record<FeatureKind, number>> = {
  shopWeapon: 0xff8a30, shopArmor: 0x4aa8ff, shopItem: 0x50e070, medical: 0xff6aa0, stylist: 0xc070ff,
};
const SHOP_SIGNS: Partial<Record<FeatureKind, string>> = {
  shopWeapon: 'WEAPONS', shopArmor: 'ARMOR', shopItem: 'ITEMS', medical: 'MEDICAL', stylist: 'STYLIST',
};

const std = (color: number, rough = 0.5, metal = 0.2, flat = false) =>
  new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, flatShading: flat });
/** Unlit colours, shared within one build so batches merge by colour. */
const litCache = new Map<number, THREE.MeshBasicMaterial>();
const lit = (color: number) => {
  let m = litCache.get(color);
  if (!m) litCache.set(color, (m = new THREE.MeshBasicMaterial({ color })));
  return m;
};

/** Geometries collected per material and merged into one mesh each. */
class Batches {
  private map = new Map<THREE.Material, THREE.BufferGeometry[]>();
  add(mat: THREE.Material, geo: THREE.BufferGeometry): void {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (geo.index) geo.dispose();
    g.deleteAttribute('uv');
    if (!this.map.has(mat)) this.map.set(mat, []);
    this.map.get(mat)!.push(g);
  }
  flush(group: THREE.Group, shadows = true): void {
    for (const [mat, geos] of this.map) {
      const mesh = new THREE.Mesh(mergeGeometries(geos)!, mat);
      geos.forEach((g) => g.dispose());
      const glow = mat instanceof THREE.MeshBasicMaterial;
      mesh.castShadow = shadows && !glow;
      mesh.receiveShadow = !glow;
      group.add(mesh);
    }
    this.map.clear();
  }
}

/** A box centred at (x, y, z), turned by `yaw`. */
function box(w: number, h: number, d: number, x: number, y: number, z: number, yaw = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  if (yaw) g.rotateY(yaw);
  return g.translate(x, y, z);
}

/** Glowing text on a transparent canvas (null without a DOM, e.g. in tests). */
const textCache = new Map<string, THREE.Texture>();
function textTexture(text: string, color: number, w = 512, h = 128): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const key = `${text}|${color}|${w}x${h}`;
  const hit = textCache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (!g) return null;
  const css = `#${color.toString(16).padStart(6, '0')}`;
  g.font = `600 ${Math.round(h * 0.5)}px 'Segoe UI', system-ui, sans-serif`;
  (g as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${Math.round(h * 0.09)}px`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = css;
  g.shadowBlur = h * 0.18;
  g.fillStyle = css;
  g.fillText(text, w / 2, h / 2 + 2);
  g.shadowBlur = 0;
  g.globalAlpha = 0.9;
  g.fillStyle = '#ffffff';
  g.fillText(text, w / 2, h / 2 + 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  textCache.set(key, tex);
  return tex;
}

/** A lit sign: a dark frame with glowing text, facing +Z before `yaw`. */
function sign(text: string, color: number, width: number, x: number, y: number, z: number, yaw: number): THREE.Group {
  const g = new THREE.Group();
  const h = width * 0.22;
  const frame = new THREE.Mesh(new THREE.BoxGeometry(width + 0.3, h + 0.24, 0.16), std(0x1c2436, 0.4, 0.5));
  const edge = new THREE.Mesh(new THREE.BoxGeometry(width + 0.34, 0.05, 0.18), lit(color));
  edge.position.y = -(h + 0.24) / 2;
  g.add(frame, edge);
  const tex = textTexture(text, color, 512, Math.round((512 * h) / width));
  if (tex) {
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(width, h),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }),
    );
    face.position.z = 0.085;
    g.add(face);
  }
  g.position.set(x, y, z);
  g.rotation.y = yaw;
  return g;
}

/** The procedural planet: oceans, continents, ice caps and drifting clouds, lit from one side. */
function ragolMaterial(radius: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    fog: false,
    uniforms: { t: { value: 0 }, l: { value: new THREE.Vector3(-0.55, 0.62, -0.55).normalize() }, radius: { value: radius } },
    vertexShader: `uniform float radius; varying vec3 vP; varying vec3 vN; varying vec3 vW;
      void main() {
        vP = position / radius;
        vN = normalize(mat3(modelMatrix) * normal);
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: `uniform float t; uniform vec3 l; varying vec3 vP; varying vec3 vN; varying vec3 vW;
      float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float noise(vec3 x) {
        vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
                   mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
      }
      float fbm(vec3 p) { float a = 0.5; float s = 0.0; for (int i = 0; i < 5; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; } return s; }
      vec3 spin(vec3 p, float a) { float c = cos(a); float s = sin(a); return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z); }
      void main() {
        vec3 n = normalize(vP);
        vec3 p = spin(n, t * 0.004);
        float h = fbm(p * 2.4 + 3.0);
        float m = fbm(p * 7.0);
        float land = smoothstep(0.5, 0.53, h);
        vec3 ocean = mix(vec3(0.02, 0.09, 0.26), vec3(0.06, 0.28, 0.5), smoothstep(0.36, 0.5, h));
        vec3 green = mix(vec3(0.12, 0.3, 0.1), vec3(0.24, 0.4, 0.14), m);
        vec3 ground = mix(green, vec3(0.46, 0.4, 0.26), smoothstep(0.6, 0.72, h + (m - 0.5) * 0.25));
        vec3 col = mix(ocean, ground, land);
        col = mix(col, vec3(0.9, 0.94, 1.0), smoothstep(0.8, 0.88, abs(n.y) + (m - 0.5) * 0.12));
        float cl = smoothstep(0.56, 0.8, fbm(spin(n, t * 0.007) * 3.2 + vec3(0.0, 7.0, 0.0)));
        col = mix(col, vec3(0.8, 0.84, 0.9), cl * 0.75);
        vec3 N = normalize(vN);
        float diff = max(0.0, dot(N, l));
        vec3 c = col * (0.04 + 0.78 * diff);
        float fr = pow(1.0 - max(0.0, dot(N, normalize(cameraPosition - vW))), 4.0);
        c += vec3(0.16, 0.32, 0.65) * fr * (0.1 + diff);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
}

/** A small planter: an octagonal white tub with a gold rim and a round-crowned tree. */
function planter(b: Batches, m: Mats, x: number, z: number, s = 1): void {
  b.add(m.white, new THREE.CylinderGeometry(0.9 * s, 0.8 * s, 0.7, 8).translate(x, 0.35, z));
  b.add(m.gold, new THREE.CylinderGeometry(0.94 * s, 0.94 * s, 0.07, 8).translate(x, 0.72, z));
  b.add(m.soil, new THREE.CylinderGeometry(0.82 * s, 0.82 * s, 0.05, 8).translate(x, 0.7, z));
  b.add(m.trunk, new THREE.CylinderGeometry(0.07, 0.11, 1.7 * s, 6).translate(x, 1.5, z));
  b.add(m.leaf, new THREE.IcosahedronGeometry(0.85 * s, 0).translate(x, 2.45 * s + 0.2, z));
  b.add(m.leaf2, new THREE.IcosahedronGeometry(0.6 * s, 0).translate(x + 0.35, 2.1 * s + 0.2, z + 0.2));
  b.add(m.leaf2, new THREE.IcosahedronGeometry(0.55 * s, 0).translate(x - 0.3, 2.95 * s + 0.2, z - 0.15));
}

/** A slim bench facing +Z before `yaw`. */
function bench(b: Batches, m: Mats, x: number, z: number, yaw: number): void {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const at = (lx: number, lz: number): [number, number] => [x + lx * c + lz * s, z - lx * s + lz * c];
  const [sx, sz] = at(0, 0);
  b.add(m.white, box(1.9, 0.1, 0.55, sx, 0.46, sz, yaw));
  const [bx, bz] = at(0, -0.26);
  b.add(m.blue, box(1.9, 0.42, 0.08, bx, 0.8, bz, yaw));
  for (const lx of [-0.75, 0.75]) {
    const [lx2, lz2] = at(lx, 0);
    b.add(m.metal, box(0.08, 0.42, 0.45, lx2, 0.21, lz2, yaw));
  }
}

interface Mats {
  white: THREE.Material;
  panel: THREE.Material;
  kick: THREE.Material;
  blue: THREE.Material;
  gold: THREE.Material;
  metal: THREE.Material;
  dark: THREE.Material;
  soil: THREE.Material;
  trunk: THREE.Material;
  leaf: THREE.Material;
  leaf2: THREE.Material;
  strip: THREE.Material;
}

export function buildCityScenery(h: CityHost): void {
  const t = h.theme;
  litCache.clear();
  const accent = t.accent ?? 0x52d0ff;
  const rng = mulberry32(2002);
  const m: Mats = {
    white: std(0xe6eaf2, 0.45, 0.15),
    panel: std(0xd4dae6, 0.5, 0.2),
    kick: std(0x2a3550, 0.5, 0.4),
    blue: std(t.accent2 ?? 0x2f62c8, 0.4, 0.3),
    gold: std(t.accent3 ?? 0xe8b84a, 0.3, 0.8),
    metal: std(0x5a6478, 0.4, 0.6),
    dark: std(0x1c2436, 0.35, 0.5),
    soil: std(0x3a2c22, 1, 0),
    trunk: std(0x6a4a32, 0.9, 0, true),
    leaf: std(0x4f9a4a, 0.8, 0, true),
    leaf2: std(0x3d8a48, 0.8, 0, true),
    strip: lit(accent),
  };
  const b = new Batches();
  const glows = new Batches();
  const solid = (x: number, z: number, r: number) => h.colliders.push({ x, z, r });
  const room = (id: string) => h.rooms.find((r) => r.def.id === id)!.rect;
  const plaza = room('plaza');
  const prom = room('promenade');
  const deck = room('deck');
  const counters = h.features.filter((f) => SHOP_COLORS[f.def.kind] !== undefined);

  // ------------------------------------------------------------ walls
  // Every wall face gets a dark kick plate with a light strip, the blue band with gold trim, and a cornice;
  // pilasters with a light slit stand every third tile, away from the booths.
  const windowFaces: { x: number; z: number; nx: number; nz: number }[] = [];
  for (let tz = 0; tz < h.height; tz++)
    for (let tx = 0; tx < h.width; tx++) {
      if (!h.isFloor(tx, tz)) continue;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        if (h.isFloor(tx + dx, tz + dz)) continue;
        const fx = (tx + 0.5 + dx * 0.5) * TILE;
        const fz = (tz + 0.5 + dz * 0.5) * TILE;
        const nx = -dx;
        const nz = -dz;
        if (h.isWindow(tx + dx, tz + dz)) {
          windowFaces.push({ x: fx, z: fz, nx, nz });
          continue;
        }
        const along = nx !== 0;
        const face = (mat: THREE.Material, y: number, hgt: number, depth: number, len = TILE) =>
          b.add(mat, box(along ? depth : len, hgt, along ? len : depth, fx + (nx * depth) / 2, y, fz + (nz * depth) / 2));
        face(m.kick, 0.25, 0.5, 0.1);
        glows.add(m.strip, box(along ? 0.03 : TILE, 0.05, along ? TILE : 0.03, fx + nx * 0.115, 0.52, fz + nz * 0.115));
        face(m.blue, 2.55, 0.7, 0.06);
        face(m.gold, 2.95, 0.06, 0.08);
        face(m.panel, 4.85, 0.3, 0.18);
        const k = along ? tz : tx;
        const nearBooth = counters.some((f) => Math.hypot(f.x - fx, f.z - fz) < 4.2);
        if (k % 3 === 0 && !nearBooth) {
          const px = fx + nx * 0.16;
          const pz = fz + nz * 0.16;
          b.add(m.white, box(along ? 0.32 : 0.6, 4.7, along ? 0.6 : 0.32, px, 2.35, pz));
          glows.add(m.strip, box(along ? 0.03 : 0.1, 3.2, along ? 0.1 : 0.03, px + nx * 0.17, 2.4, pz + nz * 0.17));
        }
      }
    }

  // ------------------------------------------------------------ storefronts
  // Booth walls and a canopy around each counter, a lit sign, a floor mat and the shop's wares on the back wall.
  for (const f of counters) {
    const color = SHOP_COLORS[f.def.kind]!;
    // Facing: away from the nearest room edge.
    const r = h.rooms.find((q) => q.def.id === f.room)!.rect;
    const edges = [
      { d: f.z - r.minZ, nx: 0, nz: 1 },
      { d: r.maxZ - f.z, nx: 0, nz: -1 },
      { d: f.x - r.minX, nx: 1, nz: 0 },
      { d: r.maxX - f.x, nx: -1, nz: 0 },
    ].sort((a, c) => a.d - c.d)[0];
    const { nx, nz, d } = edges;
    // Tangent along the wall: the booth's local +X once turned by `yaw` (so wares can be built unturned).
    const tx = nz;
    const tz = -nx;
    const yaw = Math.atan2(nx, nz);
    const wx = f.x - nx * d; // wall point behind the counter
    const wz = f.z - nz * d;
    const P = (along: number, out: number): [number, number] => [wx + tx * along + nx * out, wz + tz * along + nz * out];
    const depth = d + 0.4;
    const stripMat = lit(color);
    for (const side of [-1, 1]) {
      const [cx, cz] = P(side * 2.9, depth / 2);
      b.add(m.white, box(0.26, 3.7, depth, cx, 1.85, cz, yaw));
      const [ex, ez] = P(side * 2.9, depth + 0.01);
      glows.add(stripMat, box(0.1, 3.3, 0.03, ex, 1.8, ez, yaw));
      for (let o = 0.4; o < depth; o += 0.6) solid(...P(side * 2.9, o), 0.3);
    }
    // Counter ends: keep the player out of the booth.
    for (const side of [-1, 1]) solid(...P(side * 2.05, d), 0.45);
    const [kx, kz] = P(0, depth / 2 + 0.2);
    b.add(m.white, box(6.1, 0.22, depth + 0.4, kx, 3.75, kz, yaw));
    const [ux, uz] = P(0, depth + 0.4);
    glows.add(stripMat, box(6.1, 0.08, 0.04, ux, 3.68, uz, yaw));
    const under = new THREE.Mesh(new THREE.PlaneGeometry(5.6, depth).rotateX(Math.PI / 2), glowMaterial(color, 0.35));
    under.position.set(kx, 3.63, kz);
    under.rotation.y = yaw;
    h.group.add(under);
    const [sx, sz] = P(0, depth + 0.2);
    h.group.add(sign(SHOP_SIGNS[f.def.kind] ?? '', color, 3.6, sx, 4.45, sz, yaw));
    // Floor mat in front of the counter.
    const mat = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 2.2).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.12, depthWrite: false }));
    const [mx, mz] = P(0, d + 1.9);
    mat.position.set(mx, 0.012, mz);
    mat.rotation.y = yaw;
    h.group.add(mat);
    const matEdge = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 0.06).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color }));
    const [ex2, ez2] = P(0, d + 3.0);
    matEdge.position.set(ex2, 0.014, ez2);
    matEdge.rotation.y = yaw;
    h.group.add(matEdge);
    wares(f.def.kind, color, P, yaw, b, glows, m);
  }

  // ------------------------------------------------------------ plaza: the holo-globe fountain
  const fx = (plaza.minX + plaza.maxX) / 2;
  const fz = (plaza.minZ + plaza.maxZ) / 2 + 1;
  b.add(m.white, new THREE.CylinderGeometry(2.5, 2.6, 0.55, 32).translate(fx, 0.275, fz));
  b.add(m.gold, new THREE.TorusGeometry(2.5, 0.06, 6, 48).rotateX(Math.PI / 2).translate(fx, 0.56, fz));
  b.add(m.blue, new THREE.CylinderGeometry(0.55, 0.75, 1.5, 12).translate(fx, 0.95, fz));
  b.add(m.white, new THREE.CylinderGeometry(0.9, 0.6, 0.25, 12).translate(fx, 1.8, fz));
  solid(fx, fz, 2.75);
  const waterMat = new THREE.MeshStandardMaterial({ color: 0x2a78c8, roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.85, emissive: 0x0a3a6a });
  // Filled to the brim, just over the basin top.
  const water = new THREE.Mesh(new THREE.RingGeometry(0.75, 2.42, 40).rotateX(-Math.PI / 2), waterMat);
  water.position.set(fx, 0.565, fz);
  h.group.add(water);
  // The hologram: a wireframe Ragol with an orbit ring, over a light cone.
  const holo = new THREE.Group();
  holo.position.set(fx, 3.1, fz);
  const wireMat = new THREE.MeshBasicMaterial({ color: accent, wireframe: true, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending });
  const globe = new THREE.Mesh(new THREE.IcosahedronGeometry(1.0, 2), wireMat);
  const coreMat = new THREE.MeshBasicMaterial({ color: 0x2a7ad8, transparent: true, opacity: 0.25, depthWrite: false, blending: THREE.AdditiveBlending });
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.92, 24, 16), coreMat);
  const orbit = new THREE.Mesh(new THREE.TorusGeometry(1.45, 0.02, 4, 64), new THREE.MeshBasicMaterial({ color: t.accent3 ?? 0xe8b84a, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending }));
  orbit.rotation.x = Math.PI / 2 - 0.35;
  const moon = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), lit(0xffffff));
  const moonPivot = new THREE.Group();
  moonPivot.rotation.x = -0.35;
  moon.position.x = 1.45;
  moonPivot.add(moon);
  holo.add(globe, core, orbit, moonPivot, glowSprite(accent, 3.2, 0.22));
  const cone = new THREE.Mesh(
    new THREE.CylinderGeometry(0.95, 0.35, 1.1, 24, 1, true),
    new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  cone.position.set(fx, 2.45, fz);
  h.group.add(holo, cone);
  h.animate((_dt, time) => {
    globe.rotation.y = time * 0.25;
    core.rotation.y = time * 0.25;
    moonPivot.rotation.y = time * 0.6;
    holo.position.y = 3.1 + Math.sin(time * 0.8) * 0.08;
    waterMat.emissiveIntensity = 0.8 + Math.sin(time * 1.3) * 0.2;
  });
  // Floor inlay: a gold ring and a light ring around the fountain, with spokes toward the shops.
  b.add(m.gold, new THREE.RingGeometry(4.0, 4.14, 64).rotateX(-Math.PI / 2).translate(fx, 0.012, fz));
  glows.add(m.strip, new THREE.RingGeometry(4.9, 4.95, 64).rotateX(-Math.PI / 2).translate(fx, 0.013, fz));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    b.add(m.blue, new THREE.PlaneGeometry(0.3, 0.8).rotateX(-Math.PI / 2).rotateY(-a).translate(fx + Math.sin(a) * 4.5, 0.012, fz + Math.cos(a) * 4.5));
  }
  for (const a of [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4]) {
    const bx = fx + Math.sin(a) * 6.4;
    const bz = fz + Math.cos(a) * 6.4;
    bench(b, m, bx, bz, a + Math.PI);
    solid(bx, bz, 0.95);
  }
  // Planters between the booths, in the corners and beside the promenade.
  const shops = counters.filter((f) => f.room === 'plaza' && f.z < fz).sort((p, q) => p.x - q.x);
  for (let i = 0; i + 1 < shops.length; i++) {
    const px = (shops[i].x + shops[i + 1].x) / 2;
    planter(b, m, px, plaza.minZ + 1.3);
    solid(px, plaza.minZ + 1.3, 1.0);
  }
  for (const [px, pz] of [
    [plaza.minX + 2, plaza.minZ + 1.6], [plaza.maxX - 2, plaza.minZ + 1.6],
    [plaza.minX + 2, plaza.maxZ - 1.6], [plaza.maxX - 2, plaza.maxZ - 1.6],
    [prom.minX - 2, plaza.maxZ - 1.4], [prom.maxX + 2, plaza.maxZ - 1.4],
  ]) {
    planter(b, m, px, pz, 1.1);
    solid(px, pz, 1.1);
  }
  // Lamp posts.
  for (const [lx, lz] of [[fx - 11, fz - 3], [fx + 11, fz - 3], [fx - 11, fz + 6], [fx + 11, fz + 6], [prom.minX + 1, deck.minZ + 1.6], [prom.maxX - 1, deck.minZ + 1.6]]) {
    b.add(m.metal, new THREE.CylinderGeometry(0.07, 0.12, 3.6, 8).translate(lx, 1.8, lz));
    b.add(m.white, new THREE.CylinderGeometry(0.25, 0.32, 0.25, 10).translate(lx, 0.12, lz));
    glows.add(lit(0xa8d4f0), new THREE.CylinderGeometry(0.22, 0.14, 0.32, 10).translate(lx, 3.7, lz));
    const s = glowSprite(0x9fd4ff, 2.0, 0.28);
    s.position.set(lx, 3.7, lz);
    h.group.add(s);
    solid(lx, lz, 0.3);
  }

  // ------------------------------------------------------------ promenade
  // Arches at both mouths (signs toward the plaza and the deck) and chevrons pointing to the transporter.
  const pcx = (prom.minX + prom.maxX) / 2;
  for (const [z, text, yaw] of [[prom.minZ, 'RAGOL TRANSPORTER', Math.PI], [prom.maxZ, 'SHOPPING DISTRICT', 0]] as const) {
    for (const x of [prom.minX + 0.35, prom.maxX - 0.35]) {
      b.add(m.white, box(0.7, 5.8, 0.9, x, 2.9, z));
      glows.add(m.strip, box(0.72, 0.06, 0.92, x, 0.6, z));
      b.add(m.blue, box(0.74, 0.7, 0.94, x, 2.55, z));
      solid(x, z, 0.5);
    }
    b.add(m.white, box(prom.maxX - prom.minX, 0.8, 0.9, pcx, 5.6, z));
    b.add(m.gold, box(prom.maxX - prom.minX, 0.06, 0.94, pcx, 5.18, z));
    h.group.add(sign(text, accent, 6.4, pcx, 5.6, z + (yaw === 0 ? 0.47 : -0.47), yaw));
  }
  const chevMat = glowMaterial(accent, 0.5);
  const chevrons: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) {
    const z = prom.minZ + 2 + i * 2;
    for (const s of [-1, 1]) chevrons.push(new THREE.PlaneGeometry(1.6, 0.35).rotateX(-Math.PI / 2).rotateY(s * 0.6).translate(pcx + s * 0.62, 0.014, z - 0.45));
  }
  const chevMesh = new THREE.Mesh(mergeGeometries(chevrons)!, chevMat);
  h.group.add(chevMesh);
  h.animate((_dt, time) => (chevMat.opacity = 0.35 + 0.25 * Math.max(0, Math.sin(time * 2.4))));

  // ------------------------------------------------------------ deck: the transporter gate
  const tp = h.features.find((f) => f.def.kind === 'cityTeleporter');
  if (tp) {
    const { x, z } = tp;
    glows.add(lit(t.accent2 ?? 0x2f62c8), new THREE.RingGeometry(2.55, 2.65, 64).rotateX(-Math.PI / 2).translate(x, 0.012, z));
    glows.add(m.strip, new THREE.RingGeometry(3.4, 3.46, 64).rotateX(-Math.PI / 2).translate(x, 0.013, z));
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      b.add(m.gold, new THREE.PlaneGeometry(0.5, 0.16).rotateX(-Math.PI / 2).rotateY(-a).translate(x + Math.sin(a) * 3.0, 0.012, z + Math.cos(a) * 3.0));
    }
    // Two pylons and an arch over the pad.
    for (const s of [-1, 1]) {
      const px = x + s * 5;
      b.add(m.kick, box(1.3, 0.4, 1.3, px, 0.2, z));
      b.add(m.white, new THREE.CylinderGeometry(0.38, 0.5, 6.2, 8).translate(px, 3.3, z));
      b.add(m.blue, new THREE.CylinderGeometry(0.42, 0.42, 0.6, 8).translate(px, 2.6, z));
      b.add(m.gold, new THREE.CylinderGeometry(0.44, 0.44, 0.06, 8).translate(px, 2.95, z));
      glows.add(m.strip, box(0.08, 4.6, 0.08, px - s * 0.4, 3.4, z));
      solid(px, z, 0.7);
    }
    b.add(m.white, new THREE.TorusGeometry(5, 0.26, 8, 48, Math.PI).translate(x, 6.3, z));
    glows.add(m.strip, new THREE.TorusGeometry(4.72, 0.05, 4, 48, Math.PI).translate(x, 6.3, z));
    const halo = new THREE.Mesh(new THREE.TorusGeometry(1.7, 0.04, 4, 48), new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending }));
    halo.rotation.x = Math.PI / 2;
    halo.position.set(x, 4.6, z);
    h.group.add(halo);
    h.animate((_dt, time) => {
      halo.position.y = 4.6 + Math.sin(time * 1.1) * 0.15;
      halo.scale.setScalar(1 + Math.sin(time * 1.1) * 0.04);
    });
    // Runway lights from the promenade to the pad.
    for (let lz = deck.minZ + 1; lz < z - 3.5; lz += 2) for (const s of [-1, 1]) glows.add(m.strip, box(0.3, 0.04, 0.3, x + s * 2.2, 0.02, lz));
    // Consoles beside the approach.
    for (const s of [-1, 1]) {
      const cx = x + s * 3.4;
      const cz = z - 4.2;
      b.add(m.white, box(1.1, 1.0, 0.7, cx, 0.5, cz));
      b.add(m.dark, box(1.15, 0.1, 0.8, cx, 1.06, cz + 0.05));
      glows.add(lit(0x7fe0ff), box(0.8, 0.02, 0.45, cx, 1.12, cz + 0.05));
      solid(cx, cz, 0.7);
    }
  }
  // Benches facing the window, planters in the deck's corners.
  for (const bx of [-13, -8.5, 8.5, 13]) {
    const x = (deck.minX + deck.maxX) / 2 + bx;
    const z = deck.maxZ - 3.4;
    bench(b, m, x, z, 0);
    solid(x, z, 0.95);
  }
  for (const [px, pz] of [[deck.minX + 2, deck.minZ + 1.8], [deck.maxX - 2, deck.minZ + 1.8], [deck.minX + 2, deck.maxZ - 2.2], [deck.maxX - 2, deck.maxZ - 2.2]]) {
    planter(b, m, px, pz, 1.1);
    solid(px, pz, 1.1);
  }

  // ------------------------------------------------------------ the window
  // A sill with a gold rail, glass panes between dark mullions, a header beam, and a dark band on the floor.
  const glassMat = new THREE.MeshStandardMaterial({ color: 0xa8d0ff, roughness: 0.05, metalness: 0.9, transparent: true, opacity: 0.1, depthWrite: false });
  const glass: THREE.BufferGeometry[] = [];
  windowFaces.forEach((w) => {
    const along = w.nx !== 0;
    const sz = (len: number, depth: number): [number, number] => (along ? [depth, len] : [len, depth]);
    const at = (out: number): [number, number] => [w.x + w.nx * out, w.z + w.nz * out];
    let [a, c] = sz(TILE, 0.45);
    b.add(m.white, box(a, 0.85, c, ...withY(at(0.22), 0.425)));
    [a, c] = sz(TILE, 0.5);
    b.add(m.gold, box(a, 0.06, c, ...withY(at(0.25), 0.88)));
    // A dark band on the floor along the glass.
    const band = new THREE.PlaneGeometry(TILE, 1.4).rotateX(-Math.PI / 2);
    if (along) band.rotateY(Math.PI / 2);
    b.add(m.kick, band.translate(...withY(at(1.15), 0.008)));
    [a, c] = sz(TILE, 0.04);
    glows.add(lit(t.accent3 ?? 0xe8b84a), box(a, 0.012, c, ...withY(at(1.85), 0.01)));
    const pane = new THREE.PlaneGeometry(TILE, 4.2);
    if (along) pane.rotateY(Math.PI / 2);
    glass.push(pane.translate(w.x, 0.9 + 2.1, w.z));
    // Mullions every two tiles and the header beam.
    const tileIdx = Math.round((along ? w.z : w.x) / TILE - 0.5);
    if (tileIdx % 2 === 0) {
      const [mx, mz] = along ? [w.x, w.z - TILE / 2] : [w.x - TILE / 2, w.z];
      b.add(m.kick, box(along ? 0.35 : 0.22, 5.2, along ? 0.22 : 0.35, mx, 2.6, mz));
    }
    [a, c] = sz(TILE, 0.5);
    b.add(m.white, box(a, 0.7, c, ...withY(at(0.1), 5.35)));
    [a, c] = sz(TILE, 0.04);
    glows.add(m.strip, box(a, 0.05, c, ...withY(at(0.36), 5.0)));
  });
  if (glass.length) {
    const gm = new THREE.Mesh(mergeGeometries(glass)!, glassMat);
    gm.renderOrder = 2;
    h.group.add(gm);
    buildOutside(h, windowFaces, rng, glows, m);
  }

  buildSkyline(h, rng, b, glows, deck.maxZ);
  b.flush(h.group);
  glows.flush(h.group, false);
}

const withY = ([x, z]: [number, number], y: number): [number, number, number] => [x, y, z];

/** The shop's wares on the wall behind the counter. P(along, out) maps booth coordinates to the world. */
function wares(
  kind: FeatureKind,
  color: number,
  P: (along: number, out: number) => [number, number],
  yaw: number,
  b: Batches,
  glows: Batches,
  m: Mats,
): void {
  const at = (along: number, out: number, y: number) => withY(P(along, out), y);
  // A dark display panel with a coloured frame line.
  b.add(m.dark, box(4.6, 2.2, 0.1, ...at(0, 0.05, 2.3), yaw));
  glows.add(lit(color), box(4.7, 0.05, 0.12, ...at(0, 0.06, 3.42), yaw));
  glows.add(lit(color), box(4.7, 0.05, 0.12, ...at(0, 0.06, 1.18), yaw));
  const glowMat = lit(color);
  const steel = m.metal;
  const add = (mat: THREE.Material, g: THREE.BufferGeometry, along: number, y: number, out = 0.2, roll = 0) => {
    if (roll) g.rotateZ(roll);
    g.rotateY(yaw);
    const [x, , z] = at(along, out, y);
    (mat instanceof THREE.MeshBasicMaterial ? glows : b).add(mat, g.translate(x, y, z));
  };
  if (kind === 'shopWeapon') {
    // Three sabers on a rack and two handguns.
    for (const [i, a] of [[-1.5, 0.5], [0, 0], [1.5, -0.5]] as const) {
      add(steel, new THREE.BoxGeometry(0.09, 0.4, 0.09), i, 1.75, 0.2, a);
      add(glowMat, new THREE.BoxGeometry(0.06, 1.2, 0.05), i - Math.sin(a) * 0.8, 1.75 + Math.cos(a) * 0.8, 0.2, a);
    }
    for (const i of [-0.75, 0.75]) {
      add(steel, new THREE.BoxGeometry(0.5, 0.14, 0.08), i, 3.0);
      add(steel, new THREE.BoxGeometry(0.1, 0.24, 0.08), i - 0.15, 2.85, 0.2, 0.2);
      add(glowMat, new THREE.BoxGeometry(0.2, 0.04, 0.09), i + 0.1, 3.03);
    }
  } else if (kind === 'shopArmor') {
    // Frames: hexagonal plates with a lit core, on stands.
    for (const i of [-1.5, 0, 1.5]) {
      add(m.white, new THREE.CylinderGeometry(0.55, 0.55, 0.1, 6).rotateX(Math.PI / 2), i, 2.4);
      add(m.blue, new THREE.CylinderGeometry(0.4, 0.4, 0.12, 6).rotateX(Math.PI / 2), i, 2.4, 0.22);
      add(glowMat, new THREE.CylinderGeometry(0.14, 0.14, 0.14, 6).rotateX(Math.PI / 2), i, 2.4, 0.24);
      add(steel, new THREE.BoxGeometry(0.08, 0.9, 0.08), i, 1.55);
    }
  } else if (kind === 'shopItem') {
    // Shelves of capsules: Monomate green, Monofluid blue, Antidote yellow, Sol red.
    const caps = [0x50e070, 0x4aa8ff, 0xf0d040, 0xff5060];
    for (const y of [1.6, 2.35, 3.1]) {
      add(m.white, new THREE.BoxGeometry(4.2, 0.06, 0.35), 0, y - 0.18);
      for (let k = 0; k < 9; k++) {
        const c = caps[(k + Math.round(y * 3)) % caps.length];
        add(lit(c), new THREE.CapsuleGeometry(0.08, 0.16, 2, 6), -1.8 + k * 0.45, y, 0.25);
      }
    }
  } else if (kind === 'medical') {
    // A big lit cross and two monitors.
    add(glowMat, new THREE.BoxGeometry(1.2, 0.36, 0.06), 0, 2.4);
    add(glowMat, new THREE.BoxGeometry(0.36, 1.2, 0.06), 0, 2.4);
    for (const i of [-1.6, 1.6]) {
      add(m.kick, new THREE.BoxGeometry(0.8, 0.55, 0.08), i, 2.6);
      add(lit(0x60ffb0), new THREE.BoxGeometry(0.6, 0.04, 0.09), i, 2.6);
    }
  } else if (kind === 'stylist') {
    // Colour swatches.
    for (let r = 0; r < 3; r++)
      for (let k = 0; k < 7; k++) {
        const c = new THREE.Color().setHSL((k / 7 + r * 0.05) % 1, 0.6, 0.55 + r * 0.08).getHex();
        add(lit(c), new THREE.BoxGeometry(0.42, 0.42, 0.05), -1.65 + k * 0.55, 1.75 + r * 0.6);
      }
  }
}

/** Below the window: the ship's hull falling away, Ragol beneath, and shuttles going by. */
function buildOutside(
  h: CityHost,
  faces: { x: number; z: number; nx: number; nz: number }[],
  rng: () => number,
  glows: Batches,
  m: Mats,
): void {
  // Only south-facing windows (nz = -1: the room is north of the glass) are supported for now.
  const xs = faces.map((f) => f.x);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const wz = faces[0].z;
  // The hull: a broad plate sloping away and down, with seams, light rows and masts.
  const slope = 0.3;
  const hull = new THREE.Group();
  hull.position.set(cx, -0.9, wz + 0.3);
  hull.rotation.x = slope;
  h.group.add(hull);
  const hullMat = std(0x46506a, 0.55, 0.6);
  const plate = new THREE.Mesh(new THREE.BoxGeometry(160, 1, 70).translate(0, -0.5, 35), hullMat);
  plate.receiveShadow = true;
  hull.add(plate);
  const seams: THREE.BufferGeometry[] = [];
  const dots: THREE.BufferGeometry[] = [];
  for (let z = 6; z < 70; z += 8) seams.push(new THREE.BoxGeometry(160, 0.05, 0.12).translate(0, 0.02, z));
  for (let x = -76; x <= 76; x += 12) seams.push(new THREE.BoxGeometry(0.12, 0.05, 70).translate(x, 0.02, 35));
  for (let i = 0; i < 140; i++) dots.push(new THREE.BoxGeometry(0.4, 0.06, 0.2).translate((rng() - 0.5) * 150, 0.04, 4 + rng() * 64));
  hull.add(new THREE.Mesh(mergeGeometries(seams)!, std(0x2a3246, 0.6, 0.5)));
  hull.add(new THREE.Mesh(mergeGeometries(dots)!, lit(0xffe2a8)));
  const beacons: THREE.Sprite[] = [];
  for (let i = 0; i < 6; i++) {
    const x = (rng() - 0.5) * 120;
    const z = 12 + rng() * 50;
    const tall = 4 + rng() * 8;
    hull.add(new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.3, tall, 6).translate(x, tall / 2, z), hullMat));
    hull.add(new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.15, 0.15).translate(x, tall * 0.7, z), hullMat));
    const s = glowSprite(0xff3a2a, 2.2, 0.8);
    s.position.set(x, tall + 0.2, z);
    hull.add(s);
    beacons.push(s);
  }
  // A long light strip along the hull's edge, just below the sill.
  glows.add(m.strip, new THREE.BoxGeometry(faces.length * TILE, 0.08, 0.08).translate(cx, -0.6, wz + 0.5));

  // Ragol, far below.
  const R = 150;
  const ragolMat = ragolMaterial(R);
  const ragol = new THREE.Mesh(new THREE.SphereGeometry(R, 96, 64), ragolMat);
  // From the usual camera (3 m up, 20 m back) the glass spans about -7 to +5 degrees: the limb sits near -1.
  ragol.position.set(cx - 30, -152, wz + 200);
  ragol.renderOrder = -5;
  h.group.add(ragol);
  const atmo = glowSprite(0x3a70d0, R * 2.45, 0.3);
  (atmo.material as THREE.SpriteMaterial).fog = false;
  atmo.position.copy(ragol.position);
  atmo.renderOrder = -6;
  h.group.add(atmo);

  // Shuttles crossing the view, blinking.
  const ships: { g: THREE.Group; speed: number; span: number; base: number; blink: THREE.Sprite }[] = [];
  for (let i = 0; i < 3; i++) {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.7, 1.1), m.white));
    g.add(new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.12, 3.4).translate(-0.4, 0, 0), m.panel));
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.4, 0.9).translate(1.2, 0.35, 0), m.blue));
    const engine = glowSprite(0x7ad8ff, 2.2, 0.9);
    engine.position.x = -1.8;
    g.add(engine);
    const blink = glowSprite(0xff4030, 1.2, 0.9);
    blink.position.set(0, 0.5, 0);
    g.add(blink);
    const dir = i % 2 === 0 ? 1 : -1;
    g.scale.set(dir, 1, 1);
    g.position.set(cx, -6 - i * 7 + rng() * 4, wz + 45 + i * 28);
    h.group.add(g);
    ships.push({ g, speed: dir * (5 + rng() * 5), span: 140, base: rng() * 140, blink });
  }
  h.animate((_dt, time) => {
    ragolMat.uniforms.t.value = time;
    for (const s of beacons) (s.material as THREE.SpriteMaterial).opacity = Math.sin(time * 2.5 + s.position.x) > 0.6 ? 0.9 : 0.1;
    for (const s of ships) {
      const u = ((s.base + time * Math.abs(s.speed)) % s.span) - s.span / 2;
      s.g.position.x = cx + Math.sign(s.speed) * u;
      (s.blink.material as THREE.SpriteMaterial).opacity = Math.sin(time * 6 + s.base) > 0.7 ? 1 : 0.05;
    }
  });
}

/** Colony towers beyond the walls (never in front of the window), with lit window bands and beacons. */
function buildSkyline(h: CityHost, rng: () => number, b: Batches, glows: Batches, windowZ: number): void {
  const minX = Math.min(...h.rooms.map((r) => r.rect.minX));
  const maxX = Math.max(...h.rooms.map((r) => r.rect.maxX));
  const minZ = Math.min(...h.rooms.map((r) => r.rect.minZ));
  const cx = (minX + maxX) / 2;
  const cz = (minZ + windowZ) / 2;
  const towerMat = std(0x8a94a8, 0.6, 0.3);
  const bandCool = lit(0x3a7aa8);
  const bandWarm = lit(0xb89a6a);
  const capMat = std(0xb8c0d0, 0.5, 0.3);
  const beacons: THREE.Sprite[] = [];
  const placed: [number, number, number][] = [];
  for (let i = 0; i < 70 && placed.length < 26; i++) {
    const a = rng() * Math.PI * 2;
    const dist = 38 + rng() * 45;
    const x = cx + Math.sin(a) * dist * 1.3;
    const z = cz + Math.cos(a) * dist;
    // Outside the walls with a margin, and north of the window line so the view onto Ragol stays clear.
    if (x > minX - 10 && x < maxX + 10 && z > minZ - 10 && z < windowZ + 4) continue;
    if (z > windowZ - 6) continue;
    const w = 6 + rng() * 8;
    if (placed.some(([px, pz, pw]) => Math.abs(px - x) < (pw + w) / 2 + 2 && Math.abs(pz - z) < (pw + w) / 2 + 2)) continue;
    placed.push([x, z, w]);
    const hgt = 16 + rng() * 34;
    const round = rng() < 0.35;
    b.add(towerMat, round ? new THREE.CylinderGeometry(w / 2, w / 2 + 0.6, hgt, 12).translate(x, hgt / 2 - 2, z) : box(w, hgt, w, x, hgt / 2 - 2, z));
    for (let y = 3; y < hgt - 3; y += 3.2) {
      const band = rng() < 0.7 ? bandCool : bandWarm;
      glows.add(band, round ? new THREE.CylinderGeometry(w / 2 + 0.05, w / 2 + 0.05, 0.5, 12).translate(x, y, z) : box(w + 0.1, 0.5, w + 0.1, x, y, z));
    }
    b.add(capMat, round ? new THREE.CylinderGeometry(w / 2 - 1, w / 2 + 0.3, 1.6, 12).translate(x, hgt - 1.2, z) : box(w - 1.5, 1.6, w - 1.5, x, hgt - 1.2, z));
    const s = glowSprite(0xff4a3a, 3, 0.8);
    s.position.set(x, hgt + 0.2, z);
    h.group.add(s);
    beacons.push(s);
  }
  h.animate((_dt, time) => {
    beacons.forEach((s, i) => ((s.material as THREE.SpriteMaterial).opacity = Math.sin(time * 1.6 + i * 1.7) > 0.5 ? 0.85 : 0.1));
  });
}
