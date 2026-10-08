import * as THREE from 'three';
import { affixes as affixCfg, elite as eliteCfg, hard as hardCfg, pylonCfg, stagger as staggerCfg, type EnemyArchetype, type EnemyId, type PlayerStatus, type Race } from '../config';
import { AFFIXES, type Affix } from '../data/affixes';
import { angleDelta, turnToward, yawTo } from '../collision';
import type { Hittable, StatusEffect, StatusTimer } from '../combat/types';
import { boomaPoses } from '../models/booma';
import type { Pose, Rig } from '../models/Rig';
import { TelegraphGroup, type TelegraphShape } from '../world/Telegraph';
import { glowDecal } from '../world/glow';
import { AffixFx } from './affixFx';

export type EnemyState =
  | 'spawning'
  | 'idle'
  | 'chase'
  | 'hover'
  | 'windup'
  | 'strike'
  | 'recover'
  | 'hitstun'
  | 'frozen'
  | 'aim'
  | 'cast'
  | 'burst'
  /** A linked gunbot knocked down while its control node stands: it reboots. */
  | 'offline'
  | 'dead';

export type PlayerStatusKind = PlayerStatus;

export type { Affix } from '../data/affixes';

/** Handle to a telegraph an enemy started, so a flinch can call it off. */
export interface TelegraphHandle {
  cancel(): void;
}

/** What the enemy needs to know from the world each tick. */
export interface EnemyContext {
  playerX: number;
  playerZ: number;
  playerAlive: boolean;
  /** Ask for a share (weight, default 1) of the threat budget before an attack; on success the enemy holds it. */
  requestAttackToken(enemy: Enemy, weight?: number): boolean;
  /** Ranged / caster attacks: the same budget, plus their own slower rhythm. */
  requestShot(enemy: Enemy, weight?: number): boolean;
  /** Strike is live; returns true if it connected (so it only hits once). */
  tryStrike(enemy: Enemy): boolean;
  /** Damage-over-time tick (burn / poison). */
  onDot(enemy: Enemy, damage: number, kind: 'burn' | 'poison'): void;
  /** Show a ground telegraph; onFire runs when it completes. */
  telegraph(shape: TelegraphShape, duration: number, onFire: () => void, color?: number): TelegraphHandle;
  /** Area attack from this enemy: damage (its ATP x mult) and an optional status if the player is inside. */
  areaStrike(enemy: Enemy, shape: TelegraphShape, atpMult: number, knockback: number, status?: PlayerStatusKind, chance?: number): boolean;
  /** Cosmetic arcing glob (Lily spit). */
  lob(from: THREE.Vector3, toX: number, toZ: number, duration: number, color: number): void;
  /** Cosmetic lightning strike. */
  bolt(x: number, z: number, color: number): void;
  /** A blast from this enemy's weapon (Garanz missiles): hurts other machines caught in it and flips power switches. */
  blast(source: Enemy, x: number, z: number, radius: number): void;
  /** Cosmetic missile arcing to a landing spot (Garanz). */
  missile(from: THREE.Vector3, toX: number, toZ: number, duration: number): void;
  /** Cosmetic straight shot along a lane (gunbots). */
  tracer(x: number, z: number, yaw: number, length: number, color: number): void;
  /** Leave a burning patch on the floor (Molten, Volatile). */
  firePatch(x: number, z: number, radius: number, life: number): void;
  /** An enemy got healed (Regenerating): show it. */
  healed(enemy: Enemy, amount: number): void;
  /** Cosmetic blast: a ring and a flash with a bang (Volatile vents, the Frenzied roar). */
  boom(x: number, z: number, radius: number, color: number): void;
  /** A free spot about `dist` m from (x, z) inside this enemy's room, away from walls (Sorcerer blinks); null if none. */
  blinkSpot(e: Enemy, x: number, z: number, dist: number): [number, number] | null;
  /** Metres from (x, z) along `yaw` before a wall, up to `max` (Chaos Bringer charge lanes). */
  reach(x: number, z: number, yaw: number, max: number): number;
  /** A lit pylon in this enemy's room (Chaos Sorcerers put them out), or null. */
  litPylon(e: Enemy): { id: number; x: number; z: number } | null;
  /** A Sorcerer's snuff on a pylon: progress 0..1 (shown on the pylon); 1 puts it out, -1 calls it off. */
  snuffPylon(id: number, k: number): void;
  /** Cosmetic dark burst where a Sorcerer blinks out or in. */
  blinkFx(x: number, z: number): void;
  rng(): number;
}

export interface EnemyOptions {
  elite?: boolean;
  /** No XP / drops / Mag progress on death (re-formed Pan Arms halves). */
  noReward?: boolean;
  /** Starting HP (defaults to max). */
  hp?: number;
  /** Elite affixes (Normal Mines elites: one machine affix; Hard: any, two on champions). */
  affixes?: Affix[];
  /** Hard: the room's champion (two affixes, gold aura, tougher, richer drops). */
  champion?: boolean;
  /** Stats to use instead of the type's own (Hard scaling, Splitting copies). */
  arch?: EnemyArchetype;
}

let nextId = 1;
const TMP_COLOR = new THREE.Color();
const WINDUP_COLOR = new THREE.Color(0xff5a1a);
/** Attacks that corrupt (Ruins) glow violet instead, like their telegraphs. */
export const CORRUPT_COLOR = 0xa040ff;
const CORRUPT_TINT = new THREE.Color(CORRUPT_COLOR);
const BURN_COLOR = new THREE.Color(0xff8800);
const POISON_COLOR = new THREE.Color(0x60d040);
const FREEZE_COLOR = new THREE.Color(0x9fdcff);
/** Molten bodies are charred dark (their cracks glow through the emissive). */
const MOLTEN_COLOR = new THREE.Color(0x2a140c);
export const SPAWN_TIME = 0.8;
/** Poison on enemies is capped so bosses and big HP pools don't melt. */
const POISON_DPS_CAP = 18;
/** States an attack's threat share is held through (it is released on entering any other). */
const ATTACK_STATES: ReadonlySet<EnemyState> = new Set(['windup', 'strike', 'aim', 'cast', 'burst']);

