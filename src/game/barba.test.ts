import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { barbaRay as cfg, dash, player } from './config';
import type { BossContext } from './enemies/Boss';
import { BarbaRay } from './enemies/BarbaRay';
import {
  clutchSpots, dartLane, dryWalk, inInk, nearestGap, platformAt, platformSpots, rippleBands, sinkPick, spoutLine, startVents, surgeAlong,
  tickVents, ventAt, ventSpots, walkIn, type PlatformState, type VentState,
} from './enemies/barbaTide';
import { riftBossScale } from './rifts';
import { inShape, type TelegraphShape } from './world/Telegraph';
import { mulberry32 } from './world/Level';

// Barba Ray, the Rift Map's other Circle II pinnacle (DESIGN.md "Barba Ray"), in its three phases: the Brood's clutches,
// High Tide's platforms and surges, the Deep's air and vents; every attack's way out in its warning at the rift's
// tempo; and a scripted fight against the boss itself through all three.

const CX = 17;
const CZ = 17;
const ROOM = { minX: 0, maxX: 34, minZ: 0, maxZ: 34 };
const TEMPO = 1.15;
const pr = player.radius;
const RIM = cfg.arenaRadius - pr;

const platforms = (): PlatformState[] => platformSpots(CX, CZ).map((s) => ({ ...s, up: true }));

/** Points on the court, every half metre. */
function court(step = 0.5): [number, number][] {
  const out: [number, number][] = [];
  for (let x = -RIM; x <= RIM; x += step) for (let z = -RIM; z <= RIM; z += step) if (Math.hypot(x, z) <= RIM) out.push([CX + x, CZ + z]);
  return out;
}

describe('Barba Ray: the Brood', () => {
  it('lays a clutch one egg near you and the rest apart, all within reach of the middle', () => {
    const rng = mulberry32(5);
    for (let i = 0; i < 300; i++) {
      const [px, pz] = court(1)[Math.floor(rng() * court(1).length)];
      const spots = clutchSpots(CX, CZ, px, pz, rng);
      expect(spots).toHaveLength(cfg.clutchCount);
      for (const [x, z] of spots) expect(Math.hypot(x - CX, z - CZ)).toBeLessThanOrEqual(cfg.clutchRing + 1e-6);
      expect(Math.hypot(spots[0][0] - px, spots[0][1] - pz)).toBeLessThanOrEqual(cfg.clutchNear + 1e-6);
      for (let a = 0; a < spots.length; a++) {
        for (let b = a + 1; b < spots.length; b++) expect(Math.hypot(spots[a][0] - spots[b][0], spots[a][1] - spots[b][1])).toBeGreaterThan(3);
      }
    }
  });

  it('sends a hatched egg’s Pig Rays from the egg through near you to past the rim', () => {
    const rng = mulberry32(3);
    for (let i = 0; i < 200; i++) {
      const sx = CX + (rng() - 0.5) * 20;
      const sz = CZ + (rng() - 0.5) * 20;
      const tx = CX + (rng() - 0.5) * 20;
      const tz = CZ + (rng() - 0.5) * 20;
      const l = dartLane(sx, sz, tx, tz, CX, CZ, rng);
      const ex = l.x + Math.sin(l.yaw) * l.length;
      const ez = l.z + Math.cos(l.yaw) * l.length;
      expect(Math.hypot(ex - CX, ez - CZ)).toBeGreaterThan(cfg.arenaRadius);
      const across = Math.abs((tx - l.x) * Math.cos(l.yaw) - (tz - l.z) * Math.sin(l.yaw));
      expect(across).toBeLessThanOrEqual(cfg.pigSpread + 1e-6);
    }
    // A sidestep clears a lane in its warning.
    expect(cfg.pigWidth / 2 + cfg.pigRadius + pr).toBeLessThanOrEqual(walkIn(cfg.pigWarn, TEMPO) + cfg.pigSpread);
  });
});

