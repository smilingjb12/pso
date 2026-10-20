import * as THREE from 'three';
import { darkFalz as cfg, pylonCfg, type HardBossScale } from '../config';
import { separateCircles } from '../collision';
import type { Hittable } from '../combat/types';
import { areas } from '../data/areas';
import { AngelModel, FalzModel, falzPoses, HuskModel } from '../models/falz';
import { darvantModel } from '../models/ruins';
import type { Pose } from '../models/Rig';
import { Pillar, Ring, Tracer } from '../world/Effects';
import { glowDecal, glowSprite, glowTexture } from '../world/glow';
import { TILE, type Level, type Rect } from '../world/Level';
import { inShape, type TelegraphShape } from '../world/Telegraph';
import type { BossContext } from './Boss';
import { BossBase, BossPart } from './BossBase';
import { CORRUPT_COLOR } from './Enemy';

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
// Nightmare pairs attacks in forms 2 and 3. On Hell every other form 3 attack is a triple: Eclipse (Grants,
// the whole altar going dark and feathers; only the light you can reach is safe) or Judgement (your half
// going dark, a lance and a wing of feathers; only the quarter past the lance is safe). Pylons on the altar
// cleanse you and, if it stands in one, expose it.
// Hell also runs two clocks of its own beside the attacks. The Dark Tide (form 3): motes rise at the rim and drift
// to the Angel to heal it; walk through one to absorb it (+1 Corruption) or let light dissolve it. Doom (forms 2
// and 3): a mark on you that bursts unless its count ends in light; there is always some within reach (form 2 casts
// it with Grants, the Angel only while a pylon you can reach is ready).

type FState =
  | 'dormant' | 'intro' | 'idle' | 'lanes' | 'ring' | 'pulse' | 'open' | 'morph'
  | 'scythe' | 'cast' | 'vanish' | 'slam' | 'recover' | 'halves' | 'feathers' | 'lance' | 'triple' | 'doom' | 'dead';
type Attack =
  | 'lanes' | 'ring' | 'pulse' | 'scythe' | 'grants' | 'megid' | 'teleport' | 'halves' | 'feathers' | 'lance'
  | 'eclipse' | 'judgement' | 'doom';

const RED = 0xff4060;
const AMBER = 0xffb030;
const LIGHT = 0xffe8a0;
const SLOT = 3.6;
/** Doom's sigil (violet), and the bright rim round a Dark Tide mote. */
const DOOM = 0xb050ff;
const MOTE_RIM = 0xe8b8ff;
/** Seconds a mote takes to rise out of the rim before it sets off. */
const MOTE_RISE = 0.7;
/** Spots round a pylon where its light is tested (one our own light doesn't cover). */
const WATCH_SPOTS: [number, number][] = [[0, 0], [3, 0], [-3, 0], [0, 3], [0, -3]];
const tmpColor = new THREE.Color();
const lightColor = new THREE.Color(LIGHT);

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
  /** Doom's Grants: it stays lit while the Doom runs. */
  hold: boolean;
  decal: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
}

/** A Dark Tide mote (Hell, form 3) drifting from the rim to heal the Angel. */
interface Mote {
  group: THREE.Group;
  /** Its glow on the floor, and the sprites trailing behind it. */
  decal: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  trail: THREE.Sprite[];
  x: number;
  z: number;
  /** Seconds since it appeared (it rises for MOTE_RISE s, then drifts). */
  t: number;
}

/** Doom (Hell, forms 2 and 3): the mark on the player and its count. */
interface Doom {
  /** Real seconds left, and the whole count. */
  left: number;
  total: number;
  /** 0..1: how far its colour has turned from violet to light (you stand in light). */
  glow: number;
  /** The sigil on the floor under you, and the mark over your head. */
  floor: THREE.Group;
  mark: THREE.Group;
  /** The ring that shrinks as the count runs out, and the turning star. */
  count: THREE.Mesh;
  star: THREE.Group;
  /** Its materials and their full opacities (recoloured together). */
  mats: [THREE.MeshBasicMaterial | THREE.SpriteMaterial, number][];
}

/** One of the altar's pylons as Dark Falz sees it: it watches their light (lit for how long, then the recharge). */
interface PylonWatch {
  x: number;
  z: number;
  lit: boolean;
  /** Real seconds it has been lit, and until it can be lit again once dark. */
  litFor: number;
  rest: number;
}

export class DarkFalz extends BossBase<FState, Attack> {
  readonly id = 'falz' as const;
  readonly objects: THREE.Object3D[] = [];
  form: 1 | 2 | 3 = 1;

  private husk = new HuskModel();
  private falz = new FalzModel();
  private angel = new AngelModel();
  private fx = new THREE.Group();
  /** The part you hit: the husk, Dark Falz or the Angel, wherever the current form is. */
  private body: BossPart;
  private cx: number;
  private cz: number;
  /** Dark Falz's own position in form 2 (the husk and the Angel stay at the centre). */
  private fpos = new THREE.Vector3();
  private fyaw = Math.PI;
  private taughtOpen = false;
  private taughtLight = false;
  private taughtEclipse = false;
  private lit = false;
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
  /** Form 3 attacks so far (Hell: every `tripleEvery`-th is a triple) and the last triple. */
  private f3Attacks = 0;
  private lastTriple: Attack | null = null;
  // Hell: the Dark Tide (form 3) and Doom (forms 2 and 3), each on its own clock.
  private motes: Mote[] = [];
  private tideT = 0;
  private taughtTide = false;
  /** Seconds the boss bar still says a mote healed it. */
  private healedT = 0;
  private doom: Doom | null = null;
  private doomT = 0;
  private taughtDoom = false;
  /** The altar's four pylons (the arena's own, as the world places them). */
  private watch: PylonWatch[];

