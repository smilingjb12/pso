import { describe, expect, it } from 'vitest';
import { ART_SLOTS, Character, makeItem } from './character';
import { basicAttack, magCfg } from './config';
import { ART_IDS, artClasses, ARTS, isTechArt } from './data/arts';
import { grantArts } from './skills';
import { weaponKinds, type WeaponKind } from './data/items';
import { CLASS_IDS, statsAtLevel, CLASSES } from './data/stats';
import { ATTACK_TECHS, techniques } from './data/techniques';

/** A character of `cls` at `level`, holding a weapon of `kind` (tier 1). */
function holding(cls: 'hunter' | 'ranger' | 'force', level: number, kind?: WeaponKind): Character {
  const ch = Character.create('T', cls);
  ch.data.level = level;
  grantArts(cls, level, ch.data.skills, 1);
  if (kind) {
    const w = makeItem(`${kind}_1`);
    ch.data.inventory.push(w);
    ch.data.equipped.weapon = w.uid;
  }
  return ch;
}

describe('Arts data (2026-10-14)', () => {
  it('give each weapon kind three Arts and each class three more, with two rows of three modifiers', () => {
    for (const kind of Object.keys(weaponKinds) as WeaponKind[]) {
      if (weaponKinds[kind].family === 'caster') continue;
      expect(ART_IDS.filter((id) => { const f = ARTS[id].from; return 'kind' in f && f.kind === kind; }), kind).toHaveLength(3);
    }
    for (const family of ['melee', 'ranged'] as const) {
      expect(ART_IDS.filter((id) => { const f = ARTS[id].from; return 'family' in f && f.family === family; })).toHaveLength(3);
    }
    for (const id of ART_IDS) {
      const a = ARTS[id];
      expect(a.mods, id).toHaveLength(2);
      for (const row of a.mods) {
        expect(row, id).toHaveLength(3);
        expect(new Set(row.map((m) => m.id)).size).toBe(3);
      }
      if (a.ticks) expect(a.channel, id).toBeGreaterThan(0);
    }
  });

  it('make every technique an Art: attack ones for Forces, Resta for anyone (no Shifta or Deband since 2026-10-15)', () => {
    for (const t of Object.keys(techniques)) expect(isTechArt(t as never)).toBe(true);
    for (const t of ATTACK_TECHS) expect(artClasses(t)).toEqual(['force']);
    expect(artClasses('resta')).toEqual(['hunter', 'ranger', 'force']);
    expect(Object.keys(techniques)).not.toContain('shifta');
  });
});

describe('the Art bar', () => {
  it('fills a new character\'s bar with what it can use at Lv 1', () => {
    expect(holding('hunter', 1).artBar()).toEqual(['risingEdge', 'resta', null, null]);
    expect(holding('ranger', 1).artBar()).toEqual(['rapidVolley', 'resta', null, null]);
    expect(holding('force', 1).artBar()).toEqual(['foie', 'zonde', 'barta', 'resta']);
  });

  it('fills an untouched bar in unlock order, so a slot never moves as Arts are learned', () => {
    const ch = holding('hunter', 1, 'saber');
    const seen: (string | null)[][] = [];
    for (const lv of [1, 5, 10, 12, 20, 28, 36]) {
      ch.data.level = lv;
      grantArts('hunter', lv, ch.data.skills, 1);
      seen.push([...ch.artBar()]);
    }
    expect(seen[0]).toEqual(['risingEdge', 'resta', null, null]);
    expect(seen[1]).toEqual(['risingEdge', 'resta', 'leap', null]);
    expect(seen[2]).toEqual(seen[1]);
    expect(seen.at(-1)).toEqual(['risingEdge', 'resta', 'leap', 'crescent']);
    for (let i = 1; i < seen.length; i++) seen[i - 1].forEach((id, s) => id && expect(seen[i][s]).toBe(id));
  });

  it('keeps a bar per weapon kind, with that kind\'s own Arts', () => {
    const ch = holding('hunter', 30, 'sword');
    expect(ch.barKey).toBe('sword');
    expect(ch.artBar()[0]).toBe('cyclone');
    expect(ch.artsFor()).toEqual(expect.arrayContaining(['cyclone', 'groundBreaker', 'sunder', 'leap', 'warCry', 'resta']));
    expect(ch.artsFor()).not.toContain('risingEdge');
    expect(ch.artsFor('saber')).toContain('risingEdge');
    expect(ch.artBar('saber')[0]).toBe('risingEdge');
    expect(ch.data.arts.bars).toEqual({}); // reading a bar never stores it
  });

  it('slots only usable Arts, swapping one already on the bar', () => {
    const ch = holding('hunter', 30, 'sword');
    expect(ch.setArtSlot(0, 'risingEdge')).not.toBeNull(); // a saber's
    expect(ch.setArtSlot(0, 'ironWill')).not.toBeNull(); // learned at Lv 36
    const bar = [...ch.artBar()];
    expect(ch.setArtSlot(3, bar[0])).toBeNull();
    expect(ch.artBar()[3]).toBe(bar[0]);
    expect(ch.artBar()[0]).toBe(bar[3]);
    expect(ch.setArtSlot(ART_SLOTS, 'leap')).not.toBeNull();
    expect(ch.data.arts.bars.sword).toEqual(ch.artBar());
  });

  it('a changed bar takes a newly learned Art into its first empty slot, and loses one taken back to rank 0', () => {
    const ch = holding('hunter', 30, 'sword');
    expect(ch.artBar()).toEqual(['cyclone', 'resta', 'leap', 'groundBreaker']);
    ch.setArtSlot(3, null);
    ch.setArtSlot(1, null); // the player took these off
    ch.data.level = 36;
    expect(ch.rankUp('ironWill')).toBeNull();
    expect(ch.artBar()).toEqual(['cyclone', 'ironWill', 'leap', null]);
    expect(ch.rankDown('ironWill')).toBeNull();
    expect(ch.artBar()).toEqual(['cyclone', null, 'leap', null]);
  });

  it('bare hands can only slot support techniques', () => {
    const ch = holding('hunter', 30);
    ch.data.equipped.weapon = undefined;
    expect(ch.barKey).toBe('none');
    expect(ch.artsFor()).toEqual(['resta']);
  });
});

