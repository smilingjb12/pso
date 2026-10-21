import * as THREE from 'three';
import { galGryphon as cfg, player as playerCfg, type HardBossScale } from '../config';
import { angleDelta, separateCircles, turnToward, yawTo } from '../collision';
import type { Hittable } from '../combat/types';
import type { Level, Rect } from '../world/Level';
import { Lob, Pillar, Ring, type Effect } from '../world/Effects';
import { Lightning } from '../world/spellFx';
import type { TelegraphShape } from '../world/Telegraph';
import { GryphonModel } from '../models/gryphon';
import type { BossContext } from './Boss';
import { BossBase } from './BossBase';
import { boltSchedule, BoltMark, Cyclone, LightningRods, rodAt, rodWalk, stormLead, type Rod } from './gryphonStorm';

// Gal Gryphon, the Rift Map's Circle II pinnacle boss (DESIGN.md "Endgame: Falz Rifts" > "Gal Gryphon"; the user's
// picks from a question round, 2026-10-21). A storm griffin on Storm Peak: it swoops, beats a gale, spits thunder orbs
// and plummets on you (a dash check), and every ~22 s it rises into the clouds and calls the storm down on you. Stand
// in a lightning rod's reach and the bolts bend into the rod; a full rod arcs into the Gryphon and grounds it, weak
// point open. Below half HP the eye of the storm: cyclones, a crossing swoop (a dash check) and four-bolt storms with
// a gale pushing you off the rods.

type GryphonState =
  | 'dormant' | 'intro' | 'stalk' | 'recover'
  | 'swoopWindup' | 'swooping' | 'galeWindup' | 'orbWindup' | 'plummetRise' | 'plummetWindup' | 'plummetRest' | 'cycloneCall'
  | 'storm' | 'stormFall' | 'grounded' | 'stormLand'
  | 'dead';

type Attack = 'swoop' | 'gale' | 'orbs' | 'plummet' | 'cyclones' | 'cross';

const STORM_ALT = 15;
const BOLT_COLOR = 0x9ae8ff;
const LASH_COLOR = 0xb8f0ff;
const GALE_COLOR = 0xd8ecff;

/** A wing beat's gust: the cone flashes pale and fades. */
class GustFlash implements Effect {
  readonly object: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  private t = 0;

  constructor(x: number, z: number, yaw: number, range: number, arcDeg: number) {
    const half = THREE.MathUtils.degToRad(arcDeg) / 2;
    this.object = new THREE.Mesh(
      new THREE.CircleGeometry(range, 24, Math.PI / 2 - half, half * 2).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: GALE_COLOR, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
    );
    this.object.position.set(x, 0.1, z);
    this.object.rotation.y = yaw + Math.PI;
  }

  update(dt: number): boolean {
    this.t += dt;
    const k = Math.min(1, this.t / 0.45);
    this.object.material.opacity = 0.45 * (1 - k);
    this.object.scale.setScalar(0.85 + 0.25 * k);
    return k < 1;
  }
}

export class GalGryphon extends BossBase<GryphonState, Attack> implements Hittable {
  readonly id = 'gryphon' as const;
  readonly group = new THREE.Group();
  readonly pos = this.group.position;
  readonly radius = cfg.radius;
  yaw = 0;

  private model = new GryphonModel();
  private readonly cx: number;
  private readonly cz: number;
  private readonly rods: LightningRods;
  private readonly mark = new BoltMark();
  private readonly cyclones: Cyclone[] = [];
  private readonly cycloneGroup = new THREE.Group();

  /** Its height off the floor (the model's lift). */
  private alt = 0;
  private lastX = 0;
  private lastZ = 0;
  private walkPhase = NaN;
  private cooldown = 2;
  private phase2 = false;
  /** Seconds of fight (its clock). */
  private fightT = 0;
  // ---- the storm
  /** Storms called so far (the one on, while in one). */
  private storms = 0;
  private nextStorm = cfg.stormFirst;
  /** Seconds since it was last back on its feet after a storm. */
  private upT = Infinity;
  private stormT = 0;
  private bolts: { mark: number; fall: number }[] = [];
  private boltsDone = 0;
  private marked = -1;
  private taught = false;
  private gustT = 0;
  // ---- attacks
  private swoopYaw = 0;
  private swoopLeft = 0;
  private swoopHit = false;
  private lash: TelegraphShape | null = null;
  private plummetAt: [number, number] = [0, 0];
  private recoverFor = 1;

