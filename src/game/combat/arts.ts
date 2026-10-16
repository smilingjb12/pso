import * as THREE from 'three';
import { sfx } from '../../audio';
import { yawTo } from '../collision';
import { formulas, passiveCfg as T, techScaling } from '../config';
import { ARTS, type ArtId } from '../data/arts';
import { restaHeal, techniques, type TechId } from '../data/techniques';
import { cutMult, playerDamageRaw } from '../formulas';
import type { TelegraphShape } from '../world/Telegraph';
import type { Projectile } from '../world/Projectile';
import { Burst, EMBERS, Fall, Field, fieldMark, FROST_GLITTER, GroundMark, IceSpikes, Puff, shapeArea, SNOW, STATIC, Trail } from '../world/spellFx';
import type { Combat, TechHit, WeaponHit } from './Combat';
import { chestOf, frozen, isBossPart, staggered } from './Combat';
import type { Hittable } from './types';

// What every Art does (data/arts.ts has their numbers and words). Combat calls fire() when an Art's wind-up ends
// and tick() for each of a channel's effects; everything here goes through Combat's helpers (weaponHit, techHit,
// debuffs, zones, timers, projectiles, visuals). The numbers in modifiers match their descriptions.

export interface ArtCtx {
  id: ArtId;
  hitIndex: number;
  streak: number;
  /** The Art is the chain's 3rd step. */
  finisher: boolean;
  /** Damage multiplier (an Echo repeats at half). */
  mult: number;
  /** An Echo's repeat (no side effects that would stack). */
  echo: boolean;
  label: string;
  /** Has this modifier picked (and its row open). */
  has(mod: string): boolean;
}

const tmp = new THREE.Vector3();
const deg = THREE.MathUtils.degToRad;

export class ArtRunner {
  constructor(private k: Combat) {}

  private get p() {
    return this.k.p;
  }
  private get c() {
    return this.k.c;
  }

  // ------------------------------------------------------------ helpers

  /** A weapon hit from this Art. */
  private wh(t: Hittable, power: number, x: ArtCtx, more: Partial<WeaponHit> = {}): { dmg: number; killed: boolean } {
    if (!t.alive || t.invulnerable) return { dmg: 0, killed: false };
    return this.k.weaponHit(t, { power, label: x.label, streak: x.streak, finisher: x.finisher, art: x.id, ...more, mult: (more.mult ?? 1) * x.mult });
  }

  /** A technique hit from this Art. */
  private th(t: Hittable, x: ArtCtx, more: Partial<TechHit> = {}): { dmg: number; killed: boolean } {
    return this.k.techHit(t, { tech: x.id as TechId, streak: x.streak, finisher: x.finisher, label: x.label, ...more, mult: (more.mult ?? 1) * x.mult });
  }

  /** The Art's target: the one it aimed at when it started, or a fresh soft target within `range`. */
  private target(range: number): Hittable | null {
    const t = this.k.artTarget;
    if (t && t.alive && !t.invulnerable) return t;
    return this.k.aimTarget(range);
  }

  /** The target in melee reach (or the nearest enemy in front of her). */
  private meleeTarget(extra = 0.6): Hittable | null {
    const reach = this.c.weaponKind().range + extra;
    const t = this.k.artTarget;
    if (t && t.alive && !t.invulnerable && Math.hypot(t.pos.x - this.p.pos.x, t.pos.z - this.p.pos.z) - t.radius <= reach) return t;
    return this.k.inArc(reach, 140, 1)[0] ?? null;
  }

  /** Yaw from her to a target (or her facing). */
  private yawAt(t: Hittable | null): number {
    const p = this.p;
    return t ? yawTo(p.pos.x, p.pos.z, t.pos.x, t.pos.z) : p.yaw;
  }

  /** A point `d` metres ahead of her (or on the target). */
  private spot(t: Hittable | null, d: number): THREE.Vector3 {
    const p = this.p;
    return t ? t.pos.clone() : new THREE.Vector3(p.pos.x + Math.sin(p.yaw) * d, 0, p.pos.z + Math.cos(p.yaw) * d);
  }

  /** What a weapon hit of this power deals through `armor` %, before crits and multipliers (for damage over time). */
  private weaponEstimate(armor: number, power: number): number {
    const c = this.c;
    const kind = c.weaponKind();
    const [lo, hi] = c.weaponDamage();
    return playerDamageRaw((lo + hi) / 2, armor, power) * kind.damageScale * (kind.ranged ? formulas.rangedDamageMult : formulas.meleeDamageMult);
  }

  /** What a technique hit deals before crits and multipliers (for burning ground). */
  private techEstimate(tech: TechId, share = 1, resist = 0): number {
    return this.c.techDamage(tech) * share * cutMult(resist);
  }

  /** Burning ground for `seconds`: Burn (`dps` a second) on whatever stands in it. */
  private burnGround(shape: TelegraphShape, seconds: number, dps: number, slow = 0): void {
    const chill = slow ? this.k.zoneChill(slow, 0.6) : null;
    this.k.zone(shape, seconds, 0.5, (inside) => {
      for (const e of inside) {
        e.applyStatus('burn', dps, 1);
        chill?.(e);
      }
    });
    // Scorched ground with embers rising all over it, and a faint warm glow.
    const area = shapeArea(shape);
    this.k.fx(new Field(shape, seconds, fieldMark(seconds, { color: 0x1a0c06, opacity: 0.5, look: 'scorch' }), Math.min(90, 8 + area * 2.5), { ...EMBERS, speed: [0.2, 0.9], life: [0.5, 1] }));
    this.k.fx(new GroundMark(shape, fieldMark(seconds, { color: 0xff6a20, opacity: 0.16, look: 'soft', glow: true })));
  }

  /** Ice on the ground for `seconds`: enemies in it move and act at `mult` speed. */
  private ice(shape: TelegraphShape, seconds: number, mult: number): void {
    const chill = this.k.zoneChill(mult, 0.4);
    this.k.zone(shape, seconds, 0.25, (inside) => {
      for (const e of inside) chill(e);
    });
    this.k.fx(new Field(shape, seconds, fieldMark(seconds, { color: 0xbfe8ff, opacity: 0.38, look: 'frost' }), Math.min(40, 4 + shapeArea(shape)), FROST_GLITTER));
  }

  /** A projectile from her at a target (or along her facing), hitting with `onHit`. */
  private bolt(target: Hittable | null, color: number, onHit: (t: Hittable) => boolean | void, opts: { speed?: number; range?: number; size?: number; pierce?: number; yaw?: number; from?: THREE.Vector3; homing?: boolean } = {}): Projectile {
    const yaw = opts.yaw ?? (opts.from && target ? yawTo(opts.from.x, opts.from.z, target.pos.x, target.pos.z) : this.yawAt(target));
    let through = 0;
    const hit = new Set<Hittable>();
    return this.k.shoot(yaw, {
      from: opts.from,
      speed: opts.speed ?? 30, range: opts.range ?? 20, radius: 0.5, size: opts.size ?? 0.2, color,
      homing: opts.homing === false ? null : target, homingRate: 7,
      onHit: (t) => {
        if (t.invulnerable || hit.has(t)) return false;
        hit.add(t);
        onHit(t);
        return ++through >= (opts.pierce ?? 1);
      },
    });
  }

  // ------------------------------------------------------------ dispatch

