import type { BossId } from './bosses';
import type { ClassId } from './stats';
import type { WeaponKind } from './items';

// Uniques (2026-10-12, the user's redesign): items each with one effect nothing else has and a real cost, dropped by
// bosses only. The main game (Normal, Nightmare and Hell bosses) drops one weapon per class. Falz Rift bosses drop
// their own (Rift Circles, 2026-10-17, the user's design; riftCircles.ts): every boss has a gear unique and a unique
// unit in each of the three circles (tiers 1-3, 4-6, 7-10), so every boss and every circle is worth farming. A gear
// unique has no affixes and can't be crafted: its base stats come from its item level (Rift-forged in the rifts).
// Unique units are learned into the Mag like any unit, which runs four units of any kind. Effects live in
// code (Character.hasUnique callers), their numbers in config uniqueCfg.

export type UniqueId =
  // Main game
  | 'darkFlow' | 'frozenShooter' | 'reactorRod'
  // Dragon
  | 'redRing' | 'emberCore' | 'flameVisit' | 'dragonRush' | 'dragonFang' | 'swordSaint'
  // De Rol Le
  | 'plagueMantle' | 'venomSac' | 'rolCarapace' | 'tideShell' | 'ophelieSeize' | 'hpDrain'
  // Warden
  | 'overclockCore' | 'limiter' | 'sBeatBlade' | 'v801' | 'motav' | 'yasakani'
  // Dark Falz
  | 'falzHalo' | 'devilBattle' | 'darkBridge' | 'soulEater' | 'dfShield' | 'heartOfFalz';

/** Where a unique drops: main-game bosses, or Falz Rift bosses (each its own). */
export type UniquePool = 'main' | 'rift';

/** A Rift Circle: tiers 1-3, 4-6 and 7-10. */
export type RiftCircle = 1 | 2 | 3;

export type UniqueBase = { type: 'weapon'; kind: WeaponKind } | { type: 'armor'; slot: 'frame' | 'barrier' } | { type: 'unit' };

export interface UniqueDef {
  id: UniqueId;
  name: string;
  pool: UniquePool;
  /** The class it is made for (weapons; main-pool drops lean to it). */
  cls?: ClassId;
  /** Rift uniques: the boss that drops it, and the circle it starts dropping in. */
  boss?: BossId;
  circle?: RiftCircle;
  base: UniqueBase;
  /** What it does, and what it costs (the item card's two Unique lines). */
  effect: string;
  cost: string;
  /** The finer rules, for the Uniques tab (Menu → Uniques). */
  notes?: string[];
  flavour: string;
}

const weapon = (kind: WeaponKind): UniqueBase => ({ type: 'weapon', kind });
const FRAME: UniqueBase = { type: 'armor', slot: 'frame' };
const BARRIER: UniqueBase = { type: 'armor', slot: 'barrier' };
const UNIT: UniqueBase = { type: 'unit' };

