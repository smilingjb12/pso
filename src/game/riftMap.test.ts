import { describe, expect, it } from 'vitest';
import { Character } from './character';
import { regionFloors, RIFT_MODS, riftBossHp, riftBossId, riftSave, syncRiftDepth, type RiftSave } from './rifts';
import {
  BOSS_TIER, clearNode, enterBlock, isRoomKind, MAP_EDGES, MAP_IDS, MAP_NEIGHBOURS, MAP_NODES, mapBest, mapCfg, mapDepth, mapFromLadder, newMap,
  nodeCost, nodeCosts, nodeName, nodeRift, nodeRoll, nodeShown, nodeStatus, payEntry, PINNACLE_BOSS, QUARTERS, resonance,
} from './riftMap';
import { firstKillOwed, riftUniqueOdds, rollBossUnique } from './riftCircles';
import { mulberry32 } from './world/Level';

const save = (map = newMap(7)): RiftSave => ({ tier: 1, clears: 0, best: 0, ladder: 2, map });
const ids = (pred: (id: string) => boolean) => MAP_IDS.filter(pred);

describe('the Rift Map shape', () => {
  it('has four quarters of rooms on ten tier rings, a boss per quarter per circle, four pinnacles and the Heart', () => {
    const rooms = ids((id) => isRoomKind(MAP_NODES[id].kind));
    expect(rooms).toHaveLength(4 * 17);
    for (let t = 1; t <= 10; t++) expect(rooms.filter((id) => MAP_NODES[id].tier === t).length, `tier ${t}`).toBe([1, 4, 7].includes(t) ? 4 : 8);
    const bosses = ids((id) => MAP_NODES[id].kind === 'boss');
    expect(bosses).toHaveLength(12);
    for (const id of bosses) expect(MAP_NODES[id].tier).toBe(BOSS_TIER[MAP_NODES[id].circle]);
    expect(ids((id) => MAP_NODES[id].kind === 'pinnacle')).toHaveLength(4);
    expect(MAP_NODES.HEART.req).toEqual(['NB3', 'EB3', 'SB3', 'WB3']);
    // A Vault and a Gauntlet in every quarter, spread over the circles.
    for (const kind of ['vault', 'gauntlet'] as const) expect(ids((id) => MAP_NODES[id].kind === kind).length).toBeGreaterThanOrEqual(4);
    // Every node stays inside the drawn rim.
    for (const id of MAP_IDS) expect(MAP_NODES[id].r).toBeLessThanOrEqual(470);
  });

  it('can reach every room and boss from the four ways in, and each circle only past one of its bosses', () => {
    const map = newMap(1);
    // Clear everything open until nothing new opens: the whole map is reachable.
    for (let changed = true; changed;) {
      changed = false;
      for (const id of Object.keys(map.nodes)) {
        if (map.nodes[id].s === 'open' && MAP_NODES[id].kind !== 'pinnacle' && MAP_NODES[id].kind !== 'heart') {
          clearNode(save(map), id);
          changed = true;
        }
      }
    }
    for (const id of MAP_IDS) expect(nodeStatus(map, id), id).not.toBe('locked');
    // Tier 4 hangs off circle I's bosses only.
    for (const e of MAP_EDGES) {
      const a = MAP_NODES[e.a];
      const b = MAP_NODES[e.b];
      if (e.kind === 'path' && isRoomKind(a.kind) && isRoomKind(b.kind)) expect(b.circle, `${e.a}->${e.b}`).toBe(a.circle);
      if (e.kind === 'cross') expect(b.tier).toBe(a.tier);
    }
    expect(MAP_NEIGHBOURS.N4).toEqual(['NB1', 'N5a', 'N5b']);
  });
});