  /** An Art's wind-up ended: its effect (or the start of its channel). */
  fire(id: ArtId, x: ArtCtx): void {
    const p = this.p;
    const c = this.c;
    switch (id) {
      // ---------------------------------------------------------- Sword
      case 'cyclone':
        sfx('swing.blade', { pitch: 0.8 });
        break;
      case 'groundBreaker': {
        sfx('swing.blade', { pitch: 0.7, vol: 1.3 });
        const line = (mult: number) => {
          const shape: TelegraphShape = { kind: 'line', x: p.pos.x, z: p.pos.z, yaw: p.yaw, length: 8, width: x.has('wide') ? 3.2 : 1.6 };
          this.k.flashShape(shape, ARTS.groundBreaker.color, 0.35);
          this.k.tracer(p.yaw, 8, ARTS.groundBreaker.color, 0.4, 0.25);
          this.k.h.shake(0.35);
          for (const t of this.k.targetsIn(shape)) {
            this.wh(t, 2.4, x, { strong: mult === 1, stagger: x.has('quake') ? Infinity : 2, pierce: x.has('crush') ? 0.3 : 0, mult });
            if (x.has('daunt')) this.k.weaken(t, 0.8, 5);
          }
          if (x.has('fissure') && mult === 1) this.ice(shape, 4, 0.6);
        };
        line(1);
        if (x.has('aftershock') && !x.echo) this.k.later(0.6, () => line(0.6));
        break;
      }
      case 'sunder': {
        sfx('swing.blade', { pitch: 0.85, vol: 1.2 });
        const hit = this.k.inArc(c.weaponKind().range + 0.4, 170, x.has('sweeping') ? 99 : 3);
        for (const t of hit) {
          this.wh(t, 1.8, x, { strong: true, mult: x.has('execute') && staggered(t) ? 1.5 : 1 });
          if (t.alive) this.k.sunder(t, x.has('deep') ? 12 : 8, x.has('lingering') ? 15 : 8, 3, x.has('rend'));
        }
        if (x.has('momentum') && hit.length >= 3) this.k.refundTp(this.k.artCostPaid * 0.4, 'MOMENTUM');
        break;
      }

      // ---------------------------------------------------------- Saber
      case 'risingEdge': {
        sfx('swing.blade', { pitch: 0.9, vol: 1.2 });
        const t = this.meleeTarget(1.2);
        if (!t) {
          this.k.h.log(`${x.label}: <span class="l-dim">whiff</span>`);
          break;
        }
        const exec = x.has('executioner') && (staggered(t) || frozen(t)) ? 1.4 : 1;
        const r = this.wh(t, 3.2, x, { strong: true, stagger: x.has('balanced') ? 3 : 2, mult: (x.has('balanced') ? 1.2 : 1) * exec });
        if (x.has('airSlash')) for (const o of this.k.nearestOthers(t.pos, [t], 4, 2)) this.wh(o, 1.6, x);
        if (x.has('followUp') && !x.echo) this.k.later(0.25, () => t.alive && this.wh(t, 3.2 * 0.4, x));
        if (x.has('parry')) p.guard(0.85, 2);
        if (x.has('momentum') && r.killed) this.k.refundTp(this.k.artCostPaid * 0.5, 'MOMENTUM');
        break;
      }
      case 'crescent': {
        sfx('swing.blade', { pitch: 1.1 });
        const focused = x.has('focused');
        const range = x.has('long') ? 14 : 9;
        const yaws = x.has('twin') ? [p.yaw - deg(12), p.yaw + deg(12)] : [p.yaw];
        for (const yaw of yaws) {
          const onHit = (t: Hittable, mult = 1) => {
            this.wh(t, 1.6, x, { mult: mult * (focused ? 2 : 1) });
            if (!t.alive) return;
            if (x.has('shock')) this.k.stun(t, 1.5, 0.2);
            if (x.has('frost')) this.k.chillTarget(t, techScaling.chillMult, techScaling.chillTime);
          };
          const hit = new Set<Hittable>();
          this.k.shoot(yaw, {
            speed: 18, range, radius: 0.9, size: 0.35, color: ARTS.crescent.color,
            onHit: (t) => {
              if (t.invulnerable || hit.has(t)) return false;
              hit.add(t);
              onHit(t);
              return focused || hit.size >= 5;
            },
            onExpire: (end) => {
              if (!x.has('boomerang') || x.echo) return;
              // Back it comes, toward her, at half.
              const back = new Set<Hittable>();
              const from = end.clone().setY(1.25);
              this.k.shoot(yawTo(end.x, end.z, p.pos.x, p.pos.z), {
                from, speed: 18, range: Math.hypot(end.x - p.pos.x, end.z - p.pos.z), radius: 0.9, size: 0.3, color: ARTS.crescent.color,
                onHit: (t) => {
                  if (t.invulnerable || back.has(t)) return false;
                  back.add(t);
                  onHit(t, 0.5);
                  return back.size >= 5;
                },
              });
            },
          });
        }
        break;
      }
      case 'guardStance': {
        const dur = c.artTiming('guardStance').active;
        p.guardStanceT = dur;
        p.counterReady = true;
        p.guard(x.has('iron') ? 0.2 : 0.4, dur);
        this.k.ring(p.pos.x, p.pos.z, ARTS.guardStance.color, 1.4, 0.3);
        sfx('tech.buff', { pitch: 1.3 });
        break;
      }

      // ---------------------------------------------------------- Dagger
      case 'venomEdge':
      case 'bladeDance':
        break;
      case 'shadowStep': {
        const t = this.target(x.has('quick') ? 10 : 10);
        if (!t) {
          this.k.h.log(`${x.label}: <span class="l-dim">no target</span>`);
          break;
        }
        const dx = t.pos.x - p.pos.x;
        const dz = t.pos.z - p.pos.z;
        const len = Math.hypot(dx, dz) || 1;
        if (len > 10 + t.radius) {
          this.k.h.log(`${x.label}: <span class="l-dim">too far</span>`);
          break;
        }
        this.k.pillar(p.pos.x, p.pos.z, 0x302040, 0.5, 0.4, 2.2);
        p.pos.x = t.pos.x + (dx / len) * (t.radius + 0.9);
        p.pos.z = t.pos.z + (dz / len) * (t.radius + 0.9);
        p.yaw = yawTo(p.pos.x, p.pos.z, t.pos.x, t.pos.z);
        this.k.pillar(p.pos.x, p.pos.z, 0x302040, 0.5, 0.4, 2.2);
        sfx('player.dash', { pitch: 0.7 });
        p.critNextT = 2;
        this.k.ambush = x.has('ambush');
        if (x.has('vanish')) p.guard(0.5, 1.5);
        if (x.has('flurry')) p.extraStrikes = 2;
        if (x.has('backstab')) {
          const r = this.wh(t, 1.5, x, { strong: true });
          if (x.has('venom') && t.alive) for (let i = 0; i < 2; i++) this.k.venom(t, r.dmg * 0.15, 6, 5);
        } else if (x.has('venom')) {
          const per = this.weaponEstimate(this.k.armorOf(t), 0.6) * 0.15;
          for (let i = 0; i < 2; i++) this.k.venom(t, per, 6, 5);
        }
        break;
      }

      // ---------------------------------------------------------- Hunter (any melee)
      case 'leap': {
        const t = this.target(x.has('far') ? 12 : 8);
        const maxD = x.has('far') ? 12 : 8;
        let d = 5;
        let yaw = p.yaw;
        if (t) {
          yaw = yawTo(p.pos.x, p.pos.z, t.pos.x, t.pos.z);
          d = Math.max(0, Math.min(maxD, Math.hypot(t.pos.x - p.pos.x, t.pos.z - p.pos.z) - t.radius - 0.8));
        }
        p.yaw = yaw;
        p.artMove = { fx: p.pos.x, fz: p.pos.z, tx: p.pos.x + Math.sin(yaw) * d, tz: p.pos.z + Math.cos(yaw) * d, t: 0, dur: c.artTiming('leap').active };
        sfx('player.dash', { pitch: 0.8 });
        break;
      }
      case 'warCry': {
        const r = x.has('roar') ? 12 : 8;
        this.k.ring(p.pos.x, p.pos.z, ARTS.warCry.color, r, 0.45);
        this.k.h.shake(0.3);
        sfx('tech.buff', { pitch: 0.6, vol: 1.3 });
        for (const t of this.k.targetsIn({ kind: 'circle', x: p.pos.x, z: p.pos.z, radius: r })) {
          this.k.weaken(t, x.has('fearsome') ? 0.65 : 0.75, x.has('long') ? 10 : 6);
          t.damage(0, p.pos.x, p.pos.z, 0, x.has('shatter') ? Infinity : 1.5);
        }
        if (x.has('rally')) {
          const heal = Math.round(p.maxHp * 0.1);
          p.hp = Math.min(p.maxHp, p.hp + heal);
          this.k.h.float(tmp.copy(p.pos).setY(2.2), `+${heal}`, 'heal');
        }
        if (x.has('battle')) p.buffs.atp = { pct: Math.max(p.buffs.atp.pct, 15), t: Math.max(p.buffs.atp.t, 6) };
        break;
      }
      case 'ironWill': {
        const dur = x.has('enduring') ? 8 : 5;
        p.ironWillT = dur;
        if (x.has('mending')) p.addRegen('hp', p.maxHp * 0.02 * dur, dur);
        this.k.ring(p.pos.x, p.pos.z, ARTS.ironWill.color, 2, 0.4);
        sfx('tech.buff', { pitch: 0.8 });
        this.k.h.float(tmp.copy(p.pos).setY(2.5), 'IRON WILL', 'heal');
        break;
      }

      // ---------------------------------------------------------- Handgun
      case 'rapidVolley':
        break;
      case 'flashShot': {
        sfx('shot.handgun', { pitch: 1.3, vol: 1.2 });
        const t0 = this.target(16);
        const targets = x.has('burst')
          ? this.k.targetsIn({ kind: 'cone', x: p.pos.x, z: p.pos.z, yaw: this.yawAt(t0), range: 16, arcDeg: 40 }).slice(0, 3)
          : t0 ? [t0] : [];
        const secs = x.has('blinding') ? 3 : x.has('charged') ? 1 : 2;
        for (const t of targets) {
          this.bolt(t, ARTS.flashShot.color, (h) => {
            this.wh(h, 1.2, x, { strong: true, mult: x.has('charged') ? 2.5 : 1 });
            if (!h.alive) return;
            this.k.stun(h, secs);
            if (x.has('exposed')) this.k.mark(h, 1.2, secs);
          }, { speed: 40 });
        }
        if (x.has('room')) {
          for (const e of this.k.targetsIn({ kind: 'circle', x: p.pos.x, z: p.pos.z, radius: 4 })) this.k.shove(e, p.pos.x, p.pos.z, T.breathingRoomKnock);
          this.k.flashShape({ kind: 'circle', x: p.pos.x, z: p.pos.z, radius: 4 }, 0xffd080);
        }
        break;
      }
      case 'ricochet': {
        sfx('shot.handgun', { pitch: 0.9, vol: 1.2 });
        const first = this.target(16);
        if (!first) break;
        const bounces = x.has('chain') ? 5 : x.has('heavy') ? 2 : 3;
        const mult = x.has('heavy') ? 1.4 : 1;
        const hit: Hittable[] = [];
        const fly = (from: THREE.Vector3 | undefined, t: Hittable, left: number) => {
          this.bolt(t, ARTS.ricochet.color, (h) => {
            hit.push(h);
            this.wh(h, 1.4, x, { mult });
            if (h.alive && (x.has('arc') || x.has('shock'))) this.k.stun(h, x.has('arc') ? 0.8 : 1.5, x.has('arc') ? 1 : 0.2);
            const next = left > 0 ? this.k.nearestOthers(h.pos, hit, 1, 6)[0] : undefined;
            if (next) fly(h.pos.clone().setY(1.25), next, left - 1);
            else {
              if (x.has('hunter') && h.alive) this.k.mark(h, 1.2, 8);
              if (x.has('efficient') && hit.length >= 4) this.k.refundTp(this.k.artCostPaid * 0.3, 'EFFICIENT');
            }
          }, { from, speed: 36, range: 30 });
        };
        fly(undefined, first, bounces);
        break;
      }

      // ---------------------------------------------------------- Rifle
      case 'chargedShot': {
        sfx('shot.rifle', { pitch: 0.7, vol: 1.5 });
        const width = x.has('wide') ? 2.4 : 1.2;
        const shape: TelegraphShape = { kind: 'line', x: p.pos.x, z: p.pos.z, yaw: p.yaw, length: 26, width };
        this.k.tracer(p.yaw, 26, ARTS.chargedShot.color, width * 0.4, 0.3);
        for (const t of this.k.targetsIn(shape)) {
          this.wh(t, 3.5, x, { strong: true, stagger: x.has('impact') ? Infinity : 1.5, mult: x.has('deadeye') ? 1.2 : 1 });
          if (!t.alive) continue;
          if (x.has('cryo')) this.k.freeze(t, 1.5);
          if (x.has('mark')) this.k.mark(t, 1.15, 6);
        }
        break;
      }
      case 'mark': {
        sfx('shot.rifle', { pitch: 1.4 });
        const t = this.target(26);
        if (!t) break;
        this.bolt(t, ARTS.mark.color, (h) => {
          this.wh(h, 0.8, x);
          if (!h.alive) return;
          const marks = [h, ...(x.has('spread') ? this.k.nearestOthers(h.pos, [h], 2, 5) : [])];
          const secs = x.has('long') ? 14 : 8;
          for (const m of marks) {
            this.k.mark(m, x.has('expose') ? 1.3 : 1.2, secs, x.has('bounty'));
            if (x.has('pin')) this.k.chillTarget(m, 0.75, secs);
            this.k.h.float(tmp.copy(m.pos).setY(m.aimHeight + 1.2), 'MARKED', 'proc');
          }
        }, { speed: 45, range: 30 });
        break;
      }
      case 'freezeRound': {
        sfx('shot.rifle', { pitch: 1.2 });
        const t = this.target(26);
        if (!t) break;
        this.bolt(t, ARTS.freezeRound.color, (h) => {
          const wasChilled = this.k.chilled(h);
          this.wh(h, 1.6, x, { mult: x.has('shatter') && frozen(h) ? 2.5 : 1 });
          if (!h.alive) return;
          if (wasChilled && !isBossPart(h)) this.k.freeze(h, x.has('deep') ? 3 : 2);
          else this.k.chillTarget(h, techScaling.chillMult, techScaling.chillTime, x.has('frostbite') ? 0.8 : 1);
          if (x.has('burst')) for (const o of this.k.nearestOthers(h.pos, [h], 8, 3)) this.k.chillTarget(o, techScaling.chillMult, techScaling.chillTime, x.has('frostbite') ? 0.8 : 1);
          if (x.has('glacier')) this.ice({ kind: 'circle', x: h.pos.x, z: h.pos.z, radius: 2.5 }, 4, techScaling.chillMult);
        }, { speed: 45, range: 30 });
        break;
      }

      // ---------------------------------------------------------- Shot
      case 'scatterBlast': {
        sfx('shot.shot', { pitch: 0.85, vol: 1.3 });
        const pellets = x.has('spread') ? 13 : x.has('buckshot') ? 5 : 9;
        const arc = x.has('spread') ? 80 : 60;
        const shape: TelegraphShape = { kind: 'cone', x: p.pos.x, z: p.pos.z, yaw: p.yaw, range: 8, arcDeg: arc };
        for (let i = 0; i < Math.min(pellets, 9); i++) this.k.tracer(p.yaw + deg((i / Math.max(1, Math.min(pellets, 9) - 1) - 0.5) * arc), 8, ARTS.scatterBlast.color, 0.08, 0.12);
        for (const t of this.k.targetsIn(shape)) {
          const near = Math.hypot(t.pos.x - p.pos.x, t.pos.z - p.pos.z) - t.radius < 4;
          const per = x.has('buckshot') ? 1 : near ? 3 : 2;
          this.wh(t, 0.8 * per, x, { kb: x.has('room') ? 3 : 1.5, mult: (x.has('buckshot') ? 1.8 : 1) * (x.has('pointBlank') && near ? 1.5 : 1) });
          if (!t.alive) continue;
          if (x.has('suppress')) this.k.weaken(t, 0.85, 3);
          if (x.has('incendiary')) t.applyStatus('burn', (this.weaponEstimate(this.k.armorOf(t), 0.8 * per) * 0.4) / 3, 3);
        }
        break;
      }
      case 'napalmShell': {
        sfx('shot.shot', { pitch: 0.6 });
        const t = this.target(12);
        const at = this.spot(t, 8);
        const centers = x.has('cluster')
          ? [0, 1, 2].map((i) => new THREE.Vector3(at.x + Math.sin((i / 3) * Math.PI * 2) * 2, 0, at.z + Math.cos((i / 3) * Math.PI * 2) * 2))
          : [at];
        const share = x.has('cluster') ? 0.6 : 1;
        const radius = x.has('big') ? 4 : 3;
        for (const ctr of centers) {
          this.k.lob(ctr.x, ctr.z, 0.35, ARTS.napalmShell.color, 0.25);
          this.k.later(0.35, () => {
            const shape: TelegraphShape = { kind: 'circle', x: ctr.x, z: ctr.z, radius };
            this.k.ring(ctr.x, ctr.z, ARTS.napalmShell.color, radius * 1.2, 0.35);
            this.k.pillar(ctr.x, ctr.z, ARTS.napalmShell.color, 0.4, 0.5, 2.5);
            sfx('tech.foie.hit', { x: ctr.x, z: ctr.z });
            let est = 0;
            for (const h of this.k.targetsIn(shape)) {
              est = Math.max(est, this.weaponEstimate(this.k.armorOf(h), 1.5 * share));
              this.wh(h, 1.5, x, { strong: true, mult: share });
            }
            if (x.echo) return;
            const dps = (est || this.weaponEstimate(0, 1.5 * share)) * 0.3 * (x.has('kindling') ? 1.5 : 1);
            this.burnGround(shape, x.has('long') ? 7 : 4, dps, x.has('sticky') ? 0.7 : 0);
          });
        }
        break;
      }
      case 'slug': {
        sfx('shot.shot', { pitch: 0.7, vol: 1.4 });
        const t = this.target(12);
        this.bolt(t, ARTS.slug.color, (h) => {
          const exec = x.has('executioner') && (staggered(h) || frozen(h)) ? 1.4 : 1;
          this.wh(h, 4, x, { strong: true, stagger: x.has('breaker') ? 3 : 2, kb: 2, mult: (x.has('magnum') ? 1.3 : 1) * exec });
          if (h.alive && x.has('concussive')) this.k.stun(h, 1);
        }, { speed: 40, range: 14, size: 0.3, pierce: x.has('piercing') ? 3 : 1, homing: !x.has('piercing') });
        if (x.has('recoil') && !x.echo) {
          const back = p.yaw + Math.PI;
          p.artMove = { fx: p.pos.x, fz: p.pos.z, tx: p.pos.x + Math.sin(back) * 2, tz: p.pos.z + Math.cos(back) * 2, t: 0, dur: 0.2 };
        }
        break;
      }

      // ---------------------------------------------------------- Ranger (any gun)
      case 'freezeTrap': {
        const t = this.target(12);
        const at = x.has('toss') ? this.spot(t, 6) : p.pos.clone();
        const side = p.yaw + Math.PI / 2;
        const spots = x.has('twin') ? [-1.5, 1.5].map((o) => new THREE.Vector3(at.x + Math.sin(side) * o, 0, at.z + Math.cos(side) * o)) : [at];
        const radius = x.has('wide') ? 4.5 : 3;
        sfx('box.break', { pitch: 1.6, vol: 0.6 });
        for (const s of spots) {
          this.k.zone({ kind: 'circle', x: s.x, z: s.z, radius: 1.2 }, 15, 0, (inside) => {
            if (!inside.length) return false;
            const blast: TelegraphShape = { kind: 'circle', x: s.x, z: s.z, radius };
            this.k.ring(s.x, s.z, ARTS.freezeTrap.color, radius, 0.4);
            sfx('tech.barta', { x: s.x, z: s.z });
            for (const h of this.k.targetsIn(blast)) {
              if (x.has('damage')) this.wh(h, 2, x, { strong: true, streak: 0, finisher: false });
              else this.k.freeze(h, 2.5);
              if (h.alive && x.has('frostbite')) this.k.mark(h, 1.2, 2.5);
            }
            return true;
          }, ARTS.freezeTrap.color);
        }
        break;
      }
      case 'backflipShot': {
        const t = this.target(16);
        const away = t ? yawTo(t.pos.x, t.pos.z, p.pos.x, p.pos.z) : p.yaw + Math.PI;
        const d = x.has('far') ? 5 : 3;
        if (x.has('concussive')) {
          for (const e of this.k.targetsIn({ kind: 'circle', x: p.pos.x, z: p.pos.z, radius: 3 })) this.k.shove(e, p.pos.x, p.pos.z, T.breathingRoomKnock);
          this.k.flashShape({ kind: 'circle', x: p.pos.x, z: p.pos.z, radius: 3 }, 0xffd080);
        }
        p.artMove = { fx: p.pos.x, fz: p.pos.z, tx: p.pos.x + Math.sin(away) * d, tz: p.pos.z + Math.cos(away) * d, t: 0, dur: c.artTiming('backflipShot').active };
        sfx('player.dash', { pitch: 1.2 });
        break;
      }
      case 'grenade': {
        sfx('shot.shot', { pitch: 1.3, vol: 0.8 });
        const t = this.target(12);
        const radius = x.has('big') ? 5 : 3.5;
        const blast = (ctr: THREE.Vector3, mult: number) => {
          const shape: TelegraphShape = { kind: 'circle', x: ctr.x, z: ctr.z, radius };
          this.k.ring(ctr.x, ctr.z, ARTS.grenade.color, radius * 1.2, 0.35);
          this.k.pillar(ctr.x, ctr.z, 0xfff0c0, 0.5, 0.4, 2.5);
          this.k.h.shake(0.25);
          sfx('box.break', { x: ctr.x, z: ctr.z, pitch: 0.6, vol: 1.3 });
          let est = 0;
          for (const h of this.k.targetsIn(shape)) {
            est = Math.max(est, this.weaponEstimate(this.k.armorOf(h), 2.2 * mult));
            this.wh(h, 2.2, x, { strong: true, mult });
            if (!h.alive) continue;
            this.k.stun(h, x.has('flashbang') ? 2 : 1);
            if (x.has('cryo')) this.k.chillTarget(h, techScaling.chillMult, techScaling.chillTime);
          }
          if (x.has('incendiary') && !x.echo) this.burnGround(shape, 4, est * 0.3);
        };
        if (x.has('sticky') && t) {
          this.k.lob(t.pos.x, t.pos.z, 0.4, ARTS.grenade.color, 0.18);
          this.k.later(1, () => blast(t.alive ? t.pos.clone() : t.pos.clone(), 1.6));
          break;
        }
        const at = this.spot(t, 9);
        const centers = x.has('cluster') ? [-2, 0, 2].map((o) => new THREE.Vector3(at.x + Math.sin(p.yaw + Math.PI / 2) * o, 0, at.z + Math.cos(p.yaw + Math.PI / 2) * o)) : [at];
        for (const ctr of centers) {
          this.k.lob(ctr.x, ctr.z, 0.5, ARTS.grenade.color, 0.18);
          this.k.later(0.5, () => blast(ctr, x.has('cluster') ? 0.6 : 1));
        }
        break;
      }

      // ---------------------------------------------------------- techniques
      case 'foie':
        this.foie(x);
        break;
      case 'gifoie':
        this.gifoie(x, 1);
        break;
      case 'rafoie':
        this.rafoie(x);
        break;
      case 'zonde':
        this.zonde(x);
        break;
      case 'gizonde':
        this.gizonde(x);
        break;
      case 'razonde':
        this.razonde(x);
        break;
      case 'barta':
        this.barta(x);
        break;
      case 'gibarta':
        this.gibarta(x, 1);
        break;
      case 'rabarta':
        this.rabarta(x);
        break;
      case 'resta':
        this.resta(x);
        break;
    }
    // Ward: the single-target techniques shield you.
    if ((id === 'foie' || id === 'zonde' || id === 'barta') && !x.echo && c.hasPassive('ward')) p.addTimedShield(p.maxHp * c.pAmt('ward', T.wardShield), T.wardTime);
  }

