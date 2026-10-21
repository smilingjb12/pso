import * as THREE from 'three';
import { sfx } from '../../audio';
import { stagger, uniqueCfg as U } from '../config';
import { ARTS, isTechArt, type ArtId } from '../data/arts';
import { isAttackTech, techniques } from '../data/techniques';
import type { Enemy } from '../enemies/Enemy';
import { burnRules } from '../enemies/Enemy';
import { inShape, type TelegraphShape } from '../world/Telegraph';
import { GroundMark, fieldMark } from '../world/spellFx';
import type { ArtCtx } from './arts';
import type { Combat } from './Combat';
import { isBossPart } from './Combat';
import type { Hittable } from './types';

// The Rift Circle uniques' effects (data/uniques.ts, 2026-10-17; numbers in config uniqueCfg). Combat calls in at its
// hook points: every hit's damage, crits, kills, damage taken, a lethal blow, an Art's start and fire, and every
// frame. Unique units' numbers go through Character.uval (the Heart of Falz raises them).

const tmp = new THREE.Vector3();

type Element = 'fire' | 'lightning' | 'ice';

export class UniqueFx {
  constructor(private k: Combat) {}

  private get p() {
    return this.k.p;
  }
  private get c() {
    return this.k.c;
  }

  private float(text: string, cls: string, y = 2.6): void {
    this.k.h.float(tmp.copy(this.p.pos).setY(y), text, cls);
  }

  // ------------------------------------------------------------ state

  /** Dragon Fang: Rampage stacks, and seconds before they fall off. */
  rampage = 0;
  private rampageT = 0;
  /** Tide Shell: seconds since the last hit taken, and the shell is up. */
  private calmT = 0;
  tideReady = false;
  /** Yasakani Magatama: seconds since the last echo. */
  private yasakaniT = Infinity;
  /** Prophets of Motav: the element of the last attack cast in the combo (null: a fresh one). */
  private motavLast: Element | null = null;
  /** The damage multiplier the Art being started carries to its fire (Motav's combo, Dark Bridge's blood cast). */
  private castMult = 1;
  /** DF Shield: seconds of Doom left, and what has been done in it; whether it can catch a blow; the boss HP mark it last recharged at. */
  doomT = 0;
  private doomKills = 0;
  private doomBoss = 0;
  private dfReady = true;
  private bossMark = 1;
  /** Dragon Rush: the dash it is counting, and who it has hit in it. */
  private rushDash: object | null = null;
  private rushHit = new Set<Hittable>();
  /** HP/Drain: healing below 1 HP, carried over. */
  private drainAcc = 0;
  /** Storm Crest: Static built by moving, where the player stood last frame, and the frame whose hits share the Static spent. */
  static = 0;
  private lastX = NaN;
  private lastZ = 0;
  private frame = 0;
  private crestFrame = -1;
  private crestMult = 1;
  /** The hit that spent enough Static for a bolt (it jumps once that hit has landed). */
  private crestBolt: Hittable | null = null;
  /** Grounding Coil: Ground built (0..1) and seconds grounded, per boss (all its parts) or champion. */
  private grounds = new Map<object, { g: number; t: number }>();

  /** Back to nothing (a new area, Pioneer 2). */
  reset(): void {
    this.rampage = 0;
    this.rampageT = 0;
    this.calmT = 0;
    this.tideReady = false;
    this.motavLast = null;
    this.castMult = 1;
    this.doomT = 0;
    this.dfReady = true;
    this.bossMark = 1;
    this.c.extraHaste = 0;
    this.static = 0;
    this.lastX = NaN;
    this.crestBolt = null;
    this.grounds.clear();
  }

  // ------------------------------------------------------------ every frame

