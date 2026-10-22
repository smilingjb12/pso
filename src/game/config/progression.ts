export const drops = {
  /** Global multiplier on drop chance (debug). */
  rateMult: 1,
  rareMult: 1,
  boxDropRate: 0.6,
  /**
   * Falz Rifts (2026-10-11, the user's pick after rift tier 7 gear still lost to Hell Ruins gear): rift drops are
   * Rift-forged, their base stats (stat bonuses, armour damage taken) raised this much per
   * item level above 100 (two a rift tier): +6% at tier 1, +60% at tier 10, the top (2026-10-17, the user's call: gear
   * keeps adding a little up to the deepest tier, then stops).
   */
  riftForgePerTier: 0.03,
  /**
   * Falz Rifts: every tier adds item quantity and rarity of its own (2026-10-12, the user's call, so plain rifts
   * pay more as they climb), and a shard's modifiers add theirs on top: quantity +10% a tier (+100% at tier 10),
   * rarity +12% (+120% at 10). Doubled with the 2026-10-17 squish.
   */
  riftQtyPerTier: 0.1,
  riftRarePerTier: 0.12,
  /**
   * Uniques (2026-10-12, data/uniques.ts) drop from bosses only: a main-game boss kill rolls this chance for the
   * main pool by difficulty. Rift bosses drop their own (Rift Circles, riftCircles.ts: riftUnique* below).
   */
  uniqueBoss: { normal: 0.02, nightmare: 0.04, hell: 0.06 } as Record<'normal' | 'nightmare' | 'hell', number>,
  /**
   * Rift Circles (2026-10-17): chance a rift boss drops one of its own uniques (gear or unit), plus this much for each
   * kill of that boss in a row without one; the first kill of each boss in each circle always drops one.
   */
  riftUnique: 0.12,
  riftUniqueDry: 0.04,
  /** A pinnacle boss's odds (both) are this many times a boss's: its replay takes Resonance from two quarters (2026-10-21). */
  pinnacleUniqueMult: 2,
  /**
   * Affix rolls (2026-10-22, the user's call when crafting went): each affix lands at the top value of the best
   * strength tier its item level allows, or of one or two tiers below, by these weights; Haste at the item tier's
   * cap, or 1 or 2 under it. A downside's penalty is its tier's smallest.
   */
  affixSteps: [50, 30, 20] as [number, number, number],
};

/**
 * Haste (see DESIGN.md "Hell"): an affix on weapons, frames and barriers from tier 8 (Nightmare) up, the Frail
 * downside affix too; what is worn adds up. Photon bolts and technique casts take 1 / (1 + Haste%)
 * as long. Normal gear never has it.
 */
export const hasteCfg = {
  /** Highest Haste % one item can roll, by tier (lower tiers roll none). */
  capByTier: { 8: 2, 9: 2, 10: 3, 11: 4, 12: 5, 13: 7, 14: 9, 15: 12 } as Record<number, number>,
  /** Share of eligible drops that roll it (shop stock never does). */
  chance: 0.75,
};

/** The Mag (see mag.ts): points per level into MIND / DEF, permanent once spent. */
export const magCfg = {
  /** Mag points per character level (Lv 1 already has one). */
  pointsPerLevel: 1,
  /**
   * Photon blasts (picked on the Mag tab since 2026-10-14, the Arts redesign; the talents' Lv 85 row before): a gauge
   * filled by damage that fires by itself when full, in a fight. The Mag teaches them from this level.
   */
  pbLevel: 85,
  /** Gauge gained for taking a normal enemy from full to 0 (elites count double); a boss's whole bar gives pbBossCharge. */
  /** Halved 2026-10-11 (the user's call: it came round too often; was 0.08 / 1.2). */
  pbChargePerEnemy: 0.04,
  pbBossCharge: 0.6,
  /** Mylla & Youlla: damage to every enemy within pbMyllaRange m, as this many of your photon bolts. */
  pbMyllaMult: 5,
  pbMyllaRange: 10,
  /** Leilla: damage taken multiplier for pbLeillaTime s, and a heal (share of max HP). */
  pbLeillaMult: 0.5,
  pbLeillaTime: 4,
  pbLeillaHeal: 0.3,
  /** Farlla: tech damage +this % (and debandShare of it off damage taken). */
  pbFarllaPct: 35,
};

