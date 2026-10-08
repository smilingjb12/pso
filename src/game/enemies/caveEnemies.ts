import * as THREE from 'three';
import { panArms as panCfg, type EnemyArchetype, type EnemyId } from '../config';
import { turnToward } from '../collision';
import { boomaPoses } from '../models/booma';
import { HidoomModel, LilyModel, lilyPoses, MigiumModel, migiumPoses, PanArmsModel } from '../models/cave';
import type { Pose } from '../models/Rig';
import type { TelegraphShape } from '../world/Telegraph';
import { Brawler, Enemy, type EnemyContext, type EnemyOptions } from './Enemy';

/** Seconds a Lily coils back before it spits (hitting it now cancels the shot). */
const LILY_AIM = 0.5;
/** Seconds the spit / burst pose holds after firing. */
const RELEASE = 0.35;

// ------------------------------------------------------------------ Lily

/**
 * Rooted plant. Spits an arcing glob at where you stand (landing circle shows
 * where it will burst), and bursts its petals if you stand right next to it.
 */
export class Lily extends Enemy {
  protected topplesOnDeath = false;
  private shotCd: number;
  private model: LilyModel;

  constructor(type: EnemyId, arch: EnemyArchetype, x: number, z: number, rng: () => number, opts: EnemyOptions = {}) {
    const nar = arch.shotStatus === 'paralysis';
    const model = nar ? new LilyModel(0xd83a3a, 0x3a6a2a, 0xffd040) : new LilyModel();
    super(type, arch, x, z, rng, model.rig, opts);
    this.model = model;
    this.rooted = true;
    this.yaw = rng() * Math.PI * 2;
    this.shotCd = 1 + rng() * 1.5;
  }

  get aimHeight(): number {
    return 1.9 * this.arch.scale;
  }

  // A flinch calls a petal burst off (Enemy.warn); a launched glob still lands.

  protected think(dt: number, ctx: EnemyContext, dist: number, toPlayer: number): void {
    const a = this.arch;
    this.shotCd = Math.max(0, this.shotCd - dt);
    if (this.commonState('idle')) return;
    switch (this.state) {
      case 'idle':
      case 'chase':
      case 'hover': {
        if (!ctx.playerAlive || dist > a.aggroRange) break;
        this.yaw = turnToward(this.yaw, toPlayer, a.turnSpeed * dt);
        if (dist <= a.attackRange + 0.3 && this.cooldown <= 0) {
          this.beginWindup('burst', a.windup);
          const shape: TelegraphShape = { kind: 'circle', x: this.pos.x, z: this.pos.z, radius: a.strikeRange };
          this.warn(ctx, shape, a.windup, () => {
            if (!this.alive || this.state !== 'burst') return;
            ctx.areaStrike(this, shape, 0.55, 9);
            this.enter('recover');
          }, 0xc070ff);
          break;
        }
        if (dist <= (a.shotRange ?? 0) && this.shotCd <= 0 && ctx.requestShot(this)) this.beginWindup('aim', LILY_AIM * this.windupScale);
        break;
      }
      case 'aim':
        this.yaw = turnToward(this.yaw, toPlayer, a.turnSpeed * 2 * dt);
        if (this.windupDone()) this.spit(ctx);
        break;
      case 'burst':
        if (this.stateT > a.windup + 0.2) this.enter('recover'); // telegraph lost
        break;
      case 'strike':
        if (this.stateT >= RELEASE) this.enter('recover');
        break;
      case 'recover':
        if (this.stateT >= a.recovery) {
          this.rollCooldown(ctx, 0.8, 0.4);
          this.enter('idle');
        }
        break;
    }
  }

  /** Overclocked: spit again (after a spit or a petal burst). */
  protected followUp(): boolean {
    this.beginWindup('aim', LILY_AIM * this.windupScale);
    return true;
  }

