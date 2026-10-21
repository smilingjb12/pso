import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { galGryphon as cfg, player } from './config';
import type { BossContext } from './enemies/Boss';
import { GalGryphon } from './enemies/GalGryphon';
import { boltSchedule, rodAt, rodSpots, rodUsable, rodWalk, stormLead, type RodState } from './enemies/gryphonStorm';
import { riftBossScale } from './rifts';
import { inShape, type TelegraphShape } from './world/Telegraph';
import { mulberry32 } from './world/Level';

// Gal Gryphon, the Rift Map's Circle II pinnacle (DESIGN.md "Gal Gryphon"): its storm's rules, the reach and dash-check
// geometry its numbers promise, and a scripted fight against the boss itself.

const CX = 17;
const CZ = 17;
const ROOM = { minX: 0, maxX: 34, minZ: 0, maxZ: 34 };
const TEMPO = 1.15;
/** Walking a warning of `real` seconds covers this much, after the usual 0.35 s reaction. */
const walk = (real: number) => player.moveSpeed * (real - 0.35);
const DASH = 2.5;

const rods = (storm = 1, fired: number[] = []): RodState[] =>
  rodSpots(CX, CZ).map(([x, z], i) => ({ x, z, charge: 0, firedIn: fired.includes(i) ? storm - 1 : -10 }));

/** Points on the summit, every half metre. */
function summit(): [number, number][] {
  const out: [number, number][] = [];
  const R = cfg.arenaRadius - player.radius;
  for (let x = -R; x <= R; x += 0.5) for (let z = -R; z <= R; z += 0.5) if (Math.hypot(x, z) <= R) out.push([CX + x, CZ + z]);
  return out;
}

describe('Gal Gryphon: the storm', () => {
  it('rings the summit with six rods 11 m out, 60° apart, the first 30° east of north', () => {
    const spots = rodSpots(CX, CZ);
    expect(spots).toHaveLength(6);
    for (const [x, z] of spots) expect(Math.hypot(x - CX, z - CZ)).toBeCloseTo(cfg.rodRing, 6);
    expect(spots[0][0]).toBeGreaterThan(CX);
    expect(spots[0][1]).toBeLessThan(CZ);
    expect(Math.atan2(spots[0][0] - CX, -(spots[0][1] - CZ)) * (180 / Math.PI)).toBeCloseTo(30, 6);
    // No two reaches touch: a bolt has one rod to bend into.
    for (let i = 0; i < 6; i++) {
      const [ax, az] = spots[i];
      const [bx, bz] = spots[(i + 1) % 6];
      expect(Math.hypot(ax - bx, az - bz)).toBeGreaterThan(cfg.rodReach * 2);
    }
  });

  it('leaves every spot on the summit a walk from a reach in the lead, with all rods up', () => {
    const lead = stormLead(TEMPO) / TEMPO;
    expect(lead).toBeCloseTo(Math.max(cfg.stormLead / TEMPO, cfg.stormLeadFloor), 6);
    const all = rods();
    let worst = 0;
    for (const [x, z] of summit()) worst = Math.max(worst, rodWalk(all, x, z, 1));
    // The worst is the middle: 11 - 3.5 = 7.5 m.
    expect(rodWalk(all, CX, CZ, 1)).toBeCloseTo(cfg.rodRing - cfg.rodReach, 6);
    expect(worst).toBeLessThanOrEqual(cfg.rodRing - cfg.rodReach + 1e-9);
    expect(cfg.rodRing - cfg.rodReach).toBeLessThanOrEqual(walk(lead));
  });

  it("sits a rod out for the storm after it fired, and the storm waits while you're out of reach of the rest", () => {
    const r: RodState = { x: 0, z: 0, charge: 0, firedIn: 2 };
    expect(rodUsable(r, 2)).toBe(false);
    expect(rodUsable(r, 3)).toBe(false);
    expect(rodUsable(r, 4)).toBe(true);
    // Standing at the foot of a scorched rod draws nothing.
    const list = rods(3, [0]);
    expect(rodAt(list, list[0].x, list[0].z, 3)).toBeNull();
    expect(rodAt(list, list[1].x + 1, list[1].z, 3)).toBe(list[1]);
    // On the rim behind the scorched rod the next reach is too far to walk in the lead (the boss then waits).
    const [x, z] = [CX + Math.sin(Math.PI / 6) * 15.5, CZ - Math.cos(Math.PI / 6) * 15.5];
    expect(rodWalk(list, x, z, 3)).toBeGreaterThan(walk(stormLead(TEMPO) / TEMPO));
  });

  it('marks each bolt on you a second before it falls, one at a time, and three missed bolts cost about the usual 80%', () => {
    for (const n of [cfg.bolts, cfg.bolts2]) {
      const s = boltSchedule(n, stormLead(TEMPO));
      expect(s).toHaveLength(n);
      for (let i = 0; i < n; i++) {
        expect(s[i].fall - s[i].mark).toBeCloseTo(cfg.boltWarn, 6);
        if (i) expect(s[i].mark).toBeGreaterThanOrEqual(s[i - 1].fall);
      }
    }
    expect(cfg.bolts * cfg.boltShare).toBeGreaterThan(0.78);
    expect(cfg.bolts * cfg.boltShare).toBeLessThan(0.84);
    // One storm's bolts fill a rod; phase 2's has one to spare.
    expect(cfg.bolts).toBe(cfg.rodCharge);
    expect(cfg.bolts2).toBe(cfg.rodCharge + 1);
  });
});

