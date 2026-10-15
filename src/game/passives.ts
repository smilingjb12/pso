import { dash as dashCfg, passiveCfg as T } from './config';
import { kindFamily, type WeaponKindDef } from './data/items';
import type { WeaponFamily } from './data/stats';

// Passives (2026-10-14, the Arts redesign; they were talents, ten Mists of Pandaria rows): the old talents' general
// effects, each unlocking at its old row's level. Since 2026-10-15 they are nodes of the Skills tree (skills.ts says
// which branch and level, and what they cost); until then they went into four slots. What used to change the light
// attack now changes the basic chain; what touched heavy
// attacks or the 3rd cast of a chain now touches Arts and the chain's 3rd step. Effects that belonged to one
// technique's form (Zonde Storm, Barta Field, Foie Split) became that technique's modifiers, Mark became a rifle Art,
// and the photon blasts moved to the Mag. Pure data + rules; Combat, Player and Game ask Character.hasPassive.

export type PassiveId =
  // shared
  | 'tempo' | 'fleet' | 'slipstream' | 'lastStand' | 'bulwark' | 'bloodlust' | 'composure' | 'rush' | 'lightFeet' | 'adrenaline'
  // Hunter
  | 'followThrough' | 'parry' | 'lunge' | 'cleave' | 'sweepGuard' | 'shockwave' | 'retaliate' | 'steadfast'
  | 'crush' | 'balance' | 'flurry' | 'secondWind' | 'hunterFocus' | 'executioner' | 'ironFinish' | 'whirl'
  | 'breaker' | 'daunt' | 'shatter' | 'fervor'
  // Ranger
  | 'hotStreak' | 'breathingRoom' | 'backstepShot' | 'spread' | 'suppress' | 'pierce'
  | 'deadeye' | 'pointBlank' | 'fieldMedic' | 'rangerFocus' | 'piercingRound' | 'pin' | 'arc'
  | 'longshot' | 'pinningFire' | 'rounds' | 'rapidFire'
  // Force
  | 'resonance' | 'calmMind' | 'blink' | 'overcast' | 'barrier' | 'purify' | 'focusBolt' | 'ward' | 'conductor'
  | 'efficiency' | 'clarity' | 'siphonStaff' | 'overload' | 'aegis' | 'echo' | 'kindle' | 'frostbite' | 'techLongshot'
  | 'swiftCast';

/** The weapon a passive needs in hand to work (none: it works with anything, techniques included). */
export interface PassiveNeed {
  family: WeaponFamily;
  /** One weapon kind only (the Hunter's weight passives). */
  kinds?: string[];
}

export interface PassiveDef {
  name: string;
  /** What it does, with live numbers at `k` of its full effect (its rank / its top rank; 1 = the top rank). */
  desc: (k?: number) => string;
  needs?: PassiveNeed;
  /** Offence / defence / utility (its colour in the menu). */
  role: 'offence' | 'defence' | 'utility';
}

const pct = (f: number) => Math.round(f * 100);
/** A passive's number at `k` of its full effect: a multiplier moves from 1 toward it, an amount from 0. */
export const rankMult = (full: number, k: number) => 1 + (full - 1) * k;
export const rankAmt = (full: number, k: number) => full * k;
const less = (mult: number) => pct(1 - mult);
const more = (mult: number) => pct(mult - 1);
const MELEE: PassiveNeed = { family: 'melee' };
const RANGED: PassiveNeed = { family: 'ranged' };
const STAFF: PassiveNeed = { family: 'caster' };
const PF = 'a perfect finisher (the 3rd step of a chain, chained perfectly twice)';

