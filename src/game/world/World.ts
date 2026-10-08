import * as THREE from 'three';
import { sfx } from '../../audio';
import { expeditionOf, isCounter, type ExpeditionId, type SpawnDef } from '../data/areas';
import {
  affixes as affixCfg, ai, dash as dashCfg, elite as eliteCfg, enemies as enemyDefs, hard as hardCfg, hell as hellCfg, hazards as hazardCfg, machinery as machineCfg, panArms as panCfg, pylonCfg,
  type EnemyArchetype, type EnemyId,
} from '../config';
import { AFFIXES, HARD_AFFIXES, MINES_AFFIXES, rollAffixes } from '../data/affixes';
import { shieldBubble } from '../enemies/affixFx';
import { hardArch, hardBoss, hardScale } from '../hard';
import { separateCircles } from '../collision';
import type { Hittable } from '../combat/types';
import type { AreaDef, AreaId } from '../data/areas';
import { areaDef } from '../data/looks';
import type { Boss, BossContext } from '../enemies/Boss';
import { PanArms } from '../enemies/caveEnemies';
import { createBoss } from '../enemies/createBoss';
import type { Enemy, EnemyContext, EnemyOptions } from '../enemies/Enemy';
import { ControlNode, Gunbot } from '../enemies/mineEnemies';
import { createEnemy } from '../enemies/spawn';
import type { Player } from '../Player';
import { Breakable } from './Breakable';
import { Pillar, Ring, type Effect } from './Effects';
import { LavaVent, PoisonPool, type HazardHooks } from './Hazard';
import { Interactable } from './Interactable';
import { Level, TILE, type RoomRuntime } from './Level';
import { Conveyor, Crusher, LaserFence, type Machine, type MachineHooks } from './Machinery';
import { Pickup, type PickupContent } from './Pickup';
import { Pylon } from './Pylon';
import { Projectile, type ProjectileSpec } from './Projectile';
import { Telegraph, type TelegraphShape } from './Telegraph';

// Runtime state of one loaded area: level geometry, enemies, pickups,
// projectiles, hazards and room/wave progression.

export interface AreaRunState {
  cleared: Set<string>;
  unlocked: Set<string>;
  boxes: Set<string>;
}

/** One expedition's progress this session (not saved): rooms cleared per floor and the furthest floor reached. */
export interface RunState {
  expedition: ExpeditionId;
  areas: Partial<Record<AreaId, AreaRunState>>;
  /** Index into the expedition's floors: the fallback the city teleporter returns to. */
  floor: number;
  bossDefeated: boolean;
  /** Nightmare, internally Hard (see DESIGN.md "Nightmare"); also set on Hell, which uses the same mechanics. */
  hard: boolean;
  /** Hell (see DESIGN.md "Hell"): Hell scaling, every hit can corrupt, far more elites, boss third phases. */
  hell: boolean;
}

export function newRun(expedition: ExpeditionId = 'forest', hard = false, hell = false): RunState {
  return { expedition, areas: {}, floor: 0, bossDefeated: false, hard: hard || hell, hell };
}

export function areaRun(run: RunState, id: AreaId): AreaRunState {
  let s = run.areas[id];
  if (!s) {
    s = { cleared: new Set(), unlocked: new Set(), boxes: new Set() };
    run.areas[id] = s;
  }
  return s;
}

export interface WorldHooks {
  enemyCtx: EnemyContext;
  bossCtx: BossContext;
  hazards: HazardHooks;
  onRoomActivated(room: RoomRuntime): void;
  onWave(room: RoomRuntime, wave: number, total: number, ambush: boolean): void;
  onRoomCleared(room: RoomRuntime): void;
  /** Flavour feedback (Pan Arms splitting, re-forming, merging). */
  onEvent(text: string): void;
  /** An enemy went down without a player hit (gunbots shutting down with their node): award the kill. */
  onEnemyKilled(e: Enemy): void;
  /** A Volatile elite's death blast went off. */
  volatileBlast(e: Enemy, shape: TelegraphShape): void;
  rng(): number;
}

/** A gunbot linked to its room's control node, with the tether drawn between them. */
interface NodeLink {
  node: Enemy;
  bot: Gunbot;
  tether: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
}

interface ActiveRoom {
  room: RoomRuntime;
  wave: number;
  delay: number;
  /** Ambush spawns still telegraphing (count as alive). */
  pending: Telegraph[];
  /** Hard: the wave entries that come in as the room's champions (one; two in big Hell Ruins rooms). */
  champion: { wave: number; index: number }[];
  /** Hell: a Splitting enemy has spawned here (only one per room). */
  splitting?: boolean;
}

/** A Shielding elite's tether to an ally it protects. */
interface ShieldLink {
  src: Enemy;
  ally: Enemy;
  tether: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  /** Hex bubble around the protected ally. */
  bubble: THREE.Mesh<THREE.IcosahedronGeometry, THREE.MeshBasicMaterial>;
}

/** The two halves of a split Pan Arms, linked by a glowing tether. */
interface PanPair {
  hid: Enemy;
  mig: Enemy;
  /** Seconds both halves have been alive together. */
  together: number;
  reform: { which: 'hid' | 'mig'; tele: Telegraph } | null;
  tether: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
}

const UP = new THREE.Vector3(0, 1, 0);

export class World {
  readonly group = new THREE.Group();
  readonly level: Level;
  readonly enemies: Enemy[] = [];
  readonly boxes: Breakable[] = [];
  readonly pickups: Pickup[] = [];
  readonly projectiles: Projectile[] = [];
  readonly telegraphs: Telegraph[] = [];
  readonly interactables: Interactable[] = [];
  readonly vents: LavaVent[] = [];
  readonly pools: PoisonPool[] = [];
  readonly effects: Effect[] = [];
  /** Mines machinery, and the state of each power circuit (true = flipped from its default). */
  readonly machines: Machine[] = [];
  /** Ruins light pylons. */
  readonly pylons: Pylon[] = [];
  private circuits = new Map<string, boolean>();
  private links: NodeLink[] = [];
  /** Volatile elites whose death blast has been set off. */
  private blasted = new WeakSet<Enemy>();
  /** Splitting elites that already split. */
  private splitDone = new WeakSet<Enemy>();
  private shields: ShieldLink[] = [];
  /** Molten elites: seconds to their next trail patch. */
  private moltenT = new WeakMap<Enemy, { t: number; x: number; z: number }>();
  /** Regenerating: seconds to each one's next heal pulse. */
  private regenPulseT = new WeakMap<Enemy, number>();
  private toldReboot = false;
  private machineHooks: MachineHooks;
  boss: Boss | null = null;
  private pairs: PanPair[] = [];
  private active: ActiveRoom | null = null;
  private sinceWindup = 10;
  private sinceShot = 10;
  private state: AreaRunState;

