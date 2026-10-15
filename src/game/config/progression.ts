export const drops = {
  /** Global multiplier on drop chance (debug). */
  rateMult: 1,
  rareMult: 1,
  boxDropRate: 0.6,
  /**
   * Falz Rifts (2026-10-11, the user's pick after rift tier 7 gear still lost to Hell Ruins gear): rift drops are
   * Rift-forged, their base stats (weapon damage and stat bonuses, armour damage taken and bonuses) raised this much per rift
   * tier (item level above 100): +21% at tier 7, +48% at tier 16.
   */
  riftForgePerTier: 0.03,
  /**
   * Falz Rifts: every tier adds item quantity and rarity of its own (2026-10-12, the user's call, so plain rifts
   * pay more as they climb), and a shard's modifiers add theirs on top: quantity +5% a tier (+80% at tier 16),
   * rarity +6% (+96% at 16).
   */
  riftQtyPerTier: 0.05,
  riftRarePerTier: 0.06,
  /**
   * Uniques (2026-10-12, data/uniques.ts) drop from bosses only: a main-game boss kill rolls this chance for the
   * main pool by difficulty; a rift boss uniqueRift + uniqueRiftPerTier x its tier for the rift pool (16% at 16).
   */
  uniqueBoss: { normal: 0.02, nightmare: 0.04, hell: 0.06 } as Record<'normal' | 'nightmare' | 'hell', number>,
  uniqueRift: 0.06,
  uniqueRiftPerTier: 0.005,
  /** In the main pool the class's own weapon counts this many times (the others once). */
  uniqueClassWeight: 2,
};

/**
 * Crafting (see DESIGN.md "Crafting: Photons"; redesigned 2026-10-13): three photons work on an item's active affixes
 * as often as you have them (no Potential budget any more), so their drop rates (loot.ts rollPhoton) are the limit.
 */
export const craftCfg = {
  /** Salvaging junk: Photon Drops from a rare (always one) and the chance of one from a magic item. */
  salvageMagic: 0.35,
};

/**
 * Haste (see DESIGN.md "Hell"): an affix on weapons, frames and barriers from tier 8 (Nightmare) up, the Frail
 * downside affix too; what is worn adds up. Swing wind-ups and recoveries and technique casts take 1 / (1 + Haste%)
 * as long. Normal gear never has it.
 */
export const hasteCfg = {
  /** Highest Haste % one item can roll, by tier (lower tiers roll none). */
  capByTier: { 8: 2, 9: 2, 10: 3, 11: 4, 12: 5, 13: 7, 14: 9, 15: 12 } as Record<number, number>,
  /** Share of eligible drops that roll it (shop stock never does). */
  chance: 0.75,
};

/** The Mag (see mag.ts): points per level into POW / DEX / MIND / DEF, permanent once spent. */
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
  /** Mylla & Youlla: damage to every enemy within pbMyllaRange m, as this many of your basic finishers (or bolts / techniques). */
  pbMyllaMult: 5,
  pbMyllaRange: 10,
  /** Leilla: damage taken multiplier for pbLeillaTime s, and a heal (share of max HP). */
  pbLeillaMult: 0.5,
  pbLeillaTime: 4,
  pbLeillaHeal: 0.3,
  /** Farlla: Shifta and Deband at this strength (%). */
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
  // --- shared
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
  /**
   * Fervor (Hunter) / Rapid Fire (Ranger): weapon wind-up and recovery multiplier, Swift Cast's for weapons
   * (2026-10-12, replacing Berserk / Overdrive's ×1.6 perfect finisher: a sword at 29% Haste still swung slower than
   * a Force cast with Swift Cast).
   */
  swingSpeedMult: 0.8,
  // --- Hunter
  followThroughMult: 1.15,
  /** Parry / Calm Mind: a perfect hit or cast gives this damage-taken multiplier for parryTime s. */
  parryMult: 0.85,
  parryTime: 2,
  cleaveTargets: 1,
  cleaveArcDeg: 20,
  /** Sweep Guard: each enemy a light swing hits takes this much off damage taken, up to sweepGuardMax, for sweepGuardTime s. */
  sweepGuardStep: 0.02,
  sweepGuardMax: 0.1,
  sweepGuardTime: 3,
  /** Shockwave: knockback multiplier of a light finisher. */
  shockwaveKnock: 3,
  retaliateMult: 1.25,
  retaliateTime: 2,
  steadfastKnockback: 0.5,
  crushDfpIgnore: 0.3,
  /** Balance (Saber): heavy hits deal this much more and add this many stagger points. */
  balanceMult: 1.2,
  balanceStagger: 1,
  secondWindHeal: 0.03,
  /** Focus (Hunter, Ranger): basic steps refill this much more TP. */
  focusTpMult: 1.5,
  executionerMult: 1.4,
  breakerMult: 1.25,
  /** Daunt / Suppress: what weakened enemies deal, and for how long. */
  dauntMult: 0.8,
  dauntTime: 4,
  shatterRange: 3,
  shatterShare: 0.5,
  // --- Ranger
  hotStreakMult: 1.12,
  breathingRoomRange: 4,
  breathingRoomKnock: 8,
  lightFeetRunMult: 1.1,
  lightFeetDashMult: 1.25,
  suppressMult: 0.85,
  suppressTime: 3,
  adrenalineBelow: 0.5,
  adrenalineMult: 1.15,
  /** Deadeye: gun Arts deal this much more (and shots lose half as much at range). */
  deadeyeMult: 1.12,
  pointBlankRange: 4,
  pointBlankKnock: 12,
  pointBlankCooldown: 6,
  pinStun: 1.5,
  arcShare: 0.5,
  arcStun: 0.8,
  longshotMult: 1.12,
  longshotRange: 8,
  pinningFireMult: 1.5,
  roundsMult: 1.5,
  // --- Force
  resonanceMult: 1.12,
  /** Blink: the dash covers its distance in this many seconds (through bodies). */
  blinkDuration: 0.06,
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
  /** Frozen Shooter: a shot on a frozen enemy deals this (and thaws it); anything else this. Heavy shots freeze. */
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
};
