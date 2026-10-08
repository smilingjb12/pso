import * as THREE from 'three';
import { ai, pylonCfg, ruinsCfg, type EnemyArchetype, type EnemyId } from '../config';
import { angleDelta, turnToward, yawTo } from '../collision';
import {
  BelraModel, belraPoses, BringerModel, bringerPoses, DelsaberModel, delsaberPoses, DimenianModel, dimenianPoses, SorcererModel, sorcererPoses,
} from '../models/ruins';
import type { Pose } from '../models/Rig';
import { inShape, type TelegraphShape } from '../world/Telegraph';
import { Brawler, CORRUPT_COLOR, Enemy, type EnemyContext, type EnemyOptions, type EnemyState } from './Enemy';

// Ruins enemies (all Dark). Their own cues name their sounds (see AudioCues). Telegraphs that
// corrupt are violet (CORRUPT_COLOR), the rest red. Timings run on `tempo` (Overclocked and
// Frenzied speed them up, pylon light slows them): state timers tick in tempo time, and
// telegraph durations are divided by it so both stay in step.

const RED = 0xff4a30;

// ---------------------------------------------------------------- Dimenian

/** Sword grunts: the Booma family's role (Brawler AI) in armour. So Dimenian cuts corrupt. */
export class Dimenian extends Brawler {
  private model: DimenianModel;

  constructor(type: EnemyId, arch: EnemyArchetype, x: number, z: number, rng: () => number, opts: EnemyOptions = {}) {
    const model = new DimenianModel(arch.color);
    super(type, arch, x, z, rng, model.rig, opts, dimenianPoses);
    this.model = model;
  }

  protected enter(s: EnemyState): void {
    if (s === 'windup' && this.state !== 'strike') this.cue('ruins.growl');
    if (s === 'strike') this.cue('ruins.slash');
    super.enter(s);
  }

  protected animate(dt?: number): void {
    super.animate(dt);
    const hot = this.state === 'windup' || this.state === 'strike';
    this.model.blade.emissiveIntensity = this.alive ? (hot ? 2.4 : 1.1) : 0.1;
    this.model.eyes.emissiveIntensity = this.alive ? 1.6 : 0.1;
  }
}

// ---------------------------------------------------------------- Delsaber

type DelPhase = 'crouch' | 'leap' | 'combo';
const DEL_HIT = 0.46;
const DEL_CONTACT = 0.22;

/**
 * Shield knight. Its guard blocks light hits from the front (they barely scratch it) until a heavy
 * hit breaks it: it reels, and its guard stays down for a few seconds. Circles at range with the
 * shield up, crouches and leaps in with a three-cut combo, then recovers with its guard down.
 */
export class Delsaber extends Enemy {
  private model: DelsaberModel;
  private phase: DelPhase = 'crouch';
  private hitIndex = 0;
  private hitT = 0;
  private struck = false;
  private close = false;
  private from = new THREE.Vector3();
  private to = new THREE.Vector3();
  private hop = 0;
  private walkPhase = 0;
  private lastX: number;
  private lastZ: number;
  /** Seconds the broken guard stays down. */
  private guardDownT = 0;
  /** Set by damageMult for the hit about to land: it was blocked, or it breaks the guard. */
  private blockNext = false;
  private breakNext = false;
  private wardFlash = 0;

  constructor(type: EnemyId, arch: EnemyArchetype, x: number, z: number, rng: () => number, opts: EnemyOptions = {}) {
    const model = new DelsaberModel(arch.color);
    super(type, arch, x, z, rng, model.rig, opts);
    this.model = model;
    this.strafeDir = rng() < 0.5 ? -1 : 1;
    this.lastX = x;
    this.lastZ = z;
  }

  get aimHeight(): number {
    return 1.8;
  }

  /** Shield up: idle, moving or crouching, guard not broken. */
  get guarding(): boolean {
    if (!this.alive || this.guardDownT > 0) return false;
    return this.state === 'idle' || this.state === 'chase' || this.state === 'hover' || (this.state === 'windup' && this.phase === 'crouch');
  }

  damageMult(fromX?: number, fromZ?: number, heavy?: boolean): number {
    const base = super.damageMult(fromX, fromZ, heavy);
    if (fromX === undefined || fromZ === undefined || !this.guarding) return base;
    const front = Math.abs(angleDelta(this.yaw, yawTo(this.pos.x, this.pos.z, fromX, fromZ)));
    if (front > THREE.MathUtils.degToRad(ruinsCfg.guardArcDeg)) return base;
    if (heavy) {
      this.breakNext = true;
      return base;
    }
    this.blockNext = true;
    return base * ruinsCfg.guardMult;
  }

  damage(amount: number, fromX: number, fromZ: number, knockback: number, stagger: number): boolean {
    const blocked = this.blockNext;
    const breaks = this.breakNext;
    this.blockNext = this.breakNext = false;
    if (blocked) {
      this.wardFlash = 0.2;
      this.cue('delsaber.block');
      // A blocked hit doesn't stagger or shove it.
      return super.damage(amount, fromX, fromZ, 0, 0);
    }
    const killed = super.damage(amount, fromX, fromZ, knockback, stagger);
    if (breaks && !killed && this.alive) {
      this.guardDownT = ruinsCfg.guardDown;
      this.cue('delsaber.break');
      this.release();
      this.stunFor = ruinsCfg.guardBreakStun;
      this.enter('hitstun');
    }
    return killed;
  }