  /** One of a channel Art's effects (tick `i` of its total), at the end of its share of the channel. */
  tick(id: ArtId, i: number, x: ArtCtx): void {
    const p = this.p;
    const c = this.c;
    const n = c.artTicks(id);
    const last = i === n - 1;
    switch (id) {
      case 'cyclone': {
        const reach = c.weaponKind().range + 0.6 + (x.has('wide') ? 1.5 : 0);
        const hit = this.k.targetsIn({ kind: 'circle', x: p.pos.x, z: p.pos.z, radius: reach });
        this.k.ring(p.pos.x, p.pos.z, ARTS.cyclone.color, reach, 0.2);
        sfx('swing.blade', { pitch: 0.9 + i * 0.05 });
        for (const t of hit) {
          const r = this.wh(t, 0.75, x, { kb: last && x.has('shockwave') ? 3 : 0.5 });
          if (!t.alive) continue;
          if (x.has('vortex')) this.k.pull(t, p.pos.x, p.pos.z, 10);
          if (x.has('burning')) t.applyStatus('burn', (r.dmg * 0.4) / 3, 3);
        }
        if (hit.length && x.has('guarded')) p.addSweepGuard(hit.length * 0.02, 0.12, 3);
        break;
      }
      case 'venomEdge': {
        const t = this.meleeTarget();
        sfx('swing.blade', { pitch: 1.3, vol: 0.7 });
        if (!t) break;
        const lacerate = x.has('lacerate') && this.k.venomStacks(t) > 0 ? 1.4 : 1;
        const r = this.wh(t, 0.6, x, { mult: lacerate });
        if (t.alive) this.k.venom(t, r.dmg * 0.15, 6, x.has('deadly') ? 8 : 5, { weak: x.has('weakening'), contagion: x.has('contagion') });
        break;
      }
      case 'bladeDance': {
        sfx('swing.blade', { pitch: 1.2 + (i % 2) * 0.1, vol: 0.8 });
        const targets = x.has('whirl') ? this.k.targetsIn({ kind: 'circle', x: p.pos.x, z: p.pos.z, radius: 2.5 }) : [this.meleeTarget()].filter((t): t is Hittable => !!t);
        for (const t of targets) {
          const exec = staggered(t) || frozen(t) ? (x.has('execute') ? 2 : 1.5) : 1;
          this.wh(t, 0.65, x, { mult: exec, stagger: last && x.has('finale') ? Infinity : 1 });
        }
        if (targets.length && x.has('thirst')) {
          const heal = Math.max(1, Math.round(p.maxHp * 0.005));
          p.hp = Math.min(p.maxHp, p.hp + heal);
        }
        break;
      }
      case 'leap': {
        // The landing.
        const radius = x.has('crater') ? 3.5 : 2.5;
        this.k.ring(p.pos.x, p.pos.z, ARTS.leap.color, radius * 1.2, 0.35);
        this.k.h.shake(0.35);
        sfx('swing.blade', { pitch: 0.6, vol: 1.3 });
        for (const t of this.k.targetsIn({ kind: 'circle', x: p.pos.x, z: p.pos.z, radius })) {
          this.wh(t, 1.4, x, { strong: true, stagger: 2 });
          if (t.alive && x.has('stun')) this.k.stun(t, 1);
        }
        if (x.has('swing')) this.k.meleeBasic(0, 0, 'Follow Through');
        if (x.has('fleet')) p.dashCharges = Math.min(p.maxDashCharges, p.dashCharges + 1);
        if (x.has('braced')) p.guard(0.7, 2);
        break;
      }
      case 'rapidVolley': {
        const t = this.target(16);
        sfx('shot.handgun', { pitch: 1.1 });
        this.bolt(t, ARTS.rapidVolley.color, (h) => {
          this.wh(h, 0.55, x, { mult: x.has('focused') ? 1.25 : 1 });
          if (!h.alive) return;
          if (x.has('suppress')) this.k.weaken(h, 0.85, 3);
          if (last && x.has('mark')) this.k.mark(h, 1.15, 6);
        }, { speed: 40, pierce: x.has('ap') ? 2 : 1 });
        break;
      }
      case 'backflipShot': {
        // Landing: fire.
        const t = this.target(16);
        const shots = x.has('double') ? 2 : 1;
        sfx('shot.handgun', { pitch: 0.95 });
        for (let s = 0; s < shots; s++) {
          this.k.later(s * 0.12, () => this.bolt(t, ARTS.backflipShot.color, (h) => {
            const r = this.wh(h, 1.4, x, { strong: true });
            if (x.has('arc') && s === 0) this.k.arcChain(h, r.dmg, 0.5, 0.8);
          }, { speed: 40 }));
        }
        if (x.has('fleet')) p.dashCharges = Math.min(p.maxDashCharges, p.dashCharges + 1);
        if (x.has('focus')) p.halfCostNext = true;
        break;
      }
    }
  }

