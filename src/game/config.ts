// Live-tunable gameplay numbers. The debug panel binds directly to these objects,
// so anything read from here each frame can be tweaked while playing.
// Item / class / technique data lives in ./data.

/** Light hits an area (several enemies, weaker each); heavy hits one target hard. */
export type AttackType = 'light' | 'heavy';
export type EarlyPressPolicy = 'break' | 'ignore';
export type Race = 'native' | 'abeast' | 'machine' | 'dark';

export interface AttackTiming {
  windup: number; // seconds before the hit lands
  active: number; // seconds the hit is live
  recovery: number; // seconds after the hit before the swing ends
  /** Rhythm overrides for this weapon: perfect-window length and grace (default: combo settings). */
  perfect?: number;
  grace?: number;
}

export const combo = {
  /** Fraction of the swing (0..1) after which the chain window opens. */
  windowOpen: 0.55,
  /** Extra seconds after the swing ends where the pose is held and a chain is still accepted. */
  grace: 0.18,
  /** What happens when the player presses before the window opens. */
  earlyPress: 'break' as EarlyPressPolicy,
  /** Seconds after a combo ends (or breaks) before a new one can begin. */
  resetDelay: 0.25,
  /** Extra recovery multiplier on the 3rd (finishing) hit. */
  finisherRecoveryMult: 1.5,
  /** Seconds at the start of the chain window that count as a perfect chain (weapon timing can override). */
  perfect: 0.1,
  showCue: true,
};

// Light sweeps an area (the weapon kind sets its shape and target cap) for low damage per enemy;
// heavy hits one target hard and rolls the weapon special. Heavy can't reach a sure hit: maxHit
// caps its chance after ATA, so high-ATA builds still risk misses.
export const attackTypes = {
  light: { timingMult: 1.0, recoveryMult: 1.0, damageMult: 0.7, accuracyMult: 1.0, maxHit: 100 },
  heavy: { timingMult: 1.55, recoveryMult: 1.2, damageMult: 1.5, accuracyMult: 0.8, maxHit: 85 },
};

export type WeaponWeight = 'light' | 'medium' | 'heavy';

/**
 * Melee weight classes (weaponKinds[].weight). Slow kinds pay for their swing with bigger blows:
 * heavy weapons stagger more, step further into the swing and carry Poise (an enemy hit during the
 * wind-up or strike still hurts but doesn't cancel the swing; the recovery stays punishable).
 */
export const weaponWeights: Record<WeaponWeight, { staggerMult: number; lunge: number; lungeHeavy: number; poise: boolean }> = {
  light: { staggerMult: 1, lunge: 0.25, lungeHeavy: 0.4, poise: false },
  medium: { staggerMult: 1, lunge: 0.25, lungeHeavy: 0.4, poise: false },
  heavy: { staggerMult: 2, lunge: 0.45, lungeHeavy: 0.65, poise: true },
};

/**
 * Technique forms, like attackTypes for casting: light is the area version of a spell
 * (Foie cone, Zonde chain, Barta wave), heavy the single-target one (fireball, big bolt, ice spike).
 */
export const spellForms = {
  light: { timingMult: 1.0, recoveryMult: 1.0, powerMult: 0.5, tpMult: 1.0, statusMult: 0.5 },
  heavy: { timingMult: 1.2, recoveryMult: 1.1, powerMult: 1.35, tpMult: 1.3, statusMult: 1.5 },
};

/** Accuracy multiplier by hit index in the combo (PSO used 1.0 / 1.3 / 1.69; the reward is now mostly damage). */
export const comboAccuracy = [1.0, 1.15, 1.3];

/** Damage multiplier by perfect streak: perfect chains in a row (weapon hits and attack techs). */
export const comboDamage = [1.0, 1.15, 1.4];

export const formulas = {
  /** Damage = (ATP - DFP) / divisor * scale */
  damageDivisor: 5,
  damageScale: 0.9,
  /** Hit% = ATA * mods - EVP * evpFactor */
  evpFactor: 0.2,
  minDamage: 1,
  /** Per grind level: ATP (both ends of the range) and ATA, on every weapon. */
  atpPerGrind: 2,
  ataPerGrind: 0.5,
  /**
   * MST per grind level, only on weapons that already give MST (canes, rods, wands), so a Force's grinds
   * matter as much as a Hunter's: max grind is roughly +15% technique damage, about what the ATP grind gives weapon damage.
   */
  mstPerGrind: 1.5,
  /** Enemy damage = (ATP - DFP) * enemyDamageScale */
  enemyDamageScale: 0.35,
  /** Passive TP regen per second (none: Fluid injectors and caster melee refill TP). */
  tpRegen: 0,
  /** Scales the TP that caster melee weapons restore per hit (weaponKinds[].tpOnHit). */
  meleeTpMult: 1,
  /** Weapon damage multipliers: melee takes the risk of standing in reach, so it hits harder. */
  meleeDamageMult: 1.1,
  rangedDamageMult: 0.85,
};

/** Weapon accuracy on top of the PSO hit formula. */
export const accuracy = {
  /** Flat hit % added to melee weapon attacks. */
  meleeBonus: 15,
  /** Ranged hit chance starts dropping past this distance (weaponKinds[].falloffStart overrides). */
  rangedFalloffStart: 10,
  /** Fraction of the hit chance lost per metre beyond the falloff start... */
  rangedFalloffPerM: 0.025,
  /** ...down to at most this fraction of it. */
  rangedFalloffFloor: 0.5,
};

