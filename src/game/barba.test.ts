import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { barbaRay as cfg, dash, player } from './config';
import type { BossContext } from './enemies/Boss';
import { BarbaRay } from './enemies/BarbaRay';
import {
  burstYaws, dryWalk, nearestGap, pigLane, platformAt, platformSpots, rippleBands, sinkPick, spoutLine, walkIn, type PlatformState,
} from './enemies/barbaTide';
import { riftBossScale } from './rifts';
import { inShape, type TelegraphShape } from './world/Telegraph';
import { mulberry32 } from './world/Level';

// Barba Ray, the Rift Map's other Circle II pinnacle (DESIGN.md "Barba Ray"): the platforms and which one sinks, every
// attack's way out in its warning at the rift's tempo, the Pig Rays' lanes, and a scripted fight against the boss itself
// (the flood, drowning, the Ul Rays, beaching, the whirlpool).

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

describe('Barba Ray: the platforms', () => {
  it('stand eight round the court and three round the middle, all on the court, apart', () => {
    const ps = platforms();
    expect(ps).toHaveLength(cfg.platformCount + cfg.innerCount);
    for (const p of ps) expect(Math.hypot(p.x - CX, p.z - CZ) + cfg.platformR).toBeLessThanOrEqual(cfg.arenaRadius);
    ps.forEach((_, i) => expect(nearestGap(ps, i), `platform ${i}`).toBeGreaterThan(0.5));
  });

  it('can be reached from anywhere on the court in the flood warning', () => {
    const ps = platforms();
    const reach = walkIn(cfg.floodWarn, TEMPO);
    for (const [x, z] of court()) expect(dryWalk(ps, x, z), `${x},${z}`).toBeLessThanOrEqual(reach);
  });

  it('leave a dash-wide hop from every one to the next, crossed before its sinking warning runs out', () => {
    const ps = platforms();
    const real = cfg.sinkWarn / TEMPO;
    ps.forEach((_, i) => {
      const gap = nearestGap(ps, i);
      expect(gap, `platform ${i}`).toBeLessThanOrEqual(dash.distance);
      // From its middle: walk to the edge, dash over the gap (the water a dash skims doesn't count).
      const t = 0.35 + cfg.platformR / player.moveSpeed + dash.duration;
      expect(t, `platform ${i}`).toBeLessThan(real);
    });
  });

  it('sinks the one you stand on most of the time, else one near you, never below the floor, never one already sinking', () => {
    const ps = platforms();
    const [mx, mz] = [ps[0].x, ps[0].z];
    expect(platformAt(ps, mx, mz)).toBe(0);
    expect(sinkPick(ps, mx, mz, CX, CZ, () => 0, false, cfg.keepPlatforms, 1)).toBe(0);
    const other = sinkPick(ps, mx, mz, CX, CZ, () => 0.99, false, cfg.keepPlatforms, 0);
    expect(other).not.toBe(0);
    expect(Math.hypot(ps[other].x - mx, ps[other].z - mz)).toBeLessThan(cfg.platformRing);
    ps[0].sinking = true;
    expect(sinkPick(ps, mx, mz, CX, CZ, () => 0, false, cfg.keepPlatforms, 1)).not.toBe(0);
    // Down to the floor: no more.
    ps.forEach((p, i) => (p.up = i < cfg.keepPlatforms));
    ps.forEach((p) => (p.sinking = false));
    expect(sinkPick(ps, mx, mz, CX, CZ, () => 0)).toBe(-1);
  });

  it('in a whirlpool sinks the innermost first', () => {
    const ps = platforms();
    const first = sinkPick(ps, CX + 9, CZ, CX, CZ, () => 0, true);
    expect(ps[first].inner).toBe(true);
    ps.filter((p) => p.inner).forEach((p) => (p.up = false));
    expect(ps[sinkPick(ps, CX + 9, CZ, CX, CZ, () => 0, true)].inner).toBe(false);
  });
});

