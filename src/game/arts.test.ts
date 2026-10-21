import { describe, expect, it } from 'vitest';
import { ART_SLOTS, Character, makeItem } from './character';
import { basicAttack, magCfg } from './config';
import { ART_IDS, ARTS, SUPPORT_ARTS } from './data/arts';
import { grantArts } from './skills';
import { BARE_KIND, weaponKinds, type WeaponKind } from './data/items';
import { statsAtLevel } from './data/stats';
import { ATTACK_TECHS, techniques, techTpCost, TECH_IDS } from './data/techniques';

/** A character at `level` with every Art open there at rank 1, holding a weapon of `kind` (tier 1) if given. */
function holding(level: number, kind?: WeaponKind): Character {
  const ch = Character.create('T');
  ch.data.level = level;
  grantArts(level, ch.data.skills, 1);
  if (kind) {
    const w = makeItem(`${kind}_1`);
    ch.data.inventory.push(w);
    ch.data.equipped.weapon = w.uid;
  }
  return ch;
}

describe('Arts data (2026-10-14)', () => {
  it('are the techniques, each with two rows of three modifiers', () => {
    expect([...ART_IDS].sort()).toEqual([...TECH_IDS].sort());
    for (const id of ART_IDS) {
      const a = ARTS[id];
      expect(a.level, id).toBe(techniques[id].level);
      expect(a.windup, id).toBe(techniques[id].castTime);
      expect(a.mods, id).toHaveLength(2);
      for (const row of a.mods) {
        expect(row, id).toHaveLength(3);
        expect(new Set(row.map((m) => m.id)).size).toBe(3);
      }
    }
  });

  it('make the attack techniques attacks and Resta the one support Art (no Shifta or Deband since 2026-10-15)', () => {
    for (const t of ATTACK_TECHS) expect(ARTS[t].role, t).not.toBe('support');
    expect(SUPPORT_ARTS).toEqual(['resta']);
    expect(ARTS.resta).toMatchObject({ role: 'support', pose: 'support' });
    expect(Object.keys(techniques)).not.toContain('shifta');
  });
});