/**
 * Stagger meter: hits add points and an enemy flinches once they reach its poise.
 * A melee heavy finisher always staggers; a light finisher counts double.
 */
export const stagger = {
  /** Per enemy hit by a light attack or light technique. */
  light: 0.6,
  /** Heavy attack or heavy technique. */
  heavy: 1.5,
  /** Gun hits stagger this fraction of a melee hit (also scaled by the weapon's damageScale). */
  rangedMult: 0.75,
  /** Hits that land while the enemy is winding up an attack count this many times over. */
  counterMult: 2,
  /** Seconds without being hit before the meter drains, and points drained per second. */
  decayDelay: 1.2,
  decayPerSec: 0.6,
};

export const player = {
  moveSpeed: 4.6,
  turnSpeed: 9, // radians/sec toward move direction
  attackTurnSpeed: 7, // how fast you can re-aim during windup
  radius: 0.45,
  hitstun: 0.45,
  iframes: 0.7,
  knockback: 5,
  pickupRange: 1.6,
  /** How close (to the box's edge) the player must be to break a supply box with the interact key. */
  boxRange: 1.2,
  interactRange: 2.6,
};

/**
 * Dash (Space + a direction): pure movement, no invulnerability. It can start at any time
 * you can act (not in hitstun or paralysis) and cancels whatever you were doing: a swing in
 * its windup never lands, a chain and its perfect streak are lost, a cast in progress fizzles
 * (its TP stays spent), the Telepipe breaks.
 */
export const dash = {
  charges: 2,
  /** Seconds to refill one charge (they refill one at a time). */
  recharge: 4.5,
  /** Metres travelled. */
  distance: 3.5,
  duration: 0.22,
  /** Seconds after a dash before you can attack or cast (walking and dashing again are fine). */
  recovery: 0.15,
  /** Burn stacks a dash shakes off. */
  burnShed: 1,
  /**
   * Boss telegraphs tuned so walking can't clear them in time (a "dash check") get a pulsing cyan
   * rim in the dash colour. Rule of thumb for tuning one: walking covers moveSpeed x (warning - ~0.35 s
   * reaction); a dash adds about 2.5 m on top. Aim the escape distance between the two.
   */
  cueTelegraphs: true,
  /** The first few dash checks remind you of the key until you've dashed this many times. */
  hintUntilDashes: 5,
};

/**
 * Technique scaling. Every class knows every technique; MST is the only thing that makes them stronger
 * (and dearer). Each tech's `power` and `tp` in techniques.ts are its values at MST = mstRef.
 */
export const techScaling = {
  /** The MST at which a technique deals / heals / costs exactly its listed power and TP. */
  mstRef: 100,
  /** Attack damage = power × (MST / mstRef)^mstExp: a little faster than MST, so the Force pulls ahead. */
  mstExp: 1.2,
  /** TP cost = tp × (tpFloor + (1 − tpFloor) × MST / mstRef): high MST casts cost more, but less per point of damage. */
  tpFloor: 0.4,
  /** Shifta / Deband: power × MST / mstRef percent, never above this. */
  buffCap: 35,
  /** Seconds a Shifta / Deband lasts. */
  buffDuration: 60,
  /** Status chance added per point of MST (on top of the tech's own chance). */
  statusPerMst: 0.0003,
  /** Burn damage per tick: 5 + MST / burnMstDivisor. */
  burnMstDivisor: 40,
};

/** Casting, including cast chains: attack techs chain like combo hits (up to 3, same perfect streak). */
export const casting = {
  /** Scales every technique's post-cast recovery (rooted after the tech fires). */
  recoveryMult: 1,
  /** Seconds after a cast (or cast chain) ends before another can begin. */
  resetDelay: 0.25,
  /** Fraction of the cast after which the next attack tech can chain. */
  windowOpen: 0.6,
  /** Extra seconds after the recovery where a chain is still accepted. */
  grace: 0.15,
  earlyPress: 'break' as EarlyPressPolicy,
  /** Extra recovery on the 3rd cast of a chain. */
  finisherRecoveryMult: 1.5,
  /** Seconds at the start of the cast-chain window that count as perfect. */
  perfect: 0.12,
};

export const lockOn = {
  range: 16,
  /** Soft auto-aim when not locked: max angle off-facing to snap an attack to a target. */
  softAimDeg: 60,
  softAimRange: 4,
  /** Ranged weapons soft-aim further, in a narrower cone. */
  rangedSoftAimDeg: 30,
  rangedSoftAimRange: 18,
  /** How strongly the camera turns to frame the locked target (per second). */
  cameraFollow: 4,
};

export const camera = {
  distance: 5,
  height: 1.5,
  sensitivity: 0.0025,
  minPitch: -0.25,
  maxPitch: 1.1,
  followLerp: 12,
  fov: 60,
};

export const feel = {
  hitstopNormal: 0.045,
  hitstopHeavy: 0.08,
  hitstopPlayerHurt: 0.09,
  shakeOnHit: 0.06,
  shakeOnHurt: 0.18,
  enemyKnockback: 2.5,
};

/** Which AI / body an archetype uses. */
export type EnemyAi = 'brawler' | 'lily' | 'panarms' | 'hidoom' | 'migium' | 'gunbot' | 'garanz' | 'sinow' | 'node' | 'mite' | 'drone';