  private spit(ctx: EnemyContext): void {
    const a = this.arch;
    const tx = ctx.playerX;
    const tz = ctx.playerZ;
    const shape: TelegraphShape = { kind: 'circle', x: tx, z: tz, radius: a.shotRadius ?? 1.6 };
    const color = a.shotStatus === 'paralysis' ? 0xffd040 : 0x9a50ff;
    const dur = a.shotWindup ?? 1.2;
    ctx.telegraph(shape, dur, () => ctx.areaStrike(this, shape, 0.85, 3, a.shotStatus, a.shotStatusChance), color);
    const mouth = new THREE.Vector3(this.pos.x + Math.sin(this.yaw) * 0.4, 2.1 * a.scale, this.pos.z + Math.cos(this.yaw) * 0.4);
    ctx.lob(mouth, tx, tz, dur, color);
    this.holdThreat(dur);
    this.shotCd = this.rollShotCd(ctx, 3.5);
    this.enter('strike');
  }

  protected targetPose(): { pose: Pose; rate: number } {
    switch (this.state) {
      case 'spawning':
        return { pose: lilyPoses.aim(1), rate: 6 };
      case 'aim':
        return { pose: lilyPoses.aim(Math.min(1, this.stateT / LILY_AIM)), rate: 18 };
      case 'strike':
        return { pose: lilyPoses.spit(), rate: 30 };
      case 'burst':
        return { pose: lilyPoses.burstWindup(Math.min(1, this.stateT / this.arch.windup)), rate: 16 };
      case 'recover':
        return { pose: this.stateT < RELEASE ? lilyPoses.burst() : lilyPoses.idle(this.time), rate: this.stateT < RELEASE ? 30 : 5 };
      case 'hitstun':
        return { pose: lilyPoses.hurt(), rate: 22 };
      case 'frozen':
        return { pose: lilyPoses.hurt(), rate: 0 };
      case 'dead':
        return { pose: lilyPoses.dead(), rate: 5 };
      default:
        return { pose: lilyPoses.idle(this.time), rate: 6 };
    }
  }

  protected animate(dt?: number): void {
    super.animate(dt);
    // The throat glows brighter while it gathers a shot.
    this.model.throat.emissiveIntensity = this.state === 'aim' || this.state === 'burst' ? 2.2 : 1.1;
  }
}

// ---------------------------------------------------------------- Migium

/** Keeps its distance and calls down a lightning circle where you stand. */
export class Migium extends Enemy {
  private model: MigiumModel;
  private shotCd: number;
  private walkPhase = 0;
  private lastX: number;
  private lastZ: number;

  constructor(type: EnemyId, arch: EnemyArchetype, x: number, z: number, rng: () => number, opts: EnemyOptions = {}) {
    const model = new MigiumModel();
    super(type, arch, x, z, rng, model.rig, opts);
    this.model = model;
    this.shotCd = 1.2 + rng();
    this.strafeDir = rng() < 0.5 ? -1 : 1;
    this.lastX = x;
    this.lastZ = z;
  }

  protected think(dt: number, ctx: EnemyContext, dist: number, toPlayer: number): void {
    const a = this.arch;
    this.shotCd = Math.max(0, this.shotCd - dt);
    if (this.commonState('chase')) return;
    switch (this.state) {
      case 'idle':
      case 'chase':
      case 'hover': {
        if (this.walkToPartner(dt)) break;
        if (!ctx.playerAlive) break;
        this.yaw = turnToward(this.yaw, toPlayer, a.turnSpeed * dt);
        // Hold a ring 6-10 m out, drifting sideways.
        this.strafe(ctx, dt, toPlayer, dist < 6 ? -1 : dist > 10 ? 1 : 0, 0.5, a.moveSpeed, 0.3);
        if (dist <= (a.shotRange ?? 14) && this.shotCd <= 0 && ctx.requestShot(this)) this.cast(ctx);
        break;
      }
      case 'cast':
        this.yaw = turnToward(this.yaw, toPlayer, a.turnSpeed * dt);
        if (this.stateT > (a.shotWindup ?? 1.3) + 0.2) this.enter('recover');
        break;
      case 'strike':
        if (this.stateT >= RELEASE) this.enter('recover');
        break;
      case 'recover':
        if (this.stateT >= a.recovery) {
          this.shotCd = this.rollShotCd(ctx, 3.4);
          this.enter('chase');
        }
        break;
    }
  }