  /** Guard Stance's counter: the first hit while guarding sets off a slash at everything in reach. */
  counter(): void {
    const p = this.p;
    const c = this.c;
    p.counterReady = false;
    const has = (m: string) => c.artMod('guardStance', m);
    this.k.h.float(tmp.copy(p.pos).setY(2.6), 'COUNTER', 'proc');
    sfx('swing.blade', { pitch: 0.8, vol: 1.4 });
    this.k.flashShape({ kind: 'circle', x: p.pos.x, z: p.pos.z, radius: c.weaponKind().range + 0.8 }, ARTS.guardStance.color);
    for (const t of this.k.inArc(c.weaponKind().range + 0.8, 360, 6)) {
      this.k.weaponHit(t, { power: 2.5, label: 'Counter', streak: 0, finisher: false, art: 'guardStance', strong: true, mult: has('riposte') ? 1.5 : 1 });
    }
    if (has('retaliate')) {
      p.bonusSwings = 3;
      p.bonusSwingMult = 1.25;
    }
    if (has('focus')) this.k.refundTp(p.maxTp * 0.2, 'FOCUS');
  }

  // ------------------------------------------------------------ techniques

  /** A fireball bursting: embers, a soft glow and a scorch mark that fades. */
  private fireBurst(x: number, z: number, radius: number, scale = 1): void {
    this.k.fx(new Burst(x, 0.9, z, Math.round(26 * scale), { ...EMBERS, spread: 'sphere', speed: [1.5, 4.5], life: [0.3, 0.6], size: 0.24 }));
    this.k.fx(new Puff(x, 0.9, z, 0xff8a40, radius * 2.2 * scale, 0.3, 0.6));
    this.k.fx(new GroundMark({ kind: 'circle', x, z, radius }, { color: 0x1a0c06, opacity: 0.45, look: 'scorch', fadeIn: 0.06, hold: 0.8, fadeOut: 1.2 }));
  }