export interface EnemyArchetype {
  name: string;
  ai: EnemyAi;
  color: number;
  scale: number;
  race: Race;
  hp: number;
  atp: number;
  dfp: number;
  ata: number;
  evp: number;
  moveSpeed: number;
  turnSpeed: number;
  aggroRange: number;
  attackRange: number;
  strikeRange: number;
  strikeArcDeg: number;
  windup: number;
  strikeActive: number;
  recovery: number;
  /** Number of strikes per attack (follow-ups use a short re-windup). */
  strikes: number;
  /** Random extra delay before deciding to attack again. */
  attackCooldown: number;
  /** Stagger points that make it flinch (a normal melee hit adds 1; see `stagger`). */
  poise: number;
  hitstun: number;
  lunge: number; // forward distance covered during the strike
  /** Knockback of a landed strike (defaults to the player's standard hit knockback). */
  strikeKnockback?: number;
  xp: number;
  meseta: [number, number];
  dropRate: number; // chance of any drop
  rareRate: number; // chance a drop is a rare
  /** Max item tier this enemy drops. */
  dropTier: number;
  /** Rares this enemy can drop (defaults to the Forest pool). */
  rarePool?: string[];
  /** Ranged / caster attacks: seconds between attacks, reach, telegraph time and blast radius. */
  shotCooldown?: number;
  shotRange?: number;
  shotWindup?: number;
  shotRadius?: number;
  /** Status the ranged attack inflicts, and its chance. */
  shotStatus?: 'poison' | 'paralysis' | 'burn';
  shotStatusChance?: number;
}

export type EnemyId =
  | 'Booma' | 'Gobooma' | 'Gigobooma'
  | 'CaveBooma' | 'CaveGobooma' | 'CaveGigobooma'
  | 'PoisonLily' | 'NarLily'
  | 'PanArms' | 'Hidoom' | 'Migium'
  | 'Gillchic' | 'Garanz' | 'Sinow' | 'ControlNode'
  | 'SparkMite' | 'RepairDrone';

const CAVE_RARES = ['lily_sting', 'spread_needle', 'coral_rod', 'red_saber', 'varista', 'club_of_laconium', 'flowens_sword'];
/** Mines enemies drop from the cave rare pool too (the Warden carries its own signature drops). */
const MINE_RARES = ['lily_sting', 'spread_needle', 'coral_rod', 'rol_lance', 'flowens_sword', 'dragon_slayer'];

