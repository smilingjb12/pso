import { describe, expect, it } from 'vitest';
import { Character, compareEquip, dropVerdict, gearVerdict, grindPreview, itemName, makeItem } from './character';
import { enemies, techScaling } from './config';
import { areas } from './data/areas';
import { xpToNext, type AttributeId, type KitId } from './data/stats';
import { getDef, grindCap, INVENTORY_SIZE, itemDefs, MAX_STACK, weaponKinds } from './data/items';
import { buffPct, restaHeal } from './data/techniques';
import { rollDragonDrops, rollDrop, rollEliteBonus, rollEnemyDrop, rollFalzDrops, rollWardenDrops, rollWeapon, shopStock, shopTier, type LootBias } from './loot';
import { Level, mulberry32, TILE } from './world/Level';

const KIT_IDS: KitId[] = ['vanguard', 'ranger', 'mystic'];
const BIASES: LootBias[] = ['atp', 'ata', 'mst'];

/** Points spent the way the old classes grew: Mystic all MIND, Vanguard two POW to one DEF, Ranger two DEX to one POW. */
const OLD_CLASS: Record<KitId, AttributeId[]> = { mystic: ['mind', 'mind', 'mind'], vanguard: ['pow', 'pow', 'def'], ranger: ['dex', 'dex', 'pow'] };
function spendLikeOldClass(ch: Character): Character {
  for (let i = 0; ch.attributePoints > 0; i++) ch.spendAttribute(OLD_CLASS[ch.data.kit][i % 3]);
  return ch;
}