/** Shared plumbing for every field enemy: Hittable, statuses, damage, death and tinting. */
export abstract class Enemy implements Hittable {
  readonly id = nextId++;
  readonly group = new THREE.Group();
  readonly pos = this.group.position;
  readonly radius: number;
  readonly elite: boolean;
  readonly maxHp: number;
  private readonly baseAtp: number;
  readonly affixes: Affix[];
  readonly champion: boolean;
  /** A Shielding ally tethered to it: it takes reduced damage while that one lives. */
  shieldedBy: Enemy | null = null;
  /** Shielding: allies it protects right now, and where it wants to stand (behind them); set by the world. */
  shieldAllies = 0;
  shieldSpot: { x: number; z: number } | null = null;
  noReward: boolean;
  /** Damage to it no longer charges injectors (a rebooted gunbot). */
  noCharge = false;
  yaw = 0;
  hp: number;
  state: EnemyState = 'spawning';
  stateT = 0;
  cooldown: number;
  /** Share of the threat budget this enemy's current attack holds (0: none). */
  threat = 0;
  /** Seconds the share is still held after the attack state ends (a projectile still in the air). */
  private threatLinger = 0;
  readonly knock = new THREE.Vector3();
  burnT = 0;
  burnDps = 0;
  poisonT = 0;
  poisonDps = 0;
  /** Duration the running burn / poison started from (for the HUD timer). */
  private burnTotal = 0;
  private poisonTotal = 0;
  /** Seconds since death, used for despawn. */
  deadT = 0;
  /** Room this enemy belongs to (for wave tracking), and which wave. */
  room: string | null = null;
  wave = 0;
  strikesLeft = 0;
  /** Removed without counting as a kill (Pan Arms splitting, halves merging). */
  vanished = false;
  /** Partner to walk toward while merging (Pan Arms halves). */
  mergeTarget: Enemy | null = null;
  /** Sound cues raised this frame (drained by AudioCues, so enemies stay audio-free). */
  readonly cues: string[] = [];
  /** Telegraphs it has running that a flinch, or its death, calls off (see warn). */
  protected readonly tele = new TelegraphGroup();
  /** Which way it strafes while it circles the player (+1 / -1). */
  protected strafeDir = 1;

  protected time = Math.random() * 10;
  protected flashT = 0;
  protected stunFor = 0;
  /** Stagger meter: flinches at poise, drains after a pause in hits. */
  private staggerPts = 0;
  private staggerIdle = 0;
  /** Rooted enemies (Lilies) ignore knockback and can't be shoved by bodies. */
  rooted = false;
  /** A Dark enemy standing in pylon light (set by the world each frame): slowed and takes more damage. */
  lit = false;
  private dotT = 0;
  private aura: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null = null;
  private tintBase: THREE.Color[];
  /** Stormcaller: seconds to its next lightning call. */
  private stormT = 3 + Math.random() * 3;
  /** Enemies that apply `tempo` to their own timings (the Mines machines) set this. */
  protected selfTempo = false;
  /** Melee bodies whose 'strike' is a swing in front of them (Molten burns where it lands). */
  protected meleeStrikes = false;
  /** Overclocked: the attack running now is the extra one (it doesn't get another). */
  protected followingUp = false;
  /** The windup running now (see beginWindup): its state, and its length in base seconds. */
  private windupState: EnemyState | null = null;
  private windupBase = 0;
  /** The context of the current tick, for reactions that start outside think() (the Overclocked follow-up). */
  private ctxRef: EnemyContext | null = null;
  /** Seconds since it last took a hit (Regenerating waits a moment). */
  private sinceHit = 99;
  /** Regenerating: healed HP waiting to be shown, and the timer for showing it. */
  private regenShown = 0;
  private regenShowT = 0;
  private regenState: 'active' | 'idle' | 'off' = 'idle';
  /** Volatile vents, Molten spew: seconds to the next. */
  private ventT = affixCfg.ventEvery * 0.6;
  private spewT = affixCfg.spewEvery * (0.5 + Math.random() * 0.5);
  /** Frenzied: the roar has gone off. */
  private roared = false;
  /** The player's last position and smoothed velocity (Stormcaller leads her). */
  private lastPX = NaN;
  private lastPZ = 0;
  private pvx = 0;
  private pvz = 0;
  /** Its own ground speed (for the affix effects). */
  private fxX = 0;
  private fxZ = 0;
  private speed = 0;
  /** Seconds a heal glow still shows. */
  private healGlowT = 0;
  private fx: AffixFx | null = null;

  constructor(
    readonly type: EnemyId,
    readonly arch: EnemyArchetype,
    x: number,
    z: number,
    rng: () => number,
    protected readonly rig: Rig,
    opts: EnemyOptions = {},
  ) {
    this.champion = !!opts.champion;
    this.elite = !!opts.elite || this.champion;
    this.affixes = this.elite ? [...(opts.affixes ?? [])] : [];
    this.noReward = !!opts.noReward;
    this.maxHp = Math.round(arch.hp * (this.champion ? hardCfg.championHp : this.elite ? eliteCfg.hpMult : 1));
    this.baseAtp = Math.round(arch.atp * (this.champion ? hardCfg.championAtp : this.elite ? eliteCfg.atpMult : 1));
    this.hp = Math.min(this.maxHp, opts.hp ?? this.maxHp);
    this.radius = 0.75 * arch.scale;
    this.pos.set(x, 0, z);
    this.cooldown = 0.5 + rng() * 1.5;
    rig.root.scale.setScalar(arch.scale);
    this.group.add(rig.root);
    this.tintBase = rig.tintable.map((m) => m.color.clone());
    if (this.elite) {
      // A halo underfoot marks elites (violet) and champions (gold, wider). What the affixes are
      // shows on the body itself (affixFx.ts).
      this.aura = glowDecal(this.champion ? 0xffc040 : 0xb060ff, (this.champion ? 4.4 : 3.4) * arch.scale, 0.55);
      this.group.add(this.aura);
    }
    if (this.affixes.length) {
      this.fx = new AffixFx(this.affixes, arch.scale);
      this.group.add(this.fx.group);
    }
    this.fxX = x;
    this.fxZ = z;
  }

