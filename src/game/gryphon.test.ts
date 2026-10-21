import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { galGryphon as cfg, hell, player } from './config';
import type { BossContext } from './enemies/Boss';
import { GalGryphon } from './enemies/GalGryphon';
import {
  cagePlan, driftSpark, featherSpots, flankOrbs, nearestRod, pulseTimes, ringOrbs, rimSpark, rodAt, rodSpots, rodUsable, rodWalk, sparkAlong,
  sparkTouches, stormRod, stormWalk, type RodState,
} from './enemies/gryphonStorm';
import { riftBossScale } from './rifts';
import { inShape, type TelegraphShape } from './world/Telegraph';
import { mulberry32 } from './world/Level';

// Gal Gryphon, the Rift Map's Circle II pinnacle (DESIGN.md "Gal Gryphon"): its storm's rules (the lit rod, the
// pulses, the feathers), the layouts of its pairs and triples (each with a way out in its warning), the sparks, and a scripted
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

  it('pulses three times about a second apart; the last, with a second to spare after any walk to a pillar, strikes', () => {
    const t = pulseTimes(TEMPO);
    expect(t).toHaveLength(cfg.pulses);
    for (let i = 1; i < t.length; i++) expect(real(t[i] - t[i - 1])).toBeGreaterThanOrEqual(cfg.pulseFloor - 1e-9);
    // The walk the lit rod's pillar may need leaves stormSpare real seconds before the last pulse.
    expect(stormWalk(TEMPO) / player.moveSpeed + 0.35 + cfg.stormSpare).toBeCloseTo(real(t[t.length - 1]), 6);
    // A failed storm is the usual failed mechanic.
    expect(hell.mechanicHit).toBeCloseTo(0.8, 6);
  });

  it('leaves every spot on the summit a walk from a pillar before the last pulse, with all rods up', () => {
    const all = rods();
    let worst = 0;
    for (const [x, z] of summit()) worst = Math.max(worst, rodWalk(all, x, z, 1));
    // The worst is the middle: 11 - 3.5 = 7.5 m.
    expect(rodWalk(all, CX, CZ, 1)).toBeCloseTo(cfg.rodRing - cfg.rodReach, 6);
    expect(worst).toBeLessThanOrEqual(cfg.rodRing - cfg.rodReach + 1e-9);
    expect(cfg.rodRing - cfg.rodReach).toBeLessThanOrEqual(stormWalk(TEMPO));
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
    // On the rim behind the scorched rod the next pillar is too far to walk in time (the boss then waits).
    const [x, z] = [CX + Math.sin(Math.PI / 6) * 15.5, CZ - Math.cos(Math.PI / 6) * 15.5];
    expect(rodWalk(list, x, z, 3)).toBeGreaterThan(stormWalk(TEMPO));
  });

  it('lights one usable rod a storm, at random among those you can walk to, never a scorched one nor the one you stand by', () => {
    const rng = mulberry32(3);
    const walkable = stormWalk(TEMPO);
    for (const [x, z] of summit(2)) {
      const list = rods(3, [Math.floor(rng() * 6)]);
      const i = stormRod(list, x, z, 3, walkable, rng);
      if (i < 0) {
        // Only ever when no usable reach is in walking range (the storm then waits).
        expect(rodWalk(list, x, z, 3)).toBeGreaterThan(walkable);
        continue;
      }
      expect(rodUsable(list[i], 3)).toBe(true);
      expect(Math.hypot(list[i].x - x, list[i].z - z) - cfg.rodReach).toBeLessThanOrEqual(walkable);
      // Never the one you're in while another is in reach (on the rim behind a rod with its neighbour scorched there
      // may be none: then it is yours, a pass at once).
      const others = list.some((r, k) => k !== i && rodUsable(r, 3) && Math.hypot(r.x - x, r.z - z) > cfg.rodReach && Math.hypot(r.x - x, r.z - z) - cfg.rodReach <= walkable);
      if (others) expect(Math.hypot(list[i].x - x, list[i].z - z)).toBeGreaterThan(cfg.rodReach);
    }
    // From the middle every rod is in reach, so any of the six can light.
    const seen = new Set<number>();
    for (let k = 0; k < 300; k++) seen.add(stormRod(rods(), CX, CZ, 1, walkable, rng));
    expect(seen.size).toBe(6);
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

  it('keeps the plummet and the crossing lash walks (both slowed on 2026-10-22, the user\u2019s calls)', () => {
    expect(cfg.plummetRadius + pr).toBeLessThanOrEqual(walk(real(cfg.plummetWindup)));
    expect(cfg.swoopWidth / 2 + pr).toBeLessThanOrEqual(walk(real(cfg.crossWindup)));
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

  it('plummet ring: out through the one gap (a walk), and not even a dash finds another way', () => {
    const rng = mulberry32(11);
    const step = (Math.PI * 2) / cfg.ringSlots;
    for (const { px, pz } of standings(100, 13)) {
      const { orbs, gap } = ringOrbs(px, pz, CX, CZ, rng);
      expect(orbs).toHaveLength(cfg.ringSlots - 1);
      const shapes = [circle([px, pz], cfg.plummetRadius), ...orbs.map((o) => circle(o, cfg.orbRadius))];
      expect(safeSpots(px, pz, walk(real(cfg.plummetWindup)), shapes).length).toBeGreaterThan(0);
      const ok = safeSpots(px, pz, walk(real(cfg.plummetWindup)) + DASH, shapes);
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
  it('come one at a time from all round the rim, each aimed within a few metres of you, slower than you walk', () => {
    const rng = mulberry32(21);
    const [tx, tz] = [CX + 4, CZ - 2];
    const angles = new Set<number>();
    for (let k = 0; k < 400; k++) {
      const s = rimSpark(CX, CZ, tx, tz, rng);
      expect(Math.hypot(s.x - CX, s.z - CZ)).toBeCloseTo(cfg.arenaRadius + 1, 6);
      expect(Math.hypot(s.vx, s.vz)).toBeCloseTo(cfg.sparkSpeed, 6);
      angles.add(Math.floor(((Math.atan2(s.x - CX, s.z - CZ) + Math.PI) / (Math.PI * 2)) * 8));
      // Its line passes within the spread of you.
      const ux = s.vx / cfg.sparkSpeed;
      const uz = s.vz / cfg.sparkSpeed;
      const off = Math.abs((tx - s.x) * uz - (tz - s.z) * ux);
      expect(off).toBeLessThanOrEqual(cfg.sparkSpread + 1e-9);
    }
    // From every eighth of the rim.
    expect(angles.size).toBe(8);
    expect(cfg.sparkSpeed * TEMPO).toBeLessThan(player.moveSpeed);
    const off = sparkAlong(0, 0, Math.PI / 2);
    expect(off.vx).toBeCloseTo(cfg.sparkSpeed, 6);
  });

  it('hit you if you stand still in their line; a sidestep of a metre and a half lets one by', () => {
    const run = (dodge: boolean) => {
      const k = sparkAlong(0, 0, Math.PI / 2);
      let pz = 0;
      let hit = false;
      for (let t = 0; t < 12 / cfg.sparkSpeed + 2 && !hit; t += 1 / 60) {
        if (dodge && t > 1) pz = Math.min(1.5, pz + player.moveSpeed / 60);
        driftSpark(k, 1 / 60, 0, 0, 50);
        hit = sparkTouches(k, 12, pz, pr);
      }
      return hit;
    };
    expect(run(false)).toBe(true);
    expect(run(true)).toBe(false);
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
  /** Every telegraph warned, with the boss's state when it was. */
  warned: { shape: TelegraphShape; state: string }[];
  step(sec: number, each?: () => void): void;
}

function fakeFight(boss: GalGryphon): Fake {
  const body = { pos: new THREE.Vector3(CX, 0, CZ + 14), alive: true, radius: player.radius };
  const teles: { t: number; dur: number; onFire: () => void; done: boolean; cancel(): void }[] = [];
  const mechanic: number[] = [];
  const hits: TelegraphShape[] = [];
  const warned: { shape: TelegraphShape; state: string }[] = [];
  const ctx: BossContext = {
    playerX: body.pos.x,
    playerZ: body.pos.z,
    playerAlive: true,
    rng: mulberry32(9),
    telegraph: (shape, dur, onFire) => {
      warned.push({ shape, state: boss.state as string });
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
    drown: () => {},
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
  return { ctx, body, mechanic, hits, warned, step };
}

type Peek = { rods: { list: (RodState & { top(): THREE.Vector3 })[] }; lit: number; pulsesDone: number };
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
  it('wakes as you step in, calls the storm, and stepping into the pillar grounds it beside the rod at once', () => {
    const b = gryphon();
    const f = fakeFight(b);
    f.body.pos.z -= 4;
    expect(until(f, b, 'storm', 60)).toBe(true);
    const list = peek(b).rods.list;
    const lit = peek(b).lit;
    expect(lit).toBeGreaterThanOrEqual(0);
    // Never the rod you stand by.
    expect(Math.hypot(list[lit].x - f.body.pos.x, list[lit].z - f.body.pos.z)).toBeGreaterThan(cfg.rodReach);
    f.step(0.5);
    expect(b.invulnerable).toBe(true);
    expect(peek(b).pulsesDone).toBe(0);
    // In: the pulses stop and it comes down.
    f.body.pos.copy(footOf(list[lit]));
    f.step(1 / 60);
    expect(state(b)).toBe('stormFall');
    expect(until(f, b, 'grounded', 3)).toBe(true);
    expect(f.mechanic).toEqual([]);
    expect(list[lit].firedIn).toBe(1);
    expect(b.weakPointOpen).toBe(true);
    expect(b.damageMult()).toBe(cfg.weakPointMult);
    expect(Math.hypot(b.pos.x - list[lit].x, b.pos.z - list[lit].z)).toBeCloseTo(cfg.rodLand, 1);
    // It stays down its time, then gets up.
    f.step(cfg.groundedTime / b.tempo - 0.3);
    expect(state(b)).toBe('grounded');
    f.step(0.6);
    expect(state(b)).not.toBe('grounded');
  });

  it('pulses twice without harm, and the third strikes the whole summit if you never reached the pillar', () => {
    const b = gryphon();
    const f = fakeFight(b);
    f.body.pos.z -= 4;
    expect(until(f, b, 'storm', 60)).toBe(true);
    const list = peek(b).rods.list;
    const other = list.findIndex((_, i) => i !== peek(b).lit);
    const spot = footOf(list[other]);
    const seen: number[] = [];
    expect(until(f, b, 'stormLand', 8, () => {
      f.body.pos.copy(spot);
      if (seen[seen.length - 1] !== peek(b).pulsesDone) seen.push(peek(b).pulsesDone);
      // Nothing hurts you before the last pulse.
      if (peek(b).pulsesDone < cfg.pulses) expect(f.mechanic).toEqual([]);
    })).toBe(true);
    expect(seen).toEqual([0, 1, 2, 3]);
    expect(f.mechanic).toEqual([hell.mechanicHit]);
    expect(until(f, b, 'stalk', 10)).toBe(true);
    expect(Math.hypot(b.pos.x - CX, b.pos.z - CZ)).toBeLessThan(1);
  });

  it('after a pulse or two, stepping into the pillar still passes: no more pulses, no harm, grounded', () => {
    for (const after of [1, 2]) {
      const b = gryphon();
      const f = fakeFight(b);
      f.body.pos.z -= 4;
      expect(until(f, b, 'storm', 60)).toBe(true);
      const list = peek(b).rods.list;
      const lit = peek(b).lit;
      const away = footOf(list[list.findIndex((_, i) => i !== lit)]);
      for (let i = 0; i < 600 && peek(b).pulsesDone < after; i++) f.step(1 / 60, () => f.body.pos.copy(away));
      expect(peek(b).pulsesDone).toBe(after);
      f.body.pos.copy(footOf(list[lit]));
      f.step(1 / 60);
      expect(state(b)).toBe('stormFall');
      expect(peek(b).pulsesDone).toBe(after);
      f.step(3);
      expect(f.mechanic).toEqual([]);
      expect(state(b)).toBe('grounded');
    }
  });

  it('in the eye of the storm a gale pushes you off the middle while it pulses', () => {
    const b = gryphon();
    const f = fakeFight(b);
    f.body.pos.z -= 4;
    f.step(4);
    b.hp = b.maxHp * 0.45;
    expect(until(f, b, 'storm', 60)).toBe(true);
    expect(b.hudNote).toBe(`  — STORM · PULSE 0/${cfg.pulses}`);
    // Somewhere no pillar is (between the middle and the rods), so the storm runs on.
    const start = new THREE.Vector3(CX + 3, 0, CZ);
    f.body.pos.copy(start);
    f.step(1.5);
    // Pushed outward (+x from the middle) by the gale (a spark or a feather may have nudged you; none knock you back far).
    expect(f.body.pos.x - start.x).toBeGreaterThan(1);
    expect(Math.abs(f.body.pos.z - CZ)).toBeLessThan(0.5);
  });

  it('drops feathers outside storms from phase 2 on, a volley every few seconds, none before', () => {
    const feathers = (f: Fake) => f.warned.filter((w) => w.shape.kind === 'circle' && w.shape.radius === cfg.featherRadius && w.state !== 'storm').length;
    const b = gryphon();
    const f = fakeFight(b);
    f.body.pos.z -= 4;
    f.step(30);
    expect(feathers(f)).toBe(0);
    b.hp = b.maxHp * 0.45;
    f.warned.length = 0;
    const secs = 40;
    f.step(secs);
    // Two a volley, every 3.5-5.5 s outside storms (the storms take some of the time).
    const n = feathers(f);
    expect(n % 2).toBe(0);
    expect(n / 2).toBeGreaterThanOrEqual(3);
    expect(n / 2).toBeLessThanOrEqual(Math.ceil((secs * b.tempo) / cfg.featherVolleyEvery[0]) + 1);
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
