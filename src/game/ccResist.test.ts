import { describe, expect, it } from 'vitest';
import { CC_KINDS, ccCount, rollCcResist, type CcDifficulty, type CcRank, type CcRoll } from './ccResist';
import { crowdControl as cfg, enemies } from './config';
import { RIFT_MODS, riftCc, riftCfg, rollShard } from './rifts';

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const booma = enemies.Booma;
const RANKS: CcRank[] = ['regular', 'elite', 'champion'];
const DIFFS: CcDifficulty[] = ['normal', 'nightmare', 'hell'];

/** Average affix count over many rolls. */
function meanCount(r: CcRoll, n = 4000): number {
  const rng = mulberry(7);
  let sum = 0;
  for (let i = 0; i < n; i++) sum += Object.keys(rollCcResist(r, rng)).length;
  return sum / n;
}

describe('CC resistance affixes', () => {
  it('roll as many as the rank and difficulty say, on average', () => {
    DIFFS.forEach((difficulty) =>
      RANKS.forEach((rank, i) => {
        const want = cfg.count[difficulty][i];
        expect(meanCount({ difficulty, rank, arch: booma })).toBeCloseTo(want, 1);
      }),
    );
  });

  it('roll distinct kinds, each within the difficulty range', () => {
    const rng = mulberry(3);
    for (const difficulty of DIFFS) {
      const [lo, hi] = cfg.strength[difficulty];
      for (let i = 0; i < 2000; i++) {
        const r = rollCcResist({ difficulty, rank: 'champion', arch: booma, extra: 2 }, rng);
        const kinds = Object.keys(r);
        expect(new Set(kinds).size).toBe(kinds.length);
        expect(kinds.every((k) => CC_KINDS.includes(k as never))).toBe(true);
        for (const v of Object.values(r)) {
          expect(v).toBeGreaterThanOrEqual(lo);
          expect(v).toBeLessThanOrEqual(hi);
        }
      }
    }
  });

  it('never pass the cap, however deep the rift', () => {
    const rng = mulberry(5);
    for (let i = 0; i < 2000; i++) {
      const r = rollCcResist({ difficulty: 'hell', rank: 'champion', arch: booma, ...riftCc({ tier: 200, mods: ['steadfast'] }) }, rng);
      for (const v of Object.values(r)) expect(v).toBeLessThanOrEqual(cfg.cap);
    }
  });

  it('grow with the rift tier up to capTier, and add an affix from riftExtraFrom', () => {
    expect(riftCc({ tier: 1, mods: [] }).grow).toBe(0);
    expect(riftCc({ tier: riftCfg.capTier, mods: [] }).grow).toBeCloseTo(cfg.riftPerTier * (riftCfg.capTier - 1));
    expect(riftCc({ tier: riftCfg.capTier + 30, mods: [] }).grow).toBe(riftCc({ tier: riftCfg.capTier, mods: [] }).grow);
    expect(riftCc({ tier: cfg.riftExtraFrom - 1, mods: [] }).extra).toBe(0);
    expect(riftCc({ tier: cfg.riftExtraFrom, mods: [] }).extra).toBe(1);
    expect(ccCount({ difficulty: 'hell', rank: 'regular', extra: 1 }, () => 0.99)).toBe(cfg.count.hell[0] + 1);
  });

  it('a rift modifier lifts its kind on every enemy to the floor', () => {
    const rng = mulberry(9);
    for (const id of ['steadfast', 'insulated', 'relentless', 'anchored'] as const) {
      const kind = RIFT_MODS[id].cc!;
      for (let i = 0; i < 500; i++) {
        const r = rollCcResist({ difficulty: 'hell', rank: 'regular', arch: booma, ...riftCc({ tier: 1, mods: [id] }) }, rng);
        expect(r[kind]).toBeGreaterThanOrEqual(cfg.riftModFloor);
      }
    }
  });

  it('skip knockback on rooted bodies, and everything on the Control Node', () => {
    const rng = mulberry(13);
    for (let i = 0; i < 2000; i++) {
      const lily = rollCcResist({ difficulty: 'hell', rank: 'champion', arch: enemies.PoisonLily, extra: 2, forced: ['knockback'] }, rng);
      expect(lily.knockback).toBeUndefined();
      expect(Object.keys(lily).length).toBe(3);
      const node = rollCcResist({ difficulty: 'hell', rank: 'champion', arch: enemies.ControlNode, forced: ['stun'] }, rng);
      expect(node).toEqual({});
    }
  });

  it('come on shards at most one at a time', () => {
    const rng = mulberry(17);
    for (let i = 0; i < 3000; i++) {
      const s = rollShard(1 + (i % 30), rng);
      expect(s.mods.filter((m) => RIFT_MODS[m].cc).length).toBeLessThanOrEqual(1);
    }
  });
});
