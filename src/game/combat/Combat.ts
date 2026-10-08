import * as THREE from 'three';
import { sfx } from '../../audio';
import type { Character } from '../character';
import { angleDelta, yawTo } from '../collision';
import { accuracy, attackTypes, comboDamage, debug, feel, formulas, injectorCfg, lockOn, magCfg, player as playerCfg, spellForms, stagger, statuses, techScaling, weaponWeights, type AttackType } from '../config';
import type { ComboEvent } from '../combo';
import { specials } from '../data/items';
import { buffPct, isAttackTech, restaHeal, techniques, type TechId } from '../data/techniques';
import type { Boss } from '../enemies/Boss';
import type { Enemy, PlayerStatusKind } from '../enemies/Enemy';
import { enemyDamage, enemyHitChance, hitChance, playerDamage, randRange, rollPercent } from '../formulas';
import type { CastState, Player } from '../Player';
import type { TelegraphShape } from '../world/Telegraph';
import { inShape } from '../world/Telegraph';
import type { World } from '../world/World';
import type { Hittable } from './types';

export interface CombatHooks {
  world(): World;
  player(): Player;
  char(): Character;
  lockTarget(): Hittable | null;
  moveDir(): THREE.Vector3;
  float(pos: THREE.Vector3, text: string, cls: string): void;
  log(html: string): void;
  hitstop(sec: number): void;
  shake(mag: number): void;
  onKill(target: Hittable): void;
  onHit(target: Hittable): void;
  /** The player's attack (or DoT) took `dealt` HP off a target (charges injectors). */
  onDamage(target: Hittable, dealt: number): void;
  onPlayerHurt(): void;
  /** Last Stand just saved the player. */
  onLastStand(): void;
  rng(): number;
}

const tmp = new THREE.Vector3();

/** Combat log label for a swing boosted by Retaliate. */
const swingMultLabel = (label: string, mult: number) => (mult > 1 ? `${label} (Retaliate)` : label);
/** Critical hits (weapons and techniques) multiply damage, healing and buff strength by this. */
const CRIT_MULT = 1.5;
/** Light Foie's flame cone, and light Zonde's chain (enemies hit, and the longest hop between them). */
const FOIE_CONE_RANGE = 7;
const FOIE_CONE_DEG = 70;
const ZONDE_CHAIN = 3;
const ZONDE_HOP = 5;

export class Combat {
  constructor(private h: CombatHooks) {}

  private get p(): Player {
    return this.h.player();
  }
  private get c(): Character {
    return this.h.char();
  }

  // ------------------------------------------------------------ aiming

  /** Pick a target for the swing / shot that is starting now. */
  aimTarget(): Hittable | null {
    const lock = this.h.lockTarget();
    if (lock && lock.alive && !lock.invulnerable) return lock;
    const ranged = this.c.weaponKind().ranged;
    return this.softTarget(
      ranged ? lockOn.rangedSoftAimDeg : lockOn.softAimDeg,
      ranged ? lockOn.rangedSoftAimRange : lockOn.softAimRange,
    );
  }

