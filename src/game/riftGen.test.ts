import { describe, expect, it } from 'vitest';
import { enemies } from './config';
import { areas, type AreaDef, type LinkDef, type RoomDef } from './data/areas';
import { corridorRect, generateRift, rectsHit, RIFT_GEN, RIFT_ROSTERS, riftThreat, roomMouths } from './riftGen';
import { RIFT_BIOMES, type RiftBiome, type RiftGenOptions } from './riftTypes';
import { Level } from './world/Level';

const SEEDS = 200;

/** Every option mix the tests sweep: plain, boss, Hazards x2, Bleed and Convergence. */
function variants(biome: RiftBiome, seed: number): RiftGenOptions[] {
  const other = RIFT_BIOMES[(RIFT_BIOMES.indexOf(biome) + 1 + (seed % 3)) % 4];
  return [
    { biome, seed, boss: false },
    { biome, seed, boss: true },
    { biome, seed, boss: seed % 2 === 0, hazardMult: 2 },
    { biome, seed, boss: seed % 2 === 1, hazardBiome: other, mixBiome: RIFT_BIOMES[seed % 4] },
    { biome, seed, boss: seed % 3 === 0, hazardBiome: other, mixAll: true },
  ];
}

const inside = (r: RoomDef, x: number, z: number, m = 0) => x >= m && z >= m && x <= r.w - m && z <= r.h - m;

/** Rooms reachable from k0, optionally not crossing links with this lock. */
function reachable(rooms: RoomDef[], links: LinkDef[], skipLock?: string): Set<string> {
  const seen = new Set(['k0']);
  const todo = ['k0'];
  while (todo.length) {
    const id = todo.pop()!;
    for (const l of links) {
      if (skipLock && l.lock === skipLock) continue;
      const other = l.a === id ? l.b : l.b === id ? l.a : null;
      if (other && !seen.has(other)) {
        seen.add(other);
        todo.push(other);
      }
    }
  }
  expect(rooms.length).toBeGreaterThan(0);
  return seen;
}