  constructor(room: Rect, hard: HardBossScale | null = null) {
    super(cfg, hard);
    this.cx = (room.minX + room.maxX) / 2;
    this.cz = (room.minZ + room.maxZ) / 2;
    this.pos.set(this.cx, 0, this.cz - cfg.perch);
    this.lastX = this.pos.x;
    this.lastZ = this.pos.z;
    this.group.add(this.model.group);
    this.rods = new LightningRods(this.cx, this.cz);
    this.alt = 0;
  }

  // ---------------------------------------------------------------- Boss

  get objects(): THREE.Object3D[] {
    return [this.group, this.rods.group, this.mark.group, this.cycloneGroup];
  }
  parts(): Hittable[] {
    return [this];
  }

  collide(playerPos: THREE.Vector3, playerRadius: number, level: Level): void {
    // The rods block like tree trunks.
    this.rods.sync(level.trees);
    if (this.alive && this.alt < 2.5) separateCircles(playerPos, playerRadius, 1, this.pos, this.radius, 1000);
    // The summit is round: the cloud sea is all around it.
    this.clampToSummit(playerPos, playerRadius);
    this.clampToSummit(this.pos, this.radius);
    level.resolveCircle(playerPos, playerRadius);
  }

  private clampToSummit(p: THREE.Vector3, r: number): void {
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
    if (this.state === 'storm') return `  — STORM ${Math.min(this.boltsDone, this.bolts.length)}/${this.bolts.length}`;
    if (this.state === 'grounded' || this.state === 'stormFall') return '  — GROUNDED';
    return this.phase2 ? '  — EYE OF THE STORM' : '';
  }

  // ------------------------------------------------------------ Hittable

  get aimHeight(): number {
    return this.alt + 3.4;
  }
  /** Up in the clouds (the storm, the plummet's climb) it can't be hit. */
  get invulnerable(): boolean {
    return this.untouchable || this.alt > 5;
  }
  get weakPointOpen(): boolean {
    return this.state === 'grounded';
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
    this.alt = Math.max(0, this.alt - dt * 12);
    this.animate(dt);
  }

  protected always(dt: number, ctx: BossContext): void {
    const on = this.state === 'storm';
    this.rods.update(dt, this.time, on ? this.storms : this.storms + 1, on);
    this.rods.seeThrough(dt, ctx.playerX, ctx.playerZ);
    for (const c of this.cyclones) {
      c.update(dt, this.time, ctx.playerX, ctx.playerZ, this.cx, this.cz, cfg.arenaRadius - cfg.cycloneRadius);
      if (!this.alive || c.hitT > 0 || !ctx.playerAlive) continue;
      const shape: TelegraphShape = { kind: 'circle', x: c.x, z: c.z, radius: cfg.cycloneRadius };
      if (ctx.hitPlayer(shape, cfg.cycloneAtp, c.x, c.z, cfg.cycloneKnockback)) c.hitT = cfg.cycloneHitGap;
    }
    for (const c of this.cyclones.filter((c) => c.done || !this.alive)) {
      this.cycloneGroup.remove(c.group);
      this.cyclones.splice(this.cyclones.indexOf(c), 1);
    }
  }

  protected onDeath(): void {
    this.mark.hide();
    for (const c of this.cyclones) c.life = Math.min(c.life, 0.8);
  }

