import * as THREE from 'three';
import { galGryphon as cfg, hell, player as playerCfg, type HardBossScale } from '../config';
import { separateCircles, turnToward, yawTo } from '../collision';
import type { Hittable } from '../combat/types';
import type { Level, Rect } from '../world/Level';
import { Lob, Pillar, Ring, type Effect } from '../world/Effects';
import { Lightning } from '../world/spellFx';
import type { Cancellable, TelegraphShape } from '../world/Telegraph';
import { GryphonModel } from '../models/gryphon';
import type { BossContext } from './Boss';
import { BossBase } from './BossBase';
import {
  cagePlan, Cyclone, featherSpots, flankOrbs, LightningRods, pulseTimes, ringOrbs, rimSpark, sparkAlong, sparkTouches, SparkField, stormRod,
  stormWalk, type Rod,
} from './gryphonStorm';

// Gal Gryphon, the Rift Map's Circle II pinnacle boss (DESIGN.md "Endgame: Falz Rifts" > "Gal Gryphon"; the user's
// picks from question rounds, 2026-10-21). A storm griffin on Storm Peak. Sparks drift through the arena all fight
// long, one at a time (from the rim, aimed near you; off the Gryphon too from phase 2), so you can't stand still. Its attacks come in pairs
// from the start (a swoop with orbs closing one side, a gale shoving you under a plummet, a plummet ringed by orbs),
// triples in phase 2 (a lash across the swoop, the ring after the gale) and the cage below 1/3 (a Hell triple: three
// telegraphs at once, one way out). Every ~22 s it rises into the clouds and calls the storm: one rod lights under a
// pillar of light and the storm pulses, three times, while feathers rain round you. Step into the pillar at any point
// and the rod grounds it, weak point open; still out of it at the third pulse, the whole summit is struck.

type GryphonState = 'dormant' | 'intro' | 'stalk' | 'attack' | 'recover' | 'storm' | 'stormFall' | 'grounded' | 'stormLand' | 'dead';

type Attack = 'swoopOrbs' | 'galePlummet' | 'plummetRing' | 'crossTriple' | 'galeRing' | 'cyclones' | 'cage';

/** What its body is doing in an attack (the animation). */
type Pose = 'idle' | 'swoopWindup' | 'swoop' | 'gale' | 'orbs' | 'rise' | 'hang' | 'rest' | 'call';

type Pt = [number, number];

const STORM_ALT = 15;
const PLUMMET_ALT = 12;
const BOLT_COLOR = 0x9ae8ff;
const LASH_COLOR = 0xb8f0ff;
const GALE_COLOR = 0xd8ecff;
const FEATHER_COLOR = 0xeaf4ff;
/** The storm's warning over the whole summit. */
const STORM_COLOR = 0x7a8cff;

/** A wing beat's gust: the cone flashes pale and fades. */
class GustFlash implements Effect {
  readonly object: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  private t = 0;

  constructor(x: number, z: number, yaw: number, range: number, arcDeg: number) {
    const half = THREE.MathUtils.degToRad(arcDeg) / 2;
    this.object = new THREE.Mesh(
      new THREE.CircleGeometry(range, 24, Math.PI / 2 - half, half * 2).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: GALE_COLOR, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
    );
    this.object.position.set(x, 0.1, z);
    this.object.rotation.y = yaw + Math.PI;
  }

  update(dt: number): boolean {
    this.t += dt;
    const k = Math.min(1, this.t / 0.45);
    this.object.material.opacity = 0.45 * (1 - k);
    this.object.scale.setScalar(0.85 + 0.25 * k);
    return k < 1;
  }
}

/** A feather falling out of the clouds onto its circle, landing as the warning runs out. */
class FeatherFall implements Effect {
  readonly object = new THREE.Group();
  private t = 0;
  private from: THREE.Vector3;
  private to: THREE.Vector3;

  constructor(x: number, z: number, private seconds: number) {
    this.from = new THREE.Vector3(x + 2, 20, z - 1);
    this.to = new THREE.Vector3(x, 0.4, z);
    const blade = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.04, 2.2),
      new THREE.MeshBasicMaterial({ color: FEATHER_COLOR, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    blade.rotation.x = -1.1;
    this.object.add(blade);
    this.object.position.copy(this.from);
  }

  update(dt: number): boolean {
    this.t += dt;
    const k = Math.min(1, this.t / this.seconds);
    this.object.position.lerpVectors(this.from, this.to, k * k);
    this.object.rotation.y += dt * 9;
    return k < 1;
  }
}

export class GalGryphon extends BossBase<GryphonState, Attack> implements Hittable {
  readonly id = 'gryphon' as const;
  readonly group = new THREE.Group();
  readonly pos = this.group.position;
  readonly radius = cfg.radius;
  yaw = 0;

  private model = new GryphonModel();
  private readonly cx: number;
  private readonly cz: number;
  private readonly rods: LightningRods;
  private readonly sparks = new SparkField();
  private readonly cyclones: Cyclone[] = [];
  private readonly cycloneGroup = new THREE.Group();

