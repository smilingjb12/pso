import * as THREE from 'three';
import { ai, nodes as nodeCfg, type EnemyArchetype, type EnemyId } from '../config';
import { angleDelta, turnToward, yawTo } from '../collision';
import {
  DroneModel, dronePoses, garanzPoses, GaranzModel, gunbotPoses, GunbotModel, MiteModel, mitePoses, NodeModel, nodePoses, sinowPoses, SinowModel,
} from '../models/mines';
import type { Pose } from '../models/Rig';
import type { TelegraphShape } from '../world/Telegraph';
import { Enemy, type EnemyContext, type EnemyOptions } from './Enemy';

// Mines machines. Movement and attack timings scale with `tempo` (Overclocked
// elites run 30% faster). Sounds are raised as cues (see AudioCues).

// ------------------------------------------------------------- Gillchic

/**
 * Walking gunbot. Closes to about 9 m and fires a telegraphed line shot;
 * swipes with its pincer if you get close. Linked to a control node, a lethal
 * hit knocks it offline instead and it reboots until the node goes down.
 */
export class Gunbot extends Enemy {
  /** The control node keeping it alive (set by the world). */
  link: Enemy | null = null;
  rebooted = false;
  protected selfTempo = true;
  private model: GunbotModel;
  private shotCd: number;
  private walkPhase = 0;
  private lastX: number;
  private lastZ: number;
  private strikeConnected = false;
  private fired = false;
  protected meleeStrikes = true;

  constructor(type: EnemyId, arch: EnemyArchetype, x: number, z: number, rng: () => number, opts: EnemyOptions = {}) {
    const model = new GunbotModel(arch.color);
    super(type, arch, x, z, rng, model.rig, opts);
    this.model = model;
    this.shotCd = 1 + rng() * 1.5;
    this.strafeDir = rng() < 0.5 ? -1 : 1;
    this.lastX = x;
    this.lastZ = z;
  }

  get invulnerable(): boolean {
    return this.state === 'spawning' || this.state === 'offline';
  }

  damage(amount: number, fromX: number, fromZ: number, knockback: number, stagger: number): boolean {
    if (!this.alive || this.invulnerable) return false;
    if (this.link?.alive && this.hp - amount <= 0) {
      // Linked: knocked offline, not killed (no reward until it really goes down).
      this.hp = 0;
      this.flashT = 0.08;
      this.tele.cancelAll();
      this.burnT = 0;
      this.poisonT = 0;
      this.enter('offline');
      this.cue('gunbot.offline');
      return false;
    }
    return super.damage(amount, fromX, fromZ, knockback, stagger);
  }

  /** Its node went down: power off for good (the world awards the kill). */
  shutdown(): void {
    this.hp = 0;
    this.enter('dead');
  }

  protected telegraphHeat(): number {
    return this.state === 'strike' ? 1 : this.windupK();
  }

  /** Overclocked: the same attack again (a swipe with a quicker windup, or another shot down a fresh lane). */
  protected followUp(ctx: EnemyContext): boolean {
    if (!ctx.playerAlive) return false;
    if (this.fired) this.aim(ctx, yawTo(this.pos.x, this.pos.z, ctx.playerX, ctx.playerZ));
    else this.beginWindup('windup', this.arch.windup * this.windupScale);
    return true;
  }