describe('opening and clearing', () => {
  it('starts with the four tier-1 rooms open, and a clear opens what it links to', () => {
    const s = save();
    const map = s.map!;
    expect(Object.keys(map.nodes).sort()).toEqual(['E1', 'N1', 'S1', 'W1']);
    expect(clearNode(s, 'N1').sort()).toEqual(['N2a', 'N2b']);
    // A cross-link opens the next quarter at the same tier.
    expect(clearNode(s, 'N2b')).toContain('E2a');
    expect(nodeStatus(map, 'N3a')).toBe('locked');
    expect(clearNode(s, 'N2a')).toContain('N3a');
    // The boss opens once a room before it is cleared; tier 4 only past the boss.
    clearNode(s, 'N3a');
    expect(nodeStatus(map, 'NB1')).toBe('open');
    expect(nodeStatus(map, 'N4')).toBe('locked');
    expect(clearNode(s, 'NB1')).toEqual(['N4']);
    expect(mapDepth(map)).toBe(4);
    expect(mapBest(map)).toBe(3);
    // Locked rooms next to reached ones are shown; deeper ones aren't; landmarks always are.
    expect(nodeShown(map, 'N5a')).toBe(true);
    expect(nodeShown(map, 'N6a')).toBe(false);
    expect(nodeShown(map, 'SB3')).toBe(true);
    expect(nodeShown(map, 'HEART')).toBe(true);
  });

  it('fills Resonance from room clears in the quarter, up to the cap, and boss replays take it', () => {
    const ch = Character.create('T');
    const s = riftSave(ch.data);
    for (let i = 0; i < 9; i++) clearNode(s, 'N1');
    expect(resonance(s, 'dragon')).toBe(mapCfg.resonanceCap);
    expect(resonance(s, 'derolle')).toBe(0);
    s.map!.nodes.N3a = { s: 'cleared', n: 1 };
    s.map!.nodes.NB1 = { s: 'open' };
    // The first kill is free (and its unique still owed while firsts lacks it).
    expect(nodeCost(s, 'NB1')).toBe(0);
    expect(enterBlock(s, 'NB1')).toBe('');
    clearNode(s, 'NB1');
    expect(nodeCost(s, 'NB1')).toBe(0);
    (s.firsts ??= []).push('dragon1');
    expect(nodeCost(s, 'NB1')).toBe(mapCfg.resonanceCost);
    expect(payEntry(s, 'NB1')).toBe(mapCfg.resonanceCost);
    expect(resonance(s, 'dragon')).toBe(mapCfg.resonanceCap - mapCfg.resonanceCost);
    s.map!.res.dragon = 1;
    expect(enterBlock(s, 'NB1')).toContain('Resonance');
    // Rooms take none, pinnacles and the Heart can't be entered yet, locked nodes can't be entered.
    expect(nodeCost(s, 'N1')).toBe(0);
    expect(enterBlock(s, 'HEART')).not.toBe('');
    expect(enterBlock(s, 'S5a')).not.toBe('');
  });

  it('opens a pinnacle once both its bosses are dead, and the Heart once all four Circle III bosses are', () => {
    const s = save();
    clearNode(s, 'NB2');
    expect(nodeStatus(s.map!, 'P2NE')).toBe('locked');
    expect(clearNode(s, 'EB2')).toContain('P2NE');
    for (const q of QUARTERS.slice(0, 3)) clearNode(s, `${q.key}B3`);
    expect(nodeStatus(s.map!, 'HEART')).toBe('locked');
    expect(nodeStatus(s.map!, 'P3SE')).toBe('open');
    expect(clearNode(s, 'WB3')).toContain('HEART');
  });
});

