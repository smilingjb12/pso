export const dragon = {
  hp: 6111,
  atp: 108,
  armor: 14,
  techResist: 15,
  xp: 250,
  /** Injector doses its whole HP bar is worth (see injectorCfg). */
  charge: 3,
  radius: 2.6,
  moveSpeed: 2.4,
  turnSpeed: 1.3,
  stompWindup: 1.25,
  stompRadius: 6,
  breathWindup: 1,
  breathDuration: 1.8,
  breathRange: 13,
  breathArcDeg: 50,
  breathTickDamage: 12,
  /**
   * Enraged, the breath turns after you at this rate (rad/s; ~20 deg/s, ~36 deg over the breath). Was 0.7, which
   * outran a walk sideways anywhere past ~6.5 m; at 0.35 a walk out of the cone (started in the windup) keeps ahead
   * of it to ~13 m.
   */
  enragedBreathTurn: 0.35,
  chargeWindup: 0.88,
  chargeSpeed: 12,
  chargeDistance: 20,
  burrowEvery: 28,
  burrowTravel: 4,
  /** Dash check: too wide to walk out of in time (6.45 m to clear, ~5.7 m walkable; a dash by ~0.7 s clears it). */
  eruptWindup: 1.6,
  eruptRadius: 6,
  /** Enraged stomps hit wider (with the faster windup, a dash check when hugging it). */
  enragedStompRadius: 7,
  stunDuration: 3.5,
  weakPointMult: 1.5,
  enrageAt: 0.4,
  enrageSpeed: 0.75, // windup multiplier when enraged
  attackGap: 1.75,
  /** Hell: phase 3 (triple telegraphs) starts at this HP share. */
  hellPhaseAt: 1 / 3,
  /** Phase 3: one attack in this many is a triple (breath or charge + tail + Hellfire, one safe pocket). */
  tripleEvery: 2,
  /** A triple's breath / charge windup (not cut by the enrage). */
  tripleWindup: 1.7,
  /** Reaction time left out when checking the safe pocket can be walked to in time. */
  tripleReact: 0.35,
  /** Beside a breath the tail lands this long after the windup (beside a charge, at the launch). */
  tripleTailDelay: 0.4,
  /** The Hellfire (violet, corrupts) is warned this long after the other two, and lands this long after that. */
  tripleFireDelay: 0.3,
  tripleFireWindup: 1.8,
  /** Close in: the tail sweeps this far around it, leaving one wedge (deg wide, deg off its nose) open under a wing. */
  tripleWingR: 7,
  tripleWingDeg: 60,
  tripleWingAngle: 60,
  /** Farther out: the Hellfire ring around it leaves one gap this wide (m) beside the breath or the charge. */
  tripleGap: 4,
  /** Nearer than this (m), the wing pocket is tried first. */
  tripleWingRange: 8,
  /**
   * Hell: the Hellfire Rampage (2026-10-16), all fight long. She roars, lowers her head and tracks you through a
   * long windup (a violet lane from her to you); at the launch she charges down that line. A cover rock on it takes
   * the charge: it shatters and she is stunned, weak point open (`stunDuration`). In the open she runs you down
   * (homing: no sidestep or dash gets out of it) for `hell.mechanicHit` of your max HP.
   */
  rampageFirst: 6, // s of fight before the first is due (her clock: a rift's tempo speeds it up)
  rampageEvery: 16, // then due this long after the last; waiting for a normal attack's turn makes ~20-25 s apart
  /** Its windup (s), cut by the enrage like the rest ... */
  rampageWindup: 2.4,
  /** ... but never below this in real seconds, however enraged or fast (a rift's tempo): (2.0 - 0.35) x 4.6 = 7.6 m walked. */
  rampageWindupFloor: 2.0,
  /** Only when a rock's shadow is within walking reach in the windup less this reaction (else a normal attack; it stays due). */
  rampageReact: 0.35,
  /** Never within this many s after an eruption, nor with a timed burrow this close (s of stalking left). */
  rampageAfterErupt: 6,
  rampageBeforeBurrow: 4,
  /** Tracking turn rate in the windup (rad/s); in the open the charge homes at 2.5 times it. */
  rampageTurn: 4,
  rampageSpeed: 24,
  rampageKnockback: 20,
  /** It gives up after this far (m). */
  rampageMaxDistance: 40,
  /**
   * Cover rocks (Hell only), m from the arena centre (x, z; -z is her side): three round the middle, four out toward
   * the corners. Of the layouts tried in a coverage sim this one left the shortest walks to a shadow (median 4.6 m;
   * ~12% of moments out of the base windup's reach, when the rampage waits).
   */
  coverRocks: [[0, 7], [6.1, -3.5], [-6.1, -3.5], [-13, -11], [13, -11], [-13, 11], [13, 11]] as [number, number][],
  coverRockR: 1.5,
  /** With fewer than this many standing, the broken ones are called up first (the rampage waits for them). */
  rampageMinRocks: 2,
  /** A broken rock rises back over this many s (every burrow, and when too few stand), once nobody is on its spot. */
  rockRise: 1.2,
  /**
   * Hell: the fire rain (2026-10-17, the user: the Dragon was a bit too easy). On its own random clock beside
   * everything else, so it overlaps the rampage, triples and burrows: the first `fireRainFirst` s into the fight,
   * then every `fireRainEvery` s. Each batch warns `fireRainCount` circles on you one after another,
   * `fireRainStagger` s apart; each lands `fireRainWindup` s after its warning (a fireball out of the sky), so they
   * take turns: warn 1, warn 2, land 1, warn 3, land 2, land 3 (it needs stagger < windup < 2 x stagger). A landing
   * hits for `fireRainAtpMult` x ATP with Burn and leaves burning ground for `fireRainLife` s: `fireRainTick` flat
   * damage every half second and a Burn stack every second while you stand in it. All in her time (a rift's tempo).
   */
  fireRainFirst: 8,
  fireRainEvery: [12, 18] as [number, number],
  fireRainCount: 3,
  fireRainStagger: 1.2,
  fireRainWindup: 2.0,
  fireRainRadius: 2.8,
  fireRainAtpMult: 1.1,
  fireRainLife: 7,
  fireRainTick: 12,
};