  /** Ice crystals out of the floor, a puff of snow and a frost mark. */
  private iceBurst(x: number, z: number, count: number, spread: number, height: number): void {
    this.k.fx(new IceSpikes(x, z, count, spread, height));
    this.k.fx(new Burst(x, 0.5, z, count * 3, { ...SNOW, jitter: spread }));
    this.k.fx(new GroundMark({ kind: 'circle', x, z, radius: spread + 0.9 }, { color: 0xbfe8ff, opacity: 0.35, look: 'frost', fadeIn: 0.08, hold: 0.8, fadeOut: 0.9 }));
  }

  /** Resta: motes of light rising around her over a soft glow at her feet. */
  private supportGlow(light: number, color: number): void {
    const p = this.p;
    this.k.fx(new Burst(p.pos.x, 0.15, p.pos.z, 34, { color: light, to: color, life: [0.7, 1.2], speed: [0.5, 1.4], spread: 'up', size: 0.2, gravity: -1.4, drag: 1.4, jitter: 0.9, brightness: 0.75 }));
    this.k.fx(new GroundMark({ kind: 'circle', x: p.pos.x, z: p.pos.z, radius: 1.4 }, { color, opacity: 0.32, look: 'soft', glow: true, fadeIn: 0.1, hold: 0.25, fadeOut: 0.7 }));
    this.k.fx(new Puff(p.pos.x, 1.1, p.pos.z, color, 2.4, 0.45, 0.35));
  }

