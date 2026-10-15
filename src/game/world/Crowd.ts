import * as THREE from 'three';
import { separateCircles } from '../collision';
import { isCounter } from '../data/areas';
import { Humanoid, humanPoses, STYLES, type HumanoidStyle } from '../models/humanoid';
import type { Pose } from '../models/Rig';
import { glowMaterial } from './glow';
import { mulberry32, type Level, type RoomRuntime } from './Level';

// Pioneer 2's ambient crowd: civilians and other hunters who stroll between
// spots, stop at the shops to browse, and stand around in pairs chatting.
// Purely decoration: they step aside for nobody but pause when the player is
// in their way, and the player can't walk through them.

const SPEED = 1.2;
const RADIUS = 0.35;
/** Walk cycle radians per metre (about 1.5 m per stride). */
const STRIDE = 4.2;

interface Walker {
  model: Humanoid;
  pos: THREE.Vector3;
  yaw: number;
  /** Waypoints still to walk; empty while standing. */
  path: THREE.Vector3[];
  /** Seconds left standing before picking a new spot. */
  wait: number;
  /** Facing while standing (a counter, a chat partner), or null to keep the last heading. */
  face: number | null;
  phase: number;
  speed: number;
  feminine: boolean;
  /** Chatting pairs never wander. */
  chat: boolean;
  gesture: number;
  stuck: number;
}

const BLOB_GEO = new THREE.PlaneGeometry(1.1, 1.1).rotateX(-Math.PI / 2);
const BLOB_MAT = glowMaterial(0x000000, 0.45, false);

const SKIN = [0xf6dccb, 0xeec09a, 0xd8a882, 0xb98060, 0x8a5a3c, 0xf2caa8];
const HAIR = [0x2a2018, 0x101010, 0x8a3a20, 0xd8b060, 0x5a3a2a, 0xc0c4cc, 0x3a5a9a, 0x9a3a5a];
const CLOTH = [0x4a5a78, 0x6a5040, 0x3a6a6a, 0x8a8a96, 0x5a3a5a, 0xd8dce8, 0x7a9ad0, 0xc87a8a, 0x6ab0a0, 0x2c3a58, 0xb8a080];
/** PSO section ID colours for the other hunters' outfits. */
const SECTION = [0x3ab060, 0x8ad040, 0x40b0e0, 0x2a60d0, 0x8a50c0, 0xe070b0, 0xd03a3a, 0xe8802a, 0xe8c83a, 0xe8ecf4];

function civilian(rng: () => number): HumanoidStyle {
  const pick = <T,>(a: T[]) => a[Math.floor(rng() * a.length)];
  const female = rng() < 0.5;
  const suit = pick(CLOTH);
  const style: HumanoidStyle = {
    build: female ? 'female' : 'male',
    skin: pick(SKIN),
    hair: pick(HAIR),
    hairStyle: female ? (rng() < 0.5 ? 'bob' : 'long') : rng() < 0.6 ? 'short' : 'spiky',
    suit,
    trim: pick([0xf0f0f4, 0xe8c040, 0x2a2a34, 0x9fd0ff]),
    pants: pick([0x22252e, 0x2a3040, 0x3a3430, 0x4a4a56, suit]),
    boots: pick([0x22252e, 0x30303e, 0x4a3a2a]),
    gloves: suit,
    collar: rng() < 0.4 ? 0xf0f0f4 : undefined,
  };
  if (female && rng() < 0.5) style.skirt = { color: suit, length: 0.45 + rng() * 0.3, flare: 0.08 + rng() * 0.06 };
  if (!female && rng() < 0.3) Object.assign(style, { hat: 'cap', hatColor: pick(CLOTH), hatTrim: 0xf0f0f4 });
  return style;
}

