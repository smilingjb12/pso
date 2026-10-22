import * as THREE from 'three';
import { barbaRay as cfg, player as playerCfg, type HardBossScale } from '../config';
import { separateCircles, turnToward, yawTo } from '../collision';
import type { Hittable } from '../combat/types';
import type { Level, Rect } from '../world/Level';
import { Lob, Pillar, Ring } from '../world/Effects';
import { inShape, type TelegraphShape } from '../world/Telegraph';
import { BarbaRayModel } from '../models/barbaRay';
import type { BossContext } from './Boss';
import { BossBase } from './BossBase';
import type { TelegraphHandle } from './Enemy';
import {
  clutchSpots, CurrentStream, dartLane, DeepSea, EggSac, InkPools, inInk, pigTouches, platformAt, Platforms, PigRays, rippleBands, sinkPick,
  spoutLine, startVents, surgeAlong, SurgeWall, tickVents, toCircle, UlRay, ventAt, Vents, Water,
} from './barbaTide';

// Barba Ray, the Rift Map's second Circle II pinnacle boss (DESIGN.md "Endgame: Falz Rifts" > "Barba Ray"). A giant
// manta over a marble temple court in the open sea, fought in three phases like Dark Falz's forms (redesigned
// 2026-10-22: the first draft was a bullet hell with an alternating flood, too like the Gryphon). Damage past a phase's
// threshold is lost, and it can't be hurt while the next one comes in.
// 1. The Brood (100-65%): on the dry court it glides through you and belly-crashes (ripples out from the crash), and
//    lays clutches of Pig Ray eggs: break them all before they hatch and it drops, stunned; hatched ones loose Pig Rays.
//    Each egg broken but the last brings its fury down on you (a fast glide, then waves of circles), and the court's
//    two water channels erupt in turn.
// 2. High Tide (65-30%): "The tide comes in!", and the sea covers the court for good. Off the platforms the water
//    hurts and slows; they sink and rise in turn. It swims under the sea round the court and surfaces at the rim to skim
//    across or send spouts; its surges roll across the whole court (a platform keeps you out of them), and it rides each
//    one in and beaches. Ul Rays hunt in the water.
// 3. The Deep (30-0%): it drags the court under. Your air runs down; bubbling vents (two at a time, moving on) refill
//    it. It dives at you and sticks in the floor, sweeps its tail, and beats a current at you from over a vent. Its ink
//    marks you: when the mark runs out a pool of ink spreads where you stand, hurting, and smothering any vent under it.

type RayState =
  | 'dormant' | 'intro'
  // the Brood (and the Deep: stalk / attack / recover)
  | 'stalk' | 'attack' | 'recover' | 'lay' | 'stunned'
  // High Tide
  | 'tide' | 'swim' | 'surge' | 'land' | 'beached' | 'return'
  // the Deep
  | 'deep' | 'stuck'
  | 'dead';

type Attack = 'glide' | 'crash' | 'skim' | 'spouts' | 'dive' | 'sweep' | 'current';

/** What its body is doing in an attack (the animation). */
type Pose = 'idle' | 'glideWindup' | 'glide' | 'spout' | 'slam' | 'rise' | 'hang' | 'rest' | 'approach';

type Pt = [number, number];

const CRASH_ALT = 9;
/** Under the sea in High Tide it swims this deep, and surfaces at the rim this high to attack. */
const SWIM_ALT = -1.5;
const SURFACE_ALT = 0.5;
/** A clutch's eggs fly this long (its clock) from its mouth to where they land. */
const LOB = 0.9;
const WATER_COLOR = 0x3aa8f0;
const SPOUT_COLOR = 0x8ad8ff;
const RIPPLE_COLOR = 0x6ac8ff;
// The lanes in strong colours: hot pink reads on the white marble and the water alike, amber against the blue water
// (the rays themselves are a paler rose and teal).
const PIG_COLOR = 0xff2a8c;
const UL_COLOR = 0xffb21a;
const SINK_COLOR = 0xff6a4a;
const EGG_COLOR = 0xf08ab4;
const CURRENT_COLOR = 0x9ff0ff;

export class BarbaRay extends BossBase<RayState, Attack> implements Hittable {
  readonly id = 'barba' as const;
  readonly group = new THREE.Group();
  readonly pos = this.group.position;
  readonly radius = cfg.radius;
  yaw = Math.PI;

  private model = new BarbaRayModel();
  private readonly cx: number;
  private readonly cz: number;
  readonly platforms: Platforms;
  readonly water: Water;
  readonly vents: Vents;
  private readonly deepSea: DeepSea;
  private readonly wall = new SurgeWall();
  private readonly pigs = new PigRays();
  private readonly ulGroup = new THREE.Group();
  private readonly sacGroup = new THREE.Group();
  readonly uls: UlRay[] = [];
  /** Every egg sac still on show (bursting ones too). */
  readonly sacs: EggSac[] = [];

  /** 1 the Brood, 2 High Tide, 3 the Deep. */
  phase: 1 | 2 | 3 = 1;
  /** Its height off the floor (below 0: under the sea). */
  alt: number = cfg.hover;
  private wave = 0;
  private cooldown = 2;
  /** Seconds of fight, and of this phase (its clock). */
  private fightT = 0;
  private phaseT = 0;
  // ---- attacks: the one under way is a list of timed steps (its clock, from the attack's start)
  private pose: Pose = 'idle';
  private steps: { at: number; run: () => void }[] = [];
  private actEnd = 0;
  private recoverFor = 1;
  /** A glide in flight: its heading, the distance left, and whether it has hit you. */
  private fly: { yaw: number; left: number; hit: boolean } | null = null;
  /** Where a belly crash or dive hangs before it drops, or where it swims to before a sweep or a current. */
  private hangAt: Pt | null = null;
  private taught = new Set<string>();
  // ---- the Brood
  clutches = 0;
  /** The clutch on the court (its sacs), and whether it is still live (none broken or hatched yet for all). */
  private clutch: EggSac[] = [];
  private clutchLive = false;
  private laid = false;
  private nextClutch = cfg.clutchFirst;
  private hatchTele = new Map<EggSac, TelegraphHandle>();
  /** Pig Rays owed by hatched sacs: when (fight clock) and where from. */
  private dartsDue: { at: number; x: number; z: number }[] = [];
  /** Mother's fury owed: eggs broken (not the last of a clutch) it hasn't come at you for yet. */
  private furies = 0;
  /** The tide channels: when the next erupts (fight clock), and which ring it is (inner first). */
  private nextChannel = cfg.channelFirst;
  private channels = 0;
  // ---- High Tide
  /** Its spot round the court in the sea (radians from the middle), and which way it leans toward you. */
  private swimAng = 0;
  private swimSide = 0.5;
  private nextSurge = 0;
  private sinkT = 0;
  /** When (fight clock) the next Ul Rays rise to replace dead ones. */
  private ulDue: number[] = [];
  private surge: { x: number; z: number; yaw: number; s: number; passed: boolean; rode: boolean } | null = null;
  private landFrom: Pt | null = null;
  private beachAt: Pt | null = null;
  private diveAt: Pt | null = null;
  // ---- the Deep
  /** Your air (real seconds). */
  airLeft = cfg.airMax;
  /** 0 .. 1: the court gone under (the look, and the world's fog and light). */
  private deepK = 0;
  private current: { shape: TelegraphShape; yaw: number; t: number } | null = null;
  /** The ink mark on you (seconds left, its clock; 0: none), when the next comes (phase clock), and the pools down. */
  private inkT = 0;
  private nextInk = cfg.inkFirst;
  readonly inkPools = new InkPools();
  /** Your share of max HP the ink has taken but not shown yet. */
  private inked = 0;
  /** Your share of max HP the water (or the lack of air) has taken but not shown yet, and where your body was last frame. */
  private drowned = 0;
  private lastBody: Pt | null = null;

  constructor(room: Rect, hard: HardBossScale | null = null) {
    super(cfg, hard);
    this.cx = (room.minX + room.maxX) / 2;
    this.cz = (room.minZ + room.maxZ) / 2;
    this.pos.set(this.cx, 0, this.cz - cfg.perch);
    this.group.add(this.model.group);
    this.platforms = new Platforms(this.cx, this.cz);
    this.water = new Water(this.cx, this.cz);
    this.vents = new Vents(this.cx, this.cz);
    this.deepSea = new DeepSea(this.cx, this.cz);
  }

