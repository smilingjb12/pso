import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { galGryphon as cfg, player } from './config';
import type { BossContext } from './enemies/Boss';
import { GalGryphon } from './enemies/GalGryphon';
import {
  aimedStream, boltSchedule, cagePlan, driftSpark, featherSpots, flankOrbs, nearestRod, relayNext, ringOrbs, rodAt, rodSpots, rodUsable, rodWalk,
  sparkTouches, spiralBurst, stormLead, type RodState,
} from './enemies/gryphonStorm';
import { riftBossScale } from './rifts';
import { inShape, type TelegraphShape } from './world/Telegraph';
import { mulberry32 } from './world/Level';

// Gal Gryphon, the Rift Map's Circle II pinnacle (DESIGN.md "Gal Gryphon"): its storm's rules (the relay, the
// feathers), the layouts of its pairs and triples (each with a way out in its warning), the sparks, and a scripted
// fight against the boss itself.

const CX = 17;
const CZ = 17;
const ROOM = { minX: 0, maxX: 34, minZ: 0, maxZ: 34 };
const TEMPO = 1.15;
const pr = player.radius;
/** Walking a warning of `real` seconds covers this much, after the usual 0.35 s reaction. */
const walk = (real: number) => player.moveSpeed * (real - 0.35);
const real = (t: number) => t / TEMPO;
const DASH = 2.5;
const RIM = cfg.arenaRadius - pr;

const rods = (storm = 1, fired: number[] = []): RodState[] =>
  rodSpots(CX, CZ).map(([x, z], i) => ({ x, z, charge: 0, firedIn: fired.includes(i) ? storm - 1 : -10 }));

/** Points on the summit, every half metre. */
function summit(step = 0.5): [number, number][] {
  const out: [number, number][] = [];
  for (let x = -RIM; x <= RIM; x += step) for (let z = -RIM; z <= RIM; z += step) if (Math.hypot(x, z) <= RIM) out.push([CX + x, CZ + z]);
  return out;
}

/** The spots on the summit within `budget` m of (px, pz) that none of `shapes` touches. */
function safeSpots(px: number, pz: number, budget: number, shapes: TelegraphShape[]): [number, number][] {
  const out: [number, number][] = [];
  for (let dx = -budget; dx <= budget; dx += 0.2) {
    for (let dz = -budget; dz <= budget; dz += 0.2) {
      const x = px + dx;
      const z = pz + dz;
      if (Math.hypot(dx, dz) > budget || Math.hypot(x - CX, z - CZ) > RIM) continue;
      if (!shapes.some((s) => inShape(s, x, z, pr))) out.push([x, z]);
    }
  }
  return out;
}

