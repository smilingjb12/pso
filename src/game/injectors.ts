import { injectorCfg, passiveCfg } from './config';
import type { Character, ItemInstance } from './character';
import { getDef, INJECTOR_MODS, type InjectorItemDef, type InjectorKind, type InjectorMod } from './data/items';

// Injector rules (Mate = HP, Fluid = TP). Pure data, no rendering. The charge lives on the item
// instance (in doses, fractional); undefined means full, so new and bought injectors start topped up.

export interface InjectorStats {
  kind: InjectorKind;
  doses: number;
  /** Fraction of the max gauge one dose restores (mods and Mag included; Emergency applies on use). */
  potency: number;
  /** Seconds a dose takes to land (0 = at once). */
  over: number;
  chargeMult: number;
  mod?: InjectorMod;
}

export function injectorDef(inst: ItemInstance | undefined): InjectorItemDef | null {
  if (!inst) return null;
  const def = getDef(inst.id);
  return def.type === 'injector' ? def : null;
}

/** Talent and gear boosts to a dose: Bulwark (+20%) or Field Medic (+30%) for Mate, Efficiency (+20%) for Fluid, plus Injector potency affixes. */
export function injectorBoost(kind: InjectorKind, ch?: Character): { pct: number; from: string[] } {
  const from: string[] = [];
  let pct = 0;
  if (!ch) return { pct, from };
  if (kind === 'mate' && ch.hasPassive('bulwark')) (pct += ch.pAmt('bulwark', passiveCfg.injectorBoost) * 100), from.push('Bulwark');
  if (kind === 'mate' && ch.hasPassive('fieldMedic')) (pct += ch.pAmt('fieldMedic', passiveCfg.fieldMedicBoost) * 100), from.push('Field Medic');
  if (kind === 'fluid' && ch.hasPassive('efficiency')) (pct += ch.pAmt('efficiency', passiveCfg.injectorBoost) * 100), from.push('Efficiency');
  const gear = ch.gearAffix('injPotency');
  if (gear) (pct += gear), from.push('gear');
  return { pct, from };
}

export function injectorStats(inst: ItemInstance, ch?: Character): InjectorStats {
  const def = injectorDef(inst)!;
  const mod = inst.mod;
  // Reserve: one more dose to fill (charge comes from fighting, resting between fights and Pioneer 2).
  const doses = def.doses + (mod === 'reserve' ? injectorCfg.reserveDoses : 0);
  let potency = def.potency;
  let chargeMult = def.kind === 'fluid' ? injectorCfg.fluidChargeMult : 1;
  let over = 0;
  if (mod === 'steady') {
    potency *= injectorCfg.steadyMult;
    over = injectorCfg.steadyTime;
  }
  if (mod === 'absorbent') chargeMult *= injectorCfg.absorbentMult;
  if (ch) chargeMult *= 1 + ch.gearAffix('injCharge') / 100;
  potency *= 1 + injectorBoost(def.kind, ch).pct / 100;
  return { kind: def.kind, doses, potency, over, chargeMult, mod };
}

/** Doses ready (fractional). */
export function chargeOf(inst: ItemInstance, ch?: Character): number {
  const max = injectorStats(inst, ch).doses;
  return Math.min(max, inst.charge ?? max);
}

/** Add doses (scaled by the injector's charge rate unless `raw`). */
export function addCharge(inst: ItemInstance, doses: number, ch?: Character, raw = false): void {
  const s = injectorStats(inst, ch);
  inst.charge = Math.min(s.doses, chargeOf(inst, ch) + doses * (raw ? 1 : s.chargeMult));
}

export function fillInjector(inst: ItemInstance): void {
  delete inst.charge;
}

/** Take one dose; false if less than one is ready. */
export function spendDose(inst: ItemInstance, ch?: Character): boolean {
  const c = chargeOf(inst, ch);
  if (c < 1) return false;
  inst.charge = c - 1;
  return true;
}

/** HP / TP one dose restores now, given the gauge's max and current value (Emergency boosts low gauges). */
export function doseAmount(s: InjectorStats, max: number, current: number): number {
  let k = s.potency;
  if (s.mod === 'emergency' && current < max * injectorCfg.emergencyBelow) k *= injectorCfg.emergencyMult;
  return Math.max(1, Math.round(max * k));
}

/** Info lines for menus (describeItem adds the requirement after them). */
export function describeInjector(inst: ItemInstance, ch?: Character): string[] {
  const def = injectorDef(inst)!;
  const s = injectorStats(inst, ch);
  const gauge = def.kind === 'mate' ? 'HP' : 'TP';
  const lines = [`${def.kind === 'mate' ? 'Mate' : 'Fluid'} injector · tier ${def.tier}`];
  lines.push(`${s.doses} doses · each restores ${Math.round(s.potency * 100)}% of max ${gauge}${s.over ? ` over ${s.over} s` : ''}`);
  if (s.mod) lines.push(`${INJECTOR_MODS[s.mod].name}: ${INJECTOR_MODS[s.mod].desc}`);
  const rate = s.chargeMult === 1 ? '' : ` (${s.chargeMult < 1 ? 'slower' : 'faster'}: ×${+s.chargeMult.toFixed(2)})`;
  lines.push(`Refills as you damage enemies${rate}, and fully between fights and in Pioneer 2.`);
  const boost = injectorBoost(def.kind, ch);
  if (boost.pct) lines.push(`${boost.from.join(', ')}: +${Math.round(boost.pct)}% per dose (included)`);
  return lines;
}