  protected think(dt: number, ctx: EnemyContext, dist: number, toPlayer: number): void {
    const a = this.arch;
    const tempo = this.tempo;
    this.shotCd = Math.max(0, this.shotCd - dt * tempo);
    if (this.state === 'offline') {
      if (this.stateT >= nodeCfg.rebootAfter && this.link?.alive) {
        this.hp = Math.max(1, Math.round(this.maxHp * nodeCfg.rebootHp));
        this.noCharge = true; // a farm of rebooting bots must not refill injectors
        this.rebooted = true;
        this.stunFor = 0.7;
        this.enter('hitstun');
        this.cue('gunbot.reboot');
      }
      return;
    }
    if (this.commonState('chase')) return;
    switch (this.state) {
      case 'idle':
        if (ctx.playerAlive && dist < a.aggroRange) this.enter('chase');
        break;

      case 'chase':
      case 'hover': {
        if (!ctx.playerAlive) {
          this.enter('idle');
          break;
        }
        this.yaw = turnToward(this.yaw, toPlayer, a.turnSpeed * tempo * dt);
        const facing = Math.abs(angleDelta(this.yaw, toPlayer)) < 0.35;
        if (dist <= a.attackRange && this.cooldown <= 0 && facing && ctx.requestAttackToken(this)) {
          this.beginWindup('windup', a.windup * this.windupScale);
          this.cue('gunbot.swipe');
          break;
        }
        // Close to within 9 m and hold there, drifting sideways (they never back away: melee can catch them).
        this.strafe(ctx, dt, toPlayer, dist > 9 ? 1 : 0, dist < 4 ? 0.2 : 0.45, a.moveSpeed * tempo, 0.35);
        if (dist <= (a.shotRange ?? 16) && dist > 2.5 && this.shotCd <= 0 && facing && ctx.requestShot(this)) this.aim(ctx, toPlayer);
        break;
      }

      case 'aim':
        // The lane is fixed once the telegraph is down: step out of it.
        if (this.stateT > (a.shotWindup ?? 1) / tempo + 0.25) this.enter('recover');
        break;

      case 'windup':
        this.yaw = turnToward(this.yaw, toPlayer, a.turnSpeed * 0.35 * dt);
        if (this.windupDone()) {
          this.strikeConnected = false;
          this.enter('strike');
        }
        break;

      case 'strike': {
        const step = (a.lunge / a.strikeActive) * dt;
        this.pos.x += Math.sin(this.yaw) * step;
        this.pos.z += Math.cos(this.yaw) * step;
        if (!this.strikeConnected && ctx.tryStrike(this)) this.strikeConnected = true;
        if (this.stateT >= a.strikeActive) {
          this.fired = false;
          this.enter('recover');
        }
        break;
      }

      case 'recover':
        if (this.stateT >= a.recovery / tempo) {
          this.rollCooldown(ctx, 0.6, 0.8);
          this.enter('chase');
        }
        break;
    }
  }

  private aim(ctx: EnemyContext, toPlayer: number): void {
    const a = this.arch;
    this.yaw = toPlayer;
    const shape: TelegraphShape = { kind: 'line', x: this.pos.x, z: this.pos.z, yaw: toPlayer, length: a.shotRange ?? 16, width: (a.shotRadius ?? 0.9) * 2 };
    this.beginWindup('aim', a.shotWindup ?? 1);
    this.cue('gunbot.charge');
    this.warn(ctx, shape, a.shotWindup ?? 1, () => {
      if (!this.alive || this.state !== 'aim') return;
      ctx.areaStrike(this, shape, 0.85, 4);
      ctx.tracer(shape.x, shape.z, shape.yaw, shape.length, 0xff6040);
      this.cue('gunbot.shot');
      this.fired = true;
      this.shotCd = this.rollShotCd(ctx, 3.4);
      this.enter('recover');
    }, 0xff5030);
  }

  protected targetPose(dt: number): { pose: Pose; rate: number } {
    const moved = Math.hypot(this.pos.x - this.lastX, this.pos.z - this.lastZ);
    this.lastX = this.pos.x;
    this.lastZ = this.pos.z;
    const speed = dt > 0 ? moved / dt : 0;
    this.walkPhase += (moved / 1.3) * Math.PI * 2;
    switch (this.state) {
      case 'spawning':
        return { pose: gunbotPoses.crouch(), rate: 6 };
      case 'offline':
        return { pose: gunbotPoses.offline(), rate: 8 };
      case 'aim':
        return { pose: gunbotPoses.aim(Math.min(1, this.stateT / 0.3)), rate: 14 };
      case 'windup':
        return { pose: gunbotPoses.windup(this.windupK()), rate: 20 };
      case 'strike':
        return { pose: gunbotPoses.strike(), rate: 35 };
      case 'recover':
        if (this.fired && this.stateT < 0.3) return { pose: gunbotPoses.fire(), rate: 30 };
        return { pose: gunbotPoses.idle(this.time), rate: 5 };
      case 'hitstun':
      case 'dead':
        return { pose: gunbotPoses.hurt(), rate: 22 };
      case 'frozen':
        return { pose: gunbotPoses.hurt(), rate: 0 };
      default:
        if (speed > 0.3) return { pose: gunbotPoses.walk(this.walkPhase, Math.min(1, speed / 2)), rate: 10 };
        return { pose: gunbotPoses.idle(this.time), rate: 6 };
    }
  }