describe('what a node holds', () => {
  it('rolls modifiers by circle, at most one forced affix and one crowd-control resistance, Swarming on every Gauntlet', () => {
    const map = newMap(3);
    for (const id of ids((x) => isRoomKind(MAP_NODES[x].kind))) {
      const n = MAP_NODES[id];
      for (let roll = 0; roll < 12; roll++) {
        map.nodes[id] = { s: 'open', roll };
        const r = nodeRoll(map, id);
        const own = n.kind === 'gauntlet' ? r.mods.filter((m, i) => !(m === 'swarming' && i === 0)) : r.mods;
        const [lo, hi] = mapCfg.mods[n.circle];
        expect(own.length).toBeGreaterThanOrEqual(lo);
        expect(own.length).toBeLessThanOrEqual(hi);
        expect(new Set(r.mods).size).toBe(r.mods.length);
        expect(r.mods.filter((m) => RIFT_MODS[m].affix).length).toBeLessThanOrEqual(1);
        expect(r.mods.filter((m) => RIFT_MODS[m].cc).length).toBeLessThanOrEqual(1);
        if (n.kind === 'gauntlet') expect(r.mods).toContain('swarming');
        expect(!!r.second).toBe(r.mods.includes('bleed'));
        if (r.second) expect(['forest', QUARTERS[n.q!].region]).not.toContain(r.second);
        expect(regionFloors(QUARTERS[n.q!].region)).toContain(r.look);
      }
    }
  });

  it('keeps a roll until the node is cleared, then rolls anew; another seed holds other things', () => {
    const s = save(newMap(11));
    const before = JSON.stringify(nodeRoll(s.map!, 'N1'));
    expect(JSON.stringify(nodeRoll(s.map!, 'N1'))).toBe(before);
    clearNode(s, 'N1');
    const seen = new Set([before]);
    for (let i = 0; i < 6; i++) {
      seen.add(JSON.stringify(nodeRoll(s.map!, 'N1')));
      clearNode(s, 'N1');
    }
    expect(seen.size).toBeGreaterThan(4);
    const other = newMap(12);
    const diff = ids((x) => isRoomKind(MAP_NODES[x].kind)).filter((x) => JSON.stringify(nodeRoll(other, x)) !== JSON.stringify(nodeRoll(newMap(11), x)));
    expect(diff.length).toBeGreaterThan(50);
  });

  it('turns a node into its run: a room in its quarter\'s region, or the boss in its arena without modifiers', () => {
    const map = newMap(5);
    const room = nodeRift(map, 'E6a');
    expect(room).toMatchObject({ region: 'caves', bossRegion: 'caves', tier: 6, boss: false, node: 'E6a', kind: MAP_NODES.E6a.kind, complete: false });
    expect(room.cache).toBeDefined();
    const boss = nodeRift(map, 'SB2');
    expect(boss).toMatchObject({ region: 'mines', bossRegion: 'mines', tier: 6, mods: [], boss: true, node: 'SB2', kind: 'boss' });
    expect(() => nodeRift(map, 'HEART')).toThrow();
  });
});

describe('old saves', () => {
  it('carry the tier ladder over: everything below the highest open tier cleared, that tier open', () => {
    const ch = Character.create('T');
    ch.data.rift = { tier: 5, clears: 9, best: 4, ladder: 2, shards: [{ uid: 's', tier: 3, mods: ['tough'] }], picked: 4 } as never;
    const s = riftSave(ch.data);
    const map = s.map!;
    for (const id of ['N1', 'E3b', 'S4', 'WB1']) expect(nodeStatus(map, id), id).toBe('cleared');
    for (const id of ['N5a', 'E5b', 'S5a', 'W5b']) expect(nodeStatus(map, id), id).toBe('open');
    expect(nodeStatus(map, 'NB2')).toBe('locked');
    expect('shards' in s).toBe(false);
    expect('picked' in s).toBe(false);
    expect(s.clears).toBe(9);
    // A save that closed the top tier has its Circle III bosses down, and the Heart's seals broken.
    const top = mapFromLadder(10, 10, 1);
    expect(nodeStatus(top, 'NB3')).toBe('cleared');
    expect(nodeStatus(top, 'HEART')).toBe('open');
    const fresh = riftSave(Character.create('F').data);
    expect(Object.keys(fresh.map!.nodes).sort()).toEqual(['E1', 'N1', 'S1', 'W1']);
  });

  it('squishes a save from the endless ladder before mapping it', () => {
    const ch = Character.create('T');
    ch.data.rift = { tier: 23, clears: 40, best: 22 } as never;
    const s = riftSave(ch.data);
    expect(s.tier).toBe(10);
    expect(s.ladder).toBe(2);
    syncRiftDepth(s);
    expect(s.tier).toBe(10);
    expect(nodeStatus(s.map!, 'N9a')).toBe('cleared');
  });
});

