import * as THREE from 'three';
import { resolveCircleBoxes, type Box2 } from '../collision';
import type { AreaDef, FeatureDef, RoomDef } from '../data/areas';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { neutralPropGeometry, propGeometry, propMaterial, type PropKind } from '../models/props';
import { warden as wardenCfg } from '../config';
import { glowMaterial, glowSprite, glowTexture } from './glow';

export const TILE = 2;

export interface Rect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface Gate {
  /** Tiles the gate occupies. */
  tiles: [number, number][];
  /** Room whose activation closes this gate. */
  room: string;
  lock?: string;
  closed: boolean;
  locked: boolean;
  mesh: THREE.Group;
}

export interface RoomRuntime {
  def: RoomDef;
  rect: Rect; // world space
}

export interface PlacedFeature {
  def: FeatureDef;
  room: string;
  x: number;
  z: number;
}

export interface TreeCollider {
  x: number;
  z: number;
  r: number;
}

/** Deterministic PRNG so layouts are identical every run. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const BORDER = 2;

/** Give a geometry one vertex colour (for merged, per-piece tinted glow meshes). */
function tinted(geo: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const c = new THREE.Color(hex);
  const n = geo.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

/** Additive glow that takes its colour from vertex colours. */
function glowVertexMaterial(opacity: number, soft = true): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    map: soft ? glowTexture() : null, vertexColors: true, opacity, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
}

/** Glyph-like blocks for holographic wall signs (DataTexture, no DOM). */
let signTex: THREE.DataTexture | null = null;
function signTexture(): THREE.DataTexture {
  if (signTex) return signTex;
  const w = 64;
  const h = 32;
  const data = new Uint8Array(w * h * 4);
  const rng = mulberry32(99);
  for (let row = 0; row < 3; row++) {
    let x = 4;
    while (x < w - 6) {
      const gw = 2 + Math.floor(rng() * 5);
      const on = rng() < 0.8;
      for (let y = 4 + row * 9; y < 10 + row * 9; y++) for (let xx = x; xx < Math.min(w - 4, x + gw); xx++) {
        const a = on ? 255 : 0;
        data.set([255, 255, 255, a], (y * w + xx) * 4);
      }
      x += gw + 1 + Math.floor(rng() * 2);
    }
  }
  for (let x = 0; x < w; x++) for (const y of [0, 1, h - 2, h - 1]) data.set([255, 255, 255, 200], (y * w + x) * 4);
  signTex = new THREE.DataTexture(data, w, h);
  signTex.magFilter = THREE.NearestFilter;
  signTex.needsUpdate = true;
  return signTex;
}
/** Water surface height around the De Rol Le raft (the deck is at 0). */
export const WATER_Y = -0.7;

export class Level {
  readonly group = new THREE.Group();
  readonly width: number;
  readonly height: number;
  readonly rooms: RoomRuntime[] = [];
  readonly gates: Gate[] = [];
  readonly trees: TreeCollider[] = [];
  readonly features: PlacedFeature[] = [];
  readonly boxSpots: { id: string; room: string; x: number; z: number }[] = [];
  /** Rocks, stumps and bushes placed as clutter (for overlap tests). */
  solidClutter: { x: number; z: number; r: number }[] = [];
  /** Lava vents and marsh pools (world space), kept clear of props and boxes. */
  readonly hazardSpots: { x: number; z: number; r: number }[] = [];
  private floor: Uint8Array;
  /** Rendered wall height per tile (0 for floor). */
  private wallH: Float32Array;
  private tmpBoxes: Box2[] = [];
  /** Per-frame scenery animation (lava flicker, embers). */
  private animators: ((dt: number, t: number) => void)[] = [];
  private time = 0;

  constructor(readonly def: AreaDef) {
    let maxX = 0;
    let maxZ = 0;
    for (const r of def.rooms) {
      maxX = Math.max(maxX, r.x + r.w);
      maxZ = Math.max(maxZ, r.z + r.h);
    }
    this.width = maxX + BORDER * 2;
    this.height = maxZ + BORDER * 2;
    this.floor = new Uint8Array(this.width * this.height);
    this.wallH = new Float32Array(this.width * this.height);

    for (const r of def.rooms) {
      const x0 = r.x + BORDER;
      const z0 = r.z + BORDER;
      for (let z = z0; z < z0 + r.h; z++)
        for (let x = x0; x < x0 + r.w; x++) this.setFloor(x, z);
      this.rooms.push({
        def: r,
        rect: { minX: x0 * TILE, maxX: (x0 + r.w) * TILE, minZ: z0 * TILE, maxZ: (z0 + r.h) * TILE },
      });
      for (const f of r.features ?? []) {
        this.features.push({ def: f, room: r.id, x: (x0 + f.tx) * TILE, z: (z0 + f.tz) * TILE });
      }
      for (const [tx, tz] of r.vents ?? []) this.hazardSpots.push({ x: (x0 + tx) * TILE, z: (z0 + tz) * TILE, r: 2.6 });
      for (const [tx, tz, rx, rz] of [...(r.marsh ?? []), ...(r.slag ?? [])]) this.hazardSpots.push({ x: (x0 + tx) * TILE, z: (z0 + tz) * TILE, r: Math.max(rx, rz) * TILE + 0.5 });
      // Machinery: keep props and boxes off it too.
      for (const c of r.crushers ?? []) this.hazardSpots.push({ x: (x0 + c.tx) * TILE, z: (z0 + c.tz) * TILE, r: 2.8 });
      for (const l of r.lasers ?? []) {
        for (let k = 0; k <= 4; k++) {
          const tx = l.ax + ((l.bx - l.ax) * k) / 4;
          const tz = l.az + ((l.bz - l.az) * k) / 4;
          this.hazardSpots.push({ x: (x0 + tx) * TILE, z: (z0 + tz) * TILE, r: 1.2 });
        }
      }
      for (const c of r.conveyors ?? []) {
        this.hazardSpots.push({ x: (x0 + c.tx + c.w / 2) * TILE, z: (z0 + c.tz + c.h / 2) * TILE, r: (Math.hypot(c.w, c.h) / 2) * TILE });
      }
    }
    for (const link of def.links) this.carveLink(link.a, link.b, link.lock);

    this.placeProps();
    this.buildMeshes();
  }

  // ----------------------------------------------------------- building

  private room(id: string): RoomDef {
    const r = this.def.rooms.find((r) => r.id === id);
    if (!r) throw new Error(`Unknown room ${id}`);
    return r;
  }

  private setFloor(x: number, z: number): void {
    this.floor[z * this.width + x] = 1;
  }

  private carveLink(aId: string, bId: string, lock?: string): void {
    let a = this.room(aId);
    let b = this.room(bId);
    const ox0 = Math.max(a.x, b.x);
    const ox1 = Math.min(a.x + a.w, b.x + b.w) - 1;
    const oz0 = Math.max(a.z, b.z);
    const oz1 = Math.min(a.z + a.h, b.z + b.h) - 1;
    const tilesA: [number, number][] = [];
    const tilesB: [number, number][] = [];
    let horizontalGate: boolean;

    if (ox1 - ox0 >= 1 && (a.z + a.h <= b.z || b.z + b.h <= a.z)) {
      // Vertical corridor (rooms stacked along Z).
      if (a.z > b.z) [a, b] = [b, a];
      const cx = Math.floor((ox0 + ox1) / 2);
      const zStart = a.z + a.h;
      const zEnd = b.z - 1;
      for (let z = zStart; z <= zEnd; z++) for (const x of [cx, cx + 1]) this.setFloor(x + BORDER, z + BORDER);
      tilesA.push([cx + BORDER, zStart + BORDER], [cx + 1 + BORDER, zStart + BORDER]);
      tilesB.push([cx + BORDER, zEnd + BORDER], [cx + 1 + BORDER, zEnd + BORDER]);
      horizontalGate = true;
    } else if (oz1 - oz0 >= 1 && (a.x + a.w <= b.x || b.x + b.w <= a.x)) {
      if (a.x > b.x) [a, b] = [b, a];
      const cz = Math.floor((oz0 + oz1) / 2);
      const xStart = a.x + a.w;
      const xEnd = b.x - 1;
      for (let x = xStart; x <= xEnd; x++) for (const z of [cz, cz + 1]) this.setFloor(x + BORDER, z + BORDER);
      tilesA.push([xStart + BORDER, cz + BORDER], [xStart + BORDER, cz + 1 + BORDER]);
      tilesB.push([xEnd + BORDER, cz + BORDER], [xEnd + BORDER, cz + 1 + BORDER]);
      horizontalGate = false;
    } else {
      throw new Error(`Rooms ${aId} and ${bId} are not aligned for a straight corridor`);
    }

    this.gates.push(this.makeGate(tilesA, a.id, lock, horizontalGate));
    this.gates.push(this.makeGate(tilesB, b.id, lock, horizontalGate));
  }