export const enemies: Record<EnemyId, EnemyArchetype> = {
  Booma: {
    name: 'Booma',
    ai: 'brawler',
    color: 0x8a5a2b,
    scale: 1.0,
    race: 'abeast',
    hp: 75,
    atp: 70,
    dfp: 10,
    ata: 80,
    evp: 40,
    moveSpeed: 2.4,
    turnSpeed: 4,
    aggroRange: 18,
    attackRange: 1.9,
    strikeRange: 2.3,
    strikeArcDeg: 100,
    windup: 0.98,
    strikeActive: 0.18,
    recovery: 1.08,
    strikes: 1,
    attackCooldown: 1.04,
    poise: 1,
    hitstun: 0.46,
    lunge: 0.8,
    xp: 8,
    meseta: [8, 20],
    dropRate: 0.35,
    rareRate: 0.006,
    dropTier: 1,
  },
  Gobooma: {
    name: 'Gobooma',
    ai: 'brawler',
    color: 0x3f6b8a,
    scale: 1.12,
    race: 'abeast',
    hp: 120,
    atp: 95,
    dfp: 18,
    ata: 90,
    evp: 50,
    moveSpeed: 2.62,
    turnSpeed: 4.4,
    aggroRange: 18,
    attackRange: 2.0,
    strikeRange: 2.5,
    strikeArcDeg: 110,
    windup: 0.85,
    strikeActive: 0.18,
    recovery: 0.96,
    strikes: 1,
    attackCooldown: 0.78,
    poise: 2,
    hitstun: 0.4,
    lunge: 1.0,
    xp: 14,
    meseta: [15, 35],
    dropRate: 0.42,
    rareRate: 0.012,
    dropTier: 2,
  },
  Gigobooma: {
    name: 'Gigobooma',
    ai: 'brawler',
    color: 0x6a2f7a,
    scale: 1.25,
    race: 'abeast',
    hp: 190,
    atp: 125,
    dfp: 26,
    ata: 100,
    evp: 60,
    moveSpeed: 2.92,
    turnSpeed: 4.8,
    aggroRange: 20,
    attackRange: 2.2,
    strikeRange: 2.8,
    strikeArcDeg: 120,
    windup: 0.72,
    strikeActive: 0.22,
    recovery: 1.02,
    strikes: 2,
    attackCooldown: 0.65,
    poise: 3,
    hitstun: 0.34,
    lunge: 1.3,
    xp: 22,
    meseta: [25, 60],
    dropRate: 0.5,
    rareRate: 0.025,
    dropTier: 2,
  },

  // ---- Caves (tuned for Lv 12-22) ----
  // The Booma family in cave colours: tougher hides, harder hits, a touch faster.
  CaveBooma: {
    name: 'Cave Booma',
    ai: 'brawler',
    color: 0xa8442a,
    scale: 1.04,
    race: 'abeast',
    hp: 160,
    atp: 140,
    dfp: 30,
    ata: 108,
    evp: 65,
    moveSpeed: 2.6,
    turnSpeed: 4.4,
    aggroRange: 18,
    attackRange: 1.9,
    strikeRange: 2.4,
    strikeArcDeg: 105,
    windup: 0.88,
    strikeActive: 0.18,
    recovery: 1.0,
    strikes: 1,
    attackCooldown: 0.9,
    poise: 1,
    hitstun: 0.42,
    lunge: 0.9,
    xp: 40,
    meseta: [30, 70],
    dropRate: 0.4,
    rareRate: 0.01,
    dropTier: 4,
    rarePool: CAVE_RARES,
  },
  CaveGobooma: {
    name: 'Cave Gobooma',
    ai: 'brawler',
    color: 0x2f5a6a,
    scale: 1.15,
    race: 'abeast',
    hp: 250,
    atp: 160,
    dfp: 40,
    ata: 118,
    evp: 75,
    moveSpeed: 2.8,
    turnSpeed: 4.6,
    aggroRange: 18,
    attackRange: 2.0,
    strikeRange: 2.6,
    strikeArcDeg: 115,
    windup: 0.78,
    strikeActive: 0.18,
    recovery: 0.92,
    strikes: 1,
    attackCooldown: 0.7,
    poise: 2,
    hitstun: 0.38,
    lunge: 1.1,
    xp: 60,
    meseta: [45, 95],
    dropRate: 0.45,
    rareRate: 0.016,
    dropTier: 4,
    rarePool: CAVE_RARES,
  },
  CaveGigobooma: {
    name: 'Cave Gigobooma',
    ai: 'brawler',
    color: 0x5a5a62,
    scale: 1.28,
    race: 'abeast',
    hp: 360,
    atp: 180,
    dfp: 50,
    ata: 128,
    evp: 85,
    moveSpeed: 3.0,
    turnSpeed: 5,
    aggroRange: 20,
    attackRange: 2.2,
    strikeRange: 2.9,
    strikeArcDeg: 125,
    windup: 0.68,
    strikeActive: 0.22,
    recovery: 0.98,
    strikes: 2,
    attackCooldown: 0.6,
    poise: 3,
    hitstun: 0.32,
    lunge: 1.4,
    xp: 90,
    meseta: [60, 130],
    dropRate: 0.55,
    rareRate: 0.03,
    dropTier: 5,
    rarePool: CAVE_RARES,
  },
  // Rooted plant: spits an arcing poison glob at range, bursts its petals if you stand next to it.
  PoisonLily: {
    name: 'Poison Lily',
    ai: 'lily',
    color: 0x6a9a3a,
    scale: 1.0,
    race: 'native',
    hp: 120,
    atp: 150,
    dfp: 25,
    ata: 112,
    evp: 45,
    moveSpeed: 0,
    turnSpeed: 3,
    aggroRange: 17,
    attackRange: 2.6, // petal burst
    strikeRange: 3.0,
    strikeArcDeg: 360,
    windup: 0.75,
    strikeActive: 0.15,
    recovery: 0.9,
    strikes: 1,
    attackCooldown: 1.2,
    poise: 1,
    hitstun: 0.4,
    lunge: 0,
    xp: 45,
    meseta: [30, 70],
    dropRate: 0.45,
    rareRate: 0.012,
    dropTier: 4,
    rarePool: ['lily_sting', 'spread_needle'],
    shotCooldown: 3.6,
    shotRange: 16,
    shotWindup: 1.25,
    shotRadius: 1.7,
    shotStatus: 'poison',
    shotStatusChance: 1,
  },
  // Rare red Lily: paralysing spit, sturdier, much better drops.
  NarLily: {
    name: 'Nar Lily',
    ai: 'lily',
    color: 0xc0303a,
    scale: 1.12,
    race: 'native',
    hp: 280,
    atp: 170,
    dfp: 35,
    ata: 125,
    evp: 55,
    moveSpeed: 0,
    turnSpeed: 3.4,
    aggroRange: 18,
    attackRange: 2.8,
    strikeRange: 3.2,
    strikeArcDeg: 360,
    windup: 0.7,
    strikeActive: 0.15,
    recovery: 0.8,
    strikes: 1,
    attackCooldown: 1,
    poise: 2,
    hitstun: 0.35,
    lunge: 0,
    xp: 160,
    meseta: [150, 300],
    dropRate: 1,
    rareRate: 0.2,
    dropTier: 5,
    rarePool: ['lily_sting', 'spread_needle', 'coral_rod'],
    shotCooldown: 3.2,
    shotRange: 17,
    shotWindup: 1.15,
    shotRadius: 1.9,
    shotStatus: 'paralysis',
    shotStatusChance: 0.7,
  },
  // Slow brute with a wide two-armed slam; splits into Hidoom + Migium at half HP.
  PanArms: {
    name: 'Pan Arms',
    ai: 'panarms',
    color: 0x5a4a8a,
    scale: 1.0,
    race: 'abeast',
    hp: 560,
    atp: 190,
    dfp: 48,
    ata: 120,
    evp: 50,
    moveSpeed: 1.7,
    turnSpeed: 2.6,
    aggroRange: 20,
    attackRange: 2.8,
    strikeRange: 3.5,
    strikeArcDeg: 170,
    windup: 1.3,
    strikeActive: 0.22,
    recovery: 1.5,
    strikes: 1,
    attackCooldown: 1.2,
    poise: 5,
    hitstun: 0.3,
    lunge: 0.6,
    strikeKnockback: 11,
    xp: 0, // the halves carry the reward
    meseta: [0, 0],
    dropRate: 0,
    rareRate: 0,
    dropTier: 4,
  },
  // Red half: fast three-swipe claw flurry.
  Hidoom: {
    name: 'Hidoom',
    ai: 'hidoom',
    color: 0xb03a3a,
    scale: 1.0,
    race: 'abeast',
    hp: 200,
    atp: 160,
    dfp: 38,
    ata: 125,
    evp: 80,
    moveSpeed: 3.5,
    turnSpeed: 6,
    aggroRange: 22,
    attackRange: 1.9,
    strikeRange: 2.3,
    strikeArcDeg: 110,
    windup: 0.55,
    strikeActive: 0.12,
    recovery: 1.1,
    strikes: 3,
    attackCooldown: 0.8,
    poise: 1,
    hitstun: 0.35,
    lunge: 0.7,
    xp: 85,
    meseta: [60, 120],
    dropRate: 0.55,
    rareRate: 0.025,
    dropTier: 5,
    rarePool: CAVE_RARES,
  },
  // Blue half: keeps its distance and calls down paralysing lightning.
  Migium: {
    name: 'Migium',
    ai: 'migium',
    color: 0x3a5ab0,
    scale: 1.0,
    race: 'abeast',
    hp: 200,
    atp: 175,
    dfp: 38,
    ata: 120,
    evp: 60,
    moveSpeed: 1.6,
    turnSpeed: 4,
    aggroRange: 22,
    attackRange: 0,
    strikeRange: 0,
    strikeArcDeg: 0,
    windup: 1,
    strikeActive: 0.1,
    recovery: 1,
    strikes: 1,
    attackCooldown: 1,
    poise: 1,
    hitstun: 0.35,
    lunge: 0,
    xp: 85,
    meseta: [60, 120],
    dropRate: 0.55,
    rareRate: 0.025,
    dropTier: 5,
    rarePool: CAVE_RARES,
    shotCooldown: 3.4,
    shotRange: 15,
    shotWindup: 1.35,
    shotRadius: 2.2,
    shotStatus: 'paralysis',
    shotStatusChance: 0.35,
  },

  // ---- Mines (tuned for Lv 22-32) ----
  // Walking gunbot: keeps its distance and fires a telegraphed line shot. In a room with a
  // control node it is linked to it: it reboots after "dying" until the node is destroyed.
  Gillchic: {
    name: 'Gillchic',
    ai: 'gunbot',
    color: 0x8a96a8,
    scale: 1.0,
    race: 'machine',
    hp: 340,
    atp: 255,
    dfp: 62,
    ata: 150,
    evp: 80,
    moveSpeed: 2.2,
    turnSpeed: 4,
    aggroRange: 20,
    attackRange: 1.9, // close-range arm swipe
    strikeRange: 2.4,
    strikeArcDeg: 110,
    windup: 1.1,
    strikeActive: 0.16,
    recovery: 0.9,
    strikes: 1,
    attackCooldown: 1,
    poise: 2,
    hitstun: 0.4,
    lunge: 0.6,
    xp: 85,
    meseta: [70, 140],
    dropRate: 0.42,
    rareRate: 0.012,
    dropTier: 6,
    rarePool: MINE_RARES,
    shotCooldown: 3.4,
    shotRange: 16,
    shotWindup: 1.35,
    shotRadius: 0.9, // half the width of the shot's lane
  },
  // Artillery tank: walks slowly, plants itself (it can't turn while planted) and fires a
  // missile barrage at where you were. Its missiles hit machines and power switches too.
  Garanz: {
    name: 'Garanz',
    ai: 'garanz',
    color: 0x6a7a5a,
    scale: 1.0,
    race: 'machine',
    hp: 720,
    atp: 280,
    dfp: 78,
    ata: 140,
    evp: 50,
    moveSpeed: 1.5,
    turnSpeed: 1.6,
    aggroRange: 22,
    attackRange: 2.8, // stomp when you crowd it while it is walking
    strikeRange: 3.0,
    strikeArcDeg: 360,
    windup: 0.95,
    strikeActive: 0.15,
    recovery: 1.1,
    strikes: 1,
    attackCooldown: 1.4,
    poise: 5,
    hitstun: 0.3,
    lunge: 0,
    strikeKnockback: 10,
    xp: 160,
    meseta: [120, 240],
    dropRate: 0.6,
    rareRate: 0.03,
    dropTier: 6,
    rarePool: MINE_RARES,
    shotCooldown: 4.5,
    shotRange: 20,
    shotWindup: 1.25,
    shotRadius: 1.8,
    shotStatus: 'burn',
    shotStatusChance: 0.35,
  },
  // Ninja robot: leaps in with a quick three-hit combo (the last one burns), then
  // backflips away and lands in a short recovery: the punish window. Comes in pairs.
  Sinow: {
    name: 'Sinow Beat',
    ai: 'sinow',
    color: 0x5a6aa0,
    scale: 1.0,
    race: 'machine',
    hp: 420,
    atp: 260,
    dfp: 58,
    ata: 165,
    evp: 120,
    moveSpeed: 3.6,
    turnSpeed: 7,
    aggroRange: 22,
    attackRange: 9, // starts a leap from here
    strikeRange: 2.5,
    strikeArcDeg: 120,
    windup: 0.9, // crouch before the leap (and before a close-range combo)
    strikeActive: 0.12,
    recovery: 1.25, // after the backflip landing
    strikes: 3,
    attackCooldown: 1.6,
    poise: 2,
    hitstun: 0.35,
    lunge: 0.5,
    xp: 115,
    meseta: [90, 170],
    dropRate: 0.5,
    rareRate: 0.02,
    dropTier: 6,
    rarePool: MINE_RARES,
  },
  // The room's control node: a pylon that keeps linked gunbots rebooting. No attacks.
  ControlNode: {
    name: 'Control Node',
    ai: 'node',
    color: 0x40c0ff,
    scale: 1.0,
    race: 'machine',
    hp: 520,
    atp: 0,
    dfp: 70,
    ata: 0,
    evp: 20,
    moveSpeed: 0,
    turnSpeed: 0,
    aggroRange: 0,
    attackRange: 0,
    strikeRange: 0,
    strikeArcDeg: 0,
    windup: 1,
    strikeActive: 0.1,
    recovery: 1,
    strikes: 1,
    attackCooldown: 1,
    poise: 3,
    hitstun: 0.3,
    lunge: 0,
    xp: 120,
    meseta: [100, 200],
    dropRate: 0.8,
    rareRate: 0.02,
    dropTier: 6,
    rarePool: MINE_RARES,
  },
  // ---- The Warden's adds (summoned in its fight, never in waves; they give nothing) ----
  // Scuttles at you, squats and arms a small burning blast (strikeRange is its radius, windup its fuse).
  SparkMite: {
    name: 'Spark Mite',
    ai: 'mite',
    color: 0x8a7a68,
    scale: 0.6,
    race: 'machine',
    hp: 70,
    atp: 270,
    dfp: 30,
    ata: 160,
    evp: 50,
    moveSpeed: 3.7,
    turnSpeed: 8,
    aggroRange: 40,
    attackRange: 1.8,
    strikeRange: 2.4,
    strikeArcDeg: 360,
    windup: 1.0,
    strikeActive: 0.1,
    recovery: 0.5,
    strikes: 1,
    attackCooldown: 1,
    poise: 1,
    hitstun: 0.35,
    lunge: 0,
    xp: 0,
    meseta: [0, 0],
    dropRate: 0,
    rareRate: 0,
    dropTier: 6,
  },
  // Flies to a post by the alcove and beams repairs into the Warden's core until shot down.
  RepairDrone: {
    name: 'Repair Drone',
    ai: 'drone',
    color: 0x6a90a8,
    scale: 0.9,
    race: 'machine',
    hp: 160,
    atp: 0,
    dfp: 45,
    ata: 0,
    evp: 90,
    moveSpeed: 3.2,
    turnSpeed: 4,
    aggroRange: 0,
    attackRange: 0,
    strikeRange: 0,
    strikeArcDeg: 0,
    windup: 1,
    strikeActive: 0.1,
    recovery: 1,
    strikes: 1,
    attackCooldown: 1,
    poise: 2,
    hitstun: 0.45,
    lunge: 0,
    xp: 0,
    meseta: [0, 0],
    dropRate: 0,
    rareRate: 0,
    dropTier: 6,
  },
};