  /** Off the ground and out of its attack (entering hitstun also calls its landing marker off). */
  private release(): void {
    this.hop = 0;
  }

  protected flinch(): void {
    this.release();
    this.enter('hitstun');
  }

  protected telegraphHeat(): number {
    return this.state === 'strike' && this.phase === 'combo' ? 1 : this.windupK();
  }

  /** Overclocked: one more overhead cut before it recovers. */
  protected followUp(): boolean {
    if (this.phase !== 'combo') return false;
    this.hitIndex = 2;
    this.hitT = -0.2;
    this.struck = false;
    this.enter('strike');
    return true;
  }

  protected think(dt: number, ctx: EnemyContext, dist: number, toPlayer: number): void {
    const a = this.arch;
    this.guardDownT = Math.max(0, this.guardDownT - dt);
    this.wardFlash = Math.max(0, this.wardFlash - dt);
    if (this.state === 'spawning') this.yaw = toPlayer;
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
        this.yaw = turnToward(this.yaw, toPlayer, a.turnSpeed * dt);
        const facing = Math.abs(angleDelta(this.yaw, toPlayer)) < 0.4;
        if (dist <= a.attackRange && facing && this.cooldown <= 0 && ctx.requestAttackToken(this)) {
          this.startAttack(ctx, dist);
          break;
        }
        // Shield up, it closes to about 4.5 m and circles there.
        const radial = dist > 5 ? 1 : dist < 3.5 ? -0.6 : 0;
        this.strafe(ctx, dt, toPlayer, radial, 0.45, a.moveSpeed * (radial > 0 ? 1 : 0.6), 0.4);
        break;
      }

      case 'windup':
        if (!this.close) this.yaw = turnToward(this.yaw, yawTo(this.pos.x, this.pos.z, this.to.x, this.to.z), a.turnSpeed * dt);
        else this.yaw = turnToward(this.yaw, toPlayer, a.turnSpeed * 0.4 * dt);
        if (this.windupDone()) {
          if (this.close) {
            this.startCombo();
            break;
          }
          this.phase = 'leap';
          this.from.copy(this.pos);
          this.enter('strike');
          this.cue('delsaber.leap');
        }
        break;

      case 'strike':
        if (this.phase === 'leap') {
          const k = Math.min(1, this.stateT / ruinsCfg.leapTime);
          this.pos.x = this.from.x + (this.to.x - this.from.x) * k;
          this.pos.z = this.from.z + (this.to.z - this.from.z) * k;
          this.hop = 4 * k * (1 - k) * 1.6;
          if (k >= 1) {
            this.hop = 0;
            this.startCombo();
          }
          break;
        }
        this.hitT += dt;
        this.yaw = turnToward(this.yaw, toPlayer, a.turnSpeed * 0.35 * dt);
        if (!this.struck && this.hitT >= DEL_CONTACT) {
          this.struck = true;
          const fin = this.hitIndex === 2;
          this.pos.x += Math.sin(this.yaw) * a.lunge;
          this.pos.z += Math.cos(this.yaw) * a.lunge;
          const shape: TelegraphShape = { kind: 'cone', x: this.pos.x, z: this.pos.z, yaw: this.yaw, range: a.strikeRange, arcDeg: a.strikeArcDeg };
          // Area multipliers scale ATP before DFP comes off: below ~0.9 a cut barely scratches.
          ctx.areaStrike(this, shape, fin ? 1.1 : 0.85, fin ? 8 : 3);
          this.cue('ruins.slash');
        }
        if (this.hitT >= DEL_HIT) {
          this.hitIndex++;
          this.hitT = 0;
          this.struck = false;
          if (this.hitIndex >= a.strikes) this.enter('recover');
        }
        break;