  /** Its height off the floor (the model's lift). */
  private alt = 0;
  private lastX = 0;
  private lastZ = 0;
  private walkPhase = NaN;
  private cooldown = 2;
  private phase2 = false;
  private phase3 = false;
  /** Seconds of fight (its clock). */
  private fightT = 0;
  // ---- attacks: the one under way is a list of timed steps (its clock, from the attack's start)
  private pose: Pose = 'idle';
  private steps: { at: number; run: () => void }[] = [];
  private actEnd = 0;
  private recoverFor = 1;
  /** Phase 3 attacks to go before the next cage. */
  private tripleDue = 0;
  /** A swoop in flight: its heading, the distance left, and whether it has hit you. */
  private fly: { yaw: number; left: number; hit: boolean } | null = null;
  /** Where a plummet hangs before it drops. */
  private hangAt: Pt | null = null;
  // ---- the storm
  /** Storms called so far (the one on, while in one). */
  private storms = 0;
  private nextStorm = cfg.stormFirst;
  /** Seconds since it was last back on its feet after a storm. */
  private upT = Infinity;
  private stormT = 0;
  /** Its pulses (boss seconds from the call; the last is the thunderstorm), how many have come, and the summit's warning. */
  private pulseAt: number[] = [];
  private pulsesDone = 0;
  private stormTele: Cancellable | null = null;
  /** The storm's lit rod (its index). */
  private lit = -1;
  private featherT = 0;
  private taught = false;
  private gustT = 0;
  // ---- the sparks
  private sparkT = 1.5;
  private sparkN = 0;

  constructor(room: Rect, hard: HardBossScale | null = null) {
    super(cfg, hard);
    this.cx = (room.minX + room.maxX) / 2;
    this.cz = (room.minZ + room.maxZ) / 2;
    this.pos.set(this.cx, 0, this.cz - cfg.perch);
    this.lastX = this.pos.x;
    this.lastZ = this.pos.z;
    this.group.add(this.model.group);
    this.rods = new LightningRods(this.cx, this.cz);
  }

  // ---------------------------------------------------------------- Boss

  get objects(): THREE.Object3D[] {
    return [this.group, this.rods.group, this.cycloneGroup, this.sparks.group];
  }
  parts(): Hittable[] {
    return [this];
  }

  collide(playerPos: THREE.Vector3, playerRadius: number, level: Level): void {
    // The rods block like tree trunks.
    this.rods.sync(level.trees);
    if (this.alive && this.alt < 2.5) separateCircles(playerPos, playerRadius, 1, this.pos, this.radius, 1000);
    // The summit is round: the cloud sea is all around it.
    this.clampToSummit(playerPos, playerRadius);
    this.clampToSummit(this.pos, this.radius);
    level.resolveCircle(playerPos, playerRadius);
  }

  private clampToSummit(p: THREE.Vector3, r: number): void {
    const dx = p.x - this.cx;
    const dz = p.z - this.cz;
    const d = Math.hypot(dx, dz);
    const max = cfg.arenaRadius - r;
    if (d <= max) return;
    p.x = this.cx + (dx / d) * max;
    p.z = this.cz + (dz / d) * max;
  }

  /** Shown after the name on the boss bar. */
  get hudNote(): string {
    if (this.state === 'storm') return `  — STORM · PULSE ${this.pulsesDone}/${this.pulseAt.length}`;
    if (this.state === 'grounded' || this.state === 'stormFall') return '  — GROUNDED';
    return this.phase3 ? '  — THE STORM BREAKS' : this.phase2 ? '  — EYE OF THE STORM' : '';
  }

  // ------------------------------------------------------------ Hittable

  get aimHeight(): number {
    return this.alt + 3.4;
  }
  /** Up in the clouds (the storm, a plummet's climb) it can't be hit. */
  get invulnerable(): boolean {
    return this.untouchable || this.alt > 5;
  }
  get weakPointOpen(): boolean {
    return this.state === 'grounded';
  }
  damageMult(): number {
    return this.weakPointOpen ? cfg.weakPointMult : 1;
  }
  damage(amount: number): boolean {
    if (!this.alive || this.invulnerable) return false;
    return this.loseHp(amount);
  }

  // ------------------------------------------------------------- update

  protected get anchor(): THREE.Vector3 {
    return this.pos;
  }

  protected whileDead(dt: number): void {
    this.alt = Math.max(0, this.alt - dt * 12);
    this.animate(dt);
  }

  protected always(dt: number, ctx: BossContext): void {
    const on = this.state === 'storm';
    this.rods.update(dt, this.time, on ? this.storms : this.storms + 1, on, on ? this.lit : -1);
    this.rods.seeThrough(dt, ctx.playerX, ctx.playerZ);
    for (const c of this.cyclones) {
      c.update(dt, this.time, ctx.playerX, ctx.playerZ, this.cx, this.cz, cfg.arenaRadius - cfg.cycloneRadius);
      if (!this.alive || c.hitT > 0 || !ctx.playerAlive) continue;
      const shape: TelegraphShape = { kind: 'circle', x: c.x, z: c.z, radius: cfg.cycloneRadius };
      if (ctx.hitPlayer(shape, cfg.cycloneAtp, c.x, c.z, cfg.cycloneKnockback)) c.hitT = cfg.cycloneHitGap;
    }
    for (const c of this.cyclones.filter((c) => c.done || !this.alive)) {
      this.cycloneGroup.remove(c.group);
      this.cyclones.splice(this.cyclones.indexOf(c), 1);
    }
    this.updateSparks(dt, ctx);
  }

  protected onDeath(): void {
    this.sparks.clear();
    this.steps = [];
    this.fly = null;
    for (const c of this.cyclones) c.life = Math.min(c.life, 0.8);
  }