  tick(dt: number): void {
    const p = this.p;
    const c = this.c;
    this.frame++;
    // Storm Crest: your own walking and dashing build Static (a teleport's jump, knockback and pulls don't).
    if (c.hasUnique('stormCrest') && p.alive) {
      const moved = Number.isNaN(this.lastX) ? 0 : Math.hypot(p.pos.x - this.lastX, p.pos.z - this.lastZ);
      if ((p.moving || p.dash) && moved < 2) this.static = Math.min(U.crestMax, this.static + moved * U.crestPerM);
    } else this.static = 0;
    this.lastX = p.pos.x;
    this.lastZ = p.pos.z;
    // Grounding Coil: a grounded target's window runs out.
    for (const [k, g] of this.grounds) {
      if (g.t > 0) g.t = Math.max(0, g.t - dt);
      if (!(k as { alive?: boolean }).alive) this.grounds.delete(k);
    }
    // Rampage falls off a while after the last kill.
    if (this.rampage > 0) {
      this.rampageT -= dt;
      if (this.rampageT <= 0 || !c.hasUnique('dragonFang')) this.endRampage(false);
    }
    c.extraHaste = this.rampage * U.rampageHaste;
    // Tide Shell forms after a while without being hit.
    if (c.hasUnique('tideShell') && p.alive) {
      this.calmT += dt;
      if (!this.tideReady && this.calmT >= U.tideDelay) {
        this.tideReady = true;
        this.float('TIDE SHELL', 'heal');
        sfx('tech.buff', { pitch: 1.3 });
      }
    } else this.tideReady = false;
    this.yasakaniT += dt;
    // Ember Core: your Burns stack on enemies.
    burnRules.stackCap = c.hasUnique('emberCore') ? 1 + Math.round(c.uval(U.emberExtraStacks)) : 1;
    // DF Shield: Doom runs out, or what you did in it raises you.
    if (this.doomT > 0) {
      this.doomT -= dt;
      const boss = this.k.h.world().boss;
      const risen = this.doomKills >= U.dfKills || (!!boss && this.doomBoss >= boss.maxHp * U.dfBossShare);
      if (risen) this.rise();
      else if (this.doomT <= 0 || !p.alive) this.doomEnds();
    }
    // DF Shield recharges with every quarter of a boss's HP gone.
    const boss = this.k.h.world().boss;
    if (boss && boss.alive && boss.maxHp > 0) {
      const frac = boss.hp / boss.maxHp;
      if (frac <= this.bossMark - 0.25) {
        this.bossMark = Math.ceil(frac * 4) / 4;
        this.dfReady = true;
      }
    } else this.bossMark = 1;
    // Dragon Rush: a dash hits everything it passes through, once each.
    if (p.dash && c.hasUnique('dragonRush')) {
      if (this.rushDash !== p.dash) {
        this.rushDash = p.dash;
        this.rushHit.clear();
      }
      for (const t of this.k.targets()) {
        if (this.rushHit.has(t) || t.invulnerable) continue;
        if (Math.hypot(t.pos.x - p.pos.x, t.pos.z - p.pos.z) - t.radius - p.radius > U.rushRange * 0.5) continue;
        this.rushHit.add(t);
        this.k.weaponHit(t, { power: c.uval(U.rushPower), label: 'Dragon Rush', streak: 0, finisher: false, art: null, strong: true, stagger: 2 });
      }
    }
  }

  // ------------------------------------------------------------ dealing damage

  /** What the player's hits deal on top right now: Rampage, Devil/Battle, Proof of Sword-Saint, Storm Crest, Grounding Coil. */
  dealtMult(t: Hittable): number {
    const c = this.c;
    const p = this.p;
    let m = 1;
    if (c.hasUnique('stormCrest')) m *= this.crest(t);
    if (c.hasUnique('groundingCoil') && (this.grounds.get(this.groundKey(t) ?? {})?.t ?? 0) > 0) m *= 1 + c.uval(U.coilMult);
    if (this.rampage > 0) m *= 1 + U.rampageDmg * this.rampage;
    if (c.hasUnique('devilBattle')) m *= 1 + c.uval(U.devilPer10) * Math.min(9, Math.floor((1 - p.hp / Math.max(1, p.maxHp)) * 10));
    if (c.hasUnique('swordSaint')) {
      if (t.hp >= t.maxHp) m *= 1 + c.uval(U.saintBonus);
      else if (t.hp < t.maxHp * 0.5) m *= Math.max(0, 1 - c.uval(U.saintLow));
    }
    return m;
  }