      case 'recover':
        // Guard down while it recovers: the punish window.
        if (this.stateT >= a.recovery) {
          this.rollCooldown(ctx);
          this.enter('chase');
        }
        break;
    }
  }

  private startAttack(ctx: EnemyContext, dist: number): void {
    const a = this.arch;
    this.phase = 'crouch';
    this.close = dist < 3.2;
    const windup = a.windup * this.windupScale;
    this.beginWindup('windup', windup);
    this.cue('ruins.growl');
    if (this.close) {
      this.to.copy(this.pos);
      this.warn(ctx, { kind: 'cone', x: this.pos.x, z: this.pos.z, yaw: this.yaw, range: a.strikeRange, arcDeg: a.strikeArcDeg }, windup, () => {}, RED);
    } else {
      // Land just short of where you stand now.
      const k = Math.max(0, dist - 1.4) / dist;
      this.to.set(this.pos.x + (ctx.playerX - this.pos.x) * k, 0, this.pos.z + (ctx.playerZ - this.pos.z) * k);
      this.warn(ctx, { kind: 'circle', x: this.to.x, z: this.to.z, radius: 1.9 }, windup + ruinsCfg.leapTime, () => {}, RED);
    }
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
    this.walkPhase += (moved / 1.5) * Math.PI * 2;
    switch (this.state) {
      case 'spawning':
        return { pose: delsaberPoses.crouch(1), rate: 6 };
      case 'windup':
        return { pose: delsaberPoses.crouch(this.windupK()), rate: 14 };
      case 'strike':
        if (this.phase === 'leap') return { pose: delsaberPoses.leap(), rate: 20 };
        return { pose: delsaberPoses.slash(this.hitIndex, Math.min(1, this.hitT / DEL_CONTACT)), rate: 30 };
      case 'recover':
        return { pose: this.stateT < 0.4 ? delsaberPoses.slash(2, 1) : delsaberPoses.broken(), rate: 6 };
      case 'hitstun':
        return { pose: this.guardDownT > 0 ? delsaberPoses.broken() : delsaberPoses.hurt(), rate: 20 };
      case 'dead':
        return { pose: delsaberPoses.hurt(), rate: 20 };
      case 'frozen':
        return { pose: delsaberPoses.hurt(), rate: 0 };
      default:
        if (this.guardDownT > 0) return { pose: delsaberPoses.broken(), rate: 6 };
        if (speed > 0.3) return { pose: delsaberPoses.walk(this.walkPhase, Math.min(1, speed / 2.2)), rate: 10 };
        return { pose: delsaberPoses.idle(this.time), rate: 6 };
    }
  }

  protected animate(dt?: number): void {
    super.animate(dt);
    if (this.alive) this.rig.root.position.y += this.hop;
    this.model.ward.emissiveIntensity = !this.alive ? 0.05 : this.wardFlash > 0 ? 3.5 : this.guarding ? 0.9 + Math.sin(this.time * 4) * 0.15 : 0.1;
    this.model.blade.emissiveIntensity = this.state === 'strike' ? 2.4 : this.alive ? 1.1 : 0.1;
    this.model.eyes.emissiveIntensity = this.alive ? 1.8 : 0.1;
  }
}

// ---------------------------------------------------------- Chaos Sorcerer

type Spell = 'ring' | 'field' | 'line';
const BLINK_TIME = 0.6;

/**
 * Floating caster. Keeps 8-12 m away and glides sideways; when you close in it blinks away. Casts a
 * corrupting Gi-tech: a fire ring around you (safe in its middle), a lightning field (one circle on
 * you, one where you are heading, one near) or an ice line through you. A lit pylon in its room draws
 * it: it blinks beside the pylon and drains it out unless a hit interrupts.
 */
export class Sorcerer extends Enemy {
  protected topplesOnDeath = false;
  private model: SorcererModel;
  private shotCd: number;
  private blinkCd = 0;
  private snuffCd: number;
  private spell: Spell = 'ring';
  private lastSpell: Spell | null = null;
  /** Blink: where it reappears, and what it does there (fight on, or drain a pylon). */
  private blinkTo: [number, number] | null = null;
  private drain: { id: number; x: number; z: number } | null = null;
  private lastX: number;
  private lastZ: number;
  private released = 0;
  private cast = 0;

  constructor(type: EnemyId, arch: EnemyArchetype, x: number, z: number, rng: () => number, opts: EnemyOptions = {}) {
    const model = new SorcererModel(arch.color);
    super(type, arch, x, z, rng, model.rig, opts);
    this.model = model;
    this.shotCd = 1.2 + rng() * 1.5;
    this.snuffCd = 2 + rng() * 2;
    this.strafeDir = rng() < 0.5 ? -1 : 1;
    this.lastX = x;
    this.lastZ = z;
  }

  get aimHeight(): number {
    return 2.3;
  }

  /** Hard to touch while it is mostly gone mid-blink. */
  get invulnerable(): boolean {
    return this.state === 'spawning' || (this.state === 'burst' && this.stateT > BLINK_TIME * 0.25 && this.stateT < BLINK_TIME * 0.75);
  }

  protected corruptingAttack(): boolean {
    return true;
  }

  private stopDrain(ctx: EnemyContext | null): void {
    if (this.drain && ctx) ctx.snuffPylon(this.drain.id, -1);
    this.drain = null;
  }

  damage(amount: number, fromX: number, fromZ: number, knockback: number, stagger: number): boolean {
    // Any hit breaks a drain.
    if (this.state === 'aim' && this.drain) {
      const killed = super.damage(amount, fromX, fromZ, knockback, stagger);
      if (!killed && this.alive && this.state === 'aim') {
        this.snuffCd = pylonCfg.snuffCooldown * 0.5;
        this.flinch();
      }
      return killed;
    }
    return super.damage(amount, fromX, fromZ, knockback, stagger);
  }

  protected flinch(): void {
    this.blinkTo = null;
    if (this.drain) {
      this.cue('sorcerer.interrupt');
      this.pendingStop = true;
    }
    this.enter('hitstun'); // (calls its spell off)
  }
  /** A drain broken outside think() (no ctx there): it is called off on the next tick. */
  private pendingStop = false;

  protected telegraphHeat(): number {
    return this.state === 'aim' ? 0.6 : this.windupK();
  }

  /** Overclocked: another spell right away. */
  protected followUp(ctx: EnemyContext): boolean {
    if (!ctx.playerAlive || this.state !== 'cast') return false;
    this.startSpell(ctx);
    return true;
  }