  protected think(dt: number, ctx: BossContext): void {
    const dist = Math.hypot(ctx.playerX - this.pos.x, ctx.playerZ - this.pos.z);
    const toPlayer = yawTo(this.pos.x, this.pos.z, ctx.playerX, ctx.playerZ);
    if (this.engaged && this.state !== 'intro') {
      this.fightT += dt;
      this.upT += dt;
    }
    this.announceEnrage(ctx, true, 'Gal Gryphon is enraged!', 'gryphon.screech');
    if (!this.phase2 && this.hp <= this.maxHp * cfg.phase2At) {
      this.phase2 = true;
      this.escalate(ctx, 'The eye of the storm!');
      ctx.shake(0.5);
      this.sound('gryphon.screech');
    }
    if (!this.phase3 && this.hp <= this.maxHp * cfg.phase3At) {
      this.phase3 = true;
      this.tripleDue = 0;
      this.escalate(ctx, 'The storm breaks loose!');
      ctx.shake(0.6);
      this.sound('gryphon.screech');
    }

    switch (this.state) {
      case 'dormant':
        this.alt = 0;
        if (ctx.playerAlive && dist < 21) this.awaken(ctx, 'GAL GRYPHON', 0.45, 'gryphon.screech');
        break;

      case 'intro':
        this.yaw = turnToward(this.yaw, toPlayer, cfg.turnSpeed * dt);
        if (this.stateT > 2.6) this.enter('stalk');
        break;

      case 'stalk': {
        if (!ctx.playerAlive) break;
        this.yaw = turnToward(this.yaw, toPlayer, cfg.turnSpeed * dt);
        // It keeps its distance: closer than it likes, it backs off; far, it stalks in.
        const want = dist > cfg.keepAway + 2 ? 1 : dist < cfg.keepAway - 2 ? -0.6 : 0;
        this.pos.x += Math.sin(this.yaw) * cfg.walkSpeed * want * dt;
        this.pos.z += Math.cos(this.yaw) * cfg.walkSpeed * want * dt;
        this.alt = Math.max(0, this.alt - dt * 6);
        this.cooldown -= dt;
        if (this.cooldown > 0) break;
        if (this.startStorm(ctx)) break;
        this.chooseAttack(ctx);
        break;
      }

      case 'attack':
        this.runAttack(dt, ctx);
        break;

      case 'storm':
        this.updateStorm(dt, ctx);
        break;

      case 'stormFall':
        // The storm's last bolt drawn knocked it out of the sky: down beside the rod.
        this.alt = Math.max(0, this.alt - dt * 30);
        if (this.alt <= 0) {
          ctx.shake(0.8);
          this.sound('boss.slam');
          ctx.effect(new Ring(this.pos.x, this.pos.z, BOLT_COLOR, 7, 0.5));
          this.sound('boss.weak');
          this.enter('grounded');
        }
        break;

      case 'grounded':
        this.alt = 0;
        if (this.stateT >= cfg.groundedTime) this.backUp(1.2);
        break;

      case 'stormLand':
        // Not every bolt drawn: it comes back down in the middle.
        this.alt = Math.max(0, STORM_ALT * (1 - this.stateT / cfg.stormLand));
        if (this.stateT >= cfg.stormLand) {
          this.alt = 0;
          ctx.shake(0.35);
          this.sound('boss.slam');
          this.backUp(0.8);
        }
        break;

      case 'recover':
        this.alt = Math.max(0, this.alt - dt * 6);
        if (this.stateT >= this.recoverFor) this.enter('stalk');
        break;
    }

    this.group.rotation.y = this.yaw;
    this.animate(dt);
  }

  /** Back on its feet after a storm (grounded or not). */
  private backUp(recover: number): void {
    this.upT = 0;
    this.endAttack(recover);
  }

  private endAttack(recover: number): void {
    this.recoverFor = recover;
    this.cooldown = cfg.attackGap * this.sm();
    this.pose = 'idle';
    this.steps = [];
    this.fly = null;
    this.hangAt = null;
    this.enter('recover');
  }

  // ---------------------------------------------------------- attacks

  /** Run `fn` this many s into the attack under way (its clock); the attack lasts at least that long. */
  private after(delay: number, fn: () => void): void {
    this.steps.push({ at: this.stateT + delay, run: fn });
    this.hold(delay);
  }

  /** The attack under way lasts at least this much longer. */
  private hold(delay: number): void {
    this.actEnd = Math.max(this.actEnd, this.stateT + delay);
  }

  private begin(): void {
    this.enter('attack');
    this.steps = [];
    this.actEnd = 0;
    this.fly = null;
    this.hangAt = null;
  }

  private runAttack(dt: number, ctx: BossContext): void {
    for (const s of this.steps.filter((s) => this.stateT >= s.at)) {
      this.steps.splice(this.steps.indexOf(s), 1);
      if (this.alive) s.run();
    }
    switch (this.pose) {
      case 'rise':
        this.alt = Math.min(PLUMMET_ALT, this.alt + dt * 18);
        break;
      case 'hang':
        this.alt = PLUMMET_ALT;
        if (this.hangAt) {
          this.pos.x += (this.hangAt[0] - this.pos.x) * Math.min(1, dt * 5);
          this.pos.z += (this.hangAt[1] - this.pos.z) * Math.min(1, dt * 5);
        }
        break;
      case 'swoopWindup':
        this.alt = Math.min(2, this.alt + dt * 2);
        break;
      case 'rest':
        this.alt = 0;
        break;
      default:
        this.alt = Math.max(0, this.alt - dt * 6);
    }
    if (this.fly) this.flySwoop(dt, ctx);
    if (!this.steps.length && !this.fly && this.stateT >= this.actEnd) this.endAttack(0.7);
  }