/** Elite spawns (Caves, Mines): tougher, tinted, better rewards. */
export const elite = {
  chance: 1 / 12,
  hpMult: 1.6,
  atpMult: 1.25,
  xpMult: 2,
  /** Extra stagger points an elite needs before it flinches. */
  poiseBonus: 1,
};

/**
 * Elite affixes. Normal Mines elites roll Overclocked or Volatile; on Hard every elite (and
 * champion) rolls from the whole pool (see data/affixes.ts).
 */
export const affixes = {
  /** Overclocked: movement and attack speed (the total tempo is capped at tempoCap). */
  overclockedTempo: 1.5,
  tempoCap: 1.5,
  /** Overclocked: every attack is followed at once by one more; its windup is this share of the normal one. */
  followUpWindup: 0.6,
  /** Volatile death blast: radius, warning, damage (× the elite's ATP), Burn, and the burning ground it leaves. */
  volatileRadius: 3.8,
  volatileWindup: 1.3,
  volatileAtpMult: 0.9,
  volatileBurn: 3,
  volatileGroundLife: 4,
  /** Volatile vent: while you are within ventRange, a blast around itself every ventEvery s. */
  ventEvery: 4,
  ventRange: 3.6,
  ventRadius: 2.6,
  ventWindup: 0.9,
  ventAtpMult: 0.6,
  /** Shielding: allies within this range (up to shieldTargets) take shieldMult damage while it lives. */
  shieldRange: 8,
  shieldTargets: 3,
  shieldMult: 0.3,
  /** Shielding with nobody left to protect: damage from in front of it (within this half-arc) is cut this much. */
  selfShieldMult: 0.4,
  selfShieldArcDeg: 70,
  /** Shielding: how far behind its allies (away from you) it tries to stand. */
  shieldHangBack: 2.5,
  /** Regenerating: max HP healed per second, once it hasn't been hit for regenDelay s (Burn / Poison stop it). */
  regenPerSec: 0.04,
  regenDelay: 2,
  /** Regenerating: every regenPulseEvery s, allies within regenPulseRange heal this share of their max HP. */
  regenPulseEvery: 8,
  regenPulseRange: 6,
  regenPulseHeal: 0.12,
  /** Splitting: this many copies with this share of max HP each, smaller and faster. */
  splitCount: 3,
  splitHp: 0.35,
  splitScale: 0.72,
  splitSpeed: 1.3,
  /** Molten: a burning patch every moltenEvery seconds while it walks. */
  moltenEvery: 0.55,
  moltenRadius: 1.3,
  moltenLife: 6,
  /** Molten: where its attacks land burns too (patch radius for melee swings). */
  moltenStrikeRadius: 1.4,
  /** Molten: every spewEvery s in a fight it lobs spewGlobs globs that land as burning patches. */
  spewEvery: 4,
  spewGlobs: 2,
  spewWindup: 1.0,
  spewRadius: 1.4,
  spewAtpMult: 0.4,
  /** Stormcaller: every stormEvery s in combat, stormBolts circles near you (the second leads your movement). */
  stormEvery: 4.5,
  stormBolts: 3,
  stormWindup: 1.2,
  stormRadius: 1.5,
  stormAtpMult: 0.6,
  stormParalysis: 0.4,
  /** Frenzied: below this HP share it runs at frenzyTempo, can't be staggered and hits frenzyAtp harder. */
  frenzyAt: 0.4,
  frenzyTempo: 1.3,
  frenzyAtp: 1.3,
  frenzyScale: 1.1,
  /** The roar when it crosses the threshold: radius, damage (× ATP) and knockback. */
  roarRadius: 3.5,
  roarAtpMult: 0.3,
  roarKnockback: 10,
};