export const deRolLe = {
  /**
   * 15000 since its shell stopped soaking damage (2026-10-17, the user's call). It was 12778, with shell plates and a
   * mask that passed only 30% until the mask broke and +15% taken after: ~1.17x its bar to kill, so the fights outside
   * rifts keep their length. (Rift bosses all take `riftCfg.bossHp`.)
   */
  hp: 15000,
  atp: 161,
  armor: 15,
  techResist: 10,
  xp: 900,
  /** Injector doses its whole HP bar is worth (see injectorCfg). */
  charge: 4.5,
  /** Phase 2 at this HP share: its shell (only a look now: it soaks nothing) shatters. */
  phase2At: 0.5,
  /** Damage to its head while it rests on the deck after a beam (the weak point). */
  headRestMult: 1.5,
  enrageAt: 0.25,
  /** Few, big body segments: each is a separate target, so multi-target techs mustn't hit a dozen of them. */
  segments: 3,
  segSpacing: 3,
  /** Seconds between attacks (phase 1 / phase 2). */
  attackGap: 2.1,
  attackGap2: 1.5,
  bombWindup: 1.35,
  bombRadius: 2.1,
  bombVolleys: 3,
  /** Phase 2 barrages end on a ring of bombs around you plus one on you (a dash check). */
  ringRadius: 3.2,
  ringBombs: 8,
  slamWindup: 1.7,
  /** Phase 2 slams are dash checks: a 7 m lane with a 1 s warning. */
  slamWindup2: 1.0,
  slamWidth: 7,
  slamRest: 2.3,
  beamWindup: 1.4,
  beamSweep: 3.0,
  beamRange: 22,
  beamArcDeg: 12,
  beamSpanDeg: 75,
  beamTickDamage: 18,
  headRest: 2.7,
  sprayWindup: 1.25,
  sprayPuddles: 6,
  sprayRadius: 2.0,
  puddleLife: 12,
  enrageSpeed: 0.8,
  /** Hell: phase 3 below this HP share (the shell already gone). Every tripleEvery-th attack is then a triple. */
  phase3At: 1 / 3,
  tripleEvery: 2,
  /** Warning on all three parts of a triple (its mines go off 0.25 s later, as in the Nightmare pair). */
  tripleWindup: 1.6,
  /** Clear deck (m, for your centre) in a triple's one safe pocket: lane to mine row, or along the beam's open flank. */
  triplePocket: 2.5,
  /** Width of the flank the triple beam leaves unswept (the pocket sits in it between the poison and the mines). */
  tripleFlank: 2.6,
  // Hell: the poison bomb, from the start of the fight. Lobbed onto the deck, it sits armed with a fuse; destroy it
  // (its own HP: none of it comes off the boss) or it blows and leaves a big poison area.
  /** Seconds between lobs (boss time; the first this long after the intro). Phase 3 lobs two; never more than hellBombMax on the raft. */
  hellBombEvery: 17,
  hellBombFirst: 5,
  hellBombMax: 2,
  /** Flight time (s); it lands this far (m) from you, on the deck, clear of the worm's body, the other bomb and old poison. */
  hellBombLob: 1.1,
  hellBombRange: [4, 8] as [number, number],
  /** HP (× the difficulty's boss HP multiplier): about 2.5 s of focused damage from Hell Caves gear. */
  hellBombHp: 500,
  /** Fuse (s), its last hellBombWarn s a telegraph. At a rift's tempo the fuse never runs under hellBombFuseFloor real seconds. */
  hellBombFuse: 9,
  hellBombFuseFloor: 8,
  hellBombWarn: 2,
  /** The blast: radius (m) and × ATP (it poisons). Its poison: a puddle in the middle and seven hellBombRing m out, ~5-5.7 m in all. */
  hellBombRadius: 5.5,
  hellBombAtp: 1.2,
  hellBombPuddle: 2.3,
  hellBombRing: 3.4,
  hellBombPoisonLife: 22,
};

/**
 * The Warden (Mines boss): a colossus built into the north end of its hall. It never
 * moves; it lights up the deck's cells in waves, rips laser walls with a gap down the
 * hall, locks cells down as burning floor, draws everything toward its intake, summons
 * Spark Mites and Repair Drones, and slams its hands on anyone close.
 */