describe('Pinnacle II: Gal Gryphon', () => {
  it('stands at P2NE only; the other pinnacles and the Heart are still to come', () => {
    expect(Object.keys(PINNACLE_BOSS)).toEqual(['P2NE']);
    const s = save();
    for (const id of ['P2SW', 'P3SE', 'P3NW', 'HEART']) s.map!.nodes[id] = { s: 'open' };
    for (const id of ['P2SW', 'P3SE', 'P3NW', 'HEART']) expect(enterBlock(s, id)).toBe('A boss still to come will stand here.');
    expect(nodeName('P2NE')).toBe('Gal Gryphon');
    expect(nodeName('P2SW')).toBe('Pinnacle II');
  });

  it('opens once Dragon II and De Rol Le II are dead, and its first kill is free', () => {
    const s = save();
    expect(enterBlock(s, 'P2NE')).toBe('Opens once Dragon II and De Rol Le II are dead.');
    clearNode(s, 'NB2');
    expect(enterBlock(s, 'P2NE')).not.toBe('');
    clearNode(s, 'EB2');
    expect(nodeStatus(s.map!, 'P2NE')).toBe('open');
    expect(enterBlock(s, 'P2NE')).toBe('');
    expect(nodeCost(s, 'P2NE')).toBe(0);
    expect(payEntry(s, 'P2NE')).toBe(0);
  });

  it("runs as the Gryphon on Storm Peak at tier 6, with a tier 6 boss's HP and no modifiers", () => {
    const map = newMap(5);
    const r = nodeRift(map, 'P2NE');
    expect(r).toMatchObject({ pinnacle: 'gryphon', tier: BOSS_TIER[2], mods: [], boss: true, node: 'P2NE', kind: 'boss', region: 'forest' });
    expect(riftBossId(r)).toBe('gryphon');
    expect(riftBossHp(r)).toBeCloseTo(riftBossHp(nodeRift(map, 'NB2')), 6);
    expect(() => nodeRift(map, 'P2SW')).toThrow();
  });

  it('after its first kill takes 2 Resonance from each of its quarters, and needs both', () => {
    const s = save();
    clearNode(s, 'NB2');
    clearNode(s, 'EB2');
    clearNode(s, 'P2NE');
    // Still free while its first-kill unique is owed.
    expect(firstKillOwed(s, 'gryphon', 2)).toBe(true);
    expect(nodeCost(s, 'P2NE')).toBe(0);
    (s.firsts ??= []).push('gryphon2');
    expect(nodeCosts(s, 'P2NE')).toEqual({ dragon: mapCfg.pinnacleCost, derolle: mapCfg.pinnacleCost });
    expect(nodeCost(s, 'P2NE')).toBe(2 * mapCfg.pinnacleCost);
    s.map!.res = { dragon: 6, derolle: 1 };
    expect(enterBlock(s, 'P2NE')).toBe(`Needs ${mapCfg.pinnacleCost} Dragon (you have 6) and ${mapCfg.pinnacleCost} De Rol Le (you have 1) Resonance: clear rooms in both quarters.`);
    s.map!.res.derolle = 3;
    expect(enterBlock(s, 'P2NE')).toBe('');
    expect(payEntry(s, 'P2NE')).toBe(2 * mapCfg.pinnacleCost);
    expect(s.map!.res).toEqual({ dragon: 6 - mapCfg.pinnacleCost, derolle: 3 - mapCfg.pinnacleCost });
    // The Dragon's own replays still take only from its quarter.
    (s.firsts ??= []).push('dragon2');
    expect(nodeCosts(s, 'NB2')).toEqual({ dragon: mapCfg.resonanceCost });
  });

  it("drops one of its two uniques on the first kill, then twice a boss's odds", () => {
    const ch = Character.create('T');
    const s = riftSave(ch.data);
    const u = rollBossUnique('gryphon', BOSS_TIER[2], 112, s, ch.data, mulberry32(4));
    expect(u).not.toBeNull();
    expect(['unique_stormCrest_15', 'uunit_groundingCoil']).toContain(u!.id);
    expect(s.firsts).toContain('gryphon2');
    expect(riftUniqueOdds(s, 'gryphon')).toBeCloseTo(2 * riftUniqueOdds(s, 'dragon'), 6);
    s.dry = { gryphon: 3, dragon: 3 };
    expect(riftUniqueOdds(s, 'gryphon')).toBeCloseTo(2 * riftUniqueOdds(s, 'dragon'), 6);
  });
});