/** Problems with one generated rift (empty = valid). */
function problems(o: RiftGenOptions, rooms: RoomDef[], links: LinkDef[]): string[] {
  const out: string[] = [];
  const fail = (s: string) => out.push(s);
  const byId = new Map(rooms.map((r) => [r.id, r]));
  const n = rooms.length - (o.boss ? 1 : 0);
  if (n < 8 || n > 11) fail(`room count ${rooms.length}`);
  rooms.forEach((r, i) => r.id !== `k${i}` && fail(`room id ${r.id} at ${i}`));
  if (Math.min(...rooms.map((r) => r.x)) !== 0 || Math.min(...rooms.map((r) => r.z)) !== 0) fail('not translated to 0');

  // Rooms apart.
  for (let i = 0; i < rooms.length; i++)
    for (let j = i + 1; j < rooms.length; j++)
      if (rectsHit(rooms[i], rooms[j], RIFT_GEN.roomPad)) fail(`rooms ${rooms[i].id} ${rooms[j].id} too close`);

  // Links: straight corridors (carveLink rules), clear of other rooms and of each other.
  const cors = links.map((l) => {
    const a = byId.get(l.a);
    const b = byId.get(l.b);
    if (!a || !b) {
      fail(`link to unknown room ${l.a}-${l.b}`);
      return null;
    }
    const c = corridorRect(a, b);
    if (!c) fail(`link ${l.a}-${l.b} not aligned`);
    else {
      if (c.w < 2 || c.h < 2) fail(`corridor ${l.a}-${l.b} too short`);
      for (const r of rooms) if (r !== a && r !== b && rectsHit(c, r, 1)) fail(`corridor ${l.a}-${l.b} crosses ${r.id}`);
    }
    return c;
  });
  for (let i = 0; i < cors.length; i++)
    for (let j = i + 1; j < cors.length; j++)
      if (cors[i] && cors[j] && rectsHit(cors[i]!, cors[j]!, 1)) fail(`corridors ${i} ${j} touch`);

  // Reachability and the switch.
  const all = reachable(rooms, links);
  if (all.size !== rooms.length) fail('unreachable rooms');
  const feats = rooms.flatMap((r) => (r.features ?? []).map((f) => ({ r, f })));
  const kinds = (k: string) => feats.filter((x) => x.f.kind === k);
  if (kinds('start').length !== 1 || kinds('start')[0].r.id !== 'k0') fail('start');
  if (rooms.filter((r) => r.guardian).length !== 1) fail('guardian count');
  const g = rooms.find((r) => r.guardian);
  if (g && (g.waves?.length !== 3 || !g.overlap || !g.ambush?.length)) fail('guardian waves');
  if (kinds('toBoss').length !== (o.boss ? 1 : 0)) fail('toBoss');
  if (o.boss && kinds('toBoss')[0].f.to !== 'riftBoss') fail('toBoss dest');
  if (kinds('toCity').length !== (o.boss ? 1 : 2)) fail('toCity');
  if (!o.boss && !kinds('toCity').some((x) => x.r.guardian)) fail('toCity not in guardian room');
  const locked = links.filter((l) => l.lock);
  if (locked.length !== 1 || locked[0].lock !== 'L1') fail('locked links');
  const sw = kinds('switch');
  if (sw.length !== 1 || sw[0].f.lock !== 'L1') fail('switch');
  else if (!reachable(rooms, links, 'L1').has(sw[0].r.id)) fail('switch behind its own gate');

  // Contents.
  const mouths = roomMouths(rooms, links);
  const circuits = new Set<string>();
  for (const r of rooms) {
    const m = mouths.get(r.id)!;
    const nearMouth = (x: number, z: number, d: number) => m.some((p) => Math.hypot(p.tx - x, p.tz - z) < d);
    for (const f of r.features ?? []) {
      if (!inside(r, f.tx, f.tz, RIFT_GEN.wallMargin)) fail(`${r.id} feature ${f.kind} near wall`);
      if (nearMouth(f.tx, f.tz, RIFT_GEN.mouthClear)) fail(`${r.id} feature ${f.kind} at a mouth`);
    }
    const role = r.id === 'k0' || (r.features ?? []).some((f) => f.kind === 'toBoss') ? 'quiet' : 'fight';
    if (role === 'fight' && !r.waves?.length) fail(`${r.id} has no waves`);
    if (role === 'quiet' && r.waves?.length) fail(`${r.id} start/teleporter has waves`);
    const pinned: { x: number; z: number }[] = [];
    for (const w of r.waves ?? []) {
      if (!w.length) fail(`${r.id} empty wave`);
      for (const s of w) {
        const id = typeof s === 'string' ? s : s.e;
        if (!(id in enemies)) fail(`${r.id} unknown enemy ${id}`);
        if (typeof s !== 'string') {
          if (!inside(r, s.tx, s.tz, 1.5)) fail(`${r.id} pinned ${s.e} outside`);
          if (nearMouth(s.tx, s.tz, RIFT_GEN.mouthClear)) fail(`${r.id} pinned ${s.e} at a mouth`);
          pinned.push({ x: s.tx, z: s.tz });
        }
      }
    }
    for (const a of r.ambush ?? []) if (a >= (r.waves?.length ?? 0)) fail(`${r.id} ambush index`);
    // Hazards inside and off pinned spawns, features and mouths.
    const spots = [...pinned, ...(r.features ?? []).map((f) => ({ x: f.tx, z: f.tz }))];
    const clear = (x: number, z: number, rad: number, what: string) => {
      if (spots.some((p) => Math.hypot(p.x - x, p.z - z) < rad)) fail(`${r.id} ${what} on a spawn/feature`);
      if (nearMouth(x, z, rad + 2)) fail(`${r.id} ${what} at a mouth`);
    };
    for (const [x, z] of r.vents ?? []) {
      if (!inside(r, x, z, 1.5)) fail(`${r.id} vent outside`);
      clear(x, z, 1.4, 'vent');
    }
    for (const [x, z, rx, rz] of [...(r.marsh ?? []), ...(r.slag ?? [])]) {
      if (x - rx < 0.5 || z - rz < 0.5 || x + rx > r.w - 0.5 || z + rz > r.h - 0.5) fail(`${r.id} pool outside`);
      clear(x, z, Math.max(rx, rz), 'pool');
    }
    for (const c of r.crushers ?? []) {
      if (!inside(r, c.tx, c.tz, 1.5)) fail(`${r.id} crusher outside`);
      clear(c.tx, c.tz, 1.4, 'crusher');
    }
    for (const l of r.lasers ?? []) {
      if (!inside(r, l.ax, l.az, 1.5) || !inside(r, l.bx, l.bz, 1.5)) fail(`${r.id} laser outside`);
      if (l.ax !== l.bx && l.az !== l.bz) fail(`${r.id} laser not axis-aligned`);
      for (let k = 0; k <= 4; k++) clear(l.ax + ((l.bx - l.ax) * k) / 4, l.az + ((l.bz - l.az) * k) / 4, 0.7, 'laser');
    }
    for (const c of r.conveyors ?? []) {
      if (c.tx < 1 || c.tz < 1 || c.tx + c.w > r.w - 1 || c.tz + c.h > r.h - 1) fail(`${r.id} conveyor outside`);
      for (let i = 0; i < c.w; i++) for (let j = 0; j < c.h; j++) clear(c.tx + i + 0.5, c.tz + j + 0.5, 0.8, 'conveyor');
    }
    for (const [x, z] of r.pylons ?? []) {
      if (!inside(r, x, z, 2)) fail(`${r.id} pylon outside`);
      clear(x, z, 1.2, 'pylon');
    }
    // Power: every wired machine has its switch in the same room; circuit ids are unique.
    const wired = [...(r.crushers ?? []), ...(r.lasers ?? []), ...(r.conveyors ?? [])].map((x) => x.power).filter(Boolean);
    const power = (r.features ?? []).filter((f) => f.kind === 'power');
    for (const p of wired) if (!power.some((f) => f.lock === p)) fail(`${r.id} circuit ${p} has no switch`);
    for (const f of power) {
      if (!wired.includes(f.lock)) fail(`${r.id} power ${f.lock} wired to nothing`);
      if (circuits.has(f.lock!)) fail(`circuit ${f.lock} reused`);
      circuits.add(f.lock!);
    }
    if ((r.boxes ?? 0) < 2) fail(`${r.id} boxes`);
  }
  // Each region's hazards stay in their region unless Bleed asks for them.
  const has = (k: keyof RoomDef) => rooms.some((r) => r[k] !== undefined);
  const allowed = new Set([o.biome, o.hazardBiome]);
  if ((has('vents') || has('marsh')) && !allowed.has('caves')) fail('cave hazards');
  if ((has('slag') || has('crushers') || has('lasers') || has('conveyors')) && !allowed.has('mines')) fail('mine hazards');
  if (has('pylons') && !allowed.has('ruins')) fail('pylons');
  return out;
}

