import * as THREE from 'three';
import { sfx } from '../../audio';
import { yawTo } from '../collision';
import { formulas, passiveCfg as T, techScaling } from '../config';
import type { ArtId } from '../data/arts';
import { restaHeal, techniques, type TechId } from '../data/techniques';
import { cutMult } from '../formulas';
import type { TelegraphShape } from '../world/Telegraph';
import type { Projectile } from '../world/Projectile';
import { Burst, EMBERS, Fall, Field, fieldMark, FROST_GLITTER, GroundMark, IceSpikes, Puff, shapeArea, SNOW, StaticField, Trail } from '../world/spellFx';
import type { Combat, TechHit } from './Combat';
import { chestOf, frozen, isBossPart } from './Combat';
import type { Hittable } from './types';

// What every Art (technique) does (data/arts.ts has their numbers and words). Combat calls fire() when an Art's
// wind-up ends; everything here goes through Combat's helpers (techHit, debuffs, zones, timers, projectiles,
// visuals). The numbers in modifiers match their descriptions. The weapon Arts went with the classes on 2026-10-21.

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

  /** An area technique's target: the one it started on, or the enemy nearest the line it aimed along (the camera's). */
  private areaTarget(range: number): Hittable | null {
    const t = this.k.artTarget;
    if (t && t.alive && !t.invulnerable) return t;
    return this.k.areaTarget(range, this.k.artYaw);
  }

  /** Which way an area technique goes: at the target it started on, else the way it aimed (the camera's). */
  private areaYaw(): number {
    const t = this.k.artTarget;
    return t && t.alive && !t.invulnerable ? this.yawAt(t) : this.k.artYaw;
  }

  /** Yaw from her to a target (or her facing). */
  private yawAt(t: Hittable | null): number {
    const p = this.p;
    return t ? yawTo(p.pos.x, p.pos.z, t.pos.x, t.pos.z) : p.yaw;
  }

  /** A point `d` metres from her along `yaw` (her facing by default), or on the target. */
  private spot(t: Hittable | null, d: number, yaw = this.p.yaw): THREE.Vector3 {
    const p = this.p;
    return t ? t.pos.clone() : new THREE.Vector3(p.pos.x + Math.sin(yaw) * d, 0, p.pos.z + Math.cos(yaw) * d);
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
      // Flame Visit's cost: your own fire burns you too.
      this.k.ufx.selfBurn(shape);
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

  /** An Art's wind-up ended: its effect. */
  fire(id: ArtId, x: ArtCtx): void {
    const p = this.p;
    const c = this.c;
    switch (id) {
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
      }, { speed: x.has('swift') ? 32 : 16, range: techniques.foie.range, size: 0.22 * size, yaw: (target ? this.yawAt(target) : this.k.artYaw) + offset });
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
    const t = this.areaTarget(techniques.rafoie.range);
    const at = this.spot(t, this.k.artDist, this.k.artYaw);
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
        if (!x.echo) this.burnGround(shape, (x.has('scorched') ? 7 : 4) * this.k.ufx.rafoieMult(), this.techEstimate('rafoie', 0.15));
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
    const base = this.areaYaw();
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
    const t = this.areaTarget(techniques.razonde.range);
    const at = this.spot(t, this.k.artDist, this.k.artYaw);
    const r = x.has('wide') ? 7 : 5;
    const secs = x.has('long') ? 5 : 3;
    const strikes = x.has('long') ? 13 : 8;
    const shape: TelegraphShape = { kind: 'circle', x: at.x, z: at.z, radius: r };
    sfx('tech.zonde', { x: at.x, z: at.z });
    // Charged ground: a faint shadow, a thin crackling rim so the area reads, and current crawling over the floor
    // (2026-10-16, the user's ask: subtle and electric); each strike is its own thin bolt (no hitstop or white flash
    // on the struck, so eight in 3 s don't strobe) that spreads current out over the floor where it lands.
    const field = new StaticField(at.x, at.z, r, secs + 0.2, techniques.razonde.color);
    this.k.fx(field);
    // A storm rolls its stun once per enemy, on the first strike that reaches it (spent even if it's already
    // stunned), so stun resistance counts: rolled on every strike it stun-locked whatever the resistance (2026-10-16).
    const rolled = new Set<Hittable>();
    // Each enemy takes at most three of the eight strikes (five of Long's thirteen): a pack still takes the whole
    // storm, but a lone target (a boss) only its share. All eight on one did about 2.6× Zonde's damage a second
    // (2026-10-16, the user's call). A strike with nobody left to take it is lost, like one over empty ground.
    const perEnemy = x.has('long') ? 5 : 3;
    const struck = new Map<Hittable, number>();
    let left = strikes;
    this.k.zone(shape, secs + 0.05, secs / strikes, (inside) => {
      if (left-- <= 0) return true;
      const open = inside.filter((e) => (struck.get(e) ?? 0) < perEnemy);
      if (!open.length) return false;
      const pick = x.has('eye') && t && open.includes(t) && this.k.h.rng() < 0.6 ? t : open[Math.floor(this.k.h.rng() * open.length)];
      struck.set(pick, (struck.get(pick) ?? 0) + 1);
      this.k.flashBolt(pick.pos, techniques.razonde.color, 0.35, 9);
      field.strike(pick.pos.x, pick.pos.z);
      this.k.fx(new GroundMark({ kind: 'circle', x: pick.pos.x, z: pick.pos.z, radius: 0.8 }, { color: 0x1a1020, opacity: 0.35, look: 'scorch', fadeIn: 0.05, hold: 0.4, fadeOut: 0.8 }));
      sfx('tech.zonde', { x: pick.pos.x, z: pick.pos.z, vol: 0.6 });
      const stun = rolled.has(pick) ? 0 : x.has('paralyze') ? 2 : 1;
      rolled.add(pick);
      this.th(pick, x, { stun, stagger: x.has('conductor') ? 2 : 1, tick: true });
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

  private gibarta(x: ArtCtx, share: number, yaw = this.areaYaw()): void {
    const p = this.p;
    const shape: TelegraphShape = { kind: 'cone', x: p.pos.x, z: p.pos.z, yaw, range: x.has('long') ? 12 : 8, arcDeg: x.has('wide') ? 100 : 70 };
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
      if (x.has('double')) this.k.later(0.5, () => this.gibarta(x, 0.5, yaw));
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
    const amount = Math.round(restaHeal(c.stats().mst) * c.artRankPower('resta') * (x.has('greater') ? 1.4 : 1) * (crit ? formulas.critSupport : 1) * c.healMult());
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
