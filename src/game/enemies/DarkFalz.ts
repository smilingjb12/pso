import * as THREE from 'three';
import { sfx, type SfxId } from '../../audio';
import { darkFalz as cfg, pylonCfg, type HardBossScale, type Race } from '../config';
import { separateCircles } from '../collision';
import type { Hittable, StatusEffect } from '../combat/types';
import { AngelModel, FalzModel, falzPoses, HuskModel } from '../models/falz';
import { darvantModel } from '../models/ruins';
import type { Pose } from '../models/Rig';
import { Pillar, Ring, Tracer } from '../world/Effects';
import { glowDecal, glowTexture } from '../world/glow';
import type { Level, Rect } from '../world/Level';
import { inShape, type TelegraphShape } from '../world/Telegraph';
import type { Boss, BossContext } from './Boss';
import { CORRUPT_COLOR, type TelegraphHandle } from './Enemy';

// Dark Falz: the Ruins boss, on a round altar over the void, in three forms (both difficulties):
//  1. The husk hovers at the centre. Darvant flights dive along lanes across the altar (waves, each
//     warning shown as the last one fires) or close on you as a ring; after each flight the husk
//     opens (the damage window). Stand close and it pulses a corrupting shockwave.
//  2. Dark Falz breaks out and glides after you: a scythe sweep up close, Grants (pillars of light that
//     crash on you, then linger as light that cleanses Corruption), slow homing Megid orbs (two
//     Corruption stacks) and a teleport slam (a dash check).
//  3. The Angel descends to the centre: the altar splits into a light and a dark half along a line close
//     to you (the dark half fires, then the other), feather volleys, and a lance across the altar
//     through you (a dash check).
// Nightmare pairs attacks in forms 2 and 3. Pylons on the altar cleanse you and, if it stands in one,
// expose it.

type FState =
  | 'dormant' | 'intro' | 'idle' | 'lanes' | 'ring' | 'pulse' | 'open' | 'morph'
  | 'scythe' | 'cast' | 'vanish' | 'slam' | 'recover' | 'halves' | 'feathers' | 'lance' | 'dead';
type Attack = 'lanes' | 'ring' | 'pulse' | 'scythe' | 'grants' | 'megid' | 'teleport' | 'halves' | 'feathers' | 'lance';

const BOSS_DOT_CAP = 8;
const RED = 0xff4060;
const AMBER = 0xffb030;
const LIGHT = 0xffe8a0;
const SLOT = 3.6;

/** The part you hit: the husk, Dark Falz or the Angel, wherever the current form is. */
class FalzBody implements Hittable {
  readonly pos = new THREE.Vector3();
  readonly race: Race = 'dark';
  constructor(private boss: DarkFalz) {}
  get name(): string {
    return this.boss.name;
  }
  get radius(): number {
    return this.boss.bodyRadius;
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
    return this.boss.form === 1 ? 3.4 : this.boss.form === 2 ? 3.0 : 3.6;
  }
  get alive(): boolean {
    return this.boss.alive;
  }
  get invulnerable(): boolean {
    return this.boss.untouchable;
  }
  damage(amount: number): boolean {
    return this.boss.damageBody(amount);
  }
  applyStatus(effect: StatusEffect, power: number, duration: number): void {
    this.boss.applyStatus(effect, power, duration);
  }
  damageMult(): number {
    return this.boss.bodyMult();
  }
}

/** Darvants streaking from one point to another (purely visual; the telegraph does the damage). */
interface Flight {
  meshes: THREE.Group[];
  from: THREE.Vector3[];
  to: THREE.Vector3[];
  t: number;
  dur: number;
  /** Ring dive: they circle in toward the target as t runs (no straight line). */
  spiral?: { x: number; z: number; r0: number };
}

interface Orb {
  mesh: THREE.Group;
  pos: THREE.Vector3;
  life: number;
}

interface LightPool {
  x: number;
  z: number;
  t: number;
  decal: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
}

export class DarkFalz implements Boss {
  readonly race: Race = 'dark';
  readonly objects: THREE.Object3D[] = [];
  readonly maxHp: number;
  readonly injectorCharge = cfg.charge;
  hp: number;
  state: FState = 'dormant';
  stateT = 0;
  deadT = 0;
  form: 1 | 2 | 3 = 1;
  onDot: ((target: Hittable, damage: number) => void) | null = null;

  private husk = new HuskModel();
  private falz = new FalzModel();
  private angel = new AngelModel();
  private fx = new THREE.Group();
  private body: FalzBody;
  private cx: number;
  private cz: number;
  /** Dark Falz's own position in form 2 (the husk and the Angel stay at the centre). */
  private fpos = new THREE.Vector3();
  private fyaw = Math.PI;
  private time = 0;
  private flashT = 0;
  private gap = cfg.attackGap[0];
  private lastAttack: Attack | null = null;
  private announcedEnrage = false;
  private taughtOpen = false;
  private taughtLight = false;
  private pending: TelegraphHandle[] = [];
  private lit = false;
  private dotT = 0;
  private dotLeft = 0;
  private dotDps = 0;
  // Pose state.
  private open = 0;
  private charge = 0;
  private castK = 0;
  private falzPresence = 0;
  private angelPresence = 0;
  private shatter = 0;
  private lastFX = 0;
  private lastFZ = 0;
  private glideSpeed = 0;
  // Lane waves.
  private wave = 0;
  private waves = 0;
  private waveT = 0;
  private waveW = 1;
  private waveYaw = 0;
  private lanes: TelegraphShape[] = [];
  // Attacks in flight.
  private hitOnce = false;
  private slamAt: { x: number; z: number } | null = null;
  private flights: Flight[] = [];
  private orbs: Orb[] = [];
  private pools: LightPool[] = [];
  private morphFrom: 1 | 2 = 1;

