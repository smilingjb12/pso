import { describe, expect, it } from 'vitest';
import { dragon, player } from './config';
import { areas } from './data/areas';
import { fireSchedule } from './enemies/dragonFire';
import { coverOnLine, coverReach, CoverRocks, rampageWindup } from './enemies/dragonRampage';
import { Level } from './world/Level';

const rock = (x: number, z: number, r = 1.5) => ({ x, z, r });
const open = () => true;

describe('Dragon: Hellfire Rampage cover', () => {
  it('a rock covers you only when the line from her to you passes through it, short of you', () => {
    const a = rock(0, 10);
    expect(coverOnLine(0, 0, 0, 14, [a])).toBe(a); // right behind it
    expect(coverOnLine(0, 0, 1.2, 14, [a])).toBe(a); // off-centre, still through it
    expect(coverOnLine(0, 0, 3, 14, [a])).toBeNull(); // beside it
    expect(coverOnLine(0, 0, 0, 7, [a])).toBeNull(); // between her and the rock
    expect(coverOnLine(0, 0, 0, -14, [a])).toBeNull(); // the other way
    // Two on the line: she hits the nearer one first.
    const b = rock(0, 5);
    expect(coverOnLine(0, 0, 0, 14, [a, b])).toBe(b);
  });

  it('measures the walk to the nearest shadow', () => {
    const a = rock(0, 10);
    expect(coverReach(0, 0, 0, 14, [a], open, player.radius)).toBe(0);
    expect(coverReach(0, 0, 5, 12, [], open, player.radius)).toBe(Infinity);
    // Beside the rock: a few metres across into its shadow.
    const d = coverReach(0, 0, 5, 12.5, [a], open, player.radius);
    expect(d).toBeGreaterThan(3.5);
    expect(d).toBeLessThan(5.5);
    // Floor that isn't open doesn't count.
    expect(coverReach(0, 0, 5, 12.5, [a], () => false, player.radius)).toBe(Infinity);
  });

  it('keeps the windup walkable: never under the floor, however enraged or deep the rift', () => {
    expect(rampageWindup(1, 1)).toBeCloseTo(dragon.rampageWindup);
    expect(rampageWindup(dragon.enrageSpeed, 1.3)).toBe(dragon.rampageWindupFloor);
    expect(player.moveSpeed * (rampageWindup(dragon.enrageSpeed, 1.3) - dragon.rampageReact)).toBeGreaterThan(7.5);
  });

  it('stands the cover rocks on open floor, clear of the lair clutter, her spawn and the way in', () => {
    const level = new Level(areas.dragon);
    const c = level.center();
    const spawn = { x: c.x, z: c.z - 6 }; // createBoss
    const start = level.features.find((f) => f.def.kind === 'start')!;
    const rocks = dragon.coverRocks.map(([dx, dz]) => rock(c.x + dx, c.z + dz, dragon.coverRockR));
    for (const r of rocks) {
      for (const [ox, oz] of [[0, 0], [r.r, 0], [-r.r, 0], [0, r.r], [0, -r.r]]) expect(level.isSolidAt(r.x + ox, r.z + oz)).toBe(false);
      for (const t of level.trees) expect(Math.hypot(t.x - r.x, t.z - r.z)).toBeGreaterThan(t.r + r.r + 1);
      expect(Math.hypot(spawn.x - r.x, spawn.z - r.z)).toBeGreaterThan(dragon.radius + r.r + 1);
      expect(Math.hypot(start.x - r.x, start.z - r.z)).toBeGreaterThan(r.r + 3);
      // Room for her (and you) to pass between any two.
      for (const o of rocks) if (o !== r) expect(Math.hypot(o.x - r.x, o.z - r.z)).toBeGreaterThan(r.r + o.r + dragon.radius * 2);
    }
  });

  it("an eruption's blast breaks every rock it reaches, and keeps broken ones in it down", () => {
    const rocks = new CoverRocks([[0, 0], [7, 0], [20, 0], [0, -7]], 0, 0, 1.5, dragon.rockRise);
    const [a, b, far, waiting] = rocks.list;
    rocks.shatter(waiting, () => {});
    rocks.regrowAll();
    expect(rocks.inCircle(0, 0, dragon.eruptRadius)).toEqual([a, b]); // b only grazes it (7 m < 6 + 1.5)
    expect(rocks.blast(0, 0, dragon.eruptRadius, () => {})).toBe(2);
    expect([a.state, b.state, far.state]).toEqual(['broken', 'broken', 'standing']);
    expect(waiting.regrow).toBe(false);
  });

  it('no single eruption in the lair can break more than the three middle rocks', () => {
    const rocks = dragon.coverRocks.map(([x, z]) => rock(x, z, dragon.coverRockR));
    let most = 0;
    for (let x = -20; x <= 20; x += 0.5) {
      for (let z = -18; z <= 18; z += 0.5) {
        most = Math.max(most, rocks.filter((r) => Math.hypot(r.x - x, r.z - z) < r.r + dragon.eruptRadius).length);
      }
    }
    expect(most).toBe(3);
    expect(rocks.length - most).toBeGreaterThan(dragon.rampageMinRocks);
  });
});

describe('Dragon: Hell fire rain', () => {
  it('warns and lands its batch in turns: warn 1, warn 2, land 1, warn 3, land 2, land 3', () => {
    const slots = fireSchedule(dragon.fireRainCount, dragon.fireRainStagger, dragon.fireRainWindup);
    expect(slots).toHaveLength(3);
    const events = slots
      .flatMap((s, k) => [{ t: s.warn, e: `warn ${k + 1}` }, { t: s.land, e: `land ${k + 1}` }])
      .sort((a, b) => a.t - b.t)
      .map((x) => x.e);
    expect(events).toEqual(['warn 1', 'warn 2', 'land 1', 'warn 3', 'land 2', 'land 3']);
    // A warning is long enough to walk out of its circle from the middle (0.35 s to react).
    expect(player.moveSpeed * (dragon.fireRainWindup - 0.35)).toBeGreaterThan(dragon.fireRainRadius + player.radius);
  });
});
