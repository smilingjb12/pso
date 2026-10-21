import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../audio', () => ({ sfx: () => {} }));

import { Character, makeItem } from './character';
import { uniqueCfg as U } from './config';
import { getDef, itemDefs } from './data/items';
import { uniqueItemId, uniqueUnitId, type UniqueId } from './data/uniques';
import { burnRules } from './enemies/Enemy';
import { itemSlot } from './itemTypes';
import { UniqueFx } from './combat/riftUniques';
import { Combat, frozen, type CombatHooks } from './combat/Combat';
import type { Hittable, StatusEffect } from './combat/types';

/** A Lv 100 character wearing these gear uniques (or item ids) and running these unique units (a 4-slot frame). */
function character(gear: (UniqueId | string)[] = [], units: UniqueId[] = []): Character {
  const ch = Character.create('t');
  ch.data.level = 100;
  const frame = makeItem('frame_psy_15', { slots: 4 });
  ch.data.inventory.push(frame);
  ch.data.equipped.frame = frame.uid;
  for (const id of gear) {
    const inst = makeItem(itemDefs[id] ? id : uniqueItemId(id as UniqueId, 15));
    ch.data.inventory.push(inst);
    ch.data.equipped[itemSlot(getDef(inst.id))!] = inst.uid;
  }
  for (const id of units) {
    ch.take(makeItem(uniqueUnitId(id)));
    ch.insertUnit(id);
  }
  return ch;
}

/** The player's side of a fight, as Combat and UniqueFx read it. */
function player() {
  return {
    pos: new THREE.Vector3(), radius: 0.45, hp: 1000, maxHp: 1000, tp: 100, maxTp: 100, dash: null as object | null,
    buffs: { tech: { pct: 0, t: 0 }, def: { pct: 0, t: 0 } }, corruption: 0, clarity: 0,
    get alive() {
      return this.hp > 0;
    },
  };
}

/** UniqueFx on a stand-in Combat (only the hooks it calls). */
function setup(gear: (UniqueId | string)[] = [], units: UniqueId[] = []) {
  const ch = character(gear, units);
  const p = player();
  const hurt = { n: 0 };
  const burns = { n: 0 };
  const k = {
    p, c: ch,
    h: { float: () => {}, log: () => {}, world: () => ({ boss: null }), onPlayerHurt: () => hurt.n++, onKill: () => {} },
    targets: (): Hittable[] => [], nearestOthers: () => [], venomStacks: () => 0, debuff: () => ({ venomDps: 0 }), venom: () => {},
    ring: () => {}, arc: () => {}, later: () => {}, zone: () => {}, fx: () => {},
    applyPlayerStatus(kind: string) {
      if (kind === 'burn') burns.n++;
      return true;
    },
    boltHit: vi.fn(() => ({ dmg: 0, killed: false })),
    deal: () => false,
    refundTp(n: number) {
      p.tp = Math.min(p.maxTp, p.tp + n);
    },
  };
  const fx = new UniqueFx(k as unknown as Combat);
  return { ch, p, k, fx, hurt, burns };
}

const enemy = (hp: number, maxHp = 1000): Hittable => ({ hp, maxHp, alive: hp > 0, arch: {}, pos: new THREE.Vector3(), radius: 0.5 }) as unknown as Hittable;