  // --------------------------------------------------------- Hittable

  get name(): string {
    if (this.champion) return `Champion ${this.arch.name}`;
    if (!this.elite) return this.arch.name;
    return `${this.affixes.length === 1 ? AFFIXES[this.affixes[0]].name : 'Elite'} ${this.arch.name}`;
  }
  hasAffix(a: Affix): boolean {
    return this.affixes.includes(a);
  }
  /** Frenzied, and below its threshold. */
  get frenzied(): boolean {
    return this.hasAffix('frenzied') && this.hp < this.maxHp * affixCfg.frenzyAt;
  }
  /** Speed multiplier on movement and attack timings (Overclocked elites run faster, Frenzied ones once hurt; pylon light slows the Dark). */
  get tempo(): number {
    let t = this.hasAffix('overclocked') ? affixCfg.overclockedTempo : 1;
    if (this.frenzied) t *= affixCfg.frenzyTempo;
    t = Math.min(affixCfg.tempoCap, t);
    return this.lit ? t * pylonCfg.enemySlow : t;
  }
  /** Attack power (Frenzied hits harder once frenzied). */
  get atp(): number {
    return this.frenzied ? Math.round(this.baseAtp * affixCfg.frenzyAtp) : this.baseAtp;
  }
  /** Overclocked follow-up attacks wind up faster; multiply a windup by this. */
  protected get windupScale(): number {
    return this.followingUp ? affixCfg.followUpWindup : 1;
  }
  get evp(): number {
    return this.arch.evp;
  }
  get dfp(): number {
    return this.arch.dfp;
  }
  get race(): Race {
    return this.arch.race;
  }
  get aimHeight(): number {
    return 1.6 * this.arch.scale;
  }
  get alive(): boolean {
    return this.state !== 'dead';
  }
  get invulnerable(): boolean {
    return this.state === 'spawning';
  }
  get hasToken(): boolean {
    return this.threat > 0;
  }
  /** Is the enemy currently using a melee attack token? */
  get attacking(): boolean {
    return this.state === 'windup' || this.state === 'strike';
  }
  /** XP this kill is worth (0 for no-reward spawns). */
  get xp(): number {
    return this.noReward ? 0 : Math.round(this.arch.xp * (this.champion ? hardCfg.championXp : this.elite ? eliteCfg.xpMult : 1));
  }

  /**
   * Shielded by a living Shielding ally: it takes reduced damage. A Shielding elite with nobody left
   * to protect shields its own front (hits from `fromX, fromZ` in front of it).
   */
  damageMult(fromX?: number, fromZ?: number, _heavy?: boolean): number {
    const light = this.lit ? pylonCfg.enemyDamage : 1;
    if (this.shieldedBy?.alive) return affixCfg.shieldMult * light;
    if (this.hasAffix('shielding') && this.shieldAllies === 0 && fromX !== undefined && fromZ !== undefined) {
      const front = Math.abs(angleDelta(this.yaw, yawTo(this.pos.x, this.pos.z, fromX, fromZ)));
      if (front <= (affixCfg.selfShieldArcDeg * Math.PI) / 180) return affixCfg.selfShieldMult * light;
    }
    return light;
  }

  /** Stagger points needed to flinch. */
  get poise(): number {
    return this.arch.poise + (this.champion ? hardCfg.championPoise : this.elite ? eliteCfg.poiseBonus : 0);
  }

  damage(amount: number, fromX: number, fromZ: number, knockback: number, stagger: number): boolean {
    if (!this.alive || this.invulnerable) return false;
    this.hp -= amount;
    this.flashT = 0.08;
    this.sinceHit = 0;
    if (knockback > 0 && !this.rooted) {
      const dx = this.pos.x - fromX;
      const dz = this.pos.z - fromZ;
      const len = Math.hypot(dx, dz) || 1;
      this.knock.set((dx / len) * knockback, 0, (dz / len) * knockback);
    }
    if (this.hp <= 0) {
      this.hp = 0;
      this.enter('dead');
      return true;
    }
    // Frenzied: can't be staggered once frenzied.
    if (this.state !== 'frozen' && stagger > 0 && !this.frenzied) {
      // Hitting into a telegraph is the counter: it fills the meter faster.
      this.staggerPts += stagger * (this.telegraphHeat() > 0 ? staggerCfg.counterMult : 1);
      this.staggerIdle = 0;
      if (this.staggerPts >= this.poise) {
        this.staggerPts = 0;
        this.flinch();
      }
    }
    return false;
  }

  /** Interrupted by a hit. */
  protected flinch(): void {
    this.enter('hitstun');
  }