  /**
   * Storm Crest: the first hit of a frame spends the Static (whole points) for +4% a point, and every other hit landing
   * with it shares that; from `crestBoltAt` points it also sends a bolt on (see `landed`). A hit with none: −25%.
   */
  private crest(t: Hittable): number {
    if (this.crestFrame === this.frame) return this.crestMult;
    const points = Math.floor(this.static);
    if (points < 1) return 1 - U.crestDry;
    this.static = 0;
    this.crestFrame = this.frame;
    this.crestMult = 1 + U.crestPerPoint * points;
    this.crestBolt = points >= U.crestBoltAt ? t : null;
    this.k.h.float(tmp.copy(t.pos).setY(t.aimHeight + 1.3), `STATIC ×${this.crestMult.toFixed(1)}`, 'proc');
    return this.crestMult;
  }

  /** What Grounding Coil grounds a hit target as: its boss (every part shares one), or a champion (others: nothing). */
  private groundKey(t: Hittable): object | null {
    if (isBossPart(t)) return this.k.h.world().boss ?? null;
    return (t as Enemy).champion ? t : null;
  }

  /**
   * A hit landed for `dmg` (killing or not): Storm Crest's bolt jumps on from the hit that spent a full charge, and
   * Grounding Coil builds Ground on a boss or champion (at 100% it is grounded for a while, then it builds again).
   */
  landed(t: Hittable, dmg: number): void {
    const c = this.c;
    if (this.crestBolt === t) {
      this.crestBolt = null;
      const share = Math.max(1, Math.round(dmg * U.crestJumpShare));
      let from = tmp.copy(t.pos).setY(1.2);
      for (const o of this.k.nearestOthers(t.pos, [t], U.crestJumps, U.crestRange)) {
        const to = o.pos.clone().setY(1.2);
        this.k.arc(from, to, 0x9ae8ff, 1.2);
        const killed = this.k.deal(o, share, t.pos.x, t.pos.z, 0, stagger.light);
        this.k.h.float(tmp.copy(o.pos).setY(o.aimHeight + 0.6), String(share), 'dmg tech');
        if (killed) this.k.h.onKill(o);
        from = to;
      }
      sfx('tech.zonde', { x: t.pos.x, z: t.pos.z });
    }
    if (!c.hasUnique('groundingCoil') || dmg <= 0) return;
    const key = this.groundKey(t);
    if (!key) return;
    const g = this.grounds.get(key) ?? { g: 0, t: 0 };
    this.grounds.set(key, g);
    if (g.t > 0) return;
    g.g += c.uval(U.coilPerHit);
    if (g.g < 1 - 1e-9) return;
    g.g = 0;
    g.t = U.coilTime;
    this.k.h.float(tmp.copy(t.pos).setY(t.aimHeight + 1.3), 'GROUNDED', 'proc');
    this.k.ring(t.pos.x, t.pos.z, 0x9ae8ff, Math.max(2, t.radius * 1.6), 0.45);
    sfx('tech.zonde', { x: t.pos.x, z: t.pos.z, pitch: 0.7 });
  }

  /** Grounding Coil's Ground on what this hits (0..1) and seconds grounded, for the HUD. */
  groundOf(t: Hittable): { g: number; t: number } | null {
    const key = this.groundKey(t);
    return key ? this.grounds.get(key) ?? { g: 0, t: 0 } : null;
  }

  /** Grounding Coil's cost: what a boss or champion's hits on you are multiplied by. */
  coilTakenMult(fromBossOrChampion: boolean): number {
    return fromBossOrChampion && this.c.hasUnique('groundingCoil') ? 1 + this.c.uval(U.coilTaken) : 1;
  }

  /** Can this hit crit? (Ophelie Seize's handgun hits can't.) */
  canCrit(handgun: boolean): boolean {
    return !(handgun && this.c.hasUnique('ophelieSeize'));
  }

