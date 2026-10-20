import type { WeaponKind } from './items';
import type { ClassId, WeaponFamily } from './stats';
import { techniques, TECH_IDS, type TechId } from './techniques';

// Arts (2026-10-14, the Arts redesign; PSU's "Photon Arts"): abilities slotted on RMB, Q, E and R. The basic chain
// (LMB) refills TP; Arts spend it, and the defensive, control and movement ones also have cooldowns.
// - Hunter and Ranger Arts come from the weapon kind in hand (three each, PSO2 style) plus three of the class's
//   that work with any weapon of its family.
// - Force Arts are the techniques (nine attack techniques: three elements in three shapes).
// - Resta is a support Art anyone can slot (Shifta and Deband went on 2026-10-15).
// An Art pressed inside the basic chain's window becomes the chain's next step and gets the perfect streak
// (basic, basic, Art). Channels, guards and movement Arts seal the chain: nothing chains after them.
// Each Art has two modifier rows (pick one of three in each), opening at ranks 5 and 10 of it in the Skills trees
// (skills.ts; until 2026-10-15 some levels after the Art). Effects live in combat/arts.ts; numbers are first drafts.

export type ArtId =
  // Sword
  | 'cyclone' | 'groundBreaker' | 'sunder'
  // Saber
  | 'risingEdge' | 'crescent' | 'guardStance'
  // Dagger
  | 'venomEdge' | 'shadowStep' | 'bladeDance'
  // Hunter: any melee weapon
  | 'leap' | 'warCry' | 'ironWill'
  // Handgun
  | 'rapidVolley' | 'flashShot' | 'ricochet'
  // Rifle
  | 'chargedShot' | 'mark' | 'freezeRound'
  // Shot
  | 'scatterBlast' | 'napalmShell' | 'slug'
  // Ranger: any gun
  | 'freezeTrap' | 'backflipShot' | 'grenade'
  // Techniques (Force attack techniques; Resta for anyone)
  | TechId;

/** Where an Art comes from. */
export type ArtSource = { kind: WeaponKind } | { family: WeaponFamily } | { tech: TechId };

/** How the body moves while it plays (Player.targetPose). */
export type ArtPose = 'cut' | 'rise' | 'slam' | 'spin' | 'stab' | 'guard' | 'shout' | 'shoot' | 'aim' | 'lob' | 'kneel' | 'leap' | 'flip' | 'step' | 'cast' | 'support';

export interface ArtMod {
  id: string;
  name: string;
  desc: string;
}

export interface ArtDef {
  id: ArtId;
  name: string;
  from: ArtSource;
  /** Character level it unlocks at. */
  level: number;
  /** Weapon Arts: TP as a share of the class's base TP at your level (techniques: their own, see techniques.ts). */
  tpPct: number;
  /** Seconds before it can be used again (0 = none). */
  cooldown: number;
  /** Seconds of wind-up (Haste; techniques: cast speed too), of acting (a channel), and of recovery. */
  windup: number;
  channel: number;
  /**
   * Effects spread over the channel, each at the end of its share of it (Cyclone's spins, Rapid Volley's shots, a
   * Leap's landing); 0 = one effect when the wind-up ends.
   */
  ticks: number;
  recovery: number;
  /** Walk at this share of run speed while it acts (0 = rooted). */
  walk: number;
  /** Nothing chains after it (channels, guards, movement). */
  seals: boolean;
  /** Melee: Poise from the start until its strike ends (heavy blades, guards). */
  poise: boolean;
  /** Damage per enemy hit (per tick), as a multiple of one weapon hit (a basic hit is 0.7). Techniques: see power. */
  power: number;
  role: 'area' | 'single' | 'control' | 'defence' | 'mobility' | 'support';
  pose: ArtPose;
  /** How far it reaches (to the target, or the size of its shape). */
  range: number;
  color: number;
  desc: string;
  mods: [ArtMod[], ArtMod[]];
}

const m = (id: string, name: string, desc: string): ArtMod => ({ id, name, desc });