describe('the Art bar', () => {
  it("fills a new character's bar with what it knows: Foie, and every Lv 1 technique once learned", () => {
    expect(Character.create('T').artBar()).toEqual(['foie', null, null, null]);
    expect(holding(1).artBar()).toEqual(['foie', 'zonde', 'barta', 'resta']);
  });

  it('fills an untouched bar in unlock order, so a slot never moves as Arts are learned', () => {
    const ch = Character.create('T');
    const seen: (string | null)[][] = [[...ch.artBar()]];
    for (const [lv, id] of [[2, 'barta'], [12, 'gibarta'], [15, 'gifoie'], [28, 'rabarta']] as const) {
      ch.data.level = lv;
      expect(ch.rankUp(id)).toBeNull();
      seen.push([...ch.artBar()]);
    }
    expect(seen[1]).toEqual(['foie', 'barta', null, null]);
    expect(seen[3]).toEqual(['foie', 'barta', 'gibarta', 'gifoie']);
    // A full bar takes nothing more by itself.
    expect(seen.at(-1)).toEqual(seen[3]);
    for (let i = 1; i < seen.length; i++) seen[i - 1].forEach((id, s) => id && expect(seen[i][s]).toBe(id));
    expect(ch.data.arts.bar).toBeUndefined(); // reading the bar never stores it
  });

  it('keeps one bar whatever weapon is in hand', () => {
    const ch = holding(30, 'rod');
    expect(ch.setArtSlot(0, 'gizonde')).toBeNull();
    const bar = [...ch.artBar()];
    const wand = makeItem('wand_1');
    ch.data.inventory.push(wand);
    ch.data.equipped.weapon = wand.uid;
    expect(ch.artBar()).toEqual(bar);
    expect(ch.artsFor()).toEqual(['foie', 'zonde', 'barta', 'gibarta', 'gifoie', 'gizonde', 'rabarta', 'resta']);
  });

  it('slots only learned Arts, swapping one already on the bar', () => {
    const ch = holding(30, 'rod');
    expect(ch.setArtSlot(0, 'rafoie')).not.toBeNull(); // opens at Lv 36
    delete ch.data.skills.ranks.gizonde;
    expect(ch.setArtSlot(0, 'gizonde')).toMatch(/isn't learned/);
    const bar = [...ch.artBar()];
    expect(ch.setArtSlot(3, bar[0])).toBeNull();
    expect(ch.artBar()[3]).toBe(bar[0]);
    expect(ch.artBar()[0]).toBe(bar[3]);
    expect(ch.setArtSlot(ART_SLOTS, 'foie')).not.toBeNull();
    expect(ch.data.arts.bar).toEqual(ch.artBar());
  });

  it('a changed bar takes a newly learned Art into its first empty slot, and loses one taken back to rank 0', () => {
    const ch = holding(30, 'rod');
    expect(ch.artBar()).toEqual(['foie', 'zonde', 'barta', 'resta']);
    ch.setArtSlot(3, null);
    ch.setArtSlot(1, null); // the player took these off
    ch.data.level = 36;
    expect(ch.rankUp('rafoie')).toBeNull();
    expect(ch.artBar()).toEqual(['foie', 'rafoie', 'barta', null]);
    expect(ch.rankDown('rafoie')).toBeNull();
    expect(ch.artBar()).toEqual(['foie', null, 'barta', null]);
  });

  it('bare hands still cast everything learned, with a weak bolt and no technique boost', () => {
    const wand = holding(30, 'wand');
    const bare = holding(30, 'wand');
    bare.data.equipped.weapon = undefined;
    expect(bare.weaponKind()).toBe(BARE_KIND);
    expect(bare.artsFor()).toEqual(wand.artsFor());
    expect(bare.techDamage('foie')).toBeLessThan(wand.techDamage('foie'));
    expect(bare.boltDamage()).toBeGreaterThan(0);
    expect(bare.boltDamage()).toBeLessThan(wand.boltDamage());
  });
});

describe('Art numbers', () => {
  it('cost techniques their own TP (rising with tech damage); base TP follows the level', () => {
    const ch = holding(50, 'rod');
    expect(ch.baseTp()).toBe(statsAtLevel(50).tp);
    expect(ch.artCost('foie')).toBe(ch.techCost('foie'));
    const higher = holding(90, 'rod');
    expect(higher.artCost('foie')).toBeGreaterThan(ch.artCost('foie'));
  });

  it('modifiers (nodes forking below the Art) open at its ranks 5 and 10 and change numbers', () => {
    const ch = holding(40, 'rod');
    expect(ch.rankUp('rafoie:cataclysm')).toMatch(/rank 5/);
    ch.data.skills.ranks.rafoie = 5;
    expect(ch.rankUp('rafoie:cataclysm')).toBeNull();
    expect(ch.artMod('rafoie', 'cataclysm')).toBe(true);
    expect(ch.rankUp('rafoie:twin')).toMatch(/One per row/);
    expect(ch.rankUp('rafoie:efficient')).toMatch(/rank 10/);
    ch.data.skills.ranks.rafoie = 10;
    expect(ch.rankUp('rafoie:efficient')).toBeNull();
    expect(ch.artCost('rafoie')).toBe(Math.round(techTpCost('rafoie', ch.stats().mst) * 0.75 * ch.artRankTp('rafoie')));
    expect(ch.rankDown('rafoie')).toMatch(/Efficient/); // it rests on rank 10
    expect(ch.rankDown('rafoie:cataclysm')).toMatch(/Efficient/); // and on a first-row modifier
    const g = holding(40, 'rod');
    g.data.skills.ranks.gifoie = 10;
    expect(g.rankUp('gifoie:inferno')).toBeNull();
    const before = g.artTiming('gifoie');
    expect(g.rankUp('gifoie:quick')).toBeNull();
    expect(g.artTiming('gifoie').windup).toBeCloseTo(before.windup * 0.7);
    expect(g.artTiming('gifoie').recovery).toBeCloseTo(before.recovery * 0.7);
  });

  it('time techniques by cast speed (Swift Cast and Haste), and the bolt by Haste', () => {
    const f = holding(80, 'rod');
    const windup = f.artTiming('foie').windup;
    const bolt = f.basicTiming().windup;
    f.data.skills.ranks.swiftCast = 5;
    expect(f.artTiming('foie').windup).toBeLessThan(windup);
    expect(f.basicTiming().windup).toBe(bolt);
    const swift = f.artTiming('foie').windup;
    f.weaponInstance()!.affixes = [{ id: 'haste', v: 10 }];
    expect(f.artTiming('foie').windup).toBeCloseTo(swift / 1.1);
    expect(f.basicTiming().windup).toBeCloseTo(bolt / 1.1);
  });

  it('make the basic step a photon bolt (the Wand refills more TP, the Rod hits harder)', () => {
    expect(weaponKinds.wand.tpRefill).toBeGreaterThan(weaponKinds.rod.tpRefill);
    expect(weaponKinds.rod.boltPower).toBeGreaterThan(weaponKinds.wand.boltPower);
    const rod = holding(30, 'rod');
    expect(rod.boltDamage()).toBeGreaterThan(0);
    expect(rod.boltDamage()).toBeGreaterThan(holding(30, 'wand').boltDamage());
    expect(basicAttack.tpRefill).toBeGreaterThan(0);
  });

  it('teach the photon blast through the Mag from its level', () => {
    const ch = holding(magCfg.pbLevel - 1);
    ch.data.photonBlast = 'mylla';
    expect(ch.photonBlast).toBeNull();
    ch.data.level = magCfg.pbLevel;
    expect(ch.photonBlast).toBe('mylla');
  });
});