  protected think(dt: number, ctx: BossContext): void {
    const dist = Math.hypot(ctx.playerX - this.pos.x, ctx.playerZ - this.pos.z);
    const toPlayer = yawTo(this.pos.x, this.pos.z, ctx.playerX, ctx.playerZ);
    if (this.engaged && this.state !== 'intro') {
      this.fightT += dt;
      this.upT += dt;
    }
    this.announceEnrage(ctx, true, 'Gal Gryphon is enraged!', 'gryphon.screech');
    if (!this.phase2 && this.hp <= this.maxHp * cfg.phase2At) {
      this.phase2 = true;
      this.escalate(ctx, 'The eye of the storm!');
      ctx.shake(0.5);
      this.sound('gryphon.screech');
    }

    switch (this.state) {
      case 'dormant':
        this.alt = 0;
        if (ctx.playerAlive && dist < 21) this.awaken(ctx, 'GAL GRYPHON', 0.45, 'gryphon.screech');
        break;

      case 'intro':
        this.yaw = turnToward(this.yaw, toPlayer, cfg.turnSpeed * dt);
        if (this.stateT > 2.6) this.enter('stalk');
        break;

      case 'stalk': {
        if (!ctx.playerAlive) break;
        this.yaw = turnToward(this.yaw, toPlayer, cfg.turnSpeed * dt);
        // It keeps its distance: closer than it likes, it backs off; far, it stalks in.
        const want = dist > cfg.keepAway + 2 ? 1 : dist < cfg.keepAway - 2 ? -0.6 : 0;
        this.pos.x += Math.sin(this.yaw) * cfg.walkSpeed * want * dt;
        this.pos.z += Math.cos(this.yaw) * cfg.walkSpeed * want * dt;
        this.cooldown -= dt;
        if (this.cooldown > 0) break;
        if (this.startStorm(ctx)) break;
        if (Math.abs(angleDelta(this.yaw, toPlayer)) < 0.5) this.chooseAttack(dist, ctx);
        break;
      }

      case 'swoopWindup':
        this.alt = Math.min(2, this.stateT * 2);
        this.updateLash(ctx);
        if (this.stateT >= cfg.swoopWindup * this.sm()) {
          this.enter('swooping');
          this.swoopHit = false;
          this.sound('gryphon.dive');
        }
        break;

      case 'swooping': {
        this.updateLash(ctx);
        const step = cfg.swoopSpeed * dt;
        this.pos.x += Math.sin(this.swoopYaw) * step;
        this.pos.z += Math.cos(this.swoopYaw) * step;
        this.yaw = this.swoopYaw;
        this.alt = 1.3;
        this.swoopLeft -= step;
        if (!this.swoopHit) {
          const shape: TelegraphShape = { kind: 'circle', x: this.pos.x, z: this.pos.z, radius: cfg.swoopWidth / 2 };
          if (ctx.hitPlayer(shape, cfg.swoopAtp, this.pos.x, this.pos.z, cfg.swoopKnockback)) this.swoopHit = true;
        }
        if (this.swoopLeft <= 0 && !this.lash) this.endAttack(0.9);
        break;
      }

      case 'galeWindup':
        if (this.stateT >= cfg.galeWindup * this.sm()) {
          const shape = this.galeShape();
          ctx.hitPlayer(shape, cfg.galeAtp, this.pos.x, this.pos.z, cfg.galeKnockback);
          ctx.effect(new GustFlash(shape.x, shape.z, this.yaw, cfg.galeRange, cfg.galeArcDeg));
          ctx.shake(0.25);
          this.sound('gryphon.flap');
          this.endAttack(1.0);
        }
        break;

      case 'orbWindup':
        if (this.stateT >= cfg.orbWindup * this.sm()) this.endAttack(0.8);
        break;

      case 'plummetRise':
        this.alt = Math.min(12, this.alt + dt * 18);
        if (this.stateT >= cfg.plummetRise) this.warnPlummet(ctx);
        break;

      case 'plummetWindup': {
        // It hangs over the circle, then drops.
        const [x, z] = this.plummetAt;
        this.pos.x += (x - this.pos.x) * Math.min(1, dt * 5);
        this.pos.z += (z - this.pos.z) * Math.min(1, dt * 5);
        break;
      }

      case 'plummetRest':
        this.alt = 0;
        if (this.stateT >= cfg.plummetRest) this.endAttack(0.6);
        break;

      case 'cycloneCall':
        if (this.stateT >= 1.0) this.endAttack(0.5);
        break;

      case 'storm':
        this.updateStorm(dt, ctx);
        break;

      case 'stormFall': {
        // A full rod's bolt knocked it out of the sky: down beside the rod.
        this.alt = Math.max(0, this.alt - dt * 30);
        if (this.alt <= 0) {
          ctx.shake(0.8);
          this.sound('boss.slam');
          ctx.effect(new Ring(this.pos.x, this.pos.z, BOLT_COLOR, 7, 0.5));
          this.sound('boss.weak');
          this.enter('grounded');
        }
        break;
      }

      case 'grounded':
        this.alt = 0;
        if (this.stateT >= cfg.groundedTime) this.backUp(1.2);
        break;

      case 'stormLand':
        // No rod filled: it comes back down in the middle.
        this.alt = Math.max(0, STORM_ALT * (1 - this.stateT / cfg.stormLand));
        if (this.stateT >= cfg.stormLand) {
          this.alt = 0;
          ctx.shake(0.35);
          this.sound('boss.slam');
          this.backUp(0.8);
        }
        break;

      case 'recover':
        this.alt = Math.max(0, this.alt - dt * 6);
        if (this.stateT >= this.recoverFor) this.enter('stalk');
        break;
    }

    this.group.rotation.y = this.yaw;
    this.animate(dt);
  }

