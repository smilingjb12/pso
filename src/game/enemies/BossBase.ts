import * as THREE from 'three';
import { sfx, type SfxId } from '../../audio';
import type { HardBossScale, Race } from '../config';
import { BOSSES, type BossId } from '../data/bosses';
import type { Hittable, StatusEffect, StatusTimer } from '../combat/types';
import type { Level } from '../world/Level';
import { TelegraphGroup, type TelegraphShape } from '../world/Telegraph';
import type { Boss, BossContext } from './Boss';

// Shared plumbing for the area bosses: HP (with Nightmare scaling), the hit flash, death, the intro
// and enrage banners, damage over time, the telegraphs they have running and the no-repeat attack
// pick. Each boss keeps its own state machine and attacks; see Dragon / DeRolLe / Warden / DarkFalz.

/** The stats every boss's tuning block has (config/bosses.ts). */
export interface BossStats {
  hp: number;
  atp: number;
  ata: number;
  dfp: number;
  evp: number;
  /** Injector doses its whole HP bar is worth. */
  charge: number;
  /** HP share at or below which it is enraged. */
  enrageAt: number;
  /** Windup multiplier while enraged. */
  enrageSpeed: number;
}

/** States every boss has: asleep until the player arrives, its intro, and dead. */
export type BossBaseState = 'dormant' | 'intro' | 'dead';

/** Boss DoT damage is capped so poison can't melt a big HP pool (Burn is capped at 1.5x this). */
export const BOSS_DOT_CAP = 8;
const DOT_TICK = 0.5;
const FLASH_TIME = 0.08;

/**
 * Burn and Poison on a boss. Both feed one damage slot (the stronger dps, the longer time), ticking
 * every half second; the HUD still gets an icon per kind.
 */
export class BossDot {
  private left = 0;
  private tickT = 0;
  private dps = 0;
  private readonly shown: Record<'burn' | 'poison', { left: number; total: number }> = {
    burn: { left: 0, total: 0 },
    poison: { left: 0, total: 0 },
  };

  constructor(
    private readonly maxHp: number,
    /** Burn dps cap (the Dragon takes Burn uncapped). */
    private readonly burnCap = BOSS_DOT_CAP * 1.5,
  ) {}

  /** Bosses shrug off freeze and stun; Burn and (capped) Poison tick. Poison's power is a share of max HP per second. */
  apply(effect: StatusEffect, power: number, duration: number): void {
    if (effect !== 'burn' && effect !== 'poison') return;
    const dps = effect === 'poison' ? Math.min(BOSS_DOT_CAP, this.maxHp * power) : Math.min(this.burnCap, power);
    this.dps = Math.max(this.dps, dps);
    this.left = Math.max(this.left, duration);
    const s = this.shown[effect];
    if (duration >= s.left) s.total = duration;
    s.left = Math.max(s.left, duration);
  }

  /** Run the clock; `land` gets each tick's damage. */
  tick(dt: number, land: (damage: number) => void): void {
    this.shown.burn.left = Math.max(0, this.shown.burn.left - dt);
    this.shown.poison.left = Math.max(0, this.shown.poison.left - dt);
    if (this.left <= 0) return;
    this.left -= dt;
    this.tickT += dt;
    if (this.tickT >= DOT_TICK) {
      this.tickT -= DOT_TICK;
      land(Math.max(1, Math.round(this.dps * DOT_TICK)));
    }
  }

  /** Target frame icons. */
  timers(): StatusTimer[] {
    const out: StatusTimer[] = [];
    for (const kind of ['burn', 'poison'] as const) {
      const s = this.shown[kind];
      if (s.left > 0) out.push({ kind, left: s.left, total: s.total });
    }
    return out;
  }
}

/** What a BossPart asks of the boss it belongs to. */
export interface PartHost {
  readonly name: string;
  readonly race: Race;
  readonly hp: number;
  readonly maxHp: number;
  readonly evp: number;
  readonly dfp: number;
  readonly alive: boolean;
  partInvulnerable(p: BossPart): boolean;
  damagePart(p: BossPart, amount: number): boolean;
  partMult(p: BossPart): number;
  applyStatus(effect: StatusEffect, power: number, duration: number): void;
  statusTimers(): StatusTimer[];
}

/** One hittable piece of a boss (a core, a body, a segment). HP, damage and statuses all go to the boss. */
export class BossPart implements Hittable {
  readonly pos = new THREE.Vector3();

