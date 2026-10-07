import { describe, expect, it } from 'vitest';
import { Character, compareEquip, dropVerdict, gearVerdict, makeItem } from './character';
import { enemies, techScaling } from './config';
import { areas } from './data/areas';
import { xpToNext } from './data/classes';
import { getDef, INVENTORY_SIZE, itemDefs, legacyDiskRefund, MAX_STACK, weaponKinds, type ClassId } from './data/items';
import { buffPct, restaHeal } from './data/techniques';
import { rollDragonDrops, rollDrop, rollEliteBonus, rollEnemyDrop, rollWardenDrops, rollWeapon, shopStock, shopTier } from './loot';
import { Level, mulberry32, TILE } from './world/Level';

const CLASSES: ClassId[] = ['hunter', 'ranger', 'force'];

describe('Character', () => {
  it('starts every class with a usable weapon equipped', () => {
    for (const cls of CLASSES) {
      const ch = Character.create('T', cls);
      const w = ch.weaponInstance();
      expect(w).toBeDefined();
      expect(ch.canEquip(w!).ok).toBe(true);
      expect(ch.maxHp).toBeGreaterThan(0);
    }
  });

  it('levels up and carries over excess XP', () => {
    const ch = Character.create('T', 'hunter');
    const hp1 = ch.maxHp;
    const gained = ch.addXp(xpToNext(1) + xpToNext(2) + 5);
    expect(gained).toBe(2);
    expect(ch.level).toBe(3);
    expect(ch.data.xp).toBe(5);
    expect(ch.maxHp).toBeGreaterThan(hp1);
  });

  it('stacks consumables up to the cap, one stack per type', () => {
    const ch = Character.create('T', 'hunter');
    const start = ch.countOf('telepipe');
    expect(ch.addItem(makeItem('telepipe', { qty: MAX_STACK - start }))).toBe(true);
    expect(ch.countOf('telepipe')).toBe(MAX_STACK);
    expect(ch.addItem(makeItem('telepipe'))).toBe(false);
    // Trimate / Trifluid cap at 3.
    expect(ch.addItem(makeItem('trimate', { qty: 3 }))).toBe(true);
    expect(ch.addItem(makeItem('trimate'))).toBe(false);
  });

  it('respects inventory capacity for non-stackables', () => {
    const ch = Character.create('T', 'hunter');
    while (ch.data.inventory.length < INVENTORY_SIZE) expect(ch.addItem(makeItem('saber_1'))).toBe(true);
    expect(ch.addItem(makeItem('saber_1'))).toBe(false);
  });

  it('enforces class and stat requirements', () => {
    const ch = Character.create('T', 'force');
    expect(ch.canEquip(makeItem('sword_1')).ok).toBe(false); // class
    const hunter = Character.create('T', 'hunter');
    expect(hunter.canEquip(makeItem('saber_3')).ok).toBe(false); // ATP req
    hunter.addXp(100000);
    expect(hunter.canEquip(makeItem('saber_3')).ok).toBe(true);
  });

  it('grinds weapons and consumes the grinder', () => {
    const ch = Character.create('T', 'hunter');
    const g = makeItem('digrinder');
    ch.addItem(g);
    const w = ch.weaponInstance()!;
    const [lo] = ch.weaponAtp();
    expect(ch.grind(w.uid, g.uid).ok).toBe(true);
    expect(w.grind).toBe(2);
    expect(ch.weaponAtp()[0]).toBe(lo + 4);
    expect(ch.countOf('digrinder')).toBe(0);
  });

  it('grinding raises every stat the weapon has: MST only on caster weapons', () => {
    const force = Character.create('T', 'force');
    const cane = force.weaponInstance()!;
    const before = force.stats();
    const [lo] = force.weaponAtp();
    cane.grind = 4;
    expect(force.weaponAtp()[0]).toBe(lo + 8);
    expect(force.stats().ata).toBe(before.ata + 2);
    expect(force.stats().mst).toBe(before.mst + 6);
    const hunter = Character.create('T', 'hunter');
    const mst = hunter.stats().mst;
    hunter.weaponInstance()!.grind = 4;
    expect(hunter.stats().mst).toBe(mst);
  });

  it('knows every technique from the start; MST alone decides how strong they are', () => {
    const at42 = (cls: ClassId) => {
      const ch = Character.create('T', cls);
      ch.data.level = 42;
      return ch;
    };
    const h = at42('hunter');
    const f = at42('force');
    const fMst = f.stats().mst;
    const hMst = h.stats().mst;
    expect(fMst).toBeGreaterThan(3 * hMst);
    // Attack techs: a Force hits far harder, and gets more damage out of each TP.
    expect(f.techDamage('foie')).toBeGreaterThan(5 * h.techDamage('foie'));
    expect(f.techDamage('foie') / f.techCost('foie')).toBeGreaterThan(h.techDamage('foie') / h.techCost('foie'));
    // ...but each cast costs more TP.
    expect(f.techCost('foie')).toBeGreaterThan(h.techCost('foie'));
    // Resta: the MST build heals more at the same level, in HP and as a share of its (smaller) bar.
    expect(restaHeal(fMst)).toBeGreaterThan(restaHeal(hMst));
    expect(restaHeal(fMst) / f.maxHp).toBeGreaterThan((restaHeal(hMst) / h.maxHp) * 4);
    // Buffs scale with MST too, up to a cap.
    expect(buffPct('shifta', fMst)).toBeGreaterThan(4 * buffPct('shifta', hMst));
    expect(buffPct('shifta', 5000)).toBe(techScaling.buffCap);
    // More MST from gear raises both damage and cost.
    const before = [f.techDamage('zonde'), f.techCost('zonde')];
    const rod = makeItem('rod_4');
    f.addItem(rod);
    expect(f.equip(rod.uid).ok).toBe(true);
    expect(f.techDamage('zonde')).toBeGreaterThan(before[0]);
    expect(f.techCost('zonde')).toBeGreaterThanOrEqual(before[1]);
  });

  it('refunds leftover technique disks from old saves and forgets learned levels', () => {
    const data = JSON.parse(JSON.stringify(Character.create('T', 'force').data));
    data.techs = { foie: 7, resta: 3 };
    data.inventory.push({ uid: 'd1', id: 'disk_foie_3' }, { uid: 'd2', id: 'disk_resta_1' });
    const meseta = data.meseta;
    const ch = new Character(data);
    expect(ch.data.techs).toBeUndefined();
    expect(ch.data.inventory.some((i) => i.id.startsWith('disk_'))).toBe(false);
    expect(ch.data.meseta).toBe(meseta + legacyDiskRefund('disk_foie_3')! + legacyDiskRefund('disk_resta_1')!);
    expect(ch.data.inventory.filter((i) => i.id === 'frame_1')).toHaveLength(1); // no disk turned into a frame
  });
});