describe('Rift Circle uniques in a fight', () => {
  it('Rol Carapace caps a hit at 35% of max HP, but not a failed boss mechanic', () => {
    const { fx } = setup(['rolCarapace']);
    expect(fx.incoming(900, false)).toBe(Math.round(1000 * U.carapaceCap));
    expect(fx.incoming(800, true)).toBe(800);
    expect(setup().fx.incoming(900, false)).toBe(900);
  });

  it('Tide Shell forms after 8 s without a hit and soaks one', () => {
    const { fx } = setup([], ['tideShell']);
    fx.tick(U.tideDelay - 1);
    expect(fx.tideReady).toBe(false);
    fx.tick(1.1);
    expect(fx.tideReady).toBe(true);
    expect(fx.incoming(600, false)).toBe(600 - 1000 * U.tideSoak);
    expect(fx.tideReady).toBe(false);
    expect(fx.incoming(100, false)).toBe(100);
  });

  it('DF Shield Dooms a killing blow; three kills raise you, else the Doom kills', () => {
    const a = setup(['dfShield']);
    a.p.hp = 200;
    expect(a.fx.lethal(500)).toBe(199);
    a.p.hp -= 199;
    expect(a.fx.doomT).toBeGreaterThan(0);
    // Nothing kills while Doomed.
    expect(a.fx.lethal(500)).toBe(0);
    for (let i = 0; i < U.dfKills; i++) a.fx.onKill(enemy(0));
    a.fx.tick(0.1);
    expect(a.fx.doomT).toBe(0);
    expect(a.p.hp).toBe(1000 * U.dfRise);
    // Once a room: the next lethal blow lands, until a room is cleared.
    expect(a.fx.lethal(5000)).toBe(5000);
    a.fx.roomCleared();
    expect(a.fx.lethal(5000)).toBeLessThan(a.p.hp);

    const b = setup(['dfShield']);
    b.p.hp = 50;
    b.p.hp -= b.fx.lethal(500);
    b.fx.tick(U.dfDoomTime + 0.1);
    expect(b.p.hp).toBe(0);
    expect(b.hurt.n).toBe(1);
  });

  it('Prophets of Motav: a second, different element completes a combo: ×2 and free', () => {
    const { fx } = setup(['motav']);
    expect(fx.costMult('foie', 0)).toBe(1);
    fx.started('foie', 0, false, 10, 10);
    expect(fx.takeCastMult()).toBe(1);
    expect(fx.costMult('barta', 1)).toBe(0);
    fx.started('barta', 1, false, 0, 0);
    expect(fx.takeCastMult()).toBe(U.motavMult);
    // The combo starts over; the same element twice hits less.
    expect(fx.costMult('zonde', 2)).toBe(1);
    fx.started('zonde', 2, false, 10, 10);
    fx.takeCastMult();
    fx.started('zonde', 0, false, 10, 10);
    expect(fx.takeCastMult()).toBe(U.motavSame);
  });

  it("S-Beat's Blade: a perfect chain's third-step technique is free; any other costs double", () => {
    const { fx, p } = setup(['sBeatBlade']);
    expect(fx.costMult('foie', 0)).toBe(U.sBeatTp);
    expect(fx.costMult('resta', 1)).toBe(U.sBeatTp);
    expect(fx.costMult('foie', 2)).toBe(1);
    p.tp = 50;
    fx.started('foie', 2, true, 20, 20);
    expect(p.tp).toBe(70);
    // The third step off a perfect chain: double after all.
    fx.started('foie', 2, false, 20, 20);
    expect(p.tp).toBe(50);
    expect(setup().fx.costMult('foie', 0)).toBe(1);
  });

  it('Dragon Fang: kills build Rampage (damage and Haste), free techniques at 10 stacks; a big hit breaks it', () => {
    const { fx, ch } = setup(['dragonFang']);
    for (let i = 0; i < U.rampageMax - 1; i++) fx.onKill(enemy(0));
    expect(fx.costMult('foie', 0)).toBe(1);
    for (let i = 0; i < 3; i++) fx.onKill(enemy(0));
    expect(fx.rampage).toBe(U.rampageMax);
    expect(fx.costMult('foie', 0)).toBe(0);
    expect(fx.costMult('resta', 1)).toBe(0);
    fx.tick(0.01);
    expect(ch.extraHaste).toBe(U.rampageMax * U.rampageHaste);
    expect(fx.dealtMult(enemy(500))).toBeCloseTo(1 + U.rampageDmg * U.rampageMax);
    fx.incoming(1000 * U.rampageBreak + 1, false);
    expect(fx.rampage).toBe(0);
    expect(fx.costMult('foie', 0)).toBe(1);
    for (let i = 0; i < 3; i++) fx.onKill(enemy(0));
    fx.tick(U.rampageTime + 0.1);
    expect(fx.rampage).toBe(0);
  });

  it('Flame Visit: Rafoie burns longer, and you burn in your own fire', () => {
    const { fx, burns } = setup(['flameVisit']);
    expect(fx.rafoieMult()).toBe(U.flameRafoieMult);
    expect(setup().fx.rafoieMult()).toBe(1);
    fx.selfBurn({ kind: 'circle', x: 0, z: 0, radius: 3 });
    expect(burns.n).toBe(1);
    fx.selfBurn({ kind: 'circle', x: 20, z: 0, radius: 3 });
    expect(burns.n).toBe(1);
  });

  it('Dragon Rush: a dash hits each enemy it passes through once, for a photon bolt', () => {
    const { fx, k, p } = setup([], ['dragonRush']);
    const e = { ...enemy(500), invulnerable: false } as Hittable;
    k.targets = () => [e];
    p.dash = {};
    fx.tick(0.01);
    fx.tick(0.01);
    expect(k.boltHit).toHaveBeenCalledTimes(1);
    expect(k.boltHit).toHaveBeenCalledWith(e, expect.objectContaining({ label: 'Dragon Rush', refill: false }));
    p.dash = {};
    fx.tick(0.01);
    expect(k.boltHit).toHaveBeenCalledTimes(2);
  });

  it('Proof of Sword-Saint and Devil/Battle on the damage you deal', () => {
    const saint = setup([], ['swordSaint']).fx;
    expect(saint.dealtMult(enemy(1000))).toBeCloseTo(1 + U.saintBonus);
    expect(saint.dealtMult(enemy(700))).toBe(1);
    expect(saint.dealtMult(enemy(300))).toBeCloseTo(1 - U.saintLow);
    const devil = setup([], ['devilBattle']);
    devil.p.hp = 450;
    expect(devil.fx.dealtMult(enemy(500))).toBeCloseTo(1 + 5 * U.devilPer10);
    devil.p.hp = 10;
    expect(devil.fx.dealtMult(enemy(500))).toBeCloseTo(1 + 9 * U.devilPer10);
  });

  it('Ember Core lets your Burns stack on enemies', () => {
    setup([], ['emberCore']).fx.tick(0.01);
    expect(burnRules.stackCap).toBe(1 + U.emberExtraStacks);
    setup().fx.tick(0.01);
    expect(burnRules.stackCap).toBe(1);
  });
});