  /** A lightning circle where the player stands (a flinch calls it off). */
  private cast(ctx: EnemyContext): void {
    const a = this.arch;
    this.beginWindup('cast', a.shotWindup ?? 1.3);
    const shape: TelegraphShape = { kind: 'circle', x: ctx.playerX, z: ctx.playerZ, radius: a.shotRadius ?? 2 };
    this.warn(ctx, shape, a.shotWindup ?? 1.3, () => {
      if (!this.alive || this.state !== 'cast') return;
      ctx.bolt(shape.x, shape.z, 0x80e8ff);
      ctx.areaStrike(this, shape, 0.9, 2, a.shotStatus, a.shotStatusChance);
      this.enter('strike');
    }, 0x60d0ff);
  }

  /** Overclocked: a second circle right after the first. */
  protected followUp(ctx: EnemyContext): boolean {
    if (!ctx.playerAlive) return false;
    this.cast(ctx);
    return true;
  }

  protected targetPose(dt: number): { pose: Pose; rate: number } {
    const moved = Math.hypot(this.pos.x - this.lastX, this.pos.z - this.lastZ);
    this.lastX = this.pos.x;
    this.lastZ = this.pos.z;
    const speed = dt > 0 ? moved / dt : 0;
    this.walkPhase += (moved / 1.5) * Math.PI * 2;
    switch (this.state) {
      case 'spawning':
        return { pose: migiumPoses.crouch(), rate: 6 };
      case 'cast':
        return { pose: migiumPoses.cast(Math.min(1, this.stateT / 0.6)), rate: 14 };
      case 'strike':
        return { pose: migiumPoses.release(), rate: 30 };
      case 'hitstun':
      case 'dead':
        return { pose: migiumPoses.hurt(), rate: 22 };
      case 'frozen':
        return { pose: migiumPoses.hurt(), rate: 0 };
      default:
        if (speed > 0.3) return { pose: migiumPoses.walk(this.walkPhase), rate: 10 };
        return { pose: migiumPoses.idle(this.time), rate: 6 };
    }
  }

  protected animate(dt?: number): void {
    super.animate(dt);
    this.model.orb.emissiveIntensity = this.state === 'cast' ? 1.5 + Math.sin(this.time * 30) * 0.8 : 1;
  }
}

// ---------------------------------------------------------- Pan Arms

/** Slow brute; at half HP it splits (the world spawns the halves). */
export class PanArms extends Brawler {
  /** HP at or below which it splits. */
  splitBelow: number;
  /** Set when it should split this frame (handled by the world). */
  wantsSplit = false;
  private seam: THREE.MeshStandardMaterial;

  constructor(type: EnemyId, arch: EnemyArchetype, x: number, z: number, rng: () => number, opts: EnemyOptions = {}) {
    const model = new PanArmsModel();
    super(type, arch, x, z, rng, model.rig, opts, boomaPoses);
    this.seam = model.seam;
    // A merged Pan Arms splits again after losing half of what it came back with.
    this.splitBelow = opts.hp !== undefined ? this.hp * 0.5 : this.maxHp * panCfg.splitAt;
  }

  damage(amount: number, fromX: number, fromZ: number, knockback: number, stagger: number): boolean {
    if (!this.alive || this.invulnerable) return false;
    if (this.hp - amount <= this.splitBelow) {
      // Never dies whole: it comes apart instead (no kill, no reward).
      this.hp = Math.max(1, this.hp - amount);
      this.flashT = 0.08;
      this.wantsSplit = true;
      return false;
    }
    return super.damage(amount, fromX, fromZ, knockback, stagger);
  }

  protected animate(dt?: number): void {
    super.animate(dt);
    // The seam strains brighter as it nears the split.
    const k = 1 - Math.min(1, (this.hp - this.splitBelow) / Math.max(1, this.maxHp - this.splitBelow));
    this.seam.emissiveIntensity = 0.8 + k * 2 + (k > 0.6 ? Math.sin(this.time * 20) * 0.6 : 0);
  }
}

export class Hidoom extends Brawler {
  constructor(type: EnemyId, arch: EnemyArchetype, x: number, z: number, rng: () => number, opts: EnemyOptions = {}) {
    super(type, arch, x, z, rng, new HidoomModel().rig, opts, boomaPoses);
  }
}