  constructor(arena: Rect, hard: HardBossScale | null = null) {
    super(cfg, hard);
    this.cx = (arena.minX + arena.maxX) / 2;
    this.cz = (arena.minZ + arena.maxZ) / 2;
    this.watch = (areas.falz.rooms[0].pylons ?? []).map(([tx, tz]) => ({ x: arena.minX + tx * TILE, z: arena.minZ + tz * TILE, lit: false, litFor: 0, rest: 0 }));
    this.fpos.set(this.cx, 0, this.cz);
    this.body = new BossPart(this, () => this.bodyRadius, () => (this.form === 1 ? 3.4 : this.form === 2 ? 3.0 : 3.6));
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
  /** Hell: the Angel runs slower (`angelTempo`): its attacks, telegraphs, triples, tide and Doom alike. */
  override get tempo(): number {
    return super.tempo * (this.hard?.hell && this.form === 3 ? cfg.angelTempo : 1);
  }
  get weakPointOpen(): boolean {
    return this.state === 'open';
  }
  get bodyRadius(): number {
    return this.form === 1 ? cfg.huskRadius : this.form === 2 ? cfg.bodyRadius : 1.8;
  }
  /** Nothing can be hurt (asleep, rising, changing form, vanished, dead). */
  get untouchable(): boolean {
    return this.state === 'dormant' || this.state === 'intro' || this.state === 'morph' || this.state === 'dead' || this.state === 'vanish' || this.state === 'slam';
  }
  get hudNote(): string {
    if (this.form === 1) return '';
    let note = this.form === 2 ? '  — FORM 2' : '  — FORM 3';
    // Hell: the motes on their way (and a moment's notice when one heals it), and Doom's count.
    if (this.motes.length) note += ` · DARK TIDE ×${this.motes.length}`;
    if (this.healedT > 0) note += ' · HEALED';
    if (this.doom) note += ` · DOOM ${Math.max(1, Math.ceil(this.doom.left))}`;
    return note;
  }
  parts(): Hittable[] {
    return [this.body];
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

  partMult(): number {
    return (this.state === 'open' ? cfg.openMult : 1) * (this.lit ? pylonCfg.enemyDamage : 1);
  }

  damagePart(p: BossPart, amount: number): boolean {
    if (!this.alive || this.partInvulnerable(p)) return false;
    // A form can't be skipped: damage past its threshold is lost, and the next form takes over.
    const floor = this.form === 1 ? this.maxHp * cfg.form2At - 1 : this.form === 2 ? this.maxHp * cfg.form3At - 1 : 0;
    return this.loseHp(amount, floor);
  }

  protected onDeath(): void {
    for (const o of this.orbs) this.fx.remove(o.mesh);
    this.orbs = [];
    this.clearPools();
    for (const m of [...this.motes]) this.removeMote(m);
    this.clearDoom();
  }

  // -------------------------------------------------------------- update

  protected get anchor(): THREE.Vector3 {
    return this.body.pos;
  }

  protected always(dt: number, ctx: BossContext): void {
    this.updateFlights(dt);
    this.updatePools(dt);
    if (this.hard?.hell && this.alive) this.watchPylons(dt / this.tempo, ctx);
  }

  protected whileDead(dt: number): void {
    this.angelPresence = Math.max(0, 1 - this.deadT / 2.2);
    this.falzPresence = Math.max(0, this.falzPresence - dt);
    this.place();
  }

  protected think(dt: number, ctx: BossContext): void {
    this.updateOrbs(dt, ctx);
    if (this.hard?.hell) this.updateHell(dt, ctx);

    // A form's threshold crossed: the next one takes over at once.
    if (this.state !== 'morph' && this.state !== 'dormant' && this.state !== 'intro') {
      if (this.form === 1 && this.hp <= this.maxHp * cfg.form2At) this.startMorph(ctx);
      else if (this.form === 2 && this.hp <= this.maxHp * cfg.form3At) this.startMorph(ctx);
    }
    this.announceEnrage(ctx, this.form === 3, 'Dark Falz is enraged!', 'falz.ascend');

    let charge = 0;
    let cast = 0;
    let open = 0;
    let glide = false;

    switch (this.state) {
      case 'dormant':
        if (ctx.playerAlive && this.stateT > 1.2) this.awaken(ctx, 'DARK FALZ', 0.4, 'falz.awaken');
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
      case 'triple':
        charge = 1;
        cast = this.state === 'halves' || this.state === 'triple' ? 1 : 0.5;
        if (this.stateT > 6) this.endAttack(); // fallback
        break;
      case 'doom':
        // Hell: the Angel lays Doom on you.
        charge = 1;
        cast = 1;
        if (this.stateT >= cfg.doomCast) this.endAttack();
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
    this.tele.forget();
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
    // Hell: Doom takes the attack's turn when its clock runs out (form 2 with Grants; the Angel once a pylon is in reach).
    if (this.hard?.hell && this.form > 1 && !this.doom && this.doomT <= 0) {
      // Not on you while you stand in light: it would be cleansed the moment it landed.
      const inLight = ctx.lightAt(ctx.playerX, ctx.playerZ, 0.45);
      if (!inLight && (this.form === 2 || this.doomLight(ctx, this.doomCount()))) return this.startDoom(ctx);
      this.doomT = 2; // in light, or no pylon you could reach: look again in a moment
    }
    if (this.doom) return this.chooseDuringDoom(ctx);
    let pick: Attack;
    if (this.form === 1) {
      const close = Math.hypot(ctx.playerX - this.cx, ctx.playerZ - this.cz) < cfg.pulseRange;
      // (A forced pick still draws from the rng, like any other.)
      if (close && this.lastAttack !== 'pulse' && ctx.rng() < 0.6) pick = this.pickAttack(ctx, ['pulse']);
      else pick = this.pickAttack(ctx, ['lanes', 'lanes', 'ring']);
    } else if (this.form === 2) {
      const near = Math.hypot(ctx.playerX - this.fpos.x, ctx.playerZ - this.fpos.z) < cfg.scytheRange + 0.8;
      if (near && this.lastAttack !== 'scythe' && ctx.rng() < 0.55) pick = this.pickAttack(ctx, ['scythe']);
      else pick = this.pickAttack(ctx, ['grants', 'megid', 'teleport', 'scythe'], (a) => a !== 'scythe' || near);
    } else {
      this.f3Attacks++;
      // Hell: every so often a triple, Eclipse and Judgement taking turns.
      if (this.hard?.hell && this.f3Attacks % cfg.tripleEvery === 0) {
        pick = this.pickAttack(ctx, ['eclipse', 'judgement'], (a) => a !== this.lastTriple);
        this.lastTriple = pick;
      } else pick = this.pickAttack(ctx, ['halves', 'halves', 'feathers', 'lance']);
    }
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
      case 'eclipse':
        return this.startEclipse(ctx);
      case 'judgement':
        return this.startJudgement(ctx);
    }
  }

  /**
   * A Doom running: only attacks you can sidestep on your way to the light (the scythe when you are close, feathers),
   * and only if they land `doomClear` s before its end; otherwise it waits (no slam, lance or triple until it's over).
   */
  private chooseDuringDoom(ctx: BossContext): void {
    const room = this.doom!.left - cfg.doomClear;
    const fits = (windup: number) => (windup * this.sm()) / this.tempo <= room;
    this.hitOnce = false;
    if (this.form === 2) {
      const near = Math.hypot(ctx.playerX - this.fpos.x, ctx.playerZ - this.fpos.z) < cfg.scytheRange + 0.8;
      if (near && fits(cfg.scytheWindup)) {
        this.lastAttack = 'scythe';
        return this.startScythe(ctx);
      }
    } else if (fits(cfg.featherWindup)) {
      this.lastAttack = 'feathers';
      return this.startFeathers(ctx, false);
    }
    this.gap = this.stateT + 0.25;
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
    // Never in neighbouring slots: their gap (SLOT - laneWidth = 1 m) looked safe, but a body (0.9 m) fits in it only
    // dead centre, so standing "between the lines" got hit (2026-10-17, the user). The narrowest gap is now 4.6 m.
    while (pick.size < cfg.lanes) {
      const free = slots.filter((s) => [...pick].every((q) => Math.abs(q - s) >= 2));
      if (!free.length) break;
      pick.add(free[Math.floor(ctx.rng() * free.length)]);
    }
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

  /** Grants: pillars of light crash down (one on you), then stay as cleansing light. `doom`: Doom's, held until it ends. */
  private startGrants(ctx: BossContext, doom = false): void {
    this.enter('cast');
    this.sound('falz.grants', ctx.playerX, ctx.playerZ);
    const dur = cfg.grantsWindup * this.sm();
    for (let i = 0; i < cfg.grantsCount; i++) {
      const a = ctx.rng() * Math.PI * 2;
      const d = i === 0 ? 0 : 2.6 + ctx.rng() * 2;
      const at = new THREE.Vector3(ctx.playerX + Math.sin(a) * d, 0, ctx.playerZ + Math.cos(a) * d);
      this.clampOnAltar(at, 1.5);
      const last = i === cfg.grantsCount - 1;
      const landed = () => {
        if (!last) return;
        this.sound('falz.grantsHit', at.x, at.z);
        // (Doom's banner has just told you to find the light.)
        if (!this.taughtLight && !doom) {
          this.taughtLight = true;
          ctx.announce('The light lingers: it cleanses Corruption');
        }
        if (this.state === 'cast') this.enter('recover');
      };
      this.grantsPillar(ctx, at, dur, { landed, hold: doom });
    }
  }

  /**
   * One Grants pillar: it crashes down on `at` after `dur` s, then stays as light (`hold`: until the Doom ends).
   * `harmless`: it only brings the light (Eclipse's pools, where you are told to run before they land).
   */
  private grantsPillar(ctx: BossContext, at: { x: number; z: number }, dur: number, opts: { landed?: () => void; hold?: boolean; harmless?: boolean } = {}): void {
    const shape: TelegraphShape = { kind: 'circle', x: at.x, z: at.z, radius: cfg.grantsRadius };
    this.warn(ctx, shape, dur, AMBER, () => {
      ctx.effect(new Pillar(at.x, at.z, LIGHT, 0.45, cfg.grantsRadius * 0.7, 14));
      ctx.effect(new Ring(at.x, at.z, LIGHT, cfg.grantsRadius * 1.2, 0.4));
      if (!opts.harmless) this.strike(ctx, shape, cfg.grantsAtpMult, at.x, at.z, 6);
      this.addPool(at.x, at.z, opts.hold);
      opts.landed?.();
    });
  }

  private startMegid(ctx: BossContext): void {
    this.enter('cast');
    this.sound('falz.charge', this.fpos.x, this.fpos.z);
    // The orbs leave its hands after a short charge.
    this.warn(ctx, { kind: 'circle', x: this.fpos.x, z: this.fpos.z, radius: 0.01 }, 0.8 * this.sm(), undefined, () => {
      if (this.state !== 'cast') return;
      this.releaseOrbs(ctx, cfg.megidOrbs);
      this.enter('recover');
    });
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
    const yaw = this.splitYaw(ctx);
    const dark = this.half(yaw);
    const other = this.half(yaw + Math.PI);
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

  /** Where the altar splits: the yaw of the normal into the half you are on, the line running `halfOffset` from you. */
  private splitYaw(ctx: BossContext): number {
    const dx = ctx.playerX - this.cx;
    const dz = ctx.playerZ - this.cz;
    const d = Math.hypot(dx, dz);
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
    return Math.atan2(nx, nz);
  }

  /** One half of the altar, `yaw` pointing into it. */
  private half(yaw: number): TelegraphShape {
    return { kind: 'arc', x: this.cx, z: this.cz, yaw, inner: 0, outer: cfg.altarRadius + 0.5, arcDeg: 180 };
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

  // -------------------------------------------------- Hell: form 3 triples

  /** A triple starts: the Angel flares violet. */
  private flare(ctx: BossContext): void {
    ctx.effect(new Ring(this.cx, this.cz, CORRUPT_COLOR, 4.5, 0.5));
    ctx.effect(new Pillar(this.cx, this.cz, CORRUPT_COLOR, 0.5, 2.2, 12));
  }

  /**
   * Eclipse: three Grants pillars, then the whole altar goes dark (both halves at once) and feathers rake two of the
   * pools. The pool you can reach is picked first; the others sit ±120° round the altar from it, under the feathers.
   */
  private startEclipse(ctx: BossContext): void {
    const safe = this.eclipseSpot(ctx);
    const r = Math.hypot(safe.x - this.cx, safe.z - this.cz);
    const a = Math.atan2(safe.x - this.cx, safe.z - this.cz);
    const raked = [1, -1].map((s) => ({ x: this.cx + Math.sin(a + (s * Math.PI * 2) / 3) * r, z: this.cz + Math.cos(a + (s * Math.PI * 2) / 3) * r }));
    // Never cut by the enrage: reading the room and walking to the one safe pool takes the whole warning.
    const dur = cfg.eclipseWindup;
    const delay = cfg.tripleDelay;
    this.enter('triple');
    this.flare(ctx);
    this.sound('falz.grants', safe.x, safe.z);
    if (!this.taughtEclipse) {
      this.taughtEclipse = true;
      ctx.announce('The dark swallows the altar: shelter in the light the feathers spare');
    }
    // Harmless: you are told to run into them, and the safe one is a second's walk away, so you are usually in it when
    // it lands (they used to crash on you there, a hit before the dark; 2026-10-18, the user).
    for (const at of [safe, ...raked]) this.grantsPillar(ctx, at, cfg.grantsWindup, { harmless: true });
    const yaw = ctx.rng() * Math.PI * 2;
    const halves = [this.half(yaw), this.half(yaw + Math.PI)];
    this.warn(ctx, halves[0], dur, CORRUPT_COLOR);
    this.warn(ctx, halves[1], dur, CORRUPT_COLOR, () => {
      if (this.state !== 'triple') return;
      this.washHalf(ctx, yaw);
      this.washHalf(ctx, yaw + Math.PI);
      this.hitOnce = false;
      // Any light spares you (a lit pylon's too, as for Doom), your body touching it is enough: the dark hits
      // the same body (it used to need your centre inside one of its own pools).
      if (!ctx.lightAt(ctx.playerX, ctx.playerZ, 0.45)) for (const h of halves) this.strike(ctx, h, cfg.halfAtpMult, this.cx, this.cz, 6, true);
      this.endAttack();
    });
    // The feathers come a moment later and fire with the dark.
    this.warn(ctx, { kind: 'circle', x: this.cx, z: this.cz, radius: 0.01 }, delay, undefined, () => {
      if (this.state !== 'triple') return;
      this.sound('falz.charge', this.cx, this.cz);
      const lanes = raked.flatMap((p) => this.rakeLanes(p.x, p.z));
      let hit = false;
      lanes.forEach((lane, i) => {
        this.warn(ctx, lane, dur - delay, RED, () => {
          if (lane.kind === 'line') ctx.effect(new Tracer(lane.x, lane.z, lane.yaw, lane.length, LIGHT, 0.25, 0.3));
          if (!hit && ctx.playerAlive && inShape(lane, ctx.playerX, ctx.playerZ, 0.45)) {
            hit = true;
            ctx.hitPlayer(lane, cfg.featherAtpMult, this.cx, this.cz, 5);
          }
          if (i === lanes.length - 1) this.sound('falz.feathers', this.cx, this.cz);
        });
      });
    });
  }

  /** Eclipse's safe pool: `eclipseReach` m from you and `eclipseRing` m from the centre (whole on the altar). */
  private eclipseSpot(ctx: BossContext): { x: number; z: number } {
    const [near, far] = cfg.eclipseReach;
    const [inner, outer] = cfg.eclipseRing;
    const d = near + ctx.rng() * (far - near);
    const a0 = ctx.rng() * Math.PI * 2;
    let at = { x: ctx.playerX, z: ctx.playerZ };
    for (let i = 0; i < 16; i++) {
      const a = a0 + (i / 16) * Math.PI * 2;
      at = { x: ctx.playerX + Math.sin(a) * d, z: ctx.playerZ + Math.cos(a) * d };
      const r = Math.hypot(at.x - this.cx, at.z - this.cz);
      if (r >= inner && r <= outer) return at;
    }
    // (Can't happen on the round altar; just keep it on the ring.)
    const r = Math.hypot(at.x - this.cx, at.z - this.cz) || 1;
    const k = THREE.MathUtils.clamp(r, inner, outer) / r;
    return { x: this.cx + (at.x - this.cx) * k, z: this.cz + (at.z - this.cz) * k };
  }

  /** Feather lanes from the Angel fanned over a whole pool at (x, z), with no gap a body fits through. */
  private rakeLanes(x: number, z: number): TelegraphShape[] {
    const d = Math.hypot(x - this.cx, z - this.cz);
    const yaw = Math.atan2(x - this.cx, z - this.cz);
    // Neighbouring lanes part by at most a lane plus (nearly) a body at the pool's far edge.
    const step = 2 * Math.asin((cfg.featherWidth / 2 + 0.4) / (d + cfg.grantsRadius));
    const spread = Math.asin(Math.min(1, cfg.grantsRadius / d));
    const n = Math.max(0, Math.ceil(spread / step - 0.5));
    const lanes: TelegraphShape[] = [];
    for (let i = -n; i <= n; i++) lanes.push({ kind: 'line', x: this.cx, z: this.cz, yaw: yaw + i * step, length: cfg.altarRadius + 1, width: cfg.featherWidth });
    return lanes;
  }

  /**
   * Judgement: your half goes dark, a lance runs from the Angel across the other half and a wing of feathers sweeps
   * the quarter of it away from you. Safe: the other quarter, past the lance's edge.
   */
  private startJudgement(ctx: BossContext): void {
    const yaw = this.splitYaw(ctx);
    // u: into the other half; v: along the dividing line. The safe quarter is on your side of the lance.
    const ux = -Math.sin(yaw);
    const uz = -Math.cos(yaw);
    const vx = -uz;
    const vz = ux;
    const along = (ctx.playerX - this.cx) * vx + (ctx.playerZ - this.cz) * vz;
    const side = Math.abs(along) > 0.3 ? Math.sign(along) : ctx.rng() < 0.5 ? -1 : 1;
    const dark = this.half(yaw);
    const wingYaw = Math.atan2(ux - side * vx, uz - side * vz);
    const wing: TelegraphShape = { kind: 'cone', x: this.cx, z: this.cz, yaw: wingYaw, range: cfg.altarRadius + 0.5, arcDeg: cfg.judgementWingDeg };
    const lanceYaw = Math.atan2(ux, uz);
    const lance: TelegraphShape = { kind: 'line', x: this.cx, z: this.cz, yaw: lanceYaw, length: cfg.altarRadius + 0.5, width: cfg.lanceWidth };
    const dur = cfg.judgementWindup * this.sm();
    const delay = cfg.tripleDelay * this.sm();
    this.enter('triple');
    this.flare(ctx);
    this.sound('falz.halves', this.cx, this.cz);
    this.warn(ctx, dark, dur, CORRUPT_COLOR);
    this.warn(ctx, wing, dur, RED);
    // The lance comes a moment later and fires with the others.
    this.warn(ctx, { kind: 'circle', x: this.cx, z: this.cz, radius: 0.01 }, delay, undefined, () => {
      if (this.state !== 'triple') return;
      this.sound('falz.charge', this.cx, this.cz);
      this.warn(ctx, lance, dur - delay, RED, () => {
        if (this.state !== 'triple') return;
        this.washHalf(ctx, yaw);
        const arc = THREE.MathUtils.degToRad(cfg.judgementWingDeg);
        for (let i = 0; i <= 8; i++) ctx.effect(new Tracer(this.cx, this.cz, wingYaw + (i / 8 - 0.5) * arc, cfg.altarRadius, LIGHT, 0.3, 0.3));
        ctx.effect(new Tracer(this.cx, this.cz, lanceYaw, cfg.altarRadius, LIGHT, 0.4, cfg.lanceWidth * 0.8));
        for (let s = 1; s <= 5; s++) ctx.effect(new Pillar(this.cx + (ux * cfg.altarRadius * s) / 5, this.cz + (uz * cfg.altarRadius * s) / 5, LIGHT, 0.3, 0.8, 10));
        ctx.shake(0.5);
        this.sound('falz.lance', this.cx + ux * 6, this.cz + uz * 6);
        this.sound('falz.feathers', this.cx, this.cz);
        // One hit at most: the first of the three that holds you.
        this.hitOnce = false;
        this.strike(ctx, dark, cfg.halfAtpMult, this.cx, this.cz, 6, true);
        this.strike(ctx, lance, cfg.lanceAtpMult, this.cx, this.cz, 14);
        this.strike(ctx, wing, cfg.featherAtpMult, this.cx, this.cz, 5);
        this.endAttack();
      });
    });
  }

  // ------------------------------------------ Hell: the Dark Tide and Doom

  /** Hell's own clocks (Doom in forms 2 and 3, the Dark Tide in form 3) and what they have running. */
  private updateHell(dt: number, ctx: BossContext): void {
    if (this.form > 1 && this.state !== 'morph') this.doomT -= dt;
    this.updateDoom(dt, ctx);
    this.updateTide(dt, ctx);
  }

  /**
   * Keep track of the altar's pylons by watching their light (how long one has been lit, then its recharge), so the
   * Angel only lays Doom while you can reach one. Each is tested at a spot in its light that none of our own light
   * covers (if every spot is covered, what we knew stands). `dt`: real seconds.
   */
  private watchPylons(dt: number, ctx: BossContext): void {
    for (const p of this.watch) {
      const spot = WATCH_SPOTS.find(([ox, oz]) => !this.lightAt(p.x + ox, p.z + oz, 0));
      const lit = spot ? ctx.lightAt(p.x + spot[0], p.z + spot[1], 0) : p.lit;
      if (lit) {
        if (!p.lit) p.litFor = 0;
        p.litFor += dt;
        p.rest = 0;
      } else {
        if (p.lit) p.rest = pylonCfg.recharge;
        p.rest = Math.max(0, p.rest - dt);
      }
      p.lit = lit;
    }
  }

  /** Doom's count in real seconds: a rift's tempo shortens it, never under doomMinTime. */
  private doomCount(): number {
    return Math.max(cfg.doomMinTime, cfg.doomTime / this.tempo);
  }

  /** Light you can reach before a Doom of `count` s ends: a ready pylon within doomReach m, or one lit for the whole count. */
  private doomLight(ctx: BossContext, count: number): boolean {
    return this.watch.some((p) => {
      const d = Math.hypot(ctx.playerX - p.x, ctx.playerZ - p.z);
      if (p.lit) return pylonCfg.litTime - p.litFor >= count + 0.5 && d - pylonCfg.radius <= cfg.doomReach;
      return p.rest <= 0 && d <= cfg.doomReach;
    });
  }

  /** Doom: the mark lands on you. Dark Falz casts it with Grants (their light held until it ends); the Angel on its own. */
  private startDoom(ctx: BossContext): void {
    const [lo, hi] = cfg.doomEvery;
    this.doomT = lo + ctx.rng() * (hi - lo);
    this.lastAttack = 'doom';
    this.hitOnce = false;
    const from = this.body.pos;
    ctx.effect(new Tracer(from.x, from.z, Math.atan2(ctx.playerX - from.x, ctx.playerZ - from.z), Math.hypot(ctx.playerX - from.x, ctx.playerZ - from.z), DOOM, 0.4, 0.22));
    this.markDoom(ctx);
    if (this.form === 2) this.startGrants(ctx, true);
    else {
      this.enter('doom');
      ctx.effect(new Ring(this.cx, this.cz, DOOM, 4, 0.45));
    }
    this.sound('falz.megid', ctx.playerX, ctx.playerZ);
    if (!this.taughtDoom) {
      this.taughtDoom = true;
      ctx.announce('Doom: end it in the light!');
    }
  }

  /** Doom's sigil under you (a star turning inside a ring that shrinks as the count runs out) and a mark over your head. */
  private markDoom(ctx: BossContext): void {
    const total = this.doomCount();
    const mats: Doom['mats'] = [];
    const mat = (opacity: number): THREE.MeshBasicMaterial => {
      const m = new THREE.MeshBasicMaterial({ color: DOOM, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
      mats.push([m, opacity]);
      return m;
    };
    const flat = <G extends THREE.BufferGeometry>(g: G): G => g.rotateX(-Math.PI / 2);
    const outer = new THREE.Mesh(flat(new THREE.RingGeometry(1.45, 1.6, 48)), mat(0.85));
    const count = new THREE.Mesh(flat(new THREE.RingGeometry(0.86, 1, 48)), mat(0.95));
    // Two triangles of thin bars: a six-pointed star.
    const star = new THREE.Group();
    const barMat = mat(0.7);
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3;
      const bar = new THREE.Mesh(flat(new THREE.PlaneGeometry(0.08, 2.25)), barMat);
      bar.position.set(Math.sin(a) * 0.65, 0, Math.cos(a) * 0.65);
      bar.rotation.y = a + Math.PI / 2;
      star.add(bar);
    }
    const disc = glowDecal(DOOM, 3.6, 0.4);
    mats.push([disc.material, 0.4]);
    const floor = new THREE.Group();
    floor.add(disc, outer, count, star);
    floor.position.set(ctx.playerX, 0.06, ctx.playerZ);
    // Over your head: a dark eye in a violet glow, a tilted hoop turning round it.
    const halo = glowSprite(DOOM, 1.5, 0.9);
    mats.push([halo.material, 0.9]);
    const eye = new THREE.Mesh(new THREE.OctahedronGeometry(0.2, 0), new THREE.MeshBasicMaterial({ color: 0x1a0828 }));
    eye.scale.set(1, 1.5, 1);
    const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.03, 6, 32), mat(0.9));
    hoop.rotation.x = Math.PI / 2 - 0.5;
    const mark = new THREE.Group();
    mark.add(halo, eye, hoop);
    mark.position.set(ctx.playerX, 2.9, ctx.playerZ);
    this.fx.add(floor, mark);
    this.doom = { left: total, total, glow: 0, floor, mark, count, star, mats };
    ctx.effect(new Ring(ctx.playerX, ctx.playerZ, DOOM, 2.2, 0.4));
  }

  /** Doom's count (real seconds). The sigil follows you; the moment you touch light it is cleansed. */
  private updateDoom(dt: number, ctx: BossContext): void {
    const d = this.doom;
    if (!d) return;
    if (!ctx.playerAlive) return this.clearDoom();
    d.left -= dt / this.tempo;
    const lit = ctx.lightAt(ctx.playerX, ctx.playerZ, 0.45);
    // Cleansed at once in light (2026-10-17, the user's call: it used to wait out its count in there).
    if (lit) return this.resolveDoom(ctx, true);
    d.glow += ((lit ? 1 : 0) - d.glow) * Math.min(1, dt * 8);
    const k = Math.max(0, d.left / d.total);
    d.floor.position.set(ctx.playerX, 0.06, ctx.playerZ);
    d.mark.position.set(ctx.playerX, 2.9 + Math.sin(this.time * 3) * 0.08, ctx.playerZ);
    d.mark.rotation.y += dt * 2.5;
    d.count.scale.setScalar(0.12 + 1.3 * k);
    d.star.rotation.y += dt * (1.2 + (1 - k) * 3) * (1 - d.glow * 0.7);
    // Violet while it threatens, light while you stand in light; the last two seconds throb.
    const throb = d.left < 2 ? 0.55 + 0.45 * Math.abs(Math.sin(this.time * 9)) : 1;
    tmpColor.setHex(DOOM).lerp(lightColor, d.glow);
    for (const [m, o] of d.mats) {
      m.color.copy(tmpColor);
      m.opacity = o * throb;
    }
    if (d.left <= 0) this.resolveDoom(ctx, lit);
  }

  /** You touched light (cleansed), or the count ran out: it bursts round you and Darvants streak out. */
  private resolveDoom(ctx: BossContext, lit: boolean): void {
    const x = ctx.playerX;
    const z = ctx.playerZ;
    this.clearDoom();
    // Doom had the attack's turn: the usual gap before the next one (a triple waiting on it starts no sooner).
    if (this.state === 'idle') this.gap = Math.max(this.gap, this.stateT + cfg.attackGap[this.form - 1] * this.sm());
    if (lit) {
      ctx.effect(new Pillar(x, z, LIGHT, 0.5, 0.9, 10));
      ctx.effect(new Ring(x, z, LIGHT, 2.8, 0.45));
      this.sound('status.cleanse', x, z);
      return;
    }
    const shape: TelegraphShape = { kind: 'circle', x, z, radius: cfg.doomRadius };
    ctx.effect(new Ring(x, z, CORRUPT_COLOR, cfg.doomRadius * 1.25, 0.45));
    ctx.effect(new Pillar(x, z, CORRUPT_COLOR, 0.4, 1.3, 9));
    ctx.shake(0.45);
    this.sound('falz.pulse', x, z);
    this.sound('falz.dive', x, z);
    const a0 = Math.random() * Math.PI * 2;
    this.addFlight(8, () => new THREE.Vector3(x, 1.2, z), (i) => {
      const a = a0 + (i / 8) * Math.PI * 2;
      return new THREE.Vector3(x + Math.sin(a) * 10, 1.4 + (i % 3) * 0.7, z + Math.cos(a) * 10);
    }, 0.55);
    // One Corruption stack rides on the hit itself, the rest on top.
    if (ctx.hitPlayer(shape, cfg.doomAtpMult, this.body.pos.x, this.body.pos.z, 8, 'corrupt')) ctx.corruptPlayer(cfg.doomStacks - 1);
  }

  private clearDoom(): void {
    if (!this.doom) return;
    this.fx.remove(this.doom.floor, this.doom.mark);
    this.doom = null;
  }

  /** The Dark Tide (form 3): its clock, and the motes drifting in (light dissolves them, you absorb them, or they feed the Angel). */
  private updateTide(dt: number, ctx: BossContext): void {
    this.healedT = Math.max(0, this.healedT - dt);
    if (this.form === 3) {
      this.tideT -= dt;
      if (this.tideT <= 0) this.raiseTide(ctx);
    }
    // In boss seconds: a rift's tempo speeds them up to tideMaxSpeed real m/s, no further.
    const speed = Math.min(cfg.tideSpeed, cfg.tideMaxSpeed / this.tempo);
    for (const m of [...this.motes]) {
      // It breaks out of the rim with a dark flare.
      if (m.t < 0 && m.t + dt >= 0) ctx.effect(new Pillar(m.x, m.z, CORRUPT_COLOR, 0.45, 0.4, 5));
      m.t += dt;
      const rise = THREE.MathUtils.clamp(m.t / MOTE_RISE, 0, 1);
      const dx = this.cx - m.x;
      const dz = this.cz - m.z;
      const d = Math.hypot(dx, dz) || 1;
      if (rise >= 1) {
        const step = Math.min(d, speed * dt);
        m.x += (dx / d) * step;
        m.z += (dz / d) * step;
      }
      const y = -1.4 + 2.6 * (1 - (1 - rise) ** 2) + Math.sin(this.time * 3 + m.x) * 0.1 * rise;
      m.group.position.set(m.x, y, m.z);
      m.group.rotation.y += dt * 2;
      m.decal.position.set(m.x, 0.05, m.z);
      m.decal.material.opacity = 0.55 * rise;
      // The trail: each sprite follows the one before it.
      let prev = m.group.position;
      m.trail.forEach((s, i) => {
        s.position.lerp(prev, Math.min(1, dt * 9));
        s.material.opacity = 0.55 * (1 - i / m.trail.length) * rise;
        prev = s.position;
      });
      if (rise < 0.6) continue;
      if (ctx.lightAt(m.x, m.z, 0)) this.dissolveMote(ctx, m);
      else if (ctx.playerAlive && Math.hypot(ctx.playerX - m.x, ctx.playerZ - m.z) < cfg.tideRadius + 0.45) this.absorbMote(ctx, m);
      else if (Math.hypot(m.x - this.cx, m.z - this.cz) <= this.bodyRadius + 0.3) this.feedAngel(ctx, m);
    }
  }

  /** A Dark Tide: motes rise one after another round the rim (often down the pylons' spokes) and set off for the Angel. */
  private raiseTide(ctx: BossContext): void {
    const [lo, hi] = cfg.tideEvery;
    this.tideT = lo + ctx.rng() * (hi - lo);
    const [nLo, nHi] = cfg.tideMotes;
    const n = nLo + Math.floor(ctx.rng() * (nHi - nLo + 1));
    const spokes = this.watch.map((p) => Math.atan2(p.x - this.cx, p.z - this.cz));
    const [s0, s1] = cfg.tideSpoke.map((v) => THREE.MathUtils.degToRad(v));
    let base = ctx.rng() * Math.PI * 2;
    if (spokes.length && ctx.rng() < cfg.tidePylonChance) base = spokes[Math.floor(ctx.rng() * spokes.length)] + (ctx.rng() < 0.5 ? -1 : 1) * (s0 + ctx.rng() * (s1 - s0));
    for (let i = 0; i < n; i++) {
      let a = base + (i * Math.PI * 2) / n;
      // Never straight down a spoke, through the pylon itself.
      for (const s of spokes) {
        const off = Math.atan2(Math.sin(a - s), Math.cos(a - s));
        if (Math.abs(off) < s0) a = s + (off < 0 ? -s0 : s0);
      }
      this.addMote(this.cx + Math.sin(a) * cfg.tideRim, this.cz + Math.cos(a) * cfg.tideRim, i * 0.35);
    }
    this.sound('falz.megid', this.cx, this.cz);
    if (!this.taughtTide) {
      this.taughtTide = true;
      ctx.announce('Dark motes feed the Angel: walk through them or light their way');
    }
  }

  /** A mote: a violet-black core with a bright rim, a glow, a trail and its glow on the floor. It rises after `delay` s. */
  private addMote(x: number, z: number, delay: number): void {
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 10), new THREE.MeshBasicMaterial({ color: 0x12041e }));
    // The rim: a bigger back-facing shell that only shows round the dark core's edge.
    const rim = new THREE.Mesh(
      new THREE.SphereGeometry(0.38, 16, 12),
      new THREE.MeshBasicMaterial({ color: MOTE_RIM, side: THREE.BackSide, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    const group = new THREE.Group();
    group.add(core, rim, glowSprite(CORRUPT_COLOR, 2.2, 0.8));
    group.position.set(x, -1.4, z);
    const decal = glowDecal(CORRUPT_COLOR, 1.8, 0);
    decal.position.set(x, 0.05, z);
    const trail = Array.from({ length: 6 }, (_, i) => {
      const s = glowSprite(i % 2 ? MOTE_RIM : CORRUPT_COLOR, 0.75 - i * 0.08, 0);
      s.position.copy(group.position);
      return s;
    });
    this.fx.add(group, decal, ...trail);
    this.motes.push({ group, decal, trail, x, z, t: -delay });
  }

  /** Light caught a mote: it burns away. */
  private dissolveMote(ctx: BossContext, m: Mote): void {
    ctx.effect(new Ring(m.x, m.z, LIGHT, 1.6, 0.4));
    ctx.effect(new Pillar(m.x, m.z, LIGHT, 0.35, 0.3, 4));
    this.sound('status.cleanse', m.x, m.z);
    this.removeMote(m);
  }

  /** You walked through a mote: it pops into you, +1 Corruption (no damage). */
  private absorbMote(ctx: BossContext, m: Mote): void {
    ctx.effect(new Ring(m.x, m.z, CORRUPT_COLOR, 1.4, 0.35));
    this.sound('falz.orbPop', m.x, m.z);
    ctx.corruptPlayer(1);
    this.removeMote(m);
  }

  /** A mote reached the Angel: it heals, never past the form's share of the bar. */
  private feedAngel(ctx: BossContext, m: Mote): void {
    this.hp = Math.min(this.maxHp * cfg.form3At, this.hp + this.maxHp * cfg.tideHeal);
    this.healedT = 1.5;
    ctx.effect(new Pillar(this.cx, this.cz, CORRUPT_COLOR, 0.5, 0.9, 11));
    ctx.effect(new Ring(this.cx, this.cz, CORRUPT_COLOR, 3.6, 0.5));
    this.sound('falz.charge', this.cx, this.cz);
    this.removeMote(m);
  }

  private removeMote(m: Mote): void {
    this.fx.remove(m.group, m.decal, ...m.trail);
    this.motes.splice(this.motes.indexOf(m), 1);
  }

  // ------------------------------------------------------------- morphs

  private startMorph(ctx: BossContext): void {
    this.tele.cancelAll();
    this.morphFrom = this.form === 1 ? 1 : 2;
    this.slamAt = null;
    for (const o of this.orbs) this.fx.remove(o.mesh);
    this.orbs = [];
    // A change of form wipes Doom (its Grants may not have landed).
    if (this.doom) {
      ctx.effect(new Ring(ctx.playerX, ctx.playerZ, DOOM, 2, 0.4));
      this.clearDoom();
    }
    this.enter('morph');
    ctx.shake(0.5);
    this.sound('falz.morph', this.cx, this.cz);
    if (this.morphFrom === 1) ctx.announce('Dark Falz breaks free of the husk!');
    else this.escalate(ctx, this.hard?.hell ? 'Dark Falz ascends: the Angel descends, empowered by Hell!' : 'Dark Falz ascends: the Angel descends!');
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
        this.doomT = cfg.doomFirst;
      } else {
        this.falzPresence = 0;
        this.angelPresence = 1;
        // Hell: the tide rises as the Angel arrives; Doom gives it a moment.
        this.tideT = cfg.tideFirst;
        this.doomT = Math.max(this.doomT, cfg.doomFirst);
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

  private addPool(x: number, z: number, hold = false): void {
    const decal = glowDecal(LIGHT, cfg.grantsRadius * 2.6, 0.7);
    decal.position.set(x, 0.04, z);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(cfg.grantsRadius - 0.1, cfg.grantsRadius, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: LIGHT, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    ring.position.set(x, 0.05, z);
    this.fx.add(decal, ring);
    this.pools.push({ x, z, t: cfg.grantsLight, hold, decal, ring });
  }

  private updatePools(dt: number): void {
    for (const p of [...this.pools]) {
      if (!(p.hold && this.doom)) p.t -= dt;
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