describe("Barba Ray: Mother's fury and the tide channels", () => {
  it("makes the fury's glide a dash check and its circles a walk", () => {
    const half = cfg.glideWidth / 2 + pr;
    expect(half).toBeGreaterThan(walkIn(cfg.furyWindup, TEMPO));
    expect(half).toBeLessThanOrEqual(dash.distance);
    expect(0.35 + dash.duration).toBeLessThanOrEqual(cfg.furyWindup / TEMPO);
    expect(cfg.furyRadius + pr).toBeLessThanOrEqual(walkIn(cfg.furyWarn, TEMPO));
  });

  it('puts both channels on the court, each band a walk out of in its warning', () => {
    for (const r of cfg.channelRings) expect(r + cfg.channelHalf).toBeLessThanOrEqual(cfg.arenaRadius);
    expect(cfg.channelRings[0] - cfg.channelHalf).toBeGreaterThan(0);
    expect(cfg.channelHalf + pr).toBeLessThanOrEqual(walkIn(cfg.channelWarn, TEMPO));
  });
});

describe('Barba Ray: High Tide', () => {
  it('stands eight platforms round the court and three round the middle, all on the court, apart', () => {
    const ps = platforms();
    expect(ps).toHaveLength(cfg.platformCount + cfg.innerCount);
    for (const p of ps) expect(Math.hypot(p.x - CX, p.z - CZ) + cfg.platformR).toBeLessThanOrEqual(cfg.arenaRadius);
    ps.forEach((_, i) => expect(nearestGap(ps, i), `platform ${i}`).toBeGreaterThan(0.5));
  });

  it('leaves a dash-wide hop from every platform to the next, crossed before its sinking warning runs out', () => {
    const ps = platforms();
    const real = cfg.sinkWarn / TEMPO;
    ps.forEach((_, i) => {
      expect(nearestGap(ps, i), `platform ${i}`).toBeLessThanOrEqual(dash.distance);
      // From its middle: walk to the edge, dash over the gap (the water a dash skims doesn't count).
      expect(0.35 + cfg.platformR / player.moveSpeed + dash.duration, `platform ${i}`).toBeLessThan(real);
    });
  });

  it('sinks the one you stand on part of the time, else one near you, never below the floor, never one already sinking', () => {
    const ps = platforms();
    const [mx, mz] = [ps[0].x, ps[0].z];
    expect(platformAt(ps, mx, mz)).toBe(0);
    expect(sinkPick(ps, mx, mz, () => 0, cfg.keepPlatforms, 1)).toBe(0);
    const other = sinkPick(ps, mx, mz, () => 0.99, cfg.keepPlatforms, 0);
    expect(other).not.toBe(0);
    expect(Math.hypot(ps[other].x - mx, ps[other].z - mz)).toBeLessThan(cfg.platformRing);
    ps[0].sinking = true;
    expect(sinkPick(ps, mx, mz, () => 0, cfg.keepPlatforms, 1)).not.toBe(0);
    ps.forEach((p, i) => (p.up = i < cfg.keepPlatforms));
    ps.forEach((p) => (p.sinking = false));
    expect(sinkPick(ps, mx, mz, () => 0)).toBe(-1);
  });

  it('gives you time to reach a platform (with a dash) before a surge reaches you, from anywhere, whichever way it rolls', () => {
    const ps = platforms();
    const R = cfg.arenaRadius + 1;
    const wade = player.moveSpeed * (1 - cfg.waterSlow);
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
      const x0 = CX + Math.sin(a) * R;
      const z0 = CZ + Math.cos(a) * R;
      const yaw = a + Math.PI;
      for (const [x, z] of court(1)) {
        const t = cfg.surgeWarn / TEMPO + surgeAlong(x0, z0, yaw, x, z) / (cfg.surgeSpeed * TEMPO) - 0.35;
        const d = dryWalk(ps, x, z);
        const need = d <= 0 ? 0 : dash.duration + Math.max(0, d - dash.distance) / wade;
        expect(need, `${x},${z} from ${a.toFixed(2)}`).toBeLessThanOrEqual(t);
      }
    }
  });
});