/** Hard mode stat scaling for one expedition's field enemies (see DESIGN.md "Nightmare"). */
export interface HardScale {
  /** Multipliers on HP, XP and Meseta. */
  hp: number;
  xp: number;
  meseta: number;
  /** Flat additions to ATP, DFP, ATA and EVP (multiplying would widen the gap between brutes and grunts too much). */
  atp: number;
  dfp: number;
  ata: number;
  evp: number;
  /** Drop tier for every enemy (drops roll the top three tiers up to it). */
  dropTier: number;
  /** The expedition's Hard rares. */
  rares: string[];
}

/** Hard mode boss scaling. */
export interface HardBossScale {
  hp: number;
  atp: number;
  dfp: number;
  ata: number;
  evp: number;
  /** Multiplier on flat (non-ATP) damage: breath and beam ticks, the laser wall, burning zones. */
  flat: number;
  xp: number;
}

/**
 * Hard mode. Same maps and waves as Normal; enemies are scaled per expedition so each Hard
 * band (Forest 32-42, Caves 42-52, Mines 52-62) plays like the Normal Mines at their level.
 */
export const hard = {
  /** Field enemies per expedition. */
  forest: { hp: 6, xp: 15, meseta: 8, atp: 195, dfp: 70, ata: 85, evp: 55, dropTier: 7, rares: ['verdant_edge', 'thornshot'] } as HardScale,
  caves: { hp: 3.4, xp: 4.5, meseta: 3.5, atp: 190, dfp: 62, ata: 77, evp: 45, dropTier: 8, rares: ['magma_blade', 'glacier_wand'] } as HardScale,
  mines: { hp: 2.2, xp: 2.6, meseta: 2.6, atp: 165, dfp: 50, ata: 65, evp: 50, dropTier: 9, rares: ['overcharge_gatling', 'reactor_rod'] } as HardScale,
  bosses: {
    dragon: { hp: 9, atp: 330, dfp: 60, ata: 80, evp: 40, flat: 2.6, xp: 2600 } as HardBossScale,
    derolle: { hp: 6.5, atp: 300, dfp: 55, ata: 75, evp: 40, flat: 2, xp: 4800 } as HardBossScale,
    warden: { hp: 1.9, atp: 270, dfp: 45, ata: 65, evp: 40, flat: 1.6, xp: 7200 } as HardBossScale,
  },
  // Busier, not shorter: recoveries and cooldowns shrink, telegraphs barely do.
  recoveryMult: 0.8,
  cooldownMult: 0.8,
  moveMult: 1.1,
  telegraphMult: 0.9,
  /** Telegraphs are never pushed below this (one already shorter stays as it is). */
  telegraphFloor: 0.8,
  /** Elites: 1 in 4 spawns, everywhere (doubled from 1 in 8 on 2026-10-07). */
  eliteChance: 1 / 4,
  /** Chance a room gets its one champion. */
  championChance: 0.6,
  /** Champions (two affixes): tougher than an elite. */
  championHp: 2,
  championAtp: 1.15,
  championXp: 4,
  championPoise: 2,
};

