import * as THREE from 'three';
import { sfx } from '../../audio';
import { deRolLe as cfg, type HardBossScale } from '../config';
import { separateCircles, turnToward } from '../collision';
import type { Hittable } from '../combat/types';
import { DeRolLeModel } from '../models/derolle';
import { Lob, Pillar, Ring } from '../world/Effects';
import { glowMaterial } from '../world/glow';
import { WATER_Y, type Level, type Rect } from '../world/Level';
import type { TelegraphShape } from '../world/Telegraph';
import type { BossContext } from './Boss';
import { BossBase, BossPart } from './BossBase';
import { CORRUPT_COLOR } from './Enemy';

// De Rol Le: the Cave boss. A giant armoured worm that swims around (and under)
// the raft the player stands on. It attacks from the water and only offers
// its body in readable windows:
//  - Bomb barrage: swims alongside, the back segments lob mines (ground circles
//    in row / cross / scatter patterns). Its flank is in reach of the deck edge.
//  - Lane slam: a lane across the raft lights up, the body crashes over it and
//    lies across the deck for a moment (the main melee window).
//  - Sweeping beam: rears at one end and sweeps a beam over part of the raft
//    (the outline shows the whole sweep; the far end is out of range), then
//    rests its head on the deck (weak point).
//  - Poison spray (phase 2): lingering puddles that shrink the safe space.
// Phase 1: shell plates on every segment and a bone mask on the head take
// most of the damage. Breaking the mask (or dropping it to half HP) shatters
// the shell: phase 2 is faster, meaner and takes more damage.
// Hell: at a third of its HP it turns to the dark (phase 3). Every second attack
// is then a triple: three warnings at once with one safe pocket (see slamTriple
// and beamTriple).

type DrlState =
  | 'dormant'
  | 'intro'
  | 'dive'
  | 'swim'
  | 'bombPrep'
  | 'bombs'
  | 'slamPrep'
  | 'slamRise'
  | 'slamCross'
  | 'slamRest'
  | 'beamPrep'
  | 'beamRise'
  | 'beaming'
  | 'headRest'
  | 'sprayPrep'
  | 'sprayRise'
  | 'spraying'
  | 'shatter'
  | 'dead';

type Attack = 'bombs' | 'slam' | 'beam' | 'spray';

/** Head depth while swimming out of sight, and at the surface. */
const DEEP = -3.8;
const SURFACE = WATER_Y + 0.45;
/** Parts whose centre is below this are under water: they can't be hit. */
const SUBMERGED = WATER_Y - 0.25;
const HEAD_RADIUS = 1.5;
/** Hard: metres of clear deck between the slam lane and the row of mines paired with it. */
const HARD_ROW_GAP = 2.5;
/** The player's body radius: telegraphs hit if they reach it (inShape), so triple pockets keep this clear too. */
const BODY = 0.45;

/** Polyline of where the head has been (newest first); the body follows it. */
class Trail {
  private pts: THREE.Vector3[] = [];

  constructor(start: THREE.Vector3, back: THREE.Vector3, private maxLen: number) {
    for (let d = 0; d <= maxLen + 2; d += 1) this.pts.push(start.clone().addScaledVector(back, d));
  }

  push(p: THREE.Vector3): void {
    if (p.distanceTo(this.pts[0]) < 0.2) return;
    this.pts.unshift(p.clone());
    let len = 0;
    for (let i = 1; i < this.pts.length; i++) {
      len += this.pts[i].distanceTo(this.pts[i - 1]);
      if (len > this.maxLen + 3) {
        this.pts.length = i + 1;
        break;
      }
    }
  }

  /** Point `d` metres back along the trail from `head`. */
  sample(head: THREE.Vector3, d: number, out: THREE.Vector3): THREE.Vector3 {
    let prev = head;
    let left = d;
    for (const p of this.pts) {
      const seg = prev.distanceTo(p);
      if (seg >= left && seg > 1e-6) return out.lerpVectors(prev, p, left / seg);
      left -= seg;
      prev = p;
    }
    return out.copy(prev);
  }
}

/** The head's aim point and the segments': a little above the part. */
const partAim = (p: BossPart) => p.pos.y + 0.6;

export class DeRolLe extends BossBase<DrlState, Attack> {
  readonly id = 'derolle' as const;
  readonly objects: THREE.Object3D[];
  phase: 1 | 2 = 1;
  /** Hell: phase 3 (still phase 2's rules otherwise), and whether the current attack is a triple. */
  private phase3 = false;
  private triple = false;
  private attacks3 = 0;
  private lastTriple: 'slam' | 'beam' = 'beam';
  /** Phase 3's violet glow goes on these (the body segments' materials). */
  private hellMats: THREE.MeshStandardMaterial[];

  private model: DeRolLeModel;
  private head: THREE.Vector3;
  private headYaw = 0;
  private headPitch = 0;
  private trail: Trail;
  /** The head (index -1), then the body segments. */
  private readonly partsList: BossPart[] = [];
  private plates: number[];
  private maskHp: number;
  private wantShatter = false;
  private jaw = 0;
  private charge = 0;
  private sink = 0;
  // Raft geometry.
  private cx: number;
  private cz: number;
  private hw: number;
  private hl: number;
  // Per-attack scratch.
  private side = 1;
  private laneZ = 0;
  private slamsLeft = 0;
  private swimAngle = 0;
  private volleys = 0;
  private volleyT = 0;
  private zEnd = 0;
  private end = -1;
  private beamFrom = 0;
  private beamTo = 0;
  /** Where the head rears for the beam (the triple moves it off the centre line). */
  private beamX = 0;
  private beamTick = 0;
  private fired = false;
  private beam: THREE.Group;
  private beamMat: THREE.MeshBasicMaterial;
  private beamGround: THREE.Mesh;
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();