  softTarget(maxDeg: number, maxRange: number): Hittable | null {
    const p = this.p;
    const md = this.h.moveDir();
    const baseYaw = md.lengthSq() > 0 ? Math.atan2(md.x, md.z) : p.yaw;
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

  // ------------------------------------------------------- player hits

  /** Damage a target on the player's behalf and report the HP it actually lost. */
  private deal(target: Hittable, dmg: number, fromX: number, fromZ: number, kb: number, staggerPts: number, credit = true): boolean {
    const before = target.hp;
    const killed = target.damage(dmg, fromX, fromZ, kb, staggerPts);
    const dealt = before - Math.max(0, target.hp);
    if (credit && dealt > 0) this.h.onDamage(target, dealt);
    return killed;
  }

  /** Damage multiplier for the swing being resolved (Retaliate); 1 outside a melee swing. */
  private swingMult = 1;

  /** Longshot (Mag): guns and techniques hit harder past a distance. */
  private longshot(target: Hittable): number {
    if (!this.c.hasMagPassive('longshot')) return 1;
    const d = Math.hypot(target.pos.x - this.p.pos.x, target.pos.z - this.p.pos.z);
    return d > magCfg.longshotRange ? magCfg.longshotMult : 1;
  }

  private playerAtp(): number {
    const [lo, hi] = this.c.weaponAtp();
    const base = this.c.stats().atp + randRange(lo, hi, this.h.rng);
    return base * (1 + this.p.buffs.atp.pct / 100);
  }

  /** Resolve one weapon hit against a target (accuracy, damage, heavy specials). */
  private hitTarget(target: Hittable, type: AttackType, hitIndex: number, streak: number, label: string, kbMult: number, scale = 1): void {
    const p = this.p;
    const c = this.c;
    const rng = this.h.rng;
    const kind = c.weaponKind();
    const at = tmp.copy(target.pos).setY(target.aimHeight + 0.6);

    const ata = c.stats().ata;
    const deadeye = c.hasMagPassive('deadeye');
    const maxHit = type === 'heavy' && deadeye ? Math.max(attackTypes.heavy.maxHit, magCfg.deadeyeMaxHit) : attackTypes[type].maxHit;
    let chance = Math.min(
      maxHit,
      hitChance(ata, target.evp, type, hitIndex) + c.weaponAttr('hit') + (kind.ranged ? 0 : accuracy.meleeBonus),
    );
    if (kind.ranged) {
      // Guns lose accuracy past their effective range (half as fast with Deadeye).
      const over = Math.hypot(target.pos.x - p.pos.x, target.pos.z - p.pos.z) - (kind.falloffStart ?? accuracy.rangedFalloffStart);
      const perM = accuracy.rangedFalloffPerM * (deadeye ? 0.5 : 1);
      if (over > 0) chance *= Math.max(accuracy.rangedFalloffFloor, 1 - over * perM);
    }
    if (!rollPercent(chance, rng)) {
      this.h.float(at, 'MISS', 'miss');
      sfx('hit.miss', { x: target.pos.x, z: target.pos.z });
      this.h.log(`${label} → ${target.name}: ${chance.toFixed(0)}% <span class="l-dim">MISS</span>`);
      return;
    }

    // Weapon specials only roll on heavy hits.
    const specialId = type === 'heavy' ? c.weaponSpecial() : undefined;
    const sp = specialId ? specials[specialId] : undefined;
    let atp = this.playerAtp();
    if (target.race) atp *= 1 + c.weaponAttr(target.race) / 100;
    const rangeMult = kind.ranged ? formulas.rangedDamageMult : formulas.meleeDamageMult;
    const comboMult = comboDamage[Math.min(streak, comboDamage.length - 1)];
    const finisher = hitIndex === 2;
    // Mag passives: Crush ignores part of the enemy's DFP on heavy melee hits, Follow-through boosts finishers,
    // Longshot boosts far gun hits and Retaliate (swingMult) the swing after being hit.
    const dfp = type === 'heavy' && !kind.ranged && c.hasMagPassive('crush') ? target.dfp * (1 - magCfg.crushDfpIgnore) : target.dfp;
    const finisherMult = finisher && c.hasMagPassive('followThrough') ? magCfg.followThroughMult : 1;
    const passiveMult = (kind.ranged ? this.longshot(target) : this.swingMult) * finisherMult;
    let dmg = playerDamage(atp, dfp, type) * kind.damageScale * scale * rangeMult * comboMult * passiveMult * target.damageMult(this.p.pos.x, this.p.pos.z, type === 'heavy');
    const crit = this.rollCrit();
    if (crit) dmg *= CRIT_MULT;
    dmg = Math.max(formulas.minDamage, Math.round(dmg));

    const strong = type === 'heavy' || finisher;
    const kb = kind.ranged ? 0.6 : feel.enemyKnockback * (strong ? 2 : 1) * kbMult;
    // Light chips at every enemy it hits, heavy breaks one; finishers count double and a melee
    // heavy finisher always staggers. Shots stagger less than blades.
    let staggerPts = (type === 'heavy' ? stagger.heavy : stagger.light) * kbMult * (finisher ? 2 : 1);
    if (kind.ranged) staggerPts *= stagger.rangedMult * kind.damageScale * scale;
    else if (finisher && type === 'heavy') staggerPts = Infinity;
    else staggerPts *= weaponWeights[kind.weight ?? 'medium'].staggerMult * (c.hasMagPassive('breaker') ? magCfg.breakerMult : 1);
    let extra = '';

    // Dim: instant kill roll before damage.
    if (sp?.effect === 'instakill' && target.maxHp < 1000 && rng() < sp.procChance) {
      dmg = target.hp;
      extra = ` <span class="l-proc">${sp.name}!</span>`;
      this.h.float(tmp.copy(target.pos).setY(target.aimHeight + 1.2), `${sp.name}!`, 'proc');
      sfx('hit.special', { x: target.pos.x, z: target.pos.z });
    }

    const killed = this.deal(target, dmg, p.pos.x, p.pos.z, kb, staggerPts);
    this.h.onHit(target);
    sfx(crit ? 'hit.crit' : strong ? 'hit.heavy' : 'hit.normal', { x: target.pos.x, z: target.pos.z });
    const cls = crit ? 'dmg crit' : type === 'heavy' ? 'dmg heavy' : 'dmg';
    this.h.float(tmp.copy(target.pos).setY(target.aimHeight + 0.6), crit ? `${dmg}!` : String(dmg), cls);
    if (target.damageMult() > 1) extra += ' <span class="l-proc">WEAK</span>';

    // Caster melee feeds TP back so a caster can swing between casts instead of only chugging fluids.
    if (kind.tpOnHit && p.tp < p.maxTp) {
      const gain = Math.min(p.maxTp - p.tp, Math.round(kind.tpOnHit * (strong ? 2 : 1) * formulas.meleeTpMult));
      if (gain > 0) {
        p.tp += gain;
        extra += ` <span class="l-dim">+${gain} TP</span>`;
      }
    }

    if (sp && !killed && sp.effect !== 'instakill' && rng() < sp.procChance) {
      if (sp.effect === 'drain') {
        const heal = Math.max(1, Math.round(dmg * sp.power));
        p.hp = Math.min(p.maxHp, p.hp + heal);
        this.h.float(tmp.copy(p.pos).setY(2.2), `+${heal}`, 'heal');
        sfx('hit.special');
      } else if (sp.effect === 'chain') {
        this.arcChain(target, dmg, sp.power, sp.duration);
        this.h.float(tmp.copy(target.pos).setY(target.aimHeight + 1.2), sp.name + '!', 'proc');
        sfx('tech.zonde', { x: target.pos.x, z: target.pos.z });
      } else {
        const status = sp.effect === 'burn' ? 'burn' : sp.effect === 'freeze' ? 'freeze' : sp.effect === 'poison' ? 'poison' : 'stun';
        target.applyStatus(status, sp.power, sp.duration);
        this.h.float(tmp.copy(target.pos).setY(target.aimHeight + 1.2), sp.name + '!', 'proc');
        sfx('hit.special', { x: target.pos.x, z: target.pos.z });
      }
      extra += ` <span class="l-proc">${sp.name}</span>`;
    }

    this.h.hitstop(strong ? feel.hitstopHeavy : feel.hitstopNormal);
    this.h.shake(feel.shakeOnHit * (strong ? 1.8 : 1));
    this.h.log(
      `${label} → ${target.name}: ${chance.toFixed(0)}% <b>${dmg}</b>${crit ? ' <span class="l-kill">CRIT</span>' : ''}${extra}${killed ? ' <span class="l-kill">KILL</span>' : ''}`,
    );
    if (killed) this.h.onKill(target);
  }

  /** Arc special: the hit jumps on to up to two more enemies near the target, for a share of its damage. */
  private arcChain(from: Hittable, dmg: number, share: number, stun: number): void {
    const hit: Hittable[] = [from];
    for (let n = 0; n < 2; n++) {
      const last = hit[hit.length - 1];
      let next: Hittable | null = null;
      let best = 5;
      for (const h of this.h.world().targets()) {
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
      this.flashBolt(next.pos, 0x80e0ff, 0.25, 4);
      const killed = this.deal(next, jump, from.pos.x, from.pos.z, 0, 0.5);
      if (!killed) next.applyStatus('stun', 0, stun);
      this.h.float(tmp.copy(next.pos).setY(next.aimHeight + 0.6), String(jump), 'dmg tech');
      if (killed) this.h.onKill(next);
    }
  }

  /** LCK ÷ 5 % chance (base LCK only), shared by weapon hits and techniques. */
  private rollCrit(): boolean {
    return this.h.rng() * 100 < this.c.baseStats().lck / 5;
  }

  /** The combo produced a 'hit' event; streak is the perfect-chain streak behind it. */
  playerAttack(type: AttackType, hitIndex: number, streak: number): void {
    const kind = this.c.weaponKind();
    const p = this.p;
    const label = `#${hitIndex + 1} ${type}${streak ? ` ★${streak}` : ''}`;
    if (kind.ranged) {
      this.fireWeapon(type, hitIndex, streak, label);
      return;
    }
    // Retaliate (Mag): the first melee swing after being hit lands harder, then it's spent.
    if (p.retaliate > 0 && this.c.hasMagPassive('retaliate')) {
      this.swingMult = magCfg.retaliateMult;
      p.retaliate = 0;
    }
    this.meleeArc(type, hitIndex, streak, swingMultLabel(label, this.swingMult));
    this.swingMult = 1;
  }

  /** Light sweeps the kind's arc (or line) and hits up to maxTargets; heavy hits the one aimed enemy. */
  private meleeArc(type: AttackType, hitIndex: number, streak: number, label: string): void {
    const p = this.p;
    const kind = this.c.weaponKind();
    const halfArc = THREE.MathUtils.degToRad(kind.arcDeg) / 2;
    // Partisans stab a straight line ahead instead of sweeping an arc.
    const line: TelegraphShape | null = kind.lineWidth
      ? { kind: 'line', x: p.pos.x, z: p.pos.z, yaw: p.yaw, length: kind.range, width: kind.lineWidth }
      : null;
    const lock = this.h.lockTarget();
    const inReach = this.h
      .world()
      .hittables()
      .filter((e) => {
        if (e.invulnerable) return false;
        const d = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
        if (d - e.radius > kind.range) return false;
        if (d < e.radius + p.radius + 0.2) return true; // point blank always counts
        if (line) return inShape(line, e.pos.x, e.pos.z, e.radius);
        return Math.abs(angleDelta(p.yaw, yawTo(p.pos.x, p.pos.z, e.pos.x, e.pos.z))) <= halfArc;
      })
      .sort((a, b) => {
        if (a === lock) return -1;
        if (b === lock) return 1;
        return a.pos.distanceToSquared(p.pos) - b.pos.distanceToSquared(p.pos);
      })
      .slice(0, type === 'light' ? kind.maxTargets : 1);

    if (inReach.length === 0) {
      this.h.log(`${label}: <span class="l-dim">whiff</span>`);
      return;
    }
    for (const t of inReach) {
      for (let i = 0; i < kind.hits; i++) {
        if (!t.alive) break;
        this.hitTarget(t, type, hitIndex, streak, kind.hits > 1 ? `${label}.${i + 1}` : label, i === 0 ? 1 : 0.3);
      }
    }
  }

  /**
   * Light shots fly straight (a fan, or one piercing round) and hit each enemy at most once, up to
   * maxTargets. Heavy shots home in on the aimed enemy (mechguns fire a burst).
   */
  private fireWeapon(type: AttackType, hitIndex: number, streak: number, label: string): void {
    const p = this.p;
    const kind = this.c.weaponKind();
    const target = this.aimTarget();
    const light = type === 'light';
    const color = light ? kind.color : 0xffffff;
    const spread = light ? THREE.MathUtils.degToRad(kind.spreadDeg ?? 0) : 0;
    const pierce = light && !!kind.pierce;
    const count = light ? Math.max(1, kind.projectiles) : (kind.heavyProjectiles ?? 1);
    const scale = light ? 1 : (kind.heavyScale ?? 1);
    const struck = new Set<Hittable>();
    const aimYaw = () =>
      target && target.alive ? yawTo(p.pos.x, p.pos.z, target.pos.x, target.pos.z) : p.yaw;
    for (let i = 0; i < count; i++) {
      const offset = count > 1 && spread > 0 ? (i / (count - 1) - 0.5) * spread : 0;
      const origin = () => {
        const yaw = p.yaw;
        return new THREE.Vector3(p.pos.x + Math.sin(yaw) * 0.8, 1.25, p.pos.z + Math.cos(yaw) * 0.8);
      };
      const yaw = aimYaw() + offset;
      let pierced = 0;
      this.h.world().spawnProjectile({
        from: origin(),
        origin,
        dir: new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)),
        speed: kind.projSpeed,
        range: kind.range,
        radius: pierce ? 0.55 : 0.35,
        size: pierce ? 0.3 : light ? 0.12 : 0.2,
        look: kind.kind === 'slicer' ? 'disc' : 'orb',
        color,
        delay: spread > 0 ? 0 : i * 0.06,
        homing: light ? null : target,
        homingRate: 5,
        onHit: (t) => {
          if (t.invulnerable) return false;
          if (light) {
            if (struck.has(t)) return false; // already hit by this attack: pass through
            if (struck.size >= kind.maxTargets) return true;
            struck.add(t);
          }
          const n = light ? struck.size : i + 1;
          this.hitTarget(t, type, hitIndex, streak, count > 1 || pierce ? `${label}.${n}` : label, 1, scale);
          return !pierce || ++pierced >= kind.maxTargets;
        },
      });
    }
  }