  constructor(
    private readonly boss: PartHost,
    /** Its radius, or a function of the boss's current form. */
    private readonly size: number | (() => number),
    /** Height damage numbers and the reticle attach to. */
    private readonly aim: (p: BossPart) => number,
    /** The boss's own numbering for its parts (De Rol Le: -1 the head, 0.. the segments). */
    readonly index = 0,
  ) {}

  get name(): string {
    return this.boss.name;
  }
  get race(): Race {
    return this.boss.race;
  }
  get radius(): number {
    return typeof this.size === 'number' ? this.size : this.size();
  }
  get hp(): number {
    return this.boss.hp;
  }
  set hp(_v: number) {
    // Only damage() changes the boss HP.
  }
  get maxHp(): number {
    return this.boss.maxHp;
  }
  get evp(): number {
    return this.boss.evp;
  }
  get dfp(): number {
    return this.boss.dfp;
  }
  get aimHeight(): number {
    return this.aim(this);
  }
  get alive(): boolean {
    return this.boss.alive;
  }
  get invulnerable(): boolean {
    return this.boss.partInvulnerable(this);
  }
  damage(amount: number): boolean {
    return this.boss.damagePart(this, amount);
  }
  applyStatus(effect: StatusEffect, power: number, duration: number): void {
    this.boss.applyStatus(effect, power, duration);
  }
  statusTimers(): StatusTimer[] {
    return this.boss.statusTimers();
  }
  damageMult(): number {
    return this.boss.partMult(this);
  }
}

/**
 * The common part of every area boss. `S`: its states (besides dormant / intro / dead), `A`: its
 * attacks (for the no-repeat pick). A subclass implements `think` (its state machine, run each tick
 * while it lives), `whileDead`, `collide`, `parts`, `objects`, `weakPointOpen` and `anchor`.
 */
export abstract class BossBase<S extends string, A extends string = never> implements Boss, PartHost {
  abstract readonly id: BossId;
  abstract readonly objects: THREE.Object3D[];
  abstract readonly weakPointOpen: boolean;
  readonly maxHp: number;
  readonly injectorCharge: number;
  hp: number;
  state: S | BossBaseState = 'dormant';
  stateT = 0;
  /** Seconds since death. */
  deadT = 0;
  onDot: ((target: Hittable, damage: number) => void) | null = null;

  protected time = 0;
  protected flashT = 0;
  /** Seconds to wait before the next attack (set as each one ends). */
  protected gap = 0;
  protected lastAttack: A | null = null;
  protected readonly dot: BossDot;
  /** Telegraphs it can call off (on death, a form change...). */
  protected readonly tele = new TelegraphGroup();
  private announcedEnrage = false;

  constructor(
    protected readonly stats: BossStats,
    /** Nightmare scaling (null on Normal). */
    readonly hard: HardBossScale | null,
    burnCap?: number,
  ) {
    this.maxHp = Math.round(stats.hp * (hard?.hp ?? 1));
    this.hp = this.maxHp;
    this.injectorCharge = stats.charge;
    this.dot = new BossDot(this.maxHp, burnCap);
  }

  // ---------------------------------------------------------------- Boss

  get name(): string {
    return BOSSES[this.id].name;
  }
  get race(): Race {
    return BOSSES[this.id].race;
  }
  get atp(): number {
    return this.stats.atp + (this.hard?.atp ?? 0);
  }
  get ata(): number {
    return this.stats.ata + (this.hard?.ata ?? 0);
  }
  get dfp(): number {
    return this.stats.dfp + (this.hard?.dfp ?? 0);
  }
  get evp(): number {
    return this.stats.evp + (this.hard?.evp ?? 0);
  }
  get alive(): boolean {
    return this.state !== 'dead';
  }
  get engaged(): boolean {
    return this.state !== 'dormant';
  }
  get enraged(): boolean {
    return this.hp / this.maxHp <= this.stats.enrageAt;
  }
  /** Nothing can be hurt (asleep, waking, dead). */
  get untouchable(): boolean {
    return this.state === 'dormant' || this.state === 'intro' || this.state === 'dead';
  }

  abstract parts(): Hittable[];
  abstract collide(playerPos: THREE.Vector3, playerRadius: number, level: Level): void;

  owns(h: Hittable): boolean {
    return this.parts().includes(h);
  }

  // ------------------------------------------------------------- damage

  partInvulnerable(_p: BossPart): boolean {
    return this.untouchable;
  }