  // ---------------------------------------------------------------- Boss

  get objects(): THREE.Object3D[] {
    return [this.group, this.platforms.group, this.water.group, this.pigs.group, this.ulGroup, this.sacGroup, this.vents.group, this.deepSea.group, this.wall.group, this.inkPools.group];
  }
  /** Itself (unless under the sea), the sacs on the court and the Ul Rays in the water. */
  parts(): Hittable[] {
    const out: Hittable[] = this.submerged ? [] : [this];
    for (const s of this.sacs) if (s.alive && s.landed) out.push(s);
    for (const u of this.uls) if (u.alive) out.push(u);
    return out;
  }

  collide(playerPos: THREE.Vector3, playerRadius: number, level: Level): void {
    if (this.alive && !this.submerged && this.alt < 2.6) separateCircles(playerPos, playerRadius, 1, this.pos, this.radius, 1000);
    // The court is round, with the sea all round it (where it swims in High Tide).
    this.clampToCourt(playerPos, playerRadius);
    if (!this.submerged && this.phase !== 2) this.clampToCourt(this.pos, this.radius);
    level.resolveCircle(playerPos, playerRadius);
  }

  private clampToCourt(p: THREE.Vector3, r: number): void {
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
    switch (this.state) {
      case 'tide':
        return '  — THE TIDE COMES IN';
      case 'deep':
        return '  — INTO THE DEEP';
      case 'stunned':
        return '  — STUNNED';
      case 'beached':
        return '  — BEACHED';
      case 'stuck':
        return '  — STUCK';
      case 'surge':
        return '  — SURGE';
    }
    if (this.phase === 1) {
      const left = this.clutch.filter((s) => s.alive).length;
      return `  — THE BROOD${this.clutchLive && left ? ` · ${left} EGG${left > 1 ? 'S' : ''}` : ''}`;
    }
    return this.phase === 2 ? '  — HIGH TIDE' : '  — THE DEEP';
  }

  /** Your air (0..1) in the Deep (the HUD's AIR gauge), else null. */
  get air(): number | null {
    return this.alive && this.phase === 3 ? this.airLeft / cfg.airMax : null;
  }
  /** How far under the sea the fight has gone (0..1): the world's fog and light follow it. */
  get depth(): number {
    return this.deepK;
  }
  /** The ink mark on you (shown over your head), in real seconds. */
  get marks(): { key: string; left: number; total: number }[] {
    return this.alive && this.inkT > 0 ? [{ key: 'ink', left: this.inkT / this.tempo, total: cfg.inkMark / this.tempo }] : [];
  }

  // ------------------------------------------------------------ Hittable

  /** Under the sea (diving in for High Tide, swimming round the court): it can't be hit, and it doesn't block. */
  get submerged(): boolean {
    if (this.state === 'tide') return this.stateT > 0.8;
    return this.state === 'swim' || this.alt < -0.4;
  }
  get aimHeight(): number {
    return this.alt + 1.2;
  }
  get invulnerable(): boolean {
    return this.untouchable || this.submerged || this.state === 'tide' || this.state === 'deep' || this.alt > 5;
  }
  get weakPointOpen(): boolean {
    return this.state === 'stunned' || this.state === 'beached' || this.state === 'stuck';
  }
  damageMult(): number {
    return this.weakPointOpen ? cfg.weakPointMult : 1;
  }
  damage(amount: number): boolean {
    if (!this.alive || this.invulnerable) return false;
    // A phase can't be skipped: damage past its threshold is lost, and the next one comes in.
    const floor = this.phase === 1 ? this.maxHp * cfg.phase2At - 1 : this.phase === 2 ? this.maxHp * cfg.phase3At - 1 : -Infinity;
    return this.loseHp(amount, floor);
  }

  // ------------------------------------------------------------- update

  protected get anchor(): THREE.Vector3 {
    return this.pos;
  }

  /** Its height between attacks in each phase. */
  private get baseAlt(): number {
    return this.phase === 1 ? cfg.hover : this.phase === 2 ? SURFACE_ALT : cfg.deepHover;
  }

  protected whileDead(dt: number): void {
    this.alt = Math.max(0, this.alt - dt * 3);
    this.animate(dt);
  }

  protected always(dt: number, ctx: BossContext): void {
    const alive = this.alive;
    const tide = alive && (
      (this.phase === 2 && this.state !== 'deep') || (this.state === 'tide' && this.stateT > 0.8) || (this.state === 'deep' && this.stateT < cfg.deepTime * 0.6)
    );
    const deep = !alive ? 0 : this.phase === 3 ? 1 : this.state === 'deep' ? Math.min(1, this.stateT / cfg.deepTime) : 0;
    this.deepK += (deep - this.deepK) * Math.min(1, dt * (alive ? 4 : 0.8));
    if (this.deepK < 0.002 && deep === 0) this.deepK = 0;
    this.platforms.update(dt, this.time, tide);
    this.water.update(dt, this.time, tide ? 1 : 0, alive && this.state === 'deep');
    this.vents.update(dt, this.time, alive && this.phase === 3);
    this.deepSea.update(this.time, this.deepK);
    this.inkPools.update(dt);
    this.updateSacs(dt);
    this.updatePigs(dt, ctx);
    this.updateUls(dt, ctx);
  }

  protected onDeath(): void {
    this.pigs.clear();
    this.dartsDue = [];
    for (const u of this.uls) u.sink();
    for (const s of this.sacs) if (s.alive) s.hp = 0;
    for (const p of this.platforms.list) p.rise();
    this.surge = null;
    this.wall.place(null, this.time);
    this.current = null;
    this.inkT = 0;
    this.inkPools.clear();
    this.inkPools.mark(null, 0);
    this.steps = [];
    this.fly = null;
  }