  private foie(x: ArtCtx): void {
    const p = this.p;
    const t = this.target(techniques.foie.range);
    sfx('tech.foie');
    const ball = (target: Hittable | null, share: number, offset = 0) => {
      const splash = x.has('big') ? 2.5 : 1.4;
      const size = Math.sqrt(share);
      const shot = this.bolt(target, 0xffe2a0, (h) => {
        const ignite = x.has('ignite') && h.statusTimers?.().some((s) => s.kind === 'burn') ? 1.3 : 1;
        const r = this.th(h, x, { share, stagger: 2, burn: x.has('searing') ? 1.5 : 1, mult: ignite });
        // It bursts: anything right beside the target takes some too.
        for (const o of this.k.nearestOthers(h.pos, [h], 6, splash)) this.th(o, x, { share: share * 0.6, burn: x.has('searing') ? 1.5 : 1 });
        this.fireBurst(h.pos.x, h.pos.z, splash, size);
        if (x.has('draining') && r.dmg > 0) {
          const heal = Math.max(1, Math.round(r.dmg * 0.03));
          p.hp = Math.min(p.maxHp, p.hp + heal);
        }
      }, { speed: x.has('swift') ? 32 : 16, range: techniques.foie.range, size: 0.22 * size, yaw: this.yawAt(target) + offset });
      // A hot core in an orange glow, shedding embers.
      this.k.fx(new Trail(() => (shot.dead ? null : shot.pos), 60 * size, { ...EMBERS, spread: 'sphere', speed: [0.2, 0.7], life: [0.2, 0.45], size: 0.24 * size }, { color: 0xff7a26, size: 1.9 * size }));
    };
    ball(t, 1);
    // Foie Split: two smaller fireballs at the nearest other enemies.
    if (x.has('split')) {
      const others = this.k.nearestOthers(t?.pos ?? p.pos, t ? [t] : [], 2, techniques.foie.range);
      others.forEach((o, i) => ball(o, 0.4, (i ? 1 : -1) * 0.35));
    }
  }

  private gifoie(x: ArtCtx, share: number): void {
    const p = this.p;
    const r = x.has('inferno') ? 7 : 5;
    const shape: TelegraphShape = { kind: 'circle', x: p.pos.x, z: p.pos.z, radius: r };
    sfx('tech.foie');
    // A ring of flame rolling out to the edge (the particles reach it as they burn out), and a scorch behind it.
    const out = r / 0.42;
    this.k.fx(new Burst(p.pos.x, 0.35, p.pos.z, Math.round(r * 36 * share), { ...EMBERS, spread: 'ring', speed: [out * 0.85, out * 1.05], drag: 0.5, life: [0.4, 0.52], size: 0.5, gravity: -2.5 }));
    this.k.ring(p.pos.x, p.pos.z, techniques.gifoie.color, r, 0.45, 0.3 * share);
    this.k.fx(new Burst(p.pos.x, 0.25, p.pos.z, Math.round(r * 8 * share), { ...EMBERS, spread: 'ring', speed: [out * 0.4, out * 0.8], drag: 0.5, life: [0.5, 0.8], size: 0.22, gravity: -3 }));
    this.k.fx(new GroundMark(shape, { color: 0x1a0c06, opacity: 0.3 * share, look: 'scorch', fadeIn: 0.3, hold: 0.3, fadeOut: 1 }));
    for (const t of this.k.targetsIn(shape)) {
      this.th(t, x, { share });
      if (t.alive && x.has('blast')) this.k.shove(t, p.pos.x, p.pos.z, 12);
    }
    if (share === 1 && !x.echo) {
      if (x.has('firewall')) this.burnGround(shape, 3, this.techEstimate('gifoie', 0.25));
      if (x.has('ward')) p.addTimedShield(p.maxHp * 0.05, 3);
      if (x.has('double')) this.k.later(0.6, () => this.gifoie(x, 0.5));
    }
  }