  constructor(
    arena: Rect,
    /** Hard mode scaling (null on Normal). */
    readonly hard: HardBossScale | null = null,
  ) {
    this.maxHp = Math.round(cfg.hp * (hard?.hp ?? 1));
    this.hp = this.maxHp;
    this.cx = (arena.minX + arena.maxX) / 2;
    this.cz = (arena.minZ + arena.maxZ) / 2;
    this.fpos.set(this.cx, 0, this.cz);
    this.body = new FalzBody(this);
    this.body.pos.set(this.cx, 0, this.cz);
    this.husk.root.position.set(this.cx, 0, this.cz);
    this.angel.root.position.set(this.cx, 0, this.cz);
    this.falz.rig.root.position.copy(this.fpos);
    this.objects.push(this.husk.root, this.falz.rig.root, this.angel.root, this.fx);
    this.place();
  }

  // ---------------------------------------------------------------- Boss

  get name(): string {
    return this.form === 3 ? 'Dark Falz (Angel)' : 'Dark Falz';
  }
  get atp(): number {
    return cfg.atp + (this.hard?.atp ?? 0);
  }
  get ata(): number {
    return cfg.ata + (this.hard?.ata ?? 0);
  }
  get dfp(): number {
    return cfg.dfp + (this.hard?.dfp ?? 0);
  }
  get evp(): number {
    return cfg.evp + (this.hard?.evp ?? 0);
  }
  get alive(): boolean {
    return this.state !== 'dead';
  }
  get engaged(): boolean {
    return this.state !== 'dormant';
  }
  get weakPointOpen(): boolean {
    return this.state === 'open';
  }
  get enraged(): boolean {
    return this.hp / this.maxHp <= cfg.enrageAt;
  }
  get bodyRadius(): number {
    return this.form === 1 ? cfg.huskRadius : this.form === 2 ? cfg.bodyRadius : 1.8;
  }
  /** Nothing can be hurt (asleep, rising, changing form, vanished, dead). */
  get untouchable(): boolean {
    return this.state === 'dormant' || this.state === 'intro' || this.state === 'morph' || this.state === 'dead' || this.state === 'vanish' || this.state === 'slam';
  }
  get hudNote(): string {
    return this.form === 1 ? '' : this.form === 2 ? '  — FORM 2' : '  — FORM 3';
  }
  parts(): Hittable[] {
    return [this.body];
  }
  owns(h: Hittable): boolean {
    return h === this.body;
  }
  setLit(lit: boolean): void {
    this.lit = lit;
  }
  lightAt(x: number, z: number, r: number): boolean {
    return this.pools.some((p) => Math.hypot(x - p.x, z - p.z) <= cfg.grantsRadius + r);
  }

  collide(playerPos: THREE.Vector3, playerRadius: number, level: Level): void {
    separateCircles(playerPos, playerRadius, 1, this.body.pos, this.bodyRadius, 1e6);
    // The altar is round: the void is all around it.
    const dx = playerPos.x - this.cx;
    const dz = playerPos.z - this.cz;
    const d = Math.hypot(dx, dz);
    const max = cfg.altarRadius - playerRadius;
    if (d > max) {
      playerPos.x = this.cx + (dx / d) * max;
      playerPos.z = this.cz + (dz / d) * max;
    }
    level.resolveCircle(playerPos, playerRadius);
  }

  // -------------------------------------------------------------- damage

  bodyMult(): number {
    return (this.state === 'open' ? cfg.openMult : 1) * (this.lit ? pylonCfg.enemyDamage : 1);
  }

  damageBody(amount: number): boolean {
    if (!this.alive || this.untouchable) return false;
    this.flashT = 0.08;
    // A form can't be skipped: damage past its threshold is lost, and the next form takes over.
    const floor = this.form === 1 ? this.maxHp * cfg.form2At - 1 : this.form === 2 ? this.maxHp * cfg.form3At - 1 : 0;
    this.hp = Math.max(floor, this.hp - amount);
    if (this.hp <= 0) {
      this.hp = 0;
      this.die();
      return true;
    }
    return false;
  }

  applyStatus(effect: StatusEffect, power: number, duration: number): void {
    if (effect !== 'burn' && effect !== 'poison') return;
    const dps = effect === 'poison' ? Math.min(BOSS_DOT_CAP, this.maxHp * power) : Math.min(BOSS_DOT_CAP * 1.5, power);
    this.dotDps = Math.max(this.dotDps, dps);
    this.dotLeft = Math.max(this.dotLeft, duration);
  }

  private die(): void {
    this.cancelAll();
    this.enter('dead');
    this.sound('boss.die');
    for (const o of this.orbs) this.fx.remove(o.mesh);
    this.orbs = [];
    this.clearPools();
  }

  // -------------------------------------------------------------- update

  private enter(s: FState): void {
    this.state = s;
    this.stateT = 0;
  }

  private sound(id: SfxId, x = this.body.pos.x, z = this.body.pos.z): void {
    sfx(id, { x, z });
  }

  /** Windup multiplier: shorter when enraged. */
  private sm(): number {
    return this.enraged ? cfg.enrageSpeed : 1;
  }

  private warn(ctx: BossContext, shape: TelegraphShape, dur: number, color: number, onFire: () => void = () => {}, dash = false): void {
    this.pending.push(ctx.telegraph(shape, dur, onFire, color, dash));
  }

  private cancelAll(): void {
    for (const p of this.pending) p.cancel();
    this.pending = [];
  }

