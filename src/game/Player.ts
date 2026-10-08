import * as THREE from 'three';
import type { Character } from './character';
import { attackTypes, casting, combo as comboCfg, dash as dashCfg, magCfg, player as cfg, pylonCfg, spellForms, statuses, weaponWeights, type AttackTiming, type AttackType } from './config';
import { Combo, hastened, type ComboEvent } from './combo';
import { turnToward } from './collision';
import { techniques, type TechId } from './data/techniques';
import { magForm } from './mag';
import { Heroine, playerLook } from './models/heroine';
import { MagCompanion } from './models/mag';
import { humanPoses, type Grip } from './models/humanoid';
import { buildWeapon, WEAPON_GRIP, type WeaponModel } from './models/weapons';
import { gaitPose, PLAYER_GAIT, scaleGait } from './models/gait';
import { PLAYER_SWING, swingFrame, WeaponHold, type HoldRequest } from './models/swings';
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

export interface CastState {
  tech: TechId;
  t: number;
  /** Seconds until the technique fires. */
  windup: number;
  /** Total rooted time: windup + recovery. */
  dur: number;
  fired: boolean;
  /** Perfect cast-chain streak this cast was started with (scales attack tech damage). */
  streak: number;
  /** Light (area) or heavy (single target) form of an attack tech; support techs are always light. */
  type: AttackType;
}

/** A dash in progress. */
export interface DashState {
  t: number;
  /** World-space direction (unit), used when there is no orbit. */
  dx: number;
  dz: number;
  /** Locked on: the dash is steered around the target (fwd: toward it, side: + clockwise seen from above). */
  orbit: { x: number; z: number; fwd: number; side: number; r: number } | null;
}

/** A long, breakable action (the Telepipe): rooted, any hit or step cancels it. */
export interface ChannelState {
  what: 'telepipe';
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
  readonly combo: Combo;
  /** Attack techs chain like combo hits; heal / buff casts are sealed so they never chain. */
  readonly castChain: Combo;
  /** Timing of the cast being started (read by castChain when it begins a cast). */
  private castTiming: AttackTiming = { windup: 0, active: 0, recovery: 0 };

  /** Seconds of hitstun remaining (cannot act). */
  hitstun = 0;
  /** Seconds of invulnerability remaining. */
  iframes = 0;
  /** Seconds locked into using an item. */
  itemLock = 0;
  readonly knock = new THREE.Vector3();
  /** Yaw the current attack is steering toward, if any. */
  aimYaw: number | null = null;
  cast: CastState | null = null;
  readonly buffs: { atp: Buff; dfp: Buff } = { atp: { pct: 0, t: 0 }, dfp: { pct: 0, t: 0 } };
  /** HP / TP still to land from Steady injector doses, and the rate they land at (per second). */
  readonly regen = { hp: { left: 0, rate: 0 }, tp: { left: 0, rate: 0 } };
  /** Seconds of Bracing left (damage taken ×injectorCfg.braceMult). */
  brace = 0;
  /** Seconds of Clarity left (attack techniques cost no TP). */
  clarity = 0;
  /** Barrier (Mag): shield HP from Resta overheal, absorbed before HP, fading at shieldFade per second. */
  shield = 0;
  private shieldFade = 0;
  /** Retaliate (Mag): seconds left in which the next melee swing hits harder (set when an enemy hits her). */
  retaliate = 0;
  /** Slipstream (Mag): seconds left in which the next attack or cast lands perfect (set by dashing out of a telegraph). */
  slipstream = 0;
  channel: ChannelState | null = null;
  /** Set when a channel ends early: 'hit' or 'moved'. Read and cleared by the game. */
  channelBroken: 'hit' | 'moved' | null = null;
  /** Seconds of poison left (HP drains; a Sol injector cures). */
  poison = 0;
  /** Seconds of paralysis left (rooted, no actions). */
  paralysis = 0;
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
  /** A foot touched down this update (footstep sound). */
  stepped = false;
  /** Seconds spent running continuously (for blending in). */
  private runT = 0;
  private time = 0;
  private deathT = 0;