  applyStatus(effect: StatusEffect, power: number, duration: number): void {
    if (!this.alive) return;
    if (effect === 'burn' && this.hasAffix('molten')) return; // made of the stuff
    if (effect === 'stun' && this.frenzied) return;
    if (effect === 'burn') {
      this.burnDps = Math.max(this.burnDps, power);
      if (duration >= this.burnT) this.burnTotal = duration;
      this.burnT = Math.max(this.burnT, duration);
    } else if (effect === 'poison') {
      // power: fraction of max HP per second.
      this.poisonDps = Math.max(this.poisonDps, Math.min(POISON_DPS_CAP, this.maxHp * power));
      if (duration >= this.poisonT) this.poisonTotal = duration;
      this.poisonT = Math.max(this.poisonT, duration);
    } else if (effect === 'freeze') {
      this.stunFor = duration;
      this.enter('frozen');
    } else {
      this.stunFor = duration;
      this.flinch();
    }
  }

  statusTimers(): StatusTimer[] {
    const out: StatusTimer[] = [];
    if (!this.alive) return out;
    // A re-flinch while stunned restarts the timer, so the icon refills with it.
    if (this.state === 'frozen') {
      out.push({ kind: 'freeze', left: Math.max(0, this.stunFor - this.stateT), total: this.stunFor });
    } else if (this.state === 'hitstun' && this.stunFor > 0) {
      const total = Math.max(this.arch.hitstun, this.stunFor);
      out.push({ kind: 'stun', left: Math.max(0, total - this.stateT), total });
    }
    if (this.burnT > 0) out.push({ kind: 'burn', left: this.burnT, total: this.burnTotal });
    if (this.poisonT > 0) out.push({ kind: 'poison', left: this.poisonT, total: this.poisonTotal });
    return out;
  }

  /** Remove without a kill (split / merge). */
  vanish(): void {
    this.vanished = true;
    this.hp = 0;
    this.enter('dead');
    this.deadT = 10;
  }

  // ----------------------------------------------------------- update

  update(dt: number, ctx: EnemyContext): void {
    this.ctxRef = ctx;
    this.sinceHit += dt;
    this.healGlowT = Math.max(0, this.healGlowT - dt);
    // Tempo speeds the whole AI up (Overclocked, Frenzied); the Mines machines apply it themselves.
    const tdt = this.selfTempo ? dt : dt * this.tempo;
    this.stateT += tdt;
    this.flashT = Math.max(0, this.flashT - dt);
    if (this.threatLinger > 0) {
      this.threatLinger -= dt;
      if (this.threatLinger <= 0 && !ATTACK_STATES.has(this.state)) this.threat = 0;
    }
    if (!this.rooted) this.pos.addScaledVector(this.knock, dt);
    this.knock.multiplyScalar(Math.exp(-8 * dt));

    if (this.state === 'dead') {
      this.deadT += dt;
      this.animate(dt);
      return;
    }

    this.staggerIdle += dt;
    if (this.staggerIdle > staggerCfg.decayDelay) this.staggerPts = Math.max(0, this.staggerPts - staggerCfg.decayPerSec * dt);
    this.burnT = Math.max(0, this.burnT - dt);
    this.poisonT = Math.max(0, this.poisonT - dt);
    if (this.burnT > 0 || this.poisonT > 0) {
      this.dotT += dt;
      if (this.dotT >= 0.5) {
        this.dotT -= 0.5;
        if (this.burnT > 0) ctx.onDot(this, Math.max(1, Math.round(this.burnDps * 0.5)), 'burn');
        if (this.alive && this.poisonT > 0) ctx.onDot(this, Math.max(1, Math.round(this.poisonDps * 0.5)), 'poison');
      }
    } else {
      this.dotT = 0;
    }
    if (!this.alive) {
      this.animate(dt);
      return;
    }

    const dist = Math.hypot(ctx.playerX - this.pos.x, ctx.playerZ - this.pos.z);
    const toPlayer = yawTo(this.pos.x, this.pos.z, ctx.playerX, ctx.playerZ);
    this.cooldown = Math.max(0, this.cooldown - tdt);
    if (this.affixes.length) this.updateAffixes(dt, ctx, dist);
    if (!this.hangBack(tdt, dist, toPlayer)) this.think(tdt, ctx, dist, toPlayer);
    this.group.rotation.y = this.yaw;
    this.animate(dt);
  }