type WeaponArtDef = Omit<ArtDef, 'id' | 'from' | 'seals' | 'poise' | 'walk' | 'channel' | 'ticks' | 'cooldown' | 'color'> &
  Partial<Pick<ArtDef, 'seals' | 'poise' | 'walk' | 'channel' | 'ticks' | 'cooldown' | 'color'>>;

const weaponArt = (id: ArtId, from: ArtSource, d: WeaponArtDef): ArtDef => ({
  id, from, seals: false, poise: false, walk: 0, channel: 0, ticks: 0, cooldown: 0, color: 0xffffff, ...d,
});

const SWORD: ArtSource = { kind: 'sword' };
const SABER: ArtSource = { kind: 'saber' };
const DAGGER: ArtSource = { kind: 'dagger' };
const MELEE: ArtSource = { family: 'melee' };
const HANDGUN: ArtSource = { kind: 'handgun' };
const RIFLE: ArtSource = { kind: 'rifle' };
const SHOT: ArtSource = { kind: 'shot' };
const GUNS: ArtSource = { family: 'ranged' };

const WEAPON_ARTS: ArtDef[] = [
  // ------------------------------------------------------------- Sword (heavy: Poise, packs)
  weaponArt('cyclone', SWORD, {
    name: 'Cyclone', level: 1, tpPct: 0.24, windup: 0.15, channel: 1.2, ticks: 4, recovery: 0.35, walk: 0.5, seals: true, poise: true,
    power: 0.5, role: 'area', pose: 'spin', range: 1, color: 0x9fffc0,
    desc: 'Spin with the blade out, walking slowly: four sweeps through everything around you.',
    mods: [
      [m('vortex', 'Vortex', 'Each sweep pulls enemies 1 m in toward you.'), m('longSpin', 'Long Spin', 'Two more sweeps (+40% TP).'), m('wide', 'Wide Arc', 'Reaches 1.5 m further.')],
      [m('guarded', 'Guarded Spin', 'Each enemy hit takes 2% off your damage taken for 3 s (up to 12%).'), m('shockwave', 'Shockwave', 'The last sweep knocks everything far back.'), m('burning', 'Burning Blade', 'Enemies hit burn (40% of the hit over 3 s).')],
    ],
  }),
  weaponArt('groundBreaker', SWORD, {
    name: 'Ground Breaker', level: 12, tpPct: 0.25, windup: 0.55, recovery: 0.6, poise: true,
    power: 2.4, role: 'area', pose: 'slam', range: 8, color: 0x9fffc0,
    desc: 'An overhead slam that splits the ground: a shockwave 8 m ahead hits everything in its line and staggers hard.',
    mods: [
      [m('aftershock', 'Aftershock', 'A second shockwave follows 0.6 s later at 60%.'), m('wide', 'Wide Fissure', 'The shockwave is twice as wide.'), m('crush', 'Crush', 'Ignores 30% of armour.')],
      [m('daunt', 'Daunting', 'Enemies hit deal 20% less for 5 s.'), m('quake', 'Quake', 'Always staggers what it hits.'), m('fissure', 'Fissure', 'Leaves a crack for 4 s that slows enemies in it by 40%.')],
    ],
  }),
  weaponArt('sunder', SWORD, {
    name: 'Sunder', level: 28, tpPct: 0.18, windup: 0.38, recovery: 0.5, poise: true,
    power: 1.8, role: 'single', pose: 'cut', range: 0.4, color: 0x9fffc0,
    desc: 'A wide armour-breaking cleave: up to three enemies lose 8% armour for 8 s (stacks three times).',
    mods: [
      [m('deep', 'Deep Cut', 'Each stack takes 12% armour.'), m('lingering', 'Lingering', 'Sundering lasts 15 s.'), m('sweeping', 'Sweeping', 'Hits every enemy in the arc.')],
      [m('execute', 'Execute', '+50% against staggered enemies.'), m('rend', 'Rend', 'Enemies at three stacks take 15% more from everything.'), m('momentum', 'Momentum', 'Refunds 40% of its TP if it hits three or more enemies.')],
    ],
  }),

  // ------------------------------------------------------------- Saber (medium: the all-rounder)
  weaponArt('risingEdge', SABER, {
    name: 'Rising Edge', level: 1, tpPct: 0.2, windup: 0.32, recovery: 0.55,
    power: 2.5, role: 'single', pose: 'rise', range: 2, color: 0x3aa0ff,
    desc: 'Lunge 2 m at the target and cut upward: one big hit that staggers it hard.',
    mods: [
      [m('balanced', 'Balanced', '+20% damage, and it staggers harder.'), m('followUp', 'Follow-up', 'A second cut follows 0.25 s later at 40%.'), m('airSlash', 'Air Slash', 'Also hits enemies within 2 m of the target at 50%.')],
      [m('executioner', 'Executioner', '+40% against staggered or frozen enemies.'), m('parry', 'Parry', '15% less damage taken for 2 s after.'), m('momentum', 'Momentum', 'Refunds half its TP if it kills.')],
    ],
  }),
  weaponArt('crescent', SABER, {
    name: 'Crescent', level: 12, tpPct: 0.16, windup: 0.35, recovery: 0.5,
    power: 1.6, role: 'area', pose: 'cut', range: 9, color: 0x3aa0ff,
    desc: 'Send a photon crescent flying 9 m ahead, through up to five enemies.',
    mods: [
      [m('twin', 'Twin Crescent', 'Two crescents in a V.'), m('long', 'Long Reach', 'Flies 14 m.'), m('focused', 'Focused', 'Stops at the first enemy, for double damage.')],
      [m('shock', 'Shock Edge', '20% chance to stun.'), m('frost', 'Frost Edge', 'Chills what it hits.'), m('boomerang', 'Boomerang', 'Comes back, hitting again at 50%.')],
    ],
  }),
  weaponArt('guardStance', SABER, {
    name: 'Guard Stance', level: 28, tpPct: 0.1, cooldown: 10, windup: 0.08, channel: 1, recovery: 0.25, seals: true, poise: true,
    power: 2.5, role: 'defence', pose: 'guard', range: 1, color: 0x3aa0ff,
    desc: 'Guard for 1 s: 60% less damage and no knockback. The first hit you take sets off a counter slash at everything in reach.',
    mods: [
      [m('iron', 'Iron Guard', '80% less damage.'), m('long', 'Long Guard', 'Guards for 1.6 s.'), m('riposte', 'Riposte', 'The counter deals +50%.')],
      [m('retaliate', 'Retaliation', 'After a counter, your next three basic swings deal +25%.'), m('focus', 'Focus', 'A counter refunds 20% of your TP.'), m('quick', 'Quick Guard', 'Cooldown 6 s.')],
    ],
  }),

  // ------------------------------------------------------------- Dagger (light: single target)
  weaponArt('venomEdge', DAGGER, {
    name: 'Venom Edge', level: 1, tpPct: 0.18, windup: 0.12, channel: 0.5, ticks: 4, recovery: 0.35, seals: true,
    power: 1.05, role: 'single', pose: 'stab', range: 0.3, color: 0x90ff60,
    desc: 'Four quick stabs, each adding a stack of venom (up to five): poison that eats 15% of a stab a second for 6 s per stack.',
    mods: [
      [m('deadly', 'Deadly Venom', 'Up to eight stacks.'), m('quick', 'Quick Hands', 'Six stabs.'), m('lacerate', 'Lacerate', '+40% against poisoned enemies.')],
      [m('contagion', 'Contagion', 'A poisoned enemy that dies passes its venom to enemies within 4 m.'), m('weakening', 'Weakening', 'Poisoned enemies deal 15% less.'), m('bloodlust', 'Bloodlust', 'Venom damage charges your injector.')],
    ],
  }),
  weaponArt('shadowStep', DAGGER, {
    name: 'Shadow Step', level: 12, tpPct: 0.12, cooldown: 6, windup: 0.05, recovery: 0.15, seals: true,
    power: 2.4, role: 'mobility', pose: 'step', range: 10, color: 0xffe070,
    desc: 'Step through the shadows to the target\'s back (up to 10 m). Your next hit within 2 s is a crit.',
    mods: [
      [m('ambush', 'Ambush', 'That crit deals +50%.'), m('quick', 'Quickstep', 'Cooldown 3.5 s.'), m('vanish', 'Vanish', '50% less damage taken for 1.5 s after.')],
      [m('backstab', 'Backstab', 'The step itself strikes the target.'), m('venom', 'Venomous', 'The step adds two venom stacks.'), m('flurry', 'Flurry', 'Your next basic swing strikes twice more.')],
    ],
  }),
  weaponArt('bladeDance', DAGGER, {
    name: 'Blade Dance', level: 28, tpPct: 0.24, windup: 0.1, channel: 1, ticks: 6, recovery: 0.4, seals: true,
    power: 1.3, role: 'single', pose: 'stab', range: 0.3, color: 0xffe070,
    desc: 'Six rapid strikes on the target, +50% against a staggered or frozen one.',
    mods: [
      [m('whirl', 'Whirling', 'Every strike hits all enemies within 2.5 m.'), m('long', 'Long Dance', 'Three more strikes.'), m('execute', 'Executioner', '+100% against staggered or frozen enemies (instead of +50%).')],
      [m('evasive', 'Evasive', 'Walk at half speed while dancing.'), m('finale', 'Finale', 'The last strike always staggers.'), m('thirst', 'Bloodthirst', 'Each strike heals 0.5% of your max HP.')],
    ],
  }),

  // ------------------------------------------------------------- Hunter: any melee weapon
  weaponArt('leap', MELEE, {
    name: 'Leap', level: 5, tpPct: 0.12, cooldown: 6, windup: 0.12, channel: 0.35, ticks: 1, recovery: 0.4, seals: true, poise: true,
    power: 1.4, role: 'mobility', pose: 'leap', range: 8, color: 0xffd080,
    desc: 'Leap at the target (up to 8 m) and slam down: everything within 2.5 m of the landing is hit and staggered.',
    mods: [
      [m('far', 'Far Leap', 'Up to 12 m.'), m('crater', 'Crater', 'A 3.5 m landing.'), m('stun', 'Concussive', 'The landing stuns for 1 s.')],
      [m('swing', 'Follow Through', 'A free basic swing on landing.'), m('fleet', 'Fleet', 'Refunds a dash charge.'), m('braced', 'Braced', '30% less damage taken for 2 s after landing.')],
    ],
  }),
  weaponArt('warCry', MELEE, {
    name: 'War Cry', level: 20, tpPct: 0.15, cooldown: 15, windup: 0.35, recovery: 0.4,
    power: 0, role: 'control', pose: 'shout', range: 8, color: 0xff8050,
    desc: 'A cry that shakes everything within 8 m: they deal 25% less for 6 s, and stagger.',
    mods: [
      [m('roar', 'Roar', 'Reaches 12 m.'), m('long', 'Long Cry', 'Lasts 10 s.'), m('fearsome', 'Fearsome', 'They deal 35% less.')],
      [m('rally', 'Rally', 'Heals 10% of your max HP.'), m('battle', 'Battle Cry', 'Weapon damage +15% for 6 s.'), m('shatter', 'Shattering', 'Staggers everything it reaches outright.')],
    ],
  }),
  weaponArt('ironWill', MELEE, {
    name: 'Iron Will', level: 36, tpPct: 0.15, cooldown: 20, windup: 0.2, recovery: 0.2,
    power: 0, role: 'defence', pose: 'shout', range: 0, color: 0xc0c8ff,
    desc: 'For 5 s every swing and Art carries Poise, you take 20% less damage and nothing knocks you back.',
    mods: [
      [m('unbreakable', 'Unbreakable', '35% less damage.'), m('enduring', 'Enduring', 'Lasts 8 s.'), m('mending', 'Mending', 'Heals 2% of your max HP a second while it lasts.')],
      [m('wrath', 'Wrath', 'Each hit you take while it lasts makes your next swing deal +25%.'), m('fervent', 'Fervent', 'Swings 15% faster while it lasts.'), m('thorns', 'Thorns', 'Enemies that hit you take a basic hit\'s damage.')],
    ],
  }),

  // ------------------------------------------------------------- Handgun (fast: single target)
  weaponArt('rapidVolley', HANDGUN, {
    name: 'Rapid Volley', level: 1, tpPct: 0.2, windup: 0.15, channel: 1.2, ticks: 8, recovery: 0.35, seals: true,
    power: 0.55, role: 'single', pose: 'shoot', range: 16, color: 0xffc040,
    desc: 'Empty the magazine at the target: eight quick shots.',
    mods: [
      [m('extended', 'Extended Mag', 'Four more shots.'), m('focused', 'Focused', '+25% damage.'), m('ap', 'AP Rounds', 'Shots pierce one enemy.')],
      [m('mark', 'Marking', 'The last shot marks the target: it takes 15% more for 6 s.'), m('mobile', 'Run and Gun', 'Walk at half speed while firing.'), m('suppress', 'Suppressing', 'Enemies hit deal 15% less for 3 s.')],
    ],
  }),
  weaponArt('flashShot', HANDGUN, {
    name: 'Flash Shot', level: 12, tpPct: 0.12, cooldown: 8, windup: 0.2, recovery: 0.35,
    power: 1.2, role: 'control', pose: 'shoot', range: 16, color: 0xffffa0,
    desc: 'A blinding round: stuns the target for 2 s (bosses are immune).',
    mods: [
      [m('blinding', 'Blinding', 'Stuns for 3 s.'), m('burst', 'Flash Burst', 'Stuns up to three enemies in a cone.'), m('charged', 'Charged', '+150% damage, a 1 s stun.')],
      [m('exposed', 'Exposed', 'Stunned enemies take 20% more.'), m('quick', 'Quick Draw', 'Cooldown 5 s.'), m('room', 'Breathing Room', 'Also knocks back everything within 4 m of you.')],
    ],
  }),
  weaponArt('ricochet', HANDGUN, {
    name: 'Ricochet', level: 28, tpPct: 0.18, windup: 0.25, recovery: 0.4,
    power: 1.4, role: 'area', pose: 'shoot', range: 16, color: 0xffc040,
    desc: 'A round that bounces from the target to up to three more enemies (6 m hops).',
    mods: [
      [m('chain', 'Chain', 'Five more after the target.'), m('arc', 'Arc', 'Each bounce stuns for 0.8 s.'), m('heavy', 'Heavy Round', 'One bounce fewer, +40% damage.')],
      [m('shock', 'Shocking', '20% chance to stun each enemy hit.'), m('hunter', "Hunter's Mark", 'Marks the last enemy it hits.'), m('efficient', 'Efficient', 'Refunds 30% of its TP if it hits four or more.')],
    ],
  }),

  // ------------------------------------------------------------- Rifle (long range, lines)
  weaponArt('chargedShot', RIFLE, {
    name: 'Charged Shot', level: 1, tpPct: 0.22, windup: 0.9, recovery: 0.45,
    power: 2.6, role: 'area', pose: 'aim', range: 26, color: 0xff8040,
    desc: 'Charge, then fire a beam 26 m long through everything in its line.',
    mods: [
      [m('deadeye', 'Deadeye', '+20% damage.'), m('quick', 'Quick Charge', 'A 0.55 s wind-up.'), m('wide', 'Wide Beam', 'Twice as wide.')],
      [m('cryo', 'Cryo Round', 'Freezes the enemies it hits for 1.5 s (not bosses).'), m('mark', 'Marking', 'Marks everything it hits.'), m('impact', 'Impact', 'Staggers everything it hits.')],
    ],
  }),
  weaponArt('mark', RIFLE, {
    name: 'Mark', level: 12, tpPct: 0.08, windup: 0.2, recovery: 0.3,
    power: 0.8, role: 'control', pose: 'shoot', range: 26, color: 0xff5050,
    desc: 'Tag the target: it takes 20% more from everything for 8 s.',
    mods: [
      [m('expose', 'Expose', 'It takes 30% more.'), m('long', 'Long Mark', 'Lasts 14 s.'), m('spread', 'Spread', 'Also marks two enemies near it.')],
      [m('bounty', 'Bounty', 'A marked enemy that dies refunds 20% of your TP.'), m('pin', 'Pin', 'Marked enemies move 25% slower.'), m('weakSpot', 'Weak Spot', '+15% crit chance against marked enemies.')],
    ],
  }),
  weaponArt('freezeRound', RIFLE, {
    name: 'Freeze Round', level: 28, tpPct: 0.16, windup: 0.3, recovery: 0.4,
    power: 1.6, role: 'control', pose: 'shoot', range: 26, color: 0x80d8ff,
    desc: 'A cryo round that chills the target; one that is already chilled freezes for 2 s (bosses are immune to both).',
    mods: [
      [m('deep', 'Deep Freeze', 'Freezes for 3 s.'), m('burst', 'Frost Burst', 'Chills everything within 3 m of the target.'), m('shatter', 'Shatter', 'Against a frozen enemy it deals ×2.5.')],
      [m('frostbite', 'Frostbitten', 'Chilled enemies deal 20% less.'), m('quick', 'Quick Shot', 'Half the wind-up.'), m('glacier', 'Glacier', 'Leaves an ice field for 4 s that chills.')],
    ],
  }),

  // ------------------------------------------------------------- Shot (close cone: packs)
  weaponArt('scatterBlast', SHOT, {
    name: 'Scatter Blast', level: 1, tpPct: 0.18, windup: 0.25, recovery: 0.5,
    power: 0.8, role: 'area', pose: 'shoot', range: 8, color: 0x90ff60,
    desc: 'Nine pellets in a 60° cone, 8 m: each enemy can take up to three, and they knock back.',
    mods: [
      [m('spread', 'Wide Spread', 'Four more pellets in a wider cone.'), m('pointBlank', 'Point Blank', '+50% within 4 m.'), m('buckshot', 'Buckshot', 'Five pellets, +80% each.')],
      [m('room', 'Breathing Room', 'Knocks everything hit far back.'), m('suppress', 'Suppressing', 'Enemies hit deal 15% less for 3 s.'), m('incendiary', 'Incendiary', 'Enemies hit burn.')],
    ],
  }),
  weaponArt('napalmShell', SHOT, {
    name: 'Napalm Shell', level: 12, tpPct: 0.2, windup: 0.35, recovery: 0.5,
    power: 1.5, role: 'area', pose: 'lob', range: 10, color: 0xff7a30,
    desc: 'Lob a shell at the target: a 3 m blast, and the ground burns for 4 s.',
    mods: [
      [m('big', 'Big Shell', 'A 4 m blast.'), m('long', 'Long Burn', 'Burns for 7 s.'), m('cluster', 'Cluster', 'Three smaller shells around the target.')],
      [m('kindling', 'Kindling', 'The burn deals +50%.'), m('sticky', 'Sticky', 'Enemies in the fire move 30% slower.'), m('quick', 'Quick Load', 'Half the wind-up.')],
    ],
  }),
  weaponArt('slug', SHOT, {
    name: 'Slug', level: 28, tpPct: 0.18, windup: 0.35, recovery: 0.5,
    power: 1.9, role: 'single', pose: 'shoot', range: 11, color: 0xd0ff90,
    desc: 'One heavy round at the target: big damage, stagger and knockback.',
    mods: [
      [m('piercing', 'Piercing', 'Goes through three enemies.'), m('breaker', 'Breaker', '+50% stagger.'), m('magnum', 'Magnum', '+30% damage.')],
      [m('executioner', 'Executioner', '+40% against staggered or frozen enemies.'), m('concussive', 'Concussive', 'Stuns for 1 s.'), m('recoil', 'Recoil', 'You hop 2 m back as it fires.')],
    ],
  }),

  // ------------------------------------------------------------- Ranger: any gun
  weaponArt('freezeTrap', GUNS, {
    name: 'Freeze Trap', level: 5, tpPct: 0.12, cooldown: 12, windup: 0.25, recovery: 0.3,
    power: 2, role: 'control', pose: 'kneel', range: 3, color: 0x80d8ff,
    desc: 'Set a trap at your feet (it lasts 15 s): the first enemy to step on it freezes everything within 3 m for 2.5 s (not bosses).',
    mods: [
      [m('damage', 'Damage Trap', 'Explodes for twice a weapon hit instead of freezing.'), m('wide', 'Wide Trap', 'Reaches 4.5 m.'), m('toss', 'Toss', 'Thrown at the target instead.')],
      [m('twin', 'Twin Traps', 'Sets two.'), m('quick', 'Quick Set', 'Cooldown 8 s.'), m('frostbite', 'Frostbite', 'Frozen enemies take 20% more.')],
    ],
  }),
  weaponArt('backflipShot', GUNS, {
    name: 'Backflip Shot', level: 20, tpPct: 0.1, cooldown: 5, windup: 0.05, channel: 0.25, ticks: 1, recovery: 0.3, seals: true,
    power: 1.4, role: 'mobility', pose: 'flip', range: 16, color: 0xffd080,
    desc: 'Flip 3 m back and fire at the target as you land.',
    mods: [
      [m('double', 'Double Tap', 'Two shots.'), m('far', 'Long Flip', 'Flip 5 m.'), m('concussive', 'Concussive', 'Knocks back everything within 3 m as you flip.')],
      [m('fleet', 'Fleet', 'Refunds a dash charge.'), m('focus', 'Focus', 'Your next Art costs half the TP.'), m('arc', 'Arc', 'The shot arcs to two more enemies.')],
    ],
  }),
  weaponArt('grenade', GUNS, {
    name: 'Grenade', level: 36, tpPct: 0.15, cooldown: 8, windup: 0.3, recovery: 0.4,
    power: 2.2, role: 'area', pose: 'lob', range: 12, color: 0xffd080,
    desc: 'Lob a grenade at the target: a 3.5 m blast that stuns for 1 s.',
    mods: [
      [m('cluster', 'Cluster', 'Three grenades.'), m('big', 'Big Bang', 'A 5 m blast.'), m('sticky', 'Sticky', 'Sticks to the target and goes off 1 s later for +60%.')],
      [m('incendiary', 'Incendiary', 'Leaves fire for 4 s.'), m('cryo', 'Cryo', 'Chills everything it hits.'), m('flashbang', 'Flashbang', 'Stuns for 2 s.')],
    ],
  }),
];