/** A real Combat around a character wearing `gear`; `rng` decides crits (0.99: none). Floats are kept as "text|class". */
function fight(gear: (UniqueId | string)[], rng = () => 0.99) {
  const ch = character(gear);
  const p = player();
  const floats: string[] = [];
  const hooks = {
    world: () => ({ boss: null }), player: () => p, char: () => ch, camTarget: () => null, moveDir: () => new THREE.Vector3(),
    cameraYaw: () => 0, float: (_at: THREE.Vector3, text: string, cls: string) => floats.push(`${text}|${cls}`),
    log: () => {}, hitstop: () => {}, shake: () => {}, onKill: () => {}, onDamage: () => {}, onPlayerHurt: () => {}, onLastStand: () => {}, rng,
  };
  return { ch, p, floats, k: new Combat(hooks as unknown as CombatHooks) };
}

/** An enemy that keeps its statuses (freeze included) and never dies; `boss`: immune to crowd control, as bosses are. */
function dummy(boss = false): Hittable {
  const statuses = new Map<StatusEffect, number>();
  return {
    pos: new THREE.Vector3(0, 0, 4), radius: 0.5, alive: true, name: 'Dummy', hp: 1e9, maxHp: 1e9, armor: 0, techResist: 0,
    aimHeight: 1, invulnerable: false, ...(boss ? { ccResist: () => 100 } : { arch: {} }),
    damage(n: number) {
      this.hp -= n;
      return false;
    },
    applyStatus: (kind: StatusEffect, _power: number, seconds: number) => void statuses.set(kind, seconds),
    statusTimers: () => [...statuses].map(([kind, left]) => ({ kind, left, total: left })),
    thaw: () => void statuses.delete('freeze'),
    damageMult: () => 1,
  };
}