  /**
   * Shielding: while it has allies to protect and you aren't on top of it, it keeps them between
   * you and itself instead of fighting. True while it does (think() is skipped).
   */
  private hangBack(dt: number, dist: number, toPlayer: number): boolean {
    const spot = this.shieldSpot;
    if (!spot || this.shieldAllies === 0 || this.rooted || this.arch.moveSpeed <= 0) return false;
    if (this.state !== 'chase' && this.state !== 'hover' && this.state !== 'idle') return false;
    if (dist <= this.arch.attackRange + 0.6 || dist > this.arch.aggroRange + 4) return false;
    this.yaw = turnToward(this.yaw, toPlayer, this.arch.turnSpeed * dt);
    const dx = spot.x - this.pos.x;
    const dz = spot.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > 0.6 && dt > 0) {
      // `dt` already carries tempo, except for the machines that apply it themselves.
      const sp = Math.min(d / dt, this.arch.moveSpeed * (this.selfTempo ? this.tempo : 1));
      this.pos.x += (dx / d) * sp * dt;
      this.pos.z += (dz / d) * sp * dt;
    }
    if (this.state === 'idle') this.state = 'hover';
    return true;
  }

  /**
   * The affixes that live on the enemy itself: Regenerating, Stormcaller, Volatile vents, Molten
   * spew and the Frenzied roar. (Molten trails, Shielding, Splitting, the Regenerating pulse and
   * the Volatile death blast live in World.)
   */
  private updateAffixes(dt: number, ctx: EnemyContext, dist: number): void {
    // The player's velocity, smoothed (Stormcaller aims ahead of her).
    if (!Number.isNaN(this.lastPX) && dt > 0) {
      const k = Math.min(1, dt * 6);
      this.pvx += ((ctx.playerX - this.lastPX) / dt - this.pvx) * k;
      this.pvz += ((ctx.playerZ - this.lastPZ) / dt - this.pvz) * k;
    }
    this.lastPX = ctx.playerX;
    this.lastPZ = ctx.playerZ;
    const active = this.state !== 'spawning' && this.state !== 'offline' && ctx.playerAlive;
    const engaged = active && dist < this.arch.aggroRange + 4;

    if (this.hasAffix('regenerating')) this.regenerate(dt, ctx);
    if (this.hasAffix('stormcaller') && engaged) {
      this.stormT -= dt;
      if (this.stormT <= 0) {
        this.stormT = affixCfg.stormEvery * (0.85 + ctx.rng() * 0.3);
        this.callStorm(ctx);
      }
    }
    if (this.hasAffix('volatile') && active && dist < affixCfg.ventRange + this.radius) {
      this.ventT -= dt;
      if (this.ventT <= 0) {
        this.ventT = affixCfg.ventEvery;
        this.vent(ctx);
      }
    }
    if (this.hasAffix('molten') && engaged) {
      this.spewT -= dt;
      if (this.spewT <= 0) {
        this.spewT = affixCfg.spewEvery * (0.85 + ctx.rng() * 0.3);
        this.spew(ctx);
      }
    }
    if (this.hasAffix('frenzied') && !this.roared && this.frenzied) {
      this.roared = true;
      this.roar(ctx);
    }
  }

  /** Regenerating: heals once left alone a moment, never while Burn or Poison is on it. */
  private regenerate(dt: number, ctx: EnemyContext): void {
    const suppressed = this.burnT > 0 || this.poisonT > 0;
    const waiting = this.sinceHit < affixCfg.regenDelay || this.state === 'spawning';
    const full = this.hp >= this.maxHp;
    this.regenState = suppressed ? 'off' : waiting || full ? 'idle' : 'active';
    if (this.regenState === 'active') {
      const before = this.hp;
      this.hp = Math.min(this.maxHp, this.hp + this.maxHp * affixCfg.regenPerSec * dt);
      this.regenShown += this.hp - before;
    }
    // Show what it healed about once a second (and whatever is left when it stops).
    this.regenShowT -= dt;
    if (this.regenShown >= 1 && (this.regenShowT <= 0 || this.regenState !== 'active')) {
      ctx.healed(this, Math.round(this.regenShown));
      this.healGlowT = 0.35;
      this.regenShown = 0;
      this.regenShowT = 1;
    }
  }

  /** Regenerating is suppressed (Burn / Poison) or still waiting after a hit: no pulse either. */
  get regenBlocked(): boolean {
    return this.regenState === 'off';
  }

  /** Healed by something else (a Regenerating ally's pulse). Returns HP actually restored. */
  receiveHeal(amount: number): number {
    if (!this.alive) return 0;
    const before = this.hp;
    this.hp = Math.min(this.maxHp, this.hp + amount);
    if (this.hp > before) this.healGlowT = 0.5;
    return this.hp - before;
  }

  /** Volatile: a blast around itself (a short warning first) while you stand close. */
  private vent(ctx: EnemyContext): void {
    const shape: TelegraphShape = { kind: 'circle', x: this.pos.x, z: this.pos.z, radius: affixCfg.ventRadius };
    this.cue('volatile.warn');
    ctx.telegraph(shape, affixCfg.ventWindup, () => {
      if (!this.alive) return;
      ctx.boom(shape.x, shape.z, shape.radius, AFFIXES.volatile.color);
      ctx.areaStrike(this, shape, affixCfg.ventAtpMult, 6, 'burn', 1);
    }, 0xff6a20);
  }

  /** Molten: lobs globs (one near you, the rest around itself) that land as burning patches. */
  private spew(ctx: EnemyContext): void {
    const from = new THREE.Vector3(this.pos.x, 1.6 * this.arch.scale, this.pos.z);
    for (let i = 0; i < affixCfg.spewGlobs; i++) {
      let x: number;
      let z: number;
      const a = ctx.rng() * Math.PI * 2;
      if (i === 0) {
        const d = ctx.rng() * 2;
        x = ctx.playerX + Math.sin(a) * d;
        z = ctx.playerZ + Math.cos(a) * d;
      } else {
        const d = 3 + ctx.rng() * 3.5;
        x = this.pos.x + Math.sin(a) * d;
        z = this.pos.z + Math.cos(a) * d;
      }
      const shape: TelegraphShape = { kind: 'circle', x, z, radius: affixCfg.spewRadius };
      ctx.telegraph(shape, affixCfg.spewWindup, () => {
        // areaStrike leaves the burning patch (any Molten area attack does).
        ctx.areaStrike(this, shape, affixCfg.spewAtpMult, 2, 'burn', 1);
      }, AFFIXES.molten.color);
      ctx.lob(from, x, z, affixCfg.spewWindup, AFFIXES.molten.color);
    }
  }

  /** Frenzied: crossing the threshold, it roars and throws you back. */
  private roar(ctx: EnemyContext): void {
    const shape: TelegraphShape = { kind: 'circle', x: this.pos.x, z: this.pos.z, radius: affixCfg.roarRadius };
    ctx.boom(shape.x, shape.z, shape.radius, AFFIXES.frenzied.color);
    ctx.areaStrike(this, shape, affixCfg.roarAtpMult, affixCfg.roarKnockback);
    this.cue('booma.growl');
    // The roar shrugs off a flinch it was in.
    if (this.state === 'hitstun') {
      this.stunFor = 0;
      this.stateT = this.arch.hitstun;
    }
  }

  /** Lightning circles around the player: one on her, one where she is heading, the rest close by. */
  private callStorm(ctx: EnemyContext): void {
    const r = affixCfg.stormRadius;
    const lead = Math.min(5, Math.hypot(this.pvx, this.pvz) * affixCfg.stormWindup);
    const heading = Math.atan2(this.pvx, this.pvz);
    for (let i = 0; i < affixCfg.stormBolts; i++) {
      let x: number;
      let z: number;
      if (i === 1 && lead > 0.8) {
        x = ctx.playerX + Math.sin(heading) * lead;
        z = ctx.playerZ + Math.cos(heading) * lead;
      } else {
        const a = ctx.rng() * Math.PI * 2;
        const d = i === 0 ? 0 : 2.4 + ctx.rng() * 2.4;
        x = ctx.playerX + Math.sin(a) * d;
        z = ctx.playerZ + Math.cos(a) * d;
      }
      const shape: TelegraphShape = { kind: 'circle', x, z, radius: r };
      ctx.telegraph(shape, affixCfg.stormWindup, () => {
        if (!this.alive) return;
        ctx.bolt(x, z, 0xc0a0ff);
        ctx.areaStrike(this, shape, affixCfg.stormAtpMult, 2, 'paralysis', affixCfg.stormParalysis);
      }, 0xb090ff);
    }
  }

  /**
   * Overclocked: start one more attack right away, in place of the recovery. The attack token is
   * still held. Subclasses that can do it return true; the default can't.
   */
  protected followUp(_ctx: EnemyContext): boolean {
    return false;
  }

  protected abstract think(dt: number, ctx: EnemyContext, dist: number, toPlayer: number): void;
  protected abstract targetPose(dt: number): { pose: Pose; rate: number };

  /** 0..1 attack telegraph progress: the body heats up toward orange-red. By default, the windup's progress. */
  protected telegraphHeat(): number {
    return this.windupK();
  }

  /**
   * Enter an attack's windup state, `secs` base seconds long (before tempo). The windup's progress
   * (windupK) heats the body, and windupDone() says when it is over.
   */
  protected beginWindup(state: EnemyState, secs: number): void {
    this.enter(state);
    this.windupState = state;
    this.windupBase = secs;
  }

  /** The running windup's length in state time (what stateT counts). */
  protected get windupSecs(): number {
    // stateT already runs on tempo, except for the machines that apply it themselves.
    return this.selfTempo ? this.windupBase / this.tempo : this.windupBase;
  }

  /** 0..1 through the windup begun with beginWindup (0 once it has left that state). */
  protected windupK(): number {
    return this.state === this.windupState ? Math.min(1, this.stateT / this.windupSecs) : 0;
  }

  protected windupDone(): boolean {
    return this.stateT >= this.windupSecs;
  }

  /**
   * Show a telegraph `secs` base seconds long (it runs in world time, so tempo shortens it like the
   * enemy's own timers). A flinch or its death calls it off.
   */
  protected warn(ctx: EnemyContext, shape: TelegraphShape, secs: number, onFire: () => void, color?: number): TelegraphHandle {
    return this.tele.add(ctx.telegraph(shape, secs / this.tempo, onFire, color));
  }

  /** Re-roll the melee attack cooldown: attackCooldown x (lo .. lo + span). */
  protected rollCooldown(ctx: EnemyContext, lo = 0.7, span = 0.6): void {
    this.cooldown = this.arch.attackCooldown * (lo + ctx.rng() * span);
  }

  /** A fresh shot cooldown: its shotCooldown (or `fallback`) x 0.85 .. 1.15. */
  protected rollShotCd(ctx: EnemyContext, fallback: number): number {
    return (this.arch.shotCooldown ?? fallback) * (0.85 + ctx.rng() * 0.3);
  }

  /**
   * Circle the player: move `radial` toward her (negative: away) and `lateral` to the side it strafes
   * to, at `speed`; every so often (`flipRate` per second) it switches sides.
   */
  protected strafe(ctx: EnemyContext, dt: number, toPlayer: number, radial: number, lateral: number, speed: number, flipRate: number): void {
    const side = toPlayer + (Math.PI / 2) * this.strafeDir;
    this.pos.x += (Math.sin(toPlayer) * radial + Math.sin(side) * lateral) * speed * dt;
    this.pos.z += (Math.cos(toPlayer) * radial + Math.cos(side) * lateral) * speed * dt;
    if (ctx.rng() < dt * flipRate) this.strafeDir *= -1;
  }

  /** Does the attack being telegraphed corrupt? Its body heats up violet instead of orange. */
  protected corruptingAttack(): boolean {
    return this.arch.strikeStatus === 'corrupt';
  }

  protected cue(id: string): void {
    if (this.cues.length < 8) this.cues.push(id);
  }

  protected enter(s: EnemyState): void {
    // Interrupted or dead: its pending attacks are called off.
    if (s === 'hitstun' || s === 'dead') this.tele.cancelAll();
    // Overclocked: an attack ending goes straight into one more (only one: the extra doesn't chain).
    if (s === 'recover' && !this.followingUp && this.alive && this.threat > 0 && this.ctxRef && this.hasAffix('overclocked')) {
      this.followingUp = true;
      if (this.followUp(this.ctxRef)) return;
    }
    if (s !== 'recover' && !ATTACK_STATES.has(s)) this.followingUp = false;
    if (!ATTACK_STATES.has(s) && this.threatLinger <= 0) this.threat = 0;
    // Molten: a melee swing leaves the ground burning where it lands.
    if (s === 'strike' && this.meleeStrikes && this.hasAffix('molten') && this.ctxRef) {
      const reach = this.radius + 0.9;
      this.ctxRef.firePatch(this.pos.x + Math.sin(this.yaw) * reach, this.pos.z + Math.cos(this.yaw) * reach, affixCfg.moltenStrikeRadius, affixCfg.moltenLife);
    }
    this.state = s;
    this.stateT = 0;
    this.windupState = null;
  }

  /** Keep the threat share for `seconds` more, whatever the state (a glob or missile still in flight). */
  protected holdThreat(seconds: number): void {
    if (this.threat > 0) this.threatLinger = Math.max(this.threatLinger, seconds);
  }

  /** Shared states every enemy handles the same way. Returns true if handled. */
  protected commonState(next: EnemyState): boolean {
    switch (this.state) {
      case 'spawning':
        if (this.stateT >= SPAWN_TIME) this.enter(next);
        return true;
      case 'hitstun':
        if (this.stateT >= Math.max(this.arch.hitstun, this.stunFor)) {
          this.stunFor = 0;
          this.cooldown = Math.max(this.cooldown, 0.25);
          this.enter(next);
        }
        return true;
      case 'frozen':
        if (this.stateT >= this.stunFor) {
          this.stunFor = 0;
          this.enter(next);
        }
        return true;
    }
    return false;
  }

  /** Walk toward the merge partner; true while merging. */
  protected walkToPartner(dt: number): boolean {
    const m = this.mergeTarget;
    if (!m || !m.alive) return false;
    const to = yawTo(this.pos.x, this.pos.z, m.pos.x, m.pos.z);
    this.yaw = turnToward(this.yaw, to, this.arch.turnSpeed * dt);
    if (Math.hypot(m.pos.x - this.pos.x, m.pos.z - this.pos.z) > 1.2) {
      const sp = Math.max(1.6, this.arch.moveSpeed);
      this.pos.x += Math.sin(to) * sp * dt;
      this.pos.z += Math.cos(to) * sp * dt;
    }
    return true;
  }

  /** Keep the death topple (brawlers) or let a subclass handle the dead pose. */
  protected topplesOnDeath = true;

  protected animate(dt = 1 / 60): void {
    this.time += dt;
    const { pose, rate } = this.targetPose(dt);
    if (rate > 0) this.rig.apply(pose, dt, rate);
    const root = this.rig.root;
    root.position.y = 0;
    root.rotation.x = 0;

    let emissive = 0x000000;
    const heat = this.telegraphHeat();
    const corrupting = heat > 0 && this.corruptingAttack();
    if (heat > 0.75) emissive = corrupting ? 0x3a0858 : 0x501400;
    switch (this.state) {
      case 'spawning':
        root.position.y = -1.8 * this.arch.scale * (1 - Math.min(1, this.stateT / SPAWN_TIME));
        emissive = 0x2040a0;
        break;
      case 'dead':
        if (this.topplesOnDeath) root.rotation.x = -Math.min(1.4, this.deadT * 3);
        root.position.y = -Math.min(1.6, Math.max(0, this.deadT - 0.4) * 1.4);
        break;
    }

    const molten = this.hasAffix('molten');
    this.rig.tintable.forEach((m, i) => {
      const c = TMP_COLOR.copy(this.tintBase[i]);
      if (molten) c.lerp(MOLTEN_COLOR, 0.55);
      if (heat > 0) c.lerp(corrupting ? CORRUPT_TINT : WINDUP_COLOR, heat * 0.75);
      if (this.burnT > 0) c.lerp(BURN_COLOR, 0.35);
      if (this.poisonT > 0) c.lerp(POISON_COLOR, 0.35);
      if (this.state === 'frozen') c.lerp(FREEZE_COLOR, 0.8);
      m.color.copy(c);
    });
    if (this.state === 'frozen') emissive = 0x204060;
    if (this.elite && emissive === 0 && this.alive) {
      if (this.frenzied) emissive = Math.sin(this.time * 12) > 0 ? 0x500810 : 0x200408;
      // Molten: the charred body glows through its cracks, flickering like embers.
      else if (molten) emissive = Math.sin(this.time * 7) + Math.sin(this.time * 11.3) > 0.4 ? 0x5a1800 : 0x2a0a00;
      else if (this.champion) emissive = Math.sin(this.time * 3) > 0.2 ? 0x3a2a04 : 0x1a1202;
      else emissive = Math.sin(this.time * 3) > 0.2 ? 0x2a0a40 : 0x14061e;
    }
    if (this.healGlowT > 0 && this.alive) emissive = 0x0c5a1c;
    if (this.flashT > 0) emissive = 0xffffff;
    this.rig.setEmissive(emissive, this.flashT > 0 ? 0.8 : 1);
    if (this.aura) {
      this.aura.visible = this.alive;
      this.aura.material.opacity = 0.4 + Math.sin(this.time * 3) * 0.15;
    }
    if (this.hasAffix('frenzied')) {
      // Swells once frenzied.
      const target = this.arch.scale * (this.frenzied && this.alive ? affixCfg.frenzyScale : 1);
      const cur = root.scale.x;
      root.scale.setScalar(cur + (target - cur) * Math.min(1, dt * 8));
    }
    if (this.fx) {
      const moved = Math.hypot(this.pos.x - this.fxX, this.pos.z - this.fxZ);
      this.fxX = this.pos.x;
      this.fxZ = this.pos.z;
      if (dt > 0) this.speed += (moved / dt - this.speed) * Math.min(1, dt * 8);
      const at = affixCfg.frenzyAt;
      const hpK = this.hp / this.maxHp;
      this.fx.update(dt, {
        alive: this.alive,
        speed: this.speed,
        hpK,
        frenzied: this.frenzied,
        frenzyNear: Math.max(0, Math.min(1, 1 - (hpK - at) / 0.35)),
        regen: this.regenState,
        shieldAlone: this.hasAffix('shielding') && this.shieldAllies === 0,
      });
    }
  }
}