  protected think(dt: number, ctx: EnemyContext, dist: number, toPlayer: number): void {
    const a = this.arch;
    this.shotCd = Math.max(0, this.shotCd - dt);
    this.blinkCd = Math.max(0, this.blinkCd - dt);
    this.snuffCd = Math.max(0, this.snuffCd - dt);
    this.released = Math.max(0, this.released - dt);
    if (this.pendingStop) {
      this.pendingStop = false;
      this.stopDrain(ctx);
    }
    if (this.state === 'spawning') this.yaw = toPlayer;
    if (this.commonState('hover')) return;
    switch (this.state) {
      case 'idle':
        if (ctx.playerAlive && dist < a.aggroRange) this.enter('hover');
        break;

      case 'chase':
      case 'hover': {
        if (!ctx.playerAlive) {
          this.enter('idle');
          break;
        }
        this.yaw = turnToward(this.yaw, toPlayer, a.turnSpeed * dt);
        // Too close: blink away.
        if (dist < ruinsCfg.blinkRange && this.blinkCd <= 0) {
          const spot = ctx.blinkSpot(this, ctx.playerX, ctx.playerZ, ruinsCfg.blinkTo);
          if (spot) {
            this.startBlink(ctx, spot, null);
            break;
          }
        }
        // A lit pylon in the room: go and put it out.
        if (this.snuffCd <= 0) {
          const p = ctx.litPylon(this);
          if (p) {
            const spot = ctx.blinkSpot(this, p.x, p.z, 2.2);
            this.snuffCd = pylonCfg.snuffCooldown;
            if (spot) {
              this.startBlink(ctx, spot, p);
              break;
            }
          }
        }
        const facing = Math.abs(angleDelta(this.yaw, toPlayer)) < 0.5;
        if (dist <= (a.shotRange ?? 18) && this.shotCd <= 0 && facing && ctx.requestShot(this)) {
          this.startSpell(ctx);
          break;
        }
        // Keep 8-12 m away, gliding sideways.
        this.strafe(ctx, dt, toPlayer, dist > 12 ? 1 : dist < 8 ? -1 : 0, 0.55, a.moveSpeed, 0.35);
        break;
      }

      case 'cast':
        this.cast = this.windupK();
        // The telegraph fires the spell; this is the fallback if it was lost.
        if (this.stateT > (a.shotWindup ?? 1.3) + 0.3) this.enter('recover');
        break;

      case 'burst': {
        // Blink: shrink away, move, grow back.
        if (this.blinkTo && this.stateT >= BLINK_TIME / 2) {
          ctx.blinkFx(this.pos.x, this.pos.z);
          this.pos.x = this.blinkTo[0];
          this.pos.z = this.blinkTo[1];
          this.knock.set(0, 0, 0);
          this.blinkTo = null;
          ctx.blinkFx(this.pos.x, this.pos.z);
          this.cue('sorcerer.blink');
          if (this.drain) this.yaw = yawTo(this.pos.x, this.pos.z, this.drain.x, this.drain.z);
          else this.yaw = toPlayer;
        }
        if (this.stateT >= BLINK_TIME) {
          if (this.drain) {
            this.enter('aim');
            this.cue('sorcerer.drain');
          } else {
            this.blinkCd = ruinsCfg.blinkCooldown;
            this.enter('hover');
          }
        }
        break;
      }

      case 'aim': {
        // Draining a pylon.
        const d = this.drain;
        if (!d) {
          this.enter('hover');
          break;
        }
        this.yaw = turnToward(this.yaw, yawTo(this.pos.x, this.pos.z, d.x, d.z), a.turnSpeed * dt);
        const k = Math.min(1, this.stateT / pylonCfg.snuffTime);
        ctx.snuffPylon(d.id, k);
        if (k >= 1) {
          this.drain = null;
          this.cue('pylon.snuff');
          this.enter('recover');
        }
        break;
      }

      case 'recover':
        this.cast = Math.max(0, this.cast - dt * 3);
        if (this.stateT >= a.recovery) {
          this.cooldown = a.attackCooldown;
          this.enter('hover');
        }
        break;
    }
    if (this.state !== 'cast' && this.state !== 'recover') this.cast = Math.max(0, this.cast - dt * 3);
  }

  private startBlink(ctx: EnemyContext, spot: [number, number], drain: { id: number; x: number; z: number } | null): void {
    this.tele.cancelAll();
    this.blinkTo = spot;
    this.drain = drain;
    this.enter('burst');
    ctx.blinkFx(this.pos.x, this.pos.z);
  }