  // ------------------------------------------------------- techniques

  /** TP for one cast of this tech in this form (support techs always cost the light price). */
  techCost(tech: TechId, form: AttackType = 'light'): number {
    // Clarity (Mag keystone): attack techs are free for a moment after a Fluid dose.
    if (isAttackTech(tech) && this.p.clarity > 0) return 0;
    return this.c.techCost(tech, form);
  }

  /** Can the player afford this tech? Returns a reason if not. */
  techBlocked(tech: TechId, form: AttackType = 'light'): string | null {
    if (this.p.tp < this.techCost(tech, form)) return 'Not enough TP';
    return null;
  }

  /** Press a technique in a form (start or chain a cast). Returns the cast chain's events. */
  beginCast(tech: TechId, form: AttackType = 'light'): ComboEvent[] {
    const blocked = this.techBlocked(tech, form);
    if (blocked) {
      this.h.float(tmp.copy(this.p.pos).setY(2.3), blocked, 'early');
      return [];
    }
    const t = techniques[tech];
    const target = isAttackTech(tech) ? this.aimTargetForTech(t.range) : null;
    const events = this.p.pressCast(tech, form);
    if (!events.some((e) => e.kind === 'start')) return events;
    this.p.tp -= this.techCost(tech, form);
    sfx('tech.charge');
    this.p.aimYaw = target ? yawTo(this.p.pos.x, this.p.pos.z, target.pos.x, target.pos.z) : null;
    this.castTarget = target;
    return events;
  }