  update(dt: number, ctx: BossContext): void {
    this.time += dt;
    this.stateT += dt;
    this.flashT = Math.max(0, this.flashT - dt);
    this.updateFlights(dt);
    this.updatePools(dt);

    if (this.state === 'dead') {
      this.deadT += dt;
      this.angelPresence = Math.max(0, 1 - this.deadT / 2.2);
      this.falzPresence = Math.max(0, this.falzPresence - dt);
      this.place();
      return;
    }
    if (this.dotLeft > 0) {
      this.dotLeft -= dt;
      this.dotT += dt;
      if (this.dotT >= 0.5) {
        this.dotT -= 0.5;
        if (!this.untouchable) this.onDot?.(this.body, Math.max(1, Math.round(this.dotDps * 0.5)));
      }
    }
    if (!this.alive) return;
    this.updateOrbs(dt, ctx);

    // A form's threshold crossed: the next one takes over at once.
    if (this.state !== 'morph' && this.state !== 'dormant' && this.state !== 'intro') {
      if (this.form === 1 && this.hp <= this.maxHp * cfg.form2At) this.startMorph(ctx);
      else if (this.form === 2 && this.hp <= this.maxHp * cfg.form3At) this.startMorph(ctx);
    }
    if (this.enraged && !this.announcedEnrage && this.form === 3) {
      this.announcedEnrage = true;
      ctx.announce('Dark Falz is enraged!');
      this.sound('falz.ascend');
    }

    let charge = 0;
    let cast = 0;
    let open = 0;
    let glide = false;

    switch (this.state) {
      case 'dormant':
        if (ctx.playerAlive && this.stateT > 1.2) {
          this.enter('intro');
          ctx.announce('DARK FALZ');
          ctx.shake(0.4);
          this.sound('falz.awaken');
        }
        break;

      case 'intro':
        charge = Math.min(1, this.stateT / 3);
        if (this.stateT > 3) {
          this.gap = 1;
          this.enter('idle');
        }
        break;

      case 'idle':
        if (this.form === 2) glide = this.glideToward(dt, ctx);
        if (this.stateT >= this.gap) this.chooseAttack(ctx);
        break;

      // ------------------------------------------------------ form 1: husk
      case 'lanes':
        charge = 0.6;
        this.waveT += dt;
        if (this.waveT >= this.waveW) {
          this.fireLaneWave(ctx);
          this.wave++;
          if (this.wave < this.waves) this.startLaneWave(ctx);
          else this.startOpen(ctx);
        }
        break;
      case 'ring':
      case 'pulse':
        charge = Math.min(1, this.stateT);
        break; // the telegraph moves us on
      case 'open':
        open = 1;
        if (this.stateT >= cfg.openTime) {
          this.sound('falz.open');
          this.endAttack();
        }
        break;

      // ------------------------------------------------------ form 2: Falz
      case 'scythe':
        this.fyaw = turn(this.fyaw, Math.atan2(ctx.playerX - this.fpos.x, ctx.playerZ - this.fpos.z), dt * 0.8);
        break; // the telegraph moves us on
      case 'cast':
        cast = 1;
        if (this.stateT > 2.2) this.endAttack(); // fallback
        break;
      case 'vanish':
        // The slam circle is already down: it fades out, then waits hidden above it.
        this.falzPresence = Math.max(0, 1 - this.stateT / 0.45);
        if (this.stateT >= 0.45) this.enter('slam');
        break;
      case 'slam':
        this.falzPresence = 0;
        break; // the telegraph moves us on
      case 'recover':
        if (this.stateT >= (this.slamAt ? 1.4 : 0.6)) {
          this.slamAt = null;
          this.endAttack();
        }
        break;

      // ----------------------------------------------------- form 3: Angel
      case 'halves':
      case 'feathers':
      case 'lance':
        charge = 1;
        cast = this.state === 'halves' ? 1 : 0.5;
        if (this.stateT > 6) this.endAttack(); // fallback
        break;

      case 'morph':
        this.updateMorph(dt, ctx);
        break;
    }

    // Smooth the pose drivers.
    const k = Math.min(1, dt * 6);
    this.charge += (charge - this.charge) * k;
    this.castK += (cast - this.castK) * k;
    this.open += (open - this.open) * Math.min(1, dt * 5);
    const moved = Math.hypot(this.fpos.x - this.lastFX, this.fpos.z - this.lastFZ);
    this.lastFX = this.fpos.x;
    this.lastFZ = this.fpos.z;
    this.glideSpeed += ((dt > 0 && glide ? moved / dt : 0) - this.glideSpeed) * k;
    this.place(dt);
  }

  private endAttack(): void {
    this.gap = cfg.attackGap[this.form - 1] * this.sm();
    this.pending = [];
    this.enter('idle');
  }

  /** Form 2 between attacks: glide to about 4 m from you, staying on the altar. */
  private glideToward(dt: number, ctx: BossContext): boolean {
    const dx = ctx.playerX - this.fpos.x;
    const dz = ctx.playerZ - this.fpos.z;
    const d = Math.hypot(dx, dz);
    this.fyaw = turn(this.fyaw, Math.atan2(dx, dz), dt * 3);
    if (d < 4.2 || !ctx.playerAlive) return false;
    const step = Math.min(d - 4, cfg.moveSpeed * dt);
    this.fpos.x += (dx / d) * step;
    this.fpos.z += (dz / d) * step;
    this.clampOnAltar(this.fpos, 2);
    return true;
  }

  private clampOnAltar(p: THREE.Vector3, margin: number): void {
    const dx = p.x - this.cx;
    const dz = p.z - this.cz;
    const d = Math.hypot(dx, dz);
    const max = cfg.altarRadius - margin;
    if (d > max) {
      p.x = this.cx + (dx / d) * max;
      p.z = this.cz + (dz / d) * max;
    }
  }