describe('loot', () => {
  it('never drops or sells technique disks', () => {
    const rng = mulberry32(7);
    for (const arch of [enemies.Booma, enemies.Gobooma, enemies.Gigobooma]) {
      for (let i = 0; i < 2000; i++) {
        const d = rollEnemyDrop(arch, rng);
        if (d?.kind === 'item') expect(d.item.id.startsWith('disk_')).toBe(false);
      }
    }
    for (const lv of [1, 20, 60]) {
      for (const it of shopStock('item', lv, 'force', rng, true, true)) expect(it.id.startsWith('disk_')).toBe(false);
    }
  });

  it('Cave enemies drop tiers 2-5 and their own rares', () => {
    const rng = mulberry32(11);
    const tiers = new Set<number>();
    const rares = new Set<string>();
    for (const arch of Object.values(enemies).filter((a) => a.dropTier >= 4 && a.dropTier <= 5)) {
      for (let i = 0; i < 3000; i++) {
        const d = rollEnemyDrop(arch, rng);
        if (d?.kind !== 'item') continue;
        const def = getDef(d.item.id);
        if (def.rare) rares.add(def.id);
        else if (def.type === 'weapon' || def.type === 'armor') tiers.add(def.tier);
      }
      // Cave elites never reach tier 6 either.
      for (let i = 0; i < 500; i++) {
        const d = rollEliteBonus(arch, rng);
        if (d.kind !== 'item') continue;
        const def = getDef(d.item.id);
        if (!def.rare && (def.type === 'weapon' || def.type === 'armor')) expect(def.tier).toBeLessThanOrEqual(5);
      }
    }
    expect([...tiers].sort()).toEqual([2, 3, 4, 5]);
    expect(rares.has('lily_sting') || rares.has('spread_needle')).toBe(true);
  });

  it('Mines enemies drop tiers 4-6, and injectors stop at tier 5', () => {
    const rng = mulberry32(12);
    const tiers = new Set<number>();
    for (const arch of Object.values(enemies).filter((a) => a.dropTier === 6)) {
      for (let i = 0; i < 3000; i++) {
        const d = i % 2 ? rollEnemyDrop(arch, rng) : rollEliteBonus(arch, rng);
        if (d?.kind !== 'item') continue;
        const def = getDef(d.item.id);
        if (def.type === 'injector') expect(def.tier).toBeLessThanOrEqual(5);
        if (!def.rare && (def.type === 'weapon' || def.type === 'armor')) tiers.add(def.tier);
      }
    }
    expect([...tiers].sort()).toEqual([4, 5, 6]);
  });

  it('the Warden drops tier 5-6 gear and, sometimes, a signature item', () => {
    const rng = mulberry32(13);
    const sig = new Set<string>();
    for (let i = 0; i < 400; i++) {
      for (const d of rollWardenDrops(rng, CLASSES[i % 3])) {
        if (d.kind !== 'item') continue;
        const def = getDef(d.item.id);
        if (def.id === 'warden_core' || def.id === 'arc_welder') sig.add(def.id);
        else if (!def.rare && (def.type === 'weapon' || def.type === 'armor')) expect(def.tier).toBeGreaterThanOrEqual(5);
      }
    }
    expect([...sig].sort()).toEqual(['arc_welder', 'warden_core']);
  });

  it('shops stock tier 6 only after the Warden, from Lv 32', () => {
    expect(shopTier(40, true, false)).toBe(5);
    expect(shopTier(31, true, true)).toBe(5);
    expect(shopTier(32, true, true)).toBe(6);
    const rng = mulberry32(14);
    for (const kind of ['weapon', 'armor', 'item'] as const) {
      for (const item of shopStock(kind, 35, 'hunter', rng, true, true)) expect(() => getDef(item.id)).not.toThrow();
    }
  });

  it('only ever produces valid items', () => {
    const rng = mulberry32(42);
    for (let i = 0; i < 3000; i++) {
      const d = rollDrop(2, 0.05, rng, CLASSES[i % 3]);
      if (d.kind === 'item') expect(itemDefs[d.item.id]).toBeDefined();
      else expect(d.amount).toBeGreaterThan(0);
    }
    for (const arch of Object.values(enemies)) {
      for (let i = 0; i < 200; i++) {
        const d = rollEnemyDrop(arch, rng);
        if (d?.kind === 'item') expect(itemDefs[d.item.id]).toBeDefined();
      }
    }
    expect(rollDragonDrops(rng).length).toBeGreaterThan(3);
  });

  it('weapon shop stocks something the class can use', () => {
    const rng = mulberry32(7);
    for (const cls of CLASSES) {
      const stock = shopStock('weapon', 1, cls, rng);
      const usable = stock.filter((s) => {
        const def = getDef(s.id);
        return def.type === 'weapon' && weaponKinds[def.kind].classes.includes(cls);
      });
      expect(usable.length).toBeGreaterThan(0);
    }
  });
});

