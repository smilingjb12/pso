import * as THREE from 'three';
import { dragon as cfg, player as playerCfg, type HardBossScale } from '../config';
import { angleDelta, separateCircles, turnToward, yawTo } from '../collision';
import type { Hittable } from '../combat/types';
import type { Level } from '../world/Level';
import { Pillar } from '../world/Effects';
import { inShape, type TelegraphShape } from '../world/Telegraph';
import { DragonModel } from '../models/dragon';
import type { BossContext } from './Boss';
import { BossBase } from './BossBase';
import { CORRUPT_COLOR } from './Enemy';

/** Breath cone apex, metres ahead of the body centre. */
const BREATH_OFFSET = 3;

type DragonState =
  | 'dormant'
  | 'intro'
  | 'stalk'
  | 'stompWindup'
  | 'breathWindup'
  | 'breathing'
  | 'chargeWindup'
  | 'charging'
  | 'sinking'
  | 'underground'
  | 'eruptWindup'
  | 'stunned'
  | 'recover'
  | 'dead';

/** Hard: below this HP share the breath comes with a tail quake (a paired attack). */
const HARD_PAIR_AT = 0.5;
/** The quake lands this long after the breath starts. */
const HARD_QUAKE_DELAY = 0.5;

/**
 * Hell phase 3 triples (see startTriple): the pocket close in under a wing, or a gap in the Hellfire ring
 * beside the breath ('gap') or the charge ('lane').
 */
type Triple = 'wing' | 'gap' | 'lane';

/** A triple laid out around its one safe pocket (see planTriple). */
interface TriplePlan {
  yaw: number;
  front: TelegraphShape;
  tail: TelegraphShape;
  fire: TelegraphShape;
}

/** Hell phase 3: the glow under its hide. */
const HELL_GLOW = 0x4a1270;

export class Dragon extends BossBase<DragonState> implements Hittable {
  readonly id = 'dragon' as const;
  readonly group = new THREE.Group();
  readonly pos = this.group.position;
  readonly radius = cfg.radius;
  yaw = Math.PI;

  private model: DragonModel;
  private mound: THREE.Mesh;
  /** Live ground marker of the breath's hit area while it's firing (follows the sweep). */
  private breathArea: THREE.Group;
  private lastX = 0;
  private lastZ = 0;
  private walkPhase = NaN;
  private cooldown = 2;
  private burrowTimer = 0;
  private thresholdsHit = new Set<number>();
  private chargeLeft = 0;
  private chargeHit = false;
  private breathTick = 0;
  private eruptAt: [number, number] = [0, 0];
  /** Hell: in its third phase (triple telegraphs). */
  private hellPhase = false;
  /** Phase 3 attacks to go before the next triple. */
  private tripleDue = 0;
  /** The breath or charge under way is a triple's (its own windup, aim held). */
  private triple = false;
  /** A triple's Hellfire, warned a moment after the other two. */
  private pendingFire: TelegraphShape | null = null;
  /** A triple's charge brushed a rock or wall (it stops there). */
  private grazed = false;

  constructor(x: number, z: number, hard: HardBossScale | null = null) {
    // It takes Burn uncapped (Poison is capped like every boss's).
    super(cfg, hard, Infinity);
    this.pos.set(x, 0, z);
    this.model = new DragonModel(cfg.breathRange, cfg.breathArcDeg);
    this.group.add(this.model.group);
    this.lastX = x;
    this.lastZ = z;

    this.mound = new THREE.Mesh(
      new THREE.SphereGeometry(1.6, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x5a4a30, flatShading: true }),
    );
    this.mound.visible = false;