/** Control nodes: linked gunbots reboot until the node goes down. */
export const nodes = {
  /** Seconds a linked gunbot stays offline before it reboots. */
  rebootAfter: 4,
  /** HP fraction it comes back with. */
  rebootHp: 0.6,
};

/** Pan Arms split / merge rules. */
export const panArms = {
  /** Fraction of max HP at which it splits. */
  splitAt: 0.5,
  /** Seconds after one half dies before it re-forms (unless the other dies too). */
  reformAfter: 6,
  /** HP fraction a re-formed half comes back with. */
  reformHp: 0.25,
  /** Seconds both halves must survive before they merge back. */
  mergeAfter: 12,
};

/** Player status effects. */
export const statuses = {
  /** Poison: fraction of max HP lost per second, and default duration. */
  poisonPctPerSec: 0.015,
  poisonDuration: 10,
  paralysisDuration: 2,
  /** Immunity after paralysis wears off (or is cured). */
  paralysisImmunity: 4,
  /** Burn (Mines): stacks that each drain this fraction of max HP per second. */
  burnPctPerStack: 0.005,
  burnMaxStacks: 5,
  /** Seconds one stack lasts while standing still; moving sheds stacks burnMoveMult times faster. */
  burnStackTime: 3,
  burnMoveMult: 3.5,
};

/** Mines machinery. Power switches turn crushers, lasers and conveyors on or off. */
export const machinery = {
  crusherPeriod: 5.2,
  crusherWarning: 1.3,
  crusherSize: 3.4,
  crusherDamage: 120,
  /** Fraction of an enemy's max HP a crusher deals. */
  crusherEnemyPct: 0.45,
  laserOn: 2.4,
  laserOff: 2.6,
  laserWarning: 0.8,
  laserDamage: 55,
  laserBurn: 2,
  laserEnemyPct: 0.2,
  conveyorSpeed: 2.4,
  /** Garanz missiles: damage to machines caught in a blast, as a fraction of their max HP. */
  missileEnemyPct: 0.12,
  switchRange: 1.8,
};