  protected animate(dt?: number): void {
    super.animate(dt);
    const off = this.state === 'offline' || this.state === 'dead';
    this.model.eye.emissiveIntensity = off ? 0.08 : this.state === 'aim' ? 2.4 + Math.sin(this.time * 40) * 0.6 : 1.6;
    this.model.muzzle.emissiveIntensity = this.state === 'aim' ? 2.5 : 0.5;
  }
}

// ---------------------------------------------------------------- Garanz

/** Seconds to plant before the barrage, and between missiles. */
const PLANT_TIME = 0.9;
const LAUNCH_GAP = 0.3;
const MISSILES = 5;
/** Seconds it stays planted after the barrage. */
const PLANTED_AFTER = 1.5;
/** Missiles only reach targets in front of a planted Garanz. */
const FRONT_ARC = 1.3;

/**
 * Artillery tank. Walks slowly, then plants itself (it can't turn while planted)
 * and fires a barrage at where you were. Crowd it while it walks and it stomps.
 */
export class Garanz extends Enemy {
  protected topplesOnDeath = false;
  protected selfTempo = true;
  private model: GaranzModel;
  private shotCd: number;
  private planted = false;
  private missilesLeft = 0;
  private launchT = 0;
  private lastLaunch = 10;
  private walkPhase = 0;
  private lastX: number;
  private lastZ: number;

  constructor(type: EnemyId, arch: EnemyArchetype, x: number, z: number, rng: () => number, opts: EnemyOptions = {}) {
    const model = new GaranzModel(arch.color);
    super(type, arch, x, z, rng, model.rig, opts);
    this.model = model;
    this.shotCd = 1.5 + rng() * 1.5;
    this.lastX = x;
    this.lastZ = z;
  }

  get aimHeight(): number {
    return 1.5;
  }

  protected flinch(): void {
    // Knocked out of its stance: the rest of the barrage (and a stomp) is called off (missiles in flight still land).
    this.missilesLeft = 0;
    this.planted = false;
    this.enter('hitstun');
  }

  protected telegraphHeat(): number {
    return this.state === 'cast' ? 0.8 : this.windupK();
  }

  protected think(dt: number, ctx: EnemyContext, dist: number, toPlayer: number): void {
    const a = this.arch;
    const tempo = this.tempo;
    this.shotCd = Math.max(0, this.shotCd - dt * tempo);
    this.lastLaunch += dt;
    if (this.commonState('chase')) return;
    switch (this.state) {
      case 'idle':
        if (ctx.playerAlive && dist < a.aggroRange) this.enter('chase');
        break;

      case 'chase':
      case 'hover': {
        if (!ctx.playerAlive) {
          this.enter('idle');
          break;
        }
        this.yaw = turnToward(this.yaw, toPlayer, a.turnSpeed * tempo * dt);
        const facing = Math.abs(angleDelta(this.yaw, toPlayer)) < 0.4;
        if (dist <= a.attackRange + 0.3 && this.cooldown <= 0 && ctx.requestAttackToken(this)) {
          this.stomp(ctx);
          break;
        }
        if (dist <= (a.shotRange ?? 20) && dist > 4 && this.shotCd <= 0 && facing && ctx.requestShot(this, ai.barrageThreat)) {
          this.planted = true;
          this.beginWindup('aim', PLANT_TIME);
          this.cue('garanz.plant');
          break;
        }
        if (dist > 7) {
          this.pos.x += Math.sin(this.yaw) * a.moveSpeed * tempo * dt;
          this.pos.z += Math.cos(this.yaw) * a.moveSpeed * tempo * dt;
        }
        break;
      }

      case 'aim':
        if (this.windupDone()) {
          this.missilesLeft = MISSILES;
          this.launchT = 0;
          this.enter('cast');
        }
        break;

      case 'cast':
        this.launchT -= dt;
        if (this.missilesLeft > 0 && this.launchT <= 0) {
          this.launch(ctx);
          this.missilesLeft--;
          this.launchT = LAUNCH_GAP / tempo;
        }
        if (this.missilesLeft === 0 && this.launchT <= 0) this.enter('recover');
        break;

      case 'burst':
        if (this.stateT > a.windup / tempo + 0.2) this.enter('recover'); // telegraph lost
        break;

      case 'strike':
        if (this.stateT >= 0.3) this.enter('recover');
        break;

      case 'recover': {
        const hold = this.planted ? PLANTED_AFTER : a.recovery;
        if (this.stateT >= hold / tempo) {
          if (this.planted) this.shotCd = this.rollShotCd(ctx, 4.5);
          this.planted = false;
          this.rollCooldown(ctx);
          this.enter('chase');
        }
        break;
      }
    }
  }

