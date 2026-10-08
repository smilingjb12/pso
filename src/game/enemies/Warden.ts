import * as THREE from 'three';
import { warden as cfg, type HardBossScale } from '../config';
import { separateCircles } from '../collision';
import type { Hittable } from '../combat/types';
import { WARDEN_HAND_REST, WardenModel } from '../models/mines';
import { Pillar, Ring } from '../world/Effects';
import { glowTexture } from '../world/glow';
import type { Level, Rect } from '../world/Level';
import { inShape, type TelegraphShape } from '../world/Telegraph';
import type { BossContext } from './Boss';
import { BossBase, BossPart } from './BossBase';
import { CORRUPT_COLOR, type Enemy } from './Enemy';
import { RepairDrone, SparkMite } from './mineEnemies';

// The Warden: the Mines boss. A colossus built into the north end of its hall; it
// never moves. The deck in front of it is a grid of cells (`cell` m) and every
// attack is about where to stand:
//  - Floor patterns: waves of lit cells (checkerboard, stripes, bands, rings and,
//    in phase 2, diagonals). Each wave's warning shows as the previous one fires,
//    and every wave leaves a safe cell next to the last one. Afterwards its core
//    vents: the damage window.
//  - Laser wall: its starting line (with one gap) is shown, then it rips down the
//    hall from the Warden in a moment: be in line with the gap (phase 2: a
//    second wall follows with its gap elsewhere).
//  - Lockdown: the cell you stand on (phase 2: and one more) turns into burning
//    floor for good. Once `lockMax` zones are down it holds them a few seconds,
//    then they all reset, so the deck never runs out of room.
//  - Intake: it draws everyone toward its core while the rows nearest it fill up,
//    then they blast. Walk (or dash) out against the pull.
//  - Summon: Spark Mites (chase you and arm a small burning blast) and Repair
//    Drones (park by the alcove and beam repairs into the core until shot down).
//  - Hand slam: on anyone within `slamRange` of its alcove (phase 2: a pair, and
//    a dash check).
// Phase 2 at 50% HP (faster, longer patterns); enraged below 25% (shorter windups).
// Hell: phase 3 from a third of its HP (its glow turns violet). Every few attacks is a
// triple: a floor wave, laser wall, hand slam or lockdown, three at once, planned
// around one safe cell near you; then its core vents.

type WState =
  | 'dormant' | 'intro' | 'idle' | 'slamPrep' | 'slam' | 'pattern' | 'vent' | 'wallPrep' | 'wall' | 'lockPrep'
  | 'intakePrep' | 'intake' | 'summon' | 'overclock' | 'triple' | 'dead';
type Attack = 'slam' | 'pattern' | 'wall' | 'lockdown' | 'intake' | 'summon';
/** Hell triples: diagonals + wall + slam, three holes + lockdown + slam, bands + wall + lockdown. */
type Triple = 'diagonals' | 'holes' | 'bands';
const TRIPLES: Triple[] = ['diagonals', 'holes', 'bands'];
type Pattern = (c: number, r: number, wave: number, cols: number, rows: number) => boolean;

const CELL_INSET = 0.15;
const INTAKE_MOTES = 110;
/** A triple's safe cell counts as reached this far inside its edges. */
const SAFE_INSET = 0.5;

/** Is cell (c, r) lit on this wave? Row 0 is the one against the alcove. */
const PATTERNS: Record<string, Pattern> = {
  checker: (c, r, w) => (c + r + w) % 2 === 0,
  stripes: (c, _r, w) => (c + w) % 2 === 0,
  bands: (_c, r, w) => (r + w) % 2 === 0,
  rings: (c, r, w, cols, rows) => (Math.min(c, r, cols - 1 - c, rows - 1 - r) + w) % 2 === 0,
  // Two of every three diagonals: the safe one steps a cell toward the Warden each wave.
  diagonals: (c, r, w) => (c + r + w) % 3 !== 0,
};
const PHASE1_PATTERNS = ['checker', 'stripes', 'bands', 'rings'];
const PHASE2_PATTERNS = ['checker', 'stripes', 'bands', 'rings', 'diagonals', 'diagonals'];

/**
 * A triple, built around its one safe cell: the floor wave lights `lit`, the laser wall's gap lines up
 * with the safe cell (`gap`: its x), a hand slams the cell `slam` and `locks` are locked down.
 */
interface TriplePlan {
  kind: Triple;
  safe: number;
  lit: number[];
  gap: number | null;
  slam: number | null;
  locks: number[];
}

/** A locked-down cell: burning floor until the zones reset. */
interface Zone {
  group: THREE.Group;
  decal: THREE.MeshBasicMaterial;
  flames: THREE.Points;
  pos: Float32Array;
}

export class Warden extends BossBase<WState, Attack> {
  readonly id = 'warden' as const;
  readonly objects: THREE.Object3D[] = [];
  phase: 1 | 2 | 3 = 1;

  private model = new WardenModel();
  /** The core: the one part you can hit. */
  private body: BossPart;
  // The hall: deck from `front` (the alcove's edge) to `back`, `cols` x `rows` cells.
  private cx: number;
  private rootZ: number;
  private x0: number;
  private x1: number;
  private front: number;
  private back: number;
  private cols: number;
  private rows: number;
  private cw: number;
  private ch: number;

  private taughtVent = false;
  // Pose state (hands in model space).
  private charge = 0;
  private cast = 0;
  private coreOpen = 0;
  private handL = new THREE.Vector3(-WARDEN_HAND_REST.x, WARDEN_HAND_REST.y, WARDEN_HAND_REST.z);
  private handR = WARDEN_HAND_REST.clone();
  private goalL = this.handL.clone();
  private goalR = this.handR.clone();
  // Slam.
  private slamSide = 1;
  private slamX = 0;
  private slamZ = 0;
  private slamsLeft = 0;
  // Floor patterns.
  private pattern: Pattern = PATTERNS.checker;
  private patternName = '';
  private patternShift = 0;
  private wave = 0;
  private waves = 0;
  private waveW = 1;
  private waveT = 0;
  private lit: number[] = [];
  private flashes: { mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>; t: number }[] = [];
  // Laser wall.
  private wallGroup = new THREE.Group();
  private wallSegs: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>[] = [];
  private wallFrom = 0;
  private wallTo = 0;
  private wallGap = 0;
  /** The gap's width: cfg.wallGap, or one cell in a triple (so its lane is exactly the safe cell's column). */
  private wallGapW = 0;
  private wallPrevZ = 0;
  private wallHit = false;
  private wallsLeft = 0;
  // Intake.
  private intakeShape: TelegraphShape | null = null;
  private intakeK = 0;
  private motes: THREE.Points;
  private motePos = new Float32Array(INTAKE_MOTES * 3);
  // Adds.
  private adds: Enemy[] = [];
  private summons = 0;
  private summoned = false;
  private taughtRepair = false;
  private beams: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>[] = [];
  // Lockdown.
  private zones = new Map<number, Zone>();
  private lockCells: number[] = [];
  private lockW = 1;
  /** Hard pairs: a hand slam riding on a laser wall, and a lockdown called during a pattern. */
  private pairSlam: { x: number; z: number; side: number; downT: number } | null = null;
  private pairLock = false;
  // Hell triples.
  private triple: TriplePlan | null = null;
  private lastTriple: Triple | null = null;
  private sinceTriple = 0;
  private thirdOut = false;
  private waveFired = false;
  /** Seconds since the triple's wall set off (-1: not running). */
  private wallT = -1;
  private holdT = 0;
  private zoneTickT = 0;
  private zoneTicks = 0;
  private fx = new THREE.Group();