  private endAttack(recover: number): void {
    this.recoverFor = recover;
    this.cooldown = cfg.attackGap * this.sm();
    this.enter('recover');
  }

  /** Back on its feet after a storm (grounded or not). */
  private backUp(recover: number): void {
    this.upT = 0;
    this.endAttack(recover);
  }

  // ---------------------------------------------------------- attacks

  private chooseAttack(dist: number, ctx: BossContext): void {
    const pool: Attack[] = dist < cfg.galeRange ? ['gale', 'gale', 'orbs', 'plummet', 'swoop'] : ['swoop', 'swoop', 'orbs', 'orbs', 'plummet'];
    if (this.phase2) {
      if (!this.cyclones.length) pool.push('cyclones', 'cyclones');
      pool.push('cross');
    }
    const pick = this.pickAttack(ctx, pool);
    switch (pick) {
      case 'swoop':
      case 'cross':
        this.startSwoop(ctx, pick === 'cross');
        break;
      case 'gale':
        this.enter('galeWindup');
        this.yaw = yawTo(this.pos.x, this.pos.z, ctx.playerX, ctx.playerZ);
        this.sound('gryphon.flap');
        // Enraged its windups are too short to walk out of: they get the dash cue (like the Dragon's enraged stomp).
        this.warn(ctx, this.galeShape(), cfg.galeWindup * this.sm(), GALE_COLOR, undefined, this.enraged);
        break;
      case 'orbs':
        this.startOrbs(ctx);
        break;
      case 'plummet':
        this.enter('plummetRise');
        this.sound('gryphon.flap');
        break;
      case 'cyclones':
        this.startCyclones(ctx);
        break;
    }
  }

  private galeShape(): TelegraphShape {
    return { kind: 'cone', x: this.pos.x + Math.sin(this.yaw) * 1.5, z: this.pos.z + Math.cos(this.yaw) * 1.5, yaw: this.yaw, range: cfg.galeRange, arcDeg: cfg.galeArcDeg };
  }

  /** How far it can fly from (x, z) along `yaw` before the rim (m). */
  private toRim(x: number, z: number, yaw: number, margin: number): number {
    const dx = Math.sin(yaw);
    const dz = Math.cos(yaw);
    const ox = x - this.cx;
    const oz = z - this.cz;
    const R = cfg.arenaRadius - margin;
    const b = ox * dx + oz * dz;
    const c = ox * ox + oz * oz - R * R;
    return Math.max(0, -b + Math.sqrt(Math.max(0, b * b - c)));
  }

  /** Talon Swoop (and phase 2's Crossing Swoop): a lane from it through you to the far rim; the crossing one lashes a second lane across it. */
  private startSwoop(ctx: BossContext, cross: boolean): void {
    this.enter('swoopWindup');
    this.swoopYaw = this.yaw = yawTo(this.pos.x, this.pos.z, ctx.playerX, ctx.playerZ);
    const dist = Math.hypot(ctx.playerX - this.pos.x, ctx.playerZ - this.pos.z);
    this.swoopLeft = Math.max(dist + 4, this.toRim(this.pos.x, this.pos.z, this.swoopYaw, cfg.radius));
    this.sound('gryphon.screech');
    this.warn(ctx, { kind: 'line', x: this.pos.x, z: this.pos.z, yaw: this.swoopYaw, length: this.swoopLeft, width: cfg.swoopWidth }, cfg.swoopWindup * this.sm(), undefined, undefined, this.enraged);
    this.lash = cross ? { kind: 'line', x: 0, z: 0, yaw: 0, length: 0, width: cfg.swoopWidth } : null;
    this.lashWarned = false;
  }