  private chooseAttack(ctx: BossContext): void {
    let pool: Attack[];
    const rng = ctx.rng;
    if (this.form === 1) {
      const close = Math.hypot(ctx.playerX - this.cx, ctx.playerZ - this.cz) < cfg.pulseRange;
      if (close && this.lastAttack !== 'pulse' && rng() < 0.6) pool = ['pulse'];
      else pool = (['lanes', 'lanes', 'ring'] as Attack[]).filter((a) => a !== this.lastAttack);
    } else if (this.form === 2) {
      const near = Math.hypot(ctx.playerX - this.fpos.x, ctx.playerZ - this.fpos.z) < cfg.scytheRange + 0.8;
      if (near && this.lastAttack !== 'scythe' && rng() < 0.55) pool = ['scythe'];
      else pool = (['grants', 'megid', 'teleport', 'scythe'] as Attack[]).filter((a) => a !== this.lastAttack && (a !== 'scythe' || near));
    } else {
      pool = (['halves', 'halves', 'feathers', 'lance'] as Attack[]).filter((a) => a !== this.lastAttack);
    }
    const pick = pool[Math.floor(rng() * pool.length)];
    this.lastAttack = pick;
    this.hitOnce = false;
    switch (pick) {
      case 'lanes':
        return this.startLanes(ctx);
      case 'ring':
        return this.startRing(ctx);
      case 'pulse':
        return this.startPulse(ctx);
      case 'scythe':
        return this.startScythe(ctx);
      case 'grants':
        this.startGrants(ctx);
        // Nightmare pair: an orb rides along with the pillars.
        if (this.hard) this.releaseOrbs(ctx, 1);
        return;
      case 'megid':
        return this.startMegid(ctx);
      case 'teleport':
        this.sound('falz.vanish', this.fpos.x, this.fpos.z);
        return this.startSlam(ctx);
      case 'halves':
        this.startHalves(ctx);
        // Nightmare pair: feathers fly while the halves fire.
        if (this.hard) this.startFeathers(ctx, true);
        return;
      case 'feathers':
        return this.startFeathers(ctx, false);
      case 'lance':
        return this.startLance(ctx);
    }
  }

  /** Hit the player if inside `shape` (at most once per attack, unless `again`). */
  private strike(ctx: BossContext, shape: TelegraphShape, mult: number, fx: number, fz: number, kb: number, corrupt = false, again = false): void {
    if (this.hitOnce && !again) return;
    if (!ctx.playerAlive || !inShape(shape, ctx.playerX, ctx.playerZ, 0.45)) return;
    this.hitOnce = true;
    if (ctx.hitPlayer(shape, mult, fx, fz, kb) && corrupt) ctx.corruptPlayer(1);
  }

  // ------------------------------------------------------- form 1 attacks

  private startLanes(ctx: BossContext): void {
    this.wave = 0;
    this.waves = cfg.laneWaves;
    this.waveYaw = ctx.rng() * Math.PI;
    this.waveW = cfg.laneWindup * this.sm();
    this.enter('lanes');
    this.sound('falz.swarm', this.cx, this.cz);
    this.startLaneWave(ctx);
  }

  /** One wave of parallel lanes across the altar: one where you stand, the rest elsewhere. */
  private startLaneWave(ctx: BossContext): void {
    this.waveT = 0;
    this.hitOnce = false;
    const yaw = this.waveYaw + this.wave * (Math.PI / 3);
    const px = Math.cos(yaw);
    const pz = -Math.sin(yaw);
    const off = (ctx.playerX - this.cx) * px + (ctx.playerZ - this.cz) * pz;
    const slots = [-3, -2, -1, 0, 1, 2, 3];
    const mine = slots.reduce((b, s) => (Math.abs(s * SLOT - off) < Math.abs(b * SLOT - off) ? s : b), 0);
    const pick = new Set([mine]);
    while (pick.size < cfg.lanes) pick.add(slots[Math.floor(ctx.rng() * slots.length)]);
    this.lanes = [];
    for (const s of pick) {
      const o = s * SLOT;
      const half = Math.sqrt(Math.max(1, cfg.altarRadius * cfg.altarRadius - o * o)) + 0.5;
      const sx = this.cx + px * o - Math.sin(yaw) * half;
      const sz = this.cz + pz * o - Math.cos(yaw) * half;
      const shape: TelegraphShape = { kind: 'line', x: sx, z: sz, yaw, length: half * 2, width: cfg.laneWidth };
      this.lanes.push(shape);
      this.warn(ctx, shape, this.waveW, RED);
    }
  }

  private fireLaneWave(ctx: BossContext): void {
    ctx.shake(0.15);
    this.sound('falz.dive', this.cx, this.cz);
    for (const lane of this.lanes) {
      if (lane.kind !== 'line') continue;
      const dx = Math.sin(lane.yaw);
      const dz = Math.cos(lane.yaw);
      this.addFlight(4, (i) => new THREE.Vector3(lane.x - dx * 2, 5 + i * 0.6, lane.z - dz * 2), (i) => new THREE.Vector3(lane.x + dx * (lane.length + 2), 0.6 + i * 0.3, lane.z + dz * (lane.length + 2)), 0.45);
      this.strike(ctx, lane, cfg.laneAtpMult, lane.x, lane.z, 7);
    }
  }