  /** Overclocked: a second stomp. A missile barrage already takes the whole threat budget: none after it. */
  protected followUp(ctx: EnemyContext): boolean {
    if (this.planted || !ctx.playerAlive) return false;
    this.stomp(ctx);
    return true;
  }

  private stomp(ctx: EnemyContext): void {
    const a = this.arch;
    const shape: TelegraphShape = { kind: 'circle', x: this.pos.x, z: this.pos.z, radius: a.strikeRange };
    this.beginWindup('burst', a.windup);
    this.cue('garanz.plant');
    this.warn(ctx, shape, a.windup, () => {
      if (!this.alive || this.state !== 'burst') return;
      ctx.areaStrike(this, shape, 0.9, a.strikeKnockback ?? 10);
      this.cue('garanz.stomp');
      this.enter('strike');
    }, 0xff7030);
  }

  /** One missile: at where the player stands if she is in front, else wasted on the floor ahead. */
  private launch(ctx: EnemyContext): void {
    const a = this.arch;
    let tx: number;
    let tz: number;
    const toP = yawTo(this.pos.x, this.pos.z, ctx.playerX, ctx.playerZ);
    if (ctx.playerAlive && Math.abs(angleDelta(this.yaw, toP)) <= FRONT_ARC) {
      tx = ctx.playerX + (ctx.rng() - 0.5) * 1.2;
      tz = ctx.playerZ + (ctx.rng() - 0.5) * 1.2;
    } else {
      const ang = this.yaw + (ctx.rng() - 0.5) * 1.4;
      const d = 6 + ctx.rng() * 9;
      tx = this.pos.x + Math.sin(ang) * d;
      tz = this.pos.z + Math.cos(ang) * d;
    }
    const r = a.shotRadius ?? 1.8;
    const shape: TelegraphShape = { kind: 'circle', x: tx, z: tz, radius: r };
    const dur = (a.shotWindup ?? 1.25) / this.tempo;
    ctx.telegraph(shape, dur, () => {
      ctx.areaStrike(this, shape, 0.55, 6, a.shotStatus, a.shotStatusChance);
      ctx.blast(this, tx, tz, r);
    }, 0xff6a30);
    const pod = new THREE.Vector3(this.pos.x - Math.sin(this.yaw) * 0.3, 2.2, this.pos.z - Math.cos(this.yaw) * 0.3);
    ctx.missile(pod, tx, tz, dur);
    // The barrage holds its threat share until this missile lands.
    this.holdThreat(dur);
    this.lastLaunch = 0;
  }

  protected targetPose(dt: number): { pose: Pose; rate: number } {
    const moved = Math.hypot(this.pos.x - this.lastX, this.pos.z - this.lastZ);
    this.lastX = this.pos.x;
    this.lastZ = this.pos.z;
    const speed = dt > 0 ? moved / dt : 0;
    this.walkPhase += (moved / 1.1) * Math.PI * 2;
    switch (this.state) {
      case 'spawning':
        return { pose: garanzPoses.plant(1), rate: 6 };
      case 'aim':
        return { pose: garanzPoses.plant(this.windupK()), rate: 10 };
      case 'cast':
        return { pose: this.lastLaunch < 0.12 ? garanzPoses.fire() : garanzPoses.plant(1), rate: 25 };
      case 'recover':
        if (this.planted) {
          const hold = PLANTED_AFTER / this.tempo;
          return { pose: garanzPoses.plant(1 - Math.max(0, (this.stateT - (hold - 0.5)) / 0.5)), rate: 10 };
        }
        return { pose: garanzPoses.idle(this.time), rate: 5 };
      case 'burst':
        return { pose: garanzPoses.stompWindup(this.windupK()), rate: 14 };
      case 'strike':
        return { pose: garanzPoses.stomp(), rate: 35 };
      case 'hitstun':
        return { pose: garanzPoses.hurt(), rate: 22 };
      case 'dead':
        return { pose: garanzPoses.dead(), rate: 4 };
      case 'frozen':
        return { pose: garanzPoses.hurt(), rate: 0 };
      default:
        if (speed > 0.2) return { pose: garanzPoses.walk(this.walkPhase), rate: 10 };
        return { pose: garanzPoses.idle(this.time), rate: 6 };
    }
  }

