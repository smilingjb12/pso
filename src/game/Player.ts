import * as THREE from 'three';
import type { Character } from './character';
import { combo as comboCfg, dash as dashCfg, magCfg, passiveCfg as T, player as cfg, statuses, uniqueCfg, weaponWeights } from './config';
import { AFFIX_CAPS } from './data/itemAffixes';
import { Combo, hastened, type ComboEvent, type StepId } from './combo';
import { turnToward } from './collision';
import { ARTS, isTechArt, type ArtId } from './data/arts';
import { techniques } from './data/techniques';
import { magForm } from './mag';
import { Heroine, playerLook } from './models/heroine';
import { MagCompanion } from './models/mag';
import { humanPoses, SWEEP_LEAD, SWEEP_LEN, type Grip } from './models/humanoid';
import { buildWeapon, WEAPON_GRIP, type WeaponModel } from './models/weapons';
import { gaitPose, PLAYER_GAIT, scaleGait } from './models/gait';
import { PLAYER_SWING, swingFrame, WeaponHold, type HoldRequest } from './models/swings';
import { SwingTrail } from './models/swingTrail';
import { LEFT_HAND_AT, type HiltTarget } from './models/twoHand';
import type { Pose } from './models/Rig';

const RUN_GAIT = PLAYER_GAIT;

const TWO_PI = Math.PI * 2;
/** Where in the swing pose sequence the blow lands (0..1). */
const SLASH_IMPACT = 0.42;
const SHOT_IMPACT = 0.25;
const CAST_IMPACT = 0.6;

const GRIP = WEAPON_GRIP;

export interface Buff {
  pct: number;
  t: number;
}

/** A dash in progress. */
export interface DashState {
  t: number;
  /** Seconds it lasts (a Blink is almost instant). */
  dur: number;
  /** Lunge / Backstep Shot: start a basic step when it ends. */
  free: boolean;
  /** World-space direction (unit), used when there is no orbit. */
  dx: number;
  dz: number;
  /** Locked on: the dash is steered around the target (fwd: toward it, side: + clockwise seen from above). */
  orbit: { x: number; z: number; fwd: number; side: number; r: number } | null;
}

/** An Art carrying her somewhere (Leap, Backflip Shot): straight from one spot to another over `dur` seconds. */
export interface ArtMove {
  fx: number;
  fz: number;
  tx: number;
  tz: number;
  t: number;
  dur: number;
}

export class Player {
  readonly group = new THREE.Group();
  readonly pos = this.group.position;
  yaw = 0;
  hp = 1;
  tp = 0;
  readonly radius = cfg.radius;
  /** The 3-step chain: basic steps and Arts (combo.ts). */
  readonly combo: Combo;

  /** Seconds of hitstun remaining (cannot act). */
  hitstun = 0;
  /** Seconds of invulnerability remaining. */
  iframes = 0;
  /** Seconds locked into using an item. */
  itemLock = 0;
  readonly knock = new THREE.Vector3();
  /** Yaw the current step is steering toward, if any. */
  aimYaw: number | null = null;
  readonly buffs: { atp: Buff; def: Buff } = { atp: { pct: 0, t: 0 }, def: { pct: 0, t: 0 } };
  /** HP / TP still to land from Steady injector doses (and regeneration), and the rate they land at (per second). */
  readonly regen = { hp: { left: 0, rate: 0 }, tp: { left: 0, rate: 0 } };
  /** Seconds of Bracing left (damage taken ×injectorCfg.braceMult). */
  brace = 0;
  /** Seconds of Clarity left (attack techniques cost no TP). */
  clarity = 0;
  /** Barrier / Ward / Aegis: shield HP absorbed before HP, fading at shieldFade per second. */
  shield = 0;
  private shieldFade = 0;
  /** Retaliate: seconds left in which the next melee step hits harder (set when an enemy hits her). */
  retaliate = 0;
  /** Slipstream: seconds left in which the next step lands perfect (set by dashing out of a telegraph). */
  slipstream = 0;
  /** Parry / Calm Mind and Art guards: damage-taken multiplier and seconds left. */
  private guardMult = 1;
  private guardT = 0;
  /** Sweep Guard / Guarded Spin: damage-taken reduction (fraction) and seconds left. */
  private sweepPct = 0;
  private sweepT = 0;
  /** Composure: seconds in which the next hit taken is softened. */
  composureT = 0;
  /** Rush: seconds of faster running and dash recharge. */
  rushT = 0;
  /** Leilla (photon blast): seconds of reduced damage taken. */
  leillaT = 0;
  /** Iron Finish: the next step carries Poise all the way (ironSwing while it plays). */
  ironPoise = false;
  private ironSwing = false;
  /** Photon blast gauge (0..1; it fires by itself when full, in a fight). */
  pb = 0;
  /** Point Blank: seconds before it can refund a dash again. */
  pointBlankT = 0;
  /** A dash with a free attack (Lunge, Backstep Shot) just ended: the game starts a basic step and clears it. */
  freeAttack = false;

  // ---- Arts (2026-10-14)
  /** Seconds before each Art can be used again. */
  readonly cooldowns = new Map<ArtId, number>();
  /** Channel effects of the Art being played that have fired already. */
  private ticksDone = 0;
  /** An Art carrying her (Leap, Backflip Shot, Recoil). */
  artMove: ArtMove | null = null;
  /** Guard Stance: seconds left, and whether its counter is still to come. */
  guardStanceT = 0;
  counterReady = false;
  /** Shadow Step: the next hit within this many seconds is a crit. */
  critNextT = 0;
  /** Iron Will: seconds left. */
  ironWillT = 0;
  /** Retaliation / Wrath: basic swings left that hit harder, and how much. */
  bonusSwings = 0;
  bonusSwingMult = 1;
  /** Shadow Step's Flurry: the next basic swing strikes this many more times. */
  extraStrikes = 0;
  /** Backflip Shot's Focus: the next Art costs half the TP. */
  halfCostNext = false;
  /** Resta's Swiftness: seconds of faster running. */
  swiftT = 0;

