import { describe, expect, it } from 'vitest';
import { Character } from './character';
import { passiveCfg, skillCfg } from './config';
import { ART_IDS } from './data/arts';
import { passiveRanks } from './passives';
import { ARTS } from './data/arts';
import { LANE_COLS, readSkills, SKILL_TREES, skillNode, skillNodes, skillPoints, skillReachable, treeCols, treeLines } from './skills';
import { modGlyph } from '../ui/skillIcons';

function at(level: number): Character {
  const ch = Character.create('T');
  ch.data.level = level;
  return ch;
}

describe('Skills trees (2026-10-15, Diablo 2 style: ranked Arts and passives with prerequisites)', () => {
  it('give the three trees (no Support tree) every Art once with its six modifiers, on free cells', () => {
    expect(SKILL_TREES.map((t) => t.id)).toEqual(['fire', 'lightning', 'ice']);
    const nodes = skillNodes();
    expect(new Set(nodes.map((n) => n.id)).size).toBe(nodes.length);
    const arts = nodes.filter((n) => n.kind === 'art').map((n) => n.id).sort();
    expect(arts).toEqual([...ART_IDS].sort());
    expect(nodes.filter((n) => n.kind === 'mod')).toHaveLength(arts.length * 6);
    for (const a of arts) expect(new Set(ARTS[a as keyof typeof ARTS].mods.flat().map((m) => m.id)).size, a).toBe(6);
    for (const t of SKILL_TREES) {
      const cells = nodes.filter((n) => n.tree === t.id).map((n) => `${n.row}:${n.col}`);
      expect(new Set(cells).size, t.id).toBe(cells.length);
      // Lines run downward (an Art to a passive may run level) and through empty cells only.
      const at = new Set(cells);
      const first = t.lanes.length * LANE_COLS;
      for (const { from, to, kind } of treeLines(t.id)) {
        const f = skillNode(from)!;
        const n = skillNode(to)!;
        expect(f.row, `${from} -> ${to}`).toBeLessThanOrEqual(n.row);
        const crossed: string[] = [];
        if (kind === 'branch') {
          for (let c = f.col + 1; c < first; c++) crossed.push(`${f.row}:${c}`);
          for (let c = first; c < n.col; c++) crossed.push(`${n.row}:${c}`);
        } else if (kind === 'chain') {
          for (let r = f.row + 1; r < n.row; r++) crossed.push(`${r}:${n.col}`);
        }
        for (const c of crossed) expect(at.has(c), `${t.id}: ${from} -> ${to} crosses ${c}`).toBe(false);
      }
    }
    for (const n of nodes) {
      expect(n.col).toBeLessThan(treeCols(n.tree));
      expect(n.col, n.id).toBeLessThan(SKILL_TREES.find((t) => t.id === n.tree)!.lanes.length * LANE_COLS + 3);
      expect(n.row, `${n.id} placed far down: no clear line`).toBeLessThan(20);
      if (!n.pre) continue;
      const p = skillNode(n.pre)!;
      expect(p.tree, n.id).toBe(n.tree);
      expect(p.row, `${n.id} hangs from a node above it (or the Art beside it)`).toBeLessThanOrEqual(n.row);
    }
  });

  it('give the three modifiers of a row three different icons', () => {
    for (const id of ART_IDS) {
      for (const row of ARTS[id].mods) expect(new Set(row.map((m) => modGlyph(id, m.id))).size, `${id}: ${row.map((m) => m.id).join(', ')}`).toBe(3);
    }
  });

  it('count a skill in reach when its level is met all the way up, whatever ranks, points or a taken sibling', () => {
    const n = (id: string) => skillNode(id)!;
    expect(skillReachable(20, n('gifoie'))).toBe(true); // Foie has no points yet: spending gets there
    expect(skillReachable(20, n('rafoie'))).toBe(false); // Lv 36
    expect(skillReachable(20, n('gifoie:inferno'))).toBe(true); // needs Gifoie at rank 5: points again
    expect(skillReachable(12, n('gifoie:inferno'))).toBe(false); // Gifoie opens at Lv 15
    expect(skillReachable(40, n('overload'))).toBe(false); // Lv 56, though Kindle above it is in reach
    expect(skillReachable(60, n('overload'))).toBe(true);
  });

  it('chain the techniques: Foie → Gifoie → Rafoie', () => {
    expect(skillNode('gifoie')!.pre).toBe('foie');
    expect(skillNode('rafoie')!.pre).toBe('gifoie');
  });

  it('gives a point a level, and a new character spends its first on Foie', () => {
    expect(skillPoints(100)).toBe(100 * skillCfg.pointsPerLevel);
    const ch = Character.create('T');
    expect(ch.artRank('foie')).toBe(1);
    expect(ch.artBar()[0]).toBe('foie');
    expect(ch.skillPointsLeft).toBe(skillPoints(1) - 1);
  });

  it('needs the level and a point in the skill above; stops at the top rank and the budget', () => {
    const ch = at(40);
    expect(ch.rankUp('gifoie')).toBeNull(); // Foie is learned
    expect(ch.rankUp('rafoie')).toBeNull();
    const low = at(10);
    expect(low.rankUp('gifoie')).toMatch(/Lv 15/);
    expect(low.rankUp('zonde')).toBeNull();
    expect(low.rankUp('gizonde')).toMatch(/Lv 20/);
    const f = at(60);
    f.rankUp('zonde');
    expect(f.rankUp('conductor')).toMatch(/Gizonde/);
    for (let i = 0; i < 20; i++) f.rankUp('foie');
    expect(f.artRank('foie')).toBe(skillCfg.artRanks);
    const poor = at(3); // 3 points, Foie already has 1
    expect(poor.rankUp('foie')).toBeNull();
    expect(poor.rankUp('foie')).toBeNull();
    expect(poor.rankUp('foie')).toMatch(/No skill points/);
  });

  it('takes ranks back one at a time, but not the last while a skill hangs from it', () => {
    const ch = at(40);
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
    const ch = at(60);
    const one = ch.techDamage('foie');
    const cost = ch.techCost('foie');
    for (let i = 0; i < 9; i++) ch.rankUp('foie');
    expect(ch.techDamage('foie') / one).toBeCloseTo(1 + skillCfg.artPowerPerRank * 9);
    expect(ch.techCost('foie')).toBeLessThan(cost);
  });

  it('scales a passive from a share of its effect up to the full one at its top rank', () => {
    const ch = at(80);
    const base = ch.castTimeMult();
    ch.data.skills.ranks.swiftCast = 1;
    expect(ch.castTimeMult()).toBeCloseTo(base * (1 + (passiveCfg.swiftCastMult - 1) / 5));
    ch.data.skills.ranks.swiftCast = 5;
    expect(ch.castTimeMult()).toBeCloseTo(base * passiveCfg.swiftCastMult);
    expect(passiveRanks('fleet')).toBe(1);
    expect(passiveRanks('swiftCast')).toBe(5);
    ch.data.skills.ranks.siphonStaff = 5; // bolt passives still need a rod or wand in hand
    expect(ch.passiveK('siphonStaff')).toBe(1);
    delete ch.data.equipped.weapon;
    expect(ch.passiveK('siphonStaff')).toBe(0);
  });

  it('takes one modifier per row at a point each: row 1 at the Art\'s rank 5, row 2 at rank 10 after a row 1 pick', () => {
    const ch = at(60);
    expect(ch.rankUp('foie:split')).toMatch(/rank 5/);
    for (let i = 0; i < 4; i++) ch.rankUp('foie');
    const left = ch.skillPointsLeft;
    expect(ch.rankUp('foie:split')).toBeNull();
    expect(ch.skillPointsLeft).toBe(left - 1);
    expect(ch.artMod('foie', 'split')).toBe(true);
    expect(ch.rankUp('foie:big')).toMatch(/One per row/);
    expect(ch.rankDown('foie')).toMatch(/Foie Split/); // it rests on rank 5
    for (let i = 0; i < 5; i++) ch.rankUp('foie');
    expect(ch.rankUp('foie:ignite')).toBeNull();
    expect(ch.rankDown('foie:split')).toMatch(/Ignite/);
    expect(ch.rankDown('foie:ignite')).toBeNull();
    expect(ch.rankDown('foie:split')).toBeNull();
    expect(ch.rankUp('foie:big')).toBeNull(); // the row is free again
  });

  it('repairs stored picks: unknown skills, missing prerequisites, too many ranks or points', () => {
    // Modifier picks stored apart (the first ranked trees) become modifier nodes.
    const picks = readSkills({ ranks: { foie: 30, gifoie: 2, rafoie: 1, bogus: 3, overload: 5 }, mods: { foie: ['split', 'nope'] } }, 20);
    expect(picks.ranks).toEqual({ foie: 10, gifoie: 2, 'foie:split': 1 }); // Rafoie opens at 36, Overload needs Kindle
    expect(readSkills({ ranks: { foie: 10, gifoie: 10 } }, 12).ranks).toEqual({ foie: 10 }); // 12 points; Gifoie at 15
    expect(readSkills({ ranks: { foie: 10, zonde: 10 } }, 12).ranks).toEqual({ foie: 10, zonde: 2 });
  });

  it('turns an old save into ranks: the Arts on its bars (with what they hang from) and its old passives', () => {
    const data = at(60).data as unknown as Record<string, unknown>;
    data.skills = { tempo: true, 'foie.0': 'split' }; // the first Skills tree, the same morning
    data.passives = ['resonance', null, null, null];
    data.arts = { bars: { rod: ['rafoie', 'zonde', null, null] }, mods: {} };
    const ch = new Character(JSON.parse(JSON.stringify(data)));
    expect(ch.data.skills.ranks).toEqual({ foie: 1, gifoie: 1, rafoie: 1, zonde: 1, resonance: 1, tempo: 1 });
    expect(ch.data.passives).toBeUndefined();
  });

  it('makes the old per-kind Art bars one bar: the one of the weapon in hand, else the first kept', () => {
    const save = (bars: Record<string, unknown>) => {
      const data = at(60).data;
      data.skills = { ranks: { foie: 1, gifoie: 1, zonde: 1, barta: 1 } };
      data.arts = { bars };
      return new Character(JSON.parse(JSON.stringify(data)));
    };
    // The start wand is in hand.
    const ch = save({ rod: ['zonde', null, null, null], wand: ['barta', 'foie', 'barta', 'bogus'] });
    expect(ch.data.arts).toEqual({ bar: ['barta', 'foie', null, null] }); // no Art twice, unknown ones dropped
    expect(ch.artBar()).toEqual(['barta', 'foie', null, null]);
    expect(save({ rod: ['zonde', 'gifoie', null, null] }).artBar()).toEqual(['zonde', 'gifoie', null, null]);
    // A bar of a kind that went (a Hunter's saber) is gone: the bar fills itself with what is learned.
    expect(save({ saber: ['risingEdge', null, null, null] }).data.arts.bar).toBeUndefined();
  });

  it('keeps one bar: an Art set in a slot swaps with where it was, and an unlearned one is refused', () => {
    const ch = at(60);
    ch.rankUp('zonde');
    expect(ch.artBar()).toEqual(['foie', 'zonde', null, null]);
    expect(ch.setArtSlot(2, 'foie')).toBeNull();
    expect(ch.artBar()).toEqual([null, 'zonde', 'foie', null]);
    expect(ch.setArtSlot(0, 'zonde')).toBeNull();
    expect(ch.artBar()).toEqual(['zonde', null, 'foie', null]);
    expect(ch.setArtSlot(3, 'barta')).toMatch(/isn't learned/);
    expect(ch.setArtSlot(4, 'foie')).toMatch(/No such slot/);
    // An Art learned later goes into the free slot of a changed bar.
    ch.rankUp('barta');
    expect(ch.artBar()).toEqual(['zonde', 'barta', 'foie', null]);
  });
});