  protected think(dt: number, ctx: BossContext): void {
    const dist = Math.hypot(ctx.playerX - this.pos.x, ctx.playerZ - this.pos.z);
    const toPlayer = yawTo(this.pos.x, this.pos.z, ctx.playerX, ctx.playerZ);
    const fighting = this.engaged && this.state !== 'intro';
    if (fighting) {
      this.fightT += dt;
      this.phaseT += dt;
    }
    this.announceEnrage(ctx, this.phase === 3, 'Barba Ray is enraged!', 'barba.call');
    if (fighting && this.phase === 1 && this.state !== 'tide' && this.hp <= this.maxHp * cfg.phase2At) this.startTide(ctx);
    if (fighting && this.phase === 2 && this.state !== 'deep' && this.hp <= this.maxHp * cfg.phase3At) this.startDeep(ctx);
    if (fighting) {
      if (this.phase === 1 && this.state !== 'tide') this.broodTick(ctx);
      if (this.phase === 2 && this.state !== 'deep') this.tideTick(dt, ctx);
      if (this.phase === 3) this.deepTick(dt, ctx);
    }
    this.updateSurge(dt, ctx);
    // Mother's fury: as soon as it is free after an egg broke.
    if (this.phase === 1 && this.furies > 0 && ctx.playerAlive && (this.state === 'stalk' || this.state === 'recover')) this.fury(ctx);

    switch (this.state) {
      case 'dormant':
        this.alt = cfg.hover;
        if (ctx.playerAlive && dist < cfg.wakeRange) this.awaken(ctx, 'BARBA RAY', 0.45, 'barba.call');
        break;

      case 'intro':
        this.yaw = turnToward(this.yaw, toPlayer, cfg.turnSpeed * dt);
        this.alt = cfg.hover + Math.sin(this.stateT * 2) * 0.6;
        if (this.stateT > 2.6) this.enter('stalk');
        break;

      case 'stalk': {
        if (!ctx.playerAlive) break;
        this.yaw = turnToward(this.yaw, toPlayer, cfg.turnSpeed * dt);
        // It keeps its distance, drifting round you.
        const keep = this.phase === 3 ? cfg.keepAway - 1.5 : cfg.keepAway;
        const want = dist > keep + 2 ? 1 : dist < keep - 2 ? -0.6 : 0;
        const side = this.yaw + Math.PI / 2;
        this.pos.x += (Math.sin(this.yaw) * want + Math.sin(side) * 0.45) * cfg.glideAbout * dt;
        this.pos.z += (Math.cos(this.yaw) * want + Math.cos(side) * 0.45) * cfg.glideAbout * dt;
        this.alt += (this.baseAlt - this.alt) * Math.min(1, dt * 3);
        this.cooldown -= dt;
        if (this.cooldown > 0) break;
        if (this.phase === 1 && !this.clutchLive && this.fightT >= this.nextClutch) {
          this.startLay(ctx);
          break;
        }
        this.chooseAttack(ctx);
        break;
      }

      case 'attack':
        this.runAttack(dt, ctx);
        break;

      case 'lay':
        this.yaw = turnToward(this.yaw, toPlayer, cfg.turnSpeed * dt);
        this.alt += (cfg.hover + 1 - this.alt) * Math.min(1, dt * 3);
        if (!this.laid && this.stateT >= 0.4) {
          this.laid = true;
          this.lay(ctx);
        }
        if (this.stateT >= cfg.layTime) this.endAttack(0.4);
        break;

      case 'stunned':
      case 'stuck':
        this.alt = Math.max(0, this.alt - dt * 12);
        if (this.stateT >= (this.state === 'stunned' ? cfg.stunTime : cfg.stuckTime)) this.endAttack(1);
        break;

      case 'recover':
        this.alt += ((this.phase === 2 ? SWIM_ALT : this.baseAlt) - this.alt) * Math.min(1, dt * 2);
        if (this.stateT >= this.recoverFor) {
          if (this.phase === 2) this.toSwim();
          else this.enter('stalk');
        }
        break;

      // ---- into High Tide
      case 'tide':
        // Out over the rim and down into the sea while the water comes up.
        if (this.diveAt) {
          this.pos.x += (this.diveAt[0] - this.pos.x) * Math.min(1, dt * 2.5);
          this.pos.z += (this.diveAt[1] - this.pos.z) * Math.min(1, dt * 2.5);
          this.yaw = turnToward(this.yaw, yawTo(this.cx, this.cz, this.diveAt[0], this.diveAt[1]), 4 * dt);
        }
        this.alt = this.stateT < 0.8 ? Math.min(3, this.alt + dt * 3) : Math.max(-3, this.alt - dt * 6);
        if (this.stateT >= cfg.tideTime) this.beginTide(ctx);
        break;

      case 'swim': {
        this.alt += (SWIM_ALT - this.alt) * Math.min(1, dt * 3);
        // Round the court under the water, toward your side of it.
        const want = Math.atan2(ctx.playerX - this.cx, ctx.playerZ - this.cz) + this.swimSide;
        const d = Math.atan2(Math.sin(want - this.swimAng), Math.cos(want - this.swimAng));
        this.swimAng += Math.sign(d) * Math.min(Math.abs(d), 0.9 * dt);
        this.pos.x = this.cx + Math.sin(this.swimAng) * cfg.swimRing;
        this.pos.z = this.cz + Math.cos(this.swimAng) * cfg.swimRing;
        this.yaw = turnToward(this.yaw, this.swimAng + (d >= 0 ? Math.PI / 2 : -Math.PI / 2), 3 * dt);
        if (this.stateT < cfg.swimFor || !ctx.playerAlive) break;
        if (this.phaseT >= this.nextSurge) this.startSurge(ctx);
        else this.chooseAttack(ctx);
        break;
      }

      case 'surge':
        // Rearing up past the rim while the court is warned (the wall and the ride in are updateSurge's).
        this.alt += (2.5 - this.alt) * Math.min(1, dt * 3);
        this.yaw = turnToward(this.yaw, yawTo(this.pos.x, this.pos.z, this.cx, this.cz), 3 * dt);
        if (this.stateT > cfg.surgeWarn + 6) this.toSwim();
        break;

      case 'land':
        // Riding in behind the surge, out of the sea onto the court (the landing is warned).
        if (this.beachAt && this.landFrom) {
          const k = Math.min(1, this.stateT / cfg.landWarn);
          this.pos.x = this.landFrom[0] + (this.beachAt[0] - this.landFrom[0]) * k;
          this.pos.z = this.landFrom[1] + (this.beachAt[1] - this.landFrom[1]) * k;
          this.alt = 2.5 * (1 - k) + 4 * Math.sin(k * Math.PI);
          this.yaw = turnToward(this.yaw, yawTo(this.landFrom[0], this.landFrom[1], this.beachAt[0], this.beachAt[1]), 4 * dt);
        }
        break;

      case 'beached':
        this.alt = 0;
        if (this.stateT >= cfg.beachedTime) {
          this.landFrom = [this.pos.x, this.pos.z];
          this.enter('return');
        }
        break;

      case 'return': {
        // Back over the nearest rim into the sea.
        const a = Math.atan2(this.pos.x - this.cx, this.pos.z - this.cz);
        const k = Math.min(1, this.stateT / 1.4);
        if (this.landFrom) {
          const tx = this.cx + Math.sin(a) * cfg.swimRing;
          const tz = this.cz + Math.cos(a) * cfg.swimRing;
          this.pos.x = this.landFrom[0] + (tx - this.landFrom[0]) * k;
          this.pos.z = this.landFrom[1] + (tz - this.landFrom[1]) * k;
          this.yaw = turnToward(this.yaw, a, 4 * dt);
        }
        this.alt = SWIM_ALT * k + Math.sin(k * Math.PI) * 0.8;
        if (k >= 1) this.toSwim();
        break;
      }

      // ---- into the Deep
      case 'deep': {
        // Round and round the whirlpool as the court goes under.
        const a = Math.atan2(this.pos.x - this.cx, this.pos.z - this.cz) + 1.4 * dt;
        const r = Math.max(5, Math.hypot(this.pos.x - this.cx, this.pos.z - this.cz) - 6 * dt);
        this.pos.x = this.cx + Math.sin(a) * r;
        this.pos.z = this.cz + Math.cos(a) * r;
        this.yaw = a + Math.PI / 2;
        this.alt += (cfg.deepHover - this.alt) * Math.min(1, dt * 1.5);
        if (this.stateT >= cfg.deepTime) this.beginDeep(ctx);
        break;
      }
    }

    this.group.rotation.y = this.yaw;
    this.animate(dt);
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

  /** Off it swims round the court under the water (High Tide), from where it is. */
  private toSwim(): void {
    this.swimAng = Math.atan2(this.pos.x - this.cx, this.pos.z - this.cz);
    this.swimSide = -this.swimSide;
    this.pose = 'idle';
    this.steps = [];
    this.fly = null;
    this.hangAt = null;
    this.enter('swim');
  }

  /** Call off whatever it was doing (a change of phase, a stun). */
  private callOff(): void {
    this.tele.cancelAll();
    this.hatchTele.clear();
    this.steps = [];
    this.fly = null;
    this.hangAt = null;
    this.pose = 'idle';
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
      if (this.alive && this.state === 'attack') s.run();
    }
    if (this.state !== 'attack') return;
    switch (this.pose) {
      case 'rise':
        this.alt = Math.min(CRASH_ALT, this.alt + dt * 14);
        break;
      case 'hang':
        this.alt = CRASH_ALT;
        if (this.hangAt) {
          this.pos.x += (this.hangAt[0] - this.pos.x) * Math.min(1, dt * 5);
          this.pos.z += (this.hangAt[1] - this.pos.z) * Math.min(1, dt * 5);
        }
        break;
      case 'rest':
        this.alt = 0;
        break;
      case 'approach':
        if (this.hangAt) {
          const dx = this.hangAt[0] - this.pos.x;
          const dz = this.hangAt[1] - this.pos.z;
          const d = Math.hypot(dx, dz);
          const step = Math.min(d, 9 * dt);
          if (d > 0.01) {
            this.pos.x += (dx / d) * step;
            this.pos.z += (dz / d) * step;
            this.yaw = turnToward(this.yaw, Math.atan2(dx, dz), 5 * dt);
          }
        }
        this.alt += (this.baseAlt - this.alt) * Math.min(1, dt * 3);
        break;
      default:
        this.alt += (this.baseAlt - this.alt) * Math.min(1, dt * (this.phase === 2 ? 5 : 3));
    }
    if (this.fly) this.flyGlide(dt, ctx);
    if (!this.steps.length && !this.fly && this.stateT >= this.actEnd) this.endAttack(0.7);
  }