  /** Seconds of poison left (HP drains; a Sol injector cures). */
  poison = 0;
  /** Seconds of paralysis left (rooted, no actions). */
  paralysis = 0;
  /** How long the current paralysis lasts in all (the HUD's crowd-control ring). */
  paralysisTotal = 0;
  /** Burn stacks (Mines): each drains HP; moving sheds them faster. A Sol injector cures. */
  burnStacks = 0;
  /** Seconds toward losing the next Burn stack. */
  burnDecay = 0;
  /** Corruption stacks (Ruins, and every Hell enemy): each takes a share of max HP away until it wears off, or light, a cleared room or Sol clears it. */
  corruption = 0;
  /** Seconds spent in light (or past the timer) toward shedding the next stack. */
  corruptDecay = 0;
  /** Seconds before Corruption starts wearing off by itself; every new application resets it. */
  corruptTimer = 0;
  /** Standing in a lit pylon's circle (or a Grants light) this frame; set by the world. */
  inLight = false;
  /** Seconds of paralysis immunity left. */
  paraImmune = 0;
  /** Movement multiplier from the ground underfoot (marsh); set by the world each frame. */
  slowMult = 1;
  dash: DashState | null = null;
  /** Dash charges ready, and progress (0..1) toward the next one. */
  dashCharges = dashCfg.charges;
  dashRefill = 0;
  /** Seconds after a dash before attacks and casts can start. */
  dashRecover = 0;
  /** Facing-relative direction of the current dash (for the pose). */
  private dashLocal = { fwd: 1, side: 0 };

