import { techniques, TECH_IDS, type TechId } from './techniques';

// Arts (2026-10-14, the Arts redesign; PSU's "Photon Arts"): abilities slotted on RMB, Q, E and R. The basic chain
// (LMB, a photon bolt) refills TP; Arts spend it. Since 2026-10-21 (classes went: one caster for everyone) the Arts
// are the techniques: nine attack techniques (three elements in three shapes) and Resta. The weapon Arts of the
// Hunter and Ranger went with them.
// An Art pressed inside the basic chain's window becomes the chain's next step and gets the perfect streak
// (bolt, bolt, Art).
// Each Art has two modifier rows (pick one of three in each), opening at ranks 5 and 10 of it in the Skills trees
// (skills.ts). Effects live in combat/arts.ts; numbers are first drafts.

export type ArtId = TechId;

/** How the body moves while it plays (Player.targetPose). */
export type ArtPose = 'cast' | 'support';

export interface ArtMod {
  id: string;
  name: string;
  desc: string;
}

export interface ArtDef {
  id: ArtId;
  name: string;
  /** Character level it unlocks at. */
  level: number;
  /** Seconds of wind-up (Haste and cast speed) and of recovery. */
  windup: number;
  recovery: number;
  /** Damage per enemy hit, as a multiple of tech damage (see techniques.ts). */
  power: number;
  role: 'area' | 'single' | 'support';
  pose: ArtPose;
  /** How far it reaches (to the target, or the size of its shape). */
  range: number;
  color: number;
  desc: string;
  mods: [ArtMod[], ArtMod[]];
}

const m = (id: string, name: string, desc: string): ArtMod => ({ id, name, desc });