  /** Damage multiplier on a hit to this part (weak point windows, armour). */
  partMult(_p: BossPart): number {
    return 1;
  }

  damagePart(p: BossPart, amount: number): boolean {
    if (!this.alive || this.partInvulnerable(p)) return false;
    return this.loseHp(amount);
  }

  applyStatus(effect: StatusEffect, power: number, duration: number): void {
    this.dot.apply(effect, power, duration);
  }

  statusTimers(): StatusTimer[] {
    return this.alive ? this.dot.timers() : [];
  }

  /** Take a blow's damage (the caller checked it can be hurt), never dropping below `floor`. True if it died. */
  protected loseHp(amount: number, floor = -Infinity): boolean {
    this.flashT = FLASH_TIME;
    this.hp = Math.max(floor, this.hp - amount);
    if (this.hp > 0) return false;
    this.hp = 0;
    this.die();
    return true;
  }

  private die(): void {
    this.tele.cancelAll();
    this.enter('dead');
    this.sound('boss.die');
    this.onDeath();
  }

  /** Tidy up its effects when it dies (beams, zones, adds). */
  protected onDeath(): void {}

  /** The part damage-over-time lands on this tick (none: the tick is lost). */
  protected dotTarget(): Hittable | null {
    return this.parts().find((p) => !p.invulnerable) ?? null;
  }

  // ------------------------------------------------------------- update

  update(dt: number, ctx: BossContext): void {
    this.time += dt;
    this.stateT += dt;
    this.flashT = Math.max(0, this.flashT - dt);
    this.always(dt, ctx);
    if (this.state === 'dead') {
      this.deadT += dt;
      this.whileDead(dt);
      return;
    }
    this.dot.tick(dt, (d) => {
      const target = this.dotTarget();
      if (target) this.onDot?.(target, d);
    });
    if (!this.alive) return;
    this.think(dt, ctx);
  }

  /** Runs every tick, dead or alive, before anything else (effects that finish playing out). */
  protected always(_dt: number, _ctx: BossContext): void {}
  /** Its death throes, each tick after it died. */
  protected abstract whileDead(dt: number): void;
  /** Its state machine, each tick while it lives. */
  protected abstract think(dt: number, ctx: BossContext): void;

  protected enter(s: S | BossBaseState): void {
    this.state = s;
    this.stateT = 0;
  }

  /** Where its sounds come from by default. */
  protected abstract get anchor(): { x: number; z: number };

  protected sound(id: SfxId, x = this.anchor.x, z = this.anchor.z, arg?: number): void {
    sfx(id, { x, z, arg });
  }

  /** Windup multiplier: shorter when enraged. */
  protected sm(): number {
    return this.enraged ? this.stats.enrageSpeed : 1;
  }

  /** Flat (non-ATP) damage, scaled on Nightmare: breath and beam ticks, the laser wall, burning zones. */
  protected flat(damage: number): number {
    return Math.round(damage * (this.hard?.flat ?? 1));
  }

  /** The player arrived: into the intro, with its name across the screen. */
  protected awaken(ctx: BossContext, banner: string, shake: number, sound: SfxId): void {
    this.enter('intro');
    ctx.announce(banner);
    ctx.shake(shake);
    this.sound(sound);
  }

  /** A new phase (or enraged): the banner, and the boss track's battle layer comes in. */
  protected escalate(ctx: BossContext, banner: string): void {
    ctx.announce(banner);
    ctx.escalate();
  }

  /** Announce the enrage, once, as soon as it is enraged and `ready` (some only enrage in their last phase). */
  protected announceEnrage(ctx: BossContext, ready: boolean, banner: string, sound: SfxId): void {
    if (!this.enraged || !ready || this.announcedEnrage) return;
    this.announcedEnrage = true;
    this.escalate(ctx, banner);
    this.sound(sound);
  }

  /** Show a telegraph it can call off later (see `tele`). */
  protected warn(ctx: BossContext, shape: TelegraphShape, dur: number, color: number | undefined, onFire: () => void = () => {}, dash = false): void {
    this.tele.add(ctx.telegraph(shape, dur, onFire, color, dash));
  }

  /** A random attack from `pool` (repeats weight it), never the last one again; `allow` filters further. */
  protected pickAttack(ctx: BossContext, pool: A[], allow: (a: A) => boolean = () => true): A {
    const options = pool.filter((a) => a !== this.lastAttack && allow(a));
    const pick = options[Math.floor(ctx.rng() * options.length)];
    this.lastAttack = pick;
    return pick;
  }
}
