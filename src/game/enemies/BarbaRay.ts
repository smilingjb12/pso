import * as THREE from 'three';
import { barbaRay as cfg, player as playerCfg, type HardBossScale } from '../config';
import { separateCircles, turnToward, yawTo } from '../collision';
import type { Hittable } from '../combat/types';
import type { Level, Rect } from '../world/Level';
import { Pillar, Ring } from '../world/Effects';
import type { TelegraphShape } from '../world/Telegraph';
import { BarbaRayModel } from '../models/barbaRay';
import type { BossContext } from './Boss';
import { BossBase } from './BossBase';
import { burstYaws, pigLane, pigTouches, platformAt, Platforms, PigRays, rippleBands, sinkPick, spoutLine, toCircle, UlRay, Water } from './barbaTide';

// Barba Ray, the Rift Map's second Circle II pinnacle boss (DESIGN.md "Endgame: Falz Rifts" > "Barba Ray"; the user's
// picks from two question rounds, 2026-10-22). A giant manta over a marble temple court in the open sea. Pig Rays dart
// across the court all fight long, each down a lane shown just before, so you can't stand still. Its attacks come in
// pairs (a glide through you then a line of spouts, a belly crash then ripples out from it, a burst of Pig Rays then a
// glide), triples from phase 2. Every ~34 s it dives into the sea and floods the court: stand on the raised platforms,
// which sink one after another under a warning, so you keep hopping (the water hurts every second you're in it, and a
// dash skims it dry), while Ul Rays swim in and lunge at you. When the water drains it is beached, weak point open.
// Below 1/3 its floods spin a whirlpool in the middle that drags you in, and the inner platforms sink first.

type RayState = 'dormant' | 'intro' | 'stalk' | 'attack' | 'recover' | 'dive' | 'flood' | 'drain' | 'leap' | 'beached' | 'dead';

type Attack = 'glideSpouts' | 'crashRipple' | 'burstGlide' | 'glideTriple' | 'crashTriple';

/** What its body is doing in an attack (the animation). */
type Pose = 'idle' | 'glideWindup' | 'glide' | 'spout' | 'slam' | 'rise' | 'hang' | 'rest' | 'burst';

type Pt = [number, number];