/** Flood fill floor tiles from a world point; returns reached room ids. */
function reachableRooms(level: Level, x: number, z: number): Set<string> {
  const seen = new Set<number>();
  const stack = [[Math.floor(x / TILE), Math.floor(z / TILE)]];
  const rooms = new Set<string>();
  while (stack.length) {
    const [tx, tz] = stack.pop()!;
    const key = tz * level.width + tx;
    if (seen.has(key) || level.isSolidTile(tx, tz)) continue;
    seen.add(key);
    const r = level.roomAt((tx + 0.5) * TILE, (tz + 0.5) * TILE);
    if (r) rooms.add(r.def.id);
    stack.push([tx + 1, tz], [tx - 1, tz], [tx, tz + 1], [tx, tz - 1]);
  }
  return rooms;
}

describe('Level', () => {
  it('builds every area', () => {
    for (const def of Object.values(areas)) expect(() => new Level(def)).not.toThrow();
  });

  it('Forest 1: locked gate blocks progress until the switch is used', () => {
    const level = new Level(areas.forest1);
    const start = level.features.find((f) => f.def.kind === 'start')!;
    const before = reachableRooms(level, start.x, start.z);
    expect(before.has('r3')).toBe(true); // switch room reachable
    expect(before.has('r4')).toBe(false); // locked behind L1
    expect(before.has('r8')).toBe(false);

    const sw = level.features.find((f) => f.def.kind === 'switch')!;
    level.unlock(sw.def.lock!);
    const after = reachableRooms(level, start.x, start.z);
    for (const r of areas.forest1.rooms) expect(after.has(r.id)).toBe(true);
  });

  it('closing a room seals it', () => {
    const level = new Level(areas.forest1);
    level.setRoomGates('r1', true);
    const r1 = level.rooms.find((r) => r.def.id === 'r1')!;
    const cx = (r1.rect.minX + r1.rect.maxX) / 2;
    const cz = (r1.rect.minZ + r1.rect.maxZ) / 2;
    expect([...reachableRooms(level, cx, cz)]).toEqual(['r1']);
  });

  it('scenery does not intersect: clutter, trees, gates and features keep their distance', () => {
    const level = new Level(areas.forest1);
    const clutter = level.solidClutter;
    expect(clutter.length).toBeGreaterThan(10);
    for (let i = 0; i < clutter.length; i++) {
      for (let k = i + 1; k < clutter.length; k++) {
        const a = clutter[i];
        const b = clutter[k];
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(a.r + b.r);
      }
    }
    const gates = level.gates.map((g) => [((g.tiles[0][0] + g.tiles[1][0]) / 2 + 0.5) * TILE, ((g.tiles[0][1] + g.tiles[1][1]) / 2 + 0.5) * TILE]);
    // Every collider (trunks, rocks, stumps) stays clear of doorways and features.
    for (const t of level.trees) {
      for (const [gx, gz] of gates) expect(Math.hypot(t.x - gx, t.z - gz)).toBeGreaterThan(3);
      for (const f of level.features) expect(Math.hypot(t.x - f.x, t.z - f.z)).toBeGreaterThan(2);
      for (const b of level.boxSpots) expect(Math.hypot(t.x - b.x, t.z - b.z)).toBeGreaterThan(t.r + 0.5);
      expect(level.isSolidAt(t.x, t.z)).toBe(false); // inside the walkable area, not embedded in a wall
    }
  });

  it('features and box spots are on open floor', () => {
    const level = new Level(areas.forest1);
    for (const f of level.features) expect(level.isSolidAt(f.x, f.z)).toBe(false);
    for (const b of level.boxSpots) expect(level.isSolidAt(b.x, b.z)).toBe(false);
  });
});