  private chooseAttack(ctx: BossContext): void {
    // Below 1/3 every second attack is the cage.
    if (this.phase3 && this.tripleDue <= 0 && this.cage(ctx)) {
      this.tripleDue = cfg.tripleEvery - 1;
      return;
    }
    this.tripleDue--;
    const pool: Attack[] = !this.phase2
      ? ['swoopOrbs', 'swoopOrbs', 'galePlummet', 'plummetRing']
      : ['crossTriple', 'crossTriple', 'galeRing', ...(this.cyclones.length ? [] : (['cyclones', 'cyclones'] as Attack[]))];
    const pick = this.pickAttack(ctx, pool);
    this.begin();
    switch (pick) {
      case 'swoopOrbs':
      case 'crossTriple':
        this.swoopFlank(ctx, pick === 'crossTriple');
        break;
      case 'galePlummet':
      case 'galeRing':
        this.gale(ctx, () => this.plummet(ctx, pick === 'galeRing'));
        break;
      case 'plummetRing':
        this.plummet(ctx, true);
        break;
      case 'cyclones':
        this.startCyclones(ctx);
        break;
      default:
        this.endAttack(0.5);
    }
  }

  private galeShape(): TelegraphShape {
    return { kind: 'cone', x: this.pos.x + Math.sin(this.yaw) * 1.5, z: this.pos.z + Math.cos(this.yaw) * 1.5, yaw: this.yaw, range: cfg.galeRange, arcDeg: cfg.galeArcDeg };
  }

  /** How far it can fly from (x, z) along `yaw` before the rim (m). */
  private toRim(x: number, z: number, yaw: number, margin: number): number {
    const dx = Math.sin(yaw);
    const dz = Math.cos(yaw);
    const ox = x - this.cx;
    const oz = z - this.cz;
    const R = cfg.arenaRadius - margin;
    const b = ox * dx + oz * dz;
    const c = ox * ox + oz * oz - R * R;
    return Math.max(0, -b + Math.sqrt(Math.max(0, b * b - c)));
  }

  /** A chord of the summit through (x, z) along `yaw`, rim to rim, a swoop's width. */
  private chord(x: number, z: number, yaw: number): TelegraphShape {
    const back = this.toRim(x, z, yaw + Math.PI, 0.5);
    const fwd = this.toRim(x, z, yaw, 0.5);
    return { kind: 'line', x: x - Math.sin(yaw) * back, z: z - Math.cos(yaw) * back, yaw, length: back + fwd, width: cfg.swoopWidth };
  }

  /** Talon Swoop: a lane from it through you to the far rim, warned `windup`; then it flies it. Returns the lane's heading. */
  private swoop(ctx: BossContext, windup: number, dash: boolean): number {
    const yaw = (this.yaw = yawTo(this.pos.x, this.pos.z, ctx.playerX, ctx.playerZ));
    const dist = Math.hypot(ctx.playerX - this.pos.x, ctx.playerZ - this.pos.z);
    const len = Math.max(dist + 4, this.toRim(this.pos.x, this.pos.z, yaw, cfg.radius));
    this.pose = 'swoopWindup';
    this.sound('gryphon.screech');
    this.warn(ctx, { kind: 'line', x: this.pos.x, z: this.pos.z, yaw, length: len, width: cfg.swoopWidth }, windup, undefined, undefined, dash);
    this.after(windup, () => {
      this.fly = { yaw, left: len, hit: false };
      this.pose = 'swoop';
      this.sound('gryphon.dive');
    });
    return yaw;
  }

  private flySwoop(dt: number, ctx: BossContext): void {
    const f = this.fly!;
    const step = Math.min(f.left, cfg.swoopSpeed * dt);
    this.pos.x += Math.sin(f.yaw) * step;
    this.pos.z += Math.cos(f.yaw) * step;
    this.yaw = f.yaw;
    this.alt = 1.3;
    f.left -= step;
    if (!f.hit) {
      const shape: TelegraphShape = { kind: 'circle', x: this.pos.x, z: this.pos.z, radius: cfg.swoopWidth / 2 };
      if (ctx.hitPlayer(shape, cfg.swoopAtp, this.pos.x, this.pos.z, cfg.swoopKnockback)) f.hit = true;
    }
    if (f.left <= 0) {
      this.fly = null;
      this.pose = 'idle';
    }
  }

  /**
   * The swoop paired with orbs closing the lane's side away from the middle of the summit (step out the other way);
   * phase 2's triple adds the crossing lash, `crossDelay` s in, through where you stand (a dash check).
   */
  private swoopFlank(ctx: BossContext, lash: boolean): void {
    const px = ctx.playerX;
    const pz = ctx.playerZ;
    const sm = this.sm();
    const yaw = this.swoop(ctx, cfg.swoopWindup * sm, this.enraged);
    this.orbs(ctx, flankOrbs(px, pz, yaw, this.cx, this.cz).orbs, cfg.orbWindup * sm, false);
    if (lash) this.after(cfg.crossDelay * sm, () => this.lash(ctx, this.chord(ctx.playerX, ctx.playerZ, yaw + (ctx.rng() < 0.5 ? 1 : -1) * (Math.PI / 2)), cfg.crossWindup * sm));
  }