export const warden = {
  hp: 50000,
  atp: 206,
  armor: 18,
  techResist: 4,
  xp: 1600,
  /** Injector doses its whole HP bar is worth. */
  charge: 4.5,
  phase2At: 0.5,
  enrageAt: 0.25,
  /** Windup multiplier when enraged. */
  enrageSpeed: 0.8,
  /** Metres at the hall's north end that belong to the Warden (the deck starts after them). */
  alcove: 6,
  /** Deck cell size (m): floor patterns and lockdown zones use this grid. */
  cell: 4,
  /** Hit circle of its core, centred just inside the alcove. */
  bodyRadius: 2.6,
  /** Seconds between attacks (phase 1 / 2). */
  attackGap: 2.4,
  attackGap2: 1.7,
  // Floor patterns: waves of lit cells; each wave's warning appears as the last one fires.
  patternWindup: 1.4,
  patternWindup2: 1.15,
  patternWaves: 3,
  patternWaves2: 5,
  patternAtpMult: 0.9,
  /** After a pattern its core vents: open for this long, taking this much more damage. */
  ventTime: 3,
  ventMult: 1.5,
  // Laser wall: its starting line (with the gap) is shown, then it rips down the hall.
  // Phase 2: a second wall follows from the Warden with its gap 5-8 m from the first.
  wallWindup: 1.6,
  wallWindup2: 1.5,
  wallTime: 1.5,
  wallGap: 5,
  wallDamage: 72,
  wallBurn: 2,
  // Lockdown: the cell you stand on (phase 2: and one more) becomes burning floor until reset.
  lockWindup: 1.5,
  lockMax: 5,
  /** Seconds the zones stay at the cap before they all reset. */
  lockHold: 8,
  /** Flat damage per half second spent in a zone (it also adds Burn). */
  lockTick: 18,
  // Hand slam on anyone within slamRange of its alcove.
  slamRange: 9,
  slamWindup: 1.4,
  /** Phase 2 slams (a pair): with the radius, a dash check. */
  slamWindup2: 1.0,
  slamRadius: 3.5,
  slamAtpMult: 1.3,
  // Intake: it draws everyone toward its core (m/s; walking is 4.6), then the nearest rows blast.
  intakeWindup: 1.3,
  intakeTime: 2.6,
  intakePull: 2.4,
  intakePull2: 3.0,
  intakeRows: 2,
  intakeAtpMult: 1.4,
  // Adds: Spark Mites per summon and alive at once, and Repair Drones alive at once.
  summonMites: 3,
  maxMites: 4,
  maxDrones: 2,
  /** Each repairing drone restores this fraction of the Warden's max HP per second. */
  droneHealPct: 0.004,
  // Hell, phase 3 (from phase3At): every tripleEvery-th attack (the first one at once) is a triple, three attacks
  // warned together around one safe cell (diagonals + wall + slam, three holes + lockdown + slam, bands + wall +
  // lockdown), then its core vents.
  phase3At: 1 / 3,
  tripleEvery: 3,
  /** Warning for all three (x the enrage speed-up); the third shows tripleStagger s later and fires with them. */
  tripleWindup: 2,
  tripleStagger: 0.3,
  /** The safe cell's inner part (0.5 m in from its edges) lies within this many metres of you (walking is 4.6 m/s). */
  tripleReach: 4.5,
  // Hell, from the start of the fight: the sequence, a memory test. It raises a shield (the cue, and fair to melee
  // and ranged alike: it takes seqShield of the damage) and lights the first cell under a pillar of light (in the
  // two rows nearest it) long enough to find it; then the other cells flash one after another, each beside
  // the one before (never burning or under the core), and go dark; then the whole deck discharges once per cell,
  // sparing only that beat's cell. Off it: hell.mechanicHit (80% of max HP, past armour). After the last discharge
  // the shield drops and its core vents. Spark Mites short out when it starts; it never shortens with the enrage.
  seqCells: 3,
  /** The first sequence is the fight's seqFirst-th attack, then every seqEvery[0]-[1] attacks (never in a triple's slot). */
  seqFirst: 2,
  seqEvery: [4, 5] as [number, number],
  /** Damage it takes while the shield is up (2026-10-17, the user's call: 80% less). */
  seqShield: 0.2,
  /**
   * Its cells all lie in the first seqRows rows, against the alcove (2026-10-17, the user: you fight close to it, and
   * cells farther out went unseen); the first within seqFirstReach cells of yours (diagonals count as one), so from
   * anywhere on the deck. It is ~6.5 s from the first cell lighting to the first discharge: ~25 m on foot.
   */
  seqRows: 2,
  seqFirstReach: 4,
  /**
   * The show: the shield rises for seqLead s, then the first cell stays lit seqFind s (time to find it); the next ones
   * light seqStep s apart, each for seqOn s; then seqPause s of dark.
   */
  seqLead: 0.6,
  seqFind: 2.5,
  seqStep: 0.75,
  seqOn: 0.6,
  seqPause: 0.6,
  /**
   * Seconds between beats (each one's whole-deck warning). The worst step, from a cell's far corner to 0.5 m inside
   * its diagonal neighbour, is 6.36 m: walking needs 0.35 s to react + 1.38 s = 1.73 s.
   */
  seqBeat: 1.9,
  /**
   * Real seconds the beats never drop under at a rift's tempo (it bites from ×1.27; at the rifts' ×1.15 they are
   * 1.65 s, 6.0 m walked): walking covers 5.3 m of the worst 6.36 in 1.5 s, walk + one dash 7.8 m. From the middle of
   * a cell walking alone still makes it.
   */
  seqBeatFloor: 1.5,
};

/**
 * Dark Falz (Ruins boss), on a round altar over the void, in three forms on both difficulties:
 *  1. the husk at the centre while Darvant flights dive along lanes and close in as rings (each flight
 *     leaves the husk open for `openTime` s);
 *  2. Dark Falz itself, walking the altar: scythe sweeps, Grants (light pillars that leave cleansing light),
 *     slow homing Megid orbs and a teleport slam (a dash check);
 *  3. the Angel at the centre: the altar splits into a light and a dark half along a line close to you
 *     (the dark half fires, then the other), feather volleys and a lance across the altar (a dash check).
 */