const CRASH_ALT = 9;
const WATER_COLOR = 0x3aa8f0;
const SPOUT_COLOR = 0x8ad8ff;
const RIPPLE_COLOR = 0x6ac8ff;
const PIG_COLOR = 0xf08ab4;
const UL_COLOR = 0x3ad8c8;
const SINK_COLOR = 0xff6a4a;

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
  private readonly pigs = new PigRays();
  private readonly ulGroup = new THREE.Group();
  readonly uls: UlRay[] = [];

  /** Its height off the floor (below 0: under the sea). */
  alt: number = cfg.hover;
  private wave = 0;
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
  /** A glide in flight: its heading, the distance left, and whether it has hit you. */
  private fly: { yaw: number; left: number; hit: boolean } | null = null;
  /** Where a belly crash hangs before it drops. */
  private hangAt: Pt | null = null;
  // ---- the flood
  floods = 0;
  private nextFlood = cfg.floodFirst;
  /** Seconds since it was last back up from the beach. */
  private upT = Infinity;
  private floodT = 0;
  private sinkT = 0;
  /** Your share of max HP the water has taken but not shown yet, and where your body was last frame. */
  private drowned = 0;
  private lastBody: Pt | null = null;
  private taught = false;
  /** Where it dives into the sea (past the rim) and where it beaches after. */
  private diveAt: Pt | null = null;
  private beachAt: Pt | null = null;
  // ---- the Pig Rays
  private pigT = 2;

  constructor(room: Rect, hard: HardBossScale | null = null) {
    super(cfg, hard);
    this.cx = (room.minX + room.maxX) / 2;
    this.cz = (room.minZ + room.maxZ) / 2;
    this.pos.set(this.cx, 0, this.cz - cfg.perch);
    this.group.add(this.model.group);
    this.platforms = new Platforms(this.cx, this.cz);
    this.water = new Water(this.cx, this.cz);
  }

  // ---------------------------------------------------------------- Boss

  get objects(): THREE.Object3D[] {
    return [this.group, this.platforms.group, this.water.group, this.pigs.group, this.ulGroup];
  }
  /** Itself (unless under the sea) and the Ul Rays up in a flood. */
  parts(): Hittable[] {
    const out: Hittable[] = this.submerged ? [] : [this];
    for (const u of this.uls) if (u.alive) out.push(u);
    return out;
  }

  collide(playerPos: THREE.Vector3, playerRadius: number, level: Level): void {
    if (this.alive && !this.submerged && this.alt < 2.6) separateCircles(playerPos, playerRadius, 1, this.pos, this.radius, 1000);
    // The court is round, with the sea all round it.
    this.clampToCourt(playerPos, playerRadius);
    if (!this.submerged) this.clampToCourt(this.pos, this.radius);
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
    if (this.state === 'dive') return '  — THE TIDE RISES';
    if (this.state === 'flood') return `  — FLOOD · ${Math.max(0, Math.ceil((cfg.floodTime - this.floodT) / this.tempo))} s`;
    if (this.state === 'beached') return '  — BEACHED';
    return this.phase3 ? '  — THE WHIRLPOOL' : this.phase2 ? '  — THE DEEP STIRS' : '';
  }

  // ------------------------------------------------------------ Hittable

  /** Under the sea (diving, the flood, the drain, leaping out): it can't be hit, and it doesn't block. */
  get submerged(): boolean {
    return this.state === 'dive' || this.state === 'flood' || this.state === 'drain' || this.state === 'leap';
  }
  get aimHeight(): number {
    return this.alt + 1.2;
  }
  get invulnerable(): boolean {
    return this.untouchable || this.submerged || this.alt > 5;
  }
  get weakPointOpen(): boolean {
    return this.state === 'beached';
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
    this.alt = Math.max(0, this.alt - dt * 3);
    this.animate(dt);
  }

  protected always(dt: number, ctx: BossContext): void {
    const flooded = this.state === 'flood';
    this.platforms.update(dt, this.time, flooded || this.state === 'dive');
    this.water.update(dt, this.time, flooded ? 1 : 0, flooded && this.phase3);
    this.updatePigs(dt, ctx);
    this.updateUls(dt, ctx);
  }

  protected onDeath(): void {
    this.pigs.clear();
    for (const u of this.uls) u.sink();
    for (const p of this.platforms.list) p.rise();
    this.steps = [];
    this.fly = null;
  }

  protected think(dt: number, ctx: BossContext): void {
    const dist = Math.hypot(ctx.playerX - this.pos.x, ctx.playerZ - this.pos.z);
    const toPlayer = yawTo(this.pos.x, this.pos.z, ctx.playerX, ctx.playerZ);
    if (this.engaged && this.state !== 'intro') {
      this.fightT += dt;
      this.upT += dt;
    }
    this.announceEnrage(ctx, true, 'Barba Ray is enraged!', 'barba.call');
    if (!this.phase2 && this.hp <= this.maxHp * cfg.phase2At) {
      this.phase2 = true;
      this.escalate(ctx, 'The deep stirs!');
      ctx.shake(0.5);
      this.sound('barba.call');
    }
    if (!this.phase3 && this.hp <= this.maxHp * cfg.phase3At) {
      this.phase3 = true;
      this.escalate(ctx, 'The whirlpool!');
      ctx.shake(0.6);
      this.sound('barba.call');
    }

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
        // It keeps its distance, drifting round you as it glides.
        const want = dist > cfg.keepAway + 2 ? 1 : dist < cfg.keepAway - 2 ? -0.6 : 0;
        const side = this.yaw + Math.PI / 2;
        this.pos.x += (Math.sin(this.yaw) * want + Math.sin(side) * 0.45) * cfg.glideAbout * dt;
        this.pos.z += (Math.cos(this.yaw) * want + Math.cos(side) * 0.45) * cfg.glideAbout * dt;
        this.alt += (cfg.hover - this.alt) * Math.min(1, dt * 3);
        this.cooldown -= dt;
        if (this.cooldown > 0) break;
        if (this.startFlood(ctx)) break;
        this.chooseAttack(ctx);
        break;
      }

      case 'attack':
        this.runAttack(dt, ctx);
        break;

      case 'dive':
        // Out over the rim and down into the sea while the court is warned.
        if (this.diveAt) {
          this.pos.x += (this.diveAt[0] - this.pos.x) * Math.min(1, dt * 2.5);
          this.pos.z += (this.diveAt[1] - this.pos.z) * Math.min(1, dt * 2.5);
          this.yaw = turnToward(this.yaw, yawTo(this.cx, this.cz, this.diveAt[0], this.diveAt[1]), 4 * dt);
        }
        this.alt = this.stateT < 0.8 ? Math.min(3, this.alt + dt * 3) : Math.max(-3, this.alt - dt * 6);
        if (this.stateT >= cfg.floodWarn) this.beginFlood(ctx);
        break;

      case 'flood':
        this.updateFlood(dt, ctx);
        break;

      case 'drain':
        this.lastBody = null;
        if (this.stateT >= cfg.drainTime) this.leap(ctx);
        break;

      case 'leap':
        // Out of the sea in an arc onto the court (the landing is warned).
        if (this.beachAt) {
          const k = Math.min(1, this.stateT / cfg.drainTime);
          this.pos.x += (this.beachAt[0] - this.pos.x) * Math.min(1, dt * 4);
          this.pos.z += (this.beachAt[1] - this.pos.z) * Math.min(1, dt * 4);
          this.alt = -2 + 9 * Math.sin(k * Math.PI) + 2 * k;
        }
        break;

      case 'beached':
        this.alt = 0;
        if (this.stateT >= cfg.beachedTime) {
          this.upT = 0;
          this.endAttack(1.2);
        }
        break;

      case 'recover':
        this.alt += (cfg.hover - this.alt) * Math.min(1, dt * 2);
        if (this.stateT >= this.recoverFor) this.enter('stalk');
        break;
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
      default:
        this.alt += (cfg.hover - this.alt) * Math.min(1, dt * 3);
    }
    if (this.fly) this.flyGlide(dt, ctx);
    if (!this.steps.length && !this.fly && this.stateT >= this.actEnd) this.endAttack(0.7);
  }

  private chooseAttack(ctx: BossContext): void {
    const pool: Attack[] = !this.phase2 ? ['glideSpouts', 'crashRipple', 'burstGlide'] : ['glideTriple', 'crashTriple', 'burstGlide'];
    const pick = this.pickAttack(ctx, pool);
    this.begin();
    switch (pick) {
      case 'glideSpouts':
      case 'glideTriple':
        this.glideThen(ctx, () => {
          this.spouts(ctx, this.pos.x, this.pos.z, yawTo(this.pos.x, this.pos.z, ctx.playerX, ctx.playerZ));
          if (pick === 'glideTriple') this.after(0.7 * this.sm(), () => this.burst(ctx));
        });
        break;
      case 'crashRipple':
      case 'crashTriple':
        this.crash(ctx, (x, z) => {
          this.ripple(ctx, x, z);
          if (pick === 'crashTriple') this.after(cfg.rippleStep, () => this.burst(ctx));
        });
        break;
      case 'burstGlide':
        this.burst(ctx);
        this.after(0.6 * this.sm(), () => this.glideThen(ctx));
        break;
      default:
        this.endAttack(0.5);
    }
  }

  /** How far it can fly from (x, z) along `yaw` before the rim (m). */
  private toRim(x: number, z: number, yaw: number, margin: number): number {
    return toCircle(x, z, yaw, this.cx, this.cz, cfg.arenaRadius - margin);
  }

  /** Glide: a lane from it through you to the far rim, warned; then it flies it. `then` runs as it reaches the end. */
  private glideThen(ctx: BossContext, then?: () => void): void {
    const windup = cfg.glideWindup * this.sm();
    const yaw = (this.yaw = yawTo(this.pos.x, this.pos.z, ctx.playerX, ctx.playerZ));
    const dist = Math.hypot(ctx.playerX - this.pos.x, ctx.playerZ - this.pos.z);
    const len = Math.max(dist + 4, this.toRim(this.pos.x, this.pos.z, yaw, cfg.radius));
    this.pose = 'glideWindup';
    this.sound('barba.call');
    this.warn(ctx, { kind: 'line', x: this.pos.x, z: this.pos.z, yaw, length: len, width: cfg.glideWidth }, windup, undefined, undefined, this.enraged);
    this.after(windup, () => {
      this.fly = { yaw, left: len, hit: false };
      this.pose = 'glide';
      this.sound('barba.glide');
    });
    if (then) this.after(windup + len / cfg.glideSpeed, then);
  }

  private flyGlide(dt: number, ctx: BossContext): void {
    const f = this.fly!;
    const step = Math.min(f.left, cfg.glideSpeed * dt);
    this.pos.x += Math.sin(f.yaw) * step;
    this.pos.z += Math.cos(f.yaw) * step;
    this.yaw = f.yaw;
    this.alt = 1.1;
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

  /** Spouts: geysers along `yaw` from (x, z), each a little after the last, the first warned `spoutWindup`. */
  private spouts(ctx: BossContext, x: number, z: number, yaw: number): void {
    const windup = cfg.spoutWindup * this.sm();
    this.pose = 'spout';
    this.yaw = yaw;
    this.sound('barba.spout');
    spoutLine(x, z, yaw).forEach(([sx, sz], i) => {
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
        if (!this.alive) return;
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

  /** A burst of Pig Rays from its mouth: lanes fanned at you, the middle one straight at you; step into a gap. */
  private burst(ctx: BossContext): void {
    const windup = cfg.burstWindup * this.sm();
    const yaw = (this.yaw = yawTo(this.pos.x, this.pos.z, ctx.playerX, ctx.playerZ));
    const x = this.pos.x;
    const z = this.pos.z;
    this.pose = 'burst';
    this.sound('barba.pig');
    for (const a of burstYaws(yaw)) {
      const length = this.toRim(x, z, a, 0) + 1;
      this.warn(ctx, { kind: 'line', x, z, yaw: a, length, width: cfg.pigWidth }, windup, PIG_COLOR, () => {
        if (this.alive) this.pigs.add({ x, z, yaw: a, left: length, hit: false, t: 0, speed: cfg.burstSpeed });
      });
    }
    this.hold(windup);
  }

  // ---------------------------------------------------------- the Pig Rays

  /**
   * All fight long (not before it wakes, nor once it is dead): every `pigEvery` s (faster in phase 2; in pairs below
   * 1/3) a Pig Ray's lane lights from a random point past the rim through near you, and it darts down it `pigWarn` s
   * later. A touch is a light hit and the ray is gone.
   */
  private updatePigs(dt: number, ctx: BossContext): void {
    const fighting = this.alive && this.state !== 'dormant' && this.state !== 'intro';
    if (fighting && ctx.playerAlive) {
      this.pigT -= dt;
      if (this.pigT <= 0) {
        this.pigT += this.phase3 ? cfg.pigEvery3 : this.phase2 ? cfg.pigEvery2 : cfg.pigEvery;
        for (let i = this.phase3 ? 2 : 1; i > 0; i--) this.pigLane(ctx);
      }
    }
    const pr = playerCfg.radius;
    this.pigs.update(dt, this.time, (p) => {
      if (!fighting || !ctx.playerAlive || p.hit || !pigTouches(p, ctx.playerX, ctx.playerZ, pr)) return true;
      p.hit = true;
      return !ctx.hitPlayer({ kind: 'circle', x: p.x, z: p.z, radius: cfg.pigRadius }, cfg.pigAtp, p.x, p.z, 2);
    });
  }

  private pigLane(ctx: BossContext): void {
    const lane = pigLane(this.cx, this.cz, ctx.playerX, ctx.playerZ, ctx.rng);
    this.warn(ctx, { kind: 'line', x: lane.x, z: lane.z, yaw: lane.yaw, length: lane.length, width: cfg.pigWidth }, cfg.pigWarn, PIG_COLOR, () => {
      if (!this.alive) return;
      this.pigs.add({ x: lane.x, z: lane.z, yaw: lane.yaw, left: lane.length, hit: false, t: 0 });
      this.sound('barba.pig', lane.x, lane.z);
    });
  }

  // ---------------------------------------------------------- the flood

  /** The flood, when it's due (not sooner than `floodAfterUp` s after it is back up from the beach): it dives, the court is warned. */
  private startFlood(ctx: BossContext): boolean {
    if (this.fightT < this.nextFlood || this.upT < cfg.floodAfterUp) return false;
    this.floods++;
    this.nextFlood = this.fightT + cfg.floodEvery;
    this.pose = 'idle';
    this.steps = [];
    // Out over the nearest rim, then down into the sea.
    const out = Math.atan2(this.pos.x - this.cx, this.pos.z - this.cz);
    this.diveAt = [this.cx + Math.sin(out) * (cfg.arenaRadius + 4), this.cz + Math.cos(out) * (cfg.arenaRadius + 4)];
    this.enter('dive');
    this.warn(ctx, { kind: 'circle', x: this.cx, z: this.cz, radius: cfg.arenaRadius + 0.5 }, cfg.floodWarn, WATER_COLOR);
    this.sound('barba.flood');
    ctx.shake(0.3);
    if (!this.taught) {
      this.taught = true;
      ctx.announce('Barba Ray floods the court: stand on the platforms!');
    }
    return true;
  }

  /** The water is up: the Ul Rays rise, the platforms start sinking. */
  private beginFlood(ctx: BossContext): void {
    this.enter('flood');
    this.floodT = 0;
    this.sinkT = cfg.sinkFirst;
    this.drowned = 0;
    this.lastBody = null;
    const n = this.phase2 ? cfg.ulCount2 : cfg.ulCount;
    const a0 = ctx.rng() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      const [lo, hi] = cfg.ulEvery;
      const u = new UlRay(this.maxHp * cfg.ulHpShare, a0 + (i / n) * Math.PI * 2, i % 2 ? 1 : -1, 1.5 + i * 1.2 + ctx.rng() * (hi - lo));
      u.pos.set(this.cx + Math.sin(u.ang) * cfg.ulSwim, -1.2, this.cz + Math.cos(u.ang) * cfg.ulSwim);
      this.uls.push(u);
      this.ulGroup.add(u.group);
    }
    ctx.shake(0.4);
    this.sound('barba.splash');
  }

  private updateFlood(dt: number, ctx: BossContext): void {
    this.floodT += dt;
    // Sinks: one every `sinkEvery` s, none whose warning would run past the drain.
    this.sinkT -= dt;
    if (this.sinkT <= 0 && this.floodT + cfg.sinkWarn <= cfg.floodTime) {
      this.sinkT = cfg.sinkEvery;
      this.sinkOne(ctx);
    }
    if (ctx.playerAlive) this.waterOn(dt, ctx);
    if (this.floodT >= cfg.floodTime) this.drain();
  }

  /** Warn a platform (the one you stand on most of the time, else one near you; in a whirlpool the innermost) and sink it. */
  private sinkOne(ctx: BossContext): void {
    const list = this.platforms.list;
    const i = sinkPick(list, ctx.playerX, ctx.playerZ, this.cx, this.cz, ctx.rng, this.phase3);
    if (i < 0) return;
    const p = list[i];
    p.sinking = true;
    this.warn(ctx, { kind: 'circle', x: p.x, z: p.z, radius: cfg.platformR }, cfg.sinkWarn, SINK_COLOR, () => {
      if (!this.alive || this.state !== 'flood') {
        p.sinking = false;
        return;
      }
      p.sink();
      ctx.effect(new Ring(p.x, p.z, 0xe6f8ff, 2.4, 0.5));
      this.sound('barba.sink', p.x, p.z);
    });
  }

  /**
   * You in the flood: off a standing platform the water takes `waterShare` of your max HP a (real) second, shown in
   * chunks, and slows you; a dash (or a shove) skims it. Phase 3: the whirlpool drags you toward the middle.
   */
  private waterOn(dt: number, ctx: BossContext): void {
    const body = ctx.body();
    const real = dt / this.tempo;
    if (this.phase3) {
      const dx = this.cx - body.pos.x;
      const dz = this.cz - body.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.3) {
        const pull = Math.min(d, cfg.whirlPull * dt);
        body.pos.x += (dx / d) * pull;
        body.pos.z += (dz / d) * pull;
      }
    }
    const last = this.lastBody;
    this.lastBody = [body.pos.x, body.pos.z];
    const dry = platformAt(this.platforms.list, body.pos.x, body.pos.z) >= 0;
    const moved = last ? Math.hypot(body.pos.x - last[0], body.pos.z - last[1]) : 0;
    const skimming = real > 0 && moved / real > playerCfg.moveSpeed * 1.6;
    if (dry || skimming) {
      this.flushDrown(ctx);
      return;
    }
    // Slowed: give back part of this frame's step.
    if (last && moved > 0) {
      body.pos.x -= (body.pos.x - last[0]) * cfg.waterSlow;
      body.pos.z -= (body.pos.z - last[1]) * cfg.waterSlow;
      this.lastBody = [body.pos.x, body.pos.z];
    }
    this.drowned += cfg.waterShare * real;
    if (this.drowned >= cfg.waterShare * cfg.waterTick) this.flushDrown(ctx);
  }

  private flushDrown(ctx: BossContext): void {
    if (this.drowned <= 0) return;
    ctx.drown(this.drowned, 'Flood');
    this.drowned = 0;
  }

  /** The flood ends: the water drains, the Ul Rays sink away, the platforms rise; it leaps out after `drainTime`. */
  private drain(): void {
    this.enter('drain');
    for (const u of this.uls) u.sink();
    for (const p of this.platforms.list) p.rise();
    this.sound('barba.flood');
  }

  /** Out of the sea onto the court, `beachLand` m from you toward the middle (the landing is warned): beached. */
  private leap(ctx: BossContext): void {
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
    this.beachAt = [x, z];
    this.yaw = yawTo(x, z, ctx.playerX, ctx.playerZ);
    this.enter('leap');
    this.sound('barba.splash');
    const shape: TelegraphShape = { kind: 'circle', x, z, radius: cfg.radius + 1 };
    this.warn(ctx, shape, cfg.drainTime, undefined, () => {
      if (!this.alive) return;
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

  /**
   * In a flood the Ul Rays swim round the court and, every few seconds each, lunge at you along a warned lane (a hit
   * that can knock you off your platform). Dead ones and, after the drain, all of them sink out of sight.
   */
  private updateUls(dt: number, ctx: BossContext): void {
    const flooding = this.state === 'flood' && this.alive;
    for (let i = this.uls.length - 1; i >= 0; i--) {
      const u = this.uls[i];
      let face = u.group.rotation.y;
      if (u.alive && flooding) {
        if (u.lunge) {
          const l = u.lunge;
          const step = Math.min(l.left, cfg.ulSpeed * dt);
          u.pos.x += Math.sin(l.yaw) * step;
          u.pos.z += Math.cos(l.yaw) * step;
          l.left -= step;
          face = l.yaw;
          if (!l.hit && ctx.playerAlive) {
            if (ctx.hitPlayer({ kind: 'circle', x: u.pos.x, z: u.pos.z, radius: u.radius + 0.3 }, cfg.ulAtp, u.pos.x, u.pos.z, cfg.ulKnockback)) l.hit = true;
          }
          if (l.left <= 0) {
            u.lunge = null;
            u.ang = Math.atan2(u.pos.x - this.cx, u.pos.z - this.cz);
          }
        } else {
          // Swim round the court, easing back out to the swim circle.
          u.ang += (u.dir * 3 * dt) / cfg.ulSwim;
          const r = Math.min(cfg.ulSwim, Math.hypot(u.pos.x - this.cx, u.pos.z - this.cz) + 4 * dt);
          const tx = this.cx + Math.sin(u.ang) * r;
          const tz = this.cz + Math.cos(u.ang) * r;
          face = Math.atan2(tx - u.pos.x, tz - u.pos.z);
          u.pos.x = tx;
          u.pos.z = tz;
          if (!u.winding) u.lungeT -= dt;
          if (!u.winding && u.lungeT <= 0 && ctx.playerAlive) this.ulLunge(u, ctx);
        }
      }
      if (!u.update(dt, this.time, face)) {
        this.ulGroup.remove(u.group);
        this.uls.splice(i, 1);
      }
    }
  }

  private ulLunge(u: UlRay, ctx: BossContext): void {
    const yaw = yawTo(u.pos.x, u.pos.z, ctx.playerX, ctx.playerZ);
    const dist = Math.hypot(ctx.playerX - u.pos.x, ctx.playerZ - u.pos.z);
    const length = Math.min(dist + 4, toCircle(u.pos.x, u.pos.z, yaw, this.cx, this.cz, cfg.arenaRadius));
    u.winding = true;
    this.warn(ctx, { kind: 'line', x: u.pos.x, z: u.pos.z, yaw, length, width: cfg.ulWidth }, cfg.ulWarn, UL_COLOR, () => {
      u.winding = false;
      const [lo, hi] = cfg.ulEvery;
      u.lungeT = lo + ctx.rng() * (hi - lo);
      if (!u.alive || this.state !== 'flood') return;
      u.lunge = { yaw, left: length, hit: false };
      this.sound('barba.glide', u.pos.x, u.pos.z);
    });
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
    let spots = this.phase3 ? 0.7 : this.phase2 ? 0.45 : 0.2;
    let weak = 0;
    let flat = 0;
    const pose = this.state === 'attack' ? this.pose : 'idle';
    if (this.state === 'intro') {
      flap = 1;
      speed = 3.4;
      mouth = this.stateT < 1.4 ? 1 : 0.2;
      spots = 0.8;
      pitch = -0.2;
    } else if (this.state === 'dive' || this.state === 'leap') {
      flap = 0.9;
      speed = 3;
      pitch = this.state === 'dive' ? 0.6 : -0.5;
    } else if (this.state === 'beached') {
      // Sprawled on the court, wings slumped, spiracles aglow.
      flap = 0.12;
      speed = 1.1;
      flat = 1;
      mouth = 0.3 + 0.2 * Math.sin(t * 2);
      spots = 0.1;
      weak = 0.45 + Math.sin(t * 8) * 0.2;
      tail = Math.sin(t * 1.3) * 0.3;
    } else if (this.state === 'dead') {
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
      case 'burst':
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