  /** The lash: a lightning lane across the summit, warned `windup` (a dash check), then a sheet of lightning down it. */
  private lash(ctx: BossContext, lane: TelegraphShape, windup: number): void {
    if (lane.kind !== 'line') return;
    this.sound('gryphon.thunder', ctx.playerX, ctx.playerZ);
    this.warn(ctx, lane, windup, LASH_COLOR, () => {
      if (!this.alive) return;
      ctx.hitPlayer(lane, cfg.swoopAtp, ctx.playerX, ctx.playerZ, 8);
      const n = Math.max(2, Math.round(lane.length / 6));
      for (let i = 0; i < n; i++) {
        const k = (i + 0.5) / n;
        const x = lane.x + Math.sin(lane.yaw) * lane.length * k;
        const z = lane.z + Math.cos(lane.yaw) * lane.length * k;
        ctx.effect(new Lightning(new THREE.Vector3(x, 14, z), new THREE.Vector3(x, 0.1, z), LASH_COLOR, 0.35, 1.6));
      }
      ctx.effect(new Lightning(new THREE.Vector3(lane.x, 0.6, lane.z), new THREE.Vector3(lane.x + Math.sin(lane.yaw) * lane.length, 0.6, lane.z + Math.cos(lane.yaw) * lane.length), LASH_COLOR, 0.4, 2.2, 0.5));
      ctx.shake(0.35);
      this.sound('gryphon.thunder', ctx.playerX, ctx.playerZ);
    }, true);
    this.hold(windup);
  }

  /** Thunder orbs on these spots, lobbed from its beak, bursting after `windup` (`dashFirst`: the first one is a dash check). */
  private orbs(ctx: BossContext, spots: Pt[], windup: number, dashFirst: boolean): void {
    const beak = new THREE.Vector3(this.pos.x + Math.sin(this.yaw) * 2.5, this.alt + 4.4, this.pos.z + Math.cos(this.yaw) * 2.5);
    spots.forEach(([x, z], i) => {
      const shape: TelegraphShape = { kind: 'circle', x, z, radius: cfg.orbRadius };
      ctx.effect(new Lob(beak, x, z, windup / this.tempo, BOLT_COLOR, 0.45));
      this.warn(ctx, shape, windup, BOLT_COLOR, () => {
        if (!this.alive) return;
        ctx.hitPlayer(shape, cfg.orbAtp, x, z, 6);
        ctx.effect(new Pillar(x, z, BOLT_COLOR, 0.3, 0.5, 9));
        ctx.effect(new Ring(x, z, BOLT_COLOR, cfg.orbRadius * 1.2, 0.35));
        this.sound('gryphon.thunder', x, z);
      }, dashFirst && i === 0);
    });
    this.hold(windup);
  }

  /** Gale Wing: a cone at you shoving you away; `then` runs as it lands (the plummet comes down where it threw you). */
  private gale(ctx: BossContext, then?: () => void): void {
    const windup = cfg.galeWindup * this.sm();
    this.yaw = yawTo(this.pos.x, this.pos.z, ctx.playerX, ctx.playerZ);
    this.pose = 'gale';
    this.sound('gryphon.flap');
    const shape = this.galeShape();
    // Enraged its windup is too short to walk out of: the dash cue (like the Dragon's enraged stomp).
    this.warn(ctx, shape, windup, GALE_COLOR, undefined, this.enraged);
    this.after(windup, () => {
      ctx.hitPlayer(shape, cfg.galeAtp, this.pos.x, this.pos.z, cfg.galeKnockback);
      ctx.effect(new GustFlash(shape.x, shape.z, this.yaw, cfg.galeRange, cfg.galeArcDeg));
      ctx.shake(0.25);
      this.sound('gryphon.flap');
      this.pose = 'idle';
      then?.();
    });
  }

  /**
   * Plummet: up into the air, then a circle on you that it drops onto (a walk since 2026-10-22: smaller and slower);
   * `ring`: orbs round the circle with one gap, toward the middle of the summit, to get out through. The enrage never
   * cuts its windup.
   */
  private plummet(ctx: BossContext, ring: boolean): void {
    this.pose = 'rise';
    this.sound('gryphon.flap');
    this.after(cfg.plummetRise, () => {
      const x = ctx.playerX;
      const z = ctx.playerZ;
      const shape: TelegraphShape = { kind: 'circle', x, z, radius: cfg.plummetRadius };
      this.hangAt = [x, z];
      this.pose = 'hang';
      this.sound('gryphon.screech');
      this.warn(ctx, shape, cfg.plummetWindup, undefined, () => {
        if (!this.alive) return;
        this.pos.set(x, 0, z);
        this.alt = 0;
        this.hangAt = null;
        ctx.hitPlayer(shape, cfg.plummetAtp, x, z, cfg.plummetKnockback);
        ctx.shake(0.6);
        ctx.effect(new Ring(x, z, 0xffffff, cfg.plummetRadius * 1.1, 0.45));
        this.sound('boss.slam');
        this.pose = 'rest';
        this.hold(cfg.plummetRest);
      });
      if (ring) this.orbs(ctx, ringOrbs(x, z, this.cx, this.cz, ctx.rng).orbs, cfg.plummetWindup, false);
      this.hold(cfg.plummetWindup + cfg.plummetRest);
    });
  }