  constructor(
    readonly areaId: AreaId,
    readonly run: RunState,
    private hooks: WorldHooks,
    /** Override the area definition (the Area Lab previews looks). */
    defOverride?: AreaDef,
  ) {
    const def = defOverride ?? areaDef(areaId);
    this.level = new Level(def);
    this.state = areaRun(run, areaId);
    this.group.add(this.level.group);
    this.machineHooks = {
      hurtPlayer: (d, x, z, kb, src) => hooks.hazards.hurtPlayer(d, x, z, kb, src),
      burnPlayer: (n) => hooks.hazards.burnPlayer(n),
      hurtEnemy: (e, d) => hooks.hazards.hurtEnemy(e, d),
    };

    for (const lock of this.state.unlocked) this.level.unlock(lock);

    for (const f of this.level.features) {
      if (f.def.kind === 'start') continue;
      const it = new Interactable(f.def.kind, f.def.label ?? f.def.kind, f.x, f.z, f.def.lock, f.def.to);
      if (f.def.kind === 'switch' && f.def.lock && this.state.unlocked.has(f.def.lock)) it.active = true;
      if (f.def.kind === 'power' && f.def.lock) this.circuits.set(f.def.lock, false);
      this.interactables.push(it);
      this.group.add(it.group);
    }

    for (const spot of this.level.boxSpots) {
      if (this.state.boxes.has(spot.id)) continue;
      const b = new Breakable(spot.id, spot.x, spot.z);
      this.boxes.push(b);
      this.group.add(b.group);
    }

    // Hazards are authored in room tiles.
    for (const room of this.level.rooms) {
      const r = room.def;
      const X = (tx: number) => room.rect.minX + tx * TILE;
      const Z = (tz: number) => room.rect.minZ + tz * TILE;
      for (const [tx, tz, phase] of r.vents ?? []) {
        const v = new LavaVent(X(tx), Z(tz), phase ?? 0, def.theme.lava);
        this.vents.push(v);
        this.group.add(v.group);
      }
      const add = (m: Machine) => {
        this.machines.push(m);
        this.group.add(m.group);
      };
      for (const c of r.crushers ?? []) add(new Crusher(X(c.tx), Z(c.tz), c.phase ?? 0, c.power ?? null));
      for (const l of r.lasers ?? []) add(new LaserFence(X(l.ax), Z(l.az), X(l.bx), Z(l.bz), l.phase ?? 0, l.power ?? null));
      for (const c of r.conveyors ?? []) add(new Conveyor(X(c.tx), Z(c.tz), X(c.tx + c.w), Z(c.tz + c.h), c.dir, c.power ?? null));
      for (const [tx, tz, rx, rz] of r.marsh ?? []) {
        const p = new PoisonPool(room.rect.minX + tx * TILE, room.rect.minZ + tz * TILE, rx * TILE, rz * TILE, Infinity, true, (tx * 7 + tz * 3) % 1, def.theme.pool);
        this.pools.push(p);
        this.group.add(p.group);
      }
      // Mines slag: molten pools that slow and keep adding Burn.
      for (const [tx, tz, rx, rz] of r.slag ?? []) {
        const p = new PoisonPool(X(tx), Z(tz), rx * TILE, rz * TILE, Infinity, true, (tx * 5 + tz * 3) % 1, def.theme.lava ?? 0xff6a20, 'burn');
        this.pools.push(p);
        this.group.add(p.group);
      }
      // Ruins light pylons, glowing in the area's light colour.
      for (const [tx, tz] of r.pylons ?? []) {
        const stone = new THREE.Color(def.theme.wall).lerp(new THREE.Color(0xffffff), 0.35).getHex();
        const p = new Pylon(X(tx), Z(tz), r.id, def.theme.accent3 ?? 0xffe6a0, stone);
        this.pylons.push(p);
        this.group.add(p.group);
        this.interactables.push(p.interactable);
      }
    }

    if (def.kind === 'boss' && !run.bossDefeated) {
      const id = def.boss ?? 'dragon';
      this.boss = createBoss(id, this.level, run.hard ? hardBoss(id, run.hell) : null);
      this.group.add(...this.boss.objects);
    }
    if (def.kind === 'boss' && run.bossDefeated) this.spawnReturnTeleporter();
    for (const id of this.circuits.keys()) this.refreshCircuit(id);
  }

  get def() {
    return this.level.def;
  }

  startPoint(): THREE.Vector3 {
    const f = this.level.features.find((f) => f.def.kind === 'start');
    return f ? new THREE.Vector3(f.x, 0, f.z) : this.level.center();
  }

  featurePoint(kind: string): THREE.Vector3 | null {
    const f = this.level.features.find((f) => f.def.kind === kind);
    return f ? new THREE.Vector3(f.x, 0, f.z + 2.5) : null;
  }

  /** Everything the player's attacks can hit. */
  hittables(): Hittable[] {
    const out: Hittable[] = [];
    for (const e of this.enemies) if (e.alive) out.push(e);
    if (this.boss?.alive) for (const p of this.boss.parts()) out.push(p);
    return out;
  }

  /** Lock-on / soft-aim candidates. */
  targets(): Hittable[] {
    return this.hittables().filter((h) => !h.invulnerable);
  }

  get roomActive(): boolean {
    return this.active !== null;
  }

  // ---------------------------------------------------------- spawning

  addPickup(content: PickupContent, x: number, z: number): Pickup {
    const p = new Pickup(content, x, z);
    // Don't drop things inside walls.
    this.level.resolveCircle(p.pos, 0.4);
    this.pickups.push(p);
    this.group.add(p.group);
    return p;
  }

  removePickup(p: Pickup): void {
    p.taken = true;
    this.group.remove(p.group);
    const i = this.pickups.indexOf(p);
    if (i >= 0) this.pickups.splice(i, 1);
  }

  spawnProjectile(spec: ProjectileSpec): void {
    const p = new Projectile(spec);
    this.projectiles.push(p);
    this.group.add(p.mesh);
  }

  addTelegraph(shape: TelegraphShape, duration: number, onFire: () => void, color?: number, dash = false): Telegraph {
    const t = new Telegraph(shape, duration, onFire, color, dash && dashCfg.cueTelegraphs);
    this.telegraphs.push(t);
    this.group.add(t.group);
    return t;
  }

  addEffect(e: Effect): void {
    this.effects.push(e);
    this.group.add(e.object);
  }

  /** A burning patch that dies down after `life` seconds (Molten, the Volatile death blast). */
  addFirePatch(x: number, z: number, radius: number, life: number): void {
    const p = new PoisonPool(x, z, radius, radius, life, false, this.hooks.rng(), 0xff5a20, 'burn');
    this.pools.push(p);
    this.group.add(p.group);
  }

