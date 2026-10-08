import { describe, expect, it } from 'vitest';
import { Character, makeItem } from './character';
import { injectorCfg, magCfg } from './config';
import { getDef, itemDefs } from './data/items';
import { addCharge, chargeOf, doseAmount, fillInjector, injectorStats, spendDose } from './injectors';
import { rollDeRolLeDrops, rollDragonDrops, rollDrop, rollHardBossDrops, rollWardenDrops, shopStock } from './loot';
import { mulberry32 } from './world/Level';

describe('Injectors', () => {
  it("every kit starts with its own kind of injector equipped (Mate for fighters, Fluid for the Mystic), and no mates or fluids", () => {
    for (const kit of ['vanguard', 'ranger', 'mystic'] as const) {
      const ch = Character.create('T', kit);
      expect(ch.injector()?.id).toBe(kit === 'mystic' ? 'fluid_1' : 'mate_1');
      expect(ch.data.inventory.filter((i) => getDef(i.id).type === 'injector')).toHaveLength(1);
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
    expect(reserve.doses).toBe(base.doses + injectorCfg.reserveDoses);
    expect(chargeOf(makeItem('mate_2', { mod: 'reserve' }))).toBe(reserve.doses); // starts full
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
    const ch = Character.create('T', 'vanguard');
    const mate = ch.injector()!;
    const before = injectorStats(mate, ch).potency;
    ch.mag.cells = ['-1,0', '-2,0', '-3,0']; // DEF arm up to Bulwark
    expect(injectorStats(mate, ch).potency).toBeCloseTo(before * (1 + magCfg.injectorBoost));
    expect(injectorStats(makeItem('fluid_1'), ch).potency).toBeCloseTo(0.3); // Fluid: needs Efficiency instead
  });

  it('gates high tiers by DFP (Mate) and MST (Fluid)', () => {
    const force = Character.create('T', 'mystic');
    const hunter = Character.create('T', 'vanguard');
    for (const ch of [force, hunter]) ch.addXp(30000); // around Lv 17
    // Attribute points decide it: all MIND for the caster, two POW to one DEF for the fighter.
    force.spendAttribute('mind', force.attributePoints);
    hunter.spendAttribute('def', Math.floor(hunter.attributePoints / 3));
    hunter.spendAttribute('pow', hunter.attributePoints);
    expect(force.canEquip(makeItem('fluid_4')).ok).toBe(true);
    expect(force.canEquip(makeItem('mate_3')).ok).toBe(false);
    expect(hunter.canEquip(makeItem('mate_4')).ok).toBe(true);
    expect(hunter.canEquip(makeItem('fluid_3')).ok).toBe(false);
    // Tiers 1-2 are for everyone.
    expect(force.canEquip(makeItem('mate_2')).ok).toBe(true);
  });

  it('has one slot: equipping another injector (either kind) replaces the one worn', () => {
    const ch = Character.create('T', 'vanguard');
    const first = ch.injector()!;
    const fluid = makeItem('fluid_1');
    ch.addItem(fluid);
    expect(ch.equip(fluid.uid).ok).toBe(true);
    expect(ch.injector()?.uid).toBe(fluid.uid);
    expect(ch.isEquipped(first.uid)).toBe(false);
  });

  it('drops and shops never hand out removed consumables', () => {
    const rng = mulberry32(7);
    const removed = ['monomate', 'dimate', 'monofluid', 'difluid', 'antidote', 'antiparalysis', 'moon_atomizer', 'scape_doll', 'trimate', 'trifluid'];
    for (const id of removed) expect(itemDefs[id]).toBeUndefined();
    let injectors = 0;
    for (let i = 0; i < 3000; i++) {
      const d = rollDrop(3, 0, rng, 'mst');
      if (d.kind === 'item' && getDef(d.item.id).type === 'injector') injectors++;
    }
    expect(injectors).toBeGreaterThan(50);
    const stock = shopStock('item', 15, 'mst', rng).map((i) => i.id);
    expect(stock).toContain('telepipe');
    expect(stock).toContain('mate_1');
    expect(stock).toContain('fluid_3');
    expect(stock).not.toContain('trimate');
  });

  it('bosses no longer drop refills', () => {
    const rng = mulberry32(3);
    const bossDrops = [
      ...rollDragonDrops(rng), ...rollDeRolLeDrops(rng), ...rollWardenDrops(rng),
      ...(['dragon', 'derolle', 'warden'] as const).flatMap((b) => rollHardBossDrops(b, rng)),
    ];
    for (const d of bossDrops) if (d.kind === 'item') expect(getDef(d.item.id).type).not.toBe('consumable');
  });
});