  /** A hit landed: Venom Sac's crit poison, Ophelie Seize's venom. */
  afterHit(t: Hittable, dmg: number, crit: boolean, handgun: boolean): void {
    if (!t.alive || dmg <= 0) return;
    const c = this.c;
    if (crit && c.hasUnique('venomSac')) this.k.venom(t, dmg * c.uval(U.venomSacShare), U.venomSacTime, U.venomSacMax);
    if (handgun && c.hasUnique('ophelieSeize')) this.k.venom(t, dmg * U.ophelieShare, U.ophelieTime, Infinity);
  }

  /** The player took `dealt` HP off a target: HP/Drain heals, a Doomed DF Shield counts boss damage. */
  onDealt(t: Hittable, dealt: number): void {
    const c = this.c;
    const p = this.p;
    if (this.doomT > 0 && isBossPart(t)) this.doomBoss += dealt;
    if (!c.hasUnique('hpDrain') || !p.alive || this.doomT > 0) return;
    this.drainAcc += dealt * c.uval(U.drainShare) * c.healMult();
    const heal = Math.floor(this.drainAcc);
    if (heal < 1) return;
    this.drainAcc -= heal;
    p.hp = Math.min(p.maxHp, p.hp + heal);
  }

  /** A target the player hurt just died. */
  onKill(t: Hittable): void {
    const c = this.c;
    const boss = isBossPart(t);
    if (this.doomT > 0 && !boss) this.doomKills++;
    if (boss) return;
    if (c.hasUnique('dragonFang')) {
      const before = this.rampage;
      this.rampage = Math.min(U.rampageMax, this.rampage + 1);
      this.rampageT = U.rampageTime;
      if (this.rampage === U.rampageMax && before < U.rampageMax) {
        this.float('RAMPAGE', 'proc');
        sfx('tech.buff', { pitch: 0.8 });
      }
    }
    const e = t as Enemy;
    if (c.hasUnique('soulEater')) this.soulEater(e);
    if (c.hasUnique('flameVisit') && e.burnT > 0 && e.burnDps > 0) this.firePool(e.pos.x, e.pos.z, e.burnDps * U.flamePoolShare);
    const stacks = this.k.venomStacks(t);
    const dps = this.k.debuff(t).venomDps;
    if (c.hasUnique('plagueMantle') && (stacks > 0 || e.poisonT > 0)) {
      const near = this.k.targets().filter((o) => o !== t && o.alive && Math.hypot(o.pos.x - t.pos.x, o.pos.z - t.pos.z) - o.radius <= U.plagueRadius);
      for (const o of near) {
        for (let i = 0; i < stacks; i++) this.k.venom(o, dps, 6, Math.max(8, stacks));
        if (e.poisonT > 0) o.applyStatus('poison', e.poisonDps / Math.max(1, e.maxHp), e.poisonT);
      }
      this.k.ring(t.pos.x, t.pos.z, 0x70e060, U.plagueRadius, 0.4);
    }
    if (c.hasUnique('ophelieSeize') && stacks > 0) {
      const [o] = this.k.nearestOthers(t.pos, [t], 1, U.ophelieJump);
      if (o) {
        for (let i = 0; i < stacks; i++) this.k.venom(o, dps, U.ophelieTime, Infinity);
        this.k.arc(tmp.copy(t.pos).setY(1), o.pos.clone().setY(1), 0x70e060, 0.6);
      }
    }
  }

  /** Soul Eater: the nearest enemy is Doomed, and takes a share of the dead one's max HP a moment later. */
  private soulEater(dead: Hittable): void {
    const [next] = this.k.nearestOthers(dead.pos, [dead], 1, U.soulRange);
    if (!next) return;
    const dmg = Math.max(1, Math.round(dead.maxHp * this.c.uval(U.soulShare)));
    this.k.h.float(tmp.copy(next.pos).setY(next.aimHeight + 1.2), 'DOOM', 'corrupt');
    this.k.arc(tmp.copy(dead.pos).setY(1.2), next.pos.clone().setY(1.2), 0x9040ff, 0.8);
    this.k.later(U.soulDelay, () => {
      if (!next.alive || next.invulnerable) return;
      this.k.ring(next.pos.x, next.pos.z, 0x9040ff, 1.6, 0.35);
      sfx('status.corrupt', { x: next.pos.x, z: next.pos.z });
      const killed = this.k.deal(next, dmg, next.pos.x, next.pos.z, 0, stagger.light);
      this.k.h.float(tmp.copy(next.pos).setY(next.aimHeight + 0.6), String(dmg), 'dmg corrupt');
      if (killed) this.k.h.onKill(next);
    });
  }