  private chooseAttack(ctx: BossContext): void {
    const pool: Attack[] = this.phase === 1 ? ['glide', 'crash'] : this.phase === 2 ? ['skim', 'spouts'] : ['dive', 'sweep', 'current'];
    const pick = this.pickAttack(ctx, pool);
    this.begin();
    switch (pick) {
      case 'glide':
        this.glide(ctx, cfg.arenaRadius - cfg.radius);
        break;
      case 'crash':
        this.crash(ctx, (x, z) => this.ripple(ctx, x, z));
        break;
      case 'skim':
        this.glide(ctx, cfg.swimRing);
        break;
      case 'spouts':
        this.spoutsFromRim(ctx);
        break;
      case 'dive':
        this.dive(ctx);
        break;
      case 'sweep':
        this.sweep(ctx);
        break;
      case 'current':
        this.currentAttack(ctx);
        break;
    }
  }

  /**
   * Glide: a lane from it through you on to a circle `R` m round the middle (the far rim; in High Tide the far side of
   * its swim, a skim across the court), warned; then it flies it.
   */
  private glide(ctx: BossContext, R: number, windup = cfg.glideWindup * this.sm(), dash = this.enraged): number {
    const yaw = (this.yaw = yawTo(this.pos.x, this.pos.z, ctx.playerX, ctx.playerZ));
    const dist = Math.hypot(ctx.playerX - this.pos.x, ctx.playerZ - this.pos.z);
    const len = Math.max(dist + 4, toCircle(this.pos.x, this.pos.z, yaw, this.cx, this.cz, R));
    this.pose = 'glideWindup';
    this.sound('barba.call');
    this.warn(ctx, { kind: 'line', x: this.pos.x, z: this.pos.z, yaw, length: len, width: cfg.glideWidth }, windup, undefined, undefined, dash);
    this.after(windup, () => {
      this.fly = { yaw, left: len, hit: false };
      this.pose = 'glide';
      this.sound('barba.glide');
    });
    return windup + len / cfg.glideSpeed;
  }

  private flyGlide(dt: number, ctx: BossContext): void {
    const f = this.fly!;
    const step = Math.min(f.left, cfg.glideSpeed * dt);
    this.pos.x += Math.sin(f.yaw) * step;
    this.pos.z += Math.cos(f.yaw) * step;
    this.yaw = f.yaw;
    this.alt = this.phase === 2 ? 0.6 : 1.1;
    f.left -= step;
    if (!f.hit) {
      const shape: TelegraphShape = { kind: 'circle', x: this.pos.x, z: this.pos.z, radius: cfg.glideWidth / 2 };
      if (ctx.hitPlayer(shape, cfg.glideAtp, this.pos.x, this.pos.z, cfg.glideKnockback)) f.hit = true;
    }
    if (f.left <= 0) {
      this.fly = null;
      this.pose = 'idle';
    }
  }

  /** Spouts from the rim (High Tide): a line of geysers from its spot through you, from two short of you to two past. */
  private spoutsFromRim(ctx: BossContext): void {
    const yaw = yawTo(this.pos.x, this.pos.z, ctx.playerX, ctx.playerZ);
    const dist = Math.hypot(ctx.playerX - this.pos.x, ctx.playerZ - this.pos.z);
    const first = Math.max(cfg.swimRing - cfg.arenaRadius + 1, dist - 2 * cfg.spoutSpacing);
    this.spouts(ctx, this.pos.x, this.pos.z, yaw, first);
  }

  /** Spouts: geysers along `yaw` from (x, z), the first `first` m out and warned `spoutWindup`, each a little after the last. */
  private spouts(ctx: BossContext, x: number, z: number, yaw: number, first: number): void {
    const windup = cfg.spoutWindup * this.sm();
    this.pose = 'spout';
    this.yaw = yaw;
    this.sound('barba.spout');
    spoutLine(x, z, yaw, first).forEach(([sx, sz], i) => {
      if (Math.hypot(sx - this.cx, sz - this.cz) > cfg.arenaRadius) return;
      const shape: TelegraphShape = { kind: 'circle', x: sx, z: sz, radius: cfg.spoutRadius };
      const t = windup + i * cfg.spoutStagger;
      this.warn(ctx, shape, t, SPOUT_COLOR, () => {
        if (!this.alive) return;
        ctx.hitPlayer(shape, cfg.spoutAtp, sx, sz, 6);
        ctx.effect(new Pillar(sx, sz, SPOUT_COLOR, 0.6, cfg.spoutRadius * 0.7, 7));
        ctx.effect(new Ring(sx, sz, 0xe6f8ff, cfg.spoutRadius * 1.15, 0.4));
        this.sound('barba.spout', sx, sz);
      });
      this.hold(t);
    });
  }

  /**
   * Ripples: bands of water out from (x, z), all warned at once, bursting one after another outward (the first after
   * `rippleWindup`, each next `rippleStep` later): step into a band once it has burst.
   */
  private ripple(ctx: BossContext, x: number, z: number): void {
    const windup = cfg.rippleWindup * this.sm();
    this.pose = 'slam';
    this.sound('barba.splash');
    rippleBands().forEach(([inner, outer], i) => {
      const shape: TelegraphShape = { kind: 'arc', x, z, yaw: 0, inner, outer, arcDeg: 360 };
      const t = windup + i * cfg.rippleStep;
      this.warn(ctx, shape, t, RIPPLE_COLOR, () => {
        if (!this.alive) return;
        ctx.hitPlayer(shape, cfg.rippleAtp, x, z, cfg.rippleKnockback);
        ctx.effect(new Ring(x, z, RIPPLE_COLOR, outer, 0.45, 0.6));
        if (i === 0) ctx.shake(0.3);
        this.sound('barba.splash', x, z);
      });
      this.hold(t);
    });
  }

  /** Belly crash: up into the air, then a circle on you that it drops onto (the enrage never cuts it); `then` at the impact. */
  private crash(ctx: BossContext, then?: (x: number, z: number) => void): void {
    this.pose = 'rise';
    this.sound('barba.call');
    this.after(cfg.crashRise, () => {
      const x = ctx.playerX;
      const z = ctx.playerZ;
      const shape: TelegraphShape = { kind: 'circle', x, z, radius: cfg.crashRadius };
      this.hangAt = [x, z];
      this.pose = 'hang';
      this.warn(ctx, shape, cfg.crashWindup, undefined, () => {
        if (!this.alive || this.state !== 'attack') return;
        this.pos.set(x, 0, z);
        this.alt = 0;
        this.hangAt = null;
        ctx.hitPlayer(shape, cfg.crashAtp, x, z, cfg.crashKnockback);
        ctx.shake(0.6);
        ctx.effect(new Ring(x, z, 0xe6f8ff, cfg.crashRadius * 1.1, 0.45));
        this.sound('barba.beach');
        this.pose = 'rest';
        this.hold(cfg.crashRest);
        then?.(x, z);
      });
      this.hold(cfg.crashWindup + cfg.crashRest);
    });
  }

  /** Dive (the Deep): up, then a circle on you that it ploughs into (never cut), stuck in the floor after (weak point open). */
  private dive(ctx: BossContext): void {
    this.pose = 'rise';
    this.sound('barba.call');
    this.after(cfg.diveRise, () => {
      const x = ctx.playerX;
      const z = ctx.playerZ;
      const shape: TelegraphShape = { kind: 'circle', x, z, radius: cfg.diveRadius };
      this.hangAt = [x, z];
      this.pose = 'hang';
      this.warn(ctx, shape, cfg.diveWindup, undefined, () => {
        if (!this.alive || this.state !== 'attack' || this.phase !== 3) return;
        this.pos.set(x, 0, z);
        this.alt = 0;
        ctx.hitPlayer(shape, cfg.diveAtp, x, z, cfg.diveKnockback);
        ctx.shake(0.6);
        ctx.effect(new Ring(x, z, 0xe6f8ff, cfg.diveRadius * 1.1, 0.45));
        this.sound('barba.beach');
        this.sound('boss.weak');
        this.steps = [];
        this.fly = null;
        this.hangAt = null;
        this.pose = 'idle';
        this.enter('stuck');
        this.teach(ctx, 'stuck', 'Stuck in the floor! Weak point exposed!');
      });
      this.hold(cfg.diveWindup + 1);
    });
  }

