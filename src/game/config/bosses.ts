export const dragon = {
  hp: 1100,
  atp: 170,
  dfp: 30,
  evp: 45,
  ata: 120,
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
  breathTickDamage: 14,
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
};

export const deRolLe = {
  hp: 2300,
  atp: 245,
  ata: 132,
  dfp: 45,
  evp: 50,
  xp: 900,
  /** Injector doses its whole HP bar is worth (see injectorCfg). */
  charge: 4.5,
  /** Shell plates: HP each, and the share of damage the boss itself takes through a plate. */
  plateHp: 150,
  plateMult: 0.3,
  maskHp: 950,
  /** Phase 2 starts by HP fraction even if the mask survives. */
  phase2At: 0.5,
  phase2DamageMult: 1.15,
  headRestMult: 1.5,
  enrageAt: 0.25,
  segments: 8,
  segSpacing: 2.1,
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
  beamTickDamage: 24,
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
};

/**
 * The Warden (Mines boss): a colossus built into the north end of its hall. It never
 * moves; it lights up the deck's cells in waves, rips laser walls with a gap down the
 * hall, locks cells down as burning floor, draws everything toward its intake, summons
 * Spark Mites and Repair Drones, and slams its hands on anyone close.
 */
export const warden = {
  hp: 9000,
  atp: 320,
  ata: 150,
  dfp: 70,
  evp: 45,
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
  wallDamage: 110,
  wallBurn: 2,
  // Lockdown: the cell you stand on (phase 2: and one more) becomes burning floor until reset.
  lockWindup: 1.5,
  lockMax: 5,
  /** Seconds the zones stay at the cap before they all reset. */
  lockHold: 8,
  /** Flat damage per half second spent in a zone (it also adds Burn). */
  lockTick: 28,
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
  hp: 14000,
  atp: 450,
  ata: 165,
  dfp: 80,
  evp: 50,
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
   * Eclipse: three Grants pillars land (grantsWindup) and leave light; eclipseWindup s after the warnings the whole
   * altar goes dark, sparing only the light, while feathers rake two of the pools. The safe pool is placed first,
   * `eclipseReach` m from you and `eclipseRing` m from the centre; the other two sit ±120° round the altar from it.
   */
  eclipseWindup: 2.8,
  eclipseReach: [4, 6.5] as [number, number],
  eclipseRing: [5, 11] as [number, number],
  /**
   * Judgement: your half goes dark (split as for the halves), a lance runs from the Angel across the other half and a
   * wing of feathers (a `judgementWingDeg` cone) sweeps the quarter of it away from you. Safe: the other quarter,
   * past the lance's edge.
   */
  judgementWindup: 2.1,
  judgementWingDeg: 100,
};