/** Another hunter: one of the PSO class looks in a section ID colour. */
function hunter(rng: () => number): HumanoidStyle {
  const base = [STYLES.hunter, STYLES.ranger, STYLES.force][Math.floor(rng() * 3)] as HumanoidStyle;
  const c = SECTION[Math.floor(rng() * SECTION.length)];
  const s: HumanoidStyle = { ...base };
  if (base === STYLES.ranger) Object.assign(s, { trim: c, gloves: c, collar: c, tassets: { ...base.tassets!, color: c }, plates: { ...base.plates!, trim: c } });
  else if (base === STYLES.force) Object.assign(s, { trim: c, boots: c, collar: c, hatColor: c, skirt: { ...base.skirt!, color: c } });
  else Object.assign(s, { suit: c, hatColor: new THREE.Color(c).multiplyScalar(0.7).getHex(), skirt: { ...base.skirt!, color: new THREE.Color(c).multiplyScalar(0.85).getHex() } });
  return s;
}

export class Crowd {
  readonly group = new THREE.Group();
  private people: Walker[] = [];
  private rng = mulberry32(1998);
  /** Rooms people stand in, and the connector between them. */
  private zones: RoomRuntime[];
  private link: RoomRuntime | undefined;
  /** Spots in front of each counter (browsing), with the facing toward it. */
  private browse: { x: number; z: number; yaw: number }[] = [];
  /** Kept clear: the teleporter pad and its Telepipe spot, the arrival point. */
  private keepClear: { x: number; z: number; r: number }[] = [];
  private t = 0;

  constructor(private level: Level) {
    this.zones = level.rooms.filter((r) => r.def.id !== 'promenade');
    this.link = level.rooms.find((r) => r.def.id === 'promenade');
    for (const f of level.features) {
      if (f.def.kind === 'cityTeleporter') this.keepClear.push({ x: f.x, z: f.z, r: 4.2 }, { x: f.x + 3.5, z: f.z + 2.5, r: 1.8 });
      if (f.def.kind === 'start') this.keepClear.push({ x: f.x, z: f.z, r: 2 });
      if (!isCounter(f.def.kind)) continue;
      const r = level.rooms.find((q) => q.def.id === f.room)!.rect;
      const { nx, nz } = [
        { d: f.z - r.minZ, nx: 0, nz: 1 },
        { d: r.maxZ - f.z, nx: 0, nz: -1 },
        { d: f.x - r.minX, nx: 1, nz: 0 },
        { d: r.maxX - f.x, nx: -1, nz: 0 },
      ].sort((a, b) => a.d - b.d)[0];
      for (const side of [-1, 1]) {
        this.browse.push({ x: f.x + nx * 3.1 + nz * side * 1.0, z: f.z + nz * 3.1 - nx * side * 1.0, yaw: Math.atan2(-nx, -nz) });
      }
      this.keepClear.push({ x: f.x + nx * 2.2, z: f.z + nz * 2.2, r: 1.2 });
    }

    const rng = this.rng;
    // Two chatting pairs (one by the fountain, one on the deck), then strollers.
    const pairs = this.zones.map((z) => this.spot(z)).filter((p): p is THREE.Vector3 => !!p);
    for (const p of pairs) {
      const a = rng() * Math.PI;
      const dx = Math.sin(a) * 0.65;
      const dz = Math.cos(a) * 0.65;
      const one = this.add(new THREE.Vector3(p.x - dx, 0, p.z - dz), rng() < 0.5 ? civilian(rng) : hunter(rng), true);
      const two = this.add(new THREE.Vector3(p.x + dx, 0, p.z + dz), civilian(rng), true);
      one.face = one.yaw = Math.atan2(dx, dz);
      two.face = two.yaw = Math.atan2(-dx, -dz);
    }
    const counts = this.zones.map((z) => Math.round(((z.rect.maxX - z.rect.minX) * (z.rect.maxZ - z.rect.minZ)) / 130));
    this.zones.forEach((z, i) => {
      for (let k = 0; k < counts[i]; k++) {
        const p = this.spot(z);
        if (!p) continue;
        const w = this.add(p, rng() < 0.3 ? hunter(rng) : civilian(rng), false);
        w.wait = rng() * 6;
        w.yaw = rng() * Math.PI * 2;
      }
    });
  }