/** The Skills trees (skills.ts, 2026-10-15, Diablo 2 style): ranked Arts and passives bought with points. */
export const skillCfg = {
  /** Skill points per character level (100 at Lv 100). */
  pointsPerLevel: 1,
  /** An Art's top rank. Passives take up to five (passives.ts), the fifth being the full effect. */
  artRanks: 10,
  /**
   * Art power at rank 1, and what each rank above adds (of that): rank 4 is about the power before ranks (the Arts were
   * tuned without them), rank 10 about +31%. Power is damage, and Resta's healing.
   */
  artBasePower: 0.85,
  artPowerPerRank: 0.06,
  /** TP each rank above the first takes off an Art's cost. */
  artTpPerRank: 0.02,
  /** The ranks an Art's two modifier rows open at. */
  modRanks: [5, 10] as [number, number],
};

/**
 * Passives (see passives.ts; they were talents until 2026-10-14): numbers per passive, live-tunable.
 * "Perfect finisher" = the 3rd step of a chain started perfectly twice in a row (the ×1.4 one).
 */
export const passiveCfg = {
  // --- general
  /** Tempo: seconds added to the perfect window (weapon combos and cast chains). */
  tempoBonus: 0.03,
  /** Fleet: extra dash charges. */
  fleetCharges: 1,
  /** Slipstream: seconds after dashing out of an enemy telegraph during which the next attack or cast lands perfect. */
  slipstreamTime: 3,
  /** Last Stand: seconds before it can save you again. */
  lastStandCooldown: 120,
  /** Bulwark: damage multiplier on area attacks, boss attacks and hazards. */
  bulwarkMult: 0.85,
  /** Bulwark / Efficiency: Mate / Fluid injector doses restore this much more; Field Medic: Mate doses. */
  injectorBoost: 0.2,
  fieldMedicBoost: 0.3,
  /** Bloodlust: injector charge from your damage multiplier. */
  bloodlustMult: 1.3,
  /** Composure: after a perfect finisher, the next hit taken within composureTime s deals this much. */
  composureTime: 4,
  composureMult: 0.5,
  /** Rush: after a perfect finisher, run speed and dash recharge multipliers for rushTime s. */
  rushTime: 4,
  rushRunMult: 1.15,
  rushDashMult: 1.5,
  /** Calm Mind: a perfect cast gives this damage-taken multiplier for parryTime s. */
  parryMult: 0.85,
  parryTime: 2,
  /** Light Feet: run speed and dash recharge multipliers. */
  lightFeetRunMult: 1.1,
  lightFeetDashMult: 1.25,
  /** Longshot: techniques deal this much more past longshotRange m. */
  longshotMult: 1.12,
  longshotRange: 8,
  // --- techniques
  resonanceMult: 1.12,
  /** Blink: the dash covers its distance in this many seconds (through bodies). */
  blinkDuration: 0.06,
  /** Overcast: below this share of HP, techniques deal overcastMult. */
  overcastBelow: 0.5,
  overcastMult: 1.15,
  /** Barrier: Resta overheal becomes a shield up to this fraction of max HP, fading to nothing over barrierFade s. */
  barrierCap: 0.2,
  barrierFade: 4,
  /** Focus Bolt: the single-target techniques (Foie, Zonde, Barta) deal this much more. */
  focusBoltMult: 1.25,
  /** Ward / Aegis: shield (share of max HP) and how long it lasts. */
  wardShield: 0.05,
  wardTime: 3,
  aegisShield: 0.08,
  aegisTime: 3,
  conductorMult: 2,
  efficiencyTpMult: 0.85,
  clarityTime: 4,
  siphonMult: 2,
  overloadMult: 1.5,
  echoShare: 0.5,
  echoDelay: 0.35,
  kindleMult: 1.5,
  frostbiteMult: 0.75,
  swiftCastMult: 0.8,
};

/**
 * Injectors (Mate = HP, Fluid = TP), one slot: doses refill from damage dealt and in Pioneer 2, nothing
 * else. A floor (~35 enemies) is worth about 3 + 5 Mate doses: a budget a sloppy run burns through.
 */