  /** Phase 2: two tornadoes rise at the rim, well away from you. */
  private startCyclones(ctx: BossContext): void {
    this.pose = 'call';
    this.sound('gryphon.cyclone');
    const rim = cfg.arenaRadius - cfg.cycloneRadius - 1;
    const pa = Math.atan2(ctx.playerX - this.cx, ctx.playerZ - this.cz);
    for (let i = 0; i < cfg.cycloneCount; i++) {
      const a = pa + Math.PI + (i - (cfg.cycloneCount - 1) / 2) * 1.6 + (ctx.rng() - 0.5) * 0.4;
      const c = new Cyclone(this.cx + Math.sin(a) * rim, this.cz + Math.cos(a) * rim, a + Math.PI);
      this.cyclones.push(c);
      this.cycloneGroup.add(c.group);
    }
    this.hold(1.0);
  }

  /**
   * Below 1/3, the cage (a Hell triple): the swoop's lane through you, the lash across it through you, and orbs in three
   * of the four corners they leave, all warned together (`cageWindup`, never cut by the enrage). The one way out is
   * the fourth corner. False if no corner's pocket lies on the summit (a normal attack then).
   */
  private cage(ctx: BossContext): boolean {
    const px = ctx.playerX;
    const pz = ctx.playerZ;
    const yaw = yawTo(this.pos.x, this.pos.z, px, pz);
    const plan = cagePlan(px, pz, yaw, this.cx, this.cz, cfg.arenaRadius - playerCfg.radius - 0.5);
    if (!plan) return false;
    this.lastAttack = 'cage';
    this.begin();
    this.swoop(ctx, cfg.cageWindup, false);
    this.lash(ctx, this.chord(px, pz, plan.lashYaw), cfg.cageWindup);
    this.orbs(ctx, plan.orbs, cfg.cageWindup, false);
    return true;
  }

  // ---------------------------------------------------------- the sparks

  /**
   * All fight long (not before it wakes, nor once it is dead), one spark at a time: every `sparkEvery` s (faster in
   * phase 2 and below 1/3) one from a random point past the rim aimed near you; from phase 2 every `sparkFromBoss`-th
   * one comes out of the Gryphon (out of the middle of the sky while it is up there) in a random direction. A spark
   * that touches you is a light hit and is gone.
   */
  private updateSparks(dt: number, ctx: BossContext): void {
    const fighting = this.alive && this.state !== 'dormant' && this.state !== 'intro';
    if (fighting && ctx.playerAlive) {
      this.sparkT -= dt;
      while (this.sparkT <= 0) {
        this.sparkT += this.phase3 ? cfg.sparkEvery3 : this.phase2 ? cfg.sparkEvery2 : cfg.sparkEvery;
        this.sparkN++;
        if (this.phase2 && this.sparkN % cfg.sparkFromBoss === 0) {
          const up = this.alt > 5;
          this.sparks.add([sparkAlong(up ? this.cx : this.pos.x, up ? this.cz : this.pos.z, ctx.rng() * Math.PI * 2)]);
        } else {
          this.sparks.add([rimSpark(this.cx, this.cz, ctx.playerX, ctx.playerZ, ctx.rng)]);
        }
      }
    }
    const pr = playerCfg.radius;
    this.sparks.update(dt, this.time, this.cx, this.cz, cfg.arenaRadius, (s) => {
      if (!fighting || !ctx.playerAlive || !sparkTouches(s, ctx.playerX, ctx.playerZ, pr)) return true;
      return !ctx.hitPlayer({ kind: 'circle', x: s.x, z: s.z, radius: cfg.sparkRadius }, cfg.sparkAtp, s.x, s.z, 0);
    });
  }

  // ---------------------------------------------------------- the storm

  /**
   * The storm, when it's due: not sooner than `stormAfterUp` s after the last one ended. It lights one usable rod
   * whose pillar you can walk to before the last pulse, at random among them (never the one you stand by while another
   * is in reach); with none in reach it waits (a scorched rod can leave the rim behind it far from the rest).
   */
  private startStorm(ctx: BossContext): boolean {
    if (this.fightT < this.nextStorm || this.upT < cfg.stormAfterUp) return false;
    const storm = this.storms + 1;
    const lit = stormRod(this.rods.list, ctx.playerX, ctx.playerZ, storm, stormWalk(this.tempo), ctx.rng);
    if (lit < 0) return false;
    this.storms = storm;
    this.nextStorm = this.fightT + cfg.stormEvery;
    this.stormT = 0;
    this.pulseAt = pulseTimes(this.tempo);
    this.pulsesDone = 0;
    this.gustT = 0;
    this.featherT = 0.6;
    for (const r of this.rods.list) r.charge = 0;
    this.lit = lit;
    this.pose = 'idle';
    this.steps = [];
    // The whole summit, warned until the last pulse (the lit pillar is the way out).
    const shape: TelegraphShape = { kind: 'circle', x: this.cx, z: this.cz, radius: cfg.arenaRadius + 0.5 };
    this.stormTele = this.tele.add(ctx.telegraph(shape, this.pulseAt[this.pulseAt.length - 1], () => {}, STORM_COLOR));
    this.enter('storm');
    this.sound('gryphon.screech');
    ctx.shake(0.3);
    if (!this.taught) {
      this.taught = true;
      ctx.announce('Gal Gryphon calls the storm: step into the pillar of light!');
    }
    return true;
  }

  private get litRod(): Rod | null {
    return this.lit >= 0 ? this.rods.list[this.lit] : null;
  }