  private add(pos: THREE.Vector3, style: HumanoidStyle, chat: boolean): Walker {
    const model = new Humanoid(style);
    // A soft blob instead of cast shadows: each person is ~50 meshes, and shadow passes would double that.
    model.rig.root.traverse((o) => (o.castShadow = false));
    const blob = new THREE.Mesh(BLOB_GEO, BLOB_MAT);
    blob.position.y = 0.015;
    model.rig.root.add(blob);
    model.rig.root.position.copy(pos);
    this.group.add(model.rig.root);
    const w: Walker = {
      model, pos: model.rig.root.position, yaw: 0, path: [], wait: 0, face: null, phase: this.rng() * 6,
      speed: SPEED * (0.85 + this.rng() * 0.3), feminine: style.build === 'female', chat, gesture: 4 + this.rng() * 8, stuck: 0,
    };
    this.people.push(w);
    return w;
  }

  /** A random free spot in a zone, or null. */
  private spot(zone: RoomRuntime): THREE.Vector3 | null {
    const q = zone.rect;
    for (let i = 0; i < 30; i++) {
      const x = q.minX + 2 + this.rng() * (q.maxX - q.minX - 4);
      const z = q.minZ + 2 + this.rng() * (q.maxZ - q.minZ - 4);
      if (this.free(x, z)) return new THREE.Vector3(x, 0, z);
    }
    return null;
  }

  private free(x: number, z: number): boolean {
    if (this.level.trees.some((c) => Math.hypot(c.x - x, c.z - z) < c.r + 0.9)) return false;
    if (this.keepClear.some((c) => Math.hypot(c.x - x, c.z - z) < c.r)) return false;
    if (this.level.features.some((f) => isCounter(f.def.kind) && Math.hypot(f.x - x, f.z - z) < 2.6)) return false;
    return !this.people.some((p) => Math.hypot(p.pos.x - x, p.pos.z - z) < 1.4 || p.path.some((w) => Math.hypot(w.x - x, w.z - z) < 1.4));
  }

  /** Is the straight walk from a to b clear of the bigger solids? */
  private clearLine(a: THREE.Vector3, b: THREE.Vector3): boolean {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len2 = dx * dx + dz * dz || 1;
    for (const c of this.level.trees) {
      if (c.r < 0.6) continue;
      const k = Math.max(0, Math.min(1, ((c.x - a.x) * dx + (c.z - a.z) * dz) / len2));
      if (Math.hypot(a.x + dx * k - c.x, a.z + dz * k - c.z) < c.r + RADIUS + 0.15) return false;
    }
    return true;
  }

  private zoneOf(p: THREE.Vector3): RoomRuntime | undefined {
    return this.zones.find((z) => p.x >= z.rect.minX && p.x <= z.rect.maxX && p.z >= z.rect.minZ && p.z <= z.rect.maxZ);
  }

  /** The connector's mouth on a zone's side. */
  private mouth(zone: RoomRuntime): THREE.Vector3 {
    const l = this.link!.rect;
    const x = (l.minX + l.maxX) / 2 + (this.rng() - 0.5) * 3;
    return new THREE.Vector3(x, 0, zone.rect.maxZ <= l.minZ + 0.01 ? l.minZ + 0.8 : l.maxZ - 0.8);
  }

  /** Choose where to go next: mostly a free spot in this zone, sometimes a shop, sometimes the other zone. */
  private plan(w: Walker): void {
    const here = this.zoneOf(w.pos) ?? this.zones[0];
    const r = this.rng();
    w.face = null;
    if (r < 0.3 && this.browse.length) {
      const b = this.browse[Math.floor(this.rng() * this.browse.length)];
      const target = new THREE.Vector3(b.x, 0, b.z);
      if (!this.people.some((p) => p !== w && p.pos.distanceTo(target) < 1.2) && this.route(w, here, target)) {
        w.face = b.yaw;
        w.wait = 6 + this.rng() * 8;
        return;
      }
    }
    const other = this.link && r > 0.8 ? this.zones.find((z) => z !== here) : undefined;
    for (let i = 0; i < 8; i++) {
      const p = this.spot(other ?? here);
      if (p && this.route(w, here, p)) {
        w.wait = 2 + this.rng() * 6;
        return;
      }
    }
    w.wait = 2;
  }