  private startRing(ctx: BossContext): void {
    const x = ctx.playerX;
    const z = ctx.playerZ;
    const shape: TelegraphShape = { kind: 'circle', x, z, radius: cfg.ringRadius };
    const dur = cfg.ringWindup * this.sm();
    this.enter('ring');
    this.sound('falz.swarm', x, z);
    // Darvants circle in on the spot while the warning fills.
    const n = 8;
    const meshes = Array.from({ length: n }, () => darvantModel());
    for (const m of meshes) this.fx.add(m);
    this.flights.push({ meshes, from: [], to: [], t: 0, dur, spiral: { x, z, r0: 7 } });
    this.warn(ctx, shape, dur, RED, () => {
      if (this.state !== 'ring') return;
      ctx.effect(new Ring(x, z, 0xff60c0, cfg.ringRadius * 1.2, 0.4));
      ctx.shake(0.3);
      this.sound('falz.dive', x, z);
      this.strike(ctx, shape, cfg.ringAtpMult, x, z, 9);
      this.startOpen(ctx);
    });
  }

  private startPulse(ctx: BossContext): void {
    const shape: TelegraphShape = { kind: 'circle', x: this.cx, z: this.cz, radius: cfg.pulseRadius };
    this.enter('pulse');
    this.sound('falz.charge', this.cx, this.cz);
    this.warn(ctx, shape, cfg.pulseWindup * this.sm(), CORRUPT_COLOR, () => {
      if (this.state !== 'pulse') return;
      ctx.effect(new Ring(this.cx, this.cz, CORRUPT_COLOR, cfg.pulseRadius * 1.15, 0.5));
      ctx.effect(new Pillar(this.cx, this.cz, CORRUPT_COLOR, 0.35, 1.6, 8));
      ctx.shake(0.35);
      this.sound('falz.pulse', this.cx, this.cz);
      this.strike(ctx, shape, cfg.pulseAtpMult, this.cx, this.cz, 12, true);
      this.endAttack();
    });
  }

  private startOpen(ctx: BossContext): void {
    this.enter('open');
    this.sound('falz.open', this.cx, this.cz);
    if (!this.taughtOpen) {
      this.taughtOpen = true;
      ctx.announce('The husk opens: strike now!');
    }
  }

  // ------------------------------------------------------- form 2 attacks

  private startScythe(ctx: BossContext): void {
    const yaw = Math.atan2(ctx.playerX - this.fpos.x, ctx.playerZ - this.fpos.z);
    this.fyaw = yaw;
    const shape: TelegraphShape = { kind: 'cone', x: this.fpos.x, z: this.fpos.z, yaw, range: cfg.scytheRange, arcDeg: cfg.scytheArcDeg };
    this.enter('scythe');
    this.sound('falz.charge', this.fpos.x, this.fpos.z);
    this.warn(ctx, shape, cfg.scytheWindup * this.sm(), RED, () => {
      if (this.state !== 'scythe') return;
      this.sound('falz.scythe', this.fpos.x, this.fpos.z);
      this.strike(ctx, shape, cfg.scytheAtpMult, this.fpos.x, this.fpos.z, 10);
      this.enter('recover');
    });
  }

  /** Grants: pillars of light crash down (one on you), then stay as cleansing light. */
  private startGrants(ctx: BossContext): void {
    this.enter('cast');
    this.sound('falz.grants', ctx.playerX, ctx.playerZ);
    const dur = cfg.grantsWindup * this.sm();
    for (let i = 0; i < cfg.grantsCount; i++) {
      const a = ctx.rng() * Math.PI * 2;
      const d = i === 0 ? 0 : 2.6 + ctx.rng() * 2;
      const at = new THREE.Vector3(ctx.playerX + Math.sin(a) * d, 0, ctx.playerZ + Math.cos(a) * d);
      this.clampOnAltar(at, 1.5);
      const shape: TelegraphShape = { kind: 'circle', x: at.x, z: at.z, radius: cfg.grantsRadius };
      const last = i === cfg.grantsCount - 1;
      this.warn(ctx, shape, dur, AMBER, () => {
        ctx.effect(new Pillar(at.x, at.z, LIGHT, 0.45, cfg.grantsRadius * 0.7, 14));
        ctx.effect(new Ring(at.x, at.z, LIGHT, cfg.grantsRadius * 1.2, 0.4));
        this.strike(ctx, shape, cfg.grantsAtpMult, at.x, at.z, 6);
        this.addPool(at.x, at.z);
        if (last) {
          this.sound('falz.grantsHit', at.x, at.z);
          if (!this.taughtLight) {
            this.taughtLight = true;
            ctx.announce('The light lingers: it cleanses Corruption');
          }
          if (this.state === 'cast') this.enter('recover');
        }
      });
    }
  }

  private startMegid(ctx: BossContext): void {
    this.enter('cast');
    this.sound('falz.charge', this.fpos.x, this.fpos.z);
    // The orbs leave its hands after a short charge.
    this.pending.push(ctx.telegraph({ kind: 'circle', x: this.fpos.x, z: this.fpos.z, radius: 0.01 }, 0.8 * this.sm(), () => {
      if (this.state !== 'cast') return;
      this.releaseOrbs(ctx, cfg.megidOrbs);
      this.enter('recover');
    }));
  }