export const PASSIVES: Record<PassiveId, PassiveDef> = {
  // ------------------------------------------------------------ shared
  tempo: { name: 'Tempo', role: 'utility', desc: (k = 1) => `The perfect window is ${Math.round(rankAmt(T.tempoBonus, k) * 1000)} ms longer.` },
  fleet: { name: 'Fleet', role: 'defence', desc: () => `+${T.fleetCharges} dash charge (${dashCfg.charges + T.fleetCharges} instead of ${dashCfg.charges}).` },
  slipstream: { name: 'Slipstream', role: 'utility', desc: () => `Dash out of an enemy's telegraph and your next step within ${T.slipstreamTime} s lands perfect.` },
  lastStand: { name: 'Last Stand', role: 'utility', desc: () => `A hit that would knock you out leaves you at 1 HP and fires a free dose from your Mate injector. Recharges after ${T.lastStandCooldown} s.` },
  bulwark: { name: 'Bulwark', role: 'defence', desc: (k = 1) => `Area attacks, boss attacks and hazards deal ${less(rankMult(T.bulwarkMult, k))}% less, and Mate doses heal ${pct(rankAmt(T.injectorBoost, k))}% more.` },
  bloodlust: { name: 'Bloodlust', role: 'offence', desc: (k = 1) => `Your damage charges the injector ${more(rankMult(T.bloodlustMult, k))}% faster.` },
  composure: { name: 'Composure', role: 'defence', desc: (k = 1) => `After ${PF}, the next hit you take within ${T.composureTime} s deals ${less(rankMult(T.composureMult, k))}% less.` },
  rush: { name: 'Rush', role: 'utility', desc: (k = 1) => `After ${PF}, you run ${more(rankMult(T.rushRunMult, k))}% faster and dashes recharge ${more(rankMult(T.rushDashMult, k))}% faster for ${T.rushTime} s.` },
  lightFeet: { name: 'Light Feet', role: 'utility', desc: (k = 1) => `You run ${more(rankMult(T.lightFeetRunMult, k))}% faster and dashes recharge ${more(rankMult(T.lightFeetDashMult, k))}% faster.` },
  adrenaline: { name: 'Adrenaline', role: 'offence', desc: (k = 1) => `Below ${pct(T.adrenalineBelow)}% HP your weapon hits deal ${more(rankMult(T.adrenalineMult, k))}% more.` },

  // ------------------------------------------------------------ Hunter (melee)
  followThrough: { name: 'Follow-through', role: 'offence', needs: MELEE, desc: (k = 1) => `Finishers (the 3rd step of a chain) deal ${more(rankMult(T.followThroughMult, k))}% more damage.` },
  parry: { name: 'Parry', role: 'defence', needs: MELEE, desc: (k = 1) => `A perfect chain gives ${less(rankMult(T.parryMult, k))}% less damage taken for ${T.parryTime} s.` },
  lunge: { name: 'Lunge', role: 'offence', needs: MELEE, desc: () => 'A dash toward the locked target ends in a free basic swing.' },
  cleave: { name: 'Cleave', role: 'offence', needs: MELEE, desc: () => `Basic swings hit ${T.cleaveTargets} more enemy, over a ${T.cleaveArcDeg}° wider arc.` },
  sweepGuard: { name: 'Sweep Guard', role: 'defence', needs: MELEE, desc: (k = 1) => `Each enemy a basic swing hits gives ${pct(rankAmt(T.sweepGuardStep, k))}% less damage taken for ${T.sweepGuardTime} s (up to ${pct(rankAmt(T.sweepGuardMax, k))}%).` },
  shockwave: { name: 'Shockwave', role: 'utility', needs: MELEE, desc: () => 'A basic finisher knocks every enemy it hits far back.' },
  retaliate: { name: 'Retaliate', role: 'offence', needs: MELEE, desc: (k = 1) => `After an enemy hits you, your next swing or Art within ${T.retaliateTime} s deals ${more(rankMult(T.retaliateMult, k))}% more.` },
  steadfast: { name: 'Steadfast', role: 'defence', needs: MELEE, desc: () => `Every swing and Art carries Poise (hits don't cancel it before its strike), and you take ${less(T.steadfastKnockback)}% less knockback.` },
  crush: { name: 'Heavy: Crush', role: 'offence', needs: { family: 'melee', kinds: ['sword'] }, desc: (k = 1) => `Sword Arts ignore ${pct(rankAmt(T.crushDfpIgnore, k))}% of the enemy's armour.` },
  balance: { name: 'Medium: Balance', role: 'defence', needs: { family: 'melee', kinds: ['saber'] }, desc: (k = 1) => `Saber Arts deal ${more(rankMult(T.balanceMult, k))}% more and stagger harder.` },
  flurry: { name: 'Light: Flurry', role: 'utility', needs: { family: 'melee', kinds: ['dagger'] }, desc: () => `With a dagger, ${PF} strikes one more time.` },
  secondWind: { name: 'Second Wind', role: 'defence', needs: MELEE, desc: (k = 1) => `${cap(PF)} heals ${pct(rankAmt(T.secondWindHeal, k))}% of max HP.` },
  hunterFocus: { name: 'Focus', role: 'utility', needs: MELEE, desc: (k = 1) => `Basic swings refill ${more(rankMult(T.focusTpMult, k))}% more TP.` },
  executioner: { name: 'Executioner', role: 'offence', needs: MELEE, desc: (k = 1) => `A finisher deals ${more(rankMult(T.executionerMult, k))}% more to a staggered (or frozen) enemy.` },
  ironFinish: { name: 'Iron Finish', role: 'defence', needs: MELEE, desc: () => 'After a finisher lands, your next step carries Poise all the way through.' },
  whirl: { name: 'Whirl', role: 'utility', needs: MELEE, desc: () => 'A basic finisher hits all around you, and two more enemies.' },
  breaker: { name: 'Breaker', role: 'offence', needs: MELEE, desc: (k = 1) => `Melee hits fill enemy stagger meters ${more(rankMult(T.breakerMult, k))}% faster.` },
  daunt: { name: 'Daunt', role: 'defence', needs: MELEE, desc: (k = 1) => `Enemies you stagger deal ${less(rankMult(T.dauntMult, k))}% less for ${T.dauntTime} s.` },
  shatter: { name: 'Shatter', role: 'utility', needs: MELEE, desc: (k = 1) => `Staggering an enemy adds ${pct(rankAmt(T.shatterShare, k))}% of a stagger to every enemy within ${T.shatterRange} m.` },
  fervor: { name: 'Fervor', role: 'offence', needs: MELEE, desc: (k = 1) => `Swings and weapon Arts ${less(rankMult(T.swingSpeedMult, k))}% faster (wind-up and recovery), on top of Haste.` },

  // ------------------------------------------------------------ Ranger (ranged)
  hotStreak: { name: 'Hot Streak', role: 'offence', needs: RANGED, desc: (k = 1) => `Perfectly chained shots and Arts deal ${more(rankMult(T.hotStreakMult, k))}% more.` },
  breathingRoom: { name: 'Breathing Room', role: 'defence', needs: RANGED, desc: () => `A perfect shot knocks back every enemy within ${T.breathingRoomRange} m of you.` },
  backstepShot: { name: 'Backstep Shot', role: 'offence', needs: RANGED, desc: () => 'A dash away from the locked target ends in a free basic shot.' },
  spread: { name: 'Spread', role: 'offence', needs: RANGED, desc: () => 'Basic shots fire one more projectile (shots two more), and hit one more enemy.' },
  suppress: { name: 'Suppress', role: 'defence', needs: RANGED, desc: (k = 1) => `Enemies hit by your basic shots deal ${less(rankMult(T.suppressMult, k))}% less for ${T.suppressTime} s.` },
  pierce: { name: 'Pierce', role: 'utility', needs: RANGED, desc: () => 'Basic shots pass through one more enemy.' },
  deadeye: { name: 'Deadeye', role: 'offence', needs: RANGED, desc: (k = 1) => `Gun Arts deal ${more(rankMult(T.deadeyeMult, k))}% more, and every shot loses half as much damage at long range.` },
  pointBlank: { name: 'Point Blank', role: 'defence', needs: RANGED, desc: () => `A gun Art that hits an enemy within ${T.pointBlankRange} m knocks it far back and refunds a dash charge (once every ${T.pointBlankCooldown} s).` },
  fieldMedic: { name: 'Field Medic', role: 'defence', desc: (k = 1) => `Mate injector doses heal ${pct(rankAmt(T.fieldMedicBoost, k))}% more.` },
  rangerFocus: { name: 'Focus', role: 'utility', needs: RANGED, desc: (k = 1) => `Basic shots refill ${more(rankMult(T.focusTpMult, k))}% more TP.` },
  piercingRound: { name: 'Piercing Round', role: 'offence', needs: RANGED, desc: () => 'A basic finisher shot pierces through every enemy in its line.' },
  pin: { name: 'Pin', role: 'defence', needs: RANGED, desc: () => `A basic finisher shot pins its target: stunned for ${T.pinStun} s.` },
  arc: { name: 'Arc', role: 'utility', needs: RANGED, desc: () => `A basic finisher shot arcs on to two more enemies nearby for ${pct(T.arcShare)}% damage and stuns them briefly.` },
  longshot: { name: 'Longshot', role: 'offence', needs: RANGED, desc: (k = 1) => `Shots deal ${more(rankMult(T.longshotMult, k))}% more to enemies more than ${T.longshotRange} m away.` },
  pinningFire: { name: 'Pinning Fire', role: 'defence', needs: RANGED, desc: (k = 1) => `Gun hits fill enemy stagger meters ${more(rankMult(T.pinningFireMult, k))}% faster.` },
  rounds: { name: 'Rounds', role: 'utility', needs: RANGED, desc: (k = 1) => `Weapon specials trigger ${more(rankMult(T.roundsMult, k))}% more often.` },
  rapidFire: { name: 'Rapid Fire', role: 'offence', needs: RANGED, desc: (k = 1) => `Shots and gun Arts ${less(rankMult(T.swingSpeedMult, k))}% faster (wind-up and recovery), on top of Haste.` },

  // ------------------------------------------------------------ Force (techniques; staff passives need a rod or wand)
  resonance: { name: 'Resonance', role: 'offence', desc: (k = 1) => `Perfectly chained techniques deal ${more(rankMult(T.resonanceMult, k))}% more.` },
  calmMind: { name: 'Calm Mind', role: 'defence', desc: (k = 1) => `A perfectly chained technique gives ${less(rankMult(T.parryMult, k))}% less damage taken for ${T.parryTime} s.` },
  blink: { name: 'Blink', role: 'offence', desc: () => 'Your dash is a blink: the same distance, almost instant, through enemies.' },
  overcast: { name: 'Overcast', role: 'offence', desc: (k = 1) => `Below ${pct(T.adrenalineBelow)}% HP your techniques deal ${more(rankMult(T.overcastMult, k))}% more.` },
  barrier: { name: 'Barrier', role: 'defence', desc: (k = 1) => `Resta healing past full HP becomes a shield (up to ${pct(rankAmt(T.barrierCap, k))}% of max HP) that fades over ${T.barrierFade} s.` },
  purify: { name: 'Purify', role: 'utility', desc: () => 'Resta also cures poison and Burn, and clears a Corruption stack.' },
  focusBolt: { name: 'Focus Bolt', role: 'offence', desc: (k = 1) => `Foie, Zonde and Barta (the single-target techniques) deal ${more(rankMult(T.focusBoltMult, k))}% more.` },
  ward: { name: 'Ward', role: 'defence', desc: (k = 1) => `Foie, Zonde and Barta give you a shield of ${pct(rankAmt(T.wardShield, k))}% max HP for ${T.wardTime} s.` },
  conductor: { name: 'Conductor', role: 'utility', desc: (k = 1) => `Techniques fill enemy stagger meters ${rankMult(T.conductorMult, k)}× as fast.` },
  efficiency: { name: 'Efficiency', role: 'offence', desc: (k = 1) => `Attack techniques cost ${less(rankMult(T.efficiencyTpMult, k))}% less TP, and Fluid doses restore ${pct(rankAmt(T.injectorBoost, k))}% more.` },
  clarity: { name: 'Clarity', role: 'defence', desc: (k = 1) => `After a Fluid injector dose, attack techniques cost no TP for ${rankAmt(T.clarityTime, k)} s.` },
  siphonStaff: { name: 'Siphon Staff', role: 'utility', needs: STAFF, desc: (k = 1) => `Photon bolts refill ${rankMult(T.siphonMult, k)}× the TP.` },
  overload: { name: 'Overload', role: 'offence', desc: (k = 1) => `An attack technique as the 3rd step of a chain deals ${more(rankMult(T.overloadMult, k))}% more and costs double TP.` },
  aegis: { name: 'Aegis', role: 'defence', desc: (k = 1) => `An attack technique as the 3rd step of a chain gives you a shield of ${pct(rankAmt(T.aegisShield, k))}% max HP for ${T.aegisTime} s.` },
  echo: { name: 'Echo', role: 'utility', desc: (k = 1) => `An attack technique as the 3rd step of a chain repeats a moment later at ${pct(rankAmt(T.echoShare, k))}% power, free.` },
  kindle: { name: 'Kindle', role: 'offence', desc: (k = 1) => `Lightning stuns ${more(rankMult(T.kindleMult, k))}% more often, and fire's Burn deals ${more(rankMult(T.kindleMult, k))}% more.` },
  frostbite: { name: 'Frostbite', role: 'defence', desc: (k = 1) => `Chilled and frozen enemies deal ${less(rankMult(T.frostbiteMult, k))}% less.` },
  techLongshot: { name: 'Longshot', role: 'utility', desc: (k = 1) => `Techniques deal ${more(rankMult(T.longshotMult, k))}% more to enemies more than ${T.longshotRange} m away.` },
  swiftCast: { name: 'Swift Cast', role: 'offence', desc: (k = 1) => `Techniques cast ${less(rankMult(T.swiftCastMult, k))}% faster (wind-up and recovery), Resta and buffs included.` },
};