  private lashWarned = false;

  /** The Crossing Swoop's lash: `crossDelay` s in, a lane across the swoop's through where you stand (a dash check). */
  private updateLash(ctx: BossContext): void {
    if (!this.lash || this.lashWarned) return;
    const t = this.state === 'swoopWindup' ? this.stateT : this.stateT + cfg.swoopWindup * this.sm();
    if (t < cfg.crossDelay * this.sm()) return;
    this.lashWarned = true;
    const yaw = this.swoopYaw + (ctx.rng() < 0.5 ? 1 : -1) * (Math.PI / 2);
    // A chord of the summit through you, rim to rim.
    const back = this.toRim(ctx.playerX, ctx.playerZ, yaw + Math.PI, 0.5);
    const fwd = this.toRim(ctx.playerX, ctx.playerZ, yaw, 0.5);
    const lane: TelegraphShape = {
      kind: 'line', x: ctx.playerX - Math.sin(yaw) * back, z: ctx.playerZ - Math.cos(yaw) * back, yaw, length: back + fwd, width: cfg.swoopWidth,
    };
    this.sound('gryphon.thunder', ctx.playerX, ctx.playerZ);
    this.warn(ctx, lane, cfg.crossWindup * this.sm(), LASH_COLOR, () => {
      this.lash = null;
      if (!this.alive) return;
      ctx.hitPlayer(lane, cfg.swoopAtp, ctx.playerX, ctx.playerZ, 8);
      // A sheet of lightning down the lane.
      const n = Math.max(2, Math.round(lane.length / 6));
      for (let i = 0; i < n; i++) {
        const k = (i + 0.5) / n;
        const x = lane.x + Math.sin(yaw) * lane.length * k;
        const z = lane.z + Math.cos(yaw) * lane.length * k;
        ctx.effect(new Lightning(new THREE.Vector3(x, 14, z), new THREE.Vector3(x, 0.1, z), LASH_COLOR, 0.35, 1.6));
      }
      ctx.effect(new Lightning(new THREE.Vector3(lane.x, 0.6, lane.z), new THREE.Vector3(lane.x + Math.sin(yaw) * lane.length, 0.6, lane.z + Math.cos(yaw) * lane.length), LASH_COLOR, 0.4, 2.2, 0.5));
      ctx.shake(0.35);
      this.sound('gryphon.thunder', ctx.playerX, ctx.playerZ);
    }, true);
  }

  /** Thunder Orbs: one circle on you and the rest round it, each lobbed from its beak. */
  private startOrbs(ctx: BossContext): void {
    this.enter('orbWindup');
    this.yaw = yawTo(this.pos.x, this.pos.z, ctx.playerX, ctx.playerZ);
    this.sound('gryphon.screech');
    const spots: [number, number][] = [[ctx.playerX, ctx.playerZ]];
    const a0 = ctx.rng() * Math.PI * 2;
    for (let i = 1; i < cfg.orbCount; i++) {
      const a = a0 + ((i - 1) * Math.PI * 2) / Math.max(1, cfg.orbCount - 1) + (ctx.rng() - 0.5) * 0.8;
      spots.push([ctx.playerX + Math.sin(a) * cfg.orbSpread, ctx.playerZ + Math.cos(a) * cfg.orbSpread]);
    }
    const dur = cfg.orbWindup * this.sm();
    const beak = new THREE.Vector3(this.pos.x + Math.sin(this.yaw) * 2.5, 4.4, this.pos.z + Math.cos(this.yaw) * 2.5);
    spots.forEach(([x, z], i) => {
      const shape: TelegraphShape = { kind: 'circle', x, z, radius: cfg.orbRadius };
      ctx.effect(new Lob(beak, x, z, dur / this.tempo, BOLT_COLOR, 0.45));
      this.warn(ctx, shape, dur, BOLT_COLOR, () => {
        if (!this.alive) return;
        ctx.hitPlayer(shape, cfg.orbAtp, x, z, 6);
        ctx.effect(new Pillar(x, z, BOLT_COLOR, 0.3, 0.5, 9));
        ctx.effect(new Ring(x, z, BOLT_COLOR, cfg.orbRadius * 1.2, 0.35));
        this.sound('gryphon.thunder', x, z);
      }, this.enraged && i === 0);
    });
  }