  /** Flame Visit: a burning death leaves a fire pool that burns whatever walks in (and you, its cost). */
  private firePool(x: number, z: number, dps: number): void {
    const shape: TelegraphShape = { kind: 'circle', x, z, radius: U.flamePoolRadius };
    this.k.zone(shape, U.flamePoolTime, 0.5, (inside) => {
      for (const e of inside) e.applyStatus('burn', dps, 1.5);
      this.selfBurn(shape);
    });
    this.k.fx(new GroundMark(shape, fieldMark(U.flamePoolTime, { color: 0xff6a20, opacity: 0.22, look: 'soft', glow: true })));
  }

  /** Flame Visit's cost: standing in your own fire burns you. */
  selfBurn(shape: TelegraphShape): void {
    const p = this.p;
    if (!this.c.hasUnique('flameVisit') || !p.alive || !inShape(shape, p.pos.x, p.pos.z, p.radius)) return;
    this.k.applyPlayerStatus('burn', 1);
  }

  /** Flame Visit: how much longer your Napalm Shell's fire lasts. */
  napalmMult(): number {
    return this.c.hasUnique('flameVisit') ? U.flameNapalmMult : 1;
  }

  // ------------------------------------------------------------ taking damage

  /**
   * A hit is about to land (after damage taken cuts): Tide Shell soaks it, Rol Carapace caps it (not a failed boss
   * mechanic's), and a big one ends Rampage.
   */
  incoming(dmg: number, mechanic: boolean): number {
    const p = this.p;
    const c = this.c;
    this.calmT = 0;
    if (this.tideReady && dmg > 0) {
      const soak = Math.min(dmg, Math.round(p.maxHp * c.uval(U.tideSoak)));
      dmg -= soak;
      this.tideReady = false;
      this.float(`SHELL −${soak}`, 'heal');
    }
    if (!mechanic && c.hasUnique('rolCarapace')) dmg = Math.min(dmg, Math.round(p.maxHp * U.carapaceCap));
    if (this.rampage > 0 && dmg >= p.maxHp * U.rampageBreak) this.endRampage(true);
    return dmg;
  }

  /** A blow (or tick) that would knock the player out: DF Shield Dooms instead; while Doomed nothing kills. */
  lethal(dmg: number): number {
    const p = this.p;
    if (dmg < p.hp) return dmg;
    if (this.doomT > 0) return Math.max(0, p.hp - 1);
    if (!this.dfReady || !this.c.hasUnique('dfShield') || p.hp <= 0) return dmg;
    this.dfReady = false;
    this.doomT = U.dfDoomTime;
    this.doomKills = 0;
    this.doomBoss = 0;
    this.float(`DOOMED · kill ${U.dfKills}`, 'corrupt', 2.9);
    sfx('status.corrupt', { pitch: 0.6 });
    this.k.h.log(`<span class="l-bad">DF Shield: you are Doomed. Kill ${U.dfKills} enemies (or hurt the boss) in ${U.dfDoomTime} s to rise</span>`);
    return Math.max(0, p.hp - 1);
  }

  private rise(): void {
    const p = this.p;
    this.doomT = 0;
    p.hp = Math.max(p.hp, Math.round(p.maxHp * U.dfRise));
    this.float('RISEN', 'heal', 2.9);
    sfx('tech.buff', { pitch: 0.7 });
  }

  private doomEnds(): void {
    const p = this.p;
    this.doomT = 0;
    if (!p.alive) return;
    p.hp = 0;
    this.k.h.log('<span class="l-bad">The Doom takes you</span>');
    this.k.h.onPlayerHurt();
  }

  /** A room was cleared: DF Shield can catch a blow again. */
  roomCleared(): void {
    this.dfReady = true;
  }