  constructor(public char: Character) {
    this.combo = new Combo(comboCfg, attackTypes, () => hastened(this.char.weaponKind().timing, this.char.hasteMult()));
    this.castChain = new Combo(casting, spellForms, () => this.castTiming);

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

  /** Rebuild the Mag model if it evolved (or the character changed), and apply its Rhythm passive. */
  refreshMag(): void {
    const form = magForm(this.char.mag, this.char.leadAttribute);
    this.mag.setForm(form.stage, form.color, { theme: form.theme, colors: this.model.pal });
    const bonus = this.char.hasMagPassive('rhythm') ? magCfg.rhythmBonus : 0;
    this.combo.perfectBonus = bonus;
    this.castChain.perfectBonus = bonus;
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
  /** The Seal of Light and the Falz Halo (corruptionWard) halve what Corruption takes. */
  get corruptMult(): number {
    return this.char.hasGearPassive('corruptionWard') ? pylonCfg.sealCorruptMult : 1;
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
    this.shield = Math.min(this.shield, this.maxHp * magCfg.barrierCap);
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
    return dashCfg.charges + (this.char.hasMagPassive('fleet') ? magCfg.fleetCharges : 0);
  }
  /** Run speed (Rhythm is faster). */
  get runSpeed(): number {
    return cfg.moveSpeed * (this.char.hasMagPassive('rhythm') ? magCfg.rhythmRunMult : 1);
  }

  /** Barrier: turn healing past full HP into a shield (capped at a share of max HP) that fades over a few seconds. */
  addShield(overheal: number): void {
    if (overheal <= 0) return;
    this.shield = Math.min(this.maxHp * magCfg.barrierCap, this.shield + overheal);
    this.shieldFade = this.shield / magCfg.barrierFade;
  }

  /** Can the player start moving / take a non-attack action right now? */
  get canMove(): boolean {
    return this.canUseItem && !this.dash;
  }

  get canAct(): boolean {
    return this.alive && this.hitstun <= 0 && this.itemLock <= 0 && this.paralysis <= 0 && !this.cast && !this.channel && !this.dash && this.dashRecover <= 0;
  }

  /** Free hands: not attacking, casting or stunned. Injectors can be used mid-dash. */
  get canUseItem(): boolean {
    return this.alive && this.hitstun <= 0 && this.itemLock <= 0 && this.paralysis <= 0 && !this.combo.committed && !this.cast && !this.channel;
  }

  /** Not stunned or paralysed and not already dashing (charges are checked by startDash). */
  get canDash(): boolean {
    return this.alive && this.hitstun <= 0 && this.paralysis <= 0 && !this.dash;
  }

  /**
   * Dash in a world direction (unit XZ), or around an orbit centre when locked on. Cancels any
   * swing, cast, channel or item use in progress. Returns false if it couldn't start.
   */
  startDash(dx: number, dz: number, orbit: { x: number; z: number; fwd: number; side: number } | null = null): boolean {
    if (!this.canDash || this.dashCharges < 1) return false;
    this.dashCharges--;
    this.combo.interrupt();
    this.castChain.interrupt();
    this.cast = null;
    this.breakChannel('moved');
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
    this.dash = { t: 0, dx, dz, orbit: o };
    if (!o) {
      // Face where she's going (locked on, she keeps facing the target).
      this.yaw = Math.atan2(dx, dz);
      this.dashLocal = { fwd: 1, side: 0 };
    }
    return true;
  }

  get paralyzed(): boolean {
    return this.paralysis > 0;
  }

  /** Paralyse unless immune. Returns true if it took hold. */
  paralyze(seconds = statuses.paralysisDuration): boolean {
    if (!this.alive || this.paraImmune > 0 || this.paralysis > 0) return false;
    this.paralysis = seconds;
    this.combo.interrupt();
    this.castChain.interrupt();
    this.cast = null;
    this.breakChannel('hit');
    this.aimYaw = null;
    return true;
  }

  /** End paralysis now and ward it off for a while (seconds; default the usual immunity). */
  cureParalysis(ward = statuses.paralysisImmunity): void {
    this.paralysis = 0;
    this.paraImmune = Math.max(this.paraImmune, ward);
  }

  /** Start a channel (caller checked canMove). */
  startChannel(what: ChannelState['what'], dur: number): void {
    this.channel = { what, t: 0, dur };
    this.channelBroken = null;
    this.castMat.color.setHex(0x4ae0ff);
  }

  private breakChannel(why: 'hit' | 'moved'): void {
    if (!this.channel) return;
    this.channel = null;
    this.channelBroken = why;
  }

  /** Queue HP or TP to land over `seconds` (Steady doses stack onto what is still landing). */
  addRegen(kind: 'hp' | 'tp', amount: number, seconds: number): void {
    const r = this.regen[kind];
    r.left += amount;
    r.rate = r.left / seconds;
  }

  /** Advance the current dash: an eased burst (fast start, slow finish) of dashCfg.distance metres. */
  private updateDash(dt: number): void {
    const d = this.dash!;
    const T = dashCfg.duration;
    const t0 = d.t;
    d.t = Math.min(T, d.t + dt);
    // Speed falls linearly from 1.5x to 0.5x the average over the dash.
    const avg = dashCfg.distance / T;
    const dist = avg * ((1.5 * d.t - (0.5 * d.t * d.t) / T) - (1.5 * t0 - (0.5 * t0 * t0) / T));
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
    if (d.t >= T) {
      this.dash = null;
      this.dashRecover = dashCfg.recovery;
    }
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
    this.cast = null;
    this.channel = null;
    this.channelBroken = null;
    this.brace = 0;
    this.clarity = 0;
    this.shield = 0;
    this.retaliate = 0;
    this.slipstream = 0;
    this.regen.hp.left = this.regen.tp.left = 0;
    this.castChain.interrupt();
    this.knock.set(0, 0, 0);
    this.combo.interrupt();
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
    this.buffs.dfp = { pct: 0, t: 0 };
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

  pressAttack(type: AttackType): ComboEvent[] {
    if (!this.canAct) return [];
    return this.combo.press(type);
  }

  /**
   * Press a technique: starts a cast from idle, or chains an attack tech inside the cast-chain window
   * (pressing too early breaks the chain). Support techs only start from idle and never chain.
   * Caller has checked TP; a 'start' event means the cast began.
   */
  pressCast(tech: TechId, type: AttackType = 'light'): ComboEvent[] {
    const t = techniques[tech];
    const support = t.kind === 'heal' || t.kind === 'buff';
    const form = support ? 'light' : type;
    const chain = this.castChain;
    if (chain.committed ? support : !this.canMove) return [];
    // Swift Cast (Mag keystone) and Haste (gear) shorten the wind-up and the recovery.
    const swift = (this.char.hasMagPassive('swiftCast') ? magCfg.swiftCastMult : 1) * this.char.hasteMult();
    this.castTiming = { windup: t.castTime * swift, active: 0, recovery: t.recovery * casting.recoveryMult * swift };
    const events = chain.press(form);
    if (!events.some((e) => e.kind === 'start')) return events;
    if (support) chain.seal();
    const { hitAt, duration } = chain.times;
    this.cast = { tech, t: 0, windup: hitAt, dur: duration, fired: false, streak: chain.streak, type: form };
    this.castMat.color.setHex(t.color);
    return events;
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

  /** Called when a swing starts; begins the small forward step (heavy weapons step further). */
  onSwingStart(): void {
    const kind = this.char.weaponKind();
    const w = weaponWeights[kind.weight ?? 'medium'];
    this.lungeLeft = kind.ranged ? 0 : this.combo.type === 'light' ? w.lunge : w.lungeHeavy;
  }

  /**
   * Poise: from the start of a melee swing until its strike ends, hits don't interrupt it. Heavy weapons
   * always have it; Steadfast (Mag keystone) gives it to every melee weapon.
   */
  get poised(): boolean {
    const c = this.combo;
    const kind = this.char.weaponKind();
    if (!c.committed || kind.ranged || c.t >= c.times.activeEnd) return false;
    return weaponWeights[kind.weight ?? 'medium'].poise || this.char.hasMagPassive('steadfast');
  }

  takeHit(damage: number, fromX: number, fromZ: number, knockback = cfg.knockback): void {
    this.hp = Math.max(0, this.hp - damage);
    if (damage > 0 && this.char.hasMagPassive('retaliate')) this.retaliate = magCfg.retaliateTime;
    if (this.char.hasMagPassive('steadfast')) knockback *= magCfg.steadfastKnockback;
    if (this.poised && this.hp > 0) {
      // Full damage and the usual post-hit invulnerability, but no flinch, knockback or cancel.
      this.iframes = cfg.iframes;
      this.flash = 0.25;
      this.flashColor = 0xdfe8ff;
      return;
    }
    this.combo.interrupt();
    this.castChain.interrupt();
    this.cast = null;
    this.breakChannel('hit');
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
   * Returns combo events plus a finished cast (if any).
   */
  update(dt: number, moveDir: THREE.Vector3): { events: ComboEvent[]; castDone: CastState | null; channelDone: ChannelState | null } {
    const events = this.alive ? this.combo.update(dt) : [];
    this.brace = Math.max(0, this.brace - dt);
    this.clarity = Math.max(0, this.clarity - dt);
    this.retaliate = Math.max(0, this.retaliate - dt);
    this.slipstream = Math.max(0, this.slipstream - dt);
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
    // The Telepipe channel: stepping away cancels it.
    let channelDone: ChannelState | null = null;
    if (this.channel) {
      if (!this.alive) this.channel = null;
      else if (moveDir.lengthSq() > 1e-4) this.breakChannel('moved');
      else if ((this.channel.t += dt) >= this.channel.dur) {
        channelDone = this.channel;
        this.channel = null;
      }
    }
    this.hitstun = Math.max(0, this.hitstun - dt);
    this.iframes = Math.max(0, this.iframes - dt);
    this.dashRecover = Math.max(0, this.dashRecover - dt);
    const maxDash = this.maxDashCharges;
    if (this.dashCharges >= maxDash) {
      this.dashCharges = maxDash;
      this.dashRefill = 0;
    } else if (this.alive && (this.dashRefill += dt / dashCfg.recharge) >= 1) {
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
    for (const b of [this.buffs.atp, this.buffs.dfp]) {
      if (b.t > 0) {
        b.t -= dt;
        if (b.t <= 0) b.pct = 0;
      }
    }

    // The tech fires at the end of the windup; the caster stays rooted through the recovery
    // and the cast-chain window after it.
    let castDone: CastState | null = null;
    for (const ev of this.alive ? this.castChain.update(dt) : []) {
      if (ev.kind === 'hit' && this.cast) {
        this.cast.fired = true;
        castDone = this.cast;
      } else if (ev.kind === 'end') this.cast = null;
    }
    if (this.cast) {
      this.cast.t = this.castChain.t;
      if (!this.cast.fired && this.aimYaw !== null) this.yaw = turnToward(this.yaw, this.aimYaw, cfg.attackTurnSpeed * dt);
    }

    this.moved = false;
    this.stepped = false;
    if (this.alive && this.dash) {
      this.updateDash(dt);
      // Counts as moving (Burn sheds faster).
      this.moved = true;
      this.runT = 0;
    } else if (this.alive) {
      this.moved = this.canMove && moveDir.lengthSq() > 1e-4;
      this.runT = this.moved ? this.runT + dt : 0;
      if (this.moved) {
        const speed = this.runSpeed;
        this.pos.x += moveDir.x * speed * this.slowMult * dt;
        this.pos.z += moveDir.z * speed * this.slowMult * dt;
        const want = Math.atan2(moveDir.x, moveDir.z);
        this.yaw = turnToward(this.yaw, want, cfg.turnSpeed * dt);
        // One full stride cycle (two steps) per ~2.8 m: a brisk jog at walking pace.
        // Advance by distance so planted feet move at exactly ground speed.
        const before = this.runU;
        this.runU = (this.runU + (speed * this.slowMult * dt) / scaleGait(RUN_GAIT, speed).cycleLength) % 1;
        // Touchdowns at 0 and 0.5 (also catches the wrap past 1).
        this.stepped = Math.floor(before * 2) !== Math.floor(this.runU * 2);
      }

      if (this.combo.committed) {
        // Steer toward the aim target only during windup; commit after.
        if (this.aimYaw !== null && this.combo.t < this.combo.times.hitAt) {
          this.yaw = turnToward(this.yaw, this.aimYaw, cfg.attackTurnSpeed * dt);
        }
        // Small forward step through the active part of the swing.
        const { hitAt, activeEnd } = this.combo.times;
        if (this.lungeLeft > 0 && this.combo.t >= hitAt * 0.5 && this.combo.t <= activeEnd + 0.05) {
          const step = Math.min(this.lungeLeft, 4 * dt);
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
    return { events, castDone, channelDone };
  }

  /** Float behind the shoulder(s), trailing the player; glow in her accent colour while Mag points are unspent. */
  private animateMag(dt: number): void {
    const root = this.mag.root;
    if (!root.parent && this.group.parent) this.group.parent.add(root);
    root.visible = this.group.visible && this.alive;
    this.refreshMag();
    this.mag.setGlow(this.char.magPoints > 0, this.model.pal.accent);
    this.mag.update(dt, this.pos, this.yaw);
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
    if (c.phase === 'swing') {
      // Gameplay time drives the pose so the blow lands exactly on the hit frame.
      const { hitAt, duration } = c.times;
      const ranged = this.char.weaponKind().ranged;
      const impact = ranged ? SHOT_IMPACT : SLASH_IMPACT;
      const k = c.t < hitAt ? (c.t / hitAt) * impact : impact + Math.min(1, (c.t - hitAt) / Math.max(0.01, duration - hitAt)) * (1 - impact);
      if (ranged) return { pose: humanPoses.shoot(k, impact, grip), rate: 30 };
      // Melee is two-handed: the left hand joins the right on the weapon for every hit.
      if (!this.char.weaponInstance()) return { pose: humanPoses.slash(c.hitIndex, k, impact), rate: 30 };
      if (this.char.weaponKind().lineWidth) return { pose: humanPoses.thrust(c.hitIndex, k, impact), rate: 30, hold: {} };
      const f = swingFrame(PLAYER_SWING, c.hitIndex, k, impact, this.hiltKey);
      return { pose: f.pose, rate: 30, hold: f.twoHanded ? { hilt: f.hilt } : undefined };
    }
    if (this.cast) {
      const c = this.cast;
      const rec = c.fired ? (c.t - c.windup) / Math.max(0.01, c.dur - c.windup) : 0;
      const kind = techniques[c.tech].kind;
      if (kind === 'heal' || kind === 'buff') {
        if (!c.fired) return { pose: humanPoses.cast(c.t / c.windup), rate: 16 };
        // Hold the release, then settle back toward idle while still rooted.
        return rec < 0.45 ? { pose: humanPoses.cast(1), rate: 16 } : { pose: humanPoses.idle(this.time, grip), rate: 6 };
      }
      // Attack techs: a different move per cast-chain step that lands on the fire frame and
      // holds through the recovery, like a weapon swing's follow-through.
      const k = c.fired ? CAST_IMPACT + rec * (1 - CAST_IMPACT) : (c.t / c.windup) * CAST_IMPACT;
      return { pose: humanPoses.castChain(this.castChain.hitIndex, k, CAST_IMPACT), rate: 30 };
    }
    if (this.channel) return { pose: humanPoses.cast(Math.min(1, (this.channel.t / this.channel.dur) * 1.4)), rate: 10 };
    if (this.drinkT > 0) return { pose: humanPoses.drink(), rate: 14 };
    if (this.moved) {
      // Ease in for the first moments, then follow the IK cycle exactly:
      // any smoothing lag here makes planted feet slide.
      const rate = this.runT < 0.18 ? 14 : Infinity;
      return { pose: gaitPose(this.runU, RUN_GAIT, this.model.legs, grip, this.runSpeed), rate };
    }
    return { pose: humanPoses.idle(this.time, grip), rate: 8 };
  }

  private animate(dt: number): void {
    this.time += dt;
    const { pose, rate, hold } = this.targetPose();
    this.model.rig.apply(pose, dt, rate);
    this.hold.update(this.model, dt, hold ?? null, LEFT_HAND_AT[this.char.weaponKind().kind] ?? -0.085);
    this.model.update(dt);
    this.animateMag(dt);

    if (!this.alive) {
      // Topple backwards.
      this.deathT += dt;
      this.group.rotation.x = -Math.min(Math.PI / 2, this.deathT * 3);
      this.ringMat.opacity = 0;
      this.castMat.opacity = 0;
      return;
    }

    this.model.rig.root.visible = !(this.iframes > 0 && Math.floor(this.iframes * 20) % 2 === 0);
    let emissive = this.buffs.atp.t > 0 ? 0x2a0808 : 0x000000;
    // Corruption: a slow violet throb, deeper with more stacks.
    if (this.corruption > 0) emissive = Math.sin(this.time * 2.5) > 0.2 ? 0x2a0838 + this.corruption * 0x060008 : 0x10041a;
    if (this.poison > 0) emissive = Math.sin(this.time * 6) > 0 ? 0x1c4410 : 0x0c2008;
    if (this.paralysis > 0) emissive = Math.sin(this.time * 40) > 0 ? 0x807010 : 0x302a08;
    if (this.burnStacks > 0) emissive = Math.sin(this.time * (8 + this.burnStacks * 3)) > 0 ? 0x803808 : 0x401804;
    if (this.hitstun > 0) emissive = 0x601010;
    this.model.rig.setEmissive(emissive);
    if (this.paralysis > 0) this.model.rig.root.rotation.z = Math.sin(this.time * 55) * 0.015;
    else this.model.rig.root.rotation.z = 0;

    // Photon glow shows the attack type, and glints gold through the perfect window.
    const c = this.combo;
    const chain = this.castChain.committed ? this.castChain : c;
    if (this.weapon) {
      const t = c.phase === 'swing' ? c.type : null;
      const perfect = chain.inPerfect;
      const glow = perfect ? 0xffe9a0 : t === 'heavy' ? 0xffffff : this.char.weaponKind().color;
      for (const m of this.weapon.glow) {
        m.emissive.setHex(glow);
        m.color.setHex(glow);
        m.emissiveIntensity = (perfect ? 3.2 : c.phase === 'swing' ? 1.6 : 0.8) * this.photonScale;
      }
    }

    // Casting circle spins and brightens.
    if (this.channel) {
      this.castMat.opacity = 0.3 + 0.6 * (this.channel.t / this.channel.dur);
      this.castRing.rotation.z += dt * 3;
    } else if (this.cast && !this.cast.fired) {
      this.castMat.opacity = 0.4 + 0.5 * (this.cast.t / this.cast.windup);
      this.castRing.rotation.z += dt * 6;
    } else {
      this.castMat.opacity = Math.max(0, this.castMat.opacity - dt * 4);
    }

    // Timing cue (weapon combo or cast chain): ring shrinks toward the feet as the window
    // approaches, lands gold for the perfect window, then stays cyan for the rest of it.
    this.flash = Math.max(0, this.flash - dt);
    if (!comboCfg.showCue) {
      this.ringMat.opacity = 0;
    } else if (this.flash > 0) {
      this.ringMat.color.setHex(this.flashColor);
      this.ringMat.opacity = this.flash * 3;
      this.ring.scale.setScalar(1 + (0.25 - this.flash) * 1.2);
    } else if (chain.inWindow) {
      this.ringMat.color.setHex(chain.inPerfect ? 0xffd25a : 0x9ffcff);
      this.ringMat.opacity = 0.95;
      this.ring.scale.setScalar(1.0);
    } else if (chain.phase === 'swing' && !chain.isFinisher && !chain.broken) {
      const a = chain.approach;
      this.ringMat.color.setHex(0x3a8cff);
      this.ringMat.opacity = 0.15 + a * 0.35;
      this.ring.scale.setScalar(1.9 - a * 0.9);
    } else {
      this.ringMat.opacity = 0;
    }
  }
}