// ------------------------------------------------------------- brawlers

/** The pose set a melee brawler body needs (the Booma rig's joints). */
export interface BrawlerPoses {
  idle(t: number): Pose;
  walk(phase: number, intensity?: number): Pose;
  windup(k: number): Pose;
  strike(): Pose;
  hurt(): Pose;
  crouch(): Pose;
}

/**
 * Melee brute (the Booma family, Hidoom, Pan Arms): closes in, takes an attack
 * token, winds up (slowly re-aiming), strikes, recovers. Without a token it
 * hovers in a ring around the player and strafes.
 */
export class Brawler extends Enemy {
  private walkPhase = 0;
  private lastX: number;
  private lastZ: number;
  private strikeConnected = false;

  constructor(
    type: EnemyId,
    arch: EnemyArchetype,
    x: number,
    z: number,
    rng: () => number,
    rig: Rig,
    opts: EnemyOptions = {},
    protected readonly poses: BrawlerPoses = boomaPoses,
  ) {
    super(type, arch, x, z, rng, rig, opts);
    this.strafeDir = rng() < 0.5 ? -1 : 1;
    this.lastX = x;
    this.lastZ = z;
  }

  protected meleeStrikes = true;

  private windupTime(): number {
    const a = this.arch;
    return (this.strikesLeft < a.strikes ? a.windup * 0.45 : a.windup) * this.windupScale;
  }