  /** You stand in the lit rod's pillar. */
  private inPillar(ctx: BossContext): boolean {
    const rod = this.litRod;
    return !!rod && ctx.playerAlive && Math.hypot(rod.x - ctx.playerX, rod.z - ctx.playerZ) <= cfg.rodReach;
  }

  private updateStorm(dt: number, ctx: BossContext): void {
    this.stormT += dt;
    // Up into the clouds over the middle.
    this.alt = Math.min(STORM_ALT, this.alt + dt * 14);
    this.pos.x += (this.cx - this.pos.x) * Math.min(1, dt * 1.5);
    this.pos.z += (this.cz - this.pos.z) * Math.min(1, dt * 1.5);
    const rod = this.litRod;
    // Into the pillar at any point: the pulses stop and the rod discharges into it.
    if (rod && this.inPillar(ctx)) {
      this.discharge(rod, ctx);
      return;
    }
    // Phase 2: a gale off the middle (walk into it to reach the pillar).
    if (this.phase2 && ctx.playerAlive) {
      const body = ctx.body();
      const dx = body.pos.x - this.cx;
      const dz = body.pos.z - this.cz;
      const d = Math.hypot(dx, dz) || 1;
      body.pos.x += (dx / d) * cfg.galePush * dt;
      body.pos.z += (dz / d) * cfg.galePush * dt;
      this.gustT -= dt;
      if (this.gustT <= 0) {
        this.gustT = 0.6;
        ctx.effect(new Ring(this.cx, this.cz, GALE_COLOR, cfg.arenaRadius, 1.1, 0.25));
      }
    }
    // Feathers rain round you all storm.
    this.featherT -= dt;
    if (this.featherT <= 0 && ctx.playerAlive) {
      this.featherT += cfg.featherEvery;
      this.featherRain(ctx, rod);
    }
    if (this.stormT < this.pulseAt[this.pulsesDone]) return;
    this.pulsesDone++;
    if (this.pulsesDone < this.pulseAt.length) this.pulse(ctx, rod);
    else this.thunderstorm(ctx);
  }

  /** A pulse that does nothing yet: a thunderclap over the summit, a bolt into the lit rod and one more coil lit. */
  private pulse(ctx: BossContext, rod: Rod | null): void {
    ctx.effect(new Ring(this.cx, this.cz, STORM_COLOR, cfg.arenaRadius, 0.6, 0.45));
    ctx.shake(0.3);
    this.sound('gryphon.thunder', this.cx, this.cz);
    if (!rod) return;
    ctx.effect(new Lightning(new THREE.Vector3(rod.x + 3, 24, rod.z - 2), rod.top(), BOLT_COLOR, 0.35, 2.4));
    rod.struck(this.pulsesDone);
    this.sound('gryphon.rod', rod.x, rod.z, this.pulsesDone);
  }

  /** The last pulse with you out of the pillar: lightning strikes the whole summit (a failed mechanic). */
  private thunderstorm(ctx: BossContext): void {
    const rng = ctx.rng;
    for (let i = 0; i < 14; i++) {
      const a = rng() * Math.PI * 2;
      const r = Math.sqrt(rng()) * cfg.arenaRadius;
      const x = this.cx + Math.sin(a) * r;
      const z = this.cz + Math.cos(a) * r;
      ctx.effect(new Lightning(new THREE.Vector3(x + (rng() - 0.5) * 6, 24, z + (rng() - 0.5) * 6), new THREE.Vector3(x, 0.2, z), BOLT_COLOR, 0.4, 2.2));
    }
    ctx.effect(new Lightning(new THREE.Vector3(ctx.playerX + 2, 24, ctx.playerZ - 1), new THREE.Vector3(ctx.playerX, 0.2, ctx.playerZ), 0xffffff, 0.45, 3));
    ctx.effect(new Ring(this.cx, this.cz, 0xffffff, cfg.arenaRadius * 1.1, 0.5, 0.7));
    ctx.shake(0.9);
    this.sound('gryphon.ground');
    this.sound('gryphon.thunder', ctx.playerX, ctx.playerZ);
    if (ctx.playerAlive) ctx.mechanicHit(hell.mechanicHit, this.cx, this.cz, 6, 'Thunderstorm');
    this.lit = -1;
    this.enter('stormLand');
  }

  /** Two feathers fall round you: one by you (step toward the lit rod), one farther off. */
  private featherRain(ctx: BossContext, rod: Rod | null): void {
    const [a, b] = featherSpots(ctx.playerX, ctx.playerZ, rod?.x ?? this.cx, rod?.z ?? this.cz, ctx.rng);
    for (const [x, z] of [a, b]) {
      const shape: TelegraphShape = { kind: 'circle', x, z, radius: cfg.featherRadius };
      ctx.effect(new FeatherFall(x, z, cfg.featherWindup / this.tempo));
      this.warn(ctx, shape, cfg.featherWindup, FEATHER_COLOR, () => {
        if (!this.alive) return;
        ctx.hitPlayer(shape, cfg.featherAtp, x, z, 3);
        ctx.effect(new Ring(x, z, FEATHER_COLOR, cfg.featherRadius * 1.1, 0.3));
      });
    }
  }