  private rafoie(x: ArtCtx): void {
    const t = this.target(techniques.rafoie.range);
    const at = this.spot(t, 8);
    const r = x.has('cataclysm') ? 5.5 : 4;
    const delay = x.has('swift') ? 0.05 : 0.7;
    const centers = x.has('twin') ? [-1.5, 1.5].map((o) => new THREE.Vector3(at.x + o, 0, at.z + o * 0.5)) : [at];
    const share = x.has('twin') ? 0.7 : 1;
    sfx('tech.charge');
    for (const ctr of centers) {
      const shape: TelegraphShape = { kind: 'circle', x: ctr.x, z: ctr.z, radius: r };
      // Where it will land glows as the meteor falls in from high up.
      this.k.fx(new GroundMark(shape, { color: 0xff7a30, opacity: 0.22, look: 'frost', glow: true, fadeIn: delay, hold: 0.05, fadeOut: 0.3 }));
      // It comes in from beyond the spot (as she looks at it), so the camera behind her sees it fall.
      const away = new THREE.Vector3(ctr.x - this.p.pos.x, 0, ctr.z - this.p.pos.z).normalize().multiplyScalar(5);
      this.k.fx(new Fall(new THREE.Vector3(ctr.x + away.x, 12, ctr.z + away.z), new THREE.Vector3(ctr.x, 0.4, ctr.z), delay, 0xff7a26, 0.5, { ...EMBERS, spread: 'sphere', speed: [0.3, 1.2], life: [0.25, 0.55], size: 0.34 }));
      this.k.later(delay, () => {
        sfx('tech.foie.hit', { x: ctr.x, z: ctr.z });
        this.k.fx(new Burst(ctr.x, 0.4, ctr.z, 70, { ...EMBERS, spread: 'up', speed: [3, 9], gravity: 7, drag: 1.2, life: [0.5, 0.9], size: 0.34 }));
        this.k.fx(new Puff(ctr.x, 1, ctr.z, 0xff8a40, r * 2.2, 0.4, 0.6));
        this.k.ring(ctr.x, ctr.z, techniques.rafoie.color, r * 1.15, 0.45, 0.35);
        if (x.echo) this.k.fx(new GroundMark(shape, { color: 0x1a0c06, opacity: 0.4, look: 'scorch', fadeIn: 0.05, hold: 0.8, fadeOut: 1 }));
        this.k.h.shake(0.3);
        for (const h of this.k.targetsIn(shape)) {
          this.th(h, x, { share, stagger: 2 });
          if (h.alive && x.has('impact')) this.k.stun(h, 1);
        }
        if (!x.echo) this.burnGround(shape, x.has('scorched') ? 7 : 4, this.techEstimate('rafoie', 0.15));
      });
    }
  }

  private zonde(x: ArtCtx): void {
    const first = this.target(techniques.zonde.range);
    if (!first) {
      this.k.h.log(`${x.label}: <span class="l-dim">no target</span>`);
      return;
    }
    sfx('tech.zonde', { x: first.pos.x, z: first.pos.z });
    const focused = x.has('focused');
    const chain = focused ? 1 : x.has('storm') ? 5 : 3;
    const hop = x.has('longArc') ? 8 : 5;
    const hit: Hittable[] = [first];
    while (hit.length < chain) {
      const next = this.k.nearestOthers(hit[hit.length - 1].pos, hit, 1, hop)[0];
      if (!next) break;
      hit.push(next);
    }
    hit.forEach((h, i) => {
      // A strike from above on the first, then the bolt jumps from each one to the next.
      if (i === 0) this.k.flashBolt(h.pos, techniques.zonde.color, focused ? 0.6 : 0.45, 9);
      else this.k.arc(chestOf(hit[i - 1]), chestOf(h), techniques.zonde.color, 0.8);
      this.th(h, x, { share: i ? 0.67 : focused ? 1.8 : 1, stun: x.has('paralyze') ? 2 : 1, stagger: (i ? 1 : 2.5) * (x.has('conductor') ? 2 : 1) });
      if (h.alive && x.has('static')) this.k.mark(h, 1.1, 4);
    });
  }

  private gizonde(x: ArtCtx): void {
    const p = this.p;
    const t = this.target(techniques.gizonde.range + 4);
    const base = this.yawAt(t);
    const n = x.has('focused') ? 1 : x.has('five') ? 5 : 3;
    const fan = x.has('five') ? 60 : 40;
    const length = x.has('long') ? 13 : 9;
    sfx('tech.zonde', { x: p.pos.x, z: p.pos.z });
    const struck = new Set<Hittable>();
    for (let i = 0; i < n; i++) {
      const yaw = base + (n > 1 ? deg((i / (n - 1) - 0.5) * fan) : 0);
      const line: TelegraphShape = { kind: 'line', x: p.pos.x, z: p.pos.z, yaw, length, width: techniques.gizonde.radius };
      // Lightning racing out along the floor from her hands, leaving a faint glow on the ground.
      const from = new THREE.Vector3(p.pos.x + Math.sin(yaw) * 0.7, 1.2, p.pos.z + Math.cos(yaw) * 0.7);
      this.k.arc(from, new THREE.Vector3(p.pos.x + Math.sin(yaw) * length, 0.6, p.pos.z + Math.cos(yaw) * length), techniques.gizonde.color, 0.9);
      this.k.fx(new GroundMark(line, { color: techniques.gizonde.color, opacity: 0.2, look: 'soft', glow: true, fadeIn: 0.03, hold: 0.05, fadeOut: 0.35 }));
      const inLine = this.k.targetsIn(line);
      for (const h of inLine) {
        if (struck.has(h)) continue;
        struck.add(h);
        this.th(h, x, { share: x.has('focused') ? 2.2 : 1, stun: x.has('paralyze') ? 2 : 1 });
      }
      if (x.has('arcing')) {
        const end = new THREE.Vector3(p.pos.x + Math.sin(yaw) * length, 0, p.pos.z + Math.cos(yaw) * length);
        const next = this.k.nearestOthers(end, [...struck], 1, 4)[0];
        if (next) {
          struck.add(next);
          this.k.arc(end.setY(0.6), chestOf(next), techniques.gizonde.color, 0.7);
          this.th(next, x, { share: 0.6, stun: x.has('paralyze') ? 2 : 1 });
        }
      }
    }
  }

  private razonde(x: ArtCtx): void {
    const t = this.target(techniques.razonde.range);
    const at = this.spot(t, 8);
    const r = x.has('wide') ? 7 : 5;
    const secs = x.has('long') ? 5 : 3;
    const strikes = x.has('long') ? 13 : 8;
    const shape: TelegraphShape = { kind: 'circle', x: at.x, z: at.z, radius: r };
    sfx('tech.zonde', { x: at.x, z: at.z });
    // A charged patch with static crawling over it; each strike is its own thin bolt (no hitstop or white flash on
    // the struck, so eight in 3 s don't strobe).
    this.k.fx(new Field(shape, secs + 0.2, fieldMark(secs + 0.2, { color: 0x5a3cff, opacity: 0.16, look: 'soft', glow: true }), Math.min(50, 6 + r * r), STATIC));
    let left = strikes;
    this.k.zone(shape, secs + 0.05, secs / strikes, (inside) => {
      if (left-- <= 0) return true;
      if (!inside.length) return false;
      const pick = x.has('eye') && t && inside.includes(t) && this.k.h.rng() < 0.6 ? t : inside[Math.floor(this.k.h.rng() * inside.length)];
      this.k.flashBolt(pick.pos, techniques.razonde.color, 0.35, 9);
      this.k.fx(new GroundMark({ kind: 'circle', x: pick.pos.x, z: pick.pos.z, radius: 0.8 }, { color: 0x1a1020, opacity: 0.35, look: 'scorch', fadeIn: 0.05, hold: 0.4, fadeOut: 0.8 }));
      sfx('tech.zonde', { x: pick.pos.x, z: pick.pos.z, vol: 0.6 });
      this.th(pick, x, { stun: x.has('paralyze') ? 2 : 1, stagger: x.has('conductor') ? 2 : 1, tick: true });
      return false;
    });
  }