describe('Equipment comparison', () => {
  it('previews a stronger weapon as a gain without changing the character', () => {
    const ch = Character.create('T', 'hunter');
    const before = JSON.stringify(ch.data);
    const better = makeItem('saber_2', { grind: 3, attrs: { native: 20 } });
    const c = compareEquip(ch, better)!;
    expect(c.slot).toBe('weapon');
    expect(c.current?.id).toBe('saber_1');
    const atp = c.rows.find((r) => r.label === 'ATP')!;
    expect(atp.delta).toBeGreaterThan(0);
    expect(c.rows.some((r) => r.label.startsWith('Native') && r.delta === 20)).toBe(true);
    expect(gearVerdict(ch, better)).toBe(1);
    expect(JSON.stringify(ch.data)).toBe(before);
  });

  it('compares armour by DFP, EVP and line bonuses, and the equipped item is neutral', () => {
    const ch = Character.create('T', 'ranger');
    const frame = makeItem('frame_combat_3');
    const c = compareEquip(ch, frame)!;
    expect(c.slot).toBe('frame');
    expect(c.rows.map((r) => r.label)).toEqual(['DFP', 'EVP', 'ATP', 'ATA']);
    expect(c.rows[0].delta).toBeGreaterThan(0);
    expect(gearVerdict(ch, ch.equippedItem('frame')!)).toBe(0);
    expect(compareEquip(ch, makeItem('telepipe'))).toBeNull();
    expect(compareEquip(ch, makeItem('mate_2'))).toBeNull();
  });
});