  /** Molten: where one of its area attacks lands, leave a burning patch (sized to the attack, within limits). */
  moltenMark(shape: TelegraphShape): void {
    const life = affixCfg.moltenLife;
    const r = affixCfg.moltenStrikeRadius;
    switch (shape.kind) {
      case 'circle':
        this.addFirePatch(shape.x, shape.z, Math.min(1.8, Math.max(r, shape.radius)), life);
        break;
      case 'cone':
        this.addFirePatch(shape.x + Math.sin(shape.yaw) * shape.range * 0.6, shape.z + Math.cos(shape.yaw) * shape.range * 0.6, r, life);
        break;
      case 'line':
        this.addFirePatch(shape.x + Math.sin(shape.yaw) * shape.length * 0.5, shape.z + Math.cos(shape.yaw) * shape.length * 0.5, r, life);
        break;
      case 'arc': {
        const d = (shape.inner + shape.outer) / 2;
        this.addFirePatch(shape.x + Math.sin(shape.yaw) * d, shape.z + Math.cos(shape.yaw) * d, r, life);
        break;
      }
    }
  }

  /** A poison puddle that dries up after `life` seconds (De Rol Le's spray). */
  addPuddle(x: number, z: number, radius: number, life: number): void {
    const p = new PoisonPool(x, z, radius, radius, life, false, this.hooks.rng());
    this.pools.push(p);
    this.group.add(p.group);
  }

  /** The stats an enemy type spawns with here: scaled on Hard. */
  archFor(type: EnemyId): EnemyArchetype {
    const exp = expeditionOf(this.areaId);
    return this.run.hard && exp ? hardArch(enemyDefs[type], hardScale(exp, this.run.hell)) : enemyDefs[type];
  }

  spawnEnemy(type: EnemyId, x: number, z: number, room: string | null, opts: EnemyOptions = {}): Enemy {
    if (!opts.arch && this.run.hard) opts = { ...opts, arch: this.archFor(type) };
    const e = createEnemy(type, x, z, this.hooks.rng, opts);
    e.room = room;
    this.level.resolveCircle(e.pos, e.radius);
    this.enemies.push(e);
    this.group.add(e.group);
    // Control nodes keep every gunbot in their room rebooting.
    if (room && e instanceof Gunbot) {
      const node = this.enemies.find((n) => n instanceof ControlNode && n.alive && n.room === room);
      if (node) this.link(node, e);
    } else if (room && e instanceof ControlNode) {
      for (const b of this.enemies) if (b instanceof Gunbot && b.alive && b.room === room && !b.link) this.link(e, b);
    }
    return e;
  }

  private link(node: Enemy, bot: Gunbot): void {
    bot.link = node;
    const tether = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.035, 1, 5, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x40c8ff, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.group.add(tether);
    this.links.push({ node, bot, tether });
  }

  private dropLink(l: NodeLink): void {
    this.group.remove(l.tether);
    l.tether.geometry.dispose();
    l.tether.material.dispose();
    this.links.splice(this.links.indexOf(l), 1);
  }

  /** Tethers follow their bots; a fallen node shuts its bots down (each a real kill). */
  private updateLinks(): void {
    const fallen = new Set<Enemy>();
    for (const l of [...this.links]) {
      if (!l.node.alive) {
        if (l.bot.alive && !l.node.vanished) {
          l.bot.shutdown();
          this.addEffect(new Ring(l.bot.pos.x, l.bot.pos.z, 0x40c8ff, 2.2, 0.4));
          this.hooks.onEnemyKilled(l.bot);
          fallen.add(l.node);
        }
        this.dropLink(l);
        continue;
      }
      if (!l.bot.alive || l.bot.vanished) {
        this.dropLink(l);
        continue;
      }
      if (l.bot.state === 'offline' && !this.toldReboot) {
        this.toldReboot = true;
        this.hooks.onEvent('The Gillchic is rebooting: destroy the control node to shut it down for good!');
      }
      const a = l.node.pos;
      const b = l.bot.pos;
      const from = new THREE.Vector3(a.x, 2.5, a.z);
      const to = new THREE.Vector3(b.x, 1.4, b.z);
      const len = from.distanceTo(to);
      l.tether.position.copy(from).add(to).multiplyScalar(0.5);
      l.tether.quaternion.setFromUnitVectors(UP, to.sub(from).normalize());
      l.tether.scale.set(1, Math.max(0.01, len), 1);
      const off = l.bot.state === 'offline';
      l.tether.material.opacity = off ? 0.5 + Math.sin(performance.now() / 60) * 0.3 : 0.3;
    }
    if (fallen.size) this.hooks.onEvent('Control node destroyed: its gunbots shut down!');
  }

  // ------------------------------------------------------------ pylons

  /** Is a point (with this radius) in light: a lit pylon's circle, or light the boss left (Grants)? */
  lightAt(x: number, z: number, r = 0): boolean {
    return this.pylons.some((p) => p.inside(x, z, r)) || !!this.boss?.lightAt?.(x, z, r);
  }

  /** The pylon behind an interactable. */
  pylonOf(it: Interactable): Pylon | null {
    return this.pylons.find((p) => p.interactable === it) ?? null;
  }

  /** A lit pylon in this enemy's room that nobody is draining yet. */
  litPylon(e: Enemy): { id: number; x: number; z: number } | null {
    const p = this.pylons.find((q) => q.lit && q.snuffK <= 0 && (q.room === e.room || !e.room));
    return p ? { id: p.id, x: p.pos.x, z: p.pos.z } : null;
  }

  /** A Sorcerer's drain on a pylon: progress 0..1 (1 puts it out), -1 calls it off. */
  snuffPylon(id: number, k: number): void {
    const p = this.pylons.find((q) => q.id === id);
    if (!p) return;
    if (k < 0) {
      p.snuffK = 0;
      return;
    }
    p.snuffK = k;
    if (k >= 1) {
      p.snuff();
      this.addEffect(new Ring(p.pos.x, p.pos.z, 0x8040c0, pylonCfg.radius, 0.6));
      this.hooks.onEvent('A Chaos Sorcerer snuffed out the pylon!');
    }
  }