function cap(s: string): string {
  return s[0].toUpperCase() + s.slice(1);
}

/** Does the weapon in hand let this passive work? */
export function weaponFits(need: PassiveNeed | undefined, kind: WeaponKindDef, armed: boolean): boolean {
  if (!need) return true;
  if (!armed || kindFamily(kind) !== need.family) return false;
  return !need.kinds || need.kinds.includes(kind.kind);
}

/** "needs a melee weapon", "needs a sword". */
export function needText(need: PassiveNeed | undefined): string {
  if (!need) return '';
  if (need.kinds) return `needs a ${need.kinds.join(' or ')}`;
  return need.family === 'caster' ? 'needs a rod or wand' : `needs a ${need.family} weapon`;
}

/** The level each passive opens at (the old talent row's). */
const LEVEL: Record<PassiveId, number> = {
  tempo: 5, followThrough: 5, parry: 5, hotStreak: 5, breathingRoom: 5, resonance: 5, calmMind: 5,
  lunge: 12, fleet: 12, slipstream: 12, backstepShot: 12, lightFeet: 12, blink: 12,
  cleave: 20, sweepGuard: 20, shockwave: 20, spread: 20, suppress: 20, pierce: 20, overcast: 20, barrier: 20, purify: 20,
  retaliate: 28, steadfast: 28, lastStand: 28, adrenaline: 28, bulwark: 28, focusBolt: 28, ward: 28, conductor: 28,
  crush: 36, balance: 36, flurry: 36, deadeye: 36, pointBlank: 36, longshot: 36, kindle: 36, frostbite: 36, techLongshot: 36,
  bloodlust: 46, secondWind: 46, hunterFocus: 46, fieldMedic: 46, rangerFocus: 46, efficiency: 46, clarity: 46, siphonStaff: 46,
  executioner: 56, ironFinish: 56, whirl: 56, piercingRound: 56, pin: 56, arc: 56, overload: 56, aegis: 56, echo: 56,
  breaker: 66, daunt: 66, shatter: 66, pinningFire: 66, rounds: 66,
  fervor: 76, composure: 76, rush: 76, rapidFire: 76, swiftCast: 76,
};

/** Passives that are on or off (one rank); the rest take up to five, the fifth being the full effect. */
const SINGLE = new Set<PassiveId>([
  'fleet', 'slipstream', 'lastStand', 'lunge', 'backstepShot', 'blink', 'shockwave', 'steadfast', 'flurry', 'whirl',
  'ironFinish', 'purify', 'piercingRound', 'spread', 'pierce', 'cleave', 'arc', 'pin', 'breathingRoom', 'pointBlank',
]);

export function passiveLevel(id: PassiveId): number {
  return LEVEL[id];
}

/** A passive's top rank. */
export function passiveRanks(id: PassiveId): number {
  return SINGLE.has(id) ? 1 : 5;
}