describe('Barba Ray: the Deep', () => {
  const vents = (): VentState[] => ventSpots(CX, CZ).map(([x, z]) => ({ x, z, phase: 'off', t: 0 }));

  it('puts its vents on the court, every one within a walk on the air you have', () => {
    const vs = vents();
    expect(vs).toHaveLength(8);
    for (const v of vs) expect(Math.hypot(v.x - CX, v.z - CZ) + cfg.ventRadius).toBeLessThanOrEqual(cfg.arenaRadius);
    for (const [x, z] of court(1)) {
      const far = Math.max(...vs.map((v) => Math.hypot(v.x - x, v.z - z) - cfg.ventRadius));
      expect(far / player.moveSpeed).toBeLessThan(cfg.airMax * 0.75);
    }
  });

  it('spreads an ink pool to its full size, and gives no air from a vent under one', () => {
    const pools = [{ x: CX, z: CZ, t: 0.1 }];
    expect(inInk(pools, CX + cfg.inkRadius - 0.1, CZ)).toBe(false);
    pools[0].t = 2;
    expect(inInk(pools, CX + cfg.inkRadius - 0.1, CZ)).toBe(true);
    expect(inInk(pools, CX + cfg.inkRadius + 0.3, CZ, pr)).toBe(true);
    const vs = vents();
    vs[0].phase = 'flow';
    expect(ventAt(vs, vs[0].x, vs[0].z)).toBe(0);
    vs[0].smothered = true;
    expect(ventAt(vs, vs[0].x, vs[0].z)).toBe(-1);
  });

  it('keeps two vents flowing, moving on from one to the next, each stirring first', () => {
    const vs = vents();
    const rng = mulberry32(9);
    startVents(vs, rng);
    expect(vs.filter((v) => v.phase === 'flow')).toHaveLength(cfg.ventsOn);
    const flowed = new Set<number>();
    let stirred = false;
    for (let i = 0; i < 60 * 60; i++) {
      tickVents(vs, 1 / 60, rng);
      expect(vs.filter((v) => v.phase === 'flow').length).toBe(cfg.ventsOn);
      vs.forEach((v, j) => v.phase === 'flow' && flowed.add(j));
      if (vs.some((v) => v.phase === 'stir')) stirred = true;
    }
    expect(stirred).toBe(true);
    expect(flowed.size).toBeGreaterThan(4);
    // Air only in a flowing one.
    const f = vs.findIndex((v) => v.phase === 'flow');
    expect(ventAt(vs, vs[f].x, vs[f].z)).toBe(f);
    const off = vs.find((v) => v.phase === 'off')!;
    expect(ventAt(vs, off.x, off.z)).toBe(-1);
  });
});

describe('Barba Ray: every attack has a way out in its warning', () => {
  it('walks out of the glide, the spouts, the belly crash, the Ul Ray lunge and the dive', () => {
    expect(cfg.glideWidth / 2 + pr).toBeLessThanOrEqual(walkIn(cfg.glideWindup, TEMPO));
    expect(cfg.spoutRadius + pr).toBeLessThanOrEqual(walkIn(cfg.spoutWindup, TEMPO));
    expect(cfg.crashRadius + pr).toBeLessThanOrEqual(walkIn(cfg.crashWindup, TEMPO));
    expect(cfg.ulWidth / 2 + pr).toBeLessThanOrEqual(walkIn(cfg.ulWarn, TEMPO));
    expect(cfg.diveRadius + pr).toBeLessThanOrEqual(walkIn(cfg.diveWindup, TEMPO));
  });

  it('walks out of the tail sweep from anywhere in it, sideways or back', () => {
    const half = (cfg.sweepArc * Math.PI) / 360;
    const walk = walkIn(cfg.sweepWindup, TEMPO);
    for (let r = 0.1; r <= cfg.sweepRange; r += 0.1) {
      for (let a = -half; a <= half; a += 0.05) {
        const side = r * Math.sin(half - Math.abs(a));
        const back = cfg.sweepRange - r;
        expect(Math.min(side, back) + pr, `${r.toFixed(1)} m, ${a.toFixed(2)}`).toBeLessThanOrEqual(walk);
      }
    }
  });

  it('lines the spouts up along the line, each a little later', () => {
    const line = spoutLine(CX, CZ, 0, 4);
    expect(line).toHaveLength(cfg.spoutCount);
    line.forEach(([x, z], i) => expect(Math.hypot(x - CX, z - CZ)).toBeCloseTo(4 + i * cfg.spoutSpacing));
  });

  it('ripples out in bands you can step into once the one inside has burst', () => {
    const bands = rippleBands();
    expect(bands[0][0]).toBe(cfg.rippleInner);
    for (let i = 1; i < bands.length; i++) expect(bands[i][0]).toBe(bands[i - 1][1]);
    expect(cfg.rippleBand).toBeLessThanOrEqual(walkIn(cfg.rippleWindup, TEMPO));
    expect(2 * pr + 0.2).toBeLessThanOrEqual(walkIn(cfg.rippleStep, TEMPO));
    const shape: TelegraphShape = { kind: 'arc', x: CX, z: CZ, yaw: 0, inner: bands[1][0], outer: bands[1][1], arcDeg: 360 };
    for (let a = 0; a < 6.28; a += 0.5) expect(inShape(shape, CX + Math.sin(a) * 8, CZ + Math.cos(a) * 8, 0)).toBe(true);
  });
});