export const injectorCfg = {
  /** Doses the injector gains for taking a normal enemy from full HP to 0 (partial damage gives part). */
  chargePerEnemy: 0.15,
  /** Fluid injectors charge at this fraction of that rate (from damage, bosses and Rhythm alike). */
  fluidChargeMult: 0.5,
  /** Elites count this many times over. */
  eliteChargeMult: 2,
  /**
   * Out of combat (no room fight, no boss engaged) the injector, HP and TP refill completely once calmDelay seconds
   * have passed since the fight (2026-10-09: the old 0.1 doses / s only made you stand and wait; HP and TP joined on
   * 2026-10-11).
   */
  calmDelay: 3,
  /** Seconds the hands are busy after a dose (a hit cancels the lock, not the dose). */
  useLock: 0.45,
  /** Steady: seconds a dose takes and how much more it restores in total. */
  steadyTime: 4,
  steadyMult: 1.6,
  /** Emergency: gauge fraction below which a dose restores emergencyMult more. */
  emergencyBelow: 0.35,
  emergencyMult: 1.6,
  /** Reserve: extra doses it holds. */
  reserveDoses: 1,
  /** Absorbent: charge gain multiplier. */
  absorbentMult: 1.5,
  /** Sol: paralysis ward after a dose (seconds). */
  solWard: 4,
  /** Bracing: damage-taken multiplier and its duration. */
  braceMult: 0.7,
  braceTime: 3,
};