  private startSpell(ctx: EnemyContext): void {
    const a = this.arch;
    const options: Spell[] = (['ring', 'field', 'line'] as Spell[]).filter((s) => s !== this.lastSpell);
    this.spell = options[Math.floor(ctx.rng() * options.length)];
    this.lastSpell = this.spell;
    this.beginWindup('cast', a.shotWindup ?? 1.3);
    this.cue('sorcerer.cast');
    // (An Overclocked follow-up's telegraphs are quicker than the cast pose.)
    const secs = (a.shotWindup ?? 1.3) * this.windupScale;
    const px = ctx.playerX;
    const pz = ctx.playerZ;
    const fire = (shape: TelegraphShape, mult: number, fx: () => void, last: boolean) => {
      this.warn(ctx, shape, secs, () => {
        if (!this.alive || this.state !== 'cast') return;
        fx();
        ctx.areaStrike(this, shape, mult, 3, a.shotStatus, a.shotStatusChance);
        if (last) {
          this.tele.forget();
          this.released = 0.35;
          this.enter('recover');
          this.shotCd = this.rollShotCd(ctx, 3.8);
        }
      }, CORRUPT_COLOR);
    };
    switch (this.spell) {
      case 'ring': {
        // Fire ring around you: safe in its middle, or well outside.
        const shape: TelegraphShape = { kind: 'arc', x: px, z: pz, yaw: 0, inner: ruinsCfg.ringInner, outer: ruinsCfg.ringOuter, arcDeg: 360 };
        fire(shape, 0.95, () => {
          this.cue('tech.foie');
          ctx.boom(px, pz, ruinsCfg.ringOuter, 0xff7a40);
        }, true);
        break;
      }
      case 'field': {
        // Lightning: one circle on you, one where you are heading, one near.
        const r = ruinsCfg.fieldRadius;
        for (let i = 0; i < ruinsCfg.fieldBolts; i++) {
          const ang = ctx.rng() * Math.PI * 2;
          const d = i === 0 ? 0 : 2.4 + ctx.rng() * 2.2;
          const x = px + Math.sin(ang) * d;
          const z = pz + Math.cos(ang) * d;
          fire({ kind: 'circle', x, z, radius: r }, 0.9, () => ctx.bolt(x, z, 0xc8a0ff), i === ruinsCfg.fieldBolts - 1);
        }
        break;
      }
      case 'line': {
        // Ice line from it, through you and on.
        const yaw = yawTo(this.pos.x, this.pos.z, px, pz);
        const len = a.shotRange ?? 18;
        const shape: TelegraphShape = { kind: 'line', x: this.pos.x, z: this.pos.z, yaw, length: len, width: ruinsCfg.iceWidth };
        fire(shape, 1.0, () => {
          this.cue('tech.barta');
          ctx.tracer(this.pos.x, this.pos.z, yaw, len, 0x9ad8ff);
        }, true);
        break;
      }
    }
  }

  protected targetPose(dt: number): { pose: Pose; rate: number } {
    const moved = Math.hypot(this.pos.x - this.lastX, this.pos.z - this.lastZ);
    this.lastX = this.pos.x;
    this.lastZ = this.pos.z;
    const speed = dt > 0 ? moved / dt : 0;
    switch (this.state) {
      case 'cast':
        return { pose: sorcererPoses.cast(this.cast), rate: 10 };
      case 'recover':
        return { pose: this.released > 0 ? sorcererPoses.release() : sorcererPoses.idle(this.time), rate: this.released > 0 ? 25 : 5 };
      case 'aim':
        return { pose: sorcererPoses.drain(this.time), rate: 12 };
      case 'hitstun':
      case 'dead':
        return { pose: sorcererPoses.hurt(), rate: 18 };
      case 'frozen':
        return { pose: sorcererPoses.hurt(), rate: 0 };
      default:
        if (speed > 0.4) return { pose: sorcererPoses.glide(Math.min(1, speed / 2.5)), rate: 5 };
        return { pose: sorcererPoses.idle(this.time), rate: 5 };
    }
  }

  protected animate(dt?: number): void {
    super.animate(dt);
    let blink = 0;
    if (this.state === 'burst') blink = this.stateT < BLINK_TIME / 2 ? this.stateT / (BLINK_TIME / 2) : 1 - (this.stateT - BLINK_TIME / 2) / (BLINK_TIME / 2);
    const castK = this.state === 'cast' ? this.cast : this.state === 'aim' ? 0.8 : 0;
    this.model.update(this.time, castK, blink, this.alive);
    if (!this.alive) {
      // Dissolves rather than toppling.
      this.rig.root.scale.setScalar(Math.max(0.02, 1 - this.deadT * 0.9));
    }
    this.model.eyes.emissiveIntensity = this.alive ? 1.8 : 0.1;
  }
}

// -------------------------------------------------------------- Dark Belra

/** Fist extension speed (m/s) and how long the arm stays out before it pulls back. */
const PUNCH_OUT = 0.18;

/**
 * Slow stone giant. From up to 11 m it draws its right fist back and punches it down a lane (the
 * arm stretches the whole way); if you crowd it, it raises both arms and slams the ground around
 * itself, a violet circle that corrupts.
 */
export class DarkBelra extends Enemy {
  protected topplesOnDeath = false;
  private model: BelraModel;
  private shotCd: number;
  private lane: TelegraphShape | null = null;
  private punching = false;
  private reach = 0;
  private walkPhase = 0;
  private lastX: number;
  private lastZ: number;

  constructor(type: EnemyId, arch: EnemyArchetype, x: number, z: number, rng: () => number, opts: EnemyOptions = {}) {
    const model = new BelraModel(arch.color);
    super(type, arch, x, z, rng, model.rig, opts);
    this.model = model;
    (this as { radius: number }).radius = 1.35 * arch.scale;
    this.shotCd = 1 + rng() * 2;
    this.lastX = x;
    this.lastZ = z;
  }

  get aimHeight(): number {
    return 2.7 * this.arch.scale;
  }

  protected corruptingAttack(): boolean {
    return this.state === 'burst';
  }

  protected telegraphHeat(): number {
    return this.state === 'strike' ? 1 : this.windupK();
  }

  /** Overclocked: a second punch down a fresh lane. */
  protected followUp(ctx: EnemyContext): boolean {
    if (!this.punching || !ctx.playerAlive) return false;
    this.startPunch(ctx, yawTo(this.pos.x, this.pos.z, ctx.playerX, ctx.playerZ));
    return true;
  }