const TECH_MODS: Record<TechId, [ArtMod[], ArtMod[]]> = {
  foie: [
    [m('split', 'Foie Split', 'Two more fireballs at the nearest other enemies, at 40% each.'), m('big', 'Big Burst', 'Bursts 2.5 m wide.'), m('swift', 'Swift', 'Flies twice as fast.')],
    [m('searing', 'Searing', 'Its Burn deals +50%.'), m('ignite', 'Ignite', '+30% against a burning enemy.'), m('draining', 'Draining', 'Heals you 3% of the damage dealt.')],
  ],
  gifoie: [
    [m('inferno', 'Inferno', 'A 7 m ring.'), m('double', 'Double Ring', 'A second ring 0.6 s later at 50%.'), m('blast', 'Blast', 'Knocks everything back.')],
    [m('firewall', 'Firewall', 'The ring keeps burning for 3 s.'), m('ward', 'Flame Ward', 'A shield of 5% of your max HP for 3 s.'), m('quick', 'Quick', 'Casts 30% faster.')],
  ],
  rafoie: [
    [m('cataclysm', 'Cataclysm', 'A 5.5 m meteor.'), m('swift', 'Swift Meteor', 'Lands at once.'), m('twin', 'Twin Meteors', 'Two meteors at 70% each.')],
    [m('scorched', 'Scorched Earth', 'The ground burns for 7 s.'), m('impact', 'Impact', 'Stuns for 1 s.'), m('efficient', 'Efficient', '25% less TP.')],
  ],
  zonde: [
    [m('storm', 'Zonde Storm', 'Chains to five enemies.'), m('focused', 'Focused', 'No chain, +80% damage.'), m('longArc', 'Long Arc', 'Jumps up to 8 m.')],
    [m('paralyze', 'Paralyze', 'Twice the stun chance.'), m('conductor', 'Conductor', 'Twice the stagger.'), m('static', 'Static', 'Enemies hit take 10% more from everything for 4 s.')],
  ],
  gizonde: [
    [m('five', 'Five Bolts', 'Five bolts in a wider fan.'), m('long', 'Long Bolts', 'Race out 13 m.'), m('focused', 'Focused', 'One bolt, +120% damage.')],
    [m('paralyze', 'Paralyze', 'Twice the stun chance.'), m('arcing', 'Arcing', 'Each bolt jumps to one more enemy at its end.'), m('quick', 'Quick', 'Casts 30% faster.')],
  ],
  razonde: [
    [m('wide', 'Wide Storm', 'A 7 m storm.'), m('long', 'Long Storm', 'Lasts 5 s (thirteen strikes, at most five on any one enemy).'), m('eye', 'Eye of the Storm', 'Strikes favour the target.')],
    [m('paralyze', 'Paralyze', 'Twice the stun chance.'), m('efficient', 'Efficient', '25% less TP.'), m('conductor', 'Conductor', 'Twice the stagger.')],
  ],
  barta: [
    [m('field', 'Barta Field', 'Leaves an ice field for 4 s that slows enemies in it by 40%.'), m('shards', 'Shards', 'Also hits enemies within 2 m of the target at 50%.'), m('glacial', 'Glacial Spike', '+40% damage.')],
    [m('freezing', 'Freezing', 'Freezes an already chilled enemy for 1.5 s (not bosses).'), m('frostbite', 'Frostbite', 'Chilled enemies deal 20% less.'), m('quick', 'Quick', 'Casts 30% faster.')],
  ],
  gibarta: [
    [m('wide', 'Wide Wave', 'A wider cone.'), m('long', 'Long Wave', 'Rolls out 12 m.'), m('double', 'Double Wave', 'A second wave 0.5 s later at 50%.')],
    [m('freezing', 'Freezing', 'Freezes already chilled enemies for 1.5 s (not bosses).'), m('field', 'Ice Field', 'Leaves the ground icy for 4 s (slows 40%).'), m('push', 'Push', 'Knocks everything back.')],
  ],
  rabarta: [
    [m('wide', 'Wide Blizzard', 'An 8 m blizzard.'), m('long', 'Long Blizzard', 'Lasts 5 s (ten pulses).'), m('eye', 'Eye of the Storm', 'You take 20% less damage while it lasts.')],
    [m('deep', 'Deep Freeze', 'Freezes for 3 s at the end.'), m('efficient', 'Efficient', '25% less TP.'), m('shatter', 'Shatter', 'The last pulse deals ×2.5 to frozen enemies.')],
  ],
  resta: [
    [m('regen', 'Regeneration', 'Also heals 2% of your max HP a second for 5 s.'), m('greater', 'Greater Resta', 'Heals 40% more.'), m('quick', 'Quick', 'Casts 30% faster.')],
    [m('anti', 'Anti', 'Also cures poison, paralysis and Burn.'), m('desperate', 'Desperate', 'Refunds 30% of its TP when cast below 30% HP.'), m('swift', 'Swiftness', 'Run 15% faster for 4 s.')],
  ],
};

const techRole = (t: TechId): ArtDef['role'] => {
  const s = techniques[t].shape;
  return s === 'heal' ? 'support' : s === 'bolt' || s === 'spike' || s === 'chain' ? 'single' : 'area';
};

const techArt = (t: TechId): ArtDef => {
  const d = techniques[t];
  return {
    id: t, name: d.name, level: d.level, windup: d.castTime, recovery: d.recovery, power: d.power, role: techRole(t),
    pose: d.shape === 'heal' ? 'support' : 'cast', range: d.range, color: d.color, desc: d.desc, mods: TECH_MODS[t],
  };
};

export const ARTS = Object.fromEntries(TECH_IDS.map(techArt).map((a) => [a.id, a])) as Record<ArtId, ArtDef>;
export const ART_IDS = Object.keys(ARTS) as ArtId[];

/** Support techniques (they work in the city too). */
export const SUPPORT_ARTS: TechId[] = ['resta'];

/** A modifier of an Art by id (undefined if it has none by that id). */
export function artMod(id: ArtId, modId: string): ArtMod | undefined {
  return ARTS[id].mods.flat().find((x) => x.id === modId);
}