  /** Plummet: up into the air, then a circle on you that it drops onto (a dash check). */
  private warnPlummet(ctx: BossContext): void {
    this.enter('plummetWindup');
    this.plummetAt = [ctx.playerX, ctx.playerZ];
    const shape: TelegraphShape = { kind: 'circle', x: ctx.playerX, z: ctx.playerZ, radius: cfg.plummetRadius };
    this.sound('gryphon.screech');
    // Never cut by the enrage: at ×0.8 not even a dash would clear it.
    this.warn(ctx, shape, cfg.plummetWindup, undefined, () => {
      if (!this.alive) return;
      this.pos.set(shape.x, 0, shape.z);
      this.alt = 0;
      ctx.hitPlayer(shape, cfg.plummetAtp, shape.x, shape.z, cfg.plummetKnockback);
      ctx.shake(0.6);
      ctx.effect(new Ring(shape.x, shape.z, 0xffffff, cfg.plummetRadius * 1.1, 0.45));
      this.sound('boss.slam');
      this.enter('plummetRest');
    }, true);
  }

  /** Phase 2: two tornadoes rise at the rim, well away from you. */
  private startCyclones(ctx: BossContext): void {
    this.enter('cycloneCall');
    this.sound('gryphon.cyclone');
    const rim = cfg.arenaRadius - cfg.cycloneRadius - 1;
    const pa = Math.atan2(ctx.playerX - this.cx, ctx.playerZ - this.cz);
    for (let i = 0; i < cfg.cycloneCount; i++) {
      const a = pa + Math.PI + (i - (cfg.cycloneCount - 1) / 2) * 1.6 + (ctx.rng() - 0.5) * 0.4;
      const c = new Cyclone(this.cx + Math.sin(a) * rim, this.cz + Math.cos(a) * rim, a + Math.PI);
      this.cyclones.push(c);
      this.cycloneGroup.add(c.group);
    }
  }

  // ---------------------------------------------------------- the storm

  /**
   * The storm, when it's due: not sooner than `stormAfterUp` s after the last one ended, and only when a usable rod's
   * reach is within walking reach of you in the lead (else it waits; a scorched rod can leave the rim behind it far).
   */
  private startStorm(ctx: BossContext): boolean {
    if (this.fightT < this.nextStorm || this.upT < cfg.stormAfterUp) return false;
    const storm = this.storms + 1;
    const lead = stormLead(this.tempo);
    if (rodWalk(this.rods.list, ctx.playerX, ctx.playerZ, storm) > playerCfg.moveSpeed * (lead / this.tempo - 0.35)) return false;
    this.storms = storm;
    this.nextStorm = this.fightT + cfg.stormEvery;
    this.stormT = 0;
    this.bolts = boltSchedule(this.phase2 ? cfg.bolts2 : cfg.bolts, lead);
    this.boltsDone = 0;
    this.marked = -1;
    this.gustT = 0;
    this.enter('storm');
    this.sound('gryphon.screech');
    ctx.shake(0.3);
    if (!this.taught) {
      this.taught = true;
      ctx.announce('Gal Gryphon calls the storm: stand by a rod!');
    }
    return true;
  }