describe('Drop verdicts (ground look and pickup note)', () => {
  const wielding = (id: string, extra = {}) => {
    const ch = Character.create('T', 'hunter');
    ch.addXp(100000);
    const w = makeItem(id, extra);
    ch.addItem(w);
    expect(ch.equip(w.uid).ok).toBe(true);
    return ch;
  };

  it('marks gear the class can never use as junk', () => {
    expect(dropVerdict(Character.create('T', 'hunter'), makeItem('rod_1'))).toEqual({ look: 'junk', mark: 'no', note: "Hunters can't use Rods" });
    expect(dropVerdict(Character.create('T', 'force'), makeItem('frame_guard_1')).note).toBe("Forces can't wear Guard armor");
  });

  it('flags an equippable upgrade, and junks downgrades and copies', () => {
    const ch = wielding('saber_1');
    const up = dropVerdict(ch, makeItem('saber_2'));
    expect(up.look).toBe('upgrade');
    expect(up.mark).toBe('up');
    expect(up.note).toMatch(/^ATP \+\d+/);
    const strong = wielding('saber_2');
    const down = dropVerdict(strong, makeItem('saber_1'));
    expect(down).toMatchObject({ look: 'junk', mark: 'down' });
    expect(down.note).toMatch(/^Downgrade: ATP −\d+/);
    expect(dropVerdict(ch, makeItem('saber_1'))).toEqual({ look: 'junk', mark: 'same', note: 'Same as equipped' });
  });

  it('keeps a weaker weapon with something new (a special) as a plain sidegrade', () => {
    const v = dropVerdict(wielding('saber_2'), makeItem('saber_1', { special: 'heat' }));
    expect(v).toMatchObject({ look: 'plain', mark: 'down' });
    expect(v.note).toContain('+Heat');
  });

  it('never junks an upgrade for an unmet requirement', () => {
    const v = dropVerdict(Character.create('T', 'hunter'), makeItem('saber_5'));
    expect(v.look).toBe('plain');
    expect(v.mark).toBe('no');
    expect(v.note).toMatch(/^Needs ATP \d+ \(you have \d+\) · ATP \+/);
    expect(dropVerdict(Character.create('T', 'hunter'), makeItem('mate_5'))).toMatchObject({ look: 'plain', mark: 'no' });
    expect(dropVerdict(Character.create('T', 'hunter'), makeItem('monogrinder'))).toEqual({ look: 'plain', mark: '', note: '' });
  });
});