export const darkFalz = {
  hp: 77778,
  atp: 324,
  armor: 16,
  techResist: 0,
  xp: 2600,
  /** Injector doses its whole HP bar is worth. */
  charge: 5,
  /** HP shares where the second and third forms take over, and where it enrages. */
  form2At: 0.7,
  form3At: 0.35,
  enrageAt: 0.15,
  /** Windup multiplier when enraged. */
  enrageSpeed: 0.8,
  /** Seconds it is untouchable while changing form. */
  morphTime: 2.6,
  /** The altar's walkable radius (m). */
  altarRadius: 14,
  /** Seconds between attacks per form. */
  attackGap: [2.2, 1.8, 1.6] as [number, number, number],
  // ---- Form 1: the husk and the Darvants ----
  huskRadius: 2.4,
  /** After each flight the husk opens: this long, taking this much more damage. */
  openTime: 3,
  openMult: 1.5,
  /** Lane dives: lanes per wave, width, warning, waves and damage (× ATP). */
  lanes: 3,
  laneWidth: 2.6,
  laneWindup: 1.5,
  laneWaves: 3,
  laneAtpMult: 0.9,
  /** Ring dive: a circle closing on you. */
  ringRadius: 3.2,
  ringWindup: 1.6,
  ringAtpMult: 0.9,
  /** Husk pulse when you stand close: a corrupting shockwave around it. */
  pulseRange: 6,
  pulseRadius: 5.5,
  pulseWindup: 1.2,
  pulseAtpMult: 1.0,
  // ---- Form 2: Dark Falz ----
  bodyRadius: 1.5,
  moveSpeed: 2.6,
  scytheRange: 5,
  scytheArcDeg: 110,
  scytheWindup: 1.0,
  scytheAtpMult: 1.1,
  grantsWindup: 1.3,
  grantsRadius: 2.2,
  grantsCount: 3,
  grantsAtpMult: 0.9,
  /** Seconds a landed Grants pillar stays as light (Corruption sheds inside, like a pylon). */
  grantsLight: 4,
  megidOrbs: 2,
  megidSpeed: 3.1,
  megidLife: 6,
  megidRadius: 0.9,
  megidAtpMult: 0.8,
  /** Corruption stacks a Megid orb adds. */
  megidStacks: 2,
  /**
   * Teleport slam (a dash check): a 4.2 m circle on you the moment it starts to vanish, crashing down slamWindup s
   * later. Walking clears ~4.4 m of the 4.65 needed; walk + one dash ~6.9 m, with the dash started by ~1.1 s.
   * (It was 1.0 s from the circle appearing after a 0.45 s vanish with no warning; the user found it near impossible.)
   */
  slamWindup: 1.3,
  slamRadius: 4.2,
  slamAtpMult: 1.3,
  // ---- Form 3: the Angel ----
  /** Light and dark halves: the line runs this far from you; the dark half fires, then the other after halfFlip s. */
  halfOffset: 1.6,
  halfWindup: 1.7,
  halfFlip: 1.5,
  halfAtpMult: 0.9,
  featherLanes: 5,
  featherSpreadDeg: 14,
  featherWidth: 1.2,
  featherWindup: 1.1,
  featherAtpMult: 0.85,
  /** Lance (a dash check): a 7 m lane across the altar through you, 1 s warning. */
  lanceWidth: 7,
  lanceWindup: 1.0,
  lanceAtpMult: 1.4,
  // ---- Hell: the Angel's triples (three telegraphs at once, one safe route) ----
  /** Every this-many-th form 3 attack on Hell is a triple (Eclipse or Judgement, taking turns). */
  tripleEvery: 2,
  /** The third telegraph of a triple appears this long after the first two (it fires with them). */
  tripleDelay: 0.3,
  /**
   * Eclipse: three Grants pillars land (grantsWindup; harmless, they only bring the light) and leave light;
   * eclipseWindup s after the warnings the whole altar goes dark, sparing anyone touching light (a lit pylon's too),
   * while feathers rake two of the pools. The safe pool is placed first,
   * `eclipseReach` m from you and `eclipseRing` m from the centre; the other two sit ±120° round the altar from it.
   * 4 s and never cut by the enrage since 2026-10-17 (the user: too little time to react; it was 2.8 s, 2.2 enraged):
   * 4.7 real seconds on Hell at the Angel's speed, 4.1 in a rift. The pools' light (`grantsLight`) outlasts it.
   */
  eclipseWindup: 4,
  eclipseReach: [4, 6.5] as [number, number],
  eclipseRing: [5, 11] as [number, number],
  /**
   * Judgement: your half goes dark (split as for the halves), a lance runs from the Angel across the other half and a
   * wing of feathers (a `judgementWingDeg` cone) sweeps the quarter of it away from you. Safe: the other quarter,
   * past the lance's edge.
   */
  judgementWindup: 2.1,
  judgementWingDeg: 100,
  // ---- Hell: the Dark Tide (form 3) and Doom (forms 2 and 3) ----
  /**
   * Hell: the Angel (form 3) runs at this speed: its attacks, telegraphs, triples, the tide and Doom alike, on top of
   * a rift's tempo (2026-10-17, the user: its mechanics came a bit too fast; 15% slower).
   */
  angelTempo: 0.85,
  /**
   * Dark Tide: on its own clock beside the attacks (the first `tideFirst` s into form 3, then every `tideEvery` s)
   * `tideMotes` dark motes rise at `tideRim` m from the centre, spread round the altar, and drift to the Angel at
   * `tideSpeed` m/s (a rift's tempo speeds them, never past `tideMaxSpeed`: the ~11 m take 7-8 s). Each one that
   * arrives heals `tideHeal` of max HP (never past form3At). Walking through one (`tideRadius` m) absorbs it: +1
   * Corruption, no damage. Light dissolves them (a lit pylon, Grants or Eclipse pools). `tidePylonChance` of the tides
   * come down the rim pylons' spokes, `tideSpoke` degrees off them, so a lit pylon catches the mote on its spoke.
   */
  tideFirst: 2,
  tideEvery: [12, 15] as [number, number],
  tideMotes: [3, 4] as [number, number],
  tideRim: 13,
  tideSpeed: 1.4,
  tideMaxSpeed: 1.6,
  tideRadius: 0.55,
  tideHeal: 0.015,
  tidePylonChance: 0.6,
  tideSpoke: [8, 16] as [number, number],
  /**
   * Doom: on its own clock (the first `doomFirst` s into form 2, then every `doomEvery` s) a mark lands on you and
   * counts down `doomTime` s (real seconds; a rift's tempo never takes it under `doomMinTime`). Touch light and it is
   * cleansed at once; if the count runs out first it bursts: a `doomRadius` m blast round you (× `doomAtpMult` ATP),
   * `doomStacks` Corruption and Darvants streaking out. It never lands while you stand in light. There is always light
   * to reach: in form 2 it comes with Grants (no Megid orb) whose pools stay lit until it ends; in form 3 the Angel
   * casts it (`doomCast` s) only while a pylon within `doomReach` m of you is ready (or lit for the whole count), else
   * it waits. While a Doom runs the boss uses only
   * attacks you can sidestep on the way (the scythe, feathers: no slam, lance or triple), none landing within
   * `doomClear` s of its end. A change of form wipes it.
   */
  doomFirst: 8,
  doomEvery: [20, 28] as [number, number],
  doomTime: 6,
  doomMinTime: 5,
  doomRadius: 3,
  doomAtpMult: 1.4,
  doomStacks: 2,
  doomCast: 0.9,
  doomReach: 12,
  doomClear: 1.2,
};