  private updateStorm(dt: number, ctx: BossContext): void {
    this.stormT += dt;
    // Up into the clouds over the middle.
    this.alt = Math.min(STORM_ALT, this.alt + dt * 14);
    this.pos.x += (this.cx - this.pos.x) * Math.min(1, dt * 1.5);
    this.pos.z += (this.cz - this.pos.z) * Math.min(1, dt * 1.5);
    const px = ctx.playerX;
    const pz = ctx.playerZ;
    const next = this.bolts[this.boltsDone];
    // Phase 2: a gale off the middle from the first mark to the last bolt (walk into it to stay in a reach).
    if (this.phase2 && next && this.stormT >= this.bolts[0].mark && ctx.playerAlive) {
      const body = ctx.body();
      const dx = body.pos.x - this.cx;
      const dz = body.pos.z - this.cz;
      const d = Math.hypot(dx, dz) || 1;
      body.pos.x += (dx / d) * cfg.galePush * dt;
      body.pos.z += (dz / d) * cfg.galePush * dt;
      this.gustT -= dt;
      if (this.gustT <= 0) {
        this.gustT = 0.6;
        ctx.effect(new Ring(this.cx, this.cz, GALE_COLOR, cfg.arenaRadius, 1.1, 0.25));
      }
    }
    if (next && this.stormT >= next.mark) {
      if (this.marked !== this.boltsDone) {
        this.marked = this.boltsDone;
        this.sound('gryphon.rod', px, pz, 0);
      }
      const k = Math.min(1, (this.stormT - next.mark) / (next.fall - next.mark));
      this.mark.show(px, pz, k, !!rodAt(this.rods.list, px, pz, this.storms), this.time);
    }
    if (next && this.stormT >= next.fall) {
      this.mark.hide();
      this.boltsDone++;
      if (this.fallBolt(ctx)) return;
    }
    if (!next || this.boltsDone >= this.bolts.length) {
      if (this.stormT >= this.bolts[this.bolts.length - 1].fall + 0.3) this.enter('stormLand');
    }
  }

  /** A bolt falls: into the rod whose reach you stand in (true if that filled it: it is grounded), else onto you. */
  private fallBolt(ctx: BossContext): boolean {
    const px = ctx.playerX;
    const pz = ctx.playerZ;
    const rod = ctx.playerAlive ? rodAt(this.rods.list, px, pz, this.storms) : null;
    const sky = (x: number, z: number) => new THREE.Vector3(x + (ctx.rng() - 0.5) * 6, 24, z + (ctx.rng() - 0.5) * 6);
    if (!rod) {
      ctx.effect(new Lightning(sky(px, pz), new THREE.Vector3(px, 0.2, pz), BOLT_COLOR, 0.35, 2.4));
      ctx.effect(new Pillar(px, pz, BOLT_COLOR, 0.3, 0.6, 12));
      ctx.shake(0.45);
      this.sound('gryphon.thunder', px, pz);
      if (ctx.playerAlive) ctx.mechanicHit(cfg.boltShare, px, pz, 4, 'Storm bolt');
      return false;
    }
    const top = rod.top();
    ctx.effect(new Lightning(sky(rod.x, rod.z), top, BOLT_COLOR, 0.35, 2.4));
    ctx.effect(new Ring(rod.x, rod.z, BOLT_COLOR, 3.6, 0.4));
    rod.struck();
    ctx.shake(0.3);
    this.sound('gryphon.rod', rod.x, rod.z, rod.charge);
    if (rod.charge < cfg.rodCharge) return false;
    this.discharge(rod, ctx);
    return true;
  }

  /** A full rod arcs into the Gryphon: it crashes beside the rod, grounded, weak point open. */
  private discharge(rod: Rod, ctx: BossContext): void {
    rod.discharge(this.storms);
    this.mark.hide();
    const sky = new THREE.Vector3(this.pos.x, this.alt + 3, this.pos.z);
    ctx.effect(new Lightning(rod.top(), sky, 0xffffff, 0.6, 3.2));
    ctx.effect(new Lightning(rod.top(), sky, BOLT_COLOR, 0.5, 2));
    // Down beside the rod, on its spoke toward the middle.
    const dx = this.cx - rod.x;
    const dz = this.cz - rod.z;
    const d = Math.hypot(dx, dz) || 1;
    this.pos.set(rod.x + (dx / d) * cfg.rodLand, 0, rod.z + (dz / d) * cfg.rodLand);
    this.yaw = yawTo(this.pos.x, this.pos.z, rod.x, rod.z);
    ctx.shake(0.6);
    this.sound('gryphon.ground');
    ctx.announce('Grounded! Weak point exposed!');
    this.enter('stormFall');
  }

  // ---------------------------------------------------------- animation

