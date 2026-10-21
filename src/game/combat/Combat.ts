import * as THREE from 'three';
import { sfx } from '../../audio';
import type { CcKind } from '../ccResist';
import { ART_SLOTS, type Character } from '../character';
import { angleDelta, yawTo } from '../collision';
import {
  basicAttack, comboDamage, debug, feel, formulas, injectorCfg, lockOn, magCfg, passiveCfg as T, player as playerCfg, rangedFalloff,
  stagger, statuses, techScaling, uniqueCfg as U, weaponWeights,
} from '../config';
import { ARTS, isTechArt, type ArtId } from '../data/arts';
import { specials } from '../data/items';
import { aimsWithCamera, isAttackTech, techniques, type TechId } from '../data/techniques';
import type { Boss } from '../enemies/Boss';
import type { Enemy, PlayerStatusKind } from '../enemies/Enemy';
import { fightLog } from '../fightLog';
import { cutMult, enemyDamage, playerDamageRaw, randRange } from '../formulas';
import type { Player } from '../Player';
import type { TelegraphShape } from '../world/Telegraph';
import { inShape } from '../world/Telegraph';
import { Lob, Pillar, Ring, Tracer, type Effect } from '../world/Effects';
import { Blizzard, Burst, Lightning, MOTES, Puff, SPARKS, Trail } from '../world/spellFx';
import type { World } from '../world/World';
import type { Projectile, ProjectileSpec } from '../world/Projectile';
import { ArtRunner, type ArtCtx } from './arts';
import { UniqueFx } from './riftUniques';
import type { Hittable } from './types';

export interface CombatHooks {
  world(): World;
  player(): Player;
  char(): Character;
  /** The enemy the camera is looking at, within reach of the bar (Game.pickCamTarget), or null. */
  camTarget(): Hittable | null;
  moveDir(): THREE.Vector3;
  /** Where the camera looks on the ground (yaw). */
  cameraYaw(): number;
  float(pos: THREE.Vector3, text: string, cls: string): void;
  log(html: string): void;
  hitstop(sec: number): void;
  shake(mag: number): void;
  onKill(target: Hittable): void;
  /** The player's attack (or DoT) took `dealt` HP off a target (charges injectors and the photon blast). */
  onDamage(target: Hittable, dealt: number): void;
  onPlayerHurt(): void;
  /** Last Stand just saved the player. */
  onLastStand(): void;
  rng(): number;
}

const tmp = new THREE.Vector3();

/** Combat log label for a swing boosted by Retaliate. */
const swingMultLabel = (label: string, mult: number) => (mult > 1 ? `${label} (Retaliate)` : label);

/**
 * Debuffs on an enemy: weakened (Daunt, Suppress, War Cry, Jellen), marked (Mark and friends: it takes more from
 * everything), chilled, sundered (armour off, stacking), venom (Venom Edge's stacking poison), stripped (Zalure),
 * and the Frozen Shooter's freeze immunity.
 */
interface Debuff {
  weak: number;
  weakT: number;
  mark: number;
  markT: number;
  /** Mark's Bounty: the marker gets TP back when it dies. */
  bounty: boolean;
  chillT: number;
  /** Frostbite modifiers: chilled, it deals this much (1 = none). */
  frost: number;
  noFreezeT: number;
  sunder: number;
  sunderPct: number;
  sunderT: number;
  /** Sunder's Rend: at three stacks it takes more from everything. */
  rend: boolean;
  venom: number;
  /** Damage a venom stack deals per second, and seconds left. */
  venomDps: number;
  venomT: number;
  venomAcc: number;
  /** Venom Edge's Weakening (poisoned: deals 15% less) and Contagion (passes on at death). */
  venomWeak: boolean;
  contagion: boolean;
  /** Zalure: armour % stripped, seconds left. */
  strip: number;
  stripT: number;
}

/** A spot on the ground doing something to whatever stands in it (burning ground, ice fields, storms, traps). */
interface Zone {
  shape: TelegraphShape;
  t: number;
  /** Seconds between ticks (0: every frame). */
  every: number;
  acc: number;
  /** Return true to end the zone now (a trap that went off). */
  tick: (inside: Hittable[], dt: number) => boolean | void;
}

/** What a weapon hit is: a basic step's, or an Art's (power on the same scale: a basic hit is 0.7). */
export interface WeaponHit {
  power: number;
  label: string;
  streak: number;
  /** The 3rd step of the chain. */
  finisher: boolean;
  /** The Art dealing it (null: a basic step). */
  art: ArtId | null;
  /** A big blow: heavy stagger and knockback, and it rolls the weapon special. */
  strong?: boolean;
  /** Knockback multiplier. */
  kb?: number;
  /** Stagger multiplier (Infinity: always staggers). */
  stagger?: number;
  /** Share of armour it ignores. */
  pierce?: number;
  /** Damage multiplier on top (modifiers, echoes). */
  mult?: number;
}

/** What a technique hit is. */
export interface TechHit {
  tech: TechId;
  /** Share of the technique's power (chained Zonde, splashes, echoes). */
  share?: number;
  streak: number;
  finisher: boolean;
  label: string;
  /** Stagger multiplier (single-target techniques stagger like a big blow). */
  stagger?: number;
  /** Stun chance multiplier (lightning). */
  stun?: number;
  /** Extra Burn multiplier (fire). */
  burn?: number;
  mult?: number;
  /** Apply the element's status (Burn, Chill, a stun chance); default true. */
  status?: boolean;
  /** One pulse of something lasting (a blizzard): no hitstop or white flash, so a steady rhythm of them doesn't strobe. */
  tick?: boolean;
}

/** Where lightning meets a target: about chest height. */
export function chestOf(t: Hittable): THREE.Vector3 {
  return new THREE.Vector3(t.pos.x, Math.min(1.6, t.aimHeight * 0.6), t.pos.z);
}

/** Frozen right now (a Frozen Shooter shot shatters it). Bosses never are. */
export function frozen(t: Hittable): boolean {
  return !!t.statusTimers?.().some((s) => s.kind === 'freeze' && s.left > 0);
}

/** Stunned or frozen right now (a plain flinch isn't): a stun or freeze never extends one (2026-10-16). */
export function controlled(t: Hittable): boolean {
  return !!t.statusTimers?.().some((s) => (s.kind === 'stun' || s.kind === 'freeze') && s.left > 0);
}

/** Stagger state of anything hittable (enemies flinching or frozen). */
export function staggered(t: Hittable): boolean {
  return !!t.staggered;
}

/** Is this a boss part (they never freeze or stun; they take stagger instead)? */
export function isBossPart(t: Hittable): boolean {
  return !('arch' in t);
}

export class Combat {
  /** The Arts' effects (combat/arts.ts). */
  readonly arts: ArtRunner;
  /** The Rift Circle uniques' effects (combat/riftUniques.ts). */
  readonly ufx: UniqueFx;

  constructor(readonly h: CombatHooks) {
    this.arts = new ArtRunner(this);
    this.ufx = new UniqueFx(this);
  }

  get p(): Player {
    return this.h.player();
  }
  get c(): Character {
    return this.h.char();
  }

  // ------------------------------------------------------------ aiming
  // The camera picks the target (2026-10-16, the user's ask, replacing the Tab lock): whatever enemy it looks at,
  // within reach of the bar, is the target. Casters aim with it alone; melee and guns fall back to soft aim ahead
  // when an attack doesn't reach it.

  /** How far the camera's target can be: the farthest the basic chain or an Art on the bar reaches (melee: at least lockOn.meleeRange). */
  targetRange(): number {
    const c = this.c;
    const family = c.weaponFamily();
    let r = family === 'caster' ? basicAttack.boltRange : family === 'ranged' ? c.weaponKind().range : lockOn.meleeRange;
    for (let s = 0; s < ART_SLOTS; s++) {
      const id = c.artInSlot(s);
      if (id && ARTS[id].role !== 'support') r = Math.max(r, ARTS[id].range);
    }
    return r;
  }

  /** Distance from her to the target's edge. */
  reachTo(t: Hittable): number {
    return Math.hypot(t.pos.x - this.p.pos.x, t.pos.z - this.p.pos.z) - t.radius;
  }

  /** The camera's target if `range` reaches it, else null. */
  camTarget(range: number): Hittable | null {
    const t = this.h.camTarget();
    return t && t.alive && !t.invulnerable && this.reachTo(t) <= range ? t : null;
  }

  /**
   * Pick a target for the step that is starting now: the camera's target when `range` reaches it (default: the
   * basic chain's reach); otherwise melee and guns soft-aim ahead, and casters have none (they shoot where the camera looks).
   */
  aimTarget(range?: number): Hittable | null {
    const kind = this.c.weaponKind();
    const family = this.c.weaponFamily();
    const t = this.camTarget(range ?? (family === 'caster' ? basicAttack.boltRange : family === 'ranged' ? kind.range : lockOn.softAimRange));
    if (t || family === 'caster') return t;
    const ranged = family === 'ranged';
    return this.softTarget(
      ranged ? lockOn.rangedSoftAimDeg : lockOn.softAimDeg,
      range ?? (ranged ? lockOn.rangedSoftAimRange : lockOn.softAimRange),
    );
  }

  /** Which way a caster shoots with no target in reach: toward the camera's target (too far: it falls short), else along the camera. */
  casterYaw(): number {
    const t = this.h.camTarget();
    const p = this.p;
    return t && t.alive ? yawTo(p.pos.x, p.pos.z, t.pos.x, t.pos.z) : this.h.cameraYaw();
  }

  /**
   * An area technique's target along `yaw` (the camera's, when it started): the camera's target in reach, or the
   * nearest enemy close to that line within `range`.
   */
  areaTarget(range: number, yaw: number): Hittable | null {
    return this.camTarget(range) ?? this.softTarget(lockOn.areaAimDeg, range, yaw);
  }

  /**
   * Why a targeted technique can't go now, or null: Zonde and Barta need the camera's target and Foie can't fly
   * past its range to it ("Out of range"; Foie with no target flies along the camera). Nothing is spent.
   */
  artAimBlocked(id: ArtId): string | null {
    if (!isTechArt(id)) return null;
    const shape = techniques[id].shape;
    if (shape !== 'bolt' && shape !== 'chain' && shape !== 'spike') return null;
    const t = this.h.camTarget();
    if (!t || !t.alive || t.invulnerable) return shape === 'bolt' ? null : 'No target';
    return this.reachTo(t) > ARTS[id].range + 2 ? 'Out of range' : null;
  }