  protected animate(dt?: number): void {
    super.animate(dt);
    this.model.eye.emissiveIntensity = this.alive ? 1.5 : 0.1;
    this.model.pods.emissiveIntensity = this.state === 'cast' ? 2.2 : this.state === 'aim' ? 0.4 + this.stateT * 2 : 0.4;
  }
}

// ----------------------------------------------------------------- Sinow

type SinowPhase = 'crouch' | 'leap' | 'combo' | 'flip' | 'land';

const LEAP_TIME = 0.35;
const HIT_TIME = 0.42;
const HIT_CONTACT = 0.2;
const FLIP_TIME = 0.45;
const FLIP_DIST = 4.2;

/**
 * Ninja robot. Circles at range, crouches and leaps in with a three-hit combo
 * (the last hit burns), then backflips away and lands in a short recovery.
 * Pairs take turns: only one Sinow attacks at a time.
 */
export class Sinow extends Enemy {
  /** The Sinow currently attacking (pairs stagger their leaps). */
  private static busy: Sinow | null = null;
  protected selfTempo = true;
  private model: SinowModel;
  private phase: SinowPhase = 'land';
  private hitIndex = 0;
  private hitT = 0;
  private struck = false;
  private from = new THREE.Vector3();
  private to = new THREE.Vector3();
  private hop = 0;
  private spin = 0;
  /** This attack started in reach: no leap after the crouch. */
  private close = false;
  private runPhase = 0;
  private lastX: number;
  private lastZ: number;

  constructor(type: EnemyId, arch: EnemyArchetype, x: number, z: number, rng: () => number, opts: EnemyOptions = {}) {
    const model = new SinowModel(arch.color);
    super(type, arch, x, z, rng, model.rig, opts);
    this.model = model;
    this.strafeDir = rng() < 0.5 ? -1 : 1;
    this.lastX = x;
    this.lastZ = z;
  }

  private release(): void {
    if (Sinow.busy === this) Sinow.busy = null;
    this.hop = 0;
    this.spin = 0;
  }

  protected flinch(): void {
    this.release();
    this.enter('hitstun'); // (calls its landing marker off)
  }

  protected telegraphHeat(): number {
    return this.state === 'strike' ? 1 : this.windupK();
  }

  private othersBusy(): boolean {
    const b = Sinow.busy;
    return !!b && b !== this && b.alive && (b.state === 'windup' || b.state === 'strike');
  }