  /** Fill in the path to `target` (through the promenade between zones). False when the way is blocked. */
  private route(w: Walker, here: RoomRuntime, target: THREE.Vector3): boolean {
    const there = this.zoneOf(target) ?? here;
    const pts = there === here || !this.link ? [target] : [this.mouth(here), this.mouth(there), target];
    let from = w.pos;
    for (const p of pts) {
      if (!this.clearLine(from, p)) return false;
      from = p;
    }
    w.path = pts;
    return true;
  }

  update(dt: number, player: THREE.Vector3): void {
    this.t += dt;
    const dir = new THREE.Vector3();
    for (const w of this.people) {
      let moving = false;
      if (w.path.length) {
        const next = w.path[0];
        dir.set(next.x - w.pos.x, 0, next.z - w.pos.z);
        const d = dir.length();
        if (d < 0.3) {
          w.path.shift();
        } else {
          dir.divideScalar(d);
          // Pause while the player stands right in the way.
          const px = player.x - w.pos.x;
          const pz = player.z - w.pos.z;
          const pd = Math.hypot(px, pz);
          const blocked = pd < 1.4 && (px * dir.x + pz * dir.z) / (pd || 1) > 0.5;
          if (!blocked) {
            const step = Math.min(d, w.speed * dt);
            const before = w.pos.clone();
            w.pos.addScaledVector(dir, step);
            this.level.resolveCircle(w.pos, RADIUS);
            const moved = before.distanceTo(w.pos);
            w.phase += moved * STRIDE;
            w.stuck = moved < step * 0.3 ? w.stuck + dt : 0;
            if (w.stuck > 1.5) w.path.length = 0; // wedged: give up and pick again
            moving = true;
            w.yaw = turn(w.yaw, Math.atan2(dir.x, dir.z), dt * 6);
          } else if ((w.stuck += dt) > 1.5) {
            // The player isn't moving out of the way: go somewhere else.
            w.path.length = 0;
            w.stuck = 0;
            w.wait = 0.5;
          }
        }
      } else if (!w.chat) {
        w.wait -= dt;
        if (w.wait <= 0) this.plan(w);
      }
      if (!moving && w.face !== null) w.yaw = turn(w.yaw, w.face, dt * 4);
      w.model.rig.root.rotation.y = w.yaw;
      // Standing people idle; chatters gesture now and then.
      w.gesture -= dt;
      if (w.gesture < -1.4) w.gesture = 5 + Math.random() * 9;
      const pose = moving
        ? humanPoses.walk(w.phase, w.feminine)
        : w.chat && w.gesture < 0
          ? talk(this.t, w.speed)
          : humanPoses.idle(this.t + w.speed * 7, 'none');
      w.model.rig.apply(pose, dt, 8);
    }
    // Keep people apart.
    for (let i = 0; i < this.people.length; i++)
      for (let k = i + 1; k < this.people.length; k++) separateCircles(this.people[i].pos, RADIUS, 1, this.people[k].pos, RADIUS, 1);
  }

  /** Push the player out of anyone they walk into. */
  collide(player: THREE.Vector3, radius: number): void {
    for (const w of this.people) separateCircles(w.pos, RADIUS, 1000, player, radius, 1);
  }
}

/** A talking gesture: the right hand up and turning over, the head nodding. */
function talk(t: number, seed: number): Pose {
  const base = humanPoses.idle(t + seed * 7, 'none');
  const s = Math.sin(t * 3 + seed * 5);
  Object.assign(base.joints, { shoulderR: [-0.55, 0, -0.25], elbowR: [-1.25 + s * 0.2, 0, 0], handR: [0, s * 0.6, 0], head: [-0.06 + s * 0.04, 0, 0] });
  return base;
}

/** Turn an angle toward a target by at most `max` radians. */
function turn(from: number, to: number, max: number): number {
  let d = to - from;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return from + Math.max(-max, Math.min(max, d));
}