  /**
   * A free spot about `dist` m from (x, z), inside the enemy's room and off walls, props and pylons
   * (Sorcerer blinks). Tries a ring of directions, starting from the side the enemy is on.
   */
  blinkSpot(e: Enemy, x: number, z: number, dist: number): [number, number] | null {
    const rect = this.level.rooms.find((r) => r.def.id === e.room)?.rect ?? this.level.roomAt(e.pos.x, e.pos.z)?.rect;
    const start = Math.atan2(e.pos.x - x, e.pos.z - z);
    for (let i = 0; i < 12; i++) {
      const a = start + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * (Math.PI / 6) + (this.hooks.rng() - 0.5) * 0.3;
      const px = x + Math.sin(a) * dist;
      const pz = z + Math.cos(a) * dist;
      if (rect && (px < rect.minX + 1.4 || px > rect.maxX - 1.4 || pz < rect.minZ + 1.4 || pz > rect.maxZ - 1.4)) continue;
      if (this.level.isSolidAt(px, pz) || this.level.trees.some((t) => Math.hypot(t.x - px, t.z - pz) < t.r + 1)) continue;
      return [px, pz];
    }
    return null;
  }

  /** Metres from (x, z) along `yaw` before a wall (or a closed gate), up to `max`. */
  reach(x: number, z: number, yaw: number, max: number): number {
    const dx = Math.sin(yaw);
    const dz = Math.cos(yaw);
    for (let d = 0.5; d <= max; d += 0.5) if (this.level.isSolidAt(x + dx * d, z + dz * d)) return d - 0.5;
    return max;
  }

  // ------------------------------------------------------------- power

  /** Flip a power circuit: its machinery stops / starts. */
  togglePower(circuit: string): boolean {
    const flipped = !this.circuits.get(circuit);
    this.circuits.set(circuit, flipped);
    this.refreshCircuit(circuit);
    return flipped;
  }

  private refreshCircuit(circuit: string): void {
    const flipped = !!this.circuits.get(circuit);
    const ms = this.machines.filter((m) => m.power === circuit);
    for (const m of ms) m.setFlipped(flipped);
    for (const it of this.interactables) {
      if (it.kind !== 'power' || it.lock !== circuit) continue;
      const base = it.label.replace(/:.*$/, '');
      it.label = `${base}: ${flipped ? 'off' : 'on'}`;
      it.lightColor = flipped ? 0x40ff70 : 0xffa020;
      it.active = flipped;
    }
  }

  /** A weapon blast (Garanz missile, Volatile elite): machines caught take damage and power switches flip. */
  blast(source: Enemy | null, x: number, z: number, radius: number, enemyPct = machineCfg.missileEnemyPct): void {
    for (const e of this.enemies) {
      if (e === source || !e.alive || e.invulnerable || e.arch.race !== 'machine') continue;
      if (Math.hypot(e.pos.x - x, e.pos.z - z) > radius + e.radius) continue;
      this.hooks.hazards.hurtEnemy(e, Math.max(1, Math.round(e.maxHp * enemyPct)));
    }
    for (const it of this.interactables) {
      if (it.kind !== 'power' || !it.lock || Math.hypot(it.pos.x - x, it.pos.z - z) > radius + machineCfg.switchRange * 0.5) continue;
      this.togglePower(it.lock);
      this.addEffect(new Ring(it.pos.x, it.pos.z, 0xffe080, 2, 0.4));
      sfx('world.switch', { x: it.pos.x, z: it.pos.z });
      this.hooks.onEvent(`A blast flipped the ${it.label.replace(/:.*$/, '').toLowerCase()} switch!`);
    }
  }

  /** Volatile elites blow up a moment after they go down. */
  private updateVolatile(): void {
    for (const e of this.enemies) {
      if (e.alive || e.vanished || !e.hasAffix('volatile') || this.blasted.has(e)) continue;
      this.blasted.add(e);
      const shape: TelegraphShape = { kind: 'circle', x: e.pos.x, z: e.pos.z, radius: affixCfg.volatileRadius };
      sfx('volatile.warn', { x: e.pos.x, z: e.pos.z });
      this.addTelegraph(shape, affixCfg.volatileWindup, () => {
        this.hooks.volatileBlast(e, shape);
        this.blast(e, shape.x, shape.z, shape.radius, 0.2);
        this.addFirePatch(shape.x, shape.z, shape.radius * 0.75, affixCfg.volatileGroundLife);
        this.addEffect(new Ring(shape.x, shape.z, 0xff7a30, shape.radius * 1.2, 0.4));
        this.addEffect(new Pillar(shape.x, shape.z, 0xff8a40, 0.3, 1, 5));
      }, 0xff6a20);
    }
  }

  /**
   * Splitting elites burst into small, fast copies that give nothing (like re-formed Pan Arms halves).
   * The copies are lesser plain versions of the base enemy: no affixes, not elite, and their HP comes from
   * the type's own (not the elite's or champion's boosted bar).
   */
  private updateSplitting(): void {
    for (const e of [...this.enemies]) {
      if (e.alive || e.vanished || !e.hasAffix('splitting') || this.splitDone.has(e)) continue;
      this.splitDone.add(e);
      const arch: EnemyArchetype = {
        ...e.arch,
        scale: e.arch.scale * affixCfg.splitScale,
        moveSpeed: e.arch.moveSpeed * affixCfg.splitSpeed,
        hp: Math.max(1, Math.round(e.arch.hp * affixCfg.splitHp)),
      };
      // Inside its room, or the copies could land behind the sealed gates and the room never clears.
      const rect = this.level.rooms.find((r) => r.def.id === e.room)?.rect;
      const inRoom = (x: number, z: number): [number, number] =>
        rect ? [THREE.MathUtils.clamp(x, rect.minX + 1.2, rect.maxX - 1.2), THREE.MathUtils.clamp(z, rect.minZ + 1.2, rect.maxZ - 1.2)] : [x, z];
      const n = affixCfg.splitCount;
      for (let i = 0; i < n; i++) {
        const ang = e.yaw + Math.PI / 2 + (i * Math.PI * 2) / n;
        const dx = Math.sin(ang);
        const dz = Math.cos(ang);
        const [x, z] = inRoom(e.pos.x + dx * 0.6, e.pos.z + dz * 0.6);
        const c = this.spawnEnemy(e.type, x, z, e.room, { arch, noReward: true, elite: false, affixes: [] });
        c.wave = e.wave;
        c.yaw = e.yaw;
        c.state = 'hitstun';
        c.stateT = 0;
        c.knock.set(dx * 2.5, 0, dz * 2.5);
      }
      this.addEffect(new Ring(e.pos.x, e.pos.z, 0xffe060, 3, 0.4));
      sfx('panarms.split', { x: e.pos.x, z: e.pos.z, pitch: 1.3 });
      this.hooks.onEvent(`The ${e.arch.name} splits apart!`);
    }
  }