  protected think(dt: number, ctx: EnemyContext, dist: number, toPlayer: number): void {
    const a = this.arch;
    const tempo = this.tempo;
    if (this.state === 'dead') {
      this.release();
      return;
    }
    if (this.commonState('chase')) return;
    switch (this.state) {
      case 'idle':
        if (ctx.playerAlive && dist < a.aggroRange) this.enter('chase');
        break;

      case 'chase':
      case 'hover': {
        if (!ctx.playerAlive) {
          this.enter('idle');
          break;
        }
        this.yaw = turnToward(this.yaw, toPlayer, a.turnSpeed * tempo * dt);
        if (dist <= a.attackRange && this.cooldown <= 0 && !this.othersBusy() && ctx.requestAttackToken(this)) {
          Sinow.busy = this;
          if (dist < 3) {
            // Already in reach: crouch in place, then cut without leaping.
            this.to.copy(this.pos);
            this.phase = 'crouch';
            this.close = true;
            this.beginWindup('windup', a.windup);
            this.cue('sinow.crouch');
            this.warn(
              ctx,
              { kind: 'cone', x: this.pos.x, z: this.pos.z, yaw: toPlayer, range: a.strikeRange, arcDeg: a.strikeArcDeg },
              a.windup,
              () => {},
              0xff4060,
            );
          } else {
            // Land just short of where she stands now.
            const k = Math.max(0, dist - 1.3) / dist;
            this.to.set(this.pos.x + (ctx.playerX - this.pos.x) * k, 0, this.pos.z + (ctx.playerZ - this.pos.z) * k);
            this.phase = 'crouch';
            this.close = false;
            this.beginWindup('windup', a.windup);
            this.cue('sinow.crouch');
            this.warn(ctx, { kind: 'circle', x: this.to.x, z: this.to.z, radius: 1.7 }, a.windup + LEAP_TIME, () => {}, 0xff4060);
          }
          break;
        }
        // Circle at 5-8 m, quick and twitchy.
        this.strafe(ctx, dt, toPlayer, dist < 5 ? -1 : dist > 8 ? 1 : 0, 0.7, a.moveSpeed * tempo, 0.6);
        break;
      }

      case 'windup':
        if (!this.close) this.yaw = turnToward(this.yaw, yawTo(this.pos.x, this.pos.z, this.to.x, this.to.z), a.turnSpeed * dt);
        if (this.windupDone()) {
          if (this.close) {
            this.startCombo();
            break;
          }
          this.phase = 'leap';
          this.from.copy(this.pos);
          this.enter('strike');
          this.cue('sinow.leap');
        }
        break;

      case 'strike':
        if (this.phase === 'leap') {
          const k = Math.min(1, this.stateT / (LEAP_TIME / tempo));
          this.pos.x = this.from.x + (this.to.x - this.from.x) * k;
          this.pos.z = this.from.z + (this.to.z - this.from.z) * k;
          this.hop = 4 * k * (1 - k) * 1.5;
          if (k >= 1) {
            this.hop = 0;
            this.startCombo();
          }
          break;
        }
        // Combo: three quick cuts, re-aiming a little between them.
        this.hitT += dt;
        this.yaw = turnToward(this.yaw, toPlayer, a.turnSpeed * 0.4 * dt);
        if (!this.struck && this.hitT >= HIT_CONTACT / tempo) {
          this.struck = true;
          const fin = this.hitIndex === 2;
          this.pos.x += Math.sin(this.yaw) * a.lunge;
          this.pos.z += Math.cos(this.yaw) * a.lunge;
          const shape: TelegraphShape = { kind: 'cone', x: this.pos.x, z: this.pos.z, yaw: this.yaw, range: a.strikeRange, arcDeg: a.strikeArcDeg };
          ctx.areaStrike(this, shape, fin ? 0.75 : 0.45, fin ? 6 : 2, fin ? 'burn' : undefined, 1);
          this.cue(fin ? 'sinow.slashBig' : 'sinow.slash');
        }
        if (this.hitT >= HIT_TIME / tempo) {
          this.hitIndex++;
          this.hitT = 0;
          this.struck = false;
          if (this.hitIndex >= 3) {
            this.phase = 'flip';
            this.from.copy(this.pos);
            this.to.set(this.pos.x - Math.sin(this.yaw) * FLIP_DIST, 0, this.pos.z - Math.cos(this.yaw) * FLIP_DIST);
            this.enter('recover');
            // (An Overclocked follow-up cut may have replaced the flip.)
            if (this.phase === 'flip') this.cue('sinow.flip');
          }
        }
        break;

      case 'recover':
        if (this.phase === 'flip') {
          const k = Math.min(1, this.stateT / FLIP_TIME);
          this.pos.x = this.from.x + (this.to.x - this.from.x) * k;
          this.pos.z = this.from.z + (this.to.z - this.from.z) * k;
          this.hop = 4 * k * (1 - k) * 1.3;
          this.spin = -Math.PI * 2 * k;
          if (k >= 1) {
            this.release();
            this.phase = 'land';
            this.stateT = 0;
          }
          break;
        }
        // Landed: crouched and open. The punish window.
        if (this.stateT >= a.recovery / tempo) {
          this.rollCooldown(ctx);
          this.enter('chase');
        }
        break;
    }
  }

  /** Overclocked: one more big cut (after a short beat) before it flips away. */
  protected followUp(): boolean {
    if (this.phase !== 'flip') return false;
    this.phase = 'combo';
    this.hitIndex = 2;
    this.hitT = -0.25;
    this.struck = false;
    this.enter('strike');
    return true;
  }

  private startCombo(): void {
    this.phase = 'combo';
    this.hitIndex = 0;
    this.hitT = 0;
    this.struck = false;
    this.tele.forget(); // the landing marker plays out
    if (this.state !== 'strike') this.enter('strike');
    else this.stateT = 0;
  }

