import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../audio', () => ({ sfx: () => {} }));

import { Character, makeItem } from './character';
import { uniqueCfg as U } from './config';
import { getDef } from './data/items';
import { uniqueItemId, uniqueUnitId, type UniqueId } from './data/uniques';
import { burnRules } from './enemies/Enemy';
import { itemSlot } from './itemTypes';
import { UniqueFx } from './combat/riftUniques';
import type { Combat } from './combat/Combat';
import type { Hittable } from './combat/types';

/** A Lv 100 hunter wearing these gear uniques and running these unique units. */
function setup(gear: UniqueId[] = [], units: UniqueId[] = []) {
  const ch = Character.create('t', 'hunter');
  ch.data.level = 100;
  const frame = makeItem('frame_guard_15');
  ch.data.inventory.push(frame);
  ch.data.equipped.frame = frame.uid;
  for (const id of gear) {
    const inst = makeItem(uniqueItemId(id, 15));
    ch.data.inventory.push(inst);
    ch.data.equipped[itemSlot(getDef(inst.id))!] = inst.uid;
  }
  for (const id of units) {
    ch.take(makeItem(uniqueUnitId(id)));
    ch.insertUnit(id);
  }
  const p = {
    pos: new THREE.Vector3(), radius: 0.45, hp: 1000, maxHp: 1000, tp: 100, maxTp: 100, dash: null,
    cooldowns: new Map<string, number>(),
    get alive() {
      return this.hp > 0;
    },
  };
  const hurt = { n: 0 };
  const k = {
    p, c: ch,
    h: { float: () => {}, log: () => {}, world: () => ({ boss: null }), onPlayerHurt: () => hurt.n++, onKill: () => {} },
    targets: () => [], nearestOthers: () => [], venomStacks: () => 0, debuff: () => ({ venomDps: 0 }), venom: () => {},
    ring: () => {}, arc: () => {}, later: () => {}, zone: () => {}, fx: () => {}, applyPlayerStatus: () => true, weaponHit: () => ({ dmg: 0, killed: false }),
    deal: () => false,
    refundTp(n: number) {
      p.tp = Math.min(p.maxTp, p.tp + n);
    },
  };
  const fx = new UniqueFx(k as unknown as Combat);
  return { ch, p, fx, hurt, k };
}