  /** Shielding elites tether up to a few nearby allies; the tethered take reduced damage while it lives. */
  private updateShields(player: Player): void {
    for (const l of [...this.shields]) {
      const far = Math.hypot(l.src.pos.x - l.ally.pos.x, l.src.pos.z - l.ally.pos.z) > affixCfg.shieldRange * 1.5;
      if (!l.src.alive || !l.ally.alive || far) this.removeShield(l);
    }
    for (const src of this.enemies) {
      if (!src.alive || src.state === 'spawning' || !src.hasAffix('shielding')) continue;
      let n = this.shields.filter((l) => l.src === src).length;
      if (n >= affixCfg.shieldTargets) continue;
      const near = this.enemies
        // Hell: Shielding and Regenerating enemies don't shield each other (no unbreakable walls).
        .filter((o) => o !== src && o.alive && !o.shieldedBy && o.state !== 'spawning' && Math.hypot(o.pos.x - src.pos.x, o.pos.z - src.pos.z) < affixCfg.shieldRange)
        .filter((o) => !this.run.hell || !(o.hasAffix('shielding') || o.hasAffix('regenerating')))
        .sort((p, q) => Math.hypot(p.pos.x - src.pos.x, p.pos.z - src.pos.z) - Math.hypot(q.pos.x - src.pos.x, q.pos.z - src.pos.z));
      for (const ally of near) {
        if (n >= affixCfg.shieldTargets) break;
        ally.shieldedBy = src;
        const tether = new THREE.Mesh(
          new THREE.CylinderGeometry(0.05, 0.05, 1, 5, 1, true),
          new THREE.MeshBasicMaterial({ color: 0x60ffc8, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }),
        );
        this.group.add(tether);
        const bubble = shieldBubble(ally.arch.scale);
        ally.group.add(bubble);
        this.shields.push({ src, ally, tether, bubble });
        n++;
      }
    }
    // Each shielder counts its allies and picks a spot behind them, away from the player.
    for (const src of this.enemies) {
      if (!src.hasAffix('shielding')) continue;
      const mine = this.shields.filter((l) => l.src === src);
      src.shieldAllies = mine.length;
      if (!mine.length || !src.alive) {
        src.shieldSpot = null;
        continue;
      }
      let cx = 0;
      let cz = 0;
      for (const l of mine) {
        cx += l.ally.pos.x;
        cz += l.ally.pos.z;
      }
      cx /= mine.length;
      cz /= mine.length;
      const dx = cx - player.pos.x;
      const dz = cz - player.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      let x = cx + (dx / d) * affixCfg.shieldHangBack;
      let z = cz + (dz / d) * affixCfg.shieldHangBack;
      const rect = this.level.rooms.find((r) => r.def.id === src.room)?.rect;
      if (rect) {
        x = THREE.MathUtils.clamp(x, rect.minX + 1.2, rect.maxX - 1.2);
        z = THREE.MathUtils.clamp(z, rect.minZ + 1.2, rect.maxZ - 1.2);
      }
      src.shieldSpot = { x, z };
    }
    const t = performance.now() / 1000;
    for (const l of this.shields) {
      const from = new THREE.Vector3(l.src.pos.x, l.src.aimHeight * 0.8, l.src.pos.z);
      const to = new THREE.Vector3(l.ally.pos.x, l.ally.aimHeight * 0.8, l.ally.pos.z);
      const len = from.distanceTo(to);
      l.tether.position.copy(from).add(to).multiplyScalar(0.5);
      l.tether.quaternion.setFromUnitVectors(UP, to.sub(from).normalize());
      l.tether.scale.set(1, Math.max(0.01, len), 1);
      l.tether.material.opacity = 0.35 + Math.sin(t * 4 + l.ally.id) * 0.12;
      l.bubble.material.opacity = 0.28 + Math.sin(t * 3 + l.ally.id) * 0.08;
      l.bubble.rotation.y = t * 0.5;
    }
  }

  private removeShield(l: ShieldLink): void {
    if (l.ally.shieldedBy === l.src) l.ally.shieldedBy = null;
    this.group.remove(l.tether);
    l.tether.geometry.dispose();
    l.tether.material.dispose();
    l.ally.group.remove(l.bubble);
    l.bubble.geometry.dispose();
    l.bubble.material.dispose();
    this.shields.splice(this.shields.indexOf(l), 1);
  }

  /** Remove Shielding tethers whose source or ally matches (enemies removed without dying). */
  private dropShields(match: (e: Enemy) => boolean): void {
    for (const l of [...this.shields]) {
      if (match(l.src) || match(l.ally)) this.removeShield(l);
    }
  }

  /** Regenerating elites pulse a heal to nearby allies every few seconds (not while Burn / Poison suppress them). */
  private updateRegenPulse(dt: number): void {
    for (const e of this.enemies) {
      if (!e.alive || e.state === 'spawning' || !e.hasAffix('regenerating')) continue;
      const t = (this.regenPulseT.get(e) ?? affixCfg.regenPulseEvery * 0.5) - dt;
      if (t > 0 || e.regenBlocked) {
        this.regenPulseT.set(e, Math.max(0, t));
        continue;
      }
      this.regenPulseT.set(e, affixCfg.regenPulseEvery);
      const color = AFFIXES.regenerating.color;
      this.addEffect(new Ring(e.pos.x, e.pos.z, color, affixCfg.regenPulseRange, 0.6));
      for (const o of this.enemies) {
        if (o === e || !o.alive || o.state === 'spawning') continue;
        if (this.run.hell && (o.hasAffix('regenerating') || o.hasAffix('shielding'))) continue;
        if (Math.hypot(o.pos.x - e.pos.x, o.pos.z - e.pos.z) > affixCfg.regenPulseRange) continue;
        const got = o.receiveHeal(o.maxHp * affixCfg.regenPulseHeal);
        if (got >= 1) {
          this.hooks.enemyCtx.healed(o, Math.round(got));
          this.addEffect(new Pillar(o.pos.x, o.pos.z, color, 0.35, 0.5 * o.arch.scale, 3));
        }
      }
    }
  }

  /** Molten elites leave short-lived burning patches behind them as they walk. */
  private updateMolten(dt: number): void {
    for (const e of this.enemies) {
      if (!e.alive || e.state === 'spawning' || !e.hasAffix('molten')) continue;
      const last = this.moltenT.get(e) ?? { t: 0, x: e.pos.x, z: e.pos.z };
      last.t -= dt;
      if (last.t <= 0 && Math.hypot(e.pos.x - last.x, e.pos.z - last.z) > affixCfg.moltenRadius) {
        last.t = affixCfg.moltenEvery;
        last.x = e.pos.x;
        last.z = e.pos.z;
        this.addFirePatch(e.pos.x, e.pos.z, affixCfg.moltenRadius, affixCfg.moltenLife);
      }
      this.moltenT.set(e, last);
    }
  }