  private model!: Heroine;
  /** The look the model was built from (see refreshLook). */
  private lookKey = '';
  /** The Mag (or twin Mags); its root sits beside the player group so it can trail behind. */
  private mag = new MagCompanion(0.75);
  private weapon: WeaponModel | null = null;
  private ring: THREE.Mesh;
  private ringMat: THREE.MeshBasicMaterial;
  private castRing: THREE.Mesh;
  private castMat: THREE.MeshBasicMaterial;
  /** Brief ring flash: red for a broken chain, gold for a perfect one. */
  private flash = 0;
  private flashColor = 0xff3030;
  private lungeLeft = 0;
  private weaponKey = '';
  private moved = false;
  private drinkT = 0;
  /** Run cycle phase (0..1, left foot touchdown at 0). */
  private runU = 0;
  /** Multiplier on the weapon's photon glow (lower in areas with bloom). */
  photonScale = 1;
  /** Both hands on the weapon during melee swings. */
  private readonly hold = new WeaponHold();
  private readonly hiltKey: HiltTarget = { at: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, 1) };
  /** PSO-style photon trail behind melee cuts; lives in world space beside the player group. */
  private readonly trail = new SwingTrail();
  private readonly trailBase = new THREE.Vector3();
  private readonly trailTip = new THREE.Vector3();
  /** A foot touched down this update (footstep sound). */
  stepped = false;
  /** Seconds spent running continuously (for blending in). */
  private runT = 0;
  private time = 0;
  private deathT = 0;

  constructor(public char: Character) {
    this.combo = new Combo(comboCfg, (step) => {
      if (step !== 'basic') return this.char.artTiming(step as ArtId);
      // Iron Will's Fervent: basic swings 15% faster while it lasts.
      const t = this.char.basicTiming();
      return this.ironWillT > 0 && this.char.artMod('ironWill', 'fervent') ? hastened(t, 1 / 1.15) : t;
    });

    // Timing cue ring around the feet.
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0x66ddff, transparent: true, opacity: 0, depthWrite: false });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1.0, 40), this.ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.03;
    this.group.add(this.ring);

    // Casting circle.
    this.castMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false });
    this.castRing = new THREE.Mesh(new THREE.RingGeometry(1.1, 1.3, 6), this.castMat);
    this.castRing.rotation.x = -Math.PI / 2;
    this.castRing.position.y = 0.05;
    this.group.add(this.castRing);

    this.buildModel();
    this.refreshWeapon();
    this.refreshMag();
    this.fullRestore();
  }

  setCharacter(char: Character): void {
    this.char = char;
    this.buildModel();
    this.weaponKey = '';
    this.refreshWeapon();
    this.refreshMag();
    this.fullRestore();
  }

  /** Rebuild the Mag model if it evolved (or the character changed), and apply the Tempo passive. */
  refreshMag(): void {
    const form = magForm(this.char.mag, this.char.magStat);
    this.mag.setForm(form.stage, form.color, { theme: form.theme, colors: this.model.pal });
    this.combo.perfectBonus = this.char.pAmt('tempo', T.tempoBonus);
  }

  /** Rebuild the model after an appearance change, keeping the weapon. */
  rebuildModel(): void {
    this.buildModel();
    this.weaponKey = '';
    this.refreshWeapon();
  }

  /** Rebuild the model if the equipped frame changed the outfit or its evolution stage. */
  refreshLook(): void {
    if (JSON.stringify(playerLook(this.char.data)) !== this.lookKey) this.rebuildModel();
  }

  private buildModel(): void {
    if (this.model) this.group.remove(this.model.rig.root);
    // One heroine for every class, dressed by the equipped frame.
    const look = playerLook(this.char.data);
    this.lookKey = JSON.stringify(look);
    this.model = new Heroine(look);
    this.group.add(this.model.rig.root);
    this.weapon = null;
  }

  get maxHp(): number {
    if (this.corruption <= 0) return this.char.maxHp;
    return Math.max(1, Math.round(this.char.maxHp * (1 - statuses.corruptPctPerStack * this.corruption * this.corruptMult)));
  }
  /** Max HP without Corruption (the HP bar's full width). */
  get trueMaxHp(): number {
    return this.char.maxHp;
  }
  /** Corruption resistance shrinks what Corruption takes. */
  get corruptMult(): number {
    return 1 - this.char.resist('resCorrupt') / 100;
  }
  /** Add Corruption stacks (current HP drops with the lowered max). Returns stacks actually added. */
  corrupt(stacks: number): number {
    const before = this.corruption;
    // Every application (even at the cap) resets the timer before it starts wearing off.
    this.corruptTimer = statuses.corruptDuration;
    this.corruption = Math.min(statuses.corruptMaxStacks, this.corruption + stacks);
    if (this.corruption === before) return 0;
    if (before === 0) this.corruptDecay = 0;
    this.hp = Math.min(this.hp, this.maxHp);
    this.shield = Math.min(this.shield, this.maxHp * this.char.pAmt('barrier', T.barrierCap));
    return this.corruption - before;
  }
  get maxTp(): number {
    return this.char.maxTp;
  }
  get alive(): boolean {
    return this.hp > 0;
  }
  /** Dash charges when full (Fleet adds one). */
  get maxDashCharges(): number {
    return dashCfg.charges + (this.char.hasPassive('fleet') ? T.fleetCharges : 0);
  }
  /** Run speed: Light Feet, Rush, Resta's Swiftness and Run speed affixes, +20% at most in all. */
  get runSpeed(): number {
    let k = this.char.pMult('lightFeet', T.lightFeetRunMult) * (this.rushT > 0 ? this.char.pMult('rush', T.rushRunMult) : 1) * (this.swiftT > 0 ? 1.15 : 1) * (1 + this.char.gearAffix('walk') / 100);
    k = Math.min(1 + AFFIX_CAPS.walk, k);
    // Tide Shell's cost.
    if (this.char.hasUnique('tideShell')) k *= Math.max(0.5, 1 - this.char.uval(uniqueCfg.tideRun));
    return cfg.moveSpeed * k;
  }
  /** Dash recharge speed multiplier: Light Feet, Rush and affixes. */
  private get dashRate(): number {
    const rush = this.char.hasUnique('dragonRush') ? Math.max(0.1, 1 - this.char.uval(uniqueCfg.rushDashCost)) : 1;
    return this.char.pMult('lightFeet', T.lightFeetDashMult) * (this.rushT > 0 ? this.char.pMult('rush', T.rushDashMult) : 1) * (1 + this.char.gearAffix('dashRecharge') / 100) * rush;
  }

  /** Barrier: turn healing past full HP into a shield (capped at a share of max HP) that fades over a few seconds. */
  addShield(overheal: number): void {
    if (overheal <= 0) return;
    this.shield = Math.min(this.maxHp * this.char.pAmt('barrier', T.barrierCap), this.shield + overheal);
    this.shieldFade = this.shield / T.barrierFade;
  }

  /** Ward / Aegis / Flame Ward: a shield of `amount` HP that fades to nothing over `seconds` (it stacks with what is there, up to 30% of max HP). */
  addTimedShield(amount: number, seconds: number): void {
    if (amount <= 0) return;
    this.shield = Math.min(this.maxHp * 0.3, this.shield + amount);
    this.shieldFade = this.shield / seconds;
  }

  /** Parry / Calm Mind and Art guards: take `mult` damage for a while. */
  guard(mult: number, seconds: number): void {
    this.guardMult = this.guardT > 0 ? Math.min(this.guardMult, mult) : mult;
    this.guardT = Math.max(this.guardT, seconds);
  }

  /** Sweep Guard / Guarded Spin: `add` more damage reduction (up to `max`), refreshed for `seconds`. */
  addSweepGuard(add: number, max: number, seconds: number): void {
    this.sweepPct = Math.min(max, (this.sweepT > 0 ? this.sweepPct : 0) + add);
    this.sweepT = seconds;
  }

  /** Damage-taken multiplier from passives and Arts right now (Parry, guards, Sweep Guard, Leilla, Iron Will). */
  damageTakenMult(): number {
    let m = 1;
    if (this.guardT > 0) m *= this.guardMult;
    if (this.sweepT > 0) m *= 1 - this.sweepPct;
    if (this.leillaT > 0) m *= magCfg.pbLeillaMult;
    if (this.ironWillT > 0) m *= this.char.artMod('ironWill', 'unbreakable') ? 0.65 : 0.8;
    return m;
  }

  /** The Art being played (null during a basic step or no step). */
  get artStep(): ArtId | null {
    return this.combo.committed && this.combo.step !== 'basic' ? (this.combo.step as ArtId) : null;
  }

  /** The Art acting right now: past its wind-up, inside its channel. */
  private get channeling(): ArtId | null {
    const art = this.artStep;
    if (!art) return null;
    const { hitAt, activeEnd } = this.combo.times;
    return this.combo.t >= hitAt && this.combo.t < activeEnd ? art : null;
  }

  /** Walking speed share allowed while an Art acts (Cyclone, Evasive Blade Dance, Run and Gun). */
  private get channelWalk(): number {
    const art = this.channeling;
    if (!art) return 0;
    if ((art === 'bladeDance' && this.char.artMod(art, 'evasive')) || (art === 'rapidVolley' && this.char.artMod(art, 'mobile'))) return 0.5;
    return ARTS[art].walk;
  }

  /** Can the player start moving / take a non-attack action right now? */
  get canMove(): boolean {
    return this.canUseItem && !this.dash;
  }

  get canAct(): boolean {
    return this.alive && this.hitstun <= 0 && this.itemLock <= 0 && this.paralysis <= 0 && !this.dash && this.dashRecover <= 0;
  }

  /** Free hands: not in a step or stunned. Injectors can be used mid-dash. */
  get canUseItem(): boolean {
    return this.alive && this.hitstun <= 0 && this.itemLock <= 0 && this.paralysis <= 0 && !this.combo.committed;
  }

  /** Not stunned or paralysed and not already dashing (charges are checked by startDash). */
  get canDash(): boolean {
    return this.alive && this.hitstun <= 0 && this.paralysis <= 0 && !this.dash;
  }

  /**
   * Dash in a world direction (unit XZ), or around an orbit centre when locked on. Cancels any
   * step or item use in progress. Returns false if it couldn't start.
   */
  startDash(dx: number, dz: number, orbit: { x: number; z: number; fwd: number; side: number } | null = null, opts: { blink?: boolean; free?: boolean } = {}): boolean {
    if (!this.canDash || this.dashCharges < 1) return false;
    this.dashCharges--;
    this.combo.interrupt();
    this.endArt();
    this.itemLock = 0;
    this.drinkT = 0;
    this.aimYaw = null;
    this.lungeLeft = 0;
    this.knock.set(0, 0, 0);
    this.burnStacks = Math.max(0, this.burnStacks - dashCfg.burnShed);
    this.burnDecay = 0;
    let o: DashState['orbit'] = null;
    if (orbit) {
      const r = Math.hypot(this.pos.x - orbit.x, this.pos.z - orbit.z);
      // Too close to circle meaningfully: dash straight.
      if (r > 1.5) o = { ...orbit, r };
    }
    this.dash = { t: 0, dur: opts.blink ? T.blinkDuration : dashCfg.duration, free: !!opts.free, dx, dz, orbit: o };
    if (!o) {
      // Face where she's going (locked on, she keeps facing the target).
      this.yaw = Math.atan2(dx, dz);
      this.dashLocal = { fwd: 1, side: 0 };
    }
    return true;
  }

  /** An interrupted or finished Art leaves nothing behind (a guard, a move in progress). */
  private endArt(): void {
    this.artMove = null;
    this.guardStanceT = 0;
    this.counterReady = false;
  }

  get paralyzed(): boolean {
    return this.paralysis > 0;
  }

  /** Paralyse unless immune. Returns true if it took hold. */
  paralyze(seconds = statuses.paralysisDuration): boolean {
    if (!this.alive || this.paraImmune > 0 || this.paralysis > 0) return false;
    this.paralysis = seconds;
    this.paralysisTotal = seconds;
    this.combo.interrupt();
    this.endArt();
    this.aimYaw = null;
    return true;
  }

  /** End paralysis now and ward it off for a while (seconds; default the usual immunity). */
  cureParalysis(ward = statuses.paralysisImmunity): void {
    this.paralysis = 0;
    this.paraImmune = Math.max(this.paraImmune, ward);
  }

  /** Queue HP or TP to land over `seconds` (Steady doses and regeneration stack onto what is still landing). */
  addRegen(kind: 'hp' | 'tp', amount: number, seconds: number): void {
    const r = this.regen[kind];
    r.left += amount;
    r.rate = r.left / seconds;
  }

  /** Advance the current dash: an eased burst (fast start, slow finish) of dashCfg.distance metres. */
  private updateDash(dt: number): void {
    const d = this.dash!;
    const D = d.dur;
    const t0 = d.t;
    d.t = Math.min(D, d.t + dt);
    // Speed falls linearly from 1.5x to 0.5x the average over the dash.
    const avg = dashCfg.distance / D;
    const dist = avg * ((1.5 * d.t - (0.5 * d.t * d.t) / D) - (1.5 * t0 - (0.5 * t0 * t0) / D));
    const o = d.orbit;
    if (o) {
      const tx = o.x - this.pos.x;
      const tz = o.z - this.pos.z;
      const len = Math.hypot(tx, tz) || 1;
      const ux = tx / len;
      const uz = tz / len;
      // Tangent to her right while facing the target.
      const rx = -uz;
      const rz = ux;
      let mx = ux * o.fwd + rx * o.side;
      let mz = uz * o.fwd + rz * o.side;
      const ml = Math.hypot(mx, mz) || 1;
      mx /= ml;
      mz /= ml;
      this.pos.x += mx * dist;
      this.pos.z += mz * dist;
      if (Math.abs(o.fwd) < 0.3) {
        // A pure sidestep circles the target at the distance it started from.
        const nx = this.pos.x - o.x;
        const nz = this.pos.z - o.z;
        const nl = Math.hypot(nx, nz) || 1;
        this.pos.x = o.x + (nx / nl) * o.r;
        this.pos.z = o.z + (nz / nl) * o.r;
      }
      this.yaw = Math.atan2(tx, tz);
      this.dashLocal = { fwd: o.fwd, side: o.side };
    } else {
      this.pos.x += d.dx * dist;
      this.pos.z += d.dz * dist;
    }
    if (d.t >= D) {
      this.dash = null;
      this.dashRecover = dashCfg.recovery;
      if (d.free) this.freeAttack = true;
    }
  }

  /** Carry her along an Art's move (eased: fast start, soft landing). */
  private updateArtMove(dt: number): void {
    const m = this.artMove!;
    m.t = Math.min(m.dur, m.t + dt);
    const u = m.dur > 0 ? m.t / m.dur : 1;
    const e = 1 - (1 - u) * (1 - u);
    this.pos.x = m.fx + (m.tx - m.fx) * e;
    this.pos.z = m.fz + (m.tz - m.fz) * e;
    if (m.t >= m.dur) this.artMove = null;
  }

  clearStatuses(): void {
    this.poison = 0;
    this.paralysis = 0;
    this.paraImmune = 0;
    this.burnStacks = 0;
    this.burnDecay = 0;
    this.corruption = 0;
    this.corruptDecay = 0;
    this.corruptTimer = 0;
  }

  /** Did she walk this frame (sheds Burn faster)? */
  get moving(): boolean {
    return this.moved;
  }

  fullRestore(): void {
    this.hp = this.maxHp;
    this.tp = this.maxTp;
    this.regen.hp.left = this.regen.tp.left = 0;
  }

  /** Revive / reset transient state (after death, area change). */
  resetState(): void {
    this.hitstun = 0;
    this.itemLock = 0;
    this.drinkT = 0;
    this.brace = 0;
    this.clarity = 0;
    this.shield = 0;
    this.retaliate = 0;
    this.slipstream = 0;
    this.guardT = this.sweepT = this.composureT = this.rushT = this.leillaT = this.pointBlankT = 0;
    this.critNextT = this.ironWillT = this.swiftT = 0;
    this.bonusSwings = this.extraStrikes = 0;
    this.halfCostNext = false;
    this.ironPoise = this.ironSwing = this.freeAttack = false;
    this.regen.hp.left = this.regen.tp.left = 0;
    this.knock.set(0, 0, 0);
    this.combo.interrupt();
    this.endArt();
    this.cooldowns.clear();
    this.group.rotation.x = 0;
    this.deathT = 0;
    this.aimYaw = null;
    this.clearStatuses();
    this.slowMult = 1;
    this.dash = null;
    this.dashRecover = 0;
    this.dashCharges = this.maxDashCharges;
    this.dashRefill = 0;
  }

  clearBuffs(): void {
    this.buffs.atp = { pct: 0, t: 0 };
    this.buffs.def = { pct: 0, t: 0 };
  }

  /** Rebuild the held weapon if the equipped weapon changed. */
  refreshWeapon(): void {
    const kind = this.char.weaponKind();
    const has = !!this.char.weaponInstance();
    const key = `${has ? kind.kind : 'none'}:${this.char.weaponDef().id}`;
    if (key === this.weaponKey && this.weapon) return;
    this.weaponKey = key;
    if (this.weapon) this.model.grip.remove(this.weapon.group);
    this.weapon = buildWeapon(has ? kind.kind : 'none', kind.color);
    this.model.grip.add(this.weapon.group);
  }

  private get grip(): Grip {
    return this.char.weaponInstance() ? GRIP[this.char.weaponKind().kind] : 'none';
  }

  /** Press the basic attack or an Art: starts the chain, or chains the next step inside the window. */
  pressStep(step: StepId): ComboEvent[] {
    if (!this.canAct) return [];
    return this.combo.press(step);
  }

  /** Seconds before this Art is ready again (0 = ready). */
  cooldownLeft(id: ArtId): number {
    return Math.max(0, this.cooldowns.get(id) ?? 0);
  }

  /** Used an injector or item: the hands are busy for a moment. */
  onItemUse(lock: number): void {
    this.itemLock = lock;
    this.drinkT = lock;
  }

  onEarly(): void {
    this.flash = 0.25;
    this.flashColor = 0xff3030;
  }

  onPerfect(): void {
    this.flash = 0.25;
    this.flashColor = 0xffd25a;
  }

  /** A step starts: the small forward step into it (heavy weapons step further, melee Arts further still). */
  onStepStart(): void {
    // Iron Finish: the step after a finisher keeps Poise from start to end.
    this.ironSwing = this.ironPoise;
    this.ironPoise = false;
    this.ticksDone = 0;
    const kind = this.char.weaponKind();
    const w = weaponWeights[kind.weight ?? 'medium'];
    const art = this.artStep;
    if (kind.ranged || kind.family === 'caster' || !this.char.weaponInstance()) this.lungeLeft = 0;
    else if (!art) this.lungeLeft = w.lunge;
    else if (art === 'risingEdge') this.lungeLeft = 2;
    else this.lungeLeft = ARTS[art].pose === 'cut' || ARTS[art].pose === 'slam' ? w.lungeHeavy : 0;
  }

  /**
   * Poise: from the start of a melee step until its strike (or channel) ends, hits don't interrupt it. Heavy weapons
   * always have it, Arts that say so too; Steadfast gives it to every melee step, Iron Finish to a whole step,
   * Iron Will to everything while it lasts.
   */
  get poised(): boolean {
    const c = this.combo;
    if (!c.committed) return false;
    if (this.ironSwing || this.ironWillT > 0) return true;
    if (c.t >= c.times.activeEnd) return false;
    const art = this.artStep;
    if (art && ARTS[art].poise) return true;
    const kind = this.char.weaponKind();
    if (kind.ranged || kind.family === 'caster') return false;
    return weaponWeights[kind.weight ?? 'medium'].poise || this.char.hasPassive('steadfast');
  }

  takeHit(damage: number, fromX: number, fromZ: number, knockback = cfg.knockback): void {
    this.hp = Math.max(0, this.hp - damage);
    if (damage > 0 && this.char.hasPassive('retaliate')) this.retaliate = T.retaliateTime;
    if (this.char.hasPassive('steadfast')) knockback *= T.steadfastKnockback;
    if (this.ironWillT > 0 || this.guardStanceT > 0) knockback = 0;
    knockback *= 1 - Math.min(75, this.char.gearAffix('stability')) / 100;
    if ((this.poised || this.guardStanceT > 0) && this.hp > 0) {
      // Full damage and the usual post-hit invulnerability, but no flinch, knockback or cancel.
      this.iframes = cfg.iframes;
      this.flash = 0.25;
      this.flashColor = 0xdfe8ff;
      return;
    }
    this.combo.interrupt();
    this.endArt();
    this.itemLock = 0;
    this.drinkT = 0;
    this.dash = null;
    this.hitstun = cfg.hitstun;
    this.iframes = cfg.iframes;
    const dx = this.pos.x - fromX;
    const dz = this.pos.z - fromZ;
    const len = Math.hypot(dx, dz) || 1;
    this.knock.set((dx / len) * knockback, 0, (dz / len) * knockback);
  }

  /**
   * moveDir: world-space XZ direction (length 0..1).
   * Returns the chain's events plus the channel effects due this frame (the Art playing's tick numbers).
   */
  update(dt: number, moveDir: THREE.Vector3): { events: ComboEvent[]; ticks: number[] } {
    const events = this.alive ? this.combo.update(dt) : [];
    for (const ev of events) if (ev.kind === 'end') this.endArt();
    // Channel effects: each at the end of its share of the channel.
    const ticks: number[] = [];
    const art = this.artStep;
    if (art && this.alive) {
      const n = this.char.artTicks(art);
      const { hitAt, activeEnd } = this.combo.times;
      const span = activeEnd - hitAt;
      while (n > 0 && this.ticksDone < n && this.combo.t >= hitAt + (span * (this.ticksDone + 1)) / n) ticks.push(this.ticksDone++);
    }
    this.brace = Math.max(0, this.brace - dt);
    this.clarity = Math.max(0, this.clarity - dt);
    this.retaliate = Math.max(0, this.retaliate - dt);
    this.slipstream = Math.max(0, this.slipstream - dt);
    this.guardT = Math.max(0, this.guardT - dt);
    this.sweepT = Math.max(0, this.sweepT - dt);
    this.composureT = Math.max(0, this.composureT - dt);
    this.rushT = Math.max(0, this.rushT - dt);
    this.leillaT = Math.max(0, this.leillaT - dt);
    this.pointBlankT = Math.max(0, this.pointBlankT - dt);
    this.guardStanceT = Math.max(0, this.guardStanceT - dt);
    if (this.guardStanceT <= 0) this.counterReady = false;
    this.critNextT = Math.max(0, this.critNextT - dt);
    this.ironWillT = Math.max(0, this.ironWillT - dt);
    this.swiftT = Math.max(0, this.swiftT - dt);
    for (const [id, t] of this.cooldowns) {
      if (t - dt <= 0) this.cooldowns.delete(id);
      else this.cooldowns.set(id, t - dt);
    }
    if (!this.combo.committed) this.ironSwing = false;
    if (this.shield > 0) this.shield = Math.max(0, this.shield - this.shieldFade * dt);
    if (this.alive) {
      for (const k of ['hp', 'tp'] as const) {
        const r = this.regen[k];
        if (r.left <= 0) continue;
        const d = Math.min(r.left, r.rate * dt);
        r.left -= d;
        if (k === 'hp') this.hp = Math.min(this.maxHp, this.hp + d);
        else this.tp = Math.min(this.maxTp, this.tp + d);
      }
    }
    this.hitstun = Math.max(0, this.hitstun - dt);
    this.iframes = Math.max(0, this.iframes - dt);
    this.dashRecover = Math.max(0, this.dashRecover - dt);
    const maxDash = this.maxDashCharges;
    if (this.dashCharges >= maxDash) {
      this.dashCharges = maxDash;
      this.dashRefill = 0;
    } else if (this.alive && (this.dashRefill += (dt * this.dashRate) / dashCfg.recharge) >= 1) {
      this.dashCharges++;
      this.dashRefill = this.dashCharges < maxDash ? this.dashRefill - 1 : 0;
    }
    this.itemLock = Math.max(0, this.itemLock - dt);
    this.drinkT = Math.max(0, this.drinkT - dt);
    this.poison = Math.max(0, this.poison - dt);
    this.paraImmune = Math.max(0, this.paraImmune - dt);
    if (this.paralysis > 0) {
      this.paralysis -= dt;
      if (this.paralysis <= 0) this.cureParalysis();
    }
    for (const b of [this.buffs.atp, this.buffs.def]) {
      if (b.t > 0) {
        b.t -= dt;
        if (b.t <= 0) b.pct = 0;
      }
    }

    this.moved = false;
    this.stepped = false;
    if (this.alive && this.dash) {
      this.updateDash(dt);
      // Counts as moving (Burn sheds faster).
      this.moved = true;
      this.runT = 0;
    } else if (this.alive && this.artMove) {
      this.updateArtMove(dt);
      this.moved = true;
      this.runT = 0;
    } else if (this.alive) {
      const walk = this.channelWalk;
      this.moved = (this.canMove || walk > 0) && moveDir.lengthSq() > 1e-4;
      this.runT = this.moved ? this.runT + dt : 0;
      if (this.moved) {
        const speed = this.runSpeed * (walk > 0 ? walk : 1);
        this.pos.x += moveDir.x * speed * this.slowMult * dt;
        this.pos.z += moveDir.z * speed * this.slowMult * dt;
        // Walking through a channel she keeps facing her aim.
        if (walk <= 0) this.yaw = turnToward(this.yaw, Math.atan2(moveDir.x, moveDir.z), cfg.turnSpeed * dt);
        // One full stride cycle (two steps) per ~2.8 m: a brisk jog at walking pace.
        // Advance by distance so planted feet move at exactly ground speed.
        const before = this.runU;
        this.runU = (this.runU + (speed * this.slowMult * dt) / scaleGait(RUN_GAIT, speed).cycleLength) % 1;
        // Touchdowns at 0 and 0.5 (also catches the wrap past 1).
        this.stepped = Math.floor(before * 2) !== Math.floor(this.runU * 2);
      }

      if (this.combo.committed) {
        // Steer toward the aim target during the wind-up (and through an Art's channel); commit after.
        const steer = this.combo.t < this.combo.times.hitAt || (this.channeling !== null && this.channeling !== 'cyclone');
        if (this.aimYaw !== null && steer) this.yaw = turnToward(this.yaw, this.aimYaw, cfg.attackTurnSpeed * dt);
        // Small forward step through the active part of the swing.
        const { hitAt, activeEnd } = this.combo.times;
        if (this.lungeLeft > 0 && this.combo.t >= hitAt * 0.5 && this.combo.t <= activeEnd + 0.05) {
          const step = Math.min(this.lungeLeft, (this.artStep === 'risingEdge' ? 9 : 4) * dt);
          this.lungeLeft -= step;
          this.pos.x += Math.sin(this.yaw) * step;
          this.pos.z += Math.cos(this.yaw) * step;
        }
      }
    }

    // Knockback decays quickly.
    this.pos.addScaledVector(this.knock, dt);
    this.knock.multiplyScalar(Math.exp(-10 * dt));

    this.yaw = ((this.yaw % TWO_PI) + TWO_PI) % TWO_PI;
    this.group.rotation.y = this.yaw;
    this.animate(dt);
    return { events, ticks };
  }

  /** Float behind the shoulder(s), trailing the player; glow in her accent colour while Mag points (or skill points) are waiting. */
  private animateMag(dt: number): void {
    const root = this.mag.root;
    if (!root.parent && this.group.parent) this.group.parent.add(root);
    root.visible = this.group.visible && this.alive;
    this.refreshMag();
    this.mag.setGlow(this.char.magPoints > 0 || this.char.skillPointsFree > 0, this.model.pal.accent);
    this.mag.update(dt, this.pos, this.yaw);
  }

  /** A melee swing's pose (two-handed: the left hand joins the right on the weapon). */
  private swingPose(hitIndex: number, k: number): { pose: Pose; rate: number; hold?: HoldRequest } {
    if (!this.char.weaponInstance()) return { pose: humanPoses.slash(hitIndex, k, SLASH_IMPACT), rate: 30 };
    const f = swingFrame(PLAYER_SWING, hitIndex, k, SLASH_IMPACT, this.hiltKey);
    return { pose: f.pose, rate: 30, hold: f.twoHanded ? { hilt: f.hilt } : undefined };
  }

  /** Progress (0..1) through the current channel tick, with `impact` on its effect. */
  private tickK(impact: number): { i: number; k: number } {
    const art = this.artStep!;
    const n = Math.max(1, this.char.artTicks(art));
    const { hitAt, activeEnd } = this.combo.times;
    const span = Math.max(0.01, activeEnd - hitAt);
    const u = Math.min(0.999, Math.max(0, (this.combo.t - hitAt) / span)) * n;
    const i = Math.floor(u);
    return { i, k: (u - i) * impact };
  }

  /** Pick the target pose from gameplay state (and, for melee swings, how the hands hold the weapon). */
  private targetPose(): { pose: Pose; rate: number; hold?: HoldRequest } {
    const c = this.combo;
    const grip = this.grip;
    if (!this.alive) return { pose: humanPoses.hurt(), rate: 10 };
    if (this.hitstun > 0) return { pose: humanPoses.hurt(), rate: 25 };
    // Paralysed: locked mid-flinch, trembling.
    if (this.paralysis > 0) return { pose: humanPoses.hurt(), rate: 4 };
    if (this.dash) return { pose: humanPoses.dash(this.dashLocal.fwd, this.dashLocal.side), rate: 28 };
    if (this.artMove) return { pose: humanPoses.dash(this.artStep === 'backflipShot' ? -1 : 1, 0), rate: 28 };
    if (c.phase === 'swing') {
      // Gameplay time drives the pose so the blow lands exactly on the hit frame.
      const kind = this.char.weaponKind();
      const art = this.artStep;
      if (!art) {
        if (kind.family === 'caster' && this.char.weaponInstance()) return { pose: humanPoses.castChain(c.hitIndex, this.swingK(CAST_IMPACT), CAST_IMPACT), rate: 30 };
        if (kind.ranged) return { pose: humanPoses.shoot(this.swingK(SHOT_IMPACT), SHOT_IMPACT, grip), rate: 30 };
        return this.swingPose(c.hitIndex, this.swingK(SLASH_IMPACT));
      }
      const inChannel = c.t >= c.times.hitAt && c.t < c.times.activeEnd && this.char.artTicks(art) > 0;
      switch (ARTS[art].pose) {
        case 'cut':
          return this.swingPose(0, this.swingK(SLASH_IMPACT));
        case 'rise':
          return this.swingPose(1, this.swingK(SLASH_IMPACT));
        case 'slam':
          return this.swingPose(2, this.swingK(SLASH_IMPACT));
        case 'spin':
        case 'stab': {
          if (!inChannel) return this.swingPose(0, Math.min(SLASH_IMPACT * 0.9, this.swingK(SLASH_IMPACT)));
          const { i, k } = this.tickK(SLASH_IMPACT);
          return { ...this.swingPose(i % 2, k + SLASH_IMPACT * 0.5), rate: 40 };
        }
        case 'guard':
          return { pose: humanPoses.slash(0, SLASH_IMPACT * 0.3, SLASH_IMPACT), rate: 14, hold: this.char.weaponInstance() ? {} : undefined };
        case 'shoot':
        case 'lob': {
          if (!inChannel) return { pose: humanPoses.shoot(this.swingK(SHOT_IMPACT), SHOT_IMPACT, grip), rate: 30 };
          const { k } = this.tickK(SHOT_IMPACT);
          return { pose: humanPoses.shoot(k + SHOT_IMPACT * 0.6, SHOT_IMPACT, grip), rate: 40 };
        }
        case 'aim': {
          // Hold the aim through the charge, then fire.
          const k = c.t < c.times.hitAt ? SHOT_IMPACT * 0.9 : this.swingK(SHOT_IMPACT);
          return { pose: humanPoses.shoot(k, SHOT_IMPACT, grip), rate: 20 };
        }
        case 'leap':
        case 'flip':
        case 'step':
          return { pose: humanPoses.dash(ARTS[art].pose === 'flip' ? -1 : 1, 0), rate: 28 };
        case 'kneel':
        case 'shout':
        case 'support': {
          const k = c.t / Math.max(0.01, c.times.hitAt);
          return { pose: humanPoses.cast(Math.min(1, k)), rate: 16 };
        }
        case 'cast':
          return { pose: humanPoses.castChain(c.hitIndex, this.swingK(CAST_IMPACT), CAST_IMPACT), rate: 30 };
      }
    }
    if (this.drinkT > 0) return { pose: humanPoses.drink(), rate: 14 };
    if (this.moved) {
      // Ease in for the first moments, then follow the IK cycle exactly:
      // any smoothing lag here makes planted feet slide.
      const rate = this.runT < 0.18 ? 14 : Infinity;
      return { pose: gaitPose(this.runU, RUN_GAIT, this.model.legs, grip, this.runSpeed), rate };
    }
    return { pose: humanPoses.idle(this.time, grip), rate: 8 };
  }

  /** Progress through the current step's pose sequence (0..1), with `impact` on the hit frame. */
  private swingK(impact: number): number {
    const c = this.combo;
    const { hitAt, duration } = c.times;
    return c.t < hitAt ? (c.t / hitAt) * impact : impact + Math.min(1, (c.t - hitAt) / Math.max(0.01, duration - hitAt)) * (1 - impact);
  }

  /** Lay down the swing trail while the blade sweeps through a melee cut. */
  private updateTrail(dt: number, glow: number): void {
    const mesh = this.trail.mesh;
    if (this.group.parent && mesh.parent !== this.group.parent) {
      this.group.parent.add(mesh);
      this.trail.clear();
    }
    const kind = this.char.weaponKind();
    const span = this.weapon?.trail;
    let emit = false;
    if (span && this.alive && this.combo.phase === 'swing' && !kind.ranged && kind.family !== 'caster' && this.char.weaponInstance()) {
      const art = this.artStep;
      if (art && (ARTS[art].pose === 'spin' || ARTS[art].pose === 'stab')) {
        emit = this.channeling !== null;
      } else if (!art || ['cut', 'rise', 'slam'].includes(ARTS[art].pose)) {
        // The cut sweeps through k = impact - SWEEP_LEAD .. + SWEEP_LEN; a little extra covers the rig easing behind.
        const k = this.swingK(SLASH_IMPACT);
        emit = k >= SLASH_IMPACT - SWEEP_LEAD && k <= SLASH_IMPACT - SWEEP_LEAD + SWEEP_LEN + 0.05;
      }
    }
    if (emit) {
      const m = this.weapon!.group;
      m.updateWorldMatrix(true, false);
      this.trailBase.set(0, 0, span![0]).applyMatrix4(m.matrixWorld);
      this.trailTip.set(0, 0, span![1]).applyMatrix4(m.matrixWorld);
    }
    this.trail.strength = this.photonScale;
    this.trail.update(dt, emit, this.trailBase, this.trailTip, glow);
  }

  /** A technique being cast: its wind-up so far (0..1), or null. */
  get castProgress(): number | null {
    const art = this.artStep;
    if (!art || !isTechArt(art) || this.combo.t >= this.combo.times.hitAt) return null;
    return this.combo.t / Math.max(0.01, this.combo.times.hitAt);
  }

  private animate(dt: number): void {
    this.time += dt;
    const { pose, rate, hold } = this.targetPose();
    this.model.rig.apply(pose, dt, rate);
    this.hold.update(this.model, dt, hold ?? null, LEFT_HAND_AT[this.char.weaponKind().kind] ?? -0.085);
    this.model.update(dt);
    // Cyclone: the whole body turns with the blade.
    this.model.rig.root.rotation.y = this.channeling === 'cyclone' ? (this.combo.t - this.combo.times.hitAt) * 17 : 0;
    this.animateMag(dt);

    if (!this.alive) {
      // Topple backwards.
      this.deathT += dt;
      this.group.rotation.x = -Math.min(Math.PI / 2, this.deathT * 3);
      this.ringMat.opacity = 0;
      this.castMat.opacity = 0;
      this.trail.update(dt, false);
      return;
    }

    this.model.rig.root.visible = !(this.iframes > 0 && Math.floor(this.iframes * 20) % 2 === 0);
    let emissive = this.buffs.atp.t > 0 ? 0x2a0808 : 0x000000;
    // Corruption: a slow violet throb, deeper with more stacks.
    if (this.corruption > 0) emissive = Math.sin(this.time * 2.5) > 0.2 ? 0x2a0838 + this.corruption * 0x060008 : 0x10041a;
    if (this.poison > 0) emissive = Math.sin(this.time * 6) > 0 ? 0x1c4410 : 0x0c2008;
    if (this.paralysis > 0) emissive = Math.sin(this.time * 40) > 0 ? 0x807010 : 0x302a08;
    if (this.burnStacks > 0) emissive = Math.sin(this.time * (8 + this.burnStacks * 3)) > 0 ? 0x803808 : 0x401804;
    if (this.ironWillT > 0 || this.guardStanceT > 0) emissive = Math.sin(this.time * 10) > 0 ? 0x30384a : 0x181c28;
    if (this.hitstun > 0) emissive = 0x601010;
    this.model.rig.setEmissive(emissive);
    if (this.paralysis > 0) this.model.rig.root.rotation.z = Math.sin(this.time * 55) * 0.015;
    else this.model.rig.root.rotation.z = 0;

    // Photon glow: the Art's colour while one plays, gold through the perfect window.
    const c = this.combo;
    const perfect = c.inPerfect;
    const art = this.artStep;
    const glow = perfect ? 0xffe9a0 : art ? ARTS[art].color : this.char.weaponKind().color;
    if (this.weapon) {
      for (const m of this.weapon.glow) {
        m.emissive.setHex(glow);
        m.color.setHex(glow);
        m.emissiveIntensity = (perfect ? 3.2 : art ? 2.2 : c.phase === 'swing' ? 1.6 : 0.8) * this.photonScale;
      }
    }
    this.updateTrail(dt, glow);

    // Casting circle spins and brightens through a technique's wind-up.
    const cast = this.castProgress;
    if (cast !== null) {
      this.castMat.color.setHex(techniques[art as keyof typeof techniques].color);
      this.castMat.opacity = 0.4 + 0.5 * cast;
      this.castRing.rotation.z += dt * 6;
    } else {
      this.castMat.opacity = Math.max(0, this.castMat.opacity - dt * 4);
    }

    // Timing cue: the ring shrinks toward the feet as the window approaches, lands gold for the perfect window,
    // then stays cyan for the rest of it.
    this.flash = Math.max(0, this.flash - dt);
    if (!comboCfg.showCue) {
      this.ringMat.opacity = 0;
    } else if (this.flash > 0) {
      this.ringMat.color.setHex(this.flashColor);
      this.ringMat.opacity = this.flash * 3;
      this.ring.scale.setScalar(1 + (0.25 - this.flash) * 1.2);
    } else if (c.inWindow) {
      this.ringMat.color.setHex(c.inPerfect ? 0xffd25a : 0x9ffcff);
      this.ringMat.opacity = 0.95;
      this.ring.scale.setScalar(1.0);
    } else if (c.phase === 'swing' && !c.isFinisher && !c.broken) {
      const a = c.approach;
      this.ringMat.color.setHex(0x3a8cff);
      this.ringMat.opacity = 0.15 + a * 0.35;
      this.ring.scale.setScalar(1.9 - a * 0.9);
    } else {
      this.ringMat.opacity = 0;
    }
  }
}