  /** The nearest enemy within `maxDeg` of `baseYaw` (default: where she's moving, else facing) and `maxRange`. */
  softTarget(maxDeg: number, maxRange: number, baseYaw?: number): Hittable | null {
    const p = this.p;
    const md = this.h.moveDir();
    baseYaw ??= md.lengthSq() > 0 ? Math.atan2(md.x, md.z) : p.yaw;
    const maxAng = THREE.MathUtils.degToRad(maxDeg);
    let best: Hittable | null = null;
    let bestD = Infinity;
    for (const e of this.h.world().targets()) {
      const d = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z) - e.radius;
      if (d > maxRange) continue;
      const ang = Math.abs(angleDelta(baseYaw, yawTo(p.pos.x, p.pos.z, e.pos.x, e.pos.z)));
      if (ang > maxAng) continue;
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  /** Enemies that can be hit now. */
  targets(): Hittable[] {
    return this.h.world().targets().filter((t) => !t.invulnerable);
  }

  /** Enemies inside a shape. */
  targetsIn(shape: TelegraphShape): Hittable[] {
    return this.targets().filter((h) => inShape(shape, h.pos.x, h.pos.z, h.radius));
  }

  /** The nearest enemies to `from` other than those listed, up to `n`, within `range`. */
  nearestOthers(from: THREE.Vector3, skip: Hittable[], n: number, range: number): Hittable[] {
    return this.targets()
      .filter((h) => !skip.includes(h) && Math.hypot(h.pos.x - from.x, h.pos.z - from.z) <= range)
      .sort((a, b) => a.pos.distanceToSquared(from) - b.pos.distanceToSquared(from))
      .slice(0, n);
  }

  // ------------------------------------------------------------ debuffs

  private debuffs = new Map<Hittable, Debuff>();

  debuff(t: Hittable): Debuff {
    let d = this.debuffs.get(t);
    if (!d) {
      this.debuffs.set(t, (d = {
        weak: 1, weakT: 0, mark: 1, markT: 0, bounty: false, chillT: 0, frost: 1, noFreezeT: 0, sunder: 0, sunderPct: 0, sunderT: 0,
        rend: false, venom: 0, venomDps: 0, venomT: 0, venomAcc: 0, venomWeak: false, contagion: false, strip: 0, stripT: 0,
      }));
    }
    return d;
  }

  /** Daunt / Suppress / War Cry / Jellen: the target deals `mult` for a while (the strongest one wins). */
  weaken(t: Hittable, mult: number, seconds: number): void {
    const d = this.debuff(t);
    if (d.weakT <= 0 || mult <= d.weak) d.weak = mult;
    d.weakT = Math.max(d.weakT, seconds);
  }

  /** Mark and friends: the target takes `mult` from everything for a while (the strongest one wins). */
  mark(t: Hittable, mult: number, seconds: number, bounty = false): void {
    const d = this.debuff(t);
    if (d.markT <= 0 || mult >= d.mark) d.mark = mult;
    d.markT = Math.max(d.markT, seconds);
    d.bounty ||= bounty;
  }

  /** Marked right now. */
  marked(t: Hittable): boolean {
    return (this.debuffs.get(t)?.markT ?? 0) > 0;
  }

  /** What the target takes from everything right now: marked, and Rend at three sunder stacks. */
  private takenMult(t: Hittable): number {
    const d = this.debuffs.get(t);
    if (!d) return 1;
    return (d.markT > 0 ? d.mark : 1) * (d.rend && d.sunder >= 3 && d.sunderT > 0 ? 1.15 : 1);
  }

  /** Armour % against weapon hits now: its own, less Sunder stacks and Zalure. */
  armorOf(t: Hittable): number {
    const d = this.debuffs.get(t);
    if (!d) return t.armor;
    return t.armor - (d.sunderT > 0 ? d.sunder * d.sunderPct : 0) - (d.stripT > 0 ? d.strip : 0);
  }

  /** Sunder: armour off by `pct` a stack, up to `max` stacks, for a while. */
  sunder(t: Hittable, pct: number, seconds: number, max: number, rend: boolean): void {
    const d = this.debuff(t);
    d.sunder = Math.min(max, (d.sunderT > 0 ? d.sunder : 0) + 1);
    d.sunderPct = pct;
    d.sunderT = seconds;
    d.rend ||= rend;
  }

  /** Zalure: armour off for a while. */
  strip(t: Hittable, pct: number, seconds: number): void {
    const d = this.debuff(t);
    d.strip = Math.max(d.stripT > 0 ? d.strip : 0, pct);
    d.stripT = Math.max(d.stripT, seconds);
  }

  /** Venom: another stack (up to `max`) eating `dpsPerStack` a second each, for `seconds`. */
  venom(t: Hittable, dpsPerStack: number, seconds: number, max: number, opts: { weak?: boolean; contagion?: boolean } = {}): void {
    if (!t.alive) return;
    const d = this.debuff(t);
    d.venom = Math.min(max, (d.venomT > 0 ? d.venom : 0) + 1);
    d.venomDps = Math.max(d.venomT > 0 ? d.venomDps : 0, dpsPerStack);
    d.venomT = seconds;
    d.venomWeak ||= !!opts.weak;
    d.contagion ||= !!opts.contagion;
    // The poison icon on the target frame (no damage of its own: the venom ticks here).
    t.applyStatus('poison', 0, seconds);
  }

  /** Venom stacks on a target now. */
  venomStacks(t: Hittable): number {
    const d = this.debuffs.get(t);
    return d && d.venomT > 0 ? d.venom : 0;
  }

  /** Chilled by anything (Barta and the ice Arts) right now, or frozen. */
  chilled(t: Hittable): boolean {
    return (this.debuffs.get(t)?.chillT ?? 0) > 0 || frozen(t);
  }

  // ------------------------------------------------------- crowd control
  // Stun, freeze, slow and knockback all land through here (2026-10-16): each rolls the target's resistance
  // (ccResist.ts; bosses are immune), and a stun or freeze never extends one already running.

  /** Seconds of play so far (RESIST / IMMUNE float throttling). */
  private clock = 0;
  /** When each target (a whole boss, for its parts) last showed RESIST or IMMUNE. */
  private ccFloatAt = new WeakMap<object, number>();

  /**
   * Does `t` shrug off this crowd control? Rolls its resistance; 100 is immunity (bosses, a Frenzied enemy's stuns,
   * rooted ones' shoves). A refusal floats RESIST or IMMUNE over it, at most once a second (IMMUNE every 2 s),
   * unless `quiet` (the knockback on ordinary hits, which would float on nearly every blow).
   */
  resisted(t: Hittable, kind: CcKind, quiet = false): boolean {
    const r = t.ccResist?.(kind) ?? 0;
    if (r <= 0) return false;
    const immune = r >= 100;
    if (!immune && this.h.rng() * 100 >= r) return false;
    if (quiet) return true;
    const boss = this.h.world().boss;
    const key = boss?.owns(t) ? boss : t;
    if (this.clock - (this.ccFloatAt.get(key) ?? -Infinity) >= (immune ? 2 : 1)) {
      this.ccFloatAt.set(key, this.clock);
      this.h.float(tmp.copy(t.pos).setY(t.aimHeight + 1.2), immune ? 'IMMUNE' : 'RESIST', immune ? 'immune' : 'resist');
    }
    return true;
  }

  /** Chill: slower movement and attacks for a while, unless it resists. `frost`: what it deals while chilled (Frostbite). */
  chillTarget(t: Hittable, mult: number, seconds: number, frost = 1): boolean {
    if (this.resisted(t, 'slow')) return false;
    this.applyChill(t, mult, seconds, frost);
    return true;
  }

  private applyChill(t: Hittable, mult: number, seconds: number, frost = 1): void {
    t.chill?.(mult, seconds);
    const d = this.debuff(t);
    d.chillT = Math.max(d.chillT, seconds);
    d.frost = Math.min(d.frost, frost);
  }

  /**
   * A zone's slow (an ice field, sticky napalm), applied every tick: each enemy rolls its resistance once, the first
   * time the zone reaches it, and the answer holds for the zone (rolling every tick would land it within a few).
   */
  zoneChill(mult: number, seconds: number): (t: Hittable) => void {
    const resists = new Map<Hittable, boolean>();
    return (t) => {
      let r = resists.get(t);
      if (r === undefined) resists.set(t, (r = this.resisted(t, 'slow')));
      if (!r) this.applyChill(t, mult, seconds);
    };
  }

  /**
   * Freeze an enemy for a while. `chance`: the effect's own odds, rolled first (so only a hit that would have frozen
   * can show RESIST). Never one already stunned or frozen, nor one a Frozen Shooter shatter just thawed.
   */
  freeze(t: Hittable, seconds: number, chance = 1): boolean {
    if (chance < 1 && this.h.rng() >= chance) return false;
    if (controlled(t) || (this.debuffs.get(t)?.noFreezeT ?? 0) > 0) return false;
    if (this.resisted(t, 'freeze')) return false;
    t.applyStatus('freeze', 0, seconds);
    return true;
  }

  /** Stun an enemy for a while (as freeze: its own odds first, never one already stunned or frozen, resistance). */
  stun(t: Hittable, seconds: number, chance = 1): boolean {
    if (chance < 1 && this.h.rng() >= chance) return false;
    if (controlled(t)) return false;
    if (this.resisted(t, 'stun')) return false;
    t.applyStatus('stun', 0, seconds);
    return true;
  }

  /** Push an enemy away from a point without damage (Breathing Room, Point Blank, Push), unless it resists. */
  shove(t: Hittable, fromX: number, fromZ: number, force: number): void {
    if (!this.resisted(t, 'knockback')) t.shove?.(fromX, fromZ, force);
  }

  /** Pull an enemy toward a point (Vortex). */
  pull(t: Hittable, toX: number, toZ: number, force: number): void {
    this.shove(t, t.pos.x * 2 - toX, t.pos.z * 2 - toZ, force);
  }

  /** What an enemy (or a boss, through any of its parts) deals right now: weakened, and the frost on chilled ones. */
  private outMult(src: Hittable | Boss): number {
    let m = 1;
    let chilled = false;
    let frost = 1;
    const look = (d: Debuff) => {
      if (d.weakT > 0) m = Math.min(m, d.weak);
      if (d.venomT > 0 && d.venomWeak) m *= 0.85;
      if (d.chillT > 0) {
        chilled = true;
        frost = Math.min(frost, d.frost);
      }
    };
    if ('owns' in src) {
      for (const [k, v] of this.debuffs) if (src.owns(k)) look(v);
    } else {
      const d = this.debuffs.get(src);
      if (d) look(d);
      if (src.statusTimers?.().some((s) => s.kind === 'freeze')) chilled = true;
    }
    if (chilled) m *= Math.min(frost, this.c.pMult('frostbite', T.frostbiteMult));
    // Grounding Coil's cost: bosses and champions hit harder.
    return m * this.ufx.coilTakenMult('owns' in src || !!(src as { champion?: boolean }).champion);
  }

  // ------------------------------------------------------------ zones and timers

  private zones: Zone[] = [];
  private timers: { t: number; fn: () => void }[] = [];

  /**
   * Something on the ground for `seconds`: `tick` gets what stands in it every `every` seconds (0: every frame) and
   * may end it early. `color` shows its outline.
   */
  zone(shape: TelegraphShape, seconds: number, every: number, tick: Zone['tick'], color?: number): void {
    this.zones.push({ shape, t: seconds, every, acc: every, tick });
    if (color !== undefined) this.h.world().addTelegraph(shape, seconds, () => {}, color).friendly = true;
  }

  /** Run `fn` in `seconds`. */
  later(seconds: number, fn: () => void): void {
    this.timers.push({ t: seconds, fn });
  }

  /** Reactor Rod: attack casts in the current run, and seconds since the last one. */
  reactorRun = 0;
  reactorIdle = Infinity;

  /** Falz Halo: damage multiplier from the Corruption stacks you carry. */
  private haloMult(): number {
    return this.c.hasUnique('falzHalo') ? 1 + U.falzHaloPerStack * this.p.corruption : 1;
  }

  /** Tick debuffs, venom, zones and timers. Called every frame with the player's status tick. */
  private tickEffects(dt: number): void {
    this.clock += dt;
    for (const [t, d] of this.debuffs) {
      d.weakT -= dt;
      d.markT -= dt;
      d.chillT -= dt;
      d.noFreezeT -= dt;
      d.sunderT -= dt;
      d.stripT -= dt;
      if (d.venomT > 0 && t.alive) {
        d.venomT -= dt;
        d.venomAcc += dt;
        if (d.venomAcc >= 0.5) {
          d.venomAcc -= 0.5;
          const dmg = Math.max(1, Math.round(d.venomDps * d.venom * 0.5));
          this.burnTick(t, dmg, 'poison', true);
        }
      }
      if (d.chillT <= 0) d.frost = 1;
      if (!t.alive || (d.weakT <= 0 && d.markT <= 0 && d.chillT <= 0 && d.noFreezeT <= 0 && d.sunderT <= 0 && d.stripT <= 0 && d.venomT <= 0)) this.debuffs.delete(t);
    }
    this.reactorIdle += dt;
    for (const z of this.zones) {
      z.t -= dt;
      z.acc += dt;
      if (z.acc < z.every) continue;
      z.acc = z.every > 0 ? z.acc - z.every : 0;
      if (z.tick(this.targetsIn(z.shape), dt)) z.t = 0;
    }
    this.zones = this.zones.filter((z) => z.t > 0);
    for (const tm of this.timers) tm.t -= dt;
    const due = this.timers.filter((tm) => tm.t <= 0);
    this.timers = this.timers.filter((tm) => tm.t > 0);
    for (const tm of due) tm.fn();
  }

  // ------------------------------------------------------- player hits

  /** Damage a target on the player's behalf and report the HP it actually lost. */
  deal(target: Hittable, dmg: number, fromX: number, fromZ: number, kb: number, staggerPts: number, credit = true): boolean {
    const before = target.hp;
    const wasStaggered = staggered(target);
    // Knockback resistance shrugs off a hit's push without a float (it would show on nearly every blow).
    if (kb > 0 && this.resisted(target, 'knockback', true)) kb = 0;
    const killed = target.damage(dmg, fromX, fromZ, kb, staggerPts);
    const dealt = before - Math.max(0, target.hp);
    if (credit && dealt > 0) {
      this.h.onDamage(target, dealt);
      this.ufx.onDealt(target, dealt);
    }
    if (!killed && !wasStaggered && staggered(target)) this.onStagger(target);
    if (killed) this.onDeath(target);
    return killed;
  }

  /** A target the player hurt just died: Bounty (marked), Contagion (venom passes on). */
  private onDeath(target: Hittable): void {
    this.ufx.onKill(target);
    const d = this.debuffs.get(target);
    if (!d) return;
    if (d.markT > 0 && d.bounty) this.refundTp(this.p.maxTp * 0.2, 'BOUNTY');
    if (d.venomT > 0 && d.contagion && d.venom > 0) {
      for (const o of this.nearestOthers(target.pos, [target], 4, 4)) {
        for (let i = 0; i < d.venom; i++) this.venom(o, d.venomDps, 6, 8, { weak: d.venomWeak, contagion: true });
      }
    }
  }

  /** The player's hit just staggered an enemy: Daunt weakens it, Shatter spreads the stagger. */
  private onStagger(target: Hittable): void {
    if (this.c.hasPassive('daunt')) this.weaken(target, this.c.pMult('daunt', T.dauntMult), T.dauntTime);
    if (this.c.hasPassive('shatter')) {
      for (const o of this.h.world().targets()) {
        if (o === target || Math.hypot(o.pos.x - target.pos.x, o.pos.z - target.pos.z) > T.shatterRange + o.radius) continue;
        o.damage(0, target.pos.x, target.pos.z, 0, stagger.heavy * this.c.pAmt('shatter', T.shatterShare) * 2);
      }
    }
  }

  /** Give TP back (Arts that refund on a condition), with a float. */
  refundTp(amount: number, label?: string): void {
    const p = this.p;
    const gain = Math.min(p.maxTp - p.tp, Math.round(amount));
    if (gain <= 0) return;
    p.tp += gain;
    if (label) this.h.float(tmp.copy(p.pos).setY(2.5), `${label} +${gain} TP`, 'heal');
  }

  /** Damage multiplier for the melee step being resolved (Retaliate, Retaliation / Wrath); 1 otherwise. */
  private swingMult = 1;

  /** Longshot: guns (Ranger) or techniques (Force) hit harder past a distance. */
  private longshot(target: Hittable, tech: boolean): number {
    if (!this.c.hasPassive(tech ? 'techLongshot' : 'longshot')) return 1;
    const d = Math.hypot(target.pos.x - this.p.pos.x, target.pos.z - this.p.pos.z);
    return d > T.longshotRange ? this.c.pMult(tech ? 'techLongshot' : 'longshot', T.longshotMult) : 1;
  }

  /** Below half HP: Adrenaline (weapon hits) or Overcast (techniques). */
  private lowHpMult(tech: boolean): number {
    const p = this.p;
    if (p.hp >= p.maxHp * T.adrenalineBelow) return 1;
    if (tech) return this.c.pMult('overcast', T.overcastMult);
    return this.c.pMult('adrenaline', T.adrenalineMult);
  }

  /** One weapon hit's weapon damage: the stat plus the weapon's roll, times Weapon damage % and Farlla's attack buff. */
  private playerWeaponDamage(): number {
    const [lo, hi] = this.c.weaponAtp();
    const base = this.c.stats().atp + randRange(lo, hi, this.h.rng);
    return base * (1 + this.c.weaponDamagePct() / 100) * (1 + this.p.buffs.atp.pct / 100);
  }

  /** The perfect-streak damage multiplier. */
  comboMult(streak: number): number {
    return comboDamage[Math.min(streak, comboDamage.length - 1)];
  }

  /** The last crit roll was Shadow Step's certain one. */
  private certain = false;

  /** Crit roll (crit chance from level, the Mag and gear; Mark's Weak Spot adds some); Shadow Step's crit is certain. */
  private rollCrit(target?: Hittable): boolean {
    this.certain = this.p.critNextT > 0;
    if (this.certain) {
      this.p.critNextT = 0;
      return true;
    }
    const weakSpot = target && this.c.artMod('mark', 'weakSpot') && this.marked(target) ? 15 : 0;
    return this.h.rng() * 100 < this.c.critChance() + weakSpot;
  }

  /** Resolve one weapon hit (a basic step's or a weapon Art's) against a target. Nothing misses. */
  weaponHit(target: Hittable, s: WeaponHit): { dmg: number; killed: boolean } {
    const p = this.p;
    const c = this.c;
    const rng = this.h.rng;
    const kind = c.weaponKind();
    const art = s.art;
    const basic = !art;
    const strong = !!s.strong;

    const deadeye = c.hasPassive('deadeye');
    // Guns hit for less past their effective range (half as fast with Deadeye; Reach affixes push it out).
    let falloff = 1;
    if (kind.ranged) {
      const over = Math.hypot(target.pos.x - p.pos.x, target.pos.z - p.pos.z) - (kind.falloffStart ?? rangedFalloff.start) - c.gearAffix('falloff');
      if (over > 0) falloff = Math.max(rangedFalloff.floor, 1 - over * rangedFalloff.perM * (deadeye ? 0.5 : 1));
    }

    // Weapon specials roll on big blows: Arts that hit hard, and the basic finisher (Rounds: more often).
    const specialId = strong || (basic && s.finisher) ? c.weaponSpecial() : undefined;
    const sp = specialId ? specials[specialId] : undefined;
    const procChance = (sp?.procChance ?? 0) * c.pMult('rounds', T.roundsMult);
    const wd = this.playerWeaponDamage();
    const rangeMult = kind.ranged ? formulas.rangedDamageMult : formulas.meleeDamageMult;
    const comboMult = this.comboMult(s.streak);
    // Passives and affixes on the hit: Crush (sword Arts) ignores part of the armour, finishers (Follow-through,
    // Brutal), Balance (saber Arts), Executioner on staggered enemies, perfect shots (Hot Streak, Rhythmic), Deadeye
    // (gun Arts), Longshot far away, Retaliate after being hit, Adrenaline at low HP, Mark on the target.
    const crush = art && kind.kind === 'sword' && c.hasPassive('crush') ? c.pAmt('crush', T.crushDfpIgnore) : 0;
    const armor = this.armorOf(target) * (1 - Math.min(1, crush + (s.pierce ?? 0)));
    let mult = (s.mult ?? 1) * (kind.ranged ? this.longshot(target, false) * falloff * (art ? c.pMult('deadeye', T.deadeyeMult) : 1) : this.swingMult);
    if (s.finisher) mult *= c.pMult('followThrough', T.followThroughMult) * (1 + c.gearAffix('finisherPct') / 100);
    if (art && kind.kind === 'saber') mult *= c.pMult('balance', T.balanceMult);
    if (s.finisher && staggered(target)) mult *= c.pMult('executioner', T.executionerMult);
    if (s.streak > 0 && kind.ranged) mult *= c.pMult('hotStreak', T.hotStreakMult) * (1 + c.gearAffix('perfectPct') / 100);
    mult *= this.lowHpMult(false) * this.takenMult(target) * this.haloMult() * (art ? c.artRankPower(art) : 1) * this.ufx.dealtMult(target);
    // Frozen Shooter: a frozen enemy shatters for more; anything else (bosses included) takes less.
    const shooter = c.hasUnique('frozenShooter');
    const shatter = shooter && frozen(target);
    if (shooter) mult *= shatter ? U.frozenShatterMult : U.frozenOtherMult;
    let dmg = playerDamageRaw(wd, armor, s.power) * kind.damageScale * rangeMult * comboMult * mult * target.damageMult(p.pos.x, p.pos.z, strong);
    const handgun = kind.kind === 'handgun';
    const crit = this.ufx.canCrit(handgun) && this.rollCrit(target);
    if (crit) dmg *= c.critDamage() * (this.certain && this.ambush ? 1.5 : 1);
    if (this.certain) this.ambush = false;
    dmg = Math.max(formulas.minDamage, Math.round(dmg));

    const kb = (kind.ranged ? 0.6 : feel.enemyKnockback * (strong ? 2 : 1)) * (s.kb ?? 1);
    // Basic steps chip, big blows break; finishers count double and a melee Art as the finisher always staggers.
    // Shots stagger less than blades.
    let staggerPts = (strong ? stagger.heavy : stagger.light) * Math.min(1, s.kb ?? 1) * (s.finisher ? 2 : 1) * (s.stagger ?? 1);
    if (kind.ranged) staggerPts *= stagger.rangedMult * kind.damageScale * c.pMult('pinningFire', T.pinningFireMult);
    else if (s.finisher && strong) staggerPts = Infinity;
    else {
      staggerPts *= weaponWeights[kind.weight ?? 'medium'].staggerMult * c.pMult('breaker', T.breakerMult) * (1 + c.gearAffix('staggerPct') / 100);
      if (art && kind.kind === 'saber') staggerPts += c.pAmt('balance', T.balanceStagger);
    }
    let extra = '';

    // Dim: instant kill roll before damage.
    if (sp?.effect === 'instakill' && target.maxHp < 5556 && rng() < procChance) {
      dmg = target.hp;
      extra = ` <span class="l-proc">${sp.name}!</span>`;
      this.h.float(tmp.copy(target.pos).setY(target.aimHeight + 1.2), `${sp.name}!`, 'proc');
      sfx('hit.special', { x: target.pos.x, z: target.pos.z });
    }

    const killed = this.deal(target, dmg, p.pos.x, p.pos.z, kb, staggerPts);
    this.ufx.landed(target, dmg);
    if (!killed) this.ufx.afterHit(target, dmg, crit, handgun);
    sfx(crit ? 'hit.crit' : strong || s.finisher ? 'hit.heavy' : 'hit.normal', { x: target.pos.x, z: target.pos.z });
    const cls = crit ? 'dmg crit' : strong ? 'dmg heavy' : 'dmg';
    this.h.float(tmp.copy(target.pos).setY(target.aimHeight + 0.6), crit ? `${dmg}!` : String(dmg), cls);
    if (target.damageMult() > 1) extra += ' <span class="l-proc">WEAK</span>';

    if (shatter) {
      // Shattered: thawed, and it can't be frozen again for a while.
      target.thaw?.();
      this.debuff(target).noFreezeT = U.frozenImmuneTime;
      this.h.float(tmp.copy(target.pos).setY(target.aimHeight + 1.2), 'SHATTER', 'proc');
      sfx('hit.special', { x: target.pos.x, z: target.pos.z });
      extra += ' <span class="l-proc">Shatter</span>';
    } else if (shooter && art && !killed && (this.debuffs.get(target)?.noFreezeT ?? 0) <= 0) {
      // The Frozen Shooter's Arts freeze (its basic shots set up the shatter).
      this.freeze(target, U.frozenFreezeTime);
    }

    if (!killed && kind.ranged) {
      // Ranger passives on the target hit.
      if (basic && c.hasPassive('suppress')) this.weaken(target, c.pMult('suppress', T.suppressMult), T.suppressTime);
      if (basic && s.finisher && c.hasPassive('pin')) this.stun(target, T.pinStun);
      if (art && p.pointBlankT <= 0 && c.hasPassive('pointBlank') && Math.hypot(target.pos.x - p.pos.x, target.pos.z - p.pos.z) - target.radius <= T.pointBlankRange) {
        this.shove(target, p.pos.x, p.pos.z, T.pointBlankKnock);
        p.dashCharges = Math.min(p.maxDashCharges, p.dashCharges + 1);
        p.pointBlankT = T.pointBlankCooldown;
        this.h.float(tmp.copy(p.pos).setY(2.6), 'POINT BLANK', 'proc');
      }
    }
    if (kind.ranged && basic && s.finisher && c.hasPassive('arc')) {
      this.arcChain(target, dmg, T.arcShare, T.arcStun);
      extra += ' <span class="l-proc">Arc</span>';
    }

    if (sp && !killed && sp.effect !== 'instakill' && rng() < procChance) {
      if (sp.effect === 'drain') {
        const heal = Math.max(1, Math.round(dmg * sp.power));
        p.hp = Math.min(p.maxHp, p.hp + heal);
        this.h.float(tmp.copy(p.pos).setY(2.2), `+${heal}`, 'heal');
        sfx('hit.special');
        extra += ` <span class="l-proc">${sp.name}</span>`;
      } else {
        // Heat and Venom always take; Ice and Shock are crowd control, which the target may resist.
        let landed = true;
        if (sp.effect === 'freeze') landed = this.freeze(target, sp.duration);
        else if (sp.effect === 'stun') landed = this.stun(target, sp.duration);
        else target.applyStatus(sp.effect === 'burn' ? 'burn' : 'poison', sp.power, sp.duration);
        if (landed) {
          this.h.float(tmp.copy(target.pos).setY(target.aimHeight + 1.2), sp.name + '!', 'proc');
          sfx('hit.special', { x: target.pos.x, z: target.pos.z });
          extra += ` <span class="l-proc">${sp.name}</span>`;
        }
      }
    }

    this.h.hitstop(strong ? feel.hitstopHeavy : feel.hitstopNormal);
    // Only blades shake the camera: guns land hits too often (shot fans, Arc chains) for it to read as impact.
    if (!kind.ranged) this.h.shake(feel.shakeOnHit * (strong ? 1.8 : 1));
    this.h.log(`${s.label} → ${target.name}: <b>${dmg}</b>${crit ? ' <span class="l-kill">CRIT</span>' : ''}${extra}${killed ? ' <span class="l-kill">KILL</span>' : ''}`);
    if (killed) this.h.onKill(target);
    return { dmg, killed };
  }

  /** Shadow Step's Ambush: the next crit (from its certain one) deals more. */
  ambush = false;

  /** Arc: the hit jumps on to up to two more enemies near the target, for a share of its damage. */
  arcChain(from: Hittable, dmg: number, share: number, stun: number): void {
    const hit: Hittable[] = [from];
    for (let n = 0; n < 2; n++) {
      const last = hit[hit.length - 1];
      let next: Hittable | null = null;
      let best = 5;
      for (const h of this.targets()) {
        if (hit.includes(h)) continue;
        const d = Math.hypot(h.pos.x - last.pos.x, h.pos.z - last.pos.z);
        if (d < best) {
          best = d;
          next = h;
        }
      }
      if (!next) break;
      hit.push(next);
      const jump = Math.max(1, Math.round(dmg * share));
      this.arc(chestOf(last), chestOf(next), 0x80e0ff, 0.8);
      sfx('tech.zonde', { x: next.pos.x, z: next.pos.z });
      const killed = this.deal(next, jump, from.pos.x, from.pos.z, 0, 0.5);
      if (!killed) this.stun(next, stun);
      this.h.float(tmp.copy(next.pos).setY(next.aimHeight + 0.6), String(jump), 'dmg tech');
      if (killed) this.h.onKill(next);
    }
  }

  /** Resolve one technique hit (an attack technique Art) against a target. */
  techHit(target: Hittable, s: TechHit): { dmg: number; killed: boolean } {
    if (!target.alive || target.invulnerable) return { dmg: 0, killed: false };
    const p = this.p;
    const c = this.c;
    const t = techniques[s.tech];
    const crit = this.rollCrit(target);
    let mult = (s.mult ?? 1) * (s.share ?? 1) * this.comboMult(s.streak) * this.lowHpMult(true) * this.haloMult() * this.ufx.dealtMult(target);
    // Passives: Resonance (perfectly chained), Focus Bolt (the single-target ones), Overload (the 3rd step).
    if (s.streak > 0) mult *= c.pMult('resonance', T.resonanceMult);
    if ((s.tech === 'foie' || s.tech === 'zonde' || s.tech === 'barta') ) mult *= c.pMult('focusBolt', T.focusBoltMult);
    if (s.finisher) mult *= c.pMult('overload', T.overloadMult);
    if (c.hasUnique('reactorRod')) mult *= Math.min(U.reactorCap, 1 + U.reactorStep * Math.max(0, this.reactorRun - 1));
    const power = c.techDamage(s.tech) * mult * this.longshot(target, true) * this.takenMult(target) * cutMult(target.techResist ?? 0);
    const dmg = Math.max(1, Math.round(power * target.damageMult(p.pos.x, p.pos.z, (s.stagger ?? 1) > 1) * (crit ? c.critDamage() : 1)));
    // A storm's or blizzard's ticks don't flinch (2026-10-16: Razonde strikes kept enemies locked in place).
    const staggerPts = s.tick ? 0 : stagger.light * (s.stagger ?? 1) * (s.share ?? 1) * c.pMult('conductor', T.conductorMult);
    const killed = this.deal(target, dmg, p.pos.x, p.pos.z, (s.stagger ?? 1) > 1 ? 1.5 : 1, staggerPts);
    this.ufx.landed(target, dmg);
    if (!killed) this.ufx.afterHit(target, dmg, crit, false);
    if (s.tick) target.quietHit?.();
    if (t.element === 'fire') sfx('tech.foie.hit', { x: target.pos.x, z: target.pos.z });
    if (crit) sfx('hit.crit', { x: target.pos.x, z: target.pos.z });
    this.h.float(tmp.copy(target.pos).setY(target.aimHeight + 0.6), crit ? `${dmg}!` : String(dmg), crit ? 'dmg tech crit' : 'dmg tech');
    let extra = crit ? ' <span class="l-kill">CRIT</span>' : '';
    if (!killed && s.status !== false) {
      const kindle = c.pMult('kindle', T.kindleMult);
      if (t.element === 'fire') target.applyStatus('burn', (dmg * techScaling.burnShare * kindle * (s.burn ?? 1)) / techScaling.burnTime, techScaling.burnTime);
      if (t.element === 'ice') this.chillTarget(target, techScaling.chillMult, techScaling.chillTime);
      // Lightning may stun: the technique's own chance, times Kindle and Paralyze; no longer more with tech damage
      // (2026-10-16: +0.03% a point reached 100% a strike at endgame tech damage). s.stun 0: this hit doesn't roll.
      const stunChance = t.statusChance * kindle * (s.stun ?? 1);
      if (t.element === 'lightning' && stunChance > 0 && this.stun(target, 2, stunChance)) {
        extra += ' <span class="l-proc">stun</span>';
      }
    }
    this.h.log(`${s.label} → ${target.name}: <b>${dmg}</b>${extra}${killed ? ' <span class="l-kill">KILL</span>' : ''}`);
    if (!s.tick) this.h.hitstop((s.stagger ?? 1) > 1 ? feel.hitstopHeavy : feel.hitstopNormal);
    if (killed) this.h.onKill(target);
    return { dmg, killed };
  }

  // ------------------------------------------------------- the basic step

  /** TP a landed basic step refills: a share of the class's base TP, more on the finisher and a perfect chain (and Flow). */
  private basicRefill(finisher: boolean, streak: number): void {
    const c = this.c;
    const kind = c.weaponKind();
    let amount = basicAttack.tpRefill * c.baseTp() * (finisher ? basicAttack.finisherTp : 1) * (streak > 0 ? basicAttack.perfectTp : 1) * (kind.tpRefill ?? 1);
    amount *= c.pMult('hunterFocus', T.focusTpMult) * c.pMult('rangerFocus', T.focusTpMult);
    if (kind.family === 'caster') amount *= c.pMult('siphonStaff', T.siphonMult);
    amount *= 1 + c.gearAffix('tpRefill') / 100;
    if (c.hasUnique('v801')) amount *= Math.max(0, 1 - c.uval(U.v801Refill));
    const p = this.p;
    p.tp = Math.min(p.maxTp, p.tp + amount);
  }

  /** The chain produced a basic step's 'hit': swing, shoot or bolt; streak is the perfect-chain streak behind it. */
  basicStep(hitIndex: number, streak: number): void {
    const kind = this.c.weaponKind();
    const p = this.p;
    const c = this.c;
    const label = `#${hitIndex + 1}${streak ? ` ★${streak}` : ''}`;
    const finisher = hitIndex === 2;
    const perfectFinisher = finisher && streak >= comboDamage.length - 1;
    let landed = false;
    if (kind.family === 'caster' && c.weaponInstance()) {
      this.photonBolt(hitIndex, streak, `${label} bolt`);
      landed = true;
    } else if (kind.ranged) {
      this.fireBasic(hitIndex, streak, label);
      landed = true;
      // Breathing Room: a perfect shot pushes back everything close.
      if (streak > 0 && c.hasPassive('breathingRoom')) {
        for (const e of this.h.world().targets()) {
          if (Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z) - e.radius <= T.breathingRoomRange) this.shove(e, p.pos.x, p.pos.z, T.breathingRoomKnock);
        }
        this.flashShape({ kind: 'circle', x: p.pos.x, z: p.pos.z, radius: T.breathingRoomRange }, 0xffd080);
      }
    } else {
      // Retaliate: the first melee step after being hit lands harder, then it's spent; Retaliation / Wrath stack on.
      if (p.retaliate > 0 && c.hasPassive('retaliate')) {
        this.swingMult = this.c.pMult('retaliate', T.retaliateMult);
        p.retaliate = 0;
      }
      if (p.bonusSwings > 0) {
        this.swingMult *= p.bonusSwingMult;
        p.bonusSwings--;
      }
      landed = this.meleeBasic(hitIndex, streak, swingMultLabel(label, this.swingMult)) > 0;
      this.swingMult = 1;
      if (landed) this.basicRefill(finisher, streak);
    }
    this.afterStep(finisher, landed, streak, perfectFinisher, false);
  }