  protected think(dt: number, ctx: EnemyContext, dist: number, toPlayer: number): void {
    const a = this.arch;
    this.shotCd = Math.max(0, this.shotCd - dt);
    if (this.state === 'spawning') this.yaw = toPlayer;
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
        this.yaw = turnToward(this.yaw, toPlayer, a.turnSpeed * dt);
        const facing = Math.abs(angleDelta(this.yaw, toPlayer)) < 0.35;
        if (dist <= a.attackRange + 0.4 && this.cooldown <= 0 && ctx.requestAttackToken(this)) {
          this.startSlam(ctx);
          break;
        }
        if (dist > a.attackRange + 0.5 && dist <= (a.shotRange ?? 11) - 0.5 && this.shotCd <= 0 && facing && ctx.requestShot(this)) {
          this.startPunch(ctx, toPlayer);
          break;
        }
        if (dist > a.attackRange * 0.8) {
          this.pos.x += Math.sin(this.yaw) * a.moveSpeed * dt;
          this.pos.z += Math.cos(this.yaw) * a.moveSpeed * dt;
        }
        break;
      }

      case 'aim':
        if (this.stateT > (a.shotWindup ?? 1.3) + 0.3) this.enter('recover');
        break;
      case 'burst':
        if (this.stateT > a.windup + 0.3) this.enter('recover');
        break;

      case 'strike':
        // The fist flies out along the lane.
        if (this.punching && this.lane?.kind === 'line') this.reach = Math.min(this.lane.length - 1, this.stateT / PUNCH_OUT * this.lane.length);
        if (this.stateT >= (this.punching ? PUNCH_OUT + 0.15 : 0.3)) this.enter('recover');
        break;

      case 'recover':
        this.reach = Math.max(0, this.reach - dt * 14);
        if (this.stateT >= a.recovery) {
          this.punching = false;
          this.shotCd = Math.max(this.shotCd, (a.shotCooldown ?? 4.2) * (0.8 + ctx.rng() * 0.4));
          this.rollCooldown(ctx);
          this.enter('chase');
        }
        break;
    }
  }

  private startPunch(ctx: EnemyContext, yaw: number): void {
    const a = this.arch;
    this.yaw = yaw;
    this.punching = true;
    // From its right shoulder, down a lane.
    const lane: TelegraphShape = { kind: 'line', x: this.pos.x, z: this.pos.z, yaw, length: a.shotRange ?? 11, width: (a.shotRadius ?? 0.95) * 2 };
    this.lane = lane;
    this.beginWindup('aim', a.shotWindup ?? 1.3);
    this.cue('belra.windup');
    this.warn(ctx, lane, (a.shotWindup ?? 1.3) * this.windupScale, () => {
      if (!this.alive || this.state !== 'aim') return;
      this.enter('strike');
      this.cue('belra.punch');
      ctx.areaStrike(this, lane, ruinsCfg.punchAtpMult, 10);
    }, RED);
  }

  private startSlam(ctx: EnemyContext): void {
    const a = this.arch;
    this.punching = false;
    const shape: TelegraphShape = { kind: 'circle', x: this.pos.x, z: this.pos.z, radius: a.strikeRange };
    this.beginWindup('burst', a.windup);
    this.cue('ruins.growl');
    this.warn(ctx, shape, a.windup * this.windupScale, () => {
      if (!this.alive || this.state !== 'burst') return;
      this.enter('strike');
      this.cue('belra.slam');
      ctx.boom(shape.x, shape.z, shape.radius, CORRUPT_COLOR);
      ctx.areaStrike(this, shape, ruinsCfg.slamAtpMult, a.strikeKnockback ?? 11, a.strikeStatus, a.strikeStatusChance);
    }, CORRUPT_COLOR);
  }

  protected targetPose(dt: number): { pose: Pose; rate: number } {
    const moved = Math.hypot(this.pos.x - this.lastX, this.pos.z - this.lastZ);
    this.lastX = this.pos.x;
    this.lastZ = this.pos.z;
    const speed = dt > 0 ? moved / dt : 0;
    this.walkPhase += (moved / 2.2) * Math.PI * 2;
    switch (this.state) {
      case 'aim':
        return { pose: belraPoses.punchWindup(this.windupK()), rate: 10 };
      case 'burst':
        return { pose: belraPoses.slamWindup(this.windupK()), rate: 10 };
      case 'strike':
        return { pose: this.punching ? belraPoses.punch() : belraPoses.slam(), rate: 30 };
      case 'recover':
        return { pose: this.stateT < this.arch.recovery * 0.5 ? (this.punching ? belraPoses.punch() : belraPoses.slam()) : belraPoses.idle(this.time), rate: 5 };
      case 'hitstun':
        return { pose: belraPoses.hurt(), rate: 16 };
      case 'dead':
        return { pose: belraPoses.slam(), rate: 3 };
      case 'frozen':
        return { pose: belraPoses.hurt(), rate: 0 };
      default:
        if (speed > 0.2) return { pose: belraPoses.walk(this.walkPhase, Math.min(1, speed / 1.7)), rate: 8 };
        return { pose: belraPoses.idle(this.time), rate: 5 };
    }
  }

  protected animate(dt?: number): void {
    super.animate(dt);
    this.model.setReach(this.alive ? this.reach : 0);
    this.model.cracks.emissiveIntensity = !this.alive ? 0.1 : this.state === 'burst' ? 1.5 + this.stateT * 1.5 : 1.1 + Math.sin(this.time * 2) * 0.2;
    this.model.eyes.emissiveIntensity = this.alive ? 2 : 0.1;
    if (!this.alive) this.rig.root.position.y = -Math.min(2.2, Math.max(0, this.deadT - 0.3) * 1.6);
  }
}