  breakBox(b: Breakable): void {
    this.state.boxes.add(b.id);
  }

  markUnlocked(lock: string): void {
    this.state.unlocked.add(lock);
    this.level.unlock(lock);
  }

  addInteractable(it: Interactable): void {
    this.level.resolveCircle(it.pos, 0.8);
    this.interactables.push(it);
    this.group.add(it.group);
  }

  removeInteractable(it: Interactable): void {
    const i = this.interactables.indexOf(it);
    if (i >= 0) this.interactables.splice(i, 1);
    this.group.remove(it.group);
  }

  spawnReturnTeleporter(): void {
    const c = this.level.center();
    const it = new Interactable('toCity', 'Teleporter to Pioneer 2', c.x, c.z);
    this.interactables.push(it);
    this.group.add(it.group);
  }

  /** Debug / sandbox: kill everything. */
  clearEnemies(): void {
    this.dropShields(() => true);
    for (const e of this.enemies) this.group.remove(e.group);
    this.enemies.length = 0;
  }

  // ------------------------------------------------------------- rooms

  private updateRooms(dt: number, player: Player): void {
    if (this.active) {
      const a = this.active;
      const id = a.room.def.id;
      const waves = a.room.def.waves ?? [];
      // A Splitting elite that fell this frame still counts until its copies are out.
      const up = (e: Enemy) => e.alive || (!e.vanished && e.hasAffix('splitting') && !this.splitDone.has(e));
      const alive = (wave?: number) =>
        this.enemies.filter((e) => e.room === id && up(e) && (wave === undefined || e.wave === wave)).length;
      if (a.wave + 1 < waves.length) {
        // Overlapping rooms send the next wave once a third (or less) of this one is left.
        const threshold = a.room.def.overlap ? Math.floor(waves[a.wave].length / 3) : 0;
        if (alive(a.wave) + a.pending.length > threshold) return;
        if (!a.room.def.overlap && alive() > 0) return;
        a.delay -= dt;
        if (a.delay <= 0) {
          a.wave++;
          a.delay = ai.waveDelay;
          this.spawnWave(a, waves[a.wave], player);
        }
        return;
      }
      if (alive() + a.pending.length > 0) return;
      // Room cleared.
      this.state.cleared.add(id);
      this.level.setRoomGates(id, false);
      this.active = null;
      this.hooks.onRoomCleared(a.room);
      return;
    }

    if (!player.alive) return;
    const room = this.level.roomAt(player.pos.x, player.pos.z, 1.5);
    if (!room || !room.def.waves?.length || this.state.cleared.has(room.def.id)) return;
    this.active = { room, wave: 0, delay: ai.waveDelay, pending: [], champion: this.pickChampion(room) };
    this.level.setRoomGates(room.def.id, true);
    this.hooks.onRoomActivated(room);
    this.spawnWave(this.active, room.def.waves[0], player);
  }

  /**
   * Hard: at most one champion per room, on a random wave entry (never a control node). Hell: every room has
   * one, and big rooms in the Hell Ruins get a second.
   */
  private pickChampion(room: RoomRuntime): ActiveRoom['champion'] {
    if (!this.run.hard) return [];
    if (!this.run.hell && this.hooks.rng() >= hardCfg.championChance) return [];
    const slots: { wave: number; index: number }[] = [];
    (room.def.waves ?? []).forEach((w, wi) =>
      w.forEach((entry, i) => {
        if ((typeof entry === 'string' ? entry : entry.e) !== 'ControlNode') slots.push({ wave: wi, index: i });
      }),
    );
    const n = this.run.hell && expeditionOf(this.areaId) === 'ruins' && slots.length >= hellCfg.bigRoomSpawns ? 2 : 1;
    const picked: { wave: number; index: number }[] = [];
    while (picked.length < n && slots.length) picked.push(slots.splice(Math.floor(this.hooks.rng() * slots.length), 1)[0]);
    return picked;
  }

  private spawnWave(a: ActiveRoom, wave: SpawnDef[], player: Player): void {
    const room = a.room;
    const ambush = room.def.ambush?.includes(a.wave) ?? false;
    const waveIndex = a.wave;
    const rng = this.hooks.rng;
    const hard = this.run.hard;
    // Hard: elites everywhere (the Forest included), and more of them.
    const elites = !!this.def.elites || hard;
    wave.forEach((entry, i) => {
      let type = typeof entry === 'string' ? entry : entry.e;
      // Rare red Lily.
      if (elites && type === 'PoisonLily' && rng() < 1 / 15) type = 'NarLily';
      const champion = hard && type !== 'ControlNode' && a.champion.some((c) => c.wave === waveIndex && c.index === i);
      const chance = this.run.hell ? (hardScale(expeditionOf(this.areaId) ?? 'forest', true).elite ?? hardCfg.eliteChance) : hard ? hardCfg.eliteChance : eliteCfg.chance;
      // Hell: at most one Splitting enemy per room.
      const pool = this.run.hell && a.splitting ? HARD_AFFIXES.filter((x) => x !== 'splitting') : undefined;
      const opts: EnemyOptions = { elite: elites && type !== 'NarLily' && type !== 'ControlNode' && rng() < chance };
      const arch = this.archFor(type);
      if (champion) {
        // The room's champion: two affixes from the whole pool.
        opts.champion = true;
        opts.affixes = rollAffixes(2, arch, rng, pool);
      } else if (opts.elite && hard) {
        opts.affixes = rollAffixes(1, arch, rng, pool);
      } else if (opts.elite && this.def.affixes) {
        // Normal Mines elites roll a machine affix, Ruins elites a dark one.
        opts.affixes = rollAffixes(1, arch, rng, this.def.affixPool ?? MINES_AFFIXES);
      }
      if (opts.affixes?.includes('splitting')) a.splitting = true;
      let x: number;
      let z: number;
      if (typeof entry !== 'string') {
        x = room.rect.minX + entry.tx * TILE;
        z = room.rect.minZ + entry.tz * TILE;
      } else if (ambush) {
        [x, z] = this.ambushSpot(room, player, i, wave.length);
      } else {
        [x, z] = this.level.randomSpot(room, rng, player.pos.x, player.pos.z, 7);
      }
      const spawn = () => {
        const e = this.spawnEnemy(type, x, z, room.def.id, opts);
        e.wave = waveIndex;
        return e;
      };
      if (ambush && typeof entry === 'string') {
        // Dropping in behind you: a short blue warning circle first.
        const t = this.addTelegraph({ kind: 'circle', x, z, radius: 1.3 }, 1.0, () => {
          a.pending.splice(a.pending.indexOf(t), 1);
          if (this.active === a) spawn();
        }, 0x40a0ff);
        a.pending.push(t);
      } else {
        spawn();
      }
    });
    this.hooks.onWave(room, a.wave + 1, room.def.waves?.length ?? 1, ambush);
  }