describe('generateRift', () => {
  for (const biome of RIFT_BIOMES) {
    it(`builds valid ${biome} rifts for ${SEEDS} seeds x 4 option sets`, () => {
      const errors: string[] = [];
      for (let seed = 1; seed <= SEEDS; seed++) {
        for (const o of variants(biome, seed)) {
          const a = generateRift(o);
          const b = generateRift(o);
          if (JSON.stringify(a) !== JSON.stringify(b)) errors.push(`seed ${seed}: not deterministic`);
          for (const p of problems(o, a.rooms, a.links)) errors.push(`${biome} seed ${seed} ${JSON.stringify(o)}: ${p}`);
        }
      }
      expect(errors.slice(0, 20)).toEqual([]);
    });
  }

  it('has a checker that catches broken rifts', () => {
    const o: RiftGenOptions = { biome: 'caves', seed: 5, boss: false };
    const bad = (edit: (rooms: RoomDef[], links: LinkDef[]) => void) => {
      const { rooms, links } = structuredClone(generateRift(o));
      edit(rooms, links);
      return problems(o, rooms, links).length;
    };
    expect(bad(() => {})).toBe(0);
    expect(bad((r) => Object.assign(r[2], { x: r[1].x + 1, z: r[1].z + 1 }))).toBeGreaterThan(0);
    expect(bad((_, l) => l.forEach((x) => delete x.lock))).toBeGreaterThan(0);
    expect(bad((r) => r[1].features?.push({ kind: 'start', tx: 5, tz: 5 }) ?? (r[1].features = [{ kind: 'start', tx: 5, tz: 5 }]))).toBeGreaterThan(0);
    expect(bad((r) => (r[1].vents = [[0.2, 0.2, 0]]))).toBeGreaterThan(0);
  });

  it('varies with the seed', () => {
    const a = JSON.stringify(generateRift({ biome: 'caves', seed: 1, boss: false }));
    const b = JSON.stringify(generateRift({ biome: 'caves', seed: 2, boss: false }));
    expect(a).not.toBe(b);
  });

  it('uses the region roster, pinned spawns and hazards', () => {
    const ids = (biome: RiftBiome, mixBiome?: RiftBiome) => {
      const s = new Set<string>();
      for (let seed = 1; seed <= 30; seed++)
        for (const r of generateRift({ biome, seed, boss: false, mixBiome }).rooms)
          for (const w of r.waves ?? []) for (const e of w) s.add(typeof e === 'string' ? e : e.e);
      return s;
    };
    expect([...ids('forest')].sort()).toEqual(['Booma', 'Gigobooma', 'Gobooma']);
    expect(ids('caves').has('PoisonLily')).toBe(true);
    expect(ids('caves').has('PanArms')).toBe(true);
    expect(ids('mines').has('ControlNode')).toBe(true);
    expect(ids('ruins').has('ChaosBringer')).toBe(true);
    // Convergence: Forest waves with Ruins enemies mixed in, but never pinned types.
    const mixed = ids('forest', 'ruins');
    expect(mixed.has('Dimenian')).toBe(true);
    const m = ids('ruins', 'caves');
    expect(m.has('CaveBooma')).toBe(true);
    expect(m.has('PoisonLily')).toBe(false);
  });

  it('mixes every region into the waves with mixAll (one region a wave, pinned types with their own)', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      for (const r of generateRift({ biome: 'forest', seed, boss: false, mixAll: true }).rooms) {
        for (const w of r.waves ?? []) {
          const ids = w.map((e) => (typeof e === 'string' ? e : e.e));
          for (const id of ids) seen.add(id);
          const regions = new Set(ids.filter((id) => id !== 'PoisonLily' && id !== 'ControlNode').map((id) => RIFT_BIOMES.find((b) => RIFT_ROSTERS[b].some((x) => x.e === id))));
          expect(regions.size).toBeLessThanOrEqual(1);
        }
      }
    }
    for (const id of ['Booma', 'CaveBooma', 'PoisonLily', 'Gillchic', 'ControlNode', 'Dimenian']) expect(seen.has(id), id).toBe(true);
  });

  it('doubles hazards with hazardMult 2', () => {
    const total = (hazardMult: number) => {
      let n = 0;
      for (let seed = 1; seed <= 40; seed++)
        for (const r of generateRift({ biome: 'mines', seed, boss: false, hazardMult }).rooms)
          n += (r.slag?.length ?? 0) + (r.crushers?.length ?? 0) + (r.lasers?.length ?? 0) + (r.conveyors?.length ?? 0);
      return n;
    };
    expect(total(2) / total(1)).toBeGreaterThan(1.5);
  });

  it('keeps the threat near the hand-authored density', () => {
    for (const biome of RIFT_BIOMES) {
      let t = 0;
      let rooms = 0;
      for (let seed = 1; seed <= 50; seed++) {
        const r = generateRift({ biome, seed, boss: true }).rooms;
        t += riftThreat(r);
        rooms += r.filter((x) => x.waves?.length).length;
      }
      const perRoom = t / rooms;
      expect(perRoom).toBeGreaterThan(8);
      expect(perRoom).toBeLessThan(15);
    }
  });

  it('is accepted by the real level builder', () => {
    const base: Record<RiftBiome, AreaDef> = { forest: areas.forest1, caves: areas.cave1, mines: areas.mine2, ruins: areas.ruin2 };
    for (const biome of RIFT_BIOMES) {
      for (let seed = 1; seed <= 6; seed++) {
        const { rooms, links } = generateRift({ biome, seed, boss: seed % 2 === 0, hazardMult: seed % 3 === 0 ? 2 : 1 });
        const level = new Level({ ...base[biome], rooms, links });
        expect(level.rooms.length).toBe(rooms.length);
        expect(level.gates.length).toBe(links.length * 2);
        // The start point and every feature stand on floor.
        for (const f of level.features) expect(level.isSolidAt(f.x, f.z)).toBe(false);
      }
    }
  });
});