/**
 * Gal Gryphon (2026-10-21; DESIGN.md "Endgame: Falz Rifts" > "Gal Gryphon"): the Rift Map's Circle II pinnacle boss,
 * a storm griffin on Storm Peak, a round summit ringed by six lightning rods. Rift-only (it guards no expedition), so
 * `rift` stands in for the Hell scaling the four get there. Seconds are its own clock (a rift's fixed tempo runs it
 * faster) unless they say real seconds. Picked by the user in a question round: Storm Peak, spent rods, two phases.
 * Made harder the same day (the user: "too easy"; their picks): relay rods, feather rain in the storm, sparks drifting
 * through the arena all fight long (one at a time from 2026-10-22), paired attacks from the start, triples in phase 2
 * and the cage below 1/3; the first draft's numbers kept.
 */
export const galGryphon = {
  /** Only the ratio to the rift's common boss HP is used (riftBossHp). */
  hp: 10000,
  atp: 120,
  armor: 10,
  techResist: 14,
  xp: 0,
  /** Injector doses its whole HP bar is worth (see injectorCfg). */
  charge: 4,
  /** What Hell's boss scaling is to the four: ATP added (235 in all, between the Dragon's and De Rol Le's), armour, technique resistance, flat damage, XP. */
  rift: { hp: 1, atp: 115, armor: 0, techResist: 14, flat: 3.5, xp: 6000 },
  radius: 2.4,
  /** The summit you can walk on (m from its centre); it lands this far north of the centre at the start. */
  arenaRadius: 16,
  perch: 9,
  walkSpeed: 2.6,
  turnSpeed: 1.6,
  /** It keeps about this far from you between attacks (m). */
  keepAway: 7,
  /** Between attacks (was 1.6 until the 2026-10-21 rework: busier between storms). */
  attackGap: 0.9,
  enrageAt: 0.2,
  enrageSpeed: 0.8,
  /** Below this HP share: the eye of the storm (triples, feather volleys, sparks off the Gryphon too, storms with a gale). */
  phase2At: 0.5,
  /** Below this HP share every `tripleEvery`-th attack is the cage (a Hell triple), and a spark comes every `sparkEvery3` s. */
  phase3At: 1 / 3,
  tripleEvery: 2,
  /** Grounded (a full rod) it takes this much damage (×1.5: +50%). */
  weakPointMult: 1.5,
  // ---- attacks (all walkable but the plummet and the crossing swoop's second lane)
  /** Talon Swoop: a lane from it through you to the far rim, `swoopWidth` m wide; it flies it at `swoopSpeed` m/s. */
  swoopWindup: 1.3,
  swoopWidth: 5,
  swoopSpeed: 24,
  swoopAtp: 1.2,
  swoopKnockback: 12,
  /** Gale Wing: a wing beat in a cone (60° / 9 m keeps it walkable from anywhere in it: the 100° / 11 m pitched wasn't), shoving you away. */
  galeWindup: 1.3,
  galeRange: 9,
  galeArcDeg: 60,
  galeAtp: 0.7,
  galeKnockback: 16,
  /** Thunder Orbs: `orbCount` circles, one on you and the rest `orbSpread` m round it, burst after the windup. */
  orbWindup: 1.4,
  orbCount: 3,
  orbRadius: 3,
  orbSpread: 4.5,
  orbAtp: 1.0,
  /**
   * Plummet: it springs up for `plummetRise` s, then a `plummetRadius` m circle on you, warned `plummetWindup` s (the
   * enrage never cuts it). 2026-10-22, the user: smaller and slower to dodge (it was a 6 m dash check warned 1.5 s);
   * now a walk: 4.95 m out of 5.6 walkable at the rift tempo.
   */
  plummetRise: 0.7,
  plummetWindup: 1.8,
  plummetRadius: 4.5,
  plummetAtp: 1.3,
  plummetKnockback: 12,
  plummetRest: 1.4,
  /**
   * Phase 2, Crossing Swoop: the first lane as a swoop's; `crossDelay` s in, a lightning lash across it through you,
   * warned `crossWindup` s. 1.0 (a dash check) until 2026-10-22, the user: too fast; 1.3 is the swoop's, a walk (enraged
   * a dash check again).
   */
  crossDelay: 0.6,
  crossWindup: 1.3,
  // ---- the storm (its signature)
  /**
   * The storm: due `stormFirst` s into the fight, then `stormEvery` s after the last was called, never sooner than
   * `stormAfterUp` s after it is back on its feet. It rises into the clouds (can't be hit) and lights one rod (a pillar
   * of light its reach wide). It pulses `pulses` times, every `pulseGap` s (never under `pulseFloor` real seconds apart):
   * the first ones do nothing, the last is the thunderstorm, the whole summit struck for `hell.mechanicHit` of your max
   * HP (a failed mechanic, past armour). Step into the lit rod's pillar at any point and the pulses stop: it discharges
   * into the Gryphon. The lit rod is one whose reach you can walk to with `stormSpare` real seconds left before the last
   * pulse. (2026-10-22, the user's design: the pulses replaced the bolts on you, 27% each unless drawn into a rod.)
   */
  stormFirst: 10,
  stormEvery: 22,
  stormAfterUp: 9,
  pulses: 3,
  pulseGap: 1.3,
  pulseFloor: 1.0,
  stormSpare: 1.0,
  /** Phase 2 storms: a gale pushes you away from the middle (m/s) from the call until you reach the pillar (or the thunderstorm). */
  galePush: 2,
  /**
   * Rods: `rodCount` round the summit `rodRing` m out (30° off north first), its pillar `rodReach` m wide. A storm
   * lights one, at random among the usable ones you can walk to (never the one you stand by, while another is in
   * reach); step into its pillar and it discharges into the Gryphon, which crashes `rodLand` m inside it, grounded for
   * `groundedTime` s (about 7 real seconds at a rift's tempo). A rod that fired is scorched for the next storm (never lit).
   */
  rodCount: 6,
  rodRing: 11,
  rodReach: 3.5,
  rodR: 0.9,
  rodLand: 5.5,
  groundedTime: 8,
  /** With no rod filled, it comes back down in the middle this long after the last bolt. */
  stormLand: 1.2,
  /**
   * Feather rain (every storm, from the clouds): every `featherEvery` s two `featherRadius` m circles, one with its
   * middle `featherNear` m off you away from the lit rod (step toward the rod), one `featherFar` m away; warned
   * `featherWindup` s, × `featherAtp` ATP. Walkable inside the reach: 2.5 - 1.5 + 0.45 = 1.45 m to get out. Warned 1.6 s
   * since 2026-10-22 (the user: more time to react; it was 1.0).
   */
  featherEvery: 1.2,
  featherWindup: 1.6,
  featherRadius: 2.5,
  featherNear: 1.5,
  featherFar: [3.5, 5] as [number, number],
  featherAtp: 0.8,
  /** Phase 2 on, outside storms: a volley of the two every this many s (2026-10-22, in place of the cyclones). */
  featherVolleyEvery: [3.5, 5.5] as [number, number],
  // ---- the sparks (2026-10-21, the user's idea: bolts that drift through the arena all the time, so you can't stand still)
  /**
   * Sparks: `sparkRadius` m balls at chest height drifting `sparkSpeed` m/s (its clock: ~1.7 real, well under your 4.6
   * walk; 3 until 2026-10-22, the user: 50% slower), gone past the rim or after `sparkLife` s (long enough to cross the
   * summit). A touch is a light hit: × `sparkAtp` ATP (about a third of a normal hit),
   * no knockback. All fight long, through storms, groundings and every attack, **one at a time** (2026-10-22, the
   * user: the streams of four and the spiral arms stacked up into lines and walls): a spark every `sparkEvery` s
   * (`sparkEvery2` in phase 2, `sparkEvery3` below 1/3) leaves a random point just past the rim, aimed at where you
   * stand give or take `sparkSpread` m, so they cross from every side; from phase 2 every `sparkFromBoss`-th one comes
   * out of the Gryphon (the middle of the sky while it is up there) in a random direction instead.
   */
  sparkRadius: 0.5,
  sparkSpeed: 1.5,
  sparkHeight: 1,
  sparkLife: 24,
  sparkAtp: 0.33,
  sparkEvery: 0.4,
  sparkEvery2: 0.35,
  sparkEvery3: 0.28,
  sparkSpread: 3,
  sparkFromBoss: 3,
  // ---- paired and triple attacks (2026-10-21: pairs from the start, triples in phase 2, the cage below 1/3)
  /** Swoop + flank orbs: orbs `flankOffset` m off the lane's middle on one side, at you and `flankSpacing` m either way. */
  flankOffset: 4.5,
  flankSpacing: 5,
  /** Plummet ring: orbs in `ringSlots` slots `ringR` m round the plummet's circle (its edge + 1.5), one slot left open (toward the middle). */
  ringSlots: 9,
  ringR: 6,
  /** The cage (below 1/3): swoop + lash crossing on you + orbs in three corners `cageOrbDist` m out; warned `cageWindup` s (never cut by the enrage); the pocket `cagePocket` m out in the fourth. */
  cageWindup: 1.6,
  cageOrbDist: 5,
  cagePocket: 4.6,
};