  /** A spot behind the player (relative to where she faces), spread sideways, inside the room. */
  private ambushSpot(room: RoomRuntime, player: Player, i: number, n: number): [number, number] {
    const q = room.rect;
    const back = player.yaw + Math.PI;
    const rng = this.hooks.rng;
    for (let attempt = 0; attempt < 12; attempt++) {
      const spread = (n > 1 ? i / (n - 1) - 0.5 : 0) * 2.4 + (rng() - 0.5) * (0.6 + attempt * 0.3);
      const d = 4.5 + rng() * 2.5 - attempt * 0.2;
      const x = player.pos.x + Math.sin(back + spread * 0.5) * d;
      const z = player.pos.z + Math.cos(back + spread * 0.5) * d;
      if (x < q.minX + 1.6 || x > q.maxX - 1.6 || z < q.minZ + 1.6 || z > q.maxZ - 1.6) continue;
      if (this.level.isSolidAt(x, z) || this.level.trees.some((t) => Math.hypot(t.x - x, t.z - z) < t.r + 1)) continue;
      return [x, z];
    }
    return this.level.randomSpot(room, rng, player.pos.x, player.pos.z, 4);
  }

  /** Abandon an in-progress room (player died / left): enemies vanish, gates reopen. */
  resetActiveRoom(): void {
    if (!this.active) return;
    const id = this.active.room.def.id;
    for (const t of this.active.pending) t.cancel();
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      if (this.enemies[i].room === id) {
        this.group.remove(this.enemies[i].group);
        this.enemies.splice(i, 1);
      }
    }
    for (const p of [...this.pairs]) if (p.hid.room === id) this.dropPair(p);
    for (const l of [...this.links]) if (l.bot.room === id) this.dropLink(l);
    this.dropShields((e) => e.room === id);
    this.level.setRoomGates(id, false);
    this.active = null;
  }

  // -------------------------------------------------------- Pan Arms

  private split(pa: PanArms): void {
    pa.wantsSplit = false;
    const hp = Math.max(1, Math.ceil(pa.hp / 2));
    const opts: EnemyOptions = { elite: pa.elite, noReward: pa.noReward, hp };
    // Migium is its left (blue) side, Hidoom its right.
    const lx = Math.cos(pa.yaw);
    const lz = -Math.sin(pa.yaw);
    const mig = this.spawnEnemy('Migium', pa.pos.x + lx * 1.1, pa.pos.z + lz * 1.1, pa.room, opts);
    const hid = this.spawnEnemy('Hidoom', pa.pos.x - lx * 1.1, pa.pos.z - lz * 1.1, pa.room, opts);
    for (const [e, s] of [[mig, 1], [hid, -1]] as const) {
      e.wave = pa.wave;
      e.yaw = pa.yaw;
      e.state = 'hitstun';
      e.stateT = 0;
      e.knock.set(lx * s * 5, 0, lz * s * 5);
    }
    pa.vanish();
    this.addEffect(new Ring(pa.pos.x, pa.pos.z, 0xffe0a0, 4, 0.45));
    const tether = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 1, 5, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffd070, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.group.add(tether);
    this.pairs.push({ hid, mig, together: 0, reform: null, tether });
    sfx('panarms.split', { x: pa.pos.x, z: pa.pos.z });
    this.hooks.onEvent('Pan Arms splits apart!');
  }

  private merge(p: PanPair): void {
    const x = (p.hid.pos.x + p.mig.pos.x) / 2;
    const z = (p.hid.pos.z + p.mig.pos.z) / 2;
    const pa = this.spawnEnemy('PanArms', x, z, p.hid.room, {
      elite: p.hid.elite,
      noReward: p.hid.noReward || p.mig.noReward,
      hp: p.hid.hp + p.mig.hp,
    });
    pa.wave = p.hid.wave;
    pa.yaw = p.hid.yaw;
    pa.state = 'hitstun';
    pa.stateT = 0;
    p.hid.vanish();
    p.mig.vanish();
    this.addEffect(new Ring(x, z, 0xffe0a0, 4, 0.45));
    sfx('panarms.split', { x, z, pitch: 0.8 });
    this.hooks.onEvent('Hidoom and Migium merge back into Pan Arms!');
    this.dropPair(p);
  }

  private dropPair(p: PanPair): void {
    p.reform?.tele.cancel();
    this.group.remove(p.tether);
    p.tether.geometry.dispose();
    p.tether.material.dispose();
    this.pairs.splice(this.pairs.indexOf(p), 1);
  }

  private updatePairs(dt: number): void {
    for (const p of [...this.pairs]) {
      const hidUp = p.hid.alive;
      const migUp = p.mig.alive;
      if (!hidUp && !migUp) {
        this.dropPair(p);
        continue;
      }
      if (hidUp && migUp) {
        p.together += dt;
        const k = Math.min(1, p.together / panCfg.mergeAfter);
        // Tether between the halves brightens as they get ready to merge.
        const a = p.hid.pos;
        const b = p.mig.pos;
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        p.tether.visible = true;
        p.tether.position.set((a.x + b.x) / 2, 1.2, (a.z + b.z) / 2);
        p.tether.quaternion.setFromUnitVectors(UP, new THREE.Vector3(b.x - a.x, 0, b.z - a.z).normalize());
        p.tether.scale.set(1 + k * 2, Math.max(0.01, len), 1 + k * 2);
        p.tether.material.opacity = 0.25 + 0.6 * k + (k > 0.75 ? Math.sin(p.together * 18) * 0.15 : 0);
        if (p.together >= panCfg.mergeAfter) {
          p.hid.mergeTarget = p.mig;
          p.mig.mergeTarget = p.hid;
          if (len < 1.8 || p.together > panCfg.mergeAfter + 6) this.merge(p);
        }
        continue;
      }
      p.tether.visible = false;
      p.together = 0;
      p.hid.mergeTarget = null;
      p.mig.mergeTarget = null;
      // One half down: it re-forms where it fell unless the other dies first.
      const dead = hidUp ? p.mig : p.hid;
      if (dead.vanished) {
        this.dropPair(p);
        continue;
      }
      if (!p.reform) {
        const which = hidUp ? 'mig' : 'hid';
        const x = dead.pos.x;
        const z = dead.pos.z;
        const tele = this.addTelegraph({ kind: 'circle', x, z, radius: 1.4 }, panCfg.reformAfter, () => {
          if (!p.reform) return;
          p.reform = null;
          const type = which === 'hid' ? 'Hidoom' : 'Migium';
          const e = this.spawnEnemy(type, x, z, dead.room, { elite: dead.elite, noReward: true, hp: 1 });
          e.hp = Math.max(1, Math.round(e.maxHp * panCfg.reformHp));
          e.wave = dead.wave;
          if (which === 'hid') p.hid = e;
          else p.mig = e;
          this.hooks.onEvent(`${type} re-forms!`);
        }, 0x6080ff);
        p.reform = { which, tele };
      }
    }
  }

  // ------------------------------------------------------------ update

  /** Threat shares held by live attacks right now. */
  get threatLoad(): number {
    let n = 0;
    for (const e of this.enemies) if (e.alive) n += e.threat;
    return n;
  }

  /** The attack director: grant a share of the threat budget (see `ai`). */
  requestAttackToken(e: Enemy, weight = 1): boolean {
    if (this.sinceWindup < ai.attackStagger) return false;
    // A share bigger than the whole budget still goes out once nothing else is live.
    if (this.threatLoad + weight > Math.max(ai.maxThreat, weight)) return false;
    this.sinceWindup = 0;
    e.threat = weight;
    return true;
  }

  /** Seconds left on each affix area attack warning right now (Hell caps how many overlap). */
  private affixAreas: number[] = [];

  /** Hell: at most `hell.maxAffixAreas` affix area attacks warn at once (Nightmare and Normal: no cap). */
  claimAffixArea(seconds: number): boolean {
    if (!this.run.hell) return true;
    if (this.affixAreas.length >= hellCfg.maxAffixAreas) return false;
    this.affixAreas.push(seconds);
    return true;
  }

  /** Ranged / caster attacks: the same budget, and at most one start per `ai.shotGap` across the room. */
  requestShot(e: Enemy, weight = 1): boolean {
    if (this.sinceShot < ai.shotGap) return false;
    if (!this.requestAttackToken(e, weight)) return false;
    this.sinceShot = 0;
    return true;
  }

  update(dt: number, player: Player): void {
    this.sinceWindup += dt;
    this.sinceShot += dt;
    this.affixAreas = this.affixAreas.map((t) => t - dt).filter((t) => t > 0);
    this.updateRooms(dt, player);

    const ectx = this.hooks.enemyCtx;
    ectx.playerX = player.pos.x;
    ectx.playerZ = player.pos.z;
    ectx.playerAlive = player.alive;
    for (const e of this.enemies) e.update(dt, ectx);
    for (const e of [...this.enemies]) if (e instanceof PanArms && e.wantsSplit && e.alive) this.split(e);
    this.updatePairs(dt);
    this.updateLinks();
    this.updateVolatile();
    this.updateSplitting();
    this.updateShields(player);
    this.updateRegenPulse(dt);
    this.updateMolten(dt);

    if (this.boss) {
      const bctx = this.hooks.bossCtx;
      bctx.playerX = player.pos.x;
      bctx.playerZ = player.pos.z;
      bctx.playerAlive = player.alive;
      this.boss.update(dt, bctx);
      this.boss.collide(player.pos, player.radius, this.level);
      if (this.boss.setLit) {
        const boss = this.boss;
        boss.setLit?.(boss.alive && boss.parts().some((p) => this.pylons.some((q) => q.inside(p.pos.x, p.pos.z, p.radius * 0.5))));
      }
    }

    // Pylon light (and any light the boss leaves): cleanses the player, slows and exposes Dark enemies.
    for (const p of this.pylons) p.update(dt);
    player.inLight = player.alive && this.lightAt(player.pos.x, player.pos.z, player.radius);
    for (const e of this.enemies) e.lit = e.alive && e.race === 'dark' && this.lightAt(e.pos.x, e.pos.z, e.radius * 0.5);

    // Hazards.
    let slow = 1;
    for (const v of this.vents) v.update(dt, player, this.enemies, this.hooks.hazards);
    for (const m of this.machines) m.update(dt, player, this.enemies, this.machineHooks);
    for (let i = this.pools.length - 1; i >= 0; i--) {
      const p = this.pools[i];
      if (p.update(dt, player, this.hooks.hazards) && p.slows) slow = hazardCfg.marshSlow;
      if (p.done) {
        this.group.remove(p.group);
        this.pools.splice(i, 1);
      }
    }
    player.slowMult = slow;

    // Collisions between bodies.
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const we = e.rooted ? 1000 : 1;
      separateCircles(player.pos, player.radius, 1, e.pos, e.radius, we);
      for (const o of this.enemies) {
        if (o.id <= e.id || !o.alive) continue;
        separateCircles(e.pos, e.radius, we, o.pos, o.radius, o.rooted ? 1000 : 1);
      }
      for (const b of this.boxes) if (b.alive) separateCircles(b.pos, b.radius, 1000, e.pos, e.radius, 1);
    }
    for (const b of this.boxes) if (b.alive) separateCircles(b.pos, b.radius, 1000, player.pos, player.radius, 1);
    for (const it of this.interactables) {
      if (isCounter(it.kind)) {
        separateCircles(it.pos, 1.6, 1000, player.pos, player.radius, 1);
      }
    }
    this.level.resolveCircle(player.pos, player.radius);
    for (const e of this.enemies) this.level.resolveCircle(e.pos, e.radius);

    // Corpses and broken boxes.
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (!e.alive && e.deadT > 1.4) {
        this.group.remove(e.group);
        this.enemies.splice(i, 1);
      }
    }
    for (let i = this.boxes.length - 1; i >= 0; i--) {
      const b = this.boxes[i];
      b.update(dt);
      if (b.brokenT > 0.4) {
        this.group.remove(b.group);
        this.boxes.splice(i, 1);
      }
    }

    // Projectiles.
    const hitList = this.hittables();
    const solid = (x: number, z: number) => this.level.isSolidAt(x, z);
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.update(dt, hitList, player.pos, player.radius, solid);
      if (p.dead) {
        this.group.remove(p.mesh);
        this.projectiles.splice(i, 1);
      }
    }

    for (let i = this.telegraphs.length - 1; i >= 0; i--) {
      const t = this.telegraphs[i];
      t.update(dt);
      if (t.done) {
        this.group.remove(t.group);
        this.telegraphs.splice(i, 1);
      }
    }
    for (let i = this.effects.length - 1; i >= 0; i--) {
      if (this.effects[i].update(dt)) continue;
      this.group.remove(this.effects[i].object);
      this.effects.splice(i, 1);
    }

    for (const p of this.pickups) p.update(dt);
    for (const it of this.interactables) it.update(dt);
    this.level.update(dt);
  }

  dispose(): void {
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const m = o.material;
        if (Array.isArray(m)) m.forEach((x) => x.dispose());
        else m.dispose();
      }
    });
  }
}