  /** Overclocked: one more swing (or swing chain) with a shorter windup. */
  protected followUp(): boolean {
    this.strikesLeft = this.arch.strikes;
    this.enter('windup');
    return true;
  }

  protected telegraphHeat(): number {
    if (this.state === 'windup') return Math.min(1, this.stateT / this.windupTime());
    return this.state === 'strike' ? 1 : 0;
  }

  protected think(dt: number, ctx: EnemyContext, dist: number, toPlayer: number): void {
    const a = this.arch;
    if (this.state === 'spawning') this.yaw = toPlayer;
    if (this.commonState('chase')) return;
    switch (this.state) {
      case 'idle':
        if (ctx.playerAlive && dist < a.aggroRange) this.enter('chase');
        break;

      case 'chase':
      case 'hover': {
        if (this.walkToPartner(dt)) break;
        if (!ctx.playerAlive) {
          this.enter('idle');
          break;
        }
        this.yaw = turnToward(this.yaw, toPlayer, a.turnSpeed * dt);
        const facing = Math.abs(angleDelta(this.yaw, toPlayer)) < 0.5;
        if (dist <= a.attackRange && facing && this.cooldown <= 0) {
          if (ctx.requestAttackToken(this)) {
            this.strikesLeft = a.strikes;
            this.enter('windup');
            break;
          }
          // Someone else is swinging; back off and wait a beat.
          this.cooldown = 0.4 + ctx.rng() * 0.6;
        }
        // Without a token, hang back at a ring around the player and strafe.
        const hoverDist = a.attackRange + 1.4;
        if (this.state === 'hover' || (dist <= hoverDist && this.cooldown > 0)) {
          this.state = 'hover';
          const radial = dist > hoverDist + 0.5 ? 1 : dist < hoverDist - 0.5 ? -0.6 : 0;
          this.strafe(ctx, dt, toPlayer, radial, 0.6, a.moveSpeed * 0.45, 0.4);
          if (this.cooldown <= 0) this.state = 'chase';
        } else if (dist > a.attackRange * 0.85) {
          this.pos.x += Math.sin(this.yaw) * a.moveSpeed * dt;
          this.pos.z += Math.cos(this.yaw) * a.moveSpeed * dt;
        }
        break;
      }

      case 'windup': {
        // Tracks the player slowly while winding up: dodge by moving, not rolling.
        this.yaw = turnToward(this.yaw, toPlayer, a.turnSpeed * 0.35 * dt);
        if (this.stateT >= this.windupTime()) {
          this.strikeConnected = false;
          this.enter('strike');
        }
        break;
      }

      case 'strike': {
        const step = (a.lunge / a.strikeActive) * dt;
        this.pos.x += Math.sin(this.yaw) * step;
        this.pos.z += Math.cos(this.yaw) * step;
        if (!this.strikeConnected && ctx.tryStrike(this)) this.strikeConnected = true;
        if (this.stateT >= a.strikeActive) {
          this.strikesLeft--;
          if (this.strikesLeft > 0) {
            this.state = 'windup'; // follow-up keeps the token
            this.stateT = 0;
          } else {
            this.enter('recover');
          }
        }
        break;
      }

      case 'recover':
        if (this.stateT >= a.recovery) {
          this.rollCooldown(ctx, 0.6, 0.8);
          this.enter('chase');
        }
        break;
    }
  }

  protected targetPose(dt: number): { pose: Pose; rate: number } {
    const a = this.arch;
    const P = this.poses;
    const moved = Math.hypot(this.pos.x - this.lastX, this.pos.z - this.lastZ);
    this.lastX = this.pos.x;
    this.lastZ = this.pos.z;
    const speed = dt > 0 ? moved / dt : 0;
    this.walkPhase += (moved / (1.6 * a.scale)) * Math.PI * 2;
    switch (this.state) {
      case 'spawning':
        return { pose: P.crouch(), rate: 6 };
      case 'windup':
        return { pose: P.windup(Math.min(1, this.stateT / this.windupTime())), rate: 20 };
      case 'strike':
        return { pose: P.strike(), rate: 35 };
      case 'recover':
        return { pose: this.stateT < a.recovery * 0.5 ? P.strike() : P.idle(this.time), rate: 5 };
      case 'hitstun':
      case 'dead':
        return { pose: P.hurt(), rate: 22 };
      case 'frozen':
        return { pose: P.hurt(), rate: 0 };
      default:
        if (speed > 0.3) return { pose: P.walk(this.walkPhase, Math.min(1, speed / 2.5)), rate: 10 };
        return { pose: P.idle(this.time), rate: 6 };
    }
  }
}
