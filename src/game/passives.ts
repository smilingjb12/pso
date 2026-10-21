import { dash as dashCfg, passiveCfg as T } from './config';

// Passives (2026-10-14, the Arts redesign; they were talents, ten Mists of Pandaria rows): the old talents' general
// effects, each unlocking at its old row's level. Since 2026-10-15 they are nodes of the Skills tree (skills.ts says
// which branch and level, and what they cost); until then they went into four slots. Effects that belonged to one
// technique's form (Zonde Storm, Barta Field, Foie Split) became that technique's modifiers, and the photon blasts
// moved to the Mag. The Hunter and Ranger passives went with the classes on 2026-10-21; five that work with anything
// (Last Stand, Bulwark, Bloodlust, Light Feet, Field Medic) joined the trees (the user's pick). Pure data + rules;
// Combat, Player and Game ask Character.hasPassive.

export type PassiveId =
  | 'tempo' | 'fleet' | 'slipstream' | 'lastStand' | 'bulwark' | 'bloodlust' | 'composure' | 'rush' | 'lightFeet' | 'fieldMedic'
  | 'resonance' | 'calmMind' | 'blink' | 'overcast' | 'barrier' | 'purify' | 'focusBolt' | 'ward' | 'conductor'
  | 'efficiency' | 'clarity' | 'siphonStaff' | 'overload' | 'aegis' | 'echo' | 'kindle' | 'frostbite' | 'techLongshot'
  | 'swiftCast';

export interface PassiveDef {
  name: string;
  /** What it does, with live numbers at `k` of its full effect (its rank / its top rank; 1 = the top rank). */
  desc: (k?: number) => string;
  /** Only works with a rod or wand in hand (bolt passives). */
  needsWeapon?: boolean;
  /** Offence / defence / utility (its colour in the menu). */
  role: 'offence' | 'defence' | 'utility';
}

const pct = (f: number) => Math.round(f * 100);
/** A passive's number at `k` of its full effect: a multiplier moves from 1 toward it, an amount from 0. */
export const rankMult = (full: number, k: number) => 1 + (full - 1) * k;
export const rankAmt = (full: number, k: number) => full * k;
const less = (mult: number) => pct(1 - mult);
const more = (mult: number) => pct(mult - 1);
const PF = 'a perfect finisher (the 3rd step of a chain, chained perfectly twice)';