/** Cave hazards. */
export const hazards = {
  ventPeriod: 6.5,
  ventWarning: 1.6,
  ventEruption: 1.4,
  ventRadius: 1.9,
  /** Flat damage to the player per eruption (reduced by DFP like boss ticks). */
  ventDamage: 70,
  /** Fraction of an enemy's max HP an eruption deals. */
  ventEnemyPct: 0.3,
  marshSlow: 0.7,
  /** Poison seconds refreshed while standing in a marsh / poison puddle. */
  marshPoison: 3,
  /** Mines slag pools: Burn stacks per second spent in one (they slow like the marsh). */
  slagBurnPerSec: 1,
};

export const dragon = {
  hp: 1100,
  atp: 170,
  dfp: 30,
  evp: 45,
  ata: 120,
  xp: 300,
  /** Injector doses its whole HP bar is worth (see injectorCfg). */
  charge: 5,
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
};

export const deRolLe = {
  hp: 2300,
  atp: 245,
  ata: 132,
  dfp: 45,
  evp: 50,
  xp: 900,
  /** Injector doses its whole HP bar is worth (see injectorCfg). */
  charge: 8,
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
  charge: 9,
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
};

export const drops = {
  /** Global multiplier on drop chance (debug). */
  rateMult: 1,
  rareMult: 1,
  boxDropRate: 0.6,
};

/** Mag feeding. Feeds are earned by kills (not time or Meseta), so buying items can't speed it up. */
/** The Mag's talent grid (see mag.ts) and its passives. */
export const magCfg = {
  /** Mag points per character level (Lv 1 already has one). */
  pointsPerLevel: 1,
  /** Squares that must be learned before a keystone (arm tip) can be taken. */
  keystoneMinSpent: 12,
  /** Refunding the grid is free below this character level... */
  freeRespecBelow: 10,
  /** ...then costs this much Meseta per square refunded. */
  respecCostPerPoint: 40,
  /** Bulwark: damage multiplier on area attacks, boss attacks and hazards. */
  bulwarkMult: 0.85,
  /** Last Stand: seconds before it can save you again. */
  lastStandCooldown: 120,
  /** Follow-through: damage multiplier on combo finishers. */
  followThroughMult: 1.15,
  /** Crush: fraction of enemy DFP heavy attacks ignore. */
  crushDfpIgnore: 0.3,
  /** Rhythm: seconds added to the perfect window. */
  rhythmBonus: 0.03,
  /** Deadeye: heavy hit-chance cap. */
  deadeyeMaxHit: 95,
  /** Efficiency: attack technique TP cost multiplier. */
  efficiencyTpMult: 0.85,
  /** Bulwark / Efficiency: Mate / Fluid injector doses restore this much more. */
  injectorBoost: 0.2,
  /** Rhythm: injector doses each perfect chain adds to every equipped injector. */
  rhythmCharge: 0.04,
  /** Clarity: seconds after a Fluid dose during which attack techniques cost no TP. */
  clarityTime: 4,
};

/** Injectors (Mate = HP, Fluid = TP): doses refill from damage dealt, not from the shop. */
export const injectorCfg = {
  /** Doses every equipped injector gains for taking a normal enemy from full HP to 0 (partial damage gives part). */
  chargePerEnemy: 0.3,
  /** Fluid injectors charge at this fraction of that rate (from damage, bosses and Rhythm alike). */
  fluidChargeMult: 0.5,
  /** Elites count this many times over. */
  eliteChargeMult: 2,
  /** Between fights an injector below one dose refills to one at this many seconds per dose. */
  trickleSecPerDose: 15,
  /** Seconds the hands are busy after a dose (a hit cancels the lock, not the dose). */
  useLock: 0.45,
  /** Steady: seconds a dose takes and how much more it restores in total. */
  steadyTime: 4,
  steadyMult: 1.6,
  /** Emergency: gauge fraction below which a dose restores emergencyMult more. */
  emergencyBelow: 0.35,
  emergencyMult: 1.6,
  /** Reserve: doses it refills to between fights (instead of 1). */
  reserveTrickle: 2,
  /** Absorbent: charge gain multiplier. */
  absorbentMult: 1.5,
  /** Sol: paralysis ward after a dose (seconds). */
  solWard: 4,
  /** Bracing: damage-taken multiplier and its duration. */
  braceMult: 0.7,
  braceTime: 3,
};

/** The Telepipe: a long, breakable cast that opens a portal back to Pioneer 2. */
export const telepipeCfg = {
  castTime: 3.5,
};

/**
 * The attack director. Every field enemy attack takes a share of a threat budget from its
 * telegraph until it resolves (melee windups, aimed shots, globs and missiles still in the air);
 * an enemy that can't get a share waits and repositions. Bosses and facility machinery don't count.
 */
export const ai = {
  /** Threat budget: how many attacks may be live on the player at once. */
  maxThreat: 2,
  /** A Garanz barrage's share (missiles in flight): 2 takes the whole budget. */
  barrageThreat: 2,
  /** Minimum seconds between two enemies starting an attack, so attacks come in a readable rhythm. */
  attackStagger: 0.6,
  /** Minimum seconds between two ranged attacks starting. */
  shotGap: 0.8,
  /** Seconds between waves in a room. */
  waveDelay: 1.2,
};

export const debug = {
  timeScale: 1,
  showLog: true,
  invincible: false,
};