  private animate(dt: number): void {
    const t = this.time;
    const moved = Math.hypot(this.pos.x - this.lastX, this.pos.z - this.lastZ);
    this.lastX = this.pos.x;
    this.lastZ = this.pos.z;
    const onFoot = this.alt < 0.2 && (this.state === 'stalk' || this.state === 'recover');
    if (moved > 0.001 && dt > 0 && onFoot) {
      const before = Number.isNaN(this.walkPhase) ? 0 : this.walkPhase;
      this.walkPhase = before + (moved / 2.6) * Math.PI * 2;
      if (Math.floor(this.walkPhase / Math.PI) !== Math.floor(before / Math.PI) && this.alive) this.sound('boss.step');
    } else this.walkPhase = NaN;

    // Folded on foot, spread and beating in the air.
    const airborne = this.alt > 0.3;
    let spread = airborne ? 1 : 0.25;
    let flap = airborne ? Math.sin(t * 7) * 0.5 : 0.1 + Math.sin(t * 1.5) * 0.05;
    let pitch = 0;
    let roll = 0;
    let neck = 0;
    let beak = 0;
    let tuck = Math.min(1, this.alt / 2);
    let veins = this.phase2 ? 0.45 : 0.2;
    let weak = 0;
    switch (this.state) {
      case 'intro':
        spread = Math.min(1, this.stateT / 0.8);
        flap = Math.sin(t * 9) * 0.6 * spread;
        neck = -0.6;
        beak = this.stateT < 1.4 ? 1 : 0.2;
        veins = 0.8;
        break;
      case 'swoopWindup': {
        const k = Math.min(1, this.stateT / (cfg.swoopWindup * this.sm()));
        spread = 1;
        flap = 0.7 * k;
        pitch = -0.2 * k;
        neck = -0.3;
        beak = 0.6;
        break;
      }
      case 'swooping':
        spread = 0.85;
        flap = -0.15;
        pitch = 0.35;
        neck = 0.25;
        beak = 1;
        tuck = 1;
        veins = 0.7;
        break;
      case 'galeWindup': {
        const k = Math.min(1, this.stateT / (cfg.galeWindup * this.sm()));
        spread = 1;
        flap = 0.9 * k;
        pitch = -0.15 * k;
        neck = -0.2;
        break;
      }
      case 'orbWindup':
        neck = -0.35 + Math.min(1, this.stateT * 2) * 0.55;
        beak = 1;
        veins = 0.9;
        spread = 0.6;
        break;
      case 'plummetRise':
      case 'plummetWindup':
        spread = 1;
        flap = Math.sin(t * 10) * 0.6;
        pitch = this.state === 'plummetWindup' ? 0.5 : -0.2;
        neck = 0.4;
        tuck = 1;
        break;
      case 'plummetRest':
        spread = 0.8;
        flap = -0.3;
        pitch = 0.2;
        neck = 0.5;
        break;
      case 'cycloneCall':
        spread = 1;
        flap = Math.sin(t * 12) * 0.8;
        neck = -0.5;
        beak = 1;
        veins = 0.7;
        break;
      case 'storm':
        spread = 1;
        flap = Math.sin(t * 5) * 0.55;
        neck = -0.4;
        beak = 0.6;
        veins = 1;
        break;
      case 'stormFall':
        spread = 0.6;
        flap = 0.8;
        pitch = 0.7;
        roll = 0.5;
        veins = 1;
        break;
      case 'grounded':
        // Sprawled beside the rod, wings dropped, veins dead, weak point aglow.
        spread = 0.75;
        flap = -0.35;
        pitch = 0.25;
        roll = 0.25 * Math.sin(t * 1.1);
        neck = 0.9;
        beak = 0.3;
        veins = 0;
        weak = 0.4 + Math.sin(t * 8) * 0.18;
        break;
      case 'stormLand':
        spread = 1;
        flap = Math.sin(t * 8) * 0.6;
        veins = 0.6;
        break;
      case 'dead':
        spread = 0.7;
        flap = -0.5;
        pitch = Math.min(0.5, this.deadT * 0.4);
        roll = Math.min(0.9, this.deadT * 0.6);
        neck = Math.min(1, this.deadT);
        beak = 0.4;
        veins = 0;
        tuck = 0;
        break;
    }
    if (this.enraged && this.alive) veins = Math.max(veins, 0.6 + 0.3 * Math.sin(t * 6));
    this.model.pose({
      lift: this.alt, pitch, roll, flap, spread, neck, beak, tuck, veins, weak,
      flash: this.flashT > 0, enraged: this.enraged, walk: this.walkPhase, time: t,
    });
  }
}