    // Same sector the hit test uses: apex 3m ahead of the body, facing local +Z.
    const half = THREE.MathUtils.degToRad(cfg.breathArcDeg) / 2;
    const sector = new THREE.Mesh(
      new THREE.CircleGeometry(cfg.breathRange, 24, Math.PI / 2 - half, half * 2),
      new THREE.MeshBasicMaterial({ color: 0xff8a20, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide }),
    );
    sector.rotation.x = -Math.PI / 2;
    this.breathArea = new THREE.Group();
    this.breathArea.add(sector);
    this.breathArea.position.set(0, 0.06, BREATH_OFFSET);
    this.breathArea.rotation.y = Math.PI;
    this.breathArea.visible = false;
    this.group.add(this.breathArea);
  }

  /** The dirt mound lives outside the dragon group so it can move while the dragon is hidden. */
  get moundMesh(): THREE.Mesh {
    return this.mound;
  }

  // ---------------------------------------------------------------- Boss

  get objects(): THREE.Object3D[] {
    return [this.group, this.mound];
  }
  parts(): Hittable[] {
    return [this];
  }
  collide(playerPos: THREE.Vector3, playerRadius: number, level: Level): void {
    if (!this.alive || !this.group.visible) return;
    separateCircles(playerPos, playerRadius, 1, this.pos, this.radius, 1000);
    const { x, z } = this.pos;
    level.resolveCircle(this.pos, this.radius);
    // A triple's charge that grazes a rock or wall stops there instead of sliding off its lane (maybe into the pocket).
    if (this.triple && this.state === 'charging' && (this.pos.x !== x || this.pos.z !== z)) this.grazed = true;
  }

  // ------------------------------------------------------------ Hittable

  get aimHeight(): number {
    return 3.2;
  }
  get invulnerable(): boolean {
    return this.state === 'underground' || this.state === 'eruptWindup' || this.state === 'dormant' || this.state === 'intro';
  }
  get weakPointOpen(): boolean {
    return this.state === 'stunned';
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
    this.animate(dt);
  }

  protected think(dt: number, ctx: BossContext): void {
    const dist = Math.hypot(ctx.playerX - this.pos.x, ctx.playerZ - this.pos.z);
    const toPlayer = yawTo(this.pos.x, this.pos.z, ctx.playerX, ctx.playerZ);
    const sm = this.sm();

    this.announceEnrage(ctx, true, 'The Dragon is enraged!', 'dragon.roar');

    // Hell: its third phase, triple telegraphs.
    if (this.hard?.hell && !this.hellPhase && this.hp <= this.maxHp * cfg.hellPhaseAt) {
      this.hellPhase = true;
      this.escalate(ctx, 'The Dragon burns with Hellfire!');
      ctx.shake(0.5);
      this.sound('dragon.roar');
      this.model.headMat.emissive.setHex(HELL_GLOW);
    }
    if (this.pendingFire && this.stateT >= cfg.tripleFireDelay) this.hellfire(ctx);

    switch (this.state) {
      case 'dormant':
        if (ctx.playerAlive && dist < 22) this.awaken(ctx, 'DRAGON', 0.4, 'dragon.roar');
        break;

      case 'intro':
        this.yaw = turnToward(this.yaw, toPlayer, cfg.turnSpeed * dt);
        if (this.stateT > 2.2) this.enter('stalk');
        break;

      case 'stalk': {
        if (!ctx.playerAlive) break;
        this.yaw = turnToward(this.yaw, toPlayer, cfg.turnSpeed * dt);
        if (dist > 6) {
          this.pos.x += Math.sin(this.yaw) * cfg.moveSpeed * dt;
          this.pos.z += Math.cos(this.yaw) * cfg.moveSpeed * dt;
        }
        this.cooldown -= dt;
        this.burrowTimer += dt;
        const frac = this.hp / this.maxHp;
        const threshold = [0.7, 0.4].find((t) => frac <= t && !this.thresholdsHit.has(t));
        if (this.cooldown <= 0) {
          if (threshold !== undefined || this.burrowTimer >= cfg.burrowEvery) {
            if (threshold !== undefined) this.thresholdsHit.add(threshold);
            this.burrowTimer = 0;
            this.enter('sinking');
            this.sound('dragon.burrow');
            break;
          }
          const facing = Math.abs(angleDelta(this.yaw, toPlayer)) < 0.6;
          if (!facing) break;
          // Hell phase 3: every so often a triple instead (when it leaves her a pocket she can reach).
          if (this.hellPhase && this.tripleDue <= 0 && this.startTriple(dist, ctx)) this.tripleDue = cfg.tripleEvery - 1;
          else {
            this.chooseAttack(dist, ctx);
            this.tripleDue--;
          }
        }
        break;
      }

      case 'stompWindup':
        if (this.stateT >= cfg.stompWindup * sm) {
          const shape: TelegraphShape = { kind: 'circle', x: this.pos.x, z: this.pos.z, radius: this.stompR };
          ctx.hitPlayer(shape, 1.0, this.pos.x, this.pos.z, 10);
          ctx.shake(0.45);
          this.sound('boss.slam');
          this.endAttack(1.1);
        }
        break;

      case 'breathWindup':
        // Aim is locked when the telegraph appears, so stepping out of the cone dodges it.
        if (this.stateT >= this.windup(cfg.breathWindup)) {
          this.enter('breathing');
          this.breathTick = 0;
          this.sound('dragon.breath', undefined, undefined, cfg.breathDuration);
        }
        break;

      case 'breathing': {
        // Enraged: the breath sweeps toward the player (not a triple's: its pocket must stay clear).
        if (this.enraged && !this.triple) this.yaw = turnToward(this.yaw, toPlayer, 0.7 * dt);
        this.breathTick -= dt;
        if (this.breathTick <= 0) {
          this.breathTick = 0.3;
          const hx = this.pos.x + Math.sin(this.yaw) * BREATH_OFFSET;
          const hz = this.pos.z + Math.cos(this.yaw) * BREATH_OFFSET;
          ctx.tickPlayer(
            { kind: 'cone', x: hx, z: hz, yaw: this.yaw, range: cfg.breathRange, arcDeg: cfg.breathArcDeg },
            this.flat(cfg.breathTickDamage),
            hx,
            hz,
          );
        }
        if (this.stateT >= cfg.breathDuration) this.endAttack(1.0);
        break;
      }

      case 'chargeWindup':
        if (this.stateT >= this.windup(cfg.chargeWindup)) {
          this.enter('charging');
          this.chargeLeft = cfg.chargeDistance;
          this.chargeHit = false;
          this.grazed = false;
        }
        break;

      case 'charging': {
        const step = cfg.chargeSpeed * dt;
        const nx = this.pos.x + Math.sin(this.yaw) * step;
        const nz = this.pos.z + Math.cos(this.yaw) * step;
        const blocked = this.grazed || ctx.isSolid(nx + Math.sin(this.yaw) * this.radius, nz + Math.cos(this.yaw) * this.radius);
        if (!blocked) {
          this.pos.x = nx;
          this.pos.z = nz;
        }
        this.chargeLeft -= step;
        if (!this.chargeHit) {
          const shape: TelegraphShape = { kind: 'circle', x: this.pos.x, z: this.pos.z, radius: this.radius + 0.6 };
          if (ctx.hitPlayer(shape, 1.1, this.pos.x, this.pos.z, 13)) this.chargeHit = true;
        }
        if (this.chargeLeft <= 0 || blocked) {
          if (blocked) {
            ctx.shake(0.3);
            this.sound('boss.slam');
          }
          this.endAttack(blocked ? 2.0 : 1.4); // slamming a wall leaves it open longer
        }
        break;
      }

      case 'sinking':
        if (this.stateT >= 1.0) {
          this.enter('underground');
          this.mound.visible = true;
          this.mound.position.set(this.pos.x, 0, this.pos.z);
          this.group.visible = false;
        }
        break;

      case 'underground': {
        // The mound chases the player.
        const m = this.mound.position;
        const d = Math.hypot(ctx.playerX - m.x, ctx.playerZ - m.z);
        if (d > 0.5) {
          const sp = 7 * dt;
          m.x += ((ctx.playerX - m.x) / d) * Math.min(sp, d);
          m.z += ((ctx.playerZ - m.z) / d) * Math.min(sp, d);
        }
        if (this.stateT >= cfg.burrowTravel) {
          this.eruptAt = [ctx.playerX, ctx.playerZ];
          m.set(ctx.playerX, 0, ctx.playerZ);
          this.enter('eruptWindup');
          this.sound('dragon.burrow', ctx.playerX, ctx.playerZ);
          // A dash check: centred on her and too wide to walk out of before it bursts.
          const shape: TelegraphShape = { kind: 'circle', x: ctx.playerX, z: ctx.playerZ, radius: cfg.eruptRadius };
          ctx.telegraph(shape, cfg.eruptWindup * sm, () => {
            this.pos.set(this.eruptAt[0], 0, this.eruptAt[1]);
            this.group.visible = true;
            this.mound.visible = false;
            ctx.hitPlayer(shape, 1.2, this.eruptAt[0], this.eruptAt[1], 12);
            ctx.shake(0.5);
            this.sound('dragon.erupt');
            ctx.announce('Weak point exposed!');
            this.sound('boss.weak');
            this.enter('stunned');
          }, undefined, true);
        }
        break;
      }

      case 'eruptWindup':
        break; // resolved by the telegraph callback

      case 'stunned':
        if (this.stateT >= cfg.stunDuration) this.endAttack(0.6);
        break;

      case 'recover':
        if (this.stateT >= this.recoverFor) this.enter('stalk');
        break;
    }

    this.group.rotation.y = this.yaw;
    this.animate(dt);
  }

  private recoverFor = 1;
  /** Radius of the stomp being wound up (wider when enraged). */
  private stompR: number = cfg.stompRadius;

  private endAttack(recover: number): void {
    this.triple = false;
    this.recoverFor = recover;
    this.cooldown = cfg.attackGap * this.sm();
    this.enter('recover');
  }

  private chooseAttack(dist: number, ctx: BossContext): void {
    const r = ctx.rng();
    const sm = this.sm();
    let pick: 'stomp' | 'breath' | 'charge';
    if (dist < 7) pick = r < 0.7 ? 'stomp' : 'breath';
    else if (dist < 13) pick = r < 0.6 ? 'breath' : 'charge';
    else pick = r < 0.75 ? 'charge' : 'breath';

    if (pick === 'stomp') {
      this.enter('stompWindup');
      this.sound('dragon.growl');
      // Enraged: wider and faster, a dash check when you're hugging it.
      this.stompR = this.enraged ? cfg.enragedStompRadius : cfg.stompRadius;
      ctx.telegraph({ kind: 'circle', x: this.pos.x, z: this.pos.z, radius: this.stompR }, cfg.stompWindup * sm, () => {}, undefined, this.enraged);
    } else if (pick === 'breath') {
      this.enter('breathWindup');
      this.sound('dragon.inhale');
      this.yaw = yawTo(this.pos.x, this.pos.z, ctx.playerX, ctx.playerZ);
      const hx = this.pos.x + Math.sin(this.yaw) * BREATH_OFFSET;
      const hz = this.pos.z + Math.cos(this.yaw) * BREATH_OFFSET;
      ctx.telegraph(
        { kind: 'cone', x: hx, z: hz, yaw: this.yaw, range: cfg.breathRange, arcDeg: cfg.breathArcDeg },
        cfg.breathWindup * sm,
        () => {},
        0xff8a20,
      );
      // Hard, below half HP: its tail quakes the ground around it as it breathes. Safe: the flank,
      // outside both the ring and the cone (a sidestep out of the cone, then out past the ring).
      if (this.hard && this.hp <= this.maxHp * HARD_PAIR_AT) {
        const shape: TelegraphShape = { kind: 'circle', x: this.pos.x, z: this.pos.z, radius: cfg.stompRadius };
        ctx.telegraph(shape, (cfg.breathWindup + HARD_QUAKE_DELAY) * sm, () => {
          if (!this.alive) return;
          ctx.hitPlayer(shape, 1.0, shape.x, shape.z, 10);
          ctx.shake(0.4);
          this.sound('boss.slam');
        });
      }
    } else {
      this.enter('chargeWindup');
      this.sound('dragon.growl');
      this.yaw = yawTo(this.pos.x, this.pos.z, ctx.playerX, ctx.playerZ);
      ctx.telegraph(
        { kind: 'line', x: this.pos.x, z: this.pos.z, yaw: this.yaw, length: cfg.chargeDistance, width: this.radius * 2 },
        cfg.chargeWindup * sm,
        () => {},
      );
    }
  }

  /** Windup of the breath or charge under way: a triple's is its own (the enrage doesn't cut it). */
  private windup(base: number): number {
    return this.triple ? cfg.tripleWindup : base * this.sm();
  }

  // ------------------------------------------------------- Hell triples

  /**
   * Hell phase 3: three attacks warned at once, with one safe pocket. Its breath (or a charge) covers her;
   * its tail and a Hellfire ring (violet: corrupts) cover everything else she could walk to but the pocket:
   * close in under a wing, or a gap in the ring beside the breath or the charge. False if no layout leaves
   * her a pocket she can reach in time (a normal attack then).
   */
  private startTriple(dist: number, ctx: BossContext): boolean {
    const r = ctx.rng();
    let order: Triple[];
    if (dist < cfg.tripleWingRange) order = r < 0.5 ? ['wing', 'gap', 'lane'] : r < 0.75 ? ['gap', 'wing', 'lane'] : ['lane', 'wing', 'gap'];
    else order = r < 0.5 ? ['gap', 'lane', 'wing'] : ['lane', 'gap', 'wing'];
    const side = ctx.rng() < 0.5 ? 1 : -1;
    for (const kind of order) {
      for (const s of [side, -side]) {
        const plan = this.planTriple(kind, s, ctx);
        if (!plan) continue;
        this.runTriple(kind, plan, ctx);
        return true;
      }
    }
    return false;
  }

  /**
   * Lay a triple out around its pocket (on `side` of the front), or null if the pocket is off the floor or
   * out of her walking reach. The ring reaches past anywhere she could walk before it lands, so the pocket
   * is the one way out.
   */
  private planTriple(kind: Triple, side: number, ctx: BossContext): TriplePlan | null {
    const { x, z } = this.pos;
    const px = ctx.playerX;
    const pz = ctx.playerZ;
    const pr = playerCfg.radius;
    const yaw = yawTo(x, z, px, pz);
    const at = (r: number, a: number): [number, number] => [x + Math.sin(a) * r, z + Math.cos(a) * r];
    const outer = Math.hypot(px - x, pz - z) + playerCfg.moveSpeed * (cfg.tripleFireDelay + cfg.tripleFireWindup) + 2;

    let front: TelegraphShape;
    // What the front really hits (a charging body is a little wider than its lane).
    let frontHit: TelegraphShape;
    if (kind === 'lane') {
      front = { kind: 'line', x, z, yaw, length: cfg.chargeDistance, width: this.radius * 2 };
      frontHit = { ...front, width: (this.radius + 0.6) * 2 };
    } else {
      const [hx, hz] = at(BREATH_OFFSET, yaw);
      front = frontHit = { kind: 'cone', x: hx, z: hz, yaw, range: cfg.breathRange, arcDeg: cfg.breathArcDeg };
    }

    // The pocket: radii [r0, r1] by `half` either side of the direction `a0`.
    let tail: TelegraphShape;
    let fire: TelegraphShape;
    let a0: number;
    let half: number;
    let r0: number;
    let r1: number;
    if (kind === 'wing') {
      // Its tail sweeps all round it but under one wing; the Hellfire covers everything farther out.
      a0 = yaw + side * THREE.MathUtils.degToRad(cfg.tripleWingAngle);
      half = THREE.MathUtils.degToRad(cfg.tripleWingDeg) / 2;
      tail = { kind: 'arc', x, z, yaw: a0 + Math.PI, inner: 0, outer: cfg.tripleWingR, arcDeg: 360 - cfg.tripleWingDeg };
      fire = { kind: 'arc', x, z, yaw, inner: cfg.tripleWingR, outer, arcDeg: 360 };
      r0 = this.radius + pr;
      r1 = cfg.tripleWingR;
    } else {
      // Its tail quakes the ground around it; the Hellfire ring beyond has one gap, at her range, turned
      // just far enough off the front to be clear of it.
      tail = { kind: 'circle', x, z, radius: cfg.stompRadius };
      const rg = Math.max(Math.hypot(px - x, pz - z), cfg.stompRadius + 2);
      half = cfg.tripleGap / rg / 2;
      a0 = NaN;
      for (let deg = 0; deg <= 120 && Number.isNaN(a0); deg += 2) {
        const a = yaw + side * THREE.MathUtils.degToRad(deg);
        if (!inShape(frontHit, ...at(rg, a - side * half), pr)) a0 = a;
      }
      if (Number.isNaN(a0)) return null;
      fire = { kind: 'arc', x, z, yaw: a0 + Math.PI, inner: cfg.stompRadius, outer, arcDeg: 360 - THREE.MathUtils.radToDeg(half * 2) };
      r0 = cfg.stompRadius;
      r1 = outer;
    }

    // Her nearest way in: the closest point of the pocket clear of all three (with a margin), on open floor.
    const shapes = [frontHit, tail, fire];
    let best = Infinity;
    for (let r = r0 + 0.25; r < r1; r += 0.5) {
      for (let i = -6; i <= 6; i++) {
        const [sx, sz] = at(r, a0 + (half * i) / 6);
        const d = Math.hypot(sx - px, sz - pz);
        if (d >= best || shapes.some((s) => inShape(s, sx, sz, pr + 0.4)) || !this.open(ctx, sx, sz)) continue;
        best = d;
      }
    }
    if (best > playerCfg.moveSpeed * (cfg.tripleWindup - cfg.tripleReact)) return null;
    return { yaw, front, tail, fire };
  }

  /** Open floor a body's width around. */
  private open(ctx: BossContext, x: number, z: number): boolean {
    return !ctx.isSolid(x, z) && !ctx.isSolid(x + 1, z) && !ctx.isSolid(x - 1, z) && !ctx.isSolid(x, z + 1) && !ctx.isSolid(x, z - 1);
  }

  private runTriple(kind: Triple, plan: TriplePlan, ctx: BossContext): void {
    const { front, tail } = plan;
    this.triple = true;
    this.yaw = plan.yaw;
    if (kind === 'lane') {
      this.enter('chargeWindup');
      this.sound('dragon.growl');
      this.warn(ctx, front, cfg.tripleWindup, undefined);
    } else {
      this.enter('breathWindup');
      this.sound('dragon.inhale');
      this.warn(ctx, front, cfg.tripleWindup, 0xff8a20);
    }
    // Beside a charge the tail slams down as it launches; beside the breath a moment after the fire starts.
    this.warn(ctx, tail, cfg.tripleWindup + (kind === 'lane' ? 0 : cfg.tripleTailDelay), undefined, () => {
      ctx.hitPlayer(tail, 1.0, tail.x, tail.z, 10);
      ctx.shake(0.4);
      this.sound('boss.slam', tail.x, tail.z);
    });
    this.pendingFire = plan.fire;
  }

  /** The triple's Hellfire, warned a moment after the other two. */
  private hellfire(ctx: BossContext): void {
    const shape = this.pendingFire!;
    this.pendingFire = null;
    if (shape.kind !== 'arc') return;
    this.sound('lava.warn', ctx.playerX, ctx.playerZ);
    this.warn(ctx, shape, cfg.tripleFireWindup, CORRUPT_COLOR, () => {
      ctx.hitPlayer(shape, 1.0, shape.x, shape.z, 8, 'corrupt');
      ctx.shake(0.35);
      this.sound('lava.erupt', ctx.playerX, ctx.playerZ);
      // Columns of it along the ring (none in the gap).
      for (const r of [shape.inner + 2, shape.inner + 6]) {
        const n = Math.round(r * 0.9);
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          const fx = shape.x + Math.sin(a) * r;
          const fz = shape.z + Math.cos(a) * r;
          if (inShape(shape, fx, fz, 0)) ctx.effect(new Pillar(fx, fz, CORRUPT_COLOR, 0.4, 0.35, 7));
        }
      }
    });
  }

  // ---------------------------------------------------------- animation

  private animate(dt: number): void {
    const t = this.time;
    let neckPitch = 0;
    let bodyLift = 0;
    let bodyPitch = 0;
    let flame = 0;
    let jaw = 0;
    let wingFlap = 0.25 + Math.sin(t * 2) * 0.12;
    let headColor = 0x9a2c1c;
    let weak = 0;
    const sm = this.sm();

    // Legs cycle while the body actually moves.
    const moved = Math.hypot(this.pos.x - this.lastX, this.pos.z - this.lastZ);
    this.lastX = this.pos.x;
    this.lastZ = this.pos.z;
    if (moved > 0.001 && dt > 0) {
      const before = Number.isNaN(this.walkPhase) ? 0 : this.walkPhase;
      this.walkPhase = before + (moved / 3) * Math.PI * 2;
      // A footfall every half stride.
      if (Math.floor(this.walkPhase / Math.PI) !== Math.floor(before / Math.PI) && this.group.visible && this.alive) this.sound('boss.step');
    } else this.walkPhase = NaN;

    switch (this.state) {
      case 'intro':
        neckPitch = -0.7;
        jaw = 1;
        wingFlap = 0.5 + Math.sin(t * 10) * 0.5;
        break;
      case 'stompWindup': {
        const k = Math.min(1, this.stateT / (cfg.stompWindup * sm));
        bodyPitch = -0.35 * k;
        bodyLift = 1.2 * k;
        wingFlap = 0.3 + Math.sin(t * 12) * 0.5 * k;
        break;
      }
      case 'breathWindup': {
        const k = Math.min(1, this.stateT / this.windup(cfg.breathWindup));
        neckPitch = -0.5 * k;
        jaw = 0.4 * k;
        headColor = 0xff6020;
        break;
      }
      case 'breathing':
        neckPitch = 0.15;
        jaw = 1;
        flame = 0.6 + Math.random() * 0.3;
        headColor = 0xff8030;
        break;
      case 'chargeWindup':
        neckPitch = 0.3;
        bodyPitch = 0.1;
        jaw = 0.5;
        break;
      case 'charging':
        neckPitch = 0.35;
        bodyPitch = 0.15;
        wingFlap = Math.sin(t * 14) * 0.4;
        break;
      case 'sinking':
        bodyLift = -this.stateT * 5;
        break;
      case 'stunned':
        neckPitch = 0.75; // head on the ground
        bodyPitch = 0.15;
        weak = 0.45 + Math.sin(t * 8) * 0.2;
        headColor = 0xffe080;
        jaw = 0.3;
        break;
      case 'dead':
        bodyLift = -Math.min(2.2, this.deadT * 1.2);
        bodyPitch = Math.min(0.4, this.deadT * 0.3);
        neckPitch = Math.min(0.9, this.deadT);
        wingFlap = -0.3;
        jaw = 0.6;
        break;
    }

    this.breathArea.visible = this.state === 'breathing';
    this.model.pose({
      neckPitch, jaw, bodyLift, bodyPitch, wingFlap, flame, weak, headColor,
      flash: this.flashT > 0, enraged: this.enraged, walk: this.walkPhase, time: t,
    });
    if (this.hellPhase && this.alive && this.flashT <= 0) this.model.bodyMat.emissive.setHex(HELL_GLOW).multiplyScalar(0.75 + 0.25 * Math.sin(t * 3));
    if (this.mound.visible) this.mound.rotation.y += dt * 4;
  }
}