describe('Gal Gryphon: its attacks at a rift tempo', () => {
  const real = (t: number) => t / TEMPO;
  const pr = player.radius;

  it('keeps the swoop, the gale and the orbs walkable', () => {
    expect(cfg.swoopWidth / 2 + pr).toBeLessThanOrEqual(walk(real(cfg.swoopWindup)));
    expect(cfg.orbRadius + pr).toBeLessThanOrEqual(walk(real(cfg.orbWindup)));
    // The gale's cone: from any point inside it, out past an edge or past its reach.
    const half = (cfg.galeArcDeg / 2) * (Math.PI / 180);
    let worst = 0;
    for (let d = 0.2; d < cfg.galeRange; d += 0.1) {
      for (let a = -half; a <= half; a += half / 10) {
        const toEdge = d * Math.sin(half - Math.abs(a));
        const out = cfg.galeRange - d;
        worst = Math.max(worst, Math.min(toEdge, out) + pr);
      }
    }
    expect(worst).toBeLessThanOrEqual(walk(real(cfg.galeWindup)));
  });

  it('makes the plummet and the crossing lash dash checks: too far to walk, walk and a dash clears them', () => {
    const plummet = cfg.plummetRadius + pr;
    expect(plummet).toBeGreaterThan(walk(real(cfg.plummetWindup)));
    expect(plummet).toBeLessThanOrEqual(walk(real(cfg.plummetWindup)) + DASH);
    const lash = cfg.swoopWidth / 2 + pr;
    expect(lash).toBeGreaterThan(walk(real(cfg.crossWindup)));
    expect(lash).toBeLessThanOrEqual(walk(real(cfg.crossWindup)) + DASH);
  });

  it('enraged (×0.8 windups, the plummet never cut) leaves every attack clearable with a dash', () => {
    const e = cfg.enrageSpeed;
    const gale = cfg.galeRange * Math.sin(((cfg.galeArcDeg / 2) * Math.PI) / 180);
    for (const [need, windup] of [
      [cfg.swoopWidth / 2 + pr, cfg.swoopWindup * e],
      [Math.min(gale, cfg.galeRange / 2) + pr, cfg.galeWindup * e],
      [cfg.orbRadius + pr, cfg.orbWindup * e],
      [cfg.swoopWidth / 2 + pr, cfg.crossWindup * e],
      [cfg.plummetRadius + pr, cfg.plummetWindup],
    ]) expect(need, `${need} in ${windup}`).toBeLessThanOrEqual(walk(real(windup)) + DASH);
  });
});

// ------------------------------------------------------------------ a scripted fight

interface Fake {
  ctx: BossContext;
  body: { pos: THREE.Vector3; alive: boolean; radius: number };
  mechanic: number[];
  hits: TelegraphShape[];
  step(sec: number, each?: () => void): void;
}

function fakeFight(boss: GalGryphon): Fake {
  const body = { pos: new THREE.Vector3(CX, 0, CZ + 14), alive: true, radius: player.radius };
  const teles: { t: number; dur: number; onFire: () => void; done: boolean; cancel(): void }[] = [];
  const mechanic: number[] = [];
  const hits: TelegraphShape[] = [];
  const ctx: BossContext = {
    playerX: body.pos.x,
    playerZ: body.pos.z,
    playerAlive: true,
    rng: mulberry32(9),
    telegraph: (_shape, dur, onFire) => {
      const h = { t: 0, dur, onFire, done: false, cancel() { this.done = true; } };
      teles.push(h);
      return h;
    },
    hitPlayer: (shape) => {
      if (inShape(shape, body.pos.x, body.pos.z, body.radius)) hits.push(shape);
      return false;
    },
    tickPlayer: () => {},
    puddle: () => {},
    hazardHit: () => {},
    burnPlayer: () => {},
    paralyse: () => {},
    corruptPlayer: () => {},
    mechanicHit: (share) => {
      mechanic.push(share);
      return true;
    },
    lightAt: () => false,
    body: () => body as never,
    spawnAdd: () => { throw new Error('no adds'); },
    effect: () => {},
    shake: () => {},
    announce: () => {},
    escalate: () => {},
    isSolid: () => false,
  };
  const step = (sec: number, each?: () => void) => {
    for (let i = 0; i < Math.round(sec * 60); i++) {
      each?.();
      ctx.playerX = body.pos.x;
      ctx.playerZ = body.pos.z;
      boss.update(1 / 60, ctx);
      for (const t of teles) {
        if (t.done) continue;
        t.t += (1 / 60) * boss.tempo;
        if (t.t >= t.dur) {
          t.done = true;
          t.onFire();
        }
      }
    }
  };
  return { ctx, body, mechanic, hits, step };
}