const cast = (tech: 'foie' | 'barta') => ({ tech, streak: 0, finisher: false, label: tech });
const bolt = { label: 'bolt', streak: 0, finisher: false };

describe('the caster uniques through Combat', () => {
  it('Frozen Shooter: ice techniques freeze, the next technique shatters ×2.5 (then no freeze for a while), anything else ×0.5', () => {
    const { k, ch, floats } = fight(['frozenShooter']);
    const t = dummy();
    const plain = k.techHit(t, cast('foie')).dmg;
    expect(frozen(t)).toBe(false);
    k.techHit(t, cast('barta'));
    expect(frozen(t)).toBe(true);
    const shatter = k.techHit(t, cast('foie')).dmg;
    expect(shatter / plain).toBeCloseTo(U.frozenShatterMult / U.frozenOtherMult, 2);
    expect(floats).toContain('SHATTER|proc');
    expect(frozen(t)).toBe(false);
    // Just shattered: it can't freeze again yet.
    k.techHit(t, cast('barta'));
    expect(frozen(t)).toBe(false);
    // Against a plain rod the unfrozen hit is about half (the unique's 2 grind levels add a little).
    const rod = fight(['rod_15']).k.techHit(dummy(), cast('foie')).dmg;
    expect(plain / rod).toBeGreaterThan(U.frozenOtherMult);
    expect(plain / rod).toBeLessThan(U.frozenOtherMult * 1.1);
    expect(ch.hasUnique('frozenShooter')).toBe(true);
  });

  it("Frozen Shooter: bolts take ×0.5 unless the enemy is frozen, and don't shatter it; bosses never freeze", () => {
    const { k } = fight(['frozenShooter']);
    const warm = dummy();
    const cold = dummy();
    k.techHit(cold, cast('barta'));
    const a = k.boltHit(warm, bolt).dmg;
    const b = k.boltHit(cold, bolt).dmg;
    expect(b / a).toBeCloseTo(1 / U.frozenOtherMult, 2);
    expect(frozen(cold)).toBe(true);
    const boss = dummy(true);
    k.techHit(boss, cast('barta'));
    expect(frozen(boss)).toBe(false);
  });

  it("Ophelie Seize: every photon bolt adds a venom stack with no cap, and bolts can't crit (techniques still do)", () => {
    const { k, floats } = fight(['ophelieSeize'], () => 0);
    const t = dummy();
    for (let i = 0; i < 12; i++) k.boltHit(t, bolt);
    expect(k.venomStacks(t)).toBe(12);
    expect(floats.some((f) => f.includes('crit'))).toBe(false);
    k.techHit(t, cast('foie'));
    expect(floats.at(-1)).toMatch(/crit/);
    expect(k.venomStacks(t)).toBe(12);
    // A plain wand's bolts crit on the same rolls and carry no venom.
    const wand = fight(['wand_15'], () => 0);
    const u = dummy();
    wand.k.boltHit(u, bolt);
    expect(wand.floats.at(-1)).toMatch(/crit/);
    expect(wand.k.venomStacks(u)).toBe(0);
  });

  it("prices techniques with the uniques: S-Beat's Blade double off the third step, a full Rampage free", () => {
    const beat = fight(['sBeatBlade']);
    expect(beat.k.artCost('foie', 0)).toBe(Math.round(beat.ch.artCost('foie') * U.sBeatTp));
    expect(beat.k.artCost('foie', 2)).toBe(beat.ch.artCost('foie'));
    const fang = fight(['dragonFang']);
    const cost = fang.ch.artCost('foie');
    expect(fang.k.artCost('foie', 0)).toBe(cost);
    for (let i = 0; i < U.rampageMax; i++) fang.k.ufx.onKill(dummy());
    expect(fang.k.artCost('foie', 0)).toBe(0);
  });
});