/**
 * Barba Ray, the Rift Map's second Circle II pinnacle boss (P2SW, between the Warden's Mines and Dark Falz's Ruins). A
 * giant manta over a temple court in the open sea, fought in three phases like Dark Falz's forms (redesigned
 * 2026-10-22: the user found the first draft too like the Gryphon, a bullet hell with two alternating phases). Damage
 * past a phase's threshold is lost, and each change of phase is a set piece it can't be hurt in.
 * 1. The Brood (100-65%): the dry court. It lays clutches of Pig Ray eggs: break them all before they hatch and it
 *    drops, stunned; a sac that hatches looses Pig Rays at you.
 * 2. High Tide (65-30%): the sea covers the court for good. Stand on the platforms, which sink and rise in turn; it
 *    attacks from the rim, its surges sweep the whole court (a platform keeps you out of them), and it rides each one in
 *    and beaches. Ul Rays hunt in the water.
 * 3. The Deep (30-0%): it drags the court under. An air meter runs down and bubbling vents refill it; it dives at you
 *    and sticks in the floor, sweeps its tail, and its wingbeats push you off the vents.
 * All numbers are first drafts.
 */
export const barbaRay = {
  /** Only the ratio to the rift's common boss HP is used (riftBossHp). */
  hp: 10000,
  atp: 120,
  armor: 10,
  techResist: 14,
  xp: 0,
  /** Injector doses its whole HP bar is worth (see injectorCfg). */
  charge: 4,
  /** What Hell's boss scaling is to the four: the Gryphon's numbers (they share Circle II). */
  rift: { hp: 1, atp: 115, armor: 0, techResist: 14, flat: 3.5, xp: 6000 },
  radius: 3,
  /** The court you can walk on (m from its centre); it hovers this far north of the centre at the start, wakes within `wakeRange` m. */
  arenaRadius: 16,
  perch: 8,
  wakeRange: 20,
  /** Its height while it glides about the court (m). */
  hover: 1.6,
  glideAbout: 3.2,
  turnSpeed: 1.4,
  /** It keeps about this far from you between attacks (m). */
  keepAway: 8,
  /** Between attacks. */
  attackGap: 1.2,
  /** Enraged (the Deep only) below this HP share: windups ×`enrageSpeed` (the belly crash and the dive never cut). */
  enrageAt: 0.15,
  enrageSpeed: 0.8,
  /** High Tide below this HP share, the Deep below `phase3At`; damage past a threshold is lost. */
  phase2At: 0.65,
  phase3At: 0.3,
  /** The changes of phase (s): untouchable while the tide comes in, then while the court goes under. */
  tideTime: 3.2,
  deepTime: 3.6,
  /** Stunned, beached or stuck in the floor it takes this much damage (×1.5: +50%). */
  weakPointMult: 1.5,
  // ---- the attacks (all walkable; warned in its clock: real seconds are these / the rift's ×1.15 tempo)
  /** Glide (the Brood): a lane from it through you to the far rim, `glideWidth` m wide; it flies it at `glideSpeed` m/s. */
  glideWindup: 1.3,
  glideWidth: 5.5,
  glideSpeed: 22,
  glideAtp: 1.2,
  glideKnockback: 10,
  /** Belly crash (the Brood): it rises `crashRise` s, then a `crashRadius` m circle on you, warned `crashWindup` s (a walk; the enrage never cuts it). */
  crashRise: 0.7,
  crashWindup: 1.8,
  crashRadius: 4.5,
  crashAtp: 1.3,
  crashKnockback: 12,
  crashRest: 1.4,
  /**
   * Ripples (after a belly crash): a tail slam sends bands of water out from it, `rippleBand` m wide from `rippleInner`
   * m, all warned at once; the first bursts after `rippleWindup` s, each next one `rippleStep` s later. Walk to the inner
   * edge of your band in the warning, then step in once the band inside has burst.
   */
  rippleWindup: 1.3,
  rippleInner: 3,
  rippleBand: 3.5,
  rippleBands: 4,
  rippleStep: 0.9,
  rippleAtp: 0.8,
  rippleKnockback: 6,
  /** Spout line (High Tide): `spoutCount` geysers `spoutSpacing` m apart from the rim toward you and past, each `spoutStagger` s after the last. */
  spoutWindup: 1.2,
  spoutCount: 5,
  spoutRadius: 2.2,
  spoutSpacing: 3,
  spoutStagger: 0.22,
  spoutAtp: 0.9,
  // ---- phase 1: the Brood
  /**
   * Clutches: `clutchFirst` s into the fight (its first move, 2026-10-22: the Brood began with nothing going on), then
   * `clutchEvery` s after the last one hatched or broke, it lays
   * `clutchCount` egg sacs (one about `clutchNear` m from you, the rest at least `clutchApart` m from each other, all
   * within `clutchRing` m of the middle), each with `clutchHpShare` of its HP and a fuse ring round it that fills until
   * it hatches `clutchHatch` s after landing. Break them all first and it shrieks and drops onto the court, stunned for
   * `stunTime` s (weak point open).
   */
  clutchFirst: 0,
  clutchEvery: 14,
  clutchCount: 3,
  clutchNear: 4,
  clutchApart: 7,
  clutchRing: 12,
  clutchHpShare: 0.015,
  clutchHatch: 11,
  clutchRadius: 0.9,
  layTime: 1.6,
  stunTime: 6,
  /**
   * An egg's brood (2026-10-22, the user's rework): every egg sends its Pig Rays dive-bombing round you, broken or
   * hatched. `barrageWaves` waves `barrageEvery` s apart, `barrageCircles` circles of `barrageRadius` m a wave spread
   * at random over the whole court, at least `barrageApart` m apart (2026-10-22, the user: more of them, not clumped
   * round you), each warned `barrageWarn` s, × `barrageAtp` ATP. Break an
   * egg and its brood comes then, so you choose when (space them out); the last one broken stuns it instead and calls
   * every brood off. Eggs left to hatch all send theirs at once, a little out of step: one is a dodge, two are hard,
   * three are too many.
   */
  barrageWaves: 4,
  barrageEvery: 0.8,
  barrageCircles: 12,
  barrageRadius: 2,
  barrageApart: 3.4,
  barrageWarn: 1.1,
  barrageAtp: 0.9,
  /**
   * Pig Rays (out of hatched sacs): each darts from its sac through near you (give or take `pigSpread` m) to past the
   * rim, its lane shown `pigWarn` s before it sets off, at `pigSpeed` m/s; a touch is a light hit (× `pigAtp` ATP).
   */
  pigWarn: 0.8,
  pigSpeed: 9,
  pigRadius: 0.6,
  pigWidth: 1.4,
  pigSpread: 1.5,
  pigAtp: 0.4,
  // ---- phase 2: High Tide
  /**
   * The water (from High Tide on, for good): off a standing platform you lose `waterShare` of your max HP a second
   * (past armour, in ticks every `waterTick` real s) and move `waterSlow` slower; a dash skims it dry.
   */
  waterShare: 0.06,
  waterTick: 0.5,
  waterSlow: 0.3,
  /**
   * The platforms: `platformCount` round the court `platformRing` m out and `innerCount` round the middle `innerRing` m
   * out, each `platformR` m across the top. `sinkFirst` s into High Tide and every `sinkEvery` s after, one glows and
   * sinks `sinkWarn` s later (the one you stand on `sinkUnder` of the time, else one near you; never fewer than
   * `keepPlatforms` standing), and each comes back up `riseAfter` s after it sank. None sink while it is beached.
   */
  platformCount: 8,
  platformRing: 9,
  innerCount: 3,
  innerRing: 4,
  platformR: 1.9,
  sinkFirst: 3,
  sinkEvery: 4,
  sinkWarn: 2.4,
  sinkUnder: 0.5,
  keepPlatforms: 5,
  riseAfter: 9,
  /**
   * In the sea it swims round the court `swimRing` m out, under the water (it can't be hit) for `swimFor` s between
   * attacks, then surfaces at the rim (it can be hit) and skims across the court (a glide) or sends a spout line.
   */
  swimRing: 19,
  swimFor: 1.6,
  /**
   * Surges: `surgeFirst` s into High Tide, then `surgeEvery` s after the last: it rears up past the rim, the court is
   * warned `surgeWarn` s, then a wall of water rolls across it at `surgeSpeed` m/s. In the water as it passes you take
   * ×`surgeAtp` ATP and a `surgeShove` m shove its way; on a standing platform it passes under you. Then it rides in
   * behind it and beaches `beachLand` m from you toward the middle (the landing warned `landWarn` s), weak point open
   * for `beachedTime` s, and slips back into the sea.
   */
  surgeFirst: 5,
  surgeEvery: 17,
  surgeWarn: 2.4,
  surgeSpeed: 12,
  surgeAtp: 1.1,
  surgeShove: 7,
  landWarn: 1.2,
  beachLand: 6,
  beachedTime: 7,
  /**
   * Ul Rays: `ulCount` fly round the court `ulSwim` m out and `ulFly` m up through High Tide, each with `ulHpShare` of
   * its HP; a dead one is replaced `ulRespawn` s later. Touching one does nothing (2026-10-22, the user). Every `ulEvery`
   * s each warns a lane from under it through you, `ulWidth` m wide, for `ulWarn` s, diving down to `ulSkim` m in its
   * last `ulDive` s; as the warning runs out the lane hits (a hit that can knock you off your platform) and it skims
   * down it at `ulSpeed` m/s, then climbs back up over `ulClimb` s.
   */
  ulCount: 2,
  ulRespawn: 12,
  ulHpShare: 0.03,
  ulSwim: 10,
  ulFly: 5,
  ulSkim: 0.8,
  ulDive: 0.35,
  ulClimb: 0.9,
  ulEvery: [3, 4.5] as [number, number],
  ulWarn: 1.2,
  ulWidth: 2.4,
  ulSpeed: 34,
  ulAtp: 0.8,
  ulKnockback: 9,
  ulRadius: 1.2,
  // ---- phase 3: the Deep
  /**
   * Air (real seconds; 2026-10-22, the user: a buff over your head with its timer): `airMax` from full, running down;
   * stepping into a flowing vent's bubbles fills it again at once. Run out and it turns into Drowning: you lose
   * `airShare` of your max HP a second (in ticks, like the water) until you reach a vent.
   */
  airMax: 10,
  airShare: 0.2,
  /**
   * Vents: four `ventInner` m out (between the axes) and four `ventOuter` m out (on them), `ventRadius` m across;
   * `ventsOn` flow at once, each for `ventLife` s, and the next one stirs `ventStir` s before it starts to flow (no air
   * yet) and before the old one stops.
   */
  ventInner: 6,
  ventOuter: 12,
  ventRadius: 1.7,
  ventsOn: 2,
  ventLife: 8,
  ventStir: 1.6,
  /** In the Deep it swims `deepHover` m over the floor. */
  deepHover: 3.5,
  /** Dive: up for `diveRise` s, a `diveRadius` m circle on you warned `diveWindup` s (never cut), then stuck in the floor `stuckTime` s (weak point open). */
  diveRise: 0.6,
  diveWindup: 1.6,
  diveRadius: 4,
  diveAtp: 1.3,
  diveKnockback: 10,
  stuckTime: 4,
  /** Tail sweep: a `sweepArc`° cone `sweepRange` m from it toward you, warned `sweepWindup` s. */
  sweepWindup: 1.3,
  sweepRange: 6.5,
  sweepArc: 120,
  sweepAtp: 1,
  sweepKnockback: 8,
  /**
   * Current: it swims over the nearest flowing vent and beats its wings at you: a `currentWidth` m lane from there
   * through you, warned `currentWarn` s, then for `currentTime` s it pushes you along it at `currentPush` m/s (no damage).
   */
  currentWarn: 1.1,
  currentWidth: 6,
  currentTime: 2.5,
  currentPush: 5,
  /**
   * Ink mark (2026-10-22, the user's idea): `inkFirst` s into the Deep, then every `inkEvery` s, it marks you for
   * `inkMark` s (shown over your head, the pool's size round your feet); as the mark runs out an ink pool `inkRadius` m
   * round (about a third of the court, the user's ask) spreads where you stand, settling over `inkSettle` s: harmless
   * till then, so a dash and a walk get you out of it. Up to `inkMax` stay down, the next one taking the oldest away
   * (the user's ask). In one you lose `inkShare` of your max HP a second (in ticks, like the water), and a vent under one
   * gives no air: carry the mark to a part of the court you can spare.
   */
  inkFirst: 5,
  inkEvery: 15,
  inkMark: 6,
  inkRadius: 9.2,
  inkSettle: 2,
  inkMax: 3,
  inkShare: 0.08,
};