  protected targetPose(dt: number): { pose: Pose; rate: number } {
    const moved = Math.hypot(this.pos.x - this.lastX, this.pos.z - this.lastZ);
    this.lastX = this.pos.x;
    this.lastZ = this.pos.z;
    const speed = dt > 0 ? moved / dt : 0;
    this.runPhase += (moved / 2.2) * Math.PI * 2;
    const tempo = this.tempo;
    switch (this.state) {
      case 'spawning':
        return { pose: sinowPoses.crouch(1), rate: 6 };
      case 'windup':
        return { pose: sinowPoses.crouch(this.windupK()), rate: 16 };
      case 'strike':
        if (this.phase === 'leap') return { pose: sinowPoses.leap(), rate: 20 };
        return { pose: sinowPoses.slash(this.hitIndex, Math.min(1, this.hitT / (HIT_CONTACT / tempo))), rate: 35 };
      case 'recover':
        if (this.phase === 'flip') return { pose: sinowPoses.flip(), rate: 20 };
        return { pose: sinowPoses.crouch(Math.max(0.3, 0.9 - this.stateT * 0.4)), rate: 10 };
      case 'hitstun':
      case 'dead':
        return { pose: sinowPoses.hurt(), rate: 22 };
      case 'frozen':
        return { pose: sinowPoses.hurt(), rate: 0 };
      default:
        if (speed > 0.4) return { pose: sinowPoses.run(this.runPhase), rate: 12 };
        return { pose: sinowPoses.idle(this.time), rate: 6 };
    }
  }

  protected animate(dt?: number): void {
    super.animate(dt);
    if (this.alive) {
      const root = this.rig.root;
      root.position.y += this.hop;
      root.rotation.x = this.spin;
    }
    this.model.visor.emissiveIntensity = this.alive ? (this.state === 'windup' ? 2.6 : 1.6) : 0.1;
    this.model.blades.emissiveIntensity = this.state === 'strike' ? 2.4 : this.alive ? 1.2 : 0.1;
  }
}

// ----------------------------------------------------------- control node

/** A pylon that keeps the room's linked gunbots rebooting. It never attacks. */
export class ControlNode extends Enemy {
  protected topplesOnDeath = false;
  private model: NodeModel;

  constructor(type: EnemyId, arch: EnemyArchetype, x: number, z: number, rng: () => number, opts: EnemyOptions = {}) {
    const model = new NodeModel();
    super(type, arch, x, z, rng, model.rig, opts);
    this.model = model;
    this.rooted = true;
    (this as { radius: number }).radius = 1.0;
  }

  get aimHeight(): number {
    return 2.5;
  }

  protected think(): void {
    this.commonState('idle');
  }

  protected targetPose(): { pose: Pose; rate: number } {
    if (this.state === 'hitstun') return { pose: nodePoses.hurt(), rate: 20 };
    return { pose: nodePoses.idle(this.time), rate: 4 };
  }

  protected animate(dt?: number): void {
    super.animate(dt);
    this.model.update(this.time, this.alive ? 1 : 0);
  }
}

// ------------------------------------------------------------ Warden adds

/**
 * Spark Mite (summoned by the Warden): scuttles at you, then squats and arms a
 * small burning blast. Killing or flinching it first defuses it.
 */
export class SparkMite extends Enemy {
  protected topplesOnDeath = false;
  private model: MiteModel;
  private chaseT = 0;
  private walkPhase = 0;
  private lastX: number;
  private lastZ: number;

  constructor(type: EnemyId, arch: EnemyArchetype, x: number, z: number, rng: () => number, opts: EnemyOptions = {}) {
    const model = new MiteModel(arch.color);
    super(type, arch, x, z, rng, model.rig, opts);
    this.model = model;
    this.lastX = x;
    this.lastZ = z;
  }

  get aimHeight(): number {
    return 0.7;
  }

  // Killing or flinching it first defuses it (Enemy.warn).

  protected think(dt: number, ctx: EnemyContext, dist: number, toPlayer: number): void {
    const a = this.arch;
    if (this.state === 'spawning') this.yaw = toPlayer;
    if (this.commonState('chase')) return;
    switch (this.state) {
      case 'idle':
        if (ctx.playerAlive) this.enter('chase');
        break;
      case 'chase':
      case 'hover':
        if (!ctx.playerAlive) {
          this.enter('idle');
          break;
        }
        this.chaseT += dt;
        this.yaw = turnToward(this.yaw, toPlayer, a.turnSpeed * dt);
        this.pos.x += Math.sin(this.yaw) * a.moveSpeed * dt;
        this.pos.z += Math.cos(this.yaw) * a.moveSpeed * dt;
        // Close enough, or chased long enough: arm right here.
        if (dist <= a.attackRange || this.chaseT > 7) this.arm(ctx);
        break;
      case 'windup':
        break; // the fuse fires it
    }
  }