  /** Perfect steps and finishers (basic or Art): Parry, Iron Finish, and a perfect finisher's passives. */
  afterStep(finisher: boolean, landed: boolean, streak: number, perfectFinisher: boolean, tech: boolean): void {
    const p = this.p;
    const c = this.c;
    if (streak > 0 && (tech ? c.hasPassive('calmMind') : c.hasPassive('parry'))) p.guard(c.pMult(tech ? 'calmMind' : 'parry', T.parryMult), T.parryTime);
    if (finisher && landed && c.hasPassive('ironFinish')) p.ironPoise = true;
    if (perfectFinisher) {
      if (c.hasPassive('secondWind')) {
        const amount = Math.max(1, Math.round(p.maxHp * c.pAmt('secondWind', T.secondWindHeal)));
        p.hp = Math.min(p.maxHp, p.hp + amount);
        this.h.float(tmp.copy(p.pos).setY(2.2), `+${amount}`, 'heal');
      }
      if (c.hasPassive('composure')) p.composureT = T.composureTime;
      if (c.hasPassive('rush')) p.rushT = T.rushTime;
    }
  }

  /**
   * A basic swing sweeps the kind's arc and hits up to maxTargets. Cleave widens it, a Whirl finisher hits all
   * around, Flurry (a dagger's perfect finisher) and Shadow Step's Flurry strike more; returns targets struck.
   */
  meleeBasic(hitIndex: number, streak: number, label: string, power: number = basicAttack.damageMult): number {
    const p = this.p;
    const c = this.c;
    const kind = c.weaponKind();
    const finisher = hitIndex === 2;
    const whirl = finisher && c.hasPassive('whirl');
    const cleave = c.hasPassive('cleave');
    const arcDeg = whirl ? 360 : kind.arcDeg + (cleave ? T.cleaveArcDeg : 0);
    const maxTargets = kind.maxTargets + (cleave ? T.cleaveTargets : 0) + (whirl ? 2 : 0);
    const inReach = this.inArc(kind.range, arcDeg, maxTargets);
    if (inReach.length === 0) {
      this.h.log(`${label}: <span class="l-dim">whiff</span>`);
      return 0;
    }
    if (whirl) this.flashShape({ kind: 'circle', x: p.pos.x, z: p.pos.z, radius: kind.range }, kind.color);
    // Flurry: a dagger's perfect finisher strikes once more. Shockwave: a basic finisher throws enemies far.
    const flurry = finisher && streak >= comboDamage.length - 1 && c.hasPassive('flurry') ? 1 : 0;
    const hits = kind.hits + flurry + p.extraStrikes;
    p.extraStrikes = 0;
    const kbBoost = finisher && c.hasPassive('shockwave') ? T.shockwaveKnock : 1;
    let struck = 0;
    for (const t of inReach) {
      let landed = false;
      for (let i = 0; i < hits; i++) {
        if (!t.alive) break;
        this.weaponHit(t, { power, label: hits > 1 ? `${label}.${i + 1}` : label, streak, finisher, art: null, kb: (i === 0 ? 1 : 0.3) * kbBoost });
        landed = true;
      }
      if (landed) struck++;
    }
    // Sweep Guard: each enemy a basic swing hits takes a little off damage taken for a moment.
    if (struck && c.hasPassive('sweepGuard')) p.addSweepGuard(struck * c.pAmt('sweepGuard', T.sweepGuardStep), c.pAmt('sweepGuard', T.sweepGuardMax), T.sweepGuardTime);
    return struck;
  }