/** Unique effects (data/uniques.ts, 2026-10-12): the numbers behind each one's effect and cost. */
export const uniqueCfg = {
  /** Dark Flow: share of max HP a kill heals (and it removes a Corruption stack). */
  darkFlowHeal: 0.05,
  /** Frozen Shooter: a technique on a frozen enemy deals this (and thaws it); anything else this. Ice techniques freeze. */
  frozenShatterMult: 2.5,
  frozenOtherMult: 0.5,
  frozenFreezeTime: 2.5,
  /** Seconds a shattered enemy can't be frozen again. */
  frozenImmuneTime: 3,
  /** Reactor Rod: each attack cast within reactorWindow s of the last adds reactorStep, up to reactorCap; TP cost x reactorTpMult. */
  reactorStep: 0.3,
  reactorCap: 2,
  reactorWindow: 1.5,
  reactorTpMult: 3,
  /** Falz Halo: damage per Corruption stack. */
  falzHaloPerStack: 0.1,
  /** Red Ring: crit damage it adds (+1 = +100%: ×3 instead of ×2, on top of Crit damage affixes), and the Corruption resistance it takes away. */
  redRingCrit: 1,
  redRingCorrupt: -50,
  /** Overclock Core: gear Haste multiplier, and max HP multiplier. */
  overclockHasteMult: 2,
  overclockHpMult: 0.5,

  // Rift Circles (2026-10-17, riftCircles.ts; effects in combat/riftUniques.ts). Unique units' numbers (effects and
  // costs) are raised by the Heart of Falz.
  /** Heart of Falz: the other unique units' numbers times this. */
  heartMult: 1.5,
  /** Ember Core: Burn stacks your hits can build on an enemy beyond the first; Burn on you deals this much more. */
  emberExtraStacks: 2,
  emberSelfBurn: 0.5,
  /** Flame Visit: the fire pool a burning death leaves (radius m, seconds, share of the dead one's Burn a second); Rafoie's burning ground lasts this much longer. */
  flamePoolRadius: 3,
  flamePoolTime: 3,
  flamePoolShare: 1,
  flameRafoieMult: 2,
  /** Dragon Rush: power of the hit on each enemy dashed through (1 = a photon bolt), and how much slower dashes recharge. */
  rushPower: 1,
  rushRange: 1.2,
  rushDashCost: 0.4,
  /** Dragon Fang: Rampage damage and Haste % a stack, the most stacks, seconds it lasts after a kill, and the hit (share of max HP) that ends it. */
  rampageDmg: 0.05,
  rampageHaste: 3,
  rampageMax: 10,
  rampageTime: 3,
  rampageBreak: 0.15,
  /** Proof of Sword-Saint: extra damage of the first hit on an enemy at full HP (+2 = ×3), and the cut below half HP. */
  saintBonus: 2,
  saintLow: 0.25,
  /** Plague Mantle: how far a poisoned death spreads; how much longer poison lasts on you. */
  plagueRadius: 4,
  plagueSelfPoison: 1,
  /** Venom Sac: a crit's share its poison deals a second, seconds, most stacks; the crit damage it costs. */
  venomSacShare: 0.2,
  venomSacTime: 4,
  venomSacMax: 10,
  venomSacCrit: 0.2,
  /** Rol Carapace: most of your max HP one hit takes; how much less injector doses restore. */
  carapaceCap: 0.35,
  carapaceInjector: 0.5,
  /** Tide Shell: seconds without being hit before it forms, the most of one hit it soaks (share of max HP), and the run speed it costs. */
  tideDelay: 8,
  tideSoak: 0.4,
  tideRun: 0.1,
  /** Ophelie Seize: a photon bolt's venom (share of the hit a second) and seconds; how far stacks jump on a death. */
  ophelieShare: 0.15,
  ophelieTime: 6,
  ophelieJump: 8,
  /** HP/Drain: share of the damage you deal that heals you. */
  drainShare: 0.03,
  /** Limiter: cast time cut; extra technique TP. */
  limiterCast: 0.3,
  limiterTp: 0.2,
  /** S-Beat's Blade: TP multiplier on techniques cast off a perfect chain. */
  sBeatTp: 2,
  /** V801: photon blast charge it adds (+1 = twice as fast); how much less photon bolts refill. */
  v801Charge: 1,
  v801Refill: 0.2,
  /** Prophets of Motav: the combo's damage, and a repeated element's. */
  motavMult: 2,
  motavSame: 0.5,
  /** Yasakani Magatama: seconds between echoes, the echo's delay and power (1 = the technique's own); max TP it costs. */
  yasakaniEvery: 12,
  yasakaniDelay: 0.4,
  yasakaniShare: 1,
  yasakaniTp: 0.25,
  /** Devil/Battle: damage for every 10% of HP missing (nine steps at most). */
  devilPer10: 0.03,
  /** Dark Bridge: HP for each TP short, the damage of a cast paid that way; max TP it costs. */
  bridgeHpPerTp: 2,
  bridgeMult: 1.25,
  bridgeTp: 0.4,
  /** Soul Eater: share of the dead enemy's max HP the Doom deals, seconds before it lands, how far it reaches; extra Corruption you gain (+1 = twice). */
  soulShare: 0.3,
  soulDelay: 1.5,
  soulRange: 8,
  soulCorrupt: 1,
  /** DF Shield: seconds of Doom, kills (or share of a boss's HP dealt) to rise, the HP you rise with; all healing it costs. */
  dfDoomTime: 4,
  dfKills: 3,
  dfBossShare: 0.03,
  dfRise: 0.4,
  dfHeal: 0.3,
  // Gal Gryphon (2026-10-21, the Circle II pinnacle's; picked in a question round).
  /**
   * Storm Crest: Static a metre moved (dashes too), the most it holds, the damage a point adds to the hit that spends
   * it; at `crestBoltAt` points or more that hit also sends a bolt to `crestJumps` more enemies within `crestRange` m for
   * `crestJumpShare` of it. Hits with no Static in them deal `crestDry` less.
   */
  crestPerM: 1,
  crestMax: 40,
  crestPerPoint: 0.04,
  crestBoltAt: 10,
  crestJumps: 3,
  crestRange: 5,
  crestJumpShare: 0.5,
  crestDry: 0.25,
  /** Grounding Coil: Ground a hit on a boss or champion builds (1 = full), seconds grounded, damage taken grounded; how much harder they hit you. */
  coilPerHit: 0.04,
  coilTime: 5,
  coilMult: 0.5,
  coilTaken: 0.2,
  // Barba Ray (2026-10-22, the other Circle II pinnacle's; picked in a question round).
  /** Tidecaller: seconds a Barta hit Soaks for, what Zonde deals the Soaked on top, what Foie deals less. */
  tidecallerSoak: 6,
  tidecallerZonde: 0.4,
  tidecallerFoie: 0.4,
  /**
   * Azure Ray (Pig Ray until 2026-10-22, when it went from 30% of a photon bolt to a share of a technique): seconds
   * between darts, a dart's share of a single-target technique's hit (the strongest of Foie, Zonde and Barta), its
   * reach (m), and the photon bolts' TP refill cut.
   */
  azureEvery: 2,
  azurePower: 0.2,
  azureRange: 14,
  azureRefill: 0.2,
};
