import { describe, expect, it } from 'vitest';
import { Character, makeItem } from './character';
import { passiveCfg, skillCfg } from './config';
import { ART_IDS, artClasses } from './data/arts';
import { CLASS_IDS } from './data/stats';
import { passiveRanks, type PassiveId } from './passives';
import { readSkills, SKILL_TREES, skillNode, skillNodes, skillPoints, TREE_COLS } from './skills';

function at(cls: 'hunter' | 'ranger' | 'force', level: number): Character {
  const ch = Character.create('T', cls);
  ch.data.level = level;
  return ch;
}

describe('Skills trees (2026-10-15, Diablo 2 style: ranked Arts and passives with prerequisites)', () => {
  it('give each class four trees holding all its Arts once, on free grid cells, hanging from nodes of the same tree', () => {
    for (const cls of CLASS_IDS) {
      expect(SKILL_TREES[cls]).toHaveLength(4);
      const nodes = skillNodes(cls);
      expect(new Set(nodes.map((n) => n.id)).size).toBe(nodes.length);
      const arts = nodes.filter((n) => n.kind === 'art').map((n) => n.id).sort();
      expect(arts).toEqual(ART_IDS.filter((a) => artClasses(a).includes(cls)).sort());
      for (const t of SKILL_TREES[cls]) {
        const cells = t.nodes.map(([, r, c]) => `${r}:${c}`);
        expect(new Set(cells).size, `${cls} ${t.id}`).toBe(cells.length);
      }
      for (const n of nodes) {
        expect(n.col).toBeLessThan(TREE_COLS);
        if (!n.pre) continue;
        const p = skillNode(cls, n.pre)!;
        expect(p.tree, `${cls} ${n.id}`).toBe(n.tree);
        expect(p.row, `${cls} ${n.id} hangs from a node above it`).toBeLessThan(n.row);
      }
    }
  });

  it('chain the techniques: Foie → Gifoie → Rafoie', () => {
    expect(skillNode('force', 'gifoie')!.pre).toBe('foie');
    expect(skillNode('force', 'rafoie')!.pre).toBe('gifoie');
  });

  it('gives a point a level, and a new character spends its first on the start weapon\'s Art', () => {
    expect(skillPoints(100)).toBe(100 * skillCfg.pointsPerLevel);
    const h = Character.create('T', 'hunter'); // a saber
    expect(h.artRank('risingEdge')).toBe(1);
    expect(h.artBar()[0]).toBe('risingEdge');
    expect(h.skillPointsLeft).toBe(skillPoints(1) - 1);
    expect(Character.create('T', 'force').artRank('foie')).toBe(1);
  });

  it('needs the level and a point in the skill above; stops at the top rank and the budget', () => {
    const ch = at('force', 40);
    expect(ch.rankUp('gifoie')).toBeNull(); // Foie is learned
    expect(ch.rankUp('rafoie')).toBeNull();
    const low = at('force', 10);
    expect(low.rankUp('gifoie')).toMatch(/Lv 15/);
    expect(low.rankUp('zonde')).toBeNull();
    expect(low.rankUp('gizonde')).toMatch(/Lv 20/);
    const f = at('force', 60);
    f.rankUp('zonde');
    expect(f.rankUp('conductor')).toMatch(/Gizonde/);
    for (let i = 0; i < 20; i++) f.rankUp('foie');
    expect(f.artRank('foie')).toBe(skillCfg.artRanks);
    const poor = at('force', 3); // 3 points, Foie already has 1
    expect(poor.rankUp('foie')).toBeNull();
    expect(poor.rankUp('foie')).toBeNull();
    expect(poor.rankUp('foie')).toMatch(/No skill points/);
  });

  it('takes ranks back one at a time, but not the last while a skill hangs from it', () => {
    const ch = at('force', 40);
    ch.rankUp('foie');
    ch.rankUp('gifoie');
    expect(ch.rankDown('foie')).toBeNull(); // 2 -> 1
    expect(ch.rankDown('foie')).toMatch(/Gifoie/);
    expect(ch.rankDown('gifoie')).toBeNull();
    expect(ch.rankDown('foie')).toBeNull();
    expect(ch.artRank('foie')).toBe(0);
    expect(ch.artBar()).not.toContain('foie');
  });

  it('scales Art power and TP with rank', () => {
    const ch = at('force', 60);
    const one = ch.techDamage('foie');
    const cost = ch.techCost('foie');
    for (let i = 0; i < 9; i++) ch.rankUp('foie');
    expect(ch.techDamage('foie') / one).toBeCloseTo(1 + skillCfg.artPowerPerRank * 9);
    expect(ch.techCost('foie')).toBeLessThan(cost);
  });

  it('scales a passive from a share of its effect up to the full one at its top rank', () => {
    const ch = at('hunter', 80);
    const base = ch.swingTimeMult();
    ch.data.skills.ranks.fervor = 1;
    expect(ch.swingTimeMult()).toBeCloseTo(base * (1 + (passiveCfg.swingSpeedMult - 1) / 5));
    ch.data.skills.ranks.fervor = 5;
    expect(ch.swingTimeMult()).toBeCloseTo(base * passiveCfg.swingSpeedMult);
    expect(passiveRanks('fleet')).toBe(1);
    expect(passiveRanks('fervor')).toBe(5);
    const gun = makeItem('handgun_1'); // weapon passives still need their family in hand
    ch.data.inventory.push(gun);
    ch.data.equipped.weapon = gun.uid;
    expect(ch.passiveK('fervor' as PassiveId)).toBe(0);
  });

  it('opens an Art\'s modifier rows at ranks 5 and 10, and drops a pick when the rank falls below', () => {
    const ch = at('force', 60);
    expect(ch.pickArtMod('foie', 0, 'split')).toMatch(/rank 5/);
    for (let i = 0; i < 4; i++) ch.rankUp('foie');
    expect(ch.pickArtMod('foie', 0, 'split')).toBeNull();
    expect(ch.artMod('foie', 'split')).toBe(true);
    expect(ch.skillPointsFree).toBeGreaterThan(0);
    ch.rankDown('foie');
    expect(ch.artMod('foie', 'split')).toBe(false);
    expect(ch.data.skills.mods.foie).toBeUndefined();
  });

  it('repairs stored picks: unknown skills, missing prerequisites, too many ranks or points', () => {
    const picks = readSkills({ ranks: { foie: 30, gifoie: 2, rafoie: 1, bogus: 3, overload: 5 }, mods: { foie: ['split', 'nope'] } }, 'force', 20);
    expect(picks.ranks).toEqual({ foie: 10, gifoie: 2 }); // Rafoie opens at 36, Overload needs Kindle
    expect(picks.mods.foie).toEqual(['split', null]);
    expect(readSkills({ ranks: { foie: 10, gifoie: 10 } }, 'force', 12).ranks).toEqual({ foie: 10 }); // 12 points; Gifoie at 15
    expect(readSkills({ ranks: { foie: 10, zonde: 10 } }, 'force', 12).ranks).toEqual({ foie: 10, zonde: 2 });
  });

  it('turns an old save into ranks: the Arts on its bars (with what they hang from) and its old passives', () => {
    const data = at('force', 60).data as unknown as Record<string, unknown>;
    data.skills = { tempo: true, 'foie.0': 'split' }; // the first Skills tree, the same morning
    data.passives = ['resonance', null, null, null];
    data.arts = { bars: { rod: ['rafoie', 'zonde', null, null] }, mods: {} };
    const ch = new Character(JSON.parse(JSON.stringify(data)));
    expect(ch.data.skills.ranks).toEqual({ foie: 1, gifoie: 1, rafoie: 1, zonde: 1, resonance: 1, tempo: 1 });
    expect(ch.data.passives).toBeUndefined();
  });
});