  constructor(
    private raft: Rect,
    hard: HardBossScale | null = null,
  ) {
    super(cfg, hard);
    this.maskHp = Math.round(cfg.maskHp * (hard?.hp ?? 1));
    this.cx = (raft.minX + raft.maxX) / 2;
    this.cz = (raft.minZ + raft.maxZ) / 2;
    this.hw = (raft.maxX - raft.minX) / 2;
    this.hl = (raft.maxZ - raft.minZ) / 2;
    this.model = new DeRolLeModel(cfg.segments);
    this.hellMats = [...new Set(this.model.segs.slice(0, 2).map((g) => (g.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial))];
    this.plates = Array.from({ length: cfg.segments }, () => Math.round(cfg.plateHp * (hard?.hp ?? 1)));
    this.head = new THREE.Vector3(this.cx, DEEP - 2, raft.minZ - 16);
    this.trail = new Trail(this.head, new THREE.Vector3(0, 0, -1), (cfg.segments + 1) * cfg.segSpacing);
    this.partsList.push(new BossPart(this, HEAD_RADIUS, partAim, -1));
    for (let i = 0; i < cfg.segments; i++) this.partsList.push(new BossPart(this, 1.25 - i * 0.055, partAim, i));

    // The beam: a glowing shaft from the mouth plus the strip of deck it scorches.
    this.beamMat = new THREE.MeshBasicMaterial({ color: 0xe080ff, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending });
    this.beam = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.9, 1, 8, 1, true).translate(0, 0.5, 0), this.beamMat);
    shaft.name = 'shaft';
    this.beam.add(shaft);
    this.beam.visible = false;
    const half = THREE.MathUtils.degToRad(cfg.beamArcDeg) / 2;
    this.beamGround = new THREE.Mesh(
      new THREE.CircleGeometry(cfg.beamRange, 16, Math.PI / 2 - half, half * 2).rotateX(-Math.PI / 2).rotateY(Math.PI),
      glowMaterial(0xff60ff, 0.55),
    );
    this.beamGround.visible = false;
    this.beamGround.renderOrder = 1;
    this.objects = [this.model.root, this.beam, this.beamGround];
    this.placeParts();
  }

  // ---------------------------------------------------------------- Boss

  get weakPointOpen(): boolean {
    return this.state === 'headRest';
  }
  parts(): Hittable[] {
    return this.partsList;
  }

  collide(playerPos: THREE.Vector3, playerRadius: number, level: Level): void {
    // The body only blocks you while it lies on the deck.
    if (this.state !== 'slamRest' && this.state !== 'headRest' && this.state !== 'shatter') return;
    for (const p of this.partsList) {
      if (p.pos.y < -0.2 || p.pos.y > 2.2) continue;
      separateCircles(playerPos, playerRadius, 1, p.pos, p.radius * 0.85, 1e6);
    }
    level.resolveCircle(playerPos, playerRadius);
  }

  // -------------------------------------------------------------- damage

  /** Asleep, rearing out of the river, shattering, dead, or that part is under water. */
  partInvulnerable(p: BossPart): boolean {
    if (this.untouchable || this.state === 'shatter') return true;
    return p.pos.y < SUBMERGED;
  }

  /** Damage multiplier shown on the hit (shell plates soak most of a blow). */
  partMult(p: BossPart): number {
    if (this.phase === 1) {
      if (p.index < 0) return cfg.plateMult * (this.state === 'headRest' ? cfg.headRestMult : 1);
      return this.plates[p.index] > 0 ? cfg.plateMult : 1;
    }
    return cfg.phase2DamageMult * (p.index < 0 && this.state === 'headRest' ? cfg.headRestMult : 1);
  }

  damagePart(p: BossPart, amount: number): boolean {
    if (!this.alive || this.partInvulnerable(p)) return false;
    if (this.phase === 1) {
      // Mask and plates take the blow at full strength; the boss only feels the share that gets through.
      if (p.index < 0) {
        this.maskHp -= amount / cfg.plateMult;
        if (this.maskHp <= 0) this.wantShatter = true;
      } else if (this.plates[p.index] > 0) {
        this.plates[p.index] -= amount / cfg.plateMult;
        if (this.plates[p.index] <= 0) this.breakPlate(p.index);
      }
    }
    const killed = this.loseHp(amount);
    if (!killed && this.phase === 1 && this.hp <= this.maxHp * cfg.phase2At) this.wantShatter = true;
    return killed;
  }

  protected onDeath(): void {
    this.hideBeam();
  }

  private breakPlate(i: number): void {
    this.plates[i] = 0;
    this.model.plates[i].visible = false;
    this.pendingFx.push({ kind: 'plate', i });
  }

  /** Effects queued from damage() (which has no context), played on the next update. */
  private pendingFx: { kind: 'plate'; i: number }[] = [];

  // -------------------------------------------------------------- update

  protected enter(s: DrlState): void {
    // The head breaking the surface or going under splashes.
    const under = (st: DrlState) => st === 'dive' || st === 'swim' || st.endsWith('Prep');
    if (this.state !== 'dormant' && s !== 'dead' && under(s) !== under(this.state)) this.sound('drl.splash');
    super.enter(s);
    this.fired = false;
  }

  protected get anchor(): THREE.Vector3 {
    return this.head;
  }

  /** Move the head toward a point at a capped speed; returns the distance left. */
  private steer(dt: number, tx: number, ty: number, tz: number, speed: number, face = true): number {
    const d = this.tmp.set(tx - this.head.x, ty - this.head.y, tz - this.head.z);
    const len = d.length();
    if (len > 1e-4) {
      const step = Math.min(len, speed * dt);
      this.head.addScaledVector(d, step / len);
      const horiz = Math.hypot(d.x, d.z);
      if (face && horiz > 0.05) this.headYaw = turnToward(this.headYaw, Math.atan2(d.x, d.z), 5 * dt);
      const pitch = horiz > 0.05 || Math.abs(d.y) > 0.05 ? -Math.atan2(d.y, Math.max(horiz, 0.5)) * 0.7 : 0;
      this.headPitch += (pitch - this.headPitch) * Math.min(1, 6 * dt);
      return len - step;
    }
    return 0;
  }

  /** Turn the head to look at a point (rearing states). */
  private look(dt: number, x: number, z: number, rate = 4): void {
    this.headYaw = turnToward(this.headYaw, Math.atan2(x - this.head.x, z - this.head.z), rate * dt);
    this.headPitch += (0.15 - this.headPitch) * Math.min(1, 4 * dt);
  }

  private clampToRaft(x: number, z: number, inset = 0.6): [number, number] {
    const r = this.raft;
    return [Math.min(r.maxX - inset, Math.max(r.minX + inset, x)), Math.min(r.maxZ - inset, Math.max(r.minZ + inset, z))];
  }

  protected always(_dt: number, ctx: BossContext): void {
    for (const fx of this.pendingFx) {
      const p = this.partsList[fx.i + 1].pos;
      ctx.effect(new Ring(p.x, p.z, 0xe8e0c0, 3, 0.4));
      ctx.shake(0.12);
      this.sound('drl.plate', p.x, p.z);
    }
    if (this.pendingFx.length) ctx.announce(this.plates.some((v) => v > 0) ? 'Shell plate broken!' : 'Every plate is broken!');
    this.pendingFx.length = 0;
  }

  protected whileDead(dt: number): void {
    this.sink += dt * 1.1;
    this.jaw = 1;
    this.head.y -= dt * 0.6;
    this.placeParts();
  }

  // Damage over time lands on the first part above water (BossBase.dotTarget).

  protected think(dt: number, ctx: BossContext): void {
    if (this.wantShatter && this.phase === 1 && this.state !== 'intro' && this.state !== 'dormant') this.startShatter(ctx);
    if (this.hard?.hell && this.phase === 2 && !this.phase3 && this.state !== 'shatter' && this.hp <= this.maxHp * cfg.phase3At) this.startPhase3(ctx);
    this.announceEnrage(ctx, this.phase === 2, 'De Rol Le is enraged!', 'drl.screech');

    const sm = this.sm();
    this.jaw += (0 - this.jaw) * Math.min(1, 3 * dt);
    this.charge = Math.max(0, this.charge - dt * 2);

    switch (this.state) {
      case 'dormant':
        if (ctx.playerAlive && this.stateT > 1.2) {
          this.awaken(ctx, 'DE ROL LE', 0.5, 'drl.splash');
          setTimeout(() => this.sound('drl.screech'), 1500);
        }
        break;

      case 'intro':
        // Bursts out of the river ahead of the raft and roars.
        this.steer(dt, this.cx, 3.4, this.raft.minZ - 6, 7, false);
        this.look(dt, ctx.playerX, ctx.playerZ);
        if (this.stateT > 1.6) this.jaw = 1;
        if (this.stateT > 3.2) this.enter('dive');
        break;

      case 'dive': {
        // Sink away from the raft, then swim.
        const ox = this.head.x - this.cx;
        const oz = this.head.z - this.cz;
        const len = Math.hypot(ox, oz) || 1;
        this.steer(dt, this.head.x + (ox / len) * 3, DEEP, this.head.z + (oz / len) * 3, 8);
        if (this.head.y < DEEP + 0.4 || this.stateT > 1.6) {
          this.swimAngle = Math.atan2(this.head.x - this.cx, this.head.z - this.cz);
          this.gap = (this.phase === 2 ? cfg.attackGap2 : cfg.attackGap) * sm;
          this.enter('swim');
        }
        break;
      }

      case 'swim': {
        // Circle under the water around the raft until the next attack.
        this.swimAngle += (this.phase === 2 ? 0.5 : 0.38) * dt;
        const tx = this.cx + Math.sin(this.swimAngle) * (this.hw + 9);
        const tz = this.cz + Math.cos(this.swimAngle) * (this.hl + 9);
        this.steer(dt, tx, DEEP, tz, 12);
        if (this.stateT >= this.gap) this.chooseAttack(ctx);
        break;
      }

      // ------------------------------------------------------- bombs
      case 'bombPrep': {
        const z0 = this.end > 0 ? this.raft.maxZ + 2 : this.raft.minZ - 2;
        const left = this.steer(dt, this.cx + this.side * (this.hw + 2.6), SURFACE, z0, 16);
        if (left < 0.8 || this.stateT > 4) {
          this.enter('bombs');
          this.volleys = cfg.bombVolleys + (this.phase === 2 ? 1 : 0);
          this.volleyT = 0.6;
        }
        break;
      }
      case 'bombs': {
        // Swim along the flank while the back segments lob mines onto the deck.
        this.steer(dt, this.cx + this.side * (this.hw + 2.6), SURFACE, this.zEnd, this.phase === 2 ? 5 : 4.2);
        this.volleyT -= dt;
        if (this.volleys > 0 && this.volleyT <= 0) {
          this.volleys--;
          this.volleyT = (this.phase === 2 ? 1.15 : 1.55) * sm;
          this.bombVolley(ctx);
        }
        if (this.volleys === 0 && this.volleyT < -0.5) this.enter('dive');
        break;
      }

      // -------------------------------------------------------- slam
      case 'slamPrep': {
        const left = this.steer(dt, this.cx + this.side * (this.hw + 7), DEEP, this.laneZ, 16);
        if (left < 1 || this.stateT > 4) this.startSlamRise(ctx);
        break;
      }
      case 'slamRise': {
        // Rears up beside the lane, facing across the raft.
        const rise = this.triple ? cfg.tripleWindup : (this.phase === 2 ? cfg.slamWindup2 : cfg.slamWindup) * sm;
        this.steer(dt, this.cx + this.side * (this.hw + 3.2), 2.8, this.laneZ, 9, false);
        this.look(dt, this.cx, this.laneZ, 6);
        this.jaw = Math.min(1, this.stateT / rise);
        break; // the telegraph moves us on
      }
      case 'slamCross': {
        const left = this.steer(dt, this.cx - this.side * (this.hw + 3.2), 0.75, this.laneZ, 26);
        if (left < 0.5) {
          ctx.shake(0.25);
          this.sound('boss.slam');
          this.enter('slamRest');
        }
        break;
      }
      case 'slamRest': {
        // Lies across the deck: hit the body while it's down.
        this.steer(dt, this.head.x, 0.3, this.head.z, 2, false);
        const rest = this.slamsLeft > 0 ? 1.0 : cfg.slamRest;
        if (this.stateT >= rest) {
          if (this.slamsLeft > 0) {
            // Phase 2: crashes straight back over a new lane.
            this.slamsLeft--;
            this.side = -this.side;
            this.laneZ = this.clampToRaft(0, ctx.playerZ, 2.6)[1];
            this.startSlamRise(ctx);
          } else {
            this.enter('dive');
          }
        }
        break;
      }

      // -------------------------------------------------------- beam
      case 'beamPrep': {
        const apexZ = this.end < 0 ? this.raft.minZ - 3 : this.raft.maxZ + 3;
        const left = this.steer(dt, this.beamX, DEEP, apexZ + this.end * 2, 16);
        if (left < 1 || this.stateT > 4) this.startBeamRise(ctx);
        break;
      }
      case 'beamRise': {
        const apexZ = this.end < 0 ? this.raft.minZ - 3 : this.raft.maxZ + 3;
        this.steer(dt, this.beamX, 3.2, apexZ, 8, false);
        this.headYaw = turnToward(this.headYaw, this.beamFrom, 3 * dt);
        this.headPitch += (0.25 - this.headPitch) * Math.min(1, 4 * dt);
        this.jaw = 0.6;
        this.charge = Math.min(1, this.stateT / (this.triple ? cfg.tripleWindup : cfg.beamWindup * sm));
        break; // the telegraph moves us on
      }
      case 'beaming': {
        const sweeps = this.phase === 2 ? 2 : 1;
        const per = this.phase === 2 ? cfg.beamSweep * 0.75 : cfg.beamSweep;
        const k = Math.min(sweeps, this.stateT / per);
        // Phase 2 sweeps there and back.
        const u = k <= 1 ? k : 2 - k;
        const yaw = this.beamFrom + (this.beamTo - this.beamFrom) * u;
        this.headYaw = yaw;
        this.jaw = 1;
        this.charge = 1;
        this.beamTick -= dt;
        const apexX = this.head.x;
        const apexZ = this.head.z;
        if (this.beamTick <= 0) {
          this.beamTick = 0.2;
          ctx.tickPlayer({ kind: 'cone', x: apexX, z: apexZ, yaw, range: cfg.beamRange, arcDeg: cfg.beamArcDeg }, this.flat(cfg.beamTickDamage), apexX, apexZ);
        }
        this.showBeam(yaw);
        if (k >= sweeps) {
          this.hideBeam();
          this.enter('headRest');
        }
        break;
      }
      case 'headRest': {
        // Exhausted: the head flops onto the deck edge. Weak point.
        const z = this.end < 0 ? this.raft.minZ + 1.6 : this.raft.maxZ - 1.6;
        const left = this.steer(dt, this.cx, 0.75, z, 9, false);
        this.headPitch += (0.1 - this.headPitch) * Math.min(1, 4 * dt);
        if (left < 0.4 && !this.fired) {
          this.fired = true;
          ctx.shake(0.2);
          this.sound('boss.step');
          this.sound('boss.weak');
        }
        if (this.stateT >= cfg.headRest + 0.6) this.enter('dive');
        break;
      }

      // ------------------------------------------------------- spray
      case 'sprayPrep': {
        const left = this.steer(dt, this.cx + this.side * (this.hw + 3), DEEP, this.laneZ, 16);
        if (left < 1 || this.stateT > 4) this.enter('sprayRise');
        break;
      }
      case 'sprayRise':
        this.steer(dt, this.cx + this.side * (this.hw + 3), 2.6, this.laneZ, 8, false);
        this.look(dt, ctx.playerX, ctx.playerZ);
        this.jaw = Math.min(1, this.stateT);
        if (this.stateT >= 0.9 * sm) {
          this.sound('drl.spray');
          this.spray(ctx);
          this.enter('spraying');
        }
        break;
      case 'spraying':
        this.look(dt, ctx.playerX, ctx.playerZ);
        this.jaw = 1;
        if (this.stateT >= cfg.sprayWindup + 0.5) this.enter('dive');
        break;

      case 'shatter':
        this.steer(dt, this.head.x, Math.max(2.8, this.head.y), this.head.z, 6, false);
        this.look(dt, ctx.playerX, ctx.playerZ);
        this.jaw = 1;
        if (this.stateT > 2.4) this.enter('dive');
        break;
    }

    this.trail.push(this.head);
    this.placeParts();
  }

  private chooseAttack(ctx: BossContext): void {
    // Hell, phase 3: every tripleEvery-th attack is a triple, the slam and the beam taking turns. The attacks
    // between them never lead with the next triple's attack.
    const nextTriple = this.lastTriple === 'slam' ? 'beam' : 'slam';
    this.triple = this.phase3 && this.attacks3++ % cfg.tripleEvery === 0;
    if (this.triple) this.lastAttack = this.lastTriple = nextTriple;
    const pool: Attack[] = this.phase === 2 ? ['bombs', 'slam', 'beam', 'spray'] : ['bombs', 'slam', 'beam'];
    const pick = this.triple ? nextTriple : this.pickAttack(ctx, pool, (a) => !this.phase3 || a !== nextTriple);
    const pz = ctx.playerZ;
    switch (pick) {
      case 'bombs':
        this.side = ctx.playerX >= this.cx ? 1 : -1;
        // Start at the end nearer the head and swim to the other.
        this.end = this.head.z > this.cz ? 1 : -1;
        this.zEnd = this.end > 0 ? this.raft.minZ - 2 : this.raft.maxZ + 2;
        this.enter('bombPrep');
        break;
      case 'slam':
        this.side = this.head.x >= this.cx ? 1 : -1;
        this.laneZ = this.clampToRaft(0, pz, 2.6)[1];
        // A triple is one slam (with the full rest after it).
        this.slamsLeft = this.phase === 2 && !this.triple ? 1 : 0;
        this.enter('slamPrep');
        break;
      case 'beam':
        // From the end nearer the player, so the far end is the safe distance.
        this.end = pz < this.cz ? -1 : 1;
        this.beamX = this.cx;
        this.enter('beamPrep');
        break;
      case 'spray':
        this.side = ctx.playerX >= this.cx ? 1 : -1;
        this.laneZ = this.clampToRaft(0, pz, 3)[1];
        this.enter('sprayPrep');
        break;
    }
  }

  /** A row of mines across the deck at depth z. */
  private rowAt(z: number): [number, number][] {
    const r = cfg.bombRadius;
    const pts: [number, number][] = [];
    for (let x = this.raft.minX + r * 0.6; x <= this.raft.maxX; x += r * 1.25) pts.push([x, z]);
    return pts;
  }

  private bombVolley(ctx: BossContext): void {
    const pts: [number, number][] = [];
    const [px, pz] = this.clampToRaft(ctx.playerX, ctx.playerZ, 0.5);
    // Phase 2 barrages end on a ring: no gap to walk to in time, so dash out through it.
    const ring = this.phase === 2 && this.volleys === 0;
    const pattern = ring ? 3 : Math.floor(ctx.rng() * 3);
    if (pattern === 3) {
      pts.push([px, pz]);
      for (let i = 0; i < cfg.ringBombs; i++) {
        const a = (i / cfg.ringBombs) * Math.PI * 2;
        pts.push([px + Math.sin(a) * cfg.ringRadius, pz + Math.cos(a) * cfg.ringRadius]);
      }
    } else if (pattern === 0) {
      // A row across the deck: step forward or back.
      pts.push(...this.rowAt(pz));
    } else if (pattern === 1) {
      // A cross centred on you: step out diagonally.
      pts.push([px, pz], [px + 3.4, pz], [px - 3.4, pz], [px, pz + 3.4], [px, pz - 3.4]);
    } else {
      pts.push([px, pz]);
      for (let i = 0; i < 6; i++) pts.push([px + (ctx.rng() - 0.5) * 9, pz + (ctx.rng() - 0.5) * 14]);
    }
    this.launchBombs(ctx, pts, cfg.bombWindup * this.sm(), ring);
  }

  /** Lob mines from the back segments onto these points; each blows after `dur`. */
  private launchBombs(ctx: BossContext, pts: [number, number][], dur: number, dash = false): void {
    const r = cfg.bombRadius;
    pts.forEach(([x, z], i) => {
      const [cx, cz] = this.clampToRaft(x, z, 0.3);
      const shape: TelegraphShape = { kind: 'circle', x: cx, z: cz, radius: r };
      ctx.telegraph(shape, dur, () => {
        sfx('drl.explode', { x: cx, z: cz });
        ctx.hitPlayer(shape, 0.85, cx, cz, 7);
        ctx.effect(new Ring(cx, cz, 0xff8a40, r * 1.2, 0.35));
        ctx.effect(new Pillar(cx, cz, 0xff8a40, 0.25, 0.6, 3));
        if (i === 0) ctx.shake(0.18);
      }, 0xff6a30, dash);
      // Launched from one of the surfaced back segments.
      const seg = this.partsList[2 + (i % Math.max(1, cfg.segments - 2))].pos;
      if (i < 3) setTimeout(() => this.sound('drl.bomb', seg.x, seg.z), i * 90);
      ctx.effect(new Lob(this.tmp2.set(seg.x, seg.y + 1.2, seg.z), cx, cz, dur, 0xffa050, 0.26));
    });
  }

  private startSlamRise(ctx: BossContext): void {
    this.enter('slamRise');
    this.sound('dragon.growl');
    // A triple's lane is on wherever you stand now (the head steers over to it as it rears).
    if (this.triple) this.laneZ = this.clampToRaft(0, ctx.playerZ, 2.6)[1];
    const dur = this.triple ? cfg.tripleWindup : (this.phase === 2 ? cfg.slamWindup2 : cfg.slamWindup) * this.sm();
    const s = this.side;
    const shape: TelegraphShape = {
      kind: 'line',
      x: this.cx + s * (this.hw + 1),
      z: this.laneZ,
      yaw: s > 0 ? -Math.PI / 2 : Math.PI / 2,
      length: this.hw * 2 + 2,
      width: cfg.slamWidth,
    };
    ctx.telegraph(shape, dur, () => {
      if (this.state !== 'slamRise') return;
      // Knocked out of the lane along the raft.
      ctx.hitPlayer(shape, 1.35, ctx.playerX, this.laneZ, 14);
      ctx.shake(0.5);
      this.sound('boss.slam', this.cx + s * (this.hw + 0.8), this.laneZ);
      this.sound('drl.splash', this.cx + s * (this.hw + 0.8), this.laneZ);
      // Crash down onto the near edge, so the body ends up lying flat across the deck.
      this.head.set(this.cx + s * (this.hw + 0.8), 0.75, this.laneZ);
      this.trail.push(this.head);
      ctx.effect(new Ring(this.head.x, this.laneZ, 0xff6040, 5, 0.4));
      this.enter('slamCross');
    }, 0xff3030, this.phase === 2 && !this.triple);
    if (this.triple) {
      this.slamTriple(ctx, dur);
      return;
    }
    // Hard, phase 2, the first slam of the pair: the back segments lob a row of mines a little way
    // along the raft at the same time. Safe: the far side of the lane, or the strip between the two.
    if (this.hard && this.phase === 2 && this.slamsLeft > 0) {
      const off = cfg.slamWidth / 2 + cfg.bombRadius + HARD_ROW_GAP;
      const sides = [1, -1].filter((d) => {
        const z = this.laneZ + d * off;
        return z > this.raft.minZ + 1 && z < this.raft.maxZ - 1;
      });
      if (sides.length) {
        const d = sides[Math.floor(ctx.rng() * sides.length)];
        this.launchBombs(ctx, this.rowAt(this.laneZ + d * off), dur + 0.25);
      }
    }
  }

  private startBeamRise(ctx: BossContext): void {
    this.enter('beamRise');
    this.sound('drl.charge');
    const c = this.end < 0 ? 0 : Math.PI; // facing down the raft
    const apexZ = this.end < 0 ? this.raft.minZ - 3 : this.raft.maxZ + 3;
    const fire = () => {
      if (this.state !== 'beamRise') return;
      // A triple sweeps from exactly where its outline was drawn.
      if (this.triple) this.head.set(this.beamX, this.head.y, apexZ);
      this.beamTick = 0;
      this.enter('beaming');
      this.sound('drl.beam', this.head.x, this.head.z, this.phase === 2 ? cfg.beamSweep * 1.5 : cfg.beamSweep);
    };
    if (this.triple && this.beamTriple(ctx, c, apexZ, fire)) return;
    this.triple = false;
    const fan = THREE.MathUtils.degToRad(60);
    const span = THREE.MathUtils.degToRad(cfg.beamSpanDeg);
    // Sweep one side and the middle; the other flank (and the far end) stays safe.
    const sgn = ctx.rng() < 0.5 ? -1 : 1;
    this.beamFrom = c - sgn * fan;
    this.beamTo = this.beamFrom + sgn * span;
    const shape: TelegraphShape = { kind: 'cone', x: this.cx, z: apexZ, yaw: (this.beamFrom + this.beamTo) / 2, range: cfg.beamRange, arcDeg: cfg.beamSpanDeg };
    ctx.telegraph(shape, cfg.beamWindup * this.sm(), fire, 0xc060ff);
    // Hard, phase 2: it spits poison puddles as it rears, so the beam sweeps over shrinking ground.
    // Safe: the unswept flank or the far end, around the puddles.
    if (this.hard && this.phase === 2) {
      this.sound('drl.spray');
      this.spray(ctx);
    }
  }

  private spray(ctx: BossContext): void {
    const r = cfg.sprayRadius;
    const pts: [number, number][] = [this.clampToRaft(ctx.playerX, ctx.playerZ, 0.6)];
    for (let tries = 0; pts.length < cfg.sprayPuddles && tries < 60; tries++) {
      const p = this.clampToRaft(this.cx + (ctx.rng() - 0.5) * this.hw * 2, ctx.playerZ + (ctx.rng() - 0.5) * 18, 0.8);
      if (pts.every(([x, z]) => Math.hypot(x - p[0], z - p[1]) > r * 1.3)) pts.push(p);
    }
    this.lobPoison(ctx, pts, cfg.sprayWindup);
  }

  /** Spit poison from the mouth at these points; each lands as a puddle after `dur`. */
  private lobPoison(ctx: BossContext, pts: [number, number][], dur: number): void {
    const r = cfg.sprayRadius;
    for (const [x, z] of pts) {
      const shape: TelegraphShape = { kind: 'circle', x, z, radius: r };
      ctx.telegraph(shape, dur, () => {
        ctx.hitPlayer(shape, 0.5, x, z, 2, 'poison', 1);
        ctx.puddle(x, z, r, cfg.puddleLife);
      }, 0x60e040);
      const mouth = this.tmp2.set(this.head.x + Math.sin(this.headYaw) * 1.6, this.head.y, this.head.z + Math.cos(this.headYaw) * 1.6);
      ctx.effect(new Lob(mouth, x, z, dur, 0x80ff50, 0.3));
    }
  }

  /**
   * Hell triple: the lane slam on you, a row of mines on one side of it and two rows of poison on the other.
   * The one safe pocket is the strip (triplePocket deep, for your centre) between the lane and the mines. The
   * poison starts at the lane's edge, so that side has no gap, and past the mines is too far to reach in time.
   */
  private slamTriple(ctx: BossContext, dur: number): void {
    const r = this.raft;
    const off = cfg.slamWidth / 2 + BODY + cfg.triplePocket + BODY + cfg.bombRadius;
    // The mines go where their whole row lands on the deck (one side always fits: the raft is 30 m long).
    const sides = [1, -1].filter((d) => {
      const z = this.laneZ + d * off;
      return z >= r.minZ + 0.3 && z <= r.maxZ - 0.3;
    });
    const d = sides[Math.floor(ctx.rng() * sides.length)];
    this.launchBombs(ctx, this.rowAt(this.laneZ + d * off), dur + 0.25);
    // Three puddles across the deck per row, overlapping the lane's edge. When the lane runs to the raft's end the
    // first row is pulled back onto the deck (over the lane) and the second is left out.
    const pts: [number, number][] = [];
    for (let k = 0; k < 2; k++) {
      const z = this.laneZ - d * (cfg.slamWidth / 2 + 1 + k * 3);
      const zc = Math.min(r.maxZ - 0.8, Math.max(r.minZ + 0.8, z));
      if (k > 0 && zc !== z) break;
      for (const u of [-1, 0, 1]) pts.push([this.cx + u * this.hw * 0.68, zc]);
    }
    this.sound('drl.spray');
    this.lobPoison(ctx, pts, dur);
  }

  /**
   * Hell triple: the beam from the near end over the whole deck but the flank on your side (it rears tripleFlank
   * in from that edge and its sweep, beam width included, ends on the line straight down the deck), poison down
   * that flank toward the head, and a row of mines across the deck past you. The one safe pocket is the flank
   * beside you between the poison and the mines. False when you are already too far down the raft for it (the
   * mines would no longer close off the far end): the Nightmare pair instead.
   */
  private beamTriple(ctx: BossContext, c: number, apexZ: number, fire: () => void): boolean {
    const r = this.raft;
    const f = -this.end; // down the raft, away from the head
    const g = cfg.triplePocket / 2;
    const near = this.end < 0 ? r.minZ : r.maxZ;
    const u = ctx.playerX >= this.cx ? 1 : -1;
    // Past dMax (metres down the raft from the head) the far end, out of the beam's range, would open up before the mines.
    const lateral = this.hw * 2 - cfg.tripleFlank + BODY;
    const dMax = Math.sqrt(cfg.beamRange ** 2 - lateral ** 2) - g - 0.6;
    const dYou = (ctx.playerZ - apexZ) * f;
    if (dYou > dMax + g) return false;
    // The pocket: on your flank, level with you, leaving room for a puddle between it and the raft's end.
    const dMin = (near - apexZ) * f + g + BODY + cfg.sprayRadius + 0.4;
    const pz = apexZ + f * Math.min(dMax, Math.max(dMin, dYou));
    this.beamX = this.cx + u * (this.hw - cfg.tripleFlank);
    // `toward` turns the yaw toward your flank; the beam's covered edge stops a degree short of straight down the deck.
    const toward = -this.end * u;
    const deg = THREE.MathUtils.degToRad;
    this.beamTo = c - toward * deg(cfg.beamArcDeg / 2 + 1);
    this.beamFrom = this.beamTo - toward * deg(cfg.beamSpanDeg);
    // The outline shows everything the beam touches (its own width at both ends of the sweep too).
    const arc = cfg.beamSpanDeg + cfg.beamArcDeg;
    const shape: TelegraphShape = { kind: 'cone', x: this.beamX, z: apexZ, yaw: c - toward * deg(arc / 2 + 1), range: cfg.beamRange, arcDeg: arc };
    ctx.telegraph(shape, cfg.tripleWindup, fire, 0xc060ff);
    this.launchBombs(ctx, this.rowAt(pz + f * (g + BODY + cfg.bombRadius)), cfg.tripleWindup + 0.25);
    // A column of puddles down the open flank toward the head, three at most (any further is out of reach anyway).
    // `d`: metres in from the raft's end; the last is pulled onto the deck if it would leave a corner there open.
    const pts: [number, number][] = [];
    const x = this.cx + u * (this.hw - cfg.tripleFlank / 2);
    for (let k = 0, last = Infinity; k < 3; k++) {
      let d = (pz - near) * f - (g + BODY + cfg.sprayRadius + k * 3);
      if (d < 0.3) {
        if (last <= 1) break;
        d = 0.3;
      }
      pts.push([x, near + f * d]);
      last = d;
    }
    this.sound('drl.spray');
    this.lobPoison(ctx, pts, cfg.tripleWindup);
    return true;
  }

  /** Hell: the last third. It turns to the dark (a violet pulse through the body) and starts mixing in triples. */
  private startPhase3(ctx: BossContext): void {
    this.phase3 = true;
    this.attacks3 = 0;
    this.escalate(ctx, 'De Rol Le turns to the dark!');
    ctx.shake(0.5);
    this.sound('drl.screech');
    ctx.effect(new Ring(this.head.x, this.head.z, CORRUPT_COLOR, 6, 0.6));
    for (const p of this.partsList) if (p.pos.y > SUBMERGED) ctx.effect(new Pillar(p.pos.x, p.pos.z, CORRUPT_COLOR, 0.5, 0.6, 6));
  }

  private startShatter(ctx: BossContext): void {
    this.wantShatter = false;
    this.phase = 2;
    this.hideBeam();
    this.maskHp = 0;
    this.model.mask.visible = false;
    for (let i = 0; i < this.plates.length; i++) {
      if (this.plates[i] > 0) {
        this.plates[i] = 0;
        this.model.plates[i].visible = false;
        const p = this.partsList[i + 1].pos;
        ctx.effect(new Ring(p.x, p.z, 0xe8e0c0, 3, 0.5));
      }
    }
    this.escalate(ctx, "De Rol Le's shell shatters!");
    ctx.shake(0.6);
    this.sound('drl.shatter');
    this.sound('drl.screech');
    this.enter('shatter');
  }

  private showBeam(yaw: number): void {
    const mouth = this.tmp.set(this.head.x + Math.sin(yaw) * 1.6, this.head.y + 0.1, this.head.z + Math.cos(yaw) * 1.6);
    const far = this.tmp2.set(this.head.x + Math.sin(yaw) * cfg.beamRange, 0, this.head.z + Math.cos(yaw) * cfg.beamRange);
    const dir = far.clone().sub(mouth);
    const len = dir.length();
    this.beam.visible = true;
    this.beam.position.copy(mouth);
    this.beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    this.beam.scale.set(1 + Math.sin(this.time * 40) * 0.15, len, 1 + Math.cos(this.time * 37) * 0.15);
    this.beamMat.opacity = 0.65 + Math.sin(this.time * 30) * 0.15;
    this.beamGround.visible = true;
    this.beamGround.position.set(this.head.x, 0.07, this.head.z);
    this.beamGround.rotation.y = yaw;
  }

  private hideBeam(): void {
    this.beam.visible = false;
    this.beamGround.visible = false;
  }

  // ------------------------------------------------------------- posing

  /** Put the head and every segment on the trail, and pose the model. */
  private placeParts(): void {
    const m = this.model;
    const sinkY = -this.sink;
    m.head.position.copy(this.head).setY(this.head.y + sinkY);
    m.head.rotation.set(this.headPitch, this.headYaw, 0);
    this.partsList[0].pos.copy(m.head.position);
    const a = this.tmp;
    const b = this.tmp2;
    for (let i = 0; i < cfg.segments; i++) {
      const d = HEAD_RADIUS * 0.6 + (i + 1) * cfg.segSpacing;
      const g = m.segs[i];
      this.trail.sample(this.head, d, g.position);
      g.position.y += sinkY;
      this.trail.sample(this.head, d - 0.7, a);
      this.trail.sample(this.head, d + 0.7, b);
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const dz = a.z - b.z;
      const horiz = Math.hypot(dx, dz);
      if (horiz > 1e-3 || Math.abs(dy) > 1e-3) g.rotation.set(-Math.atan2(dy, Math.max(horiz, 1e-3)), Math.atan2(dx, dz), 0);
      this.partsList[i + 1].pos.copy(g.position);
    }
    m.pose({
      jaw: this.jaw,
      flash: this.flashT > 0,
      exposed: this.phase === 2,
      enraged: this.enraged && this.phase === 2,
      weak: this.state === 'headRest' ? 0.3 + Math.sin(this.time * 8) * 0.15 : 0,
      charge: this.charge,
      time: this.time,
    });
    // Hell, phase 3: a slow violet pulse through the body.
    if (this.phase3 && this.alive && this.flashT <= 0) for (const mt of this.hellMats) mt.emissive.setHex(CORRUPT_COLOR).multiplyScalar(0.3 + Math.sin(this.time * 3) * 0.12);
  }
}