// ------------------------------------------------------------ Chaos Bringer

type BringerMove = 'charge' | 'laser' | 'stomp';

/**
 * Centaur mini-boss. It rears and charges down a lane across the room (the whole threat budget,
 * so nothing else attacks meanwhile), opens its chest for a fan of corrupting lasers, and rears and
 * stomps if you stand close. After a charge it skids to a stop: the punish window.
 */
export class ChaosBringer extends Enemy {
  protected topplesOnDeath = false;
  private model: BringerModel;
  private move: BringerMove = 'stomp';
  private shotCd: number;
  private chargeCd: number;
  private lane: { yaw: number; length: number; x: number; z: number } | null = null;
  private charged = 0;
  private chargeHit = false;
  private gait = 0;
  private lastX: number;
  private lastZ: number;

  constructor(type: EnemyId, arch: EnemyArchetype, x: number, z: number, rng: () => number, opts: EnemyOptions = {}) {
    const model = new BringerModel(arch.color);
    super(type, arch, x, z, rng, model.rig, opts);
    this.model = model;
    (this as { radius: number }).radius = 1.5 * arch.scale;
    this.shotCd = 2 + rng() * 2;
    this.chargeCd = 1.5 + rng() * 2;
    this.lastX = x;
    this.lastZ = z;
  }

  get aimHeight(): number {
    return 2.8 * this.arch.scale;
  }

  protected corruptingAttack(): boolean {
    return this.move === 'laser';
  }

  protected flinch(): void {
    // Mid-charge it can't be stopped.
    if (this.state === 'strike' && this.move === 'charge') return;
    this.enter('hitstun');
  }

  protected think(dt: number, ctx: EnemyContext, dist: number, toPlayer: number): void {
    const a = this.arch;
    this.shotCd = Math.max(0, this.shotCd - dt);
    this.chargeCd = Math.max(0, this.chargeCd - dt);
    if (this.state === 'spawning') this.yaw = toPlayer;
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
        this.yaw = turnToward(this.yaw, toPlayer, a.turnSpeed * dt);
        const facing = Math.abs(angleDelta(this.yaw, toPlayer)) < 0.35;
        if (dist <= a.attackRange + 0.3 && this.cooldown <= 0 && ctx.requestAttackToken(this)) {
          this.startStomp(ctx);
          break;
        }
        if (dist > 5 && dist < 22 && this.chargeCd <= 0 && facing && ctx.requestShot(this, ai.barrageThreat)) {
          this.startCharge(ctx, toPlayer);
          break;
        }
        if (dist > 4 && dist <= (a.shotRange ?? 14) && this.shotCd <= 0 && facing && ctx.requestShot(this)) {
          this.startLaser(ctx, toPlayer);
          break;
        }
        // Trots to mid range.
        const radial = dist > 9 ? 1 : dist < 5 ? -0.5 : 0;
        this.pos.x += Math.sin(toPlayer) * radial * a.moveSpeed * dt;
        this.pos.z += Math.cos(toPlayer) * radial * a.moveSpeed * dt;
        break;
      }

      case 'aim':
        // Rearing before the charge; the lane telegraph sets it off.
        if (this.stateT > ruinsCfg.chargeWindup + 0.3) this.enter('recover');
        break;
      case 'cast':
        if (this.stateT > (a.shotWindup ?? 1.2) + 0.3) this.enter('recover');
        break;
      case 'burst':
        if (this.stateT > a.windup + 0.3) this.enter('recover');
        break;

      case 'strike':
        if (this.move === 'charge' && this.lane) {
          const step = ruinsCfg.chargeSpeed * dt;
          this.charged += step;
          this.pos.x += Math.sin(this.lane.yaw) * step;
          this.pos.z += Math.cos(this.lane.yaw) * step;
          // Tramples whoever it runs into (once).
          if (!this.chargeHit && ctx.playerAlive) {
            const body: TelegraphShape = { kind: 'circle', x: this.pos.x, z: this.pos.z, radius: this.radius + 0.4 };
            if (inShape(body, ctx.playerX, ctx.playerZ, 0.45)) {
              this.chargeHit = true;
              ctx.areaStrike(this, body, ruinsCfg.chargeAtpMult, 14);
            }
          }
          if (this.charged >= this.lane.length) {
            this.cue('bringer.skid');
            this.enter('recover');
          }
        } else if (this.stateT >= 0.35) this.enter('recover');
        break;