describe('Character', () => {
  it('starts every kit with a usable weapon equipped', () => {
    for (const cls of KIT_IDS) {
      const ch = Character.create('T', cls);
      const w = ch.weaponInstance();
      expect(w).toBeDefined();
      expect(ch.canEquip(w!).ok).toBe(true);
      expect(ch.maxHp).toBeGreaterThan(0);
    }
  });

  it('levels up and carries over excess XP', () => {
    const ch = Character.create('T', 'vanguard');
    const hp1 = ch.maxHp;
    const gained = ch.addXp(xpToNext(1) + xpToNext(2) + 5);
    expect(gained).toBe(2);
    expect(ch.level).toBe(3);
    expect(ch.data.xp).toBe(5);
    expect(ch.maxHp).toBeGreaterThan(hp1);
  });

  it('stacks consumables up to the cap, one stack per type', () => {
    const ch = Character.create('T', 'vanguard');
    const start = ch.countOf('telepipe');
    expect(ch.addItem(makeItem('telepipe', { qty: MAX_STACK - start }))).toBe(true);
    expect(ch.countOf('telepipe')).toBe(MAX_STACK);
    expect(ch.addItem(makeItem('telepipe'))).toBe(false);
  });

  it('respects inventory capacity for non-stackables', () => {
    const ch = Character.create('T', 'vanguard');
    while (ch.data.inventory.length < INVENTORY_SIZE) expect(ch.addItem(makeItem('saber_1'))).toBe(true);
    expect(ch.addItem(makeItem('saber_1'))).toBe(false);
  });

  it('has no classes: only stat requirements decide gear', () => {
    const ch = Character.create('T', 'mystic');
    expect(ch.canEquip(makeItem('sword_1')).ok).toBe(true);
    expect(ch.canEquip(makeItem('rifle_1')).ok).toBe(true);
    const hunter = Character.create('T', 'vanguard');
    expect(hunter.canEquip(makeItem('saber_3')).ok).toBe(false); // ATP req
    hunter.addXp(100000);
    spendLikeOldClass(hunter);
    expect(hunter.canEquip(makeItem('saber_3')).ok).toBe(true);
  });

  it('earns three attribute points a level, spent for good', () => {
    const ch = Character.create('T', 'vanguard');
    expect(ch.attributePoints).toBe(0);
    expect(ch.spendAttribute('pow')).toMatch(/No attribute points/);
    ch.addXp(xpToNext(1) + xpToNext(2));
    expect(ch.attributePoints).toBe(6);
    const before = ch.baseStats();
    expect(ch.spendAttribute('mind', 4)).toBeNull();
    expect(ch.attributePoints).toBe(2);
    expect(ch.baseStats().mst).toBe(before.mst + 4);
    expect(ch.spendAttribute('mind', 3)).not.toBeNull();
    expect(ch.data.attributes.mind).toBe(4);
  });

  it('names the character after the attribute with the most points (the kit on a tie)', () => {
    const ch = Character.create('T', 'mystic');
    expect(ch.title).toBe('Mystic');
    ch.data.level = 5;
    ch.spendAttribute('def', 2);
    expect(ch.title).toBe('Guardian');
    ch.spendAttribute('mind', 2);
    expect(ch.title).toBe('Mystic');
    ch.spendAttribute('pow', 3);
    expect(ch.title).toBe('Vanguard');
  });

  it('grows like the old classes when points go the same way', () => {
    const at = (kit: KitId, level: number) => {
      const ch = Character.create('T', kit);
      ch.data.level = level;
      return spendLikeOldClass(ch).baseStats();
    };
    // The old classes' growth per level (Lv 31 = 30 levels of it).
    expect(at('mystic', 31)).toMatchObject({ hp: 70 + 7.5 * 30, tp: 80 + 6 * 30, atp: 25 + 2.2 * 30, dfp: 10 + 1.3 * 30, mst: 60 + 4 * 30, ata: 45 + 30 });
    expect(at('vanguard', 31)).toMatchObject({ hp: 120 + 14 * 30, tp: 30 + 2 * 30, atp: 40 + 4 * 30, dfp: 24 + 3 * 30, mst: 15 + 30, ata: 50 + 1.2 * 30 });
    expect(at('ranger', 31)).toMatchObject({ hp: 105 + 12 * 30, atp: 32 + 3.4 * 30, dfp: 16 + 2.2 * 30, ata: 70 + 1.8 * 30 });
  });

  it('refunds every point when the build rules change (BUILD_VERSION)', () => {
    const ch = Character.create('T', 'vanguard');
    ch.data.level = 10;
    ch.spendAttribute('pow', 9);
    ch.mag.cells = ['0,-1'];
    const data = JSON.parse(JSON.stringify(ch.data));
    expect(new Character(JSON.parse(JSON.stringify(data))).refunded).toBe(false);
    data.build = 0;
    const loaded = new Character(data);
    expect(loaded.refunded).toBe(true);
    expect(loaded.attributePoints).toBe(27);
    expect(loaded.mag.cells).toEqual([]);
  });

  it('grinds weapons and consumes the grinder (Edge by default)', () => {
    const ch = Character.create('T', 'vanguard');
    const g = makeItem('digrinder');
    ch.addItem(g);
    const w = ch.weaponInstance()!;
    const [lo] = ch.weaponAtp();
    expect(ch.grind(w.uid, g.uid).ok).toBe(true);
    expect(w.grind).toBe(2);
    // Saber 40-55: 4% of the average ATP per level.
    expect(ch.weaponAtp()[0]).toBe(lo + 4);
    expect(ch.countOf('digrinder')).toBe(0);
  });

  it('Edge raises a share of every stat the weapon has: MST only on caster weapons', () => {
    const force = Character.create('T', 'mystic');
    const cane = force.weaponInstance()!; // Cane: ATP 25-35, ATA 30, MST 4
    const before = force.stats();
    const [lo] = force.weaponAtp();
    cane.grind = 4;
    expect(force.weaponAtp()[0]).toBe(lo + 5);
    expect(force.stats().ata).toBe(before.ata + 5);
    expect(force.stats().mst).toBe(before.mst + 2);
    const hunter = Character.create('T', 'vanguard');
    const mst = hunter.stats().mst;
    hunter.weaponInstance()!.grind = 4;
    expect(hunter.stats().mst).toBe(mst);
  });

  it('weapons take 5-9 grind levels by tier, rares 2 more', () => {
    expect([1, 2, 3, 5, 7, 9].map((tier) => grindCap({ tier }))).toEqual([5, 5, 6, 7, 8, 9]);
    expect(grindCap(itemDefs.red_saber as { tier: number; rare?: boolean })).toBe(7);
  });

  it('race levels add 5% each against that race, leave the stats alone, and mix freely', () => {
    const ch = Character.create('T', 'vanguard');
    const w = makeItem('saber_5'); // race cap 30%, 7 levels
    ch.addItem(w);
    ch.data.equipped.weapon = w.uid; // past the ATP requirement
    const atp = ch.weaponAtp();
    const grind = (track: Parameters<Character['grind']>[2]) => {
      const g = makeItem('monogrinder');
      ch.addItem(g);
      return ch.grind(w.uid, g.uid, track);
    };
    expect(grind('machine').ok).toBe(true);
    expect(grind('machine').ok).toBe(true);
    expect(grind('dark').ok).toBe(true);
    expect(grind('edge').ok).toBe(true);
    expect(w.grind).toBe(4);
    expect(w.bane).toEqual({ machine: 2, dark: 1 });
    expect(ch.weaponAttr('machine')).toBe(10);
    expect(ch.weaponAttr('dark')).toBe(5);
    expect(ch.weaponAttr('abeast')).toBe(0);
    // Only the one Edge level moved ATP.
    expect(ch.weaponAtp()[0] - atp[0]).toBe(Math.round(0.04 * ((176 + 242) / 2)));
    expect(itemName(w)).toBe('Gladius +4');
  });

  it('a race stops at the tier cap counting the rolled %, and the total stops at the grind cap', () => {
    // Tier 3: race cap 20%, 6 levels. A 15% Machine roll leaves room for one Machine level.
    const w = makeItem('saber_3', { attrs: { machine: 15 } });
    expect(grindPreview(w, 'machine', 3)).toMatchObject({ levels: 1, wasted: 2 });
    w.grind = 1;
    w.bane = { machine: 1 };
    const full = grindPreview(w, 'machine', 1);
    expect(full.levels).toBe(0);
    expect(full.reason).toContain('cap (20%)');
    expect(itemName(w)).toBe('Buster of Machines +1');
    expect(grindPreview(w, 'native', 3).levels).toBe(3);
    w.grind = 6;
    expect(grindPreview(w, 'edge', 1)).toMatchObject({ levels: 0, reason: 'Fully ground' });
    // A Trigrinder with one level of room adds one and loses two.
    w.grind = 5;
    expect(grindPreview(w, 'edge', 3)).toMatchObject({ levels: 1, wasted: 2 });
    // The preview never touches the weapon itself.
    expect(w.grind).toBe(5);
  });

  it('knows every technique from the start; MST alone decides how strong they are', () => {
    const at42 = (kit: KitId) => {
      const ch = Character.create('T', kit);
      ch.data.level = 42;
      return spendLikeOldClass(ch);
    };
    const h = at42('vanguard');
    const f = at42('mystic');
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
      for (const it of shopStock('item', lv, 'mst', rng, { derolle: true, warden: true })) expect(it.id.startsWith('disk_')).toBe(false);
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
      for (const d of rollWardenDrops(rng, BIASES[i % 3])) {
        if (d.kind !== 'item') continue;
        const def = getDef(d.item.id);
        if (def.id === 'warden_core' || def.id === 'arc_welder') sig.add(def.id);
        else if (!def.rare && (def.type === 'weapon' || def.type === 'armor')) expect(def.tier).toBeGreaterThanOrEqual(5);
      }
    }
    expect([...sig].sort()).toEqual(['arc_welder', 'warden_core']);
  });

  it('shops stock tier 6 only after the Warden, from Lv 32', () => {
    expect(shopTier(40, { derolle: true })).toBe(5);
    expect(shopTier(31, { derolle: true, warden: true })).toBe(5);
    expect(shopTier(32, { derolle: true, warden: true })).toBe(6);
    const rng = mulberry32(14);
    for (const kind of ['weapon', 'armor', 'item'] as const) {
      for (const item of shopStock(kind, 35, 'atp', rng, { derolle: true, warden: true })) expect(() => getDef(item.id)).not.toThrow();
    }
  });

  it('Ruins enemies drop tiers 5-7, and Dark Falz tier 6-7 gear and its signature items', () => {
    const rng = mulberry32(15);
    const tiers = new Set<number>();
    for (const arch of Object.values(enemies).filter((a) => a.dropTier === 7)) {
      expect(arch.race).toBe('dark');
      for (let i = 0; i < 2000; i++) {
        const d = i % 2 ? rollEnemyDrop(arch, rng) : rollEliteBonus(arch, rng);
        if (d?.kind !== 'item') continue;
        const def = getDef(d.item.id);
        if (def.type === 'injector') expect(def.tier).toBeLessThanOrEqual(5);
        if (!def.rare && (def.type === 'weapon' || def.type === 'armor')) tiers.add(def.tier);
      }
    }
    expect([...tiers].sort()).toEqual([5, 6, 7]);
    const sig = new Set<string>();
    for (let i = 0; i < 400; i++) {
      for (const d of rollFalzDrops(rng, BIASES[i % 3])) {
        if (d.kind !== 'item') continue;
        const def = getDef(d.item.id);
        if (def.id === 'dark_flow' || def.id === 'seal_of_light') sig.add(def.id);
        else if (!def.rare && (def.type === 'weapon' || def.type === 'armor')) expect(def.tier).toBeGreaterThanOrEqual(6);
      }
    }
    expect([...sig].sort()).toEqual(['dark_flow', 'seal_of_light']);
  });

  it('only ever produces valid items', () => {
    const rng = mulberry32(42);
    for (let i = 0; i < 3000; i++) {
      const d = rollDrop(2, 0.05, rng, BIASES[i % 3]);
      if (d.kind === 'item') expect(itemDefs[d.item.id]).toBeDefined();
      else if (d.kind === 'meseta') expect(d.amount).toBeGreaterThan(0);
    }
    for (const arch of Object.values(enemies)) {
      for (let i = 0; i < 200; i++) {
        const d = rollEnemyDrop(arch, rng);
        if (d?.kind === 'item') expect(itemDefs[d.item.id]).toBeDefined();
      }
    }
    expect(rollDragonDrops(rng).length).toBeGreaterThan(3);
  });

  it("weapon shop stocks weapons of the player's weapon stat", () => {
    const rng = mulberry32(7);
    for (const bias of BIASES) {
      const stock = shopStock('weapon', 1, bias, rng);
      const own = stock.filter((s) => {
        const def = getDef(s.id);
        return def.type === 'weapon' && weaponKinds[def.kind].reqStat === bias;
      });
      expect(own.length).toBeGreaterThan(0);
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

describe('Item names', () => {
  it('prefixes a rolled special and suffixes the best race once it reaches half the tier cap', () => {
    // Tier 3 (Buster) caps race % at 20, so 10% is enough for the suffix.
    expect(itemName(makeItem('saber_3', { special: 'heat', attrs: { abeast: 10, native: 5, hit: 15 }, grind: 3 }))).toBe('Heat Buster of Beasts +3');
    expect(itemName(makeItem('saber_3', { attrs: { machine: 5, hit: 15 } }))).toBe('Buster');
    expect(itemName(makeItem('saber_8', { attrs: { dark: 20 } }))).toBe('Nova Blade');
    expect(itemName(makeItem('saber_8', { attrs: { dark: 25, machine: 25 } }))).toBe('Nova Blade of Machines');
    expect(itemName(makeItem('saber_8', { attrs: { native: 25, machine: 25 } }))).toBe('Nova Blade of Natives');
  });

  it("keeps a rare's own special out of the name but still names its race", () => {
    expect(itemName(makeItem('red_saber', { special: 'heat', attrs: { machine: 10 }, grind: 2 }))).toBe('Red Saber of Machines +2');
  });

  it('names injector mods and stacks as before', () => {
    expect(itemName(makeItem('fluid_4', { mod: 'steady' }))).toBe('Steady Star Fluid Injector');
    expect(itemName(makeItem('monogrinder', { qty: 3 }))).toBe('Monogrinder x3');
  });
});

describe('Equipment comparison', () => {
  it('previews a stronger weapon as a gain without changing the character', () => {
    const ch = Character.create('T', 'vanguard');
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
    const ch = Character.create('T', 'vanguard');
    ch.addXp(100000);
    spendLikeOldClass(ch);
    const w = makeItem(id, extra);
    ch.addItem(w);
    expect(ch.equip(w.uid).ok).toBe(true);
    return ch;
  };

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
    const v = dropVerdict(Character.create('T', 'vanguard'), makeItem('saber_5'));
    expect(v.look).toBe('plain');
    expect(v.mark).toBe('no');
    expect(v.note).toMatch(/^Needs ATP \d+ \(you have \d+\) · ATP \+/);
    expect(dropVerdict(Character.create('T', 'vanguard'), makeItem('mate_5'))).toMatchObject({ look: 'plain', mark: 'no' });
    expect(dropVerdict(Character.create('T', 'vanguard'), makeItem('monogrinder'))).toEqual({ look: 'plain', mark: '', note: '' });
  });
});

describe('Armor lines', () => {
  it('locks lines by stat only, like weapons', () => {
    const force = Character.create('T', 'mystic');
    expect(force.canEquip(makeItem('frame_guard_1')).ok).toBe(true);
    expect(force.canEquip(makeItem('frame_psy_1')).ok).toBe(true);
    expect(force.canEquip(makeItem('frame_psy_2')).ok).toBe(false); // MST 60 < 80
    expect(Character.create('T', 'vanguard').canEquip(makeItem('frame_psy_1')).ok).toBe(true);
    expect(Character.create('T', 'vanguard').canEquip(makeItem('frame_psy_2')).ok).toBe(false);
  });

  it("reaches a line's tiers at the old class levels when points follow the old class", () => {
    const own = { vanguard: 'guard', ranger: 'combat', mystic: 'psy' } as const;
    for (const kit of KIT_IDS) {
      for (const [tier, level] of [[2, 6], [3, 12], [4, 20]]) {
        const ch = Character.create('T', kit);
        while (ch.level < level - 1) ch.addXp(xpToNext(ch.level));
        spendLikeOldClass(ch);
        expect(ch.canEquip(makeItem(`frame_${own[kit]}_${tier}`)).ok).toBe(false);
        ch.addXp(xpToNext(ch.level));
        spendLikeOldClass(ch);
        expect(ch.canEquip(makeItem(`frame_${own[kit]}_${tier}`)).ok).toBe(true);
      }
    }
  });

  it('adds line bonuses to total stats (and TP to max TP) but not to requirements', () => {
    const ch = Character.create('T', 'mystic');
    const psy = makeItem('frame_psy_1');
    ch.addItem(psy);
    const before = ch.stats();
    expect(ch.equip(psy.uid).ok).toBe(true);
    expect(ch.stats().mst).toBe(before.mst + 6);
    expect(ch.maxTp).toBe(before.tp + 5);
    expect(ch.reqStats().mst).toBe(ch.baseStats().mst);
  });

  it('rates the Guard line above another wearable line of the same tier for a fighter', () => {
    const hunter = Character.create('T', 'vanguard');
    hunter.addXp(100000);
    spendLikeOldClass(hunter);
    const guard = makeItem('frame_guard_2');
    hunter.addItem(guard);
    hunter.equip(guard.uid);
    expect(gearVerdict(hunter, makeItem('frame_combat_2'))).toBe(-1);
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
    const stock = shopStock('armor', 12, 'atp', mulberry32(1)).map((i) => i.id);
    for (const line of ['guard', 'combat', 'psy']) expect(stock).toContain(`frame_${line}_3`);
  });
});