const circle = ([x, z]: [number, number], radius: number): TelegraphShape => ({ kind: 'circle', x, z, radius });
/** A long lane through (px, pz) along `yaw`, a swoop's width (the arena clips it anyway). */
const laneThrough = (px: number, pz: number, yaw: number): TelegraphShape => ({
  kind: 'line', x: px - Math.sin(yaw) * 40, z: pz - Math.cos(yaw) * 40, yaw, length: 80, width: cfg.swoopWidth,
});
/** Where a player might stand when an attack starts: random spots on the summit, not hugging the rim. */
function standings(n: number, seed: number): { px: number; pz: number; yaw: number }[] {
  const rng = mulberry32(seed);
  return Array.from({ length: n }, () => {
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * (cfg.arenaRadius - 3);
    return { px: CX + Math.sin(a) * r, pz: CZ + Math.cos(a) * r, yaw: rng() * Math.PI * 2 };
  });
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
    const list = rods(3, [0]);
    expect(rodAt(list, list[0].x, list[0].z, 3)).toBeNull();
    expect(rodAt(list, list[1].x + 1, list[1].z, 3)).toBe(list[1]);
    expect(nearestRod(list, list[0].x, list[0].z, 3)).not.toBe(0);
    // On the rim behind the scorched rod the next reach is too far to walk in the lead (the boss then waits).
    const [x, z] = [CX + Math.sin(Math.PI / 6) * 15.5, CZ - Math.cos(Math.PI / 6) * 15.5];
    expect(rodWalk(list, x, z, 3)).toBeGreaterThan(walk(stormLead(TEMPO) / TEMPO));
  });

  it('relays its light to a neighbour round the ring, never to a scorched rod', () => {
    const rng = mulberry32(3);
    const all = rods();
    const seen = new Set<number>();
    for (let k = 0; k < 200; k++) {
      const n = relayNext(all, 2, 1, rng);
      expect([1, 3]).toContain(n);
      seen.add(n);
    }
    expect(seen.size).toBe(2);
    // With rod 3 scorched, from 2 it can only go to 1; with both neighbours scorched it stays.
    for (let k = 0; k < 50; k++) expect(relayNext(rods(2, [3]), 2, 2, rng)).toBe(1);
    expect(relayNext(rods(2, [1, 3]), 2, 2, rng)).toBe(2);
  });

  it('leaves a walk from one reach to the next between bolts (a dash when the light runs on the way you came)', () => {
    const [a, b] = rodSpots(CX, CZ);
    const gap = Math.hypot(a[0] - b[0], a[1] - b[1]) - 2 * cfg.rodReach;
    expect(gap).toBeCloseTo(4, 1);
    // From the near edge of the lit reach (you saw where the light goes a second earlier).
    expect(gap).toBeLessThanOrEqual(walk(real(cfg.boltGap)));
    // From the middle of the lit reach when the next rod shows: drift toward it while the bolt is marked (still in the
    // reach when it falls), then walk on.
    const drift = Math.min(cfg.rodReach - 0.2, player.moveSpeed * real(cfg.boltWarn));
    expect(cfg.rodRing * 2 * Math.sin(Math.PI / 6) - drift - cfg.rodReach).toBeLessThanOrEqual(walk(real(cfg.boltGap)));
    // When the light runs on the way you came (P, A, B in a row), you reach A's near side as its bolt falls at best:
    // walking the 4 m in and on through A for the rest of the gap, then 11 m on to B's reach less what you crossed.
    const chord = cfg.rodRing * 2 * Math.sin(Math.PI / 6);
    const crossed = player.moveSpeed * real(cfg.boltGap) - gap;
    const leg = chord + cfg.rodReach - crossed - cfg.rodReach;
    expect(leg).toBeGreaterThan(player.moveSpeed * real(cfg.boltGap));
    expect(leg).toBeLessThanOrEqual(player.moveSpeed * real(cfg.boltGap) + DASH);
    // Bolts stay one at a time, each marked a second before it falls; three missed are about the usual 80%.
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
    expect(cfg.bolts).toBe(cfg.rodCharge);
    expect(cfg.bolts2).toBe(cfg.rodCharge + 1);
  });

  it('drops feathers you can walk out of without leaving the lit reach (round the post if you hug it)', () => {
    const rng = mulberry32(5);
    const [rx, rz] = rodSpots(CX, CZ)[1];
    const post = cfg.rodR + pr;
    const budget = walk(real(cfg.featherWindup));
    for (let k = 0; k < 300; k++) {
      const a = rng() * Math.PI * 2;
      const d = post + 0.05 + rng() * (cfg.rodReach - post - 0.05);
      const px = rx + Math.sin(a) * d;
      const pz = rz + Math.cos(a) * d;
      const [near, far] = featherSpots(px, pz, rx, rz, rng);
      expect(Math.hypot(near[0] - px, near[1] - pz)).toBeCloseTo(cfg.featherNear, 6);
      const ok = safeSpots(px, pz, budget, [circle(near, cfg.featherRadius), circle(far, cfg.featherRadius)])
        .filter(([x, z]) => Math.hypot(x - rx, z - rz) <= cfg.rodReach && Math.hypot(x - rx, z - rz) >= post);
      expect(ok.length, `at ${d.toFixed(2)} m from the rod`).toBeGreaterThan(0);
    }
  });
});