// ------------------------------------------------------------------ a scripted fight

interface Fake {
  ctx: BossContext;
  body: { pos: THREE.Vector3; alive: boolean; radius: number };
  drowned: number[];
  hits: TelegraphShape[];
  step(sec: number, each?: () => void): void;
}

function fakeFight(boss: BarbaRay): Fake {
  const body = { pos: new THREE.Vector3(CX, 0, CZ + 10), alive: true, radius: player.radius };
  const teles: { t: number; dur: number; onFire: () => void; done: boolean; cancel(): void }[] = [];
  const drowned: number[] = [];
  const hits: TelegraphShape[] = [];
  const ctx: BossContext = {
    playerX: body.pos.x,
    playerZ: body.pos.z,
    playerAlive: true,
    rng: mulberry32(11),
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
    mechanicHit: () => true,
    drown: (share) => {
      drowned.push(share);
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
  return { ctx, body, drowned, hits, step };
}

const ray = () => new BarbaRay(ROOM, riftBossScale({ bossRegion: 'mines', pinnacle: 'barba', tier: 6, mods: [] }));
const state = (b: BarbaRay) => b.state as string;
function until(f: Fake, b: BarbaRay, s: string, sec: number, each?: () => void): boolean {
  for (let i = 0; i < sec * 10; i++) {
    if (state(b) === s) return true;
    f.step(0.1, each);
  }
  return state(b) === s;
}
const sum = (v: number[]) => v.reduce((a, x) => a + x, 0);

/** Into High Tide: its HP just under the threshold, then wait out the change. */
function toTide(f: Fake, b: BarbaRay): void {
  f.step(4);
  b.hp = b.maxHp * (cfg.phase2At - 0.01);
  expect(until(f, b, 'tide', 2)).toBe(true);
  expect(until(f, b, 'swim', cfg.tideTime + 2)).toBe(true);
}

/** Into the Deep, from High Tide. */
function toDeep(f: Fake, b: BarbaRay): void {
  toTide(f, b);
  b.hp = b.maxHp * (cfg.phase3At - 0.01);
  expect(until(f, b, 'deep', 2)).toBe(true);
  expect(until(f, b, 'stalk', cfg.deepTime + 2)).toBe(true);
}

describe('Barba Ray: the fight', () => {
  it('lays a clutch a few seconds in; break every egg and it is stunned, weak point open, its own HP untouched', () => {
    const b = ray();
    const f = fakeFight(b);
    expect(until(f, b, 'lay', 20)).toBe(true);
    f.step(1.6);
    const eggs = b.sacs.filter((s) => s.alive);
    expect(eggs).toHaveLength(cfg.clutchCount);
    for (const s of eggs) expect(b.parts()).toContain(s);
    const hp = b.hp;
    for (const s of eggs) s.damage(s.maxHp);
    f.step(0.1);
    expect(state(b)).toBe('stunned');
    expect(b.hp).toBe(hp);
    expect(b.weakPointOpen).toBe(true);
    expect(b.damageMult()).toBe(cfg.weakPointMult);
    expect(until(f, b, 'recover', cfg.stunTime + 2)).toBe(true);
  });

  it('lets an egg it isn’t broken hatch, its Pig Rays darting at you, and is not stunned', () => {
    const b = ray();
    const f = fakeFight(b);
    expect(until(f, b, 'lay', 20)).toBe(true);
    let stunned = false;
    const before = f.hits.length;
    f.step(cfg.clutchHatch / TEMPO + 8, () => {
      if (state(b) === 'stunned') stunned = true;
    });
    expect(stunned).toBe(false);
    expect(b.sacs.every((s) => !s.alive)).toBe(true);
    expect(f.hits.slice(before).some((s) => s.kind === 'circle' && s.radius === cfg.pigRadius)).toBe(true);
  });

  it("brings its fury down for each egg broken but the last: a glide, then waves of circles on you", () => {
    const b = ray();
    const f = fakeFight(b);
    expect(until(f, b, 'lay', 20)).toBe(true);
    f.step(1.6);
    const eggs = b.sacs.filter((s) => s.alive);
    eggs[0].damage(eggs[0].maxHp);
    const before = f.hits.length;
    let attacked = false;
    f.step(8, () => {
      if (state(b) === 'attack') attacked = true;
    });
    expect(attacked).toBe(true);
    expect(f.hits.slice(before).some((s) => s.kind === 'circle' && s.radius === cfg.furyRadius)).toBe(true);
    // The other two: the last one stuns it, its fury swallowed.
    for (const s of eggs.slice(1)) s.damage(s.maxHp);
    f.step(0.1);
    expect(state(b)).toBe('stunned');
  });

  it('erupts the tide channels in turn, the inner ring first', () => {
    const b = ray();
    const f = fakeFight(b);
    const onRing = (r: number) => () => f.body.pos.set(CX + r, 0, CZ);
    const arcAt = (r: number) => (s: TelegraphShape) => s.kind === 'arc' && Math.abs(s.inner - (r - cfg.channelHalf)) < 1e-6;
    f.step((2.6 + cfg.channelFirst + cfg.channelWarn) / TEMPO + 1, onRing(cfg.channelRings[0]));
    expect(f.hits.some(arcAt(cfg.channelRings[0]))).toBe(true);
    f.step(cfg.channelEvery / TEMPO + 1, onRing(cfg.channelRings[1]));
    expect(f.hits.some(arcAt(cfg.channelRings[1]))).toBe(true);
  });

  it('can’t be skipped through: damage past the Brood’s threshold is lost, and the tide comes in', () => {
    const b = ray();
    const f = fakeFight(b);
    expect(until(f, b, 'stalk', 10)).toBe(true);
    b.damage(b.maxHp * 2);
    expect(b.alive).toBe(true);
    expect(b.hp).toBeCloseTo(b.maxHp * cfg.phase2At - 1);
    f.step(0.1);
    expect(state(b)).toBe('tide');
    expect(b.invulnerable).toBe(true);
    expect(until(f, b, 'swim', cfg.tideTime + 2)).toBe(true);
    expect(b.phase).toBe(2);
    f.step(1.5);
    expect(b.water.level).toBeGreaterThan(0.9);
    expect(b.uls.filter((u) => u.alive)).toHaveLength(cfg.ulCount);
  });

  it('drowns you a little at a time off the platforms in High Tide, and spares you on one', () => {
    const b = ray();
    const f = fakeFight(b);
    toTide(f, b);
    const spot = court().find(([x, z]) => dryWalk(b.platforms.list, x, z) > 1.5)!;
    f.body.pos.set(spot[0], 0, spot[1]);
    const before = sum(f.drowned);
    f.step(2, () => f.body.pos.set(spot[0], 0, spot[1]));
    const took = sum(f.drowned) - before;
    expect(took).toBeGreaterThan(cfg.waterShare * (2 - cfg.waterTick) - 1e-9);
    expect(took).toBeLessThan(cfg.waterShare * 2 * 1.1);
    const p = b.platforms.list.find((x) => x.up && !x.sinking)!;
    f.body.pos.set(p.x, 0, p.z);
    f.step(0.1, () => f.body.pos.set(p.x, 0, p.z));
    const dry = sum(f.drowned);
    f.step(1, () => f.body.pos.set(p.x, 0, p.z));
    expect(sum(f.drowned)).toBe(dry);
  });

  it('sinks the platforms in turn and raises each again', () => {
    const b = ray();
    const f = fakeFight(b);
    toTide(f, b);
    let sunk: (typeof b.platforms.list)[number] | undefined;
    for (let i = 0; i < 200 && !sunk; i++) {
      f.step(0.1);
      sunk = b.platforms.list.find((p) => !p.up);
    }
    expect(sunk).toBeDefined();
    let rose = false;
    f.step(cfg.riseAfter / TEMPO + 1, () => {
      if (sunk!.up) rose = true;
    });
    expect(rose).toBe(true);
    expect(b.platforms.list.filter((p) => p.up).length).toBeGreaterThanOrEqual(cfg.keepPlatforms);
  });

  it('hits you with a surge in the water, rides it in and beaches, weak point open', () => {
    const b = ray();
    const f = fakeFight(b);
    toTide(f, b);
    const spot = court().find(([x, z]) => dryWalk(b.platforms.list, x, z) > 1.5 && Math.hypot(x - CX, z - CZ) < 8)!;
    const keep = () => f.body.pos.set(spot[0], 0, spot[1]);
    expect(until(f, b, 'surge', cfg.surgeFirst / TEMPO + 10, keep)).toBe(true);
    const before = f.hits.length;
    expect(until(f, b, 'beached', 8, keep)).toBe(true);
    expect(f.hits.slice(before).some((s) => s.kind === 'circle' && s.radius === 1)).toBe(true);
    expect(b.weakPointOpen).toBe(true);
    expect(until(f, b, 'swim', cfg.beachedTime + 4, keep)).toBe(true);
  });

  it('lets a surge pass under you on a platform', () => {
    const b = ray();
    const f = fakeFight(b);
    toTide(f, b);
    const hop = () => {
      const list = b.platforms.list;
      const on = platformAt(list, f.body.pos.x, f.body.pos.z);
      if (on >= 0 && !list[on].sinking) return;
      const next = list
        .filter((p) => p.up && !p.sinking)
        .sort((a, c) => Math.hypot(a.x - f.body.pos.x, a.z - f.body.pos.z) - Math.hypot(c.x - f.body.pos.x, c.z - f.body.pos.z))[0];
      if (next) f.body.pos.set(next.x, 0, next.z);
    };
    expect(until(f, b, 'surge', cfg.surgeFirst / TEMPO + 10, hop)).toBe(true);
    const before = f.hits.length;
    expect(until(f, b, 'beached', 8, hop)).toBe(true);
    expect(f.hits.slice(before).some((s) => s.kind === 'circle' && s.radius === 1)).toBe(false);
  });

  it('replaces a dead Ul Ray, and its hits never touch the boss’s own HP', () => {
    const b = ray();
    const f = fakeFight(b);
    toTide(f, b);
    f.step(1);
    const u = b.uls.find((x) => x.alive)!;
    expect(b.parts()).toContain(u);
    const hp = b.hp;
    expect(u.damage(u.maxHp + 1)).toBe(true);
    expect(b.hp).toBe(hp);
    f.step(cfg.ulRespawn / TEMPO + 1);
    expect(b.uls.filter((x) => x.alive)).toHaveLength(cfg.ulCount);
  });

  it('flies its Ul Rays overhead: touching one does nothing, its warned lane hits as it plunges, then it climbs back up', () => {
    const b = ray();
    const f = fakeFight(b);
    toTide(f, b);
    // Stand still on a platform; watch one ray through a whole plunge.
    const p = b.platforms.list.find((x) => x.inner)!;
    const keep = () => {
      p.rise();
      f.body.pos.set(p.x, 0, p.z);
    };
    let u: (typeof b.uls)[number] | undefined;
    for (let i = 0; i < 100 && !u; i++) {
      f.step(0.1, keep);
      u = b.uls.find((x) => x.alive && x.mode === 'wind');
    }
    expect(u).toBeDefined();
    expect(u!.alt).toBeGreaterThan(cfg.ulFly - 0.5);
    const before = f.hits.length;
    let low = Infinity;
    let plunged = false;
    for (let i = 0; i < 180 && !(plunged && u!.mode === 'fly'); i++) {
      f.step(1 / 60, keep);
      low = Math.min(low, u!.alt);
      if (u!.mode === 'plunge') plunged = true;
    }
    expect(plunged).toBe(true);
    expect(low).toBeLessThan(cfg.ulSkim + 0.05);
    expect(u!.mode).toBe('fly');
    // The lane hit (it ran through you); nothing else of the ray's did.
    const mine = f.hits.slice(before).filter((s) => s.kind === 'line' && s.width === cfg.ulWidth);
    expect(mine.length).toBeGreaterThanOrEqual(1);
    expect(f.hits.some((s) => s.kind === 'circle' && s.radius === cfg.ulRadius + 0.3)).toBe(false);
  });

  it('drags the court into the Deep: your air runs down, a vent refills it, and out of air you drown', () => {
    const b = ray();
    const f = fakeFight(b);
    toDeep(f, b);
    expect(b.phase).toBe(3);
    expect(b.air).toBeCloseTo(1, 1);
    expect(b.uls.every((u) => !u.alive)).toBe(true);
    expect(b.platforms.list.every((p) => !p.up)).toBe(true);
    // Off every vent: about a second of air a second.
    const offVent = () => {
      const spot = court(1).find(([x, z]) => b.vents.list.every((v) => Math.hypot(v.x - x, v.z - z) > cfg.ventRadius + 3))!;
      f.body.pos.set(spot[0], 0, spot[1]);
    };
    f.step(3, offVent);
    expect(b.depth).toBeGreaterThan(0.9);
    expect(b.airLeft).toBeCloseTo(cfg.airMax - 3, 0);
    // In a flowing vent: back up.
    const inVent = () => {
      const v = b.vents.list.find((x) => x.phase === 'flow')!;
      f.body.pos.set(v.x, 0, v.z);
    };
    f.step(1, inVent);
    expect(b.airLeft).toBeGreaterThan(Math.min(cfg.airMax, cfg.airMax - 3 + cfg.airRefill * 0.8) - 0.1);
    // Out of air.
    b.airLeft = 0.01;
    const before = sum(f.drowned);
    f.step(2, offVent);
    expect(sum(f.drowned) - before).toBeGreaterThan(cfg.airShare * (2 - cfg.waterTick) - 1e-9);
  });

  it('marks you with ink in the Deep: a pool where you stand when it runs out, hurting, smothering a vent under it', () => {
    const b = ray();
    const f = fakeFight(b);
    toDeep(f, b);
    const spot = court(1).find(([x, z]) => b.vents.list.every((v) => Math.hypot(v.x - x, v.z - z) > cfg.ventRadius + cfg.inkRadius + 1))!;
    const keep = () => {
      b.airLeft = cfg.airMax;
      f.body.pos.set(spot[0], 0, spot[1]);
    };
    for (let i = 0; i < 200 && !b.marks.length; i++) f.step(0.1, keep);
    expect(b.marks).toHaveLength(1);
    expect(b.marks[0].key).toBe('ink');
    for (let i = 0; i < 200 && b.marks.length; i++) f.step(0.1, keep);
    expect(b.inkPools.list).toHaveLength(1);
    expect(Math.hypot(b.inkPools.list[0].x - spot[0], b.inkPools.list[0].z - spot[1])).toBeLessThan(0.5);
    // Standing in it.
    f.step(0.6, keep);
    const before = f.drowned.reduce((a, x) => a + x, 0);
    f.step(2, keep);
    expect(f.drowned.reduce((a, x) => a + x, 0) - before).toBeGreaterThan(cfg.inkShare * (2 - cfg.waterTick) - 1e-9);
    // A pool over a flowing vent: no air there.
    const v = b.vents.list.find((x) => x.phase === 'flow')!;
    b.inkPools.add(v.x, v.z);
    f.step(0.6);
    b.airLeft = 2;
    const onVent = () => f.body.pos.set(v.x, 0, v.z);
    f.step(0.5, onVent);
    expect(b.airLeft).toBeLessThan(2);
  });

  it('dives at you in the Deep and sticks in the floor, weak point open', () => {
    const b = ray();
    const f = fakeFight(b);
    toDeep(f, b);
    const keep = () => {
      b.airLeft = cfg.airMax;
      f.body.pos.set(CX + 3, 0, CZ + 3);
    };
    expect(until(f, b, 'stuck', 40, keep)).toBe(true);
    expect(b.weakPointOpen).toBe(true);
    expect(b.invulnerable).toBe(false);
  });

  it('comes back up out of the Deep when it dies', () => {
    const b = ray();
    const f = fakeFight(b);
    toDeep(f, b);
    for (let i = 0; i < 200 && b.alive; i++) {
      b.damage(b.maxHp * 2);
      f.step(0.1);
    }
    expect(b.alive).toBe(false);
    expect(b.air).toBeNull();
    f.step(6);
    expect(b.depth).toBeLessThan(0.05);
    expect(b.platforms.list.every((p) => p.up)).toBe(true);
  });
});