      case 'recover': {
        const hold = this.move === 'charge' ? a.recovery * 1.3 : a.recovery;
        if (this.stateT >= hold) {
          this.rollCooldown(ctx);
          this.enter('chase');
        }
        break;
      }
    }
  }

  private startCharge(ctx: EnemyContext, yaw: number): void {
    this.move = 'charge';
    this.yaw = yaw;
    const length = Math.max(4, ctx.reach(this.pos.x, this.pos.z, yaw, 24) - this.radius - 0.5);
    this.lane = { yaw, length, x: this.pos.x, z: this.pos.z };
    this.charged = 0;
    this.chargeHit = false;
    this.beginWindup('aim', ruinsCfg.chargeWindup);
    this.cue('bringer.roar');
    const shape: TelegraphShape = { kind: 'line', x: this.pos.x, z: this.pos.z, yaw, length: length + this.radius, width: ruinsCfg.chargeWidth };
    this.warn(ctx, shape, ruinsCfg.chargeWindup * this.windupScale, () => {
      if (!this.alive || this.state !== 'aim') return;
      this.tele.forget();
      this.enter('strike');
      this.cue('bringer.charge');
      this.chargeCd = ruinsCfg.chargeCooldown * (0.85 + ctx.rng() * 0.3);
    }, RED);
  }

  private startLaser(ctx: EnemyContext, yaw: number): void {
    const a = this.arch;
    this.move = 'laser';
    this.yaw = yaw;
    this.beginWindup('cast', a.shotWindup ?? 1.2);
    this.cue('bringer.laserCharge');
    const n = ruinsCfg.laserLanes;
    const lanes: TelegraphShape[] = [];
    for (let i = 0; i < n; i++) {
      const off = THREE.MathUtils.degToRad((i - (n - 1) / 2) * ruinsCfg.laserSpreadDeg);
      lanes.push({ kind: 'line', x: this.pos.x, z: this.pos.z, yaw: yaw + off, length: a.shotRange ?? 14, width: (a.shotRadius ?? 0.8) * 2 });
    }
    const secs = (a.shotWindup ?? 1.2) * this.windupScale;
    lanes.forEach((lane, i) => {
      this.warn(ctx, lane, secs, () => {
        if (!this.alive || this.state !== 'cast') return;
        if (lane.kind === 'line') ctx.tracer(lane.x, lane.z, lane.yaw, lane.length, 0xff60c0);
        if (i !== n - 1) return;
        // One hit at most, whichever lanes she stood in.
        this.tele.forget();
        const hit = lanes.find((l) => inShape(l, ctx.playerX, ctx.playerZ, 0.45));
        if (hit) ctx.areaStrike(this, hit, ruinsCfg.laserAtpMult, 5, a.shotStatus, a.shotStatusChance);
        this.cue('bringer.laser');
        this.shotCd = this.rollShotCd(ctx, 5);
        this.enter('strike');
      }, CORRUPT_COLOR);
    });
  }

  private startStomp(ctx: EnemyContext): void {
    const a = this.arch;
    this.move = 'stomp';
    const shape: TelegraphShape = { kind: 'circle', x: this.pos.x, z: this.pos.z, radius: a.strikeRange };
    this.beginWindup('burst', a.windup);
    this.cue('bringer.roar');
    this.warn(ctx, shape, a.windup * this.windupScale, () => {
      if (!this.alive || this.state !== 'burst') return;
      this.tele.forget();
      this.enter('strike');
      this.cue('garanz.stomp');
      ctx.areaStrike(this, shape, 1.0, a.strikeKnockback ?? 12);
    }, RED);
  }

  protected targetPose(dt: number): { pose: Pose; rate: number } {
    const moved = Math.hypot(this.pos.x - this.lastX, this.pos.z - this.lastZ);
    this.lastX = this.pos.x;
    this.lastZ = this.pos.z;
    const speed = dt > 0 ? moved / dt : 0;
    this.gait += (moved / 2.6) * Math.PI * 2;
    let rear = 0;
    let legs = Math.min(1, speed / 3);
    let out: { pose: Pose; rate: number };
    switch (this.state) {
      case 'aim':
      case 'burst':
        rear = this.windupK();
        out = { pose: bringerPoses.rear(rear), rate: 10 };
        break;
      case 'cast':
        out = { pose: bringerPoses.laser(this.windupK()), rate: 10 };
        break;
      case 'strike':
        if (this.move === 'charge') {
          legs = 1.2;
          out = { pose: bringerPoses.charge(this.gait), rate: 14 };
        } else out = { pose: this.move === 'laser' ? bringerPoses.laser(1) : bringerPoses.stomp(), rate: 30 };
        break;
      case 'recover':
        out = { pose: this.stateT < 0.5 && this.move !== 'charge' ? bringerPoses.stomp() : bringerPoses.idle(this.time), rate: 5 };
        break;
      case 'hitstun':
      case 'dead':
        out = { pose: bringerPoses.hurt(), rate: this.state === 'dead' ? 4 : 16 };
        break;
      case 'frozen':
        out = { pose: bringerPoses.hurt(), rate: 0 };
        break;
      default:
        out = speed > 0.3 ? { pose: bringerPoses.gallop(this.gait, legs), rate: 10 } : { pose: bringerPoses.idle(this.time), rate: 5 };
    }
    this.model.legs(this.gait, this.state === 'chase' || this.state === 'hover' || this.state === 'strike' ? legs : 0, rear);
    return out;
  }

  protected animate(dt?: number): void {
    super.animate(dt);
    this.model.core.emissiveIntensity = !this.alive ? 0.1 : this.state === 'cast' ? 1.4 + this.stateT * 3 : 1.4 + Math.sin(this.time * 3) * 0.3;
    this.model.eyes.emissiveIntensity = this.alive ? 2 : 0.1;
    if (!this.alive) this.rig.root.position.y = -Math.min(2.4, Math.max(0, this.deadT - 0.3) * 1.6);
  }
}