  private barta(x: ArtCtx): void {
    const t = this.target(techniques.barta.range);
    sfx('tech.barta');
    if (!t) {
      this.k.h.log(`${x.label}: <span class="l-dim">no target</span>`);
      return;
    }
    const wasChilled = this.k.chilled(t);
    // Ice crystals burst up out of the floor around it.
    this.iceBurst(t.pos.x, t.pos.z, 7, t.radius * 0.7 + 0.3, 1.1 + t.radius * 0.6);
    this.th(t, x, { stagger: 2, mult: x.has('glacial') ? 1.4 : 1 });
    if (t.alive) {
      if (x.has('freezing') && wasChilled) this.k.freeze(t, 1.5);
      if (x.has('frostbite')) this.k.chillTarget(t, techScaling.chillMult, techScaling.chillTime, 0.8);
    }
    if (x.has('shards')) {
      for (const o of this.k.nearestOthers(t.pos, [t], 6, 2)) {
        this.iceBurst(o.pos.x, o.pos.z, 3, o.radius * 0.5 + 0.2, 0.7);
        this.th(o, x, { share: 0.5 });
      }
    }
    if (x.has('field') && !x.echo) this.ice({ kind: 'circle', x: t.pos.x, z: t.pos.z, radius: 2.5 }, 4, 0.6);
  }

  private gibarta(x: ArtCtx, share: number): void {
    const p = this.p;
    const t = this.target(techniques.gibarta.range + 2);
    const shape: TelegraphShape = { kind: 'cone', x: p.pos.x, z: p.pos.z, yaw: this.yawAt(t), range: x.has('long') ? 12 : 8, arcDeg: x.has('wide') ? 100 : 70 };
    sfx('tech.barta');
    // A wave of ice crystals rolling out across the cone, row by row, over frosted ground.
    const arc = deg(shape.arcDeg);
    const step = 1.5;
    const sweep = 0.28;
    for (let d = step; d <= shape.range; d += step) {
      const n = Math.min(8, Math.max(1, Math.round((d * arc) / 1.6)));
      for (let i = 0; i < n; i++) {
        const a = shape.yaw + (n > 1 ? (i / (n - 1) - 0.5) * arc * 0.85 : 0) + (Math.random() - 0.5) * 0.15;
        const sx = shape.x + Math.sin(a) * d;
        const sz = shape.z + Math.cos(a) * d;
        const h = (0.55 + 0.4 * (d / shape.range)) * Math.sqrt(share);
        this.k.later((d / shape.range) * sweep, () => this.k.fx(new IceSpikes(sx, sz, 3, 0.35, h, 0.25)));
      }
      const mx = shape.x + Math.sin(shape.yaw) * d;
      const mz = shape.z + Math.cos(shape.yaw) * d;
      this.k.later((d / shape.range) * sweep, () => this.k.fx(new Burst(mx, 0.4, mz, Math.round(4 + d), { ...SNOW, jitter: d * arc * 0.4 })));
    }
    this.k.fx(new GroundMark(shape, { color: 0xbfe8ff, opacity: 0.32 * share, look: 'frost', fadeIn: sweep, hold: 0.5, fadeOut: 0.8 }));
    for (const h of this.k.targetsIn(shape)) {
      const wasChilled = this.k.chilled(h);
      this.th(h, x, { share });
      if (!h.alive) continue;
      if (x.has('freezing') && wasChilled) this.k.freeze(h, 1.5);
      if (x.has('push')) this.k.shove(h, p.pos.x, p.pos.z, 12);
    }
    if (share === 1 && !x.echo) {
      if (x.has('field')) this.ice(shape, 4, 0.6);
      if (x.has('double')) this.k.later(0.5, () => this.gibarta(x, 0.5));
    }
  }

  private rabarta(x: ArtCtx): void {
    const p = this.p;
    const r = x.has('wide') ? 8 : 6;
    const secs = x.has('long') ? 5 : 3;
    const pulses = x.has('long') ? 10 : 6;
    const shape: TelegraphShape = { kind: 'circle', x: p.pos.x, z: p.pos.z, radius: r };
    if (x.has('eye')) p.guard(0.8, secs);
    sfx('tech.barta');
    const color = techniques.rabarta.color;
    // A steady snowstorm for the whole cast; only the last pulse (the freeze) gets a burst.
    this.k.blizzard(shape.x, shape.z, r, secs + 0.3, color);
    let done = 0;
    this.k.zone(shape, secs + 0.05, secs / pulses, (inside) => {
      done++;
      const last = done >= pulses;
      if (last) {
        // The freeze: one soft ring and a gust of snow blown out to the edge.
        this.k.ring(shape.x, shape.z, color, r, 0.5, 0.35);
        this.k.fx(new Burst(shape.x, 0.5, shape.z, Math.round(r * 14), { ...SNOW, spread: 'ring', speed: [r * 1.4, r * 2], drag: 1.5, life: [0.45, 0.6] }));
      }
      for (const h of inside) {
        const shatter = last && x.has('shatter') && frozen(h) ? 2.5 : 1;
        const wasChilled = this.k.chilled(h);
        this.th(h, x, { mult: shatter, tick: !last });
        if (last && h.alive && wasChilled && !isBossPart(h)) this.k.freeze(h, x.has('deep') ? 3 : 1.5);
      }
      return last;
    });
  }

  private resta(x: ArtCtx): void {
    const p = this.p;
    const c = this.c;
    const lowAtCast = p.hp < p.maxHp * 0.3;
    const crit = this.k.h.rng() * 100 < c.critChance();
    const amount = Math.round(restaHeal(c.stats().mst) * c.artRankPower('resta') * (x.has('greater') ? 1.4 : 1) * (crit ? formulas.critSupport : 1));
    const before = p.hp;
    p.hp = Math.min(p.maxHp, p.hp + amount);
    // Barrier: healing past full HP becomes a fading shield.
    if (c.hasPassive('barrier')) p.addShield(amount - (p.hp - before));
    // Purify: Resta also cures poison and Burn and clears a Corruption stack.
    if (c.hasPassive('purify')) {
      p.poison = 0;
      p.burnStacks = 0;
      if (p.corruption > 0) p.corruption--;
    }
    if (x.has('regen')) p.addRegen('hp', p.maxHp * 0.1, 5);
    if (x.has('anti')) {
      p.poison = 0;
      p.burnStacks = 0;
      if (p.paralysis > 0) p.cureParalysis();
    }
    if (x.has('desperate') && lowAtCast) this.k.refundTp(this.k.artCostPaid * 0.3, 'DESPERATE');
    if (x.has('swift')) p.swiftT = 4;
    this.supportGlow(0xd8ffe4, techniques.resta.color);
    this.k.h.float(tmp.copy(p.pos).setY(2.2), crit ? `+${amount}!` : `+${amount}`, crit ? 'heal crit' : 'heal');
    sfx('tech.resta');
    this.k.h.log(`${x.label}: healed <b>${amount}</b>${crit ? ' <span class="l-kill">CRIT</span>' : ''}`);
  }
}