  /** Enemies in front within `range` and `arcDeg` (point blank always counts), the camera's target first, then the nearest. */
  inArc(range: number, arcDeg: number, maxTargets: number): Hittable[] {
    const p = this.p;
    const halfArc = THREE.MathUtils.degToRad(arcDeg) / 2;
    const lock = this.h.camTarget();
    return this.h
      .world()
      .hittables()
      .filter((e) => {
        if (e.invulnerable) return false;
        const d = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
        if (d - e.radius > range) return false;
        if (d < e.radius + p.radius + 0.2) return true;
        return Math.abs(angleDelta(p.yaw, yawTo(p.pos.x, p.pos.z, e.pos.x, e.pos.z))) <= halfArc;
      })
      .sort((a, b) => {
        if (a === lock) return -1;
        if (b === lock) return 1;
        return a.pos.distanceToSquared(p.pos) - b.pos.distanceToSquared(p.pos);
      })
      .slice(0, maxTargets);
  }

  /**
   * Basic shots fly straight (a fan, or one piercing round) and hit each enemy at most once, up to maxTargets.
   * Spread adds projectiles, Pierce lets shots through one more enemy, Piercing Round makes a finisher pierce everything.
   */
  private fireBasic(hitIndex: number, streak: number, label: string): void {
    const p = this.p;
    const c = this.c;
    const kind = c.weaponKind();
    const target = this.aimTarget();
    const finisher = hitIndex === 2;
    const spread = c.hasPassive('spread');
    const spreadRad = THREE.MathUtils.degToRad((kind.spreadDeg ?? 0) || (spread ? 10 : 0));
    const roundThrough = finisher && c.hasPassive('piercingRound');
    const extraPierce = c.hasPassive('pierce') ? 1 : 0;
    const pierce = !!kind.pierce || roundThrough;
    const count = Math.max(1, kind.projectiles) + (spread ? (kind.projectiles >= 5 ? 2 : 1) : 0);
    const maxTargets = kind.maxTargets + (spread ? 1 : 0) + (kind.pierce ? extraPierce : 0);
    const struck = new Set<Hittable>();
    let refilled = false;
    const aimYaw = target && target.alive ? yawTo(p.pos.x, p.pos.z, target.pos.x, target.pos.z) : p.yaw;
    for (let i = 0; i < count; i++) {
      const offset = count > 1 && spreadRad > 0 ? (i / (count - 1) - 0.5) * spreadRad : 0;
      let pierced = 0;
      // How many enemies one projectile goes through: a piercing kind its target cap, a Piercing Round 8, others 1 (+1 with Pierce).
      const through = roundThrough ? 8 : pierce ? maxTargets : 1 + extraPierce;
      this.shoot(aimYaw + offset, {
        speed: kind.projSpeed, range: kind.range, radius: pierce ? 0.55 : 0.35, size: pierce ? 0.3 : 0.12, color: kind.color,
        delay: spreadRad > 0 ? 0 : i * 0.06,
        onHit: (t) => {
          if (t.invulnerable) return false;
          if (struck.has(t)) return false; // already hit by this step: pass through
          if (struck.size >= maxTargets) return true;
          struck.add(t);
          this.weaponHit(t, { power: basicAttack.damageMult, label: count > 1 || pierce ? `${label}.${struck.size}` : label, streak, finisher, art: null });
          if (!refilled) {
            refilled = true;
            this.basicRefill(finisher, streak);
          }
          return ++pierced >= through;
        },
      });
    }
  }