  private endRampage(broken: boolean): void {
    if (broken && this.rampage > 0) this.float('RAMPAGE BROKEN', 'early');
    this.rampage = 0;
    this.rampageT = 0;
    this.c.extraHaste = 0;
  }

  // ------------------------------------------------------------ Arts

  /** TP multiplier on an Art about to start (S-Beat's Blade off a perfect chain, Motav's combo). */
  costMult(id: ArtId, hitIndex: number): number {
    const c = this.c;
    let m = 1;
    // S-Beat's Blade: the third step may be the free perfect one; anything else costs double.
    if (c.hasUnique('sBeatBlade') && !isTechArt(id) && hitIndex !== 2) m *= U.sBeatTp;
    if (c.hasUnique('motav') && isTechArt(id) && isAttackTech(id)) {
      const el = techniques[id].element as Element | null;
      if (el && this.motavLast && el !== this.motavLast) m = 0;
    }
    return m;
  }

  /** Can this technique be paid with HP (Dark Bridge), and what would it take? */
  bloodCost(id: ArtId, tpShort: number): number | null {
    if (tpShort <= 0 || !isTechArt(id) || !isAttackTech(id) || !this.c.hasUnique('darkBridge')) return null;
    const hp = Math.ceil(tpShort * U.bridgeHpPerTp);
    return hp < this.p.hp ? hp : null;
  }

  /**
   * An Art started, its TP paid (`paid` of `cost`; the rest from HP for Dark Bridge). S-Beat's Blade's perfect third
   * step refunds and cuts cooldowns; Motav moves its combo on; a Rampage at 10 clears Leap and Shadow Step.
   */
  started(id: ArtId, hitIndex: number, perfect: boolean, cost: number, paid: number): void {
    const c = this.c;
    const p = this.p;
    this.castMult = 1;
    if (paid < cost) {
      const hp = this.bloodCost(id, cost - paid);
      if (hp !== null) {
        p.hp -= hp;
        this.castMult *= U.bridgeMult;
        this.k.h.float(tmp.copy(p.pos).setY(2.2), `−${hp}`, 'hurt');
      }
    }
    if (c.hasUnique('sBeatBlade') && !isTechArt(id) && hitIndex === 2) {
      if (perfect) {
        this.k.refundTp(paid, 'S-BEAT');
        for (const [other, t] of p.cooldowns) if (other !== id) p.cooldowns.set(other, Math.max(0, t - U.sBeatCd));
      } else {
        // The third step without the perfect chain: double, if there's TP for it.
        const extra = Math.min(p.tp, paid * (U.sBeatTp - 1));
        p.tp -= extra;
      }
    }
    if (c.hasUnique('motav') && isTechArt(id) && isAttackTech(id)) {
      const el = techniques[id].element as Element | null;
      if (el) {
        if (this.motavLast && el !== this.motavLast) {
          this.castMult *= U.motavMult;
          this.motavLast = null;
          this.float('COMBO', 'proc');
        } else {
          if (this.motavLast === el) this.castMult *= U.motavSame;
          this.motavLast = el;
        }
      }
    }
    if (this.rampage >= U.rampageMax && (id === 'leap' || id === 'shadowStep')) p.cooldowns.delete(id);
  }

  /** The Art being fired takes the multiplier its start set (once). */
  takeCastMult(): number {
    const m = this.castMult;
    this.castMult = 1;
    return m;
  }

  /** An Art fired (not an echo): Yasakani Magatama plays it again a moment later, free, every so often. */
  fired(id: ArtId, ctx: ArtCtx, replay: (ctx: ArtCtx) => void): void {
    const c = this.c;
    if (ctx.echo || !c.hasUnique('yasakani') || this.yasakaniT < U.yasakaniEvery) return;
    const role = ARTS[id].role;
    if (role === 'mobility' || role === 'defence' || role === 'support') return;
    this.yasakaniT = 0;
    this.float('ECHO', 'proc');
    this.k.later(U.yasakaniDelay, () => replay({ ...ctx, mult: ctx.mult * c.uval(U.yasakaniShare), echo: true }));
  }
}