const enemy = (hp: number, maxHp = 1000): Hittable => ({ hp, maxHp, alive: hp > 0, arch: {}, pos: new THREE.Vector3() }) as unknown as Hittable;

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

  it("S-Beat's Blade: a perfect third-step Art is free and cuts the others' cooldowns; off the chain, double TP", () => {
    const { fx, p } = setup(['sBeatBlade']);
    expect(fx.costMult('risingEdge', 0)).toBe(U.sBeatTp);
    expect(fx.costMult('risingEdge', 2)).toBe(1);
    p.tp = 50;
    p.cooldowns.set('guardStance', 5);
    fx.started('risingEdge', 2, true, 20, 20);
    expect(p.tp).toBe(70);
    expect(p.cooldowns.get('guardStance')).toBe(5 - U.sBeatCd);
  });

  it('Dragon Fang: kills build Rampage (damage and Haste); a big hit breaks it', () => {
    const { fx, ch } = setup(['dragonFang']);
    for (let i = 0; i < 12; i++) fx.onKill(enemy(0));
    expect(fx.rampage).toBe(U.rampageMax);
    fx.tick(0.01);
    expect(ch.extraHaste).toBe(U.rampageMax * U.rampageHaste);
    expect(fx.dealtMult(enemy(500))).toBeCloseTo(1 + U.rampageDmg * U.rampageMax);
    fx.incoming(1000 * U.rampageBreak + 1, false);
    expect(fx.rampage).toBe(0);
    for (let i = 0; i < 3; i++) fx.onKill(enemy(0));
    fx.tick(U.rampageTime + 0.1);
    expect(fx.rampage).toBe(0);
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

  it('Storm Crest: walking builds Static, the next hit spends it (hits landing with it share it); a hit with none deals 25% less', () => {
    const { fx, p, k } = setup(['stormCrest']);
    const pp = p as typeof p & { moving: boolean };
    const a = enemy(1000);
    const b = enemy(1000);
    expect(fx.dealtMult(a)).toBeCloseTo(1 - U.crestDry, 6);
    // Knocked about (not walking or dashing): no Static.
    for (let i = 0; i < 30; i++) {
      p.pos.x += 0.1;
      fx.tick(1 / 60);
    }
    expect(fx.static).toBe(0);
    // Walk 12.5 m.
    pp.moving = true;
    for (let i = 0; i < 125; i++) {
      p.pos.x += 0.1;
      fx.tick(1 / 60);
    }
    expect(Math.floor(fx.static)).toBe(12);
    const m = 1 + U.crestPerPoint * 12;
    expect(fx.dealtMult(a)).toBeCloseTo(m, 6);
    expect(fx.dealtMult(b)).toBeCloseTo(m, 6);
    expect(fx.static).toBe(0);
    // 12 points: a bolt jumps on from the hit that spent them, for half of it.
    const dealt: [Hittable, number][] = [];
    const c = enemy(1000);
    k.nearestOthers = (() => [b, c]) as never;
    k.deal = ((t: Hittable, d: number) => (dealt.push([t, d]), false)) as never;
    fx.landed(a, 1000);
    expect(dealt).toEqual([[b, 1000 * U.crestJumpShare], [c, 1000 * U.crestJumpShare]]);
    fx.landed(a, 1000);
    expect(dealt).toHaveLength(2);
    // Next frame it is spent: a dry hit again. And it holds 40 at most.
    pp.moving = false;
    fx.tick(1 / 60);
    expect(fx.dealtMult(a)).toBeCloseTo(1 - U.crestDry, 6);
    pp.moving = true;
    for (let i = 0; i < 700; i++) {
      p.pos.x += 0.1;
      fx.tick(1 / 60);
    }
    expect(fx.static).toBe(U.crestMax);
    expect(setup().fx.dealtMult(a)).toBe(1);
  });

  it('Grounding Coil: hits on a boss or champion ground it (+50% for 5 s), others build nothing; they hit you 20% harder', () => {
    const { fx, k } = setup([], ['groundingCoil']);
    const boss = { alive: true };
    k.h.world = (() => ({ boss })) as never;
    const part = { hp: 1e6, maxHp: 1e6, alive: true, pos: new THREE.Vector3(), radius: 2, aimHeight: 3 } as unknown as Hittable;
    const champ = Object.assign(enemy(1000), { champion: true });
    const plain = enemy(1000);
    const hits = Math.ceil(1 / U.coilPerHit);
    for (let i = 0; i < hits - 1; i++) fx.landed(part, 100);
    expect(fx.dealtMult(part)).toBe(1);
    fx.landed(part, 100);
    expect(fx.dealtMult(part)).toBeCloseTo(1 + U.coilMult, 6);
    // Grounded, it builds no more; the window runs out.
    fx.tick(U.coilTime - 0.1);
    expect(fx.dealtMult(part)).toBeCloseTo(1 + U.coilMult, 6);
    fx.tick(0.2);
    expect(fx.dealtMult(part)).toBe(1);
    for (let i = 0; i < hits; i++) fx.landed(champ, 100);
    expect(fx.dealtMult(champ)).toBeCloseTo(1 + U.coilMult, 6);
    for (let i = 0; i < hits * 2; i++) fx.landed(plain, 100);
    expect(fx.dealtMult(plain)).toBe(1);
    expect(fx.coilTakenMult(true)).toBeCloseTo(1 + U.coilTaken, 6);
    expect(fx.coilTakenMult(false)).toBe(1);
    expect(setup().fx.coilTakenMult(true)).toBe(1);
  });
});