  /** You reached the pillar: the rod arcs into the Gryphon, which crashes beside it, grounded, weak point open. */
  private discharge(rod: Rod, ctx: BossContext): void {
    this.stormTele?.cancel();
    this.stormTele = null;
    rod.discharge(this.storms);
    this.lit = -1;
    const sky = new THREE.Vector3(this.pos.x, this.alt + 3, this.pos.z);
    ctx.effect(new Lightning(rod.top(), sky, 0xffffff, 0.6, 3.2));
    ctx.effect(new Lightning(rod.top(), sky, BOLT_COLOR, 0.5, 2));
    ctx.effect(new Ring(rod.x, rod.z, BOLT_COLOR, cfg.rodReach * 1.2, 0.45));
    // Down beside the rod, on its spoke toward the middle.
    const dx = this.cx - rod.x;
    const dz = this.cz - rod.z;
    const d = Math.hypot(dx, dz) || 1;
    this.pos.set(rod.x + (dx / d) * cfg.rodLand, 0, rod.z + (dz / d) * cfg.rodLand);
    this.yaw = yawTo(this.pos.x, this.pos.z, rod.x, rod.z);
    ctx.shake(0.6);
    this.sound('gryphon.ground');
    ctx.announce('Grounded! Weak point exposed!');
    this.enter('stormFall');
  }

  // ---------------------------------------------------------- animation

  private animate(dt: number): void {
    const t = this.time;
    const moved = Math.hypot(this.pos.x - this.lastX, this.pos.z - this.lastZ);
    this.lastX = this.pos.x;
    this.lastZ = this.pos.z;
    const onFoot = this.alt < 0.2 && (this.state === 'stalk' || this.state === 'recover');
    if (moved > 0.001 && dt > 0 && onFoot) {
      const before = Number.isNaN(this.walkPhase) ? 0 : this.walkPhase;
      this.walkPhase = before + (moved / 2.6) * Math.PI * 2;
      if (Math.floor(this.walkPhase / Math.PI) !== Math.floor(before / Math.PI) && this.alive) this.sound('boss.step');
    } else this.walkPhase = NaN;

    // Folded on foot, spread and beating in the air.
    const airborne = this.alt > 0.3;
    let spread = airborne ? 1 : 0.25;
    let flap = airborne ? Math.sin(t * 7) * 0.5 : 0.1 + Math.sin(t * 1.5) * 0.05;
    let pitch = 0;
    let roll = 0;
    let neck = 0;
    let beak = 0;
    let tuck = Math.min(1, this.alt / 2);
    let veins = this.phase3 ? 0.7 : this.phase2 ? 0.45 : 0.2;
    let weak = 0;
    const pose = this.state === 'attack' ? this.pose : 'idle';
    if (this.state === 'intro') {
      spread = Math.min(1, this.stateT / 0.8);
      flap = Math.sin(t * 9) * 0.6 * spread;
      neck = -0.6;
      beak = this.stateT < 1.4 ? 1 : 0.2;
      veins = 0.8;
    } else if (this.state === 'storm') {
      spread = 1;
      flap = Math.sin(t * 5) * 0.55;
      neck = -0.4;
      beak = 0.6;
      veins = 1;
    } else if (this.state === 'stormFall') {
      spread = 0.6;
      flap = 0.8;
      pitch = 0.7;
      roll = 0.5;
      veins = 1;
    } else if (this.state === 'grounded') {
      // Sprawled beside the rod, wings dropped, veins dead, weak point aglow.
      spread = 0.75;
      flap = -0.35;
      pitch = 0.25;
      roll = 0.25 * Math.sin(t * 1.1);
      neck = 0.9;
      beak = 0.3;
      veins = 0;
      weak = 0.4 + Math.sin(t * 8) * 0.18;
    } else if (this.state === 'stormLand') {
      spread = 1;
      flap = Math.sin(t * 8) * 0.6;
      veins = 0.6;
    } else if (this.state === 'dead') {
      spread = 0.7;
      flap = -0.5;
      pitch = Math.min(0.5, this.deadT * 0.4);
      roll = Math.min(0.9, this.deadT * 0.6);
      neck = Math.min(1, this.deadT);
      beak = 0.4;
      veins = 0;
      tuck = 0;
    }
    switch (pose) {
      case 'swoopWindup':
        spread = 1;
        flap = 0.7;
        pitch = -0.2;
        neck = -0.3;
        beak = 0.6;
        break;
      case 'swoop':
        spread = 0.85;
        flap = -0.15;
        pitch = 0.35;
        neck = 0.25;
        beak = 1;
        tuck = 1;
        veins = 0.7;
        break;
      case 'gale':
        spread = 1;
        flap = 0.9;
        pitch = -0.15;
        neck = -0.2;
        break;
      case 'orbs':
        neck = 0.2;
        beak = 1;
        veins = 0.9;
        spread = 0.6;
        break;
      case 'rise':
      case 'hang':
        spread = 1;
        flap = Math.sin(t * 10) * 0.6;
        pitch = pose === 'hang' ? 0.5 : -0.2;
        neck = 0.4;
        tuck = 1;
        break;
      case 'rest':
        spread = 0.8;
        flap = -0.3;
        pitch = 0.2;
        neck = 0.5;
        break;
      case 'call':
        spread = 1;
        flap = Math.sin(t * 12) * 0.8;
        neck = -0.5;
        beak = 1;
        veins = 0.7;
        break;
    }
    if (this.enraged && this.alive) veins = Math.max(veins, 0.6 + 0.3 * Math.sin(t * 6));
    this.model.pose({
      lift: this.alt, pitch, roll, flap, spread, neck, beak, tuck, veins, weak,
      flash: this.flashT > 0, enraged: this.enraged, walk: this.walkPhase, time: t,
    });
  }
}