  private castTarget: Hittable | null = null;

  private aimTargetForTech(range: number): Hittable | null {
    const lock = this.h.lockTarget();
    if (lock && lock.alive && !lock.invulnerable) return lock;
    return this.softTarget(40, range);
  }

  /** Enemies the player can hit with a technique inside a shape. */
  private techTargetsIn(shape: TelegraphShape): Hittable[] {
    return this.h.world().targets().filter((h) => inShape(shape, h.pos.x, h.pos.z, h.radius));
  }

  /** A cast finished: apply its effect. */
  finishCast(cast: CastState): void {
    const p = this.p;
    const t = techniques[cast.tech];
    const rng = this.h.rng;
    const form = spellForms[cast.type];
    const heavy = cast.type === 'heavy';
    const label = `${heavy ? 'Heavy ' : ''}${t.name}${cast.streak ? ` ★${cast.streak}` : ''}`;
    // MST at the moment the tech fires (a weapon swap mid-cast counts).
    const mst = this.c.stats().mst;
    const comboMult = comboDamage[Math.min(cast.streak, comboDamage.length - 1)];
    const staggerPts = heavy ? stagger.heavy : stagger.light;
    const applyTechHit = (target: Hittable, statusEffect: 'burn' | 'stun' | 'freeze' | null) => {
      if (!target.alive || target.invulnerable) return;
      const crit = this.rollCrit();
      // The weapon's race % boosts techs too, so a caster's weapon attributes matter.
      const raceMult = target.race ? 1 + this.c.weaponAttr(target.race) / 100 : 1;
      const power = this.c.techDamage(cast.tech) * form.powerMult * comboMult * raceMult * this.longshot(target);
      const dmg = Math.max(1, Math.round(power * target.damageMult(p.pos.x, p.pos.z, heavy) * (crit ? CRIT_MULT : 1)));
      const killed = this.deal(target, dmg, p.pos.x, p.pos.z, heavy ? 1.5 : 1, staggerPts);
      this.h.onHit(target);
      if (t.kind === 'projectile') sfx('tech.foie.hit', { x: target.pos.x, z: target.pos.z });
      if (crit) sfx('hit.crit', { x: target.pos.x, z: target.pos.z });
      this.h.float(tmp.copy(target.pos).setY(target.aimHeight + 0.6), crit ? `${dmg}!` : String(dmg), crit ? 'dmg tech crit' : 'dmg tech');
      let extra = crit ? ' <span class="l-kill">CRIT</span>' : '';
      if (!killed && statusEffect && rng() < (t.statusChance + mst * techScaling.statusPerMst) * form.statusMult) {
        target.applyStatus(statusEffect, statusEffect === 'burn' ? Math.round(5 + mst / techScaling.burnMstDivisor) : 0, statusEffect === 'burn' ? 3 : 2);
        extra += ` <span class="l-proc">${statusEffect}</span>`;
      }
      this.h.log(`${label} → ${target.name}: <b>${dmg}</b>${extra}${killed ? ' <span class="l-kill">KILL</span>' : ''}`);
      this.h.hitstop(heavy ? feel.hitstopHeavy : feel.hitstopNormal);
      if (killed) this.h.onKill(target);
    };
    /** The aimed enemy, if it is still there (soft-aim again if it died mid-cast). */
    const aimed = (): Hittable | null => {
      const tg = this.castTarget;
      return tg && tg.alive && !tg.invulnerable ? tg : this.softTarget(60, t.range);
    };
    const noTarget = () => this.h.log(`${label}: <span class="l-dim">no target</span>`);

    switch (t.kind) {
      case 'projectile': {
        sfx('tech.foie');
        if (!heavy) {
          // Light Foie: a cone of flame ahead.
          const shape: TelegraphShape = { kind: 'cone', x: p.pos.x, z: p.pos.z, yaw: p.yaw, range: FOIE_CONE_RANGE, arcDeg: FOIE_CONE_DEG };
          this.flashShape(shape, t.color);
          for (const h of this.techTargetsIn(shape)) applyTechHit(h, 'burn');
          break;
        }
        const target = this.castTarget;
        const dir = target?.alive
          ? new THREE.Vector3(target.pos.x - p.pos.x, 0, target.pos.z - p.pos.z).normalize()
          : new THREE.Vector3(Math.sin(p.yaw), 0, Math.cos(p.yaw));
        this.h.world().spawnProjectile({
          from: new THREE.Vector3(p.pos.x + dir.x, 1.3, p.pos.z + dir.z),
          dir,
          speed: 16,
          range: t.range,
          radius: 0.6,
          size: 0.45,
          color: t.color,
          homing: target,
          homingRate: 8,
          onHit: (h) => {
            if (h.invulnerable) return false;
            applyTechHit(h, 'burn');
            return true;
          },
        });
        break;
      }
      case 'bolt': {
        const first = aimed();
        if (!first) {
          noTarget();
          break;
        }
        sfx('tech.zonde', { x: first.pos.x, z: first.pos.z });
        if (heavy) {
          this.flashBolt(first.pos, t.color, 0.55);
          applyTechHit(first, 'stun');
          break;
        }
        // Light Zonde: chains from the target to the nearest enemies nearby.
        const hit: Hittable[] = [first];
        while (hit.length < ZONDE_CHAIN) {
          const last = hit[hit.length - 1];
          let next: Hittable | null = null;
          let best = ZONDE_HOP;
          for (const h of this.h.world().targets()) {
            if (hit.includes(h) || h.invulnerable) continue;
            const d = Math.hypot(h.pos.x - last.pos.x, h.pos.z - last.pos.z);
            if (d < best) {
              best = d;
              next = h;
            }
          }
          if (!next) break;
          hit.push(next);
        }
        for (const h of hit) {
          this.flashBolt(h.pos, t.color, 0.25);
          applyTechHit(h, 'stun');
        }
        break;
      }
      case 'wave': {
        sfx('tech.barta');
        if (heavy) {
          // Heavy Barta: an ice spike erupts under one enemy.
          const target = aimed();
          if (!target) {
            noTarget();
            break;
          }
          this.flashShape({ kind: 'circle', x: target.pos.x, z: target.pos.z, radius: target.radius + 0.6 }, t.color);
          this.flashBolt(target.pos, t.color, 0.45, 3);
          applyTechHit(target, 'freeze');
          break;
        }
        const shape: TelegraphShape = { kind: 'line', x: p.pos.x, z: p.pos.z, yaw: p.yaw, length: t.range, width: 3 };
        this.flashShape(shape, t.color);
        for (const h of this.techTargetsIn(shape)) applyTechHit(h, 'freeze');
        break;
      }
      case 'heal': {
        const crit = this.rollCrit();
        const amount = Math.round(restaHeal(mst) * (crit ? CRIT_MULT : 1));
        const before = p.hp;
        p.hp = Math.min(p.maxHp, p.hp + amount);
        // Barrier (Mag): healing past full HP becomes a fading shield.
        if (this.c.hasMagPassive('barrier')) p.addShield(amount - (p.hp - before));
        this.h.float(tmp.copy(p.pos).setY(2.2), crit ? `+${amount}!` : `+${amount}`, crit ? 'heal crit' : 'heal');
        sfx('tech.resta');
        this.h.log(`${label}: healed <b>${amount}</b>${crit ? ' <span class="l-kill">CRIT</span>' : ''}`);
        break;
      }
      case 'buff': {
        const stat = t.buffStat!;
        const crit = this.rollCrit();
        const pct = buffPct(cast.tech, mst) * (crit ? CRIT_MULT : 1);
        p.buffs[stat] = { pct, t: techScaling.buffDuration };
        sfx('tech.buff', { pitch: stat === 'dfp' ? 0.8 : 1 });
        this.h.float(tmp.copy(p.pos).setY(2.3), `${stat.toUpperCase()} UP${crit ? '!' : ''}`, crit ? 'heal crit' : 'heal');
        this.h.log(`${label}: ${stat.toUpperCase()} +${pct.toFixed(0)}%${crit ? ' <span class="l-kill">CRIT</span>' : ''}`);
        break;
      }
    }
    this.castTarget = null;
  }