  private makeGate(tiles: [number, number][], room: string, lock: string | undefined, spansX: boolean): Gate {
    const g = new THREE.Group();
    const cx = ((tiles[0][0] + tiles[1][0]) / 2 + 0.5) * TILE;
    const cz = ((tiles[0][1] + tiles[1][1]) / 2 + 0.5) * TILE;
    g.position.set(cx, 0, cz);
    if (!spansX) g.rotation.y = Math.PI / 2;
    const color = lock ? 0xffb020 : 0xff3030;
    const fence = new THREE.Mesh(
      new THREE.PlaneGeometry(TILE * 2, 2.2),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false }),
    );
    fence.position.y = 1.1;
    fence.name = 'laser';
    g.add(fence);
    const barMat = new THREE.MeshBasicMaterial({ color });
    for (let i = 0; i < 4; i++) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(TILE * 2, 0.06, 0.06), barMat);
      bar.position.y = 0.3 + i * 0.6;
      bar.name = 'laser';
      g.add(bar);
    }
    const postMat = new THREE.MeshStandardMaterial({ color: 0x555a66 });
    for (const sx of [-TILE, TILE]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 2.6, 0.3), postMat);
      post.position.set(sx, 1.3, 0);
      g.add(post);
    }
    this.group.add(g);
    const gate: Gate = { tiles, room, lock, closed: false, locked: !!lock, mesh: g };
    this.refreshGate(gate);
    return gate;
  }

  refreshGate(g: Gate): void {
    // Posts stay; the fence and laser bars (tagged 'laser') toggle.
    const solid = g.closed || g.locked;
    for (const child of g.mesh.children) if (child.name === 'laser') child.visible = solid;
  }

  setRoomGates(room: string, closed: boolean): void {
    for (const g of this.gates) {
      if (g.room !== room) continue;
      g.closed = closed;
      this.refreshGate(g);
    }
  }

  unlock(lock: string): void {
    for (const g of this.gates) {
      if (g.lock !== lock) continue;
      g.locked = false;
      this.refreshGate(g);
    }
  }

  private placeProps(): void {
    for (const room of this.rooms) {
      const r = room.def;
      const rng = mulberry32(hashString(`${this.def.id}:${r.id}`));
      const x0 = r.x + BORDER;
      const z0 = r.z + BORDER;
      const taken: [number, number][] = this.features
        .filter((f) => f.room === r.id)
        .map((f) => [f.x, f.z]);
      const cx = (x0 + r.w / 2) * TILE;
      const cz = (z0 + r.h / 2) * TILE;
      taken.push([cx, cz]);

      const tryPlace = (margin: number, minGap: number): [number, number] | null => {
        for (let attempt = 0; attempt < 40; attempt++) {
          const tx = x0 + margin + rng() * (r.w - margin * 2);
          const tz = z0 + margin + rng() * (r.h - margin * 2);
          const x = tx * TILE;
          const z = tz * TILE;
          if (taken.some(([px, pz]) => Math.hypot(px - x, pz - z) < minGap)) continue;
          if (this.hazardSpots.some((h) => Math.hypot(h.x - x, h.z - z) < h.r + 1)) continue;
          taken.push([x, z]);
          return [x, z];
        }
        return null;
      };

      if (this.def.theme.trees) {
        for (let i = 0; i < (r.trees ?? 0); i++) {
          const p = tryPlace(2, 6.5); // canopies of neighbouring trees don't interpenetrate
          if (p) this.trees.push({ x: p[0], z: p[1], r: 0.7 });
        }
      }
      for (let i = 0; i < (r.boxes ?? 0); i++) {
        const p = tryPlace(1.2, 3);
        if (p) this.boxSpots.push({ id: `${r.id}-box${i}`, room: r.id, x: p[0], z: p[1] });
      }
    }
  }

  private buildMeshes(): void {
    const t = this.def.theme;
    let floorCount = 0;
    let wallCount = 0;
    for (let z = 0; z < this.height; z++)
      for (let x = 0; x < this.width; x++) {
        if (this.isFloor(x, z)) floorCount++;
        else if (this.touchesFloor(x, z)) wallCount++;
      }

    const gloss = t.floorGloss ?? 0;
    const floorMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(TILE, 0.2, TILE),
      new THREE.MeshStandardMaterial({ roughness: 1 - gloss * 0.72, metalness: gloss * 0.55 }),
      floorCount,
    );
    floorMesh.receiveShadow = true;
    const wallMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(TILE, 1, TILE).translate(0, 0.5, 0),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 - gloss * 0.4, metalness: gloss * 0.35, flatShading: true }),
      wallCount,
    );
    wallMesh.castShadow = true;
    wallMesh.receiveShadow = true;

    const m = new THREE.Matrix4();
    const wallRng = mulberry32(hashString(`${this.def.id}:walls`));
    const wallColor = new THREE.Color();
    const c1 = new THREE.Color(t.floor);
    const c2 = new THREE.Color(t.floorAlt);
    const lair = this.def.kind === 'boss' && !t.scenery;
    const cave = t.scenery === 'volcanic' || t.scenery === 'marsh';
    const river = t.scenery === 'river';
    const mine = t.scenery === 'foundry' || t.scenery === 'control' || t.scenery === 'warden';
    // Forest, cave and lair edges are uneven rock/earth; the city gets flat walls.
    const rugged = t.trees || lair || cave;
    const floorRng = mulberry32(hashString(`${this.def.id}:floor`));
    const floorColor = new THREE.Color();
    let fi = 0;
    let wi = 0;
    for (let z = 0; z < this.height; z++)
      for (let x = 0; x < this.width; x++) {
        if (this.isFloor(x, z)) {
          m.makeTranslation((x + 0.5) * TILE, -0.1, (z + 0.5) * TILE);
          floorMesh.setMatrixAt(fi, m);
          // The lair and cave floors are blotchy ash and rock rather than a checkerboard.
          if (lair || cave) {
            // Broad low-frequency patches with a little per-tile jitter, so the tile grid doesn't show.
            const k = 0.5 + 0.28 * Math.sin(x * 0.37 + Math.sin(z * 0.23) * 2) * Math.cos(z * 0.31 - x * 0.11) + (floorRng() - 0.5) * 0.12;
            floorMesh.setColorAt(fi, floorColor.lerpColors(c1, c2, Math.min(1, Math.max(0, k))));
          } else if (mine) {
            // Deck plates: a checker with a little wear per plate.
            floorColor.copy((x + z) % 2 === 0 ? c1 : c2).offsetHSL(0, 0, (floorRng() - 0.5) * 0.03);
            floorMesh.setColorAt(fi, floorColor);
          }
          else floorMesh.setColorAt(fi, (x + z) % 2 === 0 ? c1 : c2);
          fi++;
        } else if (river) {
          // Open water all around the raft: nothing for the camera to bump into.
          this.wallH[z * this.width + x] = -100;
        } else if (this.touchesFloor(x, z)) {
          // Mines walls are flat panels with the odd taller buttress.
          const h = rugged ? t.wallHeight + wallRng() * (lair || cave ? 2.2 : 0.9) : mine && wallRng() < 0.18 ? t.wallHeight + 1.6 : t.wallHeight;
          this.wallH[z * this.width + x] = h;
          m.compose(new THREE.Vector3((x + 0.5) * TILE, 0, (z + 0.5) * TILE), new THREE.Quaternion(), new THREE.Vector3(1, h, 1));
          wallMesh.setMatrixAt(wi, m);
          wallColor.set(t.wall);
          if (rugged || mine) wallColor.offsetHSL((wallRng() - 0.5) * 0.02, 0, (wallRng() - 0.5) * (mine ? 0.04 : 0.06));
          wallMesh.setColorAt(wi, wallColor);
          wi++;
        } else {
          this.wallH[z * this.width + x] = t.wallHeight;
        }
      }
    this.group.add(floorMesh);
    if (!river) this.group.add(wallMesh);

    if (t.trees) this.buildForestScenery();
    if (lair) this.buildLairScenery();
    if (cave) this.buildCaveScenery(t.scenery === 'volcanic');
    if (river) this.buildRiverScenery();
    if (mine) this.buildMineScenery(t.scenery as 'foundry' | 'control' | 'warden');
  }

  /** Animate scenery (called by the world every frame). */
  update(dt: number): void {
    if (!this.animators.length) return;
    this.time += dt;
    for (const a of this.animators) a(dt, this.time);
  }

  /** Collects prop transforms per kind and turns each kind into one InstancedMesh. */
  /** `tint`: repaint every prop in this colour (area looks), over its brightened greys. */
  private propBatcher(rng: () => number, tint?: THREE.Color) {
    const batches = new Map<PropKind, THREE.Matrix4[]>();
    const put = (kind: PropKind, x: number, y: number, z: number, scale: number, yaw = rng() * Math.PI * 2) => {
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(x, y, z),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw),
        new THREE.Vector3(scale, scale * (0.9 + rng() * 0.25), scale),
      );
      if (!batches.has(kind)) batches.set(kind, []);
      batches.get(kind)!.push(m);
    };
    const tintAll = tint;
    const flush = () => {
      const material = propMaterial();
      const tintC = new THREE.Color();
      for (const [kind, mats] of batches) {
        const mesh = new THREE.InstancedMesh(tintAll ? neutralPropGeometry(kind) : propGeometry(kind), material, mats.length);
        mats.forEach((m, i) => {
          mesh.setMatrixAt(i, m);
          const v = 0.85 + rng() * 0.3;
          if (tintAll) mesh.setColorAt(i, tintC.copy(tintAll).multiplyScalar(v));
          else mesh.setColorAt(i, tintC.setRGB(v, v, v));
        });
        mesh.castShadow = kind !== 'grass' && kind !== 'bones';
        mesh.receiveShadow = true;
        this.group.add(mesh);
      }
    };
    return { put, flush };
  }

  /** Chebyshev distance (in tiles, up to 3) from a solid tile to the nearest floor tile. */
  private floorDistance(tx: number, tz: number): number {
    for (let d = 1; d <= 3; d++)
      for (let dz = -d; dz <= d; dz++)
        for (let dx = -d; dx <= d; dx++) if (this.isFloor(tx + dx, tz + dz)) return d;
    return 4;
  }

  /** Unit step toward an adjacent floor tile (4-neighbourhood), if any. */
  private floorNeighbour(tx: number, tz: number): [number, number] | null {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) if (this.isFloor(tx + dx, tz + dz)) return [dx, dz];
    return null;
  }

  /**
   * Forest dressing. Rules that keep things from intersecting:
   * - edge trees stand one tile behind the cliff face and use tall trunks, so
   *   foliage starts above the cliff top instead of slicing through it;
   * - cliff tops get a leafy crest and the cliff feet a few bushes;
   * - rocks and stumps are solid (colliders), spaced from each other, trees,
   *   boxes, features and gates.
   */
  private buildForestScenery(): void {
    const rng = mulberry32(hashString(`${this.def.id}:scenery`));
    const { put, flush } = this.propBatcher(rng);

    const roomTrees = [...this.trees];
    roomTrees.forEach((tr, i) => put(i % 3 === 2 ? 'tallbroad' : 'tallpine', tr.x, 0, tr.z, 0.9 + rng() * 0.2));

    const gateCenters = this.gates.map((g) => [((g.tiles[0][0] + g.tiles[1][0]) / 2 + 0.5) * TILE, ((g.tiles[0][1] + g.tiles[1][1]) / 2 + 0.5) * TILE]);
    const nearGate = (x: number, z: number, r: number) => gateCenters.some(([gx, gz]) => Math.hypot(gx - x, gz - z) < r);

    for (let tz = 0; tz < this.height; tz++)
      for (let tx = 0; tx < this.width; tx++) {
        if (this.isFloor(tx, tz)) continue;
        const d = this.floorDistance(tx, tz);
        const cx = (tx + 0.5) * TILE;
        const cz = (tz + 0.5) * TILE;
        if (d === 1) {
          const h = this.wallH[tz * this.width + tx];
          // Leafy crest along the cliff top (sits on top, never in front).
          put('bush', cx + (rng() - 0.5) * 0.6, h - 0.35, cz + (rng() - 0.5) * 0.6, 1.5 + rng() * 0.6);
          // Occasional bush at the cliff foot, pushed against the face.
          if (rng() < 0.3 && !nearGate(cx, cz, 4)) {
            const n = this.floorNeighbour(tx, tz);
            if (n) put('bush', cx + n[0] * TILE * 0.5, 0, cz + n[1] * TILE * 0.5, 0.8 + rng() * 0.35);
          }
        } else if (d === 2 && rng() < 0.6) {
          put(rng() < 0.7 ? 'tallpine' : 'tallbroad', cx + (rng() - 0.5) * 0.8, 0, cz + (rng() - 0.5) * 0.8, 1.05 + rng() * 0.45);
        }
      }

    // Ground clutter inside rooms.
    const solids: { x: number; z: number; r: number }[] = [];
    for (const room of this.rooms) {
      const q = room.rect;
      const area = ((q.maxX - q.minX) * (q.maxZ - q.minZ)) / 4;
      const spot = (margin: number, radius: number, solid: boolean): [number, number] | null => {
        for (let i = 0; i < 12; i++) {
          const x = q.minX + margin + rng() * (q.maxX - q.minX - margin * 2);
          const z = q.minZ + margin + rng() * (q.maxZ - q.minZ - margin * 2);
          if (roomTrees.some((t) => Math.hypot(t.x - x, t.z - z) < t.r + radius + 0.6)) continue;
          if (this.features.some((f) => Math.hypot(f.x - x, f.z - z) < 2.5 + radius)) continue;
          if (this.boxSpots.some((b) => Math.hypot(b.x - x, b.z - z) < 1.0 + radius)) continue;
          if (solid && nearGate(x, z, 5)) continue; // keep doorways clear
          if (solid && solids.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + radius + 0.8)) continue;
          return [x, z];
        }
        return null;
      };
      const scatter = (kind: PropKind, n: number, margin: number, s0: number, s1: number, footprint: number, blocking: boolean) => {
        const spaced = blocking || kind === 'bush';
        for (let i = 0; i < n; i++) {
          const scale = s0 + rng() * (s1 - s0);
          const r = footprint * scale;
          const p = spot(margin + r, r, spaced);
          if (!p) continue;
          put(kind, p[0], 0, p[1], scale);
          if (spaced) solids.push({ x: p[0], z: p[1], r });
          // Rocks and stumps block movement like trunks do.
          if (blocking) this.trees.push({ x: p[0], z: p[1], r: r * 0.85 });
        }
      };
      scatter('rock', Math.round(area / 45), 0.4, 0.6, 1.0, 1.0, true);
      scatter('stump', Math.round(area / 90), 0.4, 0.8, 1.05, 0.6, true);
      scatter('bush', Math.round(area / 30), 0.4, 0.8, 1.2, 0.85, false);
      scatter('grass', Math.round(area / 3), 0.6, 0.8, 1.4, 0.3, false);
    }
    this.solidClutter = solids;
    flush();
  }

  /**
   * Dragon's lair dressing. The arena floor stays open for the fight (charge,
   * burrow), so everything solid hugs the walls; the middle only gets flat
   * decoration: scorch marks, glowing lava cracks and loose bones.
   */
  private buildLairScenery(): void {
    const rng = mulberry32(hashString(`${this.def.id}:lair`));
    const { put, flush } = this.propBatcher(rng);
    const room = this.rooms[0].rect;
    const cx = (room.minX + room.maxX) / 2;
    const cz = (room.minZ + room.maxZ) / 2;
    const start = this.features.find((f) => f.def.kind === 'start');
    const solids: { x: number; z: number; r: number }[] = [];
    const block = (x: number, z: number, r: number) => {
      solids.push({ x, z, r });
      this.trees.push({ x, z, r });
    };
    const clear = (x: number, z: number, r: number) =>
      !solids.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + r + 0.5) && !(start && Math.hypot(start.x - x, start.z - z) < r + 4);

    // Cliffs: crags on the wall tops break the flat edge, taller spires behind form the skyline.
    for (let tz = 0; tz < this.height; tz++)
      for (let tx = 0; tx < this.width; tx++) {
        if (this.isFloor(tx, tz)) continue;
        const d = this.floorDistance(tx, tz);
        const x = (tx + 0.5) * TILE;
        const z = (tz + 0.5) * TILE;
        const n = this.floorNeighbour(tx, tz);
        if (d === 1) {
          const h = this.wallH[tz * this.width + tx];
          if (rng() < 0.55) {
            // Pushed back from the face so nothing overhangs the arena floor.
            const bx = n ? -n[0] * 0.5 : 0;
            const bz = n ? -n[1] * 0.5 : 0;
            put('crag', x + bx + (rng() - 0.5) * 0.5, h - 1.2, z + bz + (rng() - 0.5) * 0.5, 0.45 + rng() * 0.35);
          }
          // Boulders piled at the cliff foot, half sunk into the face.
          if (n && rng() < 0.16) {
            const s = 0.8 + rng() * 0.5;
            const fx = x + n[0] * TILE * 0.5;
            const fz = z + n[1] * TILE * 0.5;
            if (clear(fx, fz, s)) {
              put('boulder', fx, 0, fz, s);
              block(fx + n[0] * 0.3, fz + n[1] * 0.3, 0.75 * s);
            }
          }
        } else if (d === 2) {
          if (rng() < 0.12) put('deadtree', x, 0, z, 1.15 + rng() * 0.3);
          else if (rng() < 0.55) put('crag', x + (rng() - 0.5), 0, z + (rng() - 0.5), 1.1 + rng() * 0.7);
        } else if (d === 3 && rng() < 0.4) {
          put('crag', x + (rng() - 0.5), 0, z + (rng() - 0.5), 1.6 + rng() * 0.7);
        }
      }

    // Set pieces in the two far corners (the dragon's side): carcasses of earlier victims.
    for (const [sx, yaw] of [[-1, 0.6], [1, Math.PI - 0.6]] as const) {
      const x = cx + sx * (room.maxX - cx - 7.5);
      const z = room.minZ + 7.5;
      put('ribcage', x, 0, z, 1, yaw);
      // Collide on the spine (local z = -2.3, rotated by yaw); the inside of the cage is walkable.
      const c = Math.cos(yaw);
      const s = Math.sin(yaw);
      for (const lx of [-3.6, -1.2, 1.2, 3.6]) {
        const lz = -2.3;
        block(x + lx * c + lz * s, z - lx * s + lz * c, 0.5);
      }
    }
    for (let i = 0; i < 3; i++) {
      for (let a = 0; a < 20; a++) {
        const side = Math.floor(rng() * 4);
        const along = rng() * (room.maxX - room.minX - 8) - (room.maxX - room.minX - 8) / 2;
        const inset = 2.2 + rng() * 1.5;
        const [x, z] =
          side === 0 ? [cx + along, room.minZ + inset]
          : side === 1 ? [cx + along, room.maxZ - inset]
          : side === 2 ? [room.minX + inset, cz + along]
          : [room.maxX - inset, cz + along];
        if (!clear(x, z, 1)) continue;
        put('skull', x, 0, z, 1 + rng() * 0.3, Math.atan2(cx - x, cz - z) + (rng() - 0.5));
        block(x, z, 0.7);
        break;
      }
    }
    for (let i = 0; i < 5; i++) {
      for (let a = 0; a < 20; a++) {
        const ang = rng() * Math.PI * 2;
        const x = cx + Math.sin(ang) * (room.maxX - cx - 2.5);
        const z = cz + Math.cos(ang) * (room.maxZ - cz - 2.5);
        if (!clear(x, z, 0.6)) continue;
        put('deadtree', x, 0, z, 0.75 + rng() * 0.25);
        block(x, z, 0.45);
        break;
      }
    }
    // Loose bones anywhere (flat, not solid).
    for (let i = 0; i < 16; i++) {
      put('bones', room.minX + 2 + rng() * (room.maxX - room.minX - 4), 0, room.minZ + 2 + rng() * (room.maxZ - room.minZ - 4), 0.8 + rng() * 0.6);
    }

    // Scorch marks: soft dark blotches, merged into one mesh.
    const scorch: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 12; i++) {
      const w = 3 + rng() * 5;
      scorch.push(
        new THREE.PlaneGeometry(w, w * (0.6 + rng() * 0.4))
          .rotateX(-Math.PI / 2)
          .rotateY(rng() * Math.PI)
          .translate(room.minX + 3 + rng() * (room.maxX - room.minX - 6), 0.015 + i * 0.0005, room.minZ + 3 + rng() * (room.maxZ - room.minZ - 6)),
      );
    }
    this.group.add(new THREE.Mesh(mergeGeometries(scorch)!, glowMaterial(0x0a0604, 0.55, false)));

    // Glowing lava cracks: random walks starting in the outer ring of the arena.
    const cores: THREE.BufferGeometry[] = [];
    const halos: THREE.BufferGeometry[] = [];
    for (let c = 0; c < 10; c++) {
      const ang = rng() * Math.PI * 2;
      const rad = 9 + rng() * 11;
      let x = cx + Math.sin(ang) * rad;
      let z = cz + Math.cos(ang) * rad;
      let heading = rng() * Math.PI * 2;
      const segs = 4 + Math.floor(rng() * 4);
      for (let i = 0; i < segs; i++) {
        const len = 1 + rng() * 1.3;
        heading += (rng() - 0.5) * 1.2;
        const nx = x + Math.sin(heading) * len;
        const nz = z + Math.cos(heading) * len;
        if (nx < room.minX + 1 || nx > room.maxX - 1 || nz < room.minZ + 1 || nz > room.maxZ - 1) break;
        const mx = (x + nx) / 2;
        const mz = (z + nz) / 2;
        const w = 0.16 * (1 - i / segs) + 0.05;
        cores.push(new THREE.BoxGeometry(w, 0.04, len + w).rotateY(heading).translate(mx, 0.02, mz));
        halos.push(new THREE.PlaneGeometry(1.5, len + 1.4).rotateX(-Math.PI / 2).rotateY(heading).translate(mx, 0.03, mz));
        x = nx;
        z = nz;
      }
    }
    const haloMat = glowMaterial(0xff4a10, 0.5);
    const lavaHalo = new THREE.Mesh(mergeGeometries(halos)!, haloMat);
    lavaHalo.renderOrder = 1;
    this.group.add(new THREE.Mesh(mergeGeometries(cores)!, new THREE.MeshBasicMaterial({ color: 0xffa040 })), lavaHalo);

    // Lava vents near the walls, each lighting its part of the arena.
    const vents: { light: THREE.PointLight; phase: number }[] = [];
    const ventMat = new THREE.MeshBasicMaterial({ color: 0xff7020 });
    const crustMat = new THREE.MeshStandardMaterial({ color: 0x241c16, roughness: 1, flatShading: true });
    for (let i = 0; i < 3; i++) {
      for (let a = 0; a < 30; a++) {
        const ang = Math.PI * 0.25 + i * ((Math.PI * 2) / 3) + (rng() - 0.5) * 0.6;
        const x = cx + Math.sin(ang) * (room.maxX - cx - 4);
        const z = cz + Math.cos(ang) * (room.maxZ - cz - 4);
        if (!clear(x, z, 1.4)) continue;
        const g = new THREE.Group();
        g.position.set(x, 0, z);
        const pool = new THREE.Mesh(new THREE.CircleGeometry(0.95, 14).rotateX(-Math.PI / 2), ventMat);
        pool.position.y = 0.05;
        const crust = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.35, 5, 12).rotateX(Math.PI / 2), crustMat);
        crust.scale.y = 0.6;
        crust.receiveShadow = true;
        const halo = new THREE.Mesh(new THREE.PlaneGeometry(6, 6).rotateX(-Math.PI / 2), haloMat);
        halo.position.y = 0.04;
        halo.renderOrder = 1;
        const light = new THREE.PointLight(0xff6a20, 40, 16, 2);
        light.position.y = 1.2;
        g.add(pool, crust, halo, light);
        this.group.add(g);
        block(x, z, 1.3);
        vents.push({ light, phase: rng() * 10 });
        break;
      }
    }
    this.solidClutter = solids;
    flush();

    // Embers drifting up through the arena.
    const count = 220;
    const top = 12;
    const pos = new Float32Array(count * 3);
    const speed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = room.minX + rng() * (room.maxX - room.minX);
      pos[i * 3 + 1] = rng() * top;
      pos[i * 3 + 2] = room.minZ + rng() * (room.maxZ - room.minZ);
      speed[i] = 0.5 + rng() * 1.1;
    }
    const emberGeo = new THREE.BufferGeometry();
    emberGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const embers = new THREE.Points(
      emberGeo,
      new THREE.PointsMaterial({ map: glowTexture(), color: 0xff8a3a, size: 0.22, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    embers.frustumCulled = false;
    this.group.add(embers);

    this.animators.push((dt, t) => {
      haloMat.opacity = 0.42 + 0.12 * Math.sin(t * 1.7) + 0.05 * Math.sin(t * 5.3);
      for (const v of vents) v.light.intensity = 34 + 8 * Math.sin(t * 3.1 + v.phase) + 4 * Math.sin(t * 7.7 + v.phase * 2);
      for (let i = 0; i < count; i++) {
        let y = pos[i * 3 + 1] + speed[i] * dt;
        if (y > top) y -= top;
        pos[i * 3 + 1] = y;
        pos[i * 3] += Math.sin(t * 0.8 + i) * 0.3 * dt;
      }
      emberGeo.attributes.position.needsUpdate = true;
    });
  }

  /**
   * Cave dressing (both floors). Rock spires crown the walls and close the cave
   * in, stalagmites hug the room edges (solid), and the middle of each room stays
   * open for fights and hazards. Volcanic floors get glowing lava cracks and
   * embers; the flooded marsh gets mushrooms, glowing crystals and drifting spores.
   */
  private buildCaveScenery(volcanic: boolean): void {
    const rng = mulberry32(hashString(`${this.def.id}:cave`));
    const t = this.def.theme;
    // Bioluminescent look: rock repainted in the palette, glowing crystals, mushrooms and moss everywhere.
    const bio = t.accent !== undefined;
    const palette = bio ? [t.accent!, t.accent2 ?? t.accent!, t.accent3 ?? t.accent!] : [];
    const rockTint = bio ? new THREE.Color(t.wall).lerp(new THREE.Color(t.accent2 ?? t.accent!), 0.12).multiplyScalar(1.7) : undefined;
    const { put, flush } = this.propBatcher(rng, rockTint);
    const crag: PropKind = volcanic ? 'crag' : 'mosscrag';
    const solids: { x: number; z: number; r: number }[] = [];
    const bigCrystals: [number, number, number, number][] = [];
    const block = (x: number, z: number, r: number) => {
      solids.push({ x, z, r });
      this.trees.push({ x, z, r });
    };
    const gateCenters = this.gates.map((g) => [((g.tiles[0][0] + g.tiles[1][0]) / 2 + 0.5) * TILE, ((g.tiles[0][1] + g.tiles[1][1]) / 2 + 0.5) * TILE]);
    const clear = (x: number, z: number, r: number) =>
      !solids.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + r + 0.5) &&
      !this.features.some((f) => Math.hypot(f.x - x, f.z - z) < 2.8 + r) &&
      !this.boxSpots.some((b) => Math.hypot(b.x - x, b.z - z) < 1.2 + r) &&
      !this.hazardSpots.some((h) => Math.hypot(h.x - x, h.z - z) < h.r + r + 0.4) &&
      !gateCenters.some(([gx, gz]) => Math.hypot(gx - x, gz - z) < r + 4.5);

    for (let tz = 0; tz < this.height; tz++)
      for (let tx = 0; tx < this.width; tx++) {
        if (this.isFloor(tx, tz)) continue;
        const d = this.floorDistance(tx, tz);
        const x = (tx + 0.5) * TILE;
        const z = (tz + 0.5) * TILE;
        const n = this.floorNeighbour(tx, tz);
        if (d === 1) {
          const h = this.wallH[tz * this.width + tx];
          if (rng() < 0.55) {
            const bx = n ? -n[0] * 0.5 : 0;
            const bz = n ? -n[1] * 0.5 : 0;
            put(crag, x + bx + (rng() - 0.5) * 0.5, h - 1.2, z + bz + (rng() - 0.5) * 0.5, 0.4 + rng() * 0.35);
          }
          // Big crystals crowning the cliff tops, glowing against the sky.
          if (bio && rng() < 0.1) bigCrystals.push([x + (rng() - 0.5), h - 0.3, z + (rng() - 0.5), 1.6 + rng() * 1.6]);
          if (n && rng() < 0.14) {
            const s = 0.7 + rng() * 0.5;
            const fx = x + n[0] * TILE * 0.5;
            const fz = z + n[1] * TILE * 0.5;
            if (clear(fx, fz, s)) {
              put(rng() < 0.5 ? 'boulder' : 'stalag', fx, 0, fz, s);
              block(fx + n[0] * 0.3, fz + n[1] * 0.3, 0.7 * s);
            }
          }
        } else if (d === 2 && rng() < 0.6) {
          put(crag, x + (rng() - 0.5), 0, z + (rng() - 0.5), 1.0 + rng() * 0.7);
        } else if (d === 3 && rng() < 0.45) {
          put(crag, x + (rng() - 0.5), 0, z + (rng() - 0.5), 1.4 + rng() * 0.8);
        }
      }

    // Stalagmites (solid) and soft decor along each room's edges.
    const crystals: THREE.Matrix4[] = [];
    const crystalColors: number[] = [];
    const crystalGlow: THREE.BufferGeometry[] = [];
    const shrooms: { m: THREE.Matrix4; c: number }[] = [];
    const moss: THREE.BufferGeometry[] = [];
    const edgeSpot = (q: Rect, inset0: number, inset1: number): [number, number] => {
      const w = q.maxX - q.minX;
      const h = q.maxZ - q.minZ;
      const side = Math.floor(rng() * 4);
      const inset = inset0 + rng() * (inset1 - inset0);
      if (side < 2) {
        const x = q.minX + 1.5 + rng() * (w - 3);
        return [x, side === 0 ? q.minZ + inset : q.maxZ - inset];
      }
      const z = q.minZ + 1.5 + rng() * (h - 3);
      return [side === 2 ? q.minX + inset : q.maxX - inset, z];
    };
    for (const room of this.rooms) {
      const q = room.rect;
      const area = ((q.maxX - q.minX) * (q.maxZ - q.minZ)) / 4;
      for (let i = 0; i < Math.round(area / 45); i++) {
        for (let a = 0; a < 20; a++) {
          const [x, z] = edgeSpot(q, 1.2, 2.6);
          const s = 0.65 + rng() * 0.5;
          if (!clear(x, z, s)) continue;
          put('stalag', x, 0, z, s);
          block(x, z, 0.62 * s);
          break;
        }
      }
      if (!volcanic || bio) {
        for (let i = 0; i < Math.round(area / (bio ? 16 : 22)); i++) {
          const [x, z] = edgeSpot(q, 0.6, 2.2);
          if (!clear(x, z, 0.3)) continue;
          const s = 0.7 + rng() * 0.6;
          if (bio) {
            const c = palette[Math.floor(rng() * palette.length)];
            shrooms.push({ m: new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * 6.3), new THREE.Vector3(s, s, s)), c });
            crystalGlow.push(tinted(new THREE.PlaneGeometry(2.6 * s, 2.6 * s).rotateX(-Math.PI / 2).translate(x, 0.025, z), c));
          } else {
            put('mushroom', x, 0, z, s);
          }
        }
        for (let i = 0; i < Math.round(area / (bio ? 20 : 40)); i++) {
          const [x, z] = edgeSpot(q, 0.5, 1.4);
          if (!clear(x, z, 0.3)) continue;
          const s = 0.8 + rng() * (bio ? 1.4 : 0.9);
          crystals.push(
            new THREE.Matrix4().compose(
              new THREE.Vector3(x, 0, z),
              new THREE.Quaternion().setFromEuler(new THREE.Euler((rng() - 0.5) * 0.4, rng() * Math.PI, (rng() - 0.5) * 0.4)),
              new THREE.Vector3(s, s, s),
            ),
          );
          const c = bio ? palette[Math.floor(rng() * palette.length)] : 0x40d8ff;
          crystalColors.push(c);
          crystalGlow.push(tinted(new THREE.PlaneGeometry(3.2 * s, 3.2 * s).rotateX(-Math.PI / 2).translate(x, 0.025, z), c));
        }
      }
      // Glowing moss: soft patches on the floor near the walls.
      if (bio) {
        for (let i = 0; i < Math.round(area / 12); i++) {
          const [x, z] = edgeSpot(q, 0.8, 3.5);
          if (this.hazardSpots.some((h) => Math.hypot(h.x - x, h.z - z) < h.r)) continue;
          const s = 1.5 + rng() * 2.5;
          const c = rng() < 0.6 ? palette[0] : palette[1 + Math.floor(rng() * 2)];
          moss.push(tinted(new THREE.PlaneGeometry(s, s * (0.6 + rng() * 0.5)).rotateX(-Math.PI / 2).rotateY(rng() * 3).translate(x, 0.02 + i * 0.0002, z), c));
        }
      }
    }
    for (const [x, y, z, s] of bigCrystals) {
      crystals.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler((rng() - 0.5) * 0.5, rng() * Math.PI, (rng() - 0.5) * 0.5)), new THREE.Vector3(s, s, s)));
      crystalColors.push(palette[Math.floor(rng() * palette.length)]);
    }
    this.solidClutter = solids;
    flush();

    if (crystals.length) {
      const geo = bio ? propGeometry('glowcrystal') : propGeometry('crystal');
      const mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true }), crystals.length);
      const col = new THREE.Color();
      crystals.forEach((m, i) => {
        mesh.setMatrixAt(i, m);
        // A little under full brightness, so crystals glow without blowing out under bloom.
        if (bio) mesh.setColorAt(i, col.setHex(crystalColors[i]).multiplyScalar(0.75));
      });
      this.group.add(mesh);
    }
    if (shrooms.length) {
      const mesh = new THREE.InstancedMesh(propGeometry('glowshroom'), new THREE.MeshBasicMaterial({ vertexColors: true }), shrooms.length);
      const col = new THREE.Color();
      shrooms.forEach((s, i) => {
        mesh.setMatrixAt(i, s.m);
        mesh.setColorAt(i, col.setHex(s.c).multiplyScalar(0.65));
      });
      this.group.add(mesh);
    }
    if (crystalGlow.length) {
      const glowMat = glowVertexMaterial(0.4);
      const glow = new THREE.Mesh(mergeGeometries(crystalGlow)!, glowMat);
      glow.renderOrder = 1;
      this.group.add(glow);
      this.animators.push((_dt, t) => (glowMat.opacity = 0.34 + 0.08 * Math.sin(t * 1.3)));
    }
    if (moss.length) {
      const mossMat = glowVertexMaterial(0.32);
      const mesh = new THREE.Mesh(mergeGeometries(moss)!, mossMat);
      mesh.renderOrder = 1;
      this.group.add(mesh);
      this.animators.push((_dt, t) => (mossMat.opacity = 0.28 + 0.06 * Math.sin(t * 0.9 + 1)));
    }

    // Floating motes: embers rising in the volcanic cave, green spores drifting in the marsh.
    const rects = this.rooms.map((r) => r.rect);
    const count = Math.min(600, Math.round(rects.reduce((n, q) => n + (q.maxX - q.minX) * (q.maxZ - q.minZ), 0) / 18));
    const top = 9;
    const pos = new Float32Array(count * 3);
    const speed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const q = rects[Math.floor(rng() * rects.length)];
      pos[i * 3] = q.minX + rng() * (q.maxX - q.minX);
      pos[i * 3 + 1] = rng() * top;
      pos[i * 3 + 2] = q.minZ + rng() * (q.maxZ - q.minZ);
      speed[i] = volcanic ? 0.5 + rng() * 1.1 : 0.12 + rng() * 0.25;
    }
    const moteGeo = new THREE.BufferGeometry();
    moteGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const motes = new THREE.Points(
      moteGeo,
      new THREE.PointsMaterial({
        map: glowTexture(), color: t.motes ?? (volcanic ? 0xff8a3a : 0x9cff70), size: volcanic ? 0.2 : bio ? 0.2 : 0.16,
        transparent: true, opacity: volcanic || bio ? 1 : 0.7, depthWrite: false, blending: THREE.AdditiveBlending,
      }),
    );
    motes.frustumCulled = false;
    this.group.add(motes);
    this.animators.push((dt, t) => {
      for (let i = 0; i < count; i++) {
        let y = pos[i * 3 + 1] + speed[i] * dt;
        if (y > top) y -= top;
        pos[i * 3 + 1] = y;
        pos[i * 3] += Math.sin(t * 0.8 + i) * (volcanic ? 0.3 : 0.2) * dt;
        if (!volcanic) pos[i * 3 + 2] += Math.cos(t * 0.6 + i * 1.7) * 0.2 * dt;
      }
      moteGeo.attributes.position.needsUpdate = true;
    });

    if (!volcanic) return;

    // Glowing lava cracks wandering across the floors.
    const cores: THREE.BufferGeometry[] = [];
    const halos: THREE.BufferGeometry[] = [];
    for (const q of rects) {
      const area = ((q.maxX - q.minX) * (q.maxZ - q.minZ)) / 4;
      for (let c = 0; c < Math.round(area / 30); c++) {
        let x = q.minX + 2 + rng() * (q.maxX - q.minX - 4);
        let z = q.minZ + 2 + rng() * (q.maxZ - q.minZ - 4);
        let heading = rng() * Math.PI * 2;
        const segs = 3 + Math.floor(rng() * 4);
        for (let i = 0; i < segs; i++) {
          const len = 0.9 + rng() * 1.2;
          heading += (rng() - 0.5) * 1.2;
          const nx = x + Math.sin(heading) * len;
          const nz = z + Math.cos(heading) * len;
          if (nx < q.minX + 1 || nx > q.maxX - 1 || nz < q.minZ + 1 || nz > q.maxZ - 1) break;
          const w = 0.14 * (1 - i / segs) + 0.05;
          cores.push(new THREE.BoxGeometry(w, 0.04, len + w).rotateY(heading).translate((x + nx) / 2, 0.02, (z + nz) / 2));
          halos.push(new THREE.PlaneGeometry(1.3, len + 1.2).rotateX(-Math.PI / 2).rotateY(heading).translate((x + nx) / 2, 0.03, (z + nz) / 2));
          x = nx;
          z = nz;
        }
      }
    }
    if (cores.length) {
      const lava = new THREE.Color(t.lava ?? 0xff4a10);
      const haloMat = glowMaterial(lava.getHex(), 0.45);
      const halo = new THREE.Mesh(mergeGeometries(halos)!, haloMat);
      halo.renderOrder = 1;
      const core = t.lava !== undefined ? lava.clone().lerp(new THREE.Color(0xffffff), 0.35).getHex() : 0xffa040;
      this.group.add(new THREE.Mesh(mergeGeometries(cores)!, new THREE.MeshBasicMaterial({ color: core })), halo);
      this.animators.push((_dt, t) => (haloMat.opacity = 0.38 + 0.1 * Math.sin(t * 1.7) + 0.05 * Math.sin(t * 5.3)));
    }
  }

  /**
   * Mines dressing. Pipes run along the wall tops, girders, tanks and chimney
   * stacks make the skyline, crates / drums / consoles hug the room edges
   * (solid), and glow strips trace each room's floor. The foundry adds molten
   * channels and rising sparks; the control sector a light grid; the Warden's
   * hall the cell grid its floor patterns use.
   */
  private buildMineScenery(kind: 'foundry' | 'control' | 'warden'): void {
    const rng = mulberry32(hashString(`${this.def.id}:mine`));
    const t = this.def.theme;
    // Neon look: props repainted toward the wall colour, light strips and holo signs on the walls.
    const neon = t.accent !== undefined;
    const propTint = neon ? new THREE.Color(t.wall).lerp(new THREE.Color(t.accent2 ?? t.accent!), 0.1).multiplyScalar(2.4) : undefined;
    const { put, flush } = this.propBatcher(rng, propTint);
    const foundry = kind === 'foundry';
    const arena = kind === 'warden';
    const accent = t.accent ?? (foundry ? 0xff7a30 : arena ? 0xff4a3a : 0x40c8ff);
    const accent2 = t.accent2 ?? accent;
    const solids: { x: number; z: number; r: number }[] = [];
    const block = (x: number, z: number, r: number) => {
      solids.push({ x, z, r });
      this.trees.push({ x, z, r });
    };
    const gateCenters = this.gates.map((g) => [((g.tiles[0][0] + g.tiles[1][0]) / 2 + 0.5) * TILE, ((g.tiles[0][1] + g.tiles[1][1]) / 2 + 0.5) * TILE]);
    const clear = (x: number, z: number, r: number) =>
      !solids.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + r + 0.5) &&
      !this.features.some((f) => Math.hypot(f.x - x, f.z - z) < 2.8 + r) &&
      !this.boxSpots.some((b) => Math.hypot(b.x - x, b.z - z) < 1.2 + r) &&
      !this.hazardSpots.some((h) => Math.hypot(h.x - x, h.z - z) < h.r + r + 0.4) &&
      !gateCenters.some(([gx, gz]) => Math.hypot(gx - x, gz - z) < r + 4.5);

    // Wall tops and the skyline behind them.
    for (let tz = 0; tz < this.height; tz++)
      for (let tx = 0; tx < this.width; tx++) {
        if (this.isFloor(tx, tz)) continue;
        const d = this.floorDistance(tx, tz);
        const x = (tx + 0.5) * TILE;
        const z = (tz + 0.5) * TILE;
        const n = this.floorNeighbour(tx, tz);
        if (d === 1) {
          const h = this.wallH[tz * this.width + tx];
          if (n && rng() < 0.4) put('pipes', x, h, z, 1, n[0] !== 0 ? Math.PI / 2 : 0);
          if (n && !arena && rng() < 0.12) {
            const fx = x + n[0] * TILE * 0.6;
            const fz = z + n[1] * TILE * 0.6;
            if (clear(fx, fz, 0.7)) {
              const k = foundry ? (rng() < 0.6 ? 'drum' : 'crate') : rng() < 0.5 ? 'console' : 'crate';
              put(k, fx, 0, fz, 0.9 + rng() * 0.2, k === 'console' ? Math.atan2(n[0], n[1]) : rng() * Math.PI * 2);
              block(fx, fz, 0.7);
            }
          }
        } else if (d === 2) {
          const r = rng();
          if (r < 0.14) put(foundry ? 'stack' : 'girder', x, 0, z, 1 + rng() * 0.2);
          else if (r < 0.3) put('tank', x + (rng() - 0.5), 0, z + (rng() - 0.5), 1 + rng() * 0.4);
        } else if (d === 3 && rng() < 0.35) {
          put(rng() < 0.5 ? 'girder' : foundry ? 'stack' : 'tank', x, 0, z, 1.1 + rng() * 0.3);
        }
      }

    // A few stacks of crates and drums inside each room, against the walls.
    if (!arena) {
      for (const room of this.rooms) {
        const q = room.rect;
        const area = ((q.maxX - q.minX) * (q.maxZ - q.minZ)) / 4;
        for (let i = 0; i < Math.round(area / 60); i++) {
          for (let a = 0; a < 20; a++) {
            const side = Math.floor(rng() * 4);
            const inset = 1.0 + rng() * 0.6;
            const x = side < 2 ? q.minX + 1.5 + rng() * (q.maxX - q.minX - 3) : side === 2 ? q.minX + inset : q.maxX - inset;
            const z = side >= 2 ? q.minZ + 1.5 + rng() * (q.maxZ - q.minZ - 3) : side === 0 ? q.minZ + inset : q.maxZ - inset;
            if (!clear(x, z, 0.8)) continue;
            const k = foundry ? (rng() < 0.5 ? 'drum' : 'crate') : 'crate';
            put(k, x, 0, z, 0.9 + rng() * 0.25);
            block(x, z, 0.75);
            break;
          }
        }
      }
    }
    this.solidClutter = solids;
    flush();

    // Glow strips tracing each room's floor edge.
    const strips: THREE.BufferGeometry[] = [];
    if (!arena) {
      for (const room of this.rooms) {
        const q = room.rect;
        const w = q.maxX - q.minX - 0.8;
        const h = q.maxZ - q.minZ - 0.8;
        const cx = (q.minX + q.maxX) / 2;
        const cz = (q.minZ + q.maxZ) / 2;
        strips.push(new THREE.PlaneGeometry(w, 0.12).rotateX(-Math.PI / 2).translate(cx, 0.02, q.minZ + 0.4));
        strips.push(new THREE.PlaneGeometry(w, 0.12).rotateX(-Math.PI / 2).translate(cx, 0.02, q.maxZ - 0.4));
        strips.push(new THREE.PlaneGeometry(0.12, h).rotateX(-Math.PI / 2).translate(q.minX + 0.4, 0.02, cz));
        strips.push(new THREE.PlaneGeometry(0.12, h).rotateX(-Math.PI / 2).translate(q.maxX - 0.4, 0.02, cz));
        if (!foundry || neon) {
          // A faint light grid across the deck.
          for (let x = q.minX + 4; x < q.maxX - 2; x += 8) strips.push(new THREE.PlaneGeometry(0.05, h).rotateX(-Math.PI / 2).translate(x, 0.018, cz));
          for (let z = q.minZ + 4; z < q.maxZ - 2; z += 8) strips.push(new THREE.PlaneGeometry(w, 0.05).rotateX(-Math.PI / 2).translate(cx, 0.018, z));
        }
      }
    }
    // Foundry: straight molten channels with a hot halo.
    const halos: THREE.BufferGeometry[] = [];
    const molten: THREE.BufferGeometry[] = [];
    if (foundry) {
      for (const room of this.rooms) {
        const q = room.rect;
        for (let c = 0; c < 2; c++) {
          const alongX = rng() < 0.5;
          const len = (alongX ? q.maxX - q.minX : q.maxZ - q.minZ) * (0.3 + rng() * 0.3);
          for (let a = 0; a < 10; a++) {
            const x = q.minX + 2 + rng() * (q.maxX - q.minX - 4);
            const z = q.minZ + 2 + rng() * (q.maxZ - q.minZ - 4);
            const ex = alongX ? x + len : x;
            const ez = alongX ? z : z + len;
            if (ex > q.maxX - 1 || ez > q.maxZ - 1) continue;
            const mx = (x + ex) / 2;
            const mz = (z + ez) / 2;
            if (this.hazardSpots.some((h) => Math.hypot(h.x - mx, h.z - mz) < h.r)) continue;
            (neon ? molten : strips).push(new THREE.PlaneGeometry(alongX ? len : 0.22, alongX ? 0.22 : len).rotateX(-Math.PI / 2).translate(mx, 0.021, mz));
            halos.push(new THREE.PlaneGeometry(alongX ? len + 1 : 1.4, alongX ? 1.4 : len + 1).rotateX(-Math.PI / 2).translate(mx, 0.022, mz));
            break;
          }
        }
      }
    }
    if (strips.length) {
      const stripMat = glowMaterial(accent, foundry ? 0.85 : 0.55);
      const mesh = new THREE.Mesh(mergeGeometries(strips)!, stripMat);
      mesh.renderOrder = 1;
      this.group.add(mesh);
      this.animators.push((_dt, t) => (stripMat.opacity = (foundry ? 0.75 : 0.45) + Math.sin(t * 1.4) * 0.08));
    }
    if (molten.length) {
      const core = new THREE.Color(t.lava ?? 0xff5a18).lerp(new THREE.Color(0xffffff), 0.3).getHex();
      this.group.add(new THREE.Mesh(mergeGeometries(molten)!, new THREE.MeshBasicMaterial({ color: core })));
    }
    if (neon) this.buildNeonWalls(rng, accent, accent2, t.accent3 ?? accent);
    if (halos.length) {
      const haloMat = glowMaterial(t.lava ?? 0xff5a18, 0.35);
      const mesh = new THREE.Mesh(mergeGeometries(halos)!, haloMat);
      mesh.renderOrder = 1;
      this.group.add(mesh);
      this.animators.push((_dt, t) => (haloMat.opacity = 0.3 + 0.08 * Math.sin(t * 1.7) + 0.04 * Math.sin(t * 5.3)));
    }

    if (arena) this.buildCoreDeck(accent);

    // Floating motes: sparks rising off the foundry floor, slow dust elsewhere.
    const rects = this.rooms.map((r) => r.rect);
    const count = Math.min(500, Math.round(rects.reduce((n, q) => n + (q.maxX - q.minX) * (q.maxZ - q.minZ), 0) / (foundry ? 20 : 40)));
    const top = 8;
    const pos = new Float32Array(count * 3);
    const speed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const q = rects[Math.floor(rng() * rects.length)];
      pos[i * 3] = q.minX + rng() * (q.maxX - q.minX);
      pos[i * 3 + 1] = rng() * top;
      pos[i * 3 + 2] = q.minZ + rng() * (q.maxZ - q.minZ);
      speed[i] = foundry ? 0.8 + rng() * 1.4 : 0.1 + rng() * 0.2;
    }
    const moteGeo = new THREE.BufferGeometry();
    moteGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const motes = new THREE.Points(
      moteGeo,
      new THREE.PointsMaterial({
        map: glowTexture(), color: t.motes ?? (foundry ? 0xffa040 : 0x9ad8ff), size: foundry ? 0.14 : 0.12,
        transparent: true, opacity: foundry ? 1 : 0.5, depthWrite: false, blending: THREE.AdditiveBlending,
      }),
    );
    motes.frustumCulled = false;
    this.group.add(motes);
    this.animators.push((dt, t) => {
      for (let i = 0; i < count; i++) {
        let y = pos[i * 3 + 1] + speed[i] * dt;
        if (y > top) y -= top;
        pos[i * 3 + 1] = y;
        pos[i * 3] += Math.sin(t * 0.9 + i) * 0.25 * dt;
      }
      moteGeo.attributes.position.needsUpdate = true;
    });
  }

  /**
   * Neon walls: two light strips running along every wall face (bright at the
   * base, softer up high) and a few holographic signs.
   */
  private buildNeonWalls(rng: () => number, accent: number, accent2: number, accent3: number): void {
    const low: THREE.BufferGeometry[] = [];
    const high: THREE.BufferGeometry[] = [];
    const faces: { x: number; z: number; yaw: number }[] = [];
    for (let tz = 0; tz < this.height; tz++)
      for (let tx = 0; tx < this.width; tx++) {
        if (!this.isFloor(tx, tz)) continue;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          if (this.isFloor(tx + dx, tz + dz)) continue;
          // Wall face on this side of a floor tile, facing back into the room.
          const fx = (tx + 0.5 + dx * 0.5) * TILE - dx * 0.03;
          const fz = (tz + 0.5 + dz * 0.5) * TILE - dz * 0.03;
          const yaw = Math.atan2(-dx, -dz);
          const along = dx !== 0;
          low.push(new THREE.BoxGeometry(along ? 0.05 : TILE, 0.09, along ? TILE : 0.05).translate(fx, 0.55, fz));
          high.push(new THREE.BoxGeometry(along ? 0.05 : TILE, 0.05, along ? TILE : 0.05).translate(fx, 3.4, fz));
          faces.push({ x: fx, z: fz, yaw });
        }
      }
    if (low.length) {
      const lowMat = new THREE.MeshBasicMaterial({ color: accent });
      const highMat = new THREE.MeshBasicMaterial({ color: accent2 });
      this.group.add(new THREE.Mesh(mergeGeometries(low)!, lowMat), new THREE.Mesh(mergeGeometries(high)!, highMat));
    }
    // Holographic signs: a few per room, flickering.
    const signs: { mat: THREE.MeshBasicMaterial; phase: number }[] = [];
    for (const room of this.rooms) {
      const own = faces.filter((f) => f.x >= room.rect.minX - 0.1 && f.x <= room.rect.maxX + 0.1 && f.z >= room.rect.minZ - 0.1 && f.z <= room.rect.maxZ + 0.1);
      for (let i = 0; i < 2 && own.length; i++) {
        const f = own[Math.floor(rng() * own.length)];
        const c = [accent, accent2, accent3][Math.floor(rng() * 3)];
        const mat = new THREE.MeshBasicMaterial({ map: signTexture(), color: c, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.3), mat);
        sign.position.set(f.x - Math.sin(f.yaw) * 0.08, 2.3, f.z - Math.cos(f.yaw) * 0.08);
        sign.rotation.y = f.yaw;
        this.group.add(sign);
        signs.push({ mat, phase: rng() * 10 });
      }
    }
    if (signs.length) {
      this.animators.push((_dt, t) => {
        for (const s of signs) s.mat.opacity = Math.sin(t * 23 + s.phase) > 0.97 ? 0.25 : 0.75 + Math.sin(t * 2 + s.phase) * 0.1;
      });
    }
  }

  /**
   * The Warden's hall: the deck in front of it is ruled into the cells its floor
   * patterns light up, with a hazard line where its alcove begins.
   */
  private buildCoreDeck(accent: number): void {
    const q = this.rooms[0].rect;
    const front = q.minZ + wardenCfg.alcove;
    const w = q.maxX - q.minX;
    const h = q.maxZ - front;
    const cols = Math.max(1, Math.round(w / wardenCfg.cell));
    const rows = Math.max(1, Math.round(h / wardenCfg.cell));
    const cx = (q.minX + q.maxX) / 2;
    const lines: THREE.BufferGeometry[] = [];
    for (let c = 1; c < cols; c++) lines.push(new THREE.PlaneGeometry(0.07, h).rotateX(-Math.PI / 2).translate(q.minX + (c * w) / cols, 0.02, front + h / 2));
    for (let r = 1; r < rows; r++) lines.push(new THREE.PlaneGeometry(w, 0.07).rotateX(-Math.PI / 2).translate(cx, 0.02, front + (r * h) / rows));
    const lineMat = glowMaterial(accent, 0.3);
    const grid = new THREE.Mesh(mergeGeometries(lines)!, lineMat);
    grid.renderOrder = 1;
    this.group.add(grid);
    this.animators.push((_dt, t) => (lineMat.opacity = 0.24 + Math.sin(t * 1.1) * 0.06));
    // The alcove floor is dark machinery; a yellow line marks where the deck ends.
    const alcove = new THREE.Mesh(new THREE.PlaneGeometry(w, wardenCfg.alcove).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.8 }));
    alcove.position.set(cx, 0.015, q.minZ + wardenCfg.alcove / 2);
    alcove.receiveShadow = true;
    const edge = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.35).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xe0b020 }));
    edge.position.set(cx, 0.025, front + 0.2);
    this.group.add(alcove, edge);
  }

  /**
   * The De Rol Le arena: a metal raft (the floor tiles) on an underground river.
   * The raft stays put in world space; the water, foam and canyon walls scroll
   * past so it reads as drifting downstream (toward -Z, the raft's prow).
   */
  private buildRiverScenery(): void {
    const rng = mulberry32(hashString(`${this.def.id}:river`));
    const raft = this.rooms[0].rect;
    const cx = (raft.minX + raft.maxX) / 2;
    const cz = (raft.minZ + raft.maxZ) / 2;
    const hw = (raft.maxX - raft.minX) / 2;
    const hl = (raft.maxZ - raft.minZ) / 2;
    const SPEED = 6;
    const L = 96;

    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(500, 500).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x0b3a44, roughness: 0.25, metalness: 0.25 }),
    );
    water.position.set(cx, WATER_Y, cz);
    water.receiveShadow = true;
    this.group.add(water);

    // Foam streaks riding the current.
    const streaks: THREE.Mesh[] = [];
    const foamMat = glowMaterial(0x9ae8ff, 0.16);
    for (let i = 0; i < 70; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.25 + rng() * 0.4, 3 + rng() * 6).rotateX(-Math.PI / 2), foamMat);
      const side = rng() < 0.5 ? -1 : 1;
      m.position.set(cx + side * (hw + 0.5 + rng() * 26), WATER_Y + 0.02, cz - L / 2 + rng() * L);
      m.renderOrder = 1;
      streaks.push(m);
      this.group.add(m);
    }
    // Churned wake off the stern and spray at the prow.
    const wakeMat = glowMaterial(0xc8f4ff, 0.22);
    const wake = new THREE.Mesh(new THREE.PlaneGeometry(hw * 2.6, 14).rotateX(-Math.PI / 2), wakeMat);
    wake.position.set(cx, WATER_Y + 0.03, raft.maxZ + 6);
    wake.renderOrder = 1;
    const bow = new THREE.Mesh(new THREE.PlaneGeometry(hw * 2.8, 4).rotateX(-Math.PI / 2), glowMaterial(0xc8f4ff, 0.3));
    bow.position.set(cx, WATER_Y + 0.03, raft.minZ - 1);
    bow.renderOrder = 1;
    this.group.add(wake, bow);

    // Canyon walls on both banks: one chunk of rock, repeated three times and scrolled.
    const chunk = new THREE.Group();
    {
      const { put, flush } = this.propBatcher(rng);
      for (const side of [-1, 1]) {
        for (let i = 0; i < 26; i++) {
          const z = -L / 2 + (i + rng() * 0.8) * (L / 26);
          const x = side * (hw + 15 + rng() * 6);
          put(rng() < 0.5 ? 'crag' : 'mosscrag', x, -1, z, 1.5 + rng() * 1.1);
          if (rng() < 0.7) put(rng() < 0.5 ? 'boulder' : 'stalag', side * (hw + 10 + rng() * 4), WATER_Y - 0.2, z + rng() * 2, 1.2 + rng() * 1.2);
          if (rng() < 0.6) put('crag', side * (hw + 26 + rng() * 10), -2, z + rng() * 3, 2.2 + rng() * 1.2);
        }
      }
      const before = this.group.children.length;
      flush();
      // flush() adds the batches to this.group: move them into the chunk.
      for (const m of this.group.children.slice(before)) chunk.add(m);
    }
    const banks = new THREE.Group();
    banks.position.set(cx, 0, cz);
    for (const k of [-1, 0, 1]) {
      const c = k === 0 ? chunk : chunk.clone();
      c.position.z = k * L;
      banks.add(c);
    }
    this.group.add(banks);

    // The raft: pontoons, a low railing, lanterns at the corners, a pointed prow.
    const metal = new THREE.MeshStandardMaterial({ color: 0x4a525c, roughness: 0.6, metalness: 0.4, flatShading: true });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a3038, roughness: 0.8, metalness: 0.3, flatShading: true });
    for (const sx of [-1, 1]) {
      const pont = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, hl * 2 + 1, 10).rotateX(Math.PI / 2), dark);
      pont.position.set(cx + sx * (hw - 1), -0.55, cz);
      this.group.add(pont);
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, hl * 2), metal);
      bar.position.set(cx + sx * (hw - 0.12), 0.62, cz);
      this.group.add(bar);
    }
    const postCount = (Math.floor((hl * 2) / 2.5) + 2) * 2;
    const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.7, 0.12).translate(0, 0.35, 0), metal, postCount);
    let pi = 0;
    for (let z = raft.minZ + 0.2; z <= raft.maxZ - 0.1 && pi < postCount; z += 2.5)
      for (const sx of [-1, 1]) posts.setMatrixAt(pi++, new THREE.Matrix4().makeTranslation(cx + sx * (hw - 0.12), 0, z));
    posts.count = pi;
    posts.castShadow = true;
    this.group.add(posts);
    const prowShape = new THREE.Shape([new THREE.Vector2(-hw, 0), new THREE.Vector2(hw, 0), new THREE.Vector2(0, 3.2)]);
    const prow = new THREE.Mesh(new THREE.ExtrudeGeometry(prowShape, { depth: 0.5, bevelEnabled: false }).rotateX(Math.PI / 2), dark);
    prow.position.set(cx, 0, raft.minZ);
    prow.rotation.y = Math.PI;
    this.group.add(prow);
    const lights: THREE.PointLight[] = [];
    for (const [x, z] of [[raft.minX + 0.3, raft.minZ + 0.3], [raft.maxX - 0.3, raft.minZ + 0.3], [raft.minX + 0.3, raft.maxZ - 0.3], [raft.maxX - 0.3, raft.maxZ - 0.3]]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 2, 6).translate(0, 1, 0), metal);
      post.position.set(x, 0, z);
      const lamp = glowSprite(0xffc070, 1.6, 0.9);
      lamp.position.set(x, 2.1, z);
      const light = new THREE.PointLight(0xffc070, 14, 16, 2);
      light.position.set(x, 2.1, z);
      lights.push(light);
      this.group.add(post, lamp, light);
    }

    // Mist hanging over the water.
    const count = 260;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = cx + (rng() - 0.5) * 70;
      pos[i * 3 + 1] = WATER_Y + 0.3 + rng() * 3;
      pos[i * 3 + 2] = cz - L / 2 + rng() * L;
    }
    const mistGeo = new THREE.BufferGeometry();
    mistGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mist = new THREE.Points(
      mistGeo,
      new THREE.PointsMaterial({ map: glowTexture(), color: 0x6aa8c0, size: 1.6, transparent: true, opacity: 0.18, depthWrite: false }),
    );
    mist.frustumCulled = false;
    this.group.add(mist);

    this.animators.push((dt, t) => {
      banks.position.z = cz + ((t * SPEED) % L);
      for (const m of streaks) {
        m.position.z += SPEED * dt;
        if (m.position.z > cz + L / 2) m.position.z -= L;
      }
      for (let i = 0; i < count; i++) {
        let z = pos[i * 3 + 2] + SPEED * 0.8 * dt;
        if (z > cz + L / 2) z -= L;
        pos[i * 3 + 2] = z;
      }
      mistGeo.attributes.position.needsUpdate = true;
      wakeMat.opacity = 0.2 + 0.05 * Math.sin(t * 3);
      lights.forEach((l, i) => (l.intensity = 13 + Math.sin(t * 4 + i * 2) * 1.5));
    });
  }

  // ---------------------------------------------------------- queries

  isFloor(tx: number, tz: number): boolean {
    if (tx < 0 || tz < 0 || tx >= this.width || tz >= this.height) return false;
    return this.floor[tz * this.width + tx] === 1;
  }

  private touchesFloor(tx: number, tz: number): boolean {
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (this.isFloor(tx + dx, tz + dz)) return true;
    return false;
  }

  private gateAt(tx: number, tz: number): Gate | undefined {
    return this.gates.find((g) => (g.closed || g.locked) && g.tiles.some(([x, z]) => x === tx && z === tz));
  }

  isSolidTile(tx: number, tz: number): boolean {
    return !this.isFloor(tx, tz) || this.gateAt(tx, tz) !== undefined;
  }

  isSolidAt(x: number, z: number): boolean {
    return this.isSolidTile(Math.floor(x / TILE), Math.floor(z / TILE));
  }

  /** Push a circle out of walls, closed gates and tree trunks. */
  resolveCircle(pos: THREE.Vector3, radius: number): void {
    const boxes = this.tmpBoxes;
    boxes.length = 0;
    const tx0 = Math.floor((pos.x - radius) / TILE);
    const tx1 = Math.floor((pos.x + radius) / TILE);
    const tz0 = Math.floor((pos.z - radius) / TILE);
    const tz1 = Math.floor((pos.z + radius) / TILE);
    for (let tz = tz0; tz <= tz1; tz++)
      for (let tx = tx0; tx <= tx1; tx++) {
        if (this.isSolidTile(tx, tz)) {
          boxes.push({ minX: tx * TILE, maxX: (tx + 1) * TILE, minZ: tz * TILE, maxZ: (tz + 1) * TILE });
        }
      }
    if (boxes.length) resolveCircleBoxes(pos, radius, boxes);
    for (const t of this.trees) {
      const dx = pos.x - t.x;
      const dz = pos.z - t.z;
      const min = radius + t.r;
      const d2 = dx * dx + dz * dz;
      if (d2 >= min * min || d2 < 1e-8) continue;
      const d = Math.sqrt(d2);
      pos.x = t.x + (dx / d) * min;
      pos.z = t.z + (dz / d) * min;
    }
  }

  /** Distance along a ray before hitting a wall below wall height (for the camera). */
  raycast(from: THREE.Vector3, dir: THREE.Vector3, max: number): number {
    const step = 0.2;
    for (let d = step; d <= max; d += step) {
      const x = from.x + dir.x * d;
      const y = from.y + dir.y * d;
      const z = from.z + dir.z * d;
      const tx = Math.floor(x / TILE);
      const tz = Math.floor(z / TILE);
      if (this.isFloor(tx, tz) || this.def.theme.scenery === 'river') continue;
      const inside = tx >= 0 && tz >= 0 && tx < this.width && tz < this.height;
      const h = inside ? this.wallH[tz * this.width + tx] + 0.6 : this.def.theme.wallHeight; // + leafy crest
      if (y < h) return d;
    }
    return max;
  }

  roomAt(x: number, z: number, inset = 0): RoomRuntime | null {
    for (const r of this.rooms) {
      const q = r.rect;
      if (x >= q.minX + inset && x <= q.maxX - inset && z >= q.minZ + inset && z <= q.maxZ - inset) return r;
    }
    return null;
  }

  /** Random open spot in a room, away from trees and (optionally) a point. */
  randomSpot(room: RoomRuntime, rng: () => number, avoidX: number, avoidZ: number, minDist: number): [number, number] {
    const q = room.rect;
    let best: [number, number] = [(q.minX + q.maxX) / 2, (q.minZ + q.maxZ) / 2];
    let bestD = -1;
    for (let i = 0; i < 30; i++) {
      const x = q.minX + 2 + rng() * (q.maxX - q.minX - 4);
      const z = q.minZ + 2 + rng() * (q.maxZ - q.minZ - 4);
      if (this.trees.some((t) => Math.hypot(t.x - x, t.z - z) < 2)) continue;
      const d = Math.hypot(x - avoidX, z - avoidZ);
      if (d >= minDist) return [x, z];
      if (d > bestD) {
        bestD = d;
        best = [x, z];
      }
    }
    return best;
  }

  center(): THREE.Vector3 {
    return new THREE.Vector3((this.width * TILE) / 2, 0, (this.height * TILE) / 2);
  }
}