  /** Tail sweep (the Deep): in close, then a cone from it at you. */
  private sweep(ctx: BossContext): void {
    const d = Math.hypot(ctx.playerX - this.pos.x, ctx.playerZ - this.pos.z);
    const k = d > 3.5 ? (d - 3.5) / d : 0;
    this.hangAt = [this.pos.x + (ctx.playerX - this.pos.x) * k, this.pos.z + (ctx.playerZ - this.pos.z) * k];
    this.pose = 'approach';
    this.after(0.5, () => {
      this.hangAt = null;
      const windup = cfg.sweepWindup * this.sm();
      const yaw = (this.yaw = yawTo(this.pos.x, this.pos.z, ctx.playerX, ctx.playerZ));
      const shape: TelegraphShape = { kind: 'cone', x: this.pos.x, z: this.pos.z, yaw, range: cfg.sweepRange, arcDeg: cfg.sweepArc };
      this.pose = 'slam';
      this.sound('barba.call');
      this.warn(ctx, shape, windup, undefined, () => {
        if (!this.alive) return;
        ctx.hitPlayer(shape, cfg.sweepAtp, shape.x, shape.z, cfg.sweepKnockback);
        ctx.effect(new Ring(shape.x, shape.z, 0xe6f8ff, cfg.sweepRange, 0.4, 0.5));
        this.sound('barba.splash', shape.x, shape.z);
      });
      this.hold(windup + 0.4);
    });
  }

  /** Current (the Deep): over the flowing vent nearest you, it beats its wings at you: a lane that pushes you along it. */
  private currentAttack(ctx: BossContext): void {
    const flowing = this.vents.list.filter((v) => v.phase === 'flow');
    flowing.sort((a, b) => Math.hypot(a.x - ctx.playerX, a.z - ctx.playerZ) - Math.hypot(b.x - ctx.playerX, b.z - ctx.playerZ));
    const vx = flowing[0]?.x ?? this.pos.x;
    const vz = flowing[0]?.z ?? this.pos.z;
    this.hangAt = [vx, vz];
    this.pose = 'approach';
    this.after(0.7, () => {
      this.hangAt = null;
      const windup = cfg.currentWarn * this.sm();
      const off = Math.hypot(ctx.playerX - vx, ctx.playerZ - vz);
      // Standing right on the vent: it pushes you out from the middle.
      const yaw = off > 0.5 ? yawTo(vx, vz, ctx.playerX, ctx.playerZ) : yawTo(this.cx, this.cz, vx, vz);
      const length = Math.max(off + 4, toCircle(vx, vz, yaw, this.cx, this.cz, cfg.arenaRadius));
      const shape: TelegraphShape = { kind: 'line', x: vx, z: vz, yaw, length, width: cfg.currentWidth };
      this.yaw = yaw;
      this.pose = 'glideWindup';
      this.warn(ctx, shape, windup, CURRENT_COLOR, () => {
        if (!this.alive || this.phase !== 3) return;
        this.current = { shape, yaw, t: cfg.currentTime };
        ctx.effect(new CurrentStream(vx, vz, yaw, length, cfg.currentWidth, cfg.currentTime / this.tempo));
        this.sound('barba.glide', vx, vz);
      });
      this.hold(windup + cfg.currentTime);
    });
  }

  private teach(ctx: BossContext, key: string, text: string): void {
    if (this.taught.has(key)) return;
    this.taught.add(key);
    ctx.announce(text);
  }

  // ---------------------------------------------------------- the Brood

  private startLay(ctx: BossContext): void {
    this.enter('lay');
    this.laid = false;
    this.pose = 'idle';
    this.sound('barba.call');
    this.yaw = yawTo(this.pos.x, this.pos.z, ctx.playerX, ctx.playerZ);
  }

  /** A clutch: its sacs lobbed out of its mouth onto the court, each with a ring that fills until it hatches. */
  private lay(ctx: BossContext): void {
    this.clutches++;
    this.clutchLive = true;
    this.clutch = [];
    const mouth = new THREE.Vector3(this.pos.x + Math.sin(this.yaw) * 2.2, this.alt + 0.8, this.pos.z + Math.cos(this.yaw) * 2.2);
    for (const [x, z] of clutchSpots(this.cx, this.cz, ctx.playerX, ctx.playerZ, ctx.rng)) {
      const sac = new EggSac(this.maxHp * cfg.clutchHpShare, x, z, LOB);
      this.sacs.push(sac);
      this.clutch.push(sac);
      this.sacGroup.add(sac.group);
      ctx.effect(new Lob(mouth, x, z, LOB / this.tempo, EGG_COLOR, 0.4));
      const h = ctx.telegraph({ kind: 'circle', x, z, radius: cfg.clutchRadius + 0.7 }, LOB + cfg.clutchHatch, () => this.hatch(ctx, sac), PIG_COLOR);
      this.tele.add(h);
      this.hatchTele.set(sac, h);
    }
    this.sound('barba.spout');
    this.teach(ctx, 'brood', 'A clutch! Break the eggs before they hatch!');
  }

  /** A sac's ring ran out: it hatches, and its Pig Rays dart at you one after another. */
  private hatch(ctx: BossContext, sac: EggSac): void {
    this.hatchTele.delete(sac);
    if (!this.alive || !sac.alive || this.phase !== 1) return;
    sac.hatch();
    ctx.effect(new Ring(sac.pos.x, sac.pos.z, EGG_COLOR, 2.4, 0.4));
    this.sound('barba.splash', sac.pos.x, sac.pos.z);
    for (let i = 0; i < cfg.hatchDarts; i++) this.dartsDue.push({ at: this.fightT + i * cfg.hatchEvery, x: sac.pos.x, z: sac.pos.z });
  }

  /**
   * Sacs broken (their hatch called off, each owing its fury), the clutch done (all broken: it is stunned, the fury of
   * the last swallowed by it), and the tide channels erupting in turn.
   */
  private broodTick(ctx: BossContext): void {
    if (this.fightT >= this.nextChannel) {
      this.nextChannel = this.fightT + cfg.channelEvery;
      this.erupt(ctx, cfg.channelRings[this.channels++ % 2]);
    }
    for (const [sac, h] of this.hatchTele) {
      if (sac.hp > 0) continue;
      h.cancel();
      this.hatchTele.delete(sac);
      this.furies++;
      ctx.effect(new Ring(sac.pos.x, sac.pos.z, EGG_COLOR, 2, 0.35));
      this.sound('barba.splash', sac.pos.x, sac.pos.z);
    }
    if (!this.clutchLive || this.clutch.some((s) => s.alive)) return;
    this.clutchLive = false;
    this.nextClutch = this.fightT + cfg.clutchEvery;
    if (!this.clutch.some((s) => s.hatched)) this.stun(ctx);
  }

  private stun(ctx: BossContext): void {
    this.callOff();
    this.furies = 0;
    ctx.announce('The brood is lost! Barba Ray is stunned!');
    ctx.shake(0.5);
    this.sound('barba.call');
    this.sound('boss.weak');
    this.enter('stunned');
  }

  /** Mother's fury: a glide at you warned only `furyWindup` s (a dash check), then waves of circles on and round you. */
  private fury(ctx: BossContext): void {
    this.furies--;
    this.begin();
    this.lastAttack = null;
    this.teach(ctx, 'fury', "Mother's fury! Stagger the eggs you break!");
    const flight = this.glide(ctx, cfg.arenaRadius - cfg.radius, cfg.furyWindup, true);
    for (let w = 0; w < cfg.furyWaves; w++) this.after(flight + 0.15 + w * cfg.furyEvery, () => this.furyWave(ctx));
  }

  /** A wave of the fury: `furyCircles` circles, one on you and the rest round you, apart, on the court. */
  private furyWave(ctx: BossContext): void {
    const spots: Pt[] = [[ctx.playerX, ctx.playerZ]];
    for (let i = 0; i < 60 && spots.length < cfg.furyCircles; i++) {
      const a = ctx.rng() * Math.PI * 2;
      const r = cfg.furyRadius + ctx.rng() * (cfg.furySpread - cfg.furyRadius);
      const x = ctx.playerX + Math.sin(a) * r;
      const z = ctx.playerZ + Math.cos(a) * r;
      if (Math.hypot(x - this.cx, z - this.cz) > cfg.arenaRadius - 0.5) continue;
      if (spots.some(([sx, sz]) => Math.hypot(sx - x, sz - z) < cfg.furyRadius * 1.6)) continue;
      spots.push([x, z]);
    }
    for (const [x, z] of spots) {
      const shape: TelegraphShape = { kind: 'circle', x, z, radius: cfg.furyRadius };
      this.warn(ctx, shape, cfg.furyWarn, undefined, () => {
        if (!this.alive) return;
        ctx.hitPlayer(shape, cfg.furyAtp, x, z, 4);
        // Dim, slim geysers: bright ones blew out to white under the court's bloom when you stood among them.
        ctx.effect(new Pillar(x, z, 0x8a3a68, 0.45, cfg.furyRadius * 0.35, 3.5));
        ctx.effect(new Ring(x, z, 0xffd0e8, cfg.furyRadius * 1.1, 0.35));
        this.sound('barba.spout', x, z);
      });
    }
    this.hold(cfg.furyWarn);
  }