/** Modifiers of the techniques (the effect code is in combat/arts.ts). */
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
    id: t, name: d.name, from: { tech: t }, level: d.level, tpPct: 0, cooldown: 0, windup: d.castTime, channel: 0, ticks: 0,
    recovery: d.recovery, walk: 0, seals: false, poise: false, power: d.power, role: techRole(t),
    pose: d.shape === 'heal' ? 'support' : 'cast', range: d.range, color: d.color, desc: d.desc, mods: TECH_MODS[t],
  };
};

export const ARTS = Object.fromEntries([...WEAPON_ARTS, ...TECH_IDS.map(techArt)].map((a) => [a.id, a])) as Record<ArtId, ArtDef>;
export const ART_IDS = Object.keys(ARTS) as ArtId[];

/** Is this Art a technique (cast speed, tech damage, technique TP)? */
export function isTechArt(id: ArtId): id is TechId {
  return 'tech' in ARTS[id].from;
}

/** Support techniques anyone can slot. */
export const SUPPORT_ARTS: TechId[] = ['resta'];

/** The classes that can learn an Art at all (support Arts: everyone; attack techniques: Forces). */
export function artClasses(id: ArtId): ClassId[] {
  const from = ARTS[id].from;
  if ('tech' in from) return SUPPORT_ARTS.includes(from.tech) ? ['hunter', 'ranger', 'force'] : ['force'];
  if ('family' in from) return from.family === 'melee' ? ['hunter'] : from.family === 'ranged' ? ['ranger'] : ['force'];
  return from.kind === 'handgun' || from.kind === 'rifle' || from.kind === 'shot' ? ['ranger'] : from.kind === 'rod' || from.kind === 'wand' ? ['force'] : ['hunter'];
}

/** A modifier of an Art by id (undefined if it has none by that id). */
export function artMod(id: ArtId, modId: string): ArtMod | undefined {
  return ARTS[id].mods.flat().find((x) => x.id === modId);
}
