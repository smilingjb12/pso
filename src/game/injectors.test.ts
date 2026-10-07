import { describe, expect, it } from 'vitest';
import { Character, makeItem, type CharacterData } from './character';
import { injectorCfg, magCfg } from './config';
import { getDef, itemDefs } from './data/items';
import { addCharge, chargeOf, doseAmount, fillInjector, injectorStats, spendDose } from './injectors';
import { rollDrop, shopStock } from './loot';
import { mulberry32 } from './world/Level';

describe('Injectors', () => {
  it('every class starts with a Mate and a Fluid injector equipped, and no mates or fluids', () => {
    for (const cls of ['hunter', 'ranger', 'force'] as const) {
      const ch = Character.create('T', cls);
      expect(ch.injector(0)?.id).toBe('mate_1');
      expect(ch.injector(1)?.id).toBe('fluid_1');
      expect(ch.data.inventory.some((i) => getDef(i.id).type === 'consumable' && i.id !== 'telepipe')).toBe(false);
    }
  });

  it('spends whole doses and refills from fractional charge', () => {
    const inj = makeItem('mate_1');
    expect(chargeOf(inj)).toBe(3);
    expect(spendDose(inj)).toBe(true);
    expect(spendDose(inj)).toBe(true);
    expect(spendDose(inj)).toBe(true);
    expect(spendDose(inj)).toBe(false);
    addCharge(inj, 0.6);
    expect(spendDose(inj)).toBe(false);
    addCharge(inj, 0.6);
    expect(spendDose(inj)).toBe(true);
    addCharge(inj, 99);
    expect(chargeOf(inj)).toBe(3);
    spendDose(inj);
    fillInjector(inj);
    expect(chargeOf(inj)).toBe(3);
  });

  it('caps every injector at 3 doses; Fluid charges slower than Mate', () => {
    for (const d of Object.values(itemDefs)) if (d.type === 'injector') expect(d.doses).toBe(3);
    const mate = makeItem('mate_1');
    const fluid = makeItem('fluid_1');
    mate.charge = fluid.charge = 0;
    addCharge(mate, 1);
    addCharge(fluid, 1);
    expect(chargeOf(mate)).toBe(1);
    expect(chargeOf(fluid)).toBeCloseTo(injectorCfg.fluidChargeMult);
  });

  it('applies mods: Reserve, Steady, Absorbent, Emergency', () => {
    const base = injectorStats(makeItem('mate_2'));
    const reserve = injectorStats(makeItem('mate_2', { mod: 'reserve' }));
    expect(reserve.doses).toBe(base.doses);
    expect(base.trickleTo).toBe(1);
    expect(reserve.trickleTo).toBe(injectorCfg.reserveTrickle);
    const steady = injectorStats(makeItem('mate_2', { mod: 'steady' }));
    expect(steady.over).toBe(injectorCfg.steadyTime);
    const abs = makeItem('mate_1', { mod: 'absorbent' });
    abs.charge = 0;
    addCharge(abs, 1);
    expect(chargeOf(abs)).toBeCloseTo(injectorCfg.absorbentMult);
    const em = injectorStats(makeItem('mate_1', { mod: 'emergency' }));
    expect(doseAmount(em, 100, 10)).toBe(Math.round(100 * em.potency * injectorCfg.emergencyMult));
    expect(doseAmount(em, 100, 90)).toBe(Math.round(100 * em.potency));
  });

  it('Bulwark boosts Mate doses and Efficiency boosts Fluid doses', () => {
    const ch = Character.create('T', 'hunter');
    const mate = ch.injector(0)!;
    const before = injectorStats(mate, ch).potency;
    ch.mag.cells = ['-1,0', '-2,0', '-3,0']; // DEF arm up to Bulwark
    expect(injectorStats(mate, ch).potency).toBeCloseTo(before * (1 + magCfg.injectorBoost));
    expect(injectorStats(ch.injector(1)!, ch).potency).toBeCloseTo(0.22); // Fluid: needs Efficiency instead
  });

  it('gates high tiers by DFP (Mate) and MST (Fluid)', () => {
    const force = Character.create('T', 'force');
    const hunter = Character.create('T', 'hunter');
    for (const ch of [force, hunter]) ch.addXp(30000); // around Lv 17
    expect(force.canEquip(makeItem('fluid_4')).ok).toBe(true);
    expect(force.canEquip(makeItem('mate_3')).ok).toBe(false);
    expect(hunter.canEquip(makeItem('mate_4')).ok).toBe(true);
    expect(hunter.canEquip(makeItem('fluid_3')).ok).toBe(false);
    // Tiers 1-2 are for everyone.
    expect(force.canEquip(makeItem('mate_2')).ok).toBe(true);
  });

  it('equips into either slot, any mix, and moves between slots', () => {
    const ch = Character.create('T', 'hunter');
    const extra = makeItem('mate_1');
    ch.addItem(extra);
    expect(ch.equip(extra.uid, 'inj2').ok).toBe(true);
    expect(ch.injector(1)?.uid).toBe(extra.uid);
    expect(ch.injector(0)?.id).toBe('mate_1');
    expect(ch.equip(extra.uid, 'inj1').ok).toBe(true);
    expect(ch.injector(0)?.uid).toBe(extra.uid);
    expect(ch.injector(1)).toBeUndefined();
  });

  it('migrates old saves: refunds removed consumables, keeps Trimates (capped), adds starter injectors', () => {
    const data = JSON.parse(JSON.stringify(Character.create('T', 'hunter').data)) as CharacterData;
    data.inventory = data.inventory.filter((i) => getDef(i.id).type !== 'injector');
    delete data.equipped.inj1;
    delete data.equipped.inj2;
    data.inventory.push(
      { uid: 'a', id: 'monomate', qty: 10 },
      { uid: 'b', id: 'scape_doll', qty: 1 },
      { uid: 'c', id: 'trimate', qty: 7 },
    );
    const meseta = data.meseta;
    const ch = new Character(data);
    expect(ch.find('a')).toBeUndefined();
    expect(ch.find('b')).toBeUndefined();
    expect(ch.find('c')?.qty).toBe(3);
    expect(ch.data.meseta).toBe(meseta + 10 * 50 + 5000);
    expect(ch.injector(0)?.id).toBe('mate_1');
    expect(ch.injector(1)?.id).toBe('fluid_1');
  });

  it('drops and shops never hand out removed consumables', () => {
    const rng = mulberry32(7);
    const removed = ['monomate', 'dimate', 'monofluid', 'difluid', 'antidote', 'antiparalysis', 'moon_atomizer', 'scape_doll'];
    for (const id of removed) expect(itemDefs[id]).toBeUndefined();
    let injectors = 0;
    for (let i = 0; i < 3000; i++) {
      const d = rollDrop(3, 0, rng, 'force');
      if (d.kind === 'item' && getDef(d.item.id).type === 'injector') injectors++;
    }
    expect(injectors).toBeGreaterThan(50);
    const stock = shopStock('item', 15, 'force', rng).map((i) => i.id);
    expect(stock).toContain('telepipe');
    expect(stock).toContain('mate_1');
    expect(stock).toContain('fluid_3');
    expect(stock).not.toContain('trimate');
  });
});