export const PASSIVES: Record<PassiveId, PassiveDef> = {
  // ------------------------------------------------------------ general
  tempo: { name: 'Tempo', role: 'utility', desc: (k = 1) => `The perfect window is ${Math.round(rankAmt(T.tempoBonus, k) * 1000)} ms longer.` },
  fleet: { name: 'Fleet', role: 'defence', desc: () => `+${T.fleetCharges} dash charge (${dashCfg.charges + T.fleetCharges} instead of ${dashCfg.charges}).` },
  slipstream: { name: 'Slipstream', role: 'utility', desc: () => `Dash out of an enemy's telegraph and your next step within ${T.slipstreamTime} s lands perfect.` },
  lastStand: { name: 'Last Stand', role: 'utility', desc: () => `A hit that would knock you out leaves you at 1 HP and fires a free dose from your Mate injector. Recharges after ${T.lastStandCooldown} s.` },
  bulwark: { name: 'Bulwark', role: 'defence', desc: (k = 1) => `Area attacks, boss attacks and hazards deal ${less(rankMult(T.bulwarkMult, k))}% less, and Mate doses heal ${pct(rankAmt(T.injectorBoost, k))}% more.` },
  bloodlust: { name: 'Bloodlust', role: 'offence', desc: (k = 1) => `Your damage charges the injector ${more(rankMult(T.bloodlustMult, k))}% faster.` },
  composure: { name: 'Composure', role: 'defence', desc: (k = 1) => `After ${PF}, the next hit you take within ${T.composureTime} s deals ${less(rankMult(T.composureMult, k))}% less.` },
  rush: { name: 'Rush', role: 'utility', desc: (k = 1) => `After ${PF}, you run ${more(rankMult(T.rushRunMult, k))}% faster and dashes recharge ${more(rankMult(T.rushDashMult, k))}% faster for ${T.rushTime} s.` },
  lightFeet: { name: 'Light Feet', role: 'utility', desc: (k = 1) => `You run ${more(rankMult(T.lightFeetRunMult, k))}% faster and dashes recharge ${more(rankMult(T.lightFeetDashMult, k))}% faster.` },
  fieldMedic: { name: 'Field Medic', role: 'defence', desc: (k = 1) => `Mate injector doses heal ${pct(rankAmt(T.fieldMedicBoost, k))}% more.` },

  // ------------------------------------------------------------ techniques (bolt passives need a rod or wand)
  resonance: { name: 'Resonance', role: 'offence', desc: (k = 1) => `Perfectly chained techniques deal ${more(rankMult(T.resonanceMult, k))}% more.` },
  calmMind: { name: 'Calm Mind', role: 'defence', desc: (k = 1) => `A perfectly chained technique gives ${less(rankMult(T.parryMult, k))}% less damage taken for ${T.parryTime} s.` },
  blink: { name: 'Blink', role: 'offence', desc: () => 'Your dash is a blink: the same distance, almost instant, through enemies.' },
  overcast: { name: 'Overcast', role: 'offence', desc: (k = 1) => `Below ${pct(T.overcastBelow)}% HP your techniques deal ${more(rankMult(T.overcastMult, k))}% more.` },
  barrier: { name: 'Barrier', role: 'defence', desc: (k = 1) => `Resta healing past full HP becomes a shield (up to ${pct(rankAmt(T.barrierCap, k))}% of max HP) that fades over ${T.barrierFade} s.` },
  purify: { name: 'Purify', role: 'utility', desc: () => 'Resta also cures poison and Burn, and clears a Corruption stack.' },
  focusBolt: { name: 'Focus Bolt', role: 'offence', desc: (k = 1) => `Foie, Zonde and Barta (the single-target techniques) deal ${more(rankMult(T.focusBoltMult, k))}% more.` },
  ward: { name: 'Ward', role: 'defence', desc: (k = 1) => `Foie, Zonde and Barta give you a shield of ${pct(rankAmt(T.wardShield, k))}% max HP for ${T.wardTime} s.` },
  conductor: { name: 'Conductor', role: 'utility', desc: (k = 1) => `Techniques fill enemy stagger meters ${rankMult(T.conductorMult, k)}× as fast.` },
  efficiency: { name: 'Efficiency', role: 'offence', desc: (k = 1) => `Attack techniques cost ${less(rankMult(T.efficiencyTpMult, k))}% less TP, and Fluid doses restore ${pct(rankAmt(T.injectorBoost, k))}% more.` },
  clarity: { name: 'Clarity', role: 'defence', desc: (k = 1) => `After a Fluid injector dose, attack techniques cost no TP for ${rankAmt(T.clarityTime, k)} s.` },
  siphonStaff: { name: 'Siphon Staff', role: 'utility', needsWeapon: true, desc: (k = 1) => `Photon bolts refill ${rankMult(T.siphonMult, k)}× the TP.` },
  overload: { name: 'Overload', role: 'offence', desc: (k = 1) => `An attack technique as the 3rd step of a chain deals ${more(rankMult(T.overloadMult, k))}% more and costs double TP.` },
  aegis: { name: 'Aegis', role: 'defence', desc: (k = 1) => `An attack technique as the 3rd step of a chain gives you a shield of ${pct(rankAmt(T.aegisShield, k))}% max HP for ${T.aegisTime} s.` },
  echo: { name: 'Echo', role: 'utility', desc: (k = 1) => `An attack technique as the 3rd step of a chain repeats a moment later at ${pct(rankAmt(T.echoShare, k))}% power, free.` },
  kindle: { name: 'Kindle', role: 'offence', desc: (k = 1) => `Lightning stuns ${more(rankMult(T.kindleMult, k))}% more often, and fire's Burn deals ${more(rankMult(T.kindleMult, k))}% more.` },
  frostbite: { name: 'Frostbite', role: 'defence', desc: (k = 1) => `Chilled and frozen enemies deal ${less(rankMult(T.frostbiteMult, k))}% less.` },
  techLongshot: { name: 'Longshot', role: 'utility', desc: (k = 1) => `Techniques deal ${more(rankMult(T.longshotMult, k))}% more to enemies more than ${T.longshotRange} m away.` },
  swiftCast: { name: 'Swift Cast', role: 'offence', desc: (k = 1) => `Techniques cast ${less(rankMult(T.swiftCastMult, k))}% faster (wind-up and recovery), Resta and buffs included.` },
};

/** Does what is in hand let this passive work? */
export function weaponFits(id: PassiveId, armed: boolean): boolean {
  return armed || !PASSIVES[id].needsWeapon;
}

/** "needs a rod or wand" ('' when it works with anything). */
export function needText(id: PassiveId): string {
  return PASSIVES[id].needsWeapon ? 'needs a rod or wand' : '';
}

/** The level each passive opens at (the old talent row's). */
const LEVEL: Record<PassiveId, number> = {
  tempo: 5, resonance: 5, calmMind: 5,
  fleet: 12, slipstream: 12, lightFeet: 12, blink: 12,
  overcast: 20, barrier: 20, purify: 20,
  lastStand: 28, bulwark: 28, focusBolt: 28, ward: 28, conductor: 28,
  kindle: 36, frostbite: 36, techLongshot: 36,
  bloodlust: 46, fieldMedic: 46, efficiency: 46, clarity: 46, siphonStaff: 46,
  overload: 56, aegis: 56, echo: 56,
  composure: 76, rush: 76, swiftCast: 76,
};

/** Passives that are on or off (one rank); the rest take up to five, the fifth being the full effect. */
const SINGLE = new Set<PassiveId>(['fleet', 'slipstream', 'lastStand', 'blink', 'purify']);

export function passiveLevel(id: PassiveId): number {
  return LEVEL[id];
}

/** A passive's top rank. */
export function passiveRanks(id: PassiveId): number {
  return SINGLE.has(id) ? 1 : 5;
}