  /** A caster's basic step: a homing photon bolt at the aimed enemy (tech damage, technique resistance). */
  private photonBolt(hitIndex: number, streak: number, label: string): void {
    const p = this.p;
    const c = this.c;
    const kind = c.weaponKind();
    const target = this.aimTarget(basicAttack.boltRange);
    const finisher = hitIndex === 2;
    const yaw = target ? yawTo(p.pos.x, p.pos.z, target.pos.x, target.pos.z) : this.casterYaw();
    const size = finisher ? 1.4 : 1;
    const bolt = this.shoot(yaw, {
      speed: basicAttack.boltSpeed, range: basicAttack.boltRange, radius: 0.5, size: 0.12 * size, color: 0xffffff, homing: target, homingRate: 9,
      onHit: (t) => {
        if (t.invulnerable) return false;
        const crit = this.rollCrit(t);
        const mult = this.comboMult(streak) * (finisher ? c.pMult('followThrough', T.followThroughMult) : 1) * this.lowHpMult(true) * this.haloMult() * this.takenMult(t) * this.ufx.dealtMult(t);
        const dmg = Math.max(1, Math.round(c.boltDamage() * mult * cutMult(t.techResist ?? 0) * t.damageMult(p.pos.x, p.pos.z, false) * (crit ? c.critDamage() : 1)));
        const killed = this.deal(t, dmg, p.pos.x, p.pos.z, 0.8, stagger.light * (finisher ? 2 : 1));
        this.ufx.landed(t, dmg);
        if (!killed) this.ufx.afterHit(t, dmg, crit, false);
        sfx(crit ? 'hit.crit' : 'hit.normal', { x: t.pos.x, z: t.pos.z });
        this.h.float(tmp.copy(t.pos).setY(t.aimHeight + 0.6), crit ? `${dmg}!` : String(dmg), crit ? 'dmg tech crit' : 'dmg tech');
        this.h.log(`${label} → ${t.name}: <b>${dmg}</b>${crit ? ' <span class="l-kill">CRIT</span>' : ''}${killed ? ' <span class="l-kill">KILL</span>' : ''}`);
        this.basicRefill(finisher, streak);
        if (killed) this.h.onKill(t);
        this.fx(new Burst(bolt.pos.x, bolt.pos.y, bolt.pos.z, 8, { ...MOTES, color: 0xffffff, to: kind.color, speed: [1, 3] }));
        return true;
      },
    });
    // A white core in the weapon's colour, trailing motes of light.
    this.fx(new Trail(() => (bolt.dead ? null : bolt.pos), 40 * size, { ...MOTES, to: kind.color, size: 0.13 * size }, { color: kind.color, size: 1.1 * size }));
  }