const gryphon = () => new GalGryphon(ROOM, riftBossScale({ bossRegion: 'forest', pinnacle: 'gryphon', tier: 6, mods: [] }));
const state = (b: GalGryphon) => b.state as string;
const rodsOf = (b: GalGryphon) => (b as unknown as { rods: { list: (RodState & { top(): THREE.Vector3 })[] } }).rods.list;
/** Step until the boss is in `s` (or the time runs out). */
function until(f: Fake, b: GalGryphon, s: string, sec: number, each?: () => void): boolean {
  for (let i = 0; i < sec * 10; i++) {
    if (state(b) === s) return true;
    f.step(0.1, each);
  }
  return state(b) === s;
}

describe('Gal Gryphon: the fight', () => {
  it('wakes as you step in, calls the storm, and a rod you stand by fills and grounds it beside the rod', () => {
    const b = gryphon();
    const f = fakeFight(b);
    f.body.pos.z -= 4;
    expect(until(f, b, 'storm', 60)).toBe(true);
    // Walk to the nearest rod's foot (well inside its reach) and stand there; up in the clouds it can't be hit.
    const list = rodsOf(b);
    const rod = list.reduce((a, r) => (Math.hypot(r.x - f.body.pos.x, r.z - f.body.pos.z) < Math.hypot(a.x - f.body.pos.x, a.z - f.body.pos.z) ? r : a));
    const spot = new THREE.Vector3(rod.x + (CX - rod.x) * 0.15, 0, rod.z + (CZ - rod.z) * 0.15);
    f.step(1, () => f.body.pos.copy(spot));
    expect(b.invulnerable).toBe(true);
    expect(until(f, b, 'grounded', 10, () => f.body.pos.copy(spot))).toBe(true);
    expect(f.mechanic).toEqual([]);
    expect(rod.charge).toBe(0);
    expect(rod.firedIn).toBe(1);
    expect(b.weakPointOpen).toBe(true);
    expect(b.damageMult()).toBe(cfg.weakPointMult);
    expect(b.invulnerable).toBe(false);
    expect(Math.hypot(b.pos.x - rod.x, b.pos.z - rod.z)).toBeCloseTo(cfg.rodLand, 1);
    // It stays down its time, then gets up.
    f.step(cfg.groundedTime / b.tempo - 0.3, () => f.body.pos.copy(spot));
    expect(state(b)).toBe('grounded');
    f.step(0.6, () => f.body.pos.copy(spot));
    expect(state(b)).not.toBe('grounded');
  });

  it('strikes you with every bolt by a scorched rod or in the open, and lands back in the middle', () => {
    const b = gryphon();
    const f = fakeFight(b);
    f.body.pos.z -= 4;
    expect(until(f, b, 'storm', 60)).toBe(true);
    // Stand in the open, midway between two rods.
    const open = new THREE.Vector3(CX, 0, CZ + 4);
    expect(until(f, b, 'stormLand', 10, () => f.body.pos.copy(open))).toBe(true);
    expect(f.mechanic).toEqual([cfg.boltShare, cfg.boltShare, cfg.boltShare]);
    expect(until(f, b, 'stalk', 10)).toBe(true);
    expect(Math.hypot(b.pos.x - CX, b.pos.z - CZ)).toBeLessThan(1);
  });

  it('in the eye of the storm calls four bolts and a gale pushes you off the middle', () => {
    const b = gryphon();
    const f = fakeFight(b);
    f.body.pos.z -= 4;
    f.step(4);
    b.hp = b.maxHp * 0.45;
    expect(until(f, b, 'storm', 60)).toBe(true);
    expect((b as unknown as { bolts: unknown[] }).bolts).toHaveLength(cfg.bolts2);
    expect(b.hudNote).toBe('  — STORM 0/4');
    const start = new THREE.Vector3(CX + 3, 0, CZ);
    f.body.pos.copy(start);
    f.step(3);
    // Pushed outward (+x from the middle) by the gale, nothing else moving you.
    expect(f.body.pos.x - start.x).toBeGreaterThan(1);
    expect(Math.abs(f.body.pos.z - CZ)).toBeLessThan(0.01);
  });
});