  /** A tide channel erupts: a band either side of one of the court's water rings, warned; geysers all along it. */
  private erupt(ctx: BossContext, r: number): void {
    const shape: TelegraphShape = { kind: 'arc', x: this.cx, z: this.cz, yaw: 0, inner: r - cfg.channelHalf, outer: r + cfg.channelHalf, arcDeg: 360 };
    this.teach(ctx, 'channel', 'The channels surge: off the glowing rings!');
    this.warn(ctx, shape, cfg.channelWarn, SPOUT_COLOR, () => {
      if (!this.alive || this.phase !== 1) return;
      ctx.hitPlayer(shape, cfg.channelAtp, this.cx, this.cz, 4);
      // Dim, slim geysers along it (bright ones blew out under the court's bloom).
      const n = Math.round((2 * Math.PI * r) / 3.5);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        ctx.effect(new Pillar(this.cx + Math.sin(a) * r, this.cz + Math.cos(a) * r, 0x2f6a98, 0.45, 0.45, 3));
      }
      ctx.effect(new Ring(this.cx, this.cz, 0xe6f8ff, r + cfg.channelHalf, 0.45, 0.6));
      ctx.shake(0.25);
      this.sound('barba.spout', this.cx + r, this.cz);
    });
  }

  private updateSacs(dt: number): void {
    for (let i = this.sacs.length - 1; i >= 0; i--) {
      if (this.sacs[i].update(dt)) continue;
      this.sacGroup.remove(this.sacs[i].group);
      this.sacs.splice(i, 1);
    }
  }

  // ---------------------------------------------------------- the Pig Rays

  /** The Pig Rays out of hatched sacs: each down its own lane, shown `pigWarn` s before it sets off. A touch is a light hit. */
  private updatePigs(dt: number, ctx: BossContext): void {
    const fighting = this.alive && this.engaged && this.state !== 'intro';
    for (let i = this.dartsDue.length - 1; i >= 0; i--) {
      const d = this.dartsDue[i];
      if (this.fightT < d.at) continue;
      this.dartsDue.splice(i, 1);
      if (fighting && ctx.playerAlive) this.dart(ctx, d.x, d.z);
    }
    const pr = playerCfg.radius;
    this.pigs.update(dt, this.time, (p) => {
      if (!fighting || !ctx.playerAlive || p.hit || !pigTouches(p, ctx.playerX, ctx.playerZ, pr)) return true;
      p.hit = true;
      return !ctx.hitPlayer({ kind: 'circle', x: p.x, z: p.z, radius: cfg.pigRadius }, cfg.pigAtp, p.x, p.z, 2);
    });
  }

  private dart(ctx: BossContext, x: number, z: number): void {
    const lane = dartLane(x, z, ctx.playerX, ctx.playerZ, this.cx, this.cz, ctx.rng);
    this.warn(ctx, { kind: 'line', x: lane.x, z: lane.z, yaw: lane.yaw, length: lane.length, width: cfg.pigWidth }, cfg.pigWarn, PIG_COLOR, () => {
      if (!this.alive) return;
      this.pigs.add({ x: lane.x, z: lane.z, yaw: lane.yaw, left: lane.length, hit: false, t: 0 });
      this.sound('barba.pig', lane.x, lane.z);
    });
  }

  // ---------------------------------------------------------- High Tide

  /** "The tide comes in!": it dives out over the rim while the sea comes up over the court. */
  private startTide(ctx: BossContext): void {
    this.callOff();
    this.furies = 0;
    for (const s of this.sacs) if (s.alive) s.hp = 0;
    this.clutch = [];
    this.clutchLive = false;
    this.dartsDue = [];
    this.pigs.clear();
    const out = Math.atan2(this.pos.x - this.cx, this.pos.z - this.cz);
    this.diveAt = [this.cx + Math.sin(out) * (cfg.arenaRadius + 4), this.cz + Math.cos(out) * (cfg.arenaRadius + 4)];
    this.enter('tide');
    this.escalate(ctx, 'The tide comes in!');
    this.warn(ctx, { kind: 'circle', x: this.cx, z: this.cz, radius: cfg.arenaRadius + 0.5 }, cfg.tideTime, WATER_COLOR);
    ctx.shake(0.5);
    this.sound('barba.call');
    this.sound('barba.flood');
  }

  /** The water is up for good: the Ul Rays rise, the platforms start sinking in turn, it swims round the court. */
  private beginTide(ctx: BossContext): void {
    this.phase = 2;
    this.phaseT = 0;
    this.nextSurge = cfg.surgeFirst;
    this.sinkT = cfg.sinkFirst;
    this.drowned = 0;
    this.lastBody = null;
    for (let i = 0; i < cfg.ulCount; i++) this.spawnUl(ctx);
    ctx.shake(0.4);
    this.sound('barba.splash');
    this.toSwim();
    this.teach(ctx, 'tide', 'High tide: keep to the platforms!');
  }

  /** High Tide each tick: the water on you, the platforms sinking and rising, the Ul Rays kept up. */
  private tideTick(dt: number, ctx: BossContext): void {
    if (ctx.playerAlive) this.waterOn(dt, ctx);
    if (this.state !== 'beached' && this.state !== 'land') {
      this.sinkT -= dt;
      if (this.sinkT <= 0) {
        this.sinkT = cfg.sinkEvery;
        this.sinkOne(ctx);
      }
    }
    for (const p of this.platforms.list) if (!p.up && p.downT >= cfg.riseAfter) p.rise();
    const alive = this.uls.filter((u) => u.alive).length;
    if (alive + this.ulDue.length < cfg.ulCount) this.ulDue.push(this.fightT + cfg.ulRespawn);
    for (let i = this.ulDue.length - 1; i >= 0; i--) {
      if (this.fightT < this.ulDue[i]) continue;
      this.ulDue.splice(i, 1);
      this.spawnUl(ctx);
    }
  }

  /** Warn a platform (the one you stand on part of the time, else one near you) and sink it. */
  private sinkOne(ctx: BossContext): void {
    const list = this.platforms.list;
    const i = sinkPick(list, ctx.playerX, ctx.playerZ, ctx.rng);
    if (i < 0) return;
    const p = list[i];
    p.sinking = true;
    this.warn(ctx, { kind: 'circle', x: p.x, z: p.z, radius: cfg.platformR }, cfg.sinkWarn, SINK_COLOR, () => {
      if (!this.alive || this.phase !== 2 || this.state === 'deep') {
        p.sinking = false;
        return;
      }
      p.sink();
      ctx.effect(new Ring(p.x, p.z, 0xe6f8ff, 2.4, 0.5));
      this.sound('barba.sink', p.x, p.z);
    });
  }

  /**
   * You in the water: off a standing platform it takes `waterShare` of your max HP a (real) second, shown in chunks,
   * and slows you; a dash (or a shove) skims it.
   */
  private waterOn(dt: number, ctx: BossContext): void {
    const body = ctx.body();
    const real = dt / this.tempo;
    const last = this.lastBody;
    this.lastBody = [body.pos.x, body.pos.z];
    const dry = platformAt(this.platforms.list, body.pos.x, body.pos.z) >= 0;
    const moved = last ? Math.hypot(body.pos.x - last[0], body.pos.z - last[1]) : 0;
    const skimming = real > 0 && moved / real > playerCfg.moveSpeed * 1.6;
    if (dry || skimming) {
      this.flushDrown(ctx, 'Flood');
      return;
    }
    // Slowed: give back part of this frame's step.
    if (last && moved > 0) {
      body.pos.x -= (body.pos.x - last[0]) * cfg.waterSlow;
      body.pos.z -= (body.pos.z - last[1]) * cfg.waterSlow;
      this.lastBody = [body.pos.x, body.pos.z];
    }
    this.drowned += cfg.waterShare * real;
    if (this.drowned >= cfg.waterShare * cfg.waterTick) this.flushDrown(ctx, 'Flood');
  }

  private flushDrown(ctx: BossContext, source: string): void {
    if (this.drowned <= 0) return;
    ctx.drown(this.drowned, source);
    this.drowned = 0;
  }

  /** A surge: it rears up past the rim on its side, and the whole court is warned the way the wall will roll. */
  private startSurge(ctx: BossContext): void {
    this.nextSurge = this.phaseT + cfg.surgeEvery;
    this.pose = 'idle';
    const R = cfg.arenaRadius + 1;
    const x = this.cx + Math.sin(this.swimAng) * R;
    const z = this.cz + Math.cos(this.swimAng) * R;
    const yaw = this.swimAng + Math.PI;
    this.surge = { x, z, yaw, s: -1, passed: false, rode: false };
    this.warn(ctx, { kind: 'line', x, z, yaw, length: 2 * R, width: 2 * R }, cfg.surgeWarn, WATER_COLOR, () => {
      if (!this.alive || !this.surge || this.phase !== 2) return;
      this.surge.s = 0;
      ctx.shake(0.4);
      this.sound('barba.flood');
    });
    this.enter('surge');
    this.sound('barba.call');
    this.teach(ctx, 'surge', 'A surge! Get onto a platform!');
  }

  /**
   * The surge's wall rolling across the court: it hits you as it passes unless you stand on a platform, and once it is
   * past the middle it rides in behind it and beaches.
   */
  private updateSurge(dt: number, ctx: BossContext): void {
    const s = this.surge;
    if (!s || s.s < 0 || !this.alive) {
      this.wall.place(null, this.time);
      return;
    }
    s.s += cfg.surgeSpeed * dt;
    this.wall.place({ x: s.x + Math.sin(s.yaw) * s.s, z: s.z + Math.cos(s.yaw) * s.s, yaw: s.yaw }, this.time);
    if (!s.passed && ctx.playerAlive && surgeAlong(s.x, s.z, s.yaw, ctx.playerX, ctx.playerZ) <= s.s) {
      s.passed = true;
      if (platformAt(this.platforms.list, ctx.playerX, ctx.playerZ) < 0) {
        const bx = ctx.playerX - Math.sin(s.yaw) * 2;
        const bz = ctx.playerZ - Math.cos(s.yaw) * 2;
        ctx.hitPlayer({ kind: 'circle', x: ctx.playerX, z: ctx.playerZ, radius: 1 }, cfg.surgeAtp, bx, bz, cfg.surgeShove);
      }
    }
    if (!s.rode && this.state === 'surge' && s.s >= cfg.arenaRadius + 1) {
      s.rode = true;
      this.startLand(ctx);
    }
    if (s.s >= 2 * (cfg.arenaRadius + 1) + 2) this.surge = null;
  }

  /** Riding in behind the surge: it lands `beachLand` m from you toward the middle (warned), beached. */
  private startLand(ctx: BossContext): void {
    const dx = this.cx - ctx.playerX;
    const dz = this.cz - ctx.playerZ;
    const d = Math.hypot(dx, dz);
    let x = ctx.playerX + (d > 0.1 ? (dx / d) * cfg.beachLand : cfg.beachLand);
    let z = ctx.playerZ + (d > 0.1 ? (dz / d) * cfg.beachLand : 0);
    const r = Math.hypot(x - this.cx, z - this.cz);
    const max = cfg.arenaRadius - cfg.radius - 1;
    if (r > max) {
      x = this.cx + ((x - this.cx) / r) * max;
      z = this.cz + ((z - this.cz) / r) * max;
    }
    this.landFrom = [this.pos.x, this.pos.z];
    this.beachAt = [x, z];
    this.enter('land');
    this.sound('barba.splash');
    const shape: TelegraphShape = { kind: 'circle', x, z, radius: cfg.radius + 1 };
    this.warn(ctx, shape, cfg.landWarn, undefined, () => {
      if (!this.alive || this.state !== 'land') return;
      this.pos.set(x, 0, z);
      this.alt = 0;
      ctx.hitPlayer(shape, cfg.crashAtp * 0.6, x, z, 8);
      ctx.shake(0.7);
      ctx.effect(new Ring(x, z, 0xe6f8ff, cfg.radius * 2, 0.5));
      this.sound('barba.beach');
      this.sound('boss.weak');
      ctx.announce('Beached! Weak point exposed!');
      this.enter('beached');
    });
  }

  // ---------------------------------------------------------- the Ul Rays

  private spawnUl(ctx: BossContext): void {
    const [lo, hi] = cfg.ulEvery;
    const ang = ctx.rng() * Math.PI * 2;
    const u = new UlRay(this.maxHp * cfg.ulHpShare, ang, this.uls.length % 2 ? 1 : -1, 1.5 + ctx.rng() * (hi - lo));
    u.pos.set(this.cx + Math.sin(ang) * cfg.ulSwim, -1.2, this.cz + Math.cos(ang) * cfg.ulSwim);
    this.uls.push(u);
    this.ulGroup.add(u.group);
  }

  /**
   * In High Tide the Ul Rays fly round the court and, every few seconds each, warn a lane from under them through you,
   * dive, and skim down it as the lane hits (touching one does nothing); then they climb back up. Dead ones fall into the
   * water, and going into the Deep they all sink out of sight.
   */
  private updateUls(dt: number, ctx: BossContext): void {
    const hunting = this.alive && this.phase === 2 && this.state !== 'deep';
    for (let i = this.uls.length - 1; i >= 0; i--) {
      const u = this.uls[i];
      let face = u.group.rotation.y;
      if (u.alive && hunting) {
        u.modeT += dt;
        switch (u.mode) {
          case 'fly': {
            // Round the court, easing back out to its circle and up to its height.
            u.ang += (u.dir * 4 * dt) / cfg.ulSwim;
            const r0 = Math.hypot(u.pos.x - this.cx, u.pos.z - this.cz);
            const r = r0 + (cfg.ulSwim - r0) * Math.min(1, dt * 1.5);
            const tx = this.cx + Math.sin(u.ang) * r;
            const tz = this.cz + Math.cos(u.ang) * r;
            face = Math.atan2(tx - u.pos.x, tz - u.pos.z);
            u.pos.x = tx;
            u.pos.z = tz;
            u.alt += (cfg.ulFly - u.alt) * Math.min(1, dt * 3);
            u.lungeT -= dt;
            if (u.lungeT <= 0 && ctx.playerAlive) this.ulAim(u, ctx);
            break;
          }
          case 'wind': {
            // Over the head of its lane, diving at the end of the warning.
            const l = u.lane!;
            u.pos.x += (l.x - u.pos.x) * Math.min(1, dt * 6);
            u.pos.z += (l.z - u.pos.z) * Math.min(1, dt * 6);
            const dive = Math.max(0, Math.min(1, (u.modeT - (cfg.ulWarn - cfg.ulDive)) / cfg.ulDive));
            u.alt = cfg.ulFly + (cfg.ulSkim - cfg.ulFly) * dive;
            face = l.yaw;
            break;
          }
          case 'plunge': {
            const l = u.lane!;
            const step = Math.min(l.left, cfg.ulSpeed * dt);
            u.pos.x += Math.sin(l.yaw) * step;
            u.pos.z += Math.cos(l.yaw) * step;
            l.left -= step;
            u.alt = cfg.ulSkim;
            face = l.yaw;
            if (l.left <= 0) {
              u.mode = 'climb';
              u.modeT = 0;
            }
            break;
          }
          case 'climb': {
            // Up again, gliding on a little.
            const l = u.lane!;
            u.pos.x += Math.sin(l.yaw) * 6 * dt;
            u.pos.z += Math.cos(l.yaw) * 6 * dt;
            const k = Math.min(1, u.modeT / cfg.ulClimb);
            u.alt = cfg.ulSkim + (cfg.ulFly - cfg.ulSkim) * k;
            face = l.yaw;
            if (k >= 1) {
              const [lo, hi] = cfg.ulEvery;
              u.mode = 'fly';
              u.modeT = 0;
              u.lane = null;
              u.ang = Math.atan2(u.pos.x - this.cx, u.pos.z - this.cz);
              u.lungeT = lo + ctx.rng() * (hi - lo);
            }
            break;
          }
        }
      }
      if (!u.alive) u.alt = Math.max(0, u.alt - dt * 6);
      if (!u.update(dt, this.time, face)) {
        this.ulGroup.remove(u.group);
        this.uls.splice(i, 1);
      }
    }
  }

  /** An Ul Ray's lane: from under it through you, warned; as the warning runs out the lane hits and it skims down it. */
  private ulAim(u: UlRay, ctx: BossContext): void {
    const yaw = yawTo(u.pos.x, u.pos.z, ctx.playerX, ctx.playerZ);
    const dist = Math.hypot(ctx.playerX - u.pos.x, ctx.playerZ - u.pos.z);
    const length = Math.max(dist + 4, Math.min(dist + 8, toCircle(u.pos.x, u.pos.z, yaw, this.cx, this.cz, cfg.arenaRadius)));
    const x = u.pos.x;
    const z = u.pos.z;
    u.mode = 'wind';
    u.modeT = 0;
    u.lane = { x, z, yaw, length, left: length };
    const shape: TelegraphShape = { kind: 'line', x, z, yaw, length, width: cfg.ulWidth };
    this.warn(ctx, shape, cfg.ulWarn, UL_COLOR, () => {
      if (!u.alive || this.phase !== 2 || this.state === 'deep' || u.mode !== 'wind') return;
      ctx.hitPlayer(shape, cfg.ulAtp, x, z, cfg.ulKnockback);
      u.mode = 'plunge';
      u.modeT = 0;
      u.pos.x = x;
      u.pos.z = z;
      ctx.effect(new Ring(x, z, 0xe6f8ff, 2, 0.35));
      this.sound('barba.glide', x, z);
    });
  }

  // ---------------------------------------------------------- the Deep

  /** "Barba Ray drags the court into the deep!": the Ul Rays sink, the platforms go under, a whirlpool, then the Deep. */
  private startDeep(ctx: BossContext): void {
    this.callOff();
    this.surge = null;
    this.current = null;
    for (const u of this.uls) u.sink();
    this.ulDue = [];
    for (const p of this.platforms.list) p.sink();
    this.flushDrown(ctx, 'Flood');
    this.lastBody = null;
    this.enter('deep');
    this.escalate(ctx, 'Barba Ray drags the court into the deep!');
    ctx.shake(0.6);
    this.sound('barba.call');
    this.sound('barba.flood');
  }

  private beginDeep(ctx: BossContext): void {
    this.phase = 3;
    this.phaseT = 0;
    this.airLeft = cfg.airMax;
    this.drowned = 0;
    startVents(this.vents.list, ctx.rng);
    this.cooldown = 1.5;
    this.enter('stalk');
    this.teach(ctx, 'deep', 'Under the sea: breathe in the bubbles!');
  }

  /**
   * The Deep each tick: the vents move on, the ink mark runs (a pool where you stand when it runs out) and the pools
   * hurt and smother vents, a current pushes you, and your air runs down (or refills in a vent).
   */
  private deepTick(dt: number, ctx: BossContext): void {
    tickVents(this.vents.list, dt, ctx.rng);
    const body = ctx.body();
    const real = dt / this.tempo;
    this.inkTick(dt, ctx, body.pos.x, body.pos.z);
    if (this.current) {
      const c = this.current;
      c.t -= dt;
      if (ctx.playerAlive && inShape(c.shape, body.pos.x, body.pos.z, playerCfg.radius)) {
        body.pos.x += Math.sin(c.yaw) * cfg.currentPush * dt;
        body.pos.z += Math.cos(c.yaw) * cfg.currentPush * dt;
      }
      if (c.t <= 0) this.current = null;
    }
    if (!ctx.playerAlive) return;
    if (ventAt(this.vents.list, body.pos.x, body.pos.z) >= 0) {
      this.airLeft = Math.min(cfg.airMax, this.airLeft + cfg.airRefill * real);
      this.flushDrown(ctx, 'No air');
      return;
    }
    this.airLeft = Math.max(0, this.airLeft - real);
    if (this.airLeft > 0) return;
    this.drowned += cfg.airShare * real;
    if (this.drowned >= cfg.airShare * cfg.waterTick) this.flushDrown(ctx, 'No air');
  }

  /** The ink mark: on you a while, then a pool where you stand; in a pool you hurt; a vent under one is smothered. */
  private inkTick(dt: number, ctx: BossContext, x: number, z: number): void {
    if (this.inkT > 0) {
      this.inkT -= dt;
      if (this.inkT <= 0) {
        this.inkT = 0;
        this.inkPools.add(x, z);
        ctx.effect(new Ring(x, z, 0x8f9bff, cfg.inkRadius, 0.5));
        this.sound('barba.splash', x, z);
      }
    } else if (ctx.playerAlive && this.phaseT >= this.nextInk) {
      this.inkT = cfg.inkMark;
      this.nextInk = this.phaseT + cfg.inkEvery;
      this.sound('barba.call');
      this.teach(ctx, 'ink', 'Ink mark! Carry it away from the vents!');
    }
    this.inkPools.mark(this.inkT > 0 ? [x, z] : null, 1 - this.inkT / cfg.inkMark);
    for (const v of this.vents.list) v.smothered = inInk(this.inkPools.list, v.x, v.z);
    const real = dt / this.tempo;
    if (ctx.playerAlive && inInk(this.inkPools.list, x, z, playerCfg.radius)) {
      this.inked += cfg.inkShare * real;
      if (this.inked >= cfg.inkShare * cfg.waterTick) {
        ctx.drown(this.inked, 'Ink');
        this.inked = 0;
      }
    } else if (this.inked > 0) {
      ctx.drown(this.inked, 'Ink');
      this.inked = 0;
    }
  }

  // ---------------------------------------------------------- animation

  private animate(dt: number): void {
    const t = this.time;
    let flap = 0.45;
    let speed = 2.2;
    let pitch = 0;
    let roll = 0;
    let mouth = 0;
    let tail = 0;
    let spots = this.phase === 3 ? 0.7 : this.phase === 2 ? 0.45 : 0.2;
    let weak = 0;
    let flat = 0;
    const pose = this.state === 'attack' ? this.pose : 'idle';
    const s = this.state;
    if (s === 'intro') {
      flap = 1;
      speed = 3.4;
      mouth = this.stateT < 1.4 ? 1 : 0.2;
      spots = 0.8;
      pitch = -0.2;
    } else if (s === 'tide' || s === 'land' || s === 'return') {
      flap = 0.9;
      speed = 3;
      pitch = s === 'land' ? -0.5 : 0.6;
    } else if (s === 'swim') {
      flap = 0.7;
      speed = 2.6;
    } else if (s === 'surge') {
      // Rearing up at the rim.
      flap = 1;
      speed = 3.6;
      pitch = -0.45;
      mouth = 0.7;
      spots = 0.9;
    } else if (s === 'deep') {
      flap = 1;
      speed = 3.2;
      roll = 0.35;
      spots = 0.9;
    } else if (s === 'lay') {
      mouth = 1;
      pitch = -0.2;
      spots = 0.7;
    } else if (s === 'beached' || s === 'stunned' || s === 'stuck') {
      // Sprawled on the court, wings slumped, spiracles aglow.
      flap = 0.12;
      speed = 1.1;
      flat = 1;
      mouth = 0.3 + 0.2 * Math.sin(t * 2);
      spots = 0.1;
      weak = 0.45 + Math.sin(t * 8) * 0.2;
      tail = Math.sin(t * 1.3) * 0.3;
    } else if (s === 'dead') {
      flap = 0;
      flat = Math.min(1, this.deadT);
      spots = 0;
      pitch = 0;
    }
    switch (pose) {
      case 'glideWindup':
        flap = 1;
        speed = 3.2;
        pitch = -0.15;
        mouth = 0.6;
        break;
      case 'glide':
        flap = 0.25;
        pitch = 0.15;
        spots = 0.9;
        break;
      case 'spout':
        mouth = 1;
        spots = 0.9;
        pitch = -0.1;
        break;
      case 'slam':
        tail = Math.sin(t * 12) * 0.6;
        break;
      case 'rise':
      case 'hang':
        flap = 1;
        speed = 4;
        pitch = pose === 'hang' ? 0.4 : -0.3;
        break;
      case 'rest':
        flat = 0.7;
        flap = 0.2;
        break;
      case 'approach':
        flap = 0.9;
        speed = 3.4;
        pitch = 0.1;
        break;
    }
    if (this.fly) roll = 0.15 * Math.sin(t * 3);
    if (this.enraged && this.alive) spots = Math.max(spots, 0.6 + 0.3 * Math.sin(t * 6));
    this.wave += dt * speed;
    this.model.pose({
      lift: this.alt, pitch, roll, flap, wave: this.wave, mouth, tail, spots, weak, flat,
      flash: this.flashT > 0, enraged: this.enraged, time: t,
    });
  }
}