  private releaseOrbs(ctx: BossContext, n: number): void {
    this.sound('falz.megid', this.fpos.x, this.fpos.z);
    for (let i = 0; i < n; i++) {
      const side = n > 1 ? (i === 0 ? -1 : 1) : ctx.rng() < 0.5 ? -1 : 1;
      const rx = Math.cos(this.fyaw) * side;
      const rz = -Math.sin(this.fyaw) * side;
      const mesh = new THREE.Group();
      const core = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 10), new THREE.MeshBasicMaterial({ color: 0x1a0828 }));
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: CORRUPT_COLOR, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }));
      halo.scale.setScalar(2.4);
      mesh.add(core, halo);
      const pos = new THREE.Vector3(this.fpos.x + rx * 1.6, 0, this.fpos.z + rz * 1.6);
      mesh.position.set(pos.x, 1.4, pos.z);
      this.fx.add(mesh);
      this.orbs.push({ mesh, pos, life: cfg.megidLife });
    }
  }

  /** Megid orbs drift after you (slower than a walk); touching one hurts and adds two Corruption stacks. */
  private updateOrbs(dt: number, ctx: BossContext): void {
    for (const o of [...this.orbs]) {
      o.life -= dt;
      const dx = ctx.playerX - o.pos.x;
      const dz = ctx.playerZ - o.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      if (ctx.playerAlive) {
        o.pos.x += (dx / d) * cfg.megidSpeed * dt;
        o.pos.z += (dz / d) * cfg.megidSpeed * dt;
      }
      o.mesh.position.set(o.pos.x, 1.2 + Math.sin(this.time * 4 + o.life) * 0.15, o.pos.z);
      o.mesh.rotation.y += dt * 3;
      const touch = ctx.playerAlive && d < cfg.megidRadius + 0.45;
      if (touch || o.life <= 0) {
        if (touch) {
          const shape: TelegraphShape = { kind: 'circle', x: o.pos.x, z: o.pos.z, radius: cfg.megidRadius + 0.2 };
          if (ctx.hitPlayer(shape, cfg.megidAtpMult, o.pos.x, o.pos.z, 4)) ctx.corruptPlayer(cfg.megidStacks);
        }
        ctx.effect(new Ring(o.pos.x, o.pos.z, CORRUPT_COLOR, 1.6, 0.35));
        this.sound('falz.orbPop', o.pos.x, o.pos.z);
        this.fx.remove(o.mesh);
        this.orbs.splice(this.orbs.indexOf(o), 1);
      }
    }
  }

  /** Teleport slam (a dash check): the circle lands on you as it vanishes; it crashes down there. */
  private startSlam(ctx: BossContext): void {
    const at = new THREE.Vector3(ctx.playerX, 0, ctx.playerZ);
    this.clampOnAltar(at, 2);
    this.slamAt = { x: at.x, z: at.z };
    const shape: TelegraphShape = { kind: 'circle', x: at.x, z: at.z, radius: cfg.slamRadius };
    this.enter('vanish');
    this.sound('falz.charge', at.x, at.z);
    this.warn(ctx, shape, cfg.slamWindup * this.sm(), RED, () => {
      if (this.state !== 'slam' && this.state !== 'vanish') return;
      this.fpos.set(at.x, 0, at.z);
      this.lastFX = at.x;
      this.lastFZ = at.z;
      this.falzPresence = 1;
      ctx.effect(new Ring(at.x, at.z, 0xff6080, cfg.slamRadius * 1.15, 0.45));
      ctx.effect(new Pillar(at.x, at.z, CORRUPT_COLOR, 0.3, 1.2, 9));
      ctx.shake(0.55);
      this.sound('boss.slam', at.x, at.z);
      this.strike(ctx, shape, cfg.slamAtpMult, at.x, at.z, 14);
      this.enter('recover');
    }, true);
  }

  // ------------------------------------------------------- form 3 attacks

  /** The altar splits along a line near you; the half you are on goes dark first, then the other. */
  private startHalves(ctx: BossContext): void {
    const dx = ctx.playerX - this.cx;
    const dz = ctx.playerZ - this.cz;
    const d = Math.hypot(dx, dz);
    // Normal pointing into the dark half (yours); the dividing line runs `halfOffset` from you.
    let nx: number;
    let nz: number;
    if (d < 0.5) {
      const a = ctx.rng() * Math.PI * 2;
      nx = Math.sin(a);
      nz = Math.cos(a);
    } else {
      const ux = dx / d;
      const uz = dz / d;
      const cos = Math.min(1, cfg.halfOffset / d);
      const sin = Math.sqrt(1 - cos * cos) * (ctx.rng() < 0.5 ? -1 : 1);
      nx = ux * cos + uz * sin;
      nz = uz * cos - ux * sin;
    }
    const yaw = Math.atan2(nx, nz);
    const half = (y: number): TelegraphShape => ({ kind: 'arc', x: this.cx, z: this.cz, yaw: y, inner: 0, outer: cfg.altarRadius + 0.5, arcDeg: 180 });
    const dark = half(yaw);
    const other = half(yaw + Math.PI);
    this.enter('halves');
    this.sound('falz.halves', this.cx, this.cz);
    this.warn(ctx, dark, cfg.halfWindup * this.sm(), CORRUPT_COLOR, () => {
      if (this.state !== 'halves') return;
      this.washHalf(ctx, yaw);
      this.hitOnce = false;
      this.strike(ctx, dark, cfg.halfAtpMult, this.cx, this.cz, 6, true);
      // Then the other half: cross back over the line.
      this.warn(ctx, other, cfg.halfFlip * this.sm(), CORRUPT_COLOR, () => {
        if (this.state !== 'halves') return;
        this.washHalf(ctx, yaw + Math.PI);
        this.hitOnce = false;
        this.strike(ctx, other, cfg.halfAtpMult, this.cx, this.cz, 6, true);
        this.endAttack();
      });
    });
  }

  /** Dark energy bursting up across one half of the altar. */
  private washHalf(ctx: BossContext, yaw: number): void {
    ctx.shake(0.3);
    this.sound('falz.wash', this.cx + Math.sin(yaw) * 6, this.cz + Math.cos(yaw) * 6);
    for (let i = 0; i < 9; i++) {
      const a = yaw + (ctx.rng() - 0.5) * Math.PI * 0.95;
      const r = 2 + ctx.rng() * (cfg.altarRadius - 3);
      ctx.effect(new Pillar(this.cx + Math.sin(a) * r, this.cz + Math.cos(a) * r, CORRUPT_COLOR, 0.35, 0.5, 6));
    }
  }

  /** A fan of feather lanes from the Angel toward you. `paired`: fired alongside the halves (no state change). */
  private startFeathers(ctx: BossContext, paired: boolean): void {
    const yaw = Math.atan2(ctx.playerX - this.cx, ctx.playerZ - this.cz);
    const n = cfg.featherLanes;
    const lanes: TelegraphShape[] = [];
    for (let i = 0; i < n; i++) {
      const off = THREE.MathUtils.degToRad((i - (n - 1) / 2) * cfg.featherSpreadDeg);
      lanes.push({ kind: 'line', x: this.cx, z: this.cz, yaw: yaw + off, length: cfg.altarRadius + 1, width: cfg.featherWidth });
    }
    if (!paired) this.enter('feathers');
    this.sound('falz.charge', this.cx, this.cz);
    let hit = false;
    lanes.forEach((lane, i) => {
      this.warn(ctx, lane, cfg.featherWindup * this.sm(), RED, () => {
        if (lane.kind === 'line') ctx.effect(new Tracer(lane.x, lane.z, lane.yaw, lane.length, LIGHT, 0.25, 0.3));
        if (!hit && ctx.playerAlive && inShape(lane, ctx.playerX, ctx.playerZ, 0.45)) {
          hit = true;
          ctx.hitPlayer(lane, cfg.featherAtpMult, this.cx, this.cz, 5);
        }
        if (i === n - 1) {
          this.sound('falz.feathers', this.cx, this.cz);
          if (!paired && this.state === 'feathers') this.endAttack();
        }
      });
    });
  }

  /** The lance (a dash check): a 7 m lane across the altar through you. */
  private startLance(ctx: BossContext): void {
    const dx = ctx.playerX - this.cx;
    const dz = ctx.playerZ - this.cz;
    const d = Math.hypot(dx, dz);
    // Across the altar: perpendicular to the line from the centre to you.
    const yaw = d < 0.5 ? ctx.rng() * Math.PI * 2 : Math.atan2(dz, -dx);
    const half = Math.sqrt(Math.max(4, cfg.altarRadius * cfg.altarRadius - Math.min(d, cfg.altarRadius - 2) ** 2)) + 0.5;
    const shape: TelegraphShape = { kind: 'line', x: ctx.playerX - Math.sin(yaw) * half, z: ctx.playerZ - Math.cos(yaw) * half, yaw, length: half * 2, width: cfg.lanceWidth };
    this.enter('lance');
    this.sound('falz.charge', this.cx, this.cz);
    this.warn(ctx, shape, cfg.lanceWindup * this.sm(), RED, () => {
      if (this.state !== 'lance') return;
      if (shape.kind === 'line') {
        ctx.effect(new Tracer(shape.x, shape.z, shape.yaw, shape.length, LIGHT, 0.4, cfg.lanceWidth * 0.8));
        for (let s = 0; s <= 6; s++) ctx.effect(new Pillar(shape.x + Math.sin(yaw) * (shape.length * s) / 6, shape.z + Math.cos(yaw) * (shape.length * s) / 6, LIGHT, 0.3, 0.8, 10));
      }
      ctx.shake(0.5);
      this.sound('falz.lance', ctx.playerX, ctx.playerZ);
      this.strike(ctx, shape, cfg.lanceAtpMult, this.cx, this.cz, 14);
      this.endAttack();
    }, true);
  }

  // ------------------------------------------------------------- morphs

  private startMorph(ctx: BossContext): void {
    this.cancelAll();
    this.morphFrom = this.form === 1 ? 1 : 2;
    this.slamAt = null;
    for (const o of this.orbs) this.fx.remove(o.mesh);
    this.orbs = [];
    this.enter('morph');
    ctx.shake(0.5);
    this.sound('falz.morph', this.cx, this.cz);
    ctx.announce(this.morphFrom === 1 ? 'Dark Falz breaks free of the husk!' : 'Dark Falz ascends: the Angel descends!');
  }

  private updateMorph(dt: number, _ctx: BossContext): void {
    const t = this.stateT;
    const T = cfg.morphTime;
    if (this.morphFrom === 1) {
      this.shatter = Math.min(1, t / (T * 0.55));
      this.fpos.set(this.cx, 0, this.cz);
      this.falzPresence = Math.max(0, Math.min(1, (t - T * 0.45) / (T * 0.5)));
    } else {
      // Falz drifts back to the centre and fades as the Angel forms.
      this.fpos.x += (this.cx - this.fpos.x) * Math.min(1, dt * 3);
      this.fpos.z += (this.cz - this.fpos.z) * Math.min(1, dt * 3);
      this.falzPresence = Math.max(0, 1 - t / (T * 0.5));
      this.angelPresence = Math.max(0, Math.min(1, (t - T * 0.4) / (T * 0.55)));
    }
    if (t >= T) {
      this.form = this.morphFrom === 1 ? 2 : 3;
      if (this.form === 2) {
        this.shatter = 1;
        this.falzPresence = 1;
      } else {
        this.falzPresence = 0;
        this.angelPresence = 1;
      }
      this.lastAttack = null;
      this.gap = 0.8;
      this.enter('idle');
    }
  }

  // ------------------------------------------------------------ effects

  private addFlight(n: number, from: (i: number) => THREE.Vector3, to: (i: number) => THREE.Vector3, dur: number): void {
    const meshes = Array.from({ length: n }, () => darvantModel());
    for (const m of meshes) this.fx.add(m);
    this.flights.push({
      meshes,
      from: meshes.map((_, i) => from(i).add(new THREE.Vector3((Math.random() - 0.5) * 1.2, 0, (Math.random() - 0.5) * 1.2))),
      to: meshes.map((_, i) => to(i)),
      t: -0.05 * Math.random(),
      dur,
    });
  }

  private updateFlights(dt: number): void {
    for (const f of [...this.flights]) {
      f.t += dt;
      const k = Math.max(0, Math.min(1, f.t / f.dur));
      f.meshes.forEach((m, i) => {
        if (f.spiral) {
          const s = f.spiral;
          const a = this.time * 5 + (i / f.meshes.length) * Math.PI * 2;
          const r = s.r0 * (1 - k * k);
          m.position.set(s.x + Math.sin(a) * r, 4 - k * 3.2, s.z + Math.cos(a) * r);
          m.rotation.y = a + Math.PI / 2;
        } else {
          m.position.lerpVectors(f.from[i], f.to[i], k);
          m.lookAt(f.to[i]);
        }
        for (const c of m.children) if (c.name === 'wingL' || c.name === 'wingR') c.rotation.y = Math.sin(this.time * 30 + i) * 0.5 * (c.name === 'wingL' ? 1 : -1);
      });
      if (f.t >= f.dur + 0.05) {
        for (const m of f.meshes) this.fx.remove(m);
        this.flights.splice(this.flights.indexOf(f), 1);
      }
    }
  }

  private addPool(x: number, z: number): void {
    const decal = glowDecal(LIGHT, cfg.grantsRadius * 2.6, 0.7);
    decal.position.set(x, 0.04, z);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(cfg.grantsRadius - 0.1, cfg.grantsRadius, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: LIGHT, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    ring.position.set(x, 0.05, z);
    this.fx.add(decal, ring);
    this.pools.push({ x, z, t: cfg.grantsLight, decal, ring });
  }

  private updatePools(dt: number): void {
    for (const p of [...this.pools]) {
      p.t -= dt;
      const k = Math.max(0, p.t / cfg.grantsLight);
      p.decal.material.opacity = 0.65 * Math.min(1, k * 2) * (0.85 + Math.sin(this.time * 5 + p.x) * 0.15);
      p.ring.material.opacity = 0.7 * Math.min(1, k * 2);
      if (p.t <= 0) {
        this.fx.remove(p.decal, p.ring);
        this.pools.splice(this.pools.indexOf(p), 1);
      }
    }
  }

  private clearPools(): void {
    for (const p of this.pools) this.fx.remove(p.decal, p.ring);
    this.pools = [];
  }

  // ------------------------------------------------------------- posing

  private place(dt = 0): void {
    const flash = this.flashT > 0;
    // Husk (form 1; it rises at the intro and cracks apart in the first morph).
    const rise = this.state === 'dormant' ? 0 : this.state === 'intro' ? Math.min(1, this.stateT / 2.5) : 1;
    this.husk.root.position.set(this.cx, -4 * (1 - rise), this.cz);
    this.husk.pose({ open: this.open, charge: this.charge, time: this.time, flash: flash && this.form === 1, shatter: this.form === 1 ? this.shatter : 1 });
    // Dark Falz (form 2).
    const fr = this.falz.rig.root;
    fr.position.set(this.fpos.x, this.state === 'slam' ? 3 : 0, this.fpos.z);
    fr.rotation.y = this.fyaw;
    this.falz.update(this.time, this.state === 'cast' || this.state === 'vanish' ? 1 : this.glideSpeed > 0.3 ? 0.6 : 0.2, this.form === 2 || this.state === 'morph' || this.state === 'dead' ? this.falzPresence : 0);
    this.falz.rig.apply(this.falzPose(), dt, 10);
    this.falz.rig.setEmissive(flash && this.form === 2 ? 0xffffff : this.lit && this.form === 2 ? 0x302810 : 0, flash ? 0.8 : 1);
    this.falz.core.emissiveIntensity = 1.6 + this.charge * 2 + (this.state === 'cast' ? 1.5 : 0);
    // The Angel (form 3).
    this.angel.root.position.set(this.cx, 0, this.cz);
    this.angel.pose({ charge: this.form === 3 ? this.charge : 0, cast: this.form === 3 ? this.castK : 0, time: this.time, flash: flash && this.form === 3, presence: this.angelPresence });
    if (this.form === 2) this.body.pos.copy(this.fpos);
    else this.body.pos.set(this.cx, 0, this.cz);
  }

  private falzPose(): Pose {
    switch (this.state) {
      case 'scythe':
        return falzPoses.scytheWindup(Math.min(1, this.stateT / (cfg.scytheWindup * this.sm())));
      case 'cast':
        return falzPoses.cast(Math.min(1, this.stateT / 0.6));
      case 'recover':
        if (this.slamAt) return this.stateT < 0.6 ? falzPoses.slam() : falzPoses.idle(this.time);
        return this.lastAttack === 'scythe' ? falzPoses.scythe() : falzPoses.release();
      case 'slam':
      case 'vanish':
        return falzPoses.slam();
      case 'morph':
      case 'dead':
        return falzPoses.hurt();
      default:
        return this.glideSpeed > 0.3 ? falzPoses.glide(Math.min(1, this.glideSpeed / 2.6)) : falzPoses.idle(this.time);
    }
  }
}

/** Turn `from` toward `to` by at most `max` radians. */
function turn(from: number, to: number, max: number): number {
  let d = to - from;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return from + Math.max(-max, Math.min(max, d));
}
