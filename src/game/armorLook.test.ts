import { describe, expect, it } from 'vitest';
import { Character, makeItem } from './character';
import { getDef, type ArmorItemDef } from './data/items';
import { armorLook, EVOLUTIONS, LINE_OUTFIT, playerLook, TIER_STAGE } from './models/heroine';

const frame = (id: string) => getDef(id) as ArmorItemDef;

describe('armour looks', () => {
  it('dresses each line in its own outfit and maps tiers to stages', () => {
    expect(armorLook('pow', frame('frame_psy_5'))).toEqual({ outfit: 'O5', evo: 3 });
    expect(armorLook('mind', frame('frame_combat_1'))).toEqual({ outfit: 'O1', evo: 0 });
    expect(armorLook('dex', frame('frame_guard_9'))).toEqual({ outfit: 'O4', evo: 4 });
    // Standard frames (and none) fall back to the leading attribute's outfit.
    expect(armorLook('mind', frame('frame_1'))).toEqual({ outfit: 'O5', evo: 0 });
    expect(armorLook('pow')).toEqual({ outfit: 'O4', evo: 0 });
    expect(armorLook('def')).toEqual({ outfit: 'O4', evo: 0 });
  });

  it('only Nightmare frames (T8+) reach the last stage, and stages never go down with tier', () => {
    for (let t = 2; t <= 11; t++) expect(TIER_STAGE[t]).toBeGreaterThanOrEqual(TIER_STAGE[t - 1]);
    expect(TIER_STAGE[7]).toBeLessThan(4);
    expect(TIER_STAGE[8]).toBe(4);
    expect(TIER_STAGE[11]).toBe(4);
    for (const o of Object.values(LINE_OUTFIT)) expect(EVOLUTIONS[o!].stages).toHaveLength(Math.max(...TIER_STAGE) + 1);
  });

  it('follows the equipped frame on a character', () => {
    const ch = Character.create('T', 'mystic');
    expect(playerLook(ch.data)).toMatchObject({ outfit: 'O5', evo: 0 });
    const psy = makeItem('frame_psy_3');
    ch.data.inventory.push(psy);
    ch.data.equipped.frame = psy.uid;
    expect(playerLook(ch.data)).toMatchObject({ outfit: 'O5', evo: 2 });
    delete ch.data.equipped.frame;
    expect(playerLook(ch.data)).toMatchObject({ outfit: 'O5', evo: 0 });
    // With no frame, the outfit follows the attribute with the most points.
    ch.data.level = 10;
    ch.spendAttribute('dex', 5);
    expect(playerLook(ch.data)).toMatchObject({ outfit: 'O1', evo: 0 });
  });
});