  /** Fire a player projectile from her hands along `yaw`. */
  shoot(yaw: number, spec: Omit<ProjectileSpec, 'from' | 'dir' | 'origin'> & { from?: THREE.Vector3 }): Projectile {
    const p = this.p;
    const { from, ...rest } = spec;
    const origin = () => new THREE.Vector3(p.pos.x + Math.sin(p.yaw) * 0.8, 1.25, p.pos.z + Math.cos(p.yaw) * 0.8);
    return this.h.world().spawnProjectile({
      ...rest,
      from: from ?? origin(),
      origin: from ? undefined : origin,
      dir: new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)),
    });
  }

  // ------------------------------------------------------------ Arts

  /** The target an Art aimed at when it started. */
  artTarget: Hittable | null = null;
  /** The direction it aimed when it started (area techniques: the camera's, or toward its target). */
  artYaw = 0;
  /** How far out along `artYaw` Rafoie and Razonde land with no target (their range when the camera's target is past it). */
  artDist: number = lockOn.areaAimDist;

  /** TP one use of this Art costs now: its own, then Clarity, Overload (as the 3rd step) and Focus (half). */
  artCost(id: ArtId, hitIndex: number): number {
    const c = this.c;
    const p = this.p;
    if (isTechArt(id) && isAttackTech(id) && p.clarity > 0) return 0;
    let cost = c.artCost(id);
    if (isTechArt(id) && isAttackTech(id) && hitIndex === 2 && c.hasPassive('overload')) cost *= 2;
    if (p.halfCostNext) cost *= 0.5;
    cost *= this.ufx.costMult(id, hitIndex);
    return Math.round(cost);
  }

  /** Why this Art can't be used now (cooldown, TP, no target in reach), or null. `hitIndex`: the chain step it would be. */
  artBlocked(id: ArtId, hitIndex: number): string | null {
    const cd = this.p.cooldownLeft(id);
    if (cd > 0) return `${ARTS[id].name}: ${cd.toFixed(1)} s`;
    const cost = this.artCost(id, hitIndex);
    // Dark Bridge: a technique short of TP can take the rest from HP.
    if (cost > this.p.tp && this.ufx.bloodCost(id, cost - this.p.tp) === null) return 'Not enough TP';
    return this.artAimBlocked(id);
  }

  /** An Art step started: pay its TP, start its cooldown and aim it. */
  artStart(id: ArtId, hitIndex: number, perfect: boolean): void {
    const p = this.p;
    const full = this.artCost(id, hitIndex);
    const cost = Math.min(p.tp, full);
    p.tp -= cost;
    p.halfCostNext = false;
    this.artCostPaid = cost;
    const cd = this.c.artCooldown(id);
    if (cd > 0) p.cooldowns.set(id, cd);
    this.ufx.started(id, hitIndex, perfect, full, cost);
    if (isTechArt(id)) sfx('tech.charge');
    this.artDist = lockOn.areaAimDist;
    if (isTechArt(id) && aimsWithCamera(id)) {
      // Area techniques go where the camera looks: Gizonde and Gibarta straight along it (at its target, if any), Rafoie
      // and Razonde onto its target in reach, else the enemy nearest that line, else out along it (as far as they reach
      // when its target is beyond them).
      const camYaw = this.casterYaw();
      const onSpot = techniques[id].shape === 'meteor' || techniques[id].shape === 'storm';
      this.artTarget = onSpot ? this.areaTarget(ARTS[id].range + 2, camYaw) : this.camTarget(Infinity);
      this.artYaw = this.artTarget ? yawTo(p.pos.x, p.pos.z, this.artTarget.pos.x, this.artTarget.pos.z) : camYaw;
      if (onSpot && !this.artTarget && this.h.camTarget()?.alive) this.artDist = ARTS[id].range;
      p.aimYaw = this.artYaw;
    } else {
      this.artTarget = this.aimTarget(ARTS[id].range + 2);
      p.aimYaw = this.artTarget ? yawTo(p.pos.x, p.pos.z, this.artTarget.pos.x, this.artTarget.pos.z) : isTechArt(id) && isAttackTech(id) ? this.casterYaw() : null;
      this.artYaw = p.aimYaw ?? p.yaw;
    }
    // Arts that seal end the chain with them.
    if (ARTS[id].seals) p.combo.seal();
    if (perfect && isTechArt(id) && this.c.hasPassive('calmMind')) p.guard(this.c.pMult('calmMind', T.parryMult), T.parryTime);
  }

  /** TP the Art being played cost (refunds use it). */
  artCostPaid = 0;

  /** The chain produced an Art's 'hit' (its wind-up ended): its effect, or the start of its channel. */
  artFire(id: ArtId, hitIndex: number, streak: number): void {
    const ctx = this.ctx(id, hitIndex, streak);
    ctx.mult *= this.ufx.takeCastMult();
    if (isTechArt(id) && isAttackTech(id) && this.c.hasUnique('reactorRod')) {
      if (this.reactorIdle > U.reactorWindow) this.reactorRun = 0;
      this.reactorRun++;
      this.reactorIdle = 0;
    }
    if (ARTS[id].role !== 'support') {
      // Retaliate and Retaliation / Wrath ride on melee Arts too.
      const p = this.p;
      if (!isTechArt(id) && !this.c.weaponKind().ranged) {
        if (p.retaliate > 0 && this.c.hasPassive('retaliate')) {
          this.swingMult = this.c.pMult('retaliate', T.retaliateMult);
          p.retaliate = 0;
        }
      }
    }
    this.arts.fire(id, ctx);
    this.swingMult = 1;
    // Yasakani Magatama: now and then the Art plays again (a channel's every effect too).
    this.ufx.fired(id, ctx, (echo) => {
      const target = this.artTarget;
      if (!target?.alive) this.artTarget = isTechArt(id) && aimsWithCamera(id) ? null : this.aimTarget(ARTS[id].range + 2);
      this.arts.fire(id, echo);
      const n = this.c.artTicks(id);
      for (let i = 0; i < n; i++) this.later((ARTS[id].channel * (i + 1)) / n, () => this.arts.tick(id, i, echo));
    });
    const tech = isTechArt(id) && isAttackTech(id);
    this.afterStep(ctx.finisher, true, streak, ctx.finisher && streak >= comboDamage.length - 1, isTechArt(id));
    if (tech && ctx.finisher) {
      const p = this.p;
      if (this.c.hasPassive('aegis')) p.addTimedShield(p.maxHp * this.c.pAmt('aegis', T.aegisShield), T.aegisTime);
      // Echo: the technique repeats a moment later at half power, free.
      if (this.c.hasPassive('echo')) {
        const target = this.artTarget;
        const yaw = this.artYaw;
        const dist = this.artDist;
        this.later(T.echoDelay, () => {
          this.artTarget = target?.alive ? target : isTechArt(id) && aimsWithCamera(id) ? null : this.aimTarget(ARTS[id].range + 2);
          this.artYaw = yaw;
          this.artDist = dist;
          this.arts.fire(id, { ...this.ctx(id, hitIndex, 0), mult: this.c.pAmt('echo', T.echoShare), echo: true });
        });
      }
    }
  }

  /** One of a channel Art's effects is due (Cyclone's sweeps, Rapid Volley's shots, a Leap's landing). */
  artTick(id: ArtId, tick: number, hitIndex: number, streak: number): void {
    this.arts.tick(id, tick, this.ctx(id, hitIndex, streak));
  }

  private ctx(id: ArtId, hitIndex: number, streak: number): ArtCtx {
    const c = this.c;
    return {
      id, hitIndex, streak, finisher: hitIndex === 2, mult: 1, echo: false,
      label: `${ARTS[id].name}${streak ? ` ★${streak}` : ''}`,
      has: (mod: string) => c.artMod(id, mod),
    };
  }

  // ---------------------------------------------------- photon blasts

  /** The gauge is full: the Mag's photon blast (the game fires it by itself). Returns why not, or null when fired. */
  photonBlast(): string | null {
    const p = this.p;
    const c = this.c;
    const pb = c.photonBlast;
    if (!pb) return `No photon blast (the Mag teaches them from Lv ${magCfg.pbLevel})`;
    if (p.pb < 1) return 'Photon blast not charged';
    if (!p.alive || p.paralyzed) return "Can't now";
    p.pb = 0;
    if (c.hasUnique('v801')) p.dashCharges = p.maxDashCharges;
    const at = tmp.copy(p.pos).setY(2.8);
    sfx('jingle.magEvolve');
    this.h.shake(0.4);
    if (pb === 'mylla') {
      this.h.float(at, 'MYLLA & YOULLA', 'proc');
      this.flashShape({ kind: 'circle', x: p.pos.x, z: p.pos.z, radius: magCfg.pbMyllaRange }, 0xffe080);
      const magic = c.prefersMagic;
      for (const e of this.targets()) {
        if (Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z) - e.radius > magCfg.pbMyllaRange) continue;
        const kind = c.weaponKind();
        const [lo, hi] = c.weaponDamage();
        const weaponHit = playerDamageRaw(((lo + hi) / 2) * (1 + p.buffs.atp.pct / 100), e.armor, basicAttack.damageMult) * 2 * kind.damageScale * (kind.ranged ? formulas.rangedDamageMult : formulas.meleeDamageMult);
        const techHit = c.techDamage(c.mainTech()) * cutMult(e.techResist ?? 0);
        const dmg = Math.max(1, Math.round(magCfg.pbMyllaMult * (magic ? Math.max(techHit, weaponHit) : weaponHit) * e.damageMult()));
        this.flashBolt(e.pos, 0xffe080, 0.5, 8);
        const killed = this.deal(e, dmg, p.pos.x, p.pos.z, 3, stagger.heavy * 2);
        this.h.float(tmp.copy(e.pos).setY(e.aimHeight + 0.6), String(dmg), 'dmg crit');
        if (killed) this.h.onKill(e);
      }
    } else if (pb === 'leilla') {
      this.h.float(at, 'LEILLA', 'heal');
      const amount = Math.round(p.maxHp * magCfg.pbLeillaHeal);
      p.hp = Math.min(p.maxHp, p.hp + amount);
      p.leillaT = magCfg.pbLeillaTime;
      this.h.float(tmp.copy(p.pos).setY(2.2), `+${amount}`, 'heal');
    } else {
      this.h.float(at, 'FARLLA', 'heal');
      p.buffs.atp = { pct: Math.max(p.buffs.atp.pct, magCfg.pbFarllaPct), t: techScaling.buffDuration };
      p.buffs.def = { pct: Math.max(p.buffs.def.pct, magCfg.pbFarllaPct * techScaling.debandShare), t: techScaling.buffDuration };
    }
    this.h.log(`<span class="l-proc">Photon blast!</span>`);
    return null;
  }

  // ---------------------------------------------------- visuals

  /** Add a cosmetic effect to the world. */
  fx(e: Effect): void {
    this.h.world().addEffect(e);
  }

  /**
   * Lightning striking a spot from `height` m up (Zonde, Razonde, Arc, Mylla & Youlla): a thin jagged bolt, a spray
   * of sparks and a small glow where it lands. `width` scales the bolt (0.35 is a normal one). Until 2026-10-14 this
   * was a solid 10 m cylinder flashed for 0.14 s.
   */
  flashBolt(at: THREE.Vector3, color: number, width: number, height = 10): void {
    const spread = height * 0.15;
    const top = new THREE.Vector3(at.x + (Math.random() - 0.5) * spread, height, at.z + (Math.random() - 0.5) * spread);
    this.fx(new Lightning(top, new THREE.Vector3(at.x, 0.9, at.z), color, 0.22, width / 0.35));
    this.sparks(at.x, 0.9, at.z, color, 10);
  }

  /** A jagged arc of lightning from one point to another (a chain jumping between enemies). */
  arc(from: THREE.Vector3, to: THREE.Vector3, color: number, width = 1): void {
    this.fx(new Lightning(from, to, color, 0.2, width));
    this.sparks(to.x, to.y, to.z, color, 7);
  }

  /** Sparks and a little glow where lightning lands. */
  private sparks(x: number, y: number, z: number, color: number, n: number): void {
    this.fx(new Burst(x, y, z, n, { ...SPARKS, to: color }));
    this.fx(new Puff(x, y, z, color, 1.4, 0.22, 0.5));
  }

  /** Brief ground flash showing an Art's area. */
  flashShape(shape: TelegraphShape, color: number, seconds = 0.25): void {
    this.h.world().addTelegraph(shape, seconds, () => {}, color).friendly = true;
  }

  /** An expanding ring on the ground. */
  ring(x: number, z: number, color: number, radius: number, seconds = 0.3, peak = 0.9): void {
    this.h.world().addEffect(new Ring(x, z, color, radius, seconds, peak));
  }

  /** Snow swirling over a frosted circle for a while (Rabarta). */
  blizzard(x: number, z: number, radius: number, seconds: number, color: number): void {
    this.fx(new Blizzard(x, z, radius, seconds, color));
  }

  /** A pillar of light. */
  pillar(x: number, z: number, color: number, width = 0.3, seconds = 0.6, height = 3): void {
    this.h.world().addEffect(new Pillar(x, z, color, width, seconds, height));
  }

  /** Something lobbed from her hands to a spot (shells, grenades, meteors from on high). */
  lob(toX: number, toZ: number, seconds: number, color: number, size = 0.3, fromY = 1.4): void {
    const p = this.p;
    this.h.world().addEffect(new Lob(new THREE.Vector3(p.pos.x, fromY, p.pos.z), toX, toZ, seconds, color, size));
  }

  /** A straight beam from her along `yaw`. */
  tracer(yaw: number, length: number, color: number, width = 0.18, seconds = 0.18): void {
    const p = this.p;
    this.h.world().addEffect(new Tracer(p.pos.x, p.pos.z, yaw, length, color, seconds, width));
  }

  // ---------------------------------------------------------- incoming

  /** Strike or Area damage taken right now, in % less: gear, Mag, class and Farlla's defence buff, capped. */
  private damageTaken(kind: 'strike' | 'area'): number {
    return this.c.damageTaken(kind, this.p.buffs.def.t > 0 ? this.p.buffs.def.pct : 0);
  }

  /** Enemy melee strike is live this frame. Returns true once the strike is spent. */
  enemyStrike(e: Enemy): boolean {
    const p = this.p;
    if (!p.alive) return false;
    const a = e.arch;
    const d = Math.hypot(p.pos.x - e.pos.x, p.pos.z - e.pos.z) - p.radius;
    if (d > a.strikeRange * a.scale * 0.9) return false;
    const ang = Math.abs(angleDelta(e.yaw, yawTo(e.pos.x, e.pos.z, p.pos.x, p.pos.z)));
    if (ang > THREE.MathUtils.degToRad(a.strikeArcDeg) / 2) return false;

    if (p.iframes > 0) return true;
    const dmg = debug.invincible ? 0 : Math.max(1, Math.round(enemyDamage(e.atp, this.damageTaken('strike'), this.h.rng) * this.outMult(e)));
    this.hurtPlayer(dmg, e.pos.x, e.pos.z, a.strikeKnockback ?? playerCfg.knockback, e.name, e);
    if (a.strikeStatus && p.alive && this.h.rng() < (a.strikeStatusChance ?? 1)) this.applyPlayerStatus(a.strikeStatus);
    this.hellCorruption(a.strikeStatus);
    return true;
  }

  /** Falz Rifts: how much slower Corruption wears off by itself (the Abyssal modifier: 2); set when an area loads. */
  corruptWearMult = 1;
  /** Hell: chance that any landed enemy or boss hit corrupts (0 elsewhere); set when an area loads. */
  hellCorrupt = 0;

  /** Hell: every landed hit may corrupt (an attack that already corrupts doesn't roll twice). */
  private hellCorruption(status?: PlayerStatusKind): void {
    if (this.hellCorrupt > 0 && status !== 'corrupt' && this.p.alive && this.h.rng() < this.hellCorrupt) this.applyPlayerStatus('corrupt');
  }

  /**
   * Telegraphed area attack from a field enemy (Lily spit, Migium lightning, petal burst). `chip`: a ranged shot or an
   * affix side attack, which deals the chip share of the enemy's ATP in the rifts (heavy hits get all of it).
   */
  enemyArea(e: Enemy, shape: TelegraphShape, atpMult: number, knockback: number, status?: PlayerStatusKind, statusChance = 1, chip = false): boolean {
    const share = chip ? (e.arch.chipMult ?? 1) : 1;
    return this.areaHit(e.atp * atpMult * share * this.outMult(e), e.name, shape, shape.x, shape.z, knockback, status, statusChance);
  }

  /** Boss area attack. */
  bossHit(boss: Boss, shape: TelegraphShape, atpMult: number, fromX: number, fromZ: number, knockback: number, status?: PlayerStatusKind, statusChance = 1): boolean {
    return this.areaHit(boss.atp * atpMult * this.outMult(boss), boss.name, shape, fromX, fromZ, knockback, status, statusChance);
  }

  private areaHit(
    atp: number, source: string, shape: TelegraphShape, fromX: number, fromZ: number, knockback: number,
    status?: PlayerStatusKind, statusChance = 1,
  ): boolean {
    const p = this.p;
    if (!p.alive || p.iframes > 0) return false;
    if (!inShape(shape, p.pos.x, p.pos.z, p.radius)) return false;
    const dmg = debug.invincible ? 0 : Math.max(1, Math.round(enemyDamage(atp, this.damageTaken('area'), this.h.rng) * this.bulwark()));
    this.hurtPlayer(dmg, fromX, fromZ, knockback, source);
    if (status && p.alive && this.h.rng() < statusChance) this.applyPlayerStatus(status);
    this.hellCorruption(status);
    return true;
  }

  /** Bulwark (passive): damage multiplier for area attacks, boss attacks and hazards. */
  private bulwark(): number {
    return this.c.pMult('bulwark', T.bulwarkMult);
  }

  /** Damage about to reach the player's HP, after damage-taken buffs (Parry, guards, Sweep Guard, Leilla, Bracing) and a shield. */
  private soak(dmg: number): number {
    const p = this.p;
    if (dmg <= 0) return dmg;
    const mult = p.damageTakenMult() * (p.brace > 0 ? injectorCfg.braceMult : 1);
    if (mult < 1) dmg = Math.max(1, Math.round(dmg * mult));
    if (p.shield > 0) {
      const absorbed = Math.min(p.shield, dmg);
      p.shield -= absorbed;
      dmg = Math.round(dmg - absorbed);
    }
    return dmg;
  }

  /** Seconds until Last Stand can save the player again. */
  private lastStandT = 0;

  /** Last Stand (passive): a hit that would knock the player out leaves 1 HP, then recharges. DF Shield's Doom comes first. */
  private lastStand(dmg: number): number {
    const p = this.p;
    dmg = this.ufx.lethal(dmg);
    if (dmg < p.hp || p.hp <= 1 || this.lastStandT > 0 || !this.c.hasPassive('lastStand')) return dmg;
    this.lastStandT = T.lastStandCooldown;
    this.h.float(tmp.copy(p.pos).setY(2.7), 'LAST STAND', 'proc');
    sfx('tech.buff', { pitch: 0.7 });
    this.h.log('<span class="l-proc">Last Stand!</span>');
    this.h.onLastStand();
    return p.hp - 1;
  }

  /** Poison, paralyse, burn or corrupt the player. `amount`: seconds (poison, paralysis) or stacks (burn, corrupt). Returns true if it took hold. */
  applyPlayerStatus(kind: PlayerStatusKind, amount?: number): boolean {
    const p = this.p;
    if (!p.alive || debug.invincible) return false;
    fightLog.push('status', { kind, n: amount });
    const at = tmp.copy(p.pos).setY(2.6);
    const seconds = amount;
    if (kind === 'corrupt') {
      const before = p.corruption;
      const more = this.c.hasUnique('soulEater') ? 1 + this.c.uval(U.soulCorrupt) : 1;
      if (p.corrupt(Math.round((amount ?? 1) * more)) <= 0) return false;
      this.h.float(at, p.corruption > 1 ? `CORRUPTION ×${p.corruption}` : 'CORRUPTION', 'corrupt');
      sfx('status.corrupt');
      if (before === 0) this.h.log('<span class="l-bad">Corruption is eating your max HP: it fades once you stop taking it, and pylon light cleanses it faster</span>');
      return true;
    }
    if (kind === 'burn') {
      const stacks = Math.max(1, Math.round(amount ?? 2));
      const before = p.burnStacks;
      p.burnStacks = Math.min(statuses.burnMaxStacks, p.burnStacks + stacks);
      if (before === 0) p.burnDecay = 0;
      if (p.burnStacks > before) {
        this.h.float(at, p.burnStacks > 1 ? `BURN ×${p.burnStacks}` : 'BURN', 'burn');
        sfx('status.burn');
        if (before === 0) this.h.log('<span class="l-bad">You are burning: keep moving to shake it off</span>');
      }
      return true;
    }
    if (kind === 'poison') {
      const fresh = p.poison <= 0;
      const longer = this.c.hasUnique('plagueMantle') ? 1 + U.plagueSelfPoison : 1;
      p.poison = Math.max(p.poison, (seconds ?? statuses.poisonDuration) * longer);
      if (fresh) {
        this.h.float(at, 'POISON', 'poison');
        sfx('status.poison');
        this.h.log('<span class="l-bad">You are poisoned</span>');
      }
      return true;
    }
    // Paralysis resistance shortens it.
    const para = (seconds ?? statuses.paralysisDuration) * (1 - this.c.resist('resPara') / 100);
    if (!p.paralyze(para)) return false;
    this.h.float(at, 'PARALYSIS', 'para');
    sfx('status.paralysis');
    this.h.log('<span class="l-bad">You are paralysed!</span>');
    return true;
  }

  private poisonTick = 0;

  private burnTickT = 0;

  /**
   * Poison and Burn drain HP every half second (less with resistances); Burn stacks fall off over time,
   * faster while moving. Light sheds Corruption. Also ticks debuffs, zones and timers.
   */
  tickPlayerStatus(dt: number): void {
    const p = this.p;
    this.lastStandT = Math.max(0, this.lastStandT - dt);
    this.tickEffects(dt);
    this.ufx.tick(dt);
    if (!p.alive) {
      this.poisonTick = 0;
      this.burnTickT = 0;
      return;
    }
    if (p.corruption > 0) {
      // Light sheds a stack a second; otherwise, once the timer runs out, it wears off a stack at a time. The Falz
      // Halo keeps it: neither happens (a cleared room or Pioneer 2 still cleanses it).
      p.corruptTimer = Math.max(0, p.corruptTimer - dt);
      const step = this.c.hasUnique('falzHalo') ? 0 : p.inLight ? statuses.corruptLightTime : p.corruptTimer <= 0 ? statuses.corruptWearTime * this.corruptWearMult : 0;
      if (step > 0) {
        p.corruptDecay += dt;
        if (p.corruptDecay >= step) {
          p.corruptDecay -= step;
          p.corruption--;
          if (p.inLight) {
            this.h.float(tmp.copy(p.pos).setY(2.4), p.corruption > 0 ? `CLEANSED · ×${p.corruption}` : 'CLEANSED', 'heal');
            sfx('status.cleanse');
          } else if (p.corruption === 0) this.h.float(tmp.copy(p.pos).setY(2.4), 'CORRUPTION FADES', 'heal');
        }
      } else p.corruptDecay = Math.max(0, p.corruptDecay - dt);
    }
    if (p.burnStacks > 0) {
      p.burnDecay += dt * (p.moving ? statuses.burnMoveMult : 1);
      if (p.burnDecay >= statuses.burnStackTime) {
        p.burnDecay -= statuses.burnStackTime;
        p.burnStacks--;
      }
      this.burnTickT += dt;
      if (this.burnTickT >= 0.5 && p.burnStacks > 0) {
        this.burnTickT -= 0.5;
        const res = (1 - this.c.resist('resBurn') / 100) * (this.c.hasUnique('emberCore') ? 1 + this.c.uval(U.emberSelfBurn) : 1);
        const dmg = this.lastStand(this.soak(Math.max(1, Math.round(p.maxHp * statuses.burnPctPerStack * p.burnStacks * 0.5 * res))));
        p.hp = Math.max(0, p.hp - dmg);
        fightLog.push('dot', { kind: 'burn', dmg, hp: p.hp });
        this.h.float(tmp.copy(p.pos).setY(2.2), String(dmg), 'burn');
        if (!p.alive) {
          this.h.onPlayerHurt();
          return;
        }
      }
    } else {
      this.burnTickT = 0;
    }
    if (p.poison <= 0) {
      this.poisonTick = 0;
      return;
    }
    this.poisonTick += dt;
    if (this.poisonTick < 0.5) return;
    this.poisonTick -= 0.5;
    const res = 1 - this.c.resist('resPoison') / 100;
    const dmg = this.lastStand(this.soak(Math.max(1, Math.round(p.maxHp * statuses.poisonPctPerSec * 0.5 * res))));
    p.hp = Math.max(0, p.hp - dmg);
    fightLog.push('dot', { kind: 'poison', dmg, hp: p.hp });
    this.h.float(tmp.copy(p.pos).setY(2.2), String(dmg), 'poison');
    if (!p.alive) this.h.onPlayerHurt();
  }

  /** Facility hazard (lava vent, crusher, laser fence, laser wall): flat damage, less Area damage taken, with a shove. */
  hazardHurt(damage: number, fromX: number, fromZ: number, knockback = 9, source = 'Lava vent'): void {
    const p = this.p;
    if (!p.alive || p.iframes > 0) return;
    const dmg = debug.invincible ? 0 : Math.max(1, Math.round(damage * cutMult(this.damageTaken('area')) * this.bulwark()));
    this.hurtPlayer(dmg, fromX, fromZ, knockback, source);
  }

  /** A failed Hell boss mechanic: a share of max HP (Corruption's cut not counted), past armour and damage taken. */
  mechanicHurt(share: number, fromX: number, fromZ: number, knockback: number, source: string): boolean {
    const p = this.p;
    if (!p.alive || p.iframes > 0) return false;
    const dmg = debug.invincible ? 0 : Math.max(1, Math.round(p.trueMaxHp * share));
    this.hurtPlayer(dmg, fromX, fromZ, knockback, source, undefined, true);
    this.hellCorruption();
    return true;
  }

  bossTick(shape: TelegraphShape, damage: number, fromX: number, fromZ: number): void {
    const p = this.p;
    if (!p.alive || !inShape(shape, p.pos.x, p.pos.z, p.radius)) return;
    const dmg = debug.invincible ? 0 : this.lastStand(this.soak(Math.max(1, Math.round(damage * cutMult(this.damageTaken('area')) * this.bulwark() * this.ufx.coilTakenMult(true)))));
    p.hp = Math.max(0, p.hp - dmg);
    fightLog.push('tick', { dmg, hp: p.hp, x: p.pos.x, z: p.pos.z, shape });
    this.h.float(tmp.copy(p.pos).setY(2.2), String(dmg), 'burn');
    if (p.hitstun <= 0 && p.iframes <= 0) p.takeHit(0, fromX, fromZ, 3);
    if (!p.alive) this.h.onPlayerHurt();
  }

  /** `mechanic`: a failed boss mechanic's share of max HP (Rol Carapace doesn't cap it). */
  private hurtPlayer(dmg: number, fromX: number, fromZ: number, knockback: number, source: string, src?: Hittable, mechanic = false): void {
    const p = this.p;
    const raw = dmg;
    // Composure: the next hit after a perfect finisher lands softer, then it's spent.
    if (p.composureT > 0 && dmg > 0) {
      dmg = Math.max(1, Math.round(dmg * this.c.pMult('composure', T.composureMult)));
      p.composureT = 0;
    }
    // Guard Stance: the first hit while guarding sets off the counter.
    if (p.counterReady && dmg > 0) this.arts.counter();
    // Iron Will: Wrath and Thorns.
    if (p.ironWillT > 0 && dmg > 0) {
      if (this.c.artMod('ironWill', 'wrath')) {
        p.bonusSwings = Math.min(3, p.bonusSwings + 1);
        p.bonusSwingMult = 1.25;
      }
      if (src && src.alive && this.c.artMod('ironWill', 'thorns')) this.weaponHit(src, { power: basicAttack.damageMult, label: 'Thorns', streak: 0, finisher: false, art: 'ironWill', kb: 0 });
    }
    dmg = this.lastStand(this.ufx.incoming(this.soak(dmg), mechanic));
    p.takeHit(dmg, fromX, fromZ, knockback);
    fightLog.push('hurt', { src: source, raw, dmg, hp: p.hp, max: p.maxHp, x: p.pos.x, z: p.pos.z, mech: mechanic || undefined });
    sfx('player.hurt');
    this.h.float(tmp.copy(p.pos).setY(2.2), String(dmg), 'hurt');
    this.h.hitstop(feel.hitstopPlayerHurt);
    this.h.shake(feel.shakeOnHurt);
    this.h.log(`<span class="l-bad">${source} hits you for ${dmg}</span>`);
    this.h.onPlayerHurt();
  }

  /** Damage-over-time or hazard damage on an enemy (burn, poison, lava). Hazards don't charge injectors. */
  burnTick(target: Hittable, dmg: number, cls = 'burn', credit = true): void {
    if (!target.alive || target.invulnerable) return;
    const killed = this.deal(target, dmg, target.pos.x, target.pos.z, 0, 0, credit);
    this.h.float(tmp.copy(target.pos).setY(target.aimHeight + 0.6), String(dmg), cls);
    if (killed) this.h.onKill(target);
  }
}