  constructor(arena: Rect, hard: HardBossScale | null = null) {
    super(cfg, hard);
    this.x0 = arena.minX;
    this.x1 = arena.maxX;
    this.cx = (arena.minX + arena.maxX) / 2;
    this.front = arena.minZ + cfg.alcove;
    this.back = arena.maxZ;
    this.rootZ = arena.minZ + cfg.alcove / 2;
    this.cols = Math.max(1, Math.round((this.x1 - this.x0) / cfg.cell));
    this.rows = Math.max(1, Math.round((this.back - this.front) / cfg.cell));
    this.cw = (this.x1 - this.x0) / this.cols;
    this.ch = (this.back - this.front) / this.rows;
    this.body = new BossPart(this, cfg.bodyRadius, () => 3.6);
    this.body.pos.set(this.cx, 0, this.front - 1.4);
    this.objects.push(this.model.root, this.fx);

    // One flash plate per cell for the pattern discharges.
    for (let i = 0; i < this.cols * this.rows; i++) {
      const [x, z] = this.cellCentre(i);
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(this.cw - CELL_INSET * 2, this.ch - CELL_INSET * 2).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0xffb070, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }),
      );
      mesh.position.set(x, 0.06, z);
      mesh.visible = false;
      this.fx.add(mesh);
      this.flashes.push({ mesh, t: 0 });
    }
    // The laser wall: two tall panels either side of the gap.
    for (let i = 0; i < 2; i++) {
      const seg = new THREE.Mesh(
        new THREE.BoxGeometry(1, 3.2, 0.3),
        new THREE.MeshBasicMaterial({ color: 0xff3a30, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }),
      );
      seg.position.y = 1.6;
      this.wallSegs.push(seg);
      this.wallGroup.add(seg);
    }
    this.wallGroup.visible = false;
    this.fx.add(this.wallGroup);
    // Intake: motes streaming across the deck into the core.
    for (let i = 0; i < INTAKE_MOTES; i++) this.respawnMote(i, Math.random);
    const moteGeo = new THREE.BufferGeometry();
    moteGeo.setAttribute('position', new THREE.BufferAttribute(this.motePos, 3));
    this.motes = new THREE.Points(
      moteGeo,
      new THREE.PointsMaterial({ map: glowTexture(), color: 0xbfe8ff, size: 0.3, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.motes.frustumCulled = false;
    this.motes.visible = false;
    this.fx.add(this.motes);
    // Repair beams from drones to the core.
    for (let i = 0; i < cfg.maxDrones; i++) {
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.08, 1, 6, 1, true),
        new THREE.MeshBasicMaterial({ color: 0x60ffb0, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending }),
      );
      beam.visible = false;
      this.fx.add(beam);
      this.beams.push(beam);
    }
    this.place();
  }

  // ---------------------------------------------------------------- Boss

  get weakPointOpen(): boolean {
    return this.state === 'vent';
  }
  /** Shown after the name on the boss bar. */
  get hudNote(): string {
    let note = '';
    if (this.adds.some((e) => e instanceof RepairDrone && e.alive && e.repairing)) note += '  — REPAIRING';
    const n = this.zones.size;
    if (n) note += `  — LOCKDOWN ${n}/${cfg.lockMax}${n >= cfg.lockMax ? ` (reset in ${Math.ceil(this.holdT)})` : ''}`;
    return note;
  }
  parts(): Hittable[] {
    return [this.body];
  }

  collide(playerPos: THREE.Vector3, playerRadius: number, level: Level): void {
    separateCircles(playerPos, playerRadius, 1, this.body.pos, cfg.bodyRadius, 1e6);
    // The alcove is the Warden's: the deck ends at its edge.
    if (playerPos.z < this.front + playerRadius) playerPos.z = this.front + playerRadius;
    level.resolveCircle(playerPos, playerRadius);
  }

  // -------------------------------------------------------------- damage

  partMult(): number {
    return this.state === 'vent' ? cfg.ventMult : 1;
  }

  protected onDeath(): void {
    this.wallGroup.visible = false;
    this.motes.visible = false;
    this.clearZones();
    // Its adds shut down with it.
    for (const e of this.adds) if (e.alive) e.vanish();
    this.adds = [];
    for (const b of this.beams) b.visible = false;
  }

  // --------------------------------------------------------------- cells

  private cellCentre(i: number): [number, number] {
    const c = i % this.cols;
    const r = Math.floor(i / this.cols);
    return [this.x0 + (c + 0.5) * this.cw, this.front + (r + 0.5) * this.ch];
  }

  /** A cell as a telegraph shape, inset a little so neighbours read apart. */
  private cellShape(i: number, inset = CELL_INSET): TelegraphShape {
    const [x] = this.cellCentre(i);
    const r = Math.floor(i / this.cols);
    return { kind: 'line', x, z: this.front + r * this.ch + inset, yaw: 0, length: this.ch - inset * 2, width: this.cw - inset * 2 };
  }

  /** The cell under a point (clamped onto the deck). */
  private cellAt(x: number, z: number): number {
    const c = THREE.MathUtils.clamp(Math.floor((x - this.x0) / this.cw), 0, this.cols - 1);
    const r = THREE.MathUtils.clamp(Math.floor((z - this.front) / this.ch), 0, this.rows - 1);
    return r * this.cols + c;
  }

  // -------------------------------------------------------------- update

  protected get anchor(): THREE.Vector3 {
    return this.body.pos;
  }

  /** World point to the model's space (for the hands). */
  private local(out: THREE.Vector3, x: number, y: number, z: number): THREE.Vector3 {
    return out.set(x - this.cx, y, z - this.rootZ);
  }

  private restHands(lift = 0): void {
    const bob = Math.sin(this.time * 0.9) * 0.12;
    this.goalL.set(-WARDEN_HAND_REST.x, WARDEN_HAND_REST.y + lift + bob, WARDEN_HAND_REST.z);
    this.goalR.set(WARDEN_HAND_REST.x, WARDEN_HAND_REST.y + lift - bob, WARDEN_HAND_REST.z);
  }

  protected always(dt: number): void {
    this.updateFlashes(dt);
  }

  protected whileDead(dt: number): void {
    this.restHands(-0.3);
    this.smooth(dt, 0, 0, 0, 2);
    this.place();
  }

  protected think(dt: number, ctx: BossContext): void {
    this.updateZones(dt, ctx);
    this.updateAdds(dt, ctx);
    this.updateMotes(dt);

    if (this.phase === 1 && this.hp <= this.maxHp * cfg.phase2At && this.state === 'idle') this.startOverclock(ctx);
    else if (this.phase === 2 && this.hard?.hell && this.hp <= this.maxHp * cfg.phase3At && this.state === 'idle') this.startPhase3(ctx);
    this.announceEnrage(ctx, this.phase >= 2, 'The Warden is enraged!', 'warden.boot');

    let charge = 0;
    let cast = 0;
    let coreOpen = 0;
    let handRate = 3;
    this.restHands();

    switch (this.state) {
      case 'dormant':
        if (ctx.playerAlive && this.stateT > 1.2) this.awaken(ctx, 'THE WARDEN', 0.4, 'warden.boot');
        break;

      case 'intro':
        charge = Math.min(1, this.stateT / 2);
        this.restHands(Math.sin(Math.min(1, this.stateT / 3) * Math.PI) * 2.5);
        if (this.stateT > 3) {
          this.gap = 1;
          this.enter('idle');
        }
        break;

      case 'idle':
        if (this.stateT >= this.gap) this.chooseAttack(ctx);
        break;

      // ---------------------------------------------------------- hand slam
      case 'slamPrep':
        charge = 1;
        handRate = 4;
        this.local(this.slamSide < 0 ? this.goalL : this.goalR, this.slamX, 6.5, this.slamZ);
        break; // the telegraph moves us on
      case 'slam':
        handRate = 20;
        this.local(this.slamSide < 0 ? this.goalL : this.goalR, this.slamX, WARDEN_HAND_REST.y, this.slamZ);
        if (this.stateT >= 0.6) {
          if (this.slamsLeft > 0) {
            this.slamsLeft--;
            this.startSlam(ctx);
          } else this.endAttack();
        }
        break;

      // ------------------------------------------------------ floor pattern
      case 'pattern':
        cast = 1;
        charge = 0.5;
        this.goalL.set(-7.5, 6.5 + Math.sin(this.time * 3) * 0.3, 4.5);
        this.goalR.set(7.5, 6.5 - Math.sin(this.time * 3) * 0.3, 4.5);
        this.waveT += dt;
        if (this.waveT >= this.waveW) {
          this.fireWave(ctx);
          this.wave++;
          if (this.wave < this.waves) {
            this.startWave(ctx);
            if (this.pairLock && this.wave === 1) this.pairLockdown(ctx);
          } else this.startVent(ctx);
        }
        break;
      case 'vent':
        coreOpen = 1;
        this.restHands(-0.2);
        if (this.stateT >= cfg.ventTime) {
          this.sound('warden.boot', this.body.pos.x, this.body.pos.z, 0.6);
          this.endAttack();
        }
        break;

      // --------------------------------------------------------- laser wall
      case 'wallPrep':
        charge = 1;
        this.posePairSlam(dt, (h) => (handRate = h));
        break; // the telegraph moves us on
      case 'wall':
        charge = 0.6;
        this.posePairSlam(dt, (h) => (handRate = h));
        if (this.sweepWall(ctx, this.stateT)) {
          if (this.wallsLeft > 0) {
            this.wallsLeft--;
            this.startWall(ctx, true);
          } else this.endAttack();
        }
        break;

      // ------------------------------------------------------- Hell triple
      case 'triple':
        cast = 1;
        charge = 0.8;
        this.goalL.set(-7.5, 6.5 + Math.sin(this.time * 3) * 0.3, 4.5);
        this.goalR.set(7.5, 6.5 - Math.sin(this.time * 3) * 0.3, 4.5);
        this.posePairSlam(dt, (h) => (handRate = h));
        this.waveT += dt;
        if (!this.thirdOut && this.waveT >= cfg.tripleStagger) this.startThird(ctx);
        if (!this.waveFired && this.waveT >= this.waveW) {
          this.waveFired = true;
          this.fireWave(ctx);
        }
        if (this.wallT >= 0) {
          this.wallT += dt;
          if (this.sweepWall(ctx, this.wallT)) this.wallT = -1;
        }
        // Vent once the wall has run its course and the hand is back up.
        if (this.waveFired && this.wallT < 0 && this.waveT >= this.waveW + 0.6) {
          this.triple = null;
          this.pairSlam = null;
          this.startVent(ctx);
        }
        break;

      // ------------------------------------------------------------- intake
      case 'intakePrep':
        charge = Math.min(1, this.stateT / cfg.intakeWindup);
        this.intakeK = charge * 0.3;
        if (this.stateT >= cfg.intakeWindup * this.sm()) {
          this.enter('intake');
          this.sound('warden.reroute', this.body.pos.x, this.body.pos.z, 0.7);
        }
        break;
      case 'intake': {
        charge = 1;
        coreOpen = 0.35;
        this.intakeK = 1;
        this.restHands(2);
        const pl = ctx.body();
        if (pl.alive) {
          // Drawn toward the core; walking out is slow, dashing helps.
          const dx = this.cx - pl.pos.x;
          const dz = this.front - pl.pos.z;
          const d = Math.hypot(dx, dz) || 1;
          const step = (this.phase >= 2 ? cfg.intakePull2 : cfg.intakePull) * dt;
          pl.pos.x += (dx / d) * step;
          pl.pos.z += (dz / d) * step;
        }
        if (this.stateT >= cfg.intakeTime) this.fireIntake(ctx);
        break;
      }

      // ------------------------------------------------------------- summon
      case 'summon':
        charge = 0.8;
        this.goalL.set(-6, WARDEN_HAND_REST.y, 4.2);
        this.goalR.set(6, WARDEN_HAND_REST.y, 4.2);
        handRate = 6;
        if (!this.summoned && this.stateT >= 0.6) this.summon(ctx);
        if (this.stateT >= 1.3) this.endAttack();
        break;

      // ----------------------------------------------------------- lockdown
      case 'lockPrep': {
        charge = 0.8;
        const [x, z] = this.cellCentre(this.lockCells[0]);
        const side = x < this.cx ? -1 : 1;
        this.local(side < 0 ? this.goalL : this.goalR, x, 4.5, z);
        if (this.stateT >= this.lockW) {
          for (const c of this.lockCells) this.ignite(c, ctx);
          this.endAttack();
        }
        break;
      }

      case 'overclock':
        charge = 0.5 + Math.sin(this.time * 20) * 0.5;
        this.restHands(1.2);
        if (this.stateT >= 2.4) {
          this.endAttack();
          this.gap = 1.2;
        }
        break;
    }

    this.smooth(dt, charge, cast, coreOpen, handRate);
    this.place();
  }

  private smooth(dt: number, charge: number, cast: number, coreOpen: number, handRate: number): void {
    this.charge += (charge - this.charge) * Math.min(1, dt * 5);
    this.cast += (cast - this.cast) * Math.min(1, dt * 4);
    this.coreOpen += (coreOpen - this.coreOpen) * Math.min(1, dt * 6);
    const k = Math.min(1, dt * handRate);
    this.handL.lerp(this.goalL, k);
    this.handR.lerp(this.goalR, k);
  }

  private endAttack(): void {
    this.gap = (this.phase >= 2 ? cfg.attackGap2 : cfg.attackGap) * this.sm();
    this.tele.forget();
    this.pairSlam = null;
    this.enter('idle');
  }

  private chooseAttack(ctx: BossContext): void {
    if (this.phase === 3 && ++this.sinceTriple >= cfg.tripleEvery && this.startTriple(ctx)) {
      this.sinceTriple = 0;
      return;
    }
    let pick: Attack;
    // Too close to its alcove: it swats you away.
    if (ctx.playerZ - this.front < cfg.slamRange && this.lastAttack !== 'slam' && ctx.rng() < 0.6) {
      pick = this.lastAttack = 'slam';
    } else {
      // Patterns (and their vent) come up twice as often as the rest.
      pick = this.pickAttack(
        ctx,
        ['pattern', 'pattern', 'wall', 'lockdown', 'intake', 'summon'],
        (a) => !(a === 'lockdown' && this.zones.size >= cfg.lockMax) && !(a === 'summon' && this.miteRoom() <= 0 && this.droneRoom() <= 0),
      );
    }
    switch (pick) {
      case 'slam':
        this.slamsLeft = this.phase >= 2 ? 1 : 0;
        this.startSlam(ctx);
        break;
      case 'pattern':
        this.startPattern(ctx);
        this.pairLock = this.hardPair && this.zones.size < cfg.lockMax;
        break;
      case 'wall':
        this.wallsLeft = this.phase >= 2 ? 1 : 0;
        this.startWall(ctx, false);
        if (this.hardPair) this.startPairSlam(ctx);
        break;
      case 'lockdown':
        this.startLock(ctx);
        break;
      case 'intake':
        this.startIntake(ctx);
        break;
      case 'summon':
        this.enter('summon');
        this.summoned = false;
        this.sound('warden.charge', this.cx, this.front, 1.2);
        break;
    }
  }

  // ------------------------------------------------------------ attacks

  private startSlam(ctx: BossContext): void {
    this.enter('slamPrep');
    this.slamSide = ctx.playerX < this.cx ? -1 : 1;
    // Each hand covers its own half of the deck near the alcove.
    const lo = this.slamSide < 0 ? this.x0 + 2 : this.cx + 1;
    const hi = this.slamSide < 0 ? this.cx - 1 : this.x1 - 2;
    this.slamX = THREE.MathUtils.clamp(ctx.playerX, lo, hi);
    this.slamZ = THREE.MathUtils.clamp(ctx.playerZ, this.front + 1.5, this.front + cfg.slamRange);
    const shape: TelegraphShape = { kind: 'circle', x: this.slamX, z: this.slamZ, radius: cfg.slamRadius };
    const p2 = this.phase >= 2;
    this.sound('warden.charge', this.slamX, this.slamZ);
    this.warn(ctx, shape, (p2 ? cfg.slamWindup2 : cfg.slamWindup) * this.sm(), 0xff3a20, () => {
      if (this.state !== 'slamPrep') return;
      this.enter('slam');
      (this.slamSide < 0 ? this.handL : this.handR).y = 2;
      ctx.hitPlayer(shape, cfg.slamAtpMult, this.slamX, this.slamZ, 12);
      ctx.effect(new Ring(this.slamX, this.slamZ, 0xffa040, cfg.slamRadius, 0.4));
      ctx.shake(0.45);
      this.sound('boss.slam', this.slamX, this.slamZ);
    }, p2);
  }

  private startPattern(ctx: BossContext): void {
    const names = (this.phase >= 2 ? PHASE2_PATTERNS : PHASE1_PATTERNS).filter((n) => n !== this.patternName);
    this.patternName = names[Math.floor(ctx.rng() * names.length)];
    this.pattern = PATTERNS[this.patternName];
    this.patternShift = ctx.rng() < 0.5 ? 0 : 1;
    this.waves = this.phase >= 2 ? cfg.patternWaves2 : cfg.patternWaves;
    this.waveW = (this.phase >= 2 ? cfg.patternWindup2 : cfg.patternWindup) * this.sm();
    this.wave = 0;
    this.enter('pattern');
    this.sound('warden.charge', this.cx, this.front + 6, 0.8);
    this.startWave(ctx);
  }

  /** Light up the next wave's cells; they fire after waveW. */
  private startWave(ctx: BossContext): void {
    this.waveT = 0;
    this.lit = [];
    for (let i = 0; i < this.cols * this.rows; i++) {
      const c = i % this.cols;
      const r = Math.floor(i / this.cols);
      if (!this.pattern(c, r, this.wave + this.patternShift, this.cols, this.rows)) continue;
      this.lit.push(i);
      this.warn(ctx, this.cellShape(i), this.waveW, 0xff4020);
    }
  }

  private fireWave(ctx: BossContext): void {
    const centre = this.front + (this.back - this.front) / 2;
    this.sound('warden.zap', this.cx, centre);
    ctx.shake(0.12);
    let hitShape: TelegraphShape | null = null;
    let hx = 0;
    let hz = 0;
    for (const i of this.lit) {
      const f = this.flashes[i];
      f.t = 0.35;
      f.mesh.visible = true;
      const [x, z] = this.cellCentre(i);
      if ((i + this.wave) % 2 === 0) ctx.effect(new Pillar(x, z, 0xff8a50, 0.3, 0.25, 5));
      const shape = this.cellShape(i);
      if (!hitShape && ctx.playerAlive && inShape(shape, ctx.playerX, ctx.playerZ, 0.25)) {
        hitShape = shape;
        hx = x;
        hz = z;
      }
    }
    if (hitShape) ctx.hitPlayer(hitShape, cfg.patternAtpMult, hx, hz, 5);
  }

  private startVent(ctx: BossContext): void {
    this.enter('vent');
    this.sound('warden.vent');
    if (!this.taughtVent) {
      this.taughtVent = true;
      ctx.announce('Its core is venting: strike now!');
    }
  }

  private updateFlashes(dt: number): void {
    for (const f of this.flashes) {
      if (!f.mesh.visible) continue;
      f.t -= dt;
      if (f.t <= 0) f.mesh.visible = false;
      else f.mesh.material.opacity = (f.t / 0.35) * 0.85;
    }
  }

  /** How far from the hall's centre line the laser wall's gap can sit. */
  private get gapRange(): number {
    return (this.x1 - this.x0) / 2 - cfg.wallGap / 2 - 0.5;
  }

  /** A wall from the Warden's side; `follow`: phase 2's second one, its gap 5-8 m from the first. */
  private startWall(ctx: BossContext, follow: boolean): void {
    this.enter('wallPrep');
    const half = this.gapRange;
    const lo = this.cx - half;
    const hi = this.cx + half;
    if (follow) {
      const shift = 5 + ctx.rng() * 3;
      const left = this.wallGap - shift;
      const right = this.wallGap + shift;
      this.wallGap = left < lo ? right : right > hi ? left : ctx.rng() < 0.5 ? left : right;
      this.wallGap = THREE.MathUtils.clamp(this.wallGap, lo, hi);
    } else {
      this.wallGap = lo + ctx.rng() * (hi - lo);
    }
    this.armWall(ctx, this.wallGap, (follow ? cfg.wallWindup2 : cfg.wallWindup) * this.sm(), () => {
      if (this.state !== 'wallPrep') return;
      this.enter('wall');
    });
  }

  /** Set the wall up at the alcove's edge with its gap on `gap` and warn for `dur`; `onFire` sets it off. */
  private armWall(ctx: BossContext, gap: number, dur: number, onFire: () => void, width = cfg.wallGap): void {
    this.wallGap = gap;
    this.wallGapW = width;
    this.wallHit = false;
    this.wallFrom = this.front + 0.5;
    this.wallTo = this.back - 0.5;
    this.wallPrevZ = this.wallFrom;
    this.showWall(this.wallFrom, this.wallGap);
    for (const seg of this.wallSegs) seg.material.opacity = 0.25;
    // Warning: the wall's starting line, with the gap marked by its absence.
    const ga = this.wallGap - this.wallGapW / 2;
    const gb = this.wallGap + this.wallGapW / 2;
    const zLine = this.wallFrom;
    this.warn(ctx, { kind: 'line', x: this.x0, z: zLine, yaw: Math.PI / 2, length: ga - this.x0, width: 1.2 }, dur, 0xff3020);
    this.warn(ctx, { kind: 'line', x: gb, z: zLine, yaw: Math.PI / 2, length: this.x1 - gb, width: 1.2 }, dur, 0xff3020, onFire);
    this.sound('warden.grid', this.cx, zLine);
  }

  /** Run the wall `t` s down the hall, hitting anyone off the gap's lane it sweeps past. True once it reached the back. */
  private sweepWall(ctx: BossContext, t: number): boolean {
    const k = Math.min(1, t / cfg.wallTime);
    const z = this.wallFrom + (this.wallTo - this.wallFrom) * k;
    this.showWall(z, this.wallGap);
    // It moves several metres a frame: test the whole stretch it swept.
    const lo = Math.min(this.wallPrevZ, z) - 0.5;
    const hi = Math.max(this.wallPrevZ, z) + 0.5;
    this.wallPrevZ = z;
    if (!this.wallHit && ctx.playerAlive && ctx.playerZ >= lo && ctx.playerZ <= hi && Math.abs(ctx.playerX - this.wallGap) > this.wallGapW / 2 - 0.3) {
      this.wallHit = true;
      // Shoved along the way the wall travels.
      ctx.hazardHit(this.flat(cfg.wallDamage), ctx.playerX, ctx.playerZ - 1, 9, 'Laser wall');
      ctx.burnPlayer(cfg.wallBurn);
    }
    if (k < 1) return false;
    this.wallGroup.visible = false;
    ctx.shake(0.2);
    return true;
  }

  /** Hard, phase 2: attacks come in pairs. */
  private get hardPair(): boolean {
    return !!this.hard && this.phase >= 2;
  }

  /**
   * Hard pair: a hand slams down on you while the first wall's warning is up. It lands before the
   * wall sets off, and never on the gap's lane: stepping toward the gap clears both.
   */
  private startPairSlam(ctx: BossContext): void {
    const keep = cfg.wallGap / 2 + cfg.slamRadius + 0.5;
    let x = ctx.playerX;
    if (Math.abs(x - this.wallGap) < keep) x = this.wallGap + (x < this.wallGap ? -keep : keep);
    if (x < this.x0 + 1.5 || x > this.x1 - 1.5) return; // no room beside the lane: the wall comes alone
    this.slamAt(ctx, x, THREE.MathUtils.clamp(ctx.playerZ, this.front + 2, this.back - 2), cfg.slamWindup * this.sm());
  }

  /** A hand slam (posed by posePairSlam) on (x, z) after `dur`, alongside another attack. */
  private slamAt(ctx: BossContext, x: number, z: number, dur: number): void {
    const side = x < this.cx ? -1 : 1;
    this.pairSlam = { x, z, side, downT: -1 };
    const shape: TelegraphShape = { kind: 'circle', x, z, radius: cfg.slamRadius };
    this.sound('warden.charge', x, z);
    this.warn(ctx, shape, dur, 0xff3a20, () => {
      if (!this.pairSlam) return;
      this.pairSlam.downT = 0;
      (side < 0 ? this.handL : this.handR).y = 2;
      ctx.hitPlayer(shape, cfg.slamAtpMult, x, z, 12);
      ctx.effect(new Ring(x, z, 0xffa040, cfg.slamRadius, 0.4));
      ctx.shake(0.45);
      this.sound('boss.slam', x, z);
    });
  }

  /** The paired slam's hand: raised over its target, then down for a moment after it lands. */
  private posePairSlam(dt: number, setRate: (r: number) => void): void {
    const s = this.pairSlam;
    if (!s) return;
    if (s.downT >= 0) {
      s.downT += dt;
      if (s.downT > 0.6) {
        this.pairSlam = null;
        return;
      }
    }
    setRate(s.downT >= 0 ? 20 : 4);
    this.local(s.side < 0 ? this.goalL : this.goalR, s.x, s.downT >= 0 ? WARDEN_HAND_REST.y : 6.5, s.z);
  }

  /** Hard pair: early in a pattern, the cell you stand on is locked down too (it ignites on its own). */
  private pairLockdown(ctx: BossContext): void {
    this.pairLock = false;
    const cell = this.cellAt(ctx.playerX, ctx.playerZ);
    if (this.zones.has(cell) || this.zones.size >= cfg.lockMax) return;
    this.lockCell(ctx, cell, cfg.lockWindup * this.sm());
  }

  /** Lock a cell down alongside another attack: it ignites on its own after `dur`. */
  private lockCell(ctx: BossContext, cell: number, dur: number): void {
    const [x, z] = this.cellCentre(cell);
    this.sound('warden.charge', x, z, 0.8);
    this.warn(ctx, this.cellShape(cell), dur, 0xff8a20, () => {
      if (this.alive) this.ignite(cell, ctx);
    });
  }

  /** Place the laser wall at depth `z` with its gap centred on `g`. */
  private showWall(z: number, g: number): void {
    const half = this.wallGapW / 2;
    this.wallGroup.visible = true;
    this.wallGroup.position.set(0, 0, z);
    const spans: [number, number][] = [[this.x0, g - half], [g + half, this.x1]];
    this.wallSegs.forEach((seg, i) => {
      const [a, b] = spans[i];
      seg.scale.x = Math.max(0.05, b - a);
      seg.position.x = (a + b) / 2;
      if (this.state === 'wall' || this.wallT >= 0) seg.material.opacity = 0.5 + Math.sin(this.time * 30 + i) * 0.1;
    });
  }

  private startLock(ctx: BossContext): void {
    const free = (i: number) => !this.zones.has(i);
    const here = this.cellAt(ctx.playerX, ctx.playerZ);
    let first = here;
    if (!free(first)) {
      // Already burning under you: the nearest free cell instead.
      let best = Infinity;
      for (let i = 0; i < this.cols * this.rows; i++) {
        if (!free(i)) continue;
        const [x, z] = this.cellCentre(i);
        const d = Math.hypot(x - ctx.playerX, z - ctx.playerZ);
        if (d < best) {
          best = d;
          first = i;
        }
      }
    }
    this.lockCells = [first];
    if (this.phase >= 2 && this.zones.size + 2 <= cfg.lockMax) {
      const others: number[] = [];
      for (let i = 0; i < this.cols * this.rows; i++) if (free(i) && i !== first) others.push(i);
      if (others.length) this.lockCells.push(others[Math.floor(ctx.rng() * others.length)]);
    }
    this.lockW = cfg.lockWindup * this.sm();
    for (const c of this.lockCells) this.warn(ctx, this.cellShape(c), this.lockW, 0xff8a20);
    const [x, z] = this.cellCentre(first);
    this.sound('warden.charge', x, z, 0.8);
    this.enter('lockPrep');
  }

  /** Turn a cell into burning floor. */
  private ignite(cell: number, ctx: BossContext): void {
    if (this.zones.has(cell)) return;
    const [x, z] = this.cellCentre(cell);
    const w = this.cw - CELL_INSET * 2;
    const d = this.ch - CELL_INSET * 2;
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    const decal = new THREE.MeshBasicMaterial({ color: 0xff5a18, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending });
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), decal);
    plate.position.y = 0.04;
    group.add(plate);
    // A bright frame so the zone's edge is easy to read.
    const frameMat = new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending });
    for (const [fw, fd, fx, fz] of [[w, 0.12, 0, -d / 2], [w, 0.12, 0, d / 2], [0.12, d, -w / 2, 0], [0.12, d, w / 2, 0]]) {
      const bar = new THREE.Mesh(new THREE.PlaneGeometry(fw, fd).rotateX(-Math.PI / 2), frameMat);
      bar.position.set(fx, 0.045, fz);
      group.add(bar);
    }
    const n = 46;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) pos.set([(Math.random() - 0.5) * w, Math.random() * 1.4, (Math.random() - 0.5) * d], i * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const flames = new THREE.Points(geo, new THREE.PointsMaterial({ map: glowTexture(), color: 0xff8a30, size: 0.45, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    group.add(flames);
    this.fx.add(group);
    this.zones.set(cell, { group, decal, flames, pos });
    this.sound('warden.ignite', x, z, 0.6);
    ctx.effect(new Ring(x, z, 0xff8a30, Math.max(w, d) * 0.6, 0.35));
    if (this.zones.size >= cfg.lockMax) this.holdT = cfg.lockHold;
  }

  private updateZones(dt: number, ctx: BossContext): void {
    if (!this.zones.size) return;
    for (const z of this.zones.values()) {
      z.decal.opacity = 0.34 + Math.sin(this.time * 7 + z.group.position.x) * 0.08;
      for (let i = 0; i < z.pos.length; i += 3) {
        let y = z.pos[i + 1] + dt * 1.8;
        if (y > 1.5) y -= 1.5;
        z.pos[i + 1] = y;
      }
      z.flames.geometry.attributes.position.needsUpdate = true;
    }
    // Standing in a zone: damage every half second, Burn every second.
    this.zoneTickT += dt;
    if (this.zoneTickT >= 0.5) {
      this.zoneTickT -= 0.5;
      const cell = this.cellAt(ctx.playerX, ctx.playerZ);
      const shape = this.cellShape(cell, 0);
      if (ctx.playerAlive && this.zones.has(cell) && inShape(shape, ctx.playerX, ctx.playerZ, 0)) {
        const [x, z] = this.cellCentre(cell);
        ctx.tickPlayer(shape, this.flat(cfg.lockTick), x, z);
        if (++this.zoneTicks % 2 === 1) ctx.burnPlayer(1);
      } else this.zoneTicks = 0;
    }
    // At the cap the zones hold a while, then all reset.
    if (this.zones.size >= cfg.lockMax) {
      this.holdT -= dt;
      if (this.holdT <= 0) {
        for (const z of this.zones.values()) ctx.effect(new Ring(z.group.position.x, z.group.position.z, 0x80d8ff, 2.6, 0.5));
        this.clearZones();
        this.sound('warden.purge', this.cx, this.front + 8);
        ctx.announce('The lockdown zones reset');
      }
    }
  }

  private clearZones(): void {
    for (const z of this.zones.values()) {
      this.fx.remove(z.group);
      z.group.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.Points) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
    }
    this.zones.clear();
  }

  // -------------------------------------------------------- Hell triples

  /** A triple (not the last one again) around a safe cell near you; false if none fits (it attacks normally). */
  private startTriple(ctx: BossContext): boolean {
    const kinds = TRIPLES.filter((k) => k !== this.lastTriple);
    if (ctx.rng() < 0.5) kinds.reverse();
    if (this.lastTriple) kinds.push(this.lastTriple);
    for (const kind of kinds) {
      const plan = this.planTriple(ctx, kind);
      if (!plan) continue;
      this.lastTriple = kind;
      // It counts as a pattern (it vents too) for the no-repeat pick.
      this.lastAttack = 'pattern';
      this.triple = plan;
      this.thirdOut = false;
      this.waveFired = false;
      this.wallT = -1;
      this.pairSlam = null;
      this.wave = 0;
      this.waveT = 0;
      this.waveW = cfg.tripleWindup * this.sm();
      this.enter('triple');
      this.sound('warden.charge', this.cx, this.front + 6, 1.2);
      // The first two: the floor wave, and the wall (or the lockdown). The slam (or the lockdown) follows.
      this.lit = plan.lit;
      for (const i of plan.lit) this.warn(ctx, this.cellShape(i), this.waveW, 0xff4020);
      if (plan.gap !== null) {
        this.armWall(ctx, plan.gap, this.waveW, () => {
          if (this.state === 'triple') this.wallT = 0;
        }, this.cw);
      } else for (const c of plan.locks) this.lockCell(ctx, c, this.waveW);
      return true;
    }
    return false;
  }

  /** The third attack, a moment after the first two; it fires with them. */
  private startThird(ctx: BossContext): void {
    this.thirdOut = true;
    const plan = this.triple;
    if (!plan) return;
    const dur = this.waveW - this.waveT;
    if (plan.slam !== null) {
      const [x, z] = this.cellCentre(plan.slam);
      this.slamAt(ctx, x, z, dur);
    } else for (const c of plan.locks) this.lockCell(ctx, c, dur);
  }

  /** Pick the safe cell first (not yours, within reach, not burning, not under its core), then build the triple around it. */
  private planTriple(ctx: BossContext, kind: Triple): TriplePlan | null {
    const here = this.cellAt(ctx.playerX, ctx.playerZ);
    const plans: TriplePlan[] = [];
    for (let s = 0; s < this.cols * this.rows; s++) {
      if (s === here || this.zones.has(s) || this.toCell(s, ctx.playerX, ctx.playerZ) > cfg.tripleReach) continue;
      // The core juts into the cells in front of it and would shove you off the lane.
      if (this.toCell(s, this.body.pos.x, this.body.pos.z) < cfg.bodyRadius + 1) continue;
      const plan = this.planAround(kind, s, here);
      if (plan) plans.push(plan);
    }
    return plans.length ? plans[Math.floor(ctx.rng() * plans.length)] : null;
  }

  /**
   * Build a triple around safe cell `s` (you stand on `here`), or null if it can't be:
   *  - diagonals: the wall's gap lines up with s; a diagonals wave leaves s and the cell three rows off it
   *    dark in that lane, and a hand slams that one;
   *  - bands: the same wall; a bands wave leaves every other cell of the lane dark, and those besides s lock down;
   *  - holes: the whole deck lights up but three holes: s, your cell (locked down) and one at least a cell
   *    clear of s (slammed).
   */
  private planAround(kind: Triple, s: number, here: number): TriplePlan | null {
    const cols = this.cols;
    const rows = this.rows;
    const all = Array.from({ length: cols * rows }, (_, i) => i);
    const sc = s % cols;
    const sr = Math.floor(s / cols);
    const room = cfg.lockMax - this.zones.size;
    if (kind === 'holes') {
      if (room < 1) return null;
      const far = (i: number) => Math.max(Math.abs((i % cols) - sc), Math.abs(Math.floor(i / cols) - sr)) >= 2;
      const steps = (i: number) => Math.max(Math.abs((i % cols) - (here % cols)), Math.abs(Math.floor(i / cols) - Math.floor(here / cols)));
      // Your cell (already burning: a free one next to it).
      const lock = this.zones.has(here) ? all.find((i) => i !== s && !this.zones.has(i) && steps(i) === 1) : here;
      if (lock === undefined) return null;
      let slam = -1;
      for (const i of all) {
        if (i === lock || this.zones.has(i) || !far(i)) continue;
        if (slam < 0 || steps(i) < steps(slam)) slam = i;
      }
      if (slam < 0) return null;
      return { kind, safe: s, lit: all.filter((i) => i !== s && i !== lock && i !== slam), gap: null, slam, locks: [lock] };
    }
    // The wall's gap on the safe cell's column (the edge columns are out of its reach).
    const gap = this.cellCentre(s)[0];
    if (Math.abs(gap - this.cx) > this.gapRange) return null;
    const lane = all.filter((i) => i % cols === sc);
    const pattern = PATTERNS[kind];
    // The wave whose pattern leaves s dark.
    const w = kind === 'diagonals' ? (3 - ((sc + sr) % 3)) % 3 : (sr + 1) % 2;
    const lit = all.filter((i) => pattern(i % cols, Math.floor(i / cols), w, cols, rows));
    const dark = lane.filter((i) => i !== s && !lit.includes(i));
    if (kind === 'diagonals') return dark.length === 1 ? { kind, safe: s, lit, gap, slam: dark[0], locks: [] } : null;
    const locks = dark.filter((i) => !this.zones.has(i));
    return locks.length && locks.length <= room ? { kind, safe: s, lit, gap, slam: null, locks } : null;
  }

  /** Distance from (x, z) to the inner part of cell i (SAFE_INSET in from its edges). */
  private toCell(i: number, x: number, z: number): number {
    const [cx, cz] = this.cellCentre(i);
    const dx = Math.max(0, Math.abs(x - cx) - (this.cw / 2 - SAFE_INSET));
    const dz = Math.max(0, Math.abs(z - cz) - (this.ch / 2 - SAFE_INSET));
    return Math.hypot(dx, dz);
  }

  // ------------------------------------------------------------- intake

  private startIntake(ctx: BossContext): void {
    this.enter('intakePrep');
    const depth = this.ch * Math.min(cfg.intakeRows, this.rows);
    this.intakeShape = { kind: 'line', x: this.cx, z: this.front, yaw: 0, length: depth, width: this.x1 - this.x0 };
    // One warning for the whole draw: it fills as the blast gets closer.
    this.warn(ctx, this.intakeShape, cfg.intakeWindup * this.sm() + cfg.intakeTime, 0xff3020);
    this.sound('warden.charge', this.body.pos.x, this.body.pos.z, 1.4);
  }

  private fireIntake(ctx: BossContext): void {
    const shape = this.intakeShape;
    this.intakeK = 0;
    if (shape) {
      ctx.hitPlayer(shape, cfg.intakeAtpMult, this.cx, this.front - 2, 14);
      const depth = shape.kind === 'line' ? shape.length : 0;
      for (let x = this.x0 + 2; x < this.x1; x += 4) ctx.effect(new Pillar(x, this.front + depth / 2, 0xffa060, 0.35, 0.3, 6));
    }
    this.sound('warden.zap', this.cx, this.front + 4);
    ctx.shake(0.45);
    this.endAttack();
  }

  private respawnMote(i: number, rng: () => number): void {
    this.motePos[i * 3] = this.x0 + rng() * (this.x1 - this.x0);
    this.motePos[i * 3 + 1] = 0.3 + rng() * 2.5;
    this.motePos[i * 3 + 2] = this.front + 2 + rng() * (this.back - this.front - 2);
  }

  /** Motes rush into the core while it draws. */
  private updateMotes(dt: number): void {
    if (this.state !== 'intakePrep' && this.state !== 'intake') this.intakeK = Math.max(0, this.intakeK - dt * 3);
    const m = this.motes.material as THREE.PointsMaterial;
    m.opacity = this.intakeK * 0.9;
    this.motes.visible = this.intakeK > 0.01;
    if (!this.motes.visible) return;
    const tx = this.cx;
    const ty = 3.6;
    const tz = this.front - 0.9;
    for (let i = 0; i < INTAKE_MOTES; i++) {
      const o = i * 3;
      const dx = tx - this.motePos[o];
      const dy = ty - this.motePos[o + 1];
      const dz = tz - this.motePos[o + 2];
      const d = Math.hypot(dx, dy, dz);
      if (d < 1.2) {
        this.respawnMote(i, Math.random);
        continue;
      }
      const sp = (4 + 14 / Math.max(1, d * 0.3)) * dt * (0.4 + this.intakeK);
      this.motePos[o] += (dx / d) * sp;
      this.motePos[o + 1] += (dy / d) * sp;
      this.motePos[o + 2] += (dz / d) * sp;
    }
    this.motes.geometry.attributes.position.needsUpdate = true;
  }

  // --------------------------------------------------------------- adds

  private miteRoom(): number {
    return Math.min(cfg.summonMites, cfg.maxMites - this.adds.filter((e) => e instanceof SparkMite && e.alive).length);
  }

  private droneRoom(): number {
    return cfg.maxDrones - this.adds.filter((e) => e instanceof RepairDrone && e.alive).length;
  }

  /** Mites climb out along the alcove's edge; a drone (every other summon, every one in phase 2) heads for a corner post. */
  private summon(ctx: BossContext): void {
    this.summoned = true;
    this.summons++;
    this.adds = this.adds.filter((e) => e.alive);
    const mites = this.miteRoom();
    for (let i = 0; i < mites; i++) {
      const x = this.cx + (i - (mites - 1) / 2) * 7 + (ctx.rng() - 0.5) * 2;
      this.adds.push(ctx.spawnAdd('SparkMite', x, this.front + 1.2));
    }
    const wantDrone = this.phase >= 2 || this.summons % 2 === 0;
    if (wantDrone && this.droneRoom() > 0) {
      const taken = this.adds.filter((e): e is RepairDrone => e instanceof RepairDrone && e.alive).map((d) => Math.sign(d.post.x - this.cx));
      const side = !taken.includes(-1) ? (taken.includes(1) || ctx.rng() < 0.5 ? -1 : 1) : 1;
      const drone = ctx.spawnAdd('RepairDrone', this.cx + side * 5, this.front + 0.8);
      if (drone instanceof RepairDrone) drone.post.set(side < 0 ? this.x0 + 2.5 : this.x1 - 2.5, 0, this.front + 2.5);
      this.adds.push(drone);
    }
    ctx.shake(0.25);
    this.sound('boss.slam', this.cx, this.front + 1);
  }

  /** Repairing drones heal the core and show their beams. */
  private updateAdds(dt: number, ctx: BossContext): void {
    let b = 0;
    for (const e of this.adds) {
      if (!(e instanceof RepairDrone) || !e.alive || !e.repairing || b >= this.beams.length) continue;
      // On Hard the repair follows the Normal pool (scaled like flat damage), not the bigger HP bar.
      this.hp = Math.min(this.maxHp, this.hp + cfg.hp * cfg.droneHealPct * (this.hard?.flat ?? 1) * dt);
      if (!this.taughtRepair) {
        this.taughtRepair = true;
        ctx.announce('A Repair Drone is mending the Warden!');
      }
      const beam = this.beams[b++];
      const from = new THREE.Vector3(e.pos.x, 1.8, e.pos.z);
      const to = new THREE.Vector3(this.cx, 3.6, this.front - 0.9);
      beam.visible = true;
      beam.position.copy(from).add(to).multiplyScalar(0.5);
      beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.sub(from).normalize());
      beam.scale.set(1, from.distanceTo(new THREE.Vector3(this.cx, 3.6, this.front - 0.9)), 1);
      beam.material.opacity = 0.45 + Math.sin(this.time * 18 + b) * 0.15;
    }
    for (; b < this.beams.length; b++) this.beams[b].visible = false;
  }

  private startOverclock(ctx: BossContext): void {
    this.phase = 2;
    this.escalate(ctx, 'The Warden overclocks!');
    ctx.shake(0.5);
    this.sound('warden.reroute');
    this.enter('overclock');
  }

  /** Hell: phase 3. Its glow turns violet and triples join the rotation, the first one straight away. */
  private startPhase3(ctx: BossContext): void {
    this.phase = 3;
    this.sinceTriple = cfg.tripleEvery - 1;
    this.escalate(ctx, 'The Warden breaks its limits!');
    ctx.shake(0.6);
    this.sound('warden.reroute');
    // The core keeps its own colours (the model sets them each frame).
    this.model.root.traverse((o) => {
      if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshStandardMaterial && o.material.userData.glow) o.material.emissive.setHex(CORRUPT_COLOR);
    });
    this.enter('overclock');
  }

  // ------------------------------------------------------------- posing

  private place(): void {
    this.model.root.position.set(this.cx, 0, this.rootZ);
    this.model.pose({
      charge: this.charge,
      cast: this.cast,
      coreOpen: this.coreOpen,
      handL: this.handL,
      handR: this.handR,
      dead: this.state === 'dead' ? Math.min(1, this.deadT / 1.5) : 0,
      flash: this.flashT > 0,
      enraged: this.enraged && this.phase >= 2,
      time: this.time,
    });
  }
}