describe('Gal Gryphon: its attacks at a rift tempo', () => {
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

describe('Gal Gryphon: its pairs and triples each leave one way out', () => {
  it('swoop + flank orbs: out of the lane on the open side (into the summit), never the closed one', () => {
    for (const { px, pz, yaw } of standings(150, 7)) {
      const { orbs, open } = flankOrbs(px, pz, yaw, CX, CZ);
      const shapes = [laneThrough(px, pz, yaw), ...orbs.map((o) => circle(o, cfg.orbRadius))];
      const ok = safeSpots(px, pz, walk(real(cfg.swoopWindup)), shapes);
      expect(ok.length).toBeGreaterThan(0);
      const [rx, rz] = [Math.sin(yaw + Math.PI / 2), Math.cos(yaw + Math.PI / 2)];
      for (const [x, z] of ok) expect(Math.sign((x - px) * rx + (z - pz) * rz)).toBe(open);
    }
  });

  it('plummet ring: a dash out through the one gap, nowhere else', () => {
    const rng = mulberry32(11);
    const step = (Math.PI * 2) / cfg.ringSlots;
    for (const { px, pz } of standings(100, 13)) {
      const { orbs, gap } = ringOrbs(px, pz, CX, CZ, rng);
      expect(orbs).toHaveLength(cfg.ringSlots - 1);
      const shapes = [circle([px, pz], cfg.plummetRadius), ...orbs.map((o) => circle(o, cfg.orbRadius))];
      const ok = safeSpots(px, pz, walk(real(cfg.plummetWindup)) + DASH, shapes);
      expect(ok.length).toBeGreaterThan(0);
      for (const [x, z] of ok) {
        const a = Math.atan2(x - px, z - pz);
        const off = Math.abs(Math.atan2(Math.sin(a - gap), Math.cos(a - gap)));
        expect(off).toBeLessThan(step);
      }
    }
  });

  it('the cage (below 1/3): the swoop, the lash and three corners of orbs leave one corner, a walk away', () => {
    let planned = 0;
    for (const { px, pz, yaw } of standings(150, 17)) {
      const plan = cagePlan(px, pz, yaw, CX, CZ, RIM - 0.5);
      if (!plan) continue;
      planned++;
      const shapes = [laneThrough(px, pz, yaw), laneThrough(px, pz, plan.lashYaw), ...plan.orbs.map((o) => circle(o, cfg.orbRadius))];
      expect(shapes.some((s) => inShape(s, plan.pocket[0], plan.pocket[1], pr))).toBe(false);
      expect(Math.hypot(plan.pocket[0] - px, plan.pocket[1] - pz)).toBeLessThanOrEqual(walk(real(cfg.cageWindup)));
      // Every spot you can walk to in time is in the pocket's corner.
      const ok = safeSpots(px, pz, walk(real(cfg.cageWindup)), shapes);
      expect(ok.length).toBeGreaterThan(0);
      const [ax, az] = [Math.sin(yaw), Math.cos(yaw)];
      const [bx, bz] = [Math.sin(plan.lashYaw), Math.cos(plan.lashYaw)];
      const corner = (x: number, z: number) => `${Math.sign((x - px) * ax + (z - pz) * az)}${Math.sign((x - px) * bx + (z - pz) * bz)}`;
      const pocket = corner(...plan.pocket);
      for (const [x, z] of ok) expect(corner(x, z)).toBe(pocket);
    }
    expect(planned).toBeGreaterThan(140);
  });
});

describe('Gal Gryphon: the sparks', () => {
  it('streams line up behind each other toward where you stood, slower than you walk', () => {
    const s = aimedStream(0, 0, 10, 0);
    expect(s).toHaveLength(cfg.streamCount);
    expect(s[1].x).toBeCloseTo(-cfg.streamSpacing, 6);
    for (const k of s) expect(Math.hypot(k.vx, k.vz)).toBeCloseTo(cfg.sparkSpeed, 6);
    expect(cfg.sparkSpeed * TEMPO).toBeLessThan(player.moveSpeed);
    const arms = spiralBurst(0, 0, cfg.spiralArms, 0);
    expect(arms).toHaveLength(cfg.spiralArms);
    expect(Math.atan2(arms[1].vx, arms[1].vz)).toBeCloseTo((Math.PI * 2) / cfg.spiralArms, 6);
  });

  it('hit you if you stand still; a sidestep of a metre and a half lets a stream by', () => {
    const run = (dodge: boolean) => {
      const stream = aimedStream(0, 0, 12, 0);
      let pz = 0;
      let hits = 0;
      for (let t = 0; t < 6; t += 1 / 60) {
        if (dodge && t > 1) pz = Math.min(1.5, pz + player.moveSpeed / 60);
        for (const k of [...stream]) {
          driftSpark(k, 1 / 60, 0, 0, 50);
          if (sparkTouches(k, 12, pz, pr)) {
            hits++;
            stream.splice(stream.indexOf(k), 1);
          }
        }
      }
      return hits;
    };
    expect(run(false)).toBe(cfg.streamCount);
    expect(run(true)).toBe(0);
    // They go once they're past the rim heading out.
    const k = { x: 0, z: 0, vx: 3, vz: 0, t: 0 };
    let alive = true;
    for (let t = 0; t < 10 && alive; t += 0.1) alive = driftSpark(k, 0.1, 0, 0, 16);
    expect(alive).toBe(false);
    expect(k.x).toBeGreaterThan(16);
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
      const hit = inShape(shape, body.pos.x, body.pos.z, body.radius);
      if (hit) hits.push(shape);
      return hit;
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

type Peek = { rods: { list: (RodState & { top(): THREE.Vector3 })[] }; lit: number; bolts: unknown[] };
const gryphon = () => new GalGryphon(ROOM, riftBossScale({ bossRegion: 'forest', pinnacle: 'gryphon', tier: 6, mods: [] }));
const state = (b: GalGryphon) => b.state as string;
const peek = (b: GalGryphon) => b as unknown as Peek;
/** A spot well inside a rod's reach, a little toward the middle. */
const footOf = (r: RodState) => new THREE.Vector3(r.x + (CX - r.x) * 0.15, 0, r.z + (CZ - r.z) * 0.15);
/** Step until the boss is in `s` (or the time runs out). */
function until(f: Fake, b: GalGryphon, s: string, sec: number, each?: () => void): boolean {
  for (let i = 0; i < sec * 10; i++) {
    if (state(b) === s) return true;
    f.step(0.1, each);
  }
  return state(b) === s;
}

describe('Gal Gryphon: the fight', () => {
  it('wakes as you step in, calls the storm, and following the lit rod grounds it beside the last one', () => {
    const b = gryphon();
    const f = fakeFight(b);
    f.body.pos.z -= 4;
    expect(until(f, b, 'storm', 60)).toBe(true);
    const list = peek(b).rods.list;
    const first = peek(b).lit;
    // The relay starts at the usable rod nearest you.
    expect(first).toBe(nearestRod(list, f.body.pos.x, f.body.pos.z, 1));
    const visited = new Set<number>();
    const follow = () => {
      const lit = peek(b).lit;
      if (lit >= 0) {
        visited.add(lit);
        f.body.pos.copy(footOf(list[lit]));
      }
    };
    f.step(1, follow);
    expect(b.invulnerable).toBe(true);
    expect(until(f, b, 'grounded', 12, follow)).toBe(true);
    expect(f.mechanic).toEqual([]);
    // Three rods, one after another, neighbours each time.
    expect(visited.size).toBe(cfg.rodCharge);
    const fired = list.findIndex((r) => r.firedIn === 1);
    expect(fired).toBeGreaterThanOrEqual(0);
    expect(b.weakPointOpen).toBe(true);
    expect(b.damageMult()).toBe(cfg.weakPointMult);
    expect(Math.hypot(b.pos.x - list[fired].x, b.pos.z - list[fired].z)).toBeCloseTo(cfg.rodLand, 1);
    // It stays down its time, then gets up.
    f.step(cfg.groundedTime / b.tempo - 0.3);
    expect(state(b)).toBe('grounded');
    f.step(0.6);
    expect(state(b)).not.toBe('grounded');
  });

  it('strikes you with every bolt the lit rod misses: stay at the first rod and the next two hit you', () => {
    const b = gryphon();
    const f = fakeFight(b);
    f.body.pos.z -= 4;
    expect(until(f, b, 'storm', 60)).toBe(true);
    const spot = footOf(peek(b).rods.list[peek(b).lit]);
    expect(until(f, b, 'stormLand', 12, () => f.body.pos.copy(spot))).toBe(true);
    expect(f.mechanic).toEqual([cfg.boltShare, cfg.boltShare]);
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
    expect(peek(b).bolts).toHaveLength(cfg.bolts2);
    expect(b.hudNote).toBe(`  — STORM 0/${cfg.rodCharge} · BOLT 1/${cfg.bolts2}`);
    const start = new THREE.Vector3(CX + 3, 0, CZ);
    f.body.pos.copy(start);
    f.step(3);
    // Pushed outward (+x from the middle) by the gale (a spark or a feather may have nudged you; none knock you back far).
    expect(f.body.pos.x - start.x).toBeGreaterThan(1);
    expect(Math.abs(f.body.pos.z - CZ)).toBeLessThan(0.5);
  });

  it('keeps its sparks coming all fight: standing still you take many, circling the summit far fewer', () => {
    const sparkHits = (move: boolean) => {
      const b = gryphon();
      const f = fakeFight(b);
      f.body.pos.z -= 4;
      f.step(3);
      let a = 0;
      f.hits.length = 0;
      f.step(30, () => {
        if (!move) return;
        a += (player.moveSpeed / 8) / 60;
        f.body.pos.set(CX + Math.sin(a) * 8, 0, CZ + Math.cos(a) * 8);
      });
      return f.hits.filter((h) => h.kind === 'circle' && h.radius === cfg.sparkRadius).length;
    };
    const still = sparkHits(false);
    const moving = sparkHits(true);
    expect(still).toBeGreaterThan(8);
    expect(moving).toBeLessThan(still / 2);
  });
});