export const UNIQUES: Record<UniqueId, UniqueDef> = {
  // ------------------------------------------------------------- the main game (Hell bosses and below)
  darkFlow: {
    id: 'darkFlow', name: 'Dark Flow', pool: 'main', cls: 'hunter', base: weapon('sword'),
    effect: 'Kills heal 5% of your max HP and remove a Corruption stack',
    cost: "Mate injectors don't work",
    flavour: 'A blade of living darkness taken from Dark Falz.',
  },
  frozenShooter: {
    id: 'frozenShooter', name: 'Frozen Shooter', pool: 'main', cls: 'ranger', base: weapon('rifle'),
    effect: 'Heavy shots freeze; a shot on a frozen enemy shatters it for ×2.5 (then it can’t freeze for 3 s)',
    cost: '50% less damage to anything not frozen (bosses never freeze)',
    notes: ['A freeze holds an enemy 2.5 s; the shatter thaws it'],
    flavour: 'Fires a beam of cold white light.',
  },
  reactorRod: {
    id: 'reactorRod', name: 'Reactor Rod', pool: 'main', cls: 'force', base: weapon('rod'),
    effect: 'Each attack cast within 1.5 s of the last is 30% stronger, up to ×2',
    cost: 'Techniques cost 3× TP',
    notes: ['The steps: ×1, ×1.3, ×1.6, ×1.9, then ×2 while you keep casting'],
    flavour: "A control rod from the Mines' core, run past its limits.",
  },

  // ------------------------------------------------------------- the Dragon: fire, rampage, opening blows
  redRing: {
    id: 'redRing', name: 'Red Ring', pool: 'rift', boss: 'dragon', circle: 1, base: BARRIER,
    effect: 'Crit damage +100%',
    cost: 'Corruption resistance −50%',
    notes: ['Crits deal ×3 instead of ×2, on top of Crit damage affixes'],
    flavour: 'A crimson ring of photon plating. It burns to wear.',
  },
  emberCore: {
    id: 'emberCore', name: 'Ember Core', pool: 'rift', boss: 'dragon', circle: 1, base: UNIT,
    effect: 'Your Burns stack, up to 3 on an enemy',
    cost: 'Burn on you deals 50% more',
    flavour: "A coal from the Dragon's furnace that never cools.",
  },
  flameVisit: {
    id: 'flameVisit', name: 'Flame Visit', pool: 'rift', boss: 'dragon', circle: 2, cls: 'ranger', base: weapon('shot'),
    effect: 'Enemies that die Burning leave a 3 m fire pool for 3 s (pools can chain); Napalm Shell burns twice as long',
    cost: 'You Burn in your own fire too',
    notes: ["A pool burns whatever walks in with the dead one's Burn", 'Boss kills leave no pool'],
    flavour: 'Its shells were cast in dragon fire.',
  },
  dragonRush: {
    id: 'dragonRush', name: 'Dragon Rush', pool: 'rift', boss: 'dragon', circle: 2, base: UNIT,
    effect: 'Dashing through enemies hits each for a weapon hit and staggers it',
    cost: 'Dashes recharge 40% slower',
    notes: ['Each enemy once a dash: a strong hit (power 1; a basic hit is 0.7) with double stagger'],
    flavour: 'The charge of a beast that clears the forest in a line.',
  },
  dragonFang: {
    id: 'dragonFang', name: 'Dragon Fang', pool: 'rift', boss: 'dragon', circle: 3, cls: 'hunter', base: weapon('dagger'),
    effect: 'Kills build Rampage: +5% damage and +3% Haste a stack, up to 10, gone 3 s after your last kill. At 10, Leap and Shadow Step have no cooldown',
    cost: 'A hit for 15% of your max HP or more ends Rampage',
    notes: ["Boss kills don't build Rampage"],
    flavour: 'A fang from the Dragon, still hungry.',
  },
  swordSaint: {
    id: 'swordSaint', name: 'Proof of Sword-Saint', pool: 'rift', boss: 'dragon', circle: 3, base: UNIT,
    effect: 'Your first hit on an enemy at full HP deals ×3',
    cost: '25% less damage to enemies below half HP',
    notes: ['Between half and full HP, hits deal their usual damage'],
    flavour: 'Given to those who end a fight with the first cut.',
  },

  // ------------------------------------------------------------- De Rol Le: poison and shells
  plagueMantle: {
    id: 'plagueMantle', name: 'Plague Mantle', pool: 'rift', boss: 'derolle', circle: 1, base: FRAME,
    effect: 'Enemies that die poisoned burst, poisoning everything within 4 m with what they carried',
    cost: 'Poison on you lasts twice as long',
    notes: ['Spreads venom stacks and plain poison alike', "Boss kills don't burst"],
    flavour: "Woven from De Rol Le's shed skin.",
  },
  venomSac: {
    id: 'venomSac', name: 'Venom Sac', pool: 'rift', boss: 'derolle', circle: 1, base: UNIT,
    effect: 'Your crits poison: 20% of the crit a second for 4 s, stacking',
    cost: 'Crit damage −20%',
    notes: ['Up to 10 stacks on one enemy'],
    flavour: 'A gland that keeps weeping venom.',
  },
  rolCarapace: {
    id: 'rolCarapace', name: 'Rol Carapace', pool: 'rift', boss: 'derolle', circle: 2, base: FRAME,
    effect: 'No single hit takes more than 35% of your max HP (a failed boss mechanic still can)',
    cost: 'Injector doses restore 50% less',
    notes: ['The cap comes after your damage taken cuts'],
    flavour: "A plate of De Rol Le's shell, heavier than it looks.",
  },
  tideShell: {
    id: 'tideShell', name: 'Tide Shell', pool: 'rift', boss: 'derolle', circle: 2, base: UNIT,
    effect: 'After 8 s without taking damage you grow a shell that soaks one hit (up to 40% of your max HP)',
    cost: 'Run speed −10%',
    notes: ['Any hit, soaked or not, starts the 8 s over'],
    flavour: 'It hardens like the sea floor, given time.',
  },
  ophelieSeize: {
    id: 'ophelieSeize', name: 'Ophelie Seize', pool: 'rift', boss: 'derolle', circle: 3, cls: 'ranger', base: weapon('handgun'),
    effect: 'Every handgun hit adds a venom stack, with no cap; when a poisoned enemy dies its stacks jump to the nearest enemy',
    cost: "Handgun hits can't crit",
    notes: ['A stack deals 15% of its hit a second for 6 s', 'Stacks jump to an enemy up to 8 m away'],
    flavour: 'Its rounds carry the deep water with them.',
  },
  hpDrain: {
    id: 'hpDrain', name: 'HP/Drain', pool: 'rift', boss: 'derolle', circle: 3, base: UNIT,
    effect: '3% of the damage you deal heals you',
    cost: "Injectors don't charge from your damage (they still refill after a fight)",
    notes: ["DF Shield's healing cut counts, and it heals nothing while you are Doomed"],
    flavour: 'It drinks from whatever you hit.',
  },

  // ------------------------------------------------------------- the Warden: the tempo machine
  overclockCore: {
    id: 'overclockCore', name: 'Overclock Core', pool: 'rift', boss: 'warden', circle: 1, base: FRAME,
    effect: 'Haste from gear counts double',
    cost: 'Max HP −50%',
    flavour: "The Warden's reactor, strapped to your chest and run hot.",
  },
  limiter: {
    id: 'limiter', name: 'Limiter', pool: 'rift', boss: 'warden', circle: 1, base: UNIT,
    effect: 'Art cooldowns 30% shorter',
    cost: 'Arts cost 20% more TP',
    flavour: 'A governor chip, pulled and run without it.',
  },
  sBeatBlade: {
    id: 'sBeatBlade', name: "S-Beat's Blade", pool: 'rift', boss: 'warden', circle: 2, cls: 'hunter', base: weapon('saber'),
    effect: "An Art used as a perfect chain's third step (basic, basic, Art) costs no TP and takes 2 s off your other Arts' cooldowns",
    cost: 'Arts used outside a perfect chain cost double TP',
    notes: ["Techniques aren't affected"],
    flavour: 'It hums in time with the Warden.',
  },
  v801: {
    id: 'v801', name: 'V801', pool: 'rift', boss: 'warden', circle: 2, base: UNIT,
    effect: 'Your photon blast charges twice as fast, and firing it refills your dashes',
    cost: 'Basic hits refill 20% less TP',
    flavour: 'A Mag driver from the Mines, overvolted.',
  },
  motav: {
    id: 'motav', name: 'Prophets of Motav', pool: 'rift', boss: 'warden', circle: 3, cls: 'force', base: weapon('rod'),
    effect: 'Two different elements in a row complete a combo: the second technique hits ×2 and costs no TP, then it starts over',
    cost: 'The same element twice in a row hits 50% less',
    notes: ["Only attack techniques count (Resta and the like don't)"],
    flavour: 'A rod that answers every element with another.',
  },
  yasakani: {
    id: 'yasakani', name: 'Yasakani Magatama', pool: 'rift', boss: 'warden', circle: 3, base: UNIT,
    effect: 'Every 12 s, your next attacking Art plays again a moment later, free',
    cost: 'Max TP −25%',
    notes: ['The echo plays 0.4 s later at full power', "Movement, defence and support Arts don't echo (and don't spend it)"],
    flavour: 'A jewel that remembers what you just did.',
  },

  // ------------------------------------------------------------- Dark Falz: Corruption and sacrifice
  falzHalo: {
    id: 'falzHalo', name: 'Falz Halo', pool: 'rift', boss: 'falz', circle: 1, base: BARRIER,
    effect: 'Each Corruption stack adds 10% damage',
    cost: "Corruption doesn't wear off and pylon light doesn't shed it (a cleared room or Pioneer 2 still does)",
    flavour: "The Angel's halo, torn loose in the rifts.",
  },
  devilBattle: {
    id: 'devilBattle', name: 'Devil/Battle', pool: 'rift', boss: 'falz', circle: 1, base: UNIT,
    effect: '+3% damage for every 10% of HP you are missing (up to +27%)',
    cost: 'HP regen from gear does nothing',
    notes: ['In steps of 10%: at half HP, +15%'],
    flavour: 'It pays out in blood.',
  },
  darkBridge: {
    id: 'darkBridge', name: 'Dark Bridge', pool: 'rift', boss: 'falz', circle: 2, cls: 'force', base: weapon('wand'),
    effect: 'With too little TP, techniques cast from HP instead (2 HP for each TP short) and hit 25% harder',
    cost: 'Max TP −40%',
    notes: ['Attack techniques only, and never when the HP would kill you'],
    flavour: 'A bridge between the light and what lies under it.',
  },
  soulEater: {
    id: 'soulEater', name: 'Soul Eater', pool: 'rift', boss: 'falz', circle: 2, base: UNIT,
    effect: "A kill Dooms the nearest enemy: 1.5 s later it takes 30% of the dead one's max HP (it can chain)",
    cost: 'You gain Corruption twice as fast',
    notes: ['It reaches the nearest enemy within 8 m', "Boss kills don't Doom"],
    flavour: 'Every death feeds the next.',
  },
  dfShield: {
    id: 'dfShield', name: 'DF Shield', pool: 'rift', boss: 'falz', circle: 3, base: BARRIER,
    effect: "A killing blow Dooms you instead: 4 s unkillable at 1 HP. Kill 3 enemies (or deal 3% of a boss's HP) to rise at 40% HP, or die. Once a room (against a boss: once per quarter of its HP)",
    cost: 'All healing −30%',
    notes: ['Healing: Mate doses, Resta, HP regen, HP/Drain and Dark Flow'],
    flavour: "Dark Falz's own ward, turned to keep you.",
  },
  heartOfFalz: {
    id: 'heartOfFalz', name: 'Heart of Falz', pool: 'rift', boss: 'falz', circle: 3, base: UNIT,
    effect: "Your other unique units' effects are 50% stronger",
    cost: 'So are their costs',
    notes: ["Gear uniques aren't affected"],
    flavour: 'It beats louder with every unit you feed it.',
  },
};

export const UNIQUE_IDS = Object.keys(UNIQUES) as UniqueId[];

/** The item id of gear unique `unique` at gear tier `tier` (1-15): every tier exists, the drop picks one. */
export const uniqueItemId = (id: UniqueId, tier: number): string => `unique_${id}_${tier}`;

/** The item id of a unique unit (one def each: it has no stats to scale). */
export const uniqueUnitId = (id: UniqueId): string => `uunit_${id}`;

/** Is it a unique unit (learned into the Mag) rather than gear? */
export const isUniqueUnit = (id: UniqueId): boolean => UNIQUES[id].base.type === 'unit';

/** The item to drop for a unique: a unit's one def, or gear at `tier`. */
export const uniqueDropId = (id: UniqueId, tier: number): string => (isUniqueUnit(id) ? uniqueUnitId(id) : uniqueItemId(id, tier));