  /** A column of light (Zonde bolt, Barta spike) at a spot, gone after a moment. */
  private flashBolt(at: THREE.Vector3, color: number, width: number, height = 10): void {
    const world = this.h.world();
    const bolt = new THREE.Mesh(
      new THREE.CylinderGeometry(width * 0.35, width, height, 6),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 }),
    );
    bolt.position.set(at.x, height / 2, at.z);
    world.group.add(bolt);
    setTimeout(() => {
      world.group.remove(bolt);
      bolt.geometry.dispose();
    }, 140);
  }

  /** Brief ground flash showing a technique's area. */
  private flashShape(shape: TelegraphShape, color: number): void {
    this.h.world().addTelegraph(shape, 0.25, () => {}, color).friendly = true;
  }

  // ---------------------------------------------------------- incoming

  private playerDfp(): number {
    return this.c.stats().dfp * (1 + this.p.buffs.dfp.pct / 100);
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
    const at = tmp.copy(p.pos).setY(2.2);
    const chance = enemyHitChance(a.ata, this.c.stats().evp);
    if (!rollPercent(chance, this.h.rng)) {
      this.h.float(at, 'MISS', 'miss');
      sfx('player.dodge');
      this.h.log(`${a.name} attacks: ${chance.toFixed(0)}% <span class="l-dim">dodged</span>`);
      return true;
    }
    const dmg = debug.invincible ? 0 : enemyDamage(e.atp, this.playerDfp(), this.h.rng);
    this.hurtPlayer(dmg, e.pos.x, e.pos.z, a.strikeKnockback ?? playerCfg.knockback, e.name);
    if (a.strikeStatus && p.alive && this.h.rng() < (a.strikeStatusChance ?? 1)) this.applyPlayerStatus(a.strikeStatus);
    return true;
  }

  /** Telegraphed area attack from a field enemy (Lily spit, Migium lightning, petal burst). */
  enemyArea(e: Enemy, shape: TelegraphShape, atpMult: number, knockback: number, status?: PlayerStatusKind, statusChance = 1): boolean {
    return this.areaHit(e.arch.ata, e.atp * atpMult, e.name, shape, shape.x, shape.z, knockback, 15, status, statusChance);
  }

  /** Boss area attack. */
  bossHit(boss: Boss, shape: TelegraphShape, atpMult: number, fromX: number, fromZ: number, knockback: number, status?: PlayerStatusKind, statusChance = 1): boolean {
    // Big attacks are hard to evade.
    return this.areaHit(boss.ata, boss.atp * atpMult, boss.name, shape, fromX, fromZ, knockback, 25, status, statusChance);
  }

  private areaHit(
    ata: number, atp: number, source: string, shape: TelegraphShape, fromX: number, fromZ: number, knockback: number,
    accuracyBonus: number, status?: PlayerStatusKind, statusChance = 1,
  ): boolean {
    const p = this.p;
    if (!p.alive || p.iframes > 0) return false;
    if (!inShape(shape, p.pos.x, p.pos.z, p.radius)) return false;
    const chance = enemyHitChance(ata, this.c.stats().evp) + accuracyBonus;
    if (!rollPercent(chance, this.h.rng)) {
      this.h.float(tmp.copy(p.pos).setY(2.2), 'MISS', 'miss');
      sfx('player.dodge');
      return false;
    }
    const dmg = debug.invincible ? 0 : Math.max(1, Math.round(enemyDamage(atp, this.playerDfp(), this.h.rng) * this.bulwark()));
    this.hurtPlayer(dmg, fromX, fromZ, knockback, source);
    if (status && p.alive && this.h.rng() < statusChance) this.applyPlayerStatus(status);
    return true;
  }

  /** Bulwark (Mag passive): damage multiplier for area attacks, boss attacks and hazards. */
  private bulwark(): number {
    return this.c.hasMagPassive('bulwark') ? magCfg.bulwarkMult : 1;
  }

  /** Damage about to reach the player's HP, after Bracing and a Barrier shield. */
  private soak(dmg: number): number {
    const p = this.p;
    if (dmg <= 0) return dmg;
    if (p.brace > 0) dmg = Math.max(1, Math.round(dmg * injectorCfg.braceMult));
    if (p.shield > 0) {
      const absorbed = Math.min(p.shield, dmg);
      p.shield -= absorbed;
      dmg = Math.round(dmg - absorbed);
    }
    return dmg;
  }

  /** Seconds until Last Stand can save the player again. */
  private lastStandT = 0;

  /** Last Stand (Mag passive): a hit that would knock the player out leaves 1 HP, then recharges. */
  private lastStand(dmg: number): number {
    const p = this.p;
    if (dmg < p.hp || p.hp <= 1 || this.lastStandT > 0 || !this.c.hasMagPassive('lastStand')) return dmg;
    this.lastStandT = magCfg.lastStandCooldown;
    this.h.float(tmp.copy(p.pos).setY(2.7), 'LAST STAND', 'proc');
    sfx('tech.buff', { pitch: 0.7 });
    this.h.log('<span class="l-proc">Your Mag shields you: Last Stand!</span>');
    this.h.onLastStand();
    return p.hp - 1;
  }

  /** Poison, paralyse, burn or corrupt the player. `amount`: seconds (poison, paralysis) or stacks (burn, corrupt). Returns true if it took hold. */
  applyPlayerStatus(kind: PlayerStatusKind, amount?: number): boolean {
    const p = this.p;
    if (!p.alive || debug.invincible) return false;
    const at = tmp.copy(p.pos).setY(2.6);
    const seconds = amount;
    if (kind === 'corrupt') {
      const before = p.corruption;
      if (p.corrupt(amount ?? 1) <= 0) return false;
      this.h.float(at, p.corruption > 1 ? `CORRUPTION ×${p.corruption}` : 'CORRUPTION', 'corrupt');
      sfx('status.corrupt');
      if (before === 0) this.h.log('<span class="l-bad">Corruption is eating your max HP: stand in pylon light to cleanse it</span>');
      return true;
    }
    if (kind === 'burn') {
      // The Warden Core barrier halves Burn from facility hazards and machines alike.
      const stacks = Math.max(1, Math.round((amount ?? 2) * (this.c.hasEquipped('warden_core') ? 0.5 : 1)));
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
      p.poison = Math.max(p.poison, seconds ?? statuses.poisonDuration);
      if (fresh) {
        this.h.float(at, 'POISON', 'poison');
        sfx('status.poison');
        this.h.log('<span class="l-bad">You are poisoned</span>');
      }
      return true;
    }
    if (!p.paralyze(seconds ?? statuses.paralysisDuration)) return false;
    this.h.float(at, 'PARALYSIS', 'para');
    sfx('status.paralysis');
    this.h.log('<span class="l-bad">You are paralysed!</span>');
    return true;
  }

  private poisonTick = 0;

  private burnTickT = 0;

  /** Poison and Burn drain HP every half second; Burn stacks fall off over time, faster while moving. Light sheds Corruption. */
  tickPlayerStatus(dt: number): void {
    const p = this.p;
    this.lastStandT = Math.max(0, this.lastStandT - dt);
    if (!p.alive) {
      this.poisonTick = 0;
      this.burnTickT = 0;
      return;
    }
    if (p.corruption > 0 && p.inLight) {
      p.corruptDecay += dt;
      if (p.corruptDecay >= statuses.corruptLightTime) {
        p.corruptDecay -= statuses.corruptLightTime;
        p.corruption--;
        this.h.float(tmp.copy(p.pos).setY(2.4), p.corruption > 0 ? `CLEANSED · ×${p.corruption}` : 'CLEANSED', 'heal');
        sfx('status.cleanse');
      }
    } else if (p.corruption > 0) p.corruptDecay = Math.max(0, p.corruptDecay - dt);
    if (p.burnStacks > 0) {
      p.burnDecay += dt * (p.moving ? statuses.burnMoveMult : 1);
      if (p.burnDecay >= statuses.burnStackTime) {
        p.burnDecay -= statuses.burnStackTime;
        p.burnStacks--;
      }
      this.burnTickT += dt;
      if (this.burnTickT >= 0.5 && p.burnStacks > 0) {
        this.burnTickT -= 0.5;
        const dmg = this.lastStand(this.soak(Math.max(1, Math.round(p.maxHp * statuses.burnPctPerStack * p.burnStacks * 0.5))));
        p.hp = Math.max(0, p.hp - dmg);
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
    const dmg = this.lastStand(this.soak(Math.max(1, Math.round(p.maxHp * statuses.poisonPctPerSec * 0.5))));
    p.hp = Math.max(0, p.hp - dmg);
    this.h.float(tmp.copy(p.pos).setY(2.2), String(dmg), 'poison');
    if (!p.alive) this.h.onPlayerHurt();
  }

  /** Facility hazard (lava vent, crusher, laser fence, laser wall): flat damage softened by DFP, with a shove. */
  hazardHurt(damage: number, fromX: number, fromZ: number, knockback = 9, source = 'Lava vent'): void {
    const p = this.p;
    if (!p.alive || p.iframes > 0) return;
    // The Warden Core barrier: facility hazards deal half damage.
    const core = this.c.hasEquipped('warden_core') ? 0.5 : 1;
    const dmg = debug.invincible ? 0 : Math.max(1, Math.round(damage * (1 - Math.min(0.6, this.playerDfp() / 300)) * this.bulwark() * core));
    this.hurtPlayer(dmg, fromX, fromZ, knockback, source);
  }

  bossTick(shape: TelegraphShape, damage: number, fromX: number, fromZ: number): void {
    const p = this.p;
    if (!p.alive || !inShape(shape, p.pos.x, p.pos.z, p.radius)) return;
    const dmg = debug.invincible ? 0 : this.lastStand(this.soak(Math.max(1, Math.round(damage * (1 - Math.min(0.6, this.playerDfp() / 300)) * this.bulwark()))));
    p.hp = Math.max(0, p.hp - dmg);
    this.h.float(tmp.copy(p.pos).setY(2.2), String(dmg), 'burn');
    if (p.hitstun <= 0 && p.iframes <= 0) p.takeHit(0, fromX, fromZ, 3);
    if (!p.alive) this.h.onPlayerHurt();
  }

  private hurtPlayer(dmg: number, fromX: number, fromZ: number, knockback: number, source: string): void {
    const p = this.p;
    dmg = this.lastStand(this.soak(dmg));
    p.takeHit(dmg, fromX, fromZ, knockback);
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