  private arm(ctx: EnemyContext): void {
    this.beginWindup('windup', this.arch.windup);
    this.chaseT = 0;
    this.cue('volatile.warn');
    const shape: TelegraphShape = { kind: 'circle', x: this.pos.x, z: this.pos.z, radius: this.arch.strikeRange };
    this.warn(ctx, shape, this.arch.windup, () => {
      if (!this.alive || this.state !== 'windup') return;
      ctx.areaStrike(this, shape, 1, 8, 'burn', 1);
      ctx.bolt(this.pos.x, this.pos.z, 0xff8a30);
      this.cue('missile.explode');
      // Spent: it goes up with the blast (not a kill).
      this.hp = 0;
      this.enter('dead');
    }, 0xff6a20);
  }

  protected targetPose(dt: number): { pose: Pose; rate: number } {
    const moved = Math.hypot(this.pos.x - this.lastX, this.pos.z - this.lastZ);
    this.lastX = this.pos.x;
    this.lastZ = this.pos.z;
    this.walkPhase += (moved / 0.5) * Math.PI;
    switch (this.state) {
      case 'windup':
        return { pose: mitePoses.armed(Math.min(1, this.stateT / 0.3)), rate: 14 };
      case 'hitstun':
      case 'dead':
        return { pose: mitePoses.hurt(), rate: 20 };
      case 'frozen':
        return { pose: mitePoses.hurt(), rate: 0 };
      default:
        if (dt > 0 && moved / dt > 0.3) return { pose: mitePoses.walk(this.walkPhase), rate: 16 };
        return { pose: mitePoses.idle(this.time), rate: 6 };
    }
  }

  protected animate(dt?: number): void {
    super.animate(dt);
    this.model.update(this.time, this.state === 'windup' ? 1 : 0, this.alive);
  }
}

/**
 * Repair Drone (summoned by the Warden): flies to a post by the alcove and, while
 * it hovers there, beams repairs into the core. It never attacks.
 */
export class RepairDrone extends Enemy {
  protected topplesOnDeath = false;
  /** Where it hovers (set by the Warden). */
  readonly post = new THREE.Vector3();
  private model: DroneModel;

  constructor(type: EnemyId, arch: EnemyArchetype, x: number, z: number, rng: () => number, opts: EnemyOptions = {}) {
    const model = new DroneModel(arch.color);
    super(type, arch, x, z, rng, model.rig, opts);
    this.model = model;
    this.post.set(x, 0, z);
  }

  get aimHeight(): number {
    return 2.2;
  }

  /** Parked at its post and beaming. */
  get repairing(): boolean {
    return this.state === 'cast';
  }

  protected think(dt: number, _ctx: EnemyContext): void {
    if (this.commonState('chase')) return;
    const dx = this.post.x - this.pos.x;
    const dz = this.post.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    switch (this.state) {
      case 'idle':
      case 'chase':
      case 'hover': {
        if (d < 0.3) {
          this.enter('cast');
          break;
        }
        const step = Math.min(d, this.arch.moveSpeed * dt);
        this.pos.x += (dx / d) * step;
        this.pos.z += (dz / d) * step;
        this.yaw = turnToward(this.yaw, Math.atan2(dx, dz), this.arch.turnSpeed * dt);
        break;
      }
      case 'cast':
        // Knocked off its post: fly back before beaming again.
        if (d > 1) this.enter('chase');
        this.yaw = turnToward(this.yaw, Math.PI, this.arch.turnSpeed * dt);
        break;
    }
  }

  protected targetPose(): { pose: Pose; rate: number } {
    if (this.state === 'hitstun' || this.state === 'dead' || this.state === 'frozen') return { pose: dronePoses.hurt(), rate: this.state === 'frozen' ? 0 : 16 };
    return { pose: dronePoses.hover(this.time), rate: 5 };
  }

  protected animate(dt?: number): void {
    super.animate(dt);
    this.model.update(this.time, this.repairing, this.alive);
  }
}