describe('Barba Ray: every attack has a way out in its warning', () => {
  it('walks out of the glide, the spouts and the belly crash', () => {
    expect(cfg.glideWidth / 2 + pr).toBeLessThanOrEqual(walkIn(cfg.glideWindup, TEMPO));
    expect(cfg.spoutRadius + pr).toBeLessThanOrEqual(walkIn(cfg.spoutWindup, TEMPO));
    expect(cfg.crashRadius + pr).toBeLessThanOrEqual(walkIn(cfg.crashWindup, TEMPO));
    expect(cfg.ulWidth / 2 + pr).toBeLessThanOrEqual(walkIn(cfg.ulWarn, TEMPO));
  });

  it('lines the spouts up from it along the line, each a little later', () => {
    const line = spoutLine(CX, CZ, 0);
    expect(line).toHaveLength(cfg.spoutCount);
    line.forEach(([x, z], i) => expect(Math.hypot(x - CX, z - CZ)).toBeCloseTo(3 + i * cfg.spoutSpacing));
  });

  it('ripples out in bands you can step into once the one inside has burst', () => {
    const bands = rippleBands();
    expect(bands[0][0]).toBe(cfg.rippleInner);
    for (let i = 1; i < bands.length; i++) expect(bands[i][0]).toBe(bands[i - 1][1]);
    // Over a band in the warning, then across a boundary between bursts.
    expect(cfg.rippleBand).toBeLessThanOrEqual(walkIn(cfg.rippleWindup, TEMPO));
    expect(2 * pr + 0.2).toBeLessThanOrEqual(walkIn(cfg.rippleStep, TEMPO));
    // A ring is a ring: the arc shape covers its band all round.
    const shape: TelegraphShape = { kind: 'arc', x: CX, z: CZ, yaw: 0, inner: bands[1][0], outer: bands[1][1], arcDeg: 360 };
    for (let a = 0; a < 6.28; a += 0.5) expect(inShape(shape, CX + Math.sin(a) * 8, CZ + Math.cos(a) * 8, 0)).toBe(true);
  });

  it('fans the Pig Ray burst with gaps you fit through 6 m out, one lane straight at you', () => {
    const yaws = burstYaws(0.3);
    expect(yaws).toHaveLength(cfg.burstCount);
    expect(yaws[(yaws.length - 1) / 2]).toBeCloseTo(0.3);
    const lateral = 2 * 6 * Math.sin((cfg.burstSpread * Math.PI) / 360);
    expect(lateral - cfg.pigWidth).toBeGreaterThanOrEqual(2 * pr);
    expect(lateral / 2).toBeLessThanOrEqual(walkIn(cfg.burstWindup, TEMPO));
  });

  it('sends Pig Rays from past the rim through near you to past the far rim', () => {
    const rng = mulberry32(3);
    for (let i = 0; i < 200; i++) {
      const tx = CX + (rng() - 0.5) * 20;
      const tz = CZ + (rng() - 0.5) * 20;
      const l = pigLane(CX, CZ, tx, tz, rng);
      expect(Math.hypot(l.x - CX, l.z - CZ)).toBeGreaterThan(cfg.arenaRadius);
      const ex = l.x + Math.sin(l.yaw) * l.length;
      const ez = l.z + Math.cos(l.yaw) * l.length;
      expect(Math.hypot(ex - CX, ez - CZ)).toBeGreaterThan(cfg.arenaRadius);
      // Its line passes within the spread of the target.
      const ax = tx - l.x;
      const az = tz - l.z;
      const across = Math.abs(ax * Math.cos(l.yaw) - az * Math.sin(l.yaw));
      expect(across).toBeLessThanOrEqual(cfg.pigSpread + 1e-6);
    }
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

describe('Barba Ray: the fight', () => {
  it('wakes, sends Pig Rays, and floods the court about 14 s in', () => {
    const b = ray();
    const f = fakeFight(b);
    f.step(0.5);
    expect(state(b)).not.toBe('dormant');
    expect(until(f, b, 'dive', 30)).toBe(true);
    expect(b.invulnerable).toBe(true);
    expect(until(f, b, 'flood', 5)).toBe(true);
    expect(b.water.level).toBeGreaterThanOrEqual(0);
    expect(b.uls.length).toBe(cfg.ulCount);
    expect(b.parts().every((p) => p !== b)).toBe(true);
  });

  it('drowns you off the platforms, about waterShare of your max HP a second, and spares you on one', () => {
    const b = ray();
    const f = fakeFight(b);
    expect(until(f, b, 'flood', 40)).toBe(true);
    // Off every platform, standing still.
    const spot = court().find(([x, z]) => dryWalk(b.platforms.list, x, z) > 1.5)!;
    f.body.pos.set(spot[0], 0, spot[1]);
    const before = sum(f.drowned);
    f.step(2, () => f.body.pos.set(spot[0], 0, spot[1]));
    // Shown in chunks of `waterTick` seconds' worth: the last one may still be pending.
    const took = sum(f.drowned) - before;
    expect(took).toBeGreaterThan(cfg.waterShare * (2 - cfg.waterTick) - 1e-9);
    expect(took).toBeLessThan(cfg.waterShare * 2 * 1.1);
    // On a standing platform's middle: nothing.
    const p = b.platforms.list.find((x) => x.up && !x.sinking)!;
    f.body.pos.set(p.x, 0, p.z);
    f.step(0.1, () => f.body.pos.set(p.x, 0, p.z));
    const dry = sum(f.drowned);
    f.step(1, () => f.body.pos.set(p.x, 0, p.z));
    expect(sum(f.drowned)).toBe(dry);
  });

  it('sinks platforms through the flood, raises them after, and beaches with its weak point open', () => {
    const b = ray();
    const f = fakeFight(b);
    // Stand on a platform from the warning on, the whole flood (hop when it sinks).
    const hop = () => {
      if (state(b) !== 'dive' && state(b) !== 'flood') return;
      const list = b.platforms.list;
      const on = platformAt(list, f.body.pos.x, f.body.pos.z);
      if (on >= 0 && !list[on].sinking) return;
      const next = list.filter((p) => p.up && !p.sinking).sort((a, c) => Math.hypot(a.x - f.body.pos.x, a.z - f.body.pos.z) - Math.hypot(c.x - f.body.pos.x, c.z - f.body.pos.z))[0];
      if (next) f.body.pos.set(next.x, 0, next.z);
    };
    expect(until(f, b, 'flood', 40, hop)).toBe(true);
    let sunk = 0;
    for (let i = 0; i < 160 && state(b) === 'flood'; i++) {
      f.step(0.1, hop);
      sunk = Math.max(sunk, b.platforms.list.filter((p) => !p.up).length);
    }
    expect(sunk).toBeGreaterThanOrEqual(2);
    expect(sum(f.drowned)).toBe(0);
    expect(until(f, b, 'beached', 5)).toBe(true);
    expect(b.platforms.list.every((p) => p.up)).toBe(true);
    expect(b.weakPointOpen).toBe(true);
    expect(b.damageMult()).toBe(cfg.weakPointMult);
    expect(b.uls.every((u) => !u.alive)).toBe(true);
    // Up again after its time.
    expect(until(f, b, 'recover', 12)).toBe(true);
  });

  it("lets you kill an Ul Ray without touching its own HP", () => {
    const b = ray();
    const f = fakeFight(b);
    expect(until(f, b, 'flood', 40)).toBe(true);
    f.step(1);
    const u = b.uls[0];
    expect(b.parts()).toContain(u);
    const hp = b.hp;
    expect(u.invulnerable).toBe(false);
    expect(u.damage(u.maxHp + 1)).toBe(true);
    expect(b.hp).toBe(hp);
    f.step(2);
    expect(b.uls).not.toContain(u);
  });

  it('drags you toward the middle in a phase 3 flood', () => {
    const b = ray();
    const f = fakeFight(b);
    f.step(0.5);
    b.hp = b.maxHp * 0.3;
    expect(until(f, b, 'flood', 50)).toBe(true);
    const p = b.platforms.list.find((x) => !x.inner && x.up && !x.sinking)!;
    f.body.pos.set(p.x, 0, p.z);
    const d0 = Math.hypot(p.x - CX, p.z - CZ);
    f.step(0.5);
    expect(Math.hypot(f.body.pos.x - CX, f.body.pos.z - CZ)).toBeLessThan(d0 - 0.5);
  });
});