describe('Armor lines', () => {
  it('locks lines by class and by stat, like weapons', () => {
    const force = Character.create('T', 'force');
    expect(force.canEquip(makeItem('frame_guard_1')).ok).toBe(false); // class
    expect(force.canEquip(makeItem('frame_psy_1')).ok).toBe(true);
    expect(force.canEquip(makeItem('frame_psy_2')).ok).toBe(false); // MST 60 < 80
    expect(Character.create('T', 'hunter').canEquip(makeItem('frame_psy_1')).ok).toBe(false);
  });

  it('lets each class wear its own line at the level the old armor needed', () => {
    const own = { hunter: 'guard', ranger: 'combat', force: 'psy' } as const;
    for (const cls of CLASSES) {
      for (const [tier, level] of [[2, 6], [3, 12], [4, 20]]) {
        const ch = Character.create('T', cls);
        while (ch.level < level - 1) ch.addXp(xpToNext(ch.level));
        expect(ch.canEquip(makeItem(`frame_${own[cls]}_${tier}`)).ok).toBe(false);
        ch.addXp(xpToNext(ch.level));
        expect(ch.canEquip(makeItem(`frame_${own[cls]}_${tier}`)).ok).toBe(true);
      }
    }
  });

  it('adds line bonuses to total stats (and TP to max TP) but not to requirements', () => {
    const ch = Character.create('T', 'force');
    const psy = makeItem('frame_psy_1');
    ch.addItem(psy);
    const before = ch.stats();
    expect(ch.equip(psy.uid).ok).toBe(true);
    expect(ch.stats().mst).toBe(before.mst + 6);
    expect(ch.maxTp).toBe(before.tp + 5);
    expect(ch.reqStats().mst).toBe(ch.baseStats().mst);
  });

  it('rates the class line above another wearable line of the same tier', () => {
    const hunter = Character.create('T', 'hunter');
    hunter.addXp(100000);
    const guard = makeItem('frame_guard_2');
    hunter.addItem(guard);
    hunter.equip(guard.uid);
    expect(gearVerdict(hunter, makeItem('frame_combat_2'))).toBe(-1);
  });

  it('migrates old single-line armor to the class line', () => {
    const ch = Character.create('T', 'force');
    ch.data.inventory.push({ uid: 'old', id: 'frame_3' }, { uid: 'old2', id: 'barrier_2' });
    const loaded = new Character(JSON.parse(JSON.stringify(ch.data)));
    expect(loaded.find('old')!.id).toBe('frame_psy_3');
    expect(loaded.find('old2')!.id).toBe('barrier_psy_2');
  });

  it('halves race % on older saves once, keeping Hit %', () => {
    const ch = Character.create('T', 'force');
    ch.data.version = 1;
    ch.data.inventory.push(makeItem('rod_7', { attrs: { abeast: 85, machine: 60, native: 5, hit: 10 } }));
    const uid = ch.data.inventory.at(-1)!.uid;
    const once = new Character(JSON.parse(JSON.stringify(ch.data)));
    expect(once.find(uid)!.attrs).toEqual({ abeast: 45, machine: 30, native: 5, hit: 10 });
    const twice = new Character(JSON.parse(JSON.stringify(once.data)));
    expect(twice.find(uid)!.attrs).toEqual({ abeast: 45, machine: 30, native: 5, hit: 10 });
  });

  it('rolls race % from 5 up to 5 + 5 per tier', () => {
    const rng = mulberry32(3);
    for (const tier of [1, 4, 8]) {
      let top = 0;
      for (let i = 0; i < 2000; i++) {
        for (const [a, v] of Object.entries(rollWeapon(tier, rng).attrs ?? {})) {
          if (a === 'hit' || !v) continue;
          expect(v % 5).toBe(0);
          top = Math.max(top, v);
        }
      }
      expect(top).toBe(5 + tier * 5);
    }
  });

  it('stocks every line in the armor shop', () => {
    const stock = shopStock('armor', 12, 'hunter', mulberry32(1)).map((i) => i.id);
    for (const line of ['guard', 'combat', 'psy']) expect(stock).toContain(`frame_${line}_3`);
  });
});