describe('Art numbers', () => {
  it('cost weapon Arts a share of the class\'s base TP at your level, techniques their own (rising with tech damage)', () => {
    for (const cls of CLASS_IDS) {
      const ch = holding(cls, 50);
      const base = statsAtLevel(CLASSES[cls], 50).tp;
      expect(ch.baseTp()).toBe(base);
    }
    const h = holding('hunter', 50, 'saber');
    expect(h.artCost('risingEdge')).toBe(Math.round(ARTS.risingEdge.tpPct * h.baseTp()));
    const f = holding('force', 50, 'rod');
    expect(f.artCost('foie')).toBe(f.techCost('foie'));
    const f2 = holding('force', 90, 'rod');
    expect(f2.artCost('foie')).toBeGreaterThan(f.artCost('foie'));
  });

  it('modifiers (nodes forking below the Art) open at its ranks 5 and 10 and change numbers', () => {
    const ch = holding('hunter', 40, 'sword');
    expect(ch.rankUp('cyclone:longSpin')).toMatch(/rank 5/);
    ch.data.skills.ranks.cyclone = 5;
    expect(ch.rankUp('cyclone:longSpin')).toBeNull();
    expect(ch.artMod('cyclone', 'longSpin')).toBe(true);
    expect(ch.artTicks('cyclone')).toBe(ARTS.cyclone.ticks + 2);
    expect(ch.artCost('cyclone')).toBe(Math.round(ARTS.cyclone.tpPct * ch.baseTp() * 1.4 * ch.artRankTp('cyclone')));
    expect(ch.rankUp('cyclone:vortex')).toMatch(/One per row/);
    expect(ch.rankUp('cyclone:shockwave')).toMatch(/rank 10/);
    ch.data.skills.ranks.cyclone = 10;
    expect(ch.rankUp('cyclone:shockwave')).toBeNull();
    expect(ch.rankDown('cyclone')).toMatch(/Shockwave/); // it rests on rank 10
    expect(ch.rankDown('cyclone:longSpin')).toMatch(/Shockwave/); // and on a first-row modifier
    const g = holding('hunter', 40, 'saber');
    g.data.skills.ranks.guardStance = 10;
    expect(g.rankUp('guardStance:iron')).toBeNull();
    expect(g.rankUp('guardStance:quick')).toBeNull();
    expect(g.artCooldown('guardStance')).toBe(6);
  });

  it('time weapon Arts by swing speed and techniques by cast speed', () => {
    const f = holding('force', 80, 'rod');
    const before = f.artTiming('foie').windup;
    f.data.skills.ranks.swiftCast = 5;
    expect(f.artTiming('foie').windup).toBeLessThan(before);
    const r = holding('ranger', 80, 'rifle');
    const ws = r.artTiming('chargedShot').windup;
    r.data.skills.ranks.rapidFire = 5;
    expect(r.artTiming('chargedShot').windup).toBeLessThan(ws);
  });

  it('give casters a photon bolt basic step (the Wand refills more TP, the Rod hits harder)', () => {
    expect(weaponKinds.wand.tpRefill!).toBeGreaterThan(weaponKinds.rod.tpRefill!);
    expect(weaponKinds.rod.boltPower!).toBeGreaterThan(weaponKinds.wand.boltPower!);
    const f = holding('force', 30, 'rod');
    expect(f.boltDamage()).toBeGreaterThan(0);
    expect(basicAttack.tpRefill).toBeGreaterThan(0);
  });

  it('teach the photon blast through the Mag from its level', () => {
    const ch = holding('hunter', magCfg.pbLevel - 1);
    ch.data.photonBlast = 'mylla';
    expect(ch.photonBlast).toBeNull();
    ch.data.level = magCfg.pbLevel;
    expect(ch.photonBlast).toBe('mylla');
  });
});
